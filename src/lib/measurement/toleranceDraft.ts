// The editable form of a per-quantity tolerance: four text fields plus whether the
// athlete is currently editing it as one symmetric value per band or as explicit
// lower/upper sides.
//
// Kept as a pure module rather than component state so the parse/validate rule is
// identical everywhere a tolerance is edited (Training Setup, a Training Plan step,
// the Accuracy Tolerance Profile editor) and can be tested without rendering.
//
// Unit safety is structural here: the DRAFT carries its quantity, and parsing routes
// to that quantity's own parser — `parseReleaseTime` for seconds (preserving the
// existing hundredths shorthand exactly) and `parseSpeedInput` for m/s (which has no
// shorthand). A seconds draft can therefore never be read as m/s by accident.
//
// See docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md and ADR-0051.
import type { MeasuredQuantity, QuantityTolerance } from "../../types";
import { parseReleaseTime } from "../timeInput";
import { parseSpeedInput } from "./speedInput";
import {
  DEFAULT_SPEED_TOLERANCE,
  isSymmetricTolerance,
  symmetricTolerance,
  validateQuantityTolerance,
  type QuantityToleranceValidation,
} from "./tolerance";
import {
  STANDARD_ACCURACY_THRESHOLDS,
} from "../accuracyThresholds";

export type QuantityToleranceDraft = {
  quantity: MeasuredQuantity;
  /**
   * While true the two `*Lower` fields are the whole value and the `*Upper` fields
   * are kept in step with them, so toggling back and forth never strands a stale
   * upper value that the athlete cannot see.
   */
  symmetric: boolean;
  onTargetLower: string;
  onTargetUpper: string;
  acceptableLower: string;
  acceptableUpper: string;
};

/**
 * A number as EDITABLE text — lossless.
 *
 * Deliberately not `toFixed(2)`. These strings are reopened, parsed and saved again,
 * so rounding here is not a display choice: it silently rewrites the stored value.
 * A target speed of 2.3456 reopened through `toFixed(2)` saves back as 2.35, and a
 * tolerance of 0.055 becomes 0.06 — the athlete changed nothing and the configuration
 * moved. Small valid tolerances could even round to 0 and become invalid.
 *
 * Values that ARE exactly representable in two decimals keep their familiar "0.10"
 * form, so nothing that was already precise looks different; anything finer keeps
 * every digit it had. Display formatting lives in src/lib/measurement/format.ts and
 * is a separate concern from this.
 */
/**
 * The exact value of a finite number as a PLAIN decimal string — never exponent
 * notation, never rounded.
 *
 * `toFixed` cannot do this on its own: it caps at 20 fraction digits (so 1e-21
 * collapses to "0") and switches to exponent notation at 1e21 and above. Expanding
 * `toExponential()` — which yields the shortest digit sequence that uniquely
 * identifies the double — reproduces the value exactly at any magnitude.
 */
function plainDecimal(value: number): string {
  const parsed = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(value.toExponential());
  // Unreachable for a finite number; returning the ordinary form rather than throwing
  // keeps a formatting helper from taking down a render.
  if (!parsed) return String(value);

  const [, sign, lead, fraction = "", exponentText] = parsed;
  const digits = `${lead}${fraction}`;
  const exponent = Number(exponentText);

  if (exponent >= 0) {
    if (exponent + 1 >= digits.length) {
      return `${sign}${digits}${"0".repeat(exponent + 1 - digits.length)}`;
    }
    return `${sign}${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}`;
  }

  return `${sign}0.${"0".repeat(-exponent - 1)}${digits}`;
}

/**
 * A number as EDITABLE text — lossless.
 *
 * Deliberately not `toFixed(2)`. These strings are reopened, parsed and saved again,
 * so rounding here is not a display choice: it silently rewrites the stored value.
 * A target speed of 2.3456 reopened through `toFixed(2)` saves back as 2.35, and a
 * tolerance of 0.055 becomes 0.06 — the athlete changed nothing and the configuration
 * moved. Small valid tolerances could even round to 0 and become invalid.
 *
 * The contract is exact: for every finite value this domain accepts, the result is a
 * plain decimal that the quantity's own parser reads back as the identical number.
 * Values that ARE exactly representable in two decimals keep their familiar "0.10"
 * form, so nothing that was already precise looks different; anything else keeps every
 * digit it had. Display formatting lives in src/lib/measurement/format.ts and is a
 * separate concern from this.
 */
export function editableNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);

  const twoDecimals = value.toFixed(2);
  // `toFixed` itself returns exponent notation at 1e21 and above, and the parsers that
  // read these fields back reject it — so the familiar two-decimal form is only taken
  // when it really is a plain decimal that still means the same number.
  if (!twoDecimals.includes("e") && Number(twoDecimals) === value) {
    return twoDecimals;
  }

  return plainDecimal(value);
}

function format(value: number): string {
  return editableNumber(value);
}

/** The starting tolerance for a newly selected quantity. */
export function defaultToleranceFor(quantity: MeasuredQuantity): QuantityTolerance {
  return quantity === "speed"
    ? DEFAULT_SPEED_TOLERANCE
    : symmetricTolerance(
        STANDARD_ACCURACY_THRESHOLDS.onTarget,
        STANDARD_ACCURACY_THRESHOLDS.acceptable
      );
}

/**
 * The editable form of an existing tolerance. A genuinely asymmetric tolerance opens
 * in asymmetric mode — it is never shown as a symmetric value, which would name a
 * cutoff that exists on neither side.
 */
export function draftFromTolerance(
  tolerance: QuantityTolerance,
  quantity: MeasuredQuantity
): QuantityToleranceDraft {
  return {
    quantity,
    symmetric: isSymmetricTolerance(tolerance),
    onTargetLower: format(tolerance.onTarget.lower),
    onTargetUpper: format(tolerance.onTarget.upper),
    acceptableLower: format(tolerance.acceptable.lower),
    acceptableUpper: format(tolerance.acceptable.upper),
  };
}

export function defaultToleranceDraft(
  quantity: MeasuredQuantity
): QuantityToleranceDraft {
  return draftFromTolerance(defaultToleranceFor(quantity), quantity);
}

function parseField(draft: QuantityToleranceDraft, raw: string): number {
  const parsed =
    draft.quantity === "speed" ? parseSpeedInput(raw) : parseReleaseTime(raw);
  // NaN flows into validateQuantityTolerance, which reports the same
  // "greater than zero" message a negative or absent value gets. Returning NaN
  // rather than throwing keeps this usable for live, keystroke-by-keystroke
  // validation of a half-typed field.
  return parsed ?? NaN;
}

/**
 * Validates a draft and yields the tolerance it means. In symmetric mode BOTH sides
 * come from the single `*Lower` field, so a stale `*Upper` value left over from an
 * earlier asymmetric edit can never leak into the saved result.
 */
export function parseToleranceDraft(
  draft: QuantityToleranceDraft
): QuantityToleranceValidation {
  const onTargetLower = parseField(draft, draft.onTargetLower);
  const acceptableLower = parseField(draft, draft.acceptableLower);

  if (draft.symmetric) {
    return validateQuantityTolerance(
      symmetricTolerance(onTargetLower, acceptableLower)
    );
  }

  return validateQuantityTolerance({
    onTarget: { lower: onTargetLower, upper: parseField(draft, draft.onTargetUpper) },
    acceptable: {
      lower: acceptableLower,
      upper: parseField(draft, draft.acceptableUpper),
    },
  });
}

/**
 * Switching between symmetric and asymmetric editing.
 *
 * Going symmetric collapses onto the LOWER side rather than silently keeping two
 * disagreeing numbers behind one visible field. Going asymmetric seeds both sides
 * from the single value, so the first thing the athlete sees is the tolerance they
 * already had, expressed per side — not an empty or defaulted upper field.
 */
export function withSymmetry(
  draft: QuantityToleranceDraft,
  symmetric: boolean
): QuantityToleranceDraft {
  if (symmetric === draft.symmetric) return draft;

  if (symmetric) {
    return {
      ...draft,
      symmetric: true,
      onTargetUpper: draft.onTargetLower,
      acceptableUpper: draft.acceptableLower,
    };
  }

  return {
    ...draft,
    symmetric: false,
    onTargetUpper: draft.onTargetLower,
    acceptableUpper: draft.acceptableLower,
  };
}

/**
 * Retargets a draft at a different quantity. The NUMBERS are not carried across:
 * 0.10 seconds and 0.10 m/s are unrelated quantities, and reusing the digits would be
 * exactly the silent unit reinterpretation unit safety exists to prevent. The new
 * quantity's own starting values are used instead.
 */
export function draftForQuantity(
  draft: QuantityToleranceDraft,
  quantity: MeasuredQuantity
): QuantityToleranceDraft {
  return draft.quantity === quantity ? draft : defaultToleranceDraft(quantity);
}
