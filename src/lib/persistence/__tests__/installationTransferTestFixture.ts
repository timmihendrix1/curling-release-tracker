// S3b executes real disposable SQLite; injected bridge faults are explicitly
// model evidence, never physical Capacitor/Keychain evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { vi } from "vitest";
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
export const cleanups: (() => Promise<void>)[] = [];
export async function disposeTransferFixtures() { while (cleanups.length) await cleanups.pop()!(); }
type Event = { kind: string; sql?: string; values?: unknown[]; transaction?: boolean };
type Hook = (event: Event, next: () => Promise<unknown>) => Promise<unknown>;
export async function setup(statements: string[] = [], existing?: { databaseName: string; file: string }) {
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
export async function protectedArchive(raws: Record<string, string> = {}) {
  vi.stubGlobal("crypto", webcrypto);
  const profiles = [...new Set(Object.keys(raws).filter(k => k.startsWith("curling.sporting.profile.v1.")).map(k => k.slice("curling.sporting.profile.v1.".length, "curling.sporting.profile.v1.".length + 36)))];
  const names = [...new Set([...Object.keys(raws), ...TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, ...profiles.flatMap(id => TRANSFER_SPORTING_SUFFIXES.map(suffix => `curling.sporting.profile.v1.${id}.${suffix}`))])].sort();
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
export const basic = () => ({ [`curling.sporting.profile.v1.${profile}.${TRANSFER_SPORTING_SUFFIXES[7]}`]: "true" });
