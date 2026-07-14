import { describe, expect, it } from "vitest";
import {
  acceptableExplanation,
  averageErrorExplanation,
  biasExplanation,
  consistencyExplanation,
  handleBiasConsistencyExplanation,
  handleBoxplotExplanation,
  largestMissExplanation,
  majorMissExplanation,
  onTargetExplanation,
  progressMetricExplanation,
  shotQualityExplanation,
  targetErrorByShotExplanation,
  targetVsActualExplanation,
} from "../analyticsExplanations";

const THRESHOLDS = { onTarget: 0.1, acceptable: 0.2 };

describe("analyticsExplanations", () => {
  it("gives every core metric an explanation with the required shape", () => {
    const explanations = [
      biasExplanation("back-hog"),
      averageErrorExplanation(),
      consistencyExplanation(),
      onTargetExplanation(THRESHOLDS),
      acceptableExplanation(THRESHOLDS),
      majorMissExplanation(THRESHOLDS),
      largestMissExplanation(),
    ];

    for (const explanation of explanations) {
      expect(explanation.title.length).toBeGreaterThan(0);
      expect(explanation.shortDescription.length).toBeGreaterThan(0);
      expect(explanation.whatItShows.length).toBeGreaterThan(0);
      expect(explanation.betterMeans.length).toBeGreaterThan(0);
    }
  });

  it("gives every core chart an explanation", () => {
    const explanations = [
      targetErrorByShotExplanation("back-hog", "current"),
      targetVsActualExplanation("history"),
      handleBoxplotExplanation(),
      handleBiasConsistencyExplanation(2),
      progressMetricExplanation("meanAbsoluteTargetError"),
      shotQualityExplanation(),
    ];

    for (const explanation of explanations) {
      expect(explanation.whatItShows.length).toBeGreaterThan(0);
    }
  });

  it("includes the Back-Hog curling interpretation only for Back-Hog", () => {
    const backHog = biasExplanation("back-hog");
    const hogHog = biasExplanation("hog-hog");

    expect(backHog.howToRead.some((line) => line.includes("more weight"))).toBe(
      true
    );
    expect(hogHog.howToRead.some((line) => line.includes("more weight"))).toBe(
      false
    );
  });

  it("keeps Hog-Hog's Target Error by Shot explanation neutral", () => {
    const backHog = targetErrorByShotExplanation("back-hog", "current");
    const hogHog = targetErrorByShotExplanation("hog-hog", "current");

    expect(backHog.howToRead.some((line) => line.includes("more weight"))).toBe(
      true
    );
    expect(hogHog.howToRead.some((line) => line.includes("more weight"))).toBe(
      false
    );
  });

  it("interpolates the active thresholds into On Target / Acceptable / Major Miss text", () => {
    const tight = { onTarget: 0.05, acceptable: 0.1 };

    expect(onTargetExplanation(tight).whatItShows).toContain("±0.05s");
    expect(acceptableExplanation(tight).whatItShows).toContain("±0.10s");
    expect(majorMissExplanation(tight).whatItShows).toContain("±0.10s");
  });

  it("distinguishes Major Miss from a statistical outlier", () => {
    const majorMiss = majorMissExplanation(THRESHOLDS);
    const boxplot = handleBoxplotExplanation();

    expect(
      majorMiss.howToRead.some((line) => line.toLowerCase().includes("statistical"))
    ).toBe(true);
    expect(
      boxplot.howToRead.some((line) => line.toLowerCase().includes("major miss"))
    ).toBe(true);
  });

  it("gives Current Session and History different framing for the same chart", () => {
    const current = targetErrorByShotExplanation("back-hog", "current");
    const history = targetErrorByShotExplanation("back-hog", "history");

    expect(current.possiblePatterns).not.toEqual(history.possiblePatterns);
  });

  it("singularizes the Handle Bias/Consistency description for one handle", () => {
    const both = handleBiasConsistencyExplanation(2);
    const single = handleBiasConsistencyExplanation(1);

    expect(both.shortDescription.toLowerCase()).toContain("compares");
    expect(single.shortDescription.toLowerCase()).not.toContain("compares");
  });
});
