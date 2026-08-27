// The barrier repository (ADR-0025 §6, §19, §F). The property this file exists to
// prove: **there is no removal path for the current barrier, at all.**
import { describe, expect, it } from "vitest";
import {
  createIdentityBarrierRepository,
  identityBarrierRepository,
  type IdentityBarrierRepository,
} from "../identityBarrierRepository";
import { IDENTITY_BARRIER_STORAGE_KEY, createIdentityAccessBarrier } from "../identityBarrier";
import { createMemoryStorage, BARRIER_A, BARRIER_B, FIXED_NOW } from "./support/identityTestHarness";
import type { StorageAdapter } from "../../persistence/types";

function barrier(barrierId: string) {
  return createIdentityAccessBarrier({
    barrierId,
    origin: "interactive_authentication",
    barredAccountScopeId: null,
    barredGeneration: null,
    establishedAt: FIXED_NOW,
  });
}

describe("no removal path exists", () => {
  it("the interface has no remove member", () => {
    const repository: IdentityBarrierRepository = identityBarrierRepository;
    // @ts-expect-error a barrier repository must not expose any removal operation
    const removal = repository.remove;
    expect(removal).toBeUndefined();
    expect(Object.keys(repository).sort()).toEqual(["load", "save"]);
  });

  it("the factory's adapter parameter is the BASE contract, so `remove` is erased inside", () => {
    // Passing the real removable adapter is normal; the narrower parameter type is
    // what makes its `remove` unreachable from inside the module.
    const storage = createMemoryStorage();
    const asBase: StorageAdapter = storage.adapter;
    const repository = createIdentityBarrierRepository(asBase);
    expect(repository).toBeDefined();
    // @ts-expect-error the base StorageAdapter has no `remove`
    expect(asBase.remove).toBeDefined();
  });

  it("never calls the adapter's remove, for any operation", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierRepository(storage.adapter);
    await repository.save(barrier(BARRIER_A));
    await repository.load();
    await repository.save(barrier(BARRIER_B));
    await repository.load();
    expect(storage.calls.filter((call) => call.startsWith("remove:"))).toEqual([]);
  });
});

describe("load and save", () => {
  it("reports `absent` for an empty key", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierRepository(storage.adapter);
    await expect(repository.load()).resolves.toEqual({ status: "absent" });
  });

  it("round-trips a barrier", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierRepository(storage.adapter);
    const written = barrier(BARRIER_A);
    await expect(repository.save(written)).resolves.toEqual({ ok: true });
    await expect(repository.load()).resolves.toEqual({ status: "value", value: written });
    expect(storage.store.has(IDENTITY_BARRIER_STORAGE_KEY)).toBe(true);
  });

  it("a newer barrier supersedes an older one on the shared key — always deny-ward", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierRepository(storage.adapter);
    await repository.save(barrier(BARRIER_A));
    await repository.save(barrier(BARRIER_B));
    const loaded = await repository.load();
    expect(loaded.status === "value" && loaded.value.barrierId).toBe(BARRIER_B);
  });

  it("reports `malformed` — never `absent` — for unusable stored material", async () => {
    for (const raw of ["{oops", "null", "7", '{"schemaVersion":2}', '{"schemaVersion":1}']) {
      const storage = createMemoryStorage();
      storage.seedRaw(IDENTITY_BARRIER_STORAGE_KEY, raw);
      const repository = createIdentityBarrierRepository(storage.adapter);
      // Failing closed for a record that only ever DENIES means treating it as
      // present and unresolved, so the caller quarantines rather than proceeding.
      await expect(repository.load(), raw).resolves.toEqual({ status: "malformed" });
    }
  });

  it("reports `read_failed` with the storage kind, and never throws", async () => {
    const storage = createMemoryStorage();
    storage.failReads.add(IDENTITY_BARRIER_STORAGE_KEY);
    const repository = createIdentityBarrierRepository(storage.adapter);
    await expect(repository.load()).resolves.toEqual({
      status: "read_failed",
      error: { kind: "storage_unavailable" },
    });
  });

  it("contains an adapter whose get throws", async () => {
    const storage = createMemoryStorage();
    storage.throwReads.add(IDENTITY_BARRIER_STORAGE_KEY);
    const repository = createIdentityBarrierRepository(storage.adapter);
    await expect(repository.load()).resolves.toEqual({
      status: "read_failed",
      error: { kind: "unknown" },
    });
  });

  it("reports a normalized write failure without raw storage text", async () => {
    const storage = createMemoryStorage();
    storage.failWrites.add(IDENTITY_BARRIER_STORAGE_KEY);
    const repository = createIdentityBarrierRepository(storage.adapter);
    const result = await repository.save(barrier(BARRIER_A));
    expect(result).toEqual({ ok: false, error: { kind: "storage_unavailable" } });
  });
});
