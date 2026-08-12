// The (currently unwired) IndexedDB StorageAdapter implementation — Phase 2, Stage 2.
// See docs/adr/0015-indexeddb-adapter-unwired.md and
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §9/§10. This is the only production file
// permitted to reference the `indexedDB` global — enforced by
// src/lib/persistence/__tests__/architectureBoundary.test.ts. Nothing in this file is
// imported by any repository singleton or component; localStorage remains the sole
// production source of truth (see localStorageAdapter.ts) until a separate,
// explicitly-approved migration/activation task wires this in.
import { openDB, type IDBPDatabase } from "idb";
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
 * Creates the (currently unwired) IndexedDB-backed StorageAdapter. Opens the database
 * lazily — never at import time, and never at construction time — the first time
 * get()/set() is actually called, so importing or constructing this module has no
 * observable effect and stays safe under Next.js server-side evaluation where
 * `indexedDB` does not exist.
 *
 * A successful connection is cached and reused across calls. Three things invalidate
 * that cache so a later call reopens fresh rather than reusing a dead connection: an
 * open failure (including a blocked open, converted to a classified failure rather than
 * left to hang), a `blocking` notification (another, newer connection needs this one to
 * close — this connection closes itself immediately rather than indefinitely blocking
 * the other side), and an abnormal `terminated` closure.
 */
export function createIndexedDbAdapter(
  options: IndexedDbAdapterOptions = {}
): StorageAdapter {
  const databaseName = options.databaseName ?? INDEXED_DB_DATABASE_NAME;
  const databaseVersion = options.databaseVersion ?? INDEXED_DB_VERSION;

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
