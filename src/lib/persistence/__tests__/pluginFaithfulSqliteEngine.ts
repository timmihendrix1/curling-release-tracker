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
}

export interface PluginFaithfulEngineState {
  rows: Map<string, string>;
  /** Pragmas that actually reached the database. */
  pragmas: Map<string, string>;
  executed: ExecutedStatement[];
  openCount: number;
  closeCount: number;
  tables: Set<string>;
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

/** The tiny slice of SQL these tests need, applied to the in-memory state. */
function applyStatement(state: PluginFaithfulEngineState, sql: string, values: unknown[]): void {
  const statement = sql.trim().replace(/;$/, "").trim();
  if (statement.length === 0) {
    // `sqlite3_exec("")` succeeds and does nothing. This is the whole point of
    // the iOS regression: silence, not failure.
    return;
  }
  const upper = statement.toUpperCase();

  if (upper.startsWith("PRAGMA")) {
    const assignment = /^PRAGMA\s+(\w+)\s*=\s*(\S+)$/i.exec(statement);
    if (assignment) {
      state.pragmas.set(assignment[1].toLowerCase(), assignment[2].toUpperCase());
      return;
    }
    const read = /^PRAGMA\s+(\w+)$/i.exec(statement);
    if (read) return;
    throw new PluginStatementError("unsupported pragma");
  }

  if (upper.startsWith("CREATE TABLE")) {
    const name = /CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/i.exec(statement);
    if (!name) throw new PluginStatementError("unparseable CREATE TABLE");
    state.tables.add(name[1]);
    return;
  }

  if (upper.startsWith("INSERT INTO")) {
    if (values.length !== 2) throw new PluginStatementError("expected two bound values");
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    state.rows.set(String(values[0]), String(values[1]));
    return;
  }

  if (upper.startsWith("DELETE FROM")) {
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    if (upper.includes("WHERE")) {
      if (values.length !== 1) throw new PluginStatementError("expected one bound value");
      state.rows.delete(String(values[0]));
      return;
    }
    state.rows.clear();
    return;
  }

  throw new PluginStatementError("unsupported statement");
}

function queryRows(
  state: PluginFaithfulEngineState,
  sql: string,
  values: unknown[]
): Record<string, unknown>[] {
  const statement = sql.trim().replace(/;$/, "").trim();

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

  if (/^SELECT\s+value\s+FROM\s+records\s+WHERE\s+key\s*=\s*\?$/i.test(statement)) {
    if (!state.tables.has("records")) throw new PluginStatementError("no such table: records");
    const key = String(values[0]);
    if (!state.rows.has(key)) return [];
    return [{ value: state.rows.get(key) }];
  }

  throw new PluginStatementError("unsupported query");
}

export interface PluginFaithfulEngineOptions {
  platform: PluginPlatform;
  /** Shared rows, so one "device" can survive a simulated app restart. */
  state?: PluginFaithfulEngineState;
}

export function createPluginFaithfulEngineState(): PluginFaithfulEngineState {
  return {
    rows: new Map(),
    pragmas: new Map(),
    executed: [],
    openCount: 0,
    closeCount: 0,
    tables: new Set(),
  };
}

export function createPluginFaithfulEngine(options: PluginFaithfulEngineOptions) {
  const state = options.state ?? createPluginFaithfulEngineState();
  const platform = options.platform;
  let open = false;

  const connection = {
    async open(): Promise<void> {
      open = true;
      state.openCount += 1;
    },
    async close(): Promise<void> {
      open = false;
      state.closeCount += 1;
    },
    async execute(statements: string, transaction: boolean): Promise<unknown> {
      if (!open) throw new PluginStatementError("Database not opened");
      const executed: string[] = [];
      if (platform === "ios") {
        // Whole-string preprocessing, then ONE sqlite3_exec.
        const rewritten = iosPreprocessExecute(statements);
        executed.push(rewritten);
        for (const part of rewritten.split(";")) applyStatement(state, part, []);
      } else {
        for (let command of androidStatementsArray(statements)) {
          if (!command.endsWith(";")) command += ";";
          androidExecSqlGuard(command);
          executed.push(command);
          applyStatement(state, command, []);
        }
      }
      state.executed.push({ requested: statements, executed });
      void transaction;
      return {};
    },
    async run(statement: string, values: unknown[]): Promise<unknown> {
      if (!open) throw new PluginStatementError("Database not opened");
      // `run` goes through prepareSQL on both platforms — ONE compiled statement,
      // no splitting and no rewriting for a table without `sql_deleted`.
      state.executed.push({ requested: statement, executed: [statement] });
      applyStatement(state, statement, values);
      return {};
    },
    async query(statement: string, values: unknown[]): Promise<{ values?: unknown }> {
      if (!open) throw new PluginStatementError("Database not opened");
      state.executed.push({ requested: statement, executed: [statement] });
      return { values: queryRows(state, statement, values) };
    },
  };

  return {
    state,
    engine: {
      async createConnection() {
        return connection;
      },
      async closeConnection() {
        open = false;
      },
    },
  };
}
