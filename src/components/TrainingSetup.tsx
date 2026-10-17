"use client";

import { useState } from "react";
import { STANDARD_ACCURACY_THRESHOLDS } from "../lib/accuracyThresholds";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { accuracyThresholdsSetupExplanation } from "../lib/analyticsExplanations";
import {
  measuredQuantitiesExplanation,
  measurementModeExplanation,
  trainingCategoryExplanation,
  trainingModeShortDescription,
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
import {
  draftFromTolerance,
  defaultToleranceDraft,
  editableNumber,
  parseToleranceDraft,
  withSymmetry,
  type QuantityToleranceDraft,
} from "../lib/measurement/toleranceDraft";
import {
  isSymmetricTolerance,
  toleranceAsAccuracyThresholds,
  toleranceFromAccuracyThresholds,
} from "../lib/measurement/tolerance";
import {
  SPEED_INPUT_PATTERN,
  parseSpeedInput,
} from "../lib/measurement/speedInput";
import type {
  AccuracyThresholds,
  BlindTargetMode,
  BlockMeasurementConfiguration,
  BlockMode,
  MeasuredQuantity,
  MeasurementMode,
  VariableTargetMode,
} from "../types";
import InfoButton from "./InfoButton";
import QuantityToleranceEditor, {
  toleranceSummaryLabel,
} from "./QuantityToleranceEditor";
import SmartRandomProfileSelector from "./SmartRandomProfileSelector";

export type TrainingSetupValue = {
  name: string;
  mode: BlockMode;
  // Both are genuinely absent for a speed-only Fixed Weight block, which measures no
  // time at all — never defaulted to a fabricated interval or 3.75s (ADR-0051).
  measurementMode?: MeasurementMode;
  targetTime?: number;
  // Only used when mode === "variable"; ignored otherwise.
  variableTargetMode: VariableTargetMode;
  // Only used when mode === "blind"; ignored otherwise.
  blindTargetMode: BlindTargetMode;
  // Only used when variableTargetMode/blindTargetMode === "smart-random".
  smartRandomMin: number;
  smartRandomMax: number;
  // Personal Target Accuracy tolerance — applies to Fixed, Variable, and
  // Blind Weight alike; unrelated to Blind Weight's Prediction Accuracy. Remains the
  // symmetric legacy pair; when a tolerance cannot be expressed as one (asymmetric)
  // or the block records speed, `measurement` below is the authority.
  accuracyThresholds: AccuracyThresholds;
  /**
   * Emitted ONLY when this configuration genuinely needs it: the block records speed,
   * or a time tolerance is asymmetric. An ordinary symmetric time-only Fixed Weight
   * setup emits nothing here, so it creates exactly the block it always did, with the
   * same stored bytes and the same cloud payload (ADR-0051).
   */
  measurement?: BlockMeasurementConfiguration;
};

type TrainingSetupProps = {
  initialValue?: Partial<TrainingSetupValue>;
  submitLabel: string;
  onSubmit: (value: TrainingSetupValue) => void;
  onCancel?: () => void;
  /** Saved Accuracy Tolerance Profiles the athlete can apply, per measured quantity. */
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  /** Prefills a brand-new configuration's tolerance; ignored when editing an
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
  /**
   * True while the Session domain isn't "ready" (see
   * docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.10) — disables submitting this
   * form (block creation always mutates Session) without hiding or
   * resetting whatever the athlete has already configured.
   */
  disabled?: boolean;
};

const BLOCK_MODES: BlockMode[] = ["fixed", "variable", "blind"];
const MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];
const VARIABLE_TARGET_MODES: VariableTargetMode[] = ["smart-random", "manual"];
const BLIND_TARGET_MODES: BlindTargetMode[] = ["fixed", "smart-random", "manual"];

/** The three measurement selections a Fixed Weight exercise offers. */
type QuantitySelection = "time" | "speed" | "both";

const QUANTITY_SELECTIONS: { value: QuantitySelection; label: string }[] = [
  { value: "time", label: "Time" },
  { value: "speed", label: "Speed (m/s)" },
  { value: "both", label: "Both" },
];

function selectionQuantities(selection: QuantitySelection): MeasuredQuantity[] {
  if (selection === "time") return ["time"];
  if (selection === "speed") return ["speed"];
  return ["time", "speed"];
}

/** The selection an existing configuration represents. Absent means legacy time-only. */
function selectionFromMeasurement(
  measurement: BlockMeasurementConfiguration | undefined
): QuantitySelection {
  if (!measurement) return "time";
  const measuresTime = measurement.quantities.includes("time");
  const measuresSpeed = measurement.quantities.includes("speed");
  if (measuresTime && measuresSpeed) return "both";
  return measuresSpeed ? "speed" : "time";
}

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
  disabled = false,
}: TrainingSetupProps) {
  const [name, setName] = useState(initialValue?.name ?? "");
  const [mode, setMode] = useState<BlockMode>(initialValue?.mode ?? "fixed");
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>(
    initialValue?.measurementMode ?? "back-hog"
  );
  const [quantitySelection, setQuantitySelection] = useState<QuantitySelection>(
    selectionFromMeasurement(initialValue?.measurement)
  );
  const [variableTargetMode, setVariableTargetMode] =
    useState<VariableTargetMode>(
      initialValue?.variableTargetMode ?? "smart-random"
    );
  const [blindTargetMode, setBlindTargetMode] = useState<BlindTargetMode>(
    initialValue?.blindTargetMode ?? "fixed"
  );
  const [targetTimeInput, setTargetTimeInput] = useState(
    editableNumber(
      initialValue?.measurement?.time?.target ??
        initialValue?.targetTime ??
        3.75
    )
  );
  // Deliberately NOT seeded with a number. There is no default target speed to
  // invent (ADR-0051), so a Speed or Both setup cannot be started until the athlete
  // states the one they are training against.
  const [targetSpeedInput, setTargetSpeedInput] = useState(
    initialValue?.measurement?.speed !== undefined
      ? editableNumber(initialValue.measurement.speed.target)
      : ""
  );

  // null = "Custom for this exercise" (a one-off range, the pre-existing
  // behavior); a profile id means the range fields are currently showing
  // that profile's values. Never persisted — see SmartRandomProfileSelector.
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

  const [selectedSmartRandomProfileId, setSelectedSmartRandomProfileId] =
    useState<string | null>(defaultSmartRandomProfile?.id ?? null);
  const [minTargetTimeInput, setMinTargetTimeInput] = useState(
    editableNumber(
      initialValue?.smartRandomMin ??
        defaultSmartRandomProfile?.min ??
        DEFAULT_SMART_RANDOM_MIN
    )
  );
  const [maxTargetTimeInput, setMaxTargetTimeInput] = useState(
    editableNumber(
      initialValue?.smartRandomMax ??
        defaultSmartRandomProfile?.max ??
        DEFAULT_SMART_RANDOM_MAX
    )
  );

  function handleSelectSmartRandomProfile(profileId: string | null) {
    setSelectedSmartRandomProfileId(profileId);

    if (profileId) {
      const profile = smartRandomProfiles.find((p) => p.id === profileId);
      if (profile) {
        setMinTargetTimeInput(editableNumber(profile.min));
        setMaxTargetTimeInput(editableNumber(profile.max));
      }
    }
  }

  // The tolerance drafts. A brand-new configuration may be seeded from the athlete's
  // default template, but only one that is unit-compatible — a speed default must
  // never seed the seconds fields with its m/s numbers, and vice versa.
  //
  // Shape compatibility is checked as well as unit compatibility: a form that cannot
  // persist a per-side tolerance must not be SEEDED with an asymmetric template
  // either, or the very first save would collapse it onto one side.
  const defaultToleranceCandidate =
    !initialValue?.accuracyThresholds && !initialValue?.measurement
      ? (accuracyToleranceProfiles.find(
          (profile) => profile.id === defaultAccuracyToleranceProfileId
        ) ?? null)
      : null;
  const initialModeAllowsAsymmetry = (initialValue?.mode ?? "fixed") === "fixed";
  const defaultToleranceProfile =
    defaultToleranceCandidate &&
    (initialModeAllowsAsymmetry ||
      isSymmetricTolerance(defaultToleranceCandidate.tolerance))
      ? defaultToleranceCandidate
      : null;

  const [timeToleranceDraft, setTimeToleranceDraft] =
    useState<QuantityToleranceDraft>(() => {
      const configured = initialValue?.measurement?.time?.tolerance;
      if (configured) return draftFromTolerance(configured, "time");
      if (initialValue?.accuracyThresholds) {
        return draftFromTolerance(
          toleranceFromAccuracyThresholds(initialValue.accuracyThresholds),
          "time"
        );
      }
      if (defaultToleranceProfile?.quantity === "time") {
        return draftFromTolerance(defaultToleranceProfile.tolerance, "time");
      }
      return defaultToleranceDraft("time");
    });

  const [speedToleranceDraft, setSpeedToleranceDraft] =
    useState<QuantityToleranceDraft>(() => {
      const configured = initialValue?.measurement?.speed?.tolerance;
      if (configured) return draftFromTolerance(configured, "speed");
      if (defaultToleranceProfile?.quantity === "speed") {
        return draftFromTolerance(defaultToleranceProfile.tolerance, "speed");
      }
      return defaultToleranceDraft("speed");
    });

  const [showToleranceEditor, setShowToleranceEditor] = useState(false);

  const smartRandomAvailable = isSmartRandomAvailable(measurementMode);

  const effectiveTargetMode =
    mode === "variable"
      ? variableTargetMode
      : mode === "blind"
        ? blindTargetMode
        : "fixed";

  // Only Fixed Weight chooses what it measures. Variable and Blind Weight keep their
  // existing time-only semantics exactly (ADR-0051), so the selection control is not
  // shown for them and their configuration never carries one.
  const canChooseQuantities = mode === "fixed";
  const effectiveSelection: QuantitySelection = canChooseQuantities
    ? quantitySelection
    : "time";
  const measuresTime = effectiveSelection !== "speed";
  const measuresSpeed = effectiveSelection !== "time";

  const showSmartRandomRange =
    effectiveTargetMode === "smart-random" && smartRandomAvailable && measuresTime;

  const smartRandomRangeValidation = showSmartRandomRange
    ? validateSmartRandomRange(
        parseReleaseTime(minTargetTimeInput) ?? NaN,
        parseReleaseTime(maxTargetTimeInput) ?? NaN
      )
    : null;

  // Variable and Blind Weight cannot persist a measurement configuration at all, so
  // an asymmetric tolerance is not representable there — the form offers only what it
  // can actually store, rather than accepting a value it would silently flatten.
  const asymmetryAvailable = mode === "fixed";

  // What this form can actually persist is applied to the DRAFT itself, not merely to
  // how it is rendered — otherwise the screen would display one tolerance and save
  // another.
  //
  // A genuinely asymmetric tolerance is NOT collapsed onto its lower side here. That
  // would keep the template's name and half its meaning, saving a configuration the
  // athlete never chose and cannot see is different. A form that cannot represent it
  // falls back to that quantity's own standard values instead, which is visible in the
  // fields the moment it happens.
  const representable = (draft: QuantityToleranceDraft): QuantityToleranceDraft => {
    if (asymmetryAvailable || draft.symmetric) return draft;
    const collapsible =
      draft.onTargetLower === draft.onTargetUpper &&
      draft.acceptableLower === draft.acceptableUpper;
    return collapsible
      ? withSymmetry(draft, true)
      : defaultToleranceDraft(draft.quantity);
  };

  const effectiveTimeDraft = representable(timeToleranceDraft);
  const effectiveSpeedDraft = representable(speedToleranceDraft);

  const timeToleranceValidation = parseToleranceDraft(effectiveTimeDraft);
  const speedToleranceValidation = parseToleranceDraft(effectiveSpeedDraft);

  // If the chosen measurement mode no longer supports Smart Random (e.g. the
  // coach just switched from Back-Hog to Hog-Hog), fall back to the safe
  // default automatically instead of letting an invalid combination be
  // submitted.
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

  // Leaving Fixed Weight returns to time-only semantics. The speed fields keep their
  // typed values in local state so switching back does not lose them, but nothing
  // inapplicable is ever submitted — `effectiveSelection` above is what is read.
  const [lastSeenMode, setLastSeenMode] = useState(mode);

  if (mode !== lastSeenMode) {
    setLastSeenMode(mode);
    if (mode !== "fixed") setShowToleranceEditor(false);
  }

  const timeToleranceLabel = timeToleranceValidation.valid
    ? toleranceSummaryLabel(timeToleranceValidation.tolerance, "time")
    : "Not valid yet";
  const speedToleranceLabel = speedToleranceValidation.valid
    ? toleranceSummaryLabel(speedToleranceValidation.tolerance, "speed")
    : "Not valid yet";

  function handleSubmit() {
    if (showSmartRandomRange && smartRandomRangeValidation?.valid === false) {
      // The inline error under the range fields already explains why.
      return;
    }

    if (measuresTime && !timeToleranceValidation.valid) {
      setShowToleranceEditor(true);
      return;
    }

    if (measuresSpeed && !speedToleranceValidation.valid) {
      setShowToleranceEditor(true);
      return;
    }

    const parsedTargetTime = measuresTime
      ? parseReleaseTime(targetTimeInput)
      : null;

    if (
      measuresTime &&
      !showSmartRandomRange &&
      (parsedTargetTime === null || parsedTargetTime <= 0)
    ) {
      alert("Please enter a valid target time.");
      return;
    }

    // No fabricated default: a Speed or Both exercise cannot start without the target
    // speed it is training against.
    const parsedTargetSpeed = measuresSpeed
      ? parseSpeedInput(targetSpeedInput)
      : null;

    if (measuresSpeed && parsedTargetSpeed === null) {
      alert("Please enter a target speed in metres per second.");
      return;
    }

    if (effectiveTargetMode === "smart-random" && measuresTime && !smartRandomAvailable) {
      alert(
        `Smart Random isn't available for ${measurementModeLabel(measurementMode)} yet. Please use Coach / Manual instead.`
      );
      return;
    }

    const resolvedTimeTolerance = timeToleranceValidation.valid
      ? timeToleranceValidation.tolerance
      : null;

    // The effective time target: a Smart Random block's own starting value keeps the
    // long-standing fallback, exactly as before.
    const effectiveTargetTime = measuresTime
      ? (parsedTargetTime ?? DEFAULT_SMART_RANDOM_MIN)
      : undefined;

    // A measurement configuration is emitted ONLY when it is genuinely needed: the
    // block records speed, or its time tolerance is asymmetric and therefore cannot
    // be expressed by the legacy symmetric pair. Ordinary symmetric time-only
    // training keeps its exact historical representation — which is what keeps its
    // stored bytes, cloud payload and digest unchanged (ADR-0051).
    const needsMeasurement =
      measuresSpeed ||
      (measuresTime &&
        resolvedTimeTolerance !== null &&
        !isSymmetricTolerance(resolvedTimeTolerance));

    let measurement: BlockMeasurementConfiguration | undefined;
    if (needsMeasurement) {
      const quantities = selectionQuantities(effectiveSelection);
      measurement = { quantities };
      if (measuresTime && resolvedTimeTolerance && effectiveTargetTime !== undefined) {
        measurement.time = {
          target: effectiveTargetTime,
          tolerance: resolvedTimeTolerance,
        };
      }
      if (measuresSpeed && speedToleranceValidation.valid && parsedTargetSpeed !== null) {
        measurement.speed = {
          target: parsedTargetSpeed,
          tolerance: speedToleranceValidation.tolerance,
        };
      }
    }

    // The legacy symmetric mirror. When the real tolerance is asymmetric no symmetric
    // pair expresses it, so the app's standard values are carried as an inert legacy
    // field rather than one side being presented as if it were both; `measurement` is
    // the authority in that case and is what every reader consults.
    const legacyThresholds: AccuracyThresholds =
      (resolvedTimeTolerance
        ? toleranceAsAccuracyThresholds(resolvedTimeTolerance)
        : undefined) ?? STANDARD_ACCURACY_THRESHOLDS;

    onSubmit({
      name: name.trim(),
      mode,
      // Genuinely omitted for a speed-only block: it measures no time, so it has no
      // timing interval and no time target to persist.
      ...(measuresTime ? { measurementMode } : {}),
      ...(effectiveTargetTime !== undefined
        ? { targetTime: effectiveTargetTime }
        : {}),
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
      accuracyThresholds: legacyThresholds,
      ...(measurement ? { measurement } : {}),
    });
  }

  return (
    <div className="space-y-4">
      <div>
        {/* Training objective comes first — the IA's #1 priority question
            for Train is "what kind of training am I about to do?". One shared
            Info action for the whole control group (DESIGN_SYSTEM.md §13.1). */}
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
              aria-pressed={mode === blockMode}
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
          {trainingModeShortDescription(mode, selectionQuantities(effectiveSelection))}
        </p>
      </div>

      {/* What is measured comes immediately after what is trained, because every
          field below depends on the answer — and disappears when it does not apply. */}
      {canChooseQuantities && (
        <div>
          <header className="flex items-center">
            <span className="text-sm font-medium text-slate-700">Measures</span>
            <InfoButton explanation={measuredQuantitiesExplanation()} />
          </header>

          <div
            role="radiogroup"
            aria-label="Measures"
            className="mt-2 grid grid-cols-3 gap-2"
          >
            {QUANTITY_SELECTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={quantitySelection === option.value}
                onClick={() => setQuantitySelection(option.value)}
                className={`min-h-11 w-full rounded-xl px-2 py-3 text-sm font-medium transition ${
                  quantitySelection === option.value
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {measuresSpeed && (
            <p className="mt-1.5 text-xs text-slate-500">
              Enter speed manually in m/s.
            </p>
          )}
        </div>
      )}

      {/* The timing interval qualifies a TIME measurement, so a speed-only exercise
          has none to choose — it is hidden rather than shown as inert. */}
      {measuresTime && (
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
                aria-pressed={measurementMode === mm}
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
      )}

      <div className="border-t border-slate-200 pt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Target Configuration
        </h3>
      </div>

      {mode === "variable" && (
        <div>
          <label className="text-sm font-medium text-slate-700">
            Target Source
          </label>

          <div className="mt-2 grid grid-cols-2 gap-2">
            {VARIABLE_TARGET_MODES.map((vtm) => {
              const optionDisabled =
                vtm === "smart-random" && !smartRandomAvailable;

              return (
                <button
                  key={vtm}
                  type="button"
                  disabled={optionDisabled}
                  onClick={() => setVariableTargetMode(vtm)}
                  className={`min-h-11 rounded-xl px-3 py-3 text-sm font-medium transition ${
                    optionDisabled
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
              const optionDisabled =
                btm === "smart-random" && !smartRandomAvailable;

              return (
                <button
                  key={btm}
                  type="button"
                  disabled={optionDisabled}
                  onClick={() => setBlindTargetMode(btm)}
                  className={`min-h-11 rounded-xl px-3 py-3 text-sm font-medium transition ${
                    optionDisabled
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

      {measuresTime && !showSmartRandomRange && (
        <div>
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="training-setup-target-time"
          >
            {effectiveTargetMode === "manual"
              ? "Starting Target Time (s)"
              : "Target Time (s)"}
          </label>

          <input
            id="training-setup-target-time"
            type="text"
            inputMode="decimal"
            value={targetTimeInput}
            onChange={(event) => {
              const value = event.target.value;
              if (/^[0-9.,]*$/.test(value)) setTargetTimeInput(value);
            }}
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-400"
          />
        </div>
      )}

      {measuresSpeed && (
        <div>
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="training-setup-target-speed"
          >
            Target Speed (m/s)
          </label>

          <input
            id="training-setup-target-speed"
            type="text"
            inputMode="decimal"
            placeholder="e.g. 2.40"
            value={targetSpeedInput}
            onChange={(event) => {
              const value = event.target.value;
              if (SPEED_INPUT_PATTERN.test(value)) setTargetSpeedInput(value);
            }}
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900 placeholder:text-slate-400"
          />
        </div>
      )}

      {/* One compact summary and one Adjust action, rather than a preset row, a
          template picker and a pair of fields all competing permanently for space. */}
      <div>
        <header className="flex items-center">
          <span className="text-sm font-medium text-slate-700">
            Accuracy Tolerance
          </span>
          <InfoButton explanation={accuracyThresholdsSetupExplanation()} />
        </header>

        <div className="mt-2 flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5">
          <div className="min-w-0 text-xs text-slate-600">
            {measuresTime && (
              <p>
                <span className="font-medium text-slate-700">Time:</span>{" "}
                {timeToleranceLabel}
              </p>
            )}
            {measuresSpeed && (
              <p className={measuresTime ? "mt-1" : undefined}>
                <span className="font-medium text-slate-700">Speed:</span>{" "}
                {speedToleranceLabel}
              </p>
            )}
          </div>

          <button
            type="button"
            aria-expanded={showToleranceEditor}
            onClick={() => setShowToleranceEditor((open) => !open)}
            className="min-h-11 shrink-0 rounded-xl bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
          >
            {showToleranceEditor ? "Done" : "Adjust"}
          </button>
        </div>

        {showToleranceEditor && (
          <div className="mt-3 space-y-4 rounded-xl border border-slate-200 p-3">
            {measuresTime && (
              <section>
                {measuresSpeed && (
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Time (seconds)
                  </h4>
                )}
                <QuantityToleranceEditor
                  idPrefix="time-tolerance"
                  draft={effectiveTimeDraft}
                  onChange={setTimeToleranceDraft}
                  profiles={accuracyToleranceProfiles}
                  allowAsymmetry={asymmetryAvailable}
                />
              </section>
            )}

            {measuresSpeed && (
              <section className={measuresTime ? "border-t border-slate-200 pt-4" : undefined}>
                {measuresTime && (
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Speed (metres per second)
                  </h4>
                )}
                <QuantityToleranceEditor
                  idPrefix="speed-tolerance"
                  draft={effectiveSpeedDraft}
                  onChange={setSpeedToleranceDraft}
                  profiles={accuracyToleranceProfiles}
                  allowAsymmetry={asymmetryAvailable}
                />
              </section>
            )}
          </div>
        )}
      </div>

      {/* Optional detail, deliberately behind a disclosure — naming a block is the
          lowest-priority decision on this screen and should not occupy it. */}
      <details className="border-t border-slate-100 pt-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-600">
          More Settings
        </summary>

        <div className="pt-2">
          <label
            className="text-xs font-medium text-slate-500"
            htmlFor="training-setup-block-name"
          >
            Block Name <span className="font-normal">(optional)</span>
          </label>

          <input
            id="training-setup-block-name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Draw Weight Practice"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
          />
        </div>
      </details>

      <div className="flex gap-2 pt-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300"
          >
            Cancel
          </button>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled}
          className="min-h-11 flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
