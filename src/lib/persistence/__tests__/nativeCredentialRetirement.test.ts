// S3i: disposable real SQLite, synthetic credentials and injected WebView/protected stores only.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeCommonMigrationOptions, NativeCommonRetirementOwner } from "../nativeCombinedMigrationOwner";
import { combinedFixture, disposeCombinedFixtures } from "./nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, fp, isSyntheticFingerprint } from "./nativeMigrationTestKit";
import { credentialItemSlot } from "../credentialPhysicalSlots";
import { parseQ, parseI, serializeI } from "../credentialProtocol";
const root = "sb-fixture-auth-token", config = "pc1:fixture";
const session = '{"access_token":"SYNTHETIC_ACCESS","refresh_token":"SYNTHETIC_REFRESH","expires_at":100,"expires_in":1,"token_type":"bearer"}';
const flow = root + "-flow-flow1234-code-verifier", index = root + "-flows-code-verifier";
const verifier = JSON.stringify("a".repeat(43));
const credentials = { [root]:session, [flow]:verifier, [index]:JSON.stringify(["flow1234"]) };
const hash = (_purpose: string, key: string, raw: string) => createHash("sha256").update(JSON.stringify(["credential-value/v1", key, raw])).digest("hex");
const hashFormat = (value: string) => /^[0-9a-f]{64}$/.test(value);
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false }): T => { if (!r.ok) throw new Error("fixture"); return r.value; };
type Event = { kind: string; key?: string; value?: string };
const unblocks: (() => void)[] = [];
const owners: NativeCommonRetirementOwner[] = [];
const pairs: import("../nativeCombinedRuntime").NativeCombinedRuntimePair[] = [];
afterEach(async () => { while (unblocks.length) unblocks.pop()!(); for (const pair of pairs.splice(0)) await pair.dispose(); for (const owner of owners.splice(0)) await owner.dispose(); await disposeCombinedFixtures(); vi.unstubAllGlobals(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); unblocks.push(resolve); return { promise, resolve }; }
async function fixture(platform: "ios" | "android", initial: Record<string, string> = {}, changes: Partial<NativeCommonMigrationOptions> = {}, wrap: (binding: object) => object = value => value) {
  vi.resetModules();
  const h = await combinedFixture(platform); expect(await h.cap.release(h.lease)).toEqual({ ok: true });
  const storage = new RetirementStorage(initial); vi.stubGlobal("localStorage", storage);
  const values = new Map<string, string>(), trace: Event[] = [];
  const faults: { hook?: (event: Event, next: () => Promise<unknown>) => Promise<unknown> } = {};
  const invoke = (event: Event, next: () => Promise<unknown>) => { trace.push(event); return faults.hook ? faults.hook(event, next) : next(); };
  const binding = {
    failedWriteMayLosePreviousValue: true,
    configure: async () => invoke({ kind: "configure" }, async () => undefined),
    inventory: async () => invoke({ kind: "inventory" }, async () => ({ kind: "complete", keys: [...values.keys()].sort() })),
    read: async (key: string) => invoke({ kind: "read", key }, async () => values.has(key) ? { kind: "value", value: values.get(key) } : { kind: "established_absent" }),
    write: async (key: string, value: string) => invoke({ kind: "write", key, value }, async () => { values.set(key, value); }),
    remove: async (key: string) => invoke({ kind: "remove", key }, async () => ({ kind: values.delete(key) ? "deleted" : "nothing_to_delete" })),
  };
  const options: NativeCommonMigrationOptions = { sqlite: { ...h.options, detectPlatform: () => "ios" }, providerConfigIdentity: config, sessionStorageKey: root,
    protectedBinding: wrap(binding), detectPlatform: () => "ios", domainFingerprint: fp, domainFingerprintFormat: isSyntheticFingerprint,
    credentialFingerprint: hash, credentialFingerprintFormat: hashFormat, generateUuid: syntheticUuid, now: () => SYNTHETIC_NOW,
    limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 }, ...changes };
  const make = async (override: Partial<NativeCommonMigrationOptions> = {}) => {
    const ownerModule = await import("../nativeCombinedMigrationOwner"); const made = ownerModule.createNativeCombinedRetirementOwner({ ...options, ...override });
    if (!made.ok) throw new Error(made.reason); owners.push(made.owner); return made.owner;
  };
  const owner = await make();
  async function q() {
    const observed = await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='q';" }) as { values: { value: string }[] };
    return observed.values.length ? unwrap(parseQ(observed.values[0].value)) : null;
  }
  async function until(phase: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await owner.run(); expect(["incomplete", "candidate"]).toContain(result.outcome);
      const current = await q(); if (current?.phase === phase) return current;
    }
    throw new Error("phase not reached");
  }
  return { ...h, binding, storage, values, protectedTrace: trace, protectedFaults: faults, options, make, owner, q, until };
}

class RetirementStorage extends SyntheticStorage {
  onRemove?: (key:string,next:()=>void)=>unknown;
  onRead?: (key:string,next:()=>string|null)=>unknown;
  onKey?: (index:number,next:()=>string|null)=>unknown;
  override removeItem(key:string):void { return (this.onRemove ? this.onRemove(key,()=>super.removeItem(key)) : super.removeItem(key)) as void; }
  override getItem(key:string):string|null { return (this.onRead ? this.onRead(key,()=>super.getItem(key)) : super.getItem(key)) as string|null; }
  override key(index:number):string|null { return (this.onKey ? this.onKey(index,()=>super.key(index)) : super.key(index)) as string|null; }
}
async function prepared(platform:"ios"|"android"="ios", initial:Record<string,string>=credentials) {
  const h=await fixture(platform,initial); const result=await h.owner.run();
  expect(result.outcome).toBe("candidate"); if(result.outcome!=="candidate") throw new Error("fixture");
  return {...h,candidate:result.candidate};
}
async function fCount(h:Awaited<ReturnType<typeof prepared>>) {
  return (await h.raw({kind:"query",sql:"SELECT slot FROM curling_credential_meta WHERE slot='f';"}) as {values:unknown[]}).values.length;
}
for(const platform of ["ios","android"] as const) describe(`${platform} real SQLite / explicit dormant retirement`,()=>{
  it("removes exactly original credentials, leaves domain/identity/foreign raws unread, then hands off actual resources",async()=>{
    const h=await prepared(platform,{...BASE_SOURCE,...credentials,"sb-other-auth-token":"OTHER","cache":"CACHE"});
    const protectedBefore=new Map(h.values), opens=h.trace.filter(e=>e.kind==="open").length;
    const beforeReads=h.storage.valueReads.length;
    expect(await h.owner.handoff(h.candidate)).toEqual({outcome:"refused"});
    const first=h.owner.retire(h.candidate); expect(h.owner.retire(h.candidate)).toBe(first);
    expect(await h.owner.run()).toEqual({outcome:"blocked",code:"unavailable"});
    const report=await first;
    expect(report).toMatchObject({outcome:"retired",removeIssued:3,removeAcknowledged:3,removeVerified:3,observedAbsent:2,firstUnverified:null});
    expect(Object.isFrozen(report)).toBe(true); expect([...h.values]).toEqual([...protectedBefore]);
    expect(h.storage.writes.filter(k=>k.startsWith("remove:"))).toEqual(Object.keys(credentials).sort().map(k=>"remove:"+k));
    expect(h.storage.valueReads.slice(beforeReads).every(k=>k.startsWith(root))).toBe(true);
    expect(h.storage.map.get("cache")).toBe("CACHE"); expect(h.storage.map.get("sb-other-auth-token")).toBe("OTHER");
    if(report.outcome!=="retired") throw new Error("fixture");
    const result=await h.owner.handoff(report.candidate); expect(result.outcome).toBe("runtime");
    if(result.outcome!=="runtime") throw new Error("fixture"); pairs.push(result.pair);
    expect(await result.pair.credentials.read(root)).toEqual({status:"value",value:session});
    expect(h.trace.filter(e=>e.kind==="open")).toHaveLength(opens);
  });
  it("refuses copied/stale/cross-owner tokens with zero work",async()=>{
    const h=await prepared(platform); const other=await h.make(); const count=[h.trace.length,h.protectedTrace.length,h.storage.lengthReads];
    for(const token of [{...h.candidate},Object.freeze({}),null]) expect(await h.owner.retire(token)).toEqual({outcome:"refused",removeIssued:0,removeAcknowledged:0,removeVerified:0,observedAbsent:0,firstUnverified:null});
    expect(await other.retire(h.candidate)).toMatchObject({outcome:"refused"});
    expect([h.trace.length,h.protectedTrace.length,h.storage.lengthReads]).toEqual(count);
    const fresh=await h.owner.run(); expect(fresh.outcome).toBe("candidate"); expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"refused"});
  });
  it("accepts a cold remaining subset with a dangling index without reconstructing or rewriting it",async()=>{
    const h=await prepared(platform); h.storage.map.delete(flow); h.storage.map.delete(root);
    const r=await h.owner.retire(h.candidate); expect(r).toMatchObject({outcome:"retired",removeIssued:1,removeVerified:1,observedAbsent:4});
    expect(h.storage.writes.filter(k=>k.startsWith("remove:"))).toEqual(["remove:"+index]);
  });
  it("accepts an empty source without looking up removeItem or comparing mutable target to M",async()=>{
    const h=await prepared(platform); for(const key of Object.keys(credentials))h.storage.map.delete(key);
    const q=await h.q(); if(!q)throw new Error("fixture"); const slot=unwrap(credentialItemSlot(config,root,q.credentialEpochId,root));
    const item=unwrap(parseI(h.values.get(slot)!,root,q)); h.values.set(slot,unwrap(serializeI({...item,value:session.replace('"expires_in":1','"expires_in":2')},root)));
    Object.defineProperty(h.storage,"removeItem",{get(){throw new Error("must not read");}});
    const r=await h.owner.retire(h.candidate); expect(r).toMatchObject({outcome:"source_absent",removeIssued:0,removeVerified:0,observedAbsent:5}); expect(await fCount(h)).toBe(0);
    if(r.outcome!=="source_absent")throw new Error("fixture"); const transfer=await h.owner.handoff(r.candidate); expect(transfer.outcome).toBe("runtime"); if(transfer.outcome==="runtime")pairs.push(transfer.pair);
  });
  for(const mutation of ["value","missing","extra"] as const) it(`blocks remaining source against valid ${mutation} target without F`,async()=>{
    const h=await prepared(platform); const q=await h.q(); if(!q)throw new Error("fixture");
    const slot=unwrap(credentialItemSlot(config,root,q.credentialEpochId,root)),item=unwrap(parseI(h.values.get(slot)!,root,q));
    if(mutation==="missing")h.values.delete(slot);
    else if(mutation==="value")h.values.set(slot,unwrap(serializeI({...item,value:session.replace('"expires_in":1','"expires_in":2')},root)));
    else {const key=root+"-code-verifier";h.values.set(unwrap(credentialItemSlot(config,root,q.credentialEpochId,key)),unwrap(serializeI({...item,key,value:verifier},root)));}
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",code:"target_not_original",removeIssued:0,firstUnverified:null});
    expect(h.storage.map.has(root)).toBe(true); expect(await fCount(h)).toBe(0);
  });
});

describe("retirement actual-effect evidence and interruption",()=>{
  it("retains an earlier actual null receipt when a later read fails",async()=>{
    const h=await prepared();h.storage.onRead=(key,next)=>{if(key===flow)throw Object.freeze({});return next();};
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",removeIssued:0,observedAbsent:1});
  });
  it("retains distinct actual null receipts when the trailing names observation fails",async()=>{
    const h=await prepared(),before=h.storage.valueReads.length;h.storage.onKey=(_i,next)=>{if(h.storage.valueReads.length>before)throw Object.freeze({});return next();};
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",removeIssued:0,observedAbsent:2});
  });
  for(const mode of ["throw_before","throw_after","nonvoid","still_present","read_throw","read_nonvoid"] as const) it(`stops after the first unverified removal: ${mode}`,async()=>{
    const h=await prepared(); let readback=false;
    h.storage.onRemove=(key,next)=>{
      if(mode==="throw_before")throw Object.create(null);
      if(mode!=="still_present")next();
      readback=true;
      if(mode==="throw_after")throw Object.create(null);
      if(mode==="nonvoid")return false;
    };
    h.storage.onRead=(_key,next)=>{if(readback&&mode==="read_throw")throw Object.create(null);if(readback&&mode==="read_nonvoid")return false;return next();};
    const before=new Map(h.values), r=await h.owner.retire(h.candidate);
    expect(r).toMatchObject({outcome:"incomplete",code:"operation_unverified",removeIssued:1,removeAcknowledged:["throw_before","throw_after","nonvoid"].includes(mode)?0:1,removeVerified:0,firstUnverified:{removeIssued:true,absenceVerified:false,absenceReadIssued:["still_present","read_throw","read_nonvoid"].includes(mode),absenceReadAcknowledged:mode==="still_present"}});
    expect(Object.isFrozen(r.firstUnverified)).toBe(true);expect(h.storage.map.has(flow)).toBe(true);expect(h.storage.map.has(index)).toBe(true);expect([...h.values]).toEqual([...before]);expect(await fCount(h)).toBe(0);
    expect(await h.owner.handoff(h.candidate)).toEqual({outcome:"refused"});
  });
  for(const boundary of ["read","remove"] as const) for(const action of ["recover","dispose"] as const) it(`revokes synchronously at ${boundary} via ${action}`,async()=>{
    const h=await prepared(); let cancelling:ReturnType<typeof h.owner.recover>|ReturnType<typeof h.owner.dispose>|undefined;
    if(boundary==="read")h.storage.onRead=(_key,next)=>{const value=next();cancelling??=h.owner[action]();return value;};
    else h.storage.onRemove=(_key,next)=>{next();cancelling??=h.owner[action]();};
    const r=await h.owner.retire(h.candidate);expect(r.outcome).toBe("incomplete");expect(r.removeIssued).toBe(boundary==="read"?0:1);expect(r.removeVerified).toBe(0);
    if(boundary==="remove")expect(r.firstUnverified).toMatchObject({removeAcknowledged:true,absenceReadIssued:false});
    await cancelling;expect(h.storage.map.has(flow)).toBe(true);expect(h.storage.map.has(index)).toBe(true);
  });
  for(const boundary of ["remove","read","key","length"] as const) it(`owns a directly observed pending ${boundary} return before recovery can reopen`,async()=>{
    const h=await prepared(); const release=deferred();let triggered=false;
    if(boundary==="remove")h.storage.onRemove=(_key,next)=>{next();triggered=true;return release.promise;};
    if(boundary==="read")h.storage.onRead=()=>{triggered=true;return release.promise;};
    if(boundary==="key")h.storage.onKey=()=>{triggered=true;return release.promise;};
    if(boundary==="length")Object.defineProperty(h.storage,"length",{configurable:true,get(){triggered=true;return release.promise;}});
    const r=h.owner.retire(h.candidate);await expect.poll(()=>triggered).toBe(true);let settled=false;void r.then(()=>{settled=true;});
    const closes=h.trace.filter(e=>e.kind==="close").length; const recovery=h.owner.recover();await Promise.resolve();await Promise.resolve();
    expect(settled).toBe(false);expect(h.trace.filter(e=>e.kind==="close")).toHaveLength(closes);
    release.resolve();expect((await r).outcome).toBe("incomplete");await recovery;
  });
  for(const boundary of ["read","remove"] as const) it(`owns malformed async ${boundary} results even after reentrant cancellation`,async()=>{
    const h=await prepared(), release=deferred();let cancelling:Promise<unknown>|undefined,entered=false;
    const bad=()=>{entered=true;cancelling=h.owner.recover();return release.promise;};
    if(boundary==="read")h.storage.onRead=bad;else h.storage.onRemove=bad;
    const attempt=h.owner.retire(h.candidate);await expect.poll(()=>entered).toBe(true);let done=false;void cancelling!.then(()=>{done=true;});await Promise.resolve();expect(done).toBe(false);
    release.resolve();await attempt;await cancelling;
  });
  it("joins retirement and refuses handoff while actual protected work remains pending",async()=>{
    const h=await prepared(),entered=deferred(),release=deferred();let once=true;
    h.protectedFaults.hook=async(event,next)=>{if(once&&event.kind==="read"){once=false;entered.resolve();await release.promise;}return next();};
    const first=h.owner.retire(h.candidate);await entered.promise;expect(h.owner.retire(h.candidate)).toBe(first);expect(await h.owner.handoff(h.candidate)).toEqual({outcome:"refused"});
    const recovering=h.owner.recover();release.resolve();expect(await first).toMatchObject({outcome:"incomplete",code:"cancelled",removeIssued:0});await recovering;
  });
  it("resumes a cold partial cleanup without inventing earlier acknowledgement",async()=>{
    const h=await prepared();h.storage.onRemove=(_key,next)=>{next();throw Object.create(null);};
    expect(await h.owner.retire(h.candidate)).toMatchObject({removeIssued:1,removeAcknowledged:0,removeVerified:0});h.storage.onRemove=undefined;
    await h.owner.dispose();await h.raw({kind:"close"});vi.resetModules();const next=await h.make();const current=await next.run();if(current.outcome!=="candidate")throw new Error("fixture");
    expect(await next.retire(current.candidate)).toMatchObject({outcome:"retired",removeIssued:2,removeAcknowledged:2,removeVerified:2,observedAbsent:3});
  });
});

async function coldBound() {
  const h=await prepared();await h.owner.dispose();await h.raw({kind:"close"});vi.resetModules();
  const owner=await h.make(),report=await owner.run();if(report.outcome!=="candidate")throw new Error("fixture");
  return {...h,owner,candidate:report.candidate};
}
describe("cold retirement capture owns cancellation and drain before reflection",()=>{
  for(const boundary of ["getItem","setItem","key","length"] as const) for(const masked of [false,true]) it(`retains observed global promise when later ${boundary} throws, masked=${masked}`,async()=>{
    const h=await coldBound();let settle!:(value?:unknown)=>void,fail!:(reason:unknown)=>void,observations=0,entered=false;
    const pending=new Promise<unknown>((resolve,reject)=>{settle=resolve;fail=reject;});unblocks.push(()=>settle());
    if(masked){Object.defineProperty(pending,"then",{value:null});Object.defineProperty(pending,"constructor",{get(){observations++;return Promise;}});}
    for(const [name,method] of [["getItem",h.storage.getItem],["setItem",h.storage.setItem],["key",h.storage.key]] as const)Object.defineProperty(pending,name,{get(){if(name===boundary){entered=true;throw Object.freeze({});}return method;}});
    Object.defineProperty(pending,"length",{get(){entered=true;throw Object.freeze({});}});vi.stubGlobal("localStorage",pending);
    let done=false;const retiring=h.owner.retire(h.candidate).then(r=>{done=true;return r;});await expect.poll(()=>entered).toBe(true);
    const observedBefore=observations,closes=h.trace.filter(e=>e.kind==="close").length,recovery=h.owner.recover();await Promise.resolve();await Promise.resolve();expect(done).toBe(false);expect(h.trace.filter(e=>e.kind==="close")).toHaveLength(closes);
    const drain=Reflect.apply(Promise.prototype.then,pending,[()=>{},()=>{}]);if(masked)fail(Object.freeze({}));else settle();await drain;
    expect(await retiring).toMatchObject({outcome:"incomplete",removeIssued:0});await recovery;if(masked)expect(observedBefore).toBeGreaterThan(0);
  });
  for(const method of ["getItem","setItem","key"] as const) it(`holds a pending ${method} dependency before recovery`,async()=>{
    const h=await coldBound(),wait=deferred();let entered=false;
    Object.defineProperty(h.storage,method,{configurable:true,get(){entered=true;return wait.promise;}});
    let done=false;const retiring=h.owner.retire(h.candidate).then(r=>{done=true;return r;});await expect.poll(()=>entered).toBe(true);
    const closes=h.trace.filter(e=>e.kind==="close").length,recovery=h.owner.recover();await Promise.resolve();await Promise.resolve();expect(done).toBe(false);expect(h.trace.filter(e=>e.kind==="close")).toHaveLength(closes);
    wait.resolve();expect(await retiring).toMatchObject({outcome:"incomplete",removeIssued:0});await recovery;
  });
  for(const method of ["getItem","setItem","key"] as const) it(`intrinsically observes masked rejected ${method} dependency`,async()=>{
    const h=await coldBound();let fail!:(reason:unknown)=>void,observed=0,entered=false;
    const bad=new Promise<unknown>((_r,reject)=>{fail=reject;});Object.defineProperty(bad,"then",{value:null});Object.defineProperty(bad,"constructor",{get(){observed++;return Promise;}});
    Object.defineProperty(h.storage,method,{configurable:true,get(){entered=true;return bad;}});
    const retiring=h.owner.retire(h.candidate);await expect.poll(()=>entered).toBe(true);const before=observed;
    // The cleanup observer makes even a regressed failing assertion safe.
    const drain=Reflect.apply(Promise.prototype.then,bad,[()=>{},()=>{}]);fail(Object.freeze({}));await drain;
    expect(await retiring).toMatchObject({outcome:"incomplete",removeIssued:0});expect(before).toBeGreaterThan(0);
  });
  for(const action of ["recover","dispose"] as const) for(const boundary of ["global","getItem","setItem","key","length_descriptor","prototype"] as const) it(`stops later cold capture operations after ${boundary}/${action}`,async()=>{
    const h=await coldBound();let cancelled=false,later=0,stop:Promise<unknown>|undefined;
    const cancel=()=>{cancelled=true;stop??=h.owner[action]();};
    const actual=h.storage,get=actual.getItem,set=actual.setItem,key=actual.key;
    if(boundary==="global")Object.defineProperty(globalThis,"localStorage",{configurable:true,get(){cancel();return actual;}});
    else {
      for(const [name,operation] of [["getItem",get],["setItem",set],["key",key]] as const)Object.defineProperty(actual,name,{configurable:true,get(){if(cancelled)later++;if(boundary===name)cancel();return operation;}});
      if(boundary==="length_descriptor"||boundary==="prototype")vi.stubGlobal("localStorage",new Proxy(actual,{
        getOwnPropertyDescriptor(target,name){if(cancelled)later++;if(boundary==="length_descriptor"&&name==="length")cancel();return Reflect.getOwnPropertyDescriptor(target,name);},
        getPrototypeOf(target){if(cancelled)later++;if(boundary==="prototype")cancel();return Reflect.getPrototypeOf(target);},
      }));
    }
    const reads=actual.valueReads.length,lengths=actual.lengthReads;expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",removeIssued:0});await stop;
    expect(cancelled).toBe(true);expect(later).toBe(0);expect(actual.valueReads).toHaveLength(reads);expect(actual.lengthReads).toBe(lengths);
  });
  it("owns a masked pending malformed global storage value",async()=>{
    const h=await coldBound(),wait=deferred();let entered=false;
    Object.defineProperty(wait.promise,"then",{value:null});Object.defineProperty(globalThis,"localStorage",{configurable:true,get(){entered=true;return wait.promise;}});
    let done=false;const retiring=h.owner.retire(h.candidate).then(r=>{done=true;return r;});await expect.poll(()=>entered).toBe(true);await Promise.resolve();expect(done).toBe(false);wait.resolve();expect((await retiring).outcome).toBe("incomplete");
  });
});

describe("retirement source provenance and fresh fences",()=>{
  it("rechecks the full subset after capturing a removal getter",async()=>{
    const h=await prepared();Object.defineProperty(h.storage,"removeItem",{get(){h.storage.map.set(flow,verifier+" ");return ()=>{throw new Error("must not issue");};}});
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",code:"source_changed",removeIssued:0});expect(h.storage.map.has(root)).toBe(true);
  });
  it("checks fresh absence after a real mutable-dependency reflection trap",async()=>{
    let activated=false; const receiver:{storage?:RetirementStorage}={};
    const h=await fixture("ios",credentials,{},binding=>new Proxy(binding,{getOwnPropertyDescriptor(target,key){if(activated&&key==="remove")receiver.storage!.map.set(root,session);return Reflect.getOwnPropertyDescriptor(target,key);}}));
    receiver.storage=h.storage;const initial=await h.owner.run();if(initial.outcome!=="candidate")throw new Error("fixture");const r=await h.owner.retire(initial.candidate);if(r.outcome!=="retired")throw new Error("fixture");activated=true;
    expect(await h.owner.handoff(r.candidate)).toEqual({outcome:"refused"});expect(h.storage.map.has(root)).toBe(true);
  });
  it("does not replace captured length with a new accessor during retirement",async()=>{
    const h=await prepared();let once=true;h.storage.onRead=(_key,next)=>{if(once){once=false;Object.defineProperty(h.storage,"length",{get(){throw new Error("replacement");}});}return next();};
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"retired",removeVerified:3});
  });
  for(const key of [root+"-unknown", "curling.identity.unknown", "curling.nativeMigration.v9", "curling.credential.other", "curling.installationTransfer.unknown"]) it(`refuses unsupported source name ${key} before payload reads`,async()=>{
    const h=await prepared();h.storage.map.set(key,"NEVER_READ");const reads=h.storage.valueReads.length;
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",code:"unsupported_source",removeIssued:0});expect(h.storage.valueReads).toHaveLength(reads);expect(h.storage.map.get(root)).toBe(session);
  });
  for(const mode of ["changed","new_fixed","new_flow"] as const) it(`refuses a non-original source subset ${mode} before any effect`,async()=>{
    const h=await prepared();if(mode==="changed")h.storage.map.set(root,session+" ");else h.storage.map.set(mode==="new_fixed"?root+"-code-verifier":root+"-flow-newflow1-code-verifier",verifier);
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",code:"source_changed",removeIssued:0,firstUnverified:null});expect(await fCount(h)).toBe(0);
  });
  it("uses the original bound WebView receiver after global replacement",async()=>{
    const h=await prepared();const replacement=new RetirementStorage(credentials);vi.stubGlobal("localStorage",replacement);
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"retired",removeVerified:3});expect(replacement.snapshot()).toEqual(credentials);expect(replacement.valueReads).toEqual([]);
  });
  it("captures get/key/length and removal operations once without supplied invocation properties",async()=>{
    const h=await prepared();let captures=0;const remove=function(this:RetirementStorage,key:string){expect(this).toBe(h.storage);this.map.delete(key);};
    for(const name of ["bind","call","apply"])Object.defineProperty(remove,name,{get(){throw new Error("invocation property");}});
    Object.defineProperty(h.storage,"removeItem",{configurable:true,get(){captures++;return remove;}});
    Object.defineProperty(h.storage,"getItem",{get(){throw new Error("already captured");}});Object.defineProperty(h.storage,"key",{get(){throw new Error("already captured");}});
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"retired",removeVerified:3});expect(captures).toBe(1);
  });
  for(const length of [16385,-1,1.5,Number.MAX_SAFE_INTEGER,Infinity]) it(`refuses unsafe total metadata size ${length} before indexing`,async()=>{
    const h=await prepared();Object.defineProperty(h.storage,"length",{get(){return length;}});let indexed=false;h.storage.onKey=()=>{indexed=true;return null;};
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",code:"unavailable",removeIssued:0});expect(indexed).toBe(false);
  });
  for(const mode of ["duplicate","null","inconsistent","throw"] as const) it(`refuses ${mode} enumeration without effects`,async()=>{
    const h=await prepared();let calls=0;h.storage.onKey=(i,next)=>{calls++;if(mode==="duplicate")return root;if(mode==="null")return null;if(mode==="throw")throw Object.create(null);if(calls===4)h.storage.map.delete(flow);return next();};
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",removeIssued:0});
  });
  it("stops after a later source change and preserves its truthful earlier counts",async()=>{
    const h=await prepared();h.storage.onRemove=(key,next)=>{next();if(key===root)h.storage.map.set(flow,verifier+" ");};
    expect(await h.owner.retire(h.candidate)).toMatchObject({outcome:"incomplete",code:"source_changed",removeIssued:1,removeAcknowledged:1,removeVerified:1,firstUnverified:null});expect(h.storage.map.has(index)).toBe(true);
  });
  for(const boundary of ["protected_read","before_handoff","last_source_read"] as const) it(`refuses publication after source reappears at ${boundary}`,async()=>{
    const h=await prepared();const report=await h.owner.retire(h.candidate);if(report.outcome!=="retired")throw new Error("fixture");
    if(boundary==="protected_read")h.protectedFaults.hook=async(e,next)=>{if(e.kind==="read")h.storage.map.set(root,session);return next();};
    else if(boundary==="before_handoff"){h.storage.map.set(root,session);
    }else{let once=true;h.storage.onRead=(key,next)=>{if(once&&key===root){once=false;h.storage.map.set(root,session);}return next();};}
    expect(await h.owner.handoff(report.candidate)).toEqual({outcome:"refused"});expect(await h.owner.retire(report)).toMatchObject({outcome:"refused"});
  });
  it("requires a new genuine retirement proof after ordinary run",async()=>{
    const h=await prepared();const report=await h.owner.retire(h.candidate);if(report.outcome!=="retired")throw new Error("fixture");const current=await h.owner.run();if(current.outcome!=="candidate")throw new Error("fixture");
    expect(await h.owner.handoff(report.candidate)).toEqual({outcome:"refused"});expect(await h.owner.handoff(current.candidate)).toEqual({outcome:"refused"});
    expect(await h.owner.retire(current.candidate)).toMatchObject({outcome:"source_absent",removeIssued:0});
  });
});
