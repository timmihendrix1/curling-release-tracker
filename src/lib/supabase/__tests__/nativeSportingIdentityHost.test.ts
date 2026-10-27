// Actual installed public AuthClient + disposable real SQLite. All values and
// transports are synthetic/injected; no platform Keychain or real account.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityRuntimeReady } from "../../identity/identityRuntime";
import { IDENTITY_BARRIER_STORAGE_KEY } from "../../identity/identityBarrier";
import { TRUSTED_DEVICE_STORAGE_KEY } from "../../identity/trustedDevice";
import type { NativeSupabaseAuthHost, NativeSupabaseAuthHostOptions, NativeIdentityBootstrapHost, NativeIdentityBootstrapHostOptions } from "../supabaseAuthService";
import { combinedFixture, disposeCombinedFixtures } from "../../persistence/__tests__/nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "../../persistence/__tests__/nativeMigrationMTestKit";
import { fp, isSyntheticFingerprint } from "../../persistence/__tests__/nativeMigrationTestKit";
import { parseCredentialPhysicalSlot } from "../../persistence/credentialPhysicalSlots";
const hosts: (NativeSupabaseAuthHost | NativeIdentityBootstrapHost)[] = [], releases: (() => void)[] = [];
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
  const label = `identity-fixture-${++count}`, root = `sb-${label}-auth-token`, configId = `pc1:${label}`;
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

const profileId = "22222222-2222-4222-8222-222222222222";
const termsId = "33333333-3333-4333-8333-333333333333", privacyId = "44444444-4444-4444-8444-444444444444";
const actedAt = "2026-01-01T00:00:00Z";
const legalRows = [
  { id: termsId, kind: "terms_of_service", version_label: "Synthetic Terms", document_url: "https://legal.example.invalid/terms", effective_at: actedAt },
  { id: privacyId, kind: "privacy_notice", version_label: "Synthetic Privacy", document_url: "https://legal.example.invalid/privacy", effective_at: actedAt },
];
function facts(completed: boolean) {
  return { profile_id: profileId, display_name: completed ? "Synthetic Athlete" : null, onboarding_completed_at: completed ? actedAt : null,
    has_athlete_capability: completed, free_entitlement_active: completed,
    pinned_terms_acceptance_id: completed ? "55555555-5555-4555-8555-555555555555" : null,
    pinned_terms_document_id: completed ? termsId : null, pinned_terms_version_label: completed ? "Synthetic Terms" : null, pinned_terms_accepted_at: completed ? actedAt : null,
    pinned_privacy_acknowledgement_id: completed ? "66666666-6666-4666-8666-666666666666" : null,
    pinned_privacy_document_id: completed ? privacyId : null, pinned_privacy_version_label: completed ? "Synthetic Privacy" : null, pinned_privacy_acknowledged_at: completed ? actedAt : null,
    current_terms_document_id: termsId, current_terms_version_label: "Synthetic Terms", current_privacy_document_id: privacyId, current_privacy_version_label: "Synthetic Privacy" };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function bootstrap(h: Fixture, overrides: Partial<NativeIdentityBootstrapHostOptions> = {}) {
  let url: string | null = "https://app.example.invalid/";
  const callbackUrlAccess = { readCurrentUrl: vi.fn(() => url), replaceCurrentUrl: vi.fn((value: string) => { url = value; }) };
  const created = await h.module.createNativeSportingIdentityHost({ ...h.options, callbackUrlAccess, ...overrides });
  expect(created.ok).toBe(true); if (!created.ok) throw new Error(created.reason);
  const host = created.host; hosts.push(host);
  return { host, callbackUrlAccess, setUrl(value: string | null) { url = value; }, async start() {
    const result = await host.start(); expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") throw new Error("Synthetic identity runtime unavailable");
    return result.runtime;
  } };
}
function server(h: Fixture) {
  let completed = false;
  const requests: { path: string; authorized: boolean; body: Record<string, unknown> | null }[] = [];
  h.fetch.mockImplementation(async input => {
    const request = input as Request, path = new URL(request.url).pathname;
    expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("error");
    const raw = await request.text();
    requests.push({ path, authorized: request.headers.get("Authorization") === "Bearer SYNTHETIC_HOST_ACCESS", body: raw ? JSON.parse(raw) : null });
    if (path.endsWith("/get_current_legal_documents")) { expect(request.headers.has("Authorization")).toBe(false); return response(legalRows); }
    if (path.endsWith("/otp")) return response({});
    if (path.endsWith("/verify") || path.endsWith("/token")) return response(session());
    if (path.endsWith("/logout")) return new Response(null, { status: 204 });
    expect(request.headers.get("Content-Profile")).toBe("public");
    expect(request.headers.get("Authorization") === "Bearer SYNTHETIC_HOST_ACCESS").toBe(true);
    if (path.endsWith("/ensure_my_profile")) return response({ id: profileId, display_name: completed ? "Synthetic Athlete" : null });
    if (path.endsWith("/complete_personal_onboarding")) completed = true;
    return response(facts(completed));
  });
  return requests;
}
async function onboard(h: Fixture, runtime: IdentityRuntimeReady) {
  server(h);
  expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
  expect((await runtime.coordinator.requestEmailOtp(user.email)).kind).toBe("otp_requested");
  const verified = await runtime.coordinator.verifyEmailOtp(user.email, "123456");
  expect(verified.kind).toBe("resolved");
  if (verified.kind !== "resolved" || verified.gate.kind !== "onboarding_required" || !verified.gate.legal.terms || !verified.gate.legal.privacy) throw new Error("Synthetic onboarding unavailable");
  const completed = await runtime.coordinator.submitOnboarding({ displayName: "Synthetic Athlete", terms: verified.gate.legal.terms, privacy: verified.gate.legal.privacy });
  expect(completed).toMatchObject({ kind: "completed", gate: { kind: "ready_online", session: { profileId, entitlement: "free" } } });
  return completed;
}
async function row(h: Fixture, key: string) {
  const result = await h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key=?", values: [key] }) as { values: { value: string }[] };
  return result.values[0]?.value ?? null;
}


const sportingRecord = { recordKind: "training_session" as const, recordId: "77777777-7777-4777-8777-777777777777", schemaVersion: 1, payload: "synthetic payload bytes", recordedAt: SYNTHETIC_NOW };
const payloadHash = createHash("sha256").update(sportingRecord.payload).digest("hex");
function sportingTransport(h: Fixture) {
  const original = h.fetch.getMockImplementation()!;
  const calls: { rpc: string; body: Record<string, unknown> }[] = [];
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, rpc = new URL(request.url).pathname.split("/").pop()!;
    if (!["get_my_sporting_records", "put_my_sporting_record", "delete_my_sporting_record"].includes(rpc)) return original(...args);
    expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("error");
    expect(request.headers.get("Content-Profile")).toBe("public");
    expect(request.headers.get("Authorization")).toBe("Bearer SYNTHETIC_HOST_ACCESS");
    const body=JSON.parse(await request.text());calls.push({rpc,body});
    return response(rpc==="get_my_sporting_records"?[]:{outcome:rpc==="delete_my_sporting_record"?"deleted":"inserted",content_sha256:payloadHash});
  });
  return calls;
}

describe("dormant native sporting Identity host", () => {
  it("exposes only its exact typed subtype and cannot mint admission from a Profile selector", async () => {
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start(); server(h);
    expect(Object.keys(b.host).sort()).toEqual(["dispose","health","start"]);
    expect(runtime.createSportingCloudService(profileId)).toBe(null);
    expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
    expect(runtime.createSportingCloudService(profileId)).toBe(null);
    expect(Object.isFrozen(runtime)).toBe(true);
  });
  it("runs the three existing real sporting mappers only after genuine fresh admission", async () => {
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start(); await onboard(h,runtime);
    const calls=sportingTransport(h),service=runtime.createSportingCloudService(profileId)!; expect(service).not.toBe(null);expect(Object.isFrozen(service)).toBe(true);
    expect(await service.restore()).toEqual({ok:true,value:[]});
    expect(await service.put(sportingRecord)).toEqual({ok:true,value:{outcome:"inserted",contentSha256:payloadHash}});
    expect(await service.delete({...sportingRecord,contentSha256:payloadHash})).toEqual({ok:true,value:{outcome:"deleted",contentSha256:payloadHash}});
    expect(calls).toEqual([
      {rpc:"get_my_sporting_records",body:{}},
      {rpc:"put_my_sporting_record",body:{p_record_kind:sportingRecord.recordKind,p_record_id:sportingRecord.recordId,p_schema_version:1,p_payload:sportingRecord.payload,p_recorded_at:SYNTHETIC_NOW}},
      {rpc:"delete_my_sporting_record",body:{p_record_kind:sportingRecord.recordKind,p_record_id:sportingRecord.recordId,p_expected_content_sha256:payloadHash}},
    ]);
  });
  it("preserves construction-bound services through healthy background confirmation", async () => {
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);sportingTransport(h);
    const service=runtime.createSportingCloudService(profileId)!;
    expect((await runtime.coordinator.revalidateGateFacts()).kind).toBe("resolved");
    expect(await service.restore()).toEqual({ok:true,value:[]});
  });
  it("keeps a service through transient background work without reminting",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);sportingTransport(h);
    const service=runtime.createSportingCloudService(profileId)!,original=h.fetch.getMockImplementation()!;
    h.fetch.mockRejectedValue(null);expect((await runtime.coordinator.revalidateGateFacts()).kind).toBe("temporarily_unavailable");
    h.fetch.mockImplementation(original);expect(await service.restore()).toEqual({ok:true,value:[]});
  });
  it("does not revive an old service after same-Profile reauthentication",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const calls=sportingTransport(h);
    const old=runtime.createSportingCloudService(profileId)!;
    expect((await runtime.coordinator.signOut()).kind).toBe("signed_out_locked");
    expect(await old.put(sportingRecord)).toEqual({ok:false,error:"unavailable"});
    expect((await runtime.coordinator.requestEmailOtp(user.email)).kind).toBe("otp_requested");
    expect(await runtime.coordinator.verifyEmailOtp(user.email,"123456")).toMatchObject({kind:"resolved",gate:{kind:"ready_online"}});
    expect(await old.put(sportingRecord)).toEqual({ok:false,error:"unavailable"});expect(calls).toEqual([]);
    const current=runtime.createSportingCloudService(profileId)!;expect(current).not.toBe(null);expect(await current.restore()).toEqual({ok:true,value:[]});
  });
  it.each(["profile","completion","incomplete"])("uses actual current %s Self negative and reports full genuine denial after FIFO release",async kind=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);
    const service=runtime.createSportingCloudService(profileId)!,notifications:unknown[]=[];
    runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});
    const negative=kind==="incomplete"?facts(false):{...facts(true),...(kind==="profile"?{profile_id:"88888888-8888-4888-8888-888888888888"}:{onboarding_completed_at:"2026-01-02T00:00:00Z"})};
    h.fetch.mockResolvedValue(response(negative));
    expect(await service.put(sportingRecord)).toEqual({ok:false,error:"unavailable"});
    expect(notifications).toEqual([expect.objectContaining({kind:"identity_invalidated",denial:"server_identity_invalidated",outstanding:[],transition:expect.objectContaining({mode:"foreground"})})]);
    expect(Object.isFrozen(notifications[0])).toBe(true);expect(await row(h,TRUSTED_DEVICE_STORAGE_KEY)).toBe(null);
    expect(runtime.createSportingCloudService(profileId)).toBe(null);
  });
  it("keeps sporting forbidden as sporting failure without manufacturing Identity denial",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);
    const original=h.fetch.getMockImplementation()!,notifications:unknown[]=[];runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});
    h.fetch.mockImplementation(async(...args)=>new URL((args[0] as Request).url).pathname.endsWith("put_my_sporting_record")?response({message:"forbidden: synthetic sporting failure"},403):original(...args));
    expect(await runtime.createSportingCloudService(profileId)!.put(sportingRecord)).toEqual({ok:false,error:"forbidden"});
    expect(notifications).toEqual([]);expect(await row(h,TRUSTED_DEVICE_STORAGE_KEY)).not.toBe(null);
  });
  it("captures original scalar inputs synchronously before queued SDK work",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const calls=sportingTransport(h),original=h.fetch.getMockImplementation()!;
    const entered=deferred<void>(),answer=deferred<Response>();releases.push(()=>answer.resolve(response([])));
    h.fetch.mockImplementation(async(...args)=>{if(new URL((args[0] as Request).url).pathname.endsWith("get_my_sporting_records")){entered.resolve();return answer.promise;}return original(...args);});
    const service=runtime.createSportingCloudService(profileId)!,first=service.restore();await entered.promise;
    const mutable={...sportingRecord},second=service.put(mutable);mutable.payload="Changed after entry";mutable.recordId="88888888-8888-4888-8888-888888888888";
    answer.resolve(response([]));expect((await first).ok).toBe(true);expect((await second).ok).toBe(true);
    expect(calls).toEqual([expect.objectContaining({body:expect.objectContaining({p_payload:sportingRecord.payload,p_record_id:sportingRecord.recordId})})]);
  });
  it("owns malformed capture independently without poisoning another actual SDK command",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);sportingTransport(h);const original=h.fetch.getMockImplementation()!;
    const entered=deferred<void>(),answer=deferred<Response>(),pending=deferred<void>();releases.push(()=>answer.resolve(response([])),()=>pending.resolve());Object.defineProperty(pending.promise,"then",{value:null});
    h.fetch.mockImplementation(async(...args)=>{if(new URL((args[0] as Request).url).pathname.endsWith("get_my_sporting_records")){entered.resolve();return answer.promise;}return original(...args);});
    const service=runtime.createSportingCloudService(profileId)!,first=service.restore();await entered.promise;let later=0;
    const malformed=service.put({get recordKind(){return pending.promise;},get recordId(){later++;return sportingRecord.recordId;}} as never);
    answer.resolve(response([]));expect(await first).toEqual({ok:true,value:[]});expect(later).toBe(0);expect(b.host.health()).toMatchObject({sdkFailed:false,identityFailed:false});
    const cleanup=b.host.dispose();let done=false;void cleanup.then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);
    pending.resolve();expect(await malformed).toEqual({ok:false,error:"invalid_input"});expect(await cleanup).toEqual({ok:true});
  });
  it("retires every bound call after close without input getters or new I/O",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!;await b.host.dispose();let read=false;h.fetch.mockClear();
    expect(await service.put({get recordKind(){read=true;throw null;}} as never)).toEqual({ok:false,error:"unavailable"});
    expect(await service.restore()).toEqual({ok:false,error:"unavailable"});expect(read).toBe(false);expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("native sporting ownership and genuine denial controls", () => {
  it("mints a cold correlated admission from the actual retained trusted state",async()=>{
    const h=await fixture(),first=await bootstrap(h),original=await first.start();await onboard(h,original);await first.host.dispose();
    vi.resetModules();const hostModule=await import("../supabaseAuthService");
    const made=await hostModule.createNativeSportingIdentityHost({...h.options,callbackUrlAccess:{readCurrentUrl:()=>"https://app.example.invalid/",replaceCurrentUrl(){}}});
    if(!made.ok)throw null;hosts.push(made.host);const started=await made.host.start();if(started.outcome!=="ready")throw null;
    expect(started.runtime.createSportingCloudService(profileId)).toBe(null);
    expect((await started.runtime.startUpOnce()).verdict.kind).toBe("ready_online");sportingTransport(h);
    expect(await started.runtime.createSportingCloudService(profileId)!.restore()).toEqual({ok:true,value:[]});
  });
  it("never mints from successful background work when no actual foreground admission exists",async()=>{
    const h=await fixture(),first=await bootstrap(h),old=await first.start();await onboard(h,old);await first.host.dispose();
    vi.resetModules();const hostModule=await import("../supabaseAuthService");const made=await hostModule.createNativeSportingIdentityHost({...h.options,callbackUrlAccess:{readCurrentUrl:()=>null,replaceCurrentUrl(){}}});if(!made.ok)throw null;hosts.push(made.host);
    const started=await made.host.start();if(started.outcome!=="ready")throw null;
    expect((await started.runtime.coordinator.revalidateGateFacts()).kind).toBe("resolved");
    expect(started.runtime.createSportingCloudService(profileId)).toBe(null);
  });
  for(const failure of ["clean","remove_fault","account_swap"] as const) it(`preserves actual provider denial or account mismatch through ${failure}`,async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,notifications:unknown[]=[];
    runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});const now=Date.now;vi.spyOn(Date,"now").mockImplementation(()=>now()+7200_000);const paths:string[]=[];
    h.fetch.mockImplementation(async input=>{const path=new URL((input as Request).url).pathname;paths.push(path);if(!path.endsWith("/token"))throw null;
      if(failure==="remove_fault")h.faults.hook=async(event,next)=>{if(event.kind==="remove"&&h.item(event)===h.root)throw null;return next();};
      return failure==="account_swap"?response({...session(),user:{...user,id:"99999999-9999-4999-8999-999999999999"}}):denied();
    });
    expect(await service.put(sportingRecord)).toEqual({ok:false,error:"unavailable"});
    expect(paths).toEqual(["/auth/v1/token"]);expect(notifications).toEqual([expect.objectContaining({kind:"identity_invalidated",denial:"server_identity_invalidated",outstanding:[]})]);
    expect(b.host.health().storageFailed).toBe(failure==="remove_fault");expect(await row(h,TRUSTED_DEVICE_STORAGE_KEY)).toBe(null);
  });
  it("does not relabel a failed rotation write as actual provider denial",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,notifications:unknown[]=[];
    runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});const now=Date.now;vi.spyOn(Date,"now").mockImplementation(()=>now()+7200_000);
    h.fetch.mockImplementation(async()=>{h.faults.hook=async(event,next)=>{if(event.kind==="write"&&h.item(event)===h.root)throw null;return next();};return response(session());});
    expect(await service.restore()).toEqual({ok:false,error:"unavailable"});expect(notifications).toEqual([]);expect(b.host.health().storageFailed).toBe(true);
  });
  it("delivers the actual full durable-denial failure instead of only a progress or cloud error",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,notifications:unknown[]=[];
    runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});
    h.sqlFaults.hook=async(event,next)=>{if(event.kind==="run"&&event.values?.[0]===IDENTITY_BARRIER_STORAGE_KEY)throw null;return next();};h.fetch.mockResolvedValue(response(facts(false)));
    expect(await service.restore()).toEqual({ok:false,error:"unavailable"});
    expect(notifications).toEqual([expect.objectContaining({kind:"durable_denial_unavailable",denial:"durable_denial_unavailable",outstanding:expect.arrayContaining(["durable_barrier","trusted_state"]),transition:expect.objectContaining({mode:"foreground"})})]);
    expect(runtime.createSportingCloudService(profileId)).toBe(null);
  });
  it("does not invalidate a newer operation from an old late Self negative",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,notifications:unknown[]=[];runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});
    const original=h.fetch.getMockImplementation()!,entered=deferred<void>(),answer=deferred<Response>();releases.push(()=>answer.resolve(response(facts(false))));
    h.fetch.mockImplementation(async(...args)=>{if(new URL((args[0] as Request).url).pathname.endsWith("get_my_gate_state")){entered.resolve();return answer.promise;}return original(...args);});
    const old=service.restore();await entered.promise;const newer=runtime.coordinator.requestEmailOtp(user.email);answer.resolve(response(facts(false)));
    expect(await old).toEqual({ok:false,error:"unavailable"});await newer;expect(notifications).toEqual([]);
    expect(JSON.parse((await row(h,IDENTITY_BARRIER_STORAGE_KEY))!).origin).not.toBe("server_identity_invalidated");
  });
  it("completes and reports already-begun real denial despite a newer operation",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,notifications:unknown[]=[];let newer:Promise<unknown>|null=null;
    runtime.subscribeToProgress(phase=>{if(phase==="identity_denied_in_memory")newer=runtime.coordinator.requestEmailOtp(user.email);});runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});h.fetch.mockResolvedValue(response(facts(false)));
    expect(await service.restore()).toEqual({ok:false,error:"unavailable"});await newer;
    expect(notifications).toEqual([expect.objectContaining({denial:"server_identity_invalidated",outstanding:[]})]);
  });
  it.each(["independent","own-disposal"])("owns invalidation observer work: %s",async kind=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,pending=deferred<void>();releases.push(()=>pending.resolve());Object.defineProperty(pending.promise,"then",{value:null});let closing:Promise<unknown>|null=null;
    runtime.subscribeToIdentityInvalidations(()=>kind==="own-disposal"?(closing=b.host.dispose()):pending.promise);h.fetch.mockResolvedValue(response(facts(false)));
    expect(await service.restore()).toEqual({ok:false,error:"unavailable"});const cleanup=closing??b.host.dispose();let done=false;void cleanup.then(()=>{done=true;});
    if(kind==="independent"){await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);}pending.resolve();expect(await cleanup).toEqual({ok:true});
  });
  it("refuses malformed Self facts without manufacturing a denial",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,notifications:unknown[]=[];runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});h.fetch.mockResolvedValue(response({...facts(true),profile_id:"invalid"}));
    expect(await service.restore()).toEqual({ok:false,error:"unavailable"});expect(notifications).toEqual([]);expect(await row(h,TRUSTED_DEVICE_STORAGE_KEY)).not.toBe(null);
  });
  it("does not retry a sporting mutation with unknown server completion",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const original=h.fetch.getMockImplementation()!,service=runtime.createSportingCloudService(profileId)!;let sends=0;
    h.fetch.mockImplementation(async(...args)=>{if(new URL((args[0] as Request).url).pathname.endsWith("put_my_sporting_record")){sends++;throw null;}return original(...args);});
    expect((await service.put(sportingRecord)).ok).toBe(false);expect(sends).toBe(1);expect(b.host.health().storageFailed).toBe(false);
  });
  it("cancels actual response-body work without late result publication",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const original=h.fetch.getMockImplementation()!,service=runtime.createSportingCloudService(profileId)!,entered=deferred<void>();let controller!:ReadableStreamDefaultController<Uint8Array>;
    const stream=new ReadableStream<Uint8Array>({start(value){controller=value;}});releases.push(()=>{try{controller.close();}catch{}});
    h.fetch.mockImplementation(async(...args)=>{if(new URL((args[0] as Request).url).pathname.endsWith("get_my_sporting_records")){entered.resolve();return new Response(stream,{headers:{"Content-Type":"application/json"}});}return original(...args);});
    const work=service.restore();await entered.promise;const cleanup=b.host.dispose();let done=false;void cleanup.then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);
    controller.enqueue(new TextEncoder().encode("[]"));controller.close();expect(await work).toEqual({ok:false,error:"unavailable"});expect(await cleanup).toEqual({ok:true});
  });
});

describe("native sporting real SyncManager integration", () => {
  it("keeps an old manager's real pending outbox from uploading under a later admission",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!;const calls=sportingTransport(h);
    const {createProfileScopedSportingRepositories,createProfileScopedSportingStorageAdapter}=await import("../../persistence/profileScopedSportingPersistence");
    const {createSportingSyncStateRepository}=await import("../../cloudSporting/syncStateRepository");const {SportingCloudSyncManager}=await import("../../cloudSporting/syncManager");
    // A separate injected local adapter isolates this manager/service test. It
    // does not claim the application's sporting repositories are natively mounted.
    const values=new Map<string,string>();const adapter={get:async(key:string)=>({status:"value" as const,value:values.get(key)??null}),set:async(key:string,value:string)=>{values.set(key,value);return{ok:true as const};}};
    const repositories=createProfileScopedSportingRepositories(profileId,adapter),sync=createSportingSyncStateRepository(createProfileScopedSportingStorageAdapter(profileId,adapter));let online=false;
    const manager=new SportingCloudSyncManager(repositories,sync,service,()=>online,null,profileId);
    await repositories.session.saveHistory([{id:sportingRecord.recordId,title:"Synthetic old pending training",date:SYNTHETIC_NOW,notes:"",blocks:[],activeBlockId:"",shots:[]}]);await manager.initialize();
    expect(manager.getSnapshot()).toMatchObject({pendingCount:1,truth:"saved_on_device"});
    await runtime.coordinator.signOut();await runtime.coordinator.requestEmailOtp(user.email);expect(await runtime.coordinator.verifyEmailOtp(user.email,"123456")).toMatchObject({kind:"resolved",gate:{kind:"ready_online"}});
    online=true;await manager.synchronize();expect(calls).toEqual([]);expect(manager.getSnapshot()).toMatchObject({pendingCount:1,truth:"saved_on_device"});
    expect(await runtime.createSportingCloudService(profileId)!.restore()).toEqual({ok:true,value:[]});
  });
});

describe("native sporting actual boundary regressions", () => {
  it("uses exactly one actual public SDK getSession per whole sporting command",async()=>{
    const h=await fixture(),{AuthClient}=await import("@supabase/supabase-js"),getSession=vi.spyOn(AuthClient.prototype,"getSession");
    const b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);sportingTransport(h);const service=runtime.createSportingCloudService(profileId)!;getSession.mockClear();
    expect((await service.put(sportingRecord)).ok).toBe(true);expect(getSession).toHaveBeenCalledTimes(1);
  });
  it.each(["root-promise","rejected-field","throwing-field"])("contains %s capture before SDK or later getters",async kind=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const service=runtime.createSportingCloudService(profileId)!,pending=deferred<void>();releases.push(()=>pending.resolve());let later=0;
    const input=kind==="root-promise"?Object.assign(pending.promise,sportingRecord):{get recordKind(){if(kind==="throwing-field")throw null;return Promise.reject(null);},get recordId(){later++;return sportingRecord.recordId;}};
    h.fetch.mockClear();const result=service.put(input as never);if(kind==="root-promise"){let done=false;void result.then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);}pending.resolve();
    expect(await result).toEqual({ok:false,error:"invalid_input"});expect(later).toBe(0);expect(h.fetch).not.toHaveBeenCalled();expect(b.host.health()).toMatchObject({sdkFailed:false,identityFailed:false});
  });
  it("owns a malformed Profile selector without granting or poisoning actual admission",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const pending=deferred<void>();releases.push(()=>pending.resolve());Object.defineProperty(pending.promise,"then",{value:null});
    expect(runtime.createSportingCloudService(pending.promise as never)).toBe(null);expect(runtime.createSportingCloudService(profileId)).not.toBe(null);
    const cleanup=b.host.dispose();let done=false;void cleanup.then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);pending.resolve();expect(await cleanup).toEqual({ok:true});
  });
  for(const mutation of ["body","schema","supersession"] as const) it(`checks original sporting command after final Request ${mutation}`,async()=>{
    const h=await fixture(),OriginalRequest=Request;let armed=false,newer:Promise<unknown>|null=null,runtime:Awaited<ReturnType<Awaited<ReturnType<typeof bootstrap>>["start"]>>|null=null;
    vi.stubGlobal("Request",class extends OriginalRequest {
      constructor(input:RequestInfo|URL,init?:RequestInit){
        if(armed&&input instanceof OriginalRequest&&input.url.endsWith("/rpc/put_my_sporting_record")){
          const headers=new Headers(init?.headers??input.headers);
          if(mutation==="schema")headers.set("Content-Profile","private");
          super(input,{...init,headers,...(mutation==="body"?{body:JSON.stringify({p_record_kind:sportingRecord.recordKind,p_record_id:sportingRecord.recordId,p_schema_version:1,p_payload:"changed",p_recorded_at:SYNTHETIC_NOW})}:{})});
          if(mutation==="supersession"){armed=false;newer=runtime!.coordinator.requestEmailOtp(user.email);}
        }else super(input,init);
      }
    });
    const b=await bootstrap(h);runtime=await b.start();await onboard(h,runtime);const calls=sportingTransport(h),service=runtime.createSportingCloudService(profileId)!;armed=true;
    expect(await service.put(sportingRecord)).toEqual({ok:false,error:"unavailable"});await newer;expect(calls).toEqual([]);expect(b.host.health().sdkFailed).toBe(mutation!=="supersession");
  });
  it("does not pretend an offline Profile admission authorizes unavailable cloud work",async()=>{
    const h=await fixture(),first=await bootstrap(h),original=await first.start();await onboard(h,original);await first.host.dispose();vi.resetModules();const hostModule=await import("../supabaseAuthService");
    const made=await hostModule.createNativeSportingIdentityHost({...h.options,callbackUrlAccess:{readCurrentUrl:()=>null,replaceCurrentUrl(){}}});if(!made.ok)throw null;hosts.push(made.host);const started=await made.host.start();if(started.outcome!=="ready")throw null;
    const now=Date.now;let offset=7200_000;vi.spyOn(Date,"now").mockImplementation(()=>now()+offset);h.fetch.mockImplementation(async()=>{offset+=40000;throw null;});
    expect((await started.runtime.startUpOnce()).verdict.kind).toBe("ready_offline");const service=started.runtime.createSportingCloudService(profileId)!;expect(service).not.toBe(null);
    expect(await service.restore()).toEqual({ok:false,error:"unavailable"});expect(made.host.health().storageFailed).toBe(false);
  });
  it("publishes detached frozen sporting records through the existing mapper",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const original=h.fetch.getMockImplementation()!;
    const raw={record_kind:sportingRecord.recordKind,record_id:sportingRecord.recordId,schema_version:1,payload:sportingRecord.payload,content_sha256:payloadHash,recorded_at:SYNTHETIC_NOW};
    h.fetch.mockImplementation(async(...args)=>new URL((args[0] as Request).url).pathname.endsWith("get_my_sporting_records")?response([raw]):original(...args));
    const result=await runtime.createSportingCloudService(profileId)!.restore();expect(result.ok).toBe(true);if(!result.ok)throw null;raw.payload="later transport mutation";
    expect(result.value).toEqual([{...sportingRecord,contentSha256:payloadHash}]);expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.value)).toBe(true);expect(Object.isFrozen(result.value[0])).toBe(true);
  });
  it("routes real Self forbidden through the authentic Identity invalidator",async()=>{
    const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);const notifications:unknown[]=[];runtime.subscribeToIdentityInvalidations(value=>{notifications.push(value);});h.fetch.mockResolvedValue(response({message:"forbidden: synthetic Self denial"},403));
    expect(await runtime.createSportingCloudService(profileId)!.restore()).toEqual({ok:false,error:"unavailable"});expect(notifications).toEqual([expect.objectContaining({kind:"identity_invalidated",outstanding:[]})]);
  });
});

describe("native sporting capture revocation", () => {
  const shapes = [
    { method: "put" as const, fields: ["recordKind", "recordId", "schemaVersion", "payload", "recordedAt"], value: sportingRecord },
    { method: "delete" as const, fields: ["recordKind", "recordId", "contentSha256"], value: { recordKind: sportingRecord.recordKind, recordId: sportingRecord.recordId, contentSha256: payloadHash } },
  ];
  for (const shape of shapes) for (const stop of ["close", "foreground"] as const) {
    for (const at of shape.fields) it(`stops ${shape.method} capture at ${at} after ${stop}`, async () => {
      const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
      const service = runtime.createSportingCloudService(profileId)!, calls = sportingTransport(h), read: string[] = [];
      let cancellation: Promise<unknown> | null = null;
      const input = Object.fromEntries(shape.fields.map(key => [key, undefined]));
      for (const key of shape.fields) Object.defineProperty(input, key, { get() {
        read.push(key);
        if (key === at) cancellation = stop === "close" ? b.host.dispose() : runtime.coordinator.requestEmailOtp(user.email);
        return (shape.value as Record<string, unknown>)[key];
      } });
      expect(await service[shape.method](input as never)).toEqual({ ok: false, error: "unavailable" });
      await cancellation;
      expect(read).toEqual(shape.fields.slice(0, shape.fields.indexOf(at) + 1)); expect(calls).toEqual([]);
    });
    for (const at of [shape.fields[0], shape.fields.at(-1)!]) it(`owns masked work returned by cancelling ${shape.method}.${at} on ${stop}`, async () => {
      const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
      const service = runtime.createSportingCloudService(profileId)!, calls = sportingTransport(h), pending = deferred<void>(), read: string[] = [];
      releases.push(() => pending.resolve()); Object.defineProperty(pending.promise, "then", { value: null });
      let cancellation: Promise<unknown> | null = null;
      const input: Record<string, unknown> = {};
      for (const key of shape.fields) Object.defineProperty(input, key, { get() {
        read.push(key);
        if (key !== at) return (shape.value as Record<string, unknown>)[key];
        cancellation = stop === "close" ? b.host.dispose() : runtime.coordinator.requestEmailOtp(user.email);
        return pending.promise;
      } });
      const work = service[shape.method](input as never), cleanup = b.host.dispose();
      let settled = false; void cleanup.then(() => { settled = true; });
      await new Promise(resolve => setTimeout(resolve, 15)); expect(settled).toBe(false);
      expect(read).toEqual(shape.fields.slice(0, shape.fields.indexOf(at) + 1));
      pending.resolve(); expect(await work).toEqual({ ok: false, error: "unavailable" }); await cancellation;
      expect(await cleanup).toEqual({ ok: true }); expect(calls).toEqual([]);
    });
    it(`owns a rejected value from the cancelling ${shape.method} getter on ${stop}`, async () => {
      const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
      const service = runtime.createSportingCloudService(profileId)!, calls = sportingTransport(h); let later = 0, cancellation: Promise<unknown> | null = null;
      const input = { get recordKind() {
        cancellation = stop === "close" ? b.host.dispose() : runtime.coordinator.requestEmailOtp(user.email);
        return Promise.reject(null);
      }, get recordId() { later++; return sportingRecord.recordId; } };
      expect(await service[shape.method](input as never)).toEqual({ ok: false, error: "unavailable" }); await cancellation;
      expect(later).toBe(0); expect(calls).toEqual([]);
    });
  }
  for (const shape of shapes) it(`does not invoke new pending work after ${shape.method} capture closes`, async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
    const service = runtime.createSportingCloudService(profileId)!, pending = deferred<void>(); releases.push(() => pending.resolve());
    Object.defineProperty(pending.promise, "then", { value: null }); let later = 0;
    const input = { get recordKind() { void b.host.dispose(); return "training_session"; }, get recordId() { later++; return pending.promise; } };
    const work = service[shape.method](input as never); expect(later).toBe(0);
    expect(await work).toEqual({ ok: false, error: "unavailable" }); expect(await b.host.dispose()).toEqual({ ok: true });
  });
  for (const shape of shapes) it(`recognizes the exact own-disposal Promise from ${shape.method} capture`, async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
    const service = runtime.createSportingCloudService(profileId)!; let later = 0;
    const input = { get recordKind() { return b.host.dispose(); }, get recordId() { later++; return sportingRecord.recordId; } };
    expect(await service[shape.method](input as never)).toEqual({ ok: false, error: "unavailable" });
    expect(later).toBe(0); expect(await b.host.dispose()).toEqual({ ok: true });
  });
});
