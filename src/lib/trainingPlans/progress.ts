// Plan-execution progress — every function here is a pure derivation from Session +
// PlanExecutionState, never cached or separately persisted (see ADR-0012's "step
// completion is derived, not stored" decision). Progression is always keyed by the
// snapshot's stored blockId, never by array position — session.blocks[i] is never
// assumed to equal planExecution.steps[i].
import type { PlanExecutionState, PlanExecutionStepSnapshot, Session } from "../../types";
import { getBlockShots } from "../trainingBlocks";

export function getActiveStepSnapshot(
  planExecution: PlanExecutionState
): PlanExecutionStepSnapshot | undefined {
  return planExecution.steps[planExecution.activeStepIndex];
}

export function isFinalStep(planExecution: PlanExecutionState): boolean {
  return planExecution.activeStepIndex === planExecution.steps.length - 1;
}

/**
 * True only when the active step's block genuinely matches what the plan expects —
 * i.e. the plan is actively, safely driving the session's current block. False
 * whenever the athlete has navigated away from the plan's block (e.g. manually
 * started a new Training Block instead of using Continue/Finish), or the execution
 * snapshot doesn't resolve to a real block at all. The plan progress/transition UI
 * must only render when this is true, and advancing to the next step must only ever
 * be offered when this is true — the app must never guess or silently advance from a
 * state that doesn't check out.
 */
export function isPlanExecutionActive(
  session: Session,
  planExecution: PlanExecutionState
): boolean {
  const activeSnapshot = getActiveStepSnapshot(planExecution);
  if (!activeSnapshot?.blockId) return false;
  if (session.activeBlockId !== activeSnapshot.blockId) return false;
  return session.blocks.some((block) => block.id === activeSnapshot.blockId);
}

/**
 * Whether the active step's block has reached its planned shot count. Purely
 * derived from Session.shots (never cached), so a deleted shot is reflected the
 * instant it's removed. Returns false (never throws) if the plan isn't actively
 * driving the session's current block — callers should gate on
 * isPlanExecutionActive first wherever the distinction between "not complete" and
 * "not currently valid to check" matters.
 */
export function isActiveStepComplete(
  session: Session,
  planExecution: PlanExecutionState
): boolean {
  if (!isPlanExecutionActive(session, planExecution)) return false;

  const activeSnapshot = getActiveStepSnapshot(planExecution);
  if (!activeSnapshot?.blockId) return false;

  const shotsSaved = getBlockShots(session, activeSnapshot.blockId).length;
  return shotsSaved >= activeSnapshot.step.completion.value;
}

export function isPlanComplete(
  session: Session,
  planExecution: PlanExecutionState
): boolean {
  return isFinalStep(planExecution) && isActiveStepComplete(session, planExecution);
}

export type PlanProgressSummary = {
  currentStepNumber: number; // 1-based
  totalSteps: number;
  shotsSavedInCurrentStep: number;
  plannedShotsInCurrentStep: number;
  totalPlannedShots: number;
  totalActualShots: number;
};

export function getPlanProgressSummary(
  session: Session,
  planExecution: PlanExecutionState
): PlanProgressSummary {
  const activeSnapshot = getActiveStepSnapshot(planExecution);

  const totalPlannedShots = planExecution.steps.reduce(
    (sum, snapshot) => sum + snapshot.step.completion.value,
    0
  );

  const totalActualShots = planExecution.steps.reduce(
    (sum, snapshot) =>
      sum + (snapshot.blockId ? getBlockShots(session, snapshot.blockId).length : 0),
    0
  );

  return {
    currentStepNumber: planExecution.activeStepIndex + 1,
    totalSteps: planExecution.steps.length,
    shotsSavedInCurrentStep: activeSnapshot?.blockId
      ? getBlockShots(session, activeSnapshot.blockId).length
      : 0,
    plannedShotsInCurrentStep: activeSnapshot?.step.completion.value ?? 0,
    totalPlannedShots,
    totalActualShots,
  };
}
