import { EXERCISE_CATALOG } from "../exercises/catalog";
import { exerciseDiscoveryCategory } from "../exercises/discovery";
import { findExerciseVersion } from "../exercises/lookup";
import { exerciseDiscoveryCategoryLabel } from "../exercises/presentation";
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

/**
 * The Library category the step's Exercise is discovered under. A step keeps whatever
 * execution focus its snapshot recorded; this is only how the step is described to the
 * athlete, and it uses the same two categories the Library and the picker do.
 */
export function trainingPlanStepCategoryLabel(step: TrainingPlanStep): string {
  return exerciseDiscoveryCategoryLabel(
    exerciseDiscoveryCategory(step.exerciseVersionSnapshot)
  );
}

export function trainingPlanStepPlannedStoneCount(
  step: TrainingPlanStep
): number | undefined {
  return isReleaseTimingPlanStep(step) ? step.completion.value : undefined;
}
