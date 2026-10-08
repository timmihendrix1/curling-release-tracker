import type {
  AccuracyThresholds,
  BlindTargetMode,
  BlockMeasurementConfiguration,
  BlockMode,
  MeasurementMode,
  Session,
  Shot,
  TrainingBlock,
  VariableTargetMode,
} from "../types";
import { resolveAccuracyThresholds } from "./accuracyThresholds";
import { canonicalTrainingBlock } from "./measurement/canonicalShape";
import { normalizeBlockMeasurementConfiguration } from "./measurement/quantities";
import {
  DEFAULT_SMART_RANDOM_MAX,
  DEFAULT_SMART_RANDOM_MIN,
  generateSmartRandomTarget,
  isSmartRandomAvailable,
  validateSmartRandomRange,
} from "./variableTargets";

export { isSmartRandomAvailable } from "./variableTargets";

export type NewBlockInput = {
  name: string;
  mode: BlockMode;
  // Both are required for every block that measures time, and both are genuinely
  // absent for a speed-only Fixed Weight block. Creation validates the combination
  // against `measurement` below rather than defaulting either one.
  measurementMode?: MeasurementMode;
  targetTime?: number;
  // Only relevant when mode === "variable"; defaults to "smart-random".
  variableTargetMode?: VariableTargetMode;
  // Only relevant when mode === "blind"; defaults to "fixed".
  blindTargetMode?: BlindTargetMode;
  // Only relevant when variableTargetMode/blindTargetMode === "smart-random".
  smartRandomMin?: number;
  smartRandomMax?: number;
  // Snapshotted onto the created block as-is (after resolving to a safe
  // default if omitted/invalid) — see docs/adr/0008-accuracy-thresholds-are-snapshotted-per-training-block.md.
  accuracyThresholds?: AccuracyThresholds;
  // Omitting it creates exactly the historical time-only block, byte-for-byte as
  // before this feature existed — which is why ordinary symmetric time training is
  // unaffected. Supplied when the block records speed, or when a time-only block
  // needs an asymmetric tolerance. See ADR-0051.
  measurement?: BlockMeasurementConfiguration;
};

/**
 * The single target-source concept shared by Variable Weight
 * (variableTargetMode: "smart-random" | "manual") and Blind Weight
 * (blindTargetMode: "fixed" | "smart-random" | "manual") — Blind Weight
 * additionally allows a constant "fixed" target, since what's being trained
 * there is the player's perception, not a changing target. Everything
 * downstream (target generation, advancing after a shot, migration) is
 * written once against this shared shape instead of duplicating Smart
 * Random / Manual handling per block mode.
 */
export type EffectiveTargetMode = VariableTargetMode | "fixed";

export function getEffectiveTargetMode(
  block: Pick<TrainingBlock, "mode" | "variableTargetMode" | "blindTargetMode">
): EffectiveTargetMode | undefined {
  if (block.mode === "variable") return block.variableTargetMode;
  if (block.mode === "blind") return block.blindTargetMode;
  return undefined;
}

export function defaultBlockName(mode: BlockMode): string {
  switch (mode) {
    case "fixed":
      return "Fixed Weight Block";
    case "variable":
      return "Variable Weight Block";
    case "blind":
      return "Blind Weight Block";
  }
}

export function createTrainingBlock(input: NewBlockInput): TrainingBlock {
  const isVariable = input.mode === "variable";
  const isBlind = input.mode === "blind";

  const variableTargetMode = isVariable
    ? input.variableTargetMode ?? "smart-random"
    : undefined;

  const blindTargetMode = isBlind
    ? input.blindTargetMode ?? "fixed"
    : undefined;

  // A measurement configuration is only ever attached to a Fixed Weight block —
  // Variable and Blind Weight keep their existing time-only semantics untouched —
  // and only when it is fully valid. An invalid one is rejected rather than
  // quietly dropped, which would silently downgrade a speed block to time-only.
  let measurement: BlockMeasurementConfiguration | undefined;
  if (input.measurement !== undefined) {
    if (input.mode !== "fixed") {
      throw new Error(
        "Only Fixed Weight supports choosing what is measured. Variable and Blind Weight measure time."
      );
    }
    // Normalization both validates strictly and returns a DEEP COPY, so the caller's
    // object (a form value, a plan step's configuration, a saved template) can be
    // edited or deleted afterwards without reaching into this block's snapshot — the
    // same isolation rule ADR-0008 established for AccuracyThresholds.
    measurement = normalizeBlockMeasurementConfiguration(input.measurement);
    if (!measurement) {
      throw new Error(
        "Each measured quantity needs a target greater than zero and tolerances where Acceptable is greater than On Target on both sides."
      );
    }
  }

  const measuresTime = measurement
    ? measurement.quantities.includes("time")
    : true;

  // The time target has exactly ONE authority. With a measurement configuration
  // present, that authority is `measurement.time.target`, and `block.targetTime`
  // becomes a derived mirror of it for legacy readers (getNextShotTarget,
  // computeShotTarget, export, charts). The two therefore cannot disagree, so capture
  // and explicit completion can never judge the same stone against different targets.
  // Without a configuration, `input.targetTime` is the authority, exactly as always.
  const resolvedTargetTime = measuresTime
    ? measurement?.time?.target ?? input.targetTime
    : undefined;

  if (measuresTime) {
    if (!input.measurementMode) {
      throw new Error("Choose a timing interval for this exercise.");
    }
    if (resolvedTargetTime === undefined) {
      throw new Error("Enter a target time for this exercise.");
    }
  } else if (input.measurementMode !== undefined || input.targetTime !== undefined) {
    // A speed-only block measures no time, so carrying a timing interval or a
    // time target would be fabricated state that later readers would trust.
    throw new Error(
      "A speed-only exercise has no timing interval and no target time."
    );
  }

  // Field order is kept identical to the pre-feature shape so a newly created
  // time-only block serializes exactly as it always did; the two time fields are
  // spread in place rather than assigned afterwards.
  const block: TrainingBlock = {
    id: crypto.randomUUID(),
    name: input.name.trim() || defaultBlockName(input.mode),
    mode: input.mode,
    ...(input.measurementMode !== undefined
      ? { measurementMode: input.measurementMode }
      : {}),
    ...(resolvedTargetTime !== undefined ? { targetTime: resolvedTargetTime } : {}),
    createdAt: new Date().toISOString(),
    variableTargetMode,
    blindTargetMode,
    // Snapshotted once, at creation — never re-derived from a later change
    // to the app's default thresholds (see ADR-0008).
    accuracyThresholds: resolveAccuracyThresholds(input.accuracyThresholds),
    ...(measurement ? { measurement } : {}),
  };

  const effectiveMode = getEffectiveTargetMode(block);

  // NOTE: the target-source fields assigned below land after `accuracyThresholds` in
  // insertion order, so the block is canonicalised once, at the end, rather than here.
  if (effectiveMode === "smart-random") {
    if (!isSmartRandomAvailable(input.measurementMode)) {
      throw new Error(
        `Smart Random has no target profile for measurement mode "${input.measurementMode}". Use Coach / Manual instead.`
      );
    }

    const range = validateSmartRandomRange(
      input.smartRandomMin ?? DEFAULT_SMART_RANDOM_MIN,
      input.smartRandomMax ?? DEFAULT_SMART_RANDOM_MAX
    );

    if (!range.valid) {
      throw new Error(range.error);
    }

    block.smartRandomMin = range.min;
    block.smartRandomMax = range.max;
    block.pendingTargetTime = generateSmartRandomTarget({
      min: range.min,
      max: range.max,
      recentTargets: [],
    });
  } else if (effectiveMode === "manual") {
    block.pendingTargetTime = input.targetTime;
  }
  // effectiveMode === "fixed" (or undefined, for "fixed"/other block modes):
  // no pendingTargetTime — block.targetTime is used directly, always.

  // Emitted in the canonical persisted property order, so a block created here and
  // the same block reconstructed by migration serialize to identical bytes — see
  // src/lib/measurement/canonicalShape.ts.
  return canonicalTrainingBlock(block);
}

export function getActiveBlock(session: Session): TrainingBlock | undefined {
  return session.blocks.find((block) => block.id === session.activeBlockId);
}

export function getBlockShots(session: Session, blockId: string): Shot[] {
  return session.shots.filter((shot) => shot.blockId === blockId);
}

export function getNextShotNumberInBlock(
  session: Session,
  blockId: string
): number {
  return getBlockShots(session, blockId).length + 1;
}

/**
 * The TIME target to use for the next shot, absent any manual override — the
 * block's pending target for Variable/Blind blocks using Smart Random or
 * Manual, otherwise its default/fixed target.
 *
 * `undefined` means this block measures no time at all (a speed-only Fixed Weight
 * block), so there is no time target to stamp onto a stone. Callers must handle
 * that explicitly rather than substituting a default.
 */
export function getNextShotTarget(block: TrainingBlock): number | undefined {
  const effectiveMode = getEffectiveTargetMode(block);

  if (
    (effectiveMode === "smart-random" || effectiveMode === "manual") &&
    block.pendingTargetTime !== undefined
  ) {
    return block.pendingTargetTime;
  }

  return block.targetTime;
}

/**
 * Resolves the target time to stamp onto a new shot. A manual override (from
 * a Coach/Manual target input) always wins; otherwise falls back to the
 * block's next-shot target.
 */
export function computeShotTarget(
  block: TrainingBlock,
  manualOverride?: number
): number | undefined {
  return manualOverride !== undefined ? manualOverride : getNextShotTarget(block);
}

/**
 * Advances a Variable/Blind block's pending target after a shot has been
 * recorded with `usedTargetTime`. Never touches already-recorded shots.
 * No-op for Fixed Weight, Blind+Fixed, and any other block mode, which
 * always use the block's single default target.
 */
export function advanceBlockTarget(
  block: TrainingBlock,
  usedTargetTime: number,
  recentTargets: number[]
): TrainingBlock {
  const effectiveMode = getEffectiveTargetMode(block);

  if (effectiveMode === undefined || effectiveMode === "fixed") {
    return block;
  }

  if (effectiveMode === "manual") {
    // Stays as the starting point for the next shot, editable by the coach.
    return { ...block, pendingTargetTime: usedTargetTime };
  }

  if (
    !isSmartRandomAvailable(block.measurementMode) ||
    block.smartRandomMin === undefined ||
    block.smartRandomMax === undefined
  ) {
    throw new Error(
      `Smart Random has no valid range for measurement mode "${block.measurementMode}". Use Coach / Manual instead.`
    );
  }

  return {
    ...block,
    pendingTargetTime: generateSmartRandomTarget({
      min: block.smartRandomMin,
      max: block.smartRandomMax,
      recentTargets: [...recentTargets, usedTargetTime],
    }),
  };
}

/**
 * Updates a Smart Random block's configured range (e.g. from a future
 * mid-block settings UI, or during migration when defaulting a legacy
 * block). If the current pendingTargetTime still falls inside the new
 * range, it's kept as-is; otherwise a single new one is generated within
 * the new range. Never touches already-recorded shots.
 */
export function updateSmartRandomRange(
  block: TrainingBlock,
  min: number,
  max: number,
  recentTargets: number[] = []
): TrainingBlock {
  const stillWithinRange =
    block.pendingTargetTime !== undefined &&
    block.pendingTargetTime >= min &&
    block.pendingTargetTime <= max;

  return {
    ...block,
    smartRandomMin: min,
    smartRandomMax: max,
    pendingTargetTime: stillWithinRange
      ? block.pendingTargetTime
      : generateSmartRandomTarget({ min, max, recentTargets }),
  };
}

/**
 * Closes out the current active block (if any) and makes the newly created
 * block active. The session itself is unchanged aside from its blocks.
 */
export function addTrainingBlock(
  session: Session,
  input: NewBlockInput
): Session {
  const newBlock = createTrainingBlock(input);
  const completedAt = new Date().toISOString();

  const blocks = session.blocks.map((block) =>
    block.id === session.activeBlockId && !block.completedAt
      ? { ...block, completedAt }
      : block
  );

  return {
    ...session,
    blocks: [...blocks, newBlock],
    activeBlockId: newBlock.id,
  };
}

export function measurementModeLabel(mode: MeasurementMode): string {
  return mode === "hog-hog" ? "Hog – Hog" : "Backline – Hog";
}

export function blockModeLabel(mode: BlockMode): string {
  switch (mode) {
    case "fixed":
      return "Fixed Weight";
    case "variable":
      return "Variable Weight";
    case "blind":
      return "Blind Weight";
  }
}

export function variableTargetModeLabel(mode: VariableTargetMode): string {
  return mode === "manual" ? "Coach / Manual" : "Smart Random";
}

export function blindTargetModeLabel(mode: BlindTargetMode): string {
  switch (mode) {
    case "fixed":
      return "Fixed";
    case "smart-random":
      return "Smart Random";
    case "manual":
      return "Coach / Manual";
  }
}
