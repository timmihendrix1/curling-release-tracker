"use client";

import { useState } from "react";
import {
  ACCURACY_THRESHOLD_PRESETS,
  STANDARD_ACCURACY_THRESHOLDS,
  TIGHT_ACCURACY_THRESHOLDS,
  validateAccuracyThresholds,
  type AccuracyThresholdPreset,
} from "../lib/accuracyThresholds";
import { accuracyThresholdsSetupExplanation } from "../lib/analyticsExplanations";
import {
  measurementModeExplanation,
  trainingCategoryExplanation,
} from "../lib/helpContent";
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
import InfoButton from "./InfoButton";

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
}: TrainingSetupProps) {
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
  const [minTargetTimeInput, setMinTargetTimeInput] = useState(
    (initialValue?.smartRandomMin ?? DEFAULT_SMART_RANDOM_MIN).toFixed(2)
  );
  const [maxTargetTimeInput, setMaxTargetTimeInput] = useState(
    (initialValue?.smartRandomMax ?? DEFAULT_SMART_RANDOM_MAX).toFixed(2)
  );

  const [accuracyThresholdPreset, setAccuracyThresholdPreset] =
    useState<AccuracyThresholdPreset>(
      detectAccuracyThresholdPreset(initialValue?.accuracyThresholds)
    );
  const [customOnTargetInput, setCustomOnTargetInput] = useState(
    (
      initialValue?.accuracyThresholds?.onTarget ??
      STANDARD_ACCURACY_THRESHOLDS.onTarget
    ).toFixed(2)
  );
  const [customAcceptableInput, setCustomAcceptableInput] = useState(
    (
      initialValue?.accuracyThresholds?.acceptable ??
      STANDARD_ACCURACY_THRESHOLDS.acceptable
    ).toFixed(2)
  );

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
        <label className="text-sm font-medium text-slate-700">
          Block Name
        </label>

        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Draw Weight Practice"
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
        />
      </div>

      <div>
        {/* One shared Info action for the whole control group, describing
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
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">On Target (±s)</label>

              <input
                type="text"
                inputMode="decimal"
                value={customOnTargetInput}
                onChange={(event) => {
                  const value = event.target.value;
                  if (/^[0-9.,]*$/.test(value)) {
                    setCustomOnTargetInput(value);
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">
                Acceptable (±s)
              </label>

              <input
                type="text"
                inputMode="decimal"
                value={customAcceptableInput}
                onChange={(event) => {
                  const value = event.target.value;
                  if (/^[0-9.,]*$/.test(value)) {
                    setCustomAcceptableInput(value);
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
              />
            </div>

            {customAccuracyThresholdsValidation?.valid === false && (
              <p className="col-span-2 text-xs text-red-600">
                {customAccuracyThresholdsValidation.error}
              </p>
            )}
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
            Target Range
          </label>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500">
                Minimum Target Time
              </label>

              <input
                type="text"
                inputMode="decimal"
                value={minTargetTimeInput}
                onChange={(event) => {
                  const value = event.target.value;
                  const isValidInput = /^[0-9.,]*$/.test(value);

                  if (isValidInput) {
                    setMinTargetTimeInput(value);
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
              />
            </div>

            <div>
              <label className="text-xs text-slate-500">
                Maximum Target Time
              </label>

              <input
                type="text"
                inputMode="decimal"
                value={maxTargetTimeInput}
                onChange={(event) => {
                  const value = event.target.value;
                  const isValidInput = /^[0-9.,]*$/.test(value);

                  if (isValidInput) {
                    setMaxTargetTimeInput(value);
                  }
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
              />
            </div>
          </div>

          {smartRandomRangeValidation?.valid === false ? (
            <p className="mt-2 text-xs text-red-600">
              {smartRandomRangeValidation.error}
            </p>
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              Targets vary within this range. The app usually avoids large
              jumps between consecutive shots.
            </p>
          )}
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
