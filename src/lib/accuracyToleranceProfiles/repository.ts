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
import {
  accuracyToleranceProfilesStateIsWritable,
  storedAccuracyToleranceProfilesAreReadable,
} from "./storedStateValidation";

const UNREADABLE_MESSAGE =
  "Stored tolerance templates are in a format this version cannot read.";
const INVALID_WRITE_MESSAGE =
  "Tolerance templates must each declare a known quantity and a valid per-side tolerance.";

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
        // Unparseable is unreadable, NOT absent: reporting absence would hand the
        // application an empty writable state that its save effect writes straight
        // back over the original bytes.
        return loadFailed<AccuracyToleranceProfilesState>(
          createEmptyAccuracyToleranceProfilesState(),
          { kind: "unknown", message: UNREADABLE_MESSAGE }
        );
      }
      // An unsupported schema version, or a template whose unit this build does not
      // know, is PROTECTED rather than silently emptied or shortened — migration's
      // quarantine would otherwise become permanent data loss on the next save.
      if (!storedAccuracyToleranceProfilesAreReadable(parsed)) {
        return loadFailed<AccuracyToleranceProfilesState>(
          createEmptyAccuracyToleranceProfilesState(),
          { kind: "unknown", message: UNREADABLE_MESSAGE }
        );
      }
      return loadedValue(migrateAccuracyToleranceProfilesState(parsed));
    },

    async saveState(state: AccuracyToleranceProfilesState): Promise<PersistenceWriteResult> {
      // Validated BEFORE storage is touched, so an invalid state never replaces a
      // valid stored one.
      if (!accuracyToleranceProfilesStateIsWritable(state)) {
        return { ok: false, error: { kind: "unknown", message: INVALID_WRITE_MESSAGE } };
      }
      return adapter.set(
        ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
        serializeAccuracyToleranceProfilesState(state)
      );
    },
  };
}

export const accuracyToleranceProfilesRepository: AccuracyToleranceProfilesRepository =
  createAccuracyToleranceProfilesRepository();
