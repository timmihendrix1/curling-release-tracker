// S3b executes real disposable SQLite; injected bridge faults are explicitly
// model evidence, never physical Capacitor/Keychain evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type NativeSqliteConnection, type NativeSqliteEngine, type NativeSqliteQueryResult,
} from "../nativeSqliteAdapter";

const WORKER = `
import sys,json,sqlite3
c=None
for line in sys.stdin:
 try:
  r=json.loads(line);k=r['kind'];v={}
  if k=='open':
   c=sqlite3.connect(sys.argv[1],isolation_level=None);c.row_factory=sqlite3.Row
  elif k=='close':
   if c is not None:c.close();c=None
  elif k=='query':v={'values':[dict(x) for x in c.execute(r['sql'],r.get('values',[]))]}
  elif k in ['execute','run']:
   if r.get('transaction'):c.execute('BEGIN')
   try:
    cursor=c.execute(r['sql'],r.get('values',[]));v={'changes':{'changes':max(0,cursor.rowcount)}}
    if k=='run':v['changes'].update({'lastId':cursor.lastrowid,'values':[]})
    if r.get('transaction'):c.execute('COMMIT')
   except:
    if r.get('transaction'):c.execute('ROLLBACK')
    raise
  elif k in ['begin','commit','rollback']:
   c.execute(k.upper());v={'changes':{'changes':0}}
  print(json.dumps({'ok':True,'value':v}),flush=True)
 except:print(json.dumps({'ok':False}),flush=True)
`;
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
type Event = { kind: string; sql?: string; values?: unknown[]; transaction?: boolean };
type Hook = (event: Event, next: () => Promise<unknown>) => Promise<unknown>;
async function setup(statements: string[] = [], existing?: { databaseName: string; file: string }) {
  const directory = await mkdtemp(path.join(tmpdir(), "curling-s6g-sqlite-"));
  const file = existing?.file ?? path.join(directory, "synthetic.sqlite");
  const child = spawn("python3", ["-u", "-c", WORKER, file], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = createInterface({ input: child.stdout });
  const pending: { resolve: (x: unknown) => void; reject: (x: Error) => void }[] = [];
  let exited = false;
  lines.on("line", line => {
    const waiter = pending.shift(); if (!waiter) return;
    const result = JSON.parse(line);
    if (result.ok) waiter.resolve(result.value); else waiter.reject(new Error("synthetic SQLite operation refused"));
  });
  const stop = () => { exited = true; while (pending.length) pending.shift()!.reject(new Error("synthetic SQLite worker ended")); };
  child.on("error", stop); child.on("exit", stop);
  cleanups.push(async () => {
    lines.close(); child.stdin.end();
    if (!exited) await new Promise<void>(resolve => { child.once("exit", () => resolve()); child.kill(); });
    await rm(directory, { recursive: true, force: true });
  });
  const trace: Event[] = [];
  const faults: { hook?: Hook } = {};
  const raw = (event: Event): Promise<unknown> => {
    if (exited) return Promise.reject(new Error("synthetic worker unavailable"));
    return new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify(event) + "\n"); });
  };
  const call = async (kind: string, sql?: string, values?: unknown[], transaction?: boolean) => {
    const event = { kind, sql, values, transaction }; trace.push(event);
    return faults.hook ? faults.hook(event, () => raw(event)) : raw(event);
  };
  await raw({ kind: "open" });
  for (const sql of statements) await raw({ kind: "execute", sql });
  await raw({ kind: "close" });
  const connection: NativeSqliteConnection = {
    open: async () => { await call("open"); }, close: async () => { await call("close"); },
    query: (sql, values) => call("query", sql, values) as Promise<NativeSqliteQueryResult>,
    run: (sql, values, transaction) => call("run", sql, values, transaction),
    execute: (sql, transaction) => call("execute", sql, [], transaction),
    beginTransaction: () => call("begin"), commitTransaction: () => call("commit"), rollbackTransaction: () => call("rollback"),
  };
  const engine: NativeSqliteEngine = { createConnection: async () => connection, closeConnection: async () => { await call("close"); } };
  const options = { databaseName: existing?.databaseName ?? directory, engine, detectPlatform: () => "ios" as const };
  return { trace, faults, options, raw, file };
}

import { webcrypto } from "node:crypto";
import { sealInstallationTransferV3 } from "../installationTransferProtection";
import { encodeInstallationTransferV3 } from "../installationTransferV3";
import { TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, TRANSFER_SPORTING_SUFFIXES } from "../installationTransferInventory";
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 5));
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes; }); return { promise, resolve }; }
async function protectedArchive(raws: Record<string, string> = {}) {
  vi.stubGlobal("crypto", webcrypto);
  const profiles = Object.keys(raws).some(k => k.startsWith("curling.sporting.")) ? [profile] : [];
  const names = [...TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, ...profiles.flatMap(id => TRANSFER_SPORTING_SUFFIXES.map(suffix => `curling.sporting.profile.v1.${id}.${suffix}`))].sort();
  const encoded = await encodeInstallationTransferV3(JSON.stringify({ schemaVersion: 3,
    transferId: "30000000-0000-4000-8000-000000000003", snapshotId: "40000000-0000-4000-8000-000000000004",
    sourceBuild: { version: "synthetic", build: "test" }, catalogContractId: "synthetic",
    listing: { schemaVersion: 1, keys: Object.keys(raws).sort() },
    observations: names.map(key => Object.hasOwn(raws, key) ? { key, state: "present", raw: raws[key] } : { key, state: "absent" }),
    sourceControl: { domain: "absent", credential: "excluded" }, snapshotState: "synthetic_frozen" }));
  if (!encoded.ok) throw Error("synthetic archive refused");
  vi.stubGlobal("crypto", webcrypto);
  const sealed = await sealInstallationTransferV3(encoded.value.wire);
  if (!sealed.ok) throw Error("synthetic protection refused");
  return sealed;
}

const profile = "10000000-0000-4000-8000-000000000001";
const basic = () => ({ [`curling.sporting.profile.v1.${profile}.${TRANSFER_SPORTING_SUFFIXES[7]}`]: "true" });
beforeEach(() => { vi.resetModules(); }); // New synthetic JS lifetime; no production reset API.
async function fixture(h: Awaited<ReturnType<typeof setup>>, initial = new Map<string, string>()) {
  const trace: string[] = [];
  const faults: { hook?: (kind: string, next: () => unknown) => unknown } = {};
  const call = async (kind: string, next: () => unknown) => { trace.push(kind); return faults.hook ? faults.hook(kind, next) : next(); };
  const binding = {
    failedWriteMayLosePreviousValue: false,
    remove: (slot: string) => call("remove", () => { const had = initial.delete(slot); return { kind: had ? "deleted" : "nothing_to_delete" }; }),
    configure: () => call("configure", () => undefined),
    inventory: () => call("inventory", () => ({ kind: "complete", keys: [...initial.keys()].sort() })),
    read: (slot: string) => call("read", () => initial.has(slot) ? { kind: "value", value: initial.get(slot) } : { kind: "established_absent" }),
    write: (slot: string, raw: string) => call("write", () => { initial.set(slot, raw); }),
  };
  const { createInstallationTransferIdentityOwner: createInstallationTransferPairing } = await import("../installationTransferPairing");
  const options = { sqlite: h.options, providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", protectedBinding: binding, detectPlatform: () => "ios" };
  return { owner: createInstallationTransferPairing(options), options, trace, values: initial, faults, create: createInstallationTransferPairing };
}
const code = (r: { code: string; mayIssue: false; mayPublish: false; mayMount: false }, expected: string) => expect(r).toEqual({ code: expected, mayIssue: false, mayPublish: false, mayMount: false });

const identity = "curling.identity.trustedDevice.v1";
const root = "sb-synthetic-auth-token";
const session = '{"access_token":"SYNTHETIC_ACCESS","refresh_token":"SYNTHETIC_REFRESH","expires_at":100,"expires_in":1,"token_type":"bearer"}';
async function runtime() {
  const h = await setup(), f = await fixture(h), a = await protectedArchive(basic());
  code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired");
  const pair = await f.owner.handoff(); expect(pair).not.toBeNull();
  return { h, f, a, pair: pair! };
}
it("is inert and requires actual pair authentication, never supplied draft facts", async () => {
  const h = await setup(), f = await fixture(h);
  expect(await f.owner.handoff()).toBeNull(); expect(h.trace).toEqual([]); expect(f.trace).toEqual([]);
  const a = await protectedArchive(); code(await f.owner.pair(a.protectedWire, "bad"), "invalid_input");
  expect(await f.owner.handoff()).toBeNull(); expect(h.trace).toEqual([]);
  code(await f.owner.close(), "closed");
});
it("bootstraps empty exact identity schema and publishes real identity-only paired runtime", async () => {
  const { h, f, pair } = await runtime();
  expect(await pair.domain.get(identity)).toEqual({ status: "value", value: null });
  expect(await pair.credentials.read(root)).toEqual({ status: "absent" });
  code(await f.owner.inspect(), "runtime_owned"); code(await f.owner.pair("bad", "bad"), "runtime_owned");
  expect(await f.owner.handoff()).toBe(pair);
  const objects = await h.raw({kind:"query",sql:"SELECT type,name,sql FROM sqlite_master ORDER BY type,name"}) as {values: {type:string;name:string;sql:string|null}[]};
  expect(objects.values).toHaveLength(7); expect(objects.values[0]).toEqual({type:"index",name:"sqlite_autoindex_installation_transfer_identity_v1_1",sql:null});
  expect(pair.health()).toMatchObject({domain:"healthy",credential:"healthy",protocol:"healthy",lifecycle:"active"});
  expect(await pair.dispose()).toEqual({ok:true});
  expect(pair.health().cleanup).toEqual({sqlCloseIssued:true,sqlCloseAcknowledged:true,engineReleaseIssued:true,engineReleaseAcknowledged:true,namespaceDrainIssued:true,namespaceDrainAcknowledged:true});
});
it("denies every sporting/legacy/control/credential/unknown key without native I/O", async () => {
  const { h, f, pair } = await runtime(); const count=h.trace.length;
  for(const key of [...TRANSFER_SPORTING_SUFFIXES.map(s=>`curling.sporting.profile.v1.${profile}.${s}`),TRANSFER_LEGACY_KEY,root,"curling.identity.unknown.v1","curling.nativeMigration.q","other",new String(identity),null]) {
    expect((await pair.domain.get(key as string)).status).toBe("read_failed");
    expect((await pair.domain.set(key as string,"raw")).ok).toBe(false);
    expect((await pair.domain.remove(key as string)).ok).toBe(false);
  }
  expect(h.trace).toHaveLength(count); expect(pair.health().domain).toBe("healthy"); code(await f.owner.close(),"closed");
});
it("preserves exact UTF16/absence and own insert/update/remove with same ready connection", async () => {
  const { h, f, pair } = await runtime(); const before=h.trace.filter(e=>e.kind==="open").length;
  for(const raw of ["", "nul\0lone\ud800\udfff", String.fromCharCode(...Array.from({length:65536},(_,i)=>i))]) {
    expect(await pair.domain.set(identity,raw)).toEqual({ok:true}); expect(await pair.domain.get(identity)).toEqual({status:"value",value:raw});
  }
  expect(await pair.credentials.write(root,session)).toEqual({ok:true}); expect(await pair.credentials.read(root)).toEqual({status:"value",value:session});
  expect(await pair.credentials.remove(root)).toEqual({ok:true,outcome:"deleted_reported"});
  expect(await pair.domain.remove(identity)).toEqual({ok:true}); expect(await pair.domain.remove(identity)).toEqual({ok:true});
  expect(await pair.domain.get(identity)).toEqual({status:"value",value:null});
  expect(h.trace.filter(e=>e.kind==="open")).toHaveLength(before); expect(pair.health().domain).toBe("healthy");
  code(await f.owner.close(),"closed");
});
it("cold reauthenticates exact extended layout and genuine runtime I entries without adopting source identity", async () => {
  const { h,f,a,pair }=await runtime(); expect(await pair.domain.set(identity,"destination")).toEqual({ok:true});
  expect(await pair.credentials.write(root,session)).toEqual({ok:true}); code(await f.owner.close(),"closed");
  const cold=f.create(f.options); code(await cold.inspect(),"paired_unverified"); expect(await cold.handoff()).toBeNull();
  code(await cold.pair(a.protectedWire,a.recoveryCode),"paired"); const next=await cold.handoff(); expect(next).not.toBeNull();
  expect(await next!.domain.get(identity)).toEqual({status:"value",value:"destination"}); expect(await next!.credentials.read(root)).toEqual({status:"value",value:session});
  code(await cold.close(),"closed"); expect(h.trace.some(e=>e.sql?.includes("credential_meta"))).toBe(false);
});
for (const phase of ["begin","run","commit"] as const) for (const effect of [false,true]) it(`holds unknown ${phase} ack (effect=${effect}) without write authority`, async()=>{
  const {h,f,pair}=await runtime(); let armed=true;
  h.faults.hook=async(e,next)=>{if(armed&&e.kind===phase){armed=false;if(effect)await next(); throw Error("synthetic lost ack");}return next();};
  expect((await pair.domain.set(identity,"changed")).ok).toBe(false);
  expect(pair.health().domain).toBe("failed"); expect((await pair.credentials.read(root)).status).toBe("read_failed");
  const rollback=h.trace.filter(e=>e.kind==="rollback").length;
  if(phase==="commit")expect(rollback).toBe(0);
  expect(await pair.dispose()).toEqual({ok:false,reason:"evidence_held"}); code(await f.owner.close(),"fault_held");
});
for(const phase of ["close","release"] as const) it(`retains BOTH logical owners for cleanup-only ${phase} failure and retries`,async()=>{
  const {h,f,pair}=await runtime();let armed=true,closes=0;
  h.faults.hook=async(e,next)=>{if(e.kind==="close"){closes++;if(armed&&(phase==="close"||closes===2)){armed=false;throw Error("synthetic cleanup failure");}}return next();};
  expect(await pair.dispose()).toEqual({ok:false,reason:"cleanup_unconfirmed"});
  expect(pair.health()).toMatchObject({domain:"healthy",credential:"healthy",protocol:"healthy",lifecycle:"closed"});
  const {ordinaryCredentialNamespaceAvailable}=await import("../nativeCredentialNamespace");expect(ordinaryCredentialNamespaceAvailable()).toBe(false);
  const {createNativeSqliteStore}=await import("../nativeSqliteAdapter");expect((await createNativeSqliteStore(h.options).adapter.get("x")).status).toBe("read_failed");
  expect(await pair.dispose()).toEqual({ok:true});expect(ordinaryCredentialNamespaceAvailable()).toBe(true);code(await f.owner.close(),"closed");
});
it("revokes at first malformed async dependency evidence before draining, retains the residue",async()=>{
  const {h,f,pair}=await runtime();const gate=deferred(),entered=deferred();let armed=true,done=false;
  h.faults.hook=async(e,next)=>{if(armed&&e.kind==="query"){armed=false;entered.resolve(undefined);return {then:gate.promise};}return next();};
  const reading=pair.domain.get(identity).then(value=>{done=true;return value;});await entered.promise;await wait();
  expect(pair.health().domain).toBe("failed");expect(done).toBe(false);const closing=f.owner.close();await wait();expect(done).toBe(false);
  gate.resolve(undefined);expect((await reading).status).toBe("read_failed");code(await closing,"fault_held");
});
it("does not poison in-flight credential anchor across successful own identity mutation",async()=>{
  const {h,f,pair}=await runtime();const entered=deferred(),gate=deferred();let armed=true;
  f.faults.hook=(kind,next)=>{if(armed&&kind==="read"){armed=false;entered.resolve(undefined);return gate.promise.then(next);}return next();};
  const reading=pair.credentials.read(root);await entered.promise;
  expect(await pair.domain.set(identity,"own identity change")).toEqual({ok:true});gate.resolve(undefined);
  expect(await reading).toEqual({status:"absent"});expect(pair.health()).toMatchObject({domain:"healthy",credential:"healthy"});
  code(await f.owner.close(),"closed");expect(h.trace.filter(e=>e.kind==="begin").length).toBe(6);
});
it("holds immutable-control and warm identity drift, never silently adopts foreign rows",async()=>{
  const {h,f,pair}=await runtime();await h.raw({kind:"run",sql:"INSERT INTO installation_transfer_identity_v1(key,value_ascii) VALUES (?,?)",values:[identity,"u16:0066"]});
  expect((await pair.domain.get(identity)).status).toBe("read_failed");expect(pair.health().protocol).toBe("faulted");code(await f.owner.close(),"fault_held");
});
it("refuses oversized input without writes or poisoning a healthy source",async()=>{
  const {h,f,pair}=await runtime();const count=h.trace.length;
  for(const raw of ["x".repeat(1048577),null,{},new String("x")])expect((await pair.domain.set(identity,raw as string)).ok).toBe(false);
  expect(h.trace).toHaveLength(count);expect(pair.health().domain).toBe("healthy");code(await f.owner.close(),"closed");
});

it("admits all four actual identity families using audited keys",async()=>{
 const {f,pair}=await runtime();
 for(const key of [identity,"curling.identity.accessBarrierResolution.10000000-0000-4000-8000-000000000001.v1","curling.identity.accountDeletionGuard.10000000-0000-4000-8000-000000000001.v1","curling.identity.accountDeletionGuardResolution.10000000-0000-4000-8000-000000000001.v1"]){
   expect(await pair.domain.set(key,"opaque destination value")).toEqual({ok:true});expect(await pair.domain.remove(key)).toEqual({ok:true});
 }
 code(await f.owner.close(),"closed");
});
for(const change of ["extra_table","trigger","identity_key","identity_encoding","binding","sporting"])it(`retains foreign ${change} and fails actual controls`,async()=>{
 const {h,f,pair}=await runtime();
 const statements:Record<string,string>={extra_table:"CREATE TABLE foreign_data(x)",trigger:"CREATE TRIGGER bad AFTER INSERT ON installation_transfer_identity_v1 BEGIN SELECT 1; END",identity_key:"INSERT INTO installation_transfer_identity_v1 VALUES ('foreign','u16:')",identity_encoding:`INSERT INTO installation_transfer_identity_v1 VALUES ('${identity}','not-encoded')`,binding:"UPDATE installation_transfer_binding_v1 SET bound_q='foreign'",sporting:"UPDATE installation_transfer_sporting_v1 SET value_ascii='u16:0066'"};
 await h.raw({kind:"execute",sql:statements[change]});expect((await pair.domain.get(identity)).status).toBe("read_failed");expect(pair.health().protocol).toBe("faulted");code(await f.owner.close(),"fault_held");
});
for(const boundary of ["bootstrap_begin","bootstrap_commit","prepare_read"])it(`close wins pending handoff at ${boundary}, never leaks prepared role`,async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive();code(await f.owner.pair(a.protectedWire,a.recoveryCode),"paired");
 const entered=deferred(),gate=deferred();let armed=true,committed=false;
 h.faults.hook=async(e,next)=>{
   if(e.kind==="commit")committed=true;
   if(armed&&(boundary==="bootstrap_begin"&&e.kind==="begin"||boundary==="bootstrap_commit"&&e.kind==="commit"||boundary==="prepare_read"&&committed&&e.kind==="query"&&e.sql==="PRAGMA schema_version;")){armed=false;entered.resolve(undefined);await gate.promise;}
   return next();
 };
 const handoff=f.owner.handoff();await entered.promise;const closing=f.owner.close();gate.resolve(undefined);expect(await handoff).toBeNull();code(await closing,"closed");
 const {ordinaryCredentialNamespaceAvailable}=await import("../nativeCredentialNamespace");expect(ordinaryCredentialNamespaceAvailable()).toBe(true);
});
for(const boundary of ["query","begin","run","commit"])it(`close synchronously revokes runtime at ${boundary} and joins positive work`,async()=>{
 const {h,f,pair}=await runtime();const gate=deferred(),entered=deferred();let armed=true;
 h.faults.hook=async(e,next)=>{if(armed&&e.kind===boundary){armed=false;const raw=await next();entered.resolve(undefined);await gate.promise;return raw;}return next();};
 const writing=pair.domain.set(identity,"actual write");await entered.promise;const closing=f.owner.close();expect(pair.health().lifecycle).toBe("closed");
 expect((await pair.domain.get(identity)).status).toBe("read_failed");gate.resolve(undefined);expect((await writing).ok).toBe(false);code(await closing,"closed");
 expect(pair.health().domain).toBe("healthy");
});
it("old pair-only mode refuses identity-extended layout even after healthy runtime disposal",async()=>{
 const {f,a}=await runtime();code(await f.owner.close(),"closed");const {createInstallationTransferPairing}=await import("../installationTransferPairing");const old=createInstallationTransferPairing(f.options);
 expect((await old.inspect()).code).toBe("target_conflict");expect((await old.pair(a.protectedWire,a.recoveryCode)).code).toBe("target_conflict");await old.close();
});
it("refuses a projected aggregate overflow before BEGIN, preserves healthy bounded data",async()=>{
 const {h,f,a,pair}=await runtime();
 const keys=[identity,"curling.identity.accessBarrier.v1","curling.identity.interactiveAttempt.v1","curling.identity.pendingIntent.v1"];
 const raw="x".repeat(1048576);
 for(const key of keys)expect(await pair.domain.set(key,raw)).toEqual({ok:true});
 const count=h.trace.length;expect((await pair.domain.set("curling.identity.intentCleanup.v1","x")).ok).toBe(false);expect(h.trace).toHaveLength(count);expect(pair.health().domain).toBe("healthy");
 code(await f.owner.close(),"closed");const cold=f.create(f.options);code(await cold.pair(a.protectedWire,a.recoveryCode),"paired");const next=await cold.handoff();expect(next).not.toBeNull();code(await cold.close(),"closed");
},30000);
it("positively stored overflow is preserved and refused, not silently truncated",async()=>{
 const {h,f,a}=await runtime();code(await f.owner.close(),"closed");
 await h.raw({kind:"open"});await h.raw({kind:"begin"});
 for(let i=0;i<4097;i++){const id=i.toString(16).padStart(8,"0")+"-0000-4000-8000-000000000001";await h.raw({kind:"run",sql:"INSERT INTO installation_transfer_identity_v1 VALUES (?,?)",values:[`curling.identity.accountDeletionGuard.${id}.v1`,"u16:"]});}
 await h.raw({kind:"commit"});await h.raw({kind:"close"});const cold=f.create(f.options);expect((await cold.pair(a.protectedWire,a.recoveryCode)).code).toBe("target_conflict");expect(await cold.handoff()).toBeNull();await cold.close();
},30000);

it("rejects a changed schema generation even when exact objects were reconstructed",async()=>{
 const {h,f,pair}=await runtime();await h.raw({kind:"execute",sql:"CREATE TABLE temporary_foreign(x)"});await h.raw({kind:"execute",sql:"DROP TABLE temporary_foreign"});
 expect((await pair.domain.get(identity)).status).toBe("read_failed");expect(pair.health().protocol).toBe("faulted");code(await f.owner.close(),"fault_held");
});

// Independent S6j adversarial witnesses, copied without weakening their assertions.
for(const field of ["remove","failedWriteMayLosePreviousValue"]) it(`joins genuine malformed credential preparation ${field} work before owner cleanup`,async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive(),hold=deferred(),acquired=deferred();
 Object.defineProperty(f.options.protectedBinding,field,{value:hold.promise,configurable:true});
 const binding=new Proxy(f.options.protectedBinding,{getOwnPropertyDescriptor(target,key){const descriptor=Reflect.getOwnPropertyDescriptor(target,key);if(key===field)acquired.resolve(undefined);return descriptor;}});
 const owner=f.create({...f.options,protectedBinding:binding});code(await owner.pair(a.protectedWire,a.recoveryCode),"paired");
 let done=false;const handoff=owner.handoff().then(r=>{done=true;return r;});await acquired.promise;await wait();const closing=owner.close();let closed=false;void closing.then(()=>{closed=true;});await wait();
 try{expect(done).toBe(false);expect(closed).toBe(false);}finally{hold.resolve(undefined);await handoff;await closing;}
});
it("joins a directly acquired malformed SQL query method before cleanup",async()=>{
 const {h,f,pair}=await runtime(),hold=deferred(),c=await h.options.engine.createConnection("");c.query=hold.promise as never;
 let done=false;const reading=pair.domain.get(identity).then(r=>{done=true;return r;});await wait();const closing=f.owner.close();await wait();
 try{expect(done).toBe(false);}finally{hold.resolve(undefined);await reading;await closing;}
});
it("drains observed malformed statement metadata before issuing rollback",async()=>{
 const {h,f,pair}=await runtime(),hold=deferred(),at=deferred(),c=await h.options.engine.createConnection(""),run=c.run;
 c.run=async(...args)=>{await run(...args);at.resolve(undefined);return {changes:{changes:hold.promise,lastId:1,values:[]}};};
 const writing=pair.domain.set(identity,"changed");await at.promise;await wait();const before=h.trace.filter(e=>e.kind==="rollback").length;
 try{expect(pair.health().domain).toBe("failed");expect(before).toBe(0);}finally{hold.resolve(undefined);await writing;await f.owner.close();}
});
it("does not await actual paired disposal completion from a native query",async()=>{
 const {h,pair}=await runtime(),c=await h.options.engine.createConnection("");c.query=()=>pair.dispose() as never;
 const reading=pair.domain.get(identity);const outcome=await Promise.race([reading.then(()=>"settled"),new Promise(resolve=>setTimeout(()=>resolve("pending"),30))]);expect(outcome).toBe("settled");
});
it("faults positive foreign inventory in cold identity layout",async()=>{
 const {f,a}=await runtime();code(await f.owner.close(),"closed");f.values.set("foreign-key","foreign-value");const cold=f.create(f.options);
 try{code(await cold.pair(a.protectedWire,a.recoveryCode),"fault_held");}finally{await cold.close();}
});
it("validates acquired mutation methods before reading later methods",async()=>{
 const {h,f,pair}=await runtime(),hold=deferred(),at=deferred(),c=await h.options.engine.createConnection("");let later=0;const run=c.run;
 Object.defineProperty(c,"beginTransaction",{configurable:true,get(){at.resolve(undefined);return hold.promise;}});Object.defineProperty(c,"run",{configurable:true,get(){later++;return run;}});
 const writing=pair.domain.set(identity,"changed");await at.promise;await wait();
 try{expect(later).toBe(0);}finally{hold.resolve(undefined);await writing;await f.owner.close();}
});

it("does not await actual paired disposal completion from native close",async()=>{
 const {h,pair}=await runtime(),c=await h.options.engine.createConnection("");c.close=()=>pair.dispose() as never;
 const outcome=await Promise.race([pair.dispose().then(()=>"settled"),new Promise(resolve=>setTimeout(()=>resolve("pending"),30))]);expect(outcome).toBe("settled");
});
it("does not await actual paired disposal completion from protected runtime read",async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive();let armed=false;
 const binding={...f.options.protectedBinding,read(slot:string){if(armed)return pairRef!.dispose();return f.values.has(slot)?{kind:"value",value:f.values.get(slot)}:{kind:"established_absent"};}};
 const owner=f.create({...f.options,protectedBinding:binding});code(await owner.pair(a.protectedWire,a.recoveryCode),"paired");const pairRef=await owner.handoff();expect(pairRef).not.toBeNull();armed=true;
 const outcome=await Promise.race([pairRef!.credentials.read(root).then(()=>"settled"),new Promise(resolve=>setTimeout(()=>resolve("pending"),30))]);expect(outcome).toBe("settled");
});

it("excludes actual pending protected operation completion without granting storage success",async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive();let armed=false;
 const binding={...f.options.protectedBinding,read(slot:string){if(armed)return returned;return f.values.has(slot)?{kind:"value",value:f.values.get(slot)}:{kind:"established_absent"};}};
 const owner=f.create({...f.options,protectedBinding:binding});code(await owner.pair(a.protectedWire,a.recoveryCode),"paired");const pair=(await owner.handoff())!;expect(pair).not.toBeNull();armed=true;
 const returned=pair.credentials.read(root);expect((await returned as {status:string}).status).toBe("read_failed");expect(pair.health().credential).toBe("failed");code(await owner.close(),"fault_held");
});
it("uses captured rollback after metadata drain even if the dependency's later property changes",async()=>{
 const {h,f,pair}=await runtime(),c=await h.options.engine.createConnection(""),gate=deferred(),at=deferred(),run=c.run;let later=0;
 c.run=async(...args)=>{await run(...args);Object.defineProperty(c,"rollbackTransaction",{configurable:true,get(){later++;throw Error("unowned later getter");}});at.resolve(undefined);return {changes:{changes:gate.promise,lastId:1,values:[]}};};
 const writing=pair.domain.set(identity,"new");await at.promise;await wait();expect(h.trace.filter(e=>e.kind==="rollback")).toHaveLength(0);gate.resolve(undefined);expect((await writing).ok).toBe(false);
 expect(later).toBe(0);expect(h.trace.filter(e=>e.kind==="rollback")).toHaveLength(1);code(await f.owner.close(),"fault_held");
});

for(const name of ["close","closeConnection"] as const) it(`joins acquired malformed cleanup ${name} method without inventing a call acknowledgement`,async()=>{
 const {h,f,pair}=await runtime(),hold=deferred(),c=await h.options.engine.createConnection("");
 const receiver=name==="close"?c:h.options.engine;const previous=Reflect.get(receiver,name);Reflect.set(receiver,name,hold.promise);
 let done=false;const disposing=pair.dispose().then(value=>{done=true;return value;});await wait();await wait();
 try{expect(done).toBe(false);expect(pair.health().domain).toBe("healthy");}
 finally{hold.resolve(undefined);expect(await disposing).toEqual({ok:false,reason:"cleanup_unconfirmed"});Reflect.set(receiver,name,previous);}
 expect(await pair.dispose()).toEqual({ok:true});code(await f.owner.close(),"closed");
});

it("validates the once-observed boxed protected value without a second then assimilation",async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive();let armed=false,reads=0,reentered=0;
 const binding={...f.options.protectedBinding,read(slot:string){
   if(armed&&slot.startsWith("m1."))return Object.assign(Object.create({get then(){reads++;return reads===1?undefined:(resolve:(x:unknown)=>void)=>{reentered++;resolve({kind:"value",value:f.values.get(slot)});};}}),{kind:"value",value:"foreign manifest"});
   return f.values.has(slot)?{kind:"value",value:f.values.get(slot)}:{kind:"established_absent"};
 }};
 const owner=f.create({...f.options,protectedBinding:binding});code(await owner.pair(a.protectedWire,a.recoveryCode),"paired");const pair=(await owner.handoff())!;armed=true;
 try{expect((await pair.credentials.read(root)).status).toBe("read_failed");expect(reentered).toBe(0);expect(pair.health().protocol).toBe("faulted");}finally{await owner.close();}
});
it("joins an acquired query-method promise when that getter synchronously closes the owner",async()=>{
 const {h,f,pair}=await runtime(),hold=deferred(),acquired=deferred(),c=await h.options.engine.createConnection("");let closing:ReturnType<typeof f.owner.close>|null=null;
 Object.defineProperty(c,"query",{configurable:true,get(){closing=f.owner.close();acquired.resolve(undefined);return hold.promise;}});
 let done=false;const reading=pair.domain.get(identity).then(r=>{done=true;return r;});await acquired.promise;await wait();let closed=false;void closing!.then(()=>{closed=true;});await wait();
 try{expect(done).toBe(false);expect(closed).toBe(false);}finally{hold.resolve(undefined);await reading;await closing;}
});

it("does not re-observe an already observed native Promise fulfillment during strict cleanup",async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive();let armed=false,reads=0,reentered=0;
 const raw=Object.assign(Object.create({get then(){if(!armed)return undefined;reads++;return reads===1?undefined:(resolve:(value:unknown)=>void)=>{reentered++;resolve(undefined);};}}),{kind:"value",value:"foreign manifest"});
 const native=Promise.resolve(raw);
 const binding={...f.options.protectedBinding,read(slot:string){if(armed&&slot.startsWith("m1."))return native;return f.values.has(slot)?{kind:"value",value:f.values.get(slot)}:{kind:"established_absent"};}};
 const owner=f.create({...f.options,protectedBinding:binding});code(await owner.pair(a.protectedWire,a.recoveryCode),"paired");const pair=(await owner.handoff())!;armed=true;
 expect((await pair.credentials.read(root)).status).toBe("read_failed");expect(pair.health().protocol).toBe("faulted");expect(reentered).toBe(0);code(await owner.close(),"fault_held");
});

it("observes each newly issued COMMIT work even when it reuses an earlier observed fulfillment object",async()=>{
 const {h,f,pair}=await runtime(),c=await h.options.engine.createConnection(""),begin=c.beginTransaction,commit=c.commitTransaction,gate=deferred(),entered=deferred();let armed=false,thenCalls=0;
 const shared=Object.assign(Object.create({get then(){if(!armed)return undefined;return (resolve:(x:unknown)=>void,reject:(x:unknown)=>void)=>{thenCalls++;void gate.promise.then(()=>commit()).then(resolve,reject);};}}),{changes:{changes:0}});
 c.beginTransaction=async()=>{await begin();return shared;};c.commitTransaction=()=>{armed=true;entered.resolve(undefined);return shared as never;};
 let done=false;const writing=pair.domain.set(identity,"must commit durably").then(r=>{done=true;return r;});await entered.promise;await wait();
 try{expect(done ? await writing : null).toBeNull();expect(thenCalls).toBe(1);}finally{gate.resolve(undefined);await writing;await f.owner.close();}
});

// S6k1 lower-layer witnesses. Synthetic completion cells model a future host;
// actual configured-host acceptance is a separate S6k2 integration gate.
for (const method of ["configure", "inventory", "read", "write"] as const) {
  for (const completion of ["pair", "close", "host-model"] as const) it(`refuses ${completion} completion as pre-runtime ${method} evidence without cycling`, async () => {
    const h = await setup(), f = await fixture(h), archive = await protectedArchive();
    const entered = deferred(); let pending: Promise<unknown> | null = null;
    const model = deferred();
    const { createInstallationTransferHostOwner } = await import("../installationTransferPairing");
    const binding = { ...f.options.protectedBinding, [method]() {
      entered.resolve(undefined);
      return completion === "close" ? owner.close() : completion === "pair" ? pending : model.promise;
    } };
    const owner = createInstallationTransferHostOwner({ ...f.options, protectedBinding: binding }, value => value === model.promise);
    pending = owner.pair(archive.protectedWire, archive.recoveryCode);
    await entered.promise;
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
    expect(result).not.toBeNull(); expect(result).not.toMatchObject({ code: "paired" });
    expect(await owner.handoff()).toBeNull();
    model.resolve(undefined); await owner.close();
  });
}
for (const method of ["configure", "read", "write", "inventory"] as const) it(`joins acquired malformed ${method} before cleanup and later binding lookup`, async () => {
  const h = await setup(), f = await fixture(h), archive = await protectedArchive(), hold = deferred(), acquired = deferred();
  let later = 0, passed = false;
  const binding = new Proxy(f.options.protectedBinding, { getOwnPropertyDescriptor(target, key) {
    if (key === method) { passed = true; acquired.resolve(undefined); return { configurable: true, enumerable: true, writable: true, value: hold.promise }; }
    if (passed) later++;
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  const owner = f.create({ ...f.options, protectedBinding: binding }); let paired = false, closed = false;
  const pairing = owner.pair(archive.protectedWire, archive.recoveryCode).then(result => { paired = true; return result; });
  await acquired.promise; const closing = owner.close().then(result => { closed = true; return result; }); await wait();
  try { expect(paired).toBe(false); expect(closed).toBe(false); expect(later).toBe(0); }
  finally { hold.resolve(undefined); await pairing; await closing; }
});
it("joins malformed binding-method work acquired by the lookup that closes its owner", async () => {
  const h = await setup(), f = await fixture(h), archive = await protectedArchive(), hold = deferred(), acquired = deferred();
  let closing: ReturnType<typeof f.owner.close> | null = null;
  const binding = new Proxy(f.options.protectedBinding, { getOwnPropertyDescriptor(target, key) {
    if (key === "configure") { closing = owner.close(); acquired.resolve(undefined); return { configurable: true, value: hold.promise }; }
    return Reflect.getOwnPropertyDescriptor(target, key);
  } });
  const owner = f.create({ ...f.options, protectedBinding: binding }); let done = false, closed = false;
  const pairing = owner.pair(archive.protectedWire, archive.recoveryCode).then(result => { done = true; return result; });
  await acquired.promise; void closing!.then(() => { closed = true; }); await wait();
  try { expect(done).toBe(false); expect(closed).toBe(false); }
  finally { hold.resolve(undefined); await pairing; await closing; }
});
it("preserves original protected receiver and fails malformed inventory fields before draining", async () => {
  const h = await setup(), f = await fixture(h), archive = await protectedArchive(), hold = deferred(), acquired = deferred();
  let later = 0, calls = 0;
  const raw = new Proxy({ kind: hold.promise, keys: [] }, { getOwnPropertyDescriptor(target, key) { if (key === "keys") later++; return Reflect.getOwnPropertyDescriptor(target, key); } });
  const binding = { ...f.options.protectedBinding, configure() { expect(this).toBe(binding); calls++; }, inventory() { expect(this).toBe(binding); acquired.resolve(undefined); return raw; } };
  const owner = f.create({ ...f.options, protectedBinding: binding }); let done = false;
  const pairing = owner.pair(archive.protectedWire, archive.recoveryCode).then(result => { done = true; return result; });
  await acquired.promise; await wait(); const closing = owner.close();
  try { expect(done).toBe(false); expect(later).toBe(0); expect(calls).toBe(1); }
  finally { hold.resolve(undefined); await pairing; await closing; }
});

// Independent S6k1 nine failure witnesses, assertions preserved.
for(const masked of [false,true])it(`joins acquired ${masked?"masked ":""}native Promise binding dependency`,async()=>{
 const held=deferred();if(masked)Object.defineProperty(held.promise,"then",{value:null});
 const {createTransferCredentialMigrationPort}=await import("../nativeCredentialMigrationPort");let done=false,failed=false;
 const result=createTransferCredentialMigrationPort({providerConfigIdentity:"pc1:synthetic",sessionStorageKey:root,binding:held.promise,detectPlatform:()=>"ios"},{inventory(){},slot(){}},{owns:()=>false,current:()=>true,failed(){failed=true;}}).then(r=>{done=true;return r;});await wait();
 try{expect(failed).toBe(true);expect(done).toBe(false);}finally{held.resolve(undefined);await result;}
});
it("joins acquired malformed binding getter work without invoking the getter",async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive(),held=deferred(),acquired=deferred();let called=0;
 const getter=Object.assign(function(){called++;throw null;},{then:held.promise});
 const binding=new Proxy(f.options.protectedBinding,{getOwnPropertyDescriptor(target,key){if(key==="configure"){acquired.resolve(undefined);return {configurable:true,get:getter};}return Reflect.getOwnPropertyDescriptor(target,key);}});
 const owner=f.create({...f.options,protectedBinding:binding});let done=false;const result=owner.pair(a.protectedWire,a.recoveryCode).then(r=>{done=true;return r;});await acquired.promise;await wait();
 try{expect(called).toBe(0);expect(done).toBe(false);}finally{held.resolve(undefined);await result;await owner.close();}
});
for(const which of ["oversized-array","key-getter","length-field"] as const)it(`joins malformed acquired inventory ${which} work before completing the operation`,async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive(),held=deferred(),entered=deferred();let later=0,called=0;let keys:unknown;
 if(which==="oversized-array")keys=Object.assign(new Array(4097),{then:held.promise});
 else if(which==="key-getter"){const getter=Object.assign(function(){called++;throw null;},{then:held.promise});keys=[];Object.defineProperty(keys,"0",{configurable:true,get:getter});}
 else keys=new Proxy([],{get(target,key,receiver){if(key==="length")return held.promise;return Reflect.get(target,key,receiver);},ownKeys(target){later++;return Reflect.ownKeys(target);}});
 const binding={...f.options.protectedBinding,inventory(){entered.resolve(undefined);return {kind:"complete",keys};}};
 const owner=f.create({...f.options,protectedBinding:binding});let done=false;const result=owner.pair(a.protectedWire,a.recoveryCode).then(r=>{done=true;return r;});await entered.promise;await wait();
 try{expect(called).toBe(0);expect(done).toBe(false);if(which==="length-field")expect(later).toBe(0);}finally{held.resolve(undefined);await result;await owner.close();}
});
it("joins an acquired malformed platform detection return without treating its fulfillment as readiness",async()=>{
 const held=deferred();const {createTransferCredentialMigrationPort}=await import("../nativeCredentialMigrationPort");
 const made=await createTransferCredentialMigrationPort({providerConfigIdentity:"pc1:synthetic",sessionStorageKey:root,binding:{configure(){},read(){return{kind:"established_absent"};},write(){},inventory(){return{kind:"complete",keys:[]};}},detectPlatform:()=>held.promise},{inventory(){},slot(){}},{owns:()=>false,current:()=>true,failed(){}});expect(made.ok).toBe(true);if(!made.ok)throw null;
 let done=false;const result=made.value.acquire().then(r=>{done=true;return r;});await wait();
 try{expect(done).toBe(false);}finally{held.resolve("ios");expect((await result).ok).toBe(false);}
});

it("refuses a pending native Promise masquerading as a binding method container",async()=>{
 const held=deferred();Object.assign(held.promise,{configure(){},read(){return{kind:"established_absent"};},write(){},inventory(){return{kind:"complete",keys:[]};}});
 const {createTransferCredentialMigrationPort}=await import("../nativeCredentialMigrationPort");let done=false;
 const result=createTransferCredentialMigrationPort({providerConfigIdentity:"pc1:synthetic",sessionStorageKey:root,binding:held.promise,detectPlatform:()=>"ios"},{inventory(){},slot(){}},{owns:()=>false,current:()=>true,failed(){}}).then(r=>{done=true;return r;});await wait();
 try{expect(done).toBe(false);}finally{held.resolve(undefined);expect((await result).ok).toBe(false);}
});
it("checks private currentness after asynchronous port construction before acquiring the namespace",async()=>{
 const h=await setup(),f=await fixture(h),a=await protectedArchive();let closing:ReturnType<typeof f.owner.close>|null=null,detects=0;
 const binding=new Proxy(f.options.protectedBinding,{getOwnPropertyDescriptor(target,key){if(key==="inventory")queueMicrotask(()=>queueMicrotask(()=>{closing=owner.close();}));return Reflect.getOwnPropertyDescriptor(target,key);}});
 const owner=f.create({...f.options,protectedBinding:binding,detectPlatform(){detects++;return"ios";}});
 const result=await owner.pair(a.protectedWire,a.recoveryCode);if(closing)await closing;expect(result.code).toBe("closed");expect(detects).toBe(0);
});
