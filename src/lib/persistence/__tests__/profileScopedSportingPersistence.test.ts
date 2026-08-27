import { describe, expect, it } from "vitest";
import {
  LEGACY_SPORTING_RETIREMENT_MARKER_KEY,
  SPORTING_STORAGE_KEYS,
  createProfileScopedSportingRepositories,
  createProfileScopedSportingStorageAdapter,
  profileScopedSportingStorageKey,
  retireLegacyUnscopedSportingData,
} from "../profileScopedSportingPersistence";
import type {
  PersistenceRemoveResult,
  PersistenceWriteResult,
  RemovableStorageAdapter,
  StorageGetResult,
} from "../types";
import { SHOW_INTRODUCTION_KEY } from "../../assessmentPreferencesRepository";

const PROFILE_A = "11111111-1111-4111-8111-111111111111";
const PROFILE_B = "22222222-2222-4222-8222-222222222222";

class MemoryStorage implements RemovableStorageAdapter {
  readonly values = new Map<string, string>();
  readonly gets: string[] = [];
  readonly sets: Array<[string, string]> = [];
  readonly removes: string[] = [];
  readonly failedRemovals = new Set<string>();
  failReads = false;
  failMarkerWrite = false;
  throwReads = false;
  throwWrites = false;
  throwRemovals = false;

  async get(key: string): Promise<StorageGetResult> {
    this.gets.push(key);
    if (this.throwReads) throw new Error("secret read failure");
    if (this.failReads) {
      return { status: "read_failed", fallback: null, error: { kind: "storage_unavailable" } };
    }
    return { status: "value", value: this.values.get(key) ?? null };
  }

  async set(key: string, value: string): Promise<PersistenceWriteResult> {
    this.sets.push([key, value]);
    if (this.throwWrites) throw new Error("secret write failure");
    if (this.failMarkerWrite && key === LEGACY_SPORTING_RETIREMENT_MARKER_KEY) {
      return { ok: false, error: { kind: "storage_unavailable" } };
    }
    this.values.set(key, value);
    return { ok: true };
  }

  async remove(key: string): Promise<PersistenceRemoveResult> {
    this.removes.push(key);
    if (this.throwRemovals) throw new Error("secret removal failure");
    if (this.failedRemovals.has(key)) {
      return { ok: false, error: { kind: "removal_failed", message: "fixed" } };
    }
    this.values.delete(key);
    return { ok: true };
  }
}

describe("Profile-scoped sporting storage", () => {
  it("maps the same logical key to different physical keys for two Profiles", () => {
    expect(profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY)).not.toBe(
      profileScopedSportingStorageKey(PROFILE_B, SHOW_INTRODUCTION_KEY)
    );
    expect(profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY)).toBe(
      `curling.sporting.profile.v1.${PROFILE_A}.${SHOW_INTRODUCTION_KEY}`
    );
  });

  it("rejects a provider account id, malformed UUID and unregistered key", async () => {
    expect(() => createProfileScopedSportingStorageAdapter("account-123")).toThrow(
      "The sporting persistence scope is invalid."
    );
    expect(() =>
      profileScopedSportingStorageKey("NOT-A-UUID", SHOW_INTRODUCTION_KEY)
    ).toThrow("The sporting persistence scope is invalid.");

    const storage = new MemoryStorage();
    const adapter = createProfileScopedSportingStorageAdapter(PROFILE_A, storage);
    await expect(adapter.get("curling.identity.trustedDevice.v1")).resolves.toEqual({
      status: "read_failed",
      fallback: null,
      error: { kind: "unknown", message: "The sporting persistence key is not registered." },
    });
    await expect(adapter.set("unregistered", "value")).resolves.toEqual({
      ok: false,
      error: { kind: "unknown", message: "The sporting persistence key is not registered." },
    });
    expect(storage.gets).toEqual([]);
    expect(storage.sets).toEqual([]);
  });

  it("isolates repository reads and writes without changing repository APIs", async () => {
    const storage = new MemoryStorage();
    const a = createProfileScopedSportingRepositories(PROFILE_A, storage);
    const b = createProfileScopedSportingRepositories(PROFILE_B, storage);

    await expect(a.assessmentPreferences.setShowIntroduction(false)).resolves.toEqual({ ok: true });
    await expect(b.assessmentPreferences.setShowIntroduction(true)).resolves.toEqual({ ok: true });
    await expect(a.assessmentPreferences.getShowIntroduction()).resolves.toEqual({
      status: "value",
      value: false,
    });
    await expect(b.assessmentPreferences.getShowIntroduction()).resolves.toEqual({
      status: "value",
      value: true,
    });

    expect(storage.values.get(profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY))).toBe(
      "false"
    );
    expect(storage.values.get(profileScopedSportingStorageKey(PROFILE_B, SHOW_INTRODUCTION_KEY))).toBe(
      "true"
    );
    expect(storage.values.has(SHOW_INTRODUCTION_KEY)).toBe(false);
  });

  it("keeps an old Profile adapter permanently bound after a new Profile adapter exists", async () => {
    const storage = new MemoryStorage();
    const a = createProfileScopedSportingStorageAdapter(PROFILE_A, storage);
    const pendingAWrite = a.set(SHOW_INTRODUCTION_KEY, "false");
    const b = createProfileScopedSportingStorageAdapter(PROFILE_B, storage);
    await b.set(SHOW_INTRODUCTION_KEY, "true");
    await pendingAWrite;

    expect(storage.sets.map(([key]) => key)).toEqual([
      profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY),
      profileScopedSportingStorageKey(PROFILE_B, SHOW_INTRODUCTION_KEY),
    ]);
  });

  it("registers exactly ten logical keys and no duplicate", () => {
    expect(SPORTING_STORAGE_KEYS).toHaveLength(10);
    expect(new Set(SPORTING_STORAGE_KEYS).size).toBe(10);
  });
});

describe("legacy unscoped sporting-data retirement", () => {
  it("removes exactly the ten allowlisted legacy keys without reading their contents", async () => {
    const storage = new MemoryStorage();
    for (const key of SPORTING_STORAGE_KEYS) storage.values.set(key, `secret:${key}`);
    storage.values.set("curling.identity.trustedDevice.v1", "keep-identity");
    storage.values.set(profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY), "keep-a");
    storage.values.set("unrelated", "keep-unrelated");

    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: true,
      status: "retired",
    });

    expect(storage.gets).toEqual([LEGACY_SPORTING_RETIREMENT_MARKER_KEY]);
    expect(storage.removes).toEqual(SPORTING_STORAGE_KEYS);
    for (const key of SPORTING_STORAGE_KEYS) expect(storage.values.has(key)).toBe(false);
    expect(storage.values.get("curling.identity.trustedDevice.v1")).toBe("keep-identity");
    expect(storage.values.get(profileScopedSportingStorageKey(PROFILE_A, SHOW_INTRODUCTION_KEY))).toBe(
      "keep-a"
    );
    expect(storage.values.get("unrelated")).toBe("keep-unrelated");
    expect(storage.values.get(LEGACY_SPORTING_RETIREMENT_MARKER_KEY)).toBe("complete");
  });

  it("uses the completion marker to make later calls a no-op", async () => {
    const storage = new MemoryStorage();
    storage.values.set(LEGACY_SPORTING_RETIREMENT_MARKER_KEY, "complete");
    storage.values.set(SPORTING_STORAGE_KEYS[0], "written by a non-participating old build");

    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: true,
      status: "already_retired",
    });
    expect(storage.removes).toEqual([]);
    expect(storage.values.get(SPORTING_STORAGE_KEYS[0])).toBe(
      "written by a non-participating old build"
    );
  });

  it("attempts every bounded removal and withholds the marker when one fails", async () => {
    const storage = new MemoryStorage();
    storage.failedRemovals.add(SPORTING_STORAGE_KEYS[3]);
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: false,
      reason: "legacy_removal_failed",
    });
    expect(storage.removes).toEqual(SPORTING_STORAGE_KEYS);
    expect(storage.values.has(LEGACY_SPORTING_RETIREMENT_MARKER_KEY)).toBe(false);

    storage.failedRemovals.clear();
    storage.removes.length = 0;
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: true,
      status: "retired",
    });
    expect(storage.removes).toEqual(SPORTING_STORAGE_KEYS);
  });

  it("fails closed before deletion when marker state cannot be read", async () => {
    const storage = new MemoryStorage();
    storage.failReads = true;
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: false,
      reason: "marker_read_failed",
    });
    expect(storage.removes).toEqual([]);
    expect(storage.sets).toEqual([]);
  });

  it("retries safely when the marker write fails after successful removals", async () => {
    const storage = new MemoryStorage();
    storage.failMarkerWrite = true;
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: false,
      reason: "marker_write_failed",
    });
    expect(storage.removes).toEqual(SPORTING_STORAGE_KEYS);
    expect(storage.values.has(LEGACY_SPORTING_RETIREMENT_MARKER_KEY)).toBe(false);

    storage.failMarkerWrite = false;
    storage.removes.length = 0;
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: true,
      status: "retired",
    });
    expect(storage.removes).toEqual(SPORTING_STORAGE_KEYS);
  });

  it("normalizes rejecting adapter implementations without leaking thrown values", async () => {
    const storage = new MemoryStorage();
    storage.throwReads = true;
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: false,
      reason: "marker_read_failed",
    });

    storage.throwReads = false;
    storage.throwRemovals = true;
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: false,
      reason: "legacy_removal_failed",
    });

    storage.throwRemovals = false;
    storage.throwWrites = true;
    await expect(retireLegacyUnscopedSportingData(storage)).resolves.toEqual({
      ok: false,
      reason: "marker_write_failed",
    });
  });
});
