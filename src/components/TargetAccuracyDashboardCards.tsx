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
  /**
   * "full" (default, unchanged): all seven cards together, for contexts
   * where review density is appropriate (outgoing Block Summary, History).
   *
   * "hero": only the four Level-1 "what happened" facts
   * (docs/COACHING_PRINCIPLES.md's Coaching Hierarchy) — Average Error
   * dominates as the single KPI the eye goes to first, with Bias, On Target
   * and Major Misses as compact supporting context. For live execution,
   * where not every KPI should compete for attention at once
   * (docs/VISUAL_LANGUAGE.md's "Visual Weight").
   *
   * "supporting": the remaining three cards (Within Acceptable, Target
   * Error SD, Largest Miss), for a "hero" caller to place behind
   * progressive disclosure rather than dropping them.
   */
  variant?: "full" | "hero" | "supporting";
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
  variant = "full",
}: TargetAccuracyDashboardCardsProps) {
  if (targetAccuracy.shotCount === 0) {
    return variant === "supporting" ? null : (
      <DashboardCard label="Target Accuracy" value={NOT_ENOUGH_SHOTS} />
    );
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

  const bias = (
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
  );

  const onTarget = (
    <DashboardCard
      label="On Target"
      value={`${onTargetPercent}%`}
      sublabel={`within ±${thresholds.onTarget.toFixed(2)}s`}
      tone="highlight"
      explanation={onTargetExplanation(thresholds)}
    />
  );

  const majorMisses = (
    <DashboardCard
      label="Major Misses"
      value={`${targetAccuracy.majorMissCount} of ${targetAccuracy.shotCount}`}
      sublabel={`beyond ±${thresholds.acceptable.toFixed(2)}s`}
      tone="highlight"
      explanation={majorMissExplanation(thresholds)}
    />
  );

  const withinAcceptable = (
    <DashboardCard
      label="Within Acceptable"
      value={`${withinAcceptablePercent}%`}
      sublabel={`within ±${thresholds.acceptable.toFixed(2)}s`}
      explanation={acceptableExplanation(thresholds)}
    />
  );

  const targetErrorSd = (
    <DashboardCard
      label="Target Error SD"
      value={(targetAccuracy.targetErrorStandardDeviation ?? 0).toFixed(3)}
      explanation={consistencyExplanation()}
    />
  );

  const largestMiss = (
    <DashboardCard
      label="Largest Miss"
      value={
        targetAccuracy.largestAbsoluteMiss !== null
          ? `${targetAccuracy.largestAbsoluteMiss.toFixed(2)}s`
          : NOT_ENOUGH_SHOTS
      }
      explanation={largestMissExplanation()}
    />
  );

  if (variant === "supporting") {
    return (
      <>
        {withinAcceptable}
        {targetErrorSd}
        {largestMiss}
      </>
    );
  }

  if (variant === "hero") {
    return (
      <div className="space-y-3">
        <DashboardCard
          label="Average Error"
          value={`${(targetAccuracy.meanAbsoluteTargetError ?? 0).toFixed(2)}s`}
          tone="highlight"
          size="hero"
          explanation={averageErrorExplanation()}
        />

        <div className="grid grid-cols-3 gap-2">
          {bias}
          {onTarget}
          {majorMisses}
        </div>
      </div>
    );
  }

  return (
    <>
      {bias}
      <DashboardCard
        label="Average Error"
        value={`${(targetAccuracy.meanAbsoluteTargetError ?? 0).toFixed(2)}s`}
        tone="highlight"
        explanation={averageErrorExplanation()}
      />
      {onTarget}
      {majorMisses}
      {withinAcceptable}
      {targetErrorSd}
      {largestMiss}
    </>
  );
}
