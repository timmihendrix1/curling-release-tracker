// A drift guard. Every Session the application produces must already be in the exact
// property order migration reconstructs, because the terminal cloud record is
// identified by the SHA-256 of its payload bytes and `reconcile` compares both.
//
// This asserts BYTES, not values: value equality cannot detect a reordering, and a
// reordering is precisely what turns an untouched, already-uploaded record into a
// reported conflict after a reload.
//
// Each case builds through the real domain constructors. If a future constructor adds
// a field in the wrong place, or appends one via a spread, it fails here — at the
// point the mistake is made — rather than much later as an unexplained sync issue.
import { describe, expect, it } from "vitest";
import { migrateSession } from "../../sessionMigration";
import { createTrainingBlock } from "../../trainingBlocks";
import { buildMeasuredShot, completeShotMeasurement } from "../operations";
import {
  applyTimingResultToSession,
  cancelCaptureSequence,
  createCaptureSequence,
  pauseCaptureSequence,
  startCaptureSequence,
} from "../../captureSequence";
import {
  advanceToNextPlanStep,
  startPlanExecution,
} from "../../trainingPlans/execution";
import { buildPlan, buildStep } from "../../trainingPlans/__tests__/testHelpers";
import type { Session } from "../../../types";
import { bothBlock, session, speedBlock, timeBlock } from "./measurementFixtures";

/**
 * The invariant: serializing a Session, migrating it, and serializing again must
 * produce the identical string.
 */
function expectCanonical(state: Session): void {
  const before = JSON.stringify(state);
  const after = JSON.stringify(migrateSession(JSON.parse(before)));
  expect(after).toBe(before);
}

function stone(
  block: ReturnType<typeof bothBlock>,
  state: Session,
  input: Record<string, unknown>
) {
  const built = buildMeasuredShot(block, {
    id: `shot-${Math.abs(block.id.length)}-${String(input.id ?? "a")}`,
    sessionId: state.id,
    blockId: block.id,
    shotNumber: 1,
    handle: "in",
    createdAt: state.date,
    ...input,
  } as Parameters<typeof buildMeasuredShot>[1]);
  if (!built.ok) throw new Error(`expected a valid stone: ${built.error.message}`);
  return built.value;
}

describe("blocks produced by createTrainingBlock", () => {
  it.each([
    [
      "Fixed Weight",
      () =>
        createTrainingBlock({
          name: "F",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
        }),
    ],
    [
      "Variable Weight with Smart Random",
      () =>
        createTrainingBlock({
          name: "V",
          mode: "variable",
          measurementMode: "back-hog",
          targetTime: 3.75,
          variableTargetMode: "smart-random",
          smartRandomMin: 2.5,
          smartRandomMax: 4.5,
        }),
    ],
    [
      "Variable Weight with a manual target",
      () =>
        createTrainingBlock({
          name: "V",
          mode: "variable",
          measurementMode: "back-hog",
          targetTime: 3.75,
          variableTargetMode: "manual",
        }),
    ],
    [
      "Blind Weight with a manual target",
      () =>
        createTrainingBlock({
          name: "B",
          mode: "blind",
          measurementMode: "back-hog",
          targetTime: 3.75,
          blindTargetMode: "manual",
        }),
    ],
    ["measurement-aware Both", bothBlock],
    ["measurement-aware Speed only", speedBlock],
    ["measurement-aware Time only", timeBlock],
  ])("%s serializes in canonical order", (_label, build) => {
    const block = build();
    expectCanonical(session([block], []));
  });
});

describe("stones produced by the real operations", () => {
  it.each([
    ["a fully measured Both stone", { time: { value: 3.8, target: 3.75 }, speed: { value: 2.4, target: 2.4, source: "manual" } }],
    ["a Both stone missing its speed", { time: { value: 3.8, target: 3.75 } }],
    ["a Both stone missing its time", { speed: { value: 2.4, target: 2.4, source: "manual" } }],
    ["a stone carrying every optional field", {
      time: { value: 3.8, target: 3.75, source: "external" },
      speed: { value: 2.4, target: 2.4, source: "manual", recordedAt: "2026-10-06T10:05:00.000Z" },
      shotType: "draw",
      comment: "note",
      captureSequenceId: "seq-1",
      timingResultId: "res-1",
      deviceId: "dev-1",
      laneId: "lane-1",
    }],
  ])("%s serializes in canonical order", (_label, input) => {
    const block = bothBlock();
    const state = session([block], []);
    state.shots = [stone(block, state, input as Record<string, unknown>)];
    expectCanonical(state);
  });

  it.each([
    ["speed added to a time-first stone", "speed" as const, 2.4],
    ["time added to a speed-first stone", "time" as const, 3.8],
  ])("%s stays canonical after explicit completion", (_label, quantity, value) => {
    const block = bothBlock();
    const state = session([block], []);
    state.shots = [
      stone(
        block,
        state,
        quantity === "speed"
          ? { time: { value: 3.8, target: 3.75 } }
          : { speed: { value: 2.4, target: 2.4, source: "manual" } }
      ),
    ];

    const completed = completeShotMeasurement(state, {
      sessionId: state.id,
      blockId: block.id,
      shotId: state.shots[0].id,
      quantity,
      value,
      source: "manual",
      recordedAt: "2026-10-06T10:05:00.000Z",
    });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    expectCanonical(completed.value.session);
  });
});

describe("capture sequences", () => {
  function captured() {
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
    if (applied.outcome.status !== "accepted") throw new Error("expected acceptance");
    return applied.session;
  }

  it("a captured stone serializes in canonical order", () => {
    // The sequence itself is still running, which migration deliberately pauses on
    // load — so only the stones and blocks are compared here.
    const state = captured();
    expectCanonical({ ...state, captureSequence: undefined });
  });

  it("a paused sequence is fully canonical", () => {
    const state = captured();
    expectCanonical({
      ...state,
      captureSequence: pauseCaptureSequence(state.captureSequence!),
    });
  });

  it("a finished (cancelled) sequence is fully canonical", () => {
    const state = captured();
    expectCanonical({
      ...state,
      captureSequence: cancelCaptureSequence(state.captureSequence!),
    });
  });
});

describe("plan executions", () => {
  it("a started plan serializes in canonical order", () => {
    const block = bothBlock();
    const state = session([block], []);
    state.planExecution = startPlanExecution(
      buildPlan({ steps: [buildStep(), buildStep()] }),
      { kind: "release-timing-block", blockId: block.id }
    );
    expectCanonical(state);
  });

  it("an advanced plan stays canonical", () => {
    const first = bothBlock();
    const secondBlock = createTrainingBlock({
      name: "Second",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
    });
    const state = session([first, secondBlock], []);
    state.activeBlockId = secondBlock.id;

    const started = startPlanExecution(
      buildPlan({ steps: [buildStep(), buildStep()] }),
      { kind: "release-timing-block", blockId: first.id }
    );
    state.planExecution = advanceToNextPlanStep(started, {
      kind: "release-timing-block",
      blockId: secondBlock.id,
    });

    expectCanonical(state);
  });
});
