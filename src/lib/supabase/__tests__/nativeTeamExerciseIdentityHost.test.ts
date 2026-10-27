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
const teamId = "77777777-7777-4777-8777-777777777777", sessionId = "88888888-8888-4888-8888-888888888888";
const resultId = "99999999-9999-4999-8999-999999999999", revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sessionUpload = { sessionId, teamId, schemaVersion: 2, coordinationPayload: "synthetic opaque bytes \u0000\ud800", startedAt: actedAt, completedAt: actedAt, participantProfileIds: [profileId], trainingAthleteProfileIds: [profileId], executionIds: [resultId] };
const bundleUpload = { bundleId: resultId, sessionId, athleteProfileId: profileId, schemaVersion: 2, resultPayload: "synthetic result bytes", recordedAt: actedAt, resultIds: [resultId], executionIds: [resultId] };
const revision = { revisionId, resultId, baseRevisionNumber: 0, reason: "synthetic reason" };
const correction = { ...revision, schemaVersion: 1, resultPayload: "synthetic corrected bytes", changedFields: ["evaluation" as const] };
const hash = "a".repeat(64);
type WireCall = { request: Request; url: URL; body: Record<string, unknown> | null };
function teamTransport(h: Fixture) {
  const original = h.fetch.getMockImplementation()!, calls: WireCall[] = [];
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, url = new URL(request.url), name = url.pathname.split("/").pop()!;
    if (!name.includes("team_exercise")) return original(...args);
    const text = await request.text(); calls.push({ request, url, body: text ? JSON.parse(text) : null });
    expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("error");
    expect(request.headers.get("Authorization")).toBe("Bearer SYNTHETIC_HOST_ACCESS");
    expect(request.headers.get("apikey")).toBe("sb_publishable_SYNTHETIC_HOST_ONLY");
    expect([...request.headers].length).toBe(request.method === "GET" ? 3 : 4);
    expect(request.headers.get(request.method === "GET" ? "Accept-Profile" : "Content-Profile")).toBe("public");
    if (request.method === "GET") { expect(text).toBe(""); return response([]); }
    if (name === "put_team_exercise_session") return response({ outcome: "inserted", content_sha256: hash, recorded_by_profile_id: profileId });
    if (name === "put_team_exercise_result_bundle") return response({ outcome: "inserted", content_sha256: hash, block_reason: null });
    if (name === "set_my_team_exercise_recording_permission") return response({ outcome: "granted", changed_at: actedAt });
    if (name === "approve_my_team_exercise_session") return response({ outcome: "approved", changed_at: actedAt });
    if (name === "set_my_team_exercise_private_note") return response({ outcome: "updated", updated_at: actedAt });
    return response({ outcome: "inserted", revision_id: revisionId, revision_number: 1, changed_at: actedAt });
  });
  return calls;
}
async function ready() { const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); return { h, b, runtime }; }
async function tick() { await new Promise(resolve => setTimeout(resolve, 20)); }

describe("dormant native Team-exercise Identity host", () => {
  it("does not grant Team data from a Profile selector before actual admission", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); server(h);
    expect(runtime.createTeamExerciseCloudService(profileId)).toBe(null);
    expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
    expect(runtime.createTeamExerciseCloudService(profileId)).toBe(null);
  });
  it("runs all nine actual mapper methods with exact original bytes and public SDK wire shape", async () => {
    const { h, runtime } = await ready(), calls = teamTransport(h), service = runtime.createTeamExerciseCloudService(profileId)!;
    expect(Object.isFrozen(service)).toBe(true); expect(Object.keys(service)).toHaveLength(9);
    expect(await service.listMyResults()).toEqual({ ok: true, value: [] });
    expect(await service.listActiveRecordingPermissions(teamId)).toEqual({ ok: true, value: [] });
    expect(await service.putSession(sessionUpload)).toEqual({ ok: true, value: { outcome: "inserted", contentSha256: hash, recordedByProfileId: profileId } });
    expect(await service.putAthleteBundle(bundleUpload)).toEqual({ ok: true, value: { outcome: "inserted", contentSha256: hash, blockReason: null } });
    expect(await service.setRecordingPermission(teamId, true)).toMatchObject({ ok: true, value: { outcome: "granted" } });
    expect(await service.approveSession(sessionId)).toMatchObject({ ok: true, value: { outcome: "approved" } });
    expect(await service.setPrivateNote(resultId, " original note \u0000 ")).toMatchObject({ ok: true, value: { outcome: "updated" } });
    expect(await service.reviseMyResult(correction)).toMatchObject({ ok: true, value: { revisionId, revisionNumber: 1 } });
    expect(await service.voidMyResult(revision)).toMatchObject({ ok: true, value: { revisionId, revisionNumber: 1 } });
    expect(calls).toHaveLength(15);
    expect(calls.slice(0, 7).map(call => call.url.pathname.split("/").pop())).toEqual(["team_exercise_result_bundles", "team_exercise_sessions", "team_exercise_session_participants", "team_exercise_execution_refs", "team_exercise_result_refs", "team_exercise_private_notes", "team_exercise_result_revisions"]);
    expect([...calls[7].url.searchParams]).toEqual([["select", "athlete_profile_id,granted_at"], ["team_id", `eq.${teamId}`], ["revoked_at", "is.null"]]);
    expect(calls[8].body).toEqual({ p_session_id: sessionId, p_team_id: teamId, p_schema_version: 2, p_coordination_payload: sessionUpload.coordinationPayload, p_started_at: actedAt, p_completed_at: actedAt, p_participant_profile_ids: [profileId], p_training_athlete_profile_ids: [profileId], p_execution_ids: [resultId] });
    expect(calls[9].body).toEqual({ p_bundle_id: resultId, p_session_id: sessionId, p_athlete_profile_id: profileId, p_schema_version: 2, p_result_payload: bundleUpload.resultPayload, p_recorded_at: actedAt, p_result_ids: [resultId], p_execution_ids: [resultId] });
    expect(calls[10].body).toEqual({ p_team_id: teamId, p_granted: true });
    expect(calls[11].body).toEqual({ p_session_id: sessionId });
    expect(calls[12].body).toEqual({ p_result_id: resultId, p_note: " original note \u0000 " });
    expect(calls[13].body).toEqual({ p_revision_id: revisionId, p_result_id: resultId, p_base_revision_number: 0, p_schema_version: 1, p_result_payload: correction.resultPayload, p_reason: revision.reason, p_changed_fields: ["evaluation"] });
    expect(calls[14].body).toEqual({ p_revision_id: revisionId, p_result_id: resultId, p_base_revision_number: 0, p_reason: revision.reason });
  });
  it("issues seven genuine overlapping GETs without holding one response ahead of siblings", async () => {
    const { h, runtime } = await ready(), previous = h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    let count = 0;
    h.fetch.mockImplementation(async (...args) => { const request = args[0] as Request; if (!request.url.includes("/team_exercise_")) return previous(...args); if (++count === 7) entered.resolve(); await release.promise; return response([]); });
    const pending = runtime.createTeamExerciseCloudService(profileId)!.listMyResults();
    await entered.promise; expect(count).toBe(7); release.resolve(); expect(await pending).toEqual({ ok: true, value: [] });
  });
  it.each([503, 520, "network"])("never retries a native GET after %s", async kind => {
    const { h, runtime } = await ready(), previous = h.fetch.getMockImplementation()!;
    let count = 0;
    h.fetch.mockImplementation(async (...args) => { if (!(args[0] as Request).url.includes("/team_exercise_")) return previous(...args); count++; if (kind === "network") throw null; return response({ message: "synthetic unavailable" }, kind as number); });
    expect((await runtime.createTeamExerciseCloudService(profileId)!.listMyResults()).ok).toBe(false);
    expect(count).toBe(7); await tick(); expect(count).toBe(7);
  });
  it("keeps the genuine SDK command and disposal pending after an aggregate rejects with an issued sibling outstanding", async () => {
    const { h, b, runtime } = await ready(), previous = h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    const { PostgrestBuilder } = await import("@supabase/postgrest-js"), original = PostgrestBuilder.prototype.then;
    let turns = 0, count = 0;
    PostgrestBuilder.prototype.then = function (...args) { if (++turns === 3) throw null; return Reflect.apply(original, this, args); };
    h.fetch.mockImplementation(async (...args) => { if (!(args[0] as Request).url.includes("/team_exercise_")) return previous(...args); if (++count === 6) entered.resolve(); await release.promise; return response([]); });
    try {
      let done = false, disposed = false;
      const pending = runtime.createTeamExerciseCloudService(profileId)!.listMyResults().then(value => { done = true; return value; });
      await entered.promise; const close = b.host.dispose().then(() => { disposed = true; }); await tick();
      expect(done).toBe(false); expect(disposed).toBe(false); release.resolve();
      expect(await pending).toEqual({ ok: false, error: "unavailable" }); await close; expect(disposed).toBe(true);
    } finally { PostgrestBuilder.prototype.then = original; }
  });
  it("does not revive an old Team facade after same-Profile reauthentication", async () => {
    const { h, runtime } = await ready(), calls = teamTransport(h), old = runtime.createTeamExerciseCloudService(profileId)!;
    expect((await runtime.coordinator.signOut()).kind).toBe("signed_out_locked");
    expect((await runtime.coordinator.requestEmailOtp(user.email)).kind).toBe("otp_requested");
    expect(await runtime.coordinator.verifyEmailOtp(user.email, "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
    expect(await old.putSession(sessionUpload)).toEqual({ ok: false, error: "unavailable" }); expect(calls).toEqual([]);
    expect(await runtime.createTeamExerciseCloudService(profileId)!.listMyResults()).toEqual({ ok: true, value: [] });
  });
  it("retains admission across a genuine healthy background confirmation", async () => {
    const { h, runtime } = await ready(), service = runtime.createTeamExerciseCloudService(profileId)!; teamTransport(h);
    expect((await runtime.coordinator.revalidateGateFacts()).kind).toBe("resolved"); expect(await service.listMyResults()).toEqual({ ok: true, value: [] });
  });
  it.each(["profile", "completion", "incomplete"])("uses actual %s Self denial and reports the real full completion", async kind => {
    const { h, runtime } = await ready(), service = runtime.createTeamExerciseCloudService(profileId)!, outcomes: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
    h.fetch.mockResolvedValue(response(kind === "incomplete" ? facts(false) : { ...facts(true), ...(kind === "profile" ? { profile_id: sessionId } : { onboarding_completed_at: "2026-01-02T00:00:00Z" }) }));
    expect(await service.putSession(sessionUpload)).toEqual({ ok: false, error: "unavailable" });
    expect(outcomes).toHaveLength(1); expect(outcomes[0]).toMatchObject({ kind: "identity_invalidated", outstanding: [] });
    expect(runtime.createTeamExerciseCloudService(profileId)).toBe(null);
  });
  it.each(["forbidden", "not_found", "invalid_input"])("preserves ordinary Team %s without denying Identity", async kind => {
    const { h, runtime } = await ready(), service = runtime.createTeamExerciseCloudService(profileId)!, previous = h.fetch.getMockImplementation()!, outcomes: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
    h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.includes("/put_team_exercise_session") ? response({ message: `${kind}: synthetic` }, 400) : previous(...args));
    expect(await service.putSession(sessionUpload)).toEqual({ ok: false, error: kind }); expect(outcomes).toEqual([]); expect(runtime.createTeamExerciseCloudService(profileId)).not.toBe(null);
  });
  it("does not retry an uncertain mutation", async () => {
    const { h, runtime } = await ready(), previous = h.fetch.getMockImplementation()!; let count = 0;
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.includes("/put_team_exercise_session")) { count++; throw null; } return previous(...args); });
    expect((await runtime.createTeamExerciseCloudService(profileId)!.putSession(sessionUpload)).ok).toBe(false); expect(count).toBe(1);
  });
});

describe("native Team-exercise ownership boundaries", () => {
  it("captures arrays synchronously before queue wait, without caller iterators or array methods", async () => {
    const { h, runtime } = await ready(), calls = teamTransport(h), service = runtime.createTeamExerciseCloudService(profileId)!, previous = h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    let first = true;
    h.fetch.mockImplementation(async (...args) => { if (first && (args[0] as Request).url.endsWith("/get_my_gate_state")) { first = false; entered.resolve(); await release.promise; } return previous(...args); });
    const holding = service.listMyResults(); await entered.promise;
    const ids = [profileId]; Object.defineProperty(ids, Symbol.iterator, { value() { throw new Error("Caller iterator must remain inert"); } });
    Object.defineProperty(ids, "map", { value() { throw null; } });
    const record = { ...sessionUpload, participantProfileIds: ids }, pending = service.putSession(record);
    ids[0] = sessionId; record.coordinationPayload = "changed"; release.resolve(); await holding;
    expect((await pending).ok).toBe(true); expect(calls.at(-1)!.body).toMatchObject({ p_participant_profile_ids: [profileId], p_coordination_payload: sessionUpload.coordinationPayload });
  });
  it.each(["hole", "wrong-element", "rejected-element", "masked-element", "root-promise"])("contains %s input without a session read or subsequent getter", async kind => {
    const { h, runtime } = await ready(), service = runtime.createTeamExerciseCloudService(profileId)!, hold = deferred<void>(); releases.push(() => hold.resolve());
    let later = 0; const ids: unknown[] = kind === "hole" ? new Array(1) : [kind === "wrong-element" ? {} : kind === "rejected-element" ? Promise.reject(null) : hold.promise];
    if (kind === "masked-element") Object.defineProperty(hold.promise, "then", { value: null });
    const input = kind === "root-promise" ? Object.assign(hold.promise, sessionUpload) : { ...sessionUpload, participantProfileIds: ids, get trainingAthleteProfileIds() { later++; return [profileId]; } };
    h.fetch.mockClear(); const pending = service.putSession(input as never); let done = false; void pending.then(() => { done = true; });
    if (kind === "masked-element" || kind === "root-promise") { await tick(); expect(done).toBe(false); }
    hold.resolve(); expect(await pending).toEqual({ ok: false, error: "invalid_input" }); expect(later).toBe(0); expect(h.fetch).not.toHaveBeenCalled();
  });
  it.each(["close", "supersede"])("stops array element capture at %s, but retains the returned masked work", async stop => {
    const { b, runtime } = await ready(), service = runtime.createTeamExerciseCloudService(profileId)!, hold = deferred<void>(); releases.push(() => hold.resolve());
    Object.defineProperty(hold.promise, "then", { value: null }); let later = 0, newer: Promise<unknown> | null = null;
    const ids = [profileId, profileId]; Object.defineProperty(ids, "0", { get() { newer = stop === "close" ? b.host.dispose() : runtime.coordinator.requestEmailOtp(user.email); return hold.promise; } });
    Object.defineProperty(ids, "1", { get() { later++; return profileId; } });
    const pending = service.putSession({ ...sessionUpload, participantProfileIds: ids }); let done = false; void pending.then(() => { done = true; }); await tick(); expect(done).toBe(false); expect(later).toBe(0);
    hold.resolve(); expect(await pending).toEqual({ ok: false, error: "unavailable" }); await newer;
  });
  it("recognizes exact own disposal returned by an input getter without a drain cycle", async () => {
    const { b, runtime } = await ready(), service = runtime.createTeamExerciseCloudService(profileId)!; let later = 0;
    expect(await service.putSession({ get sessionId() { return b.host.dispose(); }, get teamId() { later++; return teamId; } } as never)).toEqual({ ok: false, error: "unavailable" });
    expect(later).toBe(0); expect(await b.host.dispose()).toEqual({ ok: true });
  });
  it("does not poison an unrelated active command from malformed queued Team input", async () => {
    const { h, runtime } = await ready(), service = runtime.createTeamExerciseCloudService(profileId)!, calls = teamTransport(h), previous = h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    let held = false;
    h.fetch.mockImplementation(async (...args) => { if (!held && (args[0] as Request).url.includes("/team_exercise_result_bundles")) { held = true; entered.resolve(); await release.promise; } return previous(...args); });
    const active = service.listMyResults(); await entered.promise;
    expect(await service.putSession({ sessionId: Promise.reject(null) } as never)).toEqual({ ok: false, error: "invalid_input" });
    release.resolve(); expect(await active).toEqual({ ok: true, value: [] }); expect(calls).toHaveLength(7);
  });
  for (const mutation of ["relation", "duplicate-query", "filter", "schema", "range", "body", "supersede", "close"] as const) it(`vetoes final materialized GET ${mutation}`, async () => {
    const h = await fixture(), OriginalRequest = Request; let armed = false, newer: Promise<unknown> | null = null, runtime: Awaited<ReturnType<Awaited<ReturnType<typeof bootstrap>>["start"]>> | null = null;
    let host: NativeIdentityBootstrapHost | null = null;
    vi.stubGlobal("Request", class extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        if (armed && input instanceof OriginalRequest && input.url.includes("/team_exercise_recording_permissions?")) {
          const url = new URL(input.url), headers = new Headers(init?.headers ?? input.headers);
          if (mutation === "relation") url.pathname = url.pathname.replace("team_exercise_recording_permissions", "team_exercise_private_notes");
          if (mutation === "duplicate-query") url.searchParams.append("team_id", `eq.${teamId}`);
          if (mutation === "filter") url.searchParams.set("team_id", `eq.${profileId}`);
          if (mutation === "schema") headers.set("Accept-Profile", "private");
          if (mutation === "range") headers.set("Range", "0-100");
          if (mutation === "body") super(url, { ...init, method: "POST", body: "{}", headers });
          else super(url, { ...init, method: "GET", headers });
          armed = false;
          if (mutation === "supersede") newer = runtime!.coordinator.requestEmailOtp(user.email);
          if (mutation === "close") newer = host!.dispose();
        } else super(input, init);
      }
    });
    const b = await bootstrap(h); host = b.host; runtime = await b.start(); await onboard(h, runtime); const calls = teamTransport(h), service = runtime.createTeamExerciseCloudService(profileId)!; armed = true;
    expect(await service.listActiveRecordingPermissions(teamId)).toEqual({ ok: false, error: "unavailable" }); expect(calls).toEqual([]); await newer;
  });
  it("rejects duplicate consumption of a genuine SDK intent", async () => {
    const { h, runtime } = await ready(), calls = teamTransport(h), { PostgrestClient } = await import("@supabase/postgrest-js"), original = PostgrestClient.prototype.from;
    let firstBuilder: ReturnType<typeof original> | null = null;
    PostgrestClient.prototype.from = function (...args: Parameters<typeof original>) { const builder = Reflect.apply(original, this, args); if (args[0] === "team_exercise_result_bundles") firstBuilder = builder; return args[0] === "team_exercise_sessions" ? firstBuilder! : builder; };
    try {
      expect((await runtime.createTeamExerciseCloudService(profileId)!.listMyResults()).ok).toBe(false);
      expect(calls.filter(call => call.url.pathname.endsWith("team_exercise_result_bundles"))).toHaveLength(1); expect(calls).toHaveLength(6);
    } finally { PostgrestClient.prototype.from = original; }
  });
  it("drains a genuine response body through close before releasing storage", async () => {
    const { h, b, runtime } = await ready(), previous = h.fetch.getMockImplementation()!, entered = deferred<void>(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } }); releases.push(() => { try { controller.close(); } catch {} });
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.includes("/team_exercise_recording_permissions?")) { entered.resolve(); return new Response(stream, { headers: { "Content-Type": "application/json" } }); } return previous(...args); });
    const pending = runtime.createTeamExerciseCloudService(profileId)!.listActiveRecordingPermissions(teamId); await entered.promise;
    let done = false; const close = b.host.dispose().then(() => { done = true; }); await tick(); expect(done).toBe(false);
    controller.enqueue(new TextEncoder().encode("[]")); controller.close(); expect(await pending).toEqual({ ok: false, error: "unavailable" }); await close;
  });
  it("uses only one actual SDK session read for seven result GETs", async () => {
    const { h, runtime } = await ready(), { AuthClient } = await import("@supabase/supabase-js"), sessionRead = vi.spyOn(AuthClient.prototype, "getSession"); teamTransport(h);
    expect((await runtime.createTeamExerciseCloudService(profileId)!.listMyResults()).ok).toBe(true); expect(sessionRead).toHaveBeenCalledTimes(1);
  });
});

describe("native Team-exercise late ownership and real manager", () => {
  it("seals a retired original fetch closure before a later identical native method", async () => {
    const captured: (typeof fetch)[] = [];
    vi.doMock("@supabase/postgrest-js", async () => {
      const actual = await vi.importActual<typeof import("@supabase/postgrest-js")>("@supabase/postgrest-js");
      return { ...actual, PostgrestClient: class extends actual.PostgrestClient {
        constructor(...args: ConstructorParameters<typeof actual.PostgrestClient>) {
          super(...args); if (args[1]?.retry === false && args[1].fetch) captured.push(args[1].fetch as typeof fetch);
        }
      } };
    });
    try {
      const { h, runtime } = await ready(), calls = teamTransport(h), service = runtime.createTeamExerciseCloudService(profileId)!;
      expect(await service.listActiveRecordingPermissions(teamId)).toEqual({ ok: true, value: [] });
      const old = captured[0], oldCall = calls[0];
      await runtime.coordinator.signOut(); await runtime.coordinator.requestEmailOtp(user.email); await runtime.coordinator.verifyEmailOtp(user.email, "123456");
      expect(await runtime.createTeamExerciseCloudService(profileId)!.listActiveRecordingPermissions(teamId)).toEqual({ ok: true, value: [] });
      const length = calls.length;
      await expect(old(oldCall.url.href, { method: "GET", headers: { "Accept-Profile": "public" } })).rejects.toBeDefined();
      expect(calls).toHaveLength(length); expect(captured).toHaveLength(2);
    } finally { vi.doUnmock("@supabase/postgrest-js"); }
  });
  it("keeps the old real SyncManager's pending Team outbox across same-Profile reauthentication", async () => {
    const { h, runtime } = await ready(), calls = teamTransport(h), team = runtime.createTeamExerciseCloudService(profileId)!, personal = runtime.createSportingCloudService(profileId)!;
    const { createProfileScopedSportingRepositories, createProfileScopedSportingStorageAdapter } = await import("../../persistence/profileScopedSportingPersistence");
    const { createSportingSyncStateRepository } = await import("../../cloudSporting/syncStateRepository"), { SportingCloudSyncManager } = await import("../../cloudSporting/syncManager");
    const { createTeamExerciseExecution, addTeamShotmakingAttempt, completeTeamExerciseExecution } = await import("../../exercises/teamExecution");
    const { EXERCISE_CATALOG } = await import("../../exercises/catalog"), { EIGHT_GUARDS_VERSION_ID } = await import("../../exercises/content"), { findExerciseVersion } = await import("../../exercises/lookup");
    const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID)!, clock = { id: syntheticUuid, now: () => actedAt };
    const execution = createTeamExerciseExecution(version, { trainingSessionId: sessionId, teamId, recorderProfileId: profileId,
      participantRoster: [{ profileId: resultId, participation: "training-athlete" }, { profileId, participation: "supporting" }],
      initialRoleAssignment: { deliveringAthleteProfileId: resultId, sweeperProfileIds: [], observerProfileId: profileId, sweepingUsed: false }, rotation: { kind: "manual", athleteOrder: [resultId] }, clock });
    if (!execution.ok) throw new Error(execution.error.message);
    const attempted = addTeamShotmakingAttempt(execution.value, { recorderProfileId: profileId, athleteProfileId: resultId, actualHandle: "out", evaluation: { status: "scored", score: 4 }, clock });
    if (!attempted.ok) throw new Error(attempted.error.message);
    const completed = completeTeamExerciseExecution(attempted.value, profileId, actedAt); if (!completed.ok) throw new Error(completed.error.message);
    // Separate injected local storage tests the genuine manager facade; it
    // expressly does not establish native app repository composition.
    const values = new Map<string, string>(), adapter = { get: async (key: string) => ({ status: "value" as const, value: values.get(key) ?? null }), set: async (key: string, value: string) => { values.set(key, value); return { ok: true as const }; } };
    const repositories = createProfileScopedSportingRepositories(profileId, adapter), sync = createSportingSyncStateRepository(createProfileScopedSportingStorageAdapter(profileId, adapter)); let online = false;
    const manager = new SportingCloudSyncManager(repositories, sync, personal, () => online, team, profileId);
    await manager.initialize(); expect(await manager.enqueueCompletedTeamExercise(completed.value, profileId)).toBe(true); expect(manager.getSnapshot().pendingCount).toBe(2);
    await runtime.coordinator.signOut(); await runtime.coordinator.requestEmailOtp(user.email); expect(await runtime.coordinator.verifyEmailOtp(user.email, "123456")).toMatchObject({ gate: { kind: "ready_online" } });
    online = true; await manager.synchronize(); expect(calls).toEqual([]); expect(manager.getSnapshot().pendingCount).toBe(2);
    const loaded = await sync.load(); expect(loaded.status === "value" && loaded.value.teamEntries.every(entry => entry.status === "pending")).toBe(true);
  });
});

describe("native Team-exercise directly observed acknowledgement work", () => {
  it.each(["masked", "rejected", "own-disposal"])("retains actual %s response-header ACK through cleanup", async kind => {
    const h = await fixture(), original = Headers.prototype.forEach, hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    let target: Headers | null = null, close: Promise<unknown> | null = null, host: NativeIdentityBootstrapHost | null = null;
    Object.defineProperty(hold.promise, "then", { value: null });
    Headers.prototype.forEach = function (...args) {
      Reflect.apply(original, this, args);
      if (this === target) { target = null; entered.resolve(); return (kind === "own-disposal" ? (close = host!.dispose()) : kind === "rejected" ? Promise.reject(null) : hold.promise) as never; }
    };
    try {
      const b = await bootstrap(h); host = b.host; const runtime = await b.start(); await onboard(h, runtime); const previous = h.fetch.getMockImplementation()!;
      h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.includes("/team_exercise_recording_permissions?")) { const value = response([]); target = value.headers; return value; } return previous(...args); });
      const pending = runtime.createTeamExerciseCloudService(profileId)!.listActiveRecordingPermissions(teamId); await entered.promise;
      if (kind === "masked") {
        let done = false; close = b.host.dispose().then(value => { done = true; return value; }); await tick(); expect(done).toBe(false); hold.resolve();
      }
      expect(await pending).toEqual({ ok: false, error: "unavailable" }); await (close ?? b.host.dispose());
    } finally { Headers.prototype.forEach = original; }
  });
  it("reports full real failed denial residue after native Team Self rejection", async () => {
    const { h, runtime } = await ready(), { IDENTITY_BARRIER_STORAGE_KEY } = await import("../../identity/identityBarrier"), outcomes: unknown[] = [];
    const service = runtime.createTeamExerciseCloudService(profileId)!; runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
    h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) throw null; return next(); };
    h.fetch.mockResolvedValue(response(facts(false)));
    expect(await service.listMyResults()).toEqual({ ok: false, error: "unavailable" });
    expect(outcomes).toEqual([expect.objectContaining({ kind: "durable_denial_unavailable", outstanding: expect.arrayContaining(["durable_barrier", "trusted_state"]) })]);
  });
});


describe("native Team array membership", () => {
  it("rejects an array hole even when a prototype supplies a canonical ID", async () => {
    const { h, runtime } = await ready(), calls = teamTransport(h), ids = new Array<string>(1);
    Object.setPrototypeOf(ids, { 0: profileId });
    expect(await runtime.createTeamExerciseCloudService(profileId)!.putSession({ ...sessionUpload, participantProfileIds: ids })).toEqual({ ok: false, error: "invalid_input" });
    expect(calls).toEqual([]);
  });
  it("stops before the indexed getter when the own-membership trap revokes admission", async () => {
    const { b, runtime } = await ready(); let reads = 0, close: Promise<unknown> | null = null;
    const ids = new Proxy([profileId], {
      getOwnPropertyDescriptor(target, key) { if (key === "0") close = b.host.dispose(); return Reflect.getOwnPropertyDescriptor(target, key); },
      get(target, key) { if (key === "0") reads++; return Reflect.get(target, key); },
    });
    expect(await runtime.createTeamExerciseCloudService(profileId)!.putSession({ ...sessionUpload, participantProfileIds: ids })).toEqual({ ok: false, error: "unavailable" });
    expect(reads).toBe(0); await close;
  });
});
