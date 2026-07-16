import { describe, expect, it } from "vitest";
import {
  ASSESSMENT_STANDARD_THRESHOLDS,
  ASSESSMENT_TIGHT_THRESHOLDS,
  cloneAccuracyThresholdSet,
  createAccuracyThresholdSet,
  standardAssessmentThresholdSet,
  tightAssessmentThresholdSet,
  validateThresholdValues,
} from "../thresholds";

describe("Assessment threshold presets", () => {
  it("Standard preset is 0.10s on-target / 0.20s acceptable", () => {
    expect(ASSESSMENT_STANDARD_THRESHOLDS).toEqual({ onTarget: 0.1, acceptable: 0.2 });
  });

  it("Tight preset is 0.05s on-target / 0.10s acceptable", () => {
    expect(ASSESSMENT_TIGHT_THRESHOLDS).toEqual({ onTarget: 0.05, acceptable: 0.1 });
  });

  it("standardAssessmentThresholdSet() builds a valid, correctly-typed set", () => {
    const set = standardAssessmentThresholdSet();
    expect(set.type).toBe("standard");
    expect(set.values).toEqual({ onTarget: 0.1, acceptable: 0.2 });
    expect(set.source).toBe("default");
    expect(typeof set.selectedAt).toBe("string");
  });

  it("tightAssessmentThresholdSet() builds a valid, correctly-typed set", () => {
    const set = tightAssessmentThresholdSet();
    expect(set.type).toBe("tight");
    expect(set.values).toEqual({ onTarget: 0.05, acceptable: 0.1 });
  });
});

describe("validateThresholdValues", () => {
  it("accepts a valid Custom pair", () => {
    expect(validateThresholdValues(0.08, 0.15)).toEqual({ valid: true });
  });

  it("rejects onTarget equal to acceptable", () => {
    const result = validateThresholdValues(0.1, 0.1);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("on_target_must_be_less_than_acceptable");
  });

  it("rejects onTarget greater than acceptable", () => {
    const result = validateThresholdValues(0.3, 0.1);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("on_target_must_be_less_than_acceptable");
  });

  it("rejects negative values", () => {
    const result = validateThresholdValues(-0.1, 0.2);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("on_target_must_be_positive");
  });

  it("rejects zero values", () => {
    const result = validateThresholdValues(0, 0.2);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("on_target_must_be_positive");
  });

  it("rejects NaN", () => {
    const result = validateThresholdValues(NaN, 0.2);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("on_target_must_be_finite");
  });

  it("rejects Infinity", () => {
    const result = validateThresholdValues(0.1, Infinity);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("acceptable_must_be_finite");
  });

  it("rejects unsupported (sub-hundredth-second) precision", () => {
    const result = validateThresholdValues(0.101, 0.2);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("unsupported_precision");
  });

  it("rejects a value far outside the supported technical range", () => {
    const result = validateThresholdValues(0.1, 50);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.issues).toContain("out_of_supported_range");
  });
});

describe("createAccuracyThresholdSet", () => {
  it("returns a structured error for an invalid candidate rather than throwing", () => {
    const outcome = createAccuracyThresholdSet("custom", { onTarget: 0.3, acceptable: 0.1 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_threshold_set");
  });

  it("builds a valid Custom set with athlete-selected provenance by default", () => {
    const outcome = createAccuracyThresholdSet("custom", { onTarget: 0.08, acceptable: 0.15 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.source).toBe("athlete-selected");
      expect(outcome.value.type).toBe("custom");
    }
  });
});

describe("cloneAccuracyThresholdSet", () => {
  it("deep-copies values so mutating the clone never affects the original", () => {
    const original = standardAssessmentThresholdSet();
    const clone = cloneAccuracyThresholdSet(original);
    clone.values.onTarget = 999;
    expect(original.values.onTarget).toBe(0.1);
    expect(clone).not.toBe(original);
    expect(clone.values).not.toBe(original.values);
  });
});
