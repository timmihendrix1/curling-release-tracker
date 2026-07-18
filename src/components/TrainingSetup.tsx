"use client";

import { useState } from "react";
import {
  ACCURACY_THRESHOLD_PRESETS,
  STANDARD_ACCURACY_THRESHOLDS,
  TIGHT_ACCURACY_THRESHOLDS,
  validateAccuracyThresholds,
  type AccuracyThresholdPreset,
} from "../lib/accuracyThresholds";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { accuracyThresholdsSetupExplanation } from "../lib/analyticsExplanations";
import {
  measurementModeExplanation,
  trainingCategoryExplanation,
} from "../lib/helpContent";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import { parseReleaseTime } from "../lib/timeInput";
import {
  blindTargetModeLabel,
  blockModeLabel,
  isSmartRandomAvailable,
  measurementModeLabel,
  variableTargetModeLabel,
} from "../lib/trainingBlocks";
import {
  DEFAULT_SMART_RANDOM_MAX,
  DEFAULT_SMART_RANDOM_MIN,
  validateSmartRandomRange,
} from "../lib/variableTargets";
import type {
  AccuracyThresholds,
  BlindTargetMode,
  BlockMode,
  MeasurementMode,
  VariableTargetMode,
} from "../types";
import AccuracyToleranceProfileSelector from "./AccuracyToleranceProfileSelector";
import InfoButton from "./InfoButton";
import SmartRandomProfileSelector from "./SmartRandomProfileSelector";

export type TrainingSetupValue = {
  name: string;
  mode: BlockMode;
  measurementMode: MeasurementMode;
  targetTime: number;
  // Only used when mode === "variable"; ignored otherwise.
  variableTargetMode: VariableTargetMode;
  // Only used when mode === "blind"; ignored otherwise.
  blindTargetMode: BlindTargetMode;
  // Only used when variableTargetMode/blindTargetMode === "smart-random".
  smartRandomMin: number;
  smartRandomMax: number;
  // Personal Target Accuracy tolerance — applies to Fixed, Variable, and
  // Blind Weight alike; unrelated to Blind Weight's Prediction Accuracy.
  accuracyThresholds: AccuracyThresholds;
};

const ACCURACY_THRESHOLD_PRESET_OPTIONS: Exclude<
  AccuracyThresholdPreset,
  "custom"
>[] = ["standard", "tight"];

const ACCURACY_THRESHOLD_PRESET_LABELS: Record<AccuracyThresholdPreset, string> = {
  standard: "Standard",
  tight: "Tight",
  custom: "Custom",
};

function detectAccuracyThresholdPreset(
  thresholds: AccuracyThresholds | undefined
): AccuracyThresholdPreset {
  if (!thresholds) return "standard";

  if (
    thresholds.onTarget === STANDARD_ACCURACY_THRESHOLDS.onTarget &&
    thresholds.acceptable === STANDARD_ACCURACY_THRESHOLDS.acceptable
  ) {
    return "standard";
  }

  if (
    thresholds.onTarget === TIGHT_ACCURACY_THRESHOLDS.onTarget &&
    thresholds.acceptable === TIGHT_ACCURACY_THRESHOLDS.acceptable
  ) {
    return "tight";
  }

  return "custom";
}

type TrainingSetupProps = {
  initialValue?: Partial<TrainingSetupValue>;
  submitLabel: string;
  onSubmit: (value: TrainingSetupValue) => void;
  onCancel?: () => void;
  /** Saved Accuracy Tolerance Profiles the athlete can pick from under Custom. */
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  /** Prefills a brand-new configuration's Custom values; ignored when editing an
   * existing block/step (its own stored values always win — see the Accuracy
   * Tolerance Profiles product principle: a profile never overrides an
   * already-configured value). */
  defaultAccuracyToleranceProfileId?: string | null;
  /** Saved Smart Random Profiles the athlete can pick from wherever Smart
   * Random is the selected target source. */
  smartRandomProfiles?: SmartRandomProfile[];
  /** Prefills a brand-new Smart Random configuration's range; ignored when
   * editing an existing block/step, same principle as
   * defaultAccuracyToleranceProfileId above. */
  defaultSmartRandomProfileId?: string | null;
};

const BLOCK_MODES: BlockMode[] = ["fixed", "variable", "blind"];
const MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];
const VARIABLE_TARGET_MODES: VariableTargetMode[] = ["smart-random", "manual"];
const BLIND_TARGET_MODES: BlindTargetMode[] = ["fixed", "smart-random", "manual"];

const VARIABLE_TARGET_MODE_DESCRIPTIONS: Record<VariableTargetMode, string> = {
  "smart-random":
    "The app automatically picks a varying, sensible target time before each shot.",
  manual:
    "You (or your coach) enter the target time by hand before each shot.",
};

const BLIND_TARGET_MODE_DESCRIPTIONS: Record<BlindTargetMode, string> = {
  fixed: "A constant target time for every shot in this block.",
  "smart-random":
    "The app automatically picks a varying, sensible target time before each shot.",
  manual: "The target for each shot can be entered before the shot.",
};

export default function TrainingSetup({
  initialValue,
  submitLabel,
  onSubmit,
  onCancel,
  accuracyToleranceProfiles = [],
  defaultAccuracyToleranceProfileId = null,
  smartRandomProfiles = [],
  defaultSmartRandomProfileId = null,
}: TrainingSetupProps) {
  // Only relevant for prefilling a brand-new configuration (see the prop doc
  // comment above) — an existing block/step's own stored thresholds always win.
  const defaultToleranceProfile =
    !initialValue?.accuracyThresholds && defaultAccuracyToleranceProfileId
      ? (accuracyToleranceProfiles.find(
          (profile) => profile.id === defaultAccuracyToleranceProfileId
        ) ?? null)
      : null;

  // Only relevant for prefilling a brand-new Smart Random configuration; an
  // already-configured block/step's own stored range always wins. Also only
  // considered when the default profile's Measurement Mode matches this
  // configuration's starting Measurement Mode — a profile can never be
  // applied in the wrong measurement context.
  const defaultSmartRandomProfile =
    initialValue?.smartRandomMin === undefined &&
    initialValue?.smartRandomMax === undefined &&
    defaultSmartRandomProfileId
      ? (smartRandomProfiles.find(
          (profile) =>
            profile.id === defaultSmartRandomProfileId &&
            profile.measurementMode ===
              (initialValue?.measurementMode ?? "back-hog")
        ) ?? null)
      : null;

  const [name, setName] = useState(initialValue?.name ?? "");
  const [mode, setMode] = useState<BlockMode>(initialValue?.mode ?? "fixed");
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>(
    initialValue?.measurementMode ?? "back-hog"
  );
  const [variableTargetMode, setVariableTargetMode] =
    useState<VariableTargetMode>(
      initialValue?.variableTargetMode ?? "smart-random"
    );
  const [blindTargetMode, setBlindTargetMode] = useState<BlindTargetMode>(
    initialValue?.blindTargetMode ?? "fixed"
  );
  const [targetTimeInput, setTargetTimeInput] = useState(
    (initialValue?.targetTime ?? 3.75).toFixed(2)
  );
  // null = "Custom for this exercise" (a one-off range, the pre-existing
  // behavior); a profile id means the range fields are currently showing
  // that profile's values. Never persisted — see SmartRandomProfileSelector.
  const [selectedSmartRandomProfileId, setSelectedSmartRandomProfileId] =
    useState<string | null>(defaultSmartRandomProfile?.id ?? null);
  const [minTargetTimeInput, setMinTargetTimeInput] = useState(
    (
      initialValue?.smartRandomMin ??
      defaultSmartRandomProfile?.min ??
      DEFAULT_SMART_RANDOM_MIN
    ).toFixed(2)
  );
  const [maxTargetTimeInput, setMaxTargetTimeInput] = useState(
    (
      initialValue?.smartRandomMax ??
      defaultSmartRandomProfile?.max ??
      DEFAULT_SMART_RANDOM_MAX
    ).toFixed(2)
  );

  function handleSelectSmartRandomProfile(profileId: string | null) {
    setSelectedSmartRandomProfileId(profileId);

    if (profileId) {
      const profile = smartRandomProfiles.find((p) => p.id === profileId);
      if (profile) {
        setMinTargetTimeInput(profile.min.toFixed(2));
        setMaxTargetTimeInput(profile.max.toFixed(2));
      }
    }
  }

  const [accuracyThresholdPreset, setAccuracyThresholdPreset] =
    useState<AccuracyThresholdPreset>(
      detectAccuracyThresholdPreset(initialValue?.accuracyThresholds)
    );
  // null = "Custom for this exercise" (a one-off value, the pre-existing
  // behavior); a profile id means Custom's fields are currently showing that
  // profile's values. Never persisted — see AccuracyToleranceProfileSelector.
  const [selectedToleranceProfileId, setSelectedToleranceProfileId] = useState<
    string | null
  >(defaultToleranceProfile?.id ?? null);
  const [customOnTargetInput, setCustomOnTargetInput] = useState(
    (
      initialValue?.accuracyThresholds?.onTarget ??
      defaultToleranceProfile?.onTarget ??
      STANDARD_ACCURACY_THRESHOLDS.onTarget
    ).toFixed(2)
  );
  const [customAcceptableInput, setCustomAcceptableInput] = useState(
    (
      initialValue?.accuracyThresholds?.acceptable ??
      defaultToleranceProfile?.acceptable ??
      STANDARD_ACCURACY_THRESHOLDS.acceptable
    ).toFixed(2)
  );

  function handleSelectToleranceProfile(profileId: string | null) {
    setSelectedToleranceProfileId(profileId);

    if (profileId) {
      const profile = accuracyToleranceProfiles.find((p) => p.id === profileId);
      if (profile) {
        setCustomOnTargetInput(profile.onTarget.toFixed(2));
        setCustomAcceptableInput(profile.acceptable.toFixed(2));
      }
    }
  }

  const customAccuracyThresholdsValidation =
    accuracyThresholdPreset === "custom"
      ? validateAccuracyThresholds(
          parseReleaseTime(customOnTargetInput) ?? NaN,
          parseReleaseTime(customAcceptableInput) ?? NaN
        )
      : null;

  const resolvedAccuracyThresholds: AccuracyThresholds | null =
    accuracyThresholdPreset === "custom"
      ? customAccuracyThresholdsValidation?.valid === true
        ? {
            onTarget: customAccuracyThresholdsValidation.onTarget,
            acceptable: customAccuracyThresholdsValidation.acceptable,
          }
        : null
      : ACCURACY_THRESHOLD_PRESETS[accuracyThresholdPreset];

  const smartRandomAvailable = isSmartRandomAvailable(measurementMode);

  const effectiveTargetMode =
    mode === "variable"
      ? variableTargetMode
      : mode === "blind"
        ? blindTargetMode
        : "fixed";

  const showSmartRandomRange =
    effectiveTargetMode === "smart-random" && smartRandomAvailable;

  const smartRandomRangeValidation = showSmartRandomRange
    ? validateSmartRandomRange(
        parseReleaseTime(minTargetTimeInput) ?? NaN,
        parseReleaseTime(maxTargetTimeInput) ?? NaN
      )
    : null;

  // If the chosen measurement mode no longer supports Smart Random (e.g. the
  // coach just switched from Back-Hog to Hog-Hog), fall back to the safe
  // default automatically instead of letting an invalid combination be
  // submitted. Adjusting state during render like this — rather than in an
  // effect — avoids an extra render pass and matches how this project
  // already handles "reset derived state when a source value changes".
  const [lastSeenMeasurementMode, setLastSeenMeasurementMode] =
    useState(measurementMode);

  if (measurementMode !== lastSeenMeasurementMode) {
    setLastSeenMeasurementMode(measurementMode);

    if (!smartRandomAvailable) {
      if (variableTargetMode === "smart-random") {
        setVariableTargetMode("manual");
      }

      if (blindTargetMode === "smart-random") {
        setBlindTargetMode("manual");
      }
    }
  }

  function handleSubmit() {
    if (showSmartRandomRange && smartRandomRangeValidation?.valid === false) {
      // The inline error under the range fields already explains why.
      return;
    }

    if (resolvedAccuracyThresholds === null) {
      // The inline error under the Custom accuracy fields already explains why.
      return;
    }

    const parsedTargetTime = parseReleaseTime(targetTimeInput);

    if (
      !showSmartRandomRange &&
      (parsedTargetTime === null || parsedTargetTime <= 0)
    ) {
      alert("Please enter a valid target time.");
      return;
    }

    if (effectiveTargetMode === "smart-random" && !smartRandomAvailable) {
      alert(
        `Smart Random isn't available for ${measurementModeLabel(measurementMode)} yet. Please use Coach / Manual instead.`
      );
      return;
    }

    onSubmit({
      name: name.trim(),
      mode,
      measurementMode,
      targetTime: parsedTargetTime ?? DEFAULT_SMART_RANDOM_MIN,
      variableTargetMode,
      blindTargetMode,
      smartRandomMin:
        smartRandomRangeValidation?.valid === true
          ? smartRandomRangeValidation.min
          : DEFAULT_SMART_RANDOM_MIN,
      smartRandomMax:
        smartRandomRangeValidation?.valid === true
          ? smartRandomRangeValidation.max
          : DEFAULT_SMART_RANDOM_MAX,
      accuracyThresholds: resolvedAccuracyThresholds,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        {/* Training objective comes first — the IA's #1 priority question
            for Train is "what kind of training am I about to do?", not the
            block's name (compositional redesign — see
            docs/INFORMATION_ARCHITECTURE_AND_SCREEN_PHILOSOPHY.md's Train
            Information Priority). One shared Info action for the whole
            control group, describing
            whichever Training Mode is currently selected, rather than a
            cramped per-segment info icon on every button (DESIGN_SYSTEM.md
            §13.1's preferred alternative). */}
        <header className="flex items-center">
          <span className="text-sm font-medium text-slate-700">
            Training Mode
          </span>
          <InfoButton explanation={trainingCategoryExplanation(mode)} />
        </header>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {BLOCK_MODES.map((blockMode) => (
            <button
              key={blockMode}
              type="button"
              onClick={() => setMode(blockMode)}
              className={`min-h-11 w-full rounded-xl px-2 py-3 text-sm font-medium transition ${
                mode === blockMode
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {blockModeLabel(blockMode)}
            </button>
          ))}
        </div>

        <p className="mt-1.5 text-xs text-slate-500">
          {trainingCategoryExplanation(mode).shortDescription}
        </p>
      </div>

      <div>
        <header className="flex items-center">
          <span className="text-sm font-medium text-slate-700">
            Measurement Mode
          </span>
          <InfoButton explanation={measurementModeExplanation(measurementMode)} />
        </header>

        <div className="mt-2 grid grid-cols-2 gap-2">
          {MEASUREMENT_MODES.map((mm) => (
            <button
              key={mm}
              type="button"
              onClick={() => setMeasurementMode(mm)}
              className={`min-h-11 w-full rounded-xl px-2 py-3 text-sm font-medium transition ${
                measurementMode === mm
                  ? "bg-slate-900 text-white"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              {measurementModeLabel(mm)}
            </button>
          ))}
        </div>

        <p className="mt-1.5 text-xs text-slate-500">
          {measurementModeExplanation(measurementMode).shortDescription}
        </p>
      </div>

      {/* Target Configuration group — Block Name/Training Mode/Measurement
          Mode above are the Training Block decision; everything from here
          down is the Target Configuration decision (DESIGN_SYSTEM.md §15.5).
          A divider and section title separate the two within one form,
          rather than a second major card for a few related fields. */}
      <div className="border-t border-slate-200 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Target Configuration
        </h3>
      </div>

      <div>
        {/* <header>, not <div>/<label>, so the popover's block-level content
            (h3/p/ul) never nests inside this row's own text elements — same
            reasoning as ChartCard/DashboardCard's title row. */}
        <header className="flex items-center">
          <span className="text-sm font-medium text-slate-700">
            Accuracy Tolerance
          </span>
          <InfoButton explanation={accuracyThresholdsSetupExplanation()} />
        </header>

        <p className="mt-1 text-xs text-slate-500">
          How close counts as on target. Applies to this block&apos;s Target
          Accuracy, not Prediction Accuracy — a recommendation you can tune,
          not a fixed sporting standard.
        </p>

        <div className="mt-2 grid grid-cols-3 gap-2">
          {[...ACCURACY_THRESHOLD_PRESET_OPTIONS, "custom" as const].map(
            (preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAccuracyThresholdPreset(preset)}
                className={`rounded-xl px-3 py-3 text-sm font-medium transition ${
                  accuracyThresholdPreset === preset
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {ACCURACY_THRESHOLD_PRESET_LABELS[preset]}
              </button>
            )
          )}
        </div>

        {accuracyThresholdPreset !== "custom" ? (
          <p className="mt-2 text-xs text-slate-500">
            On target ±
            {ACCURACY_THRESHOLD_PRESETS[accuracyThresholdPreset].onTarget.toFixed(
              2
            )}
            s · Acceptable ±
            {ACCURACY_THRESHOLD_PRESETS[
              accuracyThresholdPreset
            ].acceptable.toFixed(2)}
            s
          </p>
        ) : (
          <div className="mt-2">
            <AccuracyToleranceProfileSelector
              profiles={accuracyToleranceProfiles}
              selectedProfileId={selectedToleranceProfileId}
              onSelectProfile={handleSelectToleranceProfile}
              onTargetInput={customOnTargetInput}
              acceptableInput={customAcceptableInput}
              onChangeOnTargetInput={setCustomOnTargetInput}
              onChangeAcceptableInput={setCustomAcceptableInput}
              errorMessages={
                customAccuracyThresholdsValidation?.valid === false
                  ? [customAccuracyThresholdsValidation.error]
                  : undefined
              }
            />
          </div>
        )}
      </div>

      {mode === "variable" && (
        <div>
          <label className="text-sm font-medium text-slate-700">
            Target Source
          </label>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {VARIABLE_TARGET_MODES.map((vtm) => {
              const disabled = vtm === "smart-random" && !smartRandomAvailable;

              return (
                <button
                  key={vtm}
                  type="button"
                  disabled={disabled}
                  onClick={() => setVariableTargetMode(vtm)}
                  className={`rounded-xl px-3 py-3 text-sm font-medium transition ${
                    disabled
                      ? "cursor-not-allowed bg-slate-100 text-slate-400"
                      : variableTargetMode === vtm
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {variableTargetModeLabel(vtm)}
                </button>
              );
            })}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {!smartRandomAvailable
              ? `Smart Random isn't available for ${measurementModeLabel(measurementMode)} yet — no validated target profile is defined for this measurement mode. Use Coach / Manual for now.`
              : VARIABLE_TARGET_MODE_DESCRIPTIONS[variableTargetMode]}
          </p>
        </div>
      )}

      {mode === "blind" && (
        <div>
          <label className="text-sm font-medium text-slate-700">
            Target Source
          </label>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {BLIND_TARGET_MODES.map((btm) => {
              const disabled = btm === "smart-random" && !smartRandomAvailable;

              return (
                <button
                  key={btm}
                  type="button"
                  disabled={disabled}
                  onClick={() => setBlindTargetMode(btm)}
                  className={`rounded-xl px-3 py-3 text-sm font-medium transition ${
                    disabled
                      ? "cursor-not-allowed bg-slate-100 text-slate-400"
                      : blindTargetMode === btm
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {blindTargetModeLabel(btm)}
                </button>
              );
            })}
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {!smartRandomAvailable
              ? `Smart Random isn't available for ${measurementModeLabel(measurementMode)} yet — no validated target profile is defined for this measurement mode. Use Fixed or Coach / Manual for now.`
              : BLIND_TARGET_MODE_DESCRIPTIONS[blindTargetMode]}
          </p>
        </div>
      )}

      {showSmartRandomRange && (
        <div>
          <label className="text-sm font-medium text-slate-700">
            Smart Random Settings
          </label>

          <div className="mt-2">
            <SmartRandomProfileSelector
              profiles={smartRandomProfiles}
              measurementMode={measurementMode}
              selectedProfileId={selectedSmartRandomProfileId}
              onSelectProfile={handleSelectSmartRandomProfile}
              minInput={minTargetTimeInput}
              maxInput={maxTargetTimeInput}
              onChangeMinInput={setMinTargetTimeInput}
              onChangeMaxInput={setMaxTargetTimeInput}
              errorMessages={
                smartRandomRangeValidation?.valid === false
                  ? [smartRandomRangeValidation.error]
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {!showSmartRandomRange && (
        <div>
          <label className="text-sm font-medium text-slate-700">
            {effectiveTargetMode === "manual"
              ? "Starting Target Time"
              : "Target Time"}
          </label>

          <input
            type="text"
            inputMode="decimal"
            value={targetTimeInput}
            onChange={(event) => {
              const value = event.target.value;
              const isValidInput = /^[0-9.,]*$/.test(value);

              if (isValidInput) {
                setTargetTimeInput(value);
              }
            }}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-400"
          />
        </div>
      )}

      {/* Optional detail, deliberately last — naming a block is lower
          priority than deciding what to train (IA doc's "Optional details",
          priority 4 of 4). */}
      <div className="border-t border-slate-100 pt-4">
        <label className="text-xs font-medium text-slate-500">
          Block Name <span className="font-normal">(optional)</span>
        </label>

        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Draw Weight Practice"
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
        />
      </div>

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300"
          >
            Cancel
          </button>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
