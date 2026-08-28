import type {
  TeamExerciseBlockReason,
  TeamExerciseCloudResult,
  TeamExerciseCloudReadRecord,
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

function rows(data: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(data)) return null;
  const parsed: Record<string, unknown>[] = [];
  for (const candidate of data) {
    const row = oneRow(candidate);
    if (!row) return null;
    parsed.push(row);
  }
  return parsed;
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

export function createSupabaseTeamExerciseCloudService(client: SupabaseClient): TeamExerciseCloudService {
  return {
    async listMyResults() {
      try {
        const [bundleQuery, sessionQuery, participantQuery, executionQuery, resultQuery, noteQuery] =
          await Promise.all([
            client.from("team_exercise_result_bundles").select(
              "id, session_id, athlete_profile_id, recorded_by_profile_id, schema_version, result_payload, content_sha256, recorded_at, created_at"
            ).order("recorded_at", { ascending: false }),
            client.from("team_exercise_sessions").select(
              "id, team_id, recorded_by_profile_id, schema_version, coordination_payload, content_sha256, started_at, completed_at, created_at"
            ),
            client.from("team_exercise_session_participants").select(
              "session_id, profile_id, participation"
            ),
            client.from("team_exercise_execution_refs").select("session_id, execution_id"),
            client.from("team_exercise_result_refs").select(
              "bundle_id, result_id, athlete_profile_id, execution_id"
            ),
            client.from("team_exercise_private_notes").select(
              "result_id, athlete_profile_id, note, updated_at"
            ),
          ]);
        for (const query of [bundleQuery, sessionQuery, participantQuery, executionQuery, resultQuery, noteQuery]) {
          if (query.error) return fail(query.error);
        }
        const bundles = rows(bundleQuery.data);
        const sessions = rows(sessionQuery.data);
        const participants = rows(participantQuery.data);
        const executions = rows(executionQuery.data);
        const results = rows(resultQuery.data);
        const notes = rows(noteQuery.data);
        if (!bundles || !sessions || !participants || !executions || !results || !notes) {
          return { ok: false, error: "invalid_response" };
        }

        const sessionById = new Map<string, Record<string, unknown>>();
        for (const session of sessions) {
          if (!isCanonicalUuid(session.id) || sessionById.has(session.id)) {
            return { ok: false, error: "invalid_response" };
          }
          sessionById.set(session.id, session);
        }
        const noteByResultId = new Map<string, Record<string, unknown>>();
        for (const note of notes) {
          if (!isCanonicalUuid(note.result_id) || noteByResultId.has(note.result_id)) {
            return { ok: false, error: "invalid_response" };
          }
          noteByResultId.set(note.result_id, note);
        }

        const records: TeamExerciseCloudReadRecord[] = [];
        const bundleIds = new Set<string>();
        for (const bundle of bundles) {
          if (!isCanonicalUuid(bundle.id) || bundleIds.has(bundle.id) ||
              !isCanonicalUuid(bundle.session_id) || !isCanonicalUuid(bundle.athlete_profile_id) ||
              !isCanonicalUuid(bundle.recorded_by_profile_id) || !Number.isInteger(bundle.schema_version) ||
              (bundle.schema_version as number) < 1 || typeof bundle.result_payload !== "string" ||
              bundle.result_payload.length === 0 || typeof bundle.content_sha256 !== "string" ||
              !HASH.test(bundle.content_sha256) || !timestamp(bundle.recorded_at) ||
              !timestamp(bundle.created_at)) return { ok: false, error: "invalid_response" };
          bundleIds.add(bundle.id);
          const session = sessionById.get(bundle.session_id);
          if (!session || !isCanonicalUuid(session.team_id) ||
              !isCanonicalUuid(session.recorded_by_profile_id) ||
              session.recorded_by_profile_id !== bundle.recorded_by_profile_id ||
              !Number.isInteger(session.schema_version) || (session.schema_version as number) < 1 ||
              typeof session.coordination_payload !== "string" || session.coordination_payload.length === 0 ||
              typeof session.content_sha256 !== "string" || !HASH.test(session.content_sha256) ||
              !timestamp(session.started_at) || !timestamp(session.completed_at) ||
              Date.parse(session.completed_at) < Date.parse(session.started_at) ||
              !timestamp(session.created_at)) return { ok: false, error: "invalid_response" };

          const sessionParticipants = participants.filter((row) => row.session_id === bundle.session_id);
          const participantIds: string[] = [];
          const trainingAthleteIds: string[] = [];
          for (const participant of sessionParticipants) {
            if (!isCanonicalUuid(participant.profile_id) ||
                (participant.participation !== "training-athlete" && participant.participation !== "supporting") ||
                participantIds.includes(participant.profile_id)) return { ok: false, error: "invalid_response" };
            participantIds.push(participant.profile_id);
            if (participant.participation === "training-athlete") trainingAthleteIds.push(participant.profile_id);
          }
          const executionIds = executions
            .filter((row) => row.session_id === bundle.session_id)
            .map((row) => row.execution_id);
          const bundleResultRows = results.filter((row) => row.bundle_id === bundle.id);
          if (participantIds.length === 0 || executionIds.length === 0 || bundleResultRows.length !== 1 ||
              executionIds.some((id) => !isCanonicalUuid(id)) || new Set(executionIds).size !== executionIds.length) {
            return { ok: false, error: "invalid_response" };
          }
          const result = bundleResultRows[0];
          if (!isCanonicalUuid(result.result_id) || result.athlete_profile_id !== bundle.athlete_profile_id ||
              !isCanonicalUuid(result.execution_id) || !executionIds.includes(result.execution_id)) {
            return { ok: false, error: "invalid_response" };
          }
          const note = noteByResultId.get(result.result_id);
          if (note && (note.athlete_profile_id !== bundle.athlete_profile_id ||
              typeof note.note !== "string" || note.note.trim().length === 0 ||
              !timestamp(note.updated_at))) return { ok: false, error: "invalid_response" };

          records.push({
            session: {
              sessionId: bundle.session_id,
              teamId: session.team_id,
              schemaVersion: session.schema_version as number,
              coordinationPayload: session.coordination_payload,
              startedAt: session.started_at,
              completedAt: session.completed_at,
              participantProfileIds: participantIds,
              trainingAthleteProfileIds: trainingAthleteIds,
              executionIds: executionIds as string[],
              recordedByProfileId: session.recorded_by_profile_id,
              contentSha256: session.content_sha256,
              createdAt: session.created_at,
            },
            bundle: {
              bundleId: bundle.id,
              sessionId: bundle.session_id,
              athleteProfileId: bundle.athlete_profile_id,
              schemaVersion: bundle.schema_version as number,
              resultPayload: bundle.result_payload,
              recordedAt: bundle.recorded_at,
              resultIds: [result.result_id],
              executionIds: [result.execution_id],
              recordedByProfileId: bundle.recorded_by_profile_id,
              contentSha256: bundle.content_sha256,
              createdAt: bundle.created_at,
            },
            privateNote: note ? {
              resultId: result.result_id,
              note: note.note as string,
              updatedAt: note.updated_at as string,
            } : null,
          });
        }

        const visibleSessionIds = new Set(bundles.map((bundle) => bundle.session_id));
        if (sessions.some((session) => !visibleSessionIds.has(session.id)) ||
            participants.some((row) => !visibleSessionIds.has(row.session_id)) ||
            executions.some((row) => !visibleSessionIds.has(row.session_id)) ||
            results.some((row) => typeof row.bundle_id !== "string" || !bundleIds.has(row.bundle_id)) ||
            notes.some((note) => !results.some((result) => result.result_id === note.result_id))) {
          return { ok: false, error: "invalid_response" };
        }
        return { ok: true, value: records };
      } catch {
        return { ok: false, error: "unavailable" };
      }
    },

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
