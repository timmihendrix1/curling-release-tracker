// Actual configured host + installed SDK + real disposable SQLite. Protected
// bridge/API/URL edges are synthetic: no physical Keychain or account evidence.
import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { fixture, onboard, server, deferred, response, accountTransport, profileId, deletionRow, deletionRequestId, facts } from "./nativeTrackerFixture";
import { setup, protectedArchive, basic, disposeTransferFixtures } from "../../persistence/__tests__/installationTransferTestFixture";
import type { NativeIdentityBootstrapHost, NativeConfiguredInstallationTransferIdentityHostOptions } from "../supabaseAuthService";
const hosts: NativeIdentityBootstrapHost[] = [];
const publishedColdCleanups: (() => Promise<void>)[] = [];
const publishedPairs: import("../../persistence/nativeCombinedRuntime").NativeCombinedRuntimePair[] = [];
const publishedOwners: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const pair of publishedPairs.splice(0)) await pair.dispose(); for (const cleanup of publishedColdCleanups.splice(0)) await cleanup(); for (const owner of publishedOwners.splice(0)) await owner.close(); for (const host of hosts.splice(0)) await host.dispose(); await disposeTransferFixtures(); });
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
type ProtectedRead = (key: string, next: () => Promise<unknown>) => unknown;
async function context(raws: Record<string, string> = basic(), protectedRead?: ProtectedRead) {
  const h = await fixture(), sql = await setup(), archive = await protectedArchive(raws);
  const configuration = await import("../nativeProviderConfiguration");
  const prepared = await configuration.prepareNativeProviderConfiguration(h.options.config);
  expect(prepared.ok).toBe(true); if (!prepared.ok) throw Error("Synthetic configured binding unavailable");
  const binding = prepared.value;
  const options: NativeConfiguredInstallationTransferIdentityHostOptions = {
    migration: { ...h.options.migration, sqlite: sql.options, ...(protectedRead ? { protectedBinding: { ...h.binding, read: (key: string) => protectedRead(key, () => h.binding.read(key)) } } : {}) }, fetch: h.fetch,
    callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl: () => {} },
    installationTransfer: { protectedWire: archive.protectedWire, recoveryCode: archive.recoveryCode },
  };
  async function make(overrides: Partial<NativeConfiguredInstallationTransferIdentityHostOptions> = {}) {
    const result = await h.module.createConfiguredInstallationTransferIdentityHost(binding, { ...options, ...overrides });
    if (result.ok) hosts.push(result.host); return result;
  }
  async function made(overrides: Partial<NativeConfiguredInstallationTransferIdentityHostOptions> = {}) {
    const result = await make(overrides); expect(result.ok).toBe(true); if (!result.ok) throw Error(result.reason); return result.host;
  }
  return { h, sql, archive, options, binding, make, made };
}
async function start(host: NativeIdentityBootstrapHost) {
  const result = await host.start(); expect(result.outcome).toBe("ready");
  if (result.outcome !== "ready") throw Error("Synthetic transfer identity host unavailable"); return result.runtime;
}
it("authenticates genuine configured binding before option reads and reserves before valid option reads", async () => {
  const f = await context(), trap = vi.fn(() => { throw Error("SYNTHETIC_OPTIONS"); });
  const input = new Proxy({}, { get: trap }) as NativeConfiguredInstallationTransferIdentityHostOptions;
  for (const fake of [{}, { ...f.binding }, Object.create(f.binding), new Proxy(f.binding, { get: trap, getPrototypeOf: trap })]) {
    expect(await f.h.module.createConfiguredInstallationTransferIdentityHost(fake, input)).toEqual({ ok: false, reason: "invalid_configuration" });
  }
  expect(trap).not.toHaveBeenCalled(); const host = await f.made();
  expect(await f.h.module.createConfiguredInstallationTransferIdentityHost(f.binding, input)).toEqual({ ok: false, reason: "ownership_conflict" });
  expect(trap).not.toHaveBeenCalled(); expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled();
  expect(await host.dispose()).toEqual({ ok: true });
});
it("performs actual OTP/legal/onboarding only in destination identity rows without legacy source access or sporting grants", async () => {
  const trusted = JSON.stringify({ schemaVersion: 1, accountScopeId: "SYNTHETIC_SOURCE_ACCOUNT", profileId: "10000000-0000-4000-8000-000000000001", displayName: "Synthetic Source", onboardingCompletedAt: "2026-01-01T00:00:00Z", entitlement: "free", generation: 1, establishedAt: "2026-01-01T00:00:00Z", lastServerConfirmationAt: "2026-01-01T00:00:00Z" });
  const f = await context({ ...basic(), "curling.identity.trustedDevice.v1": trusted });
  const oldSource = [...f.h.source.map]; let legacyAccess = 0;
  vi.stubGlobal("localStorage", new Proxy({}, { get() { legacyAccess++; throw Error("Legacy source access forbidden"); } }));
  const host = await f.made(), runtime = await start(host); expect(legacyAccess).toBe(0);
  expect(Object.keys(runtime).sort()).toEqual(["status", "coordinator", "startUpOnce", "subscribeToProgress", "subscribeToAuthChanges", "subscribeToBarrierChanges", "captureCurrentDeepLinkIntent", "loadPendingIntent"].sort());
  await onboard(f.h, runtime); expect(legacyAccess).toBe(0); expect([...f.h.source.map]).toEqual(oldSource);
  const objects = await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master ORDER BY name" }) as { values: { name: string }[] };
  expect(objects.values).toHaveLength(8); expect(objects.values.some(row => row.name === "records" || row.name.includes("credential_meta"))).toBe(false);
  const rows = await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_identity_v1 ORDER BY key" }) as { values: { key: string; value_ascii: string }[] };
  expect(rows.values.some(row => row.key === "curling.identity.trustedDevice.v1")).toBe(true);
  expect(rows.values.every(row => row.key.startsWith("curling.identity.") && row.value_ascii.startsWith("u16:"))).toBe(true);
  expect(JSON.stringify(rows)).not.toContain("SYNTHETIC_SOURCE_ACCOUNT");
  const tracker = await import("../../persistence/nativeTrackerRegistry"); expect(tracker.authenticateNativeTrackerRuntime(runtime)).toBe(false); expect(tracker.bindNativeTrackerRuntime(runtime, "22222222-2222-4222-8222-222222222222")).toBeNull();
  expect(await host.dispose()).toEqual({ ok: true });
});
it("rejects a wrong valid recovery code before native, SDK or network work", async () => {
  const f = await context(); const sdk = await import("@supabase/supabase-js"), initialized = vi.spyOn(sdk.AuthClient.prototype, "initialize");
  const host = await f.made({ installationTransfer: { ...f.options.installationTransfer, recoveryCode: "ct1-" + "A".repeat(43) } });
  expect(await host.start()).toEqual({ outcome: "waiting", code: "migration_blocked" });
  expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled(); expect(initialized).not.toHaveBeenCalled();
  expect(await host.dispose()).toEqual({ ok: true });
});
it("ignores duplicate config/fingerprint and team-link fields while capturing transfer fields before later getters", async () => {
  const f = await context(), ignored = vi.fn(() => { throw Error("Ignored field"); }), migration = { ...f.options.migration };
  for (const name of ["providerConfigIdentity", "sessionStorageKey", "domainFingerprint", "domainFingerprintFormat", "credentialFingerprint", "credentialFingerprintFormat"]) Object.defineProperty(migration, name, { get: ignored });
  const options = { ...f.options, migration }; for (const name of ["config", "teamLinkDelivery"]) Object.defineProperty(options, name, { get: ignored });
  const made = await f.h.module.createConfiguredInstallationTransferIdentityHost(f.binding, options); expect(made.ok).toBe(true); if (!made.ok) throw null; hosts.push(made.host);
  await start(made.host); expect(ignored).not.toHaveBeenCalled(); await made.host.dispose();
  vi.resetModules(); const next = await context(), later = vi.fn();
  const malformed = { protectedWire: 1, get recoveryCode() { later(); return next.archive.recoveryCode; } };
  expect(await next.make({ installationTransfer: malformed as never })).toEqual({ ok: false, reason: "invalid_dependency" }); expect(later).not.toHaveBeenCalled();
});
for (const method of ["configure", "inventory", "read", "write"] as const) for (const completion of ["start", "dispose"] as const) it(`excludes actual host.${completion} completion at protected ${method} before SDK construction`, async () => {
  const f = await context(), entered = deferred<void>();
  const binding = { ...f.h.binding, [method]() { entered.resolve(); return completion === "dispose" ? host.dispose() : starting; } };
  const host = await f.made({ migration: { ...f.options.migration, protectedBinding: binding } }); const starting = host.start();
  await entered.promise; const result = await Promise.race([starting, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(result).not.toBeNull(); expect(result).not.toMatchObject({ outcome: "ready" }); expect(f.h.fetch).not.toHaveBeenCalled(); await host.dispose();
});
for (const method of ["configure", "read", "write", "inventory"] as const) it(`joins malformed ${method} acquisition even when its descriptor lookup closes the actual host`, async () => {
  const f = await context(), hold = deferred<void>(), at = deferred<void>(); let closing: ReturnType<NativeIdentityBootstrapHost["dispose"]> | null = null, later = 0, acquired = false;
  const binding = new Proxy(f.h.binding, { getOwnPropertyDescriptor(target, name) {
    if (name === method) { acquired = true; closing = host.dispose(); at.resolve(); return { configurable: true, value: hold.promise }; }
    if (acquired) later++; return Reflect.getOwnPropertyDescriptor(target, name);
  } });
  const host = await f.made({ migration: { ...f.options.migration, protectedBinding: binding } }); let started = false, closed = false;
  const starting = host.start().then(result => { started = true; return result; }); await at.promise; void closing!.then(() => { closed = true; }); await pause();
  try { expect(started).toBe(false); expect(closed).toBe(false); expect(later).toBe(0); }
  finally { hold.resolve(); await starting; await closing; }
});
for (const method of ["close", "closeConnection"] as const) it(`retries actual store-only ${method} cleanup while holding SDK and both logical stores`, async () => {
  const f = await context(), sdk = await import("@supabase/supabase-js"), sdkClose = vi.spyOn(sdk.AuthClient.prototype, "dispose");
  const host = await f.made(); await start(host); expect(sdkClose).toHaveBeenCalledTimes(1);
  const connection = await f.sql.options.engine.createConnection(""); const receiver = method === "close" ? connection : f.sql.options.engine;
  const original = Reflect.get(receiver, method); Reflect.set(receiver, method, () => Promise.reject(Error("Synthetic physical cleanup failure")));
  expect(await host.dispose()).toEqual({ ok: false, reason: "cleanup_unconfirmed" }); expect(sdkClose).toHaveBeenCalledTimes(2);
  const namespace = await import("../../persistence/nativeCredentialNamespace"); expect(namespace.ordinaryCredentialNamespaceAvailable()).toBe(false);
  const adapter = await import("../../persistence/nativeSqliteAdapter"), contender = adapter.createNativeCombinedHeldSqliteHost(f.sql.options);
  expect((await contender.acquire()).ok).toBe(false);
  expect((await f.make()).ok).toBe(false); expect(await host.start()).toEqual({ outcome: "closed" });
  Reflect.set(receiver, method, original); expect(await host.dispose()).toEqual({ ok: true }); expect(sdkClose).toHaveBeenCalledTimes(2);
  expect(namespace.ordinaryCredentialNamespaceAvailable()).toBe(true); expect((await f.make()).ok).toBe(true);
});
it("does not mistake successful constructor cleanup for successful terminal SDK disposal", async () => {
  const f = await context(), sdk = await import("@supabase/supabase-js"), original = sdk.AuthClient.prototype.dispose; let calls = 0;
  vi.spyOn(sdk.AuthClient.prototype, "dispose").mockImplementation(function(this: InstanceType<typeof sdk.AuthClient>) { calls++; return calls === 1 ? Reflect.apply(original, this, []) : Promise.reject(Error("Synthetic terminal SDK disposal failed")); });
  const host = await f.made(); await start(host); expect(calls).toBe(1);
  expect(await host.dispose()).toEqual({ ok: false, reason: "cleanup_unconfirmed" }); expect(calls).toBe(2);
  expect(await host.dispose()).toEqual({ ok: false, reason: "cleanup_unconfirmed" }); expect(calls).toBe(2); expect((await f.make()).ok).toBe(false);
});
it("uses a sanitized captured callback receiver without transfer input or private config", async () => {
  const f = await context(), receivers: unknown[] = [], fetch = f.h.fetch;
  const transport: typeof globalThis.fetch = function(this: unknown, ...args) { receivers.push(this); return fetch(...args); };
  const origin = function(this: unknown) { receivers.push(this); return "https://app.example.invalid"; };
  server(f.h); const host = await f.made({ fetch: transport, resolveAppOrigin: origin, navigate() {} }); const runtime = await start(host);
  await runtime.startUpOnce(); await runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  expect(receivers.length).toBeGreaterThan(0);
  for (const receiver of receivers) { expect(Object.keys(receiver as object).sort()).toEqual(["fetch", "resolveAppOrigin", "navigate"].sort()); expect(Object.isFrozen(receiver)).toBe(true); expect(receiver).not.toBe(f.options); }
  await host.dispose();
});
for (const method of ["query", "close", "closeConnection"] as const) for (const completion of ["start", "dispose"] as const) it(`excludes actual host.${completion} from actual SQL ${method} during preparation`, async () => {
  const f = await context(), connection = await f.sql.options.engine.createConnection(""), entered = deferred<void>();
  const receiver = method === "closeConnection" ? f.sql.options.engine : connection;
  const original = Reflect.get(receiver, method);
  Reflect.set(receiver, method, () => { entered.resolve(); return completion === "dispose" ? host.dispose() : starting; });
  const host = await f.made(), starting = host.start(); await entered.promise;
  const result = await Promise.race([starting, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  try { expect(result).not.toBeNull(); expect(result).not.toMatchObject({ outcome: "ready" }); expect(f.h.fetch).not.toHaveBeenCalled(); }
  finally { Reflect.set(receiver, method, original); await host.dispose(); }
});
for (const completion of ["start", "dispose"] as const) it(`excludes actual host.${completion} during actual SDK initialization protected reads`, async () => {
  const f = await context(), sdk = await import("@supabase/supabase-js"), initialize = sdk.AuthClient.prototype.initialize;
  let armed = false; vi.spyOn(sdk.AuthClient.prototype, "initialize").mockImplementation(function(this: InstanceType<typeof sdk.AuthClient>) { armed = true; return Reflect.apply(initialize, this, []); });
  const binding = { ...f.h.binding, read(key: string) { if (armed) return completion === "dispose" ? host.dispose() : starting; return f.h.binding.read(key); } };
  const host = await f.made({ migration: { ...f.options.migration, protectedBinding: binding } }), starting = host.start();
  const result = await Promise.race([starting, new Promise(resolve => setTimeout(() => resolve(null), 1500))]);
  expect(armed).toBe(true); expect(result).not.toBeNull(); expect(result).not.toMatchObject({ outcome: "ready" }); await host.dispose();
});
for (const lane of ["protected", "sql"] as const) for (const completion of ["runtime", "dispose"] as const) it(`excludes actual ${completion} completion from ${lane} identity startup work`, async () => {
  const f = await context(); let armed = false, pending: Promise<unknown> | null = null;
  const binding = { ...f.h.binding, read(key: string) { if (armed && lane === "protected") return completion === "dispose" ? host.dispose() : pending; return f.h.binding.read(key); } };
  const host = await f.made({ migration: { ...f.options.migration, protectedBinding: binding } }), runtime = await start(host);
  const connection = await f.sql.options.engine.createConnection(""), original = connection.query;
  if (lane === "sql") connection.query = ((sql: string, values?: unknown[]) => armed ? completion === "dispose" ? host.dispose() : pending : Reflect.apply(original, connection, [sql, values])) as never;
  armed = true; pending = runtime.startUpOnce();
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  try { expect(result).not.toBeNull(); expect(result).not.toMatchObject({ verdict: { kind: "ready_online" } }); }
  finally { connection.query = original; await host.dispose(); }
});
for (const field of ["remove", "failedWriteMayLosePreviousValue"] as const) it(`joins actual host cleanup around malformed runtime ${field} acquisition`, async () => {
  const f = await context(), hold = deferred<void>(), acquired = deferred<void>(); let closing: Promise<unknown> | null = null;
  const binding = new Proxy(f.h.binding, { getOwnPropertyDescriptor(target, name) {
    if (name === field) { closing = host.dispose(); acquired.resolve(); return { configurable: true, value: hold.promise }; }
    return Reflect.getOwnPropertyDescriptor(target, name);
  } });
  const host = await f.made({ migration: { ...f.options.migration, protectedBinding: binding } }); let started = false, closed = false;
  const starting = host.start().then(result => { started = true; return result; }); await acquired.promise; void closing!.then(() => { closed = true; }); await pause();
  try { expect(started).toBe(false); expect(closed).toBe(false); }
  finally { hold.resolve(); await starting; await closing; }
});
it("cancels immediately started preparation and positively releases an actually unconstructed owner", async () => {
  const f = await context(), host = await f.made(); const starting = host.start(), closing = host.dispose();
  expect(await starting).toEqual({ outcome: "closed" }); expect(await closing).toEqual({ ok: true });
  expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled(); expect((await f.make()).ok).toBe(true);
});
it("refuses changed actual provider binding against the persisted transfer pair without rebinding protected data", async () => {
  const f = await context(), host = await f.made(); await start(host); await host.dispose(); const before = [...f.h.values];
  const configuration = await import("../nativeProviderConfiguration"), changed = await configuration.prepareNativeProviderConfiguration({ ...f.h.options.config, url: "https://different-synthetic.supabase.invalid" });
  expect(changed.ok).toBe(true); if (!changed.ok) throw null;
  const result = await f.h.module.createConfiguredInstallationTransferIdentityHost(changed.value, f.options); expect(result.ok).toBe(true); if (!result.ok) throw null; hosts.push(result.host);
  f.h.fetch.mockClear(); expect(await result.host.start()).toEqual({ outcome: "waiting", code: "migration_blocked" });
  expect([...f.h.values]).toEqual(before); expect(f.h.fetch).not.toHaveBeenCalled(); await result.host.dispose();
});
async function cold(f: Awaited<ReturnType<typeof context>>, captureOwner?: (owner: ReturnType<typeof import("../../persistence/installationTransferPairing").createInstallationTransferHostOwner>) => void) {
  vi.resetModules();
  if (captureOwner) {
    const pairing = await import("../../persistence/installationTransferPairing"), create = pairing.createInstallationTransferHostOwner;
    vi.spyOn(pairing, "createInstallationTransferHostOwner").mockImplementation((...args) => { const owner = create(...args); captureOwner(owner); return owner; });
  } f.h.module = await import("../supabaseAuthService");
  const configuration = await import("../nativeProviderConfiguration"), binding = await configuration.prepareNativeProviderConfiguration(f.h.options.config);
  expect(binding.ok).toBe(true); if (!binding.ok) throw null;
  const made = await f.h.module.createConfiguredInstallationTransferIdentityHost(binding.value, f.options);
  expect(made.ok).toBe(true); if (!made.ok) throw null; hosts.push(made.host); return made.host;
}
it("reopens actual destination identity and SDK credentials in a new lifetime without registering sporting access", async () => {
  const f = await context(), first = await f.made(), runtime = await start(first); await onboard(f.h, runtime); await first.dispose();
  const host = await cold(f); server(f.h, true); const reopened = await start(host);
  expect((await reopened.startUpOnce()).verdict.kind).toBe("ready_online");
  const registry = await import("../../persistence/nativeTrackerRegistry"); expect(registry.authenticateNativeTrackerRuntime(reopened)).toBe(false);
  expect(Object.hasOwn(reopened, "createLocalSportingScope")).toBe(false); expect(await host.dispose()).toEqual({ ok: true });
});
for (const negative of ["expired_provider_denial", "account_swap"] as const) it(`preserves actual ${negative} during cold destination Self preflight`, async () => {
  const f = await context(), first = await f.made(), runtime = await start(first); server(f.h);
  expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
  await runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "onboarding_required" } });
  await first.dispose();
  const host = await cold(f), reopened = await start(host), now = Date.now, paths: string[] = [];
  const session = [...f.h.values.values()].map(raw => JSON.parse(raw)).find(item => item.key === f.h.root);
  expect(session).toBeDefined(); const previous = JSON.parse(session.value);
  reopened.subscribeToProgress(phase => { if (phase === "ensuring_profile") vi.spyOn(Date, "now").mockImplementation(() => now() + 7200_000); });
  f.h.fetch.mockImplementation(async input => {
    const path = new URL((input as Request).url).pathname; paths.push(path);
    if (!path.endsWith("/token")) throw Error("Unexpected Self request");
    return negative === "account_swap" ? response({ ...previous, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { ...previous.user, id: "77777777-7777-4777-8777-777777777777" } })
      : response({ code: "refresh_token_not_found", message: "Synthetic invalid refresh token" }, 400);
  });
  const result = await reopened.startUpOnce(); expect(result.verdict).toMatchObject({ kind: "locked", origin: "server_identity_invalidated" });
  expect(paths).toEqual(["/auth/v1/token"]); expect(host.health().storageFailed).toBe(false); await host.dispose();
});
it("keeps expired OTP refusal closed in the actual SDK/coordinator", async () => {
  const f = await context(), host = await f.made(), runtime = await start(host); server(f.h);
  expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
  expect((await runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).kind).toBe("otp_requested");
  f.h.fetch.mockResolvedValue(response({ code: "otp_expired", message: "Synthetic expired OTP" }, 403));
  expect((await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).kind).not.toBe("resolved");
  expect(await host.dispose()).toEqual({ ok: true });
});
for (const completion of ["runtime", "dispose"] as const) it(`refuses actual ${completion} work returned by the captured transport without cycling`, async () => {
  const f = await context(), host = await f.made(), runtime = await start(host); server(f.h); await runtime.startUpOnce();
  f.h.fetch.mockImplementation(() => (completion === "dispose" ? host.dispose() : pending) as never);
  const pending = runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(result).not.toBeNull(); expect(result).not.toMatchObject({ kind: "otp_requested" }); await host.dispose();
});
it("keeps actual source faults held without store retry or SDK reservation release", async () => {
  const f = await context(), sdk = await import("@supabase/supabase-js"), sdkClose = vi.spyOn(sdk.AuthClient.prototype, "dispose");
  const host = await f.made(), runtime = await start(host);
  f.h.faults.hook = async (event, next) => event.kind === "read" && event.key?.startsWith("m1.") ? { kind: "value", value: "foreign manifest" } : next();
  expect((await runtime.startUpOnce()).verdict.kind).not.toMatch(/^ready_/); expect(host.health().storageFailed).toBe(true);
  expect(await host.dispose()).toEqual({ ok: false, reason: "evidence_held" }); expect(sdkClose).toHaveBeenCalledTimes(2);
  expect(await host.dispose()).toEqual({ ok: false, reason: "evidence_held" }); expect(sdkClose).toHaveBeenCalledTimes(2);
  expect((await f.make()).ok).toBe(false); const namespace = await import("../../persistence/nativeCredentialNamespace"); expect(namespace.ordinaryCredentialNamespaceAvailable()).toBe(false);
});

// Independent actual-host witnesses, copied with assertions unchanged.
it("refuses an actual owned submit completion returned by onboarding displayName without cycling", async()=>{
 const f=await context(),host=await f.made(),runtime=await start(host);server(f.h);
 await runtime.startUpOnce();await runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
 const gate=await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid","123456");expect(gate).toMatchObject({kind:"resolved",gate:{kind:"onboarding_required"}});
 let pending:Promise<unknown>|null=null,acquired=false;
 const input={get displayName(){acquired=true;return pending;}};
 pending=runtime.coordinator.submitOnboarding(input as never);
 const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(null),750))]);
 if(result===null){
   const closing=host.dispose();
   const closed=await Promise.race([closing,new Promise(resolve=>setTimeout(()=>resolve(null),100))]);
   expect(closed).toBeNull();hosts.splice(hosts.indexOf(host),1);
 }
 expect(acquired).toBe(true);expect(result).not.toBeNull();
 if(result!==null)await host.dispose();
});
it("joins malformed acquired read value before genuine close without invoking unrelated getters", async()=>{
 const f=await context(),held=deferred<void>(),at=deferred<void>();let later=0;
 const raw={kind:"value",value:held.promise,get unrelated(){later++;return undefined;}};
 const binding={...f.h.binding,read(){at.resolve();return raw;}};
 const host=await f.made({migration:{...f.options.migration,protectedBinding:binding}});let done=false,closed=false;
 const pending=host.start().then(x=>{done=true;return x;});await at.promise;const closing=host.dispose().then(x=>{closed=true;return x;});await pause();
 try{expect(done).toBe(false);expect(closed).toBe(false);expect(later).toBe(0);}finally{held.resolve();await pending;await closing;}
});
it("drains masked native recovery code before releasing SDK reservation",async()=>{
 const f=await context(),held=deferred<void>();Object.defineProperty(held.promise,"then",{value:null});let done=false;
 const pending=f.make({installationTransfer:{protectedWire:f.archive.protectedWire,recoveryCode:held.promise as never}}).then(x=>{done=true;return x;});await pause();
 try{expect(done).toBe(false);expect(f.sql.trace).toEqual([]);expect((await f.make()).ok).toBe(false);}finally{held.resolve();expect(await pending).toEqual({ok:false,reason:"invalid_dependency"});}
 expect((await f.make()).ok).toBe(true);
});
it("still joins unrelated malformed onboarding argument work before command and terminal cleanup complete", async () => {
  const f = await context(), host = await f.made(), runtime = await start(host), hold = deferred<void>(), at = deferred<void>(); server(f.h);
  await runtime.startUpOnce(); await runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "onboarding_required" } });
  let submitted = false, closed = false;
  const pending = runtime.coordinator.submitOnboarding({ get displayName() { at.resolve(); return hold.promise; } } as never).then(result => { submitted = true; return result; });
  await at.promise; const closing = host.dispose().then(result => { closed = true; return result; }); await pause();
  try { expect(submitted).toBe(false); expect(closed).toBe(false); expect((await f.make()).ok).toBe(false); }
  finally { hold.resolve(); expect(await pending).not.toMatchObject({ kind: "completed" }); expect(await closing).toEqual({ ok: true }); }
});
// Source-aware opening uses the same actual host completion owner as the stores.
for (const edge of ["create", "journal", "synchronous", "begin", "statement", "commit"] as const) for (const completion of ["start", "dispose"] as const) it(`source-aware actual ${edge} refuses genuine host.${completion} without a cycle`, async () => {
  const f = await context(), at = deferred<void>();
  const connection = await f.sql.options.engine.createConnection("");
  const blocked = (): Promise<unknown> => { at.resolve(); return completion === "start" ? starting : host.dispose(); };
  const originalCreate = f.sql.options.engine.createConnection;
  if (edge === "create") f.sql.options.engine.createConnection = blocked as never;
  const originalQuery = connection.query, originalExecute = connection.execute;
  const originalBegin = connection.beginTransaction, originalCommit = connection.commitTransaction, originalRun = connection.run;
  if (edge === "journal") connection.query = ((sql: string, values: unknown[]) => sql === "PRAGMA journal_mode = WAL;" ? blocked() : Reflect.apply(originalQuery, connection, [sql, values])) as never;
  if (edge === "synchronous" || edge === "statement") connection.execute = ((sql: string, transaction: boolean) => (edge === "synchronous" ? sql === "PRAGMA synchronous = FULL;" : sql.startsWith("CREATE TABLE installation_transfer_quarantine")) ? blocked() : Reflect.apply(originalExecute, connection, [sql, transaction])) as never;
  if (edge === "begin") connection.beginTransaction = blocked as never;
  if (edge === "commit") connection.commitTransaction = blocked as never;
  const host = await f.made(); const starting = host.start(); await at.promise;
  const result = await Promise.race([starting, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  try { expect(result).not.toBeNull(); expect(result).not.toMatchObject({ outcome: "ready" }); expect(f.h.fetch).not.toHaveBeenCalled(); }
  finally {
    f.sql.options.engine.createConnection = originalCreate;
    connection.query = originalQuery; connection.execute = originalExecute; connection.beginTransaction = originalBegin; connection.commitTransaction = originalCommit; connection.run = originalRun;
    await host.dispose();
  }
});
it("actual OTP/onboarding leaves the immutable original guard unchanged and does not adopt it as live identity", async () => {
  const profileId = "20000000-0000-4000-8000-000000000002", nonce = "30000000-0000-4000-8000-000000000003";
  const key = `curling.identity.accountDeletionGuard.${profileId}.v1`;
  const f = await context({ ...basic(), [key]: JSON.stringify({ schemaVersion: 1, profileId, nonce, revision: 9 }) });
  const host = await f.made(), runtime = await start(host);
  const read = async () => (await f.sql.raw({ kind: "query", sql: "SELECT projection_ascii,projection_digest FROM installation_transfer_source_denial_v1" }) as { values: unknown[] }).values;
  const before = await read(); await onboard(f.h, runtime); expect(await read()).toEqual(before);
  const live = await f.sql.raw({ kind: "query", sql: "SELECT key FROM installation_transfer_identity_v1" }) as { values: { key: string }[] };
  expect(live.values.some(row => row.key === key)).toBe(false);
  const registry = await import("../../persistence/nativeTrackerRegistry"); expect(registry.authenticateNativeTrackerRuntime(runtime)).toBe(false);
  expect(await host.dispose()).toEqual({ ok: true });
  const reopened = await cold(f); await start(reopened); expect(await read()).toEqual(before); expect(await reopened.dispose()).toEqual({ ok: true });
});
it("joins a malformed creation method acquired by the lookup that closes the actual host", async () => {
  const f = await context(), hold = deferred<void>(), at = deferred<void>(); let closed: Promise<unknown> | null = null;
  const engine = new Proxy(f.sql.options.engine, { getOwnPropertyDescriptor(target, name) {
    if (name === "createConnection") { closed = host.dispose(); at.resolve(); return { configurable: true, value: hold.promise }; }
    return Reflect.getOwnPropertyDescriptor(target, name);
  } });
  const host = await f.made({ migration: { ...f.options.migration, sqlite: { ...f.sql.options, engine } } });
  let done = false; const op = host.start().then(value => { done = true; return value; }); await at.promise; let ended = false; void closed!.then(() => { ended = true; }); await pause();
  try { expect(done).toBe(false); expect(ended).toBe(false); expect(f.sql.trace).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled(); }
  finally { hold.resolve(); await op; await closed; }
});
for (const pragma of ["journal", "synchronous"] as const) it(`joins actual malformed ${pragma} metadata before opening cleanup`, async () => {
  const f = await context(), hold = deferred<void>(), at = deferred<void>();
  f.sql.faults.hook = async (event, next) => {
    const value = await next();
    if (pragma === "journal" && event.sql === "PRAGMA journal_mode = WAL;") { at.resolve(); return { values: [{ journal_mode: hold.promise }] }; }
    if (pragma === "synchronous" && event.sql === "PRAGMA synchronous = FULL;") { at.resolve(); return { changes: { changes: hold.promise } }; }
    return value;
  };
  const host = await f.made(); let done = false; const op = host.start().then(value => { done = true; return value; }); await at.promise;
  const n = f.sql.trace.length, closing = host.dispose(); let ended = false; void closing.then(() => { ended = true; }); await pause();
  try { expect(done).toBe(false); expect(ended).toBe(false); expect(f.sql.trace).toHaveLength(n); expect(f.h.fetch).not.toHaveBeenCalled(); }
  finally { hold.resolve(); await op; await closing; }
});
// Independent S6l1b opening witnesses and adjacent strict positive controls.
it("refuses an accessor open without invoking it or issuing native work", async () => {
  const f = await context(), c = await f.sql.options.engine.createConnection(""), open = c.open;
  let looked = false;
  Object.defineProperty(c, "open", { configurable: true, get() { looked = true; return open; } });
  const host = await f.made();
  try { expect(await host.start()).not.toMatchObject({ outcome: "ready" }); expect(looked).toBe(false); expect(f.sql.trace.some(e => e.kind === "open")).toBe(false); }
  finally { Object.defineProperty(c, "open", { configurable: true, writable: true, value: open }); await host.dispose(); }
});
it("does not issue native open after its descriptor lookup closes the actual host", async () => {
  const f = await context(), c = await f.sql.options.engine.createConnection(""); let closing: Promise<unknown> | null = null;
  const connection = new Proxy(c, { getOwnPropertyDescriptor(target, name) { const d = Reflect.getOwnPropertyDescriptor(target, name); if (name === "open") closing = host.dispose(); return d; } });
  f.sql.options.engine.createConnection = async () => connection;
  const host = await f.made(); expect(await host.start()).toEqual({ outcome: "closed" }); if (closing) await closing;
  expect(f.sql.trace.some(e => e.kind === "open")).toBe(false);
});
it("keeps connection boxes through core open and joins a later acquired malformed then", async () => {
  const f = await context(), c = await f.sql.options.engine.createConnection(""), ready = Promise.resolve(c), held = deferred<void>(), at = deferred<void>(); let reads = 0, done = false, closed = false;
  // The first controlled observer read is benign. Any later acquired residue
  // must still be joined; safe boxing is also allowed to avoid that read entirely.
  Object.defineProperty(c, "then", { configurable: true, get() { if (++reads === 2) { at.resolve(); return held.promise; } return undefined; } });
  f.sql.options.engine.createConnection = (() => ready) as never;
  const host = await f.made(), starting = host.start().then(x => { done = true; return x; });
  const outcome = await Promise.race([at.promise.then(() => "acquired"), starting.then(() => "finished")]);
  if (outcome === "acquired") {
    const closing = host.dispose().then(x => { closed = true; return x; }); await pause();
    try { expect(done).toBe(false); expect(closed).toBe(false); } finally { held.resolve(); await starting; await closing; }
  } else { expect(await starting).toMatchObject({ outcome: "ready" }); expect(reads).toBe(1); expect(await host.dispose()).toEqual({ ok: true }); }
});
it("joins malformed captured engine then work before configuration resolution can discard it", async () => {
  const f = await context(), held = deferred<void>(), at = deferred<void>(); let reads = 0, done = false, closed = false;
  Object.defineProperty(f.sql.options.engine, "then", { configurable: true, get() { if (++reads === 1) { at.resolve(); return held.promise; } return undefined; } });
  const host = await f.made(), starting = host.start().then(x => { done = true; return x; }); await at.promise;
  const closing = host.dispose().then(x => { closed = true; return x; }); await pause();
  try { expect(done).toBe(false); expect(closed).toBe(false); expect(f.sql.trace.some(e => e.kind === "open")).toBe(false); }
  finally { held.resolve(); await starting; await closing; }
});
it("actual host construction already refuses and drains a masked native Promise engine", async () => {
  const f = await context(), hold = deferred<void>(), at = deferred<void>();
  const engine = new Promise(resolve => { void hold.promise.then(() => resolve(f.sql.options.engine)); });
  Object.defineProperty(engine, "constructor", { value: { get [Symbol.species]() { at.resolve(); return Promise; } } });
  Object.defineProperty(engine, "then", { value: null }); Object.assign(engine, f.sql.options.engine);
  let done = false;
  const making = f.make({ migration: { ...f.options.migration, sqlite: { ...f.sql.options, engine: engine as never } } }).then(value => { done = true; return value; });
  await at.promise; await pause();
  try { expect(done).toBe(false); expect(f.sql.trace).toEqual([]); }
  finally { hold.resolve(); expect(await making).toEqual({ ok: false, reason: "invalid_dependency" }); }
  expect(f.sql.trace.some(e => e.kind === "open")).toBe(false);
});
it("pins genuine eligible OTP in the actual installed-SDK/source SQL lifetime, never exposes it publicly", async () => {
  const f = await context(), implementation = await import("../../persistence/installationTransferQuarantineSql"), factory = vi.spyOn(implementation, "createInstallationTransferSourceIdentitySql");
  const coordinator = await import("../../identity/identityTransitionCoordinator"), observed = vi.spyOn(coordinator, "readNativeFreshEmailOtp");
  server(f.h, true); const host = await f.made(), runtime = await start(host);
  expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
  await runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  const sourceContext = factory.mock.results[0].value as import("../../persistence/installationTransferQuarantineSql").NativeTransferSourceIdentityContext;
  const event = observed.mock.calls.find((_call, index) => observed.mock.results[index].value !== null)![0];
  const before = f.sql.trace.length, stamp = sourceContext.pinFreshEmailOtp(event); expect(stamp).not.toBeNull(); expect(sourceContext.freshEmailOtpCurrent(stamp)).toBe(true); expect(f.sql.trace).toHaveLength(before);
  expect(Object.hasOwn(runtime, "pinFreshEmailOtp")).toBe(false); expect(Object.hasOwn(host, "freshEmailOtpCurrent")).toBe(false);
  const background = runtime.coordinator.revalidateGateFacts(); expect(sourceContext.freshEmailOtpCurrent(stamp)).toBe(false); await background;
});
it("carries actual OTP through onboarding and rechecks returning trusted OTP online, without generic readiness relabelling", async () => {
  const f = await context(), coordinator = await import("../../identity/identityTransitionCoordinator"), observed = vi.spyOn(coordinator, "readNativeFreshEmailOtp");
  const host = await f.made(), runtime = await start(host); await onboard(f.h, runtime);
  const events = () => [...new Set(observed.mock.calls.filter((_call, index) => observed.mock.results[index].value !== null).map(call => call[0]))];
  expect(events()).toHaveLength(1); const original = events()[0]; expect(coordinator.readNativeFreshEmailOtp(original)!.current()).toBe(true);
  const before = f.h.fetch.mock.calls.length;
  await runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  expect(events()).toHaveLength(2); expect(coordinator.readNativeFreshEmailOtp(original)!.current()).toBe(false);
  expect(f.h.fetch.mock.calls.slice(before).some(([input]) => new URL((input as Request).url).pathname.endsWith("/ensure_my_profile"))).toBe(true);
  expect(f.h.fetch.mock.calls.slice(before).some(([input]) => new URL((input as Request).url).pathname.endsWith("/get_my_gate_state"))).toBe(true);
});
for (const stage of ["source", "event"] as const) for (const completion of (stage === "source" ? ["start", "dispose"] as const : ["start", "command", "dispose"] as const)) it(`contains malformed ${stage} observer returning own host ${completion} completion without cycles`, async () => {
  const f = await context(), pairing = await import("../../persistence/installationTransferPairing"), original = pairing.createInstallationTransferHostOwner;
  let command: Promise<unknown> | null = null, starting: Promise<unknown> | null = null;
  const coordinator = await import("../../identity/identityTransitionCoordinator"), captured: object[] = [];
  vi.spyOn(pairing, "createInstallationTransferHostOwner").mockImplementation((...args) => {
    const owner = original(...args);
    const malformed = () => completion === "dispose" ? host.dispose() : completion === "start" ? starting : command;
    return Object.freeze({ ...owner,
      ownFreshEmailOtpSource(source: object) { owner.ownFreshEmailOtpSource(source); if (stage === "source") return malformed() as never; },
      ownFreshEmailOtp(event: object) { captured.push(event); owner.ownFreshEmailOtp(event); if (stage === "event") return malformed() as never; },
    });
  });
  server(f.h, true); const host = await f.made(); starting = host.start();
  const started = await Promise.race([starting, new Promise(resolve => setTimeout(() => resolve(null), 1500))]); expect(started).not.toBeNull();
  if (stage === "event") {
    const runtime = await start(host); await runtime.startUpOnce(); await runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
    command = runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456");
    const result = await Promise.race([command, new Promise(resolve => setTimeout(() => resolve(null), 1500))]); expect(result).not.toBeNull(); expect(captured).toHaveLength(1);
    expect(coordinator.readNativeFreshEmailOtp(captured[0])!.current()).toBe(false);
  }
  expect(await host.dispose()).toEqual({ ok: true });
});
async function proofHost(eventWork?: () => unknown, raws?: Record<string, string>, controlWork?: () => unknown, protectedRead?: ProtectedRead) {
  const f = await context(raws, protectedRead), implementation = await import("../../persistence/installationTransferQuarantineSql"), sqlFactory = vi.spyOn(implementation, "createInstallationTransferSourceIdentitySql");
  const portModule = await import("../../persistence/nativeCredentialMigrationPort"), prepareCredentials = portModule.prepareTransferIdentityCredentialRuntime;
  let credentialArgs!: Parameters<typeof prepareCredentials>;
  vi.spyOn(portModule, "prepareTransferIdentityCredentialRuntime").mockImplementation((...args) => { credentialArgs = args; return prepareCredentials(...args); });
  const helper = await import("../../persistence/installationTransferAccountControl"), controlObservations = vi.spyOn(helper, "createTransferAccountControlObservation");
  const coordinator = await import("../../identity/identityTransitionCoordinator"), observations = vi.spyOn(coordinator, "readNativeFreshEmailOtp");
  const pairing = await import("../../persistence/installationTransferPairing"), create = pairing.createInstallationTransferHostOwner;
  let transferOwner: ReturnType<typeof create> | null = null;
  let pair: import("../../persistence/nativeCombinedRuntime").NativeCombinedRuntimePair | null = null;
  vi.spyOn(pairing, "createInstallationTransferHostOwner").mockImplementation((...args) => {
    const owner = create(...args);
    transferOwner = owner;
    return Object.freeze({ ...owner, ownFreshEmailOtp(event: object) { owner.ownFreshEmailOtp(event); return eventWork?.() as void; }, ownServerControl(observation: object) { owner.ownServerControl(observation); return controlWork?.() as void; }, handoff() { const actual = owner.handoff(); void actual.then(value => { pair = value; }); return actual; } });
  });
  server(f.h); const transport = f.h.fetch.getMockImplementation()!; let legal: "terms" | "privacy" | "network" | null = null;
  f.h.fetch.mockImplementation(async (...args) => {
    const answer = await transport(...args);
    if (!legal || !new URL((args[0] as Request).url).pathname.endsWith("/get_current_legal_documents")) return answer;
    if (legal === "network") return response({ message: "Synthetic unavailable" }, 503);
    const rows = await answer.json() as { kind: string }[];
    return response(rows.filter(row => row.kind !== (legal === "terms" ? "terms_of_service" : "privacy_notice")));
  });
  const host = await f.made(), runtime = await start(host);
  const sourceContext = sqlFactory.mock.results[0].value as import("../../persistence/installationTransferQuarantineSql").NativeTransferSourceIdentityContext;
  const events = () => [...new Set(observations.mock.calls.filter((_call, index) => observations.mock.results[index].value !== null).map(call => call[0]))];
  const input = async () => { const snapshot = await runtime.coordinator.refreshLegalSnapshot(); expect(snapshot.kind).toBe("refreshed"); if (snapshot.kind !== "refreshed" || !snapshot.legal.terms || !snapshot.legal.privacy) throw null; return { displayName: "Synthetic Athlete", terms: snapshot.legal.terms, privacy: snapshot.legal.privacy }; };
  return { ...f, host, runtime, context: sourceContext, events, input, pair: pair!, transferOwner: transferOwner!, credentialArgs: () => credentialArgs, portModule, controls: () => controlObservations.mock.results.filter(result => result.value !== null).map(result => result.value as object), setLegal(value: typeof legal) { legal = value; }, coordinator };
}
const sourceNonce = "30000000-0000-4000-8000-000000000003", destinationNonce = "40000000-0000-4000-8000-000000000004";
it("actual host preserves source cleanup debt privately without replaying it into destination identity", async () => {
  const key = "curling.identity.intentCleanup.v1", recordedAt = "2026-10-26T12:00:00.000Z";
  const f = await proofHost(undefined, { [key]: JSON.stringify({ schemaVersion: 1, recordedAt }) });
  const rows = await f.sql.raw({ kind: "query", sql: "SELECT projection_ascii FROM installation_transfer_source_denial_v1" }) as { values: { projection_ascii: string }[] };
  const { decodeTransferCodeUnits } = await import("../../persistence/installationTransferCodeUnits");
  expect(JSON.parse(decodeTransferCodeUnits(rows.values[0].projection_ascii)).intentCleanup).toEqual({ kind: "outstanding", recordedAt });
  expect(await f.pair.domain.get(key)).toEqual({ status: "value", value: null });
  expect("tracker" in f.host || "publish" in f.host).toBe(false);
  expect(await f.host.dispose()).toEqual({ ok: true });
});
const sourceGuardKey = (profile = profileId) => "curling.identity.accountDeletionGuard." + profile + ".v1";
const sourceReceiptKey = (nonce = sourceNonce) => "curling.identity.accountDeletionGuardResolution." + nonce + ".v1";
const sourceGuard = (profile = profileId, nonce = sourceNonce, revision = 4) => JSON.stringify({ schemaVersion: 1, profileId: profile, nonce, revision });
const sourceReceipt = (fencedRevision: number, nonce = sourceNonce) => JSON.stringify({ schemaVersion: 1, profileId, nonce, fencedRevision });
async function recoveryHost(archivedFence: number | null = null, extra: Record<string, string> = {}) {
  const f = await proofHost(undefined, { [sourceGuardKey()]: sourceGuard(), ...(archivedFence === null ? {} : { [sourceReceiptKey()]: sourceReceipt(archivedFence) }), ...extra });
  server(f.h, true); const transport = accountTransport(f.h); transport.state.revision = archivedFence ?? 4;
  expect((await f.runtime.startUpOnce()).verdict.kind).toBe("signed_out");
  const verify = async () => { expect((await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).kind).toBe("otp_requested"); return f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456"); };
  const source = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" });
  const assertSource = async () => expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" })).toEqual(source);
  return { ...f, transport, verify, assertSource };
}
it.each([null, 8])("recovers original source nonce through actual conditional abort with archived fence %s, then requires a new genuine proof", async fence => {
  const f = await recoveryHost(fence);
  expect(await f.verify()).toMatchObject({ kind: "resolved", gate: { kind: "identity_unconfirmed" } }); expect(f.events()).toHaveLength(0);
  expect(await f.transferOwner.recoverDeletionState()).toEqual({ ok: true, value: null, recoveredProfileId: profileId });
  expect(f.transport.calls).toEqual(["get_my_account_deletion_control", "abort_my_uncommitted_account_deletion"]);
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: sourceReceipt((fence ?? 4) + 1) });
  expect(await f.pair.domain.get(sourceGuardKey())).toEqual({ status: "value", value: null });
  expect(f.events()).toHaveLength(0); expect(await f.verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } }); expect(f.events()).toHaveLength(1);
  const stamp = f.context.pinFreshEmailOtp(f.events()[0]); expect(stamp).not.toBeNull(); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(true);
  expect(Object.hasOwn(f.runtime, "accountDeletion")).toBe(false); expect(Object.hasOwn(f.host, "cancelDeletion")).toBe(false);
  const tracker = await import("../../persistence/nativeTrackerRegistry"); expect(tracker.authenticateNativeTrackerRuntime(f.runtime)).toBe(false); await f.assertSource();
});
it("permits exact pending cancellation after actual OTP has no admitted Profile", async () => {
  const f = await recoveryHost(); f.transport.state.pending = deletionRow;
  expect(await f.verify()).toMatchObject({ kind: "resolved", gate: { kind: "identity_unconfirmed" } }); expect(f.events()).toHaveLength(0);
  expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: { requestId: deletionRequestId, profileId } });
  expect(f.transport.calls).toEqual(["get_my_account_deletion_control"]);
  expect(await f.transferOwner.cancelDeletion(deletionRequestId)).toEqual({ ok: true, value: true });
  expect(f.transport.calls).toEqual(["get_my_account_deletion_control", "get_my_account_deletion_control", "cancel_my_account_deletion", "get_my_account_deletion_control"]);
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: sourceReceipt(5) }); expect(f.events()).toHaveLength(0);
  expect(await f.verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } }); expect(f.events()).toHaveLength(1); await f.assertSource();
});
it.each([false, true])("blocks server rollback below archived F while preserving actual pending=%s denial", async pending => {
  const f = await recoveryHost(8); f.transport.state.revision = 7; if (pending) f.transport.state.pending = deletionRow;
  expect(await f.verify()).toMatchObject({ kind: "resolved", gate: { kind: "identity_unconfirmed" } });
  const before = f.sql.trace.length, result = await f.transferOwner.recoverDeletionState();
  expect(result).toMatchObject(pending ? { ok: true, value: { requestId: deletionRequestId } } : { ok: false, error: "unavailable" });
  if (pending) expect(await f.transferOwner.cancelDeletion(deletionRequestId)).toEqual({ ok: false, error: "unavailable" });
  expect(f.transport.calls.every(name => name === "get_my_account_deletion_control")).toBe(true);
  expect(f.sql.trace.slice(before).some(event => event.sql?.startsWith("INSERT INTO installation_transfer_identity"))).toBe(false);
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: null }); expect(f.events()).toHaveLength(0); await f.assertSource();
});
it("requires both original and separately persisted destination guards to resolve", async () => {
  const f = await recoveryHost(); f.transport.state.revision = 6;
  expect(await f.pair.domain.set(sourceGuardKey(), sourceGuard(profileId, destinationNonce, 6))).toEqual({ ok: true });
  expect(await f.verify()).toMatchObject({ gate: { kind: "identity_unconfirmed" } });
  expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: sourceReceipt(7) });
  expect(await f.verify()).toMatchObject({ gate: { kind: "identity_unconfirmed" } }); expect(f.events()).toHaveLength(0);
  expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  expect(await f.pair.domain.get(sourceReceiptKey(destinationNonce))).toEqual({ status: "value", value: sourceReceipt(8, destinationNonce) });
  expect(await f.pair.domain.get(sourceGuardKey())).toEqual({ status: "value", value: sourceGuard(profileId, destinationNonce, 6) });
  expect(await f.verify()).toMatchObject({ gate: { kind: "ready_online" } }); expect(f.events()).toHaveLength(1); await f.assertSource();
});
it("does not erase another control-only Profile when recovering the actual account", async () => {
  const otherProfile = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", f = await recoveryHost(null, { [sourceGuardKey(otherProfile)]: sourceGuard(otherProfile, destinationNonce, 4) });
  await f.verify(); expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  const guards = f.transferOwner.wrapSourceDeletionGuards(f.pair.domain, () => true);
  expect(await guards.canAdmit(otherProfile)).toBe(false); expect(await guards.canAdmit(profileId)).toBe(true);
  expect(await f.verify()).toMatchObject({ gate: { kind: "ready_online" } }); await f.assertSource();
});
it("refuses a wrong exact cancellation selector without silently cancelling pending deletion", async () => {
  const f = await recoveryHost(); f.transport.state.pending = deletionRow; await f.verify();
  expect(await f.transferOwner.cancelDeletion(destinationNonce)).toEqual({ ok: true, value: false });
  expect(f.transport.calls).toEqual(["get_my_account_deletion_control"]); expect(f.transport.state.pending).toEqual(deletionRow);
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: null }); await f.assertSource();
});
it("re-fences the actual current server revision after a lost abort acknowledgement", async () => {
  const f = await recoveryHost(); await f.verify(); const real = f.h.fetch.getMockImplementation()!; let lost = true;
  f.h.fetch.mockImplementation(async (...args) => { const answer = await real(...args); if (lost && new URL((args[0] as Request).url).pathname.endsWith("/abort_my_uncommitted_account_deletion")) { lost = false; return response({ message: "Synthetic lost acknowledgement" }, 503); } return answer; });
  expect(await f.transferOwner.recoverDeletionState()).toEqual({ ok: false, error: "unavailable" }); expect(f.transport.state.revision).toBe(5);
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: null });
  expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null }); expect(f.transport.state.revision).toBe(6);
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: sourceReceipt(6) }); await f.assertSource();
});
it.each(["abort", "cancel"] as const)("refuses old local resolution when a new OTP supersedes actual %s", async method => {
  const f = await recoveryHost(); if (method === "cancel") f.transport.state.pending = deletionRow; await f.verify();
  const real = f.h.fetch.getMockImplementation()!, hold = deferred<void>(), entered = deferred<void>();
  f.h.fetch.mockImplementation(async (...args) => { const answer = await real(...args); if (new URL((args[0] as Request).url).pathname.endsWith(method === "abort" ? "/abort_my_uncommitted_account_deletion" : "/cancel_my_account_deletion")) { entered.resolve(); await hold.promise; } return answer; });
  const recovering = method === "abort" ? f.transferOwner.recoverDeletionState() : f.transferOwner.cancelDeletion(deletionRequestId); await entered.promise;
  const newer = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); hold.resolve(); expect(await recovering).toEqual({ ok: false, error: "unavailable" }); await newer;
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: null }); expect(f.events()).toHaveLength(0); await f.assertSource();
});
it("drains actual pending recovery before host disposal and never resolves after close", async () => {
  const f = await recoveryHost(); await f.verify(); const real = f.h.fetch.getMockImplementation()!, hold = deferred<void>(), entered = deferred<void>(); let done = false, closed = false;
  f.h.fetch.mockImplementation(async (...args) => { const answer = await real(...args); if (new URL((args[0] as Request).url).pathname.endsWith("/abort_my_uncommitted_account_deletion")) { entered.resolve(); await hold.promise; } return answer; });
  const work = f.transferOwner.recoverDeletionState(); void work.then(() => { done = true; }); await entered.promise;
  const close = f.host.dispose(); void close.then(() => { closed = true; }); await pause();
  try { expect(done).toBe(false); expect(closed).toBe(false); }
  finally { hold.resolve(); expect(await work).toEqual({ ok: false, error: "unavailable" }); expect(await close).toEqual({ ok: true }); }
  expect(await f.transferOwner.cancelDeletion(deletionRequestId)).toEqual({ ok: false, error: "unavailable" });
});
it("revokes a prior fresh SQL pin when actual pending denial begins and never repins the old event", async () => {
  const f = await recoveryHost(); await f.verify(); await f.transferOwner.recoverDeletionState(); await f.verify();
  const old = f.events()[0], stamp = f.context.pinFreshEmailOtp(old); expect(stamp).not.toBeNull();
  f.transport.state.pending = deletionRow; f.transport.state.revision = 6;
  expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: { requestId: deletionRequestId } });
  expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); expect(f.context.pinFreshEmailOtp(old)).toBeNull();
  expect(await f.transferOwner.cancelDeletion(deletionRequestId)).toEqual({ ok: true, value: true });
  expect(f.context.pinFreshEmailOtp(old)).toBeNull(); expect(await f.verify()).toMatchObject({ gate: { kind: "ready_online" } }); expect(f.events()).toHaveLength(2); await f.assertSource();
});
it.each(["state", "cancel"] as const)("excludes the exact actual recovery %s completion from native SQL without cycles", async method => {
  const f = await recoveryHost(); if (method === "cancel") f.transport.state.pending = deletionRow; await f.verify();
  const connection = await f.sql.options.engine.createConnection(""), original = connection.query;
  connection.query = (() => work) as never;
  const work = method === "state" ? f.transferOwner.recoverDeletionState() : f.transferOwner.cancelDeletion(deletionRequestId);
  const answer = await Promise.race([work, new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]);
  try { expect(answer).toEqual({ ok: false, error: "unavailable" }); }
  finally { connection.query = original; await f.host.dispose(); }
});
it.each(["start", "dispose"] as const)("contains actual own %s work returned by recovery capture", async completion => {
  const f = await context({ [sourceGuardKey()]: sourceGuard() }), pairing = await import("../../persistence/installationTransferPairing"), create = pairing.createInstallationTransferHostOwner;
  vi.spyOn(pairing, "createInstallationTransferHostOwner").mockImplementation((...args) => {
    const owner = create(...args); return Object.freeze({ ...owner, ownAccountRecovery(service) { owner.ownAccountRecovery(service); return (completion === "start" ? host.start() : host.dispose()) as never; } });
  });
  const host = await f.made(), work = host.start();
  const answer = await Promise.race([work, new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(answer).not.toBeNull(); expect(answer).not.toMatchObject({ outcome: "ready" }); await host.dispose();
});
it.each(["retry", "background"] as const)("never bypasses original source guards through actual %s", async method => {
  const f = await recoveryHost(); await f.verify();
  const result = method === "retry" ? await f.runtime.coordinator.retryTrustedStateEstablishment() : await f.runtime.coordinator.revalidateGateFacts();
  expect(result).not.toMatchObject({ gate: { kind: "ready_online" } }); expect(result).not.toMatchObject({ gate: { kind: "ready_offline" } }); expect(f.events()).toHaveLength(0); await f.assertSource();
});
it("retains original guard denial across actual cold SDK/runtime startup", async () => {
  const f = await recoveryHost(); await f.verify(); await f.host.dispose();
  const host = await cold(f); server(f.h, true); accountTransport(f.h).state.revision = 4;
  const runtime = await start(host); expect((await runtime.startUpOnce()).verdict.kind).toBe("identity_unconfirmed");
  expect(Object.hasOwn(runtime, "accountDeletion")).toBe(false); await host.dispose();
});
it.each(["abort", "cancel"] as const)("preserves original holds when actual %s requires recent authentication", async method => {
  const f = await recoveryHost(); if (method === "cancel") f.transport.state.pending = deletionRow; await f.verify(); const real = f.h.fetch.getMockImplementation()!;
  f.h.fetch.mockImplementation((...args) => new URL((args[0] as Request).url).pathname.endsWith(method === "abort" ? "/abort_my_uncommitted_account_deletion" : "/cancel_my_account_deletion") ? Promise.resolve(response({ message: "reauthentication_required: synthetic" }, 403)) : real(...args));
  const result = method === "abort" ? await f.transferOwner.recoverDeletionState() : await f.transferOwner.cancelDeletion(deletionRequestId);
  expect(result).toEqual({ ok: false, error: "reauthentication_required" }); expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: null }); expect(f.events()).toHaveLength(0); await f.assertSource();
});
it("uses an actual acknowledged destination fence as the next server-control lower bound", async () => {
  const f = await recoveryHost(); await f.verify(); f.transport.state.revision = 8;
  expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null }); expect(f.transport.state.revision).toBe(9);
  f.transport.state.revision = 5; const before = f.transport.calls.length;
  expect(await f.transferOwner.recoverDeletionState()).toEqual({ ok: false, error: "unavailable" }); expect(f.transport.calls.slice(before)).toEqual(["get_my_account_deletion_control"]);
  expect(await f.pair.domain.get(sourceReceiptKey())).toEqual({ status: "value", value: sourceReceipt(9) }); await f.assertSource();
});
for (const pending of [false, true]) for (const malformed of ["own", "unrelated"] as const) it(`refuses malformed ${malformed} floor work while retaining actual pending=${pending} fact and ownership`, async () => {
  const f = await context({ [sourceGuardKey()]: sourceGuard() }), pairing = await import("../../persistence/installationTransferPairing"), create = pairing.createInstallationTransferHostOwner;
  const hold = deferred<void>(); let actualOwner: ReturnType<typeof create> | null = null, armed = false;
  vi.spyOn(pairing, "createInstallationTransferHostOwner").mockImplementation((...args) => {
    const owner = create(...args); actualOwner = owner;
    return Object.freeze({ ...owner, wrapSourceDeletionGuards(adapter, current) {
      const repository = owner.wrapSourceDeletionGuards(adapter, current);
      return Object.freeze({ ...repository, acceptControl(profile: string, revision: number) {
        const allowed = repository.acceptControl(profile, revision); return armed ? (malformed === "own" ? work : hold.promise) as never : allowed;
      } });
    } });
  });
  server(f.h, true); const transport = accountTransport(f.h); transport.state.revision = 4; if (pending) transport.state.pending = deletionRow;
  const host = await f.made(), runtime = await start(host); await runtime.startUpOnce(); await runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456"); armed = true;
  const owner = actualOwner! as ReturnType<typeof create>, work = owner.recoverDeletionState();
  const answer = await Promise.race([work, new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(answer).toMatchObject(pending ? { ok: true, value: { requestId: deletionRequestId } } : { ok: false, error: "unavailable" });
  expect(transport.calls).toEqual(["get_my_account_deletion_control"]);
  const closing = host.dispose(); let closed = false; void closing.then(() => { closed = true; }); await pause();
  try { if (malformed === "unrelated") expect(closed).toBe(false); }
  finally { hold.resolve(); await closing; }
});
it.each(["write_failed", "commit_unknown"] as const)("never acknowledges or grants on actual receipt %s", async failure => {
  const f = await recoveryHost(); await f.verify(); let writing = false;
  f.sql.faults.hook = async (event, next) => {
    if (event.sql?.startsWith("INSERT INTO installation_transfer_identity") && event.values?.[0] === sourceReceiptKey()) {
      writing = true; if (failure === "write_failed") throw Error("Synthetic receipt write failure");
    }
    const value = await next(); if (writing && event.kind === "commit" && failure === "commit_unknown") throw Error("Synthetic missing commit acknowledgement"); return value;
  };
  expect(await f.transferOwner.recoverDeletionState()).toEqual({ ok: false, error: "unavailable" });
  expect((await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).kind).not.toBe("otp_requested");
  expect(f.events()).toHaveLength(0); f.sql.faults.hook = undefined; await f.assertSource();
});
for (const legal of ["terms", "privacy", "network"] as const) it(`retains real OTP provenance through initial ${legal} legal block and actual recovery with a current same-SQL stamp`, async () => {
  const f = await proofHost(), before = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" });
  await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); f.setLegal(legal);
  const verified = await f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456"); expect(verified.kind).toBe("resolved"); expect(f.events()).toHaveLength(0);
  f.setLegal(null); expect(await f.runtime.coordinator.submitOnboarding(await f.input())).toMatchObject({ kind: "completed" }); expect(f.events()).toHaveLength(1);
  const stamp = f.context.pinFreshEmailOtp(f.events()[0]); expect(stamp).not.toBeNull(); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(true);
  expect(f.h.fetch.mock.calls.filter(([request]) => new URL((request as Request).url).pathname.endsWith("/verify"))).toHaveLength(1);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" })).toEqual(before);
});
async function switchedProofHost(survival: "ordinary" | "invitation_account_recovery" = "ordinary") {
  const f = await proofHost(), trusted = await import("../../identity/trustedDevice"), intents = await import("../../identity/pendingIntentRepository");
  const record = trusted.createTrustedDeviceRecord({ accountScopeId: "synthetic-prior-account", profileId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", displayName: "Synthetic Previous", onboardingCompletedAt: "2026-01-01T00:00:00Z", generation: 1, establishedAt: "2026-01-01T00:00:00Z", lastServerConfirmationAt: "2026-01-01T00:00:00Z" });
  expect(await f.pair.domain.set("curling.identity.trustedDevice.v1", JSON.stringify(record))).toEqual({ ok: true });
  expect(await f.runtime.coordinator.capturePendingIntent(intents.createPendingIntent({ kind: "invitation", value: "synthetic-prior-invitation", capturedAt: "2026-01-01T00:00:00Z", survival })!)).toEqual({ kind: "applied" });
  await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  expect(await f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "onboarding_required" } }); expect(f.events()).toHaveLength(0);
  return f;
}
it("actual cross-account onboarding removes the prior ordinary intent before actual trusted success and pin", async () => {
  const f = await switchedProofHost(), before = f.sql.trace.length;
  expect(await f.runtime.coordinator.submitOnboarding(await f.input())).toMatchObject({ kind: "completed" }); expect(f.events()).toHaveLength(1);
  expect(await f.pair.domain.get("curling.identity.pendingIntent.v1")).toEqual({ status: "value", value: null });
  const trace = f.sql.trace.slice(before), removal = trace.findIndex(event => event.sql?.startsWith("DELETE FROM installation_transfer_identity") && event.values?.[0] === "curling.identity.pendingIntent.v1");
  const trusted = trace.findIndex(event => event.sql?.startsWith("UPDATE installation_transfer_identity") && event.values?.[1] === "curling.identity.trustedDevice.v1");
  expect(removal).toBeGreaterThanOrEqual(0); expect(trusted).toBeGreaterThan(removal); expect(f.context.freshEmailOtpCurrent(f.context.pinFreshEmailOtp(f.events()[0]))).toBe(true);
});
it("actual failed cross-account cleanup prevents source proof and new trusted success", async () => {
  const f = await switchedProofHost();
  f.sql.faults.hook = async (event, next) => { if (event.sql?.startsWith("DELETE FROM installation_transfer_identity") && event.values?.[0] === "curling.identity.pendingIntent.v1") throw Error("Synthetic cleanup failed"); return next(); };
  expect((await f.runtime.coordinator.submitOnboarding(await f.input())).kind).not.toBe("completed"); expect(f.events()).toHaveLength(0);
  const rows = await f.sql.raw({ kind: "query", sql: "SELECT value_ascii FROM installation_transfer_identity_v1 WHERE key='curling.identity.trustedDevice.v1'" }) as { values: { value_ascii: string }[] };
  const code = await import("../../persistence/installationTransferCodeUnits"); expect(JSON.parse(code.decodeTransferCodeUnits(rows.values[0].value_ascii)).accountScopeId).toBe("synthetic-prior-account");
});
it("actual overlapping submissions retain only the newer OTP lineage while old cleanup drains", async () => {
  const f = await switchedProofHost(), input = await f.input(), entered = deferred<void>(), hold = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => { if (armed && event.sql?.startsWith("DELETE FROM installation_transfer_identity") && event.values?.[0] === "curling.identity.pendingIntent.v1") { armed = false; entered.resolve(); await hold.promise; } return next(); };
  const old = f.runtime.coordinator.submitOnboarding(input); await entered.promise; const newer = f.runtime.coordinator.submitOnboarding(input); hold.resolve();
  expect((await old).kind).not.toBe("completed"); expect(await newer).toMatchObject({ kind: "completed" }); expect(f.events()).toHaveLength(1); expect(f.context.freshEmailOtpCurrent(f.context.pinFreshEmailOtp(f.events()[0]))).toBe(true);
});
it("actual cross-account completion preserves and consumes the bounded invitation-survival rule", async () => {
  const f = await switchedProofHost("invitation_account_recovery"); expect(await f.runtime.coordinator.submitOnboarding(await f.input())).toMatchObject({ kind: "completed" });
  const loaded = await f.pair.domain.get("curling.identity.pendingIntent.v1"); expect(loaded.status).toBe("value"); if (loaded.status !== "value") throw null;
  expect(JSON.parse(loaded.value!)).toMatchObject({ value: "synthetic-prior-invitation", survival: "ordinary" }); expect(f.events()).toHaveLength(1);
});
it("linked onboarding excludes its exact own public completion returned by the actual proof observer", async () => {
  let completing: Promise<unknown> | null = null;
  const f = await proofHost(() => completing); await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); await f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456");
  completing = f.runtime.coordinator.submitOnboarding(await f.input());
  const result = await Promise.race([completing, new Promise(resolve => setTimeout(() => resolve(null), 1500))]); expect(result).not.toBeNull(); expect(f.events()).toHaveLength(1);
  expect(f.coordinator.readNativeFreshEmailOtp(f.events()[0])!.current()).toBe(false); expect(f.context.pinFreshEmailOtp(f.events()[0])).toBeNull(); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("linked onboarding invalidates proof before draining unrelated malformed observer work through host cleanup", async () => {
  const hold = deferred<void>(), f = await proofHost(() => hold.promise); await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); await f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456");
  expect(await f.runtime.coordinator.submitOnboarding(await f.input())).toMatchObject({ kind: "completed" }); expect(f.events()).toHaveLength(1);
  expect(f.coordinator.readNativeFreshEmailOtp(f.events()[0])!.current()).toBe(false);
  let closed = false; const close = f.host.dispose(); void close.then(() => { closed = true; }); await pause();
  try { expect(closed).toBe(false); } finally { hold.resolve(); expect(await close).toEqual({ ok: true }); }
});

async function serverControlHost(controlWork?: () => unknown) {
  const f = await proofHost(undefined, undefined, controlWork);
  server(f.h, true); const transport = accountTransport(f.h);
  await f.runtime.startUpOnce();
  const verify = async () => { await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); return f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456"); };
  expect(await verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  const pin = () => f.context.pinAccountControl(f.context.pinFreshEmailOtp(f.events().at(-1)), f.controls().at(-1));
  return { ...f, transport, verify, pin };
}
it("actual finalized state-null binds server control while retaining the private runtime and source", async () => {
  const f = await serverControlHost(), source = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" });
  expect(await f.transferOwner.recoverDeletionState()).toEqual({ ok: true, value: null }); expect(f.controls()).toHaveLength(1);
  const stamp = f.pin(); expect(stamp).not.toBeNull(); expect(f.context.accountControlCurrent(stamp)).toBe(true);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" })).toEqual(source);
  expect("accountDeletion" in f.runtime || "tracker" in f.runtime || "publish" in f.runtime).toBe(false);
});
it("actual recovery mutation cannot bind until another genuine OTP and new final control", async () => {
  const f = await recoveryHost(); await f.verify();
  expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  expect(f.controls()).toHaveLength(0);
  await f.verify(); expect(await f.transferOwner.recoverDeletionState()).toEqual({ ok: true, value: null });
  expect(f.controls()).toHaveLength(1);
  const stamp = f.context.pinAccountControl(f.context.pinFreshEmailOtp(f.events().at(-1)), f.controls()[0]);
  expect(stamp).not.toBeNull(); expect(f.context.accountControlCurrent(stamp)).toBe(true);
});
it.each(["pending", "malformed", "error", "wrong_profile", "wrong_self"])("actual %s control cannot mint final server proof", async mode => {
  const f = await serverControlHost(), actual = f.h.fetch.getMockImplementation()!;
  if (mode === "pending") f.transport.state.pending = deletionRow;
  const previous = mode === "wrong_self" ? JSON.parse(JSON.parse([...f.h.values.values()].find(raw => JSON.parse(raw).key === f.h.root)!).value) : null;
  if (mode === "wrong_self") { const now = Date.now; vi.spyOn(Date, "now").mockImplementation(() => now() + 7200_000); }
  f.h.fetch.mockImplementation(async (...args) => {
    const path = new URL((args[0] as Request).url).pathname;
    if (path.endsWith("/get_my_account_deletion_control")) {
      if (mode === "malformed") return response({ profile_id: profileId, revision: 0 });
      if (mode === "error") return response({ message: "Synthetic unavailable" }, 503);
      if (mode === "wrong_profile") return response({ profile_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", revision: 0, pending: null });
    }
    if (mode === "wrong_self" && path.endsWith("/token")) return response({ ...previous, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { ...previous.user, id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" } });
    return actual(...args);
  });
  const result = await f.transferOwner.recoverDeletionState();
  if (mode === "pending") expect(result).toMatchObject({ ok: true });
  expect(f.controls()).toHaveLength(0);
  // A mismatching valid Profile is still rejected by the genuine event factory.
  expect(f.pin()).toBeNull();
});
it("accepted same-root SDK command revokes before its response and cannot resurrect an old control", async () => {
  const f = await serverControlHost(); await f.transferOwner.recoverDeletionState(); const stamp = f.pin(); expect(stamp).not.toBeNull();
  const actual = f.h.fetch.getMockImplementation()!, entered = deferred<void>(), hold = deferred<void>();
  f.h.fetch.mockImplementation(async (...args) => { const value = await actual(...args); if (new URL((args[0] as Request).url).pathname.endsWith("/get_my_account_deletion_control")) { entered.resolve(); await hold.promise; } return value; });
  const checking = f.transferOwner.recoverDeletionState(); await entered.promise; expect(f.context.accountControlCurrent(stamp)).toBe(false); hold.resolve();
  expect(await checking).toEqual({ ok: true, value: null });
  expect(f.context.accountControlCurrent(stamp)).toBe(false); expect(f.pin()).not.toBeNull();
});
it("a queued actual same-root state call prevents an older in-flight response from becoming current", async () => {
  const f = await serverControlHost(), actual = f.h.fetch.getMockImplementation()!, hold = deferred<void>(), entered = deferred<void>(); let first = true;
  f.h.fetch.mockImplementation(async (...args) => {
    const value = await actual(...args);
    if (first && new URL((args[0] as Request).url).pathname.endsWith("/get_my_account_deletion_control")) { first = false; entered.resolve(); await hold.promise; }
    return value;
  });
  const older = f.transferOwner.recoverDeletionState(); await entered.promise;
  const newer = f.transferOwner.recoverDeletionState(); hold.resolve(); await older; await newer;
  expect(f.controls()).toHaveLength(1); expect(f.pin()).not.toBeNull();
});
it.each(["mutation", "transition", "close"])("actual %s revokes server control without repinning old evidence", async kind => {
  const f = await serverControlHost(); await f.transferOwner.recoverDeletionState(); const stamp = f.pin(); expect(stamp).not.toBeNull();
  if (kind === "mutation") { const work = f.pair.domain.remove("curling.identity.pendingIntent.v1"); expect(f.context.accountControlCurrent(stamp)).toBe(false); await work; }
  if (kind === "transition") await f.runtime.coordinator.revalidateGateFacts();
  if (kind === "close") await f.host.dispose();
  expect(f.context.accountControlCurrent(stamp)).toBe(false); expect(f.pin()).toBeNull();
});
it("joins unrelated malformed server-observer work after synchronous proof revocation", async () => {
  const hold = deferred<void>(), entered = deferred<void>();
  const f = await serverControlHost(() => { entered.resolve(); return hold.promise; });
  let done = false, closed = false;
  const state = f.transferOwner.recoverDeletionState(); void state.then(() => { done = true; }); await entered.promise;
  const stamp = f.pin(); expect(stamp).toBeNull(); const close = f.host.dispose(); void close.then(() => { closed = true; }); await pause();
  try { expect(done).toBe(true); expect(closed).toBe(false); }
  finally { hold.resolve(); expect(await state).toMatchObject({ ok: false }); await close; }
});
it("excludes exact actual state completion returned by its own final observer without a self-cycle", async () => {
  const f = await serverControlHost(() => state);
  const state: ReturnType<import("../../identity/accountDeletion").AccountDeletionService["getState"]> = f.transferOwner.recoverDeletionState();
  const value = await Promise.race([state, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(value).not.toBeNull(); expect(value).toMatchObject({ ok: false }); expect(f.pin()).toBeNull();
});
it.each(["retry", "background"] as const)("actual %s cannot relabel an old OTP for later state-null proof", async kind => {
  const f = await serverControlHost();
  if (kind === "retry") await f.runtime.coordinator.retryTrustedStateEstablishment(); else await f.runtime.coordinator.revalidateGateFacts();
  await f.transferOwner.recoverDeletionState(); expect(f.controls()).toHaveLength(0); expect(f.pin()).toBeNull();
});
it("actual successful cancellation grants no server-control proof", async () => {
  const f = await serverControlHost(); f.transport.state.pending = deletionRow;
  expect(await f.transferOwner.cancelDeletion(deletionRequestId)).toEqual({ ok: true, value: true }); expect(f.controls()).toHaveLength(0); expect(f.pin()).toBeNull();
});
it("actual SQL mutation during final server control refuses original binding without recovery failure", async () => {
  const f = await serverControlHost(), actual = f.h.fetch.getMockImplementation()!, hold = deferred<void>(), entered = deferred<void>();
  f.h.fetch.mockImplementation(async (...args) => { const value = await actual(...args); if (new URL((args[0] as Request).url).pathname.endsWith("/get_my_account_deletion_control")) { entered.resolve(); await hold.promise; } return value; });
  const state = f.transferOwner.recoverDeletionState(); await entered.promise;
  expect(await f.pair.domain.remove("curling.identity.pendingIntent.v1")).toEqual({ ok: true }); hold.resolve();
  expect(await state).toEqual({ ok: true, value: null }); expect(f.pin()).toBeNull();
  expect(f.context.pinAccountControl({}, f.controls().at(-1))).toBeNull();
});
it("own terminal disposal returned by final control observer drains without a self-cycle", async () => {
  const f: Awaited<ReturnType<typeof serverControlHost>> = await serverControlHost(() => f.host.dispose());
  const state = f.transferOwner.recoverDeletionState();
  const value = await Promise.race([state, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(value).not.toBeNull(); expect(value).toMatchObject({ ok: false }); expect(await f.host.dispose()).toEqual({ ok: true }); expect(f.pin()).toBeNull();
});

const matchingPublicationRaws = () => ({ ...basic(), ...Object.fromEntries(Object.entries(basic()).map(([key, value]) => [key.replace("10000000-0000-4000-8000-000000000001", profileId), value])) });
async function publicationHost(raws: Record<string, string> = matchingPublicationRaws(), protectedRead?: ProtectedRead) {
  const f = await proofHost(undefined, raws, undefined, protectedRead); await onboard(f.h, f.runtime);
  const transport = accountTransport(f.h); expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  return { ...f, transport };
}
async function publicationAnchor(f: Awaited<ReturnType<typeof context>>) {
  const protocol = await import("../../persistence/installationTransferPublicationProtocol");
  const entries = [...f.h.values].filter(([key]) => key.startsWith("t1.")); expect(entries).toHaveLength(1);
  const anchor = protocol.parsePublicationAnchor(entries[0][1]); expect(anchor).not.toBeNull(); return { protocol, raw: entries[0][1], slot: entries[0][0], anchor: anchor! };
}
it("prepares a genuine protected intent after actual OTP and final Control without publishing any SQL rows", async () => {
  const f = await publicationHost();
  const snapshot = async () => {
    const objects = await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master ORDER BY name" }) as { values: { name: string }[] };
    const rows: unknown[] = []; for (const row of objects.values) if (!row.name.startsWith("sqlite_")) rows.push(await f.sql.raw({ kind: "query", sql: "SELECT * FROM " + row.name }));
    return { objects, rows };
  };
  const before = await snapshot(), protectedBefore = new Map(f.h.values);
  const first = f.transferOwner.preparePublication(), duplicate = f.transferOwner.preparePublication(); expect(duplicate).toBe(first);
  expect(await first).toEqual({ code: "publication_intent", mayIssue: false, mayPublish: false, mayMount: false });
  const a = await publicationAnchor(f), row = await f.sql.raw({ kind: "query", sql: "SELECT slot,key,value_ascii,value_digest FROM installation_transfer_sporting_v1 ORDER BY slot" }) as { values: { slot: number; key: string; value_ascii: string; value_digest: string }[] };
  const digest = (values: string[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
  expect(a.anchor).toMatchObject({ packageDigest: f.archive.packageDigest, selectedProfileId: profileId, accountScopeId: "11111111-1111-4111-8111-111111111111", controlRevision: 0 });
  expect(a.anchor.profiles).toEqual(["10000000-0000-4000-8000-000000000001", profileId]);
  expect(a.anchor.protectedWireDigest).toBe(digest(["installation-published-wire/v1", f.archive.protectedWire]));
  expect(a.anchor.preparedDigest).toBe(digest(["installation-published-sporting/v1", f.archive.packageDigest, JSON.stringify(row.values.map(r => [r.slot, r.key, r.value_ascii, r.value_digest]))]));
  expect(await snapshot()).toEqual(before); expect(before.objects.values).toHaveLength(8);
  for (const [key, value] of protectedBefore) expect(f.h.values.get(key)).toBe(value);
  const writes = f.h.events.filter(e => e.kind === "write" && e.key === a.slot).length;
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" }); expect(f.h.events.filter(e => e.kind === "write" && e.key === a.slot)).toHaveLength(writes);
  expect("preparePublication" in f.host || "tracker" in f.runtime).toBe(false); expect(await f.host.dispose()).toEqual({ ok: true });
});
it.each(["no_otp", "no_control", "stale_control", "wrong_profile", "zero_profiles", "cleanup"])("refuses publication %s without native insertion or sporting changes", async reason => {
  const raws = reason === "zero_profiles" ? {} : reason === "wrong_profile" ? basic() : reason === "cleanup" ? { ...matchingPublicationRaws(), "curling.identity.intentCleanup.v1": JSON.stringify({ schemaVersion: 1, recordedAt: "2026-10-26T12:00:00.000Z" }) } : matchingPublicationRaws();
  const f = await proofHost(undefined, raws);
  if (reason !== "no_otp") await onboard(f.h, f.runtime);
  if (reason !== "no_otp" && reason !== "no_control") { accountTransport(f.h); await f.transferOwner.recoverDeletionState(); }
  if (reason === "stale_control") await f.pair.domain.set("curling.identity.pendingIntent.v1", "synthetic");
  const before = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_sporting_v1 ORDER BY slot" });
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_refused", mayPublish: false, mayMount: false });
  expect([...f.h.values.keys()].some(k => k.startsWith("t1."))).toBe(false); expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_sporting_v1 ORDER BY slot" })).toEqual(before);
  expect(await f.host.dispose()).toEqual({ ok: true });
});
it("cold verifies the original package/intent before identity activation and requires new OTP/Control to reuse it", async () => {
  const f = await publicationHost(); expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" }); const a = await publicationAnchor(f);
  expect(await f.host.dispose()).toEqual({ ok: true }); let freshOwner!: typeof f.transferOwner;
  const host = await cold(f, owner => { freshOwner = owner; }); server(f.h, true); const transport = accountTransport(f.h);
  const runtime = await start(host), owner = freshOwner; expect(owner).not.toBe(f.transferOwner);
  expect(await owner.preparePublication()).toMatchObject({ code: "publication_refused" });
  await runtime.startUpOnce(); expect((await runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).kind).toBe("otp_requested"); expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ gate: { kind: "ready_online" } });
  transport.state.revision = a.anchor.controlRevision + 2; expect(await owner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  const writes = f.h.events.filter(e => e.kind === "write" && e.key === a.slot).length;
  expect(await owner.preparePublication()).toMatchObject({ code: "publication_intent" }); expect(f.h.values.get(a.slot)).toBe(a.raw); expect(f.h.events.filter(e => e.kind === "write" && e.key === a.slot)).toHaveLength(writes);
  expect(await host.dispose()).toEqual({ ok: true });
});
it.each(["package", "wire", "prepared", "source", "profile", "pair", "unknown"])("cold holds foreign %s intent before constructing any SDK", async field => {
  const f = await publicationHost(); expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" }); const a = await publicationAnchor(f); await f.host.dispose();
  const key = field === "package" ? "packageDigest" : field === "wire" ? "protectedWireDigest" : field === "prepared" ? "preparedDigest" : field === "source" ? "sourceDenialDigest" : field === "profile" ? "selectedProfileId" : "protocolId";
  const raw = field === "unknown" ? "invalid" : a.protocol.serializePublicationAnchor({ ...a.anchor, ...(field === "profile" ? { profiles: [...a.anchor.profiles, "90000000-0000-4000-8000-000000000009"] } : {}), [key]: field === "profile" || field === "pair" ? "90000000-0000-4000-8000-000000000009" : "f".repeat(64) })!;
  f.h.values.set(a.slot, raw); const before = [...f.h.values];
  const sdk = await import("@supabase/supabase-js"), initialize = vi.spyOn(sdk.AuthClient.prototype, "initialize"), host = await cold(f);
  expect(await host.start()).not.toMatchObject({ outcome: "ready" }); expect(initialize).not.toHaveBeenCalled(); expect([...f.h.values]).toEqual(before); await host.dispose();
});
it("excludes the exact preparation completion returned from standard crypto without a hash/SQL cycle", async () => {
  const f = await publicationHost();
  vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest: () => whole } });
  const whole = f.transferOwner.preparePublication(); expect(await whole).toMatchObject({ code: "publication_refused" });
  vi.stubGlobal("crypto", webcrypto); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("joins unrelated pending hashing while an actual SQL identity mutation revokes the original proof", async () => {
  const f = await publicationHost(), held = deferred<ArrayBuffer>(), entered = deferred<void>();
  vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest() { entered.resolve(); return held.promise; } } });
  const prepare = f.transferOwner.preparePublication(); await entered.promise; let done = false; void prepare.then(() => { done = true; });
  const mutation = f.pair.domain.set("curling.identity.pendingIntent.v1", "synthetic"); await pause(); expect(done).toBe(false);
  held.resolve(new ArrayBuffer(32)); expect(await prepare).toMatchObject({ code: "publication_refused" }); expect(await mutation).toEqual({ ok: true });
  expect([...f.h.values.keys()].some(k => k.startsWith("t1."))).toBe(false); vi.stubGlobal("crypto", webcrypto); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("treats the old intent revision as a negative floor after actual cold OTP and server rollback", async () => {
  const f = await publicationHost(); f.transport.state.revision = 7; expect(await f.transferOwner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" }); const a = await publicationAnchor(f); expect(a.anchor.controlRevision).toBe(7); await f.host.dispose();
  let owner!: typeof f.transferOwner; const host = await cold(f, value => { owner = value; }); server(f.h, true); const transport = accountTransport(f.h); transport.state.revision = 6;
  const runtime = await start(host); await runtime.startUpOnce(); await runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ gate: { kind: "ready_online" } });
  expect(await owner.recoverDeletionState()).toMatchObject({ ok: true, value: null });
  expect(await owner.preparePublication()).toMatchObject({ code: "publication_refused" }); expect(f.h.values.get(a.slot)).toBe(a.raw); expect(await host.dispose()).toEqual({ ok: true });
});
it("holds warm loss of its confirmed intent without reinserting or repairing it", async () => {
  const f = await publicationHost(); expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" }); const a = await publicationAnchor(f), writes = f.h.events.filter(e => e.kind === "write" && e.key === a.slot).length;
  f.h.values.delete(a.slot); expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "fault_held" });
  expect(f.h.values.has(a.slot)).toBe(false); expect(f.h.events.filter(e => e.kind === "write" && e.key === a.slot)).toHaveLength(writes); expect(await f.host.dispose()).not.toEqual({ ok: true });
});
it("keeps uncertain actual protected writes held without granting SQL publication", async () => {
  const f = await publicationHost(), before = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_sporting_v1 ORDER BY slot" });
  f.h.faults.hook = async (event, next) => { const value = await next(); return event.kind === "write" && event.key?.startsWith("t1.") ? {} : value; };
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "fault_held", mayPublish: false, mayMount: false });
  expect([...f.h.values.keys()].some(k => k.startsWith("t1."))).toBe(true); expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_sporting_v1 ORDER BY slot" })).toEqual(before);
  f.h.faults.hook = undefined; expect(await f.host.dispose()).not.toEqual({ ok: true });
});
it("refuses an acquired asynchronous UUID method and joins it through actual disposal", async () => {
  const f = await publicationHost(), held = deferred<unknown>(), entered = deferred<void>();
  vi.stubGlobal("crypto", { subtle: webcrypto.subtle, get randomUUID() { entered.resolve(); return held.promise; } });
  const prepare = f.transferOwner.preparePublication(); await entered.promise; let closed = false;
  const close = f.host.dispose().then(value => { closed = true; return value; }); await pause(); expect(closed).toBe(false);
  held.resolve(() => webcrypto.randomUUID()); expect(await prepare).toMatchObject({ code: "closed" }); expect(await close).toEqual({ ok: true }); vi.stubGlobal("crypto", webcrypto);
});
it("excludes its own exact preparation when acquired as the UUID method", async () => {
  const f = await publicationHost(); vi.stubGlobal("crypto", { subtle: webcrypto.subtle, get randomUUID() { return whole; } });
  const whole = f.transferOwner.preparePublication(); expect(await whole).toMatchObject({ code: "publication_refused" }); vi.stubGlobal("crypto", webcrypto); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("excludes actual host disposal returned by crypto while draining preparation", async () => {
  const f = await publicationHost(); vi.stubGlobal("crypto", { subtle: { digest: () => f.host.dispose() }, randomUUID: () => webcrypto.randomUUID() });
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "closed" }); vi.stubGlobal("crypto", webcrypto); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("revokes original Control when another actual SDK command starts during hashing", async () => {
  const f = await publicationHost(), held = deferred<ArrayBuffer>(), entered = deferred<void>();
  vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest() { entered.resolve(); return held.promise; } } });
  const prepare = f.transferOwner.preparePublication(); await entered.promise;
  const next = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); held.resolve(new ArrayBuffer(32));
  expect(await prepare).toMatchObject({ code: "publication_refused" }); vi.stubGlobal("crypto", webcrypto); expect(await next).toMatchObject({ kind: "otp_requested" });
  expect([...f.h.values.keys()].some(k => k.startsWith("t1."))).toBe(false); expect(await f.host.dispose()).toEqual({ ok: true });
});
function publicationSourceCorrelation(scope: string | null) {
  const barrierId = "40000000-0000-4000-8000-000000000004", attemptId = "50000000-0000-4000-8000-000000000005", now = "2026-10-26T12:00:00.000Z";
  return { ...matchingPublicationRaws(),
    "curling.identity.accessBarrier.v1": JSON.stringify({ schemaVersion: 1, barrierId, origin: "explicit_sign_out", barredAccountScopeId: "synthetic-source", barredGeneration: 7, establishedAt: now }),
    ...(scope === null ? {} : {
      "curling.identity.interactiveAttempt.v1": JSON.stringify({ schemaVersion: 1, barrierId, attemptId, method: "email_otp", flowId: null, capturedIdentityGeneration: 8, startedAt: now }),
      [`curling.identity.accessBarrierResolution.${barrierId}.v1`]: JSON.stringify({ schemaVersion: 1, barrierId, attemptId, method: "email_otp", flowId: null, identityGeneration: 8, authenticatedAccountScopeId: scope, resolvedAt: now }),
    }),
  };
}
it.each(["quarantined", "wrong_account", "same_account"])("requires the original %s source constraint at initial finalization", async mode => {
  const f = await publicationHost(publicationSourceCorrelation(mode === "quarantined" ? null : mode === "same_account" ? "11111111-1111-4111-8111-111111111111" : "different-synthetic-account"));
  const before = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" });
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: mode === "same_account" ? "publication_intent" : "publication_refused" });
  expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" })).toEqual(before); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("preserves another original sporting Profile's guard while preparing only the actual current Profile", async () => {
  const other = "10000000-0000-4000-8000-000000000001", f = await publicationHost({ ...matchingPublicationRaws(), [sourceGuardKey(other)]: sourceGuard(other) });
  const before = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" });
  const guards = f.transferOwner.wrapSourceDeletionGuards(f.pair.domain, () => true); expect(await guards.canAdmit(other)).toBe(false);
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" }); expect(await guards.canAdmit(other)).toBe(false);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" })).toEqual(before); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("excludes its exact preparation completion from actual SQL work without issuing an intent", async () => {
  const f = await publicationHost(), connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  connection.query = (() => whole) as never; const whole = f.transferOwner.preparePublication();
  const answer = await Promise.race([whole, new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(answer).not.toBe("timeout"); expect(answer).not.toMatchObject({ code: "publication_intent" }); expect([...f.h.values.keys()].some(k => k.startsWith("t1."))).toBe(false);
  connection.query = query; await f.host.dispose();
});
it("joins malformed acquired SQL field work through preparation and actual host disposal", async () => {
  const f = await publicationHost(), held = deferred<unknown>(), entered = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => {
    const result = await next(); if (!armed || event.kind !== "query") return result; armed = false;
    return new Proxy({ values: held.promise }, { getOwnPropertyDescriptor(target, name) { const field = Reflect.getOwnPropertyDescriptor(target, name); if (name === "values") entered.resolve(); return field; } });
  };
  let prepared = false, closed = false; const prepare = f.transferOwner.preparePublication().then(value => { prepared = true; return value; }); await entered.promise;
  const close = f.host.dispose().then(value => { closed = true; return value; }); await pause(); expect(prepared).toBe(false); expect(closed).toBe(false);
  held.resolve(undefined); expect(await prepare).not.toMatchObject({ code: "publication_intent" }); await close; expect([...f.h.values.keys()].some(k => k.startsWith("t1."))).toBe(false);
});


// Genuine cross-lane completions are refusal-only facts, never native values.
async function publicationInputs(f: Awaited<ReturnType<typeof publicationHost>>) {
  const args = f.credentialArgs(), capability = f.portModule.publicationTransferCredentialCapability(args[0])!;
  const observed = await capability.read(args[2], args[3], args[4]); expect(observed.status).toBe("observed");
  if (observed.status !== "observed") throw null;
  const stamp = f.context.pinAccountControl(f.context.pinFreshEmailOtp(f.events().at(-1)), f.controls().at(-1));
  expect(stamp).not.toBeNull(); return { args, capability, observation: observed.observation, stamp: stamp! };
}
for (const lane of ["get", "set", "remove", "anchor", "credential", "capability"] as const) it(`refuses actual ${lane} completion acquired by publication digest without a queue cycle`, async () => {
  const f = await publicationHost(), args = f.credentialArgs(), capability = f.portModule.publicationTransferCredentialCapability(args[0])!;
  const issued: Promise<unknown>[] = [];
  const completion = () => {
    const key = "curling.identity.pendingIntent.v1";
    const work = lane === "get" ? f.pair.domain.get(key) : lane === "set" ? f.pair.domain.set(key, "synthetic") : lane === "remove" ? f.pair.domain.remove(key) : lane === "anchor" ? args[6].anchor() : lane === "credential" ? f.pair.credentials.read(f.h.root) : capability.read(args[2], args[3], args[4]);
    issued.push(work); return work;
  };
  vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest: completion } });
  const answer = await Promise.race([f.transferOwner.preparePublication(), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(answer).not.toBe("timeout"); expect(answer).not.toMatchObject({ code: "publication_intent" });
  expect([...f.h.values.keys()].some(key => key.startsWith("t1."))).toBe(false);
  await Promise.all(issued); vi.stubGlobal("crypto", webcrypto); await f.host.dispose();
});
for (const lane of ["get", "credential"] as const) it(`refuses actual ${lane} completion acquired as the UUID method without a queue cycle`, async () => {
  const f = await publicationHost(), issued: Promise<unknown>[] = [];
  vi.stubGlobal("crypto", { subtle: webcrypto.subtle, get randomUUID() {
    const work = lane === "get" ? f.pair.domain.get("curling.identity.pendingIntent.v1") : f.pair.credentials.read(f.h.root); issued.push(work); return work;
  } });
  const answer = await Promise.race([f.transferOwner.preparePublication(), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(answer).not.toBe("timeout"); expect(answer).not.toMatchObject({ code: "publication_intent" });
  expect([...f.h.values.keys()].some(key => key.startsWith("t1."))).toBe(false);
  await Promise.all(issued); vi.stubGlobal("crypto", webcrypto); await f.host.dispose();
});
it("refuses an actual protected capability completion returned directly by native SQL", async () => {
  const f = await publicationHost(), args = f.credentialArgs(), capability = f.portModule.publicationTransferCredentialCapability(args[0])!;
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query, issued: Promise<unknown>[] = [];
  connection.query = (() => { const work = capability.read(args[2], args[3], args[4]); issued.push(work); return work; }) as never;
  const answer = await Promise.race([f.transferOwner.preparePublication(), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(answer).not.toBe("timeout"); expect(answer).not.toMatchObject({ code: "publication_intent" });
  expect([...f.h.values.keys()].some(key => key.startsWith("t1."))).toBe(false);
  connection.query = query; await Promise.all(issued); await f.host.dispose();
});
for (const path of ["context", "owner"] as const) it(`revokes actual source before draining malformed SQL work in ${path} publication preparation`, async () => {
  const f = await publicationHost(), input = await publicationInputs(f), held = deferred<void>(), entered = deferred<void>();
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query; let armed = path === "context", reads = 0;
  f.h.faults.hook = async (event, next) => { const answer = await next(); if (event.kind === "read" && event.key?.startsWith("t1.") && ++reads === 2) armed = true; return answer; };
  connection.query = ((...args: Parameters<typeof query>) => armed ? { get then() { entered.resolve(); return held.promise; } } : Reflect.apply(query, connection, args)) as never;
  const prepare = path === "context" ? f.context.preparePublication(input.stamp, input.observation) : f.transferOwner.preparePublication();
  await entered.promise;
  try { expect(f.pair.health().domain).toBe("failed"); expect(f.context.accountControlCurrent(input.stamp)).toBe(false); }
  finally { held.resolve(); await prepare; connection.query = query; f.h.faults.hook = undefined; await f.host.dispose(); }
});
it("keeps valid pending publication SQL healthy and drains it before successful close", async () => {
  const f = await publicationHost(), held = deferred<void>(), entered = deferred<void>();
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query; let armed = false, reads = 0;
  f.h.faults.hook = async (event, next) => { const answer = await next(); if (event.kind === "read" && event.key?.startsWith("t1.") && ++reads === 2) armed = true; return answer; };
  connection.query = ((...args: Parameters<typeof query>) => {
    const answer = Reflect.apply(query, connection, args);
    if (!armed) return answer; armed = false;
    return Promise.resolve(answer).then(async value => { entered.resolve(); await held.promise; return value; });
  }) as never;
  const prepare = f.transferOwner.preparePublication(); await entered.promise;
  expect(f.pair.health().domain).toBe("healthy"); let closed = false;
  const close = f.host.dispose().then(value => { closed = true; return value; }); await pause(); expect(closed).toBe(false);
  held.resolve(); expect(await prepare).toMatchObject({ code: "closed" }); expect(await close).toEqual({ ok: true });
  connection.query = query; f.h.faults.hook = undefined;
});

async function preparedSqlPublication(raws?: Record<string, string>, protectedRead?: ProtectedRead) {
  const f = await publicationHost(raws, protectedRead);
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" });
  const publicationInput = await publicationInputs(f);
  return { ...f, publicationInput, publish: () => f.context.publishPrepared(publicationInput.observation) };
}
async function originalSqlSnapshot(f: { sql: Awaited<ReturnType<typeof setup>> }) {
  const schema = await f.sql.raw({ kind: "query", sql: "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'installation_transfer_publication_%' AND name NOT LIKE 'installation_transfer_live_%' AND name NOT LIKE 'sqlite_autoindex_installation_transfer_live_%' ORDER BY type,name" });
  const names = ["quarantine", "prepared", "sporting", "pair", "binding", "identity", "source_denial"];
  const rows = await Promise.all(names.map(name => f.sql.raw({ kind: "query", sql: `SELECT * FROM installation_transfer_${name}_v1 ORDER BY rowid` })));
  return { schema, rows };
}
it("M2a atomically copies all original Profiles/u16 and exact intent while retaining a healthy identity-only SDK", async () => {
  const f = await preparedSqlPublication(), before = await originalSqlSnapshot(f);
  const prepared = await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_sporting_v1 ORDER BY slot" });
  const raw = [...f.h.values].find(([key]) => key.startsWith("t1."))![1];
  const first = f.publish(); expect(f.publish()).toBe(first);
  expect(await first).toEqual({ code: "publication_confirmed", observedLayout: "desired11" });
  expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false);
  expect(await originalSqlSnapshot(f)).toEqual(before);
  const schema = await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master ORDER BY name" }) as { values: unknown[] };
  expect(schema.values).toHaveLength(11);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_live_v1 ORDER BY key" })).toEqual(prepared);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT singleton,anchor_ascii,anchor_digest FROM installation_transfer_publication_v1" })).toEqual({ values: [{ singleton: 1, anchor_ascii: raw, anchor_digest: createHash("sha256").update(JSON.stringify(["installation-publication-anchor/v1", raw])).digest("hex") }] });
  expect(await f.pair.domain.get("curling.identity.trustedDevice.v1")).toMatchObject({ status: "value" });
  expect(await f.pair.domain.set("curling.identity.pendingIntent.v1", "synthetic")).toEqual({ ok: true });
  expect(await f.pair.domain.remove("curling.identity.pendingIntent.v1")).toEqual({ ok: true });
  expect(await f.pair.credentials.read(f.h.root)).toMatchObject({ status: "value" });
  expect(await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).toMatchObject({ kind: "otp_requested" });
  expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" });
  expect(await f.publish()).toEqual({ code: "publication_refused", observedLayout: "unknown" });
  expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2a refuses copied/forged protected observations without reflection or writes", async () => {
  const f = await preparedSqlPublication(), trap = vi.fn(() => { throw null; }), writes = f.sql.trace.filter(e => e.kind !== "query").length;
  for (const value of [{}, { ...f.publicationInput.observation }, Object.create(f.publicationInput.observation), new Proxy(f.publicationInput.observation, { get: trap, getPrototypeOf: trap })]) {
    expect(await f.context.publishPrepared(value)).toEqual({ code: "publication_refused", observedLayout: "unknown" });
  }
  expect(trap).not.toHaveBeenCalled(); expect(f.sql.trace.filter(e => e.kind !== "query")).toHaveLength(writes);
  expect(await f.publish()).toMatchObject({ code: "publication_confirmed" }); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const kind of ["identity", "sdk"] as const) it(`M2a rejects original proof made stale by actual ${kind} work before issuance`, async () => {
  const f = await preparedSqlPublication();
  if (kind === "identity") await f.pair.domain.set("curling.identity.pendingIntent.v1", "synthetic");
  else await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  const begin = f.sql.trace.filter(event => event.kind === "begin").length;
  expect(await f.publish()).toEqual({ code: "publication_refused", observedLayout: "unknown" });
  expect(f.sql.trace.filter(event => event.kind === "begin")).toHaveLength(begin);
  expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const cancel of ["identity", "sdk"] as const) it(`M2a keeps queue ownership after ${cancel} revocation and rolls back before COMMIT`, async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_live_v1")) { armed = false; entered.resolve(); await held.promise; } return value; };
  const publish = f.publish(); await entered.promise;
  const revoke = cancel === "identity" ? f.pair.domain.remove("curling.identity.pendingIntent.v1") : f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid");
  const credential = f.pair.credentials.read(f.h.root); let done = false; void credential.then(() => { done = true; });
  await pause(); expect(done).toBe(false); expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false);
  held.resolve(); expect(await publish).toEqual({ code: "publication_unpublished", observedLayout: "before8" });
  await revoke; expect(await credential).toMatchObject({ status: "value" });
  expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" });
  const schema = await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" }) as { values: unknown[] }; expect(schema.values).toHaveLength(8);
  expect(await f.publish()).toMatchObject({ code: "publication_refused" });
  expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2a preserves factual confirmation when real SDK/identity work revokes auth during held reopen", async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => { if (armed && event.kind === "close") { armed = false; entered.resolve(); await held.promise; } return next(); };
  const publish = f.publish(); await entered.promise;
  const sdk = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"), mutation = f.pair.domain.remove("curling.identity.pendingIntent.v1"), credential = f.pair.credentials.read(f.h.root);
  expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false); held.resolve();
  expect(await publish).toEqual({ code: "publication_confirmed", observedLayout: "desired11" });
  expect(await sdk).toMatchObject({ kind: "otp_requested" }); expect(await mutation).toEqual({ ok: true }); expect(await credential).toMatchObject({ status: "value" });
  expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" });
  expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const edge of ["begin", "ddl", "live", "receipt", "commit_before", "commit_after", "commit_ack", "reopen"] as const) it(`M2a retains native uncertainty at ${edge} without repair or a healthy publication`, async () => {
  const f = await preparedSqlPublication(); let armed = true;
  f.sql.faults.hook = async (event, next) => {
    const selected = edge === "begin" ? event.kind === "begin" : edge === "ddl" ? event.kind === "execute" && event.sql?.startsWith("CREATE TABLE installation_transfer_live") : edge === "live" ? event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_live") : edge === "receipt" ? event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_publication") : edge === "reopen" ? event.kind === "close" : event.kind === "commit";
    if (!armed || !selected) return next(); armed = false;
    if (edge === "commit_after" || edge === "commit_ack") { const answer = await next(); if (edge === "commit_ack") return {}; void answer; }
    throw Error("Synthetic publication native uncertainty");
  };
  const result = await f.publish(); expect(result.code).toBe("fault_held");
  if (edge === "commit_after" || edge === "commit_ack") expect(result.observedLayout).toBe("desired11");
  else if (edge !== "reopen") expect(result.observedLayout).toBe("before8");
  const writes = f.sql.trace.filter(event => event.kind === "run" || event.kind === "execute" || event.kind === "commit").length;
  expect(await f.publish()).toMatchObject({ code: "publication_refused" });
  expect(f.sql.trace.filter(event => event.kind === "run" || event.kind === "execute" || event.kind === "commit")).toHaveLength(writes);
  expect(await f.host.dispose()).not.toEqual({ ok: true });
});
for (const edge of ["copy", "commit", "reopen"] as const) for (const closing of ["host", "pair"] as const) it(`M2a preserves healthy ${closing} close during held ${edge} without confusing closed with storage failure`, async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => {
    const selected = edge === "copy" ? event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_live") : edge === "commit" ? event.kind === "commit" : event.kind === "close";
    if (!armed || !selected) return next(); armed = false;
    const answer = await next(); entered.resolve(); await held.promise; return answer;
  };
  const publish = f.publish(); await entered.promise; let closed = false;
  const close = (closing === "host" ? f.host.dispose() : f.pair.dispose()).then(value => { closed = true; return value; });
  await pause(); expect(closed).toBe(false); held.resolve();
  expect(await publish).toEqual({ code: edge === "copy" ? "publication_unpublished" : "publication_confirmed", observedLayout: edge === "copy" ? "before8" : "desired11" });
  expect(await close).toEqual({ ok: true });
  const health = await import("../../persistence/nativeCombinedRuntime");
  expect(health.nativeRuntimeStorageHealthy(f.credentialArgs()[5])).toBe(true);
  expect(health.nativeRuntimeCurrent(f.credentialArgs()[5], "credential")).toBe(false);
  expect(health.nativeRuntimeStorageHealthy({ identity: {} })).toBe(false);
  expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2a retains actual protected-read failure separately from complete durable SQL bytes", async () => {
  const f = await preparedSqlPublication(), nativeEntered = deferred<void>(), nativeHeld = deferred<void>(), commitEntered = deferred<void>(), commitHeld = deferred<void>(); let armed = true;
  f.h.faults.hook = async (event, next) => { const answer = await next(); if (event.kind === "read" && event.key?.startsWith("i1.")) { nativeEntered.resolve(); await nativeHeld.promise; return {}; } return answer; };
  const credential = f.pair.credentials.read(f.h.root); await nativeEntered.promise;
  f.sql.faults.hook = async (event, next) => { const answer = await next(); if (armed && event.kind === "commit") { armed = false; commitEntered.resolve(); await commitHeld.promise; } return answer; };
  const publish = f.publish(); await commitEntered.promise;
  nativeHeld.resolve(); expect(await credential).toMatchObject({ status: "read_failed" });
  commitHeld.resolve(); expect(await publish).toEqual({ code: "fault_held", observedLayout: "desired11" });
  const native = await import("../../persistence/nativeCombinedRuntime"); expect(native.nativeRuntimeStorageHealthy(f.credentialArgs()[5])).toBe(false);
  f.h.faults.hook = undefined; expect(await f.host.dispose()).not.toEqual({ ok: true });
});

async function publicationPhysicalFixture(f: Awaited<ReturnType<typeof preparedSqlPublication>>) {
  const raw = [...f.h.values].find(([key]) => key.startsWith("t1."))![1], digest = createHash("sha256").update(JSON.stringify(["installation-publication-anchor/v1", raw])).digest("hex");
  const rows = (await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_sporting_v1 ORDER BY slot" }) as { values: { key: string; value_ascii: string }[] }).values;
  const version = (await f.sql.raw({ kind: "query", sql: "PRAGMA schema_version" }) as { values: { schema_version: number }[] }).values[0].schema_version;
  const create = async () => {
    await f.sql.raw({ kind: "execute", sql: "CREATE TABLE installation_transfer_publication_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), anchor_ascii TEXT NOT NULL, anchor_digest TEXT NOT NULL)" });
    await f.sql.raw({ kind: "execute", sql: "CREATE TABLE installation_transfer_live_v1 (key TEXT PRIMARY KEY NOT NULL, value_ascii TEXT NOT NULL)" });
    for (const row of rows) await f.sql.raw({ kind: "run", sql: "INSERT INTO installation_transfer_live_v1 (key,value_ascii) VALUES (?,?)", values: [row.key, row.value_ascii] });
    await f.sql.raw({ kind: "run", sql: "INSERT INTO installation_transfer_publication_v1 (singleton,anchor_ascii,anchor_digest) VALUES (1,?,?)", values: [raw, digest] });
  };
  const remove = async () => {
    await f.sql.raw({ kind: "execute", sql: "DROP TABLE installation_transfer_publication_v1" });
    await f.sql.raw({ kind: "execute", sql: "DROP TABLE installation_transfer_live_v1" });
    await f.sql.raw({ kind: "execute", sql: `PRAGMA schema_version=${version}` });
  };
  return { create, remove, version };
}
it("M2a treats positively acknowledged COMMIT followed by exact before8 as contradiction", async () => {
  const f = await preparedSqlPublication(), physical = await publicationPhysicalFixture(f); let armed = true;
  f.sql.faults.hook = async (event, next) => { const answer = await next(); if (armed && event.kind === "commit") { armed = false; await physical.remove(); } return answer; };
  expect(await f.publish()).toEqual({ code: "fault_held", observedLayout: "before8" }); expect(await f.host.dispose()).not.toEqual({ ok: true });
});
it("M2a never confirms durable desired11 without its own issued COMMIT", async () => {
  const f = await preparedSqlPublication(), physical = await publicationPhysicalFixture(f); let armed = true, revoked: Promise<unknown> | null = null;
  f.sql.faults.hook = async (event, next) => {
    const answer = await next();
    if (armed && event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_publication_v1")) { armed = false; revoked = f.pair.domain.remove("curling.identity.pendingIntent.v1"); }
    if (event.kind === "rollback") await physical.create();
    return answer;
  };
  const commits = f.sql.trace.filter(event => event.kind === "commit").length;
  expect(await f.publish()).toEqual({ code: "fault_held", observedLayout: "desired11" });
  expect(f.sql.trace.filter(event => event.kind === "commit")).toHaveLength(commits); await revoked;
  expect(await f.host.dispose()).not.toEqual({ ok: true });
});
for (const first of ["before8", "desired11"] as const) it(`M2a pins first complete durable ${first} across every reopen/discovery read`, async () => {
  const f = await preparedSqlPublication(), physical = await publicationPhysicalFixture(f); let afterCommit = false, recovering = false, schemaReads = 0, changed = false;
  f.sql.faults.hook = async (event, next) => {
    if (event.kind === "commit" && !afterCommit) { afterCommit = true; if (first === "before8") throw Error("Synthetic missing COMMIT ACK"); }
    const answer = await next();
    if (afterCommit && event.kind === "open") recovering = true;
    if (recovering && !changed && event.kind === "query" && event.sql === "PRAGMA schema_version;" && ++schemaReads === 2) {
      changed = true; if (first === "before8") await physical.create(); else await physical.remove();
    }
    return answer;
  };
  expect(await f.publish()).toEqual({ code: "fault_held", observedLayout: first }); expect(changed).toBe(true);
  expect(await f.host.dispose()).not.toEqual({ ok: true });
});
for (const factory of ["createInstallationTransferPairingSql", "createInstallationTransferIdentitySql", "createInstallationTransferSourceIdentitySql"] as const) it(`M2a ${factory} cold constructor refuses eleven objects unchanged`, async () => {
  const f = await preparedSqlPublication(); expect(await f.publish()).toMatchObject({ code: "publication_confirmed" }); expect(await f.host.dispose()).toEqual({ ok: true });
  const rows = await f.sql.raw({ kind: "open" }); void rows;
  const snapshot = await f.sql.raw({ kind: "query", sql: "SELECT name,sql FROM sqlite_master ORDER BY name" }); await f.sql.raw({ kind: "close" });
  const implementation = await import("../../persistence/installationTransferQuarantineSql"), context = implementation[factory](f.sql.options, () => false);
  expect(["fault_held", "target_conflict"]).toContain(await context.inspect(() => true));
  await context.close(); await f.sql.raw({ kind: "open" });
  expect(await f.sql.raw({ kind: "query", sql: "SELECT name,sql FROM sqlite_master ORDER BY name" })).toEqual(snapshot);
  await f.sql.raw({ kind: "close" });
});
for (const completion of ["get", "set", "remove", "anchor", "credential", "capability", "publish", "dispose"] as const) it(`M2a excludes genuine ${completion} completion from actual DDL without a queue cycle or ACK`, async () => {
  const f = await preparedSqlPublication(), connection = await f.sql.options.engine.createConnection(""), execute = connection.execute, args = f.credentialArgs();
  const issued: Promise<unknown>[] = [];
  connection.execute = ((sql: string, transaction: boolean) => {
    if (!sql.startsWith("CREATE TABLE installation_transfer_publication_v1")) return Reflect.apply(execute, connection, [sql, transaction]);
    const key = "curling.identity.pendingIntent.v1";
    const actual = completion === "get" ? f.pair.domain.get(key) : completion === "set" ? f.pair.domain.set(key, "synthetic") : completion === "remove" ? f.pair.domain.remove(key) : completion === "anchor" ? args[6].anchor() : completion === "credential" ? f.pair.credentials.read(f.h.root) : completion === "capability" ? f.publicationInput.capability.read(args[2], args[3], args[4]) : completion === "dispose" ? f.pair.dispose() : whole;
    issued.push(actual); return actual;
  }) as never;
  const whole = f.publish(), result = await Promise.race([whole, new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(result).not.toBe("timeout"); expect(result).toMatchObject({ code: "fault_held" });
  connection.execute = execute; await Promise.all(issued); expect(await f.host.dispose()).not.toEqual({ ok: true });
});
it("M2a preserves raw JSON formatting and surrogate codeunits for every original Profile", async () => {
  const analysis = await import("../../historyAnalysis");
  const raw = JSON.stringify({ ...analysis.createDefaultHistoryFilters(), sessionIds: ["nul\0lone\ud800|\udfff"], blockIds: [""] }, null, 2).replace("\\ud800", "\ud800").replace("\\udfff", "\udfff");
  const raws = { ...matchingPublicationRaws(), ...Object.fromEntries(Object.keys(matchingPublicationRaws()).map(key => [key.replace("assessment-show-introduction", "history-filters"), raw])) };
  const f = await preparedSqlPublication(raws); expect(await f.publish()).toMatchObject({ code: "publication_confirmed" });
  const rows = (await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_live_v1 ORDER BY key" }) as { values: { key: string; value_ascii: string }[] }).values;
  const codec = await import("../../persistence/installationTransferCodeUnits");
  expect(Object.fromEntries(rows.map(row => [row.key, codec.decodeTransferCodeUnits(row.value_ascii)]))).toEqual(raws);
  expect(await f.pair.domain.get(Object.keys(raws)[0])).toMatchObject({ status: "read_failed" });
  expect(f.pair.health().domain).toBe("healthy"); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const drift of ["schema", "identity", "live", "receipt"] as const) it(`M2a faults on ${drift} drift after first durable publication observation`, async () => {
  const f = await preparedSqlPublication(); let committed = false, recovering = false, versions = 0, changed = false;
  f.sql.faults.hook = async (event, next) => {
    const answer = await next(); if (event.kind === "commit") committed = true;
    if (committed && event.kind === "open") recovering = true;
    if (recovering && !changed && event.kind === "query" && event.sql === "PRAGMA schema_version;" && ++versions === 2) {
      changed = true;
      const sql = drift === "schema" ? "PRAGMA schema_version=123456" : drift === "identity" ? "INSERT INTO installation_transfer_identity_v1 (key,value_ascii) VALUES ('curling.identity.pendingIntent.v1','u16:')" : drift === "live" ? "UPDATE installation_transfer_live_v1 SET value_ascii='u16:'" : "UPDATE installation_transfer_publication_v1 SET anchor_digest='wrong'";
      await f.sql.raw({ kind: "execute", sql });
    }
    return answer;
  };
  expect(await f.publish()).toEqual({ code: "fault_held", observedLayout: "desired11" }); expect(changed).toBe(true); expect(await f.host.dispose()).not.toEqual({ ok: true });
});
it("M2a waits for unrelated malformed native work and revokes before its drain", async () => {
  const f = await preparedSqlPublication(), connection = await f.sql.options.engine.createConnection(""), execute = connection.execute, entered = deferred<void>(), held = deferred<void>();
  connection.execute = ((sql: string, transaction: boolean) => sql.startsWith("CREATE TABLE installation_transfer_publication_v1") ? { get then() { entered.resolve(); return held.promise; } } : Reflect.apply(execute, connection, [sql, transaction])) as never;
  let complete = false; const publish = f.publish().then(value => { complete = true; return value; }); await entered.promise;
  expect(f.pair.health().domain).toBe("failed"); expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false);
  const close = f.host.dispose(); await pause(); expect(complete).toBe(false);
  held.resolve(); expect(await publish).toMatchObject({ code: "fault_held" }); connection.execute = execute; expect(await close).not.toEqual({ ok: true });
});
it("M2a permits a fresh actual OTP/Control retry after healthy unpublished cancellation without reviving old proof", async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => { const answer = await next(); if (armed && event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_live")) { armed = false; entered.resolve(); await held.promise; } return answer; };
  const publishing = f.publish(); await entered.promise;
  const request = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); held.resolve(); expect(await publishing).toMatchObject({ code: "publication_unpublished" }); await request;
  expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false); expect(await f.publish()).toMatchObject({ code: "publication_refused" });
  expect(await f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  expect(await f.transferOwner.recoverDeletionState()).toEqual({ ok: true, value: null });
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "publication_intent" });
  const next = await publicationInputs(f); expect(await f.context.publishPrepared(next.observation)).toMatchObject({ code: "publication_confirmed" });
  expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2a revokes direct synchronous native throws before draining acquired unrelated work", async () => {
  const f = await preparedSqlPublication(), connection = await f.sql.options.engine.createConnection(""), execute = connection.execute, entered = deferred<void>(), held = deferred<void>();
  connection.execute = Object.assign((sql: string, transaction: boolean) => {
    if (sql.startsWith("CREATE TABLE installation_transfer_publication_v1")) { entered.resolve(); throw Error("Synthetic direct native throw"); }
    return Reflect.apply(execute, connection, [sql, transaction]);
  }, { then: held.promise }) as never;
  let done = false; const publish = f.publish().then(value => { done = true; return value; }); await entered.promise;
  expect(f.pair.health().domain).toBe("failed"); expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false);
  await pause(); expect(done).toBe(false); held.resolve();
  expect(await publish).toMatchObject({ code: "fault_held" }); connection.execute = execute; expect(await f.host.dispose()).not.toEqual({ ok: true });
});
for (const published of [false, true]) it(`M2a retains immediate schema fencing with publication=${published}`, async () => {
  const f = await preparedSqlPublication(); if (published) expect(await f.publish()).toMatchObject({ code: "publication_confirmed" });
  await f.sql.raw({ kind: "execute", sql: "CREATE TABLE foreign_data (value TEXT)" }); const from = f.sql.trace.length;
  expect(await f.pair.domain.get("curling.identity.trustedDevice.v1")).toMatchObject({ status: "read_failed" });
  expect(f.sql.trace.slice(from).filter(event => event.kind === "query").map(event => event.sql)).toEqual(["PRAGMA schema_version;"]);
  expect(f.pair.health().domain).toBe("failed"); expect(await f.host.dispose()).not.toEqual({ ok: true });
});

for (const method of ["inspect", "pairing", "prepareIdentityRuntime", "cleanup"] as const) it(`M2a excludes the actual source ${method} outward completion from native DDL settlement`, async () => {
  const f = await preparedSqlPublication(), connection = await f.sql.options.engine.createConnection(""), execute = connection.execute;
  let issued: Promise<unknown> | null = null;
  connection.execute = ((sql: string, transaction: boolean) => {
    if (!sql.startsWith("CREATE TABLE installation_transfer_publication_v1")) return Reflect.apply(execute, connection, [sql, transaction]);
    issued = method === "inspect" ? f.context.inspect(() => true) : method === "pairing" ? f.context.pairing(() => true) : method === "cleanup" ? f.context.cleanup() : f.context.prepareIdentityRuntime(f.credentialArgs()[5], () => true);
    return issued;
  }) as never;
  const result = await Promise.race([f.publish(), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  connection.execute = execute;
  if (result === "timeout") hosts.splice(hosts.indexOf(f.host), 1);
  expect(issued).not.toBeNull(); expect(result).not.toBe("timeout"); expect(result).toMatchObject({ code: "fault_held" });
  await issued; expect(await f.host.dispose()).not.toEqual({ ok: true });
});
it("M2a stops immediately on a version contradicting its established durable pin", async () => {
  const f = await preparedSqlPublication(); let committed = false, recovering = false, versions = 0, changed = false, from = -1;
  f.sql.faults.hook = async (event, next) => {
    const value = await next(); if (event.kind === "commit") committed = true; if (committed && event.kind === "open") recovering = true;
    if (recovering && event.kind === "query" && event.sql === "PRAGMA schema_version;" && ++versions === 2) { changed = true; await f.sql.raw({ kind: "execute", sql: "PRAGMA schema_version=123456" }); }
    if (recovering && event.kind === "query" && event.sql === "PRAGMA schema_version;" && (value as { values: { schema_version: number }[] }).values[0].schema_version === 123456 && from < 0) from = f.sql.trace.length;
    return value;
  };
  expect(await f.publish()).toEqual({ code: "fault_held", observedLayout: "desired11" }); expect(changed).toBe(true); expect(from).toBeGreaterThan(0);
  expect(f.sql.trace.slice(from).filter(event => event.kind === "query")).toEqual([]); expect(f.pair.health().domain).toBe("failed");
});
it("M2a revokes pinned-schema contradiction before acquiring later unrelated native work", async () => {
  const f = await preparedSqlPublication(), held = deferred<void>(), entered = deferred<void>(); let committed = false, recovering = false, versions = 0, invalid = false, holding = false;
  f.sql.faults.hook = async (event, next) => {
    const value = await next(); if (event.kind === "commit") committed = true; if (committed && event.kind === "open") recovering = true;
    if (recovering && event.kind === "query" && event.sql === "PRAGMA schema_version;" && ++versions === 2) await f.sql.raw({ kind: "execute", sql: "PRAGMA schema_version=123456" });
    if (recovering && event.kind === "query" && event.sql === "PRAGMA schema_version;" && (value as { values: { schema_version: number }[] }).values[0].schema_version === 123456) invalid = true;
    else if (invalid && !holding && event.kind === "query") { holding = true; entered.resolve(); await held.promise; }
    return value;
  };
  const publish = f.publish(), reached = await Promise.race([entered.promise.then(() => true), publish.then(() => false)]);
  try { expect(invalid).toBe(true); expect(f.pair.health().domain).toBe("failed"); expect(reached).toBe(false); }
  finally { held.resolve(); expect(await publish).toEqual({ code: "fault_held", observedLayout: "desired11" }); }
});
it("M2a joins a healthy genuinely pending DDL across pre-COMMIT close", async () => {
  const f = await preparedSqlPublication(), held = deferred<void>(), entered = deferred<void>(); let armed = true, closed = false;
  f.sql.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "execute" && event.sql?.startsWith("CREATE TABLE installation_transfer_publication_v1")) { armed = false; entered.resolve(); await held.promise; } return value; };
  const publish = f.publish(); await entered.promise; expect(f.pair.health().domain).toBe("healthy");
  const close = f.host.dispose().then(value => { closed = true; return value; }); await pause(); expect(closed).toBe(false);
  held.resolve(); expect(await publish).toEqual({ code: "publication_unpublished", observedLayout: "before8" }); expect(await close).toEqual({ ok: true });
});
for (const replay of ["accepted", "preparation", "unseen"] as const) it(`M2a refuses a genuine old ${replay} observation after the accepted M1 boundary`, async () => {
  const f = await preparedSqlPublication(), input = await publicationInputs(f);
  const draft = await f.context.preparePublication(input.stamp, input.observation); expect(draft).not.toBeNull(); const payload = f.context.publicationDraftPayload(draft)!;
  const accepted = await input.capability.insert(input.args[2], input.args[3], input.args[4], payload.raw); expect(accepted.status).toBe("observed"); if (accepted.status !== "observed") throw null;
  // This later handle is issued before accept, but never shown to SQL. A mere
  // accepted-handle inequality or its own occurrence cannot establish freshness.
  const hidden = await input.capability.read(input.args[2], input.args[3], input.args[4]); if (hidden.status !== "observed") throw null;
  expect(await f.context.acceptPublicationAnchor(draft, accepted.observation)).toBe(true);
  const old = replay === "accepted" ? accepted.observation : replay === "preparation" ? input.observation : hidden.observation;
  f.h.values.delete([...f.h.values.keys()].find(key => key.startsWith("t1."))!); const from = f.sql.trace.length;
  expect(await f.context.publishPrepared(old)).toEqual({ code: "publication_refused", observedLayout: "unknown" });
  expect(f.sql.trace.slice(from).some(event => event.kind === "begin")).toBe(false);
  expect(((await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" })) as { values: unknown[] }).values).toHaveLength(8);
});
it("M2a accepts an actually new observation after rejecting pre-accept genuine handles", async () => {
  const f = await preparedSqlPublication(), input = await publicationInputs(f), draft = await f.context.preparePublication(input.stamp, input.observation);
  const payload = f.context.publicationDraftPayload(draft)!, accepted = await input.capability.insert(input.args[2], input.args[3], input.args[4], payload.raw); if (accepted.status !== "observed") throw null;
  const hidden = await input.capability.read(input.args[2], input.args[3], input.args[4]); if (hidden.status !== "observed") throw null;
  expect(await f.context.acceptPublicationAnchor(draft, accepted.observation)).toBe(true);
  for (const old of [input.observation, accepted.observation, hidden.observation]) expect(await f.context.publishPrepared(old)).toMatchObject({ code: "publication_refused" });
  expect(f.pair.health().domain).toBe("healthy");
  const fresh = await input.capability.read(input.args[2], input.args[3], input.args[4]); if (fresh.status !== "observed") throw null;
  expect(await f.context.publishPrepared(fresh.observation)).toEqual({ code: "publication_confirmed", observedLayout: "desired11" }); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2a actual new protected read detects warm intent loss before SQL publication", async () => {
  const f = await preparedSqlPublication(), args = f.credentialArgs(); f.h.values.delete([...f.h.values.keys()].find(key => key.startsWith("t1."))!);
  expect(await f.publicationInput.capability.read(args[2], args[3], args[4])).toEqual({ status: "refused" });
  expect(await f.publish()).not.toMatchObject({ code: "publication_confirmed" });
  expect(((await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" })) as { values: unknown[] }).values).toHaveLength(8);
});
it("M2a includes genuine observations completed during the M1 accept drain in its freshness cutoff", async () => {
  const f = await preparedSqlPublication(), input = await publicationInputs(f), draft = await f.context.preparePublication(input.stamp, input.observation), payload = f.context.publicationDraftPayload(draft)!;
  const acknowledged = await input.capability.insert(input.args[2], input.args[3], input.args[4], payload.raw); if (acknowledged.status !== "observed") throw null;
  const nativeEntered = deferred<void>(), nativeHeld = deferred<void>(), drainEntered = deferred<void>(), drainHeld = deferred<void>(); let armed = true, acceptDone = false;
  f.h.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "read" && event.key?.startsWith("t1.")) { armed = false; nativeEntered.resolve(); await nativeHeld.promise; } return value; };
  const beforeAccept = input.capability.read(input.args[2], input.args[3], input.args[4]); await nativeEntered.promise;
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  Object.defineProperty(query, "then", { configurable: true, value: (resolve: (value: unknown) => void) => { drainEntered.resolve(); void drainHeld.promise.then(() => resolve(undefined)); } });
  const accepting = f.context.acceptPublicationAnchor(draft, acknowledged.observation).then(value => { acceptDone = true; return value; }); await drainEntered.promise; expect(acceptDone).toBe(false);
  nativeHeld.resolve(); const intermediate = await beforeAccept; expect(intermediate.status).toBe("observed"); expect(acceptDone).toBe(false);
  drainHeld.resolve(); expect(await accepting).toBe(true); Reflect.deleteProperty(query, "then"); f.h.faults.hook = undefined;
  if (intermediate.status !== "observed") throw null;
  expect(await f.context.publishPrepared(intermediate.observation)).toMatchObject({ code: "publication_refused" });
  const fresh = await input.capability.read(input.args[2], input.args[3], input.args[4]); if (fresh.status !== "observed") throw null;
  expect(await f.context.publishPrepared(fresh.observation)).toEqual({ code: "publication_confirmed", observedLayout: "desired11" }); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2a rechecks original Control after the actual M1 accept drain", async () => {
  const f = await preparedSqlPublication(), input = await publicationInputs(f), draft = await f.context.preparePublication(input.stamp, input.observation), payload = f.context.publicationDraftPayload(draft)!;
  const acknowledged = await input.capability.insert(input.args[2], input.args[3], input.args[4], payload.raw); if (acknowledged.status !== "observed") throw null;
  const entered = deferred<void>(), held = deferred<void>(), connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  Object.defineProperty(query, "then", { configurable: true, value: (resolve: (value: unknown) => void) => { entered.resolve(); void held.promise.then(() => resolve(undefined)); } });
  const accepting = f.context.acceptPublicationAnchor(draft, acknowledged.observation); await entered.promise;
  const sdk = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); held.resolve(); expect(await accepting).toBe(false);
  Reflect.deleteProperty(query, "then"); expect(await sdk).toMatchObject({ kind: "otp_requested" }); expect(await f.context.publishPrepared(acknowledged.observation)).toMatchObject({ code: "publication_refused" });
  expect(f.pair.health().domain).toBe("healthy"); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const method of ["close", "initializeIdentity"] as const) it(`M2a excludes adjacent genuine context ${method} completion from actual native DDL`, async () => {
  const f = await preparedSqlPublication(), connection = await f.sql.options.engine.createConnection(""), execute = connection.execute; let issued: Promise<unknown> | null = null;
  connection.execute = ((sql: string, transaction: boolean) => { if (!sql.startsWith("CREATE TABLE installation_transfer_publication_v1")) return Reflect.apply(execute, connection, [sql, transaction]); issued = method === "close" ? f.context.close() : f.context.initializeIdentity(() => true); return issued; }) as never;
  const result = await Promise.race([f.publish(), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]); connection.execute = execute;
  if (result === "timeout") hosts.splice(hosts.indexOf(f.host), 1);
  expect(issued).not.toBeNull(); expect(result).not.toBe("timeout"); expect(result).toMatchObject({ code: "fault_held" }); await issued;
});

const noPublicationGrant = (code: string, observedLayout: string) => ({ code, observedLayout, mayIssue: false, mayPublish: false, mayMount: false });
it("M2b source owner freshly observes and atomically publishes without exposing a host/runtime grant", async () => {
  const f = await preparedSqlPublication(), before = await originalSqlSnapshot(f), from = f.h.events.length;
  const whole = f.transferOwner.publishPrepared(); expect(f.transferOwner.publishPrepared()).toBe(whole);
  const result = await whole; expect(result).toEqual(noPublicationGrant("publication_confirmed", "desired11")); expect(Object.isFrozen(result)).toBe(true); expect(Object.getPrototypeOf(result)).toBeNull();
  expect(f.h.events.slice(from).some(event => event.kind === "read" && event.key?.startsWith("t1."))).toBe(true);
  expect(await originalSqlSnapshot(f)).toEqual(before); expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false);
  for (const publicValue of [f.host, f.runtime, f.pair]) expect("publishPrepared" in publicValue).toBe(false);
  expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_refused", "unknown"));
  expect(await f.pair.domain.get("curling.identity.trustedDevice.v1")).toMatchObject({ status: "value" }); expect(await f.pair.credentials.read(f.h.root)).toMatchObject({ status: "value" });
  expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2b refuses publication without an actual accepted M1 preparation", async () => {
  const f = await publicationHost(), from = f.sql.trace.length;
  expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_refused", "unknown"));
  expect(f.sql.trace.slice(from).some(event => event.kind === "begin")).toBe(false); expect(f.pair.health().domain).toBe("healthy"); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const revoke of ["sdk", "identity"] as const) it(`M2b refuses stale actual ${revoke} proof before publication issuance`, async () => {
  const f = await preparedSqlPublication();
  if (revoke === "sdk") await f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); else await f.pair.domain.remove("curling.identity.pendingIntent.v1");
  const from = f.sql.trace.length; expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_refused", "unknown"));
  expect(f.sql.trace.slice(from).some(event => event.kind === "begin")).toBe(false); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const fault of ["missing", "different", "manifest", "foreign", "read"] as const) it(`M2b actual fresh protected ${fault} contradiction prevents SQL publication`, async () => {
  const f = await preparedSqlPublication(), from = f.sql.trace.length;
  const slot = [...f.h.values.keys()].find(key => key.startsWith("t1."))!;
  if (fault === "missing") f.h.values.delete(slot);
  if (fault === "different") { const { protocol, anchor } = await publicationAnchor(f); f.h.values.set(slot, protocol.serializePublicationAnchor({ ...anchor, controlRevision: anchor.controlRevision + 1 })!); }
  if (fault === "manifest") f.h.values.delete([...f.h.values.keys()].find(key => key.startsWith("m1."))!);
  if (fault === "foreign") f.h.values.set("foreign-synthetic-slot", "synthetic");
  if (fault === "read") f.h.faults.hook = async (event, next) => event.kind === "read" && event.key?.startsWith("t1.") ? {} : next();
  expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("fault_held", "unknown"));
  expect(f.sql.trace.slice(from).some(event => event.kind === "begin")).toBe(false);
  expect(((await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" })) as { values: unknown[] }).values).toHaveLength(8);
  f.h.faults.hook = undefined; expect(await f.host.dispose()).not.toEqual({ ok: true });
});
for (const revoke of ["sdk", "identity"] as const) it(`M2b preserves healthy rollback and consumed proof during ${revoke} revocation`, async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_live")) { armed = false; entered.resolve(); await held.promise; } return value; };
  const publishing = f.transferOwner.publishPrepared(); await entered.promise;
  const changing = revoke === "sdk" ? f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid") : f.pair.domain.remove("curling.identity.pendingIntent.v1");
  held.resolve(); expect(await publishing).toEqual(noPublicationGrant("publication_unpublished", "before8")); await changing;
  expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_refused", "unknown")); expect(f.pair.health().domain).toBe("healthy"); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2b preserves factual issued-COMMIT confirmation after original Control and SDK proof revoke", async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => { if (armed && event.kind === "close") { armed = false; entered.resolve(); await held.promise; } return next(); };
  const publishing = f.transferOwner.publishPrepared(); await entered.promise;
  const sdk = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"), mutation = f.pair.domain.remove("curling.identity.pendingIntent.v1"), credential = f.pair.credentials.read(f.h.root);
  expect(f.context.accountControlCurrent(f.publicationInput.stamp)).toBe(false); held.resolve();
  expect(await publishing).toEqual(noPublicationGrant("publication_confirmed", "desired11")); await sdk; expect(await mutation).toEqual({ ok: true }); expect(await credential).toMatchObject({ status: "value" }); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const edge of ["copy", "commit", "reopen"] as const) it(`M2b joins actual owner close during ${edge} while retaining physical facts`, async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (event, next) => {
    const selected = edge === "copy" ? event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_live") : edge === "commit" ? event.kind === "commit" : event.kind === "close";
    const value = await next(); if (armed && selected) { armed = false; entered.resolve(); await held.promise; } return value;
  };
  const publishing = f.transferOwner.publishPrepared(); await entered.promise; let closed = false;
  const closing = f.transferOwner.close().then(value => { closed = true; return value; }); await pause(); expect(closed).toBe(false); held.resolve();
  expect(await publishing).toEqual(noPublicationGrant(edge === "copy" ? "publication_unpublished" : "publication_confirmed", edge === "copy" ? "before8" : "desired11"));
  expect(await closing).toMatchObject({ code: "closed" }); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const edge of ["begin", "ddl", "live", "receipt", "commit_before", "commit_after", "commit_ack", "reopen"] as const) it(`M2b retains actual native ${edge} uncertainty without a repair or false grant`, async () => {
  const f = await preparedSqlPublication(); let armed = true;
  f.sql.faults.hook = async (event, next) => {
    const selected = edge === "begin" ? event.kind === "begin" : edge === "ddl" ? event.kind === "execute" && event.sql?.startsWith("CREATE TABLE installation_transfer_live") : edge === "live" ? event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_live") : edge === "receipt" ? event.kind === "run" && event.sql?.startsWith("INSERT INTO installation_transfer_publication") : edge === "reopen" ? event.kind === "close" : event.kind === "commit";
    if (!armed || !selected) return next(); armed = false;
    if (edge === "commit_after" || edge === "commit_ack") { await next(); if (edge === "commit_ack") return {}; }
    throw Error("Synthetic publication native uncertainty");
  };
  const result = await f.transferOwner.publishPrepared(); expect(result.code).toBe("fault_held"); expect(result).toMatchObject({ mayIssue: false, mayPublish: false, mayMount: false });
  if (edge === "commit_after" || edge === "commit_ack") expect(result.observedLayout).toBe("desired11");
  else if (edge !== "reopen") expect(result.observedLayout).toBe("before8");
  const from = f.sql.trace.length; expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_refused", "unknown"));
  expect(f.sql.trace.slice(from).some(event => event.kind === "run" || event.kind === "execute" || event.kind === "commit")).toBe(false); expect(await f.host.dispose()).not.toEqual({ ok: true });
});
for (const lane of ["sql", "protected"] as const) it(`M2b excludes its actual outward source-owner completion acquired by native ${lane} work`, async () => {
  let armed = false, entered = false;
  const f = await preparedSqlPublication(undefined, (key, next) => { if (armed && lane === "protected" && key.startsWith("t1.")) { entered = true; return whole; } return next(); });
  const connection = await f.sql.options.engine.createConnection(""), execute = connection.execute;
  if (lane === "sql") connection.execute = ((sql: string, transaction: boolean) => { if (!sql.startsWith("CREATE TABLE installation_transfer_publication_v1")) return Reflect.apply(execute, connection, [sql, transaction]); entered = true; return whole; }) as never;
  armed = true; const whole = f.transferOwner.publishPrepared();
  const result = await Promise.race([whole, new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(entered).toBe(true); expect(result).not.toBe("timeout"); expect(result).toMatchObject({ code: lane === "sql" ? "fault_held" : "publication_refused", mayPublish: false });
  armed = false; connection.execute = execute;
  if (lane === "protected") { expect(f.pair.health().credential).toBe("healthy"); expect(await f.host.dispose()).toEqual({ ok: true }); }
  else expect(await f.host.dispose()).not.toEqual({ ok: true });
});
it("M2b refuses parallel M1 work and joins a cancelled actual protected read before close", async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true, finished = false;
  f.h.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "read" && event.key?.startsWith("t1.")) { armed = false; entered.resolve(); await held.promise; } return value; };
  const publishing = f.transferOwner.publishPrepared(); await entered.promise;
  expect(await f.transferOwner.preparePublication()).toMatchObject({ code: "busy" }); expect(await f.transferOwner.inspect()).toMatchObject({ code: "runtime_owned" });
  const closing = f.transferOwner.close().then(value => { finished = true; return value; }); await pause(); expect(finished).toBe(false); held.resolve();
  expect(await publishing).toEqual(noPublicationGrant("publication_refused", "unknown")); expect(await closing).toMatchObject({ code: "closed" }); expect(await f.host.dispose()).toEqual({ ok: true });
});
for (const kind of ["malformed", "own_completion"] as const) it(`M2b reports actual ${kind} SQL-anchor failure before the SQL publication task as held`, async () => {
  const f = await preparedSqlPublication(), connection = await f.sql.options.engine.createConnection(""), query = connection.query, from = f.sql.trace.length;
  connection.query = (() => kind === "malformed" ? {} : whole) as never;
  const whole = f.transferOwner.publishPrepared(), result = await Promise.race([whole, new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]); connection.query = query;
  expect(result).not.toBe("timeout"); expect(f.pair.health().domain).toBe("failed"); expect(f.sql.trace.slice(from).some(event => event.kind === "begin")).toBe(false);
  expect(await f.host.dispose()).not.toEqual({ ok: true }); expect(result).toEqual(noPublicationGrant("fault_held", "unknown"));
});
it("M2b healthy SDK supersession during the fresh protected read refuses without poisoning stores", async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(), from = f.sql.trace.length; let armed = true;
  f.h.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "read" && event.key?.startsWith("t1.")) { armed = false; entered.resolve(); await held.promise; } return value; };
  const publication = f.transferOwner.publishPrepared(); await entered.promise; const sdk = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); held.resolve();
  expect(await publication).toEqual(noPublicationGrant("publication_refused", "unknown")); expect(await sdk).toMatchObject({ kind: "otp_requested" });
  expect(f.sql.trace.slice(from).some(event => event.sql?.includes("CREATE TABLE installation_transfer_publication_v1"))).toBe(false);
  expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" }); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("M2b refuses publication during actual M1 work and succeeds after that preparation", async () => {
  const f = await preparedSqlPublication(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.h.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "read" && event.key?.startsWith("t1.")) { armed = false; entered.resolve(); await held.promise; } return value; };
  const preparation = f.transferOwner.preparePublication(); await entered.promise; expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_refused", "unknown"));
  held.resolve(); expect(await preparation).toMatchObject({ code: "publication_intent" }); expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_confirmed", "desired11")); expect(await f.host.dispose()).toEqual({ ok: true });
});

async function coldPublishedFixture(beforeClose?: (f: Awaited<ReturnType<typeof preparedSqlPublication>>) => Promise<void>, protectedRead?: ProtectedRead, expectDisposeOk = true, raws?: Record<string, string>) {
  const f = await preparedSqlPublication(raws, protectedRead);
  expect(await f.transferOwner.publishPrepared()).toEqual(noPublicationGrant("publication_confirmed", "desired11"));
  if (beforeClose) await beforeClose(f);
  const before = await originalSqlSnapshot(f); expect((await f.host.dispose()).ok).toBe(expectDisposeOk);
  const implementation = await import("../../persistence/installationTransferQuarantineSql"), constructors = vi.spyOn(implementation, "createPublishedInstallationSql");
  const bindings = await import("../../persistence/installationPublishedBinding"), produced = vi.spyOn(bindings, "recordPublishedInstallationBinding");
  const ports = vi.spyOn(f.portModule, "createPublicationTransferCredentialMigrationPort");
  const publishedModule = await import("../../persistence/installationPublishedOwner");
  const options = { sqlite: f.sql.options, providerConfigIdentity: (await import("../nativeProviderConfiguration")).resolveNativeProviderConfiguration(f.binding)!.providerConfigIdentity, sessionStorageKey: f.h.root,
    protectedBinding: f.options.migration.protectedBinding, detectPlatform: () => "ios" };
  const make = (input: unknown = options) => { const owner = publishedModule.createPublishedInstallationOwner(input); publishedOwners.push(owner); return owner; };
  const owner = make();
  return { ...f, before, bindings, make, owner, options, publishedModule,
    publishedPort: async () => { const result = await ports.mock.results.at(-1)!.value; if (!result.ok) throw null; return result.value; },
    publishedContext: () => constructors.mock.results.at(-1)!.value as import("../../persistence/installationTransferQuarantineSql").NativePublishedInstallationContext,
    publishedBinding: () => produced.mock.results.filter(result => result.value !== null).at(-1)!.value as object };
}
it("M3a cold genuine SQL/protected binding needs no source file, code, SDK or runtime grant", async () => {
  const f = await coldPublishedFixture(), sdk = await import("@supabase/supabase-js"), initialized = vi.spyOn(sdk.AuthClient.prototype, "initialize");
  const writes = f.h.events.filter(event => event.kind === "write").length, from = f.sql.trace.length;
  const whole = f.owner.verify(); expect(f.owner.verify()).toBe(whole); expect(await whole).toEqual({ code: "binding_confirmed", mayIssue: false, mayPublish: false, mayMount: false });
  expect(initialized).not.toHaveBeenCalled(); expect(f.h.events.filter(event => event.kind === "write")).toHaveLength(writes);
  expect(f.sql.trace.slice(from).some(event => event.kind === "begin" || event.kind === "run" || event.kind === "execute" && /^(CREATE|INSERT|UPDATE|DELETE|ALTER|DROP)/.test(event.sql ?? ""))).toBe(false);
  expect(f.sql.trace.slice(from).some(event => event.kind === "query" && /SELECT.*FROM installation_transfer_live_v1/.test(event.sql ?? ""))).toBe(false);
  expect(await originalSqlSnapshot(f)).toEqual(f.before);
  const proof = f.publishedBinding(), facts = f.bindings.readPublishedInstallationBinding(proof)!;
  expect(facts.anchor.selectedProfileId).toBe(profileId); expect(facts.source.sportingProfiles).toHaveLength(2); expect(f.publishedContext().bindingCurrent(proof)).toBe(true);
  for (const fake of [{}, { ...proof }, Object.create(proof), new Proxy(proof, { get() { throw null; } })]) expect(f.bindings.readPublishedInstallationBinding(fake)).toBeNull();
  expect(Object.keys(f.owner).sort()).toEqual(["close", "handoff", "sourceGuardRepository", "verify"]); expect(await f.owner.close()).toMatchObject({ code: "closed" }); expect(f.bindings.readPublishedInstallationBinding(proof)).toBeNull();
});
it("M3a accepts actual mutable SDK entries and identity state from prior published sessions", async () => {
  const f = await coldPublishedFixture(async f => {
    expect(await f.pair.credentials.write(f.h.root + "-code-verifier", JSON.stringify("x".repeat(43)))).toEqual({ ok: true });
    expect(await f.pair.domain.set("curling.identity.pendingIntent.v1", "synthetic later identity value")).toEqual({ ok: true });
  });
  expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" }); expect(await f.owner.close()).toMatchObject({ code: "closed" });
});
it("M3a does not cap or fingerprint mutable future live rows as initial source evidence", async () => {
  const f = await coldPublishedFixture(); await f.sql.raw({ kind: "open" });
  const codec = await import("../../persistence/installationTransferCodeUnits"), futureKey = "curling.sporting.profile.v1.90000000-0000-4000-8000-000000000009.curling-release-tracker-session-history";
  const raw = JSON.stringify({ entries: ["x".repeat(3145729)] });
  const value = "u16:" + Array.from({ length: Math.ceil(raw.length / 1048576) }, (_, i) => codec.encodeTransferCodeUnits(raw.slice(i * 1048576, (i + 1) * 1048576)).slice(4)).join("");
  await f.sql.raw({ kind: "run", sql: "INSERT INTO installation_transfer_live_v1 (key,value_ascii) VALUES (?,?)", values: [futureKey, value] });
  await f.sql.raw({ kind: "execute", sql: "DELETE FROM installation_transfer_live_v1 WHERE key=(SELECT key FROM installation_transfer_live_v1 ORDER BY key LIMIT 1)" }); await f.sql.raw({ kind: "close" });
  const from = f.sql.trace.length; expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  expect(f.sql.trace.slice(from).some(event => event.kind === "query" && /SELECT.*FROM installation_transfer_live_v1/.test(event.sql ?? ""))).toBe(false);
  expect(await f.owner.close()).toMatchObject({ code: "closed" });
});
it("M3a can positively close and reacquire actual stores without constructing a second SDK", async () => {
  const f = await coldPublishedFixture(); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" }); expect(await f.owner.close()).toMatchObject({ code: "closed" });
  const second = f.make(); expect(await second.verify()).toMatchObject({ code: "binding_confirmed" }); expect(await second.close()).toMatchObject({ code: "closed" });
});

async function coldEdit(f: Awaited<ReturnType<typeof coldPublishedFixture>>, sql: string, values: unknown[] = []) {
  await f.sql.raw({ kind: "open" }); await f.sql.raw({ kind: "run", sql, values }); await f.sql.raw({ kind: "close" });
}
const noBinding = (value: unknown) => { expect(value).not.toMatchObject({ code: "binding_confirmed" }); expect(value).toMatchObject({ mayIssue: false, mayPublish: false, mayMount: false }); };
for (const count of [0, 1, 3, 4, 5, 7, 8, 9, 10, 12]) it(`M3a refuses actual ${count}-object layout without initialization or repair`, async () => {
  const f = await coldPublishedFixture(); await f.sql.raw({ kind: "open" });
  const drops = count === 12 ? [] : ["live", "publication", "source_denial", "identity", "binding", "pair", "sporting", "prepared", "quarantine"];
  for (const name of drops) {
    const rows = await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" }) as { values: unknown[] };
    if (rows.values.length === count) break;
    if (count === 9 && name === "live") continue;
    if (count === 10 && name === "live") continue;
    await f.sql.raw({ kind: "execute", sql: `DROP TABLE installation_transfer_${name}_v1` });
    if (count === 9 || count === 10) break;
  }
  if (count === 9) await f.sql.raw({ kind: "execute", sql: "DROP TABLE installation_transfer_source_denial_v1" });
  if (count === 12) await f.sql.raw({ kind: "execute", sql: "CREATE TABLE foreign_data(value TEXT)" });
  // A nine-object mixture retains live/index while removing receipt and source.
  const before = await f.sql.raw({ kind: "query", sql: "SELECT name,sql FROM sqlite_master ORDER BY name" }); await f.sql.raw({ kind: "close" });
  expect((before as { values: unknown[] }).values).toHaveLength(count);
  const from = f.sql.trace.length; noBinding(await f.owner.verify());
  expect(f.sql.trace.slice(from).some(e => (e.kind === "begin" || ["run", "execute"].includes(e.kind) && /^(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER)/.test(e.sql ?? "")))).toBe(false);
  await f.sql.raw({ kind: "open" }); expect(await f.sql.raw({ kind: "query", sql: "SELECT name,sql FROM sqlite_master ORDER BY name" })).toEqual(before);
});
for (const kind of ["wire", "prepared_ascii", "prepared_digest", "source_digest", "receipt_digest", "bound_q", "identity_shape", "live_schema"] as const) it(`M3a rejects actual immutable ${kind} mutation with no write`, async () => {
  const f = await coldPublishedFixture();
  const changes: Record<typeof kind, string> = {
    wire: "UPDATE installation_transfer_quarantine_v1 SET protected_wire=substr(protected_wire,1,length(protected_wire)-1)||CASE substr(protected_wire,-1) WHEN 'A' THEN 'B' ELSE 'A' END",
    prepared_ascii: "UPDATE installation_transfer_sporting_v1 SET value_ascii='u16:0066' WHERE slot=0",
    prepared_digest: "UPDATE installation_transfer_sporting_v1 SET value_digest='" + "a".repeat(64) + "' WHERE slot=0",
    source_digest: "UPDATE installation_transfer_source_denial_v1 SET projection_digest='" + "a".repeat(64) + "'",
    receipt_digest: "UPDATE installation_transfer_publication_v1 SET anchor_digest='" + "a".repeat(64) + "'",
    bound_q: "UPDATE installation_transfer_binding_v1 SET bound_q='{}'",
    identity_shape: "INSERT INTO installation_transfer_identity_v1 (key,value_ascii) VALUES ('foreign','u16:')",
    live_schema: "ALTER TABLE installation_transfer_live_v1 ADD COLUMN foreign_column TEXT",
  };
  await coldEdit(f, changes[kind]); const from = f.sql.trace.length; noBinding(await f.owner.verify()); expect(f.sql.trace.slice(from).some(e => (e.kind === "begin" || ["run", "execute"].includes(e.kind) && /^(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER)/.test(e.sql ?? "")))).toBe(false);
});
for (const kind of ["missing_t1", "missing_m", "foreign_inventory", "malformed_i", "different_t1", "wrong_root", "wrong_config"] as const) it(`M3a rejects actual protected ${kind} without adopting or repairing it`, async () => {
  const f = await coldPublishedFixture(), protocol = await import("../../persistence/installationTransferPublicationProtocol");
  const t1 = [...f.h.values.keys()].find(key => key.startsWith("t1."))!, m = [...f.h.values.keys()].find(key => key.startsWith("m1."))!;
  if (kind === "missing_t1") f.h.values.delete(t1);
  if (kind === "missing_m") f.h.values.delete(m);
  if (kind === "foreign_inventory") f.h.values.set("unknown-synthetic-slot", "value");
  if (kind === "malformed_i") f.h.values.set("i1.not-a-physical-slot", "value");
  if (kind === "different_t1") { const anchor = protocol.parsePublicationAnchor(f.h.values.get(t1))!; f.h.values.set(t1, protocol.serializePublicationAnchor({ ...anchor, controlRevision: anchor.controlRevision + 1 })!); }
  const owner = kind === "wrong_root" ? f.make({ ...f.options, sessionStorageKey: "sb-other-auth-token" }) : kind === "wrong_config" ? f.make({ ...f.options, providerConfigIdentity: "pc1:other" }) : f.owner;
  const before = [...f.h.values], writes = f.h.events.filter(e => e.kind === "write").length;
  noBinding(await owner.verify()); expect([...f.h.values]).toEqual(before); expect(f.h.events.filter(e => e.kind === "write")).toHaveLength(writes);
});
for (const lane of ["protected", "hash"] as const) for (const drift of ["static", "schema"] as const) it(`M3a pins original evidence through held ${lane} work and detects ${drift} drift`, async () => {
  const f = await coldPublishedFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  if (lane === "protected") f.h.faults.hook = async (e, next) => { const value = await next(); if (armed && e.kind === "read" && e.key?.startsWith("t1.")) { armed = false; entered.resolve(); await held.promise; } return value; };
  else vi.stubGlobal("crypto", { subtle: { digest: async (...args: Parameters<typeof webcrypto.subtle.digest>) => { if (armed) { armed = false; entered.resolve(); await held.promise; } return Reflect.apply(webcrypto.subtle.digest, webcrypto.subtle, args); } } });
  const whole = f.owner.verify(); await entered.promise;
  await f.sql.raw({ kind: "execute", sql: drift === "static" ? "UPDATE installation_transfer_sporting_v1 SET value_ascii='u16:0066' WHERE slot=0" : "CREATE TABLE transient_foreign(value TEXT)" });
  if (drift === "schema") await f.sql.raw({ kind: "execute", sql: "DROP TABLE transient_foreign" });
  held.resolve(); expect(await whole).toMatchObject({ code: "fault_held" }); expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
});
for (const lane of ["sql", "protected", "hash"] as const) it(`M3a close revokes pending healthy ${lane} work and drains before positive retirement`, async () => {
  const f = await coldPublishedFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true, closed = false;
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  if (lane === "sql") connection.query = ((...args: Parameters<typeof query>) => Promise.resolve(Reflect.apply(query, connection, args)).then(async value => { if (armed) { armed = false; entered.resolve(); await held.promise; } return value; })) as never;
  if (lane === "protected") f.h.faults.hook = async (e, next) => { const value = await next(); if (armed && e.kind === "read" && e.key?.startsWith("t1.")) { armed = false; entered.resolve(); await held.promise; } return value; };
  if (lane === "hash") vi.stubGlobal("crypto", { subtle: { digest: async (...args: Parameters<typeof webcrypto.subtle.digest>) => { if (armed) { armed = false; entered.resolve(); await held.promise; } return Reflect.apply(webcrypto.subtle.digest, webcrypto.subtle, args); } } });
  const whole = f.owner.verify(); await entered.promise; const close = f.owner.close(); expect(f.owner.close()).toBe(close); void close.then(() => { closed = true; }); await pause();
  expect(closed).toBe(false); held.resolve(); expect(await whole).toMatchObject({ code: "closed" }); expect(await close).toMatchObject({ code: "closed" }); expect(await f.owner.verify()).toMatchObject({ code: "closed" });
  connection.query = query; f.h.faults.hook = undefined; vi.stubGlobal("crypto", webcrypto);
  const second = f.make(); expect(await second.verify()).toMatchObject({ code: "binding_confirmed" });
});
it("M3a refuses foreign store owners while active and positively closes only its own zero-resource refusal", async () => {
  const f = await coldPublishedFixture(); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  const second = f.make(); noBinding(await second.verify()); expect(await second.close()).toMatchObject({ code: "closed" });
  expect(f.publishedContext().health()).toBe("healthy"); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" }); expect(await f.owner.close()).toMatchObject({ code: "closed" });
  const third = f.make(); expect(await third.verify()).toMatchObject({ code: "binding_confirmed" });
});
it("M3a artifact recognition cannot clear an original SDK-only-held reservation", async () => {
  const f = await coldPublishedFixture(async () => {
    const sdk = await import("@supabase/supabase-js"); vi.spyOn(sdk.AuthClient.prototype, "dispose").mockRejectedValue(Error("Synthetic terminal SDK cleanup failure"));
  }, undefined, false);
  expect(await f.owner.verify()).toEqual({ code: "binding_confirmed", mayIssue: false, mayPublish: false, mayMount: false });
  expect(await f.h.module.createConfiguredInstallationTransferIdentityHost(f.binding, { migration: f.h.options.migration, fetch: f.h.fetch, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl() {} }, installationTransfer: { protectedWire: f.archive.protectedWire, recoveryCode: f.archive.recoveryCode } })).toEqual({ ok: false, reason: "ownership_conflict" });
  expect(await f.owner.close()).toMatchObject({ code: "closed" });
  expect(await f.h.module.createNativeSupabaseAuthHost(f.h.options)).toEqual({ ok: false, reason: "ownership_conflict" });
});
it("M3a refuses caller source fields without invoking their getters or native work", async () => {
  const f = await coldPublishedFixture(), trap = vi.fn();
  const owner = f.make({ ...f.options, get installationTransfer() { trap(); return {}; } }); const from = f.sql.trace.length;
  noBinding(await owner.verify()); expect(trap).not.toHaveBeenCalled(); expect(f.sql.trace).toHaveLength(from); expect(await owner.close()).toMatchObject({ code: "closed" });
});

for (const lane of ["sql", "protected", "hash"] as const) for (const completion of ["verify", "close"] as const) it(`M3a excludes exact owner ${completion} completion acquired from ${lane}`, async () => {
  const f = await coldPublishedFixture(); let armed = true;
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  const value = () => completion === "verify" ? whole : f.owner.close();
  if (lane === "sql") connection.query = ((...args: Parameters<typeof query>) => armed ? (armed = false, value()) : Reflect.apply(query, connection, args)) as never;
  if (lane === "protected") f.options.protectedBinding = { ...f.h.binding, read(key: string) { if (armed && key.startsWith("t1.")) { armed = false; return value(); } return f.h.binding.read(key); } };
  if (lane === "hash") vi.stubGlobal("crypto", { subtle: { digest: value } });
  const whole = f.owner.verify(), result = await Promise.race([whole, new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(result).not.toBe("timeout"); noBinding(result); connection.query = query; f.h.faults.hook = undefined; vi.stubGlobal("crypto", webcrypto);
});
for (const method of ["createConnection", "open", "query", "execute"] as const) it(`M3a immediately holds synchronous native ${method} failures`, async () => {
  const f = await coldPublishedFixture(), connection = await f.sql.options.engine.createConnection("");
  const receiver = method === "createConnection" ? f.sql.options.engine : connection, original = Reflect.get(receiver, method);
  Reflect.set(receiver, method, () => { throw null; }); expect(await f.owner.verify()).toMatchObject({ code: "fault_held" });
  expect(f.publishedContext().health()).toBe("failed"); Reflect.set(receiver, method, original); expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
  const second = f.make(); noBinding(await second.verify());
});
it("M3a revokes malformed native metadata before draining unrelated work", async () => {
  const f = await coldPublishedFixture(), held = deferred<void>(), entered = deferred<void>(), connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  connection.query = (() => ({ get then() { entered.resolve(); return held.promise; } })) as never;
  const whole = f.owner.verify(); await entered.promise; expect(f.publishedContext().health()).toBe("failed");
  let closed = false; const close = f.owner.close().then((value: unknown) => { closed = true; return value; }); await pause(); expect(closed).toBe(false);
  held.resolve(); expect(await whole).toMatchObject({ code: "fault_held" }); expect(await close).toMatchObject({ code: "fault_held" }); connection.query = query;
});
for (const method of ["close", "closeConnection"] as const) it(`M3a retains uncertain ${method} cleanup and retries the same actual owner`, async () => {
  const f = await coldPublishedFixture(); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  const connection = await f.sql.options.engine.createConnection(""), receiver = method === "close" ? connection : f.sql.options.engine, original = Reflect.get(receiver, method);
  Reflect.set(receiver, method, () => Promise.reject(null)); expect(await f.owner.close()).toMatchObject({ code: "cleanup_held" });
  const second = f.make(); noBinding(await second.verify()); expect(await second.close()).toMatchObject({ code: "closed" });
  Reflect.set(receiver, method, original); expect(await f.owner.close()).toMatchObject({ code: "closed" }); const third = f.make(); expect(await third.verify()).toMatchObject({ code: "binding_confirmed" });
});
it("M3a refuses fake candidate/observation objects without reading their properties", async () => {
  const f = await coldPublishedFixture(); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" }); const ctx = f.publishedContext(), trap = vi.fn(() => { throw null; });
  const fake = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, ownKeys: trap });
  expect(ctx.candidatePayload(fake)).toBeNull(); expect(await ctx.verifyBinding(fake, fake)).toBeNull(); expect(ctx.bindingCurrent(fake)).toBe(false); expect(trap).not.toHaveBeenCalled();
  const candidate = await ctx.candidate(() => true); expect(candidate).not.toBeNull(); expect(await ctx.verifyBinding(candidate, fake)).toBeNull(); expect(trap).not.toHaveBeenCalled();
});

for (const lane of ["sql", "protected", "hash"] as const) for (const operation of ["candidate", "cleanup", "capability", "acquire"] as const) it(`M3a excludes genuine ${operation} producer at the ${lane} native edge`, async () => {
  const f = await coldPublishedFixture(); let armed = false; const issue = () => value();
  if (lane === "protected") f.options.protectedBinding = { ...f.h.binding, read(key: string) { if (armed && key.startsWith("t1.")) { armed = false; return issue(); } return f.h.binding.read(key); } };
  expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  const ctx = f.publishedContext(), port = await f.publishedPort(), cap = f.portModule.publicationTransferCredentialCapability(port)!, candidate = await ctx.candidate(() => true), payload = ctx.candidatePayload(candidate)!;
  armed = true; const issued: Promise<unknown>[] = [];
  const value = () => { const work = operation === "candidate" ? ctx.candidate(() => true) : operation === "cleanup" ? ctx.cleanup() : operation === "acquire" ? port.acquire() : cap.read(f.credentialArgs()[2], payload.q, payload.manifest); issued.push(work); return work; };
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  if (lane === "sql") connection.query = ((...args: Parameters<typeof query>) => armed ? (armed = false, value()) : Reflect.apply(query, connection, args)) as never;
  if (lane === "hash") vi.stubGlobal("crypto", { subtle: { digest: value } });
  const whole = f.owner.verify(), result = await Promise.race([whole, new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(result).not.toBe("timeout"); noBinding(result); connection.query = query; vi.stubGlobal("crypto", webcrypto); await Promise.all(issued);
});
for (const stage of ["configure", "inventory"] as const) it(`M3a joins a late protected ${stage} acquisition during healthy close`, async () => {
  const f = await coldPublishedFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true, closed = false;
  f.h.faults.hook = async (e, next) => { const value = await next(); if (armed && e.kind === stage) { armed = false; entered.resolve(); await held.promise; } return value; };
  const whole = f.owner.verify(); await entered.promise; const close = f.owner.close(); void close.then(() => { closed = true; }); await pause(); expect(closed).toBe(false);
  held.resolve(); expect(await whole).toMatchObject({ code: "closed" }); expect(await close).toMatchObject({ code: "closed" }); f.h.faults.hook = undefined;
  expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
it("M3a close before verify issues no native work", async () => {
  const f = await coldPublishedFixture(), from = f.sql.trace.length, protectedFrom = f.h.events.length;
  expect(await f.owner.close()).toMatchObject({ code: "closed" }); expect(await f.owner.verify()).toMatchObject({ code: "closed" }); expect(f.sql.trace).toHaveLength(from); expect(f.h.events).toHaveLength(protectedFrom);
});

for (const nested of [false, true]) it(`M3a capture stops further ${nested ? "SQLite" : "outer"} descriptors after actual owner close`, async () => {
  const f = await coldPublishedFixture(); let armed = false, later = 0, close: Promise<unknown> | null = null;
  const target = nested ? f.options.sqlite : f.options;
  const input = new Proxy(target, { getOwnPropertyDescriptor(object, key) { if (!armed) { armed = true; close = owner.close(); } else later++; return Reflect.getOwnPropertyDescriptor(object, key); } });
  const owner = f.make(nested ? { ...f.options, sqlite: input } : input), from = f.sql.trace.length;
  expect(await owner.verify()).toMatchObject({ code: "closed" }); expect(await close).toMatchObject({ code: "closed" }); expect(f.sql.trace).toHaveLength(from); expect(later).toBe(0);
});
it("M3a capture retains an invalid pending options root through verification and close", async () => {
  const f = await coldPublishedFixture(), held = deferred<void>(), owner = f.make(held.promise); let done = false, closed = false;
  const reading = owner.verify().then((value: unknown) => { done = true; return value; }); await pause();
  const closing = owner.close().then((value: unknown) => { closed = true; return value; }); await pause(); const before = { done, closed };
  held.resolve(); await reading; await closing; expect(before).toEqual({ done: false, closed: false });
});
for (const invalid of ["providerConfigIdentity", "sessionStorageKey", "databaseName", "engine", "detectPlatform", "protectedBinding"] as const) it(`M3a capture validates ${invalid} before any later descriptor and drains the acquired value`, async () => {
  const f = await coldPublishedFixture(), held = deferred<void>(); let acquired = false, later = 0, done = false;
  const nested = invalid === "databaseName" || invalid === "engine";
  const target = nested ? { ...f.options.sqlite, [invalid]: invalid === "engine" ? 17 : held.promise } : { ...f.options, [invalid]: held.promise };
  const input = new Proxy(target, { getOwnPropertyDescriptor(object, key) { if (acquired) later++; if (key === invalid) acquired = true; return Reflect.getOwnPropertyDescriptor(object, key); } });
  const owner = f.make(nested ? { ...f.options, sqlite: input } : input), reading = owner.verify().then((value: unknown) => { done = true; return value; }); await pause(); const before = done;
  held.resolve(); noBinding(await reading); expect(acquired).toBe(true); expect(later).toBe(0); if (invalid !== "engine") expect(before).toBe(false);
});

// M3b1 SQL-only production gate. This harness composes actual existing credential
// drafts/publisher; M3b2's owner/credential/guard integration is not implemented.
async function publishedColdSqlFixture() {
  const f = await coldPublishedFixture(), implementation = await import("../../persistence/installationTransferQuarantineSql"), runtimeModule = await import("../../persistence/nativeCombinedRuntime");
  let alive = true, credentialFault = false;
  const ctx = implementation.createPublishedInstallationSql(f.options.sqlite, () => false);
  const candidate = await ctx.candidate(() => alive), payload = ctx.candidatePayload(candidate)!; expect(payload).not.toBeNull();
  const made = await f.portModule.createPublicationTransferCredentialMigrationPort({ providerConfigIdentity: f.options.providerConfigIdentity, sessionStorageKey: f.options.sessionStorageKey, binding: f.options.protectedBinding, detectPlatform: () => "ios" }, { inventory() {}, slot() {} }, { current: () => alive, owns: value => ctx.ownsCompletion(value), failed: () => { credentialFault = true; } });
  expect(made.ok).toBe(true); if (!made.ok) throw null; const port = made.value, acquired = await port.acquire(); expect(acquired.ok).toBe(true); if (!acquired.ok) throw null;
  const cap = f.portModule.publicationTransferCredentialCapability(port)!, observed = await cap.read(acquired.lease, payload.q, payload.manifest); expect(observed.status).toBe("observed"); if (observed.status !== "observed") throw null;
  const proof = await ctx.verifyBinding(candidate, observed.observation); expect(proof).not.toBeNull();
  const session = runtimeModule.createNativeRuntimeSession(() => { alive = false; }, () => { alive = false; });
  publishedColdCleanups.push(async () => {
    const cleanup = f.portModule.prepareNativeCredentialMigrationCleanup(port, acquired.lease);
    const [sqlReceipt, protectedReceipt] = await Promise.all([ctx.cleanup(), cleanup?.close() ?? Promise.resolve(null)]);
    if (sqlReceipt && ctx.releaseReady(sqlReceipt)) ctx.retire(sqlReceipt);
    if (cleanup && protectedReceipt && cleanup.releaseReady(protectedReceipt)) cleanup.retire(protectedReceipt);
  });
  return { ...f, ctx, candidate, payload, port, cap, observation: observed.observation, lease: acquired.lease, proof, session, runtimeModule, credentialFault: () => credentialFault, revoke() { alive = false; }, current: () => alive };
}
async function publishedSqlRuntimeFixture(activate = true) {
  const f = await publishedColdSqlFixture(), { ctx, port, lease, payload, proof, session, runtimeModule } = f;
  const draft = await ctx.preparePublishedRuntime(proof, session, f.current); expect(draft).not.toBeNull(); if (!draft) throw null;
  let pair: import("../../persistence/nativeCombinedRuntime").NativeCombinedRuntimePair | null = null;
  if (activate) {
    const credential = await f.portModule.prepareTransferIdentityCredentialRuntime(port, value => ctx.ownsCompletion(value), lease, payload.q, payload.manifest, session, draft, f.current); expect(credential).not.toBeNull(); if (!credential) throw null;
    pair = runtimeModule.publishTransferIdentityRuntime(session, draft, credential); expect(pair).not.toBeNull(); if (!pair) throw null; publishedPairs.push(pair);
  }
  return { ...f, draft, pair: pair! };
}
it("M3b1 actual published SQL runtime reads all original Profiles and preserves exact mutable UTF16", async () => {
  const f = await publishedSqlRuntimeFixture(), key = "curling.sporting.profile.v1.90000000-0000-4000-8000-000000000009.curling-release-tracker-session-history", raw = ' { "number":1e0,"text":"\ud800\u0000😀" }\n';
  const rows = await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_sporting_v1 ORDER BY slot" }) as { values: { key: string; value_ascii: string }[] };
  const codec = await import("../../persistence/installationTransferCodeUnits");
  for (const row of rows.values) expect(await f.pair.domain.get(row.key)).toEqual({ status: "value", value: codec.decodeTransferCodeUnits(row.value_ascii) });
  expect(await f.pair.domain.get(key)).toEqual({ status: "value", value: null });
  expect(await f.pair.domain.set(key, raw)).toEqual({ ok: true }); expect(await f.pair.domain.get(key)).toEqual({ status: "value", value: raw });
  expect(await f.pair.domain.remove(key)).toEqual({ ok: true }); expect(await f.pair.domain.get(key)).toEqual({ status: "value", value: null }); expect(await f.pair.domain.remove(key)).toEqual({ ok: true });
  expect(await originalSqlSnapshot(f)).toEqual(f.before); expect(f.credentialFault()).toBe(false); expect(await f.pair.dispose()).toEqual({ ok: true });
});
it("M3b1 live retention is independent of original source row and value budgets", async () => {
  const f = await publishedSqlRuntimeFixture(), key = "curling.sporting.profile.v1.90000000-0000-4000-8000-000000000009.curling-release-tracker-session-history", raw = "x".repeat(3145729);
  await f.sql.raw({ kind: "execute", sql: "WITH RECURSIVE rows(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM rows WHERE n<416) INSERT INTO installation_transfer_live_v1(key,value_ascii) SELECT 'future.'||n,'u16:' FROM rows" });
  const from = f.sql.trace.length; expect(await f.pair.domain.set(key, raw)).toEqual({ ok: true });
  const read = await f.pair.domain.get(key); expect(read.status).toBe("value"); if (read.status !== "value") throw null; expect(read.value?.length).toBe(raw.length); expect(createHash("sha256").update(read.value!, "utf16le").digest("hex")).toBe(createHash("sha256").update(raw, "utf16le").digest("hex"));
  expect(f.sql.trace.slice(from).filter(e => /SELECT.*FROM installation_transfer_live_v1/.test(e.sql ?? "")).every(e => e.sql?.includes("WHERE key=?"))).toBe(true);
  expect(await f.pair.dispose()).toEqual({ ok: true }); const owner = f.make(); expect(await owner.verify()).toMatchObject({ code: "binding_confirmed" });
}, 20000);
it("M3b1 normal identity/live commits preserve an actual held credential storage anchor", async () => {
  const f = await publishedSqlRuntimeFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.h.faults.hook = async (e, next) => { const value = await next(); if (armed && e.kind === "read" && e.key?.startsWith("i1.")) { armed = false; entered.resolve(); await held.promise; } return value; };
  const reading = f.pair.credentials.read(f.options.sessionStorageKey); await entered.promise; const from = f.sql.trace.length;
  expect(await f.pair.domain.set("future.training", " 1e0\n")).toEqual({ ok: true }); expect(await f.pair.domain.set("curling.identity.pendingIntent.v1", "later")).toEqual({ ok: true });
  expect(f.sql.trace.slice(from).some(e => e.kind === "close" || e.kind === "open")).toBe(false); held.resolve(); expect(await reading).toMatchObject({ status: "value" });
  expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" }); expect(await f.pair.dispose()).toEqual({ ok: true });
});
it("M3b1 consumed proof stays invalid after abandon and needs actual positive cleanup before a fresh owner", async () => {
  const f = await publishedSqlRuntimeFixture(false); expect(f.ctx.bindingCurrent(f.proof)).toBe(false); f.draft.abandon();
  expect(f.bindings.readPublishedInstallationBinding(f.proof)).toBeNull(); expect(await f.ctx.candidate(() => true)).toBeNull();
  const next = f.runtimeModule.createNativeRuntimeSession(() => {}, () => {}); expect(await f.ctx.preparePublishedRuntime(f.proof, next, () => true)).toBeNull();
  const sqlReceipt = await f.draft.close(), cleanup = f.portModule.prepareNativeCredentialMigrationCleanup(f.port, f.lease)!; expect(cleanup).not.toBeNull(); const receipt = await cleanup.close();
  expect(sqlReceipt && f.draft.releaseReady(sqlReceipt)).toBe(true); expect(receipt && cleanup.releaseReady(receipt)).toBe(true); if (!sqlReceipt || !receipt) throw null;
  f.draft.retire(sqlReceipt); cleanup.retire(receipt); expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
for (const key of ["curling.identity.unknown", "curling.nativeMigration.test", "curling.credential.test", "curling.installationTransfer.test", "sb-other-auth-token"]) it(`M3b1 refuses reserved key ${key} before native work`, async () => {
  const f = await publishedSqlRuntimeFixture(), from = f.sql.trace.length;
  expect(await f.pair.domain.get(key)).toMatchObject({ status: "read_failed" }); expect(await f.pair.domain.set(key, "x")).toMatchObject({ ok: false }); expect(await f.pair.domain.remove(key)).toMatchObject({ ok: false });
  expect(f.sql.trace).toHaveLength(from); expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" });
});

for (const family of ["identity", "live"] as const) for (const fault of ["begin", "run", "run_ack", "readback", "commit", "commit_ack"] as const) it(`M3b1 ${family} ${fault} failure never publishes mutation success or retries a write`, async () => {
  const f = await publishedSqlRuntimeFixture(), key = family === "identity" ? "curling.identity.pendingIntent.v1" : "future.training", table = family === "identity" ? "installation_transfer_identity_v1" : "installation_transfer_live_v1";
  let armed = true; const from = f.sql.trace.length;
  f.sql.faults.hook = async (e, next) => {
    if (!armed || !(e.kind === (fault.startsWith("commit") ? "commit" : fault === "begin" ? "begin" : "run") && (e.kind !== "run" || e.sql?.includes(table)))) return next();
    armed = false;
    if (["begin", "run", "commit"].includes(fault)) throw null;
    const result = await next();
    if (fault === "readback") { await f.sql.raw({ kind: "run", sql: `UPDATE ${table} SET value_ascii='u16:0062' WHERE key=?`, values: [key] }); return result; }
    return fault === "run_ack" ? { changes: { changes: 2, lastId: 1, values: [] } } : {};
  };
  expect(await f.pair.domain.set(key, "new")).toMatchObject({ ok: false }); expect(armed).toBe(false); expect(f.pair.health().domain).toBe("failed");
  const events = f.sql.trace.slice(from); expect(events.filter(e => e.kind === "run" && e.sql?.includes(table))).toHaveLength(fault === "begin" ? 0 : 1);
  expect(events.filter(e => e.kind === "commit")).toHaveLength(fault.startsWith("commit") ? 1 : 0);
  expect(await f.pair.domain.get(key)).toMatchObject({ status: "read_failed" }); f.sql.faults.hook = undefined;
  expect(await f.pair.dispose()).not.toEqual({ ok: true });
});
for (const kind of ["shape", "value", "multiple"] as const) it(`M3b1 malformed addressed live ${kind} response revokes before granting data`, async () => {
  const f = await publishedSqlRuntimeFixture(); f.sql.faults.hook = async (e, next) => e.sql === "SELECT value_ascii FROM installation_transfer_live_v1 WHERE key=?;" ? kind === "shape" ? { extra: true, values: [] } : { values: kind === "multiple" ? [{ value_ascii: "u16:" }, { value_ascii: "u16:" }] : [{ value_ascii: "u16:XYZ!" }] } : next();
  expect(await f.pair.domain.get("future.training")).toMatchObject({ status: "read_failed" }); expect(f.pair.health().domain).toBe("failed"); f.sql.faults.hook = undefined;
});
for (const kind of ["schema", "source", "receipt"] as const) it(`M3b1 runtime refuses ${kind} drift without repinning or repair`, async () => {
  const f = await publishedSqlRuntimeFixture();
  await f.sql.raw({ kind: "execute", sql: kind === "schema" ? "CREATE TABLE foreign_table(value TEXT)" : kind === "source" ? "UPDATE installation_transfer_source_denial_v1 SET projection_digest='" + "a".repeat(64) + "'" : "UPDATE installation_transfer_publication_v1 SET anchor_digest='" + "a".repeat(64) + "'" });
  const from = f.sql.trace.length; expect(await f.pair.domain.get("future.training")).toMatchObject({ status: "read_failed" });
  expect(f.pair.health()).toMatchObject({ domain: "failed", protocol: "faulted" }); expect(f.sql.trace.slice(from).some(e => ["run", "execute", "begin", "commit"].includes(e.kind))).toBe(false);
});
for (const stage of ["query", "run", "commit"] as const) it(`M3b1 healthy close joins actual ${stage} work and preserves factual SQL outcomes`, async () => {
  const f = await publishedSqlRuntimeFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true, closed = false;
  f.sql.faults.hook = async (e, next) => { const value = await next(); if (armed && e.kind === stage) { armed = false; entered.resolve(); await held.promise; } return value; };
  const writing = stage === "query" ? f.pair.domain.get("future.training") : f.pair.domain.set("future.training", "new"); await entered.promise;
  const closing = f.pair.dispose(); void closing.then(() => { closed = true; }); await pause(); expect(closed).toBe(false); held.resolve();
  expect(await writing).not.toMatchObject({ ok: true }); expect(await closing).toEqual({ ok: true }); f.sql.faults.hook = undefined;
  expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
it("M3b1 close during issued credential work retains conservative evidence-held ownership", async () => {
  const f = await publishedSqlRuntimeFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.h.faults.hook = async (e, next) => { const result = await next(); if (armed && e.kind === "read" && e.key?.startsWith("i1.")) { armed = false; entered.resolve(); await held.promise; } return result; };
  const reading = f.pair.credentials.read(f.options.sessionStorageKey); await entered.promise; const closing = f.pair.dispose(); held.resolve();
  expect(await reading).toMatchObject({ status: "read_failed" }); expect(await closing).toEqual({ ok: false, reason: "evidence_held" }); expect(f.pair.health().credential).toBe("failed");
  noBinding(await f.make().verify()); f.h.faults.hook = undefined;
});
it("M3b1 credential-only failure leaves the existing domain lifetime available for Q1", async () => {
  const f = await publishedSqlRuntimeFixture(); let armed = true;
  f.h.faults.hook = (e, next) => { if (armed && e.kind === "read" && e.key?.startsWith("i1.")) { armed = false; throw null; } return next(); };
  expect(await f.pair.credentials.read(f.options.sessionStorageKey)).toMatchObject({ status: "read_failed" }); expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "failed", protocol: "healthy" });
  expect(await f.pair.domain.set("future.training", "continued")).toEqual({ ok: true }); expect(await f.pair.domain.get("future.training")).toEqual({ status: "value", value: "continued" }); f.h.faults.hook = undefined;
});
for (const operation of ["read", "write", "remove", "anchor", "credential", "cleanup", "dispose"] as const) it(`M3b1 excludes direct actual ${operation} completion at the native SQL edge`, async () => {
  const f = await publishedSqlRuntimeFixture(), connection = await f.sql.options.engine.createConnection(""), query = connection.query, issued: Promise<unknown>[] = []; let armed = true;
  connection.query = ((...args: Parameters<typeof query>) => {
    if (!armed) return Reflect.apply(query, connection, args); armed = false;
    const work = operation === "read" ? f.pair.domain.get("future.other") : operation === "write" ? f.pair.domain.set("future.other", "x") : operation === "remove" ? f.pair.domain.remove("future.other") : operation === "anchor" ? f.draft.anchor() : operation === "credential" ? f.pair.credentials.read(f.options.sessionStorageKey) : operation === "cleanup" ? f.ctx.cleanup() : f.pair.dispose(); issued.push(work); return work;
  }) as never;
  const result = await Promise.race([f.pair.domain.get("future.training"), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]); expect(result).not.toBe("timeout"); expect(result).toMatchObject({ status: "read_failed" });
  connection.query = query; await Promise.all(issued);
});
for (const fake of ["binding", "session"] as const) it(`M3b1 rejects copied/proxied ${fake} before consuming a genuine still-current binding`, async () => {
  const f = await publishedColdSqlFixture(), trap = vi.fn(() => { throw null; }), proxy = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, ownKeys: trap });
  const supplied = fake === "binding" ? f.proof : f.session;
  for (const value of [{}, { ...supplied }, Object.create(supplied), proxy]) expect(await f.ctx.preparePublishedRuntime(fake === "binding" ? value : f.proof, fake === "session" ? value as typeof f.session : f.session, f.current)).toBeNull();
  expect(trap).not.toHaveBeenCalled(); expect(f.ctx.bindingCurrent(f.proof)).toBe(true);
  const draft = await f.ctx.preparePublishedRuntime(f.proof, f.session, f.current); expect(draft?.ready()).toBe(true); draft!.abandon(); expect(f.ctx.bindingCurrent(f.proof)).toBe(false);
});
it("M3b1 pre-consumption healthy refusal permits a genuine fresh observation and new session", async () => {
  const f = await publishedColdSqlFixture(); expect(await f.ctx.preparePublishedRuntime(f.proof, f.session, () => false)).toBeNull(); expect(f.ctx.bindingCurrent(f.proof)).toBe(true);
  const candidate = await f.ctx.candidate(f.current), observed = await f.cap.read(f.lease, f.payload.q, f.payload.manifest); expect(observed.status).toBe("observed"); if (observed.status !== "observed") throw null;
  const proof = await f.ctx.verifyBinding(candidate, observed.observation), next = f.runtimeModule.createNativeRuntimeSession(() => {}, () => {});
  const draft = await f.ctx.preparePublishedRuntime(proof, next, f.current); expect(draft?.ready()).toBe(true); draft!.abandon(); expect(f.ctx.bindingCurrent(proof)).toBe(false);
});
it("M3b1 preparation joins held SQL before one-way consume and rechecks cancellation", async () => {
  const f = await publishedColdSqlFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true, done = false;
  f.sql.faults.hook = async (e, next) => { const result = await next(); if (armed && e.kind === "query") { armed = false; entered.resolve(); await held.promise; } return result; };
  const prepare = f.ctx.preparePublishedRuntime(f.proof, f.session, f.current).then(value => { done = true; return value; }); await entered.promise; expect(done).toBe(false); f.revoke(); held.resolve(); expect(await prepare).toBeNull(); expect(f.ctx.health()).toBe("healthy"); f.sql.faults.hook = undefined;
});

for (const method of ["close", "closeConnection"] as const) it(`M3b1 retries real ${method} cleanup through the retained genuine pair`, async () => {
  const f = await publishedSqlRuntimeFixture(), connection = await f.sql.options.engine.createConnection(""), receiver = method === "close" ? connection : f.sql.options.engine, original = Reflect.get(receiver, method);
  Reflect.set(receiver, method, () => Promise.reject(null)); expect(await f.pair.dispose()).toEqual({ ok: false, reason: "cleanup_unconfirmed" });
  noBinding(await f.make().verify()); Reflect.set(receiver, method, original); expect(await f.pair.dispose()).toEqual({ ok: true }); expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
for (const descriptor of ["get", "set"] as const) it(`M3b1 retains acquired native descriptor ${descriptor} metadata and revokes before its drain`, async () => {
  const f = await publishedSqlRuntimeFixture(), connection = await f.sql.options.engine.createConnection(""), query = connection.query, entered = deferred<void>(), held = deferred<void>(); let invoked = 0, done = false;
  const getter = () => { invoked++; return query; }, setter = () => { invoked++; };
  Object.defineProperty(descriptor === "get" ? getter : setter, "then", { get() { entered.resolve(); return held.promise; } });
  Object.defineProperty(connection, "query", { configurable: true, get: getter, set: setter });
  const reading = f.pair.domain.get("future.training"); await entered.promise; expect(invoked).toBe(0); expect(f.pair.health().domain).toBe("failed");
  const closing = f.pair.dispose().then(value => { done = true; return value; }); await pause(); expect(done).toBe(false); held.resolve();
  expect(await reading).toMatchObject({ status: "read_failed" }); expect(await closing).not.toEqual({ ok: true }); Object.defineProperty(connection, "query", { configurable: true, writable: true, value: query });
});
it("M3b1 final acquired-method drain cannot publish a preparation after owner cancellation", async () => {
  const f = await publishedColdSqlFixture(), connection = await f.sql.options.engine.createConnection(""), query = connection.query; let cancelled = false;
  Object.defineProperty(query, "then", { configurable: true, get() { cancelled = true; f.revoke(); return undefined; } });
  try { expect(await f.ctx.preparePublishedRuntime(f.proof, f.session, f.current)).toBeNull(); expect(cancelled).toBe(true); expect(f.ctx.health()).toBe("healthy"); }
  finally { Reflect.deleteProperty(query, "then"); }
});
for (const drift of ["static", "schema"] as const) it(`M3b1 detects ${drift} change while genuine SQL preparation is held`, async () => {
  const f = await publishedColdSqlFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.sql.faults.hook = async (e, next) => { const result = await next(); if (armed && e.kind === "query") { armed = false; entered.resolve(); await held.promise; } return result; };
  const preparation = f.ctx.preparePublishedRuntime(f.proof, f.session, f.current); await entered.promise;
  await f.sql.raw({ kind: "execute", sql: drift === "schema" ? "CREATE TABLE foreign_table(value TEXT)" : "UPDATE installation_transfer_publication_v1 SET anchor_digest='" + "a".repeat(64) + "'" }); held.resolve();
  expect(await preparation).toBeNull(); expect(f.ctx.health()).toBe("failed"); expect(f.ctx.bindingCurrent(f.proof)).toBe(false); f.sql.faults.hook = undefined;
});
it("M3b1 preserves bounded identity input refusal without limiting ordinary live values", async () => {
  const f = await publishedSqlRuntimeFixture(), from = f.sql.trace.length;
  expect(await f.pair.domain.set("curling.identity.pendingIntent.v1", "x".repeat(1048577))).toMatchObject({ ok: false }); expect(await f.pair.domain.set("future.training", 42 as never)).toMatchObject({ ok: false }); expect(f.sql.trace).toHaveLength(from); expect(f.pair.health().domain).toBe("healthy");
});
it("M3b1 unknown rollback remains failed and cannot reopen or repeat the mutation", async () => {
  const f = await publishedSqlRuntimeFixture(), from = f.sql.trace.length; let issued = false;
  f.sql.faults.hook = async (e, next) => { if (e.kind === "rollback") throw null; const result = await next(); if (!issued && e.kind === "run" && e.sql?.includes("installation_transfer_live_v1")) { issued = true; return {}; } return result; };
  expect(await f.pair.domain.set("future.training", "x")).toMatchObject({ ok: false }); expect(f.pair.health().domain).toBe("failed"); const trace = f.sql.trace.slice(from); expect(trace.filter(e => e.kind === "run")).toHaveLength(1); expect(trace.filter(e => e.kind === "rollback")).toHaveLength(1); expect(trace.filter(e => e.kind === "commit")).toHaveLength(0); f.sql.faults.hook = undefined;
});

for (const method of ["query", "beginTransaction", "run", "commitTransaction", "rollbackTransaction"] as const) it(`M3b1 synchronously thrown ${method} failure revokes the actual runtime`, async () => {
  const f = await publishedSqlRuntimeFixture(), connection = await f.sql.options.engine.createConnection(""), original = Reflect.get(connection, method);
  Reflect.set(connection, method, () => { throw null; });
  if (method === "rollbackTransaction") f.sql.faults.hook = async (e, next) => { const result = await next(); return e.kind === "run" ? {} : result; };
  expect(await f.pair.domain.set("future.training", "x")).toMatchObject({ ok: false }); expect(f.pair.health().domain).toBe("failed");
  Reflect.set(connection, method, original); f.sql.faults.hook = undefined; expect(await f.pair.dispose()).not.toEqual({ ok: true });
});

for (const operation of ["read", "write", "anchor"] as const) it(`M3b1 final runtime drain rechecks currentness before returning ${operation} success`, async () => {
  const f = await publishedSqlRuntimeFixture(), connection = await f.sql.options.engine.createConnection(""), query = connection.query; let cancelled = false;
  Object.defineProperty(query, "then", { configurable: true, get() { cancelled = true; f.revoke(); return undefined; } });
  try {
    const result = await (operation === "read" ? f.pair.domain.get("future.training") : operation === "write" ? f.pair.domain.set("future.training", "new") : f.draft.anchor());
    expect(cancelled).toBe(true); if (operation === "anchor") expect(result).toBeNull(); else expect(result).toMatchObject(operation === "read" ? { status: "read_failed" } : { ok: false });
    if (operation !== "anchor") expect(f.pair.health().lastDomain?.verified).toBe(false);
  } finally { Reflect.deleteProperty(query, "then"); }
});

async function publishedOwnerRuntimeFixture(beforeClose?: Parameters<typeof coldPublishedFixture>[0], raws?: Record<string, string>) {
  const f = await coldPublishedFixture(beforeClose, undefined, true, raws);
  const pair = await f.owner.handoff(); expect(pair).not.toBeNull(); if (!pair) throw null;
  publishedPairs.push(pair); return { ...f, pair };
}
it("M3b2 actual owner renews verification and single-flights a genuine same-store pair without SDK admission", async () => {
  const f = await coldPublishedFixture(); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  const previous = f.publishedBinding(), sdk = await import("@supabase/supabase-js"), init = vi.spyOn(sdk.AuthClient.prototype, "initialize");
  const whole = f.owner.handoff(); expect(f.owner.handoff()).toBe(whole);
  const pair = await whole; expect(pair).not.toBeNull(); if (!pair) throw null; publishedPairs.push(pair);
  expect(f.publishedBinding()).not.toBe(previous); expect(f.bindings.readPublishedInstallationBinding(previous)).toBeNull();
  expect(await f.owner.handoff()).toBe(pair); expect(init).not.toHaveBeenCalled();
  noBinding(await f.owner.verify());
  expect(await pair.domain.set("future.training", " 1e0\n\ud800\u0000😀")).toEqual({ ok: true });
  expect(await pair.domain.get("future.training")).toEqual({ status: "value", value: " 1e0\n\ud800\u0000😀" });
  expect(await pair.credentials.read(f.h.root)).toMatchObject({ status: "value" });
  expect(await f.owner.close()).toMatchObject({ code: "closed" });
  expect(await f.owner.handoff()).toBeNull();
  const fresh = f.make(), next = await fresh.handoff(); expect(next).not.toBeNull(); if (!next) throw null; publishedPairs.push(next);
  expect(await next.domain.get("future.training")).toEqual({ status: "value", value: " 1e0\n\ud800\u0000😀" });
});
it("M3b2 actual new credential store writes/replaces/removes SDK items while preserving immutable publication", async () => {
  const f = await publishedOwnerRuntimeFixture(), before = await originalSqlSnapshot(f), physical = [...f.h.values].filter(([key]) => key.startsWith("t1.") || key.startsWith("m1."));
  const key = f.h.root + "-code-verifier";
  expect(await f.pair.credentials.write(key, JSON.stringify("x".repeat(43)))).toEqual({ ok: true });
  expect(await f.pair.credentials.read(key)).toEqual({ status: "value", value: JSON.stringify("x".repeat(43)) });
  expect(await f.pair.credentials.write(key, JSON.stringify("y".repeat(43)))).toEqual({ ok: true });
  expect(await f.pair.credentials.remove(key)).toMatchObject({ ok: true });
  expect(await f.pair.credentials.read(key)).toEqual({ status: "absent" });
  expect(await originalSqlSnapshot(f)).toEqual(before); expect([...f.h.values].filter(([key]) => key.startsWith("t1.") || key.startsWith("m1."))).toEqual(physical);
  expect(await f.owner.close()).toMatchObject({ code: "closed" });
});

for (const field of ["remove", "failedWriteMayLosePreviousValue"] as const) for (const kind of ["missing", "wrong", "accessor", "pending", "own", "close"] as const) it(`M3b2 ${field} ${kind} never publishes a pair or revives consumed authority`, async () => {
  const f = await coldPublishedFixture(), held = deferred<void>(), getter = vi.fn(), original = Object.getOwnPropertyDescriptor(f.options.protectedBinding!, field)!;
  expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  if (kind === "missing") Reflect.deleteProperty(f.options.protectedBinding!, field);
  else if (kind === "accessor") Object.defineProperty(f.options.protectedBinding!, field, { configurable: true, get: Object.assign(getter, { then: held.promise }) });
  else if (kind === "pending") Object.defineProperty(f.options.protectedBinding!, field, { configurable: true, value: held.promise });
  else if (kind === "own") Object.defineProperty(f.options.protectedBinding!, field, { configurable: true, get: Object.defineProperty(getter, "then", { configurable: true, get() { return whole; } }) });
  else if (kind === "close") Object.defineProperty(f.options.protectedBinding!, field, { configurable: true, get: Object.defineProperty(getter, "then", { configurable: true, get() { return f.owner.close(); } }) });
  else Object.defineProperty(f.options.protectedBinding!, field, { configurable: true, value: "invalid" });
  let done = false, closed = false;
  const whole = f.owner.handoff(); void whole.then(() => { done = true; });
  // Wait until proof consumption/descriptor acquisition, without assuming timing.
  for (let n = 0; n < 200 && !done && f.publishedContext().bindingCurrent(f.publishedBinding()); n++) await pause();
  if (kind === "accessor" || kind === "pending") { await pause(); expect(done).toBe(false); const closing = f.owner.close(); void closing.then(() => { closed = true; }); await pause(); expect(closed).toBe(false); }
  held.resolve(); expect(await whole).toBeNull(); expect(getter).not.toHaveBeenCalled();
  Object.defineProperty(f.options.protectedBinding!, field, original);
  expect(await f.owner.handoff()).toBeNull(); noBinding(await f.owner.verify());
  expect(await f.owner.close()).toMatchObject({ code: "closed" });
  expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
it("M3b2 renewed last-drain currentness retains an actual late credential draft for cleanup", async () => {
  const f = await coldPublishedFixture(), original = Reflect.get(f.options.protectedBinding!, "remove"), held = deferred<void>(), entered = deferred<void>(); let touched = false;
  const remove = Object.defineProperty((...args: unknown[]) => Reflect.apply(original, f.options.protectedBinding, args), "then", { get() { touched = true; entered.resolve(); return held.promise; } });
  Reflect.set(f.options.protectedBinding!, "remove", remove);
  const ports = await import("../../persistence/nativeCredentialMigrationPort"), lookup = ports.publicationTransferCredentialCapability;
  const results: unknown[] = []; vi.spyOn(ports, "publicationTransferCredentialCapability").mockImplementation(port => {
    const cap = lookup(port); return cap ? { ...cap, prepareRuntime(...args) { const value = cap.prepareRuntime(...args); void value.then(result => results.push(result)); return value; } } : cap;
  });
  const whole = f.owner.handoff(); await entered.promise; expect(touched).toBe(true); const closing = f.owner.close(); held.resolve();
  expect(await whole).toBeNull(); expect(results).toHaveLength(1); expect(results[0]).toMatchObject({ kind: "cleanup_required" });
  const draft = (results[0] as { draft: import("../../persistence/nativeCombinedRuntime").NativeRuntimeCredentialDraft }).draft; expect(draft.ready()).toBe(false);
  Reflect.set(f.options.protectedBinding!, "remove", original); expect(await closing).toMatchObject({ code: "closed" }); expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
for (const method of ["read", "write", "remove"] as const) it(`M3b2 owner close during issued credential ${method} preserves conservative failure`, async () => {
  const f = await publishedOwnerRuntimeFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.h.faults.hook = async (e, next) => { const result = await next(); if (armed && e.kind === "read" && e.key?.startsWith("i1.")) { armed = false; entered.resolve(); await held.promise; } return result; };
  const work = method === "read" ? f.pair.credentials.read(f.h.root) : method === "write" ? f.pair.credentials.write(f.h.root + "-code-verifier", JSON.stringify("x".repeat(43))) : f.pair.credentials.remove(f.h.root);
  await entered.promise; const closing = f.owner.close(); held.resolve();
  expect(await work).not.toMatchObject(method === "read" ? { status: "value" } : { ok: true }); expect(await closing).toMatchObject({ code: "fault_held" });
  expect(f.pair.health().credential).toBe("failed"); noBinding(await f.make().verify()); f.h.faults.hook = undefined;
});
it("M3b2 credential failure alone preserves same-session domain/guard lifetime", async () => {
  const f = await publishedOwnerRuntimeFixture(), repo = f.owner.sourceGuardRepository(() => true)!; let armed = true;
  f.h.faults.hook = (e, next) => { if (armed && e.kind === "read" && e.key?.startsWith("i1.")) { armed = false; throw null; } return next(); };
  expect(await f.pair.credentials.read(f.h.root)).toMatchObject({ status: "read_failed" });
  expect(await f.owner.handoff()).toBeNull(); expect(await f.pair.domain.set("future.training", "continued")).toEqual({ ok: true });
  expect(await repo.canAdmit(profileId)).toBe(true); expect(f.owner.sourceGuardRepository(() => true)).not.toBeNull(); f.h.faults.hook = undefined;
});
for (const method of ["close", "closeConnection"] as const) it(`M3b2 owner retries actual unknown ${method} cleanup on the same pair`, async () => {
  const f = await publishedOwnerRuntimeFixture(), connection = await f.sql.options.engine.createConnection(""), receiver = method === "close" ? connection : f.sql.options.engine, original = Reflect.get(receiver, method);
  Reflect.set(receiver, method, () => Promise.reject(null)); expect(await f.owner.close()).toMatchObject({ code: "cleanup_held" });
  noBinding(await f.make().verify()); Reflect.set(receiver, method, original);
  expect(await f.owner.close()).toMatchObject({ code: "closed" }); expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});

const publishedGuardProfile = "10000000-0000-4000-8000-000000000001";
const publishedOtherNonce = "80000000-0000-4000-8000-000000000008";
const publishedGuard = (nonce = sourceNonce, revision = 4) => ({ schemaVersion: 1 as const, profileId: publishedGuardProfile, nonce, revision });
const publishedReceipt = (revision: number, nonce = sourceNonce, profile = publishedGuardProfile) => JSON.stringify({ schemaVersion: 1, profileId: profile, nonce, fencedRevision: revision });
async function publishedGuardFixture(fence: number | null = null) {
  const f = await publishedOwnerRuntimeFixture(undefined, { ...matchingPublicationRaws(), [sourceGuardKey(publishedGuardProfile)]: JSON.stringify(publishedGuard()), ...(fence === null ? {} : { [sourceReceiptKey()]: publishedReceipt(fence) }) });
  const repo = f.owner.sourceGuardRepository(() => true); expect(repo).not.toBeNull(); if (!repo) throw null;
  return { ...f, repo, otherRepo: () => f.owner.sourceGuardRepository(() => true)! };
}
it("M3b2 published guard provenance rejects structural/copied/proxied bindings without reflection", async () => {
  const f = await coldPublishedFixture(); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  const guardModule = await import("../../persistence/installationTransferSourceGuards"), proof = f.publishedBinding(), trap = vi.fn(() => { throw null; });
  expect(guardModule.createPublishedSourceGuardOwner(proof)).not.toBeNull();
  for (const fake of [null, {}, { ...proof }, Object.create(proof), new Proxy(proof, { get: trap, ownKeys: trap, getPrototypeOf: trap })]) expect(guardModule.createPublishedSourceGuardOwner(fake)).toBeNull();
  expect(trap).not.toHaveBeenCalled(); const pair = await f.owner.handoff(); expect(pair).not.toBeNull(); if (pair) publishedPairs.push(pair);
  expect(guardModule.createPublishedSourceGuardOwner(proof)).toBeNull();
});
it("M3b2 actual published guard keeps archived resolution negative and permits only newer actual destination evidence", async () => {
  const f = await publishedGuardFixture(8), before = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" });
  expect(await f.repo.load(publishedGuardProfile)).toEqual({ status: "guard", guard: publishedGuard(), resolved: false });
  expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(false); expect(await f.repo.canAdmit(profileId)).toBe(true);
  for (const revision of [0, 4, 7]) expect(f.repo.acceptControl(publishedGuardProfile, revision)).toBe(false);
  expect(f.repo.acceptControl(publishedGuardProfile, 8)).toBe(true);
  expect(await f.pair.domain.set(sourceReceiptKey(), publishedReceipt(8))).toEqual({ ok: true }); expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(false);
  expect(await f.repo.resolve(publishedGuard(), 8)).toBe(false); expect(await f.repo.resolve(publishedGuard(), 9)).toBe(true);
  expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(false); expect(f.repo.acceptControl(publishedGuardProfile, 9)).toBe(true); expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(true);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" })).toEqual(before);
  expect(await f.owner.close()).toMatchObject({ code: "closed" }); const owner = f.make(), pair = await owner.handoff(); expect(pair).not.toBeNull(); if (!pair) throw null; publishedPairs.push(pair);
  expect(await owner.sourceGuardRepository(() => true)!.canAdmit(publishedGuardProfile)).toBe(true);
});
for (const malformed of ["guard", "conflicting_revision", "receipt", "other_profile", "other_nonce", "future_receipt", "not_newer"] as const) it(`M3b2 actual published guard retains ${malformed} evidence unchanged`, async () => {
  const f = await publishedGuardFixture(); let key = sourceReceiptKey(), raw: string;
  if (malformed === "guard" || malformed === "conflicting_revision") { key = sourceGuardKey(publishedGuardProfile); raw = malformed === "guard" ? "{" : JSON.stringify(publishedGuard(sourceNonce, 7)); }
  else raw = malformed === "receipt" ? "{" : malformed === "other_profile" ? publishedReceipt(8, sourceNonce, profileId) : malformed === "other_nonce" ? publishedReceipt(8, publishedOtherNonce) : malformed === "future_receipt" ? JSON.stringify({ ...JSON.parse(publishedReceipt(8)), schemaVersion: 2 }) : publishedReceipt(4);
  expect(await f.pair.domain.set(key, raw)).toEqual({ ok: true }); const from = f.sql.trace.length;
  expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(false); expect(await f.repo.resolve(publishedGuard(), 9)).toBe(false); expect(await f.repo.begin(publishedGuardProfile, 10, publishedOtherNonce)).toBeNull();
  expect(f.sql.trace.slice(from).some(e => e.kind === "begin")).toBe(false); expect(await f.pair.domain.get(key)).toEqual({ status: "value", value: raw });
});
it("M3b2 original and newer destination guards both require actual resolution", async () => {
  const f = await publishedGuardFixture(); expect(await f.pair.domain.set(sourceGuardKey(publishedGuardProfile), JSON.stringify(publishedGuard(publishedOtherNonce, 7)))).toEqual({ ok: true });
  expect(await f.repo.resolve(publishedGuard(publishedOtherNonce, 7), 10)).toBe(false); expect(await f.repo.resolve(publishedGuard(), 8)).toBe(true);
  expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(false); expect(await f.repo.resolve(publishedGuard(publishedOtherNonce, 7), 9)).toBe(true);
  expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(true);
});
it("M3b2 shared monotonic observed floors reject stale controls and old matching receipts", async () => {
  const f = await publishedGuardFixture(), caller = f.otherRepo(); expect(caller.acceptControl(publishedGuardProfile, 5)).toBe(true);
  expect(await f.repo.resolve(publishedGuard(), 9)).toBe(true); expect(await caller.canAdmit(publishedGuardProfile)).toBe(false);
  expect(await caller.resolve(publishedGuard(), 10)).toBe(false); expect(caller.acceptControl(publishedGuardProfile, 9)).toBe(true);
  expect(await f.pair.domain.set(sourceReceiptKey(), publishedReceipt(6))).toEqual({ ok: true }); expect(await caller.canAdmit(publishedGuardProfile)).toBe(false);
  expect(await f.repo.resolve(publishedGuard(), 8)).toBe(false); expect(await f.repo.resolve(publishedGuard(), 10)).toBe(true);
});
it("M3b2 new guard begins only after original resolution, and host loss restricts every repository", async () => {
  const f = await publishedGuardFixture(); let alive = true; const restricted = f.owner.sourceGuardRepository(() => alive)!;
  expect(await f.repo.begin(publishedGuardProfile, 8, publishedOtherNonce)).toBeNull(); expect(await f.repo.resolve(publishedGuard(), 8)).toBe(true);
  expect(await f.repo.begin(publishedGuardProfile, 9, sourceNonce)).toBeNull(); expect(await f.repo.begin(publishedGuardProfile, 9, publishedOtherNonce)).toEqual(publishedGuard(publishedOtherNonce, 9));
  expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(false); expect(await f.repo.canAdmit(profileId)).toBe(true);
  alive = false; expect(restricted.acceptControl(profileId, 10)).toBe(false); expect(await restricted.load(profileId)).toEqual({ status: "unavailable" }); expect(await restricted.resolve(publishedGuard(), 10)).toBe(false);
});
it("M3b2 real published guard shares mutation claims across repositories and holds unrelated SQL work", async () => {
  const f = await publishedGuardFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true, done = false;
  f.sql.faults.hook = async (e, next) => { if (armed && e.kind === "query") { armed = false; entered.resolve(); await held.promise; } return next(); };
  const whole = f.repo.resolve(publishedGuard(), 9); void whole.then(() => { done = true; }); await entered.promise; const other = f.otherRepo();
  expect(other.acceptControl(publishedGuardProfile, 10)).toBe(false); expect(await other.resolve(publishedGuard(), 10)).toBe(false); expect(await other.begin(publishedGuardProfile, 10, publishedOtherNonce)).toBeNull(); expect(await other.load(publishedGuardProfile)).toEqual({ status: "unavailable" }); expect(await other.canAdmit(publishedGuardProfile)).toBe(false);
  expect(done).toBe(false); held.resolve(); expect(await whole).toBe(true); f.sql.faults.hook = undefined;
  expect(await other.resolve(publishedGuard(), 8)).toBe(false); expect(await other.resolve(publishedGuard(), 10)).toBe(true);
});
for (const method of ["load", "canAdmit", "resolve", "begin"] as const) it(`M3b2 actual published guard excludes direct ${method} completion at SQL edge`, async () => {
  const f = await publishedGuardFixture(), connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  connection.query = (() => whole) as never;
  const whole = method === "load" ? f.repo.load(publishedGuardProfile) : method === "canAdmit" ? f.repo.canAdmit(publishedGuardProfile) : method === "resolve" ? f.repo.resolve(publishedGuard(), 8) : f.repo.begin(profileId, 4, publishedOtherNonce);
  const result = await Promise.race([whole.then((value: unknown) => ({ value })), new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(result).not.toBeNull(); expect(result?.value).toEqual(method === "load" ? { status: "unavailable" } : method === "begin" ? null : false); connection.query = query;
});

for (const fake of ["observation", "lease", "session", "old_observation"] as const) it(`M3b2 publication preparation refuses ${fake} before descriptor/native work`, async () => {
  const f = await publishedColdSqlFixture(), domain = await f.ctx.preparePublishedRuntime(f.proof, f.session, f.current); expect(domain).not.toBeNull(); if (!domain) throw null;
  if (fake === "old_observation") expect((await f.cap.read(f.lease, f.payload.q, f.payload.manifest)).status).toBe("observed");
  const before = f.h.events.length, trap = vi.fn(() => { throw null; }), proxy = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, getPrototypeOf: trap });
  for (const substitute of fake === "old_observation" ? [f.observation] : [proxy, {}, { ...(fake === "observation" ? f.observation : fake === "lease" ? f.lease : f.session) }]) {
    expect(await f.cap.prepareRuntime(fake === "lease" ? substitute as typeof f.lease : f.lease, fake === "observation" || fake === "old_observation" ? substitute : f.observation, fake === "session" ? substitute as typeof f.session : f.session, domain, f.current)).toBeNull();
  }
  expect(trap).not.toHaveBeenCalled(); expect(f.h.events).toHaveLength(before);
});
it("M3b2 healthy pre-consumption refusal permits a wholly fresh attempt on the same actual owner", async () => {
  const f = await coldPublishedFixture(); expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" });
  const ctx = f.publishedContext(), runtimeModule = await import("../../persistence/nativeCombinedRuntime"), create = runtimeModule.createNativeRuntimeSession;
  const spy = vi.spyOn(runtimeModule, "createNativeRuntimeSession").mockImplementation((...args) => { const session = create(...args); runtimeModule.abandonNativeRuntimeSession(session); return session; });
  expect(await f.owner.handoff()).toBeNull(); expect(ctx.bindingCurrent(f.publishedBinding())).toBe(true); spy.mockRestore();
  const pair = await f.owner.handoff(); expect(pair).not.toBeNull(); if (pair) publishedPairs.push(pair); expect(await f.owner.close()).toMatchObject({ code: "closed" });
});
for (const lane of ["sql", "protected", "hash"] as const) it(`M3b2 close during genuine ${lane} verification drains healthy work without a pair`, async () => {
  const f = await coldPublishedFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true, closed = false;
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query;
  if (lane === "sql") connection.query = ((...args: Parameters<typeof query>) => Promise.resolve(Reflect.apply(query, connection, args)).then(async value => { if (armed) { armed = false; entered.resolve(); await held.promise; } return value; })) as never;
  if (lane === "protected") f.h.faults.hook = async (e, next) => { const value = await next(); if (armed && e.kind === "read" && e.key?.startsWith("t1.")) { armed = false; entered.resolve(); await held.promise; } return value; };
  if (lane === "hash") vi.stubGlobal("crypto", { subtle: { digest: async (...args: Parameters<typeof webcrypto.subtle.digest>) => { if (armed) { armed = false; entered.resolve(); await held.promise; } return Reflect.apply(webcrypto.subtle.digest, webcrypto.subtle, args); } } });
  const work = f.owner.handoff(); await entered.promise; const closing = f.owner.close(); void closing.then(() => { closed = true; }); await pause(); expect(closed).toBe(false);
  held.resolve(); expect(await work).toBeNull(); expect(await closing).toMatchObject({ code: "closed" }); connection.query = query; f.h.faults.hook = undefined; vi.stubGlobal("crypto", webcrypto);
  expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
for (const operation of ["handoff", "close"] as const) for (const lane of ["sql", "protected"] as const) it(`M3b2 direct owner ${operation} at ${lane} edge cannot deadlock or grant`, async () => {
  const f = await coldPublishedFixture(), connection = await f.sql.options.engine.createConnection(""), query = connection.query; let armed = true;
  const issue = () => operation === "handoff" ? whole : f.owner.close();
  if (lane === "sql") connection.query = ((...args: Parameters<typeof query>) => { if (armed) { armed = false; return issue(); } return Reflect.apply(query, connection, args); }) as never;
  else f.options.protectedBinding = { ...f.h.binding, read(key: string) { if (armed && key.startsWith("t1.")) { armed = false; return issue(); } return f.h.binding.read(key); } };
  const whole = f.owner.handoff(), result = await Promise.race([whole.then((value: unknown) => ({ value })), new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(result).toEqual({ value: null }); connection.query = query; f.h.faults.hook = undefined; await f.owner.close();
});
for (const ref of ["get", "set", "both"] as const) it(`M3b2 reentrant descriptor close retains acquired ${ref} references and cuts off later fields`, async () => {
  const f = await coldPublishedFixture(), held = deferred<void>(), entered = deferred<void>(), accessor = vi.fn(), setter = vi.fn(); let armed = true, later = 0, closed = false;
  if (ref !== "set") Object.defineProperty(accessor, "then", { value: held.promise });
  if (ref !== "get") Object.defineProperty(setter, "then", { value: held.promise });
  f.options.protectedBinding = new Proxy(f.options.protectedBinding!, { getOwnPropertyDescriptor(target, name) {
    if (name === "failedWriteMayLosePreviousValue") later++;
    if (name === "remove" && armed) { armed = false; entered.resolve(); void f.owner.close().then(() => { closed = true; }); return { configurable: true, get: accessor, set: setter }; }
    return Reflect.getOwnPropertyDescriptor(target, name);
  } });
  const work = f.owner.handoff(); await entered.promise; await pause(); expect(closed).toBe(false); expect(later).toBe(0); expect(accessor).not.toHaveBeenCalled(); expect(setter).not.toHaveBeenCalled();
  held.resolve(); expect(await work).toBeNull(); expect(await f.owner.close()).toMatchObject({ code: "closed" }); expect(later).toBe(0);
});

it("M3b2 actual new credential anchor survives ordinary identity and live writes", async () => {
  const f = await publishedOwnerRuntimeFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true;
  f.h.faults.hook = async (e, next) => { const result = await next(); if (armed && e.kind === "read" && e.key?.startsWith("i1.")) { armed = false; entered.resolve(); await held.promise; } return result; };
  const reading = f.pair.credentials.read(f.h.root); await entered.promise; const from = f.sql.trace.length;
  expect(await f.pair.domain.set("future.training", "continued")).toEqual({ ok: true }); expect(await f.pair.domain.set("curling.identity.pendingIntent.v1", "later")).toEqual({ ok: true });
  expect(f.sql.trace.slice(from).some(e => e.kind === "open" || e.kind === "close")).toBe(false); held.resolve(); expect(await reading).toMatchObject({ status: "value" });
  expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" }); expect(await f.owner.close()).toMatchObject({ code: "closed" });
});
for (const phase of ["query", "run", "commit"] as const) it(`M3b2 owner closes healthy pending SQL ${phase} with actual receipts`, async () => {
  const f = await publishedOwnerRuntimeFixture(), entered = deferred<void>(), held = deferred<void>(); let armed = true, closed = false;
  f.sql.faults.hook = async (e, next) => { const result = await next(); if (armed && e.kind === phase && (phase !== "query" || e.sql?.includes("WHERE key=?"))) { armed = false; entered.resolve(); await held.promise; } return result; };
  const work = phase === "query" ? f.pair.domain.get("future.training") : f.pair.domain.set("future.training", "late"); await entered.promise;
  const closing = f.owner.close(); void closing.then(() => { closed = true; }); await pause(); expect(closed).toBe(false); held.resolve();
  expect(await work).not.toMatchObject(phase === "query" ? { status: "value" } : { ok: true }); expect(await closing).toMatchObject({ code: "closed" }); f.sql.faults.hook = undefined;
  expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
it("M3b2 published negative floors remain separate for multiple original Profiles", async () => {
  const third = "90000000-0000-4000-8000-000000000009", thirdNonce = "70000000-0000-4000-8000-000000000007";
  const f = await publishedOwnerRuntimeFixture(undefined, { ...matchingPublicationRaws(), ...Object.fromEntries(Object.entries(basic()).map(([key, value]) => [key.replace(publishedGuardProfile, third), value])), [sourceGuardKey(publishedGuardProfile)]: JSON.stringify(publishedGuard()), [sourceGuardKey(third)]: sourceGuard(third, thirdNonce, 7) });
  const repo = f.owner.sourceGuardRepository(() => true)!; expect(await repo.canAdmit(publishedGuardProfile)).toBe(false); expect(await repo.canAdmit(third)).toBe(false);
  expect(await repo.resolve(publishedGuard(), 9)).toBe(true); expect(await repo.canAdmit(publishedGuardProfile)).toBe(true); expect(await repo.canAdmit(third)).toBe(false);
  expect(repo.acceptControl(third, 6)).toBe(false); expect(repo.acceptControl(third, 7)).toBe(true);
  expect(await repo.resolve({ schemaVersion: 1, profileId: third, nonce: thirdNonce, revision: 7 }, 8)).toBe(true); expect(repo.acceptControl(third, 8)).toBe(true); expect(await repo.canAdmit(third)).toBe(true);
  expect(await repo.canAdmit(publishedGuardProfile)).toBe(true);
});

async function publishedStaleReceiptFixture(different: boolean) {
  const f = await publishedGuardFixture(), guard = different ? publishedGuard(publishedOtherNonce, 7) : publishedGuard();
  if (different) {
    expect(await f.pair.domain.set(sourceGuardKey(publishedGuardProfile), JSON.stringify(guard))).toEqual({ ok: true });
    expect(await f.repo.resolve(publishedGuard(), 8)).toBe(true);
  }
  expect(await f.repo.resolve(guard, 10)).toBe(true); expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(true);
  expect(await f.pair.domain.set(sourceReceiptKey(guard.nonce), publishedReceipt(9, guard.nonce))).toEqual({ ok: true });
  expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(false); return { ...f, guard };
}
for (const different of [false, true]) {
  it(`M3b2 corrected stale receipt retains exact unresolved guard with differentNonce=${different}`, async () => {
    const f = await publishedStaleReceiptFixture(different);
    expect(await f.repo.load(publishedGuardProfile)).toEqual({ status: "guard", guard: f.guard, resolved: false });
    expect(f.repo.acceptControl(publishedGuardProfile, 9)).toBe(false); expect(await f.repo.resolve(f.guard, 11)).toBe(false);
    expect(f.repo.acceptControl(publishedGuardProfile, 11)).toBe(true);
    expect(await f.repo.resolve(f.guard, 10)).toBe(false); expect(await f.repo.resolve(f.guard, 11)).toBe(true);
    expect(await f.repo.canAdmit(publishedGuardProfile)).toBe(true); expect(await f.repo.canAdmit(profileId)).toBe(true);
  });
  it(`M3b2 corrected actual mapper obtains a higher real fence with differentNonce=${different}`, async () => {
    const f = await publishedStaleReceiptFixture(different), mapper = await import("../supabaseAccountDeletionService");
    const rpc = vi.fn(async (name: string) => ({ data: name === "get_my_account_deletion_control" ? { profile_id: publishedGuardProfile, revision: 11, pending: null } : 12, error: null }));
    const service = mapper.createSupabaseAccountDeletionService({ rpc }, f.repo, () => publishedOtherNonce, new Set(), undefined, p => p === publishedGuardProfile, (p, r) => f.repo.acceptControl(p, r));
    expect(await service.getState()).toEqual({ ok: true, value: null, recoveredProfileId: publishedGuardProfile });
    expect(rpc.mock.calls.map(call => call[0])).toEqual(["get_my_account_deletion_control", "abort_my_uncommitted_account_deletion"]);
    expect(await f.pair.domain.get(sourceReceiptKey(f.guard.nonce))).toEqual({ status: "value", value: publishedReceipt(12, f.guard.nonce) });
    // This call observed Control11 before obtaining Fence12. Its old control
    // must be renewed; independent Profile repositories retain their lifetime.
    expect(await f.otherRepo().canAdmit(profileId)).toBe(true);
    expect(f.repo.acceptControl(publishedGuardProfile, 12)).toBe(true); expect(await f.repo.canAdmit(profileId)).toBe(true);
  });
}

it("M3c same-realm root fence refuses a second actual SDK after positive source disposal", async () => {
  const f = await coldPublishedFixture(), sdk = await import("@supabase/supabase-js"), init = vi.spyOn(sdk.AuthClient.prototype, "initialize");
  const made = await f.h.module.createConfiguredPublishedInstallationIdentityHost(f.binding, { ...f.options, migration: { ...f.h.options.migration, sqlite: f.sql.options }, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl() {} }, fetch: f.h.fetch });
  expect(made.ok).toBe(true); if (!made.ok) throw null; hosts.push(made.host);
  expect(await made.host.start()).toEqual({ outcome: "waiting", code: "restart_required" }); expect(init).not.toHaveBeenCalled();
  expect(await made.host.dispose()).toEqual({ ok: true }); expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
async function publishedChild(f: { sql: Awaited<ReturnType<typeof setup>>; h: Awaited<ReturnType<typeof fixture>> }, extra: Record<string, unknown> = {}, next?: string) {
  const fs = await import("node:fs/promises"), path = await import("node:path"), os = await import("node:os"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const directory = next ? null : await fs.mkdtemp(path.join(os.tmpdir(), "curling-published-child-")), file = next ?? path.join(directory!, "synthetic.json");
  if (!next) await fs.writeFile(file, JSON.stringify({ syntheticOnly: true, parentPid: process.pid, file: f.sql.file, databaseName: f.sql.options.databaseName, protectedValues: [...f.h.values], config: f.h.options.config, facts: facts(true), limits: f.h.options.migration.limits, writeSessionId: "synthetic-cold-training-one", ...extra }));
  else { const previous = JSON.parse(await fs.readFile(file, "utf8")); await fs.writeFile(file, JSON.stringify({ ...previous, ...extra })); }
  publishedColdCleanups.push(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }); });
  const child = await promisify(execFile)(process.execPath, ["tests/native/publishedInstallationHostChild.mjs", file], { cwd: process.cwd(), timeout: 30000, maxBuffer: 256 * 1024 });
  expect(child.stdout).toBe("PUBLISHED_HOST_CHILD_PASS\n"); expect(child.stderr).toBe("");
  const saved = JSON.parse(await fs.readFile(file, "utf8")); expect(saved.childResult.pid).not.toBe(process.pid); return { file, saved };
}
it("M3c real new-PID normal host and actual SDK continue the same published SQLite and protected state cold", async () => {
  const f = await coldPublishedFixture(), first = await publishedChild(f, { renewWithOtp: true });
  expect(first.saved.childResult).toMatchObject({ initializes: 1, startup: "ready_online", cleanup: { ok: true } }); expect(first.saved.childResult.protectedWrites).toBeGreaterThan(0);
  const second = await publishedChild(f, { expectSessionId: "synthetic-cold-training-one", writeSessionId: "synthetic-cold-training-two" }, first.file);
  expect(second.saved.childResult.pid).not.toBe(first.saved.childResult.pid); expect(second.saved.childResult).toMatchObject({ initializes: 1, startup: "ready_online", cleanup: { ok: true } });
  expect(second.saved.protectedValues.filter(([key]: [string, string]) => key.startsWith("t1.") || key.startsWith("m1."))).toEqual([...f.h.values].filter(([key]) => key.startsWith("t1.") || key.startsWith("m1.")));
  await f.sql.raw({ kind: "open" }); const after = await originalSqlSnapshot(f); await f.sql.raw({ kind: "close" });
  expect(after.schema).toEqual(f.before.schema); expect(after.rows.filter((_row, index) => index !== 5)).toEqual(f.before.rows.filter((_row, index) => index !== 5));
}, 60000);

function publishedHostInput(f: Awaited<ReturnType<typeof coldPublishedFixture>>, protectedBinding = f.h.binding) {
  return { migration: { ...f.h.options.migration, sqlite: f.sql.options, protectedBinding }, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl() {} }, fetch: f.h.fetch };
}
for (const completion of ["start", "dispose"] as const) for (const lane of ["sql", "protected"] as const) it(`M3c exact actual host ${completion} at ${lane} native edge never cycles or grants`, async () => {
  const f = await coldPublishedFixture(), input = publishedHostInput(f), sdk = await import("@supabase/supabase-js"), init = vi.spyOn(sdk.AuthClient.prototype, "initialize");
  const connection = await f.sql.options.engine.createConnection(""), query = connection.query; let armed = true;
  if (lane === "sql") connection.query = ((...args: Parameters<typeof query>) => { if (armed) { armed = false; return host[completion](); } return Reflect.apply(query, connection, args); }) as never;
  else input.migration.protectedBinding = { ...f.h.binding, read(key: string) { if (armed && key.startsWith("t1.")) { armed = false; return host[completion]() as never; } return f.h.binding.read(key); } };
  const made = await f.h.module.createConfiguredPublishedInstallationIdentityHost(f.binding, input); expect(made.ok).toBe(true); if (!made.ok) throw null; const host = made.host; hosts.push(host);
  const result = await Promise.race([host.start(), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(result).not.toBe("timeout"); expect(result).not.toMatchObject({ outcome: "ready" }); expect(init).not.toHaveBeenCalled(); connection.query = query; await host.dispose();
});
it("M3c actual configured binding and held SDK reserve refuse before foreign input reads", async () => {
  const f = await preparedSqlPublication(), trap = vi.fn(() => { throw null; }), proxy = new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap, ownKeys: trap });
  for (const fake of [{}, { ...f.binding }, Object.create(f.binding), new Proxy(f.binding, { get: trap })]) expect(await f.h.module.createConfiguredPublishedInstallationIdentityHost(fake, proxy as never)).toEqual({ ok: false, reason: "invalid_configuration" });
  expect(await f.h.module.createConfiguredPublishedInstallationIdentityHost(f.binding, proxy as never)).toEqual({ ok: false, reason: "ownership_conflict" }); expect(trap).not.toHaveBeenCalled();
});
it("M3c actual SDK-only-held disposal cannot be bypassed by published store proof", async () => {
  const f = await coldPublishedFixture(async () => { const sdk = await import("@supabase/supabase-js"); vi.spyOn(sdk.AuthClient.prototype, "dispose").mockRejectedValue(null); }, undefined, false);
  expect(await f.owner.verify()).toMatchObject({ code: "binding_confirmed" }); expect(await f.owner.close()).toMatchObject({ code: "closed" });
  const trap = vi.fn(() => { throw null; }); expect(await f.h.module.createConfiguredPublishedInstallationIdentityHost(f.binding, new Proxy({}, { get: trap }) as never)).toEqual({ ok: false, reason: "ownership_conflict" }); expect(trap).not.toHaveBeenCalled();
});
it("M3c actual changed configured identity refuses the published pair without new SDK or protected writes", async () => {
  const f = await coldPublishedFixture(), config = await import("../nativeProviderConfiguration"), sdk = await import("@supabase/supabase-js"), init = vi.spyOn(sdk.AuthClient.prototype, "initialize");
  const changed = await config.prepareNativeProviderConfiguration({ ...f.h.options.config, url: "https://different-published.supabase.invalid" }); expect(changed.ok).toBe(true); if (!changed.ok) throw null;
  const before = [...f.h.values], made = await f.h.module.createConfiguredPublishedInstallationIdentityHost(changed.value, publishedHostInput(f)); expect(made.ok).toBe(true); if (!made.ok) throw null; hosts.push(made.host);
  expect(await made.host.start()).toEqual({ outcome: "waiting", code: "handoff_refused" }); expect(init).not.toHaveBeenCalled(); expect([...f.h.values]).toEqual(before); expect(await made.host.dispose()).toEqual({ ok: true });
});
for (const closingPath of ["owner", "pair"] as const) for (const phase of ["before", "after"] as const) it(`M3c ${closingPath} disposal joins actual ${phase}-IO policy before store close`, async () => {
  const f = await publishedOwnerRuntimeFixture(), held = deferred<boolean>(), entered = deferred<void>(); let calls = 0, closed = false;
  const repo = f.owner.sourceGuardRepository(() => true, async () => { calls++; if (calls === (phase === "before" ? 1 : 2)) { entered.resolve(); return await held.promise; } return true; })!;
  const work = repo.load(profileId); await entered.promise; const from = f.sql.trace.length;
  const closing = closingPath === "owner" ? f.owner.close() : f.pair.dispose(); void closing.then(() => { closed = true; }); await pause();
  expect(closed).toBe(false); expect(f.sql.trace.slice(from).some(e => e.kind === "close")).toBe(false);
  held.resolve(true); expect(await work).toEqual({ status: "unavailable" }); expect(await closing).toMatchObject(closingPath === "owner" ? { code: "closed" } : { ok: true });
  expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});
for (const failure of ["false", "throw", "after"] as const) it(`M3c own-domain effects ${failure} refuses closed and never bypasses original guards`, async () => {
  const f = await publishedGuardFixture(), from = f.sql.trace.length; let calls = 0;
  const repo = f.owner.sourceGuardRepository(() => true, async () => { calls++; if (failure === "throw") throw null; return failure === "after" ? calls === 1 : false; })!;
  expect(await repo.load(publishedGuardProfile)).toEqual({ status: "unavailable" }); expect(await repo.canAdmit(publishedGuardProfile)).toBe(false);
  if (failure !== "after") expect(f.sql.trace).toHaveLength(from);
  expect(f.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy" }); expect(await f.owner.close()).toMatchObject({ code: "closed" });
});
for (const operation of ["owner", "pair", "drain"] as const) it(`M3c actual ${operation} completion at guarded SQL edge cannot become its own drain prerequisite`, async () => {
  const f = await coldPublishedFixture(), runtimeModule = await import("../../persistence/nativeCombinedRuntime"), publish = runtimeModule.publishPublishedInstallationRuntime;
  let drain: (() => Promise<void>) | undefined;
  vi.spyOn(runtimeModule, "publishPublishedInstallationRuntime").mockImplementation((session, domain, credential, callback) => { drain = callback; return publish(session, domain, credential, callback); });
  const pair = await f.owner.handoff(); expect(pair).not.toBeNull(); if (!pair) throw null; publishedPairs.push(pair);
  const repo = f.owner.sourceGuardRepository(() => true, async () => true)!, connection = await f.sql.options.engine.createConnection(""), query = connection.query; let armed = true;
  connection.query = ((...args: Parameters<typeof query>) => { if (armed) { armed = false; return operation === "owner" ? f.owner.close() : operation === "pair" ? pair.dispose() : drain!(); } return Reflect.apply(query, connection, args); }) as never;
  const result = await Promise.race([repo.load(profileId), new Promise(resolve => setTimeout(() => resolve("timeout"), 1000))]);
  expect(result).toEqual({ status: "unavailable" }); connection.query = query; await f.owner.close();
});
it("M3c actual private drain failure retains resources until same-pair healthy cleanup retry", async () => {
  const f = await coldPublishedFixture(), runtimeModule = await import("../../persistence/nativeCombinedRuntime"), publish = runtimeModule.publishPublishedInstallationRuntime; let fail = true;
  vi.spyOn(runtimeModule, "publishPublishedInstallationRuntime").mockImplementation((session, domain, credential, callback) => publish(session, domain, credential, async () => { if (fail) throw null; await callback!(); }));
  const pair = await f.owner.handoff(); expect(pair).not.toBeNull(); if (!pair) throw null; publishedPairs.push(pair); const from = f.sql.trace.length;
  expect(await f.owner.close()).toMatchObject({ code: "cleanup_held" }); expect(f.sql.trace.slice(from).some(e => e.kind === "close")).toBe(false); noBinding(await f.make().verify());
  fail = false; expect(await f.owner.close()).toMatchObject({ code: "closed" }); expect(await f.make().verify()).toMatchObject({ code: "binding_confirmed" });
});

it("M3c new-PID actual fresh OTP can admit a later legitimate Profile outside original t1 membership", async () => {
  const f = await coldPublishedFixture(async f => { expect(await f.pair.credentials.remove(f.h.root)).toMatchObject({ ok: true }); });
  const future = "90000000-0000-4000-8000-000000000009", first = await publishedChild(f, { needFreshOtp: true, expectedStartup: "locked", currentProfile: future, currentAccount: "99999999-9999-4999-8999-999999999999" });
  expect(first.saved.childResult.requests).toContain("verify");
  const second = await publishedChild(f, { needFreshOtp: false, expectSessionId: "synthetic-cold-training-one", writeSessionId: "synthetic-cold-training-two" }, first.file);
  expect(second.saved.childResult.startup).toBe("ready_online");
}, 60000);
it("M3c new-PID actual Tracker preserves Q1 extra blocks while a new Session remains blocked", async () => {
  const f = await coldPublishedFixture(), result = await publishedChild(f, { credentialContinuation: true });
  expect(result.saved.childResult.cleanup).toEqual({ ok: false, reason: "evidence_held" });
}, 30000);

for (const refusal of ["null", "throw"] as const) it(`M3c genuine published hook ${refusal} cannot fall back to ordinary guards at actual cold startup`, async () => {
  const f = await coldPublishedFixture(), result = await publishedChild(f, { refusePublishedGuard: refusal, expectWait: "identity_failed", expectedInitializes: 1 });
  expect(result.saved.childResult.cleanup).toEqual({ ok: true });
}, 30000);
it("M3c actual cold normal account request/cancel retains effects and current admission boundaries", async () => {
  const f = await coldPublishedFixture(), result = await publishedChild(f, { accountRequest: true });
  expect(result.saved.childResult.requests).toContain("request_my_account_deletion"); expect(result.saved.childResult.requests).toContain("cancel_my_account_deletion");
}, 30000);
for (const invalid of ["config", "t1", "manifest"] as const) it(`M3c actual cold ${invalid} contradiction never constructs a new SDK`, async () => {
  const f = await coldPublishedFixture();
  if (invalid !== "config") { const key = [...f.h.values.keys()].find(key => key.startsWith(invalid === "t1" ? "t1." : "m1."))!; f.h.values.delete(key); }
  const result = await publishedChild(f, { ...(invalid === "config" ? { config: { ...f.h.options.config, url: "https://different-child.supabase.invalid" } } : {}), expectWait: "handoff_refused", expectedHeld: invalid !== "config" });
  expect(result.saved.childResult.initializes).toBe(0); expect(result.saved.childResult.protectedWrites).toBe(0);
}, 30000);

for (const lowControl of [false, true]) it(`M3c actual cold source guard recovery binds real per-call Control with lowControl=${lowControl}`, async () => {
  const f = await coldPublishedFixture(undefined, undefined, true, { ...matchingPublicationRaws(), [sourceGuardKey(publishedGuardProfile)]: JSON.stringify(publishedGuard()), [sourceReceiptKey()]: publishedReceipt(8) });
  const result = await publishedChild(f, { currentProfile: publishedGuardProfile, currentAccount: "99999999-9999-4999-8999-999999999999", guardedRecovery: true, lowControl, revision: lowControl ? 7 : 8 });
  expect(result.saved.childResult.requests).toContain("abort_my_uncommitted_account_deletion");
}, 30000);

it("M3c actual new SDK initialization close joins issued protected work and retains evidence", async () => {
  const f = await coldPublishedFixture(), result = await publishedChild(f, { closeDuringInit: true });
  expect(result.saved.childResult).toMatchObject({ initializes: 1, cleanup: { ok: false, reason: "evidence_held" } });
}, 30000);
it("M3c actual new SDK terminal disposal failure retains reservation after store cleanup", async () => {
  const f = await coldPublishedFixture(), result = await publishedChild(f, { failTerminalSdk: true });
  expect(result.saved.childResult.cleanup).toEqual({ ok: false, reason: "cleanup_unconfirmed" });
}, 30000);
it("M3c actual new SDK stop failure never admits and keeps cleanup uncertainty", async () => {
  const f = await coldPublishedFixture(), result = await publishedChild(f, { failStop: true, expectWait: "sdk_failed", expectedInitializes: 1, expectedCleanup: { ok: false, reason: "cleanup_unconfirmed" } });
  expect(result.saved.childResult.initializes).toBe(1);
}, 30000);
it("M3c actual pending deletion remains factual even with refused original Control floor", async () => {
  const f = await coldPublishedFixture(undefined, undefined, true, { ...matchingPublicationRaws(), [sourceGuardKey(publishedGuardProfile)]: JSON.stringify(publishedGuard()), [sourceReceiptKey()]: publishedReceipt(8) });
  const result = await publishedChild(f, { currentProfile: publishedGuardProfile, currentAccount: "99999999-9999-4999-8999-999999999999", guardedRecovery: true, pendingControl: true, revision: 7 });
  expect(result.saved.childResult.requests).not.toContain("abort_my_uncommitted_account_deletion");
}, 30000);

async function originalUiRaws(resume = false, guarded = false) {
  const { createNewSession } = await import("../../sessionMigration"), { createTrainingBlock } = await import("../../trainingBlocks"), { buildMeasuredShot } = await import("../../measurement/operations");
  const { buildPlan } = await import("../../trainingPlans/__tests__/testHelpers"), plans = await import("../../trainingPlans/persistence"), session = await import("../../sessionRepository"), scoped = await import("../../persistence/profileScopedSportingPersistence");
  const raws: Record<string, string> = matchingPublicationRaws();
  for (const id of [profileId, "10000000-0000-4000-8000-000000000001"]) {
    const current = createNewSession(), history = createNewSession();
    current.title = id === profileId ? "Imported current training" : "Other Profile private training";
    history.title = id === profileId ? "Imported published history" : "Other Profile private training";
    const block = createTrainingBlock({ name: "Imported timing", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 });
    history.blocks = [block]; history.activeBlockId = block.id;
    const shot = buildMeasuredShot(block, { id: crypto.randomUUID(), sessionId: history.id, blockId: block.id, createdAt: new Date().toISOString(), shotNumber: 1, handle: "in", time: { value: 3.71, target: 3.75, source: "manual" } });
    expect(shot.ok).toBe(true); if (!shot.ok) throw Error("Synthetic shot refused"); history.shots = [shot.value];
    if (resume) { const resumed = structuredClone(history); resumed.id = current.id; resumed.title = current.title; resumed.blocks[0].name = "Imported current timing"; resumed.shots = resumed.shots.map(item => ({ ...item, sessionId: current.id })); Object.assign(current, resumed); }
    const plan = buildPlan({ name: id === profileId ? "Imported published plan" : "Other Profile private plan" });
    raws[scoped.profileScopedSportingStorageKey(id, session.CURRENT_SESSION_STORAGE_KEY)] = JSON.stringify(current);
    raws[scoped.profileScopedSportingStorageKey(id, session.SESSION_HISTORY_STORAGE_KEY)] = JSON.stringify([history]);
    raws[scoped.profileScopedSportingStorageKey(id, plans.TRAINING_PLANS_STORAGE_KEY)] = plans.serializeTrainingPlansState(plans.addPlan(plans.createEmptyTrainingPlansPersistedState(), plan));
  }
  if (guarded) { raws[sourceGuardKey(publishedGuardProfile)] = JSON.stringify(publishedGuard()); raws[sourceReceiptKey()] = publishedReceipt(8); }
  return { raws, uiOriginalCurrentId: JSON.parse(raws[scoped.profileScopedSportingStorageKey(profileId, session.CURRENT_SESSION_STORAGE_KEY)]).id };
}
async function publishedUiFixture(resume = false, unsigned = false, guarded = false) {
  const original = await originalUiRaws(resume, guarded);
  const f = await coldPublishedFixture(unsigned ? async f => { expect(await f.pair.credentials.remove(f.h.root)).toEqual({ ok: true, outcome: "deleted_reported" }); } : undefined, undefined, true, original.raws);
  return { ...f, uiOriginalCurrentId: original.uiOriginalCurrentId };
}
it("M3d actual published UI loads original multi-Profile data and saves training through genuine Provider", async () => {
  const f = await publishedUiFixture(), first = await publishedChild(f, { ui: true, uiExpectedHistoryShot: 3.71 });

  expect(first.saved.childResult).toMatchObject({ initializes: 1, cleanup: { ok: true }, forbiddenBrowserAccesses: 0 });
  expect(first.saved.childResult.publicCacheAccesses).toBeGreaterThan(0); expect(first.saved.childResult.cacheRoundtrip).toEqual({ miss: true, write: true, hit: true, warmFetches: 0, domBlob: true });
  const second = await publishedChild(f, { uiReadOnly: true, uiExpectedHistoryShot: 3.83, uiExpectedSavedId: first.saved.childResult.sessionId, uiExpectedNextCurrentId: first.saved.childResult.nextCurrentId }, first.file);
  expect(second.saved.childResult.pid).not.toBe(first.saved.childResult.pid); expect(second.saved.childResult).toMatchObject({ initializes: 1, cleanup: { ok: true }, forbiddenBrowserAccesses: 0 });
  expect(second.saved.protectedValues.filter(([key]: [string, string]) => key.startsWith("t1.") || key.startsWith("m1."))).toEqual([...f.h.values].filter(([key]) => key.startsWith("t1.") || key.startsWith("m1.")));
  await f.sql.raw({ kind: "open" }); const after = await originalSqlSnapshot(f); await f.sql.raw({ kind: "close" });
  expect(after.schema).toEqual(f.before.schema); expect(after.rows.filter((_row, index) => index !== 5)).toEqual(f.before.rows.filter((_row, index) => index !== 5));
}, 60000);
for (const mode of ["strict", "credential"] as const) it(`M3d actual published UI ${mode} preserves genuine training/save ownership`, async () => {
  const f = await publishedUiFixture(), first = await publishedChild(f, { ui: true, uiStrict: mode === "strict", uiCredentialFault: mode === "credential", uiExpectedHistoryShot: 3.71 });
  expect(first.saved.childResult).toMatchObject({ initializes: 1, forbiddenBrowserAccesses: 0, cleanup: mode === "credential" ? { ok: false, reason: "evidence_held" } : { ok: true } });
  if (mode === "credential") {
    const { profileScopedSportingStorageKey } = await import("../../persistence/profileScopedSportingPersistence"), { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } = await import("../../sessionRepository"), { decodePublishedLiveCodeUnits } = await import("../../persistence/installationPublishedLiveCodeUnits");
    await f.sql.raw({ kind: "open" });
    const inspect = async (key: typeof CURRENT_SESSION_STORAGE_KEY | typeof SESSION_HISTORY_STORAGE_KEY) => { const rows = await f.sql.raw({ kind: "query", sql: "SELECT value_ascii FROM installation_transfer_live_v1 WHERE key=?", values: [profileScopedSportingStorageKey(profileId, key)] }) as { values: { value_ascii: string }[] }; return JSON.parse(decodePublishedLiveCodeUnits(rows.values[0].value_ascii)); };
    const current = await inspect(CURRENT_SESSION_STORAGE_KEY), history = await inspect(SESSION_HISTORY_STORAGE_KEY); await f.sql.raw({ kind: "close" });
    expect(current.id).toBe(first.saved.childResult.sessionId); expect(current.blocks).toHaveLength(2); expect(current.shots).toHaveLength(2); expect(current.shots.at(-1).releaseTime).toBe(3.84);
    expect(history.filter((item: { id: string }) => item.id === current.id)).toHaveLength(1); expect(history.find((item: { id: string }) => item.id === current.id).shots).toEqual(current.shots);
  }
}, 40000);

it("M3d actual published UI resumes original Current rather than replacing it", async () => {
  const f = await publishedUiFixture(true), first = await publishedChild(f, { ui: true, uiResumeImported: true, uiExpectedCurrentId: f.uiOriginalCurrentId, uiExpectedHistoryShot: 3.71 });
  expect(first.saved.childResult).toMatchObject({ initializes: 1, forbiddenBrowserAccesses: 0, cleanup: { ok: true } });
}, 40000);
for (const mode of ["pending", "fresh", "close"] as const) it(`M3d actual published UI ${mode} keeps admission and cleanup ownership`, async () => {
  const f = await publishedUiFixture(false, mode !== "close"), first = await publishedChild(f, { ui: true, uiExpectedHistoryShot: 3.71, uiPendingFlow: mode === "pending", pendingControl: mode === "pending", uiFreshOtp: mode === "fresh", ...(mode === "fresh" ? { currentAccount: "99999999-9999-4999-8999-999999999999" } : {}), uiCloseDuringHydration: mode === "close" });
  expect(first.saved.childResult).toMatchObject({ initializes: 1, forbiddenBrowserAccesses: 0, cleanup: mode === "close" ? { ok: false, reason: "evidence_held" } : { ok: true } });
  if (mode === "close") expect(first.saved.childResult.heldHydrationClosed).toBe(true);
}, 40000);

it("M3d actual published UI cannot bypass an original guard and recovers through actual Control", async () => {
  const f = await publishedUiFixture(false, true, true), first = await publishedChild(f, { ui: true, uiGuardFlow: true, currentAccount: "99999999-9999-4999-8999-999999999999", currentProfile: publishedGuardProfile, revision: 8 });
  expect(first.saved.childResult).toMatchObject({ initializes: 1, forbiddenBrowserAccesses: 0, cleanup: { ok: true }, guardedRetryRecovered: true, verifyCount: 1 });
  expect(first.saved.childResult.requests).toContain("abort_my_uncommitted_account_deletion");
}, 40000);

it("M3d actual UI Retry cannot bypass an unresolved source floor", async () => {
  const f = await publishedUiFixture(false, true, true), first = await publishedChild(f, { ui: true, uiGuardFlow: true, uiGuardLowControl: true, currentAccount: "99999999-9999-4999-8999-999999999999", currentProfile: publishedGuardProfile, revision: 7 });
  expect(first.saved.childResult).toMatchObject({ initializes: 1, forbiddenBrowserAccesses: 0, cleanup: { ok: false, reason: "evidence_held" }, cleanupCredential: "failed", cleanupStorageFailed: true, unresolvedGuardRefused: true, guardRetryRefused: true });
  expect(first.saved.childResult.requests).not.toContain("abort_my_uncommitted_account_deletion");
}, 40000);

it("M3d actual native domain failure removes ordinary Profile access in the mounted published UI", async () => {
  const f = await publishedUiFixture(), result = await publishedChild(f, { ui: true, uiDomainFault: true });
  expect(result.saved.childResult).toMatchObject({ domainRefused: true, forbiddenBrowserAccesses: 0, cleanupDomain: "failed", cleanup: { ok: false, reason: "evidence_held" } });
}, 40000);

// S6n1: use only the new public application Host controls; no private Owner spy.
async function applicationImport(raws: Record<string, string> = matchingPublicationRaws(), protectedRead?: ProtectedRead) {
  const f = await context(raws, protectedRead);
  const made = await f.h.module.createConfiguredInstallationTransferApplicationHost(f.binding, f.options);
  expect(made.ok).toBe(true); if (!made.ok) throw Error("Synthetic application Host unavailable");
  const host = made.host; hosts.push(host);
  return { ...f, host };
}
async function admittedApplicationImport(raws?: Record<string, string>, protectedRead?: ProtectedRead) {
  const f = await applicationImport(raws, protectedRead), runtime = await start(f.host);
  await onboard(f.h, runtime); const transport = accountTransport(f.h);
  return { ...f, runtime, transport };
}
it("N1 application binding/reservation checks precede all option reads", async () => {
  const f = await context(), trap = vi.fn(() => { throw null; });
  const input = new Proxy({}, { get: trap }) as NativeConfiguredInstallationTransferIdentityHostOptions;
  expect(await f.h.module.createConfiguredInstallationTransferApplicationHost({}, input)).toEqual({ ok: false, reason: "invalid_configuration" });
  const existing = await f.made();
  expect(await f.h.module.createConfiguredInstallationTransferApplicationHost(f.binding, input)).toEqual({ ok: false, reason: "ownership_conflict" });
  expect(trap).not.toHaveBeenCalled(); expect(await existing.dispose()).toEqual({ ok: true });
});
it("N1 application controls before start and after close cannot construct or publish", async () => {
  const f = await applicationImport();
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused", mayMount: false });
  expect(await f.host.completeImport()).toMatchObject({ code: "publication_refused", observedLayout: "unknown" });
  expect(await f.host.checkAccountDeletion()).toEqual({ ok: false, error: "unavailable" });
  expect(await f.host.cancelAccountDeletion(deletionRequestId)).toEqual({ ok: false, error: "unavailable" });
  expect(f.sql.trace).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled(); expect(f.h.events).toEqual([]);
  expect(await f.host.dispose()).toEqual({ ok: true });
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  expect(await f.host.completeImport()).toMatchObject({ code: "publication_refused" }); expect(f.sql.trace).toEqual([]);
});
it("N1 public OTP Control prepare and complete publish the actual all-Profile SQLite data", async () => {
  const f = await applicationImport(), runtime = await start(f.host);
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  await onboard(f.h, runtime); const transport = accountTransport(f.h);
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  expect(await f.host.checkAccountDeletion()).toEqual({ ok: true, value: null });
  const before = await originalSqlSnapshot(f), first = f.host.prepareImport(); expect(f.host.prepareImport()).toBe(first);
  expect(await first).toMatchObject({ code: "publication_intent", mayIssue: false, mayPublish: false, mayMount: false });
  const prepared = await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_sporting_v1 ORDER BY key" });
  const complete = f.host.completeImport(); expect(f.host.completeImport()).toBe(complete);
  expect(await complete).toEqual(noPublicationGrant("publication_confirmed", "desired11"));
  expect(await originalSqlSnapshot(f)).toEqual(before);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_live_v1 ORDER BY key" })).toEqual(prepared);
  expect(transport.calls).toContain("get_my_account_deletion_control");
  expect("createSportingApplicationScope" in runtime).toBe(false); expect(await f.host.dispose()).toEqual({ ok: true });
});
it("N1 public pending-deletion recovery denies publication and exposes actual cancellation", async () => {
  const f = await admittedApplicationImport(); f.transport.state.pending = deletionRow;
  expect(await f.host.checkAccountDeletion()).toMatchObject({ ok: true, value: { requestId: deletionRequestId } });
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  expect(await f.host.completeImport()).toMatchObject({ code: "publication_refused" });
  const cancelled = await f.host.cancelAccountDeletion(deletionRequestId);
  expect(cancelled).toEqual({ ok: true, value: true }); expect(f.transport.calls).toContain("cancel_my_account_deletion");
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
});
it("N1 actual current Profile absent from the original archive cannot publish", async () => {
  const f = await admittedApplicationImport(basic());
  expect(await f.host.checkAccountDeletion()).toEqual({ ok: true, value: null });
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  expect(await f.host.completeImport()).toMatchObject({ code: "publication_refused" });
  expect([...f.h.values.keys()].some(key => key.startsWith("t1."))).toBe(false);
});
it("N1 wrong recovery code refuses before SQL SDK or API work", async () => {
  const f = await context(), made = await f.h.module.createConfiguredInstallationTransferApplicationHost(f.binding,
    { ...f.options, installationTransfer: { ...f.options.installationTransfer, recoveryCode: "ct1-" + "A".repeat(43) } });
  expect(made.ok).toBe(true); if (!made.ok) throw null; hosts.push(made.host);
  expect(await made.host.start()).toEqual({ outcome: "waiting", code: "migration_blocked" });
  expect(await made.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  expect(f.sql.trace).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled(); expect(f.h.events).toEqual([]);
});
it("N1 close joins the exact public preparation while its native hash is held", async () => {
  const f = await admittedApplicationImport(); expect(await f.host.checkAccountDeletion()).toEqual({ ok: true, value: null });
  const entered = deferred<void>(), held = deferred<ArrayBuffer>(); let closed = false;
  vi.stubGlobal("crypto", { randomUUID: () => webcrypto.randomUUID(), subtle: { digest() { entered.resolve(); return held.promise; } } });
  const preparing = f.host.prepareImport(); await entered.promise;
  const closing = f.host.dispose(); void closing.then(() => { closed = true; }); await pause(); expect(closed).toBe(false);
  held.resolve(new ArrayBuffer(32)); expect(await preparing).toMatchObject({ code: "closed" });
  vi.stubGlobal("crypto", webcrypto); expect(await closing).toEqual({ ok: true });
});
it.each(["prepare", "publish"] as const)("N1 exact public %s completion at a protected native read does not become its own ACK or drain", async mode => {
  let armed = false; const entered = deferred<void>();
  // Return the exact completion directly at the captured native method, without
  // the fixture's async fault-hook alias (which hides exact ownership).
  const f = await admittedApplicationImport(undefined, (_key, next) => {
    if (armed) { armed = false; entered.resolve(); return whole; }
    return next();
  });
  expect(await f.host.checkAccountDeletion()).toEqual({ ok: true, value: null });
  if (mode === "publish") expect(await f.host.prepareImport()).toMatchObject({ code: "publication_intent" });
  armed = true; const whole = mode === "prepare" ? f.host.prepareImport() : f.host.completeImport();
  await entered.promise; const result = await Promise.race([whole, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
  expect(result).not.toBeNull(); expect(result).not.toMatchObject({ code: "publication_intent" }); expect(result).not.toMatchObject({ code: "publication_confirmed" });
  f.h.faults.hook = undefined; await f.host.dispose();
});
it("N1 factual committed public outcome survives concurrent Host close", async () => {
  const f = await admittedApplicationImport(); expect(await f.host.checkAccountDeletion()).toEqual({ ok: true, value: null });
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_intent" });
  const entered = deferred<void>(), held = deferred<void>(); let armed = true, closed = false;
  f.sql.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "commit") { armed = false; entered.resolve(); await held.promise; } return value; };
  const published = f.host.completeImport(); await entered.promise; const closing = f.host.dispose(); void closing.then(() => { closed = true; });
  await pause(); expect(closed).toBe(false); held.resolve();
  expect(await published).toEqual(noPublicationGrant("publication_confirmed", "desired11"));
  expect(await closing).toEqual({ ok: true });
});
it.each([false, true])("N1 genuine recovery stays available without ordinary admission, pending=%s", async pending => {
  const f = await applicationImport({ ...matchingPublicationRaws(), [sourceGuardKey()]: sourceGuard() }), runtime = await start(f.host);
  server(f.h, true); const transport = accountTransport(f.h); transport.state.revision = 4; if (pending) transport.state.pending = deletionRow;
  expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
  expect((await runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).kind).toBe("otp_requested");
  expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "identity_unconfirmed" } });
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  const actual = await f.host.checkAccountDeletion(); expect(actual.ok).toBe(true);
  if (pending) {
    expect(actual).toMatchObject({ value: { requestId: deletionRequestId } });
    expect(await f.host.cancelAccountDeletion(deletionRequestId)).toEqual({ ok: true, value: true });
    expect(transport.calls).toContain("cancel_my_account_deletion");
  } else {
    expect(actual).toEqual({ ok: true, value: null, recoveredProfileId: profileId });
    expect(transport.calls).toEqual(["get_my_account_deletion_control", "abort_my_uncommitted_account_deletion"]);
  }
  // Recovery is not a new OTP publication proof.
  expect(await f.host.prepareImport()).toMatchObject({ code: "publication_refused" });
  expect(await f.host.completeImport()).toMatchObject({ code: "publication_refused" });
});

async function applicationUiOwner(raws: Record<string, string> = matchingPublicationRaws(), protectedRead?: ProtectedRead) {
  const f = await context(raws, protectedRead), { createRequire } = await import("node:module");
  const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: { url: string }) => { window: Pick<typeof globalThis, "File" | "Blob" | "FileReader"> & { close(): void } } };
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://app.example.invalid/" });
  vi.stubGlobal("File", dom.window.File); vi.stubGlobal("Blob", dom.window.Blob); vi.stubGlobal("FileReader", dom.window.FileReader);
  const applicationModule = await import("../installationTransferApplication"), app = applicationModule.createInstallationTransferApplication(f.binding, f.options);
  publishedColdCleanups.push(async () => { await app.close(); await applicationState(app, s => s.phase === "closed" || s.phase === "restart" || s.phase === "blocked"); dom.window.close(); });
  const file = (value: string | Uint8Array = f.archive.protectedWire) => new dom.window.File([value as BlobPart], "synthetic-transfer.txt");
  return { ...f, app, dom, file, module: applicationModule };
}
async function applicationState(app: import("../installationTransferApplication").InstallationTransferApplication,
  predicate: (state: import("../installationTransferApplication").InstallationTransferApplicationSnapshot) => boolean) {
  for (let index = 0; index < 1000; index++) { const state = app.getSnapshot(); if (predicate(state)) return state; await pause(); }
  throw Error("Synthetic application did not reach its expected state");
}
it("N2 actual File owner drives public OTP Control publication and positive cleanup", async () => {
  const f = await applicationUiOwner(); expect(f.app.importFile(f.file(), f.archive.recoveryCode)).toBeUndefined();
  const state = await applicationState(f.app, s => s.phase === "access"); expect(state.runtime).not.toBeNull();
  await onboard(f.h, state.runtime!); const transport = accountTransport(f.h);
  f.app.completeImport(); const result = await applicationState(f.app, s => s.phase === "restart");
  expect(result.dataStored).toBe(true); expect(result.publication).toEqual(noPublicationGrant("publication_confirmed", "desired11"));
  expect(transport.calls).toContain("get_my_account_deletion_control");
  expect(f.app.getSnapshot()).toBe(result); expect([...f.h.source.map]).toEqual([]);
  const closed = f.app.close(); expect(f.app.close()).toBe(closed); expect(await closed).toEqual({ ok: true });
  expect(f.app.getSnapshot()).toMatchObject({ phase: "restart", dataStored: true });
  await f.sql.raw({ kind: "open" });
  expect(await f.sql.raw({ kind: "query", sql: "SELECT COUNT(*) AS count FROM sqlite_master" })).toMatchObject({ values: [{ count: 11 }] });
  await f.sql.raw({ kind: "close" });
});
for (const invalid of ["blob", "shape", "empty", "non_ascii", "old_json", "wrong_code", "bad_code"] as const) it(`N2 ${invalid} refuses without a sporting workspace or native writes`, async () => {
  const f = await applicationUiOwner();
  const file = invalid === "blob" ? new f.dom.window.Blob([f.archive.protectedWire]) : invalid === "shape" ? { name: "fake.txt", size: 20, text: () => f.archive.protectedWire }
    : f.file(invalid === "empty" ? "" : invalid === "non_ascii" ? new Uint8Array([128]) : invalid === "old_json" ? '{"schemaVersion":1}' : f.archive.protectedWire);
  f.app.importFile(file, invalid === "wrong_code" ? "ct1-" + "A".repeat(43) : invalid === "bad_code" ? "bad" : f.archive.recoveryCode);
  const state = await applicationState(f.app, s => s.phase === "select" && s.notice !== null);
  expect(state.runtime).toBeNull(); expect(state.dataStored).toBe(false); expect(state.publication).toBeNull();
  expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled();
});
it("N2 binding refusal precedes all application option reads", async () => {
  const f = await applicationUiOwner(), trap = vi.fn(() => { throw null; });
  const app = f.module.createInstallationTransferApplication({}, new Proxy({}, { get: trap, getOwnPropertyDescriptor: trap }) as never);
  app.importFile(f.file(), f.archive.recoveryCode); app.openPublished(); expect(app.close()).toBeUndefined(); expect(trap).not.toHaveBeenCalled();
  expect(app.getSnapshot().phase).toBe("closed"); expect(f.sql.trace).toEqual([]);
});
it("N2 refused published entry cannot create an empty sporting workspace", async () => {
  const f = await applicationUiOwner(); f.app.openPublished();
  const state = await applicationState(f.app, s => !s.busy && (s.phase === "select" && s.notice !== null || s.phase === "blocked"));
  expect(state.runtime).toBeNull(); expect(state.dataStored).toBe(false); expect(f.h.fetch).not.toHaveBeenCalled();
});
it("N2 holds an actual FileReader delivery through duplicate input and pre-Host close", async () => {
  const f = await applicationUiOwner(), entered = deferred<void>(), held = deferred<void>();
  const read = f.dom.window.FileReader.prototype.readAsArrayBuffer; let reads = 0;
  vi.spyOn(f.dom.window.FileReader.prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader, file: Blob) {
    reads++; const receive = this.onload;
    this.onload = event => { entered.resolve(); void held.promise.then(() => { receive?.call(this, event); }); };
    return read.call(this, file);
  });
  try {
    f.app.importFile(f.file(), f.archive.recoveryCode); f.app.importFile(f.file(), f.archive.recoveryCode); await entered.promise;
    expect(reads).toBe(1); expect(f.app.close()).toBeUndefined(); await pause(); expect(f.app.getSnapshot().phase).toBe("closing");
    expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]); held.resolve();
    const state = await applicationState(f.app, s => s.phase === "closed"); expect(state.dataStored).toBe(false); expect(f.sql.trace).toEqual([]);
  } finally { held.resolve(); }
});
it("N2 synchronous Close at actual File read joins delivery without later native getter reads", async () => {
  const f = await applicationUiOwner(), entered = deferred<void>(), held = deferred<void>();
  const prototype = f.dom.window.FileReader.prototype, read = prototype.readAsArrayBuffer;
  const result = vi.spyOn(prototype, "result", "get"), ready = vi.spyOn(prototype, "readyState", "get");
  vi.spyOn(prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader, file: Blob) {
    expect(f.app.close()).toBeUndefined(); const receive = this.onload;
    this.onload = event => { entered.resolve(); void held.promise.then(() => receive?.call(this, event)); };
    return read.call(this, file);
  });
  try {
    f.app.importFile(f.file(), f.archive.recoveryCode); await entered.promise;
    expect(f.app.getSnapshot().phase).toBe("closing"); expect(result).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
    held.resolve(); await applicationState(f.app, s => s.phase === "closed");
    expect(result).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled(); expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]);
  } finally { held.resolve(); }
});
it("N2 captured malformed option work drains after Close before any later option or File read", async () => {
  const f = await applicationUiOwner(), held = deferred<unknown>(); let later = 0;
  const migration = new Proxy({ ...f.options.migration, generateUuid: held.promise }, { getOwnPropertyDescriptor(target, name) { if (name === "now") later++; return Reflect.getOwnPropertyDescriptor(target, name); } });
  const app = f.module.createInstallationTransferApplication(f.binding, { ...f.options, migration } as never);
  try {
    app.importFile(f.file(), f.archive.recoveryCode); await pause(); expect(app.close()).toBeUndefined(); await pause();
    expect(app.getSnapshot().phase).toBe("closing"); expect(later).toBe(0); expect(f.sql.trace).toEqual([]);
    held.resolve(() => webcrypto.randomUUID()); await applicationState(app, s => s.phase === "closed"); expect(later).toBe(0); expect(f.sql.trace).toEqual([]);
  } finally { held.resolve(undefined); await app.close(); }
});
it.each(["immediate", "queued_late_host"] as const)("N2 pre-Host %s close cannot deadlock actual constructor capture", async mode => {
  const f = await applicationUiOwner(), RequestType = globalThis.Request; let calls = 0;
  vi.stubGlobal("Request", RequestType);
  Object.defineProperty(globalThis, "Request", { configurable: true, get() {
    calls++; if (mode === "immediate") return f.app.close();
    queueMicrotask(() => { f.app.close(); }); return RequestType;
  } });
  f.app.importFile(f.file(), f.archive.recoveryCode);
  const state = await applicationState(f.app, s => s.phase === "closed");
  expect(calls).toBe(1); expect(state.dataStored).toBe(false); expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled();
  Object.defineProperty(globalThis, "Request", { configurable: true, writable: true, value: RequestType });
  const next = await f.make(); expect(next.ok).toBe(true); if (next.ok) expect(await next.host.dispose()).toEqual({ ok: true });
});
it("N2 public Close returned directly at a real native read drains its actual Host", async () => {
  let armed = true;
  const f = await applicationUiOwner(undefined, (_key, next) => { if (armed) { armed = false; return app.close(); } return next(); });
  const app = f.app; f.app.importFile(f.file(), f.archive.recoveryCode);
  const state = await applicationState(app, s => s.phase === "closed" || s.phase === "blocked");
  expect(state.runtime).toBeNull(); expect(state.dataStored).toBe(false); expect(state.publication).toBeNull(); expect(f.h.fetch).not.toHaveBeenCalled();
});
it("N2 missing native File metadata stops before later Blob metadata and joins its captured work", async () => {
  const f = await applicationUiOwner(), held = deferred<unknown>(), OriginalFile = f.dom.window.File; let later = 0;
  vi.stubGlobal("File", held.promise); vi.stubGlobal("Blob", f.dom.window.Blob);
  Object.defineProperty(globalThis, "Blob", { configurable: true, get() { later++; return f.dom.window.Blob; } });
  try {
    f.app.importFile(f.file(), f.archive.recoveryCode); await pause(); expect(f.app.close()).toBeUndefined(); await pause();
    expect(f.app.getSnapshot().phase).toBe("closing"); expect(later).toBe(0); held.resolve(OriginalFile);
    await applicationState(f.app, s => s.phase === "closed"); expect(later).toBe(0); expect(f.sql.trace).toEqual([]);
  } finally { held.resolve(undefined); }
});
it("N2 real oversized File refuses before the reader or target starts", async () => {
  const f = await applicationUiOwner(), read = vi.spyOn(f.dom.window.FileReader.prototype, "readAsArrayBuffer");
  const bound = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n".length + 17 + Math.ceil((25165824 + 16) * 4 / 3);
  f.app.importFile(f.file(new Uint8Array(bound + 1)), f.archive.recoveryCode);
  await applicationState(f.app, s => s.phase === "select" && s.notice !== null);
  expect(read).not.toHaveBeenCalled(); expect(f.sql.trace).toEqual([]); expect(f.h.fetch).not.toHaveBeenCalled();
});
it("N2 malformed native Reader return joins acquired work without inventing a read completion", async () => {
  const f = await applicationUiOwner(), entered = deferred<void>(), held = deferred<void>();
  vi.spyOn(f.dom.window.FileReader.prototype, "readAsArrayBuffer").mockImplementation(() => { entered.resolve(); return held.promise; });
  try {
    f.app.importFile(f.file(), f.archive.recoveryCode); await entered.promise;
    expect(f.app.close()).toBeUndefined(); await pause(); expect(f.app.getSnapshot().phase).toBe("closing");
    held.resolve(); await applicationState(f.app, s => s.phase === "closed"); expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]);
  } finally { held.resolve(); }
});
it("N2 actual File Provider onboarding and StrictMode import then genuine cold App training and reload", async () => {
  const original = await originalUiRaws(), f = await context(original.raws);
  const first = await publishedChild(f, { ui: true, uiStrict: true, captureUi: true, importUi: true, importOnboarding: true, facts: facts(false), completedFacts: facts(true), expectedImportRaws: original.raws, protectedWire: f.archive.protectedWire, recoveryCode: f.archive.recoveryCode });
  expect(first.saved.childResult).toMatchObject({ imported: true, onboarding: true, verifyCount: 1, initializes: 1, cleanup: { ok: true }, forbiddenBrowserAccesses: 0 });
  // Independently inspect the durable all-Profile copy after the actual UI Host
  // positively closed, before another cold process owns this database.
  const codeUnits = await import("../../persistence/installationTransferCodeUnits");
  await f.sql.raw({ kind: "open" });
  const live = await f.sql.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_live_v1 ORDER BY key" });
  expect(live).toEqual({ values: Object.entries(original.raws).filter(([key]) => key.startsWith("curling.sporting.profile.v1.")).sort(([a], [b]) => a.localeCompare(b)).map(([key, raw]) => ({ key, value_ascii: codeUnits.encodeTransferCodeUnits(raw) })) });
  await f.sql.raw({ kind: "close" });
  const second = await publishedChild(f, { importUi: false, openUi: true, facts: facts(true) }, first.file);
  expect(second.saved.childResult).toMatchObject({ coldOpen: true, initializes: 1, foreignProfileIo: 0 });
  const third = await publishedChild(f, { openUiReadOnly: true, expectedImportedUiSessionId: second.saved.childResult.sessionId }, second.file);
  expect(third.saved.childResult).toMatchObject({ coldRead: true, sessionId: second.saved.childResult.sessionId, initializes: 1 });
  expect(new Set([first.saved.childResult.pid, second.saved.childResult.pid, third.saved.childResult.pid]).size).toBe(3);
}, 90000);
for (const recovery of ["guard", "pending", "low_control"] as const) it(`N2 real import recovery ${recovery} stays outside admission and uses explicit fresh sign-in`, async () => {
  const original = await originalUiRaws(), f = await context({ ...original.raws, [sourceGuardKey()]: sourceGuard() });
  const result = await publishedChild(f, { ui: true, importUi: true, importGuard: recovery === "guard", importPending: recovery === "pending", importLowControl: recovery === "low_control", pendingControl: recovery === "pending", revision: recovery === "low_control" ? 3 : 4, expectedImportRaws: original.raws, protectedWire: f.archive.protectedWire, recoveryCode: f.archive.recoveryCode });
  expect(result.saved.childResult).toMatchObject(recovery === "low_control" ? { deniedImport: true, verifyCount: 1, forbiddenBrowserAccesses: 0 } : { imported: true, verifyCount: 2, cleanup: { ok: true }, forbiddenBrowserAccesses: 0 });
});

for(const level of ["root","migration","sqlite","limits"] as const)it(`N2 regression refuses masked native Promise ${level} options container`,async()=>{
 const f=await applicationUiOwner(), held=deferred<unknown>();const original=level==="root"?f.options:level==="migration"?f.options.migration:level==="sqlite"?f.options.migration.sqlite:f.options.migration.limits;
 const malformed=Object.assign(held.promise,original);Object.defineProperty(malformed,"then",{value:undefined});
 const options=level==="root"?malformed:level==="migration"?{...f.options,migration:malformed}:level==="sqlite"?{...f.options,migration:{...f.options.migration,sqlite:malformed}}:{...f.options,migration:{...f.options.migration,limits:malformed}};
 const app=f.module.createInstallationTransferApplication(f.binding,options as never);
 try{app.importFile(f.file(),f.archive.recoveryCode);await pause();expect(f.sql.trace).toEqual([]);held.resolve(undefined);
 const result=await applicationState(app,s=>s.phase==="access"||s.phase==="blocked"||s.phase==="select"&&s.notice!==null);
 expect(result.phase).toBe("select");expect(f.sql.trace).toEqual([]);expect(f.h.events).toEqual([]);expect(f.h.fetch).not.toHaveBeenCalled();
 }finally{held.resolve(undefined);await app.close();await applicationState(app,s=>["closed","blocked","restart"].includes(s.phase));}
});
for(const mode of ["pending","throw"] as const)it(`N2 regression malformed readyState ${mode} retains actual issued delivery`,async()=>{
 const f=await applicationUiOwner(),entered=deferred<void>(),nativeDone=deferred<void>(),delivery=deferred<void>(),metadata=deferred<unknown>();
 const prototype=f.dom.window.FileReader.prototype, read=prototype.readAsArrayBuffer;
 vi.spyOn(prototype,"readAsArrayBuffer").mockImplementation(function(this:FileReader,file:Blob){const receive=this.onload;this.onload=null;this.addEventListener("load",event=>{nativeDone.resolve();void delivery.promise.then(()=>receive?.call(this,event));},{once:true});const returned=read.call(this,file);entered.resolve();return returned;});
 vi.spyOn(prototype,"readyState","get").mockImplementation(()=>{if(mode==="throw")throw Error("Synthetic readyState failure");return metadata.promise as never;});
 try{f.app.importFile(f.file(),f.archive.recoveryCode);await entered.promise;expect(f.app.close()).toBeUndefined();await nativeDone.promise;metadata.resolve(1);await pause();await pause();
 expect(f.app.getSnapshot().phase).toBe("closing");expect(f.sql.trace).toEqual([]);delivery.resolve();await applicationState(f.app,s=>s.phase==="closed");
 }finally{metadata.resolve(undefined);delivery.resolve();await f.app.close();}
});
it("N2 regression actual commit Close never leaves closed plus committed facts without restart",async()=>{
 const f=await applicationUiOwner();f.app.importFile(f.file(),f.archive.recoveryCode);const access=await applicationState(f.app,s=>s.phase==="access");await onboard(f.h,access.runtime!);accountTransport(f.h);
 const entered=deferred<void>(),held=deferred<void>();let armed=true;f.sql.faults.hook=async(event,next)=>{const value=await next();if(armed&&event.kind==="commit"&&f.sql.trace.some(e=>e.kind==="execute"&&e.sql?.startsWith("CREATE TABLE installation_transfer_publication_v1"))){armed=false;entered.resolve();await held.promise;}return value;};
 try{f.app.completeImport();await entered.promise;const closing=f.app.close();held.resolve();expect(await closing).toEqual({ok:true});const result=await applicationState(f.app,s=>s.phase==="restart"||s.phase==="closed"||s.phase==="blocked");expect(result).toMatchObject({phase:"restart",dataStored:true,publication:noPublicationGrant("publication_confirmed","desired11")});
 }finally{held.resolve();await f.app.close();}
});

it.each(["before", "after"] as const)("N2 read throw %s issuance needs actual EMPTY or delivery before closure", async stage => {
  const f = await applicationUiOwner(), entered = deferred<void>(), delivery = deferred<void>();
  const prototype = f.dom.window.FileReader.prototype, read = prototype.readAsArrayBuffer;
  vi.spyOn(prototype, "readAsArrayBuffer").mockImplementation(function (this: FileReader, file: Blob) {
    if (stage === "after") {
      const receive = this.onload; this.onload = null;
      this.addEventListener("load", event => { entered.resolve(); void delivery.promise.then(() => receive?.call(this, event)); }, { once: true });
      read.call(this, file);
    }
    throw Error("Synthetic read issuance failure");
  });
  try {
    f.app.importFile(f.file(), f.archive.recoveryCode);
    if (stage === "after") {
      await entered.promise; expect(f.app.close()).toBeUndefined(); await pause();
      expect(f.app.getSnapshot().phase).toBe("closing"); delivery.resolve();
      await applicationState(f.app, s => s.phase === "closed");
    } else await applicationState(f.app, s => s.phase === "select" && s.notice !== null);
    expect(f.sql.trace).toEqual([]); expect(f.h.events).toEqual([]);
  } finally { delivery.resolve(); await f.app.close(); }
});
