// AccuracyToleranceProfilesRepository — owns
// curling-release-tracker-accuracy-tolerance-profiles. Wraps
// migrateAccuracyToleranceProfilesState (migration.ts) unchanged. See
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.5 and ADR-0013.
//
// Today's code always calls the migration function even when raw is null; this
// repository bypasses that call on genuine absence instead, producing the identical
// value, so no observable behavior changes (see TrainingPlansRepository's identical note).
import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "../persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "../persistence/types";
import {
  ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
  createEmptyAccuracyToleranceProfilesState,
  serializeAccuracyToleranceProfilesState,
  type AccuracyToleranceProfilesState,
} from "./persistence";
import { migrateAccuracyToleranceProfilesState } from "./migration";

export interface AccuracyToleranceProfilesRepository {
  loadState(): Promise<DomainLoadResult<AccuracyToleranceProfilesState>>;
  saveState(state: AccuracyToleranceProfilesState): Promise<PersistenceWriteResult>;
}

export function createAccuracyToleranceProfilesRepository(
  adapter: StorageAdapter = localStorageAdapter
): AccuracyToleranceProfilesRepository {
  return {
    async loadState(): Promise<DomainLoadResult<AccuracyToleranceProfilesState>> {
      const result = await adapter.get(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY);
      if (result.status === "read_failed") {
        return loadFailed<AccuracyToleranceProfilesState>(
          createEmptyAccuracyToleranceProfilesState(),
          result.error
        );
      }
      if (result.value === null) {
        return loadedAbsent<AccuracyToleranceProfilesState>();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.value);
      } catch {
        return loadedAbsent<AccuracyToleranceProfilesState>();
      }
      return loadedValue(migrateAccuracyToleranceProfilesState(parsed));
    },

    async saveState(state: AccuracyToleranceProfilesState): Promise<PersistenceWriteResult> {
      return adapter.set(
        ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
        serializeAccuracyToleranceProfilesState(state)
      );
    },
  };
}

export const accuracyToleranceProfilesRepository: AccuracyToleranceProfilesRepository =
  createAccuracyToleranceProfilesRepository();
