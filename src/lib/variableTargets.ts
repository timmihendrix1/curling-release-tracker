// Smart Random target generation for Variable Weight blocks.
//
// The target range is configured per TrainingBlock (see
// TrainingBlock.smartRandomMin/smartRandomMax in ../types), not as a single
// global or profile-based range — the user picks the weight range they want
// to train (guard-ish slow draws, mixed draws, takeout weights, the full
// Back-Hog range, ...) at block setup time.
//
// Back-Hog and Hog-Hog measure physically different things (release-to-hog
// distance vs. full hog-to-hog distance) and must never share a target
// range or be confused with one another — see isSmartRandomAvailable.
import type { MeasurementMode } from "../types";

export type SmartRandomRange = {
  min: number;
  max: number;
};

// Default range for newly created Back-Hog Smart Random blocks. The user is
// free to change this at setup time; these are only the form's starting
// values.
export const DEFAULT_SMART_RANDOM_MIN = 2.5;
export const DEFAULT_SMART_RANDOM_MAX = 4.5;

// Not user-configurable — matches the app's existing two-decimal time
// precision and prior Smart Random behavior.
export const SMART_RANDOM_STEP = 0.05;

export const MIN_SMART_RANDOM_RANGE_WIDTH = 0.1;

// How many of the most recent targets must not be exactly repeated.
const NORMAL_REPEAT_AVOIDANCE_MEMORY = 2;
const LARGE_JUMP_REPEAT_AVOIDANCE_MEMORY = 1;

// Most consecutive-shot transitions should be a realistic, similar target
// rather than swinging across the whole range (e.g. 4.45 -> 2.50 -> 4.35).
export const TYPICAL_MAX_DELTA = 0.4;
export const LARGE_JUMP_PROBABILITY = 0.15;

const TIME_PRECISION = 100; // round to 2 decimal places, e.g. 3.75

function roundTime(value: number): number {
  return Math.round(value * TIME_PRECISION) / TIME_PRECISION;
}

function snapToStep(value: number, step: number = SMART_RANDOM_STEP): number {
  return roundTime(Math.round(value / step) * step);
}

/**
 * Hog-Hog has no validated Smart Random target range anywhere in this
 * project (mock data, prior defaults, or product history) — inventing one,
 * or reusing the Back-Hog range, would recreate the exact bug this profile
 * model was built to avoid. Coach / Manual remains the only option for
 * Hog-Hog until real values are supplied.
 */
export function isSmartRandomAvailable(measurementMode: MeasurementMode): boolean {
  return measurementMode === "back-hog";
}

export type SmartRandomRangeValidation =
  | { valid: true; min: number; max: number }
  | { valid: false; error: string };

/**
 * Validates and normalizes a user-entered Smart Random range. Pure and
 * side-effect free. Normalizes both bounds to the nearest SMART_RANDOM_STEP
 * multiple — re-validated *after* snapping, since snapping can (rarely)
 * narrow a range that was only just wide enough.
 */
export function validateSmartRandomRange(
  min: number,
  max: number
): SmartRandomRangeValidation {
  if (!Number.isFinite(min)) {
    return { valid: false, error: "Minimum target time must be a valid number." };
  }

  if (!Number.isFinite(max)) {
    return { valid: false, error: "Maximum target time must be a valid number." };
  }

  if (min <= 0) {
    return { valid: false, error: "Minimum target time must be greater than 0." };
  }

  if (max <= min) {
    return {
      valid: false,
      error: "Maximum target time must be greater than the minimum.",
    };
  }

  const normalizedMin = snapToStep(min);
  const normalizedMax = snapToStep(max);

  if (normalizedMin <= 0) {
    return { valid: false, error: "Minimum target time must be greater than 0." };
  }

  if (roundTime(normalizedMax - normalizedMin) < MIN_SMART_RANDOM_RANGE_WIDTH) {
    return {
      valid: false,
      error: `The range must be at least ${MIN_SMART_RANDOM_RANGE_WIDTH.toFixed(2)}s wide.`,
    };
  }

  return { valid: true, min: normalizedMin, max: normalizedMax };
}

export function buildSmartRandomCandidates(range: SmartRandomRange): number[] {
  const steps = Math.round((range.max - range.min) / SMART_RANDOM_STEP);
  const candidates: number[] = [];

  for (let i = 0; i <= steps; i++) {
    candidates.push(roundTime(range.min + i * SMART_RANDOM_STEP));
  }

  return candidates;
}

export type GenerateSmartRandomTargetInput = {
  min: number;
  max: number;
  /** The block's own most recent shot.targetTime values, oldest first. */
  recentTargets?: number[];
  randomFn?: () => number;
};

/**
 * Generates the next Smart Random target time within [min, max].
 *
 * Pure function: given the same inputs and random source, it always returns
 * the same result. Calls randomFn once to decide typical-vs-large-jump (only
 * when a previous target exists) and once to pick within the resulting
 * candidate pool — always exactly 1 or 2 calls, so it can never hang or loop
 * unboundedly.
 *
 * - Always returns a value within [min, max], aligned to SMART_RANDOM_STEP.
 * - With no prior target (first shot of the block), any value in the full
 *   range is fair game — there's nothing yet to stay close to.
 * - Otherwise, ~ (1 - LARGE_JUMP_PROBABILITY) of the time the next target
 *   stays within TYPICAL_MAX_DELTA of the last one (or the whole range, if
 *   the range itself is narrower than that); the rest of the time it may
 *   come from anywhere in the range, to train genuine adaptability.
 * - Avoids repeating the most recent target(s) either way, falling back to
 *   a wider candidate pool in a fixed number of controlled steps — never an
 *   unbounded search — if avoidance would otherwise leave nothing to pick.
 */
export function generateSmartRandomTarget({
  min,
  max,
  recentTargets = [],
  randomFn = Math.random,
}: GenerateSmartRandomTargetInput): number {
  const range = { min, max };
  const candidates = buildSmartRandomCandidates(range);
  const lastTarget = recentTargets.at(-1);

  let pool: number[];
  let repeatAvoidanceMemory: number;

  if (lastTarget === undefined) {
    // No previous target for this block yet — the entire range is valid.
    pool = candidates;
    repeatAvoidanceMemory = 0;
  } else {
    const rangeWidth = range.max - range.min;
    const effectiveDelta = Math.min(TYPICAL_MAX_DELTA, rangeWidth);
    const isLargeJump = randomFn() < LARGE_JUMP_PROBABILITY;

    if (isLargeJump) {
      pool = candidates;
      repeatAvoidanceMemory = LARGE_JUMP_REPEAT_AVOIDANCE_MEMORY;
    } else {
      pool = candidates.filter(
        (candidate) => Math.abs(candidate - lastTarget) <= effectiveDelta
      );
      repeatAvoidanceMemory = NORMAL_REPEAT_AVOIDANCE_MEMORY;

      // Controlled widening: a narrow delta window near an edge of the
      // range can come up empty — fall back to the full range rather than
      // searching further.
      if (pool.length === 0) {
        pool = candidates;
      }
    }
  }

  // slice(-0) would return the whole array (-0 isn't < 0), so guard the
  // zero case explicitly instead of relying on it happening to line up with
  // an always-empty recentTargets in that branch.
  const avoid = new Set(
    (repeatAvoidanceMemory > 0 ? recentTargets.slice(-repeatAvoidanceMemory) : []).map(
      roundTime
    )
  );

  const filteredPool = pool.filter((candidate) => !avoid.has(candidate));
  const effectivePool = filteredPool.length > 0 ? filteredPool : pool;

  const index = Math.min(
    Math.floor(randomFn() * effectivePool.length),
    effectivePool.length - 1
  );

  return effectivePool[index];
}
