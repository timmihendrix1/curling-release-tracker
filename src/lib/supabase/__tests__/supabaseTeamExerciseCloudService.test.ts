import { describe, expect, it, vi } from "vitest";
import { createSupabaseTeamExerciseCloudService } from "../supabaseTeamExerciseCloudService";

const SESSION = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000002";
const ATHLETE = "30000000-0000-4000-8000-000000000003";
const RECORDER = "50000000-0000-4000-8000-000000000005";
const EXECUTION = "60000000-0000-4000-8000-000000000006";
const RESULT = "70000000-0000-4000-8000-000000000007";
const REVISION = "80000000-0000-4000-8000-000000000008";
const HASH = "a".repeat(64);

function readClient(overrides: Record<string, unknown[]> = {}) {
  const data: Record<string, unknown[]> = {
    team_exercise_result_bundles: [{
      id: RESULT, session_id: SESSION, athlete_profile_id: ATHLETE,
      recorded_by_profile_id: RECORDER, schema_version: 1, result_payload: "{}",
      content_sha256: HASH, recorded_at: "2026-08-28T10:30:00Z",
      created_at: "2026-08-28T11:00:00Z",
    }],
    team_exercise_sessions: [{
      id: SESSION, team_id: TEAM, recorded_by_profile_id: RECORDER,
      schema_version: 1, coordination_payload: "{}", content_sha256: HASH,
      started_at: "2026-08-28T10:00:00Z", completed_at: "2026-08-28T11:00:00Z",
      created_at: "2026-08-28T11:00:00Z",
    }],
    team_exercise_session_participants: [
      { session_id: SESSION, profile_id: ATHLETE, participation: "training-athlete" },
      { session_id: SESSION, profile_id: RECORDER, participation: "supporting" },
    ],
    team_exercise_execution_refs: [{ session_id: SESSION, execution_id: EXECUTION }],
    team_exercise_result_refs: [{
      bundle_id: RESULT, result_id: RESULT, athlete_profile_id: ATHLETE,
      execution_id: EXECUTION,
    }],
    team_exercise_private_notes: [{
      result_id: RESULT, athlete_profile_id: ATHLETE, note: "Private",
      updated_at: "2026-08-28T12:00:00Z",
    }],
    team_exercise_result_revisions: [],
    ...overrides,
  };
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => table === "team_exercise_result_bundles" ||
        table === "team_exercise_result_revisions"
      ? { order: vi.fn(async () => ({ data: data[table], error: null })) }
      : Promise.resolve({ data: data[table], error: null })),
  }));
  return { from } as never;
}

function client(response: unknown) {
  return { rpc: vi.fn(async () => response) } as never;
}

describe("Supabase Team Exercise cloud boundary", () => {
  it("reads and correlates only the RLS-visible athlete bundle, manifest, context and note", async () => {
    const result = await createSupabaseTeamExerciseCloudService(readClient()).listMyResults();
    expect(result).toEqual({ ok: true, value: [{
      session: expect.objectContaining({
        sessionId: SESSION,
        participantProfileIds: [ATHLETE, RECORDER],
        trainingAthleteProfileIds: [ATHLETE],
        executionIds: [EXECUTION],
      }),
      bundle: expect.objectContaining({
        bundleId: RESULT,
        athleteProfileId: ATHLETE,
        resultIds: [RESULT],
        executionIds: [EXECUTION],
      }),
      privateNote: {
        resultId: RESULT,
        note: "Private",
        updatedAt: "2026-08-28T12:00:00Z",
      },
      revisions: [],
    }] });
  });

  it("fails the whole read closed on orphan rows, duplicate notes or malformed manifests", async () => {
    const orphan = await createSupabaseTeamExerciseCloudService(readClient({
      team_exercise_private_notes: [{
        result_id: SESSION, athlete_profile_id: ATHLETE, note: "orphan",
        updated_at: "2026-08-28T12:00:00Z",
      }],
    })).listMyResults();
    expect(orphan).toEqual({ ok: false, error: "invalid_response" });

    const duplicate = await createSupabaseTeamExerciseCloudService(readClient({
      team_exercise_private_notes: [
        { result_id: RESULT, athlete_profile_id: ATHLETE, note: "one", updated_at: "2026-08-28T12:00:00Z" },
        { result_id: RESULT, athlete_profile_id: ATHLETE, note: "two", updated_at: "2026-08-28T12:01:00Z" },
      ],
    })).listMyResults();
    expect(duplicate).toEqual({ ok: false, error: "invalid_response" });

    const badOwner = await createSupabaseTeamExerciseCloudService(readClient({
      team_exercise_result_refs: [{
        bundle_id: RESULT, result_id: RESULT, athlete_profile_id: RECORDER,
        execution_id: EXECUTION,
      }],
    })).listMyResults();
    expect(badOwner).toEqual({ ok: false, error: "invalid_response" });
  });

  it("correlates strict owner revisions and rejects orphan or malformed revision rows", async () => {
    const row = {
      id: REVISION, result_id: RESULT, athlete_profile_id: ATHLETE,
      revision_number: 1, kind: "corrected", schema_version: 1,
      result_payload: "{}", content_sha256: HASH, changed_fields: ["evaluation"],
      reason: "Corrected the observed outcome", actor_profile_id: ATHLETE,
      created_at: "2026-08-28T13:00:00Z",
    };
    const result = await createSupabaseTeamExerciseCloudService(readClient({
      team_exercise_result_revisions: [row],
    })).listMyResults();
    expect(result).toMatchObject({ ok: true, value: [{ revisions: [{
      revisionId: REVISION,
      resultId: RESULT,
      changedFields: ["evaluation"],
    }] }] });
    expect(await createSupabaseTeamExerciseCloudService(readClient({
      team_exercise_result_revisions: [{ ...row, result_id: SESSION }],
    })).listMyResults()).toEqual({ ok: false, error: "invalid_response" });
    expect(await createSupabaseTeamExerciseCloudService(readClient({
      team_exercise_result_revisions: [{ ...row, changed_fields: ["evaluation", "evaluation"] }],
    })).listMyResults()).toEqual({ ok: false, error: "invalid_response" });
  });

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

  it("maps correction and terminal-void RPCs without exposing provider details", async () => {
    const rpc = vi.fn(async (name: string) => ({
      data: [{
        outcome: name === "revise_my_team_exercise_result" ? "inserted" : "result_voided",
        revision_id: name === "revise_my_team_exercise_result" ? REVISION : null,
        revision_number: 1,
        changed_at: "2026-08-28T13:00:00Z",
      }],
      error: null,
    }));
    const service = createSupabaseTeamExerciseCloudService({ rpc } as never);
    expect(await service.reviseMyResult({
      revisionId: REVISION,
      resultId: RESULT,
      baseRevisionNumber: 0,
      schemaVersion: 1,
      resultPayload: "{}",
      reason: "Corrected the observed outcome",
      changedFields: ["evaluation"],
    })).toMatchObject({ ok: true, value: { outcome: "inserted", revisionId: REVISION } });
    expect(await service.voidMyResult({
      revisionId: REVISION,
      resultId: RESULT,
      baseRevisionNumber: 0,
      reason: "Recorded result should not count",
    })).toMatchObject({ ok: true, value: { outcome: "result_voided" } });
    expect(rpc).toHaveBeenNthCalledWith(1, "revise_my_team_exercise_result", expect.objectContaining({
      p_result_id: RESULT,
      p_changed_fields: ["evaluation"],
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "void_my_team_exercise_result", expect.objectContaining({
      p_result_id: RESULT,
      p_reason: "Recorded result should not count",
    }));
  });

  it("fails closed on contradictory revision mutation response shapes", async () => {
    const insertedWithoutIdentity = createSupabaseTeamExerciseCloudService(client({
      data: [{ outcome: "inserted", revision_id: null, revision_number: 1, changed_at: "2026-08-28T13:00:00Z" }],
      error: null,
    }));
    expect(await insertedWithoutIdentity.voidMyResult({
      revisionId: REVISION, resultId: RESULT, baseRevisionNumber: 0,
      reason: "This result should not count anymore",
    })).toEqual({ ok: false, error: "invalid_response" });

    const zeroBaseConflict = createSupabaseTeamExerciseCloudService(client({
      data: [{ outcome: "conflict", revision_id: null, revision_number: 0, changed_at: null }],
      error: null,
    }));
    expect(await zeroBaseConflict.voidMyResult({
      revisionId: REVISION, resultId: RESULT, baseRevisionNumber: 4,
      reason: "This result should not count anymore",
    })).toMatchObject({ ok: true, value: { outcome: "conflict", revisionNumber: 0 } });
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
