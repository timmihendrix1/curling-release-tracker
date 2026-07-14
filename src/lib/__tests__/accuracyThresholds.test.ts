import { describe, expect, it } from "vitest";
import {
  ACCURACY_THRESHOLD_PRESETS,
  categorizeTargetError,
  LEGACY_ACCURACY_THRESHOLDS,
  resolveAccuracyThresholds,
  STANDARD_ACCURACY_THRESHOLDS,
  TIGHT_ACCURACY_THRESHOLDS,
  validateAccuracyThresholds,
} from "../accuracyThresholds";

describe("presets", () => {
  it("Standard is 0.10s on-target / 0.20s acceptable", () => {
    expect(STANDARD_ACCURACY_THRESHOLDS).toEqual({
      onTarget: 0.1,
      acceptable: 0.2,
    });
    expect(ACCURACY_THRESHOLD_PRESETS.standard).toBe(STANDARD_ACCURACY_THRESHOLDS);
  });

  it("Tight is 0.05s on-target / 0.10s acceptable", () => {
    expect(TIGHT_ACCURACY_THRESHOLDS).toEqual({
      onTarget: 0.05,
      acceptable: 0.1,
    });
    expect(ACCURACY_THRESHOLD_PRESETS.tight).toBe(TIGHT_ACCURACY_THRESHOLDS);
  });

  it("the legacy migration default is the Standard preset", () => {
    expect(LEGACY_ACCURACY_THRESHOLDS).toBe(STANDARD_ACCURACY_THRESHOLDS);
  });
});

describe("validateAccuracyThresholds", () => {
  it("accepts a valid custom pair", () => {
    const result = validateAccuracyThresholds(0.08, 0.15);
    expect(result).toEqual({ valid: true, onTarget: 0.08, acceptable: 0.15 });
  });

  it("rejects negative values", () => {
    expect(validateAccuracyThresholds(-0.1, 0.2).valid).toBe(false);
    expect(validateAccuracyThresholds(0.1, -0.2).valid).toBe(false);
  });

  it("rejects zero for either bound", () => {
    expect(validateAccuracyThresholds(0, 0.2).valid).toBe(false);
    expect(validateAccuracyThresholds(0.1, 0).valid).toBe(false);
  });

  it("rejects NaN", () => {
    expect(validateAccuracyThresholds(NaN, 0.2).valid).toBe(false);
    expect(validateAccuracyThresholds(0.1, NaN).valid).toBe(false);
  });

  it("rejects Infinity", () => {
    expect(validateAccuracyThresholds(Infinity, 0.2).valid).toBe(false);
    expect(validateAccuracyThresholds(0.1, Infinity).valid).toBe(false);
  });

  it("rejects acceptable <= onTarget", () => {
    expect(validateAccuracyThresholds(0.2, 0.2).valid).toBe(false);
    expect(validateAccuracyThresholds(0.2, 0.1).valid).toBe(false);
  });

  it("accepts very small but positive, finite-precision values", () => {
    expect(validateAccuracyThresholds(0.001, 0.002).valid).toBe(true);
  });
});

describe("resolveAccuracyThresholds", () => {
  it("returns the given thresholds when valid", () => {
    expect(resolveAccuracyThresholds({ onTarget: 0.05, acceptable: 0.1 })).toEqual({
      onTarget: 0.05,
      acceptable: 0.1,
    });
  });

  it("falls back to the legacy default when undefined", () => {
    expect(resolveAccuracyThresholds(undefined)).toEqual(LEGACY_ACCURACY_THRESHOLDS);
  });

  it("falls back to the legacy default when invalid (acceptable <= onTarget)", () => {
    expect(
      resolveAccuracyThresholds({ onTarget: 0.2, acceptable: 0.1 })
    ).toEqual(LEGACY_ACCURACY_THRESHOLDS);
  });

  it("falls back to the legacy default for NaN/Infinity/zero/negative", () => {
    expect(resolveAccuracyThresholds({ onTarget: NaN, acceptable: 0.2 })).toEqual(
      LEGACY_ACCURACY_THRESHOLDS
    );
    expect(
      resolveAccuracyThresholds({ onTarget: 0.1, acceptable: Infinity })
    ).toEqual(LEGACY_ACCURACY_THRESHOLDS);
    expect(resolveAccuracyThresholds({ onTarget: 0, acceptable: 0.2 })).toEqual(
      LEGACY_ACCURACY_THRESHOLDS
    );
    expect(
      resolveAccuracyThresholds({ onTarget: -0.1, acceptable: 0.2 })
    ).toEqual(LEGACY_ACCURACY_THRESHOLDS);
  });

  it("never derives a repaired value from a different preset — always the fixed legacy default", () => {
    // Even though Tight is a "nicer" preset, an invalid stored value must
    // never silently become Tight — only the fixed legacy default.
    const repaired = resolveAccuracyThresholds({ onTarget: -1, acceptable: -1 });
    expect(repaired).not.toEqual(TIGHT_ACCURACY_THRESHOLDS);
    expect(repaired).toEqual(STANDARD_ACCURACY_THRESHOLDS);
  });
});

describe("categorizeTargetError", () => {
  const thresholds = { onTarget: 0.1, acceptable: 0.2 };

  it("categorizes exactly at the on-target boundary as on_target", () => {
    expect(categorizeTargetError(0.1, thresholds)).toBe("on_target");
  });

  it("categorizes just above the on-target boundary as acceptable", () => {
    expect(categorizeTargetError(0.1001, thresholds)).toBe("acceptable");
  });

  it("categorizes exactly at the acceptable boundary as acceptable", () => {
    expect(categorizeTargetError(0.2, thresholds)).toBe("acceptable");
  });

  it("categorizes just above the acceptable boundary as major_miss", () => {
    expect(categorizeTargetError(0.2001, thresholds)).toBe("major_miss");
  });

  it("categorizes zero error as on_target", () => {
    expect(categorizeTargetError(0, thresholds)).toBe("on_target");
  });

  it("absorbs floating-point subtraction noise exactly at a boundary", () => {
    // 3.85 - 3.75 is 0.10000000000000009 in IEEE 754, not exactly 0.1 — a
    // real shot recorded at these round values must still categorize as
    // on_target, not acceptable, due to that noise.
    const noisyBoundary = 3.85 - 3.75;
    expect(noisyBoundary).not.toBe(0.1); // documents the floating-point artifact itself
    expect(categorizeTargetError(noisyBoundary, thresholds)).toBe("on_target");
  });

  it("does not let the epsilon blur two genuinely different values", () => {
    expect(categorizeTargetError(0.11, thresholds)).toBe("acceptable");
    expect(categorizeTargetError(0.21, thresholds)).toBe("major_miss");
  });
});
