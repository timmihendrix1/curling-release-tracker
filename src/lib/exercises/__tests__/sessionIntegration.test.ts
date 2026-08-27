import { describe, expect, it } from "vitest";
import type { Session } from "../../../types";
import {
  attachSoloExerciseExecution,
  isSessionExerciseCloudEligible,
  prepareSessionForArchive,
  replaceExerciseExecution,
  sessionHasArchivableActivity,
  validateSessionExerciseState,
} from "../sessionIntegration";
import { completeExerciseExecution, updatePrivateAthleteNote } from "../execution";
import {
  createCompletedTechniqueExecution,
  createMeasuredExecution,
  createTechniqueExecution,
  FIXTURE_SESSION_ID,
} from "./executionFixtures";

function session(): Session {
  return {
    id: FIXTURE_SESSION_ID,
    title: "Training Session",
    date: "2026-08-27T10:00:00.000Z",
    notes: "Keep existing state",
    blocks: [],
    activeBlockId: "",
    shots: [],
  };
}

function expectOk(result: ReturnType<typeof attachSoloExerciseExecution>): Session {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

describe("Exercise Execution integration with Training Session", () => {
  it("keeps legacy and Release-Time-only Sessions valid without manufacturing Exercise state", () => {
    expect(validateSessionExerciseState(session(), FIXTURE_SESSION_ID)).toEqual({
      valid: true,
      executions: [],
      issues: [],
    });
    expect(session()).not.toHaveProperty("exerciseExecutions");
  });

  it("attaches one active Solo execution without changing existing Session data", () => {
    const source = session();
    const result = attachSoloExerciseExecution(source, createTechniqueExecution());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      title: source.title,
      notes: source.notes,
      blocks: source.blocks,
      shots: source.shots,
    });
    expect(result.value.exerciseExecutions).toHaveLength(1);
    expect(result.value.activeExerciseExecutionId).toBe(
      result.value.exerciseExecutions?.[0].id
    );
    expect(source).not.toHaveProperty("exerciseExecutions");
  });

  it("rejects a second active execution, a duplicate and a cross-Session execution", () => {
    const active = expectOk(
      attachSoloExerciseExecution(session(), createTechniqueExecution())
    );
    expect(
      attachSoloExerciseExecution(active, createTechniqueExecution(FIXTURE_SESSION_ID, 20))
    ).toMatchObject({ ok: false });
    expect(
      attachSoloExerciseExecution(active, active.exerciseExecutions![0])
    ).toMatchObject({ ok: false });
    expect(
      attachSoloExerciseExecution(
        session(),
        createTechniqueExecution("10000000-0000-4000-8000-000000000099", 30)
      )
    ).toMatchObject({ ok: false });
  });

  it("keeps Measured Release Time on the existing Block and Shot execution path", () => {
    const measured = createMeasuredExecution();
    expect(attachSoloExerciseExecution(session(), measured)).toMatchObject({ ok: false });
    const validation = validateSessionExerciseState(
      {
        ...session(),
        exerciseExecutions: [measured],
        activeExerciseExecutionId: measured.id,
      },
      FIXTURE_SESSION_ID
    );
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Release Timing") }),
      ])
    );
  });

  it("accepts only an exact catalog Measured snapshot as Release Timing provenance", () => {
    const measuredSnapshot = createMeasuredExecution().exerciseVersionSnapshot;
    const withProvenance = {
      ...session(),
      releaseTimingExerciseVersionSnapshot: measuredSnapshot,
    };
    expect(validateSessionExerciseState(withProvenance, FIXTURE_SESSION_ID)).toEqual({
      valid: true,
      executions: [],
      issues: [],
    });
    expect(isSessionExerciseCloudEligible(withProvenance)).toBe(true);

    const rewritten = {
      ...withProvenance,
      releaseTimingExerciseVersionSnapshot: {
        ...measuredSnapshot,
        goal: "Rewritten provenance",
      },
    };
    expect(validateSessionExerciseState(rewritten, FIXTURE_SESSION_ID).valid).toBe(false);

    const techniqueSnapshot = createTechniqueExecution().exerciseVersionSnapshot;
    expect(
      validateSessionExerciseState(
        { ...session(), releaseTimingExerciseVersionSnapshot: techniqueSnapshot },
        FIXTURE_SESSION_ID
      ).valid
    ).toBe(false);
  });

  it("replaces only the active execution and clears the active pointer on completion", () => {
    const active = expectOk(
      attachSoloExerciseExecution(session(), createTechniqueExecution())
    );
    const completed = completeExerciseExecution(
      active.exerciseExecutions![0],
      "2026-08-27T10:15:00.000Z"
    );
    if (!completed.ok) throw new Error(completed.error.message);
    const replaced = replaceExerciseExecution(active, completed.value);
    expect(replaced.ok).toBe(true);
    if (!replaced.ok) return;
    expect(replaced.value.activeExerciseExecutionId).toBeUndefined();
    expect(replaced.value.exerciseExecutions?.[0].status).toBe("completed");
    expect(isSessionExerciseCloudEligible(replaced.value)).toBe(true);
  });

  it("rejects a valid-looking rollback or snapshot rewrite of active work", () => {
    const active = expectOk(
      attachSoloExerciseExecution(session(), createTechniqueExecution())
    );
    const current = active.exerciseExecutions![0];
    const noteUpdate = updatePrivateAthleteNote(
      current,
      current.athleteResults[0].athleteProfileId,
      "Current note",
      "2026-08-27T10:05:00.000Z"
    );
    if (!noteUpdate.ok) throw new Error(noteUpdate.error.message);
    const updated = replaceExerciseExecution(active, noteUpdate.value);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(replaceExerciseExecution(updated.value, current)).toMatchObject({ ok: false });
  });

  it("treats a no-shot Technique execution as archivable activity", () => {
    const completed: Session = {
      ...session(),
      exerciseExecutions: [createCompletedTechniqueExecution()],
    };
    expect(completed.shots).toHaveLength(0);
    expect(sessionHasArchivableActivity(completed)).toBe(true);
  });

  it("allows a private-note-only update after completion but rejects terminal history rewrites", () => {
    const completedExecution = createCompletedTechniqueExecution();
    const completed: Session = {
      ...session(),
      exerciseExecutions: [completedExecution],
    };
    const noteUpdate = updatePrivateAthleteNote(
      completedExecution,
      completedExecution.athleteResults[0].athleteProfileId,
      "Post-training reflection",
      "2026-08-27T10:30:00.000Z"
    );
    if (!noteUpdate.ok) throw new Error(noteUpdate.error.message);
    const replaced = replaceExerciseExecution(completed, noteUpdate.value);
    expect(replaced.ok).toBe(true);

    const rewritten = {
      ...noteUpdate.value,
      exerciseVersionSnapshot: {
        ...noteUpdate.value.exerciseVersionSnapshot,
        goal: "Rewritten historical goal",
      },
    };
    expect(replaceExerciseExecution(completed, rewritten)).toMatchObject({ ok: false });
  });

  it("abandons an interrupted execution before archive and makes it cloud eligible", () => {
    const active = expectOk(
      attachSoloExerciseExecution(session(), createTechniqueExecution())
    );
    expect(isSessionExerciseCloudEligible(active)).toBe(false);
    const prepared = prepareSessionForArchive(
      active,
      "2026-08-27T10:20:00.000Z"
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.value.activeExerciseExecutionId).toBeUndefined();
    expect(prepared.value.exerciseExecutions?.[0]).toMatchObject({
      status: "abandoned",
      abandonedAt: "2026-08-27T10:20:00.000Z",
    });
    expect(isSessionExerciseCloudEligible(prepared.value)).toBe(true);
  });

  it("reports mismatched ownership, duplicate ids and stale active pointers together", () => {
    const first = createTechniqueExecution();
    const corrupted = {
      ...session(),
      exerciseExecutions: [
        first,
        { ...first, trainingSessionId: "10000000-0000-4000-8000-000000000099" },
      ],
      activeExerciseExecutionId: "40000000-0000-4000-8000-999999999999",
    };
    const validation = validateSessionExerciseState(corrupted, FIXTURE_SESSION_ID);
    expect(validation.valid).toBe(false);
    if (validation.valid) return;
    expect(validation.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("belong"),
        expect.stringContaining("unique"),
        expect.stringContaining("at most one"),
      ])
    );
  });
});
