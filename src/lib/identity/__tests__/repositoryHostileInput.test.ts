// Public repository inputs are untrusted AT RUNTIME, whatever their declared type
// says. A caller can hand over a Proxy, an object with throwing or changing
// getters, hostile `ownKeys`/`getOwnPropertyDescriptor` traps, or a `toJSON` that
// substitutes something else at serialization time.
//
// The discipline every public write follows: snapshot the argument into inert
// plain data FIRST, reading each security-relevant property exactly once, and only
// then derive a key, spread, serialize or store. The two methods the review named
// are covered exhaustively; the others share the same helper and are covered in
// recordPersistenceRoundTrip.test.ts.
import { describe, expect, it } from "vitest";
import { createIdentityBarrierResolutionRepository } from "../identityBarrierResolutionRepository";
import { createPendingIntentRepository, type PendingIntent } from "../pendingIntentRepository";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import {
  ATTEMPT_A,
  BARRIER_A,
  BARRIER_C,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  STORAGE_KEYS,
  createMemoryStorage,
} from "./support/identityTestHarness";

const SECRET = "sb_secret_must_not_travel";

const VALID_RESOLUTION = createIdentityBarrierResolution({
  barrierId: BARRIER_A,
  attemptId: ATTEMPT_A,
  method: "google",
  flowId: FLOW_X,
  identityGeneration: 1,
  authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
  resolvedAt: FIXED_NOW,
});

const VALID_INTENT: PendingIntent = {
  schemaVersion: 1,
  kind: "invitation",
  value: "opaque-invitation-token-0001",
  capturedAt: FIXED_NOW,
  survival: "ordinary",
};

/**
 * Hostile shapes that are genuinely UNUSABLE: the snapshot cannot read a complete,
 * valid record out of them, so the write must be refused and nothing stored.
 */
function unusableInputs(valid: object): Array<[string, unknown]> {
  return [
    ["a Proxy whose get trap throws", new Proxy({}, { get() { throw new Error(SECRET); } })],
    ["a revoked Proxy", (() => { const r = Proxy.revocable({ ...valid }, {}); r.revoke(); return r.proxy; })()],
    ["an Error-throwing getter", { ...valid, get schemaVersion(): number { throw new Error(SECRET); } }],
    ["a string-throwing getter", { ...valid, get schemaVersion(): number { throw SECRET; } }],
    ["a Symbol-throwing getter", { ...valid, get schemaVersion(): number { throw Symbol(SECRET); } }],
    ["a null-throwing getter", { ...valid, get schemaVersion(): number { throw null; } }],
    ["null", null],
    ["undefined", undefined],
    ["a string", SECRET],
    ["a number", 7],
    ["an array", [valid]],
    ["a function", () => valid],
  ];
}

/**
 * Hostile shapes that are NEUTRALIZED rather than rejected. Their traps fire only
 * on enumeration — `ownKeys`, `getOwnPropertyDescriptor` — which the snapshot never
 * performs: it reads named properties through the contained reader and builds a
 * fresh plain object. So the trap never runs, and the correct data is stored.
 *
 * That is the point of snapshotting before spreading: a spread WOULD have invoked
 * these traps.
 */
function neutralizedInputs(valid: object): Array<[string, unknown]> {
  return [
    [
      "a Proxy whose ownKeys trap throws",
      new Proxy({ ...valid }, { ownKeys() { throw new Error(SECRET); } }),
    ],
    [
      "a Proxy whose getOwnPropertyDescriptor trap throws",
      new Proxy({ ...valid }, { getOwnPropertyDescriptor() { throw new Error(SECRET); } }),
    ],
  ];
}

function allHostileInputs(valid: object): Array<[string, unknown]> {
  return [...unusableInputs(valid), ...neutralizedInputs(valid)];
}

function writeCalls(storage: ReturnType<typeof createMemoryStorage>): string[] {
  return storage.calls.filter((call) => call.startsWith("set:"));
}

describe("identityBarrierResolutionRepository.saveForBarrier", () => {
  it("contains every hostile input, resolves a closed outcome, and writes nothing", async () => {
    for (const [label, input] of unusableInputs(VALID_RESOLUTION)) {
      const storage = createMemoryStorage();
      const repository = createIdentityBarrierResolutionRepository(storage.adapter);

      const result = await repository.saveForBarrier(input as never);

      expect(result.ok, label).toBe(false);
      expect(writeCalls(storage), label).toEqual([]);
      expect(storage.store.size, label).toBe(0);
      // No identifier, key, stored value or thrown material escapes.
      const serialized = JSON.stringify(result) ?? "";
      expect(serialized, label).not.toContain(SECRET);
      expect(serialized, label).not.toContain(BARRIER_A);
      expect(serialized, label).not.toContain("curling.identity");
    }
  });

  it("reads barrierId ONCE, so the key and the stored record cannot disagree", async () => {
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
    const stored = JSON.parse(storage.store.get(STORAGE_KEYS.resolutionFor(BARRIER_A)) as string) as {
      barrierId: string;
    };
    expect(stored.barrierId).toBe(BARRIER_A);
  });

  it("a hostile toJSON cannot influence what is stored", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    const substituting = {
      ...VALID_RESOLUTION,
      toJSON: () => ({ ...VALID_RESOLUTION, barrierId: BARRIER_C, authenticatedAccountScopeId: SECRET }),
    };

    expect(await repository.saveForBarrier(substituting)).toEqual({ ok: true });

    const stored = storage.store.get(STORAGE_KEYS.resolutionFor(BARRIER_A)) as string;
    expect(stored).not.toContain(SECRET);
    expect(stored).not.toContain(BARRIER_C);
    await expect(repository.loadForBarrier(BARRIER_A)).resolves.toEqual({
      status: "value",
      value: VALID_RESOLUTION,
    });
  });

  it("NEUTRALIZES an enumeration trap: it never runs, and the correct record is stored", async () => {
    for (const [label, input] of neutralizedInputs(VALID_RESOLUTION)) {
      const storage = createMemoryStorage();
      const repository = createIdentityBarrierResolutionRepository(storage.adapter);

      expect(await repository.saveForBarrier(input as never), label).toEqual({ ok: true });

      // The snapshot reads named properties, never enumerates — so the trap that
      // a spread would have fired never fires at all.
      expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A)), label).toBe(true);
      expect(storage.store.get(STORAGE_KEYS.resolutionFor(BARRIER_A)), label).not.toContain(SECRET);
      await expect(repository.loadForBarrier(BARRIER_A), label).resolves.toEqual({
        status: "value",
        value: VALID_RESOLUTION,
      });
    }
  });

  it("never rejects, for any hostile input", async () => {
    const repository = createIdentityBarrierResolutionRepository(createMemoryStorage().adapter);
    for (const [label, input] of allHostileInputs(VALID_RESOLUTION)) {
      await expect(repository.saveForBarrier(input as never), label).resolves.toBeDefined();
    }
  });
});

describe("pendingIntentRepository.markInvitationForRecovery", () => {
  it("contains every hostile input, resolves a closed outcome, and writes nothing", async () => {
    for (const [label, input] of unusableInputs(VALID_INTENT)) {
      const storage = createMemoryStorage();
      const repository = createPendingIntentRepository(storage.adapter);

      const result = await repository.markInvitationForRecovery(input as never);

      expect(result.ok, label).toBe(false);
      expect(writeCalls(storage), label).toEqual([]);
      const serialized = JSON.stringify(result) ?? "";
      expect(serialized, label).not.toContain(SECRET);
      expect(serialized, label).not.toContain(VALID_INTENT.value);
      expect(serialized, label).not.toContain("curling.identity");
    }
  });

  it("reads `kind` ONCE: the kind that is checked is the kind that is stored", async () => {
    // Without a snapshot, a getter answering "invitation" first and
    // "admin_request" second could pass the check and then be spread into storage.
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    let reads = 0;
    const changing = {
      ...VALID_INTENT,
      get kind(): PendingIntent["kind"] {
        reads += 1;
        return reads === 1 ? "invitation" : "admin_request";
      },
    };

    const result = await repository.markInvitationForRecovery(changing);

    expect(reads).toBe(1);
    expect(result).toEqual({ ok: true });
    const stored = JSON.parse(storage.store.get(STORAGE_KEYS.intent) as string) as {
      kind: string;
      survival: string;
    };
    expect(stored.kind).toBe("invitation");
    expect(stored.survival).toBe("invitation_account_recovery");
  });

  it("REFUSES an admin request, and does not spread it into storage", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    const adminRequest: PendingIntent = {
      schemaVersion: 1,
      kind: "admin_request",
      value: "ffffffff-1111-4111-8111-ffffffffffff",
      capturedAt: FIXED_NOW,
      survival: "ordinary",
    };

    const result = await repository.markInvitationForRecovery(adminRequest);

    expect(result.ok).toBe(false);
    expect(writeCalls(storage)).toEqual([]);
    expect(JSON.stringify(result) ?? "").not.toContain(adminRequest.value);
  });

  it("a hostile toJSON cannot influence what is stored", async () => {
    const storage = createMemoryStorage();
    const repository = createPendingIntentRepository(storage.adapter);
    const substituting = {
      ...VALID_INTENT,
      toJSON: () => ({ ...VALID_INTENT, kind: "admin_request", value: SECRET }),
    };

    expect(await repository.markInvitationForRecovery(substituting)).toEqual({ ok: true });

    const stored = storage.store.get(STORAGE_KEYS.intent) as string;
    expect(stored).not.toContain(SECRET);
    expect(stored).toContain(VALID_INTENT.value);
  });

  it("NEUTRALIZES an enumeration trap: it never runs, and the correct record is stored", async () => {
    for (const [label, input] of neutralizedInputs(VALID_INTENT)) {
      const storage = createMemoryStorage();
      const repository = createPendingIntentRepository(storage.adapter);

      expect(await repository.markInvitationForRecovery(input as never), label).toEqual({ ok: true });

      const stored = storage.store.get(STORAGE_KEYS.intent) as string;
      expect(stored, label).not.toContain(SECRET);
      expect(stored, label).toContain("invitation_account_recovery");
    }
  });

  it("never rejects, for any hostile input", async () => {
    const repository = createPendingIntentRepository(createMemoryStorage().adapter);
    for (const [label, input] of allHostileInputs(VALID_INTENT)) {
      await expect(repository.markInvitationForRecovery(input as never), label).resolves.toBeDefined();
    }
  });
});

describe("the same discipline holds for every other public write", () => {
  it("pendingIntentRepository.save contains hostile input and writes nothing", async () => {
    for (const [label, input] of unusableInputs(VALID_INTENT)) {
      const storage = createMemoryStorage();
      const repository = createPendingIntentRepository(storage.adapter);
      const result = await repository.save(input as never);
      expect(result.ok, label).toBe(false);
      expect(writeCalls(storage), label).toEqual([]);
      expect(JSON.stringify(result) ?? "", label).not.toContain(SECRET);
    }
  });
});
