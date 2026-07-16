// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  getLastAssessmentCustomThreshold,
  getLastAssessmentThresholdPreset,
  getShowAssessmentIntroductionPreference,
  setLastAssessmentCustomThreshold,
  setLastAssessmentThresholdPreset,
  setShowAssessmentIntroductionPreference,
} from "../assessmentPreferences";

beforeEach(() => {
  localStorage.clear();
});

describe("assessment introduction preference", () => {
  it("defaults to true (shown) when nothing is persisted", () => {
    expect(getShowAssessmentIntroductionPreference()).toBe(true);
  });

  it("persists false after being turned off, and can be turned back on", () => {
    setShowAssessmentIntroductionPreference(false);
    expect(getShowAssessmentIntroductionPreference()).toBe(false);

    setShowAssessmentIntroductionPreference(true);
    expect(getShowAssessmentIntroductionPreference()).toBe(true);
  });
});

describe("last-used threshold preset preference", () => {
  it("defaults to standard", () => {
    expect(getLastAssessmentThresholdPreset()).toBe("standard");
  });

  it("round-trips a valid preset", () => {
    setLastAssessmentThresholdPreset("tight");
    expect(getLastAssessmentThresholdPreset()).toBe("tight");

    setLastAssessmentThresholdPreset("custom");
    expect(getLastAssessmentThresholdPreset()).toBe("custom");
  });

  it("falls back to standard for a corrupted persisted value", () => {
    localStorage.setItem("curling-release-tracker-assessment-last-threshold-preset", "not-a-preset");
    expect(getLastAssessmentThresholdPreset()).toBe("standard");
  });
});

describe("last-used custom threshold values preference", () => {
  it("returns null when nothing is persisted", () => {
    expect(getLastAssessmentCustomThreshold()).toBeNull();
  });

  it("round-trips valid custom values", () => {
    setLastAssessmentCustomThreshold({ onTarget: 0.07, acceptable: 0.15 });
    expect(getLastAssessmentCustomThreshold()).toEqual({ onTarget: 0.07, acceptable: 0.15 });
  });

  it("returns null for corrupted JSON rather than throwing", () => {
    localStorage.setItem("curling-release-tracker-assessment-last-custom-threshold", "{not json");
    expect(getLastAssessmentCustomThreshold()).toBeNull();
  });

  it("returns null for a valid-JSON but wrong-shape value", () => {
    localStorage.setItem("curling-release-tracker-assessment-last-custom-threshold", JSON.stringify({ foo: 1 }));
    expect(getLastAssessmentCustomThreshold()).toBeNull();
  });
});
