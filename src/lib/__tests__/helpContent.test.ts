import { describe, expect, it } from "vitest";
import type { BlockMode, MeasurementMode } from "../../types";
import {
  backHogExplanation,
  blindWeightExplanation,
  fixedWeightExplanation,
  hogHogExplanation,
  measurementModeExplanation,
  trainingCategoryExplanation,
  variableWeightExplanation,
  type FeatureExplanation,
} from "../helpContent";

const ALL_BLOCK_MODES: BlockMode[] = ["fixed", "variable", "blind"];
const ALL_MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];

function expectWellFormed(explanation: FeatureExplanation) {
  expect(explanation.title.length).toBeGreaterThan(0);
  expect(explanation.shortDescription.length).toBeGreaterThan(0);
  expect(explanation.purpose.length).toBeGreaterThan(0);
  expect(explanation.howItWorks.length).toBeGreaterThan(0);
}

describe("Training Category explanations", () => {
  it("gives every Training Category a well-formed explanation", () => {
    for (const mode of ALL_BLOCK_MODES) {
      expectWellFormed(trainingCategoryExplanation(mode));
    }
  });

  it("does not miss any Training Category", () => {
    const ids = ALL_BLOCK_MODES.map((mode) => trainingCategoryExplanation(mode).id);
    expect(new Set(ids).size).toBe(ALL_BLOCK_MODES.length);
  });

  it("Fixed Weight explains reproducibility, not adaptability", () => {
    const explanation = fixedWeightExplanation();
    expect(explanation.purpose.toLowerCase()).toContain("repeatedly reproduce");
    expect(explanation.usefulFor).toContain("Handle comparison");
  });

  it("Variable Weight explains adaptation and mentions the scatterplot", () => {
    const explanation = variableWeightExplanation();
    expect(explanation.purpose.toLowerCase()).toContain("adapt");
    expect(
      explanation.howItWorks.some((line) => line.toLowerCase().includes("scatterplot"))
    ).toBe(true);
  });

  it("Blind Weight distinguishes Prediction Accuracy from Target Accuracy", () => {
    const explanation = blindWeightExplanation();
    expect(explanation.howItWorks.some((line) => line.includes("Prediction Accuracy"))).toBe(
      true
    );
    expect(explanation.howItWorks.some((line) => line.includes("Target Accuracy"))).toBe(
      true
    );
  });

  it("never frames Blind Weight as elite-only", () => {
    const explanation = blindWeightExplanation();
    const allText = [
      explanation.shortDescription,
      explanation.purpose,
      ...explanation.howItWorks,
      ...explanation.usefulFor,
      ...(explanation.limitations ?? []),
    ]
      .join(" ")
      .toLowerCase();

    expect(allText).not.toContain("elite");
    expect(allText).not.toContain("beginner");
    expect(allText).not.toContain("advanced players only");
  });

  it("never claims one Training Category is better than another", () => {
    const allExplanations = ALL_BLOCK_MODES.map(trainingCategoryExplanation);
    for (const explanation of allExplanations) {
      const allText = [
        explanation.shortDescription,
        explanation.purpose,
        ...explanation.howItWorks,
        ...explanation.usefulFor,
        ...(explanation.limitations ?? []),
      ]
        .join(" ")
        .toLowerCase();

      expect(allText).not.toContain("better than");
      expect(allText).not.toContain("superior");
      expect(allText).not.toContain("harder than");
      expect(allText).not.toContain("easier than");
    }
  });
});

describe("Measurement Mode explanations", () => {
  it("gives every Measurement Mode a well-formed explanation", () => {
    for (const mode of ALL_MEASUREMENT_MODES) {
      expectWellFormed(measurementModeExplanation(mode));
    }
  });

  it("Backline – Hog explains the weight direction consistently with the rest of the app", () => {
    const explanation = backHogExplanation();
    expect(explanation.howItWorks.some((line) => line.includes("more weight"))).toBe(
      true
    );
    expect(explanation.howItWorks.some((line) => line.includes("less weight"))).toBe(
      true
    );
  });

  it("Hog – Hog never claims a weight/outcome interpretation", () => {
    const explanation = hogHogExplanation();
    const allText = [explanation.purpose, ...explanation.howItWorks].join(" ");
    expect(allText).not.toContain("more weight");
    expect(allText).not.toContain("less weight");
  });

  it("Hog – Hog explicitly warns against mixing with Backline – Hog", () => {
    const explanation = hogHogExplanation();
    const allText = [
      ...explanation.howItWorks,
      ...(explanation.limitations ?? []),
    ]
      .join(" ")
      .toLowerCase();
    expect(allText).toContain("backline");
  });
});
