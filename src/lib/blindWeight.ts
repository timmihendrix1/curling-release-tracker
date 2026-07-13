// Blind Weight entry state machine.
//
// The real-world flow this models: look at the target, play the shot,
// estimate (predict) the release time, LOCK that prediction, only then read
// the external timing system and enter the measured time, then review
// prediction vs. target vs. actual before saving. The app never knows the
// actual release time before the prediction is locked — it isn't captured
// early and hidden, it simply doesn't exist yet from the app's point of view.
//
// Modeled as one discriminated `phase`, not a handful of independent
// booleans — that would allow nonsensical combinations (e.g. "measured but
// not predicted", "reviewing without a locked prediction") the functions
// below make structurally impossible instead of merely discouraged.
import type { ReleaseTimeSource } from "../types";

export type BlindEntryPhase = "predict" | "measure" | "review";

export type BlindShotDraft = {
  phase: BlindEntryPhase;
  predictedTime?: number;
  releaseTime?: number;
};

export const INITIAL_BLIND_SHOT_DRAFT: BlindShotDraft = { phase: "predict" };

/**
 * Locks in the player's prediction and advances predict -> measure. No-op
 * (returns the draft unchanged) if called outside the predict phase — e.g.
 * a stray double-submit can't advance the phase twice.
 */
export function lockPrediction(
  draft: BlindShotDraft,
  predictedTime: number
): BlindShotDraft {
  if (draft.phase !== "predict") return draft;
  return { phase: "measure", predictedTime, releaseTime: undefined };
}

/**
 * Records a measured release time into the draft — but does NOT by itself
 * advance the phase. This is the prepared integration point for a future
 * external timing source: today the UI calls it with source "manual" right
 * before advancing to review; a future hardware integration could call the
 * exact same function with source "external" whenever a reading arrives.
 *
 * Critically, this only ever takes effect during the "measure" phase — a
 * value arriving (typed or, later, received from a device) before the
 * prediction is locked is a no-op here, so it can never leak into the UI
 * ahead of the lock. A future integration wanting to buffer an early
 * external reading instead of discarding it would store it outside this
 * draft and re-deliver it once the phase reaches "measure" — that buffering
 * is intentionally not built yet (see the result report for details).
 */
export function setMeasuredReleaseTime(
  draft: BlindShotDraft,
  releaseTime: number,
  // Unused today — kept in the signature so callers (and future ones) are
  // required to be explicit about where the reading came from.
  source: ReleaseTimeSource = "manual"
): BlindShotDraft {
  void source;
  if (draft.phase !== "measure") return draft;
  return { ...draft, releaseTime };
}

/** Advances measure -> review. Requires a measured time to already be set. */
export function confirmMeasuredTime(draft: BlindShotDraft): BlindShotDraft {
  if (draft.phase !== "measure" || draft.releaseTime === undefined) {
    return draft;
  }

  return { ...draft, phase: "review" };
}

/**
 * Goes back to predict for correction. The existing prediction is kept as
 * an editable starting value (the caller re-locks it to move forward again).
 * Any already-entered measured time is kept in the draft but is not visible
 * again until the prediction is re-locked and measure is reached anew.
 */
export function editPrediction(draft: BlindShotDraft): BlindShotDraft {
  if (draft.phase !== "measure" && draft.phase !== "review") return draft;
  return { ...draft, phase: "predict" };
}

/** Goes back to measure for correction. The locked prediction is unaffected. */
export function editMeasuredTime(draft: BlindShotDraft): BlindShotDraft {
  if (draft.phase !== "review") return draft;
  return { ...draft, phase: "measure" };
}

export function isDraftComplete(
  draft: BlindShotDraft
): draft is BlindShotDraft & { predictedTime: number; releaseTime: number } {
  return (
    draft.phase === "review" &&
    draft.predictedTime !== undefined &&
    draft.releaseTime !== undefined
  );
}

/**
 * Whether leaving right now would discard meaningful in-progress work (a
 * locked prediction at minimum) — used to gate navigation away from an
 * in-progress Blind Weight shot (see TrackerApp's draft-leave guard).
 */
export function hasUnsavedBlindProgress(draft: BlindShotDraft): boolean {
  return draft.phase !== "predict";
}

/** positive: the player believed they played slower than they actually did. */
export function predictionError(predictedTime: number, releaseTime: number): number {
  return predictedTime - releaseTime;
}

/** positive: the actual release time ran long relative to the target. */
export function targetError(releaseTime: number, targetTime: number): number {
  return releaseTime - targetTime;
}
