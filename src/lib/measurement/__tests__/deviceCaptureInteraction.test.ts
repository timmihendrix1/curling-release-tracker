// Stage B: how an incoming timing result interacts with a block that records speed.
//
// Two rules carry the risk here, both about what must NOT happen:
//
//   1. A device time on a Both block is saved IMMEDIATELY, as a complete stone in its
//      own right, without waiting for a speed that may never be typed. Holding it
//      back would mean a real, accepted measurement sitting unsaved while the athlete
//      throws the next stone.
//   2. A speed-only block must never consume a timing result as a stone. It measures
//      no time, has no timing interval and no time target, so a result that reached
//      it could only be stored against a fabricated one.
//
// The later speed for a device-timed stone is attached EXPLICITLY, by shot id, through
// completeShotMeasurement — never inferred from arrival order or "the newest stone".
import { describe, expect, it } from "vitest";
import {
  applyTimingResultToSession,
  createCaptureSequence,
  startCaptureSequence,
} from "../../captureSequence";
import { completeShotMeasurement, findIncompleteShots } from "../operations";
import { isTimeMeasuredShot, isSpeedMeasuredShot } from "../quantities";
import {
  bothBlock,
  session as measurementSession,
  speedBlock,
} from "./measurementFixtures";
import type { Session, TimingResult, TrainingBlock } from "../../../types";

function timingResult(value: number, id: string): TimingResult {
  return {
    id,
    source: "simulator",
    receivedAt: "2026-10-07T10:00:00.000Z",
    measurements: [{ measurementMode: "back-hog", value }],
  };
}

function withSequence(block: TrainingBlock): Session {
  const base = measurementSession([block], []);
  return {
    ...base,
    captureSequence: startCaptureSequence(
      createCaptureSequence({
        session: base,
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "fixed-in",
        startHandle: "in",
        shotType: "draw",
      })
    ),
  };
}

describe("a device time on a Both block", () => {
  it("is saved immediately as a stone, without waiting for a speed", () => {
    const block = bothBlock();
    const { session, outcome } = applyTimingResultToSession({
      session: withSequence(block),
      result: timingResult(3.82, "result-1"),
    });

    expect(outcome.status).toBe("accepted");
    expect(session.shots).toHaveLength(1);

    const [shot] = session.shots;
    expect(isTimeMeasuredShot(shot)).toBe(true);
    expect(shot.releaseTime).toBe(3.82);
    expect(shot.targetTime).toBe(3.75);
    // Its provenance is the device's, and nothing speed-shaped is fabricated.
    expect(shot.measurementSource).toBe("simulator");
    expect(isSpeedMeasuredShot(shot)).toBe(false);
    expect("speed" in shot).toBe(false);
  });

  it("is reported as missing exactly its speed, against its own identity", () => {
    const block = bothBlock();
    const { session } = applyTimingResultToSession({
      session: withSequence(block),
      result: timingResult(3.82, "result-1"),
    });

    expect(findIncompleteShots(session, block.id)).toEqual([
      { shot: session.shots[0], missing: ["speed"] },
    ]);
  });

  it("accepts a later speed onto THAT stone while newer device stones exist", () => {
    const block = bothBlock();
    let session = withSequence(block);

    const first = applyTimingResultToSession({
      session,
      result: timingResult(3.82, "result-1"),
    });
    session = first.session;
    const firstShotId = session.shots[0].id;

    // A second device result arrives before the first stone's speed is entered.
    const second = applyTimingResultToSession({
      session,
      result: timingResult(3.68, "result-2"),
    });
    session = second.session;
    expect(session.shots).toHaveLength(2);

    // The speed is addressed to the FIRST stone by full identity.
    const completed = completeShotMeasurement(session, {
      sessionId: session.id,
      blockId: block.id,
      shotId: firstShotId,
      quantity: "speed",
      value: 2.43,
      recordedAt: "2026-10-07T10:05:00.000Z",
    });

    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    const [a, b] = completed.value.session.shots;
    expect(a.id).toBe(firstShotId);
    expect(a.speed).toBe(2.43);
    // Independent provenance per quantity: the TIME is still the device's, and the
    // manually added speed did not overwrite or inherit that attribution.
    expect(a.measurementSource).toBe("simulator");
    expect(a.speedSource).toBeUndefined();
    expect(a.speedRecordedAt).toBe("2026-10-07T10:05:00.000Z");
    // Neither the newer stone nor the stone count changed.
    expect(b.speed).toBeUndefined();
    expect(completed.value.session.shots).toHaveLength(2);
  });

  it("refuses a second completion of the same quantity, which is what makes a retry safe", () => {
    const block = bothBlock();
    const { session } = applyTimingResultToSession({
      session: withSequence(block),
      result: timingResult(3.82, "result-1"),
    });
    const shotId = session.shots[0].id;

    const target = {
      sessionId: session.id,
      blockId: block.id,
      shotId,
      quantity: "speed" as const,
      value: 2.43,
    };

    const first = completeShotMeasurement(session, target);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = completeShotMeasurement(first.value.session, target);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe("already_recorded");
  });

  it("refuses to complete the device-recorded TIME, which already has a value", () => {
    const block = bothBlock();
    const { session } = applyTimingResultToSession({
      session: withSequence(block),
      result: timingResult(3.82, "result-1"),
    });

    const outcome = completeShotMeasurement(session, {
      sessionId: session.id,
      blockId: block.id,
      shotId: session.shots[0].id,
      quantity: "time",
      value: 3.9,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    // Completion adds a MISSING measurement. It is not general correction of history.
    expect(outcome.error.code).toBe("already_recorded");
  });
});

describe("a speed-only block never consumes a timing result", () => {
  it("rejects the result instead of inventing a timing interval and time target", () => {
    const block = speedBlock();
    const before = withSequence(block);
    const { session, outcome } = applyTimingResultToSession({
      session: before,
      result: timingResult(3.82, "result-1"),
    });

    expect(outcome.status).toBe("measurement-mode-mismatch");
    expect(session.shots).toHaveLength(0);
    // Nothing moved at all: the Session is returned by reference.
    expect(session).toBe(before);
  });
});
