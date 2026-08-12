// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  createAssessmentPreferencesRepository,
  LAST_CUSTOM_THRESHOLD_KEY,
  LAST_THRESHOLD_PRESET_KEY,
} from "../assessmentPreferencesRepository";
import { createLocalStorageAdapter } from "../persistence/localStorageAdapter";
import type { StorageAdapter } from "../persistence/types";

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

beforeEach(() => {
  localStorage.clear();
});

describe("AssessmentPreferencesRepository — show introduction", () => {
  it("resolves { status: 'absent' } when nothing is persisted", async () => {
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    const result = await repo.getShowIntroduction();
    expect(result).toEqual({ status: "absent" });
  });

  it("round-trips a value, distinct from absent", async () => {
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    await repo.setShowIntroduction(false);
    const result = await repo.getShowIntroduction();
    expect(result).toEqual({ status: "value", value: false });

    await repo.setShowIntroduction(true);
    expect(await repo.getShowIntroduction()).toEqual({ status: "value", value: true });
  });

  it("evaluates an unrecognized stored string as false, not as the absent default", async () => {
    localStorage.setItem("curling-release-tracker-assessment-show-introduction", "garbage");
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    expect(await repo.getShowIntroduction()).toEqual({ status: "value", value: false });
  });

  it("resolves { status: 'read_failed' } with fallback true on a genuine storage failure", async () => {
    const repo = createAssessmentPreferencesRepository(fakeFailingAdapter());
    const result = await repo.getShowIntroduction();
    expect(result).toEqual({
      status: "read_failed",
      fallback: true,
      error: { kind: "unknown", message: "x" },
    });
  });
});

describe("AssessmentPreferencesRepository — last threshold preset", () => {
  it("resolves { status: 'absent' } when nothing is persisted", async () => {
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    expect(await repo.getLastThresholdPreset()).toEqual({ status: "absent" });
  });

  it("round-trips a valid preset", async () => {
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    await repo.setLastThresholdPreset("tight");
    expect(await repo.getLastThresholdPreset()).toEqual({ status: "value", value: "tight" });

    await repo.setLastThresholdPreset("custom");
    expect(await repo.getLastThresholdPreset()).toEqual({ status: "value", value: "custom" });
  });

  it("repairs an invalid stored preset to 'standard' as a 'value' result, not absent", async () => {
    localStorage.setItem(LAST_THRESHOLD_PRESET_KEY, "not-a-preset");
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    expect(await repo.getLastThresholdPreset()).toEqual({ status: "value", value: "standard" });
  });

  it("resolves { status: 'read_failed' } with fallback 'standard'", async () => {
    const repo = createAssessmentPreferencesRepository(fakeFailingAdapter());
    const result = await repo.getLastThresholdPreset();
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.fallback).toBe("standard");
    }
  });
});

describe("AssessmentPreferencesRepository — last custom threshold", () => {
  it("resolves { status: 'absent' } when nothing is persisted", async () => {
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    expect(await repo.getLastCustomThreshold()).toEqual({ status: "absent" });
  });

  it("round-trips valid custom values", async () => {
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    await repo.setLastCustomThreshold({ onTarget: 0.07, acceptable: 0.15 });
    expect(await repo.getLastCustomThreshold()).toEqual({
      status: "value",
      value: { onTarget: 0.07, acceptable: 0.15 },
    });
  });

  it("repairs corrupted JSON to a null 'value', not absent", async () => {
    localStorage.setItem(LAST_CUSTOM_THRESHOLD_KEY, "{not json");
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    expect(await repo.getLastCustomThreshold()).toEqual({ status: "value", value: null });
  });

  it("repairs a valid-JSON but wrong-shape value to a null 'value', not absent", async () => {
    localStorage.setItem(LAST_CUSTOM_THRESHOLD_KEY, JSON.stringify({ foo: 1 }));
    const repo = createAssessmentPreferencesRepository(createLocalStorageAdapter());
    expect(await repo.getLastCustomThreshold()).toEqual({ status: "value", value: null });
  });

  it("resolves { status: 'read_failed' } with a null fallback", async () => {
    const repo = createAssessmentPreferencesRepository(fakeFailingAdapter());
    const result = await repo.getLastCustomThreshold();
    expect(result).toEqual({
      status: "read_failed",
      fallback: null,
      error: { kind: "unknown", message: "x" },
    });
  });
});
