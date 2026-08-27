// Defensive validation and migration for persisted Assessment data.
//
// Strategy (conservative, by design — see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 2 "Raw Data Is
// Authoritative" and CLAUDE.md's migration rules): unlike Session/Shot
// migration (sessionMigration.ts), which repairs most fields independently
// in place because they're mostly-independent scalars, an AssessmentRun has
// many strict cross-field invariants (at most one valid attempt per planned
// shot, no duplicate timingResultIds, a completed run must have every
// scored shot covered, every attempt must reference a real planned shot in
// its own template snapshot, ...). Partially repairing such a record risks
// silently rewriting historical Attempt data, which this module must never
// do. Instead: a persisted AssessmentRun is validated as a whole; if it
// fails ANY check, it is discarded entirely (quarantined) rather than
// partially reconstructed. This can never corrupt Training Session History
// (a completely separate LocalStorage key — see persistence.ts) and never
// crashes the app on malformed data.
//
// An unknown (including future) persisted schema version is never silently
// downgraded or guess-migrated — it resolves to a fresh empty state. Since
// this is the very first Assessment persistence format, there is no older
// version to migrate FROM yet. A future schema migration (v1 -> v2) should
// add an explicit versioned migration step here, the same way
// sessionMigration.ts's discipline works, rather than attempting to
// interpret an unknown shape structurally.
import type { Handle, MeasurementMode, TimingProviderType } from "../../types";
import type { AccuracyThresholdPreset } from "../accuracyThresholds";
import { err, ok, type AssessmentOutcome } from "./errors";
import {
  ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
  createEmptyAssessmentPersistedState,
  type AssessmentPersistedState,
} from "./persistence";
import { getAllPlannedShots } from "./progress";
import { validateAssessmentTemplate } from "./templateValidation";
import { validateThresholdValues } from "./thresholds";
import {
  ASSESSMENT_RUN_SCHEMA_VERSION,
  type AccuracyThresholdSetSource,
  type AssessmentAttempt,
  type AssessmentAttemptProviderMetadata,
  type AssessmentAttemptStatus,
  type AssessmentRun,
  type AssessmentRunStatus,
  type AssessmentTemplate,
  type InvalidAttemptReason,
  type ProtocolDeviation,
  type ProtocolDeviationType,
} from "./types";

const VALID_RUN_STATUSES: AssessmentRunStatus[] = [
  "not_started",
  "warmup",
  "in_progress",
  "paused",
  "completed",
  "incomplete",
];
const VALID_ATTEMPT_STATUSES: AssessmentAttemptStatus[] = ["valid", "invalid"];
const VALID_HANDLES: Handle[] = ["in", "out"];
const VALID_INVALID_REASONS: InvalidAttemptReason[] = [
  "first_gate_missing",
  "second_gate_missing",
  "duplicate_result",
  "corrupted_timing",
  "external_trigger",
  "provider_failure",
  "app_failure",
  "external_interruption",
  "other",
];
const VALID_DEVIATION_TYPES: ProtocolDeviationType[] = [
  "wrong_handle",
  "non_standard_warmup",
  "resumed_after_reload",
  "long_interruption",
  "manual_override",
  "other",
];
const VALID_MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];
const VALID_PROVIDER_TYPES: TimingProviderType[] = ["simulator", "manual", "external"];
const VALID_THRESHOLD_TYPES: AccuracyThresholdPreset[] = ["standard", "tight", "custom"];
const VALID_THRESHOLD_SOURCES: AccuracyThresholdSetSource[] = [
  "default",
  "athlete-selected",
  "coach-selected",
];

function validateHardwareMetadata(
  raw: unknown
): Record<string, string | number | boolean> | null {
  if (!isRecord(raw) || Array.isArray(raw)) return null;
  const metadata: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      !(typeof value === "number" && Number.isFinite(value))
    ) {
      return null;
    }
    metadata[key] = value;
  }
  return metadata;
}

function validateAttemptProviderMetadata(
  raw: unknown
): AssessmentAttemptProviderMetadata | null | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || !VALID_PROVIDER_TYPES.includes(raw.providerId as TimingProviderType)) {
    return null;
  }
  if (raw.providerVersion !== undefined && typeof raw.providerVersion !== "string") {
    return null;
  }
  const hardwareMetadata = raw.hardwareMetadata === undefined
    ? undefined
    : validateHardwareMetadata(raw.hardwareMetadata);
  if (hardwareMetadata === null) return null;
  return {
    providerId: raw.providerId as TimingProviderType,
    providerVersion: raw.providerVersion as string | undefined,
    hardwareMetadata,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function validateAttempt(raw: unknown, validShotIds: Set<string>): AssessmentAttempt | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (typeof raw.plannedShotId !== "string" || !validShotIds.has(raw.plannedShotId)) return null;
  if (
    typeof raw.attemptNumber !== "number" ||
    !Number.isInteger(raw.attemptNumber) ||
    raw.attemptNumber < 1
  ) {
    return null;
  }
  if (!VALID_ATTEMPT_STATUSES.includes(raw.status as AssessmentAttemptStatus)) return null;
  if (!isValidIsoTimestamp(raw.capturedAt)) return null;

  const status = raw.status as AssessmentAttemptStatus;
  const timingResultId = typeof raw.timingResultId === "string" ? raw.timingResultId : undefined;
  const providerMetadata = validateAttemptProviderMetadata(raw.providerMetadata);
  if (providerMetadata === null) return null;

  if (status === "valid") {
    if (typeof raw.measuredTime !== "number" || !Number.isFinite(raw.measuredTime) || raw.measuredTime <= 0) {
      return null;
    }
    if (!VALID_HANDLES.includes(raw.executedHandle as Handle)) return null;

    const rawDeviations = Array.isArray(raw.protocolDeviations) ? raw.protocolDeviations : [];
    const protocolDeviations = rawDeviations.filter((deviation): deviation is ProtocolDeviationType =>
      VALID_DEVIATION_TYPES.includes(deviation as ProtocolDeviationType)
    );

    return {
      id: raw.id,
      plannedShotId: raw.plannedShotId,
      attemptNumber: raw.attemptNumber,
      status: "valid",
      measuredTime: raw.measuredTime,
      executedHandle: raw.executedHandle as Handle,
      capturedAt: raw.capturedAt,
      timingResultId,
      providerMetadata,
      protocolDeviations: protocolDeviations.length > 0 ? protocolDeviations : undefined,
    };
  }

  if (!VALID_INVALID_REASONS.includes(raw.invalidReason as InvalidAttemptReason)) return null;

  return {
    id: raw.id,
    plannedShotId: raw.plannedShotId,
    attemptNumber: raw.attemptNumber,
    status: "invalid",
    capturedAt: raw.capturedAt,
    timingResultId,
    providerMetadata,
    invalidReason: raw.invalidReason as InvalidAttemptReason,
  };
}

function validateDeviation(raw: unknown, validShotIds: Set<string>): ProtocolDeviation | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "string" || raw.id.length === 0) return null;
  if (!VALID_DEVIATION_TYPES.includes(raw.type as ProtocolDeviationType)) return null;
  if (typeof raw.plannedShotId !== "string" || !validShotIds.has(raw.plannedShotId)) return null;
  if (!isValidIsoTimestamp(raw.occurredAt)) return null;

  return {
    id: raw.id,
    type: raw.type as ProtocolDeviationType,
    plannedShotId: raw.plannedShotId,
    attemptId: typeof raw.attemptId === "string" ? raw.attemptId : undefined,
    occurredAt: raw.occurredAt,
    details: typeof raw.details === "string" ? raw.details : undefined,
  };
}

/**
 * Validates a single persisted AssessmentRun record as a whole. Returns
 * `invalid_persisted_assessment_data` on the first failing check — see this
 * module's doc comment for why partial repair is deliberately not
 * attempted.
 */
export function validatePersistedAssessmentRun(raw: unknown): AssessmentOutcome<AssessmentRun> {
  if (!isRecord(raw)) {
    return err("invalid_persisted_assessment_data", "Persisted Assessment Run is not an object.");
  }

  if (raw.schemaVersion !== ASSESSMENT_RUN_SCHEMA_VERSION) {
    return err(
      "invalid_persisted_assessment_data",
      `Unsupported Assessment Run schema version: ${String(raw.schemaVersion)}.`
    );
  }

  if (typeof raw.id !== "string" || raw.id.length === 0) {
    return err("invalid_persisted_assessment_data", "Assessment Run is missing a valid id.");
  }
  if (typeof raw.templateId !== "string" || raw.templateId.length === 0) {
    return err("invalid_persisted_assessment_data", "Assessment Run is missing a valid templateId.");
  }
  if (
    typeof raw.templateVersion !== "number" ||
    !Number.isInteger(raw.templateVersion) ||
    raw.templateVersion < 1
  ) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid templateVersion.");
  }
  if (!VALID_RUN_STATUSES.includes(raw.status as AssessmentRunStatus)) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid status.");
  }
  if (!isValidIsoTimestamp(raw.createdAt)) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid createdAt timestamp.");
  }
  for (const field of ["startedAt", "completedAt", "pausedAt"] as const) {
    if (raw[field] !== undefined && !isValidIsoTimestamp(raw[field])) {
      return err("invalid_persisted_assessment_data", `Assessment Run has an invalid ${field} timestamp.`);
    }
  }
  if (
    typeof raw.currentPlannedShotIndex !== "number" ||
    !Number.isInteger(raw.currentPlannedShotIndex) ||
    raw.currentPlannedShotIndex < 0
  ) {
    return err(
      "invalid_persisted_assessment_data",
      "Assessment Run has an invalid currentPlannedShotIndex."
    );
  }

  if (!isRecord(raw.templateSnapshot)) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid templateSnapshot.");
  }
  const templateSnapshot = raw.templateSnapshot as unknown as AssessmentTemplate;
  const templateValidation = validateAssessmentTemplate(templateSnapshot);
  if (!templateValidation.valid) {
    return err(
      "invalid_persisted_assessment_data",
      "Assessment Run's templateSnapshot failed template validation."
    );
  }

  if (!isRecord(raw.thresholdSnapshot)) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid thresholdSnapshot.");
  }
  const thresholdSnapshot = raw.thresholdSnapshot;
  if (!isRecord(thresholdSnapshot.values)) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid thresholdSnapshot.");
  }
  const thresholdValues = thresholdSnapshot.values;
  if (typeof thresholdValues.onTarget !== "number" || typeof thresholdValues.acceptable !== "number") {
    return err("invalid_persisted_assessment_data", "Assessment Run's thresholdSnapshot values are invalid.");
  }
  const thresholdValidation = validateThresholdValues(thresholdValues.onTarget, thresholdValues.acceptable);
  if (!thresholdValidation.valid) {
    return err(
      "invalid_persisted_assessment_data",
      "Assessment Run's thresholdSnapshot failed threshold validation."
    );
  }
  if (!VALID_THRESHOLD_TYPES.includes(thresholdSnapshot.type as AccuracyThresholdPreset)) {
    return err("invalid_persisted_assessment_data", "Assessment Run's thresholdSnapshot has an invalid type.");
  }
  if (!VALID_THRESHOLD_SOURCES.includes(thresholdSnapshot.source as AccuracyThresholdSetSource)) {
    return err("invalid_persisted_assessment_data", "Assessment Run's thresholdSnapshot has an invalid source.");
  }
  if (!isValidIsoTimestamp(thresholdSnapshot.selectedAt)) {
    return err(
      "invalid_persisted_assessment_data",
      "Assessment Run's thresholdSnapshot has an invalid selectedAt timestamp."
    );
  }

  if (!isRecord(raw.timingProviderSnapshot)) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid timingProviderSnapshot.");
  }
  const timingProviderSnapshot = raw.timingProviderSnapshot;
  if (!VALID_PROVIDER_TYPES.includes(timingProviderSnapshot.providerId as TimingProviderType)) {
    return err(
      "invalid_persisted_assessment_data",
      "Assessment Run's timingProviderSnapshot has an invalid providerId."
    );
  }
  if (!VALID_MEASUREMENT_MODES.includes(timingProviderSnapshot.measurementMode as MeasurementMode)) {
    return err(
      "invalid_persisted_assessment_data",
      "Assessment Run's timingProviderSnapshot has an invalid measurementMode."
    );
  }
  if (timingProviderSnapshot.captureMode !== "automatic" && timingProviderSnapshot.captureMode !== "manual") {
    return err(
      "invalid_persisted_assessment_data",
      "Assessment Run's timingProviderSnapshot has an invalid captureMode."
    );
  }

  const validShotIds = new Set(getAllPlannedShots(templateSnapshot).map((shot) => shot.id));

  if (!Array.isArray(raw.attempts)) {
    return err("invalid_persisted_assessment_data", "Assessment Run's attempts is not an array.");
  }
  const attempts: AssessmentAttempt[] = [];
  const seenAttemptIds = new Set<string>();
  const validAttemptShotIds = new Set<string>();
  const seenTimingResultIds = new Set<string>();
  for (const rawAttempt of raw.attempts) {
    const attempt = validateAttempt(rawAttempt, validShotIds);
    if (!attempt) {
      return err("invalid_persisted_assessment_data", "Assessment Run contains an invalid attempt record.");
    }
    if (seenAttemptIds.has(attempt.id)) {
      return err("invalid_persisted_assessment_data", `Duplicate attempt id "${attempt.id}".`);
    }
    seenAttemptIds.add(attempt.id);

    if (attempt.status === "valid") {
      if (validAttemptShotIds.has(attempt.plannedShotId)) {
        return err(
          "invalid_persisted_assessment_data",
          `Duplicate valid attempt for planned shot "${attempt.plannedShotId}".`
        );
      }
      validAttemptShotIds.add(attempt.plannedShotId);
    }

    if (attempt.timingResultId) {
      if (seenTimingResultIds.has(attempt.timingResultId)) {
        return err(
          "invalid_persisted_assessment_data",
          `Duplicate timingResultId "${attempt.timingResultId}".`
        );
      }
      seenTimingResultIds.add(attempt.timingResultId);
    }

    attempts.push(attempt);
  }

  if (!Array.isArray(raw.protocolDeviations)) {
    return err("invalid_persisted_assessment_data", "Assessment Run's protocolDeviations is not an array.");
  }
  const protocolDeviations: ProtocolDeviation[] = [];
  for (const rawDeviation of raw.protocolDeviations) {
    const deviation = validateDeviation(rawDeviation, validShotIds);
    if (!deviation) {
      return err(
        "invalid_persisted_assessment_data",
        "Assessment Run contains an invalid protocol deviation record."
      );
    }
    protocolDeviations.push(deviation);
  }

  const status = raw.status as AssessmentRunStatus;
  if (status === "completed") {
    const scoredShotIds = getAllPlannedShots(templateSnapshot)
      .filter((shot) => shot.phase === "scored")
      .map((shot) => shot.id);
    const hasOpenScoredShot = scoredShotIds.some((id) => !validAttemptShotIds.has(id));
    if (hasOpenScoredShot) {
      return err(
        "invalid_persisted_assessment_data",
        "A completed Assessment Run has scored planned shots without a valid attempt."
      );
    }
  }

  if (
    !isRecord(raw.interruption) ||
    typeof raw.interruption.interruptionCount !== "number" ||
    typeof raw.interruption.resumedAfterReload !== "boolean"
  ) {
    return err("invalid_persisted_assessment_data", "Assessment Run has an invalid interruption record.");
  }

  const run: AssessmentRun = {
    id: raw.id,
    templateId: raw.templateId,
    templateVersion: raw.templateVersion,
    templateSnapshot,
    status,
    createdAt: raw.createdAt as string,
    startedAt: raw.startedAt as string | undefined,
    completedAt: raw.completedAt as string | undefined,
    pausedAt: raw.pausedAt as string | undefined,
    currentPlannedShotIndex: raw.currentPlannedShotIndex,
    attempts,
    protocolDeviations,
    interruption: {
      interruptionCount: raw.interruption.interruptionCount,
      resumedAfterReload: raw.interruption.resumedAfterReload,
      longInterruption:
        typeof raw.interruption.longInterruption === "boolean"
          ? raw.interruption.longInterruption
          : undefined,
    },
    timingProviderSnapshot: {
      providerId: timingProviderSnapshot.providerId as TimingProviderType,
      captureMode: timingProviderSnapshot.captureMode as "automatic" | "manual",
      measurementMode: timingProviderSnapshot.measurementMode as MeasurementMode,
      providerVersion:
        typeof timingProviderSnapshot.providerVersion === "string"
          ? timingProviderSnapshot.providerVersion
          : undefined,
      hardwareMetadata: timingProviderSnapshot.hardwareMetadata === undefined
        ? undefined
        : validateHardwareMetadata(timingProviderSnapshot.hardwareMetadata) ?? undefined,
    },
    thresholdSnapshot: {
      type: thresholdSnapshot.type as AccuracyThresholdPreset,
      values: { onTarget: thresholdValues.onTarget, acceptable: thresholdValues.acceptable },
      presetId: typeof thresholdSnapshot.presetId === "string" ? thresholdSnapshot.presetId : undefined,
      source: thresholdSnapshot.source as AccuracyThresholdSetSource,
      selectedAt: thresholdSnapshot.selectedAt as string,
    },
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    schemaVersion: ASSESSMENT_RUN_SCHEMA_VERSION,
  };

  return ok(run);
}

/**
 * Migrates a raw, possibly-corrupt persisted Assessment root state. An
 * unrecognized `schemaVersion` (missing, older-invalid, or a future version
 * this build doesn't know about) resolves to a fresh empty state rather
 * than guessing — see this module's doc comment. Every history entry (and
 * the current run, if present) is independently validated; invalid or
 * duplicate-ID entries are quarantined (silently dropped), never repaired.
 */
export function migrateAssessmentPersistedState(raw: unknown): AssessmentPersistedState {
  if (!isRecord(raw)) return createEmptyAssessmentPersistedState();

  if (raw.schemaVersion !== ASSESSMENT_PERSISTENCE_SCHEMA_VERSION) {
    return createEmptyAssessmentPersistedState();
  }

  const rawHistory = Array.isArray(raw.history) ? raw.history : [];
  const history: AssessmentRun[] = [];
  const seenIds = new Set<string>();
  for (const rawRun of rawHistory) {
    const outcome = validatePersistedAssessmentRun(rawRun);
    if (outcome.ok && !seenIds.has(outcome.value.id)) {
      seenIds.add(outcome.value.id);
      history.push(outcome.value);
    }
  }

  let currentRun: AssessmentRun | undefined;
  if (raw.currentRun !== undefined) {
    const outcome = validatePersistedAssessmentRun(raw.currentRun);
    if (outcome.ok) currentRun = outcome.value;
  }

  return {
    schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
    currentRun,
    history,
  };
}
