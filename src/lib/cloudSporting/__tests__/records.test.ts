import { describe, expect, it } from "vitest";
import {
  completeAllScoredShots,
  completeWarmup,
  createTestRun,
  expectOk,
} from "../../assessment/__tests__/testHelpers";
import { transitionAssessmentRun } from "../../assessment/run";
import {
  deserializeAssessmentRun,
  deserializeTrainingSession,
  serializeAssessmentRun,
  serializeTrainingSession,
  sha256Hex,
} from "../records";
import {
  createCompletedShotmakingExecution,
  createCompletedTechniqueExecution,
  createMeasuredExecution,
  createTechniqueExecution,
  FIXTURE_SESSION_ID,
} from "../../exercises/__tests__/executionFixtures";
import type { Session } from "../../../types";

function sessionWith(exerciseExecutions: Session["exerciseExecutions"]): Session {
  return {
    id: FIXTURE_SESSION_ID,
    title: "Exercise Session",
    date: "2026-08-27T10:00:00.000Z",
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
    exerciseExecutions,
  };
}

describe("cloud sporting record serialization", () => {
  it("round-trips Release Timing Library provenance without a duplicate Exercise Execution", () => {
    const session: Session = {
      ...sessionWith(undefined),
      releaseTimingExerciseVersionSnapshot:
        createMeasuredExecution().exerciseVersionSnapshot,
    };
    const serialized = serializeTrainingSession(session);
    expect(serialized).not.toBeNull();
    if (!serialized) return;
    expect(
      deserializeTrainingSession({ ...serialized, contentSha256: "fixture-digest" })
    ).toEqual(session);
  });

  it("round-trips terminal Technique and Shotmaking Exercise Executions in their Training Session", () => {
    const technique = createCompletedTechniqueExecution();
    const withPrivateNote = {
      ...technique,
      athleteResults: technique.athleteResults.map((result) => ({
        ...result,
        privateNote: "My private observation",
      })),
    };
    const session = sessionWith([
      withPrivateNote,
      createCompletedShotmakingExecution(),
    ]);
    const serialized = serializeTrainingSession(session);
    expect(serialized).not.toBeNull();
    if (!serialized) return;
    expect(
      deserializeTrainingSession({ ...serialized, contentSha256: "fixture-digest" })
    ).toEqual(session);
  });

  it("rejects active or corrupt Exercise state at both cloud boundaries", () => {
    const active = createTechniqueExecution();
    expect(
      serializeTrainingSession({
        ...sessionWith([active]),
        activeExerciseExecutionId: active.id,
      })
    ).toBeNull();

    const terminal = createCompletedTechniqueExecution();
    const serialized = serializeTrainingSession(sessionWith([terminal]));
    expect(serialized).not.toBeNull();
    if (!serialized) return;
    const corruptPayload = JSON.stringify({
      ...sessionWith([terminal]),
      activeExerciseExecutionId: terminal.id,
    });
    expect(
      deserializeTrainingSession({
        ...serialized,
        payload: corruptPayload,
        contentSha256: "fixture-digest",
      })
    ).toBeNull();
  });

  it("round-trips a canonical completed Assessment Run through its cloud payload", async () => {
    let run = expectOk(transitionAssessmentRun(createTestRun(), "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    run = expectOk(transitionAssessmentRun(run, "completed"));
    run = {
      ...run,
      attempts: run.attempts.map((attempt, index) => index === 0
        ? {
            ...attempt,
            providerMetadata: {
              providerId: "simulator" as const,
              providerVersion: "e2e-v1",
              hardwareMetadata: { lane: 2, trusted: true },
            },
          }
        : attempt),
    };

    const serialized = serializeAssessmentRun(run);
    expect(serialized).not.toBeNull();
    if (!serialized) return;
    const contentSha256 = await sha256Hex(serialized.payload);
    expect(contentSha256).not.toBeNull();
    if (!contentSha256) return;

    expect(deserializeAssessmentRun({ ...serialized, contentSha256 })).toEqual(run);
  });
});
