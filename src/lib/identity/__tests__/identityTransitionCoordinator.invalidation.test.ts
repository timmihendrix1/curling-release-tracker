// The server-driven invalidation transition, the honest double-failure state, and
// cross-tab barrier observation (ADR-0025 §5, §8, §14).
//
// The ordering here is deliberately DIFFERENT from a deliberate transition's, and
// that difference is the point: by the time a negative result arrives the
// application is already running and may already be showing content, so denial
// happens in memory FIRST and only then becomes durable.
import { describe, expect, it } from "vitest";
import {
  BARRIER_A,
  BARRIER_C,
  FIXED_NOW,
  IDENTITY_A,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  createIdentityHarness,
  createMemoryStorage,
  holdStorageCall,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { ATTEMPT_A, FLOW_X } from "./support/identityTestHarness";
import type { MemoryStorage } from "./support/identityTestHarness";

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

describe("the invalidation transition", () => {
  it("denies in memory BEFORE attempting any durable write", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.log.length = 0;

    const outcome = await harness.coordinator.invalidateIdentity();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    const denial = harness.log.indexOf("progress:identity_denied_in_memory");
    const firstWrite = harness.log.findIndex(
      (entry) => entry.startsWith("storage:set:") || entry.startsWith("storage:remove:")
    );
    expect(denial).toBeGreaterThanOrEqual(0);
    expect(firstWrite).toBeGreaterThan(denial);
  });

  it("cannot be superseded into a non-denial while its metadata read is delayed", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    const held = holdStorageCall(harness.storage, `get:${STORAGE_KEYS.trusted}`);

    const invalidation = harness.coordinator.invalidateIdentity();
    await held.reached;
    expect(harness.progress).toContain("identity_denied_in_memory");

    const newer = harness.coordinator.requestEmailOtp("athlete@example.test");
    held.release();

    const outcome = await invalidation;
    await newer;
    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(outcome.denial).toBe("server_identity_invalidated");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("writes the unresolved invalidation barrier BEFORE removing the trusted record", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.storage.calls.length = 0;

    await harness.coordinator.invalidateIdentity();

    const barrierWrite = harness.storage.calls.indexOf(`set:${STORAGE_KEYS.barrier}`);
    const removal = harness.storage.calls.indexOf(`remove:${STORAGE_KEYS.trusted}`);
    expect(barrierWrite).toBeGreaterThanOrEqual(0);
    expect(removal).toBeGreaterThan(barrierWrite);

    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
      barredAccountScopeId: string | null;
    };
    expect(barrier.origin).toBe("server_identity_invalidated");
    // The barred account is recorded honestly, from the record being invalidated.
    expect(barrier.barredAccountScopeId).toBe(IDENTITY_A.accountScopeId);
  });

  it("stays safe when the barrier succeeded and the removal failed", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.invalidateIdentity();

    expect(report(outcome)).toEqual({ kind: "trusted_state_not_invalidated" });
    // The stale record survives but can never be honoured: the unresolved
    // invalidation barrier denies on every later load.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
    const reload = createIdentityHarness({ url: REDIRECT_TARGET, storage: harness.storage });
    reload.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const startup = await reload.coordinator.startUp();
    expect(startup.verdict).toEqual({
      kind: "quarantined_locked",
      origin: "server_identity_invalidated",
    });
  });

  it("falls back to trusted removal when the barrier write fails, and stays denied", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.invalidateIdentity();

    // The fallback IS attempted — the transition does not stop at the failed
    // barrier.
    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);

    // A later offline reload cannot honour the removed record.
    const reload = createIdentityHarness({ url: REDIRECT_TARGET, storage: harness.storage });
    reload.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const startup = await reload.coordinator.startUp();
    expect(startup.verdict).toEqual({ kind: "identity_unconfirmed" });
  });

  it("reports durable_denial_unavailable honestly when BOTH mechanisms fail", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    const trustedBefore = harness.storage.store.get(STORAGE_KEYS.trusted);
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.invalidateIdentity();

    expect(report(outcome)).toEqual({ kind: "durable_denial_unavailable" });
    // Nothing durable changed, and nothing claims otherwise.
    expect(harness.storage.store.get(STORAGE_KEYS.trusted)).toBe(trustedBefore);
    expect(harness.storage.store.has(STORAGE_KEYS.barrier)).toBe(false);
  });

  it("never produces a ready state, in any of the four failure combinations", async () => {
    const combinations: Array<[boolean, boolean]> = [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ];
    for (const [failBarrier, failRemove] of combinations) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      seedTrusted(harness.storage);
      if (failBarrier) harness.storage.failWrites.add(STORAGE_KEYS.barrier);
      if (failRemove) harness.storage.failRemoves.add(STORAGE_KEYS.trusted);
      const outcome = await harness.coordinator.invalidateIdentity();
      expect(["identity_invalidated", "trusted_state_not_invalidated", "durable_denial_unavailable"]).toContain(
        outcome.kind
      );
    }
  });

  it("the invalidation barrier is NEVER treated as resolved — recovery needs a new transition", async () => {
    const storage = createMemoryStorage();
    seedTrusted(storage);
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await harness.coordinator.invalidateIdentity();
    const invalidationBarrierId = (JSON.parse(storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;

    // Even a perfectly-formed old resolution cannot complete it.
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(invalidationBarrierId))).toBe(false);
    const reload = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    const startup = await reload.coordinator.startUp();
    expect(startup.verdict.kind).toBe("quarantined_locked");

    // Recovery writes a NEW barrier.
    const recovery = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await recovery.coordinator.requestEmailOtp("athlete@example.test");
    const newBarrier = JSON.parse(storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
      origin: string;
    };
    expect(newBarrier.barrierId).not.toBe(invalidationBarrierId);
    expect(newBarrier.origin).toBe("locked_screen_recovery");
  });

  it("invents no offline expiry — it records a negative fact only after learning it online", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness.storage);
    // Offline: nothing is learned, so nothing is invalidated.
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const outcome = await harness.coordinator.revalidateGateFacts();
    expect(report(outcome)).toEqual({ kind: "temporarily_unavailable" });
    expect(harness.storage.store.has(STORAGE_KEYS.barrier)).toBe(false);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });
});

describe("cross-tab barrier observation", () => {
  it("reports unchanged when nothing has changed", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await expect(harness.coordinator.observeNewerBarrier()).resolves.toEqual({ kind: "unchanged" });
    await harness.coordinator.startGoogleSignIn();
    await expect(harness.coordinator.observeNewerBarrier()).resolves.toEqual({ kind: "unchanged" });
  });

  it("reports a newer barrier and INVALIDATES this page's live attempt", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await harness.coordinator.requestEmailOtp("athlete@example.test");
    const epochBefore = harness.liveGeneration.current();

    harness.storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: BARRIER_C,
        origin: "explicit_sign_out",
        barredAccountScopeId: null,
        barredGeneration: null,
        establishedAt: FIXED_NOW,
      })
    );

    await expect(harness.coordinator.observeNewerBarrier()).resolves.toEqual({
      kind: "newer_barrier",
    });
    expect(harness.liveGeneration.current()).toBeGreaterThan(epochBefore);

    // The live verification can no longer complete.
    const outcome = await harness.coordinator.verifyEmailOtp("athlete@example.test", "123456");
    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.otpVerify).toBe(0);
  });

  it("treats a malformed barrier as a change — deny-ward", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seedRaw(STORAGE_KEYS.barrier, "{oops");
    await expect(harness.coordinator.observeNewerBarrier()).resolves.toEqual({
      kind: "newer_barrier",
    });
  });

  it("treats an UNREADABLE barrier as unchanged — a failed read proves nothing", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.failReads.add(STORAGE_KEYS.barrier);
    await expect(harness.coordinator.observeNewerBarrier()).resolves.toEqual({ kind: "unchanged" });
  });

  it("a stale operation cannot resolve or supersede the newer barrier", async () => {
    // The honest guarantee (ADR-0025 §8): cross-tab delivery is not instantaneous,
    // but a stale operation can never persistently resolve or supersede the newer
    // barrier — and each tab denies once it observes it.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
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
    harness.storage.seed(
      STORAGE_KEYS.attempt,
      createGoogleAttempt({
        attemptId: ATTEMPT_A,
        flowId: FLOW_X,
        barrierId: BARRIER_A,
        capturedIdentityGeneration: 1,
        startedAt: FIXED_NOW,
      })
    );
    // Another tab installs barrier C.
    harness.storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: BARRIER_C,
        origin: "explicit_sign_out",
        barredAccountScopeId: null,
        barredGeneration: null,
        establishedAt: FIXED_NOW,
      })
    );

    const startup = await harness.coordinator.startUp();

    expect(startup.verdict).toEqual({
      kind: "quarantined_locked",
      origin: "explicit_sign_out",
    });
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(false);
    expect(harness.storage.calls).not.toContain(`remove:${STORAGE_KEYS.barrier}`);
  });
});
