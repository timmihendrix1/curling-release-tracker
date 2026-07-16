// Raw Metrics Foundation — threshold-independent core metrics and
// threshold-dependent category metrics for a completed (or in-progress)
// Assessment Run. Reuses the existing, tested metric utilities
// (average/standardDeviationOfValues from analytics.ts, categorizeTargetError
// from accuracyThresholds.ts) rather than duplicating formulas — see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 18.
//
// Raw metrics never receive a threshold set; category metrics always require
// one explicitly passed in — there is no implicit global threshold read here.
import type { AccuracyThresholds } from "../../types";
import { categorizeTargetError, type TargetErrorCategory } from "../accuracyThresholds";
import { average, standardDeviationOfValues } from "../analytics";
import { getAllPlannedShots } from "./progress";
import type { AssessmentAttempt, AssessmentRun } from "./types";

export type ScoredAttemptRecord = {
  plannedShotId: string;
  attempt: AssessmentAttempt;
  targetTime: number;
};

/** Every valid, scored (non-warm-up) attempt in the run, paired with the target time it was judged against. */
export function getValidScoredAttempts(run: AssessmentRun): ScoredAttemptRecord[] {
  const scoredShotById = new Map(
    getAllPlannedShots(run.templateSnapshot)
      .filter((shot) => shot.phase === "scored")
      .map((shot) => [shot.id, shot])
  );

  return run.attempts
    .filter((attempt) => attempt.status === "valid" && scoredShotById.has(attempt.plannedShotId))
    .map((attempt) => ({
      plannedShotId: attempt.plannedShotId,
      attempt,
      targetTime: scoredShotById.get(attempt.plannedShotId)!.targetTime,
    }));
}

export function signedError(measuredTime: number, targetTime: number): number {
  return measuredTime - targetTime;
}

export function absoluteError(measuredTime: number, targetTime: number): number {
  return Math.abs(signedError(measuredTime, targetTime));
}

export type RawAssessmentMetrics = {
  count: number;
  meanAbsoluteError: number | null;
  bias: number | null;
  standardDeviation: number | null;
};

const EMPTY_RAW_METRICS: RawAssessmentMetrics = {
  count: 0,
  meanAbsoluteError: null,
  bias: null,
  standardDeviation: null,
};

/**
 * Threshold-independent core metrics over every valid scored attempt: Mean
 * Absolute Error, Bias (signed mean error), and Standard Deviation of the
 * signed error. Never affected by which threshold set is later applied.
 */
export function computeRawAssessmentMetrics(run: AssessmentRun): RawAssessmentMetrics {
  const records = getValidScoredAttempts(run);
  if (records.length === 0) return EMPTY_RAW_METRICS;

  const signedErrors = records.map((record) => signedError(record.attempt.measuredTime as number, record.targetTime));
  const absoluteErrors = signedErrors.map((error) => Math.abs(error));

  return {
    count: records.length,
    meanAbsoluteError: average(absoluteErrors),
    bias: average(signedErrors),
    standardDeviation: standardDeviationOfValues(signedErrors),
  };
}

export type CategoryMetrics = {
  onTargetCount: number;
  acceptableCount: number;
  majorMissCount: number;
  onTargetRate: number | null;
  acceptableRate: number | null;
  majorMissRate: number | null;
};

const EMPTY_CATEGORY_METRICS: CategoryMetrics = {
  onTargetCount: 0,
  acceptableCount: 0,
  majorMissCount: 0,
  onTargetRate: null,
  acceptableRate: null,
  majorMissRate: null,
};

/**
 * Threshold-dependent category metrics (On Target / Acceptable / Major Miss)
 * for every valid scored attempt, judged against the explicitly-provided
 * `thresholds` — this may be the run's own Run Threshold Snapshot, or a
 * separately-selected Comparison Threshold Set; this function has no
 * opinion on which (see comparison.ts).
 */
export function computeCategoryMetrics(
  run: AssessmentRun,
  thresholds: AccuracyThresholds
): CategoryMetrics {
  const records = getValidScoredAttempts(run);
  if (records.length === 0) return EMPTY_CATEGORY_METRICS;

  const categories: TargetErrorCategory[] = records.map((record) =>
    categorizeTargetError(absoluteError(record.attempt.measuredTime as number, record.targetTime), thresholds)
  );

  const onTargetCount = categories.filter((category) => category === "on_target").length;
  const acceptableCount = categories.filter((category) => category === "acceptable").length;
  const majorMissCount = categories.filter((category) => category === "major_miss").length;
  const total = records.length;

  return {
    onTargetCount,
    acceptableCount,
    majorMissCount,
    onTargetRate: onTargetCount / total,
    acceptableRate: acceptableCount / total,
    majorMissRate: majorMissCount / total,
  };
}
