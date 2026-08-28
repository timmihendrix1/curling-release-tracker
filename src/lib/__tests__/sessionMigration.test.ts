import { describe, expect, it } from "vitest";
import { migrateSession } from "../sessionMigration";
import { STANDARD_ACCURACY_THRESHOLDS } from "../accuracyThresholds";
import { DEFAULT_SMART_RANDOM_MAX, DEFAULT_SMART_RANDOM_MIN } from "../variableTargets";
import {
  createCompletedTechniqueExecution,
  createMeasuredExecution,
  createRotationCountExecution,
  createTechniqueExecution,
  FIXTURE_SESSION_ID,
} from "../exercises/__tests__/executionFixtures";

describe("migrateSession — Release Timing Exercise provenance", () => {
  it("preserves an exact Measured catalog snapshot and remains idempotent", () => {
    const snapshot = createMeasuredExecution().exerciseVersionSnapshot;
    const raw = {
      id: FIXTURE_SESSION_ID,
      title: "Measured Exercise Session",
      date: "2026-08-27T10:00:00.000Z",
      notes: "",
      blocks: [],
      activeBlockId: "",
      shots: [],
      releaseTimingExerciseVersionSnapshot: snapshot,
    };

    const once = migrateSession(raw);
    expect(once.releaseTimingExerciseVersionSnapshot).toEqual(snapshot);
    expect(once.releaseTimingExerciseVersionSnapshot).not.toBe(snapshot);
    expect(migrateSession(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it("does not carry a rewritten or non-Measured provenance snapshot", () => {
    const measured = createMeasuredExecution().exerciseVersionSnapshot;
    const base = {
      id: FIXTURE_SESSION_ID,
      blocks: [],
      activeBlockId: "",
      shots: [],
    };
    expect(
      migrateSession({
        ...base,
        releaseTimingExerciseVersionSnapshot: { ...measured, title: "Changed" },
      }).releaseTimingExerciseVersionSnapshot
    ).toBeUndefined();
    expect(
      migrateSession({
        ...base,
        releaseTimingExerciseVersionSnapshot:
          createTechniqueExecution().exerciseVersionSnapshot,
      }).releaseTimingExerciseVersionSnapshot
    ).toBeUndefined();
  });
});

describe("migrateSession — legacy pre-block sessions", () => {
  it("migrates a very old session (no blocks key at all) into a single Legacy Block", () => {
    const legacy = {
      id: "s1",
      title: "Old Session",
      date: "2024-01-01T00:00:00.000Z",
      targetTime: 3.8,
      notes: "",
      shots: [
        {
          id: "shot-1",
          sessionId: "s1",
          shotNumber: 1,
          releaseTime: 3.79,
          handle: "in",
          shotType: "guard",
          createdAt: "2024-01-01T00:00:01.000Z",
        },
      ],
    };

    const migrated = migrateSession(legacy);

    expect(migrated.blocks).toHaveLength(1);
    expect(migrated.blocks[0].name).toBe("Legacy Block");
    expect(migrated.blocks[0].targetTime).toBe(3.8);
    expect(migrated.activeBlockId).toBe(migrated.blocks[0].id);

    // shot without targetTime falls back to its block's target
    expect(migrated.shots[0].targetTime).toBe(3.8);
    // "guard" is no longer a valid ShotType and must fold into "draw"
    expect(migrated.shots[0].shotType).toBe("draw");
    expect(migrated.shots[0].predictedTime).toBeUndefined();
  });

  it("does NOT fabricate a Legacy Block for a session that legitimately has zero blocks yet", () => {
    // This is the exact shape a freshly created, not-yet-configured session
    // has before the user picks their first training block.
    const freshSession = {
      id: "s2",
      title: "Training Session",
      date: "2026-01-01T00:00:00.000Z",
      notes: "",
      blocks: [],
      activeBlockId: "",
      shots: [],
    };

    const migrated = migrateSession(freshSession);

    expect(migrated.blocks).toEqual([]);
    expect(migrated.activeBlockId).toBe("");
  });
});

describe("migrateSession — Exercise Executions", () => {
  it("preserves valid embedded Exercise state exactly and idempotently", () => {
    const execution = createTechniqueExecution();
    const raw = {
      id: FIXTURE_SESSION_ID,
      title: "Exercise Session",
      date: "2026-08-27T10:00:00.000Z",
      notes: "Private session",
      blocks: [],
      activeBlockId: "",
      shots: [],
      exerciseExecutions: [execution],
      activeExerciseExecutionId: execution.id,
    };
    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(once.exerciseExecutions).toEqual([execution]);
    expect(once.activeExerciseExecutionId).toBe(execution.id);
    expect(twice).toEqual(once);
  });

  it("preserves a terminal no-shot Technique execution without an active pointer", () => {
    const execution = createCompletedTechniqueExecution();
    const migrated = migrateSession({
      id: FIXTURE_SESSION_ID,
      blocks: [],
      activeBlockId: "",
      shots: [],
      exerciseExecutions: [execution],
    });
    expect(migrated.exerciseExecutions).toEqual([execution]);
    expect(migrated.activeExerciseExecutionId).toBeUndefined();
  });

  it("does not repair or partially preserve invalid Exercise state", () => {
    const execution = createTechniqueExecution();
    const migrated = migrateSession({
      id: FIXTURE_SESSION_ID,
      blocks: [],
      activeBlockId: "",
      shots: [],
      exerciseExecutions: [execution],
      activeExerciseExecutionId: "40000000-0000-4000-8000-999999999999",
    });
    expect(migrated.exerciseExecutions).toBeUndefined();
    expect(migrated.activeExerciseExecutionId).toBeUndefined();
  });
});

describe("migrateSession — shot targetTime backfill", () => {
  it("gives an old shot without targetTime its block's target", () => {
    const raw = {
      id: "s3",
      title: "Session",
      date: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          id: "block-1",
          name: "Block A",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.9,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      activeBlockId: "block-1",
      shots: [
        {
          id: "shot-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.85,
          handle: "in",
          shotType: "draw",
          createdAt: "2024-01-01T00:00:01.000Z",
        },
      ],
    };

    const migrated = migrateSession(raw);
    expect(migrated.shots[0].targetTime).toBe(3.9);
  });

  it("falls back to a defined constant when the block target is also missing", () => {
    const raw = {
      id: "s4",
      blocks: [{ id: "block-1", mode: "fixed" }],
      activeBlockId: "block-1",
      shots: [{ id: "shot-1", blockId: "block-1", releaseTime: 3.7 }],
    };

    const migrated = migrateSession(raw);
    expect(typeof migrated.shots[0].targetTime).toBe("number");
    expect(migrated.shots[0].targetTime).toBeGreaterThan(0);
  });
});

describe("migrateSession — variableTargetMode backfill", () => {
  it("defaults an old variable block without variableTargetMode to 'manual'", () => {
    const raw = {
      id: "s5",
      blocks: [
        {
          id: "block-1",
          name: "Variable Block",
          mode: "variable",
          measurementMode: "back-hog",
          targetTime: 3.75,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].variableTargetMode).toBe("manual");
  });

  it("backfills pendingTargetTime for a migrated manual block from its last shot", () => {
    const raw = {
      id: "s6",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          targetTime: 3.75,
        },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.6, targetTime: 3.6 },
        { id: "shot-2", blockId: "block-1", shotNumber: 2, releaseTime: 3.65, targetTime: 3.65 },
      ],
    };

    const migrated = migrateSession(raw);
    const block = migrated.blocks[0];
    expect(block.variableTargetMode).toBe("manual");
    expect(block.pendingTargetTime).toBe(3.65);
  });

  it("forces a Hog-Hog Smart Random block (only possible under the old shared-range bug) to Manual", () => {
    const raw = {
      id: "s7b",
      blocks: [
        {
          id: "block-1",
          name: "Hog-Hog Variable",
          mode: "variable",
          measurementMode: "hog-hog",
          variableTargetMode: "smart-random",
          targetTime: 3.75,
          // This pending target came from the old (incorrect) shared
          // Back-Hog range — must not be treated as a validated Hog-Hog
          // value, but is safe to keep as a plain manual starting number.
          pendingTargetTime: 3.8,
        },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.9, targetTime: 3.9 },
      ],
    };

    const migrated = migrateSession(raw);
    const block = migrated.blocks[0];

    expect(block.variableTargetMode).toBe("manual");
    expect(block.pendingTargetTime).toBe(3.8);
    // The already-recorded shot's own target is never rewritten.
    expect(migrated.shots[0].targetTime).toBe(3.9);
  });

  it("a Hog-Hog Smart Random block without any pendingTargetTime yet falls back to its last shot, then its default target", () => {
    const raw = {
      id: "s7c",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "hog-hog",
          variableTargetMode: "smart-random",
          targetTime: 5.5,
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].variableTargetMode).toBe("manual");
    expect(migrated.blocks[0].pendingTargetTime).toBe(5.5);
  });

  it("preserves an already-set variableTargetMode instead of overriding it", () => {
    const raw = {
      id: "s7",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          variableTargetMode: "smart-random",
          targetTime: 3.75,
          pendingTargetTime: 3.8,
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].variableTargetMode).toBe("smart-random");
    expect(migrated.blocks[0].pendingTargetTime).toBe(3.8);
  });
});

describe("migrateSession — Smart Random range backfill", () => {
  it("an old Smart Random block without a range gets 2.50-4.50", () => {
    const raw = {
      id: "s12",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "back-hog",
          variableTargetMode: "smart-random",
          targetTime: 3.75,
          pendingTargetTime: 3.8,
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    const block = migrated.blocks[0];
    expect(block.smartRandomMin).toBe(DEFAULT_SMART_RANDOM_MIN);
    expect(block.smartRandomMax).toBe(DEFAULT_SMART_RANDOM_MAX);
  });

  it("keeps an existing pendingTargetTime that already falls inside the backfilled range", () => {
    const raw = {
      id: "s13",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "back-hog",
          variableTargetMode: "smart-random",
          targetTime: 3.75,
          pendingTargetTime: 3.8, // within 2.50-4.50
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].pendingTargetTime).toBe(3.8);
  });

  it("replaces a pendingTargetTime that falls outside an explicitly stored (narrower) range", () => {
    const raw = {
      id: "s14",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "back-hog",
          variableTargetMode: "smart-random",
          targetTime: 3.75,
          smartRandomMin: 3.0,
          smartRandomMax: 3.2,
          pendingTargetTime: 4.4, // outside the block's own 3.00-3.20 range
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    const block = migrated.blocks[0];

    expect(block.smartRandomMin).toBe(3.0);
    expect(block.smartRandomMax).toBe(3.2);
    expect(block.pendingTargetTime).not.toBe(4.4);
    expect(block.pendingTargetTime).toBeGreaterThanOrEqual(3.0);
    expect(block.pendingTargetTime).toBeLessThanOrEqual(3.2);
  });

  it("never rewrites already-recorded shot targets when replacing an out-of-range pending target", () => {
    const raw = {
      id: "s15",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "back-hog",
          variableTargetMode: "smart-random",
          smartRandomMin: 3.0,
          smartRandomMax: 3.2,
          targetTime: 3.1,
          pendingTargetTime: 4.4,
        },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 4.3, targetTime: 4.4 },
      ],
    };

    const migrated = migrateSession(raw);
    expect(migrated.shots[0].targetTime).toBe(4.4);
  });

  it("is idempotent: re-migrating after a range-triggered pending-target replacement is stable", () => {
    const raw = {
      id: "s16",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "back-hog",
          variableTargetMode: "smart-random",
          smartRandomMin: 3.0,
          smartRandomMax: 3.2,
          targetTime: 3.1,
          pendingTargetTime: 4.4,
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("Coach/Manual blocks never receive a Smart Random range during migration", () => {
    const raw = {
      id: "s17",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "back-hog",
          variableTargetMode: "manual",
          targetTime: 3.75,
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].smartRandomMin).toBeUndefined();
    expect(migrated.blocks[0].smartRandomMax).toBeUndefined();
  });
});

describe("migrateSession — idempotency", () => {
  it("migrating an already-migrated session again produces the same result", () => {
    const legacy = {
      id: "s8",
      title: "Old Session",
      date: "2024-01-01T00:00:00.000Z",
      targetTime: 3.8,
      shots: [
        { id: "shot-1", releaseTime: 3.79, handle: "in", shotType: "other" },
      ],
    };

    const once = migrateSession(legacy);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));

    expect(twice).toEqual(once);
  });

  it("migrating a fresh not-yet-configured session repeatedly stays empty", () => {
    const fresh = {
      id: "s9",
      title: "Training Session",
      date: "2026-01-01T00:00:00.000Z",
      blocks: [],
      activeBlockId: "",
      shots: [],
    };

    const once = migrateSession(fresh);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(twice.blocks).toEqual([]);
    expect(twice).toEqual(once);
  });

  it("re-migrating a variable block with a backfilled pendingTargetTime is stable", () => {
    const raw = {
      id: "s10",
      blocks: [{ id: "block-1", mode: "variable", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.6, targetTime: 3.6 },
      ],
    };

    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("re-migrating a sanitized Hog-Hog Smart Random -> Manual block is stable and does not touch shots again", () => {
    const raw = {
      id: "s11",
      blocks: [
        {
          id: "block-1",
          mode: "variable",
          measurementMode: "hog-hog",
          variableTargetMode: "smart-random",
          targetTime: 3.75,
          pendingTargetTime: 3.8,
        },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.9, targetTime: 3.9 },
      ],
    };

    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));

    expect(twice).toEqual(once);
    expect(twice.blocks[0].variableTargetMode).toBe("manual");
    expect(twice.shots[0].targetTime).toBe(3.9);
  });
});

describe("migrateSession — Blind Weight", () => {
  it("a session without Blind Weight is completely unaffected", () => {
    const raw = {
      id: "blind-0",
      blocks: [
        { id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in", shotType: "draw" },
      ],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].blindTargetMode).toBeUndefined();
    expect(migrated.blocks[0].mode).toBe("fixed");
  });

  it("old shots without predictedTime stay valid and predictedTime is never invented", () => {
    const raw = {
      id: "blind-1",
      blocks: [
        { id: "block-1", mode: "blind", measurementMode: "back-hog", blindTargetMode: "fixed", targetTime: 3.75 },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75 },
      ],
    };

    const migrated = migrateSession(raw);
    expect(migrated.shots[0].predictedTime).toBeUndefined();
    expect(migrated.shots[0].releaseTime).toBe(3.7);
  });

  it("a Blind block with Fixed target migrates correctly", () => {
    const raw = {
      id: "blind-2",
      blocks: [
        { id: "block-1", mode: "blind", measurementMode: "back-hog", blindTargetMode: "fixed", targetTime: 4.0 },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].blindTargetMode).toBe("fixed");
    expect(migrated.blocks[0].pendingTargetTime).toBeUndefined();
    expect(migrated.blocks[0].targetTime).toBe(4.0);
  });

  it("a Blind block with Smart Random and a valid range migrates correctly", () => {
    const raw = {
      id: "blind-3",
      blocks: [
        {
          id: "block-1",
          mode: "blind",
          measurementMode: "back-hog",
          blindTargetMode: "smart-random",
          smartRandomMin: 3.4,
          smartRandomMax: 4.2,
          targetTime: 3.75,
          pendingTargetTime: 3.9,
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    const block = migrated.blocks[0];
    expect(block.blindTargetMode).toBe("smart-random");
    expect(block.smartRandomMin).toBe(3.4);
    expect(block.smartRandomMax).toBe(4.2);
    expect(block.pendingTargetTime).toBe(3.9); // already inside range, kept as-is
  });

  it("Hog-Hog Blind Smart Random is safely forced to Manual, same as Variable Weight", () => {
    const raw = {
      id: "blind-4",
      blocks: [
        {
          id: "block-1",
          mode: "blind",
          measurementMode: "hog-hog",
          blindTargetMode: "smart-random",
          targetTime: 5.5,
          pendingTargetTime: 3.8, // came from the old shared-range bug
        },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 5.6, targetTime: 5.6, predictedTime: 5.55 },
      ],
    };

    const migrated = migrateSession(raw);
    const block = migrated.blocks[0];

    expect(block.blindTargetMode).toBe("manual");
    expect(block.smartRandomMin).toBeUndefined();
    expect(block.smartRandomMax).toBeUndefined();
    expect(block.pendingTargetTime).toBe(3.8); // kept only as a manual starting number
    // Already-recorded shot values are untouched.
    expect(migrated.shots[0].targetTime).toBe(5.6);
    expect(migrated.shots[0].predictedTime).toBe(5.55);
  });

  it("an invalid/missing blindTargetMode falls back to Fixed when a targetTime is present", () => {
    const raw = {
      id: "blind-5",
      blocks: [
        { id: "block-1", mode: "blind", measurementMode: "back-hog", targetTime: 3.9 },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].blindTargetMode).toBe("fixed");
  });

  it("falls back to Manual when there is no configured targetTime at all", () => {
    const raw = {
      id: "blind-6",
      blocks: [{ id: "block-1", mode: "blind", measurementMode: "back-hog" }],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].blindTargetMode).toBe("manual");
  });

  it("preserves an already-valid blindTargetMode instead of re-deriving it", () => {
    const raw = {
      id: "blind-7",
      blocks: [
        {
          id: "block-1",
          mode: "blind",
          measurementMode: "back-hog",
          blindTargetMode: "manual",
          targetTime: 3.75, // present, but must NOT force a switch to "fixed"
          pendingTargetTime: 4.0,
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.blocks[0].blindTargetMode).toBe("manual");
    expect(migrated.blocks[0].pendingTargetTime).toBe(4.0);
  });

  it("migration of Blind Weight data is idempotent", () => {
    const raw = {
      id: "blind-8",
      blocks: [
        {
          id: "block-1",
          mode: "blind",
          measurementMode: "back-hog",
          blindTargetMode: "smart-random",
          smartRandomMin: 3.0,
          smartRandomMax: 3.3,
          targetTime: 3.15,
          pendingTargetTime: 4.4, // outside the range -> will be replaced once
        },
      ],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.1, targetTime: 3.1, predictedTime: 3.2 },
      ],
    };

    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));

    expect(twice).toEqual(once);
    // The out-of-range pending target really was replaced, and the shot's
    // own recorded prediction/target were never touched by either pass.
    expect(once.blocks[0].pendingTargetTime).not.toBe(4.4);
    expect(twice.shots[0].targetTime).toBe(3.1);
    expect(twice.shots[0].predictedTime).toBe(3.2);
  });

  it("existing shot values (target, prediction, release, handle, shot type) are never altered by migration", () => {
    const raw = {
      id: "blind-9",
      blocks: [
        { id: "block-1", mode: "blind", measurementMode: "back-hog", blindTargetMode: "fixed", targetTime: 3.75 },
      ],
      activeBlockId: "block-1",
      shots: [
        {
          id: "shot-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.78,
          targetTime: 3.75,
          predictedTime: 3.82,
          handle: "out",
        },
      ],
    };

    const migrated = migrateSession(raw);
    const shot = migrated.shots[0];
    expect(shot.releaseTime).toBe(3.78);
    expect(shot.targetTime).toBe(3.75);
    expect(shot.predictedTime).toBe(3.82);
    expect(shot.handle).toBe("out");
    expect(shot.shotType).toBeUndefined();
  });
});

describe("migrateSession — capture-sequence and capture-shot metadata", () => {
  it("an old session without any capture data is completely unaffected", () => {
    const raw = {
      id: "capture-0",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in", shotType: "draw" },
      ],
    };

    const migrated = migrateSession(raw);
    expect(migrated.captureSequence).toBeUndefined();
    expect(migrated.shots[0].measurementSource).toBeUndefined();
    expect(migrated.shots[0].captureSequenceId).toBeUndefined();
  });

  it("capture shot metadata is preserved when present, never fabricated when absent", () => {
    const raw = {
      id: "capture-1",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [
        {
          id: "shot-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.7,
          targetTime: 3.75,
          handle: "in",
          shotType: "draw",
          measurementSource: "simulator",
          captureSequenceId: "seq-1",
          timingResultId: "result-1",
          deviceId: "device-abc",
        },
        {
          id: "shot-2",
          blockId: "block-1",
          shotNumber: 2,
          releaseTime: 3.8,
          targetTime: 3.75,
          handle: "in",
          shotType: "draw",
        },
      ],
    };

    const migrated = migrateSession(raw);
    expect(migrated.shots[0].measurementSource).toBe("simulator");
    expect(migrated.shots[0].captureSequenceId).toBe("seq-1");
    expect(migrated.shots[0].timingResultId).toBe("result-1");
    expect(migrated.shots[0].deviceId).toBe("device-abc");
    expect(migrated.shots[0].laneId).toBeUndefined();
    // Shot 2 never went through a capture sequence — nothing invented for it.
    expect(migrated.shots[1].measurementSource).toBeUndefined();
    expect(migrated.shots[1].captureSequenceId).toBeUndefined();
  });

  it("an invalid measurementSource value is dropped rather than passed through", () => {
    const raw = {
      id: "capture-1b",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [
        { id: "shot-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in", measurementSource: "some-old-provider" },
      ],
    };

    const migrated = migrateSession(raw);
    expect(migrated.shots[0].measurementSource).toBeUndefined();
  });

  it("a valid persisted capture sequence survives migration, still paused if it was paused", () => {
    const raw = {
      id: "capture-2",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [
        {
          id: "shot-a",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.7,
          targetTime: 3.75,
          handle: "in",
          captureSequenceId: "seq-1",
        },
        {
          id: "shot-b",
          blockId: "block-1",
          shotNumber: 2,
          releaseTime: 3.8,
          targetTime: 3.75,
          handle: "out",
          captureSequenceId: "seq-1",
        },
      ],
      captureSequence: {
        id: "seq-1",
        blockId: "block-1",
        expectedShotCount: 8,
        capturedShotCount: 2,
        status: "paused",
        providerType: "simulator",
        handleMode: "alternate",
        startHandle: "in",
        processedResultIds: ["r1", "r2"],
        steps: [
          { resultId: "r1", shotId: "shot-a", targetTime: 3.75, handle: "in" },
          { resultId: "r2", shotId: "shot-b", targetTime: 3.75, handle: "out" },
        ],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.captureSequence).toBeDefined();
    expect(migrated.captureSequence?.status).toBe("paused");
    expect(migrated.captureSequence?.capturedShotCount).toBe(2);
    expect(migrated.captureSequence?.steps).toHaveLength(2);
    expect(migrated.captureSequence?.processedResultIds).toEqual(["r1", "r2"]);
  });

  it("a sequence that was still 'running' at save time is forced to 'paused' on load", () => {
    const raw = {
      id: "capture-3",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [],
      captureSequence: {
        id: "seq-1",
        blockId: "block-1",
        expectedShotCount: 4,
        capturedShotCount: 1,
        status: "running",
        providerType: "simulator",
        handleMode: "fixed-in",
        startHandle: "in",
        processedResultIds: ["r1"],
        steps: [{ resultId: "r1", shotId: "shot-a", targetTime: 3.75, handle: "in" }],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.captureSequence?.status).toBe("paused");
  });

  it("a sequence pointing at a non-existent block is discarded, not repaired", () => {
    const raw = {
      id: "capture-4",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [],
      captureSequence: {
        id: "seq-1",
        blockId: "does-not-exist",
        expectedShotCount: 4,
        capturedShotCount: 0,
        status: "running",
        providerType: "simulator",
        handleMode: "fixed-in",
        startHandle: "in",
        processedResultIds: [],
        steps: [],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.captureSequence).toBeUndefined();
  });

  it("a sequence with an invalid expectedShotCount is discarded", () => {
    const raw = {
      id: "capture-5",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [],
      captureSequence: {
        id: "seq-1",
        blockId: "block-1",
        expectedShotCount: 0,
        capturedShotCount: 0,
        status: "ready",
        providerType: "simulator",
        handleMode: "fixed-in",
        startHandle: "in",
        processedResultIds: [],
        steps: [],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.captureSequence).toBeUndefined();
  });

  it("capturedShotCount is re-derived from real capture shots, not trusted as a separately stored number", () => {
    const raw = {
      id: "capture-6",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [
        {
          id: "shot-a",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.7,
          targetTime: 3.75,
          handle: "in",
          captureSequenceId: "seq-1",
        },
      ],
      captureSequence: {
        id: "seq-1",
        blockId: "block-1",
        expectedShotCount: 8,
        capturedShotCount: 99, // deliberately inconsistent with the real shots
        status: "paused",
        providerType: "simulator",
        handleMode: "fixed-in",
        startHandle: "in",
        processedResultIds: ["r1"],
        steps: [{ resultId: "r1", shotId: "shot-a", targetTime: 3.75, handle: "in" }],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.captureSequence?.capturedShotCount).toBe(1);
  });

  it("capturedShotCount higher than the real number of captured shots is corrected down (steps referencing a vanished shot are dropped)", () => {
    const raw = {
      id: "capture-6b",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [], // shot-a no longer exists (e.g. deleted) — its step must not be trusted
      captureSequence: {
        id: "seq-1",
        blockId: "block-1",
        expectedShotCount: 8,
        capturedShotCount: 1,
        status: "paused",
        providerType: "simulator",
        handleMode: "fixed-in",
        startHandle: "in",
        processedResultIds: ["r1"],
        steps: [{ resultId: "r1", shotId: "shot-a", targetTime: 3.75, handle: "in" }],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.captureSequence?.capturedShotCount).toBe(0);
    expect(migrated.captureSequence?.steps).toHaveLength(0);
    // The result id stays known/spent even though its shot is gone — it must not become
    // resubmittable as if it were new.
    expect(migrated.captureSequence?.processedResultIds).toContain("r1");
  });

  it("migration of capture-sequence data is idempotent", () => {
    const raw = {
      id: "capture-7",
      blocks: [{ id: "block-1", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }],
      activeBlockId: "block-1",
      shots: [],
      captureSequence: {
        id: "seq-1",
        blockId: "block-1",
        expectedShotCount: 4,
        capturedShotCount: 1,
        status: "running",
        providerType: "simulator",
        handleMode: "alternate",
        startHandle: "out",
        processedResultIds: ["r1"],
        steps: [{ resultId: "r1", shotId: "shot-a", targetTime: 3.75, handle: "out" }],
      },
    };

    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
    expect(twice.captureSequence?.status).toBe("paused");
  });
});

describe("migrateSession — Accuracy Thresholds backfill", () => {
  it("a legacy pre-block session's fabricated Legacy Block gets 0.10/0.20", () => {
    const migrated = migrateSession({
      id: "s1",
      title: "Old Session",
      date: "2024-01-01T00:00:00.000Z",
      targetTime: 3.8,
      shots: [],
    });
    expect(migrated.blocks[0].accuracyThresholds).toEqual(
      STANDARD_ACCURACY_THRESHOLDS
    );
  });

  it("a block with no stored accuracyThresholds gets the legacy default", () => {
    const migrated = migrateSession({
      id: "s2",
      title: "Session",
      date: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          id: "block-1",
          name: "Block A",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.9,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    });
    expect(migrated.blocks[0].accuracyThresholds).toEqual(
      STANDARD_ACCURACY_THRESHOLDS
    );
  });

  it("a block with a valid custom accuracyThresholds keeps it exactly", () => {
    const migrated = migrateSession({
      id: "s3",
      title: "Session",
      date: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          id: "block-1",
          name: "Block A",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.9,
          createdAt: "2024-01-01T00:00:00.000Z",
          accuracyThresholds: { onTarget: 0.08, acceptable: 0.16 },
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    });
    expect(migrated.blocks[0].accuracyThresholds).toEqual({
      onTarget: 0.08,
      acceptable: 0.16,
    });
  });

  it("repairs invalid stored thresholds (NaN, negative, acceptable<=onTarget) to the legacy default", () => {
    const invalidVariants = [
      { onTarget: NaN, acceptable: 0.2 },
      { onTarget: 0.1, acceptable: Infinity },
      { onTarget: -0.1, acceptable: 0.2 },
      { onTarget: 0.2, acceptable: 0.1 },
      { onTarget: 0, acceptable: 0.2 },
    ];

    for (const invalid of invalidVariants) {
      const migrated = migrateSession({
        id: "s4",
        title: "Session",
        date: "2024-01-01T00:00:00.000Z",
        blocks: [
          {
            id: "block-1",
            name: "Block A",
            mode: "fixed",
            measurementMode: "back-hog",
            targetTime: 3.9,
            createdAt: "2024-01-01T00:00:00.000Z",
            accuracyThresholds: invalid,
          },
        ],
        activeBlockId: "block-1",
        shots: [],
      });
      expect(migrated.blocks[0].accuracyThresholds).toEqual(
        STANDARD_ACCURACY_THRESHOLDS
      );
    }
  });

  it("never rewrites an already-recorded shot's targetTime/releaseTime when backfilling thresholds", () => {
    const raw = {
      id: "s5",
      title: "Session",
      date: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          id: "block-1",
          name: "Block A",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.9,
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
      activeBlockId: "block-1",
      shots: [
        {
          id: "shot-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.95,
          targetTime: 3.9,
          handle: "in",
          createdAt: "2024-01-01T00:00:01.000Z",
        },
      ],
    };
    const migrated = migrateSession(raw);
    expect(migrated.shots[0].releaseTime).toBe(3.95);
    expect(migrated.shots[0].targetTime).toBe(3.9);
  });

  it("migrating twice is idempotent for accuracyThresholds, valid or repaired", () => {
    const raw = {
      id: "s6",
      title: "Session",
      date: "2024-01-01T00:00:00.000Z",
      blocks: [
        {
          id: "block-1",
          name: "Valid",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.9,
          createdAt: "2024-01-01T00:00:00.000Z",
          accuracyThresholds: { onTarget: 0.08, acceptable: 0.16 },
        },
        {
          id: "block-2",
          name: "Invalid",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.9,
          createdAt: "2024-01-01T00:00:00.000Z",
          accuracyThresholds: { onTarget: -1, acceptable: -1 },
        },
      ],
      activeBlockId: "block-1",
      shots: [],
    };

    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});

describe("migrateSession — planExecution (Training Plans)", () => {
  function releaseTimingStep(id: string) {
    return {
      id,
      type: "release-timing",
      completion: { type: "shot-count", value: 8 },
      handleStrategy: { type: "alternating", startingHandle: "in" },
      configuration: {
        name: "Fixed Weight",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
        blindTargetMode: "fixed",
        smartRandomMin: 2.5,
        smartRandomMax: 4.5,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    };
  }

  function blockFor(id: string) {
    return {
      id,
      name: "Plan Block",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      createdAt: "2024-01-01T00:00:00.000Z",
    };
  }

  it("survives reload with an in-progress plan execution (not yet on the final step)", () => {
    const raw = {
      id: "s-plan-1",
      blocks: [blockFor("block-1"), blockFor("block-2")],
      activeBlockId: "block-2",
      shots: [],
      planExecution: {
        sourcePlanId: "plan-1",
        sourcePlanName: "Release Consistency",
        sourcePlanUpdatedAt: "2024-01-01T00:00:00.000Z",
        activeStepIndex: 1,
        steps: [
          { step: releaseTimingStep("step-1"), blockId: "block-1" },
          { step: releaseTimingStep("step-2"), blockId: "block-2" },
          { step: releaseTimingStep("step-3") },
        ],
      },
    };

    const migrated = migrateSession(raw);

    expect(migrated.planExecution).toBeDefined();
    expect(migrated.planExecution?.sourcePlanName).toBe("Release Consistency");
    expect(migrated.planExecution?.activeStepIndex).toBe(1);
    expect(migrated.planExecution?.steps[0].runtime).toEqual({ kind: "release-timing-block", blockId: "block-1" });
    expect(migrated.planExecution?.steps[1].runtime).toEqual({ kind: "release-timing-block", blockId: "block-2" });
    expect(migrated.planExecution?.steps[2].runtime).toBeUndefined();
  });

  it("survives reload for a completed plan execution (active step is the final one)", () => {
    const raw = {
      id: "s-plan-2",
      blocks: [blockFor("block-1"), blockFor("block-2")],
      activeBlockId: "block-2",
      shots: [],
      planExecution: {
        sourcePlanId: "plan-1",
        sourcePlanName: "Release Consistency",
        activeStepIndex: 1,
        steps: [
          { step: releaseTimingStep("step-1"), blockId: "block-1" },
          { step: releaseTimingStep("step-2"), blockId: "block-2" },
        ],
      },
    };

    const migrated = migrateSession(raw);

    expect(migrated.planExecution?.activeStepIndex).toBe(1);
    expect(migrated.planExecution?.steps).toHaveLength(2);
    expect(migrated.planExecution?.steps[1].runtime).toEqual({ kind: "release-timing-block", blockId: "block-2" });

    // Readable from history exactly the same way — migrateSessionHistory just
    // maps migrateSession over the array, so no separate assertion is needed
    // beyond confirming this single-session path is correct.
  });

  it("leaves planExecution undefined for a legacy Session that never had one", () => {
    const raw = {
      id: "s-plan-3",
      blocks: [blockFor("block-1")],
      activeBlockId: "block-1",
      shots: [],
    };

    const migrated = migrateSession(raw);
    expect(migrated.planExecution).toBeUndefined();
  });

  it("discards a malformed planExecution (activeStepIndex out of bounds) without affecting blocks/shots", () => {
    const raw = {
      id: "s-plan-4",
      blocks: [blockFor("block-1")],
      activeBlockId: "block-1",
      shots: [
        {
          id: "shot-1",
          blockId: "block-1",
          shotNumber: 1,
          releaseTime: 3.8,
          targetTime: 3.75,
          handle: "in",
          createdAt: "2024-01-01T00:00:01.000Z",
        },
      ],
      planExecution: {
        sourcePlanId: "plan-1",
        sourcePlanName: "Release Consistency",
        activeStepIndex: 5,
        steps: [{ step: releaseTimingStep("step-1"), blockId: "block-1" }],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.planExecution).toBeUndefined();
    expect(migrated.blocks).toHaveLength(1);
    expect(migrated.shots).toHaveLength(1);
  });

  it("discards a malformed planExecution (blockId points at a non-existent block)", () => {
    const raw = {
      id: "s-plan-5",
      blocks: [blockFor("block-1")],
      activeBlockId: "block-1",
      shots: [],
      planExecution: {
        sourcePlanId: "plan-1",
        sourcePlanName: "Release Consistency",
        activeStepIndex: 0,
        steps: [{ step: releaseTimingStep("step-1"), blockId: "block-does-not-exist" }],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.planExecution).toBeUndefined();
    expect(migrated.blocks).toHaveLength(1);
  });

  it("discards a malformed planExecution (steps is not an array)", () => {
    const raw = {
      id: "s-plan-6",
      blocks: [blockFor("block-1")],
      activeBlockId: "block-1",
      shots: [],
      planExecution: {
        sourcePlanId: "plan-1",
        sourcePlanName: "Release Consistency",
        activeStepIndex: 0,
        steps: "not-an-array",
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.planExecution).toBeUndefined();
    expect(migrated.blocks).toHaveLength(1);
  });

  it("discards a malformed planExecution (planExecution itself is not an object)", () => {
    const raw = {
      id: "s-plan-7",
      blocks: [blockFor("block-1")],
      activeBlockId: "block-1",
      shots: [],
      planExecution: "not-an-object",
    };

    const migrated = migrateSession(raw);
    expect(migrated.planExecution).toBeUndefined();
    expect(migrated.blocks).toHaveLength(1);
  });

  it("is idempotent for a Session with an active planExecution", () => {
    const raw = {
      id: "s-plan-8",
      blocks: [blockFor("block-1"), blockFor("block-2")],
      activeBlockId: "block-2",
      shots: [],
      planExecution: {
        sourcePlanId: "plan-1",
        sourcePlanName: "Release Consistency",
        activeStepIndex: 1,
        steps: [
          { step: releaseTimingStep("step-1"), blockId: "block-1" },
          { step: releaseTimingStep("step-2"), blockId: "block-2" },
          { step: releaseTimingStep("step-3") },
        ],
      },
    };

    const once = migrateSession(raw);
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });

  it("preserves a completed curated Exercise runtime and rejects a mismatched snapshot", () => {
    const execution = createCompletedTechniqueExecution();
    const step = {
      id: "technique-step",
      type: "curated-exercise",
      exerciseVersionSnapshot: execution.exerciseVersionSnapshot,
      completion: { type: "exercise-completion" },
    };
    const raw = {
      id: FIXTURE_SESSION_ID,
      blocks: [],
      activeBlockId: "",
      shots: [],
      exerciseExecutions: [execution],
      planExecution: {
        sourcePlanId: "mixed-plan",
        sourcePlanName: "Mixed Practice",
        activeStepIndex: 0,
        steps: [{
          step,
          runtime: { kind: "exercise-execution", exerciseExecutionId: execution.id },
        }],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.planExecution?.steps[0].runtime).toEqual({
      kind: "exercise-execution",
      exerciseExecutionId: execution.id,
    });
    expect(migrateSession(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);

    const mismatched = {
      ...raw,
      planExecution: {
        ...raw.planExecution,
        steps: [{
          ...raw.planExecution.steps[0],
          step: {
            ...step,
            exerciseVersionSnapshot: createTechniqueExecution().exerciseVersionSnapshot,
          },
          runtime: { kind: "release-timing-block", blockId: "missing" },
        }],
      },
    };
    expect(migrateSession(mismatched).planExecution).toBeUndefined();
  });

  it("preserves a generic Measured Exercise runtime without treating it as Release Timing", () => {
    const execution = createRotationCountExecution();
    const raw = {
      id: FIXTURE_SESSION_ID,
      blocks: [],
      activeBlockId: "",
      shots: [],
      exerciseExecutions: [execution],
      activeExerciseExecutionId: execution.id,
      planExecution: {
        sourcePlanId: "measured-plan",
        sourcePlanName: "Measured Practice",
        activeStepIndex: 0,
        steps: [{
          step: {
            id: "rotation-step",
            type: "curated-exercise",
            exerciseVersionSnapshot: execution.exerciseVersionSnapshot,
            completion: { type: "exercise-completion" },
          },
          runtime: { kind: "exercise-execution", exerciseExecutionId: execution.id },
        }],
      },
    };

    const migrated = migrateSession(raw);
    expect(migrated.planExecution?.steps[0].runtime).toEqual({
      kind: "exercise-execution",
      exerciseExecutionId: execution.id,
    });
    expect(migrateSession(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });
});
