import type {
  AccuracyThresholds,
  MeasuredQuantity,
  MeasurementMode,
  QuantityTolerance,
  Shot,
} from "../types";
import { LEGACY_ACCURACY_THRESHOLDS } from "./accuracyThresholds";
import { computeBoxPlotStatistics, type BoxPlotStatistics } from "./boxPlotStatistics";
import {
  shotDeviation,
  timeMeasuredShots,
  type TimeMeasuredShot,
} from "./measurement/quantities";
import {
  asQuantityTolerance,
  categorizeDeviation,
} from "./measurement/tolerance";
import { formatSigned } from "./timeInput";

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

/** Standard deviation of a plain list of numbers — no target involved. */
export function standardDeviationOfValues(values: number[]): number {
  if (values.length === 0) return 0;

  const avg = average(values);
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) /
    values.length;

  return Math.sqrt(variance);
}

/**
 * A single shot's signed error against its own recorded target
 * (`releaseTime - targetTime`) — the one formula every Target Error
 * consumer (analytics, charts, export) must use, never re-derived locally.
 *
 * Takes a `TimeMeasuredShot`, so a stone that carries no time simply cannot be
 * passed in. Callers select their input with `timeMeasuredShots` (see
 * src/lib/measurement/quantities.ts) rather than reading `releaseTime` directly.
 */
export function targetErrorForShot(shot: TimeMeasuredShot): number {
  return shot.releaseTime - shot.targetTime;
}

/**
 * Each TIME-measured shot's signed error against its own recorded target. Stones
 * without a time measurement are excluded from the series entirely — never
 * contributed as a fabricated 0.0s, which would both invent a measurement and
 * distort every statistic computed from it.
 */
function targetErrors(shots: Shot[]): number[] {
  return timeMeasuredShots(shots).map(targetErrorForShot);
}

/** Standard deviation of the measured release times themselves. */
export function releaseTimeStandardDeviation(shots: Shot[]): number {
  return standardDeviationOfValues(
    timeMeasuredShots(shots).map((shot) => shot.releaseTime)
  );
}

/** Standard deviation of each shot's deviation from its own target. */
export function targetErrorStandardDeviation(shots: Shot[]): number {
  return standardDeviationOfValues(targetErrors(shots));
}

export function averageDeviationFromTarget(shots: Shot[]): number {
  return average(targetErrors(shots));
}

export function averageAbsoluteDeviationFromTarget(shots: Shot[]): number {
  return average(targetErrors(shots).map((error) => Math.abs(error)));
}

export function getOutliers(values: number[]): number[] {
  if (values.length < 4) return [];

  const avg = average(values);
  const stdDev = standardDeviationOfValues(values);

  return values.filter((value) => Math.abs(value - avg) > 2 * stdDev);
}

// --- Blind Weight: prediction (perception) metrics ---------------------
//
// These are a second, independent lens from the target-error metrics above:
// target error asks "how well did the shot hit the target?", prediction
// error asks "how well did the player know what they'd just done?". Only
// shots with a defined predictedTime participate — Fixed/Variable Weight
// shots never have one and must never be treated as a prediction error of 0.

function shotsWithPrediction(
  shots: Shot[]
): (TimeMeasuredShot & { predictedTime: number })[] {
  return timeMeasuredShots(shots).filter(
    (shot): shot is TimeMeasuredShot & { predictedTime: number } =>
      shot.predictedTime !== undefined
  );
}

/** positive: the player believed they played slower than they actually did. */
export function predictionErrors(shots: Shot[]): number[] {
  return shotsWithPrediction(shots).map(
    (shot) => shot.predictedTime - shot.releaseTime
  );
}

/** Signed average prediction error — the systematic perception bias. */
export function meanPredictionError(shots: Shot[]): number | null {
  const errors = predictionErrors(shots);
  if (errors.length === 0) return null;
  return average(errors);
}

/** Average magnitude of prediction error — overall self-assessment accuracy. */
export function meanAbsolutePredictionError(shots: Shot[]): number | null {
  const errors = predictionErrors(shots);
  if (errors.length === 0) return null;
  return average(errors.map((error) => Math.abs(error)));
}

/** Spread of prediction error — how consistent the self-assessment is. */
export function predictionErrorStandardDeviation(shots: Shot[]): number | null {
  const errors = predictionErrors(shots);
  if (errors.length === 0) return null;
  return standardDeviationOfValues(errors);
}

/**
 * Pearson correlation coefficient between two equal-length series. Returns
 * null (never NaN/Infinity) when there are fewer than 2 points, or when
 * either series is constant (division by zero would otherwise occur).
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 2) return null;

  const meanX = average(xs);
  const meanY = average(ys);

  let numerator = 0;
  let sumSquaredX = 0;
  let sumSquaredY = 0;

  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    sumSquaredX += dx * dx;
    sumSquaredY += dy * dy;
  }

  const denominator = Math.sqrt(sumSquaredX * sumSquaredY);
  if (denominator === 0) return null;

  const correlation = numerator / denominator;
  return Number.isFinite(correlation) ? correlation : null;
}

/**
 * Correlation between predicted and actual release times. A high value
 * alone does NOT mean accurate self-assessment — a player who is always
 * confidently wrong by the same amount can still correlate well. Always
 * show this alongside the bias/absolute-error/spread metrics above, never
 * in isolation.
 */
export function predictionCorrelation(shots: Shot[]): number | null {
  const predicted = shotsWithPrediction(shots);
  if (predicted.length < 2) return null;

  return pearsonCorrelation(
    predicted.map((shot) => shot.predictedTime),
    predicted.map((shot) => shot.releaseTime)
  );
}

// --- Target Accuracy: thresholds, direction semantics, boxplots, handle comparison
//
// A second, independent lens from the plain release-time statistics above:
// "how well did the shot hit the target the player/coach actually chose?",
// judged against a per-block AccuracyThresholds snapshot (never the app's
// current default — see src/lib/accuracyThresholds.ts). Applies to every
// training mode, including Blind Weight (where it is distinct from, and
// never mixed with, Prediction Accuracy).

export type TargetErrorDirectionInterpretation = {
  /**
   * The mathematical/measured comparison only: negative means a lower
   * measured release time than target ("faster"), positive means higher
   * ("slower"). Never itself a curling judgement.
   */
  sign: "faster" | "slower" | "on-target";
  /** Neutral, measurement-mode-independent label, safe to show always. */
  relativeToTargetLabel: string;
  /**
   * Curling-specific tendency implied by the sign — defined **only** for
   * Back-Hog, where a lower release time is documented (see
   * docs/DOMAIN_GLOSSARY.md) as unambiguously "more weight" and therefore a
   * tendency to travel long. Hog-Hog has no documented, validated
   * curling-outcome mapping for its sign; inventing one would be exactly the
   * "looks real but isn't" fabrication this project's principles forbid, so
   * it stays undefined and only the neutral fields above should ever be
   * shown for Hog-Hog.
   */
  curlingTendency?: "more-weight-long" | "less-weight-short";
  curlingTendencyLabel?: string;
};

export function interpretTargetErrorDirection(
  targetError: number,
  measurementMode: MeasurementMode | undefined
): TargetErrorDirectionInterpretation {
  const sign: TargetErrorDirectionInterpretation["sign"] =
    targetError < 0 ? "faster" : targetError > 0 ? "slower" : "on-target";

  const relativeToTargetLabel =
    sign === "on-target"
      ? "on target"
      : `${formatSigned(targetError, 2)}s relative to target`;

  if (measurementMode !== "back-hog" || sign === "on-target") {
    return { sign, relativeToTargetLabel };
  }

  return sign === "faster"
    ? {
        sign,
        relativeToTargetLabel,
        curlingTendency: "more-weight-long",
        curlingTendencyLabel: "more weight / too long",
      }
    : {
        sign,
        relativeToTargetLabel,
        curlingTendency: "less-weight-short",
        curlingTendencyLabel: "less weight / too short",
      };
}

export type TargetAccuracyAnalytics = {
  shotCount: number;
  meanTargetError: number | null;
  meanAbsoluteTargetError: number | null;
  targetErrorStandardDeviation: number | null;
  onTargetCount: number;
  onTargetRate: number | null;
  acceptableCount: number;
  acceptableRate: number | null;
  majorMissCount: number;
  majorMissRate: number | null;
  largestAbsoluteMiss: number | null;
  averageMajorMiss: number | null;
  positiveMajorMissCount: number;
  negativeMajorMissCount: number;
};

const EMPTY_TARGET_ACCURACY: TargetAccuracyAnalytics = {
  shotCount: 0,
  meanTargetError: null,
  meanAbsoluteTargetError: null,
  targetErrorStandardDeviation: null,
  onTargetCount: 0,
  onTargetRate: null,
  acceptableCount: 0,
  acceptableRate: null,
  majorMissCount: 0,
  majorMissRate: null,
  largestAbsoluteMiss: null,
  averageMajorMiss: null,
  positiveMajorMissCount: 0,
  negativeMajorMissCount: 0,
};

/**
 * The unit-agnostic core of Target Accuracy: given a list of SIGNED deviations
 * (measured minus target, in that quantity's own unit) and the per-side tolerance
 * they are judged against, produce the full accuracy breakdown.
 *
 * Every deviation passed in must already come from a stone that genuinely carries
 * that measurement — selection happens before this, so a missing value can never
 * reach the denominator. Seconds and m/s deviations must never be mixed in one
 * call; the two quantities are analysed independently, always.
 */
export function computeDeviationAccuracyAnalytics(
  deviations: number[],
  tolerance: QuantityTolerance
): TargetAccuracyAnalytics {
  if (deviations.length === 0) return EMPTY_TARGET_ACCURACY;

  const errors = deviations;
  const absoluteErrors = errors.map((error) => Math.abs(error));
  const categories = errors.map((error) => categorizeDeviation(error, tolerance));
  const count = errors.length;

  const onTargetCount = categories.filter((c) => c === "on_target").length;
  const acceptableCount = categories.filter((c) => c === "acceptable").length;
  const majorMissCount = categories.filter((c) => c === "major_miss").length;

  const majorMissErrors = errors.filter(
    (_, index) => categories[index] === "major_miss"
  );

  return {
    shotCount: count,
    meanTargetError: average(errors),
    meanAbsoluteTargetError: average(absoluteErrors),
    targetErrorStandardDeviation: standardDeviationOfValues(errors),
    onTargetCount,
    onTargetRate: onTargetCount / count,
    acceptableCount,
    acceptableRate: acceptableCount / count,
    majorMissCount,
    majorMissRate: majorMissCount / count,
    largestAbsoluteMiss: Math.max(...absoluteErrors),
    averageMajorMiss:
      majorMissCount > 0
        ? average(majorMissErrors.map((error) => Math.abs(error)))
        : null,
    positiveMajorMissCount: majorMissErrors.filter((error) => error > 0).length,
    negativeMajorMissCount: majorMissErrors.filter((error) => error < 0).length,
  };
}

/**
 * Target Accuracy for ONE measured quantity across a set of stones. Only the
 * stones that actually carry that quantity take part, so each quantity has its own
 * independent denominator — a Both stone missing its speed still counts fully
 * towards time and simply does not appear in the speed figures.
 */
export function computeQuantityAccuracyAnalytics(
  shots: Shot[],
  quantity: MeasuredQuantity,
  tolerance: QuantityTolerance
): TargetAccuracyAnalytics {
  const deviations = shots
    .map((shot) => shotDeviation(shot, quantity))
    .filter((deviation): deviation is number => deviation !== null);

  return computeDeviationAccuracyAnalytics(deviations, tolerance);
}

/**
 * The central Target Accuracy analysis for TIME. Bias (`meanTargetError`) and
 * magnitude (`meanAbsoluteTargetError`) are deliberately separate fields —
 * never conflate a systematic bias with the average size of the error.
 * `onTargetCount`/`acceptableCount`/`majorMissCount` are mutually exclusive
 * categories; a "within acceptable overall" rate is
 * `onTargetRate + acceptableRate` (equivalently `1 - majorMissRate`), computed by
 * callers rather than duplicated as its own field.
 *
 * `shotCount` is the number of TIME-measured stones, which is the correct
 * denominator for every rate here — a stone carrying only a speed is not a stone
 * this analysis can say anything about. Takes the historical symmetric seconds
 * pair, whose meaning is unchanged; callers holding a block with an asymmetric
 * tolerance use `computeQuantityAccuracyAnalytics` instead.
 */
export function computeTargetAccuracyAnalytics(
  shots: Shot[],
  // Accepts the block's own per-side tolerance OR the historical symmetric pair, so a
  // caller holding an asymmetric tolerance passes it through rather than flattening
  // it. Flattening is what let one stone read as On Target here and Major Miss in
  // history aggregation.
  thresholds: AccuracyThresholds | QuantityTolerance = LEGACY_ACCURACY_THRESHOLDS
): TargetAccuracyAnalytics {
  return computeDeviationAccuracyAnalytics(
    targetErrors(shots),
    asQuantityTolerance(thresholds)
  );
}

export type HandleAccuracyComparison = {
  inHandle: TargetAccuracyAnalytics;
  outHandle: TargetAccuracyAnalytics;
};

/**
 * Groups shots by handle before computing Target Accuracy per group. Assumes
 * the caller already applied any active filters (handle/shot-type/block/
 * session/measurement-mode) and already excludes a different Measurement
 * Mode's shots — grouping never happens before filtering.
 */
export function computeHandleAccuracyComparison(
  shots: Shot[],
  thresholds: AccuracyThresholds | QuantityTolerance = LEGACY_ACCURACY_THRESHOLDS
): HandleAccuracyComparison {
  return {
    inHandle: computeTargetAccuracyAnalytics(
      shots.filter((shot) => shot.handle === "in"),
      thresholds
    ),
    outHandle: computeTargetAccuracyAnalytics(
      shots.filter((shot) => shot.handle === "out"),
      thresholds
    ),
  };
}

export type HandleTargetErrorBoxPlots = {
  inHandle: BoxPlotStatistics;
  outHandle: BoxPlotStatistics;
};

/** Boxplot statistics of Target Error (never raw Release Time), grouped by handle. */
export function computeHandleTargetErrorBoxPlots(
  shots: Shot[]
): HandleTargetErrorBoxPlots {
  return {
    inHandle: computeBoxPlotStatistics(
      targetErrors(shots.filter((shot) => shot.handle === "in"))
    ),
    outHandle: computeBoxPlotStatistics(
      targetErrors(shots.filter((shot) => shot.handle === "out"))
    ),
  };
}

/**
 * Analyzes a set of shots against each shot's own `targetTime`. For Fixed
 * Weight blocks (where every shot shares the same target) this is
 * numerically identical to analyzing against a single block target. For
 * Variable/Blind Weight blocks, each shot is judged against the target that
 * actually applied to it.
 *
 * `thresholds` defaults to the legacy/standard AccuracyThresholds so every
 * pre-existing call site (which has no thresholds to pass) keeps working
 * unchanged; new call sites should pass
 * `resolveAccuracyThresholds(block.accuracyThresholds)`.
 */
export function analyzeShots(
  shots: Shot[],
  thresholds: AccuracyThresholds | QuantityTolerance = LEGACY_ACCURACY_THRESHOLDS
) {
  // Every figure below is a TIME figure, so the analysed set — and therefore
  // `count`, which is the denominator the UI shows alongside them — is the
  // time-measured subset. A stone recording only a speed is not partially
  // counted here and is never counted as a 0.0s release.
  const timeShots = timeMeasuredShots(shots);
  const releaseTimes = timeShots.map((shot) => shot.releaseTime);
  const inShots = timeShots.filter((shot) => shot.handle === "in");
  const outShots = timeShots.filter((shot) => shot.handle === "out");

  return {
    count: timeShots.length,
    average: average(releaseTimes),
    median: median(releaseTimes),
    min: releaseTimes.length > 0 ? Math.min(...releaseTimes) : 0,
    max: releaseTimes.length > 0 ? Math.max(...releaseTimes) : 0,
    releaseTimeStandardDeviation: releaseTimeStandardDeviation(shots),
    targetErrorStandardDeviation: targetErrorStandardDeviation(shots),
    averageDeviationFromTarget: averageDeviationFromTarget(shots),
    averageAbsoluteDeviationFromTarget: averageAbsoluteDeviationFromTarget(shots),
    outliers: getOutliers(releaseTimes),
    targetAccuracy: computeTargetAccuracyAnalytics(timeShots, thresholds),
    handleAccuracy: computeHandleAccuracyComparison(timeShots, thresholds),
    targetErrorBoxPlot: computeBoxPlotStatistics(targetErrors(timeShots)),
    handleTargetErrorBoxPlots: computeHandleTargetErrorBoxPlots(timeShots),
    byHandle: {
      in: {
        count: inShots.length,
        average: average(inShots.map((shot) => shot.releaseTime)),
        releaseTimeStandardDeviation: releaseTimeStandardDeviation(inShots),
        averageAbsoluteDeviationFromTarget:
          averageAbsoluteDeviationFromTarget(inShots),
      },
      out: {
        count: outShots.length,
        average: average(outShots.map((shot) => shot.releaseTime)),
        releaseTimeStandardDeviation: releaseTimeStandardDeviation(outShots),
        averageAbsoluteDeviationFromTarget:
          averageAbsoluteDeviationFromTarget(outShots),
      },
    },
    prediction: {
      count: shotsWithPrediction(timeShots).length,
      meanError: meanPredictionError(timeShots),
      meanAbsoluteError: meanAbsolutePredictionError(timeShots),
      errorStandardDeviation: predictionErrorStandardDeviation(timeShots),
      correlation: predictionCorrelation(timeShots),
    },
  };
}
