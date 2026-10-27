// Actual installed public AuthClient + disposable real SQLite. All values and
// transports are synthetic/injected; no platform Keychain or real account.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityRuntimeReady } from "../../identity/identityRuntime";
import { IDENTITY_BARRIER_STORAGE_KEY } from "../../identity/identityBarrier";
import { TRUSTED_DEVICE_STORAGE_KEY } from "../../identity/trustedDevice";
import { DELETION_GUARD_PREFIX } from "../../identity/accountDeletionGuard";
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
  const created = await h.module.createNativeIdentityBootstrapHost({ ...h.options, callbackUrlAccess, ...overrides });
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

describe("actual dormant native Identity bootstrap", () => {
  it("owns one real startup and anonymous Legal with no public credential/SDK surface", async () => {
    const h = await fixture(), b = await bootstrap(h); server(h);
    expect(Object.keys(b.host).sort()).toEqual(["dispose", "health", "start"]);
    expect(h.events).toEqual([]); expect(h.fetch).not.toHaveBeenCalled();
    const first = b.host.start(); expect(b.host.start()).toBe(first);
    const started = await first; expect(started.outcome).toBe("ready");
    const runtime = await b.start(); expect(Object.isFrozen(runtime)).toBe(true); expect(runtime.status).toBe("ready");
    const [a, c] = await Promise.all([runtime.startUpOnce(), runtime.coordinator.startUp()]);
    expect(a).toEqual(c); expect(a.verdict.kind).toBe("signed_out");
    expect(b.callbackUrlAccess.readCurrentUrl).toHaveBeenCalledTimes(1); expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(b.host.health())).not.toMatch(/SYNTHETIC_HOST|identity-fixture|example.invalid|pc1:/);
  });
  it("completes real SDK OTP/Legal/onboarding and stores trusted state in the retained SQLite", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start();
    await onboard(h, runtime);
    const stored = JSON.parse((await row(h, TRUSTED_DEVICE_STORAGE_KEY))!);
    expect(stored.profileId).toBe(profileId); expect(stored.accountScopeId).toBe(user.id);
    expect(h.events.filter(event => event.kind === "configure")).toHaveLength(1);
    expect(h.trace.filter(event => event.kind === "open")).toHaveLength(1);
    expect((await b.host.start()).outcome).toBe("ready");
    expect(b.host.health().identityFailed).toBe(false);
  });
  it("revokes fulfilled startup replay and every held runtime operation after actual disposal", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
    expect(await b.host.dispose()).toEqual({ ok: true });
    const io = [h.trace.length, h.events.length, h.fetch.mock.calls.length, b.callbackUrlAccess.readCurrentUrl.mock.calls.length];
    expect(await b.host.start()).toEqual({ outcome: "closed" });
    const replay = await runtime.startUpOnce(); expect(replay.verdict.kind).toBe("identity_unconfirmed");
    expect((await runtime.coordinator.startUp()).transition).toEqual(replay.transition);
    for (const result of await Promise.all([
      runtime.coordinator.requestEmailOtp(user.email), runtime.coordinator.verifyEmailOtp(user.email, "123456"), runtime.coordinator.startGoogleSignIn(),
      runtime.coordinator.retryTrustedStateEstablishment(), runtime.coordinator.revalidateGateFacts(), runtime.coordinator.signOut(),
      runtime.coordinator.recoverInvitationAccount({} as never), runtime.coordinator.capturePendingIntent({} as never), runtime.coordinator.discardPendingIntent(),
      runtime.coordinator.refreshLegalSnapshot(), runtime.coordinator.observeNewerBarrier(), runtime.coordinator.invalidateIdentity(),
      runtime.coordinator.submitOnboarding({} as never), runtime.captureCurrentDeepLinkIntent(), runtime.loadPendingIntent(),
    ])) expect(JSON.stringify(result)).not.toMatch(/ready_online|ready_offline|completed|signed_out_locked/);
    expect([h.trace.length, h.events.length, h.fetch.mock.calls.length, b.callbackUrlAccess.readCurrentUrl.mock.calls.length]).toEqual(io);
  });
  it("does not let an old original operation send its next Self-RPC after a newer transition", async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start();
    const entered = deferred<void>(), answer = deferred<Response>(); releases.push(() => answer.resolve(response({ id: profileId, display_name: null })));
    const paths: string[] = [];
    h.fetch.mockImplementation(async input => {
      const path = new URL((input as Request).url).pathname; paths.push(path);
      if (path.endsWith("ensure_my_profile")) { entered.resolve(); return answer.promise; }
      return response({});
    });
    const startup = runtime.startUpOnce(); await entered.promise;
    const newer = runtime.coordinator.requestEmailOtp(user.email); answer.resolve(response({ id: profileId, display_name: null }));
    expect((await startup).verdict.kind).toBe("identity_unconfirmed"); expect((await newer).kind).toBe("otp_requested");
    expect(paths.some(path => path.endsWith("get_my_gate_state"))).toBe(false);
  });
  it("cancels the genuine owner immediately and holds pending RPC/body through cleanup", async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start();
    const entered = deferred<void>(), answer = deferred<Response>(); releases.push(() => answer.resolve(response({ id: profileId, display_name: null })));
    h.fetch.mockImplementation(async () => { entered.resolve(); return answer.promise; });
    const starting = runtime.startUpOnce(); await entered.promise;
    const disposing = b.host.dispose(); expect(b.host.dispose()).toBe(disposing);
    expect(b.host.health().phase).toBe("closing"); let finished = false; void disposing.then(() => { finished = true; });
    await Promise.resolve(); expect(finished).toBe(false);
    answer.resolve(response({ id: profileId, display_name: null }));
    expect((await starting).verdict.kind).toBe("identity_unconfirmed"); expect(await disposing).toEqual({ ok: true });
    expect(h.fetch).toHaveBeenCalledTimes(1);
  });
  it("owns masked malformed callback returns and blocks startup without inventing storage/provider fault", async () => {
    const h = await fixture(), pending = deferred<void>(); releases.push(() => pending.resolve()); Object.defineProperty(pending.promise, "then", { value: undefined });
    const b = await bootstrap(h, { callbackUrlAccess: { readCurrentUrl: () => pending.promise as never, replaceCurrentUrl() {} } });
    const runtime = await b.start(); expect((await runtime.startUpOnce()).verdict.kind).not.toMatch(/^ready_/);
    expect(b.host.health()).toMatchObject({ identityFailed: true, storageFailed: false }); expect(h.fetch).not.toHaveBeenCalled();
    let done = false; const disposal = b.host.dispose(); void disposal.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    pending.resolve(); expect(await disposal).toEqual({ ok: true });
  });
  it("vetoes credential-fault offline startup with actual retained correlated trusted state", async () => {
    const h = await fixture(), first = await bootstrap(h), original = await first.start(); await onboard(h, original); await first.host.dispose();
    vi.resetModules(); const hostModule = await import("../supabaseAuthService");
    const created = await hostModule.createNativeIdentityBootstrapHost({ ...h.options, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl() {} } });
    expect(created.ok).toBe(true); if (!created.ok) throw null; hosts.push(created.host);
    const started = await created.host.start(); expect(started.outcome).toBe("ready"); if (started.outcome !== "ready") throw null;
    const barrier = await row(h, IDENTITY_BARRIER_STORAGE_KEY);
    h.faults.hook = async (event, next) => { if (event.kind === "read" && h.item(event) === h.root) throw null; return next(); };
    const result = await started.runtime.startUpOnce(); expect(result.verdict.kind).toBe("identity_unconfirmed");
    expect(created.host.health().storageFailed).toBe(true); expect(await row(h, IDENTITY_BARRIER_STORAGE_KEY)).toBe(barrier);
  });
  it("preserves healthy correlated online startup instead of applying a blanket native veto", async () => {
    const h = await fixture(), first = await bootstrap(h), original = await first.start(); await onboard(h, original); await first.host.dispose();
    vi.resetModules(); const hostModule = await import("../supabaseAuthService");
    const created = await hostModule.createNativeIdentityBootstrapHost({ ...h.options, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl() {} } });
    if (!created.ok) throw null; hosts.push(created.host); const started = await created.host.start(); if (started.outcome !== "ready") throw null;
    expect((await started.runtime.startUpOnce()).verdict.kind).toBe("ready_online"); expect(created.host.health().storageFailed).toBe(false);
    await created.host.dispose();
    expect((await started.runtime.startUpOnce()).verdict.kind).toBe("identity_unconfirmed");
  });

  for (const failure of ["clean", "remove_fault", "account_swap"] as const) it(`delivers actual Self-preflight auth causality to the real coordinator: ${failure}`, async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start();
    const actualNow = Date.now;
    runtime.subscribeToProgress(phase => { if (phase === "ensuring_profile") vi.spyOn(Date, "now").mockImplementation(() => actualNow() + 7200_000); });
    const paths: string[] = [];
    h.fetch.mockImplementation(async input => {
      const path = new URL((input as Request).url).pathname; paths.push(path);
      if (!path.endsWith("/token")) throw new Error("Unexpected Self SEND");
      if (failure === "remove_fault") h.faults.hook = async (event, next) => { if (event.kind === "remove" && h.item(event) === h.root) throw null; return next(); };
      return failure === "account_swap" ? response({ ...session(), user: { ...user, id: "77777777-7777-4777-8777-777777777777" } }) : denied();
    });
    const result = await runtime.startUpOnce();
    expect(result.verdict).toMatchObject({ kind: "locked", origin: "server_identity_invalidated" });
    expect(result.finalization?.denial).toBe("server_identity_invalidated");
    expect(paths).toEqual(["/auth/v1/token"]);
    expect(JSON.parse((await row(h, IDENTITY_BARRIER_STORAGE_KEY))!).origin).toBe("server_identity_invalidated");
    expect(b.host.health().storageFailed).toBe(failure === "remove_fault");
  });

  it("does not classify a failed rotation write as a provider denial", async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start(), actualNow = Date.now;
    runtime.subscribeToProgress(phase => { if (phase === "ensuring_profile") vi.spyOn(Date, "now").mockImplementation(() => actualNow() + 7200_000); });
    h.fetch.mockImplementation(async () => {
      h.faults.hook = async (event, next) => { if (event.kind === "write" && h.item(event) === h.root) throw null; return next(); };
      return response(session());
    });
    const result = await runtime.startUpOnce(); expect(result.verdict.kind).toBe("identity_unconfirmed");
    expect(result.finalization).toBe(null); expect(await row(h, IDENTITY_BARRIER_STORAGE_KEY)).toBe(null);
    expect(b.host.health().storageFailed).toBe(true);
  });

  it("blocks a stale actual RPC forbidden result from invalidating the newer operation", async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start();
    const entered = deferred<void>(), answer = deferred<Response>(); releases.push(() => answer.resolve(response({ message: "forbidden: synthetic" }, 403)));
    h.fetch.mockImplementation(async input => {
      if (new URL((input as Request).url).pathname.endsWith("ensure_my_profile")) { entered.resolve(); return answer.promise; }
      return response({});
    });
    const old = runtime.startUpOnce(); await entered.promise;
    const newer = runtime.coordinator.requestEmailOtp(user.email); answer.resolve(response({ message: "forbidden: synthetic" }, 403));
    expect((await old).finalization).toBe(null); expect((await newer).kind).toBe("otp_requested");
    expect(JSON.parse((await row(h, IDENTITY_BARRIER_STORAGE_KEY))!).origin).not.toBe("server_identity_invalidated");
  });

  for (const slot of ["port", "read", "replace"] as const) it(`owns malformed masked factory URL dependency: ${slot}`, async () => {
    const h = await fixture(), pending = deferred<void>(); releases.push(() => pending.resolve()); Object.defineProperty(pending.promise, "then", { value: undefined });
    const port = slot === "port" ? pending.promise : { readCurrentUrl: slot === "read" ? pending.promise : () => null, replaceCurrentUrl: slot === "replace" ? pending.promise : () => {} };
    let settled = false;
    const creating = h.module.createNativeIdentityBootstrapHost({ ...h.options, callbackUrlAccess: port as never }); void creating.then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false); expect(h.events).toEqual([]);
    expect(await h.make()).toEqual({ ok: false, reason: "ownership_conflict" }); pending.resolve();
    expect(await creating).toEqual({ ok: false, reason: "invalid_dependency" });
  });

  it("does not retry an actual POST mutation after a lost transport response", async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start();
    h.fetch.mockRejectedValue(new Error("Synthetic response lost after possible server mutation"));
    const result = await runtime.startUpOnce(); expect(result.verdict.kind).toBe("identity_unconfirmed");
    expect(h.fetch).toHaveBeenCalledTimes(1); expect(b.host.health().storageFailed).toBe(false);
  });

  it("preserves and cleans deep-link intent through the same captured URL port once", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start();
    b.setUrl("https://app.example.invalid/?inviteToken=synthetic-invitation-token&unrelated=keep");
    const first = await runtime.captureCurrentDeepLinkIntent(), second = await runtime.captureCurrentDeepLinkIntent();
    expect(first).toMatchObject({ kind: "captured", intent: { capturedAt: SYNTHETIC_NOW } }); expect(second).toEqual(first);
    expect(b.callbackUrlAccess.replaceCurrentUrl).toHaveBeenCalledTimes(1);
    expect(b.callbackUrlAccess.replaceCurrentUrl.mock.calls[0][0]).toBe("https://app.example.invalid/?unrelated=keep");
    expect(await runtime.loadPendingIntent()).toMatchObject({ kind: "invitation" });
  });

  for (const base of ["", "/", "/proxy", "/proxy/"]) it(`confines fixed actual RPCs to the installed base derivation: ${base || "root"}`, async () => {
    const h = await fixture("valid"); const paths = server(h);
    const b = await bootstrap(h, { config: { ...h.options.config, url: h.options.config.url + base } }), runtime = await b.start();
    expect((await runtime.startUpOnce()).verdict.kind).toBe("onboarding_required");
    const rest = (base.replace(/\/$/, "") || "") + "/rest/v1/rpc/";
    expect(paths.map(value => value.path)).toEqual(["ensure_my_profile", "get_my_gate_state", "get_current_legal_documents"].map(name => rest + name));
    expect(paths.map(value => value.authorized)).toEqual([true, true, false]);
  });

  it("keeps actual retryable network-only refresh eligible for healthy correlated offline startup", async () => {
    const h = await fixture(), first = await bootstrap(h), original = await first.start(); await onboard(h, original); await first.host.dispose();
    vi.resetModules(); const hostModule = await import("../supabaseAuthService");
    const created = await hostModule.createNativeIdentityBootstrapHost({ ...h.options, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl() {} } });
    if (!created.ok) throw null; hosts.push(created.host); const started = await created.host.start(); if (started.outcome !== "ready") throw null;
    const actualNow = Date.now; let offset = 7200_000;
    vi.spyOn(Date, "now").mockImplementation(() => actualNow() + offset);
    h.fetch.mockClear(); h.fetch.mockImplementation(async () => { offset += 40000; throw new Error("Synthetic network-only failure"); });
    expect((await started.runtime.startUpOnce()).verdict.kind).toBe("ready_offline");
    expect(created.host.health()).toMatchObject({ storageFailed: false, sdkFailed: false, identityFailed: false }); expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  for (const property of ["ok", "status", "headers", "json"]) it(`ignores foreign data Response own ${property} fields before actual RPC parsing`, async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start(); server(h); let reads = 0;
    const ordinary = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (...args) => {
      const value = await ordinary(...args);
      Object.defineProperty(value, property, { get() { reads++; throw new Error("Synthetic private forged response"); } }); return value;
    });
    expect((await runtime.startUpOnce()).verdict.kind).toBe("onboarding_required"); expect(reads).toBe(0);
  });

  it("holds an actual incomplete data response body through disposal without late Self SEND", async () => {
    const h = await fixture("valid"), b = await bootstrap(h), runtime = await b.start();
    const entered = deferred<void>(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    let finished = false; releases.push(() => { if (!finished) { finished = true; controller.close(); } });
    h.fetch.mockImplementation(async () => { entered.resolve(); return new Response(body, { headers: { "Content-Type": "application/json" } }); });
    const startup = runtime.startUpOnce(); await entered.promise; const cleanup = b.host.dispose(); let cleaned = false; void cleanup.then(() => { cleaned = true; });
    await Promise.resolve(); expect(cleaned).toBe(false);
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ id: profileId, display_name: null }))); controller.close(); finished = true;
    expect((await startup).verdict.kind).toBe("identity_unconfirmed"); expect(await cleanup).toEqual({ ok: true }); expect(h.fetch).toHaveBeenCalledTimes(1);
  });

  it("owns malformed native Header acknowledgements before data SEND and cleanup release", async () => {
    const h = await fixture("valid"), pending = deferred<void>(), entered = deferred<void>(); releases.push(() => pending.resolve()); Object.defineProperty(pending.promise, "then", { value: undefined });
    const actualSet = Headers.prototype.set;
    vi.spyOn(Headers.prototype, "set").mockImplementation(function (this: Headers, name, value) {
      actualSet.call(this, name, value);
      if (name === "Authorization" && value === "Bearer SYNTHETIC_HOST_ACCESS") { entered.resolve(); return pending.promise as never; }
      return undefined;
    });
    const b = await bootstrap(h), runtime = await b.start();
    const startup = runtime.startUpOnce();
    await entered.promise;
    expect(b.host.health().sdkFailed).toBe(true); expect(h.fetch).not.toHaveBeenCalled();
    const cleanup = b.host.dispose(); let done = false; void cleanup.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    pending.resolve(); expect((await startup).verdict.kind).toBe("identity_unconfirmed"); expect(await cleanup).toEqual({ ok: true });
  });

  it("contains malformed onboarding captures before Self I/O and holds their observed work", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); h.fetch.mockClear();
    const pending = deferred<void>(), entered = deferred<void>(); releases.push(() => pending.resolve()); Object.defineProperty(pending.promise, "then", { value: undefined });
    let later = 0;
    const submitting = runtime.coordinator.submitOnboarding({ displayName: "Synthetic", terms: { get id() { entered.resolve(); return pending.promise; }, get kind() { later++; return "terms_of_service"; } }, privacy: {} } as never);
    await entered.promise;
    expect(later).toBe(0); expect(h.fetch).not.toHaveBeenCalled();
    const cleanup = b.host.dispose(); let done = false; void cleanup.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    pending.resolve(); expect((await submitting).kind).toBe("temporarily_unavailable"); expect(await cleanup).toEqual({ ok: true });
  });

  it("vetoes a malformed captured clock after progress and before trusted establishment", async () => {
    const h = await fixture(), pending = deferred<void>(); releases.push(() => pending.resolve()); Object.defineProperty(pending.promise, "then", { value: undefined });
    let fail = false;
    const b = await bootstrap(h, { migration: { ...h.options.migration, now: () => fail ? pending.promise as never : SYNTHETIC_NOW } }), runtime = await b.start();
    server(h); await runtime.startUpOnce(); await runtime.coordinator.requestEmailOtp(user.email);
    const verified = await runtime.coordinator.verifyEmailOtp(user.email, "123456");
    if (verified.kind !== "resolved" || verified.gate.kind !== "onboarding_required" || !verified.gate.legal.terms || !verified.gate.legal.privacy) throw null;
    runtime.subscribeToProgress(phase => { if (phase === "establishing_trusted_state") fail = true; });
    const completed = await runtime.coordinator.submitOnboarding({ displayName: "Synthetic Athlete", terms: verified.gate.legal.terms, privacy: verified.gate.legal.privacy });
    expect(completed.kind).toBe("temporarily_unavailable"); expect(b.host.health()).toMatchObject({ identityFailed: true, storageFailed: false });
    expect(await row(h, TRUSTED_DEVICE_STORAGE_KEY)).toBe(null);
    const cleanup = b.host.dispose(); let done = false; void cleanup.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    pending.resolve(); expect(await cleanup).toEqual({ ok: true });
  });

  for (const target of ["auth", "foreign", "other_rpc", "schema"] as const) it(`refuses materialized data transport outside its actual RPC phase: ${target}`, async () => {
    const h = await fixture("valid"), OriginalRequest = Request;
    vi.stubGlobal("Request", class extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith("/rpc/ensure_my_profile")) {
          const headers = new Headers(init?.headers);
          if (target === "schema") headers.set("Content-Profile", "private");
          const replacement = target === "auth" ? h.options.config.url + "/auth/v1/otp" : target === "foreign" ? "https://foreign.example.invalid/rest/v1/rpc/ensure_my_profile" : target === "other_rpc" ? h.options.config.url + "/rest/v1/rpc/create_team" : url;
          super(replacement, { ...init, headers });
        } else super(input, init);
      }
    });
    const b = await bootstrap(h), runtime = await b.start();
    expect((await runtime.startUpOnce()).verdict.kind).toBe("identity_unconfirmed");
    expect(h.fetch).not.toHaveBeenCalled(); expect(b.host.health().sdkFailed).toBe(true);
  });

  it("retains the genuine earlier Profile when completion returns a different Profile for the same account", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); server(h);
    await runtime.startUpOnce(); await runtime.coordinator.requestEmailOtp(user.email);
    const verified = await runtime.coordinator.verifyEmailOtp(user.email, "123456");
    if (verified.kind !== "resolved" || verified.gate.kind !== "onboarding_required" || !verified.gate.legal.terms || !verified.gate.legal.privacy) throw null;
    h.fetch.mockResolvedValue(response({ ...facts(true), profile_id: "88888888-8888-4888-8888-888888888888" }));
    const submitted = await runtime.coordinator.submitOnboarding({ displayName: "Synthetic Athlete", terms: verified.gate.legal.terms, privacy: verified.gate.legal.privacy });
    expect(submitted.kind).toBe("submission_failed"); expect(await row(h, TRUSTED_DEVICE_STORAGE_KEY)).toBe(null);
    expect(await row(h, IDENTITY_BARRIER_STORAGE_KEY)).not.toBe(null);
  });

  it("preserves the actual migrated deletion guard and refuses completed Profile admission", async () => {
    const h = await fixture("valid"), key = `${DELETION_GUARD_PREFIX}${profileId}.v1`;
    const guard = JSON.stringify({ schemaVersion: 1, profileId, nonce: "99999999-9999-4999-8999-999999999999", revision: 4 }); h.source.map.set(key, guard);
    const b = await bootstrap(h), runtime = await b.start();
    h.fetch.mockImplementation(async input => {
      const path = new URL((input as Request).url).pathname;
      return response(path.endsWith("ensure_my_profile") ? { id: profileId, display_name: "Synthetic Athlete" } : facts(true));
    });
    const result = await runtime.startUpOnce(); expect(result.verdict.kind).not.toMatch(/^ready_/);
    expect(await row(h, key)).toBe(guard);
  });

  it("joins genuine disposal reentered while the private data client is being constructed", async () => {
    const h = await fixture("valid"), RealHeaders = Headers;
    let closing: Promise<unknown> | null = null, host: NativeIdentityBootstrapHost | null = null;
    vi.stubGlobal("Headers", class extends RealHeaders {
      constructor(init?: HeadersInit) {
        super(init);
        if (host && !closing && init && Object.hasOwn(init, "apikey")) closing = host.dispose();
      }
    });
    const b = await bootstrap(h); host = b.host;
    expect(await host.start()).toEqual({ outcome: "closed" }); expect(closing).not.toBe(null);
    expect(await closing).toEqual({ ok: true }); expect(host.health().phase).toBe("closed");
    expect(h.fetch).not.toHaveBeenCalled(); expect(b.callbackUrlAccess.readCurrentUrl).not.toHaveBeenCalled();
  });
});


describe("S5b independent review regressions", () => {
 it('refuses a schema changed by final Request materialization', async () => {
  const h=await fixture('valid'), OriginalRequest=Request;
  vi.stubGlobal('Request',class extends OriginalRequest {
   constructor(input: RequestInfo|URL, init?:RequestInit) {
    if(input instanceof OriginalRequest && input.url.endsWith('/rpc/ensure_my_profile')) {
     const headers=new Headers(init?.headers ?? input.headers); headers.set('Content-Profile','private');
     super(input,{...init,headers});
    } else super(input,init);
   }
  });
  const b=await bootstrap(h), runtime=await b.start(); const schemas:string[]=[];
  h.fetch.mockImplementation(async input=>{ const r=input as Request; schemas.push(r.headers.get('Content-Profile')!); return response({id:profileId,display_name:null}); });
  await runtime.startUpOnce();
  expect(schemas).toEqual([]);
 });
 it('refuses onboarding body changed by final Request materialization', async () => {
  const h=await fixture(), OriginalRequest=Request; let armed=false;
  vi.stubGlobal('Request',class extends OriginalRequest {
   constructor(input:RequestInfo|URL,init?:RequestInit) {
    if(armed && input instanceof OriginalRequest && input.url.endsWith('/rpc/complete_personal_onboarding'))
      super(input,{...init,body:JSON.stringify({p_display_name:'Changed',p_terms_document_id:termsId,p_privacy_document_id:privacyId})});
    else super(input,init);
   }
  });
  const b=await bootstrap(h),runtime=await b.start();const requests=server(h);
  await runtime.startUpOnce();await runtime.coordinator.requestEmailOtp(user.email); const v=await runtime.coordinator.verifyEmailOtp(user.email,'123456');
  if(v.kind!=='resolved'||v.gate.kind!=='onboarding_required'||!v.gate.legal.terms||!v.gate.legal.privacy)throw null;
  armed=true; await runtime.coordinator.submitOnboarding({displayName:'Original',terms:v.gate.legal.terms,privacy:v.gate.legal.privacy});
  expect(requests.filter(r=>r.path.endsWith('/complete_personal_onboarding'))).toEqual([]);
 });
 it('retains malformed final materialization URL work through dispose',async()=>{
  const h=await fixture('valid'),OriginalRequest=Request,pending=deferred<void>(); releases.push(()=>pending.resolve()); Object.defineProperty(pending.promise,'then',{value:null}); let urlReads=0;
  const originalUrl=Object.getOwnPropertyDescriptor(OriginalRequest.prototype,'url')!.get!;
  vi.stubGlobal('Request',class extends OriginalRequest {
   get url(){urlReads++; if(urlReads===2)return pending.promise as never;return Reflect.apply(originalUrl,this,[]);}
  });
  const b=await bootstrap(h),runtime=await b.start();server(h); const startup=runtime.startUpOnce();
  await vi.waitFor(()=>expect(b.host.health().sdkFailed).toBe(true));
  const cleanup=b.host.dispose();let finished=false;void cleanup.then(()=>{finished=true;});
  await new Promise(resolve=>setTimeout(resolve,15));expect(finished).toBe(false);
  pending.resolve();await startup;await cleanup;
 });
 it('does not hide a confirmed background Profile mismatch as transient unavailable',async()=>{
  const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);
  h.fetch.mockResolvedValue(response({...facts(true),profile_id:'88888888-8888-4888-8888-888888888888'}));
  const result=await runtime.coordinator.revalidateGateFacts();
  expect(result).toMatchObject({denial:'server_identity_invalidated'});
  expect(await row(h,TRUSTED_DEVICE_STORAGE_KEY)).toBe(null);
 });
 it('invalidates a validated missing Profile rather than retaining trusted access',async()=>{
  const h=await fixture(),b=await bootstrap(h),runtime=await b.start();await onboard(h,runtime);
  h.fetch.mockResolvedValue(response({...facts(false),profile_id:null}));
  const result=await runtime.coordinator.revalidateGateFacts();
  expect(result).toMatchObject({denial:'server_identity_invalidated'});expect(await row(h,TRUSTED_DEVICE_STORAGE_KEY)).toBe(null);
 });
 it('final SEND fence rejects an operation superseded by final Request construction',async()=>{
  const h=await fixture('valid'),OriginalRequest=Request;let runtime:IdentityRuntimeReady|null=null,newer:Promise<unknown>|null=null,armed=true;
  vi.stubGlobal('Request',class extends OriginalRequest {
   constructor(input:RequestInfo|URL,init?:RequestInit){super(input,init);if(runtime && armed && input instanceof OriginalRequest && input.url.endsWith('/rpc/ensure_my_profile')) {armed=false;newer=runtime.coordinator.requestEmailOtp(user.email);}}
  });
  const b=await bootstrap(h);runtime=await b.start();const requests=server(h);
  expect((await runtime.startUpOnce()).verdict.kind).toBe('identity_unconfirmed');await newer;
  expect(requests.some(r=>r.path.endsWith('/rpc/ensure_my_profile'))).toBe(false);
 });
 it('keeps native Legal refresh outside access-operation supersession',async()=>{
  const h=await fixture(),b=await bootstrap(h),runtime=await b.start();server(h);await runtime.startUpOnce();await runtime.coordinator.requestEmailOtp(user.email);
  const original=h.fetch.getMockImplementation()!,entered=deferred<void>(),answer=deferred<Response>();releases.push(()=>answer.resolve(response(session())));
  h.fetch.mockImplementation(async (...args)=>{if(new URL((args[0] as Request).url).pathname.endsWith('/verify')){entered.resolve();return answer.promise;}return original(...args);});
  const verify=runtime.coordinator.verifyEmailOtp(user.email,'123456');await entered.promise;const legal=runtime.coordinator.refreshLegalSnapshot();answer.resolve(response(session()));
  expect((await legal).kind).toBe('refreshed');expect(await verify).toMatchObject({kind:'resolved',gate:{kind:'onboarding_required'}});
 });
 it('refuses security options changed by final Request materialization',async()=>{
  const h=await fixture('valid'),OriginalRequest=Request;
  vi.stubGlobal('Request',class extends OriginalRequest {
   constructor(input:RequestInfo|URL,init?:RequestInit){if(input instanceof OriginalRequest && input.url.endsWith('/rpc/ensure_my_profile'))super(input,{...init,credentials:'include',redirect:'follow'});else super(input,init);}
  });
  const b=await bootstrap(h),runtime=await b.start();const sent:{credentials:string,redirect:string}[]=[];
  h.fetch.mockImplementation(async input=>{const r=input as Request;sent.push({credentials:r.credentials,redirect:r.redirect});return response({id:profileId,display_name:null});});
  await runtime.startUpOnce();expect(sent).toEqual([]);
 });
 it('does not replay startup ready after a later genuine signout',async()=>{
  const h=await fixture('valid'),b=await bootstrap(h),runtime=await b.start();
  h.fetch.mockImplementation(async input=>{const p=new URL((input as Request).url).pathname;if(p.endsWith('/logout'))return new Response(null,{status:204});if(p.endsWith('ensure_my_profile'))return response({id:profileId,display_name:'Synthetic Athlete'});return response(facts(true));});
  expect((await runtime.startUpOnce()).verdict.kind).toBe('ready_online');
  expect((await runtime.coordinator.signOut()).kind).toBe('signed_out_locked');
  expect((await runtime.startUpOnce()).verdict.kind).not.toMatch(/^ready_/);
  expect((await runtime.coordinator.startUp()).verdict.kind).not.toMatch(/^ready_/);
 });
});

describe("direct host-disposal observer ownership", () => {
 it('does not make disposal await itself when a progress observer returns it',async()=>{
  const h=await fixture(),b=await bootstrap(h),runtime=await b.start();server(h);
  let cleanup:ReturnType<typeof b.host.dispose>|null=null;
  runtime.subscribeToProgress(()=>{cleanup=b.host.dispose();return cleanup;});
  const startup=runtime.startUpOnce();await startup;expect(cleanup).not.toBe(null);
  let done=false;void cleanup!.then(()=>{done=true;});
  await new Promise(resolve=>setTimeout(resolve,40));
  expect(done).toBe(true);
  expect(await cleanup!).toEqual({ok:true});
  expect((await startup).verdict.kind).not.toMatch(/^ready_/);
 });
 it("still joins independent pending observer work before completing disposal", async () => {
  const h=await fixture(), b=await bootstrap(h), runtime=await b.start(); server(h);
  const pending=deferred<void>(); releases.push(()=>pending.resolve());
  runtime.subscribeToProgress(()=>pending.promise);
  await runtime.startUpOnce();
  const cleanup=b.host.dispose(); let finished=false; void cleanup.then(()=>{finished=true;});
  await new Promise(resolve=>setTimeout(resolve,20)); expect(finished).toBe(false);
  pending.resolve(); expect(await cleanup).toEqual({ok:true});
 });
});


describe("S5b final publication and materialization controls", () => {
  it.each(["authorization", "apikey", "content-type", "unexpected-header"])("refuses final mutated %s", async header => {
    const h=await fixture("valid"), OriginalRequest=Request;
    vi.stubGlobal("Request", class extends OriginalRequest {
      constructor(input: RequestInfo|URL, init?: RequestInit) {
        if(input instanceof OriginalRequest && input.url.endsWith("/rpc/ensure_my_profile")) {
          const headers=new Headers(init?.headers ?? input.headers); headers.set(header,"SYNTHETIC_CHANGED"); super(input,{...init,headers});
        } else super(input,init);
      }
    });
    const b=await bootstrap(h), runtime=await b.start(); server(h);
    expect((await runtime.startUpOnce()).verdict.kind).toBe("identity_unconfirmed");
    expect(h.fetch).not.toHaveBeenCalled();
  });
  it("retains a malformed final method without reading later fields", async () => {
    const h=await fixture("valid"), OriginalRequest=Request, pending=deferred<void>(); releases.push(()=>pending.resolve());
    Object.defineProperty(pending.promise,"then",{value:null}); let reads=0, later=0;
    const method=Object.getOwnPropertyDescriptor(OriginalRequest.prototype,"method")!.get!;
    const credentials=Object.getOwnPropertyDescriptor(OriginalRequest.prototype,"credentials")!.get!;
    vi.stubGlobal("Request", class extends OriginalRequest {
      get method(){return ++reads===2 ? pending.promise as never : Reflect.apply(method,this,[]);}
      get credentials(){later++; return Reflect.apply(credentials,this,[]);}
    });
    const b=await bootstrap(h), runtime=await b.start(); server(h); const startup=runtime.startUpOnce();
    await vi.waitFor(()=>expect(b.host.health().sdkFailed).toBe(true));
    const cleanup=b.host.dispose(); let finished=false; void cleanup.then(()=>{finished=true;});
    await new Promise(resolve=>setTimeout(resolve,15)); expect(finished).toBe(false); expect(later).toBe(0);
    pending.resolve(); await startup; expect(await cleanup).toEqual({ok:true});
  });
  it("does not rebase cached startup onto a newer foreground operation, and leaves the host usable", async () => {
    const h=await fixture("valid"), b=await bootstrap(h), runtime=await b.start(); server(h);
    h.fetch.mockImplementation(async input => {
      const path=new URL((input as Request).url).pathname;
      return response(path.endsWith("ensure_my_profile") ? {id:profileId,display_name:"Synthetic Athlete"} : facts(true));
    });
    const original=await runtime.startUpOnce(); expect(original.verdict.kind).toBe("ready_online");
    h.fetch.mockResolvedValue(response({}));
    expect((await runtime.coordinator.requestEmailOtp(user.email)).kind).toBe("otp_requested");
    const count=h.fetch.mock.calls.length;
    const replay=await runtime.startUpOnce(); expect(replay.verdict.kind).toBe("identity_unconfirmed");
    expect(replay.transition).toEqual(original.transition); expect(h.fetch.mock.calls.length).toBe(count);
    expect(b.host.health()).toMatchObject({phase:"ready",sdkFailed:false,identityFailed:false});
    h.fetch.mockResolvedValue(response(legalRows));
    expect((await runtime.coordinator.refreshLegalSnapshot()).kind).toBe("refreshed");
  });
});

describe("S5b adjacent capture regressions", () => {
 it('uses the captured clock for native durable deep-link intent',async()=>{
  const h=await fixture(),b=await bootstrap(h),runtime=await b.start();
  b.setUrl('https://app.example.invalid/?inviteToken=synthetic-invitation-token');
  const result=await runtime.captureCurrentDeepLinkIntent();expect(result.kind).toBe('captured');
  if(result.kind!=='captured')throw null;
  expect(result.intent.capturedAt).toBe(SYNTHETIC_NOW);
 });
 it('does not clean native intent using an unobserved fallback clock',async()=>{
  const h=await fixture(),pending=deferred<void>(); releases.push(()=>pending.resolve()); Object.defineProperty(pending.promise,'then',{value:null});let fail=false;
  const b=await bootstrap(h,{migration:{...h.options.migration,now:()=>fail?pending.promise as never:SYNTHETIC_NOW}}),runtime=await b.start();
  b.setUrl('https://app.example.invalid/?inviteToken=synthetic-invitation-token');fail=true;
  expect((await runtime.captureCurrentDeepLinkIntent()).kind).toBe('blocked');
  expect(b.host.health().identityFailed).toBe(true);expect(b.callbackUrlAccess.replaceCurrentUrl).not.toHaveBeenCalled();
 });
 it('owns a directly observed malformed final header callback value',async()=>{
  const h=await fixture('valid'),pending=deferred<void>();releases.push(()=>pending.resolve());Object.defineProperty(pending.promise,'then',{value:null});
  const real=Headers.prototype.forEach;let hit=false;
  vi.spyOn(Headers.prototype,'forEach').mockImplementation(function(this:Headers, callback: Parameters<Headers["forEach"]>[0], receiver?:unknown){
   return Reflect.apply(real,this,[(value:string,key:string)=>{if(String(callback).includes('actualHeaders.push')&&key==='content-profile'){hit=true;Reflect.apply(callback,receiver,[pending.promise,key,this]);}else Reflect.apply(callback,receiver,[value,key,this]);}]);
  });
  const b=await bootstrap(h),runtime=await b.start();server(h);const starting=runtime.startUpOnce();await vi.waitFor(()=>expect(hit).toBe(true));
  const cleanup=b.host.dispose();let done=false;void cleanup.then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);
  pending.resolve();await starting;await cleanup;
 });
});


describe("S5b required capture ownership matrix", () => {
  it.each(["pending", "masked", "rejected", "throwing"])("blocks deep-link capture on a %s captured clock", async kind => {
    const h=await fixture(), pending=deferred<void>(); releases.push(()=>pending.resolve());
    if(kind==="masked") Object.defineProperty(pending.promise,"then",{value:null});
    let armed=false;
    const b=await bootstrap(h,{migration:{...h.options.migration,now:()=>{
      if(!armed) return SYNTHETIC_NOW;
      if(kind==="throwing") throw null;
      return (kind==="rejected" ? Promise.reject(null) : pending.promise) as never;
    }}}), runtime=await b.start();
    b.setUrl("https://app.example.invalid/?inviteToken=synthetic-invitation-token&unrelated=keep"); armed=true;
    expect((await runtime.captureCurrentDeepLinkIntent()).kind).toBe("blocked");
    expect(b.host.health()).toMatchObject({identityFailed:true,storageFailed:false});
    expect(b.callbackUrlAccess.replaceCurrentUrl).not.toHaveBeenCalled();
    const cleanup=b.host.dispose(); let done=false; void cleanup.then(()=>{done=true;});
    if(kind==="pending"||kind==="masked") {
      await new Promise(resolve=>setTimeout(resolve,15)); expect(done).toBe(false);
    }
    pending.resolve(); expect(await cleanup).toEqual({ok:true});
  });
  for(const location of ["source", "owned", "final"] as const) {
    it.each(["key", "value"])(`owns a malformed ${location} header %s before further processing`, async field => {
      const h=await fixture("valid"), pending=deferred<void>(); releases.push(()=>pending.resolve());
      Object.defineProperty(pending.promise,"then",{value:null}); const real=Headers.prototype.forEach; let hit=false;
      vi.spyOn(Headers.prototype,"forEach").mockImplementation(function(this:Headers,callback,receiver){
        const spelling=String(callback);
        const selected=location==="source" ? spelling.includes("headerEntries.push") : location==="final" ? spelling.includes("actualHeaders.push") : spelling.includes("checkHeader") && !spelling.includes("push");
        return Reflect.apply(real,this,[(value:string,key:string)=>{
          if(!hit && selected && key==="content-profile") {
            hit=true;
            Reflect.apply(callback,receiver,[field==="value"?pending.promise:value,field==="key"?pending.promise:key,this]);
          } else Reflect.apply(callback,receiver,[value,key,this]);
        }]);
      });
      const b=await bootstrap(h),runtime=await b.start(); server(h); const startup=runtime.startUpOnce();
      await vi.waitFor(()=>expect(hit).toBe(true)); expect(b.host.health().sdkFailed).toBe(true);
      const cleanup=b.host.dispose(); let done=false; void cleanup.then(()=>{done=true;});
      await new Promise(resolve=>setTimeout(resolve,15)); expect(done).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
      pending.resolve(); await startup; expect(await cleanup).toEqual({ok:true});
    });
  }
  it("recognizes its actual disposal Promise returned as a malformed Request observation", async () => {
    const h=await fixture("valid"), OriginalRequest=Request;
    let host:NativeIdentityBootstrapHost|null=null, cleanup:Promise<unknown>|null=null;
    const originalUrl=Object.getOwnPropertyDescriptor(OriginalRequest.prototype,"url")!.get!;
    vi.stubGlobal("Request",class extends OriginalRequest {
      get url(){if(host){cleanup=host.dispose();return cleanup as never;}return Reflect.apply(originalUrl,this,[]);}
    });
    const b=await bootstrap(h),runtime=await b.start();host=b.host;server(h);
    const startup=runtime.startUpOnce();
    expect((await startup).verdict.kind).not.toMatch(/^ready_/); expect(cleanup).not.toBe(null);
    expect(await cleanup!).toEqual({ok:true}); expect(h.fetch).not.toHaveBeenCalled();
  });
});

function installPlainHeaderForEach(implementation: Headers["forEach"]): void {
  const descriptor = Object.getOwnPropertyDescriptor(Headers.prototype, "forEach")!;
  // Vitest's spy wrapper reads Promise.then itself; use a plain provider here
  // so a masked acknowledgement is actually returned to the host unchanged.
  Object.defineProperty(Headers.prototype, "forEach", { ...descriptor, value: implementation });
  releases.push(() => { Object.defineProperty(Headers.prototype, "forEach", descriptor); });
}

describe("S5b swallowed header acknowledgement regression", () => {
 it('retains the actual malformed forEach acknowledgement even after callback refusal',async()=>{
  const h=await fixture('valid'),pending=deferred<void>();releases.push(()=>pending.resolve());Object.defineProperty(pending.promise,'then',{value:null});
  const original=Headers.prototype.forEach;let observed=false;
  installPlainHeaderForEach(function(this:Headers,callback: Parameters<Headers["forEach"]>[0],receiver?:unknown){
   if(String(callback).includes('actualHeaders.push')){
    try{Reflect.apply(callback,receiver,[null,'content-profile',this]);}catch{}
    observed=true;return pending.promise as never;
   }
   return Reflect.apply(original,this,[callback,receiver]);
  });
  const b=await bootstrap(h),runtime=await b.start();server(h);const startup=runtime.startUpOnce();await vi.waitFor(()=>expect(observed).toBe(true));
  const cleanup=b.host.dispose();let done=false;void cleanup.then(()=>{done=true;});await new Promise(resolve=>setTimeout(resolve,20));expect(done).toBe(false);
  pending.resolve();await startup;expect(await cleanup).toEqual({ok:true});
 });
});


describe("S5b independently observed header field and acknowledgement ownership", () => {
  for(const location of ["source", "owned", "final", "response", "response-owned"] as const) {
    it.each(["pending", "masked", "rejected"])(`joins both malformed field and %s return at ${location}`, async kind => {
      const h=await fixture("valid"), field=deferred<void>(), acknowledgement=deferred<void>();
      releases.push(()=>field.resolve(),()=>acknowledgement.resolve());
      Object.defineProperty(field.promise,"then",{value:null});
      if(kind==="masked") Object.defineProperty(acknowledgement.promise,"then",{value:null});
      const original=Headers.prototype.forEach; let hit=false;
      installPlainHeaderForEach(function(this:Headers,callback,receiver){
        const spelling=String(callback), isRequest=this.has("content-profile");
        const selected=location==="source" ? spelling.includes("headerEntries.push")
          : location==="final" ? spelling.includes("actualHeaders.push")
          : location==="response" ? spelling.includes("entries.push")
          : spelling.includes("checkHeader") && !spelling.includes("push") && (location==="owned"?isRequest:!isRequest);
        if(!hit && selected) {
          hit=true;
          try{Reflect.apply(callback,receiver,[field.promise,"content-profile",this]);}catch{}
          return (kind==="rejected"?Promise.reject(null):acknowledgement.promise) as never;
        }
        return Reflect.apply(original,this,[callback,receiver]);
      });
      const b=await bootstrap(h),runtime=await b.start();server(h);const startup=runtime.startUpOnce();
      await vi.waitFor(()=>expect(hit).toBe(true));expect(b.host.health().sdkFailed).toBe(true);
      const cleanup=b.host.dispose();let done=false;void cleanup.then(()=>{done=true;});
      await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);
      field.resolve();
      if(kind!=="rejected") {await new Promise(resolve=>setTimeout(resolve,15));expect(done).toBe(false);}
      acknowledgement.resolve();expect((await startup).verdict.kind).not.toMatch(/^ready_/);
      expect(await cleanup).toEqual({ok:true});expect(h.fetch).toHaveBeenCalledTimes(location.startsWith("response")?1:0);
    });
  }
});
