// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import type { StorageAdapter } from "../../persistence/types";
import {
  createProfileScopedSportingRepositories,
  createProfileScopedSportingStorageAdapter,
} from "../../persistence/profileScopedSportingPersistence";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import {
  addTeamShotmakingAttempt,
  completeTeamExerciseExecution,
  createTeamExerciseExecution,
} from "../../exercises/teamExecution";
import { SportingCloudSyncManager } from "../syncManager";
import {
  CLOUD_SPORTING_SYNC_STORAGE_KEY,
  createSportingSyncStateRepository,
  emptySportingSyncState,
} from "../syncStateRepository";
import type { CloudSportingService } from "../types";
import type { TeamExerciseCloudService } from "../teamExerciseTypes";
import { sha256Hex } from "../records";
import { serializeCompletedTeamExercise } from "../teamExerciseRecords";
import type { TeamExerciseCloudReadRecord } from "../teamExerciseTypes";
import type { TeamWorkspace } from "../../team/teamService";

const PROFILE_A = "10000000-0000-4000-8000-000000000001";
const PROFILE_B = "10000000-0000-4000-8000-000000000002";
const SESSION = "20000000-0000-4000-8000-000000000002";
const TEAM = "30000000-0000-4000-8000-000000000003";
const ATHLETE_A = "40000000-0000-4000-8000-000000000004";
const ATHLETE_B = "50000000-0000-4000-8000-000000000005";

function clock() {
  let id = 20;
  let minute = 0;
  return {
    id: () => `70000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 28, 10, minute++)).toISOString(),
  };
}

function activeTeamExecution() {
  const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID)!;
  const c = clock();
  const created = createTeamExerciseExecution(version, {
    trainingSessionId: SESSION,
    teamId: TEAM,
    recorderProfileId: PROFILE_A,
    participantRoster: [
      { profileId: ATHLETE_A, participation: "training-athlete" },
      { profileId: ATHLETE_B, participation: "training-athlete" },
      { profileId: PROFILE_A, participation: "supporting" },
    ],
    initialRoleAssignment: {
      deliveringAthleteProfileId: ATHLETE_A,
      sweeperProfileIds: [],
      observerProfileId: PROFILE_A,
      sweepingUsed: false,
    },
    rotation: { kind: "manual", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    clock: c,
  });
  if (!created.ok) throw new Error(created.error.message);
  const attempted = addTeamShotmakingAttempt(created.value, {
    recorderProfileId: PROFILE_A,
    athleteProfileId: ATHLETE_A,
    actualHandle: "out",
    evaluation: { status: "scored", score: 4 },
    clock: c,
  });
  if (!attempted.ok) throw new Error(attempted.error.message);
  return attempted.value;
}

function completedTeamExecution() {
  const completed = completeTeamExerciseExecution(
    activeTeamExecution(),
    PROFILE_A,
    "2026-08-28T11:00:00.000Z"
  );
  if (!completed.ok) throw new Error(completed.error.message);
  return completed.value;
}

async function ownedReadRecord(
  athleteProfileId = ATHLETE_A,
  note: string | null = "My private note"
): Promise<TeamExerciseCloudReadRecord> {
  const execution = completedTeamExecution();
  const upload = serializeCompletedTeamExercise(execution)!;
  const bundle = upload.bundles.find((candidate) => candidate.athleteProfileId === athleteProfileId)!;
  return {
    session: {
      ...upload.session,
      recordedByProfileId: PROFILE_A,
      contentSha256: (await sha256Hex(upload.session.coordinationPayload))!,
      createdAt: "2026-08-28T11:01:00Z",
    },
    bundle: {
      ...bundle,
      recordedByProfileId: PROFILE_A,
      contentSha256: (await sha256Hex(bundle.resultPayload))!,
      createdAt: "2026-08-28T11:01:01Z",
    },
    privateNote: note === null ? null : {
      resultId: bundle.resultIds[0],
      note,
      updatedAt: "2026-08-28T12:00:00Z",
    },
  };
}

function personalService(): CloudSportingService {
  return {
    restore: vi.fn(async () => ({ ok: true as const, value: [] })),
    put: vi.fn(async (record) => ({ ok: true as const, value: { outcome: "inserted" as const, contentSha256: (await sha256Hex(record.payload))! } })),
    delete: vi.fn(async (record) => ({ ok: true as const, value: { outcome: "deleted" as const, contentSha256: record.contentSha256 } })),
  };
}

function teamService(overrides: Partial<TeamExerciseCloudService> = {}): TeamExerciseCloudService {
  return {
    listMyResults: vi.fn(async () => ({ ok: true, value: [] })),
    listActiveRecordingPermissions: vi.fn(async () => ({ ok: true, value: [] })),
    putSession: vi.fn(async (record) => ({ ok: true, value: {
      outcome: "inserted", contentSha256: (await sha256Hex(record.coordinationPayload))!, recordedByProfileId: PROFILE_A,
    } })),
    putAthleteBundle: vi.fn(async (record) => ({ ok: true, value: {
      outcome: "inserted", contentSha256: (await sha256Hex(record.resultPayload))!, blockReason: null,
    } })),
    setRecordingPermission: vi.fn(),
    approveSession: vi.fn(),
    setPrivateNote: vi.fn(),
    ...overrides,
  } as TeamExerciseCloudService;
}

function harness(
  profileId: string,
  online: () => boolean,
  team: TeamExerciseCloudService | null,
  adapter: StorageAdapter = createLocalStorageAdapter()
) {
  const repositories = createProfileScopedSportingRepositories(profileId, adapter);
  const syncRepo = createSportingSyncStateRepository(createProfileScopedSportingStorageAdapter(profileId, adapter));
  const manager = new SportingCloudSyncManager(
    repositories,
    syncRepo,
    personalService(),
    online,
    team,
    profileId
  );
  return { manager, syncRepo };
}

function workspace(): TeamWorkspace {
  return {
    team: {
      id: TEAM,
      name: "The Curlers",
      status: "active",
      createdByProfileId: PROFILE_A,
      createdAt: "2026-08-28T09:00:00Z",
      archivedAt: null,
      restoredAt: null,
    },
    myMembershipId: "90000000-0000-4000-8000-000000000009",
    myFunctions: ["coach"],
    myParticipationAsPlayer: false,
    isAdmin: false,
    roster: [
      {
        membershipId: "90000000-0000-4000-8000-000000000009",
        profileId: PROFILE_A,
        displayName: "Recorder",
        participationAsPlayer: false,
        functions: ["coach"],
      },
      {
        membershipId: "90000000-0000-4000-8000-000000000010",
        profileId: ATHLETE_A,
        displayName: "Athlete",
        participationAsPlayer: true,
        functions: [],
      },
    ],
  };
}

beforeEach(() => localStorage.clear());

describe("Team Exercise entries in the Profile-scoped sporting outbox", () => {
  it("restores athlete-owned Team results into the Profile cache and keeps them offline", async () => {
    const adapter = createLocalStorageAdapter();
    const record = await ownedReadRecord();
    const first = harness(ATHLETE_A, () => true, teamService({
      listMyResults: vi.fn(async () => ({ ok: true as const, value: [record] })),
    }), adapter);
    await first.manager.initialize();
    expect(first.manager.getSnapshot()).toMatchObject({
      teamExerciseResultReadStatus: "refreshed",
      teamExerciseResults: [{ athleteProfileId: ATHLETE_A, privateNote: { note: "My private note" } }],
    });

    const reloaded = harness(ATHLETE_A, () => false, teamService(), adapter);
    await reloaded.manager.initialize();
    expect(reloaded.manager.getSnapshot()).toMatchObject({
      teamExerciseResultReadStatus: "cached",
      teamExerciseResults: [{ athleteProfileId: ATHLETE_A }],
    });
  });

  it("retains a verified cache on an unavailable refresh and rejects corrupt cloud replacement", async () => {
    const adapter = createLocalStorageAdapter();
    const record = await ownedReadRecord();
    const first = harness(ATHLETE_A, () => true, teamService({
      listMyResults: vi.fn(async () => ({ ok: true as const, value: [record] })),
    }), adapter);
    await first.manager.initialize();

    const unavailable = harness(ATHLETE_A, () => true, teamService({
      listMyResults: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })),
    }), adapter);
    await unavailable.manager.initialize();
    expect(unavailable.manager.getSnapshot()).toMatchObject({
      teamExerciseResultReadStatus: "cached",
      teamExerciseResults: [{ athleteProfileId: ATHLETE_A }],
    });

    const corrupt = { ...record, bundle: { ...record.bundle, contentSha256: "f".repeat(64) } };
    const invalid = harness(ATHLETE_A, () => true, teamService({
      listMyResults: vi.fn(async () => ({ ok: true as const, value: [corrupt] })),
    }), adapter);
    await invalid.manager.initialize();
    expect(invalid.manager.getSnapshot()).toMatchObject({
      teamExerciseResultReadStatus: "issue",
      teamExerciseResults: [{ athleteProfileId: ATHLETE_A }],
    });
  });

  it("fails closed if cached athlete-owned results cross into another mounted Profile", async () => {
    const base = createLocalStorageAdapter();
    const record = await ownedReadRecord();
    const first = harness(ATHLETE_A, () => true, teamService({
      listMyResults: vi.fn(async () => ({ ok: true as const, value: [record] })),
    }), base);
    await first.manager.initialize();
    const profileAState = await createProfileScopedSportingStorageAdapter(ATHLETE_A, base)
      .get(CLOUD_SPORTING_SYNC_STORAGE_KEY);
    const crossedAdapter: StorageAdapter = {
      get: (key) => key.endsWith(CLOUD_SPORTING_SYNC_STORAGE_KEY)
        ? Promise.resolve(profileAState)
        : base.get(key),
      set: base.set,
    };
    const second = harness(ATHLETE_B, () => false, teamService(), crossedAdapter);
    await second.manager.initialize();
    expect(second.manager.getSnapshot()).toMatchObject({
      truth: "sync_issue",
      teamExerciseResultReadStatus: "issue",
      teamExerciseResults: [],
    });
  });

  it("updates and clears only the authenticated athlete's private note after cloud acknowledgement", async () => {
    const record = await ownedReadRecord(ATHLETE_A, null);
    const setPrivateNote = vi.fn(async (_resultId: string, note: string | null) => ({
      ok: true as const,
      value: {
        outcome: note === null ? "cleared" as const : "created" as const,
        updatedAt: "2026-08-28T13:00:00Z",
      },
    }));
    const h = harness(ATHLETE_A, () => true, teamService({
      listMyResults: vi.fn(async () => ({ ok: true as const, value: [record] })),
      setPrivateNote,
    }));
    await h.manager.initialize();
    const resultId = h.manager.getSnapshot().teamExerciseResults[0].result.id;
    expect(await h.manager.setMyTeamExercisePrivateNote(resultId, ATHLETE_A, "Observed balance"))
      .toBe("updated");
    expect(h.manager.getSnapshot().teamExerciseResults[0].privateNote?.note).toBe("Observed balance");
    expect(await h.manager.setMyTeamExercisePrivateNote(resultId, ATHLETE_A, "   "))
      .toBe("updated");
    expect(h.manager.getSnapshot().teamExerciseResults[0].privateNote).toBeNull();
    expect(setPrivateNote).toHaveBeenNthCalledWith(1, resultId, "Observed balance");
    expect(setPrivateNote).toHaveBeenNthCalledWith(2, resultId, null);
    expect(await h.manager.setMyTeamExercisePrivateNote(resultId, PROFILE_B, "intrusion"))
      .toBe("failed");
    expect(setPrivateNote).toHaveBeenCalledTimes(2);
  });

  it("reports cloud note success separately when the Profile cache cannot be updated", async () => {
    const base = createLocalStorageAdapter();
    let refuseWrites = false;
    const adapter: StorageAdapter = {
      get: base.get,
      set: (key, value) => refuseWrites
        ? Promise.resolve({ ok: false, error: { kind: "unknown" as const, message: "refused" } })
        : base.set(key, value),
    };
    const record = await ownedReadRecord(ATHLETE_A, null);
    const remote = teamService({
      listMyResults: vi.fn(async () => ({ ok: true as const, value: [record] })),
      setPrivateNote: vi.fn(async () => ({ ok: true as const, value: {
        outcome: "created" as const,
        updatedAt: "2026-08-28T13:00:00Z",
      } })),
    });
    const h = harness(ATHLETE_A, () => true, remote, adapter);
    await h.manager.initialize();
    refuseWrites = true;
    expect(await h.manager.setMyTeamExercisePrivateNote(
      h.manager.getSnapshot().teamExerciseResults[0].result.id,
      ATHLETE_A,
      "Cloud accepted this"
    )).toBe("updated_cache_issue");
    expect(h.manager.getSnapshot()).toMatchObject({
      truth: "sync_issue",
      teamExerciseResults: [{ privateNote: { note: "Cloud accepted this" } }],
    });
  });

  it("rejects a private-note acknowledgement whose outcome contradicts the request", async () => {
    const record = await ownedReadRecord(ATHLETE_A, null);
    const setPrivateNote = vi.fn(async () => ({ ok: true as const, value: {
      outcome: "cleared" as const,
      updatedAt: "2026-08-28T13:00:00Z",
    } }));
    const h = harness(ATHLETE_A, () => true, teamService({
      listMyResults: vi.fn(async () => ({ ok: true as const, value: [record] })),
      setPrivateNote,
    }));
    await h.manager.initialize();
    expect(await h.manager.setMyTeamExercisePrivateNote(
      h.manager.getSnapshot().teamExerciseResults[0].result.id,
      ATHLETE_A,
      "Not actually saved"
    )).toBe("failed");
    expect(h.manager.getSnapshot().teamExerciseResults[0].privateNote).toBeNull();
  });

  it("persists and restores exactly one active Team draft inside the recorder Profile", async () => {
    const first = harness(PROFILE_A, () => false, teamService());
    await first.manager.initialize();
    const active = activeTeamExecution();
    expect(await first.manager.saveActiveTeamExerciseDraft(active, PROFILE_A)).toBe(true);
    expect(first.manager.getSnapshot().activeTeamExerciseDraft?.id).toBe(active.id);

    const reloaded = harness(PROFILE_A, () => false, teamService());
    await reloaded.manager.initialize();
    expect(reloaded.manager.getSnapshot().activeTeamExerciseDraft).toEqual(active);

    const otherProfile = harness(PROFILE_B, () => false, teamService());
    await otherProfile.manager.initialize();
    expect(otherProfile.manager.getSnapshot().activeTeamExerciseDraft).toBeNull();
  });

  it("fails closed when the mounted Profile finds a draft owned by another recorder", async () => {
    const h = harness(PROFILE_B, () => false, teamService());
    expect((await h.syncRepo.save({
      ...emptySportingSyncState(),
      activeTeamExerciseDraft: activeTeamExecution(),
    })).ok).toBe(true);

    await h.manager.initialize();

    expect(h.manager.getSnapshot()).toMatchObject({
      ready: true,
      truth: "sync_issue",
      activeTeamExerciseDraft: null,
    });
    expect(await h.manager.saveActiveTeamExerciseDraft(
      { ...activeTeamExecution(), teamContext: { ...activeTeamExecution().teamContext!, recorderProfileId: PROFILE_B } },
      PROFILE_B
    )).toBe(false);
  });

  it("rolls an unsaved active draft back out of the in-memory snapshot", async () => {
    const base = createLocalStorageAdapter();
    let refuseWrites = false;
    const adapter: StorageAdapter = {
      get: base.get,
      set: (key, value) => refuseWrites
        ? Promise.resolve({ ok: false, error: { kind: "unknown" as const, message: "refused" } })
        : base.set(key, value),
    };
    const h = harness(PROFILE_A, () => false, teamService(), adapter);
    await h.manager.initialize();
    refuseWrites = true;

    expect(await h.manager.saveActiveTeamExerciseDraft(activeTeamExecution(), PROFILE_A)).toBe(false);
    expect(h.manager.getSnapshot().activeTeamExerciseDraft).toBeNull();
  });

  it("atomically replaces the active draft with the completed upload package", async () => {
    const h = harness(PROFILE_A, () => false, teamService());
    await h.manager.initialize();
    const active = activeTeamExecution();
    await h.manager.saveActiveTeamExerciseDraft(active, PROFILE_A);
    const completed = completeTeamExerciseExecution(
      active,
      PROFILE_A,
      "2026-08-28T11:00:00.000Z"
    );
    if (!completed.ok) throw new Error(completed.error.message);
    expect(await h.manager.finalizeActiveTeamExerciseDraft(completed.value, PROFILE_A)).toBe(true);
    const loaded = await h.syncRepo.load();
    expect(loaded.status).toBe("value");
    if (loaded.status === "value") {
      expect(loaded.value.activeTeamExerciseDraft).toBeNull();
      expect(loaded.value.teamEntries).toHaveLength(3);
      expect(loaded.value.teamEntries.every((entry) => entry.status === "pending")).toBe(true);
    }
  });

  it("keeps the prior active draft and never uploads when finalization persistence fails", async () => {
    const base = createLocalStorageAdapter();
    let refuseWrites = false;
    const adapter: StorageAdapter = {
      get: base.get,
      set: (key, value) => refuseWrites
        ? Promise.resolve({ ok: false, error: { kind: "unknown" as const, message: "refused" } })
        : base.set(key, value),
    };
    const remote = teamService();
    const h = harness(PROFILE_A, () => true, remote, adapter);
    await h.manager.initialize();
    const active = activeTeamExecution();
    await h.manager.saveActiveTeamExerciseDraft(active, PROFILE_A);
    const completed = completeTeamExerciseExecution(active, PROFILE_A, "2026-08-28T11:00:00.000Z");
    if (!completed.ok) throw new Error(completed.error.message);
    refuseWrites = true;
    expect(await h.manager.finalizeActiveTeamExerciseDraft(completed.value, PROFILE_A)).toBe(false);
    expect(h.manager.getSnapshot().activeTeamExerciseDraft).toEqual(active);
    expect(remote.putSession).not.toHaveBeenCalled();
    expect(remote.putAthleteBundle).not.toHaveBeenCalled();
  });

  it("refuses a second active draft and allows discard only for the matching recorder", async () => {
    const h = harness(PROFILE_A, () => false, teamService());
    await h.manager.initialize();
    const active = activeTeamExecution();
    expect(await h.manager.saveActiveTeamExerciseDraft(active, PROFILE_A)).toBe(true);
    expect(await h.manager.saveActiveTeamExerciseDraft(
      { ...active, id: "80000000-0000-4000-8000-000000000008" },
      PROFILE_A
    )).toBe(false);
    expect(await h.manager.discardActiveTeamExerciseDraft(active.id, PROFILE_B)).toBe(false);
    expect(h.manager.getSnapshot().activeTeamExerciseDraft?.id).toBe(active.id);
    expect(await h.manager.discardActiveTeamExerciseDraft(active.id, PROFILE_A)).toBe(true);
    expect(h.manager.getSnapshot().activeTeamExerciseDraft).toBeNull();
  });

  it("refuses a same-id terminal aggregate that is not the exact completion of the saved draft", async () => {
    const h = harness(PROFILE_A, () => false, teamService());
    await h.manager.initialize();
    const active = activeTeamExecution();
    await h.manager.saveActiveTeamExerciseDraft(active, PROFILE_A);
    const completed = completeTeamExerciseExecution(active, PROFILE_A, "2026-08-28T11:00:00.000Z");
    if (!completed.ok) throw new Error(completed.error.message);
    const altered = {
      ...completed.value,
      athleteResults: completed.value.athleteResults.map((result, index) =>
        index === 0
          ? {
              ...result,
              attempts: result.attempts.map((attempt, attemptIndex) =>
                attemptIndex === 0
                  ? { ...attempt, evaluation: { status: "scored" as const, score: 3 as const } }
                  : attempt
              ),
            }
          : result
      ),
    };
    expect(await h.manager.finalizeActiveTeamExerciseDraft(altered, PROFILE_A)).toBe(false);
    expect(h.manager.getSnapshot().activeTeamExerciseDraft).toEqual(active);
  });

  it("persists the envelope and every athlete bundle before uploading after reload", async () => {
    let online = false;
    const first = harness(PROFILE_A, () => online, teamService());
    await first.manager.initialize();
    expect(await first.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_A)).toBe(true);
    const pending = await first.syncRepo.load();
    expect(pending.status).toBe("value");
    if (pending.status === "value") {
      expect(pending.value.teamEntries).toHaveLength(3);
      expect(pending.value.teamEntries.every((entry) => entry.status === "pending")).toBe(true);
    }

    online = true;
    const remote = teamService();
    const reloaded = harness(PROFILE_A, () => online, remote);
    await reloaded.manager.initialize();
    expect(remote.putSession).toHaveBeenCalledTimes(1);
    expect(remote.putAthleteBundle).toHaveBeenCalledTimes(2);
    expect(vi.mocked(remote.putSession).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(remote.putAthleteBundle).mock.invocationCallOrder[0]
    );
    expect(reloaded.manager.getSnapshot()).toMatchObject({
      pendingCount: 0,
      teamBlockedCount: 0,
      teamSessions: [{ sessionId: SESSION, status: "fully_synced" }],
    });
    const receipts = await reloaded.syncRepo.load();
    expect(receipts.status).toBe("value");
    if (receipts.status === "value") {
      expect(receipts.value.teamEntries.every((entry) =>
        entry.entryKind === "team_exercise_session"
          ? entry.coordinationPayload === ""
          : entry.resultPayload === ""
      )).toBe(true);
    }
    expect(await reloaded.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_A)).toBe(true);
    expect(remote.putSession).toHaveBeenCalledTimes(1);
    expect(remote.putAthleteBundle).toHaveBeenCalledTimes(2);
    expect(reloaded.manager.getSnapshot().truth).toBe("synced");
  });

  it("keeps an independently blocked athlete bundle and retries it after approval", async () => {
    let allowSecond = false;
    const remote = teamService({
      putAthleteBundle: vi.fn(async (record) => ({ ok: true as const, value: allowSecond || record.athleteProfileId === ATHLETE_A
        ? { outcome: "inserted" as const, contentSha256: (await sha256Hex(record.resultPayload))!, blockReason: null }
        : { outcome: "blocked" as const, contentSha256: (await sha256Hex(record.resultPayload))!, blockReason: "recording_permission_missing" as const }
      })),
    });
    const h = harness(PROFILE_A, () => true, remote);
    await h.manager.initialize();
    await h.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_A);
    expect(h.manager.getSnapshot()).toMatchObject({
      teamBlockedCount: 1,
      teamSessions: [{ sessionId: SESSION, status: "partially_synced_athlete_result_blocked" }],
    });
    const partial = await h.syncRepo.load();
    if (partial.status === "value") {
      const accepted = partial.value.teamEntries.find(
        (entry) => entry.entryKind === "team_exercise_bundle" && entry.athleteProfileId === ATHLETE_A
      );
      const blocked = partial.value.teamEntries.find(
        (entry) => entry.entryKind === "team_exercise_bundle" && entry.athleteProfileId === ATHLETE_B
      );
      expect(accepted?.entryKind === "team_exercise_bundle" ? accepted.resultPayload : "missing").toBe("");
      expect(blocked?.entryKind === "team_exercise_bundle" ? blocked.resultPayload.length : 0).toBeGreaterThan(0);
    }
    allowSecond = true;
    await h.manager.retry();
    expect(h.manager.getSnapshot()).toMatchObject({
      truth: "synced",
      teamBlockedCount: 0,
      teamSessions: [{ sessionId: SESSION, status: "fully_synced" }],
    });
  });

  it("keeps an uncertain upload pending and converges after a lost acknowledgement", async () => {
    const unavailable = teamService({
      putSession: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })),
    });
    const first = harness(PROFILE_A, () => true, unavailable);
    await first.manager.initialize();
    await first.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_A);
    expect(first.manager.getSnapshot().pendingCount).toBe(3);

    const recovered = teamService({
      putSession: vi.fn(async (record) => ({ ok: true as const, value: {
        outcome: "already_present" as const,
        contentSha256: (await sha256Hex(record.coordinationPayload))!,
        recordedByProfileId: PROFILE_A,
      } })),
      putAthleteBundle: vi.fn(async (record) => ({ ok: true as const, value: {
        outcome: "already_present" as const,
        contentSha256: (await sha256Hex(record.resultPayload))!,
        blockReason: null,
      } })),
    });
    const second = harness(PROFILE_A, () => true, recovered);
    await second.manager.initialize();
    expect(second.manager.getSnapshot().teamSessions[0]?.status).toBe("fully_synced");
  });

  it("does not send a persisted payload whose digest no longer matches", async () => {
    const offline = harness(PROFILE_A, () => false, teamService());
    await offline.manager.initialize();
    await offline.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_A);
    const loaded = await offline.syncRepo.load();
    if (loaded.status !== "value") throw new Error("expected pending Team state");
    const corrupted = {
      ...loaded.value,
      teamEntries: loaded.value.teamEntries.map((entry) =>
        entry.entryKind === "team_exercise_session"
          ? { ...entry, coordinationPayload: `${entry.coordinationPayload} ` }
          : entry
      ),
    };
    expect((await offline.syncRepo.save(corrupted)).ok).toBe(true);

    const remote = teamService();
    const online = harness(PROFILE_A, () => true, remote);
    await online.manager.initialize();
    expect(remote.putSession).not.toHaveBeenCalled();
    expect(remote.putAthleteBundle).not.toHaveBeenCalled();
    expect(online.manager.getSnapshot().teamSessions).toEqual([{ sessionId: SESSION, status: "sync_issue" }]);
  });

  it("does not expose one recorder Profile's pending Session after an account switch", async () => {
    const first = harness(PROFILE_A, () => false, teamService());
    await first.manager.initialize();
    await first.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_A);

    const second = harness(PROFILE_B, () => false, teamService());
    await second.manager.initialize();
    expect(second.manager.getSnapshot().teamSessions).toEqual([]);
    const profileBState = await second.syncRepo.load();
    expect(profileBState.status).toBe("value");
    if (profileBState.status === "value") expect(profileBState.value.teamEntries).toEqual([]);
  });

  it("refuses to bind an aggregate to a different authenticated Profile scope", async () => {
    const h = harness(PROFILE_B, () => false, teamService());
    await h.manager.initialize();
    expect(await h.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_B)).toBe(false);
    const state = await h.syncRepo.load();
    expect(state.status === "value" ? state.value.teamEntries : []).toEqual([]);
  });

  it("never uploads when the durable Profile-scoped outbox write fails", async () => {
    const base = createLocalStorageAdapter();
    const refusing: StorageAdapter = {
      get: base.get,
      async set(key, value) {
        if (key.includes("cloud-sporting-sync")) {
          return { ok: false, error: { kind: "unknown", message: "refused" } };
        }
        return base.set(key, value);
      },
    };
    const remote = teamService();
    const h = harness(PROFILE_A, () => true, remote, refusing);
    await h.manager.initialize();
    expect(await h.manager.enqueueCompletedTeamExercise(completedTeamExecution(), PROFILE_A)).toBe(false);
    expect(remote.putSession).not.toHaveBeenCalled();
    expect(remote.putAthleteBundle).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().truth).toBe("sync_issue");
  });

  it("durably caches the active roster and current permissions for offline Team start", async () => {
    const remote = teamService({
      listActiveRecordingPermissions: vi.fn(async () => ({ ok: true as const, value: [{
        athleteProfileId: ATHLETE_A,
        grantedAt: "2026-08-28T09:30:00Z",
      }] })),
    });
    const h = harness(PROFILE_A, () => true, remote);
    await h.manager.initialize();
    expect(await h.manager.refreshTeamExerciseEligibility(
      workspace(),
      PROFILE_A,
      "2026-08-28T10:00:00Z"
    )).toBe(true);
    expect(h.manager.getSnapshot().teamEligibilitySnapshots).toEqual([{
      teamId: TEAM,
      teamName: "The Curlers",
      cachedAt: "2026-08-28T10:00:00Z",
      participants: [
        expect.objectContaining({ profileId: PROFILE_A, recordingPermissionGranted: false }),
        expect.objectContaining({ profileId: ATHLETE_A, recordingPermissionGranted: true }),
      ],
    }]);

    const reloaded = harness(PROFILE_A, () => false, teamService());
    await reloaded.manager.initialize();
    expect(reloaded.manager.getSnapshot().teamEligibilitySnapshots).toHaveLength(1);

    const otherProfile = harness(PROFILE_B, () => false, teamService());
    await otherProfile.manager.initialize();
    expect(otherProfile.manager.getSnapshot().teamEligibilitySnapshots).toEqual([]);
  });

  it("keeps the last known eligibility snapshot when refresh is offline or fails", async () => {
    let online = true;
    const remote = teamService({
      listActiveRecordingPermissions: vi.fn(async () => ({ ok: true as const, value: [] })),
    });
    const h = harness(PROFILE_A, () => online, remote);
    await h.manager.initialize();
    expect(await h.manager.refreshTeamExerciseEligibility(
      workspace(), PROFILE_A, "2026-08-28T10:00:00Z"
    )).toBe(true);
    online = false;
    expect(await h.manager.refreshTeamExerciseEligibility(
      { ...workspace(), team: { ...workspace().team, name: "Untrusted offline name" } },
      PROFILE_A,
      "2026-08-28T11:00:00Z"
    )).toBe(false);
    expect(h.manager.getSnapshot().teamEligibilitySnapshots[0]?.teamName).toBe("The Curlers");
  });

  it("updates only the authenticated athlete's cached prospective permission after server success", async () => {
    const setRecordingPermission = vi.fn(async () => ({ ok: true as const, value: {
      outcome: "granted" as const,
      changedAt: "2026-08-28T10:05:00Z",
    } }));
    const remote = teamService({ setRecordingPermission });
    const h = harness(PROFILE_A, () => true, remote);
    await h.manager.initialize();
    await h.manager.refreshTeamExerciseEligibility(workspace(), PROFILE_A, "2026-08-28T10:00:00Z");
    expect(await h.manager.setMyTeamExerciseRecordingPermission(TEAM, PROFILE_A, true)).toBe("updated");
    expect(setRecordingPermission).toHaveBeenCalledWith(TEAM, true);
    const snapshot = h.manager.getSnapshot().teamEligibilitySnapshots[0];
    expect(snapshot.participants.find((participant) => participant.profileId === PROFILE_A))
      .toMatchObject({ recordingPermissionGranted: true });
    expect(snapshot.participants.find((participant) => participant.profileId === ATHLETE_A))
      .toMatchObject({ recordingPermissionGranted: false });
  });

  it("reports cloud success separately when the refreshed offline permission cache cannot be saved", async () => {
    const base = createLocalStorageAdapter();
    let refuseWrites = false;
    const adapter: StorageAdapter = {
      get: base.get,
      set: (key, value) => refuseWrites
        ? Promise.resolve({ ok: false, error: { kind: "unknown" as const, message: "refused" } })
        : base.set(key, value),
    };
    const remote = teamService({
      setRecordingPermission: vi.fn(async () => ({ ok: true as const, value: {
        outcome: "granted" as const,
        changedAt: "2026-08-28T10:05:00Z",
      } })),
    });
    const h = harness(PROFILE_A, () => true, remote, adapter);
    await h.manager.initialize();
    await h.manager.refreshTeamExerciseEligibility(workspace(), PROFILE_A, "2026-08-28T10:00:00Z");
    refuseWrites = true;
    expect(await h.manager.setMyTeamExerciseRecordingPermission(TEAM, PROFILE_A, true))
      .toBe("updated_cache_issue");
    expect(h.manager.getSnapshot().truth).toBe("sync_issue");
  });
});
