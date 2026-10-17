/**
 * Central chart tokens — colors, labels, formatting. No chart component
 * should hard-code a handle/category color or re-derive a sign-formatted
 * label locally; import from here instead (see CLAUDE.md's chart rules).
 */
import type { Handle, MeasurementMode } from "../types";
import type { TargetErrorCategory } from "./accuracyThresholds";

// House petrol / graphite. Scatter series additionally vary marker shape (see
// TargetActualScatterChart), not color alone.
export const HANDLE_COLORS: Record<Handle, string> = {
  in: "#356d72",
  out: "#626e73",
};

export const HANDLE_LABELS: Record<Handle, string> = {
  in: "In Handle",
  out: "Out Handle",
};

// Petrol/grey/muted red — ordered categories, deliberately not alarmist reds (a
// muted red, not a saturated alert red) since Major Miss is a normal,
// expected part of training data, not an error state.
export const TARGET_ERROR_CATEGORY_COLORS: Record<TargetErrorCategory, string> = {
  on_target: "#356d72",
  acceptable: "#7c8d92",
  major_miss: "#ad6257",
};

export const TARGET_ERROR_CATEGORY_LABELS: Record<TargetErrorCategory, string> = {
  on_target: "On Target",
  acceptable: "Acceptable",
  major_miss: "Major Miss",
};

export const REFERENCE_LINE_COLOR = "#626e73"; // House muted, neutral zero line / diagonal
export const STATISTICAL_OUTLIER_COLOR = "#20282b"; // graphite — distinct from the muted Major Miss red

export function formatSecondsAxisTick(value: number): string {
  return value.toFixed(2);
}

export function measurementModeAxisLabel(mode: MeasurementMode): string {
  return mode === "hog-hog" ? "Hog – Hog (s)" : "Backline – Hog (s)";
}
