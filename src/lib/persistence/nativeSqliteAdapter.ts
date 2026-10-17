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
 * DIAGNOSTICS ONLY — a statement that is MEANT to fail, inside an owned
 * transaction, so that "a statement failed" can be exercised and reported as
 * exactly that.
 *
 * It is a fixed statement in this module, never caller-supplied SQL: the
 * diagnostics surface can ask for a deliberate failure, it cannot say what the
 * failure is. `value` is declared `TEXT NOT NULL`, so binding the key and
 * inserting a literal NULL into `value` is a genuine SQLite constraint
 * violation on a real engine — not a simulated rejection and not an error the
 * bridge was told to invent. The key is still BOUND rather than interpolated.
 */
const DIAGNOSTIC_FAILING_INSERT_SQL =
  `INSERT INTO ${NATIVE_SQLITE_RECORDS_TABLE} (key, value) VALUES (?, NULL)`;

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
/**
 * Returned to an ORDINARY caller that arrives while a diagnostics-only owned
 * transaction is pending. The operation is refused outright rather than queued
 * behind the transaction, because joining the queue would mean executing inside
 * someone else's transaction — committing with it, or vanishing with its
 * rollback. In a production build this is unreachable: no production module
 * opens an owned transaction.
 */
const TRANSACTION_PENDING_MESSAGE =
  "Native storage is held by a diagnostic transaction and refused this operation.";

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

/* ==========================================================================
 * The diagnostics-only owned transaction
 * ==========================================================================
 *
 * This section exists so that Stage M3b4's checkpoint model — a batch of rows
 * and its progress record committed TOGETHER — can be exercised and observed
 * before it is implemented. It is deliberately not a general transaction API:
 *
 *   - it is not on `RemovableStorageAdapter`, so no repository can reach it;
 *   - no production module calls it (asserted by
 *     `__tests__/architectureBoundary.test.ts`);
 *   - it accepts key/value pairs, never caller-supplied SQL;
 *   - while one is pending, EVERY other operation on this store — reads,
 *     writes, removals, settings, cleanup and `close()` — is refused rather
 *     than queued, so a transaction can never overlap anything else and a
 *     statement can never escape into the ordinary queue and commit separately.
 *
 * What it does NOT establish: a resolved `commit` is the engine's
 * acknowledgement, not proof that bytes reached stable storage, and a REJECTED
 * commit is not proof of rollback. Only reading a freshly reopened store can
 * classify an attempt, which is why the diagnostics layer classifies by reading
 * and never by the value below. */

/** Identifies one owned transaction. Held by the caller that opened it; an
 * operation carrying a different token is refused, so a stale handle from an
 * earlier attempt can never resolve the current one. */
export interface DiagnosticTransactionToken {
  readonly id: string;
}

/** Why a transaction-scoped call was refused without touching the database. */
export type DiagnosticTransactionRefusal =
  /** Another owned transaction is already pending on this store. */
  | "transaction_pending"
  /** No owned transaction is open. */
  | "no_pending_transaction"
  /** A token from a different transaction. */
  | "wrong_transaction"
  /** The owned transaction's native state is UNKNOWN (see
   * `DiagnosticTransactionPhase`). Nothing may be staged into it or committed
   * from it; only a rollback or an abandon can resolve it. */
  | "transaction_uncertain";

/**
 * The owner's view of its one diagnostics transaction.
 *
 *   - `none` — no transaction is owned. Ordinary operations run.
 *   - `open` — BEGIN was positively acknowledged and nothing has failed since.
 *     The transaction exists and is uncommitted.
 *   - `uncertain` — something in the transaction's lifecycle failed or returned
 *     an unreadable acknowledgement (BEGIN, a statement's cleanup, COMMIT's
 *     cleanup, ROLLBACK, the connection close or the native handle release), so
 *     whether a native transaction is still open is NOT KNOWN.
 *
 * Both non-`none` phases refuse every ordinary operation. `uncertain` is never
 * cleared by assumption: only a positively acknowledged ROLLBACK, or a connection
 * close AND native handle release that both succeed, end it.
 */
export type DiagnosticTransactionPhase = "none" | "open" | "uncertain";

/**
 * What happened to the transaction after a failure, so the caller knows whether
 * the connection is free again.
 *
 * `rollback_failed` leaves the transaction owned in the `uncertain` phase: the
 * engine would not end it (or its answer was unreadable), so this store keeps
 * refusing everything else until the caller resolves it. Neither value is
 * evidence about what was or was not committed.
 */
export type DiagnosticTransactionCleanup = "rolled_back" | "rollback_failed";

export type DiagnosticTransactionBeginResult =
  | { ok: true; token: DiagnosticTransactionToken }
  | { ok: false; reason: NativeSqliteFailureReason | "transaction_pending" }
  /**
   * BEGIN was ISSUED but not positively acknowledged — it rejected, or resolved
   * with something other than the plugin's acknowledgement envelope. That does
   * not prove that no transaction exists (BEGIN may have taken effect and the
   * answer been lost), so the store now OWNS an `uncertain` transaction under
   * `token` and refuses ordinary work until the caller resolves it.
   */
  | { ok: false; reason: "begin_unacknowledged"; token: DiagnosticTransactionToken };

export type DiagnosticTransactionStageResult =
  | { ok: true }
  | { ok: false; reason: "statement_failed"; cleanup: DiagnosticTransactionCleanup }
  /**
   * The statement that was supposed to violate `value TEXT NOT NULL` was
   * ACCEPTED. Reported distinctly rather than folded into `statement_failed`,
   * because an engine that does not enforce the constraint is a finding about
   * the engine — and reporting it as an ordinary failure would hide it behind a
   * result that looks like the expected one.
   */
  | { ok: false; reason: "statement_unexpectedly_succeeded"; cleanup: DiagnosticTransactionCleanup }
  | { ok: false; reason: DiagnosticTransactionRefusal };

/**
 * `commit_rejected` means the engine rejected the `COMMIT`. It is **not** proof
 * that nothing was committed — SQLite may have committed and failed afterwards,
 * and the bridge may have lost the answer. The caller must classify by reading a
 * freshly reopened store, never by this value.
 */
export type DiagnosticTransactionCommitResult =
  | { ok: true }
  | { ok: false; reason: "commit_rejected"; cleanup: DiagnosticTransactionCleanup }
  | { ok: false; reason: DiagnosticTransactionRefusal };

/** An explicit ROLLBACK. `rollback_failed` leaves the transaction owned and
 * `uncertain`. */
export type DiagnosticTransactionRollbackResult =
  | { ok: true }
  | { ok: false; reason: "rollback_failed" }
  | {
      ok: false;
      reason: Exclude<DiagnosticTransactionRefusal, "transaction_uncertain">;
    };

/**
 * Where a lifecycle step failed. Named so a caller can say exactly which
 * boundary was NOT established, rather than "something went wrong".
 *
 *   - `refused` — the store owns a transaction and will not cycle the connection.
 *   - `close` — the connection's own close rejected.
 *   - `release` — the engine's native handle release rejected.
 *   - `open` — a fresh connection could not be opened.
 */
export type NativeSqliteLifecycleBoundary = "refused" | "close" | "release" | "open";

/**
 * The outcome of deliberately closing, releasing and reopening the connection.
 * `ok: true` means a FRESH connection was positively opened after the previous
 * one was closed and its native handle released — the only state in which a
 * following read is reopen evidence.
 */
export type NativeSqliteReopenResult =
  | { ok: true }
  | { ok: false; boundary: NativeSqliteLifecycleBoundary; reason: NativeSqliteFailureReason };

/** Abandoning a transaction. On failure the store still OWNS it in the
 * `uncertain` phase, and `boundary` says which step did not complete. */
export type DiagnosticTransactionAbandonResult =
  | { ok: true }
  | { ok: false; reason: "wrong_transaction" | "no_pending_transaction" }
  | {
      ok: false;
      reason: "abandon_incomplete";
      boundary: Exclude<NativeSqliteLifecycleBoundary, "refused" | "open">;
    };

/** One synthetic row staged inside an owned transaction. */
export interface DiagnosticTransactionEntry {
  key: string;
  value: string;
}

/** The store's private record of the one owned transaction. */
interface OwnedDiagnosticTransaction {
  token: DiagnosticTransactionToken;
  phase: Exclude<DiagnosticTransactionPhase, "none">;
  /** Set once abandon has closed the connection but the native handle release
   * has not yet succeeded, so a retry resumes at the release. */
  closedPendingRelease: boolean;
}

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
  /**
   * `transaction` is REQUIRED, not optional, and that is the point.
   *
   * The plugin's own `run` defaults it to `true`, which wraps the statement in
   * its own `BEGIN`/`COMMIT`. Inside a transaction this module already owns,
   * that default is wrong twice over — SQLite rejects the nested `BEGIN`, and a
   * `COMMIT` that did slip through would end the owned transaction early and
   * commit a partial checkpoint. Making the flag mandatory means no call site
   * can inherit the default by omission.
   */
  run(statement: string, values: unknown[], transaction: boolean): Promise<unknown>;
  query(statement: string, values: unknown[]): Promise<NativeSqliteQueryResult>;
  /**
   * The explicit transaction primitives, used ONLY by this module's
   * diagnostics-only transaction owner. They are deliberately absent from
   * `RemovableStorageAdapter`: that contract still promises no multi-key
   * atomicity, and nothing in the repository layer can reach these.
   */
  beginTransaction(): Promise<unknown>;
  commitTransaction(): Promise<unknown>;
  rollbackTransaction(): Promise<unknown>;
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
  /** Deletes every row of THIS store's own table. Diagnostics cleanup only.
   * Refused while an owned transaction is pending. */
  deleteAllRecords(): Promise<NativeSqliteControlResult>;

  /* --- The diagnostics-only owned transaction. No production caller. --- */

  /** Opens one owned transaction. Refused if one is already pending. */
  beginDiagnosticTransaction(): Promise<DiagnosticTransactionBeginResult>;
  /** Writes synthetic rows INSIDE the owned transaction, with the plugin's
   * per-statement transaction flag explicitly off. On a statement failure the
   * transaction is rolled back and the result says so. */
  stageDiagnosticWrites(
    token: DiagnosticTransactionToken,
    entries: readonly DiagnosticTransactionEntry[]
  ): Promise<DiagnosticTransactionStageResult>;
  /** Issues a statement that is MEANT to fail, inside the owned transaction, so
   * that statement-failure handling can be exercised. The SQL is fixed in this
   * module; the caller supplies only the bound key. */
  stageDiagnosticFailingStatement(
    token: DiagnosticTransactionToken,
    key: string
  ): Promise<DiagnosticTransactionStageResult>;
  /** Commits the owned transaction. A rejection is NOT proof of rollback. */
  commitDiagnosticTransaction(
    token: DiagnosticTransactionToken
  ): Promise<DiagnosticTransactionCommitResult>;
  /** Rolls the owned transaction back explicitly. Accepted in both the `open`
   * and the `uncertain` phase; only a positively acknowledged ROLLBACK ends
   * ownership. */
  rollbackDiagnosticTransaction(
    token: DiagnosticTransactionToken
  ): Promise<DiagnosticTransactionRollbackResult>;
  /**
   * The escape hatch for a transaction that could not be ended cleanly:
   * best-effort rollback, then close the connection, then release the engine's
   * native handle. Closing discards an open transaction at the engine, so this
   * can only ever lose UNCOMMITTED synthetic work.
   *
   * Ownership is released ONLY when the close and the release both succeed. If
   * either fails the store keeps owning the transaction in the `uncertain`
   * phase, keeps refusing ordinary work, and the caller may retry (a retry
   * resumes at the step that failed) or start a new document.
   */
  abandonDiagnosticTransaction(
    token: DiagnosticTransactionToken
  ): Promise<DiagnosticTransactionAbandonResult>;
  /** Whether an owned transaction exists in either phase, for a UI that must
   * show it. Reads local state only and touches no database. */
  hasPendingDiagnosticTransaction(): boolean;
  /** The owned transaction's phase. Reads local state only. */
  diagnosticTransactionState(): DiagnosticTransactionPhase;
  /**
   * DIAGNOSTICS ONLY. Closes the connection, releases the engine's native handle
   * and opens a fresh connection, reporting which boundary failed if any. Queued
   * like every other operation and refused while a transaction is owned.
   *
   * `close()` alone does not establish reopen evidence: it cannot say whether
   * the NEXT operation reopened, and a failed close silently drops the handle.
   */
  reopenDiagnosticConnection(): Promise<NativeSqliteReopenResult>;
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

/**
 * Whether a BEGIN/COMMIT/ROLLBACK result is the plugin's positive
 * acknowledgement.
 *
 * The installed 8.1.1 plugin resolves all three with `{ changes: { changes: 0 } }`
 * on both platforms: iOS `CapacitorSQLite.beginTransaction` (and siblings)
 * returns `["changes": res]` with `res` the `Int` 0 from `Database.swift`, which
 * `ReturnHandler.rChanges` wraps as `["changes": ret]`; Android
 * `CapacitorSQLite.beginTransaction` returns a `JSObject` with `changes` set to
 * the `Integer` 0 from `Database.java`, which `RetHandler.retChanges` wraps the
 * same way. A failure is a REJECTION (`changes: -1` only ever travels with a
 * reject message), so a resolved negative count is not a shape the plugin
 * produces either.
 *
 * Anything else is not an acknowledgement. In particular it is never read as
 * "the transition happened" — a lifecycle step whose answer cannot be read is a
 * step whose outcome is unknown. Contained, because property reads on a hostile
 * value can throw.
 */
function isTransactionAcknowledgement(result: unknown): boolean {
  try {
    if (result === null || typeof result !== "object" || Array.isArray(result)) return false;
    const outer = (result as { changes?: unknown }).changes;
    if (outer === null || typeof outer !== "object" || Array.isArray(outer)) return false;
    const count = (outer as { changes?: unknown }).changes;
    return typeof count === "number" && Number.isInteger(count) && count >= 0;
  } catch {
    return false;
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
  /**
   * The one owned diagnostics transaction, or `null`.
   *
   * While it is non-null EVERY other task refuses as its first act. The refusal
   * happens when the task RUNS, not when it is queued, so a caller is never
   * blocked indefinitely behind a transaction a human has not resolved yet — it
   * gets a prompt, honest refusal instead.
   */
  let pendingTransaction: OwnedDiagnosticTransaction | null = null;
  /**
   * Set when an ORDINARY `close()` failed part-way. `close()` drops its handle
   * regardless (so the next operation reopens), but the native side may still
   * hold the old connection; `reopenDiagnosticConnection` releases it before it
   * will call a connection fresh.
   */
  let staleNativeHandle = false;

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
    // A read issued inside someone else's open transaction would see that
    // transaction's UNCOMMITTED rows on this same connection, which is the
    // single most misleading observation this store could produce.
    if (pendingTransaction !== null) {
      return readFailure({ kind: "unknown", message: TRANSACTION_PENDING_MESSAGE });
    }
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
    if (pendingTransaction !== null) {
      return writeFailed({ kind: "unknown", message: TRANSACTION_PENDING_MESSAGE });
    }
    try {
      const open = await ensureConnection();
      // `transaction: true` — the ordinary, unchanged behaviour: this one
      // statement is its own transaction, exactly as the plugin's default would
      // have made it. It is spelled out because the flag is now mandatory.
      await open.run(UPSERT_VALUE_SQL, [key, value], true);
      return writeOk();
    } catch (error) {
      return writeFailed(classifyWriteError(error));
    }
  }

  async function removeTask(key: string): Promise<PersistenceRemoveResult> {
    if (pendingTransaction !== null) {
      return removeFailed({ kind: "removal_failed", message: TRANSACTION_PENDING_MESSAGE });
    }
    try {
      const open = await ensureConnection();
      // Removing a key that is not there is a success, exactly as it is for
      // `localStorage.removeItem`. A caller that needs to know whether something
      // WAS there reads first.
      await open.run(DELETE_VALUE_SQL, [key], true);
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
    if (pendingTransaction !== null) return { ok: false, reason: "operation_failed" };
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
    // Closing underneath an open transaction would silently discard it and
    // leave the caller unable to say whether anything committed. The owner
    // resolves it first, or abandons it deliberately.
    if (pendingTransaction !== null) return { ok: false, reason: "operation_failed" };
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
      staleNativeHandle = false;
      return { ok: true };
    } catch (error) {
      staleNativeHandle = true;
      return { ok: false, reason: classifyControlFailure(error, false) };
    }
  }

  /**
   * Close → release → open, each step's failure named. A connection is only
   * called FRESH when all three succeeded, because a read after any failure may
   * still be served by the old connection (or the old native handle) and is
   * therefore not reopen evidence.
   */
  async function reopenTask(): Promise<NativeSqliteReopenResult> {
    if (pendingTransaction !== null) {
      return { ok: false, boundary: "refused", reason: "operation_failed" };
    }
    const open = connection;
    if (open !== null) {
      try {
        await open.close();
      } catch (error) {
        // The handle is kept: it may still be open, and pretending otherwise is
        // exactly how a later read would be mistaken for a reopened one.
        return { ok: false, boundary: "close", reason: classifyControlFailure(error, false) };
      }
      connection = null;
      staleNativeHandle = true;
    }
    if (staleNativeHandle) {
      try {
        if (engine) await engine.closeConnection(databaseName);
        staleNativeHandle = false;
      } catch (error) {
        return { ok: false, boundary: "release", reason: classifyControlFailure(error, false) };
      }
    }
    try {
      await ensureConnection();
    } catch (error) {
      return {
        ok: false,
        boundary: "open",
        reason: classifyControlFailure(error, lastFailureWasPlatform),
      };
    }
    return { ok: true };
  }

  async function deleteAllTask(): Promise<NativeSqliteControlResult> {
    // Cleanup during a pending or unresolved transaction could destroy the very
    // evidence an interrupted attempt is about to be judged on.
    if (pendingTransaction !== null) return { ok: false, reason: "operation_failed" };
    try {
      const open = await ensureConnection();
      // `run`, NOT `execute`. iOS's `execute` preprocesses any SQL containing
      // "DELETE FROM" by splitting on ";" and dropping the last component, so an
      // unqualified bulk delete could be rewritten into the empty string —
      // `sqlite3_exec` then succeeds and deletes nothing, and cleanup reports
      // success over records that are still present. `run` compiles one statement
      // through `prepareSQL` on both platforms with no such rewriting.
      await open.run(DELETE_ALL_SQL, [], true);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: classifyControlFailure(error, lastFailureWasPlatform) };
    }
  }

  /* ------------------------------------------------------------------
   * The diagnostics-only owned transaction.
   *
   * Every one of these runs as a SINGLE queued task, so a transaction's own
   * statements are never interleaved with anything else. Between tasks the
   * transaction stays open at the engine and `pendingTransaction` refuses all
   * other work — which is what makes the "prepared but uncommitted" state of
   * an interruption rehearsal observable at all.
   * ------------------------------------------------------------------ */

  let nextTransactionOrdinal = 0;

  /** Confirms the caller owns the pending transaction before anything touches
   * the database. A stale token from an earlier attempt resolves nothing. */
  function checkToken(
    token: DiagnosticTransactionToken
  ): "no_pending_transaction" | "wrong_transaction" | null {
    if (pendingTransaction === null) return "no_pending_transaction";
    if (pendingTransaction.token.id !== token.id) return "wrong_transaction";
    return null;
  }

  /** Statements and COMMIT are only ever issued into a transaction whose BEGIN
   * was positively acknowledged and which nothing has disturbed since. */
  function checkUsableToken(
    token: DiagnosticTransactionToken
  ): DiagnosticTransactionRefusal | null {
    const refusal = checkToken(token);
    if (refusal) return refusal;
    if (pendingTransaction?.phase !== "open") return "transaction_uncertain";
    return null;
  }

  /** Records that the owned transaction's native state is no longer known. The
   * token, and therefore ownership, is kept. */
  function markUncertain(): void {
    if (pendingTransaction !== null) pendingTransaction.phase = "uncertain";
  }

  /**
   * Best-effort ROLLBACK after a failure inside the transaction.
   *
   * Ownership ends ONLY on a positively acknowledged ROLLBACK. A rejection, or a
   * result that is not the plugin's acknowledgement, leaves the transaction owned
   * and `uncertain`, so every other operation keeps being refused until the
   * owner resolves it. Silently clearing it here would hand the next caller a
   * connection that may be sitting inside an open transaction.
   */
  async function rollbackAfterFailure(
    open: NativeSqliteConnection
  ): Promise<DiagnosticTransactionCleanup> {
    try {
      const result = await open.rollbackTransaction();
      if (isTransactionAcknowledgement(result)) {
        pendingTransaction = null;
        return "rolled_back";
      }
    } catch {
      /* falls through to the uncertain outcome below */
    }
    markUncertain();
    return "rollback_failed";
  }

  async function beginTransactionTask(): Promise<DiagnosticTransactionBeginResult> {
    if (pendingTransaction !== null) return { ok: false, reason: "transaction_pending" };
    let open: NativeSqliteConnection;
    try {
      open = await ensureConnection();
    } catch (error) {
      // BEGIN was never issued, so nothing can have been opened.
      return { ok: false, reason: classifyControlFailure(error, lastFailureWasPlatform) };
    }
    nextTransactionOrdinal += 1;
    const token: DiagnosticTransactionToken = {
      id: `${databaseName}#txn-${nextTransactionOrdinal}`,
    };
    // Ownership is taken BEFORE the native call, in the `uncertain` phase. From
    // the moment BEGIN is issued a native transaction may exist whether or not
    // its answer arrives, so there is no instant at which an ordinary read could
    // slip in underneath it.
    const owned: OwnedDiagnosticTransaction = {
      token,
      phase: "uncertain",
      closedPendingRelease: false,
    };
    pendingTransaction = owned;
    let acknowledged = false;
    try {
      acknowledged = isTransactionAcknowledgement(await open.beginTransaction());
    } catch {
      acknowledged = false;
    }
    if (!acknowledged) {
      // NOT "nothing was opened". The store keeps owning an uncertain
      // transaction and hands the token back so the caller can resolve it.
      return { ok: false, reason: "begin_unacknowledged", token };
    }
    owned.phase = "open";
    return { ok: true, token };
  }

  async function stageTask(
    token: DiagnosticTransactionToken,
    entries: readonly DiagnosticTransactionEntry[]
  ): Promise<DiagnosticTransactionStageResult> {
    const refusal = checkUsableToken(token);
    if (refusal) return { ok: false, reason: refusal };
    const open = connection;
    if (open === null) {
      // The connection cannot vanish while a transaction is owned — close and
      // reopen are refused — so this is unreachable. Treated as a failure whose
      // native state is unknown rather than assumed away.
      markUncertain();
      return { ok: false, reason: "statement_failed", cleanup: "rollback_failed" };
    }
    for (const entry of entries) {
      try {
        // `transaction: false` — THE critical argument. With the plugin's
        // default the native side would issue its own BEGIN inside this one.
        await open.run(UPSERT_VALUE_SQL, [entry.key, entry.value], false);
      } catch {
        return {
          ok: false,
          reason: "statement_failed",
          cleanup: await rollbackAfterFailure(open),
        };
      }
    }
    return { ok: true };
  }

  async function stageFailingTask(
    token: DiagnosticTransactionToken,
    key: string
  ): Promise<DiagnosticTransactionStageResult> {
    const refusal = checkUsableToken(token);
    if (refusal) return { ok: false, reason: refusal };
    const open = connection;
    if (open === null) {
      markUncertain();
      return { ok: false, reason: "statement_failed", cleanup: "rollback_failed" };
    }
    try {
      await open.run(DIAGNOSTIC_FAILING_INSERT_SQL, [key], false);
    } catch {
      return {
        ok: false,
        reason: "statement_failed",
        cleanup: await rollbackAfterFailure(open),
      };
    }
    // The statement was supposed to violate NOT NULL and did not. That is a
    // fact about the ENGINE and it is reported as its own reason. The rollback
    // that follows may itself fail, in which case the transaction stays owned and
    // `uncertain` exactly as on every other failure path.
    return {
      ok: false,
      reason: "statement_unexpectedly_succeeded",
      cleanup: await rollbackAfterFailure(open),
    };
  }

  async function commitTask(
    token: DiagnosticTransactionToken
  ): Promise<DiagnosticTransactionCommitResult> {
    const refusal = checkUsableToken(token);
    if (refusal) return { ok: false, reason: refusal };
    const open = connection;
    if (open === null) {
      markUncertain();
      return { ok: false, reason: "commit_rejected", cleanup: "rollback_failed" };
    }
    let acknowledged = false;
    try {
      acknowledged = isTransactionAcknowledgement(await open.commitTransaction());
    } catch {
      acknowledged = false;
    }
    if (acknowledged) {
      pendingTransaction = null;
      return { ok: true };
    }
    // A rejected — or unreadably answered — COMMIT says nothing about what
    // reached the database. The rollback below frees the connection only if it
    // is itself acknowledged; it never establishes that nothing was committed,
    // and no caller may read it that way. (If the COMMIT did take effect, the
    // ROLLBACK finds no transaction, rejects, and ownership stays `uncertain`.)
    return {
      ok: false,
      reason: "commit_rejected",
      cleanup: await rollbackAfterFailure(open),
    };
  }

  async function rollbackTask(
    token: DiagnosticTransactionToken
  ): Promise<DiagnosticTransactionRollbackResult> {
    const refusal = checkToken(token);
    if (refusal) return { ok: false, reason: refusal };
    const open = connection;
    if (open === null || pendingTransaction?.closedPendingRelease) {
      // The connection is already closed by an incomplete abandon; a ROLLBACK
      // has nothing to address. Only finishing the abandon can resolve it.
      markUncertain();
      return { ok: false, reason: "rollback_failed" };
    }
    return (await rollbackAfterFailure(open)) === "rolled_back"
      ? { ok: true }
      : { ok: false, reason: "rollback_failed" };
  }

  async function abandonTask(
    token: DiagnosticTransactionToken
  ): Promise<DiagnosticTransactionAbandonResult> {
    const refusal = checkToken(token);
    if (refusal) return { ok: false, reason: refusal };
    const owned = pendingTransaction;
    if (owned === null) return { ok: false, reason: "no_pending_transaction" };
    // From here on the transaction is no longer one anything may be staged into
    // or committed from, whatever the outcome below.
    owned.phase = "uncertain";

    if (!owned.closedPendingRelease) {
      const open = connection;
      if (open !== null) {
        // Best effort. Its outcome is deliberately not what decides: the close
        // below is what ends a transaction at the engine.
        try {
          await open.rollbackTransaction();
        } catch {
          /* the close below is the deciding step */
        }
        try {
          await open.close();
        } catch {
          // Ownership, the handle and the uncertainty are all KEPT. The
          // connection may still be open and inside the transaction; freeing
          // the store now would let an ordinary read be served from it.
          return { ok: false, reason: "abandon_incomplete", boundary: "close" };
        }
      }
      connection = null;
      owned.closedPendingRelease = true;
    }
    try {
      if (engine) await engine.closeConnection(databaseName);
    } catch {
      // Still owned. A retry resumes here, at the release.
      return { ok: false, reason: "abandon_incomplete", boundary: "release" };
    }
    // The connection is closed AND its native handle released: no transaction
    // can survive that at the engine. Only now is ownership given up.
    pendingTransaction = null;
    staleNativeHandle = false;
    return { ok: true };
  }

  return {
    databaseName,
    adapter,
    hasPendingDiagnosticTransaction: () => pendingTransaction !== null,
    diagnosticTransactionState: () => pendingTransaction?.phase ?? "none",
    beginDiagnosticTransaction: () =>
      enqueue(beginTransactionTask).catch((): DiagnosticTransactionBeginResult => {
        // Unreachable in practice. If ownership was already taken, the token
        // must still reach the caller: losing it would strand the store.
        const owned = pendingTransaction;
        if (owned !== null) {
          owned.phase = "uncertain";
          return { ok: false, reason: "begin_unacknowledged", token: owned.token };
        }
        return { ok: false, reason: "operation_failed" };
      }),
    stageDiagnosticWrites: (token, entries) =>
      enqueue(() => stageTask(token, entries)).catch(() => {
        markUncertain();
        return {
          ok: false as const,
          reason: "statement_failed" as const,
          cleanup: "rollback_failed" as const,
        };
      }),
    stageDiagnosticFailingStatement: (token, key) =>
      enqueue(() => stageFailingTask(token, key)).catch(() => {
        markUncertain();
        return {
          ok: false as const,
          reason: "statement_failed" as const,
          cleanup: "rollback_failed" as const,
        };
      }),
    commitDiagnosticTransaction: (token) =>
      enqueue(() => commitTask(token)).catch(() => {
        markUncertain();
        return {
          ok: false as const,
          reason: "commit_rejected" as const,
          cleanup: "rollback_failed" as const,
        };
      }),
    rollbackDiagnosticTransaction: (token) =>
      enqueue(() => rollbackTask(token)).catch(() => {
        markUncertain();
        return { ok: false as const, reason: "rollback_failed" as const };
      }),
    abandonDiagnosticTransaction: (token) =>
      enqueue(() => abandonTask(token)).catch(() => {
        markUncertain();
        return {
          ok: false as const,
          reason: "abandon_incomplete" as const,
          boundary: "close" as const,
        };
      }),
    reopenDiagnosticConnection: () =>
      enqueue(reopenTask).catch(() => ({
        ok: false as const,
        boundary: "open" as const,
        reason: "operation_failed" as const,
      })),
    readEffectiveSettings: () =>
      enqueue(settingsTask).catch(() => ({ ok: false, reason: "operation_failed" as const })),
    close: () =>
      enqueue(closeTask).catch(() => ({ ok: false, reason: "operation_failed" as const })),
    deleteAllRecords: () =>
      enqueue(deleteAllTask).catch(() => ({ ok: false, reason: "operation_failed" as const })),
  };
}
