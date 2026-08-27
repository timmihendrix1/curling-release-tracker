// Coordinator + reducer integration: the states a real transition actually passes
// through, fed into the real reducer.
//
// The defect these cover: an exact Google return or OTP verification can pass C7
// and then find an already-valid same-scope trusted record. That is ADR-0025 §A's
// optimistic entry, and it legitimately never emits `ensuring_profile`,
// `resolving_gate_facts` or `establishing_trusted_state` — there is nothing to
// establish. The gate must still open, and only for that exact correlated result.
import { describe, expect, it } from "vitest";
import {
  initialGateState,
  isGateReady,
  reduceGateState,
  type GateEvent,
  type GateState,
  type GateStateView,
  type TransitionIdentity,
} from "../gateState";
import {
  ATTEMPT_A,
  BARRIER_A,
  BARRIER_C,
  FIXED_NOW,
  FLOW_X,
  FLOW_Y,
  IDENTITY_A,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  SYNTHETIC_CODE,
  callbackUrl,
  createIdentityHarness,
  type IdentityHarness,
  type MemoryStorage,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";

/** One page-lifetime operation, and a state tagged as having been entered by it. */
const CURRENT: TransitionIdentity = { id: "current", sequence: 2, mode: "foreground" };

function TAGGED_CURRENT(view: GateStateView): GateState {
  return { ...view, transition: CURRENT, acceptedSequence: CURRENT.sequence };
}

function seedBarrier(storage: MemoryStorage, barrierId = BARRIER_A): void {
  storage.seed(
    STORAGE_KEYS.barrier,
    createIdentityAccessBarrier({
      barrierId,
      origin: "interactive_authentication",
      barredAccountScopeId: null,
      barredGeneration: null,
      establishedAt: FIXED_NOW,
    })
  );
}

function seedGoogleAttempt(storage: MemoryStorage, flowId = FLOW_X, barrierId = BARRIER_A): void {
  storage.seed(
    STORAGE_KEYS.attempt,
    createGoogleAttempt({
      attemptId: ATTEMPT_A,
      flowId,
      barrierId,
      capturedIdentityGeneration: 1,
      startedAt: FIXED_NOW,
    })
  );
}

function seedTrusted(storage: MemoryStorage, accountScopeId = IDENTITY_A.accountScopeId): void {
  storage.seed(
    STORAGE_KEYS.trusted,
    createTrustedDeviceRecord({
      accountScopeId,
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      generation: 1,
      establishedAt: FIXED_NOW,
      lastServerConfirmationAt: FIXED_NOW,
    })
  );
}

/** Replays every progress phase the coordinator announced, then the settling
 * event — exactly as the future provider will. */
function replay(harness: IdentityHarness, settle: GateEvent): GateState {
  let state = initialGateState();
  for (const [phase, transition] of harness.progressEvents) {
    state = reduceGateState(state, { type: "progress", phase, transition });
    expect(isGateReady(state), `ready too early at ${phase}`).toBe(false);
  }
  return reduceGateState(state, settle);
}

describe("Google return with an existing valid same-scope trusted record", () => {
  it("opens the gate from finalizing_identity, on the correlated result alone", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
    });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    expect(outcome.finalization?.kind).toBe("resolved");
    // The optimistic path really does skip the establishment phases.
    expect(harness.progress).toEqual([
      "intaking_oauth_return",
      "consuming_oauth_return",
      "finalizing_identity",
    ]);

    const state = replay(harness, {
      type: "startup_completed",
      callback: outcome.callback,
      verdict: outcome.verdict,
      finalization: outcome.finalization,
      transition: outcome.transition,
    });
    expect(isGateReady(state)).toBe(true);
    expect(state.kind).toBe("ready_online");
  });

  it("still refuses when the same verdict arrives WITHOUT the correlated finalization", async () => {
    // A bare verdict is not proof that this transition completed.
    const state = reduceGateState(TAGGED_CURRENT({ kind: "finalizing_identity" }), {
      type: "startup_completed",
      callback: { kind: "succeeded", identity: IDENTITY_A },
      verdict: {
        kind: "ready_online",
        session: {
          accountScopeId: IDENTITY_A.accountScopeId,
          email: IDENTITY_A.email,
          profileId: PROFILE_A,
          displayName: "Athlete",
          entitlement: "free",
        },
      },
    });
    expect(isGateReady(state)).toBe(false);
    expect(state.kind).toBe("finalizing_identity");
  });
});

describe("OTP verification with an existing valid same-scope trusted record", () => {
  it("opens the gate from finalizing_identity, on the correlated result alone", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    await harness.coordinator.requestEmailOtp("athlete@example.test");
    harness.progress.length = 0;
    const outcome = await harness.coordinator.verifyEmailOtp("athlete@example.test", "123456");

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.gate.kind).toBe("ready_online");
    expect(harness.progress).toEqual(["verifying_otp", "finalizing_identity"]);

    const state = replay(harness, { type: "transition_settled", outcome });
    expect(isGateReady(state)).toBe(true);
  });

  it("a completed correlation set on a LATER load still opens the gate the ordinary way", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    harness.storage.seed(
      STORAGE_KEYS.resolutionFor(BARRIER_A),
      createIdentityBarrierResolution({
        barrierId: BARRIER_A,
        attemptId: ATTEMPT_A,
        method: "google",
        flowId: FLOW_X,
        identityGeneration: 1,
        authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
        resolvedAt: FIXED_NOW,
      })
    );
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    // This path goes through `restoring_identity`, which is an unconditional
    // readiness progression — the correlated-completion allowance is not needed.
    expect(harness.progress).toEqual(["intaking_oauth_return", "restoring_identity"]);
    const state = replay(harness, {
      type: "startup_completed",
      callback: outcome.callback,
      verdict: outcome.verdict,
      finalization: outcome.finalization,
      transition: outcome.transition,
    });
    expect(isGateReady(state)).toBe(true);
  });
});

describe("stale and unowned finalizing results still cannot open the gate", () => {
  it("a stale callback that reaches no exchange produces no resolved result and no ready state", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
    });
    seedBarrier(harness.storage);
    // The CURRENT attempt is a newer one, on a different selector.
    seedGoogleAttempt(harness.storage, FLOW_Y);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.callback).toEqual({ kind: "unowned_callback" });
    expect(outcome.finalization).toBeNull();
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    const state = replay(harness, {
      type: "startup_completed",
      callback: outcome.callback,
      verdict: outcome.verdict,
      finalization: outcome.finalization,
      transition: outcome.transition,
    });
    expect(isGateReady(state)).toBe(false);
    expect(state.kind).toBe("quarantined_locked");
  });

  it("a correlation change during the exchange cannot open the gate", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
    });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const originalExchange = harness.fakeAuth.auth.exchangeCorrelatedCallback;
    harness.fakeAuth.auth.exchangeCorrelatedCallback = async (claim, expectedFlowId) => {
      seedBarrier(harness.storage, BARRIER_C);
      return originalExchange(claim, expectedFlowId);
    };

    const outcome = await harness.coordinator.startUp();

    expect(report(outcome.finalization)).toEqual({ kind: "correlation_changed" });
    const state = replay(harness, {
      type: "startup_completed",
      callback: outcome.callback,
      verdict: outcome.verdict,
      finalization: outcome.finalization,
      transition: outcome.transition,
    });
    expect(isGateReady(state)).toBe(false);
  });

  it("every non-resolved finalization is refused from every finishing state", async () => {
    const finishing: Array<GateState["kind"]> = [
      "consuming_oauth_return",
      "finalizing_identity",
      "verifying_otp",
      "submitting_onboarding",
    ];
    const nonResolved = [
      { kind: "correlation_changed" as const },
      { kind: "exchange_failed" as const },
      { kind: "barrier_resolution_failed" as const },
      { kind: "superseded" as const },
      { kind: "unowned_callback" as const },
      { kind: "replayed_callback" as const },
      { kind: "trusted_state_not_established" as const },
      null,
    ];
    for (const kind of finishing) {
      for (const finalization of nonResolved) {
        // The id MATCHES, so only the finalization is under test: a non-resolved
        // finalization means the operation did not earn a ready verdict, and the
        // coordinator never pairs one with a ready verdict.
        const state = reduceGateState(TAGGED_CURRENT({ kind } as GateStateView), {
          type: "startup_completed",
          callback: { kind: "no_return" },
          verdict: { kind: "quarantined_locked", origin: "interactive_authentication" },
          finalization,
          transition: CURRENT,
        });
        expect(isGateReady(state), `${kind} / ${finalization?.kind ?? "null"}`).toBe(false);
      }
    }
  });

  it("a LOCK is still never lifted, even by a correlated resolved result", async () => {
    const locks: GateState[] = [
      { kind: "locked", origin: "explicit_sign_out", callbackNotice: "none" },
      { kind: "quarantined_locked", origin: "interactive_authentication", callbackNotice: "none" },
      { kind: "storage_unavailable_locked" },
    ];
    for (const state of locks) {
      const next = reduceGateState(state, {
        type: "transition_settled",
        outcome: {
          kind: "resolved",
          identity: IDENTITY_A,
          gate: {
            kind: "ready_online",
            session: {
              accountScopeId: IDENTITY_A.accountScopeId,
              email: null,
              profileId: PROFILE_A,
              displayName: "Athlete",
              entitlement: "free",
            },
          },
          transition: CURRENT,
        },
      });
      expect(next, state.kind).toBe(state);
    }
  });

  it("a correlated resolved result cannot open the gate from a PRE-authentication state", async () => {
    const preAuth: Array<GateState["kind"]> = [
      "intaking_oauth_return",
      "awaiting_otp",
      "requesting_otp",
      "establishing_identity_barrier",
      "preparing_google_flow",
      "persisting_google_attempt",
      "navigating_to_provider",
      "signing_out",
      "identity_unconfirmed",
      "legal_unavailable",
      "cloud_unavailable",
    ];
    for (const kind of preAuth) {
      const next = reduceGateState({ kind } as GateState, {
        type: "transition_settled",
        outcome: {
          kind: "resolved",
          identity: IDENTITY_A,
          gate: {
            kind: "ready_online",
            session: {
              accountScopeId: IDENTITY_A.accountScopeId,
              email: null,
              profileId: PROFILE_A,
              displayName: "Athlete",
              entitlement: "free",
            },
          },
          transition: CURRENT,
        },
      });
      expect(isGateReady(next), kind).toBe(false);
    }
  });
});
