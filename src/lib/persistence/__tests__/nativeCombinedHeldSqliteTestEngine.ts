// Real disposable SQLite + installed-plugin statement model. Bridge faults
// below are explicitly injected; this is NOT physical Capacitor evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { createNativeCombinedHeldSqliteHost, type NativeSqliteConnection, type NativeSqliteEngine, type NativeSqliteQueryResult } from "../nativeSqliteAdapter";
import { preprocessPluginExecute, type PluginPlatform } from "./pluginFaithfulSqliteEngine";
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
    if r.get('transaction'):c.execute('COMMIT')
   except:
    if r.get('transaction'):c.execute('ROLLBACK')
    raise
  elif k in ['begin','commit','rollback']:
   c.execute(k.upper());v={'changes':{'changes':0}}
  print(json.dumps({'ok':True,'value':v}),flush=True)
 except:print(json.dumps({'ok':False}),flush=True)
`;
export const CREATE = "CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);";
export const META = "CREATE TABLE curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL CHECK(slot IN ('schema','q','f')), value TEXT NOT NULL);";
export const MARKER = '{"schemaVersion":1,"kind":"credential-cross-store-meta"}';
export const D = "curling.nativeMigration.activationRecord.v1";
export const L = "curling.nativeMigration.faultLatch.v1";
const cleanups: (() => Promise<void>)[] = [];
export async function disposeCombinedFixtures() { while (cleanups.length) await cleanups.pop()!(); }
type Event = { kind: string; sql?: string; values?: unknown[]; transaction?: boolean };
type Hook = (event: Event, next: () => Promise<unknown>) => Promise<unknown>;
export async function combinedFixture(platform: PluginPlatform = "ios", statements: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "curling-s3e-sqlite-"));
  const child = spawn("python3", ["-u", "-c", WORKER, path.join(directory, "synthetic.sqlite")], { stdio: ["pipe", "pipe", "ignore"] });
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
    execute: async (sql, transaction) => {
      let result: unknown;
      for (const command of preprocessPluginExecute(platform, sql)) result = await call("execute", command, [], transaction);
      return result;
    },
    beginTransaction: () => call("begin"), commitTransaction: () => call("commit"), rollbackTransaction: () => call("rollback"),
  };
  const engine: NativeSqliteEngine = { createConnection: async () => connection, closeConnection: async () => { await call("close"); } };
  const options = { databaseName: directory, engine, detectPlatform: () => platform };
  const cap = createNativeCombinedHeldSqliteHost(options);
  const acquired = await cap.acquire(); if (!acquired.ok) throw new Error("synthetic owner unavailable");
  return { cap, lease: acquired.lease, trace, faults, options, raw };
}
