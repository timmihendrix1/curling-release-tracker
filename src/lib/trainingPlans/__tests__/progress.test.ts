import { describe, expect, it } from "vitest";
import type { PlanExecutionState, Shot } from "../../../types";
import {
  getActiveStepSnapshot,
  getPlanProgressSummary,
  isActiveStepComplete,
  isFinalStep,
  isPlanComplete,
  isPlanExecutionActive,
} from "../progress";
import { createCompletedTechniqueExecution, createTechniqueExecution, FIXTURE_SESSION_ID } from "../../exercises/__tests__/executionFixtures";
import { buildExerciseStep, buildSession, buildStep } from "./testHelpers";

function shotFor(blockId: string, shotNumber: number): Shot {
  return {
    id: `${blockId}-shot-${shotNumber}`,
    sessionId: "session-1",
    blockId,
    shotNumber,
    releaseTime: 3.75,
    targetTime: 3.75,
    handle: "in",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function planExecution(overrides: Partial<PlanExecutionState> = {}): PlanExecutionState {
  return {
    sourcePlanId: "plan-1",
    sourcePlanName: "Release Consistency",
    activeStepIndex: 0,
    steps: [
      { step: buildStep({ completion: { type: "shot-count", value: 2 } }), runtime: { kind: "release-timing-block", blockId: "block-1" } },
      { step: buildStep({ completion: { type: "shot-count", value: 2 } }), runtime: undefined },
    ],
    ...overrides,
  };
}

describe("isPlanExecutionActive", () => {
  it("is true when the session's active block matches the current step's blockId", () => {
    const session = buildSession({ activeBlockId: "block-1", blocks: [{ id: "block-1" } as never] });
    expect(isPlanExecutionActive(session, planExecution())).toBe(true);
  });

  it("is false if the athlete manually started a different block mid-plan", () => {
    const session = buildSession({
      activeBlockId: "manual-block",
      blocks: [{ id: "block-1" } as never, { id: "manual-block" } as never],
    });
    expect(isPlanExecutionActive(session, planExecution())).toBe(false);
  });

  it("is false if the active step's blockId no longer resolves to a real block", () => {
    const session = buildSession({ activeBlockId: "block-1", blocks: [] });
    expect(isPlanExecutionActive(session, planExecution())).toBe(false);
  });

  it("resolves an in-progress or completed curated Exercise through its typed runtime", () => {
    const inProgress = createTechniqueExecution();
    const exercisePlan: PlanExecutionState = {
      sourcePlanId: "plan-2",
      sourcePlanName: "Technique",
      activeStepIndex: 0,
      steps: [{
        step: buildExerciseStep({ exerciseVersionSnapshot: inProgress.exerciseVersionSnapshot }),
        runtime: { kind: "exercise-execution", exerciseExecutionId: inProgress.id },
      }],
    };
    const activeSession = buildSession({
      id: FIXTURE_SESSION_ID,
      exerciseExecutions: [inProgress],
      activeExerciseExecutionId: inProgress.id,
    });
    expect(isPlanExecutionActive(activeSession, exercisePlan)).toBe(true);
    expect(isActiveStepComplete(activeSession, exercisePlan)).toBe(false);

    const completed = createCompletedTechniqueExecution();
    const completedPlan = {
      ...exercisePlan,
      steps: [{
        step: buildExerciseStep({ exerciseVersionSnapshot: completed.exerciseVersionSnapshot }),
        runtime: { kind: "exercise-execution" as const, exerciseExecutionId: completed.id },
      }],
    };
    const completedSession = buildSession({
      id: FIXTURE_SESSION_ID,
      exerciseExecutions: [completed],
      activeExerciseExecutionId: undefined,
    });
    expect(isPlanExecutionActive(completedSession, completedPlan)).toBe(true);
    expect(isActiveStepComplete(completedSession, completedPlan)).toBe(true);
    expect(isPlanComplete(completedSession, completedPlan)).toBe(true);
  });
});

describe("isActiveStepComplete / isFinalStep / isPlanComplete", () => {
  it("is not complete before the planned shot count is reached", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
      shots: [shotFor("block-1", 1)],
    });
    expect(isActiveStepComplete(session, planExecution())).toBe(false);
  });

  it("is complete once the planned shot count is reached", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
      shots: [shotFor("block-1", 1), shotFor("block-1", 2)],
    });
    expect(isActiveStepComplete(session, planExecution())).toBe(true);
  });

  it("stays complete (never re-locks) once extra shots are added beyond the planned count", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
      shots: [shotFor("block-1", 1), shotFor("block-1", 2), shotFor("block-1", 3)],
    });
    expect(isActiveStepComplete(session, planExecution())).toBe(true);
  });

  it("isFinalStep is false on the first of two steps, true on the last", () => {
    expect(isFinalStep(planExecution({ activeStepIndex: 0 }))).toBe(false);
    expect(isFinalStep(planExecution({ activeStepIndex: 1 }))).toBe(true);
  });

  it("isPlanComplete requires both final step and step completion", () => {
    const notFinal = planExecution({ activeStepIndex: 0 });
    const finalIncomplete = planExecution({
      activeStepIndex: 1,
      steps: [
        { step: buildStep({ completion: { type: "shot-count", value: 2 } }), runtime: { kind: "release-timing-block", blockId: "block-1" } },
        { step: buildStep({ completion: { type: "shot-count", value: 2 } }), runtime: { kind: "release-timing-block", blockId: "block-2" } },
      ],
    });
    const finalComplete = planExecution({
      activeStepIndex: 1,
      steps: [
        { step: buildStep({ completion: { type: "shot-count", value: 2 } }), runtime: { kind: "release-timing-block", blockId: "block-1" } },
        { step: buildStep({ completion: { type: "shot-count", value: 2 } }), runtime: { kind: "release-timing-block", blockId: "block-2" } },
      ],
    });

    const sessionIncomplete = buildSession({
      activeBlockId: "block-2",
      blocks: [{ id: "block-1" } as never, { id: "block-2" } as never],
      shots: [shotFor("block-2", 1)],
    });
    const sessionComplete = buildSession({
      activeBlockId: "block-2",
      blocks: [{ id: "block-1" } as never, { id: "block-2" } as never],
      shots: [shotFor("block-2", 1), shotFor("block-2", 2)],
    });

    expect(isPlanComplete(sessionComplete, notFinal)).toBe(false);
    expect(isPlanComplete(sessionIncomplete, finalIncomplete)).toBe(false);
    expect(isPlanComplete(sessionComplete, finalComplete)).toBe(true);
  });

  it("a deleted shot is reflected immediately (no cached count)", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
      shots: [shotFor("block-1", 1), shotFor("block-1", 2)],
    });
    expect(isActiveStepComplete(session, planExecution())).toBe(true);

    const afterDelete = { ...session, shots: [shotFor("block-1", 1)] };
    expect(isActiveStepComplete(afterDelete, planExecution())).toBe(false);
  });
});

describe("getActiveStepSnapshot / getPlanProgressSummary", () => {
  it("resolves the active snapshot by activeStepIndex", () => {
    const execution = planExecution();
    expect(getActiveStepSnapshot(execution)?.runtime).toEqual({ kind: "release-timing-block", blockId: "block-1" });
  });

  it("summarizes step and total progress correctly", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
      shots: [shotFor("block-1", 1)],
    });

    const summary = getPlanProgressSummary(session, planExecution());

    expect(summary.currentStepNumber).toBe(1);
    expect(summary.totalSteps).toBe(2);
    expect(summary.currentStepTitle).toBe("Release Time");
    expect(summary.currentProgressLabel).toBe("Stone 1 of 2");
    expect(summary.completedStepCount).toBe(0);
  });
});
