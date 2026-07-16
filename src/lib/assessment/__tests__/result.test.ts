import { describe, expect, it } from "vitest";
import { addInvalidAttempt } from "../attempts";
import { getCurrentPlannedShot } from "../progress";
import {
  buildAssessmentResultView,
  buildAssessmentTrendSeries,
  buildInvalidAttemptRows,
  buildProtocolIntegritySummary,
  buildShotDetailRows,
  compareAssessmentRuns,
  computeBlockResults,
  computeHandleComparison,
  computeTargetResults,
  computeVariableAdaptationResult,
  deliveryLabelForTarget,
  describeIneligibilityReasons,
  findLatestEligiblePreviousRun,
  findProtocolCompatibleRuns,
  resolveAnalysisThresholdSet,
} from "../result";
import { createAssessmentRun, transitionAssessmentRun } from "../run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { standardAssessmentThresholdSet, tightAssessmentThresholdSet } from "../thresholds";
import type { AssessmentRun } from "../types";
import {
  abandonTestRun,
  completeAllScoredShots,
  completeAllScoredShotsCustom,
  completeWarmup,
  expectErr,
  expectOk,
  manualTimingProviderSnapshot,
} from "./testHelpers";

function buildIncompleteRun(): AssessmentRun {
  let run = expectOk(
    createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    })
  );
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  return abandonTestRun(run);
}

function buildCompletedRun(options: {
  completedAt?: string;
  scoredShotBuilder?: Parameters<typeof completeAllScoredShotsCustom>[1];
} = {}): AssessmentRun {
  let run = expectOk(
    createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    })
  );
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  run = options.scoredShotBuilder
    ? completeAllScoredShotsCustom(run, options.scoredShotBuilder)
    : completeAllScoredShots(run);
  run = expectOk(transitionAssessmentRun(run, "completed", { at: options.completedAt }));
  return run;
}

describe("computeBlockResults", () => {
  it("splits a perfectly on-target run into 4 blocks with zero error", () => {
    const run = buildCompletedRun();
    const blocks = computeBlockResults(run, standardAssessmentThresholdSet().values);

    expect(blocks).toHaveLength(4);
    for (const block of blocks) {
      expect(block.metrics.count).toBe(8);
      expect(block.metrics.meanAbsoluteError).toBe(0);
      expect(block.metrics.bias).toBe(0);
      expect(block.metrics.standardDeviation).toBe(0);
      expect(block.metrics.onTargetRate).toBe(1);
      expect(block.metrics.majorMissRate).toBe(0);
    }
    expect(blocks[0].targetTimes).toEqual([3.75]);
    expect(blocks[1].targetTimes).toEqual([4]);
    expect(blocks[2].targetTimes).toEqual([3.5]);
    expect(blocks[3].targetTimes).toEqual([3.5, 3.75, 4]);
  });

  it("never shows a block score or ranking field", () => {
    const run = buildCompletedRun();
    const blocks = computeBlockResults(run, standardAssessmentThresholdSet().values);
    for (const block of blocks) {
      expect(block).not.toHaveProperty("score");
      expect(block).not.toHaveProperty("rank");
    }
  });
});

describe("computeTargetResults", () => {
  it("combines every block including Variable Adaptation, with the documented counts", () => {
    const run = buildCompletedRun();
    const targets = computeTargetResults(run, standardAssessmentThresholdSet().values);

    const byTarget = new Map(targets.map((target) => [target.targetTime, target]));
    expect(byTarget.get(3.5)?.metrics.count).toBe(11); // Block 3 (8) + Variable Adaptation (3)
    expect(byTarget.get(3.75)?.metrics.count).toBe(10); // Block 1 (8) + Variable Adaptation (2)
    expect(byTarget.get(4)?.metrics.count).toBe(11); // Block 2 (8) + Variable Adaptation (3)

    const total = targets.reduce((sum, target) => sum + target.metrics.count, 0);
    expect(total).toBe(32);
  });

  it("uses Fast/Medium/Slow Delivery naming, never a stone-position label", () => {
    expect(deliveryLabelForTarget(3.5)).toBe("Fast Delivery");
    expect(deliveryLabelForTarget(3.75)).toBe("Medium Delivery");
    expect(deliveryLabelForTarget(4.0)).toBe("Slow Delivery");
  });
});

describe("computeHandleComparison", () => {
  it("splits 16/16 by executed handle on an unmodified run", () => {
    const run = buildCompletedRun();
    const comparison = computeHandleComparison(run, standardAssessmentThresholdSet().values);
    expect(comparison.in.metrics.count).toBe(16);
    expect(comparison.out.metrics.count).toBe(16);
    expect(comparison.meanAbsoluteErrorDifference).toBe(0);
    expect(comparison.biasDifference).toBe(0);
    expect(comparison.standardDeviationDifference).toBe(0);
  });

  it("groups a wrong-handle attempt by the handle actually executed, not the planned handle", () => {
    // Block 1's first scored shot expects "in" — execute "out" instead.
    const run = buildCompletedRun({
      scoredShotBuilder: (shot, index) => ({
        measuredTime: shot.targetTime,
        executedHandle: index === 0 ? "out" : shot.expectedHandle,
      }),
    });

    const comparison = computeHandleComparison(run, standardAssessmentThresholdSet().values);
    expect(comparison.in.metrics.count).toBe(15);
    expect(comparison.out.metrics.count).toBe(17);

    const summary = buildProtocolIntegritySummary(run);
    expect(summary.wrongHandleDeviationCount).toBe(1);
  });
});

describe("computeVariableAdaptationResult", () => {
  it("locates the Variable Adaptation block structurally and breaks it down by target", () => {
    const run = buildCompletedRun();
    const result = computeVariableAdaptationResult(run, standardAssessmentThresholdSet().values);

    expect(result).not.toBeNull();
    expect(result!.metrics.count).toBe(8);
    const byTarget = new Map(result!.targetResults.map((target) => [target.targetTime, target.metrics.count]));
    expect(byTarget.get(3.75)).toBe(2);
    expect(byTarget.get(4)).toBe(3);
    expect(byTarget.get(3.5)).toBe(3);
  });
});

describe("buildProtocolIntegritySummary", () => {
  it("reports a clean run with no deviations", () => {
    const run = buildCompletedRun();
    const summary = buildProtocolIntegritySummary(run);
    expect(summary.completedInOneSession).toBe(true);
    expect(summary.resumedAfterReload).toBe(false);
    expect(summary.totalDeviationCount).toBe(0);
    expect(summary.invalidAttemptCount).toBe(0);
  });

  it("aggregates every deviation type, folding long_interruption into otherDeviationCount", () => {
    const run = buildCompletedRun();
    const withDeviations: AssessmentRun = {
      ...run,
      interruption: { interruptionCount: 2, resumedAfterReload: true, longInterruption: true },
      protocolDeviations: [
        { id: "1", type: "wrong_handle", plannedShotId: "x", occurredAt: "now" },
        { id: "2", type: "non_standard_warmup", plannedShotId: "x", occurredAt: "now" },
        { id: "3", type: "manual_override", plannedShotId: "x", occurredAt: "now" },
        { id: "4", type: "other", plannedShotId: "x", occurredAt: "now" },
        { id: "5", type: "long_interruption", plannedShotId: "x", occurredAt: "now" },
      ],
    };
    const summary = buildProtocolIntegritySummary(withDeviations);
    expect(summary.completedInOneSession).toBe(false);
    expect(summary.resumedAfterReload).toBe(true);
    expect(summary.longInterruption).toBe(true);
    expect(summary.wrongHandleDeviationCount).toBe(1);
    expect(summary.nonStandardWarmupCount).toBe(1);
    expect(summary.manualOverrideCount).toBe(1);
    expect(summary.otherDeviationCount).toBe(2);
    expect(summary.totalDeviationCount).toBe(5);
  });
});

describe("resolveAnalysisThresholdSet", () => {
  it("Original reads the run's own Run Threshold Snapshot", () => {
    const run = buildCompletedRun();
    const outcome = expectOk(resolveAnalysisThresholdSet(run, "original"));
    expect(outcome).toBe(run.thresholdSnapshot);
  });

  it("Standard and Tight return the fixed presets", () => {
    const run = buildCompletedRun();
    expect(expectOk(resolveAnalysisThresholdSet(run, "standard")).values).toEqual(standardAssessmentThresholdSet().values);
    expect(expectOk(resolveAnalysisThresholdSet(run, "tight")).values).toEqual(tightAssessmentThresholdSet().values);
  });

  it("Custom validates and rejects an invalid pair without mutating anything", () => {
    const run = buildCompletedRun();
    const valid = expectOk(resolveAnalysisThresholdSet(run, "custom", { onTarget: 0.08, acceptable: 0.18 }));
    expect(valid.type).toBe("custom");
    expect(valid.values).toEqual({ onTarget: 0.08, acceptable: 0.18 });

    const invalidCode = expectErr(resolveAnalysisThresholdSet(run, "custom", { onTarget: 0.2, acceptable: 0.1 }));
    expect(invalidCode).toBe("invalid_threshold_set");
  });
});

describe("buildAssessmentResultView", () => {
  it("keeps raw metrics identical across every analysis threshold, while category metrics vary", () => {
    // Shot 0 (Block 1, target 3.75s) is off by exactly 0.15s — inside
    // Standard's Acceptable band, outside Tight's.
    const run = buildCompletedRun({
      scoredShotBuilder: (shot, index) => ({
        measuredTime: index === 0 ? shot.targetTime + 0.15 : shot.targetTime,
      }),
    });

    const underStandard = buildAssessmentResultView(run, standardAssessmentThresholdSet());
    const underTight = buildAssessmentResultView(run, tightAssessmentThresholdSet());

    expect(underStandard.raw).toEqual(underTight.raw);
    expect(underStandard.category.majorMissRate).toBe(0);
    expect(underTight.category.majorMissRate).toBeCloseTo(1 / 32);

    // The run's own Run Threshold Snapshot must never be mutated by viewing it under a different Comparison Threshold.
    expect(underStandard.run.thresholdSnapshot).toBe(run.thresholdSnapshot);
    expect(underTight.run.thresholdSnapshot).toBe(run.thresholdSnapshot);
    expect(run.thresholdSnapshot.type).toBe("standard");
  });
});

describe("describeIneligibilityReasons", () => {
  it("maps every reason code to non-empty, non-enum copy", () => {
    const reasons = [
      "different_template",
      "different_version",
      "different_measurement_mode",
      "different_protocol_sequence",
      "different_scored_shot_count",
      "run_not_completed",
      "protocol_integrity_failed",
    ] as const;
    const messages = describeIneligibilityReasons([...reasons]);
    expect(messages).toHaveLength(reasons.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/^[a-z_]+$/);
    }
  });
});

describe("shot-level and invalid-attempt detail rows", () => {
  it("buildShotDetailRows numbers every scored shot sequentially and flags deviations", () => {
    const run = buildCompletedRun({
      scoredShotBuilder: (shot, index) => ({
        measuredTime: shot.targetTime,
        executedHandle: index === 0 ? "out" : shot.expectedHandle,
      }),
    });
    const rows = buildShotDetailRows(run, standardAssessmentThresholdSet().values);
    expect(rows).toHaveLength(32);
    expect(rows.map((row) => row.globalShotNumber)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(rows[0].hasProtocolDeviation).toBe(true);
    expect(rows.slice(1).every((row) => !row.hasProtocolDeviation)).toBe(true);
  });

  it("buildInvalidAttemptRows surfaces a technical invalid attempt with block context", () => {
    let run = expectOk(
      createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
        timingProviderSnapshot: manualTimingProviderSnapshot(),
      })
    );
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const shot = getCurrentPlannedShot(run)!;
    run = expectOk(addInvalidAttempt(run, shot.id, "first_gate_missing"));

    const rows = buildInvalidAttemptRows(run);
    expect(rows).toHaveLength(1);
    expect(rows[0].blockName).toBe("Warm-up");
    expect(rows[0].invalidReason).toBe("first_gate_missing");
    expect(rows[0].attemptNumber).toBe(1);
  });
});

describe("comparison and trends", () => {
  it("compareAssessmentRuns reports later-minus-earlier deltas for eligible runs", () => {
    const earlier = buildCompletedRun({ completedAt: "2026-01-01T00:00:00.000Z" });
    const later = buildCompletedRun({
      completedAt: "2026-02-01T00:00:00.000Z",
      scoredShotBuilder: (shot) => ({ measuredTime: shot.targetTime + 0.02 }),
    });

    const comparison = compareAssessmentRuns(earlier, later, standardAssessmentThresholdSet());
    expect(comparison.eligible).toBe(true);
    expect(comparison.overallDelta!.meanAbsoluteError).toBeCloseTo(0.02);
    expect(comparison.overallDelta!.bias).toBeCloseTo(0.02);
    expect(comparison.blockDeltas).toHaveLength(4);
    expect(comparison.targetDeltas!.length).toBeGreaterThan(0);
    expect(comparison.handleDeltas).toHaveLength(2);
  });

  it("compareAssessmentRuns reports ineligibility with mapped reasons, never raw runs", () => {
    const earlier = buildCompletedRun();
    const incomplete = buildIncompleteRun();

    const comparison = compareAssessmentRuns(earlier, incomplete, standardAssessmentThresholdSet());
    expect(comparison.eligible).toBe(false);
    expect(comparison.earlier).toBeNull();
    expect(comparison.later).toBeNull();
    expect(comparison.reasonMessages.length).toBeGreaterThan(0);
  });

  it("findProtocolCompatibleRuns / findLatestEligiblePreviousRun exclude the reference run and pick the most recent", () => {
    const a = buildCompletedRun({ completedAt: "2026-01-01T00:00:00.000Z" });
    const b = buildCompletedRun({ completedAt: "2026-01-15T00:00:00.000Z" });
    const reference = buildCompletedRun({ completedAt: "2026-02-01T00:00:00.000Z" });

    const compatible = findProtocolCompatibleRuns([a, b, reference], reference);
    expect(compatible.map((run) => run.id).sort()).toEqual([a.id, b.id].sort());

    const latest = findLatestEligiblePreviousRun([a, b, reference], reference);
    expect(latest?.id).toBe(b.id);
  });

  it("buildAssessmentTrendSeries sorts chronologically and flags the selected run", () => {
    const a = buildCompletedRun({ completedAt: "2026-01-01T00:00:00.000Z" });
    const b = buildCompletedRun({ completedAt: "2026-03-01T00:00:00.000Z" });
    const c = buildCompletedRun({ completedAt: "2026-02-01T00:00:00.000Z" });

    const points = buildAssessmentTrendSeries([a, b, c], standardAssessmentThresholdSet(), c.id);
    expect(points.map((point) => point.runId)).toEqual([a.id, c.id, b.id]);
    expect(points.find((point) => point.runId === c.id)?.isSelected).toBe(true);
    expect(points.filter((point) => point.isSelected)).toHaveLength(1);
  });

  it("excludes an incomplete run from a trend series", () => {
    const completed = buildCompletedRun();
    const incomplete = buildIncompleteRun();
    const points = buildAssessmentTrendSeries([completed, incomplete], standardAssessmentThresholdSet());
    expect(points).toHaveLength(1);
    expect(points[0].runId).toBe(completed.id);
  });
});
