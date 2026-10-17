"use client";

import { useState } from "react";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { accuracyToleranceProfilesFor } from "../lib/accuracyToleranceProfiles/profiles";
import {
  editableNumber,
  parseToleranceDraft,
  withSymmetry,
  type QuantityToleranceDraft,
} from "../lib/measurement/toleranceDraft";
import { SPEED_INPUT_PATTERN } from "../lib/measurement/speedInput";
import {
  DEFAULT_SPEED_TOLERANCE,
  isSymmetricTolerance,
  quantityUnitLabel,
  symmetricTolerance,
  toleranceBandLabel,
} from "../lib/measurement/tolerance";
import {
  STANDARD_ACCURACY_THRESHOLDS,
  TIGHT_ACCURACY_THRESHOLDS,
} from "../lib/accuracyThresholds";
import type { MeasuredQuantity, QuantityTolerance } from "../types";

/**
 * The app's own starting values, offered in the SAME list as the athlete's saved
 * templates rather than as a competing row of preset buttons beside it. One control
 * answers "what tolerance?" — which is the simplification this stage is for — and a
 * built-in is not privileged over a template the athlete actually saved.
 *
 * These are adjustable product starting values, not federation or scientific norms.
 */
const BUILT_IN_TOLERANCES: Record<
  MeasuredQuantity,
  { id: string; name: string; tolerance: QuantityTolerance }[]
> = {
  time: [
    {
      id: "built-in:standard",
      name: "Standard",
      tolerance: symmetricTolerance(
        STANDARD_ACCURACY_THRESHOLDS.onTarget,
        STANDARD_ACCURACY_THRESHOLDS.acceptable
      ),
    },
    {
      id: "built-in:tight",
      name: "Tight",
      tolerance: symmetricTolerance(
        TIGHT_ACCURACY_THRESHOLDS.onTarget,
        TIGHT_ACCURACY_THRESHOLDS.acceptable
      ),
    },
  ],
  speed: [
    {
      id: "built-in:speed-default",
      name: "App default",
      tolerance: DEFAULT_SPEED_TOLERANCE,
    },
  ],
};

/** A factual, unit-bearing description of any tolerance, saved or built in. */
export function toleranceSummaryLabel(
  tolerance: QuantityTolerance,
  quantity: MeasuredQuantity
): string {
  return `On Target ${toleranceBandLabel(tolerance.onTarget, quantity)} · Acceptable ${toleranceBandLabel(tolerance.acceptable, quantity)}`;
}

type QuantityToleranceEditorProps = {
  draft: QuantityToleranceDraft;
  onChange: (draft: QuantityToleranceDraft) => void;
  /**
   * The athlete's whole saved library. Filtered HERE to the draft's own quantity, so
   * a seconds template can never be offered for a m/s band — the one selection rule
   * that would silently reinterpret a template's numbers.
   */
  profiles?: AccuracyToleranceProfile[];
  /** Distinguishes this editor's field ids when two are on screen (Both). */
  idPrefix: string;
  /**
   * False where the surrounding form cannot actually persist a per-side tolerance —
   * Variable and Blind Weight keep their time-only legacy representation, which has
   * no place to store one. Offering the option there would accept a value the save
   * would then have to flatten, so it is simply not offered.
   */
  allowAsymmetry?: boolean;
};

/**
 * Edits one quantity's On Target / Acceptable tolerance.
 *
 * Saved templates are offered directly, at the top, rather than behind a "Custom"
 * step — a template the athlete already saved is the fastest correct answer, not an
 * advanced option. Applying one copies its numbers into the fields; nothing keeps a
 * live reference to the template, so editing or deleting it later never reaches a
 * block that was already created (ADR-0008's snapshot rule).
 *
 * Both symmetric and asymmetric templates can be applied here, which is what Stage B
 * adds over the symmetric-only legacy selector: the per-side fields can represent
 * every template shape this app can store, so none has to be withheld or flattened.
 */
export default function QuantityToleranceEditor({
  draft,
  onChange,
  profiles = [],
  idPrefix,
  allowAsymmetry = true,
}: QuantityToleranceEditorProps) {
  const [preferredChoiceId, setPreferredChoiceId] = useState("");
  const { quantity } = draft;
  const unit = quantityUnitLabel(quantity);
  // Unit compatibility is necessary but NOT sufficient. A destination that cannot
  // persist a per-side tolerance (Variable/Blind Weight, which keep the legacy
  // time-only representation) must not be offered an asymmetric template either: it
  // would be applied, silently collapsed onto its lower side on save, and the athlete
  // would be left with a configuration that is not the template they chose.
  const compatible = accuracyToleranceProfilesFor(profiles, quantity).filter(
    (profile) => allowAsymmetry || isSymmetricTolerance(profile.tolerance)
  );
  const validation = parseToleranceDraft(draft);

  // One list: the app's built-in starting values first, then the athlete's own saved
  // templates. Both are applied the same way and neither is a prerequisite for the
  // other — there is no "Custom" step to find before the templates appear.
  const choices = [
    ...BUILT_IN_TOLERANCES[quantity],
    ...compatible.map((profile) => ({
      id: profile.id,
      name: profile.name,
      tolerance: profile.tolerance,
    })),
  ];

  // This is display state only. The copied numeric snapshot remains authoritative;
  // editing/deleting a library preset never changes these fields or saved blocks.
  const matchingChoices = choices.filter(({ tolerance }) => validation.valid &&
    tolerance.onTarget.lower === validation.tolerance.onTarget.lower &&
    tolerance.onTarget.upper === validation.tolerance.onTarget.upper &&
    tolerance.acceptable.lower === validation.tolerance.acceptable.lower &&
    tolerance.acceptable.upper === validation.tolerance.acceptable.upper);
  const selectedChoice = matchingChoices.find(({ id }) => id === preferredChoiceId)
    ?? matchingChoices[0];

  // Seconds keep the existing input mask (which the shared hundredths shorthand
  // relies on); m/s uses its own, deliberately shorthand-free one.
  const pattern = quantity === "speed" ? SPEED_INPUT_PATTERN : /^[0-9.,]*$/;

  function setField(field: keyof QuantityToleranceDraft, raw: string) {
    if (!pattern.test(raw)) return;
    onChange({ ...draft, [field]: raw });
  }

  function applyTolerance(choiceId: string) {
    const choice = choices.find((candidate) => candidate.id === choiceId);
    if (!choice) return;

    setPreferredChoiceId(choice.id);
    const { onTarget, acceptable } = choice.tolerance;
    const symmetric =
      onTarget.lower === onTarget.upper && acceptable.lower === acceptable.upper;

    onChange({
      quantity,
      symmetric,
      // Lossless: applying a saved template must reproduce its exact values, not a
      // two-decimal approximation that the next save would then store back.
      onTargetLower: editableNumber(onTarget.lower),
      onTargetUpper: editableNumber(onTarget.upper),
      acceptableLower: editableNumber(acceptable.lower),
      acceptableUpper: editableNumber(acceptable.upper),
    });
  }

  function field(
    key: keyof QuantityToleranceDraft,
    label: string,
    id: string
  ) {
    return (
      <div>
        <label className="text-xs text-slate-500" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft[key] as string}
          onChange={(event) => setField(key, event.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label
          className="text-xs text-slate-500"
          htmlFor={`${idPrefix}-tolerance-template`}
        >
          Start from a saved value
        </label>
        <select
          id={`${idPrefix}-tolerance-template`}
          value={selectedChoice?.id ?? ""}
          onChange={(event) => {
            if (event.target.value) applyTolerance(event.target.value);
          }}
          className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900"
        >
          <option value="">Custom values</option>
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name} — {toleranceSummaryLabel(choice.tolerance, quantity)}
            </option>
          ))}
        </select>
      </div>

      {draft.symmetric || !allowAsymmetry ? (
        <div className="grid grid-cols-2 gap-2">
          {field("onTargetLower", `On Target (±${unit})`, `${idPrefix}-on-target`)}
          {field("acceptableLower", `Acceptable (±${unit})`, `${idPrefix}-acceptable`)}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {field(
              "onTargetLower",
              `On Target below target (${unit})`,
              `${idPrefix}-on-target-lower`
            )}
            {field(
              "onTargetUpper",
              `On Target above target (${unit})`,
              `${idPrefix}-on-target-upper`
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {field(
              "acceptableLower",
              `Acceptable below target (${unit})`,
              `${idPrefix}-acceptable-lower`
            )}
            {field(
              "acceptableUpper",
              `Acceptable above target (${unit})`,
              `${idPrefix}-acceptable-upper`
            )}
          </div>
        </div>
      )}

      {allowAsymmetry && (
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={!draft.symmetric}
            onChange={(event) =>
              onChange(withSymmetry(draft, !event.target.checked))
            }
            className="h-4 w-4 rounded border-slate-300"
          />
          Use separate tolerances below and above the target
        </label>
      )}

      {validation.valid === false && (
        <p role="alert" className="text-xs text-red-600">
          {validation.error}
        </p>
      )}
    </div>
  );
}
