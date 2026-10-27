// Actual installed public AuthClient + disposable real SQLite. All values and
// transports are synthetic/injected; no platform Keychain or real account.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamService } from "../../team/teamService";
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
const teamId = "77777777-7777-4777-8777-777777777777", memberId = "88888888-8888-4888-8888-888888888888";
const otherProfile = "99999999-9999-4999-8999-999999999999", invitationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const teamRow = { id: teamId, name: "Synthetic Team", status: "active", created_by_profile_id: profileId, created_at: actedAt, archived_at: null, restored_at: null };
const myProfile = { id: profileId, display_name: "Synthetic Athlete", created_at: actedAt, updated_at: actedAt };
const invitation = { id: invitationId, teamId, email: "invite@example.invalid", participationAsPlayer: true, proposedFunctions: ["coach"], status: "pending", createdAt: actedAt, expiresAt: "2030-01-01T00:00:00Z", acceptedAt: null, revokedAt: null, replacedByInvitationId: null, emailDeliveryStatus: "sent" };
const proposal = { email: " invite@example.invalid ", participationAsPlayer: true, proposedFunctions: ["coach" as const, "team_admin" as const] };
const createInput = { name: " Exact synthetic name \u0000 ", participationAsPlayer: true, functions: ["coach" as const] };
type Call = { request: Request; url: URL; body: Record<string, unknown> | null };
function foundationTransport(h: Fixture, admin = false) {
  const previous = h.fetch.getMockImplementation()!, calls: Call[] = [];
  const rpcNames = new Set(["get_my_profile", "has_pilot_team_creation_capability", "create_team", "get_team_member_emails", "rename_team", "archive_team", "restore_team", "set_participation", "assign_direct_function", "remove_direct_function", "remove_admin_function", "relinquish_own_admin", "leave_team", "revoke_invitation", "preview_invitation", "accept_invitation", "list_admin_requests_for_team", "revoke_admin_request", "accept_admin_request", "acknowledge_notification"]);
  const relations = new Set(["teams", "team_memberships", "profiles", "team_invitations", "team_admin_requests", "account_notifications"]);
  h.fetch.mockImplementation(async (...args) => {
    const request = args[0] as Request, url = new URL(request.url), name = url.pathname.split("/").pop()!, api = url.origin === "https://native-api.example.invalid";
    if (!api && !rpcNames.has(name) && !relations.has(name)) return previous(...args);
    const text = await request.text(); calls.push({ request, url, body: text ? JSON.parse(text) : null });
    expect(request.credentials).toBe("omit"); expect(request.redirect).toBe("error"); expect(request.headers.get("Authorization")).toBe("Bearer SYNTHETIC_HOST_ACCESS");
    if (api) {
      expect([...request.headers].map(([name]) => name).sort()).toEqual(["authorization", "content-type"]);
      if (url.pathname.endsWith("members/remove")) return response({ notificationEmailSent: false });
      if (url.pathname.endsWith("admin-requests")) return response({ request: { id: invitationId }, emailSent: false });
      return response({ invitation, emailSent: false });
    }
    expect(request.headers.get("apikey")).toBe("sb_publishable_SYNTHETIC_HOST_ONLY");
    expect(request.headers.get(request.method === "GET" ? "Accept-Profile" : "Content-Profile")).toBe("public");
    if (name === "get_my_profile") return response(myProfile);
    if (name === "has_pilot_team_creation_capability") return response(true);
    if (name === "create_team") return response(teamRow);
    if (name === "get_team_member_emails") return response([{ membership_id: memberId, email: "admin@example.invalid" }]);
    if (name === "preview_invitation") return response({ status: "invalid_token" });
    if (name === "accept_invitation") return response(teamId);
    if (name === "teams") return response([teamRow]);
    if (name === "team_memberships") {
      const functions = [{ function: admin ? "team_admin" : "coach", status: "active" }];
      return response([{ id: memberId, profile_id: profileId, participation_as_player: true, status: "active", teams: teamRow, team_membership_functions: functions }, { id: invitationId, profile_id: otherProfile, participation_as_player: true, status: "active", teams: teamRow, team_membership_functions: [] }]);
    }
    if (name === "profiles") return response([{ id: profileId, display_name: "Synthetic Athlete" }, { id: otherProfile, display_name: "Synthetic Other" }]);
    return response(request.method === "GET" || name === "list_admin_requests_for_team" ? [] : null);
  });
  return calls;
}
async function ready() { const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); return { h, b, runtime }; }
async function tick() { await new Promise(resolve => setTimeout(resolve, 20)); }
const methods: [keyof TeamService, (service: TeamService) => Promise<unknown>][] = [
  ["getMyProfile", s => s.getMyProfile()], ["hasPilotTeamCreationCapability", s => s.hasPilotTeamCreationCapability()], ["listMyTeams", s => s.listMyTeams()], ["createTeam", s => s.createTeam(createInput)], ["getTeamWorkspace", s => s.getTeamWorkspace(teamId)], ["renameTeam", s => s.renameTeam(teamId, " Original name ")], ["archiveTeam", s => s.archiveTeam(teamId)], ["restoreTeam", s => s.restoreTeam(teamId)],
  ["setParticipation", s => s.setParticipation(teamId, memberId, true)], ["assignDirectFunction", s => s.assignDirectFunction(teamId, memberId, "coach")], ["removeDirectFunction", s => s.removeDirectFunction(teamId, memberId, "training_lead")], ["removeAdminFunction", s => s.removeAdminFunction(teamId, memberId)], ["relinquishOwnAdmin", s => s.relinquishOwnAdmin(teamId)], ["removeMember", s => s.removeMember(teamId, memberId)], ["leaveTeam", s => s.leaveTeam(teamId)],
  ["listInvitations", s => s.listInvitations(teamId)], ["createInvitation", s => s.createInvitation(teamId, proposal)], ["reviseInvitation", s => s.reviseInvitation(invitationId, proposal)], ["resendInvitation", s => s.resendInvitation(invitationId)], ["revokeInvitation", s => s.revokeInvitation(invitationId)], ["previewInvitation", s => s.previewInvitation(" exact synthetic token \u0000 ")], ["acceptInvitation", s => s.acceptInvitation(" exact synthetic token \u0000 ")],
  ["listAdminRequestsForMe", s => s.listAdminRequestsForMe()], ["listAdminRequestsForTeam", s => s.listAdminRequestsForTeam(teamId)], ["createAdminRequest", s => s.createAdminRequest(teamId, memberId)], ["revokeAdminRequest", s => s.revokeAdminRequest(invitationId)], ["acceptAdminRequest", s => s.acceptAdminRequest(invitationId)], ["listNotifications", s => s.listNotifications()], ["acknowledgeNotification", s => s.acknowledgeNotification(invitationId)],
];

describe("dormant native Team foundation", () => {
  it("requires an actual original Profile admission", async () => {
    const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); server(h);
    expect(runtime.createTeamService(profileId)).toBe(null); expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out"); expect(runtime.createTeamService(profileId)).toBe(null);
  });
  it.each(methods)("runs actual mapper method %s", async (_name, invoke) => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), service = runtime.createTeamService(profileId)!;
    expect(Object.isFrozen(service)).toBe(true); expect(Object.keys(service)).toHaveLength(29);
    expect(await invoke(service)).toMatchObject({ ok: true }); expect(calls.length).toBeGreaterThan(0);
  });
  it.each([false, true])("uses exact dependent workspace graph; admin=%s", async admin => {
    const { h, runtime } = await ready(), calls = foundationTransport(h, admin), service = runtime.createTeamService(profileId)!;
    const result = await service.getTeamWorkspace(teamId); expect(result.ok).toBe(true);
    expect(calls.map(call => call.url.pathname.split("/").pop())).toEqual(["teams", "get_my_profile", "team_memberships", ...(admin ? ["get_team_member_emails"] : []), "profiles"]);
    expect([...calls[0].url.searchParams]).toEqual([["select", "*"], ["id", `eq.${teamId}`]]);
    expect(calls[0].request.headers.has("Accept")).toBe(false);
    expect([...calls.at(-1)!.url.searchParams]).toEqual([["select", "id,display_name"], ["id", `in.(${profileId},${otherProfile})`]]);
    if (result.ok) { expect(result.value.isAdmin).toBe(admin); expect("email" in result.value.roster[0]).toBe(admin); }
  });
  it("uses only the actual created Team target and preserves original create bytes", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h);
    expect((await runtime.createTeamService(profileId)!.createTeam(createInput)).ok).toBe(true);
    expect(calls[0].body).toEqual({ p_name: createInput.name, p_participation_as_player: true, p_functions: ["coach"] });
    expect(calls[1].url.searchParams.get("id")).toBe(`eq.${teamId}`);
  });
  it("scopes listMyTeams to the actual original own Profile and unread notifications exactly", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), service = runtime.createTeamService(profileId)!;
    expect((await service.listMyTeams()).ok).toBe(true); expect(calls[1].url.searchParams.get("profile_id")).toBe(`eq.${profileId}`); expect(calls[1].url.searchParams.get("status")).toBe("eq.active");
    expect((await service.listNotifications()).ok).toBe(true); expect([...calls[2].url.searchParams]).toEqual([["select", "*"], ["read_at", "is.null"], ["order", "created_at.desc"]]);
  });
  it("preserves API routes, exact proposal and honest email outcomes", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), service = runtime.createTeamService(profileId)!;
    expect(await service.createInvitation(teamId, proposal)).toEqual({ ok: true, value: { invitation, emailSent: false } });
    expect(await service.reviseInvitation(invitationId, proposal)).toMatchObject({ ok: true, value: { emailSent: false } });
    expect((await service.resendInvitation(invitationId)).ok).toBe(true); expect((await service.createAdminRequest(teamId, memberId)).ok).toBe(true); expect(await service.removeMember(teamId, memberId)).toEqual({ ok: true, value: { notificationEmailSent: false } });
    expect(calls.map(call => call.url.pathname)).toEqual(["/api/team/invitations", `/api/team/invitations/${invitationId}/revise`, `/api/team/invitations/${invitationId}/resend`, "/api/team/admin-requests", "/api/team/members/remove"]);
    expect(calls.map(call => call.body)).toEqual([{ teamId, ...proposal }, proposal, {}, { teamId, membershipId: memberId }, { teamId, membershipId: memberId }]);
  });
});

describe("native Team foundation failure and original authority", () => {
  it.each(["", "http://native-api.example.invalid", "https://native-api.example.invalid/", " https://native-api.example.invalid", "https://native-api.example.invalid/path"])("refuses invalid API origin %j before actual getSession/fetch, leaving REST available", async origin => {
    const h = await fixture(); vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", origin);
    const b = await bootstrap(h), runtime = await b.start(); await onboard(h, runtime); const calls = foundationTransport(h), { AuthClient } = await import("@supabase/supabase-js"), read = vi.spyOn(AuthClient.prototype, "getSession"), service = runtime.createTeamService(profileId)!;
    h.fetch.mockClear(); expect(await service.createInvitation(teamId, proposal)).toMatchObject({ ok: false, error: { kind: "forbidden" } }); expect(h.fetch).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    expect((await service.getMyProfile()).ok).toBe(true); expect(read).toHaveBeenCalledTimes(1); expect(calls).toHaveLength(1);
  });
  it("captures configured API origin once and never retargets from later environment state", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h); vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "https://other.example.invalid");
    expect((await runtime.createTeamService(profileId)!.resendInvitation(invitationId)).ok).toBe(true); expect(calls[0].url.origin).toBe("https://native-api.example.invalid");
  });
  it("refuses a canonical different actual own Profile before a derived query, then genuinely denies after FIFO", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), previous = h.fetch.getMockImplementation()!, outcomes: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
    h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.endsWith("/get_my_profile") ? response({ ...myProfile, id: otherProfile }) : previous(...args));
    expect((await runtime.createTeamService(profileId)!.listMyTeams()).ok).toBe(false); expect(calls).toEqual([]);
    expect(outcomes).toEqual([expect.objectContaining({ kind: "identity_invalidated", outstanding: [] })]); expect(runtime.createTeamService(profileId)).toBe(null);
  });
  it.each([null, {}, { id: null }, { id: "malformed" }])("does not invent definitive denial from own Profile %j", async data => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), previous = h.fetch.getMockImplementation()!, outcomes: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
    h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.endsWith("/get_my_profile") ? response(data) : previous(...args));
    expect((await runtime.createTeamService(profileId)!.listMyTeams()).ok).toBe(false); expect(outcomes).toEqual([]); expect(calls).toEqual([]);
  });
  it.each(["malformed-created", "followup-error", "lost-create"])("never retries a Team creation with %s", async kind => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), previous = h.fetch.getMockImplementation()!; let creates = 0;
    h.fetch.mockImplementation(async (...args) => {
      const url = new URL((args[0] as Request).url);
      if (url.pathname.endsWith("/create_team")) { creates++; if (kind === "lost-create") throw null; if (kind === "malformed-created") return response({ ...teamRow, id: "malformed" }); }
      if (kind === "followup-error" && url.pathname.endsWith("/teams")) return response({ message: "not_found: synthetic" }, 404);
      return previous(...args);
    });
    expect((await runtime.createTeamService(profileId)!.createTeam(createInput)).ok).toBe(false); expect(creates).toBe(1);
    if (kind === "malformed-created" || kind === "lost-create") expect(calls).toEqual([]);
  });
  it.each(["forbidden", "network", "cast"])("retains actual own-API %s semantics without fabricated Identity denial or retry", async kind => {
    const { h, runtime } = await ready(), previous = h.fetch.getMockImplementation()!, outcomes: unknown[] = []; let count = 0;
    runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.startsWith("https://native-api.example.invalid/")) { count++; if (kind === "network") throw null; return kind === "forbidden" ? response({ error: "forbidden: synthetic" }, 403) : response({ honestExtra: "existing JSON cast is preserved" }); } return previous(...args); });
    const result = await runtime.createTeamService(profileId)!.resendInvitation(invitationId);
    if (kind === "cast") expect(result).toEqual({ ok: true, value: { honestExtra: "existing JSON cast is preserved" } });
    else expect(result).toMatchObject({ ok: false, error: { kind: kind === "network" ? "network_error" : "forbidden" } });
    expect(count).toBe(1); expect(outcomes).toEqual([]);
  });
  it("never revives an old Team facade after same-Profile reauthentication", async () => {
    const { h, runtime } = await ready(), old = runtime.createTeamService(profileId)!, calls = foundationTransport(h);
    await runtime.coordinator.signOut(); await runtime.coordinator.requestEmailOtp(user.email); await runtime.coordinator.verifyEmailOtp(user.email, "123456");
    expect((await old.createTeam(createInput)).ok).toBe(false); expect((await old.resendInvitation(invitationId)).ok).toBe(false); expect(calls).toEqual([]);
    expect((await runtime.createTeamService(profileId)!.getMyProfile()).ok).toBe(true);
  });
  it("captures declared arrays before an actual queue wait without invoking a caller iterator", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), previous = h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    let first = true;
    h.fetch.mockImplementation(async (...args) => { if (first && (args[0] as Request).url.endsWith("/get_my_gate_state")) { first = false; entered.resolve(); await release.promise; } return previous(...args); });
    const service = runtime.createTeamService(profileId)!, holding = service.getMyProfile(); await entered.promise;
    const functions = ["coach" as const]; Object.defineProperty(functions, Symbol.iterator, { value() { throw null; } });
    const input = { ...createInput, functions }, pending = service.createTeam(input); input.name = "changed"; functions.length = 0; release.resolve(); await holding;
    expect((await pending).ok).toBe(true); expect(calls.find(call => call.url.pathname.endsWith("create_team"))!.body).toEqual({ p_name: createInput.name, p_participation_as_player: true, p_functions: ["coach"] });
  });
  it("owns a revoking proposal getter's masked work while stopping later fields", async () => {
    const { b, runtime } = await ready(), hold = deferred<void>(); releases.push(() => hold.resolve()); Object.defineProperty(hold.promise, "then", { value: null }); let later = 0;
    const input = { get email() { void b.host.dispose(); return hold.promise; }, get participationAsPlayer() { later++; return true; } };
    let done = false; const pending = runtime.createTeamService(profileId)!.createInvitation(teamId, input as never).then(value => { done = true; return value; });
    await tick(); expect(done).toBe(false); expect(later).toBe(0); hold.resolve(); expect((await pending).ok).toBe(false); expect(await b.host.dispose()).toEqual({ ok: true });
  });
  it("owns the exact dispose Promise from a record getter without awaiting itself", async () => {
    const { b, runtime } = await ready(); let later = 0;
    const input = { get name() { return b.host.dispose(); }, get participationAsPlayer() { later++; return true; } };
    expect((await runtime.createTeamService(profileId)!.createTeam(input as never)).ok).toBe(false); expect(later).toBe(0); expect(await b.host.dispose()).toEqual({ ok: true });
  });
});

describe("native Team exact dependent hooks", () => {
  it.each(["early-created", "duplicate-profile", "wrong-team", "changed-roster", "masked-roster"])("refuses %s at the actual mapper hook boundary", async kind => {
    const hold = deferred<void>(); releases.push(() => hold.resolve()); Object.defineProperty(hold.promise, "then", { value: null });
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly observed: NonNullable<ConstructorParameters<typeof actual.SupabaseTeamService>[2]>;
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) {
          const hooks = args[2]!;
          super(args[0], args[1], { ...hooks, beforeRosterProfiles(team, ids) {
            if (kind === "wrong-team") return hooks.beforeRosterProfiles(memberId, ids);
            if (kind === "masked-roster") return hooks.beforeRosterProfiles(team, hold.promise as never);
            const result = hooks.beforeRosterProfiles(team, ids); if (kind === "changed-roster") (ids as string[])[0] = memberId; return result;
          } }); this.observed = hooks;
          if (kind === "early-created") hooks.createdTeamMapped(teamId);
        }
        override async getMyProfile() { const result = await super.getMyProfile(); if (kind === "duplicate-profile" && result.ok && result.value) await this.observed.ownProfileMapped(result.value.id); return result; }
      } };
    });
    try {
      const { h, b, runtime } = await ready(), calls = foundationTransport(h);
      let done = false; const pending = runtime.createTeamService(profileId)!.getTeamWorkspace(teamId).then(value => { done = true; return value; });
      if (kind === "masked-roster") { await vi.waitFor(() => expect(calls.map(call => call.url.pathname.split("/").pop())).toContain("team_memberships")); await tick(); expect(done).toBe(false); const close = b.host.dispose(); hold.resolve(); await close; }
      expect((await pending).ok).toBe(false); expect(calls.some(call => call.url.pathname.endsWith("/profiles"))).toBe(false);
      if (kind === "early-created") expect(calls).toEqual([]);
      if (kind === "duplicate-profile") expect(calls.map(call => call.url.pathname.split("/").pop())).toEqual(["teams", "get_my_profile"]);
    } finally { vi.doUnmock("../supabaseTeamService"); }
  });
  it("matches actual SDK first-occurrence deduplication of real roster IDs", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), previous = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.includes("/team_memberships?")) return response([{ id: memberId, profile_id: profileId, participation_as_player: true, status: "active", team_membership_functions: [] }, { id: invitationId, profile_id: profileId, participation_as_player: true, status: "active", team_membership_functions: [] }]); return previous(...args); });
    expect((await runtime.createTeamService(profileId)!.getTeamWorkspace(teamId)).ok).toBe(true); expect(calls.at(-1)!.url.searchParams.get("id")).toBe(`in.(${profileId})`);
  });
});

describe("native own-API final materialization", () => {
  for (const mutation of ["origin", "path", "query", "apikey", "schema", "authorization", "body", "credentials", "redirect", "supersede", "close"] as const) it(`refuses final API ${mutation} before SEND`, async () => {
    const h = await fixture(), OriginalRequest = Request; let armed = false, newer: Promise<unknown> | null = null, runtime: Awaited<ReturnType<Awaited<ReturnType<typeof bootstrap>>["start"]>> | null = null, host: NativeIdentityBootstrapHost | null = null;
    vi.stubGlobal("Request", class extends OriginalRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        if (armed && input instanceof OriginalRequest && input.url.startsWith("https://native-api.example.invalid/")) {
          const url = new URL(input.url), headers = new Headers(init?.headers ?? input.headers);
          if (mutation === "origin") url.hostname = "other.example.invalid";
          if (mutation === "path") url.pathname = "/api/team/admin-requests";
          if (mutation === "query") url.searchParams.set("target", "other");
          if (mutation === "apikey") headers.set("apikey", "SYNTHETIC_FORBIDDEN_KEY");
          if (mutation === "schema") headers.set("Content-Profile", "public");
          if (mutation === "authorization") headers.set("Authorization", "Bearer SYNTHETIC_OTHER");
          super(url, { ...init, headers, method: "POST", body: mutation === "body" ? "{\"changed\":true}" : JSON.stringify({ teamId, ...proposal }), ...(mutation === "credentials" ? { credentials: "include" } : {}), ...(mutation === "redirect" ? { redirect: "follow" } : {}) });
          armed = false; if (mutation === "supersede") newer = runtime!.coordinator.requestEmailOtp(user.email); if (mutation === "close") newer = host!.dispose();
        } else super(input, init);
      }
    });
    const b = await bootstrap(h); host = b.host; runtime = await b.start(); await onboard(h, runtime); const calls = foundationTransport(h), service = runtime.createTeamService(profileId)!; armed = true;
    expect((await service.createInvitation(teamId, proposal)).ok).toBe(false); expect(calls).toEqual([]); await newer;
  });
  it("holds actual HTTP body ownership through dispose", async () => {
    const { h, b, runtime } = await ready(), previous = h.fetch.getMockImplementation()!, entered = deferred<void>(); let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } }); releases.push(() => { try { controller.close(); } catch {} });
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.startsWith("https://native-api.example.invalid/")) { entered.resolve(); return new Response(stream, { headers: { "Content-Type": "application/json" } }); } return previous(...args); });
    const pending = runtime.createTeamService(profileId)!.resendInvitation(invitationId); await entered.promise; let done = false; const close = b.host.dispose().then(() => { done = true; }); await tick(); expect(done).toBe(false);
    controller.enqueue(new TextEncoder().encode("{}")); controller.close(); expect((await pending).ok).toBe(false); await close;
  });
});

describe("native Team capture and direct callback drain", () => {
  it("does not poison an active actual HTTP command from malformed queued input", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), previous = h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.startsWith("https://native-api.example.invalid/")) { entered.resolve(); await release.promise; } return previous(...args); });
    const service = runtime.createTeamService(profileId)!, holding = service.resendInvitation(invitationId); await entered.promise;
    let later = 0; expect(await service.createTeam({ name: Promise.reject(null), get participationAsPlayer() { later++; return true; } } as never)).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
    release.resolve(); expect((await holding).ok).toBe(true); expect(later).toBe(0); expect(calls).toHaveLength(1);
  });
  it("retains a masked root Promise even when it carries matching record fields", async () => {
    const { h, b, runtime } = await ready(), hold = deferred<void>(); releases.push(() => hold.resolve()); Object.assign(hold.promise, createInput); Object.defineProperty(hold.promise, "then", { value: null });
    h.fetch.mockClear(); let done = false; const pending = runtime.createTeamService(profileId)!.createTeam(hold.promise as never).then(value => { done = true; return value; });
    await tick(); expect(done).toBe(false); const close = b.host.dispose(); hold.resolve(); expect((await pending).ok).toBe(false); await close; expect(h.fetch).not.toHaveBeenCalled();
  });
  it("rejects own-array holes even when a prototype offers a valid direct function", async () => {
    const { h, runtime } = await ready(), calls = foundationTransport(h), functions = new Array<"coach">(1); Object.setPrototypeOf(functions, { 0: "coach" });
    expect(await runtime.createTeamService(profileId)!.createTeam({ ...createInput, functions })).toMatchObject({ ok: false, error: { kind: "invalid_input" } }); expect(calls).toEqual([]);
  });
  it("reports the genuine full failed denial after ordinary preflight rejects Identity", async () => {
    const { h, runtime } = await ready(), { IDENTITY_BARRIER_STORAGE_KEY } = await import("../../identity/identityBarrier"), outcomes: unknown[] = [];
    runtime.subscribeToIdentityInvalidations(value => { outcomes.push(value); });
    const service = runtime.createTeamService(profileId)!; h.sqlFaults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === IDENTITY_BARRIER_STORAGE_KEY) throw null; return next(); }; h.fetch.mockResolvedValue(response(facts(false)));
    expect((await service.createTeam(createInput)).ok).toBe(false); expect(outcomes).toEqual([expect.objectContaining({ kind: "durable_denial_unavailable", outstanding: expect.arrayContaining(["durable_barrier", "trusted_state"]) })]);
  });
  it.each(["masked", "rejected", "own-disposal"])("owns actual own-API Authorization header %s ACK", async kind => {
    const h = await fixture(), OriginalRequest = Request, originalSet = Headers.prototype.set, hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve()); Object.defineProperty(hold.promise, "then", { value: null });
    let armed = false, host: NativeIdentityBootstrapHost | null = null, close: Promise<unknown> | null = null;
    vi.stubGlobal("Request", class extends OriginalRequest { constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, init); if (typeof input === "string" && input.startsWith("https://native-api.example.invalid/")) armed = true; } });
    Headers.prototype.set = function (name, value) {
      Reflect.apply(originalSet, this, [name, value]);
      if (armed && name.toLowerCase() === "authorization") { armed = false; entered.resolve(); return (kind === "masked" ? hold.promise : kind === "rejected" ? Promise.reject(null) : (close = host!.dispose())) as never; }
    };
    try {
      const b = await bootstrap(h); host = b.host; const runtime = await b.start(); await onboard(h, runtime); const calls = foundationTransport(h);
      const pending = runtime.createTeamService(profileId)!.resendInvitation(invitationId); await entered.promise;
      if (kind === "masked") { let done = false; close = b.host.dispose().then(value => { done = true; return value; }); await tick(); expect(done).toBe(false); hold.resolve(); }
      expect((await pending).ok).toBe(false); await (close ?? b.host.dispose()); expect(calls).toEqual([]);
    } finally { Headers.prototype.set = originalSet; }
  });
});

describe("native Team callback capture regressions", () => {
  it("owns directly observed malformed route kind until settlement", async () => {
    const hold=deferred<void>(); releases.push(()=>hold.resolve()); Object.defineProperty(hold.promise,"then",{value:null});
    const mapperPath="../supabaseTeamService";
    vi.doMock(mapperPath, async()=>{
      const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
      return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
        override async resendInvitation(){return await this.request({get kind(){return hold.promise}} as never,{}) as never;}
      }};
    });
    try {
      const {h,runtime}=await ready(), calls=foundationTransport(h);let done=false;
      const pending=runtime.createTeamService(profileId)!.resendInvitation(invitationId).then(v=>{done=true;return v});
      await tick();await tick();expect(done,"actual fixed transport sends="+calls.length).toBe(false);expect(calls).toEqual([]);hold.resolve();expect((await pending).ok).not.toBe(true);
    }finally{hold.resolve();vi.doUnmock(mapperPath);}
  });
  it("owns directly observed pending HTTP body root before any SEND", async () => {
    const hold=deferred<void>();releases.push(()=>hold.resolve());Object.defineProperty(hold.promise,"then",{value:null});
    const mapperPath="../supabaseTeamService";
    vi.doMock(mapperPath,async()=>{
      const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
      return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService {
        private readonly request:ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
        override async resendInvitation(_id:string){return await this.request({kind:"resendInvitation",invitationId:_id},hold.promise) as never;}
      }};
    });
    try{
      const {h,runtime}=await ready(),calls=foundationTransport(h);let done=false;
      const pending=runtime.createTeamService(profileId)!.resendInvitation(invitationId).then(v=>{done=true;return v});
      await tick();await tick();expect(done,"actual fixed transport sends="+calls.length).toBe(false);expect(calls).toEqual([]);hold.resolve();await pending;
    }finally{hold.resolve();vi.doUnmock(mapperPath);}
  });

  it("stops before body serialization after a route getter closes the host", async () => {
    const mapperPath="../supabaseTeamService";
    let currentHost:NativeIdentityBootstrapHost|null=null,later=0;
    vi.doMock(mapperPath,async()=>{
      const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
      return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService {
        private readonly request:ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
        override async resendInvitation(id:string){return await this.request({get kind(){void currentHost!.dispose();return "resendInvitation" as const},invitationId:id},{get toJSON(){later++;return ()=>({})}}) as never;}
      }};
    });
    try{
      const {h,b,runtime}=await ready();currentHost=b.host;const calls=foundationTransport(h);
      await runtime.createTeamService(profileId)!.resendInvitation(invitationId);await b.host.dispose();
      expect(later).toBe(0);expect(calls).toEqual([]);
    }finally{vi.doUnmock(mapperPath);}
  });

  it.each(["route-root","route-id","body-fields-root","email","functions"])("owns declared callback boundary %s without serialization coercion", async mode => {
    const hold=deferred<void>(),entered=deferred<void>();releases.push(()=>hold.resolve());Object.defineProperty(hold.promise,"then",{value:null});
    const mapperPath="../supabaseTeamService";
    vi.doMock(mapperPath,async()=>{
      const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
      return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService {
        private readonly request:ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
        override async resendInvitation(id:string){
          const route=mode==="route-root"?Object.assign(hold.promise,{kind:"resendInvitation",invitationId:id}):{kind:"resendInvitation",get invitationId(){return hold.promise}};
          entered.resolve();return await this.request(route as never,{}) as never;
        }
        override async createInvitation(id:string,p:typeof proposal){
          let body:unknown;
          if(mode==="body-fields-root")body=Object.assign(hold.promise,{teamId:id,...p});
          else if(mode==="email"){Object.defineProperty(hold.promise,"toJSON",{value:()=>p.email});body={teamId:id,...p,email:hold.promise};}
          else {Object.defineProperty(hold.promise,"toJSON",{value:()=>p.proposedFunctions});body={teamId:id,...p,proposedFunctions:hold.promise};}
          entered.resolve();return await this.request({kind:"createInvitation"},body) as never;
        }
      }};
    });
    try{
      const {h,runtime}=await ready(),calls=foundationTransport(h);let done=false;
      const service=runtime.createTeamService(profileId)!;
      const pending=(mode.startsWith("route")?service.resendInvitation(invitationId):service.createInvitation(teamId,proposal)).then(v=>{done=true;return v});
      await entered.promise;await tick();expect(done,"actual fixed transport sends="+calls.length).toBe(false);expect(calls).toEqual([]);hold.resolve();await pending;
    }finally{hold.resolve();vi.doUnmock(mapperPath);}
  });

  it("keeps an old authorized callback retired during a newer identical command",async()=>{
    const mapperPath="../supabaseTeamService";
    let old:ConstructorParameters<typeof import("../supabaseTeamService").SupabaseTeamService>[1]|null=null;
    vi.doMock(mapperPath,async()=>{
      const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
      return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService{constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);old??=args[1];}}};
    });
    try{
      const {h,runtime}=await ready(),calls=foundationTransport(h),service=runtime.createTeamService(profileId)!;
      expect((await service.resendInvitation(invitationId)).ok).toBe(true);
      const previous=h.fetch.getMockImplementation()!,entered=deferred<void>(),release=deferred<void>();releases.push(()=>release.resolve());
      h.fetch.mockImplementation(async(...args)=>{if((args[0] as Request).url.endsWith("/get_my_gate_state")){entered.resolve();await release.promise;}return previous(...args);});
      const next=service.resendInvitation(invitationId);await entered.promise;let later=0;
      expect(await old!({get kind(){later++;return "resendInvitation" as const},invitationId},{})).toEqual({kind:"forbidden"});
      expect(later).toBe(0);release.resolve();expect((await next).ok).toBe(true);expect(calls).toHaveLength(2);
    }finally{vi.doUnmock(mapperPath);}
  });
  it("never waits on its own exact disposal from a route getter",async()=>{
    const mapperPath="../supabaseTeamService";
    let currentHost:NativeIdentityBootstrapHost|null=null;
    vi.doMock(mapperPath,async()=>{
      const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
      return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService{
        private readonly request:ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
        override async resendInvitation(id:string){return await this.request({get kind(){return currentHost!.dispose()},invitationId:id} as never,{}) as never;}
      }};
    });
    try{
      const {h,b,runtime}=await ready();currentHost=b.host;const calls=foundationTransport(h);
      await runtime.createTeamService(profileId)!.resendInvitation(invitationId);expect(await b.host.dispose()).toEqual({ok:true});expect(calls).toEqual([]);
    }finally{vi.doUnmock(mapperPath);}
  });
});

describe("native Team callback capture adjacent cases", () => {
  it.each(["pending", "masked", "rejected"] as const)("owns %s malformed function elements and stops later field reads", async mode => {
    const hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    let later = 0;
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async createInvitation(id: string, p: typeof proposal) {
          const value = mode === "rejected" ? Promise.reject(null) : hold.promise;
          if (mode === "masked") Object.defineProperty(value, "then", { value: null });
          const functions = [value, "team_admin"];
          Object.defineProperty(functions, "1", { get() { later++; return "team_admin"; } });
          entered.resolve();
          return await this.request({ kind: "createInvitation" }, { teamId: id, ...p, proposedFunctions: functions }) as never;
        }
      } };
    });
    try {
      const { h, b, runtime } = await ready(), calls = foundationTransport(h); let done = false;
      const pending = runtime.createTeamService(profileId)!.createInvitation(teamId, proposal).then(value => { done = true; return value; });
      await entered.promise; await tick();
      if (mode !== "rejected") { expect(done).toBe(false); let closed = false; const close = b.host.dispose().then(() => { closed = true; }); await tick(); expect(closed).toBe(false); hold.resolve(); await close; }
      expect((await pending).ok).not.toBe(true); expect(calls).toEqual([]); expect(later).toBe(0);
    } finally { hold.resolve(); vi.doUnmock("../supabaseTeamService"); }
  });

  it.each(["close", "supersede", "exact-disposal"] as const)("stops after a body getter causes %s while retaining its returned work", async mode => {
    const hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    Object.defineProperty(hold.promise, "then", { value: null });
    let host: NativeIdentityBootstrapHost | null = null, runtimeRef: IdentityRuntimeReady | null = null, later = 0;
    let close: Promise<unknown> | null = null, next: Promise<unknown> | null = null;
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async createInvitation(id: string) {
          return await this.request({ kind: "createInvitation" }, {
            get teamId() { entered.resolve(); if (mode === "supersede") next = runtimeRef!.coordinator.requestEmailOtp(user.email); else close = host!.dispose(); return mode === "exact-disposal" ? close : hold.promise; },
            get email() { later++; return proposal.email; },
            get toJSON() { later++; return () => ({ teamId: id, ...proposal }); },
          }) as never;
        }
      } };
    });
    try {
      const { h, b, runtime } = await ready(); host = b.host; runtimeRef = runtime;
      const calls = foundationTransport(h); let done = false;
      const pending = runtime.createTeamService(profileId)!.createInvitation(teamId, proposal).then(value => { done = true; return value; });
      await entered.promise; await tick(); if (mode !== "exact-disposal") expect(done).toBe(false);
      expect(later).toBe(0); expect(calls).toEqual([]); hold.resolve(); await pending; await close; await next;
    } finally { hold.resolve(); vi.doUnmock("../supabaseTeamService"); }
  });

  it.each(["toJSON", "iterator", "inherited-index", "wrong-first-field"] as const)("uses only exact declared callback data: %s", async mode => {
    let foreign = 0;
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async createInvitation(id: string, p: typeof proposal) {
          const functions = [...p.proposedFunctions];
          if (mode === "iterator") Object.defineProperty(functions, Symbol.iterator, { get() { foreign++; throw null; } });
          if (mode === "inherited-index") { delete functions[0]; Object.setPrototypeOf(functions, { get 0() { foreign++; return "coach"; } }); }
          const body = { teamId: mode === "wrong-first-field" ? otherProfile : id, get email() { if (mode === "wrong-first-field") foreign++; return p.email; }, participationAsPlayer: p.participationAsPlayer, proposedFunctions: functions, get toJSON() { foreign++; throw null; } };
          return await this.request({ kind: "createInvitation" }, body) as never;
        }
      } };
    });
    try {
      const { h, runtime } = await ready(), calls = foundationTransport(h);
      const result = await runtime.createTeamService(profileId)!.createInvitation(teamId, proposal);
      expect(foreign).toBe(0); expect(calls).toHaveLength(mode === "toJSON" || mode === "iterator" ? 1 : 0);
      // The subclass returns the request outcome directly; only the genuine
      // inherited mapper interprets API JSON into a TeamResult.
      expect(result).toMatchObject(calls.length ? { kind: "response" } : { ok: false, error: { kind: "forbidden" } });
    } finally { vi.doUnmock("../supabaseTeamService"); }
  });
});

describe("native Team poisoned Promise root refusal",()=>{
 it.each(["route-constructor","route-species","body-constructor","body-species"])("does not accept %s as an ordinary DTO after intrinsic then throws",async mode=>{
  const mapperPath="../supabaseTeamService";
  const hold=deferred<void>();releases.push(()=>hold.resolve());Object.defineProperty(hold.promise,"then",{value:null});
  if(mode.endsWith("constructor"))Object.defineProperty(hold.promise,"constructor",{get(){throw null;}});
  else Object.defineProperty(hold.promise,"constructor",{value:{get [Symbol.species](){throw null;}}});
  vi.doMock(mapperPath,async()=>{
   const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
   return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService{
    private readonly request:ConstructorParameters<typeof actual.SupabaseTeamService>[1];constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
    override async resendInvitation(id:string){
     const route=mode.startsWith("route")?Object.assign(hold.promise,{kind:"resendInvitation",invitationId:id}):{kind:"resendInvitation",invitationId:id};
     return await this.request(route as never,mode.startsWith("body")?hold.promise:{}) as never;
    }
   }};
  });
  try{
   const {h,runtime}=await ready(),calls=foundationTransport(h);const result=await runtime.createTeamService(profileId)!.resendInvitation(invitationId);
   expect(calls).toEqual([]);expect(result).toMatchObject({ok:false,error:{kind:"forbidden"}});
  }finally{hold.resolve();vi.doUnmock(mapperPath);}
 });
});

describe("native Team independently supported callback roots", () => {
  it.each(["route", "body"] as const)("refuses inherited throwing Promise species on %s", async target => {
    let release!: () => void;
    class PoisonedPromise extends Promise<void> { static get [Symbol.species](): PromiseConstructor { throw null; } }
    const value = new PoisonedPromise(resolve => { release = resolve; }); releases.push(() => release());
    Object.defineProperty(value, "then", { value: null });
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async resendInvitation(id: string) {
          return await this.request(target === "route" ? Object.assign(value, { kind: "resendInvitation" as const, invitationId: id }) : { kind: "resendInvitation", invitationId: id }, target === "body" ? value : {}) as never;
        }
      } };
    });
    try { const { h, runtime } = await ready(), calls = foundationTransport(h); expect(await runtime.createTeamService(profileId)!.resendInvitation(invitationId)).toMatchObject({ ok: false }); expect(calls).toEqual([]); }
    finally { release(); vi.doUnmock("../supabaseTeamService"); }
  });

  it.each(["object", "null"] as const)("still owns a real pending Promise with changed %s prototype", async prototype => {
    const hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    Object.setPrototypeOf(hold.promise, prototype === "object" ? Object.prototype : null);
    Object.defineProperty(hold.promise, "then", { value: null });
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async resendInvitation(id: string) { entered.resolve(); return await this.request(Object.assign(hold.promise, { kind: "resendInvitation" as const, invitationId: id }), {}) as never; }
      } };
    });
    try {
      const { h, b, runtime } = await ready(), calls = foundationTransport(h); let done = false;
      const pending = runtime.createTeamService(profileId)!.resendInvitation(invitationId).then(result => { done = true; return result; });
      await entered.promise; await tick(); expect(done).toBe(false);
      let closed = false; const close = b.host.dispose().then(() => { closed = true; }); await tick(); expect(closed).toBe(false); expect(calls).toEqual([]);
      hold.resolve(); expect(await pending).toMatchObject({ ok: false }); await close;
    } finally { hold.resolve(); vi.doUnmock("../supabaseTeamService"); }
  });

  it.each(["object", "null"] as const)("accepts supported ordinary %s-prototype callback data", async prototype => {
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async resendInvitation(id: string) {
          const make = () => Object.create(prototype === "object" ? Object.prototype : null);
          return await this.request(Object.assign(make(), { kind: "resendInvitation", invitationId: id }), make()) as never;
        }
      } };
    });
    try { const { h, runtime } = await ready(), calls = foundationTransport(h); expect(await runtime.createTeamService(profileId)!.resendInvitation(invitationId)).toMatchObject({ kind: "response" }); expect(calls).toHaveLength(1); }
    finally { vi.doUnmock("../supabaseTeamService"); }
  });
});

describe("native Team plain thenable callback refusal", () => {
  it.each(["route", "body"] as const)("owns a directly returned plain %s thenable without SEND", async target => {
    const hold = deferred<void>(), entered = deferred<void>(); releases.push(() => hold.resolve());
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async resendInvitation(id: string) {
          const value = { then(resolve: () => void) { entered.resolve(); void hold.promise.then(resolve); } };
          return await this.request(target === "route" ? Object.assign(value, { kind: "resendInvitation" as const, invitationId: id }) : { kind: "resendInvitation", invitationId: id }, target === "body" ? value : {}) as never;
        }
      } };
    });
    try {
      const { h, b, runtime } = await ready(), calls = foundationTransport(h); let done = false;
      const pending = runtime.createTeamService(profileId)!.resendInvitation(invitationId).then(result => { done = true; return result; });
      await entered.promise; await tick(); expect(done).toBe(false); let closed = false;
      const close = b.host.dispose().then(() => { closed = true; }); await tick(); expect(closed).toBe(false); expect(calls).toEqual([]);
      hold.resolve(); expect(await pending).toMatchObject({ ok: false }); await close;
    } finally { hold.resolve(); vi.doUnmock("../supabaseTeamService"); }
  });
});

describe("native Team reflection result ownership",()=>{
 it.each(["route-native","route-masked","body-native","body-masked"])("owns directly observed malformed prototype %s",async mode=>{
  const mapperPath="../supabaseTeamService";
  const hold=deferred<void>(),entered=deferred<void>();releases.push(()=>hold.resolve());if(mode.endsWith("masked"))Object.defineProperty(hold.promise,"then",{value:null});
  vi.doMock(mapperPath,async()=>{
   const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
   return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService{
    private readonly request:ConstructorParameters<typeof actual.SupabaseTeamService>[1];constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
    override async resendInvitation(id:string){
     const malformed=new Proxy(mode.startsWith("route")?{kind:"resendInvitation",invitationId:id}:{},{getPrototypeOf(){entered.resolve();return hold.promise;}});
     return await this.request((mode.startsWith("route")?malformed:{kind:"resendInvitation",invitationId:id}) as never,mode.startsWith("body")?malformed:{}) as never;
    }
   }};
  });
  try{
   const {h,b,runtime}=await ready(),calls=foundationTransport(h);let done=false;
   const work=runtime.createTeamService(profileId)!.resendInvitation(invitationId).then(v=>{done=true;return v});
   await entered.promise;await tick();expect(done).toBe(false);let closed=false;const close=b.host.dispose().then(()=>{closed=true;});await tick();expect(closed).toBe(false);expect(calls).toEqual([]);hold.resolve();await work;await close;
  }finally{hold.resolve();vi.doUnmock(mapperPath);}
 });

 it.each(["route-nested","body-nested","route-supersede","body-supersede"])("retains exact ownership through reflection reentrancy %s",async mode=>{
  const mapperPath="../supabaseTeamService";
  let runtimeRef:IdentityRuntimeReady|null=null,nested:Promise<unknown>|null=null,newer:Promise<unknown>|null=null,fieldReads=0,insideReads=0,armed=true;
  vi.doMock(mapperPath,async()=>{
   const actual=await vi.importActual<typeof import("../supabaseTeamService")>(mapperPath);
   return {...actual,SupabaseTeamService:class extends actual.SupabaseTeamService{
    private readonly request:ConstructorParameters<typeof actual.SupabaseTeamService>[1];constructor(...args:ConstructorParameters<typeof actual.SupabaseTeamService>){super(...args);this.request=args[1];}
    override async resendInvitation(id:string){
     const request=this.request;
     const reflected=new Proxy(mode.startsWith("route")?{get kind(){fieldReads++;return "resendInvitation" as const},invitationId:id}:{},{getPrototypeOf(){if(armed){armed=false;if(mode.endsWith("nested"))nested=request({get kind(){insideReads++;return "resendInvitation" as const},invitationId:id},{});else newer=runtimeRef!.coordinator.requestEmailOtp(user.email);}return Object.prototype;}});
     return await request((mode.startsWith("route")?reflected:{kind:"resendInvitation",invitationId:id}) as never,mode.startsWith("body")?reflected:{}) as never;
    }
   }};
  });
  try{
   const {h,runtime}=await ready();runtimeRef=runtime;const calls=foundationTransport(h);
   const result=await runtime.createTeamService(profileId)!.resendInvitation(invitationId);
   if(mode.endsWith("nested")){expect(await nested).toEqual({kind:"forbidden"});expect(insideReads).toBe(0);expect(calls).toHaveLength(1);expect(result).toMatchObject({kind:"response"});}
   else{expect(fieldReads).toBe(0);expect(calls).toEqual([]);expect(result).toMatchObject({ok:false,error:{kind:"forbidden"}});expect(await newer).toMatchObject({kind:"otp_requested"});}
  }finally{vi.doUnmock(mapperPath);}
 });
});

describe("native Team root and reflected work remain separately owned", () => {
  it.each(["root-first", "prototype-first"] as const)("waits for both observations: %s", async first => {
    const rootHold = deferred<void>(), prototypeHold = deferred<void>(), entered = deferred<void>();
    releases.push(() => rootHold.resolve(), () => prototypeHold.resolve());
    Object.defineProperty(prototypeHold.promise, "then", { value: null });
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async resendInvitation(id: string) {
          const root = new Proxy({ kind: "resendInvitation" as const, invitationId: id, then(resolve: () => void) { entered.resolve(); void rootHold.promise.then(resolve); } }, { getPrototypeOf() { return prototypeHold.promise; } });
          return await this.request(root, {}) as never;
        }
      } };
    });
    try {
      const { h, b, runtime } = await ready(), calls = foundationTransport(h); let done = false, closed = false;
      const pending = runtime.createTeamService(profileId)!.resendInvitation(invitationId).then(result => { done = true; return result; });
      await entered.promise; const close = b.host.dispose().then(() => { closed = true; });
      (first === "root-first" ? rootHold : prototypeHold).resolve(); await tick(); expect(done).toBe(false); expect(closed).toBe(false); expect(calls).toEqual([]);
      rootHold.resolve(); prototypeHold.resolve(); expect(await pending).toMatchObject({ ok: false }); await close;
    } finally { rootHold.resolve(); prototypeHold.resolve(); vi.doUnmock("../supabaseTeamService"); }
  });

  it("excludes only its exact genuine disposal returned by prototype reflection", async () => {
    let host: NativeIdentityBootstrapHost | null = null, fields = 0;
    vi.doMock("../supabaseTeamService", async () => {
      const actual = await vi.importActual<typeof import("../supabaseTeamService")>("../supabaseTeamService");
      return { ...actual, SupabaseTeamService: class extends actual.SupabaseTeamService {
        private readonly request: ConstructorParameters<typeof actual.SupabaseTeamService>[1];
        constructor(...args: ConstructorParameters<typeof actual.SupabaseTeamService>) { super(...args); this.request = args[1]; }
        override async resendInvitation(id: string) {
          return await this.request(new Proxy({ get kind() { fields++; return "resendInvitation" as const; }, invitationId: id }, { getPrototypeOf() { return host!.dispose(); } }), {}) as never;
        }
      } };
    });
    try { const { h, b, runtime } = await ready(); host = b.host; const calls = foundationTransport(h); expect(await runtime.createTeamService(profileId)!.resendInvitation(invitationId)).toMatchObject({ ok: false }); expect(fields).toBe(0); expect(calls).toEqual([]); expect(await b.host.dispose()).toEqual({ ok: true }); }
    finally { vi.doUnmock("../supabaseTeamService"); }
  });
});
