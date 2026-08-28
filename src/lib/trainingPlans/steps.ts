import { EXERCISE_CATALOG } from "../exercises/catalog";
import { findExerciseVersion } from "../exercises/lookup";
import type { ExerciseVersion } from "../exercises/types";
import type {
  CuratedExercisePlanStep,
  ReleaseTimingPlanStep,
  TrainingPlanStep,
} from "../../types";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneTrainingPlanStep(step: TrainingPlanStep): TrainingPlanStep {
  return clone(step);
}

export function isCatalogExerciseVersionSnapshot(
  version: ExerciseVersion | null | undefined
): version is ExerciseVersion {
  if (!version || typeof version.id !== "string") return false;
  const catalogVersion = findExerciseVersion(EXERCISE_CATALOG, version.id);
  return catalogVersion !== undefined &&
    JSON.stringify(catalogVersion) === JSON.stringify(version);
}

export function isReleaseTimingPlanStep(
  step: TrainingPlanStep
): step is ReleaseTimingPlanStep {
  return step.type === "release-timing";
}

export function isCuratedExercisePlanStep(
  step: TrainingPlanStep
): step is CuratedExercisePlanStep {
  return step.type === "curated-exercise";
}

export function trainingPlanStepTitle(step: TrainingPlanStep): string {
  return step.exerciseVersionSnapshot.title;
}

export function trainingPlanStepFocusLabel(step: TrainingPlanStep): string {
  switch (step.exerciseVersionSnapshot.primaryFocus) {
    case "technique":
      return "Technique";
    case "shotmaking":
      return "Shotmaking";
    case "measured":
      return "Measured";
  }
}

export function trainingPlanStepPlannedStoneCount(
  step: TrainingPlanStep
): number | undefined {
  return isReleaseTimingPlanStep(step) ? step.completion.value : undefined;
}
