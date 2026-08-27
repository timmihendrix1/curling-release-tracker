// The pending deep-link intent's lifetime, exercised through the COORDINATOR
// rather than the repository (ADR-0025 §22, §C).
//
// The repository knows how to delete and how to mark survival; what matters is
// where those calls actually happen: an intent must survive ordinary
// authentication and onboarding, must not cross an account switch, must not
// survive a second sign-out once its bounded recovery is spent, and every required
// mutation must fail closed rather than letting the gate open on an unproven state.
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_A,
  BARRIER_A,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  IDENTITY_B,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  SYNTHETIC_CODE,
  callbackUrl,
  createIdentityHarness,
  createMemoryStorage,
  holdStorageCall,
  intentCleanupKey,
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
import { requiredLegalDocuments } from "../legalSnapshot";

const PROFILE_B = "cccccccc-2222-4222-8222-cccccccccccc";
const INVITE_TOKEN = "opaque-invitation-token-0001";

function intent(survival: PendingIntent["survival"] = "ordinary"): PendingIntent {
  const built = createPendingIntent({
    kind: "invitation",
    value: INVITE_TOKEN,
    capturedAt: FIXED_NOW,
    survival,
  });
  if (built === null) throw new Error("fixture is invalid");
  return built;
}

function storedIntent(storage: MemoryStorage): PendingIntent | null {
  const raw = storage.store.get(STORAGE_KEYS.intent);
  return raw === undefined ? null : (JSON.parse(raw) as PendingIntent);
}

function seedTrusted(storage: MemoryStorage, accountScopeId: string, profileId = PROFILE_A): void {
  storage.seed(
    STORAGE_KEYS.trusted,
    createTrustedDeviceRecord({
      accountScopeId,
      profileId,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      generation: 1,
      establishedAt: FIXED_NOW,
      lastServerConfirmationAt: FIXED_NOW,
    })
  );
}

function seedCompletedSet(storage: MemoryStorage, accountScopeId: string): void {
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
      attemptId: ATTEMPT_A,
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
      attemptId: ATTEMPT_A,
      method: "google",
      flowId: FLOW_X,
      identityGeneration: 1,
      authenticatedAccountScopeId: accountScopeId,
      resolvedAt: FIXED_NOW,
    })
  );
}

function onboard(
  harness: IdentityHarness,
  accountScopeId: string,
  profileId = PROFILE_A,
  displayName = "Athlete"
): void {
  harness.identityBackend.currentAccountScopeId = accountScopeId;
  harness.identityBackend.accounts.set(accountScopeId, {
    profileId,
    displayName,
    onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
  });
}

function bareProfile(harness: IdentityHarness, accountScopeId: string): void {
  harness.identityBackend.currentAccountScopeId = accountScopeId;
  harness.identityBackend.accounts.set(accountScopeId, {
    profileId: PROFILE_A,
    displayName: null,
    onboardingCompletedAt: null,
    hasAthleteCapability: false,
    freeEntitlementActive: false,
    pinnedTerms: null,
    pinnedPrivacy: null,
  });
}

describe("an ordinary intent SURVIVES normal authentication and onboarding", () => {
  it("survives a Google start, its full-page return, and the exchange", async () => {
    const storage = createMemoryStorage();
    storage.seed(STORAGE_KEYS.intent, intent());

    const startPage = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await startPage.coordinator.startGoogleSignIn();
    expect(storedIntent(storage)?.value).toBe(INVITE_TOKEN);

    const callbackPage = createIdentityHarness({
      url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
      storage,
    });
    onboard(callbackPage, IDENTITY_A.accountScopeId);
    callbackPage.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await callbackPage.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    expect(storedIntent(storage)?.value).toBe(INVITE_TOKEN);
    expect(storedIntent(storage)?.survival).toBe("ordinary");
  });

  it("survives an OTP request, verification and a completed onboarding", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    bareProfile(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    await harness.coordinator.requestEmailOtp("athlete@example.test");
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);

    const verified = await harness.coordinator.verifyEmailOtp("athlete@example.test", "123456");
    expect(verified.kind).toBe("resolved");
    if (verified.kind !== "resolved") return;
    expect(verified.gate.kind).toBe("onboarding_required");
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);

    if (verified.gate.kind !== "onboarding_required") return;
    const pair = requiredLegalDocuments(verified.gate.legal);
    if (pair === null) throw new Error("snapshot incomplete");
    const completed = await harness.coordinator.submitOnboarding({
      displayName: "Athlete",
      ...pair,
    });

    expect(completed.kind).toBe("completed");
    // An intent captured before authentication is legitimately continuing through
    // authentication and onboarding.
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);
  });

  it("survives a transient failure and a reload", async () => {
    const storage = createMemoryStorage();
    storage.seed(STORAGE_KEYS.intent, intent());

    const offline = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    offline.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    await offline.coordinator.startUp();
    expect(storedIntent(storage)?.value).toBe(INVITE_TOKEN);

    const reload = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    reload.fakeAuth.state.restore = { kind: "no_session" };
    await reload.coordinator.startUp();
    expect(storedIntent(storage)?.value).toBe(INVITE_TOKEN);
  });

  it("a FIRST sign-in on an untrusted device does not delete it", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);
  });
});

describe("an ORDINARY ACCOUNT SWITCH ends the previous account's intents", () => {
  it("deletes the intent before the new account becomes ready", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, IDENTITY_B.accountScopeId);
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    onboard(harness, IDENTITY_B.accountScopeId, PROFILE_B, "Athlete B");
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
    harness.storage.calls.length = 0;

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    expect(storedIntent(harness.storage)).toBeNull();
    // Deleted BEFORE the trusted record for the new account was written, so the
    // new account can never be ready while a foreign intent is still present.
    const deletion = harness.storage.calls.indexOf(`remove:${STORAGE_KEYS.intent}`);
    const trustedWrite = harness.storage.calls.indexOf(`set:${STORAGE_KEYS.trusted}`);
    expect(deletion).toBeGreaterThanOrEqual(0);
    expect(trustedWrite).toBeGreaterThan(deletion);
  });

  it("a deletion failure BLOCKS readiness and reports intent_state_not_persisted", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, IDENTITY_B.accountScopeId);
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    onboard(harness, IDENTITY_B.accountScopeId, PROFILE_B, "Athlete B");
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "intent_state_not_persisted" });
    // No trusted record for the new account was written: the switch never completed.
    const trusted = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      accountScopeId: string;
    };
    expect(trusted.accountScopeId).toBe(IDENTITY_A.accountScopeId);
  });

  it("re-resolving the SAME account is not a switch and keeps the intent", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    // No trusted record yet, then a retry once one exists for the same account.
    await harness.coordinator.startUp();
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);

    const retry = await harness.coordinator.retryTrustedStateEstablishment();
    expect(retry.kind).toBe("resolved");
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);
  });
});

describe("the recovery survival marker is spent at gate-ready", () => {
  it("is reset to ordinary before a fresh identity becomes ready", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, intent("invitation_account_recovery"));
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    // The invitation itself survives — only its one-sign-out exemption is spent.
    expect(storedIntent(harness.storage)?.value).toBe(INVITE_TOKEN);
    expect(storedIntent(harness.storage)?.survival).toBe("ordinary");
  });

  it("is reset before an optimistic same-scope entry becomes ready", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, IDENTITY_A.accountScopeId);
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent("invitation_account_recovery"));
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    expect(storedIntent(harness.storage)?.survival).toBe("ordinary");
  });

  it("is reset before an offline entry becomes ready", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, IDENTITY_A.accountScopeId);
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent("invitation_account_recovery"));
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_offline");
    expect(storedIntent(harness.storage)?.survival).toBe("ordinary");
  });

  it("a reset failure BLOCKS readiness — a spent marker must not survive a second sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, IDENTITY_A.accountScopeId);
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent("invitation_account_recovery"));
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    harness.storage.failWrites.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "intent_state_not_persisted" });
    // Nothing claims the invitation will be replayed.
    expect(storedIntent(harness.storage)?.survival).toBe("invitation_account_recovery");
  });

  it("the full recovery round trip spends the marker exactly once", async () => {
    const storage = createMemoryStorage();
    seedTrusted(storage, IDENTITY_A.accountScopeId);
    storage.seed(STORAGE_KEYS.intent, intent());

    // 1. The bounded recovery marks survival and signs out.
    const recovering = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await recovering.coordinator.recoverInvitationAccount(intent());
    expect(storedIntent(storage)?.survival).toBe("invitation_account_recovery");

    // 2. Re-authenticating as the invited account spends it.
    const reauth = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    onboard(reauth, IDENTITY_B.accountScopeId, PROFILE_B, "Invited Athlete");
    reauth.fakeAuth.state.otpVerify = { ok: true, value: IDENTITY_B };
    reauth.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
    await reauth.coordinator.requestEmailOtp("invited@example.test");
    const verified = await reauth.coordinator.verifyEmailOtp("invited@example.test", "123456");
    expect(verified.kind).toBe("resolved");
    expect(storedIntent(storage)?.survival).toBe("ordinary");

    // 3. A SECOND sign-out now deletes it like any other ordinary intent.
    const signingOut = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await signingOut.coordinator.signOut();
    expect(storedIntent(storage)).toBeNull();
  });
});

describe("definitive denial ends ordinary intents", () => {
  it("a server-driven invalidation deletes an ordinary intent", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent());

    const outcome = await harness.coordinator.invalidateIdentity();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(storedIntent(harness.storage)).toBeNull();
  });

  it("a definitive denial ends a RECOVERY-MARKED invitation too", async () => {
    // The one-sign-out exemption exists so a deliberate wrong-account recovery can
    // carry exactly one invitation across exactly one sign-out. It is not a licence
    // to survive the server saying this identity is no longer valid.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent("invitation_account_recovery"));

    const outcome = await harness.coordinator.invalidateIdentity();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(storedIntent(harness.storage)).toBeNull();
  });

  it("a successful invalidation retry discharges an older cleanup tombstone", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    harness.storage.seed(intentCleanupKey, {
      schemaVersion: 1,
      recordedAt: FIXED_NOW,
    });

    const outcome = await harness.coordinator.invalidateIdentity();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(storedIntent(harness.storage)).toBeNull();
    expect(harness.storage.store.has(intentCleanupKey)).toBe(false);
  });

  it("orders captured intents against definitive-denial cleanup on one page", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    const held = holdStorageCall(harness.storage, `set:${STORAGE_KEYS.intent}`);

    const capture = harness.coordinator.capturePendingIntent(intent());
    await held.reached;
    const denial = harness.coordinator.invalidateIdentity();
    held.release();

    await expect(capture).resolves.toEqual({ kind: "applied" });
    await expect(denial.then(report)).resolves.toEqual({ kind: "identity_invalidated" });
    expect(storedIntent(harness.storage)).toBeNull();
    expect(harness.storage.store.has(intentCleanupKey)).toBe(false);
  });

  it("an intent-deletion failure is REPORTED, not swallowed as an unqualified success", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.invalidateIdentity();

    // Still denied — the barrier is the latch — but the transition did not
    // complete, and the outcome says so.
    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("server_identity_invalidated");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("reports the most severe incomplete step across the whole failure matrix", async () => {
    type Scenario = [string, { barrier?: boolean; trusted?: boolean; intent?: boolean }, string];
    const scenarios: Scenario[] = [
      ["everything succeeds", {}, "identity_invalidated"],
      ["intent deletion fails", { intent: true }, "intent_state_not_persisted"],
      ["trusted removal fails", { trusted: true }, "trusted_state_not_invalidated"],
      ["trusted removal and intent deletion fail", { trusted: true, intent: true }, "trusted_state_not_invalidated"],
      ["barrier save fails", { barrier: true }, "identity_invalidated"],
      ["barrier save and intent deletion fail", { barrier: true, intent: true }, "intent_state_not_persisted"],
      ["barrier save and trusted removal fail", { barrier: true, trusted: true }, "durable_denial_unavailable"],
      [
        "all three fail",
        { barrier: true, trusted: true, intent: true },
        "durable_denial_unavailable",
      ],
    ];
    for (const [label, failures, expected] of scenarios) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
      harness.storage.seed(STORAGE_KEYS.intent, intent());
      if (failures.barrier === true) harness.storage.failWrites.add(STORAGE_KEYS.barrier);
      if (failures.trusted === true) harness.storage.failRemoves.add(STORAGE_KEYS.trusted);
      if (failures.intent === true) harness.storage.failRemoves.add(STORAGE_KEYS.intent);

      const outcome = await harness.coordinator.invalidateIdentity();

      expect(outcome.kind, label).toBe(expected);
    }
  });

  it("keeps the barrier first and deletes intents after the trusted removal", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    harness.storage.calls.length = 0;

    await harness.coordinator.invalidateIdentity();

    const barrierWrite = harness.storage.calls.indexOf(`set:${STORAGE_KEYS.barrier}`);
    const trustedRemoval = harness.storage.calls.indexOf(`remove:${STORAGE_KEYS.trusted}`);
    const intentDeletion = harness.storage.calls.indexOf(`remove:${STORAGE_KEYS.intent}`);
    expect(barrierWrite).toBeGreaterThanOrEqual(0);
    expect(trustedRemoval).toBeGreaterThan(barrierWrite);
    expect(intentDeletion).toBeGreaterThan(trustedRemoval);
  });

  it("denies in memory before ANY durable step", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, IDENTITY_A.accountScopeId);
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    harness.log.length = 0;

    await harness.coordinator.invalidateIdentity();

    const denial = harness.log.indexOf("progress:identity_denied_in_memory");
    const firstDurable = harness.log.findIndex(
      (entry) => entry.startsWith("storage:set:") || entry.startsWith("storage:remove:")
    );
    expect(denial).toBeGreaterThanOrEqual(0);
    expect(firstDurable).toBeGreaterThan(denial);
  });
});

describe("terminal handling and explicit dismissal", () => {
  it("discardPendingIntent removes the intent unconditionally", async () => {
    for (const survival of ["ordinary", "invitation_account_recovery"] as const) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      harness.storage.seed(STORAGE_KEYS.intent, intent(survival));
      await expect(harness.coordinator.discardPendingIntent()).resolves.toEqual({
        kind: "applied",
      });
      expect(storedIntent(harness.storage), survival).toBeNull();
    }
  });

  it("reports a removal failure honestly rather than claiming the intent is gone", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(STORAGE_KEYS.intent, intent());
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);
    await expect(harness.coordinator.discardPendingIntent()).resolves.toEqual({ kind: "blocked" });
    expect(storedIntent(harness.storage)).not.toBeNull();
  });

  it("discarding when nothing is stored is a success", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await expect(harness.coordinator.discardPendingIntent()).resolves.toEqual({ kind: "applied" });
  });
});
