// @vitest-environment jsdom
//
// The complete measurement-aware shape: identity, ownership, canonical form and
// writer/reader agreement. A record this build writes must be one it can read back,
// and nothing malformed may be repaired on load — repair rewrites stored bytes and
// turns a recoverable problem into a permanent one.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
} from "../../sessionRepository";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import {
  deserializeTrainingSession,
  serializeTrainingSession,
  TRAINING_SESSION_CLOUD_SCHEMA_VERSION,
  TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION,
} from "../../cloudSporting/records";
import { completeShotMeasurement } from "../operations";
import { buildStep } from "../../trainingPlans/__tests__/testHelpers";
import type { ReleaseTimingPlanStep, Session } from "../../../types";
import {
  bothBlock,
  legacyTimeBlock,
  session,
  speedBlock,
  speedShot,
  timeShot,
} from "./measurementFixtures";

function fixture() {
  const block = bothBlock();
  const state = session([block], []);
  state.shots = [timeShot(block, 3.8, { sessionId: state.id })];
  return { block, state };
}

async function saveAccepted(state: Session): Promise<boolean> {
  const repository = createSessionRepository(createLocalStorageAdapter());
  return (await repository.saveCurrent(state)).ok;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("stone identity and ownership", () => {
  it("refuses a measurement-aware stone with no stable identity", async () => {
    const { state } = fixture();
    delete (state.shots[0] as { id?: string }).id;
    expect(await saveAccepted(state)).toBe(false);
    // Migration would have minted a fresh id, rewriting the payload and making the
    // stone unaddressable by anything that referred to it before.
    expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("refuses a stone stamped with another session's id", async () => {
    const { state } = fixture();
    state.shots[0].sessionId = "different-session";
    expect(await saveAccepted(state)).toBe(false);
  });

  it("refuses an empty-string stone identity", async () => {
    const { state } = fixture();
    state.shots[0].id = "";
    expect(await saveAccepted(state)).toBe(false);
  });
});

describe("completion safety", () => {
  it("refuses a stone owned by a different session", () => {
    const { block, state } = fixture();
    state.shots[0].sessionId = "different-session";
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: state.shots[0].id,
      quantity: "speed",
      value: 2.4,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "session_mismatch" } });
  });

  it("refuses when two blocks share one identity", () => {
    const { block, state } = fixture();
    state.blocks.push(structuredClone(block));
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: state.shots[0].id,
      quantity: "speed",
      value: 2.4,
    });
    expect(result).toMatchObject({ ok: false, error: { code: "ambiguous_block" } });
  });

  it("never overwrites a recorded value merely because its target is missing", () => {
    const { block, state } = fixture();
    // Valid speed, plus a recorded 3.9 with no target it was judged against.
    state.shots[0] = {
      ...speedShot(block, 2.4, { sessionId: state.id }),
      releaseTime: 3.9,
    };

    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: state.shots[0].id,
      quantity: "time",
      value: 3.8,
    });

    expect(result).toMatchObject({ ok: false, error: { code: "malformed_shot" } });
    // The recorded value is still exactly what it was.
    expect(state.shots[0].releaseTime).toBe(3.9);
  });

  it("still completes a genuinely missing measurement on a well-formed stone", () => {
    const { block, state } = fixture();
    const result = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: state.shots[0].id,
      quantity: "speed",
      value: 2.4,
    });
    expect(result.ok).toBe(true);
  });
});

describe("writer and reader agree", () => {
  it("refuses to write a stone the reader could not restore", () => {
    const { state } = fixture();
    delete (state.shots[0] as { id?: string }).id;
    expect(serializeTrainingSession(state)).toBeNull();
  });

  it("refuses a non-canonical quantity order rather than silently reordering it", () => {
    const { state } = fixture();
    state.blocks[0].measurement!.quantities = ["speed", "time"];

    // Migration canonicalizes the array, so accepting this at the writer would
    // produce a record whose reader-side equality check can never pass.
    expect(serializeTrainingSession(state)).toBeNull();
  });

  it("round-trips every configuration the writer does accept", () => {
    const { state } = fixture();
    const record = serializeTrainingSession(state);
    expect(record).not.toBeNull();
    const restored = deserializeTrainingSession({ ...record!, contentSha256: "unused" });
    expect(restored).not.toBeNull();
    expect(restored).toEqual(state);
  });
});

describe("wire version follows all measurement-aware content", () => {
  function mixedPlanFinishedDuringStepOne(): Session {
    const legacy = legacyTimeBlock();
    const state = session([legacy], []);
    state.shots = [timeShot(legacy, 3.8, { sessionId: state.id })];

    const speedStep = buildStep();
    const speed = speedBlock();
    speedStep.configuration = {
      ...speedStep.configuration,
      measurement: speed.measurement,
    };
    delete speedStep.configuration.measurementMode;
    delete speedStep.configuration.targetTime;

    state.planExecution = {
      sourcePlanId: "plan",
      sourcePlanName: "Mixed",
      activeStepIndex: 0,
      steps: [
        { step: buildStep(), runtime: { kind: "release-timing-block", blockId: legacy.id } },
        { step: speedStep },
      ],
    };
    return state;
  }

  it("selects version 2 for an unmaterialised future speed step", () => {
    // Every block is legacy, but the archived plan still carries a step an old
    // client's plan validator cannot read — calling it legacy-compatible is untrue.
    const state = mixedPlanFinishedDuringStepOne();
    expect(state.blocks.every((block) => block.measurement === undefined)).toBe(true);
    expect(serializeTrainingSession(state)?.schemaVersion).toBe(
      TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION
    );
  });

  it("reads that record back, so writer and reader agree on the version", () => {
    const state = mixedPlanFinishedDuringStepOne();
    const record = serializeTrainingSession(state);
    expect(
      deserializeTrainingSession({ ...record!, contentSha256: "unused" })
    ).not.toBeNull();
  });

  it("keeps a purely legacy session on version 1 with its bytes unchanged", () => {
    const legacy = legacyTimeBlock();
    const state = session([legacy], []);
    state.shots = [timeShot(legacy, 3.8, { sessionId: state.id })];

    const record = serializeTrainingSession(state);
    expect(record?.schemaVersion).toBe(TRAINING_SESSION_CLOUD_SCHEMA_VERSION);

    const restored = deserializeTrainingSession({ ...record!, contentSha256: "unused" });
    expect(restored).not.toBeNull();
    expect(serializeTrainingSession(restored!)!.payload).toBe(record!.payload);
  });

  it("selects version 2 for an unmaterialised explicit asymmetric time-only step", () => {
    const legacy = legacyTimeBlock();
    const state = session([legacy], []);
    state.shots = [timeShot(legacy, 3.8, { sessionId: state.id })];

    const asymmetricStep = buildStep();
    asymmetricStep.configuration = {
      ...asymmetricStep.configuration,
      measurement: {
        quantities: ["time"],
        time: {
          target: asymmetricStep.configuration.targetTime!,
          tolerance: {
            onTarget: { lower: 0.05, upper: 0.12 },
            acceptable: { lower: 0.1, upper: 0.2 },
          },
        },
      },
    };

    state.planExecution = {
      sourcePlanId: "plan",
      sourcePlanName: "Asymmetric",
      activeStepIndex: 0,
      steps: [
        { step: buildStep(), runtime: { kind: "release-timing-block", blockId: legacy.id } },
        { step: asymmetricStep as ReleaseTimingPlanStep },
      ],
    };

    expect(serializeTrainingSession(state)?.schemaVersion).toBe(
      TRAINING_SESSION_MEASUREMENT_CLOUD_SCHEMA_VERSION
    );
  });
});
