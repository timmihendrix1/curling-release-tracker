// TrainingPlansRepository — owns curling-release-tracker-training-plans. Wraps
// migrateTrainingPlans (migration.ts) unchanged. See
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.4 and ADR-0013. Never touches
// Session.planExecution, which stays inside SessionRepository/sessionMigration.ts
// unchanged (ADR-0012 Decision 4).
//
// Today's code always calls migrateTrainingPlans(raw) even when raw is null (absence or
// unparseable JSON), relying on the migration function's own internal isRecord check to
// produce []. This repository bypasses that call entirely on genuine absence instead —
// for consistency with every other repository's "absent" handling — producing the
// identical value ([]), so no observable behavior changes.
import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "../persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "../persistence/types";
import {
  serializeTrainingPlansState,
  TRAINING_PLANS_SCHEMA_VERSION,
  TRAINING_PLANS_STORAGE_KEY,
  type TrainingPlansPersistedState,
} from "./persistence";
import { migrateTrainingPlans } from "./migration";
import type { TrainingPlan } from "../../types";

export interface TrainingPlansRepository {
  loadPlans(): Promise<DomainLoadResult<TrainingPlan[]>>;
  savePlans(plans: TrainingPlan[]): Promise<PersistenceWriteResult>;
}

export function createTrainingPlansRepository(
  adapter: StorageAdapter = localStorageAdapter
): TrainingPlansRepository {
  return {
    async loadPlans(): Promise<DomainLoadResult<TrainingPlan[]>> {
      const result = await adapter.get(TRAINING_PLANS_STORAGE_KEY);
      if (result.status === "read_failed") {
        return loadFailed<TrainingPlan[]>([], result.error);
      }
      if (result.value === null) {
        return loadedAbsent<TrainingPlan[]>();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.value);
      } catch {
        return loadedAbsent<TrainingPlan[]>();
      }
      return loadedValue(migrateTrainingPlans(parsed).plans);
    },

    async savePlans(plans: TrainingPlan[]): Promise<PersistenceWriteResult> {
      const state: TrainingPlansPersistedState = {
        schemaVersion: TRAINING_PLANS_SCHEMA_VERSION,
        plans,
      };
      return adapter.set(TRAINING_PLANS_STORAGE_KEY, serializeTrainingPlansState(state));
    },
  };
}

export const trainingPlansRepository: TrainingPlansRepository = createTrainingPlansRepository();
