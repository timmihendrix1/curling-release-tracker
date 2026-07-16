// Attempt semantics: adding invalid and valid attempts to an AssessmentRun.
// Pure functions — old run + event -> new run, computed in one step (same
// discipline as applyTimingResultToSession in captureSequence.ts; see
// ADR-0007). Never mutates its input.
import type { Handle } from "../../types";
import { err, ok, type AssessmentError, type AssessmentOutcome } from "./errors";
import { getCurrentPlannedShot } from "./progress";
import type {
  AssessmentAttempt,
  AssessmentAttemptProviderMetadata,
  AssessmentRun,
  InvalidAttemptReason,
  ProtocolDeviation,
} from "./types";

/** See docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 12: at most 2 invalid repeats per planned shot. */
export const MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT = 2;

function runMutabilityError(run: AssessmentRun): AssessmentError | null {
  if (run.status === "completed") {
    return { code: "run_already_completed", message: "This Assessment Run has already been completed and cannot record new attempts." };
  }
  if (run.status === "incomplete") {
    return { code: "run_already_incomplete", message: "This Assessment Run has already been marked incomplete and cannot record new attempts." };
  }
  return null;
}

function attemptsForPlannedShot(run: AssessmentRun, plannedShotId: string): AssessmentAttempt[] {
  return run.attempts.filter((attempt) => attempt.plannedShotId === plannedShotId);
}

function findDuplicateTimingResultError(
  run: AssessmentRun,
  timingResultId: string | undefined
): AssessmentError | null {
  if (!timingResultId) return null;
  const alreadyProcessed = run.attempts.some((attempt) => attempt.timingResultId === timingResultId);
  if (!alreadyProcessed) return null;
  return {
    code: "duplicate_timing_result",
    message: "This timing result has already been recorded for this Assessment Run.",
  };
}

export type AddInvalidAttemptInput = {
  capturedAt?: string;
  timingResultId?: string;
};

/**
 * Records an invalid attempt against the current planned shot. Never
 * advances `currentPlannedShotIndex` — an invalid attempt does not complete
 * a planned shot. Rejects a third invalid attempt for the same planned shot
 * (`invalid_attempt_limit_reached`) — the caller must pause the run or
 * resolve the setup issue instead (see the spec's Invalid Attempts section).
 */
export function addInvalidAttempt(
  run: AssessmentRun,
  plannedShotId: string,
  reason: InvalidAttemptReason,
  input: AddInvalidAttemptInput = {}
): AssessmentOutcome<AssessmentRun> {
  const mutabilityError = runMutabilityError(run);
  if (mutabilityError) return { ok: false, error: mutabilityError };

  const current = getCurrentPlannedShot(run);
  if (!current || current.id !== plannedShotId) {
    return err("planned_shot_not_current", "Attempts must be recorded against the current planned shot, in sequence.");
  }

  const duplicateError = findDuplicateTimingResultError(run, input.timingResultId);
  if (duplicateError) return { ok: false, error: duplicateError };

  const existing = attemptsForPlannedShot(run, plannedShotId);
  if (existing.some((attempt) => attempt.status === "valid")) {
    return err("planned_shot_already_completed", "This planned shot already has a valid attempt.");
  }

  const invalidCount = existing.filter((attempt) => attempt.status === "invalid").length;
  if (invalidCount >= MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT) {
    return err(
      "invalid_attempt_limit_reached",
      `No more than ${MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT} invalid repeats are allowed for a single planned shot.`
    );
  }

  const attempt: AssessmentAttempt = {
    id: crypto.randomUUID(),
    plannedShotId,
    attemptNumber: existing.length + 1,
    status: "invalid",
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    timingResultId: input.timingResultId,
    invalidReason: reason,
  };

  return ok({ ...run, attempts: [...run.attempts, attempt] });
}

export type AddValidAttemptInput = {
  measuredTime: number;
  executedHandle: Handle;
  capturedAt?: string;
  timingResultId?: string;
  providerMetadata?: AssessmentAttemptProviderMetadata;
};

/**
 * Records a valid, scored attempt against the current planned shot and
 * advances `currentPlannedShotIndex`. An executed handle that doesn't match
 * the planned shot's expected handle does not invalidate the attempt — it
 * remains scored, but records a `wrong_handle` Protocol Deviation (see spec
 * section 14).
 */
export function addValidAttempt(
  run: AssessmentRun,
  plannedShotId: string,
  input: AddValidAttemptInput
): AssessmentOutcome<AssessmentRun> {
  const mutabilityError = runMutabilityError(run);
  if (mutabilityError) return { ok: false, error: mutabilityError };

  const current = getCurrentPlannedShot(run);
  if (!current || current.id !== plannedShotId) {
    return err("planned_shot_not_current", "Attempts must be recorded against the current planned shot, in sequence.");
  }

  const duplicateError = findDuplicateTimingResultError(run, input.timingResultId);
  if (duplicateError) return { ok: false, error: duplicateError };

  const existing = attemptsForPlannedShot(run, plannedShotId);
  if (existing.some((attempt) => attempt.status === "valid")) {
    return err("planned_shot_already_completed", "This planned shot already has a valid attempt.");
  }

  if (!Number.isFinite(input.measuredTime) || input.measuredTime <= 0) {
    return err("invalid_measured_time", "Measured time must be a finite number greater than 0.");
  }

  const isWrongHandle = input.executedHandle !== current.expectedHandle;
  const attemptId = crypto.randomUUID();
  const capturedAt = input.capturedAt ?? new Date().toISOString();

  const attempt: AssessmentAttempt = {
    id: attemptId,
    plannedShotId,
    attemptNumber: existing.length + 1,
    status: "valid",
    measuredTime: input.measuredTime,
    executedHandle: input.executedHandle,
    capturedAt,
    timingResultId: input.timingResultId,
    providerMetadata: input.providerMetadata,
    protocolDeviations: isWrongHandle ? ["wrong_handle"] : undefined,
  };

  const deviation: ProtocolDeviation | undefined = isWrongHandle
    ? {
        id: crypto.randomUUID(),
        type: "wrong_handle",
        plannedShotId,
        attemptId,
        occurredAt: capturedAt,
        details: `Expected ${current.expectedHandle}, executed ${input.executedHandle}.`,
      }
    : undefined;

  return ok({
    ...run,
    attempts: [...run.attempts, attempt],
    protocolDeviations: deviation ? [...run.protocolDeviations, deviation] : run.protocolDeviations,
    currentPlannedShotIndex: run.currentPlannedShotIndex + 1,
  });
}
