import { describe, expect, it, vi } from "vitest";
import { createSupabaseTeamExerciseCloudService } from "../supabaseTeamExerciseCloudService";

const SESSION = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000002";
const ATHLETE = "30000000-0000-4000-8000-000000000003";
const RECORDER = "50000000-0000-4000-8000-000000000005";
const EXECUTION = "60000000-0000-4000-8000-000000000006";
const RESULT = "70000000-0000-4000-8000-000000000007";
const HASH = "a".repeat(64);

function client(response: unknown) {
  return { rpc: vi.fn(async () => response) } as never;
}

describe("Supabase Team Exercise cloud boundary", () => {
  it("reads the active Team-visible permission facts through the RLS table boundary", async () => {
    const is = vi.fn(async () => ({
      data: [{ athlete_profile_id: ATHLETE, granted_at: "2026-08-28T09:00:00Z" }],
      error: null,
    }));
    const eq = vi.fn(() => ({ is }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const result = await createSupabaseTeamExerciseCloudService({ from } as never)
      .listActiveRecordingPermissions(TEAM);
    expect(result).toEqual({ ok: true, value: [{
      athleteProfileId: ATHLETE,
      grantedAt: "2026-08-28T09:00:00Z",
    }] });
    expect(from).toHaveBeenCalledWith("team_exercise_recording_permissions");
    expect(select).toHaveBeenCalledWith("athlete_profile_id, granted_at");
    expect(eq).toHaveBeenCalledWith("team_id", TEAM);
    expect(is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("fails closed on invalid or duplicate permission rows", async () => {
    function permissionClient(data: unknown) {
      return {
        from: () => ({
          select: () => ({
            eq: () => ({ is: async () => ({ data, error: null }) }),
          }),
        }),
      } as never;
    }
    const service = createSupabaseTeamExerciseCloudService(permissionClient([
      { athlete_profile_id: ATHLETE, granted_at: "2026-08-28T09:00:00Z" },
      { athlete_profile_id: ATHLETE, granted_at: "2026-08-28T09:00:00Z" },
    ]));
    expect(await service.listActiveRecordingPermissions(TEAM))
      .toEqual({ ok: false, error: "invalid_response" });
    expect(await service.listActiveRecordingPermissions("not-a-team"))
      .toEqual({ ok: false, error: "invalid_input" });
  });

  it("calls the Session RPC with the complete immutable manifest", async () => {
    const rpc = vi.fn(async () => ({ data: [{ outcome: "inserted", content_sha256: HASH, recorded_by_profile_id: RECORDER }], error: null }));
    const result = await createSupabaseTeamExerciseCloudService({ rpc } as never).putSession({
      sessionId: SESSION,
      teamId: TEAM,
      schemaVersion: 1,
      coordinationPayload: "{}",
      startedAt: "2026-08-28T10:00:00Z",
      completedAt: "2026-08-28T11:00:00Z",
      participantProfileIds: [ATHLETE, RECORDER],
      trainingAthleteProfileIds: [ATHLETE],
      executionIds: [EXECUTION],
    });
    expect(result).toEqual({ ok: true, value: { outcome: "inserted", contentSha256: HASH, recordedByProfileId: RECORDER } });
    expect(rpc).toHaveBeenCalledWith("put_team_exercise_session", expect.objectContaining({
      p_session_id: SESSION,
      p_coordination_payload: "{}",
      p_training_athlete_profile_ids: [ATHLETE],
    }));
  });

  it("preserves only named per-athlete block reasons", async () => {
    const valid = await createSupabaseTeamExerciseCloudService(client({
      data: [{ outcome: "blocked", content_sha256: HASH, block_reason: "recording_permission_missing" }],
      error: null,
    })).putAthleteBundle({
      bundleId: RESULT,
      sessionId: SESSION,
      athleteProfileId: ATHLETE,
      schemaVersion: 1,
      resultPayload: "{}",
      recordedAt: "2026-08-28T10:30:00Z",
      resultIds: [RESULT],
      executionIds: [EXECUTION],
    });
    expect(valid).toEqual({ ok: true, value: {
      outcome: "blocked",
      contentSha256: HASH,
      blockReason: "recording_permission_missing",
    } });
    const invalid = await createSupabaseTeamExerciseCloudService(client({
      data: [{ outcome: "blocked", content_sha256: HASH, block_reason: "secret_reason" }], error: null,
    })).putAthleteBundle({
      bundleId: RESULT, sessionId: SESSION, athleteProfileId: ATHLETE, schemaVersion: 1,
      resultPayload: "{}", recordedAt: "2026-08-28T10:30:00Z", resultIds: [RESULT], executionIds: [EXECUTION],
    });
    expect(invalid).toEqual({ ok: false, error: "invalid_response" });
  });

  it("maps permission, approval and private-note mutation responses", async () => {
    const permission = await createSupabaseTeamExerciseCloudService(client({
      data: [{ outcome: "already_revoked", changed_at: null }], error: null,
    })).setRecordingPermission(TEAM, false);
    expect(permission).toEqual({ ok: true, value: { outcome: "already_revoked", changedAt: null } });

    const approval = await createSupabaseTeamExerciseCloudService(client({
      data: [{ outcome: "approved", changed_at: "2026-08-28T12:00:00Z" }], error: null,
    })).approveSession(SESSION);
    expect(approval).toMatchObject({ ok: true, value: { outcome: "approved" } });

    const note = await createSupabaseTeamExerciseCloudService(client({
      data: [{ outcome: "created", updated_at: "2026-08-28T12:00:00Z" }], error: null,
    })).setPrivateNote(RESULT, "private");
    expect(note).toMatchObject({ ok: true, value: { outcome: "created" } });
  });

  it("fails closed without exposing raw provider details", async () => {
    const result = await createSupabaseTeamExerciseCloudService(client({
      data: null,
      error: { message: "forbidden: signed-url/secret-value" },
    })).approveSession(SESSION);
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(JSON.stringify(result)).not.toContain("secret-value");

    const proxy = new Proxy({}, { get() { throw new Error("private-address"); } });
    const thrown = await createSupabaseTeamExerciseCloudService(proxy as never).putSession({
      sessionId: SESSION, teamId: TEAM, schemaVersion: 1, coordinationPayload: "{}",
      startedAt: "2026-08-28T10:00:00Z", completedAt: "2026-08-28T11:00:00Z",
      participantProfileIds: [ATHLETE, RECORDER], trainingAthleteProfileIds: [ATHLETE], executionIds: [EXECUTION],
    });
    expect(thrown).toEqual({ ok: false, error: "unavailable" });
  });
});
