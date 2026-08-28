import type {
  TeamExerciseBlockReason,
  TeamExerciseCloudResult,
  TeamExerciseCloudService,
  TeamExercisePutOutcome,
  TeamExerciseRecordingPermission,
} from "../cloudSporting/teamExerciseTypes";
import { isCanonicalUuid } from "../uuid";
import type { SupabaseClient } from "./supabaseClient";

const PUT_OUTCOMES = new Set<TeamExercisePutOutcome>(["inserted", "already_present", "conflict"]);
const BLOCK_REASONS = new Set<TeamExerciseBlockReason>([
  "athlete_not_session_participant",
  "execution_not_in_session",
  "athlete_ineligible",
  "athlete_membership_inactive",
  "recording_permission_missing",
]);
const HASH = /^[0-9a-f]{64}$/;

function fail<T>(error: unknown): TeamExerciseCloudResult<T> {
  try {
    const message = typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
    if (message.startsWith("forbidden:")) return { ok: false, error: "forbidden" };
    if (message.startsWith("not_found:")) return { ok: false, error: "not_found" };
    if (message.startsWith("invalid_input:")) return { ok: false, error: "invalid_input" };
  } catch {
    // Provider details can contain identifiers or addresses and are discarded.
  }
  return { ok: false, error: "unexpected_error" };
}

function oneRow(data: unknown): Record<string, unknown> | null {
  try {
    const value = Array.isArray(data) ? (data.length === 1 ? data[0] : null) : data;
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function createSupabaseTeamExerciseCloudService(client: SupabaseClient): TeamExerciseCloudService {
  return {
    async listActiveRecordingPermissions(teamId) {
      if (!isCanonicalUuid(teamId)) return { ok: false, error: "invalid_input" };
      try {
        const { data, error } = await client
          .from("team_exercise_recording_permissions")
          .select("athlete_profile_id, granted_at")
          .eq("team_id", teamId)
          .is("revoked_at", null);
        if (error) return fail(error);
        if (!Array.isArray(data)) return { ok: false, error: "invalid_response" };
        const permissions: TeamExerciseRecordingPermission[] = [];
        const profileIds = new Set<string>();
        for (const candidate of data) {
          const row = oneRow(candidate);
          if (
            !row ||
            !isCanonicalUuid(row.athlete_profile_id) ||
            !timestamp(row.granted_at) ||
            profileIds.has(row.athlete_profile_id)
          ) {
            return { ok: false, error: "invalid_response" };
          }
          profileIds.add(row.athlete_profile_id);
          permissions.push({
            athleteProfileId: row.athlete_profile_id,
            grantedAt: row.granted_at,
          });
        }
        return { ok: true, value: permissions };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async putSession(record) {
      try {
        const { data, error } = await client.rpc("put_team_exercise_session", {
          p_session_id: record.sessionId,
          p_team_id: record.teamId,
          p_schema_version: record.schemaVersion,
          p_coordination_payload: record.coordinationPayload,
          p_started_at: record.startedAt,
          p_completed_at: record.completedAt,
          p_participant_profile_ids: record.participantProfileIds,
          p_training_athlete_profile_ids: record.trainingAthleteProfileIds,
          p_execution_ids: record.executionIds,
        });
        if (error) return fail(error);
        const row = oneRow(data);
        if (!row || !PUT_OUTCOMES.has(row.outcome as TeamExercisePutOutcome) ||
            typeof row.content_sha256 !== "string" || !HASH.test(row.content_sha256) ||
            !isCanonicalUuid(row.recorded_by_profile_id)) {
          return { ok: false, error: "invalid_response" };
        }
        return { ok: true, value: {
          outcome: row.outcome as TeamExercisePutOutcome,
          contentSha256: row.content_sha256,
          recordedByProfileId: row.recorded_by_profile_id,
        } };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async putAthleteBundle(record) {
      try {
        const { data, error } = await client.rpc("put_team_exercise_result_bundle", {
          p_bundle_id: record.bundleId,
          p_session_id: record.sessionId,
          p_athlete_profile_id: record.athleteProfileId,
          p_schema_version: record.schemaVersion,
          p_result_payload: record.resultPayload,
          p_recorded_at: record.recordedAt,
          p_result_ids: record.resultIds,
          p_execution_ids: record.executionIds,
        });
        if (error) return fail(error);
        const row = oneRow(data);
        const outcome = row?.outcome;
        const blockReason = row?.block_reason;
        const validOutcome = PUT_OUTCOMES.has(outcome as TeamExercisePutOutcome) || outcome === "blocked";
        const validReason = outcome === "blocked"
          ? BLOCK_REASONS.has(blockReason as TeamExerciseBlockReason)
          : blockReason === null;
        if (!row || !validOutcome || !validReason || typeof row.content_sha256 !== "string" || !HASH.test(row.content_sha256)) {
          return { ok: false, error: "invalid_response" };
        }
        return { ok: true, value: {
          outcome: outcome as TeamExercisePutOutcome | "blocked",
          contentSha256: row.content_sha256,
          blockReason: blockReason as TeamExerciseBlockReason | null,
        } };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async setRecordingPermission(teamId, granted) {
      try {
        const { data, error } = await client.rpc("set_my_team_exercise_recording_permission", {
          p_team_id: teamId,
          p_granted: granted,
        });
        if (error) return fail(error);
        const row = oneRow(data);
        const outcomes = new Set(["granted", "already_granted", "revoked", "already_revoked"]);
        if (!row || !outcomes.has(String(row.outcome)) || (row.changed_at !== null && !timestamp(row.changed_at))) {
          return { ok: false, error: "invalid_response" };
        }
        return { ok: true, value: {
          outcome: row.outcome as "granted" | "already_granted" | "revoked" | "already_revoked",
          changedAt: row.changed_at as string | null,
        } };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async approveSession(sessionId) {
      try {
        const { data, error } = await client.rpc("approve_my_team_exercise_session", { p_session_id: sessionId });
        if (error) return fail(error);
        const row = oneRow(data);
        if (!row || (row.outcome !== "approved" && row.outcome !== "already_approved") || !timestamp(row.changed_at)) {
          return { ok: false, error: "invalid_response" };
        }
        return { ok: true, value: { outcome: row.outcome, changedAt: row.changed_at } };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

    async setPrivateNote(resultId, note) {
      try {
        const { data, error } = await client.rpc("set_my_team_exercise_private_note", {
          p_result_id: resultId,
          p_note: note,
        });
        if (error) return fail(error);
        const row = oneRow(data);
        const outcomes = new Set(["created", "updated", "cleared", "already_clear"]);
        if (!row || !outcomes.has(String(row.outcome)) || !timestamp(row.updated_at)) {
          return { ok: false, error: "invalid_response" };
        }
        return { ok: true, value: {
          outcome: row.outcome as "created" | "updated" | "cleared" | "already_clear",
          updatedAt: row.updated_at,
        } };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },
  };
}
