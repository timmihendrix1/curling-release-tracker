// Installed public SDK compatibility experiment. This is NOT an app controller,
// a raw-SDK join fix, native evidence or permission to change auth composition.
import { AuthClient, AuthRetryableFetchError, createClient } from "@supabase/supabase-js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { createProviderCredentialStorage } from "../providerCredentialStorage";
import { createNativeCredentialSettlementStorage } from "../supabaseClient";
import type { SecureCredentialStore } from "../../persistence/secureCredentialStore";

const key = "sb-owned-fixture-auth-token", url = "https://owned-fixture.supabase.invalid";
const userId = "11111111-1111-4111-8111-111111111111";
const user = { id: userId, aud: "authenticated", role: "authenticated", email: "fixture@example.invalid", created_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email" }, user_metadata: {} };
const jwt = (exp: number) => [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: userId, exp })).toString("base64url"), Buffer.alloc(32).toString("base64url")].join(".");
const session = (expired = false) => {
  const expires = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600);
  return { access_token: jwt(expires), refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
};
const escaped: unknown[] = [];
const observe = (reason: unknown) => { escaped.push(reason); };
process.on("unhandledRejection", observe);
afterAll(async () => {
  // The unmapped refresh-write case below deliberately reproduces one existing
  // SDK escape. This observation is a regression assertion, NOT runtime handling.
  try {
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(escaped).toHaveLength(1);
    expect(escaped[0]).toBeInstanceOf(Error);
    expect((escaped[0] as Error).name).toBe("CredentialStorageError");
  }
  finally { process.off("unhandledRejection", observe); }
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

type Mode = "init_read" | "cleanup_read" | "cleanup_remove" | "denial" | "refresh_write";
type Command = "initialize" | "refresh" | "read";
function fixture(mode: Mode, settlementMapping = false) {
  let readFault = mode === "init_read", writeFault = false, removeFault = false;
  let denied = false, paused = false, tail = Promise.resolve(), active = 0, maxActive = 0;
  const rows = new Map([[key, JSON.stringify(session())]]);
  const read = vi.fn(async (name: string) => {
    if (readFault) return { status: "read_failed", error: { kind: "store_inaccessible" } } as const;
    const value = rows.get(name); return value === undefined ? { status: "absent" } as const : { status: "value", value } as const;
  });
  const store: SecureCredentialStore = {
    read,
    async write(name, value) {
      if (writeFault) return { ok: false, error: { kind: "store_inaccessible" }, previousValueMayBeLost: true };
      rows.set(name, value); return { ok: true };
    },
    async remove(name) {
      if (removeFault) return { ok: false, error: { kind: "store_inaccessible" } };
      return { ok: true, outcome: rows.delete(name) ? "deleted_reported" : "nothing_to_delete_reported" };
    },
  };
  const credentials = createProviderCredentialStorage(store, { sessionStorageKey: key });
  const settlement = createNativeCredentialSettlementStorage(credentials.storage, () => credentials.observedFailure());
  if (!settlement.ok) throw new Error("fixture invalid");
  const settlementBinding = settlement.value;
  const storage = settlementMapping ? settlementBinding.storage : credentials.storage;
  const fetch = vi.fn(async (request: RequestInfo | URL) => {
    expect(String(request)).toBe(url + "/auth/v1/token?grant_type=refresh_token");
    if (mode === "refresh_write") {
      writeFault = true;
      return new Response(JSON.stringify(session()), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    // Owner's causal transport verdict precedes the SDK's cleanup. Cleanup
    // cannot erase it even when storage throws before SIGNED_OUT is emitted.
    denied = true;
    if (mode === "cleanup_read") readFault = true;
    if (mode === "cleanup_remove") removeFault = true;
    return new Response(JSON.stringify({ code: "refresh_token_not_found", message: "Synthetic denial" }), { status: 400, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } });
  });
  const auth = new AuthClient({ url: url + "/auth/v1", storage, storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true, fetch });
  // Queue the WHOLE public operation before invoking any SDK method. No event
  // subscription/auto-refresh/background callback can enter this fixture.
  function run(command: Command): Promise<"ok" | "failed" | "paused" | "denied"> {
    const task = tail.then(async () => {
      if (denied) return "denied" as const;
      if (paused) return "paused" as const;
      active++; maxActive = Math.max(maxActive, active);
      try {
        const result = command === "initialize" ? await auth.initialize() : command === "refresh" ? await auth.refreshSession({ refresh_token: "synthetic-refresh" }) : await auth.getSession();
        if (result.error || (settlementMapping && settlementBinding.failed()) || credentials.observedFailure()) { paused = true; return denied ? "denied" as const : "failed" as const; }
        return "ok" as const;
      } catch { paused = true; return denied ? "denied" as const : "failed" as const; }
      finally { active--; }
    });
    tail = task.then(() => undefined, () => undefined);
    return task;
  }
  return { run, read, fetch, credentials, expire: () => rows.set(key, JSON.stringify(session(true))), rows,
    stats: () => ({ active, maxActive, denied, paused }) };
}

describe("public owned AuthClient limits and feasibility — compatibility only", () => {
  it("constructs without reads and owns initialization failure through sticky actual adapter health", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = fixture("init_read");
    expect(h.read).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
    expect(await h.run("initialize")).toBe("failed");
    expect(h.credentials.observedFailure()).toEqual({ kind: "read_failed" });
    expect(await h.run("read")).toBe("paused");
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.rows.size).toBe(1);
    expect(h.stats()).toEqual({ active: 0, maxActive: 1, denied: false, paused: true });
    expect(log).toHaveBeenCalled();
  });
  for (const mode of ["cleanup_read", "cleanup_remove", "denial"] as const) {
    it(`settles every serialized caller after causal denial with ${mode}`, async () => {
      const h = fixture(mode);
      expect(await h.run("initialize")).toBe("ok"); h.expire();
      const outcomes = await Promise.all([h.run("refresh"), h.run("read"), h.run("refresh"), h.run("read")]);
      expect(outcomes).toEqual(["denied", "denied", "denied", "denied"]);
      expect(h.fetch).toHaveBeenCalledTimes(1);
      expect(h.stats()).toEqual({ active: 0, maxActive: 1, denied: true, paused: true });
      expect(h.rows.size).toBe(mode === "denial" ? 0 : 1);
      expect(h.credentials.observedFailure()).toEqual(mode === "denial" ? null : { kind: mode === "cleanup_read" ? "read_failed" : "removal_failed" });
    });
  }
  it("reproduces SDK Deferred escape on unmapped refresh-write failure despite serialized public callers", async () => {
    const h = fixture("refresh_write"); expect(await h.run("initialize")).toBe("ok"); h.expire();
    expect(await Promise.all([h.run("refresh"), h.run("read"), h.run("refresh")])).toEqual(["failed", "paused", "paused"]);
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(h.credentials.observedFailure()).toEqual({ kind: "write_failed" });
    expect(h.stats()).toEqual({ active: 0, maxActive: 1, denied: false, paused: true });
  });
  for (const mode of ["init_read", "cleanup_read", "cleanup_remove", "denial", "refresh_write"] as const) {
    it(`tests fixed settlement-signal candidate under ${mode} without treating it as network/identity evidence`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const h = fixture(mode, true);
      const initialized = await h.run("initialize");
      if (mode === "init_read") {
        expect(initialized).toBe("failed"); expect(await h.run("read")).toBe("paused"); expect(h.fetch).not.toHaveBeenCalled();
      } else {
        expect(initialized).toBe("ok"); h.expire();
        const denied = mode !== "refresh_write";
        expect(await Promise.all([h.run("refresh"), h.run("read"), h.run("refresh")])).toEqual(denied ? ["denied", "denied", "denied"] : ["failed", "paused", "paused"]);
        expect(h.fetch).toHaveBeenCalledTimes(1);
        expect(h.stats().denied).toBe(denied);
      }
      expect(h.stats().active).toBe(0); expect(h.stats().maxActive).toBe(1);
      expect(h.rows.size).toBe(mode === "denial" ? 0 : 1);
      expect(h.credentials.observedFailure() !== null).toBe(mode !== "denial");
    });
  }
  for (const position of [1, 2, 3]) {
    it(`uses the real settlement binding at PKCE write ${position}, before any provider send`, async () => {
      const rows = new Map<string, string>(); let writes = 0;
      const credentials = createProviderCredentialStorage({
        async read(name) { const value = rows.get(name); return value === undefined ? { status: "absent" } : { status: "value", value }; },
        async write(name, value) { if (++writes === position) return { ok: false, error: { kind: "store_inaccessible" }, previousValueMayBeLost: true }; rows.set(name, value); return { ok: true }; },
        async remove() { throw new Error("unexpected protected removal"); },
      }, { sessionStorageKey: key });
      const settlement = createNativeCredentialSettlementStorage(credentials.storage, () => credentials.observedFailure());
      if (!settlement.ok) throw new Error("fixture");
      const fetch = vi.fn(async () => { throw new Error("provider send must not occur"); });
      const auth = new AuthClient({ url: url + "/auth/v1", storageKey: key, storage: settlement.value.storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true, flowType: "pkce", fetch });
      try {
        await auth.initialize(); await auth.stopAutoRefresh();
        // The SDK's failure-cleanup also rejects; the whole public promise is
        // observed by the owner. Resolving a result is not required for settlement.
        await expect(auth.signInWithOtp({ email: "fixture@example.invalid" })).rejects.toBeInstanceOf(AuthRetryableFetchError);
        expect(settlement.value.failed()).toBe(true);
        expect(credentials.observedFailure()).toEqual({ kind: "write_failed" });
        expect(writes).toBe(position); expect(fetch).not.toHaveBeenCalled(); expect(rows.size).toBe(position - 1);
      } finally { await auth.stopAutoRefresh(); }
    });
  }
  for (const operation of ["verify", "exchange", "signout"] as const) {
    it(`settles the public ${operation} storage failure without SDK subscriptions or a false success`, async () => {
      const flow = "flow1234", verifier = JSON.stringify("a".repeat(43));
      const rows = new Map<string, string>(operation === "exchange" ? [[key + "-flow-" + flow + "-code-verifier", verifier], [key + "-flows-code-verifier", JSON.stringify([flow])], [key + "-code-verifier", verifier]] : operation === "signout" ? [[key, JSON.stringify(session())]] : []);
      let removes = 0;
      const credentials = createProviderCredentialStorage({
        async read(name) { const value = rows.get(name); return value === undefined ? { status: "absent" } : { status: "value", value }; },
        async write() { return { ok: false, error: { kind: "store_inaccessible" }, previousValueMayBeLost: true }; },
        async remove() { removes++; return { ok: false, error: { kind: "store_inaccessible" } }; },
      }, { sessionStorageKey: key });
      const settlement = createNativeCredentialSettlementStorage(credentials.storage, () => credentials.observedFailure());
      if (!settlement.ok) throw new Error("fixture");
      const fetch = vi.fn(async (request: RequestInfo | URL) => {
        const path = String(request);
        expect(path === url + "/auth/v1/verify" || path === url + "/auth/v1/token?grant_type=pkce" || path === url + "/auth/v1/logout?scope=local").toBe(true);
        return operation === "signout" ? new Response(null, { status: 204 }) : new Response(JSON.stringify(session()), { status: 200, headers: { "Content-Type": "application/json" } });
      });
      const auth = new AuthClient({ url: url + "/auth/v1", storageKey: key, storage: settlement.value.storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true, flowType: "pkce", fetch });
      try {
        await auth.initialize(); await auth.stopAutoRefresh();
        if (operation === "verify") {
          const result = await auth.verifyOtp({ email: "fixture@example.invalid", token: "123456", type: "email" }); expect(result.error).not.toBeNull();
        } else {
          await expect(operation === "exchange" ? auth.exchangeCodeForSession("synthetic-code", { flowId: flow }) : auth.signOut({ scope: "local" })).rejects.toBeInstanceOf(AuthRetryableFetchError);
        }
        expect(settlement.value.failed()).toBe(true);
        expect(credentials.observedFailure()).toEqual({ kind: operation === "verify" ? "write_failed" : "removal_failed" });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(removes).toBe(operation === "verify" ? 0 : 1);
      } finally { await auth.stopAutoRefresh(); }
    });
  }
  for (const initFails of [false, true]) {
    it(`public initialization plus stopAutoRefresh removes browser recovery even when initFails=${initFails}`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const target = new EventTarget();
      vi.stubGlobal("window", { location: { href: "https://app.fixture.invalid/" }, addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target) });
      vi.stubGlobal("document", { visibilityState: "visible" });
      const channels: Array<{ handler?: (event: { data: object }) => Promise<void> }> = [];
      vi.stubGlobal("BroadcastChannel", class {
        handler?: (event: { data: object }) => Promise<void>;
        constructor() { channels.push(this); }
        addEventListener(_type: string, handler: (event: { data: object }) => Promise<void>) { this.handler = handler; }
        postMessage() {}
      });
      const read = vi.fn(async () => { if (initFails) throw new Error("synthetic read fault"); return JSON.stringify(session()); });
      let failed = false;
      const settlement = createNativeCredentialSettlementStorage({ getItem: async () => { try { return await read(); } catch { failed = true; throw null; } }, setItem: async () => {}, removeItem: async () => {} }, () => failed ? { kind: "failed" } : null);
      if (!settlement.ok) throw new Error("fixture");
      const fetch = vi.fn(async () => { throw new Error("unexpected transport"); });
      const auth = new AuthClient({ url: url + "/auth/v1", storageKey: key, storage: settlement.value.storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true, fetch });
      try { await auth.initialize(); } finally { await auth.stopAutoRefresh(); }
      const before = read.mock.calls.length;
      target.dispatchEvent(new Event("visibilitychange"));
      for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "SIGNED_OUT"]) for (const channel of channels) await channel.handler?.({ data: { event, session: null } });
      await Promise.resolve(); await Promise.resolve();
      expect(read).toHaveBeenCalledTimes(before); expect(fetch).not.toHaveBeenCalled();
      expect(settlement.value.failed()).toBe(initFails);
    });
  }
  it("public accessToken data client never initializes an auth/storage side channel", async () => {
    const token = vi.fn(async () => "synthetic-authorization");
    const storage = { getItem: vi.fn(async () => { throw new Error("unexpected credential read"); }), setItem: vi.fn(), removeItem: vi.fn() };
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer synthetic-authorization");
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const client = createClient(url, "sb_publishable_synthetic_compatibility_only", { accessToken: token, auth: { storage, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch } });
    expect(token).toHaveBeenCalledTimes(1); // construction itself invokes it
    expect(fetch).not.toHaveBeenCalled();
    const result = await client.from("synthetic_table").select("id");
    expect(result.error).toBeNull(); expect(result.data).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1); expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled(); expect(storage.removeItem).not.toHaveBeenCalled();
    expect(() => client.auth.getSession()).toThrow(/accessToken/);
  });
  for (const method of ["getSession", "refreshSession", "explicitRefreshSession"] as const) {
    it(`pins real rotation behavior for the public ${method} method`, async () => {
      const rows = new Map([[key, JSON.stringify(session())]]);
      const tokens: string[] = [];
      const fetch = vi.fn(async (_request: RequestInfo | URL, init?: RequestInit) => {
        const token = JSON.parse(String(init?.body)).refresh_token;
        tokens.push(token);
        if (tokens.length === 2 && token === "synthetic-refresh") {
          return new Response(JSON.stringify({ code: "refresh_token_already_used", message: "Synthetic reused token" }), { status: 400, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } });
        }
        return new Response(JSON.stringify({ ...session(), refresh_token: tokens.length === 1 ? "synthetic-rotated-1" : "synthetic-rotated-2" }), { status: 200, headers: { "Content-Type": "application/json" } });
      });
      const auth = new AuthClient({ url: url + "/auth/v1", storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true,
        storage: { getItem: async name => rows.get(name) ?? null, setItem: async (name, value) => { rows.set(name, value); }, removeItem: async name => { rows.delete(name); } }, fetch });
      try {
        await auth.initialize();
        rows.set(key, JSON.stringify(session(true)));
        const result = method === "getSession" ? await auth.getSession() : method === "refreshSession" ? await auth.refreshSession() : await auth.refreshSession({ refresh_token: "synthetic-refresh" });
        expect(tokens).toEqual(method === "getSession" ? ["synthetic-refresh"] : method === "refreshSession" ? ["synthetic-refresh", "synthetic-rotated-1"] : ["synthetic-refresh", "synthetic-refresh"]);
        expect(result.error !== null).toBe(method === "explicitRefreshSession");
        expect(JSON.parse(rows.get(key)!).refresh_token).toBe(method === "refreshSession" ? "synthetic-rotated-2" : "synthetic-rotated-1");
      } finally { await auth.stopAutoRefresh(); }
    });
  }
});
