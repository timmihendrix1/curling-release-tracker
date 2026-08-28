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
  ExerciseActiveAttemptCorrection,
  ExerciseExecution,
  ExerciseExecutionConfiguration,
  ExerciseExecutionDeviation,
  ExerciseExecutionVolume,
  ExerciseMeasurement,
  MeasurementExerciseAttempt,
  ExerciseRoleAssignmentSegment,
  ExerciseRoleTransitionReason,
  ExerciseRotationConfiguration,
  ExerciseTeamParticipant,
  ExerciseTeamAttemptRoleContext,
  ShotmakingEvaluation,
  ShotmakingExerciseAttempt,
} from "./executionTypes";
import { EXERCISE_EXECUTION_SCHEMA_VERSION } from "./executionTypes";
import { exerciseRunnerKind, findExerciseVersion } from "./lookup";
import type { ExerciseVersion, MeasurementProtocol } from "./types";

type ExecutionClock = {
  id(): string;
  now(): string;
};

const defaultClock: ExecutionClock = {
  id: () => crypto.randomUUID(),
  now: () => new Date().toISOString(),
};

const HANDLES: readonly Handle[] = ["in", "out"];
const EXCLUSION_REASONS = [
  "external-interruption",
  "incorrect-or-displaced-setup",
  "technical-or-capture-problem",
  "outcome-not-observable",
  "other",
] as const;

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

function validTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

function protocolKey(protocol: { id: string; version: number }): string {
  return `${protocol.id}@${protocol.version}`;
}

function evaluationBasisFor(version: ExerciseVersion): ExerciseExecution["evaluationBasis"] {
  return version.primaryFocus === "shotmaking" && version.guidance.kind === "generic-shotmaking-score"
    ? version.guidance.evaluationBasis
    : "not-applicable";
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
    ...(execution.activeAttemptCorrections ?? []).map((correction) => correction.id),
  ]);
}

function trainingAthleteIds(roster: ExerciseTeamParticipant[]): string[] {
  return roster
    .filter((participant) => participant.participation === "training-athlete")
    .map((participant) => participant.profileId);
}

function validateRotation(
  rotation: ExerciseRotationConfiguration,
  athleteIds: string[]
): string | null {
  if (!Array.isArray(rotation.athleteOrder) || rotation.athleteOrder.length !== athleteIds.length) {
    return "Rotation order must contain every training athlete exactly once.";
  }
  const order = new Set(rotation.athleteOrder);
  if (
    order.size !== rotation.athleteOrder.length ||
    athleteIds.some((profileId) => !order.has(profileId))
  ) {
    return "Rotation order must contain every training athlete exactly once.";
  }
  if (
    rotation.kind === "after-stone-count" &&
    (!Number.isInteger(rotation.stoneCount) || rotation.stoneCount <= 0)
  ) {
    return "Stone-count rotation needs a positive integer interval.";
  }
  return null;
}

export type TeamRoleAssignmentInput = ExerciseTeamAttemptRoleContext;

function validateRoleAssignment(
  assignment: TeamRoleAssignmentInput,
  roster: ExerciseTeamParticipant[]
): string | null {
  const participants = new Set(roster.map((participant) => participant.profileId));
  const athletes = new Set(trainingAthleteIds(roster));
  if (!athletes.has(assignment.deliveringAthleteProfileId)) {
    return "The delivering athlete must be a selected training athlete.";
  }
  if (
    !Array.isArray(assignment.sweeperProfileIds) ||
    assignment.sweeperProfileIds.length > 2 ||
    new Set(assignment.sweeperProfileIds).size !== assignment.sweeperProfileIds.length
  ) {
    return "A role assignment may name zero, one or two distinct Sweepers.";
  }
  if (assignment.sweepingUsed && assignment.sweeperProfileIds.length === 0) {
    return "Sweeping cannot be marked as used without an assigned Sweeper.";
  }
  const assigned = [
    ...assignment.sweeperProfileIds,
    ...(assignment.skipProfileId ? [assignment.skipProfileId] : []),
    ...(assignment.observerProfileId ? [assignment.observerProfileId] : []),
    ...(assignment.coachProfileIds ?? []),
    ...(assignment.timekeeperProfileId ? [assignment.timekeeperProfileId] : []),
  ];
  if (assigned.some((profileId) => !participants.has(profileId))) {
    return "Every assigned role must belong to a confirmed Session participant.";
  }
  if (
    !Array.isArray(assignment.coachProfileIds ?? []) ||
    new Set(assignment.coachProfileIds ?? []).size !== (assignment.coachProfileIds ?? []).length
  ) {
    return "Coach role identities must be distinct.";
  }
  return null;
}

function roleIsFilled(assignment: TeamRoleAssignmentInput, role: string): boolean {
  switch (role) {
    case "delivering-athlete": return true;
    case "sweeper": return assignment.sweeperProfileIds.length > 0;
    case "skip": return assignment.skipProfileId !== undefined;
    case "observer": return assignment.observerProfileId !== undefined;
    case "coach": return (assignment.coachProfileIds?.length ?? 0) > 0;
    case "timekeeper": return assignment.timekeeperProfileId !== undefined;
    default: return false;
  }
}

function roleSegment(
  id: string,
  startedAt: string,
  recorderProfileId: string,
  assignment: TeamRoleAssignmentInput,
  transitionReason: ExerciseRoleTransitionReason
): ExerciseRoleAssignmentSegment {
  return {
    id,
    startedAt,
    deliveringAthleteProfileId: assignment.deliveringAthleteProfileId,
    sweeperProfileIds: [...assignment.sweeperProfileIds],
    ...(assignment.skipProfileId ? { skipProfileId: assignment.skipProfileId } : {}),
    ...(assignment.observerProfileId ? { observerProfileId: assignment.observerProfileId } : {}),
    ...(assignment.coachProfileIds?.length ? { coachProfileIds: [...assignment.coachProfileIds] } : {}),
    ...(assignment.timekeeperProfileId ? { timekeeperProfileId: assignment.timekeeperProfileId } : {}),
    sweepingUsed: assignment.sweepingUsed,
    recordedByProfileId: recorderProfileId,
    transitionReason,
  };
}

export type CreateTeamExerciseExecutionOptions = {
  trainingSessionId: string;
  teamId: string;
  recorderProfileId: string;
  participantRoster: ExerciseTeamParticipant[];
  initialRoleAssignment: TeamRoleAssignmentInput;
  rotation: ExerciseRotationConfiguration;
  selectedVariationId?: string;
  plannedVolume?: ExerciseExecutionVolume;
  enabledMeasurementProtocols?: MeasurementProtocol[];
  additionalDeviationNotes?: string[];
  clock?: ExecutionClock;
};

/**
 * Creates Stage C1's standalone Team aggregate. Session/cloud attachment remains
 * deliberately blocked until the Team-owned coordination and athlete-bundle
 * persistence boundary has real SQL/RLS verification.
 */
export function createTeamExerciseExecution(
  version: ExerciseVersion,
  options: CreateTeamExerciseExecutionOptions
): ExerciseExecutionOutcome<ExerciseExecution> {
  const catalogVersion = findExerciseVersion(EXERCISE_CATALOG, version.id);
  if (!catalogVersion || !sameJsonValue(version, catalogVersion)) {
    return exerciseExecutionError("invalid-input", "Team execution can start only from an immutable curated catalog Exercise Version.");
  }
  if (exerciseRunnerKind(EXERCISE_CATALOG, version) !== "exercise-execution") {
    return exerciseExecutionError("unsupported-focus", "This Exercise does not use the generic Team Exercise Execution runner.");
  }
  if (!version.participation.supportedModes.includes("team")) {
    return exerciseExecutionError("unsupported-focus", "This Exercise Version does not support Team execution.");
  }
  if (
    !isCanonicalUuid(options.trainingSessionId) ||
    !isCanonicalUuid(options.teamId) ||
    !isCanonicalUuid(options.recorderProfileId)
  ) {
    return exerciseExecutionError("invalid-input", "Team, Session and recorder Profile ids must be canonical UUIDs.");
  }
  if (!Array.isArray(options.participantRoster) || options.participantRoster.length === 0) {
    return exerciseExecutionError("invalid-input", "A Team execution needs a confirmed participant roster.");
  }
  const rosterIds = options.participantRoster.map((participant) => participant.profileId);
  if (
    rosterIds.some((profileId) => !isCanonicalUuid(profileId)) ||
    new Set(rosterIds).size !== rosterIds.length ||
    options.participantRoster.some(
      (participant) => participant.participation !== "training-athlete" && participant.participation !== "supporting"
    ) ||
    !rosterIds.includes(options.recorderProfileId)
  ) {
    return exerciseExecutionError("invalid-input", "Participants must be distinct authenticated Profiles and include the active recorder.");
  }
  const athleteIds = trainingAthleteIds(options.participantRoster);
  if (
    athleteIds.length < version.participation.minTrainingAthletes ||
    (version.participation.maxTrainingAthletes !== null && athleteIds.length > version.participation.maxTrainingAthletes)
  ) {
    return exerciseExecutionError("invalid-input", "Training-athlete count does not satisfy this Exercise Version.");
  }
  const rotationIssue = validateRotation(options.rotation, athleteIds);
  if (rotationIssue) return exerciseExecutionError("invalid-input", rotationIssue);
  const roleIssue = validateRoleAssignment(options.initialRoleAssignment, options.participantRoster);
  if (roleIssue) return exerciseExecutionError("invalid-role-assignment", roleIssue);
  if (options.rotation.athleteOrder[0] !== options.initialRoleAssignment.deliveringAthleteProfileId) {
    return exerciseExecutionError("invalid-role-assignment", "The initial delivering athlete must be first in the planned athlete order.");
  }
  if (
    options.selectedVariationId !== undefined &&
    !version.variations.some((variation) => variation.id === options.selectedVariationId)
  ) {
    return exerciseExecutionError("unsupported-variation", "The selected variation is not part of this Exercise Version.");
  }
  if (options.plannedVolume && (!Number.isInteger(options.plannedVolume.value) || options.plannedVolume.value <= 0)) {
    return exerciseExecutionError("invalid-input", "Planned execution volume must be a positive integer.");
  }

  const enabledProtocols = options.enabledMeasurementProtocols ?? [];
  const compatible = new Map(
    version.compatibleMeasurementProtocols.map((reference) => [
      `${reference.protocolId}@${reference.protocolVersion}`,
      reference,
    ])
  );
  const seenProtocols = new Set<string>();
  for (const protocol of enabledProtocols) {
    const key = protocolKey(protocol);
    const catalogProtocol = EXERCISE_CATALOG.measurementProtocols.find(
      (candidate) => protocolKey(candidate) === key
    );
    if (!compatible.has(key) || seenProtocols.has(key) || !catalogProtocol || !sameJsonValue(protocol, catalogProtocol)) {
      return exerciseExecutionError("unsupported-measurement-protocol", "Every enabled Measurement Protocol must be a unique compatible catalog protocol.");
    }
    seenProtocols.add(key);
  }
  if ([...compatible.entries()].some(([key, reference]) => reference.requirement === "required" && !seenProtocols.has(key))) {
    return exerciseExecutionError("required-measurement-protocol-missing", "This execution needs every required Measurement Protocol.");
  }

  const deviations: ExerciseExecutionDeviation[] = [];
  const sweeperCount = options.initialRoleAssignment.sweeperProfileIds.length;
  if (!version.sweeping.allowedSweeperCounts.includes(sweeperCount)) {
    deviations.push({
      kind: "sweeper-count",
      description: `The initial lineup uses ${sweeperCount} Sweepers, outside the Exercise standard.`,
    });
  }
  if (
    (version.sweeping.policy === "forbidden" && options.initialRoleAssignment.sweepingUsed) ||
    (version.sweeping.policy === "required" && !options.initialRoleAssignment.sweepingUsed)
  ) {
    deviations.push({
      kind: "sweeping-use",
      description: options.initialRoleAssignment.sweepingUsed
        ? "The initial lineup uses sweeping although the Exercise standard forbids it."
        : "The initial lineup does not use sweeping although the Exercise standard requires it.",
    });
  }
  for (const role of version.participation.roles) {
    if (role.requirement === "required" && !roleIsFilled(options.initialRoleAssignment, role.role)) {
      deviations.push({
        kind: "role-assignment",
        description: `The initial lineup omits the standard required role: ${role.role}.`,
      });
    }
  }
  for (const note of options.additionalDeviationNotes ?? []) {
    if (note.trim().length === 0) {
      return exerciseExecutionError("invalid-input", "A declared deviation note must not be blank.");
    }
    deviations.push({ kind: "other", description: note });
  }

  const clock = options.clock ?? defaultClock;
  const startedAt = clock.now();
  const ids = [clock.id(), clock.id(), ...athleteIds.map(() => clock.id())];
  if (
    !validTimestamp(startedAt) ||
    ids.some((id) => !isCanonicalUuid(id)) ||
    new Set(ids).size !== ids.length
  ) {
    return exerciseExecutionError("invalid-input", "The execution clock returned invalid identity or time data.");
  }
  const [executionId, roleSegmentId, ...resultIds] = ids;
  const configuration: ExerciseExecutionConfiguration = {
    ...(options.selectedVariationId ? { selectedVariationId: options.selectedVariationId } : {}),
    ...(options.plannedVolume ? { plannedVolume: clone(options.plannedVolume) } : {}),
    sweeperCount,
    sweepingUsed: options.initialRoleAssignment.sweepingUsed,
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
      roleSegment(roleSegmentId, startedAt, options.recorderProfileId, options.initialRoleAssignment, "initial"),
    ],
    athleteResults: athleteIds.map((athleteProfileId, index) => ({
      id: resultIds[index],
      athleteProfileId,
      attempts: [],
      createdAt: startedAt,
      updatedAt: startedAt,
    })),
    activeAttemptCorrections: [],
    teamContext: {
      kind: "team",
      teamId: options.teamId,
      recorderProfileId: options.recorderProfileId,
      participantRoster: clone(options.participantRoster),
      rotation: clone(options.rotation),
    },
    schemaVersion: EXERCISE_EXECUTION_SCHEMA_VERSION,
  });
}

function activeTeamContext(execution: ExerciseExecution): ExerciseExecutionOutcome<{
  participantIds: Set<string>;
  activeSegment: ExerciseRoleAssignmentSegment;
}> {
  if (!execution.teamContext || execution.teamContext.kind !== "team") {
    return exerciseExecutionError("invalid-input", "This operation requires a Team Exercise Execution.");
  }
  if (execution.status !== "in-progress") {
    return exerciseExecutionError("execution-not-active", "A terminal Team Exercise Execution cannot be changed.");
  }
  const activeSegment = execution.roleAssignmentSegments.at(-1);
  if (!activeSegment) {
    return exerciseExecutionError("invalid-input", "The Team execution has no active role assignment.");
  }
  return exerciseExecutionOk({
    participantIds: new Set(execution.teamContext.participantRoster.map((participant) => participant.profileId)),
    activeSegment,
  });
}

function nextAthlete(rotation: ExerciseRotationConfiguration, currentProfileId: string): string {
  const currentIndex = rotation.athleteOrder.indexOf(currentProfileId);
  return rotation.athleteOrder[(currentIndex + 1) % rotation.athleteOrder.length];
}

export type TeamRotationRecommendation = {
  reason: "after-every-stone" | "after-stone-count";
  nextAthleteProfileId: string;
};

/** Planned rotation is an interface recommendation; actual segments remain history. */
export function getTeamRotationRecommendation(
  execution: ExerciseExecution
): TeamRotationRecommendation | null {
  if (!execution.teamContext || execution.status !== "in-progress") return null;
  const activeSegment = execution.roleAssignmentSegments.at(-1);
  if (!activeSegment) return null;
  const attemptsInSegment = execution.athleteResults.flatMap((result) => result.attempts)
    .filter((attempt) => attempt.roleAssignmentSegmentId === activeSegment.id).length;
  const rotation = execution.teamContext.rotation;
  if (rotation.kind === "after-every-stone" && attemptsInSegment >= 1) {
    return { reason: rotation.kind, nextAthleteProfileId: nextAthlete(rotation, activeSegment.deliveringAthleteProfileId) };
  }
  if (rotation.kind === "after-stone-count" && attemptsInSegment >= rotation.stoneCount) {
    return { reason: rotation.kind, nextAthleteProfileId: nextAthlete(rotation, activeSegment.deliveringAthleteProfileId) };
  }
  return null;
}

export type ChangeTeamRoleAssignmentInput = {
  recorderProfileId: string;
  assignment: TeamRoleAssignmentInput;
  reason: Exclude<ExerciseRoleTransitionReason, "initial">;
  clock?: ExecutionClock;
};

export function changeTeamRoleAssignment(
  execution: ExerciseExecution,
  input: ChangeTeamRoleAssignmentInput
): ExerciseExecutionOutcome<ExerciseExecution> {
  const context = activeTeamContext(execution);
  if (!context.ok) return context;
  const teamContext = execution.teamContext;
  if (!teamContext || input.recorderProfileId !== teamContext.recorderProfileId) {
    return exerciseExecutionError("wrong-recorder", "Only the authenticated active recorder may change Team roles.");
  }
  const roleIssue = validateRoleAssignment(input.assignment, teamContext.participantRoster);
  if (roleIssue) return exerciseExecutionError("invalid-role-assignment", roleIssue);

  const rotation = teamContext.rotation;
  if (input.reason !== "manual") {
    if (rotation.kind !== input.reason) {
      return exerciseExecutionError("invalid-role-assignment", "Role transition reason does not match the planned rotation.");
    }
    if (input.reason === "after-every-stone" || input.reason === "after-stone-count") {
      const recommendation = getTeamRotationRecommendation(execution);
      if (!recommendation || recommendation.nextAthleteProfileId !== input.assignment.deliveringAthleteProfileId) {
        return exerciseExecutionError("rotation-not-due", "The planned rotation is not due for this athlete yet.");
      }
    } else if (
      input.reason === "after-series" &&
      nextAthlete(rotation, context.value.activeSegment.deliveringAthleteProfileId) !==
        input.assignment.deliveringAthleteProfileId
    ) {
      return exerciseExecutionError("invalid-role-assignment", "Series rotation must advance to the next planned athlete.");
    }
  }
  const candidateComparable = {
    deliveringAthleteProfileId: context.value.activeSegment.deliveringAthleteProfileId,
    sweeperProfileIds: context.value.activeSegment.sweeperProfileIds,
    skipProfileId: context.value.activeSegment.skipProfileId,
    observerProfileId: context.value.activeSegment.observerProfileId,
    coachProfileIds: context.value.activeSegment.coachProfileIds,
    timekeeperProfileId: context.value.activeSegment.timekeeperProfileId,
    sweepingUsed: context.value.activeSegment.sweepingUsed,
  };
  const normalizedAssignment = {
    deliveringAthleteProfileId: input.assignment.deliveringAthleteProfileId,
    sweeperProfileIds: input.assignment.sweeperProfileIds,
    ...(input.assignment.skipProfileId ? { skipProfileId: input.assignment.skipProfileId } : {}),
    ...(input.assignment.observerProfileId ? { observerProfileId: input.assignment.observerProfileId } : {}),
    ...(input.assignment.coachProfileIds?.length
      ? { coachProfileIds: input.assignment.coachProfileIds }
      : {}),
    ...(input.assignment.timekeeperProfileId ? { timekeeperProfileId: input.assignment.timekeeperProfileId } : {}),
    sweepingUsed: input.assignment.sweepingUsed,
  };
  if (sameJsonValue(candidateComparable, normalizedAssignment)) {
    return exerciseExecutionError("invalid-role-assignment", "A new role segment must record an actual lineup change.");
  }

  const clock = input.clock ?? defaultClock;
  const id = clock.id();
  const startedAt = clock.now();
  const latestAttemptAt = execution.athleteResults
    .flatMap((result) => result.attempts)
    .filter((attempt) => attempt.roleAssignmentSegmentId === context.value.activeSegment.id)
    .reduce<string | undefined>(
      (latest, attempt) => latest === undefined || Date.parse(attempt.createdAt) > Date.parse(latest)
        ? attempt.createdAt
        : latest,
      undefined
    );
  if (
    !isCanonicalUuid(id) ||
    aggregateIds(execution).has(id) ||
    !validTimestamp(startedAt) ||
    Date.parse(startedAt) <= Date.parse(context.value.activeSegment.startedAt) ||
    (latestAttemptAt !== undefined && Date.parse(startedAt) <= Date.parse(latestAttemptAt))
  ) {
    return exerciseExecutionError("invalid-input", "The role transition clock returned invalid or non-monotonic data.");
  }
  return exerciseExecutionOk({
    ...execution,
    roleAssignmentSegments: [
      ...execution.roleAssignmentSegments,
      roleSegment(id, startedAt, input.recorderProfileId, input.assignment, input.reason),
    ],
  });
}

function validateTeamMeasurements(
  execution: ExerciseExecution,
  measurements: ExerciseMeasurement[],
  reservedIds: Set<string>,
  participants: Set<string>
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
      (protocol.metricType === "rotation-count" && !Number.isInteger(measurement.value * 2)) ||
      !protocol.allowedSources.includes(measurement.source) ||
      !validTimestamp(measurement.recordedAt) ||
      (measurement.observerProfileId !== undefined && !participants.has(measurement.observerProfileId))
    ) {
      return exerciseExecutionError("invalid-attempt", "The attempt contains an invalid, unauthorised or unsupported Measurement.");
    }
    ids.add(measurement.id);
  }
  return exerciseExecutionOk(clone(measurements));
}

export type AddTeamShotmakingAttemptInput = {
  recorderProfileId: string;
  athleteProfileId: string;
  intendedHandle?: Handle;
  actualHandle: Handle;
  evaluation: ShotmakingEvaluation;
  measurements?: ExerciseMeasurement[];
  clock?: ExecutionClock;
};

export function addTeamShotmakingAttempt(
  execution: ExerciseExecution,
  input: AddTeamShotmakingAttemptInput
): ExerciseExecutionOutcome<ExerciseExecution> {
  if (execution.exerciseVersionSnapshot.primaryFocus !== "shotmaking") {
    return exerciseExecutionError("unsupported-focus", "Only a Shotmaking Exercise can receive a Shotmaking attempt.");
  }
  const context = activeTeamContext(execution);
  if (!context.ok) return context;
  if (!execution.teamContext || input.recorderProfileId !== execution.teamContext.recorderProfileId) {
    return exerciseExecutionError("wrong-recorder", "Only the authenticated active recorder may add a Team attempt.");
  }
  if (input.athleteProfileId !== context.value.activeSegment.deliveringAthleteProfileId) {
    return exerciseExecutionError("wrong-athlete", "The attempt must belong to the athlete delivering in the active role segment.");
  }
  if (!HANDLES.includes(input.actualHandle) ||
      (input.intendedHandle !== undefined && !HANDLES.includes(input.intendedHandle))) {
    return exerciseExecutionError("invalid-attempt", "Shotmaking handles must be In- or Outhandle.");
  }
  if (
    input.evaluation.status === "scored"
      ? !Number.isInteger(input.evaluation.score) || input.evaluation.score < 0 || input.evaluation.score > 4
      : !EXCLUSION_REASONS.includes(input.evaluation.reason) ||
        (input.evaluation.reason === "other" && !input.evaluation.explanation?.trim())
  ) {
    return exerciseExecutionError("invalid-attempt", "Shotmaking evaluation is invalid.");
  }
  const resultIndex = execution.athleteResults.findIndex(
    (result) => result.athleteProfileId === input.athleteProfileId
  );
  if (resultIndex < 0) {
    return exerciseExecutionError("wrong-athlete", "The delivering athlete has no Athlete Exercise Result.");
  }

  const clock = input.clock ?? defaultClock;
  const id = clock.id();
  const createdAt = clock.now();
  const reservedIds = aggregateIds(execution);
  if (
    !isCanonicalUuid(id) ||
    reservedIds.has(id) ||
    !validTimestamp(createdAt) ||
    Date.parse(createdAt) < Date.parse(context.value.activeSegment.startedAt)
  ) {
    return exerciseExecutionError("invalid-input", "The attempt clock returned invalid identity or time data.");
  }
  reservedIds.add(id);
  const measurementResult = validateTeamMeasurements(
    execution,
    input.measurements ?? [],
    reservedIds,
    context.value.participantIds
  );
  if (!measurementResult.ok) return measurementResult;
  const athleteResult = execution.athleteResults[resultIndex];
  const attempt: ShotmakingExerciseAttempt = {
    id,
    kind: "shotmaking",
    athleteProfileId: input.athleteProfileId,
    roleAssignmentSegmentId: context.value.activeSegment.id,
    sequenceNumber: athleteResult.attempts.reduce(
      (maximum, candidate) => Math.max(maximum, candidate.sequenceNumber),
      0
    ) + 1,
    ...(input.intendedHandle ? { intendedHandle: input.intendedHandle } : {}),
    actualHandle: input.actualHandle,
    evaluation: clone(input.evaluation),
    measurements: measurementResult.value,
    createdAt,
    recordedByProfileId: input.recorderProfileId,
  };
  return exerciseExecutionOk({
    ...execution,
    athleteResults: execution.athleteResults.map((result, index) =>
      index === resultIndex
        ? { ...result, attempts: [...result.attempts, attempt], updatedAt: createdAt }
        : result
    ),
  });
}

export type AddTeamMeasurementAttemptInput = {
  recorderProfileId: string;
  athleteProfileId: string;
  actualHandle?: Handle;
  measurements: ExerciseMeasurement[];
  clock?: ExecutionClock;
};

/** Records one factual Measured-Exercise observation for the active deliverer. */
export function addTeamMeasurementAttempt(
  execution: ExerciseExecution,
  input: AddTeamMeasurementAttemptInput
): ExerciseExecutionOutcome<ExerciseExecution> {
  if (execution.exerciseVersionSnapshot.primaryFocus !== "measured") {
    return exerciseExecutionError(
      "unsupported-focus",
      "Only a Measured Exercise can receive a Measurement attempt."
    );
  }
  const context = activeTeamContext(execution);
  if (!context.ok) return context;
  if (
    !execution.teamContext ||
    input.recorderProfileId !== execution.teamContext.recorderProfileId
  ) {
    return exerciseExecutionError(
      "wrong-recorder",
      "Only the authenticated active recorder may add a Team attempt."
    );
  }
  if (
    input.athleteProfileId !==
    context.value.activeSegment.deliveringAthleteProfileId
  ) {
    return exerciseExecutionError(
      "wrong-athlete",
      "The attempt must belong to the athlete delivering in the active role segment."
    );
  }
  if (
    input.actualHandle !== undefined &&
    !HANDLES.includes(input.actualHandle)
  ) {
    return exerciseExecutionError(
      "invalid-attempt",
      "Attempt handle must be In- or Outhandle."
    );
  }
  if (input.measurements.length === 0) {
    return exerciseExecutionError(
      "invalid-attempt",
      "A Measurement attempt needs at least one Measurement."
    );
  }
  const resultIndex = execution.athleteResults.findIndex(
    (result) => result.athleteProfileId === input.athleteProfileId
  );
  if (resultIndex < 0) {
    return exerciseExecutionError(
      "wrong-athlete",
      "The delivering athlete has no Athlete Exercise Result."
    );
  }
  const clock = input.clock ?? defaultClock;
  const id = clock.id();
  const createdAt = clock.now();
  const reservedIds = aggregateIds(execution);
  if (
    !isCanonicalUuid(id) ||
    reservedIds.has(id) ||
    !validTimestamp(createdAt) ||
    Date.parse(createdAt) < Date.parse(context.value.activeSegment.startedAt)
  ) {
    return exerciseExecutionError(
      "invalid-input",
      "The attempt clock returned invalid identity or time data."
    );
  }
  reservedIds.add(id);
  const measurementResult = validateTeamMeasurements(
    execution,
    input.measurements,
    reservedIds,
    context.value.participantIds
  );
  if (!measurementResult.ok) return measurementResult;
  const athleteResult = execution.athleteResults[resultIndex];
  const attempt: MeasurementExerciseAttempt = {
    id,
    kind: "measurement",
    athleteProfileId: input.athleteProfileId,
    roleAssignmentSegmentId: context.value.activeSegment.id,
    sequenceNumber:
      athleteResult.attempts.reduce(
        (maximum, candidate) => Math.max(maximum, candidate.sequenceNumber),
        0
      ) + 1,
    ...(input.actualHandle ? { actualHandle: input.actualHandle } : {}),
    measurements: measurementResult.value,
    createdAt,
    recordedByProfileId: input.recorderProfileId,
  };
  return exerciseExecutionOk({
    ...execution,
    athleteResults: execution.athleteResults.map((result, index) =>
      index === resultIndex
        ? { ...result, attempts: [...result.attempts, attempt], updatedAt: createdAt }
        : result
    ),
  });
}

export function getTeamAttemptRoleContext(
  execution: ExerciseExecution,
  attempt: ShotmakingExerciseAttempt
): ExerciseTeamAttemptRoleContext | null {
  if (attempt.teamRoleContextOverride) return clone(attempt.teamRoleContextOverride);
  const segment = execution.roleAssignmentSegments.find(
    (candidate) => candidate.id === attempt.roleAssignmentSegmentId
  );
  if (!segment || segment.sweepingUsed === undefined) return null;
  return {
    deliveringAthleteProfileId: segment.deliveringAthleteProfileId,
    sweeperProfileIds: [...segment.sweeperProfileIds],
    ...(segment.skipProfileId ? { skipProfileId: segment.skipProfileId } : {}),
    ...(segment.observerProfileId ? { observerProfileId: segment.observerProfileId } : {}),
    ...(segment.coachProfileIds?.length ? { coachProfileIds: [...segment.coachProfileIds] } : {}),
    ...(segment.timekeeperProfileId ? { timekeeperProfileId: segment.timekeeperProfileId } : {}),
    sweepingUsed: segment.sweepingUsed,
  };
}

function withoutRoleOverrideWhenCaptured(
  execution: ExerciseExecution,
  attempt: ShotmakingExerciseAttempt,
  roleContext: ExerciseTeamAttemptRoleContext
): ShotmakingExerciseAttempt {
  const segment = execution.roleAssignmentSegments.find(
    (candidate) => candidate.id === attempt.roleAssignmentSegmentId
  );
  const captured = segment && segment.sweepingUsed !== undefined
    ? {
        deliveringAthleteProfileId: segment.deliveringAthleteProfileId,
        sweeperProfileIds: segment.sweeperProfileIds,
        skipProfileId: segment.skipProfileId,
        observerProfileId: segment.observerProfileId,
        coachProfileIds: segment.coachProfileIds,
        timekeeperProfileId: segment.timekeeperProfileId,
        sweepingUsed: segment.sweepingUsed,
      }
    : null;
  if (captured && sameJsonValue(captured, roleContext)) {
    const rest = { ...attempt };
    delete rest.teamRoleContextOverride;
    return rest;
  }
  return { ...attempt, teamRoleContextOverride: clone(roleContext) };
}

export type CorrectTeamShotmakingAttemptInput = {
  recorderProfileId: string;
  attemptId: string;
  athleteProfileId: string;
  actualHandle: Handle;
  evaluation: ShotmakingEvaluation;
  measurements: ExerciseMeasurement[];
  roleContext: ExerciseTeamAttemptRoleContext;
  clock?: ExecutionClock;
};

function findTeamShotmakingAttempt(execution: ExerciseExecution, attemptId: string): {
  resultIndex: number;
  attemptIndex: number;
  attempt: ShotmakingExerciseAttempt;
} | null {
  for (let resultIndex = 0; resultIndex < execution.athleteResults.length; resultIndex += 1) {
    const attemptIndex = execution.athleteResults[resultIndex].attempts.findIndex(
      (candidate) => candidate.id === attemptId
    );
    if (attemptIndex < 0) continue;
    const attempt = execution.athleteResults[resultIndex].attempts[attemptIndex];
    return attempt.kind === "shotmaking" ? { resultIndex, attemptIndex, attempt } : null;
  }
  return null;
}

function correctionClock(
  execution: ExerciseExecution,
  attempt: ShotmakingExerciseAttempt,
  clock: ExecutionClock
): ExerciseExecutionOutcome<{ id: string; at: string }> {
  const id = clock.id();
  const at = clock.now();
  const latestCorrectionAt = (execution.activeAttemptCorrections ?? []).at(-1)?.correctedAt;
  const latestActivityAt = [
    execution.startedAt,
    ...execution.roleAssignmentSegments.map((segment) => segment.startedAt),
    ...execution.athleteResults.flatMap((result) => result.attempts.map((candidate) => candidate.createdAt)),
  ].reduce((latest, candidate) => Date.parse(candidate) > Date.parse(latest) ? candidate : latest);
  if (
    !isCanonicalUuid(id) ||
    aggregateIds(execution).has(id) ||
    (execution.activeAttemptCorrections ?? []).some((correction) => correction.id === id) ||
    !validTimestamp(at) ||
    Date.parse(at) < Date.parse(latestActivityAt) ||
    (latestCorrectionAt !== undefined && Date.parse(at) <= Date.parse(latestCorrectionAt))
  ) {
    return exerciseExecutionError("invalid-input", "The correction clock returned invalid or non-monotonic data.");
  }
  return exerciseExecutionOk({ id, at });
}

/** Corrects current facts while retaining the exact before/after attempt in an append-only audit. */
export function correctTeamShotmakingAttempt(
  execution: ExerciseExecution,
  input: CorrectTeamShotmakingAttemptInput
): ExerciseExecutionOutcome<ExerciseExecution> {
  const context = activeTeamContext(execution);
  if (!context.ok) return context;
  if (!execution.teamContext || input.recorderProfileId !== execution.teamContext.recorderProfileId) {
    return exerciseExecutionError("wrong-recorder", "Only the authenticated active recorder may correct a Team attempt.");
  }
  const found = findTeamShotmakingAttempt(execution, input.attemptId);
  if (!found) return exerciseExecutionError("invalid-attempt", "The active Team attempt was not found.");
  if (input.roleContext.deliveringAthleteProfileId !== input.athleteProfileId) {
    return exerciseExecutionError("invalid-role-assignment", "The corrected delivering athlete and attempt owner must match.");
  }
  const roleIssue = validateRoleAssignment(input.roleContext, execution.teamContext.participantRoster);
  if (roleIssue) return exerciseExecutionError("invalid-role-assignment", roleIssue);
  if (!HANDLES.includes(input.actualHandle) || (
    input.evaluation.status === "scored"
      ? !Number.isInteger(input.evaluation.score) || input.evaluation.score < 0 || input.evaluation.score > 4
      : !EXCLUSION_REASONS.includes(input.evaluation.reason) ||
        (input.evaluation.reason === "other" && !input.evaluation.explanation?.trim())
  )) return exerciseExecutionError("invalid-attempt", "The corrected Shotmaking facts are invalid.");
  const targetResultIndex = execution.athleteResults.findIndex(
    (result) => result.athleteProfileId === input.athleteProfileId
  );
  if (targetResultIndex < 0) return exerciseExecutionError("wrong-athlete", "The corrected athlete has no Athlete Exercise Result.");
  const measurementResult = validateTeamMeasurements(
    execution,
    input.measurements,
    new Set([...aggregateIds(execution)].filter((id) => !found.attempt.measurements.some((measurement) => measurement.id === id))),
    context.value.participantIds
  );
  if (!measurementResult.ok) return measurementResult;

  const targetSequence = found.resultIndex === targetResultIndex
    ? found.attempt.sequenceNumber
    : execution.athleteResults[targetResultIndex].attempts.reduce(
        (maximum, candidate) => Math.max(maximum, candidate.sequenceNumber),
        0
      ) + 1;
  const candidate = withoutRoleOverrideWhenCaptured(execution, {
    ...found.attempt,
    athleteProfileId: input.athleteProfileId,
    sequenceNumber: targetSequence,
    actualHandle: input.actualHandle,
    evaluation: clone(input.evaluation),
    measurements: measurementResult.value,
  }, input.roleContext);
  if (sameJsonValue(found.attempt, candidate)) {
    return exerciseExecutionError("invalid-attempt", "A correction must change at least one captured fact.");
  }
  const clockResult = correctionClock(execution, found.attempt, input.clock ?? defaultClock);
  if (!clockResult.ok) return clockResult;
  if (measurementResult.value.some((measurement) =>
    Date.parse(measurement.recordedAt) > Date.parse(clockResult.value.at)
  )) {
    return exerciseExecutionError("invalid-attempt", "A corrected Measurement cannot be recorded after the correction time.");
  }
  const correction: ExerciseActiveAttemptCorrection = {
    id: clockResult.value.id,
    kind: "updated",
    attemptId: found.attempt.id,
    correctedByProfileId: input.recorderProfileId,
    correctedAt: clockResult.value.at,
    before: clone(found.attempt),
    after: clone(candidate),
  };
  const resultsWithoutAttempt = execution.athleteResults.map((result) => ({
    ...result,
    attempts: result.attempts.filter((attempt) => attempt.id !== found.attempt.id),
  }));
  return exerciseExecutionOk({
    ...execution,
    schemaVersion: EXERCISE_EXECUTION_SCHEMA_VERSION,
    athleteResults: resultsWithoutAttempt.map((result, index) => index === targetResultIndex
      ? { ...result, attempts: [...result.attempts, candidate].sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)), updatedAt: clockResult.value.at }
      : index === found.resultIndex ? { ...result, updatedAt: clockResult.value.at } : result),
    activeAttemptCorrections: [...(execution.activeAttemptCorrections ?? []), correction],
  });
}

/** Excludes an accidentally recorded attempt from current results without erasing its provenance. */
export function annulTeamShotmakingAttempt(
  execution: ExerciseExecution,
  recorderProfileId: string,
  attemptId: string,
  clock: ExecutionClock = defaultClock
): ExerciseExecutionOutcome<ExerciseExecution> {
  const context = activeTeamContext(execution);
  if (!context.ok) return context;
  if (!execution.teamContext || recorderProfileId !== execution.teamContext.recorderProfileId) {
    return exerciseExecutionError("wrong-recorder", "Only the authenticated active recorder may annul a Team attempt.");
  }
  const found = findTeamShotmakingAttempt(execution, attemptId);
  if (!found) return exerciseExecutionError("invalid-attempt", "The active Team attempt was not found.");
  const clockResult = correctionClock(execution, found.attempt, clock);
  if (!clockResult.ok) return clockResult;
  const correction: ExerciseActiveAttemptCorrection = {
    id: clockResult.value.id,
    kind: "annulled",
    attemptId: found.attempt.id,
    correctedByProfileId: recorderProfileId,
    correctedAt: clockResult.value.at,
    before: clone(found.attempt),
  };
  return exerciseExecutionOk({
    ...execution,
    schemaVersion: EXERCISE_EXECUTION_SCHEMA_VERSION,
    athleteResults: execution.athleteResults.map((result, index) => index === found.resultIndex
      ? {
          ...result,
          attempts: result.attempts.filter((attempt) => attempt.id !== found.attempt.id),
          updatedAt: clockResult.value.at,
        }
      : result),
    activeAttemptCorrections: [...(execution.activeAttemptCorrections ?? []), correction],
  });
}

export function completeTeamExerciseExecution(
  execution: ExerciseExecution,
  recorderProfileId: string,
  at = new Date().toISOString()
): ExerciseExecutionOutcome<ExerciseExecution> {
  const context = activeTeamContext(execution);
  if (!context.ok) return context;
  if (!execution.teamContext || recorderProfileId !== execution.teamContext.recorderProfileId) {
    return exerciseExecutionError("wrong-recorder", "Only the authenticated active recorder may complete the Team execution.");
  }
  const attempts = execution.athleteResults.flatMap((result) => result.attempts);
  if (
    (execution.exerciseVersionSnapshot.primaryFocus === "shotmaking" ||
      execution.exerciseVersionSnapshot.primaryFocus === "measured") &&
    attempts.length === 0
  ) {
    return exerciseExecutionError("not-completable", "This execution needs at least one recorded attempt.");
  }
  const latestActivityAt = [
    execution.startedAt,
    ...execution.roleAssignmentSegments.map((segment) => segment.startedAt),
    ...attempts.map((attempt) => attempt.createdAt),
  ].reduce((latest, candidate) => Date.parse(candidate) > Date.parse(latest) ? candidate : latest);
  if (!validTimestamp(at) || Date.parse(at) < Date.parse(latestActivityAt)) {
    return exerciseExecutionError("invalid-input", "The completion time is invalid.");
  }
  return exerciseExecutionOk({
    ...execution,
    status: "completed",
    completedAt: at,
    abandonedAt: undefined,
  });
}

export function abandonTeamExerciseExecution(
  execution: ExerciseExecution,
  recorderProfileId: string,
  at = new Date().toISOString()
): ExerciseExecutionOutcome<ExerciseExecution> {
  const context = activeTeamContext(execution);
  if (!context.ok) return context;
  if (!execution.teamContext || recorderProfileId !== execution.teamContext.recorderProfileId) {
    return exerciseExecutionError("wrong-recorder", "Only the authenticated active recorder may abandon the Team execution.");
  }
  const latestActivityAt = [
    execution.startedAt,
    ...execution.roleAssignmentSegments.map((segment) => segment.startedAt),
    ...execution.athleteResults.flatMap((result) => result.attempts.map((attempt) => attempt.createdAt)),
  ].reduce((latest, candidate) => Date.parse(candidate) > Date.parse(latest) ? candidate : latest);
  if (!validTimestamp(at) || Date.parse(at) < Date.parse(latestActivityAt)) {
    return exerciseExecutionError("invalid-input", "The abandonment time is invalid.");
  }
  return exerciseExecutionOk({
    ...execution,
    status: "abandoned",
    abandonedAt: at,
    completedAt: undefined,
  });
}

/** Team attempt order is per athlete, while this helper provides rink chronology. */
export function listTeamAttemptsInRecordingOrder(execution: ExerciseExecution): ExerciseAttempt[] {
  return execution.athleteResults
    .flatMap((result) => result.attempts)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
}
