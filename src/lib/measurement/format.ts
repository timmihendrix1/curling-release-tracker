// Display helpers for measured values that may legitimately be absent.
//
// The whole point of these is that a missing measurement must never be rendered
// as "0.00" — a reader cannot tell a fabricated zero from a real one, and a zero
// release time or zero speed is not a measurement anyone ever recorded. An absent
// value renders as an explicit "not recorded" placeholder instead.
//
// Units are always rendered with the value (UX writing guidelines: never show a
// bare number whose unit the reader has to infer), and the two units are never
// swapped — seconds and m/s have separate helpers on purpose.
import type { MeasuredQuantity } from "../../types";

/** Shown wherever a measurement genuinely has no recorded value. */
export const NOT_RECORDED = "—";

const DECIMALS: Record<MeasuredQuantity, number> = {
  time: 2,
  speed: 2,
};

export function formatMeasuredSeconds(value: number | undefined): string {
  return value === undefined ? NOT_RECORDED : `${value.toFixed(DECIMALS.time)}s`;
}

export function formatMeasuredSpeed(value: number | undefined): string {
  return value === undefined
    ? NOT_RECORDED
    : `${value.toFixed(DECIMALS.speed)} m/s`;
}

export function formatMeasuredValue(
  value: number | undefined,
  quantity: MeasuredQuantity
): string {
  return quantity === "speed"
    ? formatMeasuredSpeed(value)
    : formatMeasuredSeconds(value);
}

/** A signed deviation with its unit, or the placeholder when there is none. */
export function formatMeasuredDeviation(
  deviation: number | null,
  quantity: MeasuredQuantity,
  decimals = 2
): string {
  if (deviation === null) return NOT_RECORDED;
  const sign = deviation >= 0 ? "+" : "";
  const unit = quantity === "speed" ? " m/s" : "s";
  return `${sign}${deviation.toFixed(decimals)}${unit}`;
}
