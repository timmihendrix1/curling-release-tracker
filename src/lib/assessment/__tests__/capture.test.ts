import { describe, expect, it } from "vitest";
import { applyTimingResultToAssessmentRun } from "../capture";
import { getCurrentPlannedShot } from "../progress";
import { transitionAssessmentRun } from "../run";
import type { TimingResult } from "../../../types";
import { completeWarmup, createTestRun, expectOk } from "./testHelpers";

function timingResult(measurementMode: "back-hog" | "hog-hog", value: number, id?: string): TimingResult {
  return {
    id: id ?? crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    source: "manual",
    measurements: [{ measurementMode, value }],
  };
}

function runReadyForScoring() {
  let run = expectOk(transitionAssessmentRun(createTestRun(), "warmup"));
  run = completeWarmup(run);
  return expectOk(transitionAssessmentRun(run, "in_progress"));
}

describe("applyTimingResultToAssessmentRun", () => {
  it("accepts a matching-measurement-mode result and advances the run", () => {
    const run = runReadyForScoring();
    const shot = getCurrentPlannedShot(run)!;

    const outcome = applyTimingResultToAssessmentRun(
      run,
      timingResult("back-hog", shot.targetTime),
      shot.expectedHandle
    );

    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    expect(outcome.measuredTime).toBe(shot.targetTime);
    expect(outcome.run.currentPlannedShotIndex).toBe(run.currentPlannedShotIndex + 1);
    expect(outcome.run.attempts).toHaveLength(run.attempts.length + 1);
  });

  it("records a wrong-handle Protocol Deviation when executedHandle differs from expected", () => {
    const run = runReadyForScoring();
    const shot = getCurrentPlannedShot(run)!;
    const otherHandle = shot.expectedHandle === "in" ? "out" : "in";

    const outcome = applyTimingResultToAssessmentRun(
      run,
      timingResult("back-hog", shot.targetTime),
      otherHandle
    );

    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    expect(outcome.run.protocolDeviations.some((d) => d.type === "wrong_handle")).toBe(true);
  });

  it("reports 'duplicate' (not 'rejected') for a repeated timingResultId, without changing progress", () => {
    const run = runReadyForScoring();
    const shot = getCurrentPlannedShot(run)!;
    const result = timingResult("back-hog", shot.targetTime, "fixed-id-1");

    const first = applyTimingResultToAssessmentRun(run, result, shot.expectedHandle);
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") return;

    const second = applyTimingResultToAssessmentRun(first.run, result, shot.expectedHandle);
    expect(second.status).toBe("duplicate");
  });

  it("rejects a result with no measurement for the run's measurement mode, without throwing", () => {
    const run = runReadyForScoring();
    const shot = getCurrentPlannedShot(run)!;

    const outcome = applyTimingResultToAssessmentRun(
      run,
      timingResult("hog-hog", shot.targetTime),
      shot.expectedHandle
    );

    expect(outcome.status).toBe("rejected");
  });

  it("rejects when there is no current planned shot (run past its last shot)", () => {
    const run = runReadyForScoring();
    const allValidRun = { ...run, currentPlannedShotIndex: 9999 };

    const outcome = applyTimingResultToAssessmentRun(
      allValidRun,
      timingResult("back-hog", 3.75),
      "in"
    );

    expect(outcome.status).toBe("rejected");
  });

  it("never mutates the input run (pure function)", () => {
    const run = runReadyForScoring();
    const snapshot = JSON.parse(JSON.stringify(run));
    const shot = getCurrentPlannedShot(run)!;

    applyTimingResultToAssessmentRun(run, timingResult("back-hog", shot.targetTime), shot.expectedHandle);

    expect(run).toEqual(snapshot);
  });
});
