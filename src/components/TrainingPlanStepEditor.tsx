"use client";

import { useState } from "react";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { EXERCISE_CATALOG } from "../lib/exercises/catalog";
import { RELEASE_TIME_EXERCISE_ID } from "../lib/exercises/content";
import { listCurrentExerciseVersions, resolveCurrentExerciseVersion } from "../lib/exercises/lookup";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import type { Handle, HandleStrategy, TrainingPlanStep } from "../types";
import { isReleaseTimingPlanStep } from "../lib/trainingPlans/steps";
import TrainingSetup, { type TrainingSetupValue } from "./TrainingSetup";

type TrainingPlanStepEditorProps = {
  initialStep?: TrainingPlanStep;
  onSave: (step: TrainingPlanStep) => void;
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
 * Configures one member of the mixed TrainingPlanStep union. Curated Technique and
 * Shotmaking steps select an exact immutable Exercise Version without planned volume.
 * Release Time reuses TrainingSetup.tsx unmodified for its block-scoped fields and
 * adds Number of Stones plus Handle Strategy. The persisted step union is never
 * type-derived from a component form-value export (ADR-0012/ADR-0040).
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
  const initialReleaseStep = initialStep && isReleaseTimingPlanStep(initialStep)
    ? initialStep
    : undefined;
  const [stepKind, setStepKind] = useState<TrainingPlanStep["type"] | null>(
    initialStep?.type ?? null
  );
  const currentExerciseVersions = listCurrentExerciseVersions(EXERCISE_CATALOG);
  const currentCuratedExerciseVersions = currentExerciseVersions.filter(
    (version) => version.primaryFocus !== "measured" &&
      version.participation.supportedModes.includes("solo")
  );
  const initialCuratedVersion = initialStep?.type === "curated-exercise"
    ? initialStep.exerciseVersionSnapshot
    : undefined;
  // Keep an older, still-catalogued immutable snapshot selectable while editing an
  // existing plan. Publishing a newer current Version must not make the saved step
  // impossible to inspect or save unchanged.
  const curatedExerciseVersions = initialCuratedVersion &&
    !currentCuratedExerciseVersions.some(
      (version) => version.id === initialCuratedVersion.id
    )
    ? [initialCuratedVersion, ...currentCuratedExerciseVersions]
    : currentCuratedExerciseVersions;
  const [selectedExerciseVersionId, setSelectedExerciseVersionId] = useState(
    initialStep?.type === "curated-exercise"
      ? initialStep.exerciseVersionSnapshot.id
      : curatedExerciseVersions[0]?.id ?? ""
  );
  const [stonesInput, setStonesInput] = useState(
    String(initialReleaseStep?.completion.value ?? 8)
  );
  const [handleStrategyType, setHandleStrategyType] = useState<HandleStrategyType>(
    initialHandleStrategyType(initialReleaseStep?.handleStrategy)
  );
  const [fixedHandle, setFixedHandle] = useState<Handle>(
    initialFixedHandle(initialReleaseStep?.handleStrategy)
  );
  const [startingHandle, setStartingHandle] = useState<Handle>(
    initialStartingHandle(initialReleaseStep?.handleStrategy)
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

    const releaseTimeVersion = resolveCurrentExerciseVersion(
      EXERCISE_CATALOG,
      RELEASE_TIME_EXERCISE_ID
    );
    if (!releaseTimeVersion) {
      alert("The Release Time Exercise is unavailable.");
      return;
    }

    onSave({
      id: initialStep?.id ?? crypto.randomUUID(),
      type: "release-timing",
      exerciseVersionSnapshot: JSON.parse(JSON.stringify(releaseTimeVersion)),
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

  function saveCuratedExerciseStep() {
    const version = curatedExerciseVersions.find(
      (candidate) => candidate.id === selectedExerciseVersionId
    );
    if (!version) return;
    onSave({
      id: initialStep?.id ?? crypto.randomUUID(),
      type: "curated-exercise",
      exerciseVersionSnapshot: JSON.parse(JSON.stringify(version)),
      completion: { type: "exercise-completion" },
    });
  }

  const initialSetupValue: Partial<TrainingSetupValue> | undefined = initialReleaseStep
    ? {
        name: initialReleaseStep.configuration.name,
        mode: initialReleaseStep.configuration.mode,
        measurementMode: initialReleaseStep.configuration.measurementMode,
        targetTime: initialReleaseStep.configuration.targetTime,
        variableTargetMode: initialReleaseStep.configuration.variableTargetMode,
        blindTargetMode: initialReleaseStep.configuration.blindTargetMode,
        smartRandomMin: initialReleaseStep.configuration.smartRandomMin,
        smartRandomMax: initialReleaseStep.configuration.smartRandomMax,
        accuracyThresholds: initialReleaseStep.configuration.accuracyThresholds,
      }
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">
          {initialStep ? "Edit Step" : "Add Step"}
        </h2>

        {stepKind === null && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-slate-600">Choose what this step trains.</p>
            <button
              type="button"
              onClick={() => setStepKind("curated-exercise")}
              className="min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-left font-medium text-slate-800 hover:bg-slate-200"
            >
              Technique or Shotmaking Exercise
            </button>
            <button
              type="button"
              onClick={() => setStepKind("release-timing")}
              className="min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-left font-medium text-slate-800 hover:bg-slate-200"
            >
              Release Time Measurement
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="min-h-11 w-full rounded-xl px-4 py-3 text-sm font-medium text-slate-600 underline"
            >
              Cancel
            </button>
          </div>
        )}

        {stepKind === "curated-exercise" && (
          <div className="mt-4">
            <label className="text-sm font-medium text-slate-700">
              Exercise
              <select
                aria-label="Exercise"
                value={selectedExerciseVersionId}
                onChange={(event) => setSelectedExerciseVersionId(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {curatedExerciseVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.title} — {version.primaryFocus === "technique"
                      ? "Technique"
                      : "Shotmaking"} · Exercise version {version.version}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-xs text-slate-500">
              The selected immutable Exercise Version is saved with the plan. Technique
              and Shotmaking steps finish when you choose Complete Exercise; no planned
              volume is imposed.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveCuratedExerciseStep}
                disabled={!selectedExerciseVersionId}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white disabled:bg-slate-300"
              >
                {initialStep ? "Save Step" : "Add Step"}
              </button>
            </div>
          </div>
        )}

        {stepKind === "release-timing" && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
