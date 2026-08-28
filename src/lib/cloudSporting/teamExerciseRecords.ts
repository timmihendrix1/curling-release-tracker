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
  TEAM_EXERCISE_RESULT_REVISION_SCHEMA_VERSION,
  SUPPORTED_TEAM_EXERCISE_CLOUD_PAYLOAD_SCHEMA_VERSIONS,
  type TeamExerciseResultChangedField,
  type TeamExerciseResultCorrectionMutation,
  type TeamExerciseResultRevisionCloudRecord,
  type TeamExerciseResultRevisionMutation,
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
  /** Immutable recorder-authored result before any post-completion athlete revision. */
  originalResult: AthleteExerciseResult;
  /** Latest valid result; retained for provenance even when the whole result is voided. */
  result: AthleteExerciseResult;
  activeAttemptCorrections: ExerciseActiveAttemptCorrection[];
  postCompletionRevisions: OwnedTeamExerciseResultRevision[];
  isVoided: boolean;
  privateNote: { note: string; updatedAt: string } | null;
  cloudCreatedAt: string;
};

export type OwnedTeamExerciseResultRevision = {
  revisionId: string;
  revisionNumber: number;
  kind: "corrected" | "voided";
  changedFields: TeamExerciseResultChangedField[] | ["result"];
  reason: string;
  actorProfileId: string;
  createdAt: string;
  resultingResult: AthleteExerciseResult | null;
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
  return leftKeys.length === rightKeys.length && leftKeys.every(
    (key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key])
  );
}

function sameChangedFields(
  actual: readonly string[],
  expected: ReadonlySet<TeamExerciseResultChangedField>
): boolean {
  return actual.length === expected.size && actual.every(
    (field) => expected.has(field as TeamExerciseResultChangedField)
  );
}

function replacementChangedFields(
  previous: AthleteExerciseResult,
  replacement: AthleteExerciseResult
): TeamExerciseResultChangedField[] | null {
  if (replacement.id !== previous.id || replacement.athleteProfileId !== previous.athleteProfileId ||
      replacement.createdAt !== previous.createdAt || replacement.privateNote !== undefined ||
      !validTimestamp(replacement.updatedAt) ||
      Date.parse(replacement.updatedAt) < Date.parse(previous.updatedAt) ||
      replacement.attempts.length !== previous.attempts.length) return null;
  const changed = new Set<TeamExerciseResultChangedField>();
  let changedAttempts = 0;
  for (let index = 0; index < previous.attempts.length; index += 1) {
    const before = previous.attempts[index];
    const after = replacement.attempts[index];
    if (!after || before.id !== after.id || before.kind !== after.kind ||
        before.athleteProfileId !== after.athleteProfileId ||
        before.roleAssignmentSegmentId !== after.roleAssignmentSegmentId ||
        before.sequenceNumber !== after.sequenceNumber || before.createdAt !== after.createdAt ||
        before.recordedByProfileId !== after.recordedByProfileId ||
        (before.kind === "shotmaking" && after.kind === "shotmaking" &&
          before.intendedHandle !== after.intendedHandle)) return null;
    const attemptFields = new Set<TeamExerciseResultChangedField>();
    if (!sameJsonValue(before.actualHandle, after.actualHandle)) attemptFields.add("actualHandle");
    if (before.kind === "shotmaking" && after.kind === "shotmaking" &&
        !sameJsonValue(before.evaluation, after.evaluation)) attemptFields.add("evaluation");
    if (!sameJsonValue(before.measurements, after.measurements)) attemptFields.add("measurements");
    if (before.kind === "shotmaking" && after.kind === "shotmaking" &&
        !sameJsonValue(before.teamRoleContextOverride, after.teamRoleContextOverride)) {
      attemptFields.add("teamRoleContextOverride");
    }
    if (attemptFields.size > 0) {
      changedAttempts += 1;
      attemptFields.forEach((field) => changed.add(field));
    }
  }
  return changedAttempts === 1 ? [...changed] : null;
}

function validateReplacementResult(
  previous: AthleteExerciseResult,
  replacement: AthleteExerciseResult,
  declaredFields: readonly string[]
): boolean {
  const changed = replacementChangedFields(previous, replacement);
  return changed !== null && sameChangedFields(declaredFields, new Set(changed));
}

function validatePostCompletionSequence(
  sharedExecution: Omit<ExerciseExecution, "athleteResults" | "activeAttemptCorrections">,
  originalResult: AthleteExerciseResult,
  activeAttemptCorrections: ExerciseActiveAttemptCorrection[],
  revisions: OwnedTeamExerciseResultRevision[],
  athleteProfileId: string
): { result: AthleteExerciseResult; isVoided: boolean } | null {
  let current = originalResult;
  let isVoided = false;
  let previousChangedAt = sharedExecution.completedAt;
  const revisionIds = new Set<string>();
  for (let index = 0; index < revisions.length; index += 1) {
    const revision = revisions[index];
    if (!isCanonicalUuid(revision.revisionId) || revisionIds.has(revision.revisionId) ||
        revision.revisionNumber !== index + 1 ||
        revision.actorProfileId !== athleteProfileId || !validTimestamp(revision.createdAt) ||
        revision.reason !== revision.reason.trim() || revision.reason.length < 10 ||
        revision.reason.length > 500 || byteLength(revision.reason) > 2_000 ||
        (previousChangedAt && Date.parse(revision.createdAt) < Date.parse(previousChangedAt)) ||
        isVoided) return null;
    revisionIds.add(revision.revisionId);
    previousChangedAt = revision.createdAt;
    if (revision.kind === "voided") {
      if (revision.resultingResult !== null || revision.changedFields.length !== 1 ||
          revision.changedFields[0] !== "result" || index !== revisions.length - 1) return null;
      isVoided = true;
      continue;
    }
    if (revision.kind !== "corrected" || !revision.resultingResult ||
        !hasStrictOwnedPayloadShape(
          sharedExecution as unknown as Record<string, unknown>,
          revision.resultingResult as unknown as Record<string, unknown>,
          true
        ) ||
        !validateReplacementResult(current, revision.resultingResult, revision.changedFields)) return null;
    const candidate = {
      ...sharedExecution,
      athleteResults: [revision.resultingResult],
      ...((sharedExecution as Record<string, unknown>).schemaVersion === 2
        ? { activeAttemptCorrections }
        : {}),
    };
    const validation = validateExerciseExecution(candidate, EXERCISE_CATALOG, {
      ownedTeamResultProfileId: athleteProfileId,
    });
    if (!validation.valid) return null;
    current = validation.value.athleteResults[0];
  }
  return { result: current, isVoided };
}

async function decodePostCompletionRevisions(
  records: TeamExerciseResultRevisionCloudRecord[],
  resultId: string,
  athleteProfileId: string,
  recordedByProfileId: string
): Promise<OwnedTeamExerciseResultRevision[] | null> {
  const revisions: OwnedTeamExerciseResultRevision[] = [];
  const ids = new Set<string>();
  for (const record of records) {
    if (!isCanonicalUuid(record.revisionId) || ids.has(record.revisionId) ||
        record.resultId !== resultId || record.athleteProfileId !== athleteProfileId ||
        record.actorProfileId !== athleteProfileId || !Number.isInteger(record.revisionNumber) ||
        record.revisionNumber < 1 || record.schemaVersion !== TEAM_EXERCISE_RESULT_REVISION_SCHEMA_VERSION ||
        !validTimestamp(record.createdAt) || record.reason !== record.reason.trim() ||
        record.reason.length < 10 || record.reason.length > 500 || byteLength(record.reason) > 2_000 ||
        !Array.isArray(record.changedFields) || record.changedFields.length === 0 ||
        new Set(record.changedFields).size !== record.changedFields.length) return null;
    ids.add(record.revisionId);
    if (record.kind === "voided") {
      if (record.resultPayload !== null || record.contentSha256 !== null ||
          record.changedFields.length !== 1 || record.changedFields[0] !== "result") return null;
      revisions.push({
        revisionId: record.revisionId,
        revisionNumber: record.revisionNumber,
        kind: "voided",
        changedFields: ["result"],
        reason: record.reason,
        actorProfileId: record.actorProfileId,
        createdAt: record.createdAt,
        resultingResult: null,
      });
      continue;
    }
    if (record.kind !== "corrected" || typeof record.resultPayload !== "string" ||
        record.resultPayload.length === 0 || byteLength(record.resultPayload) > 8_388_608 ||
        typeof record.contentSha256 !== "string" ||
        await sha256Hex(record.resultPayload) !== record.contentSha256 ||
        !record.changedFields.every((field) => field !== "result")) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(record.resultPayload);
    } catch {
      return null;
    }
    if (!isRecord(payload) || !hasOnlyKeys(payload, ["schemaVersion", "result"]) ||
        payload.schemaVersion !== TEAM_EXERCISE_RESULT_REVISION_SCHEMA_VERSION ||
        !isRecord(payload.result) || !hasOnlyKeys(payload.result, [
          "id", "athleteProfileId", "attempts", "createdAt",
        ]) || !Array.isArray(payload.result.attempts) ||
        !payload.result.attempts.every((attempt) => strictAttempt(attempt, false)) ||
        payload.result.attempts.some((attempt) =>
          isRecord(attempt) && "recordedByProfileId" in attempt
        )) return null;
    const result = {
      ...payload.result,
      updatedAt: record.createdAt,
      attempts: payload.result.attempts.map((attempt) => ({
        ...(attempt as Record<string, unknown>),
        recordedByProfileId,
      })),
    } as AthleteExerciseResult;
    revisions.push({
      revisionId: record.revisionId,
      revisionNumber: record.revisionNumber,
      kind: "corrected",
      changedFields: [...record.changedFields] as TeamExerciseResultChangedField[],
      reason: record.reason,
      actorProfileId: record.actorProfileId,
      createdAt: record.createdAt,
      resultingResult: result,
    });
  }
  return revisions;
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
    !Array.isArray(record.revisions) ||
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
  const activeAttemptCorrections = execution.activeAttemptCorrections ?? [];
  const postCompletionRevisions = await decodePostCompletionRevisions(
    record.revisions,
    result.id,
    authenticatedProfileId,
    record.bundle.recordedByProfileId
  );
  if (!postCompletionRevisions) return null;
  const current = validatePostCompletionSequence(
    sharedExecution,
    result,
    activeAttemptCorrections,
    postCompletionRevisions,
    authenticatedProfileId
  );
  if (!current) return null;
  return {
    bundleId: record.bundle.bundleId,
    sessionId: record.session.sessionId,
    teamId: record.session.teamId,
    athleteProfileId: authenticatedProfileId,
    recordedByProfileId: record.session.recordedByProfileId,
    sharedExecution,
    originalResult: result,
    result: current.result,
    activeAttemptCorrections,
    postCompletionRevisions,
    isVoided: current.isVoided,
    privateNote: record.privateNote
      ? { note: record.privateNote.note, updatedAt: record.privateNote.updatedAt }
      : null,
    cloudCreatedAt: record.bundle.createdAt,
  };
}

function parseCachedPostCompletionRevision(value: unknown): OwnedTeamExerciseResultRevision | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "revisionId", "revisionNumber", "kind", "changedFields", "reason",
    "actorProfileId", "createdAt", "resultingResult",
  ]) || !isCanonicalUuid(value.revisionId) || !Number.isInteger(value.revisionNumber) ||
      (value.revisionNumber as number) < 1 ||
      (value.kind !== "corrected" && value.kind !== "voided") ||
      !Array.isArray(value.changedFields) || value.changedFields.length === 0 ||
      new Set(value.changedFields).size !== value.changedFields.length ||
      typeof value.reason !== "string" || value.reason !== value.reason.trim() ||
      value.reason.length < 10 || value.reason.length > 500 || byteLength(value.reason) > 2_000 ||
      !isCanonicalUuid(value.actorProfileId) || !validTimestamp(value.createdAt)) return null;
  if (value.kind === "voided") {
    if (value.resultingResult !== null || value.changedFields.length !== 1 ||
        value.changedFields[0] !== "result") return null;
    return {
      revisionId: value.revisionId,
      revisionNumber: value.revisionNumber as number,
      kind: "voided",
      changedFields: ["result"],
      reason: value.reason,
      actorProfileId: value.actorProfileId,
      createdAt: value.createdAt,
      resultingResult: null,
    };
  }
  if (!isRecord(value.resultingResult) || !value.changedFields.every((field) =>
    field === "actualHandle" || field === "evaluation" || field === "measurements" ||
      field === "teamRoleContextOverride"
  )) return null;
  return {
    revisionId: value.revisionId,
    revisionNumber: value.revisionNumber as number,
    kind: "corrected",
    changedFields: [...value.changedFields] as TeamExerciseResultChangedField[],
    reason: value.reason,
    actorProfileId: value.actorProfileId,
    createdAt: value.createdAt,
    resultingResult: value.resultingResult as AthleteExerciseResult,
  };
}

/** Strict boundary for the Profile-scoped, already-decoded read cache. */
export function validateOwnedTeamExerciseResultRecord(
  value: unknown
): OwnedTeamExerciseResultRecord | null {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "bundleId", "sessionId", "teamId", "athleteProfileId", "recordedByProfileId",
    "sharedExecution", "originalResult", "result", "activeAttemptCorrections",
    "postCompletionRevisions", "isVoided", "privateNote", "cloudCreatedAt",
  ]) || !isCanonicalUuid(value.bundleId) || !isCanonicalUuid(value.sessionId) ||
      !isCanonicalUuid(value.teamId) || !isCanonicalUuid(value.athleteProfileId) ||
      !isCanonicalUuid(value.recordedByProfileId) || !validTimestamp(value.cloudCreatedAt) ||
      !isRecord(value.sharedExecution) || "athleteResults" in value.sharedExecution ||
      "activeAttemptCorrections" in value.sharedExecution ||
      ((value.sharedExecution as Record<string, unknown>).schemaVersion === 2 && value.activeAttemptCorrections === undefined) ||
      !isRecord(value.originalResult) || !isRecord(value.result) ||
      !Array.isArray(value.postCompletionRevisions) || typeof value.isVoided !== "boolean" ||
      (value.activeAttemptCorrections !== undefined && (
        !Array.isArray(value.activeAttemptCorrections) ||
        !value.activeAttemptCorrections.every((correction) => strictCorrection(correction, true))
      ))) return null;
  if (!hasStrictOwnedPayloadShape(value.sharedExecution, value.originalResult, true) ||
      !hasStrictOwnedPayloadShape(value.sharedExecution, value.result, true)) return null;
  if (value.privateNote !== null && (
    !isRecord(value.privateNote) ||
    !hasOnlyKeys(value.privateNote, ["note", "updatedAt"]) ||
    typeof value.privateNote.note !== "string" ||
    value.privateNote.note.trim().length === 0 ||
    byteLength(value.privateNote.note) > 65_536 ||
    !validTimestamp(value.privateNote.updatedAt)
  )) return null;
  const activeAttemptCorrections = (value.activeAttemptCorrections ?? []) as ExerciseActiveAttemptCorrection[];
  const postCompletionRevisions: OwnedTeamExerciseResultRevision[] = [];
  for (const candidate of value.postCompletionRevisions) {
    const parsed = parseCachedPostCompletionRevision(candidate);
    if (!parsed) return null;
    postCompletionRevisions.push(parsed);
  }
  const candidate = {
    ...value.sharedExecution,
    athleteResults: [value.originalResult],
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
    execution.athleteResults[0]?.id !== value.originalResult.id ||
    execution.athleteResults[0]?.athleteProfileId !== value.athleteProfileId
  ) return null;
  const current = validatePostCompletionSequence(
    value.sharedExecution as OwnedTeamExerciseResultRecord["sharedExecution"],
    execution.athleteResults[0],
    activeAttemptCorrections,
    postCompletionRevisions,
    value.athleteProfileId
  );
  if (!current || current.isVoided !== value.isVoided ||
      !sameJsonValue(current.result, value.result)) return null;
  return {
    ...value,
    originalResult: execution.athleteResults[0],
    result: current.result,
    activeAttemptCorrections,
    postCompletionRevisions,
    isVoided: current.isVoided,
  } as OwnedTeamExerciseResultRecord;
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

function normalizedRevisionReason(reason: string): string | null {
  const normalized = reason.trim();
  return normalized.length >= 10 && normalized.length <= 500 && byteLength(normalized) <= 2_000
    ? normalized
    : null;
}

/**
 * Builds C4b's only supported correction wire shape from an already verified owned
 * projection. Athlete identity, capture provenance and server update time cannot be
 * supplied by the mutation caller.
 */
export function createTeamExerciseResultCorrectionMutation(
  record: OwnedTeamExerciseResultRecord,
  replacement: AthleteExerciseResult,
  revisionId: string,
  reason: string
): TeamExerciseResultCorrectionMutation | null {
  const normalizedReason = normalizedRevisionReason(reason);
  if (record.isVoided || !isCanonicalUuid(revisionId) || !normalizedReason ||
      validateOwnedTeamExerciseResultRecord(record) === null ||
      !hasStrictOwnedPayloadShape(
        record.sharedExecution as unknown as Record<string, unknown>,
        replacement as unknown as Record<string, unknown>,
        true
      )) return null;
  const candidate = {
    ...record.sharedExecution,
    athleteResults: [replacement],
    ...((record.sharedExecution as unknown as Record<string, unknown>).schemaVersion === 2
      ? { activeAttemptCorrections: record.activeAttemptCorrections }
      : {}),
  };
  const validation = validateExerciseExecution(candidate, EXERCISE_CATALOG, {
    ownedTeamResultProfileId: record.athleteProfileId,
  });
  if (!validation.valid) return null;
  const validatedReplacement = validation.value.athleteResults[0];
  const changedFields = replacementChangedFields(record.result, validatedReplacement);
  if (!changedFields) return null;
  const resultWithoutTransportClaims = omitProperties(validatedReplacement, [
    "privateNote", "updatedAt",
  ]);
  const resultPayload = JSON.stringify({
    schemaVersion: TEAM_EXERCISE_RESULT_REVISION_SCHEMA_VERSION,
    result: {
      ...resultWithoutTransportClaims,
      attempts: validatedReplacement.attempts.map(attemptWithoutRecorder),
    },
  });
  return {
    revisionId,
    resultId: record.result.id,
    baseRevisionNumber: record.postCompletionRevisions.length,
    schemaVersion: TEAM_EXERCISE_RESULT_REVISION_SCHEMA_VERSION,
    resultPayload,
    reason: normalizedReason,
    changedFields,
  };
}

export function createTeamExerciseResultVoidMutation(
  record: OwnedTeamExerciseResultRecord,
  revisionId: string,
  reason: string
): TeamExerciseResultRevisionMutation | null {
  const normalizedReason = normalizedRevisionReason(reason);
  if (record.isVoided || !isCanonicalUuid(revisionId) || !normalizedReason ||
      validateOwnedTeamExerciseResultRecord(record) === null) return null;
  return {
    revisionId,
    resultId: record.result.id,
    baseRevisionNumber: record.postCompletionRevisions.length,
    reason: normalizedReason,
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
