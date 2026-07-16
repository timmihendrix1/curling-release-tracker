// Structured domain error convention for the Assessment module, matching the
// discriminated-union "outcome" house style used elsewhere (e.g.
// ProcessTimingResultOutcome in captureSequence.ts, AccuracyThresholdsValidation
// in accuracyThresholds.ts) rather than throwing for ordinary, expected
// rejections. Genuine bugs (e.g. malformed template passed by a programmer
// error) may still throw — see individual module docs.
export type AssessmentErrorCode =
  | "invalid_threshold_set"
  | "invalid_status_transition"
  | "planned_shot_not_current"
  | "planned_shot_already_completed"
  | "invalid_attempt_limit_reached"
  | "duplicate_timing_result"
  | "run_already_completed"
  | "run_already_incomplete"
  | "template_validation_failed"
  | "run_not_completable"
  | "invalid_persisted_assessment_data"
  | "unknown_planned_shot"
  | "invalid_measured_time"
  | "current_run_mismatch"
  | "current_run_already_active";

export type AssessmentError = {
  code: AssessmentErrorCode;
  message: string;
};

export type AssessmentOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: AssessmentError };

export function ok<T>(value: T): AssessmentOutcome<T> {
  return { ok: true, value };
}

export function err(code: AssessmentErrorCode, message: string): AssessmentOutcome<never> {
  return { ok: false, error: { code, message } };
}
