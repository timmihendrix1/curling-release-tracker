// Ending the plan's currently active runtime entity.
//
// Flexible progression (docs/TRAINING_SYSTEM_AND_PLANS.md section 31) lets the athlete
// leave a planned Exercise at any moment — below, at or above its planned volume, and
// with nothing recorded at all. Whatever the reason, the step's runtime must reach a
// truthful terminal state *before* the next one is materialised, in the same Session
// value: an in-progress Exercise Execution would otherwise block
// attachSoloExerciseExecution, and a still-running Capture Sequence would otherwise
// keep a closed capture context alive across the transition.
//
// Deliberately a pure old-Session + event -> new-Session function (ADR-0007's house
// rule): no React state, no persistence, no invented sporting data. Completion
// eligibility is the existing Exercise domain's, unchanged — a step that cannot
// legally complete is abandoned rather than granted a fabricated attempt.
import type { PlanExecutionState, Session } from "../../types";
import { cancelCaptureSequence, isCaptureSequenceActive } from "../captureSequence";
import {
  abandonExerciseExecution,
  completeExerciseExecution,
} from "../exercises/execution";
import { replaceExerciseExecution } from "../exercises/sessionIntegration";
import { err, ok, type TrainingPlanOutcome } from "./errors";
import { getActiveStepSnapshot } from "./progress";
import { isReleaseTimingPlanStep } from "./steps";

/**
 * Terminalises whatever runtime the active Plan Step owns, preserving every recorded
 * attempt, measurement, exclusion and private Athlete Note.
 *
 * Release Time keeps its Block and Shots exactly as recorded; only an Auto Capture
 * sequence still bound to that Block is closed, so a late Timing Result can never be
 * applied to the step that replaces it.
 *
 * A Technique/Shotmaking/Measured step is completed when the Exercise domain considers
 * it completable, and abandoned when it does not (an empty Shotmaking step, for
 * example). An already-terminal Exercise is returned untouched — never reopened and
 * never rewritten.
 */
export function endActivePlanStepRuntime(
  session: Session,
  planExecution: PlanExecutionState,
  at = new Date().toISOString()
): TrainingPlanOutcome<Session> {
  const snapshot = getActiveStepSnapshot(planExecution);
  if (!snapshot) return err("invalid_step", "The active Plan Step could not be resolved.");
  if (!snapshot.runtime) return ok(session);

  if (isReleaseTimingPlanStep(snapshot.step)) {
    if (snapshot.runtime.kind !== "release-timing-block") {
      return err(
        "invalid_step",
        "This Release Time step does not reference a Training Block."
      );
    }

    const sequence = session.captureSequence;
    if (
      !sequence ||
      !isCaptureSequenceActive(sequence) ||
      sequence.blockId !== snapshot.runtime.blockId
    ) {
      return ok(session);
    }

    return ok({ ...session, captureSequence: cancelCaptureSequence(sequence) });
  }

  if (snapshot.runtime.kind !== "exercise-execution") {
    return err(
      "invalid_step",
      "This Exercise step does not reference an Exercise Execution."
    );
  }

  const executionId = snapshot.runtime.exerciseExecutionId;
  const execution = session.exerciseExecutions?.find(
    (candidate) => candidate.id === executionId
  );
  if (!execution) {
    return err("invalid_step", "The Exercise Execution for this step could not be found.");
  }
  if (execution.status !== "in-progress") return ok(session);

  const completed = completeExerciseExecution(execution, at);
  const terminal = completed.ok ? completed : abandonExerciseExecution(execution, at);
  if (!terminal.ok) {
    return err("invalid_step", terminal.error.message);
  }

  const replaced = replaceExerciseExecution(session, terminal.value);
  return replaced.ok
    ? ok(replaced.value)
    : err("invalid_step", replaced.error.message);
}
