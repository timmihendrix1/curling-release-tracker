// The audited untrusted-input primitives (Stage B0.2c). Every identity validator
// and the identity RPC mapper read through this module, so "a malformed, partial,
// hostile or Proxy-backed value fails closed WITHOUT throwing" is proven once,
// here, rather than re-argued in six places.
import { describe, expect, it, vi } from "vitest";
import {
  hasSupportedSchemaVersion,
  isCanonicalUuid,
  isOpaqueIdentifier,
  isRecordLike,
  isValidTimestamp,
  parseUntrustedJson,
  readIdentityRecord,
  readUntrustedFiniteNumber,
  readUntrustedLiteral,
  readUntrustedNonNegativeInteger,
  readUntrustedNullableFiniteNumber,
  readUntrustedNullableNonNegativeInteger,
  readUntrustedNullableOpaqueId,
  readUntrustedNullableString,
  readUntrustedOpaqueId,
  readUntrustedProperty,
  readUntrustedString,
  readUntrustedTimestamp,
  readUntrustedUuid,
  removeIdentityRecord,
  writeIdentityRecord,
} from "../untrustedValue";
import type {
  PersistenceWriteResult,
  RemovableStorageAdapter,
  StorageGetResult,
} from "../../persistence/types";

const UUID = "11111111-1111-4111-8111-111111111111";
const MIXED_CASE_UUID = "a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5";

/** Three shapes of hostility, all of which must be contained rather than
 * inspected: a getter that throws, a Proxy whose traps throw, and a thrown value
 * that is not an `Error` at all. */
function throwingGetter(): object {
  return {
    get anything(): never {
      throw new Error("hostile getter");
    },
  };
}

function hostileProxy(thrown: unknown): object {
  return new Proxy(
    {},
    {
      get() {
        throw thrown;
      },
      has() {
        throw thrown;
      },
      getOwnPropertyDescriptor() {
        throw thrown;
      },
      ownKeys() {
        throw thrown;
      },
    }
  );
}

describe("isRecordLike", () => {
  it("accepts plain objects and a Proxy without invoking any trap", () => {
    expect(isRecordLike({})).toBe(true);
    // A trap that throws must not be reached by the predicate itself.
    expect(() => isRecordLike(hostileProxy(new Error("x")))).not.toThrow();
    expect(isRecordLike(hostileProxy(new Error("x")))).toBe(true);
  });

  it("rejects null, arrays and primitives", () => {
    for (const value of [null, undefined, [], [1], "s", 1, true, Symbol("s")]) {
      expect(isRecordLike(value)).toBe(false);
    }
  });
});

describe("readUntrustedProperty", () => {
  it("reads an ordinary property", () => {
    expect(readUntrustedProperty({ a: 1 }, "a")).toBe(1);
  });

  it("resolves undefined instead of throwing for a throwing getter", () => {
    expect(() => readUntrustedProperty(throwingGetter(), "anything")).not.toThrow();
    expect(readUntrustedProperty(throwingGetter(), "anything")).toBeUndefined();
  });

  it("resolves undefined for a Proxy trap that throws an Error, a string, a Symbol or null", () => {
    for (const thrown of [new Error("e"), "a string", Symbol("s"), null, undefined, 0]) {
      expect(() => readUntrustedProperty(hostileProxy(thrown), "a")).not.toThrow();
      expect(readUntrustedProperty(hostileProxy(thrown), "a")).toBeUndefined();
    }
  });

  it("resolves undefined for a non-record source", () => {
    expect(readUntrustedProperty(null, "a")).toBeUndefined();
    expect(readUntrustedProperty("string", "length")).toBeUndefined();
  });
});

describe("typed readers", () => {
  it("readUntrustedString accepts a non-empty string only", () => {
    expect(readUntrustedString({ a: "x" }, "a")).toBe("x");
    for (const value of ["", null, undefined, 1, {}]) {
      expect(readUntrustedString({ a: value }, "a")).toBeNull();
    }
  });

  it("readUntrustedString never trims", () => {
    expect(readUntrustedString({ a: "  x  " }, "a")).toBe("  x  ");
  });

  it("readUntrustedNullableString distinguishes a legitimate null from unusable", () => {
    expect(readUntrustedNullableString({ a: null }, "a")).toEqual({ present: true, value: null });
    expect(readUntrustedNullableString({ a: "x" }, "a")).toEqual({ present: true, value: "x" });
    expect(readUntrustedNullableString({ a: 1 }, "a")).toEqual({ present: false });
    expect(readUntrustedNullableString({}, "a")).toEqual({ present: false });
  });

  it("readUntrustedFiniteNumber rejects NaN, Infinity and numeric strings", () => {
    expect(readUntrustedFiniteNumber({ a: 3 }, "a")).toBe(3);
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, "3", null]) {
      expect(readUntrustedFiniteNumber({ a: value }, "a")).toBeNull();
    }
  });

  it("readUntrustedNullableFiniteNumber distinguishes null from unusable", () => {
    expect(readUntrustedNullableFiniteNumber({ a: null }, "a")).toEqual({
      present: true,
      value: null,
    });
    expect(readUntrustedNullableFiniteNumber({ a: Number.NaN }, "a")).toEqual({ present: false });
  });

  it("readUntrustedNonNegativeInteger rejects fractions and negatives", () => {
    expect(readUntrustedNonNegativeInteger({ a: 0 }, "a")).toBe(0);
    expect(readUntrustedNonNegativeInteger({ a: 7 }, "a")).toBe(7);
    for (const value of [-1, 1.5, Number.NaN, "1", null]) {
      expect(readUntrustedNonNegativeInteger({ a: value }, "a")).toBeNull();
    }
  });

  it("readUntrustedNullableNonNegativeInteger distinguishes null from unusable", () => {
    expect(readUntrustedNullableNonNegativeInteger({ a: null }, "a")).toEqual({
      present: true,
      value: null,
    });
    expect(readUntrustedNullableNonNegativeInteger({ a: -1 }, "a")).toEqual({ present: false });
  });

  it("readUntrustedLiteral accepts only a member of the closed set", () => {
    const allowed = ["one", "two"] as const;
    expect(readUntrustedLiteral({ a: "one" }, "a", allowed)).toBe("one");
    for (const value of ["three", "", null, 1, {}]) {
      expect(readUntrustedLiteral({ a: value }, "a", allowed)).toBeNull();
    }
  });

  it("readUntrustedTimestamp requires a string that parses to a real instant", () => {
    expect(readUntrustedTimestamp({ a: "2026-03-01T10:00:00.000Z" }, "a")).toBe(
      "2026-03-01T10:00:00.000Z"
    );
    for (const value of ["", "not-a-date", 1767225600, null]) {
      expect(readUntrustedTimestamp({ a: value }, "a")).toBeNull();
    }
  });

  it("readUntrustedTimestamp returns the ORIGINAL string, never a re-serialization", () => {
    // A record's own timestamp is never silently rewritten into a different
    // representation of the same instant.
    expect(readUntrustedTimestamp({ a: "2026-03-01T10:00:00+00:00" }, "a")).toBe(
      "2026-03-01T10:00:00+00:00"
    );
  });

  it("every typed reader contains a hostile source", () => {
    const proxy = hostileProxy(Symbol("boom"));
    expect(readUntrustedString(proxy, "a")).toBeNull();
    expect(readUntrustedNullableString(proxy, "a")).toEqual({ present: false });
    expect(readUntrustedFiniteNumber(proxy, "a")).toBeNull();
    expect(readUntrustedNonNegativeInteger(proxy, "a")).toBeNull();
    expect(readUntrustedLiteral(proxy, "a", ["x"] as const)).toBeNull();
    expect(readUntrustedTimestamp(proxy, "a")).toBeNull();
    expect(readUntrustedUuid(proxy, "a")).toBeNull();
    expect(readUntrustedOpaqueId(proxy, "a", 32)).toBeNull();
    expect(readUntrustedNullableOpaqueId(proxy, "a", 32)).toEqual({ present: false });
    expect(hasSupportedSchemaVersion(proxy, 1)).toBe(false);
  });
});

describe("isCanonicalUuid", () => {
  it("accepts a lower-case hyphenated RFC-4122-shaped value", () => {
    expect(isCanonicalUuid(UUID)).toBe(true);
    expect(isCanonicalUuid(MIXED_CASE_UUID)).toBe(true);
    expect(isCanonicalUuid("00000000-0000-4000-8000-000000000001")).toBe(true);
  });

  it("rejects everything that could reach a derived storage key", () => {
    for (const value of [
      // Upper-case hex is rejected rather than normalized. The fixture below has
      // to contain hex LETTERS for that to be a real case — an all-digit UUID is
      // unchanged by `toUpperCase()`.
      MIXED_CASE_UUID.toUpperCase(),
      "11111111111141118111111111111111",
      "11111111-1111-4111-8111-11111111111",
      "../../etc/passwd",
      "11111111-1111-4111-8111-111111111111.v1",
      "*",
      "",
      null,
      undefined,
      7,
      { toString: () => UUID },
      // A version nibble of 0 and a variant nibble outside [89ab] are both
      // outside the canonical shape.
      "11111111-1111-0111-8111-111111111111",
      "11111111-1111-4111-c111-111111111111",
    ]) {
      expect(isCanonicalUuid(value), String(typeof value)).toBe(false);
    }
  });
});

describe("isOpaqueIdentifier", () => {
  it("accepts an opaque token within the bound and asserts no shape", () => {
    expect(isOpaqueIdentifier("aZ0_-.~token", 64)).toBe(true);
  });

  it("rejects empty, over-long, whitespace-carrying and control-carrying values", () => {
    expect(isOpaqueIdentifier("", 64)).toBe(false);
    expect(isOpaqueIdentifier("x".repeat(65), 64)).toBe(false);
    expect(isOpaqueIdentifier("has space", 64)).toBe(false);
    expect(isOpaqueIdentifier(`has${String.fromCharCode(10)}newline`, 64)).toBe(false);
    expect(isOpaqueIdentifier(`has${String.fromCharCode(9)}tab`, 64)).toBe(false);
    expect(isOpaqueIdentifier(`has${String.fromCharCode(0)}nul`, 64)).toBe(false);
    expect(isOpaqueIdentifier(`has${String.fromCharCode(0x7f)}del`, 64)).toBe(false);
    expect(isOpaqueIdentifier(null, 64)).toBe(false);
  });
});

describe("hasSupportedSchemaVersion", () => {
  it("accepts exactly 1 and rejects every other form, with no migration branch", () => {
    expect(hasSupportedSchemaVersion({ schemaVersion: 1 }, 1)).toBe(true);
    for (const value of [0, 2, "1", null, undefined, 1.0000001, true]) {
      expect(hasSupportedSchemaVersion({ schemaVersion: value }, 1), String(value)).toBe(
        value === 1
      );
    }
    expect(hasSupportedSchemaVersion({}, 1)).toBe(false);
  });
});

describe("parseUntrustedJson", () => {
  it("returns the parsed value, or undefined for unparseable input", () => {
    expect(parseUntrustedJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseUntrustedJson("null")).toBeNull();
    expect(parseUntrustedJson("{oops")).toBeUndefined();
    expect(parseUntrustedJson("")).toBeUndefined();
  });
});

describe("isValidTimestamp", () => {
  it("requires a parseable non-empty string", () => {
    expect(isValidTimestamp("2026-03-01T10:00:00.000Z")).toBe(true);
    for (const value of ["", "nope", 0, null, undefined, {}]) {
      expect(isValidTimestamp(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The untrusted storage-adapter boundary
// ---------------------------------------------------------------------------

function adapterReturning(result: unknown): RemovableStorageAdapter {
  return {
    get: async () => result as StorageGetResult,
    set: async () => result as never,
    remove: async () => result as never,
  };
}

function adapterThrowing(thrown: unknown): RemovableStorageAdapter {
  return {
    get: async () => {
      throw thrown;
    },
    set: async () => {
      throw thrown;
    },
    remove: async () => {
      throw thrown;
    },
  };
}

const acceptAnything = (raw: unknown): { ok: true } | null =>
  raw !== null && typeof raw === "object" ? { ok: true } : null;

describe("readIdentityRecord", () => {
  it("maps a stored value through the validator", async () => {
    const adapter = adapterReturning({ status: "value", value: '{"a":1}' });
    await expect(readIdentityRecord(adapter, "k", acceptAnything)).resolves.toEqual({
      status: "value",
      value: { ok: true },
    });
  });

  it("turns the adapter's successful null into an explicit `absent`", async () => {
    const adapter = adapterReturning({ status: "value", value: null });
    await expect(readIdentityRecord(adapter, "k", acceptAnything)).resolves.toEqual({
      status: "absent",
    });
  });

  it("reports `malformed` for unparseable JSON and for a rejected value", async () => {
    await expect(
      readIdentityRecord(adapterReturning({ status: "value", value: "{oops" }), "k", acceptAnything)
    ).resolves.toEqual({ status: "malformed" });
    await expect(
      readIdentityRecord(adapterReturning({ status: "value", value: "7" }), "k", acceptAnything)
    ).resolves.toEqual({ status: "malformed" });
  });

  it("classifies a storage read failure and keeps the kind", async () => {
    await expect(
      readIdentityRecord(
        adapterReturning({
          status: "read_failed",
          fallback: null,
          error: { kind: "storage_unavailable" },
        }),
        "k",
        acceptAnything
      )
    ).resolves.toEqual({ status: "read_failed", error: { kind: "storage_unavailable" } });
    await expect(
      readIdentityRecord(
        adapterReturning({ status: "read_failed", fallback: null, error: { kind: "unknown" } }),
        "k",
        acceptAnything
      )
    ).resolves.toEqual({ status: "read_failed", error: { kind: "unknown" } });
  });

  it("contains an adapter that throws an Error or a non-Error", async () => {
    for (const thrown of [new Error("e"), "a string", Symbol("s"), null]) {
      await expect(
        readIdentityRecord(adapterThrowing(thrown), "k", acceptAnything)
      ).resolves.toEqual({ status: "read_failed", error: { kind: "unknown" } });
    }
  });

  it("contains an adapter that returns an unrecognizable result", async () => {
    for (const result of [null, undefined, {}, { status: "weird" }, 7, "value"]) {
      await expect(readIdentityRecord(adapterReturning(result), "k", acceptAnything)).resolves.toEqual(
        { status: "read_failed", error: { kind: "unknown" } }
      );
    }
  });

  it("contains a validator that throws, reporting the fail-closed `malformed`", async () => {
    const adapter = adapterReturning({ status: "value", value: "{}" });
    const throwingValidator = vi.fn(() => {
      throw new Error("validator defect");
    });
    await expect(readIdentityRecord(adapter, "k", throwingValidator)).resolves.toEqual({
      status: "malformed",
    });
    expect(throwingValidator).toHaveBeenCalledTimes(1);
  });
});

describe("writeIdentityRecord", () => {
  const acceptRecord = (raw: unknown): { ok: true } | null =>
    readUntrustedProperty(raw, "ok") === true ? { ok: true } : null;

  it("resolves ok on a successful write, after round-trip validation", async () => {
    const adapter = adapterReturning({ ok: true });
    await expect(
      writeIdentityRecord(adapter, "k", { ok: true }, acceptRecord)
    ).resolves.toEqual({ ok: true });
  });

  it("preserves the storage_unavailable and quota_exceeded kinds", async () => {
    await expect(
      writeIdentityRecord(
        adapterReturning({ ok: false, error: { kind: "storage_unavailable" } }),
        "k",
        { ok: true },
        acceptRecord
      )
    ).resolves.toEqual({ ok: false, error: { kind: "storage_unavailable" } });
    await expect(
      writeIdentityRecord(
        adapterReturning({ ok: false, error: { kind: "quota_exceeded" } }),
        "k",
        { ok: true },
        acceptRecord
      )
    ).resolves.toEqual({ ok: false, error: { kind: "quota_exceeded" } });
  });

  it("REFUSES to write a record its own validator would reject, and never calls set", async () => {
    // The property the whole correction rests on: a reported success implies the
    // next load will accept what is stored.
    const set = vi.fn<(key: string, value: string) => Promise<PersistenceWriteResult>>(async () => ({
      ok: true,
    }));
    const adapter: RemovableStorageAdapter = {
      get: async () => ({ status: "value", value: null }),
      set,
      remove: async () => ({ ok: true }),
    };
    const result = await writeIdentityRecord(adapter, "k", { ok: false }, acceptRecord);
    expect(result.ok).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects a serialization that produces `undefined` rather than a string", async () => {
    const set = vi.fn<(key: string, value: string) => Promise<PersistenceWriteResult>>(async () => ({
      ok: true,
    }));
    const adapter: RemovableStorageAdapter = {
      get: async () => ({ status: "value", value: null }),
      set,
      remove: async () => ({ ok: true }),
    };
    // `JSON.stringify` returns `undefined` — not a string — for each of these.
    const unserializable: unknown[] = [undefined, () => "x", Symbol("s"), { toJSON: () => undefined }];
    for (const record of unserializable) {
      const result = await writeIdentityRecord(adapter, "k", record, acceptRecord);
      expect(result.ok, String(typeof record)).toBe(false);
    }
    expect(set).not.toHaveBeenCalled();
  });

  it("defeats `toJSON` substitution: the STORED shape is what gets validated", async () => {
    const set = vi.fn<(key: string, value: string) => Promise<PersistenceWriteResult>>(async () => ({
      ok: true,
    }));
    const adapter: RemovableStorageAdapter = {
      get: async () => ({ status: "value", value: null }),
      set,
      remove: async () => ({ ok: true }),
    };
    // The in-memory object looks valid; what would actually be stored does not.
    const substituted: unknown = { ok: true, toJSON: () => ({ ok: false }) };
    const result = await writeIdentityRecord(adapter, "k", substituted, acceptRecord);
    expect(result.ok).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("defeats accessor-backed and Proxy-backed records, whose live getters do not survive serialization", async () => {
    const set = vi.fn<(key: string, value: string) => Promise<PersistenceWriteResult>>(async () => ({
      ok: true,
    }));
    const adapter: RemovableStorageAdapter = {
      get: async () => ({ status: "value", value: null }),
      set,
      remove: async () => ({ ok: true }),
    };
    // A getter that answers `true` only on the FIRST read: the validator sees the
    // round-tripped snapshot, so the second answer cannot smuggle anything in.
    let reads = 0;
    const accessorBacked = {
      get ok(): boolean {
        reads += 1;
        return reads === 1;
      },
    };
    const first = await writeIdentityRecord(adapter, "k", accessorBacked, acceptRecord);
    expect(first.ok).toBe(true);
    // What was actually handed to storage is the serialized snapshot, and it
    // validates.
    const storedPayload = set.mock.calls[0]?.[1] ?? "";
    expect(acceptRecord(JSON.parse(storedPayload))).not.toBeNull();

    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("hostile get trap");
        },
        ownKeys() {
          throw new Error("hostile ownKeys trap");
        },
      }
    );
    const second = await writeIdentityRecord(adapter, "k2", hostile, acceptRecord);
    expect(second.ok).toBe(false);
  });

  it("contains a validator that throws", async () => {
    const throwing = vi.fn(() => {
      throw new Error("validator defect");
    });
    const result = await writeIdentityRecord(adapterReturning({ ok: true }), "k", {}, throwing);
    expect(result.ok).toBe(false);
  });

  it("contains a throwing adapter and an unserializable record without leaking anything", async () => {
    const SECRET = "sb_secret_must_not_appear";
    const failure = await writeIdentityRecord(
      adapterThrowing(new Error(SECRET)),
      "k",
      { ok: true },
      acceptRecord
    );
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.error.kind).toBe("unknown");
      if (failure.error.kind === "unknown") {
        expect(failure.error.message).toBe("The record could not be stored.");
      }
    }
    expect(JSON.stringify(failure)).not.toContain(SECRET);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const cyclicResult = await writeIdentityRecord(
      adapterReturning({ ok: true }),
      "k",
      cyclic,
      acceptRecord
    );
    expect(cyclicResult.ok).toBe(false);
  });

  it("emits fixed, value-free failure copy for every unrecognized adapter result", async () => {
    for (const result of [null, undefined, {}, { ok: "yes" }, 7, "ok"]) {
      const written = await writeIdentityRecord(
        adapterReturning(result),
        "k",
        { ok: true },
        acceptRecord
      );
      expect(written.ok, JSON.stringify(result)).toBe(false);
      if (!written.ok && written.error.kind === "unknown") {
        expect(written.error.message).toBe("The record could not be stored.");
      }
    }
  });
});

describe("removeIdentityRecord", () => {
  it("resolves ok, storage_unavailable and removal_failed without throwing", async () => {
    await expect(removeIdentityRecord(adapterReturning({ ok: true }), "k")).resolves.toEqual({
      ok: true,
    });
    await expect(
      removeIdentityRecord(adapterReturning({ ok: false, error: { kind: "storage_unavailable" } }), "k")
    ).resolves.toEqual({ ok: false, error: { kind: "storage_unavailable" } });
    const failed = await removeIdentityRecord(
      adapterReturning({ ok: false, error: { kind: "removal_failed", message: "raw detail" } }),
      "k"
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error.kind).toBe("removal_failed");
      // The adapter's own message is replaced by fixed copy: no raw storage text
      // travels out of this boundary.
      if (failed.error.kind === "removal_failed") {
        expect(failed.error.message).toBe("The record could not be removed.");
        expect(failed.error.message).not.toContain("raw detail");
      }
    }
  });

  it("contains a throwing remove", async () => {
    for (const thrown of [new Error("e"), "s", Symbol("s"), undefined]) {
      const result = await removeIdentityRecord(adapterThrowing(thrown), "k");
      expect(result.ok).toBe(false);
    }
  });
});
