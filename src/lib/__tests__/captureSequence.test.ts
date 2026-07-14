import { describe, expect, it } from "vitest";
import {
  applyTimingResultToSession,
  cancelCaptureSequence,
  computeNextCaptureHandle,
  createCaptureSequence,
  isCaptureSequenceActive,
  isPlausibleTimingValue,
  isUnusualTimingValue,
  pauseCaptureSequence,
  pauseCaptureSequenceWithError,
  processTimingResult,
  resumeCaptureSequence,
  sanitizeCaptureSequence,
  startCaptureSequence,
  undoLastCapturedShot,
} from "../captureSequence";
import { createManualTimingResult } from "../timingProvider";
import type { Session, TimingResult, TrainingBlock } from "../../types";

function makeFixedBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    id: "block-1",
    name: "Fixed Block",
    mode: "fixed",
    measurementMode: "back-hog",
    targetTime: 3.75,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeVariableSmartRandomBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    id: "block-1",
    name: "Variable Smart Random",
    mode: "variable",
    measurementMode: "back-hog",
    targetTime: 3.75,
    variableTargetMode: "smart-random",
    smartRandomMin: 3.0,
    smartRandomMax: 4.0,
    pendingTargetTime: 3.5,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeVariableManualBlock(overrides: Partial<TrainingBlock> = {}): TrainingBlock {
  return {
    id: "block-1",
    name: "Variable Manual",
    mode: "variable",
    measurementMode: "back-hog",
    targetTime: 3.75,
    variableTargetMode: "manual",
    pendingTargetTime: 3.75,
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeSession(block: TrainingBlock, overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    title: "Session",
    date: new Date(0).toISOString(),
    notes: "",
    blocks: [block],
    activeBlockId: block.id,
    shots: [],
    ...overrides,
  };
}

function timingResult(value: number, overrides: Partial<TimingResult> = {}): TimingResult {
  return {
    id: overrides.id ?? Math.random().toString(36),
    receivedAt: new Date(0).toISOString(),
    source: "simulator",
    measurements: [{ measurementMode: "back-hog", value }],
    ...overrides,
  };
}

describe("createCaptureSequence", () => {
  it("starts in the 'ready' status with 0 captured shots", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const sequence = createCaptureSequence({
      session,
      block,
      expectedShotCount: 4,
      providerType: "simulator",
      handleMode: "fixed-in",
    });

    expect(sequence.status).toBe("ready");
    expect(sequence.capturedShotCount).toBe(0);
    expect(sequence.expectedShotCount).toBe(4);
  });

  it("rejects a non-positive-integer shot count", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    expect(() =>
      createCaptureSequence({ session, block, expectedShotCount: 0, providerType: "simulator", handleMode: "fixed-in" })
    ).toThrow();
    expect(() =>
      createCaptureSequence({ session, block, expectedShotCount: 3.5, providerType: "simulator", handleMode: "fixed-in" })
    ).toThrow();
  });

  it("rejects Blind Weight blocks (not yet supported)", () => {
    const block: TrainingBlock = {
      id: "block-1",
      name: "Blind",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "fixed",
      createdAt: new Date(0).toISOString(),
    };
    const session = makeSession(block);
    expect(() =>
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    ).toThrow(/blind/i);
  });

  it("rejects starting a second sequence while one is already active", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const first = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );
    const sessionWithSequence = { ...session, captureSequence: first };

    expect(() =>
      createCaptureSequence({ session: sessionWithSequence, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    ).toThrow(/already active/i);
  });

  it("allows a new sequence once the previous one is completed or cancelled", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const cancelled = cancelCaptureSequence(
      startCaptureSequence(createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" }))
    );
    const sessionWithSequence = { ...session, captureSequence: cancelled };

    expect(() =>
      createCaptureSequence({ session: sessionWithSequence, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    ).not.toThrow();
  });
});

describe("plausibility checks", () => {
  it("rejects non-finite or non-positive values", () => {
    expect(isPlausibleTimingValue(3.75)).toBe(true);
    expect(isPlausibleTimingValue(0)).toBe(false);
    expect(isPlausibleTimingValue(-1)).toBe(false);
    expect(isPlausibleTimingValue(NaN)).toBe(false);
    expect(isPlausibleTimingValue(Infinity)).toBe(false);
  });

  it("flags unusually small/large but still valid values without rejecting them", () => {
    expect(isUnusualTimingValue(3.75)).toBe(false);
    expect(isUnusualTimingValue(0.1)).toBe(true);
    expect(isUnusualTimingValue(45)).toBe(true);
    expect(isPlausibleTimingValue(45)).toBe(true); // still accepted, just flagged
  });
});

describe("processTimingResult — lifecycle and Fixed Weight", () => {
  it("a valid result saves exactly one shot and advances the counter by exactly one", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({
      result: timingResult(3.75),
      sequence,
      session,
      activeBlock: block,
    });

    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.shot.releaseTime).toBe(3.75);
      expect(outcome.shot.targetTime).toBe(3.75); // Fixed Weight's constant target
      expect(outcome.shot.shotNumber).toBe(1);
      expect(outcome.updatedSequence.capturedShotCount).toBe(1);
    }
  });

  it("the next target is only generated after a successful save (Smart Random)", () => {
    const block = makeVariableSmartRandomBlock();
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({
      result: timingResult(3.5),
      sequence,
      session,
      activeBlock: block,
    });

    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.shot.targetTime).toBe(3.5); // exactly the pendingTargetTime shown
      expect(outcome.updatedBlock.pendingTargetTime).toBeDefined();
      expect(outcome.updatedBlock.pendingTargetTime).toBeGreaterThanOrEqual(3.0);
      expect(outcome.updatedBlock.pendingTargetTime).toBeLessThanOrEqual(4.0);
    }
  });

  it("Variable Manual: a manual target override is used and remembered for next time", () => {
    const block = makeVariableManualBlock();
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({
      result: timingResult(3.9),
      sequence,
      session,
      activeBlock: block,
      manualTargetOverride: 4.1,
    });

    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.shot.targetTime).toBe(4.1);
      expect(outcome.updatedBlock.pendingTargetTime).toBe(4.1); // stays as next starting point
    }
  });

  it("the sequence auto-completes once expectedShotCount is reached", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 2, providerType: "simulator", handleMode: "fixed-in" })
    );

    for (let i = 0; i < 2; i++) {
      const outcome = processTimingResult({ result: timingResult(3.7 + i * 0.01), sequence, session, activeBlock: block });
      if (outcome.status !== "accepted") throw new Error("expected acceptance");
      session = { ...session, shots: [...session.shots, outcome.shot] };
      sequence = outcome.updatedSequence;
    }

    expect(sequence.status).toBe("completed");
    expect(sequence.capturedShotCount).toBe(2);
  });

  it("a result after completion is ignored, not double-counted", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 1, providerType: "simulator", handleMode: "fixed-in" })
    );

    const first = processTimingResult({ result: timingResult(3.75), sequence, session, activeBlock: block });
    if (first.status !== "accepted") throw new Error("expected acceptance");
    session = { ...session, shots: [...session.shots, first.shot] };
    sequence = first.updatedSequence;
    expect(sequence.status).toBe("completed");

    const second = processTimingResult({ result: timingResult(3.8), sequence, session, activeBlock: block });
    expect(second.status).toBe("ignored-completed");
    expect(sequence.capturedShotCount).toBe(1);
  });

  it("a result while paused is ignored and does not touch target/counter", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const sequence = pauseCaptureSequence(
      startCaptureSequence(createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" }))
    );

    const outcome = processTimingResult({ result: timingResult(3.75), sequence, session, activeBlock: block });
    expect(outcome.status).toBe("ignored-paused");
  });

  it("resume allows results to be processed again", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const paused = pauseCaptureSequence(
      startCaptureSequence(createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" }))
    );
    const resumed = resumeCaptureSequence(paused);
    expect(resumed.status).toBe("running");

    const outcome = processTimingResult({ result: timingResult(3.75), sequence: resumed, session, activeBlock: block });
    expect(outcome.status).toBe("accepted");
  });

  it("cancel preserves already-captured shots (does not undo them) and stops further processing", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );
    const outcome = processTimingResult({ result: timingResult(3.75), sequence, session, activeBlock: block });
    if (outcome.status !== "accepted") throw new Error("expected acceptance");
    session = { ...session, shots: [...session.shots, outcome.shot] };
    sequence = cancelCaptureSequence(outcome.updatedSequence);

    expect(session.shots).toHaveLength(1); // still there
    expect(sequence.status).toBe("cancelled");

    const afterCancel = processTimingResult({ result: timingResult(3.8), sequence, session, activeBlock: block });
    expect(afterCancel.status).toBe("ignored-completed");
  });

  it("a result for the wrong block is never processed", () => {
    const block = makeFixedBlock();
    const otherBlock = makeFixedBlock({ id: "other-block" });
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({ result: timingResult(3.75), sequence, session, activeBlock: otherBlock });
    expect(outcome.status).toBe("invalid");
  });

  it("duplicate result ids never produce a second shot", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const result = timingResult(3.75, { id: "result-1" });
    const first = processTimingResult({ result, sequence, session, activeBlock: block });
    if (first.status !== "accepted") throw new Error("expected acceptance");
    session = { ...session, shots: [...session.shots, first.shot] };
    sequence = first.updatedSequence;

    const second = processTimingResult({ result, sequence, session, activeBlock: block });
    expect(second.status).toBe("duplicate");
    expect(sequence.capturedShotCount).toBe(1);
  });

  it("manual fallback works identically to a simulator result", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const manualResult = createManualTimingResult("back-hog", 3.72);
    const outcome = processTimingResult({ result: manualResult, sequence, session, activeBlock: block });

    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.shot.measurementSource).toBe("manual");
      expect(outcome.shot.releaseTime).toBe(3.72);
    }
  });
});

describe("multi-measurement / measurement-mode matching", () => {
  it("uses only the measurement matching the active block's measurementMode", () => {
    const block = makeFixedBlock({ measurementMode: "back-hog" });
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({
      result: timingResult(0, {
        measurements: [
          { measurementMode: "back-hog", value: 3.75 },
          { measurementMode: "hog-hog", value: 10.42 },
        ],
      }),
      sequence,
      session,
      activeBlock: block,
    });

    expect(outcome.status).toBe("accepted");
    if (outcome.status === "accepted") {
      expect(outcome.shot.releaseTime).toBe(3.75);
    }
  });

  it("rejects a result with no measurement for the active measurement mode", () => {
    const block = makeFixedBlock({ measurementMode: "back-hog" });
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({
      result: timingResult(0, { measurements: [{ measurementMode: "hog-hog", value: 10.42 }] }),
      sequence,
      session,
      activeBlock: block,
    });

    expect(outcome.status).toBe("measurement-mode-mismatch");
  });

  it("rejects a result with empty measurements", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({
      result: timingResult(0, { measurements: [] }),
      sequence,
      session,
      activeBlock: block,
    });

    expect(outcome.status).toBe("invalid");
  });

  it("rejects an implausible value (negative, zero, NaN)", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    for (const value of [-1, 0, NaN]) {
      const outcome = processTimingResult({ result: timingResult(value), sequence, session, activeBlock: block });
      expect(outcome.status).toBe("invalid");
    }
  });
});

describe("Handle strategies", () => {
  function sequenceWith(handleMode: "fixed-in" | "fixed-out" | "alternate" | "manual", startHandle: "in" | "out" = "in") {
    const block = makeFixedBlock();
    const session = makeSession(block);
    return startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 8, providerType: "simulator", handleMode, startHandle })
    );
  }

  it("fixed-in always yields 'in'", () => {
    let sequence = sequenceWith("fixed-in");
    for (let i = 0; i < 4; i++) {
      expect(computeNextCaptureHandle(sequence)).toBe("in");
      sequence = { ...sequence, capturedShotCount: sequence.capturedShotCount + 1 };
    }
  });

  it("fixed-out always yields 'out'", () => {
    const sequence = sequenceWith("fixed-out");
    expect(computeNextCaptureHandle(sequence)).toBe("out");
  });

  it("alternate starting with 'in' produces in, out, in, out, ...", () => {
    let sequence = sequenceWith("alternate", "in");
    const handles = [];
    for (let i = 0; i < 4; i++) {
      handles.push(computeNextCaptureHandle(sequence));
      sequence = { ...sequence, capturedShotCount: sequence.capturedShotCount + 1 };
    }
    expect(handles).toEqual(["in", "out", "in", "out"]);
  });

  it("alternate starting with 'out' produces out, in, out, in, ...", () => {
    let sequence = sequenceWith("alternate", "out");
    const handles = [];
    for (let i = 0; i < 4; i++) {
      handles.push(computeNextCaptureHandle(sequence));
      sequence = { ...sequence, capturedShotCount: sequence.capturedShotCount + 1 };
    }
    expect(handles).toEqual(["out", "in", "out", "in"]);
  });

  it("manual mode defers to the supplied override", () => {
    const sequence = sequenceWith("manual");
    expect(computeNextCaptureHandle(sequence, "out")).toBe("out");
    expect(computeNextCaptureHandle(sequence, "in")).toBe("in");
  });

  it("handle only advances on a successfully saved shot, not on duplicates/invalid results", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 8, providerType: "simulator", handleMode: "alternate", startHandle: "in" })
    );

    const goodResult = timingResult(3.75, { id: "r1" });
    const accepted = processTimingResult({ result: goodResult, sequence, session, activeBlock: block });
    if (accepted.status !== "accepted") throw new Error("expected acceptance");
    expect(accepted.shot.handle).toBe("in");
    session = { ...session, shots: [...session.shots, accepted.shot] };
    sequence = accepted.updatedSequence;

    // Duplicate of the same id must not advance the handle sequence.
    const duplicate = processTimingResult({ result: goodResult, sequence, session, activeBlock: block });
    expect(duplicate.status).toBe("duplicate");

    // Invalid result also must not advance it.
    const invalid = processTimingResult({ result: timingResult(-1, { id: "r2" }), sequence, session, activeBlock: block });
    expect(invalid.status).toBe("invalid");

    const secondGood = processTimingResult({ result: timingResult(3.8, { id: "r3" }), sequence, session, activeBlock: block });
    if (secondGood.status !== "accepted") throw new Error("expected acceptance");
    expect(secondGood.shot.handle).toBe("out"); // correctly the second alternate value
  });

  it("existing handle filters keep working on capture-produced shots", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 2, providerType: "simulator", handleMode: "alternate", startHandle: "in" })
    );

    for (const value of [3.7, 3.8]) {
      const outcome = processTimingResult({ result: timingResult(value), sequence, session, activeBlock: block });
      if (outcome.status !== "accepted") throw new Error("expected acceptance");
      session = { ...session, shots: [...session.shots, outcome.shot] };
      sequence = outcome.updatedSequence;
    }

    expect(session.shots.filter((s) => s.handle === "in")).toHaveLength(1);
    expect(session.shots.filter((s) => s.handle === "out")).toHaveLength(1);
  });
});

describe("Undo", () => {
  it("removes the last captured shot, restores the target, and decrements the counter", () => {
    const block = makeVariableSmartRandomBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );
    let currentBlock = block;

    const outcome = processTimingResult({ result: timingResult(3.5), sequence, session, activeBlock: currentBlock });
    if (outcome.status !== "accepted") throw new Error("expected acceptance");
    session = { ...session, shots: [...session.shots, outcome.shot] };
    sequence = outcome.updatedSequence;
    currentBlock = outcome.updatedBlock;

    const targetBeforeUndo = currentBlock.pendingTargetTime;
    expect(targetBeforeUndo).not.toBe(3.5); // a new target was generated after save

    const undone = undoLastCapturedShot(sequence, currentBlock);
    expect(undone).not.toBeNull();
    if (!undone) return;

    expect(undone.removedShotId).toBe(outcome.shot.id);
    expect(undone.updatedSequence.capturedShotCount).toBe(0);
    // The exact same pending target that was shown before the undone shot — not a
    // freshly generated one.
    expect(undone.updatedBlock.pendingTargetTime).toBe(3.5);
  });

  it("does not generate a new random target on undo", () => {
    const block = makeVariableSmartRandomBlock({ pendingTargetTime: 3.2 });
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({ result: timingResult(3.2), sequence, session, activeBlock: block });
    if (outcome.status !== "accepted") throw new Error("expected acceptance");

    const undone = undoLastCapturedShot(outcome.updatedSequence, outcome.updatedBlock);
    expect(undone?.updatedBlock.pendingTargetTime).toBe(3.2);
  });

  it("turns a completed sequence back into running", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 1, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({ result: timingResult(3.75), sequence, session, activeBlock: block });
    if (outcome.status !== "accepted") throw new Error("expected acceptance");
    sequence = outcome.updatedSequence;
    expect(sequence.status).toBe("completed");

    const undone = undoLastCapturedShot(sequence, outcome.updatedBlock);
    expect(undone?.updatedSequence.status).toBe("running");
  });

  it("restores handle progress (via the decremented counter)", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "alternate", startHandle: "in" })
    );
    let currentBlock = block;

    const first = processTimingResult({ result: timingResult(3.7, { id: "r1" }), sequence, session, activeBlock: currentBlock });
    if (first.status !== "accepted") throw new Error("expected acceptance");
    session = { ...session, shots: [...session.shots, first.shot] };
    sequence = first.updatedSequence;
    currentBlock = first.updatedBlock;
    expect(first.shot.handle).toBe("in");

    const second = processTimingResult({ result: timingResult(3.8, { id: "r2" }), sequence, session, activeBlock: currentBlock });
    if (second.status !== "accepted") throw new Error("expected acceptance");
    expect(second.shot.handle).toBe("out");
    sequence = second.updatedSequence;
    currentBlock = second.updatedBlock;

    const undone = undoLastCapturedShot(sequence, currentBlock);
    expect(undone).not.toBeNull();
    // After undoing shot #2 ("out"), the next handle must again be "out".
    expect(computeNextCaptureHandle(undone!.updatedSequence)).toBe("out");
  });

  it("never removes an unrelated manual shot", () => {
    const block = makeFixedBlock();
    const manualShot = {
      id: "manual-shot-1",
      sessionId: "session-1",
      blockId: block.id,
      shotNumber: 1,
      releaseTime: 3.6,
      targetTime: 3.75,
      handle: "in" as const,
      shotType: "draw" as const,
      createdAt: new Date(0).toISOString(),
    };
    const session = makeSession(block, { shots: [manualShot] });
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const outcome = processTimingResult({ result: timingResult(3.75), sequence, session, activeBlock: block });
    if (outcome.status !== "accepted") throw new Error("expected acceptance");

    const undone = undoLastCapturedShot(outcome.updatedSequence, outcome.updatedBlock);
    expect(undone?.removedShotId).not.toBe(manualShot.id);
    expect(undone?.removedShotId).toBe(outcome.shot.id);
  });

  it("returns null when there is nothing to undo", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );
    expect(undoLastCapturedShot(sequence, block)).toBeNull();
  });

  it("keeps the original result id 'spent' — resending it after undo is still a duplicate", () => {
    const block = makeFixedBlock();
    let session = makeSession(block);
    let sequence = startCaptureSequence(
      createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" })
    );

    const result = timingResult(3.75, { id: "original-result" });
    const outcome = processTimingResult({ result, sequence, session, activeBlock: block });
    if (outcome.status !== "accepted") throw new Error("expected acceptance");
    session = { ...session, shots: [...session.shots, outcome.shot] };
    sequence = outcome.updatedSequence;

    const undone = undoLastCapturedShot(sequence, outcome.updatedBlock);
    expect(undone).not.toBeNull();
    session = { ...session, shots: session.shots.filter((s) => s.id !== undone!.removedShotId) };
    sequence = undone!.updatedSequence;

    // Resubmitting the SAME result id after undo must still be rejected as a
    // duplicate — a replacement shot needs a genuinely new result.
    const resubmitted = processTimingResult({ result, sequence, session, activeBlock: outcome.updatedBlock });
    expect(resubmitted.status).toBe("duplicate");

    // A brand-new result id, however, is processed normally.
    const freshResult = timingResult(3.76, { id: "new-result" });
    const freshOutcome = processTimingResult({ result: freshResult, sequence, session, activeBlock: outcome.updatedBlock });
    expect(freshOutcome.status).toBe("accepted");
  });
});

describe("isCaptureSequenceActive", () => {
  it("is true for ready/running/paused, false for completed/cancelled/undefined", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);
    const ready = createCaptureSequence({ session, block, expectedShotCount: 4, providerType: "simulator", handleMode: "fixed-in" });

    expect(isCaptureSequenceActive(ready)).toBe(true);
    expect(isCaptureSequenceActive(startCaptureSequence(ready))).toBe(true);
    expect(isCaptureSequenceActive(pauseCaptureSequence(startCaptureSequence(ready)))).toBe(true);
    expect(isCaptureSequenceActive(cancelCaptureSequence(ready))).toBe(false);
    expect(isCaptureSequenceActive(undefined)).toBe(false);
  });
});

describe("applyTimingResultToSession — the atomic Capture Sequence transition", () => {
  it("computes shot append + block update + sequence advance together, in one call", () => {
    const block = makeVariableSmartRandomBlock();
    const session = makeSession(block, {
      captureSequence: startCaptureSequence(
        createCaptureSequence({
          session: makeSession(block),
          block,
          expectedShotCount: 4,
          providerType: "simulator",
          handleMode: "fixed-in",
        })
      ),
    });

    const { session: nextSession, outcome } = applyTimingResultToSession({
      session,
      result: timingResult(3.6, { id: "r1" }),
    });

    if (outcome.status !== "accepted") throw new Error("expected acceptance");
    expect(nextSession.shots).toHaveLength(1);
    expect(nextSession.shots[0].releaseTime).toBe(3.6);
    expect(nextSession.blocks[0].pendingTargetTime).not.toBe(block.pendingTargetTime);
    expect(nextSession.captureSequence?.capturedShotCount).toBe(1);
    expect(nextSession.captureSequence?.processedResultIds).toContain("r1");
  });

  it("returns the exact same session reference (no partial mutation) when a result is rejected", () => {
    const block = makeFixedBlock();
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: makeSession(block),
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "fixed-in",
      })
    );
    const session = makeSession(block, { captureSequence: pauseCaptureSequence(sequence) });

    const { session: nextSession, outcome } = applyTimingResultToSession({
      session,
      result: timingResult(3.75),
    });

    expect(outcome.status).toBe("ignored-paused");
    expect(nextSession).toBe(session);
  });

  it("returns ignored-completed and an unchanged session when there is no active capture sequence at all", () => {
    const block = makeFixedBlock();
    const session = makeSession(block);

    const { session: nextSession, outcome } = applyTimingResultToSession({
      session,
      result: timingResult(3.75),
    });

    expect(outcome.status).toBe("ignored-completed");
    expect(nextSession).toBe(session);
  });

  it("returns invalid and an unchanged session when activeBlockId points at no real block", () => {
    const block = makeFixedBlock();
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: makeSession(block),
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "fixed-in",
      })
    );
    const session = makeSession(block, {
      activeBlockId: "does-not-exist",
      captureSequence: sequence,
    });

    const { session: nextSession, outcome } = applyTimingResultToSession({
      session,
      result: timingResult(3.75),
    });

    expect(outcome.status).toBe("invalid");
    expect(nextSession).toBe(session);
  });

  it("two results applied sequentially (simulating a serialized queue) each get a distinct shot number, and both are kept", () => {
    const block = makeFixedBlock();
    let session = makeSession(block, {
      captureSequence: startCaptureSequence(
        createCaptureSequence({
          session: makeSession(block),
          block,
          expectedShotCount: 4,
          providerType: "simulator",
          handleMode: "alternate",
        })
      ),
    });

    const first = applyTimingResultToSession({ session, result: timingResult(3.7, { id: "r1" }) });
    session = first.session;
    const second = applyTimingResultToSession({ session, result: timingResult(3.8, { id: "r2" }) });
    session = second.session;

    expect(session.shots).toHaveLength(2);
    expect(session.shots.map((s) => s.shotNumber)).toEqual([1, 2]);
    expect(session.shots.map((s) => s.handle)).toEqual(["in", "out"]);
    expect(session.captureSequence?.capturedShotCount).toBe(2);
  });

  it("three results applied one after another (no shared state read twice) never collide on shot number", () => {
    const block = makeFixedBlock();
    let session = makeSession(block, {
      captureSequence: startCaptureSequence(
        createCaptureSequence({
          session: makeSession(block),
          block,
          expectedShotCount: 5,
          providerType: "simulator",
          handleMode: "fixed-in",
        })
      ),
    });

    for (const [i, value] of [3.7, 3.71, 3.72].entries()) {
      const { session: nextSession, outcome } = applyTimingResultToSession({
        session,
        result: timingResult(value, { id: `r${i}` }),
      });
      if (outcome.status !== "accepted") throw new Error("expected acceptance");
      session = nextSession;
    }

    expect(session.shots.map((s) => s.shotNumber)).toEqual([1, 2, 3]);
    expect(new Set(session.shots.map((s) => s.shotNumber)).size).toBe(3);
  });

  it("a manual result and a simulator result applied back to back each get a distinct, deterministic shot position", () => {
    const block = makeFixedBlock();
    let session = makeSession(block, {
      captureSequence: startCaptureSequence(
        createCaptureSequence({
          session: makeSession(block),
          block,
          expectedShotCount: 4,
          providerType: "simulator",
          handleMode: "fixed-in",
        })
      ),
    });

    const manualResult = createManualTimingResult("back-hog", 3.65);
    const simResult = timingResult(3.7, { id: "sim-1" });

    const afterManual = applyTimingResultToSession({ session, result: manualResult });
    if (afterManual.outcome.status !== "accepted") throw new Error("expected acceptance");
    session = afterManual.session;

    const afterSim = applyTimingResultToSession({ session, result: simResult });
    if (afterSim.outcome.status !== "accepted") throw new Error("expected acceptance");
    session = afterSim.session;

    expect(session.shots).toHaveLength(2);
    expect(session.shots[0].measurementSource).toBe("manual");
    expect(session.shots[1].measurementSource).toBe("simulator");
    expect(session.shots.map((s) => s.shotNumber)).toEqual([1, 2]);
  });

  it("a result arriving right after the sequence completes is ignored-completed, not saved, doesn't bump the count", () => {
    const block = makeFixedBlock();
    let session = makeSession(block, {
      captureSequence: startCaptureSequence(
        createCaptureSequence({
          session: makeSession(block),
          block,
          expectedShotCount: 1,
          providerType: "simulator",
          handleMode: "fixed-in",
        })
      ),
    });

    const first = applyTimingResultToSession({ session, result: timingResult(3.75, { id: "r1" }) });
    if (first.outcome.status !== "accepted") throw new Error("expected acceptance");
    session = first.session;
    expect(session.captureSequence?.status).toBe("completed");

    const second = applyTimingResultToSession({ session, result: timingResult(3.8, { id: "r2" }) });
    expect(second.outcome.status).toBe("ignored-completed");
    expect(second.session).toBe(session);
    expect(second.session.shots).toHaveLength(1);
    expect(second.session.captureSequence?.capturedShotCount).toBe(1);
  });
});

describe("pauseCaptureSequenceWithError / resumeCaptureSequence — Save-Fehler semantics", () => {
  it("forces a running sequence to paused with a recorded error message", () => {
    const block = makeFixedBlock();
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: makeSession(block),
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "fixed-in",
      })
    );

    const errored = pauseCaptureSequenceWithError(sequence, "Something unexpected happened.");
    expect(errored.status).toBe("paused");
    expect(errored.lastError).toBe("Something unexpected happened.");
  });

  it("is a no-op for an already-completed or cancelled sequence", () => {
    const block = makeFixedBlock();
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: makeSession(block),
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "fixed-in",
      })
    );
    const cancelled = cancelCaptureSequence(sequence);

    expect(pauseCaptureSequenceWithError(cancelled, "irrelevant")).toBe(cancelled);
  });

  it("resumeCaptureSequence clears lastError so a successful resume starts from a clean slate", () => {
    const block = makeFixedBlock();
    const sequence = startCaptureSequence(
      createCaptureSequence({
        session: makeSession(block),
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "fixed-in",
      })
    );
    const errored = pauseCaptureSequenceWithError(sequence, "boom");

    const resumed = resumeCaptureSequence(errored);
    expect(resumed.status).toBe("running");
    expect(resumed.lastError).toBeUndefined();
  });
});

describe("sanitizeCaptureSequence — persistence repair rules", () => {
  function baseSequence(overrides: Partial<ReturnType<typeof createCaptureSequence>> = {}) {
    const block = makeFixedBlock();
    return {
      ...createCaptureSequence({
        session: makeSession(block),
        block,
        expectedShotCount: 4,
        providerType: "simulator",
        handleMode: "fixed-in",
      }),
      ...overrides,
    };
  }

  it("discards a sequence with a non-positive expectedShotCount", () => {
    const sequence = baseSequence({ expectedShotCount: 0 });
    expect(sanitizeCaptureSequence(sequence, [])).toBeUndefined();
  });

  it("discards a sequence with a non-integer expectedShotCount", () => {
    const sequence = baseSequence({ expectedShotCount: 2.5 });
    expect(sanitizeCaptureSequence(sequence, [])).toBeUndefined();
  });

  it("discards a sequence whose real captured shots exceed expectedShotCount", () => {
    const sequence = baseSequence({ expectedShotCount: 1 });
    const shots = [
      { id: "s1", sessionId: "session-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in" as const, createdAt: "" },
      { id: "s2", sessionId: "session-1", blockId: "block-1", shotNumber: 2, releaseTime: 3.8, targetTime: 3.75, handle: "in" as const, createdAt: "" },
    ];
    expect(sanitizeCaptureSequence(sequence, shots)).toBeUndefined();
  });

  it("recomputes capturedShotCount from the real shots, ignoring a stale stored value", () => {
    const sequence = baseSequence({ capturedShotCount: 99, steps: [] });
    const shots = [
      { id: "s1", sessionId: "session-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in" as const, createdAt: "" },
    ];
    const sanitized = sanitizeCaptureSequence(sequence, shots);
    expect(sanitized?.capturedShotCount).toBe(1);
  });

  it("drops a step referencing a shot that no longer exists, without inventing one", () => {
    const sequence = baseSequence({
      steps: [{ resultId: "r1", shotId: "vanished-shot", targetTime: 3.75, handle: "in" }],
    });
    const sanitized = sanitizeCaptureSequence(sequence, []);
    expect(sanitized?.steps).toHaveLength(0);
    expect(sanitized?.capturedShotCount).toBe(0);
    // The result id must stay known/spent even though its shot is gone.
    expect(sanitized?.processedResultIds).toContain("r1");
  });

  it("widens processedResultIds to include every real step's resultId, even if the stored array didn't", () => {
    const sequence = baseSequence({
      processedResultIds: [],
      steps: [{ resultId: "r1", shotId: "s1", targetTime: 3.75, handle: "in" }],
    });
    const shots = [
      { id: "s1", sessionId: "session-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in" as const, createdAt: "" },
    ];
    const sanitized = sanitizeCaptureSequence(sequence, shots);
    expect(sanitized?.processedResultIds).toContain("r1");
  });

  it("clears completedAt on a sequence that isn't actually completed", () => {
    const sequence = baseSequence({ status: "running", completedAt: "2024-01-01T00:00:00.000Z" });
    const sanitized = sanitizeCaptureSequence(sequence, []);
    expect(sanitized?.completedAt).toBeUndefined();
  });

  it("clears cancelledAt on a sequence that isn't actually cancelled", () => {
    const sequence = baseSequence({ status: "paused", cancelledAt: "2024-01-01T00:00:00.000Z" });
    const sanitized = sanitizeCaptureSequence(sequence, []);
    expect(sanitized?.cancelledAt).toBeUndefined();
  });

  it("reopens a 'completed' sequence with fewer real shots than expected as 'paused', with a lastError", () => {
    const sequence = baseSequence({
      expectedShotCount: 3,
      status: "completed",
      completedAt: "2024-01-01T00:00:00.000Z",
    });
    const shots = [
      { id: "s1", sessionId: "session-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in" as const, createdAt: "" },
    ];
    const sanitized = sanitizeCaptureSequence(sequence, shots);
    expect(sanitized?.status).toBe("paused");
    expect(sanitized?.completedAt).toBeUndefined();
    expect(sanitized?.lastError).toBeDefined();
  });

  it("is idempotent — sanitizing its own output twice yields the same result", () => {
    const sequence = baseSequence({
      capturedShotCount: 99,
      status: "completed",
      completedAt: "2024-01-01T00:00:00.000Z",
      steps: [
        { resultId: "r1", shotId: "s1", targetTime: 3.75, handle: "in" },
        { resultId: "r2", shotId: "vanished", targetTime: 3.75, handle: "out" },
      ],
    });
    const shots = [
      { id: "s1", sessionId: "session-1", blockId: "block-1", shotNumber: 1, releaseTime: 3.7, targetTime: 3.75, handle: "in" as const, createdAt: "" },
    ];

    const once = sanitizeCaptureSequence(sequence, shots);
    const twice = once ? sanitizeCaptureSequence(once, shots) : undefined;
    expect(twice).toEqual(once);
  });
});
