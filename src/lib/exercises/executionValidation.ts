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

export type ExerciseExecutionValidationIssue = {
  path: string;
  message: string;
};

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
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameJsonValue(item, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key])
    );
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
  if (!isRecord(value)) return { valid: false, issues: [{ path: "$", message: "Exercise Execution must be an object." }] };

  const entityIds = new Set<string>();
  const registerEntityId = (candidate: unknown, path: string, label: string): candidate is string => {
    if (!isCanonicalUuid(candidate) || entityIds.has(candidate)) {
      add(path, `${label} must be a globally unique canonical UUID within the execution.`);
      return false;
    }
    entityIds.add(candidate);
    return true;
  };

  if (value.schemaVersion !== EXERCISE_EXECUTION_SCHEMA_VERSION) add("schemaVersion", "Unsupported Exercise Execution schema version.");
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

  const enabledProtocols = new Map<string, MeasurementProtocol>();
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
    if (configuration.sweeperCount !== 0 || configuration.sweepingUsed !== false) {
      add("configuration.sweeping", "Stage B1 Solo execution must record zero Sweepers and no sweeping.");
    }
    if (!Array.isArray(configuration.deviations) || configuration.deviations.some(
      (deviation) => !isRecord(deviation) ||
        !["sweeper-count", "sweeping-use", "required-measurement", "other"].includes(String(deviation.kind)) ||
        typeof deviation.description !== "string" || deviation.description.trim().length === 0
    )) {
      add("configuration.deviations", "Every deviation needs a supported kind and non-blank description.");
    }
    if (!Array.isArray(configuration.enabledMeasurementProtocols)) {
      add("configuration.enabledMeasurementProtocols", "Enabled Measurement Protocol snapshots must be an array.");
    } else {
      const compatible = new Set(
        version?.compatibleMeasurementProtocols.map(
          (reference) => `${reference.protocolId}@${reference.protocolVersion}`
        ) ?? []
      );
      for (const [index, candidate] of configuration.enabledMeasurementProtocols.entries()) {
        if (!isRecord(candidate) || typeof candidate.id !== "string" || !Number.isInteger(candidate.version)) {
          add(`configuration.enabledMeasurementProtocols[${index}]`, "Measurement Protocol snapshot is invalid.");
          continue;
        }
        const key = `${candidate.id}@${candidate.version}`;
        const catalogProtocol = catalog.measurementProtocols.find(
          (protocol) => protocolKey(protocol) === key
        );
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

  let athleteProfileId: string | undefined;
  let roleSegmentId: string | undefined;
  if (!Array.isArray(value.roleAssignmentSegments) || value.roleAssignmentSegments.length !== 1 || !isRecord(value.roleAssignmentSegments[0])) {
    add("roleAssignmentSegments", "Stage B1 Solo execution needs exactly one role segment.");
  } else {
    const segment = value.roleAssignmentSegments[0];
    if (registerEntityId(segment.id, "roleAssignmentSegments[0].id", "Role segment id")) roleSegmentId = segment.id;
    if (!isCanonicalUuid(segment.deliveringAthleteProfileId)) add("roleAssignmentSegments[0].deliveringAthleteProfileId", "Delivering athlete must be a canonical Profile UUID.");
    else athleteProfileId = segment.deliveringAthleteProfileId;
    if (!validTimestamp(segment.startedAt)) add("roleAssignmentSegments[0].startedAt", "Role segment start time is invalid.");
    if (!Array.isArray(segment.sweeperProfileIds) || segment.sweeperProfileIds.length !== 0) {
      add("roleAssignmentSegments[0].sweeperProfileIds", "Stage B1 Solo execution cannot have Sweepers.");
    }
    for (const field of ["skipProfileId", "observerProfileId", "timekeeperProfileId"] as const) {
      if (segment[field] !== undefined) add(`roleAssignmentSegments[0].${field}`, "Stage B1 Solo role context cannot name a supporting participant.");
    }
  }

  let attempts: ExerciseAttempt[] = [];
  if (!Array.isArray(value.athleteResults) || value.athleteResults.length !== 1 || !isRecord(value.athleteResults[0])) {
    add("athleteResults", "Stage B1 Solo execution needs exactly one Athlete Exercise Result.");
  } else {
    const result = value.athleteResults[0];
    registerEntityId(result.id, "athleteResults[0].id", "Athlete Result id");
    if (!isCanonicalUuid(result.athleteProfileId) || result.athleteProfileId !== athleteProfileId) {
      add("athleteResults[0].athleteProfileId", "Athlete Result must belong to the Solo delivering athlete.");
    }
    if (!validTimestamp(result.createdAt) || !validTimestamp(result.updatedAt)) {
      add("athleteResults[0].timestamps", "Athlete Result timestamps are invalid.");
    }
    if (result.privateNote !== undefined && typeof result.privateNote !== "string") {
      add("athleteResults[0].privateNote", "Private Athlete Note must be plain text.");
    }
    if (!Array.isArray(result.attempts)) add("athleteResults[0].attempts", "Attempts must be an array.");
    else {
      attempts = result.attempts as ExerciseAttempt[];
      result.attempts.forEach((candidate, index) => {
        const path = `athleteResults[0].attempts[${index}]`;
        if (!isRecord(candidate)) {
          add(path, "Attempt must be an object.");
          return;
        }
        registerEntityId(candidate.id, `${path}.id`, "Attempt id");
        if (candidate.athleteProfileId !== athleteProfileId || candidate.roleAssignmentSegmentId !== roleSegmentId) {
          add(path, "Attempt athlete and role context must match the Solo execution.");
        }
        if (candidate.sequenceNumber !== index + 1) add(`${path}.sequenceNumber`, "Attempt sequence must be contiguous and one-based.");
        if (!validTimestamp(candidate.createdAt)) add(`${path}.createdAt`, "Attempt timestamp is invalid.");
        if (candidate.kind === "shotmaking") {
          if (version?.primaryFocus !== "shotmaking") add(`${path}.kind`, "Shotmaking attempt does not match Exercise focus.");
          if (!HANDLES.includes(candidate.actualHandle as Handle) ||
              (candidate.intendedHandle !== undefined && !HANDLES.includes(candidate.intendedHandle as Handle))) {
            add(`${path}.handle`, "Attempt handle is invalid.");
          }
          validateEvaluation(candidate.evaluation, `${path}.evaluation`, add);
        } else if (candidate.kind === "measurement") {
          if (version?.primaryFocus === "shotmaking") add(`${path}.kind`, "Shotmaking Measurements must be attached to a Shotmaking attempt.");
          if (candidate.actualHandle !== undefined && !HANDLES.includes(candidate.actualHandle as Handle)) add(`${path}.actualHandle`, "Attempt handle is invalid.");
          if (!Array.isArray(candidate.measurements) || candidate.measurements.length === 0) add(`${path}.measurements`, "Measurement attempt needs at least one Measurement.");
        } else add(`${path}.kind`, "Attempt kind is unsupported.");
        validateMeasurements(candidate.measurements, path, enabledProtocols, entityIds, add);
      });
    }
  }

  if (value.status === "completed" && version?.primaryFocus === "shotmaking" && attempts.length === 0) {
    add("status", "Completed Shotmaking execution needs at least one attempt.");
  }
  if (value.status === "completed" && version?.primaryFocus === "measured" &&
      !attempts.some((attempt) => isRecord(attempt) && Array.isArray(attempt.measurements) && attempt.measurements.length > 0)) {
    add("status", "Completed Measured execution needs at least one Measurement.");
  }

  return issues.length > 0
    ? { valid: false, issues }
    : { valid: true, value: value as ExerciseExecution, issues: [] };
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
    if (!isCanonicalUuid(candidate.id) || ids.has(candidate.id)) add(`${path}.id`, "Measurement id must be a globally unique canonical UUID within the execution.");
    else ids.add(candidate.id);
    const protocol = protocols.get(`${candidate.protocolId}@${candidate.protocolVersion}`);
    if (!protocol) add(path, "Measurement must reference an enabled protocol snapshot.");
    if (typeof candidate.value !== "number" || !Number.isFinite(candidate.value) || candidate.value <= 0) add(`${path}.value`, "Measurement value must be positive and finite.");
    if (!SOURCES.includes(candidate.source as TimingProviderType) || !protocol?.allowedSources.includes(candidate.source as TimingProviderType)) add(`${path}.source`, "Measurement source is invalid or not allowed by the protocol.");
    if (!validTimestamp(candidate.recordedAt)) add(`${path}.recordedAt`, "Measurement timestamp is invalid.");
    if (candidate.observerProfileId !== undefined && !isCanonicalUuid(candidate.observerProfileId)) add(`${path}.observerProfileId`, "Observer must be a canonical Profile UUID.");
    for (const field of ["timingResultId", "deviceId", "laneId"] as const) {
      if (candidate[field] !== undefined && (typeof candidate[field] !== "string" || candidate[field].trim().length === 0)) add(`${path}.${field}`, "Optional provenance must be a non-blank string.");
    }
  });
  return true;
}
