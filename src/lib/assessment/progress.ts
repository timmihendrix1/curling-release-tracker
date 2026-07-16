// Planned-shot navigation and progress utilities — pure functions, no
// UI-specific strings. Warm-up/scored progress is always derived from
// `attempts` + `templateSnapshot`, never stored as a separate redundant
// field on AssessmentRun (raw data stays authoritative — see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 2).
import type {
  AssessmentBlockDefinition,
  AssessmentRun,
  AssessmentTemplate,
  PlannedAssessmentShot,
  PlannedAssessmentShotPhase,
} from "./types";

/** The full, globally-ordered planned-shot sequence: warm-up shots followed by every block's scored shots, in sequenceIndex order. */
export function getAllPlannedShots(template: AssessmentTemplate): PlannedAssessmentShot[] {
  return [...template.warmupShots, ...template.blocks.flatMap((block) => block.plannedShots)].sort(
    (a, b) => a.sequenceIndex - b.sequenceIndex
  );
}

export function getCurrentPlannedShot(run: AssessmentRun): PlannedAssessmentShot | undefined {
  return getAllPlannedShots(run.templateSnapshot)[run.currentPlannedShotIndex];
}

export function getNextPlannedShot(run: AssessmentRun): PlannedAssessmentShot | undefined {
  return getAllPlannedShots(run.templateSnapshot)[run.currentPlannedShotIndex + 1];
}

/** The block containing the current planned shot, or undefined during warm-up or once the run is past the last shot. */
export function getCurrentBlock(run: AssessmentRun): AssessmentBlockDefinition | undefined {
  const shot = getCurrentPlannedShot(run);
  if (!shot || shot.blockId === null) return undefined;
  return run.templateSnapshot.blocks.find((block) => block.id === shot.blockId);
}

function plannedShotsForPhase(
  template: AssessmentTemplate,
  phase: PlannedAssessmentShotPhase
): PlannedAssessmentShot[] {
  return getAllPlannedShots(template).filter((shot) => shot.phase === phase);
}

/** Number of distinct planned shots (within the given phase) that have at least one valid attempt. */
export function countValidAttemptsForPhase(
  run: AssessmentRun,
  phase: PlannedAssessmentShotPhase
): number {
  const shotIds = new Set(plannedShotsForPhase(run.templateSnapshot, phase).map((shot) => shot.id));
  const completedShotIds = new Set(
    run.attempts
      .filter((attempt) => attempt.status === "valid" && shotIds.has(attempt.plannedShotId))
      .map((attempt) => attempt.plannedShotId)
  );
  return completedShotIds.size;
}

export type ProgressCount = { completed: number; total: number };

export function calculateWarmupProgress(run: AssessmentRun): ProgressCount {
  return {
    completed: countValidAttemptsForPhase(run, "warmup"),
    total: run.templateSnapshot.warmupShots.length,
  };
}

export function calculateScoredProgress(run: AssessmentRun): ProgressCount {
  return {
    completed: countValidAttemptsForPhase(run, "scored"),
    total: run.templateSnapshot.blocks.reduce((sum, block) => sum + block.plannedShots.length, 0),
  };
}

export function isWarmupComplete(run: AssessmentRun): boolean {
  const progress = calculateWarmupProgress(run);
  return progress.total === 0 || progress.completed >= progress.total;
}

/** True once every scored planned shot has a valid attempt — the sole precondition for completing a run. */
export function isRunCompletable(run: AssessmentRun): boolean {
  const progress = calculateScoredProgress(run);
  return progress.total > 0 && progress.completed >= progress.total;
}

export function countValidScoredAttempts(run: AssessmentRun): number {
  return countValidAttemptsForPhase(run, "scored");
}

export function countInvalidAttempts(run: AssessmentRun): number {
  return run.attempts.filter((attempt) => attempt.status === "invalid").length;
}

export function countProtocolDeviations(run: AssessmentRun): number {
  return run.protocolDeviations.length;
}

export function isLastPlannedShot(run: AssessmentRun): boolean {
  const all = getAllPlannedShots(run.templateSnapshot);
  return run.currentPlannedShotIndex >= all.length - 1;
}
