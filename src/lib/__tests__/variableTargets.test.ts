import { describe, expect, it } from "vitest";
import {
  LARGE_JUMP_PROBABILITY,
  TYPICAL_MAX_DELTA,
  buildSmartRandomCandidates,
  generateSmartRandomTarget,
  isSmartRandomAvailable,
  validateSmartRandomRange,
} from "../variableTargets";

const WIDE_RANGE = { min: 2.5, max: 4.5 };

describe("validateSmartRandomRange", () => {
  it("accepts a valid range and normalizes it to the step grid", () => {
    const result = validateSmartRandomRange(3.8, 4.4);
    expect(result).toEqual({ valid: true, min: 3.8, max: 4.4 });
  });

  it("rejects a minimum of 0 or less", () => {
    expect(validateSmartRandomRange(0, 4.5).valid).toBe(false);
    expect(validateSmartRandomRange(-1, 4.5).valid).toBe(false);
  });

  it("rejects a maximum that isn't greater than the minimum", () => {
    expect(validateSmartRandomRange(3.5, 3.5).valid).toBe(false);
    expect(validateSmartRandomRange(3.5, 3.2).valid).toBe(false);
  });

  it("rejects a range narrower than 0.10s", () => {
    expect(validateSmartRandomRange(3.5, 3.55).valid).toBe(false);
    expect(validateSmartRandomRange(3.5, 3.6).valid).toBe(true);
  });

  it("rejects non-numeric input", () => {
    expect(validateSmartRandomRange(NaN, 4.5).valid).toBe(false);
    expect(validateSmartRandomRange(3.5, NaN).valid).toBe(false);
  });

  it("normalizes values to the nearest 0.05s step", () => {
    const result = validateSmartRandomRange(3.82, 4.37);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.min).toBe(3.8);
      expect(result.max).toBe(4.35);
    }
  });

  it("does not enforce any hard upper sporting bound", () => {
    // Deliberately unusual training range — must still be accepted.
    expect(validateSmartRandomRange(5.0, 8.0).valid).toBe(true);
  });
});

describe("isSmartRandomAvailable", () => {
  it("is available for back-hog and not for hog-hog", () => {
    expect(isSmartRandomAvailable("back-hog")).toBe(true);
    expect(isSmartRandomAvailable("hog-hog")).toBe(false);
  });
});

describe("generateSmartRandomTarget — range and step", () => {
  it("always returns a value within the given range", () => {
    for (let i = 0; i < 300; i++) {
      const target = generateSmartRandomTarget({ ...WIDE_RANGE, randomFn: Math.random });
      expect(target).toBeGreaterThanOrEqual(WIDE_RANGE.min);
      expect(target).toBeLessThanOrEqual(WIDE_RANGE.max);
    }
  });

  it("only returns values aligned to the 0.05s step", () => {
    const candidates = new Set(buildSmartRandomCandidates(WIDE_RANGE));

    for (let i = 0; i < 300; i++) {
      const target = generateSmartRandomTarget({ ...WIDE_RANGE, randomFn: Math.random });
      expect(candidates.has(target)).toBe(true);
    }
  });

  it("the first target of a block may come from the entire range (no prior target)", () => {
    // Force the "typical" branch's random draw (irrelevant here, since
    // there's no lastTarget) and pick the very first candidate (2.50).
    const target = generateSmartRandomTarget({ ...WIDE_RANGE, recentTargets: [], randomFn: () => 0 });
    expect(target).toBe(WIDE_RANGE.min);
  });

  it("small ranges work", () => {
    const small = { min: 3.0, max: 3.15 };
    const candidates = new Set(buildSmartRandomCandidates(small));

    for (let i = 0; i < 100; i++) {
      const target = generateSmartRandomTarget({ ...small, recentTargets: [3.05], randomFn: Math.random });
      expect(candidates.has(target)).toBe(true);
    }
  });

  it("boundary values work (target exactly at min or max)", () => {
    const target = generateSmartRandomTarget({
      ...WIDE_RANGE,
      recentTargets: [WIDE_RANGE.max],
      randomFn: () => 0.99, // avoid forcing a large jump; stay near the edge
    });
    expect(target).toBeGreaterThanOrEqual(WIDE_RANGE.min);
    expect(target).toBeLessThanOrEqual(WIDE_RANGE.max);
  });

  it("never hangs on a range with very few candidates (min===max after rounding is rejected upstream, but a 2-candidate range must still resolve)", () => {
    const tiny = { min: 3.0, max: 3.1 }; // exactly 3 candidates: 3.00, 3.05, 3.10
    const target = generateSmartRandomTarget({
      ...tiny,
      recentTargets: [3.0, 3.05, 3.1],
      randomFn: () => 0,
    });
    expect([3.0, 3.05, 3.1]).toContain(target);
  });
});

describe("generateSmartRandomTarget — avoiding repeats", () => {
  it("avoids exactly repeating the most recent target when alternatives exist", () => {
    const target = generateSmartRandomTarget({
      ...WIDE_RANGE,
      recentTargets: [3.75],
      randomFn: () => 0.5, // typical-delta branch
    });
    expect(target).not.toBe(3.75);
  });

  it("falls back to the unfiltered pool rather than looping when avoidance would exclude every candidate", () => {
    // A single-candidate "range" (degenerate on purpose, to force the case
    // where repeat-avoidance would otherwise leave nothing to pick from).
    const singleCandidate = { min: 3.75, max: 3.75 };
    const target = generateSmartRandomTarget({
      ...singleCandidate,
      recentTargets: [3.75, 3.75],
      randomFn: () => 0,
    });
    expect(target).toBe(3.75);
  });
});

describe("generateSmartRandomTarget — natural transitions", () => {
  it("the typical case (randomFn below LARGE_JUMP_PROBABILITY forces the jump branch instead) stays within TYPICAL_MAX_DELTA", () => {
    // First randomFn() call decides jump-vs-typical; returning something
    // >= LARGE_JUMP_PROBABILITY selects the *typical* branch.
    const randomSequence = [0.9, 0.9, 0.9, 0.9];
    let call = 0;
    const randomFn = () => randomSequence[call++ % randomSequence.length];

    const lastTarget = 3.75;
    const target = generateSmartRandomTarget({
      ...WIDE_RANGE,
      recentTargets: [lastTarget],
      randomFn,
    });

    expect(Math.abs(target - lastTarget)).toBeLessThanOrEqual(TYPICAL_MAX_DELTA + 1e-9);
  });

  it("a forced large jump (randomFn below LARGE_JUMP_PROBABILITY) may exceed TYPICAL_MAX_DELTA and still stay in range", () => {
    // First call < LARGE_JUMP_PROBABILITY selects the jump branch; second
    // call picks the highest candidate (index near the end of the pool).
    const randomFn = (() => {
      let call = 0;
      return () => (call++ === 0 ? 0 : 0.999);
    })();

    const lastTarget = 2.5; // range minimum
    const target = generateSmartRandomTarget({
      ...WIDE_RANGE,
      recentTargets: [lastTarget],
      randomFn,
    });

    // Picking near the top of the pool from the minimum must be able to
    // exceed a same-side-only 0.40s window (the whole range is 2.0s wide).
    expect(target).toBeGreaterThan(lastTarget + TYPICAL_MAX_DELTA);
    expect(target).toBeLessThanOrEqual(WIDE_RANGE.max);
  });

  it("LARGE_JUMP_PROBABILITY is respected as the threshold: exactly at the boundary counts as typical", () => {
    // randomFn() returning exactly LARGE_JUMP_PROBABILITY is NOT < it, so
    // this must take the typical path.
    const lastTarget = 3.75;
    const target = generateSmartRandomTarget({
      ...WIDE_RANGE,
      recentTargets: [lastTarget],
      randomFn: () => LARGE_JUMP_PROBABILITY,
    });
    expect(Math.abs(target - lastTarget)).toBeLessThanOrEqual(TYPICAL_MAX_DELTA + 1e-9);
  });

  it("when the whole range is narrower than TYPICAL_MAX_DELTA, the typical case simply uses the whole range", () => {
    const narrow = { min: 3.8, max: 4.0 }; // 0.20s wide, narrower than 0.40s
    const target = generateSmartRandomTarget({
      ...narrow,
      recentTargets: [3.8],
      randomFn: () => 0.9, // typical branch
    });
    expect(target).toBeGreaterThanOrEqual(narrow.min);
    expect(target).toBeLessThanOrEqual(narrow.max);
  });

  it("uses the last 2-3 real shot targets, not the whole history, for its transition decision", () => {
    // Only the tail of a long history should matter; passing extra old
    // entries far outside the delta window must not affect the outcome
    // when the typical branch is forced.
    const longHistory = [2.5, 2.5, 2.5, 2.5, 2.5, 3.75];
    const target = generateSmartRandomTarget({
      ...WIDE_RANGE,
      recentTargets: longHistory,
      randomFn: () => 0.9, // typical branch, stays close to 3.75 (the tail)
    });
    expect(Math.abs(target - 3.75)).toBeLessThanOrEqual(TYPICAL_MAX_DELTA + 1e-9);
  });
});

describe("generateSmartRandomTarget — purity and safety", () => {
  it("is a pure function: same inputs always produce the same output", () => {
    const input = { ...WIDE_RANGE, recentTargets: [3.5, 3.6], randomFn: () => 0.42 };
    expect(generateSmartRandomTarget(input)).toBe(generateSmartRandomTarget(input));
  });

  it("does not mutate the recentTargets array passed in", () => {
    const recentTargets = [3.5, 3.6];
    const snapshot = [...recentTargets];
    generateSmartRandomTarget({ ...WIDE_RANGE, recentTargets, randomFn: () => 0.1 });
    expect(recentTargets).toEqual(snapshot);
  });

  it("resolves synchronously in a bounded number of randomFn calls (no loop)", () => {
    let calls = 0;
    const randomFn = () => {
      calls += 1;
      if (calls > 10) throw new Error("generateSmartRandomTarget looped unexpectedly");
      return 0.5;
    };

    generateSmartRandomTarget({ ...WIDE_RANGE, recentTargets: [3.75], randomFn });
    expect(calls).toBeLessThanOrEqual(2);
  });
});
