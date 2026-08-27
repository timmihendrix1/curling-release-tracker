import type { Handle, TimingProviderType } from "../../types";
import type { ExerciseVersion, MeasurementProtocol } from "./types";

export const EXERCISE_EXECUTION_SCHEMA_VERSION = 1;

export type ExerciseExecutionStatus = "in-progress" | "completed" | "abandoned";
export type ExerciseEvaluationBasis = "not-applicable" | "team-defined-unstructured";

export type ExerciseExecutionVolume = {
  kind: "stones" | "repetitions";
  value: number;
};
export type ExerciseExecutionDeviation = {
  kind: "sweeper-count" | "sweeping-use" | "required-measurement" | "other";
  description: string;
};

/** What was actually selected at start, kept separately from the immutable standard. */
export type ExerciseExecutionConfiguration = {
  selectedVariationId?: string;
  plannedVolume?: ExerciseExecutionVolume;
  sweeperCount: number;
  sweepingUsed: boolean;
  enabledMeasurementProtocols: MeasurementProtocol[];
  deviations: ExerciseExecutionDeviation[];
};

export type ExerciseRoleAssignmentSegment = {
  id: string;
  startedAt: string;
  deliveringAthleteProfileId: string;
  sweeperProfileIds: string[];
  skipProfileId?: string;
  observerProfileId?: string;
  timekeeperProfileId?: string;
};

export type ExerciseMeasurement = {
  id: string;
  protocolId: string;
  protocolVersion: number;
  value: number;
  source: TimingProviderType;
  recordedAt: string;
  observerProfileId?: string;
  timingResultId?: string;
  deviceId?: string;
  laneId?: string;
};

export type ShotmakingExclusionReason =
  | "external-interruption"
  | "incorrect-or-displaced-setup"
  | "technical-or-capture-problem"
  | "outcome-not-observable"
  | "other";

export type ShotmakingEvaluation =
  | { status: "scored"; score: 0 | 1 | 2 | 3 | 4 }
  | {
      status: "excluded";
      reason: ShotmakingExclusionReason;
      explanation?: string;
    };

type ExerciseAttemptBase = {
  id: string;
  athleteProfileId: string;
  roleAssignmentSegmentId: string;
  sequenceNumber: number;
  createdAt: string;
};

export type ShotmakingExerciseAttempt = ExerciseAttemptBase & {
  kind: "shotmaking";
  intendedHandle?: Handle;
  actualHandle: Handle;
  evaluation: ShotmakingEvaluation;
  measurements: ExerciseMeasurement[];
};

export type MeasurementExerciseAttempt = ExerciseAttemptBase & {
  kind: "measurement";
  actualHandle?: Handle;
  measurements: ExerciseMeasurement[];
};

export type ExerciseAttempt = ShotmakingExerciseAttempt | MeasurementExerciseAttempt;

export type AthleteExerciseResult = {
  id: string;
  athleteProfileId: string;
  attempts: ExerciseAttempt[];
  privateNote?: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * One actual performance of one immutable Exercise Version. Stage B1 keeps this
 * aggregate independent of the existing release-timing Session until the next
 * integration slice decides how the two execution forms coexist in the app shell.
 */
export type ExerciseExecution = {
  id: string;
  trainingSessionId: string;
  exerciseVersionSnapshot: ExerciseVersion;
  evaluationBasis: ExerciseEvaluationBasis;
  configuration: ExerciseExecutionConfiguration;
  status: ExerciseExecutionStatus;
  startedAt: string;
  completedAt?: string;
  abandonedAt?: string;
  roleAssignmentSegments: ExerciseRoleAssignmentSegment[];
  athleteResults: AthleteExerciseResult[];
  schemaVersion: number;
};
