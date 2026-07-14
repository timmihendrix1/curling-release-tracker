"use client";

import { interpretTargetErrorDirection } from "../lib/analytics";
import {
  acceptableExplanation,
  averageErrorExplanation,
  biasExplanation,
  consistencyExplanation,
  largestMissExplanation,
  majorMissExplanation,
  onTargetExplanation,
} from "../lib/analyticsExplanations";
import { formatSigned } from "../lib/timeInput";
import type {
  AccuracyThresholds,
  MeasurementMode,
} from "../types";
import type { TargetAccuracyAnalytics } from "../lib/analytics";
import DashboardCard from "./DashboardCard";

type TargetAccuracyDashboardCardsProps = {
  targetAccuracy: TargetAccuracyAnalytics;
  measurementMode: MeasurementMode;
  thresholds: AccuracyThresholds;
};

const NOT_ENOUGH_SHOTS = "Not enough shots";

/**
 * The shared "answers question 1-6" Target Accuracy metric set — reused by
 * the live Dashboard, the outgoing Block Summary, and History. Never
 * computes analytics itself; only formats a pre-computed
 * `TargetAccuracyAnalytics`. Bias and Average Error are always shown
 * separately (never conflated), and this is one of exactly two places (the
 * other being CSV export) allowed to read `thresholds` for display purposes.
 */
export default function TargetAccuracyDashboardCards({
  targetAccuracy,
  measurementMode,
  thresholds,
}: TargetAccuracyDashboardCardsProps) {
  if (targetAccuracy.shotCount === 0) {
    return <DashboardCard label="Target Accuracy" value={NOT_ENOUGH_SHOTS} />;
  }

  const biasDirection = interpretTargetErrorDirection(
    targetAccuracy.meanTargetError ?? 0,
    measurementMode
  );

  const onTargetPercent = Math.round((targetAccuracy.onTargetRate ?? 0) * 100);
  const withinAcceptablePercent = Math.round(
    ((targetAccuracy.onTargetRate ?? 0) + (targetAccuracy.acceptableRate ?? 0)) *
      100
  );

  return (
    <>
      <DashboardCard
        label="Bias"
        value={`${formatSigned(targetAccuracy.meanTargetError ?? 0, 2)}s`}
        sublabel={
          biasDirection.curlingTendencyLabel
            ? `Tendency: ${biasDirection.curlingTendencyLabel}`
            : biasDirection.relativeToTargetLabel
        }
        tone="highlight"
        explanation={biasExplanation(measurementMode)}
      />

      <DashboardCard
        label="Average Error"
        value={`${(targetAccuracy.meanAbsoluteTargetError ?? 0).toFixed(2)}s`}
        tone="highlight"
        explanation={averageErrorExplanation()}
      />

      <DashboardCard
        label="On Target"
        value={`${onTargetPercent}%`}
        sublabel={`within ±${thresholds.onTarget.toFixed(2)}s`}
        tone="highlight"
        explanation={onTargetExplanation(thresholds)}
      />

      <DashboardCard
        label="Major Misses"
        value={`${targetAccuracy.majorMissCount} of ${targetAccuracy.shotCount}`}
        sublabel={`beyond ±${thresholds.acceptable.toFixed(2)}s`}
        tone="highlight"
        explanation={majorMissExplanation(thresholds)}
      />

      <DashboardCard
        label="Within Acceptable"
        value={`${withinAcceptablePercent}%`}
        sublabel={`within ±${thresholds.acceptable.toFixed(2)}s`}
        explanation={acceptableExplanation(thresholds)}
      />

      <DashboardCard
        label="Target Error SD"
        value={(targetAccuracy.targetErrorStandardDeviation ?? 0).toFixed(3)}
        explanation={consistencyExplanation()}
      />

      <DashboardCard
        label="Largest Miss"
        value={
          targetAccuracy.largestAbsoluteMiss !== null
            ? `${targetAccuracy.largestAbsoluteMiss.toFixed(2)}s`
            : NOT_ENOUGH_SHOTS
        }
        explanation={largestMissExplanation()}
      />
    </>
  );
}
