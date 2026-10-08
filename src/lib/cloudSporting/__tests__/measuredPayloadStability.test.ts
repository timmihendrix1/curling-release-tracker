// @vitest-environment jsdom
//
// A terminal cloud record is identified by the SHA-256 of its exact payload bytes, and
// `reconcile` compares both. So an already-uploaded, UNMODIFIED record must serialize
// byte-identically every time the app reloads its local history — otherwise it is
// reported as a conflict the athlete never caused.
//
// The subtle failure this guards is property ORDER: values can be identical while the
// bytes differ, because a Session constructed by a domain operation and the same
// Session reconstructed by migration used to emit their properties in different
// orders. These tests therefore build stones with the REAL constructors and completion
// operations — never a fixture pre-arranged in migration's preferred order — and drive
// them through the real repositories and sync manager.
import { beforeEach, describe, expect, it } from "vitest";
import {
  createProfileScopedSportingRepositories,
  createProfileScopedSportingStorageAdapter,
} from "../../persistence/profileScopedSportingPersistence";
import { createSportingSyncStateRepository } from "../syncStateRepository";
import { SportingCloudSyncManager } from "../syncManager";
import {
  deserializeTrainingSession,
  serializeTrainingSession,
  sha256Hex,
} from "../records";
import type { CloudSportingRecord } from "../types";
import { buildMeasuredShot, completeShotMeasurement } from "../../measurement/operations";
import {
  applyTimingResultToSession,
  cancelCaptureSequence,
  createCaptureSequence,
  pauseCaptureSequence,
  pauseCaptureSequenceWithError,
  resumeCaptureSequence,
  startCaptureSequence,
} from "../../captureSequence";
import { buildPlan, buildStep } from "../../trainingPlans/__tests__/testHelpers";
import { startPlanExecution } from "../../trainingPlans/execution";
import { addTrainingBlock } from "../../trainingBlocks";
import type { Session, Shot } from "../../../types";
import {
  bothBlock,
  legacyTimeBlock,
  session,
  speedBlock,
  timeBlock,
} from "../../measurement/__tests__/measurementFixtures";

const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

function memoryAdapter() {
  const values = new Map<string, string>();
  return {
    values,
    async get(key: string) {
      return { status: "value" as const, value: values.get(key) ?? null };
    },
    async set(key: string, value: string) {
      values.set(key, value);
      return { ok: true as const };
    },
  };
}

/** An in-memory stand-in for the terminal-record store, digesting exactly as the real one does. */
function memoryCloud() {
  const remote = new Map<string, CloudSportingRecord>();
  return {
    remote,
    service: {
      async restore() {
        return { ok: true as const, value: [...remote.values()] };
      },
      async put(record: Omit<CloudSportingRecord, "contentSha256">) {
        const contentSha256 = await sha256Hex(record.payload);
        remote.set(record.recordId, { ...record, contentSha256: contentSha256 as string });
        return {
          ok: true as const,
          value: { outcome: "inserted" as const, contentSha256: contentSha256 as string },
        };
      },
      async delete() {
        return { ok: false as const, error: "unavailable" };
      },
    },
  };
}

async function newManager(adapter: ReturnType<typeof memoryAdapter>, cloud: ReturnType<typeof memoryCloud>) {
  const repositories = createProfileScopedSportingRepositories(PROFILE_ID, adapter);
  const stateRepository = createSportingSyncStateRepository(
    createProfileScopedSportingStorageAdapter(PROFILE_ID, adapter)
  );
  const manager = new SportingCloudSyncManager(
    repositories,
    stateRepository,
    cloud.service as never,
    () => true
  );
  await manager.initialize();
  return manager;
}

/** Builds a stone through the real domain constructor, never a hand-ordered literal. */
function measuredShot(
  block: ReturnType<typeof bothBlock>,
  state: Session,
  input: Partial<Parameters<typeof buildMeasuredShot>[1]> & { id: string }
): Shot {
  const result = buildMeasuredShot(block, {
    sessionId: state.id,
    blockId: block.id,
    shotNumber: 1,
    handle: "in",
    createdAt: state.date,
    ...input,
  } as Parameters<typeof buildMeasuredShot>[1]);
  if (!result.ok) throw new Error(`expected a valid stone: ${result.error.message}`);
  return result.value;
}

// --- The sessions under test, each built the way the application builds them --------

function bothSession(): Session {
  const block = bothBlock();
  const state = session([block], []);
  state.shots = [
    measuredShot(block, state, {
      id: "33333333-3333-4333-8333-333333333331",
      time: { value: 3.8, target: 3.75 },
      speed: { value: 2.4, target: 2.4, source: "manual" },
    }),
  ];
  return state;
}

function timeOnlySession(): Session {
  const block = timeBlock();
  const state = session([block], []);
  state.shots = [
    measuredShot(block, state, {
      id: "33333333-3333-4333-8333-333333333332",
      time: { value: 3.8, target: 3.75 },
    }),
  ];
  return state;
}

function speedOnlySession(): Session {
  const block = speedBlock();
  const state = session([block], []);
  state.shots = [
    measuredShot(block, state, {
      id: "33333333-3333-4333-8333-333333333333",
      speed: { value: 2.4, target: 2.4, source: "manual" },
    }),
  ];
  return state;
}

function partialMissingSpeedSession(): Session {
  const block = bothBlock();
  const state = session([block], []);
  state.shots = [
    measuredShot(block, state, {
      id: "33333333-3333-4333-8333-333333333334",
      time: { value: 3.8, target: 3.75 },
    }),
  ];
  return state;
}

function partialMissingTimeSession(): Session {
  const block = bothBlock();
  const state = session([block], []);
  state.shots = [
    measuredShot(block, state, {
      id: "33333333-3333-4333-8333-333333333335",
      speed: { value: 2.4, target: 2.4, source: "manual" },
    }),
  ];
  return state;
}

/** A partial stone whose missing half was added later by explicit completion. */
function completedSpeedSession(): Session {
  const state = partialMissingSpeedSession();
  const completed = completeShotMeasurement(state, {
    sessionId: state.id,
    blockId: state.blocks[0].id,
    shotId: state.shots[0].id,
    quantity: "speed",
    value: 2.4,
    source: "manual",
    recordedAt: "2026-10-06T10:05:00.000Z",
  });
  if (!completed.ok) throw new Error("expected completion to succeed");
  return completed.value.session;
}

function completedTimeSession(): Session {
  const state = partialMissingTimeSession();
  const completed = completeShotMeasurement(state, {
    sessionId: state.id,
    blockId: state.blocks[0].id,
    shotId: state.shots[0].id,
    quantity: "time",
    value: 3.8,
    source: "external",
  });
  if (!completed.ok) throw new Error("expected completion to succeed");
  return completed.value.session;
}

/** A still-running capture with one accepted stone, before any ending transition. */
function finishedCaptureRaw(): Session {
  const block = bothBlock();
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
    result: {
      id: "result-1",
      source: "simulator",
      receivedAt: "2026-10-06T10:05:00.000Z",
      measurements: [{ measurementMode: "back-hog", value: 3.8 }],
    },
    manualHandleOverride: "in",
  });
  if (applied.outcome.status !== "accepted") throw new Error("expected an accepted result");
  return applied.session;
}

/** A finished capture: stones recorded through the timing boundary, sequence ended. */
function finishedCaptureSession(): Session {
  const state = finishedCaptureRaw();
  return {
    ...state,
    captureSequence: cancelCaptureSequence(state.captureSequence!),
  };
}

/** A mixed plan whose current block is legacy but whose future step declares speed. */
function mixedPlanSession(): Session {
  const legacy = legacyTimeBlock();
  const state = session([legacy], []);

  const speedStep = buildStep();
  speedStep.configuration = {
    ...speedStep.configuration,
    measurement: speedBlock().measurement,
  };
  delete speedStep.configuration.measurementMode;
  delete speedStep.configuration.targetTime;

  // Built through the real constructor, so the plan snapshot carries whatever shape
  // the application actually produces — not one arranged by hand.
  state.planExecution = startPlanExecution(
    buildPlan({ name: "Mixed", steps: [buildStep(), speedStep] }),
    { kind: "release-timing-block", blockId: legacy.id }
  );
  return state;
}

function legacySession(): Session {
  const legacy = legacyTimeBlock();
  const state = session([legacy], []);
  state.shots = [
    {
      id: "33333333-3333-4333-8333-333333333339",
      sessionId: state.id,
      blockId: legacy.id,
      shotNumber: 1,
      releaseTime: 3.8,
      targetTime: 3.75,
      handle: "in",
      createdAt: state.date,
    },
  ];
  return state;
}

/**
 * Sequences where a LATER domain transition — not the constructor — reorders the
 * Session. Each of these uploaded cleanly and then reported a conflict on the next
 * reload, with no sporting-data edit:
 *   - `addTrainingBlock` appends `completedAt` to the outgoing block;
 *   - attaching a plan puts `planExecution` before `captureSequence`;
 *   - `pauseCaptureSequenceWithError` adds `lastError` before `cancelledAt`.
 */
function nextBlockSession(): Session {
  return addTrainingBlock(bothSession(), {
    name: "Next",
    mode: "fixed",
    measurementMode: "back-hog",
    targetTime: 3.75,
  });
}

function twoBlockTransitionsSession(): Session {
  const first = addTrainingBlock(bothSession(), {
    name: "Second",
    mode: "fixed",
    measurementMode: "back-hog",
    targetTime: 3.75,
  });
  return addTrainingBlock(first, {
    name: "Third",
    mode: "variable",
    measurementMode: "back-hog",
    targetTime: 3.75,
    variableTargetMode: "smart-random",
    smartRandomMin: 2.5,
    smartRandomMax: 4.5,
  });
}

/** A planned Session that then ran, captured and finished a sequence. */
function planThenCaptureSession(): Session {
  const state = bothSession();
  const step = buildStep();
  step.configuration = {
    ...step.configuration,
    measurement: state.blocks[0].measurement,
  };

  state.planExecution = startPlanExecution(buildPlan({ steps: [step] }), {
    kind: "release-timing-block",
    blockId: state.blocks[0].id,
  });
  state.captureSequence = startCaptureSequence(
    createCaptureSequence({
      session: state,
      block: state.blocks[0],
      expectedShotCount: 4,
      providerType: "simulator",
      handleMode: "manual",
    })
  );

  const applied = applyTimingResultToSession({
    session: state,
    result: {
      id: "plan-capture",
      source: "simulator",
      receivedAt: "2026-10-06T10:05:00.000Z",
      measurements: [{ measurementMode: "back-hog", value: 3.8 }],
    },
    manualHandleOverride: "in",
  });
  if (applied.outcome.status !== "accepted") throw new Error("expected acceptance");

  return {
    ...applied.session,
    captureSequence: cancelCaptureSequence(applied.session.captureSequence!),
  };
}

/** A capture interrupted by an unexpected error, then ended by finishing. */
function interruptedThenFinishedCaptureSession(): Session {
  const state = finishedCaptureRaw();
  return {
    ...state,
    captureSequence: cancelCaptureSequence(
      pauseCaptureSequenceWithError(state.captureSequence!, "Transport interrupted")
    ),
  };
}

/** A capture paused and resumed before finishing. */
function pausedResumedCaptureSession(): Session {
  const state = finishedCaptureRaw();
  return {
    ...state,
    captureSequence: cancelCaptureSequence(
      resumeCaptureSequence(pauseCaptureSequence(state.captureSequence!))
    ),
  };
}

/** A Session carrying a plan, a finished capture AND a completed measurement. */
function mixedFieldsSession(): Session {
  const state = planThenCaptureSession();
  const block = state.blocks[0];
  const extra = measuredShot(block, state, {
    id: "33333333-3333-4333-8333-33333333333a",
    speed: { value: 2.4, target: 2.4, source: "manual" },
  });
  const withExtra: Session = { ...state, shots: [...state.shots, extra] };

  const completed = completeShotMeasurement(withExtra, {
    sessionId: withExtra.id,
    blockId: block.id,
    shotId: extra.id,
    quantity: "time",
    value: 3.9,
    source: "manual",
  });
  if (!completed.ok) throw new Error("expected completion to succeed");
  return completed.value.session;
}

const CASES: Record<string, () => Session> = {
  "a later block transition": nextBlockSession,
  "two successive block transitions": twoBlockTransitionsSession,
  "a plan, then capture, then finish": planThenCaptureSession,
  "a capture interrupted by an error, then finished": interruptedThenFinishedCaptureSession,
  "a capture paused, resumed, then finished": pausedResumedCaptureSession,
  "a plan, a finished capture and a completed measurement together": mixedFieldsSession,
  "Both, fully measured": bothSession,
  "explicit Time only": timeOnlySession,
  "Speed only": speedOnlySession,
  "Both missing its speed": partialMissingSpeedSession,
  "Both missing its time": partialMissingTimeSession,
  "speed added by explicit completion": completedSpeedSession,
  "time added by explicit completion": completedTimeSession,
  "a finished capture": finishedCaptureSession,
  "a mixed plan with a future speed step": mixedPlanSession,
  "legacy time-only": legacySession,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe.each(Object.entries(CASES))("%s", (_label, build) => {
  it("serializes identically after a local history reload", async () => {
    const adapter = memoryAdapter();
    const repositories = createProfileScopedSportingRepositories(PROFILE_ID, adapter);
    const original = build();

    const before = serializeTrainingSession(original);
    expect(before).not.toBeNull();

    expect((await repositories.session.saveHistory([original])).ok).toBe(true);

    const reloaded = await repositories.session.loadHistory();
    expect(reloaded.status).toBe("value");
    if (reloaded.status !== "value") return;

    // Byte-for-byte, not merely value-equal: the sync contract compares payloads.
    expect(serializeTrainingSession(reloaded.value[0])!.payload).toBe(before!.payload);
    expect(await sha256Hex(serializeTrainingSession(reloaded.value[0])!.payload)).toBe(
      await sha256Hex(before!.payload)
    );
  });

  it("stays synced through upload, reload and resynchronisation", async () => {
    const adapter = memoryAdapter();
    const cloud = memoryCloud();
    const manager = await newManager(adapter, cloud);
    expect(manager.getSnapshot().truth).toBe("synced");

    expect(
      (await manager.decorateRepositories().session.saveHistory([build()])).ok
    ).toBe(true);
    await manager.synchronize();
    expect(cloud.remote.size).toBe(1);
    expect(manager.getSnapshot().truth).toBe("synced");

    // A fresh manager over the same storage: history is reloaded through migration,
    // then reconciled against what is already uploaded. No user change happened.
    const reopened = await newManager(adapter, cloud);
    await reopened.synchronize();
    expect(reopened.getSnapshot().truth).toBe("synced");

    // And again — repeated reloads must not drift either.
    const reopenedAgain = await newManager(adapter, cloud);
    await reopenedAgain.synchronize();
    expect(reopenedAgain.getSnapshot().truth).toBe("synced");
  });

  it("survives a cloud restore into local storage and back out again", async () => {
    const seedAdapter = memoryAdapter();
    const cloud = memoryCloud();
    const seedManager = await newManager(seedAdapter, cloud);
    await seedManager.decorateRepositories().session.saveHistory([build()]);
    await seedManager.synchronize();

    const uploaded = [...cloud.remote.values()][0];

    // A different device: empty local storage, restoring from the cloud.
    const freshAdapter = memoryAdapter();
    const restoredManager = await newManager(freshAdapter, cloud);
    await restoredManager.synchronize();
    expect(restoredManager.getSnapshot().truth).toBe("synced");

    // The restored record is byte-identical to the one that was uploaded.
    const restoredRepositories = createProfileScopedSportingRepositories(
      PROFILE_ID,
      freshAdapter
    );
    const history = await restoredRepositories.session.loadHistory();
    expect(history.status).toBe("value");
    if (history.status !== "value") return;
    expect(serializeTrainingSession(history.value[0])!.payload).toBe(uploaded.payload);
  });
});

/**
 * Re-identifies a built Session so two fixtures can coexist in one history. Overwrites
 * existing keys only, so every property keeps its position.
 */
function withSessionId(state: Session, id: string): Session {
  return {
    ...state,
    id,
    shots: state.shots.map((shot) => ({ ...shot, sessionId: id })),
  };
}

/**
 * A valid version-1 payload a previous producer could have uploaded: `handle` and
 * `createdAt` before the measurements, and the Smart Random fields after the tolerance
 * snapshot. Its bytes and digest are authoritative and must never change.
 */
async function earlierProducerRecord(): Promise<CloudSportingRecord> {
  const blockId = "41fecda3-ab2d-47d9-b985-ccc5d386067f";
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const payload = JSON.stringify({
    id: sessionId,
    title: "Older ordering",
    date: "2026-01-01T00:00:00.000Z",
    notes: "",
    blocks: [
      {
        id: blockId,
        name: "V",
        mode: "variable",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: "2026-01-01T00:00:00.000Z",
        variableTargetMode: "smart-random",
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        smartRandomMin: 2.5,
        smartRandomMax: 4.5,
        pendingTargetTime: 3.6,
      },
    ],
    activeBlockId: blockId,
    shots: [
      {
        id: "s1",
        sessionId,
        blockId,
        shotNumber: 1,
        handle: "in",
        createdAt: "2026-01-01T00:00:01.000Z",
        releaseTime: 3.8,
        targetTime: 3.75,
      },
    ],
  });

  return {
    recordKind: "training_session",
    recordId: sessionId,
    schemaVersion: 1,
    payload,
    recordedAt: "2026-01-01T00:00:00.000Z",
    contentSha256: (await sha256Hex(payload))!,
  };
}

describe("ordering is applied at the persistence boundary, not per constructor", () => {
  it("stays stable no matter how many later transitions reshaped the Session", async () => {
    // The point of applying canonical order where a Session becomes a persisted
    // representation — rather than inside each constructor — is that no future object
    // spread has to remember a field order. This exercises a long chain.
    const adapter = memoryAdapter();
    const cloud = memoryCloud();
    const manager = await newManager(adapter, cloud);

    const built = mixedFieldsSession();
    const afterTransition = addTrainingBlock(built, {
      name: "Even later",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
    });

    await manager.decorateRepositories().session.saveHistory([afterTransition]);
    await manager.synchronize();
    expect(manager.getSnapshot().truth).toBe("synced");

    for (let reopen = 0; reopen < 3; reopen += 1) {
      const reopened = await newManager(adapter, cloud);
      await reopened.synchronize();
      expect(reopened.getSnapshot().truth).toBe("synced");
    }
  });

  it("reproduces an older record's exact bytes and digest on deserialize then serialize", async () => {
    const record = await earlierProducerRecord();
    const restored = deserializeTrainingSession(record);
    expect(restored).not.toBeNull();

    const encoded = serializeTrainingSession(restored!);
    expect(encoded).not.toBeNull();
    // Bytes and digest, not merely equal values: this is what makes an already
    // authoritative payload immutable in practice rather than only in intent.
    expect(encoded!.payload).toBe(record.payload);
    expect(await sha256Hex(encoded!.payload)).toBe(record.contentSha256);
  });
});

describe("an existing authoritative payload is never rewritten", () => {
  it("keeps its exact bytes in local storage when the restored record is saved", async () => {
    const record = await earlierProducerRecord();
    const restored = deserializeTrainingSession(record)!;

    const adapter = memoryAdapter();
    const repositories = createProfileScopedSportingRepositories(PROFILE_ID, adapter);
    expect((await repositories.session.saveHistory([restored])).ok).toBe(true);

    const storedHistory = [...adapter.values.values()]
      .map((value) => JSON.parse(value))
      .find((value) => Array.isArray(value) && value[0]?.id === record.recordId);
    expect(JSON.stringify(storedHistory[0])).toBe(record.payload);
  });

  it("still reproduces those bytes after a local reload", async () => {
    const record = await earlierProducerRecord();
    const restored = deserializeTrainingSession(record)!;

    const adapter = memoryAdapter();
    const repositories = createProfileScopedSportingRepositories(PROFILE_ID, adapter);
    await repositories.session.saveHistory([restored]);

    const reloaded = await repositories.session.loadHistory();
    expect(reloaded.status).toBe("value");
    if (reloaded.status !== "value") return;

    const encoded = serializeTrainingSession(reloaded.value[0])!;
    expect(encoded.payload).toBe(record.payload);
    expect(await sha256Hex(encoded.payload)).toBe(record.contentSha256);
  });

  it("restores onto a fresh device and resynchronises without a false issue", async () => {
    const record = await earlierProducerRecord();
    const cloud = memoryCloud();
    cloud.remote.set(record.recordId, record);

    const adapter = memoryAdapter();
    const manager = await newManager(adapter, cloud);
    expect(manager.getSnapshot().truth).toBe("synced");
    await manager.synchronize();
    expect(manager.getSnapshot().truth).toBe("synced");

    // The remote record is untouched: same bytes, same digest, same identity.
    expect(cloud.remote.get(record.recordId)).toEqual(record);

    // And reopening with the acknowledged receipt already in place stays clean.
    const reopened = await newManager(adapter, cloud);
    await reopened.synchronize();
    expect(reopened.getSnapshot().truth).toBe("synced");
    expect(cloud.remote.get(record.recordId)!.payload).toBe(record.payload);
    expect(cloud.remote.get(record.recordId)!.contentSha256).toBe(record.contentSha256);
  });

  it("is unaffected by archiving a new training alongside it", async () => {
    const record = await earlierProducerRecord();
    const cloud = memoryCloud();
    cloud.remote.set(record.recordId, record);

    const adapter = memoryAdapter();
    const manager = await newManager(adapter, cloud);
    await manager.synchronize();

    // A brand-new training is archived into the same history.
    const repositories = createProfileScopedSportingRepositories(PROFILE_ID, adapter);
    const existing = await repositories.session.loadHistory();
    if (existing.status !== "value") throw new Error("expected restored history");

    // A distinct identity: the fixtures otherwise share one session id, which would
    // make this a single record rather than two.
    const fresh = withSessionId(
      nextBlockSession(),
      "44444444-4444-4444-8444-444444444444"
    );
    await manager
      .decorateRepositories()
      .session.saveHistory([fresh, ...existing.value]);
    await manager.synchronize();

    expect(manager.getSnapshot().truth).toBe("synced");
    expect(cloud.remote.size).toBe(2);
    // The older record kept its exact bytes and digest throughout.
    expect(cloud.remote.get(record.recordId)!.payload).toBe(record.payload);
    expect(cloud.remote.get(record.recordId)!.contentSha256).toBe(record.contentSha256);

    const reloaded = await repositories.session.loadHistory();
    if (reloaded.status !== "value") throw new Error("expected history");
    const older = reloaded.value.find((entry) => entry.id === record.recordId)!;
    expect(serializeTrainingSession(older)!.payload).toBe(record.payload);
  });

  it("still reports a conflict when an older record is genuinely edited", async () => {
    const record = await earlierProducerRecord();
    const cloud = memoryCloud();
    cloud.remote.set(record.recordId, record);

    const adapter = memoryAdapter();
    const manager = await newManager(adapter, cloud);
    await manager.synchronize();
    expect(manager.getSnapshot().truth).toBe("synced");

    const repositories = createProfileScopedSportingRepositories(PROFILE_ID, adapter);
    const history = await repositories.session.loadHistory();
    if (history.status !== "value") throw new Error("expected history");

    // A real edit to immutable content — preserving order must never hide this.
    const edited: Session = {
      ...history.value[0],
      shots: [{ ...history.value[0].shots[0], releaseTime: 9.99 }],
    };

    const reopened = await newManager(adapter, cloud);
    await reopened.decorateRepositories().session.saveHistory([edited]);
    await reopened.synchronize();

    expect(reopened.getSnapshot().truth).toBe("sync_issue");
    // The remote record itself is never overwritten by the edit.
    expect(cloud.remote.get(record.recordId)!.payload).toBe(record.payload);
  });
});

describe("conflict protection is not weakened", () => {
  it("still reports an issue when the content genuinely changed", async () => {
    const adapter = memoryAdapter();
    const cloud = memoryCloud();
    const manager = await newManager(adapter, cloud);

    const original = bothSession();
    await manager.decorateRepositories().session.saveHistory([original]);
    await manager.synchronize();
    expect(manager.getSnapshot().truth).toBe("synced");

    // A real edit to an already-uploaded terminal record — exactly what the
    // immutable-record comparison exists to catch.
    const tampered: Session = {
      ...original,
      shots: [{ ...original.shots[0], releaseTime: 9.99 }],
    };

    const reopened = await newManager(adapter, cloud);
    await reopened.decorateRepositories().session.saveHistory([tampered]);
    await reopened.synchronize();

    expect(reopened.getSnapshot().truth).toBe("sync_issue");
  });

  it("keeps an existing immutable payload byte-identical across restore and re-upload", async () => {
    const adapter = memoryAdapter();
    const cloud = memoryCloud();
    const manager = await newManager(adapter, cloud);

    await manager.decorateRepositories().session.saveHistory([legacySession()]);
    await manager.synchronize();

    const uploadedPayload = [...cloud.remote.values()][0].payload;
    const uploadedDigest = [...cloud.remote.values()][0].contentSha256;

    const reopened = await newManager(adapter, cloud);
    await reopened.synchronize();

    expect([...cloud.remote.values()][0].payload).toBe(uploadedPayload);
    expect([...cloud.remote.values()][0].contentSha256).toBe(uploadedDigest);
  });
});
