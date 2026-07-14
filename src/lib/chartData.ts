/**
 * Pure chart-data preparation — no React, no Recharts, no DOM. Every chart
 * component (src/components/*Chart.tsx) receives already-shaped data from
 * these functions; none of them compute analytics themselves (see
 * docs/SYSTEM_ARCHITECTURE.md's "Analytics" section and this project's
 * "no analytics calculation in UI components" rule).
 *
 * Callers are always responsible for applying active filters (handle/shot
 * type/block/session/measurement mode) *before* calling into this module —
 * nothing here re-filters, and nothing here mixes Back-Hog and Hog-Hog data
 * on the same series.
 */
import type {
  AccuracyThresholds,
  Handle,
  MeasurementMode,
  Shot,
  ShotType,
  TrainingBlock,
} from "../types";
import {
  categorizeTargetError,
  type TargetErrorCategory,
} from "./accuracyThresholds";
import {
  computeTargetAccuracyAnalytics,
  targetErrorForShot,
  type TargetAccuracyAnalytics,
} from "./analytics";
import { blockModeLabel } from "./trainingBlocks";

// --- Target Error by Shot -----------------------------------------------

export type TargetErrorByShotPoint = {
  shotId: string;
  shotNumber: number;
  targetTime: number;
  actualTime: number;
  targetError: number;
  absoluteTargetError: number;
  handle: Handle;
  shotType?: ShotType;
  blockId: string;
  blockName: string;
  category: TargetErrorCategory;
};

/**
 * Shapes shots (already filtered, already in the order the caller wants
 * plotted — normally ascending `shotNumber` within one block) into Target
 * Error by Shot chart points. `blocksById` only supplies each point's block
 * name for the tooltip; it never changes which shots are included.
 */
export function prepareTargetErrorByShotData(
  shots: Shot[],
  blocksById: Map<string, TrainingBlock>,
  thresholds: AccuracyThresholds
): TargetErrorByShotPoint[] {
  return shots.map((shot) => {
    const targetError = targetErrorForShot(shot);
    const absoluteTargetError = Math.abs(targetError);

    return {
      shotId: shot.id,
      shotNumber: shot.shotNumber,
      targetTime: shot.targetTime,
      actualTime: shot.releaseTime,
      targetError,
      absoluteTargetError,
      handle: shot.handle,
      shotType: shot.shotType,
      blockId: shot.blockId,
      blockName: blocksById.get(shot.blockId)?.name ?? "",
      category: categorizeTargetError(absoluteTargetError, thresholds),
    };
  });
}

// --- Target vs. Actual scatterplot ---------------------------------------

export type TargetVsActualPoint = {
  shotId: string;
  shotNumber: number;
  targetTime: number;
  actualTime: number;
  targetError: number;
  handle: Handle;
  blockId: string;
  blockName: string;
  sessionTitle?: string;
  date?: string;
  /** Training Category label (Fixed/Variable/Blind Weight), for a multi-block tooltip. */
  trainingCategory?: string;
  measurementMode?: MeasurementMode;
};

export type SessionContextByBlockId = Map<
  string,
  { sessionTitle: string; date: string }
>;

/**
 * Shapes shots into Target vs. Actual scatter points. Available for any
 * compatible dataset (Variable Weight, multiple Fixed Weight blocks,
 * multiple sessions, mixed Fixed/Variable — as long as everything shares one
 * Measurement Mode, which the caller must already guarantee). No artificial
 * point-shifting is ever applied — target/actual are plotted as recorded.
 */
export function prepareTargetVsActualScatterData(
  shots: Shot[],
  blocksById: Map<string, TrainingBlock>,
  sessionContextByBlockId?: SessionContextByBlockId
): TargetVsActualPoint[] {
  return shots.map((shot) => {
    const block = blocksById.get(shot.blockId);

    return {
      shotId: shot.id,
      shotNumber: shot.shotNumber,
      targetTime: shot.targetTime,
      actualTime: shot.releaseTime,
      targetError: targetErrorForShot(shot),
      handle: shot.handle,
      blockId: shot.blockId,
      blockName: block?.name ?? "",
      sessionTitle: sessionContextByBlockId?.get(shot.blockId)?.sessionTitle,
      date: sessionContextByBlockId?.get(shot.blockId)?.date,
      trainingCategory: block ? blockModeLabel(block.mode) : undefined,
      measurementMode: block?.measurementMode,
    };
  });
}

/**
 * Whether a set of scatter points has more than one distinct target time —
 * below this, the chart is still shown (never hidden), just with a
 * "more informative with multiple targets" hint, per product spec. No trend
 * interpretation is ever attempted here.
 */
export function hasMultipleTargetTimes(
  points: { targetTime: number }[]
): boolean {
  return new Set(points.map((point) => point.targetTime)).size > 1;
}

// --- Threshold comparability across a selection ---------------------------

/**
 * True only if every block in the selection shares the exact same
 * AccuracyThresholds. Used to gate on-target/acceptable reference bands (a
 * mixed-threshold selection must not render one band as if it applied to
 * all of them) and to decide whether to show a "Thresholds vary across
 * selected blocks" notice in History/Progress views.
 */
export function hasUniformThresholds(
  thresholdsList: AccuracyThresholds[]
): boolean {
  if (thresholdsList.length <= 1) return true;

  const [first, ...rest] = thresholdsList;
  return rest.every(
    (thresholds) =>
      thresholds.onTarget === first.onTarget &&
      thresholds.acceptable === first.acceptable
  );
}

// --- Progress across blocks/sessions --------------------------------------

export type ProgressBlockEntry = {
  blockId: string;
  blockName: string;
  sessionTitle: string;
  /** ISO date string — entries are sorted chronologically by this field. */
  date: string;
  measurementMode: MeasurementMode;
  thresholds: AccuracyThresholds;
  shots: Shot[];
  /** Training mode, for tooltip context only — never used to filter/group. */
  blockMode?: string;
  /** Pre-formatted "3.75s" / "2.50s–4.50s" label, for tooltip context only. */
  targetDescription?: string;
};

export type ProgressMetricKey =
  | "meanAbsoluteTargetError"
  | "meanTargetError"
  | "targetErrorStandardDeviation"
  | "onTargetRate"
  | "majorMissRate";

export type ProgressPoint = {
  blockId: string;
  blockName: string;
  sessionTitle: string;
  date: string;
  measurementMode: MeasurementMode;
  thresholds: AccuracyThresholds;
  shotCount: number;
  targetAccuracy: TargetAccuracyAnalytics;
  value: number | null;
  rollingAverage: number | null;
  blockMode?: string;
  targetDescription?: string;
};

/** Groups entries by Measurement Mode — Back-Hog and Hog-Hog must never share a series. */
export function groupProgressEntriesByMeasurementMode(
  entries: ProgressBlockEntry[]
): Record<MeasurementMode, ProgressBlockEntry[]> {
  return {
    "back-hog": entries.filter((entry) => entry.measurementMode === "back-hog"),
    "hog-hog": entries.filter((entry) => entry.measurementMode === "hog-hog"),
  };
}

function progressMetricValue(
  targetAccuracy: TargetAccuracyAnalytics,
  metric: ProgressMetricKey
): number | null {
  switch (metric) {
    case "meanAbsoluteTargetError":
      return targetAccuracy.meanAbsoluteTargetError;
    case "meanTargetError":
      return targetAccuracy.meanTargetError;
    case "targetErrorStandardDeviation":
      return targetAccuracy.targetErrorStandardDeviation;
    case "onTargetRate":
      return targetAccuracy.onTargetRate;
    case "majorMissRate":
      return targetAccuracy.majorMissRate;
  }
}

/**
 * Builds a chronological progress series for one metric across blocks
 * and/or sessions. Empty blocks (no shots) are excluded rather than plotted
 * as a fabricated zero. A rolling average (default 3-block window) is
 * computed alongside the raw points, only once enough trailing points exist
 * — it never replaces the raw points, only supplements them.
 */
export function prepareProgressMetricData(
  entries: ProgressBlockEntry[],
  metric: ProgressMetricKey,
  rollingWindow = 3
): ProgressPoint[] {
  const nonEmpty = entries.filter((entry) => entry.shots.length > 0);

  const sorted = [...nonEmpty].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const points: ProgressPoint[] = sorted.map((entry) => {
    const targetAccuracy = computeTargetAccuracyAnalytics(
      entry.shots,
      entry.thresholds
    );

    return {
      blockId: entry.blockId,
      blockName: entry.blockName,
      sessionTitle: entry.sessionTitle,
      date: entry.date,
      measurementMode: entry.measurementMode,
      thresholds: entry.thresholds,
      shotCount: entry.shots.length,
      targetAccuracy,
      value: progressMetricValue(targetAccuracy, metric),
      rollingAverage: null,
      blockMode: entry.blockMode,
      targetDescription: entry.targetDescription,
    };
  });

  if (points.length < rollingWindow) return points;

  return points.map((point, index) => {
    if (index < rollingWindow - 1) return point;

    const window = points.slice(index - rollingWindow + 1, index + 1);
    const values = window
      .map((windowPoint) => windowPoint.value)
      .filter((value): value is number => value !== null);

    if (values.length < rollingWindow) return point;

    const rollingAverage =
      values.reduce((sum, value) => sum + value, 0) / values.length;

    return { ...point, rollingAverage };
  });
}

// --- Shot Quality Over Time (100% stacked) --------------------------------

export type ShotQualityDistributionPoint = {
  blockId: string;
  blockName: string;
  sessionTitle: string;
  date: string;
  measurementMode: MeasurementMode;
  thresholds: AccuracyThresholds;
  shotCount: number;
  onTargetCount: number;
  onTargetPercent: number;
  acceptableCount: number;
  acceptablePercent: number;
  majorMissCount: number;
  majorMissPercent: number;
};

/**
 * Builds one 100%-stacked entry per non-empty block, using each block's own
 * threshold snapshot — never the app's current default. Chronologically
 * sorted, same exclusion rule as `prepareProgressMetricData`.
 */
export function prepareShotQualityDistributionData(
  entries: ProgressBlockEntry[]
): ShotQualityDistributionPoint[] {
  const nonEmpty = entries.filter((entry) => entry.shots.length > 0);

  const sorted = [...nonEmpty].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  return sorted.map((entry) => {
    const targetAccuracy = computeTargetAccuracyAnalytics(
      entry.shots,
      entry.thresholds
    );
    const shotCount = entry.shots.length;

    return {
      blockId: entry.blockId,
      blockName: entry.blockName,
      sessionTitle: entry.sessionTitle,
      date: entry.date,
      measurementMode: entry.measurementMode,
      thresholds: entry.thresholds,
      shotCount,
      onTargetCount: targetAccuracy.onTargetCount,
      onTargetPercent: (targetAccuracy.onTargetCount / shotCount) * 100,
      acceptableCount: targetAccuracy.acceptableCount,
      acceptablePercent: (targetAccuracy.acceptableCount / shotCount) * 100,
      majorMissCount: targetAccuracy.majorMissCount,
      majorMissPercent: (targetAccuracy.majorMissCount / shotCount) * 100,
    };
  });
}
