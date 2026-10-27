// A test engine that reproduces the STATEMENT PREPROCESSING the installed
// `@capacitor-community/sqlite` 8.1.1 actually performs, per platform.
//
// This is not a SQLite implementation and does not pretend to be one. It models
// exactly the layer between the adapter's call and the database — the layer that
// silently changed what was executed — plus enough key/value semantics to observe
// the result. Everything below is traced to the installed sources in
// `node_modules/@capacitor-community/sqlite`; line references are to that copy.
//
// EVIDENCE CLASS: **mock**. It proves the adapter issues statements the plugin
// will carry through unchanged. It proves nothing about a device.
//
// Why this exists: a hand-written fake that simply matched on `sql.startsWith(...)`
// agreed with the adapter about what a statement meant, and therefore could not
// see that iOS rewrites `DELETE FROM records` into the empty string before
// executing it.

/** What the plugin's preprocessing produced, so a test can assert on it directly. */
export interface ExecutedStatement {
  /** The SQL the adapter asked for. */
  requested: string;
  /** What the platform actually handed to SQLite, after its own rewriting. */
  executed: string[];
  /** For `run(..., false)`: whether a native transaction was open at the time. */
  inTransaction?: boolean;
}

export interface PluginFaithfulEngineState {
  /** When set, the engine ACCEPTS the deliberate NOT NULL violation — an engine
   * finding the adapter must report as such. Lives on the state because the
   * statement layer is where the constraint is modelled. */
  acceptNotNullViolation?: boolean;
  /**
   * The COMMITTED rows — what a restart would find. Uncommitted work lives in
   * the connection's working copy and is deliberately not here, so "the process
   * died before COMMIT" is modelled by discarding a connection rather than by
   * trusting a flag.
   */
  rows: Map<string, string>;
  /** Pragmas that actually reached the database. */
  pragmas: Map<string, string>;
  executed: ExecutedStatement[];
  openCount: number;
  closeCount: number;
  tables: Set<string>;
  /**
   * Every bridge call that TOOK EFFECT, in order: `open`, `close`, `release`
   * (the engine's native-handle release), `begin`, `commit`, `rollback`,
   * `run:<sql>` and `query:<sql>`. For ordering assertions (Stage M3b4b).
   */
  trace: string[];
}

export type PluginPlatform = "ios" | "android";

class PluginStatementError extends Error {}

/**
 * iOS: `UtilsSQLCipher.execute` (UtilsSQLCipher.swift:856-906).
 *
 * When the SQL contains "DELETE FROM" (case-insensitive) it strips newlines,
 * splits on ";", **unconditionally drops the last component**, rebuilds, and then
 * `sqlite3_exec`s the result. A statement with no trailing ";" therefore loses its
 * only component and becomes the empty string, which `sqlite3_exec` accepts and
 * which deletes nothing.
 *
 * A "DELETE FROM ... WHERE ..." component is passed through `deleteSQL`
 * (UtilsSQLCipher.swift:645-699), which returns the statement UNCHANGED unless the
 * table carries both `last_modified` and `sql_deleted` columns. The records table
 * carries neither, so that branch is modelled as a passthrough — and
 * `nativeSqliteAdapter.test.ts` pins the schema so it stays that way.
 */
function iosPreprocessExecute(sql: string): string {
  if (!sql.toLowerCase().includes("delete from")) return sql;
  const stripped = sql.replace(/\n/g, "");
  const parts = stripped.split(";");
  parts.pop(); // stmtArr.removeLast()
  const rebuilt: string[] = [];
  for (const part of parts) {
    const head = part.trim().slice(0, 11).toUpperCase();
    if (head === "DELETE FROM" && part.toLowerCase().includes("where")) {
      rebuilt.push(part.trim()); // deleteSQL passthrough for this schema
    } else {
      rebuilt.push(part);
    }
  }
  return rebuilt.join(";");
}

/**
 * Android: `UtilsSQLite.getStatementsArray` (UtilsSQLite.java:44-70) splits on
 * ";\n" — a semicolon followed by a NEWLINE — then folds each result's lines into
 * one line and strips "--" comments. Two statements separated by "; " on a single
 * line are therefore NOT split apart.
 */
function androidStatementsArray(sql: string): string[] {
  const commands = sql.replace(/end;/g, "END;").split(";\n");
  const folded = commands.map((command) =>
    command
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        const comment = trimmed.indexOf("--");
        return comment > -1 ? trimmed.slice(0, comment) : trimmed;
      })
      .filter((line) => line.length > 0)
      .join(" ")
  );
  if (folded.length > 0 && folded[folded.length - 1].trim().length === 0) folded.pop();
  return folded;
}

/**
 * Android `SQLiteDatabase.execSQL` executes ONE statement and rejects anything
 * carrying more (it is documented as "a single SQL statement that is not a SELECT
 * or any other SQL statement that returns data"). Modelled as an error, which is
 * what makes a "; "-joined pragma pair observable instead of half-silently lost.
 */
function androidExecSqlGuard(command: string): void {
  const withoutTrailing = command.trim().replace(/;$/, "");
  if (withoutTrailing.includes(";")) {
    throw new PluginStatementError("execSQL: multiple statements are not supported");
  }
}

/** Test-only installed-plugin execute preprocessing, also usable before real
 * disposable SQLite. This is a source-derived model, not native execution. */
export function preprocessPluginExecute(platform: PluginPlatform, statements: string): string[] {
  if (platform === "ios") return [iosPreprocessExecute(statements)];
  return androidStatementsArray(statements).map(command => {
    const result = command.endsWith(";") ? command : command + ";";
    androidExecSqlGuard(result); return result;
  });
}

/** The tiny slice of SQL these tests need, applied to the ACTIVE row map —
 * the committed rows outside a transaction, the working copy inside one. */
function applyStatement(
  state: PluginFaithfulEngineState,
  rows: Map<string, string>,
  sql: string,
  values: unknown[]
): number {
  const statement = sql.trim().replace(/;$/, "").trim();
  if (statement.length === 0) {
    // `sqlite3_exec("")` succeeds and does nothing. This is the whole point of
    // the iOS regression: silence, not failure.
    return 0;
  }
  const upper = statement.toUpperCase();

  if (upper.startsWith("PRAGMA")) {
    const assignment = /^PRAGMA\s+(\w+)\s*=\s*(\S+)$/i.exec(statement);
    if (assignment) {
      state.pragmas.set(assignment[1].toLowerCase(), assignment[2].toUpperCase());
      return 0;
    }
    const read = /^PRAGMA\s+(\w+)$/i.exec(statement);
    if (read) return 0;
    throw new PluginStatementError("unsupported pragma");
  }

  if (upper.startsWith("CREATE TABLE")) {
    const name = /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i.exec(statement);
    if (!name) throw new PluginStatementError("unparseable CREATE TABLE");
    state.tables.add(name[1]);
    return 0;
  }

  if (upper.startsWith("INSERT INTO")) {
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    // `value TEXT NOT NULL`. A statement inserting a literal NULL into `value`
    // is rejected by SQLite, which is what makes the adapter's deliberate
    // failing statement a REAL constraint violation rather than a fake the test
    // agreed to treat as one.
    if (/VALUES\s*\(\s*\?\s*,\s*NULL\s*\)/i.test(statement)) {
      if (values.length !== 1) throw new PluginStatementError("expected one bound value");
      if (state.acceptNotNullViolation) {
        rows.set(String(values[0]), "");
        return 1;
      }
      throw new PluginStatementError("NOT NULL constraint failed: records.value");
    }
    if (values.length !== 2) throw new PluginStatementError("expected two bound values");
    const key = String(values[0]);
    // `key TEXT PRIMARY KEY`: a plain INSERT over an existing key is a
    // constraint violation, exactly as SQLite reports it. Only a statement that
    // carries the upsert clause replaces the value.
    if (!/ON\s+CONFLICT/i.test(statement) && rows.has(key)) {
      throw new PluginStatementError("UNIQUE constraint failed: records.key");
    }
    rows.set(key, String(values[1]));
    return 1;
  }

  if (upper.startsWith("UPDATE")) {
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    if (!/^UPDATE\s+records\s+SET\s+value\s*=\s*\?\s+WHERE\s+key\s*=\s*\?$/i.test(statement)) {
      throw new PluginStatementError("unsupported UPDATE");
    }
    if (values.length !== 2) throw new PluginStatementError("expected two bound values");
    const key = String(values[1]);
    // An UPDATE matching no row succeeds and changes nothing.
    if (!rows.has(key)) return 0;
    rows.set(key, String(values[0]));
    return 1;
  }

  if (upper.startsWith("DELETE FROM")) {
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    if (upper.includes("WHERE")) {
      if (values.length !== 1) throw new PluginStatementError("expected one bound value");
      return rows.delete(String(values[0])) ? 1 : 0;
    }
    const count = rows.size;
    rows.clear();
    return count;
  }

  throw new PluginStatementError("unsupported statement");
}

function queryRows(
  state: PluginFaithfulEngineState,
  rows: Map<string, string>,
  sql: string,
  values: unknown[]
): Record<string, unknown>[] {
  const statement = sql.trim().replace(/;$/, "").trim();

  // Fixed discovery observations for the model's actual tables. Unknown
  // queries still throw below; this is not an empty-success fallback.
  if (statement === "PRAGMA schema_version") return [{ schema_version: state.tables.size }];
  if (statement === "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name") {
    return [...state.tables].flatMap(name => [
      { type: "index", name: `sqlite_autoindex_${name}_1`, tbl_name: name, sql: null },
      { type: "table", name, tbl_name: name, sql: `CREATE TABLE ${name} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)` },
    ]).sort((a, b) => a.type < b.type ? -1 : a.type > b.type ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  if (statement === "PRAGMA table_info('records')") return state.tables.has("records") ? [
    { cid: 0, name: "key", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
    { cid: 1, name: "value", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
  ] : [];
  if (statement === "PRAGMA index_list('records')") return state.tables.has("records") ? [
    { seq: 0, name: "sqlite_autoindex_records_1", unique: 1, origin: "pk", partial: 0 },
  ] : [];
  if (statement === "PRAGMA index_info('sqlite_autoindex_records_1')") return state.tables.has("records") ? [
    { seqno: 0, cid: 0, name: "key" },
  ] : [];

  const pragmaAssignment = /^PRAGMA\s+(\w+)\s*=\s*(\S+)$/i.exec(statement);
  if (pragmaAssignment) {
    // A `PRAGMA journal_mode = X` assignment RETURNS the resulting mode, which is
    // why the adapter issues it through `query` on both platforms.
    state.pragmas.set(pragmaAssignment[1].toLowerCase(), pragmaAssignment[2].toUpperCase());
    const name = pragmaAssignment[1].toLowerCase();
    if (name === "journal_mode") return [{ journal_mode: pragmaAssignment[2].toLowerCase() }];
    return [];
  }

  const pragmaRead = /^PRAGMA\s+(\w+)$/i.exec(statement);
  if (pragmaRead) {
    const name = pragmaRead[1].toLowerCase();
    const current = state.pragmas.get(name);
    if (name === "journal_mode") return [{ journal_mode: (current ?? "DELETE").toLowerCase() }];
    if (name === "synchronous") return [{ synchronous: current === "FULL" ? 2 : 1 }];
    if (name === "page_size") return [{ page_size: 4096 }];
    return [];
  }

  if (/^SELECT\s+sqlite_version\(\)/i.test(statement)) {
    return [{ version: "3.45.0" }];
  }

  if (/^SELECT\s+key\s+FROM\s+records\s+ORDER\s+BY\s+key$/i.test(statement)) {
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    // SQLite BINARY compares UTF-8 bytes; JS default sort compares UTF-16.
    // U+E000 sorts before a supplementary character in SQLite, after it in JS.
    const encoded = [...rows.keys()].map(key => ({ key, bytes: new TextEncoder().encode(key) }));
    encoded.sort((a, b) => {
      for (let i = 0; i < Math.min(a.bytes.length, b.bytes.length); i++) {
        if (a.bytes[i] !== b.bytes[i]) return a.bytes[i] - b.bytes[i];
      }
      return a.bytes.length - b.bytes.length;
    });
    return encoded.map(({ key }) => ({ key }));
  }

  if (/^SELECT\s+value\s+FROM\s+records\s+WHERE\s+key\s*=\s*\?$/i.test(statement)) {
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    const key = String(values[0]);
    // Inside a transaction this reads the working copy, exactly as the same
    // connection would see its own uncommitted writes.
    if (!rows.has(key)) return [];
    return [{ value: rows.get(key) }];
  }

  throw new PluginStatementError("unsupported query");
}

/**
 * Lifecycle faults, injected at the bridge boundary. Each one is modelled with
 * its native EFFECT stated explicitly — "the step happened and the answer was
 * lost" is different from "the step did not happen" — and none of them heals
 * itself: a fault stays in force until the test turns it off, and a failed step
 * leaves the native state exactly where that failure would leave it. The object
 * is live, so a test can change it between calls.
 */
export interface PluginFaithfulFaults {
  /** BEGIN takes effect natively, then the bridge rejects. */
  beginRejectsAfterEffect?: boolean;
  /** BEGIN takes effect natively, then resolves with something that is not the
   * plugin's `{ changes: { changes: 0 } }` acknowledgement. */
  beginResolvesMalformed?: boolean;
  /** COMMIT takes effect natively, then the bridge rejects. */
  commitRejectsAfterEffect?: boolean;
  /** ROLLBACK rejects WITHOUT taking effect: the transaction stays open. */
  rollbackRejects?: boolean;
  /** ROLLBACK takes effect, then resolves with a malformed acknowledgement. */
  rollbackResolvesMalformed?: boolean;
  /** The connection's close rejects WITHOUT taking effect: it stays open, and
   * any transaction on it stays open. */
  closeRejects?: boolean;
  /** The engine's native handle release rejects WITHOUT taking effect. */
  closeConnectionRejects?: boolean;
  /** Opening a connection rejects. */
  openRejects?: boolean;
  /**
   * What ROLLBACK does when NO transaction is active. The installed plugin
   * differs per platform: iOS issues `ROLLBACK TRANSACTION;` through
   * `sqlite3_exec`, which SQLite rejects; Android's `Database.rollbackTransaction`
   * only calls `endTransaction()` `if (isAvailTrans())` and otherwise returns 0,
   * which the plugin resolves as `{ changes: { changes: 0 } }` — an
   * acknowledgement. `"platform"` models exactly that. The default, `"reject"`,
   * is the pre-M3b4b model kept for the existing diagnostics tests; it is
   * faithful for iOS only. Every M3b4b migration test passes `"platform"`.
   */
  rollbackWithoutTransaction?: "reject" | "platform";
  /**
   * Targeted fault hooks (Stage M3b4b). Each is consulted at the named bridge
   * call and states its native EFFECT explicitly:
   *   - `reject_before_effect`: the call rejects and nothing happened natively;
   *   - `reject_after_effect`: the effect happened, then the bridge rejected;
   *   - `malformed_after_effect`: the effect happened, then an unreadable answer;
   *   - `hang`: the call never answers (a process death mid-call). Nothing
   *     happened natively; the connection's working copy is discarded when the
   *     test builds a new engine over the same state.
   */
  onBegin?: () => BridgeFault;
  /** Receives the working copy that COMMIT would make durable. */
  onCommit?: (working: ReadonlyMap<string, string>) => BridgeFault;
  onRollback?: () => Exclude<BridgeFault, "reject_after_effect">;
  onRun?: (statement: string, values: readonly unknown[]) => BridgeFault;
  /** Returns a replacement envelope for a query, or `undefined` for the real one. */
  onQuery?: (statement: string, values: readonly unknown[]) => { reject: true } | { envelope: unknown } | undefined;
  onClose?: () => "ok" | "reject_before_effect";
  onCloseConnection?: () => "ok" | "reject_before_effect";
  /**
   * Awaited at the start of a bridge call, BEFORE its effect: a controllable
   * promise that holds the call open until the test releases it. The call has
   * been issued from the caller's side; nothing has happened natively yet.
   */
  gate?: (call: BridgeCall) => Promise<void> | void;
}

export interface BridgeCall {
  readonly kind: "create" | "open" | "begin" | "commit" | "rollback" | "run" | "query";
  readonly statement?: string;
  readonly values?: readonly unknown[];
}

export type BridgeFault = "ok" | "reject_before_effect" | "reject_after_effect" | "malformed_after_effect" | "hang";

/** A promise that never settles: the bridge call never answers. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

export interface PluginFaithfulEngineOptions {
  platform: PluginPlatform;
  /** Shared rows, so one "device" can survive a simulated app restart. */
  state?: PluginFaithfulEngineState;
  /** Live fault switches; see `PluginFaithfulFaults`. */
  faults?: PluginFaithfulFaults;
}

class PluginBridgeError extends Error {}

/** What the installed plugin resolves BEGIN/COMMIT/ROLLBACK with on both
 * platforms (iOS `ReturnHandler.rChanges`, Android `RetHandler.retChanges`). */
const TRANSACTION_ACK = { changes: { changes: 0 } } as const;

export function createPluginFaithfulEngineState(): PluginFaithfulEngineState {
  return {
    rows: new Map(),
    pragmas: new Map(),
    executed: [],
    openCount: 0,
    closeCount: 0,
    tables: new Set(),
    trace: [],
  };
}

export function createPluginFaithfulEngine(options: PluginFaithfulEngineOptions) {
  const state = options.state ?? createPluginFaithfulEngineState();
  const platform = options.platform;
  const faults: PluginFaithfulFaults = options.faults ?? {};
  let open = false;
  /**
   * The open transaction's WORKING COPY, or null.
   *
   * It lives on the connection, not on the shared state, which is what makes
   * durability modelling honest: building a second engine over the same `state`
   * — the test's stand-in for an app restart — leaves this behind, so
   * uncommitted rows are gone exactly as they would be after process death.
   */
  let transactionRows: Map<string, string> | null = null;

  /** Committed rows outside a transaction; the working copy inside one. */
  function activeRows(): Map<string, string> {
    return transactionRows ?? state.rows;
  }

  const connection = {
    async open(): Promise<void> {
      if (faults.gate) await faults.gate({ kind: "open" });
      if (faults.openRejects) throw new PluginBridgeError("Open: injected failure");
      open = true;
      state.openCount += 1;
      state.trace.push("open");
    },
    async close(): Promise<void> {
      // Rejected BEFORE effect: the connection, and any transaction on it, is
      // still exactly as it was.
      if (faults.closeRejects || faults.onClose?.() === "reject_before_effect") {
        throw new PluginBridgeError("Close: injected failure");
      }
      state.closeCount += 1;
      state.trace.push("close");
      closeNow();
    },
    /**
     * iOS `UtilsSQLCipher.beginTransaction` issues `BEGIN TRANSACTION;` through
     * `sqlite3_exec`. SQLite rejects that while a transaction is already active
     * ("cannot start a transaction within a transaction"), so this throws rather
     * than silently nesting — the behaviour that makes an accidental nested
     * BEGIN visible in a test instead of in production.
     */
    async beginTransaction(): Promise<unknown> {
      if (!open) throw new PluginStatementError("Database not opened");
      if (faults.gate) await faults.gate({ kind: "begin" });
      const hook = faults.onBegin?.() ?? "ok";
      if (hook === "hang") return never();
      if (hook === "reject_before_effect") throw new PluginBridgeError("BeginTransaction: injected failure");
      if (transactionRows !== null) {
        throw new PluginStatementError("cannot start a transaction within a transaction");
      }
      state.executed.push({ requested: "BEGIN TRANSACTION;", executed: ["BEGIN TRANSACTION;"] });
      state.trace.push("begin");
      transactionRows = new Map(state.rows);
      if (hook === "reject_after_effect") throw new PluginBridgeError("BeginTransaction: injected lost acknowledgement");
      if (hook === "malformed_after_effect") return { changes: "unreadable" };
      // Both faults strike AFTER the transaction exists natively.
      if (faults.beginRejectsAfterEffect) {
        throw new PluginBridgeError("BeginTransaction: injected lost acknowledgement");
      }
      if (faults.beginResolvesMalformed) return { changes: -1 };
      return TRANSACTION_ACK;
    },
    async commitTransaction(): Promise<unknown> {
      if (!open) throw new PluginStatementError("Database not opened");
      if (faults.gate) await faults.gate({ kind: "commit" });
      if (transactionRows === null) {
        throw new PluginStatementError("cannot commit - no transaction is active");
      }
      const hook = faults.onCommit?.(transactionRows) ?? "ok";
      if (hook === "hang") return never();
      if (hook === "reject_before_effect") {
        // The COMMIT failed natively; the transaction is still open.
        throw new PluginBridgeError("CommitTransaction: injected failure");
      }
      state.executed.push({ requested: "COMMIT TRANSACTION;", executed: ["COMMIT TRANSACTION;"] });
      state.trace.push("commit");
      // The whole working copy becomes durable AT ONCE. Rows and their progress
      // record cannot land separately, which is the property being modelled.
      // Mutated in place: a test holding this Map is how one device's storage is
      // shared across a simulated restart.
      state.rows.clear();
      for (const [key, value] of transactionRows) state.rows.set(key, value);
      transactionRows = null;
      if (faults.commitRejectsAfterEffect || hook === "reject_after_effect") {
        throw new PluginBridgeError("CommitTransaction: injected lost acknowledgement");
      }
      if (hook === "malformed_after_effect") return { changes: null };
      return TRANSACTION_ACK;
    },
    async rollbackTransaction(): Promise<unknown> {
      if (!open) throw new PluginStatementError("Database not opened");
      if (faults.gate) await faults.gate({ kind: "rollback" });
      const hook = faults.onRollback?.() ?? "ok";
      if (hook === "hang") return never();
      if (faults.rollbackRejects || hook === "reject_before_effect") {
        throw new PluginBridgeError("RollbackTransaction: injected failure");
      }
      if (transactionRows === null) {
        if (faults.rollbackWithoutTransaction === "platform" && platform === "android") {
          // `if (isAvailTrans()) endTransaction(); return 0;`
          return TRANSACTION_ACK;
        }
        throw new PluginStatementError("cannot rollback - no transaction is active");
      }
      state.executed.push({
        requested: "ROLLBACK TRANSACTION;",
        executed: ["ROLLBACK TRANSACTION;"],
      });
      state.trace.push("rollback");
      transactionRows = null;
      if (faults.rollbackResolvesMalformed || hook === "malformed_after_effect") return {};
      return TRANSACTION_ACK;
    },
    async execute(statements: string, transaction: boolean): Promise<unknown> {
      if (!open) throw new PluginStatementError("Database not opened");
      const rows = activeRows();
      const executed: string[] = [];
      if (platform === "ios") {
        // Whole-string preprocessing, then ONE sqlite3_exec.
        const rewritten = iosPreprocessExecute(statements);
        executed.push(rewritten);
        for (const part of rewritten.split(";")) applyStatement(state, rows, part, []);
      } else {
        for (let command of androidStatementsArray(statements)) {
          if (!command.endsWith(";")) command += ";";
          androidExecSqlGuard(command);
          executed.push(command);
          applyStatement(state, rows, command, []);
        }
      }
      state.executed.push({ requested: statements, executed });
      void transaction;
      return {};
    },
    /**
     * `run(statement, values, transaction)`.
     *
     * The plugin DEFAULTS `transaction` to `true`
     * (`dist/esm/definitions.js`), and on iOS that reaches
     * `Database.runSQL(sql:values:transaction:)`, which wraps the statement in
     * its own `BEGIN`/`COMMIT` (Database.swift). Both halves are modelled here:
     *
     *   - `transaction: true` inside an already-open transaction FAILS, because
     *     the wrapper's `BEGIN` is a nested one;
     *   - `transaction: true` outside one commits immediately and by itself,
     *     which is why a checkpoint's statements must pass `false`.
     *
     * A fake that ignored this argument would happily certify an implementation
     * whose statements each committed on their own.
     */
    async run(statement: string, values: unknown[], transaction: boolean): Promise<unknown> {
      if (!open) throw new PluginStatementError("Database not opened");
      if (faults.gate) await faults.gate({ kind: "run", statement, values });
      const hook = faults.onRun?.(statement, values) ?? "ok";
      if (hook === "hang") return never();
      if (hook === "reject_before_effect") throw new PluginBridgeError("Run: injected failure");
      let changes: number;
      if (transaction) {
        if (transactionRows !== null) {
          throw new PluginStatementError("cannot start a transaction within a transaction");
        }
        // Its own transaction: applied and durable the moment it succeeds.
        state.executed.push({ requested: statement, executed: [statement] });
        changes = applyStatement(state, state.rows, statement, values);
      } else {
        // Part of a transaction somebody else owns.
        state.executed.push({ requested: statement, executed: [statement], inTransaction: transactionRows !== null });
        changes = applyStatement(state, activeRows(), statement, values);
      }
      state.trace.push(`run:${statement}`);
      if (hook === "reject_after_effect") throw new PluginBridgeError("Run: injected lost acknowledgement");
      if (hook === "malformed_after_effect") return { changes: { changes: "1" } };
      // The plugin's `run` answer on both platforms (iOS `runSQL`, Android
      // `runSQL`): the change count from `total_changes()`, the last row id and
      // any RETURNING values.
      return { changes: { changes, lastId: -1, values: [] } };
    },
    async query(statement: string, values: unknown[]): Promise<{ values?: unknown }> {
      if (!open) throw new PluginStatementError("Database not opened");
      if (faults.gate) await faults.gate({ kind: "query", statement, values });
      state.executed.push({ requested: statement, executed: [statement] });
      state.trace.push(`query:${statement}`);
      const override = faults.onQuery?.(statement, values);
      if (override && "reject" in override) throw new PluginBridgeError("Query: injected failure");
      if (override && "envelope" in override) return override.envelope as { values?: unknown };
      return { values: queryRows(state, activeRows(), statement, values) };
    },
  };

  /** A successful close: SQLite ends an open transaction without committing it. */
  function closeNow(): void {
    open = false;
    transactionRows = null;
  }

  return {
    state,
    faults,
    /** Whether the connection is inside a native transaction right now. Test
     * observation only; the adapter never sees it. */
    get transactionOpen(): boolean {
      return transactionRows !== null;
    },
    get connectionOpen(): boolean {
      return open;
    },
    engine: {
      // Returns the SAME connection object, open or not, exactly as nothing in
      // this layer would re-create it. A store that "reopens" after a failed
      // close therefore gets the old, still-open connection back — the hazard
      // the adapter's reopen boundary must not certify.
      async createConnection() {
        if (faults.gate) await faults.gate({ kind: "create" });
        state.trace.push("create");
        return connection;
      },
      // iOS `CapacitorSQLite.closeConnection`: closes the database if it is
      // open (which ends any transaction), then drops the dictionary entry.
      async closeConnection() {
        if (faults.closeConnectionRejects || faults.onCloseConnection?.() === "reject_before_effect") {
          throw new PluginBridgeError("CloseConnection: injected failure");
        }
        state.trace.push("release");
        closeNow();
      },
    },
  };
}
