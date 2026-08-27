// PAGE-LIFETIME OPERATION OWNERSHIP — the ordering the durable protocol cannot
// provide (ADR-0025 §8, §9).
//
// The barrier/attempt/resolution protocol orders operations that differ durably,
// and the live generation orders operations separated by a barrier establishment.
// Neither can order two operations that share the SAME barrier, the SAME attempt
// and the SAME live generation — two concurrent verifications of one OTP attempt,
// a retry overlapping a background revalidation, a second startup. Every
// checkpoint passes for both simultaneously.
//
// So the coordinator also keeps an explicit page-lifetime ORDER: starting a newer
// applicable operation supersedes the older one immediately. An operation that no
// longer owns the slot must not
//
//   * announce an authoritative progress phase,
//   * write or replace trusted state,
//   * mutate intent state,
//   * return ready, or
//   * re-tag the reducer if its report is applied late.
//
// Every interleaving below is deterministic. The overlap comes from a DEFERRED
// provider call — the second operation starts while the first is genuinely
// suspended inside `verifyEmailOtp` — never from a timer, and the reducer is fed
// the real progress and settling events in the real order they were produced.
import { describe, expect, it } from "vitest";
import {
  BARRIER_A,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  PINNED_PRIVACY,
  PINNED_TERMS,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  authError,
  createIdentityHarness,
  deferred,
  report,
  settleMicrotasks,
  type Deferred,
  type IdentityHarness,
  type MemoryStorage,
} from "./support/identityTestHarness";
import { authOk, type AccountIdentity, type AuthServiceResult } from "../../supabase/authService";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import { createPendingIntent } from "../pendingIntentRepository";
import {
  initialGateState,
  isGateReady,
  reduceGateState,
  type GateEvent,
  type GateState,
  type IdentityTransitionOutcome,
} from "../gateState";

const EMAIL = "athlete@example.test";

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

function seedTrusted(storage: MemoryStorage): void {
  storage.seed(
    STORAGE_KEYS.trusted,
    createTrustedDeviceRecord({
      accountScopeId: IDENTITY_A.accountScopeId,
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      generation: 1,
      establishedAt: FIXED_NOW,
      lastServerConfirmationAt: FIXED_NOW,
    })
  );
}

function seedCorrelatedSet(storage: MemoryStorage): void {
  storage.seed(
    STORAGE_KEYS.barrier,
    createIdentityAccessBarrier({
      barrierId: BARRIER_A,
      origin: "interactive_authentication",
      barredAccountScopeId: null,
      barredGeneration: null,
      establishedAt: FIXED_NOW,
    })
  );
  storage.seed(
    STORAGE_KEYS.attempt,
    createGoogleAttempt({
      attemptId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      flowId: FLOW_X,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 1,
      startedAt: FIXED_NOW,
    })
  );
  storage.seed(
    STORAGE_KEYS.resolutionFor(BARRIER_A),
    createIdentityBarrierResolution({
      barrierId: BARRIER_A,
      attemptId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      method: "google",
      flowId: FLOW_X,
      identityGeneration: 1,
      authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
      resolvedAt: FIXED_NOW,
    })
  );
}

/**
 * A harness whose `verifyEmailOtp` suspends until the returned deferred is
 * resolved, so a second verification can genuinely start while the first is
 * in flight.
 */
function harnessWithHeldVerification(): {
  harness: IdentityHarness;
  gates: Array<Deferred<AuthServiceResult<AccountIdentity>>>;
} {
  const gates: Array<Deferred<AuthServiceResult<AccountIdentity>>> = [];
  const harness = createIdentityHarness({
    url: REDIRECT_TARGET,
    authOverrides: {
      async verifyEmailOtp(): Promise<AuthServiceResult<AccountIdentity>> {
        const gate = deferred<AuthServiceResult<AccountIdentity>>();
        gates.push(gate);
        return gate.promise;
      },
    },
  });
  onboard(harness);
  harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
  return { harness, gates };
}

/** Replays the coordinator's real progress events, in order, through the reducer. */
function replayProgress(harness: IdentityHarness, from = initialGateState()): GateState {
  let state = from;
  for (const [phase, transition] of harness.progressEvents) {
    state = reduceGateState(state, { type: "progress", phase, transition });
  }
  return state;
}

function settled(outcome: IdentityTransitionOutcome): GateEvent {
  return { type: "transition_settled", outcome };
}

describe("two concurrent OTP verifications of the SAME barrier and attempt", () => {
  it("share every durable fact, and only the NEWER one may write trusted state or return ready", async () => {
    const { harness, gates } = harnessWithHeldVerification();
    await harness.coordinator.requestEmailOtp(EMAIL);
    const barrierBefore = harness.storage.store.get(STORAGE_KEYS.barrier);
    const attemptBefore = harness.storage.store.get(STORAGE_KEYS.attempt);
    const generationBefore = harness.liveGeneration.current();

    // The FIRST verification suspends inside the provider call.
    const first = harness.coordinator.verifyEmailOtp(EMAIL, "111111");
    await settleMicrotasks();
    expect(gates).toHaveLength(1);

    // The SECOND starts while the first is still in flight. Nothing durable has
    // changed — same barrier, same attempt, same live generation — so the durable
    // protocol alone could not tell these two apart.
    const second = harness.coordinator.verifyEmailOtp(EMAIL, "222222");
    await settleMicrotasks();
    expect(gates).toHaveLength(2);
    expect(harness.storage.store.get(STORAGE_KEYS.barrier)).toBe(barrierBefore);
    expect(harness.storage.store.get(STORAGE_KEYS.attempt)).toBe(attemptBefore);
    expect(harness.liveGeneration.current()).toBe(generationBefore);

    // The older one settles LAST, which is the dangerous ordering.
    gates[1].resolve(authOk(IDENTITY_A));
    const secondOutcome = await second;
    gates[0].resolve(authOk(IDENTITY_A));
    const firstOutcome = await first;

    expect(secondOutcome.kind).toBe("resolved");
    if (secondOutcome.kind === "resolved") {
      expect(secondOutcome.gate.kind).toBe("ready_online");
    }
    // The overtaken one returns a deny-ward outcome — never `resolved`.
    expect(report(firstOutcome)).toEqual({ kind: "superseded" });
  });

  it("the overtaken verification writes NO trusted record of its own", async () => {
    const { harness, gates } = harnessWithHeldVerification();
    await harness.coordinator.requestEmailOtp(EMAIL);

    const first = harness.coordinator.verifyEmailOtp(EMAIL, "111111");
    await settleMicrotasks();
    const second = harness.coordinator.verifyEmailOtp(EMAIL, "222222");
    await settleMicrotasks();

    // Only the newer one is allowed to complete at all: resolve it and let the
    // older one fail, so any trusted write observed below could only be its.
    gates[1].resolve(authOk(IDENTITY_A));
    await second;
    const trustedWritesAfterNewer = harness.storage.calls.filter(
      (call) => call === `set:${STORAGE_KEYS.trusted}`
    ).length;

    gates[0].resolve(authOk(IDENTITY_A));
    await first;

    expect(
      harness.storage.calls.filter((call) => call === `set:${STORAGE_KEYS.trusted}`).length
    ).toBe(trustedWritesAfterNewer);
  });

  it("the overtaken verification announces NO further progress phase", async () => {
    const { harness, gates } = harnessWithHeldVerification();
    await harness.coordinator.requestEmailOtp(EMAIL);

    const first = harness.coordinator.verifyEmailOtp(EMAIL, "111111");
    await settleMicrotasks();
    const second = harness.coordinator.verifyEmailOtp(EMAIL, "222222");
    await settleMicrotasks();

    const olderId = harness.progressEvents.find(([phase]) => phase === "verifying_otp")?.[1]?.id;
    expect(olderId).toBeDefined();
    const announcedByOlder = (): number =>
      harness.progressEvents.filter(([, transition]) => transition?.id === olderId).length;
    // Exactly one: the phase it announced before it was overtaken.
    expect(announcedByOlder()).toBe(1);

    gates[1].resolve(authOk(IDENTITY_A));
    await second;
    // Everything the OLDER operation could still have announced happens now:
    // `finalizing_identity`, `ensuring_profile`, `establishing_trusted_state`.
    gates[0].resolve(authOk(IDENTITY_A));
    await first;

    expect(announcedByOlder()).toBe(1);
  });
});

describe("an OLDER operation emitting progress AFTER the newer one started", () => {
  it("cannot re-tag the reducer, and cannot take a ready gate out of ready", () => {
    // Two operations in page-lifetime order. The older one announces a phase after
    // the newer one has already announced its own and settled into ready.
    const older = { id: "older", sequence: 4, mode: "foreground" } as const;
    const newer = { id: "newer", sequence: 5, mode: "foreground" } as const;

    let state = reduceGateState(initialGateState(), {
      type: "progress",
      phase: "ensuring_profile",
      transition: older,
    });
    state = reduceGateState(state, {
      type: "progress",
      phase: "establishing_trusted_state",
      transition: newer,
    });
    const ready = reduceGateState(state, {
      type: "startup_completed",
      callback: { kind: "no_return" },
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
      transition: newer,
    });
    expect(isGateReady(ready)).toBe(true);

    // The older operation's late progress event.
    const afterStaleProgress = reduceGateState(ready, {
      type: "progress",
      phase: "resolving_gate_facts",
      transition: older,
    });
    expect(afterStaleProgress).toBe(ready);
    expect(isGateReady(afterStaleProgress)).toBe(true);
  });

  it("cannot make the gate accept the older operation's own later ready result", () => {
    const older = { id: "older", sequence: 1, mode: "foreground" } as const;
    const newer = { id: "newer", sequence: 2, mode: "foreground" } as const;
    const readyVerdict = {
      kind: "ready_online",
      session: {
        accountScopeId: IDENTITY_A.accountScopeId,
        email: IDENTITY_A.email,
        profileId: PROFILE_A,
        displayName: "Athlete",
        entitlement: "free",
      },
    } as const;

    const newerState = reduceGateState(initialGateState(), {
      type: "progress",
      phase: "finalizing_identity",
      transition: newer,
    });
    // The older operation announces its phase late — the hazard this closes is
    // that it would otherwise re-tag the state with its OWN id, after which its
    // own ready result would satisfy the correlation proof.
    const afterStale = reduceGateState(newerState, {
      type: "progress",
      phase: "finalizing_identity",
      transition: older,
    });
    expect(afterStale).toBe(newerState);

    const applied = reduceGateState(afterStale, {
      type: "transition_settled",
      outcome: {
        kind: "resolved",
        identity: IDENTITY_A,
        gate: readyVerdict,
        transition: older,
      },
    });
    expect(isGateReady(applied)).toBe(false);
    expect(applied).toBe(newerState);
  });
});

describe("the newer operation settling FIRST and the older settling LATER", () => {
  it("leaves the newer operation's result standing, replayed in the real order", async () => {
    const { harness, gates } = harnessWithHeldVerification();
    seedTrusted(harness.storage);
    await harness.coordinator.requestEmailOtp(EMAIL);

    const first = harness.coordinator.verifyEmailOtp(EMAIL, "111111");
    await settleMicrotasks();
    const second = harness.coordinator.verifyEmailOtp(EMAIL, "222222");
    await settleMicrotasks();

    gates[1].resolve(authOk(IDENTITY_A));
    const newerOutcome = await second;
    gates[0].resolve(authOk(IDENTITY_A));
    const olderOutcome = await first;

    // Replay EXACTLY what the provider layer would dispatch, in the order it was
    // produced: every progress phase, then the newer result, then the older one.
    let state = replayProgress(harness);
    state = reduceGateState(state, settled(newerOutcome));
    expect(isGateReady(state), "the newer operation opens the gate").toBe(true);
    const opened = state;

    state = reduceGateState(state, settled(olderOutcome));
    expect(state, "the older result changes nothing").toBe(opened);
    expect(isGateReady(state)).toBe(true);
  });

  it("a stale FAILURE cannot knock the gate out of the state the newer one earned", async () => {
    const { harness, gates } = harnessWithHeldVerification();
    seedTrusted(harness.storage);
    await harness.coordinator.requestEmailOtp(EMAIL);

    const first = harness.coordinator.verifyEmailOtp(EMAIL, "111111");
    await settleMicrotasks();
    const second = harness.coordinator.verifyEmailOtp(EMAIL, "222222");
    await settleMicrotasks();

    gates[1].resolve(authOk(IDENTITY_A));
    const newerOutcome = await second;
    // The older operation's provider call fails — a transient error arriving late.
    gates[0].resolve(authError("temporarily_unavailable"));
    const olderOutcome = await first;
    expect(report(olderOutcome)).toEqual({ kind: "temporarily_unavailable" });

    let state = replayProgress(harness);
    state = reduceGateState(state, settled(newerOutcome));
    expect(isGateReady(state)).toBe(true);
    const opened = state;

    state = reduceGateState(state, settled(olderOutcome));
    expect(state).toBe(opened);
    expect(isGateReady(state)).toBe(true);
  });
});

describe("an overlapping retry and background revalidation", () => {
  it("the operation that started LAST is the only one that may refresh trusted state", async () => {
    const gates: Array<Deferred<void>> = [];
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    seedCorrelatedSet(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    // Hold the revalidation open inside its trusted-record read.
    harness.storage.onBeforeCall = async (call) => {
      if (call === `get:${STORAGE_KEYS.trusted}` && gates.length === 0) {
        const gate = deferred<void>();
        gates.push(gate);
        harness.storage.onBeforeCall = null;
        await gate.promise;
      }
    };

    const revalidation = harness.coordinator.revalidateGateFacts();
    await settleMicrotasks();
    expect(gates).toHaveLength(1);

    // A retry — a FOREGROUND operation — starts and takes ownership.
    const retry = harness.coordinator.retryTrustedStateEstablishment();
    await settleMicrotasks();

    gates[0].resolve();
    const revalidationOutcome = await revalidation;
    const retryOutcome = await retry;

    // The revalidation is superseded and reports it as such: not a transient
    // failure, and not a denial.
    expect(report(revalidationOutcome)).toEqual({ kind: "superseded" });
    expect(revalidationOutcome.transition?.mode).toBe("background");
    expect(retryOutcome.kind).toBe("resolved");
  });

  it("a background revalidation started LAST supersedes an in-flight retry", async () => {
    const gates: Array<Deferred<void>> = [];
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    seedCorrelatedSet(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    harness.storage.onBeforeCall = async (call) => {
      if (call === `get:${STORAGE_KEYS.trusted}` && gates.length === 0) {
        const gate = deferred<void>();
        gates.push(gate);
        harness.storage.onBeforeCall = null;
        await gate.promise;
      }
    };

    const retry = harness.coordinator.retryTrustedStateEstablishment();
    await settleMicrotasks();
    expect(gates).toHaveLength(1);

    const revalidation = harness.coordinator.revalidateGateFacts();
    await settleMicrotasks();

    gates[0].resolve();
    const retryOutcome = await retry;
    await revalidation;

    // The retry is deny-ward: it does not return ready after being overtaken.
    if (retryOutcome.kind === "resolved") {
      expect(retryOutcome.gate.kind).not.toBe("ready_online");
      expect(retryOutcome.gate.kind).not.toBe("ready_offline");
    } else {
      expect(["temporarily_unavailable", "superseded", "identity_invalidated"]).toContain(
        retryOutcome.kind
      );
    }
  });
});

describe("ownership is claimed by the operations that can change access, and only those", () => {
  it("Legal refresh and pending-intent mutations never supersede an in-flight sign-in", async () => {
    const { harness, gates } = harnessWithHeldVerification();
    seedTrusted(harness.storage);
    await harness.coordinator.requestEmailOtp(EMAIL);

    const verification = harness.coordinator.verifyEmailOtp(EMAIL, "111111");
    await settleMicrotasks();

    // Neither of these can change access, so neither may take the slot.
    await harness.coordinator.refreshLegalSnapshot();
    await harness.coordinator.discardPendingIntent();
    const pendingIntent = createPendingIntent({
      kind: "invitation",
      value: "opaque-invitation-token-0001",
      capturedAt: FIXED_NOW,
    });
    if (pendingIntent === null) throw new Error("fixture is invalid");
    await harness.coordinator.capturePendingIntent(pendingIntent);

    gates[0].resolve(authOk(IDENTITY_A));
    const outcome = await verification;

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind === "resolved") expect(outcome.gate.kind).toBe("ready_online");
  });

  it("every ordered operation issues a strictly increasing sequence", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const startup = await harness.coordinator.startUp();
    const otp = await harness.coordinator.requestEmailOtp(EMAIL);
    const signedOut = await harness.coordinator.signOut();

    const sequences = [
      startup.transition.sequence,
      otp.transition?.sequence,
      signedOut.transition?.sequence,
    ];
    expect(sequences.every((value) => typeof value === "number")).toBe(true);
    for (let index = 1; index < sequences.length; index += 1) {
      expect(sequences[index] as number).toBeGreaterThan(sequences[index - 1] as number);
    }
  });
});

describe("a denial is never suppressed as stale", () => {
  it("an overtaken sign-out still locks the gate, because its barrier is already durable", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const signedOut = await harness.coordinator.signOut();
    expect(report(signedOut)).toEqual({ kind: "signed_out_locked" });

    // A NEWER operation has since tagged the reducer.
    const newerState = reduceGateState(initialGateState(), {
      type: "progress",
      phase: "verifying_otp",
      transition: { id: "much-newer", sequence: 999, mode: "foreground" },
    });

    // The sign-out's report arrives after it. Suppressing it would leave the gate
    // showing a sign-in in progress while a durable barrier denies access.
    const applied = reduceGateState(newerState, settled(signedOut));
    expect(applied.kind).toBe("locked");
    expect(isGateReady(applied)).toBe(false);
  });
});
