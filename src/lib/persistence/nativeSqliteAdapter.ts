// The native SQLite `RemovableStorageAdapter` — Stage M3b.
//
// This module implements the EXISTING ADR-0013 persistence contract
// (`src/lib/persistence/types.ts`) over a key/value SQLite table.
//
// **Who selects it, and who does not.** Exactly two callers exist: the mobile
// storage-diagnostics panel under `mobile/src/diagnostics/`, which drives it
// against a dedicated SYNTHETIC database, and `storageComposition.ts`, which is
// the one owned production composition (Stage M3b3). Both reach it through a
// DYNAMIC import, so a bundle that composes no native store ships no SQLite at
// all, and `__tests__/architectureBoundary.test.ts` enforces that no other
// production module under `src/` imports it statically or otherwise.
//
// **Selecting it is not cutting over.** The composition is reachable only behind
// an off-by-default build flag AND only after a migration/activation authority
// supplies a valid ready verdict; the one production authority reports
// unavailable, so no shipped build mounts against this adapter. Production
// cutover is Stage M3b5 and has not happened — `localStorageAdapter` remains the
// production store on every platform (ADR-0049, docs/MOBILE_APP_MIGRATION.md
// Stage M3b).
//
// What this module deliberately does NOT do:
//   - no domain parsing, no migration, no activation record;
//   - no mutable "current Profile" pointer — a key is a key, exactly as the
//     Profile-scoped adapter namespace already supplies it;
//   - no public transaction contract. `RemovableStorageAdapter` still promises
//     no multi-key atomicity, and none is added here.
//
// Durability claims are bounded on purpose. A resolved `set` is the ENGINE'S
// acknowledgement of a committed statement; it is not a power-loss guarantee,
// and an immediate read-back proves nothing beyond the same process. See
// `NativeSqliteStore.readEffectiveSettings` for the pragmas actually in force.
import { detectRuntimePlatform, type RuntimePlatform } from "../platform/runtimePlatform";
import type {
  PersistenceReadError,
  PersistenceRemoveError,
  PersistenceRemoveResult,
  PersistenceWriteError,
  PersistenceWriteResult,
  RemovableStorageAdapter,
  StorageGetResult,
} from "./types";
import { removeFailed, removeOk, writeFailed, writeOk } from "./types";

/**
 * The one table this adapter ever touches. Two TEXT columns and nothing else —
 * there is no query workload anywhere in this application, so the schema is a
 * key/value store that happens to be backed by SQLite, not a relational model.
 */
export const NATIVE_SQLITE_RECORDS_TABLE = "records";

/** Bound-parameter statements. Keys and payloads are NEVER interpolated. */
const SELECT_VALUE_SQL = `SELECT value FROM ${NATIVE_SQLITE_RECORDS_TABLE} WHERE key = ?`;
const UPSERT_VALUE_SQL =
  `INSERT INTO ${NATIVE_SQLITE_RECORDS_TABLE} (key, value) VALUES (?, ?) ` +
  `ON CONFLICT(key) DO UPDATE SET value = excluded.value`;
const DELETE_VALUE_SQL = `DELETE FROM ${NATIVE_SQLITE_RECORDS_TABLE} WHERE key = ?;`;
const DELETE_ALL_SQL = `DELETE FROM ${NATIVE_SQLITE_RECORDS_TABLE};`;

/**
 * Two columns and nothing else — and in particular **neither `sql_deleted` nor
 * `last_modified`**. That is not cosmetic. Both platforms route every DELETE
 * through the plugin's `deleteSQL`, which rewrites it into a soft-delete UPDATE
 * when a table carries BOTH of those columns (iOS
 * `UtilsSQLCipher.swift` deleteSQL; Android `Database.java` deleteSQL, which
 * returns the statement unchanged via `if (!isLast || !isDel) return sqlStmt;`).
 * Adding either column would silently turn removal into a flag update, so the
 * schema is pinned by a test.
 */
const CREATE_TABLE_SQL =
  `CREATE TABLE IF NOT EXISTS ${NATIVE_SQLITE_RECORDS_TABLE} ` +
  `(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`;

/**
 * Durability settings, applied on every open as TWO SEPARATE SINGLE-STATEMENT
 * CALLS — never as one multi-statement string.
 *
 * Multi-statement batching is not portable through this plugin, and the failure
 * is silent on one platform and fatal on the other:
 *
 *   - Android's `UtilsSQLite.getStatementsArray` splits on `";\n"` — a semicolon
 *     followed by a NEWLINE. Two pragmas separated by `"; "` on one line are not
 *     split, and the joined string then reaches `SQLiteDatabase.execSQL`, which
 *     executes exactly one statement and rejects anything carrying more. The
 *     database never opens.
 *   - iOS `sqlite3_exec` would have run both, so the defect was invisible there.
 *
 * The call SHAPE differs per statement, matching what each one returns:
 *
 *   - `PRAGMA journal_mode = WAL` RETURNS the resulting mode, so it goes through
 *     `query` — which is a cursor read on Android and a prepared select on iOS,
 *     and which hands back what the engine actually settled on.
 *   - `PRAGMA synchronous = FULL` returns nothing, so it goes through `execute`
 *     outside a transaction. (`journal_mode` cannot be changed inside one at all.)
 *
 * `synchronous = FULL` is the strongest setting SQLite offers, chosen because
 * this store exists so that unsynchronised work survives and because write
 * volume here is trivial. Neither pragma is ASSUMED to have taken effect:
 * `readEffectiveSettings()` reads back what is actually in force.
 */
const SET_JOURNAL_MODE_SQL = "PRAGMA journal_mode = WAL;";
const SET_SYNCHRONOUS_SQL = "PRAGMA synchronous = FULL;";

/**
 * Fixed messages. A caught value from the plugin bridge may embed a statement,
 * a key, a payload fragment or a file path, so it is never inspected,
 * stringified, forwarded or logged — the same absolute rule
 * `localStorageAdapter`'s removal path already follows (ADR-0025 §G). These
 * strings say what failed and are safe to show.
 */
const READ_FAILED_MESSAGE = "The value could not be read from native storage.";
const WRITE_FAILED_MESSAGE = "The value could not be written to native storage.";
const REMOVAL_FAILED_MESSAGE = "The value could not be removed from native storage.";
/** Used for every shape of broken query response. Deliberately one message: which
 * part of the envelope was wrong is engine detail, and naming it would start
 * leaking the very content this module never reads. */
const UNREADABLE_RESULT_MESSAGE = "Native storage returned an unreadable result.";

/** Raised for every condition under which native storage is not usable at all —
 * an unsupported platform, a missing plugin, a database that will not open. It is
 * the ONLY input that produces `storage_unavailable`; everything else is an
 * operation failure, never absence. */
export class NativeStorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeStorageUnavailableError";
  }
}

/** Why a diagnostics-only control operation could not be completed. Deliberately
 * coarse: it never carries engine text. */
export type NativeSqliteFailureReason =
  | "platform_unsupported"
  | "engine_unavailable"
  | "operation_failed";

export type NativeSqliteControlResult =
  | { ok: true }
  | { ok: false; reason: NativeSqliteFailureReason };

/** The pragmas as the engine reports them back, not as this module asked for
 * them. `null` means the engine returned nothing readable for that pragma. */
export interface NativeSqliteEffectiveSettings {
  journalMode: string | null;
  synchronous: string | null;
  pageSize: string | null;
  sqliteVersion: string | null;
}

export type NativeSqliteSettingsResult =
  | { ok: true; settings: NativeSqliteEffectiveSettings }
  | { ok: false; reason: NativeSqliteFailureReason };

/** One row of a query result, as the bridge returns it. */
export type NativeSqliteRow = Record<string, unknown>;

export interface NativeSqliteQueryResult {
  values?: unknown;
}

/**
 * The narrow slice of a SQLite connection this adapter uses. Declared here — not
 * imported from the plugin — so the adapter's control flow is testable without a
 * native bridge, and so exactly one file (`capacitorSqliteEngine.ts`) ever names
 * the plugin package.
 */
export interface NativeSqliteConnection {
  open(): Promise<void>;
  close(): Promise<void>;
  /** `transaction: false` is required for statements SQLite refuses inside one
   * (`PRAGMA journal_mode`). */
  execute(statements: string, transaction: boolean): Promise<unknown>;
  run(statement: string, values: unknown[]): Promise<unknown>;
  query(statement: string, values: unknown[]): Promise<NativeSqliteQueryResult>;
}

export interface NativeSqliteEngine {
  createConnection(databaseName: string): Promise<NativeSqliteConnection>;
  /** Releases the engine's own handle on the database, after the connection
   * itself has been closed. */
  closeConnection(databaseName: string): Promise<void>;
}

export interface NativeSqliteStoreOptions {
  /** The database file this store owns. There is no default: every caller states
   * which database it means, so a diagnostic store can never silently address an
   * application database. */
  databaseName: string;
  /** Test seam. Production passes nothing and the real Capacitor plugin is
   * loaded lazily on first use. */
  engine?: NativeSqliteEngine;
  /** Test seam for the trusted platform signal (ADR-0047). */
  detectPlatform?: () => RuntimePlatform;
}

/**
 * The connection's owner. `adapter` is the ordinary persistence contract; the
 * remaining methods are lifecycle and diagnostics operations that deliberately
 * live OUTSIDE `RemovableStorageAdapter`, so the interface every repository
 * depends on gains nothing.
 */
export interface NativeSqliteStore {
  readonly databaseName: string;
  readonly adapter: RemovableStorageAdapter;
  /** Reads the pragmas actually in force. Opens the database if it is closed. */
  readEffectiveSettings(): Promise<NativeSqliteSettingsResult>;
  /** Closes the connection. Queued like every other operation, so it can never
   * run underneath a pending read, write or removal. A later operation reopens. */
  close(): Promise<NativeSqliteControlResult>;
  /** Deletes every row of THIS store's own table. Diagnostics cleanup only. */
  deleteAllRecords(): Promise<NativeSqliteControlResult>;
}

/** `instanceof` can itself throw (a Proxy with a hostile `getPrototypeOf`), so
 * the determination is contained. A failure to classify is never reported as
 * "storage unavailable" — the honest answer is the generic operation failure. */
function isUnavailable(error: unknown): boolean {
  try {
    return error instanceof NativeStorageUnavailableError;
  } catch {
    return false;
  }
}

function classifyReadError(error: unknown): PersistenceReadError {
  return isUnavailable(error)
    ? { kind: "storage_unavailable" }
    : { kind: "unknown", message: READ_FAILED_MESSAGE };
}

function classifyWriteError(error: unknown): PersistenceWriteError {
  // No `quota_exceeded` branch exists, and that is deliberate. Recognising a
  // full disk would mean parsing the engine's error text, which this module
  // never does. Claiming a wrong cause is worse than reporting an honest
  // unknown failure; either way the write did not happen.
  return isUnavailable(error)
    ? { kind: "storage_unavailable" }
    : { kind: "unknown", message: WRITE_FAILED_MESSAGE };
}

function classifyRemoveError(error: unknown): PersistenceRemoveError {
  return isUnavailable(error)
    ? { kind: "storage_unavailable" }
    : { kind: "removal_failed", message: REMOVAL_FAILED_MESSAGE };
}

function classifyControlFailure(
  error: unknown,
  platformFailed: boolean
): NativeSqliteFailureReason {
  if (platformFailed) return "platform_unsupported";
  return isUnavailable(error) ? "engine_unavailable" : "operation_failed";
}

function readFailure(error: PersistenceReadError): StorageGetResult {
  return { status: "read_failed", fallback: null, error };
}

/**
 * The response contract the installed plugin establishes, and the ONLY shape this
 * adapter accepts: `{ values: [...] }`, where each element is a plain object keyed
 * by column name. iOS builds that in `Database.swift`'s `selectSQL` (the JS
 * wrapper's `reorderRows` having already removed the `ios_columns` header row);
 * Android builds one `JSObject` per cursor row in `Database.java`'s `selectSQL`.
 *
 * **A broken envelope is not an empty table.** Returning `[]` for a malformed
 * response — which is what an earlier, filtering implementation did — turns a
 * storage fault into a successful absence, and a successful absence is precisely
 * what authorises a hydrating repository to write its default over data that still
 * exists. Every shape below therefore fails closed instead.
 *
 * Reading any property here can itself throw (a hostile or proxied response), so
 * the whole inspection is contained and a thrown value is discarded unread.
 */
type QueryEnvelope =
  | { kind: "rows"; rows: NativeSqliteRow[] }
  | { kind: "malformed" };

function readEnvelope(result: unknown): QueryEnvelope {
  try {
    if (result === null || typeof result !== "object") return { kind: "malformed" };
    const values = (result as { values?: unknown }).values;
    if (!Array.isArray(values)) return { kind: "malformed" };
    const rows: NativeSqliteRow[] = [];
    for (const candidate of values) {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
        return { kind: "malformed" };
      }
      rows.push(candidate as NativeSqliteRow);
    }
    return { kind: "rows", rows };
  } catch {
    return { kind: "malformed" };
  }
}

/** What a single-key read resolved to. `absent` is reachable ONLY from a valid,
 * genuinely empty result. */
type StoredColumn =
  | { kind: "value"; value: string }
  | { kind: "absent" }
  | { kind: "malformed" };

function readStoredColumn(result: unknown, column: string): StoredColumn {
  const envelope = readEnvelope(result);
  if (envelope.kind === "malformed") return { kind: "malformed" };
  if (envelope.rows.length === 0) return { kind: "absent" };
  // `key` is the table's PRIMARY KEY, so a second row cannot exist. If one
  // appears, the response is not describing this table and is not trusted.
  if (envelope.rows.length > 1) return { kind: "malformed" };
  try {
    const stored = envelope.rows[0][column];
    // An empty string is a stored value and must survive; anything that is not a
    // string is a record this adapter did not write.
    if (typeof stored !== "string") return { kind: "malformed" };
    return { kind: "value", value: stored };
  } catch {
    return { kind: "malformed" };
  }
}

/**
 * The diagnostics-only reader for a PRAGMA result. Deliberately more permissive
 * than `readStoredColumn` in one direction and not the other: a valid but empty
 * result is reported as "unreported" rather than as a failure, because not every
 * pragma returns a row, while a MALFORMED envelope is still a failure.
 */
type SettingRead = { ok: true; value: string | null } | { ok: false };

function readScalarSetting(result: unknown): SettingRead {
  const envelope = readEnvelope(result);
  if (envelope.kind === "malformed") return { ok: false };
  if (envelope.rows.length === 0) return { ok: true, value: null };
  try {
    const columns = Object.values(envelope.rows[0]);
    if (columns.length === 0) return { ok: true, value: null };
    const value = columns[0];
    if (typeof value === "string") return { ok: true, value };
    if (typeof value === "number" || typeof value === "bigint") {
      return { ok: true, value: String(value) };
    }
    return { ok: true, value: null };
  } catch {
    return { ok: false };
  }
}

/**
 * Loads the real Capacitor plugin binding. Kept behind a dynamic import so that
 * merely importing this module — which the type-checker and the Web build both
 * do — never pulls the plugin, and so no bundle that does not actually construct
 * a native store ships a SQLite implementation. There is no Web SQLite/WASM
 * deployment anywhere in this repository.
 */
async function loadDefaultEngine(): Promise<NativeSqliteEngine> {
  try {
    const binding = await import("./capacitorSqliteEngine");
    return binding.createCapacitorSqliteEngine();
  } catch {
    throw new NativeStorageUnavailableError("The native SQLite plugin is not available.");
  }
}

/**
 * Creates a native SQLite store.
 *
 * **Nothing is opened here.** The database opens on the first operation, so
 * constructing a store is inert — importable and constructible on the Web, under
 * Next's server rendering and in tests, where it simply fails closed.
 *
 * **Ownership and ordering.** Every public operation — reads, writes, removals,
 * `close()`, `deleteAllRecords()` and `readEffectiveSettings()` — goes through
 * ONE FIFO queue. That gives three properties the contract depends on:
 *
 *   1. concurrent callers observe a deterministic order (the order they called in);
 *   2. `close()` can never run underneath a pending operation, because it is
 *      itself queued behind them;
 *   3. a failed operation cannot strand later ones — the queue's tail is always
 *      resolved, never rejected, so the next task runs regardless.
 *
 * A failed OPEN additionally leaves the store closed rather than caching the
 * failure, so the next operation retries honestly instead of inheriting a dead
 * verdict for the rest of the session.
 */
export function createNativeSqliteStore(
  options: NativeSqliteStoreOptions
): NativeSqliteStore {
  const { databaseName } = options;
  const detectPlatform = options.detectPlatform ?? detectRuntimePlatform;
  const injectedEngine = options.engine;

  let engine: NativeSqliteEngine | null = injectedEngine ?? null;
  let connection: NativeSqliteConnection | null = null;
  // Always fulfilled, never rejected — see property 3 above.
  let tail: Promise<void> = Promise.resolve();
  // Set by `ensureConnection` when the trusted platform signal, not the engine,
  // is what refused. Read only by the control operations, which report a reason
  // rather than a persistence error.
  let lastFailureWasPlatform = false;

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task, task);
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  async function resolveEngine(): Promise<NativeSqliteEngine> {
    if (engine) return engine;
    const loaded = await loadDefaultEngine();
    engine = loaded;
    return loaded;
  }

  async function ensureConnection(): Promise<NativeSqliteConnection> {
    if (connection) return connection;
    lastFailureWasPlatform = false;

    let platform: RuntimePlatform;
    try {
      platform = detectPlatform();
    } catch {
      // A platform signal that throws must not be read as "we are on the Web".
      platform = "unsupported_native";
    }
    if (platform !== "ios" && platform !== "android") {
      lastFailureWasPlatform = true;
      throw new NativeStorageUnavailableError(
        "Native storage is unavailable on this platform."
      );
    }

    const resolved = await resolveEngine();
    let opened: NativeSqliteConnection | null = null;
    try {
      opened = await resolved.createConnection(databaseName);
      await opened.open();
      // Pragmas first, outside a transaction, ONE STATEMENT PER CALL — see the
      // note on the constants. `journal_mode` returns its resulting value, so it
      // goes through `query`; `synchronous` returns nothing, so it goes through
      // `execute`. Then the schema.
      await opened.query(SET_JOURNAL_MODE_SQL, []);
      await opened.execute(SET_SYNCHRONOUS_SQL, false);
      await opened.execute(CREATE_TABLE_SQL, true);
    } catch {
      // A half-opened connection must not be left behind for the next attempt to
      // trip over. Best effort: a failing cleanup never replaces the real cause.
      if (opened !== null) {
        try {
          await opened.close();
        } catch {
          /* ignored — the open failure below is the reportable outcome */
        }
      }
      try {
        await resolved.closeConnection(databaseName);
      } catch {
        /* ignored — as above */
      }
      throw new NativeStorageUnavailableError(
        "The native storage database could not be opened."
      );
    }
    connection = opened;
    return opened;
  }

  async function getTask(key: string): Promise<StorageGetResult> {
    try {
      const open = await ensureConnection();
      const result = await open.query(SELECT_VALUE_SQL, [key]);
      const stored = readStoredColumn(result, "value");
      if (stored.kind === "malformed") {
        // Not absence. A response this adapter cannot read says nothing about
        // whether the key exists, and reporting absence would invite hydration to
        // write a default over data that is still there.
        return readFailure({ kind: "unknown", message: UNREADABLE_RESULT_MESSAGE });
      }
      // A valid, genuinely empty result — the ONLY path that produces absence.
      if (stored.kind === "absent") return { status: "value", value: null };
      return { status: "value", value: stored.value };
    } catch (error) {
      return readFailure(classifyReadError(error));
    }
  }

  async function setTask(key: string, value: string): Promise<PersistenceWriteResult> {
    try {
      const open = await ensureConnection();
      await open.run(UPSERT_VALUE_SQL, [key, value]);
      return writeOk();
    } catch (error) {
      return writeFailed(classifyWriteError(error));
    }
  }

  async function removeTask(key: string): Promise<PersistenceRemoveResult> {
    try {
      const open = await ensureConnection();
      // Removing a key that is not there is a success, exactly as it is for
      // `localStorage.removeItem`. A caller that needs to know whether something
      // WAS there reads first.
      await open.run(DELETE_VALUE_SQL, [key]);
      return removeOk();
    } catch (error) {
      return removeFailed(classifyRemoveError(error));
    }
  }

  const adapter: RemovableStorageAdapter = {
    get(key: string): Promise<StorageGetResult> {
      // The outer catch covers the unreachable case that the queue machinery or
      // a classifier itself throws. A public method never rejects.
      return enqueue(() => getTask(key)).catch(() =>
        readFailure({ kind: "unknown", message: READ_FAILED_MESSAGE })
      );
    },
    set(key: string, value: string): Promise<PersistenceWriteResult> {
      return enqueue(() => setTask(key, value)).catch(() =>
        writeFailed({ kind: "unknown", message: WRITE_FAILED_MESSAGE })
      );
    },
    remove(key: string): Promise<PersistenceRemoveResult> {
      return enqueue(() => removeTask(key)).catch(() =>
        removeFailed({ kind: "removal_failed", message: REMOVAL_FAILED_MESSAGE })
      );
    },
  };

  async function settingsTask(): Promise<NativeSqliteSettingsResult> {
    try {
      const open = await ensureConnection();
      // Sequential, not `Promise.all`. This store's whole ownership claim is
      // that one connection is used by one operation at a time; issuing four
      // concurrent statements over the same handle here would contradict it for
      // no benefit.
      const reads = [
        readScalarSetting(await open.query("PRAGMA journal_mode;", [])),
        readScalarSetting(await open.query("PRAGMA synchronous;", [])),
        readScalarSetting(await open.query("PRAGMA page_size;", [])),
        readScalarSetting(await open.query("SELECT sqlite_version() AS version;", [])),
      ];
      // A malformed envelope is a failure, not an "unreported" setting. Only a
      // valid empty result reports `null`.
      if (reads.some((read) => !read.ok)) return { ok: false, reason: "operation_failed" };
      const [journal, sync, page, version] = reads.map((read) =>
        read.ok ? read.value : null
      );
      return {
        ok: true,
        settings: {
          journalMode: journal,
          synchronous: sync,
          pageSize: page,
          sqliteVersion: version,
        },
      };
    } catch (error) {
      return { ok: false, reason: classifyControlFailure(error, lastFailureWasPlatform) };
    }
  }

  async function closeTask(): Promise<NativeSqliteControlResult> {
    const open = connection;
    // Cleared before awaiting anything, so a concurrent caller queued behind
    // this one reopens rather than reusing a handle that is being torn down.
    connection = null;
    if (open === null) {
      // Nothing this owner opened. Not an error: closing a closed store is a
      // no-op, and the next operation opens again.
      return { ok: true };
    }
    try {
      await open.close();
      if (engine) await engine.closeConnection(databaseName);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: classifyControlFailure(error, false) };
    }
  }

  async function deleteAllTask(): Promise<NativeSqliteControlResult> {
    try {
      const open = await ensureConnection();
      // `run`, NOT `execute`. iOS's `execute` preprocesses any SQL containing
      // "DELETE FROM" by splitting on ";" and dropping the last component, so an
      // unqualified bulk delete could be rewritten into the empty string —
      // `sqlite3_exec` then succeeds and deletes nothing, and cleanup reports
      // success over records that are still present. `run` compiles one statement
      // through `prepareSQL` on both platforms with no such rewriting.
      await open.run(DELETE_ALL_SQL, []);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: classifyControlFailure(error, lastFailureWasPlatform) };
    }
  }

  return {
    databaseName,
    adapter,
    readEffectiveSettings: () =>
      enqueue(settingsTask).catch(() => ({ ok: false, reason: "operation_failed" as const })),
    close: () =>
      enqueue(closeTask).catch(() => ({ ok: false, reason: "operation_failed" as const })),
    deleteAllRecords: () =>
      enqueue(deleteAllTask).catch(() => ({ ok: false, reason: "operation_failed" as const })),
  };
}
