// Building and advancing a PlanExecutionState. Deliberately does not create
// TrainingBlocks itself — TrackerApp.tsx remains the only place a Shot/TrainingBlock
// is actually saved (same boundary AssessScreen.tsx already establishes for
// Assessment Runs). Callers create the relevant TrainingBlock first (via
// mapPlanStepToTrainingBlockInput + trainingBlocks.ts's addTrainingBlock) and pass
// its id in, so the returned PlanExecutionState is always internally consistent —
// the active step (and every step before it) always has a real blockId the moment
// it's committed, never in a separate, later step.
import type {
  PlanExecutionState,
  PlanStepRuntimeReference,
  TrainingPlan,
} from "../../types";
import { cloneTrainingPlanStep } from "./steps";

/**
 * Deep-copies the plan's steps into a fresh execution snapshot — never a live
 * reference to the saved TrainingPlan — so a later edit or deletion of the plan can
 * never affect this or any future execution (spec invariant #2). `firstRuntime` is
 * the typed reference to the first step's already-created runtime entity.
 */
export function startPlanExecution(
  plan: TrainingPlan,
  firstRuntime: PlanStepRuntimeReference
): PlanExecutionState {
  return {
    sourcePlanId: plan.id,
    sourcePlanName: plan.name,
    sourcePlanUpdatedAt: plan.updatedAt,
    activeStepIndex: 0,
    steps: plan.steps.map((step, index) => ({
      step: cloneTrainingPlanStep(step),
      runtime: index === 0 ? { ...firstRuntime } : undefined,
    })),
  };
}

/**
 * Advances to the next step, stamping the typed reference to the runtime entity the
 * caller has already created for it. A no-op (returns the identical
 * reference) if already on the final step.
 */
export function advanceToNextPlanStep(
  planExecution: PlanExecutionState,
  newRuntime: PlanStepRuntimeReference
): PlanExecutionState {
  if (planExecution.activeStepIndex >= planExecution.steps.length - 1) {
    return planExecution;
  }

  const nextIndex = planExecution.activeStepIndex + 1;

  return {
    ...planExecution,
    activeStepIndex: nextIndex,
    steps: planExecution.steps.map((snapshot, index) =>
      index === nextIndex ? { ...snapshot, runtime: { ...newRuntime } } : snapshot
    ),
  };
}
