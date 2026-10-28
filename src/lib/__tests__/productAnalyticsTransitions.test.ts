import { describe, expect, it, vi } from "vitest";
import { createProductTransitionObserver } from "../productAnalyticsTransitions";
import { createNewSession } from "../sessionMigration";
import type { Session } from "../../types";
import type { ExerciseExecution } from "../exercises/executionTypes";
import type { AssessmentRun } from "../assessment/types";
import type { AssessmentPersistedState } from "../assessment/persistence";

function fixture() {
  const delivered: string[] = [];
  const prepare = vi.fn((event: string, key: string) => () => { delivered.push(`${event}:${key}`); });
  return { observer: createProductTransitionObserver(prepare), prepare, delivered };
}
// Minimal projections: this observer must never need measurements, notes or participants.
const exercise = (status: ExerciseExecution["status"]) => ({ id: "exercise", status }) as ExerciseExecution;
const run = (status: AssessmentRun["status"]) => ({ id: "assessment", status, startedAt: "2026-10-27T12:00:00Z" }) as AssessmentRun;

describe("analytics occurrence and save acknowledgement", () => {
  it("does not backfill restored sessions or completed Assessment history", () => {
    const f = fixture();
    f.observer.sessionSaved({ ...createNewSession(), exerciseExecutions: [exercise("completed")] });
    f.observer.assessmentSaved({ schemaVersion: 1, history: [run("completed")] });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.delivered).toEqual([]);
  });
  it("reports an exercise start at the accepted transition but completion only after an ACK containing it", () => {
    const f = fixture(); const blank = createNewSession();
    const active: Session = { ...blank, exerciseExecutions: [exercise("in-progress")] };
    f.observer.sessionCommit(blank, active);
    expect(f.delivered).toContain("exercise_started:exercise");
    const complete = { ...active, exerciseExecutions: [exercise("completed")] };
    f.observer.sessionCommit(active, complete);
    // An older successful write must not acknowledge the completed execution.
    f.observer.sessionSaved(active);
    expect(f.delivered).not.toContain("exercise_completed:exercise");
    f.observer.sessionSaved(complete); f.observer.sessionSaved(complete);
    expect(f.delivered.filter(item => item === "exercise_completed:exercise")).toHaveLength(1);
  });
  it("does not call an abandoned exercise a completion", () => {
    const f = fixture(); const active = { ...createNewSession(), exerciseExecutions: [exercise("in-progress")] };
    const abandoned = { ...active, exerciseExecutions: [exercise("abandoned")] };
    f.observer.sessionCommit(active, abandoned); f.observer.sessionSaved(abandoned);
    expect(f.delivered).toEqual([]);
  });
  it("counts completed Assessment runs only after their successful persisted history ACK", () => {
    const f = fixture(); const active: AssessmentPersistedState = { schemaVersion: 1, currentRun: run("in_progress"), history: [] };
    const terminal: AssessmentPersistedState = { schemaVersion: 1, history: [run("completed")] };
    f.observer.assessmentCommit(active, terminal); f.observer.assessmentSaved(active);
    expect(f.delivered).toEqual([]);
    f.observer.assessmentSaved(terminal); f.observer.assessmentSaved(terminal);
    expect(f.delivered).toEqual(["assessment_completed:assessment"]);
  });
  it("does not count an incomplete Assessment as completed", () => {
    const f = fixture(); const before: AssessmentPersistedState = { schemaVersion: 1, currentRun: run("in_progress"), history: [] };
    const after: AssessmentPersistedState = { schemaVersion: 1, history: [run("incomplete")] };
    f.observer.assessmentCommit(before, after); f.observer.assessmentSaved(after);
    expect(f.delivered).toEqual([]);
  });
});
