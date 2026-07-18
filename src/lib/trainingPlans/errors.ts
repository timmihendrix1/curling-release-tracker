// Structured domain error convention for the Training Plans module, matching the
// same discriminated-union "outcome" house style used by src/lib/assessment/errors.ts
// rather than throwing for ordinary, expected rejections.
export type TrainingPlanErrorCode =
  | "invalid_plan"
  | "invalid_step"
  | "plan_not_found";

export type TrainingPlanError = {
  code: TrainingPlanErrorCode;
  message: string;
};

export type TrainingPlanOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: TrainingPlanError };

export function ok<T>(value: T): TrainingPlanOutcome<T> {
  return { ok: true, value };
}

export function err(
  code: TrainingPlanErrorCode,
  message: string
): TrainingPlanOutcome<never> {
  return { ok: false, error: { code, message } };
}
