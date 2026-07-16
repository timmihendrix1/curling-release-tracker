// Assessment CSV export — deliberately its own builder/file, never mixed
// into Training's session/history CSV (see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 20). One row
// per attempt (valid and invalid), across one or more runs, so the exported
// file is the raw evidence itself — never only derived metrics.
import { downloadCsv } from "../export";
import { absoluteError, signedError } from "./metrics";
import { getAllPlannedShots } from "./progress";
import type { AssessmentRun } from "./types";

const ASSESSMENT_CSV_HEADER = [
  "run_id",
  "template_id",
  "template_version",
  "run_status",
  "completed_at",
  "block_id",
  "block_name",
  "planned_shot_id",
  "attempt_number",
  "attempt_status",
  "target_time",
  "measured_time",
  "signed_error",
  "absolute_error",
  "expected_handle",
  "executed_handle",
  "protocol_deviations",
  "invalid_reason",
  "timing_provider",
  "capture_mode",
  "measurement_mode",
  "original_threshold_type",
  "original_on_target_threshold",
  "original_acceptable_threshold",
].join(",");

function csvEscape(value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function rowsForRun(run: AssessmentRun): string[] {
  const shotById = new Map(getAllPlannedShots(run.templateSnapshot).map((shot) => [shot.id, shot]));
  const blockNameById = new Map(run.templateSnapshot.blocks.map((block) => [block.id, block.name]));

  return run.attempts.map((attempt) => {
    const shot = shotById.get(attempt.plannedShotId);
    const measured = attempt.status === "valid" ? attempt.measuredTime : undefined;
    const signed = measured !== undefined && shot ? signedError(measured, shot.targetTime) : undefined;
    const absolute = measured !== undefined && shot ? absoluteError(measured, shot.targetTime) : undefined;

    return [
      run.id,
      run.templateId,
      run.templateVersion,
      run.status,
      run.completedAt ?? "",
      shot?.blockId ?? "",
      shot?.blockId ? blockNameById.get(shot.blockId) ?? "" : "",
      attempt.plannedShotId,
      attempt.attemptNumber,
      attempt.status,
      shot?.targetTime ?? "",
      measured ?? "",
      signed ?? "",
      absolute ?? "",
      shot?.expectedHandle ?? "",
      attempt.executedHandle ?? "",
      (attempt.protocolDeviations ?? []).join(";"),
      attempt.invalidReason ?? "",
      run.timingProviderSnapshot.providerId,
      run.timingProviderSnapshot.captureMode,
      run.timingProviderSnapshot.measurementMode,
      run.thresholdSnapshot.type,
      run.thresholdSnapshot.values.onTarget,
      run.thresholdSnapshot.values.acceptable,
    ]
      .map(csvEscape)
      .join(",");
  });
}

/** Pure CSV string builder — no DOM access, safe to unit test directly. */
export function buildAssessmentCsv(runs: AssessmentRun[]): string {
  const rows = runs.flatMap(rowsForRun);
  return [ASSESSMENT_CSV_HEADER, ...rows].join("\n");
}

export function exportAssessmentRunsToCsv(runs: AssessmentRun[], fileName = "assessment_history.csv") {
  downloadCsv(buildAssessmentCsv(runs), fileName);
}
