/**
 * The one place History's cross-session analytics selection is computed.
 *
 * Every History analytics surface (Key Metrics, Progress, Shot Quality,
 * Scatterplot, Handle Analysis, the Session/Block list) must read from the
 * same `HistoryAnalysisContext` built here — no chart or card is allowed to
 * re-filter shots on its own or read a different implicit dataset. See
 * docs/SYSTEM_ARCHITECTURE.md's "History analysis pipeline" section.
 *
 * Terminology (see docs/DOMAIN_GLOSSARY.md): a **Training Category** is what
 * the code calls `BlockMode` (Fixed/Variable/Blind Weight) — the type is
 * reused as-is rather than renamed, per this project's "don't rename the
 * whole domain model" guidance. A **Training Block** is a concrete block
 * within a **Session**; progress is always computed per comparable block,
 * never by merging blocks of different categories/measurement modes into one
 * figure.
 */
import type {
  AccuracyThresholds,
  BlockMode,
  Handle,
  MeasuredQuantity,
  MeasurementMode,
  QuantityTolerance,
  Session,
  Shot,
  ShotType,
  TrainingBlock,
} from "../types";
import type { TargetErrorCategory } from "./accuracyThresholds";
import {
  resolveAccuracyThresholds,
  validateAccuracyThresholds,
} from "./accuracyThresholds";
import {
  MEASURED_QUANTITIES,
  blockTolerance,
  resolveBlockMeasurement,
  shotDeviation,
  timeMeasuredShots,
} from "./measurement/quantities";
import {
  categorizeDeviation,
  toleranceFromAccuracyThresholds,
} from "./measurement/tolerance";
import {
  average,
  standardDeviationOfValues,
  targetErrorForShot,
  type TargetAccuracyAnalytics,
} from "./analytics";
import {
  hasUniformThresholds,
  type ProgressBlockEntry,
  type SessionContextByBlockId,
} from "./chartData";
import { blockModeLabel, getBlockShots } from "./trainingBlocks";

/** UI-facing alias — a Training Category *is* a BlockMode, not a new concept. */
export type TrainingCategory = BlockMode;

export type DateRangeFilter =
  | { preset: "all" | "30d" | "90d" | "6m" }
  | { preset: "custom"; from: string; to: string };

export const DEFAULT_DATE_RANGE: DateRangeFilter = { preset: "90d" };

/**
 * Original: each block is judged against its own persisted threshold
 * snapshot (ADR-0008) — "how well did I perform against the standard used in
 * that training?"
 *
 * Comparison: every selected shot is temporarily re-classified with the same
 * thresholds — "how do all selected trainings compare under one consistent
 * standard?" Never mutates a block or shot; only affects History analytics.
 */
export type ThresholdComparisonMode =
  | { type: "original" }
  | { type: "comparison"; thresholds: AccuracyThresholds };

export type HistoryAnalysisFilters = {
  trainingCategory: TrainingCategory | null;
  /**
   * WHAT was measured (seconds or m/s) — deliberately distinct from
   * `measurementMode` below, which is the timing INTERVAL that qualifies a time
   * measurement. Conflating the two is what made speed-only training unreachable:
   * such a block has no timing interval at all, so a defaulted Back-Hog selection
   * silently excluded it with no control through which to get it back.
   */
  measuredQuantity: MeasuredQuantity | null;
  measurementMode: MeasurementMode | null;
  dateRange: DateRangeFilter;
  /** Empty means "Both" (no handle filtering applied). */
  handles: Handle[];
  /** Empty means "All" (no shot-type filtering applied). */
  shotTypes: ShotType[];
  sessionIds: string[];
  blockIds: string[];
  targetRange?: {
    min?: number;
    max?: number;
  };
  thresholdComparisonMode: ThresholdComparisonMode;
};

export function createDefaultHistoryFilters(): HistoryAnalysisFilters {
  return {
    trainingCategory: null,
    measuredQuantity: null,
    measurementMode: null,
    dateRange: DEFAULT_DATE_RANGE,
    handles: [],
    shotTypes: [],
    sessionIds: [],
    blockIds: [],
    thresholdComparisonMode: { type: "original" },
  };
}

/**
 * Repairs a possibly-corrupt persisted `ThresholdComparisonMode` (hand-edited
 * localStorage, or a value written by an older/different app version) to a
 * safe, always-valid state — the same "never invent a value, fall back to the
 * documented safe default" discipline `sessionMigration.ts` uses elsewhere.
 * Never repairs to a guessed custom number; falls back to Original, which
 * needs no thresholds of its own (each block already carries a valid
 * snapshot — see ADR-0008) and is always selectable.
 */
export function sanitizeThresholdComparisonMode(
  mode: ThresholdComparisonMode | null | undefined
): ThresholdComparisonMode {
  if (!mode || mode.type !== "comparison") {
    return { type: "original" };
  }

  const validation = validateAccuracyThresholds(
    mode.thresholds?.onTarget ?? NaN,
    mode.thresholds?.acceptable ?? NaN
  );

  if (!validation.valid) {
    return { type: "original" };
  }

  return {
    type: "comparison",
    thresholds: {
      onTarget: validation.onTarget,
      acceptable: validation.acceptable,
    },
  };
}

/**
 * Repairs a `HistoryAnalysisFilters` object read from an untrusted source
 * (localStorage) — merges onto the safe default shape and repairs the one
 * field (`thresholdComparisonMode`) that can carry a corrupt numeric value.
 * Does not otherwise re-validate every field, since the rest is a closed set
 * of string/array unions that render harmlessly even if stale.
 */
export function sanitizeHistoryFilters(
  raw: Partial<HistoryAnalysisFilters> | null | undefined
): HistoryAnalysisFilters {
  return {
    ...createDefaultHistoryFilters(),
    ...raw,
    thresholdComparisonMode: sanitizeThresholdComparisonMode(
      raw?.thresholdComparisonMode
    ),
  };
}

export function getAvailableTrainingCategories(
  sessions: Session[]
): TrainingCategory[] {
  const set = new Set<TrainingCategory>();
  sessions.forEach((session) =>
    session.blocks.forEach((block) => set.add(block.mode))
  );
  return Array.from(set);
}

export function getAvailableMeasurementModes(
  sessions: Session[],
  trainingCategory: TrainingCategory | null
): MeasurementMode[] {
  const set = new Set<MeasurementMode>();
  sessions.forEach((session) =>
    session.blocks.forEach((block) => {
      if (trainingCategory && block.mode !== trainingCategory) return;
      // A block that measures no time has no timing interval to offer as a filter.
      if (block.measurementMode) set.add(block.measurementMode);
    })
  );
  return Array.from(set);
}

/** The measured quantities present in the selectable history, in canonical order. */
export function getAvailableMeasuredQuantities(
  sessions: Session[],
  trainingCategory: TrainingCategory | null
): MeasuredQuantity[] {
  const set = new Set<MeasuredQuantity>();
  sessions.forEach((session) =>
    session.blocks.forEach((block) => {
      if (trainingCategory && block.mode !== trainingCategory) return;
      resolveBlockMeasurement(block).quantities.forEach((quantity) =>
        set.add(quantity)
      );
    })
  );
  return MEASURED_QUANTITIES.filter((quantity) => set.has(quantity));
}

/**
 * Unlike the training category and the timing interval, a single available quantity
 * is NOT force-selected. "No selection" is meaningful here and is the safe default:
 * it means "every quantity", which keeps both a legacy Time session and a Speed
 * session visible in the same list. Auto-selecting one would reintroduce exactly the
 * silent exclusion this filter exists to prevent.
 */
export function resolveDefaultMeasuredQuantity(
  available: MeasuredQuantity[],
  previous: MeasuredQuantity | null
): MeasuredQuantity | null {
  if (previous && available.includes(previous)) return previous;
  return null;
}

/**
 * A single available option is auto-selected. Multiple options fall back to
 * whichever was previously selected (if still valid) — never to "no
 * selection", which would silently let incompatible categories mix.
 */
export function resolveDefaultTrainingCategory(
  available: TrainingCategory[],
  previous: TrainingCategory | null
): TrainingCategory | null {
  if (available.length === 0) return null;
  if (previous && available.includes(previous)) return previous;
  return available[0];
}

export function resolveDefaultMeasurementMode(
  available: MeasurementMode[],
  previous: MeasurementMode | null
): MeasurementMode | null {
  if (available.length === 0) return null;
  if (previous && available.includes(previous)) return previous;
  return available[0];
}

export function dateRangeLabel(range: DateRangeFilter): string {
  switch (range.preset) {
    case "all":
      return "All time";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "6m":
      return "Last 6 months";
    case "custom":
      return "Custom range";
  }
}

function isWithinDateRange(dateIso: string, range: DateRangeFilter): boolean {
  const date = new Date(dateIso).getTime();

  if (range.preset === "all") return true;

  if (range.preset === "custom") {
    const from = range.from ? new Date(range.from).getTime() : -Infinity;
    const to = range.to ? new Date(range.to).getTime() : Infinity;
    return date >= from && date <= to;
  }

  const days = range.preset === "30d" ? 30 : range.preset === "90d" ? 90 : 182;
  const cutoffMs = days * 24 * 60 * 60 * 1000;
  return date >= Date.now() - cutoffMs;
}

/** A block with fewer shots than this is flagged as a small sample, not hidden. */
export const SMALL_BLOCK_SHOT_THRESHOLD = 8;

export type HistoryAnalysisBlockContext = {
  block: TrainingBlock;
  session: Session;
  /** Already handle/shot-type/target-range filtered. */
  shots: Shot[];
  /** Original snapshot or the active Comparison preset — never mutates the block. */
  thresholds: AccuracyThresholds;
  /**
   * The per-side tolerance actually used to categorize this block's time
   * measurements. In "original" mode it is the block's own snapshot, which may be
   * asymmetric and must not be flattened to one number per band; in "comparison"
   * mode it is the symmetric pair the user explicitly chose to apply to everything.
   */
  timeTolerance: QuantityTolerance;
};

export type HistoryAnalysisContext = {
  filters: HistoryAnalysisFilters;
  availableTrainingCategories: TrainingCategory[];
  availableMeasurementModes: MeasurementMode[];
  availableMeasuredQuantities: MeasuredQuantity[];
  /** Handles actually present among the selection's shots (after all filters). */
  availableHandles: Handle[];
  blocks: HistoryAnalysisBlockContext[];
  /** Flat, shot-level, across every comparable block/session in the selection. */
  shots: Shot[];
  blocksById: Map<string, TrainingBlock>;
  sessionContextByBlockId: SessionContextByBlockId;
  progressEntries: ProgressBlockEntry[];
  sessionIds: string[];
  /** Blocks that actually contributed at least one shot to this selection. */
  totalBlockCount: number;
  totalShotCount: number;
  smallSampleBlockCount: number;
  /** Only meaningful in "original" threshold mode — comparison mode is always uniform by construction. */
  thresholdsVaryAcrossBlocks: boolean;
  hasBlindCategory: boolean;
};

/**
 * The central History filter pipeline: all historical sessions → extract
 * blocks/shots → apply `HistoryAnalysisFilters` → one shared context every
 * History analytics surface reads from. See the module doc comment above.
 */
export function buildHistoryAnalysisContext(
  sessions: Session[],
  filters: HistoryAnalysisFilters
): HistoryAnalysisContext {
  const availableTrainingCategories = getAvailableTrainingCategories(sessions);
  const availableMeasurementModes = getAvailableMeasurementModes(
    sessions,
    filters.trainingCategory
  );
  const availableMeasuredQuantities = getAvailableMeasuredQuantities(
    sessions,
    filters.trainingCategory
  );

  const matchingBlocks: HistoryAnalysisBlockContext[] = [];

  for (const session of sessions) {
    if (
      filters.sessionIds.length > 0 &&
      !filters.sessionIds.includes(session.id)
    ) {
      continue;
    }

    for (const block of session.blocks) {
      if (filters.trainingCategory && block.mode !== filters.trainingCategory) {
        continue;
      }

      const blockMeasurement = resolveBlockMeasurement(block);

      if (
        filters.measuredQuantity &&
        !blockMeasurement.quantities.includes(filters.measuredQuantity)
      ) {
        continue;
      }

      // Time-specific filters apply only to a TIME view.
      //
      // The timing interval qualifies a time measurement, so it can never exclude a
      // block that measures no time. It must also not exclude one when the athlete is
      // looking at SPEED: the interval control is hidden in that view, so a stale
      // value would silently remove a Both block's perfectly good speed records with
      // nothing on screen to explain it or undo it.
      const timeFiltersApply = filters.measuredQuantity !== "speed";

      if (
        timeFiltersApply &&
        filters.measurementMode &&
        blockMeasurement.quantities.includes("time") &&
        block.measurementMode !== filters.measurementMode
      ) {
        continue;
      }
      if (filters.blockIds.length > 0 && !filters.blockIds.includes(block.id)) {
        continue;
      }
      if (!isWithinDateRange(block.createdAt, filters.dateRange)) {
        continue;
      }

      const originalThresholds = resolveAccuracyThresholds(
        block.accuracyThresholds
      );
      const comparisonMode = filters.thresholdComparisonMode;
      const thresholds =
        comparisonMode.type === "comparison"
          ? comparisonMode.thresholds
          : originalThresholds;
      const timeTolerance =
        comparisonMode.type === "comparison"
          ? toleranceFromAccuracyThresholds(comparisonMode.thresholds)
          : blockTolerance(block, "time") ??
            toleranceFromAccuracyThresholds(originalThresholds);

      let shots = getBlockShots(session, block.id);

      if (filters.handles.length > 0) {
        shots = shots.filter((shot) => filters.handles.includes(shot.handle));
      }
      if (filters.shotTypes.length > 0) {
        shots = shots.filter(
          (shot) =>
            shot.shotType !== undefined &&
            filters.shotTypes.includes(shot.shotType)
        );
      }
      // A Target Time range filter can only ever select stones that have a time
      // target; one without is excluded rather than compared against undefined. It is
      // a TIME filter, so it applies neither to a block that measures no time nor in a
      // speed view, where a stale range would silently empty the selection.
      const timeRangeApplies =
        timeFiltersApply && blockMeasurement.quantities.includes("time");
      if (timeRangeApplies && filters.targetRange?.min !== undefined) {
        const min = filters.targetRange.min;
        shots = shots.filter(
          (shot) => shot.targetTime !== undefined && shot.targetTime >= min
        );
      }
      if (timeRangeApplies && filters.targetRange?.max !== undefined) {
        const max = filters.targetRange.max;
        shots = shots.filter(
          (shot) => shot.targetTime !== undefined && shot.targetTime <= max
        );
      }

      matchingBlocks.push({ block, session, shots, thresholds, timeTolerance });
    }
  }

  const shots = matchingBlocks.flatMap((entry) => entry.shots);
  const availableHandles = Array.from(
    new Set(shots.map((shot) => shot.handle))
  );

  const blocksById = new Map(
    matchingBlocks.map((entry) => [entry.block.id, entry.block])
  );
  const sessionContextByBlockId: SessionContextByBlockId = new Map(
    matchingBlocks.map((entry) => [
      entry.block.id,
      { sessionTitle: entry.session.title, date: entry.session.date },
    ])
  );

  // Progress is a TIME series keyed by timing interval, so a block that measures
  // no time contributes no entry at all — it is not plotted under a substituted
  // interval, and it is not silently merged into a Back-Hog series.
  const progressEntries: ProgressBlockEntry[] = matchingBlocks
    .filter(
      (entry): entry is typeof entry & { block: { measurementMode: MeasurementMode } } =>
        entry.block.measurementMode !== undefined
    )
    .map((entry) => ({
      blockId: entry.block.id,
      blockName: entry.block.name,
      sessionTitle: entry.session.title,
      date: entry.block.createdAt,
      measurementMode: entry.block.measurementMode,
      thresholds: entry.thresholds,
      // The same per-side tolerance aggregateTargetAccuracyAcrossBlocks uses, so the
      // progress series and the aggregate can never classify one shot differently.
      timeTolerance: entry.timeTolerance,
      shots: entry.shots,
      blockMode: blockModeLabel(entry.block.mode),
      targetDescription:
        entry.block.mode === "fixed" ||
        (entry.block.mode === "blind" &&
          entry.block.blindTargetMode === "fixed")
          ? entry.block.targetTime !== undefined
            ? `${entry.block.targetTime.toFixed(2)}s`
            : undefined
          : entry.block.smartRandomMin !== undefined &&
              entry.block.smartRandomMax !== undefined
            ? `${entry.block.smartRandomMin.toFixed(2)}s–${entry.block.smartRandomMax.toFixed(2)}s`
            : undefined,
    }));

  const blocksWithShots = matchingBlocks.filter(
    (entry) => entry.shots.length > 0
  );

  return {
    filters,
    availableTrainingCategories,
    availableMeasurementModes,
    availableMeasuredQuantities,
    availableHandles,
    blocks: matchingBlocks,
    shots,
    blocksById,
    sessionContextByBlockId,
    progressEntries,
    sessionIds: Array.from(
      new Set(blocksWithShots.map((entry) => entry.session.id))
    ),
    totalBlockCount: blocksWithShots.length,
    totalShotCount: shots.length,
    smallSampleBlockCount: blocksWithShots.filter(
      (entry) => entry.shots.length < SMALL_BLOCK_SHOT_THRESHOLD
    ).length,
    // Judged on the EFFECTIVE per-side tolerance, not the symmetric pair alone: two
    // blocks can share an `accuracyThresholds` pair while their real tolerances
    // differ, and saying they agree would let one band stand for both.
    thresholdsVaryAcrossBlocks:
      filters.thresholdComparisonMode.type === "original" &&
      !hasUniformTimeTolerance(blocksWithShots),
    hasBlindCategory: matchingBlocks.some(
      (entry) => entry.block.mode === "blind"
    ),
  };
}

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
 * Aggregates Target Accuracy across every block in the selection, correctly
 * even when blocks carry different threshold snapshots ("original" mode):
 * each shot is categorized (On Target/Acceptable/Major Miss) against its
 * *own* block's effective thresholds before counting, rather than against
 * one global threshold that wouldn't fairly represent every block. Bias/
 * Average Error/SD are threshold-independent and simply combine every shot.
 */
export function aggregateTargetAccuracyAcrossBlocks(
  blocks: HistoryAnalysisBlockContext[]
): TargetAccuracyAnalytics {
  const errors: number[] = [];
  let onTargetCount = 0;
  let acceptableCount = 0;
  let majorMissCount = 0;
  let positiveMajorMissCount = 0;
  let negativeMajorMissCount = 0;
  const majorMissAbsErrors: number[] = [];

  for (const entry of blocks) {
    // Only TIME-measured stones can be judged against a time tolerance. A stone
    // carrying no time is excluded from both the counts and the denominator below,
    // never counted as a perfectly on-target 0.0s error.
    for (const shot of timeMeasuredShots(entry.shots)) {
      const error = targetErrorForShot(shot);
      errors.push(error);
      const absError = Math.abs(error);
      const category = categorizeDeviation(error, entry.timeTolerance);

      if (category === "on_target") {
        onTargetCount += 1;
      } else if (category === "acceptable") {
        acceptableCount += 1;
      } else {
        majorMissCount += 1;
        majorMissAbsErrors.push(absError);
        if (error > 0) positiveMajorMissCount += 1;
        else if (error < 0) negativeMajorMissCount += 1;
      }
    }
  }

  const shotCount = errors.length;
  if (shotCount === 0) return EMPTY_TARGET_ACCURACY;

  const absErrors = errors.map((error) => Math.abs(error));

  return {
    shotCount,
    meanTargetError: average(errors),
    meanAbsoluteTargetError: average(absErrors),
    targetErrorStandardDeviation: standardDeviationOfValues(errors),
    onTargetCount,
    onTargetRate: onTargetCount / shotCount,
    acceptableCount,
    acceptableRate: acceptableCount / shotCount,
    majorMissCount,
    majorMissRate: majorMissCount / shotCount,
    largestAbsoluteMiss: Math.max(...absErrors),
    averageMajorMiss:
      majorMissCount > 0 ? average(majorMissAbsErrors) : null,
    positiveMajorMissCount,
    negativeMajorMissCount,
  };
}

/**
 * The per-quantity counterpart of `aggregateTargetAccuracyAcrossBlocks`.
 *
 * Each block is judged against ITS OWN tolerance snapshot for that quantity and only
 * the stones that genuinely carry it take part, so a selection spanning different
 * tolerances is still counted the way each block was actually trained, and a stone
 * missing that measurement never enters the denominator as a perfect zero.
 *
 * Seconds and metres per second are never aggregated together: this is called once per
 * quantity, with that quantity's own tolerances.
 */
export function aggregateQuantityAccuracyAcrossBlocks(
  blocks: HistoryAnalysisBlockContext[],
  quantity: MeasuredQuantity
): TargetAccuracyAnalytics {
  const deviations: number[] = [];
  const categories: TargetErrorCategory[] = [];

  for (const entry of blocks) {
    const tolerance =
      quantity === "time"
        ? entry.timeTolerance
        : blockTolerance(entry.block, quantity);
    if (!tolerance) continue;

    for (const shot of entry.shots) {
      const deviation = shotDeviation(shot, quantity);
      if (deviation === null) continue;
      deviations.push(deviation);
      categories.push(categorizeDeviation(deviation, tolerance));
    }
  }

  if (deviations.length === 0) return EMPTY_TARGET_ACCURACY;

  const absolute = deviations.map((deviation) => Math.abs(deviation));
  const majorMissAbsolute = deviations
    .filter((_unused, index) => categories[index] === "major_miss")
    .map((deviation) => Math.abs(deviation));
  const count = deviations.length;
  const onTargetCount = categories.filter((c) => c === "on_target").length;
  const acceptableCount = categories.filter((c) => c === "acceptable").length;
  const majorMissCount = categories.filter((c) => c === "major_miss").length;

  return {
    shotCount: count,
    meanTargetError: average(deviations),
    meanAbsoluteTargetError: average(absolute),
    targetErrorStandardDeviation: standardDeviationOfValues(deviations),
    onTargetCount,
    onTargetRate: onTargetCount / count,
    acceptableCount,
    acceptableRate: acceptableCount / count,
    majorMissCount,
    majorMissRate: majorMissCount / count,
    largestAbsoluteMiss: Math.max(...absolute),
    averageMajorMiss:
      majorMissCount > 0 ? average(majorMissAbsolute) : null,
    positiveMajorMissCount: deviations.filter(
      (deviation, index) =>
        categories[index] === "major_miss" && deviation > 0
    ).length,
    negativeMajorMissCount: deviations.filter(
      (deviation, index) =>
        categories[index] === "major_miss" && deviation < 0
    ).length,
  };
}

/**
 * A single representative AccuracyThresholds for display purposes only (e.g.
 * "within ±0.10s" labels, Handle Analysis) when a selection's blocks don't
 * all share the same snapshot — never used to *categorize* shots (see
 * `aggregateTargetAccuracyAcrossBlocks`, which categorizes per-block
 * correctly instead). Falls back to the legacy default, same precedent as
 * the previous session-level rollup.
 */
export function representativeThresholds(
  blocks: HistoryAnalysisBlockContext[]
) {
  if (blocks.length === 0) return resolveAccuracyThresholds(undefined);
  return hasUniformThresholds(blocks.map((entry) => entry.thresholds))
    ? blocks[0].thresholds
    : resolveAccuracyThresholds(undefined);
}

/**
 * The per-side counterpart of `representativeThresholds`, for the one rollup that
 * genuinely does categorize across a whole selection. When every selected block shares
 * the same effective tolerance that tolerance is used exactly — including an
 * asymmetric one, which the symmetric pair above cannot represent. A mixed selection
 * has no single honest answer, so it falls back to the legacy default, same precedent
 * as `representativeThresholds`; per-block correctness lives in
 * `aggregateTargetAccuracyAcrossBlocks`.
 */
/** Whether every selected block classifies time against the same per-side tolerance. */
export function hasUniformTimeTolerance(
  blocks: HistoryAnalysisBlockContext[]
): boolean {
  if (blocks.length <= 1) return true;
  const [first, ...rest] = blocks;
  return rest.every(
    (entry) =>
      entry.timeTolerance.onTarget.lower === first.timeTolerance.onTarget.lower &&
      entry.timeTolerance.onTarget.upper === first.timeTolerance.onTarget.upper &&
      entry.timeTolerance.acceptable.lower === first.timeTolerance.acceptable.lower &&
      entry.timeTolerance.acceptable.upper === first.timeTolerance.acceptable.upper
  );
}

export function representativeTimeTolerance(
  blocks: HistoryAnalysisBlockContext[]
): QuantityTolerance {
  const fallback = toleranceFromAccuracyThresholds(
    resolveAccuracyThresholds(undefined)
  );
  if (blocks.length === 0) return fallback;

  return hasUniformTimeTolerance(blocks) ? blocks[0].timeTolerance : fallback;
}
