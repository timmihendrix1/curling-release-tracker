// Evidence that existing consumers read measurement-aware data safely: each quantity
// keeps its own denominator, a missing value never becomes a zero, and the two units
// never meet in one calculation or one series.
import { describe, expect, it } from "vitest";
import {
  analyzeShots,
  computeQuantityAccuracyAnalytics,
  computeTargetAccuracyAnalytics,
} from "../../analytics";
import {
  prepareProgressMetricData,
  prepareShotQualityDistributionData,
  prepareTargetErrorByShotData,
  prepareTargetVsActualScatterData,
} from "../../chartData";
import { buildSessionCsv } from "../../export";
import { STANDARD_ACCURACY_THRESHOLDS } from "../../accuracyThresholds";
import { DEFAULT_SPEED_TOLERANCE, symmetricTolerance } from "../tolerance";
import {
  bothBlock,
  bothShot,
  legacyTimeBlock,
  session,
  speedBlock,
  speedShot,
  timeShot,
} from "./measurementFixtures";

function allNumbersFinite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(allNumbersFinite);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(allNumbersFinite);
  }
  return true;
}

describe("metric-specific denominators", () => {
  const block = bothBlock();
  // 2 stones with a time, 2 with a speed, only 1 with both.
  const shots = [
    bothShot(block, 3.75, 2.4, { id: "a" }),
    timeShot(block, 3.85, { id: "b" }),
    speedShot(block, 2.5, { id: "c" }),
  ];

  it("counts only time-measured stones for the time analysis", () => {
    const analysis = analyzeShots(shots, STANDARD_ACCURACY_THRESHOLDS);
    expect(analysis.count).toBe(2);
    expect(analysis.targetAccuracy.shotCount).toBe(2);
    // 3.75 and 3.85 — a missing time would have dragged this towards 0.
    expect(analysis.average).toBeCloseTo(3.8, 10);
  });

  it("counts only speed-measured stones for the speed analysis", () => {
    const speed = computeQuantityAccuracyAnalytics(shots, "speed", DEFAULT_SPEED_TOLERANCE);
    expect(speed.shotCount).toBe(2);
    // deviations: 0.00 and +0.10
    expect(speed.meanTargetError).toBeCloseTo(0.05, 10);
    expect(speed.onTargetCount).toBe(1);
    expect(speed.acceptableCount).toBe(1);
    expect(speed.majorMissCount).toBe(0);
  });

  it("keeps a partially measured stone fully counted by the quantity it does carry", () => {
    const timeOnlyDenominator = analyzeShots(shots).count;
    const speedDenominator = computeQuantityAccuracyAnalytics(
      shots,
      "speed",
      DEFAULT_SPEED_TOLERANCE
    ).shotCount;
    // Each quantity sees 2 of the 3 stones — the denominators are independent and
    // neither equals the raw stone count.
    expect(timeOnlyDenominator).toBe(2);
    expect(speedDenominator).toBe(2);
    expect(shots).toHaveLength(3);
  });

  it("produces no fabricated zero and no NaN anywhere in the analysis", () => {
    const analysis = analyzeShots(shots, STANDARD_ACCURACY_THRESHOLDS);
    expect(allNumbersFinite(analysis)).toBe(true);
    expect(analysis.min).toBeCloseTo(3.75, 10);
  });

  it("returns an empty analysis — not zeros from nowhere — when nothing measures time", () => {
    const speedOnly = speedBlock();
    const analysis = analyzeShots([speedShot(speedOnly, 2.4), speedShot(speedOnly, 2.5)]);
    expect(analysis.count).toBe(0);
    expect(analysis.targetAccuracy.shotCount).toBe(0);
    expect(analysis.targetAccuracy.onTargetRate).toBeNull();
    expect(analysis.average).toBe(0);
    expect(allNumbersFinite(analysis)).toBe(true);
  });

  it("matches the legacy analysis exactly for a purely time-only block", () => {
    const legacy = legacyTimeBlock();
    const legacyShots = [timeShot(legacy, 3.8), timeShot(legacy, 3.7), timeShot(legacy, 4.0)];
    const analysis = analyzeShots(legacyShots, STANDARD_ACCURACY_THRESHOLDS);
    expect(analysis.count).toBe(3);
    expect(analysis.targetAccuracy.shotCount).toBe(3);
    expect(analysis.average).toBeCloseTo((3.8 + 3.7 + 4.0) / 3, 10);
  });
});

describe("charts never plot a stone that has no value for that series", () => {
  const block = bothBlock();
  const blocksById = new Map([[block.id, block]]);
  const shots = [
    bothShot(block, 3.8, 2.4, { id: "a", shotNumber: 1 }),
    speedShot(block, 2.5, { id: "b", shotNumber: 2 }),
  ];

  it("omits a stone with no time from the Target Error series", () => {
    const points = prepareTargetErrorByShotData(shots, blocksById, STANDARD_ACCURACY_THRESHOLDS);
    expect(points).toHaveLength(1);
    expect(points[0].shotId).toBe("a");
    expect(allNumbersFinite(points)).toBe(true);
  });

  it("omits a stone with no time from the Target vs. Actual scatter", () => {
    const points = prepareTargetVsActualScatterData(shots, blocksById);
    expect(points).toHaveLength(1);
    expect(points[0].actualTime).toBeCloseTo(3.8, 10);
  });

  it("excludes a block with no time-measured stones from a progress series", () => {
    const entries = [
      {
        blockId: block.id,
        blockName: block.name,
        sessionTitle: "s",
        date: "2026-10-06T10:00:00.000Z",
        measurementMode: "back-hog" as const,
        thresholds: STANDARD_ACCURACY_THRESHOLDS,
        shots: [speedShot(block, 2.4)],
      },
    ];
    expect(prepareProgressMetricData(entries, "meanAbsoluteTargetError")).toEqual([]);
    expect(prepareShotQualityDistributionData(entries)).toEqual([]);
  });

  it("keeps a quality distribution's bars summing to 100% when some stones have no time", () => {
    const entries = [
      {
        blockId: block.id,
        blockName: block.name,
        sessionTitle: "s",
        date: "2026-10-06T10:00:00.000Z",
        measurementMode: "back-hog" as const,
        thresholds: STANDARD_ACCURACY_THRESHOLDS,
        shots,
      },
    ];
    const [point] = prepareShotQualityDistributionData(entries);
    expect(point.shotCount).toBe(1);
    expect(
      point.onTargetPercent + point.acceptablePercent + point.majorMissPercent
    ).toBeCloseTo(100, 10);
  });
});

describe("per-side tolerances reach the classification", () => {
  it("classifies a time deviation by the correct side when the block is asymmetric", () => {
    const asymmetric = symmetricTolerance(0.1, 0.2);
    const tight = { onTarget: { lower: 0.04, upper: 0.2 }, acceptable: { lower: 0.08, upper: 0.3 } };
    const block = bothBlock();
    const shots = [timeShot(block, 3.69), timeShot(block, 3.81)];

    // Symmetric: both are within 0.10 either way -> both On Target.
    expect(computeQuantityAccuracyAnalytics(shots, "time", asymmetric).onTargetCount).toBe(2);
    // Asymmetric with a tight lower side: the fast one drops to Acceptable.
    const result = computeQuantityAccuracyAnalytics(shots, "time", tight);
    expect(result.onTargetCount).toBe(1);
    expect(result.acceptableCount).toBe(1);
  });

  it("still matches the legacy symmetric path for a legacy threshold pair", () => {
    const block = legacyTimeBlock();
    const shots = [timeShot(block, 3.85), timeShot(block, 3.65), timeShot(block, 4.0)];
    expect(computeTargetAccuracyAnalytics(shots, STANDARD_ACCURACY_THRESHOLDS)).toEqual(
      computeQuantityAccuracyAnalytics(
        shots,
        "time",
        symmetricTolerance(
          STANDARD_ACCURACY_THRESHOLDS.onTarget,
          STANDARD_ACCURACY_THRESHOLDS.acceptable
        )
      )
    );
  });
});

describe("CSV export", () => {
  const block = bothBlock();
  const shots = [
    bothShot(block, 3.8, 2.43, { id: "a", shotNumber: 1 }),
    timeShot(block, 3.7, { id: "b", shotNumber: 2 }),
    speedShot(block, 2.5, { id: "c", shotNumber: 3 }),
  ];
  const csv = buildSessionCsv(session([block], shots));
  const [header, ...rows] = csv.split("\n");
  const columns = header.split(",");

  function cell(rowIndex: number, column: string): string {
    return rows[rowIndex].split(",")[columns.indexOf(column)];
  }

  it("exports one row per stone, never duplicating a stone that carries two measurements", () => {
    expect(rows).toHaveLength(3);
  });

  it("exports an empty field — never 0 — for a measurement the stone does not carry", () => {
    expect(cell(1, "speed")).toBe("");
    expect(cell(1, "target_speed")).toBe("");
    expect(cell(1, "speed_error")).toBe("");
    expect(cell(1, "speed_error_category")).toBe("");

    expect(cell(2, "release_time")).toBe("");
    expect(cell(2, "target_time")).toBe("");
    expect(cell(2, "target_error")).toBe("");
    expect(cell(2, "target_error_category")).toBe("");
  });

  it("exports both measurements with their own targets, errors and categories", () => {
    expect(cell(0, "release_time")).toBe("3.8");
    expect(cell(0, "target_time")).toBe("3.75");
    expect(cell(0, "speed")).toBe("2.43");
    expect(cell(0, "target_speed")).toBe("2.4");
    expect(cell(0, "speed_error")).toBe("0.03");
    expect(cell(0, "speed_error_category")).toBe("on_target");
    expect(cell(0, "measured_quantities")).toBe("time speed");
    expect(cell(0, "speed_source")).toBe("manual");
  });

  it("keeps every legacy column present and populated for a legacy block", () => {
    const legacy = legacyTimeBlock();
    const legacyCsv = buildSessionCsv(session([legacy], [timeShot(legacy, 3.85, { shotNumber: 1 })]));
    const [legacyHeader, legacyRow] = legacyCsv.split("\n");
    const legacyColumns = legacyHeader.split(",");
    const cells = legacyRow.split(",");

    expect(cells[legacyColumns.indexOf("release_time")]).toBe("3.85");
    expect(cells[legacyColumns.indexOf("target_time")]).toBe("3.75");
    expect(cells[legacyColumns.indexOf("target_error")]).toBe("0.1");
    expect(cells[legacyColumns.indexOf("target_error_category")]).toBe("on_target");
    expect(cells[legacyColumns.indexOf("accuracy_on_target_threshold")]).toBe("0.1");
    expect(cells[legacyColumns.indexOf("measured_quantities")]).toBe("time");
    expect(cells[legacyColumns.indexOf("speed")]).toBe("");
  });
});
