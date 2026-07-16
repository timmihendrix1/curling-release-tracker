// Shared test fixtures for the Assessment domain test suite. Not itself a
// test file (no describe/it) — Vitest's default include pattern only picks
// up *.test.ts, so this is safely excluded from the actual test run.
import { addValidAttempt } from "../attempts";
import { getAllPlannedShots } from "../progress";
import { createAssessmentRun } from "../run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { standardAssessmentThresholdSet } from "../thresholds";
import type { AssessmentOutcome } from "../errors";
import type { AssessmentRun, AssessmentTimingProviderSnapshot } from "../types";

export function manualTimingProviderSnapshot(): AssessmentTimingProviderSnapshot {
  return {
    providerId: "manual",
    captureMode: "manual",
    measurementMode: "back-hog",
  };
}

export function expectOk<T>(outcome: AssessmentOutcome<T>): T {
  if (!outcome.ok) {
    throw new Error(`Expected an ok outcome, got error "${outcome.error.code}": ${outcome.error.message}`);
  }
  return outcome.value;
}

export function expectErr<T>(outcome: AssessmentOutcome<T>): string {
  if (outcome.ok) {
    throw new Error("Expected an error outcome, got ok.");
  }
  return outcome.error.code;
}

export function createTestRun(): AssessmentRun {
  return expectOk(
    createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    })
  );
}

/** Adds a valid, perfectly on-target attempt for every warm-up shot, in order. */
export function completeWarmup(run: AssessmentRun): AssessmentRun {
  const warmupShots = getAllPlannedShots(run.templateSnapshot).filter((shot) => shot.phase === "warmup");
  return warmupShots.reduce(
    (current, shot) =>
      expectOk(addValidAttempt(current, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle })),
    run
  );
}

/** Adds a valid, perfectly on-target attempt for every scored shot, in order (does not touch warm-up). */
export function completeAllScoredShots(run: AssessmentRun): AssessmentRun {
  const scoredShots = getAllPlannedShots(run.templateSnapshot).filter((shot) => shot.phase === "scored");
  return scoredShots.reduce(
    (current, shot) =>
      expectOk(addValidAttempt(current, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle })),
    run
  );
}
