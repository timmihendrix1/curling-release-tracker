// @vitest-environment jsdom
import React, { useEffect } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import IdentityProvider, { useIdentity } from "../../../components/identity/IdentityProvider";
vi.mock("../../../components/identity/IdentityGateScreen", () => ({ default: () => <Probe /> }));
vi.mock("../../../components/identity/AccountDeletionFlow", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
let captured: ReturnType<typeof useIdentity> | null = null;
function Probe() { const identity = useIdentity(); useEffect(() => { captured = identity; }, [identity]); return <p>{identity.state.kind}</p>; }
// Actual installed public AuthClient + disposable real SQLite. All values and
// transports are synthetic/injected; no platform Keychain or real account.
import { createHash, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { IdentityRuntimeReady } from "../../identity/identityRuntime";
import type { NativeSupabaseAuthHost, NativeSupabaseAuthHostOptions, NativeIdentityBootstrapHost, NativeIdentityBootstrapHostOptions } from "../supabaseAuthService";
import { combinedFixture, disposeCombinedFixtures } from "../../persistence/__tests__/nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "../../persistence/__tests__/nativeMigrationMTestKit";
import { fp, isSyntheticFingerprint } from "../../persistence/__tests__/nativeMigrationTestKit";
import { parseCredentialPhysicalSlot } from "../../persistence/credentialPhysicalSlots";
const hosts: (NativeSupabaseAuthHost | NativeIdentityBootstrapHost)[] = [], releases: (() => void)[] = [];
let count = 0;
afterEach(async () => {
  cleanup(); captured = null;
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


async function mounted() {
  const { h, b } = await ready(); await b.host.dispose(); vi.resetModules();
  const hostModule = await import("../supabaseAuthService");
  const made = await hostModule.createNativeSportingIdentityHost({ ...h.options, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl() {} } });
  if (!made.ok) throw null; hosts.push(made.host);
  const started = await made.host.start(); if (started.outcome !== "ready") throw null;
  const runtime = started.runtime, server = accountTransport(h);
  render(<IdentityProvider runtime={runtime}><Probe /></IdentityProvider>);
  await waitFor(() => expect(captured?.state.kind).toBe("ready_online"));
  return { ...server, runtime };
}
it("uses the actual Provider beforeMutation callback for the actual native request", async () => {
  const { runtime, calls } = await mounted(), old = runtime.createSportingCloudService(profileId)!;
  await act(async () => { expect(await captured!.accountDeletion!.request(profileId)).toEqual({ ok: true, value: pendingValue }); });
  expect(captured!.session).toBe(null); expect(captured!.state.kind).toBe("locked");
  expect(calls.map(call => call.name)).toEqual(["get_my_account_deletion_control", "request_my_account_deletion"]);
  expect(await old.restore()).toEqual({ ok: false, error: "unavailable" });
});
it("uses actual Provider pending/cancel callbacks and requires fresh admission after recovery", async () => {
  const { runtime, state } = await mounted(), old = runtime.createSportingCloudService(profileId)!; state.pending = pendingRow;
  await act(async () => { expect(await captured!.accountDeletion!.getState()).toEqual({ ok: true, value: pendingValue }); });
  expect(captured!.state.kind).toBe("locked"); expect(runtime.createSportingCloudService(profileId)).toBe(null);
  let denials = 0; runtime.subscribeToProgress(phase => { if (phase === "identity_denied_in_memory") denials++; });
  await act(async () => { await captured!.requestEmailOtp(user.email); });
  await act(async () => { await captured!.verifyEmailOtp("123456"); });
  expect(captured!.session).toBe(null);
  await act(async () => { expect(await captured!.accountDeletion!.getState()).toEqual({ ok: true, value: pendingValue }); });
  await act(async () => { expect(await captured!.accountDeletion!.cancel(requestId)).toEqual({ ok: true, value: true }); });
  expect(captured!.state.kind).toBe("ready_online"); expect(runtime.createSportingCloudService(profileId)).not.toBe(null); expect(denials).toBe(0);
  expect(await old.restore()).toEqual({ ok: false, error: "unavailable" });
});
