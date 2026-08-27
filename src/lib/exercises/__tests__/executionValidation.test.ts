import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../catalog";
import { EIGHT_GUARDS_VERSION_ID, RELEASE_TIME_VERSION_ID } from "../content";
import {
  addMeasurementAttempt,
  addShotmakingAttempt,
  completeExerciseExecution,
  createSoloExerciseExecution,
} from "../execution";
import type { ExerciseExecution, ExerciseMeasurement } from "../executionTypes";
import { validateExerciseExecution } from "../executionValidation";
import { findExerciseVersion } from "../lookup";

const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const ATHLETE_ID = "20000000-0000-4000-8000-000000000002";
const IDS = Array.from(
  { length: 40 },
  (_, index) => `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
);
const AT = "2026-08-27T10:00:00.000Z";

function version(id: string) {
  const value = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!value) throw new Error(`Missing fixture ${id}`);
  return value;
}

function clock(offset = 0) {
  let index = offset;
  return {
    id: () => IDS[index++],
    now: () => new Date(Date.parse(AT) + index * 1_000).toISOString(),
  };
}

function protocol() {
  const value = EXERCISE_CATALOG.measurementProtocols[0];
  if (!value) throw new Error("Missing protocol fixture");
  return value;
}

function shotmaking(): ExerciseExecution {
  const created = createSoloExerciseExecution(version(EIGHT_GUARDS_VERSION_ID), {
    trainingSessionId: SESSION_ID,
    athleteProfileId: ATHLETE_ID,
    clock: clock(),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function measured(): ExerciseExecution {
  const created = createSoloExerciseExecution(version(RELEASE_TIME_VERSION_ID), {
    trainingSessionId: SESSION_ID,
    athleteProfileId: ATHLETE_ID,
    enabledMeasurementProtocols: [protocol()],
    clock: clock(),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function measurement(id = IDS[20]): ExerciseMeasurement {
  const selected = protocol();
  return {
    id,
    protocolId: selected.id,
    protocolVersion: selected.version,
    value: 3.75,
    source: "manual",
    recordedAt: "2026-08-27T10:05:00.000Z",
  };
}

function mutable(value: ExerciseExecution): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

describe("persisted Exercise Execution validation", () => {
  it("accepts factory-created active and terminal executions", () => {
    const active = shotmaking();
    expect(validateExerciseExecution(active, EXERCISE_CATALOG)).toMatchObject({ valid: true });
    const attempted = addShotmakingAttempt(active, {
      athleteProfileId: ATHLETE_ID,
      actualHandle: "in",
      evaluation: { status: "scored", score: 0 },
      clock: clock(5),
    });
    if (!attempted.ok) throw new Error(attempted.error.message);
    const completed = completeExerciseExecution(attempted.value, "2026-08-27T11:00:00.000Z");
    if (!completed.ok) throw new Error(completed.error.message);
    expect(validateExerciseExecution(completed.value, EXERCISE_CATALOG)).toMatchObject({ valid: true });
  });

  it("rejects a rewritten immutable Exercise Version snapshot", () => {
    const corrupt = mutable(shotmaking());
    (corrupt.exerciseVersionSnapshot as Record<string, unknown>).goal = "A later rewrite";
    const result = validateExerciseExecution(corrupt, EXERCISE_CATALOG);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "exerciseVersionSnapshot" })
    );
  });

  it("rejects a tampered Measurement Protocol snapshot", () => {
    const corrupt = mutable(measured());
    const configuration = corrupt.configuration as Record<string, unknown>;
    const protocols = configuration.enabledMeasurementProtocols as Record<string, unknown>[];
    protocols[0].allowedSources = ["external"];
    const result = validateExerciseExecution(corrupt, EXERCISE_CATALOG);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.some((issue) => issue.path.includes("enabledMeasurementProtocols"))).toBe(true);
  });

  it("accumulates independent corruption issues instead of stopping at the first", () => {
    const corrupt = mutable(shotmaking());
    corrupt.id = "bad-id";
    corrupt.trainingSessionId = "bad-session";
    corrupt.schemaVersion = 99;
    corrupt.completedAt = AT;
    const configuration = corrupt.configuration as Record<string, unknown>;
    configuration.sweeperCount = 2;
    configuration.sweepingUsed = true;
    const result = validateExerciseExecution(corrupt, EXERCISE_CATALOG);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.length).toBeGreaterThanOrEqual(5);
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["schemaVersion", "id", "trainingSessionId", "status", "configuration.sweeping"])
    );
  });

  it("rejects mismatched athlete ownership and role context", () => {
    const corrupt = mutable(shotmaking());
    const results = corrupt.athleteResults as Record<string, unknown>[];
    results[0].athleteProfileId = "40000000-0000-4000-8000-000000000004";
    const result = validateExerciseExecution(corrupt, EXERCISE_CATALOG);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "athleteResults[0].athleteProfileId" })
    );
  });

  it("rejects duplicate ids and broken one-based attempt ordering", () => {
    const first = addShotmakingAttempt(shotmaking(), {
      athleteProfileId: ATHLETE_ID,
      actualHandle: "in",
      evaluation: { status: "scored", score: 2 },
      clock: clock(5),
    });
    if (!first.ok) throw new Error(first.error.message);
    const second = addShotmakingAttempt(first.value, {
      athleteProfileId: ATHLETE_ID,
      actualHandle: "out",
      evaluation: { status: "scored", score: 4 },
      clock: clock(6),
    });
    if (!second.ok) throw new Error(second.error.message);
    const corrupt = mutable(second.value);
    const attempts = (corrupt.athleteResults as Record<string, unknown>[])[0]
      .attempts as Record<string, unknown>[];
    attempts[1].id = attempts[0].id;
    attempts[1].sequenceNumber = 8;
    const result = validateExerciseExecution(corrupt, EXERCISE_CATALOG);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "athleteResults[0].attempts[1].id",
        "athleteResults[0].attempts[1].sequenceNumber",
      ])
    );
  });

  it("rejects an empty completed Measured execution", () => {
    const corrupt = mutable(measured());
    corrupt.status = "completed";
    corrupt.completedAt = "2026-08-27T11:00:00.000Z";
    const result = validateExerciseExecution(corrupt, EXERCISE_CATALOG);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues).toContainEqual(
      expect.objectContaining({ path: "status", message: expect.stringContaining("Measurement") })
    );
  });

  it("accepts a measured attempt and rejects invalid measurement provenance", () => {
    const captured = addMeasurementAttempt(measured(), {
      athleteProfileId: ATHLETE_ID,
      measurements: [measurement()],
      clock: clock(5),
    });
    if (!captured.ok) throw new Error(captured.error.message);
    expect(validateExerciseExecution(captured.value, EXERCISE_CATALOG)).toMatchObject({ valid: true });

    const corrupt = mutable(captured.value);
    const attempts = (corrupt.athleteResults as Record<string, unknown>[])[0]
      .attempts as Record<string, unknown>[];
    const measurements = attempts[0].measurements as Record<string, unknown>[];
    measurements[0].observerProfileId = "not-a-profile";
    measurements[0].deviceId = "   ";
    const result = validateExerciseExecution(corrupt, EXERCISE_CATALOG);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "athleteResults[0].attempts[0].measurements[0].observerProfileId",
        "athleteResults[0].attempts[0].measurements[0].deviceId",
      ])
    );
  });
});
