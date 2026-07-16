// Local, device-only UI preferences for the Assess flow — deliberately
// separate from the AssessmentRun/AssessmentPersistedState domain objects
// (see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 23):
// these are presentation preferences, not part of any run's protocol or
// snapshot, and changing them never affects an already-started run. Pure
// read/write helpers only — no React, no side effects beyond localStorage,
// so they're trivially unit-testable and reusable from any component.
import type { AccuracyThresholdPreset } from "./accuracyThresholds";
import type { AccuracyThresholds } from "../types";

const SHOW_INTRODUCTION_KEY = "curling-release-tracker-assessment-show-introduction";
const LAST_THRESHOLD_PRESET_KEY = "curling-release-tracker-assessment-last-threshold-preset";
const LAST_CUSTOM_THRESHOLD_KEY = "curling-release-tracker-assessment-last-custom-threshold";

/** Defaults to true (shown) for a first-time user or when nothing is persisted yet. */
export function getShowAssessmentIntroductionPreference(): boolean {
  if (typeof localStorage === "undefined") return true;
  const raw = localStorage.getItem(SHOW_INTRODUCTION_KEY);
  if (raw === null) return true;
  return raw === "true";
}

export function setShowAssessmentIntroductionPreference(show: boolean): void {
  localStorage.setItem(SHOW_INTRODUCTION_KEY, show ? "true" : "false");
}

const VALID_PRESETS: AccuracyThresholdPreset[] = ["standard", "tight", "custom"];

/** UI preselection only — a Run's actual threshold snapshot always comes from an explicit, visible confirmation at start time (see AssessmentThresholdSelector), never silently from this preference. */
export function getLastAssessmentThresholdPreset(): AccuracyThresholdPreset {
  if (typeof localStorage === "undefined") return "standard";
  const raw = localStorage.getItem(LAST_THRESHOLD_PRESET_KEY);
  return VALID_PRESETS.includes(raw as AccuracyThresholdPreset)
    ? (raw as AccuracyThresholdPreset)
    : "standard";
}

export function setLastAssessmentThresholdPreset(preset: AccuracyThresholdPreset): void {
  localStorage.setItem(LAST_THRESHOLD_PRESET_KEY, preset);
}

export function getLastAssessmentCustomThreshold(): AccuracyThresholds | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(LAST_CUSTOM_THRESHOLD_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.onTarget === "number" &&
      typeof parsed.acceptable === "number"
    ) {
      return { onTarget: parsed.onTarget, acceptable: parsed.acceptable };
    }
  } catch {
    // Corrupt/old-shape persisted preference is never fatal — treat as absent.
  }
  return null;
}

export function setLastAssessmentCustomThreshold(values: AccuracyThresholds): void {
  localStorage.setItem(LAST_CUSTOM_THRESHOLD_KEY, JSON.stringify(values));
}
