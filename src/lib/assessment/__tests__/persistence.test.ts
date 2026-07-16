import { describe, expect, it } from "vitest";
import {
  archiveCurrentAssessmentRun,
  createEmptyAssessmentPersistedState,
  getAssessmentRunFromHistory,
  setCurrentAssessmentRun,
} from "../persistence";
import { transitionAssessmentRun } from "../run";
import { completeAllScoredShots, completeWarmup, createTestRun, expectOk } from "./testHelpers";

describe("createEmptyAssessmentPersistedState", () => {
  it("starts with schemaVersion 1, no current run, empty history", () => {
    expect(createEmptyAssessmentPersistedState()).toEqual({ schemaVersion: 1, history: [] });
  });
});

describe("setCurrentAssessmentRun", () => {
  it("sets a fresh current run on an empty state", () => {
    const run = createTestRun();
    const outcome = setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.currentRun).toEqual(run);
  });

  it("refuses to silently overwrite a different, still-active current run", () => {
    const state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), createTestRun()));
    const anotherRun = createTestRun();

    const outcome = setCurrentAssessmentRun(state, anotherRun);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("current_run_already_active");
  });

  it("allows replacing a run with itself (e.g. after an in-place update)", () => {
    let run = createTestRun();
    const state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));
    run = expectOk(transitionAssessmentRun(run, "warmup"));

    const outcome = setCurrentAssessmentRun(state, run);
    expect(outcome.ok).toBe(true);
  });
});

describe("archiveCurrentAssessmentRun", () => {
  it("moves a completed run from currentRun into history", () => {
    let run = createTestRun();
    let state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    run = expectOk(transitionAssessmentRun(run, "completed"));

    state = expectOk(archiveCurrentAssessmentRun(state, run));
    expect(state.currentRun).toBeUndefined();
    expect(state.history).toHaveLength(1);
    expect(state.history[0].id).toBe(run.id);
  });

  it("moves an incomplete run from currentRun into history", () => {
    let run = createTestRun();
    let state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = expectOk(transitionAssessmentRun(run, "incomplete"));

    state = expectOk(archiveCurrentAssessmentRun(state, run));
    expect(state.currentRun).toBeUndefined();
    expect(state.history).toHaveLength(1);
  });

  it("rejects archiving a non-terminal run", () => {
    const run = createTestRun();
    const state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));

    const outcome = archiveCurrentAssessmentRun(state, run);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe("run_not_completable");
  });

  it("is idempotent: archiving the same run twice never duplicates the history entry", () => {
    let run = createTestRun();
    let state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = expectOk(transitionAssessmentRun(run, "incomplete"));

    state = expectOk(archiveCurrentAssessmentRun(state, run));
    state = expectOk(archiveCurrentAssessmentRun(state, run));

    expect(state.history).toHaveLength(1);
  });

  it("getAssessmentRunFromHistory finds a run by id, or undefined otherwise", () => {
    let run = createTestRun();
    let state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = expectOk(transitionAssessmentRun(run, "incomplete"));
    state = expectOk(archiveCurrentAssessmentRun(state, run));

    expect(getAssessmentRunFromHistory(state, run.id)?.id).toBe(run.id);
    expect(getAssessmentRunFromHistory(state, "not-a-real-id")).toBeUndefined();
  });
});
