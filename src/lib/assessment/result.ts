// Assessment Result derivation — Phase C. Every function here is pure and
// derives its output from a persisted AssessmentRun (+ an explicitly chosen
// Threshold Set); nothing here is itself persisted (see ADR-0010's rejection
// of caching derived Result metrics on the Run, and
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 4's "Raw Data
// Is Authoritative"). Re-run any of these on demand rather than storing their
// output as a new source of truth.
//
// Handle-based grouping uses the *executed* handle (what actually happened),
// not the planned/expected handle — an explicit implementation decision
// (the domain spec does not spell this out in those exact words): a
// wrong-handle attempt still counts, and Handle Results describe the
// athlete's actual in/out performance, while the protocol deviation itself
// stays separately visible via ProtocolIntegritySummary. See
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 14/18.
import type { AccuracyThresholds, Handle, MeasurementMode, TimingProviderType } from "../../types";
import { categorizeTargetError, type TargetErrorCategory } from "../accuracyThresholds";
import { average, standardDeviationOfValues } from "../analytics";
import {
  checkProtocolComparisonEligibility,
  type ComparisonIneligibilityReason,
} from "./comparison";
import { ok, type AssessmentOutcome } from "./errors";
import {
  computeCategoryMetrics,
  computeRawAssessmentMetrics,
  signedError,
  type CategoryMetrics,
  type RawAssessmentMetrics,
} from "./metrics";
import { countInvalidAttempts, getAllPlannedShots } from "./progress";
import {
  createAccuracyThresholdSet,
  standardAssessmentThresholdSet,
  tightAssessmentThresholdSet,
} from "./thresholds";
import type {
  AccuracyThresholdSet,
  AssessmentAttempt,
  AssessmentBlockDefinition,
  AssessmentRun,
  AssessmentTemplate,
  InvalidAttemptReason,
  PlannedAssessmentShot,
  ProtocolDeviationType,
} from "./types";

// ---------------------------------------------------------------------------
// Shared aggregate metrics (raw + category combined) over any subset of
// valid, scored attempts — the building block for block/target/handle/whole-
// run results, so every breakdown uses one formula, never a re-derivation.
// ---------------------------------------------------------------------------

export type AggregateMetrics = RawAssessmentMetrics & CategoryMetrics;

const EMPTY_AGGREGATE_METRICS: AggregateMetrics = {
  count: 0,
  meanAbsoluteError: null,
  bias: null,
  standardDeviation: null,
  onTargetCount: 0,
  acceptableCount: 0,
  majorMissCount: 0,
  onTargetRate: null,
  acceptableRate: null,
  majorMissRate: null,
};

type DetailedScoredRecord = {
  attempt: AssessmentAttempt;
  plannedShot: PlannedAssessmentShot;
  signedError: number;
  absoluteError: number;
};

/** Every valid, scored attempt in the run, joined with its planned shot (target time, expected handle, block) and its own signed/absolute error. */
function getDetailedScoredRecords(run: AssessmentRun): DetailedScoredRecord[] {
  const scoredShotById = new Map(
    getAllPlannedShots(run.templateSnapshot)
      .filter((shot) => shot.phase === "scored")
      .map((shot) => [shot.id, shot])
  );

  return run.attempts
    .filter((attempt) => attempt.status === "valid" && scoredShotById.has(attempt.plannedShotId))
    .map((attempt) => {
      const plannedShot = scoredShotById.get(attempt.plannedShotId)!;
      const measuredTime = attempt.measuredTime as number;
      const signed = signedError(measuredTime, plannedShot.targetTime);
      return { attempt, plannedShot, signedError: signed, absoluteError: Math.abs(signed) };
    });
}

function aggregateMetrics(
  records: DetailedScoredRecord[],
  thresholds: AccuracyThresholds
): AggregateMetrics {
  if (records.length === 0) return EMPTY_AGGREGATE_METRICS;

  const signedErrors = records.map((record) => record.signedError);
  const absoluteErrors = records.map((record) => record.absoluteError);
  const categories: TargetErrorCategory[] = absoluteErrors.map((error) =>
    categorizeTargetError(error, thresholds)
  );

  const onTargetCount = categories.filter((category) => category === "on_target").length;
  const acceptableCount = categories.filter((category) => category === "acceptable").length;
  const majorMissCount = categories.filter((category) => category === "major_miss").length;
  const total = records.length;

  return {
    count: total,
    meanAbsoluteError: average(absoluteErrors),
    bias: average(signedErrors),
    standardDeviation: standardDeviationOfValues(signedErrors),
    onTargetCount,
    acceptableCount,
    majorMissCount,
    onTargetRate: onTargetCount / total,
    acceptableRate: acceptableCount / total,
    majorMissRate: majorMissCount / total,
  };
}

export function accuracyThresholdSetLabel(set: AccuracyThresholdSet): string {
  if (set.type === "custom") return "Custom";
  if (set.type === "tight") return "Tight";
  return "Standard";
}

// ---------------------------------------------------------------------------
// Analysis Threshold selection (Original / Standard / Tight / Custom) — see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 21. Never
// mutates the run's own Run Threshold Snapshot; "Original" simply reads it.
// ---------------------------------------------------------------------------

export type AnalysisThresholdMode = "original" | "standard" | "tight" | "custom";

export function resolveAnalysisThresholdSet(
  run: AssessmentRun,
  mode: AnalysisThresholdMode,
  customValues?: AccuracyThresholds
): AssessmentOutcome<AccuracyThresholdSet> {
  if (mode === "original") return ok(run.thresholdSnapshot);
  if (mode === "standard") return ok(standardAssessmentThresholdSet());
  if (mode === "tight") return ok(tightAssessmentThresholdSet());
  return createAccuracyThresholdSet("custom", customValues ?? { onTarget: NaN, acceptable: NaN });
}

// ---------------------------------------------------------------------------
// Block Results
// ---------------------------------------------------------------------------

export type BlockResult = {
  blockId: string;
  name: string;
  purpose: string;
  targetTimes: number[];
  metrics: AggregateMetrics;
};

export function computeBlockResults(
  run: AssessmentRun,
  thresholds: AccuracyThresholds
): BlockResult[] {
  const records = getDetailedScoredRecords(run);

  return [...run.templateSnapshot.blocks]
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    .map((block) => {
      const blockRecords = records.filter((record) => record.plannedShot.blockId === block.id);
      const targetTimes = Array.from(new Set(block.plannedShots.map((shot) => shot.targetTime))).sort(
        (a, b) => a - b
      );
      return {
        blockId: block.id,
        name: block.name,
        purpose: block.purpose,
        targetTimes,
        metrics: aggregateMetrics(blockRecords, thresholds),
      };
    });
}

// ---------------------------------------------------------------------------
// Target Results — combine attempts sharing a target time across every
// block, including Variable Adaptation. See spec section 6 for the
// Fast/Medium/Slow Delivery naming rule (never a final-stone-position label).
// ---------------------------------------------------------------------------

export type TargetResult = {
  targetTime: number;
  deliveryLabel: string;
  metrics: AggregateMetrics;
};

export function deliveryLabelForTarget(targetTime: number): string {
  if (targetTime === 3.5) return "Fast Delivery";
  if (targetTime === 3.75) return "Medium Delivery";
  if (targetTime === 4.0) return "Slow Delivery";
  return `${targetTime.toFixed(2)}s Delivery`;
}

export function computeTargetResults(
  run: AssessmentRun,
  thresholds: AccuracyThresholds
): TargetResult[] {
  const records = getDetailedScoredRecords(run);
  const targetTimes = Array.from(
    new Set(getAllPlannedShots(run.templateSnapshot).filter((shot) => shot.phase === "scored").map((shot) => shot.targetTime))
  ).sort((a, b) => a - b);

  return targetTimes.map((targetTime) => ({
    targetTime,
    deliveryLabel: deliveryLabelForTarget(targetTime),
    metrics: aggregateMetrics(records.filter((record) => record.plannedShot.targetTime === targetTime), thresholds),
  }));
}

// ---------------------------------------------------------------------------
// Handle Results / Comparison — grouped by executed handle (see module doc).
// ---------------------------------------------------------------------------

export type HandleResult = {
  handle: Handle;
  metrics: AggregateMetrics;
};

export function computeHandleResults(
  run: AssessmentRun,
  thresholds: AccuracyThresholds
): HandleResult[] {
  const records = getDetailedScoredRecords(run);
  const handles: Handle[] = ["in", "out"];
  return handles.map((handle) => ({
    handle,
    metrics: aggregateMetrics(records.filter((record) => record.attempt.executedHandle === handle), thresholds),
  }));
}

export type HandleComparison = {
  in: HandleResult;
  out: HandleResult;
  meanAbsoluteErrorDifference: number | null;
  biasDifference: number | null;
  standardDeviationDifference: number | null;
};

function absoluteDifference(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.abs(a - b);
}

export function computeHandleComparison(
  run: AssessmentRun,
  thresholds: AccuracyThresholds
): HandleComparison {
  const [inResult, outResult] = computeHandleResults(run, thresholds);
  return {
    in: inResult,
    out: outResult,
    meanAbsoluteErrorDifference: absoluteDifference(
      inResult.metrics.meanAbsoluteError,
      outResult.metrics.meanAbsoluteError
    ),
    biasDifference: absoluteDifference(inResult.metrics.bias, outResult.metrics.bias),
    standardDeviationDifference: absoluteDifference(
      inResult.metrics.standardDeviation,
      outResult.metrics.standardDeviation
    ),
  };
}

// ---------------------------------------------------------------------------
// Variable Adaptation Results — the one block with more than one target
// time. Located structurally (not by a hard-coded block id) so it keeps
// working if a future template's block ordering changes. See spec section 7
// (exact 8-shot sequence) and section 18 ("do not overstate conclusions from
// eight variable shots" — no transition-specific metrics are computed here,
// since none is "clearly defined" anywhere in the domain utilities yet).
// ---------------------------------------------------------------------------

export type VariableAdaptationResult = {
  blockId: string;
  name: string;
  metrics: AggregateMetrics;
  targetResults: TargetResult[];
};

function findVariableAdaptationBlock(
  template: AssessmentTemplate
): AssessmentBlockDefinition | undefined {
  return template.blocks.find(
    (block) => new Set(block.plannedShots.map((shot) => shot.targetTime)).size > 1
  );
}

export function computeVariableAdaptationResult(
  run: AssessmentRun,
  thresholds: AccuracyThresholds
): VariableAdaptationResult | null {
  const block = findVariableAdaptationBlock(run.templateSnapshot);
  if (!block) return null;

  const records = getDetailedScoredRecords(run).filter((record) => record.plannedShot.blockId === block.id);
  const targetTimes = Array.from(new Set(block.plannedShots.map((shot) => shot.targetTime))).sort(
    (a, b) => a - b
  );

  return {
    blockId: block.id,
    name: block.name,
    metrics: aggregateMetrics(records, thresholds),
    targetResults: targetTimes.map((targetTime) => ({
      targetTime,
      deliveryLabel: deliveryLabelForTarget(targetTime),
      metrics: aggregateMetrics(
        records.filter((record) => record.plannedShot.targetTime === targetTime),
        thresholds
      ),
    })),
  };
}

// ---------------------------------------------------------------------------
// Protocol Integrity
// ---------------------------------------------------------------------------

export type ProtocolIntegritySummary = {
  completedInOneSession: boolean;
  resumedAfterReload: boolean;
  longInterruption: boolean;
  interruptionCount: number;
  wrongHandleDeviationCount: number;
  nonStandardWarmupCount: number;
  manualOverrideCount: number;
  otherDeviationCount: number;
  totalDeviationCount: number;
  invalidAttemptCount: number;
  timingProviderId: TimingProviderType;
  captureMode: "automatic" | "manual";
  measurementMode: MeasurementMode;
};

export function buildProtocolIntegritySummary(run: AssessmentRun): ProtocolIntegritySummary {
  const countByType = (type: ProtocolDeviationType) =>
    run.protocolDeviations.filter((deviation) => deviation.type === type).length;

  return {
    completedInOneSession: !run.interruption.resumedAfterReload && run.interruption.interruptionCount === 0,
    resumedAfterReload: run.interruption.resumedAfterReload,
    longInterruption: run.interruption.longInterruption ?? false,
    interruptionCount: run.interruption.interruptionCount,
    wrongHandleDeviationCount: countByType("wrong_handle"),
    nonStandardWarmupCount: countByType("non_standard_warmup"),
    manualOverrideCount: countByType("manual_override"),
    otherDeviationCount: countByType("other") + countByType("long_interruption"),
    totalDeviationCount: run.protocolDeviations.length,
    invalidAttemptCount: countInvalidAttempts(run),
    timingProviderId: run.timingProviderSnapshot.providerId,
    captureMode: run.timingProviderSnapshot.captureMode,
    measurementMode: run.timingProviderSnapshot.measurementMode,
  };
}

// ---------------------------------------------------------------------------
// Comparison ineligibility copy — see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 22. Never
// surface a raw enum value in UI; always go through this mapping.
// ---------------------------------------------------------------------------

export const COMPARISON_INELIGIBILITY_COPY: Record<ComparisonIneligibilityReason, string> = {
  different_template: "These runs use different Assessment Templates.",
  different_version: "These runs use different versions of the Assessment Template.",
  different_measurement_mode: "These runs used different Measurement Modes.",
  different_protocol_sequence: "These runs used a different target or handle sequence.",
  different_scored_shot_count: "These runs recorded a different number of scored stones.",
  run_not_completed: "Both runs must be completed to be compared.",
  protocol_integrity_failed: "One of these runs has a protocol integrity issue that prevents comparison.",
};

export function describeIneligibilityReasons(reasons: ComparisonIneligibilityReason[]): string[] {
  return reasons.map((reason) => COMPARISON_INELIGIBILITY_COPY[reason]);
}

// ---------------------------------------------------------------------------
// Single-run Result view — the derived, non-persisted aggregate a Result
// Screen renders from. See ADR-0010: recomputed on demand, never cached as a
// second source of truth.
// ---------------------------------------------------------------------------

export type AssessmentResultView = {
  run: AssessmentRun;
  activeThresholdSet: AccuracyThresholdSet;
  raw: RawAssessmentMetrics;
  category: CategoryMetrics;
  overall: AggregateMetrics;
  blocks: BlockResult[];
  targets: TargetResult[];
  handles: HandleComparison;
  variableAdaptation: VariableAdaptationResult | null;
  protocolIntegrity: ProtocolIntegritySummary;
};

export function buildAssessmentResultView(
  run: AssessmentRun,
  activeThresholdSet: AccuracyThresholdSet
): AssessmentResultView {
  const thresholds = activeThresholdSet.values;
  const records = getDetailedScoredRecords(run);

  return {
    run,
    activeThresholdSet,
    raw: computeRawAssessmentMetrics(run),
    category: computeCategoryMetrics(run, thresholds),
    overall: aggregateMetrics(records, thresholds),
    blocks: computeBlockResults(run, thresholds),
    targets: computeTargetResults(run, thresholds),
    handles: computeHandleComparison(run, thresholds),
    variableAdaptation: computeVariableAdaptationResult(run, thresholds),
    protocolIntegrity: buildProtocolIntegritySummary(run),
  };
}

// ---------------------------------------------------------------------------
// Shot-level and invalid-attempt detail rows
// ---------------------------------------------------------------------------

export type ShotDetailRow = {
  plannedShotId: string;
  globalShotNumber: number;
  blockName: string;
  targetTime: number;
  measuredTime: number;
  signedError: number;
  absoluteError: number;
  expectedHandle: Handle;
  executedHandle: Handle;
  category: TargetErrorCategory;
  hasProtocolDeviation: boolean;
};

export function buildShotDetailRows(run: AssessmentRun, thresholds: AccuracyThresholds): ShotDetailRow[] {
  const blockNameById = new Map(run.templateSnapshot.blocks.map((block) => [block.id, block.name]));

  return getDetailedScoredRecords(run)
    .sort((a, b) => a.plannedShot.sequenceIndex - b.plannedShot.sequenceIndex)
    .map((record, index) => ({
      plannedShotId: record.plannedShot.id,
      globalShotNumber: index + 1,
      blockName: record.plannedShot.blockId ? blockNameById.get(record.plannedShot.blockId) ?? "" : "",
      targetTime: record.plannedShot.targetTime,
      measuredTime: record.attempt.measuredTime as number,
      signedError: record.signedError,
      absoluteError: record.absoluteError,
      expectedHandle: record.plannedShot.expectedHandle,
      executedHandle: record.attempt.executedHandle as Handle,
      category: categorizeTargetError(record.absoluteError, thresholds),
      hasProtocolDeviation: (record.attempt.protocolDeviations?.length ?? 0) > 0,
    }));
}

export type InvalidAttemptRow = {
  plannedShotId: string;
  blockName: string;
  attemptNumber: number;
  invalidReason: InvalidAttemptReason | undefined;
  capturedAt: string;
};

export function buildInvalidAttemptRows(run: AssessmentRun): InvalidAttemptRow[] {
  const allShots = getAllPlannedShots(run.templateSnapshot);
  const shotById = new Map(allShots.map((shot) => [shot.id, shot]));
  const blockNameById = new Map(run.templateSnapshot.blocks.map((block) => [block.id, block.name]));

  return run.attempts
    .filter((attempt) => attempt.status === "invalid")
    .map((attempt) => {
      const shot = shotById.get(attempt.plannedShotId);
      return {
        plannedShotId: attempt.plannedShotId,
        blockName: shot?.blockId ? blockNameById.get(shot.blockId) ?? "" : "Warm-up",
        attemptNumber: attempt.attemptNumber,
        invalidReason: attempt.invalidReason,
        capturedAt: attempt.capturedAt,
      };
    });
}

// ---------------------------------------------------------------------------
// Run Comparison — requires protocol-comparable, completed runs and one
// shared Comparison Threshold Set for every threshold-dependent figure. See
// spec sections 19/22.
// ---------------------------------------------------------------------------

export type MetricDelta = {
  meanAbsoluteError: number | null;
  bias: number | null;
  standardDeviation: number | null;
  onTargetRatePercentagePoints: number | null;
  acceptableRatePercentagePoints: number | null;
  majorMissRatePercentagePoints: number | null;
};

function numericDifference(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : b - a;
}

function percentagePointDifference(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.round((b - a) * 1000) / 10;
}

function computeMetricDelta(a: AggregateMetrics, b: AggregateMetrics): MetricDelta {
  return {
    meanAbsoluteError: numericDifference(a.meanAbsoluteError, b.meanAbsoluteError),
    bias: numericDifference(a.bias, b.bias),
    standardDeviation: numericDifference(a.standardDeviation, b.standardDeviation),
    onTargetRatePercentagePoints: percentagePointDifference(a.onTargetRate, b.onTargetRate),
    acceptableRatePercentagePoints: percentagePointDifference(a.acceptableRate, b.acceptableRate),
    majorMissRatePercentagePoints: percentagePointDifference(a.majorMissRate, b.majorMissRate),
  };
}

export type NamedMetricDelta = { key: string; label: string; delta: MetricDelta };

export type AssessmentRunComparison = {
  eligible: boolean;
  reasons: ComparisonIneligibilityReason[];
  reasonMessages: string[];
  earlier: AssessmentResultView | null;
  later: AssessmentResultView | null;
  overallDelta: MetricDelta | null;
  blockDeltas: NamedMetricDelta[] | null;
  targetDeltas: NamedMetricDelta[] | null;
  handleDeltas: NamedMetricDelta[] | null;
};

/**
 * Compares two runs under one shared Comparison Threshold Set. `earlier` and
 * `later` should be given in chronological order — every delta is
 * `later - earlier`, so "MAE decreased by 0.02s" reads naturally as an
 * improvement-direction-neutral fact, never a synthetic verdict.
 */
export function compareAssessmentRuns(
  earlier: AssessmentRun,
  later: AssessmentRun,
  comparisonThresholdSet: AccuracyThresholdSet
): AssessmentRunComparison {
  const eligibility = checkProtocolComparisonEligibility(earlier, later);
  if (!eligibility.eligible) {
    return {
      eligible: false,
      reasons: eligibility.reasons,
      reasonMessages: describeIneligibilityReasons(eligibility.reasons),
      earlier: null,
      later: null,
      overallDelta: null,
      blockDeltas: null,
      targetDeltas: null,
      handleDeltas: null,
    };
  }

  const earlierView = buildAssessmentResultView(earlier, comparisonThresholdSet);
  const laterView = buildAssessmentResultView(later, comparisonThresholdSet);

  const blockDeltas: NamedMetricDelta[] = earlierView.blocks.map((block, index) => ({
    key: block.blockId,
    label: block.name,
    delta: computeMetricDelta(block.metrics, laterView.blocks[index].metrics),
  }));

  const targetDeltas: NamedMetricDelta[] = earlierView.targets
    .map((target) => {
      const laterTarget = laterView.targets.find((candidate) => candidate.targetTime === target.targetTime);
      if (!laterTarget) return null;
      return {
        key: String(target.targetTime),
        label: target.deliveryLabel,
        delta: computeMetricDelta(target.metrics, laterTarget.metrics),
      };
    })
    .filter((value): value is NamedMetricDelta => value !== null);

  const handleDeltas: NamedMetricDelta[] = [
    { key: "in", label: "In Handle", delta: computeMetricDelta(earlierView.handles.in.metrics, laterView.handles.in.metrics) },
    { key: "out", label: "Out Handle", delta: computeMetricDelta(earlierView.handles.out.metrics, laterView.handles.out.metrics) },
  ];

  return {
    eligible: true,
    reasons: [],
    reasonMessages: [],
    earlier: earlierView,
    later: laterView,
    overallDelta: computeMetricDelta(earlierView.overall, laterView.overall),
    blockDeltas,
    targetDeltas,
    handleDeltas,
  };
}

/** Every completed run in `candidates` that is protocol-comparable with `reference` (excluding `reference` itself). */
export function findProtocolCompatibleRuns(
  candidates: AssessmentRun[],
  reference: AssessmentRun
): AssessmentRun[] {
  return candidates.filter(
    (candidate) => candidate.id !== reference.id && checkProtocolComparisonEligibility(reference, candidate).eligible
  );
}

function runTimestamp(run: AssessmentRun): number {
  return new Date(run.completedAt ?? run.createdAt).getTime();
}

/** The most recent protocol-compatible completed run before `reference`, or undefined if none exists. */
export function findLatestEligiblePreviousRun(
  candidates: AssessmentRun[],
  reference: AssessmentRun
): AssessmentRun | undefined {
  return findProtocolCompatibleRuns(candidates, reference)
    .filter((candidate) => runTimestamp(candidate) <= runTimestamp(reference))
    .sort((a, b) => runTimestamp(b) - runTimestamp(a))[0];
}

// ---------------------------------------------------------------------------
// Development Trends — same Template + Version, completed runs only, one
// shared Comparison Threshold Set. See spec section 19's comparison rule and
// section "Development Trends" in the Phase C brief.
// ---------------------------------------------------------------------------

export type AssessmentTrendPoint = {
  runId: string;
  completedAt: string;
  isSelected: boolean;
  metrics: AggregateMetrics;
};

export function buildAssessmentTrendSeries(
  runs: AssessmentRun[],
  comparisonThresholdSet: AccuracyThresholdSet,
  selectedRunId?: string
): AssessmentTrendPoint[] {
  return [...runs]
    .filter((run) => run.status === "completed")
    .sort((a, b) => runTimestamp(a) - runTimestamp(b))
    .map((run) => ({
      runId: run.id,
      completedAt: run.completedAt ?? run.createdAt,
      isSelected: run.id === selectedRunId,
      metrics: buildAssessmentResultView(run, comparisonThresholdSet).overall,
    }));
}

/** Smallest change worth reporting as a takeaway — below this reads as noise. */
const ASSESSMENT_MAJOR_MISS_RATE_EPSILON = 0.05; // 5 percentage points
const ASSESSMENT_MAE_EPSILON = 0.02; // seconds

/**
 * Analyze → Assessments' "what should I learn" opening sentence — the same
 * Level-1 "what happened" fact-first comparison as Training's key takeaway
 * (docs/COACHING_PRINCIPLES.md), but built only from `buildAssessmentTrendSeries`
 * output: it never re-derives comparison eligibility itself, so it can only
 * ever compare runs the Result screen's own comparison rules already judged
 * protocol-compatible. Returns null when there's nothing yet to compare.
 */
export function buildAssessmentTrendInsight(
  points: AssessmentTrendPoint[]
): { headline: string } | null {
  if (points.length < 2) return null;

  const earliest = points[0].metrics;
  const latest = points[points.length - 1].metrics;

  if (earliest.majorMissRate !== null && latest.majorMissRate !== null) {
    const delta = latest.majorMissRate - earliest.majorMissRate;
    if (Math.abs(delta) >= ASSESSMENT_MAJOR_MISS_RATE_EPSILON) {
      const from = Math.round(earliest.majorMissRate * 100);
      const to = Math.round(latest.majorMissRate * 100);
      return {
        headline:
          delta < 0
            ? `Your Major Miss rate has fallen from ${from}% to ${to}% across your last ${points.length} comparable assessments.`
            : `Your Major Miss rate has risen from ${from}% to ${to}% across your last ${points.length} comparable assessments.`,
      };
    }
  }

  if (earliest.meanAbsoluteError !== null && latest.meanAbsoluteError !== null) {
    const delta = latest.meanAbsoluteError - earliest.meanAbsoluteError;
    if (Math.abs(delta) >= ASSESSMENT_MAE_EPSILON) {
      return {
        headline:
          delta < 0
            ? `Your Average Error has improved from ${earliest.meanAbsoluteError.toFixed(2)}s to ${latest.meanAbsoluteError.toFixed(2)}s across your last ${points.length} comparable assessments.`
            : `Your Average Error has moved from ${earliest.meanAbsoluteError.toFixed(2)}s to ${latest.meanAbsoluteError.toFixed(2)}s across your last ${points.length} comparable assessments.`,
      };
    }
  }

  return {
    headline: `Your results have stayed steady across your last ${points.length} comparable assessments — no clear change yet.`,
  };
}
