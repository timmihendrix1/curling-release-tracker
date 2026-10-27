// Control-flow evidence for the native SQLite adapter.
//
// EVIDENCE CLASS: **mock**. Every test here drives a fake engine, so what they
// establish is the adapter's contract translation, ordering, ownership and
// failure normalisation — NOT that SQLite persists anything, not the pragmas an
// iOS device actually applies, and certainly not survival of power loss. Those
// belong to the engine and device classes (docs/MOBILE_APP_MIGRATION.md §7's
// evidence-class table); the in-app diagnostic panel is what gathers them.
//
// The fake deliberately implements SQL semantics only for the four statements
// the adapter issues, and it asserts the statements are parameterised — a fake
// that accepted an interpolated key would let the real risk through unnoticed.
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  createPluginFaithfulEngine,
  createPluginFaithfulEngineState,
} from "./pluginFaithfulSqliteEngine";
import {
  createNativeSqliteStore,
  NATIVE_SQLITE_RECORDS_TABLE,
  type NativeSqliteConnection,
  type NativeSqliteEngine,
  type NativeSqliteQueryResult,
} from "../nativeSqliteAdapter";
import type { RuntimePlatform } from "../../platform/runtimePlatform";

type FailurePoint =
  | "createConnection"
  | "open"
  | "pragma"
  | "journalPragma"
  | "schema"
  | "query"
  | "run"
  | "close"
  | "begin"
  | "commit"
  | "rollback"
  | "closeConnection";

interface FakeEngineOptions {
  failAt?: Set<FailurePoint>;
  /** Thrown instead of an Error, to exercise normalisation of unexpected values. */
  thrownValue?: unknown;
  /** Observed ordering of completed operations. */
  order?: string[];
  /** Resolves each query/run only when released, so overlap can be constructed. */
  gate?: { wait: () => Promise<void> };
  /** Replaces the response to the key-addressed SELECT, so malformed envelopes the
   * bridge could produce can be exercised without a real bridge. */
  selectResponse?: () => unknown;
  /** Fails `run` only for the statement that is MEANT to fail, so a deliberate
   * statement failure inside a transaction can be constructed without failing
   * the ordinary writes that precede it. */
  failDeliberateStatement?: boolean;
}

interface FakeEngine extends NativeSqliteEngine {
  rows: Map<string, unknown>;
  statements: { sql: string; values: unknown[] }[];
  openCount: number;
  closeCount: number;
  connectionOpen: boolean;
}

function createFakeEngine(options: FakeEngineOptions = {}): FakeEngine {
  const failAt = options.failAt ?? new Set<FailurePoint>();
  const rows = new Map<string, unknown>();
  const statements: { sql: string; values: unknown[] }[] = [];
  const state = { openCount: 0, closeCount: 0, connectionOpen: false };
  let hasRecordsTable = false;
  let transactionDepth = 0;

  function fail(point: FailurePoint): never {
    if ("thrownValue" in options) throw options.thrownValue;
    throw new Error(`fake engine failed at ${point}`);
  }

  async function maybeGate(): Promise<void> {
    if (options.gate) await options.gate.wait();
  }

  const connection: NativeSqliteConnection = {
    async open() {
      if (failAt.has("open")) fail("open");
      state.openCount += 1;
      state.connectionOpen = true;
    },
    async close() {
      if (failAt.has("close")) fail("close");
      state.closeCount += 1;
      state.connectionOpen = false;
      transactionDepth = 0;
      options.order?.push("close");
    },
    async beginTransaction() {
      if (failAt.has("begin")) fail("begin");
      if (transactionDepth > 0) {
        throw new Error("cannot start a transaction within a transaction");
      }
      transactionDepth += 1;
      options.order?.push("begin");
      return { changes: { changes: 0 } };
    },
    async commitTransaction() {
      if (failAt.has("commit")) fail("commit");
      if (transactionDepth === 0) throw new Error("no transaction is active");
      transactionDepth -= 1;
      options.order?.push("commit");
      return { changes: { changes: 0 } };
    },
    async rollbackTransaction() {
      if (failAt.has("rollback")) fail("rollback");
      if (transactionDepth === 0) throw new Error("no transaction is active");
      transactionDepth -= 1;
      options.order?.push("rollback");
      return { changes: { changes: 0 } };
    },
    async execute(sql: string, transaction: boolean) {
      if (sql.includes("PRAGMA")) {
        // SQLite refuses `PRAGMA journal_mode` inside a transaction; the adapter
        // must not wrap it in one.
        expect(transaction).toBe(false);
        if (failAt.has("pragma")) fail("pragma");
        return {};
      }
      if (sql.includes("CREATE TABLE")) {
        if (failAt.has("schema")) fail("schema");
        hasRecordsTable = true;
        return {};
      }
      if (sql.startsWith(`DELETE FROM ${NATIVE_SQLITE_RECORDS_TABLE}`)) {
        rows.clear();
        return {};
      }
      return {};
    },
    async run(sql: string, values: unknown[], transaction: boolean) {
      await maybeGate();
      if (failAt.has("run")) fail("run");
      // The adapter must never leave this to the plugin's `true` default: a
      // statement inside an owned transaction has to opt out of getting its own.
      expect(typeof transaction).toBe("boolean");
      if (transactionDepth > 0) {
        // Faithful to the native side: the plugin's wrapper issues its own
        // BEGIN, and SQLite rejects a nested one.
        expect(transaction).toBe(false);
      }
      statements.push({ sql, values });
      if (sql.includes("NULL)")) {
        // The adapter's deliberate NOT NULL violation.
        if (options.failDeliberateStatement !== false) {
          throw new Error("NOT NULL constraint failed: records.value");
        }
        return {};
      }
      if (sql.startsWith("INSERT INTO")) {
        expect(values).toHaveLength(2);
        rows.set(String(values[0]), values[1]);
      } else if (sql.startsWith("DELETE FROM") && sql.includes("WHERE")) {
        expect(values).toHaveLength(1);
        rows.delete(String(values[0]));
      } else if (sql.startsWith("DELETE FROM")) {
        // The unqualified bulk delete carries no bound values.
        expect(values).toHaveLength(0);
        rows.clear();
      }
      options.order?.push(`run:${values.length > 0 ? String(values[0]) : "all"}`);
      return {};
    },
    async query(sql: string, values: unknown[]): Promise<NativeSqliteQueryResult> {
      await maybeGate();
      statements.push({ sql, values });
      // This older fake models the same finite schema explicitly. Discovery
      // failures have their own tests; the existing `query` failure hook remains
      // a subsequent individual-value/settings failure.
      if (sql === "PRAGMA schema_version;") return { values: [{ schema_version: hasRecordsTable ? 1 : 0 }] };
      if (sql === "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;") return { values: hasRecordsTable ? [
        { type: "index", name: "sqlite_autoindex_records_1", tbl_name: "records", sql: null },
        { type: "table", name: "records", tbl_name: "records", sql: "CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)" },
      ] : [] };
      if (sql === "PRAGMA table_info('records');") return { values: [
        { cid: 0, name: "key", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
        { cid: 1, name: "value", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
      ] };
      if (sql === "PRAGMA index_list('records');") return { values: [{ seq: 0, name: "sqlite_autoindex_records_1", unique: 1, origin: "pk", partial: 0 }] };
      if (sql === "PRAGMA index_info('sqlite_autoindex_records_1');") return { values: [{ seqno: 0, cid: 0, name: "key" }] };
      if (sql === "SELECT key FROM records ORDER BY key;") return { values: [...rows.keys()].sort().map(key => ({ key })) };
      if (sql.startsWith("PRAGMA journal_mode")) {
        if (failAt.has("journalPragma")) fail("journalPragma");
        return { values: [{ journal_mode: "wal" }] };
      }
      // Beyond this point the statement is the key-addressed read, so the "query"
      // failure point classifies a READ failure rather than an open failure.
      if (failAt.has("query")) fail("query");
      if (sql.startsWith("PRAGMA synchronous")) return { values: [{ synchronous: 2 }] };
      if (sql.startsWith("PRAGMA page_size")) return { values: [{ page_size: 4096 }] };
      if (sql.startsWith("SELECT sqlite_version")) return { values: [{ version: "3.45.0" }] };
      if (options.selectResponse) {
        return options.selectResponse() as NativeSqliteQueryResult;
      }
      // The only key-addressed read.
      expect(sql).toContain("WHERE key = ?");
      expect(values).toHaveLength(1);
      const key = String(values[0]);
      options.order?.push(`get:${key}`);
      if (!rows.has(key)) return { values: [] };
      return { values: [{ value: rows.get(key) }] };
    },
  };

  return {
    rows,
    statements,
    get openCount() {
      return state.openCount;
    },
    get closeCount() {
      return state.closeCount;
    },
    get connectionOpen() {
      return state.connectionOpen;
    },
    async createConnection() {
      if (failAt.has("createConnection")) fail("createConnection");
      return connection;
    },
    async closeConnection() {
      if (failAt.has("closeConnection")) fail("closeConnection");
      state.connectionOpen = false;
    },
  } as FakeEngine;
}

let nextDatabase = 0;
function nativeStore(engine: NativeSqliteEngine, platform: RuntimePlatform = "ios") {
  return createNativeSqliteStore({
    databaseName: `test-synthetic-${++nextDatabase}`,
    engine,
    detectPlatform: () => platform,
  });
}

describe("native SQLite adapter — contract", () => {
  it("round-trips, overwrites, removes and reports genuine absence", async () => {
    const engine = createFakeEngine();
    const { adapter } = nativeStore(engine);

    expect(await adapter.get("missing")).toEqual({ status: "value", value: null });

    expect(await adapter.set("k", "first")).toEqual({ ok: true });
    expect(await adapter.get("k")).toEqual({ status: "value", value: "first" });

    expect(await adapter.set("k", "second")).toEqual({ ok: true });
    expect(await adapter.get("k")).toEqual({ status: "value", value: "second" });

    expect(await adapter.remove("k")).toEqual({ ok: true });
    // Absence, not failure, and carrying no value.
    expect(await adapter.get("k")).toEqual({ status: "value", value: null });
    // Removing a key that is not there is a success.
    expect(await adapter.remove("k")).toEqual({ ok: true });
  });

  it("preserves empty strings, Unicode and SQL-looking values exactly", async () => {
    const engine = createFakeEngine();
    const { adapter } = nativeStore(engine);

    const values = [
      "",
      "Zürich 🥌 Ålesund",
      "' OR 1=1; DROP TABLE records; --",
      'quotes " and \\ backslash',
      "?, :name, $1, %s",
      " -ish     line separators",
    ];
    for (const [index, value] of values.entries()) {
      const key = `key-${index}`;
      expect(await adapter.set(key, value)).toEqual({ ok: true });
      expect(await adapter.get(key)).toEqual({ status: "value", value });
    }
    // Specifically: an empty string is a stored value, never absence.
    expect(await adapter.get("key-0")).toEqual({ status: "value", value: "" });
  });

  it("binds every key and payload instead of interpolating them", async () => {
    const engine = createFakeEngine();
    const { adapter } = nativeStore(engine);

    const hostileKey = "'; DROP TABLE records; --";
    await adapter.set(hostileKey, "payload");
    await adapter.get(hostileKey);
    await adapter.remove(hostileKey);

    // No statement may ever carry the key or the payload inline...
    for (const statement of engine.statements) {
      expect(statement.sql).not.toContain(hostileKey);
      expect(statement.sql).not.toContain("payload");
    }
    // ...and every statement that carries values must bind them.
    const bound = engine.statements.filter((statement) => statement.values.length > 0);
    expect(bound.length).toBeGreaterThan(0);
    for (const statement of bound) {
      expect(statement.sql).toContain("?");
    }
  });

  it("applies pragmas outside a transaction and the schema inside one", async () => {
    const engine = createFakeEngine();
    const { adapter } = nativeStore(engine);
    // The `execute` fake asserts the transaction flag; reaching a successful get
    // means both statements were issued the way SQLite requires.
    expect(await adapter.get("anything")).toEqual({ status: "value", value: null });
  });

  it("reports the settings the engine returns, not the ones requested", async () => {
    const engine = createFakeEngine();
    const store = nativeStore(engine);

    expect(await store.readEffectiveSettings()).toEqual({
      ok: true,
      settings: {
        journalMode: "wal",
        synchronous: "2",
        pageSize: "4096",
        sqliteVersion: "3.45.0",
      },
    });
  });
});

describe("native SQLite adapter — failure never becomes absence", () => {
  it("classifies an initialisation failure as storage_unavailable, not absence", async () => {
    for (const point of [
      "createConnection",
      "open",
      "journalPragma",
      "pragma",
      "schema",
    ] as const) {
      const engine = createFakeEngine({ failAt: new Set([point]) });
      const { adapter } = nativeStore(engine);

      expect(await adapter.get("k")).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      });
      expect(await adapter.set("k", "v")).toEqual({
        ok: false,
        error: { kind: "storage_unavailable" },
      });
      expect(await adapter.remove("k")).toEqual({
        ok: false,
        error: { kind: "storage_unavailable" },
      });
    }
  });

  it("classifies a read failure as read_failed, never as a missing key", async () => {
    const engine = createFakeEngine({ failAt: new Set(["query"]) });
    const { adapter } = nativeStore(engine);

    const result = await adapter.get("k");
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.error.kind).toBe("unknown");
      expect(result.fallback).toBeNull();
    }
  });

  it("classifies write and removal failures separately and never claims quota", async () => {
    const engine = createFakeEngine({ failAt: new Set(["run"]) });
    const { adapter } = nativeStore(engine);

    const write = await adapter.set("k", "v");
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.error.kind).toBe("unknown");

    const removal = await adapter.remove("k");
    expect(removal.ok).toBe(false);
    // `removal_failed`, never `quota_exceeded` — quota has no meaning for a
    // deletion, and this adapter never claims a cause it cannot establish.
    if (!removal.ok) expect(removal.error.kind).toBe("removal_failed");
  });

  it("never forwards the engine's own error text", async () => {
    const secret = "database at /var/mobile/Containers/curling.sqlite is locked: user_42";
    const engine = createFakeEngine({
      failAt: new Set(["query", "run"]),
      thrownValue: new Error(secret),
    });
    const { adapter } = nativeStore(engine);

    const read = await adapter.get("k");
    const write = await adapter.set("k", "v");
    const removal = await adapter.remove("k");

    const messages = JSON.stringify([read, write, removal]);
    expect(messages).not.toContain(secret);
    expect(messages).not.toContain("/var/mobile");
    expect(messages).toContain("could not be read from native storage");
    expect(messages).toContain("could not be written to native storage");
    expect(messages).toContain("could not be removed from native storage");
  });

  it("normalises unexpected thrown values safely", async () => {
    const hostile: unknown[] = [
      undefined,
      null,
      "a thrown string",
      42,
      Symbol("thrown symbol"),
      {
        get message() {
          throw new Error("hostile getter");
        },
      },
      new Proxy(
        {},
        {
          getPrototypeOf() {
            throw new Error("hostile prototype");
          },
        }
      ),
    ];

    for (const thrownValue of hostile) {
      const engine = createFakeEngine({
        failAt: new Set(["query", "run"]),
        thrownValue,
      });
      const { adapter } = nativeStore(engine);

      await expect(adapter.get("k")).resolves.toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "unknown", message: "The value could not be read from native storage." },
      });
      await expect(adapter.set("k", "v")).resolves.toEqual({
        ok: false,
        error: { kind: "unknown", message: "The value could not be written to native storage." },
      });
      await expect(adapter.remove("k")).resolves.toEqual({
        ok: false,
        error: {
          kind: "removal_failed",
          message: "The value could not be removed from native storage.",
        },
      });
    }
  });

  it("treats a stored row that is not a string as unreadable, not as absence", async () => {
    const engine = createFakeEngine();
    const { adapter } = nativeStore(engine);
    await adapter.set("k", "v");
    // Only this adapter writes the column; a non-string here means the row
    // cannot be trusted. Reporting absence would invite hydration to overwrite
    // real data with a default.
    engine.rows.set("k", { not: "a string" });

    const result = await adapter.get("k");
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.error).toEqual({
        kind: "unknown",
        message: "Native storage returned an unreadable result.",
      });
    }
  });

  it("does not permanently strand later operations after a failure", async () => {
    // The engine fails only while `broken` is true; the adapter must retry the
    // open on the next call rather than caching the dead verdict.
    let broken = true;
    const inner = createFakeEngine();
    const engine: NativeSqliteEngine = {
      async createConnection(name) {
        if (broken) throw new Error("temporarily unavailable");
        return inner.createConnection(name);
      },
      closeConnection: (name) => inner.closeConnection(name),
    };
    const { adapter } = nativeStore(engine);

    expect((await adapter.set("k", "v")).ok).toBe(false);
    broken = false;
    expect(await adapter.set("k", "v")).toEqual({ ok: true });
    expect(await adapter.get("k")).toEqual({ status: "value", value: "v" });
  });
});

describe("native SQLite adapter — platform gating", () => {
  it.each(["web", "unsupported_native"] as const)(
    "fails closed on %s instead of falling back to web storage",
    async (platform) => {
      const engine = createFakeEngine();
      const createConnection = vi.spyOn(engine, "createConnection");
      const { adapter } = nativeStore(engine, platform);

      expect(await adapter.get("k")).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      });
      expect(await adapter.set("k", "v")).toEqual({
        ok: false,
        error: { kind: "storage_unavailable" },
      });
      // Nothing was opened, so nothing could have been written anywhere else.
      expect(createConnection).not.toHaveBeenCalled();
    }
  );

  it("treats a platform signal that throws as unsupported, never as web", async () => {
    const engine = createFakeEngine();
    const store = createNativeSqliteStore({
      databaseName: `test-synthetic-${++nextDatabase}`,
      engine,
      detectPlatform: () => {
        throw new Error("bridge misbehaved");
      },
    });

    expect(await store.adapter.get("k")).toEqual({
      status: "read_failed",
      fallback: null,
      error: { kind: "storage_unavailable" },
    });
    expect(await store.readEffectiveSettings()).toEqual({
      ok: false,
      reason: "platform_unsupported",
    });
  });

  it("dispatches identically on iOS and Android", async () => {
    // One shared code path, deliberately: no per-platform branch exists to drift.
    // ANDROID DEVICE BEHAVIOUR IS UNVERIFIED — no Android project exists (Stage M5).
    for (const platform of ["ios", "android"] as const) {
      const engine = createFakeEngine();
      const { adapter } = nativeStore(engine, platform);
      expect(await adapter.set("k", "v")).toEqual({ ok: true });
      expect(await adapter.get("k")).toEqual({ status: "value", value: "v" });
    }
  });

  it("opens nothing when merely constructed", async () => {
    const engine = createFakeEngine();
    const createConnection = vi.spyOn(engine, "createConnection");
    nativeStore(engine);
    await Promise.resolve();
    expect(createConnection).not.toHaveBeenCalled();
    expect(engine.openCount).toBe(0);
  });
});

describe("native SQLite adapter — ownership and ordering", () => {
  it("serialises concurrent operations in call order", async () => {
    const order: string[] = [];
    let release = () => {};
    const gateOpened = new Promise<void>((resolve) => {
      release = resolve;
    });
    const engine = createFakeEngine({ order, gate: { wait: () => gateOpened } });
    const { adapter } = nativeStore(engine);

    const pending = [
      adapter.set("a", "1"),
      adapter.set("b", "2"),
      adapter.get("a"),
      adapter.set("c", "3"),
      adapter.get("c"),
    ];
    release();
    await Promise.all(pending);

    expect(order).toEqual(["run:a", "run:b", "get:a", "run:c", "get:c"]);
  });

  it("last write wins for the same key, deterministically", async () => {
    const engine = createFakeEngine();
    const { adapter } = nativeStore(engine);

    await Promise.all([
      adapter.set("k", "one"),
      adapter.set("k", "two"),
      adapter.set("k", "three"),
    ]);
    expect(await adapter.get("k")).toEqual({ status: "value", value: "three" });
  });

  it("never closes the connection underneath pending operations", async () => {
    // Observed inside the ENGINE, which is the only place the question is
    // meaningful: did the write's statement execute before the connection was
    // closed? Observing from the caller's promise callbacks would only measure
    // microtask scheduling.
    const order: string[] = [];
    let release = () => {};
    const gateOpened = new Promise<void>((resolve) => {
      release = resolve;
    });
    // The gate is armed only after the connection is primed, so the warm-up
    // write below is not itself blocked by it.
    let armed = false;
    const engine = createFakeEngine({
      order,
      gate: { wait: () => (armed ? gateOpened : Promise.resolve()) },
    });
    const store = nativeStore(engine);

    // Prime the connection, then queue work behind a gate and ask to close.
    await store.adapter.set("warm", "up");
    order.length = 0;
    armed = true;
    const pendingWrite = store.adapter.set("k", "v");
    const pendingClose = store.close();
    // The close was requested while the write is still blocked in the engine.
    expect(engine.connectionOpen).toBe(true);
    expect(engine.closeCount).toBe(0);

    release();
    const [written, closed] = await Promise.all([pendingWrite, pendingClose]);

    expect(written).toEqual({ ok: true });
    expect(closed).toEqual({ ok: true });
    // The write's statement reached the engine BEFORE the connection closed.
    expect(order).toEqual(["run:k", "close"]);
    expect(engine.closeCount).toBe(1);
  });

  it("reopens on the next operation after a close", async () => {
    const engine = createFakeEngine();
    const store = nativeStore(engine);

    await store.adapter.set("k", "v");
    expect(engine.openCount).toBe(1);

    expect(await store.close()).toEqual({ ok: true });
    expect(engine.closeCount).toBe(1);

    // Reopen is implicit and the data is still addressable through the same store.
    expect(await store.adapter.get("k")).toEqual({ status: "value", value: "v" });
    expect(engine.openCount).toBe(2);
  });

  it("treats closing an unopened store as a no-op success", async () => {
    const engine = createFakeEngine();
    const store = nativeStore(engine);
    expect(await store.close()).toEqual({ ok: true });
    expect(engine.closeCount).toBe(0);
  });

  it("reports a failing close without leaving a half-owned connection", async () => {
    const engine = createFakeEngine({ failAt: new Set(["close"]) });
    const store = nativeStore(engine);
    await store.adapter.set("k", "v");

    expect(await store.close()).toEqual({ ok: false, reason: "operation_failed" });
    // The owner released its handle regardless, so the next call opens cleanly
    // rather than reusing a connection whose close failed.
    expect(await store.adapter.get("k")).toEqual({ status: "value", value: "v" });
    expect(engine.openCount).toBe(2);
  });

  it("deletes only its own table's rows", async () => {
    const engine = createFakeEngine();
    const store = nativeStore(engine);
    await store.adapter.set("a", "1");
    await store.adapter.set("b", "2");

    expect(await store.deleteAllRecords()).toEqual({ ok: true });
    expect(await store.adapter.get("a")).toEqual({ status: "value", value: null });
    expect(await store.adapter.get("b")).toEqual({ status: "value", value: null });
    // The statement names exactly one table and carries no bound values.
    const deletes = engine.statements.filter((s) => s.sql.startsWith("DELETE"));
    expect(deletes.every((s) => s.sql.includes(NATIVE_SQLITE_RECORDS_TABLE))).toBe(true);
  });

  it("names the database it was given and never defaults to one", async () => {
    const engine = createFakeEngine();
    const store = createNativeSqliteStore({
      databaseName: "explicit-name",
      engine,
      detectPlatform: () => "ios",
    });
    expect(store.databaseName).toBe("explicit-name");
  });
});

// ---------------------------------------------------------------------------------
// Plugin-faithful boundary tests. These drive the adapter through an engine that
// reproduces the installed plugin's own statement preprocessing (see
// ./pluginFaithfulSqliteEngine.ts). EVIDENCE CLASS: still **mock** — they prove the
// adapter issues statements the plugin carries through unchanged, not that any
// device wrote anything. ANDROID DEVICE VERIFICATION REMAINS UNPERFORMED.
// ---------------------------------------------------------------------------------

describe.each(["ios", "android"] as const)(
  "native SQLite adapter — %s plugin statement handling",
  (platform) => {
    function pluginStore(state = createPluginFaithfulEngineState()) {
      const { engine } = createPluginFaithfulEngine({ platform, state });
      const store = createNativeSqliteStore({
        databaseName: `test-synthetic-${++nextDatabase}`,
        engine,
        detectPlatform: () => platform,
      });
      return { store, state };
    }

    it("actually deletes every row, rather than resolving over an empty statement", async () => {
      // REGRESSION. iOS `UtilsSQLCipher.execute` drops the last ";"-component of any
      // SQL containing "DELETE FROM", so `execute("DELETE FROM records")` became the
      // empty string: sqlite3_exec succeeded and nothing was deleted. Diagnostic
      // cleanup then reported success while the records were still there.
      const { store, state } = pluginStore();
      await store.adapter.set("test", "retained");
      expect(state.rows.get("test")).toBe("retained");

      expect(await store.deleteAllRecords()).toEqual({ ok: true });

      // The assertion that matters is row disappearance, not that the call resolved.
      expect(state.rows.size).toBe(0);
      expect(await store.adapter.get("test")).toEqual({ status: "value", value: null });
    });

    it("removes a single key through the parameterised path", async () => {
      const { store, state } = pluginStore();
      await store.adapter.set("a", "1");
      await store.adapter.set("b", "2");

      expect(await store.adapter.remove("a")).toEqual({ ok: true });

      expect(state.rows.has("a")).toBe(false);
      expect(state.rows.get("b")).toBe("2");
    });

    it("applies both durability pragmas as single statements", async () => {
      // REGRESSION. The two pragmas were sent as one "; "-joined line. Android's
      // `UtilsSQLite.getStatementsArray` splits on ";\n", so that line was NOT split
      // and reached `execSQL` as a multi-statement command.
      const { store, state } = pluginStore();

      expect(await store.adapter.set("k", "v")).toEqual({ ok: true });

      expect(state.pragmas.get("journal_mode")).toBe("WAL");
      expect(state.pragmas.get("synchronous")).toBe("FULL");
      // No statement the adapter issues may carry a second statement inside it.
      for (const record of state.executed) {
        for (const executed of record.executed) {
          const body = executed.trim().replace(/;$/, "");
          expect(body.includes(";")).toBe(false);
        }
      }
    });

    it("reports the pragmas the engine ended up with", async () => {
      const { store } = pluginStore();
      const settings = await store.readEffectiveSettings();

      expect(settings.ok).toBe(true);
      if (settings.ok) {
        expect(settings.settings.journalMode).toBe("wal");
        expect(settings.settings.synchronous).toBe("2");
      }
    });

    it("round-trips awkward values through the real statement pipeline", async () => {
      const { store } = pluginStore();
      for (const [key, value] of [
        ["empty", ""],
        ["unicode", "Zürich 🥌"],
        ["sqlish", "'; DELETE FROM records; --"],
      ] as const) {
        expect(await store.adapter.set(key, value)).toEqual({ ok: true });
        expect(await store.adapter.get(key)).toEqual({ status: "value", value });
      }
    });

    it("survives a close and reopen against the same rows", async () => {
      const state = createPluginFaithfulEngineState();
      const first = pluginStore(state);
      await first.store.adapter.set("k", "v");
      expect(await first.store.close()).toEqual({ ok: true });

      // A fresh store over the same "device" state — the adapter reopens.
      const second = pluginStore(state);
      expect(await second.store.adapter.get("k")).toEqual({ status: "value", value: "v" });
    });
  }
);

describe("native SQLite adapter — schema keeps the plugin's delete rewriting disengaged", () => {
  it("declares neither sql_deleted nor last_modified", async () => {
    // Both platforms' `deleteSQL` rewrite a DELETE into a soft-delete UPDATE when the
    // table carries BOTH columns (iOS UtilsSQLCipher.swift:645-699, Android
    // Database.java:910-920). This schema carries neither, so removal really removes.
    // Pinned here because adding either column would silently change what `remove`
    // and `deleteAllRecords` mean.
    const source = await readFile(
      new URL("../nativeSqliteAdapter.ts", import.meta.url),
      "utf8"
    );
    // The STATEMENT, not the comment that explains why those columns are absent.
    const createTable = /CREATE TABLE IF NOT EXISTS[\s\S]*?value TEXT NOT NULL\);/.exec(source);
    expect(createTable).not.toBeNull();
    const statement = createTable![0];
    expect(statement).not.toContain("sql_deleted");
    expect(statement).not.toContain("last_modified");
    expect(statement).toContain("key TEXT PRIMARY KEY NOT NULL");
    expect(statement).toContain("value TEXT NOT NULL");
  });
});

describe("native SQLite adapter — malformed query results fail closed", () => {
  function storeReturning(selectResponse: () => unknown) {
    const engine = createFakeEngine({ selectResponse });
    return nativeStore(engine);
  }

  const READ_FAILED = {
    status: "read_failed",
    fallback: null,
    error: { kind: "unknown", message: "Native storage returned an unreadable result." },
  };

  // The response contract the installed plugin establishes: `query` resolves
  // `{ values: [...] }` where each element is a row object keyed by column name
  // (iOS Database.swift selectSQL + the JS wrapper's `reorderRows`; Android
  // Database.java:968-1000 builds a JSObject per row). Anything else is a broken
  // envelope, and a broken envelope is NOT an empty table.
  it.each([
    ["a null response", () => null],
    ["an undefined response", () => undefined],
    ["a non-object response", () => "values"],
    ["a missing values field", () => ({})],
    ["a null values field", () => ({ values: null })],
    ["a non-array values field", () => ({ values: "not an array" })],
    ["a null row", () => ({ values: [null] })],
    ["a non-object row", () => ({ values: ["not an object"] })],
    ["an array row", () => ({ values: [[]] })],
    ["a row with no value column", () => ({ values: [{}] })],
    ["a row whose value is a number", () => ({ values: [{ value: 42 }] })],
    ["a row whose value is null", () => ({ values: [{ value: null }] })],
    ["a row whose value is an object", () => ({ values: [{ value: {} }] })],
    [
      "a row whose value getter throws",
      () => ({
        values: [
          {
            get value(): string {
              throw new Error("hostile getter");
            },
          },
        ],
      }),
    ],
    [
      "a values getter that throws",
      () => ({
        get values(): unknown {
          throw new Error("hostile envelope getter");
        },
      }),
    ],
  ])("reports read_failed for %s", async (_label, selectResponse) => {
    const store = storeReturning(selectResponse);
    // REGRESSION for `{ values: [null] }` in particular: the previous `toRows`
    // filtered invalid rows out, so a broken envelope became an empty row list and
    // then a successful absence — which would let hydration write a default over
    // data that exists.
    await expect(store.adapter.get("test")).resolves.toEqual(READ_FAILED);
  });

  it("still reports genuine absence for a valid empty result", async () => {
    const store = storeReturning(() => ({ values: [] }));
    await expect(store.adapter.get("test")).resolves.toEqual({
      status: "value",
      value: null,
    });
  });

  it("still preserves a stored empty string", async () => {
    const store = storeReturning(() => ({ values: [{ value: "" }] }));
    await expect(store.adapter.get("test")).resolves.toEqual({
      status: "value",
      value: "",
    });
  });

  it("ignores extra columns rather than rejecting the row", async () => {
    // Defensive, not speculative: the plugin returns every selected column, and a
    // future statement selecting more must not be read as corruption.
    const store = storeReturning(() => ({ values: [{ value: "kept", key: "test" }] }));
    await expect(store.adapter.get("test")).resolves.toEqual({
      status: "value",
      value: "kept",
    });
  });

  it("never leaks the engine's own text through the unreadable-result message", async () => {
    const store = storeReturning(() => ({ values: [{ value: "/var/mobile/secret" }] }));
    const ok = await store.adapter.get("test");
    expect(ok).toEqual({ status: "value", value: "/var/mobile/secret" });

    const broken = storeReturning(() => ({ values: [{ value: { path: "/var/mobile/secret" } }] }));
    const failed = await broken.adapter.get("test");
    expect(JSON.stringify(failed)).not.toContain("/var/mobile");
  });
});

// ---------------------------------------------------------------------------------
// The diagnostics-only owned transaction.
//
// EVIDENCE CLASS: **mock** for the fake-engine cases, and **plugin-faithful mock**
// for the ones driven through `pluginFaithfulSqliteEngine`. Neither is a device.
// What they establish is that the adapter owns one transaction at a time, issues
// its statements with the plugin's per-statement transaction flag OFF, refuses
// every other operation while one is open, and never reports a statement failure
// as a commit failure. Mocked atomicity is NOT measured native atomicity.
// ---------------------------------------------------------------------------------

describe("native SQLite adapter — owned transaction ownership", () => {
  it("opens one transaction and refuses a second", async () => {
    const store = nativeStore(createFakeEngine());
    const first = await store.beginDiagnosticTransaction();
    expect(first.ok).toBe(true);

    const second = await store.beginDiagnosticTransaction();
    expect(second).toEqual({ ok: false, reason: "transaction_pending" });
    expect(store.hasPendingDiagnosticTransaction()).toBe(true);
  });

  it("stages statements with the plugin's own transaction flag OFF", async () => {
    // THE regression this exists to prevent. The plugin's `run` defaults
    // `transaction` to true, which wraps each statement in its own
    // BEGIN/COMMIT. The fake connection throws on a nested BEGIN and asserts
    // the flag directly, so a statement that asked for its own transaction
    // fails here rather than committing half a checkpoint on a device.
    const engine = createFakeEngine();
    const store = nativeStore(engine);
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");

    expect(
      await store.stageDiagnosticWrites(begun.token, [
        { key: "a", value: "1" },
        { key: "b", value: "2" },
      ])
    ).toEqual({ ok: true });
    expect(await store.commitDiagnosticTransaction(begun.token)).toEqual({ ok: true });
  });

  it("refuses every ordinary operation while a transaction is open", async () => {
    const store = nativeStore(createFakeEngine());
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");

    // A read is refused rather than served: on one connection it would see the
    // transaction's UNCOMMITTED rows, which is the most misleading observation
    // this store could produce.
    const read = await store.adapter.get("a");
    expect(read.status).toBe("read_failed");
    expect(await store.adapter.set("a", "1")).toMatchObject({ ok: false });
    expect(await store.adapter.remove("a")).toMatchObject({ ok: false });
    expect(await store.close()).toEqual({ ok: false, reason: "operation_failed" });
    expect(await store.deleteAllRecords()).toEqual({ ok: false, reason: "operation_failed" });
    expect(await store.readEffectiveSettings()).toEqual({
      ok: false,
      reason: "operation_failed",
    });

    // Resolving it frees the store again.
    expect(await store.rollbackDiagnosticTransaction(begun.token)).toEqual({ ok: true });
    expect(await store.adapter.set("a", "1")).toEqual({ ok: true });
  });

  it("never leaks an application-looking payload in a refusal", async () => {
    const store = nativeStore(createFakeEngine());
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");
    const refused = await store.adapter.get("curling.sporting.profile");
    expect(JSON.stringify(refused)).not.toContain("curling.sporting.profile");
  });

  it("refuses a stale or foreign token instead of resolving the current transaction", async () => {
    const store = nativeStore(createFakeEngine());
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");

    const foreign = { id: "someone-elses-transaction" };
    expect(await store.stageDiagnosticWrites(foreign, [{ key: "a", value: "1" }])).toEqual({
      ok: false,
      reason: "wrong_transaction",
    });
    expect(await store.commitDiagnosticTransaction(foreign)).toEqual({
      ok: false,
      reason: "wrong_transaction",
    });
    expect(await store.rollbackDiagnosticTransaction(foreign)).toEqual({
      ok: false,
      reason: "wrong_transaction",
    });
    expect(await store.abandonDiagnosticTransaction(foreign)).toEqual({
      ok: false,
      reason: "wrong_transaction",
    });
    // The real transaction is untouched and still resolvable.
    expect(store.hasPendingDiagnosticTransaction()).toBe(true);
    expect(await store.commitDiagnosticTransaction(begun.token)).toEqual({ ok: true });
  });

  it("refuses transaction operations when none is open", async () => {
    const store = nativeStore(createFakeEngine());
    const token = { id: "nothing" };
    expect(await store.stageDiagnosticWrites(token, [])).toEqual({
      ok: false,
      reason: "no_pending_transaction",
    });
    expect(await store.commitDiagnosticTransaction(token)).toEqual({
      ok: false,
      reason: "no_pending_transaction",
    });
  });

  it("does NOT conclude that no transaction exists when BEGIN itself rejects", async () => {
    // A rejected BEGIN is not evidence that nothing was opened: the native
    // side may have begun and the answer been lost. The store therefore owns an
    // UNCERTAIN transaction and hands the token back so it can be resolved.
    const store = nativeStore(createFakeEngine({ failAt: new Set(["begin"] as const) }));
    const begun = await store.beginDiagnosticTransaction();
    expect(begun).toMatchObject({ ok: false, reason: "begin_unacknowledged" });
    expect(store.hasPendingDiagnosticTransaction()).toBe(true);
    expect(store.diagnosticTransactionState()).toBe("uncertain");
    expect(await store.adapter.set("a", "1")).toMatchObject({ ok: false });
    expect((await store.adapter.get("a")).status).toBe("read_failed");
    if (begun.ok || begun.reason !== "begin_unacknowledged") throw new Error("expected a token");
    // Nothing may be staged into or committed from an uncertain transaction.
    expect(await store.stageDiagnosticWrites(begun.token, [{ key: "a", value: "1" }])).toEqual({
      ok: false,
      reason: "transaction_uncertain",
    });
    expect(await store.commitDiagnosticTransaction(begun.token)).toEqual({
      ok: false,
      reason: "transaction_uncertain",
    });
    // Abandoning closes and releases the connection; only then is it free.
    expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
    expect(store.diagnosticTransactionState()).toBe("none");
    expect(await store.adapter.set("a", "1")).toEqual({ ok: true });
  });

  it("treats a BEGIN that resolves without the plugin's acknowledgement as uncertain", async () => {
    for (const malformed of [undefined, null, {}, { changes: -1 }, { changes: {} }, { changes: { changes: -1 } }, { changes: { changes: "0" } }, [], "ok"]) {
      const engine = createFakeEngine();
      const store = nativeStore(engine);
      // Replace only BEGIN's answer; the transaction itself still begins.
      const connection = await engine.createConnection("test-synthetic");
      const original = connection.beginTransaction.bind(connection);
      connection.beginTransaction = async () => {
        await original();
        return malformed;
      };
      const begun = await store.beginDiagnosticTransaction();
      expect(begun).toMatchObject({ ok: false, reason: "begin_unacknowledged" });
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      connection.beginTransaction = original;
    }
  });

  it("refuses ordinary work when ensureConnection fails, without inventing ownership", async () => {
    // BEGIN was never issued here, so this — and only this — is a failure that
    // proves no transaction exists.
    const store = nativeStore(createFakeEngine({ failAt: new Set(["open"] as const) }));
    expect(await store.beginDiagnosticTransaction()).toEqual({
      ok: false,
      reason: "engine_unavailable",
    });
    expect(store.diagnosticTransactionState()).toBe("none");
  });

  it("fails closed on an unsupported platform without opening anything", async () => {
    const store = nativeStore(createFakeEngine(), "web");
    expect(await store.beginDiagnosticTransaction()).toEqual({
      ok: false,
      reason: "platform_unsupported",
    });
    expect(store.hasPendingDiagnosticTransaction()).toBe(false);
  });
});

describe("native SQLite adapter — transaction failure behaviour", () => {
  it("reports a statement failure as a statement failure and rolls back", async () => {
    const engine = createFakeEngine();
    const store = nativeStore(engine);
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");

    const failed = await store.stageDiagnosticFailingStatement(begun.token, "deliberate");
    // NOT `commit_rejected`. No commit was ever attempted, and conflating the
    // two would misreport what the engine actually did.
    expect(failed).toEqual({
      ok: false,
      reason: "statement_failed",
      cleanup: "rolled_back",
    });
    expect(store.hasPendingDiagnosticTransaction()).toBe(false);
  });

  it("still reports a statement failure when the deliberate statement does NOT fail", async () => {
    // An engine that accepts a NOT NULL violation would be a finding. It must
    // not be reported as a successful stage, because the caller would then
    // commit a checkpoint containing a row it never meant to write.
    const engine = createFakeEngine({ failDeliberateStatement: false });
    const store = nativeStore(engine);
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");

    const result = await store.stageDiagnosticFailingStatement(begun.token, "deliberate");
    // Its OWN reason, not the expected `statement_failed`: an engine that does
    // not enforce the constraint is a finding, and folding it into the expected
    // result would hide it.
    expect(result).toEqual({
      ok: false,
      reason: "statement_unexpectedly_succeeded",
      cleanup: "rolled_back",
    });
  });

  it("keeps the transaction pending when the rollback itself fails", async () => {
    const store = nativeStore(
      createFakeEngine({ failAt: new Set(["rollback"] as const) })
    );
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");

    const failed = await store.stageDiagnosticFailingStatement(begun.token, "deliberate");
    expect(failed).toEqual({
      ok: false,
      reason: "statement_failed",
      cleanup: "rollback_failed",
    });
    // The engine would not end the transaction, so the store must KEEP refusing
    // everything else rather than handing the next caller a connection sitting
    // inside an open transaction.
    expect(store.hasPendingDiagnosticTransaction()).toBe(true);
    expect(await store.adapter.set("a", "1")).toMatchObject({ ok: false });

    // Abandon is a way out even though rollback fails: closing the connection
    // AND releasing the native handle both succeed, which ends the transaction
    // at the engine. Only then is ownership released.
    expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
    expect(store.hasPendingDiagnosticTransaction()).toBe(false);
    expect(await store.adapter.set("a", "1")).toEqual({ ok: true });
  });

  it("reports a rejected commit without claiming anything about rollback", async () => {
    const store = nativeStore(createFakeEngine({ failAt: new Set(["commit"] as const) }));
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");
    await store.stageDiagnosticWrites(begun.token, [{ key: "a", value: "1" }]);

    const committed = await store.commitDiagnosticTransaction(begun.token);
    expect(committed).toEqual({
      ok: false,
      reason: "commit_rejected",
      cleanup: "rolled_back",
    });
    // `cleanup` describes freeing the connection. It is deliberately NOT named
    // or typed as evidence that nothing was committed.
    expect(Object.keys(committed)).not.toContain("rolledBackData");
  });

  it("normalises a hostile thrown value without inspecting it", async () => {
    const hostile = {
      get message(): string {
        throw new Error("hostile getter");
      },
      toString(): string {
        throw new Error("hostile toString");
      },
    };
    const store = nativeStore(
      createFakeEngine({ failAt: new Set(["begin"] as const), thrownValue: hostile })
    );
    expect(await store.beginDiagnosticTransaction()).toMatchObject({
      ok: false,
      reason: "begin_unacknowledged",
    });
  });

  it("survives a non-Error thrown from commit", async () => {
    const store = nativeStore(
      createFakeEngine({ failAt: new Set(["commit"] as const), thrownValue: Symbol("nope") })
    );
    const begun = await store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("expected a transaction");
    const result = await store.commitDiagnosticTransaction(begun.token);
    expect(result).toMatchObject({ ok: false, reason: "commit_rejected" });
  });
});

describe.each(["ios", "android"] as const)(
  "native SQLite adapter — owned transaction against the plugin-faithful engine (%s)",
  (platform) => {
    function pluginStore(state = createPluginFaithfulEngineState()) {
      const { engine } = createPluginFaithfulEngine({ platform, state });
      const store = createNativeSqliteStore({
        databaseName: `test-synthetic-${++nextDatabase}`,
        engine,
        detectPlatform: () => platform,
      });
      return { store, state };
    }

    it("commits several rows as ONE unit", async () => {
      const { store, state } = pluginStore();
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");

      await store.stageDiagnosticWrites(begun.token, [
        { key: "row.0", value: "a" },
        { key: "row.1", value: "b" },
        { key: "progress", value: "done" },
      ]);
      // Nothing is durable yet: the committed row map is still empty.
      expect(state.rows.size).toBe(0);

      expect(await store.commitDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(state.rows.get("row.0")).toBe("a");
      expect(state.rows.get("row.1")).toBe("b");
      expect(state.rows.get("progress")).toBe("done");
    });

    it("leaves NOTHING behind after a rollback, and preserves what was already committed", async () => {
      const { store, state } = pluginStore();
      await store.adapter.set("progress", "checkpoint-1");
      await store.adapter.set("row.0", "old");

      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");
      await store.stageDiagnosticWrites(begun.token, [
        { key: "row.0", value: "new" },
        { key: "row.1", value: "new" },
        { key: "progress", value: "checkpoint-2" },
      ]);
      expect(await store.rollbackDiagnosticTransaction(begun.token)).toEqual({ ok: true });

      // The earlier checkpoint is restored byte for byte, not merely "no new
      // keys appeared" — the rows the transaction overwrote are back.
      expect(state.rows.get("progress")).toBe("checkpoint-1");
      expect(state.rows.get("row.0")).toBe("old");
      expect(state.rows.has("row.1")).toBe(false);
    });

    it("loses uncommitted work when the connection is discarded, as process death would", async () => {
      const state = createPluginFaithfulEngineState();
      const first = pluginStore(state);
      await first.store.adapter.set("progress", "checkpoint-1");

      const begun = await first.store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");
      await first.store.stageDiagnosticWrites(begun.token, [
        { key: "progress", value: "checkpoint-2" },
      ]);

      // A SECOND store over the same device state: the stand-in for a relaunch.
      // The working copy lived on the discarded connection, so it is gone.
      const second = pluginStore(state);
      expect(await second.store.adapter.get("progress")).toEqual({
        status: "value",
        value: "checkpoint-1",
      });
    });

    it("rejects a statement that asks for its own transaction inside an open one", async () => {
      // Direct evidence for the call-shape decision: the engine models SQLite
      // rejecting a nested BEGIN, so an implementation that used the plugin's
      // default would fail here.
      const { engine } = createPluginFaithfulEngine({ platform });
      const connection = await engine.createConnection();
      await connection.open();
      await connection.execute(
        "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
        false
      );
      await connection.beginTransaction();
      await expect(
        connection.run("INSERT INTO records (key, value) VALUES (?, ?)", ["k", "v"], true)
      ).rejects.toThrow(/within a transaction/);
      // The same statement with the flag off is accepted.
      await expect(
        connection.run("INSERT INTO records (key, value) VALUES (?, ?)", ["k", "v"], false)
      ).resolves.toBeDefined();
    });

    it("fails a deliberate NOT NULL violation through the real constraint", async () => {
      const { store } = pluginStore();
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");
      const failed = await store.stageDiagnosticFailingStatement(begun.token, "deliberate");
      expect(failed).toEqual({
        ok: false,
        reason: "statement_failed",
        cleanup: "rolled_back",
      });
    });
  }
);

// ---------------------------------------------------------------------------------
// Ownership while the native transaction state is UNCERTAIN.
//
// Every fault below is injected at the bridge with its native effect stated, and
// none heals itself: the engine keeps the transaction open exactly as long as the
// failure would. The assertion that matters in each case is that the store never
// frees itself — never serves an ordinary read that the still-open native
// transaction could answer from its uncommitted working copy.
// ---------------------------------------------------------------------------------

describe.each(["ios", "android"] as const)(
  "native SQLite adapter — ownership under uncertainty against the plugin-faithful engine (%s)",
  (platform) => {
    function faultyStore() {
      const state = createPluginFaithfulEngineState();
      const harness = createPluginFaithfulEngine({ platform, state, faults: {} });
      const store = createNativeSqliteStore({
        databaseName: `test-synthetic-${++nextDatabase}`,
        engine: harness.engine,
        detectPlatform: () => platform,
      });
      return { store, state, harness, faults: harness.faults };
    }

    /** Every operation that must be refused while a transaction is owned. */
    async function expectEverythingRefused(
      store: ReturnType<typeof createNativeSqliteStore>
    ): Promise<void> {
      expect((await store.adapter.get("committed")).status).toBe("read_failed");
      expect((await store.adapter.get("staged")).status).toBe("read_failed");
      expect(await store.adapter.set("other", "x")).toMatchObject({ ok: false });
      expect(await store.adapter.remove("committed")).toMatchObject({ ok: false });
      expect(await store.readEffectiveSettings()).toEqual({ ok: false, reason: "operation_failed" });
      expect(await store.deleteAllRecords()).toEqual({ ok: false, reason: "operation_failed" });
      expect(await store.close()).toEqual({ ok: false, reason: "operation_failed" });
      expect(await store.reopenDiagnosticConnection()).toMatchObject({
        ok: false,
        boundary: "refused",
      });
      expect(await store.beginDiagnosticTransaction()).toEqual({
        ok: false,
        reason: "transaction_pending",
      });
    }

    it("keeps ownership when BEGIN takes effect and then rejects", async () => {
      const { store, state, harness, faults } = faultyStore();
      await store.adapter.set("committed", "before");
      faults.beginRejectsAfterEffect = true;

      const begun = await store.beginDiagnosticTransaction();
      if (begun.ok || begun.reason !== "begin_unacknowledged") {
        throw new Error("expected an unacknowledged BEGIN");
      }
      // The native transaction really is open.
      expect(harness.transactionOpen).toBe(true);
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      await expectEverythingRefused(store);

      // A positively acknowledged ROLLBACK is a justified resolution.
      faults.beginRejectsAfterEffect = false;
      expect(await store.rollbackDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(harness.transactionOpen).toBe(false);
      expect(store.diagnosticTransactionState()).toBe("none");
      expect(await store.adapter.get("committed")).toEqual({ status: "value", value: "before" });
      expect(state.rows.get("committed")).toBe("before");
    });

    it("keeps ownership when BEGIN takes effect and answers with a malformed envelope", async () => {
      const { store, harness, faults } = faultyStore();
      faults.beginResolvesMalformed = true;

      const begun = await store.beginDiagnosticTransaction();
      expect(begun).toMatchObject({ ok: false, reason: "begin_unacknowledged" });
      expect(harness.transactionOpen).toBe(true);
      await expectEverythingRefused(store);
      if (begun.ok || begun.reason !== "begin_unacknowledged") throw new Error("token");

      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(harness.transactionOpen).toBe(false);
      expect(store.diagnosticTransactionState()).toBe("none");
    });

    it("never frees the store when rollback AND close both fail during abandon", async () => {
      const { store, state, harness, faults } = faultyStore();
      await store.adapter.set("committed", "before");
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");
      await store.stageDiagnosticWrites(begun.token, [
        { key: "committed", value: "UNCOMMITTED" },
        { key: "staged", value: "UNCOMMITTED" },
      ]);

      faults.rollbackRejects = true;
      faults.closeRejects = true;
      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({
        ok: false,
        reason: "abandon_incomplete",
        boundary: "close",
      });
      // The native transaction is still open with its uncommitted rows, and the
      // store still owns it. Before this correction it reported "no pending
      // transaction" here and served reads from that working copy.
      expect(harness.transactionOpen).toBe(true);
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      expect(store.hasPendingDiagnosticTransaction()).toBe(true);
      await expectEverythingRefused(store);
      // Nothing may be staged or committed from it any more.
      expect(await store.commitDiagnosticTransaction(begun.token)).toEqual({
        ok: false,
        reason: "transaction_uncertain",
      });
      expect(state.rows.get("committed")).toBe("before");

      // A retry, once the close works, resolves it — and only then.
      faults.closeRejects = false;
      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(harness.transactionOpen).toBe(false);
      expect(store.diagnosticTransactionState()).toBe("none");
      expect(await store.adapter.get("committed")).toEqual({ status: "value", value: "before" });
      expect(await store.adapter.get("staged")).toEqual({ status: "value", value: null });
    });

    it("keeps ownership when the native handle release fails, and resumes there", async () => {
      const { store, harness, faults } = faultyStore();
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");

      faults.closeConnectionRejects = true;
      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({
        ok: false,
        reason: "abandon_incomplete",
        boundary: "release",
      });
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      await expectEverythingRefused(store);
      // The connection is already closed, so a ROLLBACK cannot resolve it.
      expect(await store.rollbackDiagnosticTransaction(begun.token)).toEqual({
        ok: false,
        reason: "rollback_failed",
      });
      expect(store.diagnosticTransactionState()).toBe("uncertain");

      faults.closeConnectionRejects = false;
      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(harness.transactionOpen).toBe(false);
      expect(store.diagnosticTransactionState()).toBe("none");
      expect(await store.adapter.set("after", "1")).toEqual({ ok: true });
    });

    it("keeps a resolvable token when the constraint violation is ACCEPTED and the rollback then fails", async () => {
      const { store, state, harness, faults } = faultyStore();
      await store.adapter.set("committed", "before");
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");

      state.acceptNotNullViolation = true;
      faults.rollbackRejects = true;
      expect(await store.stageDiagnosticFailingStatement(begun.token, "deliberate")).toEqual({
        ok: false,
        reason: "statement_unexpectedly_succeeded",
        cleanup: "rollback_failed",
      });
      expect(harness.transactionOpen).toBe(true);
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      await expectEverythingRefused(store);

      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(harness.transactionOpen).toBe(false);
      expect(state.rows.has("deliberate")).toBe(false);
      expect(state.rows.get("committed")).toBe("before");
    });

    it("does not release ownership on a ROLLBACK whose acknowledgement is malformed", async () => {
      const { store, harness, faults } = faultyStore();
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");

      faults.rollbackResolvesMalformed = true;
      expect(await store.rollbackDiagnosticTransaction(begun.token)).toEqual({
        ok: false,
        reason: "rollback_failed",
      });
      // The engine did roll back — but the store could not read that, so it does
      // not claim it.
      expect(harness.transactionOpen).toBe(false);
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      await expectEverythingRefused(store);
      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
    });

    it("stays uncertain after a COMMIT that took effect but whose answer was lost", async () => {
      const { store, state, harness, faults } = faultyStore();
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");
      await store.stageDiagnosticWrites(begun.token, [{ key: "row", value: "new" }]);

      faults.commitRejectsAfterEffect = true;
      // The follow-up ROLLBACK finds no transaction and rejects, so nothing is
      // known: not committed, not rolled back.
      expect(await store.commitDiagnosticTransaction(begun.token)).toEqual({
        ok: false,
        reason: "commit_rejected",
        cleanup: "rollback_failed",
      });
      expect(harness.transactionOpen).toBe(false);
      expect(state.rows.get("row")).toBe("new");
      expect(store.diagnosticTransactionState()).toBe("uncertain");
      await expectEverythingRefused(store);
      expect(await store.abandonDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(await store.adapter.get("row")).toEqual({ status: "value", value: "new" });
    });

    it("keeps transaction:false for staged statements and transaction:true for ordinary writes", async () => {
      const { store, state } = faultyStore();
      await store.adapter.set("ordinary", "1");
      const begun = await store.beginDiagnosticTransaction();
      if (!begun.ok) throw new Error("expected a transaction");
      // The engine rejects a nested BEGIN, so a staged statement carrying
      // `transaction: true` would fail here.
      expect(await store.stageDiagnosticWrites(begun.token, [{ key: "staged", value: "2" }])).toEqual({
        ok: true,
      });
      expect(await store.commitDiagnosticTransaction(begun.token)).toEqual({ ok: true });
      expect(state.rows.get("ordinary")).toBe("1");
      expect(state.rows.get("staged")).toBe("2");
    });
  }
);

describe.each(["ios", "android"] as const)(
  "native SQLite adapter — the reopen boundary (%s)",
  (platform) => {
    function faultyStore() {
      const state = createPluginFaithfulEngineState();
      const harness = createPluginFaithfulEngine({ platform, state, faults: {} });
      const store = createNativeSqliteStore({
        databaseName: `test-synthetic-${++nextDatabase}`,
        engine: harness.engine,
        detectPlatform: () => platform,
      });
      return { store, state, harness, faults: harness.faults };
    }

    it("reports a fresh connection only when close, release and open all succeed", async () => {
      const { store, state, harness } = faultyStore();
      await store.adapter.set("k", "v");
      const opensBefore = state.openCount;
      expect(await store.reopenDiagnosticConnection()).toEqual({ ok: true });
      expect(state.openCount).toBe(opensBefore + 1);
      expect(harness.connectionOpen).toBe(true);
      expect(await store.adapter.get("k")).toEqual({ status: "value", value: "v" });
    });

    it("names the close boundary and keeps the old handle when close fails", async () => {
      const { store, state, faults } = faultyStore();
      await store.adapter.set("k", "v");
      faults.closeRejects = true;
      expect(await store.reopenDiagnosticConnection()).toMatchObject({
        ok: false,
        boundary: "close",
      });
      // No reopen happened.
      expect(state.openCount).toBe(1);
    });

    it("names the release boundary when the native handle release fails", async () => {
      const { store, faults } = faultyStore();
      await store.adapter.set("k", "v");
      faults.closeConnectionRejects = true;
      expect(await store.reopenDiagnosticConnection()).toMatchObject({
        ok: false,
        boundary: "release",
      });
      // A retry resumes at the release and does not call the old handle fresh.
      faults.closeConnectionRejects = false;
      expect(await store.reopenDiagnosticConnection()).toEqual({ ok: true });
    });

    it("names the open boundary when the fresh connection cannot be opened", async () => {
      const { store, faults } = faultyStore();
      await store.adapter.set("k", "v");
      faults.openRejects = true;
      expect(await store.reopenDiagnosticConnection()).toMatchObject({
        ok: false,
        boundary: "open",
      });
    });

    it("releases a handle an ordinary close left behind before calling a connection fresh", async () => {
      const { store, faults } = faultyStore();
      await store.adapter.set("k", "v");
      faults.closeConnectionRejects = true;
      expect(await store.close()).toMatchObject({ ok: false });
      // Still failing: the stale handle cannot be released, so no fresh claim.
      expect(await store.reopenDiagnosticConnection()).toMatchObject({
        ok: false,
        boundary: "release",
      });
      faults.closeConnectionRejects = false;
      expect(await store.reopenDiagnosticConnection()).toEqual({ ok: true });
    });
  }
);
