// @vitest-environment jsdom
//
// Measurement-aware plan execution must survive every persistence boundary. A valid
// speed-only step that `saveCurrent` accepts but `loadCurrent` silently strips would
// lose the athlete's plan on reload, and a session the cloud writer accepts but the
// same implementation cannot read back would be unrestorable.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
} from "../../sessionRepository";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import { createTrainingPlansRepository } from "../../trainingPlans/repository";
import { buildPlan, buildStep } from "../../trainingPlans/__tests__/testHelpers";
import { isStepExecutable } from "../../trainingPlans/validation";
import { migrateSession } from "../../sessionMigration";
import { createTrainingBlock } from "../../trainingBlocks";
import { mapPlanStepToTrainingBlockInput } from "../../trainingPlans/mapping";
import {
  deserializeTrainingSession,
  serializeTrainingSession,
} from "../../cloudSporting/records";
import type { ReleaseTimingPlanStep, Session } from "../../../types";
import { BOTH_CONFIGURATION, SPEED_CONFIGURATION } from "./measurementFixtures";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

function speedOnlyStep(): ReleaseTimingPlanStep {
  const step = buildStep();
  delete (step.configuration as Record<string, unknown>).measurementMode;
  delete (step.configuration as Record<string, unknown>).targetTime;
  step.configuration.measurement = structuredClone(SPEED_CONFIGURATION);
  return step;
}

function bothStep(): ReleaseTimingPlanStep {
  const step = buildStep();
  step.configuration.measurement = structuredClone(BOTH_CONFIGURATION);
  step.configuration.targetTime = BOTH_CONFIGURATION.time!.target;
  return step;
}

function speedPlanSession(): Session {
  const step = speedOnlyStep();
  const blockId = "33333333-3333-4333-8333-333333333333";
  return {
    id: SESSION_ID,
    title: "Speed plan",
    date: "2026-10-06T10:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: blockId,
        name: "Speed",
        mode: "fixed",
        createdAt: "2026-10-06T10:00:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        measurement: structuredClone(SPEED_CONFIGURATION),
      },
    ],
    activeBlockId: blockId,
    shots: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        sessionId: SESSION_ID,
        blockId,
        shotNumber: 1,
        speed: 2.41,
        targetSpeed: 2.4,
        speedSource: "manual",
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
    ],
    planExecution: {
      sourcePlanId: "plan-1",
      sourcePlanName: "Speed plan",
      steps: [{ step, runtime: { kind: "release-timing-block", blockId } }],
      activeStepIndex: 0,
    },
  };
}

/** A time step first, a speed-only step later — the mixed case the review named. */
function mixedPlanSession(): Session {
  const timeBlockId = "44444444-4444-4444-8444-444444444441";
  const speedBlockId = "44444444-4444-4444-8444-444444444442";
  return {
    id: SESSION_ID,
    title: "Mixed plan",
    date: "2026-10-06T10:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: timeBlockId,
        name: "Time",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: "2026-10-06T10:00:00.000Z",
        completedAt: "2026-10-06T10:05:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
      {
        id: speedBlockId,
        name: "Speed",
        mode: "fixed",
        createdAt: "2026-10-06T10:05:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        measurement: structuredClone(SPEED_CONFIGURATION),
      },
    ],
    activeBlockId: speedBlockId,
    shots: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        sessionId: SESSION_ID,
        blockId: timeBlockId,
        shotNumber: 1,
        releaseTime: 3.8,
        targetTime: 3.75,
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        sessionId: SESSION_ID,
        blockId: speedBlockId,
        shotNumber: 1,
        speed: 2.41,
        targetSpeed: 2.4,
        speedSource: "manual",
        handle: "out",
        createdAt: "2026-10-06T10:06:00.000Z",
      },
    ],
    planExecution: {
      sourcePlanId: "plan-2",
      sourcePlanName: "Mixed plan",
      steps: [
        { step: buildStep(), runtime: { kind: "release-timing-block", blockId: timeBlockId } },
        { step: speedOnlyStep(), runtime: { kind: "release-timing-block", blockId: speedBlockId } },
      ],
      activeStepIndex: 1,
    },
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("plan step executability across all three configurations", () => {
  it("accepts a time-only step, a Both step and a speed-only step", () => {
    expect(isStepExecutable(buildStep())).toBe(true);
    expect(isStepExecutable(bothStep())).toBe(true);
    expect(isStepExecutable(speedOnlyStep())).toBe(true);
  });

  it("rejects a speed-only step that still carries time fields, without inserting dummies", () => {
    const step = speedOnlyStep();
    step.configuration.measurementMode = "back-hog";
    expect(isStepExecutable(step)).toBe(false);
  });

  it("rejects a Both step whose two time targets disagree", () => {
    const step = bothStep();
    step.configuration.targetTime = 4;
    expect(isStepExecutable(step)).toBe(false);
  });
});

describe("plan execution survives real persistence", () => {
  it.each([
    ["speed-only plan", speedPlanSession],
    ["mixed plan with a speed-only step last", mixedPlanSession],
  ])("%s survives a repository save and reload intact", async (_label, build) => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const original = build();

    expect(await repository.saveCurrent(original)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    expect(reloaded.status).toBe("value");
    if (reloaded.status !== "value") return;

    // The whole plan — not merely the blocks and shots — must come back.
    expect(reloaded.value.planExecution).toEqual(original.planExecution);
    expect(reloaded.value).toEqual(original);
  });

  it.each([
    ["speed-only plan", speedPlanSession],
    ["mixed plan", mixedPlanSession],
  ])("%s survives migration with its runtime bindings and snapshots intact", (_label, build) => {
    const original = build();
    const migrated = migrateSession(original);
    expect(migrated.planExecution).toEqual(original.planExecution);
  });

  it.each([
    ["speed-only plan", speedPlanSession],
    ["mixed plan", mixedPlanSession],
  ])("%s can be read back from the cloud record it is written to", (_label, build) => {
    const original = build();
    const record = serializeTrainingSession(original);
    expect(record).not.toBeNull();

    // A writer must never accept what this same implementation cannot restore.
    const restored = deserializeTrainingSession({ ...record!, contentSha256: "unused" });
    expect(restored).not.toBeNull();
    expect(restored!.planExecution).toEqual(original.planExecution);
  });

  it("survives the archive transition with its plan intact", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const completed = mixedPlanSession();

    const next: Session = {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Training Session",
      date: "2026-10-06T12:00:00.000Z",
      notes: "",
      blocks: [],
      activeBlockId: "",
      shots: [],
    };

    expect(await repository.archiveAndReplace([completed], next)).toEqual({ ok: true });

    const history = await repository.loadHistory();
    expect(history.status).toBe("value");
    if (history.status !== "value") return;
    expect(history.value[0].planExecution).toEqual(completed.planExecution);
  });

  it("isolates a block created from a plan step from later edits to that step", () => {
    const step = bothStep();
    const block = createTrainingBlock(mapPlanStepToTrainingBlockInput(step));

    // The athlete edits (or deletes) the plan afterwards.
    step.configuration.measurement!.speed!.tolerance.onTarget.upper = 0.9;
    step.configuration.measurement!.speed!.target = 9;
    step.configuration.measurement!.time!.tolerance.acceptable.lower = 5;

    expect(block.measurement!.speed!.tolerance.onTarget.upper).toBe(0.05);
    expect(block.measurement!.speed!.target).toBe(2.4);
    expect(block.measurement!.time!.tolerance.acceptable.lower).toBe(0.2);
  });

  it("isolates a stored plan from later mutation of the object that was saved", async () => {
    const plansRepository = createTrainingPlansRepository(createLocalStorageAdapter());
    const step = bothStep();
    expect((await plansRepository.savePlans([buildPlan({ steps: [step] })])).ok).toBe(true);

    step.configuration.measurement!.speed!.tolerance.onTarget.upper = 0.9;

    const loaded = await plansRepository.loadPlans();
    expect(loaded.status).toBe("value");
    if (loaded.status !== "value") return;
    const stored = loaded.value[0].steps[0] as ReleaseTimingPlanStep;
    expect(stored.configuration.measurement!.speed!.tolerance.onTarget.upper).toBe(0.05);
  });
});

describe("protected failures at the plan boundary", () => {
  it("refuses to store a plan whose speed configuration is invalid", async () => {
    const repository = createTrainingPlansRepository(createLocalStorageAdapter());
    const step = speedOnlyStep();
    step.configuration.measurement!.speed!.target = -1;

    const result = await repository.savePlans([buildPlan({ steps: [step] })]);
    expect(result.ok).toBe(false);
  });

  it("protects an invalid stored speed plan instead of downgrading it to time training", async () => {
    const step = speedOnlyStep();
    step.configuration.measurement!.speed!.target = -1;
    window.localStorage.setItem(
      "curling-release-tracker-training-plans",
      JSON.stringify({ schemaVersion: 2, plans: [buildPlan({ steps: [step] })] })
    );

    const repository = createTrainingPlansRepository(createLocalStorageAdapter());
    const loaded = await repository.loadPlans();

    // Not repaired into executable Back-Hog / 3.75s time training.
    expect(loaded.status).toBe("read_failed");
  });

  it("refuses to store a session whose plan step configuration is malformed", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const session = speedPlanSession();
    const step = session.planExecution!.steps[0].step as ReleaseTimingPlanStep;
    step.configuration.measurement!.speed = null as never;

    expect((await repository.saveCurrent(session)).ok).toBe(false);
    expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBeNull();
  });
});
