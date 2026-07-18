// Structured domain error convention for the Smart Random Profiles module,
// matching the same discriminated-union "outcome" house style used by
// src/lib/trainingPlans/errors.ts and src/lib/accuracyToleranceProfiles/errors.ts.
export type SmartRandomProfileErrorCode =
  | "invalid_name"
  | "invalid_range"
  | "unsupported_measurement_mode"
  | "profile_not_found";

export type SmartRandomProfileError = {
  code: SmartRandomProfileErrorCode;
  message: string;
};

export type SmartRandomProfileOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: SmartRandomProfileError };

export function ok<T>(value: T): SmartRandomProfileOutcome<T> {
  return { ok: true, value };
}

export function err(
  code: SmartRandomProfileErrorCode,
  message: string
): SmartRandomProfileOutcome<never> {
  return { ok: false, error: { code, message } };
}
