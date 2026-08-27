// The resolution repository (ADR-0025 §6, §19, §F).
//
// The load-bearing assertion in this file: **writing resolution B cannot alter,
// overwrite, remove or resolve a newer barrier C.** Every resolution lives under a
// key derived from its own barrier's id, so cross-barrier interference is
// impossible by construction rather than prevented by a check.
import { describe, expect, it } from "vitest";
import { createIdentityBarrierResolutionRepository } from "../identityBarrierResolutionRepository";
import {
  createIdentityBarrierResolution,
  resolutionStorageKeyFor,
} from "../identityBarrierResolution";
import {
  ATTEMPT_A,
  BARRIER_A,
  BARRIER_B,
  BARRIER_C,
  FIXED_NOW,
  FLOW_X,
  STORAGE_KEYS,
  createMemoryStorage,
} from "./support/identityTestHarness";

function resolution(barrierId: string, accountScopeId = "account-a") {
  return createIdentityBarrierResolution({
    barrierId,
    attemptId: ATTEMPT_A,
    method: "google",
    flowId: FLOW_X,
    identityGeneration: 1,
    authenticatedAccountScopeId: accountScopeId,
    resolvedAt: FIXED_NOW,
  });
}

describe("per-barrier keys isolate resolutions completely", () => {
  it("writes under the key derived from the resolution's own barrierId", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await repository.saveForBarrier(resolution(BARRIER_A));
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(true);
    expect(storage.store.size).toBe(1);
  });

  it("writing resolution B leaves a newer barrier C's key completely untouched", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);

    await repository.saveForBarrier(resolution(BARRIER_B));

    // Barrier C is now current. Its resolution key was never created, never
    // overwritten and never removed.
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(false);
    await expect(repository.loadForBarrier(BARRIER_C)).resolves.toEqual({ status: "absent" });
    expect(
      storage.calls.filter((call) => call.includes(BARRIER_C) && call.startsWith("remove:"))
    ).toEqual([]);
    // And B's own resolution is still there, harmless, under its own key.
    const bLoad = await repository.loadForBarrier(BARRIER_B);
    expect(bLoad.status).toBe("value");
  });

  it("never touches the barrier key itself", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await repository.saveForBarrier(resolution(BARRIER_A));
    await repository.loadForBarrier(BARRIER_A);
    await repository.cleanUpNonCurrentResolution(BARRIER_A, BARRIER_B);
    expect(storage.calls.filter((call) => call.endsWith(STORAGE_KEYS.barrier))).toEqual([]);
  });
});

describe("loadForBarrier", () => {
  it("round-trips the resolution for that exact barrier", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    const written = resolution(BARRIER_A);
    await repository.saveForBarrier(written);
    await expect(repository.loadForBarrier(BARRIER_A)).resolves.toEqual({
      status: "value",
      value: written,
    });
  });

  it("reports `malformed` when the record found under a barrier's key names a DIFFERENT barrier", async () => {
    // The key says where it was found; the field says what it claims. Only
    // agreeing on both makes it evidence.
    const storage = createMemoryStorage();
    storage.seed(STORAGE_KEYS.resolutionFor(BARRIER_A), resolution(BARRIER_B));
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await expect(repository.loadForBarrier(BARRIER_A)).resolves.toEqual({ status: "malformed" });
  });

  it("reports `malformed` for an unusable barrier id rather than pretending there is no resolution", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    for (const id of ["../accessBarrier", "", "not-a-uuid"]) {
      await expect(repository.loadForBarrier(id), id).resolves.toEqual({ status: "malformed" });
    }
    // No storage access at all was attempted for an unaddressable id.
    expect(storage.calls).toEqual([]);
  });

  it("reports malformed stored material and read failures distinctly", async () => {
    const corrupt = createMemoryStorage();
    corrupt.seedRaw(STORAGE_KEYS.resolutionFor(BARRIER_A), "{oops");
    await expect(
      createIdentityBarrierResolutionRepository(corrupt.adapter).loadForBarrier(BARRIER_A)
    ).resolves.toEqual({ status: "malformed" });

    const failing = createMemoryStorage();
    failing.failReads.add(STORAGE_KEYS.resolutionFor(BARRIER_A));
    await expect(
      createIdentityBarrierResolutionRepository(failing.adapter).loadForBarrier(BARRIER_A)
    ).resolves.toEqual({ status: "read_failed", error: { kind: "storage_unavailable" } });
  });
});

describe("saveForBarrier", () => {
  it("reports a normalized failure when the write fails, with no raw storage text", async () => {
    const storage = createMemoryStorage();
    storage.failWrites.add(STORAGE_KEYS.resolutionFor(BARRIER_A));
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await expect(repository.saveForBarrier(resolution(BARRIER_A))).resolves.toEqual({
      ok: false,
      error: { kind: "storage_unavailable" },
    });
  });

  it("refuses to write when no key can be derived", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    const unaddressable = { ...resolution(BARRIER_A), barrierId: "../escape" };
    const result = await repository.saveForBarrier(unaddressable);
    expect(result.ok).toBe(false);
    expect(storage.calls).toEqual([]);
    expect(resolutionStorageKeyFor("../escape")).toBeNull();
  });
});

describe("retractUnconfirmedResolution — exact required compensation", () => {
  it("removes only the resolution derived from the supplied barrier id", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await repository.saveForBarrier(resolution(BARRIER_A));
    await repository.saveForBarrier(resolution(BARRIER_C));

    await expect(repository.retractUnconfirmedResolution(BARRIER_A)).resolves.toEqual({ ok: true });
    await expect(repository.loadForBarrier(BARRIER_A)).resolves.toEqual({ status: "absent" });
    await expect(repository.loadForBarrier(BARRIER_C)).resolves.toEqual({
      status: "value",
      value: resolution(BARRIER_C),
    });
  });

  it("refuses an unaddressable id without touching storage", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);

    const result = await repository.retractUnconfirmedResolution("../escape");

    expect(result.ok).toBe(false);
    expect(storage.calls).toEqual([]);
  });
});

describe("cleanUpNonCurrentResolution — non-current ONLY", () => {
  it("REFUSES when the barrier asked about is the current one", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await repository.saveForBarrier(resolution(BARRIER_A));
    storage.calls.length = 0;

    await expect(repository.cleanUpNonCurrentResolution(BARRIER_A, BARRIER_A)).resolves.toEqual({
      kind: "retained_current",
    });
    expect(storage.calls).toEqual([]);
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(true);
  });

  it("removes a superseded barrier's resolution", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await repository.saveForBarrier(resolution(BARRIER_A));
    await repository.saveForBarrier(resolution(BARRIER_C));
    await expect(repository.cleanUpNonCurrentResolution(BARRIER_A, BARRIER_C)).resolves.toEqual({
      kind: "removed",
    });
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
    // The CURRENT barrier's resolution is untouched.
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(true);
  });

  it("reports not_addressable rather than touching anything", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await expect(repository.cleanUpNonCurrentResolution("../escape", BARRIER_C)).resolves.toEqual({
      kind: "not_addressable",
    });
    expect(storage.calls).toEqual([]);
  });

  it("a cleanup failure changes nothing and never throws", async () => {
    const storage = createMemoryStorage();
    const repository = createIdentityBarrierResolutionRepository(storage.adapter);
    await repository.saveForBarrier(resolution(BARRIER_A));
    storage.failRemoves.add(STORAGE_KEYS.resolutionFor(BARRIER_A));
    await expect(repository.cleanUpNonCurrentResolution(BARRIER_A, BARRIER_C)).resolves.toEqual({
      kind: "cleanup_failed",
    });
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(true);

    storage.failRemoves.clear();
    storage.throwRemoves.add(STORAGE_KEYS.resolutionFor(BARRIER_A));
    await expect(repository.cleanUpNonCurrentResolution(BARRIER_A, BARRIER_C)).resolves.toEqual({
      kind: "cleanup_failed",
    });
  });
});
