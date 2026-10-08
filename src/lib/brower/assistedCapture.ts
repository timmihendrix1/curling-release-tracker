// The assisted Brower training pilot's decision layer: which decoded intervals may be
// OFFERED to the operator, and which may never be.
//
// This module filters Back–Hog offers by the approved Draw/Takeout ranges. The UI
// drains matching candidates automatically; unfiltered contexts use manual selection. There is no
// start/finish pairing, no alternating-split parity, no ten-second cutoff and no
// "last non-zero split is the result" rule anywhere in this file, because no evidence
// supports any of them (docs/BROWER_INTEGRATION_STATUS.md, pilot decision 2026-09-30).
//
// Five safety rules shape everything below.
//
//  1. **Arming is an operator act, not a timer state.** Nothing is offered until the
//     operator confirms the apparatus is set up. Setup arming reduces unwanted intake;
//     it is not a hardware-side acquisition boundary and not a plausibility filter.
//  2. **A baseline is taken at arming, and everything in it is permanently ineligible.**
//     A split this connection had already seen before arming can never become a
//     candidate, however many times the device resends it.
//  3. **Receipt time is never evidence of freshness.** `observedAt` records when bytes
//     arrived, nothing more. Delayed previously-unseen data cannot be proved fresh from
//     receipt alone. Automatic recording accepts this residual limitation; setup
//     confirmation and later review/Undo remain necessary.
//  4. **Candidate identity is stable and position-bearing.** The same measurement always
//     yields the same id, so a repeat is inert; two equal times at different split
//     positions yield different ids, so they stay distinct measurements.
//  5. **Continuity loss suspends.** A record that shrinks, or that reports a different
//     value at a split position already observed, means the stream can no longer be
//     trusted to be the one that was armed. Pending candidates are invalidated and the
//     operator must re-arm.
import type { MeasurementMode, ShotType } from "../../types";
import {
  BROWER_CHRON_MAX_SPLITS,
  deriveBrowerChronIntervals,
  type BrowerChronRecord,
} from "./chronDecoder";

/**
 * Everything an acceptance is bound to. All parts are checked again when the
 * queued acceptance actually executes — a candidate offered for one sequence must
 * never become a shot in another.
 */
export type BrowerCaptureContext = {
  /** The canonical application-owned `Profile.id`, never an auth-provider user id. */
  profileId: string;
  sessionId: string;
  blockId: string;
  sequenceId: string;
  /** The block's explicit measurement mode. A device reading is never re-labelled. */
  measurementMode: MeasurementMode;
  /** Existing fixed-weight capture selection; absent for variable-weight sequences. */
  shotType?: ShotType;
};

/** User-approved Back–Hog windows, inclusive and evaluated before display truncation. */
export function browerShotRange(context: Pick<BrowerCaptureContext, "measurementMode" | "shotType">):
  { minMs: number; maxMs: number; label: string } | null {
  if (context.measurementMode !== "back-hog") return null;
  if (context.shotType === "draw") return { minMs: 3000, maxMs: 5000, label: "Draw" };
  if (context.shotType === "takeout") return { minMs: 2000, maxMs: 4000, label: "Takeout" };
  return null;
}

export function browerIntervalFitsShotRange(intervalMs: number, context: BrowerCaptureContext): boolean {
  const range = browerShotRange(context);
  return range === null || (intervalMs >= range.minMs && intervalMs <= range.maxMs);
}

export function browerCaptureContextsMatch(
  a: BrowerCaptureContext | null,
  b: BrowerCaptureContext | null
): boolean {
  if (a === null || b === null) return false;
  return (
    a.profileId === b.profileId &&
    a.sessionId === b.sessionId &&
    a.blockId === b.blockId &&
    a.sequenceId === b.sequenceId &&
    a.measurementMode === b.measurementMode &&
    a.shotType === b.shotType
  );
}

/**
 * One selectable interval.
 *
 * `id` is what becomes `TimingResult.id`, and therefore what the Capture Sequence's
 * `processedResultIds` deduplicates against. It is derived from the capture sequence,
 * the record and the split POSITION — never from arrival order, a counter or a random
 * value — so a byte-for-byte resend of a packet regenerates exactly the same id and
 * can never become a second shot. Because an undone shot's result id stays spent
 * forever (ADR-0006 decision 6), the same stability also prevents re-acceptance after
 * Undo.
 */
export type BrowerCandidate = {
  id: string;
  recordKey: string;
  /** 1-based position of the split that ENDS this interval. */
  splitIndex: number;
  intervalMs: number;
  cumulativeMs: number;
  precedingCumulativeMs?: number;
  /** How many splits the record held when this candidate was derived. */
  recordSplitCount: number;
  /** When the bytes ARRIVED. Not when the trigger occurred, and not proof of freshness. */
  observedAt: string;
  context: BrowerCaptureContext;
};

export type BrowerCandidateOutcome = "accepted" | "discarded" | "dropped";

export type BrowerRetiredCandidate = {
  id: string;
  outcome: BrowerCandidateOutcome;
};

export type BrowerAssistedPhase =
  /** Connected and listening, building a baseline. Nothing is offered. */
  | "observing"
  /** The operator confirmed setup. New splits become candidates. */
  | "armed"
  /** Lifecycle or continuity event. Nothing is offered until the operator re-arms. */
  | "suspended";

export type BrowerAssistedCaptureState = {
  phase: BrowerAssistedPhase;
  /** Set only while suspended. Always operator-readable, never a bare code. */
  suspendedReason?: string;
  /** Increments on every arming. Identifies one observation window. */
  armingEpoch: number;
  /**
   * How many COMPLETE, coherent records this connection has assembled. Arming requires
   * at least one: receiving nothing is not a baseline, and a record whose appendices
   * have not all arrived is not one either.
   */
  completeObservationCount: number;
  /** Bound at arming. Null until the first arming. */
  context: BrowerCaptureContext | null;
  /** Latest cumulative splits seen per record, updated in every phase. */
  observed: Record<string, number[]>;
  /** `observed` as it stood at the moment of arming. Null before the first arming. */
  baseline: Record<string, number[]> | null;
  candidates: BrowerCandidate[];
  retired: BrowerRetiredCandidate[];
  /** Records that have reached the documented 20-split limit. */
  exhaustedRecordKeys: string[];
  /** Assemblies that produced no selectable measurement, with the most recent reason. */
  rejectedAssemblyCount: number;
  lastRejectionReason?: string;
  /** Candidates removed purely to keep the offered list bounded. Never silent. */
  droppedCandidateCount: number;
  /** Out-of-range intervals observed since arming; repeats do not count again. */
  filteredCandidateCount: number;
  /** Why the last arming attempt was refused. Cleared by a successful arming. */
  armingBlocker?: string;
};

/**
 * The offered list is bounded. 24 leaves room for a complete 20-split record plus
 * margin, so overflow means the operator has left many candidates unhandled — which is
 * surfaced as `droppedCandidateCount`, never hidden.
 */
export const BROWER_MAX_OFFERED_CANDIDATES = 24;

/** Bounded so a long session cannot grow this without limit. */
const MAX_RETIRED_CANDIDATES = 200;

export function createBrowerAssistedCaptureState(): BrowerAssistedCaptureState {
  return {
    phase: "observing",
    armingEpoch: 0,
    completeObservationCount: 0,
    context: null,
    observed: {},
    baseline: null,
    candidates: [],
    retired: [],
    exhaustedRecordKeys: [],
    rejectedAssemblyCount: 0,
    droppedCandidateCount: 0,
    filteredCandidateCount: 0,
  };
}

/**
 * Why arming is not permitted yet, or null when it is.
 *
 * Arming asserts "everything the timer holds right now is setup, not training". That
 * assertion is only meaningful once the application has actually assembled at least one
 * complete record: with nothing observed there is no baseline to snapshot, and a setup
 * interval arriving later would be offered as if it were a shot.
 *
 * `assemblyOutstanding` is the caller's report that a base packet has declared appendices
 * that have not all arrived. Arming mid-assembly would let that record's remaining
 * splits — measured during setup — complete after the snapshot and be offered as new.
 */
export function describeBrowerArmingBlocker(
  state: BrowerAssistedCaptureState,
  options: { assemblyOutstanding: boolean }
): string | null {
  if (options.assemblyOutstanding) {
    return "The timer is still sending a record. Wait for it to finish, then confirm the setup.";
  }
  if (state.completeObservationCount === 0) {
    return "No complete measurement has been received yet. Trigger both gates once while setting up, so the app knows what the timer already holds.";
  }
  return null;
}

export function browerCandidateId(
  context: BrowerCaptureContext,
  recordKey: string,
  splitIndex: number
): string {
  return `brower:${context.sequenceId}:${recordKey}:${splitIndex}`;
}

/**
 * Confirms the apparatus is set up and starts offering NEW splits.
 *
 * The baseline snapshot is taken here, from everything observed so far — including
 * anything observed while suspended, which is why re-arming after a pause cannot
 * re-offer intervals that arrived during it.
 */
export function armBrowerAssistedCapture(
  state: BrowerAssistedCaptureState,
  context: BrowerCaptureContext,
  options: { assemblyOutstanding: boolean } = { assemblyOutstanding: false }
): BrowerAssistedCaptureState {
  const blocker = describeBrowerArmingBlocker(state, options);
  if (blocker !== null) {
    // Refused, and said so. Never silently armed without a baseline.
    return { ...state, phase: "observing", suspendedReason: undefined, armingBlocker: blocker };
  }

  return {
    ...state,
    armingBlocker: undefined,
    phase: "armed",
    suspendedReason: undefined,
    armingEpoch: state.armingEpoch + 1,
    context,
    // A fresh snapshot by value: later observations must not mutate the baseline.
    baseline: Object.fromEntries(
      Object.entries(state.observed).map(([key, splits]) => [key, [...splits]])
    ),
    // Arming is a clean start. Anything offered under a previous context is gone.
    candidates: [],
    filteredCandidateCount: 0,
  };
}

/**
 * Stops offering candidates and invalidates every pending one.
 *
 * Used for disconnect, backgrounding, screen lock, capture-context change and loss of
 * packet continuity. Deliberately does NOT clear `observed`: whatever arrives while
 * suspended still counts as known, so a later re-arm cannot present it as new.
 */
export function suspendBrowerAssistedCapture(
  state: BrowerAssistedCaptureState,
  reason: string
): BrowerAssistedCaptureState {
  if (state.phase === "suspended" && state.candidates.length === 0) {
    return state.suspendedReason === reason ? state : { ...state, suspendedReason: reason };
  }
  return { ...state, phase: "suspended", suspendedReason: reason, candidates: [] };
}

function retireIds(
  state: BrowerAssistedCaptureState,
  entries: BrowerRetiredCandidate[]
): BrowerRetiredCandidate[] {
  const known = new Set(state.retired.map((entry) => entry.id));
  const additions = entries.filter((entry) => !known.has(entry.id));
  if (additions.length === 0) return state.retired;
  return [...state.retired, ...additions].slice(-MAX_RETIRED_CANDIDATES);
}

/**
 * Removes one candidate from the offered list and marks it permanently ineligible for
 * this arming window. Used both by an accepted selection and by an explicit discard —
 * a discard creates no shot and touches no session state.
 */
export function retireBrowerCandidate(
  state: BrowerAssistedCaptureState,
  candidateId: string,
  outcome: Exclude<BrowerCandidateOutcome, "dropped">
): BrowerAssistedCaptureState {
  return {
    ...state,
    candidates: state.candidates.filter((candidate) => candidate.id !== candidateId),
    retired: retireIds(state, [{ id: candidateId, outcome }]),
  };
}

/** Discards every offered candidate at once. Creates no shots. */
export function discardAllBrowerCandidates(
  state: BrowerAssistedCaptureState
): BrowerAssistedCaptureState {
  if (state.candidates.length === 0) return state;
  return {
    ...state,
    candidates: [],
    retired: retireIds(
      state,
      state.candidates.map((candidate) => ({ id: candidate.id, outcome: "discarded" as const }))
    ),
  };
}

/** Records an assembly that yielded no selectable measurement. */
export function recordBrowerAssemblyRejection(
  state: BrowerAssistedCaptureState,
  reason: string
): BrowerAssistedCaptureState {
  return {
    ...state,
    rejectedAssemblyCount: state.rejectedAssemblyCount + 1,
    lastRejectionReason: reason,
  };
}

type ContinuityProblem = { reason: string } | null;

function detectContinuityProblem(
  previous: readonly number[] | undefined,
  next: readonly number[],
  recordKey: string
): ContinuityProblem {
  if (previous === undefined) return null;

  if (next.length < previous.length) {
    return {
      reason: `Record ${recordKey} reported ${next.length} splits after previously reporting ${previous.length}. The timer's record changed in a way this pilot cannot interpret.`,
    };
  }

  for (let index = 0; index < previous.length; index += 1) {
    if (previous[index] !== next[index]) {
      return {
        reason: `Record ${recordKey} split ${index + 1} changed from ${previous[index]} ms to ${next[index]} ms. A previously delivered split was superseded; this pilot cannot tell which value belongs to a shot.`,
      };
    }
  }

  return null;
}

export type ObserveBrowerRecordInput = {
  record: BrowerChronRecord;
  /** ISO timestamp of BYTE ARRIVAL. Never treated as a measurement time. */
  receivedAt: string;
  /**
   * The arming epoch that was current when this record's FIRST packet arrived — not
   * when its last one did.
   *
   * An assembly that began before arming describes the apparatus being set up. Its
   * appendix may well arrive after the operator confirms setup, and treating the
   * completed record as new because of that arrival order would offer setup intervals
   * as shots. Carrying the start epoch is what keeps the assembly boundary intact.
   */
  assemblyStartedAtArmingEpoch: number;
};

/**
 * Folds one validated record into the state.
 *
 * Returns a new state in every phase — `observed` always advances, because a baseline
 * that stopped tracking would let a later re-arm present an old split as new.
 */
export function observeBrowerChronRecord(
  state: BrowerAssistedCaptureState,
  input: ObserveBrowerRecordInput
): BrowerAssistedCaptureState {
  const { record, receivedAt } = input;
  const previous = state.observed[record.key];
  const startedBeforeCurrentArming = input.assemblyStartedAtArmingEpoch !== state.armingEpoch;

  const continuity = detectContinuityProblem(previous, record.cumulativeMs, record.key);

  const observed: Record<string, number[]> = {
    ...state.observed,
    [record.key]: [...record.cumulativeMs],
  };

  const completeObservationCount = state.completeObservationCount + 1;

  const exhaustedRecordKeys =
    record.cumulativeMs.length >= BROWER_CHRON_MAX_SPLITS &&
    !state.exhaustedRecordKeys.includes(record.key)
      ? [...state.exhaustedRecordKeys, record.key]
      : state.exhaustedRecordKeys;

  if (continuity !== null) {
    return suspendBrowerAssistedCapture(
      { ...state, observed, exhaustedRecordKeys, completeObservationCount },
      continuity.reason
    );
  }

  const withObservation: BrowerAssistedCaptureState = {
    ...state,
    observed,
    exhaustedRecordKeys,
    completeObservationCount,
  };

  if (withObservation.phase !== "armed" || withObservation.context === null) {
    return withObservation;
  }

  // The assembly boundary. A record whose first packet predates this arming was being
  // measured while the apparatus was set up; completing it now makes it part of the
  // baseline, never a candidate.
  if (startedBeforeCurrentArming) {
    return {
      ...withObservation,
      baseline: {
        ...(withObservation.baseline ?? {}),
        [record.key]: [...record.cumulativeMs],
      },
    };
  }

  // A reset, a New press or a new memory location changes which record the timer is
  // filling. This invalidates pending candidates. A full record remains selectable
  // until New/reset occurs, so accept wanted times before starting a new record.
  const armedRecordKeys = new Set(
    withObservation.candidates.map((candidate) => candidate.recordKey)
  );
  const previouslyKnown = previous !== undefined;
  const isDifferentRecord =
    !previouslyKnown &&
    (armedRecordKeys.size > 0 ||
      Object.keys(withObservation.baseline ?? {}).length > 0);

  if (isDifferentRecord) {
    return {
      ...withObservation,
      phase: "suspended",
      candidates: [],
      suspendedReason: `The timer started a new record (${record.key}). Confirm the setup again before recording from it.`,
      baseline: {
        ...(withObservation.baseline ?? {}),
        [record.key]: [...record.cumulativeMs],
      },
    };
  }

  const context = withObservation.context;
  const baselineSplitCount = withObservation.baseline?.[record.key]?.length ?? 0;
  const retiredIds = new Set(withObservation.retired.map((entry) => entry.id));
  const offeredIds = new Set(withObservation.candidates.map((candidate) => candidate.id));

  const additions: BrowerCandidate[] = [];
  let filteredAdditions = 0;

  for (const interval of deriveBrowerChronIntervals(record.cumulativeMs)) {
    // Rule 2: everything the baseline already held is permanently ineligible.
    if (interval.splitIndex <= baselineSplitCount) continue;

    if (!browerIntervalFitsShotRange(interval.intervalMs, context)) {
      // Retain the split in observed and subtract adjacent ORIGINAL cumulative values.
      // Count only newly observed positions, so full-record repeats are inert.
      if (interval.splitIndex > (previous?.length ?? 0)) filteredAdditions += 1;
      continue;
    }

    const id = browerCandidateId(context, record.key, interval.splitIndex);
    // Rule 4: a repeat regenerates an identical id and therefore changes nothing.
    if (retiredIds.has(id) || offeredIds.has(id)) continue;

    additions.push({
      id,
      recordKey: record.key,
      splitIndex: interval.splitIndex,
      intervalMs: interval.intervalMs,
      cumulativeMs: interval.cumulativeMs,
      precedingCumulativeMs: interval.precedingCumulativeMs,
      recordSplitCount: record.cumulativeMs.length,
      observedAt: receivedAt,
      context,
    });
  }

  const filteredCandidateCount = withObservation.filteredCandidateCount + filteredAdditions;
  if (additions.length === 0) return { ...withObservation, filteredCandidateCount };

  const combined = [...withObservation.candidates, ...additions];
  const overflow = Math.max(0, combined.length - BROWER_MAX_OFFERED_CANDIDATES);
  const dropped = combined.slice(0, overflow);

  return {
    ...withObservation,
    candidates: combined.slice(overflow),
    filteredCandidateCount,
    droppedCandidateCount: withObservation.droppedCandidateCount + dropped.length,
    retired: retireIds(
      withObservation,
      dropped.map((candidate) => ({ id: candidate.id, outcome: "dropped" as const }))
    ),
  };
}

/** True once a record can hold no further splits. */
export function isBrowerRecordExhausted(
  state: BrowerAssistedCaptureState,
  recordKey: string
): boolean {
  return state.exhaustedRecordKeys.includes(recordKey);
}

/**
 * The record the operator is currently filling, if one can be identified: the most
 * recently observed one. Used only for honest status text (split counts, exhaustion),
 * never to decide which interval is a shot.
 */
export function describeBrowerBaseline(state: BrowerAssistedCaptureState): {
  recordCount: number;
  splitCount: number;
} {
  const source = state.baseline ?? state.observed;
  const entries = Object.values(source);
  return {
    recordCount: entries.length,
    splitCount: entries.reduce((total, splits) => total + splits.length, 0),
  };
}

/**
 * What the application actually looks like at the moment a queued acceptance runs.
 *
 * Deliberately a plain snapshot rather than the live Session: this keeps the ownership
 * rule a pure, exhaustively testable function instead of logic buried in a component,
 * and makes it impossible to "verify" against anything other than the values the caller
 * read at execution time.
 */
export type BrowerCaptureOwnershipSnapshot = {
  /** False while the Session domain is loading or write-protected. */
  sessionReady: boolean;
  /** True while an Assessment Run owns the shared stream (ADR-0011). */
  assessmentCaptureActive: boolean;
  profileId: string | null;
  sessionId: string | null;
  activeBlockId: string | null;
  activeBlockMeasurementMode: MeasurementMode | null;
  captureSequenceId: string | null;
  captureShotType?: ShotType;
};

/**
 * Re-checks that the context a candidate was offered for is still the live one.
 *
 * Returns a person-readable refusal, or null when acceptance may proceed. This runs at
 * EXECUTION time, not at tap time: acceptance is deferred through the shared capture
 * queue, and between the tap and the execution a block can be completed, a sequence
 * cancelled, an account switched or an Assessment run started.
 *
 * It deliberately does not judge the capture sequence's own status (paused, completed,
 * cancelled). That is the Capture Sequence domain's decision and `processTimingResult`
 * already reports it precisely; duplicating it here would create two sources of truth
 * for one rule.
 */
export function verifyBrowerCaptureOwnership(
  expected: BrowerCaptureContext,
  actual: BrowerCaptureOwnershipSnapshot
): string | null {
  if (!actual.sessionReady) {
    return "This time was not recorded: training data is not ready to be written.";
  }
  if (actual.assessmentCaptureActive) {
    return "This time was not recorded: an assessment run is using the timer right now.";
  }
  if (actual.profileId === null || actual.profileId !== expected.profileId) {
    return "This time was not recorded: the signed-in profile changed.";
  }
  if (actual.sessionId === null || actual.sessionId !== expected.sessionId) {
    return "This time was not recorded: the training session changed.";
  }
  if (actual.captureSequenceId === null || actual.captureSequenceId !== expected.sequenceId) {
    return "This time was not recorded: the capture sequence it was offered for is no longer running.";
  }
  if (actual.activeBlockId === null || actual.activeBlockId !== expected.blockId) {
    return "This time was not recorded: the active training block changed.";
  }
  if (actual.captureShotType !== expected.shotType) {
    return "This time was not recorded: the selected shot type changed.";
  }
  if (actual.activeBlockMeasurementMode !== expected.measurementMode) {
    return `This time was not recorded: the block now measures ${actual.activeBlockMeasurementMode ?? "nothing"}, not ${expected.measurementMode}.`;
  }
  return null;
}
