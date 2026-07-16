import { describe, expect, it } from "vitest";
import { addInvalidAttempt, addValidAttempt, MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT } from "../attempts";
import { getAllPlannedShots, getCurrentPlannedShot } from "../progress";
import { transitionAssessmentRun } from "../run";
import { completeAllScoredShots, completeWarmup, createTestRun, expectOk } from "./testHelpers";

function firstScoredShotId(run: ReturnType<typeof createTestRun>) {
  return getAllPlannedShots(run.templateSnapshot).filter((shot) => shot.phase === "scored")[0].id;
}

describe("addValidAttempt", () => {
  it("records a valid attempt and advances currentPlannedShotIndex", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;

    const next = expectOk(
      addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle })
    );

    expect(next.attempts).toHaveLength(1);
    expect(next.attempts[0]).toMatchObject({
      plannedShotId: shot.id,
      attemptNumber: 1,
      status: "valid",
      measuredTime: shot.targetTime,
      executedHandle: shot.expectedHandle,
    });
    expect(next.currentPlannedShotIndex).toBe(run.currentPlannedShotIndex + 1);
  });

  it("stores the timingResultId when provided", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;

    const next = expectOk(
      addValidAttempt(run, shot.id, {
        measuredTime: shot.targetTime,
        executedHandle: shot.expectedHandle,
        timingResultId: "timing-result-1",
      })
    );

    expect(next.attempts[0].timingResultId).toBe("timing-result-1");
  });

  it("rejects a second valid attempt for the same planned shot", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;
    run = expectOk(addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle }));

    // currentPlannedShotIndex already advanced past `shot`, so re-target it explicitly for this test.
    const outcome = addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("planned_shot_not_current");
  });

  it("rejects skipping ahead of the current planned shot", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const nextShot = getAllPlannedShots(run.templateSnapshot)[1];

    const outcome = addValidAttempt(run, nextShot.id, {
      measuredTime: nextShot.targetTime,
      executedHandle: nextShot.expectedHandle,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("planned_shot_not_current");
  });

  it("rejects a non-finite or non-positive measured time", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;

    const outcome = addValidAttempt(run, shot.id, { measuredTime: -1, executedHandle: shot.expectedHandle });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_measured_time");
  });

  it("records a wrong-handle Protocol Deviation but still counts the attempt as valid and completed", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;
    const wrongHandle = shot.expectedHandle === "in" ? "out" : "in";

    const next = expectOk(addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: wrongHandle }));

    expect(next.attempts[0].status).toBe("valid");
    expect(next.attempts[0].executedHandle).toBe(wrongHandle);
    expect(next.attempts[0].protocolDeviations).toEqual(["wrong_handle"]);
    expect(next.protocolDeviations).toHaveLength(1);
    expect(next.protocolDeviations[0]).toMatchObject({ type: "wrong_handle", plannedShotId: shot.id });
    expect(next.currentPlannedShotIndex).toBe(run.currentPlannedShotIndex + 1);
  });

  it("rejects a duplicate timingResultId across attempts in the same run", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const first = getCurrentPlannedShot(run)!;
    run = expectOk(
      addValidAttempt(run, first.id, {
        measuredTime: first.targetTime,
        executedHandle: first.expectedHandle,
        timingResultId: "shared-result-id",
      })
    );

    const second = getCurrentPlannedShot(run)!;
    const outcome = addValidAttempt(run, second.id, {
      measuredTime: second.targetTime,
      executedHandle: second.expectedHandle,
      timingResultId: "shared-result-id",
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("duplicate_timing_result");
  });

  it("rejects new attempts once the run is completed", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    run = expectOk(transitionAssessmentRun(run, "completed"));

    const shot = getAllPlannedShots(run.templateSnapshot)[0];
    const outcome = addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_already_completed");
  });

  it("rejects new attempts once the run is incomplete", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = expectOk(transitionAssessmentRun(run, "incomplete"));

    const shot = getAllPlannedShots(run.templateSnapshot)[0];
    const outcome = addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_already_incomplete");
  });
});

describe("addInvalidAttempt", () => {
  it("records an invalid attempt without advancing currentPlannedShotIndex", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;

    const next = expectOk(addInvalidAttempt(run, shot.id, "first_gate_missing"));

    expect(next.attempts).toHaveLength(1);
    expect(next.attempts[0]).toMatchObject({
      plannedShotId: shot.id,
      attemptNumber: 1,
      status: "invalid",
      invalidReason: "first_gate_missing",
    });
    expect(next.currentPlannedShotIndex).toBe(run.currentPlannedShotIndex);
  });

  it(`allows up to ${MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT} invalid repeats for the same planned shot`, () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;

    run = expectOk(addInvalidAttempt(run, shot.id, "first_gate_missing"));
    run = expectOk(addInvalidAttempt(run, shot.id, "second_gate_missing"));

    expect(run.attempts).toHaveLength(2);
    expect(run.attempts.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
  });

  it(`rejects a ${MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT + 1}th invalid repeat for the same planned shot`, () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;

    run = expectOk(addInvalidAttempt(run, shot.id, "first_gate_missing"));
    run = expectOk(addInvalidAttempt(run, shot.id, "second_gate_missing"));

    const outcome = addInvalidAttempt(run, shot.id, "other");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_attempt_limit_reached");
  });

  it("allows a valid attempt after one or two invalid attempts for the same planned shot", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;

    run = expectOk(addInvalidAttempt(run, shot.id, "first_gate_missing"));
    run = expectOk(addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle }));

    expect(run.attempts).toHaveLength(2);
    expect(run.attempts[1]).toMatchObject({ status: "valid", attemptNumber: 2 });
    expect(run.currentPlannedShotIndex).toBe(1);
  });

  it("rejects an invalid attempt against a planned shot that is not current", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const laterShot = getAllPlannedShots(run.templateSnapshot)[1];

    const outcome = addInvalidAttempt(run, laterShot.id, "first_gate_missing");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("planned_shot_not_current");
  });

  it("rejects a duplicate timingResultId", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;
    run = expectOk(addInvalidAttempt(run, shot.id, "duplicate_result", { timingResultId: "dup-1" }));

    const outcome = addInvalidAttempt(run, shot.id, "duplicate_result", { timingResultId: "dup-1" });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("duplicate_timing_result");
  });
});

describe("attempt numbering across invalid + valid attempts for one planned shot", () => {
  it("assigns strictly increasing attemptNumber (invalid, then valid)", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    const shotId = firstScoredShotId(run);
    const shot = getAllPlannedShots(run.templateSnapshot).find((s) => s.id === shotId)!;

    run = expectOk(addInvalidAttempt(run, shotId, "first_gate_missing"));
    run = expectOk(addValidAttempt(run, shotId, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle }));

    const attemptsForShot = run.attempts.filter((attempt) => attempt.plannedShotId === shotId);
    expect(attemptsForShot.map((attempt) => attempt.attemptNumber)).toEqual([1, 2]);
  });
});
