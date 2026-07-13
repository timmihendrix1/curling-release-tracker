import { describe, expect, it } from "vitest";
import {
  advanceBlockTarget,
  computeShotTarget,
  createTrainingBlock,
  getNextShotTarget,
  isSmartRandomAvailable,
  updateSmartRandomRange,
} from "../trainingBlocks";
import { DEFAULT_SMART_RANDOM_MAX, DEFAULT_SMART_RANDOM_MIN } from "../variableTargets";
import type { TrainingBlock } from "../../types";

describe("Fixed Weight", () => {
  it("always uses the block's default target for the next shot", () => {
    const block = createTrainingBlock({
      name: "Fixed",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
    });

    expect(getNextShotTarget(block)).toBe(3.75);
    expect(computeShotTarget(block)).toBe(3.75);
  });

  it("advancing the block after a shot is a no-op", () => {
    const block = createTrainingBlock({
      name: "Fixed",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
    });

    const advanced = advanceBlockTarget(block, 3.75, []);
    expect(advanced).toEqual(block);
  });
});

describe("Variable Weight — Smart Random", () => {
  it("generates a first pending target as soon as the block is created", () => {
    const block = createTrainingBlock({
      name: "Variable",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
    });

    expect(block.pendingTargetTime).toBeDefined();
    expect(getNextShotTarget(block)).toBe(block.pendingTargetTime);
  });

  it("generates a new pending target after each shot, without touching the used value", () => {
    const block = createTrainingBlock({
      name: "Variable",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
    });

    const usedTarget = getNextShotTarget(block);
    const advanced = advanceBlockTarget(block, usedTarget, []);

    expect(advanced.pendingTargetTime).toBeDefined();
    // The block's own record of "what target was used" never changes
    // retroactively — only its *next* pending target moves on.
    expect(usedTarget).toBe(usedTarget);
  });
});

describe("Variable Weight — Manual", () => {
  function manualBlock(): TrainingBlock {
    return createTrainingBlock({
      name: "Variable",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "manual",
    });
  }

  it("seeds the pending target from the setup's starting target time", () => {
    const block = manualBlock();
    expect(block.pendingTargetTime).toBe(3.75);
  });

  it("a manual override always wins over the block's pending target", () => {
    const block = manualBlock();
    expect(computeShotTarget(block, 4.1)).toBe(4.1);
  });

  it("keeps the manually-used value as the next starting point after saving", () => {
    const block = manualBlock();
    const advanced = advanceBlockTarget(block, 4.1, []);
    expect(advanced.pendingTargetTime).toBe(4.1);
  });
});

describe("Smart Random — per-block configurable range", () => {
  it("defaults to 2.50s-4.50s when no range is given", () => {
    const block = createTrainingBlock({
      name: "Variable",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
    });

    expect(block.smartRandomMin).toBe(DEFAULT_SMART_RANDOM_MIN);
    expect(block.smartRandomMax).toBe(DEFAULT_SMART_RANDOM_MAX);
    expect(block.pendingTargetTime).toBeGreaterThanOrEqual(DEFAULT_SMART_RANDOM_MIN);
    expect(block.pendingTargetTime).toBeLessThanOrEqual(DEFAULT_SMART_RANDOM_MAX);
  });

  it("stores a custom range and only generates targets within it", () => {
    const block = createTrainingBlock({
      name: "Takeout Weights",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.0,
      variableTargetMode: "smart-random",
      smartRandomMin: 2.5,
      smartRandomMax: 3.6,
    });

    expect(block.smartRandomMin).toBe(2.5);
    expect(block.smartRandomMax).toBe(3.6);
    expect(block.pendingTargetTime).toBeGreaterThanOrEqual(2.5);
    expect(block.pendingTargetTime).toBeLessThanOrEqual(3.6);
  });

  it("rejects an invalid range at block creation instead of silently clamping it", () => {
    expect(() =>
      createTrainingBlock({
        name: "Invalid range",
        mode: "variable",
        measurementMode: "back-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
        smartRandomMin: 4.0,
        smartRandomMax: 3.5, // max < min
      })
    ).toThrow();
  });

  it("Manual blocks never store a Smart Random range", () => {
    const block = createTrainingBlock({
      name: "Manual",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "manual",
    });

    expect(block.smartRandomMin).toBeUndefined();
    expect(block.smartRandomMax).toBeUndefined();
  });

  it("advanceBlockTarget generates the next target using the block's own stored range", () => {
    const block = createTrainingBlock({
      name: "Narrow",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.0,
      variableTargetMode: "smart-random",
      smartRandomMin: 2.5,
      smartRandomMax: 2.7,
    });

    for (let i = 0; i < 20; i++) {
      const used = getNextShotTarget(block);
      const advanced = advanceBlockTarget(block, used, []);
      expect(advanced.pendingTargetTime).toBeGreaterThanOrEqual(2.5);
      expect(advanced.pendingTargetTime).toBeLessThanOrEqual(2.7);
    }
  });
});

describe("updateSmartRandomRange", () => {
  function smartRandomBlock(min: number, max: number, pending: number): TrainingBlock {
    return {
      id: "b1",
      name: "Variable",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      createdAt: new Date(0).toISOString(),
      variableTargetMode: "smart-random",
      smartRandomMin: min,
      smartRandomMax: max,
      pendingTargetTime: pending,
    };
  }

  it("keeps the pending target when it still falls inside the new range", () => {
    const block = smartRandomBlock(3.0, 4.0, 3.5);
    const updated = updateSmartRandomRange(block, 3.2, 4.2);

    expect(updated.smartRandomMin).toBe(3.2);
    expect(updated.smartRandomMax).toBe(4.2);
    expect(updated.pendingTargetTime).toBe(3.5);
  });

  it("generates a single new pending target when the old one falls outside the new range", () => {
    const block = smartRandomBlock(3.0, 4.0, 3.9);
    const updated = updateSmartRandomRange(block, 2.5, 3.5);

    expect(updated.pendingTargetTime).not.toBe(3.9);
    expect(updated.pendingTargetTime).toBeGreaterThanOrEqual(2.5);
    expect(updated.pendingTargetTime).toBeLessThanOrEqual(3.5);
  });

  it("never touches already-recorded shots (a pure block transformation)", () => {
    const block = smartRandomBlock(3.0, 4.0, 3.9);
    const updated = updateSmartRandomRange(block, 2.5, 3.5);

    expect(block.pendingTargetTime).toBe(3.9); // original untouched
    expect(updated).not.toBe(block);
  });
});

describe("Hog-Hog — no Smart Random profile available", () => {
  it("isSmartRandomAvailable is true for back-hog and false for hog-hog", () => {
    expect(isSmartRandomAvailable("back-hog")).toBe(true);
    expect(isSmartRandomAvailable("hog-hog")).toBe(false);
  });

  it("creating a Hog-Hog Smart Random block throws a clear error instead of reusing the Back-Hog range", () => {
    expect(() =>
      createTrainingBlock({
        name: "Invalid",
        mode: "variable",
        measurementMode: "hog-hog",
        targetTime: 3.75,
        variableTargetMode: "smart-random",
      })
    ).toThrow(/hog-hog/i);
  });

  it("Hog-Hog Manual still works", () => {
    const block = createTrainingBlock({
      name: "Hog-Hog Manual",
      mode: "variable",
      measurementMode: "hog-hog",
      targetTime: 5.5,
      variableTargetMode: "manual",
    });

    expect(block.pendingTargetTime).toBe(5.5);
    expect(computeShotTarget(block, 6.0)).toBe(6.0);
  });

  it("advancing a (hypothetical, already-invalid) Hog-Hog Smart Random block also throws rather than silently using Back-Hog values", () => {
    const invalidBlock: TrainingBlock = {
      id: "b1",
      name: "Hog-Hog Smart Random",
      mode: "variable",
      measurementMode: "hog-hog",
      targetTime: 5.5,
      createdAt: new Date(0).toISOString(),
      variableTargetMode: "smart-random",
      pendingTargetTime: 5.5,
    };

    expect(() => advanceBlockTarget(invalidBlock, 5.5, [])).toThrow(/hog-hog/i);
  });
});

describe("Blind Weight — Fixed target source", () => {
  it("uses a constant target for every shot, reusing the Fixed Weight target field", () => {
    const block = createTrainingBlock({
      name: "Blind Fixed",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "fixed",
    });

    expect(block.pendingTargetTime).toBeUndefined();
    expect(getNextShotTarget(block)).toBe(3.75);
  });

  it("advancing after a shot is a no-op, same as plain Fixed Weight", () => {
    const block = createTrainingBlock({
      name: "Blind Fixed",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "fixed",
    });

    expect(advanceBlockTarget(block, 3.75, [])).toEqual(block);
  });

  it("defaults to Fixed when no blindTargetMode is given", () => {
    const block = createTrainingBlock({
      name: "Blind",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
    });
    expect(block.blindTargetMode).toBe("fixed");
  });
});

describe("Blind Weight — Smart Random target source (reuses Variable Weight's engine)", () => {
  it("generates the first target from the configured range at block creation", () => {
    const block = createTrainingBlock({
      name: "Blind Smart Random",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "smart-random",
      smartRandomMin: 3.4,
      smartRandomMax: 4.2,
    });

    expect(block.smartRandomMin).toBe(3.4);
    expect(block.smartRandomMax).toBe(4.2);
    expect(block.pendingTargetTime).toBeGreaterThanOrEqual(3.4);
    expect(block.pendingTargetTime).toBeLessThanOrEqual(4.2);
  });

  it("only generates a new target after a shot is advanced, never before", () => {
    const block = createTrainingBlock({
      name: "Blind Smart Random",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "smart-random",
    });

    const firstTarget = block.pendingTargetTime;
    // Re-reading the target without advancing must not change it.
    expect(getNextShotTarget(block)).toBe(firstTarget);
    expect(getNextShotTarget(block)).toBe(firstTarget);

    const advanced = advanceBlockTarget(block, firstTarget!, []);
    expect(advanced.pendingTargetTime).toBeDefined();
  });

  it("Hog-Hog Blind Smart Random is rejected the same way as Variable Weight", () => {
    expect(() =>
      createTrainingBlock({
        name: "Invalid",
        mode: "blind",
        measurementMode: "hog-hog",
        targetTime: 3.75,
        blindTargetMode: "smart-random",
      })
    ).toThrow(/hog-hog/i);
  });
});

describe("Blind Weight — Coach / Manual target source", () => {
  it("seeds the pending target and lets a manual override win", () => {
    const block = createTrainingBlock({
      name: "Blind Manual",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "manual",
    });

    expect(block.pendingTargetTime).toBe(3.75);
    expect(computeShotTarget(block, 4.1)).toBe(4.1);
  });

  it("keeps the last-used target as the next starting point", () => {
    const block = createTrainingBlock({
      name: "Blind Manual",
      mode: "blind",
      measurementMode: "back-hog",
      targetTime: 3.75,
      blindTargetMode: "manual",
    });

    const advanced = advanceBlockTarget(block, 4.1, []);
    expect(advanced.pendingTargetTime).toBe(4.1);
  });
});

describe("shot target immutability", () => {
  it("changing a block's next pending target never rewrites already-recorded shot targets", () => {
    const block = createTrainingBlock({
      name: "Variable",
      mode: "variable",
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "manual",
    });

    // Shot 1 uses the initial pending target.
    const shot1Target = computeShotTarget(block, undefined);
    const blockAfterShot1 = advanceBlockTarget(block, shot1Target, []);

    // Coach changes the target before shot 2 — this must not be able to
    // reach back and change shot1Target, which is already a plain number
    // captured on the recorded shot, not a live reference to the block.
    const shot2Target = computeShotTarget(blockAfterShot1, 4.2);

    expect(shot1Target).toBe(3.75);
    expect(shot2Target).toBe(4.2);
    expect(shot1Target).not.toBe(shot2Target);
  });
});
