// @vitest-environment jsdom
//
// Active training must persist. An accepted timing result is saved IMMEDIATELY, while
// capture is still running — never deferred until the sequence pauses or completes —
// and a reload brings every stone back with capture paused, requiring an explicit
// Resume (ADR-0006).
//
// The distinction this file guards: pausing a running sequence on load is an
// intentional recovery transition, not evidence that the stored session was malformed.
// Validation of the persisted representation and that lifecycle decision are separate
// concerns, and conflating them refuses to save legitimate active training.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
} from "../../sessionRepository";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import {
  applyTimingResultToSession,
  cancelCaptureSequence,
  createCaptureSequence,
  pauseCaptureSequence,
  resumeCaptureSequence,
  startCaptureSequence,
} from "../../captureSequence";
import {
  deserializeTrainingSession,
  serializeTrainingSession,
} from "../../cloudSporting/records";
import { buildStep } from "../../trainingPlans/__tests__/testHelpers";
import type { Session, TimingResult } from "../../../types";
import {
  bothBlock,
  legacyTimeBlock,
  session,
  speedBlock,
  timeBlock,
} from "./measurementFixtures";

function runningSession(build: () => ReturnType<typeof bothBlock>): Session {
  const block = build();
  const state = session([block], []);
  state.captureSequence = startCaptureSequence(
    createCaptureSequence({
      session: state,
      block,
      expectedShotCount: 8,
      providerType: "simulator",
      handleMode: "manual",
    })
  );
  return state;
}

function timingResult(id: string, value: number): TimingResult {
  return {
    id,
    source: "simulator",
    receivedAt: "2026-10-06T10:05:00.000Z",
    measurements: [{ measurementMode: "back-hog", value }],
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe.each([
  ["explicit Time", timeBlock],
  ["Both", bothBlock],
])("%s capture persists while running", (_label, build) => {
  it("saves a valid running sequence", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    expect(await repository.saveCurrent(runningSession(build))).toEqual({ ok: true });
  });

  it("saves each accepted result immediately, without pausing or completing first", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    let state = runningSession(build);

    for (const [index, value] of [3.7, 3.82].entries()) {
      const applied = applyTimingResultToSession({
        session: state,
        result: timingResult(`result-${index}`, value),
        manualHandleOverride: "in",
      });

      expect(applied.outcome.status).toBe("accepted");
      state = applied.session;

      // Still running, and already durable.
      expect(state.captureSequence?.status).toBe("running");
      expect(state.shots).toHaveLength(index + 1);
      expect(await repository.saveCurrent(state)).toEqual({ ok: true });
    }
  });

  it("reloads as paused with every stone, target, identity and provenance intact", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const applied = applyTimingResultToSession({
      session: runningSession(build),
      result: timingResult("result-1", 3.7),
      manualHandleOverride: "in",
    });
    expect(applied.outcome.status).toBe("accepted");
    expect(await repository.saveCurrent(applied.session)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    expect(reloaded.status).toBe("value");
    if (reloaded.status !== "value") return;

    // Automatic capture never silently keeps listening after a reload.
    expect(reloaded.value.captureSequence?.status).toBe("paused");
    expect(reloaded.value.captureSequence?.pausedAt).toBeDefined();
    // Everything the athlete recorded survives untouched.
    expect(reloaded.value.shots).toEqual(applied.session.shots);
    expect(reloaded.value.shots[0].measurementSource).toBe("simulator");
    expect(reloaded.value.shots[0].timingResultId).toBe("result-1");
    expect(reloaded.value.captureSequence?.id).toBe(applied.session.captureSequence?.id);
    expect(reloaded.value.captureSequence?.steps).toEqual(
      applied.session.captureSequence?.steps
    );
  });

  it("resumes from the reloaded state and keeps rejecting duplicate results", async () => {
    const repository = createSessionRepository(createLocalStorageAdapter());
    const applied = applyTimingResultToSession({
      session: runningSession(build),
      result: timingResult("result-1", 3.7),
      manualHandleOverride: "in",
    });
    await repository.saveCurrent(applied.session);

    const reloaded = await repository.loadCurrent();
    if (reloaded.status !== "value") throw new Error("expected a value");

    const resumed: Session = {
      ...reloaded.value,
      captureSequence: resumeCaptureSequence(reloaded.value.captureSequence!),
    };
    expect(resumed.captureSequence?.status).toBe("running");
    expect(await repository.saveCurrent(resumed)).toEqual({ ok: true });

    // The already-processed result id is still a duplicate after the round trip.
    const replay = applyTimingResultToSession({
      session: resumed,
      result: timingResult("result-1", 3.7),
      manualHandleOverride: "in",
    });
    expect(replay.outcome.status).toBe("duplicate");
    expect(replay.session.shots).toHaveLength(1);
  });

  it("keeps the stone when a save fails and succeeds on retry", async () => {
    let failNext = true;
    const repository = createSessionRepository({
      async get(key) {
        return { status: "value", value: window.localStorage.getItem(key) };
      },
      async set(key, value) {
        if (failNext) {
          failNext = false;
          return { ok: false, error: { kind: "storage_unavailable" } };
        }
        window.localStorage.setItem(key, value);
        return { ok: true };
      },
    });

    const applied = applyTimingResultToSession({
      session: runningSession(build),
      result: timingResult("result-1", 3.7),
      manualHandleOverride: "in",
    });

    expect((await repository.saveCurrent(applied.session)).ok).toBe(false);
    expect(await repository.saveCurrent(applied.session)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    if (reloaded.status !== "value") throw new Error("expected a value");
    expect(reloaded.value.shots).toHaveLength(1);
  });

  it("archives cleanly after an early finish, and that record round-trips the cloud", () => {
    const applied = applyTimingResultToSession({
      session: runningSession(build),
      result: timingResult("result-1", 3.7),
      manualHandleOverride: "in",
    });

    // Finishing ends the capture, exactly as the confirmation promises.
    const archived: Session = {
      ...applied.session,
      captureSequence: cancelCaptureSequence(applied.session.captureSequence!),
    };

    const record = serializeTrainingSession(archived);
    expect(record).not.toBeNull();
    const restored = deserializeTrainingSession({ ...record!, contentSha256: "unused" });
    expect(restored).not.toBeNull();
    expect(serializeTrainingSession(restored!)!.payload).toBe(record!.payload);
  });
});

describe("paused and malformed capture state", () => {
  it("saves an explicitly paused sequence unchanged", async () => {
    const state = runningSession(bothBlock);
    state.captureSequence = pauseCaptureSequence(state.captureSequence!);

    const repository = createSessionRepository(createLocalStorageAdapter());
    expect(await repository.saveCurrent(state)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    if (reloaded.status !== "value") throw new Error("expected a value");
    expect(reloaded.value).toEqual(state);
  });

  it.each([
    [
      "a sequence pointing at an exercise that is not in this training",
      (s: Session) => {
        s.captureSequence!.blockId = "missing-block";
      },
    ],
    [
      "a captured-shot count that does not match the recorded stones",
      (s: Session) => {
        s.captureSequence!.capturedShotCount = 7;
      },
    ],
    [
      "an expected shot count that is not a positive whole number",
      (s: Session) => {
        s.captureSequence!.expectedShotCount = 0;
      },
    ],
  ])("still protects %s", async (_label, mutate) => {
    const state = runningSession(bothBlock);
    mutate(state);

    const repository = createSessionRepository(createLocalStorageAdapter());
    expect((await repository.saveCurrent(state)).ok).toBe(false);
    expect(window.localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("refuses a running sequence on a block that measures no time", async () => {
    // A timing device measures an interval; a speed-only block has none, so a capture
    // sequence over it could never accept a result.
    const block = speedBlock();
    const state = session([block], []);
    state.captureSequence = startCaptureSequence(
      createCaptureSequence({
        session: state,
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "manual",
      })
    );

    const applied = applyTimingResultToSession({
      session: state,
      result: timingResult("result-1", 3.7),
      manualHandleOverride: "in",
    });
    expect(applied.outcome.status).toBe("measurement-mode-mismatch");
    expect(applied.session.shots).toHaveLength(0);
  });
});

describe("a mixed plan whose current block is legacy but whose future step is not", () => {
  it("persists a running capture on the legacy block and reloads it paused", async () => {
    const legacy = legacyTimeBlock();
    const state = session([legacy], []);

    const speedStep = buildStep();
    speedStep.configuration = {
      ...speedStep.configuration,
      measurement: speedBlock().measurement,
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
    state.captureSequence = startCaptureSequence(
      createCaptureSequence({
        session: state,
        block: legacy,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "manual",
      })
    );

    const applied = applyTimingResultToSession({
      session: state,
      result: timingResult("result-1", 3.7),
      manualHandleOverride: "in",
    });
    expect(applied.outcome.status).toBe("accepted");

    const repository = createSessionRepository(createLocalStorageAdapter());
    expect(await repository.saveCurrent(applied.session)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    if (reloaded.status !== "value") throw new Error("expected a value");
    expect(reloaded.value.captureSequence?.status).toBe("paused");
    expect(reloaded.value.shots).toHaveLength(1);
    expect(reloaded.value.planExecution).toEqual(applied.session.planExecution);
  });
});

describe("legacy sessions keep their existing behaviour", () => {
  it("saves and reloads a legacy running capture exactly as before", async () => {
    const legacy = legacyTimeBlock();
    const state = session([legacy], []);
    state.captureSequence = startCaptureSequence(
      createCaptureSequence({
        session: state,
        block: legacy,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "manual",
      })
    );

    const repository = createSessionRepository(createLocalStorageAdapter());
    expect(await repository.saveCurrent(state)).toEqual({ ok: true });

    const reloaded = await repository.loadCurrent();
    if (reloaded.status !== "value") throw new Error("expected a value");
    expect(reloaded.value.captureSequence?.status).toBe("paused");
  });
});
