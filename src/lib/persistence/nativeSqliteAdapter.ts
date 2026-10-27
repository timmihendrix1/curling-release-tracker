// The native SQLite `RemovableStorageAdapter` — Stage M3b.
//
// This module implements the EXISTING ADR-0013 persistence contract
// (`src/lib/persistence/types.ts`) over a key/value SQLite table.
//
// **Who selects it, and who does not.** Three callers exist: the mobile
// storage-diagnostics panel under `mobile/src/diagnostics/`, which drives it
// against a dedicated SYNTHETIC database; `storageComposition.ts`, the one owned
// production composition (Stage M3b3); and `nativeMigrationBindings.ts`, the
// DORMANT migration executor's binding (Stage M3b4b), which no application path
// calls. All reach it through a DYNAMIC import, so a bundle that composes no
// native store ships no SQLite at all, and `__tests__/architectureBoundary.test.ts`
// enforces that no other production module under `src/` imports it.
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
//   - no domain parsing, no migration RULES, no activation-record knowledge — the
//     migration-only target capability at the end executes named transactions
//     the migration module supplies, over reserved keys it is told;
//   - no mutable "current Profile" pointer — a key is a key, exactly as the
//     Profile-scoped adapter namespace already supplies it;
//   - no public transaction contract. `RemovableStorageAdapter` still promises
//     no multi-key atomicity, and none is added here.
//
// Durability claims are bounded on purpose. A resolved `set` is the ENGINE'S
// acknowledgement of a committed statement; it is not a power-loss guarantee,
// and an immediate read-back proves nothing beyond the same process. See
// `NativeSqliteStore.readEffectiveSettings` for the pragmas actually in force.
import { registerNativeMigrationBorrowIssuer, registerNativeCombinedHeldHost, registerNativeCommonMigrationHost, evaluateBorrowedFingerprintFormat, nativeCommonMigrationControlCurrent, type NativeCombinedHostController, type NativeCommonHostController, type NativeCommonHoldEvidence } from "./nativeMigrationBorrowEvidence";
import { nativeRuntimeCleanup, observeNativeRuntimeMalformed, nativeRuntimeCurrent, nativeRuntimeFailed, nativeRuntimeProtocolFault, nativeRuntimeEvidence, type NativeRuntimeSession, type NativeRuntimeDomainDraft } from "./nativeCombinedRuntime";
import { parseQ as protocolParseQ, parseF, serializeQ as protocolSerializeQ, transitionQ as protocolTransitionQ, NEW_USER_CREDENTIAL_CONTRACT, type CredentialContract, type Q } from "./credentialProtocol";
import { evaluateActivationRecord, buildRecordAfter, type FingerprintFormatPredicate } from "./nativeMigrationRecord";
import { resolveNativeCombinedSourceProof, resolveNativeNewUserSourceProof, fenceNativeCombinedSourceProof, type NativeCombinedWebViewSource, type NativeCombinedSourceProof } from "./localStorageAdapter";
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
 * The ordinary/legacy adapter's table. The separate dormant S3b inventory also
 * recognizes its exact private metadata table, without exposing an adapter.
 * Two TEXT columns and nothing else —
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

// S3a's finite legacy protocol selection. These are target controls, never
// source eligibility. Ordinary factories use the same actual D/latch locations;
// tests pin these literals to their pure declarations without adding a storage
// dependency to the adapter's import graph.
const LEGACY_PROTOCOL_KEYS = {
  record: "curling.nativeMigration.activationRecord.v1",
  latch: "curling.nativeMigration.faultLatch.v1",
};
const SCHEMA_VERSION_SQL = "PRAGMA schema_version;";
const SCHEMA_OBJECTS_SQL = "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;";
const RECORD_COLUMNS_SQL = "PRAGMA table_info('records');";
const RECORD_INDEXES_SQL = "PRAGMA index_list('records');";
const RECORD_INDEX_COLUMNS_SQL = "PRAGMA index_info('sqlite_autoindex_records_1');";

// S3b: this exact additional layout is visible ONLY to the dormant private
// inventory capability. Ordinary/diagnostic/legacy modes still refuse it.
const CREDENTIAL_META_DDL = "CREATE TABLE curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL CHECK(slot IN ('schema','q','f')), value TEXT NOT NULL)";
const CREDENTIAL_SCHEMA_MARKER = '{"schemaVersion":1,"kind":"credential-cross-store-meta"}';
const META_SLOTS_SQL = "SELECT slot FROM curling_credential_meta ORDER BY slot;";
const META_VALUE_SQL = "SELECT value FROM curling_credential_meta WHERE slot = ?;";
type CredentialSqliteLayout = "empty" | "records" | "combined";

const protocolSelectionErrors = new WeakSet<object>();
class ProtocolSelectionError extends Error {
  constructor() { super(); protocolSelectionErrors.add(this); }
}
function isProtocolSelectionError(error: unknown): boolean {
  return error !== null && (typeof error === "object" || typeof error === "function") && protocolSelectionErrors.has(error);
}

/** Own snapshots of a fixed bridge result shape. No raw result escapes. */
function discoveryRows(raw: unknown, fields: readonly string[], validateField?: (name: string, value: unknown) => void): Record<string, unknown>[] {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ProtocolSelectionError();
  const property = Object.getOwnPropertyDescriptor(raw, "values");
  if (!property || !Object.hasOwn(property, "value")) throw new ProtocolSelectionError();
  const values: unknown = property.value;
  if (!Array.isArray(values)) throw new ProtocolSelectionError();
  if (Reflect.ownKeys(values).length !== values.length + 1) throw new ProtocolSelectionError();
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < values.length; i++) {
    const entry = Object.getOwnPropertyDescriptor(values, String(i));
    if (!entry || !Object.hasOwn(entry, "value")) throw new ProtocolSelectionError();
    const row: unknown = entry.value;
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new ProtocolSelectionError();
    const names = Reflect.ownKeys(row);
    if (names.length !== fields.length || !fields.every(name => names.includes(name))) throw new ProtocolSelectionError();
    const snapshot: Record<string, unknown> = {};
    for (const name of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(row, name);
      if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new ProtocolSelectionError();
      const value: unknown = descriptor.value;
      validateField?.(name, value);
      snapshot[name] = value;
    }
    rows.push(snapshot);
  }
  return rows;
}

function exactDiscoveryRows(actual: Record<string, unknown>[], expected: readonly Record<string, unknown>[]): boolean {
  return actual.length === expected.length && actual.every((row, i) =>
    Object.keys(expected[i]).every(name => row[name] === expected[i][name]));
}

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
/** As above, while the migration holds its lease (Stage M3b4b). Unreachable in a
 * shipped build: no production path acquires one. */
const MIGRATION_OWNED_MESSAGE =
  "Native storage is held by the storage migration and refused this operation.";

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

/** Internal: a migration caller's lifecycle ended while the connection was
 * opening. Never escapes this module. */
const openCancelledErrors = new WeakSet<object>();
class OpenCancelledError extends Error {
  constructor() { super(); openCancelledErrors.add(this); }
}

function isOpenCancelled(error: unknown): boolean {
  return error !== null && (typeof error === "object" || typeof error === "function") && openCancelledErrors.has(error);
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
  /** Discovery refused before COMMIT was issued. */
  | { ok: false; reason: "protocol_refused"; cleanup: DiagnosticTransactionCleanup }
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

/* ==========================================================================
 * The migration-only TARGET capability — Stage M3b4b
 * ==========================================================================
 *
 * docs/MOBILE_APP_MIGRATION.md Stage M3b0 §5.1 puts the migration's multi-key
 * atomicity INSIDE the migration module, over the native engine's own
 * connection, and keeps `RemovableStorageAdapter` exactly as it is. This
 * section is that internal capability, and nothing more:
 *
 *   - it is reachable only through `createNativeMigrationSqliteStore`, never
 *     through `NativeSqliteStore` or the repository-facing contracts;
 *   - it shares THIS store's one queue and one connection. While its lease is
 *     held, every ordinary, diagnostics and lifecycle task refuses, so
 *     migration work never interleaves with anything and never joins another
 *     owner's transaction — and no second owner opens or releases the handle;
 *   - it exposes named operations, never caller-supplied SQL. Keys and values
 *     are always bound;
 *   - each transaction is ONE queued task: BEGIN, the expected-state checks,
 *     the writes and COMMIT, with the plugin's per-statement transaction flag
 *     explicitly off for every statement inside it;
 *   - application rows are inserted, never upserted, so a staged row is never
 *     overwritten; the record is replaced in place by UPDATE, never deleted and
 *     re-created;
 *   - the expected record bytes are re-read INSIDE the transaction, so evidence
 *     that went stale between the decision and the write cannot authorise it;
 *   - which keys are reserved (the activation record and the fault latch) is
 *     supplied by the migration module, so this file names no migration key.
 *
 * **Uncertainty is never cleared by assumption.** From the moment BEGIN is
 * issued until COMMIT or ROLLBACK is positively acknowledged, the lease is in
 * `requires_reopen`. A rejected or unreadable COMMIT is NOT proof of rollback,
 * and no ROLLBACK is attempted after one: on Android the plugin acknowledges a
 * ROLLBACK even when no transaction is active (`Database.java`
 * `rollbackTransaction`), so its answer could not distinguish "rolled back" from
 * "already committed". Only `reopen` — a close, a native handle release and a
 * fresh open, each positively established — ends `requires_reopen`, and reads
 * are refused until it has. A successful cleanup proves the connection is free;
 * it never proves what an uncertain COMMIT did.
 *
 * Evidence class of this code's tests: mock (the plugin-faithful engine). They
 * model the approved atomicity assumption; they do not prove durability.
 */

/** The two reserved target locations (I-2, I-13), supplied by the migration module. */
export interface NativeMigrationReservedKeys {
  readonly record: string;
  readonly latch: string;
}

/** Identifies one holder of the migration lease. A stale lease resolves nothing. */
export interface NativeMigrationLease {
  readonly id: string;
}

export type NativeMigrationRefusal =
  /** Another lease is held. */
  | "lease_held"
  /** A borrowed child retains live/warm/fault evidence in this context. */
  | "borrowed_evidence_held"
  | "control_evidence_held"
  | "controls_unproven"
  | "parent_busy"
  /** A diagnostics transaction owns the store. */
  | "diagnostic_transaction_pending"
  /** Another store instance in this context may hold a native handle to the database. */
  | "connection_held_elsewhere"
  /** No lease is held. */
  | "no_lease"
  /** A lease other than the current one. */
  | "wrong_lease"
  /** The native transaction state is unknown; only `reopen` may run. */
  | "requires_reopen"
  /** The requested transaction is not one the migration issues. Nothing was begun. */
  | "invalid_transaction"
  /** Complete supported schema/control inventory was not established. */
  | "protocol_refused"
  /** The caller's lifecycle ended (disposal) before BEGIN. Nothing was begun. */
  | "cancelled";

/** A stored value as read. `absent` comes only from a valid, empty result. */
export type NativeMigrationObservation =
  | { readonly status: "absent" }
  | { readonly status: "present"; readonly bytes: string }
  | { readonly status: "read_failed" };

/** The complete application-row key set, excluding exactly the two reserved keys. */
export type NativeMigrationKeyListing =
  | { readonly status: "listed"; readonly keys: readonly string[] }
  | { readonly status: "read_failed" };

export interface NativeMigrationRow {
  readonly key: string;
  readonly value: string;
}

/**
 * Judges complete target evidence read INSIDE an AP-CC/AP-ACT transaction. It
 * receives every application row with its exact value and returns whether the
 * write may proceed; a throw or anything but `true` aborts before any write.
 */
export type NativeMigrationEvidenceVerifier = (rows: readonly NativeMigrationRow[]) => Promise<boolean>;

/** The transactions the approved plans issue (§5.4a), as storage operations. */
export type NativeMigrationTransaction =
  /** D1 / AP-D3 step 1: a new record over no record and no application row. */
  | { readonly kind: "create_record"; readonly recordAfter: string }
  /** AP-K1′, `enumerating → copying`, AP-CC and AP-ACT: the record replaced in place. */
  | {
      readonly kind: "replace_record";
      readonly recordBefore: string;
      readonly recordAfter: string;
      /** I-6: nothing may be staged while `enumerating`. */
      readonly requireNoApplicationRows: boolean;
      /** AP-CC/AP-ACT: complete target evidence, read inside the transaction. */
      readonly verifyCompleteEvidence?: NativeMigrationEvidenceVerifier;
    }
  /** One checkpoint: a non-empty batch of NEW rows and the record, together. */
  | {
      readonly kind: "checkpoint";
      readonly recordBefore: string;
      readonly recordAfter: string;
      readonly rows: readonly NativeMigrationRow[];
    }
  /** I-13's durable latch: one row at the reserved latch location. */
  | { readonly kind: "insert_latch"; readonly content: string };

export type NativeMigrationNotCommittedReason =
  /** BEGIN was issued and not positively acknowledged. Nothing was written. */
  | "begin_unacknowledged"
  /** The record, a row or the latch was not in the expected state. Nothing was written. */
  | "precondition_failed"
  /** An in-transaction read failed. Nothing was written. */
  | "evidence_unreadable"
  /** The in-transaction evidence verifier refused. Nothing was written. */
  | "evidence_mismatch"
  /** Schema/control selection failed; no COMMIT was issued. */
  | "protocol_refused"
  /** A write statement failed or was not acknowledged as one changed row. */
  | "statement_failed"
  /** `insert_latch` only: a latch is already present. Nothing was written. */
  | "latch_already_present"
  /** The caller's lifecycle ended before COMMIT; the uncommitted work was rolled back. */
  | "cancelled"
  /** S3f's actual same-turn source fence refused COMMIT. */
  | "source_changed" | "source_unavailable";

export type NativeMigrationTransactionResult =
  /** COMMIT positively acknowledged — an engine acknowledgement, not durability. */
  | { readonly status: "confirmed" }
  /** Refused before BEGIN; nothing was issued. */
  | { readonly status: "refused"; readonly reason: NativeMigrationRefusal }
  /** The connection could not be opened; BEGIN was never issued. */
  | { readonly status: "not_begun"; readonly reason: NativeSqliteFailureReason }
  /**
   * No COMMIT was issued, so nothing of this transaction can be durable.
   * `connection: "uncertain"` means a native transaction may still be open on
   * the connection (BEGIN or ROLLBACK unacknowledged): the lease is in
   * `requires_reopen`.
   */
  | {
      readonly status: "not_committed";
      readonly reason: NativeMigrationNotCommittedReason;
      readonly writeIssued: boolean;
      readonly connection: "clean" | "uncertain";
    }
  /** COMMIT was issued and not positively acknowledged. Only reopened state decides. */
  | { readonly status: "outcome_unknown" };

export type NativeMigrationAcquireResult =
  | { readonly ok: true; readonly lease: NativeMigrationLease }
  | {
      readonly ok: false;
      /** `connection_held_elsewhere`: another store instance in this context may
       * still hold a native handle to the same database. */
      readonly reason: "lease_held" | "diagnostic_transaction_pending" | "connection_held_elsewhere";
    };

/**
 * Consulted INSIDE a transaction before every further bridge call, write and
 * COMMIT. Answering anything but `true` (or throwing) stops the transaction: an
 * uncommitted one is rolled back; a COMMIT already issued is awaited and its
 * real outcome reported.
 */
export interface NativeMigrationTransactionControl {
  readonly proceed?: () => boolean;
}

/** The same lifecycle control, for reads and reopening: checked after every
 * asynchronous step, so a cancelled caller's composite operation issues no
 * further bridge call. A cancelled read reports `cancelled`, never absence. */
export type NativeMigrationControl = NativeMigrationTransactionControl;

export type NativeMigrationReadResult =
  | { readonly ok: true; readonly record: NativeMigrationObservation; readonly latch: NativeMigrationObservation }
  | { readonly ok: false; readonly reason: NativeMigrationRefusal };

export type NativeMigrationListResult =
  | NativeMigrationKeyListing
  | { readonly status: "refused"; readonly reason: NativeMigrationRefusal };

export type NativeMigrationValuesResult =
  | { readonly ok: true; readonly values: ReadonlyMap<string, NativeMigrationObservation> }
  | { readonly ok: false; readonly reason: NativeMigrationRefusal };

/**
 * `ok: true` means the previous connection was closed, its native handle
 * released and a FRESH connection opened — the only state in which following
 * reads are reopened evidence. `generation` counts successful reopens.
 */
export type NativeMigrationReopenResult =
  | { readonly ok: true; readonly generation: number }
  | { readonly ok: false; readonly reason: NativeMigrationRefusal }
  | {
      readonly ok: false;
      readonly boundary: "close" | "release" | "open";
      readonly reason: NativeSqliteFailureReason;
    };

/** Releasing closes the connection and its native handle first, then drops the lease. */
export type NativeMigrationReleaseResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: NativeMigrationRefusal }
  | { readonly ok: false; readonly boundary: "close" | "release" };

export type NativeMigrationLeaseState = "unowned" | "owned" | "requires_reopen";

export interface NativeSqliteMigrationTarget {
  acquire(): Promise<NativeMigrationAcquireResult>;
  /** Fresh internal discovery, no caller-supplied permit or access grant. */
  checkProtocolSelection(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<
    { readonly ok: true } | { readonly ok: false; readonly reason: NativeMigrationRefusal }
  >;
  /** The activation record and the fault latch. */
  readReserved(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeMigrationReadResult>;
  listApplicationKeys(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeMigrationListResult>;
  /** Exact values of application keys (reserved keys are refused). */
  readValues(
    lease: NativeMigrationLease,
    keys: readonly string[],
    control?: NativeMigrationControl
  ): Promise<NativeMigrationValuesResult>;
  transact(
    lease: NativeMigrationLease,
    transaction: NativeMigrationTransaction,
    control?: NativeMigrationTransactionControl
  ): Promise<NativeMigrationTransactionResult>;
  reopen(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeMigrationReopenResult>;
  release(lease: NativeMigrationLease): Promise<NativeMigrationReleaseResult>;
  /** Local state only; touches no database. */
  leaseState(): NativeMigrationLeaseState;
}

declare const combinedHostBrand: unique symbol;
/** Authentic identity is private registry membership, never this erased brand. */
export type NativeCombinedHeldSqliteHost = NativeCredentialSqliteInventory & { readonly [combinedHostBrand]: true };

/** S3f internal context, consumed ONLY by the dormant common executor. */
export type NativeCommonSqlSnapshot = Extract<NativeCredentialSqliteObservation, { ok: true }> & {
  readonly rows: { readonly status: "listed"; readonly entries: readonly NativeMigrationRow[] } | { readonly status: "read_failed" };
};
export type NativeCommonJournalResolution = "none" | "before" | "after" | "unavailable" | "mismatch" | "reopen_required";
export interface NativeCommonSqliteContext {
  readonly host: NativeCombinedHeldSqliteHost;
  failed(lease: NativeMigrationLease): boolean;
  observe(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeCommonSqlSnapshot | { readonly ok: false; readonly reason: NativeMigrationRefusal | NativeSqliteFailureReason }>;
  select(lease: NativeMigrationLease, snapshot: NativeCommonSqlSnapshot): boolean;
  resolveHold(lease: NativeMigrationLease, token: unknown): NativeCommonHoldEvidence | null;
  initializeNewUser(lease: NativeMigrationLease, raw: string, sourceProof: NativeCombinedSourceProof, control?: NativeMigrationControl): Promise<NativeMigrationTransactionResult>;
  insertIntent(lease: NativeMigrationLease, hold: unknown, raw: string, sourceProof: NativeCombinedSourceProof, control?: NativeMigrationControl): Promise<NativeMigrationTransactionResult>;
  advanceQ(lease: NativeMigrationLease, before: string, action: unknown, sourceProof: NativeCombinedSourceProof, control?: NativeMigrationControl): Promise<NativeMigrationTransactionResult>;
  finalize(lease: NativeMigrationLease, hold: unknown, sourceProof: NativeCombinedSourceProof, migrationId: string, activatedAt: string, control?: NativeMigrationControl): Promise<NativeMigrationTransactionResult>;
  recordFault(lease: NativeMigrationLease, raw: string, control?: NativeMigrationControl): Promise<NativeMigrationTransactionResult>;
  resolveJournal(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeCommonJournalResolution>;
  pinBound(lease: NativeMigrationLease, snapshot: NativeCommonSqlSnapshot): boolean;
  prepareRuntime(lease: NativeMigrationLease, snapshot: NativeCommonSqlSnapshot, session: NativeRuntimeSession): NativeRuntimeDomainDraft | null;
}
interface NativeCommonSqlDependencies {
  readonly credentialContract?: CredentialContract;
  readonly source: NativeCombinedWebViewSource;
  readonly providerConfigIdentity: string;
  readonly sessionStorageKey: string;
  readonly isWellFormedFingerprint: FingerprintFormatPredicate;
}

export interface NativeMigrationSqliteStore {
  readonly store: NativeSqliteStore;
  readonly target: NativeSqliteMigrationTarget;
}

/** Dormant internal observation capability. No ordinary adapter, domain write,
 * Q progress, finalization or readiness authority is returned. */
export type NativeCredentialSqliteObservation =
  | { readonly ok: false; readonly reason: NativeMigrationRefusal | NativeSqliteFailureReason }
  | {
      readonly ok: true;
      readonly layout: CredentialSqliteLayout;
      readonly record: NativeMigrationObservation;
      readonly latch: NativeMigrationObservation;
      readonly schema: NativeMigrationObservation;
      readonly q: NativeMigrationObservation;
      readonly f: NativeMigrationObservation;
    };
export type NativeCredentialInitializationResult = NativeMigrationTransactionResult |
  { readonly status: "refused"; readonly reason: "target_not_empty" | "already_initialized" };
export interface NativeCredentialSqliteInventory {
  acquire(): Promise<NativeMigrationAcquireResult>;
  observe(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeCredentialSqliteObservation>;
  initializeEmpty(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeCredentialInitializationResult>;
  reopen(lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeMigrationReopenResult>;
  release(lease: NativeMigrationLease): Promise<NativeMigrationReleaseResult>;
  leaseState(): NativeMigrationLeaseState;
}

interface CredentialInitializationIssuance {
  beginIssued: boolean;
  writeIssued: boolean;
  commitIssued: boolean;
  commitAcknowledged: boolean;
  rollbackAcknowledged: boolean;
}

interface MigrationOwner {
  readonly lease: NativeMigrationLease;
  phase: "ready" | "requires_reopen";
  generation: number;
}

/**
 * Ownership of ONE DATABASE within this live JavaScript context — shared by
 * every store instance, factory call and engine wrapper that names it.
 *
 * Without this, each factory call had its own owner, so a second
 * `createNativeMigrationSqliteStore` for the same database could acquire an
 * independent lease beside a held one — including beside a runner holding a
 * detected-fault stop whose durable latch had failed. The plugin's native
 * connection dictionary is keyed by database NAME, and the binding releases by
 * name before every `createConnection`, so a second owner of the same name can
 * close the first one's handle underneath it.
 *
 *   - `migration`: the one migration lease for this database, and the store
 *     instance holding it. While it exists, every OTHER instance refuses
 *     ordinary, diagnostics, lifecycle and migration work on the database.
 *   - `handles`: the instances that may hold a native handle to it (open,
 *     opening, or closed without a confirmed release). A lease is granted only
 *     when no other instance is in this set.
 *
 * There is deliberately no reset, force-unlock or fault-clearing entry point:
 * a lease is given up only by its holder's positively completed `release`, and
 * a fault-stopped runner never releases. Only a new execution context — a new
 * process — starts without it. Different databases are independent.
 */
interface DatabaseOwnership {
  migration: { readonly store: object; readonly owner: MigrationOwner } | null;
  readonly handles: Set<object>;
}

const DATABASE_OWNERSHIP = new Map<string, DatabaseOwnership>();
/** Context-wide, so lease ids never repeat within a context; leases are also compared by identity. */
let nextContextLeaseOrdinal = 0;

function ownershipOf(databaseName: string): DatabaseOwnership {
  let entry = DATABASE_OWNERSHIP.get(databaseName);
  if (!entry) {
    entry = { migration: null, handles: new Set() };
    DATABASE_OWNERSHIP.set(databaseName, entry);
  }
  return entry;
}

/** Plain key listing. Ordered so a listing is deterministic; filtered in code. */
const SELECT_ALL_KEYS_SQL = `SELECT key FROM ${NATIVE_SQLITE_RECORDS_TABLE} ORDER BY key`;
/** NO conflict clause: inserting over an existing key is a PRIMARY KEY violation,
 * which is the point — a staged row is never overwritten. */
const INSERT_NEW_ROW_SQL = `INSERT INTO ${NATIVE_SQLITE_RECORDS_TABLE} (key, value) VALUES (?, ?)`;
/** The in-place record replacement (I-8): never a delete followed by a create. */
const UPDATE_VALUE_SQL = `UPDATE ${NATIVE_SQLITE_RECORDS_TABLE} SET value = ? WHERE key = ?`;

/** Whether a resolved `run` reports exactly one changed row — the plugin's
 * `{ changes: { changes: n, ... } }` on both platforms (iOS `runSQL`, Android
 * `runSQL`, both computing `n` from `total_changes()`). Anything else is not an
 * acknowledgement of the one row the statement exists to write. */
function isSingleRowChange(result: unknown): boolean {
  try {
    if (result === null || typeof result !== "object" || Array.isArray(result)) return false;
    const outer = (result as { changes?: unknown }).changes;
    if (outer === null || typeof outer !== "object" || Array.isArray(outer)) return false;
    return (outer as { changes?: unknown }).changes === 1;
  } catch {
    return false;
  }
}

/** One row whose ONLY column is `column`, holding a string. */
function soleStringColumn(row: NativeSqliteRow, column: string): string | null {
  try {
    const names = Object.keys(row);
    if (names.length !== 1 || names[0] !== column) return null;
    const value = row[column];
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

/** A strict single-key read: zero rows is absence, one well-formed row is a
 * value, and every other shape — two rows, an extra column, a non-string — is a
 * failed read, never absence. */
function readMigrationValue(result: unknown): NativeMigrationObservation {
  const envelope = readEnvelope(result);
  if (envelope.kind === "malformed") return { status: "read_failed" };
  if (envelope.rows.length === 0) return { status: "absent" };
  if (envelope.rows.length > 1) return { status: "read_failed" };
  const value = soleStringColumn(envelope.rows[0], "value");
  return value === null ? { status: "read_failed" } : { status: "present", bytes: value };
}

/** The complete key set, or a failure. A duplicate or malformed row fails the
 * whole listing: dropping it would turn a fault into apparent absence. */
function readKeyListing(result: unknown, reserved: NativeMigrationReservedKeys): NativeMigrationKeyListing {
  const envelope = readEnvelope(result);
  if (envelope.kind === "malformed") return { status: "read_failed" };
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of envelope.rows) {
    const key = soleStringColumn(row, "key");
    if (key === null || seen.has(key)) return { status: "read_failed" };
    seen.add(key);
    if (key !== reserved.record && key !== reserved.latch) keys.push(key);
  }
  return { status: "listed", keys: Object.freeze(keys) };
}

function validReservedKeys(value: unknown): value is NativeMigrationReservedKeys {
  if (value === null || typeof value !== "object") return false;
  const { record, latch } = value as { record?: unknown; latch?: unknown };
  return typeof record === "string" && typeof latch === "string" && record.length > 0 &&
    latch.length > 0 && record !== latch;
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
  return buildNativeSqliteStore(options, null).store;
}

// Private installer: no SQL, ports or mode selector on public construction options.
interface QuarantineCore {
  openBoxed(proceed: () => boolean): Promise<Readonly<{ connection: NativeSqliteConnection }>>;
  enqueue<T>(task: () => Promise<T>): Promise<T>;
  acquire(): Promise<NativeMigrationAcquireResult>;
  open(proceed: () => boolean): Promise<NativeSqliteConnection>;
  reopen(lease: NativeMigrationLease): Promise<NativeMigrationReopenResult>;
  release(lease: NativeMigrationLease, keep: boolean): Promise<NativeMigrationReleaseResult>;
  phase(): void;
  leaseCurrent(lease: NativeMigrationLease, requireReady: boolean): boolean;
  retireReady(lease: NativeMigrationLease): boolean;
  retire(lease: NativeMigrationLease): void;
}
interface QuarantineHooks {
  openConnection?(connection: NativeSqliteConnection, proceed: () => boolean): Promise<void>;
  createConnection?(engine: NativeSqliteEngine, databaseName: string, proceed: () => boolean): Promise<Readonly<{ connection: NativeSqliteConnection }>>;
  configureConnection?(connection: NativeSqliteConnection, proceed: () => boolean, journalSql: string, synchronousSql: string): Promise<void>;
  settleVoid(work: unknown): Promise<boolean>;
  cleanupEvidence?(values: Partial<import("./nativeCombinedRuntime").NativeRuntimeCleanupEvidence>): void;
  discover(open: NativeSqliteConnection, proceed: () => boolean): Promise<void>;
  context: NativeTransferQuarantineContext;
}
type QuarantineInstaller = (core: QuarantineCore) => QuarantineHooks;
export interface NativeTransferQuarantineContext {
  inspect(proceed: () => boolean): Promise<NativeTransferQuarantineCode>;
  stage(wire: string, digest: string, proceed: () => boolean): Promise<NativeTransferQuarantineCode>;
  close(): Promise<NativeTransferQuarantineCode>;
}
export type NativeTransferQuarantineCode = "pair_intent" | "pair_intent_unverified" | "paired" | "paired_unverified" | "prepared" | "already_prepared" | "prepared_unverified" | "empty" | "quarantined_unverified" | "quarantined" | "already_quarantined" | "unavailable" | "target_conflict" | "outcome_unresolved" | "fault_held" | "closed" | "cleanup_held";

function buildNativeSqliteStore(
  options: NativeSqliteStoreOptions,
  reservedKeys: NativeMigrationReservedKeys | null,
  credentialInventoryMode = false,
  combinedHeldMode = false,
  commonDependencies: NativeCommonSqlDependencies | null = null,
  quarantineInstaller: QuarantineInstaller | null = null
): { store: NativeSqliteStore; migration: NativeSqliteMigrationTarget | null; credentials: NativeCredentialSqliteInventory | null; combined: NativeCombinedHeldSqliteHost | null; common: NativeCommonSqliteContext | null; quarantine: NativeTransferQuarantineContext | null } {
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
  /**
   * The migration lease, or `null` (Stage M3b4b). Like a diagnostics
   * transaction it is an EXCLUSIVE owner: while it is held every ordinary,
   * diagnostics and lifecycle task refuses as its first act, so migration work
   * can never interleave with anything else on this connection.
   */
  let migrationOwner: MigrationOwner | null = null;
  /** This instance's identity in the context-wide ownership registry. */
  const self: object = Object.freeze({});
  /** A connection is being created or opened right now. */
  let opening = false;
  /** A failed open's cleanup did not positively close and release the handle. */
  let openCleanupUncertain = false;
  // Private S3d evidence, distinct from legacy public leaseState/generation.
  // Boundaries rotate at call time, before queued work can race a held child.
  let borrowLifecycle: object = Object.freeze({});
  let borrowEvidence: object = Object.freeze({});
  let borrowReopened: object | null = null;
  let borrowUncertain = false;
  let borrowPending = 0;
  let hasBorrowPin: (lease: NativeMigrationLease) => boolean = () => false;
  let combinedController: NativeCombinedHostController | null = null;
  let combinedInitialized = false;
  // Historical positive structure proof survives reopen. Its later observed
  // disappearance is a contradiction, not permission to bootstrap again.
  let combinedSchemaEstablished = false;
  let combinedControlStop = false;
  let commonSelectedQ: Q | null = null;
  let commonSelectedRaw: string | null = null;
  let commonObservedQ: NativeMigrationObservation | null = null;
  let commonQEstablished = false;
  const combinedControls: Partial<Record<"schema" | "q" | "f", string>> = {};
  const combinedProgress = () => !combinedControlStop && combinedControls.schema === "valid" && combinedControls.f === "absent" &&
    (combinedControls.q === "absent" || (commonDependencies !== null && commonSelectedQ?.phase !== "bound" && commonSelectedRaw !== null && commonObservedQ?.status === "present" && commonObservedQ.bytes === commonSelectedRaw));
  function noteCombinedControl(slot: "schema" | "q" | "f", value: NativeMigrationObservation, lifecycle: object): void {
    if (!combinedHeldMode) return;
    const normalized = slot === "schema" && value.status === "present" ?
      value.bytes === CREDENTIAL_SCHEMA_MARKER ? "valid" : "invalid" : value.status;
    // Retain obtained positive contradictions even after cancellation, but a
    // favorable result from an older read cannot certify the current lifecycle.
    const stoppedBefore = combinedControlStop;
    if (slot === "schema") {
      if (normalized === "valid") combinedSchemaEstablished = true;
      else if (normalized !== "read_failed") combinedControlStop = true;
    } else if (normalized === "present" && (slot !== "q" || commonDependencies === null)) combinedControlStop = true;
    if (commonDependencies && slot === "q") {
      if (normalized === "present") commonQEstablished = true;
      else if (normalized === "absent" && commonQEstablished) combinedControlStop = true;
    }
    if (stoppedBefore !== combinedControlStop) borrowEvidence = Object.freeze({});
    if (lifecycle !== borrowLifecycle) return;
    if (combinedControls[slot] !== normalized) borrowEvidence = Object.freeze({});
    combinedControls[slot] = normalized;
    if (slot === "q") commonObservedQ = value;
    if (slot === "schema") combinedInitialized = normalized === "valid";
  }
  function noteCombinedLayout(layout: CredentialSqliteLayout, lifecycle: object): void {
    if (combinedHeldMode && layout !== "combined" && combinedSchemaEstablished) {
      noteCombinedControl("schema", { status: "absent" }, lifecycle);
    }
  }
  function rotateBorrowBoundary(): object {
    borrowLifecycle = Object.freeze({});
    borrowEvidence = Object.freeze({});
    borrowReopened = null;
    borrowUncertain = true;
    if (combinedHeldMode) { combinedInitialized = false; delete combinedControls.schema; delete combinedControls.q; delete combinedControls.f; }
    if (commonDependencies) { commonObservedQ = null; commonSelectedQ = null; commonSelectedRaw = null; }
    return borrowLifecycle;
  }

  /** Publishes whether this instance may hold a native handle. Touches no storage. */
  function syncHandle(): void {
    const shared = ownershipOf(databaseName);
    if (connection !== null || staleNativeHandle || opening || openCleanupUncertain) shared.handles.add(self);
    else shared.handles.delete(self);
  }

  /** A lease on this database held by ANOTHER instance in this context. */
  function heldElsewhere(): boolean {
    const shared = DATABASE_OWNERSHIP.get(databaseName);
    return (shared?.migration !== null && shared?.migration !== undefined && shared.migration.store !== self) ||
      [...(shared?.handles ?? [])].some(holder => holder !== self);
  }

  /** Why ordinary or diagnostics work is refused right now, or `null`. */
  function exclusiveOwnerMessage(): string | null {
    if (pendingTransaction !== null) return TRANSACTION_PENDING_MESSAGE;
    if (quarantineInstaller || credentialInventoryMode || migrationOwner !== null || heldElsewhere()) return MIGRATION_OWNED_MESSAGE;
    return null;
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    // Handle state is re-published when every task settles; it only ever GROWS
    // mid-task (in `ensureConnection`), so another instance never sees a handle
    // as released before its release was positively confirmed.
    const guarded = () => task().finally(syncHandle);
    const result = tail.then(guarded, guarded);
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

  const quarantineHooks = quarantineInstaller?.({ enqueue, acquire: acquireTask,
    openBoxed: proceed => {
      if (staleNativeHandle || openCleanupUncertain) return Promise.reject(new NativeStorageUnavailableError("Native cleanup is required."));
      return ensureConnection(proceed, true);
    },
    open: proceed => {
      // A new observation cannot recover this private mode's uncertain handle.
      // Only explicit cleanup/reopen may positively resolve these flags.
      if (staleNativeHandle || openCleanupUncertain) return Promise.reject(new NativeStorageUnavailableError("Native cleanup is required."));
      return ensureConnection(proceed);
    },
    reopen: lease => migrationReopenTask(lease, undefined),
    release: (lease, keep) => migrationReleaseTask(lease, keep),
    phase: () => { if (migrationOwner) migrationOwner.phase = "requires_reopen"; },
    leaseCurrent: (lease, requireReady) => checkLease(lease, requireReady) === null,
    retireReady: lease => checkLease(lease, false) === null && connection === null && !staleNativeHandle && !openCleanupUncertain && !hasBorrowPin(lease),
    retire: lease => {
      if (checkLease(lease, false) !== null || connection !== null || staleNativeHandle || openCleanupUncertain || hasBorrowPin(lease)) return;
      const shared = ownershipOf(databaseName);
      if (shared.migration?.store === self) shared.migration = null;
      migrationOwner = null;
    },
  }) ?? null;
  async function settleNativeVoid(work: unknown): Promise<void> {
    if (quarantineHooks) {
      if (!await quarantineHooks.settleVoid(work)) throw new NativeStorageUnavailableError("Native lifecycle acknowledgement unavailable.");
    } else await work; // Existing ordinary/legacy lifecycle behavior.
  }
  async function invokeNativeVoid(receiver: object, name: "open" | "close" | "closeConnection", args: unknown[] = []): Promise<void> {
    const method = Reflect.get(receiver, name);
    if (quarantineHooks && typeof method !== "function") {
      // An acquired malformed lifecycle dependency still owns its native work.
      await quarantineHooks.settleVoid(method);
      throw new NativeStorageUnavailableError("Native lifecycle method unavailable.");
    }
    if (name === "close") quarantineHooks?.cleanupEvidence?.({ sqlCloseIssued: true });
    if (name === "closeConnection") quarantineHooks?.cleanupEvidence?.({ engineReleaseIssued: true });
    await settleNativeVoid(Reflect.apply(method, receiver, args));
    if (name === "close") quarantineHooks?.cleanupEvidence?.({ sqlCloseAcknowledged: true });
    if (name === "closeConnection") quarantineHooks?.cleanupEvidence?.({ engineReleaseAcknowledged: true });
  }
  async function selectProtocol(open: NativeSqliteConnection, proceed: () => boolean): Promise<CredentialSqliteLayout> {
    if (!quarantineHooks) return discoverProtocol(open, proceed);
    await quarantineHooks.discover(open, proceed);
    return "empty"; // Only a private selection token; never an ordinary bootstrap grant.
  }

  /** Read-only discovery BEFORE bootstrap. Individual D/latch values are left
   * to the existing independent legacy observations (CFR-01). Unknown schema or
   * protocol inventory cannot be treated as an empty records database. */
  async function discoverProtocol(open: NativeSqliteConnection, proceed: () => boolean, emptyInitialization = false, runtimeUnavailable?: object, runtimeMalformed?: (value: unknown) => void): Promise<CredentialSqliteLayout> {
    const malformed = (value?: unknown): never => {
      if (runtimeUnavailable !== undefined) { runtimeMalformed?.(value); throw runtimeUnavailable; }
      throw new ProtocolSelectionError();
    };
    const versionOf = (rows: NativeSqliteRow[]): number => {
      const value = rows[0]?.schema_version;
      if (rows.length !== 1 || typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return malformed(value);
      return value;
    };
    const query = async (sql: string, fields: readonly string[]) => {
      if (!proceed()) throw new OpenCancelledError();
      let rows: NativeSqliteRow[];
      try { rows = discoveryRows(await open.query(sql, []), fields, runtimeUnavailable === undefined ? undefined : (field, value) => {
        // Validate immediately after this descriptor's value is observed. Never
        // read later foreign fields after the first malformed fixed value.
        const numeric = ["schema_version", "cid", "notnull", "pk", "seq", "unique", "partial", "seqno"].includes(field);
        const valid = numeric ? typeof value === "number" && Number.isSafeInteger(value) && (field !== "schema_version" || value >= 0) :
          field === "sql" || field === "dflt_value" ? value === null || typeof value === "string" : typeof value === "string";
        if (!valid) malformed(value);
      }); }
      catch (reason) { if (runtimeUnavailable !== undefined) return malformed(); throw reason; }
      if (!proceed()) throw new OpenCancelledError();
      return rows;
    };
    try {
      const before = await query(SCHEMA_VERSION_SQL, ["schema_version"]);
      const version = versionOf(before);
      const objects = await query(SCHEMA_OBJECTS_SQL, ["type", "name", "tbl_name", "sql"]);
      let kind: CredentialSqliteLayout = "empty";
      if (objects.length !== 0) {
        const metaObjects = credentialInventoryMode
          ? objects.filter(row => row.tbl_name === "curling_credential_meta") : [];
        const recordsObjects = metaObjects.length === 0 ? objects
          : objects.filter(row => row.tbl_name !== "curling_credential_meta");
        const ddl = recordsObjects[1]?.sql;
        if (typeof ddl !== "string" || ![
          "CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
          "CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
        ].includes(ddl) || !exactDiscoveryRows(recordsObjects, [
          { type: "index", name: "sqlite_autoindex_records_1", tbl_name: "records", sql: null },
          { type: "table", name: "records", tbl_name: "records", sql: ddl },
        ])) throw new ProtocolSelectionError();
        kind = "records";
        const columns = await query(RECORD_COLUMNS_SQL, ["cid", "name", "type", "notnull", "dflt_value", "pk"]);
        if (!exactDiscoveryRows(columns, [
          { cid: 0, name: "key", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
          { cid: 1, name: "value", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
        ])) throw new ProtocolSelectionError();
        const indexes = await query(RECORD_INDEXES_SQL, ["seq", "name", "unique", "origin", "partial"]);
        if (!exactDiscoveryRows(indexes, [{ seq: 0, name: "sqlite_autoindex_records_1", unique: 1, origin: "pk", partial: 0 }])) throw new ProtocolSelectionError();
        const indexColumns = await query(RECORD_INDEX_COLUMNS_SQL, ["seqno", "cid", "name"]);
        if (!exactDiscoveryRows(indexColumns, [{ seqno: 0, cid: 0, name: "key" }])) throw new ProtocolSelectionError();
        if (metaObjects.length !== 0) {
          const metaDdl = metaObjects[1]?.sql;
          if (typeof metaDdl !== "string" || ![CREDENTIAL_META_DDL, CREDENTIAL_META_DDL + ";"].includes(metaDdl) ||
            !exactDiscoveryRows(metaObjects, [
              { type: "index", name: "sqlite_autoindex_curling_credential_meta_1", tbl_name: "curling_credential_meta", sql: null },
              { type: "table", name: "curling_credential_meta", tbl_name: "curling_credential_meta", sql: metaDdl },
            ])) throw new ProtocolSelectionError();
          if (!exactDiscoveryRows(await query("PRAGMA table_info('curling_credential_meta');", ["cid", "name", "type", "notnull", "dflt_value", "pk"]), [
            { cid: 0, name: "slot", type: "TEXT", notnull: 1, dflt_value: null, pk: 1 },
            { cid: 1, name: "value", type: "TEXT", notnull: 1, dflt_value: null, pk: 0 },
          ])) throw new ProtocolSelectionError();
          if (!exactDiscoveryRows(await query("PRAGMA index_list('curling_credential_meta');", ["seq", "name", "unique", "origin", "partial"]), [
            { seq: 0, name: "sqlite_autoindex_curling_credential_meta_1", unique: 1, origin: "pk", partial: 0 },
          ])) throw new ProtocolSelectionError();
          if (!exactDiscoveryRows(await query("PRAGMA index_info('sqlite_autoindex_curling_credential_meta_1');", ["seqno", "cid", "name"]), [
            { seqno: 0, cid: 0, name: "slot" },
          ])) throw new ProtocolSelectionError();
          kind = "combined";
        }
        const keys = await query("SELECT key FROM records ORDER BY key;", ["key"]);
        const registered = reservedKeys ?? LEGACY_PROTOCOL_KEYS;
        const seen = new Set<string>();
        for (const { key } of keys) {
          // SQLite BINARY order is UTF-8, not JavaScript UTF-16 order. Complete
          // membership/uniqueness is required; JS sorting supplies no authority.
          if (typeof key !== "string" || seen.has(key)) throw new ProtocolSelectionError();
          seen.add(key);
          const protocol = key.startsWith("curling.nativeMigration.") || key.startsWith("curling.credential") || key.startsWith("curling.installationTransfer.");
          if (protocol && key !== registered.record && key !== registered.latch) throw new ProtocolSelectionError();
        }
      }
      if (kind === "combined") {
        const slots = await query(META_SLOTS_SQL, ["slot"]);
        const seen = new Set<string>();
        for (const { slot } of slots) {
          if (typeof slot !== "string" || !["schema", "q", "f"].includes(slot) || seen.has(slot)) throw new ProtocolSelectionError();
          seen.add(slot);
        }
        // Initializer-specific evidence must retain a positively observed q/f,
        // rather than collapse all supported slot sets to "combined".
        if (emptyInitialization && (seen.size !== 1 || !seen.has("schema"))) throw new ProtocolSelectionError();
      }
      const after = await query(SCHEMA_VERSION_SQL, ["schema_version"]);
      if (versionOf(after) !== version) throw new ProtocolSelectionError();
      if (!proceed()) throw new OpenCancelledError();
      return kind;
    } catch (failure) {
      if ((runtimeUnavailable !== undefined && failure === runtimeUnavailable) || isOpenCancelled(failure)) throw failure;
      throw new ProtocolSelectionError();
    }
  }

  /**
   * Opens the connection if needed. `proceed` is a migration caller's lifecycle:
   * checked after every asynchronous opening step, so a cancelled caller issues
   * no further opening call — a half-opened connection is then cleaned up (close
   * and release) exactly as a failed open is, and `OpenCancelledError` is thrown.
   * Ordinary callers pass nothing and are unaffected.
   */
  function ensureConnection(proceed?: () => boolean, boxed?: false): Promise<NativeSqliteConnection>;
  function ensureConnection(proceed: () => boolean, boxed: true): Promise<Readonly<{ connection: NativeSqliteConnection }>>;
  async function ensureConnection(proceed: () => boolean = () => true, boxed = false): Promise<NativeSqliteConnection | Readonly<{ connection: NativeSqliteConnection }>> {
    const result = (value: NativeSqliteConnection) => boxed ? Object.freeze(Object.assign(Object.create(null), { connection: value })) as Readonly<{ connection: NativeSqliteConnection }> : value;
    if (connection) {
      await selectProtocol(connection, proceed);
      if (!proceed()) throw new OpenCancelledError();
      return result(connection);
    }
    // Never open a handle to a database another instance holds the migration
    // lease on: the plugin addresses connections by name.
    if (heldElsewhere()) throw new Error("held elsewhere");
    lastFailureWasPlatform = false;

    let platform: RuntimePlatform;
    try {
      platform = detectPlatform();
    } catch {
      // A platform signal that throws must not be read as "we are on the Web".
      platform = "unsupported_native";
    }
    if (platform !== "ios" && (quarantineHooks !== null || platform !== "android")) {
      lastFailureWasPlatform = true;
      throw new NativeStorageUnavailableError(
        "Native storage is unavailable on this platform."
      );
    }

    // The ownership reservation is taken HERE — in the same synchronous turn as
    // the ownership check above and the caller's own check, BEFORE the first
    // asynchronous boundary (engine resolution included). A migration lease
    // requested concurrently therefore either already exists (and the check
    // above refused) or sees this reservation and is refused itself; the two can
    // never both proceed.
    opening = true;
    syncHandle();
    let resolved: NativeSqliteEngine;
    try {
      // The source-only creation hook observes the captured engine itself.
      // Do not implicitly assimilate it before that boxed observation.
      resolved = quarantineHooks?.createConnection && engine !== null ? engine : await resolveEngine();
    } catch (error) {
      // No connection was created, so there is nothing to clean up.
      opening = false;
      syncHandle();
      throw error;
    }
    if (!proceed()) {
      opening = false;
      syncHandle();
      throw new OpenCancelledError();
    }
    let opened: NativeSqliteConnection | null = null;
    // Checked AT ISSUANCE as well as after: this helper's own post-call check
    // runs in an earlier microtask than its caller's continuation, so a stop that
    // lands between the two must still prevent the next opening call.
    const step = async (call: () => Promise<unknown>): Promise<void> => {
      if (!proceed()) throw new OpenCancelledError();
      await call();
      if (!proceed()) throw new OpenCancelledError();
    };
    try {
      if (quarantineHooks?.createConnection) {
        const created = await quarantineHooks.createConnection(resolved, databaseName, proceed);
        // Retain even a late positive connection BEFORE the cancellation check,
        // so the original core physically closes/releases it on cancellation.
        opened = created.connection;
      } else opened = await resolved.createConnection(databaseName);
      if (!proceed()) throw new OpenCancelledError();
      const created = opened;
      await step(() => quarantineHooks?.openConnection ? quarantineHooks.openConnection(created, proceed) : invokeNativeVoid(created, "open"));
      const selected = await selectProtocol(created, proceed);
      if (!proceed()) throw new OpenCancelledError();
      // Pragmas first, outside a transaction, ONE STATEMENT PER CALL — see the
      // note on the constants. `journal_mode` returns its resulting value, so it
      // goes through `query`; `synchronous` returns nothing, so it goes through
      // `execute`. Then the schema.
      if (quarantineHooks?.configureConnection) {
        await step(() => quarantineHooks.configureConnection!(created, proceed, SET_JOURNAL_MODE_SQL, SET_SYNCHRONOUS_SQL));
      } else {
        await step(() => created.query(SET_JOURNAL_MODE_SQL, []));
        await step(() => created.execute(SET_SYNCHRONOUS_SQL, false));
      }
      if (!quarantineHooks && !credentialInventoryMode && selected === "empty") await step(() => created.execute(CREATE_TABLE_SQL, true));
      // A successful CREATE acknowledgement is not schema evidence. Re-read
      // the actual layout before any caller receives the connection.
      if (await selectProtocol(created, proceed) !== (quarantineHooks || credentialInventoryMode ? selected : "records")) throw new ProtocolSelectionError();
    } catch (failure) {
      // A half-opened connection must not be left behind for the next attempt to
      // trip over. Best effort: a failing cleanup never replaces the real cause —
      // but it is REMEMBERED, so no other instance is granted a lease over a
      // handle this one may still hold.
      // The native-handle release by name is the DECIDING step: it closes the
      // database if open and drops the plugin's entry. A rejected `close()` alone
      // is not uncertainty — Android's plugin rejects closing a connection that
      // never opened ("Database not opened") — but a rejected release is.
      if (opened !== null) {
        try {
          await invokeNativeVoid(opened, "close");
        } catch {
          /* decided by the release below */
        }
      }
      let cleaned = true;
      try {
        await invokeNativeVoid(resolved, "closeConnection", [databaseName]);
      } catch {
        cleaned = false;
      }
      openCleanupUncertain = openCleanupUncertain || !cleaned;
      if (credentialInventoryMode && openCleanupUncertain && migrationOwner !== null) {
        migrationOwner.phase = "requires_reopen";
      }
      opening = false;
      syncHandle();
      if (isOpenCancelled(failure)) throw failure;
      if (isProtocolSelectionError(failure)) throw failure;
      throw new NativeStorageUnavailableError(
        "The native storage database could not be opened."
      );
    }
    connection = opened;
    opening = false;
    syncHandle();
    return result(opened);
  }

  async function getTask(key: string): Promise<StorageGetResult> {
    // A read issued inside someone else's open transaction would see that
    // transaction's UNCOMMITTED rows on this same connection, which is the
    // single most misleading observation this store could produce.
    const held = exclusiveOwnerMessage();
    if (held !== null) return readFailure({ kind: "unknown", message: held });
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
    const held = exclusiveOwnerMessage();
    if (held !== null) return writeFailed({ kind: "unknown", message: held });
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
    const held = exclusiveOwnerMessage();
    if (held !== null) return removeFailed({ kind: "removal_failed", message: held });
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
    if (exclusiveOwnerMessage() !== null) return { ok: false, reason: "operation_failed" };
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
    if (exclusiveOwnerMessage() !== null) return { ok: false, reason: "operation_failed" };
    const open = connection;
    // Cleared before awaiting anything, so a concurrent caller queued behind
    // this one reopens rather than reusing a handle that is being torn down.
    connection = null;
    if (open === null) {
      // Nothing this owner opened. Not an error: closing a closed store is a
      // no-op, and the next operation opens again — unless an earlier close or a
      // failed open's cleanup left a native handle unconfirmed. Then the release
      // is attempted here, because only a confirmed release lets another store
      // instance be granted ownership of this database.
      if ((staleNativeHandle || openCleanupUncertain) && engine) {
        try {
          await engine.closeConnection(databaseName);
          staleNativeHandle = false;
          openCleanupUncertain = false;
        } catch (error) {
          return { ok: false, reason: classifyControlFailure(error, false) };
        }
      }
      return { ok: true };
    }
    try {
      await open.close();
      if (engine) await engine.closeConnection(databaseName);
      staleNativeHandle = false;
      openCleanupUncertain = false;
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
    if (exclusiveOwnerMessage() !== null) {
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
    if (staleNativeHandle || openCleanupUncertain) {
      try {
        if (engine) await engine.closeConnection(databaseName);
        staleNativeHandle = false;
        openCleanupUncertain = false;
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
    if (exclusiveOwnerMessage() !== null) return { ok: false, reason: "operation_failed" };
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
    // A migration lease is an owner too: a diagnostic transaction never opens
    // underneath it.
    if (exclusiveOwnerMessage() !== null) {
      return { ok: false, reason: "transaction_pending" };
    }
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
        await discoverProtocol(open, () => true);
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
      await discoverProtocol(open, () => true);
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
      await discoverProtocol(open, () => true);
    } catch {
      return { ok: false, reason: "protocol_refused", cleanup: await rollbackAfterFailure(open) };
    }
    try { acknowledged = isTransactionAcknowledgement(await open.commitTransaction()); }
    catch { acknowledged = false; }
    if (acknowledged) {
      pendingTransaction = null;
      return { ok: true };
    }
    // A rejected — or unreadably answered — COMMIT says nothing about what
    // reached the database. The rollback below frees the connection only if it
    // is itself acknowledged; it never establishes that nothing was committed,
    // and no caller may read it that way. (If the COMMIT did take effect, the
    // ROLLBACK finds no transaction: on iOS it rejects and ownership stays
    // `uncertain`; on Android the plugin ACKNOWLEDGES a ROLLBACK with no active
    // transaction, so ownership is released although the COMMIT may have
    // landed. Either way only a reopened read classifies the attempt — which is
    // why the migration capability below never rolls back after a COMMIT.)
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
    openCleanupUncertain = false;
    return { ok: true };
  }

/* ------------------------------------------------------------------
   * The migration-only target capability (Stage M3b4b). See the section
   * comment above `NativeMigrationReservedKeys`.
   * ------------------------------------------------------------------ */

  /** The caller's lifecycle as a total predicate: a throw is "stop". */
  function proceedOf(control: NativeMigrationControl | undefined): () => boolean {
    return () => {
      try {
        return control?.proceed === undefined || control.proceed() === true;
      } catch {
        return false;
      }
    };
  }

  /** A lease is valid only as THE object this instance issued, while this
   * instance is the database's registered owner. An equal id is not enough. */
  function checkLease(lease: NativeMigrationLease, requireReady: boolean): NativeMigrationRefusal | null {
    if (migrationOwner === null) return heldElsewhere() ? "wrong_lease" : "no_lease";
    if (migrationOwner.lease !== lease || ownershipOf(databaseName).migration?.store !== self) return "wrong_lease";
    if (requireReady && migrationOwner.phase !== "ready") return "requires_reopen";
    // A borrowed collection can lose readiness BETWEEN its independent reads.
    // Gate each new task, not just runner entry. Issued TX controls use false,
    // so their own requires_reopen phase/handle work does not self-cancel.
    if (requireReady && hasBorrowPin(lease) && (opening || staleNativeHandle || openCleanupUncertain)) return "requires_reopen";
    return null;
  }

  async function acquireTask(): Promise<NativeMigrationAcquireResult> {
    if (pendingTransaction !== null) return { ok: false, reason: "diagnostic_transaction_pending" };
    const shared = ownershipOf(databaseName);
    if (migrationOwner !== null || shared.migration !== null) return { ok: false, reason: "lease_held" };
    if ([...shared.handles].some((holder) => holder !== self)) return { ok: false, reason: "connection_held_elsewhere" };
    nextContextLeaseOrdinal += 1;
    const lease: NativeMigrationLease = Object.freeze({ id: `${databaseName}#migration-${nextContextLeaseOrdinal}` });
    rotateBorrowBoundary();
    borrowUncertain = openCleanupUncertain || staleNativeHandle;
    migrationOwner = { lease, phase: "ready", generation: 0 };
    shared.migration = { store: self, owner: migrationOwner };
    return { ok: true, lease };
  }

  async function readReservedTask(
    keys: NativeMigrationReservedKeys,
    lease: NativeMigrationLease,
    control: NativeMigrationControl | undefined
  ): Promise<NativeMigrationReadResult> {
    const refusal = checkLease(lease, true);
    if (refusal) return { ok: false, reason: refusal };
    const proceed = proceedOf(control);
    const cancelled: NativeMigrationReadResult = { ok: false, reason: "cancelled" };
    if (!proceed()) return cancelled;
    const failed: NativeMigrationObservation = { status: "read_failed" };
    let open: NativeSqliteConnection;
    try {
      open = await ensureConnection(proceed);
    } catch (error) {
      if (isOpenCancelled(error)) return cancelled;
      if (isProtocolSelectionError(error)) return { ok: false, reason: "protocol_refused" };
      return { ok: true, record: failed, latch: failed };
    }
    if (!proceed()) return cancelled;
    // Each read independently: an unreadable record must not hide the latch.
    const read = async (key: string): Promise<NativeMigrationObservation> => {
      try {
        return readMigrationValue(await open.query(SELECT_VALUE_SQL, [key]));
      } catch {
        return failed;
      }
    };
    const latch = await read(keys.latch);
    // A cancelled caller issues no second query.
    if (!proceed()) return cancelled;
    const record = await read(keys.record);
    if (!proceed()) return cancelled;
    return { ok: true, record, latch };
  }

  async function listKeysOn(open: NativeSqliteConnection, keys: NativeMigrationReservedKeys): Promise<NativeMigrationKeyListing> {
    try {
      return readKeyListing(await open.query(SELECT_ALL_KEYS_SQL, []), keys);
    } catch {
      return { status: "read_failed" };
    }
  }

  async function readValueOn(open: NativeSqliteConnection, key: string): Promise<NativeMigrationObservation> {
    try {
      return readMigrationValue(await open.query(SELECT_VALUE_SQL, [key]));
    } catch {
      return { status: "read_failed" };
    }
  }

  async function listTask(
    keys: NativeMigrationReservedKeys,
    lease: NativeMigrationLease,
    control: NativeMigrationControl | undefined
  ): Promise<NativeMigrationListResult> {
    const refusal = checkLease(lease, true);
    if (refusal) return { status: "refused", reason: refusal };
    const proceed = proceedOf(control);
    const cancelled: NativeMigrationListResult = { status: "refused", reason: "cancelled" };
    if (!proceed()) return cancelled;
    let open: NativeSqliteConnection;
    try {
      open = await ensureConnection(proceed);
    } catch (error) {
      if (isOpenCancelled(error)) return cancelled;
      return isProtocolSelectionError(error) ? { status: "refused", reason: "protocol_refused" } : { status: "read_failed" };
    }
    if (!proceed()) return cancelled;
    const listing = await listKeysOn(open, keys);
    return proceed() ? listing : cancelled;
  }

  async function valuesTask(
    keys: NativeMigrationReservedKeys,
    lease: NativeMigrationLease,
    requested: readonly string[],
    control: NativeMigrationControl | undefined
  ): Promise<NativeMigrationValuesResult> {
    const refusal = checkLease(lease, true);
    if (refusal) return { ok: false, reason: refusal };
    if (!Array.isArray(requested) || requested.some((key) => typeof key !== "string" || key === keys.record || key === keys.latch)) {
      return { ok: false, reason: "invalid_transaction" };
    }
    const proceed = proceedOf(control);
    const cancelled: NativeMigrationValuesResult = { ok: false, reason: "cancelled" };
    if (!proceed()) return cancelled;
    const values = new Map<string, NativeMigrationObservation>();
    let open: NativeSqliteConnection | null = null;
    try {
      open = await ensureConnection(proceed);
    } catch (error) {
      if (isOpenCancelled(error)) return cancelled;
      if (isProtocolSelectionError(error)) return { ok: false, reason: "protocol_refused" };
      open = null;
    }
    for (const key of requested) {
      // Checked before EVERY further query: a cancelled caller issues no more.
      if (!proceed()) return cancelled;
      values.set(key, open === null ? { status: "read_failed" } : await readValueOn(open, key));
    }
    if (!proceed()) return cancelled;
    return { ok: true, values };
  }

  /** Whether a transaction request is one the approved plans issue. Checked before BEGIN. */
  function wellFormedTransaction(tx: NativeMigrationTransaction, keys: NativeMigrationReservedKeys): boolean {
    try {
      switch (tx.kind) {
        case "create_record":
          return typeof tx.recordAfter === "string";
        case "replace_record":
          return typeof tx.recordBefore === "string" && typeof tx.recordAfter === "string" &&
            typeof tx.requireNoApplicationRows === "boolean" &&
            (tx.verifyCompleteEvidence === undefined || typeof tx.verifyCompleteEvidence === "function");
        case "checkpoint": {
          if (typeof tx.recordBefore !== "string" || typeof tx.recordAfter !== "string") return false;
          if (!Array.isArray(tx.rows) || tx.rows.length === 0) return false; // never an empty checkpoint
          const seen = new Set<string>();
          for (const row of tx.rows) {
            if (typeof row.key !== "string" || typeof row.value !== "string") return false;
            if (row.key === keys.record || row.key === keys.latch || seen.has(row.key)) return false;
            seen.add(row.key);
          }
          return true;
        }
        case "insert_latch":
          return typeof tx.content === "string";
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  async function transactTask(
    keys: NativeMigrationReservedKeys,
    lease: NativeMigrationLease,
    tx: NativeMigrationTransaction,
    control: NativeMigrationTransactionControl | undefined,
    issuance?: CredentialInitializationIssuance
  ): Promise<NativeMigrationTransactionResult> {
    const refusal = checkLease(lease, true);
    if (refusal) return { status: "refused", reason: refusal };
    const permission = combinedHeldMode ? combinedController?.consume(lease, tx) : "normal";
    if (!permission || !wellFormedTransaction(tx, keys)) return { status: "refused", reason: "invalid_transaction" };
    /** The caller's lifecycle, re-checked after every asynchronous boundary. */
    const proceed = proceedOf(control);
    if (!proceed()) return { status: "refused", reason: "cancelled" };
    const owner = migrationOwner as MigrationOwner;
    let open: NativeSqliteConnection;
    try {
      open = await ensureConnection(proceed);
    } catch (error) {
      if (isOpenCancelled(error)) return { status: "refused", reason: "cancelled" };
      if (isProtocolSelectionError(error)) return { status: "refused", reason: "protocol_refused" };
      return { status: "not_begun", reason: classifyControlFailure(error, lastFailureWasPlatform) };
    }
    // Opening may have crossed several asynchronous boundaries: the caller may
    // have stopped meanwhile. BEGIN is never issued for a stopped caller.
    if (!proceed()) return { status: "refused", reason: "cancelled" };

    // From the moment BEGIN is issued a native transaction may exist whether or
    // not its answer arrives, so the lease is uncertain BEFORE the call.
    owner.phase = "requires_reopen";
    if (issuance) issuance.beginIssued = true;
    let begun = false;
    try {
      begun = isTransactionAcknowledgement(await open.beginTransaction());
    } catch {
      begun = false;
    }
    if (!begun) {
      return { status: "not_committed", reason: "begin_unacknowledged", writeIssued: false, connection: "uncertain" };
    }
    /** Writes issued so far in this transaction, for an honest cancellation report. */
    let wroteAny = false;

    /** No COMMIT is issued on this path. A positively acknowledged ROLLBACK frees
     * the connection; anything else leaves the lease in `requires_reopen`. */
    const abort = async (
      reason: NativeMigrationNotCommittedReason,
      writeIssued: boolean
    ): Promise<NativeMigrationTransactionResult> => {
      let clean = false;
      try {
        clean = isTransactionAcknowledgement(await open.rollbackTransaction());
      } catch {
        clean = false;
      }
      if (clean) { owner.phase = "ready"; if (issuance) issuance.rollbackAcknowledged = true; }
      return { status: "not_committed", reason, writeIssued, connection: clean ? "clean" : "uncertain" };
    };

    // --- Expected state, read inside the transaction, before any write. Every
    // `stopped()` below is a lifecycle check after an asynchronous boundary. ---
    const stopped = () => !proceed();
    if (stopped()) return abort("cancelled", false);
    try {
      await discoverProtocol(open, proceed);
    } catch (error) {
      return abort(isOpenCancelled(error) ? "cancelled" : "protocol_refused", false);
    }
    if (stopped()) return abort("cancelled", false);
    if (tx.kind === "insert_latch") {
      const latch = await readValueOn(open, keys.latch);
      if (stopped()) return abort("cancelled", false);
      if (latch.status === "read_failed") return abort("evidence_unreadable", false);
      if (latch.status === "present") return abort("latch_already_present", false);
    } else {
      const record = await readValueOn(open, keys.record);
      if (stopped()) return abort("cancelled", false);
      if (record.status === "read_failed") return abort("evidence_unreadable", false);
      const expected = tx.kind === "create_record" ? null : tx.recordBefore;
      const matches = expected === null
        ? record.status === "absent"
        : record.status === "present" && record.bytes === expected;
      if (!matches) return abort("precondition_failed", false);

      const needsListing = tx.kind === "create_record" ||
        (tx.kind === "replace_record" && (tx.requireNoApplicationRows || tx.verifyCompleteEvidence !== undefined));
      if (needsListing) {
        const listing = await listKeysOn(open, keys);
        if (stopped()) return abort("cancelled", false);
        if (listing.status === "read_failed") return abort("evidence_unreadable", false);
        const mustBeEmpty = tx.kind === "create_record" || (tx.kind === "replace_record" && tx.requireNoApplicationRows);
        if (mustBeEmpty && listing.keys.length > 0) return abort("precondition_failed", false);
        if (tx.kind === "replace_record" && tx.verifyCompleteEvidence !== undefined) {
          const rows: NativeMigrationRow[] = [];
          for (const key of listing.keys) {
            const value = await readValueOn(open, key);
            if (stopped()) return abort("cancelled", false);
            if (value.status !== "present") return abort("evidence_unreadable", false);
            rows.push(Object.freeze({ key, value: value.bytes }));
          }
          let accepted = false;
          try {
            accepted = (await tx.verifyCompleteEvidence(Object.freeze(rows))) === true;
          } catch {
            accepted = false;
          }
          // The verifier is asynchronous (it digests); the lifecycle may have ended meanwhile.
          if (stopped()) return abort("cancelled", false);
          if (!accepted) return abort("evidence_mismatch", false);
        }
      }
      if (tx.kind === "checkpoint") {
        for (const row of tx.rows) {
          const existing = await readValueOn(open, row.key);
          if (stopped()) return abort("cancelled", false);
          if (existing.status === "read_failed") return abort("evidence_unreadable", false);
          if (existing.status !== "absent") return abort("precondition_failed", false);
        }
      }
    }

    // The verifier may await a digest. Its old schema selection cannot authorize
    // a write after that callback changed the evidence.
    try {
      await discoverProtocol(open, proceed);
    } catch (error) {
      return abort(isOpenCancelled(error) ? "cancelled" : "protocol_refused", false);
    }
    if (stopped()) return abort("cancelled", false);
    if (combinedHeldMode && !await combinedControlSelection(open, proceed, permission === "latch")) return abort(stopped() ? "cancelled" : "precondition_failed", false);
    if (stopped()) return abort("cancelled", false);

    // --- The writes. `transaction: false` on every one of them. ---
    const statements: Array<[string, unknown[]]> = [];
    switch (tx.kind) {
      case "create_record":
        statements.push([INSERT_NEW_ROW_SQL, [keys.record, tx.recordAfter]]);
        break;
      case "replace_record":
        statements.push([UPDATE_VALUE_SQL, [tx.recordAfter, keys.record]]);
        break;
      case "checkpoint":
        for (const row of tx.rows) statements.push([INSERT_NEW_ROW_SQL, [row.key, row.value]]);
        statements.push([UPDATE_VALUE_SQL, [tx.recordAfter, keys.record]]);
        break;
      case "insert_latch":
        statements.push([INSERT_NEW_ROW_SQL, [keys.latch, tx.content]]);
        break;
    }
    for (const [statement, values] of statements) {
      if (stopped()) return abort("cancelled", wroteAny);
      let acknowledged = false;
      wroteAny = true;
      if (issuance) issuance.writeIssued = true;
      try {
        acknowledged = isSingleRowChange(await open.run(statement, values, false));
      } catch {
        acknowledged = false;
      }
      if (!acknowledged) return abort("statement_failed", true);
    }
    // The last point at which stopping is still a rollback. Once COMMIT is
    // issued its real outcome is awaited and reported — cancellation does not undo it.
    if (stopped()) return abort("cancelled", true);
    try {
      await discoverProtocol(open, proceed);
    } catch (error) {
      return abort(isOpenCancelled(error) ? "cancelled" : "protocol_refused", wroteAny);
    }
    if (stopped()) return abort("cancelled", wroteAny);
    if (combinedHeldMode && !await combinedControlSelection(open, proceed, permission === "latch")) return abort(stopped() ? "cancelled" : "precondition_failed", wroteAny);
    if (stopped()) return abort("cancelled", wroteAny);

    let committed = false;
    if (issuance) issuance.commitIssued = true;
    try {
      committed = isTransactionAcknowledgement(await open.commitTransaction());
    } catch {
      committed = false;
    }
    if (!committed) {
      // Deliberately NO rollback: its acknowledgement could not tell a
      // rolled-back transaction from a committed one (see the section comment).
      return { status: "outcome_unknown" };
    }
    owner.phase = "ready";
    if (issuance) issuance.commitAcknowledged = true;
    return { status: "confirmed" };
  }

  /** Close → release → fresh open, each step established before the next. */
  async function migrationReopenTask(
    lease: NativeMigrationLease,
    control: NativeMigrationControl | undefined
  ): Promise<NativeMigrationReopenResult> {
    const refusal = checkLease(lease, false);
    if (refusal) return { ok: false, reason: refusal };
    const proceed = proceedOf(control);
    const cancelled: NativeMigrationReopenResult = { ok: false, reason: "cancelled" };
    if (!proceed()) return cancelled;
    const owner = migrationOwner as MigrationOwner;
    // A stopped reopen leaves the lease in `requires_reopen`: a later reopen —
    // disposal's own, without a control — completes it.
    owner.phase = "requires_reopen";
    const open = connection;
    if (open !== null) {
      try {
        await invokeNativeVoid(open, "close");
      } catch (error) {
        // The handle is kept: it may still be open, possibly inside a transaction.
        return { ok: false, boundary: "close", reason: classifyControlFailure(error, false) };
      }
      connection = null;
      staleNativeHandle = true;
      if (!proceed()) return cancelled;
    }
    if (staleNativeHandle || openCleanupUncertain) {
      try {
        // Explicit, and checked. The binding's own best-effort release inside
        // `createConnection` swallows failures, so it is never relied on here.
        if (engine) await invokeNativeVoid(engine, "closeConnection", [databaseName]);
        staleNativeHandle = false;
        openCleanupUncertain = false;
      } catch (error) {
        return { ok: false, boundary: "release", reason: classifyControlFailure(error, false) };
      }
    }
    if (!proceed()) return cancelled;
    try {
      if (quarantineHooks?.createConnection) await ensureConnection(proceed, true);
      else await ensureConnection(proceed);
    } catch (error) {
      if (isOpenCancelled(error)) return cancelled;
      return { ok: false, boundary: "open", reason: classifyControlFailure(error, lastFailureWasPlatform) };
    }
    owner.phase = "ready";
    owner.generation += 1;
    return { ok: true, generation: owner.generation };
  }

  /**
   * Gives up the lease. Accepted in `requires_reopen` too: a positively
   * established close AND native-handle release end any native transaction at
   * the engine (the same reasoning the diagnostics abandon path uses), so no
   * fresh open — no new work — is needed first. If either step fails, the lease
   * and its phase are KEPT. Releasing never resolves what an uncertain COMMIT did.
   */
  async function migrationReleaseTask(lease: NativeMigrationLease, keepReservation = false): Promise<NativeMigrationReleaseResult> {
    const refusal = checkLease(lease, false);
    if (refusal) return { ok: false, reason: refusal };
    if (hasBorrowPin(lease)) return { ok: false, reason: "borrowed_evidence_held" };
    if (combinedHeldMode && combinedControlStop) return { ok: false, reason: "control_evidence_held" };
    // S3b never reuses a possibly half-closed/released handle. A failed direct
    // release keeps the owner but closes observation until positive reopen.
    if (credentialInventoryMode && migrationOwner !== null) migrationOwner.phase = "requires_reopen";
    const open = connection;
    if (open !== null) {
      try {
        await invokeNativeVoid(open, "close");
      } catch {
        return { ok: false, boundary: "close" };
      }
      connection = null;
      staleNativeHandle = true;
    }
    if (staleNativeHandle || openCleanupUncertain) {
      try {
        if (engine) {
          await invokeNativeVoid(engine, "closeConnection", [databaseName]);
        }
        staleNativeHandle = false;
        openCleanupUncertain = false;
      } catch {
        return { ok: false, boundary: "release" };
      }
    }
    if (keepReservation) return { ok: true };
    // Closed and released: the next owner opens a genuinely fresh connection.
    const shared = ownershipOf(databaseName);
    if (shared.migration?.store === self) shared.migration = null;
    migrationOwner = null;
    return { ok: true };
  }

  /** Strict, independent control observations, never semantic authority. */
  async function credentialControlOn(
    open: NativeSqliteConnection, sql: string, key: string, validateField?: (name: string, value: unknown) => void
  ): Promise<NativeMigrationObservation> {
    try {
      const rows = discoveryRows(await open.query(sql, [key]), ["value"], validateField);
      if (rows.length === 0) return Object.freeze({ status: "absent" });
      if (rows.length === 1 && typeof rows[0].value === "string") {
        return Object.freeze({ status: "present", bytes: rows[0].value });
      }
    } catch { /* Native values/reasons never escape. */ }
    return Object.freeze({ status: "read_failed" });
  }

  async function combinedControlSelection(open: NativeSqliteConnection, proceed: () => boolean, latchOnly = false): Promise<boolean> {
    if (!combinedHeldMode) return true;
    const lifecycle = borrowLifecycle;
    try {
    if (!proceed()) return false;
    const layout = await discoverProtocol(open, proceed);
    noteCombinedLayout(layout, lifecycle);
    if (layout !== "combined") return false;
    for (const slot of ["schema", "q", "f"] as const) {
      if (!proceed()) return false;
      const value = await credentialControlOn(open, META_VALUE_SQL, slot);
      noteCombinedControl(slot, value, lifecycle); // retain obtained faults BEFORE cancellation
      if (!proceed()) return false;
    }
    return latchOnly ? combinedControls.schema === "valid" : combinedProgress();
    } catch { return false; }
  }

  async function credentialObserveTask(
    lease: NativeMigrationLease, control?: NativeMigrationControl
  ): Promise<NativeCredentialSqliteObservation> {
    const refusal = checkLease(lease, true);
    if (refusal) return { ok: false, reason: refusal };
    const lifecycle = borrowLifecycle;
    const allowed = proceedOf(control);
    const proceed = () => checkLease(lease, false) === null && allowed();
    const cancelled = { ok: false, reason: "cancelled" } as const;
    if (!proceed()) return cancelled;
    let open: NativeSqliteConnection;
    let layout: CredentialSqliteLayout;
    try {
      open = await ensureConnection(proceed);
      layout = await discoverProtocol(open, proceed);
    } catch (error) {
      return { ok: false, reason: isOpenCancelled(error) ? "cancelled" :
        isProtocolSelectionError(error) ? "protocol_refused" : classifyControlFailure(error, lastFailureWasPlatform) };
    }
    noteCombinedLayout(layout, lifecycle);
    if (!proceed()) return cancelled;
    const absent: NativeMigrationObservation = Object.freeze({ status: "absent" });
    // Read every present family independently, including positive fault evidence
    // when another control cannot be read. No aggregate truthy/absence decision.
    const latch = layout === "empty" ? absent : await credentialControlOn(open, SELECT_VALUE_SQL, LEGACY_PROTOCOL_KEYS.latch);
    if (combinedHeldMode) combinedController?.publishDomain(lease, { latch });
    if (!proceed()) return cancelled;
    const record = layout === "empty" ? absent : await credentialControlOn(open, SELECT_VALUE_SQL, LEGACY_PROTOCOL_KEYS.record);
    if (combinedHeldMode) combinedController?.publishDomain(lease, { latch, record });
    if (!proceed()) return cancelled;
    const f = layout !== "combined" ? absent : await credentialControlOn(open, META_VALUE_SQL, "f");
    if (combinedHeldMode && layout === "combined") noteCombinedControl("f", f, lifecycle);
    if (!proceed()) return cancelled;
    const schema = layout !== "combined" ? absent : await credentialControlOn(open, META_VALUE_SQL, "schema");
    if (combinedHeldMode && layout === "combined") noteCombinedControl("schema", schema, lifecycle);
    if (!proceed()) return cancelled;
    const q = layout !== "combined" ? absent : await credentialControlOn(open, META_VALUE_SQL, "q");
    if (combinedHeldMode && layout === "combined") noteCombinedControl("q", q, lifecycle);
    if (!proceed()) return cancelled;
    return Object.freeze({ ok: true, layout, record, latch, schema, q, f });
  }

  /** Fixed schema bootstrap ONLY over a freshly proved completely empty target.
   * There are no caller-provided bytes, SQL, progress or grant callbacks. */
  async function credentialInitializeTask(
    lease: NativeMigrationLease, issuance: CredentialInitializationIssuance, control?: NativeMigrationControl
  ): Promise<NativeCredentialInitializationResult> {
    if (combinedHeldMode && checkLease(lease, false) === null) {
      if (hasBorrowPin(lease)) return { status: "refused", reason: "borrowed_evidence_held" };
      if (combinedControlStop) return { status: "refused", reason: "control_evidence_held" };
    }
    const refusal = checkLease(lease, true);
    if (refusal) return { status: "refused", reason: refusal };
    const lifecycle = borrowLifecycle;
    const allowed = proceedOf(control);
    const proceed = () => checkLease(lease, false) === null && allowed();
    if (!proceed()) return { status: "refused", reason: "cancelled" };
    const owner = migrationOwner as MigrationOwner;
    let open: NativeSqliteConnection;
    let before: CredentialSqliteLayout;
    const emptyRecords = async () => {
      if (!proceed()) throw new OpenCancelledError();
      const rows = discoveryRows(await open.query("SELECT key FROM records ORDER BY key;", []), ["key"]);
      if (!proceed()) throw new OpenCancelledError();
      return rows.length === 0;
    };
    try {
      open = await ensureConnection(proceed);
      before = await discoverProtocol(open, proceed);
      noteCombinedLayout(before, lifecycle);
      if (!proceed()) return { status: "refused", reason: "cancelled" };
      if (combinedHeldMode && combinedControlStop) return { status: "refused", reason: "control_evidence_held" };
      if (before === "combined") return { status: "refused", reason: "already_initialized" };
      if (before === "records" && !await emptyRecords()) return { status: "refused", reason: "target_not_empty" };
    } catch (error) {
      if (isOpenCancelled(error)) return { status: "refused", reason: "cancelled" };
      if (isProtocolSelectionError(error)) return { status: "refused", reason: "protocol_refused" };
      return { status: "not_begun", reason: classifyControlFailure(error, lastFailureWasPlatform) };
    }
    if (!proceed()) return { status: "refused", reason: "cancelled" };
    owner.phase = "requires_reopen"; // Before BEGIN issuance, including a held result.
    let begun = false;
    issuance.beginIssued = true;
    try { begun = isTransactionAcknowledgement(await open.beginTransaction()); } catch { /* Unacknowledged. */ }
    if (!begun) return { status: "not_committed", reason: "begin_unacknowledged", writeIssued: false, connection: "uncertain" };
    let writeIssued = false;
    let commitIssued = false;
    const abort = async (reason: NativeMigrationNotCommittedReason): Promise<NativeCredentialInitializationResult> => {
      let clean = false;
      try { clean = isTransactionAcknowledgement(await open.rollbackTransaction()); } catch { /* Uncertain. */ }
      issuance.rollbackAcknowledged = clean;
      if (clean) owner.phase = "ready";
      return { status: "not_committed", reason, writeIssued, connection: clean ? "clean" : "uncertain" };
    };
    try {
      if (!proceed()) return abort("cancelled");
      const currentLayout = await discoverProtocol(open, proceed);
      noteCombinedLayout(currentLayout, lifecycle);
      if (currentLayout !== before || (combinedHeldMode && combinedControlStop)) return abort("precondition_failed");
      if (!proceed()) return abort("cancelled");
      if (before === "records" && !await emptyRecords()) return abort("precondition_failed");
      // No IF NOT EXISTS repair; all DDL is in this same owned transaction.
      const ddl = before === "empty"
        ? ["CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);", CREDENTIAL_META_DDL + ";"]
        : [CREDENTIAL_META_DDL + ";"];
      for (const sql of ddl) {
        if (!proceed()) return abort("cancelled");
        writeIssued = issuance.writeIssued = true;
        if (!isTransactionAcknowledgement(await open.execute(sql, false))) return abort("statement_failed");
        if (!proceed()) return abort("cancelled");
      }
      if (!proceed()) return abort("cancelled");
      writeIssued = issuance.writeIssued = true;
      if (!isSingleRowChange(await open.run(
        "INSERT INTO curling_credential_meta (slot, value) VALUES (?, ?);", ["schema", CREDENTIAL_SCHEMA_MARKER], false
      ))) return abort("statement_failed");
      if (!proceed()) return abort("cancelled");
      if (await discoverProtocol(open, proceed) !== "combined") return abort("protocol_refused");
      if (!await emptyRecords()) return abort("precondition_failed");
      for (const slot of ["schema", "q", "f"]) {
        if (!proceed()) return abort("cancelled");
        const value = await credentialControlOn(open, META_VALUE_SQL, slot);
        if (!proceed()) return abort("cancelled");
        if (value.status === "read_failed") return abort("evidence_unreadable");
        if (slot === "schema" ? value.status !== "present" || value.bytes !== CREDENTIAL_SCHEMA_MARKER : value.status !== "absent") {
          return abort("evidence_mismatch");
        }
      }
      // Control reads are awaited bridge calls too. Preserve the exact expected
      // slot set through final discovery, then re-read the entire after tuple.
      if (await discoverProtocol(open, proceed, true) !== "combined") return abort("protocol_refused");
      if (!proceed()) return abort("cancelled");
      const finalMeta = discoveryRows(await open.query("SELECT slot,value FROM curling_credential_meta ORDER BY slot;", []), ["slot", "value"]);
      if (!proceed()) return abort("cancelled");
      if (!exactDiscoveryRows(finalMeta, [{ slot: "schema", value: CREDENTIAL_SCHEMA_MARKER }])) return abort("evidence_mismatch");
      if (!await emptyRecords()) return abort("precondition_failed");
      if (!proceed()) return abort("cancelled");
      commitIssued = issuance.commitIssued = true;
      let committed = false;
      try { committed = isTransactionAcknowledgement(await open.commitTransaction()); } catch { /* Outcome unknown. */ }
      // No ROLLBACK after COMMIT issuance: it cannot disambiguate commit/rollback.
      if (!committed) return { status: "outcome_unknown" };
      issuance.commitAcknowledged = true;
      owner.phase = "ready";
      return { status: "confirmed" };
    } catch (error) {
      if (commitIssued) return { status: "outcome_unknown" };
      return abort(isOpenCancelled(error) ? "cancelled" : isProtocolSelectionError(error) ? "protocol_refused" : "statement_failed");
    }
  }

  function markMigrationUncertain(): void {
    if (migrationOwner !== null) migrationOwner.phase = "requires_reopen";
  }

  let migration: NativeSqliteMigrationTarget | null = null;
  if (reservedKeys !== null && (!credentialInventoryMode || combinedHeldMode)) {
    const keys = reservedKeys;
    migration = {
      acquire: () =>
        enqueue(acquireTask).catch((): NativeMigrationAcquireResult => ({ ok: false, reason: "lease_held" })),
      checkProtocolSelection: (lease, control) => enqueue(async () => {
        const refusal = checkLease(lease, true);
        if (refusal) return { ok: false as const, reason: refusal };
        const proceed = proceedOf(control);
        if (!proceed()) return { ok: false as const, reason: "cancelled" as const };
        try {
          const open = await ensureConnection(proceed);
          if (combinedHeldMode && !await combinedControlSelection(open, proceed)) return { ok: false as const, reason: "controls_unproven" as const };
          return proceed() ? { ok: true as const } : { ok: false as const, reason: "cancelled" as const };
        } catch (error) {
          return { ok: false as const, reason: isOpenCancelled(error) ? "cancelled" as const : "protocol_refused" as const };
        }
      }).catch(() => ({ ok: false as const, reason: "protocol_refused" as const })),
      readReserved: (lease, control) =>
        enqueue(() => readReservedTask(keys, lease, control)).catch((): NativeMigrationReadResult => ({
          ok: true,
          record: { status: "read_failed" },
          latch: { status: "read_failed" },
        })),
      listApplicationKeys: (lease, control) =>
        enqueue(() => listTask(keys, lease, control)).catch((): NativeMigrationListResult => ({ status: "read_failed" })),
      readValues: (lease, requested, control) =>
        enqueue(() => valuesTask(keys, lease, requested, control)).catch((): NativeMigrationValuesResult => ({
          ok: true,
          values: new Map(
            (Array.isArray(requested) ? requested : []).map((key) => [String(key), { status: "read_failed" as const }])
          ),
        })),
      transact: (lease, tx, control) => {
        const tracked = checkLease(lease, false) === null;
        if (tracked) { borrowEvidence = Object.freeze({}); borrowPending += 1; }
        const issuance: CredentialInitializationIssuance | undefined = combinedHeldMode ? { beginIssued: false, writeIssued: false, commitIssued: false, commitAcknowledged: false, rollbackAcknowledged: false } : undefined;
        return enqueue(() => transactTask(keys, lease, tx, control, issuance)).catch((): NativeMigrationTransactionResult => {
          if (issuance) {
            if (issuance.commitAcknowledged) return { status: "confirmed" };
            if (!issuance.beginIssued) return { status: "not_begun", reason: "operation_failed" };
            if (!issuance.rollbackAcknowledged) markMigrationUncertain();
            if (!issuance.commitIssued) return { status: "not_committed", reason: "statement_failed", writeIssued: issuance.writeIssued, connection: issuance.rollbackAcknowledged ? "clean" : "uncertain" };
          }
          markMigrationUncertain();
          return { status: "outcome_unknown" };
        }).finally(() => { if (tracked) borrowPending -= 1; });
      },
      reopen: (lease, control) => {
        const stamp = checkLease(lease, false) === null ? rotateBorrowBoundary() : null;
        if (stamp) borrowPending += 1;
        return enqueue(() => migrationReopenTask(lease, control)).catch((): NativeMigrationReopenResult => {
          markMigrationUncertain();
          return { ok: false, boundary: "open", reason: "operation_failed" };
        }).then(result => {
          // An older success cannot certify a newer pending/failed attempt.
          if (stamp && stamp === borrowLifecycle && result.ok) {
            borrowUncertain = false;
            borrowReopened = Object.freeze({});
          }
          return result;
        }).finally(() => { if (stamp) borrowPending -= 1; });
      },
      release: (lease) => {
        if (checkLease(lease, false) === null && combinedHeldMode && combinedControlStop) return Promise.resolve({ ok: false, reason: "control_evidence_held" });
        if (checkLease(lease, false) === null && hasBorrowPin(lease)) {
          return Promise.resolve({ ok: false, reason: "borrowed_evidence_held" });
        }
        const stamp = checkLease(lease, false) === null ? rotateBorrowBoundary() : null;
        if (stamp) borrowPending += 1;
        return enqueue(() => migrationReleaseTask(lease)).catch((): NativeMigrationReleaseResult => ({
          ok: false, boundary: "close",
        })).finally(() => { if (stamp) borrowPending -= 1; });
      },
      leaseState: () =>
        migrationOwner === null ? "unowned" : migrationOwner.phase === "ready" ? "owned" : "requires_reopen",
    };
    // Borrowing is only for the canonical domain protocol, never a custom pair
    // of caller-selected reserved keys on an otherwise genuine adapter.
    if (!combinedHeldMode && keys.record === LEGACY_PROTOCOL_KEYS.record && keys.latch === LEGACY_PROTOCOL_KEYS.latch) {
    hasBorrowPin = registerNativeMigrationBorrowIssuer(migration, lease => {
      if (checkLease(lease, false) !== null) return null;
      return Object.freeze({ lifecycle: borrowLifecycle, evidence: borrowEvidence,
        reopened: borrowReopened,
        ready: checkLease(lease, true) === null && borrowPending === 0 && !borrowUncertain &&
          !opening && !staleNativeHandle && !openCleanupUncertain });
    });
    }
  }

  const credentials: NativeCredentialSqliteInventory | null = !credentialInventoryMode ? null : Object.freeze({
    acquire: () => enqueue(acquireTask).catch((): NativeMigrationAcquireResult => ({ ok: false, reason: "lease_held" })),
    observe: (lease: NativeMigrationLease, control?: NativeMigrationControl) =>
      enqueue(() => credentialObserveTask(lease, control)).catch((): NativeCredentialSqliteObservation => ({ ok: false, reason: "operation_failed" })),
    initializeEmpty: (lease: NativeMigrationLease, control?: NativeMigrationControl) => {
      // Even an unexpected queue/finally failure cannot invent a COMMIT. Keep
      // issuance knowledge outside the task, private to this one operation.
      const issuance: CredentialInitializationIssuance = { beginIssued: false, writeIssued: false,
        commitIssued: false, commitAcknowledged: false, rollbackAcknowledged: false };
      return enqueue(() => credentialInitializeTask(lease, issuance, control)).catch((): NativeCredentialInitializationResult => {
        if (issuance.commitAcknowledged) return { status: "confirmed" };
        if (!issuance.beginIssued) return { status: "not_begun", reason: "operation_failed" };
        if (!issuance.rollbackAcknowledged) markMigrationUncertain();
        if (issuance.commitIssued) return { status: "outcome_unknown" };
        return { status: "not_committed", reason: "statement_failed", writeIssued: issuance.writeIssued,
          connection: issuance.rollbackAcknowledged ? "clean" : "uncertain" };
      });
    },
    reopen: (lease: NativeMigrationLease, control?: NativeMigrationControl) =>
      enqueue(() => migrationReopenTask(lease, control)).catch((): NativeMigrationReopenResult => {
        markMigrationUncertain();
        return { ok: false, boundary: "open", reason: "operation_failed" };
      }),
    release: (lease: NativeMigrationLease) => enqueue(() => migrationReleaseTask(lease)).catch((): NativeMigrationReleaseResult => ({ ok: false, boundary: "close" })),
    leaseState: (): NativeMigrationLeaseState => migrationOwner === null ? "unowned" : migrationOwner.phase === "ready" ? "owned" : "requires_reopen",
  });

  let combined: NativeCombinedHeldSqliteHost | null = null;
  if (combinedHeldMode && migration && credentials) {
    const internalTarget = migration, inventory = credentials;
    combined = Object.freeze({
      acquire: internalTarget.acquire,
      observe: (lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeCredentialSqliteObservation> => {
        const refusal = checkLease(lease, false);
        if (refusal) return Promise.resolve({ ok: false, reason: refusal });
        if (!combinedController?.beginObservation(lease)) return Promise.resolve({ ok: false, reason: "parent_busy" });
        const readiness = checkLease(lease, true);
        if (readiness) { combinedController.endObservation(lease); return Promise.resolve({ ok: false, reason: readiness }); }
        borrowEvidence = Object.freeze({});
        const lifecycle = borrowLifecycle, allowed = proceedOf(control);
        const proceed = () => {
          if (checkLease(lease, false) !== null || borrowLifecycle !== lifecycle) return false;
          const accepted = allowed();
          return accepted && checkLease(lease, false) === null && borrowLifecycle === lifecycle;
        };
        return enqueue(() => credentialObserveTask(lease, { proceed })).catch((): NativeCredentialSqliteObservation =>
          ({ ok: false, reason: "operation_failed" })).finally(() => { combinedController?.endObservation(lease); });
      },
      initializeEmpty: (lease: NativeMigrationLease, control?: NativeMigrationControl): Promise<NativeCredentialInitializationResult> => {
        const refusal = checkLease(lease, true);
        if (refusal) return Promise.resolve({ status: "refused", reason: refusal });
        if (hasBorrowPin(lease)) return Promise.resolve({ status: "refused", reason: "borrowed_evidence_held" });
        if (combinedControlStop) return Promise.resolve({ status: "refused", reason: "control_evidence_held" });
        borrowEvidence = Object.freeze({}); borrowPending += 1;
        const lifecycle = borrowLifecycle, allowed = proceedOf(control);
        const proceed = () => {
          if (checkLease(lease, false) !== null || borrowLifecycle !== lifecycle) return false;
          const accepted = allowed();
          return accepted && checkLease(lease, false) === null && borrowLifecycle === lifecycle;
        };
        return inventory.initializeEmpty(lease, { proceed }).then(result => {
          if (result.status === "confirmed") {
            noteCombinedControl("schema", { status: "present", bytes: CREDENTIAL_SCHEMA_MARKER }, lifecycle);
            noteCombinedControl("q", { status: "absent" }, lifecycle); noteCombinedControl("f", { status: "absent" }, lifecycle);
          }
          return result;
        }).finally(() => { borrowPending -= 1; });
      },
      reopen: internalTarget.reopen, release: internalTarget.release, leaseState: internalTarget.leaseState,
    }) as NativeCombinedHeldSqliteHost;
    const observeBorrow = (lease: NativeMigrationLease) => {
      if (checkLease(lease, false) !== null) return null;
      return Object.freeze({ lifecycle: borrowLifecycle, evidence: borrowEvidence, reopened: borrowReopened,
        initialized: combinedInitialized, progress: combinedProgress(),
        ready: checkLease(lease, true) === null && borrowPending === 0 && !borrowUncertain && !opening && !staleNativeHandle && !openCleanupUncertain });
    };
    combinedController = commonDependencies ? registerNativeCommonMigrationHost(combined, internalTarget, observeBorrow, {
      expectedIdentity: () => commonSelectedQ?.phase === "bound" ? commonSelectedQ.storeIdentity ?? null : commonSelectedQ?.expectedStoreIdentity ?? null,
      hasQ: () => commonObservedQ?.status === "present",
    }) : registerNativeCombinedHeldHost(combined, internalTarget, observeBorrow);
    hasBorrowPin = combinedController.pinned;
  }

  let common: NativeCommonSqliteContext | null = null;
  if (commonDependencies && combined && migration && combinedController) {
    const dependencies = commonDependencies, host = combined, controller = combinedController as NativeCommonHostController;
    const parseQ = (raw: unknown) => protocolParseQ(raw, dependencies.credentialContract);
    const serializeQ = (input: unknown) => protocolSerializeQ(input, dependencies.credentialContract);
    const transitionQ = (q: unknown, action: unknown) => protocolTransitionQ(q, action, dependencies.credentialContract);
    const observations = new WeakMap<object, { lifecycle: object; evidence: object }>();
    const absent = (): NativeMigrationObservation => Object.freeze({ status: "absent" });
    const present = (bytes: string): NativeMigrationObservation => Object.freeze({ status: "present", bytes });
    const equal = (a: NativeMigrationObservation, b: NativeMigrationObservation) => a.status !== "read_failed" && b.status !== "read_failed" &&
      a.status === b.status && (a.status !== "present" || (b.status === "present" && a.bytes === b.bytes));
    const valueFields = ["schema", "q", "f", "record", "latch"] as const;
    type Field = typeof valueFields[number];
    type Journal = { before: NativeCommonSqlSnapshot; after: NativeCommonSqlSnapshot; lifecycle: object; reopened: object | null;
      issued: boolean; confirmed: boolean; beforeClassified: boolean; finalTicket: object | null; seenAfter: Set<Field> };
    let journal: Journal | null = null;
    let known: NativeCommonSqlSnapshot | null = null;
    function retainedRows(): NativeCommonSqlSnapshot["rows"] | undefined {
      if (journal && !journal.confirmed) return journal.before.rows;
      if (known?.q.status !== "present") return undefined;
      const q = parseQ(known.q.bytes);
      return q.ok && q.value.phase !== "bound" ? known.rows : undefined;
    }
    function stop(): void { combinedControlStop = true; borrowEvidence = Object.freeze({}); }
    function note(field: Field, observed: NativeMigrationObservation): void {
      if (observed.status === "read_failed") return;
      if (journal && !journal.confirmed && journal.issued) {
        const before = journal.before[field], after = journal.after[field];
        if (!equal(observed, before) && !equal(observed, after)) stop();
        if (!equal(before, after) && equal(observed, after)) journal.seenAfter.add(field);
        else if (journal.seenAfter.has(field) && !equal(observed, after)) stop();
      } else if (known && !(known.q.status === "absent" && field === "record") && !equal(observed, known[field])) stop();
    }
    function noteRows(rows: NativeCommonSqlSnapshot["rows"]): void {
      if (rows.status !== "listed") return;
      const expected = retainedRows();
      if (expected?.status !== "listed") return;
      const wanted = new Map(expected.entries.map(row => [row.key, row.value]));
      if (rows.entries.some(row => !wanted.has(row.key) || wanted.get(row.key) !== row.value)) stop();
    }
    function healthy(snapshot: NativeCommonSqlSnapshot): boolean {
      return snapshot.layout === "combined" && snapshot.schema.status === "present" && snapshot.schema.bytes === CREDENTIAL_SCHEMA_MARKER &&
        snapshot.latch.status === "absent" && snapshot.f.status === "absent" && snapshot.record.status !== "read_failed" && snapshot.q.status !== "read_failed" && snapshot.rows.status === "listed";
    }
    function sameRows(a: NativeCommonSqlSnapshot["rows"], b: NativeCommonSqlSnapshot["rows"]): boolean {
      if (a.status !== "listed" || b.status !== "listed" || a.entries.length !== b.entries.length) return false;
      const rows = new Map(a.entries.map(row => [row.key, row.value])); return b.entries.every(row => rows.get(row.key) === row.value);
    }
    function sameTuple(a: NativeCommonSqlSnapshot, b: NativeCommonSqlSnapshot): boolean {
      return a.layout === b.layout && valueFields.every(field => equal(a[field], b[field])) && sameRows(a.rows, b.rows);
    }
    function complete(snapshot: NativeCommonSqlSnapshot): boolean { return snapshot.rows.status === "listed" && valueFields.every(field => snapshot[field].status !== "read_failed"); }
    function format(value: string): boolean { return evaluateBorrowedFingerprintFormat(dependencies.isWellFormedFingerprint, value); }
    function selectSnapshot(lease: NativeMigrationLease, snapshot: NativeCommonSqlSnapshot): boolean {
      const proof = observations.get(snapshot);
      if (!proof || proof.lifecycle !== borrowLifecycle || proof.evidence !== borrowEvidence || checkLease(lease, true) !== null || !healthy(snapshot) || combinedControlStop) return false;
      if (snapshot.q.status === "absent") { commonSelectedQ = null; commonSelectedRaw = null; return true; }
      if (snapshot.q.status !== "present") return false;
      const q = parseQ(snapshot.q.bytes); if (!q.ok || q.value.providerConfigIdentity !== dependencies.providerConfigIdentity || q.value.sessionStorageKey !== dependencies.sessionStorageKey) return false;
      if (snapshot.record.status === "present") {
        const d = evaluateActivationRecord(snapshot.record.bytes, format);
        if (proof.lifecycle !== borrowLifecycle || proof.evidence !== borrowEvidence || !d.ok || d.record.storeIdentity !== (q.value.phase === "bound" ? q.value.storeIdentity : q.value.expectedStoreIdentity) ||
          (q.value.phase === "bound" ? d.record.phase !== "active" : d.record.phase !== "verified")) return false;
      } else if (q.value.phase === "bound") return false;
      commonSelectedQ = q.value; commonSelectedRaw = snapshot.q.bytes; return true;
    }
    async function tupleOn(open: NativeSqliteConnection, lease: NativeMigrationLease, proceed: () => boolean, publish: boolean, expected?: NativeCommonSqlSnapshot): Promise<NativeCommonSqlSnapshot> {
      const lifecycle = borrowLifecycle;
      const layout = await discoverProtocol(open, proceed);
      if (publish) noteCombinedLayout(layout, lifecycle);
      if (expected && layout !== expected.layout) stop();
      if (!proceed()) throw new OpenCancelledError();
      const values: Record<Field, NativeMigrationObservation> = { schema: absent(), q: absent(), f: absent(), record: absent(), latch: absent() };
      for (const field of ["latch", "record", "f", "schema", "q"] as const) {
        values[field] = field === "record" || field === "latch" ? layout === "empty" ? absent() : await credentialControlOn(open, SELECT_VALUE_SQL, field === "record" ? LEGACY_PROTOCOL_KEYS.record : LEGACY_PROTOCOL_KEYS.latch) :
          layout !== "combined" ? absent() : await credentialControlOn(open, META_VALUE_SQL, field);
        if (expected && values[field].status !== "read_failed" && !equal(values[field], expected[field])) stop();
        if (publish) {
          note(field, values[field]);
          if (field === "schema" || field === "q" || field === "f") {
            if (layout === "combined") noteCombinedControl(field, values[field], lifecycle);
          } else if (!journal?.finalTicket) controller.publishDomain(lease, field === "latch" ? { latch: values.latch } : { latch: values.latch, record: values.record });
        }
        if (!proceed()) throw new OpenCancelledError();
      }
      const listing = layout === "empty" ? { status: "listed" as const, keys: [] } : await listKeysOn(open, LEGACY_PROTOCOL_KEYS);
      if (expected?.rows.status === "listed" && listing.status === "listed" &&
          !sameRows({ status: "listed", entries: listing.keys.map(key => ({ key, value: "" })) }, { status: "listed", entries: expected.rows.entries.map(row => ({ key: row.key, value: "" })) })) stop();
      if (publish && listing.status === "listed") {
        const expected = retainedRows();
        if (expected?.status === "listed" && expected.entries.some(row => !listing.keys.includes(row.key))) stop();
        if (!journal?.finalTicket) controller.publishDomain(lease, { record: values.record, targetRows: { status: "listed", entries: listing.keys.map(key => ({ key })) } });
      }
      if (!proceed()) throw new OpenCancelledError();
      const entries: NativeMigrationRow[] = [], rawValues: { key: string; value: { status: "present"; bytes: string } | { status: "absent" } | { status: "read_failed" } }[] = [];
      let unavailable = listing.status !== "listed";
      if (listing.status === "listed") for (const key of listing.keys) {
        const value = await readValueOn(open, key); rawValues.push({ key, value });
        if (value.status === "present") entries.push(Object.freeze({ key, value: value.bytes })); else unavailable = true;
        if (expected?.rows.status === "listed") {
          const wanted = expected.rows.entries.find(row => row.key === key);
          if (wanted && (value.status === "absent" || (value.status === "present" && value.bytes !== wanted.value))) stop();
        }
        if (publish) {
          const expected = retainedRows();
          const wanted = expected?.status === "listed" ? expected.entries.find(row => row.key === key) : undefined;
          if (wanted && (value.status === "absent" || (value.status === "present" && value.bytes !== wanted.value))) stop();
          if (!journal?.finalTicket) controller.publishDomain(lease, { record: values.record, targetRowValues: [...rawValues] });
        }
        if (!proceed()) throw new OpenCancelledError();
      }
      const rows = unavailable ? Object.freeze({ status: "read_failed" as const }) : Object.freeze({ status: "listed" as const, entries: Object.freeze(entries) });
      if (publish) noteRows(rows);
      return Object.freeze({ ok: true, layout, ...values, rows });
    }
    function queued<T>(lease: NativeMigrationLease, refused: T, task: (proceed: () => boolean, lifecycle: object) => Promise<T>, control?: NativeMigrationControl, completion = false): Promise<T> {
      if (checkLease(lease, true) !== null) { if (completion) controller.endCompletion(lease); return Promise.resolve(refused); }
      if (!completion && !controller.beginObservation(lease)) return Promise.resolve(refused);
      const lifecycle = borrowLifecycle, allowed = proceedOf(control);
      const proceed = () => {
        if (checkLease(lease, false) !== null || borrowLifecycle !== lifecycle) return false;
        const accepted = allowed();
        return accepted && checkLease(lease, false) === null && borrowLifecycle === lifecycle;
      };
      borrowEvidence = Object.freeze({}); borrowPending++;
      return enqueue(() => task(proceed, lifecycle)).catch(() => refused).finally(() => {
        borrowPending--; if (completion) controller.endCompletion(lease); else controller.endObservation(lease);
      });
    }
    type Write = { bootstrap?: true; before: NativeCommonSqlSnapshot; after: NativeCommonSqlSnapshot; sourceProof?: NativeCombinedSourceProof; all?: boolean; finalTicket?: object; fault?: boolean; control?: NativeMigrationControl };
    async function writeTask(lease: NativeMigrationLease, write: Write, proceed: () => boolean, lifecycle: object): Promise<NativeMigrationTransactionResult> {
      const issuance: CredentialInitializationIssuance = { beginIssued: false, writeIssued: false, commitIssued: false, commitAcknowledged: false, rollbackAcknowledged: false };
      let open: NativeSqliteConnection;
      try { if (!proceed()) return { status: "refused", reason: "cancelled" }; open = await ensureConnection(proceed); }
      catch { return { status: "not_begun", reason: "operation_failed" }; }
      let commitOperation: NativeSqliteConnection["commitTransaction"];
      const applyCommit = Reflect.apply;
      try { commitOperation = open.commitTransaction; if (typeof commitOperation !== "function") return { status: "not_begun", reason: "operation_failed" }; }
      catch { return { status: "not_begun", reason: "operation_failed" }; }
      if (!proceed()) return { status: "refused", reason: "cancelled" };
      const owner = migrationOwner as MigrationOwner;
      const planned: Journal = { before: write.before, after: write.after, lifecycle, reopened: borrowReopened, issued: false, confirmed: false, beforeClassified: false, finalTicket: write.finalTicket ?? null, seenAfter: new Set() };
      if (!write.fault) {
        if (journal && !journal.confirmed && !journal.beforeClassified) return { status: "refused", reason: "requires_reopen" };
        journal = planned;
      }
      owner.phase = "requires_reopen"; issuance.beginIssued = true;
      let begun = false;
      try { begun = isTransactionAcknowledgement(await open.beginTransaction()); } catch { /* Actual BEGIN, no writes. */ }
      if (!begun) return { status: "not_committed", reason: "begin_unacknowledged", writeIssued: false, connection: "uncertain" };
      const abort = async (reason: NativeMigrationNotCommittedReason): Promise<NativeMigrationTransactionResult> => {
        let clean = false; try { clean = isTransactionAcknowledgement(await open.rollbackTransaction()); } catch { /* Retain actual uncertainty. */ }
        issuance.rollbackAcknowledged = clean;
        if (clean) { owner.phase = "ready"; planned.beforeClassified = true; }
        return { status: "not_committed", reason, writeIssued: issuance.writeIssued, connection: clean ? "clean" : "uncertain" };
      };
      try {
        if (!proceed()) return abort("cancelled");
        const before = await tupleOn(open, lease, proceed, false, write.before);
        if (!proceed()) return abort("cancelled");
        if (!sameTuple(before, write.before)) return abort("precondition_failed");
        if (write.bootstrap) {
          // Strict new-user origin is durable at the first COMMIT, never schema-only.
          const ddl = write.before.layout === "empty"
            ? ["CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);", CREDENTIAL_META_DDL + ";"] : [CREDENTIAL_META_DDL + ";"];
          for (const sql of ddl) {
            if (!proceed()) return abort("cancelled"); issuance.writeIssued = true;
            if (!isTransactionAcknowledgement(await open.execute(sql, false))) return abort("statement_failed");
          }
          if (!proceed()) return abort("cancelled"); issuance.writeIssued = true;
          if (!isSingleRowChange(await open.run("INSERT INTO curling_credential_meta (slot, value) VALUES (?, ?);", ["schema", CREDENTIAL_SCHEMA_MARKER], false))) return abort("statement_failed");
        }
        const statements: [string, unknown[]][] = [];
        if (!equal(write.before.record, write.after.record)) {
          if (write.after.record.status !== "present") return abort("precondition_failed");
          statements.push(write.before.record.status === "absent" ? [INSERT_NEW_ROW_SQL, [LEGACY_PROTOCOL_KEYS.record, write.after.record.bytes]] :
            ["UPDATE records SET value = ? WHERE key = ? AND value = ?", [write.after.record.bytes, LEGACY_PROTOCOL_KEYS.record, write.before.record.status === "present" ? write.before.record.bytes : ""]]);
        }
        for (const field of ["q", "f"] as const) if (!equal(write.before[field], write.after[field])) {
          const after = write.after[field], prior = write.before[field]; if (after.status !== "present" || prior.status === "read_failed") return abort("precondition_failed");
          statements.push(prior.status === "absent" ? ["INSERT INTO curling_credential_meta (slot, value) VALUES (?, ?);", [field, after.bytes]] :
            ["UPDATE curling_credential_meta SET value = ? WHERE slot = ? AND value = ?", [after.bytes, field, prior.bytes]]);
        }
        for (const [sql, values] of statements) {
          if (!proceed()) return abort("cancelled"); issuance.writeIssued = true;
          if (!isSingleRowChange(await open.run(sql, values, false))) return abort("statement_failed");
        }
        if (!proceed()) return abort("cancelled");
        const after = await tupleOn(open, lease, proceed, false, write.after);
        if (!proceed()) return abort("cancelled");
        if (!sameTuple(after, write.after)) return abort("evidence_mismatch");
        // LAST awaited work and foreign callback are above. The authenticated
        // source fence performs synchronous reads, immediately before COMMIT.
        if (!write.fault) {
          const fenced = fenceNativeCombinedSourceProof(dependencies.source, write.sourceProof, write.all === true);
          if (fenced !== "unchanged") { if (fenced === "changed") stop(); return abort(fenced === "changed" ? "source_changed" : "source_unavailable"); }
        }
        if (!nativeCommonMigrationControlCurrent(write.control) || checkLease(lease, false) !== null || borrowLifecycle !== lifecycle) return abort("cancelled");
        issuance.commitIssued = true; planned.issued = true;
        let acknowledged = false; try { acknowledged = isTransactionAcknowledgement(await applyCommit(commitOperation, open, [])); } catch { /* No rollback after issuance. */ }
        if (!acknowledged) return { status: "outcome_unknown" };
        issuance.commitAcknowledged = true; owner.phase = "ready"; planned.confirmed = true;
        if (!write.fault && lifecycle === borrowLifecycle) {
          known = write.after;
          if (write.bootstrap) { noteCombinedControl("schema", write.after.schema, lifecycle); noteCombinedControl("f", write.after.f, lifecycle); }
          noteCombinedControl("q", write.after.q, lifecycle);
          observations.set(write.after, { lifecycle, evidence: borrowEvidence }); selectSnapshot(lease, write.after);
        }
        if (write.finalTicket && !controller.confirmCompletion(lease, write.finalTicket)) { stop(); return { status: "outcome_unknown" }; }
        return { status: "confirmed" };
      } catch {
        if (issuance.commitIssued) return { status: "outcome_unknown" };
        return abort("statement_failed");
      }
    }
    function sameConfig(q: Q): boolean { return q.providerConfigIdentity === dependencies.providerConfigIdentity && q.sessionStorageKey === dependencies.sessionStorageKey; }
    const refusedTx = (): NativeMigrationTransactionResult => ({ status: "refused", reason: "invalid_transaction" });
    const ownedCurrent = (lease: NativeMigrationLease): NativeCommonSqlSnapshot | null => known && observations.get(known)?.lifecycle === borrowLifecycle && checkLease(lease, true) === null ? known : null;
    const context: NativeCommonSqliteContext = {
      host,
      failed: (lease) => combinedControlStop || controller.faulted(lease),
      observe: (lease, control) => queued<NativeCommonSqlSnapshot | { ok: false; reason: NativeMigrationRefusal | NativeSqliteFailureReason }>(lease, { ok: false, reason: "operation_failed" }, async (proceed, lifecycle) => {
        if (!proceed()) return { ok: false as const, reason: "cancelled" as const };
        const open = await ensureConnection(proceed), result = await tupleOn(open, lease, proceed, true);
        if (!proceed()) return { ok: false as const, reason: "cancelled" as const };
        observations.set(result, { lifecycle, evidence: borrowEvidence });
        return result;
      }, control),
      select(lease, snapshot) {
        if (!selectSnapshot(lease, snapshot)) return false;
        if (!journal || journal.confirmed) known = snapshot;
        return true;
      },
      resolveHold: controller.resolveHold,
      initializeNewUser(lease, raw, sourceProof, control) {
        const source = resolveNativeNewUserSourceProof(dependencies.source, sourceProof), parsed = parseQ(raw);
        if (dependencies.credentialContract !== NEW_USER_CREDENTIAL_CONTRACT || !source || source.domainRows.length || source.marker !== null ||
          source.credentialInventory.initialEntryKeys.length || source.credentialInventory.fixedSlots.some(slot => slot.presence !== "absent") ||
          !parsed.ok || !sameConfig(parsed.value) || parsed.value.phase !== "intent" || parsed.value.initialEntryKeys.length || parsed.value.verifiedItemIds.length) return Promise.resolve(refusedTx());
        return queued(lease, refusedTx(), async (proceed, lifecycle) => {
          if (hasBorrowPin(lease) || combinedControlStop) return refusedTx();
          const open = await ensureConnection(proceed), before = await tupleOn(open, lease, proceed, true);
          if (!proceed() || !complete(before) || !["empty", "records"].includes(before.layout) ||
            valueFields.some(field => before[field].status !== "absent") || before.rows.status !== "listed" || before.rows.entries.length) return refusedTx();
          const after = Object.freeze({ ...before, layout: "combined" as const, schema: present(CREDENTIAL_SCHEMA_MARKER), q: present(raw) });
          return writeTask(lease, { before, after, sourceProof, all: true, bootstrap: true, control }, proceed, lifecycle);
        }, control);
      },
      insertIntent(lease, hold, raw, sourceProof, control) {
        const held = controller.resolveHold(lease, hold), source = resolveNativeCombinedSourceProof(dependencies.source, sourceProof, true), q = parseQ(raw);
        if (!held || !source || !q.ok || !sameConfig(q.value) || q.value.phase !== "intent" || q.value.expectedStoreIdentity !== held.identity ||
          JSON.stringify(q.value.initialEntryKeys) !== JSON.stringify(source.credentialInventory.initialEntryKeys)) return Promise.resolve(refusedTx());
        return queued(lease, refusedTx(), async (proceed, lifecycle) => {
          const open = await ensureConnection(proceed), before = await tupleOn(open, lease, proceed, true);
          if (!proceed() || !healthy(before) || before.q.status !== "absent" ||
            (held.recordBefore === null ? before.record.status !== "absent" : before.record.status !== "present" || before.record.bytes !== held.recordBefore) ||
            (!sameRows(before.rows, { status: "listed", entries: source.domainRows }) || !sameRows(before.rows, { status: "listed", entries: held.targetRows }))) return refusedTx();
          const after = Object.freeze({ ...before, q: present(raw) });
          return writeTask(lease, { before, after, sourceProof, all: true, control }, proceed, lifecycle);
        }, control);
      },
      advanceQ(lease, raw, action, sourceProof, control) {
        const before = ownedCurrent(lease), source = resolveNativeCombinedSourceProof(dependencies.source, sourceProof, false), parsed = parseQ(raw);
        if (!before || !source || !healthy(before) || before.q.status !== "present" || before.q.bytes !== raw || !parsed.ok || !sameConfig(parsed.value)) return Promise.resolve(refusedTx());
        const next = transitionQ(parsed.value, action); if (!next.ok || next.value.phase === "bound") return Promise.resolve(refusedTx());
        const serialized = serializeQ(next.value); if (!serialized.ok) return Promise.resolve(refusedTx());
        const after = Object.freeze({ ...before, q: present(serialized.value) });
        return queued(lease, refusedTx(), (proceed, lifecycle) => writeTask(lease, { before, after, sourceProof, control }, proceed, lifecycle), control);
      },
      finalize(lease, hold, sourceProof, migrationId, activatedAt, control) {
        const before = ownedCurrent(lease), source = resolveNativeCombinedSourceProof(dependencies.source, sourceProof, true), held = controller.resolveHold(lease, hold);
        if (!before || !source || !held || !healthy(before) || before.q.status !== "present" || before.rows.status !== "listed") return Promise.resolve(refusedTx());
        const q = parseQ(before.q.bytes); if (!q.ok || !sameConfig(q.value) || q.value.phase !== "credentials_verified" || q.value.expectedStoreIdentity !== held.identity) return Promise.resolve(refusedTx());
        if (held.recordBefore === null ? before.record.status !== "absent" : before.record.status !== "present" || before.record.bytes !== held.recordBefore) return Promise.resolve(refusedTx());
        if ((!sameRows(before.rows, { status: "listed", entries: source.domainRows }) || !sameRows(before.rows, { status: "listed", entries: held.targetRows }))) return Promise.resolve(refusedTx());
        // The authentic hold already validated these exact before bytes. Final
        // canonical shape checks must invoke NO foreign format callback after
        // the protected proof: fingerprints are unchanged by activation.
        const retainedFormat = (value: string) => typeof value === "string" && value.length > 0;
        const d = held.recordBefore === null ? null : evaluateActivationRecord(held.recordBefore, retainedFormat);
        if (d !== null && (!d.ok || d.record.phase !== "verified" || d.record.storeIdentity !== held.identity)) return Promise.resolve(refusedTx());
        // The private hold owns EVERY raw target value actually digested by its
        // successful canonical collection, including cold resumes. Exact equality
        // above carries that genuine proof into the in-TX before/after checks;
        // expected manifest hashes are never relabelled as current computations.
        if (!d?.ok && source.domainRows.length) return Promise.resolve(refusedTx());
        const record = buildRecordAfter(d?.ok ? d.record : null, d?.ok ? { kind: "activate", activatedAt } : { kind: "create_fresh_active", storeIdentity: held.identity, migrationId, activatedAt });
        const bound = transitionQ(q.value, { kind: "bind", storeIdentity: held.identity });
        if (!record.ok || !evaluateActivationRecord(record.bytes, retainedFormat).ok || !bound.ok) return Promise.resolve(refusedTx());
        const serialized = serializeQ(bound.value); if (!serialized.ok) return Promise.resolve(refusedTx());
        const permission = controller.beginCompletion(lease, hold); if (!permission) return Promise.resolve(refusedTx());
        const after = Object.freeze({ ...before, record: present(record.bytes), q: present(serialized.value) });
        return queued(lease, refusedTx(), (proceed, lifecycle) => writeTask(lease, { before, after, sourceProof, all: true, finalTicket: permission.ticket, control }, proceed, lifecycle), control, true);
      },
      recordFault(lease, raw, control) {
        if (!parseF(raw).ok) return Promise.resolve(refusedTx()); stop();
        return queued(lease, refusedTx(), async (proceed, lifecycle) => {
          const open = await ensureConnection(proceed), before = await tupleOn(open, lease, proceed, false);
          if (!proceed() || before.layout !== "combined" || before.schema.status !== "present" || before.schema.bytes !== CREDENTIAL_SCHEMA_MARKER || before.f.status !== "absent" || !complete(before)) return refusedTx();
          return writeTask(lease, { before, after: Object.freeze({ ...before, f: present(raw) }), fault: true, control }, proceed, lifecycle);
        }, control);
      },
      resolveJournal(lease, control) {
        if (!journal) return Promise.resolve("none" as const);
        if (journal.confirmed) return Promise.resolve("after" as const);
        if (!borrowReopened || borrowReopened === journal.reopened || borrowLifecycle === journal.lifecycle) return Promise.resolve("reopen_required" as const);
        return queued<NativeCommonJournalResolution>(lease, "unavailable", async (proceed, lifecycle) => {
          const current = journal as Journal, open = await ensureConnection(proceed), result = await tupleOn(open, lease, proceed, true);
          if (!proceed() || !complete(result)) return "unavailable";
          observations.set(result, { lifecycle, evidence: borrowEvidence });
          if (sameTuple(result, current.after)) {
            current.confirmed = true; known = result; selectSnapshot(lease, result);
            if (current.finalTicket && !controller.confirmCompletion(lease, current.finalTicket)) { stop(); return "mismatch"; }
            return "after";
          }
          if (sameTuple(result, current.before) && current.seenAfter.size === 0) { current.beforeClassified = true; known = result; selectSnapshot(lease, result); return "before"; }
          stop(); return "mismatch";
        }, control);
      },
      prepareRuntime(lease, snapshot, session) {
        if (!nativeRuntimeCurrent(session, "domain", true) || !selectSnapshot(lease, snapshot) || !known || !sameTuple(known, snapshot) ||
          (journal && !journal.confirmed) || snapshot.q.status !== "present" || snapshot.record.status !== "present") return null;
        const parsed = parseQ(snapshot.q.bytes);
        if (!parsed.ok || parsed.value.phase !== "bound" || !controller.pinBound(lease)) return null;
        const expected = { schema: snapshot.schema, q: snapshot.q, record: snapshot.record, f: snapshot.f, latch: snapshot.latch };
        const lifecycle = borrowLifecycle;
        let role: "prepared" | "runtime" | "closed" | "retired" = "prepared";
        const ready = () => role === "prepared" && checkLease(lease, true) === null && borrowLifecycle === lifecycle && !combinedControlStop && nativeRuntimeCurrent(session, "domain", true);
        const live = () => role === "runtime" && checkLease(lease, true) === null && borrowLifecycle === lifecycle && nativeRuntimeCurrent(session, "domain");
        const anchors = new WeakSet<object>();
        const unavailable = Object.freeze({});
        const contradiction = Object.freeze({});
        const validKey = (key: unknown): key is string => typeof key === "string" && !["curling.nativeMigration.", "curling.credential", "curling.installationTransfer.", "sb-"].some(prefix => key.startsWith(prefix));
        type ReadTrace = { issued: boolean; returned: unknown };
        const trace = (): ReadTrace => ({ issued: false, returned: undefined });
        async function queryOn(open: NativeSqliteConnection, observed: ReadTrace, sql: string, values: unknown[]): Promise<NativeSqliteQueryResult> {
          const method = open.query;
          if (typeof method !== "function" || !live()) throw unavailable;
          observed.issued = true;
          const result: unknown = await Reflect.apply(method, open, [sql, values]);
          observed.returned = result;
          return result as NativeSqliteQueryResult;
        }
        const stringField = (_name: string, value: unknown): void => {
          if (typeof value !== "string") {
            nativeRuntimeFailed(session, "domain"); observeNativeRuntimeMalformed(value); throw unavailable;
          }
        };
        async function controls(observed: ReadTrace): Promise<NativeSqliteConnection> {
          if (!live() || connection === null) throw unavailable;
          const open = connection;
          // Only query is needed by these private read-only validators. Every
          // invocation uses the real original receiver and records actual issue.
          const reader = { query: (sql: string, values: unknown[]) => queryOn(open, observed, sql, values) } as NativeSqliteConnection;
          if (await discoverProtocol(reader, live, false, unavailable, value => {
            nativeRuntimeFailed(session, "domain"); observeNativeRuntimeMalformed(value);
          }) !== "combined") throw contradiction;
          if (!live()) throw unavailable;
          for (const field of ["latch", "record", "f", "schema", "q"] as const) {
            const value = field === "record" || field === "latch" ? await credentialControlOn(reader, SELECT_VALUE_SQL, field === "record" ? LEGACY_PROTOCOL_KEYS.record : LEGACY_PROTOCOL_KEYS.latch, stringField) : await credentialControlOn(reader, META_VALUE_SQL, field, stringField);
            if (value.status === "read_failed") throw unavailable;
            if (!equal(value, expected[field])) throw contradiction;
            if (!live()) throw unavailable;
          }
          return open;
        }
        function failure(reason: unknown, observedReturn: unknown): void {
          nativeRuntimeFailed(session, "domain");
          if (reason === contradiction || isProtocolSelectionError(reason)) nativeRuntimeProtocolFault(session);
          observeNativeRuntimeMalformed(observedReturn);
        }
        const error = () => ({ kind: "unknown" as const, message: "Native runtime persistence unavailable." });
        const readFailed = (): StorageGetResult => readFailure(error());
        const mutationFailed = (kind: "write" | "remove") => kind === "write" ? writeFailed(error()) : removeFailed({ kind: "removal_failed", message: "Native runtime persistence unavailable." });
        function readEvidence(observed: ReadTrace, success: boolean): void {
          nativeRuntimeEvidence(session, "domain", { operation: "read", issued: observed.issued, acknowledged: success, verified: success, outcome: success ? "success" : observed.issued ? "unverified" : "refused" });
        }
        async function get(key: string): Promise<StorageGetResult> {
          const observed = trace();
          if (!validKey(key) || !live()) { readEvidence(observed, false); return readFailed(); }
          return enqueue(async () => {
            try {
              const open = await controls(observed); if (!live()) { readEvidence(observed, false); return readFailed(); }
              const raw = await queryOn(open, observed, SELECT_VALUE_SQL, [key]);
              let rows: Record<string, unknown>[];
              try { rows = discoveryRows(raw, ["value"], stringField); }
              catch { throw unavailable; } // Malformed addressed response is not a structure proof.
              if (rows.length > 1) throw unavailable;
              if (!live()) { readEvidence(observed, false); return readFailed(); }
              readEvidence(observed, true);
              return { status: "value" as const, value: rows.length === 0 ? null : rows[0].value as string };
            } catch (reason) { failure(reason, observed.returned); readEvidence(observed, false); return readFailed(); }
          }).catch(() => { nativeRuntimeFailed(session, "domain"); readEvidence(observed, false); return readFailed(); });
        }
        async function mutate(kind: "write" | "remove", key: string, value?: string): Promise<PersistenceWriteResult | PersistenceRemoveResult> {
          const observed = trace();
          const tx = { beginIssued: false, beginAcknowledged: false, statementIssued: false, statementAcknowledged: false,
            commitIssued: false, commitAcknowledged: false, rollbackIssued: false, rollbackAcknowledged: false };
          const evidence = (success: boolean) => nativeRuntimeEvidence(session, "domain", { operation: kind, issued: tx.statementIssued,
            acknowledged: tx.commitAcknowledged, verified: success, controlReadIssued: observed.issued, transaction: tx,
            outcome: success ? "success" : tx.beginIssued || observed.issued ? "unverified" : "refused" });
          if (!validKey(key) || (kind === "write" && typeof value !== "string") || !live()) { evidence(false); return mutationFailed(kind); }
          return enqueue(async () => {
            let cleanupRollback: NativeSqliteConnection["rollbackTransaction"] | null = null;
            let open: NativeSqliteConnection | null = null, observedReturn: unknown;
            const observedAckFields: unknown[] = [];
            const changedRows = (raw: unknown): number | null => {
              if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
              const outer = Object.getOwnPropertyDescriptor(raw, "changes");
              if (!outer || !("value" in outer)) return null;
              observedAckFields.push(outer.value);
              if (outer.value === null || typeof outer.value !== "object" || Array.isArray(outer.value)) return null;
              const inner = Object.getOwnPropertyDescriptor(outer.value, "changes");
              if (!inner || !("value" in inner)) return null;
              observedAckFields.push(inner.value);
              return typeof inner.value === "number" && Number.isSafeInteger(inner.value) && inner.value >= 0 ? inner.value : null;
            };
            try {
              open = await controls(observed); if (!live()) { evidence(false); return mutationFailed(kind); }
              // Capture before BEGIN; no foreign getter follows the last current
              // check before the captured COMMIT invocation.
              const begin = open.beginTransaction, commit = open.commitTransaction, rollback = open.rollbackTransaction, run = open.run; cleanupRollback = rollback;
              if ([begin, commit, rollback, run].some(method => typeof method !== "function") || !live()) throw unavailable;
              tx.beginIssued = true;
              observedReturn = await Reflect.apply(begin, open, []);
              tx.beginAcknowledged = changedRows(observedReturn) !== null;
              if (!tx.beginAcknowledged || !live()) throw unavailable;
              tx.statementIssued = true;
              observedReturn = await Reflect.apply(run, open, [kind === "write" ? UPSERT_VALUE_SQL : DELETE_VALUE_SQL, kind === "write" ? [key, value] : [key], false]);
              const changed = changedRows(observedReturn);
              tx.statementAcknowledged = kind === "write" ? changed === 1 : changed === 0 || changed === 1;
              if (!tx.statementAcknowledged || !live()) throw unavailable;
              tx.commitIssued = true;
              observedReturn = await Reflect.apply(commit, open, []);
              tx.commitAcknowledged = changedRows(observedReturn) !== null;
              if (!tx.commitAcknowledged || !live()) throw unavailable;
              evidence(true); return kind === "write" ? writeOk() : removeOk();
            } catch (reason) {
              // Revoke all existing anchor rights before awaiting actual cleanup.
              failure(reason, observedReturn); observeNativeRuntimeMalformed(observed.returned);
              for (const field of observedAckFields) observeNativeRuntimeMalformed(field);
              if (open && cleanupRollback && tx.beginAcknowledged && !tx.commitIssued) {
                tx.rollbackIssued = true;
                try {
                  const raw: unknown = await Reflect.apply(cleanupRollback, open, []);
                  tx.rollbackAcknowledged = changedRows(raw) !== null;
                  if (!tx.rollbackAcknowledged) { observeNativeRuntimeMalformed(raw); for (const field of observedAckFields) observeNativeRuntimeMalformed(field); }
                } catch { /* Unknown cleanup remains distinct from confirmation. */ }
              }
              if (tx.beginIssued && migrationOwner) migrationOwner.phase = "requires_reopen";
              evidence(false); return mutationFailed(kind);
            }
          }).catch(() => { nativeRuntimeFailed(session, "domain"); evidence(false); return mutationFailed(kind); });
        }
        let receipt: object | null = null, closing: Promise<object | null> | null = null;
        return Object.freeze({ ready, activate: () => { role = "runtime"; }, abandon: () => { if (role === "prepared") role = "closed"; },
          adapter: Object.freeze({ get, set: (key: string, value: string) => mutate("write", key, value) as Promise<PersistenceWriteResult>, remove: (key: string) => mutate("remove", key) as Promise<PersistenceRemoveResult> }),
          anchor: () => {
            if (!live()) return Promise.resolve(null);
            return enqueue(async () => {
              const observed = trace();
              try { await controls(observed); if (!live()) return null; const token = Object.freeze({}); anchors.add(token); return token; }
              catch (reason) { failure(reason, observed.returned); readEvidence(observed, false); return null; }
            }).catch(() => { nativeRuntimeFailed(session, "domain"); return null; });
          },
          anchorCurrent: (token: object) => anchors.has(token) && live(),
          close() {
            if (closing) return closing;
            role = "closed";
            closing = enqueue(async () => {
              if (checkLease(lease, false) !== null) return null;
              if (connection !== null) {
                const open = connection, close = open.close;
                if (typeof close !== "function") { observeNativeRuntimeMalformed(close); return null; }
                staleNativeHandle = true;
                nativeRuntimeCleanup(session, { sqlCloseIssued: true });
                const ack: unknown = await Reflect.apply(close, open, []);
                if (ack !== undefined) { observeNativeRuntimeMalformed(ack); return null; }
                nativeRuntimeCleanup(session, { sqlCloseAcknowledged: true }); connection = null;
              }
              if (staleNativeHandle || openCleanupUncertain) {
                if (!engine) return null;
                const release = engine.closeConnection;
                if (typeof release !== "function") { observeNativeRuntimeMalformed(release); return null; }
                nativeRuntimeCleanup(session, { engineReleaseIssued: true });
                const ack: unknown = await Reflect.apply(release, engine, [databaseName]);
                if (ack !== undefined) { observeNativeRuntimeMalformed(ack); return null; }
                nativeRuntimeCleanup(session, { engineReleaseAcknowledged: true });
                staleNativeHandle = false; openCleanupUncertain = false;
              }
              receipt = Object.freeze({}); return receipt;
            }).catch(() => null);
            return closing;
          },
          releaseReady: (value: object) => receipt === value && role === "closed" && checkLease(lease, false) === null && connection === null && !staleNativeHandle && !openCleanupUncertain,
          retire: (value: object) => {
            if (receipt !== value || role !== "closed" || checkLease(lease, false) !== null || connection !== null || staleNativeHandle || openCleanupUncertain) return;
            controller.retireCompletion(lease);
            const shared = ownershipOf(databaseName); if (shared.migration?.store === self) shared.migration = null;
            migrationOwner = null; role = "retired";
          },
        });
      },
      pinBound(lease, snapshot) {
        if (!observations.has(snapshot) || !selectSnapshot(lease, snapshot) || snapshot.q.status !== "present") return false;
        const q = parseQ(snapshot.q.bytes); return q.ok && q.value.phase === "bound" && controller.pinBound(lease);
      },
    };
    common = Object.freeze(context);
  }

  const store: NativeSqliteStore = {
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
  return { store, migration, credentials, combined, common, quarantine: quarantineHooks?.context ?? null };
}

/**
 * A native store WITH the migration-only target capability (Stage M3b4b).
 *
 * The store and the capability share one queue, one connection and one owner,
 * so nothing else can open or release the same handle underneath a migration.
 * Constructing it opens nothing. Only the migration modules call this; no
 * application startup path does (`__tests__/architectureBoundary.test.ts`).
 */
export function createNativeMigrationSqliteStore(
  options: NativeSqliteStoreOptions & { readonly reservedKeys: NativeMigrationReservedKeys }
): NativeMigrationSqliteStore {
  if (!validReservedKeys(options.reservedKeys)) {
    throw new TypeError("The migration's reserved target keys must be two distinct, non-empty strings.");
  }
  const reservedKeys = Object.freeze({ record: options.reservedKeys.record, latch: options.reservedKeys.latch });
  const built = buildNativeSqliteStore(options, reservedKeys);
  return Object.freeze({ store: built.store, target: built.migration as NativeSqliteMigrationTarget });
}

/** S3b private structural/control observer and empty-target schema bootstrap.
 * Constructing it is inert. No ordinary store/legacy target escapes. No app user. */
export function createNativeCredentialSqliteInventory(
  options: NativeSqliteStoreOptions
): NativeCredentialSqliteInventory {
  return buildNativeSqliteStore(options, LEGACY_PROTOCOL_KEYS, true).credentials as NativeCredentialSqliteInventory;
}


/** S3e isolated host: shared SQL owner, no ordinary adapter or domain target. */
export function createNativeCombinedHeldSqliteHost(options: NativeSqliteStoreOptions): NativeCombinedHeldSqliteHost {
  return buildNativeSqliteStore(options, LEGACY_PROTOCOL_KEYS, true, true).combined as NativeCombinedHeldSqliteHost;
}

/** S3f internal role, never returned from ordinary/S3b/S3e factories. */
export function createNativeCommonMigrationSqliteContext(options: NativeSqliteStoreOptions, dependencies: NativeCommonSqlDependencies): NativeCommonSqliteContext {
  const captured = Object.freeze({ source: dependencies.source, providerConfigIdentity: dependencies.providerConfigIdentity,
    sessionStorageKey: dependencies.sessionStorageKey, credentialContract: dependencies.credentialContract, isWellFormedFingerprint: dependencies.isWellFormedFingerprint });
  return buildNativeSqliteStore(options, LEGACY_PROTOCOL_KEYS, true, true, captured).common as NativeCommonSqliteContext;
}

/** S6g core-only constructor. Concrete SQL lives solely in its dormant installer. */
export function createNativeTransferQuarantineContext(options: NativeSqliteStoreOptions, installer: QuarantineInstaller): NativeTransferQuarantineContext {
  return buildNativeSqliteStore(options, null, false, false, null, installer).quarantine!;
}
