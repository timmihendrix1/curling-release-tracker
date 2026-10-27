// Actual installed public AuthClient + disposable real SQLite. All values and
// transports are synthetic/injected; no platform Keychain or real account.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityRuntimeReady } from "../../identity/identityRuntime";
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
  await disposeCombinedFixtures(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
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
  vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "https://native-api.example.invalid");
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
async function ready() { const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); return { h, b, runtime }; }
async function tick() { await new Promise(resolve => setTimeout(resolve, 20)); }

import { createNewSession } from "../../sessionMigration";
import { createDefaultHistoryFilters } from "../../historyAnalysis";
import { createEmptyAssessmentPersistedState } from "../../assessment/persistence";
import { createEmptyAccuracyToleranceProfilesState } from "../../accuracyToleranceProfiles/persistence";
import { createEmptySmartRandomProfilesState } from "../../smartRandomProfiles/persistence";
import { emptySportingSyncState } from "../../cloudSporting/syncStateRepository";
import { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } from "../../sessionRepository";
import { PROFILE_SCOPED_SPORTING_STORAGE_KEYS, SPORTING_STORAGE_KEYS, LEGACY_SPORTING_RETIREMENT_MARKER_KEY, profileScopedSportingStorageKey } from "../../persistence/profileScopedSportingPersistence";

describe("dormant native local sporting scope", () => {
  it("requires actual admission and returns only frozen typed capabilities", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start();
    expect(runtime.createLocalSportingScope(profileId)).toBeNull(); await onboard(h, runtime);
    expect(runtime.createLocalSportingScope(user.id)).toBeNull();
    const scope = runtime.createLocalSportingScope(profileId)!;
    expect(Object.keys(scope).sort()).toEqual(["readPersonalExport", "repositories", "retireLegacyUnscopedData", "syncState"]);
    expect(Object.isFrozen(scope)).toBe(true); expect(Object.isFrozen(scope.repositories.session)).toBe(true);
    expect(Object.isFrozen(PROFILE_SCOPED_SPORTING_STORAGE_KEYS)).toBe(true); expect(Object.isFrozen(SPORTING_STORAGE_KEYS)).toBe(true);
    h.fetch.mockClear(); expect(await scope.retireLegacyUnscopedData()).toEqual({ ok: true, status: "retired" });
    expect(await scope.retireLegacyUnscopedData()).toEqual({ ok: true, status: "already_retired" }); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.sqlFaults).toBeDefined();
  });

  it("runs all21 actual repository methods plus sync/export on the same private SQLite", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, r = scope.repositories;
    h.fetch.mockClear();
    expect(await r.session.loadCurrent()).toEqual({ status: "absent" }); expect(await r.session.loadHistory()).toEqual({ status: "absent" });
    const current = createNewSession(); expect(await r.session.saveCurrent(current)).toEqual({ ok: true }); expect(await r.session.saveHistory([])).toEqual({ ok: true });
    expect(await r.session.archiveAndReplace([], current)).toEqual({ ok: true });
    expect(await r.historyFilters.save(createDefaultHistoryFilters())).toEqual({ ok: true }); expect((await r.historyFilters.load()).status).toBe("value");
    expect(await r.assessment.saveState(createEmptyAssessmentPersistedState())).toEqual({ ok: true }); expect((await r.assessment.loadState()).status).toBe("value");
    expect(await r.trainingPlans.savePlans([])).toEqual({ ok: true }); expect(await r.trainingPlans.loadPlans()).toEqual({ status: "value", value: [] });
    expect(await r.accuracyToleranceProfiles.saveState(createEmptyAccuracyToleranceProfilesState())).toEqual({ ok: true }); expect((await r.accuracyToleranceProfiles.loadState()).status).toBe("value");
    expect(await r.smartRandomProfiles.saveState(createEmptySmartRandomProfilesState())).toEqual({ ok: true }); expect((await r.smartRandomProfiles.loadState()).status).toBe("value");
    expect(await r.assessmentPreferences.setShowIntroduction(false)).toEqual({ ok: true }); expect(await r.assessmentPreferences.getShowIntroduction()).toEqual({ status: "value", value: false });
    expect(await r.assessmentPreferences.setLastThresholdPreset("custom")).toEqual({ ok: true }); expect(await r.assessmentPreferences.getLastThresholdPreset()).toEqual({ status: "value", value: "custom" });
    expect(await r.assessmentPreferences.setLastCustomThreshold({ onTarget: 0.1, acceptable: 0.2 })).toEqual({ ok: true }); expect(await r.assessmentPreferences.getLastCustomThreshold()).toEqual({ status: "value", value: { onTarget: 0.1, acceptable: 0.2 } });
    expect(await scope.syncState.save(emptySportingSyncState())).toEqual({ ok: true }); expect((await scope.syncState.load()).status).toBe("value");
    const exported = await scope.readPersonalExport(); expect(exported.ok).toBe(true); if (!exported.ok) throw null;
    expect(Object.keys(exported.records)).toEqual([...PROFILE_SCOPED_SPORTING_STORAGE_KEYS]); expect(exported.records[CURRENT_SESSION_STORAGE_KEY]).toBe(JSON.stringify(current));
    const loaded = await r.session.loadCurrent(); expect(loaded.status).toBe("value"); if (loaded.status !== "value") throw null;
    expect(Object.isFrozen(loaded.value)).toBe(false); loaded.value.title = "Caller edit";
    expect((await scope.readPersonalExport())).toEqual(exported); expect(h.fetch).not.toHaveBeenCalled();
  });

  it("captures original bytes, undefined, nonfinite and sparse-array meanings before await", async () => {
    const { runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, current = createNewSession();
    current.notes = undefined; const raw = JSON.stringify(current), pending = scope.repositories.session.saveCurrent(current); current.title = "Late alias";
    expect(await pending).toEqual({ ok: true });
    expect(await scope.repositories.assessmentPreferences.setLastCustomThreshold({ onTarget: NaN, acceptable: Infinity })).toEqual({ ok: true });
    const history = new Array<ReturnType<typeof createNewSession>>(2); history[1] = createNewSession(); const historyRaw = JSON.stringify(history);
    expect(await scope.repositories.session.saveHistory(history)).toEqual({ ok: true });
    const exported = await scope.readPersonalExport(); if (!exported.ok) throw null;
    expect(exported.records[CURRENT_SESSION_STORAGE_KEY]).toBe(raw); expect(exported.records[SESSION_HISTORY_STORAGE_KEY]).toBe(historyRaw);
    expect(await scope.repositories.assessmentPreferences.getLastCustomThreshold()).toEqual({ status: "value", value: null });
  });

  it.each(["getter", "iterator", "toJSON", "cycle", "class"])("does not execute malformed DTO %s capabilities", async mode => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!; let foreign = 0;
    const input = createNewSession();
    if (mode === "getter") Object.defineProperty(input, "title", { get() { foreign++; return "hidden"; } });
    else if (mode === "iterator") Object.defineProperty(input.blocks, Symbol.iterator, { get() { foreign++; throw null; } });
    else if (mode === "toJSON") Object.assign(input, { toJSON() { foreign++; return {}; } });
    else if (mode === "cycle") Object.assign(input, { extra: input }); else Object.setPrototypeOf(input, new (class {})());
    const before = h.trace.length;
    expect(await scope.repositories.session.saveCurrent(input)).toMatchObject({ ok: false }); expect(foreign).toBe(0); expect(h.trace).toHaveLength(before);
  });

  it.each(["root", "nested", "prototype", "descriptor"])("retains directly observed masked %s work through close", async mode => {
    const { h, b, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, hold = deferred<void>(); releases.push(() => hold.resolve());
    Object.defineProperty(hold.promise, "then", { value: null }); let input: unknown = createNewSession();
    if (mode === "root") input = Object.assign(hold.promise, input);
    else if (mode === "nested") Object.assign(input as object, { notes: hold.promise });
    else if (mode === "prototype") input = new Proxy(input as object, { getPrototypeOf: () => hold.promise });
    else input = new Proxy(input as object, { getOwnPropertyDescriptor(target, key) { const descriptor = Reflect.getOwnPropertyDescriptor(target, key); if (key === "title") { void b.host.dispose(); return { value: hold.promise, enumerable: true, configurable: true }; } return descriptor; } });
    let done = false; const pending = scope.repositories.session.saveCurrent(input as never).then(value => { done = true; return value; });
    await tick(); expect(done).toBe(false); let closed = false; const close = b.host.dispose().then(() => { closed = true; }); await tick(); expect(closed).toBe(false);
    hold.resolve(); expect(await pending).toMatchObject({ ok: false }); await close; expect(h.fetch).toHaveBeenCalled();
  });

  it("keeps old scopes retired after same-Profile authentication", async () => {
    const { h, runtime } = await ready(), old = runtime.createLocalSportingScope(profileId)!;
    await runtime.coordinator.invalidateIdentity(); await onboard(h, runtime);
    const before = h.trace.length; expect(await old.repositories.session.loadCurrent()).toMatchObject({ status: "read_failed" });
    expect(await old.repositories.session.saveCurrent(createNewSession())).toMatchObject({ ok: false }); expect(h.trace).toHaveLength(before);
    expect(await runtime.createLocalSportingScope(profileId)!.repositories.session.saveCurrent(createNewSession())).toEqual({ ok: true });
  });

  it("continues healthy SQL while an unrelated real SDK request is pending", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, entered = deferred<void>(), hold = deferred<void>(); releases.push(() => hold.resolve());
    const previous = h.fetch.getMockImplementation()!; h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.endsWith("/get_my_gate_state")) { entered.resolve(); await hold.promise; } return previous(...args); });
    const cloud = runtime.createSportingCloudService(profileId)!.restore(); await entered.promise;
    expect(await scope.repositories.session.saveCurrent(createNewSession())).toEqual({ ok: true }); hold.resolve(); await cloud;
  });
});

async function rawValue(h: Fixture, key: string): Promise<string | null> {
  const result = await h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key = ?;", values: [key] }) as { values: { value: string }[] };
  return result.values[0]?.value ?? null;
}
describe("native local sporting actual I/O boundaries", () => {
  it.each(["history", "current"] as const)("preserves the actual archive ACK when foreground ownership changes after %s", async at => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, original = createNewSession(), replacement = createNewSession();
    expect(await scope.repositories.session.saveCurrent(original)).toEqual({ ok: true });
    const historyKey = profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY), currentKey = profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY);
    let selected: unknown, armed = true, newer: Promise<unknown> | null = null;
    h.sqlFaults.hook = async (event, next) => {
      if (event.kind === "run") selected = event.values?.[0];
      const result = await next();
      if (armed && event.kind === "commit" && selected === (at === "history" ? historyKey : currentKey)) { armed = false; newer = runtime.coordinator.requestEmailOtp(user.email); }
      return result;
    };
    const outcome = await scope.repositories.session.archiveAndReplace([original], replacement); await newer;
    expect(outcome).toEqual(at === "history" ? { ok: false, step: "current", error: { kind: "storage_unavailable" } } : { ok: true });
    expect(await rawValue(h, historyKey)).toBe(JSON.stringify([original])); expect(await rawValue(h, currentKey)).toBe(JSON.stringify(at === "history" ? original : replacement));
    expect(await scope.repositories.session.saveCurrent(replacement)).toMatchObject({ ok: false });
  });

  it("drains an issued history ACK after mapper failure and refuses the successor write", async () => {
    const path = "../../persistence/profileScopedSportingPersistence";
    vi.doMock(path, async () => {
      const actual = await vi.importActual<typeof import("../../persistence/profileScopedSportingPersistence")>(path);
      return { ...actual, createProfileScopedSportingRepositories(...args: Parameters<typeof actual.createProfileScopedSportingRepositories>) {
        const repositories = actual.createProfileScopedSportingRepositories(...args);
        return { ...repositories, session: { ...repositories.session,
          async archiveAndReplace(history: Parameters<typeof repositories.session.archiveAndReplace>[0], current: Parameters<typeof repositories.session.archiveAndReplace>[1]) {
            void repositories.session.archiveAndReplace(history, current).then(() => {}, () => {});
            throw null;
          },
        } };
      } };
    });
    try {
      const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!;
      const entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
      const historyKey = profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY);
      const currentKey = profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY);
      let historyIssued = false, historyCommitted = false, currentIssued = false, settled = false;
      h.sqlFaults.hook = async (event, next) => {
        if (event.kind === "run" && event.values?.[0] === currentKey) currentIssued = true;
        if (event.kind === "run" && event.values?.[0] === historyKey) {
          historyIssued = true; entered.resolve(); await release.promise;
        }
        const result = await next();
        if (event.kind === "commit" && historyIssued) historyCommitted = true;
        return result;
      };
      const work = scope.repositories.session.archiveAndReplace([], createNewSession()).then(result => { settled = true; return result; });
      await entered.promise; await tick(); expect(settled).toBe(false);
      release.resolve();
      expect(await work).toMatchObject({ ok: false, step: "current" });
      expect(historyCommitted).toBe(true); expect(currentIssued).toBe(false);
      expect(await rawValue(h, historyKey)).toBe("[]");
      expect(await rawValue(h, currentKey)).toBeNull();
      expect(await scope.repositories.session.saveCurrent(createNewSession())).toEqual({ ok: true });
    } finally { vi.doUnmock(path); }
  });

  it("preserves real partial current failure after a confirmed archive", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, original = createNewSession();
    const historyKey = profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY), currentKey = profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY);
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === currentKey) throw null; return next(); };
    expect(await scope.repositories.session.archiveAndReplace([original], createNewSession())).toMatchObject({ ok: false, step: "current" });
    expect(await rawValue(h, historyKey)).toBe(JSON.stringify([original])); expect(await rawValue(h, currentKey)).toBeNull();
  });

  it("holds actual parallel Assessment reads and mapper continuation through close", async () => {
    const { h, b, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    let armed = true;
    h.sqlFaults.hook = async (event, next) => { if (armed && event.kind === "query" && typeof event.values?.[0] === "string" && event.values[0].includes("assessment")) { armed = false; entered.resolve(); await hold.promise; } return next(); };
    let done = false; const pending = scope.repositories.assessment.loadState().then(value => { done = true; return value; }); await entered.promise;
    let closed = false; const close = b.host.dispose().then(() => { closed = true; }); await tick(); expect(closed).toBe(false); expect(done).toBe(false);
    hold.resolve(); expect(await pending).toMatchObject({ status: "read_failed", fallback: { state: { history: [] } } }); await close;
  });

  it("guards Assessment's actual read-time split writes after stale first acknowledgement", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!;
    const { ASSESSMENT_STORAGE_KEY, ASSESSMENT_HISTORY_STORAGE_KEY, ASSESSMENT_DRAFT_STORAGE_KEY } = await import("../../assessment/persistence");
    const legacyKey = profileScopedSportingStorageKey(profileId, ASSESSMENT_STORAGE_KEY), historyKey = profileScopedSportingStorageKey(profileId, ASSESSMENT_HISTORY_STORAGE_KEY), draftKey = profileScopedSportingStorageKey(profileId, ASSESSMENT_DRAFT_STORAGE_KEY);
    await h.raw({ kind: "run", sql: "INSERT INTO records(key,value) VALUES (?,?);", values: [legacyKey, JSON.stringify(createEmptyAssessmentPersistedState())] });
    let selected: unknown, armed = true, newer: Promise<unknown> | null = null;
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "run") selected = event.values?.[0]; const result = await next(); if (armed && event.kind === "commit" && selected === historyKey) { armed = false; newer = runtime.coordinator.requestEmailOtp(user.email); } return result; };
    expect(await scope.repositories.assessment.loadState()).toMatchObject({ status: "read_failed" }); await newer;
    expect(await rawValue(h, historyKey)).not.toBeNull(); expect(await rawValue(h, draftKey)).toBeNull(); expect(await rawValue(h, legacyKey)).not.toBeNull();
  });

  it("retires exactly target legacy keys, preserves scoped/foreign/source records and never reads their old contents", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!;
    for (const key of [...SPORTING_STORAGE_KEYS, "foreign.synthetic"]) await h.raw({ kind: "run", sql: "INSERT INTO records(key,value) VALUES (?,?);", values: [key, "synthetic opaque old data"] });
    const original = createNewSession(); expect(await scope.repositories.session.saveCurrent(original)).toEqual({ ok: true });
    const beforeSource = h.source.snapshot(), traceStart = h.trace.length;
    expect(await scope.retireLegacyUnscopedData()).toEqual({ ok: true, status: "retired" });
    expect(h.trace.slice(traceStart).filter(event => event.kind === "query" && SPORTING_STORAGE_KEYS.includes(event.values?.[0] as never))).toEqual([]);
    for (const key of SPORTING_STORAGE_KEYS) expect(await rawValue(h, key)).toBeNull();
    expect(await rawValue(h, LEGACY_SPORTING_RETIREMENT_MARKER_KEY)).toBe("complete"); expect(await rawValue(h, "foreign.synthetic")).toBe("synthetic opaque old data");
    expect(await rawValue(h, profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY))).toBe(JSON.stringify(original)); expect(h.source.snapshot()).toEqual(beforeSource);
  });
});

describe("native local sporting cancellation and isolation", () => {
  it.each(["prototype", "descriptor"] as const)("does not continue reflecting after %s supersession", async mode => {
    const { runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!; let later = 0, newer: Promise<unknown> | null = null;
    const data = createNewSession(); Object.defineProperty(data, "title", { get() { later++; return "never"; }, configurable: true });
    const input = new Proxy(data, mode === "prototype" ? { getPrototypeOf() { newer ??= runtime.coordinator.requestEmailOtp(user.email); return Object.prototype; } } : { getOwnPropertyDescriptor(target, key) { if (key === "id") newer ??= runtime.coordinator.requestEmailOtp(user.email); if (key === "title") later++; return Reflect.getOwnPropertyDescriptor(target, key); } });
    expect(await scope.repositories.session.saveCurrent(input)).toMatchObject({ ok: false }); expect(later).toBe(0); await newer;
  });

  it("avoids self-drain when reflection returns the exact genuine disposal", async () => {
    const { b, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!;
    const input = new Proxy(createNewSession(), { getPrototypeOf: () => b.host.dispose() });
    expect(await scope.repositories.session.saveCurrent(input)).toMatchObject({ ok: false }); expect(await b.host.dispose()).toEqual({ ok: true });
  });

  it.each(["constructor", "species"] as const)("refuses a poisoned %s Promise root without SQL", async mode => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, hold = deferred<void>(); releases.push(() => hold.resolve());
    Object.assign(hold.promise, createNewSession()); Object.defineProperty(hold.promise, "then", { value: null });
    Object.defineProperty(hold.promise, "constructor", mode === "constructor" ? { get() { throw null; } } : { value: { get [Symbol.species]() { throw null; } } });
    const before = h.trace.length; expect(await scope.repositories.session.saveCurrent(hold.promise as never)).toMatchObject({ ok: false }); expect(h.trace).toHaveLength(before); hold.resolve();
  });

  it("owns rejected nested work and ordinary root thenables without poisoning another local call", async () => {
    const { runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    const failed = { ...createNewSession(), notes: Promise.reject(null) }; expect(await scope.repositories.session.saveCurrent(failed as never)).toMatchObject({ ok: false });
    const thenable = { ...createNewSession(), then(resolve: () => void) { entered.resolve(); void hold.promise.then(resolve); } };
    let done = false; const pending = scope.repositories.session.saveCurrent(thenable).then(value => { done = true; return value; }); await entered.promise;
    expect(await scope.repositories.session.saveCurrent(createNewSession())).toEqual({ ok: true }); expect(done).toBe(false); hold.resolve(); expect(await pending).toMatchObject({ ok: false });
  });

  it("does not poison a concurrently active SDK command with malformed local data", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    const previous = h.fetch.getMockImplementation()!; h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.endsWith("/get_my_gate_state")) { entered.resolve(); await hold.promise; } if ((args[0] as Request).url.endsWith("/set_my_team_exercise_recording_permission")) return response({ outcome: "granted", changed_at: actedAt }); return previous(...args); });
    const team = runtime.createTeamExerciseCloudService(profileId)!.setRecordingPermission(profileId, true); await entered.promise;
    expect(await scope.repositories.session.saveCurrent({ ...createNewSession(), notes: () => "not data" } as never)).toMatchObject({ ok: false }); hold.resolve(); expect(await team).toEqual({ ok: true, value: { outcome: "granted", changedAt: actedAt } });
    // The genuine restored credential/session was not marked malformed by the
    // separate local call; a subsequent real Identity read still completes.
    expect(await runtime.coordinator.revalidateGateFacts()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  });

  it("normal local scopes close on genuine credential failure and do not grant Q1", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!;
    h.faults.hook = async (event, next) => { if (event.kind === "read") throw null; return next(); };
    await runtime.coordinator.revalidateGateFacts();
    expect(await scope.repositories.session.saveCurrent(createNewSession())).toMatchObject({ ok: false }); expect(runtime.createLocalSportingScope(profileId)).toBeNull();
  });
});

import { createTechniqueExecution, createCompletedTechniqueExecution, createRotationCountExecution, FIXTURE_SESSION_ID } from "../../exercises/__tests__/executionFixtures";
import { buildPlan } from "../../trainingPlans/__tests__/testHelpers";
import { createTestRun } from "../../assessment/__tests__/testHelpers";
import { SportingCloudSyncManager } from "../../cloudSporting/syncManager";

describe("native local actual DTO and manager compatibility", () => {
  it.each(["technique", "measured"] as const)("preserves actual %s execution bytes and mutable restored DTOs", async mode => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!;
    const execution = mode === "technique" ? createTechniqueExecution() : createRotationCountExecution();
    const stored = { ...createNewSession(), id: FIXTURE_SESSION_ID, exerciseExecutions: [execution], activeExerciseExecutionId: execution.id };
    const raw = JSON.stringify(stored); expect(await scope.repositories.session.saveCurrent(stored)).toEqual({ ok: true });
    expect(await rawValue(h, profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY))).toBe(raw);
    const loaded = await scope.repositories.session.loadCurrent(); expect(loaded).toEqual({ status: "value", value: stored }); if (loaded.status !== "value") throw null;
    loaded.value.exerciseExecutions![0].athleteResults[0].privateNote = "Caller edit"; expect(Object.isFrozen(loaded.value.exerciseExecutions)).toBe(false);
    expect(await rawValue(h, profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY))).toBe(raw);
  });

  it("uses actual nonempty Plan and Assessment serializers without normalization or alias changes", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, plan = buildPlan(), run = createTestRun();
    const { TRAINING_PLANS_STORAGE_KEY, TRAINING_PLANS_SCHEMA_VERSION } = await import("../../trainingPlans/persistence");
    const { ASSESSMENT_DRAFT_STORAGE_KEY, ASSESSMENT_PERSISTENCE_SCHEMA_VERSION } = await import("../../assessment/persistence");
    const planRaw = JSON.stringify({ schemaVersion: TRAINING_PLANS_SCHEMA_VERSION, plans: [plan] });
    const savePlan = scope.repositories.trainingPlans.savePlans([plan]); plan.name = "Late alias"; expect(await savePlan).toEqual({ ok: true });
    expect(await rawValue(h, profileScopedSportingStorageKey(profileId, TRAINING_PLANS_STORAGE_KEY))).toBe(planRaw);
    const state = { ...createEmptyAssessmentPersistedState(), currentRun: run }, draftRaw = JSON.stringify({ schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION, currentRun: run });
    const saveAssessment = scope.repositories.assessment.saveState(state); run.notes = "Late alias"; expect(await saveAssessment).toEqual({ ok: true });
    expect(await rawValue(h, profileScopedSportingStorageKey(profileId, ASSESSMENT_DRAFT_STORAGE_KEY))).toBe(draftRaw);
  });

  it("rejects a source changed between the two actual13-key export passes", async () => {
    const { h, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, stored = createNewSession();
    expect(await scope.repositories.session.saveCurrent(stored)).toEqual({ ok: true }); const key = profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY); let reads = 0;
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "query" && event.values?.[0] === key && ++reads === 2) await h.raw({ kind: "run", sql: "UPDATE records SET value = ? WHERE key = ?;", values: [JSON.stringify({ ...stored, title: "Concurrent synthetic edit" }), key] }); return next(); };
    expect(await scope.readPersonalExport()).toEqual({ ok: false }); expect(reads).toBe(2);
  });

  it("keeps the real manager's ordinary outbox in native SQLite, with outer alias ownership explicitly still excluded", async () => {
    const { runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!;
    const manager = new SportingCloudSyncManager(scope.repositories, scope.syncState, null, () => false, null, profileId); await manager.initialize();
    const execution = createCompletedTechniqueExecution(), stored = { ...createNewSession(), id: FIXTURE_SESSION_ID, exerciseExecutions: [execution] };
    expect(await manager.decorateRepositories().session.saveHistory([stored])).toEqual({ ok: true });
    await manager.synchronize(); const state = await scope.syncState.load(); expect(state.status).toBe("value"); if (state.status !== "value") throw null;
    expect(state.value.entries).toHaveLength(1); expect(state.value.entries[0].payload).toBe(JSON.stringify(stored)); expect(manager.getSnapshot()).toMatchObject({ pendingCount: 1, truth: "saved_on_device" });
  });
});

describe("native local separate work and export privacy", () => {
  it.each(["root-first", "prototype-first"] as const)("owns root and directly observed prototype separately: %s", async first => {
    const { b, runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, root = deferred<void>(), prototype = deferred<void>(), entered = deferred<void>(); releases.push(() => root.resolve(), () => prototype.resolve()); Object.defineProperty(prototype.promise, "then", { value: null });
    const input = new Proxy({ ...createNewSession(), then(resolve: () => void) { entered.resolve(); void root.promise.then(resolve); } }, { getPrototypeOf() { return prototype.promise; } });
    let done = false, closed = false; const pending = scope.repositories.session.saveCurrent(input).then(value => { done = true; return value; }); await entered.promise;
    const close = b.host.dispose().then(() => { closed = true; }); (first === "root-first" ? root : prototype).resolve(); await tick(); expect(done).toBe(false); expect(closed).toBe(false);
    root.resolve(); prototype.resolve(); expect(await pending).toMatchObject({ ok: false }); await close;
  });

  it("projects the actual native team outbox without another athlete's raw results", async () => {
    const { runtime } = await ready(), scope = runtime.createLocalSportingScope(profileId)!, other = crypto.randomUUID(), sessionId = crypto.randomUUID(), execution = crypto.randomUUID();
    const { CLOUD_SPORTING_SYNC_STORAGE_KEY } = await import("../../cloudSporting/syncStateRepository");
    const state = emptySportingSyncState(), hash = "a".repeat(64);
    state.teamEntries = [{ entryKind: "team_exercise_session", sessionId, teamId: crypto.randomUUID(), schemaVersion: 1, coordinationPayload: "SYNTHETIC_SHARED", startedAt: actedAt, completedAt: actedAt, participantProfileIds: [profileId, other], trainingAthleteProfileIds: [profileId, other], executionIds: [execution], contentSha256: hash, status: "pending" }, ...[profileId, other].map(athleteProfileId => ({ entryKind: "team_exercise_bundle" as const, bundleId: crypto.randomUUID(), sessionId, athleteProfileId, schemaVersion: 1, resultPayload: athleteProfileId === profileId ? "OWN_SYNTHETIC_PRIVATE" : "OTHER_SYNTHETIC_PRIVATE", recordedAt: actedAt, resultIds: [crypto.randomUUID()], executionIds: [execution], contentSha256: hash, status: "pending" as const }))];
    expect(await scope.syncState.save(state)).toEqual({ ok: true });
    const exported = await scope.readPersonalExport(); expect(exported.ok).toBe(true); if (!exported.ok) throw null;
    const raw = exported.records[CLOUD_SPORTING_SYNC_STORAGE_KEY]!; expect(raw).not.toContain("OTHER_SYNTHETIC_PRIVATE"); expect(raw).toContain("OWN_SYNTHETIC_PRIVATE");
    expect(JSON.parse(raw)).toMatchObject({ format: "personal-data-not-an-installation-backup", ownedTeamResultOutbox: [{ athleteProfileId: profileId }], teamCoordinationOutbox: [{ sessionId }] });
    const local = await scope.syncState.load(); expect(local.status).toBe("value"); if (local.status === "value") expect(local.value.teamEntries).toHaveLength(3);
  });
});
