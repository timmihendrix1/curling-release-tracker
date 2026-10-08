import { describe, expect, it } from "vitest";
import type { CaptureSequence, PlanExecutionState } from "../../../types";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../exercises/content";
import {
  addShotmakingAttempt,
  createSoloExerciseExecution,
  updatePrivateAthleteNote,
} from "../../exercises/execution";
import type { ExerciseExecution } from "../../exercises/executionTypes";
import { findExerciseVersion } from "../../exercises/lookup";
import {
  createCompletedShotmakingExecution,
  createTechniqueExecution,
  FIXTURE_ATHLETE_ID,
  FIXTURE_SESSION_ID,
} from "../../exercises/__tests__/executionFixtures";
import { endActivePlanStepRuntime } from "../stepTransition";
import { buildExerciseStep, buildSession, buildStep } from "./testHelpers";

function shotmakingVersion() {
  const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
  if (!version) throw new Error("Missing Eight Guards fixture");
  return version;
}

function clock(seed: number) {
  let next = seed;
  return {
    id: () => `50000000-0000-4000-8000-${String(next++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 8, 20, 9, 0, next++)).toISOString(),
  };
}

function createEmptyShotmakingExecution(seed = 100): ExerciseExecution {
  const created = createSoloExerciseExecution(shotmakingVersion(), {
    trainingSessionId: FIXTURE_SESSION_ID,
    athleteProfileId: FIXTURE_ATHLETE_ID,
    clock: clock(seed),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function createStartedShotmakingExecution(seed = 200): ExerciseExecution {
  const attempted = addShotmakingAttempt(createEmptyShotmakingExecution(seed), {
    athleteProfileId: FIXTURE_ATHLETE_ID,
    actualHandle: "in",
    evaluation: { status: "scored", score: 2 },
    clock: clock(seed + 5),
  });
  if (!attempted.ok) throw new Error(attempted.error.message);
  return attempted.value;
}

function exerciseStepExecution(execution: ExerciseExecution): PlanExecutionState {
  return {
    sourcePlanId: "plan-1",
    sourcePlanName: "Mixed Practice",
    activeStepIndex: 0,
    steps: [
      {
        step: buildExerciseStep({
          exerciseVersionSnapshot: execution.exerciseVersionSnapshot,
        }),
        runtime: { kind: "exercise-execution", exerciseExecutionId: execution.id },
      },
      { step: buildExerciseStep(), runtime: undefined },
    ],
  };
}

function sessionWith(execution: ExerciseExecution) {
  return buildSession({
    id: FIXTURE_SESSION_ID,
    exerciseExecutions: [execution],
    ...(execution.status === "in-progress"
      ? { activeExerciseExecutionId: execution.id }
      : {}),
  });
}

function releaseTimingExecution(blockId: string): PlanExecutionState {
  return {
    sourcePlanId: "plan-2",
    sourcePlanName: "Release Consistency",
    activeStepIndex: 0,
    steps: [
      {
        step: buildStep({ completion: { type: "shot-count", value: 8 } }),
        runtime: { kind: "release-timing-block", blockId },
      },
      { step: buildStep(), runtime: undefined },
    ],
  };
}

function runningSequence(blockId: string): CaptureSequence {
  return {
    id: "sequence-1",
    sessionId: "session-1",
    blockId,
    expectedShotCount: 8,
    capturedShotCount: 2,
    status: "running",
    providerType: "simulator",
    handleMode: "alternate",
    startHandle: "in",
    processedResultIds: ["result-1", "result-2"],
    steps: [],
  };
}

describe("endActivePlanStepRuntime — curated Exercise steps", () => {
  it("completes an Exercise the domain considers completable", () => {
    const execution = createStartedShotmakingExecution();
    const session = sessionWith(execution);

    const outcome = endActivePlanStepRuntime(
      session,
      exerciseStepExecution(execution),
      "2026-09-20T10:00:00.000Z"
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ended = outcome.value.exerciseExecutions?.[0];
    expect(ended?.status).toBe("completed");
    expect(ended?.completedAt).toBe("2026-09-20T10:00:00.000Z");
    expect(outcome.value.activeExerciseExecutionId).toBeUndefined();
  });

  it("abandons an empty Shotmaking Exercise instead of fabricating an attempt", () => {
    const execution = createEmptyShotmakingExecution();
    const session = sessionWith(execution);

    const outcome = endActivePlanStepRuntime(
      session,
      exerciseStepExecution(execution),
      "2026-09-20T10:00:00.000Z"
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const ended = outcome.value.exerciseExecutions?.[0];
    expect(ended?.status).toBe("abandoned");
    expect(ended?.abandonedAt).toBe("2026-09-20T10:00:00.000Z");
    expect(ended?.athleteResults[0].attempts).toHaveLength(0);
    expect(outcome.value.activeExerciseExecutionId).toBeUndefined();
  });

  it("completes an empty Technique Exercise, which needs no recorded attempt", () => {
    const execution = createTechniqueExecution();
    const session = sessionWith(execution);

    const outcome = endActivePlanStepRuntime(session, exerciseStepExecution(execution));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.exerciseExecutions?.[0].status).toBe("completed");
  });

  it("preserves every recorded attempt and the private Athlete Note", () => {
    const noted = updatePrivateAthleteNote(
      createStartedShotmakingExecution(),
      FIXTURE_ATHLETE_ID,
      "Felt rushed on the last one.",
      "2026-09-20T09:59:00.000Z"
    );
    if (!noted.ok) throw new Error(noted.error.message);
    const session = sessionWith(noted.value);

    const outcome = endActivePlanStepRuntime(session, exerciseStepExecution(noted.value));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = outcome.value.exerciseExecutions?.[0].athleteResults[0];
    expect(result?.attempts).toHaveLength(1);
    const attempt = result?.attempts[0];
    expect(attempt?.kind).toBe("shotmaking");
    expect(attempt?.kind === "shotmaking" ? attempt.evaluation : undefined).toEqual({
      status: "scored",
      score: 2,
    });
    expect(result?.privateNote).toBe("Felt rushed on the last one.");
  });

  it("never reopens or rewrites an already-terminal Exercise", () => {
    const execution = createCompletedShotmakingExecution();
    const session = sessionWith(execution);

    const outcome = endActivePlanStepRuntime(session, exerciseStepExecution(execution));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toBe(session);
    expect(outcome.value.exerciseExecutions?.[0]).toEqual(execution);
  });

  it("reports a step whose Exercise Execution cannot be resolved", () => {
    const execution = createStartedShotmakingExecution();
    const session = buildSession({ id: FIXTURE_SESSION_ID });

    const outcome = endActivePlanStepRuntime(session, exerciseStepExecution(execution));

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("invalid_step");
  });
});

describe("endActivePlanStepRuntime — Release Time steps", () => {
  it("closes the step's own Auto Capture so a late result cannot reach the next step", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
      captureSequence: runningSequence("block-1"),
    });

    const outcome = endActivePlanStepRuntime(session, releaseTimingExecution("block-1"));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.captureSequence?.status).toBe("cancelled");
    expect(outcome.value.captureSequence?.cancelledAt).toBeDefined();
    // Recorded capture progress is untouched — only the live context is closed.
    expect(outcome.value.captureSequence?.capturedShotCount).toBe(2);
    expect(outcome.value.captureSequence?.processedResultIds).toEqual([
      "result-1",
      "result-2",
    ]);
  });

  it("leaves Blocks, Shots and an unrelated sequence exactly as recorded", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
      captureSequence: runningSequence("another-block"),
    });

    const outcome = endActivePlanStepRuntime(session, releaseTimingExecution("block-1"));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toBe(session);
  });

  it("is a no-op when no Auto Capture is running", () => {
    const session = buildSession({
      activeBlockId: "block-1",
      blocks: [{ id: "block-1" } as never],
    });

    const outcome = endActivePlanStepRuntime(session, releaseTimingExecution("block-1"));

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value).toBe(session);
  });

  it("rejects a Release Time step wired to the wrong kind of runtime", () => {
    const session = buildSession({ activeBlockId: "block-1" });
    const execution: PlanExecutionState = {
      ...releaseTimingExecution("block-1"),
      steps: [
        {
          step: buildStep(),
          runtime: { kind: "exercise-execution", exerciseExecutionId: "nope" },
        },
      ],
    };

    const outcome = endActivePlanStepRuntime(session, execution);

    expect(outcome.ok).toBe(false);
  });
});
