import { describe, expect, it } from "vitest";
import { addInvalidAttempt } from "../attempts";
import { buildAssessmentCsv } from "../export";
import { getCurrentPlannedShot } from "../progress";
import { createAssessmentRun, transitionAssessmentRun } from "../run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { standardAssessmentThresholdSet } from "../thresholds";
import { completeAllScoredShots, completeWarmup, expectOk, manualTimingProviderSnapshot } from "./testHelpers";

describe("buildAssessmentCsv", () => {
  it("includes the required header fields", () => {
    const csv = buildAssessmentCsv([]);
    const header = csv.split("\n")[0];
    for (const field of [
      "run_id",
      "template_id",
      "template_version",
      "run_status",
      "block_name",
      "planned_shot_id",
      "target_time",
      "measured_time",
      "signed_error",
      "absolute_error",
      "expected_handle",
      "executed_handle",
      "attempt_status",
      "protocol_deviations",
      "timing_provider",
      "measurement_mode",
      "original_threshold_type",
      "original_on_target_threshold",
      "original_acceptable_threshold",
    ]) {
      expect(header).toContain(field);
    }
  });

  it("emits one row per attempt, valid and invalid alike, with raw data intact", () => {
    let run = expectOk(
      createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
        timingProviderSnapshot: manualTimingProviderSnapshot(),
      })
    );
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    const firstWarmupShot = getCurrentPlannedShot(run)!;
    run = expectOk(addInvalidAttempt(run, firstWarmupShot.id, "first_gate_missing"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    run = expectOk(transitionAssessmentRun(run, "completed"));

    const csv = buildAssessmentCsv([run]);
    const rows = csv.split("\n").slice(1);
    // 6 warm-up + 1 extra invalid attempt + 32 scored = 39 rows.
    expect(rows).toHaveLength(39);
    expect(rows.every((row) => row.startsWith(run.id))).toBe(true);
    expect(rows.some((row) => row.includes(",invalid,"))).toBe(true);
    expect(rows.filter((row) => row.includes(",valid,"))).toHaveLength(38);
  });

  it("never mixes derived metrics as the only evidence — measured_time and target_time are always the raw values", () => {
    let run = expectOk(
      createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
        timingProviderSnapshot: manualTimingProviderSnapshot(),
      })
    );
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    run = expectOk(transitionAssessmentRun(run, "completed"));

    const csv = buildAssessmentCsv([run]);
    const firstScoredRow = csv.split("\n")[7]; // header + 6 warmup rows, then first scored row
    expect(firstScoredRow).toContain("3.75"); // Block 1's target time
  });
});
