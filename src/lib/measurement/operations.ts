// Pure operations for recording a stone's measurements and for explicitly
// completing a measurement that is still missing on one identified stone.
//
// These are NOT a parallel shot-save path: `buildMeasuredShot` only constructs a
// Shot value (the way createTrainingBlock constructs a block), using the exact same
// numbering/handle/target machinery the existing flows already resolved, and
// `completeShotMeasurement` only fills one hole in one already-saved stone.
//
// The invariants enforced here are the product's, not the UI's:
//   - a recorded stone must carry at least one real measurement;
//   - a measured value is always stored together with the target it was judged
//     against, and neither is ever rewritten afterwards;
//   - completing a missing measurement targets ONE explicitly identified stone in
//     one explicitly identified block of one explicitly identified session, so a
//     delayed write, a retry, or a block/session change in between can never
//     silently land it on a different stone;
//   - completion never advances shot numbering, planned progress, handle
//     alternation or a Variable/Blind block's pending target.
//
// See docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md and
// docs/adr/0051-fixed-weight-measured-quantities-and-per-side-tolerances.md.
import type {
  Handle,
  MeasuredQuantity,
  Session,
  Shot,
  ShotType,
  TimingProviderType,
  TrainingBlock,
} from "../../types";
import {
  blockQuantityTarget,
  resolveBlockMeasurement,
  shotMeasures,
} from "./quantities";
import { canonicalShot } from "./canonicalShape";
import { shotMeasurementStateIsValid } from "./validation";
import { isValidQuantityValue, quantityLabel } from "./tolerance";

export type MeasurementErrorCode =
  | "session_mismatch"
  | "block_mismatch"
  | "block_not_found"
  | "shot_not_found"
  | "quantity_not_measured"
  | "already_recorded"
  | "invalid_value"
  | "target_unavailable"
  | "conflicting_source"
  | "ambiguous_shot"
  | "ambiguous_block"
  | "malformed_shot"
  | "no_measurement";

export type MeasurementError = {
  code: MeasurementErrorCode;
  message: string;
};

export type MeasurementOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: MeasurementError };

function ok<T>(value: T): MeasurementOutcome<T> {
  return { ok: true, value };
}

function err(code: MeasurementErrorCode, message: string): MeasurementOutcome<never> {
  return { ok: false, error: { code, message } };
}

/** One measured value together with the target it is judged against. */
export type RecordedMeasurement = {
  value: number;
  target: number;
  source?: TimingProviderType;
  recordedAt?: string;
};

export type NewMeasuredShotInput = {
  id: string;
  sessionId: string;
  blockId: string;
  shotNumber: number;
  handle: Handle;
  shotType?: ShotType;
  comment?: string;
  createdAt: string;
  time?: RecordedMeasurement;
  speed?: RecordedMeasurement;
  predictedTime?: number;
  measurementSource?: TimingProviderType;
  captureSequenceId?: string;
  timingResultId?: string;
  deviceId?: string;
  laneId?: string;
};

/**
 * Constructs a stone from whichever measurements were actually supplied. A stone
 * with neither is rejected rather than saved as an empty placeholder, and a
 * measurement the block does not record is rejected rather than stored.
 *
 * Absent measurements are left genuinely absent — never 0, never the block's
 * default target, never a fabricated timing interval.
 */
export function buildMeasuredShot(
  block: TrainingBlock,
  input: NewMeasuredShotInput
): MeasurementOutcome<Shot> {
  // The stone must be built for the block it is attributed to. Accepting a foreign
  // `blockId` would stamp a stone with one block's targets while filing it under
  // another's identity, which no later reader could detect.
  if (input.blockId !== block.id) {
    return err("block_mismatch", "That stone belongs to a different exercise.");
  }

  const { quantities } = resolveBlockMeasurement(block);

  for (const quantity of ["time", "speed"] as MeasuredQuantity[]) {
    const supplied = quantity === "time" ? input.time : input.speed;
    if (!supplied) continue;

    if (!quantities.includes(quantity)) {
      return err(
        "quantity_not_measured",
        `This block doesn't measure ${quantityLabel(quantity).toLowerCase()}.`
      );
    }
    if (!isValidQuantityValue(supplied.value) || !isValidQuantityValue(supplied.target)) {
      return err(
        "invalid_value",
        `Enter a ${quantityLabel(quantity).toLowerCase()} greater than zero.`
      );
    }
  }

  if (!input.time && !input.speed) {
    return err("no_measurement", "Record at least one measurement for this stone.");
  }

  // Time provenance has two possible inputs: the measurement's own `source` and the
  // legacy capture-sequence `measurementSource`. They describe the same thing, so a
  // contradiction is rejected rather than one of them being silently discarded.
  const timeSource = input.time?.source ?? input.measurementSource;
  if (
    input.time?.source !== undefined &&
    input.measurementSource !== undefined &&
    input.time.source !== input.measurementSource
  ) {
    return err(
      "conflicting_source",
      "Two different sources were supplied for this stone's time."
    );
  }

  const shot: Shot = {
    id: input.id,
    sessionId: input.sessionId,
    blockId: input.blockId,
    shotNumber: input.shotNumber,
    handle: input.handle,
    createdAt: input.createdAt,
  };

  if (input.time) {
    shot.releaseTime = input.time.value;
    shot.targetTime = input.time.target;
  }
  if (input.speed) {
    shot.speed = input.speed.value;
    shot.targetSpeed = input.speed.target;
    if (input.speed.source !== undefined) shot.speedSource = input.speed.source;
    if (input.speed.recordedAt !== undefined) shot.speedRecordedAt = input.speed.recordedAt;
  }

  if (input.predictedTime !== undefined) shot.predictedTime = input.predictedTime;
  if (input.shotType !== undefined) shot.shotType = input.shotType;
  if (input.comment !== undefined) shot.comment = input.comment;
  // Recorded only alongside a real time — `measurementSource` is the TIME value's
  // provenance and is meaningless without one.
  if (timeSource !== undefined && input.time) shot.measurementSource = timeSource;
  if (input.captureSequenceId !== undefined) shot.captureSequenceId = input.captureSequenceId;
  if (input.timingResultId !== undefined) shot.timingResultId = input.timingResultId;
  if (input.deviceId !== undefined) shot.deviceId = input.deviceId;
  if (input.laneId !== undefined) shot.laneId = input.laneId;

  // Emitted in the canonical persisted property order, so a stone constructed here
  // and the same stone reconstructed by migration on the next load serialize to
  // IDENTICAL bytes. Anything else silently changes an already-uploaded terminal
  // record's payload and digest, which the sync manager reads as a conflict.
  return ok(canonicalShot(shot));
}

/**
 * The identity a completion must match in full. All three parts are required and
 * all three are checked: a completion prepared against one stone can never be
 * applied to whatever stone happens to be newest when the write finally lands.
 */
export type ShotMeasurementTarget = {
  sessionId: string;
  blockId: string;
  shotId: string;
};

export type CompleteShotMeasurementInput = ShotMeasurementTarget & {
  quantity: MeasuredQuantity;
  value: number;
  source?: TimingProviderType;
  recordedAt?: string;
};

export type CompleteShotMeasurementResult = {
  session: Session;
  shot: Shot;
};

/**
 * Adds ONE missing measurement to ONE already-recorded stone.
 *
 * This is explicitly not general editing of history: a quantity that already
 * carries a value is rejected (`already_recorded`) rather than overwritten, and the
 * stone's existing measurements, identity, handle, shot type, shot number and
 * creation time are all preserved exactly. The block list is returned untouched, so
 * no pending target advances and no handle strategy steps forward.
 *
 * A duplicate completion (the same value arriving twice, e.g. from a retry) is
 * rejected by the same `already_recorded` rule, which is what makes retrying safe.
 */
export function completeShotMeasurement(
  session: Session,
  input: CompleteShotMeasurementInput
): MeasurementOutcome<CompleteShotMeasurementResult> {
  if (session.id !== input.sessionId) {
    return err(
      "session_mismatch",
      "This measurement belongs to a different training session."
    );
  }

  // Two blocks answering to one identity make "which exercise does this stone belong
  // to" unanswerable, so the target block cannot be resolved safely at all.
  if (
    session.blocks.filter((candidate) => candidate.id === input.blockId).length > 1
  ) {
    return err(
      "ambiguous_block",
      "More than one exercise has that identity, so this measurement cannot be placed."
    );
  }

  const matches = session.shots.filter((candidate) => candidate.id === input.shotId);
  if (matches.length === 0) {
    return err("shot_not_found", "That stone is no longer part of this training.");
  }
  if (matches.length > 1) {
    // Two stones answering to one identity: there is no safe way to choose, and
    // guessing could attach the measurement to the wrong one permanently.
    return err(
      "ambiguous_shot",
      "More than one stone has that identity, so this measurement cannot be placed."
    );
  }
  const shot = matches[0];

  // Ownership, not merely addressability: a stone stamped with another session's id
  // is not this session's to modify, whatever list it currently appears in.
  if (shot.sessionId !== session.id) {
    return err(
      "session_mismatch",
      "That stone belongs to a different training session."
    );
  }

  if (shot.blockId !== input.blockId) {
    return err("block_mismatch", "That stone belongs to a different exercise.");
  }

  const block = session.blocks.find((candidate) => candidate.id === input.blockId);
  if (!block) {
    return err("block_not_found", "That exercise is no longer part of this training.");
  }

  const { quantities } = resolveBlockMeasurement(block);

  // EVERY measurement already on the stone must be well formed before anything is
  // added. `shotHasAnyMeasurement` alone is not enough: a stone with a valid speed and
  // a stray release time carrying no target would pass it, and completing the time
  // would then overwrite that recorded value as though it had never existed.
  if (!shotMeasurementStateIsValid(shot, quantities)) {
    return err(
      "malformed_shot",
      "That stone's recorded measurements are not in a state this can safely add to."
    );
  }

  if (!quantities.includes(input.quantity)) {
    return err(
      "quantity_not_measured",
      `This exercise doesn't measure ${quantityLabel(input.quantity).toLowerCase()}.`
    );
  }

  if (shotMeasures(shot, input.quantity)) {
    return err(
      "already_recorded",
      `This stone already has a ${quantityLabel(input.quantity).toLowerCase()} recorded.`
    );
  }

  if (!isValidQuantityValue(input.value)) {
    return err(
      "invalid_value",
      `Enter a ${quantityLabel(input.quantity).toLowerCase()} greater than zero.`
    );
  }

  // A Fixed Weight block's target is constant, so the target that applies to this
  // stone is the block's own configured target — never re-derived from a different
  // block and never invented when the block has none.
  const target = blockQuantityTarget(block, input.quantity);
  if (!isValidQuantityValue(target)) {
    return err(
      "target_unavailable",
      "This exercise has no target for that measurement."
    );
  }

  // Rebuilt canonically rather than spread-and-appended: a spread keeps the original
  // key order and puts NEW keys at the end, so completing a missing measurement on a
  // partial Both stone would otherwise move it out of canonical order.
  const completed: Shot = canonicalShot(
    input.quantity === "time"
      ? {
          ...shot,
          releaseTime: input.value,
          targetTime: target,
          // Independent provenance per quantity: completing a time on a speed-first
          // stone records where that TIME came from, leaving `speedSource` untouched.
          ...(input.source !== undefined ? { measurementSource: input.source } : {}),
        }
      : {
          ...shot,
          speed: input.value,
          targetSpeed: target,
          ...(input.source !== undefined ? { speedSource: input.source } : {}),
          ...(input.recordedAt !== undefined ? { speedRecordedAt: input.recordedAt } : {}),
        }
  );

  return ok({
    session: {
      ...session,
      shots: session.shots.map((candidate) =>
        candidate.id === completed.id ? completed : candidate
      ),
    },
    shot: completed,
  });
}

/**
 * Every stone in `blockId` that is still missing one of the block's measured
 * quantities, in recorded order, each with the quantities it still needs. Stage B's
 * "missing speed" surface reads this rather than guessing from the newest stone.
 */
export function findIncompleteShots(
  session: Session,
  blockId: string
): { shot: Shot; missing: MeasuredQuantity[] }[] {
  const block = session.blocks.find((candidate) => candidate.id === blockId);
  if (!block) return [];

  const { quantities } = resolveBlockMeasurement(block);

  return session.shots
    .filter((shot) => shot.blockId === blockId)
    .map((shot) => ({
      shot,
      missing: quantities.filter((quantity) => !shotMeasures(shot, quantity)),
    }))
    .filter((entry) => entry.missing.length > 0);
}
