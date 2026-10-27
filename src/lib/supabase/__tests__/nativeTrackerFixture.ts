// Actual installed public AuthClient + disposable real SQLite. All values and
// transports are synthetic/injected; no platform Keychain or real account.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, vi } from "vitest";
import type { IdentityRuntimeReady } from "../../identity/identityRuntime";
import type { NativeSupabaseAuthHost, NativeSupabaseAuthHostOptions, NativeIdentityBootstrapHost, NativeSportingIdentityHostOptions } from "../supabaseAuthService";
import { combinedFixture, disposeCombinedFixtures } from "../../persistence/__tests__/nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "../../persistence/__tests__/nativeMigrationMTestKit";
import { fp, isSyntheticFingerprint } from "../../persistence/__tests__/nativeMigrationTestKit";
import { parseCredentialPhysicalSlot } from "../../persistence/credentialPhysicalSlots";
const hosts: (NativeSupabaseAuthHost | NativeIdentityBootstrapHost)[] = [];
export const releases: (() => void)[] = [];
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
export function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } }); }
export function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
type Event = { kind: string; key?: string; value?: string };
export async function fixture(initial: "empty" | "valid" | "expired" | "proactive" | "missing_user" = "empty", platform: "ios" | "android" = "ios") {
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

export const profileId = "22222222-2222-4222-8222-222222222222";
const termsId = "33333333-3333-4333-8333-333333333333", privacyId = "44444444-4444-4444-8444-444444444444";
const actedAt = "2026-01-01T00:00:00Z";
const legalRows = [
  { id: termsId, kind: "terms_of_service", version_label: "Synthetic Terms", document_url: "https://legal.example.invalid/terms", effective_at: actedAt },
  { id: privacyId, kind: "privacy_notice", version_label: "Synthetic Privacy", document_url: "https://legal.example.invalid/privacy", effective_at: actedAt },
];
export function facts(completed: boolean) {
  return { profile_id: profileId, display_name: completed ? "Synthetic Athlete" : null, onboarding_completed_at: completed ? actedAt : null,
    has_athlete_capability: completed, free_entitlement_active: completed,
    pinned_terms_acceptance_id: completed ? "55555555-5555-4555-8555-555555555555" : null,
    pinned_terms_document_id: completed ? termsId : null, pinned_terms_version_label: completed ? "Synthetic Terms" : null, pinned_terms_accepted_at: completed ? actedAt : null,
    pinned_privacy_acknowledgement_id: completed ? "66666666-6666-4666-8666-666666666666" : null,
    pinned_privacy_document_id: completed ? privacyId : null, pinned_privacy_version_label: completed ? "Synthetic Privacy" : null, pinned_privacy_acknowledged_at: completed ? actedAt : null,
    current_terms_document_id: termsId, current_terms_version_label: "Synthetic Terms", current_privacy_document_id: privacyId, current_privacy_version_label: "Synthetic Privacy" };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
export async function bootstrap(h: Fixture, overrides: Partial<NativeSportingIdentityHostOptions> = {}, configuredBinding?: unknown) {
  let url: string | null = "https://app.example.invalid/";
  const callbackUrlAccess = { readCurrentUrl: vi.fn(() => url), replaceCurrentUrl: vi.fn((value: string) => { url = value; }) };
  const options = { ...h.options, callbackUrlAccess, ...overrides };
  const created = configuredBinding === undefined ? await h.module.createNativeSportingIdentityHost(options)
    : await h.module.createConfiguredNativeSportingIdentityHost(configuredBinding, options);
  expect(created.ok).toBe(true); if (!created.ok) throw new Error(created.reason);
  const host = created.host; hosts.push(host);
  return { host, callbackUrlAccess, setUrl(value: string | null) { url = value; }, async start() {
    const result = await host.start(); expect(result.outcome).toBe("ready");
    if (result.outcome !== "ready") throw new Error("Synthetic identity runtime unavailable");
    return result.runtime;
  } };
}
export function server(h: Fixture, initiallyCompleted = false) {
  let completed = initiallyCompleted;
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
    if (path.endsWith("/get_my_account_deletion_control")) return response({ profile_id: profileId, revision: 0, pending: null });
    return response(facts(completed));
  });
  return requests;
}
// Synthetic API edge only: actual native TeamService/sole mapper/Self checks run.
export function teamTransport(h: Fixture, inboxFailure = false) {
  const original = h.fetch.getMockImplementation()!;
  const calls: string[] = [];
  const teamId = "77777777-7777-4777-8777-777777777777";
  const team = { id: teamId, name: "Synthetic Team", status: "active", created_by_profile_id: profileId, created_at: actedAt, archived_at: null, restored_at: null };
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, name = new URL(request.url).pathname.split("/").pop()!;
    const values: Record<string, unknown> = {
      get_my_profile: { id: profileId, display_name: "Synthetic Athlete", created_at: actedAt, updated_at: actedAt },
      has_pilot_team_creation_capability: false,
      preview_invitation: { status: "ready_to_accept", team_name: team.name, inviter_display_name: "Synthetic Admin", participation_as_player: true, proposed_functions: ["coach"] },
      accept_invitation: teamId, teams: [team],
      team_memberships: [{ id: "88888888-8888-4888-8888-888888888888", profile_id: profileId, participation_as_player: true, status: "active", teams: team, team_membership_functions: [{ function: "coach", status: "active" }] }],
      profiles: [{ id: profileId, display_name: "Synthetic Athlete" }],
      team_invitations: [], team_admin_requests: [], account_notifications: [], list_admin_requests_for_team: [],
    };
    if (!(name in values)) return original(...args);
    calls.push(name);
    expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("error");
    expect(request.headers.get("Authorization")).toBe("Bearer SYNTHETIC_HOST_ACCESS");
    expect(request.headers.get(request.method === "GET" ? "Accept-Profile" : "Content-Profile")).toBe("public");
    if (inboxFailure && name === "team_admin_requests") return response({ message: "Synthetic inbox unavailable" }, 503);
    return response(values[name]);
  });
  return { calls, teamId };
}
export const deletionRequestId = "77777777-7777-4777-8777-777777777777";
export const deletionRow = { request_id: deletionRequestId, profile_id: profileId, requested_at: "2026-10-25T00:00:00Z", finalize_after: "2026-11-24T00:00:00Z" };
export function accountTransport(h: Fixture) {
  const original = h.fetch.getMockImplementation()!, calls: string[] = [];
  const state = { revision: 0, pending: null as typeof deletionRow | null, failure: null as string | null };
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, name = new URL(request.url).pathname.split("/").pop()!;
    if (state.pending && name === "get_my_gate_state") return response({ ...facts(false), profile_id: null, display_name: null });
    if (!name.includes("account_deletion") && name !== "get_my_account_export") return original(...args);
    expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("error");
    expect(request.headers.get("Authorization")).toBe("Bearer SYNTHETIC_HOST_ACCESS");
    expect(request.headers.get("Content-Profile")).toBe("public");
    calls.push(name);
    if (state.failure === name) return response({ message: "Synthetic unavailable" }, 503);
    if (name === "get_my_account_deletion_control") return response({ profile_id: profileId, revision: state.revision, pending: state.pending });
    if (name === "request_my_account_deletion") { state.pending = deletionRow; state.revision++; return response([deletionRow]); }
    if (name === "cancel_my_account_deletion") { state.pending = null; state.revision++; return response(true); }
    if (name === "abort_my_uncommitted_account_deletion") { state.revision++; return response(state.revision); }
    if (name === "get_my_account_export") {
      const inventories = ["legalEvidence", "sportingRecords", "sportingTombstones", "teamResultBundles", "teamResultRevisions", "privateNotes", "sharedSessionContext", "memberships", "membershipFunctions", "notifications", "entitlements", "deletionRequests", "recordingPermissions", "sessionParticipation", "sessionApprovals", "invitations", "adminRequests", "auditHistory", "athleteCapabilities", "teamCreationGrants"];
      return response({ schemaVersion: 1, profile: { id: profileId }, accountId: user.id, accountEmail: user.email, onboarding: {}, exportedAt: SYNTHETIC_NOW, ...Object.fromEntries(inventories.map(name => [name, []])) });
    }
    throw new Error("Unexpected synthetic Account operation");
  });
  return { calls, state };
}
export async function onboard(h: Fixture, runtime: IdentityRuntimeReady) {
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
export async function ready(loss = true) { const h = await fixture(); h.binding.failedWriteMayLosePreviousValue = loss; const b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); return { h, b, runtime }; }
