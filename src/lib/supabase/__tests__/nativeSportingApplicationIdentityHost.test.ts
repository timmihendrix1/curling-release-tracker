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

import { createCompletedTechniqueExecution, FIXTURE_SESSION_ID } from "../../exercises/__tests__/executionFixtures";
import { createTestRun } from "../../assessment/__tests__/testHelpers";
import { CLOUD_SPORTING_SYNC_STORAGE_KEY } from "../../cloudSporting/syncStateRepository";
import { createNewSession } from "../../sessionMigration";
import { createDefaultHistoryFilters } from "../../historyAnalysis";
import { createEmptyAssessmentPersistedState } from "../../assessment/persistence";
import { createEmptyAccuracyToleranceProfilesState } from "../../accuracyToleranceProfiles/persistence";
import { createEmptySmartRandomProfilesState } from "../../smartRandomProfiles/persistence";
import { emptySportingSyncState } from "../../cloudSporting/syncStateRepository";
import { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } from "../../sessionRepository";
import { profileScopedSportingStorageKey } from "../../persistence/profileScopedSportingPersistence";

async function rawValue(h: Fixture, key: string): Promise<string | null> {
  const result = await h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key = ?;", values: [key] }) as { values: Array<{ value: string }> };
  return result.values[0]?.value ?? null;
}
async function appReady() {
  const result = await ready(); vi.stubGlobal("navigator", { onLine: false });
  const scope = result.runtime.createSportingApplicationScope(profileId)!;
  await scope.sync.initialize();
  return { ...result, scope };
}
async function syncState(h: Fixture) {
  const raw = await rawValue(h, profileScopedSportingStorageKey(profileId, CLOUD_SPORTING_SYNC_STORAGE_KEY));
  return raw ? JSON.parse(raw) : emptySportingSyncState();
}
function terminalSession() { return { ...createNewSession(), id: FIXTURE_SESSION_ID, exerciseExecutions: [createCompletedTechniqueExecution()] }; }
function onlineTransport(h: Fixture) {
  const previous = h.fetch.getMockImplementation()!;
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, path = new URL(request.url).pathname;
    if (path.endsWith("get_my_sporting_records") || path.includes("/team_exercise_")) return response([]);
    if (path.endsWith("put_my_sporting_record")) return response({ outcome: "inserted", content_sha256: "a".repeat(64) });
    if (path.endsWith("set_my_team_exercise_recording_permission")) return response({ outcome: "granted", changed_at: actedAt });
    return previous(...args);
  });
}

describe("dormant native sporting application scope", () => {
  it("requires genuine admission and memoizes one frozen manager capability without constructor I/O", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start();
    expect(runtime.createSportingApplicationScope(profileId)).toBeNull(); await onboard(h, runtime);
    const before = h.trace.length; h.fetch.mockClear();
    const scope = runtime.createSportingApplicationScope(profileId)!;
    expect(runtime.createSportingApplicationScope(profileId)).toBe(scope); expect(runtime.createSportingApplicationScope(user.id)).toBeNull();
    expect(Object.keys(scope).sort()).toEqual(["readPersonalExport", "repositories", "retireLegacyUnscopedData", "sync"]);
    expect(Object.keys(scope.sync)).toHaveLength(15); expect(Object.isFrozen(scope.sync)).toBe(true); expect(h.trace).toHaveLength(before); expect(h.fetch).not.toHaveBeenCalled();
    expect(scope.sync.getSnapshot()).toMatchObject({ ready: false, pendingCount: 0 });
  });

  it("runs all21 actual decorated repository methods and the three sync controls", async () => {
    const { h, scope } = await appReady(), r = scope.repositories; h.fetch.mockClear();
    expect(await scope.retireLegacyUnscopedData()).toEqual({ ok: true, status: "retired" });
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
    await scope.sync.retry(); await scope.sync.synchronize(); expect(scope.sync.getSnapshot().ready).toBe(true);
    expect((await scope.readPersonalExport()).ok).toBe(true); expect(h.fetch).not.toHaveBeenCalled();
    const loaded = await r.session.loadCurrent(); if (loaded.status !== "value") throw null;
    loaded.value.title = "Detached caller edit"; expect(await rawValue(h, profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY))).toBe(JSON.stringify(current));
  });

  it("captures terminal history before the base ACK and later actual outbox reconciliation", async () => {
    const { h, scope } = await appReady(), history = [terminalSession()], raw = JSON.stringify(history[0]);
    const entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    const key = profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY);
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === key) { entered.resolve(); await release.promise; } return next(); };
    const write = scope.repositories.session.saveHistory(history); await entered.promise; history[0].title = "Late caller mutation"; history.length = 0; release.resolve();
    expect(await write).toEqual({ ok: true });
    await vi.waitFor(async () => { expect((await syncState(h)).entries[0]?.payload).toBe(raw); });
    expect(await rawValue(h, key)).toBe(`[${raw}]`);
  });

  it("owns Assessment history before a blocked predecessor lane resumes", async () => {
    const { h, scope } = await appReady(); onlineTransport(h); vi.stubGlobal("navigator", { onLine: true });
    const entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    const previous = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.endsWith("get_my_sporting_records")) { entered.resolve(); await release.promise; } return previous(...args); });
    const blocked = scope.sync.synchronize(); await entered.promise;
    const run = { ...createTestRun(), status: "completed" as const, completedAt: actedAt }, state = { ...createEmptyAssessmentPersistedState(), history: [run] };
    const raw = JSON.stringify(run); expect(await scope.repositories.assessment.saveState(state)).toEqual({ ok: true });
    run.notes = "Late caller mutation"; state.history.length = 0; vi.stubGlobal("navigator", { onLine: false }); release.resolve(); await blocked;
    await vi.waitFor(async () => { expect((await syncState(h)).entries.some((entry: { payload: string }) => entry.payload === raw)).toBe(true); });
  });

  it("returns the local ACK while an actual background cloud request remains pending and dispose owns it", async () => {
    const { h, b, scope } = await appReady(); onlineTransport(h); vi.stubGlobal("navigator", { onLine: true });
    const entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve()); const previous = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.endsWith("put_my_sporting_record")) { entered.resolve(); await release.promise; } return previous(...args); });
    expect(await scope.repositories.session.saveHistory([terminalSession()])).toEqual({ ok: true }); await entered.promise;
    expect(await scope.repositories.session.saveCurrent(createNewSession())).toEqual({ ok: true });
    let closed = false; const closing = b.host.dispose().then(() => { closed = true; }); await tick(); expect(closed).toBe(false); release.resolve(); await closing;
    expect(scope.sync.getSnapshot()).toMatchObject({ ready: false, pendingCount: 0 });
  });

  it.each(["getter", "cycle", "class", "promise", "prototype", "descriptor"])("refuses and owns malformed outer %s before planning a lane", async mode => {
    const { h, b, scope } = await appReady(), hold = deferred<void>(); releases.push(() => hold.resolve());
    Object.defineProperty(hold.promise, "then", { value: null }); let calls = 0, input: unknown = terminalSession();
    if (mode === "getter") Object.defineProperty(input, "title", { get() { calls++; return "invalid"; } });
    if (mode === "cycle") Object.assign(input as object, { extra: input });
    if (mode === "class") Object.setPrototypeOf(input as object, new (class {})());
    if (mode === "promise") input = Object.assign(hold.promise, input);
    if (mode === "prototype") input = new Proxy(input as object, { getPrototypeOf: () => hold.promise });
    if (mode === "descriptor") input = new Proxy(input as object, { getOwnPropertyDescriptor(target, key) { if (key === "title") return { value: hold.promise, enumerable: true, configurable: true }; return Reflect.getOwnPropertyDescriptor(target, key); } });
    const before = h.trace.length; let done = false; const work = scope.repositories.session.saveHistory([input] as never).then(value => { done = true; return value; });
    if (["promise", "prototype", "descriptor"].includes(mode)) { await tick(); expect(done).toBe(false); let closed = false; const closing = b.host.dispose().then(() => { closed = true; }); await tick(); expect(closed).toBe(false); hold.resolve(); await closing; }
    expect(await work).toMatchObject({ ok: false }); expect(calls).toBe(0);
    // Close control SQL may run, but no sporting record write is allowed.
    expect(h.trace.slice(before).filter(event => event.kind === "run" && typeof event.values?.[0] === "string" && event.values[0].includes("sporting"))).toEqual([]);
  });

  it.each(["history", "current"] as const)("keeps actual archive facts when foreground is lost after %s ACK", async at => {
    const { h, runtime, scope } = await appReady(), historyKey = profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY), currentKey = profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY);
    let selected: unknown, armed = true, newer: Promise<unknown> | null = null;
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "run") selected = event.values?.[0]; const result = await next(); if (armed && event.kind === "commit" && selected === (at === "history" ? historyKey : currentKey)) { armed = false; newer = runtime.coordinator.requestEmailOtp(user.email); } return result; };
    const result = await scope.repositories.session.archiveAndReplace([terminalSession()], createNewSession()); await newer;
    expect(result).toMatchObject(at === "history" ? { ok: false, step: "current" } : { ok: true }); expect(await rawValue(h, historyKey)).not.toBeNull();
    expect(scope.sync.getSnapshot()).toMatchObject({ ready: false, pendingCount: 0 });
  });

  it("never revives the old capability after same-Profile authentication", async () => {
    const { runtime, scope } = await appReady(); expect((await runtime.coordinator.signOut()).kind).toBe("signed_out_locked");
    await runtime.coordinator.requestEmailOtp(user.email); await runtime.coordinator.verifyEmailOtp(user.email, "123456");
    const fresh = runtime.createSportingApplicationScope(profileId)!; expect(fresh).not.toBe(scope); expect(runtime.createSportingApplicationScope(profileId)).toBe(fresh);
    expect(await scope.repositories.session.saveCurrent(createNewSession())).toMatchObject({ ok: false }); expect(scope.sync.getSnapshot().ready).toBe(false);
    await fresh.sync.initialize(); expect(fresh.sync.getSnapshot().ready).toBe(true);
  });

  it("detaches snapshots and checks membership between listener deliveries", async () => {
    const { scope } = await appReady(), first = scope.sync.getSnapshot(); first.issueSummary.hasGeneralIssue = true; first.teamSessions.push({ sessionId: "caller", status: "sync_issue" });
    expect(scope.sync.getSnapshot().issueSummary.hasGeneralIssue).toBe(false); expect(scope.sync.getSnapshot().teamSessions).toEqual([]);
    let later = 0, unsubscribe = () => {}; scope.sync.subscribe(() => unsubscribe()); unsubscribe = scope.sync.subscribe(() => { later++; });
    await scope.sync.retry(); expect(later).toBe(0); unsubscribe(); unsubscribe();
  });

  it.each(["pending", "masked", "rejected", "reentrant", "own-disposal"])("owns listener %s without blocking its publishing lane", async mode => {
    const { b, scope } = await appReady(), hold = deferred<void>(); releases.push(() => hold.resolve());
    if (mode === "masked") Object.defineProperty(hold.promise, "then", { value: null });
    let calls = 0, nested: Promise<unknown> | null = null;
    scope.sync.subscribe(() => {
      if (++calls !== 1) return;
      if (mode === "own-disposal") return b.host.dispose() as never;
      if (mode === "reentrant") return (nested = scope.sync.retry()) as never;
      return (mode === "rejected" ? Promise.reject(null) : hold.promise) as never;
    });
    await scope.sync.retry();
    if (mode === "reentrant") { await nested; expect(calls).toBeGreaterThan(1); }
    else if (mode === "own-disposal") await b.host.dispose();
    else { let closed = false; const closing = b.host.dispose().then(() => { closed = true; }); await tick(); if (mode !== "rejected") expect(closed).toBe(false); hold.resolve(); await closing; }
  });

  it("closes on actual credential failure and grants no Q1 continuation", async () => {
    const { h, runtime, scope } = await appReady(); h.faults.hook = async (event, next) => { if (event.kind === "read") throw null; return next(); };
    await runtime.coordinator.revalidateGateFacts(); expect(runtime.createSportingApplicationScope(profileId)).toBeNull();
    expect(await scope.repositories.session.saveCurrent(createNewSession())).toMatchObject({ ok: false }); expect(scope.sync.getSnapshot().ready).toBe(false);
  });
});

import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import { createTeamExerciseExecution, addTeamShotmakingAttempt, completeTeamExerciseExecution } from "../../exercises/teamExecution";
import { serializeCompletedTeamExercise } from "../../cloudSporting/teamExerciseRecords";
import { sha256Hex } from "../../cloudSporting/records";
import type { TeamWorkspace } from "../../team/teamService";
const teamId = "77777777-7777-4777-8777-777777777777", otherId = "88888888-8888-4888-8888-888888888888", observerId = "99999999-9999-4999-8999-999999999999";
function teamDraft() {
  const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID)!;
  const clock = { id: () => crypto.randomUUID(), now: () => actedAt };
  const created = createTeamExerciseExecution(version, { trainingSessionId: crypto.randomUUID(), teamId, recorderProfileId: profileId,
    participantRoster: [{ profileId, participation: "training-athlete" }, { profileId: otherId, participation: "training-athlete" }, { profileId: observerId, participation: "supporting" }],
    initialRoleAssignment: { deliveringAthleteProfileId: profileId, sweeperProfileIds: [], observerProfileId: observerId, sweepingUsed: false }, rotation: { kind: "manual", athleteOrder: [profileId, otherId] }, clock });
  if (!created.ok) throw new Error(created.error.message);
  const attempted = addTeamShotmakingAttempt(created.value, { recorderProfileId: profileId, athleteProfileId: profileId, actualHandle: "out", evaluation: { status: "scored", score: 4 }, clock });
  if (!attempted.ok) throw new Error(attempted.error.message); return attempted.value;
}
function completedTeam(draft = teamDraft()) { const result = completeTeamExerciseExecution(draft, profileId, actedAt); if (!result.ok) throw new Error(result.error.message); return result.value; }
async function ownTeamTransport(h: Fixture, completed: ReturnType<typeof completedTeam>) {
  const upload = serializeCompletedTeamExercise(completed)!;
  const bundle = upload.bundles.find(row => row.athleteProfileId === profileId)!;
  const session = upload.session, sessionHash = await sha256Hex(session.coordinationPayload), bundleHash = await sha256Hex(bundle.resultPayload);
  const rows: Record<string, unknown[]> = {
    team_exercise_result_bundles: [{ id: bundle.bundleId, session_id: bundle.sessionId, athlete_profile_id: profileId, recorded_by_profile_id: profileId, schema_version: bundle.schemaVersion, result_payload: bundle.resultPayload, content_sha256: bundleHash, recorded_at: bundle.recordedAt, created_at: actedAt }],
    team_exercise_sessions: [{ id: session.sessionId, team_id: teamId, recorded_by_profile_id: profileId, schema_version: session.schemaVersion, coordination_payload: session.coordinationPayload, content_sha256: sessionHash, started_at: session.startedAt, completed_at: session.completedAt, created_at: actedAt }],
    team_exercise_session_participants: session.participantProfileIds.map(id => ({ session_id: session.sessionId, profile_id: id, participation: session.trainingAthleteProfileIds.includes(id) ? "training-athlete" : "supporting" })),
    team_exercise_execution_refs: session.executionIds.map(id => ({ session_id: session.sessionId, execution_id: id })),
    team_exercise_result_refs: bundle.resultIds.map((id, i) => ({ bundle_id: bundle.bundleId, result_id: id, athlete_profile_id: profileId, execution_id: bundle.executionIds[i] })),
    team_exercise_private_notes: [], team_exercise_result_revisions: [],
    team_exercise_recording_permissions: [{ athlete_profile_id: profileId, granted_at: actedAt }],
  };
  const previous = h.fetch.getMockImplementation()!, calls: Array<{ name: string; body: Record<string, unknown> | null }> = [];
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, name = new URL(request.url).pathname.split("/").pop()!;
    if (Object.hasOwn(rows, name)) { calls.push({ name, body: null }); return response(rows[name]); }
    if (["set_my_team_exercise_recording_permission", "set_my_team_exercise_private_note", "revise_my_team_exercise_result", "void_my_team_exercise_result"].includes(name)) {
      const body = JSON.parse(await request.text()); calls.push({ name, body });
      if (name === "set_my_team_exercise_recording_permission") return response({ outcome: body.p_granted ? "granted" : "revoked", changed_at: actedAt });
      if (name === "set_my_team_exercise_private_note") return response({ outcome: "updated", updated_at: actedAt });
      return response({ outcome: "inserted", revision_id: body.p_revision_id, revision_number: 1, changed_at: actedAt });
    }
    return previous(...args);
  });
  return { calls, bundle };
}

describe("native actual manager Team actions and retirement", () => {
  it("captures actual Team draft/finalization/enqueue/discard through native outbox", async () => {
    const { h, scope } = await appReady(), draft = teamDraft(), original = structuredClone(draft);
    const save = scope.sync.saveActiveTeamExerciseDraft(draft); draft.athleteResults[0].privateNote = "Late caller alias";
    expect(await save).toBe(true); expect(scope.sync.getSnapshot().activeTeamExerciseDraft).toEqual(original);
    const snapshot = scope.sync.getSnapshot(); snapshot.activeTeamExerciseDraft!.athleteResults[0].privateNote = "Snapshot alias";
    expect(scope.sync.getSnapshot().activeTeamExerciseDraft).toEqual(original);
    const completed = completedTeam(original); expect(await scope.sync.finalizeActiveTeamExerciseDraft(completed)).toBe(true);
    expect(scope.sync.getSnapshot().activeTeamExerciseDraft).toBeNull(); expect((await syncState(h)).teamEntries).toHaveLength(3);
    expect(await scope.sync.enqueueCompletedTeamExercise(completed)).toBe(true); expect((await syncState(h)).teamEntries).toHaveLength(3);
    const next = teamDraft(); expect(await scope.sync.saveActiveTeamExerciseDraft(next)).toBe(true); expect(await scope.sync.discardActiveTeamExerciseDraft(next.id)).toBe(true);
    expect(scope.sync.getSnapshot().activeTeamExerciseDraft).toBeNull();
  });

  it("runs eligibility, permission, owned reads, notes, correction and void on actual native services", async () => {
    const { h, scope } = await appReady(), completed = completedTeam(), { calls, bundle } = await ownTeamTransport(h, completed);
    vi.stubGlobal("navigator", { onLine: true });
    const workspace = { team: { id: teamId, name: "Synthetic Team", status: "active" }, roster: [{ profileId, displayName: "Synthetic self", participationAsPlayer: true, functions: ["player"] }, { profileId: otherId, displayName: "Synthetic other", participationAsPlayer: true, functions: [] }] } as unknown as TeamWorkspace;
    const refresh = scope.sync.refreshTeamExerciseEligibility(workspace); workspace.team.name = "Late alias";
    expect(await refresh).toBe(true); expect(scope.sync.getSnapshot().teamEligibilitySnapshots[0].teamName).toBe("Synthetic Team");
    expect(await scope.sync.setMyTeamExerciseRecordingPermission(teamId, true)).toBe("updated");
    expect(await scope.sync.refreshMyTeamExerciseResults()).toBe(true);
    const owned = scope.sync.getSnapshot().teamExerciseResults[0]; expect(owned.athleteProfileId).toBe(profileId);
    expect(await scope.sync.setMyTeamExercisePrivateNote(bundle.resultIds[0], "Synthetic note")).toBe("updated");
    const replacement = structuredClone(owned.result), attempt = replacement.attempts[0]; if (attempt.kind !== "shotmaking") throw null;
    attempt.evaluation = { status: "scored", score: 3 };
    const revision = crypto.randomUUID();
    expect(await scope.sync.reviseMyTeamExerciseResult(bundle.resultIds[0], replacement, revision, "Correct observed outcome")).toBe("updated");
    expect(await scope.sync.voidMyTeamExerciseResult(bundle.resultIds[0], crypto.randomUUID(), "Void mistaken recorded result")).toBe("updated");
    expect(calls.filter(call => call.body).map(call => call.name)).toEqual(["set_my_team_exercise_recording_permission", "set_my_team_exercise_private_note", "revise_my_team_exercise_result", "void_my_team_exercise_result"]);
  });

  it("skips a queued manager action after genuine foreground revokes its original admission", async () => {
    const { h, runtime, scope } = await appReady(); onlineTransport(h); vi.stubGlobal("navigator", { onLine: true });
    const previous = h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve()); let permissionIssued = false;
    h.fetch.mockImplementation(async (...args) => { const url = (args[0] as Request).url; if (url.endsWith("get_my_sporting_records")) { entered.resolve(); await release.promise; } if (url.endsWith("set_my_team_exercise_recording_permission")) permissionIssued = true; return previous(...args); });
    const running = scope.sync.synchronize(); await entered.promise; const queued = scope.sync.setMyTeamExerciseRecordingPermission(teamId, true), newer = runtime.coordinator.requestEmailOtp(user.email);
    release.resolve(); await running; expect(await queued).toBe("failed"); await newer; expect(permissionIssued).toBe(false); expect(scope.sync.getSnapshot().ready).toBe(false);
  });

  it("seals the scope after actual Self denial during a running manager lane", async () => {
    const { h, runtime, scope } = await appReady(); vi.stubGlobal("navigator", { onLine: true });
    const previous = h.fetch.getMockImplementation()!; h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.endsWith("get_my_gate_state") ? response({ ...facts(true), profile_id: otherId }) : previous(...args));
    await scope.sync.synchronize(); expect(runtime.createSportingApplicationScope(profileId)).toBeNull(); expect(scope.sync.getSnapshot().ready).toBe(false);
    expect(await scope.sync.saveActiveTeamExerciseDraft(teamDraft())).toBe(false);
  });
});

describe("native application independent operation and callback ownership", () => {
  it("stops later listener delivery immediately when the first listener closes the host", async () => {
    const { b, scope } = await appReady(); let later = 0;
    scope.sync.subscribe(() => b.host.dispose() as never); scope.sync.subscribe(() => { later++; });
    await scope.sync.retry(); await b.host.dispose(); expect(later).toBe(0);
  });
  it("owns the exact disposal returned by an input descriptor without self-drain", async () => {
    const { b, scope } = await appReady(); let later = 0;
    const input = new Proxy(terminalSession(), { getOwnPropertyDescriptor(target, key) { if (key === "id") return { value: b.host.dispose(), configurable: true, enumerable: true }; if (key === "title") later++; return Reflect.getOwnPropertyDescriptor(target, key); } });
    expect(await scope.repositories.session.saveCurrent(input)).toMatchObject({ ok: false }); await b.host.dispose(); expect(later).toBe(0);
  });
  it("does not poison an active SDK command or an independent local write with malformed manager input", async () => {
    const { h, runtime, scope } = await appReady(), entered = deferred<void>(), release = deferred<void>(), hold = deferred<void>(); releases.push(() => release.resolve(), () => hold.resolve());
    const previous = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.endsWith("get_my_gate_state")) { entered.resolve(); await release.promise; } return previous(...args); });
    const command = runtime.coordinator.revalidateGateFacts(); await entered.promise;
    Object.defineProperty(hold.promise, "then", { value: null }); let refused = false;
    const malformed = scope.sync.setMyTeamExerciseRecordingPermission(hold.promise as never, true).then(result => { refused = true; return result; });
    await tick(); expect(refused).toBe(false); expect(await scope.repositories.session.saveCurrent(createNewSession())).toEqual({ ok: true });
    release.resolve(); expect((await command).kind).toBe("resolved"); hold.resolve(); expect(await malformed).toBe("failed");
  });
  it("preserves a real failed Current write after confirmed history", async () => {
    const { h, scope } = await appReady(), currentKey = profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY);
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === currentKey) throw null; return next(); };
    expect(await scope.repositories.session.archiveAndReplace([terminalSession()], createNewSession())).toMatchObject({ ok: false, step: "current" });
    expect(await rawValue(h, profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY))).not.toBeNull(); expect(await rawValue(h, currentKey)).toBeNull();
  });
});
