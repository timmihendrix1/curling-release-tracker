import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import {
  addTeamShotmakingAttempt,
  annulTeamShotmakingAttempt,
  completeTeamExerciseExecution,
  correctTeamShotmakingAttempt,
  createTeamExerciseExecution,
  getTeamAttemptRoleContext,
} from "../../exercises/teamExecution";
import { sha256Hex } from "../records";
import {
  createTeamExerciseResultCorrectionMutation,
  createTeamExerciseResultVoidMutation,
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
const REVISION_1 = "80000000-0000-4000-8000-000000000001";
const REVISION_2 = "80000000-0000-4000-8000-000000000002";

function completedExecution(correction?: "move" | "annul") {
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
  let active = attempted.value;
  const attempt = active.athleteResults[0].attempts[0];
  if (correction === "move") {
    if (attempt.kind !== "shotmaking") throw new Error("Missing attempt fixture");
    const role = getTeamAttemptRoleContext(active, attempt);
    if (!role) throw new Error("Missing role fixture");
    const corrected = correctTeamShotmakingAttempt(active, {
      recorderProfileId: RECORDER,
      attemptId: attempt.id,
      athleteProfileId: ATHLETE_B,
      actualHandle: "out",
      evaluation: { status: "scored", score: 4 },
      measurements: [],
      roleContext: { ...role, deliveringAthleteProfileId: ATHLETE_B },
      clock,
    });
    if (!corrected.ok) throw new Error(corrected.error.message);
    active = corrected.value;
  } else if (correction === "annul") {
    const annulled = annulTeamShotmakingAttempt(active, RECORDER, attempt.id, clock);
    if (!annulled.ok) throw new Error(annulled.error.message);
    active = annulled.value;
    const replacement = addTeamShotmakingAttempt(active, {
      recorderProfileId: RECORDER,
      athleteProfileId: ATHLETE_A,
      actualHandle: "out",
      evaluation: { status: "scored", score: 2 },
      clock,
    });
    if (!replacement.ok) throw new Error(replacement.error.message);
    active = replacement.value;
  }
  const completed = completeTeamExerciseExecution(active, RECORDER, "2026-08-28T11:00:00.000Z");
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
    revisions: [],
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

  it("continues to restore immutable cloud payload schema 1 history", async () => {
    const current = await cloudRecord();
    const coordination = JSON.parse(current.session.coordinationPayload);
    coordination.schemaVersion = 1;
    coordination.execution.schemaVersion = 1;
    const result = JSON.parse(current.bundle.resultPayload);
    result.schemaVersion = 1;
    delete result.activeAttemptCorrections;
    const coordinationPayload = JSON.stringify(coordination);
    const resultPayload = JSON.stringify(result);
    const legacy: TeamExerciseCloudReadRecord = {
      ...current,
      session: {
        ...current.session,
        schemaVersion: 1,
        coordinationPayload,
        contentSha256: (await sha256Hex(coordinationPayload))!,
      },
      bundle: {
        ...current.bundle,
        schemaVersion: 1,
        resultPayload,
        contentSha256: (await sha256Hex(resultPayload))!,
      },
    };
    const parsed = await deserializeOwnedTeamExerciseResult(legacy, ATHLETE_A);
    expect(parsed?.result.attempts).toHaveLength(1);
    expect(parsed?.activeAttemptCorrections).toEqual([]);
  });

  it("validates and applies an exact post-completion correction chain and terminal void", async () => {
    const record = await cloudRecord();
    const originalPayload = JSON.parse(record.bundle.resultPayload);
    const correctedResult = structuredClone(originalPayload.result);
    correctedResult.attempts[0].actualHandle = "out";
    delete correctedResult.updatedAt;
    const correctionPayload = JSON.stringify({ schemaVersion: 1, result: correctedResult });
    record.revisions = [{
      revisionId: REVISION_1,
      resultId: record.bundle.resultIds[0],
      athleteProfileId: ATHLETE_A,
      revisionNumber: 1,
      kind: "corrected",
      schemaVersion: 1,
      resultPayload: correctionPayload,
      contentSha256: (await sha256Hex(correctionPayload))!,
      changedFields: ["actualHandle"],
      reason: "Corrected the handle observed on the stone",
      actorProfileId: ATHLETE_A,
      createdAt: "2026-08-28T13:00:00.000Z",
    }, {
      revisionId: REVISION_2,
      resultId: record.bundle.resultIds[0],
      athleteProfileId: ATHLETE_A,
      revisionNumber: 2,
      kind: "voided",
      schemaVersion: 1,
      resultPayload: null,
      contentSha256: null,
      changedFields: ["result"],
      reason: "This complete result must not count in analysis",
      actorProfileId: ATHLETE_A,
      createdAt: "2026-08-28T13:30:00.000Z",
    }];
    const parsed = await deserializeOwnedTeamExerciseResult(record, ATHLETE_A);
    expect(parsed).toMatchObject({
      isVoided: true,
      originalResult: { attempts: [{ actualHandle: "in" }] },
      result: { attempts: [{ actualHandle: "out" }] },
      postCompletionRevisions: [
        { revisionNumber: 1, kind: "corrected", changedFields: ["actualHandle"] },
        { revisionNumber: 2, kind: "voided", changedFields: ["result"] },
      ],
    });
    expect(parsed?.result.updatedAt).toBe("2026-08-28T13:00:00.000Z");
    expect(validateOwnedTeamExerciseResultRecord(parsed)).toEqual(parsed);
  });

  it("rejects revision gaps, foreign actors, hash drift and undeclared or immutable changes", async () => {
    const base = await cloudRecord();
    const originalPayload = JSON.parse(base.bundle.resultPayload);
    const correctedResult = structuredClone(originalPayload.result);
    correctedResult.attempts[0].actualHandle = "out";
    delete correctedResult.updatedAt;
    const payload = JSON.stringify({ schemaVersion: 1, result: correctedResult });
    const revision: TeamExerciseCloudReadRecord["revisions"][number] = {
      revisionId: REVISION_1,
      resultId: base.bundle.resultIds[0],
      athleteProfileId: ATHLETE_A,
      revisionNumber: 1,
      kind: "corrected" as const,
      schemaVersion: 1,
      resultPayload: payload,
      contentSha256: (await sha256Hex(payload))!,
      changedFields: ["actualHandle"],
      reason: "Corrected the handle observed on the stone",
      actorProfileId: ATHLETE_A,
      createdAt: "2026-08-28T13:00:00.000Z",
    };
    expect(await deserializeOwnedTeamExerciseResult({
      ...base, revisions: [{ ...revision, revisionNumber: 2 }],
    }, ATHLETE_A)).toBeNull();
    expect(await deserializeOwnedTeamExerciseResult({
      ...base, revisions: [{ ...revision, actorProfileId: ATHLETE_B }],
    }, ATHLETE_A)).toBeNull();
    expect(await deserializeOwnedTeamExerciseResult({
      ...base, revisions: [{ ...revision, contentSha256: "f".repeat(64) }],
    }, ATHLETE_A)).toBeNull();
    expect(await deserializeOwnedTeamExerciseResult({
      ...base, revisions: [{ ...revision, changedFields: ["evaluation"] }],
    }, ATHLETE_A)).toBeNull();

    const clientTimed = structuredClone(correctedResult);
    clientTimed.updatedAt = "2099-01-01T00:00:00.000Z";
    const clientTimedPayload = JSON.stringify({ schemaVersion: 1, result: clientTimed });
    expect(await deserializeOwnedTeamExerciseResult({
      ...base,
      revisions: [{
        ...revision,
        resultPayload: clientTimedPayload,
        contentSha256: (await sha256Hex(clientTimedPayload))!,
      }],
    }, ATHLETE_A)).toBeNull();

    const reassigned = structuredClone(correctedResult);
    reassigned.athleteProfileId = ATHLETE_B;
    const reassignedPayload = JSON.stringify({ schemaVersion: 1, result: reassigned });
    expect(await deserializeOwnedTeamExerciseResult({
      ...base,
      revisions: [{
        ...revision,
        resultPayload: reassignedPayload,
        contentSha256: (await sha256Hex(reassignedPayload))!,
      }],
    }, ATHLETE_A)).toBeNull();
  });

  it("builds only the bounded provider-neutral correction and void mutation shapes", async () => {
    const parsed = (await deserializeOwnedTeamExerciseResult(await cloudRecord(), ATHLETE_A))!;
    const replacement = structuredClone(parsed.result);
    const attempt = replacement.attempts[0];
    if (attempt.kind !== "shotmaking") throw new Error("Missing shotmaking fixture");
    attempt.evaluation = { status: "scored", score: 1 };
    const mutation = createTeamExerciseResultCorrectionMutation(
      parsed,
      replacement,
      REVISION_1,
      "  Corrected the observed scoring outcome  "
    );
    expect(mutation).toMatchObject({
      revisionId: REVISION_1,
      resultId: parsed.result.id,
      baseRevisionNumber: 0,
      schemaVersion: 1,
      reason: "Corrected the observed scoring outcome",
      changedFields: ["evaluation"],
    });
    const payload = JSON.parse(mutation!.resultPayload);
    expect(payload).toEqual(expect.objectContaining({ schemaVersion: 1 }));
    expect(payload.result.updatedAt).toBeUndefined();
    expect(payload.result.privateNote).toBeUndefined();
    expect(payload.result.attempts[0].recordedByProfileId).toBeUndefined();

    const reassigned = structuredClone(replacement);
    reassigned.athleteProfileId = ATHLETE_B;
    expect(createTeamExerciseResultCorrectionMutation(
      parsed, reassigned, REVISION_1, "Athlete attribution must never be rewritten"
    )).toBeNull();
    expect(createTeamExerciseResultVoidMutation(
      parsed, REVISION_2, "  This complete result should not count  "
    )).toEqual({
      revisionId: REVISION_2,
      resultId: parsed.result.id,
      baseRevisionNumber: 0,
      reason: "This complete result should not count",
    });
    expect(createTeamExerciseResultVoidMutation(parsed, REVISION_2, "too short")).toBeNull();
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
    expect(exported.schemaVersion).toBe(3);
    expect(exported.athleteResult.athleteProfileId).toBe(ATHLETE_A);
    expect(exported.originalAthleteResult).toEqual(exported.athleteResult);
    expect(exported.postCompletionRevisions).toEqual([]);
    expect(exported.isVoided).toBe(false);
    expect(exported.privateAthleteNote.note).toBe("My own observation");
    expect(exported.session.execution.athleteResults).toBeUndefined();
  });

  it("splits active corrections into every affected athlete bundle without trusting recorder claims", async () => {
    const execution = completedExecution("move");
    const upload = serializeCompletedTeamExercise(execution)!;
    const athleteABundle = upload.bundles.find((bundle) => bundle.athleteProfileId === ATHLETE_A)!;
    const athleteBBundle = upload.bundles.find((bundle) => bundle.athleteProfileId === ATHLETE_B)!;
    const payloadA = JSON.parse(athleteABundle.resultPayload);
    const payloadB = JSON.parse(athleteBBundle.resultPayload);
    expect(payloadA.activeAttemptCorrections).toHaveLength(1);
    expect(payloadB.activeAttemptCorrections).toHaveLength(1);
    expect(payloadA.activeAttemptCorrections[0].correctedByProfileId).toBeUndefined();
    expect(payloadA.activeAttemptCorrections[0].before.recordedByProfileId).toBeUndefined();
    expect(JSON.parse(upload.session.coordinationPayload).execution.activeAttemptCorrections).toBeUndefined();

    const record = await cloudRecord(ATHLETE_B);
    const correctedUpload = upload.bundles.find((bundle) => bundle.athleteProfileId === ATHLETE_B)!;
    const correctedRecord: TeamExerciseCloudReadRecord = {
      session: {
        ...upload.session,
        recordedByProfileId: RECORDER,
        contentSha256: (await sha256Hex(upload.session.coordinationPayload))!,
        createdAt: record.session.createdAt,
      },
      bundle: {
        ...correctedUpload,
        recordedByProfileId: RECORDER,
        contentSha256: (await sha256Hex(correctedUpload.resultPayload))!,
        createdAt: record.bundle.createdAt,
      },
      privateNote: null,
      revisions: [],
    };
    const parsed = await deserializeOwnedTeamExerciseResult(correctedRecord, ATHLETE_B);
    expect(parsed?.activeAttemptCorrections).toHaveLength(1);
    expect(parsed?.activeAttemptCorrections[0].correctedByProfileId).toBe(RECORDER);
    expect(parsed?.activeAttemptCorrections[0].before.recordedByProfileId).toBe(RECORDER);
    expect(parsed?.result.attempts[0].athleteProfileId).toBe(ATHLETE_B);

    const rewrittenAudit = JSON.parse(correctedUpload.resultPayload);
    rewrittenAudit.activeAttemptCorrections[0].after.createdAt = "2026-08-28T09:59:59.000Z";
    const rewrittenPayload = JSON.stringify(rewrittenAudit);
    expect(await deserializeOwnedTeamExerciseResult({
      ...correctedRecord,
      bundle: {
        ...correctedRecord.bundle,
        resultPayload: rewrittenPayload,
        contentSha256: (await sha256Hex(rewrittenPayload))!,
      },
    }, ATHLETE_B)).toBeNull();
  });

  it("retains an annulled attempt only in the affected athlete's audit and raw export", async () => {
    const execution = completedExecution("annul");
    const upload = serializeCompletedTeamExercise(execution)!;
    const bundle = upload.bundles.find((candidate) => candidate.athleteProfileId === ATHLETE_A)!;
    const record: TeamExerciseCloudReadRecord = {
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
      privateNote: null,
      revisions: [],
    };
    const parsed = await deserializeOwnedTeamExerciseResult(record, ATHLETE_A);
    expect(parsed?.result.attempts).toHaveLength(1);
    expect(parsed?.activeAttemptCorrections[0]).toMatchObject({ kind: "annulled" });
    const exported = JSON.parse(serializeOwnedTeamExerciseResultExport(parsed!));
    expect(exported.activeAttemptCorrections[0].before.evaluation.score).toBe(3);
  });
});
