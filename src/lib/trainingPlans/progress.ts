import type { PlanExecutionState, PlanExecutionStepSnapshot, Session } from "../../types";
import { getBlockShots } from "../trainingBlocks";
import {
  isReleaseTimingPlanStep,
  trainingPlanStepCategoryLabel,
  trainingPlanStepTitle,
} from "./steps";

export function getActiveStepSnapshot(
  planExecution: PlanExecutionState
): PlanExecutionStepSnapshot | undefined {
  return planExecution.steps[planExecution.activeStepIndex];
}

export function isFinalStep(planExecution: PlanExecutionState): boolean {
  return planExecution.activeStepIndex === planExecution.steps.length - 1;
}

export function hasNextPlanStep(planExecution: PlanExecutionState): boolean {
  return planExecution.activeStepIndex < planExecution.steps.length - 1;
}

function findExerciseExecution(session: Session, executionId: string) {
  return session.exerciseExecutions?.find((execution) => execution.id === executionId);
}

/**
 * Verifies the active step against its own typed runtime entity. Release Time remains
 * block-backed; Technique and Shotmaking remain embedded Exercise Executions. A
 * completed Exercise is still active until Next Exercise/Finish Training advances it,
 * even though Session.activeExerciseExecutionId is cleared terminally.
 */
export function isPlanExecutionActive(
  session: Session,
  planExecution: PlanExecutionState
): boolean {
  const snapshot = getActiveStepSnapshot(planExecution);
  if (!snapshot?.runtime) return false;

  if (isReleaseTimingPlanStep(snapshot.step)) {
    const runtime = snapshot.runtime;
    return runtime.kind === "release-timing-block" &&
      session.activeBlockId === runtime.blockId &&
      session.blocks.some((block) => block.id === runtime.blockId);
  }

  if (snapshot.runtime.kind !== "exercise-execution") return false;
  const execution = findExerciseExecution(session, snapshot.runtime.exerciseExecutionId);
  if (!execution) return false;
  if (execution.exerciseVersionSnapshot.id !== snapshot.step.exerciseVersionSnapshot.id) {
    return false;
  }
  if (execution.status === "abandoned") return false;
  return execution.status === "in-progress"
    ? session.activeExerciseExecutionId === execution.id
    : session.activeExerciseExecutionId === undefined;
}

/**
 * Whether the active step has reached the volume/completion its plan described.
 *
 * This is **guidance, never a gate**: progression to the next planned Exercise and
 * Finish Training are available regardless (see
 * docs/TRAINING_SYSTEM_AND_PLANS.md section 31's canonical statement). It exists only
 * to describe progress factually.
 */
export function isActiveStepComplete(
  session: Session,
  planExecution: PlanExecutionState
): boolean {
  if (!isPlanExecutionActive(session, planExecution)) return false;
  const snapshot = getActiveStepSnapshot(planExecution);
  if (!snapshot?.runtime) return false;

  if (isReleaseTimingPlanStep(snapshot.step)) {
    if (snapshot.runtime.kind !== "release-timing-block") return false;
    return getBlockShots(session, snapshot.runtime.blockId).length >=
      snapshot.step.completion.value;
  }

  if (snapshot.runtime.kind !== "exercise-execution") return false;
  return findExerciseExecution(session, snapshot.runtime.exerciseExecutionId)?.status ===
    "completed";
}

/**
 * Whether the WHOLE plan was completed — every step, not merely the one the athlete
 * happens to be standing on.
 *
 * Reaching and completing the last step is necessary but not sufficient: an athlete
 * who skips step 1 with Next Exercise and then completes step 2 has not completed the
 * plan, and describing that training as "completed" would be untrue. Skipping remains
 * fully supported and non-destructive (ADR-0048) — this only governs what the training
 * is CALLED, never what is kept.
 *
 * Earlier steps are judged by their own recorded outcome, so a step that was never
 * reached, recorded nothing, or ended before its planned volume all correctly prevent
 * the "completed" claim.
 */
export function isPlanComplete(
  session: Session,
  planExecution: PlanExecutionState
): boolean {
  if (!isFinalStep(planExecution) || !isActiveStepComplete(session, planExecution)) {
    return false;
  }

  return planExecution.steps.every((snapshot, index) => {
    if (index === planExecution.activeStepIndex) return true;
    return (
      stepOutcome(session, snapshot, stepActualUnits(session, snapshot)) === "completed"
    );
  });
}

function stepActualUnits(session: Session, snapshot: PlanExecutionStepSnapshot): number {
  if (!snapshot.runtime) return 0;
  if (isReleaseTimingPlanStep(snapshot.step)) {
    return snapshot.runtime.kind === "release-timing-block"
      ? getBlockShots(session, snapshot.runtime.blockId).length
      : 0;
  }
  if (snapshot.runtime.kind !== "exercise-execution") return 0;
  const execution = findExerciseExecution(session, snapshot.runtime.exerciseExecutionId);
  return execution?.athleteResults.reduce(
    (total, result) => total + result.attempts.length,
    0
  ) ?? 0;
}

function plannedUnits(snapshot: PlanExecutionStepSnapshot): number | undefined {
  return isReleaseTimingPlanStep(snapshot.step)
    ? snapshot.step.completion.value
    : undefined;
}

/**
 * The factual volume of one step, always naming the planned figure where the step type
 * actually has one. A lower actual figure is a recorded fact, never an error — see
 * docs/TRAINING_SYSTEM_AND_PLANS.md section 31.
 */
function stepVolumeLabel(
  snapshot: PlanExecutionStepSnapshot,
  actual: number
): string | undefined {
  const planned = plannedUnits(snapshot);
  if (planned !== undefined) {
    return `${actual} of ${planned} planned stone${planned === 1 ? "" : "s"}`;
  }

  switch (snapshot.step.exerciseVersionSnapshot.primaryFocus) {
    case "shotmaking":
      return `${actual} stone${actual === 1 ? "" : "s"} recorded`;
    case "measured":
      return `${actual} attempt${actual === 1 ? "" : "s"} recorded`;
    default:
      return undefined;
  }
}

/**
 * What actually happened to one step, derived from the Session's own recorded data —
 * never a separately stored progress flag, and never inferred from the active index
 * (a step the athlete never reached must not read as completed).
 *
 * `"in-progress"` can only be produced by a still-open Exercise Execution, so a
 * Session archived through the existing terminal boundary never reports it.
 */
export type PlanStepOutcome =
  | "not-started"
  | "in-progress"
  | "completed"
  | "ended-early"
  | "nothing-recorded";

export type PlanStepSummary = {
  stepNumber: number;
  title: string;
  categoryLabel: string;
  outcome: PlanStepOutcome;
  actualUnits: number;
  plannedUnits?: number;
  volumeLabel?: string;
};

function stepOutcome(
  session: Session,
  snapshot: PlanExecutionStepSnapshot,
  actual: number
): PlanStepOutcome {
  if (!snapshot.runtime) return "not-started";

  if (isReleaseTimingPlanStep(snapshot.step)) {
    if (snapshot.runtime.kind !== "release-timing-block") return "not-started";
    if (actual === 0) return "nothing-recorded";
    return actual >= snapshot.step.completion.value ? "completed" : "ended-early";
  }

  if (snapshot.runtime.kind !== "exercise-execution") return "not-started";
  const execution = findExerciseExecution(session, snapshot.runtime.exerciseExecutionId);
  if (!execution) return "not-started";
  if (execution.status === "in-progress") return "in-progress";
  if (execution.status === "completed") return "completed";
  return actual > 0 ? "ended-early" : "nothing-recorded";
}

export function getPlanStepSummaries(
  session: Session,
  planExecution: PlanExecutionState
): PlanStepSummary[] {
  return planExecution.steps.map((snapshot, index) => {
    const actualUnits = stepActualUnits(session, snapshot);
    const planned = plannedUnits(snapshot);

    return {
      stepNumber: index + 1,
      title: trainingPlanStepTitle(snapshot.step),
      categoryLabel: trainingPlanStepCategoryLabel(snapshot.step),
      outcome: stepOutcome(session, snapshot, actualUnits),
      actualUnits,
      ...(planned !== undefined ? { plannedUnits: planned } : {}),
      ...(snapshot.runtime
        ? { volumeLabel: stepVolumeLabel(snapshot, actualUnits) }
        : {}),
    };
  });
}

/**
 * Every recorded stone in the Session, across the execution types this app supports —
 * Release Time's Block/Shot runner AND embedded Exercise Executions' attempts.
 *
 * Counting `session.shots` alone reports zero for a training made entirely of
 * Shotmaking or Technique work, which is exactly the kind of "fabricated zero" the
 * product rules forbid. There is no double counting: Release Time is recorded as
 * Shots and is deliberately never duplicated as an Exercise Execution (see
 * `Session.exerciseExecutions` in src/types/index.ts), and each Exercise Execution's
 * attempts belong to that execution alone.
 */
export function countRecordedStones(session: Session): number {
  const exerciseAttempts = (session.exerciseExecutions ?? []).reduce(
    (total, execution) =>
      total +
      execution.athleteResults.reduce(
        (attempts, result) => attempts + result.attempts.length,
        0
      ),
    0
  );

  return session.shots.length + exerciseAttempts;
}

export type PlanProgressSummary = {
  currentStepNumber: number;
  totalSteps: number;
  currentStepTitle: string;
  currentProgressLabel: string;
  /** Steps that actually reached their planned volume or explicit Exercise completion. */
  completedStepCount: number;
};

export function getPlanProgressSummary(
  session: Session,
  planExecution: PlanExecutionState
): PlanProgressSummary {
  const activeSnapshot = getActiveStepSnapshot(planExecution);
  const actualUnits = activeSnapshot ? stepActualUnits(session, activeSnapshot) : 0;
  const volumeLabel = activeSnapshot
    ? stepVolumeLabel(activeSnapshot, actualUnits)
    : undefined;
  const currentProgressLabel = volumeLabel ??
    (isActiveStepComplete(session, planExecution)
      ? "Exercise completed"
      : "Complete when the observation is finished");

  return {
    currentStepNumber: planExecution.activeStepIndex + 1,
    totalSteps: planExecution.steps.length,
    currentStepTitle: activeSnapshot ? trainingPlanStepTitle(activeSnapshot.step) : "Training step",
    currentProgressLabel,
    // Counted from what each step actually records — never `activeStepIndex`, which
    // would present skipped and early-ended steps as completed.
    completedStepCount: getPlanStepSummaries(session, planExecution).filter(
      (summary) => summary.outcome === "completed"
    ).length,
  };
}
