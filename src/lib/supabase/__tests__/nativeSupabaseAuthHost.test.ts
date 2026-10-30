// Actual installed public AuthClient + disposable real SQLite. All values and
// transports are synthetic/injected; no platform Keychain or real account.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeSupabaseAuthHost, NativeSupabaseAuthHostOptions } from "../supabaseAuthService";
import { combinedFixture, disposeCombinedFixtures } from "../../persistence/__tests__/nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "../../persistence/__tests__/nativeMigrationMTestKit";
import { fp, isSyntheticFingerprint } from "../../persistence/__tests__/nativeMigrationTestKit";
import { parseCredentialPhysicalSlot } from "../../persistence/credentialPhysicalSlots";
const hosts: NativeSupabaseAuthHost[] = [], releases: (() => void)[] = [];
let count = 0;
afterEach(async () => {
  while (releases.length) releases.pop()!();
  for (const host of hosts.splice(0)) await host.dispose();
  await disposeCombinedFixtures(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const user = { id: "11111111-1111-4111-8111-111111111111", email: "synthetic@example.invalid", aud: "authenticated", created_at: "2026-01-01T00:00:00Z", app_metadata: {}, user_metadata: {} };
function session(offset = 3600, withUser = true) {
  return { access_token: "SYNTHETIC_HOST_ACCESS", refresh_token: "SYNTHETIC_HOST_REFRESH", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + offset, ...(withUser ? { user } : {}) };
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } }); }
function denied(code = "refresh_token_not_found") { return response({ code, message: "SYNTHETIC_PRIVATE_PROVIDER_DETAIL" }, 400); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
type Event = { kind: string; key?: string; value?: string };
async function fixture(initial: "empty" | "valid" | "expired" | "proactive" | "missing_user" = "empty", platform: "ios" | "android" = "ios") {
  vi.resetModules();
  vi.stubGlobal("crypto", webcrypto);
  const h = await combinedFixture(platform); expect(await h.cap.release(h.lease)).toEqual({ ok: true });
  const label = `host-fixture-${++count}`, root = `sb-${label}-auth-token`, configId = `pc1:${label}`;
  const rows: Record<string, string> = initial === "empty" ? {} : { [root]: JSON.stringify(session(initial === "expired" ? -60 : initial === "proactive" ? 30 : 3600, initial !== "missing_user")) };
  const source = new SyntheticStorage(rows); vi.stubGlobal("localStorage", source);
  const values = new Map<string, string>(), events: Event[] = [];
  const faults: { hook?: (event: Event, next: () => Promise<unknown>) => Promise<unknown> } = {};
  const invoke = (event: Event, next: () => Promise<unknown>) => { events.push(event); return faults.hook ? faults.hook(event, next) : next(); };
  const binding = { failedWriteMayLosePreviousValue: true,
    configure: async () => invoke({ kind: "configure" }, async () => undefined),
    inventory: async () => invoke({ kind: "inventory" }, async () => ({ kind: "complete", keys: [...values.keys()].sort() })),
    read: async (key: string) => invoke({ kind: "read", key }, async () => values.has(key) ? { kind: "value", value: values.get(key)! } : { kind: "established_absent" }),
    write: async (key: string, value: string) => invoke({ kind: "write", key, value }, async () => { values.set(key, value); }),
    remove: async (key: string) => invoke({ kind: "remove", key }, async () => ({ kind: values.delete(key) ? "deleted" : "nothing_to_delete" })),
  };
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>().mockImplementation(async () => { throw new Error("Unexpected synthetic transport"); });
  const options: NativeSupabaseAuthHostOptions = { config: { status: "configured", url: `https://${label}.supabase.invalid`, publishableKey: "sb_publishable_SYNTHETIC_HOST_ONLY" }, fetch,
    migration: { sqlite: h.options, providerConfigIdentity: configId, sessionStorageKey: root, protectedBinding: binding, detectPlatform: () => "ios",
      domainFingerprint: fp, domainFingerprintFormat: isSyntheticFingerprint,
      credentialFingerprint: (_purpose, key, raw) => createHash("sha256").update(JSON.stringify(["credential-value/v1", key, raw])).digest("hex"),
      credentialFingerprintFormat: value => /^[0-9a-f]{64}$/.test(value), generateUuid: syntheticUuid, now: () => SYNTHETIC_NOW,
      limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 } },
  };
  const hostModule = await import("../supabaseAuthService"), seam = await import("../supabaseClient");
  async function make(overrides: Partial<NativeSupabaseAuthHostOptions> = {}) {
    const result = await hostModule.createNativeSupabaseAuthHost({ ...options, ...overrides });
    if (result.ok) hosts.push(result.host);
    return result;
  }
  async function made(overrides: Partial<NativeSupabaseAuthHostOptions> = {}) {
    const result = await make(overrides); if (!result.ok) throw new Error(result.reason); return result.host;
  }
  function item(event: Event) { const parsed = parseCredentialPhysicalSlot(configId, root, event.key); return parsed.ok && parsed.value.kind === "item" ? parsed.value.key : null; }
  function rawRoot() { for (const [key, value] of values) if (item({ kind: "read", key }) === root) return JSON.parse(value).value as string; return null; }
  return { ...h, sqlFaults: h.faults, root, source, values, events, faults, binding, fetch, options, module: hostModule, seam, make, made, item, rawRoot };
}

describe("actual native AUTH ownership", () => {
  for (const platform of ["ios", "android"] as const) it(`owns migration/retirement and normalized actual SDK restore with ${platform} SQLite statement model and injected iOS credentials`, async () => {
    const h = await fixture("valid", platform), host = await h.made();
    expect(Object.isFrozen(host)).toBe(true); expect(Object.keys(host).sort()).toEqual(["auth", "dispose", "health", "start"]);
    expect(h.events).toEqual([]); expect(h.fetch).not.toHaveBeenCalled();
    const first = host.start(); expect(host.start()).toBe(first);
    expect(await first).toEqual({ outcome: "ready" });
    expect(h.source.map.has(h.root)).toBe(false); expect(h.rawRoot()).toContain("SYNTHETIC_HOST_REFRESH");
    expect(await host.auth.restoreSession()).toEqual({ kind: "authenticated", identity: { accountScopeId: user.id, email: user.email } });
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.events.filter(e => e.kind === "configure")).toHaveLength(1);
    expect(JSON.stringify(host.health())).not.toMatch(/SYNTHETIC_HOST|sb-host|pc1:|synthetic@example/);
    expect(await host.dispose()).toEqual({ ok: true });
  });
  it("preserves actual Android platform refusal without SDK construction", async () => {
    const h = await fixture(), host = await h.made({ migration: { ...h.options.migration, detectPlatform: () => "android" } });
    expect(await host.start()).toEqual({ outcome: "waiting", code: "migration_blocked" }); expect(h.fetch).not.toHaveBeenCalled();
  });
  it("restores genuine absence and keeps pre-start methods closed without SDK I/O", async () => {
    const h = await fixture(), host = await h.made();
    expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" }); expect(h.events).toHaveLength(0);
    expect(await host.start()).toEqual({ outcome: "ready" }); expect(await host.auth.restoreSession()).toEqual({ kind: "no_session" });
  });
  it("reserves before option getters and blocks reentrant legacy construction/claim", async () => {
    const h = await fixture(); let checked = false;
    const options = { ...h.options, get config() {
      checked = true; expect(() => h.seam.getSupabaseBrowserClient(h.options.config)).toThrow("reserved");
      expect(h.seam.claimBrowserAuthStorage({ async getItem() { return null; }, async setItem() {}, async removeItem() {} }, () => null)).toEqual({ ok: false, reason: "already_claimed" });
      return h.options.config;
    } };
    const result = await h.module.createNativeSupabaseAuthHost(options); expect(result.ok).toBe(true); if (result.ok) hosts.push(result.host);
    expect(checked).toBe(true); expect((await h.make()).ok).toBe(false); h.seam.resetSupabaseBrowserClientForTests();
    expect((await h.make()).ok).toBe(false);
  });
  it("refuses a preexisting legacy storage claim before migration/source work", async () => {
    const h = await fixture(); h.seam.claimBrowserAuthStorage({ async getItem() { return null; }, async setItem() {}, async removeItem() {} }, () => null);
    expect(await h.make()).toEqual({ ok: false, reason: "ownership_conflict" }); expect(h.events).toHaveLength(0);
  });
  for (const mode of ["root", "config", "userinfo", "query", "trim", "secret"] as const) it(`refuses unsupported exact configuration: ${mode}`, async () => {
    const h = await fixture();
    const config = mode === "config" ? { ...h.options.config, status: "cloud_disabled" } : mode === "secret" ? { ...h.options.config, publishableKey: "sb_secret_SYNTHETIC_ONLY" } :
      { ...h.options.config, url: mode === "userinfo" ? "https://user:pass@fixture.invalid" : mode === "query" ? h.options.config.url + "?other=1" : mode === "trim" ? h.options.config.url + " " : h.options.config.url };
    const result = await h.make({ config: config as NativeSupabaseAuthHostOptions["config"], ...(mode === "root" ? { migration: { ...h.options.migration, sessionStorageKey: "sb-other-auth-token" } } : {}) });
    expect(result.ok).toBe(false); expect(h.events).toHaveLength(0); expect((await h.make()).ok).toBe(true);
  });
  it("owns a masked pending malformed factory dependency before releasing its reservation", async () => {
    const h = await fixture(), d = deferred<void>(); releases.push(() => d.resolve());
    Object.defineProperty(d.promise, "then", { value: undefined }); let later = 0, done = false;
    const options = { ...h.options, get config() { return d.promise as unknown as NativeSupabaseAuthHostOptions["config"]; }, get fetch() { later++; return h.fetch; } };
    const first = h.module.createNativeSupabaseAuthHost(options);
    void first.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false); expect(later).toBe(0);
    expect(await h.make()).toEqual({ ok: false, reason: "ownership_conflict" }); d.resolve();
    expect(await first).toEqual({ ok: false, reason: "invalid_dependency" }); expect((await h.make()).ok).toBe(true);
  });
  it("requires actual source retirement and never falls back after a source removal failure", async () => {
    const h = await fixture("valid"), host = await h.made();
    h.source.removeItem = () => { throw new Error("SYNTHETIC_PRIVATE_REMOVE"); };
    expect(await host.start()).toEqual({ outcome: "waiting", code: "retirement_incomplete" }); expect(h.fetch).not.toHaveBeenCalled();
    expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" }); expect(() => h.seam.getSupabaseBrowserClient(h.options.config)).toThrow();
  });
  it("keeps same-context construction tombstone after clean cleanup", async () => {
    const h = await fixture(), host = await h.made(); expect(await host.start()).toEqual({ outcome: "ready" }); expect(await host.dispose()).toEqual({ ok: true });
    const other = await h.made(); expect(await other.start()).toEqual({ outcome: "waiting", code: "restart_required" });
    expect(await other.start()).toEqual({ outcome: "waiting", code: "restart_required" });
  });
});

describe("whole actual SDK commands and causal provider denial", () => {
  for (const mode of ["clean", "read_fault", "remove_fault"] as const) it(`retains expired refresh denial through ${mode}`, async () => {
    const h = await fixture("expired"), host = await h.made(); expect(await host.start()).toEqual({ outcome: "ready" });
    h.fetch.mockImplementation(async () => {
      if (mode !== "clean") h.faults.hook = async (event, next) => { if (h.item(event) === h.root && event.kind === (mode === "read_fault" ? "read" : "remove")) throw new Error("SYNTHETIC_PRIVATE_STORAGE"); return next(); };
      return denied();
    });
    expect(await host.auth.restoreSession()).toEqual({ kind: "invalid_session" }); expect(h.fetch).toHaveBeenCalledTimes(1);
    if (mode !== "clean") expect(host.health().storageFailed).toBe(true);
  });
  it("keeps the actual proactive healthy session after rejected refresh", async () => {
    const h = await fixture("proactive"), host = await h.made(); await host.start(); h.fetch.mockResolvedValue(denied());
    expect(await host.auth.restoreSession()).toMatchObject({ kind: "authenticated" }); expect(host.health().storageFailed).toBe(false);
  });
  it("does not turn a proactive cleanup read fault into session denial", async () => {
    const h = await fixture("proactive"), host = await h.made(); await host.start();
    h.fetch.mockImplementation(async () => { h.faults.hook = async (event, next) => { if (event.kind === "read" && h.item(event) === h.root) throw null; return next(); }; return denied(); });
    expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" }); expect(host.health().storageFailed).toBe(true);
  });
  it("reports rotation write failure as storage fault without denial", async () => {
    const h = await fixture("expired"), host = await h.made(); await host.start();
    h.fetch.mockImplementation(async () => { h.faults.hook = async (event, next) => { if (event.kind === "write" && h.item(event) === h.root) throw null; return next(); }; return response(session()); });
    expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" }); expect(host.health().storageFailed).toBe(true);
  });
  it("invalid OTP does not deny the existing session", async () => {
    const h = await fixture("valid"), host = await h.made(); await host.start(); h.fetch.mockResolvedValue(denied("otp_expired"));
    expect((await host.auth.verifyEmailOtp(user.email, "123456")).ok).toBe(false);
    expect(await host.auth.restoreSession()).toMatchObject({ kind: "authenticated" });
  });
  for (const mode of ["success", "missing", "remove_fault", "other"] as const) it(`handles actual init missing-user recovery: ${mode}`, async () => {
    const h = await fixture("missing_user"), host = await h.made();
    h.fetch.mockImplementation(async request => {
      expect(new URL((request as Request).url).pathname).toBe("/auth/v1/user");
      if (mode === "remove_fault") h.faults.hook = async (event, next) => { if (event.kind === "remove" && h.item(event) === h.root) throw null; return next(); };
      return mode === "success" ? response({ user }) : denied(mode === "other" ? "bad_jwt" : "session_not_found");
    });
    const started = await host.start();
    if (mode === "success") { expect(started).toEqual({ outcome: "ready" }); expect(await host.auth.restoreSession()).toMatchObject({ kind: "authenticated" }); }
    else if (mode === "other") { expect(started.outcome).toBe("waiting"); expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" }); }
    else expect(await host.auth.restoreSession()).toEqual({ kind: "invalid_session" });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps confirmed init denial when a later deliberate sign-in root write fails", async () => {
    const h = await fixture("missing_user"), host = await h.made(); h.fetch.mockResolvedValueOnce(denied("session_not_found"));
    expect(await host.start()).toEqual({ outcome: "ready" }); expect(await host.auth.restoreSession()).toEqual({ kind: "invalid_session" });
    h.fetch.mockResolvedValue(response(session())); h.faults.hook = async (event, next) => { if (event.kind === "write" && h.item(event) === h.root) throw null; return next(); };
    expect((await host.auth.verifyEmailOtp(user.email, "123456")).ok).toBe(false); expect(await host.auth.restoreSession()).toEqual({ kind: "invalid_session" });
  });
  it("drains actual rotation before current signout without poisoning the settlement latch", async () => {
    const h = await fixture("expired"), host = await h.made(); await host.start(); const sent = deferred<void>(), answer = deferred<Response>(); releases.push(() => answer.resolve(response(session())));
    h.fetch.mockImplementation(async request => {
      if (new URL((request as Request).url).pathname.endsWith("/token")) { sent.resolve(); return answer.promise; }
      expect(new URL((request as Request).url).pathname.endsWith("/logout")).toBe(true); return new Response(null, { status: 204 });
    });
    const observations: unknown[] = []; host.auth.onAuthChange(change => { observations.push(change); });
    const restoring = host.auth.restoreSession(); await sent.promise;
    const signingOut = host.auth.signOut(); answer.resolve(response(session()));
    expect(await restoring).toEqual({ kind: "temporarily_unavailable" }); expect(await signingOut).toEqual({ ok: true, value: undefined });
    expect(host.health().storageFailed).toBe(false); expect(h.rawRoot()).toBe(null); expect(observations).toEqual([{ reason: "signed_out" }]);
  });
  it("whole OTP commands serialize actual PKCE writes and SEND with no fallback/cookies/redirect", async () => {
    const h = await fixture(), host = await h.made(); await host.start(); const first = deferred<Response>(), entered = deferred<void>(); releases.push(() => first.resolve(response({})));
    h.fetch.mockImplementationOnce(async request => { expect((request as Request).credentials).toBe("omit"); expect((request as Request).redirect).toBe("error"); entered.resolve(); return first.promise; }).mockResolvedValue(response({}));
    const a = host.auth.requestEmailOtp(user.email); await entered.promise; const b = host.auth.requestEmailOtp(user.email); await Promise.resolve(); expect(h.fetch).toHaveBeenCalledTimes(1);
    first.resolve(response({})); expect((await a).ok).toBe(true); expect((await b).ok).toBe(true); expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(await host.auth.restoreSession()).toEqual({ kind: "no_session" });
  });
  it("contains reentrant code/origin callbacks before actual SDK work", async () => {
    const h = await fixture(), host = await h.made({ resolveAppOrigin: () => { void host.auth.signOut(); return "https://app.invalid"; }, navigate: () => {} }); await host.start();
    expect((await host.auth.prepareGoogleSignIn("https://app.invalid/callback")).kind).not.toBe("prepared"); expect(h.fetch).not.toHaveBeenCalled();
    const claim = { flowId: "flow1234", readAuthorizationCode() { void host.auth.signOut(); return "SYNTHETIC_CODE"; }, toJSON: () => ({}) };
    expect((await host.auth.exchangeCorrelatedCallback(claim, "flow1234")).kind).not.toBe("exchanged"); expect(h.fetch).not.toHaveBeenCalled();
  });
  it("owns local normalized observer errors/reentrancy without SDK subscriptions", async () => {
    const h = await fixture("valid"), host = await h.made(); await host.start();
    host.auth.onAuthChange(() => { throw new Error("SYNTHETIC_PRIVATE_LISTENER"); });
    host.auth.onAuthChange((() => Promise.reject(new Error("SYNTHETIC_PRIVATE_ASYNC_LISTENER"))) as () => void);
    const seen: string[] = []; host.auth.onAuthChange(change => { seen.push(change.reason); });
    expect(await host.auth.restoreSession()).toMatchObject({ kind: "authenticated" }); await Promise.resolve(); expect(seen).toEqual(["initial_session"]);
  });
});

describe("actual transport and terminal drain", () => {
  for (const property of ["ok", "status", "headers", "json"] as const) it(`ignores foreign Response own ${property} getters`, async () => {
    const h = await fixture("missing_user"), host = await h.made(); let touched = 0;
    const actual = response({ user }); Object.defineProperty(actual, property, { get() { touched++; throw new Error("SYNTHETIC_PRIVATE_RESPONSE"); } });
    h.fetch.mockResolvedValue(actual); expect(await host.start()).toEqual({ outcome: "ready" }); expect(touched).toBe(0);
    expect(await host.auth.restoreSession()).toMatchObject({ kind: "authenticated" });
  });
  it("normalizes a foreign thrown transport reason without reading it", async () => {
    const h = await fixture("missing_user"), host = await h.made(); let read = 0;
    h.fetch.mockRejectedValue(new Proxy({}, { get() { read++; throw null; }, has() { read++; throw null; } }));
    expect((await host.start()).outcome).toBe("waiting"); expect(read).toBe(0); expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" });
  });
  it("rejects malformed responses instead of letting a fake SDK typed exception through", async () => {
    const h = await fixture("missing_user"), host = await h.made(); let read = 0;
    h.fetch.mockResolvedValue({ get ok() { read++; throw null; } } as unknown as Response);
    expect((await host.start()).outcome).toBe("waiting"); expect(read).toBe(0); expect(host.health().sdkFailed).toBe(true);
    expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" });
  });
  it("dispose synchronously closes rights while holding actual pending fetch/body and reservation", async () => {
    const h = await fixture("valid"), host = await h.made(); await host.start(); const sent = deferred<void>(), body = deferred<Response>(); releases.push(() => body.resolve(response(session())));
    h.fetch.mockImplementation(async () => { sent.resolve(); return body.promise; });
    const verifying = host.auth.verifyEmailOtp(user.email, "123456"); await sent.promise; const before = h.events.filter(e => e.kind === "write").length;
    const disposing = host.dispose(); expect(host.dispose()).toBe(disposing); expect(host.health().phase).toBe("closing"); expect((await h.make()).ok).toBe(false);
    body.resolve(response(session())); expect((await verifying).ok).toBe(false); await disposing;
    expect(h.events.filter(e => e.kind === "write")).toHaveLength(before); expect(await host.start()).toEqual({ outcome: "closed" });
  });
  it("retains reservation after genuine runtime storage fault and failed cleanup", async () => {
    const h = await fixture("valid"), host = await h.made(); await host.start(); h.faults.hook = async (event, next) => { if (event.kind === "read" && h.item(event) === h.root) throw null; return next(); };
    expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" }); expect(await host.dispose()).toEqual({ ok: false, reason: "evidence_held" });
    expect(await h.make()).toEqual({ ok: false, reason: "ownership_conflict" });
  });
});

describe("native AUTH interruption and compatible resources", () => {
  it("closes constructor BroadcastChannel before actual credential initialization and removes normal visibility listener", async () => {
    const h = await fixture("valid"), visibility = new Set<unknown>(); let channels = 0, closed = 0, readsBeforeChannelClosed = 0;
    vi.stubGlobal("window", { location: { href: "https://app.invalid/", origin: "https://app.invalid" }, addEventListener(name: string, value: unknown) { if (name === "visibilitychange") visibility.add(value); }, removeEventListener(name: string, value: unknown) { if (name === "visibilitychange") visibility.delete(value); } });
    vi.stubGlobal("document", { visibilityState: "visible" });
    vi.stubGlobal("BroadcastChannel", class { constructor() { channels++; } addEventListener() {} postMessage() {} close() { closed++; } });
    h.faults.hook = async (event, next) => { if (channels && !closed && event.kind === "read") readsBeforeChannelClosed++; return next(); };
    const host = await h.made(); expect(channels).toBe(0); expect(await host.start()).toEqual({ outcome: "ready" });
    expect(channels).toBe(1); expect(closed).toBe(1); expect(readsBeforeChannelClosed).toBe(0); expect(visibility.size).toBe(0);
    await host.dispose(); expect(visibility.size).toBe(0);
  });
  it("cold mutable restart uses genuine persisted target and absent source without reimporting historical bytes", async () => {
    const h = await fixture("valid"), host = await h.made(); await host.start(); h.fetch.mockResolvedValue(response({ ...session(), refresh_token: "SYNTHETIC_NEW_REFRESH" }));
    expect((await host.auth.verifyEmailOtp(user.email, "123456")).ok).toBe(true); expect(await host.dispose()).toEqual({ ok: true });
    vi.resetModules(); const fresh = await import("../supabaseAuthService"); const made = await fresh.createNativeSupabaseAuthHost(h.options); expect(made.ok).toBe(true); if (!made.ok) throw null; hosts.push(made.host);
    expect(await made.host.start()).toEqual({ outcome: "ready" }); expect(await made.host.auth.restoreSession()).toMatchObject({ kind: "authenticated" }); expect(h.rawRoot()).toContain("SYNTHETIC_NEW_REFRESH");
  });
  it("continues the same partially completed migration without SDK construction or early source retirement", async () => {
    const h = await fixture("valid"), host = await h.made({ migration: { ...h.options.migration, limits: { ...h.options.migration.limits, protocolStepLimit: 1 } } });
    expect((await host.start()).outcome).toBe("waiting"); expect(h.source.map.has(h.root)).toBe(true); expect(h.fetch).not.toHaveBeenCalled();
    let result = await host.start(); for (let i = 0; i < 30 && result.outcome !== "ready"; i++) result = await host.start();
    expect(result).toEqual({ outcome: "ready" }); expect(h.events.filter(event => event.kind === "configure")).toHaveLength(1);
  });
  it("suppresses denial for an actual positively observed replacement credential generation", async () => {
    const h = await fixture("expired"), host = await h.made(); await host.start();
    h.fetch.mockImplementation(async () => { for (const [key, raw] of h.values) if (h.item({ kind: "read", key }) === h.root) { const envelope = JSON.parse(raw); envelope.value = JSON.stringify({ ...session(), refresh_token: "SYNTHETIC_REPLACEMENT" }); h.values.set(key, JSON.stringify(envelope)); } return denied(); });
    expect(await host.auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" }); expect(h.rawRoot()).toContain("SYNTHETIC_REPLACEMENT");
    expect(await host.auth.restoreSession()).toMatchObject({ kind: "authenticated" }); expect(host.health().storageFailed).toBe(false);
  });
  it("queues whole Google preparations, preserves both actual PKCE slots and fences navigation", async () => {
    const h = await fixture(), navigated: string[] = [], host = await h.made({ resolveAppOrigin: () => "https://app.invalid", navigate: url => { navigated.push(url); } }); await host.start();
    const [a, b] = await Promise.all([host.auth.prepareGoogleSignIn("https://app.invalid/callback"), host.auth.prepareGoogleSignIn("https://app.invalid/callback")]);
    expect(a.kind).toBe("prepared"); expect(b.kind).toBe("prepared"); if (a.kind !== "prepared" || b.kind !== "prepared") throw null;
    const actualIndex = [...h.values].find(([key]) => h.item({ kind: "read", key }) === h.root + "-flows-code-verifier"); expect(actualIndex).toBeDefined();
    expect(JSON.parse(JSON.parse(actualIndex![1]).value)).toEqual(expect.arrayContaining([a.prepared.flowId, b.prepared.flowId]));
    expect(host.auth.navigateToAuthorizationUrl(b.prepared)).toEqual({ kind: "navigating" }); expect(navigated).toEqual([b.prepared.authorizationUrl]); expect(h.fetch).not.toHaveBeenCalled();
    const getter = { get authorizationUrl() { void host.auth.signOut(); return b.prepared.authorizationUrl; }, flowId: b.prepared.flowId };
    expect(host.auth.navigateToAuthorizationUrl(getter)).toEqual({ kind: "navigation_failed" }); expect(navigated).toHaveLength(1);
  });
  it("does not publish a usable Google URL after partial verifier persistence failure", async () => {
    const h = await fixture(), host = await h.made({ resolveAppOrigin: () => "https://app.invalid", navigate: () => {} }); await host.start();
    h.faults.hook = async (event, next) => { if (event.kind === "write" && h.item(event)?.includes("-flow-")) throw null; return next(); };
    expect((await host.auth.prepareGoogleSignIn("https://app.invalid/callback")).kind).not.toBe("prepared"); expect(host.health().storageFailed).toBe(true); expect(h.fetch).not.toHaveBeenCalled();
  });
  for (const mode of ["email", "claim", "code"] as const) it(`owns masked pending malformed ${mode} until real command drain`, async () => {
    const h = await fixture(), host = await h.made(); await host.start(); const d = deferred<void>(); releases.push(() => d.resolve()); Object.defineProperty(d.promise, "then", { value: undefined });
    let finished = false;
    const result = mode === "email" ? host.auth.requestEmailOtp(d.promise as unknown as string) : host.auth.exchangeCorrelatedCallback(mode === "claim" ? d.promise as never : { flowId: "flow1234", readAuthorizationCode: () => d.promise as never, toJSON: () => ({}) }, "flow1234");
    void result.then(() => { finished = true; }); await Promise.resolve(); await Promise.resolve(); expect(finished).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
    const disposing = host.dispose(); expect((await h.make()).ok).toBe(false); d.resolve(); await result; expect(await disposing).toEqual({ ok: true });
  });
  it("waits for actual pending response body completion during terminal disposal", async () => {
    const h = await fixture(), host = await h.made(); await host.start(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const sent = deferred<void>(), stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } }); releases.push(() => { try { controller.close(); } catch {} });
    h.fetch.mockImplementation(async () => { sent.resolve(); return new Response(stream); });
    const verifying = host.auth.verifyEmailOtp(user.email, "123456"); await sent.promise; const disposing = host.dispose(); let disposed = false; void disposing.then(() => { disposed = true; });
    await Promise.resolve(); expect(disposed).toBe(false); expect((await h.make()).ok).toBe(false); controller.enqueue(new TextEncoder().encode(JSON.stringify(session()))); controller.close();
    expect((await verifying).ok).toBe(false); expect(await disposing).toEqual({ ok: true }); expect(h.rawRoot()).toBe(null);
  });
  it("blocks actual SDK retries immediately after signout intent while retaining real drain", async () => {
    const h = await fixture("expired"), host = await h.made(); await host.start(); vi.useFakeTimers();
    const sent = deferred<void>(), answer = deferred<Response>(); releases.push(() => answer.resolve(response({}, 503)));
    h.fetch.mockImplementation(async () => { sent.resolve(); return answer.promise; });
    const restoring = host.auth.restoreSession(); await sent.promise; const signingOut = host.auth.signOut(); answer.resolve(response({}, 503));
    await vi.advanceTimersByTimeAsync(60_000); expect(await restoring).toEqual({ kind: "temporarily_unavailable" }); await signingOut;
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(host.health().storageFailed).toBe(false);
  });
  it("does not SEND after reentrant Request materialization disposes the host", async () => {
    const h = await fixture(); const OriginalRequest = Request;
    vi.stubGlobal("Request", class extends OriginalRequest { constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, init); if (host) void host.dispose(); } });
    const host = await h.made(); await host.start(); expect((await host.auth.verifyEmailOtp(user.email, "123456")).ok).toBe(false); await host.dispose(); expect(h.fetch).not.toHaveBeenCalled();
  });
  it("retains ownership when actual SQL cleanup is unconfirmed", async () => {
    const h = await fixture(), host = await h.made(); await host.start(); h.sqlFaults.hook = async (event, next) => { if (event.kind === "close") throw null; return next(); };
    expect(await host.dispose()).toEqual({ ok: false, reason: "cleanup_unconfirmed" }); expect(await h.make()).toEqual({ ok: false, reason: "ownership_conflict" });
  });
});


// Permanent regressions from the independent first CODE gate.
describe("independent S5a counterexamples",()=>{
 it("does not return obsolete identity after observer synchronously signs out",async()=>{
  const h=await fixture("valid"),host=await h.made();expect(await host.start()).toEqual({outcome:"ready"});
  h.fetch.mockResolvedValue(new Response(null,{status:204}));let leaving:Promise<unknown>|null=null;
  host.auth.onAuthChange(()=>{if(!leaving)leaving=host.auth.signOut();});
  const outcome=await host.auth.restoreSession();if(leaving)await leaving;
  expect(outcome).toEqual({kind:"temporarily_unavailable"});
 });
 it("owns directly observed malformed inner pending transport value through disposal",async()=>{
  const h=await fixture(),host=await h.made();await host.start();const inner=deferred<void>();releases.push(()=>inner.resolve());Object.defineProperty(inner.promise,"then",{value:null});
  h.fetch.mockImplementation((async()=>inner.promise) as never);
  let completed=false;const request=host.auth.verifyEmailOtp(user.email,"123456");void request.then(()=>completed=true);
  await new Promise(resolve=>setTimeout(resolve,20));const disposal=host.dispose();let disposed=false;void disposal.then(()=>disposed=true);
  await new Promise(resolve=>setTimeout(resolve,20));
  const early={completed,disposed};inner.resolve();await request;await disposal;
  expect(early).toEqual({completed:false,disposed:false});
 });
 it("revokes genuine migration work synchronously when disposal wins pending configure",async()=>{
  const h=await fixture("valid"),host=await h.made();const entered=deferred<void>(),continueConfigure=deferred<void>();releases.push(()=>continueConfigure.resolve());
  h.faults.hook=async(event,next)=>{if(event.kind==="configure"){entered.resolve();await continueConfigure.promise;}return next();};
  const starting=host.start();await entered.promise;const before=h.events.length;const disposal=host.dispose();continueConfigure.resolve();
  expect(await starting).toEqual({outcome:"closed"});await disposal;
  expect(h.events.slice(before).filter(e=>["inventory","read","write","remove"].includes(e.kind)).length).toBe(0);
 });
 it("does not remove another source credential after reentrant disposal at first actual remove",async()=>{
  const h=await fixture("valid");h.source.map.set(h.root+"-user",JSON.stringify({user}));const host=await h.made();
  const remove=h.source.removeItem.bind(h.source);let removed=0;let disposal:Promise<unknown>|null=null;
  h.source.removeItem=(key:string)=>{remove(key);if(++removed===1)disposal=host.dispose();};
  expect(await host.start()).toEqual({outcome:"closed"});if(disposal)await disposal;
  expect(removed).toBe(1);expect(h.source.map.size).toBe(1);
 });
});

describe("adjacent actual S5a boundaries",()=>{
 it("preserves actual healthy proactive SDK result if expiry crosses during its final storage read",async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-25T02:00:00Z"));
  const h=await fixture("proactive"),host=await h.made();await host.start();let reads=0;const before=Date.now();h.fetch.mockResolvedValue(denied());
  h.faults.hook=async(event,next)=>{const result=await next();if(event.kind==="read"&&h.item(event)===h.root&&++reads===4)vi.setSystemTime(before+60_000);return result;};
  const result=await host.auth.restoreSession();expect(reads).toBe(4);expect(result.kind).toBe("authenticated");
 });
 it("retains directly observed malformed platform primitive if later global capture throws",async()=>{
  const h=await fixture(),d=deferred<void>();releases.push(()=>d.resolve());Object.defineProperty(d.promise,"then",{value:null});const originalResponse=Response;
  vi.stubGlobal("Request",d.promise);Object.defineProperty(globalThis,"Response",{configurable:true,get(){throw null;}});
  let completed=false;const factory=h.make();void factory.then(()=>completed=true);await new Promise(resolve=>setTimeout(resolve,20));
  Object.defineProperty(globalThis,"Response",{configurable:true,writable:true,value:originalResponse});
  const early=completed;d.resolve();await factory;expect(early).toBe(false);
 });
 it("retains failed initial SDK cleanup evidence even if later dispose succeeds",async()=>{
  const h=await fixture("valid");let closes=0;
  vi.stubGlobal("window",{location:{href:"https://app.invalid/",origin:"https://app.invalid"},addEventListener(){},removeEventListener(){}});vi.stubGlobal("document",{visibilityState:"visible"});
  vi.stubGlobal("BroadcastChannel",class{addEventListener(){}postMessage(){}close(){if(++closes===1)throw null;}});
  const host=await h.made();expect(await host.start()).toEqual({outcome:"waiting",code:"sdk_failed"});const marked=host.health().cleanupUnconfirmed;const cleanup=await host.dispose();
  expect(closes).toBe(2);expect(marked).toBe(true);expect(cleanup).toEqual({ok:false,reason:"cleanup_unconfirmed"});
 });
});

it("keeps healthy credential storage distinct from SDK-only waiting failure",async()=>{
 const h=await fixture("missing_user"),host=await h.made();h.fetch.mockResolvedValue(denied("bad_jwt"));
 expect(await host.start()).toEqual({outcome:"waiting",code:"sdk_failed"});expect(host.health().storageFailed).toBe(false);
 expect(await host.start()).toEqual({outcome:"waiting",code:"sdk_failed"});
});

for(const dependency of ["request","body"] as const)it(`holds directly observed malformed pending ${dependency} return through disposal`,async()=>{
 const h=await fixture(),inner=deferred<void>();releases.push(()=>inner.resolve());Object.defineProperty(inner.promise,"then",{value:null});
 const OriginalRequest=Request,originalText=Response.prototype.text;
 if(dependency==="request")vi.stubGlobal("Request",class extends OriginalRequest{constructor(input:RequestInfo|URL,init?:RequestInit){super(input,init);return inner.promise as never;}});
 else Response.prototype.text=(async()=>inner.promise) as never;
 try{
  const host=await h.made();await host.start();h.fetch.mockResolvedValue(response(session()));let completed=false,disposed=false;
  const command=host.auth.verifyEmailOtp(user.email,"123456");void command.then(()=>completed=true);await new Promise(resolve=>setTimeout(resolve,20));
  const disposal=host.dispose();void disposal.then(()=>disposed=true);await new Promise(resolve=>setTimeout(resolve,20));const early={completed,disposed};inner.resolve();await command;await disposal;
  expect(early).toEqual({completed:false,disposed:false});
 }finally{Response.prototype.text=originalText;}
});

it("does not consume claimed code after its method getter synchronously signs out",async()=>{
 const h=await fixture(),host=await h.made();await host.start();let codeReads=0;let leaving:Promise<unknown>|null=null;
 const claim={flowId:"flow1234",get readAuthorizationCode(){leaving=host.auth.signOut();return ()=>{codeReads++;return "SYNTHETIC_CODE";};},toJSON:()=>({})};
 await host.auth.exchangeCorrelatedCallback(claim,"flow1234");if(leaving)await leaving;expect(h.fetch).not.toHaveBeenCalled();expect(codeReads).toBe(0);
});
it("retains observed malformed navigation field when the next field getter throws",async()=>{
 const h=await fixture(),host=await h.made({resolveAppOrigin:()=>"https://app.invalid",navigate:()=>{}});await host.start();const d=deferred<void>();releases.push(()=>d.resolve());Object.defineProperty(d.promise,"then",{value:null});
 expect(host.auth.navigateToAuthorizationUrl({authorizationUrl:d.promise,get flowId(){throw null;}} as never)).toEqual({kind:"navigation_failed"});
 let completed=false;const cleanup=host.dispose();void cleanup.then(()=>completed=true);await new Promise(resolve=>setTimeout(resolve,20));const early=completed;d.resolve();await cleanup;expect(early).toBe(false);
});


it("retains and closes a genuine pair published just before host observes handoff", async () => {
  const h = await fixture("valid");
  let armed = false, scheduled = false, disposal: Promise<unknown> | null = null;
  const binding = new Proxy(h.binding, { getOwnPropertyDescriptor(target, key) { if (key === "remove") armed = true; return Reflect.getOwnPropertyDescriptor(target, key); } });
  const host = await h.made({ migration: { ...h.options.migration, protectedBinding: binding } });
  const read = h.source.getItem;
  h.source.getItem = key => {
    const value = Reflect.apply(read, h.source, [key]);
    if (armed && !scheduled) { scheduled = true; queueMicrotask(() => { disposal = host.dispose(); }); }
    return value;
  };
  expect(await host.start()).toEqual({ outcome: "closed" });
  expect(scheduled).toBe(true); expect(await disposal).toEqual({ ok: true });
  expect(host.health().runtime?.lifecycle).toBe("closed"); expect(host.health().storageFailed).toBe(false);
  expect(h.fetch).not.toHaveBeenCalled(); expect(h.rawRoot()).toContain("SYNTHETIC_HOST_REFRESH");
  const next = await h.made(); expect(await next.start()).toEqual({ outcome: "ready" });
});

for (const dependency of ["response", "headers"] as const) it(`drains malformed pending fresh ${dependency} constructor output`, async () => {
  const h = await fixture(), inner = deferred<void>(); releases.push(() => inner.resolve()); Object.defineProperty(inner.promise, "then", { value: null });
  const OriginalResponse = Response;
  if (dependency === "response") vi.stubGlobal("Response", new Proxy(Response, { construct() { return inner.promise; } }));
  else vi.stubGlobal("Headers", new Proxy(Headers, { construct() { return inner.promise; } }));
  const host = await h.made(); await host.start();
  h.fetch.mockResolvedValue(new OriginalResponse(JSON.stringify(session()), { status: 200 }));
  let completed = false, disposed = false;
  const command = host.auth.verifyEmailOtp(user.email, "123456"); void command.then(() => { completed = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); const disposal = host.dispose(); void disposal.then(() => { disposed = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); const early = { completed, disposed }; inner.resolve(); await command; await disposal;
  expect(early).toEqual({ completed: false, disposed: false });
});


// Final independent Request-brand and observer-aliasing regressions.
it("refuses Promise constructor output despite plausible Request url and method",async()=>{
 const h=await fixture(),d=deferred<void>();releases.push(()=>d.resolve());Object.defineProperty(d.promise,"then",{value:null});
 Object.defineProperties(d.promise,{url:{value:h.options.config.url+"/auth/v1/verify"},method:{value:"POST"}});
 const ActualRequest=Request;vi.stubGlobal("Request",class extends ActualRequest{constructor(input:RequestInfo|URL,init?:RequestInit){super(input,init);return d.promise as never;}});
 const host=await h.made();await host.start();h.fetch.mockResolvedValue(response(session()));
 let completed=false;const command=host.auth.verifyEmailOtp(user.email,"123456");void command.then(()=>completed=true);await new Promise(resolve=>setTimeout(resolve,20));
 const sends=h.fetch.mock.calls.length;const early=completed;const closing=host.dispose();d.resolve();await command;await closing;
 expect(sends).toBe(0);expect(early).toBe(false);
});
it("observer cannot rewrite the SDK-derived identity before public result publication",async()=>{
 const h=await fixture("valid"),host=await h.made();await host.start();
 host.auth.onAuthChange(change=>{if("identity" in change&&change.identity)(change.identity as {accountScopeId:string}).accountScopeId="22222222-2222-4222-8222-222222222222";});
 const seen:string[]=[];host.auth.onAuthChange(change=>{if("identity" in change&&change.identity)seen.push(change.identity.accountScopeId);});
 const outcome=await host.auth.restoreSession();expect(outcome).toEqual({kind:"authenticated",identity:{accountScopeId:user.id,email:user.email}});expect(seen).toEqual([user.id]);
});

it("holds malformed actual clone output until genuine drain without SEND", async () => {
  const h = await fixture(), inner = deferred<void>(); releases.push(() => inner.resolve()); Object.defineProperty(inner.promise, "then", { value: null });
  const originalClone = Request.prototype.clone;
  Request.prototype.clone = (() => inner.promise) as never;
  try {
    const host = await h.made(); await host.start(); h.fetch.mockResolvedValue(response(session()));
    let completed = false, disposed = false;
    const command = host.auth.verifyEmailOtp(user.email, "123456"); void command.then(() => { completed = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); const disposal = host.dispose(); void disposal.then(() => { disposed = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); const early = { completed, disposed }; inner.resolve(); await command; await disposal;
    expect(h.fetch).not.toHaveBeenCalled(); expect(early).toEqual({ completed: false, disposed: false });
  } finally { Request.prototype.clone = originalClone; }
});

for (const command of ["verify", "exchange"] as const) it(`isolates immutable ${command} observations from public result identity`, async () => {
  const h = await fixture(), host = await h.made({ resolveAppOrigin: () => "https://app.invalid", navigate: () => {} }); await host.start();
  h.fetch.mockResolvedValue(response(session())); let frozen = false;
  host.auth.onAuthChange(change => {
    if ("identity" in change && change.identity) {
      frozen = Object.isFrozen(change) && Object.isFrozen(change.identity);
      try { change.identity.accountScopeId = "22222222-2222-4222-8222-222222222222"; } catch {}
      try { change.reason = "other" as never; } catch {}
    }
  });
  const seen: string[] = []; host.auth.onAuthChange(change => { if ("identity" in change && change.identity) seen.push(change.identity.accountScopeId); });
  if (command === "verify") {
    expect(await host.auth.verifyEmailOtp(user.email, "123456")).toEqual({ ok: true, value: { accountScopeId: user.id, email: user.email } });
  } else {
    const prepared = await host.auth.prepareGoogleSignIn("https://app.invalid/callback"); expect(prepared.kind).toBe("prepared"); if (prepared.kind !== "prepared") throw null;
    const claim = { flowId: prepared.prepared.flowId, readAuthorizationCode: () => "SYNTHETIC_EXCHANGE_CODE", toJSON: () => ({}) };
    expect(await host.auth.exchangeCorrelatedCallback(claim, prepared.prepared.flowId)).toEqual({ kind: "exchanged", identity: { accountScopeId: user.id, email: user.email } });
  }
  expect(frozen).toBe(true); expect(seen).toEqual([user.id]);
});

describe("legacy native owner has no review password capability", () => {
  const reviewInput = "SYNTHETIC_REVIEW_INPUT";
  it("refuses review access before SDK while retaining its original owner", async () => {
    const h=await fixture(), host=await h.made(); await host.start();
    const observed=vi.fn();host.auth.onAuthChange(observed);
    expect(host.auth.canSignInForReview()).toBe(false);
    expect((await host.auth.signInForReview(user.email,reviewInput)).ok).toBe(false);
    expect(h.fetch).not.toHaveBeenCalled();expect(h.rawRoot()).toBeNull();expect(observed).not.toHaveBeenCalled();
    expect(await host.auth.restoreSession()).toMatchObject({kind:"no_session"});
    expect((await h.make()).ok).toBe(false);
  });
  for(const mode of ["no_session","malformed_user","hook_denial","rate_limit","network"] as const)it(`refuses legacy review irrespective of configured transport: ${mode}`,async()=>{
    const h=await fixture(),host=await h.made();await host.start();
    h.fetch.mockImplementation(async()=>{
      if(mode==="network")throw new Error("SYNTHETIC_PRIVATE");
      if(mode==="hook_denial"||mode==="rate_limit")return response({code:"invalid_credentials",message:"SYNTHETIC_PRIVATE"},mode==="rate_limit"?429:403);
      return response(mode==="no_session"?{user}: {...session(),user:{}});
    });
    const result=await host.auth.signInForReview(user.email,reviewInput);expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|invalid_credentials|password/);expect(h.fetch).not.toHaveBeenCalled();
  });
  it("password rejection preserves an independent existing session",async()=>{
    const h=await fixture("valid"),host=await h.made();await host.start();const previous=h.rawRoot();h.fetch.mockResolvedValue(denied("invalid_credentials"));
    expect((await host.auth.signInForReview(user.email,reviewInput)).ok).toBe(false);
    expect(h.rawRoot()).toBe(previous);expect(await host.auth.restoreSession()).toMatchObject({kind:"authenticated"});
  });
  it("unavailable legacy review never reaches a credential write",async()=>{
    const h=await fixture(),host=await h.made();await host.start();const observed=vi.fn();host.auth.onAuthChange(observed);
    h.fetch.mockImplementation(async()=>{h.faults.hook=async(event,next)=>{if(event.kind==="write"&&h.item(event)===h.root)throw null;return next();};return response(session());});
    expect((await host.auth.signInForReview(user.email,reviewInput)).ok).toBe(false);expect(host.health().storageFailed).toBe(false);expect(observed).not.toHaveBeenCalled();expect(h.fetch).not.toHaveBeenCalled();
  });
  it("does not create an in-flight password command that could survive disposal",async()=>{
    const h=await fixture(),host=await h.made();await host.start();const observed=vi.fn();host.auth.onAuthChange(observed);
    const pending=host.auth.signInForReview(user.email,reviewInput),disposing=host.dispose();
    expect((await pending).ok).toBe(false);expect(await disposing).toEqual({ok:true});
    expect(observed).not.toHaveBeenCalled();expect(h.fetch).not.toHaveBeenCalled();
  });
  for(const rewrite of ["origin","grant","extra_query","route"] as const)it(`password transport refuses ${rewrite} without SEND`,async()=>{
    const h=await fixture(),RealRequest=globalThis.Request;
    vi.stubGlobal("Request",class extends RealRequest {constructor(input:RequestInfo|URL,init?:RequestInit){
      const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
      if(url.pathname.endsWith("/token")){
        if(rewrite==="origin")url.hostname="other.example.invalid";
        if(rewrite==="grant")url.searchParams.set("grant_type","client_credentials");
        if(rewrite==="extra_query")url.searchParams.set("other","1");
        if(rewrite==="route")url.pathname="/other/token";
      }super(url,init);
    }});
    const host=await h.made();await host.start();expect((await host.auth.signInForReview(user.email,reviewInput)).ok).toBe(false);expect(h.fetch).not.toHaveBeenCalled();
  });
});

it("does not permit a password grant from a different owned command",async()=>{
  const h=await fixture(),RealRequest=globalThis.Request;
  vi.stubGlobal("Request",class extends RealRequest{constructor(input:RequestInfo|URL,init?:RequestInit){
    const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
    if(url.pathname.endsWith("/otp")){url.pathname="/auth/v1/token";url.search="?grant_type=password";}super(url,init);
  }});
  const host=await h.made();await host.start();expect((await host.auth.requestEmailOtp(user.email)).ok).toBe(false);expect(h.fetch).not.toHaveBeenCalled();
});
