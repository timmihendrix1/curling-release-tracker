import { isCanonicalUuid } from "../uuid";
import type { SupabaseClient } from "./supabaseClient";
import type { CloudMutationOutcome, CloudSportingRecord, CloudSportingResult, CloudSportingService } from "../cloudSporting/types";

const OUTCOMES = new Set<CloudMutationOutcome>(["inserted", "already_present", "deleted", "already_deleted", "conflict"]);

function fail<T>(error: unknown): CloudSportingResult<T> {
  try {
    const message = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : "";
    if (message.startsWith("forbidden:")) return { ok: false, error: "forbidden" };
    if (message.startsWith("invalid_input:")) return { ok: false, error: "invalid_input" };
  } catch {
    // Raw provider errors are deliberately discarded.
  }
  return { ok: false, error: "unexpected_error" };
}

function mutation(data: unknown): CloudSportingResult<{ outcome: CloudMutationOutcome; contentSha256: string }> {
  try {
    const row = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
    if (typeof row !== "object" || row === null) return { ok: false, error: "invalid_response" };
    const outcome = (row as Record<string, unknown>).outcome;
    const contentSha256 = (row as Record<string, unknown>).content_sha256;
    if (!OUTCOMES.has(outcome as CloudMutationOutcome) || typeof contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(contentSha256)) {
      return { ok: false, error: "invalid_response" };
    }
    return { ok: true, value: { outcome: outcome as CloudMutationOutcome, contentSha256 } };
  } catch {
    return { ok: false, error: "invalid_response" };
  }
}

function restore(data: unknown): CloudSportingResult<CloudSportingRecord[]> {
  try {
    if (!Array.isArray(data)) return { ok: false, error: "invalid_response" };
    const records: CloudSportingRecord[] = [];
    const seen = new Set<string>();
    for (const value of data) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "invalid_response" };
      const row = value as Record<string, unknown>;
      const recordKind = row.record_kind;
      const recordId = row.record_id;
      const schemaVersion = row.schema_version;
      const payload = row.payload;
      const contentSha256 = row.content_sha256;
      const recordedAt = row.recorded_at;
      if ((recordKind !== "training_session" && recordKind !== "assessment_run") || !isCanonicalUuid(recordId) ||
          !Number.isInteger(schemaVersion) || (schemaVersion as number) < 1 || typeof payload !== "string" ||
          typeof contentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(contentSha256) ||
          typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt))) return { ok: false, error: "invalid_response" };
      const key = `${recordKind}:${recordId}`;
      if (seen.has(key)) return { ok: false, error: "invalid_response" };
      seen.add(key);
      records.push({ recordKind, recordId, schemaVersion: schemaVersion as number, payload, contentSha256, recordedAt });
    }
    return { ok: true, value: records };
  } catch {
    return { ok: false, error: "invalid_response" };
  }
}

export function createSupabaseSportingCloudService(client: SupabaseClient): CloudSportingService {
  return {
    async restore() {
      try {
        const { data, error } = await client.rpc("get_my_sporting_records");
        return error ? fail(error) : restore(data);
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
    async put(record) {
      try {
        const { data, error } = await client.rpc("put_my_sporting_record", {
          p_record_kind: record.recordKind,
          p_record_id: record.recordId,
          p_schema_version: record.schemaVersion,
          p_payload: record.payload,
          p_recorded_at: record.recordedAt,
        });
        return error ? fail(error) : mutation(data);
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
    async delete(record) {
      try {
        const { data, error } = await client.rpc("delete_my_sporting_record", {
          p_record_kind: record.recordKind,
          p_record_id: record.recordId,
          p_expected_content_sha256: record.contentSha256,
        });
        return error ? fail(error) : mutation(data);
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
  };
}

