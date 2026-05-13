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

export function standardDeviation(values: number[]): number {
  if (values.length === 0) return 0;

  const avg = average(values);
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) /
    values.length;

  return Math.sqrt(variance);
}

export function averageDeviationFromTarget(
  values: number[],
  target: number
): number {
  if (values.length === 0) return 0;

  return average(values.map((value) => value - target));
}

export function averageAbsoluteDeviationFromTarget(
  values: number[],
  target: number
): number {
  if (values.length === 0) return 0;

  return average(values.map((value) => Math.abs(value - target)));
}

export function getOutliers(values: number[]): number[] {
  if (values.length < 4) return [];

  const avg = average(values);
  const stdDev = standardDeviation(values);

  return values.filter((value) => Math.abs(value - avg) > 2 * stdDev);
}

export function analyzeShots(shots: Shot[], targetTime: number) {
  const releaseTimes = shots.map((shot) => shot.releaseTime);
  const inShots = shots.filter((shot) => shot.handle === "in");
  const outShots = shots.filter((shot) => shot.handle === "out");

  const inTimes = inShots.map((shot) => shot.releaseTime);
  const outTimes = outShots.map((shot) => shot.releaseTime);

  return {
    count: shots.length,
    average: average(releaseTimes),
    median: median(releaseTimes),
    min: releaseTimes.length > 0 ? Math.min(...releaseTimes) : 0,
    max: releaseTimes.length > 0 ? Math.max(...releaseTimes) : 0,
    standardDeviation: standardDeviation(releaseTimes),
    averageDeviationFromTarget: averageDeviationFromTarget(
      releaseTimes,
      targetTime
    ),
    averageAbsoluteDeviationFromTarget:
      averageAbsoluteDeviationFromTarget(releaseTimes, targetTime),
    outliers: getOutliers(releaseTimes),
    byHandle: {
      in: {
        count: inShots.length,
        average: average(inTimes),
        standardDeviation: standardDeviation(inTimes),
        averageAbsoluteDeviationFromTarget:
          averageAbsoluteDeviationFromTarget(inTimes, targetTime),
      },
      out: {
        count: outShots.length,
        average: average(outTimes),
        standardDeviation: standardDeviation(outTimes),
        averageAbsoluteDeviationFromTarget:
          averageAbsoluteDeviationFromTarget(outTimes, targetTime),
      },
    },
  };
}