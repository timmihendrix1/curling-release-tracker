import type { Shot } from "../types";

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

/** Each shot's signed error against its own recorded target. */
function targetErrors(shots: Shot[]): number[] {
  return shots.map((shot) => shot.releaseTime - shot.targetTime);
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

/**
 * Analyzes a set of shots against each shot's own `targetTime`. For Fixed
 * Weight blocks (where every shot shares the same target) this is
 * numerically identical to analyzing against a single block target. For
 * Variable/Blind Weight blocks, each shot is judged against the target that
 * actually applied to it.
 */
export function analyzeShots(shots: Shot[]) {
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
