// S3b executes real disposable SQLite; injected bridge faults are explicitly
// model evidence, never physical Capacitor/Keychain evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNativeCredentialSqliteInventory, createNativeMigrationSqliteStore, createNativeSqliteStore, createNativeCombinedHeldSqliteHost,
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
const CREATE = "CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);";
const META = "CREATE TABLE curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL CHECK(slot IN ('schema','q','f')), value TEXT NOT NULL);";
const D = "curling.nativeMigration.activationRecord.v1";
const L = "curling.nativeMigration.faultLatch.v1";
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
import { TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY } from "../installationTransferInventory";
import { createQuarantineWork, isQuarantineProtectedWire } from "../installationTransferQuarantineWork";
const DDL = "CREATE TABLE installation_transfer_quarantine_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), protected_wire TEXT NOT NULL, package_digest TEXT NOT NULL)";
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

async function protectedArchive() {
  vi.stubGlobal("crypto", webcrypto);
  const names = [...TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY].sort();
  const encoded = await encodeInstallationTransferV3(JSON.stringify({ schemaVersion: 3,
    transferId: "30000000-0000-4000-8000-000000000003", snapshotId: "40000000-0000-4000-8000-000000000004",
    sourceBuild: { version: "synthetic", build: "test" }, catalogContractId: "synthetic",
    listing: { schemaVersion: 1, keys: [] },
    observations: names.map(key => ({ key, state: "absent" })),
    sourceControl: { domain: "absent", credential: "excluded" }, snapshotState: "synthetic_frozen" }));
  if (!encoded.ok) throw Error("synthetic archive refused");
  engine();
  const sealed = await sealInstallationTransferV3(encoded.value.wire);
  if (!sealed.ok) throw Error("synthetic protection refused");
  return sealed;
}
const codes = (value: { code: string; mayIssue: false; mayPublish: false; mayMount: false }, code: string) => expect(value).toEqual({ code, mayIssue: false, mayPublish: false, mayMount: false });
async function durable(h: Awaited<ReturnType<typeof setup>>) {
  await h.raw({ kind: "open" });
  const rows = await h.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_quarantine_v1" });
  await h.raw({ kind: "close" }); return rows;
}

describe("dormant S6g protected quarantine on actual SQLite", () => {
  it("constructs inertly; atomically retains only actual encrypted bytes, reopens and cold-classifies without authentication", async () => {
    const h = await setup(); const q = createInstallationTransferQuarantine(h.options);
    expect(h.trace).toEqual([]); expect(Object.isFrozen(q)).toBe(true); expect(Object.getPrototypeOf(q)).toBe(null);
    codes(await q.inspect(), "empty");
    expect(h.trace.some(e => e.sql?.includes("CREATE"))).toBe(false);
    const a = await protectedArchive();
    codes(await q.stage(a.protectedWire, a.recoveryCode), "quarantined");
    const writes = h.trace.filter(e => e.kind === "run"); expect(writes).toHaveLength(1);
    expect(writes[0].values?.[0]).toBe(a.protectedWire); expect(writes[0].transaction).toBe(false);
    const create = h.trace.findIndex(e => e.sql === DDL), begin = h.trace.findIndex(e => e.kind === "begin"), commit = h.trace.findIndex(e => e.kind === "commit");
    expect(begin).toBeLessThan(create); expect(create).toBeLessThan(commit);
    expect(h.trace.slice(commit + 1).some(e => e.kind === "open")).toBe(true);
    codes(await q.stage(a.protectedWire, a.recoveryCode), "already_quarantined");
    expect(h.trace.filter(e => e.kind === "run")).toHaveLength(1);
    const b = await protectedArchive(); codes(await q.stage(b.protectedWire, b.recoveryCode), "target_conflict");
    codes(await q.close(), "closed");
    const stored = JSON.stringify(await durable(h)); expect(stored).toContain("protected_wire"); expect(stored).not.toContain(a.recoveryCode);
    const second = await setup([], { databaseName: h.options.databaseName, file: h.file });
    const cold = createInstallationTransferQuarantine(second.options); codes(await cold.inspect(), "quarantined_unverified");
    codes(await cold.stage(a.protectedWire, a.recoveryCode), "already_quarantined");
    codes(await cold.close(), "closed");
  });
  for (const platform of ["web", "android", "unsupported_native", "throws"] as const) {
    it(`refuses ${platform} before any engine work`, async () => {
      const create = vi.fn(); const q = createInstallationTransferQuarantine({ databaseName: "synthetic-" + platform, engine: { createConnection: create, closeConnection: vi.fn() }, detectPlatform: () => { if (platform === "throws") throw null; return platform; } });
      codes(await q.inspect(), "unavailable"); expect(create).not.toHaveBeenCalled(); codes(await q.close(), "closed");
    });
  }
  it("invalid inputs, wrong recovery key and corrupt authenticating ciphertext issue no native work", async () => {
    const h = await setup(); const q = createInstallationTransferQuarantine(h.options); const a = await protectedArchive();
    for (const value of [null, {}, new String(a.protectedWire), "", a.protectedWire + "\n"]) codes(await q.stage(value, a.recoveryCode), "invalid_input");
    codes(await q.stage(a.protectedWire, "ct1-" + "A".repeat(43)), "archive_refused");
    expect(h.trace).toEqual([]); await q.close();
  });
  for (const initial of [[CREATE], [CREATE, META], [DDL], [DDL, "CREATE TABLE extra (x TEXT)"], [DDL, "CREATE INDEX extra ON installation_transfer_quarantine_v1(package_digest)"], ["CREATE TABLE installation_transfer_quarantine_v1 (x TEXT)"], ["CREATE VIEW something AS SELECT 1"]]) {
    it("refuses foreign/partial/drifted schemas before writing", async () => {
      const h = await setup(initial); const q = createInstallationTransferQuarantine(h.options);
      codes(await q.inspect(), "target_conflict");
      expect(h.trace.filter(e => ["begin", "commit", "run", "execute"].includes(e.kind))).toEqual([]); await q.close();
    });
  }
  for (const committed of [false, true]) for (const malformed of [false, true]) {
    it(`classifies an unknown commit, actual committed=${committed}, malformed=${malformed}`, async () => {
      const h = await setup(); const q = createInstallationTransferQuarantine(h.options); const a = await protectedArchive();
      h.faults.hook = async (event, next) => {
        if (event.kind !== "commit") return next();
        if (committed) await next();
        if (malformed) return {};
        throw Symbol("opaque");
      };
      codes(await q.stage(a.protectedWire, a.recoveryCode), committed ? "quarantined" : "outcome_unresolved");
      const commit = h.trace.findIndex(e => e.kind === "commit"); expect(h.trace.slice(commit + 1).some(e => e.kind === "rollback")).toBe(false);
      if (!committed) { codes(await q.stage(a.protectedWire, a.recoveryCode), "outcome_unresolved"); expect(h.trace.filter(e => e.kind === "begin")).toHaveLength(1); }
      await q.close();
    });
  }
  for (const boundary of ["begin", "execute", "run"]) {
    it(`ends precommit uncertainty at ${boundary} without leaving a partial schema`, async () => {
      const h = await setup(); const q = createInstallationTransferQuarantine(h.options); const a = await protectedArchive();
      h.faults.hook = async (e, next) => { if (e.kind === boundary && (boundary !== "execute" || e.sql === DDL)) { if (boundary === "begin") await next(); throw null; } return next(); };
      codes(await q.stage(a.protectedWire, a.recoveryCode), "unavailable");
      expect(h.trace.some(e => e.kind === "commit")).toBe(false); h.faults.hook = undefined;
      codes(await q.inspect(), "empty"); await q.close();
    });
  }
  it("retains a sticky logical reservation after observed record loss even when physical cleanup succeeds", async () => {
    const h = await setup(); const q = createInstallationTransferQuarantine(h.options); const a = await protectedArchive();
    codes(await q.stage(a.protectedWire, a.recoveryCode), "quarantined");
    await h.raw({ kind: "execute", sql: "DROP TABLE installation_transfer_quarantine_v1" });
    codes(await q.inspect(), "fault_held"); codes(await q.close(), "fault_held");
    const other = createInstallationTransferQuarantine(h.options); codes(await other.inspect(), "unavailable"); await other.close();
    const ordinary = createNativeSqliteStore(h.options); expect((await ordinary.adapter.get("x")).status).toBe("read_failed");
  });
  it("keeps the same registry across all old factories and refuses their bootstrap against the quarantine", async () => {
    const h = await setup(); const q = createInstallationTransferQuarantine(h.options); const a = await protectedArchive();
    await q.stage(a.protectedWire, a.recoveryCode);
    const ordinary = createNativeSqliteStore(h.options); expect((await ordinary.adapter.get("x")).status).toBe("read_failed");
    await q.close(); h.trace.length = 0;
    expect((await ordinary.adapter.get("x")).status).toBe("read_failed");
    for (const cap of [createNativeCredentialSqliteInventory(h.options), createNativeCombinedHeldSqliteHost(h.options)]) {
      const acquired = await cap.acquire(); if (!acquired.ok) throw Error("synthetic lease refused");
      expect((await cap.observe(acquired.lease)).ok).toBe(false); await cap.release(acquired.lease);
    }
    const migration = createNativeMigrationSqliteStore({ ...h.options, reservedKeys: { record: D, latch: L } });
    const acquired = await migration.target.acquire(); if (!acquired.ok) throw Error("lease refused");
    expect((await migration.target.readReserved(acquired.lease)).ok).toBe(false); await migration.target.release(acquired.lease);
    expect(h.trace.filter(e => ["run", "execute", "begin"].includes(e.kind))).toEqual([]);
  });
  for (const boundary of ["begin", "commit", "run", "close", "open"]) {
    it(`joins issued ${boundary} work on synchronous close, refuses overlap and never rolls back committed work`, async () => {
      const h = await setup(); const q = createInstallationTransferQuarantine(h.options); const a = await protectedArchive();
      const held = deferred(); let entered = false;
      h.faults.hook = async (e, next) => { const value = await next(); if (!entered && e.kind === boundary) { entered = true; await held.promise; } return value; };
      const stage = q.stage(a.protectedWire, a.recoveryCode); while (!entered) await wait();
      codes(await q.inspect(), "busy"); const close = q.close(); expect(q.close()).toBe(close);
      let settled = false; void close.then(() => { settled = true; }); await wait(); expect(settled).toBe(false);
      const other = createInstallationTransferQuarantine(h.options); codes(await other.inspect(), "unavailable"); await other.close();
      held.resolve(null); codes(await stage, "closed"); codes(await close, "closed");
      codes(await q.inspect(), "closed");
      const commit = h.trace.findIndex(e => e.kind === "commit"); if (commit >= 0) expect(h.trace.slice(commit + 1).some(e => e.kind === "rollback")).toBe(false);
    });
  }
  for (const boundary of ["close", "release"]) {
    it(`retains failed ${boundary} cleanup and retries only cleanup`, async () => {
      const h = await setup(); const q = createInstallationTransferQuarantine(h.options); await q.inspect();
      let fail = true, closes = 0;
      h.faults.hook = async (e, next) => { if (e.kind === "close") { closes++; if (fail && (boundary === "close" || closes === 2)) throw null; } return next(); };
      codes(await q.close(), "cleanup_held");
      const other = createInstallationTransferQuarantine(h.options); codes(await other.inspect(), "unavailable"); await other.close();
      fail = false; codes(await q.close(), "closed"); expect(h.trace.some(e => e.kind === "begin")).toBe(false);
    });
  }
  it("retains malformed accessor metadata without invoking it and drains its pending work before cleanup", async () => {
    const h = await setup(); const q = createInstallationTransferQuarantine(h.options); const a = await protectedArchive();
    const held = deferred(); let reads = 0, getters = 0;
    h.faults.hook = async (e, next) => {
      const value = await next();
      if (e.kind !== "begin") return value;
      reads++; const malformed = {}; Object.defineProperty(malformed, "changes", { get: Object.assign(() => { getters++; return {}; }, { then: (resolve: (v: unknown) => void) => held.promise.then(resolve) }) }); return malformed;
    };
    const stage = q.stage(a.protectedWire, a.recoveryCode); while (!reads) await wait();
    const close = q.close(); await wait(); expect(getters).toBe(0); expect(h.trace.some(e => e.kind === "close")).toBe(false);
    held.resolve(null); await stage; codes(await close, "closed"); expect(getters).toBe(0);
  });
  it("uses actual SQLite singleton and NOT NULL constraints and fully rolls back DDL plus insert", async () => {
    const h = await setup(); await h.raw({ kind: "open" }); await h.raw({ kind: "begin" }); await h.raw({ kind: "execute", sql: DDL });
    await expect(h.raw({ kind: "run", sql: "INSERT INTO installation_transfer_quarantine_v1 VALUES (2,'x','x')" })).rejects.toThrow();
    await expect(h.raw({ kind: "run", sql: "INSERT INTO installation_transfer_quarantine_v1 VALUES (1,NULL,'x')" })).rejects.toThrow();
    await h.raw({ kind: "rollback" }); expect(await h.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" })).toEqual({ values: [] }); await h.raw({ kind: "close" });
  });
  it("observes boxed native values, retains rejected descriptor work and never grants owned promises", async () => {
    const own = deferred(); const work = createQuarantineWork(value => value === own.promise);
    await expect(work.value(own.promise)).rejects.toBeNull(); await work.finish();
    const held = deferred(); const w = createQuarantineWork(); const row = { values: held.promise };
    expect(() => w.rows(row, [], 1)).toThrow(); let done = false; void w.finish().then(() => { done = true; }); await wait(); expect(done).toBe(false); held.resolve([]); await w.finish();
  });
  for (const row of ["(1,'x','x')", "(1,'curling-protected-installation-v1','" + "a".repeat(64) + "')"]) {
    it("refuses malformed durable ciphertext/digest without repairing", async () => {
      const h = await setup([DDL, "INSERT INTO installation_transfer_quarantine_v1 VALUES " + row]);
      const q = createInstallationTransferQuarantine(h.options); codes(await q.inspect(), "target_conflict"); await q.close();
      expect(h.trace.some(e => ["begin", "run", "commit", "execute"].includes(e.kind))).toBe(false);
    });
  }
  it("treats positive commit followed by proven disappearance as sticky fault", async () => {
    const h = await setup(); const a = await protectedArchive(); const q = createInstallationTransferQuarantine(h.options);
    h.faults.hook = async (e, next) => { const value = await next(); if (e.kind === "commit") await h.raw({ kind: "execute", sql: "DROP TABLE installation_transfer_quarantine_v1" }); return value; };
    codes(await q.stage(a.protectedWire, a.recoveryCode), "fault_held"); codes(await q.close(), "fault_held");
    const other = createInstallationTransferQuarantine(h.options); codes(await other.inspect(), "unavailable"); await other.close();
  });
  it("retries a failed postcommit reopen only as cleanup before releasing ownership", async () => {
    const h = await setup(); const a = await protectedArchive(); const q = createInstallationTransferQuarantine(h.options);
    let committed = false, fail = true;
    h.faults.hook = async (e, next) => { if (e.kind === "close" && committed && fail) throw null; const value = await next(); if (e.kind === "commit") committed = true; return value; };
    codes(await q.stage(a.protectedWire, a.recoveryCode), "outcome_unresolved"); codes(await q.close(), "cleanup_held");
    const other = createInstallationTransferQuarantine(h.options); codes(await other.inspect(), "unavailable"); await other.close();
    fail = false; codes(await q.close(), "closed");
    expect(h.trace.filter(e => e.kind === "begin")).toHaveLength(1);
    expect(h.trace.filter(e => e.kind === "commit")).toHaveLength(1);
    expect(h.trace.some(e => e.kind === "rollback")).toBe(false);
    const cold = createInstallationTransferQuarantine(h.options); codes(await cold.inspect(), "quarantined_unverified"); await cold.close();
  });
  it("joins pending actual crypto before cleanup and performs no native work after revocation", async () => {
    const h = await setup(); const a = await protectedArchive(); const q = createInstallationTransferQuarantine(h.options);
    const subtle = globalThis.crypto.subtle; const decrypt = subtle.decrypt; const held = deferred(); let entered = false;
    vi.spyOn(subtle, "decrypt").mockImplementation(async (...args) => { entered = true; await held.promise; return Reflect.apply(decrypt, subtle, args); });
    const stage = q.stage(a.protectedWire, a.recoveryCode); while (!entered) await wait();
    const close = q.close(); let finished = false; void close.then(() => { finished = true; }); await wait(); expect(finished).toBe(false);
    held.resolve(null); codes(await stage, "closed"); codes(await close, "closed"); expect(h.trace).toEqual([]);
  });
  for (const phase of ["commit", "begin"]) {
    it(`retains late malformed ${phase} receipt work before issuing cleanup`, async () => {
      const h = await setup(); const a = await protectedArchive(); const q = createInstallationTransferQuarantine(h.options);
      const held = deferred(); let entered = false;
      h.faults.hook = async (e, next) => { const value = await next(); if (e.kind !== phase) return value; entered = true; return { changes: { changes: held.promise } }; };
      const stage = q.stage(a.protectedWire, a.recoveryCode); while (!entered) await wait();
      const observed = h.trace.length; await wait(); expect(h.trace.length).toBe(observed);
      const close = q.close(); held.resolve(0); codes(await stage, "closed"); codes(await close, "closed");
      const commit = h.trace.findIndex(e => e.kind === "commit"); if (commit >= 0) expect(h.trace.slice(commit + 1).some(e => e.kind === "rollback")).toBe(false);
    });
  }
  it("keeps a failed open cleanup reserved until explicit positive release", async () => {
    const h = await setup(); const q = createInstallationTransferQuarantine(h.options); let fail = true;
    h.faults.hook = async (e, next) => { if (fail && ["open", "close"].includes(e.kind)) throw null; return next(); };
    codes(await q.inspect(), "unavailable"); codes(await q.close(), "cleanup_held");
    const other = createInstallationTransferQuarantine(h.options); codes(await other.inspect(), "unavailable"); await other.close();
    fail = false; codes(await q.close(), "closed");
  });

});

describe("S6g independent adversarial witnesses", () => {
  it("rejects first bad schema field before observing later pending metadata", async () => {
    const h = await setup(); const q=createInstallationTransferQuarantine(h.options); const held=deferred(); let later=0, entered=false;
    h.faults.hook=async(e,next)=> {
      if(!e.sql?.includes("sqlite_master"))return next();
      const row=new Proxy({type:"view", name:"bad",tbl_name:"bad",sql:"bad"},{getOwnPropertyDescriptor(t,k){if(k==="name"){later++;return {configurable:true,enumerable:true,writable:true,value:held.promise};}return Reflect.getOwnPropertyDescriptor(t,k);}});
      entered=true;return {values:[row]};
    };
    const inspect=q.inspect(); while(!entered)await wait(); await wait();
    try { expect(later).toBe(0); } finally {held.resolve(null);await inspect;await q.close();}
  });
  it("cold structural discovery rejects digest with a terminal newline", async()=>{
    const h=await setup();const a=await protectedArchive();const first=createInstallationTransferQuarantine(h.options);
    codes(await first.stage(a.protectedWire,a.recoveryCode),"quarantined");await first.close();
    await h.raw({kind:"open"});await h.raw({kind:"run",sql:"UPDATE installation_transfer_quarantine_v1 SET package_digest=?",values:[a.packageDigest+"\n"]});await h.raw({kind:"close"});
    const q=createInstallationTransferQuarantine(h.options);try{codes(await q.inspect(),"target_conflict");}finally{await q.close();}
  });
  it("does not reopen before malformed rollback metadata settles",async()=>{
    const h=await setup();const a=await protectedArchive();const q=createInstallationTransferQuarantine(h.options);const held=deferred();let rollback=false;
    h.faults.hook=async(e,next)=>{
      if(e.kind==="run")throw null;
      const v=await next();if(e.kind==="rollback"){rollback=true;return {changes:{changes:held.promise}};}return v;
    };
    const stage=q.stage(a.protectedWire,a.recoveryCode);while(!rollback)await wait();await wait();
    try{expect(h.trace.filter(e=>e.kind==="close")).toHaveLength(0);}finally{held.resolve(0);await stage;await q.close();}
  });
  it("pins first positive full discovery even before final explicit read",async()=>{
    const h=await setup();const a=await protectedArchive();const first=createInstallationTransferQuarantine(h.options);await first.stage(a.protectedWire,a.recoveryCode);await first.close();
    let reads=0;
    h.faults.hook=async(e,next)=>{const v=await next();if(e.sql?.startsWith("SELECT singleton")){reads++;if(reads===1)await h.raw({kind:"run",sql:"UPDATE installation_transfer_quarantine_v1 SET package_digest=?",values:["b".repeat(64)]});}return v;};
    const q=createInstallationTransferQuarantine(h.options);try{codes(await q.inspect(),"fault_held");}finally{await q.close();}
  });
  it("rejects structurally tag-only protected ciphertext at cold discovery",async()=>{
    const h=await setup([DDL]);const wire="curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n"+"A".repeat(16)+"\n"+"A".repeat(22);
    await h.raw({kind:"open"});await h.raw({kind:"run",sql:"INSERT INTO installation_transfer_quarantine_v1 VALUES (1,?,?)",values:[wire,"a".repeat(64)]});await h.raw({kind:"close"});
    const q=createInstallationTransferQuarantine(h.options);try{codes(await q.inspect(),"target_conflict");}finally{await q.close();}
  });

});

it("matches exact S6e decoded ciphertext minimum and base64url trailing bits", () => {
  const header = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n" + "A".repeat(16) + "\n";
  for (const bytes of [0, 15, 16, 17, 18, 19]) {
    const body = Buffer.alloc(bytes).toString("base64url");
    expect(isQuarantineProtectedWire(header + body)).toBe(bytes > 16);
  }
  expect(isQuarantineProtectedWire(header + "A".repeat(22) + "B")).toBe(false);
});

describe("adjacent independent ownership controls", () => {
  it("retains the already-obtained invalid field work while refusing later fields",async()=>{
    const held=deferred();const work=createQuarantineWork();let later=0;
    const row=new Proxy({a:held.promise,b:0},{getOwnPropertyDescriptor(t,k){if(k==="b")later++;return Reflect.getOwnPropertyDescriptor(t,k);}});
    expect(()=>work.rows({values:[row]},["a","b"],1,()=>{throw null;})).toThrow();expect(later).toBe(0);
    let finished=false;void work.finish().then(()=>{finished=true;});await wait();expect(finished).toBe(false);held.resolve(null);await work.finish();expect(later).toBe(0);
  });
  it("refuses later row descriptors after first invalid row field",async()=>{
    const work=createQuarantineWork();let later=0;const list=new Proxy([{a:0},{a:1}],{getOwnPropertyDescriptor(t,k){if(k==="1")later++;return Reflect.getOwnPropertyDescriptor(t,k);}});
    expect(()=>work.rows({values:list},["a"],2,()=>{throw null;})).toThrow();await work.finish();expect(later).toBe(0);
  });
  it("rejects the bad acknowledgement count before lastId metadata",async()=>{
    const work=createQuarantineWork();let later=0;
    const changes=new Proxy({changes:0,lastId:1,values:[]},{getOwnPropertyDescriptor(t,k){if(k==="lastId")later++;return Reflect.getOwnPropertyDescriptor(t,k);}});
    expect(()=>work.ack({changes},1)).toThrow();await work.finish();expect(later).toBe(0);
  });
  it("does not harvest descriptors after a known structural key mismatch",async()=>{
    const work=createQuarantineWork();let reads=0;
    const input=new Proxy({values:[],unexpected:0},{getOwnPropertyDescriptor(t,k){if(k!=="then")reads++;return Reflect.getOwnPropertyDescriptor(t,k);}});
    expect(()=>work.rows(input,[],1)).toThrow();await work.finish();expect(reads).toBe(0);
  });
  it("retains first fresh-reopen durable evidence after unknown commit",async()=>{
    const h=await setup();const a=await protectedArchive();const q=createInstallationTransferQuarantine(h.options);let committed=false,changed=false;
    h.faults.hook=async(e,next)=>{
      const value=await next();
      if(e.kind==="commit"){committed=true;throw null;}
      if(committed&&!changed&&e.sql?.startsWith("SELECT singleton")){changed=true;await h.raw({kind:"execute",sql:"DROP TABLE installation_transfer_quarantine_v1"});}
      return value;
    };
    try{codes(await q.stage(a.protectedWire,a.recoveryCode),"fault_held");codes(await q.close(),"fault_held");expect(h.trace.some(e=>e.kind==="rollback")).toBe(false);}finally{await q.close();}
  });

  it("does not reopen on ordinary inspect after failed open cleanup",async()=>{
    const h=await setup();const q=createInstallationTransferQuarantine(h.options);let fail=true;
    h.faults.hook=async(e,next)=>{
      if(e.kind==="close"&&fail)throw null;
      const value=await next();if(e.kind==="open"&&fail)throw null;return value;
    };
    codes(await q.inspect(),"unavailable");const opens=h.trace.filter(e=>e.kind==="open").length;fail=false;
    try{await q.inspect();expect(h.trace.filter(e=>e.kind==="open")).toHaveLength(opens);}finally{await q.close();}
  });

});

it("allows another observation when failed-open cleanup was positively completed", async () => {
  const h = await setup(); const q = createInstallationTransferQuarantine(h.options); let fail = true;
  h.faults.hook = async (event, next) => { const value = await next(); if (event.kind === "open" && fail) throw null; return value; };
  codes(await q.inspect(), "unavailable"); fail = false;
  codes(await q.inspect(), "empty"); expect(h.trace.filter(e => e.kind === "open")).toHaveLength(2); await q.close();
});
