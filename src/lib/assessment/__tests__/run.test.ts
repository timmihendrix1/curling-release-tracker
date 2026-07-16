import { describe, expect, it } from "vitest";
import { addValidAttempt } from "../attempts";
import { getAllPlannedShots } from "../progress";
import {
  canTransitionAssessmentRunStatus,
  createAssessmentRun,
  pauseAssessmentRun,
  transitionAssessmentRun,
} from "../run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { standardAssessmentThresholdSet } from "../thresholds";
import { ASSESSMENT_RUN_SCHEMA_VERSION } from "../types";
import { completeAllScoredShots, completeWarmup, createTestRun, expectOk, manualTimingProviderSnapshot } from "./testHelpers";

describe("createAssessmentRun", () => {
  it("creates a valid run in not_started status", () => {
    const outcome = createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.value.status).toBe("not_started");
    expect(outcome.value.templateId).toBe(RELEASE_TIME_CORE_ASSESSMENT_V1.id);
    expect(outcome.value.templateVersion).toBe(RELEASE_TIME_CORE_ASSESSMENT_V1.version);
    expect(outcome.value.currentPlannedShotIndex).toBe(0);
    expect(outcome.value.attempts).toEqual([]);
    expect(outcome.value.protocolDeviations).toEqual([]);
    expect(outcome.value.schemaVersion).toBe(ASSESSMENT_RUN_SCHEMA_VERSION);
    expect(typeof outcome.value.id).toBe("string");
    expect(outcome.value.id.length).toBeGreaterThan(0);
    expect(typeof outcome.value.createdAt).toBe("string");
  });

  it("returns a structured error when no threshold set is provided", () => {
    const outcome = createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, undefined, {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_threshold_set");
  });

  it("returns a structured error for an invalid threshold set", () => {
    const outcome = createAssessmentRun(
      RELEASE_TIME_CORE_ASSESSMENT_V1,
      { type: "custom", values: { onTarget: 0.3, acceptable: 0.1 }, source: "athlete-selected", selectedAt: new Date(0).toISOString() },
      { timingProviderSnapshot: manualTimingProviderSnapshot() }
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_threshold_set");
  });

  it("stores an independent template snapshot, not a shared mutable reference", () => {
    const run = createTestRun();
    expect(run.templateSnapshot).not.toBe(RELEASE_TIME_CORE_ASSESSMENT_V1);
    expect(run.templateSnapshot).toEqual(RELEASE_TIME_CORE_ASSESSMENT_V1);

    // Mutating the run's own snapshot must never be able to affect the shared official template.
    run.templateSnapshot.blocks[0].plannedShots[0].targetTime = 999;
    expect(RELEASE_TIME_CORE_ASSESSMENT_V1.blocks[0].plannedShots[0].targetTime).toBe(3.75);
  });

  it("stores an independent, deep-copied threshold snapshot", () => {
    const thresholdSet = standardAssessmentThresholdSet();
    const run = expectOk(
      createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, thresholdSet, {
        timingProviderSnapshot: manualTimingProviderSnapshot(),
      })
    );
    run.thresholdSnapshot.values.onTarget = 999;
    expect(thresholdSet.values.onTarget).toBe(0.1);
  });
});

describe("Assessment Run status transitions", () => {
  it("allows the documented forward transitions", () => {
    expect(canTransitionAssessmentRunStatus("not_started", "warmup")).toBe(true);
    expect(canTransitionAssessmentRunStatus("warmup", "in_progress")).toBe(true);
    expect(canTransitionAssessmentRunStatus("in_progress", "paused")).toBe(true);
    expect(canTransitionAssessmentRunStatus("paused", "in_progress")).toBe(true);
    expect(canTransitionAssessmentRunStatus("warmup", "incomplete")).toBe(true);
    expect(canTransitionAssessmentRunStatus("in_progress", "incomplete")).toBe(true);
    expect(canTransitionAssessmentRunStatus("paused", "incomplete")).toBe(true);
  });

  it("rejects the documented forbidden transitions", () => {
    expect(canTransitionAssessmentRunStatus("completed", "in_progress")).toBe(false);
    expect(canTransitionAssessmentRunStatus("completed", "warmup")).toBe(false);
    expect(canTransitionAssessmentRunStatus("incomplete", "in_progress")).toBe(false);
    expect(canTransitionAssessmentRunStatus("not_started", "completed")).toBe(false);
  });

  it("moves not_started -> warmup and sets startedAt", () => {
    const run = createTestRun();
    const next = expectOk(transitionAssessmentRun(run, "warmup"));
    expect(next.status).toBe("warmup");
    expect(typeof next.startedAt).toBe("string");
  });

  it("rejects an invalid transition with a structured error", () => {
    const run = createTestRun();
    const outcome = transitionAssessmentRun(run, "completed");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("invalid_status_transition");
  });

  it("rejects completion of a warm-up-only run (no scored attempts at all)", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));

    const outcome = transitionAssessmentRun(run, "completed");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_not_completable");
  });

  it("rejects completion while any scored planned shot is still open", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));

    const scoredShots = run.templateSnapshot.blocks.flatMap((block) => block.plannedShots);
    for (const shot of scoredShots.slice(0, -1)) {
      run = expectOk(
        addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle })
      );
    }

    const outcome = transitionAssessmentRun(run, "completed");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_not_completable");
  });

  it("allows completion once all 32 scored shots have a valid attempt", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);

    const completed = expectOk(transitionAssessmentRun(run, "completed"));
    expect(completed.status).toBe("completed");
    expect(typeof completed.completedAt).toBe("string");
  });

  it("a completed run cannot transition again (immutable status)", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    run = expectOk(transitionAssessmentRun(run, "completed"));

    const outcome = transitionAssessmentRun(run, "in_progress");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_already_completed");
  });

  it("an incomplete run is not resumable", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = expectOk(transitionAssessmentRun(run, "incomplete"));

    const outcome = transitionAssessmentRun(run, "in_progress");
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_already_incomplete");
  });

  it("a paused run is resumable back to in_progress and clears pausedAt", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = expectOk(transitionAssessmentRun(run, "paused"));
    expect(typeof run.pausedAt).toBe("string");

    const resumed = expectOk(transitionAssessmentRun(run, "in_progress"));
    expect(resumed.status).toBe("in_progress");
    expect(resumed.pausedAt).toBeUndefined();
  });
});

describe("pauseAssessmentRun", () => {
  it("there is no direct warmup -> paused edge in the transition table", () => {
    // Documents *why* pauseAssessmentRun exists: a naive
    // transitionAssessmentRun(run, "paused") call fails while status is
    // still "warmup" — this is exactly the bug a direct call would hit.
    expect(canTransitionAssessmentRunStatus("warmup", "paused")).toBe(false);
  });

  it("pauses a run that is still in warmup by composing warmup -> in_progress -> paused", () => {
    const run = expectOk(transitionAssessmentRun(createTestRun(), "warmup"));
    const paused = expectOk(pauseAssessmentRun(run));
    expect(paused.status).toBe("paused");
    expect(typeof paused.pausedAt).toBe("string");
  });

  it("pauses a run already in_progress via the direct edge", () => {
    let run = expectOk(transitionAssessmentRun(createTestRun(), "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));

    const paused = expectOk(pauseAssessmentRun(run));
    expect(paused.status).toBe("paused");
    expect(typeof paused.pausedAt).toBe("string");
  });

  it("never loses attempts or advances progress when pausing mid-warmup", () => {
    let run = expectOk(transitionAssessmentRun(createTestRun(), "warmup"));
    const firstShot = getAllPlannedShots(run.templateSnapshot)[0];
    run = expectOk(
      addValidAttempt(run, firstShot.id, { measuredTime: firstShot.targetTime, executedHandle: firstShot.expectedHandle })
    );

    const paused = expectOk(pauseAssessmentRun(run));
    expect(paused.attempts).toHaveLength(1);
    expect(paused.currentPlannedShotIndex).toBe(1);
  });

  it("propagates the underlying error if the run is already terminal", () => {
    let run = expectOk(transitionAssessmentRun(createTestRun(), "warmup"));
    run = expectOk(transitionAssessmentRun(run, "incomplete"));

    const outcome = pauseAssessmentRun(run);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_already_incomplete");
  });
});
