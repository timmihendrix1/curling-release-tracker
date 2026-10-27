// Real disposable SQLite evidence for S3a query/layout compatibility. Python's
// stdlib SQLite executes the statements; this is not Capacitor/device evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import { createNativeMigrationSqliteStore, type NativeSqliteConnection, type NativeSqliteEngine, type NativeSqliteQueryResult } from "../nativeSqliteAdapter";

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
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
async function realSqlite(statements: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "curling-s3a-sqlite-"));
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
  const trace: { kind: string; sql?: string }[] = [];
  const call = (kind: string, sql?: string, values?: unknown[], transaction?: boolean): Promise<unknown> => {
    trace.push({ kind, sql });
    if (exited) return Promise.reject(new Error("synthetic worker unavailable"));
    return new Promise((resolve, reject) => { pending.push({ resolve, reject }); child.stdin.write(JSON.stringify({ kind, sql, values, transaction }) + "\n"); });
  };
  await call("open");
  for (const sql of statements) await call("execute", sql);
  await call("close");
  trace.length = 0;
  const connection: NativeSqliteConnection = {
    open: async () => { await call("open"); }, close: async () => { await call("close"); },
    query: (sql, values) => call("query", sql, values) as Promise<NativeSqliteQueryResult>,
    run: (sql, values, transaction) => call("run", sql, values, transaction),
    execute: (sql, transaction) => call("execute", sql, [], transaction),
    beginTransaction: () => call("begin"), commitTransaction: () => call("commit"), rollbackTransaction: () => call("rollback"),
  };
  const engine: NativeSqliteEngine = { createConnection: async () => connection, closeConnection: async () => { await call("close"); } };
  const binding = createNativeMigrationSqliteStore({ databaseName: directory, engine, detectPlatform: () => "ios", reservedKeys: { record: "d", latch: "f" } });
  return { ...binding, trace };
}
const CREATE = "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);";

describe("S3a real SQLite", () => {
  it("preserves arbitrary-string keys across SQLite BINARY and JS UTF-16 ordering differences", async () => {
    const h = await realSqlite();
    expect(await h.store.adapter.set("\ue000", "bmp")).toEqual({ ok: true });
    expect(await h.store.adapter.set("🥌", "supplementary")).toEqual({ ok: true });
    expect(await h.store.adapter.get("\ue000")).toEqual({ status: "value", value: "bmp" });
    expect(await h.store.adapter.get("🥌")).toEqual({ status: "value", value: "supplementary" });
    await h.store.close();
    expect(await h.store.adapter.get("\ue000")).toEqual({ status: "value", value: "bmp" });
    expect(await h.store.adapter.get("🥌")).toEqual({ status: "value", value: "supplementary" });
    expect((await h.store.adapter.remove("🥌")).ok).toBe(true);
    await h.store.close();
  });
  it("accepts actual fresh bootstrap / sqlite_master nulls / index metadata and preserves exact values", async () => {
    const h = await realSqlite();
    const raw = "synthetic \u0000 Unicode ü 🥌 ' ; SELECT";
    expect(await h.store.adapter.set("a", raw)).toEqual({ ok: true });
    expect(await h.store.adapter.get("a")).toEqual({ status: "value", value: raw });
    expect((await h.store.close()).ok).toBe(true);
    expect(await h.store.adapter.get("a")).toEqual({ status: "value", value: raw });
    await h.store.close();
  });

  it("accepts the existing exact records schema without bootstrapping it again", async () => {
    const h = await realSqlite([CREATE]);
    expect(await h.store.adapter.get("missing")).toEqual({ status: "value", value: null });
    expect(h.trace.some(x => x.kind === "execute" && x.sql?.includes("CREATE"))).toBe(false);
    await h.store.close();
  });

  for (const extra of [
    "CREATE TABLE curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL CHECK(slot IN ('schema','q','f')), value TEXT NOT NULL);",
    "CREATE TABLE installation_transfer_j_v1 (value TEXT);",
    "CREATE TRIGGER unexpected AFTER INSERT ON records BEGIN SELECT 1; END;",
    "CREATE INDEX unexpected ON records(value);",
    "CREATE VIEW unexpected AS SELECT key FROM records;",
  ]) {
    it("refuses actual additional protocol/schema objects before mutable SQL", async () => {
      const h = await realSqlite([CREATE, extra]);
      const owner = await h.target.acquire(); if (!owner.ok) throw new Error("test owner");
      expect(await h.target.readReserved(owner.lease)).toEqual({ ok: false, reason: "protocol_refused" });
      expect(h.trace.some(x => x.kind === "run" || x.kind === "execute" || x.kind === "begin")).toBe(false);
      expect(h.trace.some(x => x.sql?.includes("journal_mode ="))).toBe(false);
      await h.target.release(owner.lease);
    });
  }

  it("refuses equivalent but unadopted table spelling rather than guessing its contract", async () => {
    const h = await realSqlite(["CREATE TABLE records (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL)"]);
    expect((await h.store.adapter.set("default", "x")).ok).toBe(false);
    expect(h.trace.some(x => x.kind === "run" || x.kind === "execute")).toBe(false);
    await h.store.close();
  });
});
