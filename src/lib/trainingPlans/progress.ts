import type { PlanExecutionState, PlanExecutionStepSnapshot, Session } from "../../types";
import { getBlockShots } from "../trainingBlocks";
import { isReleaseTimingPlanStep, trainingPlanStepTitle } from "./steps";

export function getActiveStepSnapshot(
  planExecution: PlanExecutionState
): PlanExecutionStepSnapshot | undefined {
  return planExecution.steps[planExecution.activeStepIndex];
}

export function isFinalStep(planExecution: PlanExecutionState): boolean {
  return planExecution.activeStepIndex === planExecution.steps.length - 1;
}

function findExerciseExecution(session: Session, executionId: string) {
  return session.exerciseExecutions?.find((execution) => execution.id === executionId);
}

/**
 * Verifies the active step against its own typed runtime entity. Release Time remains
 * block-backed; Technique and Shotmaking remain embedded Exercise Executions. A
 * completed Exercise is still active until Continue/Finish advances it, even though
 * Session.activeExerciseExecutionId is cleared terminally.
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

export function isPlanComplete(
  session: Session,
  planExecution: PlanExecutionState
): boolean {
  return isFinalStep(planExecution) && isActiveStepComplete(session, planExecution);
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

export type PlanProgressSummary = {
  currentStepNumber: number;
  totalSteps: number;
  currentStepTitle: string;
  currentProgressLabel: string;
  completedStepCount: number;
};

export function getPlanProgressSummary(
  session: Session,
  planExecution: PlanExecutionState
): PlanProgressSummary {
  const activeSnapshot = getActiveStepSnapshot(planExecution);
  const actualUnits = activeSnapshot ? stepActualUnits(session, activeSnapshot) : 0;
  const currentProgressLabel = activeSnapshot && isReleaseTimingPlanStep(activeSnapshot.step)
    ? `Stone ${actualUnits} of ${activeSnapshot.step.completion.value}`
    : activeSnapshot?.step.exerciseVersionSnapshot.primaryFocus === "shotmaking"
      ? `${actualUnits} stone${actualUnits === 1 ? "" : "s"} recorded`
      : isActiveStepComplete(session, planExecution)
        ? "Exercise completed"
        : "Complete when the observation is finished";

  return {
    currentStepNumber: planExecution.activeStepIndex + 1,
    totalSteps: planExecution.steps.length,
    currentStepTitle: activeSnapshot ? trainingPlanStepTitle(activeSnapshot.step) : "Training step",
    currentProgressLabel,
    completedStepCount:
      planExecution.activeStepIndex + (isActiveStepComplete(session, planExecution) ? 1 : 0),
  };
}
