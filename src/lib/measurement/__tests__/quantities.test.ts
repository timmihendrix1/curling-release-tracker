import { describe, expect, it } from "vitest";
import { STANDARD_ACCURACY_THRESHOLDS } from "../../accuracyThresholds";
import { createTrainingBlock, getNextShotTarget } from "../../trainingBlocks";
import {
  blockMeasures,
  blockQuantityTarget,
  blockTolerance,
  isSpeedMeasuredShot,
  isTimeMeasuredShot,
  missingQuantitiesForShot,
  normalizeBlockMeasurementConfiguration,
  resolveBlockMeasurement,
  shotDeviation,
  shotHasAnyMeasurement,
  shotMeasuredQuantities,
  speedMeasuredShots,
  timeMeasuredShots,
} from "../quantities";
import { symmetricTolerance } from "../tolerance";
import {
  BOTH_CONFIGURATION,
  bothBlock,
  bothShot,
  legacyTimeBlock,
  speedBlock,
  speedShot,
  SPEED_CONFIGURATION,
  timeBlock,
  timeShot,
  shot,
} from "./measurementFixtures";

describe("resolveBlockMeasurement", () => {
  it("resolves a legacy block (no measurement field) as time-only from its own stored values", () => {
    const block = legacyTimeBlock({
      targetTime: 4.1,
      accuracyThresholds: { onTarget: 0.07, acceptable: 0.13 },
    });

    expect(block.measurement).toBeUndefined();
    expect(resolveBlockMeasurement(block)).toEqual({
      quantities: ["time"],
      time: {
        target: 4.1,
        tolerance: symmetricTolerance(0.07, 0.13),
      },
    });
  });

  it("resolves each of the three configurations", () => {
    expect(resolveBlockMeasurement(timeBlock()).quantities).toEqual(["time"]);
    expect(resolveBlockMeasurement(speedBlock()).quantities).toEqual(["speed"]);
    expect(resolveBlockMeasurement(bothBlock()).quantities).toEqual(["time", "speed"]);
  });

  it("gives a speed-only block a speed target and NO time target or timing interval", () => {
    const block = speedBlock();
    expect(block.targetTime).toBeUndefined();
    expect(block.measurementMode).toBeUndefined();
    expect(blockQuantityTarget(block, "speed")).toBe(2.4);
    expect(blockQuantityTarget(block, "time")).toBeUndefined();
    expect(blockTolerance(block, "time")).toBeUndefined();
    expect(blockMeasures(block, "time")).toBe(false);
    expect(blockMeasures(block, "speed")).toBe(true);
  });

  it("yields no analyzable quantity for a block that is neither legacy nor configured, instead of inventing 3.75s", () => {
    const malformed = { targetTime: undefined, accuracyThresholds: undefined, measurement: undefined };
    expect(resolveBlockMeasurement(malformed)).toEqual({ quantities: [] });
  });

  it("ignores a configuration entry whose target or tolerance is unusable", () => {
    expect(
      resolveBlockMeasurement({
        measurement: { quantities: ["speed"], speed: { target: 0, tolerance: symmetricTolerance(0.05, 0.1) } },
      })
    ).toEqual({ quantities: [] });
  });
});

describe("normalizeBlockMeasurementConfiguration", () => {
  it("puts quantities in canonical order", () => {
    const normalized = normalizeBlockMeasurementConfiguration({
      ...BOTH_CONFIGURATION,
      quantities: ["speed", "time"],
    });
    expect(normalized?.quantities).toEqual(["time", "speed"]);
  });

  it("rejects a duplicated quantity instead of silently rewriting the stored list", () => {
    expect(
      normalizeBlockMeasurementConfiguration({
        ...BOTH_CONFIGURATION,
        quantities: ["speed", "time", "speed"],
      })
    ).toBeUndefined();
  });

  it("rejects an unknown quantity rather than filtering it out", () => {
    // Silently dropping a quantity this build does not understand would downgrade the
    // data and then persist the downgrade over the original.
    expect(
      normalizeBlockMeasurementConfiguration({
        ...BOTH_CONFIGURATION,
        quantities: ["time", "speed", "future-spin"],
      })
    ).toBeUndefined();
  });

  it("rejects a null metric configuration without throwing", () => {
    expect(() =>
      normalizeBlockMeasurementConfiguration({ quantities: ["speed"], speed: null })
    ).not.toThrow();
    expect(
      normalizeBlockMeasurementConfiguration({ quantities: ["speed"], speed: null })
    ).toBeUndefined();
  });

  it("rejects a configuration entry for a quantity it does not declare", () => {
    expect(
      normalizeBlockMeasurementConfiguration({
        quantities: ["time"],
        time: BOTH_CONFIGURATION.time,
        speed: BOTH_CONFIGURATION.speed,
      })
    ).toBeUndefined();
  });

  it("returns a deep copy so a later caller mutation cannot reach the snapshot", () => {
    const source = structuredClone(BOTH_CONFIGURATION);
    const normalized = normalizeBlockMeasurementConfiguration(source);
    source.speed!.tolerance.onTarget.upper = 0.8;
    source.quantities.push("time");
    expect(normalized?.speed?.tolerance.onTarget.upper).toBe(0.05);
    expect(normalized?.quantities).toEqual(["time", "speed"]);
  });

  it("rejects a configuration listing a quantity it carries no entry for", () => {
    expect(
      normalizeBlockMeasurementConfiguration({ quantities: ["time", "speed"], time: BOTH_CONFIGURATION.time })
    ).toBeUndefined();
  });

  it("rejects an empty or absent configuration rather than defaulting it", () => {
    expect(normalizeBlockMeasurementConfiguration({ quantities: [] })).toBeUndefined();
    expect(normalizeBlockMeasurementConfiguration(undefined)).toBeUndefined();
  });
});

describe("createTrainingBlock measurement validation", () => {
  it("creates the exact historical shape when no measurement is supplied", () => {
    const block = createTrainingBlock({
      name: "Legacy",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      accuracyThresholds: STANDARD_ACCURACY_THRESHOLDS,
    });
    expect(Object.keys(block)).not.toContain("measurement");
  });

  it("refuses a measurement configuration on Variable or Blind Weight", () => {
    for (const mode of ["variable", "blind"] as const) {
      expect(() =>
        createTrainingBlock({
          name: "x",
          mode,
          measurementMode: "back-hog",
          targetTime: 3.75,
          measurement: SPEED_CONFIGURATION,
        })
      ).toThrow(/Only Fixed Weight/);
    }
  });

  it("refuses a speed-only block that still carries a timing interval or time target", () => {
    expect(() =>
      createTrainingBlock({
        name: "x",
        mode: "fixed",
        measurementMode: "back-hog",
        measurement: SPEED_CONFIGURATION,
      })
    ).toThrow(/speed-only/);

    expect(() =>
      createTrainingBlock({
        name: "x",
        mode: "fixed",
        targetTime: 3.75,
        measurement: SPEED_CONFIGURATION,
      })
    ).toThrow(/speed-only/);
  });

  it("requires a timing interval when the block measures time", () => {
    expect(() =>
      createTrainingBlock({ name: "x", mode: "fixed", targetTime: 3.75, measurement: BOTH_CONFIGURATION })
    ).toThrow(/timing interval/);
  });

  it("requires a time target when a time-only block supplies no configuration", () => {
    expect(() =>
      createTrainingBlock({ name: "x", mode: "fixed", measurementMode: "back-hog" })
    ).toThrow(/target time/);
  });

  it("takes the time target from the configuration, which is the single authority", () => {
    // The caller's `targetTime` and the configuration's target cannot disagree,
    // because only one of them is ever the source.
    const configuration = structuredClone(BOTH_CONFIGURATION);
    configuration.time!.target = 4;
    const block = createTrainingBlock({
      name: "Both",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      measurement: configuration,
    });
    expect(block.targetTime).toBe(4);
    expect(blockQuantityTarget(block, "time")).toBe(4);
    expect(getNextShotTarget(block)).toBe(blockQuantityTarget(block, "time"));
  });

  it("isolates the created block from later mutation of the supplied configuration", () => {
    const configuration = structuredClone(BOTH_CONFIGURATION);
    const block = createTrainingBlock({
      name: "Both",
      mode: "fixed",
      measurementMode: "back-hog",
      targetTime: 3.75,
      measurement: configuration,
    });
    configuration.speed!.tolerance.onTarget.upper = 0.8;
    configuration.speed!.target = 9;
    expect(block.measurement!.speed!.tolerance.onTarget.upper).toBe(0.05);
    expect(block.measurement!.speed!.target).toBe(2.4);
  });

  it("refuses an invalid tolerance rather than silently downgrading the block to time-only", () => {
    expect(() =>
      createTrainingBlock({
        name: "x",
        mode: "fixed",
        measurement: {
          quantities: ["speed"],
          speed: { target: 2.4, tolerance: { onTarget: { lower: 0.2, upper: 0.05 }, acceptable: { lower: 0.1, upper: 0.1 } } },
        },
      })
    ).toThrow(/Acceptable/);
  });
});

describe("per-stone measurement eligibility", () => {
  const both = bothBlock();

  it("recognises a fully measured Both stone", () => {
    const stone = bothShot(both, 3.8, 2.42);
    expect(isTimeMeasuredShot(stone)).toBe(true);
    expect(isSpeedMeasuredShot(stone)).toBe(true);
    expect(shotMeasuredQuantities(stone)).toEqual(["time", "speed"]);
    expect(missingQuantitiesForShot(both, stone)).toEqual([]);
  });

  it("recognises a Both stone missing its speed", () => {
    const stone = timeShot(both, 3.8);
    expect(isTimeMeasuredShot(stone)).toBe(true);
    expect(isSpeedMeasuredShot(stone)).toBe(false);
    expect(missingQuantitiesForShot(both, stone)).toEqual(["speed"]);
  });

  it("recognises a Both stone missing its time", () => {
    const stone = speedShot(both, 2.42);
    expect(isTimeMeasuredShot(stone)).toBe(false);
    expect(isSpeedMeasuredShot(stone)).toBe(true);
    expect(missingQuantitiesForShot(both, stone)).toEqual(["time"]);
  });

  it("treats a value without its own target as not measured, rather than borrowing the block's", () => {
    const orphanValue = shot(both, { releaseTime: 3.8 });
    const orphanTarget = shot(both, { targetTime: 3.75 });
    expect(isTimeMeasuredShot(orphanValue)).toBe(false);
    expect(isTimeMeasuredShot(orphanTarget)).toBe(false);
    expect(shotHasAnyMeasurement(orphanValue)).toBe(false);
  });

  it("never treats a missing value as zero", () => {
    const stone = speedShot(both, 2.42);
    expect(stone.releaseTime).toBeUndefined();
    expect(shotDeviation(stone, "time")).toBeNull();
    expect(shotDeviation(stone, "speed")).toBeCloseTo(0.02, 10);
  });

  it("rejects a non-positive measured value as not a measurement", () => {
    expect(isTimeMeasuredShot(shot(both, { releaseTime: 0, targetTime: 3.75 }))).toBe(false);
    expect(isSpeedMeasuredShot(shot(both, { speed: -1, targetSpeed: 2.4 }))).toBe(false);
  });

  it("selects each quantity's own independent subset", () => {
    const shots = [
      bothShot(both, 3.8, 2.42),
      timeShot(both, 3.7),
      speedShot(both, 2.38),
      shot(both),
    ];
    expect(timeMeasuredShots(shots)).toHaveLength(2);
    expect(speedMeasuredShots(shots)).toHaveLength(2);
  });
});
