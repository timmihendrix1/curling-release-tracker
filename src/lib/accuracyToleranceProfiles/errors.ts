// Structured domain error convention for the Accuracy Tolerance Profiles module,
// matching the same discriminated-union "outcome" house style used by
// src/lib/trainingPlans/errors.ts and src/lib/assessment/errors.ts rather than
// throwing for ordinary, expected rejections (an invalid name, invalid thresholds,
// a profile that no longer exists).
export type AccuracyToleranceProfileErrorCode =
  | "invalid_name"
  | "invalid_thresholds"
  | "profile_not_found";

export type AccuracyToleranceProfileError = {
  code: AccuracyToleranceProfileErrorCode;
  message: string;
};

export type AccuracyToleranceProfileOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: AccuracyToleranceProfileError };

export function ok<T>(value: T): AccuracyToleranceProfileOutcome<T> {
  return { ok: true, value };
}

export function err(
  code: AccuracyToleranceProfileErrorCode,
  message: string
): AccuracyToleranceProfileOutcome<never> {
  return { ok: false, error: { code, message } };
}
