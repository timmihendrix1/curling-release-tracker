import { describe, expect, it } from "vitest";
import {
  analyzeShots,
  computeHandleAccuracyComparison,
  computeHandleTargetErrorBoxPlots,
  computeTargetAccuracyAnalytics,
  interpretTargetErrorDirection,
} from "../analytics";
import type { Shot } from "../../types";

const THRESHOLDS = { onTarget: 0.1, acceptable: 0.2 };

function makeShot(overrides: Partial<Shot>): Shot {
  return {
    id: overrides.id ?? Math.random().toString(36),
    sessionId: "session-1",
    blockId: "block-1",
    shotNumber: 1,
    releaseTime: 3.75,
    targetTime: 3.75,
    handle: "in",
    shotType: "draw",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

describe("computeTargetAccuracyAnalytics — no shots", () => {
  it("returns null metrics and zero counts, never 0/NaN/Infinity for rates", () => {
    const result = computeTargetAccuracyAnalytics([], THRESHOLDS);
    expect(result.shotCount).toBe(0);
    expect(result.meanTargetError).toBeNull();
    expect(result.meanAbsoluteTargetError).toBeNull();
    expect(result.targetErrorStandardDeviation).toBeNull();
    expect(result.onTargetRate).toBeNull();
    expect(result.acceptableRate).toBeNull();
    expect(result.majorMissRate).toBeNull();
    expect(result.largestAbsoluteMiss).toBeNull();
    expect(result.averageMajorMiss).toBeNull();
  });
});

describe("computeTargetAccuracyAnalytics — categorization", () => {
  // errors: +0.05 (on target), +0.15 (acceptable), +0.30 (major miss, positive),
  // -0.30 (major miss, negative)
  const shots = [
    makeShot({ id: "1", targetTime: 3.75, releaseTime: 3.8 }),
    makeShot({ id: "2", targetTime: 3.75, releaseTime: 3.9 }),
    makeShot({ id: "3", targetTime: 3.75, releaseTime: 4.05 }),
    makeShot({ id: "4", targetTime: 3.75, releaseTime: 3.45 }),
  ];

  const result = computeTargetAccuracyAnalytics(shots, THRESHOLDS);

  it("counts each mutually-exclusive category correctly", () => {
    expect(result.onTargetCount).toBe(1);
    expect(result.acceptableCount).toBe(1);
    expect(result.majorMissCount).toBe(2);
    expect(result.onTargetRate).toBeCloseTo(0.25, 10);
    expect(result.acceptableRate).toBeCloseTo(0.25, 10);
    expect(result.majorMissRate).toBeCloseTo(0.5, 10);
  });

  it("computes bias (signed) separately from magnitude (absolute)", () => {
    // signed errors: 0.05, 0.15, 0.30, -0.30 -> mean = 0.2/4 = 0.05
    expect(result.meanTargetError).toBeCloseTo(0.05, 10);
    // absolute errors: 0.05, 0.15, 0.30, 0.30 -> mean = 0.8/4 = 0.2
    expect(result.meanAbsoluteTargetError).toBeCloseTo(0.2, 10);
  });

  it("splits major misses into positive/negative counts", () => {
    expect(result.positiveMajorMissCount).toBe(1);
    expect(result.negativeMajorMissCount).toBe(1);
  });

  it("computes the largest absolute miss and the average major miss magnitude", () => {
    expect(result.largestAbsoluteMiss).toBeCloseTo(0.3, 10);
    expect(result.averageMajorMiss).toBeCloseTo(0.3, 10);
  });

  it("boundary values land exactly where the category definition says", () => {
    const boundaryShots = [
      makeShot({ id: "b1", targetTime: 3.75, releaseTime: 3.85 }), // exactly onTarget (0.10)
      makeShot({ id: "b2", targetTime: 3.75, releaseTime: 3.95 }), // exactly acceptable (0.20)
    ];
    const boundaryResult = computeTargetAccuracyAnalytics(
      boundaryShots,
      THRESHOLDS
    );
    expect(boundaryResult.onTargetCount).toBe(1);
    expect(boundaryResult.acceptableCount).toBe(1);
    expect(boundaryResult.majorMissCount).toBe(0);
  });
});

describe("computeTargetAccuracyAnalytics — single shot", () => {
  it("computes without a standard-deviation artifact", () => {
    // 3.8 - 3.75 = 0.05, within onTarget (0.10) -> on_target.
    const result = computeTargetAccuracyAnalytics(
      [makeShot({ targetTime: 3.75, releaseTime: 3.8 })],
      THRESHOLDS
    );
    expect(result.shotCount).toBe(1);
    expect(result.targetErrorStandardDeviation).toBe(0);
    expect(result.onTargetRate).toBe(1);
    expect(result.acceptableRate).toBe(0);
  });
});

describe("computeTargetAccuracyAnalytics — different blocks/thresholds are judged independently", () => {
  it("the same shots categorize differently under Tight vs Standard thresholds", () => {
    const shots = [makeShot({ targetTime: 3.75, releaseTime: 3.87 })]; // 0.12 error
    const standard = computeTargetAccuracyAnalytics(shots, {
      onTarget: 0.1,
      acceptable: 0.2,
    });
    const tight = computeTargetAccuracyAnalytics(shots, {
      onTarget: 0.05,
      acceptable: 0.1,
    });

    expect(standard.onTargetCount).toBe(0);
    expect(standard.acceptableCount).toBe(1);
    expect(tight.majorMissCount).toBe(1);
  });
});

describe("computeHandleAccuracyComparison", () => {
  it("groups shots by handle before computing target accuracy per group", () => {
    const shots = [
      makeShot({ handle: "in", targetTime: 3.75, releaseTime: 3.76 }),
      makeShot({ handle: "in", targetTime: 3.75, releaseTime: 3.77 }),
      makeShot({ handle: "out", targetTime: 3.75, releaseTime: 4.1 }),
    ];

    const comparison = computeHandleAccuracyComparison(shots, THRESHOLDS);
    expect(comparison.inHandle.shotCount).toBe(2);
    expect(comparison.outHandle.shotCount).toBe(1);
    expect(comparison.outHandle.majorMissCount).toBe(1);
    expect(comparison.inHandle.majorMissCount).toBe(0);
  });

  it("an absent handle group is not fabricated — it's simply empty (null metrics)", () => {
    const shots = [makeShot({ handle: "in" })];
    const comparison = computeHandleAccuracyComparison(shots, THRESHOLDS);
    expect(comparison.outHandle.shotCount).toBe(0);
    expect(comparison.outHandle.meanTargetError).toBeNull();
  });
});

describe("computeHandleTargetErrorBoxPlots", () => {
  it("computes boxplots over Target Error, not raw Release Time", () => {
    const shots = [
      makeShot({ handle: "in", targetTime: 3.75, releaseTime: 3.85 }), // +0.10
      makeShot({ handle: "in", targetTime: 3.75, releaseTime: 3.65 }), // -0.10
      makeShot({ handle: "out", targetTime: 5.0, releaseTime: 5.05 }), // +0.05
    ];

    const boxPlots = computeHandleTargetErrorBoxPlots(shots);
    // In-handle target errors are [0.10, -0.10] -> median 0, NOT anywhere
    // near the raw release times (3.65, 3.85).
    expect(boxPlots.inHandle.median).toBeCloseTo(0, 10);
    expect(boxPlots.outHandle.median).toBeCloseTo(0.05, 10);
  });
});

describe("interpretTargetErrorDirection", () => {
  it("Back-Hog: a negative target error means faster / more weight / too long", () => {
    const interpretation = interpretTargetErrorDirection(-0.08, "back-hog");
    expect(interpretation.sign).toBe("faster");
    expect(interpretation.curlingTendency).toBe("more-weight-long");
    expect(interpretation.curlingTendencyLabel).toContain("more weight");
  });

  it("Back-Hog: a positive target error means slower / less weight / too short", () => {
    const interpretation = interpretTargetErrorDirection(0.08, "back-hog");
    expect(interpretation.sign).toBe("slower");
    expect(interpretation.curlingTendency).toBe("less-weight-short");
    expect(interpretation.curlingTendencyLabel).toContain("less weight");
  });

  it("Back-Hog: zero error is on-target with no curling tendency", () => {
    const interpretation = interpretTargetErrorDirection(0, "back-hog");
    expect(interpretation.sign).toBe("on-target");
    expect(interpretation.curlingTendency).toBeUndefined();
  });

  it("Hog-Hog never fabricates a curling tendency — only the neutral sign/label", () => {
    const faster = interpretTargetErrorDirection(-0.08, "hog-hog");
    const slower = interpretTargetErrorDirection(0.08, "hog-hog");
    expect(faster.sign).toBe("faster");
    expect(faster.curlingTendency).toBeUndefined();
    expect(faster.curlingTendencyLabel).toBeUndefined();
    expect(slower.sign).toBe("slower");
    expect(slower.curlingTendency).toBeUndefined();
  });

  it("the neutral relative-to-target label never depends on measurement mode", () => {
    const backHog = interpretTargetErrorDirection(0.08, "back-hog");
    const hogHog = interpretTargetErrorDirection(0.08, "hog-hog");
    expect(backHog.relativeToTargetLabel).toBe(hogHog.relativeToTargetLabel);
    expect(backHog.relativeToTargetLabel).toContain("+0.08");
  });
});

describe("analyzeShots — Target Accuracy wiring", () => {
  it("defaults to the legacy thresholds when none are passed (backward compatible)", () => {
    const shots = [makeShot({ targetTime: 3.75, releaseTime: 3.86 })]; // 0.11 error
    const analysis = analyzeShots(shots);
    // Legacy default is 0.10/0.20 -> 0.11 falls in "acceptable"
    expect(analysis.targetAccuracy.acceptableCount).toBe(1);
  });

  it("respects an explicitly passed threshold snapshot", () => {
    const shots = [makeShot({ targetTime: 3.75, releaseTime: 3.86 })]; // 0.11 error
    const analysis = analyzeShots(shots, { onTarget: 0.15, acceptable: 0.3 });
    expect(analysis.targetAccuracy.onTargetCount).toBe(1);
  });

  it("exposes handle accuracy comparison and target-error boxplots alongside existing fields", () => {
    const shots = [
      makeShot({ handle: "in", targetTime: 3.75, releaseTime: 3.8 }),
      makeShot({ handle: "out", targetTime: 3.75, releaseTime: 3.7 }),
    ];
    const analysis = analyzeShots(shots);
    expect(analysis.handleAccuracy.inHandle.shotCount).toBe(1);
    expect(analysis.handleAccuracy.outHandle.shotCount).toBe(1);
    expect(analysis.targetErrorBoxPlot.count).toBe(2);
    expect(analysis.handleTargetErrorBoxPlots.inHandle.count).toBe(1);
    // Pre-existing fields are untouched.
    expect(analysis.count).toBe(2);
    expect(analysis.byHandle.in.count).toBe(1);
  });
});
