import { describe, expect, it, vi } from "vitest";
import { SportingCloudSyncManager, type SportingSyncWorkOwnership } from "../syncManager";
import { createProfileScopedSportingRepositories } from "../../persistence/profileScopedSportingPersistence";
import { createSportingSyncStateRepository } from "../syncStateRepository";
import type { StorageAdapter } from "../../persistence/types";
function make(ownership?: SportingSyncWorkOwnership) {
  const get = vi.fn<StorageAdapter["get"]>(async () => ({ status: "value", value: null }));
  const adapter: StorageAdapter = { get, set: async () => ({ ok: true }) };
  const repositories = createProfileScopedSportingRepositories("11111111-1111-4111-8111-111111111111", adapter);
  return { get, manager: new SportingCloudSyncManager(repositories, createSportingSyncStateRepository(adapter), null, () => false, null, null, ownership) };
}
describe("actual manager optional native scheduling ownership", () => {
  it("registers its exact new lane synchronously before work entry", async () => {
    const registered: Promise<void>[] = [], entry = vi.fn(() => true);
    const { get, manager } = make({ current: entry, register: work => { registered.push(work); expect(get).not.toHaveBeenCalled(); expect(entry).not.toHaveBeenCalled(); } });
    const result = manager.initialize(); expect(registered).toEqual([result]); expect(entry).not.toHaveBeenCalled();
    await result; expect(entry).toHaveBeenCalledOnce(); expect(get).toHaveBeenCalled(); expect(manager.getSnapshot().ready).toBe(true);
  });
  it.each(["register", "current", "revoked"])("skips %s refusal without a new ready or issue publication", async mode => {
    const { get, manager } = make({ current: () => { if (mode === "current") throw null; return mode !== "revoked"; }, register: () => { if (mode === "register") throw null; } });
    const published = vi.fn(); manager.subscribe(published);
    await manager.initialize(); expect(get).not.toHaveBeenCalled(); expect(published).not.toHaveBeenCalled();
    expect(manager.getSnapshot()).toMatchObject({ ready: false, issueSummary: { hasGeneralIssue: false } });
  });
  it("fences the rejected-predecessor branch without publishing another issue", async () => {
    let current = true; const { manager } = make({ current: () => current, register: () => {} });
    const stop = manager.subscribe(() => { throw null; });
    await expect(manager.initialize()).rejects.toBeNull(); stop();
    const published = vi.fn(); manager.subscribe(published); current = false;
    await manager.retry(); expect(published).not.toHaveBeenCalled();
  });
  it("keeps ordinary behavior when no native infrastructure is supplied", async () => {
    const { get, manager } = make(); await manager.initialize(); expect(get).toHaveBeenCalled(); expect(manager.getSnapshot().ready).toBe(true);
  });
});
