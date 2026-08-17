// The IndexedDB StorageAdapter implementation, plus the narrow migration-control
// interface the resumable copy-migration engine builds on — Phase 2, Stage 2 (adapter)
// and Stage 3 (migration target). See docs/adr/0015-indexeddb-adapter-unwired.md,
// docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md, and
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §9/§10. This is the only production file
// permitted to reference the `indexedDB` global — enforced by
// src/lib/persistence/__tests__/architectureBoundary.test.ts. Nothing in this file is
// imported by any repository singleton or component; localStorage remains the sole
// production source of truth (see localStorageAdapter.ts) until a separate,
// explicitly-approved migration/activation task wires this in.
import { openDB, type IDBPDatabase, type IDBPTransaction } from "idb";
import type {
  PersistenceReadError,
  PersistenceWriteError,
  PersistenceWriteResult,
  StorageAdapter,
  StorageGetResult,
} from "./types";
import { writeFailed, writeOk } from "./types";

/** The one, permanent schema for this adapter — see ADR-0015. Two out-of-line-keyed,
 * unindexed string stores; no domain-specific record fragmentation. */
export const INDEXED_DB_DATABASE_NAME = "curling-release-tracker";
export const INDEXED_DB_VERSION = 1;
export const RECORDS_STORE_NAME = "records";
export const METADATA_STORE_NAME = "metadata";

export interface IndexedDbAdapterOptions {
  /**
   * Overrides the database name — the dependency-injection seam that lets tests run
   * fully isolated from each other and from any future real database. Production code
   * never passes this; it always resolves to INDEXED_DB_DATABASE_NAME.
   */
  databaseName?: string;
  /**
   * Test-only seam for deterministically constructing a blocked/blocking connection
   * scenario against fake-indexeddb (see indexedDbAdapter.test.ts) — the real schema is
   * permanently pinned at INDEXED_DB_VERSION and no production call site ever overrides
   * this.
   */
  databaseVersion?: number;
}

/** Distinguishes "our own open request was blocked by another open connection" from
 * every other failure — not a DOMException, since the underlying `blocked` event carries
 * no exception of its own (see idb's `OpenDBCallbacks.blocked`). */
class IndexedDbOpenBlockedError extends Error {
  constructor() {
    super("IndexedDB open request was blocked by another open connection");
    this.name = "IndexedDbOpenBlockedError";
  }
}

class IndexedDbUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndexedDbUnavailableError";
  }
}

function isDomException(error: unknown): error is DOMException {
  return typeof DOMException !== "undefined" && error instanceof DOMException;
}

function isQuotaExceededError(error: unknown): boolean {
  if (!isDomException(error)) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.code === 22 ||
    error.code === 1014
  );
}

/** Covers unavailable/denied/blocked/private-mode/missing-API/invalid-state failures —
 * every one of these is a reason the storage layer itself cannot be used, as opposed to
 * an unexpected internal error (`unknown`). */
function isStorageUnavailableFailure(error: unknown): boolean {
  if (typeof indexedDB === "undefined") return true;
  if (error instanceof IndexedDbOpenBlockedError) return true;
  if (error instanceof IndexedDbUnavailableError) return true;
  if (!isDomException(error)) return false;
  return (
    error.name === "SecurityError" ||
    error.name === "NotAllowedError" ||
    error.name === "InvalidStateError"
  );
}

function classifyReadError(error: unknown): PersistenceReadError {
  if (isStorageUnavailableFailure(error)) return { kind: "storage_unavailable" };
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

function classifyWriteError(error: unknown): PersistenceWriteError {
  if (isQuotaExceededError(error)) return { kind: "quota_exceeded" };
  if (isStorageUnavailableFailure(error)) return { kind: "storage_unavailable" };
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

function ensureStores(db: IDBPDatabase): void {
  if (!db.objectStoreNames.contains(RECORDS_STORE_NAME)) {
    db.createObjectStore(RECORDS_STORE_NAME);
  }
  if (!db.objectStoreNames.contains(METADATA_STORE_NAME)) {
    db.createObjectStore(METADATA_STORE_NAME);
  }
}

/**
 * The shared lazy/cached/retry-safe connection lifecycle — extracted so both
 * `createIndexedDbAdapter` (the generic `StorageAdapter`) and
 * `createIndexedDbMigrationTarget` (the migration-control interface) open, cache, and
 * recover a connection exactly the same way, rather than each hand-rolling its own
 * `openDB`/cache/blocked-handling logic. Opens no connection at construction time —
 * only the first call to the returned `getConnection()` triggers `openDB()`.
 *
 * A successful connection is cached and reused across calls. Three things invalidate
 * that cache so a later call reopens fresh rather than reusing a dead connection: an
 * open failure (including a blocked open, converted to a classified failure rather than
 * left to hang), a `blocking` notification (another, newer connection needs this one to
 * close — this connection closes itself immediately rather than indefinitely blocking
 * the other side), and an abnormal `terminated` closure.
 */
function createIndexedDbConnection(
  databaseName: string,
  databaseVersion: number
): { getConnection: () => Promise<IDBPDatabase> } {
  let connectionPromise: Promise<IDBPDatabase> | null = null;

  function invalidateConnection(): void {
    connectionPromise = null;
  }

  function openConnection(): Promise<IDBPDatabase> {
    return new Promise<IDBPDatabase>((resolve, reject) => {
      let blockedAlready = false;

      openDB(databaseName, databaseVersion, {
        upgrade(db) {
          ensureStores(db);
        },
        blocked() {
          // Convert an indefinitely-pending open into a classified failure now,
          // rather than hanging until whatever is blocking us eventually closes (it
          // may never). The eventual late resolution, if it ever comes, is handled
          // below so it can't leak a live connection nobody is tracking.
          blockedAlready = true;
          reject(new IndexedDbOpenBlockedError());
        },
        blocking(_currentVersion, _blockedVersion, event) {
          // A newer connection wants to open and is waiting on us to close. Closing
          // immediately (rather than leaving the page to decide) also invalidates our
          // cache so the next get()/set() reopens fresh.
          invalidateConnection();
          const nativeDb = event.target;
          if (nativeDb && typeof (nativeDb as IDBDatabase).close === "function") {
            (nativeDb as IDBDatabase).close();
          }
        },
        terminated() {
          invalidateConnection();
        },
      })
        .then((db) => {
          if (blockedAlready) {
            // This open eventually succeeded after we already reported it as failed
            // (and the caller may have retried by now) — don't leak a live, untracked
            // connection.
            db.close();
            return;
          }
          resolve(db);
        })
        .catch((error) => {
          if (!blockedAlready) reject(error);
        });
    });
  }

  function getConnection(): Promise<IDBPDatabase> {
    if (typeof indexedDB === "undefined") {
      return Promise.reject(new IndexedDbUnavailableError("indexedDB is not available"));
    }
    if (!connectionPromise) {
      connectionPromise = openConnection().catch((error) => {
        invalidateConnection();
        throw error;
      });
    }
    return connectionPromise;
  }

  return { getConnection };
}

/**
 * Creates the (currently unwired) IndexedDB-backed StorageAdapter. Opens the database
 * lazily — never at import time, and never at construction time — the first time
 * get()/set() is actually called, so importing or constructing this module has no
 * observable effect and stays safe under Next.js server-side evaluation where
 * `indexedDB` does not exist.
 */
export function createIndexedDbAdapter(
  options: IndexedDbAdapterOptions = {}
): StorageAdapter {
  const databaseName = options.databaseName ?? INDEXED_DB_DATABASE_NAME;
  const databaseVersion = options.databaseVersion ?? INDEXED_DB_VERSION;
  const { getConnection } = createIndexedDbConnection(databaseName, databaseVersion);

  return {
    async get(key: string): Promise<StorageGetResult> {
      try {
        const db = await getConnection();
        const value = await db.get(RECORDS_STORE_NAME, key);
        return { status: "value", value: value === undefined ? null : value };
      } catch (error) {
        return { status: "read_failed", fallback: null, error: classifyReadError(error) };
      }
    },

    async set(key: string, value: string): Promise<PersistenceWriteResult> {
      try {
        const db = await getConnection();
        await db.put(RECORDS_STORE_NAME, value, key);
        return writeOk();
      } catch (error) {
        return writeFailed(classifyWriteError(error));
      }
    },
  };
}

// ---------------------------------------------------------------------------------
// Migration-control interface (Phase 2, Stage 3) — see
// docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md. Deliberately
// separate from StorageAdapter: markers live in the `metadata` store, which
// StorageAdapter.get/set never touch, and the commit operation needs a two-store
// atomic transaction StorageAdapter's single-key contract cannot express. Not exposed
// through, or reachable from, the generic StorageAdapter interface above.
// ---------------------------------------------------------------------------------

/** The stable metadata-key namespace every domain marker lives under — see ADR-0016.
 * `buildMigrationMarkerKey` is the only supported way to derive a marker's storage key;
 * the namespace itself is exported for tests and documentation, not for ad hoc key
 * construction elsewhere. */
export const MIGRATION_METADATA_NAMESPACE = "migration:local-storage-to-indexeddb:v1";

/** The one protocol version this migration engine has ever spoken. A future, genuinely
 * incompatible marker shape would use a new version rather than overloading this one —
 * see ADR-0016's fail-closed validation rule. */
export const MIGRATION_PROTOCOL_VERSION = 1 as const;

export function buildMigrationMarkerKey(domain: string): string {
  return `${MIGRATION_METADATA_NAMESPACE}:${domain}`;
}

/**
 * The exact, deterministic shape of a per-domain completion marker — see ADR-0016.
 * Deliberately excludes any timestamp, random ID, or environment-specific data: a
 * marker only ever needs to answer "is this exact domain, with this exact set of
 * source keys, fully copied?" — nothing else is safe to key completion on across a
 * resumed or retried run.
 */
export interface IndexedDbMigrationDomainMarker {
  protocolVersion: typeof MIGRATION_PROTOCOL_VERSION;
  domain: string;
  status: "complete";
  sourceKeys: string[];
}

export type IndexedDbMigrationMarkerReadResult =
  | { status: "absent" }
  | { status: "complete" }
  | { status: "invalid"; reason: string }
  | { status: "read_failed"; error: PersistenceReadError };

/** One domain's exact-string snapshot to commit — `records` must cover exactly
 * `sourceKeys`, one entry per key, in the same order; `value: null` means that source
 * key was absent and its target record must not exist after the commit. */
export interface IndexedDbMigrationDomainSnapshot {
  domain: string;
  sourceKeys: readonly string[];
  records: ReadonlyArray<{ key: string; value: string | null }>;
}

export type IndexedDbMigrationCommitResult =
  | { status: "committed" }
  | { status: "already_complete" }
  | { status: "invalid_marker"; reason: string }
  | { status: "failed"; error: PersistenceWriteError };

export interface IndexedDbMigrationTarget {
  /**
   * Reads and validates the marker for `domain` against the exact `sourceKeys` list
   * expected today. `"absent"` means not migrated; `"complete"` means fully migrated
   * and safe to skip; `"invalid"` means a marker exists but fails closed (wrong
   * protocol version, wrong domain, wrong source-key list, or unknown status) — never
   * silently treated as either "absent" or "complete". This same read is what a test,
   * or later activation work, uses to inspect migration completion — there is no
   * separate "is it done" method, since this one already answers that with the full
   * absent/complete/invalid/read_failed distinction.
   */
  readDomainMarker(
    domain: string,
    sourceKeys: readonly string[]
  ): Promise<IndexedDbMigrationMarkerReadResult>;

  /**
   * Atomically commits one domain's snapshot inside a single IndexedDB readwrite
   * transaction spanning both `records` and `metadata`. Re-reads and re-validates the
   * marker *inside* that transaction before writing anything (see ADR-0016) — this is
   * what makes two concurrent commits for the same, not-yet-migrated domain safe:
   * IndexedDB serializes readwrite transactions over the same stores, so whichever
   * commit's transaction runs first wins, and the second always observes the marker
   * the first just wrote, before it would otherwise re-delete/rewrite anything.
   */
  commitDomainSnapshot(
    snapshot: IndexedDbMigrationDomainSnapshot
  ): Promise<IndexedDbMigrationCommitResult>;
}

function arraysEqual(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** The complete, exact set of fields a valid marker has — no more, no fewer. */
const MARKER_FIELDS = ["protocolVersion", "domain", "status", "sourceKeys"] as const;

/**
 * A marker must be a plain object — rejects `null`, arrays, and any structured-clone
 * value with a non-`Object.prototype` prototype (`Map`, `Set`, `Date`, `RegExp`,
 * typed arrays, ...). Never throws: only ever inspects `typeof`/`Array.isArray`/
 * `Object.getPrototypeOf`, none of which can throw for a structured-clone-compatible
 * IndexedDB value, however exotic (including one containing a cycle — a cycle is only
 * a problem for something that walks the *whole* structure, like `JSON.stringify`,
 * which this function and everything downstream of it deliberately never calls on an
 * untrusted stored value).
 */
function isPlainMarkerCandidate(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True only when `value` has exactly `MARKER_FIELDS`' own enumerable keys — no
 * missing field, no extra field. `Object.keys` never throws for a plain object,
 * cyclic or not, since it only walks one level of own property names. */
function hasExactMarkerFields(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === MARKER_FIELDS.length &&
    MARKER_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  );
}

/** Aborts a transaction defensively — calling `.abort()` on one that has already
 * committed, aborted, or finished throws `InvalidStateError`, which is never useful
 * information here (every caller already knows it wants the transaction gone). Also
 * silences the `AbortError` `tx.done` always rejects with afterward, which every
 * caller here has already decided is expected, not a new failure to report. */
function abortSafely(tx: { abort: () => void; done: Promise<void> }): void {
  try {
    tx.abort();
  } catch {
    // Already committed/aborted/finished — nothing left to do.
  }
  tx.done.catch(() => {});
}

/**
 * Shared by `readDomainMarker` and `commitDomainSnapshot`'s internal re-check — one
 * validation rule, used everywhere a marker is read, so "absent"/"complete"/"invalid"
 * can never be decided two different ways in two different places.
 *
 * Total and exact: a value is `"complete"` only if it is a plain object with exactly
 * `MARKER_FIELDS`' four fields (no missing, no extra) and every field matches exactly
 * — anything else, including a well-formed-looking marker with one additional field,
 * fails closed as `"invalid"`. Reason strings are fixed, deterministic messages, never
 * built from the untrusted value itself (never `JSON.stringify`, which throws on a
 * `BigInt` or a cyclic structure — exactly the kind of structured-clone-compatible
 * value IndexedDB can hand back here) — this function is guaranteed not to throw for
 * any value IndexedDB could possibly have stored.
 */
function validateMarker(
  raw: unknown,
  expectedDomain: string,
  expectedSourceKeys: readonly string[]
): { status: "absent" } | { status: "complete" } | { status: "invalid"; reason: string } {
  if (raw === undefined) {
    return { status: "absent" };
  }
  if (!isPlainMarkerCandidate(raw)) {
    return { status: "invalid", reason: "marker is not a plain object" };
  }
  if (!hasExactMarkerFields(raw)) {
    return { status: "invalid", reason: "marker does not have exactly the expected fields" };
  }
  if (raw.protocolVersion !== MIGRATION_PROTOCOL_VERSION) {
    return { status: "invalid", reason: "marker has an unexpected protocolVersion" };
  }
  if (raw.domain !== expectedDomain) {
    return { status: "invalid", reason: "marker has an unexpected domain" };
  }
  if (raw.status !== "complete") {
    return { status: "invalid", reason: "marker has an unexpected status" };
  }
  if (!Array.isArray(raw.sourceKeys) || !arraysEqual(raw.sourceKeys, expectedSourceKeys)) {
    return { status: "invalid", reason: "marker has an unexpected sourceKeys list" };
  }
  return { status: "complete" };
}

/**
 * Creates the migration-control interface for one IndexedDB database — sharing the
 * exact same lazy/cached/retry-safe connection lifecycle `createIndexedDbAdapter` uses
 * (see `createIndexedDbConnection` above), not a second, independent `openDB`/cache/
 * error-classification implementation.
 */
export function createIndexedDbMigrationTarget(
  options: IndexedDbAdapterOptions = {}
): IndexedDbMigrationTarget {
  const databaseName = options.databaseName ?? INDEXED_DB_DATABASE_NAME;
  const databaseVersion = options.databaseVersion ?? INDEXED_DB_VERSION;
  const { getConnection } = createIndexedDbConnection(databaseName, databaseVersion);

  return {
    async readDomainMarker(
      domain: string,
      sourceKeys: readonly string[]
    ): Promise<IndexedDbMigrationMarkerReadResult> {
      try {
        const db = await getConnection();
        const raw = await db.get(METADATA_STORE_NAME, buildMigrationMarkerKey(domain));
        return validateMarker(raw, domain, sourceKeys);
      } catch (error) {
        return { status: "read_failed", error: classifyReadError(error) };
      }
    },

    async commitDomainSnapshot(
      snapshot: IndexedDbMigrationDomainSnapshot
    ): Promise<IndexedDbMigrationCommitResult> {
      const recordKeys = snapshot.records.map((record) => record.key);
      if (!arraysEqual(recordKeys, snapshot.sourceKeys)) {
        return {
          status: "failed",
          error: {
            kind: "unknown",
            message: "snapshot records do not correspond exactly to sourceKeys",
          },
        };
      }

      let tx:
        | IDBPTransaction<unknown, [typeof RECORDS_STORE_NAME, typeof METADATA_STORE_NAME], "readwrite">
        | undefined;
      try {
        const db = await getConnection();
        tx = db.transaction([RECORDS_STORE_NAME, METADATA_STORE_NAME], "readwrite");
        const metadataStore = tx.objectStore(METADATA_STORE_NAME);
        const recordsStore = tx.objectStore(RECORDS_STORE_NAME);
        const markerKey = buildMigrationMarkerKey(snapshot.domain);

        // Re-read and re-validate the marker inside this same transaction — see the
        // interface doc comment above for why this, not a check before the
        // transaction started, is what makes concurrent commits safe.
        const existingMarkerRaw = await metadataStore.get(markerKey);
        const validation = validateMarker(existingMarkerRaw, snapshot.domain, snapshot.sourceKeys);

        if (validation.status === "complete") {
          await tx.done;
          return { status: "already_complete" };
        }
        if (validation.status === "invalid") {
          // Fail closed: never silently overwrite or adopt an invalid marker as
          // complete. Nothing has been written yet, so there is nothing to undo, but
          // the transaction is still explicitly aborted rather than committed.
          abortSafely(tx);
          return { status: "invalid_marker", reason: validation.reason };
        }

        // status === "absent": clear any stale prior data for this domain's exact
        // keys, then write only the keys whose source value is non-null, then write
        // the completion marker last — all inside this one transaction.
        for (const key of snapshot.sourceKeys) {
          await recordsStore.delete(key);
        }
        for (const record of snapshot.records) {
          if (record.value !== null) {
            await recordsStore.put(record.value, record.key);
          }
        }
        const marker: IndexedDbMigrationDomainMarker = {
          protocolVersion: MIGRATION_PROTOCOL_VERSION,
          domain: snapshot.domain,
          status: "complete",
          sourceKeys: [...snapshot.sourceKeys],
        };
        await metadataStore.put(marker, markerKey);
        await tx.done;
        return { status: "committed" };
      } catch (error) {
        // Explicitly abort rather than relying solely on IndexedDB's own automatic
        // abort-on-request-error behavior: a synchronous throw from within a request
        // call (as opposed to an asynchronous request-level error event) does not
        // reliably trigger that automatic path by itself. Explicitly aborting here
        // guarantees the same atomicity — nothing written above in this transaction
        // survives — regardless of exactly how the failure manifested. A later call
        // with the same snapshot can simply retry.
        if (tx) abortSafely(tx);
        return { status: "failed", error: classifyWriteError(error) };
      }
    },
  };
}
