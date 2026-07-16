import { describe, expect, it } from "vitest";
import { addValidAttempt } from "../attempts";
import {
  absoluteError,
  computeCategoryMetrics,
  computeRawAssessmentMetrics,
  signedError,
} from "../metrics";
import { getCurrentPlannedShot } from "../progress";
import { transitionAssessmentRun } from "../run";
import { ASSESSMENT_STANDARD_THRESHOLDS, ASSESSMENT_TIGHT_THRESHOLDS } from "../thresholds";
import { completeWarmup, createTestRun, expectOk } from "./testHelpers";

describe("signedError / absoluteError", () => {
  it("signedError is measuredTime - targetTime", () => {
    expect(signedError(4.1, 4.0)).toBeCloseTo(0.1);
    expect(signedError(3.9, 4.0)).toBeCloseTo(-0.1);
  });

  it("absoluteError is the magnitude of signedError", () => {
    expect(absoluteError(4.1, 4.0)).toBeCloseTo(0.1);
    expect(absoluteError(3.9, 4.0)).toBeCloseTo(0.1);
  });
});

function runWithScoredAttempts(measuredTimes: number[]) {
  let run = createTestRun();
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));

  for (const measuredTime of measuredTimes) {
    const shot = getCurrentPlannedShot(run)!;
    run = expectOk(addValidAttempt(run, shot.id, { measuredTime, executedHandle: shot.expectedHandle }));
  }
  return run;
}

describe("computeRawAssessmentMetrics", () => {
  it("returns nulls/zero count for a run with no valid scored attempts", () => {
    const run = runWithScoredAttempts([]);
    expect(computeRawAssessmentMetrics(run)).toEqual({
      count: 0,
      meanAbsoluteError: null,
      bias: null,
      standardDeviation: null,
    });
  });

  it("computes count/MAE/Bias/SD for a single valid attempt", () => {
    // First scored block target is 3.75s.
    const run = runWithScoredAttempts([3.85]);
    const metrics = computeRawAssessmentMetrics(run);
    expect(metrics.count).toBe(1);
    expect(metrics.meanAbsoluteError).toBeCloseTo(0.1);
    expect(metrics.bias).toBeCloseTo(0.1);
    expect(metrics.standardDeviation).toBeCloseTo(0);
  });

  it("computes MAE/Bias/SD across multiple valid attempts with mixed signs", () => {
    // Block 1 targets are all 3.75s for the first 8 shots.
    const run = runWithScoredAttempts([3.85, 3.65, 3.75, 3.9]);
    const metrics = computeRawAssessmentMetrics(run);
    const errors = [0.1, -0.1, 0, 0.15];
    const expectedMae = errors.reduce((sum, e) => sum + Math.abs(e), 0) / errors.length;
    const expectedBias = errors.reduce((sum, e) => sum + e, 0) / errors.length;
    expect(metrics.count).toBe(4);
    expect(metrics.meanAbsoluteError).toBeCloseTo(expectedMae);
    expect(metrics.bias).toBeCloseTo(expectedBias);
  });

  it("never counts warm-up attempts, even though they were valid", () => {
    let run = createTestRun();
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    expect(computeRawAssessmentMetrics(run).count).toBe(0);
  });
});

describe("computeCategoryMetrics", () => {
  it("returns zero counts/null rates for a run with no valid scored attempts", () => {
    const run = runWithScoredAttempts([]);
    expect(computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS)).toEqual({
      onTargetCount: 0,
      acceptableCount: 0,
      majorMissCount: 0,
      onTargetRate: null,
      acceptableRate: null,
      majorMissRate: null,
    });
  });

  it("categorizes an error exactly at the on-target boundary as on-target", () => {
    const run = runWithScoredAttempts([3.85]); // target 3.75, error exactly 0.10
    const metrics = computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS);
    expect(metrics.onTargetCount).toBe(1);
    expect(metrics.acceptableCount).toBe(0);
    expect(metrics.majorMissCount).toBe(0);
  });

  it("categorizes an error exactly at the acceptable boundary as acceptable", () => {
    const run = runWithScoredAttempts([3.95]); // target 3.75, error exactly 0.20
    const metrics = computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS);
    expect(metrics.onTargetCount).toBe(0);
    expect(metrics.acceptableCount).toBe(1);
    expect(metrics.majorMissCount).toBe(0);
  });

  it("categorizes an error just over the acceptable boundary as a major miss", () => {
    const run = runWithScoredAttempts([3.97]); // target 3.75, error 0.22
    const metrics = computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS);
    expect(metrics.majorMissCount).toBe(1);
  });

  it("computes correct rates across a mixed set under the Standard preset", () => {
    // target 3.75: errors 0.05 (on target), 0.15 (acceptable), 0.30 (major miss)
    const run = runWithScoredAttempts([3.8, 3.9, 4.05]);
    const metrics = computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS);
    expect(metrics.onTargetCount).toBe(1);
    expect(metrics.acceptableCount).toBe(1);
    expect(metrics.majorMissCount).toBe(1);
    expect(metrics.onTargetRate).toBeCloseTo(1 / 3);
  });

  it("computes different category counts under the Tight preset for the same attempts", () => {
    // target 3.75: error 0.08 is on-target under Standard (<=0.10) but only "acceptable" under Tight (>0.05, <=0.10).
    const run = runWithScoredAttempts([3.83]);
    const standard = computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS);
    const tight = computeCategoryMetrics(run, ASSESSMENT_TIGHT_THRESHOLDS);
    expect(standard.onTargetCount).toBe(1);
    expect(tight.onTargetCount).toBe(0);
    expect(tight.acceptableCount).toBe(1);
  });

  it("computes category metrics for a Custom threshold set", () => {
    const run = runWithScoredAttempts([3.85]); // error 0.10
    const custom = computeCategoryMetrics(run, { onTarget: 0.02, acceptable: 0.11 });
    expect(custom.onTargetCount).toBe(0);
    expect(custom.acceptableCount).toBe(1);
  });
});

describe("threshold independence", () => {
  it("raw metrics (MAE/Bias/SD) never change when a different threshold set is applied", () => {
    const run = runWithScoredAttempts([3.8, 3.9, 4.05]);
    const raw = computeRawAssessmentMetrics(run);

    computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS);
    computeCategoryMetrics(run, ASSESSMENT_TIGHT_THRESHOLDS);
    computeCategoryMetrics(run, { onTarget: 0.02, acceptable: 0.03 });

    // Re-derive raw metrics after applying various threshold sets — must be byte-identical.
    expect(computeRawAssessmentMetrics(run)).toEqual(raw);
  });

  it("the run's own thresholdSnapshot is never mutated by computing category metrics under a different set", () => {
    const run = runWithScoredAttempts([3.8]);
    const before = JSON.parse(JSON.stringify(run.thresholdSnapshot));
    computeCategoryMetrics(run, ASSESSMENT_TIGHT_THRESHOLDS);
    expect(run.thresholdSnapshot).toEqual(before);
  });

  it("category percentages differ correctly between Standard and Tight for the same run", () => {
    const run = runWithScoredAttempts([3.8, 3.9, 4.05]);
    const standard = computeCategoryMetrics(run, ASSESSMENT_STANDARD_THRESHOLDS);
    const tight = computeCategoryMetrics(run, ASSESSMENT_TIGHT_THRESHOLDS);
    expect(standard).not.toEqual(tight);
  });
});
