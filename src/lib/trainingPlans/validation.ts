// Plan/step validation — reuses the exact same rules createTrainingBlock and
// TrainingSetup.tsx already enforce (isSmartRandomAvailable, validateSmartRandomRange)
// rather than a second interpretation of "valid". Never coerces an invalid
// combination (e.g. Hog-Hog + Smart Random) into a fabricated valid one — see
// docs/TRAINING_SYSTEM_AND_PLANS.md section 52.
import type {
  ReleaseTimingBlockConfiguration,
  TrainingPlan,
  TrainingPlanStep,
} from "../../types";
import { isSmartRandomAvailable, validateSmartRandomRange } from "../variableTargets";
import { err, ok, type TrainingPlanOutcome } from "./errors";

function effectiveTargetMode(configuration: ReleaseTimingBlockConfiguration) {
  if (configuration.mode === "variable") return configuration.variableTargetMode;
  if (configuration.mode === "blind") return configuration.blindTargetMode;
  return "fixed" as const;
}

/**
 * Whether a step's mode-specific configuration is currently valid enough to create
 * a TrainingBlock from. Distinguishes "readable" (the plan loaded without crashing)
 * from "executable" (this step can actually be started) — see spec section 53.
 */
export function isStepExecutable(step: TrainingPlanStep): boolean {
  const { configuration, completion } = step;

  if (!Number.isInteger(completion.value) || completion.value <= 0) return false;

  const mode = effectiveTargetMode(configuration);

  if (mode === "smart-random") {
    if (!isSmartRandomAvailable(configuration.measurementMode)) return false;
    const range = validateSmartRandomRange(
      configuration.smartRandomMin,
      configuration.smartRandomMax
    );
    return range.valid;
  }

  return Number.isFinite(configuration.targetTime) && configuration.targetTime > 0;
}

export function isPlanExecutable(plan: TrainingPlan): boolean {
  return plan.steps.length > 0 && plan.steps.every(isStepExecutable);
}

export function validatePlanStep(step: TrainingPlanStep): TrainingPlanOutcome<true> {
  if (!isStepExecutable(step)) {
    return err(
      "invalid_step",
      "This step's configuration isn't valid yet — check its target and measurement mode."
    );
  }

  return ok(true);
}

export function validatePlan(
  plan: Pick<TrainingPlan, "name" | "steps">
): TrainingPlanOutcome<true> {
  if (!plan.name.trim()) {
    return err("invalid_plan", "Give this plan a name before saving.");
  }

  if (plan.steps.length === 0) {
    return err("invalid_plan", "Add at least one step before saving.");
  }

  for (const step of plan.steps) {
    const stepResult = validatePlanStep(step);
    if (!stepResult.ok) return stepResult;
  }

  return ok(true);
}
