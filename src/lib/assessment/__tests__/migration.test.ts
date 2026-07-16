import { describe, expect, it } from "vitest";
import { migrateAssessmentPersistedState, validatePersistedAssessmentRun } from "../migration";
import { ASSESSMENT_PERSISTENCE_SCHEMA_VERSION, createEmptyAssessmentPersistedState } from "../persistence";
import { transitionAssessmentRun } from "../run";
import { ASSESSMENT_RUN_SCHEMA_VERSION } from "../types";
import { completeAllScoredShots, completeWarmup, createTestRun, expectOk } from "./testHelpers";

/** Round-trips a run through JSON exactly like real LocalStorage persistence would. */
function toRaw<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

function pausedRunRaw() {
  let run = createTestRun();
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  return toRaw(run) as Record<string, unknown>;
}

function completedRunRaw() {
  let run = createTestRun();
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  run = completeAllScoredShots(run);
  run = expectOk(transitionAssessmentRun(run, "completed"));
  return toRaw(run) as Record<string, unknown>;
}

describe("validatePersistedAssessmentRun", () => {
  it("accepts a genuine, unmodified run round-tripped through JSON", () => {
    const outcome = validatePersistedAssessmentRun(completedRunRaw());
    expect(outcome.ok).toBe(true);
  });

  it("accepts a genuine paused, in-progress run", () => {
    const outcome = validatePersistedAssessmentRun(pausedRunRaw());
    expect(outcome.ok).toBe(true);
  });

  it("rejects a non-object", () => {
    expect(validatePersistedAssessmentRun("not-an-object").ok).toBe(false);
    expect(validatePersistedAssessmentRun(null).ok).toBe(false);
    expect(validatePersistedAssessmentRun(undefined).ok).toBe(false);
  });

  it("rejects an unknown run schema version", () => {
    const raw = completedRunRaw();
    raw.schemaVersion = ASSESSMENT_RUN_SCHEMA_VERSION + 1;
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects a missing required field", () => {
    const raw = completedRunRaw();
    delete raw.templateId;
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an invalid status", () => {
    const raw = completedRunRaw();
    raw.status = "not-a-real-status";
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an invalid templateVersion", () => {
    const raw = completedRunRaw();
    raw.templateVersion = -1;
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an invalid thresholdSnapshot", () => {
    const raw = completedRunRaw();
    (raw.thresholdSnapshot as Record<string, unknown>).values = { onTarget: 0.3, acceptable: 0.1 };
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects duplicate attempt IDs", () => {
    const raw = completedRunRaw();
    const attempts = raw.attempts as Array<Record<string, unknown>>;
    attempts[1].id = attempts[0].id;
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects a duplicate valid attempt for the same planned shot", () => {
    const raw = completedRunRaw();
    const attempts = raw.attempts as Array<Record<string, unknown>>;
    attempts[1].plannedShotId = attempts[0].plannedShotId;
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an attempt referencing an unknown planned shot", () => {
    const raw = completedRunRaw();
    const attempts = raw.attempts as Array<Record<string, unknown>>;
    attempts[0].plannedShotId = "not-a-real-planned-shot";
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects a completed run with an open scored shot", () => {
    const raw = completedRunRaw();
    raw.attempts = (raw.attempts as Array<Record<string, unknown>>).slice(0, -1);
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an invalid createdAt timestamp", () => {
    const raw = completedRunRaw();
    raw.createdAt = "not-a-timestamp";
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects a NaN measuredTime", () => {
    const raw = completedRunRaw();
    const attempts = raw.attempts as Array<Record<string, unknown>>;
    // JSON cannot represent NaN directly, but a corrupted string value simulates the
    // same "not a finite number" failure mode this check must catch.
    attempts[0].measuredTime = "NaN";
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an Infinity measuredTime encoded as a non-finite marker", () => {
    const raw = completedRunRaw();
    const attempts = raw.attempts as Array<Record<string, unknown>>;
    attempts[0].measuredTime = null;
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an invalid handle value", () => {
    const raw = completedRunRaw();
    const attempts = raw.attempts as Array<Record<string, unknown>>;
    attempts[0].executedHandle = "sideways";
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects an invalid measurement mode", () => {
    const raw = completedRunRaw();
    (raw.timingProviderSnapshot as Record<string, unknown>).measurementMode = "not-a-mode";
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });

  it("rejects non-unique timingResultIds", () => {
    const raw = completedRunRaw();
    const attempts = raw.attempts as Array<Record<string, unknown>>;
    attempts[0].timingResultId = "shared-id";
    attempts[1].timingResultId = "shared-id";
    expect(validatePersistedAssessmentRun(raw).ok).toBe(false);
  });
});

describe("migrateAssessmentPersistedState", () => {
  it("returns a fresh empty state for null/undefined/non-object input", () => {
    expect(migrateAssessmentPersistedState(null)).toEqual(createEmptyAssessmentPersistedState());
    expect(migrateAssessmentPersistedState(undefined)).toEqual(createEmptyAssessmentPersistedState());
    expect(migrateAssessmentPersistedState("garbage")).toEqual(createEmptyAssessmentPersistedState());
  });

  it("loads a genuine v1 persisted state unchanged", () => {
    const raw = {
      schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
      history: [completedRunRaw()],
    };
    const state = migrateAssessmentPersistedState(raw);
    expect(state.history).toHaveLength(1);
    expect(state.currentRun).toBeUndefined();
  });

  it("loads a current run alongside history", () => {
    const raw = {
      schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
      currentRun: pausedRunRaw(),
      history: [completedRunRaw()],
    };
    const state = migrateAssessmentPersistedState(raw);
    expect(state.history).toHaveLength(1);
    expect(state.currentRun).toBeDefined();
  });

  it("resolves an unknown future schema version to a fresh empty state, never guess-migrated", () => {
    const raw = {
      schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION + 1,
      history: [completedRunRaw()],
    };
    expect(migrateAssessmentPersistedState(raw)).toEqual(createEmptyAssessmentPersistedState());
  });

  it("quarantines (drops) an individually invalid history entry while keeping valid ones", () => {
    const validRun = completedRunRaw();
    const corruptRun = completedRunRaw();
    corruptRun.status = "not-a-real-status";

    const state = migrateAssessmentPersistedState({
      schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
      history: [validRun, corruptRun],
    });

    expect(state.history).toHaveLength(1);
    expect(state.history[0].id).toBe(validRun.id);
  });

  it("drops an invalid currentRun rather than crashing", () => {
    const corruptRun = pausedRunRaw();
    corruptRun.currentPlannedShotIndex = -1;

    const state = migrateAssessmentPersistedState({
      schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
      currentRun: corruptRun,
      history: [],
    });

    expect(state.currentRun).toBeUndefined();
  });

  it("deduplicates history entries that share the same id", () => {
    const run = completedRunRaw();
    const state = migrateAssessmentPersistedState({
      schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
      history: [run, run],
    });
    expect(state.history).toHaveLength(1);
  });
});
