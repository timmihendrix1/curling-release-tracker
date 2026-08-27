import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../catalog";
import {
  EIGHT_GUARDS_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
} from "../content";
import {
  abandonExerciseExecution,
  addMeasurementAttempt,
  addShotmakingAttempt,
  completeExerciseExecution,
  createSoloExerciseExecution,
  updatePrivateAthleteNote,
} from "../execution";
import { findExerciseVersion } from "../lookup";
import type { ExerciseMeasurement } from "../executionTypes";

const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const ATHLETE_ID = "20000000-0000-4000-8000-000000000002";
const OTHER_ATHLETE_ID = "30000000-0000-4000-8000-000000000003";
const IDS = Array.from(
  { length: 30 },
  (_, index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
);
const START = "2026-08-27T10:00:00.000Z";

function version(id: string) {
  const value = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!value) throw new Error(`Missing fixture ${id}`);
  return value;
}

function clock(offset = 0) {
  let index = offset;
  return {
    id: () => IDS[index++],
    now: () => new Date(Date.parse(START) + index * 1_000).toISOString(),
  };
}

function releaseTimeProtocol() {
  const protocol = EXERCISE_CATALOG.measurementProtocols.find(
    (candidate) => candidate.measurementMode === "back-hog"
  );
  if (!protocol) throw new Error("Missing release-time protocol fixture");
  return protocol;
}

function createTechnique() {
  const outcome = createSoloExerciseExecution(version(RELEASE_POINT_VERSION_ID), {
    trainingSessionId: SESSION_ID,
    athleteProfileId: ATHLETE_ID,
    clock: clock(),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

function createShotmaking() {
  const outcome = createSoloExerciseExecution(version(EIGHT_GUARDS_VERSION_ID), {
    trainingSessionId: SESSION_ID,
    athleteProfileId: ATHLETE_ID,
    selectedVariationId: "same-handle",
    clock: clock(),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

function createMeasured() {
  const outcome = createSoloExerciseExecution(version(RELEASE_TIME_VERSION_ID), {
    trainingSessionId: SESSION_ID,
    athleteProfileId: ATHLETE_ID,
    enabledMeasurementProtocols: [releaseTimeProtocol()],
    clock: clock(),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

function measurement(id = IDS[20], value = 3.75): ExerciseMeasurement {
  const protocol = releaseTimeProtocol();
  return {
    id,
    protocolId: protocol.id,
    protocolVersion: protocol.version,
    value,
    source: "manual",
    recordedAt: "2026-08-27T10:01:00.000Z",
  };
}

describe("Solo Exercise Execution", () => {
  it("snapshots the immutable Exercise Version and records standard versus actual configuration", () => {
    const source = version(EIGHT_GUARDS_VERSION_ID);
    const outcome = createSoloExerciseExecution(source, {
      trainingSessionId: SESSION_ID,
      athleteProfileId: ATHLETE_ID,
      selectedVariationId: "same-handle",
      plannedVolume: { kind: "stones", value: 6 },
      additionalDeviationNotes: ["The athlete used six stones."],
      clock: clock(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.exerciseVersionSnapshot).toEqual(source);
    expect(outcome.value.exerciseVersionSnapshot).not.toBe(source);
    expect(outcome.value.configuration).toMatchObject({
      selectedVariationId: "same-handle",
      plannedVolume: { kind: "stones", value: 6 },
      sweeperCount: 0,
      sweepingUsed: false,
    });
    expect(outcome.value.configuration.deviations).toContainEqual({
      kind: "other",
      description: "The athlete used six stones.",
    });
    expect(outcome.value.evaluationBasis).toBe("team-defined-unstructured");
    expect(outcome.value.roleAssignmentSegments[0].deliveringAthleteProfileId).toBe(ATHLETE_ID);
    expect(outcome.value.athleteResults[0].athleteProfileId).toBe(ATHLETE_ID);
  });

  it("rejects invalid ids, unknown variations and non-positive volume", () => {
    const exercise = version(EIGHT_GUARDS_VERSION_ID);
    expect(
      createSoloExerciseExecution(exercise, {
        trainingSessionId: "not-a-uuid",
        athleteProfileId: ATHLETE_ID,
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(
      createSoloExerciseExecution(exercise, {
        trainingSessionId: SESSION_ID,
        athleteProfileId: ATHLETE_ID,
        selectedVariationId: "invented",
      })
    ).toMatchObject({ ok: false, error: { code: "unsupported-variation" } });
    expect(
      createSoloExerciseExecution(exercise, {
        trainingSessionId: SESSION_ID,
        athleteProfileId: ATHLETE_ID,
        plannedVolume: { kind: "stones", value: 0 },
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("requires a compatible protocol for a standalone Measured Exercise", () => {
    expect(
      createSoloExerciseExecution(version(RELEASE_TIME_VERSION_ID), {
        trainingSessionId: SESSION_ID,
        athleteProfileId: ATHLETE_ID,
        clock: clock(),
      })
    ).toMatchObject({
      ok: false,
      error: { code: "required-measurement-protocol-missing" },
    });

    const foreign = { ...releaseTimeProtocol(), id: "not-compatible" };
    expect(
      createSoloExerciseExecution(version(RELEASE_TIME_VERSION_ID), {
        trainingSessionId: SESSION_ID,
        athleteProfileId: ATHLETE_ID,
        enabledMeasurementProtocols: [foreign],
        clock: clock(),
      })
    ).toMatchObject({
      ok: false,
      error: { code: "unsupported-measurement-protocol" },
    });

    const tampered = { ...releaseTimeProtocol(), allowedSources: ["external" as const] };
    expect(
      createSoloExerciseExecution(version(RELEASE_TIME_VERSION_ID), {
        trainingSessionId: SESSION_ID,
        athleteProfileId: ATHLETE_ID,
        enabledMeasurementProtocols: [tampered],
        clock: clock(),
      })
    ).toMatchObject({
      ok: false,
      error: { code: "unsupported-measurement-protocol" },
    });
  });

  it("refuses a rewritten or non-catalog Exercise Version at the creation boundary", () => {
    const rewritten = {
      ...version(RELEASE_POINT_VERSION_ID),
      goal: "Rewritten after publication",
    };
    expect(
      createSoloExerciseExecution(rewritten, {
        trainingSessionId: SESSION_ID,
        athleteProfileId: ATHLETE_ID,
        clock: clock(),
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("accepts zero as a real Shotmaking score and preserves actual handle", () => {
    const execution = createShotmaking();
    const outcome = addShotmakingAttempt(execution, {
      athleteProfileId: ATHLETE_ID,
      intendedHandle: "out",
      actualHandle: "in",
      evaluation: { status: "scored", score: 0 },
      clock: clock(4),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.athleteResults[0].attempts[0]).toMatchObject({
      kind: "shotmaking",
      sequenceNumber: 1,
      intendedHandle: "out",
      actualHandle: "in",
      evaluation: { status: "scored", score: 0 },
    });
  });

  it("retains excluded attempts and requires an explanation for Other", () => {
    const execution = createShotmaking();
    expect(
      addShotmakingAttempt(execution, {
        athleteProfileId: ATHLETE_ID,
        actualHandle: "in",
        evaluation: { status: "excluded", reason: "other" },
        clock: clock(4),
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-attempt" } });

    const outcome = addShotmakingAttempt(execution, {
      athleteProfileId: ATHLETE_ID,
      actualHandle: "out",
      evaluation: {
        status: "excluded",
        reason: "other",
        explanation: "A loose stone crossed the path.",
      },
      clock: clock(4),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.athleteResults[0].attempts[0]).toMatchObject({
      evaluation: { status: "excluded", reason: "other" },
    });
  });

  it("rejects wrong-athlete capture and focus-specific attempt misuse", () => {
    expect(
      addShotmakingAttempt(createShotmaking(), {
        athleteProfileId: OTHER_ATHLETE_ID,
        actualHandle: "in",
        evaluation: { status: "scored", score: 4 },
        clock: clock(4),
      })
    ).toMatchObject({ ok: false, error: { code: "wrong-athlete" } });
    expect(
      addShotmakingAttempt(createTechnique(), {
        athleteProfileId: ATHLETE_ID,
        actualHandle: "in",
        evaluation: { status: "scored", score: 4 },
        clock: clock(4),
      })
    ).toMatchObject({ ok: false, error: { code: "unsupported-focus" } });
    expect(
      addMeasurementAttempt(createShotmaking(), {
        athleteProfileId: ATHLETE_ID,
        measurements: [measurement()],
        clock: clock(4),
      })
    ).toMatchObject({ ok: false, error: { code: "unsupported-focus" } });
  });

  it("records only enabled, valid Measurements", () => {
    const execution = createMeasured();
    const outcome = addMeasurementAttempt(execution, {
      athleteProfileId: ATHLETE_ID,
      actualHandle: "out",
      measurements: [measurement()],
      clock: clock(4),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.athleteResults[0].attempts[0]).toMatchObject({
      kind: "measurement",
      actualHandle: "out",
      measurements: [{ value: 3.75, source: "manual" }],
    });

    expect(
      addMeasurementAttempt(execution, {
        athleteProfileId: ATHLETE_ID,
        measurements: [{ ...measurement(), value: -1 }],
        clock: clock(4),
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-attempt" } });
    expect(
      addMeasurementAttempt(execution, {
        athleteProfileId: ATHLETE_ID,
        measurements: [{ ...measurement(), protocolId: "unknown" }],
        clock: clock(4),
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-attempt" } });
  });

  it("rejects duplicate stable entity ids produced by a faulty clock", () => {
    const repeatedId = IDS[0];
    const faultyClock = { id: () => repeatedId, now: () => START };
    expect(
      createSoloExerciseExecution(version(RELEASE_POINT_VERSION_ID), {
        trainingSessionId: SESSION_ID,
        athleteProfileId: ATHLETE_ID,
        clock: faultyClock,
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } });

    const execution = createShotmaking();
    expect(
      addShotmakingAttempt(execution, {
        athleteProfileId: ATHLETE_ID,
        actualHandle: "in",
        evaluation: { status: "scored", score: 4 },
        clock: { id: () => execution.id, now: () => START },
      })
    ).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("allows Technique completion without attempts but gates other focus completion", () => {
    expect(completeExerciseExecution(createTechnique(), "2026-08-27T11:00:00.000Z")).toMatchObject({
      ok: true,
      value: { status: "completed" },
    });
    expect(completeExerciseExecution(createShotmaking())).toMatchObject({
      ok: false,
      error: { code: "not-completable" },
    });
    expect(completeExerciseExecution(createMeasured())).toMatchObject({
      ok: false,
      error: { code: "not-completable" },
    });
  });

  it("completes after factual capture and rejects attempts after terminal status", () => {
    const measured = createMeasured();
    const captured = addMeasurementAttempt(measured, {
      athleteProfileId: ATHLETE_ID,
      measurements: [measurement()],
      clock: clock(4),
    });
    if (!captured.ok) throw new Error(captured.error.message);
    const completed = completeExerciseExecution(captured.value, "2026-08-27T11:00:00.000Z");
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(
      addMeasurementAttempt(completed.value, {
        athleteProfileId: ATHLETE_ID,
        measurements: [measurement(IDS[21])],
        clock: clock(6),
      })
    ).toMatchObject({ ok: false, error: { code: "execution-not-active" } });
  });

  it("keeps the Athlete Note private to its result and editable after completion", () => {
    const completed = completeExerciseExecution(createTechnique(), "2026-08-27T11:00:00.000Z");
    if (!completed.ok) throw new Error(completed.error.message);
    expect(
      updatePrivateAthleteNote(completed.value, OTHER_ATHLETE_ID, "Not mine")
    ).toMatchObject({ ok: false, error: { code: "wrong-athlete" } });
    const noted = updatePrivateAthleteNote(
      completed.value,
      ATHLETE_ID,
      "Release moved later on the final repetitions.",
      "2026-08-27T11:01:00.000Z"
    );
    expect(noted).toMatchObject({
      ok: true,
      value: {
        athleteResults: [{ privateNote: "Release moved later on the final repetitions." }],
      },
    });
    if (!noted.ok) return;
    expect(
      updatePrivateAthleteNote(noted.value, ATHLETE_ID, "", "2026-08-27T11:02:00.000Z")
    ).toMatchObject({ ok: true, value: { athleteResults: [{ privateNote: undefined }] } });
  });

  it("records interruption as an abandoned terminal execution", () => {
    const outcome = abandonExerciseExecution(createTechnique(), "2026-08-27T10:30:00.000Z");
    expect(outcome).toMatchObject({
      ok: true,
      value: { status: "abandoned", abandonedAt: "2026-08-27T10:30:00.000Z" },
    });
    if (!outcome.ok) return;
    expect(abandonExerciseExecution(outcome.value)).toMatchObject({
      ok: false,
      error: { code: "execution-not-active" },
    });
  });
});
