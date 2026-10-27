// Native-migration key eligibility — Stage M3b4a (pure decision layer).
//
// Classifies a WebView `localStorage` key by SHAPE ONLY, exactly as
// docs/MOBILE_APP_MIGRATION.md Stage M3b0 §1 specifies: no value is read, parsed
// or inspected here, and no user record is consulted.
//
// ## Reused where pure, mirrored where importing would pull in storage
//
// The identity keys declared in pure modules — the access barrier, the trusted
// device, the interactive attempt — and the audited barrier-resolution membership
// predicate `isResolutionStorageKey` are IMPORTED from their declaring modules,
// whose import chains contain no storage (asserted by
// `__tests__/architectureBoundary.test.ts`). The sporting allow-list, the
// pending-intent and intent-cleanup keys and the legacy marker are declared next to
// repositories that construct `localStorage`-backed singletons or default to
// `localStorageAdapter`; importing those would pull storage into a decision core
// that must stay side-effect-free. Those literals are therefore restated here, and
// `__tests__/nativeMigrationEligibility.test.ts` pins every one of them against the
// REAL exported constants, so drift fails a test instead of silently changing
// eligibility.
//
// Nothing here executes a migration. No production module imports this file in
// M3b4a (asserted by `__tests__/architectureBoundary.test.ts`).
import { IDENTITY_BARRIER_STORAGE_KEY } from "../identity/identityBarrier";
import { DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX, isAccountDeletionGuardStorageKey, isAccountDeletionGuardResolutionStorageKey } from "../identity/accountDeletionGuard";
import { isResolutionStorageKey } from "../identity/identityBarrierResolution";
import { INTERACTIVE_ATTEMPT_STORAGE_KEY } from "../identity/interactiveAttempt";
import { TRUSTED_DEVICE_STORAGE_KEY } from "../identity/trustedDevice";
import { isCanonicalUuid } from "../uuid";

/** `curling.sporting.profile.v1.<canonical-UUID>.<allow-listed key>` (§1). */
export const NATIVE_MIGRATION_PROFILE_NAMESPACE_PREFIX = "curling.sporting.profile.v1.";

/**
 * The closed Profile-scoped sporting allow-list: the 10 `SPORTING_STORAGE_KEYS`,
 * then the assessment draft, the assessment history and the sync key (§1).
 */
export const NATIVE_MIGRATION_PROFILE_SPORTING_KEYS: readonly string[] = Object.freeze([
  "curling-release-tracker-current-session",
  "curling-release-tracker-session-history",
  "curling-release-tracker-history-filters",
  "curling-release-tracker-assessment-data",
  "curling-release-tracker-training-plans",
  "curling-release-tracker-accuracy-tolerance-profiles",
  "curling-release-tracker-smart-random-profiles",
  "curling-release-tracker-assessment-show-introduction",
  "curling-release-tracker-assessment-last-threshold-preset",
  "curling-release-tracker-assessment-last-custom-threshold",
  "curling-release-tracker-assessment-draft",
  "curling-release-tracker-assessment-history",
  "curling-release-tracker-cloud-sporting-sync",
]);

/** The first ten allow-listed keys, BARE: the retired legacy unscoped keys (ADR-0026). Never adopted. */
export const NATIVE_MIGRATION_RETIRED_UNSCOPED_SPORTING_KEYS: readonly string[] = Object.freeze(
  NATIVE_MIGRATION_PROFILE_SPORTING_KEYS.slice(0, 10)
);

/** The five fixed, device-global identity-continuity keys (§1). */
export const NATIVE_MIGRATION_IDENTITY_FIXED_KEYS: readonly string[] = Object.freeze([
  TRUSTED_DEVICE_STORAGE_KEY,
  IDENTITY_BARRIER_STORAGE_KEY,
  INTERACTIVE_ATTEMPT_STORAGE_KEY,
  // Mirrored: their declaring module (`pendingIntentRepository.ts`) defaults to
  // `localStorageAdapter`. Pinned by the eligibility test.
  "curling.identity.pendingIntent.v1",
  "curling.identity.intentCleanup.v1",
]);

/** The legacy-retirement marker — migrated itself so retirement is not re-run (§1). */
export const NATIVE_MIGRATION_LEGACY_RETIREMENT_MARKER_KEY =
  "curling.sporting.legacy-unscoped-retired.v1";

/** The disposable diagram cache keeps its `localStorage` path and is never migrated (§1). */
export const NATIVE_MIGRATION_DIAGRAM_CACHE_PREFIX =
  "curling-performance-public-exercise-diagram-v1.";

/**
 * The source marker (I-3): one fixed key in a migration-owned namespace, outside
 * every eligible family. The specification fixes its properties, not its name;
 * this is the name M3b4a defines, and M3b4b must use it.
 */
export const NATIVE_MIGRATION_SOURCE_MARKER_KEY = "curling.nativeMigration.sourceMarker.v1";

/**
 * The two reserved TARGET locations (I-2, I-13). They are disjoint from every
 * eligible key, no repository reads them, and target row enumeration excludes
 * them. The names are M3b4a's definition for M3b4b.
 */
export const NATIVE_MIGRATION_ACTIVATION_RECORD_KEY = "curling.nativeMigration.activationRecord.v1";
export const NATIVE_MIGRATION_FAULT_LATCH_KEY = "curling.nativeMigration.faultLatch.v1";

export type EligibleKeyFamily =
  | "profile_sporting"
  | "identity_fixed"
  | "identity_barrier_resolution"
  | "identity_deletion_guard"
  | "identity_deletion_resolution"
  | "legacy_retirement_marker";

export type ExcludedKeyReason =
  /** A bare legacy sporting key: retired content-blind, never adopted (ADR-0026). */
  | "retired_legacy_unscoped"
  /** The disposable diagram cache (§1). */
  | "diagram_cache"
  /** A provider-SDK credential key. Credentials are not domain bytes; their transfer is a separate protocol (§4). */
  | "provider_credential"
  /** The migration's own source marker. */
  | "migration_source_marker"
  /** A reserved target location — never a source key. */
  | "migration_reserved_target_key"
  /** Under the Profile namespace, but not `<canonical UUID>.<allow-listed key>`. */
  | "profile_namespace_unrecognised"
  /** Unsupported member of an owned denial family: blocks, never silently excluded. */
  | "identity_control_unrecognised"
  /** No recognised shape: not imported, not deleted, recorded. */
  | "unknown";

export type MigrationKeyClassification =
  | { readonly eligible: true; readonly family: EligibleKeyFamily; readonly profileId?: string }
  | { readonly eligible: false; readonly reason: ExcludedKeyReason };

const PROFILE_KEY_SET: ReadonlySet<string> = new Set(NATIVE_MIGRATION_PROFILE_SPORTING_KEYS);
const IDENTITY_FIXED_SET: ReadonlySet<string> = new Set(NATIVE_MIGRATION_IDENTITY_FIXED_KEYS);
const RETIRED_SET: ReadonlySet<string> = new Set(NATIVE_MIGRATION_RETIRED_UNSCOPED_SPORTING_KEYS);
const UUID_LENGTH = 36;


function isProviderCredentialKey(key: string): boolean {
  // The SDK's `<storageKey>` and its `-code-verifier`, `-flows-…`, `-flow-<id>-…`
  // and `-user` siblings all share the `sb-<label>-auth-token` stem (§4).
  return /^sb-[^.]+-auth-token(?:$|-)/.test(key);
}

export function isUnsupportedMigrationIdentityControlKey(key: unknown): boolean {
  return typeof key === "string" && (
    (key.startsWith(DELETION_GUARD_PREFIX) && !isAccountDeletionGuardStorageKey(key)) ||
    (key.startsWith(DELETION_GUARD_RESOLUTION_PREFIX) && !isAccountDeletionGuardResolutionStorageKey(key))
  );
}

/** Classifies one source key by shape. Non-string input is never eligible. */
export function classifyMigrationSourceKey(key: unknown): MigrationKeyClassification {
  if (typeof key !== "string") return { eligible: false, reason: "unknown" };
  if (IDENTITY_FIXED_SET.has(key)) return { eligible: true, family: "identity_fixed" };
  if (isAccountDeletionGuardStorageKey(key)) return { eligible: true, family: "identity_deletion_guard" };
  if (isAccountDeletionGuardResolutionStorageKey(key)) return { eligible: true, family: "identity_deletion_resolution" };
  if (isUnsupportedMigrationIdentityControlKey(key)) return { eligible: false, reason: "identity_control_unrecognised" };
  // The dynamic family is admitted by the audited membership test, never a fixed list (§1).
  if (isResolutionStorageKey(key)) {
    return { eligible: true, family: "identity_barrier_resolution" };
  }
  if (key === NATIVE_MIGRATION_LEGACY_RETIREMENT_MARKER_KEY) {
    return { eligible: true, family: "legacy_retirement_marker" };
  }
  if (key.startsWith(NATIVE_MIGRATION_PROFILE_NAMESPACE_PREFIX)) {
    const rest = key.slice(NATIVE_MIGRATION_PROFILE_NAMESPACE_PREFIX.length);
    const profileId = rest.slice(0, UUID_LENGTH);
    const suffix = rest.slice(UUID_LENGTH + 1);
    if (rest.charAt(UUID_LENGTH) === "." && isCanonicalUuid(profileId) && PROFILE_KEY_SET.has(suffix)) {
      return { eligible: true, family: "profile_sporting", profileId };
    }
    return { eligible: false, reason: "profile_namespace_unrecognised" };
  }
  if (key === NATIVE_MIGRATION_SOURCE_MARKER_KEY) {
    return { eligible: false, reason: "migration_source_marker" };
  }
  if (key === NATIVE_MIGRATION_ACTIVATION_RECORD_KEY || key === NATIVE_MIGRATION_FAULT_LATCH_KEY) {
    return { eligible: false, reason: "migration_reserved_target_key" };
  }
  if (RETIRED_SET.has(key)) return { eligible: false, reason: "retired_legacy_unscoped" };
  if (key.startsWith(NATIVE_MIGRATION_DIAGRAM_CACHE_PREFIX)) {
    return { eligible: false, reason: "diagram_cache" };
  }
  if (isProviderCredentialKey(key)) return { eligible: false, reason: "provider_credential" };
  return { eligible: false, reason: "unknown" };
}

export function isEligibleMigrationKey(key: unknown): key is string {
  return classifyMigrationSourceKey(key).eligible;
}
