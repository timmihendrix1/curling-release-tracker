import type { CuratedExercisePlanStep, ReleaseTimingPlanStep, Session, TrainingPlan } from "../../../types";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID, RELEASE_TIME_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";

function version(versionId: string) {
  const found = findExerciseVersion(EXERCISE_CATALOG, versionId);
  if (!found) throw new Error(`Missing test Exercise Version ${versionId}`);
  return JSON.parse(JSON.stringify(found)) as typeof found;
}

export function buildStep(
  overrides: Partial<ReleaseTimingPlanStep> = {}
): ReleaseTimingPlanStep {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    type: "release-timing",
    exerciseVersionSnapshot:
      overrides.exerciseVersionSnapshot ?? version(RELEASE_TIME_VERSION_ID),
    completion: overrides.completion ?? { type: "shot-count", value: 4 },
    handleStrategy: overrides.handleStrategy ?? { type: "free" },
    configuration: {
      name: "",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
      blindTargetMode: "fixed",
      smartRandomMin: 2.5,
      smartRandomMax: 4.5,
      accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      ...overrides.configuration,
    },
  };
}

export function buildExerciseStep(
  overrides: Partial<CuratedExercisePlanStep> = {}
): CuratedExercisePlanStep {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    type: "curated-exercise",
    exerciseVersionSnapshot:
      overrides.exerciseVersionSnapshot ?? version(EIGHT_GUARDS_VERSION_ID),
    completion: { type: "exercise-completion" },
  };
}

export function buildPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  const now = "2026-01-01T00:00:00.000Z";

  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Release Consistency",
    description: overrides.description,
    steps: overrides.steps ?? [buildStep()],
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    schemaVersion: overrides.schemaVersion ?? 2,
  };
}

export function buildSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    title: overrides.title ?? "Training Session",
    date: overrides.date ?? "2026-01-01T00:00:00.000Z",
    notes: overrides.notes ?? "",
    blocks: overrides.blocks ?? [],
    activeBlockId: overrides.activeBlockId ?? "",
    shots: overrides.shots ?? [],
    exerciseExecutions: overrides.exerciseExecutions,
    activeExerciseExecutionId: overrides.activeExerciseExecutionId,
    captureSequence: overrides.captureSequence,
    planExecution: overrides.planExecution,
  };
}
