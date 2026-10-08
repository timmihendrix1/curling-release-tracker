import type { AssessmentRun } from "../assessment/types";
import { validatePersistedAssessmentRun } from "../assessment/migration";
import { ASSESSMENT_RUN_SCHEMA_VERSION } from "../assessment/types";
import { migrateSession } from "../sessionMigration";
import { sessionMeasurementStateIsCanonical } from "../measurement/canonicalSession";
import {
  usesBlockMeasurementConfiguration,
  validateSessionMeasurementState,
} from "../measurement/validation";
import type { Session } from "../../types";
import {
  isSessionExerciseCloudEligible,
  validateSessionExerciseState,
} from "../exercises/sessionIntegration";
import { isCanonicalUuid } from "../uuid";
import type { CloudSportingRecord, CloudSportingRecordKind } from "./types";

/**
 * Wire version 1 is the historical, time-only Training Session payload. Its bytes,
 * digest and identity are frozen: an existing stored record is never re-serialized
 * differently, never re-hashed to a new value, and never re-uploaded merely because
 * this updated client read it.
 *
 * Wire version 2 is selected for a session that declares a measurement configuration
 * ANYWHERE this build persists one — on a block, or on an embedded plan-step snapshot
 * whose Block has not been materialised yet. The selector is the presence of the
 * configuration, never the presence of speed: an asymmetric time-only configuration
 * selects version 2 too, and an archived mixed plan carries its future speed step's
 * configuration even while every block is still legacy. A session with no
 * configuration anywhere — including every session recorded before this feature —
 * continues to serialize as version 1, producing byte-identical output to before.
 * See ADR-0051 and the compatibility matrix in
 * docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md.
 */
export const TRAINING_SESSION_CLOUD_SCHEMA_VERSION = 1;
export const TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION = 2;

const SUPPORTED_TRAINING_SESSION_SCHEMA_VERSIONS: number[] = [
  TRAINING_SESSION_CLOUD_SCHEMA_VERSION,
  TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION,
];

export type LocalTerminalRecord = Omit<CloudSportingRecord, "contentSha256">;

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return Object.is(left, right);
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => sameJsonValue(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).filter((key) => leftRecord[key] !== undefined).sort();
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) => key === rightKeys[index] && sameJsonValue(leftRecord[key], rightRecord[key])
  );
}

function validTimestamp(value: string): boolean {
  return value.length > 0 && Number.isFinite(Date.parse(value));
}

export function serializeTrainingSession(session: Session): LocalTerminalRecord | null {
  if (
    !isCanonicalUuid(session.id) ||
    !validTimestamp(session.date) ||
    !isSessionExerciseCloudEligible(session)
  ) return null;
  // Measurement-aware content that does not satisfy its own invariants is never
  // uploaded. Refusing here keeps malformed data out of the immutable record store
  // entirely, rather than storing it and discovering it on a later restore.
  if (!validateSessionMeasurementState(session).valid) return null;
  try {
    // Serialized exactly as the Session stands. Property order is NOT imposed here:
    // a Session restored from storage or from an existing record already carries the
    // order it was persisted in (see preserveStoredSessionOrder), so this reproduces
    // that record's bytes and digest untouched. Rewriting the order here would change
    // an authoritative payload, which the immutable record store must never do.
    const payload = JSON.stringify(session);
    if (!payload) return null;
    // A write this implementation accepts must be a read it can perform. The reader
    // requires the payload to survive migration unchanged, so the writer requires
    // exactly the same of the bytes it is about to store — checked on the parsed
    // payload, which is what a reader will actually see.
    if (!sessionMeasurementStateIsCanonical(JSON.parse(payload))) return null;
    return {
      recordKind: "training_session",
      recordId: session.id,
      // Version follows the content, not the app version: time-only sessions keep
      // emitting exactly the version-1 bytes they always did.
      schemaVersion: usesBlockMeasurementConfiguration(session)
        ? TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION
        : TRAINING_SESSION_CLOUD_SCHEMA_VERSION,
      payload,
      recordedAt: session.date,
    };
  } catch {
    return null;
  }
}

export function serializeAssessmentRun(run: AssessmentRun): LocalTerminalRecord | null {
  if (
    !isCanonicalUuid(run.id) ||
    (run.status !== "completed" && run.status !== "incomplete") ||
    !validTimestamp(run.completedAt ?? run.pausedAt ?? run.createdAt)
  ) return null;
  try {
    const payload = JSON.stringify(run);
    if (!payload) return null;
    return {
      recordKind: "assessment_run",
      recordId: run.id,
      schemaVersion: ASSESSMENT_RUN_SCHEMA_VERSION,
      payload,
      recordedAt: run.completedAt ?? run.pausedAt ?? run.createdAt,
    };
  } catch {
    return null;
  }
}

export function deserializeTrainingSession(record: CloudSportingRecord): Session | null {
  if (
    record.recordKind !== "training_session" ||
    !SUPPORTED_TRAINING_SESSION_SCHEMA_VERSIONS.includes(record.schemaVersion)
  ) return null;
  try {
    const parsed: unknown = JSON.parse(record.payload);
    const declaresMeasurement = usesBlockMeasurementConfiguration(parsed);

    // The declared version must match what the payload actually contains. A
    // version-1 record carrying measurement-aware content would be new data
    // mislabelled as legacy-compatible; a version-2 record without it would claim
    // a capability it does not use. Neither is silently accepted.
    if (
      declaresMeasurement !==
      (record.schemaVersion === TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION)
    ) return null;

    const migrated = migrateSession(parsed);
    if (
      migrated.id !== record.recordId ||
      !sameJsonValue(parsed, migrated) ||
      !validateSessionMeasurementState(parsed).valid ||
      !validateSessionExerciseState(parsed, migrated.id).valid ||
      !isSessionExerciseCloudEligible(migrated)
    ) return null;
    // Keep the exact parsed wire shape after validation, so re-serializing this
    // record reproduces its payload bytes and digest precisely — including for a
    // record written by an earlier producer whose property order differed. This is
    // what makes an already authoritative payload immutable in practice and not only
    // in intent.
    return parsed as Session;
  } catch {
    return null;
  }
}

export function deserializeAssessmentRun(record: CloudSportingRecord): AssessmentRun | null {
  if (record.recordKind !== "assessment_run" || record.schemaVersion !== ASSESSMENT_RUN_SCHEMA_VERSION) return null;
  try {
    const parsed: unknown = JSON.parse(record.payload);
    const validated = validatePersistedAssessmentRun(parsed);
    if (!validated.ok || validated.value.id !== record.recordId || !sameJsonValue(parsed, validated.value)) return null;
    if (validated.value.status !== "completed" && validated.value.status !== "incomplete") return null;
    return parsed as AssessmentRun;
  } catch {
    return null;
  }
}

export function recordKey(kind: CloudSportingRecordKind, id: string): string {
  return `${kind}:${id}`;
}

export async function sha256Hex(value: string): Promise<string | null> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
