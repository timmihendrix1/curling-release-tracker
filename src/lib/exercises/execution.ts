import type { Handle } from "../../types";
import { isCanonicalUuid } from "../uuid";
import { EXERCISE_CATALOG } from "./catalog";
import {
  exerciseExecutionError,
  exerciseExecutionOk,
  type ExerciseExecutionOutcome,
} from "./executionErrors";
import type {
  ExerciseAttempt,
  ExerciseExecution,
  ExerciseExecutionConfiguration,
  ExerciseExecutionDeviation,
  ExerciseExecutionVolume,
  ExerciseMeasurement,
  MeasurementExerciseAttempt,
  ShotmakingEvaluation,
  ShotmakingExerciseAttempt,
} from "./executionTypes";
import { EXERCISE_EXECUTION_SCHEMA_VERSION } from "./executionTypes";
import { findExerciseVersion } from "./lookup";
import type { ExerciseVersion, MeasurementProtocol } from "./types";

const VALID_HANDLES: readonly Handle[] = ["in", "out"];
const VALID_EXCLUSION_REASONS = [
  "external-interruption",
  "incorrect-or-displaced-setup",
  "technical-or-capture-problem",
  "outcome-not-observable",
  "other",
] as const;

type ExecutionClock = {
  id(): string;
  now(): string;
};

const defaultClock: ExecutionClock = {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function validTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function evaluationBasisFor(version: ExerciseVersion): ExerciseExecution["evaluationBasis"] {
  return version.primaryFocus === "shotmaking" &&
    version.guidance.kind === "generic-shotmaking-score"
    ? version.guidance.evaluationBasis
    : "not-applicable";
}

export type CreateSoloExerciseExecutionOptions = {
  trainingSessionId: string;
  athleteProfileId: string;
  selectedVariationId?: string;
  plannedVolume?: ExerciseExecutionVolume;
  enabledMeasurementProtocols?: MeasurementProtocol[];
  additionalDeviationNotes?: string[];
  clock?: ExecutionClock;
};

/** Creates the exact Solo start context; Team roles and rotation arrive in Stage C. */
export function createSoloExerciseExecution(
  version: ExerciseVersion,
  options: CreateSoloExerciseExecutionOptions
): ExerciseExecutionOutcome<ExerciseExecution> {
  const clock = options.clock ?? defaultClock;
  const catalogVersion = findExerciseVersion(EXERCISE_CATALOG, version.id);
  if (!catalogVersion || !sameJsonValue(version, catalogVersion)) {
    return exerciseExecutionError(
      "invalid-input",
      "Version 1 execution can start only from an immutable curated catalog Exercise Version."
    );
  }
  if (!isCanonicalUuid(options.trainingSessionId) || !isCanonicalUuid(options.athleteProfileId)) {
    return exerciseExecutionError("invalid-input", "A Solo execution needs valid Session and athlete Profile ids.");
  }
  if (!version.participation.supportedModes.includes("solo")) {
    return exerciseExecutionError("unsupported-focus", "This Exercise Version does not support Solo execution.");
  }
  if (
    options.selectedVariationId !== undefined &&
    !version.variations.some((variation) => variation.id === options.selectedVariationId)
  ) {
    return exerciseExecutionError("unsupported-variation", "The selected variation is not part of this Exercise Version.");
  }
  if (options.plannedVolume && !isPositiveInteger(options.plannedVolume.value)) {
    return exerciseExecutionError("invalid-input", "Planned execution volume must be a positive integer.");
  }

  const enabledProtocols = options.enabledMeasurementProtocols ?? [];
  const compatible = new Map(
    version.compatibleMeasurementProtocols.map((reference) => [
      `${reference.protocolId}@${reference.protocolVersion}`,
      reference,
    ])
  );
  const seen = new Set<string>();
  for (const protocol of enabledProtocols) {
    const key = protocolKey(protocol);
    const catalogProtocol = EXERCISE_CATALOG.measurementProtocols.find(
      (candidate) => protocolKey(candidate) === key
    );
    if (!compatible.has(key) || seen.has(key) || !catalogProtocol || !sameJsonValue(protocol, catalogProtocol)) {
      return exerciseExecutionError(
        "unsupported-measurement-protocol",
        "Every enabled Measurement Protocol must be a unique compatible protocol of this Exercise Version."
      );
    }
    seen.add(key);
  }
  const missingRequired = [...compatible.entries()].some(
    ([key, reference]) => reference.requirement === "required" && !seen.has(key)
  );
  if (missingRequired || (version.primaryFocus === "measured" && enabledProtocols.length === 0)) {
    return exerciseExecutionError(
      "required-measurement-protocol-missing",
      "This execution needs a supported Measurement Protocol before it can start."
    );
  }

  const deviations: ExerciseExecutionDeviation[] = [];
  if (!version.sweeping.allowedSweeperCounts.includes(0)) {
    deviations.push({
      kind: "sweeper-count",
      description: "Solo execution uses no Sweeper although the standard does not list zero Sweepers.",
    });
  }
  if (version.sweeping.policy === "required") {
    deviations.push({
      kind: "sweeping-use",
      description: "Solo execution does not use sweeping although the standard requires it.",
    });
  }
  for (const note of options.additionalDeviationNotes ?? []) {
    if (note.trim().length === 0) {
      return exerciseExecutionError("invalid-input", "A declared deviation note must not be blank.");
    }
    deviations.push({ kind: "other", description: note });
  }

  const startedAt = clock.now();
  const executionId = clock.id();
  const roleSegmentId = clock.id();
  const resultId = clock.id();
  if (
    !isCanonicalUuid(executionId) ||
    !isCanonicalUuid(roleSegmentId) ||
    !isCanonicalUuid(resultId) ||
    new Set([executionId, roleSegmentId, resultId]).size !== 3 ||
    !validTimestamp(startedAt)
  ) {
    return exerciseExecutionError("invalid-input", "The execution clock returned invalid identity or time data.");
  }

  const configuration: ExerciseExecutionConfiguration = {
    ...(options.selectedVariationId ? { selectedVariationId: options.selectedVariationId } : {}),
    ...(options.plannedVolume ? { plannedVolume: clone(options.plannedVolume) } : {}),
    sweeperCount: 0,
    sweepingUsed: false,
    enabledMeasurementProtocols: clone(enabledProtocols),
    deviations,
  };

  return exerciseExecutionOk({
    id: executionId,
    trainingSessionId: options.trainingSessionId,
    exerciseVersionSnapshot: clone(version),
    evaluationBasis: evaluationBasisFor(version),
    configuration,
    status: "in-progress",
    startedAt,
    roleAssignmentSegments: [
      {
        id: roleSegmentId,
        startedAt,
        deliveringAthleteProfileId: options.athleteProfileId,
        sweeperProfileIds: [],
      },
    ],
    athleteResults: [
      {
        id: resultId,
        athleteProfileId: options.athleteProfileId,
        attempts: [],
        createdAt: startedAt,
        updatedAt: startedAt,
      },
    ],
    schemaVersion: EXERCISE_EXECUTION_SCHEMA_VERSION,
  });
}

function activeSoloContext(execution: ExerciseExecution): ExerciseExecutionOutcome<{
  athleteProfileId: string;
  roleAssignmentSegmentId: string;
  resultIndex: number;
}> {
  if (execution.status !== "in-progress") {
    return exerciseExecutionError("execution-not-active", "A terminal Exercise Execution cannot receive another attempt.");
  }
  if (execution.athleteResults.length !== 1 || execution.roleAssignmentSegments.length !== 1) {
    return exerciseExecutionError("invalid-input", "The Solo execution context is invalid.");
  }
  const result = execution.athleteResults[0];
  const segment = execution.roleAssignmentSegments[0];
  if (result.athleteProfileId !== segment.deliveringAthleteProfileId) {
    return exerciseExecutionError("invalid-input", "The Solo athlete and active delivering role do not match.");
  }
  return exerciseExecutionOk({
    athleteProfileId: result.athleteProfileId,
    roleAssignmentSegmentId: segment.id,
    resultIndex: 0,
  });
}

function validateMeasurements(
  execution: ExerciseExecution,
  measurements: ExerciseMeasurement[],
  reservedIds: Set<string>
): ExerciseExecutionOutcome<ExerciseMeasurement[]> {
  const protocols = new Map(
    execution.configuration.enabledMeasurementProtocols.map((protocol) => [protocolKey(protocol), protocol])
  );
  const ids = new Set(reservedIds);
  for (const measurement of measurements) {
    const protocol = protocols.get(`${measurement.protocolId}@${measurement.protocolVersion}`);
    if (
      !isCanonicalUuid(measurement.id) ||
      ids.has(measurement.id) ||
      !protocol ||
      !Number.isFinite(measurement.value) ||
      measurement.value <= 0 ||
      !protocol.allowedSources.includes(measurement.source) ||
      !validTimestamp(measurement.recordedAt) ||
      (measurement.observerProfileId !== undefined && !isCanonicalUuid(measurement.observerProfileId))
    ) {
      return exerciseExecutionError("invalid-attempt", "The attempt contains an invalid or unsupported Measurement.");
    }
    ids.add(measurement.id);
  }
  return exerciseExecutionOk(clone(measurements));
}

function appendAttempt(
  execution: ExerciseExecution,
  attempt: ExerciseAttempt,
  resultIndex: number,
  updatedAt: string
): ExerciseExecution {
  const athleteResults = execution.athleteResults.map((result, index) =>
    index === resultIndex
      ? { ...result, attempts: [...result.attempts, attempt], updatedAt }
      : result
  );
  return { ...execution, athleteResults };
}

function aggregateIds(execution: ExerciseExecution): Set<string> {
  return new Set([
    execution.id,
    ...execution.roleAssignmentSegments.map((segment) => segment.id),
    ...execution.athleteResults.flatMap((result) => [
      result.id,
      ...result.attempts.flatMap((attempt) => [
        attempt.id,
        ...attempt.measurements.map((measurement) => measurement.id),
      ]),
    ]),
  ]);
}

export type AddShotmakingAttemptInput = {
  athleteProfileId: string;
  intendedHandle?: Handle;
  actualHandle: Handle;
  evaluation: ShotmakingEvaluation;
  measurements?: ExerciseMeasurement[];
  clock?: ExecutionClock;
};

export function addShotmakingAttempt(
  execution: ExerciseExecution,
  input: AddShotmakingAttemptInput
): ExerciseExecutionOutcome<ExerciseExecution> {
  if (execution.exerciseVersionSnapshot.primaryFocus !== "shotmaking") {
    return exerciseExecutionError("unsupported-focus", "Only a Shotmaking Exercise can receive a Shotmaking attempt.");
  }
  const context = activeSoloContext(execution);
  if (!context.ok) return context;
  if (input.athleteProfileId !== context.value.athleteProfileId) {
    return exerciseExecutionError("wrong-athlete", "An attempt must belong to the Solo execution athlete.");
  }
  if (!VALID_HANDLES.includes(input.actualHandle) ||
      (input.intendedHandle !== undefined && !VALID_HANDLES.includes(input.intendedHandle))) {
    return exerciseExecutionError("invalid-attempt", "Shotmaking handles must be In- or Outhandle.");
  }
  if (input.evaluation.status !== "scored" && input.evaluation.status !== "excluded") {
    return exerciseExecutionError("invalid-attempt", "Shotmaking evaluation status is unsupported.");
  }
  if (
    input.evaluation.status === "scored" &&
    (!Number.isInteger(input.evaluation.score) || input.evaluation.score < 0 || input.evaluation.score > 4)
  ) {
    return exerciseExecutionError("invalid-attempt", "Shotmaking score must be an integer from 0 to 4.");
  }
  if (
    input.evaluation.status === "excluded" &&
    (!VALID_EXCLUSION_REASONS.includes(input.evaluation.reason) ||
      (input.evaluation.reason === "other" &&
        (!input.evaluation.explanation || input.evaluation.explanation.trim().length === 0)))
  ) {
    return exerciseExecutionError("invalid-attempt", "An excluded attempt needs a supported reason and an explanation for Other.");
  }
  const clock = input.clock ?? defaultClock;
  const id = clock.id();
  const createdAt = clock.now();
  const reservedIds = aggregateIds(execution);
  if (!isCanonicalUuid(id) || reservedIds.has(id) || !validTimestamp(createdAt)) {
    return exerciseExecutionError("invalid-input", "The attempt clock returned invalid identity or time data.");
  }
  reservedIds.add(id);
  const measurementResult = validateMeasurements(execution, input.measurements ?? [], reservedIds);
  if (!measurementResult.ok) return measurementResult;
  const result = execution.athleteResults[context.value.resultIndex];
  const attempt: ShotmakingExerciseAttempt = {
    id,
    kind: "shotmaking",
    athleteProfileId: input.athleteProfileId,
    roleAssignmentSegmentId: context.value.roleAssignmentSegmentId,
    sequenceNumber: result.attempts.length + 1,
    ...(input.intendedHandle ? { intendedHandle: input.intendedHandle } : {}),
    actualHandle: input.actualHandle,
    evaluation: clone(input.evaluation),
    measurements: measurementResult.value,
    createdAt,
  };
  return exerciseExecutionOk(appendAttempt(execution, attempt, context.value.resultIndex, createdAt));
}

export type AddMeasurementAttemptInput = {
  athleteProfileId: string;
  actualHandle?: Handle;
  measurements: ExerciseMeasurement[];
  clock?: ExecutionClock;
};

export function addMeasurementAttempt(
  execution: ExerciseExecution,
  input: AddMeasurementAttemptInput
): ExerciseExecutionOutcome<ExerciseExecution> {
  if (execution.exerciseVersionSnapshot.primaryFocus === "shotmaking") {
    return exerciseExecutionError("unsupported-focus", "Shotmaking Measurements belong on the Shotmaking attempt they describe.");
  }
  const context = activeSoloContext(execution);
  if (!context.ok) return context;
  if (input.athleteProfileId !== context.value.athleteProfileId) {
    return exerciseExecutionError("wrong-athlete", "An attempt must belong to the Solo execution athlete.");
  }
  if (input.measurements.length === 0) {
    return exerciseExecutionError("invalid-attempt", "A Measurement attempt needs at least one Measurement.");
  }
  if (input.actualHandle !== undefined && !VALID_HANDLES.includes(input.actualHandle)) {
    return exerciseExecutionError("invalid-attempt", "Attempt handle must be In- or Outhandle.");
  }
  const clock = input.clock ?? defaultClock;
  const id = clock.id();
  const createdAt = clock.now();
  const reservedIds = aggregateIds(execution);
  if (!isCanonicalUuid(id) || reservedIds.has(id) || !validTimestamp(createdAt)) {
    return exerciseExecutionError("invalid-input", "The attempt clock returned invalid identity or time data.");
  }
  reservedIds.add(id);
  const measurementResult = validateMeasurements(execution, input.measurements, reservedIds);
  if (!measurementResult.ok) return measurementResult;
  const result = execution.athleteResults[context.value.resultIndex];
  const attempt: MeasurementExerciseAttempt = {
    id,
    kind: "measurement",
    athleteProfileId: input.athleteProfileId,
    roleAssignmentSegmentId: context.value.roleAssignmentSegmentId,
    sequenceNumber: result.attempts.length + 1,
    ...(input.actualHandle ? { actualHandle: input.actualHandle } : {}),
    measurements: measurementResult.value,
    createdAt,
  };
  return exerciseExecutionOk(appendAttempt(execution, attempt, context.value.resultIndex, createdAt));
}

export function updatePrivateAthleteNote(
  execution: ExerciseExecution,
  athleteProfileId: string,
  note: string,
  at = new Date().toISOString()
): ExerciseExecutionOutcome<ExerciseExecution> {
  const index = execution.athleteResults.findIndex((result) => result.athleteProfileId === athleteProfileId);
  if (index < 0) return exerciseExecutionError("wrong-athlete", "An athlete may edit only their own Exercise Result note.");
  if (!validTimestamp(at)) return exerciseExecutionError("invalid-input", "The note update time is invalid.");
  const athleteResults = execution.athleteResults.map((result, resultIndex) =>
    resultIndex === index
      ? {
          ...result,
          ...(note.length > 0 ? { privateNote: note } : { privateNote: undefined }),
          updatedAt: at,
        }
      : result
  );
  return exerciseExecutionOk({ ...execution, athleteResults });
}

export function completeExerciseExecution(
  execution: ExerciseExecution,
  at = new Date().toISOString()
): ExerciseExecutionOutcome<ExerciseExecution> {
  const context = activeSoloContext(execution);
  if (!context.ok) return context;
  const attempts = execution.athleteResults[context.value.resultIndex].attempts;
  const focus = execution.exerciseVersionSnapshot.primaryFocus;
  if (focus === "shotmaking" && attempts.length === 0) {
    return exerciseExecutionError("not-completable", "A Shotmaking execution needs at least one recorded attempt.");
  }
  if (focus === "measured" && !attempts.some((attempt) => attempt.measurements.length > 0)) {
    return exerciseExecutionError("not-completable", "A Measured execution needs at least one recorded Measurement.");
  }
  if (!validTimestamp(at)) return exerciseExecutionError("invalid-input", "The completion time is invalid.");
  return exerciseExecutionOk({
    ...execution,
    status: "completed",
    completedAt: at,
    abandonedAt: undefined,
  });
}

export function abandonExerciseExecution(
  execution: ExerciseExecution,
  at = new Date().toISOString()
): ExerciseExecutionOutcome<ExerciseExecution> {
  const context = activeSoloContext(execution);
  if (!context.ok) return context;
  if (!validTimestamp(at)) return exerciseExecutionError("invalid-input", "The abandonment time is invalid.");
  return exerciseExecutionOk({
    ...execution,
    status: "abandoned",
    abandonedAt: at,
    completedAt: undefined,
  });
}
