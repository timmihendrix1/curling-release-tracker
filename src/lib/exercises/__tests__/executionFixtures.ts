import { EXERCISE_CATALOG } from "../catalog";
import {
  EIGHT_GUARDS_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
} from "../content";
import {
  addShotmakingAttempt,
  completeExerciseExecution,
  createSoloExerciseExecution,
} from "../execution";
import type { ExerciseExecution } from "../executionTypes";
import { findExerciseVersion } from "../lookup";

export const FIXTURE_SESSION_ID = "10000000-0000-4000-8000-000000000001";
export const FIXTURE_ATHLETE_ID = "20000000-0000-4000-8000-000000000002";

function clock(seed: number) {
  let next = seed;
  return {
    id: () => `40000000-0000-4000-8000-${String(next++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 27, 10, 0, next++)).toISOString(),
  };
}

function version(id: string) {
  const candidate = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!candidate) throw new Error(`Missing Exercise Version fixture: ${id}`);
  return candidate;
}

export function createTechniqueExecution(
  sessionId = FIXTURE_SESSION_ID,
  seed = 1
): ExerciseExecution {
  const outcome = createSoloExerciseExecution(version(RELEASE_POINT_VERSION_ID), {
    trainingSessionId: sessionId,
    athleteProfileId: FIXTURE_ATHLETE_ID,
    clock: clock(seed),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

export function createCompletedTechniqueExecution(
  sessionId = FIXTURE_SESSION_ID,
  seed = 1
): ExerciseExecution {
  const outcome = completeExerciseExecution(
    createTechniqueExecution(sessionId, seed),
    "2026-08-27T10:10:00.000Z"
  );
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

export function createCompletedShotmakingExecution(
  sessionId = FIXTURE_SESSION_ID,
  seed = 20
): ExerciseExecution {
  const created = createSoloExerciseExecution(version(EIGHT_GUARDS_VERSION_ID), {
    trainingSessionId: sessionId,
    athleteProfileId: FIXTURE_ATHLETE_ID,
    clock: clock(seed),
  });
  if (!created.ok) throw new Error(created.error.message);
  const attempted = addShotmakingAttempt(created.value, {
    athleteProfileId: FIXTURE_ATHLETE_ID,
    intendedHandle: "in",
    actualHandle: "out",
    evaluation: { status: "scored", score: 3 },
    clock: clock(seed + 5),
  });
  if (!attempted.ok) throw new Error(attempted.error.message);
  const completed = completeExerciseExecution(
    attempted.value,
    "2026-08-27T10:10:00.000Z"
  );
  if (!completed.ok) throw new Error(completed.error.message);
  return completed.value;
}

export function createMeasuredExecution(
  sessionId = FIXTURE_SESSION_ID,
  seed = 40
): ExerciseExecution {
  const protocol = EXERCISE_CATALOG.measurementProtocols.find(
    (candidate) => candidate.measurementMode === "back-hog"
  );
  if (!protocol) throw new Error("Missing release-time protocol fixture");
  const outcome = createSoloExerciseExecution(version(RELEASE_TIME_VERSION_ID), {
    trainingSessionId: sessionId,
    athleteProfileId: FIXTURE_ATHLETE_ID,
    enabledMeasurementProtocols: [protocol],
    clock: clock(seed),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}
