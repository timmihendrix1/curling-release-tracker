// Migration for the Training Plan *library* (its own localStorage key) — distinct
// from Session.planExecution's migration, which lives in sessionMigration.ts since
// it's part of Session. Field-by-field repair style, matching sessionMigration.ts's
// general approach for TrainingBlock, since a TrainingPlan's fields (name,
// description, timestamps, individual step scalars) are mostly independent rather
// than carrying the strict cross-field invariants Session.planExecution has.
//
// Important: an individual step's *sport-specific* configuration (measurement mode,
// target source, Smart Random range) is repaired only at the structural level (right
// types, valid enum values) — it is never silently coerced into a different,
// fabricated-valid combination. A step that ends up semantically invalid (e.g.
// Hog-Hog + Smart Random) stays that way and is simply flagged unexecutable by
// validation.ts; the plan itself remains visible with an Edit action, per
// docs/TRAINING_SYSTEM_AND_PLANS.md section 53.
import type {
  BlindTargetMode,
  BlockMode,
  HandleStrategy,
  MeasurementMode,
  ReleaseTimingBlockConfiguration,
  ReleaseTimingPlanStep,
  TrainingPlan,
  TrainingPlanStep,
  VariableTargetMode,
} from "../../types";
import { resolveAccuracyThresholds } from "../accuracyThresholds";
import { EXERCISE_CATALOG } from "../exercises/catalog";
import { RELEASE_TIME_VERSION_ID } from "../exercises/content";
import { exerciseRunnerKind, findExerciseVersion } from "../exercises/lookup";
import type { ExerciseVersion } from "../exercises/types";
import { DEFAULT_SMART_RANDOM_MAX, DEFAULT_SMART_RANDOM_MIN } from "../variableTargets";
import {
  createEmptyTrainingPlansPersistedState,
  TRAINING_PLANS_SCHEMA_VERSION,
  type TrainingPlansPersistedState,
} from "./persistence";

const VALID_BLOCK_MODES: BlockMode[] = ["fixed", "variable", "blind"];
const VALID_MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];
const VALID_VARIABLE_TARGET_MODES: VariableTargetMode[] = ["smart-random", "manual"];
const VALID_BLIND_TARGET_MODES: BlindTargetMode[] = ["fixed", "smart-random", "manual"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function migrateHandleStrategy(raw: unknown): HandleStrategy {
  if (isRecord(raw)) {
    if (raw.type === "fixed" && (raw.handle === "in" || raw.handle === "out")) {
      return { type: "fixed", handle: raw.handle };
    }

    if (
      raw.type === "alternating" &&
      (raw.startingHandle === "in" || raw.startingHandle === "out")
    ) {
      return { type: "alternating", startingHandle: raw.startingHandle };
    }
  }

  // Unknown/missing/malformed → the least assumption-laden default: the athlete
  // chooses freely, same as classic manual entry always has.
  return { type: "free" };
}

function migrateConfiguration(raw: unknown): ReleaseTimingBlockConfiguration {
  const source = isRecord(raw) ? raw : {};
  const mode: BlockMode = VALID_BLOCK_MODES.includes(source.mode as BlockMode)
    ? (source.mode as BlockMode)
    : "fixed";

  const rawThresholds = source.accuracyThresholds;
  const parsedThresholds =
    isRecord(rawThresholds) &&
    typeof rawThresholds.onTarget === "number" &&
    typeof rawThresholds.acceptable === "number"
      ? { onTarget: rawThresholds.onTarget, acceptable: rawThresholds.acceptable }
      : undefined;

  return {
    name: typeof source.name === "string" ? source.name : "",
    mode,
    measurementMode: VALID_MEASUREMENT_MODES.includes(
      source.measurementMode as MeasurementMode
    )
      ? (source.measurementMode as MeasurementMode)
      : "back-hog",
    targetTime: typeof source.targetTime === "number" ? source.targetTime : 3.75,
    variableTargetMode: VALID_VARIABLE_TARGET_MODES.includes(
      source.variableTargetMode as VariableTargetMode
    )
      ? (source.variableTargetMode as VariableTargetMode)
      : "smart-random",
    blindTargetMode: VALID_BLIND_TARGET_MODES.includes(
      source.blindTargetMode as BlindTargetMode
    )
      ? (source.blindTargetMode as BlindTargetMode)
      : "fixed",
    smartRandomMin:
      typeof source.smartRandomMin === "number"
        ? source.smartRandomMin
        : DEFAULT_SMART_RANDOM_MIN,
    smartRandomMax:
      typeof source.smartRandomMax === "number"
        ? source.smartRandomMax
        : DEFAULT_SMART_RANDOM_MAX,
    // Never re-derived from the app's current default preset — same rule
    // sessionMigration.ts applies to TrainingBlock.accuracyThresholds (ADR-0008).
    accuracyThresholds: resolveAccuracyThresholds(parsedThresholds),
  };
}

function cloneVersion(version: ExerciseVersion): ExerciseVersion {
  return JSON.parse(JSON.stringify(version)) as ExerciseVersion;
}

function resolveSnapshot(raw: unknown): ExerciseVersion | undefined {
  if (!isRecord(raw) || typeof raw.id !== "string") return undefined;
  const catalogVersion = findExerciseVersion(EXERCISE_CATALOG, raw.id);
  if (!catalogVersion || JSON.stringify(catalogVersion) !== JSON.stringify(raw)) {
    return undefined;
  }
  return cloneVersion(catalogVersion);
}

function currentReleaseTimeSnapshot(): ExerciseVersion {
  const version = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
  if (!version) throw new Error("The curated Release Time Exercise Version is missing.");
  return cloneVersion(version);
}

function migrateStep(raw: unknown, sourceSchemaVersion: number): TrainingPlanStep | undefined {
  const source = isRecord(raw) ? raw : {};

  if (source.type === "curated-exercise") {
    const exerciseVersionSnapshot = resolveSnapshot(source.exerciseVersionSnapshot);
    if (
      !exerciseVersionSnapshot ||
      exerciseRunnerKind(EXERCISE_CATALOG, exerciseVersionSnapshot) !==
        "exercise-execution"
    ) return undefined;

    return {
      id: typeof source.id === "string" ? source.id : crypto.randomUUID(),
      type: "curated-exercise",
      exerciseVersionSnapshot,
      completion: { type: "exercise-completion" },
    };
  }

  if (source.type !== undefined && source.type !== "release-timing") return undefined;

  const rawCompletionValue = isRecord(source.completion)
    ? source.completion.value
    : undefined;

  const completionValue =
    typeof rawCompletionValue === "number" &&
    Number.isInteger(rawCompletionValue) &&
    rawCompletionValue > 0
      ? rawCompletionValue
      : 8;

  const exerciseVersionSnapshot = sourceSchemaVersion === 1
    ? currentReleaseTimeSnapshot()
    : resolveSnapshot(source.exerciseVersionSnapshot);
  if (
    !exerciseVersionSnapshot ||
    exerciseRunnerKind(EXERCISE_CATALOG, exerciseVersionSnapshot) !==
      "release-timing"
  ) {
    return undefined;
  }

  const step: ReleaseTimingPlanStep = {
    id: typeof source.id === "string" ? source.id : crypto.randomUUID(),
    type: "release-timing",
    exerciseVersionSnapshot,
    completion: { type: "shot-count", value: completionValue },
    handleStrategy: migrateHandleStrategy(source.handleStrategy),
    configuration: migrateConfiguration(source.configuration),
  };

  return step;
}

function migratePlan(raw: unknown, sourceSchemaVersion: number): TrainingPlan | undefined {
  if (!isRecord(raw)) return undefined;

  const now = new Date().toISOString();
  const migratedSteps = Array.isArray(raw.steps)
    ? raw.steps.map((step) => migrateStep(step, sourceSchemaVersion))
    : [];
  if (migratedSteps.some((step) => step === undefined)) return undefined;
  const steps = migratedSteps as TrainingPlanStep[];

  return {
    id: typeof raw.id === "string" ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === "string" ? raw.name : "Training Plan",
    description: typeof raw.description === "string" ? raw.description : undefined,
    steps,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
    schemaVersion: TRAINING_PLANS_SCHEMA_VERSION,
  };
}

/**
 * Unknown/future schemaVersion resolves to a fresh, empty state — never
 * guess-migrated, same rule as src/lib/assessment/migration.ts. A single
 * structurally broken plan is dropped; it never invalidates the rest of the list.
 * Idempotent: migrating an already-migrated state twice is a no-op.
 */
export function migrateTrainingPlans(raw: unknown): TrainingPlansPersistedState {
  if (!isRecord(raw)) return createEmptyTrainingPlansPersistedState();
  if (raw.schemaVersion !== 1 && raw.schemaVersion !== TRAINING_PLANS_SCHEMA_VERSION) {
    return createEmptyTrainingPlansPersistedState();
  }

  const rawPlans = Array.isArray(raw.plans) ? raw.plans : [];

  const plans = rawPlans
    .map((plan) => {
      try {
        return migratePlan(plan, raw.schemaVersion as number);
      } catch {
        return undefined;
      }
    })
    .filter((plan): plan is TrainingPlan => plan !== undefined);

  return { schemaVersion: TRAINING_PLANS_SCHEMA_VERSION, plans };
}
