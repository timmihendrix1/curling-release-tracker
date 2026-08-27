// Supersession AFTER C7 (ADR-0025 §8).
//
// C7 proves the exact barrier, attempt and generation were current at the moment
// the resolution was written. Several awaits follow it — loading trusted state,
// writing it, resetting a recovery marker — and a newer transition can become
// current during ANY of them. An operation that has been superseded must not:
//
//   * write or replace trusted state,
//   * reset newer intent state,
//   * return a ready verdict, or
//   * be able to open the reducer if its result is applied late.
//
// Every interleaving below is deterministic: it fires from a storage-call hook at
// an exact point, never from a timer.
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_A,
  BARRIER_A,
  BARRIER_C,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  SYNTHETIC_CODE,
  callbackUrl,
  createIdentityHarness,
  type IdentityHarness,
  type MemoryStorage,
  PINNED_PRIVACY,
  PINNED_TERMS,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createPendingIntent, type PendingIntent } from "../pendingIntentRepository";
import { initialGateState, isGateReady, reduceGateState, type GateState } from "../gateState";

const INVITE_TOKEN = "opaque-invitation-token-0001";

function recoveryIntent(): PendingIntent {
  const built = createPendingIntent({
    kind: "invitation",
    value: INVITE_TOKEN,
    capturedAt: FIXED_NOW,
    survival: "invitation_account_recovery",
  });
  if (built === null) throw new Error("fixture is invalid");
  return built;
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

function seedAttempt(storage: MemoryStorage): void {
  storage.seed(
    STORAGE_KEYS.attempt,
    createGoogleAttempt({
      attemptId: ATTEMPT_A,
      flowId: FLOW_X,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 1,
      startedAt: FIXED_NOW,
    })
  );
}

function seedResolution(storage: MemoryStorage): void {
  storage.seed(
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

function onboard(harness: IdentityHarness, accountScopeId = IDENTITY_A.accountScopeId): void {
  harness.identityBackend.currentAccountScopeId = accountScopeId;
  harness.identityBackend.accounts.set(accountScopeId, {
    profileId: PROFILE_A,
    displayName: "Athlete",
    onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
  });
}

/** Installs barrier C the first time `call` is observed — the newer transition
 * becoming current at an exact point. */
function supersedeOn(harness: IdentityHarness, call: string): void {
  harness.storage.onBeforeCall = (observed) => {
    if (observed === call) {
      harness.storage.onBeforeCall = null;
      seedBarrier(harness.storage, BARRIER_C);
    }
  };
}

/** A Google callback whose barrier and attempt are already in place, so Phase 0
 * admits it and the flow reaches C7. */
function admittedGoogleReturn(): IdentityHarness {
  const harness = createIdentityHarness({
    url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
  });
  seedBarrier(harness.storage);
  seedAttempt(harness.storage);
  onboard(harness);
  harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
  return harness;
}

function replayStartup(
  harness: IdentityHarness,
  outcome: Awaited<ReturnType<IdentityHarness["coordinator"]["startUp"]>>
): GateState {
  let state = initialGateState();
  for (const [phase, transition] of harness.progressEvents) {
    state = reduceGateState(state, { type: "progress", phase, transition });
  }
  return reduceGateState(state, {
    type: "startup_completed",
    callback: outcome.callback,
    verdict: outcome.verdict,
    finalization: outcome.finalization,
    transition: outcome.transition,
  });
}

describe("supersession during trusted-state LOAD", () => {
  it("does not return ready and does not replace trusted state", async () => {
    const harness = admittedGoogleReturn();
    seedTrusted(harness.storage);
    // The newer transition arrives as the trusted record is being read.
    supersedeOn(harness, `get:${STORAGE_KEYS.trusted}`);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(isGateReady(replayStartup(harness, outcome))).toBe(false);
    // Barrier C is untouched and still unresolved.
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(false);
  });
});

describe("supersession during trusted-state SAVE", () => {
  it("never writes the record, and never returns ready", async () => {
    const harness = admittedGoogleReturn();
    // No trusted record yet, so the fresh path runs and would write one.
    supersedeOn(harness, `get:${STORAGE_KEYS.trusted}`);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.trusted}`);
  });

  it("a supersession observed immediately before the write blocks it", async () => {
    const harness = admittedGoogleReturn();
    // Fire on the LAST read before the write: the pre-write proof re-reads the
    // barrier, and that read is where the newer barrier is observed.
    let seen = 0;
    harness.storage.onBeforeCall = (observed) => {
      if (observed === `get:${STORAGE_KEYS.barrier}`) {
        seen += 1;
        // The pre-write proof is the fourth barrier read of this flow.
        if (seen === 4) {
          harness.storage.onBeforeCall = null;
          seedBarrier(harness.storage, BARRIER_C);
        }
      }
    };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).not.toBe("ready_online");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
});

describe("supersession during the recovery-marker RESET", () => {
  it("does not reset the newer transition's intent state, and does not return ready", async () => {
    const harness = admittedGoogleReturn();
    seedTrusted(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, recoveryIntent());
    // Fire as the intent is read for the reset.
    supersedeOn(harness, `get:${STORAGE_KEYS.intent}`);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).not.toBe("ready_online");
    // The marker is untouched: a superseded operation must not mutate newer state.
    const stored = JSON.parse(harness.storage.store.get(STORAGE_KEYS.intent) as string) as {
      survival: string;
    };
    expect(stored.survival).toBe("invitation_account_recovery");
    expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.intent}`);
  });
});

describe("supersession after C7, immediately before ready", () => {
  it("an optimistic same-scope entry superseded at the last proof does not open", async () => {
    const harness = admittedGoogleReturn();
    seedTrusted(harness.storage);
    // The final proof before the ready return is a barrier read; supersede there.
    let barrierReads = 0;
    harness.storage.onBeforeCall = (observed) => {
      if (observed === `get:${STORAGE_KEYS.barrier}`) {
        barrierReads += 1;
        if (barrierReads === 5) {
          harness.storage.onBeforeCall = null;
          seedBarrier(harness.storage, BARRIER_C);
        }
      }
    };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).not.toBe("ready_online");
    expect(isGateReady(replayStartup(harness, outcome))).toBe(false);
  });

  it("an OTP verification superseded after C7 returns no ready gate", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    await harness.coordinator.requestEmailOtp("athlete@example.test");

    // Supersede while the trusted record is being read, which is after C7.
    supersedeOn(harness, `get:${STORAGE_KEYS.trusted}`);

    const outcome = await harness.coordinator.verifyEmailOtp("athlete@example.test", "123456");

    if (outcome.kind === "resolved") {
      expect(outcome.gate.kind).not.toBe("ready_online");
      expect(outcome.gate.kind).not.toBe("ready_offline");
    } else {
      expect(["correlation_changed", "superseded", "identity_invalidated"]).toContain(outcome.kind);
    }
  });
});

describe("an older result reduced while a NEWER transition is finishing", () => {
  it("cannot open the gate, and cannot overwrite the newer state", async () => {
    // The older operation genuinely earned a ready verdict before being overtaken.
    const older = admittedGoogleReturn();
    seedTrusted(older.storage);
    const olderOutcome = await older.coordinator.startUp();
    expect(olderOutcome.verdict.kind).toBe("ready_online");

    // A NEWER transition is now the one finishing, and the reducer is sitting in
    // its state.
    const newerState = reduceGateState(initialGateState(), {
      type: "progress",
      phase: "finalizing_identity",
      // A NEWER operation: a strictly higher page-lifetime sequence than any the
      // older harness issued.
      transition: { id: "newer-transition", sequence: 99, mode: "foreground" },
    });

    const applied = reduceGateState(newerState, {
      type: "startup_completed",
      callback: olderOutcome.callback,
      verdict: olderOutcome.verdict,
      finalization: olderOutcome.finalization,
      transition: olderOutcome.transition,
    });

    expect(isGateReady(applied)).toBe(false);
    expect(applied).toBe(newerState);
  });

  it("the same result DOES open the gate for the operation that earned it", async () => {
    // The guard is correlation, not refusal: the very same outcome applied to its
    // own progression opens the gate.
    const harness = admittedGoogleReturn();
    seedTrusted(harness.storage);
    const outcome = await harness.coordinator.startUp();
    expect(isGateReady(replayStartup(harness, outcome))).toBe(true);
  });

  it("two consecutive startups issue DIFFERENT correlation identities", async () => {
    const harness = admittedGoogleReturn();
    seedTrusted(harness.storage);
    const first = await harness.coordinator.startUp();
    const second = await harness.coordinator.startUp();
    expect(second.transition.id).not.toBe(first.transition.id);
    expect(second.transition.sequence).toBeGreaterThan(first.transition.sequence);
  });
});

describe("a superseded revalidation", () => {
  it("does not refresh trusted state and reports SUPERSEDED, not a transient failure", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    seedAttempt(harness.storage);
    seedResolution(harness.storage);
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const before = harness.storage.store.get(STORAGE_KEYS.trusted);
    // The newer transition arrives as the trusted record is read for the refresh.
    harness.storage.onBeforeCall = (observed) => {
      if (observed === `get:${STORAGE_KEYS.trusted}`) {
        harness.storage.onBeforeCall = null;
        harness.liveGeneration.bump();
      }
    };

    const outcome = await harness.coordinator.revalidateGateFacts();

    // `superseded` is the honest report: nothing was transient, a newer operation
    // simply took over. It is also non-denial, so the mounted ready session stays.
    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(outcome.transition?.mode).toBe("background");
    expect(harness.storage.store.get(STORAGE_KEYS.trusted)).toBe(before);
  });
});
