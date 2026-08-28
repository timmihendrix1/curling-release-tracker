import { describe, expect, it } from "vitest";
import type { Session } from "../../../types";
import type { ExerciseExecution } from "../executionTypes";
import { serializeTrainingSession } from "../../cloudSporting/records";
import { EXERCISE_CATALOG } from "../catalog";
import {
  EIGHT_GUARDS_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
  ROTATION_COUNT_VERSION_ID,
} from "../content";
import { updatePrivateAthleteNote } from "../execution";
import { validateExerciseExecution } from "../executionValidation";
import { findExerciseVersion, resolveMeasurementProtocols } from "../lookup";
import { attachSoloExerciseExecution } from "../sessionIntegration";
import {
  abandonTeamExerciseExecution,
  addTeamShotmakingAttempt,
  addTeamMeasurementAttempt,
  annulTeamShotmakingAttempt,
  changeTeamRoleAssignment,
  completeTeamExerciseExecution,
  createTeamExerciseExecution,
  correctTeamShotmakingAttempt,
  getTeamAttemptRoleContext,
  getTeamRotationRecommendation,
  listTeamAttemptsInRecordingOrder,
  type CreateTeamExerciseExecutionOptions,
  type TeamRoleAssignmentInput,
} from "../teamExecution";

const SESSION_ID = "10000000-0000-4000-8000-000000000001";
const TEAM_ID = "20000000-0000-4000-8000-000000000002";
const ATHLETE_A = "30000000-0000-4000-8000-000000000003";
const ATHLETE_B = "40000000-0000-4000-8000-000000000004";
const RECORDER = "50000000-0000-4000-8000-000000000005";
const SWEEPER = "60000000-0000-4000-8000-000000000006";

function clock(seed: number, startMinute = 0) {
  let nextId = seed;
  let nextTime = startMinute;
  return {
    id: () => `70000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 28, 10, nextTime++)).toISOString(),
  };
}

function version(id: string) {
  const candidate = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!candidate) throw new Error(`Missing fixture Exercise Version ${id}`);
  return candidate;
}

const roster: CreateTeamExerciseExecutionOptions["participantRoster"] = [
  { profileId: ATHLETE_A, participation: "training-athlete" },
  { profileId: ATHLETE_B, participation: "training-athlete" },
  { profileId: RECORDER, participation: "supporting" },
  { profileId: SWEEPER, participation: "supporting" },
];

function assignment(deliveringAthleteProfileId = ATHLETE_A): TeamRoleAssignmentInput {
  return {
    deliveringAthleteProfileId,
    sweeperProfileIds: [],
    observerProfileId: RECORDER,
    sweepingUsed: false,
  };
}

function createTeam(
  overrides: Partial<CreateTeamExerciseExecutionOptions> = {},
  exerciseVersionId = EIGHT_GUARDS_VERSION_ID
) {
  const outcome = createTeamExerciseExecution(version(exerciseVersionId), {
    trainingSessionId: SESSION_ID,
    teamId: TEAM_ID,
    recorderProfileId: RECORDER,
    participantRoster: roster,
    initialRoleAssignment: assignment(),
    rotation: { kind: "after-every-stone", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    clock: clock(1),
    ...overrides,
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

function addAttempt(execution: ReturnType<typeof createTeam>, seed: number, score: 0 | 1 | 2 | 3 | 4 = 3) {
  const athleteProfileId = execution.roleAssignmentSegments.at(-1)?.deliveringAthleteProfileId;
  if (!athleteProfileId) throw new Error("Missing active athlete");
  const outcome = addTeamShotmakingAttempt(execution, {
    recorderProfileId: RECORDER,
    athleteProfileId,
    actualHandle: "in",
    evaluation: { status: "scored", score },
    clock: clock(seed, seed),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

describe("Stage C1 Team Exercise Execution domain", () => {
  it("creates one Team aggregate with confirmed participants, results and initial role truth", () => {
    const execution = createTeam();

    expect(execution.teamContext).toEqual({
      kind: "team",
      teamId: TEAM_ID,
      recorderProfileId: RECORDER,
      participantRoster: roster,
      rotation: { kind: "after-every-stone", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    });
    expect(execution.athleteResults.map((result) => result.athleteProfileId)).toEqual([
      ATHLETE_A,
      ATHLETE_B,
    ]);
    expect(execution.roleAssignmentSegments[0]).toMatchObject({
      deliveringAthleteProfileId: ATHLETE_A,
      observerProfileId: RECORDER,
      sweepingUsed: false,
      recordedByProfileId: RECORDER,
      transitionReason: "initial",
    });
    expect(validateExerciseExecution(execution, EXERCISE_CATALOG)).toEqual({
      valid: true,
      value: execution,
      issues: [],
    });
  });

  it("keeps schema-1 Team history readable while requiring schema 2 for correction audit", () => {
    const current = createTeam();
    const legacy = structuredClone(current) as ExerciseExecution;
    legacy.schemaVersion = 1;
    delete legacy.activeAttemptCorrections;
    expect(validateExerciseExecution(legacy, EXERCISE_CATALOG).valid).toBe(true);
    legacy.activeAttemptCorrections = [];
    expect(validateExerciseExecution(legacy, EXERCISE_CATALOG).valid).toBe(false);
  });

  it("requires distinct authenticated roster Profiles and the recorder in that roster", () => {
    const duplicate = createTeamExerciseExecution(version(EIGHT_GUARDS_VERSION_ID), {
      trainingSessionId: SESSION_ID,
      teamId: TEAM_ID,
      recorderProfileId: RECORDER,
      participantRoster: [
        { profileId: ATHLETE_A, participation: "training-athlete" },
        { profileId: ATHLETE_A, participation: "supporting" },
      ],
      initialRoleAssignment: assignment(),
      rotation: { kind: "fixed", athleteOrder: [ATHLETE_A] },
    });
    const missingRecorder = createTeamExerciseExecution(version(EIGHT_GUARDS_VERSION_ID), {
      trainingSessionId: SESSION_ID,
      teamId: TEAM_ID,
      recorderProfileId: RECORDER,
      participantRoster: [{ profileId: ATHLETE_A, participation: "training-athlete" }],
      initialRoleAssignment: assignment(),
      rotation: { kind: "fixed", athleteOrder: [ATHLETE_A] },
    });

    expect(duplicate).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(missingRecorder).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("records deliberate sweeping deviations instead of blocking them", () => {
    const execution = createTeam({
      initialRoleAssignment: {
        ...assignment(),
        sweeperProfileIds: [SWEEPER],
        sweepingUsed: true,
      },
    });

    expect(execution.configuration.deviations).toEqual([
      expect.objectContaining({ kind: "sweeper-count" }),
      expect.objectContaining({ kind: "sweeping-use" }),
    ]);
    expect(validateExerciseExecution(execution, EXERCISE_CATALOG).valid).toBe(true);
  });

  it("refuses a parallel Team Measured execution and keeps Release Time on its existing runner", () => {
    const outcome = createTeamExerciseExecution(version(RELEASE_TIME_VERSION_ID), {
      trainingSessionId: SESSION_ID,
      teamId: TEAM_ID,
      recorderProfileId: RECORDER,
      participantRoster: roster,
      initialRoleAssignment: assignment(),
      rotation: { kind: "fixed", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    });

    expect(outcome).toMatchObject({ ok: false, error: { code: "unsupported-focus" } });
  });

  it("records a standalone Team Measurement for the active delivering athlete", () => {
    const measuredVersion = version(ROTATION_COUNT_VERSION_ID);
    const protocols = resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      measuredVersion.compatibleMeasurementProtocols
    ).map(({ protocol }) => protocol);
    const execution = createTeam(
      { enabledMeasurementProtocols: protocols },
      ROTATION_COUNT_VERSION_ID
    );
    const outcome = addTeamMeasurementAttempt(execution, {
      recorderProfileId: RECORDER,
      athleteProfileId: ATHLETE_A,
      actualHandle: "out",
      measurements: [{
        id: "80000000-0000-4000-8000-000000000008",
        protocolId: protocols[0].id,
        protocolVersion: protocols[0].version,
        value: 2.5,
        source: "manual",
        recordedAt: "2026-08-28T10:20:00.000Z",
        observerProfileId: RECORDER,
      }],
      clock: clock(20, 20),
    });

    expect(outcome).toMatchObject({
      ok: true,
      value: {
        athleteResults: [
          {
            athleteProfileId: ATHLETE_A,
            attempts: [{
              kind: "measurement",
              actualHandle: "out",
              recordedByProfileId: RECORDER,
              measurements: [{ value: 2.5, observerProfileId: RECORDER }],
            }],
          },
          { athleteProfileId: ATHLETE_B, attempts: [] },
        ],
      },
    });
    if (outcome.ok) {
      expect(validateExerciseExecution(outcome.value, EXERCISE_CATALOG)).toEqual({
        valid: true,
        value: outcome.value,
        issues: [],
      });
    }
  });

  it("rejects incomplete athlete orders and invalid stone-count rotation", () => {
    expect(() => createTeam({
      rotation: { kind: "manual", athleteOrder: [ATHLETE_A] },
    })).toThrow("Rotation order must contain every training athlete exactly once.");
    expect(() => createTeam({
      rotation: { kind: "after-stone-count", athleteOrder: [ATHLETE_A, ATHLETE_B], stoneCount: 0 },
    })).toThrow("Stone-count rotation needs a positive integer interval.");
  });

  it("attributes an attempt to both the actual delivering athlete and active recorder", () => {
    const execution = addAttempt(createTeam(), 20, 0);
    const result = execution.athleteResults.find((candidate) => candidate.athleteProfileId === ATHLETE_A);

    expect(result?.attempts[0]).toMatchObject({
      athleteProfileId: ATHLETE_A,
      recordedByProfileId: RECORDER,
      sequenceNumber: 1,
      evaluation: { status: "scored", score: 0 },
    });
    expect(execution.athleteResults.find((candidate) => candidate.athleteProfileId === ATHLETE_B)?.attempts).toEqual([]);
    expect(validateExerciseExecution(execution, EXERCISE_CATALOG).valid).toBe(true);
  });

  it("records manual whole or half rotations and rejects any finer increment", () => {
    const guard = version(EIGHT_GUARDS_VERSION_ID);
    const rotationProtocol = resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      guard.compatibleMeasurementProtocols
    ).map(({ protocol }) => protocol).find((protocol) => protocol.metricType === "rotation-count");
    if (!rotationProtocol) throw new Error("Missing Rotation Count fixture");
    const execution = createTeam({ enabledMeasurementProtocols: [rotationProtocol] });
    const measurement = (value: number) => ({
      id: "80000000-0000-4000-8000-000000000008",
      protocolId: rotationProtocol.id,
      protocolVersion: rotationProtocol.version,
      value,
      source: "manual" as const,
      recordedAt: "2026-08-28T10:20:00.000Z",
      observerProfileId: RECORDER,
    });
    expect(addTeamShotmakingAttempt(execution, {
      recorderProfileId: RECORDER,
      athleteProfileId: ATHLETE_A,
      actualHandle: "in",
      evaluation: { status: "scored", score: 4 },
      measurements: [measurement(2.5)],
      clock: clock(20, 20),
    })).toMatchObject({ ok: true });
    expect(addTeamShotmakingAttempt(execution, {
      recorderProfileId: RECORDER,
      athleteProfileId: ATHLETE_A,
      actualHandle: "in",
      evaluation: { status: "scored", score: 4 },
      measurements: [measurement(2.25)],
      clock: clock(20, 20),
    })).toMatchObject({ ok: false, error: { code: "invalid-attempt" } });

    const persisted = structuredClone(execution);
    const accepted = addTeamShotmakingAttempt(persisted, {
      recorderProfileId: RECORDER,
      athleteProfileId: ATHLETE_A,
      actualHandle: "in",
      evaluation: { status: "scored", score: 4 },
      measurements: [measurement(2.5)],
      clock: clock(20, 20),
    });
    if (!accepted.ok) throw new Error(accepted.error.message);
    accepted.value.athleteResults[0].attempts[0].measurements[0].value = 2.25;
    expect(validateExerciseExecution(accepted.value, EXERCISE_CATALOG)).toMatchObject({ valid: false });
  });

  it("corrects any active stone with exact before/after audit, including athlete and role context", () => {
    const first = addAttempt(createTeam(), 20, 1);
    const rotated = changeTeamRoleAssignment(first, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "after-every-stone",
      clock: clock(30, 30),
    });
    if (!rotated.ok) throw new Error(rotated.error.message);
    const later = addAttempt(rotated.value, 40, 2);
    const original = later.athleteResults[0].attempts[0];
    if (original.kind !== "shotmaking") throw new Error("Missing Shotmaking fixture");
    const role = getTeamAttemptRoleContext(later, original);
    if (!role) throw new Error("Missing role fixture");

    const corrected = correctTeamShotmakingAttempt(later, {
      recorderProfileId: RECORDER,
      attemptId: original.id,
      athleteProfileId: ATHLETE_B,
      actualHandle: "out",
      evaluation: { status: "scored", score: 4 },
      measurements: [],
      roleContext: {
        ...role,
        deliveringAthleteProfileId: ATHLETE_B,
        sweeperProfileIds: [SWEEPER],
        sweepingUsed: true,
      },
      clock: clock(90, 50),
    });

    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.value.athleteResults.find((result) => result.athleteProfileId === ATHLETE_A)?.attempts).toEqual([]);
    expect(corrected.value.athleteResults.find((result) => result.athleteProfileId === ATHLETE_B)?.attempts).toHaveLength(2);
    expect(corrected.value.activeAttemptCorrections).toEqual([
      expect.objectContaining({
        kind: "updated",
        attemptId: original.id,
        correctedByProfileId: RECORDER,
        before: expect.objectContaining({ athleteProfileId: ATHLETE_A, actualHandle: "in", evaluation: { status: "scored", score: 1 } }),
        after: expect.objectContaining({
          athleteProfileId: ATHLETE_B,
          actualHandle: "out",
          evaluation: { status: "scored", score: 4 },
          teamRoleContextOverride: expect.objectContaining({
            deliveringAthleteProfileId: ATHLETE_B,
            sweeperProfileIds: [SWEEPER],
            sweepingUsed: true,
          }),
        }),
      }),
    ]);
    expect(validateExerciseExecution(corrected.value, EXERCISE_CATALOG).valid).toBe(true);
  });

  it("annuls a mistakenly recorded active stone without erasing its audited facts", () => {
    const attempted = addAttempt(createTeam(), 20, 3);
    const attempt = attempted.athleteResults[0].attempts[0];
    const annulled = annulTeamShotmakingAttempt(
      attempted,
      RECORDER,
      attempt.id,
      clock(90, 50)
    );

    expect(annulled.ok).toBe(true);
    if (!annulled.ok) return;
    expect(listTeamAttemptsInRecordingOrder(annulled.value)).toEqual([]);
    expect(annulled.value.activeAttemptCorrections).toEqual([
      expect.objectContaining({
        kind: "annulled",
        attemptId: attempt.id,
        correctedByProfileId: RECORDER,
        before: attempt,
      }),
    ]);
    expect(validateExerciseExecution(annulled.value, EXERCISE_CATALOG).valid).toBe(true);
    expect(completeTeamExerciseExecution(annulled.value, RECORDER)).toMatchObject({
      ok: false,
      error: { code: "not-completable" },
    });
  });

  it("refuses impersonated, terminal, no-op and non-monotonic active corrections", () => {
    const attempted = addAttempt(createTeam(), 20, 3);
    const attempt = attempted.athleteResults[0].attempts[0];
    if (attempt.kind !== "shotmaking") throw new Error("Missing Shotmaking fixture");
    const role = getTeamAttemptRoleContext(attempted, attempt);
    if (!role) throw new Error("Missing role fixture");
    const input = {
      attemptId: attempt.id,
      athleteProfileId: ATHLETE_A,
      actualHandle: attempt.actualHandle,
      evaluation: attempt.evaluation,
      measurements: attempt.measurements,
      roleContext: role,
    };
    expect(correctTeamShotmakingAttempt(attempted, {
      ...input,
      recorderProfileId: ATHLETE_A,
    })).toMatchObject({ ok: false, error: { code: "wrong-recorder" } });
    expect(correctTeamShotmakingAttempt(attempted, {
      ...input,
      recorderProfileId: RECORDER,
    })).toMatchObject({ ok: false, error: { code: "invalid-attempt" } });
    expect(correctTeamShotmakingAttempt(attempted, {
      ...input,
      actualHandle: "out",
      recorderProfileId: RECORDER,
      clock: { id: () => "90000000-0000-4000-8000-000000000001", now: () => "2020-01-01T00:00:00.000Z" },
    })).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    const completed = completeTeamExerciseExecution(attempted, RECORDER, "2026-08-28T12:00:00.000Z");
    if (!completed.ok) throw new Error(completed.error.message);
    expect(annulTeamShotmakingAttempt(completed.value, RECORDER, attempt.id)).toMatchObject({
      ok: false,
      error: { code: "execution-not-active" },
    });
  });

  it("rejects tampered active-correction chains and current values at the persisted boundary", () => {
    const attempted = addAttempt(createTeam(), 20, 3);
    const attempt = attempted.athleteResults[0].attempts[0];
    if (attempt.kind !== "shotmaking") throw new Error("Missing Shotmaking fixture");
    const role = getTeamAttemptRoleContext(attempted, attempt);
    if (!role) throw new Error("Missing role fixture");
    const corrected = correctTeamShotmakingAttempt(attempted, {
      recorderProfileId: RECORDER,
      attemptId: attempt.id,
      athleteProfileId: ATHLETE_A,
      actualHandle: "out",
      evaluation: { status: "scored", score: 4 },
      measurements: [],
      roleContext: role,
      clock: clock(90, 50),
    });
    if (!corrected.ok) throw new Error(corrected.error.message);

    const wrongCurrent = structuredClone(corrected.value);
    const current = wrongCurrent.athleteResults[0].attempts[0];
    if (current.kind === "shotmaking") current.actualHandle = "in";
    expect(validateExerciseExecution(wrongCurrent, EXERCISE_CATALOG).valid).toBe(false);

    const wrongActor = structuredClone(corrected.value);
    wrongActor.activeAttemptCorrections![0].correctedByProfileId = ATHLETE_A;
    expect(validateExerciseExecution(wrongActor, EXERCISE_CATALOG).valid).toBe(false);

    const rewrittenCapture = structuredClone(corrected.value);
    rewrittenCapture.activeAttemptCorrections![0].after!.createdAt = "2026-08-28T11:59:59.000Z";
    expect(validateExerciseExecution(rewrittenCapture, EXERCISE_CATALOG).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "activeAttemptCorrections[0].after",
          message: expect.stringContaining("cannot rewrite the original capture time"),
        }),
      ])
    );

  });

  it("rejects recorder impersonation and attribution to a non-delivering athlete", () => {
    const execution = createTeam();
    const wrongRecorder = addTeamShotmakingAttempt(execution, {
      recorderProfileId: ATHLETE_A,
      athleteProfileId: ATHLETE_A,
      actualHandle: "in",
      evaluation: { status: "scored", score: 4 },
    });
    const wrongAthlete = addTeamShotmakingAttempt(execution, {
      recorderProfileId: RECORDER,
      athleteProfileId: ATHLETE_B,
      actualHandle: "out",
      evaluation: { status: "scored", score: 4 },
    });

    expect(wrongRecorder).toMatchObject({ ok: false, error: { code: "wrong-recorder" } });
    expect(wrongAthlete).toMatchObject({ ok: false, error: { code: "wrong-athlete" } });
  });

  it("recommends after-every-stone rotation and records the actual new lineup", () => {
    const attempted = addAttempt(createTeam(), 20);
    expect(getTeamRotationRecommendation(attempted)).toEqual({
      reason: "after-every-stone",
      nextAthleteProfileId: ATHLETE_B,
    });

    const changed = changeTeamRoleAssignment(attempted, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "after-every-stone",
      clock: clock(30, 30),
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.roleAssignmentSegments.at(-1)).toMatchObject({
      deliveringAthleteProfileId: ATHLETE_B,
      transitionReason: "after-every-stone",
      recordedByProfileId: RECORDER,
    });
    expect(getTeamRotationRecommendation(changed.value)).toBeNull();
    expect(validateExerciseExecution(changed.value, EXERCISE_CATALOG).valid).toBe(true);
  });

  it("does not rotate a configured stone-count pattern before its interval", () => {
    const started = createTeam({
      rotation: { kind: "after-stone-count", athleteOrder: [ATHLETE_A, ATHLETE_B], stoneCount: 2 },
    });
    const once = addAttempt(started, 20);
    expect(getTeamRotationRecommendation(once)).toBeNull();
    const tooEarly = changeTeamRoleAssignment(once, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "after-stone-count",
      clock: clock(30, 30),
    });
    expect(tooEarly).toMatchObject({ ok: false, error: { code: "rotation-not-due" } });

    const twice = addAttempt(once, 40);
    expect(getTeamRotationRecommendation(twice)?.nextAthleteProfileId).toBe(ATHLETE_B);
  });

  it("allows a manual lineup change under every planned rotation", () => {
    const execution = createTeam({
      rotation: { kind: "fixed", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    });
    const outcome = changeTeamRoleAssignment(execution, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "manual",
      clock: clock(20, 20),
    });

    expect(outcome.ok).toBe(true);
  });

  it("advances after an explicitly signalled series but refuses the wrong athlete", () => {
    const execution = createTeam({
      rotation: { kind: "after-series", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    });
    const wrong = changeTeamRoleAssignment(execution, {
      recorderProfileId: RECORDER,
      assignment: { ...assignment(), sweeperProfileIds: [SWEEPER] },
      reason: "after-series",
      clock: clock(20, 20),
    });
    const right = changeTeamRoleAssignment(execution, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "after-series",
      clock: clock(30, 30),
    });

    expect(wrong).toMatchObject({ ok: false, error: { code: "invalid-role-assignment" } });
    expect(right.ok).toBe(true);
  });

  it("rejects a no-op role segment and non-monotonic transition time", () => {
    const execution = createTeam();
    const noOp = changeTeamRoleAssignment(execution, {
      recorderProfileId: RECORDER,
      assignment: { ...assignment(), coachProfileIds: [] },
      reason: "manual",
    });
    const oldClock = {
      id: () => "80000000-0000-4000-8000-000000000008",
      now: () => "2020-01-01T00:00:00.000Z",
    };
    const old = changeTeamRoleAssignment(execution, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "manual",
      clock: oldClock,
    });

    expect(noOp).toMatchObject({ ok: false, error: { code: "invalid-role-assignment" } });
    expect(old).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("cannot place a new role segment or terminal timestamp before recorded activity", () => {
    const attempted = addAttempt(createTeam(), 20);
    const transitionBeforeAttempt = changeTeamRoleAssignment(attempted, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "after-every-stone",
      clock: clock(50, 10),
    });
    const completionBeforeAttempt = completeTeamExerciseExecution(
      attempted,
      RECORDER,
      "2026-08-28T10:10:00.000Z"
    );

    expect(transitionBeforeAttempt).toMatchObject({ ok: false, error: { code: "invalid-input" } });
    expect(completionBeforeAttempt).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("completes Technique without attempts but requires Shotmaking activity", () => {
    const emptyShotmaking = completeTeamExerciseExecution(createTeam(), RECORDER);
    const technique = createTeam({}, RELEASE_POINT_VERSION_ID);
    const completedTechnique = completeTeamExerciseExecution(
      technique,
      RECORDER,
      "2026-08-28T11:00:00.000Z"
    );

    expect(emptyShotmaking).toMatchObject({ ok: false, error: { code: "not-completable" } });
    expect(completedTechnique).toMatchObject({ ok: true, value: { status: "completed" } });
  });

  it("requires the active recorder for completion and abandonment", () => {
    const execution = createTeam({}, RELEASE_POINT_VERSION_ID);
    expect(completeTeamExerciseExecution(execution, ATHLETE_A)).toMatchObject({
      ok: false,
      error: { code: "wrong-recorder" },
    });
    expect(abandonTeamExerciseExecution(execution, ATHLETE_A)).toMatchObject({
      ok: false,
      error: { code: "wrong-recorder" },
    });
    expect(abandonTeamExerciseExecution(execution, RECORDER, "2026-08-28T11:00:00.000Z")).toMatchObject({
      ok: true,
      value: { status: "abandoned" },
    });
  });

  it("never stores private Athlete Notes in the recorder's shared Team aggregate", () => {
    const outcome = updatePrivateAthleteNote(createTeam(), ATHLETE_A, "Private feedback");
    expect(outcome).toMatchObject({ ok: false, error: { code: "invalid-input" } });
  });

  it("returns all athlete attempts in stable rink chronology", () => {
    const first = addAttempt(createTeam(), 20);
    const rotated = changeTeamRoleAssignment(first, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "after-every-stone",
      clock: clock(30, 30),
    });
    if (!rotated.ok) throw new Error(rotated.error.message);
    const second = addAttempt(rotated.value, 40);

    expect(listTeamAttemptsInRecordingOrder(second).map((attempt) => attempt.athleteProfileId)).toEqual([
      ATHLETE_A,
      ATHLETE_B,
    ]);
  });

  it("collects independent persisted Team corruption instead of accepting partial truth", () => {
    const corrupted = structuredClone(addAttempt(createTeam(), 20)) as unknown as Record<string, unknown>;
    const context = corrupted.teamContext as Record<string, unknown>;
    const persistedRoster = context.participantRoster as Array<Record<string, unknown>>;
    persistedRoster[1].profileId = ATHLETE_A;
    context.recorderProfileId = "not-a-uuid";
    const segments = corrupted.roleAssignmentSegments as Array<Record<string, unknown>>;
    segments[0].sweeperProfileIds = ["not-on-roster"];
    const results = corrupted.athleteResults as Array<Record<string, unknown>>;
    results[0].privateNote = "must not be shared";
    const attempts = results[0].attempts as Array<Record<string, unknown>>;
    attempts[0].recordedByProfileId = ATHLETE_A;

    const validation = validateExerciseExecution(corrupted, EXERCISE_CATALOG);
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining([
      "teamContext.participantRoster[1].profileId",
      "teamContext.recorderProfileId",
      "roleAssignmentSegments[0].sweeperProfileIds",
      "athleteResults[0].privateNote",
      "athleteResults[0].attempts[0].recordedByProfileId",
    ]));
  });

  it("fails closed when persisted automatic rotation claims a transition before its stone", () => {
    const attempted = addAttempt(createTeam(), 20);
    const changed = changeTeamRoleAssignment(attempted, {
      recorderProfileId: RECORDER,
      assignment: assignment(ATHLETE_B),
      reason: "after-every-stone",
      clock: clock(30, 30),
    });
    if (!changed.ok) throw new Error(changed.error.message);
    const corrupted = structuredClone(changed.value);
    corrupted.athleteResults[0].attempts = [];

    const validation = validateExerciseExecution(corrupted, EXERCISE_CATALOG);
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.issues).toContainEqual(expect.objectContaining({
      path: "roleAssignmentSegments[1].transitionReason",
    }));
  });

  it("fails closed when persisted content removes a required deviation", () => {
    const execution = createTeam({
      initialRoleAssignment: {
        ...assignment(),
        sweeperProfileIds: [SWEEPER],
        sweepingUsed: true,
      },
    });
    const corrupted = structuredClone(execution);
    corrupted.configuration.deviations = [];

    const validation = validateExerciseExecution(corrupted, EXERCISE_CATALOG);
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.issues.filter((issue) => issue.path === "configuration.deviations")).toHaveLength(2);
  });

  it("keeps the Stage C1 aggregate outside Solo Session persistence and cloud upload", () => {
    const execution = createTeam();
    const session: Session = {
      id: SESSION_ID,
      title: "Team rink session",
      date: "2026-08-28T10:00:00.000Z",
      blocks: [],
      activeBlockId: "",
      shots: [],
    };

    expect(attachSoloExerciseExecution(session, execution)).toMatchObject({
      ok: false,
      error: { kind: "invalid-session-exercise-state" },
    });
    const illegallyEmbedded: Session = {
      ...session,
      exerciseExecutions: [{ ...execution, status: "abandoned", abandonedAt: "2026-08-28T11:00:00.000Z" }],
    };
    expect(serializeTrainingSession(illegallyEmbedded)).toBeNull();
  });
});
