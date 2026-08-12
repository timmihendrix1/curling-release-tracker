// The one, sole implementation of StorageAdapter for Phase 1 — wraps `localStorage`
// directly. See docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 and ADR-0013. Every repository
// depends on the `StorageAdapter` interface (types.ts), never on this module or on
// `localStorage` directly — this is the only file in the persistence layer permitted to
// reference the global `localStorage` object (enforced by
// src/lib/persistence/__tests__/noDirectStorageAccess.test.ts).
import type {
  PersistenceReadError,
  PersistenceWriteError,
  PersistenceWriteResult,
  StorageAdapter,
  StorageGetResult,
} from "./types";
import { writeFailed, writeOk } from "./types";

function isDomException(error: unknown): error is DOMException {
  return (
    typeof DOMException !== "undefined" && error instanceof DOMException
  );
}

/** Recognizes the several historical names/codes browsers have used for "quota
 * exceeded" — see MDN's Web Storage API exceptions reference. */
function isQuotaExceededError(error: unknown): boolean {
  if (!isDomException(error)) return false;
  return (
    error.name === "QuotaExceededError" ||
    error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
    error.code === 22 ||
    error.code === 1014
  );
}

function isStorageUnavailableError(error: unknown): boolean {
  if (typeof localStorage === "undefined") return true;
  if (!isDomException(error)) return false;
  return error.name === "SecurityError";
}

function classifyWriteError(error: unknown): PersistenceWriteError {
  if (isQuotaExceededError(error)) return { kind: "quota_exceeded" };
  if (isStorageUnavailableError(error)) return { kind: "storage_unavailable" };
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

function classifyReadError(error: unknown): PersistenceReadError {
  if (isStorageUnavailableError(error)) return { kind: "storage_unavailable" };
  return { kind: "unknown", message: error instanceof Error ? error.message : String(error) };
}

/**
 * Creates the real, `localStorage`-backed StorageAdapter. Synchronous under the hood
 * (localStorage has no async API), but every method returns a Promise so no
 * caller-visible signature change is needed when a future IndexedDB-backed
 * implementation replaces this one — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §9.
 */
export function createLocalStorageAdapter(): StorageAdapter {
  return {
    async get(key: string): Promise<StorageGetResult> {
      if (typeof localStorage === "undefined") {
        return {
          status: "read_failed",
          fallback: null,
          error: { kind: "storage_unavailable" },
        };
      }
      try {
        return { status: "value", value: localStorage.getItem(key) };
      } catch (error) {
        return { status: "read_failed", fallback: null, error: classifyReadError(error) };
      }
    },

    async set(key: string, value: string): Promise<PersistenceWriteResult> {
      if (typeof localStorage === "undefined") {
        return writeFailed({ kind: "storage_unavailable" });
      }
      try {
        localStorage.setItem(key, value);
        return writeOk();
      } catch (error) {
        return writeFailed(classifyWriteError(error));
      }
    },
  };
}

/** One shared adapter instance for production use — repositories default to this
 * unless a test injects a different StorageAdapter. */
export const localStorageAdapter: StorageAdapter = createLocalStorageAdapter();
