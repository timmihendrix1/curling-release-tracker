// Capture Sequence domain logic: turning a stream of normalized TimingResults into
// saved Shots through the exact same target/shot-numbering machinery manual entry
// already uses (trainingBlocks.ts) — there is deliberately no parallel shot-save path.
//
// See docs/SYSTEM_ARCHITECTURE.md's "Capture Sequences" section and
// docs/adr/0006-capture-sequences-share-the-timing-result-boundary.md.
import type {
  CaptureHandleMode,
  CaptureSequence,
  CaptureStepRecord,
  Handle,
  Session,
  Shot,
  ShotType,
  TimingProviderType,
  TimingResult,
  TrainingBlock,
} from "../types";
import {
  advanceBlockTarget,
  computeShotTarget,
  getBlockShots,
  getNextShotNumberInBlock,
} from "./trainingBlocks";

// Not a sporting rule — just a sane technical ceiling so a typo (e.g. an extra digit)
// can't create an unbounded sequence.
export const MAX_CAPTURE_SHOT_COUNT = 200;
export const DEFAULT_CAPTURE_SHOT_COUNT = 8;

// A conservative, wide "does this look like a real reading at all" band — not a
// sport-specific precision range. Values outside it are still accepted (see
// isPlausibleTimingValue, which is the actual accept/reject gate); this only flags
// them for a non-blocking "unusual value" warning.
export const UNUSUAL_TIMING_VALUE_MIN = 0.5;
export const UNUSUAL_TIMING_VALUE_MAX = 30;

export function isPlausibleTimingValue(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function isUnusualTimingValue(value: number): boolean {
  return value < UNUSUAL_TIMING_VALUE_MIN || value > UNUSUAL_TIMING_VALUE_MAX;
}

export type NewCaptureSequenceInput = {
  session: Session;
  block: TrainingBlock;
  expectedShotCount: number;
  providerType: TimingProviderType;
  handleMode: CaptureHandleMode;
  startHandle?: Handle;
  shotType?: ShotType;
};

/**
 * Creates a new Capture Sequence in the "ready" status (configured, not yet
 * listening for results — see startCaptureSequence). Throws on any precondition
 * that would make the sequence meaningless to run; callers should validate/handle
 * this the same way `createTrainingBlock`'s validation is handled (see TrackerApp.tsx).
 */
export function createCaptureSequence(input: NewCaptureSequenceInput): CaptureSequence {
  if (input.block.mode === "blind") {
    throw new Error(
      "Auto Capture isn't available for Blind Weight yet. Use the manual Blind Weight flow instead."
    );
  }

  if (
    input.session.captureSequence &&
    input.session.captureSequence.status !== "completed" &&
    input.session.captureSequence.status !== "cancelled"
  ) {
    throw new Error("Another capture sequence is already active for this session.");
  }

  if (!Number.isInteger(input.expectedShotCount) || input.expectedShotCount <= 0) {
    throw new Error("Number of shots must be a whole number greater than 0.");
  }

  if (input.expectedShotCount > MAX_CAPTURE_SHOT_COUNT) {
    throw new Error(`Number of shots must be ${MAX_CAPTURE_SHOT_COUNT} or fewer.`);
  }

  return {
    id: crypto.randomUUID(),
    sessionId: input.session.id,
    blockId: input.block.id,
    expectedShotCount: input.expectedShotCount,
    capturedShotCount: 0,
    status: "ready",
    providerType: input.providerType,
    handleMode: input.handleMode,
    startHandle: input.startHandle ?? "in",
    shotType: input.shotType,
    processedResultIds: [],
    steps: [],
  };
}

export function startCaptureSequence(sequence: CaptureSequence): CaptureSequence {
  if (sequence.status !== "ready" && sequence.status !== "paused") return sequence;

  return {
    ...sequence,
    status: "running",
    startedAt: sequence.startedAt ?? new Date().toISOString(),
    pausedAt: undefined,
  };
}

export function pauseCaptureSequence(sequence: CaptureSequence): CaptureSequence {
  if (sequence.status !== "running") return sequence;
  return { ...sequence, status: "paused", pausedAt: new Date().toISOString() };
}

/**
 * Forces a sequence into "paused" with a recorded error message, regardless of its
 * current status (as long as it isn't already a terminal one) — used when processing a
 * TimingResult throws an unexpected exception (see applyTimingResultToSession). There is
 * deliberately no separate "error" CaptureSequenceStatus: reusing "paused" means every
 * existing paused-state UI/guard/migration rule already applies, and Resume already
 * means "the user has explicitly decided to continue" — see ADR-0006.
 */
export function pauseCaptureSequenceWithError(
  sequence: CaptureSequence,
  message: string
): CaptureSequence {
  if (sequence.status === "completed" || sequence.status === "cancelled") return sequence;
  return {
    ...sequence,
    status: "paused",
    pausedAt: new Date().toISOString(),
    lastError: message,
  };
}

export function resumeCaptureSequence(sequence: CaptureSequence): CaptureSequence {
  if (sequence.status !== "paused") return sequence;
  return { ...sequence, status: "running", pausedAt: undefined, lastError: undefined };
}

export function cancelCaptureSequence(sequence: CaptureSequence): CaptureSequence {
  if (sequence.status === "completed" || sequence.status === "cancelled") return sequence;
  return { ...sequence, status: "cancelled", cancelledAt: new Date().toISOString() };
}

export function isCaptureSequenceActive(sequence: CaptureSequence | undefined): boolean {
  return (
    sequence !== undefined &&
    sequence.status !== "completed" &&
    sequence.status !== "cancelled"
  );
}

/**
 * The handle for the *next* captured shot. Deterministic from capturedShotCount alone
 * for "fixed-in"/"fixed-out"/"alternate" — nothing extra needs to be stored or
 * restored for Undo; decrementing capturedShotCount already yields the right answer
 * again. "manual" defers entirely to whatever the live UI's handle toggle says.
 */
export function computeNextCaptureHandle(
  sequence: CaptureSequence,
  manualHandleOverride?: Handle
): Handle {
  switch (sequence.handleMode) {
    case "fixed-in":
      return "in";
    case "fixed-out":
      return "out";
    case "alternate": {
      const isFirstOfPair = sequence.capturedShotCount % 2 === 0;
      const opposite: Handle = sequence.startHandle === "in" ? "out" : "in";
      return isFirstOfPair ? sequence.startHandle : opposite;
    }
    case "manual":
      return manualHandleOverride ?? sequence.startHandle;
  }
}

export type TimingResultProcessingStatus =
  | "accepted"
  | "duplicate"
  | "invalid"
  | "ignored-paused"
  | "ignored-completed"
  | "measurement-mode-mismatch";

export type ProcessTimingResultOutcome =
  | {
      status: "accepted";
      shot: Shot;
      updatedBlock: TrainingBlock;
      updatedSequence: CaptureSequence;
      unusualValueWarning?: string;
    }
  | {
      status: Exclude<TimingResultProcessingStatus, "accepted">;
      reason: string;
    };

export type ProcessTimingResultInput = {
  result: TimingResult;
  sequence: CaptureSequence;
  session: Session;
  activeBlock: TrainingBlock;
  /** Only consulted when activeBlock's target source is Manual. */
  manualTargetOverride?: number;
  /** Only consulted when sequence.handleMode === "manual". */
  manualHandleOverride?: Handle;
};

/**
 * The one place a TimingResult becomes (or doesn't become) a Shot. Simulator results,
 * manual-fallback results, and (later) real hardware results all pass through here
 * identically — see docs/adr/0006. Never mutates its inputs; returns the updated
 * block/sequence/shot for the caller to apply (see TrackerApp.tsx's
 * processIncomingTimingResult, which is the only place that actually commits them).
 */
export function processTimingResult(
  input: ProcessTimingResultInput
): ProcessTimingResultOutcome {
  const { result, sequence, session, activeBlock } = input;

  if (sequence.blockId !== activeBlock.id) {
    return { status: "invalid", reason: "This result does not belong to the active block." };
  }

  if (sequence.status === "completed" || sequence.status === "cancelled") {
    return {
      status: "ignored-completed",
      reason: `Capture sequence is already ${sequence.status}.`,
    };
  }

  if (sequence.status === "paused") {
    return { status: "ignored-paused", reason: "Capture sequence is paused." };
  }

  if (sequence.processedResultIds.includes(result.id)) {
    return { status: "duplicate", reason: "This timing result has already been processed." };
  }

  if (!result.measurements || result.measurements.length === 0) {
    return { status: "invalid", reason: "Timing result contains no measurements." };
  }

  const matchingMeasurement = result.measurements.find(
    (measurement) => measurement.measurementMode === activeBlock.measurementMode
  );

  if (!matchingMeasurement) {
    return {
      status: "measurement-mode-mismatch",
      reason: `Result has no ${activeBlock.measurementMode} measurement.`,
    };
  }

  const { value } = matchingMeasurement;

  if (!isPlausibleTimingValue(value)) {
    return {
      status: "invalid",
      reason: "Measured value must be a finite number greater than 0.",
    };
  }

  // Accepted from here on — reuse the exact same target/shot-numbering logic manual
  // entry uses, so Auto Capture can never diverge from it.
  const targetTime = computeShotTarget(activeBlock, input.manualTargetOverride);
  const handle = computeNextCaptureHandle(sequence, input.manualHandleOverride);

  const newShot: Shot = {
    id: crypto.randomUUID(),
    sessionId: session.id,
    blockId: activeBlock.id,
    shotNumber: getNextShotNumberInBlock(session, activeBlock.id),
    releaseTime: value,
    targetTime,
    handle,
    shotType: sequence.shotType,
    measurementSource: result.source,
    captureSequenceId: sequence.id,
    timingResultId: result.id,
    deviceId: result.deviceId,
    laneId: result.laneId,
    createdAt: new Date().toISOString(),
  };

  const recentTargets = getBlockShots(session, activeBlock.id).map((shot) => shot.targetTime);
  const updatedBlock = advanceBlockTarget(activeBlock, targetTime, recentTargets);

  const capturedShotCount = sequence.capturedShotCount + 1;
  const isComplete = capturedShotCount >= sequence.expectedShotCount;

  const step: CaptureStepRecord = {
    resultId: result.id,
    shotId: newShot.id,
    targetTime,
    previousPendingTargetTime: activeBlock.pendingTargetTime,
    nextPendingTargetTime: updatedBlock.pendingTargetTime,
    handle,
  };

  const updatedSequence: CaptureSequence = {
    ...sequence,
    capturedShotCount,
    processedResultIds: [...sequence.processedResultIds, result.id],
    steps: [...sequence.steps, step],
    status: isComplete ? "completed" : sequence.status,
    completedAt: isComplete ? new Date().toISOString() : sequence.completedAt,
  };

  return {
    status: "accepted",
    shot: newShot,
    updatedBlock,
    updatedSequence,
    unusualValueWarning: isUnusualTimingValue(value)
      ? `Unusual timing value: ${value.toFixed(2)}s. Saved. Undo if this was a false trigger.`
      : undefined,
  };
}

export type ApplyTimingResultInput = {
  session: Session;
  result: TimingResult;
  /** Only consulted when the active block's target source is Manual. */
  manualTargetOverride?: number;
  /** Only consulted when the sequence's handleMode is "manual". */
  manualHandleOverride?: Handle;
};

export type ApplyTimingResultOutput = {
  /** The full next Session — identical to the input session by reference if nothing
   * was accepted, so callers can cheaply check `output.session !== input.session`. */
  session: Session;
  outcome: ProcessTimingResultOutcome;
};

/**
 * The single atomic Capture Sequence state transition: old Session + TimingResult →
 * new Session, computed in one synchronous, pure step. Wraps processTimingResult and
 * applies its outcome (shot append, block replace, sequence replace) together, so a
 * caller never has "shot saved but sequence not advanced" or vice versa as two
 * separately-observable states — see ADR-0006's serialization section.
 *
 * Deliberately takes a plain Session value (not a React setState updater) and returns a
 * plain Session value — no framework dependency, no closure over component state. This
 * is what makes it safely callable from a hand-rolled processing queue (TrackerApp.tsx)
 * instead of relying on React's setState-updater batching/eager-evaluation timing to
 * serialize rapid, back-to-back results correctly.
 *
 * Never throws for any *rejection* case (duplicate, invalid, paused, completed,
 * mismatch, missing block/sequence) — those are ordinary outcomes, not exceptions. It
 * may still throw for a genuine bug (e.g. corrupt CaptureSequence reaching
 * processTimingResult); callers are expected to guard against that (see
 * pauseCaptureSequenceWithError and TrackerApp.tsx's processIncomingTimingResult).
 */
export function applyTimingResultToSession(
  input: ApplyTimingResultInput
): ApplyTimingResultOutput {
  const { session, result } = input;

  if (!session.captureSequence) {
    return {
      session,
      outcome: { status: "ignored-completed", reason: "No active capture sequence." },
    };
  }

  const activeBlock = session.blocks.find((block) => block.id === session.activeBlockId);

  if (!activeBlock) {
    return {
      session,
      outcome: { status: "invalid", reason: "No active training block." },
    };
  }

  const outcome = processTimingResult({
    result,
    sequence: session.captureSequence,
    session,
    activeBlock,
    manualTargetOverride: input.manualTargetOverride,
    manualHandleOverride: input.manualHandleOverride,
  });

  if (outcome.status !== "accepted") {
    return { session, outcome };
  }

  const nextSession: Session = {
    ...session,
    shots: [...session.shots, outcome.shot],
    blocks: session.blocks.map((block) =>
      block.id === outcome.updatedBlock.id ? outcome.updatedBlock : block
    ),
    captureSequence: outcome.updatedSequence,
  };

  return { session: nextSession, outcome };
}

export type UndoLastCaptureOutcome = {
  updatedSequence: CaptureSequence;
  updatedBlock: TrainingBlock;
  removedShotId: string;
};

/**
 * Reverses the most recently *captured* shot of this sequence: removes it, restores
 * the block's pendingTargetTime to exactly what it was before that shot (no new
 * random target, no re-derived handle history — computeNextCaptureHandle already
 * yields the right handle once capturedShotCount is decremented), and — if the
 * sequence had just completed — reopens it to "running".
 *
 * The original result id is deliberately NOT removed from processedResultIds: it
 * stays "spent" forever for this sequence. A replacement shot needs a genuinely new
 * TimingResult id, not a resend of the undone one (see docs/adr/0006 for why).
 *
 * Returns null if there is nothing to undo. Only ever removes a shot this exact
 * sequence captured — never an older manual shot.
 */
export function undoLastCapturedShot(
  sequence: CaptureSequence,
  block: TrainingBlock
): UndoLastCaptureOutcome | null {
  const lastStep = sequence.steps.at(-1);
  if (!lastStep) return null;

  const wasCompleted = sequence.status === "completed";

  const updatedSequence: CaptureSequence = {
    ...sequence,
    capturedShotCount: Math.max(0, sequence.capturedShotCount - 1),
    steps: sequence.steps.slice(0, -1),
    status: wasCompleted ? "running" : sequence.status,
    completedAt: wasCompleted ? undefined : sequence.completedAt,
  };

  const updatedBlock: TrainingBlock = {
    ...block,
    pendingTargetTime: lastStep.previousPendingTargetTime,
  };

  return { updatedSequence, updatedBlock, removedShotId: lastStep.shotId };
}

/**
 * Reconciles a persisted CaptureSequence against the shots that actually belong to it
 * (the primary source of truth — see docs/TECHNICAL_DEBT_AND_ROADMAP.md's persistence
 * section) after structural coercion has already happened (see
 * sessionMigration.ts's migrateCaptureSequence, which calls this). Never invents a shot,
 * a result id, or a target value; only recomputes/clears fields that can be safely
 * derived from real data, or gives up (returns undefined) when the sequence can't be
 * trusted at all.
 *
 * Returns undefined ("discard this sequence") when:
 * - expectedShotCount is not a valid positive integer.
 * - The real captured-shot count (from `shotsForThisSequence`) exceeds
 *   expectedShotCount — an impossible state that can't be safely repaired by guessing
 *   which shots "shouldn't count."
 *
 * Otherwise, repairs (each independently testable, see captureSequence.test.ts):
 * - `capturedShotCount` is recomputed from `shotsForThisSequence.length` — never trusted
 *   from the stored value, which could be stale or tampered with.
 * - `steps` is filtered to only those whose `shotId` matches a real shot in
 *   `shotsForThisSequence` — a step referencing a shot that no longer exists is dropped,
 *   never repaired by inventing one.
 * - `processedResultIds` is widened (never narrowed) to guarantee it still contains
 *   every real step's `resultId` — so a real captured result can never accidentally
 *   become resubmittable as if it were new.
 * - `completedAt`/`cancelledAt` are cleared whenever they don't match `status` (e.g. a
 *   `completedAt` on a `"running"` sequence is nonsensical and discarded, not trusted).
 * - A `"completed"` sequence whose real shot count doesn't actually reach
 *   `expectedShotCount` is reopened as `"paused"` (with a `lastError` explaining why) —
 *   safer than either silently treating it as done or discarding real, valid shots.
 */
export function sanitizeCaptureSequence(
  sequence: CaptureSequence,
  shotsForThisSequence: Shot[]
): CaptureSequence | undefined {
  if (!Number.isInteger(sequence.expectedShotCount) || sequence.expectedShotCount <= 0) {
    return undefined;
  }

  const realCapturedShotCount = shotsForThisSequence.length;

  if (realCapturedShotCount > sequence.expectedShotCount) {
    return undefined;
  }

  const realShotIds = new Set(shotsForThisSequence.map((shot) => shot.id));
  const steps = sequence.steps.filter((step) => realShotIds.has(step.shotId));

  // Widened from the ORIGINAL (unfiltered) steps, not the post-filter ones — a step
  // whose shot has vanished still means a real result WAS processed for it; its id
  // must stay "spent" forever even though the step itself is dropped for Undo purposes.
  const processedResultIds = Array.from(
    new Set([...sequence.processedResultIds, ...sequence.steps.map((step) => step.resultId)])
  );

  let status = sequence.status;
  let completedAt = status === "completed" ? sequence.completedAt : undefined;
  const cancelledAt = status === "cancelled" ? sequence.cancelledAt : undefined;
  let lastError = sequence.lastError;

  if (status === "completed" && realCapturedShotCount < sequence.expectedShotCount) {
    status = "paused";
    completedAt = undefined;
    lastError =
      "Capture data was inconsistent after reload (fewer captured shots than expected) — reopened as paused.";
  }

  return {
    ...sequence,
    capturedShotCount: realCapturedShotCount,
    steps,
    processedResultIds,
    status,
    completedAt,
    cancelledAt,
    lastError,
  };
}
