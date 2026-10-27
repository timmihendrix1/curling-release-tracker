// @vitest-environment jsdom
import React, { useEffect } from "react";
import { act, cleanup, render, waitFor, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from 'vitest';
import { createIdentityHarness, PROFILE_A, IDENTITY_A, PINNED_TERMS, PINNED_PRIVACY } from "../../../lib/identity/__tests__/support/identityTestHarness";
import IdentityProvider, { useIdentity } from "../IdentityProvider";
vi.mock("../IdentityGateScreen", () => ({ default: () => <Probe /> }));
import type { IdentityProgressListener } from "../../../lib/identity/identityRuntime";
let captured: ReturnType<typeof useIdentity>;
function Probe() { const identity = useIdentity(); useEffect(() => { captured = identity; }, [identity]); return <p>{identity.state.kind}</p>; }
afterEach(cleanup);
it('a stale recovery read cannot supersede a newer OTP transition or reopen the earlier account', async () => {
  const h = createIdentityHarness();
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: 'Athlete A', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  h.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
  await h.coordinator.requestEmailOtp('a@example.test'); await h.coordinator.verifyEmailOtp('a@example.test', '123456');
  const progress = new Set<IdentityProgressListener>();
  const originalPush = h.progressEvents.push.bind(h.progressEvents);
  h.progressEvents.push = (...events) => { for (const e of events) for (const l of progress) l(...e); return originalPush(...events); };
  let settle!: (value: unknown) => void;
  const delayed = new Promise(resolve => { settle = resolve; });
  const getState = vi.fn().mockImplementationOnce(() => delayed).mockResolvedValue({ ok: false, error: 'unavailable' });
  const runtime = { status: 'ready', coordinator: h.coordinator,
    accountDeletion: { getState, request: vi.fn(), cancel: vi.fn(), exportCloud: vi.fn() },
    startUpOnce: () => h.coordinator.startUp(), captureCurrentDeepLinkIntent: async () => ({ kind: 'not_present' }), loadPendingIntent: async () => null,
    subscribeToProgress: (l: IdentityProgressListener) => { progress.add(l); return () => progress.delete(l); }, subscribeToAuthChanges: () => () => {}, subscribeToBarrierChanges: () => () => {},
  };
  render(<IdentityProvider runtime={runtime as never}><Probe /></IdentityProvider>);
  await waitFor(() => expect(captured?.state.kind).toBe('ready_online'));
  await waitFor(() => expect(getState).toHaveBeenCalledOnce());
  await act(async () => { await captured.requestEmailOtp('b@example.test'); });
  expect(captured.state.kind).toBe('awaiting_otp');
  await act(async () => { settle({ ok: true, value: null, recoveredProfileId: PROFILE_A }); });
  expect(captured.state.kind).toBe('awaiting_otp');
  expect(captured.session).toBeNull();
  expect(h.fakeAuth.counts.otpVerify).toBe(1); // no B code was verified
});

it('a stale pending read cannot revoke a newly admitted same-Profile session', async () => {
  const h = createIdentityHarness();
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: 'Athlete A', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  h.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
  await h.coordinator.requestEmailOtp('a@example.test'); await h.coordinator.verifyEmailOtp('a@example.test', '123456');
  const progress = new Set<IdentityProgressListener>();
  const originalPush = h.progressEvents.push.bind(h.progressEvents);
  h.progressEvents.push = (...events) => { for (const e of events) for (const l of progress) l(...e); return originalPush(...events); };
  let settle!: (value: unknown) => void;
  const delayed = new Promise(resolve => { settle = resolve; });
  const getState = vi.fn().mockImplementationOnce(() => delayed).mockResolvedValue({ ok: false, error: 'unavailable' });
  const runtime = { status: 'ready', coordinator: h.coordinator,
    accountDeletion: { getState, request: vi.fn(), cancel: vi.fn(), exportCloud: vi.fn() },
    startUpOnce: () => h.coordinator.startUp(), captureCurrentDeepLinkIntent: async () => ({ kind: 'not_present' }), loadPendingIntent: async () => null,
    subscribeToProgress: (l: IdentityProgressListener) => { progress.add(l); return () => progress.delete(l); }, subscribeToAuthChanges: () => () => {}, subscribeToBarrierChanges: () => () => {},
  };
  render(<IdentityProvider runtime={runtime as never}><Probe /></IdentityProvider>);
  await waitFor(() => expect(captured?.state.kind).toBe('ready_online'));
  await waitFor(() => expect(getState).toHaveBeenCalledOnce());
  await act(async () => { await captured.requestEmailOtp('a@example.test'); });
  await act(async () => { await captured.verifyEmailOtp('123456'); });
  expect(captured.state.kind).toBe('ready_online');
  await act(async () => { settle({ ok: true, value: { requestId: '40000000-0000-4000-8000-000000000004', profileId: PROFILE_A, requestedAt: '2026-10-24T12:00:00Z', finalizeAfter: '2026-11-23T12:00:00Z' } }); });
  expect(captured.state.kind).toBe('ready_online');
  expect(captured.session?.profileId).toBe(PROFILE_A);
  expect(h.fakeAuth.counts.otpVerify).toBe(2); // the fresh A admission remains current
});

it('a delayed deletion confirmation cannot revive after A to B to A reauthentication', async () => {
  const h = createIdentityHarness();
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: 'Athlete A', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  h.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
  await h.coordinator.requestEmailOtp('a@example.test'); await h.coordinator.verifyEmailOtp('a@example.test', '123456');
  const progress = new Set<IdentityProgressListener>();
  const originalPush = h.progressEvents.push.bind(h.progressEvents);
  h.progressEvents.push = (...events) => { for (const e of events) for (const l of progress) l(...e); return originalPush(...events); };
  let releaseRequest!: () => void;
  const requestWait = new Promise<void>(resolve => { releaseRequest = resolve; });
  const request = vi.fn(async (_profile: string, beforeMutation?: () => Promise<boolean>) => { await requestWait; return { ok: false, error: await beforeMutation?.() ? 'unexpected_mutation' : 'account_changed' }; });
  const getState = vi.fn().mockResolvedValue({ ok: false, error: 'unavailable' });
  const runtime = { status: 'ready', coordinator: h.coordinator,
    accountDeletion: { getState, request, cancel: vi.fn(), exportCloud: vi.fn() },
    startUpOnce: () => h.coordinator.startUp(), captureCurrentDeepLinkIntent: async () => ({ kind: 'not_present' }), loadPendingIntent: async () => null,
    subscribeToProgress: (l: IdentityProgressListener) => { progress.add(l); return () => progress.delete(l); }, subscribeToAuthChanges: () => () => {}, subscribeToBarrierChanges: () => () => {},
  };
  render(<IdentityProvider runtime={runtime as never}><Probe /></IdentityProvider>);
  await waitFor(() => expect(captured?.state.kind).toBe('ready_online'));
  await waitFor(() => expect(getState).toHaveBeenCalledOnce());
  const ownerActions = captured;
  let deletion!: ReturnType<NonNullable<typeof captured.accountDeletion>["request"]>;
  await act(async () => { deletion = ownerActions.accountDeletion!.request(PROFILE_A); });
  const profileB = '50000000-0000-4000-8000-000000000005';
  const identityB = { accountScopeId: 'account-b', email: 'b@example.test' };
  h.identityBackend.accounts.set(identityB.accountScopeId, { profileId: profileB, displayName: 'Athlete B', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  for (const identity of [identityB, IDENTITY_A]) {
    h.identityBackend.currentAccountScopeId = identity.accountScopeId;
    h.fakeAuth.state.restore = { kind: 'authenticated', identity };
    h.fakeAuth.state.otpVerify = { ok: true, value: identity };
    await act(async () => { await captured.requestEmailOtp(identity.email!); });
    await act(async () => { await captured.verifyEmailOtp('123456'); });
    expect(captured.state.kind).toBe('ready_online');
  }
  await act(async () => { releaseRequest(); expect(await deletion).toEqual({ ok: false, error: 'account_changed' }); });
  expect(captured.state.kind).toBe('ready_online');
  expect(captured.session?.profileId).toBe(PROFILE_A);
});

it('foreground OTP retires an old pending observer before React flushes the same batched event', async () => {
  const h = createIdentityHarness();
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: 'Athlete A', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  h.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
  await h.coordinator.requestEmailOtp('a@example.test'); await h.coordinator.verifyEmailOtp('a@example.test', '123456');
  const progress = new Set<IdentityProgressListener>();
  const originalPush = h.progressEvents.push.bind(h.progressEvents);
  h.progressEvents.push = (...events) => { for (const e of events) for (const l of progress) l(...e); return originalPush(...events); };
  let settle!: (value: unknown) => void;
  const delayed = new Promise(resolve => { settle = resolve; });
  const getState = vi.fn().mockImplementationOnce(() => delayed).mockResolvedValue({ ok: false, error: 'unavailable' });
  const runtime = { status: 'ready', coordinator: h.coordinator,
    accountDeletion: { getState, request: vi.fn(), cancel: vi.fn(), exportCloud: vi.fn() },
    startUpOnce: () => h.coordinator.startUp(), captureCurrentDeepLinkIntent: async () => ({ kind: 'not_present' }), loadPendingIntent: async () => null,
    subscribeToProgress: (l: IdentityProgressListener) => { progress.add(l); return () => progress.delete(l); }, subscribeToAuthChanges: () => () => {}, subscribeToBarrierChanges: () => () => {},
  };
  render(<IdentityProvider runtime={runtime as never}><Probe /></IdentityProvider>);
  await waitFor(() => expect(captured?.state.kind).toBe('ready_online'));
  await waitFor(() => expect(getState).toHaveBeenCalledOnce());
  await act(async () => {
    const newer = captured.requestEmailOtp('b@example.test');
    settle({ ok: true, value: { requestId: '40000000-0000-4000-8000-000000000004', profileId: PROFILE_A, requestedAt: '2026-10-24T12:00:00Z', finalizeAfter: '2026-11-23T12:00:00Z' } });
    await newer;
  });
  expect(captured.state.kind).toBe('awaiting_otp');
  expect(captured.session).toBeNull();
  expect(h.fakeAuth.counts.otpVerify).toBe(1); // no B code was verified
});

it('late cancellation success cannot resume A during a newer B OTP', async () => {
 const h = createIdentityHarness();
 h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
 h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: 'Athlete A', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
 h.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
 await h.coordinator.requestEmailOtp('a@example.test'); await h.coordinator.verifyEmailOtp('a@example.test', '123456');
 const progress = new Set<IdentityProgressListener>(); const originalPush = h.progressEvents.push.bind(h.progressEvents);
 h.progressEvents.push = (...events) => { for (const e of events) for (const l of progress) l(...e); return originalPush(...events); };
 const pending = {requestId:'40000000-0000-4000-8000-000000000004',profileId:PROFILE_A,requestedAt:'2026-10-24T12:00:00Z',finalizeAfter:'2026-11-23T12:00:00Z'};
 let release!: (value: unknown)=>void; const cancel = vi.fn(()=>new Promise(resolve=>{release=resolve;}));
 const getState=vi.fn().mockResolvedValue({ok:true,value:pending});
 const runtime={status:'ready',coordinator:h.coordinator,accountDeletion:{getState,request:vi.fn(),cancel,exportCloud:vi.fn()},
 startUpOnce:()=>h.coordinator.startUp(),captureCurrentDeepLinkIntent:async()=>({kind:'not_present'}),loadPendingIntent:async()=>null,
 subscribeToProgress:(l:IdentityProgressListener)=>{progress.add(l);return()=>progress.delete(l);},subscribeToAuthChanges:()=>()=>{},subscribeToBarrierChanges:()=>()=>{}};
 render(<IdentityProvider runtime={runtime as never}><Probe/></IdentityProvider>);
 await screen.findByRole('button',{name:'Keep my account'});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Keep my account'}));});
 expect(cancel).toHaveBeenCalledOnce();
 await act(async()=>{await captured.requestEmailOtp('b@example.test');});
 expect(captured.state.kind).toBe('awaiting_otp');
 getState.mockResolvedValue({ok:true,value:null});
 await act(async()=>{release({ok:true,value:true});});
 await waitFor(()=>expect(captured.state.kind).toBe('awaiting_otp'));
 expect(captured.session).toBeNull();
 expect(h.fakeAuth.counts.otpVerify).toBe(1);
});

it('cancellation claims its continuation before a queued newer OTP, which then supersedes it', async () => {
 const h = createIdentityHarness();
 h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
 h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: 'Athlete A', onboardingCompletedAt: '2026-02-01T09:00:00.000Z', hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
 h.fakeAuth.state.restore = { kind: 'authenticated', identity: IDENTITY_A };
 await h.coordinator.requestEmailOtp('a@example.test'); await h.coordinator.verifyEmailOtp('a@example.test', '123456');
 const progress = new Set<IdentityProgressListener>(); const originalPush = h.progressEvents.push.bind(h.progressEvents);
 h.progressEvents.push = (...events) => { for (const e of events) for (const l of progress) l(...e); return originalPush(...events); };
 const pending = {requestId:'40000000-0000-4000-8000-000000000004',profileId:PROFILE_A,requestedAt:'2026-10-24T12:00:00Z',finalizeAfter:'2026-11-23T12:00:00Z'};
 let release!: (value: unknown)=>void; const cancel = vi.fn(()=>new Promise(resolve=>{release=resolve;}));
 const getState=vi.fn().mockResolvedValue({ok:true,value:pending});
 const runtime={status:'ready',coordinator:h.coordinator,accountDeletion:{getState,request:vi.fn(),cancel,exportCloud:vi.fn()},
 startUpOnce:()=>h.coordinator.startUp(),captureCurrentDeepLinkIntent:async()=>({kind:'not_present'}),loadPendingIntent:async()=>null,
 subscribeToProgress:(l:IdentityProgressListener)=>{progress.add(l);return()=>progress.delete(l);},subscribeToAuthChanges:()=>()=>{},subscribeToBarrierChanges:()=>()=>{}};
 render(<IdentityProvider runtime={runtime as never}><Probe/></IdentityProvider>);
 await screen.findByRole('button',{name:'Keep my account'});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Keep my account'}));});
 expect(cancel).toHaveBeenCalledOnce();
 getState.mockResolvedValue({ok:true,value:null});
 await act(async()=>{release({ok:true,value:true}); queueMicrotask(()=>{void captured.requestEmailOtp('b@example.test');});});
 await waitFor(()=>expect(captured.state.kind).toBe('awaiting_otp'));
 expect(captured.session).toBeNull();
 expect(h.fakeAuth.counts.otpVerify).toBe(1);
});
