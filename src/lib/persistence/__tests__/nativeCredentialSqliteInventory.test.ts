// S3b executes real disposable SQLite; injected bridge faults are explicitly
// model evidence, never physical Capacitor/Keychain evidence.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, it } from "vitest";
import {
  createNativeCredentialSqliteInventory, createNativeMigrationSqliteStore, createNativeSqliteStore,
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
const MARKER = '{"schemaVersion":1,"kind":"credential-cross-store-meta"}';
const D = "curling.nativeMigration.activationRecord.v1";
const L = "curling.nativeMigration.faultLatch.v1";
const absent = { status: "absent" };
const present = (bytes: string) => ({ status: "present", bytes });
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
type Event = { kind: string; sql?: string; values?: unknown[]; transaction?: boolean };
type Hook = (event: Event, next: () => Promise<unknown>) => Promise<unknown>;
async function setup(statements: string[] = []) {
  const directory = await mkdtemp(path.join(tmpdir(), "curling-s3b-sqlite-"));
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
    execute: (sql, transaction) => call("execute", sql, [], transaction),
    beginTransaction: () => call("begin"), commitTransaction: () => call("commit"), rollbackTransaction: () => call("rollback"),
  };
  const engine: NativeSqliteEngine = { createConnection: async () => connection, closeConnection: async () => { await call("close"); } };
  const options = { databaseName: directory, engine, detectPlatform: () => "ios" as const };
  const cap = createNativeCredentialSqliteInventory(options);
  const acquired = await cap.acquire(); if (!acquired.ok) throw new Error("synthetic owner unavailable");
  return { cap, lease: acquired.lease, trace, faults, options, raw };
}
const ddl = (trace: Event[]) => trace.filter(e => e.kind === "execute" && e.sql?.startsWith("CREATE"));
const insert = (key: string, value: string) => `INSERT INTO records (key,value) VALUES ('${key}','${value}');`;

describe("private S3b SQL inventory and schema bootstrap", () => {
  for (const initial of [[], [CREATE]]) {
    it("opens without implicit bootstrap, atomically initializes a truly empty target and observes it after fresh reopen", async () => {
      const h = await setup(initial);
      expect(h.trace).toEqual([]); // Both construction and acquisition are inert.
      expect(Object.isFrozen(h.cap)).toBe(true);
      expect(Object.keys(h.cap).sort()).toEqual(["acquire", "initializeEmpty", "leaseState", "observe", "release", "reopen"]);
      expect(await h.cap.observe(h.lease)).toEqual({ ok: true, layout: initial.length ? "records" : "empty", record: absent, latch: absent, schema: absent, q: absent, f: absent });
      expect(ddl(h.trace)).toEqual([]);
      expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "confirmed" });
      expect(h.trace.filter(e => e.kind === "run").map(e => e.values)).toEqual([["schema", MARKER]]);
      const begin = h.trace.findIndex(e => e.kind === "begin");
      const commit = h.trace.findIndex(e => e.kind === "commit");
      expect(ddl(h.trace)).toHaveLength(initial.length ? 1 : 2);
      for (const event of ddl(h.trace)) {
        expect(h.trace.indexOf(event)).toBeGreaterThan(begin);
        expect(h.trace.indexOf(event)).toBeLessThan(commit);
        expect(event.transaction).toBe(false);
        expect(event.sql).not.toContain("IF NOT EXISTS");
      }
      expect(await h.cap.reopen(h.lease)).toEqual({ ok: true, generation: 1 });
      expect(await h.cap.observe(h.lease)).toEqual({ ok: true, layout: "combined", record: absent, latch: absent, schema: present(MARKER), q: absent, f: absent });
      const mark = h.trace.length;
      expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "already_initialized" });
      expect(ddl(h.trace.slice(mark))).toEqual([]);
      await h.cap.release(h.lease);
    });
  }

  for (const key of [D, L, "curling.profile.deletionGuard.synthetic.v1", "arbitrary unsynced row"]) {
    it(`never backfills or adopts a records target containing ${key}`, async () => {
      const h = await setup([CREATE, insert(key, "PRIVATE")]);
      expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "target_not_empty" });
      expect(h.trace.some(e => ["begin", "run"].includes(e.kind))).toBe(false);
      expect(ddl(h.trace)).toEqual([]);
      await h.cap.release(h.lease);
    });
  }

  it("preserves exact opaque independently observed control bytes, with no semantic grant", async () => {
    const h = await setup([CREATE, META, insert(D, "malformed D"), insert(L, "positive latch"),
      "INSERT INTO curling_credential_meta VALUES ('schema','unknown marker'),('q','malformed Q'),('f','positive F');"]);
    expect(await h.cap.observe(h.lease)).toEqual({ ok: true, layout: "combined", record: present("malformed D"), latch: present("positive latch"), schema: present("unknown marker"), q: present("malformed Q"), f: present("positive F") });
    await h.cap.release(h.lease);
  });

  for (const failed of [D, L, "schema", "q", "f"]) {
    it(`keeps other positive controls when ${failed} is unreadable`, async () => {
      const h = await setup([CREATE, META, insert(D, "D"), insert(L, "L"), "INSERT INTO curling_credential_meta VALUES ('schema','S'),('q','Q'),('f','F');"]);
      h.faults.hook = async (event, next) => {
        if (event.sql?.startsWith("SELECT value") && event.values?.[0] === failed) throw new Error("PRIVATE fault");
        return next();
      };
      const r = await h.cap.observe(h.lease);
      const expected = { ok: true, layout: "combined", record: present("D"), latch: present("L"), schema: present("S"), q: present("Q"), f: present("F") };
      Object.assign(expected, { [failed === D ? "record" : failed === L ? "latch" : failed]: { status: "read_failed" } });
      expect(r).toEqual(expected);
      expect(JSON.stringify(r)).not.toContain("PRIVATE");
      await h.cap.release(h.lease);
    });
  }

  for (const extra of [
    "CREATE TABLE unknown(value TEXT);", "CREATE TABLE installation_transfer_j_v1(value TEXT);",
    "CREATE INDEX extra ON records(value);", "CREATE VIEW extra AS SELECT key FROM records;",
    "CREATE TRIGGER extra AFTER INSERT ON records BEGIN SELECT 1; END;",
  ]) {
    it("refuses unknown schema before any control payload or mutable SQL", async () => {
      const h = await setup([CREATE, META, extra]);
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "protocol_refused" });
      expect(h.trace.some(e => e.sql?.startsWith("SELECT value") || ["execute", "run", "begin"].includes(e.kind))).toBe(false);
      expect(h.trace.some(e => e.sql?.includes("journal_mode ="))).toBe(false);
      await h.cap.release(h.lease);
    });
  }

  for (const statements of [
    [META],
    [CREATE, "CREATE TABLE curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);"],
    [CREATE, META, "PRAGMA ignore_check_constraints = ON;", "INSERT INTO curling_credential_meta VALUES ('future','secret');"],
    [CREATE, META, insert("curling.credential.future", "secret")],
  ]) {
    it("refuses unsupported layout or owned names without touching their payload", async () => {
      const h = await setup(statements);
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "protocol_refused" });
      expect(h.trace.some(e => e.sql?.startsWith("SELECT value"))).toBe(false);
      await h.cap.release(h.lease);
    });
  }

  for (const mode of ["ordinary", "diagnostic", "legacy"] as const) {
    it(`${mode} cannot inherit rights over even a schema-only meta table`, async () => {
      const h = await setup([CREATE, META]);
      await h.cap.release(h.lease);
      h.trace.length = 0;
      if (mode === "legacy") {
        const old = createNativeMigrationSqliteStore({ ...h.options, reservedKeys: { record: D, latch: L } });
        const a = await old.target.acquire(); if (!a.ok) throw new Error("test lease");
        expect(await old.target.readReserved(a.lease)).toEqual({ ok: false, reason: "protocol_refused" });
        expect(await old.target.transact(a.lease, { kind: "create_record", recordAfter: "active" })).toEqual({ status: "refused", reason: "protocol_refused" });
        await old.target.release(a.lease);
      } else {
        const old = createNativeSqliteStore(h.options);
        const r = mode === "ordinary" ? await old.adapter.set("default", "overwrite") : await old.beginDiagnosticTransaction();
        expect(r.ok).toBe(false);
        await old.close();
      }
      expect(h.trace.some(e => e.sql?.startsWith("SELECT value") || ["execute", "run", "begin", "commit"].includes(e.kind))).toBe(false);
    });
  }

  it("shares the actual registry with every factory and refuses copied/stale lease ids", async () => {
    const h = await setup();
    expect(await h.cap.observe({ id: h.lease.id })).toEqual({ ok: false, reason: "wrong_lease" });
    expect(await h.cap.release({ id: h.lease.id })).toEqual({ ok: false, reason: "wrong_lease" });
    expect(h.cap.leaseState()).toBe("owned");
    const other = createNativeCredentialSqliteInventory(h.options);
    expect(await other.acquire()).toEqual({ ok: false, reason: "lease_held" });
    const old = createNativeMigrationSqliteStore({ ...h.options, reservedKeys: { record: D, latch: L } });
    expect(await old.target.acquire()).toEqual({ ok: false, reason: "lease_held" });
    const ordinary = createNativeSqliteStore(h.options);
    expect((await ordinary.adapter.set("x", "bad")).ok).toBe(false);
    expect(h.trace).toEqual([]);
    await h.cap.release(h.lease);
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "no_lease" });
    const a = await other.acquire(); if (!a.ok) throw new Error("test owner");
    expect(await other.observe(h.lease)).toEqual({ ok: false, reason: "wrong_lease" });
    await other.release(a.lease);
  });

  for (const boundary of ["begin", "records", "meta", "marker", "q-read"] as const) {
    it(`cancels after ${boundary}, rolls back the entire schema and does not COMMIT`, async () => {
      const h = await setup(); let live = true; let stopped = false;
      h.faults.hook = async (e, next) => {
        const r = await next();
        const matches = boundary === "begin" ? e.kind === "begin" : boundary === "records" ? e.sql === CREATE :
          boundary === "meta" ? e.sql === META : boundary === "marker" ? e.kind === "run" :
          e.sql?.startsWith("SELECT value FROM curling_credential_meta") && e.values?.[0] === "q";
        if (!stopped && matches) { live = false; stopped = true; }
        return r;
      };
      expect(await h.cap.initializeEmpty(h.lease, { proceed: () => live })).toMatchObject({ status: "not_committed", reason: "cancelled", connection: "clean" });
      expect(stopped).toBe(true);
      expect(h.trace.some(e => e.kind === "commit")).toBe(false);
      h.faults.hook = undefined;
      expect(await h.cap.reopen(h.lease)).toEqual({ ok: true, generation: 1 });
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "empty", schema: absent });
      await h.cap.release(h.lease);
    });
  }

  for (const committed of [false, true]) {
    it(`keeps unacknowledged COMMIT unknown even when actual commit is ${committed}`, async () => {
      const h = await setup();
      h.faults.hook = async (e, next) => {
        if (e.kind === "commit") { if (committed) await next(); throw new Error("PRIVATE commit fault"); }
        return next();
      };
      expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "outcome_unknown" });
      expect(h.cap.leaseState()).toBe("requires_reopen");
      const mark = h.trace.length;
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "requires_reopen" });
      expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "requires_reopen" });
      expect(h.trace).toHaveLength(mark);
      expect(h.trace.some(e => e.kind === "rollback")).toBe(false);
      h.faults.hook = undefined;
      expect(await h.cap.reopen(h.lease)).toEqual({ ok: true, generation: 1 });
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: committed ? "combined" : "empty", schema: committed ? present(MARKER) : absent });
      await h.cap.release(h.lease);
    });
  }

  for (const boundary of ["begin", "rollback"] as const) {
    it(`retains uncertainty after unacknowledged ${boundary}`, async () => {
      const h = await setup();
      h.faults.hook = async (e, next) => {
        if (e.kind === boundary) { await next(); return {}; }
        if (boundary === "rollback" && e.sql === META) throw new Error("synthetic DDL fault");
        return next();
      };
      expect(await h.cap.initializeEmpty(h.lease)).toMatchObject({ status: "not_committed", connection: "uncertain" });
      expect(h.cap.leaseState()).toBe("requires_reopen");
      h.faults.hook = undefined;
      await h.cap.reopen(h.lease);
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "empty" });
      await h.cap.release(h.lease);
    });
  }

  for (const query of [
    "PRAGMA table_info('curling_credential_meta');",
    "PRAGMA index_list('curling_credential_meta');",
    "PRAGMA index_info('sqlite_autoindex_curling_credential_meta_1');",
    "SELECT slot FROM curling_credential_meta ORDER BY slot;",
  ]) {
    it("refuses missing or incomplete meta metadata before payloads", async () => {
      const h = await setup([CREATE, META]);
      h.faults.hook = async (e, next) => e.sql === query ? { values: [Object.create(null)] } : next();
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "protocol_refused" });
      expect(h.trace.some(e => e.sql?.startsWith("SELECT value") || e.sql?.includes("journal_mode ="))).toBe(false);
      await h.cap.release(h.lease);
    });
  }

  it("refuses duplicate/unknown slot names and drifted schema version before payloads", async () => {
    for (const fault of ["duplicate", "unknown", "drift"]) {
      const h = await setup([CREATE, META]); let versions = 0;
      h.faults.hook = async (e, next) => {
        if (e.sql === "SELECT slot FROM curling_credential_meta ORDER BY slot;" && fault !== "drift") {
          return { values: fault === "duplicate" ? [{ slot: "q" }, { slot: "q" }] : [{ slot: "future" }] };
        }
        const r = await next();
        if (fault === "drift" && e.sql === "PRAGMA schema_version;" && ++versions === 2) return { values: [{ schema_version: 999 }] };
        return r;
      };
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "protocol_refused" });
      expect(h.trace.some(e => e.sql?.startsWith("SELECT value"))).toBe(false);
      await h.cap.release(h.lease);
    }
  });

  it("does not invoke accessor control values or turn malformed results into absence", async () => {
    const h = await setup([CREATE, META, "INSERT INTO curling_credential_meta VALUES ('f','fault');"]);
    let gets = 0;
    h.faults.hook = async (e, next) => e.sql?.startsWith("SELECT value") && e.values?.[0] === "q"
      ? { values: [Object.defineProperty({}, "value", { enumerable: true, get: () => { gets++; throw new Error("PRIVATE"); } })] }
      : next();
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, q: { status: "read_failed" }, f: present("fault") });
    expect(gets).toBe(0);
    await h.cap.release(h.lease);
  });

  for (const initial of [[], [CREATE]]) {
    for (const boundary of ["meta", "marker"] as const) {
      it("rolls back applied but unacknowledged DDL/marker without losing the exact prior layout", async () => {
        const h = await setup(initial);
        h.faults.hook = async (e, next) => {
          const r = await next();
          return (boundary === "meta" ? e.sql === META : e.kind === "run") ? {} : r;
        };
        expect(await h.cap.initializeEmpty(h.lease)).toMatchObject({ status: "not_committed", reason: "statement_failed", writeIssued: true, connection: "clean" });
        expect(h.trace.some(e => e.kind === "commit")).toBe(false);
        h.faults.hook = undefined;
        await h.cap.reopen(h.lease);
        expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: initial.length ? "records" : "empty", schema: absent });
        await h.cap.release(h.lease);
      });
    }
  }

  it("rechecks zero-key target evidence inside BEGIN rather than using a pre-BEGIN snapshot", async () => {
    const h = await setup([CREATE]);
    h.faults.hook = async (e, next) => {
      if (e.kind === "begin") await h.raw({ kind: "execute", sql: insert(D, "arrived before BEGIN") });
      return next();
    };
    expect(await h.cap.initializeEmpty(h.lease)).toMatchObject({ status: "not_committed", reason: "precondition_failed", writeIssued: false });
    expect(ddl(h.trace)).toEqual([]);
    h.faults.hook = undefined;
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "records", record: present("arrived before BEGIN"), schema: absent });
    await h.cap.release(h.lease);
  });

  it("rediscovering after control reads prevents COMMIT after a new schema object", async () => {
    const h = await setup(); let injected = false;
    h.faults.hook = async (e, next) => {
      const r = await next();
      if (!injected && e.sql?.startsWith("SELECT value FROM curling_credential_meta") && e.values?.[0] === "f") {
        injected = true;
        await h.raw({ kind: "execute", sql: "CREATE TABLE unexpected (value TEXT);" });
      }
      return r;
    };
    expect(await h.cap.initializeEmpty(h.lease)).toMatchObject({ status: "not_committed", reason: "protocol_refused", writeIssued: true, connection: "clean" });
    expect(injected).toBe(true);
    expect(h.trace.some(e => e.kind === "commit")).toBe(false);
    h.faults.hook = undefined;
    await h.cap.reopen(h.lease);
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "empty" });
    await h.cap.release(h.lease);
  });

  for (const boundary of ["close", "release"] as const) {
    it(`retains ownership when reopen ${boundary} is not positively completed`, async () => {
      const h = await setup();
      await h.cap.initializeEmpty(h.lease);
      let closes = 0;
      h.faults.hook = async (e, next) => {
        if (e.kind === "close" && ++closes === (boundary === "close" ? 1 : 2)) throw new Error("PRIVATE close failure");
        return next();
      };
      expect(await h.cap.reopen(h.lease)).toMatchObject({ ok: false, boundary });
      expect(h.cap.leaseState()).toBe("requires_reopen");
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "requires_reopen" });
      const other = createNativeCredentialSqliteInventory(h.options);
      expect(await other.acquire()).toEqual({ ok: false, reason: "lease_held" });
      h.faults.hook = undefined;
      expect(await h.cap.reopen(h.lease)).toEqual({ ok: true, generation: 1 });
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "combined", schema: present(MARKER) });
      await h.cap.release(h.lease);
    });
  }

  it("cannot acquire beside an already opening/live ordinary handle", async () => {
    const h = await setup([CREATE]); await h.cap.release(h.lease);
    const ordinary = createNativeSqliteStore(h.options);
    expect((await ordinary.adapter.get("missing")).status).toBe("value");
    expect(await h.cap.acquire()).toEqual({ ok: false, reason: "connection_held_elsewhere" });
    await ordinary.close();
    const r = await h.cap.acquire(); if (!r.ok) throw new Error("synthetic lease");
    await h.cap.release(r.lease);
  });

  for (const slot of ["q", "f"]) {
    it(`refuses positively discovered ${slot} after its last negative read instead of committing`, async () => {
      const h = await setup(); let injected = false;
      h.faults.hook = async (e, next) => {
        const r = await next();
        if (!injected && e.sql?.startsWith("SELECT value FROM curling_credential_meta") && e.values?.[0] === "f") {
          injected = true;
          await h.raw({ kind: "run", sql: "INSERT INTO curling_credential_meta (slot,value) VALUES (?,?);", values: [slot, "unexpected control"] });
        }
        return r;
      };
      expect(await h.cap.initializeEmpty(h.lease)).toMatchObject({ status: "not_committed", reason: "protocol_refused", connection: "clean" });
      expect(injected).toBe(true);
      expect(h.trace.some(e => e.kind === "commit")).toBe(false);
      h.faults.hook = undefined;
      await h.cap.reopen(h.lease);
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "empty", q: absent, f: absent });
      await h.cap.release(h.lease);
    });
  }

  it("rechecks the final complete marker tuple after structural names, without repair", async () => {
    const h = await setup(); let injected = false;
    h.faults.hook = async (e, next) => {
      const r = await next();
      if (!injected && e.sql?.startsWith("SELECT value FROM curling_credential_meta") && e.values?.[0] === "f") {
        injected = true;
        await h.raw({ kind: "run", sql: "UPDATE curling_credential_meta SET value = ? WHERE slot = ?;", values: ["changed marker", "schema"] });
      }
      return r;
    };
    expect(await h.cap.initializeEmpty(h.lease)).toMatchObject({ status: "not_committed", reason: "evidence_mismatch", connection: "clean" });
    expect(h.trace.some(e => e.kind === "commit")).toBe(false);
    h.faults.hook = undefined;
    await h.cap.reopen(h.lease);
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "empty" });
    await h.cap.release(h.lease);
  });

  it("contains opaque self-throwing bridge errors before BEGIN without inventing a COMMIT", async () => {
    let inspected = 0;
    const reason: object = new Proxy({}, { getPrototypeOf() { inspected++; throw reason; } });
    let creates = 0; let releases = 0;
    const cap = createNativeCredentialSqliteInventory({ databaseName: `synthetic-opaque-${Math.random()}`,
      detectPlatform: () => "ios", engine: {
        createConnection: async () => { creates++; throw reason; },
        closeConnection: async () => { releases++; },
      } });
    const a = await cap.acquire(); if (!a.ok) throw new Error("synthetic lease");
    expect(await cap.initializeEmpty(a.lease)).toEqual({ status: "not_begun", reason: "engine_unavailable" });
    expect(creates).toBe(1); expect(releases).toBe(1); expect(inspected).toBe(0);
    expect(cap.leaseState()).toBe("owned");
    await cap.release(a.lease);
  });

  it("rolls back an opaque self-throwing error after BEGIN with truthful write accounting", async () => {
    const h = await setup(); let inspected = 0;
    const reason: object = new Proxy({}, { getPrototypeOf() { inspected++; throw reason; } });
    h.faults.hook = async (e, next) => { if (e.sql === META) throw reason; return next(); };
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "not_committed", reason: "statement_failed", writeIssued: true, connection: "clean" });
    expect(inspected).toBe(0);
    expect(h.trace.some(e => e.kind === "rollback")).toBe(true);
    expect(h.trace.some(e => e.kind === "commit")).toBe(false);
    h.faults.hook = undefined;
    await h.cap.reopen(h.lease);
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "empty" });
    await h.cap.release(h.lease);
  });

  for (const initialOperation of ["observe", "initializeEmpty"] as const) {
    it(`requires positive reopen after ${initialOperation} open cleanup could not release its native handle`, async () => {
      const h = await setup(); let closes = 0;
      h.faults.hook = async (e, next) => {
        if (e.sql === "PRAGMA schema_version;") throw new Error("synthetic discovery failure");
        if (e.kind === "close" && ++closes === 2) throw new Error("synthetic release failure");
        return next();
      };
      const r = await h.cap[initialOperation](h.lease);
      expect(r).toMatchObject(initialOperation === "observe" ? { ok: false, reason: "protocol_refused" } : { status: "refused", reason: "protocol_refused" });
      expect(h.cap.leaseState()).toBe("requires_reopen");
      h.faults.hook = undefined;
      const mark = h.trace.length;
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "requires_reopen" });
      expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "requires_reopen" });
      expect(h.trace).toHaveLength(mark);
      expect(await h.cap.reopen(h.lease)).toEqual({ ok: true, generation: 1 });
      expect(h.trace[mark].kind).toBe("close"); // Positive engine release before any new open.
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "empty" });
      await h.cap.release(h.lease);
    });
  }

  for (const boundary of ["close", "release"] as const) {
    it(`keeps a failed direct ${boundary} fenced until positive reopen`, async () => {
      const h = await setup(); await h.cap.initializeEmpty(h.lease);
      let closes = 0;
      h.faults.hook = async (e, next) => {
        if (e.kind === "close" && ++closes === (boundary === "close" ? 1 : 2)) throw new Error("synthetic release fault");
        return next();
      };
      expect(await h.cap.release(h.lease)).toEqual({ ok: false, boundary });
      expect(h.cap.leaseState()).toBe("requires_reopen");
      h.faults.hook = undefined;
      const mark = h.trace.length;
      expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "requires_reopen" });
      expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "requires_reopen" });
      expect(h.trace).toHaveLength(mark);
      const other = createNativeCredentialSqliteInventory(h.options);
      expect(await other.acquire()).toEqual({ ok: false, reason: "lease_held" });
      expect(await h.cap.reopen(h.lease)).toEqual({ ok: true, generation: 1 });
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "combined", schema: present(MARKER) });
      await h.cap.release(h.lease);
    });
  }

  for (const boundary of ["close", "release"] as const) {
    it(`marks a pending direct ${boundary} uncertain before its first await and permits a confirmed release retry`, async () => {
      const h = await setup(); await h.cap.initializeEmpty(h.lease);
      let reached!: () => void; const at = new Promise<void>(r => { reached = r; });
      let finish!: () => void; const held = new Promise<void>(r => { finish = r; });
      let closes = 0;
      h.faults.hook = async (e, next) => {
        if (e.kind === "close" && ++closes === (boundary === "close" ? 1 : 2)) {
          reached(); await held; throw new Error("synthetic pending release fault");
        }
        return next();
      };
      const freeing = h.cap.release(h.lease);
      await at;
      expect(h.cap.leaseState()).toBe("requires_reopen");
      const other = createNativeCredentialSqliteInventory(h.options);
      expect(await other.acquire()).toEqual({ ok: false, reason: "lease_held" });
      finish();
      expect(await freeing).toEqual({ ok: false, boundary });
      h.faults.hook = undefined;
      expect(await h.cap.release(h.lease)).toEqual({ ok: true });
      expect(h.cap.leaseState()).toBe("unowned");
      const a = await other.acquire(); if (!a.ok) throw new Error("synthetic owner");
      await other.release(a.lease);
    });
  }

  it("keeps positive COMMIT acknowledgment when cancellation arrives after actual COMMIT", async () => {
    const h = await setup(); let live = true;
    h.faults.hook = async (e, next) => { const r = await next(); if (e.kind === "commit") live = false; return r; };
    expect(await h.cap.initializeEmpty(h.lease, { proceed: () => live })).toEqual({ status: "confirmed" });
    expect(h.trace.some(e => e.kind === "rollback")).toBe(false);
    h.faults.hook = undefined;
    await h.cap.release(h.lease);
  });

  for (const pendingBoundary of ["begin", "commit"]) {
  it(`holds pending ${pendingBoundary} and queues release until real settlement`, async () => {
    const h = await setup();
    let reached!: () => void; const atBegin = new Promise<void>(resolve => { reached = resolve; });
    let finish!: () => void; const held = new Promise<void>(resolve => { finish = resolve; });
    h.faults.hook = async (e, next) => { if (e.kind === pendingBoundary) { reached(); await held; } return next(); };
    let completed = false;
    const init = h.cap.initializeEmpty(h.lease).then(r => { completed = true; return r; });
    await atBegin;
    expect(h.cap.leaseState()).toBe("requires_reopen");
    const other = createNativeCredentialSqliteInventory(h.options);
    expect(await other.acquire()).toEqual({ ok: false, reason: "lease_held" });
    let released = false;
    const release = h.cap.release(h.lease).then(r => { released = true; return r; });
    await Promise.resolve();
    expect(completed).toBe(false); expect(released).toBe(false);
    expect(h.trace.some(e => e.kind === "close")).toBe(false);
    finish();
    expect(await init).toEqual({ status: "confirmed" });
    expect(await release).toEqual({ ok: true });
  });
  }
});
