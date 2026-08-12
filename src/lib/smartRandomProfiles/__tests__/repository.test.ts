// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createSmartRandomProfilesRepository } from "../repository";
import {
  createEmptySmartRandomProfilesState,
  SMART_RANDOM_PROFILES_SCHEMA_VERSION,
  SMART_RANDOM_PROFILES_STORAGE_KEY,
} from "../persistence";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import type { StorageAdapter } from "../../persistence/types";

function fakeFailingAdapter(): StorageAdapter {
  return {
    async get() {
      return { status: "read_failed", fallback: null, error: { kind: "unknown", message: "x" } };
    },
    async set() {
      return { ok: false, error: { kind: "unknown", message: "x" } };
    },
  };
}

describe("SmartRandomProfilesRepository", () => {
  it("resolves { status: 'absent' } when nothing is stored", async () => {
    localStorage.clear();
    const repo = createSmartRandomProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("absent");
  });

  it("resolves { status: 'value' } for a real stored profile list, distinct from absent", async () => {
    localStorage.clear();
    const state = {
      schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
      profiles: [
        {
          id: "p1",
          name: "Wide",
          measurementMode: "back-hog",
          min: 2.5,
          max: 4.5,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      defaultProfileId: "p1",
    };
    localStorage.setItem(SMART_RANDOM_PROFILES_STORAGE_KEY, JSON.stringify(state));
    const repo = createSmartRandomProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value.profiles).toHaveLength(1);
    }
  });

  it("quarantines a profile whose measurementMode no longer supports Smart Random", async () => {
    localStorage.clear();
    localStorage.setItem(
      SMART_RANDOM_PROFILES_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
        profiles: [
          {
            id: "p1",
            name: "Invalid",
            measurementMode: "hog-hog",
            min: 2.5,
            max: 4.5,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        defaultProfileId: "p1",
      })
    );
    const repo = createSmartRandomProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value.profiles).toHaveLength(0);
      expect(result.value.defaultProfileId).toBeNull();
    }
  });

  it("treats unparseable JSON as absent", async () => {
    localStorage.clear();
    localStorage.setItem(SMART_RANDOM_PROFILES_STORAGE_KEY, "{not json");
    const repo = createSmartRandomProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("absent");
  });

  it("resolves { status: 'read_failed' } on a genuine storage failure with an empty fallback", async () => {
    const repo = createSmartRandomProfilesRepository(fakeFailingAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.fallback).toEqual(createEmptySmartRandomProfilesState());
    }
  });

  it("saveState() serializes the whole object as given", async () => {
    localStorage.clear();
    const repo = createSmartRandomProfilesRepository(createLocalStorageAdapter());
    const state = createEmptySmartRandomProfilesState();
    await repo.saveState(state);
    expect(JSON.parse(localStorage.getItem(SMART_RANDOM_PROFILES_STORAGE_KEY)!)).toEqual(state);
  });

  it("saveState() surfaces a write failure as a typed result", async () => {
    const repo = createSmartRandomProfilesRepository(fakeFailingAdapter());
    const result = await repo.saveState(createEmptySmartRandomProfilesState());
    expect(result.ok).toBe(false);
  });
});
