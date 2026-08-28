import type { Handle, TimingProviderType } from "../../types";
import { isCanonicalUuid } from "../uuid";
import { findExerciseVersion } from "./lookup";
import type {
  ExerciseAttempt,
  ExerciseExecution,
  ExerciseMeasurement,
  ShotmakingEvaluation,
} from "./executionTypes";
import { EXERCISE_EXECUTION_SCHEMA_VERSION } from "./executionTypes";
import type { ExerciseCatalogPackage, ExerciseVersion, MeasurementProtocol } from "./types";

export type ExerciseExecutionValidationIssue = { path: string; message: string };

export type ExerciseExecutionValidationResult =
  | { valid: true; value: ExerciseExecution; issues: [] }
  | { valid: false; issues: ExerciseExecutionValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
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
    leftKeys.every((key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key]));
}

function protocolKey(protocol: { id: string; version: number }): string {
  return `${protocol.id}@${protocol.version}`;
}

const HANDLES: readonly Handle[] = ["in", "out"];
const SOURCES: readonly TimingProviderType[] = ["manual", "simulator", "external"];
const EXCLUSION_REASONS = [
  "external-interruption",
  "incorrect-or-displaced-setup",
  "technical-or-capture-problem",
  "outcome-not-observable",
  "other",
] as const;
const DEVIATION_KINDS = [
  "sweeper-count",
  "sweeping-use",
  "role-assignment",
  "required-measurement",
  "other",
] as const;
const ROTATION_KINDS = [
  "fixed",
  "after-every-stone",
  "after-stone-count",
  "after-series",
  "manual",
] as const;
const ROLE_TRANSITION_REASONS = [
  "initial",
  "manual",
  "after-every-stone",
  "after-stone-count",
  "after-series",
] as const;

function expectedEvaluationBasis(version: ExerciseVersion): ExerciseExecution["evaluationBasis"] {
  return version.primaryFocus === "shotmaking" && version.guidance.kind === "generic-shotmaking-score"
    ? version.guidance.evaluationBasis
    : "not-applicable";
}

export function validateExerciseExecution(
  value: unknown,
  catalog: ExerciseCatalogPackage
): ExerciseExecutionValidationResult {
  const issues: ExerciseExecutionValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });
  if (!isRecord(value)) {
    return { valid: false, issues: [{ path: "$", message: "Exercise Execution must be an object." }] };
  }

  const entityIds = new Set<string>();
  const registerEntityId = (candidate: unknown, path: string, label: string): candidate is string => {
    if (!isCanonicalUuid(candidate) || entityIds.has(candidate)) {
      add(path, `${label} must be a globally unique canonical UUID within the execution.`);
      return false;
    }
    entityIds.add(candidate);
    return true;
  };

  if (value.schemaVersion !== EXERCISE_EXECUTION_SCHEMA_VERSION) {
    add("schemaVersion", "Unsupported Exercise Execution schema version.");
  }
  registerEntityId(value.id, "id", "Execution id");
  if (!isCanonicalUuid(value.trainingSessionId)) add("trainingSessionId", "Training Session id must be a canonical UUID.");
  if (!validTimestamp(value.startedAt)) add("startedAt", "Start time must be a valid timestamp.");
  if (value.status !== "in-progress" && value.status !== "completed" && value.status !== "abandoned") {
    add("status", "Execution status is invalid.");
  }
  if (value.status === "in-progress" && (value.completedAt !== undefined || value.abandonedAt !== undefined)) {
    add("status", "An in-progress execution cannot carry a terminal timestamp.");
  }
  if (value.status === "completed" && (!validTimestamp(value.completedAt) || value.abandonedAt !== undefined)) {
    add("completedAt", "A completed execution needs only a valid completion timestamp.");
  }
  if (value.status === "abandoned" && (!validTimestamp(value.abandonedAt) || value.completedAt !== undefined)) {
    add("abandonedAt", "An abandoned execution needs only a valid abandonment timestamp.");
  }
  if (validTimestamp(value.startedAt) && value.status === "completed" && validTimestamp(value.completedAt) &&
      Date.parse(value.completedAt) < Date.parse(value.startedAt)) {
    add("completedAt", "Completion cannot predate the execution start.");
  }
  if (validTimestamp(value.startedAt) && value.status === "abandoned" && validTimestamp(value.abandonedAt) &&
      Date.parse(value.abandonedAt) < Date.parse(value.startedAt)) {
    add("abandonedAt", "Abandonment cannot predate the execution start.");
  }

  let version: ExerciseVersion | undefined;
  if (!isRecord(value.exerciseVersionSnapshot) || typeof value.exerciseVersionSnapshot.id !== "string") {
    add("exerciseVersionSnapshot", "An immutable Exercise Version snapshot is required.");
  } else {
    version = findExerciseVersion(catalog, value.exerciseVersionSnapshot.id);
    if (!version || !sameJsonValue(value.exerciseVersionSnapshot, version)) {
      add("exerciseVersionSnapshot", "The Exercise Version snapshot is unknown or differs from its immutable catalog version.");
      version = undefined;
    }
  }
  if (version && value.evaluationBasis !== expectedEvaluationBasis(version)) {
    add("evaluationBasis", "Evaluation basis does not match the snapshotted Exercise guidance.");
  }

  const isTeam = value.teamContext !== undefined;
  const participantIds = new Set<string>();
  const athleteIds: string[] = [];
  let recorderProfileId: string | undefined;
  let rotationKind: string | undefined;
  let rotationOrder: string[] = [];
  let rotationStoneCount: number | undefined;
  if (isTeam) {
    if (!isRecord(value.teamContext) || value.teamContext.kind !== "team") {
      add("teamContext", "Team context must be a supported Team execution object.");
    } else {
      const context = value.teamContext;
      if (!isCanonicalUuid(context.teamId)) add("teamContext.teamId", "Team id must be a canonical UUID.");
      if (!isCanonicalUuid(context.recorderProfileId)) {
        add("teamContext.recorderProfileId", "Recorder must be a canonical Profile UUID.");
      } else recorderProfileId = context.recorderProfileId;
      if (!Array.isArray(context.participantRoster) || context.participantRoster.length === 0) {
        add("teamContext.participantRoster", "Team execution needs a confirmed participant roster.");
      } else {
        context.participantRoster.forEach((candidate, index) => {
          const path = `teamContext.participantRoster[${index}]`;
          if (!isRecord(candidate) || !isCanonicalUuid(candidate.profileId)) {
            add(path, "Participant must reference a canonical Profile UUID.");
            return;
          }
          if (participantIds.has(candidate.profileId)) add(`${path}.profileId`, "Participant Profiles must be unique.");
          else participantIds.add(candidate.profileId);
          if (candidate.participation === "training-athlete") athleteIds.push(candidate.profileId);
          else if (candidate.participation !== "supporting") {
            add(`${path}.participation`, "Participant kind must be training-athlete or supporting.");
          }
        });
      }
      if (recorderProfileId && !participantIds.has(recorderProfileId)) {
        add("teamContext.recorderProfileId", "The active recorder must be a confirmed participant.");
      }
      if (version && (
        !version.participation.supportedModes.includes("team") ||
        athleteIds.length < version.participation.minTrainingAthletes ||
        (version.participation.maxTrainingAthletes !== null && athleteIds.length > version.participation.maxTrainingAthletes)
      )) {
        add("teamContext.participantRoster", "Training-athlete count or Team mode does not satisfy the snapshotted Exercise Version.");
      }
      if (version?.primaryFocus === "measured") {
        add("exerciseVersionSnapshot.primaryFocus", "Team Release Time must extend the existing timing runner rather than persist a parallel Measured execution.");
      }
      if (!isRecord(context.rotation) || !ROTATION_KINDS.includes(context.rotation.kind as never)) {
        add("teamContext.rotation", "Rotation configuration is invalid.");
      } else {
        rotationKind = String(context.rotation.kind);
        const order = context.rotation.athleteOrder;
        if (!Array.isArray(order) || order.length !== athleteIds.length ||
            order.some((profileId) => typeof profileId !== "string") ||
            new Set(order).size !== order.length ||
            athleteIds.some((profileId) => !order.includes(profileId))) {
          add("teamContext.rotation.athleteOrder", "Rotation order must contain every training athlete exactly once.");
        } else rotationOrder = [...order] as string[];
        if (context.rotation.kind === "after-stone-count" &&
            (!Number.isInteger(context.rotation.stoneCount) || (context.rotation.stoneCount as number) <= 0)) {
          add("teamContext.rotation.stoneCount", "Stone-count rotation needs a positive integer interval.");
        } else if (context.rotation.kind === "after-stone-count") {
          rotationStoneCount = context.rotation.stoneCount as number;
        }
      }
    }
  }

  const enabledProtocols = new Map<string, MeasurementProtocol>();
  const deviationKinds = new Set<string>();
  if (!isRecord(value.configuration)) {
    add("configuration", "Actual execution configuration is required.");
  } else {
    const configuration = value.configuration;
    if (configuration.selectedVariationId !== undefined &&
        (typeof configuration.selectedVariationId !== "string" ||
          !version?.variations.some((variation) => variation.id === configuration.selectedVariationId))) {
      add("configuration.selectedVariationId", "Selected variation is not part of the snapshotted version.");
    }
    if (configuration.plannedVolume !== undefined &&
        (!isRecord(configuration.plannedVolume) ||
          (configuration.plannedVolume.kind !== "stones" && configuration.plannedVolume.kind !== "repetitions") ||
          !Number.isInteger(configuration.plannedVolume.value) ||
          (configuration.plannedVolume.value as number) <= 0)) {
      add("configuration.plannedVolume", "Planned volume must be a positive stone or repetition count.");
    }
    if (isTeam) {
      if (!Number.isInteger(configuration.sweeperCount) || (configuration.sweeperCount as number) < 0 ||
          (configuration.sweeperCount as number) > 2 || typeof configuration.sweepingUsed !== "boolean") {
        add("configuration.sweeping", "Team execution needs an initial zero-to-two Sweeper count and actual sweeping choice.");
      }
    } else if (configuration.sweeperCount !== 0 || configuration.sweepingUsed !== false) {
      add("configuration.sweeping", "Solo execution must record zero Sweepers and no sweeping.");
    }
    if (!Array.isArray(configuration.deviations) || configuration.deviations.some(
      (deviation) => !isRecord(deviation) || !DEVIATION_KINDS.includes(deviation.kind as never) ||
        typeof deviation.description !== "string" || deviation.description.trim().length === 0
    )) {
      add("configuration.deviations", "Every deviation needs a supported kind and non-blank description.");
    } else {
      for (const deviation of configuration.deviations) {
        if (isRecord(deviation) && typeof deviation.kind === "string") deviationKinds.add(deviation.kind);
      }
    }
    if (!Array.isArray(configuration.enabledMeasurementProtocols)) {
      add("configuration.enabledMeasurementProtocols", "Enabled Measurement Protocol snapshots must be an array.");
    } else {
      const compatible = new Set(
        version?.compatibleMeasurementProtocols.map((reference) => `${reference.protocolId}@${reference.protocolVersion}`) ?? []
      );
      for (const [index, candidate] of configuration.enabledMeasurementProtocols.entries()) {
        if (!isRecord(candidate) || typeof candidate.id !== "string" || !Number.isInteger(candidate.version)) {
          add(`configuration.enabledMeasurementProtocols[${index}]`, "Measurement Protocol snapshot is invalid.");
          continue;
        }
        const key = `${candidate.id}@${candidate.version}`;
        const catalogProtocol = catalog.measurementProtocols.find((protocol) => protocolKey(protocol) === key);
        if (!compatible.has(key) || !catalogProtocol || !sameJsonValue(candidate, catalogProtocol) || enabledProtocols.has(key)) {
          add(`configuration.enabledMeasurementProtocols[${index}]`, "Measurement Protocol must be a unique compatible immutable catalog snapshot.");
          continue;
        }
        enabledProtocols.set(key, catalogProtocol);
      }
      if (version?.primaryFocus === "measured" && enabledProtocols.size === 0) {
        add("configuration.enabledMeasurementProtocols", "A Measured Exercise needs an enabled Measurement Protocol.");
      }
      for (const reference of version?.compatibleMeasurementProtocols ?? []) {
        if (reference.requirement === "required" && !enabledProtocols.has(`${reference.protocolId}@${reference.protocolVersion}`)) {
          add("configuration.enabledMeasurementProtocols", "A required Measurement Protocol is missing.");
        }
      }
    }
  }

  const roleSegments = new Map<string, Record<string, unknown>>();
  const roleSegmentEndTimes = new Map<string, string>();
  let soloAthleteProfileId: string | undefined;
  let soloRoleSegmentId: string | undefined;
  if (!Array.isArray(value.roleAssignmentSegments) || value.roleAssignmentSegments.length === 0) {
    add("roleAssignmentSegments", "Exercise execution needs at least one role segment.");
  } else if (!isTeam && value.roleAssignmentSegments.length !== 1) {
    add("roleAssignmentSegments", "Solo execution needs exactly one role segment.");
  } else {
    let previous: Record<string, unknown> | undefined;
    value.roleAssignmentSegments.forEach((candidate, index) => {
      const path = `roleAssignmentSegments[${index}]`;
      if (!isRecord(candidate)) {
        add(path, "Role segment must be an object.");
        return;
      }
      if (registerEntityId(candidate.id, `${path}.id`, "Role segment id")) {
        roleSegments.set(candidate.id, candidate);
        if (!isTeam) soloRoleSegmentId = candidate.id;
      }
      if (!validTimestamp(candidate.startedAt)) add(`${path}.startedAt`, "Role segment start time is invalid.");
      if (previous && validTimestamp(previous.startedAt) && validTimestamp(candidate.startedAt) &&
          Date.parse(candidate.startedAt) <= Date.parse(previous.startedAt)) {
        add(`${path}.startedAt`, "Team role segments must be strictly chronological.");
      }
      if (validTimestamp(candidate.startedAt) && validTimestamp(value.startedAt) &&
          Date.parse(candidate.startedAt) < Date.parse(value.startedAt)) {
        add(`${path}.startedAt`, "Role segment cannot predate the execution start.");
      }
      if (previous && typeof previous.id === "string" && validTimestamp(candidate.startedAt)) {
        roleSegmentEndTimes.set(previous.id, candidate.startedAt);
      }
      if (!isCanonicalUuid(candidate.deliveringAthleteProfileId)) {
        add(`${path}.deliveringAthleteProfileId`, "Delivering athlete must be a canonical Profile UUID.");
      } else if (isTeam && !athleteIds.includes(candidate.deliveringAthleteProfileId)) {
        add(`${path}.deliveringAthleteProfileId`, "Delivering athlete must be a selected training athlete.");
      } else if (!isTeam) soloAthleteProfileId = candidate.deliveringAthleteProfileId;
      if (!Array.isArray(candidate.sweeperProfileIds)) {
        add(`${path}.sweeperProfileIds`, "Sweeper identities must be an array.");
      } else if (isTeam) {
        if (candidate.sweeperProfileIds.length > 2 ||
            new Set(candidate.sweeperProfileIds).size !== candidate.sweeperProfileIds.length ||
            candidate.sweeperProfileIds.some((profileId) => typeof profileId !== "string" || !participantIds.has(profileId))) {
          add(`${path}.sweeperProfileIds`, "Team segment may name at most two distinct confirmed participants as Sweepers.");
        }
      } else if (candidate.sweeperProfileIds.length !== 0) {
        add(`${path}.sweeperProfileIds`, "Solo execution cannot have Sweepers.");
      }
      for (const field of ["skipProfileId", "observerProfileId", "timekeeperProfileId"] as const) {
        if (isTeam) {
          if (candidate[field] !== undefined &&
              (typeof candidate[field] !== "string" || !participantIds.has(candidate[field]))) {
            add(`${path}.${field}`, "Assigned role must belong to a confirmed participant.");
          }
        } else if (candidate[field] !== undefined) {
          add(`${path}.${field}`, "Solo role context cannot name a supporting participant.");
        }
      }
      if (isTeam) {
        const coaches = candidate.coachProfileIds ?? [];
        if (!Array.isArray(coaches) || new Set(coaches).size !== coaches.length ||
            coaches.some((profileId) => typeof profileId !== "string" || !participantIds.has(profileId))) {
          add(`${path}.coachProfileIds`, "Coach identities must be distinct confirmed participants.");
        }
        if (typeof candidate.sweepingUsed !== "boolean" ||
            (candidate.sweepingUsed && Array.isArray(candidate.sweeperProfileIds) && candidate.sweeperProfileIds.length === 0)) {
          add(`${path}.sweepingUsed`, "Team segment needs an actual sweeping choice backed by an assigned Sweeper.");
        }
        if (candidate.recordedByProfileId !== recorderProfileId) {
          add(`${path}.recordedByProfileId`, "Role segment must be attributed to the authenticated active recorder.");
        }
        if (!ROLE_TRANSITION_REASONS.includes(candidate.transitionReason as never) ||
            (index === 0 && candidate.transitionReason !== "initial") ||
            (index > 0 && candidate.transitionReason === "initial")) {
          add(`${path}.transitionReason`, "Role transition reason is invalid for this segment position.");
        }
        if (index > 0 && candidate.transitionReason !== "manual" && candidate.transitionReason !== rotationKind) {
          add(`${path}.transitionReason`, "Automatic role transition must match the planned rotation kind.");
        }
        if (previous && sameJsonValue(roleComparable(previous), roleComparable(candidate))) {
          add(path, "A later role segment must record an actual lineup change.");
        }
      } else {
        for (const field of ["coachProfileIds", "sweepingUsed", "recordedByProfileId", "transitionReason"] as const) {
          if (candidate[field] !== undefined) add(`${path}.${field}`, "Solo role context cannot carry Team-only fields.");
        }
      }
      previous = candidate;
    });
    const first = value.roleAssignmentSegments[0];
    if (isTeam && isRecord(first) && isRecord(value.configuration)) {
      if (value.configuration.sweeperCount !== (Array.isArray(first.sweeperProfileIds) ? first.sweeperProfileIds.length : undefined) ||
          value.configuration.sweepingUsed !== first.sweepingUsed) {
        add("configuration.sweeping", "Initial Team configuration must match the first actual role segment.");
      }
      const initialSweeperCount = Array.isArray(first.sweeperProfileIds) ? first.sweeperProfileIds.length : 0;
      if (version && !version.sweeping.allowedSweeperCounts.includes(initialSweeperCount) &&
          !deviationKinds.has("sweeper-count")) {
        add("configuration.deviations", "A non-standard initial Sweeper count must remain an explicit deviation.");
      }
      if (version && ((version.sweeping.policy === "forbidden" && first.sweepingUsed === true) ||
          (version.sweeping.policy === "required" && first.sweepingUsed === false)) &&
          !deviationKinds.has("sweeping-use")) {
        add("configuration.deviations", "Non-standard initial sweeping use must remain an explicit deviation.");
      }
      const requiredRoleMissing = version?.participation.roles.some((requirement) =>
        requirement.requirement === "required" && !segmentFillsRole(first, requirement.role)
      );
      if (requiredRoleMissing && !deviationKinds.has("role-assignment")) {
        add("configuration.deviations", "A missing standard required role must remain an explicit deviation.");
      }
    }
  }

  let allAttempts: ExerciseAttempt[] = [];
  if (!Array.isArray(value.athleteResults) || value.athleteResults.length === 0) {
    add("athleteResults", "Exercise execution needs at least one Athlete Exercise Result.");
  } else if (!isTeam && value.athleteResults.length !== 1) {
    add("athleteResults", "Solo execution needs exactly one Athlete Exercise Result.");
  } else {
    const resultAthletes = new Set<string>();
    value.athleteResults.forEach((candidate, resultIndex) => {
      const path = `athleteResults[${resultIndex}]`;
      if (!isRecord(candidate)) {
        add(path, "Athlete Result must be an object.");
        return;
      }
      registerEntityId(candidate.id, `${path}.id`, "Athlete Result id");
      if (!isCanonicalUuid(candidate.athleteProfileId)) {
        add(`${path}.athleteProfileId`, "Athlete Result must reference a canonical Profile UUID.");
      } else {
        if (resultAthletes.has(candidate.athleteProfileId)) add(`${path}.athleteProfileId`, "Each training athlete may have only one result.");
        resultAthletes.add(candidate.athleteProfileId);
        if (isTeam && !athleteIds.includes(candidate.athleteProfileId)) {
          add(`${path}.athleteProfileId`, "Team result must belong to a selected training athlete.");
        }
        if (!isTeam && candidate.athleteProfileId !== soloAthleteProfileId) {
          add(`${path}.athleteProfileId`, "Athlete Result must belong to the Solo delivering athlete.");
        }
      }
      if (!validTimestamp(candidate.createdAt) || !validTimestamp(candidate.updatedAt)) {
        add(`${path}.timestamps`, "Athlete Result timestamps are invalid.");
      } else {
        if (validTimestamp(value.startedAt) && Date.parse(candidate.createdAt) < Date.parse(value.startedAt)) {
          add(`${path}.createdAt`, "Athlete Result cannot predate the execution start.");
        }
        if (Date.parse(candidate.updatedAt) < Date.parse(candidate.createdAt)) {
          add(`${path}.updatedAt`, "Athlete Result update cannot predate its creation.");
        }
      }
      if (isTeam && candidate.privateNote !== undefined) {
        add(`${path}.privateNote`, "Private Athlete Notes cannot be stored in the shared Team aggregate.");
      } else if (!isTeam && candidate.privateNote !== undefined && typeof candidate.privateNote !== "string") {
        add(`${path}.privateNote`, "Private Athlete Note must be plain text.");
      }
      if (!Array.isArray(candidate.attempts)) {
        add(`${path}.attempts`, "Attempts must be an array.");
        return;
      }
      allAttempts = [...allAttempts, ...(candidate.attempts as ExerciseAttempt[])];
      candidate.attempts.forEach((attempt, attemptIndex) => {
        const attemptPath = `${path}.attempts[${attemptIndex}]`;
        if (!isRecord(attempt)) {
          add(attemptPath, "Attempt must be an object.");
          return;
        }
        registerEntityId(attempt.id, `${attemptPath}.id`, "Attempt id");
        if (attempt.athleteProfileId !== candidate.athleteProfileId) {
          add(`${attemptPath}.athleteProfileId`, "Attempt must belong to its containing Athlete Result.");
        }
        const segment = typeof attempt.roleAssignmentSegmentId === "string"
          ? roleSegments.get(attempt.roleAssignmentSegmentId)
          : undefined;
        if (!segment || segment.deliveringAthleteProfileId !== candidate.athleteProfileId) {
          add(`${attemptPath}.roleAssignmentSegmentId`, "Attempt must reference a role segment in which this athlete delivered.");
        }
        if (attempt.sequenceNumber !== attemptIndex + 1) {
          add(`${attemptPath}.sequenceNumber`, "Attempt sequence must be contiguous and one-based per athlete.");
        }
        if (!validTimestamp(attempt.createdAt)) add(`${attemptPath}.createdAt`, "Attempt timestamp is invalid.");
        if (validTimestamp(attempt.createdAt) && segment && validTimestamp(segment.startedAt) &&
            Date.parse(attempt.createdAt) < Date.parse(segment.startedAt)) {
          add(`${attemptPath}.createdAt`, "Attempt cannot predate its role segment.");
        }
        const segmentEnd = typeof attempt.roleAssignmentSegmentId === "string"
          ? roleSegmentEndTimes.get(attempt.roleAssignmentSegmentId)
          : undefined;
        if (validTimestamp(attempt.createdAt) && segmentEnd &&
            Date.parse(attempt.createdAt) >= Date.parse(segmentEnd)) {
          add(`${attemptPath}.createdAt`, "Attempt must occur before the next role segment begins.");
        }
        if (isTeam) {
          if (attempt.recordedByProfileId !== recorderProfileId) {
            add(`${attemptPath}.recordedByProfileId`, "Team attempt must be attributed to the authenticated active recorder.");
          }
        } else if (attempt.recordedByProfileId !== undefined || attempt.roleAssignmentSegmentId !== soloRoleSegmentId) {
          add(attemptPath, "Solo attempt cannot carry Team recorder context and must reference its sole role segment.");
        }
        if (attempt.kind === "shotmaking") {
          if (version?.primaryFocus !== "shotmaking") add(`${attemptPath}.kind`, "Shotmaking attempt does not match Exercise focus.");
          if (!HANDLES.includes(attempt.actualHandle as Handle) ||
              (attempt.intendedHandle !== undefined && !HANDLES.includes(attempt.intendedHandle as Handle))) {
            add(`${attemptPath}.handle`, "Attempt handle is invalid.");
          }
          validateEvaluation(attempt.evaluation, `${attemptPath}.evaluation`, add);
        } else if (attempt.kind === "measurement") {
          if (version?.primaryFocus === "shotmaking") add(`${attemptPath}.kind`, "Shotmaking Measurements must be attached to a Shotmaking attempt.");
          if (attempt.actualHandle !== undefined && !HANDLES.includes(attempt.actualHandle as Handle)) {
            add(`${attemptPath}.actualHandle`, "Attempt handle is invalid.");
          }
          if (!Array.isArray(attempt.measurements) || attempt.measurements.length === 0) {
            add(`${attemptPath}.measurements`, "Measurement attempt needs at least one Measurement.");
          }
        } else add(`${attemptPath}.kind`, "Attempt kind is unsupported.");
        validateMeasurements(attempt.measurements, attemptPath, enabledProtocols, entityIds, participantIds, isTeam, add);
      });
    });
    if (isTeam && (resultAthletes.size !== athleteIds.length || athleteIds.some((id) => !resultAthletes.has(id)))) {
      add("athleteResults", "Team execution needs exactly one Athlete Result for every selected training athlete.");
    }
  }

  if (value.status === "completed" && version?.primaryFocus === "shotmaking" && allAttempts.length === 0) {
    add("status", "Completed Shotmaking execution needs at least one attempt.");
  }
  if (value.status === "completed" && version?.primaryFocus === "measured" &&
      !allAttempts.some((attempt) => isRecord(attempt) && Array.isArray(attempt.measurements) && attempt.measurements.length > 0)) {
    add("status", "Completed Measured execution needs at least one Measurement.");
  }
  const terminalAt = value.status === "completed" ? value.completedAt
    : value.status === "abandoned" ? value.abandonedAt
      : undefined;
  if (validTimestamp(terminalAt)) {
    const activityTimes = [
      ...(Array.isArray(value.roleAssignmentSegments)
        ? value.roleAssignmentSegments.filter(isRecord).map((segment) => segment.startedAt)
        : []),
      ...allAttempts.filter(isRecord).map((attempt) => attempt.createdAt),
    ].filter(validTimestamp);
    if (activityTimes.some((activityAt) => Date.parse(activityAt) > Date.parse(terminalAt))) {
      add(value.status === "completed" ? "completedAt" : "abandonedAt", "Terminal time cannot predate recorded execution activity.");
    }
  }
  if (isTeam && rotationOrder.length > 0 && Array.isArray(value.roleAssignmentSegments)) {
    const attempts = allAttempts.filter((attempt): attempt is ExerciseAttempt => isRecord(attempt));
    for (let index = 1; index < value.roleAssignmentSegments.length; index += 1) {
      const previous = value.roleAssignmentSegments[index - 1];
      const current = value.roleAssignmentSegments[index];
      if (!isRecord(previous) || !isRecord(current) || typeof previous.id !== "string") continue;
      const reason = current.transitionReason;
      if (reason === "manual") continue;
      const currentIndex = rotationOrder.indexOf(String(previous.deliveringAthleteProfileId));
      const expected = rotationOrder[(currentIndex + 1) % rotationOrder.length];
      if (currentIndex < 0 || current.deliveringAthleteProfileId !== expected) {
        add(`roleAssignmentSegments[${index}].deliveringAthleteProfileId`, "Automatic rotation must advance to the next planned athlete.");
      }
      const priorAttempts = attempts.filter((attempt) => attempt.roleAssignmentSegmentId === previous.id).length;
      if (reason === "after-every-stone" && priorAttempts < 1) {
        add(`roleAssignmentSegments[${index}].transitionReason`, "After-every-stone rotation cannot occur before a stone is recorded.");
      }
      if (reason === "after-stone-count" &&
          (rotationStoneCount === undefined || priorAttempts < rotationStoneCount)) {
        add(`roleAssignmentSegments[${index}].transitionReason`, "Stone-count rotation cannot occur before its configured interval.");
      }
    }
  }

  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, value: value as ExerciseExecution, issues: [] };
}

function segmentFillsRole(segment: Record<string, unknown>, role: string): boolean {
  switch (role) {
    case "delivering-athlete": return isCanonicalUuid(segment.deliveringAthleteProfileId);
    case "sweeper": return Array.isArray(segment.sweeperProfileIds) && segment.sweeperProfileIds.length > 0;
    case "skip": return isCanonicalUuid(segment.skipProfileId);
    case "observer": return isCanonicalUuid(segment.observerProfileId);
    case "coach": return Array.isArray(segment.coachProfileIds) && segment.coachProfileIds.length > 0;
    case "timekeeper": return isCanonicalUuid(segment.timekeeperProfileId);
    default: return false;
  }
}

function roleComparable(segment: Record<string, unknown>): Record<string, unknown> {
  return {
    deliveringAthleteProfileId: segment.deliveringAthleteProfileId,
    sweeperProfileIds: segment.sweeperProfileIds,
    skipProfileId: segment.skipProfileId,
    observerProfileId: segment.observerProfileId,
    coachProfileIds: segment.coachProfileIds,
    timekeeperProfileId: segment.timekeeperProfileId,
    sweepingUsed: segment.sweepingUsed,
  };
}

function validateEvaluation(
  value: unknown,
  path: string,
  add: (path: string, message: string) => void
): value is ShotmakingEvaluation {
  if (!isRecord(value)) {
    add(path, "Shotmaking evaluation is required.");
    return false;
  }
  if (value.status === "scored") {
    if (!Number.isInteger(value.score) || (value.score as number) < 0 || (value.score as number) > 4) {
      add(`${path}.score`, "Score must be an integer from 0 to 4.");
      return false;
    }
    return true;
  }
  if (value.status === "excluded") {
    if (!EXCLUSION_REASONS.includes(value.reason as never) ||
        (value.reason === "other" && (typeof value.explanation !== "string" || value.explanation.trim().length === 0))) {
      add(path, "Excluded attempt needs a supported reason and an explanation for Other.");
      return false;
    }
    return true;
  }
  add(path, "Shotmaking evaluation status is unsupported.");
  return false;
}

function validateMeasurements(
  value: unknown,
  attemptPath: string,
  protocols: Map<string, MeasurementProtocol>,
  ids: Set<string>,
  participantIds: Set<string>,
  isTeam: boolean,
  add: (path: string, message: string) => void
): value is ExerciseMeasurement[] {
  if (!Array.isArray(value)) {
    add(`${attemptPath}.measurements`, "Measurements must be an array.");
    return false;
  }
  value.forEach((candidate, index) => {
    const path = `${attemptPath}.measurements[${index}]`;
    if (!isRecord(candidate)) {
      add(path, "Measurement must be an object.");
      return;
    }
    if (!isCanonicalUuid(candidate.id) || ids.has(candidate.id)) {
      add(`${path}.id`, "Measurement id must be a globally unique canonical UUID within the execution.");
    } else ids.add(candidate.id);
    const protocol = protocols.get(`${candidate.protocolId}@${candidate.protocolVersion}`);
    if (!protocol) add(path, "Measurement must reference an enabled protocol snapshot.");
    if (typeof candidate.value !== "number" || !Number.isFinite(candidate.value) || candidate.value <= 0) {
      add(`${path}.value`, "Measurement value must be positive and finite.");
    }
    if (protocol?.metricType === "rotation-count" && !Number.isInteger((candidate.value as number) * 2)) {
      add(`${path}.value`, "Rotation Count must use full or half rotations.");
    }
    if (!SOURCES.includes(candidate.source as TimingProviderType) ||
        !protocol?.allowedSources.includes(candidate.source as TimingProviderType)) {
      add(`${path}.source`, "Measurement source is invalid or not allowed by the protocol.");
    }
    if (!validTimestamp(candidate.recordedAt)) add(`${path}.recordedAt`, "Measurement timestamp is invalid.");
    if (candidate.observerProfileId !== undefined &&
        (!isCanonicalUuid(candidate.observerProfileId) || (isTeam && !participantIds.has(candidate.observerProfileId)))) {
      add(`${path}.observerProfileId`, "Observer must be a permitted canonical Profile UUID.");
    }
    for (const field of ["timingResultId", "deviceId", "laneId"] as const) {
      if (candidate[field] !== undefined &&
          (typeof candidate[field] !== "string" || candidate[field].trim().length === 0)) {
        add(`${path}.${field}`, "Optional provenance must be a non-blank string.");
      }
    }
  });
  return true;
}
