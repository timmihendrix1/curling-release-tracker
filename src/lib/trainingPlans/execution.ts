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
  ReleaseTimingPlanStep,
  TrainingPlan,
} from "../../types";

function cloneStep(step: ReleaseTimingPlanStep): ReleaseTimingPlanStep {
  return {
    ...step,
    completion: { ...step.completion },
    handleStrategy: { ...step.handleStrategy },
    configuration: {
      ...step.configuration,
      accuracyThresholds: { ...step.configuration.accuracyThresholds },
    },
  };
}

/**
 * Deep-copies the plan's steps into a fresh execution snapshot — never a live
 * reference to the saved TrainingPlan — so a later edit or deletion of the plan can
 * never affect this or any future execution (spec invariant #2). `firstBlockId` is
 * the id of the TrainingBlock the caller has already created for step 0.
 */
export function startPlanExecution(
  plan: TrainingPlan,
  firstBlockId: string
): PlanExecutionState {
  return {
    sourcePlanId: plan.id,
    sourcePlanName: plan.name,
    sourcePlanUpdatedAt: plan.updatedAt,
    activeStepIndex: 0,
    steps: plan.steps.map((step, index) => ({
      step: cloneStep(step),
      blockId: index === 0 ? firstBlockId : undefined,
    })),
  };
}

/**
 * Advances to the next step, stamping `newBlockId` (the id of the TrainingBlock the
 * caller has already created for it) onto it. A no-op (returns the identical
 * reference) if already on the final step.
 */
export function advanceToNextPlanStep(
  planExecution: PlanExecutionState,
  newBlockId: string
): PlanExecutionState {
  if (planExecution.activeStepIndex >= planExecution.steps.length - 1) {
    return planExecution;
  }

  const nextIndex = planExecution.activeStepIndex + 1;

  return {
    ...planExecution,
    activeStepIndex: nextIndex,
    steps: planExecution.steps.map((snapshot, index) =>
      index === nextIndex ? { ...snapshot, blockId: newBlockId } : snapshot
    ),
  };
}
