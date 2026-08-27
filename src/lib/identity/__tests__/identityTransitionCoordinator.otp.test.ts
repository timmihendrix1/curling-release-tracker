// Email OTP: the method-specific ordering, the C5/C6/C7 checkpoints, and the
// structural reason a reloaded OTP flow cannot resume (ADR-0025 §5, §8, §9).
//
// OTP has no callback selector, so — unlike Google — the COMPLETE attempt CAN be
// persisted before the first provider call, and it is. That is what makes "zero
// OTP requests and zero verifications" achievable on an attempt-write failure.
import { describe, expect, it } from "vitest";
import {
  BARRIER_A,
  FIXED_NOW,
  IDENTITY_A,
  IDENTITY_B,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  authError,
  createIdentityHarness,
  createMemoryStorage,
  PINNED_PRIVACY,
  PINNED_TERMS,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { authOk } from "../../supabase/authService";

const EMAIL = "athlete@example.test";
const CODE = "123456";

function completeAccount(
  harness: ReturnType<typeof createIdentityHarness>,
  accountScopeId = IDENTITY_A.accountScopeId
): void {
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

async function requestThenVerify(
  harness: ReturnType<typeof createIdentityHarness>
): Promise<ReturnType<ReturnType<typeof createIdentityHarness>["coordinator"]["verifyEmailOtp"]>> {
  const requested = await harness.coordinator.requestEmailOtp(EMAIL);
  expect(report(requested)).toEqual({ kind: "otp_requested" });
  return harness.coordinator.verifyEmailOtp(EMAIL, CODE);
}

describe("the request sequence", () => {
  it("writes the barrier, then the complete attempt, then requests the code", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const outcome = await harness.coordinator.requestEmailOtp(EMAIL);

    expect(report(outcome)).toEqual({ kind: "otp_requested" });
    const order = harness.log.filter(
      (entry) =>
        entry === `storage:set:${STORAGE_KEYS.barrier}` ||
        entry === `storage:set:${STORAGE_KEYS.attempt}` ||
        entry === "auth:requestEmailOtp"
    );
    expect(order).toEqual([
      `storage:set:${STORAGE_KEYS.barrier}`,
      `storage:set:${STORAGE_KEYS.attempt}`,
      "auth:requestEmailOtp",
    ]);

    const attempt = JSON.parse(harness.storage.store.get(STORAGE_KEYS.attempt) as string) as {
      method: string;
      flowId: string | null;
    };
    expect(attempt.method).toBe("email_otp");
    expect(attempt.flowId).toBeNull();
  });

  it("a barrier-write failure means ZERO OTP requests and ZERO verifications", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.requestEmailOtp(EMAIL);

    expect(report(outcome)).toEqual({ kind: "barrier_not_established" });
    expect(harness.fakeAuth.counts.otpRequest).toBe(0);
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
    expect(harness.storage.store.has(STORAGE_KEYS.attempt)).toBe(false);
  });

  it("an attempt-write failure means ZERO OTP requests and ZERO verifications", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.failWrites.add(STORAGE_KEYS.attempt);

    const outcome = await harness.coordinator.requestEmailOtp(EMAIL);

    expect(report(outcome)).toEqual({ kind: "attempt_not_persisted" });
    expect(harness.fakeAuth.counts.otpRequest).toBe(0);
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
  });

  it("maps provider failures onto closed outcomes without raw text", async () => {
    const cases = [
      ["temporarily_unavailable", "temporarily_unavailable"],
      ["invalid_input", "invalid_input"],
      ["request_failed", "provider_error"],
      ["invalid_configuration", "provider_error"],
      ["unexpected_error", "provider_error"],
    ] as const;
    for (const [errorKind, expected] of cases) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      harness.fakeAuth.state.otpRequest = authError(errorKind);
      const outcome = await harness.coordinator.requestEmailOtp(EMAIL);
      expect(outcome.kind, errorKind).toBe(expected);
      // Only the normalized kind and the ordering annotation travel: no provider
      // message, no raw error object, no email, no token.
      expect(Object.keys(outcome).sort()).toEqual(["kind", "transition"]);
    }
  });

  it("a locked-screen recovery writes a NEW barrier before requesting", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: BARRIER_A,
        origin: "server_identity_invalidated",
        barredAccountScopeId: "account-a",
        barredGeneration: 2,
        establishedAt: FIXED_NOW,
      })
    );
    await harness.coordinator.requestEmailOtp(EMAIL);
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
      origin: string;
    };
    expect(barrier.barrierId).not.toBe(BARRIER_A);
    expect(barrier.origin).toBe("locked_screen_recovery");
  });
});

describe("verification, C5, C6 and C7", () => {
  it("resolves the exact current barrier and binds the identity", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await requestThenVerify(harness);

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.identity).toEqual(IDENTITY_A);
    expect(outcome.gate.kind).toBe("ready_online");

    const barrierId = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;
    const resolution = JSON.parse(
      harness.storage.store.get(STORAGE_KEYS.resolutionFor(barrierId)) as string
    ) as { method: string; flowId: string | null; authenticatedAccountScopeId: string };
    expect(resolution.method).toBe("email_otp");
    expect(resolution.flowId).toBeNull();
    expect(resolution.authenticatedAccountScopeId).toBe(IDENTITY_A.accountScopeId);
  });

  it("C5: a barrier superseded during the waiting period supersedes the verification, with ZERO verify calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.requestEmailOtp(EMAIL);

    // The person waits for the email. Another tab starts its own authentication.
    harness.storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: BARRIER_A,
        origin: "interactive_authentication",
        barredAccountScopeId: null,
        barredGeneration: null,
        establishedAt: FIXED_NOW,
      })
    );

    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);

    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
  });

  it("C5: a changed live generation supersedes with zero verify calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.requestEmailOtp(EMAIL);
    harness.liveGeneration.bump();
    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);
    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
  });

  it("C6: a barrier superseded during verification writes NO resolution", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.requestEmailOtp(EMAIL);
    const barrierBefore = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;

    harness.fakeAuth.auth.verifyEmailOtp = async () => {
      // The SDK persists the session and emits SIGNED_IN before resolving; the
      // barrier is what keeps the app closed when correlation has moved on.
      harness.storage.seed(
        STORAGE_KEYS.barrier,
        createIdentityAccessBarrier({
          barrierId: BARRIER_A,
          origin: "interactive_authentication",
          barredAccountScopeId: null,
          barredGeneration: null,
          establishedAt: FIXED_NOW,
        })
      );
      harness.fakeAuth.counts.otpVerify += 1;
      return authOk(IDENTITY_A);
    };

    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);

    expect(report(outcome)).toEqual({ kind: "correlation_changed" });
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(barrierBefore))).toBe(false);
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
  });

  it("C7: a barrier installed while the resolution write is in flight prevents any ready outcome", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    await harness.coordinator.requestEmailOtp(EMAIL);
    const ownBarrierId = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;

    harness.storage.onBeforeCall = (call) => {
      if (call === `set:${STORAGE_KEYS.resolutionFor(ownBarrierId)}`) {
        harness.storage.onBeforeCall = null;
        harness.storage.seed(
          STORAGE_KEYS.barrier,
          createIdentityAccessBarrier({
            barrierId: BARRIER_A,
            origin: "interactive_authentication",
            barredAccountScopeId: null,
            barredGeneration: null,
            establishedAt: FIXED_NOW,
          })
        );
      }
    };

    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);

    expect(report(outcome)).toEqual({ kind: "correlation_changed" });
    // Resolution B is on disk under its OWN key and is harmless; barrier A stays
    // unresolved.
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(ownBarrierId))).toBe(true);
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
  });

  it("a resolution write failure after a SUCCESSFUL verification leaves the app locked", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.requestEmailOtp(EMAIL);
    const barrierId = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;
    harness.storage.failWrites.add(STORAGE_KEYS.resolutionFor(barrierId));

    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);

    expect(report(outcome)).toEqual({ kind: "barrier_resolution_failed" });
    expect(harness.fakeAuth.counts.otpVerify).toBe(1);
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(barrierId))).toBe(false);
  });

  it("maps verification failures onto closed outcomes and writes no resolution", async () => {
    const cases = [
      ["verification_failed", "provider_error"],
      ["temporarily_unavailable", "temporarily_unavailable"],
      ["invalid_input", "invalid_input"],
    ] as const;
    for (const [errorKind, expected] of cases) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      await harness.coordinator.requestEmailOtp(EMAIL);
      harness.fakeAuth.state.otpVerify = authError(errorKind);
      const barrierId = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
        barrierId: string;
      }).barrierId;
      const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);
      expect(outcome.kind, errorKind).toBe(expected);
      expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(barrierId))).toBe(false);
    }
  });

  it("verifying with no attempt at all is superseded, with zero verify calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);
    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
  });

  it("verifying against a GOOGLE attempt is superseded — OTP cannot complete a Google flow", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.startGoogleSignIn();
    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);
    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
  });
});

describe("a reloaded OTP flow is structurally non-resumable", () => {
  it("the reloaded page's live counter can never coincide with the persisted attempt's epoch", async () => {
    const storage = createMemoryStorage();
    const firstPage = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await firstPage.coordinator.requestEmailOtp(EMAIL);
    const persisted = JSON.parse(storage.store.get(STORAGE_KEYS.attempt) as string) as {
      capturedIdentityGeneration: number;
    };
    // Every barrier establishment increments before use, so a persisted attempt is
    // always at generation >= 1...
    expect(persisted.capturedIdentityGeneration).toBeGreaterThanOrEqual(1);

    // ...while a genuinely new page starts at 0.
    const reloadedPage = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    expect(reloadedPage.liveGeneration.current()).toBe(0);

    const outcome = await reloadedPage.coordinator.verifyEmailOtp(EMAIL, CODE);
    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(reloadedPage.fakeAuth.counts.otpVerify).toBe(0);
  });

  it("a reload with no callback candidate renders locked recovery", async () => {
    const storage = createMemoryStorage();
    const firstPage = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await firstPage.coordinator.requestEmailOtp(EMAIL);

    const reloadedPage = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    const startup = await reloadedPage.coordinator.startUp();

    expect(startup.callback).toEqual({ kind: "no_return" });
    expect(startup.verdict.kind).toBe("quarantined_locked");
  });
});

describe("interleaving with a provider event", () => {
  it("SIGNED_IN arriving before the operation resolves still leaves access blocked", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.requestEmailOtp(EMAIL);
    const barrierId = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;

    const advices: string[] = [];
    harness.fakeAuth.auth.verifyEmailOtp = async () => {
      // Exactly the SDK's ordering: persist, emit, then resolve — and here the
      // resolve is a failure.
      advices.push(harness.coordinator.classifyAuthChange({ reason: "signed_in", identity: IDENTITY_A }).kind);
      harness.fakeAuth.counts.otpVerify += 1;
      return authError("verification_failed");
    };

    const outcome = await harness.coordinator.verifyEmailOtp(EMAIL, CODE);

    expect(advices).toEqual(["no_action"]);
    expect(report(outcome)).toEqual({ kind: "provider_error" });
    // No resolution exists, so the barrier still denies.
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(barrierId))).toBe(false);
  });

  it("a verification returning a DIFFERENT account than the trusted record replaces it as a fresh identity", async () => {
    // The completed correlation set proves the deliberate transition, so this is
    // Case A — a replacement, not an invalidation.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(
      STORAGE_KEYS.trusted,
      createTrustedDeviceRecord({
        accountScopeId: IDENTITY_A.accountScopeId,
        profileId: PROFILE_A,
        displayName: "Athlete A",
        onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
        generation: 1,
        establishedAt: FIXED_NOW,
        lastServerConfirmationAt: FIXED_NOW,
      })
    );
    completeAccount(harness, IDENTITY_B.accountScopeId);
    harness.fakeAuth.state.otpVerify = authOk(IDENTITY_B);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };

    const outcome = await requestThenVerify(harness);

    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.gate.kind).toBe("ready_online");
    const trusted = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      accountScopeId: string;
    };
    expect(trusted.accountScopeId).toBe(IDENTITY_B.accountScopeId);
    // No invalidation barrier was written for a deliberate, correlated replacement.
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).not.toBe("server_identity_invalidated");
  });
});
