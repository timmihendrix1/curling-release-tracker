import { describe, expect, it, vi } from "vitest";
import { authOk, authFailed, normalizedAuthError, type AccountIdentity, type AuthServiceResult } from "../../supabase/authService";
import { createReviewPasswordAttempt, validateInteractiveAuthAttempt } from "../interactiveAttempt";
import { validateIdentityBarrierResolution } from "../identityBarrierResolution";
import { initialGateState, isGateReady, reduceGateState } from "../gateState";
import { createIdentityHarness, IDENTITY_A, PINNED_PRIVACY, PINNED_TERMS, PROFILE_A, STORAGE_KEYS,
  deferred, type IdentityHarness, BARRIER_B, FIXED_NOW } from "./support/identityTestHarness";
import { createFakeIdentityService } from "../fakeIdentityService";
import type { HarnessOptions } from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
const email = "review@example.invalid", password = "SYNTHETIC_REVIEW_INPUT";
// Native coordinator fixture: explicit owned identity ports, never a public Web flag.
function reviewHarness(options: HarnessOptions = {}) {
  const h: IdentityHarness = createIdentityHarness({ ...options, nativeOwnership: {
    bind: () => ({ auth: h.fakeAuth.auth, identity: () => createFakeIdentityService(h.identityBackend), takeAuthObservation: () => null }),
    admissionAllowed: () => true, ownStartup() {}, ownClose() {},
  } });
  h.fakeAuth.auth.canSignInForReview = () => true;
  return h;
}
function onboard(h: IdentityHarness) {
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: "Synthetic reviewer",
    onboardingCompletedAt: "2026-02-01T09:00:00.000Z", hasAthleteCapability: true, freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
}
function setup() { const h=reviewHarness(); onboard(h); h.fakeAuth.state.reviewSignIn=authOk(IDENTITY_A); return h; }
function held() {
  const entered=deferred<void>(), result=deferred<AuthServiceResult<AccountIdentity>>();
  const h=reviewHarness();
  h.fakeAuth.auth.signInForReview=async()=>{entered.resolve();return result.promise;};
  onboard(h);return {h,entered,result};
}
describe("distinct correlated review-password transition",()=>{
  it("opens only after normal gate facts and a durable correlated resolution",async()=>{
    const h=setup(), outcome=await h.coordinator.signInForReview(email,password);
    expect(outcome).toMatchObject({kind:"resolved",gate:{kind:"ready_online"}});
    const attempt=JSON.parse(h.storage.store.get(STORAGE_KEYS.attempt)!);
    expect(validateInteractiveAuthAttempt(attempt)).toMatchObject({method:"review_password",flowId:null});
    const resolution=JSON.parse(h.storage.store.get(STORAGE_KEYS.resolutionFor(attempt.barrierId))!);
    expect(validateIdentityBarrierResolution(resolution)).toMatchObject({method:"review_password",flowId:null});
    expect([...h.storage.store.values()].join()).not.toContain(password);
    expect(h.storage.store.get(STORAGE_KEYS.attempt)).not.toContain(email);
    let gate=initialGateState();
    for(const [phase,transition] of h.progressEvents){gate=reduceGateState(gate,{type:"progress",phase,transition});expect(isGateReady(gate)).toBe(false);}
    if(outcome.kind==="review_unavailable")throw Error("Synthetic native capability unavailable");
    expect(isGateReady(reduceGateState(gate,{type:"transition_settled",outcome}))).toBe(true);
  });
  for(const key of [STORAGE_KEYS.barrier,STORAGE_KEYS.attempt])it("local prerequisite failure makes zero password calls",async()=>{
    const h=setup();h.storage.failWrites.add(key);
    expect((await h.coordinator.signInForReview(email,password)).kind).toBe(key===STORAGE_KEYS.barrier?"barrier_not_established":"attempt_not_persisted");
    expect(h.fakeAuth.counts.reviewSignIn).toBe(0);
  });
  it("early signed-in event does not resolve the barrier",async()=>{
    const {h,entered,result}=held(), running=h.coordinator.signInForReview(email,password);await entered.promise;
    expect(h.coordinator.classifyAuthChange({reason:"signed_in",identity:IDENTITY_A})).toEqual({kind:"no_action"});
    expect([...h.storage.store.keys()].filter(x=>x.includes("accessBarrierResolution"))).toEqual([]);
    expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    result.resolve(authOk(IDENTITY_A));expect(await running).toMatchObject({kind:"resolved",gate:{kind:"ready_online"}});
  });
  for(const newer of ["password","otp","google","signout","cross-tab"] as const)it(`late password completion cannot publish after ${newer}`,async()=>{
    const {h,entered,result}=held();let calls=0;
    h.fakeAuth.auth.signInForReview=async()=>{calls++;if(calls===1){entered.resolve();return result.promise;}return authOk(IDENTITY_A);};
    const running=h.coordinator.signInForReview(email,password);await entered.promise;
    if(newer==="password")await h.coordinator.signInForReview(email,password);else if(newer==="otp")await h.coordinator.requestEmailOtp(email);
    else if(newer==="google")await h.coordinator.startGoogleSignIn();
    else if(newer==="signout")await h.coordinator.signOut();
    else {h.storage.seed(STORAGE_KEYS.barrier,createIdentityAccessBarrier({barrierId:BARRIER_B,origin:"interactive_authentication",barredAccountScopeId:null,barredGeneration:null,establishedAt:FIXED_NOW}));await h.coordinator.observeNewerBarrier();}
    const before=[...h.storage.store], phases=h.progressEvents.length;
    result.resolve(authOk(IDENTITY_A));expect((await running).kind).not.toBe("resolved");
    expect([...h.storage.store]).toEqual(before);expect(h.progressEvents).toHaveLength(phases);
  });
  it("a completed provider session cannot bypass failed trusted-state persistence",async()=>{
    const h=setup();h.storage.failWrites.add(STORAGE_KEYS.trusted);
    expect((await h.coordinator.signInForReview(email,password)).kind).toBe("trusted_state_not_established");
  });
  it("new Profile still requires onboarding and legal evidence",async()=>{
    const h=reviewHarness();h.identityBackend.currentAccountScopeId=IDENTITY_A.accountScopeId;h.fakeAuth.state.reviewSignIn=authOk(IDENTITY_A);
    expect(await h.coordinator.signInForReview(email,password)).toMatchObject({kind:"resolved",gate:{kind:"onboarding_required"}});
    expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
  it("provider denial and malformed success never produce a resolution",async()=>{
    for(const outcome of [authFailed(normalizedAuthError("review_sign_in_failed")),{ok:true,value:{}}]){
      const h=setup();h.fakeAuth.auth.signInForReview=vi.fn().mockResolvedValue(outcome);
      expect((await h.coordinator.signInForReview(email,password)).kind).toBe("provider_error");
      expect([...h.storage.store.keys()].filter(x=>x.includes("accessBarrierResolution"))).toEqual([]);
    }
  });
  it("no callback selector or credential may enter the durable method record",()=>{
    const attempt=createReviewPasswordAttempt({attemptId:BARRIER_B,barrierId:BARRIER_B,capturedIdentityGeneration:1,startedAt:FIXED_NOW});
    expect(validateInteractiveAuthAttempt(attempt)).not.toBeNull();
    expect(validateInteractiveAuthAttempt({...attempt,flowId:"synthetic-selector"})).toBeNull();
    expect(validateInteractiveAuthAttempt({...attempt,method:"other_password"})).toBeNull();
  });
});

it("a failed Profile RPC cannot be bypassed by review credentials",async()=>{
  const h=setup();h.identityBackend.failures.set("ensureProfile",["network_error"]);
  const result=await h.coordinator.signInForReview(email,password);
  expect(result).not.toMatchObject({gate:{kind:"ready_online"}});expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
});
it("a definitive gate denial still invalidates review identity",async()=>{
  const h=setup();h.identityBackend.failures.set("resolveGateFacts",["forbidden"]);
  const result=await h.coordinator.signInForReview(email,password);
  expect(result.kind).toBe("identity_invalidated");expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
});
it("missing legal documents block new review-account onboarding",async()=>{
  const h=reviewHarness({legalRows:[]});h.identityBackend.currentAccountScopeId=IDENTITY_A.accountScopeId;h.fakeAuth.state.reviewSignIn=authOk(IDENTITY_A);
  const result=await h.coordinator.signInForReview(email,password);
  expect(result).not.toMatchObject({gate:{kind:"ready_online"}});expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
});
it("an existing deletion guard remains authoritative",async()=>{
  const canAdmit=vi.fn(async()=>false);
  const h=reviewHarness({deletionGuards:{canAdmit,load:async()=>({status:"absent"}),begin:async()=>null,resolve:async()=>false}});
  onboard(h);h.fakeAuth.state.reviewSignIn=authOk(IDENTITY_A);
  expect(await h.coordinator.signInForReview(email,password)).toMatchObject({kind:"resolved",gate:{kind:"identity_unconfirmed"}});
  expect(canAdmit).toHaveBeenCalledWith(PROFILE_A);
});
it("resolution persistence failure cannot admit the real provider result",async()=>{
  const h=setup();h.storage.onBeforeCall=async call=>{if(call.startsWith("set:curling.identity.accessBarrierResolution."))h.storage.failWrites.add(call.slice(4));};
  expect((await h.coordinator.signInForReview(email,password)).kind).toBe("barrier_resolution_failed");expect(h.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
});
it("a newer password flow supersedes a held OTP verification",async()=>{
  const entered=deferred<void>(), result=deferred<AuthServiceResult<AccountIdentity>>(),h=setup();
  h.fakeAuth.auth.verifyEmailOtp=async()=>{entered.resolve();return result.promise;};
  await h.coordinator.requestEmailOtp(email);const old=h.coordinator.verifyEmailOtp(email,"123456");await entered.promise;
  expect(await h.coordinator.signInForReview(email,password)).toMatchObject({kind:"resolved",gate:{kind:"ready_online"}});
  const before=[...h.storage.store];result.resolve(authOk(IDENTITY_A));expect((await old).kind).toBe("superseded");expect([...h.storage.store]).toEqual(before);
});
