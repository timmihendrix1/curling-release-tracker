// Shared display formatting for Assessment Result screens — kept out of JSX
// so every component formats a null/absent metric identically (see CLAUDE.md:
// "no metric logic inside JSX").
import { formatSigned } from "../timeInput";

export function formatAssessmentPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export function formatAssessmentSeconds(value: number | null, decimals = 3): string {
  return value === null ? "—" : `${value.toFixed(decimals)}s`;
}

export function formatAssessmentSignedSeconds(value: number | null, decimals = 3): string {
  return value === null ? "—" : `${formatSigned(value, decimals)}s`;
}

/** For a metric delta already expressed in percentage points (see result.ts's MetricDelta). */
export function formatPercentagePointDelta(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded} pp`;
}

export function formatSecondsDelta(value: number | null, decimals = 3): string {
  return value === null ? "—" : `${formatSigned(value, decimals)}s`;
}
