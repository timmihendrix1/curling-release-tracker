"use client";

import { useState } from "react";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import type { Handle, HandleStrategy, ReleaseTimingPlanStep } from "../types";
import TrainingSetup, { type TrainingSetupValue } from "./TrainingSetup";

type TrainingPlanStepEditorProps = {
  initialStep?: ReleaseTimingPlanStep;
  onSave: (step: ReleaseTimingPlanStep) => void;
  onCancel: () => void;
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  defaultAccuracyToleranceProfileId?: string | null;
  smartRandomProfiles?: SmartRandomProfile[];
  defaultSmartRandomProfileId?: string | null;
};

type HandleStrategyType = HandleStrategy["type"];

const HANDLE_STRATEGY_OPTIONS: { type: HandleStrategyType; label: string }[] = [
  { type: "free", label: "Free" },
  { type: "fixed", label: "Fixed" },
  { type: "alternating", label: "Alternating" },
];

function initialHandleStrategyType(strategy?: HandleStrategy): HandleStrategyType {
  return strategy?.type ?? "free";
}

function initialFixedHandle(strategy?: HandleStrategy): Handle {
  return strategy?.type === "fixed" ? strategy.handle : "in";
}

function initialStartingHandle(strategy?: HandleStrategy): Handle {
  return strategy?.type === "alternating" ? strategy.startingHandle : "in";
}

/**
 * Configures one Release Timing Plan Step — reuses TrainingSetup.tsx entirely
 * unmodified for the block-scoped fields (mode, measurement mode, target
 * configuration), adding only the two fields Training Plans introduce: Number of
 * Stones and Handle Strategy. TrainingSetup's own onSubmit output
 * (TrainingSetupValue) is converted into the domain-owned
 * ReleaseTimingBlockConfiguration here — the persisted step type is never
 * type-derived from the component's form-value export (see ADR-0012).
 */
export default function TrainingPlanStepEditor({
  initialStep,
  onSave,
  onCancel,
  accuracyToleranceProfiles = [],
  defaultAccuracyToleranceProfileId = null,
  smartRandomProfiles = [],
  defaultSmartRandomProfileId = null,
}: TrainingPlanStepEditorProps) {
  const [stonesInput, setStonesInput] = useState(
    String(initialStep?.completion.value ?? 8)
  );
  const [handleStrategyType, setHandleStrategyType] = useState<HandleStrategyType>(
    initialHandleStrategyType(initialStep?.handleStrategy)
  );
  const [fixedHandle, setFixedHandle] = useState<Handle>(
    initialFixedHandle(initialStep?.handleStrategy)
  );
  const [startingHandle, setStartingHandle] = useState<Handle>(
    initialStartingHandle(initialStep?.handleStrategy)
  );

  function buildHandleStrategy(): HandleStrategy {
    switch (handleStrategyType) {
      case "free":
        return { type: "free" };
      case "fixed":
        return { type: "fixed", handle: fixedHandle };
      case "alternating":
        return { type: "alternating", startingHandle };
    }
  }

  function handleSubmit(value: TrainingSetupValue) {
    const stones = Number.parseInt(stonesInput, 10);

    if (!Number.isInteger(stones) || stones <= 0) {
      alert("Enter a whole number of stones greater than 0.");
      return;
    }

    onSave({
      id: initialStep?.id ?? crypto.randomUUID(),
      type: "release-timing",
      completion: { type: "shot-count", value: stones },
      handleStrategy: buildHandleStrategy(),
      configuration: {
        name: value.name,
        mode: value.mode,
        measurementMode: value.measurementMode,
        targetTime: value.targetTime,
        variableTargetMode: value.variableTargetMode,
        blindTargetMode: value.blindTargetMode,
        smartRandomMin: value.smartRandomMin,
        smartRandomMax: value.smartRandomMax,
        accuracyThresholds: value.accuracyThresholds,
      },
    });
  }

  const initialSetupValue: Partial<TrainingSetupValue> | undefined = initialStep
    ? {
        name: initialStep.configuration.name,
        mode: initialStep.configuration.mode,
        measurementMode: initialStep.configuration.measurementMode,
        targetTime: initialStep.configuration.targetTime,
        variableTargetMode: initialStep.configuration.variableTargetMode,
        blindTargetMode: initialStep.configuration.blindTargetMode,
        smartRandomMin: initialStep.configuration.smartRandomMin,
        smartRandomMax: initialStep.configuration.smartRandomMax,
        accuracyThresholds: initialStep.configuration.accuracyThresholds,
      }
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">
          {initialStep ? "Edit Step" : "Add Step"}
        </h2>

        <div className="mt-4">
          <label className="text-sm font-medium text-slate-700">
            Number of Stones
          </label>

          <input
            type="text"
            inputMode="numeric"
            aria-label="Number of Stones"
            value={stonesInput}
            onChange={(event) => {
              const value = event.target.value;
              if (/^[0-9]*$/.test(value)) setStonesInput(value);
            }}
            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg text-slate-900"
          />
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium text-slate-700">
            Handle Strategy
          </label>

          <div className="mt-2 grid grid-cols-3 gap-2">
            {HANDLE_STRATEGY_OPTIONS.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => setHandleStrategyType(option.type)}
                className={`min-h-11 rounded-xl px-2 py-3 text-sm font-medium transition ${
                  handleStrategyType === option.type
                    ? "bg-slate-900 text-white"
                    : "bg-slate-200 text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {handleStrategyType === "free" && (
            <p className="mt-2 text-xs text-slate-500">
              The athlete chooses the handle for every shot.
            </p>
          )}

          {handleStrategyType === "fixed" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["in", "out"] as Handle[]).map((handleOption) => (
                <button
                  key={handleOption}
                  type="button"
                  onClick={() => setFixedHandle(handleOption)}
                  className={`min-h-11 rounded-xl px-3 py-3 text-sm font-medium capitalize transition ${
                    fixedHandle === handleOption
                      ? "bg-slate-900 text-white"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {handleOption} Handle
                </button>
              ))}
            </div>
          )}

          {handleStrategyType === "alternating" && (
            <>
              <p className="mt-2 text-xs text-slate-500">Starting handle</p>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(["in", "out"] as Handle[]).map((handleOption) => (
                  <button
                    key={handleOption}
                    type="button"
                    onClick={() => setStartingHandle(handleOption)}
                    className={`min-h-11 rounded-xl px-3 py-3 text-sm font-medium capitalize transition ${
                      startingHandle === handleOption
                        ? "bg-slate-900 text-white"
                        : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {handleOption} Handle
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 border-t border-slate-200 pt-4">
          <TrainingSetup
            initialValue={initialSetupValue}
            submitLabel={initialStep ? "Save Step" : "Add Step"}
            onSubmit={handleSubmit}
            onCancel={onCancel}
            accuracyToleranceProfiles={accuracyToleranceProfiles}
            defaultAccuracyToleranceProfileId={defaultAccuracyToleranceProfileId}
            smartRandomProfiles={smartRandomProfiles}
            defaultSmartRandomProfileId={defaultSmartRandomProfileId}
          />
        </div>
      </div>
    </div>
  );
}
