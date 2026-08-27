// Phase B: identity binding, the three account-scope cases, the restore matrix,
// and required trusted-state establishment / replacement / refresh (ADR-0025 §13,
// §14, §15, §A).
import { describe, expect, it } from "vitest";
import {
  COMPLETE_LEGAL_ROWS,
  FIXED_NOW,
  IDENTITY_A,
  IDENTITY_B,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  createIdentityHarness,
  type IdentityHarness,
  type MemoryStorage,
  PINNED_PRIVACY,
  PINNED_TERMS,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier, type IdentityBarrierOrigin } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { ATTEMPT_A, BARRIER_A, FLOW_X } from "./support/identityTestHarness";

const PROFILE_B = "cccccccc-2222-4222-8222-cccccccccccc";

function seedCompletedSet(
  storage: MemoryStorage,
  options: { accountScopeId?: string; origin?: IdentityBarrierOrigin } = {}
): void {
  storage.seed(
    STORAGE_KEYS.barrier,
    createIdentityAccessBarrier({
      barrierId: BARRIER_A,
      origin: options.origin ?? "interactive_authentication",
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
      authenticatedAccountScopeId: options.accountScopeId ?? IDENTITY_A.accountScopeId,
      resolvedAt: FIXED_NOW,
    })
  );
}

function seedTrusted(
  storage: MemoryStorage,
  options: { accountScopeId?: string; profileId?: string; displayName?: string } = {}
): void {
  storage.seed(
    STORAGE_KEYS.trusted,
    createTrustedDeviceRecord({
      accountScopeId: options.accountScopeId ?? IDENTITY_A.accountScopeId,
      profileId: options.profileId ?? PROFILE_A,
      displayName: options.displayName ?? "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      generation: 1,
      establishedAt: FIXED_NOW,
      lastServerConfirmationAt: FIXED_NOW,
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

function bareProfileOnly(harness: IdentityHarness, accountScopeId: string): void {
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

describe("Case A — an explicitly correlated account replacement", () => {
  it("resolves account B as FRESH even though the stale trusted record belongs to A", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    onboard(harness, IDENTITY_B.accountScopeId, PROFILE_B, "Athlete B");
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    if (outcome.verdict.kind !== "ready_online") return;
    // The session describes B, never A.
    expect(outcome.verdict.session.accountScopeId).toBe(IDENTITY_B.accountScopeId);
    expect(outcome.verdict.session.profileId).toBe(PROFILE_B);
    expect(outcome.verdict.session.displayName).toBe("Athlete B");
    // Server-authoritative facts were resolved afresh for B.
    expect(harness.identityBackend.calls).toContain("ensureProfile");
    expect(harness.identityBackend.calls).toContain("resolveGateFacts");
  });

  it("REPLACES the trusted record, and writes no invalidation barrier", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    onboard(harness, IDENTITY_B.accountScopeId, PROFILE_B, "Athlete B");
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };

    await harness.coordinator.startUp();

    const trusted = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      accountScopeId: string;
      profileId: string;
    };
    expect(trusted.accountScopeId).toBe(IDENTITY_B.accountScopeId);
    expect(trusted.profileId).toBe(PROFILE_B);
    // Case A is NOT an invalidation.
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
      origin: string;
    };
    expect(barrier.barrierId).toBe(BARRIER_A);
    expect(barrier.origin).not.toBe("server_identity_invalidated");
  });

  it("does NOT enter ready_online until the replacement is durably written", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    onboard(harness, IDENTITY_B.accountScopeId, PROFILE_B, "Athlete B");
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
    harness.storage.failWrites.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "trusted_state_not_established" });
    // Account A's record is still on disk — and was never honoured or
    // reinterpreted for B.
    const trusted = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      accountScopeId: string;
    };
    expect(trusted.accountScopeId).toBe(IDENTITY_A.accountScopeId);
  });

  it("never grants ready_offline while the trusted scope does not match the resolution scope", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
  });
});
describe("Case B — an unexpected or uncorrelated mismatch", () => {
  it("a mismatch with NO correlation set writes an invalidation barrier and locks", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "locked", origin: "server_identity_invalidated" });
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
      barredAccountScopeId: string | null;
    };
    expect(barrier.origin).toBe("server_identity_invalidated");
    // The unexpected session is never accepted as a fresh identity.
    expect(harness.identityBackend.calls).not.toContain("ensureProfile");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a restored identity differing from the resolution's scope is invalidated", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    // The completed set says account A completed this barrier...
    seedCompletedSet(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    // ...but the restored session is account B.
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "locked", origin: "server_identity_invalidated" });
    expect(harness.identityBackend.calls).not.toContain("ensureProfile");
  });

  it("an invalid session with a valid trusted record is invalidated", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "invalid_session" };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "locked", origin: "server_identity_invalidated" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("an invalid session with NO trusted record simply offers sign-in", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.restore = { kind: "invalid_session" };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("signed_out");
  });
});

describe("Case C — no_session while a valid trusted record exists", () => {
  it("establishes the durable denial barrier BEFORE removing the trusted record", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.calls.length = 0;

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "locked", origin: "server_identity_invalidated" });
    const barrierWrite = harness.storage.calls.indexOf(`set:${STORAGE_KEYS.barrier}`);
    const trustedRemoval = harness.storage.calls.indexOf(`remove:${STORAGE_KEYS.trusted}`);
    expect(barrierWrite).toBeGreaterThanOrEqual(0);
    expect(trustedRemoval).toBeGreaterThan(barrierWrite);
  });

  it("stays denied when the barrier succeeded but the removal failed", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.startUp();

    // The unresolved invalidation barrier keeps the stale record from being
    // honoured even though removing it failed.
    expect(outcome.verdict).toEqual({ kind: "locked", origin: "server_identity_invalidated" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("stays denied when the barrier write failed but the removal succeeded", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "locked", origin: "server_identity_invalidated" });
    // Durable denial was achieved by the fallback: the stale record cannot return.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("reports durable_denial_unavailable, and claims no revocation, when BOTH mechanisms fail", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "storage_unavailable_locked" });
    // Nothing durable changed — and the outcome says so rather than implying the
    // device was revoked.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("no_session with NO trusted record is an ordinary signed-out state", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.restore = { kind: "no_session" };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("signed_out");
    expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.barrier}`);
  });
});

describe("the restore matrix", () => {
  it("authenticated + no trusted record + completed onboarding establishes trust and goes ready", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    const trusted = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      accountScopeId: string;
      entitlement: string;
    };
    expect(trusted.accountScopeId).toBe(IDENTITY_A.accountScopeId);
    expect(trusted.entitlement).toBe("free");
  });

  it("authenticated + a BARE Profile requires onboarding and writes no trusted record", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    bareProfileOnly(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("onboarding_required");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("authenticated + a Profile with capability but NO active entitlement still requires onboarding", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      hasAthleteCapability: true,
      freeEntitlementActive: false,
      pinnedTerms: PINNED_TERMS,
      pinnedPrivacy: PINNED_PRIVACY,
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    // Four separate facts: all of them are required.
    expect(outcome.verdict.kind).toBe("onboarding_required");
  });

  it("onboarding is BLOCKED when there is no current Terms row", async () => {
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      legalRows: [COMPLETE_LEGAL_ROWS[1]],
    });
    bareProfileOnly(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("onboarding_blocked_legal");
  });

  it("authenticated + a same-scope trusted record enters optimistically without contacting the server", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage, { displayName: "Trusted Name" });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    if (outcome.verdict.kind !== "ready_online") return;
    expect(outcome.verdict.session.displayName).toBe("Trusted Name");
    expect(outcome.verdict.session.email).toBe(IDENTITY_A.email);
    // Revalidation is a separate, background operation; it never blocks entry.
    expect(harness.identityBackend.calls).toEqual([]);
  });

  it("temporarily_unavailable + a same-scope trusted record + a completed set grants ready_offline", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_offline");
    if (outcome.verdict.kind !== "ready_offline") return;
    // With no session there is no email to show, and none is invented.
    expect(outcome.verdict.session.email).toBeNull();
    expect(outcome.verdict.session.accountScopeId).toBe(IDENTITY_A.accountScopeId);
    // No Legal fetch happened.
    expect(harness.identityBackend.calls).toEqual([]);
  });

  it("temporarily_unavailable with NO trusted record fails closed, with no Legal fetch", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(harness.identityBackend.calls).toEqual([]);
  });

  it("temporarily_unavailable with a trusted record but NO completed set fails closed", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
  });

  it("restore_failed fails closed, RETAINS the trusted record, and does not honour it", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "restore_failed" };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("a MALFORMED trusted record is removed and treated as absent", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seedRaw(STORAGE_KEYS.trusted, '{"schemaVersion":2}');
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };

    const outcome = await harness.coordinator.startUp();

    // Behaves as absent: fail closed, and the unusable record is gone.
    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a malformed trusted record with no_session behaves as absent — no invalidation transition", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seedRaw(STORAGE_KEYS.trusted, "{oops");
    harness.fakeAuth.state.restore = { kind: "no_session" };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("signed_out");
  });

  it("an UNREADABLE trusted record takes the full server path rather than an optimistic entry", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.failReads.add(STORAGE_KEYS.trusted);
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    // Treating an unproven read as absent can only ever require MORE proof.
    expect(harness.identityBackend.calls).toContain("resolveGateFacts");
    expect(outcome.verdict.kind).toBe("ready_online");
  });
});

describe("required trusted-state establishment (ADR-0025 §15)", () => {
  it("a FIRST establishment failure yields trusted_state_not_established and NO ready state", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    harness.storage.failWrites.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.startUp();

    // Server authentication, Profile, onboarding and entitlement all succeeded.
    expect(harness.identityBackend.calls).toContain("resolveGateFacts");
    expect(outcome.verdict).toEqual({ kind: "trusted_state_not_established" });
  });

  it("the retry re-runs resolveGateFacts BEFORE attempting the write again", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    harness.storage.failWrites.add(STORAGE_KEYS.trusted);
    await harness.coordinator.startUp();

    harness.identityBackend.calls.length = 0;
    harness.storage.calls.length = 0;
    harness.storage.failWrites.clear();

    const retry = await harness.coordinator.retryTrustedStateEstablishment();

    const factsCall = harness.identityBackend.calls.indexOf("resolveGateFacts");
    expect(factsCall).toBeGreaterThanOrEqual(0);
    const trustedWrite = harness.storage.calls.indexOf(`set:${STORAGE_KEYS.trusted}`);
    expect(trustedWrite).toBeGreaterThanOrEqual(0);
    expect(retry.kind).toBe("resolved");
    if (retry.kind !== "resolved") return;
    expect(retry.gate.kind).toBe("ready_online");
  });

  it("the retry fails closed with no session, and does not touch trusted state", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const retry = await harness.coordinator.retryTrustedStateEstablishment();
    expect(report(retry)).toEqual({ kind: "temporarily_unavailable" });
    expect(harness.storage.calls).toEqual([]);
  });

  it("there is no undocumented online-only mode: no ready state exists without the record", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    harness.storage.failWrites.add(STORAGE_KEYS.trusted);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).not.toBe("ready_online");
    expect(outcome.verdict.kind).not.toBe("ready_offline");
  });
});

describe("background revalidation (ADR-0025 §A, §15)", () => {
  it("confirms a still-valid same-scope record by refreshing only its metadata", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const before = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      lastServerConfirmationAt: string;
      establishedAt: string;
    };
    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(outcome.kind).toBe("resolved");
    const after = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      lastServerConfirmationAt: string;
      establishedAt: string;
      accountScopeId: string;
      profileId: string;
      onboardingCompletedAt: string;
      entitlement: string;
    };
    expect(after.lastServerConfirmationAt).not.toBe(before.lastServerConfirmationAt);
    // Nothing else moved.
    expect(after.establishedAt).toBe(before.establishedAt);
    expect(after.accountScopeId).toBe(IDENTITY_A.accountScopeId);
    expect(after.profileId).toBe(PROFILE_A);
    expect(after.entitlement).toBe("free");
  });

  it("a same-scope REFRESH failure is explicitly non-fatal, retains the record, and fabricates no timestamp", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const before = harness.storage.store.get(STORAGE_KEYS.trusted) as string;
    harness.storage.failWrites.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(report(outcome)).toEqual({ kind: "trusted_state_refresh_skipped" });
    // The existing record is retained EXACTLY as it was.
    expect(harness.storage.store.get(STORAGE_KEYS.trusted)).toBe(before);
  });

  it("a transient failure never revokes trusted state", async () => {
    for (const restore of [
      { kind: "temporarily_unavailable" as const },
      { kind: "restore_failed" as const },
    ]) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      seedTrusted(harness.storage);
      harness.fakeAuth.state.restore = restore;
      const outcome = await harness.coordinator.revalidateGateFacts();
      expect(report(outcome), restore.kind).toEqual({ kind: "temporarily_unavailable" });
      expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
      expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.barrier}`);
    }
  });

  it("a definitive negative writes the invalidation barrier BEFORE trusted cleanup", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "no_session" };
    harness.storage.calls.length = 0;

    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    const barrierWrite = harness.storage.calls.indexOf(`set:${STORAGE_KEYS.barrier}`);
    const removal = harness.storage.calls.indexOf(`remove:${STORAGE_KEYS.trusted}`);
    expect(barrierWrite).toBeGreaterThanOrEqual(0);
    expect(removal).toBeGreaterThan(barrierWrite);
  });

  it("a revoked entitlement learned online is a definitive negative", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      hasAthleteCapability: true,
      freeEntitlementActive: false,
      pinnedTerms: PINNED_TERMS,
      pinnedPrivacy: PINNED_PRIVACY,
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("server_identity_invalidated");
  });

  it("a DIFFERENT account scope is Case B — invalidated, never replaced", async () => {
    // A background revalidation is uncorrelated: no barrier, attempt or resolution
    // proves a deliberate transition, so it may confirm an existing record but may
    // never mint one for a different account.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    onboard(harness, IDENTITY_A.accountScopeId);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    harness.storage.calls.length = 0;

    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    // No fresh record was written for the unexpected session.
    expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.trusted}`);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("server_identity_invalidated");
  });

  it("the SAME scope resolving a DIFFERENT Profile is Case B", async () => {
    // The scope matches, so a naive check would call this an ordinary refresh —
    // and would combine one Profile's server result with another's local record.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage, {
      accountScopeId: IDENTITY_A.accountScopeId,
      profileId: PROFILE_A,
    });
    onboard(harness, IDENTITY_A.accountScopeId, PROFILE_B, "Athlete B");
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    harness.storage.calls.length = 0;

    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(harness.storage.calls).not.toContain(`set:${STORAGE_KEYS.trusted}`);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a DIFFERENT completion fact for the same Profile is Case B", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
      profileId: PROFILE_A,
      displayName: "Athlete",
      // Onboarding completion is write-once server-side, so a different value
      // means the two are not describing the same established identity.
      onboardingCompletedAt: "2026-05-05T05:05:05.000Z",
      hasAthleteCapability: true,
      freeEntitlementActive: true,
      pinnedTerms: PINNED_TERMS,
      pinnedPrivacy: PINNED_PRIVACY,
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
  });

  it("an ABSENT, MALFORMED or UNREADABLE trusted record is Case B, never a fresh write", async () => {
    const cases: Array<[string, (harness: IdentityHarness) => void]> = [
      ["absent", () => {}],
      ["malformed", (harness) => harness.storage.seedRaw(STORAGE_KEYS.trusted, "{oops")],
      [
        "unreadable",
        (harness) => {
          seedTrusted(harness.storage);
          harness.storage.failReads.add(STORAGE_KEYS.trusted);
        },
      ],
    ];
    for (const [label, prepare] of cases) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      prepare(harness);
      onboard(harness, IDENTITY_A.accountScopeId);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      harness.storage.calls.length = 0;

      const outcome = await harness.coordinator.revalidateGateFacts();

      expect(outcome.kind, label).toBe("identity_invalidated");
      expect(harness.storage.calls, label).not.toContain(`set:${STORAGE_KEYS.trusted}`);
    }
  });

  it("a background revalidation NEVER mints a trusted record, in any denial path", async () => {
    const scenarios: Array<[string, (harness: IdentityHarness) => void]> = [
      [
        "different scope",
        (harness) => seedTrusted(harness.storage, { accountScopeId: IDENTITY_B.accountScopeId }),
      ],
      ["absent", () => {}],
      ["malformed", (harness) => harness.storage.seedRaw(STORAGE_KEYS.trusted, "7")],
    ];
    for (const [label, prepare] of scenarios) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      prepare(harness);
      onboard(harness, IDENTITY_A.accountScopeId);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      await harness.coordinator.revalidateGateFacts();
      expect(harness.storage.calls.filter((call) => call === `set:${STORAGE_KEYS.trusted}`), label).toEqual(
        []
      );
    }
  });

  it("required invalidation failures during revalidation are reported honestly", async () => {
    // Barrier write fails, removal succeeds: durable denial achieved by the fallback.
    const fallback = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(fallback.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    onboard(fallback, IDENTITY_A.accountScopeId);
    fallback.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    fallback.storage.failWrites.add(STORAGE_KEYS.barrier);
    await expect(fallback.coordinator.revalidateGateFacts().then(report)).resolves.toEqual({
      kind: "identity_invalidated",
    });
    expect(fallback.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);

    // Barrier succeeds, removal fails: still denied, reported as such.
    const retained = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(retained.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    onboard(retained, IDENTITY_A.accountScopeId);
    retained.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    retained.storage.failRemoves.add(STORAGE_KEYS.trusted);
    await expect(retained.coordinator.revalidateGateFacts().then(report)).resolves.toEqual({
      kind: "trusted_state_not_invalidated",
    });

    // Both fail: no durable revocation is claimed.
    const doubleFailure = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(doubleFailure.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    onboard(doubleFailure, IDENTITY_A.accountScopeId);
    doubleFailure.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    doubleFailure.storage.failWrites.add(STORAGE_KEYS.barrier);
    doubleFailure.storage.failRemoves.add(STORAGE_KEYS.trusted);
    await expect(
      doubleFailure.coordinator.revalidateGateFacts().then(report)
    ).resolves.toEqual({ kind: "durable_denial_unavailable" });
    expect(doubleFailure.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("Case A is untouched: an exact correlation set still REPLACES a stale record", async () => {
    // The interactive path proves the transition, so replacement remains valid
    // there — and writes no invalidation barrier.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedCompletedSet(harness.storage, { accountScopeId: IDENTITY_B.accountScopeId });
    seedTrusted(harness.storage, { accountScopeId: IDENTITY_A.accountScopeId });
    onboard(harness, IDENTITY_B.accountScopeId, PROFILE_B, "Athlete B");
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("ready_online");
    const trusted = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      accountScopeId: string;
    };
    expect(trusted.accountScopeId).toBe(IDENTITY_B.accountScopeId);
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).not.toBe("server_identity_invalidated");
  });
});
