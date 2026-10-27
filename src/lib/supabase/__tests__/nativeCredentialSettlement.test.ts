import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeCredentialSettlementStorage } from "../supabaseClient";

const good = () => ({ getItem: vi.fn(async () => "fixture" as string | null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) });
function binding(storage: unknown, health: unknown = () => null) {
  const result = createNativeCredentialSettlementStorage(storage, health);
  if (!result.ok) throw new Error("fixture invalid");
  return result.value;
}
async function fixedFailure(promise: Promise<unknown>) {
  try { await promise; throw new Error("expected failure"); }
  catch (error) {
    expect(error).toBeInstanceOf(AuthRetryableFetchError);
    expect((error as Error).message).toBe("Credential storage unavailable");
    expect((error as AuthRetryableFetchError).status).toBe(503);
    expect(Object.hasOwn(error as object, "cause")).toBe(false);
  }
}
afterEach(() => vi.restoreAllMocks());

describe("dormant native credential SDK settlement binding", () => {
  it("is inert, frozen and captures operations once with their actual receiver", async () => {
    const health = vi.fn(() => null), gets = [0, 0, 0];
    const storage = { marker: "fixture" };
    const read = function(this: typeof storage) { return this.marker; };
    const write = function(this: typeof storage, _key: string, value: string) { this.marker = value; };
    const remove = function(this: typeof storage) { this.marker = "removed"; };
    for (const fn of [read, write, remove]) for (const name of ["bind", "call"]) Object.defineProperty(fn, name, { get() { throw new Error("own binding property must not be read"); } });
    ["getItem", "setItem", "removeItem"].forEach((name, i) => Object.defineProperty(storage, name, { get() { gets[i]++; return [read, write, remove][i]; }, configurable: true }));
    const port = binding(storage, health);
    expect(health).not.toHaveBeenCalled(); expect(port.failed()).toBe(false);
    expect(Object.isFrozen(port)).toBe(true); expect(Object.isFrozen(port.storage)).toBe(true);
    expect(gets).toEqual([1, 1, 1]);
    for (const name of ["getItem", "setItem", "removeItem"]) Object.defineProperty(storage, name, { get() { throw null; } });
    expect(await port.storage.getItem("key")).toBe("fixture");
    await port.storage.setItem("key", "changed"); expect(storage.marker).toBe("changed");
    await port.storage.removeItem("key"); expect(storage.marker).toBe("removed");
    expect(health).toHaveBeenCalledTimes(6); expect(gets).toEqual([1, 1, 1]);
  });
  it("returns only fixed construction failure for malformed or hostile dependencies", () => {
    const hostile = new Proxy({}, { get() { throw new Error("PRIVATE"); } });
    const revoked = Proxy.revocable({}, {}); revoked.revoke();
    for (const storage of [null, undefined, false, 1, [], () => {}, {}, hostile, revoked.proxy, { ...good(), removeItem: null }]) expect(createNativeCredentialSettlementStorage(storage, () => null)).toEqual({ ok: false, reason: "invalid_dependency" });
    for (const health of [null, undefined, false, {}, []]) expect(createNativeCredentialSettlementStorage(good(), health)).toEqual({ ok: false, reason: "invalid_dependency" });
  });
  it("preserves exact primitive empty/null/Unicode read values without claiming absence on any failure", async () => {
    for (const value of [null, "", "fixture\u0000\ud800🥌"]) expect(await binding({ ...good(), getItem: async () => value }).storage.getItem("key")).toBe(value);
    for (const value of [undefined, false, 0, {}, [], new String("fixture")]) {
      const port = binding({ ...good(), getItem: async () => value });
      await fixedFailure(port.storage.getItem("key")); expect(port.failed()).toBe(true);
    }
  });
  for (const op of ["getItem", "setItem", "removeItem"] as const) {
    it(`makes ${op} failures terminal without inspecting reasons or retrying source I/O`, async () => {
      let inspected = false;
      const reason = Object.defineProperty({}, "message", { get() { inspected = true; throw null; } });
      for (const bad of [() => { throw reason; }, () => Promise.reject(reason), () => Object.defineProperty({}, "then", { get() { throw reason; } })]) {
        const source = { ...good(), [op]: vi.fn(bad) }, port = binding(source);
        const issue = () => op === "getItem" ? port.storage.getItem("key") : op === "setItem" ? port.storage.setItem("key", "value") : port.storage.removeItem("key");
        await fixedFailure(issue()); expect(port.failed()).toBe(true);
        await fixedFailure(port.storage.getItem("key")); await fixedFailure(port.storage.setItem("key", "value")); await fixedFailure(port.storage.removeItem("key"));
        expect(source[op]).toHaveBeenCalledTimes(1);
        for (const other of ["getItem", "setItem", "removeItem"].filter(name => name !== op)) expect(source[other as typeof op]).not.toHaveBeenCalled();
      }
      expect(inspected).toBe(false);
    });
  }
  it("requires exactly undefined write/removal acknowledgements", async () => {
    for (const value of [null, false, true, 0, "", { ok: true }]) for (const op of ["setItem", "removeItem"] as const) {
      const port = binding({ ...good(), [op]: async () => value });
      await fixedFailure(op === "setItem" ? port.storage.setItem("key", "value") : port.storage.removeItem("key"));
      expect(port.failed()).toBe(true);
    }
  });
  for (const op of ["getItem", "setItem", "removeItem"] as const) {
    it(`faults malformed ${op} results before a post-health callback can issue new I/O`, async () => {
      let calls = 0, inner: Promise<void> | undefined;
      const source = { ...good(), [op]: vi.fn(async () => op === "getItem" ? undefined : null) };
      const port = binding(source, () => {
        calls++;
        if (calls === 2) inner = port.storage.removeItem("must-be-preserved").catch(() => {});
        return null;
      });
      await fixedFailure(op === "getItem" ? port.storage.getItem("key") : op === "setItem" ? port.storage.setItem("key", "value") : port.storage.removeItem("key"));
      expect(calls).toBe(1); expect(inner).toBeUndefined(); expect(port.failed()).toBe(true);
      expect(source.removeItem).toHaveBeenCalledTimes(op === "removeItem" ? 1 : 0);
      await fixedFailure(port.storage.removeItem("must-be-preserved"));
      expect(calls).toBe(1); expect(source.removeItem).toHaveBeenCalledTimes(op === "removeItem" ? 1 : 0);
    });
  }
  it("latches pre/post health failure, including thrown access and never clears after health recovers", async () => {
    for (const post of [false, true]) for (const throwing of [false, true]) {
      let calls = 0;
      const source = good(), port = binding(source, () => {
        calls++; if (post && calls === 1) return null;
        if (throwing) throw new Error("PRIVATE"); return { kind: "read_failed" };
      });
      await fixedFailure(port.storage.getItem("key")); expect(source.getItem).toHaveBeenCalledTimes(post ? 1 : 0);
      const old = calls; expect(port.failed()).toBe(true); expect(calls).toBe(old);
      await fixedFailure(port.storage.getItem("key")); expect(calls).toBe(old);
    }
  });
  it("observes invalid rejected health promises without awaiting or performing source I/O", async () => {
    let release!: () => void;
    for (const result of [Promise.reject(new Error("PRIVATE")), new Promise<void>(done => { release = done; }), Object.defineProperty({}, "then", { get() { throw new Error("PRIVATE"); } })]) {
      const source = good(), port = binding(source, () => result);
      await fixedFailure(port.storage.getItem("key")); expect(source.getItem).not.toHaveBeenCalled(); expect(port.failed()).toBe(true);
    }
    release();
  });
  it("rechecks terminal state after a reentrant pre-health callback returns null", async () => {
    const source = good(); let depth = 0, inner: Promise<void> | undefined;
    const port = binding(source, () => {
      if (++depth === 1) { inner = port.storage.removeItem("inner").catch(() => {}); return null; }
      return { kind: "failed" };
    });
    await fixedFailure(port.storage.getItem("outer")); await inner;
    expect(source.getItem).not.toHaveBeenCalled(); expect(source.removeItem).not.toHaveBeenCalled(); expect(port.failed()).toBe(true);
  });
  it("rechecks terminal state after reentrant post-health so a late successful value cannot escape", async () => {
    const source = good(); let calls = 0, inner: Promise<void> | undefined;
    const port = binding(source, () => {
      calls++;
      if (calls === 1) return null;
      if (calls === 2) { inner = port.storage.removeItem("inner").catch(() => {}); return null; }
      return { kind: "failed" };
    });
    await fixedFailure(port.storage.getItem("outer")); await inner;
    expect(source.getItem).toHaveBeenCalledTimes(1); expect(source.removeItem).not.toHaveBeenCalled();
  });
  it("retains ownership of pending operations and refuses their late success after another failure", async () => {
    let release!: (value: string) => void;
    const source = { ...good(), getItem: vi.fn(() => new Promise<string>(done => { release = done; })), removeItem: vi.fn(async () => { throw null; }) };
    const port = binding(source); let settled = false;
    const first = port.storage.getItem("key"); const checked = fixedFailure(first).then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    await fixedFailure(port.storage.removeItem("key")); expect(port.failed()).toBe(true); expect(settled).toBe(false);
    release("PRIVATE_VALUE"); await checked; expect(settled).toBe(true);
    await fixedFailure(port.storage.getItem("key")); expect(source.getItem).toHaveBeenCalledTimes(1);
  });
  it("observes native Promise state when an own then is masked", async () => {
    const rejected = Object.defineProperty(Promise.reject(new Error("PRIVATE")), "then", { value: null });
    await fixedFailure(binding({ ...good(), getItem: () => rejected }).storage.getItem("key"));
    const success = Object.defineProperty(Promise.resolve("fixture"), "then", { get() { throw null; } });
    expect(await binding({ ...good(), getItem: () => success }).storage.getItem("key")).toBe("fixture");
  });
});
