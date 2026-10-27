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


const requestId = "77777777-7777-4777-8777-777777777777";
const pendingRow = { request_id: requestId, profile_id: profileId, requested_at: "2026-10-25T00:00:00Z", finalize_after: "2026-11-24T00:00:00Z" };
const pendingValue = { requestId, profileId, requestedAt: pendingRow.requested_at, finalizeAfter: pendingRow.finalize_after };
function accountTransport(h: Fixture) {
  const original = h.fetch.getMockImplementation()!, calls: { name: string; body: Record<string, unknown> }[] = [];
  const state = { revision: 0, pending: null as typeof pendingRow | null, exportAccount: user.id, exportProfile: profileId };
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, name = new URL(request.url).pathname.split("/").pop()!;
    if (state.pending && name === "get_my_gate_state") return response({ ...facts(false), profile_id: null, display_name: null });
    if (!name.includes("account_deletion") && name !== "get_my_account_export") return original(...args);
    expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("error");
    expect(request.headers.get("Authorization")).toBe("Bearer SYNTHETIC_HOST_ACCESS");
    expect(request.headers.get("Content-Profile")).toBe("public");
    const body = JSON.parse(await request.text()); calls.push({ name, body });
    if (name === "get_my_account_deletion_control") return response({ profile_id: profileId, revision: state.revision, pending: state.pending });
    if (name === "request_my_account_deletion") { state.pending = pendingRow; state.revision++; return response([pendingRow]); }
    if (name === "cancel_my_account_deletion") { state.pending = null; state.revision++; return response(true); }
    if (name === "abort_my_uncommitted_account_deletion") { state.revision++; return response(state.revision); }
    if (name === "get_my_account_export") {
      const inventories = ["legalEvidence", "sportingRecords", "sportingTombstones", "teamResultBundles", "teamResultRevisions", "privateNotes", "sharedSessionContext", "memberships", "membershipFunctions", "notifications", "entitlements", "deletionRequests", "recordingPermissions", "sessionParticipation", "sessionApprovals", "invitations", "adminRequests", "auditHistory", "athleteCapabilities", "teamCreationGrants"];
      return response({ schemaVersion: 1, profile: { id: state.exportProfile }, accountId: state.exportAccount, accountEmail: user.email, onboarding: {}, exportedAt: SYNTHETIC_NOW, ...Object.fromEntries(inventories.map(name => [name, []])) });
    }
    throw null;
  });
  return { calls, state };
}
async function ready() {
  const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
  const server = accountTransport(h); return { h, b, runtime, ...server, service: runtime.accountDeletion };
}

describe("dormant native account deletion", () => {
  it("requests only through its actual own denial and supports blocked state/cancellation", async () => {
    const { h, runtime, service, calls } = await ready(), notifications: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { notifications.push(value); });
    const old = runtime.createSportingCloudService(profileId)!;
    expect(await service.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated")).toEqual({ ok: true, value: pendingValue });
    expect(calls).toEqual([{ name: "get_my_account_deletion_control", body: {} }, { name: "request_my_account_deletion", body: { p_expected_profile_id: profileId, p_expected_revision: 0 } }]);
    expect(notifications).toEqual([expect.objectContaining({ kind: "identity_invalidated", outstanding: [], transition: expect.objectContaining({ mode: "foreground" }) })]);
    expect(await row(h, TRUSTED_DEVICE_STORAGE_KEY)).toBe(null); expect(await old.restore()).toEqual({ ok: false, error: "unavailable" });
    expect(await service.getState()).toEqual({ ok: true, value: pendingValue });
    expect(await service.cancel(requestId)).toEqual({ ok: true, value: true });
    expect(await service.getState()).toEqual({ ok: true, value: null });
    expect(runtime.createSportingCloudService(profileId)).toBe(null);
  });
  it("does not accept callback true as a deletion continuation", async () => {
    const { service, calls } = await ready();
    expect(await service.request(profileId, async () => true)).toEqual({ ok: false, error: "unavailable" });
    expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
  });
  it("recovers a real uncommitted local guard using the existing conditional abort", async () => {
    const { runtime, service, calls } = await ready();
    expect((await service.request(profileId, async () => false)).ok).toBe(false);
    expect(await service.getState()).toEqual({ ok: true, value: null, recoveredProfileId: profileId });
    expect(calls.at(-1)).toEqual({ name: "abort_my_uncommitted_account_deletion", body: { p_expected_profile_id: profileId, p_expected_revision: 0 } });
    expect(runtime.createSportingCloudService(profileId)).not.toBe(null);
  });
  it.each(["absent", "throws", "false", "true"])("owns confirmed pending denial with an observer that is %s", async kind => {
    const { h, runtime, service, state } = await ready(), notifications: unknown[] = [];
    state.pending = pendingRow; runtime.subscribeToIdentityInvalidations(value => { notifications.push(value); });
    const observer = kind === "absent" ? undefined : () => { if (kind === "throws") throw null; return kind === "true"; };
    const result = await service.getState(observer);
    expect(result).toEqual(kind === "false" ? { ok: false, error: "account_changed" } : { ok: true, value: pendingValue });
    expect(notifications).toEqual([expect.objectContaining({ kind: "identity_invalidated", outstanding: [] })]);
    expect(await row(h, TRUSTED_DEVICE_STORAGE_KEY)).toBe(null); expect(runtime.createSportingCloudService(profileId)).toBe(null);
  });
  it("shares request exclusion across private per-call mapper instances", async () => {
    const { service, calls } = await ready(), waiting = deferred<boolean>(), entered = deferred<void>(); releases.push(() => waiting.resolve(false));
    const first = service.request(profileId, () => { entered.resolve(); return waiting.promise; }); await entered.promise;
    expect(await service.request(profileId, async () => true)).toEqual({ ok: false, error: "unavailable" });
    expect(await service.getState()).toEqual({ ok: false, error: "unavailable" });
    expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control", "get_my_account_deletion_control"]);
    waiting.resolve(false); await first;
  });
  it("does not deadlock a callback awaiting a different native SDK operation", async () => {
    const { runtime, service, calls } = await ready();
    expect(await service.request(profileId, async () => { await runtime.coordinator.requestEmailOtp(user.email); return true; })).toEqual({ ok: false, error: "unavailable" });
    expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
  });
  it("shares repeated actual invalidation within one callback without minting another receipt", async () => {
    const { runtime, service } = await ready(), notifications: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { notifications.push(value); });
    expect(await service.request(profileId, async () => {
      const a = runtime.coordinator.invalidateIdentity(), b = runtime.coordinator.invalidateIdentity();
      expect(await a).toEqual(await b); return (await a).kind === "identity_invalidated";
    })).toEqual({ ok: true, value: pendingValue }); expect(notifications).toHaveLength(1);
  });
  it("refuses an invalidation invoked only after the callback has yielded", async () => {
    const { runtime, service, calls } = await ready();
    expect(await service.request(profileId, async () => { await Promise.resolve(); return (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated"; })).toEqual({ ok: false, error: "unavailable" });
    expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
  });
  it("does not borrow a newer operation's epoch after its own denial was superseded", async () => {
    const { runtime, service, calls } = await ready(); let newer: Promise<unknown> | null = null;
    runtime.subscribeToProgress(phase => { if (phase === "identity_denied_in_memory") newer = runtime.coordinator.requestEmailOtp(user.email); });
    expect(await service.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated")).toEqual({ ok: false, error: "unavailable" });
    await newer; expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
  });
  it("retains real denial failure without granting continuation", async () => {
    const { h, runtime, service, calls } = await ready(), notifications: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { notifications.push(value); });
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) throw null; return next(); };
    expect((await service.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated")).ok).toBe(false);
    expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
    expect(notifications).toEqual([expect.objectContaining({ kind: "durable_denial_unavailable", outstanding: expect.arrayContaining(["durable_barrier"]) })]);
  });
  it("returns a detached frozen export bound to the actual authenticated account", async () => {
    const { service, calls } = await ready(), result = await service.exportCloud(profileId);
    expect(result.ok).toBe(true); if (!result.ok) throw null;
    expect(result.value.accountId).toBe(user.id); expect(Object.isFrozen(result.value)).toBe(true); expect(Object.isFrozen(result.value.privateNotes)).toBe(true);
    expect(calls).toEqual([{ name: "get_my_account_export", body: {} }]);
  });
  it.each(["account", "profile"])("refuses an export with mismatched %s", async kind => {
    const { service, state } = await ready(); if (kind === "account") state.exportAccount = "99999999-9999-4999-8999-999999999999"; else state.exportProfile = "99999999-9999-4999-8999-999999999999";
    expect(await service.exportCloud(profileId)).toEqual({ ok: false, error: "unavailable" });
  });
  it("does not publish a stale control response or write a guard after a newer foreground action", async () => {
    const { h, runtime, service, calls } = await ready(), original = h.fetch.getMockImplementation()!, waiting = deferred<Response>(), entered = deferred<void>();
    releases.push(() => waiting.resolve(response({ profile_id: profileId, revision: 0, pending: pendingRow })));
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.endsWith("get_my_account_deletion_control")) { entered.resolve(); return waiting.promise; } return original(...args); });
    const old = service.getState(); await entered.promise; const newer = runtime.coordinator.requestEmailOtp(user.email);
    waiting.resolve(response({ profile_id: profileId, revision: 0, pending: pendingRow })); expect((await old).ok).toBe(false); await newer;
    expect(calls).toEqual([]); expect(await row(h, `curling.identity.accountDeletionGuard.${profileId}.v1`)).toBe(null);
  });
  it("does not restore a closed service through plausible caller selectors", async () => {
    const { h, b, service } = await ready(); await b.host.dispose(); h.fetch.mockClear();
    expect((await service.getState()).ok).toBe(false); expect((await service.request(profileId, async () => true)).ok).toBe(false);
    expect((await service.cancel(requestId)).ok).toBe(false); expect((await service.exportCloud(profileId)).ok).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("native deletion real guard and callback ownership", () => {
  it.each(["supersede", "close"])("fences every actual guard I/O after an unanswered read and %s", async kind => {
    const { h, b, runtime, service, state } = await ready(); state.pending = pendingRow;
    const waiting = deferred<void>(), entered = deferred<void>(), guardKey = `curling.identity.accountDeletionGuard.${profileId}.v1`;
    releases.push(() => waiting.resolve()); let held = false, writes = 0;
    h.sqlFaults.hook = async (event, next) => {
      if (event.kind === "run" && event.values?.[0] === guardKey) writes++;
      if (!held && event.kind === "query" && event.values?.[0] === guardKey) { held = true; entered.resolve(); await waiting.promise; }
      return next();
    };
    const notifications: unknown[] = []; runtime.subscribeToIdentityInvalidations(value => { notifications.push(value); });
    const old = service.getState(); await entered.promise; expect(notifications).toHaveLength(1);
    const newer = kind === "close" ? b.host.dispose() : runtime.coordinator.requestEmailOtp(user.email);
    let closed = false; if (kind === "close") void newer.then(() => { closed = true; });
    await new Promise(resolve => setTimeout(resolve, 15)); if (kind === "close") expect(closed).toBe(false);
    waiting.resolve(); expect((await old).ok).toBe(false); await newer; expect(writes).toBe(0);
  });
  it("retains confirmed native denial when later guard I/O fails", async () => {
    const { h, runtime, service, state } = await ready(); state.pending = pendingRow; const notifications: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { notifications.push(value); });
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "query" && event.values?.[0] === `curling.identity.accountDeletionGuard.${profileId}.v1`) throw null; return next(); };
    const result = await service.getState(); expect(result).toEqual({ ok: true, value: pendingValue });
    expect(notifications).toEqual([expect.objectContaining({ kind: "identity_invalidated", outstanding: [] })]); expect(runtime.createSportingCloudService(profileId)).toBe(null);
  });
  it("rejects its own receipt if an older already-begun denial installs a later epoch", async () => {
    const h = await fixture(), hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    const trustedModule = await import("../../identity/trustedDeviceRepository"), actualFactory = trustedModule.createTrustedDeviceRepository;
    let armed = false, held = false;
    vi.spyOn(trustedModule, "createTrustedDeviceRepository").mockImplementation(adapter => {
      const actual = actualFactory(adapter);
      return { ...actual, async load() {
        const result = await actual.load();
        // Pause after the real SQL read has released its lane. Holding the SQL
        // query itself would also block SDK settlement and prove no epoch race.
        if (armed && !held) { held = true; entered.resolve(); await hold.promise; }
        return result;
      } };
    });
    const b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime);
    const { calls } = accountTransport(h); armed = true;
    const older = runtime.coordinator.invalidateIdentity(); await entered.promise;
    await runtime.coordinator.requestEmailOtp(user.email);
    expect(await runtime.coordinator.verifyEmailOtp(user.email, "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
    let released = false;
    h.sqlFaults.hook = async (event, next) => {
      const result = await next();
      if (!released && event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) { released = true; hold.resolve(); }
      return result;
    };
    const request = runtime.accountDeletion.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated");
    expect(await request).toEqual({ ok: false, error: "unavailable" });
    expect((await older).kind).toBe("identity_invalidated");
    expect(released).toBe(true); expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
  });
  it.each(["observer", "before-mutation"])("owns directly observed masked callback work: %s", async kind => {
    const { b, runtime, service, state } = await ready(), pending = deferred<void>(); releases.push(() => pending.resolve());
    Object.defineProperty(pending.promise, "then", { value: null }); if (kind === "observer") state.pending = pendingRow;
    const entered = deferred<void>();
    const returnsPending = () => { entered.resolve(); return pending.promise; };
    const work = kind === "observer" ? service.getState(returnsPending as never) : service.request(profileId, returnsPending as never);
    await entered.promise;
    if (kind === "observer") await work;
    const cleanup = b.host.dispose(); let done = false; void cleanup.then(() => { done = true; });
    await new Promise(resolve => setTimeout(resolve, 15)); expect(done).toBe(false);
    pending.resolve(); await work; expect(await cleanup).toEqual({ ok: true });
    expect(runtime.createSportingCloudService(profileId)).toBe(null);
  });
  it("does not make the exact disposal callback Promise depend on itself", async () => {
    const { b, service } = await ready();
    expect((await service.request(profileId, (() => b.host.dispose()) as never)).ok).toBe(false);
    expect(await b.host.dispose()).toEqual({ ok: true });
  });
  it("keeps a possibly committed request guarded and never retries its lost response", async () => {
    const { h, runtime, service, state, calls } = await ready(), original = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (...args) => { const answer = await original(...args); if ((args[0] as Request).url.endsWith("request_my_account_deletion")) throw null; return answer; });
    expect((await service.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated")).ok).toBe(false);
    expect(state.pending).not.toBe(null); expect(calls.filter(call => call.name === "request_my_account_deletion")).toHaveLength(1);
    expect(await row(h, `curling.identity.accountDeletionGuard.${profileId}.v1`)).not.toBe(null);
    expect(await service.getState()).toEqual({ ok: true, value: pendingValue });
  });
});

for (const matches of [true, false]) it(`revokes existing admission on validated cancel pending, matching ID: ${matches}`, async () => {
  const { runtime, service, state, calls } = await ready(), old = runtime.createSportingCloudService(profileId)!;
  state.pending = pendingRow;
  const selected = matches ? requestId : "99999999-9999-4999-8999-999999999999";
  expect(await service.cancel(selected)).toEqual({ ok: true, value: matches });
  expect(runtime.createSportingCloudService(profileId)).toBe(null);
  expect(await old.restore()).toEqual({ ok: false, error: "unavailable" });
  expect(calls.filter(call => call.name === "cancel_my_account_deletion")).toHaveLength(matches ? 1 : 0);
});

it("reuses only actual current completed denial without another barrier or progress", async () => {
  const { h, runtime, service, state } = await ready(); state.pending = pendingRow; let denials = 0;
  runtime.subscribeToProgress(phase => { if (phase === "identity_denied_in_memory") denials++; });
  expect(await service.getState()).toEqual({ ok: true, value: pendingValue }); const barrier = await row(h, IDENTITY_BARRIER_STORAGE_KEY);
  expect(await service.getState()).toEqual({ ok: true, value: pendingValue });
  expect(await service.cancel("99999999-9999-4999-8999-999999999999")).toEqual({ ok: true, value: false });
  expect(denials).toBe(1); expect(await row(h, IDENTITY_BARRIER_STORAGE_KEY)).toBe(barrier);
});
it("detects its own actual save notification without manufacturing an external barrier", async () => {
  const { runtime, service } = await ready(), observations: Promise<unknown>[] = [];
  runtime.subscribeToBarrierChanges(() => { const value = runtime.coordinator.observeNewerBarrier(); observations.push(value); return value; });
  expect(await service.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated")).toEqual({ ok: true, value: pendingValue });
  expect(await Promise.all(observations)).toEqual([{ kind: "unchanged" }]);
  expect(await runtime.coordinator.observeNewerBarrier()).toEqual({ kind: "unchanged" });
});
for (const malformed of [false, true]) it(`detects a different barrier even with its own genuine completed denial: malformed ${malformed}`, async () => {
  const { h, runtime, service, calls } = await ready();
  expect(await service.request(profileId, async () => {
    const outcome = await runtime.coordinator.invalidateIdentity();
    const barrier = JSON.parse((await row(h, IDENTITY_BARRIER_STORAGE_KEY))!);
    barrier.barrierId = "99999999-9999-4999-8999-999999999999";
    await h.raw({ kind: "run", sql: "UPDATE records SET value=? WHERE key=?", values: [malformed ? "invalid-external-barrier" : JSON.stringify(barrier), IDENTITY_BARRIER_STORAGE_KEY] });
    expect(await runtime.coordinator.observeNewerBarrier()).toEqual({ kind: "newer_barrier" });
    return outcome.kind === "identity_invalidated";
  })).toEqual({ ok: false, error: "unavailable" });
  expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
});
it("does not accept a failed actual barrier acknowledgement as a receipt", async () => {
  const { h, runtime, service, calls } = await ready();
  h.sqlFaults.hook = async (event, next) => { const result = await next(); if (event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) throw null; return result; };
  expect((await service.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated")).ok).toBe(false);
  expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
});
it("cannot certify a still-running potentially-ready foreground as blocked", async () => {
  const h = await fixture(), saveWait = deferred<void>(), saveEntered = deferred<void>(), guardWait = deferred<void>(), guardEntered = deferred<void>();
  releases.push(() => saveWait.resolve(), () => guardWait.resolve());
  const trustedModule = await import("../../identity/trustedDeviceRepository"), actualFactory = trustedModule.createTrustedDeviceRepository;
  let armed = false, heldSave = false, heldGuard = false;
  vi.spyOn(trustedModule, "createTrustedDeviceRepository").mockImplementation(adapter => {
    const actual = actualFactory(adapter); return { ...actual, async save(value) {
      if (armed && !heldSave) { heldSave = true; saveEntered.resolve(); await saveWait.promise; }
      return actual.save(value);
    } };
  });
  const b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); const { state } = accountTransport(h);
  await runtime.coordinator.signOut(); await runtime.coordinator.requestEmailOtp(user.email); armed = true;
  const verifying = runtime.coordinator.verifyEmailOtp(user.email, "123456"); await saveEntered.promise;
  state.pending = pendingRow; const denialEntered = deferred<void>();
  runtime.subscribeToProgress(phase => { if (phase === "identity_denied_in_memory") denialEntered.resolve(); });
  h.sqlFaults.hook = async (event, next) => {
    if (!heldGuard && event.kind === "query" && event.values?.[0] === `curling.identity.accountDeletionGuard.${profileId}.v1`) { heldGuard = true; guardEntered.resolve(); await guardWait.promise; }
    return next();
  };
  const pending = runtime.accountDeletion.getState(); await denialEntered.promise; saveWait.resolve();
  const verified = await verifying; expect(verified.kind === "resolved" && (verified.gate.kind === "ready_online" || verified.gate.kind === "ready_offline")).toBe(false);
  await guardEntered.promise; expect(runtime.createSportingCloudService(profileId)).toBe(null);
  guardWait.resolve(); expect(await pending).toEqual({ ok: true, value: pendingValue });
});
it("rejects missing beforeMutation before reading SDK or control state", async () => {
  const { h, service } = await ready(); h.fetch.mockClear();
  expect(await service.request(profileId)).toEqual({ ok: false, error: "unavailable" }); expect(h.fetch).not.toHaveBeenCalled();
});

it("forwards detached frozen pending facts and contains reentrant observations", async () => {
  const { runtime, service, state, calls } = await ready(); state.pending = pendingRow; let reentrant: Promise<unknown> | null = null;
  expect(await service.getState(pending => {
    expect(Object.isFrozen(pending)).toBe(true); expect(Reflect.set(pending, "profileId", "99999999-9999-4999-8999-999999999999")).toBe(false);
    reentrant = service.getState(() => false); return true;
  })).toEqual({ ok: true, value: pendingValue });
  expect(await reentrant).toEqual({ ok: false, error: "unavailable" });
  expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]); expect(runtime.createSportingCloudService(profileId)).toBe(null);
});
it.each(["observer", "before-mutation"])("contains rejected callback work: %s", async kind => {
  const { service, state } = await ready(); state.pending = kind === "observer" ? pendingRow : null;
  const rejected = () => Promise.reject(null);
  const result = kind === "observer" ? await service.getState(rejected as never) : await service.request(profileId, rejected as never);
  expect(result.ok).toBe(false);
});
it("excludes exact own disposal from pending-observer drain prerequisites", async () => {
  const { b, service, state } = await ready(); state.pending = pendingRow;
  expect((await service.getState((() => b.host.dispose()) as never)).ok).toBe(false); expect(await b.host.dispose()).toEqual({ ok: true });
});
it("keeps a superseded completed denial from suppressing new guard observations", async () => {
  const { h, runtime, service, state } = await ready(); state.pending = pendingRow;
  expect((await service.getState()).ok).toBe(true);
  expect(await service.cancel(requestId)).toEqual({ ok: true, value: true });
  await runtime.coordinator.requestEmailOtp(user.email); await runtime.coordinator.verifyEmailOtp(user.email, "123456");
  // Fresh authentication cannot erase the still-unresolved subject hold. A real
  // newer guard observation remains deny-ward despite an older denial cache.
  const guard = { schemaVersion: 1, profileId, nonce: "99999999-9999-4999-8999-999999999999", revision: 3 };
  await h.raw({ kind: "run", sql: "INSERT OR REPLACE INTO records(key,value) VALUES(?,?)", values: [`curling.identity.accountDeletionGuard.${profileId}.v1`, JSON.stringify(guard)] });
  expect(await runtime.coordinator.observeNewerBarrier()).toEqual({ kind: "newer_barrier" });
});

for (const malformed of [false, true]) it(`detects an external barrier during genuine in-flight denial: malformed ${malformed}`, async () => {
  const h = await fixture(), entered = deferred<void>(), released = deferred<void>(); releases.push(() => released.resolve());
  const trustedModule = await import("../../identity/trustedDeviceRepository"), actualFactory = trustedModule.createTrustedDeviceRepository; let armed = false;
  vi.spyOn(trustedModule, "createTrustedDeviceRepository").mockImplementation(adapter => {
    const actual = actualFactory(adapter); return { ...actual, async remove() { const result = await actual.remove(); if (armed) { entered.resolve(); await released.promise; } return result; } };
  });
  const b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); const { calls } = accountTransport(h); armed = true;
  const request = runtime.accountDeletion.request(profileId, async () => (await runtime.coordinator.invalidateIdentity()).kind === "identity_invalidated");
  await entered.promise;
  const barrier = JSON.parse((await row(h, IDENTITY_BARRIER_STORAGE_KEY))!); barrier.barrierId = "99999999-9999-4999-8999-999999999999";
  await h.raw({ kind: "run", sql: "UPDATE records SET value=? WHERE key=?", values: [malformed ? "invalid-external-barrier" : JSON.stringify(barrier), IDENTITY_BARRIER_STORAGE_KEY] });
  expect(await runtime.coordinator.observeNewerBarrier()).toEqual({ kind: "newer_barrier" });
  released.resolve(); expect(await request).toEqual({ ok: false, error: "unavailable" }); expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
});
it("does not let an older still-completing denial suppress a newer guard observation", async () => {
  const h = await fixture(), entered = deferred<void>(), released = deferred<void>(); releases.push(() => released.resolve());
  const trustedModule = await import("../../identity/trustedDeviceRepository"), actualFactory = trustedModule.createTrustedDeviceRepository; let armed = false;
  vi.spyOn(trustedModule, "createTrustedDeviceRepository").mockImplementation(adapter => {
    const actual = actualFactory(adapter); return { ...actual, async remove() { const result = await actual.remove(); if (armed) { entered.resolve(); await released.promise; } return result; } };
  });
  const b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); const saved = (await row(h, TRUSTED_DEVICE_STORAGE_KEY))!; armed = true;
  const old = runtime.coordinator.invalidateIdentity(); await entered.promise; const newer = runtime.coordinator.requestEmailOtp(user.email);
  const guard = { schemaVersion: 1, profileId, nonce: "99999999-9999-4999-8999-999999999999", revision: 3 };
  await h.raw({ kind: "run", sql: "INSERT OR REPLACE INTO records(key,value) VALUES(?,?)", values: [TRUSTED_DEVICE_STORAGE_KEY, saved] });
  await h.raw({ kind: "run", sql: "INSERT OR REPLACE INTO records(key,value) VALUES(?,?)", values: [`curling.identity.accountDeletionGuard.${profileId}.v1`, JSON.stringify(guard)] });
  expect(await runtime.coordinator.observeNewerBarrier()).toEqual({ kind: "newer_barrier" });
  released.resolve(); expect((await old).kind).toBe("identity_invalidated"); await newer; expect(runtime.createSportingCloudService(profileId)).toBe(null);
});

describe('independent S5d adverse boundaries',()=>{
 it('owns a masked pending value observed as the settled beforeMutation result',async()=>{
  const {b,service}=await ready(),inner=deferred<void>();releases.push(()=>inner.resolve());Object.defineProperty(inner.promise,'then',{value:null});
  const result=await service.request(profileId,(async()=>inner.promise) as never);
  expect(result.ok).toBe(false);
  const cleanup=b.host.dispose();let closed=false;void cleanup.then(()=>{closed=true;});await new Promise(resolve=>setTimeout(resolve,20));
  expect(closed).toBe(false);inner.resolve();expect(await cleanup).toEqual({ok:true});
 });
 it('does not fabricate actual denial when its attributed scope was already superseded',async()=>{
  const {runtime,service}=await ready();let observed:unknown;let newer:Promise<unknown>|null=null;let denials=0;
  runtime.subscribeToProgress(phase=>{if(phase==='identity_denied_in_memory')denials++;});
  const result=await service.request(profileId,async()=>{
   newer=runtime.coordinator.requestEmailOtp(user.email);
   observed=await runtime.coordinator.invalidateIdentity().then(value=>({value}),()=>({refused:true}));
   return true;
  });
  expect(result.ok).toBe(false);await newer;expect(denials).toBe(0);expect(observed).toEqual({refused:true});
 });
 it('preserves confirmed pending facts if its genuine durable denial cannot complete',async()=>{
  const {h,runtime,service,state}=await ready();state.pending=pendingRow;const notices:unknown[]=[];runtime.subscribeToIdentityInvalidations(value=>notices.push(value));
  h.sqlFaults.hook=async(event,next)=>{if(event.kind==='run'&&event.values?.[0]===IDENTITY_BARRIER_STORAGE_KEY)throw null;return next();};
  const result=await service.getState();expect(notices).toEqual([expect.objectContaining({kind:'durable_denial_unavailable'})]);
  expect(result).toEqual({ok:true,value:pendingValue});
 });
});


describe('independent S5d ownership controls',()=>{
 it('continues to own a directly returned pending beforeMutation callback',async()=>{
  const {b,service}=await ready(),pending=deferred<boolean>(),entered=deferred<void>();releases.push(()=>pending.resolve(false));
  const work=service.request(profileId,()=>{entered.resolve();return pending.promise;});await entered.promise;
  const cleanup=b.host.dispose();let closed=false;void cleanup.then(()=>{closed=true;});await new Promise(resolve=>setTimeout(resolve,20));expect(closed).toBe(false);
  pending.resolve(false);expect((await work).ok).toBe(false);expect(await cleanup).toEqual({ok:true});
 });
 it('requires genuine own completion and sends once on the current normal request path',async()=>{
  const {runtime,service,calls}=await ready();
  const result=await service.request(profileId,async()=>(await runtime.coordinator.invalidateIdentity()).kind==='identity_invalidated');
  expect(result).toEqual({ok:true,value:pendingValue});expect(calls.map(value=>value.name)).toEqual(['get_my_account_deletion_control','request_my_account_deletion']);
 });
});

it("owns a masked rejected value actually observed after callback settlement", async () => {
  const { b, service } = await ready();
  expect((await service.request(profileId, (async () => {
    const rejected = Promise.reject(null); Object.defineProperty(rejected, "then", { value: null }); return rejected;
  }) as never)).ok).toBe(false);
  expect(await b.host.dispose()).toEqual({ ok: true });
});
it("revokes malformed settled callback permission after genuine own denial", async () => {
  const { b, runtime, service, calls } = await ready(), inner = deferred<void>(); releases.push(() => inner.resolve());
  Object.defineProperty(inner.promise, "then", { value: null });
  expect((await service.request(profileId, (async () => { await runtime.coordinator.invalidateIdentity(); return inner.promise; }) as never)).ok).toBe(false);
  expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]);
  const closing = b.host.dispose(); let closed = false; void closing.then(() => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 15)); expect(closed).toBe(false); inner.resolve(); expect(await closing).toEqual({ ok: true });
});
it("recognizes exact own disposal observed as a masked settled callback value", async () => {
  const { b, service } = await ready(); let closing: Promise<unknown> | null = null;
  const result = await service.request(profileId, (async () => {
    closing = b.host.dispose(); Object.defineProperty(closing, "then", { value: null, configurable: true }); return closing;
  }) as never);
  expect(result.ok).toBe(false); Reflect.deleteProperty(closing!, "then"); expect(await closing).toEqual({ ok: true });
});
for (const kind of ["supersede", "close"] as const) it(`does not publish failed-denial pending facts after ${kind}`, async () => {
  const { h, b, runtime, service, state } = await ready(); state.pending = pendingRow; let later: Promise<unknown> | null = null;
  h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) throw null; return next(); };
  runtime.subscribeToIdentityInvalidations(() => { later = kind === "close" ? b.host.dispose() : runtime.coordinator.requestEmailOtp(user.email); });
  expect(await service.getState()).toEqual({ ok: false, error: "unavailable" }); await later;
});
it("reports a current pending fact with failed denial but issues no subsequent guard or RPC effect", async () => {
  const { h, runtime, service, state, calls } = await ready(); state.pending = pendingRow; let guardIo = 0;
  h.sqlFaults.hook = async (event, next) => {
    if (event.values?.[0] === `curling.identity.accountDeletionGuard.${profileId}.v1`) guardIo++;
    if (event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) throw null;
    return next();
  };
  expect(await service.getState()).toEqual({ ok: true, value: pendingValue }); expect(guardIo).toBe(0);
  expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control"]); expect(runtime.createSportingCloudService(profileId)).toBe(null);
});
