import type { AccuracyThresholds, MeasurementMode, Shot } from "../types";
import {
  categorizeTargetError,
  LEGACY_ACCURACY_THRESHOLDS,
} from "./accuracyThresholds";
import { computeBoxPlotStatistics, type BoxPlotStatistics } from "./boxPlotStatistics";
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
 */
export function targetErrorForShot(shot: Shot): number {
  return shot.releaseTime - shot.targetTime;
}

/** Each shot's signed error against its own recorded target. */
function targetErrors(shots: Shot[]): number[] {
  return shots.map(targetErrorForShot);
}

/** Standard deviation of the measured release times themselves. */
export function releaseTimeStandardDeviation(shots: Shot[]): number {
  return standardDeviationOfValues(shots.map((shot) => shot.releaseTime));
}

/** Standard deviation of each shot's deviation from its own target. */
export function targetErrorStandardDeviation(shots: Shot[]): number {
  return standardDeviationOfValues(targetErrors(shots));
}

export function averageDeviationFromTarget(shots: Shot[]): number {
  if (shots.length === 0) return 0;
  return average(targetErrors(shots));
}

export function averageAbsoluteDeviationFromTarget(shots: Shot[]): number {
  if (shots.length === 0) return 0;
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
): (Shot & { predictedTime: number })[] {
  return shots.filter(
    (shot): shot is Shot & { predictedTime: number } =>
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
  measurementMode: MeasurementMode
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
 * The central Target Accuracy analysis. Bias (`meanTargetError`) and
 * magnitude (`meanAbsoluteTargetError`) are deliberately separate fields —
 * never conflate a systematic bias with the average size of the error.
 * `onTargetCount`/`acceptableCount`/`majorMissCount` are mutually exclusive
 * categories (see `categorizeTargetError`); a "within acceptable overall"
 * rate is `onTargetRate + acceptableRate` (equivalently `1 - majorMissRate`),
 * computed by callers rather than duplicated as its own field.
 */
export function computeTargetAccuracyAnalytics(
  shots: Shot[],
  thresholds: AccuracyThresholds = LEGACY_ACCURACY_THRESHOLDS
): TargetAccuracyAnalytics {
  if (shots.length === 0) return EMPTY_TARGET_ACCURACY;

  const errors = targetErrors(shots);
  const absoluteErrors = errors.map((error) => Math.abs(error));
  const categories = absoluteErrors.map((absError) =>
    categorizeTargetError(absError, thresholds)
  );

  const onTargetCount = categories.filter((c) => c === "on_target").length;
  const acceptableCount = categories.filter((c) => c === "acceptable").length;
  const majorMissCount = categories.filter((c) => c === "major_miss").length;

  const majorMissErrors = errors.filter(
    (_, index) => categories[index] === "major_miss"
  );

  return {
    shotCount: shots.length,
    meanTargetError: average(errors),
    meanAbsoluteTargetError: average(absoluteErrors),
    targetErrorStandardDeviation: standardDeviationOfValues(errors),
    onTargetCount,
    onTargetRate: onTargetCount / shots.length,
    acceptableCount,
    acceptableRate: acceptableCount / shots.length,
    majorMissCount,
    majorMissRate: majorMissCount / shots.length,
    largestAbsoluteMiss: Math.max(...absoluteErrors),
    averageMajorMiss:
      majorMissCount > 0
        ? average(majorMissErrors.map((error) => Math.abs(error)))
        : null,
    positiveMajorMissCount: majorMissErrors.filter((error) => error > 0).length,
    negativeMajorMissCount: majorMissErrors.filter((error) => error < 0).length,
  };
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
  thresholds: AccuracyThresholds = LEGACY_ACCURACY_THRESHOLDS
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
  thresholds: AccuracyThresholds = LEGACY_ACCURACY_THRESHOLDS
) {
  const releaseTimes = shots.map((shot) => shot.releaseTime);
  const inShots = shots.filter((shot) => shot.handle === "in");
  const outShots = shots.filter((shot) => shot.handle === "out");

  return {
    count: shots.length,
    average: average(releaseTimes),
    median: median(releaseTimes),
    min: releaseTimes.length > 0 ? Math.min(...releaseTimes) : 0,
    max: releaseTimes.length > 0 ? Math.max(...releaseTimes) : 0,
    releaseTimeStandardDeviation: releaseTimeStandardDeviation(shots),
    targetErrorStandardDeviation: targetErrorStandardDeviation(shots),
    averageDeviationFromTarget: averageDeviationFromTarget(shots),
    averageAbsoluteDeviationFromTarget: averageAbsoluteDeviationFromTarget(shots),
    outliers: getOutliers(releaseTimes),
    targetAccuracy: computeTargetAccuracyAnalytics(shots, thresholds),
    handleAccuracy: computeHandleAccuracyComparison(shots, thresholds),
    targetErrorBoxPlot: computeBoxPlotStatistics(targetErrors(shots)),
    handleTargetErrorBoxPlots: computeHandleTargetErrorBoxPlots(shots),
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
      count: shotsWithPrediction(shots).length,
      meanError: meanPredictionError(shots),
      meanAbsoluteError: meanAbsolutePredictionError(shots),
      errorStandardDeviation: predictionErrorStandardDeviation(shots),
      correlation: predictionCorrelation(shots),
    },
  };
}
