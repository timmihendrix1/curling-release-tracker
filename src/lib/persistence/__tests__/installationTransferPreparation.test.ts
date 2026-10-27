// S3b executes real disposable SQLite; injected bridge faults are explicitly
// model evidence, never physical Capacitor/Keychain evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeSqliteStore,
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
import { createInstallationTransferQuarantine } from "../installationTransferQuarantine";
import { sealInstallationTransferV3 } from "../installationTransferProtection";
import { encodeInstallationTransferV3 } from "../installationTransferV3";
import { TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, TRANSFER_SPORTING_SUFFIXES } from "../installationTransferInventory";
const wait = () => new Promise<void>(resolve => setTimeout(resolve, 5));
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes; }); return { promise, resolve }; }
function engine() {
  const calls = { random: 0, imports: 0, encrypt: 0, decrypt: 0, digest: 0 };
  const arrays: Uint8Array[] = [];
  const subtle = {
    digest(algorithm: unknown, bytes: unknown): unknown { calls.digest++; return Reflect.apply(webcrypto.subtle.digest, webcrypto.subtle, [algorithm, bytes]); },
    importKey(...args: unknown[]): unknown { calls.imports++; arrays.push(args[1] as Uint8Array); return Reflect.apply(webcrypto.subtle.importKey, webcrypto.subtle, args); },
    encrypt(...args: unknown[]): unknown { calls.encrypt++; arrays.push(args[2] as Uint8Array, (args[0] as AesGcmParams).additionalData as Uint8Array); return Reflect.apply(webcrypto.subtle.encrypt, webcrypto.subtle, args); },
    decrypt(...args: unknown[]): unknown { calls.decrypt++; arrays.push(args[2] as Uint8Array, (args[0] as AesGcmParams).additionalData as Uint8Array); return Reflect.apply(webcrypto.subtle.decrypt, webcrypto.subtle, args); },
  };
  const root = { subtle, getRandomValues(target: Uint8Array): unknown { calls.random++; arrays.push(target); return webcrypto.getRandomValues(target); } };
  vi.stubGlobal("crypto", root); return { root, subtle, calls, arrays };
}

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
  engine();
  const sealed = await sealInstallationTransferV3(encoded.value.wire);
  if (!sealed.ok) throw Error("synthetic protection refused");
  return sealed;
}

import { buildSession } from "../../trainingPlans/__tests__/testHelpers";
import { createTestRun } from "../../assessment/__tests__/testHelpers";
import { createInstallationTransferPreparation } from "../installationTransferPreparation";
import { encodeTransferCodeUnits, decodeTransferCodeUnits, isTransferCodeUnits } from "../installationTransferCodeUnits";
import { createInstallationTransferPreparationSql } from "../installationTransferQuarantineSql";
const profile = "10000000-0000-4000-8000-000000000001";
const key = (index: number) => `curling.sporting.profile.v1.${profile}.${TRANSFER_SPORTING_SUFFIXES[index]}`;
const codes = (value: { code: string; mayIssue: false; mayPublish: false; mayMount: false }, code: string) => expect(value).toEqual({ code, mayIssue: false, mayPublish: false, mayMount: false });
const basic = () => ({ [key(7)]: "true", [key(8)]: "standard" });

it("roundtrips every UTF16 codeunit, NUL/lone surrogates and exact spelling without normalization", () => {
  const raw = Array.from({ length: 65536 }, (_, n) => String.fromCharCode(n)).join("");
  const encoded = encodeTransferCodeUnits(raw); expect(encoded).toMatch(/^u16:[0-9a-f]*$/); expect(decodeTransferCodeUnits(encoded)).toBe(raw);
  for (const bad of [null, {}, new String("u16:"), "", "u16:abc", "u16:ABCD", "u16:000g", "u16:" + "0".repeat(4194308)]) {
    expect(isTransferCodeUnits(bad)).toBe(false); expect(() => decodeTransferCodeUnits(bad)).toThrow();
  }
  expect(() => encodeTransferCodeUnits("x".repeat(1048577))).toThrow();
});

describe("actual native sporting preparation, no publication", () => {
  for (const raws of [{}, basic()]) {
    it("authenticates actual crypto/domain/history and prepares exact complete rows atomically with cold readback", async () => {
      const h = await setup(); const owner = createInstallationTransferPreparation(h.options); expect(h.trace).toEqual([]);
      const a = await protectedArchive(raws); codes(await owner.prepare(a.protectedWire, a.recoveryCode), "prepared");
      const inserts = h.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_sporting"));
      expect(inserts).toHaveLength(Object.keys(raws).length);
      for (const [index, event] of inserts.entries()) {
        expect(event.transaction).toBe(false); expect(event.values?.slice(0,3)).toEqual([index, Object.keys(raws).sort()[index], encodeTransferCodeUnits(raws[Object.keys(raws).sort()[index]])]);
      }
      expect(h.trace.filter(e => e.kind === "commit")).toHaveLength(2);
      const before = h.trace.filter(e => e.kind === "run").length;
      codes(await owner.prepare(a.protectedWire, a.recoveryCode), "already_prepared");
      expect(h.trace.filter(e => e.kind === "run")).toHaveLength(before); await owner.close();
      const second = await setup([], { databaseName: h.options.databaseName, file: h.file });
      const cold = createInstallationTransferPreparation(second.options); codes(await cold.inspect(), "prepared_unverified");
      codes(await cold.prepare(a.protectedWire, a.recoveryCode), "already_prepared"); await cold.close();
      const old = createInstallationTransferQuarantine(h.options); codes(await old.inspect(), "target_conflict"); await old.close();
      const ordinary = createNativeSqliteStore(h.options); expect((await ordinary.adapter.get("x")).status).toBe("read_failed");
    });
  }
  it("preserves arbitrary raw codeunits through actual SQLite ASCII storage and a fresh connection", async () => {
    const h = await setup(); const sql = createInstallationTransferPreparationSql(h.options, () => false); const a = await protectedArchive();
    expect(await sql.stage(a.protectedWire, a.packageDigest, () => true)).toBe("quarantined");
    const raw = "\u0000\ud800\udfff🥌e\u0301\r\n";
    expect(await sql.prepare(a.protectedWire, a.packageDigest, [{ key: key(7), ascii: encodeTransferCodeUnits(raw), digest: "a".repeat(64) }], () => true)).toBe("prepared");
    await sql.close(); await h.raw({ kind: "open" });
    const value = await h.raw({ kind: "query", sql: "SELECT value_ascii FROM installation_transfer_sporting_v1" }) as { values: { value_ascii: string }[] };
    expect(decodeTransferCodeUnits(value.values[0].value_ascii)).toBe(raw); await h.raw({ kind: "close" });
  });
  it("wrong key and unusable actual domain perform zero native work", async () => {
    const h = await setup(); const owner = createInstallationTransferPreparation(h.options); const a = await protectedArchive({ [key(7)]: "unsupported" });
    codes(await owner.prepare(a.protectedWire, "ct1-" + "A".repeat(43)), "archive_refused");
    codes(await owner.prepare(a.protectedWire, a.recoveryCode), "domain_refused"); expect(h.trace).toEqual([]); await owner.close();
  });
  for (const platform of ["web", "android", "unsupported_native"] as const) {
    it(`refuses ${platform} before engine work`, async () => {
      const h = await setup(); const owner = createInstallationTransferPreparation({ ...h.options, detectPlatform: () => platform });
      const a = await protectedArchive(basic()); codes(await owner.prepare(a.protectedWire, a.recoveryCode), "unavailable"); expect(h.trace).toEqual([]); await owner.close();
    });
  }
  for (const committed of [false, true]) for (const malformed of [false, true]) {
    it(`classifies preparation commit committed=${committed}, malformed=${malformed} without postcommit rollback`, async () => {
      const h = await setup(); const owner = createInstallationTransferPreparation(h.options); const a = await protectedArchive(basic()); let commits = 0;
      h.faults.hook = async (e,next) => { if (e.kind !== "commit" || ++commits === 1) return next(); if (committed) await next(); if (malformed) return {}; throw null; };
      codes(await owner.prepare(a.protectedWire, a.recoveryCode), committed ? "prepared" : "outcome_unresolved");
      const at = h.trace.findLastIndex(e => e.kind === "commit"); expect(h.trace.slice(at+1).some(e => e.kind === "rollback")).toBe(false);
      const count = h.trace.filter(e => e.kind === "begin").length;
      if (!committed) { codes(await owner.prepare(a.protectedWire, a.recoveryCode), "outcome_unresolved"); expect(h.trace.filter(e => e.kind === "begin")).toHaveLength(count); }
      await owner.close();
    });
  }
  for (const boundary of ["begin", "execute", "run", "commit", "close", "open"]) {
    it(`holds issued ${boundary} work during preparation through synchronous close`, async () => {
      const h = await setup(); const owner = createInstallationTransferPreparation(h.options); const a = await protectedArchive(basic()); let firstCommitted = false, entered = false;
      const held = deferred();
      h.faults.hook = async (e,next) => { const result = await next(); if (e.kind === "commit" && !firstCommitted) { firstCommitted = true; return result; } if (firstCommitted && !entered && e.kind === boundary) { entered = true; await held.promise; } return result; };
      const prepare = owner.prepare(a.protectedWire,a.recoveryCode); while (!entered) await wait();
      codes(await owner.inspect(), "busy"); const close = owner.close(); expect(owner.close()).toBe(close); let done = false; void close.then(()=>{done=true;}); await wait(); expect(done).toBe(false);
      held.resolve(null); codes(await prepare, "closed"); codes(await close, "closed");
    });
  }
  it("rolls back both tables and all sporting rows after a failed second insert, permitting an explicit new attempt", async () => {
    const h = await setup(); const owner = createInstallationTransferPreparation(h.options); const a = await protectedArchive(basic()); let inserts = 0;
    h.faults.hook = async (e,next) => { if (e.sql?.startsWith("INSERT INTO installation_transfer_sporting") && ++inserts === 2) throw null; return next(); };
    codes(await owner.prepare(a.protectedWire,a.recoveryCode), "unavailable"); h.faults.hook = undefined;
    codes(await owner.inspect(), "quarantined"); codes(await owner.prepare(a.protectedWire,a.recoveryCode), "prepared"); await owner.close();
  });
  for (const sql of ["DELETE FROM installation_transfer_sporting_v1 WHERE slot=0", "UPDATE installation_transfer_sporting_v1 SET value_ascii='u16:0078' WHERE slot=0", "DROP TABLE installation_transfer_prepared_v1"]) {
    it("retains sticky logical fault on later prepared-data loss or mutation", async () => {
      const h = await setup(); const owner = createInstallationTransferPreparation(h.options); const a = await protectedArchive(basic()); await owner.prepare(a.protectedWire,a.recoveryCode);
      await h.raw({ kind: "execute", sql }); codes(await owner.inspect(), "fault_held"); codes(await owner.close(), "fault_held");
      const other = createInstallationTransferPreparation(h.options); codes(await other.inspect(), "unavailable"); await other.close();
    });
  }
});

it("prepares actual history without changing raw JSON spelling or embedded Unicode", async () => {
  const h = await setup(); const owner = createInstallationTransferPreparation(h.options);
  const session = buildSession({ id: "80000000-0000-4000-8000-000000000008", notes: "SYNTHETIC_UNICODE" });
  const history = JSON.stringify([session]).replace("SYNTHETIC_UNICODE", "\ud800🥌e\u0301");
  const a = await protectedArchive({ [key(1)]: history }); codes(await owner.prepare(a.protectedWire,a.recoveryCode), "prepared"); await owner.close();
  await h.raw({ kind: "open" }); const stored = await h.raw({ kind: "query", sql: "SELECT key,value_ascii FROM installation_transfer_sporting_v1" }) as { values: {key: string; value_ascii: string}[] };
  expect(stored.values).toHaveLength(1); expect(stored.values[0].key).toBe(key(1)); expect(decodeTransferCodeUnits(stored.values[0].value_ascii)).toBe(history); await h.raw({ kind: "close" });
});
it("stages exact original Assessment bytes and reports required recovery without writing overlay defaults", async () => {
  vi.stubGlobal("crypto",webcrypto); const h = await setup(); const owner = createInstallationTransferPreparation(h.options);
  const raw = JSON.stringify({ schemaVersion: 1, currentRun: createTestRun(), history: [] }); const a = await protectedArchive({ [key(3)]: raw });
  codes(await owner.prepare(a.protectedWire,a.recoveryCode), "prepared_recovery_required"); codes(await owner.inspect(), "prepared_recovery_required");
  expect(h.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_sporting")).map(e => e.values?.[1])).toEqual([key(3)]); await owner.close();
});
it("refuses a different ciphertext even for the same actual package", async () => {
  const h = await setup(); const owner = createInstallationTransferPreparation(h.options); const a = await protectedArchive(basic()), b = await protectedArchive(basic());
  codes(await owner.prepare(a.protectedWire,a.recoveryCode), "prepared"); const count = h.trace.filter(e => e.kind === "run").length;
  codes(await owner.prepare(b.protectedWire,b.recoveryCode), "target_conflict"); expect(h.trace.filter(e => e.kind === "run")).toHaveLength(count); await owner.close();
});
for (const mutation of ["DELETE FROM installation_transfer_prepared_v1", "UPDATE installation_transfer_prepared_v1 SET row_count=1", "UPDATE installation_transfer_sporting_v1 SET slot=7 WHERE slot=0", "UPDATE installation_transfer_sporting_v1 SET key='foreign' WHERE slot=0", "UPDATE installation_transfer_sporting_v1 SET value_ascii='u16:XXXX' WHERE slot=0", "CREATE INDEX rogue ON installation_transfer_sporting_v1(key)", "CREATE TABLE rogue (x TEXT)"]) {
  it("cold discovery refuses malformed prepared structures before any write", async () => {
    const h = await setup(); const first = createInstallationTransferPreparation(h.options); const a = await protectedArchive(basic()); await first.prepare(a.protectedWire,a.recoveryCode); await first.close();
    await h.raw({kind:"open"}); await h.raw({kind:"execute", sql:mutation}); await h.raw({kind:"close"}); h.trace.length=0;
    const owner = createInstallationTransferPreparation(h.options); codes(await owner.inspect(),"target_conflict"); await owner.close();
    expect(h.trace.some(e=>["run","begin","commit","execute"].includes(e.kind))).toBe(false);
  });
}
it("waits for malformed rollback metadata in the preparation transaction before physical cleanup", async () => {
  const h = await setup(); const owner = createInstallationTransferPreparation(h.options); const a = await protectedArchive(basic()); const held=deferred(); let waiting=false;
  h.faults.hook=async(e,next)=>{ if(e.sql?.startsWith("INSERT INTO installation_transfer_sporting")) throw null; const value=await next(); if(e.kind==="rollback"){ waiting=true; return {changes:{changes:held.promise}}; } return value; };
  const prepare=owner.prepare(a.protectedWire,a.recoveryCode); while(!waiting)await wait(); const before=h.trace.filter(e=>e.kind==="close").length; await wait(); expect(h.trace.filter(e=>e.kind==="close")).toHaveLength(before);
  const close=owner.close(); held.resolve(0); codes(await prepare,"closed"); codes(await close,"closed");
});

describe("S6h independent boundary witnesses",()=>{
 it("faults on a prepared tuple changing during the first fresh reopened readback",async()=>{
  const h=await setup();const o=createInstallationTransferPreparation(h.options);const a=await protectedArchive(basic());let commits=0,afterCommit=false,seenRows=false,changed=false;
  h.faults.hook=async(e,next)=>{
    const v=await next();
    if(e.kind==="commit"&&++commits===2)afterCommit=true;
    if(afterCommit&&e.sql?.startsWith("SELECT slot,"))seenRows=true;
    if(afterCommit&&seenRows&&!changed&&e.sql==="PRAGMA schema_version;"){changed=true;await h.raw({kind:"execute",sql:"UPDATE installation_transfer_sporting_v1 SET value_ascii='u16:0078' WHERE slot=0"});}
    return v;
  };
  try{codes(await o.prepare(a.protectedWire,a.recoveryCode),"fault_held");}finally{await o.close();}
 });
 it("does not promote a freshly observed before state into a later injected after state",async()=>{
  const h=await setup();const o=createInstallationTransferPreparation(h.options);const a=await protectedArchive(basic());let commits=0,second=false,sawRow=false,injected=false;
  h.faults.hook=async(e,next)=>{
    if(e.kind==="commit"&&++commits===2){second=true;throw null;}
    const v=await next();
    if(second&&e.sql?.startsWith("SELECT singleton,protected_wire"))sawRow=true;
    if(second&&sawRow&&!injected&&e.sql==="PRAGMA schema_version;"){
      injected=true;
      for(const event of h.trace.filter(x=>x.kind==="execute"&&x.sql?.startsWith("CREATE TABLE installation_transfer_")&&!x.sql?.includes("quarantine")))await h.raw({...event,transaction:false});
      for(const event of h.trace.filter(x=>x.kind==="run"&&!x.sql?.includes("quarantine")))await h.raw({...event,transaction:false});
    }
    return v;
  };
  try{const r=await o.prepare(a.protectedWire,a.recoveryCode);expect(["fault_held","outcome_unresolved"]).toContain(r.code);}finally{await o.close();}
 });
 it("rejects a cold prepared plan changed to different but valid ASCII before authenticated equality",async()=>{
  const h=await setup();const a=await protectedArchive(basic());const old=createInstallationTransferPreparation(h.options);await old.prepare(a.protectedWire,a.recoveryCode);await old.close();
  await h.raw({kind:"open"});await h.raw({kind:"execute",sql:"UPDATE installation_transfer_sporting_v1 SET value_ascii='u16:0078' WHERE slot=0"});await h.raw({kind:"close"});
  const o=createInstallationTransferPreparation(h.options);try{codes(await o.inspect(),"prepared_unverified");codes(await o.prepare(a.protectedWire,a.recoveryCode),"target_conflict");}finally{await o.close();}
 });
 it("does not query later prepared fields after first invalid sporting key metadata",async()=>{
  const h=await setup();const a=await protectedArchive(basic());const old=createInstallationTransferPreparation(h.options);await old.prepare(a.protectedWire,a.recoveryCode);await old.close();let later=0;
  h.faults.hook=async(e,next)=>{
    const v=await next();if(!e.sql?.startsWith("SELECT slot,"))return v;
    const row=new Proxy({slot:0,key:"foreign",value_ascii:"u16:",value_digest:"a".repeat(64)},{getOwnPropertyDescriptor(t,k){if(k==="value_ascii")later++;return Reflect.getOwnPropertyDescriptor(t,k);}});
    return {values:[row]};
  };
  const o=createInstallationTransferPreparation(h.options);try{codes(await o.inspect(),"target_conflict");expect(later).toBe(0);}finally{await o.close();}
 });
 it("holds preparation rollback acknowledgement metadata before physical reopen",async()=>{
  const h=await setup();const a=await protectedArchive(basic());const o=createInstallationTransferPreparation(h.options);const held=deferred();let entered=false;
  h.faults.hook=async(e,next)=>{if(e.sql?.startsWith("INSERT INTO installation_transfer_sporting"))throw null;const v=await next();if(e.kind==="rollback"){entered=true;return {changes:{changes:held.promise}};}return v;};
  const p=o.prepare(a.protectedWire,a.recoveryCode);while(!entered)await wait();const closes=h.trace.filter(e=>e.kind==="close").length;await wait();
  try{expect(h.trace.filter(e=>e.kind==="close")).toHaveLength(closes);}finally{held.resolve(0);await p;await o.close();}
 });
 it("preserves exact unnormalized codeunit data through actual domain history + SQLite",async()=>{
  const h=await setup();const o=createInstallationTransferPreparation(h.options);const history=JSON.stringify([buildSession({id:"80000000-0000-4000-8000-000000000008",notes:"RAW"})]).replace("RAW","\ud800\udfff\\u0000e\u0301");
  const a=await protectedArchive({[key(1)]:history});try{codes(await o.prepare(a.protectedWire,a.recoveryCode),"prepared");}finally{await o.close();}
  await h.raw({kind:"open"});const r=await h.raw({kind:"query",sql:"SELECT value_ascii FROM installation_transfer_sporting_v1"}) as {values:{value_ascii:string}[]};expect(decodeTransferCodeUnits(r.values[0].value_ascii)).toBe(history);await h.raw({kind:"close"});
 });
});

it("pins a fresh empty readback before an externally injected quarantine after-state", async () => {
  const h=await setup();const a=await protectedArchive();const owner=createInstallationTransferQuarantine(h.options);let commit=false,sawEmpty=false,injected=false;
  h.faults.hook=async(e,next)=>{
    if(e.kind==="commit"){commit=true;throw null;}
    const value=await next();
    if(commit&&e.sql?.includes("FROM sqlite_master"))sawEmpty=true;
    if(commit&&sawEmpty&&!injected&&e.sql==="PRAGMA schema_version;"){
      injected=true;
      for(const original of h.trace.filter(x=>x.kind==="execute"&&x.sql?.startsWith("CREATE TABLE installation_transfer_")))await h.raw({...original,transaction:false});
      for(const original of h.trace.filter(x=>x.kind==="run"))await h.raw({...original,transaction:false});
    }
    return value;
  };
  try{codes(await owner.stage(a.protectedWire,a.recoveryCode),"fault_held");}finally{await owner.close();}
});
