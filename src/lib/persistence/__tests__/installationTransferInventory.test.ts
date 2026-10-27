import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { encodeInstallationTransfer, decodeInstallationTransfer } from "../installationTransferCodec";

// Plain test-only wrapper: spy wrappers inspect thrown values with instanceof.
// Delegate to the real shared helper except during the bounded fault injection.
const uuidFault = vi.hoisted(() => ({active:false,reason:undefined as unknown,calls:0}));
vi.mock("../../uuid", async importOriginal => {
  const actual = await importOriginal<typeof import("../../uuid")>();
  return {...actual,isCanonicalUuid(value: unknown) {
    if (uuidFault.active) { uuidFault.calls++; throw uuidFault.reason; }
    return actual.isCanonicalUuid(value);
  }};
});
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { planInstallationTransferInventory, parseTransferJson, fail, failure, type TransferCode, checkedAdd, checkedMultiply, unitOrder, TRANSFER_SPORTING_SUFFIXES, TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, TRANSFER_PROFILE_PREFIX, TRANSFER_LIMITS } from "../installationTransferInventory";
import { NATIVE_MIGRATION_PROFILE_SPORTING_KEYS, NATIVE_MIGRATION_IDENTITY_FIXED_KEYS, NATIVE_MIGRATION_LEGACY_RETIREMENT_MARKER_KEY } from "../nativeMigrationEligibility";
import { SPORTING_STORAGE_KEYS } from "../profileScopedSportingPersistence";
import { ASSESSMENT_DRAFT_STORAGE_KEY, ASSESSMENT_HISTORY_STORAGE_KEY } from "../../assessment/persistence";
import { CLOUD_SPORTING_SYNC_STORAGE_KEY } from "../../cloudSporting/syncStateRepository";
import { isCanonicalUuid } from "../../uuid";
const fixed = ["curling.identity.trustedDevice.v1", "curling.identity.accessBarrier.v1", "curling.identity.interactiveAttempt.v1", "curling.identity.pendingIntent.v1", "curling.identity.intentCleanup.v1", "curling.sporting.legacy-unscoped-retired.v1"].sort();
// Deliberately cross the static annotation to exercise the JavaScript boundary.
function refusalSignal(code: unknown): unknown {
  try { fail(code as TransferCode); } catch (signal) { return signal; }
}
// Closed contract examples, not an alternate implementation of admission.
const legitimateCodes: Record<TransferCode, true> = {
  invalid_input:true, unsupported_format:true, invalid_envelope:true,
  duplicate_member:true, noncanonical_wire:true, limit_exceeded:true,
  incomplete_inventory:true, unknown_owned_family:true, source_unobserved:true,
  source_unhealthy:true, sensitive_archive_unavailable:true, identity_archive_unsupported:true,
  fingerprint_unavailable:true, fingerprint_failed:true, fingerprint_invalid:true, digest_mismatch:true,
};
const codes = Object.keys(legitimateCodes) as TransferCode[];
const refusalSnapshot = () => JSON.stringify({schemaVersion:1,transferId:"10000000-0000-4000-8000-000000000001",snapshotId:"20000000-0000-4000-8000-000000000002",sourceBuild:{version:"synthetic",build:"test"},catalogContractId:"synthetic",listing:{schemaVersion:1,keys:[]},observations:fixed.map(key=>({key,state:"absent"})),sourceControl:{domain:"absent",credential:"excluded"},snapshotState:"synthetic_frozen"});
// Explicit synthetic provider only, not an operational fingerprint choice.
const refusalFingerprint = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
describe("S2 IR01 closed refusal metadata", () => {
  it("admits malformed construction before retaining caller metadata", () => {
    const caller = { privateValue: "synthetic-original" };
    const signal = refusalSignal(caller);
    caller.privateValue = "synthetic-mutated";
    const result = failure(signal);
    expect(result).toEqual({ok:false,code:"invalid_envelope"});
    expect(result.code).not.toBe(caller);
    expect(failure(refusalSignal("unsupported-runtime-code"))).toEqual({ok:false,code:"invalid_envelope"});
  });
  it("admits malformed fallback and construction without traps, reads or coercion", () => {
    let touched = 0;
    const trap = (): never => { touched++; throw Error("must not inspect caller data"); };
    const caller = { privateValue: "synthetic-original", get code() { return trap(); }, get message() { return trap(); }, get [Symbol.toPrimitive]() { return trap(); }, toString: trap, valueOf: trap };
    const handler = { get: trap, set: trap, has: trap, ownKeys: trap, getPrototypeOf: trap, setPrototypeOf: trap, getOwnPropertyDescriptor: trap, defineProperty: trap, deleteProperty: trap, isExtensible: trap, preventExtensions: trap, apply: trap, construct: trap };
    const proxy = new Proxy(caller, handler);
    const callable = new Proxy(() => {}, handler);
    const revoked = Proxy.revocable({}, handler); revoked.revoke();
    const boxed = new String("invalid_input");
    Object.defineProperty(boxed, Symbol.toPrimitive, {get:trap});
    for (const value of [caller, boxed, proxy, revoked.proxy, Symbol("invalid_input"), callable, null, undefined, "unsupported-runtime-code", " invalid_input", "invalid_input\n", 0, BigInt(1), true]) {
      const projected = failure(proxy, value as TransferCode);
      const constructed = failure(refusalSignal(value));
      for (const result of [projected, constructed]) {
        expect(typeof result.code).toBe("string");
        expect(result).toEqual({ok:false,code:"invalid_envelope"});
        expect(Reflect.ownKeys(result)).toEqual(["ok","code"]);
        // Keep the hostile value out of matchers (asymmetric matching reads it).
        expect(result.code === value).toBe(false);
      }
    }
    const result = failure(proxy, caller as unknown as TransferCode);
    caller.privateValue = "synthetic-mutated";
    expect(result).toEqual({ok:false,code:"invalid_envelope"});
    expect(Object.isFrozen(caller)).toBe(false);
    expect(touched).toBe(0);
  });
  it("preserves every literal, identity precedence, signal mutation and default fallback", () => {
    let reads = 0;
    const trap = (): never => { reads++; throw Error("must not inspect signal"); };
    const malformedFallback = new Proxy({}, {get:trap,ownKeys:trap,getPrototypeOf:trap});
    for (const code of codes) {
      const signal = refusalSignal(code) as object;
      Object.setPrototypeOf(signal, {code:"synthetic-forged"});
      for (const name of ["code","message","toJSON",Symbol.toPrimitive]) Object.defineProperty(signal,name,{get:trap});
      const result = failure(signal, malformedFallback as TransferCode);
      expect(result).toEqual({ok:false,code});
      expect(Reflect.ownKeys(result)).toEqual(["ok","code"]);
      expect(failure(null,code)).toEqual({ok:false,code});
      expect(failure(new Proxy(signal,{}))).toEqual({ok:false,code:"invalid_envelope"});
    }
    expect(failure({code:"duplicate_member"})).toEqual({ok:false,code:"invalid_envelope"});
    expect(failure(null)).toEqual({ok:false,code:"invalid_envelope"});
    expect(failure(null,undefined)).toEqual({ok:false,code:"invalid_envelope"});
    expect(reads).toBe(0);
  });
  it("projects actual inventory, encode and decode shared-helper faults before fingerprinting", async () => {
    const input = refusalSnapshot();
    const encoded = await encodeInstallationTransfer(input,refusalFingerprint);
    expect(encoded.ok).toBe(true); if (!encoded.ok) throw Error("invalid test fixture");
    const listing = JSON.stringify({schemaVersion:1,keys:[TRANSFER_PROFILE_PREFIX+"10000000-0000-4000-8000-000000000001."+TRANSFER_SPORTING_SUFFIXES[0]]});
    let touched = 0, calls = 0;
    const trap = (): never => { touched++; throw Error("must not inspect reason"); };
    const hostile = new Proxy({}, {get:trap,ownKeys:trap,getPrototypeOf:trap});
    const revoked = Proxy.revocable({},{}); revoked.revoke();
    const caller = {privateValue:"synthetic-original"};
    const malformedSignal = refusalSignal(caller); caller.privateValue = "synthetic-mutated";
    const cases: [unknown,TransferCode][] = [[malformedSignal,"invalid_envelope"],[refusalSignal("unknown-runtime-code"),"invalid_envelope"],[hostile,"invalid_envelope"],[revoked.proxy,"invalid_envelope"],...codes.map(code=>[refusalSignal(code),code] as [unknown,TransferCode])];
    for (const [reason,code] of cases) {
      uuidFault.active = true; uuidFault.reason = reason; uuidFault.calls = 0;
      try {
        const provider = () => { calls++; return "a".repeat(64); };
        // Type admission still wins; the shared helper is not reached here.
        expect(planInstallationTransferInventory(null)).toEqual({ok:false,code:"invalid_input"});
        expect(uuidFault.calls).toBe(0);
        const results = [planInstallationTransferInventory(listing),await encodeInstallationTransfer(input,provider),await decodeInstallationTransfer(encoded.value.wire,provider)];
        expect(uuidFault.calls).toBe(3);
        for (const result of results) {
          expect(result).toEqual({ok:false,code});
          expect(Reflect.ownKeys(result)).toEqual(["ok","code"]);
          if (!result.ok) expect(result.code === (caller as unknown)).toBe(false);
        }
      } finally { uuidFault.active = false; uuidFault.reason = undefined; uuidFault.calls = 0; }
    }
    expect(touched).toBe(0); expect(calls).toBe(0);
    expect(isCanonicalUuid("10000000-0000-4000-8000-000000000001")).toBe(true);
    expect((await decodeInstallationTransfer(encoded.value.wire,refusalFingerprint)).ok).toBe(true);
  });
  it("reclassifies fingerprint throw and rejection even when replaying a genuine signal", async () => {
    const input = refusalSnapshot(); const encoded = await encodeInstallationTransfer(input,refusalFingerprint);
    expect(encoded.ok).toBe(true); if (!encoded.ok) throw Error("invalid test fixture");
    let touched = 0;
    const hostile = new Proxy({}, {get(){touched++;throw 0;},ownKeys(){touched++;throw 0;},getPrototypeOf(){touched++;throw 0;}});
    for (const reason of [hostile,refusalSignal({privateValue:"synthetic"}),...codes.map(refusalSignal)]) {
      for (const provider of [()=>{throw reason;},()=>Promise.reject(reason)]) {
        for (const result of [await encodeInstallationTransfer(input,provider),await decodeInstallationTransfer(encoded.value.wire,provider)]) {
          expect(result).toEqual({ok:false,code:"fingerprint_failed"});
          expect(Reflect.ownKeys(result)).toEqual(["ok","code"]);
        }
      }
    }
    expect(touched).toBe(0);
  });
});
describe("inactive S2 inventory", () => {
  it("plans six positive absence probes for a physically empty source", () => {
    const result = planInstallationTransferInventory('{"schemaVersion":1,"keys":[]}');
    expect(result).toEqual({ ok: true, value: { profiles: [], dynamicIdentity: [], rawReads: [], absenceProbes: fixed, controlHealthKeys: [], exclusions: { providerCredentials: 0, retiredUnscoped: 0, publicCaches: 0, foreignKeys: 0 } } });
  });
  it("refuses an unknown own family before any value request", () => { expect(planInstallationTransferInventory('{"schemaVersion":1,"keys":["curling.future.v9"]}')).toEqual({ok:false,code:"unknown_owned_family"}); });
  const a = "10000000-0000-4000-8000-000000000001";
  const b = "20000000-0000-4000-8000-000000000002";
  const plan = (keys:string[]) => planInstallationTransferInventory(JSON.stringify({schemaVersion:1,keys:keys.sort(unitOrder)}));
  it("pins all 13 slots, fixed keys and legacy against actual repository declarations", () => {
    expect(TRANSFER_SPORTING_SUFFIXES).toEqual([...SPORTING_STORAGE_KEYS,ASSESSMENT_DRAFT_STORAGE_KEY,ASSESSMENT_HISTORY_STORAGE_KEY,CLOUD_SPORTING_SYNC_STORAGE_KEY]);
    expect(TRANSFER_SPORTING_SUFFIXES).toEqual(NATIVE_MIGRATION_PROFILE_SPORTING_KEYS);
    expect(TRANSFER_IDENTITY_KEYS).toEqual(NATIVE_MIGRATION_IDENTITY_FIXED_KEYS);
    expect(TRANSFER_LEGACY_KEY).toBe(NATIVE_MIGRATION_LEGACY_RETIREMENT_MARKER_KEY);
  });
  it("discovers namespaces from each physical suffix only and plans every explicit absent slot", () => {
    for (const suffix of TRANSFER_SPORTING_SUFFIXES) {
      const reads = [TRANSFER_PROFILE_PREFIX+a+"."+suffix,TRANSFER_PROFILE_PREFIX+b+"."+suffix]; const r = plan(reads);
      expect(r.ok).toBe(true); if (!r.ok) return;
      expect(r.value.profiles).toEqual([a,b]); expect(r.value.rawReads).toEqual(reads); expect(r.value.absenceProbes).toHaveLength(30);
      expect(new Set([...r.value.rawReads,...r.value.absenceProbes]).size).toBe(32);
      expect(Object.isFrozen(r.value.absenceProbes)).toBe(true);
    }
  });
  it("enumerates all resolution members and separates owner health from raw reads", () => {
    const dynamic = [a,b].map(id=>`curling.identity.accessBarrierResolution.${id}.v1`); const control = "curling.nativeMigration.activationRecord.v1";
    const r = plan([...dynamic,control]); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.value.dynamicIdentity).toEqual(dynamic); expect(r.value.rawReads).toEqual(dynamic); expect(r.value.absenceProbes).toEqual(fixed); expect(r.value.controlHealthKeys).toEqual([control]);
    expect(Object.keys(r.value)).not.toEqual(expect.arrayContaining(["remove","clear","writeMarker"]));
  });
  it("never plans reads of excluded families, even malformed cache suffixes", () => {
    const excluded = ["sb-test-auth-token","sb-test-auth-token-code-verifier","sb-test-auth-token-flow-x","curling-performance-public-exercise-diagram-v1.","foreign",...TRANSFER_SPORTING_SUFFIXES.slice(0,10)];
    const r = plan(excluded); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(r.value.rawReads).toEqual([]); expect(r.value.exclusions).toEqual({providerCredentials:3,publicCaches:1,foreignKeys:1,retiredUnscoped:10});
  });
  it.each(["10000000-0000-4000-8000-00000000000A","00000000-0000-0000-0000-000000000000","10000000-0000-9000-8000-000000000001","10000000-0000-4000-7000-000000000001"])("pins rejected UUID %s", id => { expect(isCanonicalUuid(id)).toBe(false); expect(plan([TRANSFER_PROFILE_PREFIX+id+"."+TRANSFER_SPORTING_SUFFIXES[0]])).toEqual({ok:false,code:"unknown_owned_family"}); });
  it.each(["curling.identity.accessBarrierResolution.bad.v1","curling.nativeMigration.future.v9","curling.syntheticFutureCredentialControl.v9","curling-release-tracker-assessment-draft","curling-performance-unknown"])("refuses unknown own shape %s", key => { expect(plan([key])).toEqual({ok:false,code:"unknown_owned_family"}); });
  it("uses codeunit order and rejects unsorted or duplicate listing", () => {
    expect(["\ue000","aa","a\u0000","a","\ud800"].sort(unitOrder)).toEqual(["a","a\u0000","aa","\ud800","\ue000"]);
    for (const keys of [["z","a"],["x","x"]]) expect(planInstallationTransferInventory(JSON.stringify({schemaVersion:1,keys}))).toEqual({ok:false,code:"incomplete_inventory"});
    for (const key of ["schemaVersion","keys"]) expect(planInstallationTransferInventory(`{"schemaVersion":1,"keys":[],"${key}":null}`)).toEqual({ok:false,code:"duplicate_member"});
  });
  it("bounds keys, listing count, namespaces and dynamic members inclusively", () => {
    expect(plan(["f".repeat(256)]).ok).toBe(true); expect(plan(["f".repeat(257)])).toEqual({ok:false,code:"limit_exceeded"});
    const keys=Array.from({length:4096},(_,i)=>`foreign.${String(i).padStart(4,"0")}`); expect(plan(keys).ok).toBe(true); expect(plan([...keys,"z"])).toEqual({ok:false,code:"limit_exceeded"});
    const ids=(n:number)=>Array.from({length:n},(_,i)=>`${(i+1).toString(16).padStart(8,"0")}-0000-4000-8000-000000000001`);
    expect(plan(ids(32).map(id=>TRANSFER_PROFILE_PREFIX+id+"."+TRANSFER_SPORTING_SUFFIXES[0])).ok).toBe(true);
    expect(plan(ids(33).map(id=>TRANSFER_PROFILE_PREFIX+id+"."+TRANSFER_SPORTING_SUFFIXES[0]))).toEqual({ok:false,code:"limit_exceeded"});
    expect(plan(ids(512).map(id=>`curling.identity.accessBarrierResolution.${id}.v1`)).ok).toBe(true);
    expect(plan(ids(513).map(id=>`curling.identity.accessBarrierResolution.${id}.v1`))).toEqual({ok:false,code:"limit_exceeded"});
  });
  it("rejects proxy/getter/boxed data without any trap inspection or coercion", () => {
    let touched=0; const proxy = new Proxy({}, {get(){touched++;throw 0;},ownKeys(){touched++;throw 0;},getPrototypeOf(){touched++;throw 0;}}); const revoked=Proxy.revocable({},{});revoked.revoke();
    for (const value of [proxy,revoked.proxy,new String("{}"),{get toJSON(){touched++;throw 0;}},null,1,undefined,()=>{},Symbol()]) expect(planInstallationTransferInventory(value)).toEqual({ok:false,code:"invalid_input"}); expect(touched).toBe(0);
  });
});

describe("S2 bounded scanner (actual shared scanner used by all four seams)", () => {
  const parse = (s:string) => {try {return {ok:true,value:parseTransferJson(s)};}catch(e){return failure(e);}};
  it("detects escaped aliases, builds null-prototype objects and does not pollute prototypes", () => {
    expect(parse('{"x":0,"\\u0078":1}')).toEqual({ok:false,code:"duplicate_member"});
    const r=parse('{"__proto__":{"inert":true},"constructor":null}'); expect(r.ok).toBe(true); if (r.ok && "value" in r) expect(Object.getPrototypeOf(r.value)).toBe(null); expect(({} as Record<string,unknown>).inert).toBeUndefined();
  });
  it.each(["-1","-0","1.5","1e3","01","9007199254740992","10000000000000000","NaN","Infinity"])("rejects unsafe/noncanonical integer token %s", token => { expect(parse(token)).toEqual({ok:false,code:"invalid_envelope"}); });
  it.each(['[1,]','{"a":}','{"a":true,}','{"a" true}','{"a":true}x','true false','"\\u000g"','"\n"','\ufeff{}','['])('rejects malformed JSON %s',s=>{expect(parse(s)).toEqual({ok:false,code:"invalid_envelope"});});
  it("admits safe uint and exact depth/edges/name/decoded/input boundaries", () => {
    expect(parse("9007199254740991")).toEqual({ok:true,value:9007199254740991});
    expect(parse("[".repeat(16)+"null"+"]".repeat(16)).ok).toBe(true); expect(parse("[".repeat(17)+"null"+"]".repeat(17))).toEqual({ok:false,code:"limit_exceeded"});
    expect(parse(JSON.stringify({["x".repeat(64)]:0})).ok).toBe(true); expect(parse(JSON.stringify({["x".repeat(65)]:0}))).toEqual({ok:false,code:"limit_exceeded"});
    expect(parse("["+"0,".repeat(65535)+"0]").ok).toBe(true); expect(parse("["+"0,".repeat(65536)+"0]")).toEqual({ok:false,code:"limit_exceeded"});
    expect(parse(JSON.stringify("x".repeat(4194304))).ok).toBe(true); expect(parse(JSON.stringify("x".repeat(4194305)))).toEqual({ok:false,code:"limit_exceeded"});
    expect(parse("{}".padEnd(25165824," ")).ok).toBe(true); expect(parse("{}".padEnd(25165825," "))).toEqual({ok:false,code:"limit_exceeded"});
    expect(checkedAdd(16777215,1,16777216)).toBe(16777216); expect(checkedMultiply(8388608,2,16777216)).toBe(16777216);
    for (const operation of [()=>checkedAdd(Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER),()=>checkedMultiply(Number.MAX_SAFE_INTEGER,2,Number.MAX_SAFE_INTEGER)]) {try{operation();throw Error("not refused");}catch(e){expect(failure(e)).toEqual({ok:false,code:"limit_exceeded"});}}
    expect(TRANSFER_LIMITS).toEqual({input:25165824,wire:25165824,depth:16,decoded:4194304,raw:3145728,sporting:1048576,identity:65536,legacy:8,key:256,label:64,name:64,profiles:32,dynamic:512,items:1024,listed:4096,edges:65536,preimage:16777216,decision:65536});
  });
  it("admits bounded field strings and arrays before materializing their oversized payloads", () => {
    expect(parse('{"key":"'+"x".repeat(257)+'"}')).toEqual({ok:false,code:"limit_exceeded"});
    expect(parse('{"keys":['+"null,".repeat(4096)+'null]}')).toEqual({ok:false,code:"limit_exceeded"});
    expect(parse('{"items":['+"null,".repeat(1024)+'null]}')).toEqual({ok:false,code:"limit_exceeded"});
    const budget={decoded:0,edges:65536};try{parseTransferJson('["avoidable"]',budget);throw Error("not refused");}catch(e){expect(failure(e)).toEqual({ok:false,code:"limit_exceeded"});}expect(budget.decoded).toBe(0);
  });
  it("matches native JSON on a deterministic small grammar corpus, without permitting fractions", () => {
    const values=[null,true,false,0,1,9007199254740991,"","\u0000","\ud800","\udc00","\ufffd",{x:[],a:{b:1}},[1,{x:"e\u0301"}]];
    for(const value of values) {const s=JSON.stringify(value);expect(parse(s)).toEqual({ok:true,value}); for(const broken of [s+"x",s+",",s.slice(0,-1)]) {let valid=true;try{JSON.parse(broken);}catch{valid=false;}if(!valid)expect(parse(broken).ok).toBe(false);}}
  });
});

describe("S2 exact inert production graph", () => {
  it("keeps the pure S2 graph with exact V3 wrapper and read-only source exceptions", () => {
    const names=["installationTransferInventory","installationTransferCodec","installationTransferDecision"];
    const own=names.map(n=>`src/lib/persistence/${n}.ts`);
    const allowed=new Set(["./installationTransferInventory","./installationTransferCodec","./installationTransferDecision","../uuid","../identity/identityBarrier","../identity/trustedDevice","../identity/interactiveAttempt","../identity/identityBarrierResolution","../identity/untrustedValue"]);
    const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):/\.tsx?$/.test(e.name)?[join(dir,e.name)]:[]);
    for(const path of [...walk(join(process.cwd(),"src")),...walk(join(process.cwd(),"mobile/src"))].filter(p=>!p.includes("__tests__")&&!p.includes(".test."))) {
      const rel=relative(process.cwd(),path); const source=readFileSync(path,"utf8"); const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true); const refs:string[]=[];
      const visit=(node:ts.Node):void=>{if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier))refs.push(node.moduleSpecifier.text);if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||(ts.isIdentifier(node.expression)&&node.expression.text==="require"))&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))refs.push(node.arguments[0].text);ts.forEachChild(node,visit);};visit(tree);
      if(own.includes(rel)) {expect(refs.filter(r=>!allowed.has(r)),rel).toEqual([]); for(const effect of [/\bfetch\s*\(/,/\b(?:setTimeout|setInterval)\s*\(/,/\b(?:window|document|navigator|process)\s*[.[]/,/\b(?:localStorage|indexedDB|sessionStorage)\b/,/\b(?:Date\.now|Math\.random|crypto)\b/,/console\s*\./,/JSON\.parse/]) expect(source.replace(/\/\*[\s\S]*?\*\//g,"").replace(/\/\/[^\n]*/g,""),`${rel}: ${effect}`).not.toMatch(effect);}
      else if(rel === "src/lib/persistence/installationTransferV3.ts") {
        expect(refs.filter(r=>names.some(n=>r.endsWith("/"+n))),rel).toEqual(["./installationTransferCodec"]);
        const imported=tree.statements.filter(ts.isImportDeclaration).filter(node=>ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==="./installationTransferCodec").map(node=>node.importClause?.namedBindings).flatMap(node=>node&&ts.isNamedImports(node)?node.elements.map(element=>element.name.text):[]);
        expect(imported).toEqual(["installationTransferV3Internals"]);
      } else if(rel === "src/lib/persistence/installationTransferProtection.ts") {
        expect(refs.filter(r=>names.some(n=>r.endsWith("/"+n))),rel).toEqual(["./installationTransferInventory"]);
        const imported=tree.statements.filter(ts.isImportDeclaration).filter(node=>ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==="./installationTransferInventory").map(node=>node.importClause?.namedBindings).flatMap(node=>node&&ts.isNamedImports(node)?node.elements.map(element=>element.name.text):[]);
        expect(imported).toEqual(["TRANSFER_LIMITS"]);
      } else if(rel === "src/lib/persistence/installationTransferQuarantineSql.ts") {
        expect(refs.filter(r=>names.some(n=>r.endsWith("/"+n))),rel).toEqual(["./installationTransferInventory"]);
        const imported=tree.statements.filter(ts.isImportDeclaration).filter(node=>ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==="./installationTransferInventory").map(node=>node.importClause?.namedBindings).flatMap(node=>node&&ts.isNamedImports(node)?node.elements.map(element=>element.name.text):[]);
        expect(imported).toEqual(["transferSlot"]);
      } else if(rel === "src/lib/persistence/localStorageAdapter.ts") {
        expect(refs.filter(r=>names.some(n=>r.endsWith("/"+n))),rel).toEqual(["./installationTransferInventory"]);
        const imported=tree.statements.filter(ts.isImportDeclaration).filter(node=>ts.isStringLiteral(node.moduleSpecifier)&&node.moduleSpecifier.text==="./installationTransferInventory").map(node=>node.importClause?.namedBindings).flatMap(node=>node&&ts.isNamedImports(node)?node.elements.map(element=>element.name.text):[]);
        expect(imported).toEqual(["planInstallationTransferInventoryV2","expectedSlots","TRANSFER_CONTROL_KEYS","TRANSFER_LIMITS","TRANSFER_LEGACY_KEY","TRANSFER_PROFILE_PREFIX","ReadPlan"]);
      } else expect(refs.filter(r=>names.some(n=>r.endsWith("/"+n))),rel).toEqual([]);
    }
  });
});

it.each(["accountDeletionGuard", "accountDeletionGuardResolution"])("old transfer inventory refuses newer %s evidence", family => {
  const key = `curling.identity.${family}.10000000-0000-4000-8000-000000000001.v1`;
  expect(planInstallationTransferInventory(JSON.stringify({ schemaVersion: 1, keys: [key] }))).toEqual({ ok: false, code: "unknown_owned_family" });
});
