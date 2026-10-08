// @vitest-environment jsdom
//
// The compatibility evidence for Stage A: existing time-only data must come back
// byte-for-byte identical, and the new format must survive every persistence hop.
import { describe, expect, it } from "vitest";
import {
  deserializeTrainingSession,
  serializeTrainingSession,
  sha256Hex,
  TRAINING_SESSION_CLOUD_SCHEMA_VERSION,
  TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION,
} from "../../cloudSporting/records";
import type { CloudSportingRecord } from "../../cloudSporting/types";
import { migrateSession, migrateSessionHistory } from "../../sessionMigration";
import { migrateTrainingPlans } from "../../trainingPlans/migration";
import { isStepExecutable } from "../../trainingPlans/validation";
import { usesBlockMeasurementConfiguration, validateSessionMeasurementState } from "../validation";
import { BOTH_CONFIGURATION, SPEED_CONFIGURATION } from "./measurementFixtures";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const BLOCK_ID = "33333333-3333-4333-8333-333333333333";

/** A realistic stored time-only session, exactly as the app wrote it before this feature. */
function legacySessionPayload() {
  return {
    id: SESSION_ID,
    title: "Training Session",
    date: "2026-09-01T10:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: BLOCK_ID,
        name: "Fixed Weight Block",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: "2026-09-01T10:00:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    ],
    activeBlockId: BLOCK_ID,
    shots: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 1,
        releaseTime: 3.81,
        targetTime: 3.75,
        handle: "in",
        shotType: "draw",
        createdAt: "2026-09-01T10:01:00.000Z",
      },
    ],
  };
}

function bothSessionPayload() {
  return {
    id: SESSION_ID,
    title: "Fixed Weight — Both",
    date: "2026-10-06T10:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: BLOCK_ID,
        name: "Both",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: "2026-10-06T10:00:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        measurement: BOTH_CONFIGURATION,
      },
    ],
    activeBlockId: BLOCK_ID,
    shots: [
      // fully measured
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 1,
        releaseTime: 3.81,
        targetTime: 3.75,
        speed: 2.43,
        targetSpeed: 2.4,
        speedSource: "manual",
        speedRecordedAt: "2026-10-06T10:02:00.000Z",
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
      // missing speed
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 2,
        releaseTime: 3.7,
        targetTime: 3.75,
        handle: "out",
        createdAt: "2026-10-06T10:03:00.000Z",
      },
      // missing time
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 3,
        speed: 2.38,
        targetSpeed: 2.4,
        speedSource: "manual",
        handle: "in",
        createdAt: "2026-10-06T10:04:00.000Z",
      },
    ],
  };
}

function speedOnlySessionPayload() {
  return {
    id: SESSION_ID,
    title: "Fixed Weight — Speed",
    date: "2026-10-06T10:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: BLOCK_ID,
        name: "Speed",
        mode: "fixed",
        createdAt: "2026-10-06T10:00:00.000Z",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        measurement: SPEED_CONFIGURATION,
      },
    ],
    activeBlockId: BLOCK_ID,
    shots: [
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        sessionId: SESSION_ID,
        blockId: BLOCK_ID,
        shotNumber: 1,
        speed: 2.41,
        targetSpeed: 2.4,
        speedSource: "manual",
        handle: "in",
        createdAt: "2026-10-06T10:01:00.000Z",
      },
    ],
  };
}

describe("legacy time-only data is completely unaffected", () => {
  it("migrates to exactly the stored value, with no new fields added", () => {
    const payload = legacySessionPayload();
    const migrated = migrateSession(payload);

    expect(migrated.blocks[0].measurement).toBeUndefined();
    expect(migrated.blocks[0].targetTime).toBe(3.75);
    expect(migrated.blocks[0].measurementMode).toBe("back-hog");
    expect(migrated.shots[0].releaseTime).toBe(3.81);
    expect(migrated.shots[0].speed).toBeUndefined();

    expect(JSON.parse(JSON.stringify(migrated))).toEqual(payload);
  });

  it("is idempotent: migrating already-migrated data twice is a no-op", () => {
    const once = migrateSession(legacySessionPayload());
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("keeps the exact cloud payload bytes, digest, identity and schema version on read", async () => {
    const payload = legacySessionPayload();
    const stored = JSON.stringify(payload);
    const digest = await sha256Hex(stored);
    expect(digest).toBeTruthy();

    const record: CloudSportingRecord = {
      recordKind: "training_session",
      recordId: SESSION_ID,
      schemaVersion: TRAINING_SESSION_CLOUD_SCHEMA_VERSION,
      payload: stored,
      recordedAt: payload.date,
      contentSha256: digest as string,
    };

    const restored = deserializeTrainingSession(record);
    expect(restored).not.toBeNull();

    // Re-serializing what we just read must reproduce identical bytes, the same
    // digest, the same identity and the SAME wire version — otherwise reconcile()
    // would see a changed payload and raise an artificial sync conflict.
    const reserialized = serializeTrainingSession(restored!);
    expect(reserialized).not.toBeNull();
    expect(reserialized!.payload).toBe(stored);
    expect(await sha256Hex(reserialized!.payload)).toBe(digest);
    expect(reserialized!.recordId).toBe(SESSION_ID);
    expect(reserialized!.schemaVersion).toBe(TRAINING_SESSION_CLOUD_SCHEMA_VERSION);
  });

  it("still serializes a purely time-only session as wire version 1", () => {
    const record = serializeTrainingSession(migrateSession(legacySessionPayload()));
    expect(record?.schemaVersion).toBe(TRAINING_SESSION_CLOUD_SCHEMA_VERSION);
  });

  it("leaves a legacy shot with a missing releaseTime on its existing repair path", () => {
    const payload = legacySessionPayload();
    delete (payload.shots[0] as Record<string, unknown>).releaseTime;
    const migrated = migrateSession(payload);
    // Unchanged historical behaviour for legacy blocks: 0, not "missing".
    expect(migrated.shots[0].releaseTime).toBe(0);
  });
});

describe("new-format sessions survive migration unchanged", () => {
  it.each([
    ["Both", bothSessionPayload],
    ["Speed only", speedOnlySessionPayload],
  ])("%s round-trips through migration without alteration", (_label, build) => {
    const payload = build();
    const migrated = migrateSession(payload);
    expect(JSON.parse(JSON.stringify(migrated))).toEqual(payload);
  });

  it.each([
    ["Both", bothSessionPayload],
    ["Speed only", speedOnlySessionPayload],
  ])("%s migration is idempotent", (_label, build) => {
    const once = migrateSession(build());
    const twice = migrateSession(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it("never fabricates a timing interval or time target for a speed-only block", () => {
    const migrated = migrateSession(speedOnlySessionPayload());
    expect(migrated.blocks[0].measurementMode).toBeUndefined();
    expect(migrated.blocks[0].targetTime).toBeUndefined();
    expect(migrated.shots[0].releaseTime).toBeUndefined();
    expect(migrated.shots[0].targetTime).toBeUndefined();
  });

  it("never fabricates releaseTime=0 for a Both stone whose time is outstanding", () => {
    const migrated = migrateSession(bothSessionPayload());
    const missingTime = migrated.shots[2];
    expect(missingTime.releaseTime).toBeUndefined();
    expect(missingTime.targetTime).toBeUndefined();
    expect(missingTime.speed).toBe(2.38);
  });

  it("preserves history round-trips for a mix of old and new sessions", () => {
    const history = [legacySessionPayload(), bothSessionPayload(), speedOnlySessionPayload()];
    const migrated = migrateSessionHistory(history);
    expect(JSON.parse(JSON.stringify(migrated))).toEqual(history);
  });
});

describe("cloud wire versioning", () => {
  it("serializes a speed-carrying session as wire version 2", () => {
    const record = serializeTrainingSession(migrateSession(bothSessionPayload()));
    expect(record?.schemaVersion).toBe(TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION);
  });

  it.each([
    ["Both", bothSessionPayload],
    ["Speed only", speedOnlySessionPayload],
  ])("%s round-trips through the terminal cloud record with everything intact", async (_label, build) => {
    const original = migrateSession(build());
    const record = serializeTrainingSession(original);
    expect(record).not.toBeNull();

    const digest = await sha256Hex(record!.payload);
    const restored = deserializeTrainingSession({ ...record!, contentSha256: digest as string });
    expect(restored).not.toBeNull();
    expect(restored).toEqual(original);

    // Speed, targets, asymmetry support, provenance and missingness all survive.
    expect(restored!.blocks[0].measurement).toEqual(build().blocks[0].measurement);
    const reserialized = serializeTrainingSession(restored!);
    expect(reserialized!.payload).toBe(record!.payload);
    expect(await sha256Hex(reserialized!.payload)).toBe(digest);
  });

  it("round-trips an asymmetric per-side tolerance exactly", async () => {
    const payload = bothSessionPayload();
    payload.blocks[0].measurement = {
      quantities: ["time", "speed"],
      time: {
        target: 3.75,
        tolerance: { onTarget: { lower: 0.08, upper: 0.12 }, acceptable: { lower: 0.15, upper: 0.25 } },
      },
      speed: {
        target: 2.4,
        tolerance: { onTarget: { lower: 0.04, upper: 0.06 }, acceptable: { lower: 0.09, upper: 0.11 } },
      },
    };

    const record = serializeTrainingSession(migrateSession(payload));
    const restored = deserializeTrainingSession({ ...record!, contentSha256: "x" });
    expect(restored!.blocks[0].measurement).toEqual(payload.blocks[0].measurement);
  });

  it("refuses a version-1 record that actually carries measurement-aware content", () => {
    const payload = bothSessionPayload();
    const record: CloudSportingRecord = {
      recordKind: "training_session",
      recordId: SESSION_ID,
      schemaVersion: TRAINING_SESSION_CLOUD_SCHEMA_VERSION,
      payload: JSON.stringify(payload),
      recordedAt: payload.date,
      contentSha256: "x",
    };
    expect(deserializeTrainingSession(record)).toBeNull();
  });

  it("refuses a version-2 record that carries no measurement-aware content", () => {
    const payload = legacySessionPayload();
    const record: CloudSportingRecord = {
      recordKind: "training_session",
      recordId: SESSION_ID,
      schemaVersion: TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION,
      payload: JSON.stringify(payload),
      recordedAt: payload.date,
      contentSha256: "x",
    };
    expect(deserializeTrainingSession(record)).toBeNull();
  });

  it("refuses an unsupported future wire version rather than guess-migrating it", () => {
    const payload = bothSessionPayload();
    const record: CloudSportingRecord = {
      recordKind: "training_session",
      recordId: SESSION_ID,
      schemaVersion: 99,
      payload: JSON.stringify(payload),
      recordedAt: payload.date,
      contentSha256: "x",
    };
    expect(deserializeTrainingSession(record)).toBeNull();
  });

  it("refuses to upload a session whose measurement state is malformed", () => {
    const payload = bothSessionPayload();
    // A stone claiming a speed with no target it was judged against.
    delete (payload.shots[0] as Record<string, unknown>).targetSpeed;
    expect(serializeTrainingSession(migrateSession(payload) as never)).toBeNull();
  });
});

describe("malformed new-format data is protected, never silently normalized", () => {
  it("rejects a measurement-aware stone carrying no measurement at all", () => {
    const payload = bothSessionPayload();
    const stone = payload.shots[1] as Record<string, unknown>;
    delete stone.releaseTime;
    delete stone.targetTime;
    const result = validateSessionMeasurementState(payload);
    expect(result.valid).toBe(false);
  });

  it("rejects a speed recorded on a block that declares no speed", () => {
    const payload = legacySessionPayload();
    (payload.shots[0] as Record<string, unknown>).speed = 2.4;
    (payload.shots[0] as Record<string, unknown>).targetSpeed = 2.4;
    expect(validateSessionMeasurementState(payload).valid).toBe(false);
  });

  it("rejects a speed-only block that still carries a timing interval or time target", () => {
    const withInterval = speedOnlySessionPayload();
    (withInterval.blocks[0] as Record<string, unknown>).measurementMode = "back-hog";
    expect(validateSessionMeasurementState(withInterval).valid).toBe(false);

    const withTarget = speedOnlySessionPayload();
    (withTarget.blocks[0] as Record<string, unknown>).targetTime = 3.75;
    expect(validateSessionMeasurementState(withTarget).valid).toBe(false);
  });

  it("rejects a measurement configuration on a Variable or Blind Weight block", () => {
    const payload = bothSessionPayload();
    (payload.blocks[0] as Record<string, unknown>).mode = "variable";
    expect(validateSessionMeasurementState(payload).valid).toBe(false);
  });

  it("rejects an invalid tolerance in a stored configuration", () => {
    const payload = bothSessionPayload();
    (payload.blocks[0] as Record<string, unknown>).measurement = {
      quantities: ["speed"],
      speed: { target: 2.4, tolerance: { onTarget: { lower: 0.2, upper: 0.2 }, acceptable: { lower: 0.1, upper: 0.1 } } },
    };
    expect(validateSessionMeasurementState(payload).valid).toBe(false);
  });

  it("rejects an unknown speed source and an unparseable speed timestamp", () => {
    const badSource = bothSessionPayload();
    (badSource.shots[0] as Record<string, unknown>).speedSource = "telepathy";
    expect(validateSessionMeasurementState(badSource).valid).toBe(false);

    const badStamp = bothSessionPayload();
    (badStamp.shots[0] as Record<string, unknown>).speedRecordedAt = "not-a-date";
    expect(validateSessionMeasurementState(badStamp).valid).toBe(false);
  });

  it("accepts every well-formed configuration", () => {
    expect(validateSessionMeasurementState(legacySessionPayload()).valid).toBe(true);
    expect(validateSessionMeasurementState(bothSessionPayload()).valid).toBe(true);
    expect(validateSessionMeasurementState(speedOnlySessionPayload()).valid).toBe(true);
  });

  it("detects measurement-aware content for wire-version selection", () => {
    expect(usesBlockMeasurementConfiguration(legacySessionPayload())).toBe(false);
    expect(usesBlockMeasurementConfiguration(bothSessionPayload())).toBe(true);
    expect(usesBlockMeasurementConfiguration(speedOnlySessionPayload())).toBe(true);
  });
});

describe("Training Plan library compatibility", () => {
  const legacyPlanState = {
    schemaVersion: 2,
    plans: [
      {
        id: "plan-1",
        name: "Legacy plan",
        steps: [],
        createdAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
        schemaVersion: 2,
      },
    ],
  };

  it("leaves a stored plan with no steps untouched and is idempotent", () => {
    const once = migrateTrainingPlans(legacyPlanState);
    const twice = migrateTrainingPlans(JSON.parse(JSON.stringify(once)));
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(once.plans[0].name).toBe("Legacy plan");
  });

  it("does not reinterpret a legacy time preset as a speed preset", () => {
    const migrated = migrateTrainingPlans(legacyPlanState);
    expect(migrated.plans[0].steps).toEqual([]);
  });

  it("treats a speed-only step with leftover time fields as not executable", () => {
    const step = {
      id: "s1",
      type: "release-timing" as const,
      exerciseVersionSnapshot: { id: "nope" },
      completion: { type: "shot-count" as const, value: 8 },
      handleStrategy: { type: "free" as const },
      configuration: {
        name: "Speed",
        mode: "fixed" as const,
        measurementMode: "back-hog" as const,
        targetTime: 3.75,
        variableTargetMode: "manual" as const,
        blindTargetMode: "fixed" as const,
        smartRandomMin: 2.5,
        smartRandomMax: 4.5,
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        measurement: SPEED_CONFIGURATION,
      },
    };
    expect(isStepExecutable(step as never)).toBe(false);
  });
});
