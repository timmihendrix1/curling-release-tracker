// OWNERSHIP AT THE EFFECT BOUNDARIES, against a DELAYED injected adapter.
//
// The page-lifetime operation order is only worth what its effect boundaries
// enforce. Ownership is a synchronous fact; every durable mutation is a
// read → decide → write sequence across awaits supplied by an INJECTED adapter.
// Today's `localStorage` adapter resolves promptly. An IndexedDB or network adapter
// will not, and a defective one may resolve arbitrarily late — at which point an
// older operation's check-and-write can interleave with a newer one's, and the
// older write can land LAST.
//
// The mechanism under test is one page-lifetime **effect lane**: every durable
// mutation, and every read that guards one, runs as a section on it, and ownership
// is re-proved INSIDE the section after the lane admits it. Two properties follow,
// and neither depends on microtask timing:
//
//   1. sections never interleave, so write order equals section-entry order;
//   2. an operation that lost ownership while queued performs no read and no write.
//
// Every interleaving below is produced by holding a specific adapter call open
// until the test releases it — never by a timer, and never by relying on how
// promises happen to be scheduled.
import { describe, expect, it } from "vitest";
import {
  BARRIER_A,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  IDENTITY_B,
  PINNED_PRIVACY,
  PINNED_TERMS,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  createIdentityHarness,
  deferred,
  holdStorageCall,
  intentCleanupKey,
  report,
  settleMicrotasks,
  type IdentityHarness,
  type MemoryStorage,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier, type IdentityBarrierOrigin } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createPendingIntent, type PendingIntent } from "../pendingIntentRepository";
import { identityFailed, identityOk, type IdentityResult } from "../errors";
import type { BareProfile, GateFacts } from "../identityService";
import {
  initialGateState,
  isGateReady,
  reduceGateState,
  type GateState,
  type GateVerdict,
  type TransitionIdentity,
} from "../gateState";

const ATTEMPT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const COMPLETED_AT = "2026-02-01T09:00:00.000Z";
const EMAIL = "athlete@example.test";
const INVITE_TOKEN = "opaque-invitation-token-0001";
const PROFILE_B = "cccccccc-2222-4222-8222-cccccccccccc";

function invitation(): PendingIntent {
  const built = createPendingIntent({
    kind: "invitation",
    value: INVITE_TOKEN,
    capturedAt: FIXED_NOW,
  });
  if (built === null) throw new Error("fixture is invalid");
  return built;
}

function onboard(
  harness: IdentityHarness,
  accountScopeId = IDENTITY_A.accountScopeId,
  profileId = PROFILE_A
): void {
  harness.identityBackend.currentAccountScopeId = accountScopeId;
  harness.identityBackend.accounts.set(accountScopeId, {
    profileId,
    displayName: "Athlete",
    onboardingCompletedAt: COMPLETED_AT,
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
  });
}

function seedTrusted(storage: MemoryStorage, accountScopeId = IDENTITY_A.accountScopeId): void {
  storage.seed(
    STORAGE_KEYS.trusted,
    createTrustedDeviceRecord({
      accountScopeId,
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: COMPLETED_AT,
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
      attemptId: ATTEMPT,
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
      attemptId: ATTEMPT,
      method: "google",
      flowId: FLOW_X,
      identityGeneration: 1,
      authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
      resolvedAt: FIXED_NOW,
    })
  );
}

function storedBarrier(storage: MemoryStorage): { barrierId: string; origin: IdentityBarrierOrigin } {
  return JSON.parse(storage.store.get(STORAGE_KEYS.barrier) as string) as {
    barrierId: string;
    origin: IdentityBarrierOrigin;
  };
}

function storedTrusted(storage: MemoryStorage): { accountScopeId: string; profileId: string } | null {
  const raw = storage.store.get(STORAGE_KEYS.trusted);
  return raw === undefined
    ? null
    : (JSON.parse(raw) as { accountScopeId: string; profileId: string });
}

// ---------------------------------------------------------------------------
// A LATE definitive negative belonging to a superseded operation
// ---------------------------------------------------------------------------

describe("a late definitive negative from a SUPERSEDED operation", () => {
  it("cannot invalidate the account a newer operation has since authenticated", async () => {
    // The older operation is a startup resolving account A. Its `ensureProfile` is
    // held open, and will eventually answer `forbidden` — a definitive negative.
    // Only the FIRST call is held, so the newer operation can use the service.
    const gate = deferred<IdentityResult<BareProfile>>();
    const arrived = deferred<void>();
    let calls = 0;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        ensureProfile: async (): Promise<IdentityResult<BareProfile>> => {
          calls += 1;
          if (calls === 1) {
            arrived.resolve();
            return gate.promise;
          }
          return identityOk<BareProfile>({ profileId: PROFILE_B, displayName: "Athlete" });
        },
      },
    });
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const startup = harness.coordinator.startUp();
    await arrived.promise;
    expect(calls).toBe(1);

    // A NEWER deliberate transition authenticates a DIFFERENT account, all the way
    // to a ready gate and a trusted record naming B.
    onboard(harness, IDENTITY_B.accountScopeId, PROFILE_B);
    harness.fakeAuth.state.otpVerify = { ok: true, value: IDENTITY_B };
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
    await harness.coordinator.requestEmailOtp(EMAIL);
    const verified = await harness.coordinator.verifyEmailOtp(EMAIL, "123456");
    expect(verified.kind).toBe("resolved");
    if (verified.kind === "resolved") expect(verified.gate.kind).toBe("ready_online");
    expect(storedTrusted(harness.storage)?.accountScopeId).toBe(IDENTITY_B.accountScopeId);
    const barrierAfterNewer = storedBarrier(harness.storage);

    // NOW the older operation's definitive negative arrives.
    gate.resolve(identityFailed<BareProfile>("forbidden"));
    const outcome = await startup;

    // It denies nothing. Account B keeps its trusted record, the barrier is still
    // the one B resolved, and no invalidation was even announced.
    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(outcome.finalization?.kind).toBe("superseded");
    expect(storedTrusted(harness.storage)?.accountScopeId).toBe(IDENTITY_B.accountScopeId);
    expect(storedBarrier(harness.storage)).toEqual(barrierAfterNewer);
    expect(harness.progress).not.toContain("identity_denied_in_memory");
    expect(harness.storage.calls).not.toContain(`remove:${STORAGE_KEYS.trusted}`);
  });

  it("a superseded background revalidation reports supersession and revokes nothing", async () => {
    const gate = deferred<IdentityResult<GateFacts>>();
    const arrived = deferred<void>();
    let calls = 0;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        resolveGateFacts: async (): Promise<IdentityResult<GateFacts>> => {
          calls += 1;
          if (calls === 1) {
            arrived.resolve();
            return gate.promise;
          }
          return identityFailed<GateFacts>("network_error");
        },
      },
    });
    seedTrusted(harness.storage);
    seedCorrelatedSet(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const trustedBefore = harness.storage.store.get(STORAGE_KEYS.trusted);
    const intentBefore = harness.storage.store.get(STORAGE_KEYS.intent);

    const revalidation = harness.coordinator.revalidateGateFacts();
    await arrived.promise;
    expect(calls).toBe(1);

    // A newer deliberate transition takes over.
    const signedOut = await harness.coordinator.signOut();
    expect(report(signedOut)).toEqual({ kind: "signed_out_locked" });

    gate.resolve(identityFailed<GateFacts>("forbidden"));
    const outcome = await revalidation;

    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(outcome.denial).toBeUndefined();
    expect(outcome.transition?.mode).toBe("background");
    // The sign-out's own effects stand; the revalidation added none of its own.
    expect(storedBarrier(harness.storage).origin).toBe("explicit_sign_out");
    expect(harness.storage.store.get(STORAGE_KEYS.trusted)).not.toBe(trustedBefore);
    expect(intentBefore).toBeDefined();
    expect(harness.storage.store.has(intentCleanupKey)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Two overlapping barrier-establishing operations
// ---------------------------------------------------------------------------

describe("two overlapping barrier-establishing operations", () => {
  it("cannot let the OLDER barrier be the one left in storage", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    // The older operation's barrier WRITE is held open by a delayed adapter.
    const held = holdStorageCall(harness.storage, `set:${STORAGE_KEYS.barrier}`);

    const older = harness.coordinator.requestEmailOtp(EMAIL);
    await held.reached;

    // The newer operation starts while the older write is still in flight. Its own
    // barrier section queues BEHIND the older one on the lane, so its write cannot
    // be overtaken.
    const newer = harness.coordinator.signOut();
    await settleMicrotasks();

    held.release();
    const olderOutcome = await older;
    const newerOutcome = await newer;

    // The newer operation's barrier is the one in force.
    expect(storedBarrier(harness.storage).origin).toBe("explicit_sign_out");
    expect(report(newerOutcome)).toEqual({ kind: "signed_out_locked" });
    // The older operation stopped at its next step rather than persisting an attempt
    // against a barrier that is no longer current.
    expect(report(olderOutcome)).toEqual({ kind: "superseded" });
    expect(harness.storage.store.has(STORAGE_KEYS.attempt)).toBe(false);
    expect(harness.fakeAuth.counts.otpRequest).toBe(0);
  });

  it("an operation superseded BEFORE its barrier section is admitted writes no barrier at all", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    // Hold the trusted-record READ that `signOut` performs before its barrier, so
    // the sign-out is suspended with no section held.
    const held = holdStorageCall(harness.storage, `get:${STORAGE_KEYS.trusted}`);
    const older = harness.coordinator.signOut();
    await held.reached;

    // A newer operation claims ownership synchronously.
    const newer = harness.coordinator.requestEmailOtp(EMAIL);
    held.release();

    const olderOutcome = await older;
    const newerOutcome = await newer;

    expect(report(olderOutcome)).toEqual({ kind: "superseded" });
    expect(report(newerOutcome)).toEqual({ kind: "otp_requested" });
    // Exactly ONE barrier was written, by the newer operation, and the sign-out
    // mutated nothing.
    expect(
      harness.storage.calls.filter((call) => call === `set:${STORAGE_KEYS.barrier}`)
    ).toHaveLength(1);
    expect(storedBarrier(harness.storage).origin).toBe("interactive_authentication");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Supersession during an awaited checkpoint or repository mutation
// ---------------------------------------------------------------------------

describe("supersession during an awaited checkpoint", () => {
  it("stops an OTP verification that had already passed its earlier proofs", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    await harness.coordinator.requestEmailOtp(EMAIL);

    // Hold the barrier read inside C6 — the checkpoint that follows verification.
    // C5's reads have already happened by then, so this is precisely "supersession
    // during an awaited checkpoint".
    const held = holdStorageCall(harness.storage, `get:${STORAGE_KEYS.barrier}`, 2);
    const verification = harness.coordinator.verifyEmailOtp(EMAIL, "123456");
    await held.reached;

    // `beginTransition` is synchronous, so a newer operation takes ownership even
    // though the lane is held.
    const newer = harness.coordinator.revalidateGateFacts();
    held.release();

    const outcome = await verification;
    await newer;

    expect(report(outcome)).toEqual({ kind: "superseded" });
    // No resolution was persisted for the barrier it was completing.
    const barrierId = storedBarrier(harness.storage).barrierId;
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(barrierId))).toBe(false);
  });
});

describe("supersession during an awaited repository mutation", () => {
  it("does not remove a malformed trusted snapshot after a newer operation takes ownership", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.store.set(STORAGE_KEYS.trusted, "{malformed");
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const held = holdStorageCall(harness.storage, `get:${STORAGE_KEYS.trusted}`);

    const startup = harness.coordinator.startUp();
    await held.reached;
    const newer = harness.coordinator.requestEmailOtp(EMAIL);
    held.release();

    await startup;
    expect(report(await newer)).toEqual({ kind: "otp_requested" });
    expect(harness.storage.calls).not.toContain(`remove:${STORAGE_KEYS.trusted}`);
  });

  it("a resolution that lands after ownership loss is durably fenced before reload", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness);
    harness.fakeAuth.state.otpVerify = { ok: true, value: IDENTITY_A };
    await harness.coordinator.requestEmailOtp(EMAIL);
    const barrierId = storedBarrier(harness.storage).barrierId;

    const held = holdStorageCall(
      harness.storage,
      `set:${STORAGE_KEYS.resolutionFor(barrierId)}`
    );
    const verification = harness.coordinator.verifyEmailOtp(EMAIL, "123456");
    await held.reached;

    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const newer = harness.coordinator.revalidateGateFacts();
    held.release();

    const outcome = await verification;
    await newer;
    expect(report(outcome)).toEqual({ kind: "correlation_changed" });
    expect(storedBarrier(harness.storage).origin).toBe("unconfirmed_grant_fence");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);

    const reload = createIdentityHarness({ storage: harness.storage, url: REDIRECT_TARGET });
    reload.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const restarted = await reload.coordinator.startUp();
    expect(restarted.verdict.kind).not.toBe("ready_offline");
    expect(isGateReady(replay(reload, restarted.verdict, restarted.transition))).toBe(false);
  });

  it("fences a written resolution whose C7 confirmation cannot be read", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness);
    harness.fakeAuth.state.otpVerify = { ok: true, value: IDENTITY_A };
    await harness.coordinator.requestEmailOtp(EMAIL);
    const barrierId = storedBarrier(harness.storage).barrierId;
    harness.storage.failReads.add(STORAGE_KEYS.resolutionFor(barrierId));

    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, "123456");

    expect(report(outcome)).toEqual({ kind: "correlation_changed" });
    expect(storedBarrier(harness.storage).origin).toBe("unconfirmed_grant_fence");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a trusted write that lands after ownership loss cannot reopen offline on reload", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness);
    harness.fakeAuth.state.otpVerify = { ok: true, value: IDENTITY_A };
    await harness.coordinator.requestEmailOtp(EMAIL);

    const held = holdStorageCall(harness.storage, `set:${STORAGE_KEYS.trusted}`);
    const verification = harness.coordinator.verifyEmailOtp(EMAIL, "123456");
    await held.reached;

    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const newer = harness.coordinator.revalidateGateFacts();
    held.release();

    const outcome = await verification;
    await newer;
    expect(outcome.kind).toBe("resolved");
    if (outcome.kind === "resolved") expect(outcome.gate.kind).toBe("identity_unconfirmed");
    expect(storedBarrier(harness.storage).origin).toBe("unconfirmed_grant_fence");

    const reload = createIdentityHarness({ storage: harness.storage, url: REDIRECT_TARGET });
    reload.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const restarted = await reload.coordinator.startUp();
    expect(restarted.verdict.kind).not.toBe("ready_offline");
    expect(isGateReady(replay(reload, restarted.verdict, restarted.transition))).toBe(false);
  });

  it("no stale TRUSTED record is written when ownership is lost before the write section", async () => {
    const gate = deferred<IdentityResult<GateFacts>>();
    const arrived = deferred<void>();
    let calls = 0;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        resolveGateFacts: async (): Promise<IdentityResult<GateFacts>> => {
          calls += 1;
          if (calls === 1) {
            arrived.resolve();
            return gate.promise;
          }
          return identityFailed<GateFacts>("network_error");
        },
      },
    });
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const startup = harness.coordinator.startUp();
    // Awaited, not counted: the startup is genuinely suspended inside the held
    // dependency by the time this resolves.
    await arrived.promise;
    expect(calls).toBe(1);

    const newer = harness.coordinator.requestEmailOtp(EMAIL);
    await settleMicrotasks();

    gate.resolve(
      identityOk<GateFacts>({
        profileId: PROFILE_A,
        displayName: "Athlete",
        onboardingCompletedAt: COMPLETED_AT,
        hasAthleteCapability: true,
        freeEntitlementActive: true,
        pinnedTerms: PINNED_TERMS,
        pinnedPrivacy: PINNED_PRIVACY,
        currentTermsDocumentId: null,
        currentTermsVersionLabel: null,
        currentPrivacyDocumentId: null,
        currentPrivacyVersionLabel: null,
      })
    );
    const outcome = await startup;
    await newer;

    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.trusted}`);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    expect(isGateReady(replay(harness, outcome.verdict, outcome.transition))).toBe(false);
  });

  it("no stale INTENT mutation happens when ownership is lost before the settlement", async () => {
    const gate = deferred<IdentityResult<GateFacts>>();
    const arrived = deferred<void>();
    let calls = 0;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        resolveGateFacts: async (): Promise<IdentityResult<GateFacts>> => {
          calls += 1;
          if (calls === 1) {
            arrived.resolve();
            return gate.promise;
          }
          return identityFailed<GateFacts>("network_error");
        },
      },
    });
    // A recovery-marked invitation: the settlement would rewrite it to `ordinary`.
    const marked = createPendingIntent({
      kind: "invitation",
      value: INVITE_TOKEN,
      capturedAt: FIXED_NOW,
      survival: "invitation_account_recovery",
    });
    if (marked === null) throw new Error("fixture is invalid");
    harness.storage.seed(STORAGE_KEYS.intent, marked);
    const intentBefore = harness.storage.store.get(STORAGE_KEYS.intent);
    seedTrusted(harness.storage);
    seedCorrelatedSet(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const revalidation = harness.coordinator.revalidateGateFacts();
    await arrived.promise;
    expect(calls).toBe(1);

    const newer = harness.coordinator.requestEmailOtp(EMAIL);
    await settleMicrotasks();

    gate.resolve(
      identityOk<GateFacts>({
        profileId: PROFILE_A,
        displayName: "Athlete",
        onboardingCompletedAt: COMPLETED_AT,
        hasAthleteCapability: true,
        freeEntitlementActive: true,
        pinnedTerms: PINNED_TERMS,
        pinnedPrivacy: PINNED_PRIVACY,
        currentTermsDocumentId: null,
        currentTermsVersionLabel: null,
        currentPrivacyDocumentId: null,
        currentPrivacyVersionLabel: null,
      })
    );
    await revalidation;
    await newer;

    // The newer operation's intent state is untouched by the older one.
    expect(harness.storage.store.get(STORAGE_KEYS.intent)).toBe(intentBefore);
  });
});

/** Replays a startup verdict through the reducer, tagged with its own operation. */
function replay(
  harness: IdentityHarness,
  verdict: GateVerdict,
  transition: TransitionIdentity
): GateState {
  let state: GateState = initialGateState();
  for (const [phase, announced] of harness.progressEvents) {
    state = reduceGateState(state, { type: "progress", phase, transition: announced });
  }
  return reduceGateState(state, {
    type: "startup_completed",
    callback: { kind: "no_return" },
    verdict,
    transition,
  });
}

// ---------------------------------------------------------------------------
// An already-durable denial stays deny-ward
// ---------------------------------------------------------------------------

describe("a denial that has already begun", () => {
  it("runs to completion even though a newer operation started mid-transition", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    // Hold the trusted REMOVAL, which is step 3 of the invalidation — after the
    // in-memory denial and after the durable barrier.
    const held = holdStorageCall(harness.storage, `remove:${STORAGE_KEYS.trusted}`);
    const invalidation = harness.coordinator.invalidateIdentity();
    await held.reached;
    expect(harness.progress).toContain("identity_denied_in_memory");
    expect(storedBarrier(harness.storage).origin).toBe("server_identity_invalidated");

    // A newer operation claims ownership while the denial is mid-flight.
    const newer = harness.coordinator.requestEmailOtp(EMAIL);
    held.release();

    const outcome = await invalidation;
    await newer;

    // The denial FINISHED: abandoning it halfway would leave a partially applied
    // revocation, which is the one thing worse than completing it.
    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(outcome.outstanding).toEqual([]);
    expect(outcome.denial).toBe("server_identity_invalidated");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    expect(harness.storage.store.has(STORAGE_KEYS.intent)).toBe(false);
  });

  it("a completed sign-out stays deny-ward when its report is reduced late", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const signedOut = await harness.coordinator.signOut();
    expect(report(signedOut)).toEqual({ kind: "signed_out_locked" });

    // A much newer operation has since tagged the reducer, and a ready gate is
    // showing. The already-durable denial must still lock.
    let state: GateState = {
      kind: "ready_online",
      session: {
        accountScopeId: IDENTITY_A.accountScopeId,
        email: IDENTITY_A.email,
        profileId: PROFILE_A,
        displayName: "Athlete",
        entitlement: "free",
      },
      transition: { id: "much-newer", sequence: 999, mode: "foreground" },
      acceptedSequence: 999,
    };
    state = reduceGateState(state, { type: "transition_settled", outcome: signedOut });

    expect(state.kind).toBe("locked");
    expect(isGateReady(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// No stale operation announces authoritative progress
// ---------------------------------------------------------------------------

describe("progress announcements after supersession", () => {
  it("a superseded operation announces nothing further, even with a delayed adapter", async () => {
    const gate = deferred<IdentityResult<BareProfile>>();
    const profileReadStarted = deferred<void>();
    let calls = 0;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        ensureProfile: async (): Promise<IdentityResult<BareProfile>> => {
          calls += 1;
          if (calls === 1) {
            profileReadStarted.resolve();
            return gate.promise;
          }
          return identityOk<BareProfile>({ profileId: PROFILE_A, displayName: "Athlete" });
        },
      },
    });
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const startup = harness.coordinator.startUp();
    await profileReadStarted.promise;
    const startupId = harness.progressEvents.find(([phase]) => phase === "ensuring_profile")?.[1]?.id;
    expect(startupId).toBeDefined();
    const announcedByStartup = (): number =>
      harness.progressEvents.filter(([, transition]) => transition?.id === startupId).length;
    const before = announcedByStartup();

    const newer = harness.coordinator.requestEmailOtp(EMAIL);
    await settleMicrotasks();

    // Everything the startup could still have announced — `resolving_gate_facts`,
    // `establishing_trusted_state` — happens now.
    gate.resolve(identityOk<BareProfile>({ profileId: PROFILE_A, displayName: "Athlete" }));
    await startup;
    await newer;

    expect(announcedByStartup()).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The complete invalidation residue
// ---------------------------------------------------------------------------

describe("simultaneous invalidation failures", () => {
  it("reports BOTH a retained trusted record and a failed intent deletion", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.startUp();
    const finalization = outcome.finalization;

    expect(finalization).not.toBeNull();
    // The COMPLETE fact: neither failure is discarded in favour of the other.
    expect(finalization?.outstanding).toEqual(["trusted_state", "pending_intent"]);
    // The primary label is derived, and is the trusted-record one — the record is
    // what could still be honoured.
    expect(finalization?.kind).toBe("trusted_state_not_invalidated");
    expect(finalization?.denial).toBe("server_identity_invalidated");
    // The debt is durable even though the deletion failed.
    expect(harness.storage.store.has(intentCleanupKey)).toBe(true);
  });

  it("reports an unrecordable debt as its own outstanding fact", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "invalid_session" };
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);
    harness.storage.failWrites.add(intentCleanupKey);

    const outcome = await harness.coordinator.startUp();
    const finalization = outcome.finalization;

    expect(finalization?.outstanding).toEqual(["pending_intent", "outstanding_cleanup_record"]);
    expect(finalization?.kind).toBe("intent_state_not_persisted");
    expect(finalization?.denial).toBe("server_identity_invalidated");
    // Nothing durable claims the debt, and nothing pretends otherwise.
    expect(harness.storage.store.has(intentCleanupKey)).toBe(false);
  });

  it("a barrier failure alone is recorded but does not lower the primary label", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.startUp();

    // The barrier failure IS reported...
    expect(outcome.finalization?.outstanding).toEqual(["durable_barrier"]);
    // ...but removal succeeded, so a durable denial does exist.
    expect(outcome.finalization?.kind).toBe("identity_invalidated");
    expect(outcome.finalization?.denial).toBe("server_identity_invalidated");
  });

  it("both durable mechanisms failing claims no revocation, and still lists every fact", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);
    harness.storage.failWrites.add(intentCleanupKey);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.finalization?.outstanding).toEqual([
      "durable_barrier",
      "trusted_state",
      "pending_intent",
      "outstanding_cleanup_record",
    ]);
    expect(outcome.finalization?.kind).toBe("durable_denial_unavailable");
    expect(outcome.finalization?.denial).toBe("durable_denial_unavailable");
    expect(outcome.verdict).toEqual({ kind: "storage_unavailable_locked" });
  });
});

// ---------------------------------------------------------------------------
// The debt across a reload and an offline continuation
// ---------------------------------------------------------------------------

describe("the denial debt across page loads", () => {
  it("survives a reload, blocks an offline continuation, and is discharged once storage recovers", async () => {
    const storage = createIdentityHarness({ url: REDIRECT_TARGET }).storage;

    // Page one: a definitive denial cannot delete the intent, so it records the debt.
    const first = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    storage.seed(STORAGE_KEYS.intent, invitation());
    seedTrusted(storage);
    onboard(first);
    first.fakeAuth.state.restore = { kind: "no_session" };
    storage.failRemoves.add(STORAGE_KEYS.intent);
    await first.coordinator.startUp();
    expect(storage.store.has(intentCleanupKey)).toBe(true);

    // Page two, OFFLINE, with a complete correlation set and a valid record — the
    // one path to `ready_offline`. The debt blocks it.
    const offline = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    seedCorrelatedSet(storage);
    seedTrusted(storage);
    offline.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const offlineOutcome = await offline.coordinator.startUp();
    expect(offlineOutcome.verdict).toEqual({ kind: "intent_state_not_persisted" });

    // Page three: storage recovers and the debt is discharged, and only then does
    // the gate open.
    storage.failRemoves.delete(STORAGE_KEYS.intent);
    const recovered = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    seedCorrelatedSet(storage);
    seedTrusted(storage);
    recovered.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const recoveredOutcome = await recovered.coordinator.startUp();

    expect(recoveredOutcome.verdict.kind).toBe("ready_offline");
    expect(storage.store.has(STORAGE_KEYS.intent)).toBe(false);
    expect(storage.store.has(intentCleanupKey)).toBe(false);
  });
});
