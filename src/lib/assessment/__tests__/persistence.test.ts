import { describe, expect, it } from "vitest";
import {
  archiveCurrentAssessmentRun,
  createEmptyAssessmentPersistedState,
  deleteAssessmentRunFromHistory,
  getAssessmentRunFromHistory,
  getCompletedAssessmentRuns,
  getIncompleteAssessmentRuns,
  getLatestCompletedAssessmentRun,
  setCurrentAssessmentRun,
  type AssessmentPersistedState,
} from "../persistence";
import { transitionAssessmentRun } from "../run";
import { completeAllScoredShots, completeWarmup, createTestRun, expectErr, expectOk } from "./testHelpers";

function archivedCompletedRun(completedAt: string): AssessmentPersistedState["history"][number] {
  let run = createTestRun();
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  run = completeAllScoredShots(run);
  return expectOk(transitionAssessmentRun(run, "completed", { at: completedAt }));
}

/**
 * `transitionAssessmentRun(..., "incomplete")` never stamps a timestamp
 * field with `at` (see run.ts's ALLOWED_TRANSITIONS switch), so ordering
 * fixtures here override `createdAt` directly — safe for a test fixture,
 * since createdAt is plain run metadata, not a value the app itself ever
 * rewrites on a real run.
 */
function archivedIncompleteRun(createdAt: string): AssessmentPersistedState["history"][number] {
  let run = createTestRun();
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = expectOk(transitionAssessmentRun(run, "incomplete"));
  return { ...run, createdAt };
}

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

describe("getCompletedAssessmentRuns / getIncompleteAssessmentRuns / getLatestCompletedAssessmentRun", () => {
  it("separates completed from incomplete runs and sorts newest-first", () => {
    const older = archivedCompletedRun("2026-01-01T00:00:00.000Z");
    const newer = archivedCompletedRun("2026-02-01T00:00:00.000Z");
    const incomplete = archivedIncompleteRun("2026-01-15T00:00:00.000Z");

    const state: AssessmentPersistedState = {
      schemaVersion: 1,
      history: [older, incomplete, newer],
    };

    expect(getCompletedAssessmentRuns(state).map((run) => run.id)).toEqual([newer.id, older.id]);
    expect(getIncompleteAssessmentRuns(state).map((run) => run.id)).toEqual([incomplete.id]);
    expect(getLatestCompletedAssessmentRun(state)?.id).toBe(newer.id);
  });

  it("returns undefined/empty when no runs of that kind exist", () => {
    const state = createEmptyAssessmentPersistedState();
    expect(getCompletedAssessmentRuns(state)).toEqual([]);
    expect(getIncompleteAssessmentRuns(state)).toEqual([]);
    expect(getLatestCompletedAssessmentRun(state)).toBeUndefined();
  });
});

describe("deleteAssessmentRunFromHistory", () => {
  it("removes exactly the targeted run, as a whole, from history", () => {
    const keep = archivedCompletedRun("2026-01-01T00:00:00.000Z");
    const remove = archivedCompletedRun("2026-01-02T00:00:00.000Z");
    const state: AssessmentPersistedState = { schemaVersion: 1, history: [keep, remove] };

    const next = expectOk(deleteAssessmentRunFromHistory(state, remove.id));
    expect(next.history.map((run) => run.id)).toEqual([keep.id]);
  });

  it("never touches currentRun", () => {
    const currentRun = createTestRun();
    const archived = archivedCompletedRun("2026-01-01T00:00:00.000Z");
    const state: AssessmentPersistedState = { schemaVersion: 1, currentRun, history: [archived] };

    const next = expectOk(deleteAssessmentRunFromHistory(state, archived.id));
    expect(next.currentRun).toBe(currentRun);
    expect(next.history).toEqual([]);
  });

  it("rejects deleting a run that isn't in history", () => {
    const state = createEmptyAssessmentPersistedState();
    expect(expectErr(deleteAssessmentRunFromHistory(state, "not-a-real-id"))).toBe("run_not_found");
  });
});
