import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { encodeInstallationTransfer, decodeInstallationTransfer, encodeInstallationTransferV2, decodeInstallationTransferV2 } from "../installationTransferCodec";
import { planInstallationTransferInventory, planInstallationTransferInventoryV2, type Json, type JsonObject } from "../installationTransferInventory";
import { DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX, isAccountDeletionGuardStorageKey, isAccountDeletionGuardResolutionStorageKey, validDeletionRevision, createAccountDeletionGuardRepository } from "../../identity/accountDeletionGuard";
import type { StorageAdapter } from "../types";
import { decideInstallationTransfer } from "../installationTransferDecision";

const a = "10000000-0000-4000-8000-000000000001";
const b = "20000000-0000-4000-8000-000000000002";
const nonce = "30000000-0000-4000-8000-000000000003";
const oldNonce = "40000000-0000-4000-8000-000000000004";
const guardKey = (id = a) => `curling.identity.accountDeletionGuard.${id}.v1`;
const resolutionKey = (id = nonce) => `curling.identity.accountDeletionGuardResolution.${id}.v1`;
const barrierKey = (id = b) => `curling.identity.accessBarrierResolution.${id}.v1`;
const sportingKey = `curling.sporting.profile.v1.${a}.curling-release-tracker-current-session`;
const fixed = ["curling.identity.trustedDevice.v1", "curling.identity.accessBarrier.v1", "curling.identity.interactiveAttempt.v1", "curling.identity.pendingIntent.v1", "curling.identity.intentCleanup.v1", "curling.sporting.legacy-unscoped-retired.v1"].sort();
const suffixes = ["curling-release-tracker-current-session", "curling-release-tracker-session-history", "curling-release-tracker-history-filters", "curling-release-tracker-assessment-data", "curling-release-tracker-training-plans", "curling-release-tracker-accuracy-tolerance-profiles", "curling-release-tracker-smart-random-profiles", "curling-release-tracker-assessment-show-introduction", "curling-release-tracker-assessment-last-threshold-preset", "curling-release-tracker-assessment-last-custom-threshold", "curling-release-tracker-assessment-draft", "curling-release-tracker-assessment-history", "curling-release-tracker-cloud-sporting-sync"];
const guard = (profileId = a, operation = nonce, revision = 4) => ({schemaVersion:1,profileId,nonce:operation,revision});
const resolution = (profileId = a, operation = nonce, fencedRevision = 5) => ({schemaVersion:1,profileId,nonce:operation,fencedRevision});
const barrier = (id = b) => ({schemaVersion:1,barrierId:id,attemptId:a,method:"email_otp",flowId:null,identityGeneration:2,authenticatedAccountScopeId:"synthetic-account",resolvedAt:"2026-10-25T00:00:00.000Z"});
type Observation = {key:string;state:string;raw?:string};
function snapshot(raws: Record<string,string> = {}) {
  const profiles = [...new Set(Object.keys(raws).filter(key => key.startsWith("curling.sporting.profile.v1.")).map(key => key.slice("curling.sporting.profile.v1.".length,"curling.sporting.profile.v1.".length+36)))];
  // Names come from the synthetic listing, independently of the SUT classifier.
  const dynamic = Object.keys(raws).filter(key => key.startsWith("curling.identity.") && !fixed.includes(key));
  const keys = [...fixed,...dynamic,...profiles.flatMap(id => suffixes.map(suffix => `curling.sporting.profile.v1.${id}.${suffix}`))].sort();
  return {schemaVersion:2,transferId:"50000000-0000-4000-8000-000000000005",snapshotId:"60000000-0000-4000-8000-000000000006",sourceBuild:{version:"synthetic-1",build:"test-1"},catalogContractId:"synthetic-catalog-v1",listing:{schemaVersion:1,keys:Object.keys(raws).sort()},observations:keys.map(key => Object.hasOwn(raws,key) ? {key,state:"present",raw:raws[key]} : {key,state:"absent"}) as Observation[],sourceControl:{domain:"absent",credential:"excluded"},snapshotState:"synthetic_frozen"};
}
const fp = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const refusal = (code: string) => ({ok:false,code});
const listing = (keys: string[]) => JSON.stringify({schemaVersion:1,keys:[...keys].sort()});
const itemList = (o: JsonObject) => o.items as JsonObject[];
async function encoded(raws: Record<string,string> = {}) {
  const result = await encodeInstallationTransferV2(JSON.stringify(snapshot(raws)),fp);
  expect(result.ok,JSON.stringify(result)).toBe(true);
  if (!result.ok) throw Error("Synthetic archive refused");
  return result.value;
}
async function envelope(raws: Record<string,string> = {}): Promise<JsonObject> { return JSON.parse((await encoded(raws)).wire); }
// Independent canonical and typed byte oracles, never production helpers.
function canonical(value: Json): string {
  if (typeof value === "string") return '"' + Array.from({length:value.length},(_,i) => "\\u" + value.charCodeAt(i).toString(16).padStart(4,"0")).join("") + '"';
  if (value === null || typeof value !== "object") return String(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  return "{" + Object.keys(value).sort().map(key => canonical(key) + ":" + canonical(value[key])).join(",") + "}";
}
function uint64(n: number): Buffer { const bytes=Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(n)); return bytes; }
function utf16(value: string): Buffer { const bytes=Buffer.alloc(value.length*2); for(let i=0;i<value.length;i++)bytes.writeUInt16BE(value.charCodeAt(i),i*2); return Buffer.concat([uint64(value.length),bytes]); }
function typed(value: Json): Buffer {
  if (value === null) return Buffer.from([0]);
  if (typeof value === "boolean") return Buffer.from([value?2:1]);
  if (typeof value === "number") return Buffer.concat([Buffer.from([3]),uint64(value)]);
  if (typeof value === "string") return Buffer.concat([Buffer.from([4]),utf16(value)]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from([5]),uint64(value.length),...value.map(typed)]);
  const keys=Object.keys(value).sort(); return Buffer.concat([Buffer.from([6]),uint64(keys.length),...keys.flatMap(key => [utf16(key),typed(value[key])])]);
}
function preimage(value: Json, purpose: string): Buffer { return Buffer.concat([Buffer.from(purpose,"ascii"),Buffer.from([0]),typed(value)]); }

describe("explicit inactive installation archive v2", () => {
  it("pins new key grammar to actual guard declarations without importing a repository into production", () => {
    expect(DELETION_GUARD_PREFIX).toBe("curling.identity.accountDeletionGuard.");
    expect(DELETION_GUARD_RESOLUTION_PREFIX).toBe("curling.identity.accountDeletionGuardResolution.");
    expect(isAccountDeletionGuardStorageKey(guardKey())).toBe(true);
    expect(isAccountDeletionGuardResolutionStorageKey(resolutionKey())).toBe(true);
    for(const revision of [0,1,2147483646]) expect(validDeletionRevision(revision)).toBe(true);
    for(const revision of [-1,0.5,2147483647,9007199254740992,NaN,Infinity,"1"]) expect(validDeletionRevision(revision)).toBe(false);
  });
  it("plans all three dynamic families together, with no fabricated profiles or dynamic absences", () => {
    const keys=[guardKey(),resolutionKey(),barrierKey()];
    const result=planInstallationTransferInventoryV2(listing(keys)); expect(result.ok).toBe(true); if(!result.ok)return;
    expect(result.value).toEqual({profiles:[],dynamicIdentity:[...keys].sort(),rawReads:[...keys].sort(),absenceProbes:fixed,controlHealthKeys:[],exclusions:{providerCredentials:0,retiredUnscoped:0,publicCaches:0,foreignKeys:0}});
    expect(Object.isFrozen(result.value.dynamicIdentity)).toBe(true);
    expect(Reflect.ownKeys(result.value)).not.toContain("resolved");
  });
  it.each([
    ["unresolved guard",{[guardKey()]:JSON.stringify(guard())}],
    ["matching receipt",{[guardKey()]:JSON.stringify(guard()),[resolutionKey()]:JSON.stringify(resolution())}],
    ["orphan receipt",{[resolutionKey()]:JSON.stringify(resolution())}],
    ["old nonce",{[guardKey()]:JSON.stringify(guard()),[resolutionKey(oldNonce)]:JSON.stringify(resolution(a,oldNonce,1))}],
    ["all families",{[guardKey()]:JSON.stringify(guard()),[resolutionKey()]:JSON.stringify(resolution()),[barrierKey()]:JSON.stringify(barrier())}],
  ])("roundtrips %s without sporting or identity authority", async (_name,raws) => {
    const result=await encoded(raws); const decoded=await decodeInstallationTransferV2(result.wire,fp);
    expect(decoded.ok).toBe(true); if(!decoded.ok)return;
    const o=decoded.value.envelope; expect(o.profiles).toEqual([]); expect(o.formatVersion).toBe(2);
    expect(o.fingerprintContract).toBe("injected-256-v2"); expect(decoded.value.semanticStatus).toBe("not_evaluated");
    expect(o.dynamicIdentity).toEqual({enumeration:"complete",keys:Object.keys(raws).sort()});
    expect(itemList(o)).toHaveLength(6+Object.keys(raws).length);
    for(const [key,raw] of Object.entries(raws))expect(itemList(o).find(item => item.key===key)).toMatchObject({category:"identity_archive",profileId:null,presence:"present",raw,codeUnits:raw.length});
    expect(Object.isFrozen(o)).toBe(true); expect(Object.isFrozen(itemList(o)[0])).toBe(true);
  });
  it("preserves exact raw whitespace, key order and escapes, and only actual sporting keys derive profiles", async () => {
    const raw=' \n{ "revision" : 4, "nonce":"'+nonce+'", "schemaVersion":1,"profileId":"'+a.replace("1","\\u0031")+'" }\t';
    const o=await envelope({[guardKey()]:raw,[sportingKey]:"\ud800\u0000e\u0301"});
    expect(itemList(o).find(item => item.key===guardKey())?.raw).toBe(raw);
    expect(o.profiles).toEqual([a]); expect(itemList(o)).toHaveLength(20);
    expect(itemList(o).find(item => item.key===guardKey())?.profileId).toBeNull();
  });
  it("keeps v1 defaults, new-family refusal and both wire/snapshot version refusals", async () => {
    for(const key of [guardKey(),resolutionKey()])expect(planInstallationTransferInventory(listing([key]))).toEqual(refusal("unknown_owned_family"));
    expect(await encodeInstallationTransfer(JSON.stringify({...snapshot(),schemaVersion:1,listing:{schemaVersion:1,keys:[guardKey()]}}),fp)).toEqual(refusal("unknown_owned_family"));
    expect(await encodeInstallationTransferV2(JSON.stringify({...snapshot(),schemaVersion:1}),fp)).toEqual(refusal("invalid_envelope"));
    expect(await encodeInstallationTransfer(JSON.stringify(snapshot()),fp)).toEqual(refusal("invalid_envelope"));
    const v1=await encodeInstallationTransfer(JSON.stringify({...snapshot(),schemaVersion:1}),fp); expect(v1.ok).toBe(true); if(!v1.ok)return;
    expect(await decodeInstallationTransferV2(v1.value.wire,fp)).toEqual(refusal("unsupported_format"));
    expect(await decodeInstallationTransfer((await encoded()).wire,fp)).toEqual(refusal("unsupported_format"));
  });
  it.each([".v2",".v1.extra",".v1\n","", ".v01"])("refuses unknown owned deletion suffix %s before fingerprints", async suffix => {
    for(const prefix of [DELETION_GUARD_PREFIX,DELETION_GUARD_RESOLUTION_PREFIX]) {
      const key=prefix+a+suffix; expect(planInstallationTransferInventoryV2(listing([key]))).toEqual(refusal("unknown_owned_family"));
      let calls=0;expect(await encodeInstallationTransferV2(JSON.stringify(snapshot({[key]:"not-read"})),()=>{calls++;return "a".repeat(64);})).toEqual(refusal("unknown_owned_family"));expect(calls).toBe(0);
    }
  });
  it.each([a.toUpperCase().replace("10000000","A0000000"),"00000000-0000-0000-0000-000000000000",a+" ",a.replace("4000","0000")])("refuses malformed dynamic selector %s", selector => {
    expect(planInstallationTransferInventoryV2(listing([guardKey(selector)]))).toEqual(refusal("unknown_owned_family"));
    expect(planInstallationTransferInventoryV2(listing([resolutionKey(selector)]))).toEqual(refusal("unknown_owned_family"));
  });
  it.each(["guard profile","receipt nonce","receipt profile","same fence","lower fence"])("refuses actual operation contradiction: %s", async kind => {
    const g=guard(); const r=resolution();
    if(kind==="guard profile")g.profileId=b;
    if(kind==="receipt nonce")r.nonce=oldNonce;
    if(kind==="receipt profile")r.profileId=b;
    if(kind==="same fence")r.fencedRevision=g.revision;
    if(kind==="lower fence")r.fencedRevision=g.revision-1;
    let calls=0;const provider=()=>{calls++;return "a".repeat(64);};
    expect(await encodeInstallationTransferV2(JSON.stringify(snapshot({[guardKey()]:JSON.stringify(g),[resolutionKey()]:JSON.stringify(r)})),provider)).toEqual(refusal("identity_archive_unsupported"));expect(calls).toBe(0);
    const o=await envelope({[guardKey()]:JSON.stringify(guard()),[resolutionKey()]:JSON.stringify(resolution())});
    itemList(o).find(item=>item.key===(kind==="guard profile"?guardKey():resolutionKey()))!.raw=JSON.stringify(kind==="guard profile"?g:r);
    for(const item of itemList(o))if(item.presence==="present")item.codeUnits=(item.raw as string).length;
    expect(await decodeInstallationTransferV2(canonical(o),provider)).toEqual(refusal("identity_archive_unsupported"));expect(calls).toBe(0);
  });
  it.each([0,2147483646])("archives unresolved/orphan revision boundary %s", async revision => {
    for(const raws of [{[guardKey()]:JSON.stringify(guard(a,nonce,revision))},{[resolutionKey()]:JSON.stringify(resolution(a,nonce,revision))}])expect((await encodeInstallationTransferV2(JSON.stringify(snapshot(raws)),fp)).ok).toBe(true);
  });
  it.each([-1,0.1,2147483647,9007199254740992])("refuses unsupported revision %s", async revision => {
    for(const raws of [{[guardKey()]:JSON.stringify(guard(a,nonce,revision))},{[resolutionKey()]:JSON.stringify(resolution(a,nonce,revision))}])expect(await encodeInstallationTransferV2(JSON.stringify(snapshot(raws)),fp)).toEqual(refusal("identity_archive_unsupported"));
  });
  it.each(["extra","schema","uuid","duplicate","escaped duplicate","fraction","negative zero","malformed","array","null"])("refuses strict unknown control form: %s", async mutation => {
    for(const [key,base] of [[guardKey(),guard()],[resolutionKey(),resolution()]] as const) {
      let raw=JSON.stringify(base);
      if(mutation==="extra")raw=JSON.stringify({...base,access_token:"synthetic"});
      if(mutation==="schema")raw=JSON.stringify({...base,schemaVersion:2});
      if(mutation==="uuid")raw=JSON.stringify({...base,profileId:a+"\n"});
      if(mutation==="duplicate")raw=raw.replace("{",'{"schemaVersion":1,');
      if(mutation==="escaped duplicate")raw=raw.replace("{",'{"schema\\u0056ersion":1,');
      if(mutation==="fraction")raw=raw.replace(':4',':4.1').replace(':5',':5.1');
      if(mutation==="negative zero")raw=raw.replace(':4',':-0').replace(':5',':-0');
      if(mutation==="malformed")raw="{malformed";
      if(mutation==="array")raw="[]";
      if(mutation==="null")raw="null";
      expect(await encodeInstallationTransferV2(JSON.stringify(snapshot({[key]:raw})),fp)).toEqual(refusal("identity_archive_unsupported"));
    }
  });
  it.each(["omitted","extra","duplicate","absent","unobserved","unreadable"])("does not silently discard dynamic source observations: %s", async change => {
    const s=snapshot({[guardKey()]:JSON.stringify(guard())});const index=s.observations.findIndex(item=>item.key===guardKey());
    if(change==="omitted")s.observations.splice(index,1);
    if(change==="extra")s.observations.push({key:resolutionKey(),state:"absent"});
    if(change==="duplicate")s.observations.push(s.observations[index]);
    if(["absent","unobserved","unreadable"].includes(change))s.observations[index]={key:guardKey(),state:change};
    s.observations.sort((x,y)=>x.key<y.key?-1:x.key>y.key?1:0);
    expect(await encodeInstallationTransferV2(JSON.stringify(s),fp)).toEqual(refusal(["unobserved","unreadable"].includes(change)?"source_unobserved":"incomplete_inventory"));
  });
  it("requires every declared dynamic item present on decode, with exact descriptor and complete counts", async () => {
    for(const mutate of [
      (o:JsonObject)=>{itemList(o).splice(itemList(o).findIndex(item=>item.key===guardKey()),1);},
      (o:JsonObject)=>{const item=itemList(o).find(item=>item.key===guardKey())!;item.presence="absent";delete item.raw;delete item.codeUnits;delete item.valueDigest;},
      (o:JsonObject)=>{itemList(o).find(item=>item.key===guardKey())!.profileId=a;},
      (o:JsonObject)=>{itemList(o).find(item=>item.key===guardKey())!.domainContract="identity-barrierResolution-v1";},
      (o:JsonObject)=>{(o.dynamicIdentity as JsonObject).keys=[];},
      (o:JsonObject)=>{(o.counts as JsonObject).dynamicIdentity=0;},
    ]) { const o=await envelope({[guardKey()]:JSON.stringify(guard())}); mutate(o); let calls=0;const result=await decodeInstallationTransferV2(canonical(o),()=>{calls++;return "a".repeat(64);}); expect(result.ok).toBe(false);expect(calls).toBe(0); }
  });
  it("jointly caps all dynamic families and does not invent absent names", () => {
    const keys=Array.from({length:513},(_,i)=>{
      const id=(i+1).toString(16).padStart(8,"0")+"-0000-4000-8000-000000000001";
      return i%3===0?guardKey(id):i%3===1?resolutionKey(id):barrierKey(id);
    });
    const admitted=planInstallationTransferInventoryV2(listing(keys.slice(0,512)));expect(admitted.ok).toBe(true);if(admitted.ok){expect(admitted.value.dynamicIdentity).toHaveLength(512);expect(admitted.value.absenceProbes).toEqual(fixed);}
    expect(planInstallationTransferInventoryV2(listing(keys))).toEqual(refusal("limit_exceeded"));
  });
  it("applies identity raw admission before copying even when raw precedes key", async () => {
    for(const key of [guardKey(),resolutionKey()]) {
      const base=key===guardKey()?guard():resolution();const raw=JSON.stringify(base).padEnd(65536," ");
      const s=snapshot({[key]:raw});s.observations=s.observations.map(item=>item.raw===undefined?item:{raw:item.raw,state:item.state,key:item.key});
      expect((await encodeInstallationTransferV2(JSON.stringify(s),fp)).ok).toBe(true);
      s.observations=s.observations.map(item=>item.key===key?{raw:raw+" ",state:"present",key}:item);
      let calls=0;expect(await encodeInstallationTransferV2(JSON.stringify(s),()=>{calls++;return "a".repeat(64);})).toEqual(refusal("limit_exceeded"));expect(calls).toBe(0);
      const o=await envelope({[key]:JSON.stringify(base)});const item=itemList(o).find(item=>item.key===key)!;item.raw=raw+" ";item.codeUnits=65537;
      const reordered={...o,items:itemList(o).map(i=>i.key===key?{raw:i.raw,...Object.fromEntries(Object.entries(i).filter(([name])=>name!=="raw"))}:i)};
      expect(await decodeInstallationTransferV2(JSON.stringify(reordered),()=>{calls++;return "a".repeat(64);})).toEqual(refusal("limit_exceeded"));expect(calls).toBe(0);
    }
  });
  it("charges shared outer plus inner decoding before fingerprints, including generated envelope work", async () => {
    const raws:Record<string,string>={};
    // Existing supported identity strings share the same outer/inner decode budget.
    for(let i=0;i<34;i++){
      const id=(i+1).toString(16).padStart(8,"0")+"-0000-4000-8000-000000000001";
      raws[barrierKey(id)]=JSON.stringify({...barrier(id),resolvedAt:"2026-10-25"+" ".repeat(64000)});
    }
    let calls=0;expect(await encodeInstallationTransferV2(JSON.stringify(snapshot(raws)),()=>{calls++;return "a".repeat(64);})).toEqual(refusal("limit_exceeded"));expect(calls).toBe(0);
  });
  it("preserves confidentiality and refuses unsupported owned controls without values or fingerprints", async () => {
    const result=planInstallationTransferInventoryV2(listing([guardKey(),"sb-synthetic-auth-token","sb-synthetic-auth-token-code-verifier","curling-release-tracker-current-session","foreign"]));
    expect(result.ok).toBe(true);if(result.ok){expect(result.value.rawReads).toEqual([guardKey()]);expect(result.value.exclusions).toEqual({providerCredentials:2,retiredUnscoped:1,publicCaches:0,foreignKeys:1});}
    for(const key of ["curling.credential.M.v1","curling.nativeMigration.Q.v1","curling.identity.accountDeletionGuard.unknown.v1"]){expect(planInstallationTransferInventoryV2(listing([guardKey(),key]))).toEqual(refusal("unknown_owned_family"));}
    const pending="curling.identity.pendingIntent.v1";expect(await encodeInstallationTransferV2(JSON.stringify(snapshot({[pending]:'{"kind":"invitation","value":"synthetic"}'})),fp)).toEqual(refusal("sensitive_archive_unavailable"));
  });
  it("pins an independent exact empty-package byte and wire golden with v2 domains", async () => {
    const expected:JsonObject={format:"curling-installation-transfer",formatVersion:2,fingerprintContract:"injected-256-v2",transferId:"50000000-0000-4000-8000-000000000005",snapshotId:"60000000-0000-4000-8000-000000000006",sourceBundleId:"local.dev.curlingperformance",intendedDestination:"me.evolane.curling",sourceBuild:{version:"synthetic-1",build:"test-1"},provenance:{inventoryContract:"profile13-identity5-resolution-deletion-legacy-v2",schemaInterpretation:"opaque-preserved",catalogContractId:"synthetic-catalog-v1",domainControl:"absent",credentialControl:"excluded-not-copied",authority:"snapshot-only"},profiles:[],dynamicIdentity:{enumeration:"complete",keys:[]},items:fixed.map(key=>({key,category:key.includes("legacy-unscoped")?"legacy_archive":"identity_archive",profileId:null,domainContract:key.includes("legacy-unscoped")?"legacy-retirement-v1":"identity-"+key.split(".")[2]+"-v1",presence:"absent"})),counts:{slots:6,present:0,absent:6,profiles:0,dynamicIdentity:0,rawCodeUnits:0},exclusions:{providerCredentials:"never-read",protectedCredentialControls:"never-read",retiredUnscoped:"never-read-never-adopt",publicCaches:"reconstructible-not-copied",bundleCatalogs:"references-only-not-copied",exportCache:"not-a-backup",foreignKeys:"untouched"},completeness:"complete-stored-inventory-with-declared-exclusions",credentialPolicy:"fresh-reauth-no-provider-values-verifiers-or-credential-hashes"};
    const bytes=preimage(expected,"curling-transfer-package/v2");const captured:Buffer[]=[];
    const result=await encodeInstallationTransferV2(JSON.stringify(snapshot()),(value:Uint8Array)=>{captured.push(Buffer.from(value));return fp(value);});
    expect(captured).toEqual([bytes]);expect(result).toEqual({ok:true,value:{wire:canonical({...expected,packageDigest:fp(bytes)}),packageDigest:fp(bytes)}});
    if(!result.ok)return;expect(await decodeInstallationTransferV2(result.value.wire,fp)).toMatchObject({ok:true,value:{semanticStatus:"not_evaluated"}});
    const raw=JSON.stringify(guard());const valueBytes=preimage(raw,"curling-transfer-value/v2");
    const expectedGuard={...expected,dynamicIdentity:{enumeration:"complete",keys:[guardKey()]},items:[...itemList(expected),{key:guardKey(),category:"identity_archive",profileId:null,domainContract:"identity-accountDeletionGuard-v1",presence:"present",raw,codeUnits:raw.length,valueDigest:fp(valueBytes)}].sort((x,y)=>(x.key as string)<(y.key as string)?-1:1),counts:{slots:7,present:1,absent:6,profiles:0,dynamicIdentity:1,rawCodeUnits:raw.length}};
    const packageBytes=preimage(expectedGuard,"curling-transfer-package/v2");const guardCaptured:Buffer[]=[];
    const guardResult=await encodeInstallationTransferV2(JSON.stringify(snapshot({[guardKey()]:raw})),(value:Uint8Array)=>{guardCaptured.push(Buffer.from(value));return fp(value);});
    expect(guardCaptured).toEqual([valueBytes,packageBytes]);expect(guardResult).toEqual({ok:true,value:{wire:canonical({...expectedGuard,packageDigest:fp(packageBytes)}),packageDigest:fp(packageBytes)}});
  });
  it.each(["","e\u0301\u0000\ud800\udc00","\ud800\ufffd"])("pins UTF-16 value bytes and v1/v2 domain separation: %j", async raw => {
    const input=snapshot({[sportingKey]:raw});const v2Bytes:Buffer[]=[];const v1Bytes:Buffer[]=[];
    const v2Result=await encodeInstallationTransferV2(JSON.stringify(input),(bytes:Uint8Array)=>{v2Bytes.push(Buffer.from(bytes));return fp(bytes);});
    const v1Result=await encodeInstallationTransfer(JSON.stringify({...input,schemaVersion:1}),(bytes:Uint8Array)=>{v1Bytes.push(Buffer.from(bytes));return fp(bytes);});
    expect(v2Result.ok).toBe(true);expect(v1Result.ok).toBe(true);
    expect(v2Bytes[0]).toEqual(preimage(raw,"curling-transfer-value/v2"));expect(v1Bytes[0]).toEqual(preimage(raw,"curling-transfer-value/v1"));expect(v2Bytes[0]).not.toEqual(v1Bytes[0]);
    if(v2Result.ok&&v1Result.ok)expect(v2Result.value.packageDigest).not.toBe(v1Result.value.packageDigest);
  });
  it("recomputes digests and canonical wire; routing changes and wire whitespace never gain authority", async () => {
    const original=await encoded({[guardKey()]:JSON.stringify(guard())});
    expect(await decodeInstallationTransferV2(original.wire+" ",fp)).toEqual(refusal("noncanonical_wire"));
    const o=JSON.parse(original.wire) as JsonObject;const item=itemList(o).find(item=>item.key===guardKey())!;item.raw=(item.raw as string).replace('"revision":4','"revision":3');
    expect(await decodeInstallationTransferV2(canonical(o),fp)).toEqual(refusal("digest_mismatch"));
    o.formatVersion=3;expect(await decodeInstallationTransferV2(canonical(o),fp)).toEqual(refusal("unsupported_format"));
  });
  it("pins archival correlation against actual repository semantics without live storage", async () => {
    const raws=new Map([[guardKey(),JSON.stringify(guard())],[resolutionKey(),JSON.stringify(resolution())]]);
    const adapter:StorageAdapter={async get(key){return {status:"value",value:raws.get(key)??null};},async set(){throw Error("must not write");}};
    const repo=createAccountDeletionGuardRepository(adapter);
    expect(await repo.load(a)).toMatchObject({status:"guard",resolved:true});expect((await encodeInstallationTransferV2(JSON.stringify(snapshot(Object.fromEntries(raws))),fp)).ok).toBe(true);
    raws.set(resolutionKey(),JSON.stringify(resolution(b)));expect(await repo.load(a)).toEqual({status:"unavailable"});expect(await encodeInstallationTransferV2(JSON.stringify(snapshot(Object.fromEntries(raws))),fp)).toEqual(refusal("identity_archive_unsupported"));
    raws.delete(resolutionKey());raws.set(resolutionKey(oldNonce),JSON.stringify(resolution(a,oldNonce)));expect(await repo.load(a)).toMatchObject({status:"guard",resolved:false});expect((await encodeInstallationTransferV2(JSON.stringify(snapshot(Object.fromEntries(raws))),fp)).ok).toBe(true);
  });
  it("retains primitive-only admission and opaque asynchronous fingerprint failures", async () => {
    let touched=0;const hostile=new Proxy({}, {get(){touched++;throw 0;},ownKeys(){touched++;throw 0;},getPrototypeOf(){touched++;throw 0;}});
    for(const input of [hostile,new String("{}"),undefined,null,1,Symbol()]){
      expect(planInstallationTransferInventoryV2(input)).toEqual(refusal("invalid_input"));expect(await encodeInstallationTransferV2(input,fp)).toEqual(refusal("invalid_input"));expect(await decodeInstallationTransferV2(input,fp)).toEqual(refusal("invalid_input"));
    }
    expect(await encodeInstallationTransferV2(JSON.stringify(snapshot()),()=>Promise.reject(hostile))).toEqual(refusal("fingerprint_failed"));
    expect(await decodeInstallationTransferV2((await encoded()).wire,()=>Promise.reject(hostile))).toEqual(refusal("fingerprint_failed"));
    expect(touched).toBe(0);
    expect(await encodeInstallationTransferV2(JSON.stringify(snapshot()),undefined)).toEqual(refusal("fingerprint_unavailable"));
    expect(await encodeInstallationTransferV2(JSON.stringify(snapshot()),()=>false)).toEqual(refusal("fingerprint_invalid"));
  });
  it.each(["native","masked","thenable","then getter","sync throw"])("keeps supported provider observation contained: %s", async kind => {
    let reasonReads=0,maskedReads=0;
    const opaque=new Proxy({}, {get(){reasonReads++;throw 0;},ownKeys(){reasonReads++;throw 0;},getPrototypeOf(){reasonReads++;throw 0;}});
    const provider=()=>{
      if(kind==="sync throw")throw opaque;
      if(kind==="then getter")return Object.defineProperty({},"then",{get(){throw opaque;}});
      if(kind==="thenable")return {then(_resolve:unknown,reject:(reason:unknown)=>void){reject(opaque);}};
      const promise=Promise.reject(opaque);
      if(kind==="masked")Object.defineProperty(promise,"then",{get(){maskedReads++;throw opaque;}});
      return promise;
    };
    expect(await encodeInstallationTransferV2(JSON.stringify(snapshot()),provider)).toEqual(refusal("fingerprint_failed"));
    expect(await decodeInstallationTransferV2((await encoded()).wire,provider)).toEqual(refusal("fingerprint_failed"));
    await new Promise<void>(resolve=>setImmediate(resolve));expect(reasonReads).toBe(0);expect(maskedReads).toBe(0);
  });
  it("waits for real settlement and keeps only one sequential preimage in flight", async () => {
    let settle!:(value:string)=>void;let calls=0,done=false;const buffers:Buffer[]=[];
    const pending=new Promise<string>(resolve=>{settle=resolve;});
    const operation=encodeInstallationTransferV2(JSON.stringify(snapshot({[guardKey()]:JSON.stringify(guard())})),(bytes:Uint8Array)=>{calls++;buffers.push(Buffer.from(bytes));return calls===1?pending:fp(bytes);}).then(result=>{done=true;return result;});
    await Promise.resolve();await Promise.resolve();expect(calls).toBe(1);expect(done).toBe(false);
    settle(fp(buffers[0]));expect((await operation).ok).toBe(true);expect(calls).toBe(2);expect(buffers[0]).toEqual(preimage(JSON.stringify(guard()),"curling-transfer-value/v2"));
  });
  it("keeps the existing decision contract refusal-only", () => {
    const result=decideInstallationTransfer(JSON.stringify({schemaVersion:1,kind:"readiness",package:"valid",source:"frozen",target:"clean",request:"access",proof:"imported_trusted",semantic:"candidate",receipt:"external_verified"}));
    expect(result).toEqual({ok:true,value:{kind:"no_portable_identity_grant",mayIssue:false,mayPublish:false,mayMount:false,ownerMustRemain:false}});
  });
});
