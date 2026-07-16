// Assessment domain types — Phase A (Assessment Foundation).
//
// Assessments are a distinct domain from Training Sessions (see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md, the authoritative
// source for the product/domain rules these types encode). An AssessmentRun
// must never be represented as, or substituted by, an ordinary Session/
// TrainingBlock/Shot — see docs/adr/0010-assessment-domain-foundation.md.
//
// Shared concepts with identical semantics (Handle, ShotType, MeasurementMode,
// TimingProviderType, the {onTarget, acceptable} threshold shape) are reused
// directly from the existing Training domain per that spec's "Reuse
// infrastructure, not semantics" principle — see src/types/index.ts and
// src/lib/accuracyThresholds.ts.
import type {
  AccuracyThresholds,
  Handle,
  MeasurementMode,
  ShotType,
  TimingProviderType,
} from "../../types";
import type { AccuracyThresholdPreset } from "../accuracyThresholds";

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export type AssessmentTemplateType = "official" | "custom";

export type AssessmentTemplateStatus = "draft" | "published" | "retired";

export type PlannedAssessmentShotPhase = "warmup" | "scored";

/**
 * One entry in a Template's fixed, deterministic shot sequence. Never
 * dynamically randomised or regenerated — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 4. Distinct
 * from a Training Block's `pendingTargetTime` (mutable, session-specific) —
 * see docs/DOMAIN_GLOSSARY.md.
 */
export type PlannedAssessmentShot = {
  /** Stable, deterministic within an official template (see templates.ts). */
  id: string;
  /** 0-based index across the run's *entire* planned sequence (warm-up + all blocks). */
  sequenceIndex: number;
  /** The block this shot belongs to, or null for a warm-up shot (warm-up has no block). */
  blockId: string | null;
  /** 0-based index within its own block (or within the warm-up group). */
  blockSequenceIndex: number;
  targetTime: number;
  expectedHandle: Handle;
  shotType: ShotType;
  measurementMode: MeasurementMode;
  phase: PlannedAssessmentShotPhase;
};

export type AssessmentBlockDefinition = {
  id: string;
  name: string;
  purpose: string;
  sequenceIndex: number;
  plannedShots: PlannedAssessmentShot[];
  explanation?: string;
};

export type AssessmentValidityRules = {
  /** See docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 12: max 2 invalid repeats per planned shot. */
  maxInvalidRepeatsPerShot: number;
};

export type AssessmentRepeatRules = {
  /** Invalid attempts never count toward a planned shot's completion — kept explicit rather than assumed. */
  invalidAttemptsCountTowardCompletion: boolean;
};

export type AssessmentTemplateProtocolMetadata = {
  warmupShotCount: number;
  scoredShotCount: number;
};

/**
 * Immutable after publication (`status: "published"`) — a protocol semantic
 * change requires a new `version`, never an in-place edit. Custom templates
 * are type-prepared here but have no editor UI in Phase A.
 */
export type AssessmentTemplate = {
  id: string;
  name: string;
  version: number;
  type: AssessmentTemplateType;
  description: string;
  status: AssessmentTemplateStatus;
  measurementMode: MeasurementMode;
  shotType: ShotType;
  warmupShots: PlannedAssessmentShot[];
  blocks: AssessmentBlockDefinition[];
  validityRules: AssessmentValidityRules;
  repeatRules: AssessmentRepeatRules;
  estimatedDurationMinutes: { min: number; max: number };
  /** A recommendation only — never silently applied; the caller creating a run must pass an explicit AccuracyThresholdSet. */
  recommendedThresholds: AccuracyThresholdPreset;
  protocolMetadata: AssessmentTemplateProtocolMetadata;
};

// ---------------------------------------------------------------------------
// Accuracy Threshold Set — richer than Training's AccuracyThresholds: carries
// preset type, provenance and selection time, since it must be snapshotted
// per run and later compared against a separately-selected Comparison
// Threshold Set (see thresholds.ts).
// ---------------------------------------------------------------------------

export type AccuracyThresholdSetSource = "default" | "athlete-selected" | "coach-selected";

export type AccuracyThresholdSet = {
  type: AccuracyThresholdPreset;
  values: AccuracyThresholds;
  /** Reserved for future preset versioning (e.g. "standard-v1"); unset for Phase A's fixed presets. */
  presetId?: string;
  source: AccuracyThresholdSetSource;
  /** ISO timestamp of selection — associated with run start when used as a Run Threshold Snapshot. */
  selectedAt: string;
};

// ---------------------------------------------------------------------------
// Attempts, Protocol Deviations
// ---------------------------------------------------------------------------

export type AssessmentAttemptStatus = "valid" | "invalid";

export type InvalidAttemptReason =
  | "first_gate_missing"
  | "second_gate_missing"
  | "duplicate_result"
  | "corrupted_timing"
  | "external_trigger"
  | "provider_failure"
  | "app_failure"
  | "external_interruption"
  | "other";

export type ProtocolDeviationType =
  | "wrong_handle"
  | "non_standard_warmup"
  | "resumed_after_reload"
  | "long_interruption"
  | "manual_override"
  | "other";

export type ProtocolDeviation = {
  id: string;
  type: ProtocolDeviationType;
  plannedShotId: string;
  attemptId?: string;
  occurredAt: string;
  details?: string;
};

export type AssessmentAttemptProviderMetadata = {
  providerId: TimingProviderType;
  providerVersion?: string;
  /** Generic, provider-neutral bag — no Brower-specific fields belong in core domain types. */
  hardwareMetadata?: Record<string, string | number | boolean>;
};

/**
 * A planned shot may have multiple invalid attempts (up to the repeat limit)
 * but at most one valid, scored attempt — see attempts.ts.
 */
export type AssessmentAttempt = {
  id: string;
  plannedShotId: string;
  /** 1-based, per planned shot (counts both valid and invalid attempts for that shot). */
  attemptNumber: number;
  status: AssessmentAttemptStatus;
  /** Only set for a valid attempt. */
  measuredTime?: number;
  /** Only set for a valid attempt. */
  executedHandle?: Handle;
  capturedAt: string;
  timingResultId?: string;
  providerMetadata?: AssessmentAttemptProviderMetadata;
  /** Only set for an invalid attempt. */
  invalidReason?: InvalidAttemptReason;
  /** Deviation types recorded specifically on this attempt (e.g. wrong_handle); the authoritative list lives on AssessmentRun.protocolDeviations. */
  protocolDeviations?: ProtocolDeviationType[];
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type AssessmentRunStatus =
  | "not_started"
  | "warmup"
  | "in_progress"
  | "paused"
  | "completed"
  | "incomplete";

/**
 * Provider-neutral capture context for a run. No Brower-specific fields — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md's "Provider-Neutral
 * Measurement" principle. Manual timing remains a fully supported
 * captureMode; whether manual and automatic runs are later comparable is an
 * explicit open product decision, not decided here.
 */
export type AssessmentTimingProviderSnapshot = {
  providerId: TimingProviderType;
  captureMode: "automatic" | "manual";
  providerVersion?: string;
  hardwareMetadata?: Record<string, string | number | boolean>;
  measurementMode: MeasurementMode;
};

export type AssessmentInterruptionMetadata = {
  interruptionCount: number;
  resumedAfterReload: boolean;
  longInterruption?: boolean;
};

export const ASSESSMENT_RUN_SCHEMA_VERSION = 1;

/**
 * An executed instance of an AssessmentTemplate. Holds an immutable snapshot
 * of the exact template version used (`templateSnapshot`) so a later template
 * edit or republish can never retroactively change a historical run's
 * protocol — see docs/adr/0010-assessment-domain-foundation.md. Warm-up
 * status and progress are deliberately *not* stored as redundant fields;
 * they're always derived from `attempts` + `templateSnapshot` (see
 * progress.ts) so raw data stays the single source of truth.
 */
export type AssessmentRun = {
  id: string;
  templateId: string;
  templateVersion: number;
  templateSnapshot: AssessmentTemplate;
  status: AssessmentRunStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  pausedAt?: string;
  /** 0-based index into the combined warm-up + scored planned-shot sequence — see progress.ts's getAllPlannedShots. */
  currentPlannedShotIndex: number;
  attempts: AssessmentAttempt[];
  protocolDeviations: ProtocolDeviation[];
  interruption: AssessmentInterruptionMetadata;
  timingProviderSnapshot: AssessmentTimingProviderSnapshot;
  /** The Run Threshold Snapshot — immutable after run creation, distinct from any later Comparison Threshold Set (see thresholds.ts / comparison.ts). */
  thresholdSnapshot: AccuracyThresholdSet;
  notes?: string;
  schemaVersion: number;
};
