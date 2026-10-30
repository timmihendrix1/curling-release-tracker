// @vitest-environment jsdom
// Actual installed Web SDK. Only network responses are synthetic; no native
// capability, fake session minting or second concurrent client is introduced.
import { afterEach, expect, it, vi } from "vitest";
import { createSupabaseAuthService, type SupabaseAuthServiceOverrides } from "../supabaseAuthService";
import { getSupabaseBrowserClient, resetSupabaseBrowserClientForTests } from "../supabaseClient";
import { createSupabaseSportingCloudService } from "../supabaseSportingCloudService";
import { createIdentityHarness, IDENTITY_B, PINNED_TERMS, PINNED_PRIVACY } from "../../identity/__tests__/support/identityTestHarness";
const config={status:"configured" as const,url:"https://review-race.supabase.co",publishableKey:"sb_publishable_"+"s".repeat(30)};
const profileB="dddddddd-2222-4222-8222-dddddddddddd";
let client:ReturnType<typeof getSupabaseBrowserClient>|null=null;
function sessionResponse(){return new Response(JSON.stringify({access_token:"SYNTHETIC_ACCESS_B",refresh_token:"SYNTHETIC_REFRESH_B",expires_in:3600,token_type:"bearer",
  user:{id:IDENTITY_B.accountScopeId,email:IDENTITY_B.email,aud:"authenticated",role:"authenticated",app_metadata:{},user_metadata:{},created_at:"2026-01-01T00:00:00Z"}}),{headers:{"Content-Type":"application/json"}});}
function inputUrl(input:RequestInfo|URL){return new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);}
afterEach(async()=>{if(client){await client.auth.stopAutoRefresh();await client.auth.dispose();client=null;}resetSupabaseBrowserClientForTests();vi.restoreAllMocks();vi.unstubAllGlobals();window.localStorage.clear();});
for(const newer of ["otp","signout","restart"]as const)it(`Web review denial cannot overwrite credentials or resurrect a session around ${newer}`,async()=>{
  let passwordRequests=0,rpcUsesB=false;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=inputUrl(input);
    if(url.pathname.endsWith("/token")&&url.searchParams.get("grant_type")==="password"){passwordRequests++;throw Error("Unexpected synthetic password request");}
    if(url.pathname.endsWith("/verify"))return sessionResponse();
    if(url.pathname.includes("/rest/v1/rpc/")){rpcUsesB=new Headers(init?.headers??(input instanceof Request?input.headers:undefined)).get("Authorization")==="Bearer SYNTHETIC_ACCESS_B";return new Response("[]",{headers:{"Content-Type":"application/json"}});}
    if(url.pathname.endsWith("/logout"))return new Response(null,{status:204});
    return new Response("{}",{headers:{"Content-Type":"application/json"}});
  }));
  resetSupabaseBrowserClientForTests();let service=createSupabaseAuthService(config);client=getSupabaseBrowserClient(config);await client.auth.initialize();
  const h=createIdentityHarness({authOverrides:service});h.identityBackend.currentAccountScopeId=IDENTITY_B.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_B.accountScopeId,{profileId:profileB,displayName:"Synthetic athlete",onboardingCompletedAt:"2026-02-01T09:00:00.000Z",hasAthleteCapability:true,freeEntitlementActive:true,pinnedTerms:PINNED_TERMS,pinnedPrivacy:PINNED_PRIVACY});
  const writes=vi.spyOn(Storage.prototype,"setItem"), changes:unknown[]=[];const off=service.onAuthChange(change=>{changes.push(change);});
  const beforeStart=h.storage.calls.length, progressBefore=h.progressEvents.length;
  expect(await h.coordinator.signInForReview("review@example.invalid","SYNTHETIC_REVIEW_INPUT")).toEqual({kind:"review_unavailable"});
  expect(h.storage.calls).toHaveLength(beforeStart);expect(h.progressEvents).toHaveLength(progressBefore);expect(writes).not.toHaveBeenCalled();
  // These are the previously failing witnesses: the legitimate newer action
  // succeeds, while no older password operation exists that can arrive late.
  await h.coordinator.requestEmailOtp("ordinary@example.invalid");
  expect(await h.coordinator.verifyEmailOtp("ordinary@example.invalid","123456")).toMatchObject({kind:"resolved",gate:{kind:"ready_online",session:{accountScopeId:IDENTITY_B.accountScopeId}}});
  if(newer==="signout")expect((await h.coordinator.signOut()).kind).toBe("signed_out_locked");
  if(newer==="restart"){
    await client.auth.dispose();resetSupabaseBrowserClientForTests();client=getSupabaseBrowserClient(config);await client.auth.initialize();service=createSupabaseAuthService(config);
  }
  const before=await service.restoreSession(), snapshot=JSON.stringify(window.localStorage), writtenBefore=writes.mock.calls.length;
  expect(newer==="signout"?before.kind==="no_session":before.kind==="authenticated"&&before.identity.accountScopeId===IDENTITY_B.accountScopeId).toBe(true);
  expect((await service.signInForReview("review@example.invalid","SYNTHETIC_REVIEW_INPUT")).ok).toBe(false);
  expect(await h.coordinator.signInForReview("review@example.invalid","SYNTHETIC_REVIEW_INPUT")).toEqual({kind:"review_unavailable"});
  await Promise.resolve();expect(writes).toHaveBeenCalledTimes(writtenBefore);expect(JSON.stringify(window.localStorage)).toBe(snapshot);
  expect(await service.restoreSession()).toEqual(before);expect(passwordRequests).toBe(0);
  expect(JSON.stringify(changes)).not.toContain("SYNTHETIC_REVIEW_INPUT");
  if(newer!=="signout"){expect((await createSupabaseSportingCloudService(client).restore()).ok).toBe(true);expect(rpcUsesB).toBe(true);}
  off();
});
it("public Web factory ignores native/platform/metadata/override claims before password SDK execution",async()=>{
  vi.stubGlobal("Capacitor",{isNativePlatform:()=>true,getPlatform:()=>"ios"});vi.spyOn(navigator,"userAgent","get").mockReturnValue("Synthetic iPhone");
  window.localStorage.setItem("synthetic-native-review-enabled","true");
  const transport=vi.fn(async()=>new Response("{}",{headers:{"Content-Type":"application/json"}}));vi.stubGlobal("fetch",transport);
  const overrides={resolveAppOrigin:()=>"capacitor://localhost",credentialHealth:()=>null,newUser:true,native:true,reviewCapability:{},canSignInForReview:()=>true}as SupabaseAuthServiceOverrides;
  const service=createSupabaseAuthService(config,overrides);client=getSupabaseBrowserClient(config);await client.auth.initialize();
  const password=vi.spyOn(client.auth,"signInWithPassword"), writes=vi.spyOn(Storage.prototype,"setItem");
  expect(service.canSignInForReview()).toBe(false);
  expect((await service.signInForReview("review@example.invalid","SYNTHETIC_REVIEW_INPUT")).ok).toBe(false);
  expect(password).not.toHaveBeenCalled();expect(transport).not.toHaveBeenCalled();expect(writes).not.toHaveBeenCalled();
});

it("unavailable review cannot supersede a legitimate OTP verification already in flight",async()=>{
  const entered=Promise.withResolvers<void>(),released=Promise.withResolvers<void>();let passwordRequests=0;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL)=>{
    const url=inputUrl(input);
    if(url.searchParams.get("grant_type")==="password"){passwordRequests++;throw Error("Unexpected synthetic password request");}
    if(url.pathname.endsWith("/verify")){entered.resolve();await released.promise;return sessionResponse();}
    return new Response("{}",{headers:{"Content-Type":"application/json"}});
  }));
  const service=createSupabaseAuthService(config);client=getSupabaseBrowserClient(config);await client.auth.initialize();
  const h=createIdentityHarness({authOverrides:service});h.identityBackend.currentAccountScopeId=IDENTITY_B.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_B.accountScopeId,{profileId:profileB,displayName:"Synthetic athlete",onboardingCompletedAt:"2026-02-01T09:00:00.000Z",hasAthleteCapability:true,freeEntitlementActive:true,pinnedTerms:PINNED_TERMS,pinnedPrivacy:PINNED_PRIVACY});
  await h.coordinator.requestEmailOtp("ordinary@example.invalid");const current=h.coordinator.verifyEmailOtp("ordinary@example.invalid","123456");await entered.promise;
  const calls=h.storage.calls.length,progress=h.progressEvents.length,snapshot=JSON.stringify(window.localStorage);
  expect(await h.coordinator.signInForReview("review@example.invalid","SYNTHETIC_REVIEW_INPUT")).toEqual({kind:"review_unavailable"});
  expect((await service.signInForReview("review@example.invalid","SYNTHETIC_REVIEW_INPUT")).ok).toBe(false);
  expect(h.storage.calls).toHaveLength(calls);expect(h.progressEvents).toHaveLength(progress);expect(JSON.stringify(window.localStorage)).toBe(snapshot);
  released.resolve();expect(await current).toMatchObject({kind:"resolved",gate:{kind:"ready_online",session:{accountScopeId:IDENTITY_B.accountScopeId}}});
  expect(passwordRequests).toBe(0);
});
