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
 * ever rejects. No multi-key atomicity is claimed or possible through this interface.
 *
 * `remove` is deliberately **not** part of this minimal contract: the seven sporting
 * repositories never delete a key (every "clear" there is a full overwrite with a
 * smaller or empty value), so depending on a deletion primitive they cannot use would
 * widen their capability for nothing. Repositories that genuinely delete depend on
 * `RemovableStorageAdapter` below instead — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §9
 * for the per-repository inventory and ADR-0025 Decision 19.
 */
export interface StorageAdapter {
  get(key: string): Promise<StorageGetResult>;
  set(key: string, value: string): Promise<PersistenceWriteResult>;
}

/** Failure shape a removal can produce. Deliberately narrower than
 * `PersistenceWriteError` — "quota exceeded" has no meaning for a deletion. */
export type PersistenceRemoveError =
  | { kind: "storage_unavailable" }
  | { kind: "removal_failed"; message: string };

export type PersistenceRemoveResult =
  | { ok: true }
  | { ok: false; error: PersistenceRemoveError };

export function removeOk(): PersistenceRemoveResult {
  return { ok: true };
}

export function removeFailed(error: PersistenceRemoveError): PersistenceRemoveResult {
  return { ok: false, error };
}

/**
 * The narrow removable extension of `StorageAdapter` — see
 * docs/PERSISTENCE_BOUNDARY_DESIGN.md §9 and ADR-0025 Decision 19.
 *
 * Stage B0.2's identity records (a device trust record, an access barrier, an
 * interactive-authentication attempt, a barrier resolution and a pending deep-link
 * intent) are the first records for which removal is a genuine operation rather than
 * an overwrite. Only the identity repositories that actually delete depend on this
 * type; **`identityBarrierRepository` deliberately does not**, because no code path
 * may remove a current barrier as a security transition — a barrier is superseded by
 * writing a newer one and completed by a separate, per-barrier resolution record.
 *
 * Two kinds of removal exist behind this one method and must not be grouped together
 * (design doc §9): **required** removal, whose failure blocks a transition
 * (trusted-state invalidation, pending-intent deletion), and **best-effort cleanup**
 * of records that are already non-current, whose failure changes nothing and never
 * affects authorization.
 *
 * **This is not, and must not be presented as, a solution to multi-key atomicity.**
 * A plain `remove` still offers no compare-and-delete, which is precisely why
 * ADR-0025 resolves a barrier with a key derived from that barrier's own id instead
 * of deleting a shared key.
 *
 * `remove` always resolves — never rejects — exactly like `get` and `set`.
 */
export interface RemovableStorageAdapter extends StorageAdapter {
  remove(key: string): Promise<PersistenceRemoveResult>;
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
