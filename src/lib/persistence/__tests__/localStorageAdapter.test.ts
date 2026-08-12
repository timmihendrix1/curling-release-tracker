// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageAdapter } from "../localStorageAdapter";

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
