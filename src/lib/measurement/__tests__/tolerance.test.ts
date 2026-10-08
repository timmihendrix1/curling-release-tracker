import { describe, expect, it } from "vitest";
import type { QuantityTolerance } from "../../../types";
import {
  categorizeTargetError,
  STANDARD_ACCURACY_THRESHOLDS,
  TIGHT_ACCURACY_THRESHOLDS,
} from "../../accuracyThresholds";
import {
  categorizeDeviation,
  DEFAULT_SPEED_ACCEPTABLE,
  DEFAULT_SPEED_ON_TARGET,
  DEFAULT_SPEED_TOLERANCE,
  isSymmetricTolerance,
  isValidQuantityValue,
  quantityUnitLabel,
  symmetricTolerance,
  toleranceAsAccuracyThresholds,
  toleranceFromAccuracyThresholds,
  validateQuantityTolerance,
} from "../tolerance";

const asymmetric: QuantityTolerance = {
  onTarget: { lower: 0.04, upper: 0.08 },
  acceptable: { lower: 0.09, upper: 0.2 },
};

describe("quantity tolerance validation", () => {
  it("accepts a valid symmetric tolerance", () => {
    const result = validateQuantityTolerance(symmetricTolerance(0.05, 0.1));
    expect(result.valid).toBe(true);
  });

  it("accepts independent lower and upper tolerances on both bands", () => {
    expect(validateQuantityTolerance(asymmetric).valid).toBe(true);
  });

  it.each([
    ["a zero side", { onTarget: { lower: 0, upper: 0.05 }, acceptable: { lower: 0.1, upper: 0.1 } }],
    ["a negative side", { onTarget: { lower: -0.05, upper: 0.05 }, acceptable: { lower: 0.1, upper: 0.1 } }],
    ["a NaN side", { onTarget: { lower: Number.NaN, upper: 0.05 }, acceptable: { lower: 0.1, upper: 0.1 } }],
    ["an infinite side", { onTarget: { lower: 0.05, upper: 0.05 }, acceptable: { lower: Number.POSITIVE_INFINITY, upper: 0.1 } }],
  ])("rejects %s", (_label, tolerance) => {
    expect(validateQuantityTolerance(tolerance as QuantityTolerance).valid).toBe(false);
  });

  it("rejects an Acceptable band that does not extend beyond On Target on the LOWER side", () => {
    const result = validateQuantityTolerance({
      onTarget: { lower: 0.1, upper: 0.05 },
      acceptable: { lower: 0.1, upper: 0.2 },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an Acceptable band that does not extend beyond On Target on the UPPER side", () => {
    const result = validateQuantityTolerance({
      onTarget: { lower: 0.05, upper: 0.2 },
      acceptable: { lower: 0.1, upper: 0.2 },
    });
    expect(result.valid).toBe(false);
  });

  it("rejects an absent tolerance rather than substituting a default", () => {
    expect(validateQuantityTolerance(undefined).valid).toBe(false);
  });
});

describe("categorizeDeviation", () => {
  const tolerance = symmetricTolerance(0.1, 0.2);

  it("treats an exact zero deviation as On Target", () => {
    expect(categorizeDeviation(0, tolerance)).toBe("on_target");
  });

  it("includes both exact band boundaries in the inner category", () => {
    expect(categorizeDeviation(0.1, tolerance)).toBe("on_target");
    expect(categorizeDeviation(-0.1, tolerance)).toBe("on_target");
    expect(categorizeDeviation(0.2, tolerance)).toBe("acceptable");
    expect(categorizeDeviation(-0.2, tolerance)).toBe("acceptable");
  });

  it("classifies just beyond a boundary as the outer category", () => {
    expect(categorizeDeviation(0.1001, tolerance)).toBe("acceptable");
    expect(categorizeDeviation(0.2001, tolerance)).toBe("major_miss");
  });

  it("absorbs floating-point subtraction noise at a boundary without rounding first", () => {
    // 3.85 - 3.75 is 0.10000000000000009, not 0.1 — this must still be On Target,
    // and it must be reached by comparing the RAW deviation, not a pre-rounded one.
    const deviation = 3.85 - 3.75;
    expect(deviation).toBeGreaterThan(0.1);
    expect(categorizeDeviation(deviation, tolerance)).toBe("on_target");

    const lower = 3.65 - 3.75;
    expect(lower).toBeLessThan(-0.1);
    expect(categorizeDeviation(lower, tolerance)).toBe("on_target");
  });

  it("applies each side independently when the tolerance is asymmetric", () => {
    // Lower side is tight (0.04 / 0.09), upper side is wide (0.08 / 0.20).
    expect(categorizeDeviation(-0.05, asymmetric)).toBe("acceptable");
    expect(categorizeDeviation(0.05, asymmetric)).toBe("on_target");

    expect(categorizeDeviation(-0.1, asymmetric)).toBe("major_miss");
    expect(categorizeDeviation(0.1, asymmetric)).toBe("acceptable");

    expect(categorizeDeviation(-0.04, asymmetric)).toBe("on_target");
    expect(categorizeDeviation(0.08, asymmetric)).toBe("on_target");
    expect(categorizeDeviation(-0.09, asymmetric)).toBe("acceptable");
    expect(categorizeDeviation(0.2, asymmetric)).toBe("acceptable");
    expect(categorizeDeviation(0.2001, asymmetric)).toBe("major_miss");
  });

  it("is a total, mutually exclusive partition", () => {
    const deviations = [-5, -0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3, 5];
    const categories = deviations.map((deviation) =>
      categorizeDeviation(deviation, tolerance)
    );
    expect(categories).toHaveLength(deviations.length);
    expect(
      categories.every((category) =>
        ["on_target", "acceptable", "major_miss"].includes(category)
      )
    ).toBe(true);
  });
});

describe("legacy AccuracyThresholds keep their exact historical meaning", () => {
  // The per-side model must be a lossless re-expression of the symmetric pair, not a
  // reinterpretation: every value must land in exactly the same category as before.
  const sampleDeviations: number[] = [];
  for (let value = -0.5; value <= 0.5; value += 0.001) {
    sampleDeviations.push(Number(value.toFixed(3)));
  }
  sampleDeviations.push(3.85 - 3.75, 3.65 - 3.75, 0, -0, 1e-12, -1e-12);

  it.each([
    ["standard", STANDARD_ACCURACY_THRESHOLDS],
    ["tight", TIGHT_ACCURACY_THRESHOLDS],
    ["custom", { onTarget: 0.07, acceptable: 0.13 }],
  ])("matches categorizeTargetError for every sampled deviation (%s)", (_label, thresholds) => {
    const tolerance = toleranceFromAccuracyThresholds(thresholds);
    for (const deviation of sampleDeviations) {
      expect(categorizeDeviation(deviation, tolerance)).toBe(
        categorizeTargetError(Math.abs(deviation), thresholds)
      );
    }
  });

  it("round-trips a symmetric tolerance back to its threshold pair", () => {
    const tolerance = toleranceFromAccuracyThresholds(STANDARD_ACCURACY_THRESHOLDS);
    expect(isSymmetricTolerance(tolerance)).toBe(true);
    expect(toleranceAsAccuracyThresholds(tolerance)).toEqual(
      STANDARD_ACCURACY_THRESHOLDS
    );
  });

  it("refuses to collapse an asymmetric tolerance into one symmetric pair", () => {
    expect(isSymmetricTolerance(asymmetric)).toBe(false);
    expect(toleranceAsAccuracyThresholds(asymmetric)).toBeUndefined();
  });
});

describe("speed defaults and units", () => {
  it("starts at +/-0.05 and +/-0.10 m/s", () => {
    expect(DEFAULT_SPEED_ON_TARGET).toBe(0.05);
    expect(DEFAULT_SPEED_ACCEPTABLE).toBe(0.1);
    expect(DEFAULT_SPEED_TOLERANCE).toEqual({
      onTarget: { lower: 0.05, upper: 0.05 },
      acceptable: { lower: 0.1, upper: 0.1 },
    });
    expect(validateQuantityTolerance(DEFAULT_SPEED_TOLERANCE).valid).toBe(true);
  });

  it("labels each quantity with its own unit and never shares one", () => {
    expect(quantityUnitLabel("time")).toBe("s");
    expect(quantityUnitLabel("speed")).toBe("m/s");
  });

  it("accepts only finite positive measured values", () => {
    expect(isValidQuantityValue(2.4)).toBe(true);
    expect(isValidQuantityValue(0)).toBe(false);
    expect(isValidQuantityValue(-1)).toBe(false);
    expect(isValidQuantityValue(Number.NaN)).toBe(false);
    expect(isValidQuantityValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidQuantityValue("2.4")).toBe(false);
    expect(isValidQuantityValue(undefined)).toBe(false);
  });
});
