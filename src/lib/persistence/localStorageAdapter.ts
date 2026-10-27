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
import { classifyMigrationSourceKey, isEligibleMigrationKey, isUnsupportedMigrationIdentityControlKey, NATIVE_MIGRATION_SOURCE_MARKER_KEY, NATIVE_MIGRATION_DIAGRAM_CACHE_PREFIX } from "./nativeMigrationEligibility";
import { classifyCredentialKey, fixedCredentialSlots, ROOT_PATTERN, validateQuiescentCredentialSnapshot } from "../supabase/providerCredentialContract";
import { planInstallationTransferInventoryV2, expectedSlots, TRANSFER_CONTROL_KEYS, TRANSFER_LIMITS, TRANSFER_LEGACY_KEY, TRANSFER_PROFILE_PREFIX, type ReadPlan } from "./installationTransferInventory";
import { drainObservedPlatformWork } from "./platformSha256";

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

/* ==========================================================================
 * The migration-only SOURCE capability — Stage M3b4b
 * ==========================================================================
 *
 * docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3 specifies `EnumerableStorageSource`:
 * a migration-only way to list the WebView store's keys. It lives here because
 * this is the one module permitted to touch the `localStorage` global, and it is
 * deliberately NOT part of `StorageAdapter` or `RemovableStorageAdapter`: no
 * repository can enumerate, and the repository-facing contracts are unchanged.
 *
 * This section knows nothing about migration RULES. Which keys' values may be
 * read and which one key may be written are supplied by the caller as a policy
 * (`nativeMigrationSource.ts` supplies the approved eligibility test and the
 * reserved marker key), so this ubiquitous module imports nothing new.
 *
 * Properties, each one load-bearing:
 *   - constructing it touches nothing; every access happens inside a call;
 *   - a failed or inconsistent enumeration is `read_failed`, never a smaller
 *     successful key set — a missing key there would be a silent omission;
 *   - enumerating a key never authorises reading its value: a value read is
 *     REFUSED unless the policy admits that key, so provider credentials and the
 *     disposable diagram cache are listed by name and never read;
 *   - values are returned exactly as stored — no parsing, repair or normalisation;
 *   - the only write is the policy's marker key, and only over a POSITIVELY
 *     ABSENT marker (`writeMarkerIfAbsent`); nothing is removed or cleared;
 *   - every failure carries a FIXED message. A caught value is never inspected,
 *     stringified or forwarded, unlike the legacy read/write classifiers above,
 *     which this section deliberately does not change.
 *
 * Enumeration is not atomic against another process or another build writing
 * the same WebView store. Two passes that disagree are reported as a failure,
 * which catches some concurrent change but cannot exclude all of it; the
 * design's writer-exclusion residual (Stage M3b0 §5.5) stands unchanged.
 */

/** §3's migration-only enumeration contract. */
export interface EnumerableStorageSource {
  listKeys(): Promise<
    | { status: "value"; keys: readonly string[] }
    | { status: "read_failed"; error: PersistenceReadError }
  >;
}

/** Supplied by the migration module; see the section comment. */
export interface MigrationSourcePolicy {
  /** The ONE key this capability may write: the migration's source marker (I-3). */
  readonly markerKey: string;
  /** Whether a key's VALUE may be read. A predicate that throws refuses. */
  readonly mayReadValue: (key: string) => boolean;
}

export type MigrationSourceValueResult =
  /** `value: null` is a SUCCESSFUL read that found no key. */
  | { status: "value"; value: string | null }
  | { status: "read_failed"; error: PersistenceReadError }
  /** The policy does not admit reading this key's value. Nothing was read. */
  | { status: "refused" };

/**
 * The outcome of a marker write attempt (I-3, I-4, PV12).
 *
 * The precondition is re-established AT THE WRITE: the current marker is read
 * and, in the same synchronous turn, written only if it is positively absent.
 * A foreign or malformed marker is therefore never overwritten, and an
 * unreadable one never authorises a write. This is a same-turn check within
 * this JavaScript context, NOT a compare-and-swap: Web Storage offers none,
 * and another process or build writing the same store is the documented
 * writer-exclusion residual (Stage M3b0 §5.5).
 */
export type MigrationMarkerWriteResult =
  /** The marker was absent and the write was acknowledged. */
  | { status: "written" }
  /** The marker already equals the value. Nothing was written. */
  | { status: "already_matching" }
  /** NOT ISSUED: the marker holds other bytes, or could not be read. Nothing was written. */
  | { status: "refused"; reason: "marker_present" | "marker_unreadable" }
  /** The write was issued and failed. It may have applied (I-9): outcome unknown. */
  | { status: "write_failed"; error: PersistenceWriteError };

export interface MigrationSourceStore extends EnumerableStorageSource {
  /** Reads one admitted key's exact stored string. */
  readValue(key: string): Promise<MigrationSourceValueResult>;
  /** Reads the marker key. Its value is returned verbatim; validating it is the caller's job. */
  readMarker(): Promise<StorageGetResult>;
  /** Writes the marker key over a positively absent marker only — the only source
   * write this capability can issue. */
  writeMarkerIfAbsent(value: string, control?: { readonly proceed: () => boolean }): Promise<MigrationMarkerWriteResult>;
}

const SOURCE_ENUMERATION_FAILED_MESSAGE = "The local storage keys could not be listed.";
const SOURCE_READ_FAILED_MESSAGE = "The value could not be read from local storage.";
const SOURCE_WRITE_FAILED_MESSAGE = "The value could not be written to local storage.";

/** Thrown internally for a malformed or inconsistent enumeration; never escapes. */
class InconsistentEnumeration extends Error {}

type ResolvedStorage = { ok: true; storage: Storage } | { ok: false };

/** Reads the global INSIDE a guard: the getter itself can throw. */
function resolveStorage(): ResolvedStorage {
  try {
    if (typeof localStorage === "undefined" || localStorage === null) return { ok: false };
    return { ok: true, storage: localStorage };
  } catch {
    return { ok: false };
  }
}

/** Total: never throws, never reads the thrown value's text. */
function migrationReadError(error: unknown): PersistenceReadError {
  let unavailable = false;
  try {
    unavailable = !(error instanceof InconsistentEnumeration) && isStorageUnavailableError(error);
  } catch {
    unavailable = false;
  }
  return unavailable ? { kind: "storage_unavailable" } : { kind: "unknown", message: SOURCE_READ_FAILED_MESSAGE };
}

function migrationWriteError(error: unknown): PersistenceWriteError {
  try {
    if (isQuotaExceededError(error)) return { kind: "quota_exceeded" };
    if (isStorageUnavailableError(error)) return { kind: "storage_unavailable" };
  } catch {
    /* the determination itself failed: no claim is made */
  }
  return { kind: "unknown", message: SOURCE_WRITE_FAILED_MESSAGE };
}

/** One complete pass over `length`/`key(i)`. Any irregularity throws. */
function enumerationPass(storage: Storage): string[] {
  const length = storage.length;
  if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) {
    throw new InconsistentEnumeration();
  }
  const keys: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    const key = storage.key(index);
    // `null` inside the advertised length means the store changed underneath us.
    if (typeof key !== "string" || seen.has(key)) throw new InconsistentEnumeration();
    seen.add(key);
    keys.push(key);
  }
  if (storage.length !== length) throw new InconsistentEnumeration();
  return keys;
}

export function createLocalStorageMigrationSource(policy: MigrationSourcePolicy): MigrationSourceStore {
  return buildLocalStorageMigrationSource(policy, resolveStorage);
}

function buildLocalStorageMigrationSource(policy: MigrationSourcePolicy, resolve: () => ResolvedStorage): MigrationSourceStore {
  const { markerKey } = policy;

  function admits(key: string): boolean {
    if (key === markerKey) return false;
    try {
      return policy.mayReadValue(key) === true;
    } catch {
      return false;
    }
  }

  return {
    async listKeys() {
      const resolved = resolve();
      if (!resolved.ok) return { status: "read_failed", error: { kind: "storage_unavailable" } };
      try {
        const first = enumerationPass(resolved.storage);
        const second = enumerationPass(resolved.storage);
        if (first.length !== second.length || first.some((key, index) => key !== second[index])) {
          throw new InconsistentEnumeration();
        }
        return { status: "value", keys: Object.freeze(first) };
      } catch (error) {
        const normalized = migrationReadError(error);
        return {
          status: "read_failed",
          error: normalized.kind === "unknown" ? { kind: "unknown", message: SOURCE_ENUMERATION_FAILED_MESSAGE } : normalized,
        };
      }
    },

    async readValue(key: string): Promise<MigrationSourceValueResult> {
      if (typeof key !== "string" || !admits(key)) return { status: "refused" };
      const resolved = resolve();
      if (!resolved.ok) return { status: "read_failed", error: { kind: "storage_unavailable" } };
      try {
        const value = resolved.storage.getItem(key);
        if (value !== null && typeof value !== "string") {
          return { status: "read_failed", error: { kind: "unknown", message: SOURCE_READ_FAILED_MESSAGE } };
        }
        return { status: "value", value };
      } catch (error) {
        return { status: "read_failed", error: migrationReadError(error) };
      }
    },

    async readMarker(): Promise<StorageGetResult> {
      const resolved = resolve();
      if (!resolved.ok) return { status: "read_failed", fallback: null, error: { kind: "storage_unavailable" } };
      try {
        const value = resolved.storage.getItem(markerKey);
        if (value !== null && typeof value !== "string") {
          return { status: "read_failed", fallback: null, error: { kind: "unknown", message: SOURCE_READ_FAILED_MESSAGE } };
        }
        return { status: "value", value };
      } catch (error) {
        return { status: "read_failed", fallback: null, error: migrationReadError(error) };
      }
    },

    async writeMarkerIfAbsent(value: string, control?: { readonly proceed: () => boolean }): Promise<MigrationMarkerWriteResult> {
      const allowed = () => { try { return control === undefined || control.proceed() === true; } catch { return false; } };
      if (!allowed()) return { status: "refused", reason: "marker_unreadable" };
      const resolved = resolve();
      if (!resolved.ok) return { status: "refused", reason: "marker_unreadable" };
      // Check and write in ONE synchronous turn: no await between them.
      let current: unknown;
      try {
        current = resolved.storage.getItem(markerKey);
      } catch {
        return { status: "refused", reason: "marker_unreadable" };
      }
      if (!allowed()) return { status: "refused", reason: "marker_unreadable" };
      if (current !== null && typeof current !== "string") return { status: "refused", reason: "marker_unreadable" };
      if (current === value) return { status: "already_matching" };
      if (current !== null) return { status: "refused", reason: "marker_present" };
      try {
        resolved.storage.setItem(markerKey, value);
        return { status: "written" };
      } catch (error) {
        return { status: "write_failed", error: migrationWriteError(error) };
      }
    },
  };
}

declare const combinedSourceProof: unique symbol;
/** Internal provenance only; neither a storage nor an identity grant. */
export type NativeCombinedSourceProof = { readonly [combinedSourceProof]: true };
type CredentialSnapshot = {
  readonly enumerationComplete: true;
  readonly listedKeys: readonly string[];
  readonly reads: readonly { readonly key: string; readonly result: { readonly status: "absent" } | { readonly status: "value"; readonly value: string } }[];
};
type CredentialInventory = Extract<ReturnType<typeof validateQuiescentCredentialSnapshot>, { ok: true }>["value"];
export type NativeCombinedSourceCapture = { readonly status: "unavailable" | "invalid_source" | "source_changed" } | {
  readonly status: "captured";
  readonly proof: NativeCombinedSourceProof;
  readonly credentialSnapshot: CredentialSnapshot;
  readonly credentialInventory: CredentialInventory;
  readonly domainRows: readonly { readonly key: string; readonly value: string }[];
  readonly marker: string | null;
};
type OwnedCombinedCapture = Extract<NativeCombinedSourceCapture, { status: "captured" }>;
export interface NativeCombinedWebViewSource {
  readonly domain: Readonly<MigrationSourceStore>;
  capture(all: boolean, expectedCredentialKeys?: readonly string[]): NativeCombinedSourceCapture;
  fence(proof: unknown): "unchanged" | "changed" | "unavailable";
}
const combinedSourceProofs = new WeakMap<object, { owner: object; all: boolean; capture: OwnedCombinedCapture; fence: (proof: unknown) => "unchanged" | "changed" | "unavailable" }>();
/** Internal adapter bridge: exact factory/proof provenance, no property reads. */
export function resolveNativeCombinedSourceProof(source: unknown, proof: unknown, requireAll: boolean): OwnedCombinedCapture | null {
  if (proof === null || (typeof proof !== "object" && typeof proof !== "function")) return null;
  const owned = combinedSourceProofs.get(proof);
  return owned && owned.owner === source && (!requireAll || owned.all) ? owned.capture : null;
}
export function fenceNativeCombinedSourceProof(source: unknown, proof: unknown, requireAll: boolean): "unchanged" | "changed" | "unavailable" {
  if (!resolveNativeCombinedSourceProof(source, proof, requireAll)) return "unavailable";
  return combinedSourceProofs.get(proof as object)!.fence(proof);
}

/** S3f's actual source binding. Both capabilities lazily bind ONE storage object.
 * Only this global-storage boundary can mint its private synchronous raw proof.
 * No remove, caller snapshots, hashes or foreign callbacks in the last fence. */
export function createNativeCombinedWebViewSource(root: string): NativeCombinedWebViewSource {
  return buildCombinedWebViewSource(root, false);
}
const newUserSources = new WeakSet<object>();
export function createNativeNewUserWebViewSource(root: string): NativeCombinedWebViewSource {
  const source = buildCombinedWebViewSource(root, true); newUserSources.add(source); return source;
}
/** Actual strict factory/proof provenance, never a supplied empty-shaped snapshot. */
export function resolveNativeNewUserSourceProof(source: unknown, proof: unknown): OwnedCombinedCapture | null {
  if (source === null || typeof source !== "object" || !newUserSources.has(source)) return null;
  return resolveNativeCombinedSourceProof(source, proof, true);
}
function buildCombinedWebViewSource(root: string, emptyOnly: boolean): NativeCombinedWebViewSource {
  if (typeof root !== "string" || ROOT_PATTERN.exec(root)?.[0] !== root) throw new TypeError("Unsupported credential source");
  let bound: Storage | null = null;
  let boundActual: Storage | null = null;
  let boundGet: ((name: string) => unknown) | null = null;
  let boundKey: ((index: number) => unknown) | null = null;
  const apply = Reflect.apply;
  const unsupportedNames = Object.freeze({});
  const proofs = new WeakMap<object, { all: boolean; names: readonly string[]; values: ReadonlyMap<string, string | null> }>();
  function storage(): ResolvedStorage {
    if (bound) return { ok: true, storage: bound };
    const resolved = resolveStorage();
    if (!resolved.ok) return resolved;
    try {
      const actual = resolved.storage, get = actual.getItem, set = actual.setItem, key = actual.key;
      if (typeof get !== "function" || typeof set !== "function" || typeof key !== "function") return { ok: false };
      bound = Object.freeze({
        get length() { return actual.length; },
        key: (index: number) => apply(key, actual, [index]),
        getItem: (name: string) => apply(get, actual, [name]),
        setItem: (name: string, value: string) => apply(set, actual, [name, value]),
      }) as unknown as Storage;
      boundActual = actual;
      boundGet = name => apply(get,actual,[name]);
      boundKey = index => apply(key,actual,[index]);
      return { ok: true, storage: bound };
    } catch { return { ok: false }; }
  }
  const domain = buildLocalStorageMigrationSource({ markerKey: NATIVE_MIGRATION_SOURCE_MARKER_KEY, mayReadValue: isEligibleMigrationKey }, storage);
  // This classifier is closed production code, never an injected predicate.
  function namesOf(keys: readonly string[], all: boolean): string[] {
    const names: string[] = [];
    let count = 0, flows = 0;
    for (const key of keys) {
      if (emptyOnly) {
        if (!key.startsWith(NATIVE_MIGRATION_DIAGRAM_CACHE_PREFIX)) throw unsupportedNames;
        continue;
      }
      const credential = classifyCredentialKey(root, key);
      if (credential.kind === "unsupported_own") throw unsupportedNames;
      if (credential.kind !== "foreign") {
        if (++count > 1024 || (credential.kind === "flow_verifier" && ++flows > 1020)) throw unsupportedNames;
        names.push(key);
      } else if (all) {
        if (isUnsupportedMigrationIdentityControlKey(key)) throw unsupportedNames;
        if (classifyMigrationSourceKey(key).eligible) names.push(key);
      }
    }
    return names.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  }
  function sameNames(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((key, index) => key === b[index]); }
  function listed(actual: Storage, all: boolean): string[] {
    const first = enumerationPass(actual), second = enumerationPass(actual);
    if (!sameNames(first, second)) throw new InconsistentEnumeration();
    return namesOf(first, all);
  }
  const unavailable = Object.freeze({ status: "unavailable" as const });
  const source: NativeCombinedWebViewSource = Object.freeze({
    domain: emptyOnly ? Object.freeze<MigrationSourceStore>({
      async listKeys() { return source.capture(true).status === "captured" ? { status: "value", keys: [] } : { status: "read_failed", error: { kind: "storage_unavailable" } }; },
      async readMarker() { return source.capture(true).status === "captured" ? { status: "value", value: null } : { status: "read_failed", fallback: null, error: { kind: "storage_unavailable" } }; },
      async readValue() { return { status: "refused" }; },
      async writeMarkerIfAbsent() { return { status: "refused", reason: "marker_unreadable" }; },
    }) : Object.freeze(domain),
    capture(all: boolean, expectedCredentialKeys?: readonly string[]): NativeCombinedSourceCapture {
      if (all !== true && all !== false) return unavailable;
      if (emptyOnly) all = true;
      const resolved = storage(); if (!resolved.ok) return unavailable;
      try {
        const actual = resolved.storage, names = listed(actual, all);
        const own = names.filter(key => classifyCredentialKey(root, key).kind !== "foreign");
        // Retain an already complete keyset contradiction before ANY payload read.
        if (expectedCredentialKeys && !sameNames(own, expectedCredentialKeys)) return { status: "source_changed" };
        const required = [...new Set([...names, ...fixedCredentialSlots(root).map(slot => slot.key), ...(all ? [NATIVE_MIGRATION_SOURCE_MARKER_KEY] : [])])];
        const values = new Map<string, string | null>();
        let total = 0;
        for (const key of required) {
          const raw: unknown = actual.getItem(key);
          if (raw !== null && typeof raw !== "string") return unavailable;
          if (classifyCredentialKey(root, key).kind !== "foreign" && typeof raw === "string") {
            if (raw.length > 1_048_576 || total > 8_388_608 - raw.length) return { status: "invalid_source" };
            total += raw.length;
          }
          values.set(key, raw);
        }
        if (!sameNames(names, listed(actual, all))) return unavailable;
        const credentialSnapshot: CredentialSnapshot = Object.freeze({ enumerationComplete: true, listedKeys: Object.freeze(own),
          reads: Object.freeze([...new Set([...own, ...fixedCredentialSlots(root).map(slot => slot.key)])].map(key => {
            const value = values.get(key);
            return Object.freeze({ key, result: value === null ? Object.freeze({ status: "absent" as const }) : Object.freeze({ status: "value" as const, value: value as string }) });
          })) });
        const checked = validateQuiescentCredentialSnapshot(root, credentialSnapshot);
        if (!checked.ok || (emptyOnly && (checked.value.initialEntryKeys.length || values.get(NATIVE_MIGRATION_SOURCE_MARKER_KEY) !== null || checked.value.fixedSlots.some(slot => slot.presence !== "absent")))) return { status: "invalid_source" };
        const domainRows = names.filter(key => classifyCredentialKey(root, key).kind === "foreign").map(key => {
          const value = values.get(key); if (typeof value !== "string") throw new InconsistentEnumeration();
          return Object.freeze({ key, value });
        });
        const proof = Object.freeze({}) as NativeCombinedSourceProof;
        proofs.set(proof, { all, names: Object.freeze(names), values });
        const capture = Object.freeze({ status: "captured" as const, proof, credentialSnapshot, credentialInventory: checked.value,
          domainRows: Object.freeze(domainRows), marker: all ? values.get(NATIVE_MIGRATION_SOURCE_MARKER_KEY) as string | null : null });
        combinedSourceProofs.set(proof, { owner: source, all, capture, fence: source.fence });
        return capture;
      } catch (error) { return error === unsupportedNames ? { status: "invalid_source" } : unavailable; }
    },
    fence(proof: unknown): "unchanged" | "changed" | "unavailable" {
      if (proof === null || (typeof proof !== "object" && typeof proof !== "function")) return "unavailable";
      const owned = proofs.get(proof); if (!owned || !bound) return "unavailable";
      let failed = false, changed = false;
      // Continue independent known reads after an unavailable read. Positive
      // differences outrank later unreadability; no hash or async boundary here.
      try { if (!sameNames(owned.names, listed(bound, owned.all))) changed = true; }
      catch (error) { if (error === unsupportedNames) changed = true; else failed = true; }
      for (const [key, before] of owned.values) {
        try {
          const raw: unknown = bound.getItem(key);
          if (raw !== null && typeof raw !== "string") failed = true;
          else if (raw !== before) changed = true;
        } catch { failed = true; }
      }
      try { if (!sameNames(owned.names, listed(bound, owned.all))) changed = true; }
      catch (error) { if (error === unsupportedNames) changed = true; else failed = true; }
      return changed ? "changed" : failed ? "unavailable" : "unchanged";
    },
  });
  let retirementHeld = false;
  if (!emptyOnly) retirementSourceFactories.set(source, () => {
    if (retirementHeld) return null;
    retirementHeld = true;
    // The new role exists and is attached to its owner BEFORE this resolver
    // performs any foreign operation. Older storage() callers are unchanged.
    return buildRetirementSource(root,guard => {
      guard.check();
      if (!boundActual || !boundGet || !boundKey) {
        let observed: unknown;
        try {
          observed = globalThis.localStorage;
          if (observed === null || (typeof observed !== "object" && typeof observed !== "function")) guard.invalid(observed);
          guard.check(observed);
          const actual = observed as Storage;
          const get = actual.getItem;
          if (typeof get !== "function") guard.invalid(get,actual);
          guard.check();
          const set = actual.setItem;
          if (typeof set !== "function") guard.invalid(set,actual);
          guard.check();
          const key = actual.key;
          if (typeof key !== "function") guard.invalid(key,actual);
          guard.check();
          bound = Object.freeze({
            get length() { return actual.length; },
            key: (index: number) => apply(key,actual,[index]),
            getItem: (name: string) => apply(get,actual,[name]),
            setItem: (name: string,value: string) => apply(set,actual,[name,value]),
          }) as unknown as Storage;
          boundActual = actual; boundGet = name => apply(get,actual,[name]); boundKey = index => apply(key,actual,[index]);
        } catch {
          // The thrown reason is irrelevant. This already observed binding
          // value still belongs to us, including a masked native Promise.
          guard.invalid(observed);
        }
      }
      const actual = boundActual, get = boundGet, keyAt = boundKey;
      if (!actual || !get || !keyAt) return guard.invalid(undefined);
      return {actual,get,keyAt};
    },() => { retirementHeld = false; });
  });
  return source;
}

declare const retirementSourceProof: unique symbol;
export type NativeRetirementSourceProof = { readonly [retirementSourceProof]: true };
export type NativeRetirementSourceFailure = "unavailable" | "source_changed" | "unsupported_source" | "cancelled";
export type NativeRetirementSourceObservation =
  | { readonly status: "failed"; readonly code: NativeRetirementSourceFailure }
  | { readonly status: "observed"; readonly proof: NativeRetirementSourceProof; readonly keys: readonly string[]; readonly entries: readonly { readonly key: string; readonly value: string | null }[] };
export type NativeRetirementRemoval = Readonly<{
  status: "absent" | "verified" | "failed";
  code: NativeRetirementSourceFailure | "operation_unverified" | null;
  removeIssued: boolean;
  removeAcknowledged: boolean;
  absenceReadIssued: boolean;
  absenceReadAcknowledged: boolean;
}>;
/** Internal Q3 lane. Only the genuine common owner consumes it; never a generic
 * adapter or permission supplied through retire()'s public input. */
export interface NativeCredentialRetirementSource {
  observe(requiredKeys: readonly string[]): NativeRetirementSourceObservation;
  observedAbsences(): readonly string[];
  prepareRemoval(): boolean;
  remove(proof: unknown, key: string, expected: string): NativeRetirementRemoval;
  fenceEmpty(proof: unknown): boolean;
  finish(): void;
  cancel(): void;
  release(): Promise<void>;
  current(): boolean;
}
const retirementSourceFactories = new WeakMap<object, () => NativeCredentialRetirementSource | null>();
/** Identity lookup only: foreign/copied source objects grant no mutation role. */
export function acquireNativeCredentialRetirementSource(source: unknown): NativeCredentialRetirementSource | null {
  if (source === null || (typeof source !== "object" && typeof source !== "function")) return null;
  return retirementSourceFactories.get(source)?.() ?? null;
}

type RetirementBindingGuard = { check(observed?: unknown): void; invalid(value: unknown, also?: unknown): never };
type RetirementBinding = { actual: Storage; get: (name: string) => unknown; keyAt: (index: number) => unknown };
function buildRetirementSource(root: string, resolve: (guard: RetirementBindingGuard) => RetirementBinding, released: () => void): NativeCredentialRetirementSource {
  const apply = Reflect.apply, then = Promise.prototype.then;
  let live = true, removable = true, generation = 0;
  let stopped: NativeRetirementSourceFailure | null = null;
  let removeOperation: ((key: string) => unknown) | null = null;
  let releaseFlight: Promise<void> | null = null;
  const pending: Promise<void>[] = [];
  const observedDependencies = new WeakSet<object>(), positiveAbsences = new Set<string>();
  let binding: RetirementBinding | null = null;
  const proofs = new WeakMap<object, { generation: number; required: readonly string[]; keys: readonly string[]; values: ReadonlyMap<string,string | null> }>();
  const invalid = Object.freeze({});
  function own(value: unknown): void {
    if (value !== null && (typeof value === "object" || typeof value === "function") && !observedDependencies.has(value)) {
      observedDependencies.add(value);
      pending.push(new Promise<void>(resolve => {
        try { void apply(then,value,[() => resolve(),() => resolve()]); }
        catch { void new Promise<unknown>(done => done(value)).then(() => resolve(),() => resolve()); }
      }));
    }
  }
  function stop(code: NativeRetirementSourceFailure, value?: unknown, also?: unknown): void {
    live = false; removable = false; generation++; stopped ??= code;
    own(value); own(also);
  }
  function revoke(code: NativeRetirementSourceFailure, value?: unknown, also?: unknown): never {
    stop(code,value,also);
    throw invalid;
  }
  const check = (observed?: unknown) => { if (!live) revoke(stopped ?? "cancelled",observed); };
  // Capture the real native/accessor length operation, rather than consulting a
  // replacement descriptor after acquisition. Ordinary Web Storage uses a getter.
  let lengthOperation: (() => unknown) | null = null;
  function bind(): void {
    if (binding) return;
    check(); binding = resolve({check,invalid:(value,also) => revoke("unavailable",value,also)}); check();
    let prototype: object | null = binding.actual;
    for (let depth = 0; prototype && depth < 16; depth++) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype,"length"); check();
      if (descriptor) {
        if (typeof descriptor.get !== "function") revoke("unavailable",descriptor.value);
        const getter = descriptor.get;
        lengthOperation = () => apply(getter,binding!.actual,[]); break;
      }
      prototype = Object.getPrototypeOf(prototype); check(prototype);
    }
    if (!lengthOperation) revoke("unavailable");
  }
  function length(): number {
    check(); const value = lengthOperation!();
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 16384) revoke("unavailable",value);
    check();
    return value;
  }
  function classify(names: readonly string[]): string[] {
    const own: string[] = []; let flows = 0;
    for (const key of names) {
      const kind = classifyCredentialKey(root,key);
      if (kind.kind === "unsupported_own") revoke("unsupported_source");
      if (kind.kind !== "foreign") {
        own.push(key);
        if (own.length > 1024 || (kind.kind === "flow_verifier" && ++flows > 1020)) revoke("unsupported_source");
      } else if (["curling.identity.","curling.nativeMigration.","curling.credential.","curling.installationTransfer."].some(prefix => key.startsWith(prefix))
        && key !== NATIVE_MIGRATION_SOURCE_MARKER_KEY && !isEligibleMigrationKey(key)) revoke("unsupported_source");
    }
    return own.sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  }
  function pass(): string[] {
    const before = length(), names: string[] = [], seen = new Set<string>();
    for (let index = 0; index < before; index++) {
      check(); const key = binding!.keyAt(index);
      if (typeof key !== "string") revoke("unavailable",key);
      check();
      if (seen.has(key)) revoke("unavailable");
      seen.add(key); names.push(key);
    }
    if (length() !== before) revoke("unavailable");
    classify(names); return names;
  }
  const same = (a: readonly string[],b: readonly string[]) => a.length === b.length && a.every((key,index) => key === b[index]);
  function names(): string[] {
    const first = pass(), second = pass();
    if (!same(first,second)) revoke("unavailable");
    return classify(first);
  }
  function read(key: string): string | null {
    check(); const value = binding!.get(key);
    if (value !== null && typeof value !== "string") revoke("unavailable",value);
    check();
    return value;
  }
  function proofOf(value: unknown) {
    if (value === null || (typeof value !== "object" && typeof value !== "function")) return null;
    const proof = proofs.get(value);
    return live && proof?.generation === generation ? proof : null;
  }
  const source: NativeCredentialRetirementSource = Object.freeze({
    observe(requiredKeys: readonly string[]) {
      try {
        check(); bind(); check(); generation++;
        if (requiredKeys.length > 1024 || requiredKeys.some(key => { const kind=classifyCredentialKey(root,key).kind; return kind === "foreign" || kind === "unsupported_own"; })) revoke("unsupported_source");
        const before = names(), required = [...new Set([...requiredKeys,...fixedCredentialSlots(root).map(slot => slot.key)])].sort();
        const values = new Map<string,string | null>();
        const addresses = [...new Set([...before,...required])].sort(); let total = 0;
        for (const key of addresses) {
          const value = read(key);
          if (value === null && required.includes(key)) positiveAbsences.add(key);
          if (value !== null) { if (value.length > 1048576 || total > 8388608 - value.length) revoke("unsupported_source"); total += value.length; }
          values.set(key,value);
        }
        if (!same(before,names()) || before.some(key => values.get(key) === null) || [...values].some(([key,value]) => value !== null && !before.includes(key))) revoke("source_changed");
        const proof = Object.freeze({}) as NativeRetirementSourceProof;
        proofs.set(proof,{generation,required:Object.freeze(required),keys:Object.freeze(before),values});
        return Object.freeze({status:"observed" as const,proof,keys:Object.freeze([...before]),entries:Object.freeze([...values].map(([key,value]) => Object.freeze({key,value})))});
      } catch { stop("unavailable",binding?.actual); return Object.freeze({status:"failed" as const,code:stopped!}); }
    },
    observedAbsences() { return Object.freeze([...positiveAbsences]); },
    prepareRemoval() {
      try {
        check(); if (!removable) return false;
        if (!removeOperation) {
          const operation: unknown = binding!.actual.removeItem;
          if (typeof operation !== "function") revoke("unavailable",operation);
          check(); removeOperation = operation as (key: string) => unknown;
          generation++;
        }
        return true;
      } catch { stop("unavailable",binding?.actual); return false; }
    },
    remove(value: unknown,key: string,expected: string) {
      let issued = false, acknowledged = false, readIssued = false, readAcknowledged = false;
      const report = (status: NativeRetirementRemoval["status"], code: NativeRetirementRemoval["code"]): NativeRetirementRemoval => Object.freeze({status,code,removeIssued:issued,removeAcknowledged:acknowledged,absenceReadIssued:readIssued,absenceReadAcknowledged:readAcknowledged});
      try {
        const proof = proofOf(value);
        if (!proof || !removable || !removeOperation || !proof.required.includes(key) || typeof expected !== "string" || proof.values.get(key) !== expected) return report("failed",stopped ?? "source_changed");
        // Removal was captured BEFORE the complete subset admission. No
        // dependency lookup or injected callback follows the final raw fence.
        if (!same(proof.keys,names())) revoke("source_changed");
        const current = read(key);
        if (current === null) { generation++; return report("absent",null); }
        if (current !== expected) revoke("source_changed");
        check(); issued = true; generation++;
        const returned = apply(removeOperation!,binding!.actual,[key]);
        if (returned !== undefined) revoke("unavailable",returned);
        acknowledged = true; check();
        readIssued = true; const after = binding!.get(key);
        if (after !== null && typeof after !== "string") revoke("unavailable",after);
        readAcknowledged = true; check();
        if (after !== null) revoke("source_changed");
        return report("verified",null);
      } catch {
        stop("unavailable",binding?.actual);
        return report("failed",issued ? "operation_unverified" : stopped);
      }
    },
    fenceEmpty(value: unknown) {
      const proof = proofOf(value);
      if (!proof || proof.keys.length || [...proof.values.values()].some(value => value !== null)) return false;
      const fresh = source.observe(proof.required);
      return fresh.status === "observed" && fresh.keys.length === 0 && fresh.entries.every(entry => entry.value === null) && live;
    },
    finish() { removable = false; },
    cancel() { live = false; removable = false; generation++; stopped ??= "cancelled"; },
    release() {
      if (releaseFlight) return releaseFlight;
      source.cancel();
      releaseFlight = Promise.all(pending).then(() => { released(); });
      return releaseFlight;
    },
    current() { return live; },
  });
  return source;
}

// S6d: observation only. No default caller, archive encoder or write capability.
type TransferSourceFailure = "unavailable" | "source_changed" | "source_unhealthy" | "source_unsupported" | "closed";
type TransferSourceCapture = Readonly<{
  ok: true; kind: "source_observation"; proof: object;
  counts: Readonly<{ profiles: number; slots: number; present: number; excluded: number }>;
  mayIssue: false; mayPublish: false; mayMount: false;
}> | Readonly<{ ok: false; code: TransferSourceFailure; mayIssue: false; mayPublish: false; mayMount: false }>;
type TransferSourceFence = "unchanged" | "changed" | "unavailable" | "closed";
type TransferStorageFunction = (...args: never[]) => unknown;
type TransferSourceMetadata = { constructor: TransferStorageFunction; prototype: object; length: TransferStorageFunction; key: TransferStorageFunction; get: TransferStorageFunction };
type TransferSourceBinding = TransferSourceMetadata & { receiver: object };
type TransferSourceObservation = { owner: object; proof: object; names: readonly string[]; values: ReadonlyMap<string, string | null> };
type TransferSourceOperation = {
  roots: Set<unknown>; drains: Promise<void>[]; phase: Promise<void>; endPhase(): void;
  work: Promise<TransferSourceCapture | TransferSourceFence>; done: Promise<void>;
  revoked: boolean; failure: TransferSourceFailure;
};
const transferSourceApply = Reflect.apply;
const transferSourceDescriptor = Object.getOwnPropertyDescriptor;
const transferSourcePrimitiveJson = JSON.stringify;
const transferSourceSeal = <T extends object>(value: T): Readonly<T> => Object.freeze(Object.assign(Object.create(null), value));
const transferSourceFailure = (code: TransferSourceFailure): TransferSourceCapture => transferSourceSeal({ ok: false as const, code, mayIssue: false as const, mayPublish: false as const, mayMount: false as const });

/** Private actual Web Storage observation. A proof never means frozen or admitted. */
export function createInstallationTransferWebViewSource() {
  let closed = false, poisoned = false;
  let binding: TransferSourceBinding | null = null, observation: TransferSourceObservation | null = null;
  let operation: TransferSourceOperation | null = null, closeWork: Promise<void> | null = null;
  let checker: TransferStorageFunction | null = null;
  const inert = new WeakSet<object>();
  const proofs = new WeakMap<object, TransferSourceObservation>();
  const drop = () => { if (observation) proofs.delete(observation.proof); observation = null; };
  function inertStorage(value: unknown): boolean {
    if (value === null || typeof value !== "object") return false;
    if (inert.has(value)) return true;
    if (!checker) return false;
    try {
      // The actual unchanged WebIDL getter is the explicit platform prerequisite.
      // Never probe receiver.then or descriptors: they can expose named user data.
      const size: unknown = transferSourceApply(checker, value, []);
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) return false;
      inert.add(value); return true;
    } catch { return false; }
  }
  function close(): Promise<void> {
    if (closeWork) return closeWork;
    closed = true; drop();
    let finish!: () => void;
    closeWork = new Promise<void>(resolve => { finish = resolve; });
    const held = operation;
    // Yield to the complete phase gate before looking at its observed work.
    // The exact closeWork identity is already installed before any observer runs.
    if (held) void held.phase.then(() => held.done).then(finish, finish);
    else finish();
    return closeWork;
  }
  function run(kind: "capture" | "fence", proof?: unknown): Promise<TransferSourceCapture | TransferSourceFence> {
    const refused = (code: TransferSourceFailure) => Promise.resolve(kind === "capture" ? transferSourceFailure(code) : code === "closed" ? "closed" as const : "unavailable" as const);
    if (closed) return refused("closed");
    if (poisoned || operation) return refused("unavailable");
    if (kind === "fence" && (!observation || proof !== observation.proof || observation.owner !== source || proofs.get(observation.proof) !== observation)) return refused("unavailable");
    const prior = kind === "fence" ? observation : null;
    if (kind === "capture") drop(); // exactly one map; a failed recapture cannot restore it
    let finishPhase!: () => void, finishWork!: (value: TransferSourceCapture | TransferSourceFence) => void;
    const phase = new Promise<void>(resolve => { finishPhase = resolve; });
    const work = new Promise<TransferSourceCapture | TransferSourceFence>(resolve => { finishWork = resolve; });
    const op: TransferSourceOperation = { roots: new Set(), drains: [], phase, endPhase: finishPhase, work, done: work.then(() => {}, () => {}), revoked: false, failure: "unavailable" };
    operation = op; // whole call owned before ANY foreign global/reflection/read
    const current = () => !closed && !poisoned && operation === op && !op.revoked;
    function stop(code: TransferSourceFailure, terminal = false): never {
      if (op.failure === "unavailable" || code === "source_changed") op.failure = code;
      op.revoked = true; if (terminal) poisoned = true; drop(); throw null;
    }
    function ensure() { if (!current()) stop(closed ? "closed" : "unavailable"); }
    function remember(value: unknown) {
      if (value !== null && (typeof value === "object" || typeof value === "function")) op.roots.add(value);
    }
    function read<T>(call: () => T): T {
      ensure(); const value = call(); remember(value); ensure(); return value;
    }
    function field(target: object, name: string, getter = false): unknown {
      ensure();
      const descriptor = transferSourceDescriptor(target, name);
      // The intrinsic returns an owned normalized PropertyDescriptor record.
      // Harvest its known metadata even if reflection reentered close, before
      // checking continuation; never inspect a Storage instance this way.
      if (descriptor) {
        if (Object.hasOwn(descriptor, "value")) remember(descriptor.value);
        if (Object.hasOwn(descriptor, "get")) remember(descriptor.get);
        if (Object.hasOwn(descriptor, "set")) remember(descriptor.set);
      }
      ensure();
      if (!descriptor) stop("unavailable", true);
      if (getter ? !Object.hasOwn(descriptor, "get") : !Object.hasOwn(descriptor, "value")) stop("unavailable", true);
      const value: unknown = getter ? descriptor.get : descriptor.value;
      ensure(); return value;
    }
    function fn(value: unknown): TransferStorageFunction {
      if (typeof value !== "function") stop("unavailable", true);
      return value as TransferStorageFunction;
    }
    function metadata(): TransferSourceMetadata {
      const constructor = fn(read(() => globalThis.Storage));
      const prototype = field(constructor, "prototype");
      if (!prototype || typeof prototype !== "object") stop("unavailable", true);
      const length = fn(field(prototype, "length", true));
      // A previous genuine checker cannot be replaced by changed ambient metadata.
      if (checker && checker !== length) stop("unavailable", true);
      checker = length;
      const key = fn(field(prototype, "key")), get = fn(field(prototype, "getItem"));
      return { constructor, prototype, length, key, get };
    }
    function storage(): TransferSourceBinding {
      const meta = metadata();
      if (binding && (meta.constructor !== binding.constructor || meta.prototype !== binding.prototype || meta.length !== binding.length || meta.key !== binding.key || meta.get !== binding.get)) stop("unavailable", true);
      const receiver: unknown = read(() => localStorage);
      if (!receiver || typeof receiver !== "object" || binding && receiver !== binding.receiver) stop("unavailable", true);
      const size: unknown = read(() => transferSourceApply(meta.length, receiver, []));
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) stop("unavailable", true);
      inert.add(receiver);
      if (size > TRANSFER_LIMITS.listed) stop("source_unsupported");
      binding ??= { ...meta, receiver };
      return binding;
    }
    function size(port: TransferSourceBinding): number {
      const value: unknown = read(() => transferSourceApply(port.length, port.receiver, []));
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) stop("unavailable", true);
      if (value > TRANSFER_LIMITS.listed) stop("source_unsupported"); return value;
    }
    function pass(port: TransferSourceBinding): string[] {
      const length = size(port), names: string[] = [], seen = new Set<string>();
      for (let index = 0; index < length; index++) {
        const name: unknown = read(() => transferSourceApply(port.key, port.receiver, [index]));
        if (name === null) stop("source_changed");
        if (typeof name !== "string") stop("unavailable", true);
        if (name.length > TRANSFER_LIMITS.key) stop("source_unsupported");
        if (seen.has(name)) stop("source_changed"); seen.add(name); names.push(name);
      }
      if (size(port) !== length) stop("source_changed");
      return names.sort();
    }
    function equalNames(a: readonly string[], b: readonly string[]) { return a.length === b.length && a.every((name, i) => name === b[i]); }
    function inventory(port: TransferSourceBinding): string[] {
      const first = pass(port), second = pass(port);
      if (!equalNames(first, second)) stop("source_changed"); return first;
    }
    function get(port: TransferSourceBinding, key: string): string | null {
      const value: unknown = read(() => transferSourceApply(port.get, port.receiver, [key]));
      if (value !== null && typeof value !== "string") stop("unavailable", true);
      return value;
    }
    function controlsAbsent(port: TransferSourceBinding) {
      for (const key of TRANSFER_CONTROL_KEYS) if (get(port, key) !== null) stop(prior ? "source_changed" : "source_unhealthy");
    }
    function values(port: TransferSourceBinding, plan: ReadPlan, expected: ReadonlyMap<string, string | null> | null): Map<string, string | null> | ReadonlyMap<string, string | null> {
      const found = expected ?? new Map<string, string | null>(), listed = new Set(plan.rawReads);
      let total = 0;
      for (const key of expectedSlots(plan.profiles, plan.dynamicIdentity)) {
        const value = get(port, key);
        if ((value !== null) !== listed.has(key) || expected && value !== expected.get(key)) stop("source_changed");
        if (value !== null) {
          const cap = key === TRANSFER_LEGACY_KEY ? TRANSFER_LIMITS.legacy : key.startsWith(TRANSFER_PROFILE_PREFIX) ? TRANSFER_LIMITS.sporting : TRANSFER_LIMITS.identity;
          if (value.length > cap || value.length > TRANSFER_LIMITS.raw - total) stop("source_unsupported"); total += value.length;
        }
        if (!expected) (found as Map<string, string | null>).set(key, value);
      }
      return found;
    }
    let result: TransferSourceCapture | TransferSourceFence;
    try {
      const port = storage(), names = inventory(port);
      if (prior && !equalNames(names, prior.names)) stop("source_changed");
      const leaves = names.map(name => transferSourcePrimitiveJson(name));
      if (leaves.some(value => typeof value !== "string")) stop("unavailable", true);
      const planned = planInstallationTransferInventoryV2('{"schemaVersion":1,"keys":[' + leaves.join(",") + "]}");
      if (!planned.ok) stop("source_unsupported");
      const plan = planned.value;
      if (plan.controlHealthKeys.length) stop(prior ? "source_changed" : "source_unhealthy");
      controlsAbsent(port);
      const found = values(port, plan, prior?.values ?? null);
      controlsAbsent(port);
      if (!equalNames(names, inventory(port))) stop("source_changed");
      controlsAbsent(port);
      values(port, plan, found);
      controlsAbsent(port);
      if (!equalNames(names, inventory(port))) stop("source_changed");
      // Re-observe ambient identities only; never acquire/rebind another source.
      // Captured platform reads cannot silently survive replacement mid-call.
      const final = metadata();
      if (final.constructor !== port.constructor || final.prototype !== port.prototype || final.length !== port.length || final.key !== port.key || final.get !== port.get || read(() => localStorage) !== port.receiver) stop("unavailable", true);
      ensure();
      if (kind === "capture") {
        const token = Object.freeze(Object.create(null)) as object;
        observation = { owner: source, proof: token, names: Object.freeze(names), values: found };
        proofs.set(token, observation);
        result = transferSourceSeal({ ok: true as const, kind: "source_observation" as const, proof: token,
          counts: transferSourceSeal({ profiles: plan.profiles.length, slots: found.size, present: plan.rawReads.length, excluded: Object.values(plan.exclusions).reduce((a, b) => a + b, 0) }),
          mayIssue: false as const, mayPublish: false as const, mayMount: false as const });
      } else result = "unchanged";
    } catch {
      // Positive contradictions were recorded before throwing; never inspect a reason.
      op.revoked = true; drop();
      if (op.failure === "unavailable") poisoned = true;
      result = kind === "capture" ? transferSourceFailure(closed ? "closed" : op.failure)
        : closed ? "closed" : op.failure === "source_changed" ? "changed" : "unavailable";
    }
    if (op.revoked || closed) {
      for (const root of op.roots) op.drains.push(drainObservedPlatformWork(root, value =>
        value === closeWork || value === op.work || value === op.done || value === op.phase || inertStorage(value)));
    }
    // Observer registration itself may reenter close. Its complete list precedes
    // phase settlement, so close never snapshots a partially registered list.
    op.endPhase();
    void Promise.all(op.drains).then(() => {
      if (operation === op) operation = null;
      if (closed) result = kind === "capture" ? transferSourceFailure("closed") : "closed";
      finishWork(result);
    });
    return work;
  }
  const source = transferSourceSeal({
    capture: () => run("capture") as Promise<TransferSourceCapture>,
    fence: (proof: unknown) => run("fence", proof) as Promise<TransferSourceFence>,
    close,
  });
  return source;
}
