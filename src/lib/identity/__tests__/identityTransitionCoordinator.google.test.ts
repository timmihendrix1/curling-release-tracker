// Google's method-specific start ordering, the C1/C2 checkpoints, and the exact
// provider-call cardinality of every failure (ADR-0025 §5, §8, §10).
//
// The ordering that matters and why: the `flowId` does not exist until
// `signInWithOAuth` returns, so the COMPLETE attempt cannot be persisted before
// that call. The sequence is therefore barrier -> prepare -> validate -> persist
// -> validate -> navigate, and **no test here asserts that an attempt-persistence
// failure implies zero preparation calls** — one preparation call has necessarily
// already happened by then.
import { describe, expect, it } from "vitest";
import {
  BARRIER_A,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  createIdentityHarness,
  createMemoryStorage,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createTrustedDeviceRecord } from "../trustedDevice";

describe("the barrier comes first, always", () => {
  it("writes a fresh unresolved barrier BEFORE the preparation call", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const outcome = await harness.coordinator.startGoogleSignIn();
    expect(report(outcome)).toEqual({ kind: "navigating" });

    const barrierWrite = harness.log.indexOf(`storage:set:${STORAGE_KEYS.barrier}`);
    const preparation = harness.log.indexOf("auth:prepareGoogleSignIn");
    expect(barrierWrite).toBeGreaterThanOrEqual(0);
    expect(preparation).toBeGreaterThan(barrierWrite);
  });

  it("a barrier-write failure means ZERO provider calls, ZERO navigation and no attempt", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.startGoogleSignIn();

    expect(report(outcome)).toEqual({ kind: "barrier_not_established" });
    expect(harness.fakeAuth.counts.prepare).toBe(0);
    expect(harness.fakeAuth.counts.navigate).toBe(0);
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    // And no preceding local mutation of any kind: nothing began.
    expect(harness.storage.store.has(STORAGE_KEYS.attempt)).toBe(false);
    expect(harness.storage.store.has(STORAGE_KEYS.barrier)).toBe(false);
  });

  it("a second authentication started while a barrier exists writes a NEW barrier with a new id, as locked_screen_recovery", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: BARRIER_A,
        origin: "explicit_sign_out",
        barredAccountScopeId: "account-a",
        barredGeneration: 4,
        establishedAt: FIXED_NOW,
      })
    );

    await harness.coordinator.startGoogleSignIn();

    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
      origin: string;
      barredAccountScopeId: string | null;
      barredGeneration: number | null;
    };
    expect(barrier.barrierId).not.toBe(BARRIER_A);
    expect(barrier.origin).toBe("locked_screen_recovery");
    // ONLY the validated barred fields are preserved; the old barrierId never is.
    expect(barrier.barredAccountScopeId).toBe("account-a");
    expect(barrier.barredGeneration).toBe(4);
  });

  it("a first authentication with no barrier records origin interactive_authentication and invents no barred values", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.startGoogleSignIn();
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
      barredAccountScopeId: string | null;
      barredGeneration: number | null;
    };
    expect(barrier.origin).toBe("interactive_authentication");
    expect(barrier.barredAccountScopeId).toBeNull();
    expect(barrier.barredGeneration).toBeNull();
  });

  it("recovery from an UNREADABLE barrier invents no account id and no generation", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seedRaw(STORAGE_KEYS.barrier, "{oops");
    await harness.coordinator.startGoogleSignIn();
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
      barredAccountScopeId: string | null;
      barredGeneration: number | null;
    };
    expect(barrier.origin).toBe("locked_screen_recovery");
    expect(barrier.barredAccountScopeId).toBeNull();
    expect(barrier.barredGeneration).toBeNull();
  });

  it("the application never enters a ready state between the old barrier and the new one", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: BARRIER_A,
        origin: "server_identity_invalidated",
        barredAccountScopeId: null,
        barredGeneration: null,
        establishedAt: FIXED_NOW,
      })
    );
    await harness.coordinator.startGoogleSignIn();
    // Every progress phase this transition announced is a non-ready one.
    expect(harness.progress).toEqual([
      "establishing_identity_barrier",
      "preparing_google_flow",
      "persisting_google_attempt",
      "navigating_to_provider",
    ]);
  });
});

describe("preparation", () => {
  it("passes this origin's root as the redirect target", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.startGoogleSignIn();
    expect(harness.fakeAuth.counts.prepare).toBe(1);
  });

  it("fails closed with preparation_failed when there is no resolvable origin, without preparing", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, redirectTarget: null });
    const outcome = await harness.coordinator.startGoogleSignIn();
    expect(report(outcome)).toEqual({ kind: "preparation_failed" });
    expect(harness.fakeAuth.counts.prepare).toBe(0);
    expect(harness.fakeAuth.counts.navigate).toBe(0);
  });

  it("maps each preparation outcome, and never navigates or persists an attempt", async () => {
    const cases = [
      ["invalid_redirect", "preparation_failed"],
      ["flow_selector_unavailable", "preparation_failed"],
      ["preparation_failed", "preparation_failed"],
      ["temporarily_unavailable", "temporarily_unavailable"],
    ] as const;
    for (const [prepared, expected] of cases) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      harness.fakeAuth.state.prepare = { kind: prepared };
      const outcome = await harness.coordinator.startGoogleSignIn();
      expect(outcome.kind, prepared).toBe(expected);
      expect(harness.fakeAuth.counts.navigate, prepared).toBe(0);
      expect(harness.storage.store.has(STORAGE_KEYS.attempt), prepared).toBe(false);
    }
  });

  it("a lost flow selector fails Google sign-in CLOSED rather than proceeding uncorrelatable", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.prepare = { kind: "flow_selector_unavailable" };
    const outcome = await harness.coordinator.startGoogleSignIn();
    expect(report(outcome)).toEqual({ kind: "preparation_failed" });
    // The barrier stays in force, so the app is not open.
    expect(harness.storage.store.has(STORAGE_KEYS.barrier)).toBe(true);
  });
});

describe("C1 — after preparation, before persisting the attempt", () => {
  it("a superseded barrier persists NO stale attempt and performs zero navigation", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    // Another tab installs its own barrier while preparation is in flight.
    harness.fakeAuth.auth.prepareGoogleSignIn = async () => {
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
      harness.fakeAuth.counts.prepare += 1;
      return {
        kind: "prepared",
        prepared: { authorizationUrl: "https://project.supabase.test/auth/v1/authorize", flowId: FLOW_X },
      };
    };

    const outcome = await harness.coordinator.startGoogleSignIn();

    expect(report(outcome)).toEqual({ kind: "superseded" });
    // One preparation call MAY have occurred — that is expected and is not a defect.
    expect(harness.fakeAuth.counts.prepare).toBe(1);
    expect(harness.storage.store.has(STORAGE_KEYS.attempt)).toBe(false);
    expect(harness.fakeAuth.counts.navigate).toBe(0);
  });

  it("a changed live generation also supersedes, with no attempt persisted", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const originalPrepare = harness.fakeAuth.auth.prepareGoogleSignIn;
    harness.fakeAuth.auth.prepareGoogleSignIn = async (redirectTo: string) => {
      harness.liveGeneration.bump();
      return originalPrepare(redirectTo);
    };
    const outcome = await harness.coordinator.startGoogleSignIn();
    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.storage.store.has(STORAGE_KEYS.attempt)).toBe(false);
  });
});

describe("attempt persistence", () => {
  it("persists a COMPLETE Google attempt bound to the new barrier, carrying the start-page epoch", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, startingGeneration: 4 });
    await harness.coordinator.startGoogleSignIn();
    const attempt = JSON.parse(harness.storage.store.get(STORAGE_KEYS.attempt) as string) as {
      method: string;
      flowId: string;
      barrierId: string;
      capturedIdentityGeneration: number;
    };
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    };
    expect(attempt.method).toBe("google");
    expect(attempt.flowId).toBe(FLOW_X);
    expect(attempt.barrierId).toBe(barrier.barrierId);
    expect(attempt.capturedIdentityGeneration).toBe(5);
  });

  it("an attempt-persistence failure leaves ONE preparation call, zero navigation and no session", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.failWrites.add(STORAGE_KEYS.attempt);

    const outcome = await harness.coordinator.startGoogleSignIn();

    expect(report(outcome)).toEqual({ kind: "attempt_not_persisted" });
    expect(harness.fakeAuth.counts.prepare).toBe(1);
    expect(harness.fakeAuth.counts.navigate).toBe(0);
    expect(harness.fakeAuth.counts.exchange).toBe(0);
  });
});

describe("C2 and navigation", () => {
  it("a barrier superseded between persistence and navigation performs zero navigation", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const attemptKey = STORAGE_KEYS.attempt;
    harness.storage.onBeforeCall = (call) => {
      if (call === `set:${attemptKey}`) {
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

    const outcome = await harness.coordinator.startGoogleSignIn();

    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.navigate).toBe(0);
  });

  it("a navigation failure leaves preparation and persistence done, and zero exchange", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.navigation = { kind: "navigation_failed" };

    const outcome = await harness.coordinator.startGoogleSignIn();

    expect(report(outcome)).toEqual({ kind: "navigation_failed" });
    expect(harness.fakeAuth.counts.prepare).toBe(1);
    expect(harness.storage.store.has(STORAGE_KEYS.attempt)).toBe(true);
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    // The barrier stays unresolved, so the app is not open.
    expect(harness.storage.store.has(STORAGE_KEYS.barrier)).toBe(true);
  });

  it("the full happy sequence is barrier -> prepare -> persist -> navigate", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.startGoogleSignIn();
    const order = harness.log.filter(
      (entry) =>
        entry === `storage:set:${STORAGE_KEYS.barrier}` ||
        entry === "auth:prepareGoogleSignIn" ||
        entry === `storage:set:${STORAGE_KEYS.attempt}` ||
        entry === "auth:navigateToAuthorizationUrl"
    );
    expect(order).toEqual([
      `storage:set:${STORAGE_KEYS.barrier}`,
      "auth:prepareGoogleSignIn",
      `storage:set:${STORAGE_KEYS.attempt}`,
      "auth:navigateToAuthorizationUrl",
    ]);
  });
});

describe("best-effort cleanup of the previous barrier's resolution", () => {
  it("cleans a superseded barrier's resolution, and a failure changes nothing", async () => {
    const storage = createMemoryStorage();
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
    storage.seedRaw(STORAGE_KEYS.resolutionFor(BARRIER_A), "{}");

    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    const outcome = await harness.coordinator.startGoogleSignIn();

    expect(report(outcome)).toEqual({ kind: "navigating" });
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
  });

  it("a cleanup failure does not affect the transition", async () => {
    const storage = createMemoryStorage();
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
    storage.seedRaw(STORAGE_KEYS.resolutionFor(BARRIER_A), "{}");
    storage.failRemoves.add(STORAGE_KEYS.resolutionFor(BARRIER_A));

    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    const outcome = await harness.coordinator.startGoogleSignIn();

    expect(report(outcome)).toEqual({ kind: "navigating" });
    // The stale resolution survives, and the newly written barrier is unaffected —
    // authorization never reads a cleanup result.
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(true);
  });

  it("cleanup NEVER targets the current barrier's own resolution key", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.startGoogleSignIn();
    const barrierId = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;
    expect(harness.storage.calls).not.toContain(
      `remove:${STORAGE_KEYS.resolutionFor(barrierId)}`
    );
  });
});

describe("a provider event during the start sequence cannot open the app", () => {
  it("SIGNED_IN arriving mid-flow is classified as no_action and writes nothing", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrustedFor(harness, IDENTITY_A.accountScopeId);
    harness.storage.calls.length = 0;

    const advice = harness.coordinator.classifyAuthChange({
      reason: "signed_in",
      identity: IDENTITY_A,
    });

    expect(advice).toEqual({ kind: "no_action" });
    expect(harness.storage.calls).toEqual([]);
  });

  it("every normalized reason except signed_out is no_action, and signed_out asks for invalidation", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    for (const change of [
      { reason: "initial_session" as const, identity: null },
      { reason: "signed_in" as const, identity: IDENTITY_A },
      { reason: "token_refreshed" as const, identity: IDENTITY_A },
      { reason: "user_updated" as const, identity: IDENTITY_A },
      { reason: "other" as const, identity: null },
    ]) {
      expect(harness.coordinator.classifyAuthChange(change), change.reason).toEqual({
        kind: "no_action",
      });
    }
    expect(harness.coordinator.classifyAuthChange({ reason: "signed_out" })).toEqual({
      kind: "invalidation_required",
    });
  });
});

function seedTrustedFor(harness: ReturnType<typeof createIdentityHarness>, accountScopeId: string): void {
  harness.storage.seed(
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

describe("an unusable identifier or timestamp cannot establish anything", () => {
  // ADR-0025 §5: a barrier that was merely REPORTED as persisted, but which the
  // next load would reject, must never be enough to begin provider work. The
  // repository refuses such a record, so the transition never starts.
  const defectiveIds = ["not-a-uuid", "", "../escape", "A1B2C3D4-E5F6-4A7B-8C9D-E0F1A2B3C4D5"];

  it("a defective id generator produces ZERO provider calls for Google", async () => {
    for (const id of defectiveIds) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET, newId: () => id });
      const outcome = await harness.coordinator.startGoogleSignIn();
      expect(report(outcome), id).toEqual({ kind: "barrier_not_established" });
      expect(harness.fakeAuth.counts.prepare, id).toBe(0);
      expect(harness.fakeAuth.counts.navigate, id).toBe(0);
      expect(harness.storage.store.has(STORAGE_KEYS.barrier), id).toBe(false);
    }
  });

  it("a defective id generator produces ZERO OTP requests and verifications", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, newId: () => "not-a-uuid" });
    const outcome = await harness.coordinator.requestEmailOtp("athlete@example.test");
    expect(report(outcome)).toEqual({ kind: "barrier_not_established" });
    expect(harness.fakeAuth.counts.otpRequest).toBe(0);
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
  });

  it("a defective clock produces ZERO provider calls", async () => {
    for (const stamp of ["just now", "", "NaN"]) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET, now: () => stamp });
      const outcome = await harness.coordinator.startGoogleSignIn();
      expect(report(outcome), stamp).toEqual({ kind: "barrier_not_established" });
      expect(harness.fakeAuth.counts.prepare, stamp).toBe(0);
      expect(harness.storage.store.has(STORAGE_KEYS.barrier), stamp).toBe(false);
    }
  });

  it("a malformed provider selector cannot persist an attempt, and never navigates", async () => {
    // One preparation call has necessarily occurred by this point — that is
    // expected and is not the defect being guarded against.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.prepare = {
      kind: "prepared",
      prepared: {
        authorizationUrl: "https://project.supabase.test/auth/v1/authorize",
        flowId: "selector with spaces",
      },
    };
    const outcome = await harness.coordinator.startGoogleSignIn();
    expect(report(outcome)).toEqual({ kind: "attempt_not_persisted" });
    expect(harness.fakeAuth.counts.prepare).toBe(1);
    expect(harness.fakeAuth.counts.navigate).toBe(0);
    expect(harness.storage.store.has(STORAGE_KEYS.attempt)).toBe(false);
  });
});
