import { describe, expect, it } from "vitest";
import { checkCategoryComparisonEligibility, checkProtocolComparisonEligibility } from "../comparison";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { standardAssessmentThresholdSet, tightAssessmentThresholdSet } from "../thresholds";
import type { AssessmentRun } from "../types";
import { completeAllScoredShots, completeWarmup, expectOk, manualTimingProviderSnapshot } from "./testHelpers";
import { createAssessmentRun, transitionAssessmentRun } from "../run";

function completedRun(thresholdSet = standardAssessmentThresholdSet()): AssessmentRun {
  let run = expectOk(
    createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, thresholdSet, {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    })
  );
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  run = completeAllScoredShots(run);
  run = expectOk(transitionAssessmentRun(run, "completed"));
  return run;
}

describe("checkProtocolComparisonEligibility", () => {
  it("two independent completed v1 runs are protocol-eligible", () => {
    const a = completedRun();
    const b = completedRun();
    expect(checkProtocolComparisonEligibility(a, b)).toEqual({ eligible: true, reasons: [] });
  });

  it("different original Run Threshold Snapshots never make two runs protocol-ineligible", () => {
    const a = completedRun(standardAssessmentThresholdSet());
    const b = completedRun(tightAssessmentThresholdSet());
    expect(checkProtocolComparisonEligibility(a, b).eligible).toBe(true);
  });

  it("flags different template version", () => {
    const a = completedRun();
    const b = { ...completedRun(), templateVersion: 2 };
    expect(checkProtocolComparisonEligibility(a, b).reasons).toContain("different_version");
  });

  it("flags different template identity", () => {
    const a = completedRun();
    const b = { ...completedRun(), templateId: "some-other-template" };
    expect(checkProtocolComparisonEligibility(a, b).reasons).toContain("different_template");
  });

  it("flags different measurement mode", () => {
    const a = completedRun();
    const b = completedRun();
    b.timingProviderSnapshot = { ...b.timingProviderSnapshot, measurementMode: "hog-hog" };
    expect(checkProtocolComparisonEligibility(a, b).reasons).toContain("different_measurement_mode");
  });

  it("flags a different scored target/handle sequence", () => {
    const a = completedRun();
    const b = completedRun();
    b.templateSnapshot.blocks[0].plannedShots[0].targetTime = 3.5;
    expect(checkProtocolComparisonEligibility(a, b).reasons).toContain("different_protocol_sequence");
  });

  it("flags a different scored shot count", () => {
    const a = completedRun();
    const b = completedRun();
    b.templateSnapshot.blocks[3].plannedShots = b.templateSnapshot.blocks[3].plannedShots.slice(0, -1);
    const result = checkProtocolComparisonEligibility(a, b);
    expect(result.reasons).toContain("different_scored_shot_count");
  });

  it("flags a run that isn't completed", () => {
    const a = completedRun();
    let b = expectOk(
      createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
        timingProviderSnapshot: manualTimingProviderSnapshot(),
      })
    );
    b = expectOk(transitionAssessmentRun(b, "warmup"));
    expect(checkProtocolComparisonEligibility(a, b).reasons).toContain("run_not_completed");
  });
});

describe("checkCategoryComparisonEligibility", () => {
  it("is eligible with requiresSharedComparisonThresholds=true when protocol-comparable", () => {
    const a = completedRun(standardAssessmentThresholdSet());
    const b = completedRun(tightAssessmentThresholdSet());
    expect(checkCategoryComparisonEligibility(a, b)).toEqual({
      eligible: true,
      reasons: [],
      requiresSharedComparisonThresholds: true,
    });
  });

  it("mirrors protocol ineligibility reasons when runs are not protocol-comparable", () => {
    const a = completedRun();
    const b = { ...completedRun(), templateVersion: 2 };
    const result = checkCategoryComparisonEligibility(a, b);
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain("different_version");
  });
});
