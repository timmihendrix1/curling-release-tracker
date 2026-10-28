import { describe, expect, it, vi } from "vitest";
import { inventoryIosCredentialNamespace, readIosKeychainEvidence } from "../iosKeychainReadEvidence";
import { iosCredentialInventoryDiagnostic, nativeInventoryDiagnostics } from "../credentialInventoryDiagnostics";

describe("iOS item-specific Keychain evidence transport", () => {
  it("returns exact value including empty strings and escaped content", async () => {
    for (const value of ["", "fixture\u0000\n🚀", "{\"synthetic\":true}"]) {
      expect(await readIosKeychainEvidence("fixture", async () => ({ kind: "value", value })))
        .toEqual({ kind: "value", value });
    }
  });
  it("accepts absence only from an exact positive platform verdict", async () => {
    expect(await readIosKeychainEvidence("fixture", async () => ({ kind: "established_absent" })))
      .toEqual({ kind: "established_absent" });
    for (const raw of [null, undefined, {}, [], { kind: "value" }, { kind: "established_absent", value: "retained" },
      { kind: "inaccessible" }, { kind: "unreadable" }, { kind: "not_found" }, { kind: "value", value: null }]) {
      expect(await readIosKeychainEvidence("fixture", async () => raw)).toEqual({ kind: "unreadable" });
    }
  });
  it("does not fall back after a missing plugin or rejected read", async () => {
    const read = vi.fn(async () => { throw new Error("private native details"); });
    await expect(readIosKeychainEvidence("fixture", read)).rejects.toThrow();
    expect(read).toHaveBeenCalledExactlyOnceWith({ key: "fixture" });
  });
  it("contains hostile response access without calling getters on an error", async () => {
    const raw = new Proxy({}, { ownKeys() { throw null; } });
    expect(await readIosKeychainEvidence("fixture", async () => raw)).toEqual({ kind: "unreadable" });
  });
});

describe("iOS credential namespace inventory transport — private observations only", () => {
  it("accepts only fixed native failure pairs and keeps diagnostics off the normalized evidence envelope", async () => {
    for (const [kind, diagnostics] of Object.entries(nativeInventoryDiagnostics)) for (const diagnostic of diagnostics) {
      const result = await inventoryIosCredentialNamespace(async () => ({ kind, diagnostic }));
      expect(result).toEqual({ kind }); expect(Object.keys(result)).toEqual(["kind"]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(iosCredentialInventoryDiagnostic(result)).toBe(diagnostic);
      expect(iosCredentialInventoryDiagnostic({ ...result })).toBeNull();
    }
    for (const raw of [
      { kind: "inaccessible", diagnostic: "sync_shape" },
      { kind: "unreadable", diagnostic: "os_other" },
      { kind: "inaccessible", diagnostic: "PRIVATE_SENTINEL" },
      { kind: "inaccessible", diagnostic: "os_other", keys: [] },
      { kind: "complete", keys: [], diagnostic: "os_other" },
    ]) {
      const result = await inventoryIosCredentialNamespace(async () => raw);
      expect(result).toEqual({ kind: "unreadable" });
      expect(iosCredentialInventoryDiagnostic(result)).toBe("transport_shape");
    }
    let inspected = false;
    const diagnostic = { toString() { inspected = true; throw null; } };
    const accessor = Object.defineProperty({ kind: "inaccessible" }, "diagnostic", { get() { inspected = true; throw null; } });
    for (const raw of [accessor, { kind: "inaccessible", diagnostic }]) {
      expect(await inventoryIosCredentialNamespace(async () => raw)).toEqual({ kind: "unreadable" });
    }
    expect(inspected).toBe(false);
  });

  it("distinguishes bridge rejection, reflection failure, native refusal and success without inspecting errors", async () => {
    const rejected = await inventoryIosCredentialNamespace(async () => { throw new Proxy({}, { get() { throw null; } }); });
    expect(rejected).toEqual({ kind: "inaccessible" });
    expect(iosCredentialInventoryDiagnostic(rejected)).toBe("transport_rejected");
    const malformed = await inventoryIosCredentialNamespace(async () => new Proxy({}, { ownKeys() { throw null; } }));
    expect(malformed).toEqual({ kind: "inaccessible" });
    expect(iosCredentialInventoryDiagnostic(malformed)).toBe("transport_reflection");
    const legacy = await inventoryIosCredentialNamespace(async () => ({ kind: "inaccessible" }));
    expect(iosCredentialInventoryDiagnostic(legacy)).toBe("native_inaccessible");
    const complete = await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys: [] }));
    expect(complete).toEqual({ kind: "complete", keys: [] });
    expect(iosCredentialInventoryDiagnostic(complete)).toBeNull();
  });
  it("returns an owned immutable exact list including orphan/unindexed/normalization-distinct names", async () => {
    const keys = ["\u0301after-delimiter", "e\u0301", "i1.unknown-epoch.orphan", "m1.fixture", "sb-fixture-auth-token-flow-unindexed1-code-verifier", "é", "🥌", "\ue000"].sort();
    const native = vi.fn(async () => ({ kind: "complete", keys }));
    const result = await inventoryIosCredentialNamespace(native);
    expect(result).toEqual({ kind: "complete", keys });
    expect(native).toHaveBeenCalledExactlyOnceWith();
    if (result.kind !== "complete") throw new Error("test inventory");
    expect(result.keys).not.toBe(keys);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.keys)).toBe(true);
    const first = result.keys[0]; keys[0] = "changed";
    expect(result.keys[0]).toBe(first);
  });

  it("accepts only an exact complete empty observation as empty", async () => {
    expect(await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys: [] }))).toEqual({ kind: "complete", keys: [] });
    for (const raw of [null, undefined, {}, [], { kind: "complete" }, { kind: "complete", keys: null },
      { kind: "complete", keys: [], extra: true }, { kind: "complete", keys: "" }, { kind: "established_absent" }]) {
      expect(await inventoryIosCredentialNamespace(async () => raw)).toEqual({ kind: "unreadable" });
    }
  });

  for (const kind of ["inaccessible", "unreadable", "unsupported_scope", "limit_exceeded"] as const) {
    it(`preserves only the fixed ${kind} failure with no partial inventory`, async () => {
      expect(await inventoryIosCredentialNamespace(async () => ({ kind }))).toEqual({ kind });
      expect(await inventoryIosCredentialNamespace(async () => ({ kind, keys: ["PRIVATE_SENTINEL"] }))).toEqual({ kind: "unreadable" });
    });
  }

  it("rejects nonstrings, duplicates, unsorted keys, malformed UTF-16 and controls", async () => {
    const notString = { toString() { throw new Error("must not coerce"); } };
    for (const keys of [[""], [null], [notString], [1], ["same", "same"], ["z", "a"], ["bad\nkey"], ["bad\u0000key"], ["bad\u200ekey"], ["\ud800"], ["\udc00"], ["\ud800x"]]) {
      expect(await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys }))).toEqual({ kind: "unreadable" });
    }
    expect(await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys: ["🥌", "\ue000"] }))).toEqual({ kind: "complete", keys: ["🥌", "\ue000"] });
  });

  it("enforces code-unit and entry-count limits without truncation", async () => {
    expect((await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys: ["🥌".repeat(96)] }))).kind).toBe("complete");
    expect(await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys: ["x".repeat(193)] }))).toEqual({ kind: "limit_exceeded" });
    const keys = Array.from({ length: 4_096 }, (_, i) => `item-${i.toString().padStart(4, "0")}`);
    expect((await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys }))).kind).toBe("complete");
    expect(await inventoryIosCredentialNamespace(async () => ({ kind: "complete", keys: [...keys, "overflow"] }))).toEqual({ kind: "limit_exceeded" });
  });

  it("does not invoke accessors or accept sparse/augmented arrays", async () => {
    let called = false;
    const accessor = Object.defineProperty({}, "kind", { get() { called = true; return "complete"; } });
    const array = Object.defineProperty(["a"], "0", { get() { called = true; return "a"; } });
    const keysAccessor = Object.defineProperty({ kind: "complete" }, "keys", { get() { called = true; return []; } });
    const augmented = Object.assign(["a"], { extra: true });
    for (const raw of [accessor, keysAccessor, { kind: "complete", keys: array }, { kind: "complete", keys: new Array(1) }, { kind: "complete", keys: augmented }]) {
      expect(await inventoryIosCredentialNamespace(async () => raw)).toEqual({ kind: "unreadable" });
    }
    expect(called).toBe(false);
  });

  it("contains plugin/hostile reflection failures without exposing reasons or falling back", async () => {
    let inspected = false;
    const error = Object.defineProperty({}, "message", { get() { inspected = true; throw null; } });
    const native = vi.fn(async () => { throw error; });
    expect(await inventoryIosCredentialNamespace(native)).toEqual({ kind: "inaccessible" });
    expect(native).toHaveBeenCalledExactlyOnceWith(); expect(inspected).toBe(false);
    const proxy = new Proxy({}, { ownKeys() { throw "PRIVATE_SENTINEL"; } });
    expect(await inventoryIosCredentialNamespace(async () => proxy)).toEqual({ kind: "inaccessible" });
  });

  it("keeps an unanswered native call pending without timeout emptiness or a retry", async () => {
    let resolve!: (value: unknown) => void;
    const native = vi.fn(() => new Promise<unknown>(r => { resolve = r; }));
    let settled = false;
    const task = inventoryIosCredentialNamespace(native).then(value => { settled = true; return value; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(native).toHaveBeenCalledTimes(1);
    resolve({ kind: "inaccessible" });
    expect(await task).toEqual({ kind: "inaccessible" });
  });
});
