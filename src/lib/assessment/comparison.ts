// Protocol and Category Comparison Eligibility — see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md sections 20-21. Two
// runs' *original* Run Threshold Snapshots may differ without affecting
// Protocol Comparison Eligibility; Category Comparison additionally requires
// one shared Comparison Threshold Set to be applied by the caller (this
// module never applies one itself — see metrics.ts).
import { getAllPlannedShots } from "./progress";
import type { AssessmentRun } from "./types";

export type ComparisonIneligibilityReason =
  | "different_template"
  | "different_version"
  | "different_measurement_mode"
  | "different_protocol_sequence"
  | "different_scored_shot_count"
  | "run_not_completed"
  | "protocol_integrity_failed";

export type ProtocolComparisonResult = {
  eligible: boolean;
  reasons: ComparisonIneligibilityReason[];
};

function scoredPlannedShots(run: AssessmentRun) {
  return getAllPlannedShots(run.templateSnapshot).filter((shot) => shot.phase === "scored");
}

/** A stable signature of a run's scored target + handle sequence, used to detect any protocol drift. */
function protocolSequenceSignature(run: AssessmentRun): string {
  return scoredPlannedShots(run)
    .map((shot) => `${shot.targetTime}:${shot.expectedHandle}`)
    .join("|");
}

/** Every valid attempt must reference a planned shot that genuinely exists in this run's own template snapshot. */
function hasProtocolIntegrity(run: AssessmentRun): boolean {
  const validShotIds = new Set(getAllPlannedShots(run.templateSnapshot).map((shot) => shot.id));
  return run.attempts.every((attempt) => validShotIds.has(attempt.plannedShotId));
}

/**
 * Checks whether two Assessment Runs are protocol-comparable: same
 * template, same version, same measurement mode, same target+handle
 * sequence, same scored-shot count, both completed, and no basic protocol
 * integrity failure. Different original Run Threshold Snapshots never make
 * two runs protocol-ineligible.
 */
export function checkProtocolComparisonEligibility(
  a: AssessmentRun,
  b: AssessmentRun
): ProtocolComparisonResult {
  const reasons = new Set<ComparisonIneligibilityReason>();

  if (a.templateId !== b.templateId) reasons.add("different_template");
  if (a.templateVersion !== b.templateVersion) reasons.add("different_version");
  if (a.timingProviderSnapshot.measurementMode !== b.timingProviderSnapshot.measurementMode) {
    reasons.add("different_measurement_mode");
  }

  if (scoredPlannedShots(a).length !== scoredPlannedShots(b).length) {
    reasons.add("different_scored_shot_count");
  }

  if (protocolSequenceSignature(a) !== protocolSequenceSignature(b)) {
    reasons.add("different_protocol_sequence");
  }

  if (a.status !== "completed" || b.status !== "completed") {
    reasons.add("run_not_completed");
  }

  if (!hasProtocolIntegrity(a) || !hasProtocolIntegrity(b)) {
    reasons.add("protocol_integrity_failed");
  }

  return { eligible: reasons.size === 0, reasons: Array.from(reasons) };
}

export type CategoryComparisonEligibilityResult = {
  eligible: boolean;
  reasons: ComparisonIneligibilityReason[];
  /** Always true when eligible: a shared Comparison Threshold Set must still be explicitly applied by the caller (see metrics.ts's computeCategoryMetrics). */
  requiresSharedComparisonThresholds: true;
};

/**
 * Category Comparison is only possible when the two runs are already
 * protocol-comparable; it additionally requires the caller to apply one
 * shared Comparison Threshold Set to both runs (this function does not pick
 * or apply one itself). The runs' original Run Threshold Snapshots may
 * differ.
 */
export function checkCategoryComparisonEligibility(
  a: AssessmentRun,
  b: AssessmentRun
): CategoryComparisonEligibilityResult {
  const protocol = checkProtocolComparisonEligibility(a, b);
  return {
    eligible: protocol.eligible,
    reasons: protocol.reasons,
    requiresSharedComparisonThresholds: true,
  };
}
