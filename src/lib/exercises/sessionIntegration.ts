import type { Session } from "../../types";
import { EXERCISE_CATALOG } from "./catalog";
import { abandonExerciseExecution } from "./execution";
import type { ExerciseExecution } from "./executionTypes";
import { validateExerciseExecution } from "./executionValidation";
import { findExerciseVersion } from "./lookup";

export type SessionExerciseValidationIssue = {
  path: string;
  message: string;
};

export type SessionExerciseValidationResult =
  | { valid: true; executions: ExerciseExecution[]; activeExecutionId?: string; issues: [] }
  | { valid: false; issues: SessionExerciseValidationIssue[] };

export type SessionExerciseMutationResult =
  | { ok: true; value: Session }
  | { ok: false; error: { kind: "invalid-session-exercise-state"; message: string } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failed(message: string): SessionExerciseMutationResult {
  return { ok: false, error: { kind: "invalid-session-exercise-state", message } };
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return Object.is(left, right);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) =>
      key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key])
    );
}

function withoutMutablePrivateNotes(execution: ExerciseExecution): ExerciseExecution {
  return {
    ...execution,
    athleteResults: execution.athleteResults.map((result) => ({
      ...result,
      privateNote: undefined,
      updatedAt: "private-note-timestamp",
    })),
  };
}

function executionEntityIds(execution: ExerciseExecution): string[] {
  return [
    execution.id,
    ...execution.roleAssignmentSegments.map((segment) => segment.id),
    ...execution.athleteResults.flatMap((result) => [
      result.id,
      ...result.attempts.flatMap((attempt) => [
        attempt.id,
        ...attempt.measurements.map((measurement) => measurement.id),
      ]),
    ]),
  ];
}

function isAllowedActiveReplacement(
  existing: ExerciseExecution,
  replacement: ExerciseExecution
): boolean {
  if (
    !sameJsonValue(existing.exerciseVersionSnapshot, replacement.exerciseVersionSnapshot) ||
    !sameJsonValue(existing.configuration, replacement.configuration) ||
    !sameJsonValue(existing.roleAssignmentSegments, replacement.roleAssignmentSegments) ||
    existing.id !== replacement.id ||
    existing.trainingSessionId !== replacement.trainingSessionId ||
    existing.evaluationBasis !== replacement.evaluationBasis ||
    existing.startedAt !== replacement.startedAt ||
    existing.schemaVersion !== replacement.schemaVersion ||
    existing.athleteResults.length !== replacement.athleteResults.length
  ) return false;

  return existing.athleteResults.every((result, index) => {
    const next = replacement.athleteResults[index];
    if (
      result.id !== next.id ||
      result.athleteProfileId !== next.athleteProfileId ||
      result.createdAt !== next.createdAt ||
      Date.parse(next.updatedAt) < Date.parse(result.updatedAt) ||
      next.attempts.length < result.attempts.length ||
      next.attempts.length > result.attempts.length + 1 ||
      !result.attempts.every((attempt, attemptIndex) =>
        sameJsonValue(attempt, next.attempts[attemptIndex])
      )
    ) return false;
    // Completion/abandonment is a separate transition after the last attempt was
    // persisted; it cannot smuggle in a new attempt at the same time.
    if (replacement.status !== "in-progress" && next.attempts.length !== result.attempts.length) {
      return false;
    }
    const appended = next.attempts[result.attempts.length];
    return appended === undefined || Date.parse(appended.createdAt) >= Date.parse(result.updatedAt);
  });
}

/**
 * Strict boundary for the optional Exercise Execution portion of a Training Session.
 * Absence is valid for every legacy and Release-Time-only Session. Once either field
 * is present, the aggregate is validated without repair or invented defaults.
 */
export function validateSessionExerciseState(
  value: unknown,
  sessionId: string
): SessionExerciseValidationResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      issues: [{ path: "$", message: "Training Session must be an object." }],
    };
  }

  const rawExecutions = value.exerciseExecutions;
  const rawActiveId = value.activeExerciseExecutionId;
  const rawReleaseTimingSnapshot = value.releaseTimingExerciseVersionSnapshot;
  if (
    rawExecutions === undefined &&
    rawActiveId === undefined &&
    rawReleaseTimingSnapshot === undefined
  ) {
    return { valid: true, executions: [], issues: [] };
  }

  const issues: SessionExerciseValidationIssue[] = [];
  if (rawReleaseTimingSnapshot !== undefined) {
    const snapshot = isRecord(rawReleaseTimingSnapshot) &&
      typeof rawReleaseTimingSnapshot.id === "string"
      ? findExerciseVersion(EXERCISE_CATALOG, rawReleaseTimingSnapshot.id)
      : undefined;
    const protocols = snapshot?.compatibleMeasurementProtocols.map((reference) =>
      EXERCISE_CATALOG.measurementProtocols.find(
        (protocol) =>
          protocol.id === reference.protocolId &&
          protocol.version === reference.protocolVersion
      )
    );
    if (
      !snapshot ||
      !sameJsonValue(snapshot, rawReleaseTimingSnapshot) ||
      snapshot.primaryFocus !== "measured" ||
      snapshot.compatibleMeasurementProtocols.length === 0 ||
      protocols?.some((protocol) => protocol?.metricType !== "release-time")
    ) {
      issues.push({
        path: "releaseTimingExerciseVersionSnapshot",
        message: "Release Timing provenance must be an immutable catalog Measured Exercise using release-time protocols.",
      });
    }
  }
  if (rawExecutions === undefined && rawActiveId === undefined) {
    return issues.length > 0
      ? { valid: false, issues }
      : { valid: true, executions: [], issues: [] };
  }
  if (!Array.isArray(rawExecutions)) {
    issues.push({
      path: "exerciseExecutions",
      message: "Exercise Executions must be an array when Exercise state is present.",
    });
    return { valid: false, issues };
  }

  const executions: ExerciseExecution[] = [];
  const ids = new Set<string>();
  const entityIds = new Set<string>();
  for (const [index, candidate] of rawExecutions.entries()) {
    const validation = validateExerciseExecution(candidate, EXERCISE_CATALOG);
    if (!validation.valid) {
      for (const issue of validation.issues) {
        issues.push({
          path: `exerciseExecutions[${index}].${issue.path}`,
          message: issue.message,
        });
      }
      continue;
    }
    if (validation.value.trainingSessionId !== sessionId) {
      issues.push({
        path: `exerciseExecutions[${index}].trainingSessionId`,
        message: "Exercise Execution must belong to its containing Training Session.",
      });
    }
    if (validation.value.exerciseVersionSnapshot.primaryFocus === "measured") {
      issues.push({
        path: `exerciseExecutions[${index}].exerciseVersionSnapshot.primaryFocus`,
        message: "B2 does not persist Measured execution beside the existing Release Timing runner.",
      });
    }
    if (validation.value.teamContext !== undefined) {
      issues.push({
        path: `exerciseExecutions[${index}].teamContext`,
        message: "Stage C1 Team execution cannot enter the Profile-owned Solo Session before the shared coordination and athlete-bundle persistence boundary exists.",
      });
    }
    if (ids.has(validation.value.id)) {
      issues.push({
        path: `exerciseExecutions[${index}].id`,
        message: "Exercise Execution ids must be unique within a Training Session.",
      });
    }
    ids.add(validation.value.id);
    for (const entityId of executionEntityIds(validation.value)) {
      if (entityIds.has(entityId)) {
        issues.push({
          path: `exerciseExecutions[${index}]`,
          message: "Exercise entity ids must be globally unique within a Training Session.",
        });
      }
      entityIds.add(entityId);
    }
    executions.push(validation.value);
  }

  const inProgress = executions.filter((execution) => execution.status === "in-progress");
  if (inProgress.length > 1) {
    issues.push({
      path: "exerciseExecutions",
      message: "A Training Session can have at most one in-progress Exercise Execution.",
    });
  }

  if (inProgress.length === 1) {
    if (rawActiveId !== inProgress[0].id) {
      issues.push({
        path: "activeExerciseExecutionId",
        message: "The active Exercise Execution id must name the sole in-progress execution.",
      });
    }
  } else if (rawActiveId !== undefined) {
    issues.push({
      path: "activeExerciseExecutionId",
      message: "A terminal Exercise state cannot name an active execution.",
    });
  }

  return issues.length > 0
    ? { valid: false, issues }
    : {
        valid: true,
        executions,
        ...(typeof rawActiveId === "string" ? { activeExecutionId: rawActiveId } : {}),
        issues: [],
      };
}

export function attachSoloExerciseExecution(
  session: Session,
  execution: ExerciseExecution
): SessionExerciseMutationResult {
  if (execution.teamContext !== undefined) {
    return failed("A Team Exercise Execution cannot use the Solo Session attachment boundary.");
  }
  const current = validateSessionExerciseState(session, session.id);
  if (!current.valid) return failed("The Training Session's Exercise state is invalid.");
  if (current.activeExecutionId) {
    return failed("Complete or abandon the active Exercise before starting another one.");
  }
  if (current.executions.some((candidate) => candidate.id === execution.id)) {
    return failed("This Exercise Execution is already attached to the Training Session.");
  }
  if (execution.trainingSessionId !== session.id || execution.status !== "in-progress") {
    return failed("A newly attached Exercise Execution must be active and belong to this Training Session.");
  }

  const next: Session = {
    ...session,
    exerciseExecutions: [...current.executions, execution],
    activeExerciseExecutionId: execution.id,
  };
  return validateSessionExerciseState(next, next.id).valid
    ? { ok: true, value: next }
    : failed("The resulting Training Session Exercise state is invalid.");
}

export function replaceExerciseExecution(
  session: Session,
  execution: ExerciseExecution
): SessionExerciseMutationResult {
  const current = validateSessionExerciseState(session, session.id);
  if (!current.valid) return failed("The Training Session's Exercise state is invalid.");
  const index = current.executions.findIndex((candidate) => candidate.id === execution.id);
  if (index < 0 || execution.trainingSessionId !== session.id) {
    return failed("The replacement Exercise Execution must already belong to this Training Session.");
  }
  const existing = current.executions[index];
  if (current.activeExecutionId === execution.id) {
    if (!isAllowedActiveReplacement(existing, execution)) {
      return failed("An active Exercise update must be append-only and preserve its snapshots.");
    }
  } else {
    const isPrivateNoteOnlyTerminalUpdate =
      existing.status !== "in-progress" &&
      execution.status === existing.status &&
      sameJsonValue(
        withoutMutablePrivateNotes(existing),
        withoutMutablePrivateNotes(execution)
      ) &&
      existing.athleteResults.every(
        (result, resultIndex) =>
          Date.parse(execution.athleteResults[resultIndex].updatedAt) >=
          Date.parse(result.updatedAt)
      );
    if (!isPrivateNoteOnlyTerminalUpdate) {
      return failed("A terminal Exercise Execution permits only private Athlete Note updates.");
    }
  }

  const executions = current.executions.map((candidate, candidateIndex) =>
    candidateIndex === index ? execution : candidate
  );
  const next: Session = {
    ...session,
    exerciseExecutions: executions,
    ...(execution.status === "in-progress"
      ? { activeExerciseExecutionId: execution.id }
      : { activeExerciseExecutionId: undefined }),
  };
  return validateSessionExerciseState(next, next.id).valid
    ? { ok: true, value: next }
    : failed("The resulting Training Session Exercise state is invalid.");
}

export function sessionHasArchivableActivity(session: Session): boolean {
  return session.shots.length > 0 || (session.exerciseExecutions?.length ?? 0) > 0;
}

/** Terminalises an interrupted Exercise before the containing Session is archived. */
export function prepareSessionForArchive(
  session: Session,
  at = new Date().toISOString()
): SessionExerciseMutationResult {
  const current = validateSessionExerciseState(session, session.id);
  if (!current.valid) return failed("The Training Session's Exercise state is invalid.");
  if (!current.activeExecutionId) return { ok: true, value: session };
  const active = current.executions.find(
    (execution) => execution.id === current.activeExecutionId
  );
  if (!active) return failed("The active Exercise Execution cannot be resolved.");
  const abandoned = abandonExerciseExecution(active, at);
  if (!abandoned.ok) return failed("The active Exercise Execution could not be abandoned safely.");
  return replaceExerciseExecution(session, abandoned.value);
}

export function isSessionExerciseCloudEligible(session: Session): boolean {
  const validation = validateSessionExerciseState(session, session.id);
  return validation.valid &&
    validation.activeExecutionId === undefined &&
    validation.executions.every((execution) => execution.status !== "in-progress");
}
