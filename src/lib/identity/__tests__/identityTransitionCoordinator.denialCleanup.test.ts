// EXACT INVALIDATION OUTCOMES, AND THE CLEANUP A DENIAL STILL OWES (ADR-0025 §14,
// §22).
//
// A server-driven invalidation has four possible results, and they are NOT
// interchangeable:
//
//   * `identity_invalidated`            — every required step completed;
//   * `trusted_state_not_invalidated`   — the barrier denies, the record remains;
//   * `intent_state_not_persisted`      — the required intent deletion failed;
//   * `durable_denial_unavailable`      — BOTH durable mechanisms failed.
//
// Flattening the middle two into `identity_invalidated` would report a completed
// denial while a required cleanup is still outstanding. So the exact outcome is
// carried through every path — Phase B, startup, OTP, Google, retry, onboarding and
// background revalidation — and the separate `denial` marker is what keeps the app
// denied for all four without the kind having to be flattened.
//
// A FAILED INTENT DELETION IS A DURABLE DEBT, NOT A LOST WRITE. It is recorded as a
// TOMBSTONE under its own key, carrying no intent material. Ordinary capture and
// recovery both refuse while it exists, so no legitimate newer intent can come into
// being — which is why the discharge needs no currency proof and cannot destroy
// anything a newer operation owns. The coordinator, not a future UI layer's
// discipline, refuses to reach any ready state while the debt is present or
// unreadable, so it cannot be bypassed by reloading or by a fresh recovery
// transition, and the stale intent can never be replayed.
//
// And the ordinary case is preserved: a first-run invitation captured before
// authentication survives authentication and onboarding untouched.
import { describe, expect, it } from "vitest";
import {
  ADMIN_REQUEST_ID,
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
  SYNTHETIC_CODE,
  intentCleanupKey,
  callbackUrl,
  createIdentityHarness,
  createMemoryStorage,
  report,
  view,
  type IdentityHarness,
  type MemoryStorage,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createPendingIntent, type PendingIntent } from "../pendingIntentRepository";
import { programIdentityFailure } from "../fakeIdentityService";
import { initialGateState, isGateReady, reduceGateState, type GateState } from "../gateState";

const ATTEMPT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const COMPLETED_AT = "2026-02-01T09:00:00.000Z";
const EMAIL = "athlete@example.test";
const INVITE_TOKEN = "opaque-invitation-token-0001";

function invitation(value = INVITE_TOKEN): PendingIntent {
  const built = createPendingIntent({ kind: "invitation", value, capturedAt: FIXED_NOW });
  if (built === null) throw new Error("fixture is invalid");
  return built;
}

function storedIntent(storage: MemoryStorage): PendingIntent | null {
  const raw = storage.store.get(STORAGE_KEYS.intent);
  return raw === undefined ? null : (JSON.parse(raw) as PendingIntent);
}

function onboard(harness: IdentityHarness, accountScopeId = IDENTITY_A.accountScopeId): void {
  harness.identityBackend.currentAccountScopeId = accountScopeId;
  harness.identityBackend.accounts.set(accountScopeId, {
    profileId: PROFILE_A,
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

function seedGoogleSet(storage: MemoryStorage): void {
  seedBarrier(storage);
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
}

function seedResolution(storage: MemoryStorage, accountScopeId = IDENTITY_A.accountScopeId): void {
  storage.seed(
    STORAGE_KEYS.resolutionFor(BARRIER_A),
    createIdentityBarrierResolution({
      barrierId: BARRIER_A,
      attemptId: ATTEMPT,
      method: "google",
      flowId: FLOW_X,
      identityGeneration: 1,
      authenticatedAccountScopeId: accountScopeId,
      resolvedAt: FIXED_NOW,
    })
  );
}

/** Replays every real progress event, then the settled outcome. */
function replay(
  harness: IdentityHarness,
  outcome: { transition?: unknown },
  from: GateState = initialGateState()
): GateState {
  let state = from;
  for (const [phase, transition] of harness.progressEvents) {
    state = reduceGateState(state, { type: "progress", phase, transition });
  }
  return reduceGateState(state, {
    type: "transition_settled",
    // The outcome types are all members of the transition-outcome union; the cast
    // narrows only for the event literal.
    outcome: outcome as Parameters<typeof reduceGateState>[1] extends { outcome: infer O }
      ? O
      : never,
  });
}

// ---------------------------------------------------------------------------
// The matrix: a definitive negative under every storage-failure combination
// ---------------------------------------------------------------------------

type FailureSet = { barrier?: boolean; trusted?: boolean; intent?: boolean };

const MATRIX: Array<[string, FailureSet, string, string | null]> = [
  ["all durable steps complete", {}, "identity_invalidated", "locked"],
  [
    "the trusted record cannot be removed",
    { trusted: true },
    "trusted_state_not_invalidated",
    "locked",
  ],
  [
    "the required intent deletion fails",
    { intent: true },
    "intent_state_not_persisted",
    "locked",
  ],
  [
    "the barrier write fails but removal succeeds",
    { barrier: true },
    "identity_invalidated",
    "locked",
  ],
  [
    "BOTH durable denial mechanisms fail",
    { barrier: true, trusted: true },
    "durable_denial_unavailable",
    "storage_unavailable_locked",
  ],
  [
    "removal fails AND the intent deletion fails",
    { trusted: true, intent: true },
    "trusted_state_not_invalidated",
    "locked",
  ],
];

function applyFailures(harness: IdentityHarness, failures: FailureSet): void {
  if (failures.barrier === true) harness.storage.failWrites.add(STORAGE_KEYS.barrier);
  if (failures.trusted === true) harness.storage.failRemoves.add(STORAGE_KEYS.trusted);
  if (failures.intent === true) harness.storage.failRemoves.add(STORAGE_KEYS.intent);
}

describe("a definitive IdentityService negative during a FRESH resolution", () => {
  for (const [label, failures, expectedKind, expectedState] of MATRIX) {
    it(`reports the exact outcome when ${label}`, async () => {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      harness.storage.seed(STORAGE_KEYS.intent, invitation());
      onboard(harness);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      programIdentityFailure(harness.identityBackend, "ensureProfile", "forbidden");
      applyFailures(harness, failures);

      const outcome = await harness.coordinator.startUp();

      expect(outcome.finalization, label).not.toBeNull();
      expect(outcome.finalization?.kind, label).toBe(expectedKind);
      // The app is denied for EVERY outcome, and the exact kind is preserved.
      expect(outcome.finalization?.denial, label).toBe(
        expectedKind === "durable_denial_unavailable"
          ? "durable_denial_unavailable"
          : "server_identity_invalidated"
      );
      expect(outcome.verdict.kind, label).toBe(expectedState);
      expect(isGateReady(replay(harness, outcome.finalization ?? {})), label).toBe(false);
    });
  }
});

describe("a definitive negative during OTP verification", () => {
  for (const [label, failures, expectedKind, expectedState] of MATRIX) {
    it(`reports the exact outcome when ${label}`, async () => {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      harness.storage.seed(STORAGE_KEYS.intent, invitation());
      onboard(harness);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      await harness.coordinator.requestEmailOtp(EMAIL);
      programIdentityFailure(harness.identityBackend, "resolveGateFacts", "profile_required");
      applyFailures(harness, failures);

      const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, "123456");

      expect(outcome.kind, label).toBe(expectedKind);
      expect(outcome.denial, label).toBe(
        expectedKind === "durable_denial_unavailable"
          ? "durable_denial_unavailable"
          : "server_identity_invalidated"
      );
      const state = replay(harness, outcome);
      expect(state.kind, label).toBe(expectedState);
      expect(isGateReady(state), label).toBe(false);
    });
  }
});

describe("a definitive negative during an admitted GOOGLE continuation", () => {
  for (const [label, failures, expectedKind, expectedState] of MATRIX) {
    it(`reports the exact outcome when ${label}`, async () => {
      const harness = createIdentityHarness({
        url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
      });
      seedGoogleSet(harness.storage);
      harness.storage.seed(STORAGE_KEYS.intent, invitation());
      onboard(harness);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      programIdentityFailure(harness.identityBackend, "ensureProfile", "forbidden");
      applyFailures(harness, failures);

      const outcome = await harness.coordinator.startUp();

      expect(outcome.finalization?.kind, label).toBe(expectedKind);
      expect(outcome.verdict.kind, label).toBe(expectedState);
      expect(isGateReady(replay(harness, outcome.finalization ?? {})), label).toBe(false);
    });
  }
});

describe("a definitive negative during the trusted-state RETRY", () => {
  it("carries the exact invalidation outcome rather than a re-derived lock", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    programIdentityFailure(harness.identityBackend, "ensureProfile", "forbidden");
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.retryTrustedStateEstablishment();

    expect(report(outcome)).toEqual({ kind: "trusted_state_not_invalidated" });
    expect(outcome.denial).toBe("server_identity_invalidated");
    expect(replay(harness, outcome).kind).toBe("locked");
  });
});

describe("Case B during ONBOARDING submission", () => {
  it("carries the exact invalidation outcome, and denies for every one of them", async () => {
    for (const [label, failures, expectedKind, expectedState] of MATRIX) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      harness.storage.seed(STORAGE_KEYS.intent, invitation());
      harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
      harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
        profileId: PROFILE_A,
        displayName: null,
        onboardingCompletedAt: null,
        hasAthleteCapability: false,
        freeEntitlementActive: false,
        pinnedTerms: null,
        pinnedPrivacy: null,
      });
      const legal = await harness.coordinator.refreshLegalSnapshot();
      expect(legal.kind, label).toBe("refreshed");
      if (legal.kind !== "refreshed") return;
      const terms = legal.legal.terms;
      const privacy = legal.legal.privacy;
      expect(terms, label).not.toBeNull();
      expect(privacy, label).not.toBeNull();
      if (terms === null || privacy === null) return;

      // Authenticated as A before the RPC, and as B afterwards: ADR-0025 §13's
      // Case B.
      let restores = 0;
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      const originalRestore = harness.fakeAuth.auth.restoreSession;
      harness.fakeAuth.auth.restoreSession = async () => {
        restores += 1;
        return restores === 1
          ? { kind: "authenticated", identity: IDENTITY_A }
          : { kind: "authenticated", identity: IDENTITY_B };
      };
      applyFailures(harness, failures);

      const outcome = await harness.coordinator.submitOnboarding({
        displayName: "Athlete",
        terms,
        privacy,
      });
      harness.fakeAuth.auth.restoreSession = originalRestore;

      expect(outcome.kind, label).toBe("identity_changed");
      if (outcome.kind !== "identity_changed") return;
      expect(outcome.invalidation.kind, label).toBe(expectedKind);
      const state = reduceGateState(
        { kind: "submitting_onboarding", transition: outcome.transition },
        { type: "onboarding_settled", outcome }
      );
      expect(state.kind, label).toBe(expectedState);
    }
  });
});

// ---------------------------------------------------------------------------
// The outstanding cleanup a failed intent deletion leaves behind
// ---------------------------------------------------------------------------

describe("a required intent deletion that FAILS", () => {
  it("records the debt durably, so it survives the page", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.finalization?.kind).toBe("intent_state_not_persisted");
    expect(outcome.finalization?.outstanding).toEqual(["pending_intent"]);
    expect(harness.storage.store.has(intentCleanupKey)).toBe(true);
    // The tombstone carries NO intent material — no kind, no token, no id.
    const tombstone = JSON.parse(harness.storage.store.get(intentCleanupKey) as string) as Record<
      string,
      unknown
    >;
    expect(Object.keys(tombstone).sort()).toEqual(["recordedAt", "schemaVersion"]);
    expect(JSON.stringify(tombstone)).not.toContain(INVITE_TOKEN);
    // The intent itself is untouched: nothing is repaired, nothing invented.
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);
    expect(storedIntent(harness.storage)?.capturedAt).toBe(FIXED_NOW);
  });

  it("records the debt for an ADMIN-REQUEST intent too — the debt is about the key", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const adminIntent = createPendingIntent({
      kind: "admin_request",
      value: ADMIN_REQUEST_ID,
      capturedAt: FIXED_NOW,
    });
    if (adminIntent === null) throw new Error("fixture is invalid");
    harness.storage.seed(STORAGE_KEYS.intent, adminIntent);
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "invalid_session" };
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);

    await harness.coordinator.startUp();

    expect(harness.storage.store.has(intentCleanupKey)).toBe(true);
    expect(storedIntent(harness.storage)?.kind).toBe("admin_request");
    expect(JSON.stringify(harness.storage.store.get(intentCleanupKey))).not.toContain(
      ADMIN_REQUEST_ID
    );
  });

  it("cannot be bypassed by a RELOAD: the next authentication reaches no ready state", async () => {
    // Page one: the denial cannot delete the intent, so it marks it.
    const storage = createMemoryStorage();
    const first = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    storage.seed(STORAGE_KEYS.intent, invitation());
    seedTrusted(storage);
    onboard(first);
    first.fakeAuth.state.restore = { kind: "no_session" };
    storage.failRemoves.add(STORAGE_KEYS.intent);
    await first.coordinator.startUp();
    expect(storage.store.has(intentCleanupKey)).toBe(true);

    // Page two — a genuinely new document over the same storage — authenticates
    // afresh. The removal still fails, so no ready state may be entered.
    const second = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    onboard(second);
    second.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    await second.coordinator.requestEmailOtp(EMAIL);
    const outcome = await second.coordinator.verifyEmailOtp(EMAIL, "123456");

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(isGateReady(replay(second, outcome))).toBe(false);
    // The debt is still recorded, so a third attempt is held to the same rule.
    expect(storage.store.has(intentCleanupKey)).toBe(true);
  });

  it("is DISCHARGED as soon as the removal succeeds, and only then does the gate open", async () => {
    const storage = createMemoryStorage();
    const first = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    storage.seed(STORAGE_KEYS.intent, invitation());
    seedTrusted(storage);
    onboard(first);
    first.fakeAuth.state.restore = { kind: "no_session" };
    storage.failRemoves.add(STORAGE_KEYS.intent);
    await first.coordinator.startUp();
    expect(storage.store.has(intentCleanupKey)).toBe(true);

    // Storage recovers.
    storage.failRemoves.delete(STORAGE_KEYS.intent);

    const second = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    onboard(second);
    second.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    await second.coordinator.requestEmailOtp(EMAIL);
    const outcome = await second.coordinator.verifyEmailOtp(EMAIL, "123456");

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind === "resolved") expect(outcome.gate.kind).toBe("ready_online");
    // Nothing is left to replay: the stale intent AND the debt are both gone.
    expect(storage.store.has(STORAGE_KEYS.intent)).toBe(false);
    expect(storage.store.has(intentCleanupKey)).toBe(false);
    expect(isGateReady(replay(second, outcome))).toBe(true);
  });

  it("cannot be bypassed by a fresh invitation RECOVERY transition", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    seedTrusted(harness.storage);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);
    await harness.coordinator.startUp();
    expect(harness.storage.store.has(intentCleanupKey)).toBe(true);

    // A recovery transition would otherwise mark the stored intent as a SURVIVAL,
    // converting a debt owed by the server's denial into a licence to replay.
    const before = harness.storage.store.get(STORAGE_KEYS.intent);
    const recovery = await harness.coordinator.recoverInvitationAccount(invitation());

    expect(report(recovery)).toEqual({ kind: "intent_state_not_persisted" });
    expect(harness.storage.store.get(STORAGE_KEYS.intent)).toBe(before);
    expect(harness.storage.store.has(intentCleanupKey)).toBe(true);
    // Every local failure before the provider call means zero sign-out calls.
    expect(harness.fakeAuth.counts.signOut).toBe(0);
  });

  it("the stale intent can never REPLAY: no ready state exists while it is stored", async () => {
    const storage = createMemoryStorage();
    const first = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    storage.seed(STORAGE_KEYS.intent, invitation());
    seedTrusted(storage);
    onboard(first);
    first.fakeAuth.state.restore = { kind: "invalid_session" };
    storage.failRemoves.add(STORAGE_KEYS.intent);
    await first.coordinator.startUp();

    // Every route to a ready gate is tried against the still-marked record.
    const routes: Array<(harness: IdentityHarness) => Promise<{ kind: string }>> = [
      async (harness) => {
        const outcome = await harness.coordinator.startUp();
        return { kind: outcome.verdict.kind };
      },
      async (harness) => {
        await harness.coordinator.requestEmailOtp(EMAIL);
        const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, "123456");
        return outcome.kind === "resolved" ? { kind: outcome.gate.kind } : { kind: outcome.kind };
      },
      async (harness) => harness.coordinator.retryTrustedStateEstablishment(),
    ];

    for (const route of routes) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
      onboard(harness);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      const result = await route(harness);
      expect(result.kind).not.toBe("ready_online");
      expect(result.kind).not.toBe("ready_offline");
      expect(storage.store.has(intentCleanupKey)).toBe(true);
    }
  });

  it("an OFFLINE continuation is held to the same rule", async () => {
    const storage = createMemoryStorage();
    const first = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    storage.seed(STORAGE_KEYS.intent, invitation());
    seedTrusted(storage);
    onboard(first);
    first.fakeAuth.state.restore = { kind: "no_session" };
    storage.failRemoves.add(STORAGE_KEYS.intent);
    await first.coordinator.startUp();

    // A later page load with a valid correlated set, a valid trusted record and no
    // connectivity — the one path to `ready_offline`.
    const offline = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    seedBarrier(storage);
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
    seedResolution(storage);
    seedTrusted(storage);
    offline.fakeAuth.state.restore = { kind: "temporarily_unavailable" };

    const outcome = await offline.coordinator.startUp();

    expect(outcome.verdict.kind).not.toBe("ready_offline");
    expect(outcome.verdict.kind).toBe("intent_state_not_persisted");
  });
});

// ---------------------------------------------------------------------------
// The ordinary case is preserved
// ---------------------------------------------------------------------------

describe("an ORDINARY first-run invitation", () => {
  it("survives normal authentication completely untouched", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    const before = harness.storage.store.get(STORAGE_KEYS.intent);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    await harness.coordinator.requestEmailOtp(EMAIL);
    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, "123456");

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind === "resolved") expect(outcome.gate.kind).toBe("ready_online");
    // Byte-identical, and no write was even attempted against the key.
    expect(harness.storage.store.get(STORAGE_KEYS.intent)).toBe(before);
    expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.intent}`);
    expect(harness.storage.calls).not.toContain(`remove:${STORAGE_KEYS.intent}`);
  });

  it("survives normal ONBOARDING completion untouched", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    const before = harness.storage.store.get(STORAGE_KEYS.intent);
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
      profileId: PROFILE_A,
      displayName: null,
      onboardingCompletedAt: null,
      hasAthleteCapability: false,
      freeEntitlementActive: false,
      pinnedTerms: null,
      pinnedPrivacy: null,
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const legal = await harness.coordinator.refreshLegalSnapshot();
    expect(legal.kind).toBe("refreshed");
    if (legal.kind !== "refreshed") return;
    const { terms, privacy } = legal.legal;
    if (terms === null || privacy === null) throw new Error("fixture is invalid");

    const outcome = await harness.coordinator.submitOnboarding({
      displayName: "Athlete",
      terms,
      privacy,
    });

    expect(outcome.kind).toBe("completed");
    expect(harness.storage.store.get(STORAGE_KEYS.intent)).toBe(before);
    expect(harness.storage.calls).not.toContain(`remove:${STORAGE_KEYS.intent}`);
  });

  it("survives a full-page GOOGLE return and its URL cleanup", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({
        code: SYNTHETIC_CODE,
        flowId: FLOW_X,
        extraQuery: { inviteToken: INVITE_TOKEN },
      }),
    });
    seedGoogleSet(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitation());
    const before = harness.storage.store.get(STORAGE_KEYS.intent);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    expect(harness.storage.store.get(STORAGE_KEYS.intent)).toBe(before);
    // The unrelated deep-link parameter is preserved in the cleaned URL, too.
    expect(harness.currentUrl()).toContain("inviteToken=");
    expect(harness.currentUrl()).not.toContain("code=");
  });
});

// ---------------------------------------------------------------------------
// The reducer keeps the app denied for every invalidation outcome
// ---------------------------------------------------------------------------

describe("the reducer denies for EVERY invalidation outcome without flattening the kind", () => {
  it("distinguishes an invalidation's failure from an ordinary sign-out's", () => {
    const transition = { id: "op", sequence: 1, mode: "foreground" } as const;

    // The SAME kind, from a denial: the app must be denied.
    const denied = reduceGateState(
      { kind: "ready_online", session: { ...SESSION_FIXTURE } },
      {
        type: "transition_settled",
        outcome: {
          kind: "intent_state_not_persisted",
          transition,
          denial: "server_identity_invalidated",
        },
      }
    );
    expect(view(denied)).toEqual({
      kind: "locked",
      origin: "server_identity_invalidated",
      callbackNotice: "none",
    });

    // The same kind from an ordinary sign-out carries no denial marker: the barrier
    // it already wrote is what locks, and the person sees retry copy.
    const signOutFailure = reduceGateState(
      { kind: "signing_out" },
      { type: "transition_settled", outcome: { kind: "intent_state_not_persisted", transition } }
    );
    expect(view(signOutFailure)).toEqual({
      kind: "recoverable_error",
      reason: "intent_state_not_persisted",
    });
  });
});

const SESSION_FIXTURE = {
  accountScopeId: IDENTITY_A.accountScopeId,
  email: IDENTITY_A.email,
  profileId: PROFILE_A,
  displayName: "Athlete",
  entitlement: "free" as const,
};
