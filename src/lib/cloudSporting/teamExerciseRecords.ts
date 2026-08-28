import { EXERCISE_CATALOG } from "../exercises/catalog";
import type {
  AthleteExerciseResult,
  ExerciseActiveAttemptCorrection,
  ExerciseAttempt,
  ExerciseExecution,
  ExerciseRoleAssignmentSegment,
} from "../exercises/executionTypes";
import { validateExerciseExecution } from "../exercises/executionValidation";
import { isCanonicalUuid } from "../uuid";
import {
  TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION,
  SUPPORTED_TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSIONS,
  type TeamExerciseCloudReadRecord,
  type TeamExerciseUploadPackage,
} from "./teamExerciseTypes";
import { sha256Hex } from "./records";

type BundleIdFactory = (result: AthleteExerciseResult) => string;

type TeamCoordinationPayload = {
  schemaVersion: 1 | 2;
  execution: Omit<ExerciseExecution, "athleteResults" | "teamContext" | "activeAttemptCorrections"> & {
    athleteResults?: never;
    activeAttemptCorrections?: never;
    teamContext: Omit<NonNullable<ExerciseExecution["teamContext"]>, "recorderProfileId">;
    roleAssignmentSegments: Array<Omit<ExerciseRoleAssignmentSegment, "recordedByProfileId">>;
  };
};

type TeamAthleteResultPayload = {
  schemaVersion: 1 | 2;
  exerciseExecutionId: string;
  result: Omit<AthleteExerciseResult, "privateNote" | "attempts"> & {
    privateNote?: never;
    attempts: Array<Omit<ExerciseAttempt, "recordedByProfileId">>;
  };
  activeAttemptCorrections?: Array<Omit<ExerciseActiveAttemptCorrection, "correctedByProfileId">>;
};

export type OwnedTeamExerciseResultRecord = {
  bundleId: string;
  sessionId: string;
  teamId: string;
  athleteProfileId: string;
  recordedByProfileId: string;
  sharedExecution: Omit<ExerciseExecution, "athleteResults" | "activeAttemptCorrections">;
  result: AthleteExerciseResult;
  activeAttemptCorrections: ExerciseActiveAttemptCorrection[];
  privateNote: { note: string; updatedAt: string } | null;
  cloudCreatedAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length &&
    right.every((value) => left.includes(value));
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function strictMeasurement(value: unknown): boolean {
  return isRecord(value) && hasOnlyKeys(value, [
    "id", "protocolId", "protocolVersion", "value", "source", "recordedAt",
    "observerProfileId", "timingResultId", "deviceId", "laneId",
  ]);
}

function strictAttempt(value: unknown, includesRecorder: boolean): boolean {
  if (!isRecord(value)) return false;
  const base = [
    "id", "athleteProfileId", "roleAssignmentSegmentId", "sequenceNumber",
    "createdAt", "kind", "intendedHandle", "actualHandle", "evaluation",
    "measurements", "teamRoleContextOverride",
  ];
  if (includesRecorder) base.push("recordedByProfileId");
  if (value.kind === "measurement") {
    if (!hasOnlyKeys(value, base.filter((key) => key !== "intendedHandle" && key !== "evaluation"))) return false;
  } else if (value.kind === "shotmaking") {
    if (!hasOnlyKeys(value, base) || !isRecord(value.evaluation)) return false;
    if (value.evaluation.status === "scored") {
      if (!hasOnlyKeys(value.evaluation, ["status", "score"])) return false;
    } else if (value.evaluation.status === "excluded") {
      if (!hasOnlyKeys(value.evaluation, ["status", "reason", "explanation"])) return false;
    } else return false;
  } else return false;
  if (value.teamRoleContextOverride !== undefined && (
    !isRecord(value.teamRoleContextOverride) ||
    !hasOnlyKeys(value.teamRoleContextOverride, [
      "deliveringAthleteProfileId", "sweeperProfileIds", "skipProfileId",
      "observerProfileId", "coachProfileIds", "timekeeperProfileId", "sweepingUsed",
    ])
  )) return false;
  return Array.isArray(value.measurements) && value.measurements.every(strictMeasurement);
}

function strictCorrection(value: unknown, includesRecorder: boolean): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "id", "kind", "attemptId", "correctedAt", "before", "after",
    ...(includesRecorder ? ["correctedByProfileId"] : []),
  ]) || (value.kind !== "updated" && value.kind !== "annulled") ||
      !strictAttempt(value.before, includesRecorder)) return false;
  return value.kind === "updated"
    ? strictAttempt(value.after, includesRecorder)
    : value.after === undefined;
}

/**
 * The server intentionally stores lossless opaque JSON. Keep unknown nested fields
 * from becoming a covert sibling-data channel into the Profile cache or raw export.
 */
function hasStrictOwnedPayloadShape(
  shared: Record<string, unknown>,
  result: Record<string, unknown>,
  includesRecorder = false
): boolean {
  if (!hasOnlyKeys(shared, [
    "id", "trainingSessionId", "exerciseVersionSnapshot", "evaluationBasis",
    "configuration", "status", "startedAt", "completedAt", "abandonedAt",
    "roleAssignmentSegments", "teamContext", "schemaVersion", "activeAttemptCorrections",
  ]) || !isRecord(shared.configuration) || !hasOnlyKeys(shared.configuration, [
    "selectedVariationId", "plannedVolume", "sweeperCount", "sweepingUsed",
    "enabledMeasurementProtocols", "deviations",
  ]) || !Array.isArray(shared.configuration.deviations) ||
      shared.configuration.deviations.some((deviation) =>
        !isRecord(deviation) || !hasOnlyKeys(deviation, ["kind", "description"])
      ) || (shared.configuration.plannedVolume !== undefined && (
        !isRecord(shared.configuration.plannedVolume) ||
        !hasOnlyKeys(shared.configuration.plannedVolume, ["kind", "value"])
      )) || !isRecord(shared.teamContext) || !hasOnlyKeys(shared.teamContext, [
        "kind", "teamId", "participantRoster", "rotation",
        ...(includesRecorder ? ["recorderProfileId"] : []),
      ]) || !Array.isArray(shared.teamContext.participantRoster) ||
      shared.teamContext.participantRoster.some((participant) =>
        !isRecord(participant) || !hasOnlyKeys(participant, ["profileId", "participation"])
      ) || !isRecord(shared.teamContext.rotation) ||
      !hasOnlyKeys(shared.teamContext.rotation, ["kind", "athleteOrder", "stoneCount"]) ||
      !Array.isArray(shared.roleAssignmentSegments) ||
      shared.roleAssignmentSegments.some((segment) =>
        !isRecord(segment) || !hasOnlyKeys(segment, [
          "id", "startedAt", "deliveringAthleteProfileId", "sweeperProfileIds",
          "skipProfileId", "observerProfileId", "coachProfileIds",
          "timekeeperProfileId", "sweepingUsed", "transitionReason",
          ...(includesRecorder ? ["recordedByProfileId"] : []),
        ])
      ) || (shared.activeAttemptCorrections !== undefined && (
        !Array.isArray(shared.activeAttemptCorrections) ||
        !shared.activeAttemptCorrections.every((correction) => strictCorrection(correction, includesRecorder))
      ))) return false;

  return hasOnlyKeys(result, [
    "id", "athleteProfileId", "attempts", "createdAt", "updatedAt",
  ]) && Array.isArray(result.attempts) &&
    result.attempts.every((attempt) => strictAttempt(attempt, includesRecorder));
}

/**
 * Rebuilds the athlete-owned projection from relational manifests plus the
 * two opaque payloads. Payload identity, recorder provenance and hashes are
 * all independently checked before anything becomes local read state.
 */
export async function deserializeOwnedTeamExerciseResult(
  record: TeamExerciseCloudReadRecord,
  authenticatedProfileId: string
): Promise<OwnedTeamExerciseResultRecord | null> {
  if (
    !isCanonicalUuid(authenticatedProfileId) ||
    !isCanonicalUuid(record.session.sessionId) ||
    !isCanonicalUuid(record.session.teamId) ||
    !isCanonicalUuid(record.session.recordedByProfileId) ||
    !isCanonicalUuid(record.bundle.bundleId) ||
    record.bundle.athleteProfileId !== authenticatedProfileId ||
    record.bundle.sessionId !== record.session.sessionId ||
    record.bundle.recordedByProfileId !== record.session.recordedByProfileId ||
    !SUPPORTED_TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSIONS.includes(record.bundle.schemaVersion as 1 | 2) ||
    record.session.schemaVersion !== record.bundle.schemaVersion ||
    !validTimestamp(record.session.createdAt) ||
    !validTimestamp(record.bundle.createdAt) ||
    await sha256Hex(record.session.coordinationPayload) !== record.session.contentSha256 ||
    await sha256Hex(record.bundle.resultPayload) !== record.bundle.contentSha256
  ) return null;

  let coordinationValue: unknown;
  let resultValue: unknown;
  try {
    coordinationValue = JSON.parse(record.session.coordinationPayload);
    resultValue = JSON.parse(record.bundle.resultPayload);
  } catch {
    return null;
  }
  if (
    !isRecord(coordinationValue) ||
    !hasOnlyKeys(coordinationValue, ["schemaVersion", "execution"]) ||
    coordinationValue.schemaVersion !== record.session.schemaVersion ||
    !isRecord(coordinationValue.execution) ||
    "athleteResults" in coordinationValue.execution ||
    "activeAttemptCorrections" in coordinationValue.execution ||
    !isRecord(resultValue) ||
    !hasOnlyKeys(resultValue, record.bundle.schemaVersion === 1
      ? ["schemaVersion", "exerciseExecutionId", "result"]
      : ["schemaVersion", "exerciseExecutionId", "result", "activeAttemptCorrections"]) ||
    resultValue.schemaVersion !== record.bundle.schemaVersion ||
    !isRecord(resultValue.result) ||
    (record.bundle.schemaVersion === 2 && (
      !Array.isArray(resultValue.activeAttemptCorrections) ||
      !resultValue.activeAttemptCorrections.every((correction) => strictCorrection(correction, false))
    )) ||
    !hasStrictOwnedPayloadShape(coordinationValue.execution, resultValue.result)
  ) return null;

  const shared = coordinationValue.execution;
  if (
    !isRecord(shared.teamContext) ||
    "recorderProfileId" in shared.teamContext ||
    !Array.isArray(shared.roleAssignmentSegments) ||
    shared.roleAssignmentSegments.some(
      (segment) => !isRecord(segment) || "recordedByProfileId" in segment
    ) ||
    !Array.isArray(resultValue.result.attempts) ||
    resultValue.result.attempts.some(
      (attempt) => !isRecord(attempt) || "recordedByProfileId" in attempt
    ) ||
    "privateNote" in resultValue.result
  ) return null;

  const reconstructed: unknown = {
    ...shared,
    teamContext: {
      ...shared.teamContext,
      recorderProfileId: record.session.recordedByProfileId,
    },
    roleAssignmentSegments: shared.roleAssignmentSegments.map((segment) => ({
      ...segment,
      recordedByProfileId: record.session.recordedByProfileId,
    })),
    athleteResults: [{
      ...resultValue.result,
      attempts: resultValue.result.attempts.map((attempt) => ({
        ...attempt,
        recordedByProfileId: record.bundle.recordedByProfileId,
      })),
    }],
    ...(record.bundle.schemaVersion === 2
      ? {
          activeAttemptCorrections: (resultValue.activeAttemptCorrections as Array<Record<string, unknown>>)
            .map((correction) => ({
              ...correction,
              correctedByProfileId: record.session.recordedByProfileId,
              before: {
                ...(correction.before as Record<string, unknown>),
                recordedByProfileId: record.session.recordedByProfileId,
              },
              ...(correction.after
                ? {
                    after: {
                      ...(correction.after as Record<string, unknown>),
                      recordedByProfileId: record.session.recordedByProfileId,
                    },
                  }
                : {}),
            })),
        }
      : {}),
  };
  const validation = validateExerciseExecution(reconstructed, EXERCISE_CATALOG, {
    ownedTeamResultProfileId: authenticatedProfileId,
  });
  if (!validation.valid) return null;
  const execution = validation.value;
  const result = execution.athleteResults[0];
  const context = execution.teamContext;
  if (
    !result ||
    !context ||
    execution.status !== "completed" ||
    execution.trainingSessionId !== record.session.sessionId ||
    execution.id !== resultValue.exerciseExecutionId ||
    context.teamId !== record.session.teamId ||
    execution.startedAt !== record.session.startedAt ||
    execution.completedAt !== record.session.completedAt ||
    result.athleteProfileId !== record.bundle.athleteProfileId ||
    result.updatedAt !== record.bundle.recordedAt ||
    !sameSet(record.session.executionIds, [execution.id]) ||
    !sameSet(record.bundle.executionIds, [execution.id]) ||
    !sameSet(record.bundle.resultIds, [result.id]) ||
    !sameSet(
      record.session.participantProfileIds,
      context.participantRoster.map((participant) => participant.profileId)
    ) ||
    !sameSet(
      record.session.trainingAthleteProfileIds,
      context.participantRoster
        .filter((participant) => participant.participation === "training-athlete")
        .map((participant) => participant.profileId)
    )
  ) return null;

  if (record.privateNote && (
    record.privateNote.resultId !== result.id ||
    record.privateNote.note.trim().length === 0 ||
    byteLength(record.privateNote.note) > 65_536 ||
    !validTimestamp(record.privateNote.updatedAt)
  )) return null;

  const sharedExecution = omitProperties(execution, ["athleteResults", "activeAttemptCorrections"]);
  return {
    bundleId: record.bundle.bundleId,
    sessionId: record.session.sessionId,
    teamId: record.session.teamId,
    athleteProfileId: authenticatedProfileId,
    recordedByProfileId: record.session.recordedByProfileId,
    sharedExecution,
    result,
    activeAttemptCorrections: execution.activeAttemptCorrections ?? [],
    privateNote: record.privateNote
      ? { note: record.privateNote.note, updatedAt: record.privateNote.updatedAt }
      : null,
    cloudCreatedAt: record.bundle.createdAt,
  };
}

/** Strict boundary for the Profile-scoped, already-decoded read cache. */
export function validateOwnedTeamExerciseResultRecord(
  value: unknown
): OwnedTeamExerciseResultRecord | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "bundleId", "sessionId", "teamId", "athleteProfileId", "recordedByProfileId",
    "sharedExecution", "result", "activeAttemptCorrections", "privateNote", "cloudCreatedAt",
  ]) || !isCanonicalUuid(value.bundleId) || !isCanonicalUuid(value.sessionId) ||
      !isCanonicalUuid(value.teamId) || !isCanonicalUuid(value.athleteProfileId) ||
      !isCanonicalUuid(value.recordedByProfileId) || !validTimestamp(value.cloudCreatedAt) ||
      !isRecord(value.sharedExecution) || "athleteResults" in value.sharedExecution ||
      "activeAttemptCorrections" in value.sharedExecution ||
      ((value.sharedExecution as Record<string, unknown>).schemaVersion === 2 && value.activeAttemptCorrections === undefined) ||
      !isRecord(value.result) || (value.activeAttemptCorrections !== undefined && (
        !Array.isArray(value.activeAttemptCorrections) ||
        !value.activeAttemptCorrections.every((correction) => strictCorrection(correction, true))
      ))) return null;
  if (!hasStrictOwnedPayloadShape(value.sharedExecution, value.result, true)) return null;
  if (value.privateNote !== null && (
    !isRecord(value.privateNote) ||
    !hasOnlyKeys(value.privateNote, ["note", "updatedAt"]) ||
    typeof value.privateNote.note !== "string" ||
    value.privateNote.note.trim().length === 0 ||
    byteLength(value.privateNote.note) > 65_536 ||
    !validTimestamp(value.privateNote.updatedAt)
  )) return null;
  const activeAttemptCorrections = (value.activeAttemptCorrections ?? []) as ExerciseActiveAttemptCorrection[];
  const candidate = {
    ...value.sharedExecution,
    athleteResults: [value.result],
    ...((value.sharedExecution as Record<string, unknown>).schemaVersion === 2
      ? { activeAttemptCorrections }
      : {}),
  };
  const validation = validateExerciseExecution(candidate, EXERCISE_CATALOG, {
    ownedTeamResultProfileId: value.athleteProfileId,
  });
  if (!validation.valid) return null;
  const execution = validation.value;
  if (
    execution.trainingSessionId !== value.sessionId ||
    execution.teamContext?.teamId !== value.teamId ||
    execution.teamContext.recorderProfileId !== value.recordedByProfileId ||
    execution.athleteResults[0]?.id !== value.result.id ||
    execution.athleteResults[0]?.athleteProfileId !== value.athleteProfileId
  ) return null;
  return { ...value, activeAttemptCorrections } as OwnedTeamExerciseResultRecord;
}

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

function correctionWithoutRecorder(
  correction: ExerciseActiveAttemptCorrection
): Omit<ExerciseActiveAttemptCorrection, "correctedByProfileId"> {
  const withoutActor = omitProperties(correction, ["correctedByProfileId"]);
  return {
    ...withoutActor,
    before: attemptWithoutRecorder(correction.before) as typeof correction.before,
    ...(correction.after
      ? { after: attemptWithoutRecorder(correction.after) as typeof correction.after }
      : {}),
  };
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
  const payloadSchemaVersion = execution.schemaVersion === 1
    ? 1
    : TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSION;
  const executionWithoutOwnedResults = omitProperties(execution, [
    "athleteResults", "teamContext", "activeAttemptCorrections",
  ]);
  const teamContextWithoutRecorder = omitProperties(teamContext, ["recorderProfileId"]);
  const coordination: TeamCoordinationPayload = {
    schemaVersion: payloadSchemaVersion,
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
        schemaVersion: payloadSchemaVersion,
        exerciseExecutionId: execution.id,
        result: {
          ...resultWithoutPrivateNote,
          attempts: attempts.map(attemptWithoutRecorder),
        },
        ...(payloadSchemaVersion === 2
          ? {
              activeAttemptCorrections: (execution.activeAttemptCorrections ?? [])
                .filter((correction) =>
                  correction.before.athleteProfileId === result.athleteProfileId ||
                  correction.after?.athleteProfileId === result.athleteProfileId
                )
                .map(correctionWithoutRecorder),
            }
          : {}),
      };
      return {
        bundleId: bundleIds[index],
        sessionId: execution.trainingSessionId,
        athleteProfileId: result.athleteProfileId,
        schemaVersion: payloadSchemaVersion,
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
        schemaVersion: payloadSchemaVersion,
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
