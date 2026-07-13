import type {
  BlindTargetMode,
  BlockMode,
  MeasurementMode,
  Session,
  Shot,
  TrainingBlock,
  VariableTargetMode,
} from "../types";
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
  measurementMode: MeasurementMode;
  targetTime: number;
  // Only relevant when mode === "variable"; defaults to "smart-random".
  variableTargetMode?: VariableTargetMode;
  // Only relevant when mode === "blind"; defaults to "fixed".
  blindTargetMode?: BlindTargetMode;
  // Only relevant when variableTargetMode/blindTargetMode === "smart-random".
  smartRandomMin?: number;
  smartRandomMax?: number;
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

  const block: TrainingBlock = {
    id: crypto.randomUUID(),
    name: input.name.trim() || defaultBlockName(input.mode),
    mode: input.mode,
    measurementMode: input.measurementMode,
    targetTime: input.targetTime,
    createdAt: new Date().toISOString(),
    variableTargetMode,
    blindTargetMode,
  };

  const effectiveMode = getEffectiveTargetMode(block);

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

  return block;
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
 * The target to use for the next shot, absent any manual override — the
 * block's pending target for Variable/Blind blocks using Smart Random or
 * Manual, otherwise its default/fixed target.
 */
export function getNextShotTarget(block: TrainingBlock): number {
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
): number {
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
