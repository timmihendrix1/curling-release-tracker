// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createAccuracyToleranceProfilesRepository } from "../repository";
import {
  ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
  createEmptyAccuracyToleranceProfilesState,
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

describe("AccuracyToleranceProfilesRepository", () => {
  it("resolves { status: 'absent' } when nothing is stored", async () => {
    localStorage.clear();
    const repo = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("absent");
  });

  it("resolves { status: 'value' } for a real stored profile list, distinct from absent", async () => {
    localStorage.clear();
    // Deliberately the real STORED legacy (schema version 1) shape: a symmetric,
    // unitless seconds pair. It must load — never be wiped by the version bump — and
    // must come back as the time template it always was, with its numbers unchanged.
    const state = {
      schemaVersion: LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
      profiles: [
        {
          id: "p1",
          name: "Strict",
          onTarget: 0.05,
          acceptable: 0.1,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      defaultProfileId: "p1",
    };
    localStorage.setItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY, JSON.stringify(state));
    const repo = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value.profiles).toHaveLength(1);
      expect(result.value.profiles[0].quantity).toBe("time");
      expect(result.value.profiles[0].tolerance).toEqual({
        onTarget: { lower: 0.05, upper: 0.05 },
        acceptable: { lower: 0.1, upper: 0.1 },
      });
      expect(result.value.defaultProfileId).toBe("p1");
    }
  });

  it("clears a dangling defaultProfileId to null", async () => {
    localStorage.clear();
    localStorage.setItem(
      ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
        profiles: [],
        defaultProfileId: "nonexistent",
      })
    );
    const repo = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value.defaultProfileId).toBeNull();
    }
  });

  it("treats unparseable JSON as UNREADABLE, not absent (ADR-0051)", async () => {
    // Reporting absence would hand the application an empty but *writable* state,
    // which its ordinary save effect writes straight back over the stored bytes.
    // Unreadable data must be protected instead, so it stays recoverable.
    localStorage.clear();
    localStorage.setItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY, "{not json");
    const repo = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("read_failed");
    expect(localStorage.getItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY)).toBe("{not json");
  });

  it("resolves { status: 'read_failed' } on a genuine storage failure with an empty fallback", async () => {
    const repo = createAccuracyToleranceProfilesRepository(fakeFailingAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.fallback).toEqual(createEmptyAccuracyToleranceProfilesState());
    }
  });

  it("saveState() serializes the whole object as given, without reconstructing a wrapper", async () => {
    localStorage.clear();
    const repo = createAccuracyToleranceProfilesRepository(createLocalStorageAdapter());
    const state = createEmptyAccuracyToleranceProfilesState();
    await repo.saveState(state);
    expect(JSON.parse(localStorage.getItem(ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY)!)).toEqual(state);
  });

  it("saveState() surfaces a write failure as a typed result", async () => {
    const repo = createAccuracyToleranceProfilesRepository(fakeFailingAdapter());
    const result = await repo.saveState(createEmptyAccuracyToleranceProfilesState());
    expect(result.ok).toBe(false);
  });
});
