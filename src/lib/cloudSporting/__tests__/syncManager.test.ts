// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../../types";
import { createProfileScopedSportingRepositories, createProfileScopedSportingStorageAdapter } from "../../persistence/profileScopedSportingPersistence";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import type { StorageAdapter } from "../../persistence/types";
import { createSportingSyncStateRepository } from "../syncStateRepository";
import { SportingCloudSyncManager } from "../syncManager";
import { serializeTrainingSession, sha256Hex } from "../records";
import type { CloudSportingRecord, CloudSportingService } from "../types";
import { createEmptyAssessmentPersistedState } from "../../assessment/persistence";
import { createTestRun } from "../../assessment/__tests__/testHelpers";

const PROFILE = "11111111-1111-4111-8111-111111111111";

function session(id = "22222222-2222-4222-8222-222222222222"): Session {
  return {
    id,
    title: "Cloud training",
    date: "2026-08-27T10:00:00.000Z",
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
  };
}

function service(overrides: Partial<CloudSportingService> = {}) {
  const value = {
    restore: vi.fn(async () => ({ ok: true, value: [] })),
    put: vi.fn(async (record) => ({ ok: true, value: { outcome: "inserted", contentSha256: (await sha256Hex(record.payload))! } })),
    delete: vi.fn(async (record) => ({ ok: true, value: { outcome: "deleted", contentSha256: record.contentSha256 } })),
    ...overrides,
  } as CloudSportingService;
  return value;
}

function harness(
  cloud: CloudSportingService | null,
  online: () => boolean,
  adapter: StorageAdapter = createLocalStorageAdapter()
) {
  const repositories = createProfileScopedSportingRepositories(PROFILE, adapter);
  const scoped = createProfileScopedSportingStorageAdapter(PROFILE, adapter);
  const manager = new SportingCloudSyncManager(
    repositories,
    createSportingSyncStateRepository(scoped),
    cloud,
    online
  );
  return { repositories, decorated: manager.decorateRepositories(), manager, syncRepo: createSportingSyncStateRepository(scoped) };
}

beforeEach(() => localStorage.clear());

describe("SportingCloudSyncManager", () => {
  it("queues a terminal Session offline and uploads it idempotently on reconnect", async () => {
    let online = false;
    const cloud = service();
    const h = harness(cloud, () => online);
    await h.repositories.session.saveHistory([session()]);
    await h.manager.initialize();
    expect(h.manager.getSnapshot()).toMatchObject({ truth: "saved_on_device", pendingCount: 1 });
    expect(cloud.put).not.toHaveBeenCalled();

    online = true;
    await h.manager.synchronize();
    expect(cloud.put).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot()).toMatchObject({ truth: "synced", pendingCount: 0 });

    await h.manager.synchronize();
    expect(cloud.put).toHaveBeenCalledTimes(1);
  });

  it("turns a removed local history record into an acknowledged tombstone operation", async () => {
    const cloud = service();
    const h = harness(cloud, () => true);
    await h.repositories.session.saveHistory([session()]);
    await h.manager.initialize();
    expect(cloud.put).toHaveBeenCalledTimes(1);

    await h.decorated.session.saveHistory([]);
    await h.manager.synchronize();
    expect(cloud.delete).toHaveBeenCalledTimes(1);
    expect(h.manager.getSnapshot().truth).toBe("synced");
    const stored = await h.syncRepo.load();
    expect(stored.status === "value" ? stored.value.entries : []).toEqual([]);
  });

  it("does not restore an offline deletion before its tombstone reaches the cloud", async () => {
    let online = true;
    const local = serializeTrainingSession(session())!;
    const remote: CloudSportingRecord = {
      ...local,
      contentSha256: (await sha256Hex(local.payload))!,
    };
    const cloud = service({
      restore: vi.fn(async () => ({ ok: true as const, value: [remote] })),
    });
    const h = harness(cloud, () => online);
    await h.repositories.session.saveHistory([session()]);
    await h.manager.initialize();

    online = false;
    await h.decorated.session.saveHistory([]);
    await h.manager.synchronize();
    expect(cloud.delete).not.toHaveBeenCalled();
    const pendingDeletion = await h.syncRepo.load();
    expect(pendingDeletion.status).toBe("value");
    if (pendingDeletion.status === "value") {
      expect(pendingDeletion.value.entries).toEqual([
        expect.objectContaining({ desired: "deleted", payload: "" }),
      ]);
      expect(JSON.stringify(pendingDeletion.value)).not.toContain("Cloud training");
    }

    online = true;
    await h.manager.synchronize();
    expect(cloud.delete).toHaveBeenCalledTimes(1);
    const loaded = await h.repositories.session.loadHistory();
    expect(loaded.status === "value" ? loaded.value : []).toEqual([]);
    expect(h.manager.getSnapshot().truth).toBe("synced");
  });

  it("restores a cloud-only Session before repositories are exposed", async () => {
    const local = serializeTrainingSession(session())!;
    const remote: CloudSportingRecord = { ...local, contentSha256: (await sha256Hex(local.payload))! };
    const cloud = service({ restore: vi.fn(async () => ({ ok: true as const, value: [remote] })) });
    const h = harness(cloud, () => true);
    await h.manager.initialize();
    const loaded = await h.repositories.session.loadHistory();
    expect(loaded.status).toBe("value");
    if (loaded.status === "value") expect(loaded.value).toEqual([session()]);
    expect(cloud.put).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().truth).toBe("synced");
  });

  it("preserves local data and reports a same-id content conflict", async () => {
    const cloud = service({
      put: vi.fn(async () => ({ ok: true as const, value: { outcome: "conflict" as const, contentSha256: "0".repeat(64) } })),
    });
    const h = harness(cloud, () => true);
    await h.repositories.session.saveHistory([session()]);
    await h.manager.initialize();
    expect(h.manager.getSnapshot().truth).toBe("sync_issue");
    const loaded = await h.repositories.session.loadHistory();
    expect(loaded.status === "value" ? loaded.value : []).toEqual([session()]);
  });

  it("never reports Synced without a configured and successfully reached cloud", async () => {
    const withoutService = harness(null, () => true);
    await withoutService.manager.initialize();
    expect(withoutService.manager.getSnapshot().truth).toBe("saved_on_device");

    const unavailable = harness(
      service({ restore: vi.fn(async () => ({ ok: false as const, error: "unavailable" as const })) }),
      () => true
    );
    await unavailable.manager.initialize();
    expect(unavailable.manager.getSnapshot().truth).toBe("saved_on_device");
  });

  it("Retry re-runs restore before it can report Synced", async () => {
    const restore = vi
      .fn()
      .mockResolvedValueOnce({ ok: false as const, error: "invalid_response" as const })
      .mockResolvedValueOnce({ ok: true as const, value: [] });
    const h = harness(service({ restore }), () => true);
    await h.manager.initialize();
    expect(h.manager.getSnapshot().truth).toBe("sync_issue");

    await h.manager.retry();
    expect(restore).toHaveBeenCalledTimes(2);
    expect(h.manager.getSnapshot().truth).toBe("synced");
  });

  it("does not infer a cloud deletion when local restore persistence fails", async () => {
    const local = serializeTrainingSession(session())!;
    const remote: CloudSportingRecord = {
      ...local,
      contentSha256: (await sha256Hex(local.payload))!,
    };
    const base = createLocalStorageAdapter();
    const refusingAdapter: StorageAdapter = {
      get: base.get,
      async set(key, value) {
        if (key.includes("curling-release-tracker-session-history")) {
          return { ok: false, error: { kind: "unknown", message: "refused" } };
        }
        return base.set(key, value);
      },
    };
    const cloud = service({
      restore: vi.fn(async () => ({ ok: true as const, value: [remote] })),
    });
    const h = harness(cloud, () => true, refusingAdapter);

    await h.manager.initialize();
    expect(cloud.delete).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().truth).toBe("sync_issue");
    const loaded = await h.repositories.session.loadHistory();
    expect(loaded.status).toBe("absent");
  });

  it("never queues the device-local current Assessment run", async () => {
    const cloud = service();
    const h = harness(cloud, () => true);
    const state = { ...createEmptyAssessmentPersistedState(), currentRun: createTestRun() };
    await h.repositories.assessment.saveState(state);
    await h.manager.initialize();
    expect(cloud.put).not.toHaveBeenCalled();
    expect(h.manager.getSnapshot().truth).toBe("synced");
  });
});
