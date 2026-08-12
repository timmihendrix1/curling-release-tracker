// Application-owned persistence result types — see docs/PERSISTENCE_BOUNDARY_DESIGN.md
// §8 and ADR-0013. These are the only shapes a repository (or the StorageAdapter itself)
// ever resolves with; a raw browser exception (DOMException, QuotaExceededError, any
// future IndexedDB-specific transaction error) must never cross the StorageAdapter
// boundary — see localStorageAdapter.ts for where that translation happens.

/** Failure shape a write can produce. Never used for absence or for malformed/unknown-
 * version data — those remain each domain's own repair/quarantine/discard policy,
 * resolved entirely inside a `load*` call, which never fails. */
export type PersistenceWriteError =
  | { kind: "storage_unavailable" }
  | { kind: "quota_exceeded" }
  | { kind: "unknown"; message: string };

export type PersistenceWriteResult =
  | { ok: true }
  | { ok: false; error: PersistenceWriteError };

export function writeOk(): PersistenceWriteResult {
  return { ok: true };
}

export function writeFailed(error: PersistenceWriteError): PersistenceWriteResult {
  return { ok: false, error };
}

/** Failure shape a read can produce — a strict subset of PersistenceWriteError, since
 * "quota exceeded" has no meaning for a read. */
export type PersistenceReadError =
  | { kind: "storage_unavailable" }
  | { kind: "unknown"; message: string };

/**
 * The result every repository `load*` method resolves to. Three top-level outcomes —
 * see docs/PERSISTENCE_BOUNDARY_DESIGN.md §8.2 for the full rationale:
 *
 *   1. `"value"` — something was stored under the key, used as-is or repaired per the
 *      domain's existing policy if it was malformed or an unsupported schema version.
 *   2. `"absent"` — the storage key genuinely does not exist. Carries no value — the
 *      caller (hydration owner) initializes that domain's own documented default
 *      directly; this is never a generic "call the migration function on null" step.
 *   3. `"read_failed"` — a genuine storage-access failure. `fallback` is for display
 *      purposes only, never for persistence.
 */
export type DomainLoadResult<T> =
  | { status: "value"; value: T }
  | { status: "absent" }
  | { status: "read_failed"; fallback: T; error: PersistenceReadError };

export function loadedValue<T>(value: T): DomainLoadResult<T> {
  return { status: "value", value };
}

export function loadedAbsent<T>(): DomainLoadResult<T> {
  return { status: "absent" };
}

export function loadFailed<T>(
  fallback: T,
  error: PersistenceReadError
): DomainLoadResult<T> {
  return { status: "read_failed", fallback, error };
}

/**
 * The adapter's own, deliberately simpler read result — successful absence is
 * represented as a successful `value: null` (matching `localStorage.getItem`'s own
 * contract exactly) rather than adopting DomainLoadResult's three-way split at this raw,
 * string-only layer. Every repository built on this MUST translate a
 * `{ status: "value", value: null }` result into its own explicit `{ status: "absent" }`
 * — never pass `null` upward as if it were a domain value.
 */
export type StorageGetResult =
  | { status: "value"; value: string | null }
  | { status: "read_failed"; fallback: null; error: PersistenceReadError };

/**
 * The only component that knows about a specific browser storage mechanism, and the
 * only component that classifies its exceptions. Both methods always resolve — neither
 * ever rejects. No multi-key atomicity is claimed or possible through this interface;
 * `remove` is intentionally absent (see docs/PERSISTENCE_BOUNDARY_DESIGN.md §9) since no
 * current code path ever deletes a key.
 */
export interface StorageAdapter {
  get(key: string): Promise<StorageGetResult>;
  set(key: string, value: string): Promise<PersistenceWriteResult>;
}

/**
 * Per-domain hydration state for every effect-persisted domain (all repositories except
 * AssessmentPreferencesRepository, which has no mount/save effect to gate) — see
 * docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.
 *
 * - "loading": initial state, before the domain's load* call resolves.
 * - "ready": the load resolved `{ status: "value" }` or `{ status: "absent" }` — safe to
 *   persist going forward. Only in this state may the domain's save effect run.
 * - "write_protected": the load resolved `{ status: "read_failed" }`. The domain's state
 *   is set to the result's `fallback` for display only; the save effect stays disabled
 *   for the rest of the session.
 */
export type DomainHydrationState = "loading" | "ready" | "write_protected";
