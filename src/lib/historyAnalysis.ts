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
  MeasurementMode,
  Session,
  Shot,
  ShotType,
  TrainingBlock,
} from "../types";
import {
  categorizeTargetError,
  resolveAccuracyThresholds,
  validateAccuracyThresholds,
} from "./accuracyThresholds";
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
      set.add(block.measurementMode);
    })
  );
  return Array.from(set);
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
};

export type HistoryAnalysisContext = {
  filters: HistoryAnalysisFilters;
  availableTrainingCategories: TrainingCategory[];
  availableMeasurementModes: MeasurementMode[];
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
      if (
        filters.measurementMode &&
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
      const thresholds =
        filters.thresholdComparisonMode.type === "comparison"
          ? filters.thresholdComparisonMode.thresholds
          : originalThresholds;

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
      if (filters.targetRange?.min !== undefined) {
        const min = filters.targetRange.min;
        shots = shots.filter((shot) => shot.targetTime >= min);
      }
      if (filters.targetRange?.max !== undefined) {
        const max = filters.targetRange.max;
        shots = shots.filter((shot) => shot.targetTime <= max);
      }

      matchingBlocks.push({ block, session, shots, thresholds });
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

  const progressEntries: ProgressBlockEntry[] = matchingBlocks.map(
    (entry) => ({
      blockId: entry.block.id,
      blockName: entry.block.name,
      sessionTitle: entry.session.title,
      date: entry.block.createdAt,
      measurementMode: entry.block.measurementMode,
      thresholds: entry.thresholds,
      shots: entry.shots,
      blockMode: blockModeLabel(entry.block.mode),
      targetDescription:
        entry.block.mode === "fixed" ||
        (entry.block.mode === "blind" &&
          entry.block.blindTargetMode === "fixed")
          ? `${entry.block.targetTime.toFixed(2)}s`
          : entry.block.smartRandomMin !== undefined &&
              entry.block.smartRandomMax !== undefined
            ? `${entry.block.smartRandomMin.toFixed(2)}s–${entry.block.smartRandomMax.toFixed(2)}s`
            : undefined,
    })
  );

  const blocksWithShots = matchingBlocks.filter(
    (entry) => entry.shots.length > 0
  );

  return {
    filters,
    availableTrainingCategories,
    availableMeasurementModes,
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
    thresholdsVaryAcrossBlocks:
      filters.thresholdComparisonMode.type === "original" &&
      !hasUniformThresholds(
        blocksWithShots.map((entry) =>
          resolveAccuracyThresholds(entry.block.accuracyThresholds)
        )
      ),
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
    for (const shot of entry.shots) {
      const error = targetErrorForShot(shot);
      errors.push(error);
      const absError = Math.abs(error);
      const category = categorizeTargetError(absError, entry.thresholds);

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
