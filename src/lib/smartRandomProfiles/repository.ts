// SmartRandomProfilesRepository — owns curling-release-tracker-smart-random-profiles.
// Wraps migrateSmartRandomProfilesState (migration.ts) unchanged. See
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.6 and ADR-0013. Same "absent bypasses migration"
// posture as AccuracyToleranceProfilesRepository/TrainingPlansRepository — no observable
// behavior change, since migrateSmartRandomProfilesState(null) already returns the
// identical empty state.
import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "../persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "../persistence/types";
import {
  createEmptySmartRandomProfilesState,
  serializeSmartRandomProfilesState,
  SMART_RANDOM_PROFILES_STORAGE_KEY,
  type SmartRandomProfilesState,
} from "./persistence";
import { migrateSmartRandomProfilesState } from "./migration";

export interface SmartRandomProfilesRepository {
  loadState(): Promise<DomainLoadResult<SmartRandomProfilesState>>;
  saveState(state: SmartRandomProfilesState): Promise<PersistenceWriteResult>;
}

export function createSmartRandomProfilesRepository(
  adapter: StorageAdapter = localStorageAdapter
): SmartRandomProfilesRepository {
  return {
    async loadState(): Promise<DomainLoadResult<SmartRandomProfilesState>> {
      const result = await adapter.get(SMART_RANDOM_PROFILES_STORAGE_KEY);
      if (result.status === "read_failed") {
        return loadFailed<SmartRandomProfilesState>(
          createEmptySmartRandomProfilesState(),
          result.error
        );
      }
      if (result.value === null) {
        return loadedAbsent<SmartRandomProfilesState>();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.value);
      } catch {
        return loadedAbsent<SmartRandomProfilesState>();
      }
      return loadedValue(migrateSmartRandomProfilesState(parsed));
    },

    async saveState(state: SmartRandomProfilesState): Promise<PersistenceWriteResult> {
      return adapter.set(
        SMART_RANDOM_PROFILES_STORAGE_KEY,
        serializeSmartRandomProfilesState(state)
      );
    },
  };
}

export const smartRandomProfilesRepository: SmartRandomProfilesRepository =
  createSmartRandomProfilesRepository();
