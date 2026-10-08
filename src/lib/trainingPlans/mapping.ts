// The one boundary that translates a Release Timing Plan Step (a template) into
// the input required to create a real Training Block (a runtime entity) — see
// docs/TRAINING_SYSTEM_AND_PLANS.md section 40. Deliberately thin: it must never
// re-interpret or re-validate the configuration, only reshape it — validation lives
// in ./validation.ts, and block creation itself stays entirely in trainingBlocks.ts.
import type { ReleaseTimingPlanStep } from "../../types";
import { defaultBlockName, type NewBlockInput } from "../trainingBlocks";

/**
 * Carries the step's measurement selection, targets and tolerances through
 * verbatim. A speed-only step genuinely has no timing interval and no time target,
 * and neither is invented here — the created block is speed-only too.
 */
export function mapPlanStepToTrainingBlockInput(
  step: ReleaseTimingPlanStep
): NewBlockInput {
  const { configuration } = step;

  return {
    name: configuration.name.trim() || defaultBlockName(configuration.mode),
    mode: configuration.mode,
    measurementMode: configuration.measurementMode,
    targetTime: configuration.targetTime,
    variableTargetMode: configuration.variableTargetMode,
    blindTargetMode: configuration.blindTargetMode,
    smartRandomMin: configuration.smartRandomMin,
    smartRandomMax: configuration.smartRandomMax,
    accuracyThresholds: configuration.accuracyThresholds,
    measurement: configuration.measurement,
  };
}
