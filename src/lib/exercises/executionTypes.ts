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
  kind:
    | "sweeper-count"
    | "sweeping-use"
    | "role-assignment"
    | "required-measurement"
    | "other";
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
  coachProfileIds?: string[];
  timekeeperProfileId?: string;
  /** Required on Team segments; absent on the legacy Solo shape. */
  sweepingUsed?: boolean;
  /** Required on Team segments; the authenticated recorder who established it. */
  recordedByProfileId?: string;
  /** Required on Team segments so planned rotation never replaces actual history. */
  transitionReason?: ExerciseRoleTransitionReason;
};

export type ExerciseRoleTransitionReason =
  | "initial"
  | "manual"
  | "after-every-stone"
  | "after-stone-count"
  | "after-series";

export type ExerciseTeamParticipant = {
  profileId: string;
  participation: "training-athlete" | "supporting";
};

export type ExerciseRotationConfiguration =
  | { kind: "fixed"; athleteOrder: string[] }
  | { kind: "after-every-stone"; athleteOrder: string[] }
  | { kind: "after-stone-count"; athleteOrder: string[]; stoneCount: number }
  | { kind: "after-series"; athleteOrder: string[] }
  | { kind: "manual"; athleteOrder: string[] };

/**
 * Stage C1's locally usable Team context. Permission state is deliberately not
 * represented as cloud authority: the server-side Stage C upload boundary must
 * authenticate and revalidate every athlete bundle independently.
 */
export type ExerciseTeamContext = {
  kind: "team";
  teamId: string;
  recorderProfileId: string;
  participantRoster: ExerciseTeamParticipant[];
  rotation: ExerciseRotationConfiguration;
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
  /** Required for Team attempts; absent on the legacy Solo shape. */
  recordedByProfileId?: string;
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
  /** Absence is the backwards-compatible Stage B Solo execution shape. */
  teamContext?: ExerciseTeamContext;
  schemaVersion: number;
};
