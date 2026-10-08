// TrainingPlansRepository — owns curling-release-tracker-training-plans. Wraps
// migrateTrainingPlans (migration.ts) unchanged. See
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.4 and ADR-0013. Never touches
// Session.planExecution, which stays inside SessionRepository/sessionMigration.ts
// unchanged (ADR-0012 Decision 4).
//
// Three outcomes are kept strictly distinct (ADR-0051):
//   - ABSENT: no stored key at all. The application starts from an empty library and
//     may write to it.
//   - UNREADABLE: a key exists but this build cannot read it in full — unparseable
//     JSON, an unknown schema version, or a malformed envelope. Reported as a
//     protected read failure so the stored bytes survive; migrateTrainingPlans'
//     quarantine repair (unknown version becomes [], a broken plan is dropped) must
//     never reach the application here, because its ordinary save effect writes the
//     loaded value straight back.
//   - VALUE: readable, migrated, and safe to write back.
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
import { validateTrainingPlansMeasurementState } from "../measurement/validation";
import type { TrainingPlan } from "../../types";

const INVALID_PLAN_MEASUREMENT_MESSAGE =
  "Stored Training Plan contains invalid measurement configuration.";
const UNREADABLE_PLAN_LIBRARY_MESSAGE =
  "Stored Training Plans are in a format this version cannot read.";

function protectedRead(message: string): DomainLoadResult<TrainingPlan[]> {
  return loadFailed<TrainingPlan[]>([], { kind: "unknown", message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the stored library's ENVELOPE is one this build can read in full: a known
 * schema version, and a real list of plan objects each carrying the identity and step
 * list the rest of the pipeline assumes.
 *
 * Anything else is protected rather than migrated. migrateTrainingPlans is a
 * quarantine-style repair — an unknown version becomes an empty library and a broken
 * plan is dropped — which is safe only when the result is never written back. It is
 * written back, by the application's ordinary save effect, so quarantine here would be
 * permanent loss of plans this build simply cannot represent.
 */
/**
 * Whether migration would preserve every plan and every step IDENTITY it was given.
 *
 * This is the lossless condition, and it is deliberately expressed as "what does
 * migration actually do to this input" rather than as a second copy of migration's
 * rules, which would drift. `migrateTrainingPlans` is a quarantine-style repair: a
 * step with an unknown `type`, or a schema-2 step whose Exercise Version snapshot
 * cannot be resolved, makes `migrateStep` return undefined and the WHOLE PLAN is
 * dropped; a step with no `id` is given a freshly minted one. Either outcome is then
 * written straight back by the application's save effect.
 *
 * It deliberately checks identity and membership only, so the established distinction
 * survives: a plan whose step carries a semantically invalid CONFIGURATION (say
 * Hog-Hog with Smart Random) still migrates with the same plan and step ids, stays
 * readable, and is simply flagged unexecutable for the athlete to edit. Legitimate
 * schema-1 migration — which substitutes the curated Release Time snapshot — also
 * preserves every identity, so it keeps working untouched.
 */
function trainingPlansMigrateLosslessly(value: unknown): boolean {
  if (!isRecord(value) || !Array.isArray(value.plans)) return false;

  let migrated;
  try {
    migrated = migrateTrainingPlans(value);
  } catch {
    return false;
  }

  if (migrated.plans.length !== value.plans.length) return false;

  return value.plans.every((candidate, index) => {
    if (!isRecord(candidate)) return false;
    const after = migrated.plans[index];
    if (!after || after.id !== candidate.id) return false;

    const storedSteps = candidate.steps;
    if (!Array.isArray(storedSteps)) return false;
    if (after.steps.length !== storedSteps.length) return false;

    return storedSteps.every((step, stepIndex) => {
      if (!isRecord(step)) return false;
      return after.steps[stepIndex]?.id === step.id;
    });
  });
}

function isReadableTrainingPlansEnvelope(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const version = value.schemaVersion;
  if (version !== 1 && version !== TRAINING_PLANS_SCHEMA_VERSION) return false;

  if (!Array.isArray(value.plans)) return false;

  const ids = new Set<string>();
  for (const candidate of value.plans) {
    if (!isRecord(candidate)) return false;
    if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
    if (typeof candidate.name !== "string") return false;
    if (!Array.isArray(candidate.steps)) return false;
    if (candidate.steps.some((step) => !isRecord(step))) return false;
    if (ids.has(candidate.id)) return false;
    ids.add(candidate.id);
  }

  // Containers and plan-level fields are sound; now require that reading the library
  // back does not silently drop a plan or renumber a step.
  return trainingPlansMigrateLosslessly(value);
}

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
        // Unparseable is UNREADABLE, not absent. Reporting absence hands the
        // application an empty but writable library that its save effect writes
        // straight back, replacing bytes that might still be recoverable (a
        // truncated write, a partially synced file) with an empty library.
        return protectedRead(UNREADABLE_PLAN_LIBRARY_MESSAGE);
      }
      // The envelope itself is part of the structure. A supported schemaVersion with
      // a non-array `plans` is not an empty library — it is an unreadable one, and
      // migrateTrainingPlans' quarantine would hand back `[]` for it.
      if (!isReadableTrainingPlansEnvelope(parsed)) {
        return protectedRead(UNREADABLE_PLAN_LIBRARY_MESSAGE);
      }
      // Malformed measurement-aware step configuration is a PROTECTED failure, not
      // something migration may repair: its legacy defaults would turn an invalid
      // speed step into executable Back-Hog / 3.75s time training the athlete never
      // configured. Failing here leaves the stored bytes untouched for recovery.
      if (!validateTrainingPlansMeasurementState(parsed).valid) {
        return loadFailed<TrainingPlan[]>([], {
          kind: "unknown",
          message: INVALID_PLAN_MEASUREMENT_MESSAGE,
        });
      }
      return loadedValue(migrateTrainingPlans(parsed).plans);
    },

    async savePlans(plans: TrainingPlan[]): Promise<PersistenceWriteResult> {
      const state: TrainingPlansPersistedState = {
        schemaVersion: TRAINING_PLANS_SCHEMA_VERSION,
        plans,
      };
      // A writer must never store what this same implementation would refuse to read.
      if (!isReadableTrainingPlansEnvelope(state)) {
        return {
          ok: false,
          error: { kind: "unknown", message: UNREADABLE_PLAN_LIBRARY_MESSAGE },
        };
      }
      if (!validateTrainingPlansMeasurementState(state).valid) {
        return {
          ok: false,
          error: { kind: "unknown", message: INVALID_PLAN_MEASUREMENT_MESSAGE },
        };
      }
      return adapter.set(TRAINING_PLANS_STORAGE_KEY, serializeTrainingPlansState(state));
    },
  };
}

export const trainingPlansRepository: TrainingPlansRepository = createTrainingPlansRepository();
