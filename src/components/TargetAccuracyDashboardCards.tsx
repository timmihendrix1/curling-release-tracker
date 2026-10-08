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
  MeasuredQuantity,
  MeasurementMode,
  QuantityTolerance,
} from "../types";
import type { TargetAccuracyAnalytics } from "../lib/analytics";
import DashboardCard from "./DashboardCard";
import {
  asQuantityTolerance,
  quantityUnitLabel,
  toleranceBandLabel,
} from "../lib/measurement/tolerance";

type TargetAccuracyDashboardCardsProps = {
  targetAccuracy: TargetAccuracyAnalytics;
  /** Absent when the block measures no time, so no timing-interval note applies. */
  measurementMode?: MeasurementMode;
  /**
   * The tolerance the figures above were ACTUALLY judged against — either the
   * historical symmetric pair or a block's own per-side tolerance. Labels are derived
   * from it, so a displayed cutoff can never contradict a displayed classification.
   */
  thresholds: AccuracyThresholds | QuantityTolerance | null;
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
  /**
   * Which measured quantity these figures describe. Decides the unit on every value
   * and band label, so a speed figure can never be presented in seconds. Defaults to
   * "time", which is what every pre-existing caller means.
   *
   * The two quantities are always rendered by SEPARATE instances of this component —
   * there is no combined mode, because an average of seconds and metres per second is
   * not a quantity (ADR-0051).
   */
  quantity?: MeasuredQuantity;
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
/** Shown instead of a cutoff when the selection's blocks used different tolerances. */
const VARYING_TOLERANCE_SUBLABEL = "tolerances vary across selection";

export default function TargetAccuracyDashboardCards({
  targetAccuracy,
  measurementMode,
  thresholds,
  variant = "full",
  quantity = "time",
}: TargetAccuracyDashboardCardsProps) {
  const unit = quantityUnitLabel(quantity);
  // A bare suffix for a seconds value ("0.08s"), a spaced one for m/s ("0.08 m/s") —
  // matching src/lib/measurement/format.ts, so the two never drift apart.
  const unitSuffix = quantity === "speed" ? ` ${unit}` : unit;
  if (targetAccuracy.shotCount === 0) {
    return variant === "supporting" ? null : (
      <DashboardCard label="Target Accuracy" value={NOT_ENOUGH_SHOTS} />
    );
  }

  // Derived once from whatever representation the caller supplied, so every label on
  // these cards names the same cutoffs the classification used.
  //
  // `null` means the selection's blocks were judged against DIFFERENT tolerances. No
  // single cutoff is true of all of them, so none is named — printing one would imply
  // a shared band that does not exist.
  const tolerance = thresholds ? asQuantityTolerance(thresholds) : null;
  const bands = tolerance
    ? {
        onTarget: toleranceBandLabel(tolerance.onTarget, quantity),
        acceptable: toleranceBandLabel(tolerance.acceptable, quantity),
      }
    : null;

  // The curling tendency ("more weight / too long") is defined only for a Back-Hog
  // TIME reading (see interpretTargetErrorDirection). A speed bias has no documented,
  // validated curling-outcome mapping in this project, so the measurement mode is
  // deliberately NOT forwarded for speed: inventing a tendency from it would be
  // exactly the looks-real-but-isn't fabrication the product principles forbid.
  const biasDirection = interpretTargetErrorDirection(
    targetAccuracy.meanTargetError ?? 0,
    quantity === "speed" ? undefined : measurementMode
  );

  // Its neutral label names seconds, which is wrong for m/s — rebuilt here in the
  // quantity's own unit rather than shown with the other one's.
  const relativeToTargetLabel =
    quantity === "speed"
      ? biasDirection.sign === "on-target"
        ? "on target"
        : `${formatSigned(targetAccuracy.meanTargetError ?? 0, 2)} m/s relative to target`
      : biasDirection.relativeToTargetLabel;

  const onTargetPercent = Math.round((targetAccuracy.onTargetRate ?? 0) * 100);
  const withinAcceptablePercent = Math.round(
    ((targetAccuracy.onTargetRate ?? 0) + (targetAccuracy.acceptableRate ?? 0)) *
      100
  );

  const bias = (
    <DashboardCard
      label="Bias"
      value={`${formatSigned(targetAccuracy.meanTargetError ?? 0, 2)}${unitSuffix}`}
      sublabel={
        biasDirection.curlingTendencyLabel
          ? `Tendency: ${biasDirection.curlingTendencyLabel}`
          : relativeToTargetLabel
      }
      tone="highlight"
      explanation={biasExplanation(measurementMode)}
    />
  );

  const onTarget = (
    <DashboardCard
      label="On Target"
      value={`${onTargetPercent}%`}
      sublabel={bands ? `within ${bands.onTarget}` : VARYING_TOLERANCE_SUBLABEL}
      tone="highlight"
      explanation={onTargetExplanation(tolerance, quantity)}
    />
  );

  const majorMisses = (
    <DashboardCard
      label="Major Misses"
      value={`${targetAccuracy.majorMissCount} of ${targetAccuracy.shotCount}`}
      sublabel={bands ? `beyond ${bands.acceptable}` : VARYING_TOLERANCE_SUBLABEL}
      tone="highlight"
      explanation={majorMissExplanation(tolerance, quantity)}
    />
  );

  const withinAcceptable = (
    <DashboardCard
      label="Within Acceptable"
      value={`${withinAcceptablePercent}%`}
      sublabel={bands ? `within ${bands.acceptable}` : VARYING_TOLERANCE_SUBLABEL}
      explanation={acceptableExplanation(tolerance, quantity)}
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
          ? `${targetAccuracy.largestAbsoluteMiss.toFixed(2)}${unitSuffix}`
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
          value={`${(targetAccuracy.meanAbsoluteTargetError ?? 0).toFixed(2)}${unitSuffix}`}
          tone="highlight"
          size="hero"
          explanation={averageErrorExplanation(quantity)}
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
        value={`${(targetAccuracy.meanAbsoluteTargetError ?? 0).toFixed(2)}${unitSuffix}`}
        tone="highlight"
        explanation={averageErrorExplanation(quantity)}
      />
      {onTarget}
      {majorMisses}
      {withinAcceptable}
      {targetErrorSd}
      {largestMiss}
    </>
  );
}
