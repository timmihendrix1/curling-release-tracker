import type { AccountDeletionPendingObserver, AccountDeletionResult, AccountDeletionService, AccountDeletionState } from "../identity/accountDeletion";
import { isCanonicalUuid } from "../uuid";
import { validDeletionRevision, type AccountDeletionGuardRepository } from "../identity/accountDeletionGuard";
/** Minimal actual RPC result; an async native port does not fabricate the SDK's
 * filter builder. The installed client is structurally compatible. */
export type AccountDeletionRpcPort = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function fail<T>(error?: unknown): AccountDeletionResult<T> {
  try {
    const message = typeof error === "object" && error !== null && "message" in error ? error.message : null;
    if (typeof message === "string") {
      if (message.startsWith("reauthentication_required:")) return { ok: false, error: "reauthentication_required" };
      if (message.startsWith("recovery_period_ended:")) return { ok: false, error: "recovery_period_ended" };
      if (message.startsWith("conflict:")) return { ok: false, error: "account_changed" };
    }
  } catch { /* Native/provider error values never become user copy. */ }
  return { ok: false, error: "unavailable" };
}

function state(value: unknown): AccountDeletionState | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isCanonicalUuid(row.request_id) || !isCanonicalUuid(row.profile_id)
    || typeof row.requested_at !== "string" || typeof row.finalize_after !== "string"
    || !Number.isFinite(Date.parse(row.requested_at))
    || Date.parse(row.finalize_after) - Date.parse(row.requested_at) !== 30 * 24 * 60 * 60 * 1000) return null;
  return { requestId: row.request_id, profileId: row.profile_id, requestedAt: row.requested_at, finalizeAfter: row.finalize_after };
}

export function createSupabaseAccountDeletionService(
  client: AccountDeletionRpcPort, guards: AccountDeletionGuardRepository, newId: () => string,
  // Native per-call ports share only this exclusion set; it grants no authority.
  inFlight: Set<string> = new Set<string>(),
  onCancelPending?: (pending: AccountDeletionState) => Promise<void>,
  // Native original-admission correlation only. The actual sole control parser
  // validates first; omission preserves the Web policy and recovery behavior.
  onNativeControlProfile?: (profileId: string) => boolean,
  // Actual native host checks exact Boolean and owns malformed observed work.
  // A refused floor must not conceal a fully validated definitive pending fact.
  onNativeControlRevision?: (profileId: string, revision: number) => boolean
): AccountDeletionService {
  async function control(): Promise<AccountDeletionResult<{ profileId: string; revision: number; pending: AccountDeletionState | null; effectsAllowed: boolean }>> {
    try {
      const { data, error } = await client.rpc("get_my_account_deletion_control");
      if (error) return fail(error);
      if (!data || typeof data !== "object" || Array.isArray(data)) return fail();
      const row = data as Record<string, unknown>;
      if (!isCanonicalUuid(row.profile_id) || !validDeletionRevision(row.revision)) return fail();
      const pending = row.pending === null ? null : state(row.pending);
      if (row.pending !== null && (!pending || pending.profileId !== row.profile_id)) return fail();
      if (onNativeControlProfile?.(row.profile_id) === false) return fail();
      let effectsAllowed = true;
      if (onNativeControlRevision) { try { effectsAllowed = onNativeControlRevision(row.profile_id, row.revision) === true; } catch { effectsAllowed = false; } }
      return { ok: true, value: { profileId: row.profile_id as string, revision: row.revision, pending, effectsAllowed } };
    } catch { return fail(); }
  }
  async function recordKnownPending(profileId: string, revision: number, pending: AccountDeletionState,
    onPending?: AccountDeletionPendingObserver, effectsAllowed = true): Promise<AccountDeletionResult<AccountDeletionState>> {
    // Definitive denial reaches the identity owner BEFORE possibly unanswered
    // storage I/O. Failed durable evidence cannot turn it into a transient read.
    try { if (onPending?.(pending) === false) return { ok: false, error: "account_changed" }; }
    catch { /* The fact remains definitive. */ }
    if (!effectsAllowed) return { ok: true, value: pending };
    try {
      const local = await guards.load(profileId);
      if (local.status === "absent" || (local.status === "guard" && local.resolved)) {
        await guards.begin(profileId, revision, newId());
      }
    } catch { /* The caller still receives the confirmed pending state. */ }
    return { ok: true as const, value: pending };
  }
  return {
    async getState(onPending) {
      try {
        const status = await control();
        if (!status.ok) return status;
        const { profileId, revision, pending } = status.value;
        if (pending) return await recordKnownPending(profileId, revision, pending, onPending, status.value.effectsAllowed);
        if (!status.value.effectsAllowed) return fail();
        const local = await guards.load(profileId);
        if (local.status === "unavailable") return fail();
        if (local.status === "absent" || local.resolved) return { ok: true, value: null };
        if (inFlight.has(profileId) || revision < local.guard.revision) return fail();
        // Even a NEWER server revision is insufficient: a delayed old slot
        // write may have overwritten a newer operation's guard. Fence the
        // CURRENT revision every time, covering that operation too. A pending
        // committed deletion always refuses this conditional abort.
        const { data, error } = await client.rpc("abort_my_uncommitted_account_deletion", {
          p_expected_profile_id: profileId, p_expected_revision: revision,
        });
        if (error) return fail(error);
        if (!validDeletionRevision(data) || data <= revision) return fail();
        if (!await guards.resolve(local.guard, data)) return fail();
        return { ok: true, value: null, recoveredProfileId: profileId };
      } catch { return fail(); }
    },
    async request(expectedProfileId, beforeMutation, onPending) {
      let claimed = false;
      try {
        if (!isCanonicalUuid(expectedProfileId) || !beforeMutation || inFlight.has(expectedProfileId)) return fail();
        inFlight.add(expectedProfileId);
        claimed = true;
        const status = await control();
        if (!status.ok) return status;
        if (status.value.profileId !== expectedProfileId) return { ok: false, error: "account_changed" };
        if (status.value.pending) return await recordKnownPending(expectedProfileId, status.value.revision, status.value.pending, onPending, status.value.effectsAllowed);
        if (!status.value.effectsAllowed) return fail();
        const guard = await guards.begin(expectedProfileId, status.value.revision, newId());
        if (!guard || !await beforeMutation()) return fail();
        const { data, error } = await client.rpc("request_my_account_deletion", {
          p_expected_profile_id: expectedProfileId, p_expected_revision: guard.revision,
        });
        if (error) return fail(error);
        const parsed = Array.isArray(data) && data.length === 1 ? state(data[0]) : null;
        if (!parsed || parsed.profileId !== expectedProfileId) return fail();
        try { onPending?.(parsed); } catch { /* Definitive pending remains available. */ }
        return { ok: true, value: parsed };
      } catch { return fail(); }
      finally { if (claimed) inFlight.delete(expectedProfileId); }
    },
    async cancel(expectedRequestId) {
      try {
        if (!isCanonicalUuid(expectedRequestId)) return fail();
        const before = await control();
        if (!before.ok) return before;
        // Native composition owns this validated denial even when the caller's
        // request selector is stale. Web has no extra observation hook.
        if (before.value.pending && onCancelPending) await onCancelPending(before.value.pending);
        if (!before.value.effectsAllowed) return fail();
        if (!before.value.pending || before.value.pending.requestId !== expectedRequestId) return { ok: true, value: false };
        const local = await guards.load(before.value.profileId);
        if (local.status === "unavailable") return fail();
        const { data, error } = await client.rpc("cancel_my_account_deletion", { p_expected_request_id: expectedRequestId });
        if (error) return fail(error);
        if (data !== true) return typeof data === "boolean" ? { ok: true, value: data } : fail();
        const after = await control();
        if (!after.ok) return after;
        if (!after.value.effectsAllowed || after.value.profileId !== before.value.profileId || after.value.pending
          || after.value.revision <= before.value.revision) return fail();
        if (local.status === "guard" && !await guards.resolve(local.guard, after.value.revision)) return fail();
        return { ok: true, value: true };
      } catch { return fail(); }
    },
    async exportCloud(expectedProfileId) {
      try {
        if (!isCanonicalUuid(expectedProfileId)) return fail();
        const { data, error } = await client.rpc("get_my_account_export");
        if (error) return fail(error);
        if (typeof data !== "object" || data === null || Array.isArray(data)) return fail();
        const exported = data as Record<string, unknown>;
        if (exported.schemaVersion !== 1 || typeof exported.profile !== "object" || exported.profile === null
          || (exported.profile as Record<string, unknown>).id !== expectedProfileId) return fail();
        const inventories = ["legalEvidence", "sportingRecords", "sportingTombstones", "teamResultBundles",
          "teamResultRevisions", "privateNotes", "sharedSessionContext", "memberships", "membershipFunctions",
          "notifications", "entitlements", "deletionRequests", "recordingPermissions", "sessionParticipation",
          "sessionApprovals", "invitations", "adminRequests", "auditHistory", "athleteCapabilities", "teamCreationGrants"];
        if (!inventories.every(key => Array.isArray(exported[key]))
          || typeof exported.exportedAt !== "string" || !Number.isFinite(Date.parse(exported.exportedAt))
          || !isCanonicalUuid(exported.accountId) || typeof exported.accountEmail !== "string"
          || typeof exported.onboarding !== "object" || exported.onboarding === null) return fail();
        return { ok: true, value: exported };
      } catch { return fail(); }
    },
  };
}
