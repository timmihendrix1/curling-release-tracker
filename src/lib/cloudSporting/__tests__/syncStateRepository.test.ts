// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import {
  CLOUD_SPORTING_SYNC_STORAGE_KEY,
  createSportingSyncStateRepository,
} from "../syncStateRepository";

beforeEach(() => localStorage.clear());

describe("sporting sync-state migration and Team validation", () => {
  it("migrates the exact legacy v1 outbox without losing personal entries", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      entries: [{
        recordKind: "training_session",
        recordId: "10000000-0000-4000-8000-000000000001",
        schemaVersion: 1,
        payload: "{}",
        contentSha256: "a".repeat(64),
        recordedAt: "2026-08-28T10:00:00Z",
        desired: "present",
        status: "pending",
      }],
    }));
    const loaded = await createSportingSyncStateRepository(adapter).load();
    expect(loaded.status).toBe("value");
    if (loaded.status === "value") {
      expect(loaded.value.schemaVersion).toBe(5);
      expect(loaded.value.entries).toHaveLength(1);
      expect(loaded.value.teamEntries).toEqual([]);
      expect(loaded.value.teamEligibilitySnapshots).toEqual([]);
      expect(loaded.value.activeTeamExerciseDraft).toBeNull();
      expect(loaded.value.teamExerciseResults).toEqual([]);
    }
  });

  it("fails closed when a stored blocked bundle has no named server reason", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      entries: [],
      teamEntries: [{
        entryKind: "team_exercise_bundle",
        bundleId: "10000000-0000-4000-8000-000000000001",
        sessionId: "20000000-0000-4000-8000-000000000002",
        athleteProfileId: "30000000-0000-4000-8000-000000000003",
        schemaVersion: 1,
        resultPayload: "{}",
        contentSha256: "a".repeat(64),
        recordedAt: "2026-08-28T10:00:00Z",
        resultIds: ["40000000-0000-4000-8000-000000000004"],
        executionIds: ["50000000-0000-4000-8000-000000000005"],
        status: "blocked",
      }],
    }));
    const loaded = await createSportingSyncStateRepository(adapter).load();
    expect(loaded.status).toBe("read_failed");
    if (loaded.status === "read_failed") expect(loaded.fallback.teamEntries).toEqual([]);
  });

  it("migrates the exact v2 Team outbox with an empty eligibility cache", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 2,
      entries: [],
      teamEntries: [],
    }));
    const loaded = await createSportingSyncStateRepository(adapter).load();
    expect(loaded.status).toBe("value");
    if (loaded.status === "value") {
      expect(loaded.value).toEqual({
        schemaVersion: 5,
        entries: [],
        teamEntries: [],
        teamEligibilitySnapshots: [],
        activeTeamExerciseDraft: null,
        teamExerciseResults: [],
      });
    }
  });

  it("fails closed on malformed or duplicate cached Team eligibility", async () => {
    const adapter = createLocalStorageAdapter();
    const snapshot = {
      teamId: "20000000-0000-4000-8000-000000000002",
      teamName: "The Curlers",
      cachedAt: "2026-08-28T10:00:00Z",
      participants: [{
        profileId: "30000000-0000-4000-8000-000000000003",
        displayName: "Alex",
        participationAsPlayer: true,
        functions: ["coach"],
        recordingPermissionGranted: true,
      }],
    };
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 3,
      entries: [],
      teamEntries: [],
      teamEligibilitySnapshots: [snapshot, snapshot],
    }));
    const duplicate = await createSportingSyncStateRepository(adapter).load();
    expect(duplicate.status).toBe("read_failed");

    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 3,
      entries: [],
      teamEntries: [],
      teamEligibilitySnapshots: [{
        ...snapshot,
        participants: [{ ...snapshot.participants[0], functions: ["coach", "coach"] }],
      }],
    }));
    const malformed = await createSportingSyncStateRepository(adapter).load();
    expect(malformed.status).toBe("read_failed");
  });

  it("migrates schema 3 eligibility state with no invented active draft", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 3,
      entries: [],
      teamEntries: [],
      teamEligibilitySnapshots: [],
    }));
    const loaded = await createSportingSyncStateRepository(adapter).load();
    expect(loaded.status).toBe("value");
    if (loaded.status === "value") {
      expect(loaded.value.schemaVersion).toBe(5);
      expect(loaded.value.activeTeamExerciseDraft).toBeNull();
      expect(loaded.value.teamExerciseResults).toEqual([]);
    }
  });

  it("fails closed on an invalid schema 4 active Team draft", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 4,
      entries: [],
      teamEntries: [],
      teamEligibilitySnapshots: [],
      activeTeamExerciseDraft: { status: "completed" },
    }));
    const loaded = await createSportingSyncStateRepository(adapter).load();
    expect(loaded.status).toBe("read_failed");
    if (loaded.status === "read_failed") {
      expect(loaded.fallback.activeTeamExerciseDraft).toBeNull();
    }
  });

  it("migrates schema 4 with no invented athlete-owned results", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 4,
      entries: [],
      teamEntries: [],
      teamEligibilitySnapshots: [],
      activeTeamExerciseDraft: null,
    }));
    const loaded = await createSportingSyncStateRepository(adapter).load();
    expect(loaded.status).toBe("value");
    if (loaded.status === "value") {
      expect(loaded.value).toEqual({
        schemaVersion: 5,
        entries: [],
        teamEntries: [],
        teamEligibilitySnapshots: [],
        activeTeamExerciseDraft: null,
        teamExerciseResults: [],
      });
    }
  });

  it("fails schema 5 closed when a cached result is not a valid owned projection", async () => {
    const adapter = createLocalStorageAdapter();
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, JSON.stringify({
      schemaVersion: 5,
      entries: [],
      teamEntries: [],
      teamEligibilitySnapshots: [],
      activeTeamExerciseDraft: null,
      teamExerciseResults: [{
        result: { athleteProfileId: "30000000-0000-4000-8000-000000000003" },
        privateNote: { note: "another athlete's note", updatedAt: "2026-08-28T12:00:00Z" },
      }],
    }));
    const loaded = await createSportingSyncStateRepository(adapter).load();
    expect(loaded.status).toBe("read_failed");
    if (loaded.status === "read_failed") expect(loaded.fallback.teamExerciseResults).toEqual([]);
  });
});
