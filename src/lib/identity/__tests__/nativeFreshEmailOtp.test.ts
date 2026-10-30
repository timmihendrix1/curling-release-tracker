import { expect, it, vi } from "vitest";
import { createFakeIdentityService, programIdentityFailure } from "../fakeIdentityService";
import { isNativeFreshEmailOtpSource, readNativeFreshEmailOtp, type NativeIdentityOwnership, type TransitionIdentity } from "../identityTransitionCoordinator";
import { createIdentityHarness, IDENTITY_A, IDENTITY_B, COMPLETE_LEGAL_ROWS, PROFILE_A, PINNED_TERMS, PINNED_PRIVACY, STORAGE_KEYS, FIXED_NOW, holdStorageCall, type IdentityHarness } from "./support/identityTestHarness";
import type { IdentityService } from "../identityService";
import { requiredLegalDocuments, type CompleteOnboardingInput } from "../legalSnapshot";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createPendingIntent } from "../pendingIntentRepository";
import { identityOk } from "../errors";
const email = "synthetic@example.invalid";
function fixture(options: { source?: (source: object) => unknown; event?: (event: object) => unknown; omit?: "source" | "event" | "work"; online?: boolean; identity?: Partial<IdentityService> } = {}) {
  const sources: object[] = [], events: object[] = [], work = vi.fn(); let close!: () => TransitionIdentity, healthy = true;
  const ownership: NativeIdentityOwnership = {
    ...(options.online ? { freshEmailOtpOnline: true as const } : {}),
    bind: () => ({ auth: h.fakeAuth.auth, identity: () => ({ ...createFakeIdentityService(h.identityBackend), ...options.identity }), takeAuthObservation: () => null }),
    admissionAllowed: () => healthy, ownStartup() {}, ownClose(value) { close = value; },
    ownFreshEmailOtpSource(value) { sources.push(value); return options.source?.(value) as void; },
    ownFreshEmailOtp(value) { events.push(value); return options.event?.(value) as void; }, retainFreshEmailOtpWork: work,
  };
  if (options.omit === "source") delete (ownership as { ownFreshEmailOtpSource?: unknown }).ownFreshEmailOtpSource;
  if (options.omit === "event") delete (ownership as { ownFreshEmailOtp?: unknown }).ownFreshEmailOtp;
  if (options.omit === "work") delete (ownership as { retainFreshEmailOtpWork?: unknown }).retainFreshEmailOtpWork;
  const h: IdentityHarness = createIdentityHarness({ nativeOwnership: ownership, now: () => FIXED_NOW });
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: "Synthetic", onboardingCompletedAt: FIXED_NOW,
    hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  const verify = async () => { expect((await h.coordinator.requestEmailOtp(email)).kind).toBe("otp_requested"); return h.coordinator.verifyEmailOtp(email, "123456"); };
  return { ...h, verify, sources, events, work, close: () => close(), unhealthy: () => { healthy = false; } };
}
it("mints an opaque proof only after actual complete OTP/online/trusted writes, with exact source and facts", async () => {
  const h = fixture(); expect(h.sources).toHaveLength(1); expect(isNativeFreshEmailOtpSource(h.sources[0])).toBe(true);
  expect(await h.verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } }); expect(h.events).toHaveLength(1);
  const event = h.events[0], facts = readNativeFreshEmailOtp(event)!;
  expect(Object.getPrototypeOf(event)).toBeNull(); expect(Object.keys(event)).toEqual([]); expect(Object.isFrozen(event)).toBe(true);
  expect(facts).toMatchObject({ source: h.sources[0], accountScopeId: IDENTITY_A.accountScopeId, profileId: PROFILE_A, identityGeneration: h.liveGeneration.current() });
  expect(facts.current()).toBe(true); expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  for (const fake of [{}, { ...event }, Object.create(event), new Proxy(event, { get() { throw null; }, getPrototypeOf() { throw null; } })]) expect(readNativeFreshEmailOtp(fake)).toBeNull();
  for (const fake of [{}, { ...h.sources[0] }, new Proxy(h.sources[0], { get() { throw null; } })]) expect(isNativeFreshEmailOtpSource(fake)).toBe(false);
});
it("preserves same-scope optimistic ready_online without manufacturing complete online/write evidence", async () => {
  const h = fixture(); await h.verify(); const before = h.log.filter(x => x.startsWith("identity:")).length;
  expect(await h.verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  expect(h.events).toHaveLength(1); expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(false);
  expect(h.log.filter(x => x.startsWith("identity:"))).toHaveLength(before);
});
it.each(["background", "otp", "signout", "close", "epoch", "health"] as const)("revokes synchronously at %s, before asynchronous work", async kind => {
  const h = fixture(); await h.verify(); const facts = readNativeFreshEmailOtp(h.events[0])!;
  let pending: Promise<unknown> | null = null;
  if (kind === "background") pending = h.coordinator.revalidateGateFacts();
  if (kind === "otp") pending = h.coordinator.requestEmailOtp(email);
  if (kind === "signout") pending = h.coordinator.signOut();
  if (kind === "close") h.close();
  if (kind === "epoch") h.liveGeneration.bump();
  if (kind === "health") h.unhealthy();
  expect(facts.current()).toBe(false); await pending;
});
it.each(["source", "event", "work"] as const)("old ownership without %s hook retains ordinary outcomes and no proof channel", async omit => {
  const h = fixture({ omit }); expect(await h.verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } }); expect(h.events).toEqual([]); expect(h.sources).toEqual([]);
});
it.each(["source", "event"] as const)("contains throwing %s observer, disables proof, and preserves ordinary auth", async at => {
  const h = fixture({ [at]: () => { throw new Proxy({}, { get() { throw Error("Must not inspect reason"); } }); } });
  expect(await h.verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  if (h.events.length) expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(false);
  h.storage.store.delete(STORAGE_KEYS.trusted); await h.verify(); expect(h.events.length).toBe(at === "source" ? 0 : 1);
});
it.each(["source", "event"] as const)("requires exact-void %s completion and hands observed malformed work to host ownership", async at => {
  const bad = Promise.resolve(undefined), h = fixture({ [at]: () => bad });
  expect(await h.verify()).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } }); expect(h.work).toHaveBeenCalledExactlyOnceWith(bad);
  if (h.events.length) expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(false);
});
it.each(["background", "close"] as const)("reentrant %s during delivery retires even a partially observed proof", async kind => {
  let pending: Promise<unknown> | null = null;
  const h = fixture({ event: () => { if (kind === "close") h.close(); else pending = h.coordinator.revalidateGateFacts(); } });
  await h.verify(); expect(h.events).toHaveLength(1); expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(false); await pending;
});
it.each(["provider", "trusted", "intent", "profile", "onboarding", "c6", "c7", "health"] as const)("never mints on incomplete %s evidence", async at => {
  const h = fixture();
  expect((await h.coordinator.requestEmailOtp(email)).kind).toBe("otp_requested");
  if (at === "provider") h.fakeAuth.state.otpVerify = { ok: false, error: { kind: "temporarily_unavailable", message: "Synthetic unavailable" } };
  if (at === "trusted") h.storage.failWrites.add(STORAGE_KEYS.trusted);
  if (at === "intent") h.storage.failReads.add(STORAGE_KEYS.intent);
  if (at === "profile") h.identityBackend.accounts.get(IDENTITY_A.accountScopeId)!.profileId = "invalid";
  if (at === "onboarding") h.identityBackend.accounts.get(IDENTITY_A.accountScopeId)!.onboardingCompletedAt = null;
  if (at === "health") h.unhealthy();
  if (at === "c6") h.fakeAuth.auth.verifyEmailOtp = async () => { h.storage.store.delete(STORAGE_KEYS.attempt); return h.fakeAuth.state.otpVerify; };
  if (at === "c7") h.storage.failWrites.add(STORAGE_KEYS.resolutionFor(JSON.parse(h.storage.store.get(STORAGE_KEYS.barrier)!).barrierId));
  await h.coordinator.verifyEmailOtp(email, "123456"); expect(h.events).toEqual([]);
});
it("supersedes an older verify of the exact same durable attempt", async () => {
  const h = fixture(); await h.coordinator.requestEmailOtp(email);
  const hold = holdStorageCall(h.storage, `set:${STORAGE_KEYS.trusted}`), older = h.coordinator.verifyEmailOtp(email, "123456"); await hold.reached;
  const newer = h.coordinator.verifyEmailOtp(email, "123456"); hold.release(); await older; await newer;
  expect(h.events.length).toBeLessThanOrEqual(1); if (h.events.length) expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(true);
});
it("startup, retry, background and auth-change classification never mint, including ready outcomes", async () => {
  const h = fixture(); await h.verify(); const count = h.events.length;
  await h.coordinator.startUp(); await h.coordinator.retryTrustedStateEstablishment(); await h.coordinator.revalidateGateFacts();
  h.coordinator.classifyAuthChange({ reason: "signed_in", identity: IDENTITY_A });
  expect(h.events).toHaveLength(count);
});

function bare(h: ReturnType<typeof fixture>, scope = IDENTITY_A.accountScopeId, profileId = PROFILE_A) {
  h.identityBackend.currentAccountScopeId = scope;
  h.identityBackend.accounts.set(scope, { profileId, displayName: null, onboardingCompletedAt: null, hasAthleteCapability: false, freeEntitlementActive: false, pinnedTerms: null, pinnedPrivacy: null });
  h.fakeAuth.state.restore = { kind: "authenticated", identity: scope === IDENTITY_A.accountScopeId ? IDENTITY_A : IDENTITY_B };
}
async function legalInput(h: ReturnType<typeof fixture>): Promise<CompleteOnboardingInput> {
  const legal = await h.coordinator.refreshLegalSnapshot(); expect(legal.kind).toBe("refreshed");
  if (legal.kind !== "refreshed") throw null; const documents = requiredLegalDocuments(legal.legal); if (!documents) throw null;
  return { displayName: "Synthetic Athlete", ...documents };
}
function trusted(h: ReturnType<typeof fixture>, scope = IDENTITY_A.accountScopeId) {
  h.storage.seed(STORAGE_KEYS.trusted, createTrustedDeviceRecord({ accountScopeId: scope, profileId: PROFILE_A, displayName: "Synthetic Previous", onboardingCompletedAt: FIXED_NOW, generation: 1, establishedAt: FIXED_NOW, lastServerConfirmationAt: FIXED_NOW }));
}
it("opted-in returning trusted OTP performs actual online Profile/gate/write work and yields a new proof", async () => {
  const h = fixture({ online: true }); await h.verify(); const before = h.identityBackend.calls.length;
  await h.verify(); expect(h.events).toHaveLength(2); expect(h.identityBackend.calls.slice(before)).toContain("ensureProfile"); expect(h.identityBackend.calls.slice(before)).toContain("resolveGateFacts");
  expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(false); expect(readNativeFreshEmailOtp(h.events[1])!.current()).toBe(true);
});
it("only a genuine unfinished OTP can finish through actual onboarding without another email code", async () => {
  const h = fixture({ online: true }); bare(h); expect(await h.verify()).toMatchObject({ kind: "resolved", gate: { kind: "onboarding_required" } }); expect(h.events).toHaveLength(0);
  expect(await h.coordinator.submitOnboarding(await legalInput(h))).toMatchObject({ kind: "completed", gate: { kind: "ready_online" } });
  expect(h.fakeAuth.counts.otpRequest).toBe(1); expect(h.fakeAuth.counts.otpVerify).toBe(1); expect(h.events).toHaveLength(1); expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(true);
});
it.each(["missing_terms", "missing_privacy", "network"] as const)("retains the same incomplete-Profile OTP origin through initial legal %s and later recovery", async at => {
  const h = fixture({ online: true }); bare(h); await h.coordinator.requestEmailOtp(email);
  if (at === "network") h.identityBackend.legalRpcFailure = "network_error";
  else h.identityBackend.legalRows = COMPLETE_LEGAL_ROWS.filter(row => row.kind !== (at === "missing_terms" ? "terms_of_service" : "privacy_notice"));
  const outcome = await h.coordinator.verifyEmailOtp(email, "123456"); expect(outcome.kind).toBe("resolved"); expect(h.events).toHaveLength(0);
  h.identityBackend.legalRows = COMPLETE_LEGAL_ROWS; h.identityBackend.legalRpcFailure = null;
  expect(await h.coordinator.submitOnboarding(await legalInput(h))).toMatchObject({ kind: "completed" }); expect(h.events).toHaveLength(1); expect(h.fakeAuth.counts.otpVerify).toBe(1);
});
it.each(["stale_legal_version", "invalid_input", "network_error", "legal_unavailable"] as const)("retains only the same proven lineage through %s submission retry", async error => {
  const h = fixture({ online: true }); bare(h); await h.verify(); const input = await legalInput(h);
  programIdentityFailure(h.identityBackend, "completeOnboarding", error);
  expect((await h.coordinator.submitOnboarding(input)).kind).not.toBe("completed"); expect(h.events).toHaveLength(0);
  expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "completed" }); expect(h.events).toHaveLength(1); expect(h.fakeAuth.counts.otpVerify).toBe(1);
});
it.each(["none", "startup", "background", "retry", "epoch", "close", "new_otp"] as const)("onboarding after %s has no reconstructable OTP origin", async at => {
  const h = fixture({ online: true }); bare(h);
  if (at !== "none") await h.verify();
  const input = await legalInput(h);
  if (at === "startup") await h.coordinator.startUp();
  if (at === "background") await h.coordinator.revalidateGateFacts();
  if (at === "retry") await h.coordinator.retryTrustedStateEstablishment();
  if (at === "epoch") h.liveGeneration.bump();
  if (at === "close") h.close();
  if (at === "new_otp") await h.coordinator.requestEmailOtp(email);
  await h.coordinator.submitOnboarding(input); expect(h.events).toHaveLength(0);
});
it.each(["barrier", "attempt", "resolution"] as const)("refuses changed original %s bytes before the linked completion RPC", async at => {
  const h = fixture({ online: true }); bare(h); await h.verify(); const input = await legalInput(h), barrier = JSON.parse(h.storage.store.get(STORAGE_KEYS.barrier)!);
  const key = at === "barrier" ? STORAGE_KEYS.barrier : at === "attempt" ? STORAGE_KEYS.attempt : STORAGE_KEYS.resolutionFor(barrier.barrierId);
  const raw = JSON.parse(h.storage.store.get(key)!); raw[at === "barrier" ? "establishedAt" : at === "attempt" ? "startedAt" : "resolvedAt"] = "2026-03-02T00:00:00.000Z"; h.storage.seed(key, raw);
  const before = h.identityBackend.calls.filter(call => call === "completeOnboarding").length;
  expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "temporarily_unavailable" }); expect(h.events).toHaveLength(0);
  expect(h.identityBackend.calls.filter(call => call === "completeOnboarding")).toHaveLength(before);
});
it("refuses a different completion Profile even for the same verified account", async () => {
  const overrides: Partial<IdentityService> = {}, h = fixture({ online: true, identity: overrides }); bare(h); await h.verify(); const input = await legalInput(h);
  overrides.completeOnboarding = async value => { const result = await createFakeIdentityService(h.identityBackend).completeOnboarding(value); return result.ok ? identityOk({ ...result.value, profileId: "cccccccc-2222-4222-8222-cccccccccccc" }) : result; };
  expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "submission_failed" }); expect(h.events).toHaveLength(0); expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
});
it("denies a changed starting account before linked onboarding writes", async () => {
  const h = fixture({ online: true }); bare(h); await h.verify(); const input = await legalInput(h); h.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
  expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "identity_changed" }); expect(h.events).toHaveLength(0); expect(h.identityBackend.calls).not.toContain("completeOnboarding");
});
async function switched() {
  const h = fixture({ online: true }); trusted(h); bare(h, IDENTITY_B.accountScopeId, "cccccccc-2222-4222-8222-cccccccccccc"); h.fakeAuth.state.otpVerify = { ok: true, value: IDENTITY_B };
  h.storage.seed(STORAGE_KEYS.intent, createPendingIntent({ kind: "invitation", value: "synthetic-original-account-invitation", capturedAt: FIXED_NOW })); await h.verify();
  return { h, input: await legalInput(h) };
}
it("carries the actual previous-account cleanup obligation through incomplete Profile and clears before trusted success", async () => {
  const { h, input } = await switched(); expect(h.storage.store.has(STORAGE_KEYS.intent)).toBe(true); const before = h.log.length;
  expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "completed" }); expect(h.events).toHaveLength(1); expect(h.storage.store.has(STORAGE_KEYS.intent)).toBe(false);
  const log = h.log.slice(before); expect(log.indexOf(`storage:remove:${STORAGE_KEYS.intent}`)).toBeLessThan(log.indexOf(`storage:set:${STORAGE_KEYS.trusted}`));
});
it("failed account-switch cleanup blocks trusted/proof; the same genuine lineage can retry cleanup", async () => {
  const { h, input } = await switched(); h.storage.failRemoves.add(STORAGE_KEYS.intent);
  expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "intent_state_not_persisted" }); expect(h.events).toHaveLength(0); expect(JSON.parse(h.storage.store.get(STORAGE_KEYS.trusted)!).accountScopeId).toBe(IDENTITY_A.accountScopeId);
  h.storage.failRemoves.clear(); expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "completed" }); expect(h.events).toHaveLength(1);
});
it.each(["first", "same", "recovery"] as const)("preserves %s-account/bounded recovery invitation rules", async at => {
  const h = fixture({ online: true }); bare(h); if (at === "same") trusted(h);
  if (at === "recovery") { trusted(h, IDENTITY_B.accountScopeId); }
  h.storage.seed(STORAGE_KEYS.intent, createPendingIntent({ kind: "invitation", value: "synthetic-retained-invitation", capturedAt: FIXED_NOW, survival: at === "recovery" ? "invitation_account_recovery" : "ordinary" }));
  await h.verify(); expect(await h.coordinator.submitOnboarding(await legalInput(h))).toMatchObject({ kind: "completed" }); expect(h.events).toHaveLength(1); expect(h.storage.store.has(STORAGE_KEYS.intent)).toBe(true);
  expect(JSON.parse(h.storage.store.get(STORAGE_KEYS.intent)!).survival).toBe("ordinary");
});
it("a newer onboarding owns the carried lineage while the older cleanup drains", async () => {
  const { h, input } = await switched(), hold = holdStorageCall(h.storage, `remove:${STORAGE_KEYS.intent}`);
  const old = h.coordinator.submitOnboarding(input); await hold.reached; const newer = h.coordinator.submitOnboarding(input); hold.release();
  expect(await old).toMatchObject({ kind: "temporarily_unavailable" }); expect(await newer).toMatchObject({ kind: "completed" }); expect(h.events).toHaveLength(1); expect(readNativeFreshEmailOtp(h.events[0])!.current()).toBe(true);
});
it.each(["rpc", "trusted"] as const)("rechecks the original resolution after actual %s effects before proof", async at => {
  const overrides: Partial<IdentityService> = {}, h = fixture({ online: true, identity: overrides }); bare(h); await h.verify(); const input = await legalInput(h);
  const barrier = JSON.parse(h.storage.store.get(STORAGE_KEYS.barrier)!), key = STORAGE_KEYS.resolutionFor(barrier.barrierId);
  const drift = () => { const raw = JSON.parse(h.storage.store.get(key)!); raw.resolvedAt = "2026-03-02T00:00:00.000Z"; h.storage.seed(key, raw); };
  if (at === "rpc") overrides.completeOnboarding = async value => { const result = await createFakeIdentityService(h.identityBackend).completeOnboarding(value); drift(); return result; };
  else h.storage.onBeforeCall = call => { if (call === `set:${STORAGE_KEYS.trusted}`) drift(); };
  expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "temporarily_unavailable" }); expect(h.events).toHaveLength(0);
});
it("close during actual onboarding completion revokes lineage before any late response", async () => {
  const overrides: Partial<IdentityService> = {}, h = fixture({ online: true, identity: overrides }); bare(h); await h.verify(); const input = await legalInput(h);
  let release!: () => void, entered!: () => void; const hold = new Promise<void>(r => { release = r; }), at = new Promise<void>(r => { entered = r; });
  overrides.completeOnboarding = async value => { entered(); await hold; return createFakeIdentityService(h.identityBackend).completeOnboarding(value); };
  const completing = h.coordinator.submitOnboarding(input); await at; h.close(); release();
  expect((await completing).kind).not.toBe("completed"); expect(h.events).toHaveLength(0); expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
});
it.each((["before", "after"] as const).flatMap(at => (["invalid_session", "changed_account"] as const).map(response => ({ at, response }))))("stale $at $response cannot erase younger provenance", async ({ at, response }) => {
    const h = fixture({ online: true }); bare(h); await h.verify(); const input = await legalInput(h); let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(r => { enter = r; }), hold = new Promise<void>(r => { release = r; }), restore = h.fakeAuth.auth.restoreSession; let count = 0;
    h.fakeAuth.auth.restoreSession = async () => { if (++count === (at === "before" ? 1 : 2)) { enter(); await hold; return response === "invalid_session" ? { kind: "invalid_session" } : { kind: "authenticated", identity: IDENTITY_B }; } return restore(); };
    const old = h.coordinator.submitOnboarding(input); await entered; programIdentityFailure(h.identityBackend, "completeOnboarding", "network_error");
    expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "temporarily_unavailable" }); release(); expect((await old).kind).not.toBe("completed");
    expect(await h.coordinator.submitOnboarding(input)).toMatchObject({ kind: "completed" }); expect(h.events).toHaveLength(1); expect(h.fakeAuth.counts.otpVerify).toBe(1);
});
it.each(["no_session", "invalid_session", "changed_account", "changed_profile"] as const)("current-owner %s genuinely retires its own origin", async at => {
  const overrides: Partial<IdentityService> = {}, h = fixture({ online: true, identity: overrides }); bare(h); await h.verify(); const input = await legalInput(h);
  if (at === "no_session" || at === "invalid_session") h.fakeAuth.state.restore = { kind: at };
  if (at === "changed_account") h.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
  if (at === "changed_profile") overrides.completeOnboarding = async value => { const result = await createFakeIdentityService(h.identityBackend).completeOnboarding(value); return result.ok ? identityOk({ ...result.value, profileId: "cccccccc-2222-4222-8222-cccccccccccc" }) : result; };
  expect((await h.coordinator.submitOnboarding(input)).kind).not.toBe("completed"); expect(h.events).toHaveLength(0);
  delete overrides.completeOnboarding; h.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
  await h.coordinator.submitOnboarding(input); expect(h.events).toHaveLength(0);
});

it("retains original lineage across acknowledged server completion followed by trusted-write failure",async()=>{
 const h=fixture({online:true});bare(h);await h.verify();const input=await legalInput(h);h.storage.failWrites.add(STORAGE_KEYS.trusted);
 expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"trusted_state_not_established"});expect(h.events).toHaveLength(0);
 h.storage.failWrites.clear();expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"completed"});expect(h.events).toHaveLength(1);expect(h.fakeAuth.counts.otpVerify).toBe(1);
});
it("retains exact lineage when completion response is lost after actual server commit",async()=>{
 const overrides:Partial<IdentityService>={},h=fixture({online:true,identity:overrides});bare(h);await h.verify();const input=await legalInput(h);let first=true;
 overrides.completeOnboarding=async value=>{const result=await createFakeIdentityService(h.identityBackend).completeOnboarding(value);if(first){first=false;return {ok:false,error:{kind:"network_error",message:"Synthetic lost response"}};}return result;};
 expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"temporarily_unavailable"});expect(h.events).toHaveLength(0);
 expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"completed"});expect(h.events).toHaveLength(1);expect(h.fakeAuth.counts.otpVerify).toBe(1);
});

it.each(["before", "after"] as const)("older %s restore cannot erase a newer unfinished lineage",async at=>{
 const h=fixture({online:true});bare(h);await h.verify();const input=await legalInput(h);let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>enter=r),hold=new Promise<void>(r=>release=r);const restore=h.fakeAuth.auth.restoreSession;let calls=0;
 h.fakeAuth.auth.restoreSession=async()=>{calls++;if(calls===(at==="before"?1:2)){enter();await hold;return {kind:"no_session"};}return restore();};
 const old=h.coordinator.submitOnboarding(input);await entered;programIdentityFailure(h.identityBackend,"completeOnboarding","network_error");
 expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"temporarily_unavailable"});release();await old;
 expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"completed"});expect(h.events).toHaveLength(1);
});
it("stale transient restore leaves the newer unfinished lineage intact",async()=>{
 const h=fixture({online:true});bare(h);await h.verify();const input=await legalInput(h);let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>enter=r),hold=new Promise<void>(r=>release=r);const restore=h.fakeAuth.auth.restoreSession;let first=true;
 h.fakeAuth.auth.restoreSession=async()=>{if(first){first=false;enter();await hold;return {kind:"temporarily_unavailable"};}return restore();};
 const old=h.coordinator.submitOnboarding(input);await entered;programIdentityFailure(h.identityBackend,"completeOnboarding","network_error");
 expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"temporarily_unavailable"});release();await old;
 expect(await h.coordinator.submitOnboarding(input)).toMatchObject({kind:"completed"});expect(h.events).toHaveLength(1);
});

it("review password never produces fresh-email proof even after normal ready admission",async()=>{
  const h=fixture();h.fakeAuth.auth.canSignInForReview=()=>true;h.fakeAuth.state.reviewSignIn={ok:true,value:IDENTITY_A};
  expect(await h.coordinator.signInForReview(email,"SYNTHETIC_REVIEW_INPUT")).toMatchObject({kind:"resolved",gate:{kind:"ready_online"}});
  expect(h.events).toEqual([]);
});
it("transfer online-only ownership refuses review password before provider or durable writes",async()=>{
  const h=fixture({online:true});h.fakeAuth.auth.canSignInForReview=()=>true;h.fakeAuth.state.reviewSignIn={ok:true,value:IDENTITY_A};
  expect((await h.coordinator.signInForReview(email,"SYNTHETIC_REVIEW_INPUT")).kind).toBe("review_unavailable");
  expect(h.fakeAuth.counts.reviewSignIn).toBe(0);expect(h.storage.store.size).toBe(0);expect(h.events).toEqual([]);
});
it("native close supersedes a held password result and prevents trusted admission",async()=>{
  const h=fixture(), entered=Promise.withResolvers<void>(), result=Promise.withResolvers<{ok:true;value:typeof IDENTITY_A}>();
  h.fakeAuth.auth.canSignInForReview=()=>true;
  h.fakeAuth.auth.signInForReview=async()=>{entered.resolve();return result.promise;};
  const pending=h.coordinator.signInForReview(email,"SYNTHETIC_REVIEW_INPUT");await entered.promise;h.close();result.resolve({ok:true,value:IDENTITY_A});
  expect((await pending).kind).not.toBe("resolved");expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);expect(h.events).toEqual([]);
});
