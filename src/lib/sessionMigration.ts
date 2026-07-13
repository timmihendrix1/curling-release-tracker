import type {
  BlindTargetMode,
  BlockMode,
  CaptureHandleMode,
  CaptureSequence,
  CaptureSequenceStatus,
  CaptureStepRecord,
  MeasurementMode,
  Session,
  Shot,
  ShotType,
  TimingProviderType,
  TrainingBlock,
  VariableTargetMode,
} from "../types";
import { sanitizeCaptureSequence } from "./captureSequence";
import { getEffectiveTargetMode } from "./trainingBlocks";
import {
  DEFAULT_SMART_RANDOM_MAX,
  DEFAULT_SMART_RANDOM_MIN,
  generateSmartRandomTarget,
  isSmartRandomAvailable,
} from "./variableTargets";

const VALID_BLOCK_MODES: BlockMode[] = ["fixed", "variable", "blind"];
const VALID_MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];
const VALID_VARIABLE_TARGET_MODES: VariableTargetMode[] = [
  "smart-random",
  "manual",
];
const VALID_BLIND_TARGET_MODES: BlindTargetMode[] = [
  "fixed",
  "smart-random",
  "manual",
];
const VALID_CAPTURE_STATUSES: CaptureSequenceStatus[] = [
  "ready",
  "running",
  "paused",
  "completed",
  "cancelled",
];
const VALID_CAPTURE_HANDLE_MODES: CaptureHandleMode[] = [
  "manual",
  "fixed-in",
  "fixed-out",
  "alternate",
];
const VALID_TIMING_PROVIDER_TYPES: TimingProviderType[] = [
  "simulator",
  "manual",
  "external",
];
const DEFAULT_TARGET_TIME = 3.75;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeShotType(value: unknown): ShotType | undefined {
  if (value === "draw" || value === "takeout") return value;
  // Genuinely absent (undefined/null) — most commonly a Blind Weight shot,
  // which never requires one. Never invent a shot type to fill the gap.
  if (value === undefined || value === null) return undefined;
  // Legacy sessions could contain "guard" or "other" — both fold into "draw".
  return "draw";
}

function normalizeBlockMode(value: unknown): BlockMode {
  return VALID_BLOCK_MODES.includes(value as BlockMode)
    ? (value as BlockMode)
    : "fixed";
}

function normalizeMeasurementMode(value: unknown): MeasurementMode {
  return VALID_MEASUREMENT_MODES.includes(value as MeasurementMode)
    ? (value as MeasurementMode)
    : "back-hog";
}

function normalizeVariableTargetMode(
  value: unknown
): VariableTargetMode | undefined {
  return VALID_VARIABLE_TARGET_MODES.includes(value as VariableTargetMode)
    ? (value as VariableTargetMode)
    : undefined;
}

function normalizeBlindTargetMode(
  value: unknown
): BlindTargetMode | undefined {
  return VALID_BLIND_TARGET_MODES.includes(value as BlindTargetMode)
    ? (value as BlindTargetMode)
    : undefined;
}

function createLegacyBlock(raw: Record<string, unknown>): TrainingBlock {
  return {
    id: crypto.randomUUID(),
    name: "Legacy Block",
    mode: "fixed",
    measurementMode: "back-hog",
    targetTime:
      typeof raw.targetTime === "number" ? raw.targetTime : DEFAULT_TARGET_TIME,
    createdAt: typeof raw.date === "string" ? raw.date : new Date().toISOString(),
  };
}

/**
 * A session genuinely has no blocks yet (fresh session, first block not
 * configured) whenever `blocks` is present as an array — even an empty one.
 * Only the *absence* of a `blocks` array at all means this is pre-block-
 * architecture legacy data that needs a fabricated block to hold its shots.
 */
function migrateBlocks(raw: Record<string, unknown>): TrainingBlock[] {
  if (Array.isArray(raw.blocks)) {
    return raw.blocks.map((block) => {
      const rawBlock = isRecord(block) ? block : {};
      const mode = normalizeBlockMode(rawBlock.mode);

      const variableTargetMode =
        mode === "variable"
          ? normalizeVariableTargetMode(rawBlock.variableTargetMode) ?? "manual"
          : undefined;

      // Blind Weight's fallback differs from Variable Weight's: prefer a
      // constant Fixed target (Blind Weight's simplest, most conservative
      // mode) when the block already had a genuine configured targetTime;
      // only fall back to Manual if there was nothing to anchor a fixed
      // target on at all.
      const blindTargetMode =
        mode === "blind"
          ? normalizeBlindTargetMode(rawBlock.blindTargetMode) ??
            (typeof rawBlock.targetTime === "number" ? "fixed" : "manual")
          : undefined;

      return {
        id: typeof rawBlock.id === "string" ? rawBlock.id : crypto.randomUUID(),
        name: typeof rawBlock.name === "string" ? rawBlock.name : "Block",
        mode,
        measurementMode: normalizeMeasurementMode(rawBlock.measurementMode),
        targetTime:
          typeof rawBlock.targetTime === "number"
            ? rawBlock.targetTime
            : DEFAULT_TARGET_TIME,
        createdAt:
          typeof rawBlock.createdAt === "string"
            ? rawBlock.createdAt
            : new Date().toISOString(),
        completedAt:
          typeof rawBlock.completedAt === "string"
            ? rawBlock.completedAt
            : undefined,
        variableTargetMode,
        blindTargetMode,
        pendingTargetTime:
          (mode === "variable" || mode === "blind") &&
          typeof rawBlock.pendingTargetTime === "number"
            ? rawBlock.pendingTargetTime
            : undefined,
        smartRandomMin:
          (mode === "variable" || mode === "blind") &&
          typeof rawBlock.smartRandomMin === "number"
            ? rawBlock.smartRandomMin
            : undefined,
        smartRandomMax:
          (mode === "variable" || mode === "blind") &&
          typeof rawBlock.smartRandomMax === "number"
            ? rawBlock.smartRandomMax
            : undefined,
      };
    });
  }

  return [createLegacyBlock(raw)];
}

function migrateShots(
  raw: Record<string, unknown>,
  sessionId: string,
  blocks: TrainingBlock[],
  blockIds: Set<string>,
  fallbackBlockId: string
): Shot[] {
  const rawShots = Array.isArray(raw.shots) ? raw.shots : [];
  const blockById = new Map(blocks.map((block) => [block.id, block]));

  return rawShots.map((shot, index) => {
    const rawShot = isRecord(shot) ? shot : {};

    const blockId =
      typeof rawShot.blockId === "string" && blockIds.has(rawShot.blockId)
        ? rawShot.blockId
        : fallbackBlockId;

    const targetTime =
      typeof rawShot.targetTime === "number"
        ? rawShot.targetTime
        : blockById.get(blockId)?.targetTime ?? DEFAULT_TARGET_TIME;

    return {
      id: typeof rawShot.id === "string" ? rawShot.id : crypto.randomUUID(),
      sessionId,
      blockId,
      shotNumber:
        typeof rawShot.shotNumber === "number" ? rawShot.shotNumber : index + 1,
      releaseTime:
        typeof rawShot.releaseTime === "number" ? rawShot.releaseTime : 0,
      targetTime,
      predictedTime:
        typeof rawShot.predictedTime === "number"
          ? rawShot.predictedTime
          : undefined,
      handle: rawShot.handle === "out" ? "out" : "in",
      shotType: normalizeShotType(rawShot.shotType),
      comment: typeof rawShot.comment === "string" ? rawShot.comment : undefined,
      createdAt:
        typeof rawShot.createdAt === "string"
          ? rawShot.createdAt
          : new Date().toISOString(),
      // Capture-sequence metadata: purely optional, purely pass-through. A shot
      // that never went through a capture sequence simply never had these set —
      // migration must never invent a measurementSource for a classic manual shot.
      measurementSource: VALID_TIMING_PROVIDER_TYPES.includes(
        rawShot.measurementSource as TimingProviderType
      )
        ? (rawShot.measurementSource as TimingProviderType)
        : undefined,
      captureSequenceId:
        typeof rawShot.captureSequenceId === "string"
          ? rawShot.captureSequenceId
          : undefined,
      timingResultId:
        typeof rawShot.timingResultId === "string"
          ? rawShot.timingResultId
          : undefined,
      deviceId: typeof rawShot.deviceId === "string" ? rawShot.deviceId : undefined,
      laneId: typeof rawShot.laneId === "string" ? rawShot.laneId : undefined,
    };
  });
}

/**
 * Validates a persisted `session.captureSequence`. Anything fundamentally broken
 * (no valid block reference, no usable expected shot count) is discarded entirely
 * rather than repaired — a capture sequence that can't be tied to a real block isn't
 * safely resumable. A sequence still "running" when the app last closed is forced to
 * "paused": auto-capture must never silently keep listening after a reload; the user
 * has to explicitly press Resume.
 *
 * After this structural coercion, `sanitizeCaptureSequence` (captureSequence.ts)
 * cross-checks the result against `shots` — the actually-saved shots are the primary
 * source of truth, so `capturedShotCount` and `steps` are reconciled against them
 * rather than trusted as separately-stored numbers (see that function's doc comment
 * for the exact repair rules).
 */
function migrateCaptureSequence(
  raw: Record<string, unknown>,
  sessionId: string,
  blockIds: Set<string>,
  shots: Shot[]
): CaptureSequence | undefined {
  if (!isRecord(raw.captureSequence)) return undefined;
  const rawSequence = raw.captureSequence;

  const blockId =
    typeof rawSequence.blockId === "string" ? rawSequence.blockId : undefined;
  const expectedShotCount =
    typeof rawSequence.expectedShotCount === "number"
      ? rawSequence.expectedShotCount
      : undefined;

  if (!blockId || !blockIds.has(blockId)) return undefined;
  if (!Number.isInteger(expectedShotCount) || (expectedShotCount ?? 0) <= 0) {
    return undefined;
  }

  const rawSteps = Array.isArray(rawSequence.steps) ? rawSequence.steps : [];

  const steps: CaptureStepRecord[] = rawSteps
    .filter(isRecord)
    .filter(
      (step) =>
        typeof step.resultId === "string" &&
        typeof step.shotId === "string" &&
        typeof step.targetTime === "number"
    )
    .map((step) => ({
      resultId: step.resultId as string,
      shotId: step.shotId as string,
      targetTime: step.targetTime as number,
      previousPendingTargetTime:
        typeof step.previousPendingTargetTime === "number"
          ? step.previousPendingTargetTime
          : undefined,
      nextPendingTargetTime:
        typeof step.nextPendingTargetTime === "number"
          ? step.nextPendingTargetTime
          : undefined,
      handle: step.handle === "out" ? "out" : "in",
    }));

  const processedResultIds = Array.isArray(rawSequence.processedResultIds)
    ? rawSequence.processedResultIds.filter(
        (resultId): resultId is string => typeof resultId === "string"
      )
    : steps.map((step) => step.resultId);

  const rawStatus = VALID_CAPTURE_STATUSES.includes(
    rawSequence.status as CaptureSequenceStatus
  )
    ? (rawSequence.status as CaptureSequenceStatus)
    : "paused";

  const status: CaptureSequenceStatus =
    rawStatus === "running" ? "paused" : rawStatus;

  const id =
    typeof rawSequence.id === "string" ? rawSequence.id : crypto.randomUUID();

  const coerced: CaptureSequence = {
    id,
    sessionId,
    blockId,
    expectedShotCount: expectedShotCount as number,
    capturedShotCount: steps.length,
    status,
    providerType: VALID_TIMING_PROVIDER_TYPES.includes(
      rawSequence.providerType as TimingProviderType
    )
      ? (rawSequence.providerType as TimingProviderType)
      : "manual",
    handleMode: VALID_CAPTURE_HANDLE_MODES.includes(
      rawSequence.handleMode as CaptureHandleMode
    )
      ? (rawSequence.handleMode as CaptureHandleMode)
      : "manual",
    startHandle: rawSequence.startHandle === "out" ? "out" : "in",
    shotType: normalizeShotType(rawSequence.shotType),
    processedResultIds,
    steps,
    startedAt:
      typeof rawSequence.startedAt === "string" ? rawSequence.startedAt : undefined,
    pausedAt:
      rawStatus === "running"
        ? new Date().toISOString()
        : typeof rawSequence.pausedAt === "string"
          ? rawSequence.pausedAt
          : undefined,
    completedAt:
      typeof rawSequence.completedAt === "string"
        ? rawSequence.completedAt
        : undefined,
    cancelledAt:
      typeof rawSequence.cancelledAt === "string"
        ? rawSequence.cancelledAt
        : undefined,
    lastError:
      typeof rawSequence.lastError === "string" ? rawSequence.lastError : undefined,
  };

  const shotsForThisSequence = shots.filter((shot) => shot.captureSequenceId === id);

  return sanitizeCaptureSequence(coerced, shotsForThisSequence);
}

/**
 * Backfills `pendingTargetTime` (and, for Smart Random blocks, the
 * `smartRandomMin`/`smartRandomMax` range) for Variable/Blind blocks that
 * don't have it yet, based on their own shots so a reload doesn't lose or
 * arbitrarily change the in-progress target. Already idempotent: once a
 * block's pendingTargetTime falls within its (now-set) range, re-running
 * migration leaves it untouched.
 */
function backfillPendingTargets(
  blocks: TrainingBlock[],
  shots: Shot[]
): TrainingBlock[] {
  return blocks.map((block) => {
    if (block.mode !== "variable" && block.mode !== "blind") return block;

    const effectiveMode = getEffectiveTargetMode(block);
    const blockShots = shots.filter((shot) => shot.blockId === block.id);

    if (effectiveMode === undefined || effectiveMode === "fixed") {
      // Blind+Fixed (or an unresolvable Variable block, which shouldn't
      // occur since normalizeVariableTargetMode always defaults to
      // "manual"): no pendingTargetTime/range needed, block.targetTime
      // suffices directly.
      return block;
    }

    if (effectiveMode === "smart-random") {
      // A smart-random block whose measurement mode has no valid range is
      // invalid under the current model — this can only happen for data
      // created under the earlier bug that shared the Back-Hog range with
      // Hog-Hog. Force it to Manual going forward. Manual blocks carry no
      // Smart Random range. Already-recorded shot targets are never
      // touched, only the not-yet-used pendingTargetTime; its previous
      // (possibly bug-affected) numeric value is kept only as a
      // freely-editable manual starting point, not as a validated range.
      if (!isSmartRandomAvailable(block.measurementMode)) {
        const lastShotTarget = blockShots.at(-1)?.targetTime;
        const fallback: TrainingBlock = {
          ...block,
          smartRandomMin: undefined,
          smartRandomMax: undefined,
          pendingTargetTime:
            block.pendingTargetTime ?? lastShotTarget ?? block.targetTime,
        };

        return block.mode === "variable"
          ? { ...fallback, variableTargetMode: "manual" }
          : { ...fallback, blindTargetMode: "manual" };
      }

      const min = block.smartRandomMin ?? DEFAULT_SMART_RANDOM_MIN;
      const max = block.smartRandomMax ?? DEFAULT_SMART_RANDOM_MAX;
      const recentTargets = blockShots.map((shot) => shot.targetTime);

      const pendingWithinRange =
        block.pendingTargetTime !== undefined &&
        block.pendingTargetTime >= min &&
        block.pendingTargetTime <= max;

      return {
        ...block,
        smartRandomMin: min,
        smartRandomMax: max,
        pendingTargetTime: pendingWithinRange
          ? block.pendingTargetTime
          : generateSmartRandomTarget({ min, max, recentTargets }),
      };
    }

    // "manual"
    if (block.pendingTargetTime !== undefined) return block;

    const lastShotTarget = blockShots.at(-1)?.targetTime;
    return { ...block, pendingTargetTime: lastShotTarget ?? block.targetTime };
  });
}

export function migrateSession(raw: unknown): Session {
  const source = isRecord(raw) ? raw : {};

  const id = typeof source.id === "string" ? source.id : crypto.randomUUID();
  const blocks = migrateBlocks(source);
  const blockIds = new Set(blocks.map((block) => block.id));
  const fallbackBlockId = blocks.length > 0 ? blocks[blocks.length - 1].id : "";

  const shots = migrateShots(source, id, blocks, blockIds, fallbackBlockId);
  const patchedBlocks = backfillPendingTargets(blocks, shots);

  const activeBlockId =
    typeof source.activeBlockId === "string" && blockIds.has(source.activeBlockId)
      ? source.activeBlockId
      : fallbackBlockId;

  const captureSequence = migrateCaptureSequence(source, id, blockIds, shots);

  return {
    id,
    title: typeof source.title === "string" ? source.title : "Training Session",
    date: typeof source.date === "string" ? source.date : new Date().toISOString(),
    notes: typeof source.notes === "string" ? source.notes : "",
    blocks: patchedBlocks,
    activeBlockId,
    shots,
    captureSequence,
  };
}

export function migrateSessionHistory(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => migrateSession(item));
}
