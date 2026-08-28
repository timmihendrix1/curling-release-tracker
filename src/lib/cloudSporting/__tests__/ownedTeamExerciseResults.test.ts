import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import {
  addTeamShotmakingAttempt,
  completeTeamExerciseExecution,
  createTeamExerciseExecution,
} from "../../exercises/teamExecution";
import { sha256Hex } from "../records";
import {
  deserializeOwnedTeamExerciseResult,
  serializeCompletedTeamExercise,
  validateOwnedTeamExerciseResultRecord,
} from "../teamExerciseRecords";
import type { TeamExerciseCloudReadRecord } from "../teamExerciseTypes";
import { serializeOwnedTeamExerciseResultExport } from "../../exercises/teamResultExport";

const SESSION = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000002";
const ATHLETE_A = "30000000-0000-4000-8000-000000000003";
const ATHLETE_B = "40000000-0000-4000-8000-000000000004";
const RECORDER = "50000000-0000-4000-8000-000000000005";

function completedExecution() {
  let id = 10;
  let minute = 0;
  const clock = {
    id: () => `70000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 28, 10, minute++)).toISOString(),
  };
  const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID)!;
  const created = createTeamExerciseExecution(version, {
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
    rotation: { kind: "after-every-stone", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    clock,
  });
  if (!created.ok) throw new Error(created.error.message);
  const attempted = addTeamShotmakingAttempt(created.value, {
    recorderProfileId: RECORDER,
    athleteProfileId: ATHLETE_A,
    actualHandle: "in",
    evaluation: { status: "scored", score: 3 },
    clock,
  });
  if (!attempted.ok) throw new Error(attempted.error.message);
  const completed = completeTeamExerciseExecution(attempted.value, RECORDER, "2026-08-28T11:00:00.000Z");
  if (!completed.ok) throw new Error(completed.error.message);
  return completed.value;
}

async function cloudRecord(athleteProfileId = ATHLETE_A): Promise<TeamExerciseCloudReadRecord> {
  const execution = completedExecution();
  const upload = serializeCompletedTeamExercise(execution)!;
  const bundle = upload.bundles.find((candidate) => candidate.athleteProfileId === athleteProfileId)!;
  return {
    session: {
      ...upload.session,
      recordedByProfileId: RECORDER,
      contentSha256: (await sha256Hex(upload.session.coordinationPayload))!,
      createdAt: "2026-08-28T11:01:00.000Z",
    },
    bundle: {
      ...bundle,
      recordedByProfileId: RECORDER,
      contentSha256: (await sha256Hex(bundle.resultPayload))!,
      createdAt: "2026-08-28T11:01:01.000Z",
    },
    privateNote: {
      resultId: bundle.resultIds[0],
      note: "My own observation",
      updatedAt: "2026-08-28T12:00:00.000Z",
    },
  };
}

describe("athlete-owned Team Exercise read model", () => {
  it("reconstructs only the authenticated athlete result and server recorder provenance", async () => {
    const parsed = await deserializeOwnedTeamExerciseResult(await cloudRecord(), ATHLETE_A);
    expect(parsed).not.toBeNull();
    expect(parsed?.athleteProfileId).toBe(ATHLETE_A);
    expect(parsed?.result.attempts).toHaveLength(1);
    expect(parsed?.result.attempts[0].recordedByProfileId).toBe(RECORDER);
    expect(parsed?.sharedExecution.teamContext?.recorderProfileId).toBe(RECORDER);
    expect(parsed?.privateNote?.note).toBe("My own observation");
    expect("athleteResults" in parsed!.sharedExecution).toBe(false);
    expect(validateOwnedTeamExerciseResultRecord(parsed)).toEqual(parsed);
  });

  it("accepts an owned zero-attempt projection when another athlete made the Team attempt", async () => {
    const parsed = await deserializeOwnedTeamExerciseResult(await cloudRecord(ATHLETE_B), ATHLETE_B);
    expect(parsed?.result.attempts).toEqual([]);
  });

  it("rejects a foreign owner, mismatched manifests, hash changes and payload note leakage", async () => {
    const original = await cloudRecord();
    expect(await deserializeOwnedTeamExerciseResult(original, ATHLETE_B)).toBeNull();
    expect(await deserializeOwnedTeamExerciseResult({
      ...original,
      bundle: { ...original.bundle, executionIds: [SESSION] },
    }, ATHLETE_A)).toBeNull();
    expect(await deserializeOwnedTeamExerciseResult({
      ...original,
      bundle: { ...original.bundle, resultPayload: `${original.bundle.resultPayload} ` },
    }, ATHLETE_A)).toBeNull();
    const payload = JSON.parse(original.bundle.resultPayload);
    payload.result.privateNote = "leak";
    const resultPayload = JSON.stringify(payload);
    expect(await deserializeOwnedTeamExerciseResult({
      ...original,
      bundle: {
        ...original.bundle,
        resultPayload,
        contentSha256: (await sha256Hex(resultPayload))!,
      },
    }, ATHLETE_A)).toBeNull();
  });

  it("rejects unknown nested opaque fields instead of carrying them into cache or export", async () => {
    const original = await cloudRecord();
    const coordination = JSON.parse(original.session.coordinationPayload);
    coordination.execution.configuration.siblingSummary = { score: 4 };
    const coordinationPayload = JSON.stringify(coordination);
    expect(await deserializeOwnedTeamExerciseResult({
      ...original,
      session: {
        ...original.session,
        coordinationPayload,
        contentSha256: (await sha256Hex(coordinationPayload))!,
      },
    }, ATHLETE_A)).toBeNull();

    const result = JSON.parse(original.bundle.resultPayload);
    result.result.attempts[0].siblingNote = "must not cross the boundary";
    const resultPayload = JSON.stringify(result);
    expect(await deserializeOwnedTeamExerciseResult({
      ...original,
      bundle: {
        ...original.bundle,
        resultPayload,
        contentSha256: (await sha256Hex(resultPayload))!,
      },
    }, ATHLETE_A)).toBeNull();
  });

  it("fails the persisted cache closed on embedded sibling results or malformed private notes", async () => {
    const parsed = (await deserializeOwnedTeamExerciseResult(await cloudRecord(), ATHLETE_A))!;
    expect(validateOwnedTeamExerciseResultRecord({
      ...parsed,
      sharedExecution: { ...parsed.sharedExecution, athleteResults: [{ id: ATHLETE_B }] },
    })).toBeNull();
    expect(validateOwnedTeamExerciseResultRecord({
      ...parsed,
      privateNote: { note: "   ", updatedAt: "2026-08-28T12:00:00Z" },
    })).toBeNull();
    expect(validateOwnedTeamExerciseResultRecord({
      ...parsed,
      result: { ...parsed.result, siblingResult: { score: 4 } },
    })).toBeNull();
  });

  it("exports the athlete's raw result and own note without a sibling result collection", async () => {
    const parsed = (await deserializeOwnedTeamExerciseResult(await cloudRecord(), ATHLETE_A))!;
    const exported = JSON.parse(serializeOwnedTeamExerciseResultExport(parsed));
    expect(exported.athleteResult.athleteProfileId).toBe(ATHLETE_A);
    expect(exported.privateAthleteNote.note).toBe("My own observation");
    expect(exported.session.execution.athleteResults).toBeUndefined();
  });
});
