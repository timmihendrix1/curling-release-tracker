// @vitest-environment jsdom
import React, { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from 'vitest';
import { createIdentityHarness, PROFILE_A, IDENTITY_A, PINNED_TERMS, PINNED_PRIVACY, STORAGE_KEYS } from "../../../lib/identity/__tests__/support/identityTestHarness";
import { createAccountDeletionGuardRepository } from "../../../lib/identity/accountDeletionGuard";
import { createSupabaseAccountDeletionService } from "../../../lib/supabase/supabaseAccountDeletionService";
import IdentityProvider, { useIdentity } from "../IdentityProvider";
vi.mock("../IdentityGateScreen", () => ({ default: () => <Probe /> }));
import type { IdentityProgressListener } from "../../../lib/identity/identityRuntime";
let captured: ReturnType<typeof useIdentity>;
function Probe() { const identity = useIdentity(); useEffect(() => { captured = identity; }, [identity]); return <p>{identity.state.kind}</p>; }
afterEach(cleanup);
it.each(['missing', 'resolved', 'unreadable', 'unanswered'] as const)('known pending unmounts the shell before failed/unanswered guard I/O: %s', async mode => {
  let learned = false;
  const values = new Map<string, string>();
  const guards = createAccountDeletionGuardRepository({
    get: async key => {
      if (learned && mode === 'unanswered') return new Promise(() => {});
      if (learned && mode === 'unreadable') return { status: 'read_failed', fallback: null, error: { kind: 'storage_unavailable' } };
      return { status: 'value', value: values.get(key) ?? null };
    },
    set: async (key, value) => {
      if (learned) return { ok: false, error: { kind: 'quota_exceeded' } };
      values.set(key, value); return { ok: true };
    },
  });
  if (mode === 'resolved') {
    const earlier = await guards.begin(PROFILE_A, 0, '20000000-0000-4000-8000-000000000002');
    await guards.resolve(earlier!, 1);
  }
  const h = createIdentityHarness({ deletionGuards: guards });
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: 'Athlete A', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  h.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
  await h.coordinator.requestEmailOtp('a@example.test'); await h.coordinator.verifyEmailOtp('a@example.test', '123456');
  const invalidate = vi.spyOn(h.coordinator, 'invalidateIdentity');
  const progress = new Set<IdentityProgressListener>();
  const originalPush = h.progressEvents.push.bind(h.progressEvents);
  h.progressEvents.push = (...events) => { for (const e of events) for (const l of progress) l(...e); return originalPush(...events); };
  const rpc = vi.fn(async () => { learned = true; return ({ data: { profile_id: PROFILE_A, revision: 0, pending: { request_id: '40000000-0000-4000-8000-000000000004', profile_id: PROFILE_A, requested_at: '2026-10-24T12:00:00Z', finalize_after: '2026-11-23T12:00:00Z' } }, error: null }); });
  const deletion = createSupabaseAccountDeletionService({ rpc } as never, guards, () => '30000000-0000-4000-8000-000000000003');
  const runtime = { status: 'ready', coordinator: h.coordinator, accountDeletion: deletion,
    startUpOnce: () => h.coordinator.startUp(), captureCurrentDeepLinkIntent: async () => ({ kind: 'not_present' }), loadPendingIntent: async () => null,
    subscribeToProgress: (l: IdentityProgressListener) => { progress.add(l); return () => progress.delete(l); }, subscribeToAuthChanges: () => () => {}, subscribeToBarrierChanges: () => () => {},
  };
  render(<IdentityProvider runtime={runtime as never}><Probe /></IdentityProvider>);
  await waitFor(() => expect(rpc).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByText('ready_online')).toBeNull());
  await waitFor(() => expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false));
  if (mode !== 'unanswered') await act(async () => { expect((await captured.accountDeletion!.getState()).ok).toBe(true); });
  expect(screen.queryByText('ready_online')).toBeNull();
  expect(invalidate).toHaveBeenCalled();
});
