// Proof that this feature changed nothing for the training forms and flows it was
// explicitly not allowed to touch.
import { describe, expect, it } from "vitest";
import {
  createCaptureSequence,
  processTimingResult,
  startCaptureSequence,
} from "../../captureSequence";
import { createTrainingBlock, getNextShotTarget } from "../../trainingBlocks";
import type { TimingResult } from "../../../types";
import { resolveBlockMeasurement } from "../quantities";
import { session, speedBlock, timeBlock } from "./measurementFixtures";

function timingResult(value: number, mode: "back-hog" | "hog-hog" = "back-hog"): TimingResult {
  return {
    id: "result-1",
    receivedAt: "2026-10-06T10:05:00.000Z",
    source: "simulator",
    measurements: [{ measurementMode: mode, value }],
  };
}

describe("Variable and Blind Weight keep their existing semantics", () => {
  it("a Variable Weight block is still time-only and still carries a pending target", () => {
    const block = createTrainingBlock({
      name: "Variable",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
      smartRandomMin: 2.5,
      smartRandomMax: 4.5,
    });

    expect(block.measurement).toBeUndefined();
    expect(block.measurementMode).toBe("back-hog");
    expect(block.pendingTargetTime).toBeDefined();
    expect(resolveBlockMeasurement(block).quantities).toEqual(["time"]);
  });

  it("a Blind Weight block is still time-only with a constant target", () => {
    const block = createTrainingBlock({
      name: "Blind",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "fixed",
    });

    expect(block.measurement).toBeUndefined();
    expect(getNextShotTarget(block)).toBe(3.75);
    expect(resolveBlockMeasurement(block).quantities).toEqual(["time"]);
  });

  it("Smart Random is unavailable for a block with no timing interval, rather than assuming Back-Hog", () => {
    // A speed-only block has no interval at all; Smart Random must not silently
    // treat that as the Back-Hog profile.
    expect(speedBlock().measurementMode).toBeUndefined();
    expect(() =>
      createTrainingBlock({
        name: "Variable speed",
        mode: "variable",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
      })
    ).toThrow();
  });
});

describe("timing capture is unchanged and never invents a speed", () => {
  it("still captures a release time on a time-measuring block", () => {
    const block = timeBlock();
    const state = session([block], []);
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: state,
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "alternate",
      })
    );

    const outcome = processTimingResult({
      result: timingResult(3.81),
      sequence,
      session: state,
      activeBlock: block,
    });

    expect(outcome.status).toBe("accepted");
    if (outcome.status !== "accepted") return;
    expect(outcome.shot.releaseTime).toBe(3.81);
    expect(outcome.shot.targetTime).toBe(3.75);
    // A timing device supplies a TIME. It must never produce a speed.
    expect(outcome.shot.speed).toBeUndefined();
    expect(outcome.shot.targetSpeed).toBeUndefined();
  });

  it("rejects a timing result for a block that measures no time", () => {
    const block = speedBlock();
    const state = session([block], []);
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: state,
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "alternate",
      })
    );

    const outcome = processTimingResult({
      result: timingResult(3.81),
      sequence,
      session: state,
      activeBlock: block,
    });

    expect(outcome.status).toBe("measurement-mode-mismatch");
    if (outcome.status === "accepted") return;
    expect(outcome.reason).toMatch(/doesn't measure time/);
  });

  it("still rejects a mismatched timing interval on a time block", () => {
    const block = timeBlock();
    const state = session([block], []);
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: state,
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "alternate",
      })
    );

    const outcome = processTimingResult({
      result: timingResult(3.81, "hog-hog"),
      sequence,
      session: state,
      activeBlock: block,
    });

    expect(outcome.status).toBe("measurement-mode-mismatch");
  });

  it("still rejects a duplicate timing result id", () => {
    const block = timeBlock();
    const state = session([block], []);
    const sequence = {
      ...startCaptureSequence(
        createCaptureSequence({
          session: state,
          block,
          expectedShotCount: 4,
          providerType: "simulator",
          handleMode: "alternate",
        })
      ),
      processedResultIds: ["result-1"],
    };

    const outcome = processTimingResult({
      result: timingResult(3.81),
      sequence,
      session: state,
      activeBlock: block,
    });

    expect(outcome.status).toBe("duplicate");
  });
});
