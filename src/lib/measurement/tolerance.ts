// Per-quantity, per-side tolerance bands and the single classification rule that
// judges a measurement against the target that actually applied to it.
//
// This generalizes src/lib/accuracyThresholds.ts's symmetric, seconds-only
// AccuracyThresholds pair along two independent axes — unit (seconds vs m/s) and
// side (below vs above target) — WITHOUT changing what a legacy pair means. A
// symmetric tolerance built from a historical AccuracyThresholds snapshot
// classifies every shot exactly as `categorizeTargetError` always did; see
// src/lib/measurement/__tests__/tolerance.test.ts for the equivalence proof.
//
// See docs/adr/0051-fixed-weight-measured-quantities-and-per-side-tolerances.md
// and docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md.
import type {
  AccuracyThresholds,
  MeasuredQuantity,
  QuantityTolerance,
  ToleranceBand,
} from "../../types";
import type { TargetErrorCategory } from "../accuracyThresholds";

/**
 * Adjustable product starting values for speed, in m/s — explicitly NOT validated
 * elite, scientific or federation norms (same "no fabricated precision" rule as
 * Smart Random ranges and the existing time presets; see
 * docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md).
 */
export const DEFAULT_SPEED_ON_TARGET = 0.05;
export const DEFAULT_SPEED_ACCEPTABLE = 0.1;

/** The unit label for each measured quantity. Never render a value without one. */
export function quantityUnitLabel(quantity: MeasuredQuantity): string {
  return quantity === "speed" ? "m/s" : "s";
}

export function quantityLabel(quantity: MeasuredQuantity): string {
  return quantity === "speed" ? "Speed" : "Time";
}

export function symmetricBand(value: number): ToleranceBand {
  return { lower: value, upper: value };
}

export function symmetricTolerance(
  onTarget: number,
  acceptable: number
): QuantityTolerance {
  return {
    onTarget: symmetricBand(onTarget),
    acceptable: symmetricBand(acceptable),
  };
}

/**
 * The exact meaning of a historical, symmetric seconds pair, expressed in the
 * per-side model. This is a lossless re-expression, never a reinterpretation —
 * the numbers and their meaning are untouched.
 */
export function toleranceFromAccuracyThresholds(
  thresholds: AccuracyThresholds
): QuantityTolerance {
  return symmetricTolerance(thresholds.onTarget, thresholds.acceptable);
}

export const DEFAULT_SPEED_TOLERANCE: QuantityTolerance = symmetricTolerance(
  DEFAULT_SPEED_ON_TARGET,
  DEFAULT_SPEED_ACCEPTABLE
);

/** Whether both bands carry the same number on both sides (a presentation concern). */
export function isSymmetricTolerance(tolerance: QuantityTolerance): boolean {
  return (
    tolerance.onTarget.lower === tolerance.onTarget.upper &&
    tolerance.acceptable.lower === tolerance.acceptable.upper
  );
}

/**
 * A symmetric tolerance's equivalent AccuracyThresholds pair, or undefined when it
 * is genuinely asymmetric and therefore cannot be expressed as one. Callers must
 * never collapse an asymmetric tolerance by picking one side.
 */
export function toleranceAsAccuracyThresholds(
  tolerance: QuantityTolerance
): AccuracyThresholds | undefined {
  if (!isSymmetricTolerance(tolerance)) return undefined;
  return {
    onTarget: tolerance.onTarget.lower,
    acceptable: tolerance.acceptable.lower,
  };
}

/**
 * Accepts either representation of a time tolerance and yields the per-side form.
 * Lets a call site that already holds a block's own (possibly asymmetric) tolerance
 * pass it straight through, while a call site that only has the historical symmetric
 * pair keeps working unchanged — without either one silently flattening the other.
 */
export function asQuantityTolerance(
  value: AccuracyThresholds | QuantityTolerance
): QuantityTolerance {
  return "onTarget" in value && typeof value.onTarget === "number"
    ? toleranceFromAccuracyThresholds(value as AccuracyThresholds)
    : (value as QuantityTolerance);
}

/**
 * How one tolerance band reads to a person, in that quantity's own unit.
 *
 * A symmetric band keeps its historical "±0.10s" form exactly. An asymmetric band
 * must NOT be rendered that way: "±0.10s" would name a cutoff that does not exist on
 * either side, and a reader comparing it against a classification would conclude the
 * app had contradicted itself. It is shown as its two real endpoints instead.
 */
export function toleranceBandLabel(
  band: ToleranceBand,
  quantity: MeasuredQuantity = "time"
): string {
  const unit = quantityUnitLabel(quantity);
  return band.lower === band.upper
    ? `±${band.lower.toFixed(2)}${unit}`
    : `-${band.lower.toFixed(2)}${unit} / +${band.upper.toFixed(2)}${unit}`;
}

export type QuantityToleranceValidation =
  | { valid: true; tolerance: QuantityTolerance }
  | { valid: false; error: string };

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Every side of both bands must be a finite, positive number, and on EACH side
 * independently the Acceptable band must extend strictly beyond On Target. There is
 * no invented sporting upper bound — exactly the invariant
 * `validateAccuracyThresholds` already enforces, applied per side.
 */
export function validateQuantityTolerance(
  tolerance: QuantityTolerance | undefined
): QuantityToleranceValidation {
  if (!tolerance || typeof tolerance !== "object") {
    return { valid: false, error: "Enter tolerance values." };
  }

  const { onTarget, acceptable } = tolerance;

  if (!onTarget || !acceptable || typeof onTarget !== "object" || typeof acceptable !== "object") {
    return { valid: false, error: "Enter tolerance values." };
  }

  if (
    !isPositiveFinite(onTarget.lower) ||
    !isPositiveFinite(onTarget.upper) ||
    !isPositiveFinite(acceptable.lower) ||
    !isPositiveFinite(acceptable.upper)
  ) {
    return { valid: false, error: "Tolerances must be numbers greater than zero." };
  }

  if (acceptable.lower <= onTarget.lower || acceptable.upper <= onTarget.upper) {
    return {
      valid: false,
      error: "Acceptable must be greater than On Target on both sides.",
    };
  }

  return {
    valid: true,
    tolerance: {
      onTarget: { lower: onTarget.lower, upper: onTarget.upper },
      acceptable: { lower: acceptable.lower, upper: acceptable.upper },
    },
  };
}

export function isValidQuantityTolerance(
  tolerance: QuantityTolerance | undefined
): tolerance is QuantityTolerance {
  return validateQuantityTolerance(tolerance).valid;
}

// Identical in purpose and magnitude to accuracyThresholds.ts's
// CATEGORY_BOUNDARY_EPSILON: a measurement sitting exactly on a boundary
// (e.g. 3.85 - 3.75) lands a few ULPs past it after the subtraction. The epsilon
// absorbs only that artifact — it is many orders of magnitude below the real
// precision of either unit (hundredths of a second, hundredths of a m/s), so it
// can never reclassify two genuinely different values. Deviations are compared
// RAW; values are never rounded before comparison.
const CATEGORY_BOUNDARY_EPSILON = 1e-9;

/**
 * Categorizes one measurement's SIGNED deviation (measured minus target) against a
 * per-side tolerance. A negative deviation (measured below target) is judged
 * against the `lower` sides, a positive one against the `upper` sides; a deviation
 * of exactly 0 is On Target under either. Boundaries are inclusive for the inner
 * category, so the three categories are mutually exclusive and total:
 *
 *   on_target:  |deviation| <= onTarget[side]
 *   acceptable: onTarget[side] < |deviation| <= acceptable[side]
 *   major_miss: |deviation| > acceptable[side]
 *
 * This is the fachlicher "Major Miss" definition, distinct from a statistical
 * boxplot outlier (see src/lib/boxPlotStatistics.ts).
 */
export function categorizeDeviation(
  signedDeviation: number,
  tolerance: QuantityTolerance
): TargetErrorCategory {
  const side = signedDeviation < 0 ? "lower" : "upper";
  const magnitude = Math.abs(signedDeviation);

  if (magnitude <= tolerance.onTarget[side] + CATEGORY_BOUNDARY_EPSILON) {
    return "on_target";
  }
  if (magnitude <= tolerance.acceptable[side] + CATEGORY_BOUNDARY_EPSILON) {
    return "acceptable";
  }
  return "major_miss";
}

/** A target or measured value must be a finite, positive number in its own unit. */
export function isValidQuantityValue(value: unknown): value is number {
  return isPositiveFinite(value);
}
