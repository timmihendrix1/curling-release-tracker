// The save/load round-trip invariant for every identity repository.
//
// **A successful save must imply that the repository's own load validator accepts
// the stored representation.** Without that, a transition can be told "the barrier
// is durably established", go on to call a provider, and only discover on the next
// load that the barrier is `malformed` — leaving the person locked out with a
// session that was created anyway.
//
// The material below is deliberately the kind a DEFECT produces, not the kind a
// caller writes on purpose: a defective id generator, a defective clock, a
// provider selector that lost its shape, an accessor-backed or Proxy-backed
// object, or a `toJSON` that substitutes something else at serialization time.
import { describe, expect, it } from "vitest";
import { createIdentityBarrierRepository } from "../identityBarrierRepository";
import { createInteractiveAttemptRepository } from "../interactiveAttemptRepository";
import { createIdentityBarrierResolutionRepository } from "../identityBarrierResolutionRepository";
import { createTrustedDeviceRepository } from "../trustedDeviceRepository";
import { createPendingIntentRepository, type PendingIntent } from "../pendingIntentRepository";
import { createIdentityAccessBarrier, type IdentityAccessBarrier } from "../identityBarrier";
import {
  createGoogleAttempt,
  type InteractiveAuthAttempt,
} from "../interactiveAttempt";
import {
  createIdentityBarrierResolution,
  type IdentityBarrierResolution,
} from "../identityBarrierResolution";
import { createTrustedDeviceRecord, type TrustedDeviceRecord } from "../trustedDevice";
import {
  ATTEMPT_A,
  BARRIER_A,
  BARRIER_C,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  PROFILE_A,
  STORAGE_KEYS,
  createMemoryStorage,
  type MemoryStorage,
} from "./support/identityTestHarness";

const VALID_BARRIER = createIdentityAccessBarrier({
  barrierId: BARRIER_A,
  origin: "interactive_authentication",
  barredAccountScopeId: null,
  barredGeneration: null,
  establishedAt: FIXED_NOW,
});

const VALID_ATTEMPT = createGoogleAttempt({
  attemptId: ATTEMPT_A,
  flowId: FLOW_X,
  barrierId: BARRIER_A,
  capturedIdentityGeneration: 1,
  startedAt: FIXED_NOW,
});

const VALID_RESOLUTION = createIdentityBarrierResolution({
  barrierId: BARRIER_A,
  attemptId: ATTEMPT_A,
  method: "google",
  flowId: FLOW_X,
  identityGeneration: 1,
  authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
  resolvedAt: FIXED_NOW,
});

const VALID_TRUSTED = createTrustedDeviceRecord({
  accountScopeId: IDENTITY_A.accountScopeId,
  profileId: PROFILE_A,
  displayName: "Athlete",
  onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
  generation: 1,
  establishedAt: FIXED_NOW,
  lastServerConfirmationAt: FIXED_NOW,
});

const VALID_INTENT: PendingIntent = {
  schemaVersion: 1,
  kind: "invitation",
  value: "opaque-invitation-token-0001",
  capturedAt: FIXED_NOW,
  survival: "ordinary",
};

function writeCalls(storage: MemoryStorage): string[] {
  return storage.calls.filter((call) => call.startsWith("set:"));
}

/** Material a defect could plausibly produce for any record: a bad id from a
 * generator, a bad timestamp from a clock, a substituted serialization, and a
 * hostile object. */
function corruptions<T extends object>(valid: T): Array<[string, unknown]> {
  return [
    ["a non-canonical id from a defective generator", { ...valid, schemaVersion: 1, barrierId: "not-a-uuid" }],
    ["an unparseable timestamp from a defective clock", { ...valid, establishedAt: "just now" }],
    ["a wrong schemaVersion", { ...valid, schemaVersion: 2 }],
    ["a Proxy whose traps throw", new Proxy({}, { get() { throw new Error("hostile"); }, ownKeys() { throw new Error("hostile"); } })],
    ["undefined", undefined],
    ["a function", () => valid],
  ];
}

describe("identityBarrierRepository", () => {
  it("a successful save is reloadable", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierRepository(storage.adapter);
    expect(await repository.save(VALID_BARRIER)).toEqual({ ok: true });
    await expect(repository.load()).resolves.toEqual({ status: "value", value: VALID_BARRIER });
  });

  it("REFUSES every corruption and never reaches storage", async () => {
    for (const [label, corrupt] of corruptions(VALID_BARRIER)) {
      const storage = createMemoryStorage();
      const repository = createIdentityBarrierRepository(storage.adapter);
      const result = await repository.save(corrupt as IdentityAccessBarrier);
      expect(result.ok, label).toBe(false);
      expect(writeCalls(storage), label).toEqual([]);
      await expect(repository.load(), label).resolves.toEqual({ status: "absent" });
    }
  });

  it("NEUTRALIZES a hostile toJSON rather than storing its substitution", async () => {
    // The argument is snapshotted into inert plain data before anything serializes
    // it, so a `toJSON` that would have substituted an invalid record simply never
    // runs. The save succeeds and what is stored is the validated snapshot.
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierRepository(storage.adapter);
    const hostile = { ...VALID_BARRIER, toJSON: () => ({ schemaVersion: 2 }) };

    expect(await repository.save(hostile)).toEqual({ ok: true });

    await expect(repository.load()).resolves.toEqual({ status: "value", value: VALID_BARRIER });
    expect(storage.store.get(STORAGE_KEYS.barrier)).not.toContain('"schemaVersion":2');
  });

  it("a defective id generator cannot establish a barrier", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierRepository(storage.adapter);
    // Upper-case hex is rejected rather than normalized, so two spellings of one id
    // can never derive two different resolution keys.
    for (const badId of ["", "barrier-1", "../escape", "A1B2C3D4-E5F6-4A7B-8C9D-E0F1A2B3C4D5"]) {
      const result = await repository.save({ ...VALID_BARRIER, barrierId: badId });
      expect(result.ok, badId).toBe(false);
    }
    expect(storage.store.size).toBe(0);
  });
});

describe("interactiveAttemptRepository", () => {
  it("a successful save is reloadable", async () => {
    const storage = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(storage.adapter);
    expect(await repository.save(VALID_ATTEMPT)).toEqual({ ok: true });
    await expect(repository.load()).resolves.toEqual({ status: "value", value: VALID_ATTEMPT });
  });

  it("REFUSES an attempt whose selector, binding or generation is invalid", async () => {
    const storage = createMemoryStorage();
    const repository = createInteractiveAttemptRepository(storage.adapter);
    const invalid: Array<[string, unknown]> = [
      ["a null barrier binding", { ...VALID_ATTEMPT, barrierId: null }],
      ["a malformed provider selector", { ...VALID_ATTEMPT, flowId: "has space" }],
      ["a Google attempt with no selector", { ...VALID_ATTEMPT, flowId: null }],
      ["an OTP attempt carrying a selector", { ...VALID_ATTEMPT, method: "email_otp" }],
      ["a fractional generation", { ...VALID_ATTEMPT, capturedIdentityGeneration: 1.5 }],
      ["an unparseable startedAt", { ...VALID_ATTEMPT, startedAt: "soon" }],
    ];
    for (const [label, record] of invalid) {
      const result = await repository.save(record as InteractiveAuthAttempt);
      expect(result.ok, label).toBe(false);
    }
    expect(writeCalls(storage)).toEqual([]);
  });
});

describe("identityBarrierResolutionRepository", () => {
  it("a successful save is reloadable under the same barrier", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    expect(await repository.saveForBarrier(VALID_RESOLUTION)).toEqual({ ok: true });
    await expect(repository.loadForBarrier(BARRIER_A)).resolves.toEqual({
      status: "value",
      value: VALID_RESOLUTION,
    });
  });

  it("uses ONE validated barrierId for the key, the stored record and the comparison", async () => {
    // A `toJSON` substituting a different barrier would, without the snapshot,
    // store a record under barrier A's key that names barrier C.
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    const hostile = {
      ...VALID_RESOLUTION,
      toJSON: () => ({ ...VALID_RESOLUTION, barrierId: BARRIER_C }),
    };

    expect(await repository.saveForBarrier(hostile)).toEqual({ ok: true });

    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(true);
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(false);
    await expect(repository.loadForBarrier(BARRIER_A)).resolves.toEqual({
      status: "value",
      value: VALID_RESOLUTION,
    });
  });

  it("reads each security-relevant property EXACTLY ONCE", async () => {
    // A getter that answers differently on a second read cannot make the key and
    // the stored record disagree.
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    let reads = 0;
    const changing = {
      ...VALID_RESOLUTION,
      get barrierId(): string {
        reads += 1;
        return reads === 1 ? BARRIER_A : BARRIER_C;
      },
    };

    expect(await repository.saveForBarrier(changing)).toEqual({ ok: true });

    expect(reads).toBe(1);
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(true);
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(false);
  });

  it("REFUSES a resolution its own loader would reject, and writes nothing", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    const invalid: Array<[string, unknown]> = [
      ["an unaddressable barrier id", { ...VALID_RESOLUTION, barrierId: "../escape" }],
      ["a non-canonical attempt id", { ...VALID_RESOLUTION, attemptId: "attempt" }],
      ["a blank account scope", { ...VALID_RESOLUTION, authenticatedAccountScopeId: "" }],
      ["an unparseable resolvedAt", { ...VALID_RESOLUTION, resolvedAt: "later" }],
    ];
    for (const [label, record] of invalid) {
      const result = await repository.saveForBarrier(record as IdentityBarrierResolution);
      expect(result.ok, label).toBe(false);
    }
    expect(writeCalls(storage)).toEqual([]);
  });
});

describe("trustedDeviceRepository", () => {
  it("a successful save is reloadable", async () => {
    const storage = createMemoryStorage();
    const repository = createTrustedDeviceRepository(storage.adapter);
    expect(await repository.save(VALID_TRUSTED)).toEqual({ ok: true });
    await expect(repository.load()).resolves.toEqual({ status: "value", value: VALID_TRUSTED });
  });

  it("REFUSES a record with a missing or invalid identity fact", async () => {
    const storage = createMemoryStorage();
    const repository = createTrustedDeviceRepository(storage.adapter);
    const invalid: Array<[string, unknown]> = [
      ["a non-canonical profile id", { ...VALID_TRUSTED, profileId: "profile" }],
      ["a blank display name", { ...VALID_TRUSTED, displayName: "  " }],
      ["an entitlement other than free", { ...VALID_TRUSTED, entitlement: "pro" }],
      ["an unparseable onboarding timestamp", { ...VALID_TRUSTED, onboardingCompletedAt: "someday" }],
      ["a blank account scope", { ...VALID_TRUSTED, accountScopeId: "" }],
    ];
    for (const [label, record] of invalid) {
      const result = await repository.save(record as TrustedDeviceRecord);
      expect(result.ok, label).toBe(false);
    }
    expect(writeCalls(storage)).toEqual([]);
    expect(storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
});

describe("pendingIntentRepository", () => {
  it("a successful save is reloadable, and so are both survival mutations", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    expect(await repository.save(VALID_INTENT)).toEqual({ ok: true });
    await expect(repository.load()).resolves.toEqual({ status: "value", value: VALID_INTENT });

    expect(await repository.markInvitationForRecovery(VALID_INTENT)).toEqual({ ok: true });
    const marked = await repository.load();
    expect(marked.status).toBe("value");

    expect(await repository.settleIntentBeforeReady()).toEqual({ kind: "applied" });
    const reset = await repository.load();
    expect(reset.status === "value" && reset.value.survival).toBe("ordinary");
  });

  it("REFUSES an intent whose value does not match its kind", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    const invalid: Array<[string, unknown]> = [
      ["an admin request carrying a non-UUID", { ...VALID_INTENT, kind: "admin_request" }],
      ["an invitation with whitespace", { ...VALID_INTENT, value: "has space" }],
      ["an oversized invitation token", { ...VALID_INTENT, value: "x".repeat(513) }],
      ["an unknown survival", { ...VALID_INTENT, survival: "forever" }],
      ["an unparseable capturedAt", { ...VALID_INTENT, capturedAt: "then" }],
    ];
    for (const [label, record] of invalid) {
      const result = await repository.save(record as PendingIntent);
      expect(result.ok, label).toBe(false);
    }
    expect(writeCalls(storage)).toEqual([]);
  });
});
