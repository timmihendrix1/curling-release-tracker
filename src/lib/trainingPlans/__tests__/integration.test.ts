// Exercises the full plan → session → blocks → shots → step transition → plan
// completion flow purely through the domain layer (trainingBlocks.ts +
// trainingPlans/*), the same composition TrackerApp.tsx's handlers use — without any
// React/component involvement. See TrackerApp.trainingPlans.test.tsx for the
// component-level equivalent.
import { describe, expect, it } from "vitest";
import type { Session, Shot } from "../../../types";
import { addTrainingBlock } from "../../trainingBlocks";
import { advanceToNextPlanStep, startPlanExecution } from "../execution";
import { mapPlanStepToTrainingBlockInput } from "../mapping";
import {
  getActiveStepSnapshot,
  isActiveStepComplete,
  isFinalStep,
  isPlanComplete,
} from "../progress";
import { deletePlan, updatePlan, addPlan, createEmptyTrainingPlansPersistedState } from "../persistence";
import { buildPlan, buildStep } from "./testHelpers";
import { isReleaseTimingPlanStep } from "../steps";
import {
  buildHistoryAnalysisContext,
  createDefaultHistoryFilters,
} from "../../historyAnalysis";

function timingStep(plan: ReturnType<typeof buildPlan>, index: number) {
  const step = plan.steps[index];
  if (!step || !isReleaseTimingPlanStep(step)) throw new Error("Expected Release Time step");
  return step;
}

function emptySession(): Session {
  return {
    id: "session-1",
    title: "Training Session",
    date: "2026-01-01T00:00:00.000Z",
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
  };
}

function saveShot(session: Session, blockId: string, shotNumber: number): Session {
  const shot: Shot = {
    id: `shot-${blockId}-${shotNumber}`,
    sessionId: session.id,
    blockId,
    shotNumber,
    releaseTime: 3.75,
    targetTime: 3.75,
    handle: "in",
    createdAt: "2026-01-01T00:00:01.000Z",
  };
  return { ...session, shots: [...session.shots, shot] };
}

describe("Training Plan execution — full lifecycle", () => {
  const plan = buildPlan({
    name: "Release Consistency",
    steps: [
      buildStep({ id: "step-1", completion: { type: "shot-count", value: 2 } }),
      buildStep({ id: "step-2", completion: { type: "shot-count", value: 2 } }),
    ],
  });

  it("drives a session through both steps to plan completion", () => {
    // Start the plan: create step 0's block, then attach the execution snapshot —
    // mirrors TrackerApp.handleStartTrainingPlan.
    let session = addTrainingBlock(
      emptySession(),
      mapPlanStepToTrainingBlockInput(timingStep(plan, 0))
    );
    session = { ...session, planExecution: startPlanExecution(plan, { kind: "release-timing-block", blockId: session.activeBlockId }) };

    const step1BlockId = session.activeBlockId;
    expect(session.planExecution?.steps[0].runtime).toEqual({ kind: "release-timing-block", blockId: step1BlockId });

    // Not complete yet.
    expect(isActiveStepComplete(session, session.planExecution!)).toBe(false);
    expect(isFinalStep(session.planExecution!)).toBe(false);

    session = saveShot(session, step1BlockId, 1);
    session = saveShot(session, step1BlockId, 2);

    // Step 1 complete, not the final step → "Continue", never "Plan complete".
    expect(isActiveStepComplete(session, session.planExecution!)).toBe(true);
    expect(isPlanComplete(session, session.planExecution!)).toBe(false);

    // Continue to step 2 — mirrors TrackerApp.handleContinueToNextPlanStep.
    session = addTrainingBlock(session, mapPlanStepToTrainingBlockInput(timingStep(plan, 1)));
    session = {
      ...session,
      planExecution: advanceToNextPlanStep(session.planExecution!, { kind: "release-timing-block", blockId: session.activeBlockId }),
    };

    const step2BlockId = session.activeBlockId;
    expect(step2BlockId).not.toBe(step1BlockId);
    expect(getActiveStepSnapshot(session.planExecution!)?.runtime).toEqual({ kind: "release-timing-block", blockId: step2BlockId });
    expect(isFinalStep(session.planExecution!)).toBe(true);
    expect(isActiveStepComplete(session, session.planExecution!)).toBe(false);

    session = saveShot(session, step2BlockId, 1);
    session = saveShot(session, step2BlockId, 2);

    // Final step reaches its count → Plan complete, never "Continue".
    expect(isPlanComplete(session, session.planExecution!)).toBe(true);

    // Deliberate extra shots remain allowed and recorded in the same block.
    session = saveShot(session, step2BlockId, 3);
    expect(isPlanComplete(session, session.planExecution!)).toBe(true);
    expect(session.shots.filter((shot) => shot.blockId === step2BlockId)).toHaveLength(3);

    // Step 1's block is unaffected by everything that happened in step 2.
    expect(session.shots.filter((shot) => shot.blockId === step1BlockId)).toHaveLength(2);
  });

  it("retains all 16 Release Time shots from two eight-stone plan steps in analytics", () => {
    const sixteenStonePlan = buildPlan({
      name: "Two Full Release Blocks",
      steps: [
        buildStep({ id: "step-1", completion: { type: "shot-count", value: 8 } }),
        buildStep({ id: "step-2", completion: { type: "shot-count", value: 8 } }),
      ],
    });

    let session = addTrainingBlock(
      emptySession(),
      mapPlanStepToTrainingBlockInput(timingStep(sixteenStonePlan, 0))
    );
    session = {
      ...session,
      planExecution: startPlanExecution(sixteenStonePlan, {
        kind: "release-timing-block",
        blockId: session.activeBlockId,
      }),
    };

    const firstBlockId = session.activeBlockId;
    for (let shot = 1; shot <= 8; shot += 1) {
      session = saveShot(session, firstBlockId, shot);
    }
    session = addTrainingBlock(
      session,
      mapPlanStepToTrainingBlockInput(timingStep(sixteenStonePlan, 1))
    );
    session = {
      ...session,
      planExecution: advanceToNextPlanStep(session.planExecution!, {
        kind: "release-timing-block",
        blockId: session.activeBlockId,
      }),
    };

    const secondBlockId = session.activeBlockId;
    for (let shot = 1; shot <= 8; shot += 1) {
      session = saveShot(session, secondBlockId, shot);
    }

    expect(isPlanComplete(session, session.planExecution!)).toBe(true);
    const context = buildHistoryAnalysisContext([session], {
      ...createDefaultHistoryFilters(),
      dateRange: { preset: "all" },
    });
    expect(context.totalShotCount).toBe(16);
    expect(context.progressEntries.map((entry) => entry.shots.length)).toEqual([8, 8]);
  });

  it("editing the source plan after starting never changes the active session", () => {
    let session = addTrainingBlock(
      emptySession(),
      mapPlanStepToTrainingBlockInput(timingStep(plan, 0))
    );
    session = { ...session, planExecution: startPlanExecution(plan, { kind: "release-timing-block", blockId: session.activeBlockId }) };

    let library = addPlan(createEmptyTrainingPlansPersistedState(), plan);
    const edited = { ...plan, name: "Renamed Plan", updatedAt: "2027-01-01T00:00:00.000Z" };
    if (!isReleaseTimingPlanStep(edited.steps[0])) throw new Error("Expected timing step");
    edited.steps[0].configuration.targetTime = 4.5;
    const updateResult = updatePlan(library, edited);
    expect(updateResult.ok).toBe(true);
    if (updateResult.ok) library = updateResult.value;

    // The session's snapshot is untouched — different name, different target.
    expect(session.planExecution?.sourcePlanName).toBe("Release Consistency");
    const snapshottedStep = session.planExecution?.steps[0].step;
    expect(snapshottedStep && isReleaseTimingPlanStep(snapshottedStep)
      ? snapshottedStep.configuration.targetTime
      : undefined).toBe(3.75);
    expect(library.plans[0].name).toBe("Renamed Plan");
  });

  it("deleting the source plan after starting never touches the active session", () => {
    let session = addTrainingBlock(
      emptySession(),
      mapPlanStepToTrainingBlockInput(timingStep(plan, 0))
    );
    session = { ...session, planExecution: startPlanExecution(plan, { kind: "release-timing-block", blockId: session.activeBlockId }) };

    const library = deletePlan(addPlan(createEmptyTrainingPlansPersistedState(), plan), plan.id);

    expect(library.plans).toHaveLength(0);
    expect(session.planExecution?.sourcePlanId).toBe(plan.id);
    expect(session.blocks).toHaveLength(1);
  });
});
