// Explicit sign-out and the bounded invitation wrong-account recovery: the exact
// ordering, and the fail-closed rule that **every local failure before the
// provider call produces zero provider sign-out calls** (ADR-0025 §B, §C).
import { describe, expect, it } from "vitest";
import {
  BARRIER_A,
  FIXED_NOW,
  IDENTITY_A,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  authError,
  createIdentityHarness,
  createMemoryStorage,
  type IdentityHarness,
  type MemoryStorage,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createPendingIntent, type PendingIntent } from "../pendingIntentRepository";
import { FLOW_X, ATTEMPT_A } from "./support/identityTestHarness";

const INVITE_TOKEN = "opaque-invitation-token-0001";
const OTHER_TOKEN = "opaque-invitation-token-0002";
const ADMIN_ID = "ffffffff-1111-4111-8111-ffffffffffff";

function invitationIntent(value = INVITE_TOKEN): PendingIntent {
  const intent = createPendingIntent({ kind: "invitation", value, capturedAt: FIXED_NOW });
  if (intent === null) throw new Error("fixture is invalid");
  return intent;
}

function adminIntent(): PendingIntent {
  const intent = createPendingIntent({
    kind: "admin_request",
    value: ADMIN_ID,
    capturedAt: FIXED_NOW,
  });
  if (intent === null) throw new Error("fixture is invalid");
  return intent;
}

function seedSignedInDevice(storage: MemoryStorage): void {
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
}

function requiredStepOrder(harness: IdentityHarness): string[] {
  const relevant = new Set([
    `storage:set:${STORAGE_KEYS.barrier}`,
    `storage:remove:${STORAGE_KEYS.intent}`,
    `storage:set:${STORAGE_KEYS.intent}`,
    `storage:remove:${STORAGE_KEYS.trusted}`,
    `storage:remove:${STORAGE_KEYS.attempt}`,
    "auth:signOut",
  ]);
  return harness.log.filter((entry) => relevant.has(entry));
}

describe("explicit sign-out — the required order", () => {
  it("runs barrier -> intents -> trusted -> attempt -> revalidate -> provider sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    await harness.coordinator.requestEmailOtp("athlete@example.test");
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent());
    harness.log.length = 0;

    const outcome = await harness.coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "signed_out_locked" });
    const order = requiredStepOrder(harness);
    expect(order[0]).toBe(`storage:set:${STORAGE_KEYS.barrier}`);
    expect(order.indexOf(`storage:remove:${STORAGE_KEYS.intent}`)).toBeGreaterThan(0);
    expect(order.indexOf(`storage:remove:${STORAGE_KEYS.trusted}`)).toBeGreaterThan(
      order.indexOf(`storage:remove:${STORAGE_KEYS.intent}`)
    );
    expect(order.indexOf(`storage:remove:${STORAGE_KEYS.attempt}`)).toBeGreaterThan(
      order.indexOf(`storage:remove:${STORAGE_KEYS.trusted}`)
    );
    // The provider call is LAST.
    expect(order[order.length - 1]).toBe("auth:signOut");
    // C8a and C8b: the barrier is revalidated immediately BEFORE the provider
    // call and again AFTER it.
    const signOutIndex = harness.log.indexOf("auth:signOut");
    const barrierReads = harness.log
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry === `storage:get:${STORAGE_KEYS.barrier}`)
      .map(({ index }) => index);
    expect(barrierReads.some((index) => index < signOutIndex)).toBe(true);
    expect(barrierReads.some((index) => index > signOutIndex)).toBe(true);
  });

  it("writes a fresh unresolved barrier even when an older resolution exists", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.resolutionFor(BARRIER_A), {
      schemaVersion: 1,
      barrierId: BARRIER_A,
      attemptId: ATTEMPT_A,
      method: "google",
      flowId: FLOW_X,
      identityGeneration: 1,
      authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
      resolvedAt: FIXED_NOW,
    });

    await harness.coordinator.signOut();

    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
      origin: string;
      barredAccountScopeId: string | null;
    };
    expect(barrier.barrierId).not.toBe(BARRIER_A);
    expect(barrier.origin).toBe("explicit_sign_out");
    // The account being barred is recorded honestly, from the trusted record.
    expect(barrier.barredAccountScopeId).toBe(IDENTITY_A.accountScopeId);
    // The new barrier has no resolution, so an old pair cannot apply.
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(barrier.barrierId))).toBe(false);
  });

  it("a stale provider completion after sign-out cannot resolve the new barrier", async () => {
    const storage = createMemoryStorage();
    seedSignedInDevice(storage);
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await harness.coordinator.signOut();
    const newBarrierId = (JSON.parse(storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;

    // A late verification arriving after sign-out: the old attempt is gone and the
    // epoch has moved, so it is superseded and writes nothing.
    const late = await harness.coordinator.verifyEmailOtp("athlete@example.test", "123456");
    expect(report(late)).toEqual({ kind: "superseded" });
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(newBarrierId))).toBe(false);

    // And a reload is locked.
    const reload = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    const startup = await reload.coordinator.startUp();
    expect(startup.verdict.kind).toBe("quarantined_locked");
  });

  it("a retry writes a NEW barrier and re-runs safely", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);
    const first = await harness.coordinator.signOut();
    expect(report(first)).toEqual({ kind: "trusted_state_not_invalidated" });
    const firstBarrier = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;

    harness.storage.failRemoves.clear();
    const second = await harness.coordinator.signOut();

    expect(report(second)).toEqual({ kind: "signed_out_locked" });
    const secondBarrier = (JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
      origin: string;
    }).barrierId;
    expect(secondBarrier).not.toBe(firstBarrier);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
});

describe("explicit sign-out — every failure point", () => {
  it("a barrier-write failure mutates NO intent and performs ZERO provider sign-out calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent());
    const intentBefore = harness.storage.store.get(STORAGE_KEYS.intent);
    const trustedBefore = harness.storage.store.get(STORAGE_KEYS.trusted);
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "barrier_not_established" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    expect(harness.storage.store.get(STORAGE_KEYS.intent)).toBe(intentBefore);
    expect(harness.storage.store.get(STORAGE_KEYS.trusted)).toBe(trustedBefore);
  });

  it("an intent-deletion failure leaves the app locked with ZERO provider sign-out calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent());
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    // The barrier was already written, so the app is locked regardless.
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("explicit_sign_out");
    // Trusted state was NOT removed — the transition stopped before that step.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("an unreadable intent key is BLOCKED rather than assumed clean", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.failReads.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
  });

  it("a trusted-removal failure leaves the app locked with ZERO provider sign-out calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "trusted_state_not_invalidated" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
  });

  it("a provider sign-out failure still leaves the application locked", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.fakeAuth.state.signOut = authError("sign_out_failed");

    const outcome = await harness.coordinator.signOut();

    // The durable barrier — not the provider call — is the latch.
    expect(report(outcome)).toEqual({ kind: "signed_out_locked" });
    expect(harness.fakeAuth.counts.signOut).toBe(1);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("explicit_sign_out");
  });

  it("a barrier superseded by another tab just before the provider call performs zero sign-out calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.onBeforeCall = (call) => {
      if (call === `remove:${STORAGE_KEYS.trusted}`) {
        harness.storage.onBeforeCall = null;
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
      }
    };

    const outcome = await harness.coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
  });
});

describe("no ordinary intent survives into another account", () => {
  it("an ordinary invitation is deleted by sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent());
    await harness.coordinator.signOut();
    expect(harness.storage.store.has(STORAGE_KEYS.intent)).toBe(false);
  });

  it("an ordinary admin request is deleted by sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, adminIntent());
    await harness.coordinator.signOut();
    expect(harness.storage.store.has(STORAGE_KEYS.intent)).toBe(false);
  });

  it("an intent-deletion failure blocks the account change entirely", async () => {
    // This is precisely what guarantees "no ordinary intent may be replayed under
    // another account": the provider sign-out never happens, so the account never
    // changes while a stale ordinary intent survives.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent());
    harness.storage.failRemoves.add(STORAGE_KEYS.intent);
    await harness.coordinator.signOut();
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    expect(harness.storage.store.has(STORAGE_KEYS.intent)).toBe(true);
  });
});

describe("invitation wrong-account recovery — the eight-step order", () => {
  it("runs barrier -> mark survival -> delete others -> invalidate trusted -> revalidate -> sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent());
    harness.log.length = 0;

    const outcome = await harness.coordinator.recoverInvitationAccount(invitationIntent());

    expect(report(outcome)).toEqual({ kind: "signed_out_locked" });
    const order = requiredStepOrder(harness);
    expect(order[0]).toBe(`storage:set:${STORAGE_KEYS.barrier}`);
    const markIndex = order.indexOf(`storage:set:${STORAGE_KEYS.intent}`);
    const trustedIndex = order.indexOf(`storage:remove:${STORAGE_KEYS.trusted}`);
    expect(markIndex).toBeGreaterThan(0);
    expect(trustedIndex).toBeGreaterThan(markIndex);
    expect(order[order.length - 1]).toBe("auth:signOut");

    // Exactly that invitation survives, marked.
    const intent = JSON.parse(harness.storage.store.get(STORAGE_KEYS.intent) as string) as {
      value: string;
      survival: string;
      capturedAt: string;
    };
    expect(intent.value).toBe(INVITE_TOKEN);
    expect(intent.survival).toBe("invitation_account_recovery");
    expect(intent.capturedAt).toBe(FIXED_NOW);

    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("account_recovery");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("removes a DIFFERENT stored ordinary intent while preserving the recovered one", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent(OTHER_TOKEN));

    await harness.coordinator.recoverInvitationAccount(invitationIntent(INVITE_TOKEN));

    const intent = JSON.parse(harness.storage.store.get(STORAGE_KEYS.intent) as string) as {
      value: string;
      survival: string;
    };
    expect(intent.value).toBe(INVITE_TOKEN);
    expect(intent.survival).toBe("invitation_account_recovery");
  });

  it("REFUSES an admin-request intent — that link gets no recovery transition", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);

    const outcome = await harness.coordinator.recoverInvitationAccount(adminIntent());

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    // Trusted state is untouched: the transition stopped at step 3.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("a barrier failure mutates no intent and performs no provider sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.seed(STORAGE_KEYS.intent, invitationIntent(OTHER_TOKEN));
    const intentBefore = harness.storage.store.get(STORAGE_KEYS.intent);
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.recoverInvitationAccount(invitationIntent());

    expect(report(outcome)).toEqual({ kind: "barrier_not_established" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    expect(harness.storage.store.get(STORAGE_KEYS.intent)).toBe(intentBefore);
  });

  it("a survival-persistence failure stays locked with no provider sign-out, and promises nothing", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.failWrites.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.recoverInvitationAccount(invitationIntent());

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    // Nothing claims the invitation will be replayed: no marker exists.
    expect(harness.storage.store.has(STORAGE_KEYS.intent)).toBe(false);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("an other-intent deletion failure stays locked with no provider sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    // Reading the intent back fails, so "no other ordinary intent remains" cannot
    // be proven.
    harness.storage.onBeforeCall = (call) => {
      if (call === `set:${STORAGE_KEYS.intent}`) {
        harness.storage.onBeforeCall = null;
        harness.storage.failReads.add(STORAGE_KEYS.intent);
      }
    };

    const outcome = await harness.coordinator.recoverInvitationAccount(invitationIntent());

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
  });

  it("a trusted-removal failure stays locked with no provider sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.recoverInvitationAccount(invitationIntent());

    expect(report(outcome)).toEqual({ kind: "trusted_state_not_invalidated" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    // Partial progress is safe: the unresolved recovery barrier is authoritative.
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("account_recovery");
  });

  it("a superseding barrier just before the provider call performs zero sign-out calls", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.onBeforeCall = (call) => {
      if (call === `remove:${STORAGE_KEYS.trusted}`) {
        harness.storage.onBeforeCall = null;
        harness.storage.seed(
          STORAGE_KEYS.barrier,
          createIdentityAccessBarrier({
            barrierId: BARRIER_A,
            origin: "explicit_sign_out",
            barredAccountScopeId: null,
            barredGeneration: null,
            establishedAt: FIXED_NOW,
          })
        );
      }
    };

    const outcome = await harness.coordinator.recoverInvitationAccount(invitationIntent());

    expect(report(outcome)).toEqual({ kind: "superseded" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
  });

  it("after the recovery the app remains LOCKED and normal authentication comes next", async () => {
    const storage = createMemoryStorage();
    seedSignedInDevice(storage);
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await harness.coordinator.recoverInvitationAccount(invitationIntent());

    const reload = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    const startup = await reload.coordinator.startUp();

    expect(startup.verdict).toEqual({ kind: "quarantined_locked", origin: "account_recovery" });
    // The marked invitation survived exactly one sign-out.
    const intent = JSON.parse(storage.store.get(STORAGE_KEYS.intent) as string) as {
      survival: string;
    };
    expect(intent.survival).toBe("invitation_account_recovery");
  });

  it("an absent survival marker after a reload is never INFERRED", async () => {
    const storage = createMemoryStorage();
    seedSignedInDevice(storage);
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    storage.failWrites.add(STORAGE_KEYS.intent);
    await harness.coordinator.recoverInvitationAccount(invitationIntent());
    storage.failWrites.clear();

    // A later page finds nothing, and nothing pretends otherwise.
    expect(storage.store.has(STORAGE_KEYS.intent)).toBe(false);
  });
});
