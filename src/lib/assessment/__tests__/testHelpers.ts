// Shared test fixtures for the Assessment domain test suite. Not itself a
// test file (no describe/it) — Vitest's default include pattern only picks
// up *.test.ts, so this is safely excluded from the actual test run.
import type { Handle } from "../../../types";
import { addValidAttempt } from "../attempts";
import { getAllPlannedShots } from "../progress";
import { createAssessmentRun, transitionAssessmentRun } from "../run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { standardAssessmentThresholdSet } from "../thresholds";
import type { AssessmentOutcome } from "../errors";
import type { AssessmentRun, AssessmentTimingProviderSnapshot, PlannedAssessmentShot } from "../types";

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

/** Like completeAllScoredShots, but the caller controls each scored shot's measured time and executed handle — for Phase C result-derivation tests that need non-zero errors, specific handles, or a mix of both. */
export function completeAllScoredShotsCustom(
  run: AssessmentRun,
  build: (shot: PlannedAssessmentShot, index: number) => { measuredTime: number; executedHandle?: Handle }
): AssessmentRun {
  const scoredShots = getAllPlannedShots(run.templateSnapshot).filter((shot) => shot.phase === "scored");
  return scoredShots.reduce((current, shot, index) => {
    const { measuredTime, executedHandle } = build(shot, index);
    return expectOk(
      addValidAttempt(current, shot.id, { measuredTime, executedHandle: executedHandle ?? shot.expectedHandle })
    );
  }, run);
}

/** Marks a run "incomplete" (abandoned) — the terminal status a Phase C incomplete-run fixture needs. */
export function abandonTestRun(run: AssessmentRun): AssessmentRun {
  return expectOk(transitionAssessmentRun(run, "incomplete"));
}
