import type { AssessmentRun } from "../assessment/types";
import { validatePersistedAssessmentRun } from "../assessment/migration";
import { ASSESSMENT_RUN_SCHEMA_VERSION } from "../assessment/types";
import { migrateSession } from "../sessionMigration";
import type { Session } from "../../types";
import { isCanonicalUuid } from "../uuid";
import type { CloudSportingRecord, CloudSportingRecordKind } from "./types";

export const TRAINING_SESSION_CLOUD_SCHEMA_VERSION = 1;

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
  if (!isCanonicalUuid(session.id) || !validTimestamp(session.date)) return null;
  try {
    const payload = JSON.stringify(session);
    if (!payload) return null;
    return {
      recordKind: "training_session",
      recordId: session.id,
      schemaVersion: TRAINING_SESSION_CLOUD_SCHEMA_VERSION,
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
  if (record.recordKind !== "training_session" || record.schemaVersion !== TRAINING_SESSION_CLOUD_SCHEMA_VERSION) return null;
  try {
    const parsed: unknown = JSON.parse(record.payload);
    const migrated = migrateSession(parsed);
    if (migrated.id !== record.recordId || !sameJsonValue(parsed, migrated)) return null;
    // Keep the exact parsed wire shape after validation so a later serialization
    // preserves the cloud payload's property order instead of manufacturing a
    // different digest for semantically identical content.
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
