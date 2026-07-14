/**
 * Central chart tokens — colors, labels, formatting. No chart component
 * should hard-code a handle/category color or re-derive a sign-formatted
 * label locally; import from here instead (see CLAUDE.md's chart rules).
 */
import type { Handle, MeasurementMode } from "../types";
import type { TargetErrorCategory } from "./accuracyThresholds";

// Blue/orange — distinguishable under the common red-green color-vision
// deficiencies; Scatter series additionally vary marker shape (see
// TargetActualScatterChart), not color alone.
export const HANDLE_COLORS: Record<Handle, string> = {
  in: "#2563eb",
  out: "#ea580c",
};

export const HANDLE_LABELS: Record<Handle, string> = {
  in: "In Handle",
  out: "Out Handle",
};

// Green/amber/red — ordered severity, deliberately not "alarmist" reds (a
// muted red, not a saturated alert red) since Major Miss is a normal,
// expected part of training data, not an error state.
export const TARGET_ERROR_CATEGORY_COLORS: Record<TargetErrorCategory, string> = {
  on_target: "#16a34a",
  acceptable: "#ca8a04",
  major_miss: "#dc2626",
};

export const TARGET_ERROR_CATEGORY_LABELS: Record<TargetErrorCategory, string> = {
  on_target: "On Target",
  acceptable: "Acceptable",
  major_miss: "Major Miss",
};

export const REFERENCE_LINE_COLOR = "#64748b"; // slate-500, neutral zero line / diagonal
export const STATISTICAL_OUTLIER_COLOR = "#7c3aed"; // violet — visually distinct from Major Miss red

export function formatSecondsAxisTick(value: number): string {
  return value.toFixed(2);
}

export function measurementModeAxisLabel(mode: MeasurementMode): string {
  return mode === "hog-hog" ? "Hog – Hog (s)" : "Backline – Hog (s)";
}
