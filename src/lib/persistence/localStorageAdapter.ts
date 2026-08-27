// The one, sole `localStorage`-backed adapter. It implements the base
// `StorageAdapter` contract AND the narrow `RemovableStorageAdapter` extension
// (docs/PERSISTENCE_BOUNDARY_DESIGN.md §9, ADR-0025 Decision 19), so the identity
// repositories that genuinely delete can depend on the removable type while the seven
// sporting repositories keep depending on the minimal one. Wraps `localStorage`
// directly. See docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 and ADR-0013. Every repository
// depends on the `StorageAdapter` interface (types.ts), never on this module or on
// `localStorage` directly — this is the only file in the persistence layer permitted to
// reference the global `localStorage` object (enforced by
// src/lib/persistence/__tests__/noDirectStorageAccess.test.ts).
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
 * The ONE message a removal failure ever carries. It is a fixed constant, not a
 * description of what was thrown.
 *
 * The read and write classifiers above forward `error.message`/`String(error)`; that is
 * pre-existing Phase 1 behaviour and is deliberately left alone. The removal capability
 * is new in Stage B0.2c and is used exclusively by identity repositories, where
 * ADR-0025 §G's rule is absolute: a caught value is never inspected, stringified,
 * logged, forwarded or embedded. Emitting a constant is how that becomes a property of
 * the code rather than a convention every caller has to re-honour.
 */
const REMOVAL_FAILED_MESSAGE = "The value could not be removed from local storage.";

/**
 * Classifies a removal failure into the two normalized kinds **without inspecting the
 * thrown value's contents at all**.
 *
 * A `QuotaExceededError` has no meaning for a deletion, so — unlike
 * `classifyWriteError` — there is no quota branch: anything that is not a recognizable
 * "storage unavailable" condition is `removal_failed`.
 *
 * The `storage_unavailable` distinction is preserved only where it can be established
 * SAFELY. Establishing it requires an `instanceof` check and a re-read of the
 * `localStorage` global, and either can itself throw — `instanceof` against a Proxy
 * with a hostile `getPrototypeOf` trap, and the global read against exactly the
 * condition being diagnosed. When that determination throws, the honest answer is that
 * the condition could not be established, so the result is the generic
 * `removal_failed`. This function is therefore total: it cannot throw for any input.
 */
function classifyRemoveError(error: unknown): PersistenceRemoveError {
  let unavailable = false;
  try {
    unavailable = isStorageUnavailableError(error);
  } catch {
    // The determination itself failed. No claim is made, and the thrown value is
    // discarded without being read.
    unavailable = false;
  }
  return unavailable
    ? { kind: "storage_unavailable" }
    : { kind: "removal_failed", message: REMOVAL_FAILED_MESSAGE };
}

/**
 * Creates the real, `localStorage`-backed adapter. Synchronous under the hood
 * (localStorage has no async API), but every method returns a Promise so no
 * caller-visible signature change is needed when a future IndexedDB-backed
 * implementation replaces this one — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §9.
 *
 * The return type is `RemovableStorageAdapter`, not the base `StorageAdapter`. That
 * matters: annotating it as the base type would ERASE `remove` at this boundary, so an
 * identity repository declaring a `RemovableStorageAdapter` dependency could not be
 * given the real production adapter. `RemovableStorageAdapter extends StorageAdapter`,
 * so every one of the seven sporting repositories — all of which declare the base type
 * and never delete — is completely unaffected by the widening.
 */
export function createLocalStorageAdapter(): RemovableStorageAdapter {
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

    /**
     * Deletes one key, resolving one of three normalized outcomes and **never
     * rejecting** — for a thrown `Error`, a thrown non-`Error`, a throwing
     * `removeItem`, or a `localStorage` global that is itself a throwing getter.
     *
     * Unlike `get`/`set` above, the availability check is INSIDE the `try`. That is
     * deliberate: `typeof localStorage` reads the global, and Stage B0.2c's identity
     * callers require `remove` to be total, so the read that decides "unavailable"
     * must itself be contained rather than being the one thing that can escape.
     *
     * Removing a key that does not exist is a success. `localStorage.removeItem` is a
     * no-op for a missing key, and every caller wants "the key is not there" — a
     * caller that needs to know whether something WAS there reads first.
     */
    async remove(key: string): Promise<PersistenceRemoveResult> {
      try {
        if (typeof localStorage === "undefined") {
          return removeFailed({ kind: "storage_unavailable" });
        }
        localStorage.removeItem(key);
        return removeOk();
      } catch (error) {
        return removeFailed(classifyRemoveError(error));
      }
    },
  };
}

/**
 * One shared adapter instance for production use — repositories default to this unless
 * a test injects a different adapter.
 *
 * Annotated `RemovableStorageAdapter` for the same reason the factory is: the base type
 * would erase `remove` here, and this is the instance every production repository
 * defaults to. It remains assignable to `StorageAdapter`, so the seven sporting
 * repositories continue to compile against the minimal contract unchanged.
 */
export const localStorageAdapter: RemovableStorageAdapter = createLocalStorageAdapter();
