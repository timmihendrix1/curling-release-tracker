// AssessmentRepository — owns curling-release-tracker-assessment-data. Wraps
// migrateAssessmentPersistedState (migration.ts) unchanged. See
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.3 and ADR-0013.
//
// A stored-but-unparseable string is folded into "absent" here (not "value"), matching
// TrackerApp.tsx's existing `rawAssessment ? migrate(rawAssessment) :
// createEmptyAssessmentPersistedState()` shortcut exactly — both "nothing stored" and
// "couldn't parse" set `rawAssessment = null` today and take the same
// non-migration-calling path.
import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "../persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "../persistence/types";
import {
  ASSESSMENT_STORAGE_KEY,
  createEmptyAssessmentPersistedState,
  serializeAssessmentPersistedState,
  type AssessmentPersistedState,
} from "./persistence";
import { migrateAssessmentPersistedState } from "./migration";

/**
 * Extends the plain migrated state with the one additional signal `TrackerApp.tsx`
 * currently derives itself by comparing raw vs. migrated data, to surface the existing
 * user-visible quarantine notice (see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 24).
 */
export type AssessmentLoadResult = {
  state: AssessmentPersistedState;
  /** True when a raw `currentRun` existed in storage but failed validation and was
   * quarantined during migration. */
  currentRunQuarantined: boolean;
};

export interface AssessmentRepository {
  loadState(): Promise<DomainLoadResult<AssessmentLoadResult>>;
  saveState(state: AssessmentPersistedState): Promise<PersistenceWriteResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function computeCurrentRunQuarantined(
  raw: Record<string, unknown>,
  migrated: AssessmentPersistedState
): boolean {
  const rawHadCurrentRun = "currentRun" in raw && raw.currentRun !== undefined;
  return rawHadCurrentRun && !migrated.currentRun;
}

export function createAssessmentRepository(
  adapter: StorageAdapter = localStorageAdapter
): AssessmentRepository {
  return {
    async loadState(): Promise<DomainLoadResult<AssessmentLoadResult>> {
      const result = await adapter.get(ASSESSMENT_STORAGE_KEY);
      const emptyFallback: AssessmentLoadResult = {
        state: createEmptyAssessmentPersistedState(),
        currentRunQuarantined: false,
      };
      if (result.status === "read_failed") {
        return loadFailed(emptyFallback, result.error);
      }
      if (result.value === null) {
        return loadedAbsent<AssessmentLoadResult>();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.value);
      } catch {
        return loadedAbsent<AssessmentLoadResult>();
      }
      const state = migrateAssessmentPersistedState(parsed);
      const currentRunQuarantined = isRecord(parsed)
        ? computeCurrentRunQuarantined(parsed, state)
        : false;
      return loadedValue({ state, currentRunQuarantined });
    },

    async saveState(state: AssessmentPersistedState): Promise<PersistenceWriteResult> {
      return adapter.set(ASSESSMENT_STORAGE_KEY, serializeAssessmentPersistedState(state));
    },
  };
}

export const assessmentRepository: AssessmentRepository = createAssessmentRepository();
