import { describe, expect, it } from "vitest";
import { advanceToNextPlanStep, startPlanExecution } from "../execution";
import { buildExerciseStep, buildPlan, buildStep } from "./testHelpers";

describe("startPlanExecution", () => {
  it("deep-copies the plan's steps rather than referencing them live", () => {
    const step = buildStep();
    const plan = buildPlan({ steps: [step] });

    const execution = startPlanExecution(plan, {
      kind: "release-timing-block",
      blockId: "block-1",
    });
    if (execution.steps[0].step.type !== "release-timing") throw new Error("Expected timing step");
    execution.steps[0].step.configuration.targetTime = 999;

    expect(step.configuration.targetTime).not.toBe(999);
  });

  it("stamps the given block id onto step 0 only", () => {
    const plan = buildPlan({ steps: [buildStep(), buildStep()] });
    const execution = startPlanExecution(plan, { kind: "release-timing-block", blockId: "block-1" });

    expect(execution.activeStepIndex).toBe(0);
    expect(execution.steps[0].runtime).toEqual({ kind: "release-timing-block", blockId: "block-1" });
    expect(execution.steps[1].runtime).toBeUndefined();
  });

  it("carries source plan identity for display context", () => {
    const plan = buildPlan({ name: "Release Consistency" });
    const execution = startPlanExecution(plan, { kind: "release-timing-block", blockId: "block-1" });

    expect(execution.sourcePlanId).toBe(plan.id);
    expect(execution.sourcePlanName).toBe("Release Consistency");
    expect(execution.sourcePlanUpdatedAt).toBe(plan.updatedAt);
  });

  it("deep-copies immutable Exercise Version snapshots in a mixed plan", () => {
    const exerciseStep = buildExerciseStep();
    const plan = buildPlan({ steps: [exerciseStep, buildStep()] });
    const execution = startPlanExecution(plan, {
      kind: "exercise-execution",
      exerciseExecutionId: "execution-1",
    });

    expect(execution.steps[0].step).not.toBe(exerciseStep);
    expect(execution.steps[0].runtime).toEqual({
      kind: "exercise-execution",
      exerciseExecutionId: "execution-1",
    });
    expect(execution.steps[1].runtime).toBeUndefined();
    expect(execution.steps[0].step.exerciseVersionSnapshot).toEqual(
      exerciseStep.exerciseVersionSnapshot
    );
    expect(execution.steps[0].step.exerciseVersionSnapshot).not.toBe(
      exerciseStep.exerciseVersionSnapshot
    );

    exerciseStep.exerciseVersionSnapshot.title = "Edited saved plan";
    expect(execution.steps[0].step.exerciseVersionSnapshot.title).toBe(
      "Eight Guards, Progressively Longer"
    );
  });
});

describe("advanceToNextPlanStep", () => {
  it("bumps the active index and stamps the new block id atomically", () => {
    const plan = buildPlan({ steps: [buildStep(), buildStep()] });
    const started = startPlanExecution(plan, { kind: "release-timing-block", blockId: "block-1" });

    const advanced = advanceToNextPlanStep(started, { kind: "release-timing-block", blockId: "block-2" });

    expect(advanced.activeStepIndex).toBe(1);
    expect(advanced.steps[1].runtime).toEqual({ kind: "release-timing-block", blockId: "block-2" });
    // Step 0 is untouched.
    expect(advanced.steps[0].runtime).toEqual({ kind: "release-timing-block", blockId: "block-1" });
  });

  it("is a no-op on the final step", () => {
    const plan = buildPlan({ steps: [buildStep()] });
    const started = startPlanExecution(plan, { kind: "release-timing-block", blockId: "block-1" });

    const advanced = advanceToNextPlanStep(started, { kind: "release-timing-block", blockId: "block-2" });
    expect(advanced).toBe(started);
  });
});
