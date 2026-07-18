import { describe, expect, it } from "vitest";
import { advanceToNextPlanStep, startPlanExecution } from "../execution";
import { buildPlan, buildStep } from "./testHelpers";

describe("startPlanExecution", () => {
  it("deep-copies the plan's steps rather than referencing them live", () => {
    const step = buildStep();
    const plan = buildPlan({ steps: [step] });

    const execution = startPlanExecution(plan, "block-1");
    execution.steps[0].step.configuration.targetTime = 999;

    expect(step.configuration.targetTime).not.toBe(999);
  });

  it("stamps the given block id onto step 0 only", () => {
    const plan = buildPlan({ steps: [buildStep(), buildStep()] });
    const execution = startPlanExecution(plan, "block-1");

    expect(execution.activeStepIndex).toBe(0);
    expect(execution.steps[0].blockId).toBe("block-1");
    expect(execution.steps[1].blockId).toBeUndefined();
  });

  it("carries source plan identity for display context", () => {
    const plan = buildPlan({ name: "Release Consistency" });
    const execution = startPlanExecution(plan, "block-1");

    expect(execution.sourcePlanId).toBe(plan.id);
    expect(execution.sourcePlanName).toBe("Release Consistency");
    expect(execution.sourcePlanUpdatedAt).toBe(plan.updatedAt);
  });
});

describe("advanceToNextPlanStep", () => {
  it("bumps the active index and stamps the new block id atomically", () => {
    const plan = buildPlan({ steps: [buildStep(), buildStep()] });
    const started = startPlanExecution(plan, "block-1");

    const advanced = advanceToNextPlanStep(started, "block-2");

    expect(advanced.activeStepIndex).toBe(1);
    expect(advanced.steps[1].blockId).toBe("block-2");
    // Step 0 is untouched.
    expect(advanced.steps[0].blockId).toBe("block-1");
  });

  it("is a no-op on the final step", () => {
    const plan = buildPlan({ steps: [buildStep()] });
    const started = startPlanExecution(plan, "block-1");

    const advanced = advanceToNextPlanStep(started, "block-2");
    expect(advanced).toBe(started);
  });
});
