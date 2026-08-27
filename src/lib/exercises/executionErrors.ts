export type ExerciseExecutionErrorCode =
  | "invalid-input"
  | "unsupported-focus"
  | "unsupported-variation"
  | "unsupported-measurement-protocol"
  | "required-measurement-protocol-missing"
  | "execution-not-active"
  | "wrong-athlete"
  | "invalid-attempt"
  | "not-completable";

export type ExerciseExecutionError = {
  code: ExerciseExecutionErrorCode;
  message: string;
};

export type ExerciseExecutionOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: ExerciseExecutionError };

export function exerciseExecutionOk<T>(value: T): ExerciseExecutionOutcome<T> {
  return { ok: true, value };
}
export function exerciseExecutionError<T>(
  code: ExerciseExecutionErrorCode,
  message: string
): ExerciseExecutionOutcome<T> {
  return { ok: false, error: { code, message } };
}
