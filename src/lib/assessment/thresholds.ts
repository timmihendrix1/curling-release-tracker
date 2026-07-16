// Assessment Threshold Presets — interpretation settings only. They never
// change the protocol, the target times, or raw measured data (see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 2/10).
//
// Standard (0.10s / 0.20s) and Tight (0.05s / 0.10s) are numerically
// identical to the existing Training domain's presets — reused directly
// rather than redefined (see src/lib/accuracyThresholds.ts, ADR-0008), since
// the Assessment spec explicitly instructs reusing "existing
// training-threshold validation" for these exact values.
import type { AccuracyThresholds } from "../../types";
import {
  type AccuracyThresholdPreset,
  STANDARD_ACCURACY_THRESHOLDS,
  TIGHT_ACCURACY_THRESHOLDS,
} from "../accuracyThresholds";
import { err, ok, type AssessmentOutcome } from "./errors";
import type { AccuracyThresholdSet, AccuracyThresholdSetSource } from "./types";

export const ASSESSMENT_STANDARD_THRESHOLDS: AccuracyThresholds = STANDARD_ACCURACY_THRESHOLDS;
export const ASSESSMENT_TIGHT_THRESHOLDS: AccuracyThresholds = TIGHT_ACCURACY_THRESHOLDS;

// The app's real time precision throughout capture/entry is hundredths of a
// second (see src/lib/timeInput.ts) — Assessment threshold precision aligns
// to that existing convention rather than inventing a new rule.
export const ASSESSMENT_THRESHOLD_PRECISION_SECONDS = 0.01;

// Open product decision (see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md
// section 10): no sport-validated upper/lower bound exists yet for Assessment
// thresholds. These are minimal, safe technical ceilings only — not
// scientifically validated performance norms (same "no fabricated precision"
// principle as Smart Random ranges, see docs/adr/0004).
export const ASSESSMENT_THRESHOLD_MIN_SECONDS = 0.01;
export const ASSESSMENT_THRESHOLD_MAX_SECONDS = 5;

export type ThresholdValidationIssueCode =
  | "on_target_must_be_finite"
  | "acceptable_must_be_finite"
  | "on_target_must_be_positive"
  | "acceptable_must_be_positive"
  | "on_target_must_be_less_than_acceptable"
  | "unsupported_precision"
  | "out_of_supported_range";

export type ThresholdValidationResult =
  | { valid: true }
  | { valid: false; issues: ThresholdValidationIssueCode[] };

function isSupportedPrecision(value: number): boolean {
  const scaled = value / ASSESSMENT_THRESHOLD_PRECISION_SECONDS;
  return Math.abs(scaled - Math.round(scaled)) < 1e-6;
}

/**
 * Validates a candidate threshold pair. Both values must be finite and
 * positive, `onTarget` must be strictly less than `acceptable`, both must
 * respect the app's supported time precision, and both must fall within a
 * minimal safe technical range — no scientific/sporting norm is encoded here.
 */
export function validateThresholdValues(
  onTarget: number,
  acceptable: number
): ThresholdValidationResult {
  const issues = new Set<ThresholdValidationIssueCode>();

  const onTargetFinite = Number.isFinite(onTarget);
  const acceptableFinite = Number.isFinite(acceptable);

  if (!onTargetFinite) issues.add("on_target_must_be_finite");
  if (!acceptableFinite) issues.add("acceptable_must_be_finite");

  if (onTargetFinite && onTarget <= 0) issues.add("on_target_must_be_positive");
  if (acceptableFinite && acceptable <= 0) issues.add("acceptable_must_be_positive");

  if (
    onTargetFinite &&
    acceptableFinite &&
    onTarget > 0 &&
    acceptable > 0 &&
    acceptable <= onTarget
  ) {
    issues.add("on_target_must_be_less_than_acceptable");
  }

  if (onTargetFinite && onTarget > 0 && !isSupportedPrecision(onTarget)) {
    issues.add("unsupported_precision");
  }
  if (acceptableFinite && acceptable > 0 && !isSupportedPrecision(acceptable)) {
    issues.add("unsupported_precision");
  }

  if (
    onTargetFinite &&
    onTarget > 0 &&
    (onTarget < ASSESSMENT_THRESHOLD_MIN_SECONDS || onTarget > ASSESSMENT_THRESHOLD_MAX_SECONDS)
  ) {
    issues.add("out_of_supported_range");
  }
  if (
    acceptableFinite &&
    acceptable > 0 &&
    (acceptable < ASSESSMENT_THRESHOLD_MIN_SECONDS ||
      acceptable > ASSESSMENT_THRESHOLD_MAX_SECONDS)
  ) {
    issues.add("out_of_supported_range");
  }

  return issues.size === 0 ? { valid: true } : { valid: false, issues: Array.from(issues) };
}

export type CreateAccuracyThresholdSetOptions = {
  source?: AccuracyThresholdSetSource;
  selectedAt?: string;
  presetId?: string;
};

/**
 * Builds a validated AccuracyThresholdSet. Returns a structured error
 * (`invalid_threshold_set`) rather than throwing, since an invalid candidate
 * (e.g. athlete-entered Custom values) is an ordinary, expected outcome.
 */
export function createAccuracyThresholdSet(
  type: AccuracyThresholdPreset,
  values: AccuracyThresholds,
  options: CreateAccuracyThresholdSetOptions = {}
): AssessmentOutcome<AccuracyThresholdSet> {
  const validation = validateThresholdValues(values.onTarget, values.acceptable);
  if (!validation.valid) {
    return err(
      "invalid_threshold_set",
      `Invalid threshold set: ${validation.issues.join(", ")}`
    );
  }

  return ok({
    type,
    values: { onTarget: values.onTarget, acceptable: values.acceptable },
    presetId: options.presetId,
    source: options.source ?? (type === "custom" ? "athlete-selected" : "default"),
    selectedAt: options.selectedAt ?? new Date().toISOString(),
  });
}

export function standardAssessmentThresholdSet(selectedAt?: string): AccuracyThresholdSet {
  const outcome = createAccuracyThresholdSet("standard", ASSESSMENT_STANDARD_THRESHOLDS, {
    source: "default",
    selectedAt,
  });
  if (!outcome.ok) {
    throw new Error("Standard Assessment threshold preset failed validation — this is a bug.");
  }
  return outcome.value;
}

export function tightAssessmentThresholdSet(selectedAt?: string): AccuracyThresholdSet {
  const outcome = createAccuracyThresholdSet("tight", ASSESSMENT_TIGHT_THRESHOLDS, {
    source: "default",
    selectedAt,
  });
  if (!outcome.ok) {
    throw new Error("Tight Assessment threshold preset failed validation — this is a bug.");
  }
  return outcome.value;
}

/** Deep copy — a Run's threshold snapshot must never share a mutable reference with the caller's object. */
export function cloneAccuracyThresholdSet(set: AccuracyThresholdSet): AccuracyThresholdSet {
  return { ...set, values: { ...set.values } };
}
