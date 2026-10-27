// S3b executes real disposable SQLite; injected bridge faults are explicitly
// model evidence, never physical Capacitor/Keychain evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    configure: () => call("configure", () => undefined),
    inventory: () => call("inventory", () => ({ kind: "complete", keys: [...initial.keys()].sort() })),
    read: (slot: string) => call("read", () => initial.has(slot) ? { kind: "value", value: initial.get(slot) } : { kind: "established_absent" }),
    write: (slot: string, raw: string) => call("write", () => { initial.set(slot, raw); }),
  };
  const { createInstallationTransferPairing } = await import("../installationTransferPairing");
  const options = { sqlite: h.options, providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", protectedBinding: binding, detectPlatform: () => "ios" };
  return { owner: createInstallationTransferPairing(options), options, trace, values: initial, faults, create: createInstallationTransferPairing };
}
const code = (r: { code: string; mayIssue: false; mayPublish: false; mayMount: false }, expected: string) => expect(r).toEqual({ code: expected, mayIssue: false, mayPublish: false, mayMount: false });

import { createTransferPair, readTransferPair, transferBoundQ } from "../installationTransferPairProtocol";
it("pins a distinct new empty Q/M pair and explicit new anchor correlation, never Dactive", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const pair = (await createTransferPair("pc1:synthetic", "sb-synthetic-auth-token"))!;
  expect(pair).not.toBeNull(); const valid = readTransferPair(pair.intentQ, pair.manifest)!;
  expect(valid.q.initialEntryKeys).toEqual([]); expect(valid.m.items).toEqual([]); expect(valid.m.fixedSlots.every(s => s.presence === "absent")).toBe(true);
  const bound = transferBoundQ(pair.intentQ, pair.manifest)!; expect(readTransferPair(pair.intentQ, pair.manifest, bound)?.bound?.storeIdentity).toBe(valid.q.expectedStoreIdentity);
  expect(readTransferPair(" " + pair.intentQ, pair.manifest)).toBeNull();
  expect(readTransferPair(pair.intentQ, pair.manifest, pair.intentQ)).toBeNull();
  const other = (await createTransferPair("pc1:other", "sb-synthetic-auth-token"))!;
  expect(readTransferPair(pair.intentQ, other.manifest)).toBeNull();
  expect(readTransferPair(pair.intentQ, pair.manifest, transferBoundQ(other.intentQ, other.manifest))).toBeNull();
  for (const bad of [null, {}, new String(pair.intentQ), "x".repeat(2049)]) expect(readTransferPair(bad, pair.manifest)).toBeNull();
});

describe("actual destination pairing through disposable SQLite and protected bridge model", () => {
  it("is inert, uses one target and new empty credentials, binds atomically and resumes cold without writes", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive(basic());
    expect(h.trace).toEqual([]); expect(f.trace).toEqual([]);
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired");
    expect(f.trace.filter(x => x === "write")).toHaveLength(1);
    expect(h.trace.filter(x => x.kind === "begin")).toHaveLength(4);
    expect(h.trace.filter(x => x.sql?.startsWith("INSERT INTO installation_transfer_pair"))).toHaveLength(1);
    expect(h.trace.filter(x => x.sql?.startsWith("INSERT INTO installation_transfer_binding"))).toHaveLength(1);
    const inserted = h.trace.filter(x => x.sql?.startsWith("INSERT INTO"));
    expect(JSON.stringify(inserted)).not.toContain(a.recoveryCode);
    expect(inserted.some(x => x.sql?.includes("records") || x.sql?.includes("credential_meta"))).toBe(false);
    code(await f.owner.inspect(), "paired");
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired");
    expect(f.trace.filter(x => x === "write")).toHaveLength(1);
    code(await f.owner.close(), "closed");
    const cold = f.create(f.options);
    code(await cold.inspect(), "paired_unverified");
    code(await cold.pair(a.protectedWire, a.recoveryCode), "paired");
    expect(f.trace.filter(x => x === "write")).toHaveLength(1);
    code(await cold.close(), "closed");
  });
  it("refuses wrong code before native work and preserves an orphan/foreign protected entry before intent", async () => {
    const h = await setup(), f = await fixture(h, new Map([["orphan", "preserved"]])), a = await protectedArchive(basic());
    code(await f.owner.pair(a.protectedWire, "ct1-"+"A".repeat(43)), "archive_refused");
    expect(h.trace).toEqual([]); expect(f.trace).toEqual([]);
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "fault_held");
    expect(h.trace.some(x => x.sql?.startsWith("INSERT INTO installation_transfer_pair"))).toBe(false);
    expect(f.values.get("orphan")).toBe("preserved");
    code(await f.owner.close(), "fault_held");
    const { ordinaryCredentialNamespaceAvailable } = await import("../nativeCredentialNamespace");
    expect(ordinaryCredentialNamespaceAvailable()).toBe(false);
    const { createNativeSqliteStore } = await import("../nativeSqliteAdapter");
    expect((await createNativeSqliteStore(h.options).adapter.get("x")).status).toBe("read_failed");
  });
  for (const phase of ["before_manifest", "after_manifest"] as const) {
    it(`cold resumes durable intent ${phase} using the SAME pair, no new IDs`, async () => {
      const h = await setup(), f = await fixture(h), a = await protectedArchive();
      const { createInstallationTransferPairingSql } = await import("../installationTransferQuarantineSql");
      const { admitTransferPreparation } = await import("../installationTransferAdmission");
      const admitted = await admitTransferPreparation(a.protectedWire, a.recoveryCode, () => true); expect(admitted.ok).toBe(true); if (!admitted.ok) return;
      const sql = createInstallationTransferPairingSql(h.options, () => false), pair = (await createTransferPair(f.options.providerConfigIdentity, f.options.sessionStorageKey))!;
      expect(await sql.stage(admitted.wire, admitted.digest, () => true)).toBe("quarantined");
      expect(await sql.prepare(admitted.wire, admitted.digest, admitted.rows, () => true)).toBe("prepared");
      expect(await sql.intent(pair, () => true)).toBe("pair_intent");
      expect(await sql.close()).toBe("closed");
      if (phase === "after_manifest") { const { credentialManifestSlot } = await import("../credentialPhysicalSlots"); const slot = credentialManifestSlot(f.options.providerConfigIdentity); if (slot.ok) f.values.set(slot.value, pair.manifest); }
      code(await f.owner.inspect(), "pair_intent_unverified");
      code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired");
      expect(f.trace.filter(x => x === "write")).toHaveLength(phase === "after_manifest" ? 0 : 1);
      expect([...f.values.values()]).toEqual([pair.manifest]);
      code(await f.owner.close(), "closed");
    });
  }
  it("blocks missing M after paired cold restart without recreating it", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive();
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired"); code(await f.owner.close(), "closed");
    f.values.clear(); const cold = f.create(f.options), count = f.trace.filter(x => x === "write").length;
    code(await cold.pair(a.protectedWire, a.recoveryCode), "fault_held");
    expect(f.trace.filter(x => x === "write")).toHaveLength(count);
    code(await cold.close(), "fault_held");
  });
  it("does not retire either logical owner when actual protected work faulted then becomes releasing", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive();
    f.faults.hook = (kind, next) => { if (kind === "write") { next(); throw Error("synthetic lost protected ack"); } return next(); };
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "fault_held");
    code(await f.owner.close(), "fault_held"); code(await f.owner.close(), "fault_held");
    const { ordinaryCredentialNamespaceAvailable } = await import("../nativeCredentialNamespace"); expect(ordinaryCredentialNamespaceAvailable()).toBe(false);
    const { createNativeSqliteStore } = await import("../nativeSqliteAdapter"); expect((await createNativeSqliteStore(h.options).adapter.get("x")).status).toBe("read_failed");
  });
  it("retains BOTH holds through failed physical SQL cleanup, then retries cleanup without writes", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive();
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired");
    const count = f.trace.filter(x => x === "write").length;
    let reject = true; h.faults.hook = async (e, next) => { if (e.kind === "close" && reject) throw Error("synthetic close failure"); return next(); };
    code(await f.owner.close(), "cleanup_held");
    const { ordinaryCredentialNamespaceAvailable } = await import("../nativeCredentialNamespace"); expect(ordinaryCredentialNamespaceAvailable()).toBe(false);
    const { createNativeSqliteStore } = await import("../nativeSqliteAdapter"); expect((await createNativeSqliteStore(h.options).adapter.get("x")).status).toBe("read_failed");
    reject = false; code(await f.owner.close(), "closed"); expect(ordinaryCredentialNamespaceAvailable()).toBe(true);
    expect(f.trace.filter(x => x === "write")).toHaveLength(count);
  });
  it("faults M that appears in fresh insertion pre-read before the real issuance event", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive();
    let reads = 0;
    f.faults.hook = (kind, next) => {
      if (kind === "read" && ++reads === 3) return { kind: "value", value: "foreign" };
      return next();
    };
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "fault_held");
    expect(f.trace.filter(x => x === "write")).toHaveLength(0);
    expect(h.trace.some(x => x.sql?.startsWith("INSERT INTO installation_transfer_binding"))).toBe(false);
    code(await f.owner.close(), "fault_held");
  });
  it("returns busy and synchronously revokes/join issued manifest work on close", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive(), at = deferred(), held = deferred();
    f.faults.hook = async (kind, next) => { if (kind === "write") { at.resolve(null); await held.promise; } return next(); };
    const pairing = f.owner.pair(a.protectedWire, a.recoveryCode); await at.promise;
    code(await f.owner.inspect(), "busy"); const closing = f.owner.close(); let done = false; void closing.then(() => { done = true; });
    await wait(); expect(done).toBe(false); held.resolve(null);
    code(await pairing, "closed"); expect((await closing).code).toBe("fault_held");
    expect(h.trace.some(x => x.sql?.startsWith("INSERT INTO installation_transfer_binding"))).toBe(false);
  });
  for (const commit of [3, 4]) for (const committed of [false, true]) {
    it(`classifies lost SQL commit ${commit} ack from actual reopened state, committed=${committed}`, async () => {
      const h = await setup(), f = await fixture(h), a = await protectedArchive(); let commits = 0;
      h.faults.hook = async (e, next) => {
        if (e.kind !== "commit" || ++commits !== commit) return next();
        if (committed) await next(); throw Error("synthetic lost SQL ack");
      };
      code(await f.owner.pair(a.protectedWire, a.recoveryCode), committed ? "paired" : "outcome_unresolved");
      expect(f.trace.filter(x => x === "write")).toHaveLength(commit === 3 && !committed ? 0 : 1);
      const after = h.trace.findLastIndex(x => x.kind === "commit"); expect(h.trace.slice(after + 1).some(x => x.kind === "rollback")).toBe(false);
      const begins = h.trace.filter(x => x.kind === "begin").length;
      if (!committed) {
        code(await f.owner.pair(a.protectedWire, a.recoveryCode), "outcome_unresolved");
        expect(h.trace.filter(x => x.kind === "begin")).toHaveLength(begins);
      }
      code(await f.owner.close(), committed ? "closed" : "fault_held");
    });
  }
  for (const statement of [
    "CREATE TABLE unexpected (x TEXT)",
    "DELETE FROM installation_transfer_binding_v1",
    "UPDATE installation_transfer_binding_v1 SET package_digest='" + "0".repeat(64) + "'",
    "UPDATE installation_transfer_pair_v1 SET manifest='{}'",
    "DELETE FROM installation_transfer_sporting_v1",
  ]) {
    it(`holds both owners on complete paired SQL drift: ${statement.slice(0, 55)}`, async () => {
      const h = await setup(), f = await fixture(h), a = await protectedArchive(basic());
      code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired");
      await h.raw({ kind: "execute", sql: statement });
      code(await f.owner.inspect(), "fault_held"); code(await f.owner.close(), "fault_held");
      const { ordinaryCredentialNamespaceAvailable } = await import("../nativeCredentialNamespace"); expect(ordinaryCredentialNamespaceAvailable()).toBe(false);
    });
  }
  it("does not enter protected work for configured pair mismatch and old modes refuse paired target", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive();
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired"); code(await f.owner.close(), "closed");
    const count = f.trace.length;
    const foreign = f.create({ ...f.options, providerConfigIdentity: "pc1:other" });
    code(await foreign.pair(a.protectedWire, a.recoveryCode), "target_conflict"); expect(f.trace).toHaveLength(count); code(await foreign.close(), "closed");
    const { createInstallationTransferQuarantine } = await import("../installationTransferQuarantine");
    const { createInstallationTransferPreparation } = await import("../installationTransferPreparation");
    const q = createInstallationTransferQuarantine(h.options); code(await q.inspect(), "target_conflict"); code(await q.close(), "closed");
    const p = createInstallationTransferPreparation(h.options); code(await p.inspect(), "target_conflict"); code(await p.close(), "closed");
    const { createNativeSqliteStore } = await import("../nativeSqliteAdapter"); const ordinary = createNativeSqliteStore(h.options);
    expect((await ordinary.adapter.get("x")).status).toBe("read_failed"); await ordinary.close();
  });
  it("rejects an I entry before runtime publication and never deletes or rewrites it", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive();
    code(await f.owner.pair(a.protectedWire, a.recoveryCode), "paired"); code(await f.owner.close(), "closed");
    f.values.set("i1.synthetic", "preserve"); const cold = f.create(f.options), count = f.trace.filter(x => x === "write").length;
    code(await cold.pair(a.protectedWire, a.recoveryCode), "fault_held"); code(await cold.close(), "fault_held");
    expect(f.values.get("i1.synthetic")).toBe("preserve"); expect(f.trace.filter(x => x === "write")).toHaveLength(count);
  });
  it("owns malformed asynchronous UUID work and closes only after it settles, without intent", async () => {
    const h = await setup(), f = await fixture(h), a = await protectedArchive(), at = deferred(), held = deferred();
    vi.stubGlobal("crypto", { subtle: webcrypto.subtle, getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID() { at.resolve(null); return held.promise; } });
    const pairing = f.owner.pair(a.protectedWire, a.recoveryCode); await at.promise;
    const closing = f.owner.close(); let done = false; void closing.then(() => { done = true; }); await wait(); expect(done).toBe(false);
    held.resolve("malformed async UUID"); code(await pairing, "closed"); code(await closing, "closed");
    expect(h.trace.some(x => x.sql?.startsWith("INSERT INTO installation_transfer_pair"))).toBe(false);
    expect(f.trace.filter(x => x === "write")).toHaveLength(0);
  });
  it("rechecks cancellation after the actual optional insert event before native issuance", async () => {
    const { createNativeCommonCredentialMigrationPort } = await import("../nativeCredentialMigrationPort");
    const { credentialManifestSlot } = await import("../credentialPhysicalSlots");
    const h = await setup(), f = await fixture(h); vi.stubGlobal("crypto", webcrypto);
    const pair = (await createTransferPair(f.options.providerConfigIdentity, f.options.sessionStorageKey))!;
    let allowed = true, events = 0;
    const created = createNativeCommonCredentialMigrationPort({ providerConfigIdentity: f.options.providerConfigIdentity, sessionStorageKey: f.options.sessionStorageKey,
      binding: f.options.protectedBinding, detectPlatform: () => "ios" }, { inventory() {}, slot() {}, insertIssued() { events++; allowed = false; } });
    expect(created.ok).toBe(true); if (!created.ok) return;
    const lease = await created.value.acquire(), address = credentialManifestSlot(f.options.providerConfigIdentity); if (!lease.ok || !address.ok) throw Error("synthetic lease");
    expect(await created.value.insert(lease.lease, address.value, pair.manifest, { proceed: () => allowed })).toEqual({ status: "refused", reason: "cancelled" });
    expect(events).toBe(1); expect(f.trace.filter(x => x === "write")).toHaveLength(0);
    expect(await created.value.release(lease.lease)).toEqual({ ok: true });
  });
});


describe("S6i independent boundary probes",()=>{
 it("stops generating IDs immediately after a known invalid primitive UUID",async()=>{
  let calls=0;vi.stubGlobal("crypto",{randomUUID(){calls++;return calls===1?"invalid":webcrypto.randomUUID();}});
  expect(await createTransferPair("pc1:synthetic","sb-synthetic-auth-token")).toBeNull();expect(calls).toBe(1);
 });
 it("stops generating IDs immediately after a known duplicate UUID",async()=>{
  let calls=0;const fixed=webcrypto.randomUUID();vi.stubGlobal("crypto",{randomUUID(){calls++;return calls<=2?fixed:webcrypto.randomUUID();}});
  expect(await createTransferPair("pc1:synthetic","sb-synthetic-auth-token")).toBeNull();expect(calls).toBe(2);
 });
 it("does not issue further UUID calls after synchronous owner close",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();let calls=0,armed=false,closing:Promise<unknown>|null=null;
  f.faults.hook=(kind,next)=>{const value=next();if(kind==="read"&&!armed){armed=true;vi.stubGlobal("crypto",{subtle:webcrypto.subtle,getRandomValues:webcrypto.getRandomValues.bind(webcrypto),randomUUID(){calls++;if(calls===1)closing=f.owner.close();return webcrypto.randomUUID();}});}return value;};
  const r=await f.owner.pair(a.protectedWire,a.recoveryCode);code(r,"closed");if(closing)await closing;expect(calls).toBe(1);expect(h.trace.some(e=>e.sql?.startsWith("INSERT INTO installation_transfer_pair"))).toBe(false);
 });
 it("faults the exact expected M in fresh insert pre-read without native write",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();let expected="",reads=0;
  h.faults.hook=async(e,next)=>{if(e.sql?.startsWith("INSERT INTO installation_transfer_pair"))expected=e.values![2] as string;return next();};
  f.faults.hook=(kind,next)=>kind==="read"&&++reads===3?{kind:"value",value:expected}:next();
  try{code(await f.owner.pair(a.protectedWire,a.recoveryCode),"fault_held");expect(expected.length).toBeGreaterThan(0);expect(f.trace.filter(e=>e==="write")).toHaveLength(0);}finally{await f.owner.close();}
 });
 it("retains both owners on actual native handle release failure, then retries only cleanup",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();code(await f.owner.pair(a.protectedWire,a.recoveryCode),"paired");let closes=0,fail=true;
  h.faults.hook=async(e,next)=>{if(e.kind==="close"&&++closes===2&&fail)throw null;return next();};
  code(await f.owner.close(),"cleanup_held");const ns=await import("../nativeCredentialNamespace");expect(ns.ordinaryCredentialNamespaceAvailable()).toBe(false);
  fail=false;code(await f.owner.close(),"closed");expect(ns.ordinaryCredentialNamespaceAvailable()).toBe(true);expect(f.trace.filter(e=>e==="write")).toHaveLength(1);
 });
 it("pins bound SQL first readback and retains both owners on later binding loss",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();let commits=0,bound=false,saw=false,changed=false;
  h.faults.hook=async(e,next)=>{const v=await next();if(e.kind==="commit"&&++commits===4)bound=true;if(bound&&e.sql?.startsWith("SELECT singleton,package_digest,bound_q"))saw=true;if(bound&&saw&&!changed&&e.sql==="PRAGMA schema_version;"){changed=true;await h.raw({kind:"execute",sql:"DROP TABLE installation_transfer_binding_v1"});}return v;};
  code(await f.owner.pair(a.protectedWire,a.recoveryCode),"fault_held");code(await f.owner.close(),"fault_held");const ns=await import("../nativeCredentialNamespace");expect(ns.ordinaryCredentialNamespaceAvailable()).toBe(false);
 });
 it("keeps cold structural inspect independent from the protected namespace",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();await f.owner.pair(a.protectedWire,a.recoveryCode);await f.owner.close();const n=f.trace.length;const cold=f.create(f.options);code(await cold.inspect(),"paired_unverified");expect(f.trace).toHaveLength(n);await cold.close();
 });
 for(const boundary of ["close","release"] as const) it(`retains both owners when ${boundary} returns malformed void acknowledgement`,async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();code(await f.owner.pair(a.protectedWire,a.recoveryCode),"paired");
  if(boundary==="close"){
   const c=await h.options.engine.createConnection("");const original=c.close;
   c.close=async()=>{await original();return {unexpected:true} as never;};
  }else{const original=h.options.engine.closeConnection;h.options.engine.closeConnection=async(name)=>{await original(name);return {unexpected:true} as never;};}
  code(await f.owner.close(),"cleanup_held");const ns=await import("../nativeCredentialNamespace");expect(ns.ordinaryCredentialNamespaceAvailable()).toBe(false);
 });
 it("does not fresh-open after malformed close acknowledgement during transaction readback",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();const c=await h.options.engine.createConnection("");const original=c.close;
  let closes=0;c.close=async()=>{closes++;await original();return {unexpected:true} as never;};
  code(await f.owner.pair(a.protectedWire,a.recoveryCode),"outcome_unresolved");expect(closes).toBe(1);expect(h.trace.filter(e=>e.kind==="open")).toHaveLength(1);await f.owner.close();
 });

 it("refuses malformed native open acknowledgement before SQL discovery or protected work",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();const c=await h.options.engine.createConnection("");const original=c.open;
  c.open=async()=>{await original();return {unexpected:true} as never;};
  code(await f.owner.pair(a.protectedWire,a.recoveryCode),"unavailable");expect(h.trace.filter(e=>e.kind==="query")).toHaveLength(0);expect(f.trace).toHaveLength(0);await f.owner.close();
 });
 it("joins already returned malformed close work before allowing any paired cleanup retirement",async()=>{
  const h=await setup(),f=await fixture(h),a=await protectedArchive();code(await f.owner.pair(a.protectedWire,a.recoveryCode),"paired");const c=await h.options.engine.createConnection(""),original=c.close,p=deferred();
  c.close=async()=>{await original();return {then:p.promise} as never;};let settled=false;const closing=f.owner.close().then(r=>{settled=true;return r;});await wait();
  try{expect(settled).toBe(false);}finally{p.resolve(undefined);await closing;}
 });

 it("does not deadlock on actual SQL cleanup promise returned as native close work",async()=>{
  const h=await setup();const {createInstallationTransferPairingSql}=await import("../installationTransferQuarantineSql");
  const sql=createInstallationTransferPairingSql(h.options,()=>false);expect(await sql.inspect(()=>true)).toBe("empty");const c=await h.options.engine.createConnection("");
  c.close=()=>cleanup as Promise<never>;const cleanup=sql.cleanup();const result=await Promise.race([cleanup.then(()=>"settled"),wait().then(()=>"pending")]);expect(result).toBe("settled");
 });

});

it("drains malformed opening-failure close work before by-name release and parent completion", async () => {
  const h = await setup(), f = await fixture(h), a = await protectedArchive(), held = deferred(), at = deferred();
  const c = await h.options.engine.createConnection(""), open = c.open, close = c.close, release = h.options.engine.closeConnection;
  let releases = 0;
  c.open = async () => { await open(); return {} as never; };
  c.close = async () => { await close(); at.resolve(null); return { then: held.promise } as never; };
  h.options.engine.closeConnection = async name => { releases++; await release(name); };
  const pairing = f.owner.pair(a.protectedWire, a.recoveryCode); await at.promise;
  const closing = f.owner.close(); let done = false; void closing.then(() => { done = true; }); await wait();
  expect(done).toBe(false); expect(releases).toBe(0);
  held.resolve(undefined); code(await pairing, "closed"); code(await closing, "closed"); expect(releases).toBe(1);
});
it("releases both healthy holds after explicit cleanup positively classifies previously unreadable bound commit", async () => {
  const h = await setup(), f = await fixture(h), a = await protectedArchive();
  const c = await h.options.engine.createConnection(""), original = c.close;
  let commits = 0, bad = false;
  h.faults.hook = async (e, next) => { const result = await next(); if (e.kind === "commit" && ++commits === 4) bad = true; return result; };
  c.close = async () => { await original(); if (bad) { bad = false; return {} as never; } };
  code(await f.owner.pair(a.protectedWire, a.recoveryCode), "outcome_unresolved");
  code(await f.owner.close(), "closed");
  const { ordinaryCredentialNamespaceAvailable } = await import("../nativeCredentialNamespace"); expect(ordinaryCredentialNamespaceAvailable()).toBe(true);
  expect(f.trace.filter(x => x === "write")).toHaveLength(1);
});
