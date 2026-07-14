import { describe, expect, it } from "vitest";
import {
  groupProgressEntriesByMeasurementMode,
  hasMultipleTargetTimes,
  hasUniformThresholds,
  prepareProgressMetricData,
  prepareShotQualityDistributionData,
  prepareTargetErrorByShotData,
  prepareTargetVsActualScatterData,
  type ProgressBlockEntry,
} from "../chartData";
import type { Shot, TrainingBlock } from "../../types";

const THRESHOLDS = { onTarget: 0.1, acceptable: 0.2 };

function makeShot(overrides: Partial<Shot>): Shot {
  return {
    id: overrides.id ?? Math.random().toString(36),
    sessionId: "session-1",
    blockId: "block-1",
    shotNumber: 1,
    releaseTime: 3.75,
    targetTime: 3.75,
    handle: "in",
    shotType: "draw",
    createdAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TrainingBlock>): TrainingBlock {
  return {
    id: "block-1",
    name: "Block A",
    mode: "fixed",
    measurementMode: "back-hog",
    targetTime: 3.75,
    createdAt: new Date(0).toISOString(),
    accuracyThresholds: THRESHOLDS,
    ...overrides,
  };
}

describe("prepareTargetErrorByShotData", () => {
  it("shapes shots into chart points with category and block name", () => {
    const block = makeBlock({ id: "b1", name: "Draw Ladder" });
    const shots = [
      makeShot({ id: "1", blockId: "b1", shotNumber: 1, targetTime: 3.75, releaseTime: 3.8 }),
      makeShot({ id: "2", blockId: "b1", shotNumber: 2, targetTime: 3.75, releaseTime: 4.1 }),
    ];
    const blocksById = new Map([["b1", block]]);

    const points = prepareTargetErrorByShotData(shots, blocksById, THRESHOLDS);
    expect(points).toHaveLength(2);
    expect(points[0].targetError).toBeCloseTo(0.05, 10);
    expect(points[0].category).toBe("on_target");
    expect(points[0].blockName).toBe("Draw Ladder");
    expect(points[1].category).toBe("major_miss");
  });

  it("preserves input order (caller controls shot-number ordering)", () => {
    const shots = [
      makeShot({ id: "2", shotNumber: 2 }),
      makeShot({ id: "1", shotNumber: 1 }),
    ];
    const points = prepareTargetErrorByShotData(shots, new Map(), THRESHOLDS);
    expect(points.map((p) => p.shotId)).toEqual(["2", "1"]);
  });

  it("falls back to an empty block name when the block is unknown", () => {
    const points = prepareTargetErrorByShotData(
      [makeShot({ blockId: "missing" })],
      new Map(),
      THRESHOLDS
    );
    expect(points[0].blockName).toBe("");
  });
});

describe("prepareTargetVsActualScatterData", () => {
  it("shapes shots into target/actual points with optional session context", () => {
    const block = makeBlock({ id: "b1", name: "Fixed A" });
    const shots = [makeShot({ id: "1", blockId: "b1", targetTime: 3.5, releaseTime: 3.6 })];
    const blocksById = new Map([["b1", block]]);
    const sessionContext = new Map([
      ["b1", { sessionTitle: "Session 1", date: "2026-01-01" }],
    ]);

    const points = prepareTargetVsActualScatterData(shots, blocksById, sessionContext);
    expect(points[0].targetTime).toBe(3.5);
    expect(points[0].actualTime).toBe(3.6);
    expect(points[0].targetError).toBeCloseTo(0.1, 10);
    expect(points[0].sessionTitle).toBe("Session 1");
  });

  it("never shifts target/actual values — plotted exactly as recorded", () => {
    const shots = [makeShot({ targetTime: 4.123, releaseTime: 4.456 })];
    const points = prepareTargetVsActualScatterData(shots, new Map());
    expect(points[0].targetTime).toBe(4.123);
    expect(points[0].actualTime).toBe(4.456);
  });
});

describe("hasMultipleTargetTimes", () => {
  it("is false for a single target time (Fixed Weight, one block)", () => {
    expect(hasMultipleTargetTimes([{ targetTime: 3.75 }, { targetTime: 3.75 }])).toBe(
      false
    );
  });

  it("is true once at least two distinct target times appear", () => {
    expect(hasMultipleTargetTimes([{ targetTime: 3.75 }, { targetTime: 4.0 }])).toBe(
      true
    );
  });

  it("is false (not thrown) for an empty list", () => {
    expect(hasMultipleTargetTimes([])).toBe(false);
  });
});

describe("hasUniformThresholds", () => {
  it("is true for a single block or an empty selection", () => {
    expect(hasUniformThresholds([])).toBe(true);
    expect(hasUniformThresholds([THRESHOLDS])).toBe(true);
  });

  it("is true when every block shares identical thresholds", () => {
    expect(
      hasUniformThresholds([THRESHOLDS, { onTarget: 0.1, acceptable: 0.2 }])
    ).toBe(true);
  });

  it("is false when thresholds differ across blocks", () => {
    expect(
      hasUniformThresholds([THRESHOLDS, { onTarget: 0.05, acceptable: 0.1 }])
    ).toBe(false);
  });
});

function makeEntry(overrides: Partial<ProgressBlockEntry>): ProgressBlockEntry {
  return {
    blockId: overrides.blockId ?? Math.random().toString(36),
    blockName: "Block",
    sessionTitle: "Session",
    date: "2026-01-01T00:00:00.000Z",
    measurementMode: "back-hog",
    thresholds: THRESHOLDS,
    shots: [makeShot({ targetTime: 3.75, releaseTime: 3.8 })],
    ...overrides,
  };
}

describe("groupProgressEntriesByMeasurementMode", () => {
  it("never mixes Back-Hog and Hog-Hog on the same series", () => {
    const entries = [
      makeEntry({ blockId: "1", measurementMode: "back-hog" }),
      makeEntry({ blockId: "2", measurementMode: "hog-hog" }),
      makeEntry({ blockId: "3", measurementMode: "back-hog" }),
    ];
    const grouped = groupProgressEntriesByMeasurementMode(entries);
    expect(grouped["back-hog"]).toHaveLength(2);
    expect(grouped["hog-hog"]).toHaveLength(1);
  });
});

describe("prepareProgressMetricData", () => {
  it("sorts chronologically and excludes empty blocks", () => {
    const entries = [
      makeEntry({ blockId: "later", date: "2026-02-01T00:00:00.000Z" }),
      makeEntry({ blockId: "empty", date: "2026-01-15T00:00:00.000Z", shots: [] }),
      makeEntry({ blockId: "earlier", date: "2026-01-01T00:00:00.000Z" }),
    ];
    const points = prepareProgressMetricData(entries, "meanAbsoluteTargetError", 3);
    expect(points.map((p) => p.blockId)).toEqual(["earlier", "later"]);
  });

  it("computes the requested metric per block", () => {
    const entries = [
      makeEntry({
        blockId: "1",
        shots: [makeShot({ targetTime: 3.75, releaseTime: 3.85 })],
      }),
    ];
    const points = prepareProgressMetricData(entries, "meanAbsoluteTargetError");
    expect(points[0].value).toBeCloseTo(0.1, 10);
  });

  it("never fabricates a zero for missing data — excluded blocks simply aren't in the series", () => {
    const points = prepareProgressMetricData(
      [makeEntry({ shots: [] })],
      "onTargetRate"
    );
    expect(points).toEqual([]);
  });

  it("computes a rolling average only once the window is fully populated", () => {
    const entries = ["1", "2", "3", "4"].map((id, index) =>
      makeEntry({
        blockId: id,
        date: new Date(2026, 0, index + 1).toISOString(),
        shots: [makeShot({ targetTime: 3.75, releaseTime: 3.75 + index * 0.05 })],
      })
    );
    const points = prepareProgressMetricData(entries, "meanAbsoluteTargetError", 3);
    expect(points[0].rollingAverage).toBeNull();
    expect(points[1].rollingAverage).toBeNull();
    expect(points[2].rollingAverage).not.toBeNull();
    expect(points[3].rollingAverage).not.toBeNull();
  });

  it("too few blocks for the rolling window -> raw points still returned, no rolling average", () => {
    const entries = [makeEntry({ blockId: "1" }), makeEntry({ blockId: "2" })];
    const points = prepareProgressMetricData(entries, "meanAbsoluteTargetError", 3);
    expect(points).toHaveLength(2);
    expect(points.every((p) => p.rollingAverage === null)).toBe(true);
  });
});

describe("prepareShotQualityDistributionData", () => {
  it("produces a 100%-partitioned distribution per block using its own thresholds", () => {
    const entries = [
      makeEntry({
        blockId: "1",
        thresholds: THRESHOLDS,
        shots: [
          makeShot({ targetTime: 3.75, releaseTime: 3.8 }), // 0.05 -> on_target
          makeShot({ targetTime: 3.75, releaseTime: 3.9 }), // 0.15 -> acceptable
          makeShot({ targetTime: 3.75, releaseTime: 4.2 }), // 0.45 -> major_miss
          makeShot({ targetTime: 3.75, releaseTime: 4.2 }), // 0.45 -> major_miss
        ],
      }),
    ];
    const points = prepareShotQualityDistributionData(entries);
    expect(points[0].onTargetPercent).toBeCloseTo(25, 10);
    expect(points[0].acceptablePercent).toBeCloseTo(25, 10);
    expect(points[0].majorMissPercent).toBeCloseTo(50, 10);
    expect(
      points[0].onTargetPercent +
        points[0].acceptablePercent +
        points[0].majorMissPercent
    ).toBeCloseTo(100, 10);
  });

  it("excludes empty blocks rather than showing a fabricated 0% distribution", () => {
    const points = prepareShotQualityDistributionData([makeEntry({ shots: [] })]);
    expect(points).toEqual([]);
  });
});
