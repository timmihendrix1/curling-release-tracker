import type { Handle, TimingProviderType } from "../../types";
import { isCanonicalUuid } from "../uuid";
import { exerciseRunnerKind, findExerciseVersion } from "./lookup";
import type {
  ExerciseAttempt,
  ExerciseActiveAttemptCorrection,
  ExerciseExecution,
  ExerciseMeasurement,
  ShotmakingExerciseAttempt,
  ShotmakingEvaluation,
} from "./executionTypes";
import { SUPPORTED_EXERCISE_EXECUTION_SCHEMA_VERSIONS } from "./executionTypes";
import type { ExerciseCatalogPackage, ExerciseVersion, MeasurementProtocol } from "./types";

export type ExerciseExecutionValidationIssue = { path: string; message: string };

export type ExerciseExecutionValidationResult =
  | { valid: true; value: ExerciseExecution; issues: [] }
  | { valid: false; issues: ExerciseExecutionValidationIssue[] };

export type ExerciseExecutionValidationOptions = {
  /** Validates one athlete's completed Team-result read projection. */
  ownedTeamResultProfileId?: string;
};

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
  catalog: ExerciseCatalogPackage,
  options: ExerciseExecutionValidationOptions = {}
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

  if (!SUPPORTED_EXERCISE_EXECUTION_SCHEMA_VERSIONS.includes(value.schemaVersion as 1 | 2)) {
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
      if (version && exerciseRunnerKind(catalog, version) !== "exercise-execution") {
        add("exerciseVersionSnapshot.primaryFocus", "This Team Exercise does not use the generic Exercise Execution runner; Release Timing remains on its existing path.");
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

  const ownedTeamResultProfileId = options.ownedTeamResultProfileId;
  if (ownedTeamResultProfileId !== undefined && !isCanonicalUuid(ownedTeamResultProfileId)) {
    add("validation.ownedTeamResultProfileId", "Owned Team result projection needs a canonical athlete Profile UUID.");
  }
  if (ownedTeamResultProfileId !== undefined && !isTeam) {
    add("validation.ownedTeamResultProfileId", "Owned Team result projection can validate only a Team execution.");
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
      const resultSequenceNumbers = new Set<number>();
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
        const roleOverride = isRecord(attempt.teamRoleContextOverride)
          ? attempt.teamRoleContextOverride
          : undefined;
        if (attempt.teamRoleContextOverride !== undefined && !roleOverride) {
          add(`${attemptPath}.teamRoleContextOverride`, "Corrected Team role context must be an object.");
        }
        const effectiveDeliverer = roleOverride?.deliveringAthleteProfileId ?? segment?.deliveringAthleteProfileId;
        if (!segment || effectiveDeliverer !== candidate.athleteProfileId) {
          add(`${attemptPath}.roleAssignmentSegmentId`, "Attempt must reference a role segment in which this athlete delivered.");
        }
        if (!Number.isInteger(attempt.sequenceNumber) || (attempt.sequenceNumber as number) <= 0 ||
            (isTeam && resultSequenceNumbers.has(attempt.sequenceNumber as number)) ||
            (!isTeam && attempt.sequenceNumber !== attemptIndex + 1)) {
          add(`${attemptPath}.sequenceNumber`, isTeam
            ? "Team attempt sequence must be a unique positive integer per athlete."
            : "Attempt sequence must be contiguous and one-based per athlete.");
        } else {
          resultSequenceNumbers.add(attempt.sequenceNumber as number);
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
          if (roleOverride && !validateAttemptRoleContext(
            roleOverride,
            participantIds,
            athleteIds,
            `${attemptPath}.teamRoleContextOverride`,
            add
          )) {
            // The helper accumulates every role-context issue.
          }
        } else if (attempt.recordedByProfileId !== undefined || attempt.roleAssignmentSegmentId !== soloRoleSegmentId) {
          add(attemptPath, "Solo attempt cannot carry Team recorder context and must reference its sole role segment.");
        } else if (attempt.teamRoleContextOverride !== undefined) {
          add(`${attemptPath}.teamRoleContextOverride`, "Solo attempts cannot override Team role context.");
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
          if (attempt.teamRoleContextOverride !== undefined) {
            add(`${attemptPath}.teamRoleContextOverride`, "Only Team Shotmaking attempts may override captured role context.");
          }
        } else add(`${attemptPath}.kind`, "Attempt kind is unsupported.");
        validateMeasurements(attempt.measurements, attemptPath, enabledProtocols, entityIds, participantIds, isTeam, add);
      });
    });
    if (isTeam && ownedTeamResultProfileId !== undefined) {
      if (
        value.status !== "completed" ||
        !athleteIds.includes(ownedTeamResultProfileId) ||
        resultAthletes.size !== 1 ||
        !resultAthletes.has(ownedTeamResultProfileId)
      ) {
        add("athleteResults", "Owned Team result projection needs exactly the authenticated training athlete's completed result.");
      }
    } else if (isTeam && (resultAthletes.size !== athleteIds.length || athleteIds.some((id) => !resultAthletes.has(id)))) {
      add("athleteResults", "Team execution needs exactly one Athlete Result for every selected training athlete.");
    }
  }

  const currentAttemptsById = new Map(
    allAttempts.filter((attempt): attempt is ExerciseAttempt => isRecord(attempt) && typeof attempt.id === "string")
      .map((attempt) => [attempt.id, attempt])
  );
  const correctionChains = new Map<string, ExerciseActiveAttemptCorrection>();
  let previousCorrectionAt: string | undefined;
  if (isTeam && value.schemaVersion === 2 && value.activeAttemptCorrections === undefined) {
    add("activeAttemptCorrections", "Team Exercise Execution schema version 2 requires an active correction array.");
  }
  if (value.activeAttemptCorrections !== undefined) {
    if (!isTeam || !Array.isArray(value.activeAttemptCorrections)) {
      add("activeAttemptCorrections", "Active attempt corrections are supported only as a Team array.");
    } else if (value.schemaVersion !== 2) {
      add("activeAttemptCorrections", "Active attempt corrections require Exercise Execution schema version 2.");
    } else {
      const activeAttemptCorrections = value.activeAttemptCorrections;
      activeAttemptCorrections.forEach((candidate, index) => {
        const path = `activeAttemptCorrections[${index}]`;
        if (!isRecord(candidate)) {
          add(path, "Active correction must be an object.");
          return;
        }
        const correctionKeys = new Set([
          "id", "kind", "attemptId", "correctedByProfileId", "correctedAt", "before", "after",
        ]);
        if (Object.keys(candidate).some((key) => !correctionKeys.has(key))) {
          add(path, "Active correction contains an unsupported field.");
        }
        registerEntityId(candidate.id, `${path}.id`, "Correction id");
        if (candidate.kind !== "updated" && candidate.kind !== "annulled") {
          add(`${path}.kind`, "Correction kind must be updated or annulled.");
        }
        if (!isCanonicalUuid(candidate.attemptId)) add(`${path}.attemptId`, "Correction target must be a canonical attempt UUID.");
        if (candidate.correctedByProfileId !== recorderProfileId) {
          add(`${path}.correctedByProfileId`, "Correction must be attributed to the authenticated active recorder.");
        }
        if (!validTimestamp(candidate.correctedAt) ||
            (previousCorrectionAt !== undefined && validTimestamp(candidate.correctedAt) &&
              Date.parse(candidate.correctedAt) <= Date.parse(previousCorrectionAt))) {
          add(`${path}.correctedAt`, "Correction time must be valid and strictly chronological.");
        }
        if (validTimestamp(candidate.correctedAt)) previousCorrectionAt = candidate.correctedAt;
        const before = validateCorrectionAttemptSnapshot(
          candidate.before,
          `${path}.before`,
          candidate.attemptId,
          recorderProfileId,
          roleSegments,
          participantIds,
          athleteIds,
          enabledProtocols,
          add
        );
        const after = candidate.kind === "updated"
          ? validateCorrectionAttemptSnapshot(
              candidate.after,
              `${path}.after`,
              candidate.attemptId,
              recorderProfileId,
              roleSegments,
              participantIds,
              athleteIds,
              enabledProtocols,
              add
            )
          : null;
        if (candidate.kind === "annulled" && candidate.after !== undefined) {
          add(`${path}.after`, "An annulled attempt cannot have a resulting value.");
        }
        if (before && validTimestamp(candidate.correctedAt) && Date.parse(candidate.correctedAt) < Date.parse(before.createdAt)) {
          add(`${path}.correctedAt`, "Correction cannot predate the captured attempt.");
        }
        if (validTimestamp(candidate.correctedAt) && [before, after].filter(
          (snapshot): snapshot is ShotmakingExerciseAttempt => snapshot !== null
        ).some((snapshot) => snapshot.measurements.some((measurement) =>
          validTimestamp(measurement.recordedAt) && Date.parse(measurement.recordedAt) > Date.parse(candidate.correctedAt as string)
        ))) {
          add(`${path}.correctedAt`, "Correction cannot predate a Measurement retained in its attempt snapshot.");
        }
        const previous = typeof candidate.attemptId === "string"
          ? correctionChains.get(candidate.attemptId)
          : undefined;
        if (before && after && sameJsonValue(before, after)) {
          add(`${path}.after`, "An update correction must change at least one captured fact.");
        }
        if (before && after && (
          before.createdAt !== after.createdAt ||
          before.recordedByProfileId !== after.recordedByProfileId ||
          before.roleAssignmentSegmentId !== after.roleAssignmentSegmentId ||
          before.intendedHandle !== after.intendedHandle ||
          (before.athleteProfileId === after.athleteProfileId &&
            before.sequenceNumber !== after.sequenceNumber)
        )) {
          add(
            `${path}.after`,
            "A correction cannot rewrite the original capture time, recorder, role segment, intended handle or unchanged-athlete sequence."
          );
        }
        if (ownedTeamResultProfileId === undefined) {
          if (previous?.kind === "annulled") {
            add(path, "An annulled attempt cannot be corrected again.");
          } else if (previous?.after && before && !sameJsonValue(previous.after, before)) {
            add(`${path}.before`, "Correction history must continue from the preceding resulting value.");
          }
          if (typeof candidate.attemptId === "string") {
            correctionChains.set(candidate.attemptId, candidate as unknown as ExerciseActiveAttemptCorrection);
          }
        } else if (before && after &&
            before.athleteProfileId !== ownedTeamResultProfileId &&
            after.athleteProfileId !== ownedTeamResultProfileId) {
          add(path, "Owned correction projection may contain only changes affecting the authenticated athlete.");
        } else if (before && !after && before.athleteProfileId !== ownedTeamResultProfileId) {
          add(path, "Owned annulment projection may contain only the authenticated athlete's attempt.");
        }
      });
      if (ownedTeamResultProfileId === undefined) {
        for (const [attemptId, finalCorrection] of correctionChains) {
          const current = currentAttemptsById.get(attemptId);
          if (finalCorrection.kind === "annulled") {
            if (current) add("athleteResults", "An annulled attempt must be absent from current Athlete Results.");
          } else if (!current || !finalCorrection.after || !sameJsonValue(current, finalCorrection.after)) {
            add("athleteResults", "The current attempt must equal its latest audited correction result.");
          }
        }
      }
      if (Array.isArray(value.athleteResults)) {
        value.athleteResults.forEach((result, resultIndex) => {
          if (!isRecord(result) || typeof result.athleteProfileId !== "string" || !validTimestamp(result.updatedAt)) return;
          const latestRelevant = activeAttemptCorrections
            .filter((correction): correction is Record<string, unknown> => isRecord(correction))
            .filter((correction) => {
              const before = isRecord(correction.before) ? correction.before : null;
              const after = isRecord(correction.after) ? correction.after : null;
              return before?.athleteProfileId === result.athleteProfileId || after?.athleteProfileId === result.athleteProfileId;
            })
            .map((correction) => correction.correctedAt)
            .filter(validTimestamp)
            .at(-1);
          if (latestRelevant && Date.parse(result.updatedAt) < Date.parse(latestRelevant)) {
            add(`athleteResults[${resultIndex}].updatedAt`, "Athlete Result update time cannot predate an affecting correction.");
          }
        });
      }
    }
  }

  if (value.status === "completed" && version?.primaryFocus === "shotmaking" &&
      allAttempts.length === 0 && ownedTeamResultProfileId === undefined) {
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
      ...(Array.isArray(value.activeAttemptCorrections)
        ? value.activeAttemptCorrections.filter(isRecord).map((correction) => correction.correctedAt)
        : []),
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
      if (ownedTeamResultProfileId !== undefined &&
          previous.deliveringAthleteProfileId !== ownedTeamResultProfileId) continue;
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

function validateAttemptRoleContext(
  value: Record<string, unknown>,
  participantIds: Set<string>,
  athleteIds: string[],
  path: string,
  add: (path: string, message: string) => void
): boolean {
  let valid = true;
  const fail = (field: string, message: string) => {
    valid = false;
    add(`${path}.${field}`, message);
  };
  const allowed = new Set([
    "deliveringAthleteProfileId", "sweeperProfileIds", "skipProfileId",
    "observerProfileId", "coachProfileIds", "timekeeperProfileId", "sweepingUsed",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    valid = false;
    add(path, "Corrected role context contains an unsupported field.");
  }
  if (!isCanonicalUuid(value.deliveringAthleteProfileId) || !athleteIds.includes(value.deliveringAthleteProfileId)) {
    fail("deliveringAthleteProfileId", "Corrected delivering athlete must be a selected training athlete.");
  }
  if (!Array.isArray(value.sweeperProfileIds) || value.sweeperProfileIds.length > 2 ||
      new Set(value.sweeperProfileIds).size !== value.sweeperProfileIds.length ||
      value.sweeperProfileIds.some((profileId) => typeof profileId !== "string" || !participantIds.has(profileId))) {
    fail("sweeperProfileIds", "Corrected Sweepers must be zero to two distinct confirmed participants.");
  }
  if (typeof value.sweepingUsed !== "boolean" ||
      (value.sweepingUsed && Array.isArray(value.sweeperProfileIds) && value.sweeperProfileIds.length === 0)) {
    fail("sweepingUsed", "Corrected sweeping use needs an assigned Sweeper when used.");
  }
  for (const field of ["skipProfileId", "observerProfileId", "timekeeperProfileId"] as const) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || !participantIds.has(value[field] as string))) {
      fail(field, "Corrected role must belong to a confirmed participant.");
    }
  }
  const coaches = value.coachProfileIds ?? [];
  if (!Array.isArray(coaches) || new Set(coaches).size !== coaches.length ||
      coaches.some((profileId) => typeof profileId !== "string" || !participantIds.has(profileId))) {
    fail("coachProfileIds", "Corrected Coaches must be distinct confirmed participants.");
  }
  return valid;
}

function validateCorrectionAttemptSnapshot(
  value: unknown,
  path: string,
  attemptId: unknown,
  recorderProfileId: string | undefined,
  roleSegments: Map<string, Record<string, unknown>>,
  participantIds: Set<string>,
  athleteIds: string[],
  protocols: Map<string, MeasurementProtocol>,
  add: (path: string, message: string) => void
): ShotmakingExerciseAttempt | null {
  if (!isRecord(value)) {
    add(path, "Correction snapshot must contain a Shotmaking attempt.");
    return null;
  }
  const snapshotKeys = new Set([
    "id", "kind", "athleteProfileId", "roleAssignmentSegmentId", "sequenceNumber",
    "createdAt", "recordedByProfileId", "intendedHandle", "actualHandle", "evaluation",
    "measurements", "teamRoleContextOverride",
  ]);
  if (Object.keys(value).some((key) => !snapshotKeys.has(key))) {
    add(path, "Correction attempt snapshot contains an unsupported field.");
  }
  if (value.id !== attemptId || value.kind !== "shotmaking" ||
      !isCanonicalUuid(value.athleteProfileId) || !athleteIds.includes(value.athleteProfileId) ||
      !Number.isInteger(value.sequenceNumber) || (value.sequenceNumber as number) <= 0 ||
      !validTimestamp(value.createdAt) || value.recordedByProfileId !== recorderProfileId ||
      !roleSegments.has(String(value.roleAssignmentSegmentId)) ||
      !HANDLES.includes(value.actualHandle as Handle) ||
      (value.intendedHandle !== undefined && !HANDLES.includes(value.intendedHandle as Handle))) {
    add(path, "Correction snapshot has invalid immutable identity, ownership, sequence, time, recorder, role reference or handle facts.");
    return null;
  }
  validateEvaluation(value.evaluation, `${path}.evaluation`, add);
  const segment = roleSegments.get(String(value.roleAssignmentSegmentId));
  const roleOverride = isRecord(value.teamRoleContextOverride)
    ? value.teamRoleContextOverride
    : undefined;
  if (value.teamRoleContextOverride !== undefined && !roleOverride) {
    add(`${path}.teamRoleContextOverride`, "Corrected role context must be an object.");
  }
  if (roleOverride) {
    validateAttemptRoleContext(roleOverride, participantIds, athleteIds, `${path}.teamRoleContextOverride`, add);
  }
  const effectiveDeliverer = roleOverride?.deliveringAthleteProfileId ?? segment?.deliveringAthleteProfileId;
  if (effectiveDeliverer !== value.athleteProfileId) {
    add(`${path}.athleteProfileId`, "Correction snapshot owner must match its effective delivering athlete.");
  }
  validateMeasurements(value.measurements, path, protocols, new Set<string>(), participantIds, true, add);
  return value as unknown as ShotmakingExerciseAttempt;
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
