import type { AccuracyThresholds } from "../types";

/**
 * Accuracy Thresholds are a *Target Accuracy* concept — they judge how close
 * shot.releaseTime landed to shot.targetTime. They are unrelated to Blind
 * Weight's Prediction Accuracy (predictedTime vs. releaseTime), which is
 * never gated by these values.
 *
 * These preset numbers are recommendations, not objective or scientifically
 * validated performance norms — same "no fabricated precision" principle as
 * Smart Random ranges (see docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md).
 */
export type AccuracyThresholdPreset = "standard" | "tight" | "custom";

export const STANDARD_ACCURACY_THRESHOLDS: AccuracyThresholds = {
  onTarget: 0.1,
  acceptable: 0.2,
};

export const TIGHT_ACCURACY_THRESHOLDS: AccuracyThresholds = {
  onTarget: 0.05,
  acceptable: 0.1,
};

/** Legacy/default fallback used by migration and whenever a block predates this concept. */
export const LEGACY_ACCURACY_THRESHOLDS: AccuracyThresholds =
  STANDARD_ACCURACY_THRESHOLDS;

export const ACCURACY_THRESHOLD_PRESETS: Record<
  Exclude<AccuracyThresholdPreset, "custom">,
  AccuracyThresholds
> = {
  standard: STANDARD_ACCURACY_THRESHOLDS,
  tight: TIGHT_ACCURACY_THRESHOLDS,
};

export type AccuracyThresholdsValidation =
  | { valid: true; onTarget: number; acceptable: number }
  | { valid: false; error: string };

/**
 * Validates a candidate AccuracyThresholds pair. Both values must be finite,
 * positive numbers, and `acceptable` must be strictly greater than `onTarget`
 * — there is no fixed sporting upper bound (no "no technically-meaningless
 * zero/negative bound" beyond positivity is invented here).
 */
export function validateAccuracyThresholds(
  onTarget: number,
  acceptable: number
): AccuracyThresholdsValidation {
  if (!Number.isFinite(onTarget) || !Number.isFinite(acceptable)) {
    return { valid: false, error: "Enter valid numbers for both thresholds." };
  }

  if (onTarget <= 0 || acceptable <= 0) {
    return { valid: false, error: "Thresholds must be greater than zero." };
  }

  if (acceptable <= onTarget) {
    return {
      valid: false,
      error: "Acceptable must be greater than On Target.",
    };
  }

  return { valid: true, onTarget, acceptable };
}

function isValidAccuracyThresholds(
  thresholds: AccuracyThresholds | undefined
): thresholds is AccuracyThresholds {
  if (!thresholds) return false;
  return validateAccuracyThresholds(thresholds.onTarget, thresholds.acceptable)
    .valid;
}

/**
 * Resolves a block's stored (possibly absent or invalid) thresholds to a safe,
 * always-valid value. Never derives a historical block's thresholds from the
 * app's *current* default — an absent/invalid stored value always repairs to
 * the fixed legacy default, not whatever preset happens to be selected today.
 */
export function resolveAccuracyThresholds(
  thresholds: AccuracyThresholds | undefined
): AccuracyThresholds {
  return isValidAccuracyThresholds(thresholds)
    ? thresholds
    : LEGACY_ACCURACY_THRESHOLDS;
}

export type TargetErrorCategory = "on_target" | "acceptable" | "major_miss";

// Release/target times are floating-point numbers derived from subtraction
// (releaseTime - targetTime); a shot whose values are exactly on a threshold
// boundary (e.g. 3.85 - 3.75) can land a few units of floating-point noise
// past it (0.10000000000000009, not 0.1). This epsilon is many orders of
// magnitude below this app's real time precision (hundredths of a second),
// so it can never change the category of two genuinely different values —
// it only absorbs floating-point subtraction artifacts at the boundary.
const CATEGORY_BOUNDARY_EPSILON = 1e-9;

/**
 * Categorizes a single shot's absolute target error against a resolved set of
 * thresholds. Mutually exclusive, partitions every shot into exactly one
 * category:
 *   on_target:  absoluteTargetError <= onTarget
 *   acceptable: onTarget < absoluteTargetError <= acceptable
 *   major_miss: absoluteTargetError > acceptable
 *
 * This is the fachlicher "Major Miss" definition — distinct from a
 * statistical boxplot outlier (1.5x IQR), which must never be labeled or
 * exported as a Major Miss (see src/lib/boxPlotStatistics.ts).
 */
export function categorizeTargetError(
  absoluteTargetError: number,
  thresholds: AccuracyThresholds
): TargetErrorCategory {
  if (absoluteTargetError <= thresholds.onTarget + CATEGORY_BOUNDARY_EPSILON) {
    return "on_target";
  }
  if (absoluteTargetError <= thresholds.acceptable + CATEGORY_BOUNDARY_EPSILON) {
    return "acceptable";
  }
  return "major_miss";
}
