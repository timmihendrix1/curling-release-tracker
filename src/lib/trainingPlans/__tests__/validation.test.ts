import { describe, expect, it } from "vitest";
import { isPlanExecutable, isStepExecutable, validatePlan, validatePlanStep } from "../validation";
import { buildExerciseStep, buildPlan, buildStep } from "./testHelpers";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { ROTATION_COUNT_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";

describe("isStepExecutable", () => {
  it("fails closed instead of throwing when legacy input reaches the boundary without a snapshot", () => {
    const legacyStep = buildStep() as unknown as Record<string, unknown>;
    delete legacyStep.exerciseVersionSnapshot;

    expect(isStepExecutable(legacyStep as never)).toBe(false);
  });

  it("is true for a valid Fixed Weight step", () => {
    expect(isStepExecutable(buildStep())).toBe(true);
  });

  it("accepts a curated Solo Technique or Shotmaking step", () => {
    expect(isStepExecutable(buildExerciseStep())).toBe(true);
  });

  it("accepts a standalone Measured Exercise assigned to the generic runner", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID);
    if (!version) throw new Error("Missing Rotation Count fixture");
    expect(isStepExecutable(buildExerciseStep({ exerciseVersionSnapshot: version }))).toBe(true);
  });

  it("rejects Rotation Count when it is mislabeled as a Release Timing step", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID);
    if (!version) throw new Error("Missing Rotation Count fixture");
    expect(isStepExecutable(buildStep({ exerciseVersionSnapshot: version }))).toBe(false);
  });

  it("rejects a tampered Exercise Version snapshot", () => {
    const step = buildExerciseStep();
    step.exerciseVersionSnapshot = {
      ...step.exerciseVersionSnapshot,
      title: "Changed after plan creation",
    };
    expect(isStepExecutable(step)).toBe(false);
  });

  it("is false when the completion count is not a positive integer", () => {
    expect(
      isStepExecutable(buildStep({ completion: { type: "shot-count", value: 0 } }))
    ).toBe(false);
    expect(
      isStepExecutable(buildStep({ completion: { type: "shot-count", value: -3 } }))
    ).toBe(false);
  });

  it("is false for Hog-Hog + Smart Random — never fabricates a Hog-Hog range", () => {
    const step = buildStep({
      configuration: {
        name: "",
        mode: "variable",
        measurementMode: "hog-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
        blindTargetMode: "fixed",
        smartRandomMin: 2.5,
        smartRandomMax: 4.5,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    });

    expect(isStepExecutable(step)).toBe(false);
  });

  it("is true for Hog-Hog + Coach/Manual (Smart Random restriction doesn't apply)", () => {
    const step = buildStep({
      configuration: {
        name: "",
        mode: "variable",
        measurementMode: "hog-hog",
        targetTime: 3.75,
        variableTargetMode: "manual",
        blindTargetMode: "fixed",
        smartRandomMin: 2.5,
        smartRandomMax: 4.5,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    });

    expect(isStepExecutable(step)).toBe(true);
  });

  it("is false for an invalid Smart Random range", () => {
    const step = buildStep({
      configuration: {
        name: "",
        mode: "variable",
        measurementMode: "back-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
        blindTargetMode: "fixed",
        smartRandomMin: 4.5,
        smartRandomMax: 2.5,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    });

    expect(isStepExecutable(step)).toBe(false);
  });
});

describe("isPlanExecutable", () => {
  it("is false for a plan with no steps", () => {
    expect(isPlanExecutable(buildPlan({ steps: [] }))).toBe(false);
  });

  it("is false if any single step is unexecutable, even if others are valid", () => {
    const invalidStep = buildStep({
      configuration: {
        name: "",
        mode: "variable",
        measurementMode: "hog-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
        blindTargetMode: "fixed",
        smartRandomMin: 2.5,
        smartRandomMax: 4.5,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    });

    expect(isPlanExecutable(buildPlan({ steps: [buildStep(), invalidStep] }))).toBe(false);
  });

  it("is true when every step is executable", () => {
    expect(isPlanExecutable(buildPlan({ steps: [buildStep(), buildStep()] }))).toBe(true);
  });

  it("is true for a mixed curated Exercise and Release Time sequence", () => {
    expect(isPlanExecutable(buildPlan({ steps: [buildExerciseStep(), buildStep()] }))).toBe(true);
  });
});

describe("validatePlan", () => {
  it("rejects an unnamed plan", () => {
    const result = validatePlan(buildPlan({ name: "  " }));
    expect(result.ok).toBe(false);
  });

  it("rejects a plan with no steps", () => {
    const result = validatePlan(buildPlan({ steps: [] }));
    expect(result.ok).toBe(false);
  });

  it("accepts a valid, named, non-empty plan", () => {
    const result = validatePlan(buildPlan());
    expect(result.ok).toBe(true);
  });
});

describe("validatePlanStep", () => {
  it("returns an explanatory error for an invalid step", () => {
    const result = validatePlanStep(
      buildStep({ completion: { type: "shot-count", value: 0 } })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_step");
    }
  });
});
