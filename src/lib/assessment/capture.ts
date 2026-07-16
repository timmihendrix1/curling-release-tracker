// Bridges the shared, provider-neutral TimingResult boundary (see
// src/lib/timingProvider.ts, ADR-0006) into the Assessment Attempt domain —
// the Assessment-side counterpart to captureSequence.ts's
// applyTimingResultToSession. Adapts a TimingResult into an addValidAttempt
// call; it never re-derives attempt/threshold/progress rules itself.
import type { Handle, TimingResult } from "../../types";
import { addValidAttempt } from "./attempts";
import { getCurrentPlannedShot } from "./progress";
import type { AssessmentRun } from "./types";

export type AssessmentCaptureOutcome =
  | { status: "accepted"; run: AssessmentRun; measuredTime: number }
  | { status: "duplicate" }
  | { status: "rejected"; reason: string };

/**
 * Applies one TimingResult to the run's current planned shot, using
 * `executedHandle` as the handle actually thrown (defaults to the expected
 * handle in the UI, but may be overridden — see addValidAttempt's
 * wrong-handle Protocol Deviation behavior). Pure: never mutates `run`.
 */
export function applyTimingResultToAssessmentRun(
  run: AssessmentRun,
  result: TimingResult,
  executedHandle: Handle
): AssessmentCaptureOutcome {
  const currentShot = getCurrentPlannedShot(run);
  if (!currentShot) {
    return { status: "rejected", reason: "No planned shot is currently active." };
  }

  const measurement = result.measurements.find(
    (candidate) => candidate.measurementMode === run.timingProviderSnapshot.measurementMode
  );
  if (!measurement) {
    return {
      status: "rejected",
      reason: `Timing result has no measurement for ${run.timingProviderSnapshot.measurementMode}.`,
    };
  }

  const outcome = addValidAttempt(run, currentShot.id, {
    measuredTime: measurement.value,
    executedHandle,
    timingResultId: result.id,
    providerMetadata: { providerId: result.source },
  });

  if (!outcome.ok) {
    if (outcome.error.code === "duplicate_timing_result") {
      return { status: "duplicate" };
    }
    return { status: "rejected", reason: outcome.error.message };
  }

  return { status: "accepted", run: outcome.value, measuredTime: measurement.value };
}
