import { describe, expect, it, vi } from "vitest";
import { createSupabaseAccountDeletionService } from "../supabaseAccountDeletionService";
import { createAccountDeletionGuardRepository } from "../../identity/accountDeletionGuard";
import type { StorageAdapter } from "../../persistence/types";
function guards() {
  const values = new Map<string, string>();
  const adapter: StorageAdapter = {
    get: async key => ({ status: "value", value: values.get(key) ?? null }),
    set: async (key, value) => { values.set(key, value); return { ok: true }; },
  };
  return createAccountDeletionGuardRepository(adapter);
}
const nonce = () => "30000000-0000-4000-8000-000000000003";
import type { SupabaseClient } from "../supabaseClient";
const PROFILE = "10000000-0000-4000-8000-000000000001";
const REQUEST = "20000000-0000-4000-8000-000000000002";
const row = { request_id: REQUEST, profile_id: PROFILE, requested_at: "2026-10-24T12:00:00.123+00:00", finalize_after: "2026-11-23T12:00:00.123+00:00" };
function service(data: unknown, error: unknown = null, initialPending = true) {
  let cancelled = false;
  const rpc = vi.fn(async (name: string) => {
    if (name === "get_my_account_deletion_control" && !error) {
      const pending = data === true || data === "true" ? row : Array.isArray(data) && data.length === 1 ? data[0] : null;
      if (Array.isArray(data) && data.length === 0) return { data: { profile_id: PROFILE, revision: 0, pending: null }, error };
      if (pending) return { data: { profile_id: PROFILE, revision: cancelled ? 1 : 0, pending: cancelled || !initialPending ? null : pending }, error };
    }
    if (name === "cancel_my_account_deletion" && data === true) cancelled = true;
    return { data, error };
  });
  return { rpc, api: createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guards(), nonce) };
}
describe("account deletion adapter", () => {
  it.each([false, "throw", "nonboolean"])("keeps a definitive pending fact but no effects when native floor is %s", async refusal => {
    const repository = guards(), load = vi.spyOn(repository, "load"), begin = vi.spyOn(repository, "begin");
    const rpc = vi.fn(async () => ({ data: { profile_id: PROFILE, revision: 4, pending: row }, error: null }));
    const onPending = vi.fn(), floor = vi.fn(() => { if (refusal === "throw") throw null; return refusal === "nonboolean" ? "true" as never : false; });
    const api = createSupabaseAccountDeletionService({ rpc }, repository, nonce, new Set(), undefined, undefined, floor);
    expect(await api.getState(onPending)).toMatchObject({ ok: true, value: { requestId: REQUEST } });
    expect(onPending).toHaveBeenCalledOnce(); expect(load).not.toHaveBeenCalled(); expect(begin).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  });
  it("notifies pending denial before refusing a cancellation's native floor", async () => {
    const repository = guards(), load = vi.spyOn(repository, "load"), order: string[] = [];
    const rpc = vi.fn(async () => ({ data: { profile_id: PROFILE, revision: 4, pending: row }, error: null }));
    const api = createSupabaseAccountDeletionService({ rpc }, repository, nonce, new Set(), async () => { order.push("denial"); }, undefined, () => { order.push("floor"); return false; });
    expect(await api.cancel(REQUEST)).toEqual({ ok: false, error: "unavailable" }); expect(order).toEqual(["floor", "denial"]);
    expect(load).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  });
  it("refuses a non-pending native floor before loading or aborting a guard", async () => {
    const repository = guards(), load = vi.spyOn(repository, "load");
    const rpc = vi.fn(async () => ({ data: { profile_id: PROFILE, revision: 4, pending: null }, error: null }));
    const api = createSupabaseAccountDeletionService({ rpc }, repository, nonce, new Set(), undefined, undefined, () => false);
    expect(await api.getState()).toEqual({ ok: false, error: "unavailable" }); expect(load).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledOnce();
  });
  it("requires native after-control acceptance before resolving a cancelled guard", async () => {
    const repository = guards(), resolve = vi.spyOn(repository, "resolve"); await repository.begin(PROFILE, 4, nonce()); let cancelled = false;
    const rpc = vi.fn(async (name: string) => { if (name === "cancel_my_account_deletion") { cancelled = true; return { data: true, error: null }; } return { data: { profile_id: PROFILE, revision: cancelled ? 5 : 4, pending: cancelled ? null : row }, error: null }; });
    const api = createSupabaseAccountDeletionService({ rpc }, repository, nonce, new Set(), undefined, undefined, () => !cancelled);
    expect(await api.cancel(REQUEST)).toEqual({ ok: false, error: "unavailable" }); expect(resolve).not.toHaveBeenCalled(); expect(await repository.canAdmit(PROFILE)).toBe(false);
  });
  it("calls the native revision hook only after complete sole-parser and Profile validation", async () => {
    const floor = vi.fn(() => true);
    for (const data of [{ profile_id: PROFILE, revision: "4", pending: null }, { profile_id: PROFILE, revision: 4, pending: {} }, { profile_id: PROFILE, revision: 4, pending: { ...row, profile_id: REQUEST } }]) {
      const api = createSupabaseAccountDeletionService({ rpc: async () => ({ data, error: null }) }, guards(), nonce, new Set(), undefined, undefined, floor);
      expect((await api.getState()).ok).toBe(false);
    }
    const api = createSupabaseAccountDeletionService({ rpc: async () => ({ data: { profile_id: PROFILE, revision: 4, pending: null }, error: null }) }, guards(), nonce, new Set(), undefined, () => false, floor);
    expect((await api.getState()).ok).toBe(false); expect(floor).not.toHaveBeenCalled();
  });
  it("binds a deletion request to the expected application Profile", async () => {
    const { api, rpc } = service([row], null, false);
    expect(await api.request(PROFILE, async () => true)).toEqual({ ok: true, value: { requestId: REQUEST, profileId: PROFILE, requestedAt: row.requested_at, finalizeAfter: row.finalize_after } });
    expect(rpc).toHaveBeenCalledWith("request_my_account_deletion", { p_expected_profile_id: PROFILE, p_expected_revision: 0 });
    expect((await api.request(REQUEST)).ok).toBe(false);
  });
  it("refuses malformed, duplicate or incomplete deletion-state responses", async () => {
    for (const data of [null, {}, [row, row], [{ ...row, profile_id: null }], [{ ...row, finalize_after: row.requested_at }]]) {
      expect((await service(data).api.getState()).ok).toBe(false);
    }
    expect(await service([]).api.getState()).toEqual({ ok: true, value: null });
  });
  it("cancels only the exact request, and requires a boolean acknowledgement", async () => {
    const { api, rpc } = service(true);
    expect(await api.cancel(REQUEST)).toEqual({ ok: true, value: true });
    expect(rpc).toHaveBeenCalledWith("cancel_my_account_deletion", { p_expected_request_id: REQUEST });
    expect((await service("true").api.cancel(REQUEST)).ok).toBe(false);
  });
  it("normalizes reauthentication and recovery errors without returning provider details", async () => {
    for (const [prefix, expected] of [["reauthentication_required", "reauthentication_required"], ["recovery_period_ended", "recovery_period_ended"], ["conflict", "account_changed"]]) {
      expect(await service(null, { message: `${prefix}: private details` }).api.request(PROFILE, async () => true)).toEqual({ ok: false, error: expected });
    }
  });
  it("never delivers another Profile's cloud export", async () => {
    expect((await service({ schemaVersion: 1, profile: { id: REQUEST } }).api.exportCloud(PROFILE)).ok).toBe(false);
  });
  it("requires the entire cloud inventory instead of labelling a partial export complete", async () => {
    const complete: Record<string, unknown> = { schemaVersion: 1, profile: { id: PROFILE }, accountId: REQUEST,
      accountEmail: "fixture@example.invalid", exportedAt: "2026-10-24T12:00:00Z", onboarding: {} };
    for (const key of ["legalEvidence", "sportingRecords", "sportingTombstones", "teamResultBundles", "teamResultRevisions",
      "privateNotes", "sharedSessionContext", "memberships", "membershipFunctions", "notifications", "entitlements",
      "deletionRequests", "recordingPermissions", "sessionParticipation", "sessionApprovals",
      "invitations", "adminRequests", "auditHistory", "athleteCapabilities", "teamCreationGrants"]) complete[key] = [];
    expect((await service(complete).api.exportCloud(PROFILE)).ok).toBe(true);
    for (const key of Object.keys(complete)) {
      const partial = { ...complete }; delete partial[key];
      expect((await service(partial).api.exportCloud(PROFILE)).ok).toBe(false);
    }
  });
  it("contains a rejected RPC and a hostile error getter", async () => {
    const rpc = vi.fn(async () => { throw null; });
    const api = createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guards(), nonce);
    expect(await api.getState()).toEqual({ ok: false, error: "unavailable" });
    expect(await service(null, { get message() { throw null; } }).api.getState()).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("durable deletion operation recovery", () => {
  it.each([true, false])("keeps the guard through server commit with acknowledgement=%s", async acknowledged => {
    const guard = guards();
    let finish!: (value: { data: unknown; error: unknown }) => void;
    const wait = new Promise<{ data: unknown; error: unknown }>(resolve => { finish = resolve; });
    let pending = false;
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_my_account_deletion_control") return { data: { profile_id: PROFILE, revision: 0, pending: pending ? row : null }, error: null };
      if (name === "request_my_account_deletion") return wait;
      throw Error("unexpected RPC");
    });
    const api = createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guard, nonce);
    const before = vi.fn(async () => { expect(await guard.canAdmit(PROFILE)).toBe(false); return true; });
    const request = api.request(PROFILE, before);
    await vi.waitFor(() => expect(before).toHaveBeenCalledOnce());
    expect((await api.getState()).ok).toBe(false); // no same-page abort while HTTP is outstanding
    pending = true;
    finish(acknowledged ? { data: [row], error: null } : { data: null, error: { message: "network outcome unknown" } });
    expect((await request).ok).toBe(acknowledged);
    expect(await guard.canAdmit(PROFILE)).toBe(false);
    expect((await api.getState()).ok).toBe(true);
    expect(await guard.canAdmit(PROFILE)).toBe(false);
    expect(rpc.mock.calls.some(([name]) => name === "abort_my_uncommitted_account_deletion")).toBe(false);
  });
  it("requires a server fence, rather than empty status, to recover an interrupted uncommitted request", async () => {
    const guard = guards(); await guard.begin(PROFILE, 0, nonce());
    let abortWorks = false;
    const rpc = vi.fn(async (name: string) => name === "get_my_account_deletion_control"
      ? { data: { profile_id: PROFILE, revision: 0, pending: null }, error: null }
      : { data: abortWorks ? 1 : null, error: abortWorks ? null : { message: "unavailable" } });
    const api = createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guard, nonce);
    expect((await api.getState()).ok).toBe(false);
    expect(await guard.canAdmit(PROFILE)).toBe(false);
    abortWorks = true;
    expect(await api.getState()).toEqual({ ok: true, value: null, recoveredProfileId: PROFILE });
    expect(rpc).toHaveBeenCalledWith("abort_my_uncommitted_account_deletion", { p_expected_profile_id: PROFILE, p_expected_revision: 0 });
    expect(await guard.canAdmit(PROFILE)).toBe(true);
  });
  it("retries a lost conditional-abort acknowledgement by fencing the current revision again", async () => {
    const guard = guards(); await guard.begin(PROFILE, 0, nonce());
    let revision = 0;
    let loseAck = true;
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_my_account_deletion_control") return { data: { profile_id: PROFILE, revision, pending: null }, error: null };
      revision++;
      if (loseAck) { loseAck = false; return { data: null, error: { message: "lost acknowledgement" } }; }
      return { data: revision, error: null };
    });
    const api = createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guard, nonce);
    expect((await api.getState()).ok).toBe(false);
    expect(await guard.canAdmit(PROFILE)).toBe(false);
    expect((await api.getState()).ok).toBe(true);
    expect(await guard.canAdmit(PROFILE)).toBe(true);
    expect(revision).toBe(2);
    expect(rpc).toHaveBeenLastCalledWith("abort_my_uncommitted_account_deletion", { p_expected_profile_id: PROFILE, p_expected_revision: 1 });
  });
  it("never calls the server mutation when durable evidence or the identity transition fails", async () => {
    for (const brokenStore of [true, false]) {
      const guard = brokenStore ? createAccountDeletionGuardRepository({ get: async () => { throw null; }, set: async () => { throw null; } }) : guards();
      const rpc = vi.fn(async () => ({ data: { profile_id: PROFILE, revision: 0, pending: null }, error: null }));
      const api = createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guard, nonce);
      expect((await api.request(PROFILE, async () => false)).ok).toBe(false);
      expect(rpc.mock.calls).toHaveLength(1);
    }
  });
  it("a delayed successful cancellation resolves only the guard captured before it began", async () => {
    const guard = guards(); await guard.begin(PROFILE, 0, nonce());
    let cancelled = false;
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_my_account_deletion_control") return { data: { profile_id: PROFILE, revision: cancelled ? 1 : 0, pending: cancelled ? null : row }, error: null };
      cancelled = true;
      await guard.begin(PROFILE, 1, "40000000-0000-4000-8000-000000000004");
      return { data: true, error: null };
    });
    const api = createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guard, nonce);
    expect(await api.cancel(REQUEST)).toEqual({ ok: true, value: true });
    expect(await guard.canAdmit(PROFILE)).toBe(false);
  });
});

it("retires stale pending observations before any local storage side effect", async () => {
  const guard = guards(); const load = vi.spyOn(guard, "load");
  const rpc = vi.fn(async () => ({ data: { profile_id: PROFILE, revision: 0, pending: row }, error: null }));
  const api = createSupabaseAccountDeletionService({ rpc } as unknown as SupabaseClient, guard, nonce);
  expect(await api.getState(() => false)).toEqual({ ok: false, error: "account_changed" });
  expect(await api.request(PROFILE, async () => true, () => false)).toEqual({ ok: false, error: "account_changed" });
  expect(load).not.toHaveBeenCalled();
});
