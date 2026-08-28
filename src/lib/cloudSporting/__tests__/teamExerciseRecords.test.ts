import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import {
  addTeamShotmakingAttempt,
  completeTeamExerciseExecution,
  createTeamExerciseExecution,
} from "../../exercises/teamExecution";
import { serializeCompletedTeamExercise } from "../teamExerciseRecords";

const SESSION = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000002";
const ATHLETE_A = "30000000-0000-4000-8000-000000000003";
const ATHLETE_B = "40000000-0000-4000-8000-000000000004";
const RECORDER = "50000000-0000-4000-8000-000000000005";

function clock() {
  let id = 10;
  let minute = 0;
  return {
    id: () => `70000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 28, 10, minute++)).toISOString(),
  };
}

function completedTeamExecution() {
  const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID)!;
  const executionClock = clock();
  const execution = createTeamExerciseExecution(version, {
    trainingSessionId: SESSION,
    teamId: TEAM,
    recorderProfileId: RECORDER,
    participantRoster: [
      { profileId: ATHLETE_A, participation: "training-athlete" },
      { profileId: ATHLETE_B, participation: "training-athlete" },
      { profileId: RECORDER, participation: "supporting" },
    ],
    initialRoleAssignment: {
      deliveringAthleteProfileId: ATHLETE_A,
      sweeperProfileIds: [],
      observerProfileId: RECORDER,
      sweepingUsed: false,
    },
    rotation: { kind: "manual", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    clock: executionClock,
  });
  if (!execution.ok) throw new Error(execution.error.message);
  const attempted = addTeamShotmakingAttempt(execution.value, {
    recorderProfileId: RECORDER,
    athleteProfileId: ATHLETE_A,
    actualHandle: "in",
    evaluation: { status: "scored", score: 3 },
    clock: executionClock,
  });
  if (!attempted.ok) throw new Error(attempted.error.message);
  const completed = completeTeamExerciseExecution(attempted.value, RECORDER, "2026-08-28T11:00:00.000Z");
  if (!completed.ok) throw new Error(completed.error.message);
  return completed.value;
}

describe("Team Exercise cloud serialization", () => {
  it("splits coordination from independently owned athlete results with stable IDs", () => {
    const execution = completedTeamExecution();
    const upload = serializeCompletedTeamExercise(execution);
    expect(upload).not.toBeNull();
    expect(upload?.session).toMatchObject({
      sessionId: SESSION,
      teamId: TEAM,
      participantProfileIds: [ATHLETE_A, ATHLETE_B, RECORDER],
      trainingAthleteProfileIds: [ATHLETE_A, ATHLETE_B],
      executionIds: [execution.id],
    });
    expect(upload?.bundles.map((bundle) => bundle.bundleId)).toEqual(
      execution.athleteResults.map((result) => result.id)
    );
    expect(upload?.bundles.map((bundle) => bundle.athleteProfileId)).toEqual([ATHLETE_A, ATHLETE_B]);
    expect(upload?.bundles.every((bundle) => bundle.resultIds.length === 1)).toBe(true);
  });

  it("never serializes recorder claims or private notes into shared/bundle payloads", () => {
    const upload = serializeCompletedTeamExercise(completedTeamExecution())!;
    const wire = JSON.stringify(upload);
    expect(wire).not.toContain("recorderProfileId");
    expect(wire).not.toContain("recordedByProfileId");
    expect(wire).not.toContain("privateNote");
    expect(JSON.parse(upload.session.coordinationPayload).execution.athleteResults).toBeUndefined();
    for (const bundle of upload.bundles) {
      const payload = JSON.parse(bundle.resultPayload);
      expect(payload.result.athleteProfileId).toBe(bundle.athleteProfileId);
    }
  });

  it("rejects non-terminal, Solo, corrupted and non-distinct bundle identities", () => {
    const completed = completedTeamExecution();
    expect(serializeCompletedTeamExercise({ ...completed, status: "in-progress", completedAt: undefined })).toBeNull();
    expect(serializeCompletedTeamExercise({ ...completed, teamContext: undefined })).toBeNull();
    expect(serializeCompletedTeamExercise({ ...completed, athleteResults: completed.athleteResults.map((result) => ({ ...result, privateNote: "secret" })) })).toBeNull();
    expect(serializeCompletedTeamExercise(completed, () => SESSION)).toBeNull();
  });
});
