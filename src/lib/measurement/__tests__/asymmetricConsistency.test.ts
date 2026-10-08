// One block, one shot, one tolerance — every consumer must reach the same verdict.
// The reviewed defect: history aggregation used the block's asymmetric tolerance
// while the progress series still used the symmetric legacy pair, so the same stone
// was a Major Miss in one view and On Target in another.
import { describe, expect, it } from "vitest";
import {
  aggregateTargetAccuracyAcrossBlocks,
  buildHistoryAnalysisContext,
  createDefaultHistoryFilters,
} from "../../historyAnalysis";
import {
  prepareProgressMetricData,
  prepareShotQualityDistributionData,
  prepareTargetErrorByShotData,
} from "../../chartData";
import { buildSessionCsv } from "../../export";
import { bothBlock, session, speedShot, timeShot } from "./measurementFixtures";

/** Lower side far tighter than the upper side — the reviewed reproduction. */
const ASYMMETRIC = {
  onTarget: { lower: 0.01, upper: 0.2 },
  acceptable: { lower: 0.02, upper: 0.3 },
};

function asymmetricContext() {
  const block = bothBlock();
  block.measurement = structuredClone(block.measurement!);
  block.measurement.time!.tolerance = structuredClone(ASYMMETRIC);

  // Target 3.75, recorded 3.70 -> deviation -0.05, beyond the 0.02 lower Acceptable.
  const trainingSession = session([block], [timeShot(block, 3.7)]);

  return {
    block,
    trainingSession,
    context: buildHistoryAnalysisContext([trainingSession], {
      ...createDefaultHistoryFilters(),
      trainingCategory: "fixed",
      measurementMode: "back-hog",
      dateRange: { preset: "all" },
    }),
  };
}

describe("asymmetric tolerances are applied consistently", () => {
  it("history aggregation and the progress series agree on the same stone", () => {
    const { context } = asymmetricContext();

    const aggregate = aggregateTargetAccuracyAcrossBlocks(context.blocks);
    expect(aggregate.majorMissRate).toBe(1);

    const [point] = prepareProgressMetricData(context.progressEntries, "majorMissRate");
    expect(point.targetAccuracy.majorMissRate).toBe(aggregate.majorMissRate);
    expect(point.value).toBe(aggregate.majorMissRate);
  });

  it("the quality distribution agrees with the aggregate too", () => {
    const { context } = asymmetricContext();
    const [point] = prepareShotQualityDistributionData(context.progressEntries);
    expect(point.majorMissPercent).toBe(100);
    expect(point.onTargetPercent).toBe(0);
  });

  it("the per-shot chart classifies by the same per-side tolerance", () => {
    const { block, trainingSession } = asymmetricContext();
    const points = prepareTargetErrorByShotData(
      trainingSession.shots,
      new Map([[block.id, block]]),
      ASYMMETRIC
    );
    expect(points[0].category).toBe("major_miss");
  });

  it("the same deviation on the generous upper side is On Target", () => {
    const block = bothBlock();
    block.measurement = structuredClone(block.measurement!);
    block.measurement.time!.tolerance = structuredClone(ASYMMETRIC);
    const trainingSession = session([block], [timeShot(block, 3.8)]);

    const context = buildHistoryAnalysisContext([trainingSession], {
      ...createDefaultHistoryFilters(),
      trainingCategory: "fixed",
      measurementMode: "back-hog",
      dateRange: { preset: "all" },
    });

    expect(aggregateTargetAccuracyAcrossBlocks(context.blocks).onTargetRate).toBe(1);
    const [point] = prepareProgressMetricData(context.progressEntries, "onTargetRate");
    expect(point.targetAccuracy.onTargetRate).toBe(1);
  });

  it("exports all four time tolerance sides, which the legacy pair cannot represent", () => {
    const { block, trainingSession } = asymmetricContext();
    const [header, row] = buildSessionCsv(trainingSession).split("\n").map((line) => line.split(","));
    const cell = (column: string) => row[header.indexOf(column)];

    expect(cell("time_on_target_lower_tolerance")).toBe("0.01");
    expect(cell("time_on_target_upper_tolerance")).toBe("0.2");
    expect(cell("time_acceptable_lower_tolerance")).toBe("0.02");
    expect(cell("time_acceptable_upper_tolerance")).toBe("0.3");
    expect(cell("target_error_category")).toBe("major_miss");
    expect(cell("is_major_miss")).toBe("true");

    // The legacy symmetric columns are still present and unchanged in meaning.
    expect(cell("accuracy_on_target_threshold")).toBe("0.1");
    expect(cell("accuracy_acceptable_threshold")).toBe("0.2");
    expect(block.accuracyThresholds).toEqual({ onTarget: 0.1, acceptable: 0.2 });
  });
});

describe("absent time-derived results export as absent", () => {
  it("never reports is_major_miss=false for a stone with no time classification", () => {
    const block = bothBlock();
    const trainingSession = session([block], [speedShot(block, 2.4)]);
    const [header, row] = buildSessionCsv(trainingSession).split("\n").map((line) => line.split(","));
    const cell = (column: string) => row[header.indexOf(column)];

    expect(cell("target_error_category")).toBe("");
    expect(cell("is_major_miss")).toBe("");
    expect(cell("release_time")).toBe("");
    expect(cell("target_error")).toBe("");
    // The speed half is present and classified on its own terms.
    expect(cell("speed")).toBe("2.4");
    expect(cell("speed_error_category")).toBe("on_target");
  });
});
