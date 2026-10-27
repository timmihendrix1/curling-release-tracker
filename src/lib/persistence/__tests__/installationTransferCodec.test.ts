import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { encodeInstallationTransfer, decodeInstallationTransfer } from "../installationTransferCodec";
import { TRANSFER_SPORTING_SUFFIXES as suffixes, TRANSFER_PROFILE_PREFIX as prefix, type Json, type JsonObject } from "../installationTransferInventory";
import { validatePendingIntent, validateOutstandingIntentCleanup } from "../../identity/pendingIntentRepository";
import { validateTrustedDeviceRecord } from "../../identity/trustedDevice";
import { validateIdentityAccessBarrier } from "../../identity/identityBarrier";
import { validateInteractiveAuthAttempt } from "../../identity/interactiveAttempt";
import { validateIdentityBarrierResolution } from "../../identity/identityBarrierResolution";
const fixed = ["curling.identity.trustedDevice.v1", "curling.identity.accessBarrier.v1", "curling.identity.interactiveAttempt.v1", "curling.identity.pendingIntent.v1", "curling.identity.intentCleanup.v1", "curling.sporting.legacy-unscoped-retired.v1"].sort();
const empty = () => ({schemaVersion:1,transferId:"30000000-0000-4000-8000-000000000003",snapshotId:"40000000-0000-4000-8000-000000000004",sourceBuild:{version:"synthetic-1",build:"test-1"},catalogContractId:"synthetic-catalog-v1",listing:{schemaVersion:1,keys:[] as string[]},observations:fixed.map(key=>({key,state:"absent"})),sourceControl:{domain:"absent",credential:"excluded"},snapshotState:"synthetic_frozen"});
// Explicit test-only provider. Not a production default or cryptographic claim.
const fingerprint = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Observation = {key:string;state:string;raw?:string};
type Snapshot = Omit<ReturnType<typeof empty>,"observations"> & { observations:Observation[] };
const a="10000000-0000-4000-8000-000000000001", b="20000000-0000-4000-8000-000000000002", timestamp="2026-10-21T00:00:00.000Z";
const sporting=(id:string,suffix=suffixes[0])=>prefix+id+"."+suffix;
function snapshot(raws:Record<string,string>={}):Snapshot {
  const base=empty(); const profiles=[...new Set(Object.keys(raws).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length,prefix.length+36)))];
  const keys=[...fixed,...profiles.flatMap(id=>suffixes.map(s=>sporting(id,s))),...Object.keys(raws).filter(k=>k.startsWith("curling.identity.accessBarrierResolution."))].sort();
  return {...base,listing:{schemaVersion:1,keys:Object.keys(raws).sort()},observations:keys.map(key=>Object.hasOwn(raws,key)?{key,state:"present",raw:raws[key]}:{key,state:"absent"})};
}
async function envelope(s:Snapshot=snapshot()):Promise<JsonObject> {
  const result=await encodeInstallationTransfer(JSON.stringify(s),fingerprint);expect(result.ok,JSON.stringify(result)).toBe(true);if(!result.ok)throw Error("fixture refused");return JSON.parse(result.value.wire) as JsonObject;
}
// Independent wire/preimage goldens: no SUT serialization helpers are used.
function canonical(v:Json):string {if(typeof v==="string"){let s='"';for(let i=0;i<v.length;i++)s+="\\u"+v.charCodeAt(i).toString(16).padStart(4,"0");return s+'"';}if(v===null||typeof v!=="object")return String(v);if(Array.isArray(v))return "["+v.map(canonical).join(",")+"]";return "{"+Object.keys(v).sort().map(k=>canonical(k)+":"+canonical(v[k])).join(",")+"}";}
const u=(n:number)=>{const buf=Buffer.alloc(8);buf.writeBigUInt64BE(BigInt(n));return buf;};
const str=(s:string)=>{const buf=Buffer.alloc(s.length*2);for(let i=0;i<s.length;i++)buf.writeUInt16BE(s.charCodeAt(i),i*2);return Buffer.concat([u(s.length),buf]);};
function typed(v:Json):Buffer {if(v===null)return Buffer.from([0]);if(typeof v==="boolean")return Buffer.from([v?2:1]);if(typeof v==="number")return Buffer.concat([Buffer.from([3]),u(v)]);if(typeof v==="string")return Buffer.concat([Buffer.from([4]),str(v)]);if(Array.isArray(v))return Buffer.concat([Buffer.from([5]),u(v.length),...v.map(typed)]);const keys=Object.keys(v).sort();return Buffer.concat([Buffer.from([6]),u(keys.length),...keys.flatMap(k=>[str(k),typed(v[k])])]);}
const items=(o:JsonObject)=>o.items as JsonObject[];
const reject=(code:string)=>({ok:false,code});
const identityFixtures: Record<string,JsonObject> = {
  "curling.identity.trustedDevice.v1":{schemaVersion:1,accountScopeId:"synthetic-account",profileId:a,displayName:"Synthetic",onboardingCompletedAt:timestamp,entitlement:"free",generation:1,establishedAt:timestamp,lastServerConfirmationAt:timestamp},
  "curling.identity.accessBarrier.v1":{schemaVersion:1,barrierId:a,origin:"explicit_sign_out",barredAccountScopeId:null,barredGeneration:null,establishedAt:timestamp},
  "curling.identity.interactiveAttempt.v1":{schemaVersion:1,attemptId:b,method:"google",flowId:"synthetic-selector",barrierId:a,capturedIdentityGeneration:1,startedAt:timestamp},
  "curling.identity.pendingIntent.v1":{schemaVersion:1,kind:"admin_request",value:b,capturedAt:timestamp,survival:"ordinary"},
  "curling.identity.intentCleanup.v1":{schemaVersion:1,recordedAt:timestamp},
  [`curling.identity.accessBarrierResolution.${a}.v1`]:{schemaVersion:1,barrierId:a,attemptId:b,method:"email_otp",flowId:null,identityGeneration:1,authenticatedAccountScopeId:"synthetic-account",resolvedAt:timestamp},
};
describe("inactive S2 codec", () => {
  it("roundtrips an empty complete archive without semantic readiness", async () => {
    const encoded = await encodeInstallationTransfer(JSON.stringify(empty()),fingerprint);
    expect(encoded.ok).toBe(true);
    if (!encoded.ok) return;
    const decoded = await decodeInstallationTransfer(encoded.value.wire,fingerprint);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.semanticStatus).toBe("not_evaluated");
  });
  it("reports missing fingerprint only after admitting a complete source", async () => { expect(await encodeInstallationTransfer(JSON.stringify(empty()),undefined)).toEqual({ok:false,code:"fingerprint_unavailable"}); });
  it.each([...suffixes])("preserves both namespaces and present-empty versus absent for %s", async suffix => {
    for (const present of [true,false]) {
      const raws:Record<string,string>={[sporting(a)]:"",[sporting(b,suffix===suffixes[0]?suffixes[1]:suffixes[0])]:"{malformed"}; const key=sporting(b,suffix); if(present)raws[key]="";
      const s=snapshot(raws); const encoded=await encodeInstallationTransfer(JSON.stringify(s),fingerprint); expect(encoded.ok).toBe(true);if(!encoded.ok)return;
      const decoded=await decodeInstallationTransfer(encoded.value.wire,fingerprint);expect(decoded.ok).toBe(true);if(!decoded.ok)return;
      expect(decoded.value.envelope.profiles).toEqual([a,b]); expect(items(decoded.value.envelope)).toHaveLength(32);
      for(const item of items(decoded.value.envelope)) expect(item.presence).toBe(Object.hasOwn(raws,item.key as string)?"present":"absent");
      for(const [key,raw] of Object.entries(raws))expect(items(decoded.value.envelope).find(i=>i.key===key)?.raw).toBe(raw);
      expect(decoded.value.semanticStatus).toBe("not_evaluated");expect(Object.isFrozen(decoded.value.envelope)).toBe(true);expect(Object.isFrozen(items(decoded.value.envelope)[0])).toBe(true);
    }
  });
  it("preserves whole raw sync, private notes and historical references, not an upload projection", async () => {
    const raw=JSON.stringify({schemaVersion:6,entries:[{desired:"present",status:"synced",payload:"whole original personal payload",contentSha256:"b".repeat(64)},{desired:"deleted",payload:"",status:"pending"}],teamEntries:[{entryKind:"team_exercise_session",status:"synced",coordinationPayload:"",sessionId:b},{entryKind:"team_exercise_bundle",sessionId:b,athleteProfileId:b,status:"blocked",resultPayload:"original",blockReason:"recording_permission_missing"}],teamEligibilitySnapshots:[{participants:[{profileId:b,recordingPermissionGranted:true}]}],activeTeamExerciseDraft:{recorderProfileId:a},teamExerciseResults:[{athleteProfileId:a,recordedBy:b,originalResult:{privateNote:"private original"},result:{privateNote:"private current",diagramAssetId:"retired-diagram",exerciseVersionSnapshot:{id:"retired-version"},measurementProtocol:{id:"historical",version:1}},postCompletionRevisions:[{privateNote:"correction"}],isVoided:true}]},null,2);
    const o=await envelope(snapshot({[sporting(a,suffixes[12])]:raw}));expect(items(o).find(i=>i.presence==="present")?.raw).toBe(raw);expect(o.profiles).toEqual([a]);
    for(const unsupported of ['{"schemaVersion":999,"privateNote":"keep"}','',"{malformed",' { "future": 1.5 } ']) expect(items(await envelope(snapshot({[sporting(a)]:unsupported}))).find(i=>i.presence==="present")?.raw).toBe(unsupported);
    // Primary loader risks remain separate; S2 never calls these or writes defaults.
    for(const [path,needle] of [["sessionRepository.ts","return loadedAbsent<Session>();"],["historyFiltersRepository.ts","sanitizeHistoryFilters(JSON.parse(result.value))"],["smartRandomProfiles/repository.ts","return loadedAbsent<SmartRandomProfilesState>();"],["assessment/repository.ts","const written = await adapter.set("],["trainingPlans/repository.ts","trainingPlansMigrateLosslessly"],["accuracyToleranceProfiles/repository.ts","storedAccuracyToleranceProfilesAreReadable"]])expect(readFileSync(`src/lib/${path}`,"utf8")).toContain(needle);
  });
  it.each(Object.entries(identityFixtures))("archives closed non-secret identity inertly: %s", async (key,value) => {
    const validators=[validateTrustedDeviceRecord,validateIdentityAccessBarrier,validateInteractiveAuthAttempt,validatePendingIntent,validateOutstandingIntentCleanup,validateIdentityBarrierResolution];const index=Object.keys(identityFixtures).indexOf(key);expect(validators[index](value)).not.toBeNull();
    const raw=JSON.stringify(value,null,2);const o=await envelope(snapshot({[key]:raw}));expect(o.profiles).toEqual([]);expect(items(o).find(i=>i.key===key)?.raw).toBe(raw);
    for(const extra of ["access_token","verifier","privateHash","future"]) {const bad=JSON.stringify({...value,[extra]:"synthetic-opaque"});expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:bad})),fingerprint)).toEqual(reject(key.includes("pendingIntent")?"sensitive_archive_unavailable":"identity_archive_unsupported"));}
    const duplicate=JSON.stringify(value).replace("{",'{"schemaVersion":1,');expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:duplicate})),fingerprint)).toEqual(reject(key.includes("pendingIntent")?"sensitive_archive_unavailable":"identity_archive_unsupported"));
  });
  it.each(["ordinary","invitation_account_recovery","future"])("refuses whole sensitive/ambiguous pending archive with %s, even with debt", async survival => {
    const key="curling.identity.pendingIntent.v1"; const debt="curling.identity.intentCleanup.v1";
    for(const raw of [JSON.stringify({schemaVersion:1,kind:"invitation",value:"SYNTHETIC_OPAQUE",capturedAt:timestamp,survival}),"{malformed",JSON.stringify({schemaVersion:9,kind:"future",value:"SYNTHETIC_OPAQUE"})]) {
      let calls=0;expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:raw,[debt]:JSON.stringify(identityFixtures[debt])})),()=>{calls++;return "a".repeat(64);})).toEqual(reject("sensitive_archive_unavailable"));expect(calls).toBe(0);
    }
  });
  it("rejects selector mismatch and unsafe generations before hashing; valid maximum stays raw", async () => {
    for(const [key,value] of Object.entries(identityFixtures)) {
      const generation=["generation","barredGeneration","capturedIdentityGeneration","identityGeneration"].find(k=>Object.hasOwn(value,k));if(!generation)continue;
      for(const n of [9007199254740992,-1,1.5])expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:JSON.stringify({...value,[generation]:n})})),fingerprint)).toEqual(reject("identity_archive_unsupported"));
      expect((await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:JSON.stringify({...value,[generation]:9007199254740991})})),fingerprint)).ok).toBe(true);
    }
    const key=`curling.identity.accessBarrierResolution.${a}.v1`;expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:JSON.stringify({...identityFixtures[key],barrierId:b})})),fingerprint)).toEqual(reject("identity_archive_unsupported"));
  });
  it("rejects omitted/extra/duplicate/conflicting slots, distinguishes unobserved from absence", async () => {
    const base=snapshot({[sporting(a)]:""});
    const variants:[string,(s:Snapshot)=>void][]=[
      ["incomplete_inventory",s=>{s.observations.pop();}], ["incomplete_inventory",s=>{s.observations.push(s.observations[0]);}], ["incomplete_inventory",s=>{s.observations.find(i=>i.key===sporting(a))!.state="absent";delete s.observations.find(i=>i.key===sporting(a))!.raw;}],
      ["incomplete_inventory",s=>{s.listing.keys=[];}], ["source_unobserved",s=>{s.observations[0]={key:s.observations[0].key,state:"unobserved"};}], ["source_unobserved",s=>{s.observations[0]={key:s.observations[0].key,state:"unreadable"};}],
    ];for(const [code,mutate] of variants){const s=structuredClone(base);mutate(s);let calls=0;expect(await encodeInstallationTransfer(JSON.stringify(s),()=>{calls++;return "a".repeat(64);})).toEqual(reject(code));expect(calls).toBe(0);}
  });
  it("requires healthy owner projection for controls, never raw controls, and preserves legacy as inert evidence", async () => {
    for(const domain of ["fault","unreadable","unsupported"]) {const s=snapshot();s.sourceControl.domain=domain;expect(await encodeInstallationTransfer(JSON.stringify(s),fingerprint)).toEqual(reject("source_unhealthy"));}
    const s=snapshot();s.listing.keys=["curling.nativeMigration.activationRecord.v1"];expect(await encodeInstallationTransfer(JSON.stringify(s),fingerprint)).toEqual(reject("source_unhealthy"));s.sourceControl.domain="healthy";expect((await encodeInstallationTransfer(JSON.stringify(s),fingerprint)).ok).toBe(true);
    s.observations.push({key:s.listing.keys[0],state:"present",raw:"SYNTHETIC_CONTROL"});s.observations.sort((x,y)=>x.key<y.key?-1:1);expect(await encodeInstallationTransfer(JSON.stringify(s),fingerprint)).toEqual(reject("incomplete_inventory"));
    const legacy=fixed[5];expect(items(await envelope(snapshot({[legacy]:"complete"}))).find(i=>i.key===legacy)?.raw).toBe("complete");expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[legacy]:"broken"})),fingerprint)).toEqual(reject("source_unhealthy"));
  });
  it("matches independent value and package byte goldens for every Unicode vector", async () => {
    const vectors=["","\u0000","\ud800","\udc00","\ufffd","e\u0301","\u00e9","\ud83d\ude00"];const captured:string[]=[];
    const expectedT=["040000000000000000","0400000000000000010000","040000000000000001d800","040000000000000001dc00","040000000000000001fffd","04000000000000000200650301","04000000000000000100e9","040000000000000002d83dde00"];
    for(const [index,raw] of vectors.entries()) {
      const buffers:Buffer[]=[];const provider=(bytes:Uint8Array)=>{buffers.push(Buffer.from(bytes));return fingerprint(bytes);};const encoded=await encodeInstallationTransfer(JSON.stringify(snapshot({[sporting(a)]:raw})),provider);expect(encoded.ok).toBe(true);if(!encoded.ok)return;
      expect(buffers).toHaveLength(2);expect(buffers[0].toString("hex")).toBe(Buffer.from("curling-transfer-value/v1\u0000","ascii").toString("hex")+expectedT[index]);captured.push(buffers[0].toString("hex"));
      const o=JSON.parse(encoded.value.wire) as JsonObject;const root={...o};delete root.packageDigest;expect(buffers[1]).toEqual(Buffer.concat([Buffer.from("curling-transfer-package/v1\u0000","ascii"),typed(root)]));expect(encoded.value.wire).toBe(canonical(o));
      const decoded=await decodeInstallationTransfer(encoded.value.wire,provider);expect(decoded.ok).toBe(true);if(decoded.ok)expect(items(decoded.value.envelope).find(i=>i.presence==="present")?.raw).toBe(raw);
    }expect(new Set(captured).size).toBe(vectors.length);
  });
  it("binds all metadata/absences and omits ONLY root packageDigest from its preimage", async () => {
    const original=await envelope(snapshot({[sporting(a)]:"raw"}));
    const mutations:((o:JsonObject)=>void)[]=[o=>{(o.sourceBuild as JsonObject).build="next";},o=>{(o.provenance as JsonObject).catalogContractId="next";},o=>{o.transferId=b;},o=>{(o.provenance as JsonObject).domainControl="healthy";}];
    for(const mutate of mutations){const o=structuredClone(original);mutate(o);expect(await decodeInstallationTransfer(canonical(o),fingerprint)).toEqual(reject("digest_mismatch"));}
    const captures:Buffer[]=[];for(const value of ["a".repeat(64),"b".repeat(64)]){const o=structuredClone(original);o.packageDigest=value;expect(await decodeInstallationTransfer(canonical(o),(bytes:Uint8Array)=>{captures.push(Buffer.from(bytes));return fingerprint(bytes);})).toEqual(reject("digest_mismatch"));}expect(captures[1]).toEqual(captures[3]);
    const o=structuredClone(original);const absent=items(o).find(i=>i.presence==="absent"&&i.category==="sporting")!;Object.assign(absent,{presence:"present",raw:"",codeUnits:0,valueDigest:fingerprint(Buffer.concat([Buffer.from("curling-transfer-value/v1\u0000","ascii"),typed("")]))});const c=o.counts as JsonObject;c.present=(c.present as number)+1;c.absent=(c.absent as number)-1;expect(await decodeInstallationTransfer(canonical(o),fingerprint)).toEqual(reject("digest_mismatch"));
  });
  it("rejects closed envelope/routing/category/count/version mutations before callbacks", async () => {
    const original=await envelope(snapshot({[sporting(a)]:"raw"}));
    const bads:[string,(o:JsonObject)=>void][]=[
      ["unsupported_format",o=>{o.formatVersion=2;}],["invalid_envelope",o=>{o.intendedDestination="other.bundle";}],["invalid_envelope",o=>{o.extra=null;}],["invalid_envelope",o=>{delete o.credentialPolicy;}],["invalid_envelope",o=>{items(o)[0].raw="unexpected";}],
      ["invalid_envelope",o=>{items(o).find(i=>i.presence==="present")!.category="identity_archive";}],["invalid_envelope",o=>{items(o).find(i=>i.presence==="present")!.codeUnits=4;}],["invalid_envelope",o=>{items(o).find(i=>i.presence==="present")!.valueDigest="A".repeat(64);}],["invalid_envelope",o=>{o.snapshotId=o.transferId;}],
      ["incomplete_inventory",o=>{o.profiles=[];}],["incomplete_inventory",o=>{items(o).pop();}],["incomplete_inventory",o=>{items(o).push(items(o)[0]);}],["limit_exceeded",o=>{(o.counts as JsonObject).slots=9007199254740991;}],
      ["invalid_envelope",o=>{items(o).find(i=>i.presence==="present")!.key="sb-synthetic-auth-token";}],
    ];for(const [code,mutate] of bads){const o=structuredClone(original);mutate(o);let calls=0;expect(await decodeInstallationTransfer(canonical(o),()=>{calls++;return "a".repeat(64);})).toEqual(reject(code));expect(calls).toBe(0);}
    for(const mutate of [(o:JsonObject)=>{o.packageDigest="b".repeat(64);},(o:JsonObject)=>{items(o).find(i=>i.presence==="present")!.valueDigest="b".repeat(64); }]){const o=structuredClone(original);mutate(o);expect(await decodeInstallationTransfer(canonical(o),fingerprint)).toEqual(reject("digest_mismatch"));}
  });
  it("rejects duplicate members including escaped aliases and noncanonical equivalent wire", async () => {
    const o=await envelope();const wire=canonical(o);
    for(const duplicate of ['{"formatVersion":1,"formatVersion":1}','{"formatVersion":1,"\\u0066ormatVersion":1}','{"counts":{"profiles":0,"profiles":0}}','{"x":0,"x":'+"0,".repeat(100)+'0}'])expect(await decodeInstallationTransfer(duplicate,fingerprint)).toEqual(reject("duplicate_member"));
    for(const changed of [wire+" ",wire.replace("\\u0061","a"),JSON.stringify(o)," "+wire])expect(await decodeInstallationTransfer(changed,fingerprint)).toEqual(reject("noncanonical_wire"));
    for(const token of ["9007199254740992","-1","1.5","1e3","-0","01"])expect(await decodeInstallationTransfer('{"counts":{"present":'+token+'}}',fingerprint)).toEqual(reject("invalid_envelope"));
    expect(await decodeInstallationTransfer(wire+"x",fingerprint)).toEqual(reject("invalid_envelope"));
    expect(await decodeInstallationTransfer(wire.slice(0,-1)+',"__proto__":{}}',fingerprint)).toEqual(reject("invalid_envelope"));
  });
  it("is deterministic under source member permutations and never reserializes inner payloads", async () => {
    const s=snapshot({[sporting(a)]:' {"b":1,"a": 2}\n'});const reverse=(v:unknown):unknown=>Array.isArray(v)?v.map(reverse):v!==null&&typeof v==="object"?Object.fromEntries(Object.entries(v).reverse().map(([k,v])=>[k,reverse(v)])):v;
    expect(await encodeInstallationTransfer(JSON.stringify(s),fingerprint)).toEqual(await encodeInstallationTransfer(JSON.stringify(reverse(s)),fingerprint));
  });
  it("contains synchronous throws and conforming fingerprint failures without exposing reasons", async () => {
    const o=await envelope();const input=JSON.stringify(snapshot());const wire=canonical(o);let touched=0;const reason=new Proxy({}, {get(){touched++;throw 0;},getPrototypeOf(){touched++;throw 0;},ownKeys(){touched++;throw 0;}});
    const providers:[unknown,string][]=[[undefined,"fingerprint_unavailable"],[{},"fingerprint_unavailable"],[()=>{throw reason;},"fingerprint_failed"],[()=>Promise.reject(reason),"fingerprint_failed"],[()=>null,"fingerprint_invalid"],[()=>new String("a".repeat(64)),"fingerprint_invalid"],[()=>"A".repeat(64),"fingerprint_invalid"],[()=>"a","fingerprint_invalid"]];
    for(const [provider,code] of providers){expect(await encodeInstallationTransfer(input,provider)).toEqual(reject(code));expect(await decodeInstallationTransfer(wire,provider)).toEqual(reject(code));}expect(touched).toBe(0);
    const promise=Promise.reject(reason);Object.defineProperty(promise,"then",{get(){touched++;throw reason;}});expect(await encodeInstallationTransfer(input,()=>promise)).toEqual(reject("fingerprint_failed"));expect(touched).toBe(0);
  });
  // IR02 characterization, not a hostile-Promise repair. Children load the actual
  // checkout TS with the installed compiler; only fixtures/providers live here.
  const ownershipChild = String.raw`
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {entry, scenario: t, input} = JSON.parse(process.argv[2]);
const ts = require(path.join(process.cwd(), 'node_modules/typescript'));
Module._extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(
  fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}
).outputText, file);
const codec = require(path.join(process.cwd(), 'src/lib/persistence/installationTransferCodec.ts'));
const nativeThen = Promise.prototype.then;
const tick = () => new Promise(resolve => setImmediate(resolve));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const capture = object => ({object, proto:Object.getPrototypeOf(object), own:Object.getOwnPropertyDescriptors(object)});
function unchanged(before) {
  const now = Object.getOwnPropertyDescriptors(before.object);
  assert.deepEqual(Reflect.ownKeys(now), Reflect.ownKeys(before.own));
  for (const key of Reflect.ownKeys(now)) for (const field of ['value','get','set','writable','enumerable','configurable'])
    assert.ok(Object.is(now[key][field], before.own[key][field]), 'descriptor identity changed');
  assert.equal(Object.getPrototypeOf(before.object), before.proto);
}
function globalState() {
  return {objects:[globalThis,Promise,Promise.prototype].map(capture), listeners:
    ['unhandledRejection','rejectionHandled','uncaughtException','uncaughtExceptionMonitor'].map(name=>[name,process.rawListeners(name)])};
}
function sameGlobals(before) {
  before.objects.forEach(unchanged);
  for (const [name, listeners] of before.listeners) {
    const now = process.rawListeners(name); assert.equal(now.length,listeners.length);
    now.forEach((listener,i)=>assert.equal(listener,listeners[i]));
  }
}
async function main() {
  const encoded = await codec.encodeInstallationTransfer(input,sha);
  assert.equal(encoded.ok,true);
  const expected = entry==='encode' ? encoded : await codec.decodeInstallationTransfer(encoded.value.wire,sha);
  assert.equal(expected.ok,true);
  const invoke = provider => entry==='encode' ? codec.encodeInstallationTransfer(input,provider) : codec.decodeInstallationTransfer(encoded.value.wire,provider);
  // Materialize only the output facilities used below, before measurement.
  // Descriptor comparisons never read values through lazy global accessors.
  void console.log; void process.stdout; void process.stderr;
  // Node's descriptor observer can initialize lazy globals (including undici).
  // Warm that same observer and let its queued initialization finish BEFORE
  // the baseline; no provider/SUT call occurs during this measurement setup.
  globalState(); await tick(); await tick();
  const globals = globalState();
  let calls=0, reasonReads=0, maskedReads=0, metadataReads=0, derivedCreated=0;
  let release;
  const retained=[], forwarded=[], buffers=[];
  const opaque = new Proxy(Object.create(null), {
    get(){reasonReads++;throw 0;}, ownKeys(){reasonReads++;throw 0;},
    getPrototypeOf(){reasonReads++;throw 0;}, has(){reasonReads++;throw 0;}
  });
  const protect = object => {Object.freeze(object);retained.push(capture(object));return object;};
  function poison(source, kind) {
    const getter = () => {metadataReads++;throw 'SYNTHETIC_METADATA_THROW';};
    if (kind==='constructor') Object.defineProperty(source,'constructor',{get:getter,configurable:false});
    else {
      const ctor=Object.create(null); Object.defineProperty(ctor,Symbol.species,{get:getter,configurable:false});
      protect(ctor); Object.defineProperty(source,'constructor',{value:ctor,writable:false,configurable:false});
    }
    protect(source);
  }
  const provider = bytes => {
    calls++; buffers.push({object:bytes,copy:Buffer.from(bytes)});
    const digest=sha(bytes), rejecting=t.settle==='reject', deliver=t.settle==='invalid'?'not-a-digest':digest;
    if (t.kind==='primitive') return digest;
    if (t.kind==='invalid') return t.value;
    if (t.kind==='throw') throw opaque;
    if (t.kind==='then-getter') return protect(Object.defineProperty({},'then',{get(){throw opaque;}}));
    if (t.kind==='then-call') return protect({then(){throw opaque;}});
    if (t.kind==='original-residual'||t.kind==='prehandled') {
      const source=t.timing==='delayed' ? new Promise((_,reject)=>setImmediate(()=>reject('SYNTHETIC_PROVIDER_REJECTION'))) : Promise.reject('SYNTHETIC_PROVIDER_REJECTION');
      if (t.kind==='prehandled') forwarded.push(nativeThen.call(source,undefined,()=>undefined));
      poison(source,t.poison); return source;
    }
    if (t.kind==='derived-residual') {
      const source=Promise.reject('SYNTHETIC_PROVIDER_REJECTION');
      class OrphanDerived extends Promise {
        constructor(executor) {
          super((resolve,reject)=>{executor(resolve,reject);reject('SYNTHETIC_DERIVED_REJECTION');});
          derivedCreated++;
        }
      }
      const ctor=protect({[Symbol.species]:OrphanDerived});
      Object.defineProperty(source,'constructor',{value:ctor,writable:false,configurable:false});
      protect(source); return source;
    }
    const pending=t.timing==='pending' && calls===1;
    const delayed=t.timing==='delayed';
    let resolveSource, rejectSource;
    const source=new Promise((resolve,reject)=>{resolveSource=resolve;rejectSource=reject;});
    const complete=()=>rejecting?rejectSource(opaque):resolveSource(deliver);
    let returned=source;
    if (t.kind==='masked') Object.defineProperty(source,'then',{get(){maskedReads++;throw opaque;},configurable:false});
    if (t.kind==='bridge') {
      returned=new Promise((resolve,reject)=>{
        // Creation-time cooperation. Ordinary ignored derivative fulfills undefined.
        forwarded.push(nativeThen.call(source,value=>{resolve(value);},reason=>{reject(reason);}));
      });
      poison(source,t.poison);
    } else if (t.kind==='thenable') {
      returned=protect({then(resolve,reject){
        forwarded.push(nativeThen.call(source,value=>{resolve(value);},reason=>{reject(reason);}));
      }});
      protect(source);
    } else if (t.kind==='callback') {
      // This ordinary source IS the callback-driven bridge, not a hostile return
      // wrapped after receipt. No underlying Promise/production adapter is used.
    } else assert.ok(t.kind==='native'||t.kind==='masked');
    if (returned===source) protect(source); else protect(returned);
    if (pending) release=complete;
    else if (delayed) setImmediate(complete);
    else complete();
    return returned;
  };
  let settled=false;
  const operation=invoke(t.kind==='unavailable'?undefined:provider);
  nativeThen.call(operation,()=>{settled=true;},()=>{settled=true;});
  if (t.timing==='pending') {
    await tick(); assert.equal(settled,false); assert.equal(calls,1);
    assert.deepEqual(Buffer.from(buffers[0].object),buffers[0].copy);
    release();
  }
  const result=await operation;
  if (t.kind==='unavailable') assert.deepEqual(result,{ok:false,code:'fingerprint_unavailable'});
  else if (['throw','then-getter','then-call','original-residual','derived-residual','prehandled'].includes(t.kind)||t.settle==='reject')
    assert.deepEqual(result,{ok:false,code:'fingerprint_failed'});
  else if (t.kind==='invalid'||t.settle==='invalid') assert.deepEqual(result,{ok:false,code:'fingerprint_invalid'});
  else assert.deepEqual(result,expected);
  if (!result.ok) assert.deepEqual(Reflect.ownKeys(result),['ok','code']);
  if (t.kind==='derived-residual') assert.equal(derivedCreated,1);
  const check = () => {
    assert.equal(reasonReads,0); assert.equal(maskedReads,0);
    if (t.kind==='bridge') assert.equal(metadataReads,0);
    retained.forEach(unchanged); sameGlobals(globals);
    for (const buffer of buffers) assert.deepEqual(Buffer.from(buffer.object),buffer.copy);
  };
  check();
  const observation=()=>({classification:t.classification,entry,scenario:t,result:result.ok?{ok:true,exactSuccess:true}:result,
    calls,reasonReads,maskedReads,metadataReads,derivedCreated,pendingObserved:t.timing==='pending',
    descriptorsPrototypesGlobalsIntrinsicsListenersUnchanged:true});
  if (t.classification==='OUT_OF_CONTRACT_RESIDUAL') {
    // Print the observed Result before the host reports the actual raw rejection.
    console.log(JSON.stringify(observation())); await tick(); await tick(); return;
  }
  await tick(); await tick();
  for (const derivative of forwarded) {protect(derivative);assert.equal(await derivative,undefined);}
  check();
  if (t.sequential) {
    assert.equal(calls,result.ok?2:1);
    assert.equal(new Set(buffers.map(x=>x.object)).size,calls);
  }
  console.log(JSON.stringify({...observation(),safeForwardedDerivatives:forwarded.length,twoTurnsObserved:true}));
}
main().catch(error=>{console.error('IR02_TEST_HARNESS_FAILURE',error);process.exitCode=2;});
`;
  type OwnershipScenario = {
    kind: string; settle?: string; timing?: string; poison?: string;
    value?: string | number | boolean | null; sequential?: boolean;
    classification: "SUPPORTED" | "NONCONFORMING_PREHANDLED_CONTROL" | "OUT_OF_CONTRACT_RESIDUAL";
  };
  let ownershipWorkspace: Promise<string> | undefined;
  async function runOwnershipChild(entry: "encode" | "decode", scenario: OwnershipScenario) {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const {homedir} = await import("node:os");
    const {spawnSync} = await import("node:child_process");
    if (!ownershipWorkspace) ownershipWorkspace = (async () => {
      const scratch=process.env.HERMES_S2_TEST_SCRATCH ?? path.join(homedir(),".hermes","cache","scratch");
      await fs.mkdir(scratch,{recursive:true});
      const dir=await fs.mkdtemp(path.join(scratch,"s2-ir02-supervised-children-"));
      await fs.writeFile(path.join(dir,"ownership.cjs"),ownershipChild);
      return dir;
    })();
    const dir=await ownershipWorkspace;
    const input=JSON.stringify(scenario.sequential?snapshot({[sporting(a)]:"synthetic-raw"}):empty());
    const args=["--unhandled-rejections=strict",path.join(dir,"ownership.cjs"),JSON.stringify({entry,scenario,input})];
    const child=spawnSync(process.execPath,args,{cwd:process.cwd(),encoding:"utf8",timeout:20000});
    const record={entry,scenario,command:[process.execPath,...args],exit:child.status,signal:child.signal,stdout:child.stdout,stderr:child.stderr,error:child.error?.message};
    const name=[entry,scenario.kind,scenario.poison,scenario.settle,scenario.timing,scenario.sequential?"sequential":"",scenario.kind==="invalid"?JSON.stringify(scenario.value):""].filter(Boolean).join("-").replace(/[^a-zA-Z0-9_-]/g,"_");
    await fs.writeFile(path.join(dir,name+".json"),JSON.stringify(record,null,2)+"\n");
    const output=process.env.HERMES_S2_TEST_RESULTS_DIR;
    if (output) await fs.writeFile(path.join(output,"s2-ir02-supervised-child-"+name+".json"),JSON.stringify(record,null,2)+"\n",{flag:"wx"});
    expect(child.error).toBeUndefined(); expect(child.signal).toBeNull();
    if (scenario.classification==="OUT_OF_CONTRACT_RESIDUAL") {
      // A passing witness assertion is NOT a containment pass: the real child fails.
      expect(child.status).toBe(1);
      expect(child.stderr).toContain("ERR_UNHANDLED_REJECTION");
      expect(child.stderr).toContain(scenario.kind==="derived-residual"?"SYNTHETIC_DERIVED_REJECTION":"SYNTHETIC_PROVIDER_REJECTION");
      expect(child.stderr).not.toContain("IR02_TEST_HARNESS_FAILURE");
    } else { expect(child.status,child.stderr).toBe(0); expect(child.stderr).toBe(""); }
    const observation=JSON.parse(child.stdout.trim());
    expect(observation.classification).toBe(scenario.classification);
    expect(observation.reasonReads).toBe(0); expect(observation.maskedReads).toBe(0);
    expect(observation.descriptorsPrototypesGlobalsIntrinsicsListenersUnchanged).toBe(true);
    if (scenario.classification!=="OUT_OF_CONTRACT_RESIDUAL") expect(observation.twoTurnsObserved).toBe(true);
  }
  it.each(["encode","decode"] as const)("IR02 supported primitive/native/masked/thenable ownership: %s", async entry => {
    const controls: OwnershipScenario[] = [
      ...["unavailable","primitive","throw","then-getter","then-call"].map(kind=>({kind,classification:"SUPPORTED" as const})),
      ...[null,0,true,"","A".repeat(64),"a".repeat(63)].map(value=>({kind:"invalid",value,classification:"SUPPORTED" as const})),
    ];
    for (const kind of ["native","masked","thenable"]) {
      for (const settle of ["success","invalid","reject"]) controls.push({kind,settle,classification:"SUPPORTED"});
      for (const settle of ["success","reject"]) controls.push({kind,settle,timing:"delayed",classification:"SUPPORTED"});
    }
    for (const kind of ["native","masked"]) for (const settle of ["success","reject"])
      controls.push({kind,settle,timing:"pending",sequential:true,classification:"SUPPORTED"});
    for (const control of controls) await runOwnershipChild(entry,control);
  },90000);
  it.each(["encode","decode"] as const)("IR02 supported creation-time and callback bridge ownership: %s", async entry => {
    for (const poison of ["constructor","species"]) for (const settle of ["success","reject"]) for (const timing of ["immediate","delayed","pending"])
      await runOwnershipChild(entry,{kind:"bridge",poison,settle,timing,sequential:timing==="pending",classification:"SUPPORTED"});
    for (const settle of ["success","reject"]) for (const timing of ["immediate","delayed","pending"])
      await runOwnershipChild(entry,{kind:"callback",settle,timing,sequential:timing==="pending",classification:"SUPPORTED"});
  },90000);
  it.each(["encode","decode"] as const)("IR02 OUT-OF-CONTRACT residual witnesses, NOT containment: %s", async entry => {
    for (const poison of ["constructor","species"]) for (const timing of ["immediate","delayed"])
      await runOwnershipChild(entry,{kind:"original-residual",poison,timing,classification:"OUT_OF_CONTRACT_RESIDUAL"});
    await runOwnershipChild(entry,{kind:"derived-residual",classification:"OUT_OF_CONTRACT_RESIDUAL"});
    for (const poison of ["constructor","species"])
      await runOwnershipChild(entry,{kind:"prehandled",poison,classification:"NONCONFORMING_PREHANDLED_CONTROL"});
  },90000);
  it("waits for real provider settlement, with only one sequential preimage in flight", async () => {
    let settle!:(s:string)=>void;let calls=0,finished=false;const pending=new Promise<string>(r=>{settle=r;});const buffers:Uint8Array[]=[];
    const result=encodeInstallationTransfer(JSON.stringify(snapshot({[sporting(a)]:"raw",[sporting(b)]:"other"})),(bytes:Uint8Array)=>{buffers.push(bytes);calls++;return calls===1?pending:fingerprint(bytes);}).then(r=>{finished=true;return r;});
    await Promise.resolve();await Promise.resolve();expect(calls).toBe(1);expect(finished).toBe(false);const first=Buffer.from(buffers[0]);settle(fingerprint(first));expect((await result).ok).toBe(true);expect(calls).toBe(3);expect(Buffer.from(buffers[0])).toEqual(first);expect(new Set(buffers).size).toBe(3);
  });
  it("does not inspect any hostile public data object", async () => {
    let touched=0;const p=new Proxy({}, {get(){touched++;throw 0;},getPrototypeOf(){touched++;throw 0;},ownKeys(){touched++;throw 0;}});
    for(const input of [p,new String("{}"),null,undefined,Symbol(),1,()=>0]){expect(await encodeInstallationTransfer(input,fingerprint)).toEqual(reject("invalid_input"));expect(await decodeInstallationTransfer(input,fingerprint)).toEqual(reject("invalid_input"));}expect(touched).toBe(0);
  });
  it("rejects trailing line terminators in Digests, Labels and UUIDs, never regex-dollar aliases", async () => {
    const s=snapshot();expect(await encodeInstallationTransfer(JSON.stringify(s),()=>"a".repeat(64)+"\n")).toEqual(reject("fingerprint_invalid"));
    for(const field of ["transferId","snapshotId"] as const){const bad={...s,[field]:s[field]+"\n"};expect(await encodeInstallationTransfer(JSON.stringify(bad),fingerprint)).toEqual(reject("invalid_envelope"));}
    s.sourceBuild.version="synthetic\n";expect(await encodeInstallationTransfer(JSON.stringify(s),fingerprint)).toEqual(reject("invalid_envelope"));
    const key="curling.identity.pendingIntent.v1";expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:JSON.stringify({...identityFixtures[key],value:b+"\n"})})),fingerprint)).toEqual(reject("sensitive_archive_unavailable"));
    const o=await envelope();o.packageDigest=(o.packageDigest as string)+"\n";expect(await decodeInstallationTransfer(canonical(o),fingerprint)).toEqual(reject("invalid_envelope"));
  });
  it("charges cumulative inner identity decoding against the outer work budget", async () => {
    const raws:Record<string,string>={[sporting(a)]:"x".repeat(1048576),[sporting(b)]:"x".repeat(1048576)};
    const example=identityFixtures[`curling.identity.accessBarrierResolution.${a}.v1`];
    for(let i=1;i<=18;i++) {const id=i.toString(16).padStart(8,"0")+"-0000-4000-8000-000000000001";const record={...example,barrierId:id,resolvedAt:"2026-10-21"+" ".repeat(Math.floor((3145728-2*1048576)/18)-JSON.stringify({...example,barrierId:id,resolvedAt:"2026-10-21"}).length)};expect(validateIdentityBarrierResolution(record)).not.toBeNull();raws[`curling.identity.accessBarrierResolution.${id}.v1`]=JSON.stringify(record);}
    expect(Object.values(raws).reduce((n,s)=>n+s.length,0)).toBeLessThanOrEqual(3145728);
    let calls=0;expect(await encodeInstallationTransfer(JSON.stringify(snapshot(raws)),()=>{calls++;return "a".repeat(64);})).toEqual(reject("limit_exceeded"));expect(calls).toBe(0);
  });
  it("precounts generated envelope plus inner-identity work before any fingerprint call", async () => {
    const raws:Record<string,string>={[sporting(a)]:"x".repeat(1048576),[sporting(b)]:"x".repeat(1048576)};
    const base=identityFixtures[`curling.identity.accessBarrierResolution.${a}.v1`];
    for(let i=1;i<=18;i++){const id=i.toString(16).padStart(8,"0")+"-0000-4000-8000-000000000001";const v={...base,barrierId:id,resolvedAt:"2026-10-21"};v.resolvedAt+=" ".repeat(58000-JSON.stringify(v).length);raws[`curling.identity.accessBarrierResolution.${id}.v1`]=JSON.stringify(v);}
    let calls=0;const actual=await encodeInstallationTransfer(JSON.stringify(snapshot(raws)),()=>{calls++;return "a".repeat(64);});expect(actual.ok).toBe(false);expect(actual).toEqual(reject("limit_exceeded"));expect(calls).toBe(0);
  });
  it("admits raw before key without allocation-order dependence, and never mutates caller input", async () => {
    const key="curling.identity.intentCleanup.v1", raw=JSON.stringify(identityFixtures[key]);const s=snapshot({[key]:raw});
    const reordered={...s,observations:s.observations.map(o=>o.raw!==undefined?{raw:o.raw,state:o.state,key:o.key}:o)};const input=JSON.stringify(reordered);const frozen=Object.freeze(reordered);const r=await encodeInstallationTransfer(input,()=>{expect(JSON.stringify(frozen)).toBe(input);return "a".repeat(64);});expect(r.ok).toBe(true);
    const oversized={...reordered,observations:reordered.observations.map(o=>o.key===key?{raw:"x".repeat(65537),state:"present",key}:o)};expect(await encodeInstallationTransfer(JSON.stringify(oversized),fingerprint)).toEqual(reject("limit_exceeded"));
  });
  it("enforces raw/item/identity/legacy/label and aggregate budgets before provider callbacks", async () => {
    const tooLarge=snapshot({[sporting(a)]:"x".repeat(1048577)});let calls=0;const provider=()=>{calls++;return "a".repeat(64);};expect(await encodeInstallationTransfer(JSON.stringify(tooLarge),provider)).toEqual(reject("limit_exceeded"));expect(calls).toBe(0);
    const raws:Record<string,string>={};for(const suffix of suffixes.slice(0,3))raws[sporting(a,suffix)]="x".repeat(1048576);expect((await encodeInstallationTransfer(JSON.stringify(snapshot(raws)),fingerprint)).ok).toBe(true);raws[sporting(a,suffixes[3])]="x";calls=0;expect(await encodeInstallationTransfer(JSON.stringify(snapshot(raws)),provider)).toEqual(reject("limit_exceeded"));expect(calls).toBe(0);
    const key="curling.identity.intentCleanup.v1";const raw=JSON.stringify(identityFixtures[key]).padEnd(65536," ");expect((await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:raw})),fingerprint)).ok).toBe(true);expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[key]:raw+" "})),provider)).toEqual(reject("limit_exceeded"));
    for(const n of [8,9])expect(await encodeInstallationTransfer(JSON.stringify(snapshot({[fixed[5]]:"x".repeat(n)})),provider)).toEqual(reject(n===8?"source_unhealthy":"limit_exceeded"));
    const s=snapshot();s.sourceBuild.version="x".repeat(64);expect((await encodeInstallationTransfer(JSON.stringify(s),fingerprint)).ok).toBe(true);s.sourceBuild.version+="x";expect(await encodeInstallationTransfer(JSON.stringify(s),provider)).toEqual(reject("limit_exceeded"));
    const o=await envelope();o.items=Array.from({length:1024},()=>items(o)[0]);expect(await decodeInstallationTransfer(canonical(o),provider)).toEqual(reject("incomplete_inventory"));o.items=[...o.items as Json[],items(o)[0]];expect(await decodeInstallationTransfer(canonical(o),provider)).toEqual(reject("limit_exceeded"));
    expect(await encodeInstallationTransfer('{"raw":"'+"\\u0078".repeat(1048577)+'"}',provider)).toEqual(reject("limit_exceeded"));
  });
});
