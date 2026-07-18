import { describe, expect, it } from "vitest";
import { mapPlanStepToTrainingBlockInput } from "../mapping";
import { buildStep } from "./testHelpers";

describe("mapPlanStepToTrainingBlockInput", () => {
  it("carries the step's configuration straight through to a NewBlockInput", () => {
    const step = buildStep({
      configuration: {
        name: "Warm-up Weight",
        mode: "variable",
        measurementMode: "back-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
        blindTargetMode: "fixed",
        smartRandomMin: 2.6,
        smartRandomMax: 4.2,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    });

    const input = mapPlanStepToTrainingBlockInput(step);

    expect(input).toEqual({
      name: "Warm-up Weight",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
      blindTargetMode: "fixed",
      smartRandomMin: 2.6,
      smartRandomMax: 4.2,
      accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
    });
  });

  it("falls back to the mode's default block name when the step has no name", () => {
    const step = buildStep({
      configuration: {
        name: "",
        mode: "blind",
        measurementMode: "back-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
        blindTargetMode: "fixed",
        smartRandomMin: 2.5,
        smartRandomMax: 4.5,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    });

    expect(mapPlanStepToTrainingBlockInput(step).name).toBe("Blind Weight Block");
  });

  it("generates a new runtime block via createTrainingBlock rather than copying the step id", () => {
    const step = buildStep();
    const input = mapPlanStepToTrainingBlockInput(step);
    expect(input).not.toHaveProperty("id");
  });
});
