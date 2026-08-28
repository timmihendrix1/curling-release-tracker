import { EXERCISE_CATALOG } from "../exercises/catalog";
import type {
  AthleteExerciseResult,
  ExerciseAttempt,
  ExerciseExecution,
  ExerciseRoleAssignmentSegment,
} from "../exercises/executionTypes";
import { validateExerciseExecution } from "../exercises/executionValidation";
import { isCanonicalUuid } from "../uuid";
import {
  TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION,
  type TeamExerciseUploadPackage,
} from "./teamExerciseTypes";

type BundleIdFactory = (result: AthleteExerciseResult) => string;

type TeamCoordinationPayload = {
  schemaVersion: 1;
  execution: Omit<ExerciseExecution, "athleteResults" | "teamContext"> & {
    athleteResults?: never;
    teamContext: Omit<NonNullable<ExerciseExecution["teamContext"]>, "recorderProfileId">;
    roleAssignmentSegments: Array<Omit<ExerciseRoleAssignmentSegment, "recordedByProfileId">>;
  };
};

type TeamAthleteResultPayload = {
  schemaVersion: 1;
  exerciseExecutionId: string;
  result: Omit<AthleteExerciseResult, "privateNote" | "attempts"> & {
    privateNote?: never;
    attempts: Array<Omit<ExerciseAttempt, "recordedByProfileId">>;
  };
};

function omitProperties<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy: Partial<T> = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

function withoutRecorder(segment: ExerciseRoleAssignmentSegment): Omit<ExerciseRoleAssignmentSegment, "recordedByProfileId"> {
  return omitProperties(segment, ["recordedByProfileId"]);
}

function attemptWithoutRecorder(attempt: ExerciseAttempt): Omit<ExerciseAttempt, "recordedByProfileId"> {
  return omitProperties(attempt, ["recordedByProfileId"]);
}

/**
 * Splits one strictly valid, completed C1 Team aggregate into C2a's immutable
 * coordination envelope and independently authorised athlete-owned bundles.
 * Recorder identity is deliberately omitted from both opaque payloads because the
 * server derives and stores it from the authenticated Profile.
 */
export function serializeCompletedTeamExercise(
  execution: ExerciseExecution,
  bundleIdFactory: BundleIdFactory = (result) => result.id
): TeamExerciseUploadPackage | null {
  const validation = validateExerciseExecution(execution, EXERCISE_CATALOG);
  if (!validation.valid || execution.status !== "completed" || !execution.completedAt || !execution.teamContext) {
    return null;
  }

  const teamContext = execution.teamContext;
  const executionWithoutOwnedResults = omitProperties(execution, ["athleteResults", "teamContext"]);
  const teamContextWithoutRecorder = omitProperties(teamContext, ["recorderProfileId"]);
  const coordination: TeamCoordinationPayload = {
    schemaVersion: TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION,
    execution: {
      ...executionWithoutOwnedResults,
      roleAssignmentSegments: execution.roleAssignmentSegments.map(withoutRecorder),
      teamContext: teamContextWithoutRecorder,
    },
  };

  const bundleIds = execution.athleteResults.map(bundleIdFactory);
  if (bundleIds.some((id) => !isCanonicalUuid(id)) || new Set(bundleIds).size !== bundleIds.length) return null;

  try {
    const coordinationPayload = JSON.stringify(coordination);
    if (!coordinationPayload) return null;
    const bundles = execution.athleteResults.map((result, index) => {
      const attempts = result.attempts;
      const resultWithoutPrivateNote = omitProperties(result, ["privateNote", "attempts"]);
      const payload: TeamAthleteResultPayload = {
        schemaVersion: TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION,
        exerciseExecutionId: execution.id,
        result: {
          ...resultWithoutPrivateNote,
          attempts: attempts.map(attemptWithoutRecorder),
        },
      };
      return {
        bundleId: bundleIds[index],
        sessionId: execution.trainingSessionId,
        athleteProfileId: result.athleteProfileId,
        schemaVersion: TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION,
        resultPayload: JSON.stringify(payload),
        recordedAt: result.updatedAt,
        resultIds: [result.id],
        executionIds: [execution.id],
      };
    });
    if (bundles.some((bundle) => !bundle.resultPayload)) return null;
    return {
      session: {
        sessionId: execution.trainingSessionId,
        teamId: teamContext.teamId,
        schemaVersion: TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION,
        coordinationPayload,
        startedAt: execution.startedAt,
        completedAt: execution.completedAt,
        participantProfileIds: teamContext.participantRoster.map((participant) => participant.profileId),
        trainingAthleteProfileIds: teamContext.participantRoster
          .filter((participant) => participant.participation === "training-athlete")
          .map((participant) => participant.profileId),
        executionIds: [execution.id],
      },
      bundles,
    };
  } catch {
    return null;
  }
}
