import { describe, expect, it } from "vitest";
import {
  analyzeShots,
  averageAbsoluteDeviationFromTarget,
  averageDeviationFromTarget,
  meanAbsolutePredictionError,
  meanPredictionError,
  pearsonCorrelation,
  predictionCorrelation,
  predictionErrorStandardDeviation,
  predictionErrors,
  releaseTimeStandardDeviation,
  standardDeviationOfValues,
  targetErrorStandardDeviation,
} from "../analytics";
import type { Shot } from "../../types";

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

describe("analyzeShots — Fixed Weight (single shared target)", () => {
  const shots = [
    makeShot({ id: "1", releaseTime: 3.7, targetTime: 3.75 }),
    makeShot({ id: "2", releaseTime: 3.8, targetTime: 3.75 }),
    makeShot({ id: "3", releaseTime: 3.75, targetTime: 3.75 }),
  ];

  it("matches a plain single-target calculation", () => {
    const releaseTimes = shots.map((s) => s.releaseTime);
    const analysis = analyzeShots(shots);

    expect(analysis.average).toBeCloseTo(average(releaseTimes), 10);
    expect(analysis.releaseTimeStandardDeviation).toBeCloseTo(
      standardDeviationOfValues(releaseTimes),
      10
    );
    expect(analysis.averageDeviationFromTarget).toBeCloseTo(
      average(releaseTimes.map((t) => t - 3.75)),
      10
    );
  });

  function average(values: number[]): number {
    return values.reduce((a, b) => a + b, 0) / values.length;
  }
});

describe("analyzeShots — Variable Weight (per-shot targets)", () => {
  const shots = [
    makeShot({ id: "1", releaseTime: 3.0, targetTime: 3.0 }), // perfect
    makeShot({ id: "2", releaseTime: 4.0, targetTime: 3.5 }), // +0.5 off
    makeShot({ id: "3", releaseTime: 4.0, targetTime: 4.5 }), // -0.5 off
  ];

  it("judges each shot against its own target, not a single block target", () => {
    const analysis = analyzeShots(shots);
    // Two shots are 0.5s off in opposite directions, one is exact -> bias ~ 0.
    expect(analysis.averageDeviationFromTarget).toBeCloseTo(0, 10);
    expect(analysis.averageAbsoluteDeviationFromTarget).toBeCloseTo(
      (0 + 0.5 + 0.5) / 3,
      10
    );
  });

  it("separates release-time spread from target-error spread", () => {
    const releaseSd = releaseTimeStandardDeviation(shots);
    const targetErrorSd = targetErrorStandardDeviation(shots);

    // Release times vary a lot (3.0, 4.0, 4.0) but every shot is within
    // 0.5s of its own target, so these two numbers must differ.
    expect(releaseSd).toBeGreaterThan(targetErrorSd);
  });
});

describe("target deviation helpers", () => {
  it("averageDeviationFromTarget and averageAbsoluteDeviationFromTarget use shot.targetTime", () => {
    const shots = [
      makeShot({ releaseTime: 3.8, targetTime: 3.75 }),
      makeShot({ releaseTime: 3.7, targetTime: 3.75 }),
    ];

    expect(averageDeviationFromTarget(shots)).toBeCloseTo(0, 10);
    expect(averageAbsoluteDeviationFromTarget(shots)).toBeCloseTo(0.05, 10);
  });

  it("returns 0 for an empty shot list", () => {
    expect(averageDeviationFromTarget([])).toBe(0);
    expect(averageAbsoluteDeviationFromTarget([])).toBe(0);
    expect(releaseTimeStandardDeviation([])).toBe(0);
    expect(targetErrorStandardDeviation([])).toBe(0);
  });
});

// The exact example dataset from the Blind Weight spec:
// target 3.75 throughout; (predicted, actual) pairs: (3.80,3.78), (3.70,3.74), (3.90,3.85)
const BLIND_SAMPLE_SHOTS: Shot[] = [
  makeShot({ id: "b1", targetTime: 3.75, predictedTime: 3.8, releaseTime: 3.78 }),
  makeShot({ id: "b2", targetTime: 3.75, predictedTime: 3.7, releaseTime: 3.74 }),
  makeShot({ id: "b3", targetTime: 3.75, predictedTime: 3.9, releaseTime: 3.85 }),
];

describe("Blind Weight prediction metrics", () => {
  it("predictionErrors = predictedTime - releaseTime per shot", () => {
    // 3.80-3.78=0.02, 3.70-3.74=-0.04, 3.90-3.85=0.05
    const errors = predictionErrors(BLIND_SAMPLE_SHOTS);
    expect(errors[0]).toBeCloseTo(0.02, 10);
    expect(errors[1]).toBeCloseTo(-0.04, 10);
    expect(errors[2]).toBeCloseTo(0.05, 10);
  });

  it("meanPredictionError is the signed average (systematic bias)", () => {
    // (0.02 - 0.04 + 0.05) / 3 = 0.03 / 3 = 0.01
    expect(meanPredictionError(BLIND_SAMPLE_SHOTS)).toBeCloseTo(0.01, 10);
  });

  it("meanAbsolutePredictionError is the average magnitude", () => {
    // (0.02 + 0.04 + 0.05) / 3 = 0.11 / 3
    expect(meanAbsolutePredictionError(BLIND_SAMPLE_SHOTS)).toBeCloseTo(
      0.11 / 3,
      10
    );
  });

  it("predictionErrorStandardDeviation is the spread of those errors", () => {
    // errors [0.02, -0.04, 0.05], mean 0.01
    // deviations [0.01, -0.05, 0.04] -> squared [0.0001, 0.0025, 0.0016]
    // variance = 0.0042/3 = 0.0014 -> sd = sqrt(0.0014)
    expect(predictionErrorStandardDeviation(BLIND_SAMPLE_SHOTS)).toBeCloseTo(
      Math.sqrt(0.0014),
      10
    );
  });

  it("predictionCorrelation matches an independently computed Pearson r", () => {
    // means: predicted 3.8, actual 3.79
    // dx = [0, -0.1, 0.1]; dy = [-0.01, -0.05, 0.06]
    // numerator = 0 + 0.005 + 0.006 = 0.011
    // sumSqX = 0.02, sumSqY = 0.0062
    // r = 0.011 / sqrt(0.02 * 0.0062)
    const expected = 0.011 / Math.sqrt(0.02 * 0.0062);
    expect(predictionCorrelation(BLIND_SAMPLE_SHOTS)).toBeCloseTo(expected, 10);
  });

  it("fewer than two shots with a prediction -> null, not 0 or NaN", () => {
    expect(meanPredictionError([])).toBeNull();
    expect(meanAbsolutePredictionError([])).toBeNull();
    expect(predictionErrorStandardDeviation([])).toBeNull();
    expect(predictionCorrelation([BLIND_SAMPLE_SHOTS[0]])).toBeNull();
  });

  it("constant prediction values -> correlation is null, not a divide-by-zero artifact", () => {
    const constantPredictions = [
      makeShot({ predictedTime: 3.75, releaseTime: 3.7 }),
      makeShot({ predictedTime: 3.75, releaseTime: 3.8 }),
      makeShot({ predictedTime: 3.75, releaseTime: 3.9 }),
    ];
    const correlation = predictionCorrelation(constantPredictions);
    expect(correlation).toBeNull();
    expect(correlation).not.toBeNaN();
  });

  it("constant release-time values -> correlation is null", () => {
    const constantActuals = [
      makeShot({ predictedTime: 3.7, releaseTime: 3.75 }),
      makeShot({ predictedTime: 3.8, releaseTime: 3.75 }),
      makeShot({ predictedTime: 3.9, releaseTime: 3.75 }),
    ];
    expect(predictionCorrelation(constantActuals)).toBeNull();
  });

  it("pearsonCorrelation never returns NaN or Infinity for degenerate input", () => {
    expect(pearsonCorrelation([1], [1])).toBeNull();
    expect(pearsonCorrelation([1, 1], [2, 2])).toBeNull();
    expect(pearsonCorrelation([], [])).toBeNull();
  });

  it("shots without a predictedTime are ignored, not treated as a 0 prediction error", () => {
    const mixed = [
      ...BLIND_SAMPLE_SHOTS,
      makeShot({ id: "fixed-1", releaseTime: 10, targetTime: 3.75 }), // no predictedTime — an outlier if wrongly included
    ];

    expect(meanPredictionError(mixed)).toBeCloseTo(
      meanPredictionError(BLIND_SAMPLE_SHOTS)!,
      10
    );
    expect(predictionErrors(mixed)).toHaveLength(3);
  });

  it("analyzeShots exposes prediction metrics only from shots that filtering left in", () => {
    const filteredToOneHandle = BLIND_SAMPLE_SHOTS.filter(
      (shot) => shot.handle === "in"
    );
    const analysis = analyzeShots(filteredToOneHandle);
    expect(analysis.prediction.count).toBe(filteredToOneHandle.length);

    const noneLeft = analyzeShots([]);
    expect(noneLeft.prediction.count).toBe(0);
    expect(noneLeft.prediction.meanError).toBeNull();
    expect(noneLeft.prediction.correlation).toBeNull();
  });

  it("a session mixing Fixed/Variable/Blind shots only computes prediction metrics from the Blind ones", () => {
    const mixedModes = [
      makeShot({ id: "fixed-1", releaseTime: 3.7, targetTime: 3.75 }),
      makeShot({ id: "variable-1", releaseTime: 3.6, targetTime: 3.6 }),
      ...BLIND_SAMPLE_SHOTS,
    ];

    const analysis = analyzeShots(mixedModes);
    expect(analysis.prediction.count).toBe(3);
    expect(analysis.prediction.meanError).toBeCloseTo(
      meanPredictionError(BLIND_SAMPLE_SHOTS)!,
      10
    );
    // Target-error metrics still cover every shot, blind or not.
    expect(analysis.count).toBe(5);
  });
});
