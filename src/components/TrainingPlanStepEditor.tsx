"use client";

import { useState } from "react";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { EXERCISE_CATALOG } from "../lib/exercises/catalog";
import type { ExerciseAssetResolver } from "../lib/exercises/exerciseAssets";
import {
  exerciseRunnerKind,
  listCurrentExerciseVersions,
} from "../lib/exercises/lookup";
import { exerciseFocusGroupLabel } from "../lib/exercises/presentation";
import type { ExerciseVersion } from "../lib/exercises/types";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import type { Handle, HandleStrategy, TrainingPlanStep } from "../types";
import { isReleaseTimingPlanStep } from "../lib/trainingPlans/steps";
import ExerciseSetupOverview from "./ExerciseSetupOverview";
import TrainingPlanExercisePicker from "./TrainingPlanExercisePicker";
import TrainingSetup, { type TrainingSetupValue } from "./TrainingSetup";

type TrainingPlanStepEditorProps = {
  initialStep?: TrainingPlanStep;
  onSave: (step: TrainingPlanStep) => void;
  onCancel: () => void;
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  defaultAccuracyToleranceProfileId?: string | null;
  smartRandomProfiles?: SmartRandomProfile[];
  defaultSmartRandomProfileId?: string | null;
  exerciseAssetResolver?: ExerciseAssetResolver;
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
 * Configures one member of the mixed TrainingPlanStep union. Curated Exercises on
 * the generic runner select an exact immutable Exercise Version without planned volume.
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
  exerciseAssetResolver,
}: TrainingPlanStepEditorProps) {
  const initialReleaseStep = initialStep && isReleaseTimingPlanStep(initialStep)
    ? initialStep
    : undefined;
  const currentExerciseVersions = listCurrentExerciseVersions(EXERCISE_CATALOG);
  const currentSelectableExerciseVersions = currentExerciseVersions.filter(
    (version) => exerciseRunnerKind(EXERCISE_CATALOG, version) !== "unsupported" &&
      version.participation.supportedModes.includes("solo")
  );
  const initialVersion = initialStep?.exerciseVersionSnapshot;
  // Keep an older, still-catalogued immutable snapshot selectable while editing an
  // existing plan. Publishing a newer current Version must not make the saved step
  // impossible to inspect or save unchanged.
  const selectableExerciseVersions = initialVersion &&
    !currentSelectableExerciseVersions.some(
      (version) => version.id === initialVersion.id
    )
    ? [initialVersion, ...currentSelectableExerciseVersions]
    : currentSelectableExerciseVersions;
  const [selectedExerciseVersionId, setSelectedExerciseVersionId] = useState(
    initialVersion?.id ?? ""
  );
  const [showPicker, setShowPicker] = useState(initialStep === undefined);
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

  const selectedVersion: ExerciseVersion | undefined = selectableExerciseVersions.find(
    (version) => version.id === selectedExerciseVersionId
  );
  const selectedRunner = selectedVersion
    ? exerciseRunnerKind(EXERCISE_CATALOG, selectedVersion)
    : "unsupported";

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

    if (!selectedVersion || selectedRunner !== "release-timing") {
      alert("The Release Time Exercise is unavailable.");
      return;
    }

    onSave({
      id: initialStep?.id ?? crypto.randomUUID(),
      type: "release-timing",
      exerciseVersionSnapshot: JSON.parse(JSON.stringify(selectedVersion)),
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
    if (!selectedVersion || selectedRunner !== "exercise-execution") return;
    onSave({
      id: initialStep?.id ?? crypto.randomUUID(),
      type: "curated-exercise",
      exerciseVersionSnapshot: JSON.parse(JSON.stringify(selectedVersion)),
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

        {showPicker && (
          <TrainingPlanExercisePicker
            versions={currentSelectableExerciseVersions}
            initialFocus={initialVersion?.primaryFocus}
            exerciseAssetResolver={exerciseAssetResolver}
            onChoose={(version) => {
              setSelectedExerciseVersionId(version.id);
              setShowPicker(false);
            }}
            onCancel={onCancel}
          />
        )}

        {!showPicker && selectedVersion && (
          <section className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {exerciseFocusGroupLabel(selectedVersion.primaryFocus)}
            </p>
            <h3 className="mt-1 font-semibold text-slate-900">{selectedVersion.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{selectedVersion.goal}</p>
            <details className="mt-3 border-t border-slate-200 pt-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-700">
                View setup and diagram
              </summary>
              <div className="pb-2 pt-3">
                <ExerciseSetupOverview
                  version={selectedVersion}
                  exerciseAssetResolver={exerciseAssetResolver}
                />
              </div>
            </details>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className="mt-2 min-h-11 w-full rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700"
            >
              Change Exercise
            </button>
          </section>
        )}

        {!showPicker && selectedRunner === "exercise-execution" && (
          <div className="mt-4">
            <p className="text-xs text-slate-500">
              This step finishes when you choose Complete Exercise; no planned volume is imposed.
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
                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white"
              >
                {initialStep ? "Save Step" : "Add Step"}
              </button>
            </div>
          </div>
        )}

        {!showPicker && selectedRunner === "release-timing" && (
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
