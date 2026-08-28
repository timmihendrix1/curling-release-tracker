import type {
  AccuracyThresholds,
  BlindTargetMode,
  BlockMode,
  CaptureHandleMode,
  CaptureSequence,
  CaptureSequenceStatus,
  CaptureStepRecord,
  CuratedExercisePlanStep,
  HandleStrategy,
  MeasurementMode,
  PlanExecutionState,
  PlanExecutionStepSnapshot,
  ReleaseTimingBlockConfiguration,
  ReleaseTimingPlanStep,
  Session,
  ShotCountCompletion,
  Shot,
  ShotType,
  TimingProviderType,
  TrainingBlock,
  VariableTargetMode,
} from "../types";
import { resolveAccuracyThresholds } from "./accuracyThresholds";
import { sanitizeCaptureSequence } from "./captureSequence";
import { EXERCISE_CATALOG } from "./exercises/catalog";
import { RELEASE_TIME_VERSION_ID } from "./exercises/content";
import { exerciseRunnerKind, findExerciseVersion } from "./exercises/lookup";
import type { ExerciseVersion } from "./exercises/types";
import { validateSessionExerciseState } from "./exercises/sessionIntegration";
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

/**
 * Parses a possibly-absent, possibly-malformed raw `accuracyThresholds`
 * value into a well-typed candidate (or undefined) for
 * `resolveAccuracyThresholds` to validate/repair. Never itself decides
 * validity — that's `resolveAccuracyThresholds`'s job, so the same
 * validation rule is applied uniformly whether the value came from
 * migration or from a freshly created block.
 */
function parseRawAccuracyThresholds(
  value: unknown
): AccuracyThresholds | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.onTarget !== "number" ||
    typeof value.acceptable !== "number"
  ) {
    return undefined;
  }

  return { onTarget: value.onTarget, acceptable: value.acceptable };
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
    // No accuracyThresholds could ever have existed on genuinely legacy,
    // pre-block data — resolves to the legacy default (0.10s / 0.20s).
    accuracyThresholds: resolveAccuracyThresholds(undefined),
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
        // Absent or invalid (NaN/Infinity/<=0/acceptable<=onTarget) always
        // repairs to the legacy default (0.10s / 0.20s) — never derived from
        // whichever preset happens to be selected in the app today.
        accuracyThresholds: resolveAccuracyThresholds(
          parseRawAccuracyThresholds(rawBlock.accuracyThresholds)
        ),
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

function isValidHandleStrategy(value: unknown): value is HandleStrategy {
  if (!isRecord(value)) return false;
  if (value.type === "free") return true;
  if (value.type === "fixed") return value.handle === "in" || value.handle === "out";
  if (value.type === "alternating") {
    return value.startingHandle === "in" || value.startingHandle === "out";
  }
  return false;
}

function isValidShotCountCompletion(value: unknown): value is ShotCountCompletion {
  return (
    isRecord(value) &&
    value.type === "shot-count" &&
    typeof value.value === "number" &&
    Number.isInteger(value.value) &&
    value.value > 0
  );
}

function isValidReleaseTimingBlockConfiguration(
  value: unknown
): value is ReleaseTimingBlockConfiguration {
  if (!isRecord(value)) return false;
  if (!isRecord(value.accuracyThresholds)) return false;

  return (
    typeof value.name === "string" &&
    VALID_BLOCK_MODES.includes(value.mode as BlockMode) &&
    VALID_MEASUREMENT_MODES.includes(value.measurementMode as MeasurementMode) &&
    typeof value.targetTime === "number" &&
    VALID_VARIABLE_TARGET_MODES.includes(
      value.variableTargetMode as VariableTargetMode
    ) &&
    VALID_BLIND_TARGET_MODES.includes(value.blindTargetMode as BlindTargetMode) &&
    typeof value.smartRandomMin === "number" &&
    typeof value.smartRandomMax === "number" &&
    typeof value.accuracyThresholds.onTarget === "number" &&
    typeof value.accuracyThresholds.acceptable === "number"
  );
}

function isValidReleaseTimingPlanStep(
  value: unknown
): value is ReleaseTimingPlanStep {
  if (!(
    isRecord(value) &&
    typeof value.id === "string" &&
    value.type === "release-timing" &&
    isValidCatalogVersionSnapshot(value.exerciseVersionSnapshot, "measured") &&
    isValidShotCountCompletion(value.completion) &&
    isValidHandleStrategy(value.handleStrategy) &&
    isValidReleaseTimingBlockConfiguration(value.configuration)
  )) return false;

  return exerciseRunnerKind(
    EXERCISE_CATALOG,
    value.exerciseVersionSnapshot
  ) === "release-timing";
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isValidCatalogVersionSnapshot(
  value: unknown,
  expectedFocus?: ExerciseVersion["primaryFocus"]
): value is ExerciseVersion {
  if (!isRecord(value) || typeof value.id !== "string") return false;
  const catalogVersion = findExerciseVersion(EXERCISE_CATALOG, value.id);
  return catalogVersion !== undefined &&
    (expectedFocus === undefined || catalogVersion.primaryFocus === expectedFocus) &&
    sameJsonValue(catalogVersion, value);
}

function isValidCuratedExercisePlanStep(
  value: unknown
): value is CuratedExercisePlanStep {
  return isRecord(value) &&
    typeof value.id === "string" &&
    value.type === "curated-exercise" &&
    isRecord(value.completion) &&
    value.completion.type === "exercise-completion" &&
    isValidCatalogVersionSnapshot(value.exerciseVersionSnapshot) &&
    exerciseRunnerKind(
      EXERCISE_CATALOG,
      value.exerciseVersionSnapshot
    ) === "exercise-execution";
}

function legacyReleaseTimingStep(value: unknown): ReleaseTimingPlanStep | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.type !== "release-timing" ||
    !isValidShotCountCompletion(value.completion) ||
    !isValidHandleStrategy(value.handleStrategy) ||
    !isValidReleaseTimingBlockConfiguration(value.configuration)
  ) return undefined;
  const version = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
  if (!version) return undefined;
  return {
    id: value.id,
    type: "release-timing",
    exerciseVersionSnapshot: JSON.parse(JSON.stringify(version)) as ExerciseVersion,
    completion: value.completion,
    handleStrategy: value.handleStrategy,
    configuration: value.configuration,
  };
}

/**
 * `Session.planExecution` has strict cross-field invariants — `activeStepIndex` must
 * validly index `steps`; every step at or before `activeStepIndex` must carry a typed
 * runtime reference that resolves to a real, already-migrated Block or Exercise
 * Execution; every step after it must not have one yet (lazy materialisation — see
 * ADR-0012/0040) — much closer to
 * AssessmentRun's invariants than to a TrainingBlock's independently-optional fields.
 * So, unlike `migrateBlocks`/`migrateShots`'s field-by-field repair style, a
 * structurally invalid `planExecution` is discarded whole rather than partially
 * repaired: patching one field in isolation (e.g. clamping an out-of-range
 * `activeStepIndex`) risks silently attributing the wrong block to the wrong step.
 * Discarding only ever loses the plan-progress *decoration* on a Session — `blocks`/
 * `shots` (the actual training data) are migrated independently, before this runs,
 * and are never affected by a corrupt or missing `planExecution`.
 */
function migratePlanExecution(
  raw: Record<string, unknown>,
  blockIds: Set<string>,
  exerciseExecutions: Map<string, ExerciseVersion>
): PlanExecutionState | undefined {
  if (!isRecord(raw.planExecution)) return undefined;
  const rawExecution = raw.planExecution;

  if (
    typeof rawExecution.sourcePlanId !== "string" ||
    typeof rawExecution.sourcePlanName !== "string" ||
    !Array.isArray(rawExecution.steps) ||
    rawExecution.steps.length === 0 ||
    typeof rawExecution.activeStepIndex !== "number" ||
    !Number.isInteger(rawExecution.activeStepIndex) ||
    rawExecution.activeStepIndex < 0 ||
    rawExecution.activeStepIndex >= rawExecution.steps.length
  ) {
    return undefined;
  }

  const activeStepIndex = rawExecution.activeStepIndex;
  const steps: PlanExecutionStepSnapshot[] = [];

  for (let index = 0; index < rawExecution.steps.length; index += 1) {
    const rawSnapshot = rawExecution.steps[index];

    if (!isRecord(rawSnapshot)) {
      return undefined;
    }

    const step = isValidReleaseTimingPlanStep(rawSnapshot.step) ||
      isValidCuratedExercisePlanStep(rawSnapshot.step)
      ? rawSnapshot.step
      : legacyReleaseTimingStep(rawSnapshot.step);
    if (!step) return undefined;

    const legacyBlockId = typeof rawSnapshot.blockId === "string"
      ? rawSnapshot.blockId
      : undefined;
    const rawRuntime = isRecord(rawSnapshot.runtime) ? rawSnapshot.runtime : undefined;
    const runtime = legacyBlockId
      ? { kind: "release-timing-block" as const, blockId: legacyBlockId }
      : rawRuntime?.kind === "release-timing-block" && typeof rawRuntime.blockId === "string"
        ? { kind: "release-timing-block" as const, blockId: rawRuntime.blockId }
        : rawRuntime?.kind === "exercise-execution" && typeof rawRuntime.exerciseExecutionId === "string"
          ? { kind: "exercise-execution" as const, exerciseExecutionId: rawRuntime.exerciseExecutionId }
          : undefined;

    if (index <= activeStepIndex) {
      if (!runtime) return undefined;
      if (
        (step.type === "release-timing" &&
          (runtime.kind !== "release-timing-block" || !blockIds.has(runtime.blockId))) ||
        (step.type === "curated-exercise" &&
          (runtime.kind !== "exercise-execution" ||
            !exerciseExecutions.has(runtime.exerciseExecutionId) ||
            exerciseExecutions.get(runtime.exerciseExecutionId)?.id !==
              step.exerciseVersionSnapshot.id))
      ) return undefined;
    } else if (runtime !== undefined) {
      // A not-yet-reached step must not have a runtime entity yet — this can't be
      // repaired by guessing which of the two is wrong.
      return undefined;
    }

    steps.push({ step, runtime });
  }

  return {
    sourcePlanId: rawExecution.sourcePlanId,
    sourcePlanName: rawExecution.sourcePlanName,
    sourcePlanUpdatedAt:
      typeof rawExecution.sourcePlanUpdatedAt === "string"
        ? rawExecution.sourcePlanUpdatedAt
        : undefined,
    steps,
    activeStepIndex,
  };
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
  const exerciseState = validateSessionExerciseState(source, id);
  const exerciseExecutions = new Map(
    exerciseState.valid
      ? exerciseState.executions.map((execution) => [
          execution.id,
          execution.exerciseVersionSnapshot,
        ])
      : []
  );
  const planExecution = migratePlanExecution(source, blockIds, exerciseExecutions);

  return {
    id,
    title: typeof source.title === "string" ? source.title : "Training Session",
    date: typeof source.date === "string" ? source.date : new Date().toISOString(),
    notes: typeof source.notes === "string" ? source.notes : "",
    blocks: patchedBlocks,
    activeBlockId,
    shots,
    captureSequence,
    planExecution,
    ...(exerciseState.valid && source.exerciseExecutions !== undefined
      ? { exerciseExecutions: exerciseState.executions }
      : {}),
    ...(exerciseState.valid && exerciseState.activeExecutionId !== undefined
      ? { activeExerciseExecutionId: exerciseState.activeExecutionId }
      : {}),
    ...(exerciseState.valid && source.releaseTimingExerciseVersionSnapshot !== undefined
      ? {
          releaseTimingExerciseVersionSnapshot:
            JSON.parse(
              JSON.stringify(source.releaseTimingExerciseVersionSnapshot)
            ) as Session["releaseTimingExerciseVersionSnapshot"],
        }
      : {}),
  };
}

export function migrateSessionHistory(raw: unknown): Session[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => migrateSession(item));
}

/**
 * A brand-new, never-stored Session — with `blocks: []`, never a fabricated Legacy
 * Block. Moved here (from TrackerApp.tsx) so SessionRepository's `loadCurrent()` can
 * use the exact same constructor for its "absent" and "read_failed" fallback cases
 * without duplicating this shape — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.1 for why
 * absence must never be satisfied by calling migrateSession(null)/(undefined) instead.
 */
export function createNewSession(): Session {
  return {
    id: crypto.randomUUID(),
    title: "Training Session",
    date: new Date().toISOString(),
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
  };
}
