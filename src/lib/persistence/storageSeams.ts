// The sporting-side storage seams, named once — Stage M3b3
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3, ADR-0049 decision 4).
//
// The design's central warning about this stage is that "swapping one default
// does not reach every consumer", and that **five** distinct seams exist. Three
// of them are sporting-side and are gathered here so a component composes ONE
// object instead of making three independent choices:
//
//   1. the seven Profile-scoped sporting repositories;
//   2. the SEPARATE Profile-scoped sync-state/outbox adapter, which
//      `ProfileScopedSportingPersistence` builds with its own
//      `createProfileScopedSportingStorageAdapter(profileId)` call and no
//      adapter argument — missing it would leave the outbox behind while
//      everything else moved, and outbox entries are completed work the cloud
//      has never seen;
//   3. the legacy-retirement call, which the same component makes with no
//      argument at all.
//
// The remaining two seams — the five identity repositories and the provider
// session — are not sporting-scoped and live in `identityRepositorySet.ts` and
// `../supabase/providerCredentialStorage.ts`.
//
// **The Web default is this module's other job.** `WEB_DEFAULT_SPORTING_SEAMS`
// reproduces exactly what the three call sites did before this stage, so the Web
// build keeps `localStorageAdapter` byte-for-byte and the consuming component
// needs no `if (native)` branch. Behaviour is unchanged where nothing is
// injected.
import { localStorageAdapter } from "./localStorageAdapter";
import {
  createProfileScopedSportingRepositories,
  createProfileScopedSportingStorageAdapter,
  retireLegacyUnscopedSportingData,
  type LegacySportingRetirementResult,
  type SportingRepositories,
} from "./profileScopedSportingPersistence";
import type { RemovableStorageAdapter, StorageAdapter } from "./types";

/**
 * Which store the seams address. Recorded rather than inferred: a reviewer and a
 * test can both assert which one a mounted tree actually got, instead of reading
 * it back out of a key name.
 */
export type StorageSelection = "web_local" | "native_sqlite";

export type SportingStorageSeams = Readonly<{
  selection: StorageSelection;
  /** Seam 1. */
  createSportingRepositories(profileId: string): SportingRepositories;
  /** Seam 2 — the sync-state/outbox adapter, deliberately separate. */
  createSportingSyncStateAdapter(profileId: string): StorageAdapter;
  /**
   * Seam 3.
   *
   * It targets the store that is AUTHORITATIVE for this composition, which is
   * the only target that is correct after a cutover: the retirement marker
   * (`curling.sporting.legacy-unscoped-retired.v1`) is one of the keys the
   * future migration copies, so after activation it lives in the target, and
   * pointing the call at the old source would make it re-run forever.
   *
   * Two things this is NOT, and must not become:
   *
   *   - It is **not** source retirement. Removing the ten bare legacy keys from
   *     the OLD store is the migration stage's `sourceRetirement` phase
   *     (Stage M3b0 §5.5), which re-verifies a fingerprint before deleting
   *     anything. This call is content-blind disposal in the authoritative
   *     store, exactly as ADR-0026 defines it, and removing an already-absent
   *     key stays idempotent.
   *   - It is **not** allowed to run before activation. Readiness gating is what
   *     guarantees that: no native composition becomes ready without a valid
   *     activation verdict, so in this stage nothing native retires anything.
   */
  retireLegacyUnscopedData(): Promise<LegacySportingRetirementResult>;
}>;

/** Exactly the pre-M3b3 behaviour of the three call sites. */
export const WEB_DEFAULT_SPORTING_SEAMS: SportingStorageSeams = Object.freeze({
  selection: "web_local" as const,
  createSportingRepositories(profileId: string): SportingRepositories {
    return createProfileScopedSportingRepositories(profileId);
  },
  createSportingSyncStateAdapter(profileId: string): StorageAdapter {
    return createProfileScopedSportingStorageAdapter(profileId);
  },
  retireLegacyUnscopedData(): Promise<LegacySportingRetirementResult> {
    return retireLegacyUnscopedSportingData();
  },
});

/**
 * Binds all three seams to one adapter.
 *
 * **Profile namespaces stay immutable.** Every call derives its physical key
 * from the `profileId` it was given, and neither this function nor the adapters
 * it wraps hold a mutable "current Profile" pointer — so a delayed write started
 * for Profile A keeps A's key after the tree has switched to B
 * (ADR-0049 decision 6). The native adapter must never introduce one.
 */
export function createSportingStorageSeams(
  selection: StorageSelection,
  adapter: RemovableStorageAdapter
): SportingStorageSeams {
  return Object.freeze({
    selection,
    createSportingRepositories(profileId: string): SportingRepositories {
      return createProfileScopedSportingRepositories(profileId, adapter);
    },
    createSportingSyncStateAdapter(profileId: string): StorageAdapter {
      return createProfileScopedSportingStorageAdapter(profileId, adapter);
    },
    retireLegacyUnscopedData(): Promise<LegacySportingRetirementResult> {
      return retireLegacyUnscopedSportingData(adapter);
    },
  });
}

/** Named so a test can assert the Web default really is the localStorage
 * adapter rather than merely behaving like one today. */
export const WEB_DEFAULT_STORAGE_ADAPTER: RemovableStorageAdapter = localStorageAdapter;
