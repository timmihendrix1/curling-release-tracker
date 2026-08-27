// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageAdapter, localStorageAdapter } from "../localStorageAdapter";
import type { RemovableStorageAdapter, StorageAdapter } from "../types";

describe("createLocalStorageAdapter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("get() resolves { status: 'value', value: null } when the key is absent", async () => {
    const adapter = createLocalStorageAdapter();
    const result = await adapter.get("nonexistent-key");
    expect(result).toEqual({ status: "value", value: null });
  });

  it("get() resolves { status: 'value', value } when a string is stored", async () => {
    localStorage.setItem("k", "hello");
    const adapter = createLocalStorageAdapter();
    const result = await adapter.get("k");
    expect(result).toEqual({ status: "value", value: "hello" });
  });

  it("set() writes the value and resolves { ok: true }", async () => {
    const adapter = createLocalStorageAdapter();
    const result = await adapter.set("k", "hello");
    expect(result).toEqual({ ok: true });
    expect(localStorage.getItem("k")).toBe("hello");
  });

  it("set() overwrites an existing value fully", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set("k", "first");
    await adapter.set("k", "second");
    expect(localStorage.getItem("k")).toBe("second");
  });

  describe("error classification", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("classifies a QuotaExceededError DOMException on set() as quota_exceeded", async () => {
      const quotaError = new DOMException("quota exceeded", "QuotaExceededError");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw quotaError;
      });
      const adapter = createLocalStorageAdapter();
      const result = await adapter.set("k", "value");
      expect(result).toEqual({ ok: false, error: { kind: "quota_exceeded" } });
    });

    it("classifies a SecurityError DOMException on get() as storage_unavailable", async () => {
      const securityError = new DOMException("blocked", "SecurityError");
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw securityError;
      });
      const adapter = createLocalStorageAdapter();
      const result = await adapter.get("k");
      expect(result).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      });
    });

    it("classifies a SecurityError DOMException on set() as storage_unavailable", async () => {
      const securityError = new DOMException("blocked", "SecurityError");
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw securityError;
      });
      const adapter = createLocalStorageAdapter();
      const result = await adapter.set("k", "value");
      expect(result).toEqual({ ok: false, error: { kind: "storage_unavailable" } });
    });

    it("classifies an unrecognized thrown error on get() as unknown", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("disk on fire");
      });
      const adapter = createLocalStorageAdapter();
      const result = await adapter.get("k");
      expect(result).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "unknown", message: "disk on fire" },
      });
    });

    it("classifies an unrecognized thrown error on set() as unknown", async () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("disk on fire");
      });
      const adapter = createLocalStorageAdapter();
      const result = await adapter.set("k", "value");
      expect(result).toEqual({
        ok: false,
        error: { kind: "unknown", message: "disk on fire" },
      });
    });

    it("never lets a DOMException or Error instance escape get()/set()", async () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new DOMException("boom", "QuotaExceededError");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("boom", "QuotaExceededError");
      });
      const adapter = createLocalStorageAdapter();
      await expect(adapter.get("k")).resolves.not.toThrow;
      await expect(adapter.set("k", "v")).resolves.not.toThrow;
      const getResult = await adapter.get("k");
      const setResult = await adapter.set("k", "v");
      expect(getResult).not.toBeInstanceOf(DOMException);
      expect(setResult).not.toBeInstanceOf(DOMException);
    });
  });
});

// ---------------------------------------------------------------------------
// The removable capability (docs/PERSISTENCE_BOUNDARY_DESIGN.md §9, ADR-0025
// Decision 19). Added for Stage B0.2's identity records, which are the first
// records for which removal is a genuine operation rather than an overwrite.
// ---------------------------------------------------------------------------
describe("createLocalStorageAdapter — remove()", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes the key and resolves { ok: true }", async () => {
    localStorage.setItem("k", "hello");
    const adapter = createLocalStorageAdapter();
    await expect(adapter.remove("k")).resolves.toEqual({ ok: true });
    expect(localStorage.getItem("k")).toBeNull();
  });

  it("removing an absent key is a success", async () => {
    // Every caller wants "the key is not there"; one that needs to know whether
    // something WAS there reads first.
    const adapter = createLocalStorageAdapter();
    await expect(adapter.remove("nonexistent-key")).resolves.toEqual({ ok: true });
  });

  it("touches no other key", async () => {
    localStorage.setItem("keep", "value");
    localStorage.setItem("drop", "value");
    const adapter = createLocalStorageAdapter();
    await adapter.remove("drop");
    expect(localStorage.getItem("keep")).toBe("value");
  });

  it("classifies a SecurityError as storage_unavailable", async () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const adapter = createLocalStorageAdapter();
    await expect(adapter.remove("k")).resolves.toEqual({
      ok: false,
      error: { kind: "storage_unavailable" },
    });
  });

  it("classifies any other failure as removal_failed, never as quota_exceeded", async () => {
    // A quota branch would be meaningless for a deletion, so there isn't one.
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("boom", "QuotaExceededError");
    });
    const adapter = createLocalStorageAdapter();
    const result = await adapter.remove("k");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("removal_failed");
  });

  it("never rejects, for a thrown Error, DOMException, string, Symbol or null", async () => {
    for (const thrown of [
      new Error("boom"),
      new DOMException("boom", "InvalidStateError"),
      "a thrown string",
      Symbol("boom"),
      null,
      undefined,
      42,
    ]) {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw thrown;
      });
      const adapter = createLocalStorageAdapter();
      const result = await adapter.remove("k");
      expect(result.ok, String(typeof thrown)).toBe(false);
      vi.restoreAllMocks();
    }
  });

  it("emits a FIXED, value-free message — the thrown value is never inspected", async () => {
    // ADR-0025 §G, made structural for the capability Stage B0.2c introduces: a
    // caught value is never inspected, stringified, logged, forwarded or embedded.
    const SECRET = "sb_secret_should_never_appear";
    const thrown: Array<[string, unknown]> = [
      ["Error", new Error(SECRET)],
      ["DOMException", new DOMException(SECRET, "InvalidStateError")],
      ["string", SECRET],
      ["Symbol", Symbol(SECRET)],
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
      ["plain object", { detail: SECRET }],
      ["array", [SECRET]],
    ];
    for (const [label, value] of thrown) {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw value;
      });
      const adapter = createLocalStorageAdapter();
      const result = await adapter.remove("k");
      expect(result.ok, label).toBe(false);
      if (!result.ok) {
        expect(result.error.kind, label).toBe("removal_failed");
        if (result.error.kind === "removal_failed") {
          expect(result.error.message, label).toBe(
            "The value could not be removed from local storage."
          );
        }
      }
      expect(JSON.stringify(result), label).not.toContain(SECRET);
      expect(JSON.stringify(result), label).not.toContain("42");
      vi.restoreAllMocks();
    }
  });

  it("never reads a `message` getter off a thrown value", async () => {
    let getterReads = 0;
    const hostile = {
      get message(): string {
        getterReads += 1;
        throw new Error("hostile getter");
      },
    };
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw hostile;
    });
    const adapter = createLocalStorageAdapter();
    const result = await adapter.remove("k");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("removal_failed");
    expect(getterReads).toBe(0);
  });

  it("contains a hostile `instanceof`, where the storage/removal distinction cannot be established safely", async () => {
    // `instanceof` against a Proxy with a throwing `getPrototypeOf` trap DOES throw
    // in plain JavaScript — asserted here directly — and that determination is the
    // only thing separating `storage_unavailable` from `removal_failed`. When it
    // throws, no claim is made and the generic outcome is returned.
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("hostile prototype trap");
        },
        get() {
          throw new Error("hostile get trap");
        },
      }
    );
    let instanceofThrew = false;
    try {
      void (hostile instanceof Error);
    } catch {
      instanceofThrew = true;
    }
    expect(instanceofThrew).toBe(true);

    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw hostile;
    });
    const adapter = createLocalStorageAdapter();
    const result = await adapter.remove("k");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("removal_failed");
    expect(JSON.stringify(result)).not.toContain("hostile");
  });

  it("contains a `localStorage` GLOBAL that is itself a throwing getter", async () => {
    // `remove` places its availability check INSIDE the `try` precisely for this
    // case: `typeof localStorage` READS the global, and `typeof` suppresses only a
    // ReferenceError for an undeclared binding — a throwing getter still throws.
    // The identity repositories require `remove` to be total, so the read that
    // decides "unavailable" must itself be contained.
    //
    // `get`/`set` are deliberately NOT asserted here: their availability check sits
    // outside the `try`, which is pre-existing Phase 1 behaviour left alone by Stage
    // B0.2c (see the module comment in localStorageAdapter.ts).
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      const adapter = createLocalStorageAdapter();
      const result = await adapter.remove("k");
      expect(result.ok).toBe(false);
      // The throw came from the global read, not from `removeItem`, and the
      // classifier's own re-read of the global throws too — so the distinction
      // cannot be established and the honest answer is the generic kind.
      if (!result.ok) expect(result.error.kind).toBe("removal_failed");
      expect(JSON.stringify(result)).not.toContain("blocked");
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(globalThis, "localStorage");
      } else {
        Object.defineProperty(globalThis, "localStorage", original);
      }
    }
  });

  it("resolves — never rejects — for every thrown shape", async () => {
    for (const value of [
      new Error("boom"),
      "a thrown string",
      Symbol("boom"),
      null,
      undefined,
      new Proxy({}, { getPrototypeOf() { throw new Error("trap"); } }),
    ]) {
      vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
        throw value;
      });
      const adapter = createLocalStorageAdapter();
      await expect(adapter.remove("k")).resolves.toBeDefined();
      vi.restoreAllMocks();
    }
  });
});

describe("adapter typing — the widening exposes remove without breaking the base contract", () => {
  it("the factory result satisfies RemovableStorageAdapter AND StorageAdapter", () => {
    const removable: RemovableStorageAdapter = createLocalStorageAdapter();
    // Assignable to the base contract, which is why all seven sporting
    // repositories are unaffected by the widening.
    const base: StorageAdapter = removable;
    expect(typeof removable.remove).toBe("function");
    expect(typeof base.get).toBe("function");
    expect(typeof base.set).toBe("function");
    // @ts-expect-error the base contract deliberately does not expose `remove`
    expect(base.remove).toBeDefined();
  });

  it("the shared production instance also exposes remove", () => {
    const shared: RemovableStorageAdapter = localStorageAdapter;
    expect(typeof shared.remove).toBe("function");
  });

  it("a base-typed adapter with no remove still satisfies every sporting repository", () => {
    // Proof that the extension is additive: a minimal `get`/`set` implementation
    // remains a valid StorageAdapter.
    const minimal: StorageAdapter = {
      get: async () => ({ status: "value", value: null }),
      set: async () => ({ ok: true }),
    };
    expect(typeof minimal.get).toBe("function");
    // @ts-expect-error a minimal base adapter is not assignable to the removable type
    const widened: RemovableStorageAdapter = minimal;
    expect(widened).toBeDefined();
  });
});
