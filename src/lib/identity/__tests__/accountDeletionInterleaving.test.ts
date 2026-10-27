import { expect, it, vi } from "vitest";
import { createAccountDeletionGuardRepository } from "../accountDeletionGuard";
import { createSupabaseAccountDeletionService } from "../../supabase/supabaseAccountDeletionService";
import { createMemoryStorage, createIdentityHarness, PROFILE_A, IDENTITY_A, PINNED_TERMS, PINNED_PRIVACY } from "./support/identityTestHarness";
const profileId = PROFILE_A;
const oldNonce = '20000000-0000-4000-8000-000000000002';
const liveNonce = '30000000-0000-4000-8000-000000000003';
const row = { request_id: '40000000-0000-4000-8000-000000000004', profile_id: profileId, requested_at: '2026-10-24T12:00:00Z', finalize_after: '2026-11-23T12:00:00Z' };
it('recovery fences a live newer request after a stale third owner overwrites its local guard', async () => {
  const memory = createMemoryStorage();
  const storage = memory.store;
  const guards = createAccountDeletionGuardRepository({ get: async key => ({ status: 'value', value: storage.get(key) ?? null }), set: async (key,value) => { storage.set(key,value); return { ok: true }; } });
  const first = createIdentityHarness({ storage: memory, deletionGuards: guards });
  first.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  first.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId, displayName: 'Athlete', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  first.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
  await first.coordinator.requestEmailOtp('a@example.test');
  await first.coordinator.verifyEmailOtp('a@example.test', '123456');
  let oldControl!: (value: unknown) => void;
  const delayedControl = new Promise(resolve => { oldControl = resolve; });
  let allowLiveRequest!: () => void;
  const liveRequestGate = new Promise<void>(resolve => { allowLiveRequest = resolve; });
  let serverPending = false;
  let revision = 0;
  const oldRpc = vi.fn(async (name: string) => name === 'get_my_account_deletion_control'
    ? delayedControl : { data: null, error: { message: 'conflict: stale request' } });
  const oldApi = createSupabaseAccountDeletionService({ rpc: oldRpc } as never, guards, () => oldNonce);
  // The original caller gets a revision-0 control response delayed in transport.
  const staleStart = oldApi.request(profileId, async () => false);
  await vi.waitFor(() => expect(oldRpc).toHaveBeenCalledOnce());
  // An explicitly cancelled/aborted prior operation advances the server to 1.
  revision = 1;
  const liveRpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'get_my_account_deletion_control') return { data: { profile_id: profileId, revision, pending: serverPending ? row : null }, error: null };
    if (name === 'request_my_account_deletion') {
      await liveRequestGate;
      if (args?.p_expected_revision !== revision) return { data: null, error: { message: 'conflict: superseded request' } };
      serverPending = true; return { data: [row], error: null };
    }
    throw Error('Unexpected RPC');
  });
  const liveApi = createSupabaseAccountDeletionService({ rpc: liveRpc } as never, guards, () => liveNonce);
  const liveRequest = liveApi.request(profileId, async () => (await first.coordinator.invalidateIdentity()).kind === 'identity_invalidated');
  await vi.waitFor(() => expect(liveRpc).toHaveBeenCalledWith('request_my_account_deletion', { p_expected_profile_id: profileId, p_expected_revision: 1 }));
  expect(await guards.canAdmit(profileId)).toBe(false);
  // Stale response overwrites the live revision-1 guard, even though its owner loses identity.
  oldControl({ data: { profile_id: profileId, revision: 0, pending: null }, error: null });
  expect((await staleStart).ok).toBe(false);
  const slot = await guards.load(profileId);
  expect(slot.status === 'guard' && slot.guard.nonce).toBe(oldNonce);
  // Recovery must fence the CURRENT revision, even though the current slot
  // contains an older revision. Otherwise the live request could commit later.
  const recoveryRpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === 'get_my_account_deletion_control') return { data: { profile_id: profileId, revision, pending: serverPending ? row : null }, error: null };
    expect(name).toBe('abort_my_uncommitted_account_deletion');
    expect(args?.p_expected_revision).toBe(revision);
    expect(serverPending).toBe(false);
    revision++;
    return { data: revision, error: null };
  });
  const recover = createSupabaseAccountDeletionService({ rpc: recoveryRpc } as never, guards, () => oldNonce);
  expect((await recover.getState()).ok).toBe(true);
  expect(recoveryRpc).toHaveBeenCalledWith('abort_my_uncommitted_account_deletion', { p_expected_profile_id: profileId, p_expected_revision: 1 });
  expect(await guards.canAdmit(profileId)).toBe(true);
  await first.coordinator.requestEmailOtp('a@example.test');
  const retrusted = await first.coordinator.verifyEmailOtp('a@example.test', '123456');
  expect(retrusted.kind).toBe('resolved');
  if (retrusted.kind === 'resolved') expect(retrusted.gate.kind).toBe('ready_online');
  allowLiveRequest();
  expect((await liveRequest).ok).toBe(false);
  expect(serverPending).toBe(false);
  expect(await guards.canAdmit(profileId)).toBe(true);
  const reload = createIdentityHarness({ storage: memory, deletionGuards: guards });
  reload.fakeAuth.state.restore = { kind: 'temporarily_unavailable' };
  expect((await reload.coordinator.startUp()).verdict.kind).toBe('ready_offline');
});
