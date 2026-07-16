import { describe, expect, it } from "vitest";
import { addValidAttempt } from "../attempts";
import {
  calculateScoredProgress,
  calculateWarmupProgress,
  countInvalidAttempts,
  countProtocolDeviations,
  countValidScoredAttempts,
  getAllPlannedShots,
  getCurrentBlock,
  getCurrentPlannedShot,
  getNextPlannedShot,
  isLastPlannedShot,
  isRunCompletable,
  isWarmupComplete,
} from "../progress";
import { addInvalidAttempt } from "../attempts";
import { transitionAssessmentRun } from "../run";
import { completeAllScoredShots, completeWarmup, createTestRun, expectOk } from "./testHelpers";

describe("progress utilities", () => {
  it("getCurrentPlannedShot / getNextPlannedShot walk the sequence in order", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));

    const all = getAllPlannedShots(run.templateSnapshot);
    expect(getCurrentPlannedShot(run)).toEqual(all[0]);
    expect(getNextPlannedShot(run)).toEqual(all[1]);
  });

  it("getCurrentBlock is undefined during warm-up and resolves once scored shots begin", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    expect(getCurrentBlock(run)).toBeUndefined();

    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    expect(getCurrentBlock(run)?.name).toBe("Medium Reproduction");
  });

  it("calculateWarmupProgress counts only valid warm-up attempts", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    expect(calculateWarmupProgress(run)).toEqual({ completed: 0, total: 6 });

    const shot = getCurrentPlannedShot(run)!;
    run = expectOk(addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle }));
    expect(calculateWarmupProgress(run)).toEqual({ completed: 1, total: 6 });
  });

  it("calculateScoredProgress counts only valid scored attempts", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    expect(calculateScoredProgress(run)).toEqual({ completed: 0, total: 32 });

    const shot = getCurrentPlannedShot(run)!;
    run = expectOk(addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle }));
    expect(calculateScoredProgress(run)).toEqual({ completed: 1, total: 32 });
  });

  it("isWarmupComplete flips true only once every warm-up shot has a valid attempt", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    expect(isWarmupComplete(run)).toBe(false);

    run = completeWarmup(run);
    expect(isWarmupComplete(run)).toBe(true);
  });

  it("isRunCompletable flips true only once all 32 scored shots have a valid attempt", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    expect(isRunCompletable(run)).toBe(false);

    run = completeAllScoredShots(run);
    expect(isRunCompletable(run)).toBe(true);
  });

  it("countValidScoredAttempts / countInvalidAttempts / countProtocolDeviations", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));

    const first = getCurrentPlannedShot(run)!;
    run = expectOk(addInvalidAttempt(run, first.id, "first_gate_missing"));
    run = expectOk(addValidAttempt(run, first.id, { measuredTime: first.targetTime, executedHandle: first.expectedHandle }));

    const second = getCurrentPlannedShot(run)!;
    const wrongHandle = second.expectedHandle === "in" ? "out" : "in";
    run = expectOk(addValidAttempt(run, second.id, { measuredTime: second.targetTime, executedHandle: wrongHandle }));

    expect(countValidScoredAttempts(run)).toBe(2);
    expect(countInvalidAttempts(run)).toBe(1);
    expect(countProtocolDeviations(run)).toBe(1);
  });

  it("isLastPlannedShot is true only at the final planned shot", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    expect(isLastPlannedShot(run)).toBe(false);

    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    expect(isLastPlannedShot(run)).toBe(true);
  });
});
