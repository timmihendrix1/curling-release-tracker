// Parsing and formatting for manually entered speed values, in metres per second.
//
// Deliberately NOT `src/lib/timeInput.ts`'s `parseReleaseTime`. That parser carries a
// release-time shorthand — a value >= 100 is read as hundredths of a second, so "375"
// means 3.75s. Applying it to speed would silently turn a typed "240" into 2.40 m/s,
// inventing a measurement the athlete never entered. There is no shorthand for speed:
// what is typed is what is meant, and an out-of-shape entry is rejected rather than
// rescaled.
//
// No sport-specific upper bound is imposed. This project does not have a validated
// m/s range (same rule as Smart Random Hog-Hog ranges — see
// docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md), so the only constraint is the one the
// domain already states for every measured value: finite and greater than zero.
//
// See docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md and ADR-0051.

/** Characters a speed field accepts while typing — digits and either decimal mark. */
export const SPEED_INPUT_PATTERN = /^[0-9.,]*$/;

/**
 * Parses a typed speed, accepting both the comma and the dot as the decimal
 * separator (a German-speaking athlete types "2,40"; the app's language is English).
 * Returns null for anything that is not a usable measurement — blank, malformed,
 * non-finite, zero or negative — so a caller can tell "nothing entered" from "entered
 * something unusable" only by also inspecting the raw string. Never rescales.
 */
export function parseSpeedInput(input: string): number | null {
  const cleaned = input.trim().replace(",", ".");

  if (!cleaned) return null;

  // `Number("")` is 0 and `Number(" ")` is 0; both are already excluded above. A
  // second separator ("1.2.3") yields NaN, and an exponent or sign is not reachable
  // through SPEED_INPUT_PATTERN but is rejected here too for non-UI callers.
  if (!/^[0-9]*\.?[0-9]+$|^[0-9]+\.$/.test(cleaned)) return null;

  const value = Number(cleaned);

  if (!Number.isFinite(value) || value <= 0) return null;

  return value;
}

/** A speed with its unit. Never render a bare number (UX writing guidelines). */
export function formatSpeed(value: number): string {
  return `${value.toFixed(2)} m/s`;
}
