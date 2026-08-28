"use client";

import { useState } from "react";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import { blockModeLabel } from "../lib/trainingBlocks";
import { TRAINING_PLANS_SCHEMA_VERSION } from "../lib/trainingPlans/persistence";
import {
  isReleaseTimingPlanStep,
  trainingPlanStepFocusLabel,
  trainingPlanStepTitle,
} from "../lib/trainingPlans/steps";
import { validatePlan } from "../lib/trainingPlans/validation";
import type { TrainingPlan, TrainingPlanStep } from "../types";
import ConfirmModal from "./ConfirmModal";
import { surfaceClass } from "./Surface";
import TrainingPlanStepEditor from "./TrainingPlanStepEditor";

type TrainingPlanEditorProps = {
  initialPlan?: TrainingPlan;
  onSave: (plan: TrainingPlan) => void;
  onCancel: () => void;
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  defaultAccuracyToleranceProfileId?: string | null;
  smartRandomProfiles?: SmartRandomProfile[];
  defaultSmartRandomProfileId?: string | null;
};

function handleStrategyLabel(step: TrainingPlanStep): string {
  if (!isReleaseTimingPlanStep(step)) return "Complete manually";
  switch (step.handleStrategy.type) {
    case "free":
      return "Free";
    case "fixed":
      return `Fixed — ${step.handleStrategy.handle === "in" ? "In" : "Out"} Handle`;
    case "alternating":
      return `Alternating, starting ${
        step.handleStrategy.startingHandle === "in" ? "In" : "Out"
      }`;
  }
}

function cloneStepForDuplication(step: TrainingPlanStep): TrainingPlanStep {
  return {
    ...(JSON.parse(JSON.stringify(step)) as TrainingPlanStep),
    id: crypto.randomUUID(),
  };
}

export default function TrainingPlanEditor({
  initialPlan,
  onSave,
  onCancel,
  accuracyToleranceProfiles = [],
  defaultAccuracyToleranceProfileId = null,
  smartRandomProfiles = [],
  defaultSmartRandomProfileId = null,
}: TrainingPlanEditorProps) {
  const [name, setName] = useState(initialPlan?.name ?? "");
  const [description, setDescription] = useState(initialPlan?.description ?? "");
  const [steps, setSteps] = useState<TrainingPlanStep[]>(initialPlan?.steps ?? []);
  const [editingStepId, setEditingStepId] = useState<string | "new" | null>(null);
  const [deletingStepId, setDeletingStepId] = useState<string | null>(null);

  function handleSaveStep(step: TrainingPlanStep) {
    setSteps((current) => {
      const existingIndex = current.findIndex((existing) => existing.id === step.id);
      if (existingIndex === -1) return [...current, step];
      return current.map((existing, index) =>
        index === existingIndex ? step : existing
      );
    });
    setEditingStepId(null);
  }

  function moveStep(index: number, direction: -1 | 1) {
    setSteps((current) => {
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  }

  function duplicateStep(index: number) {
    setSteps((current) => {
      const copy = cloneStepForDuplication(current[index]);
      const next = [...current];
      next.splice(index + 1, 0, copy);
      return next;
    });
  }

  function handleSubmitPlan() {
    const now = new Date().toISOString();

    const plan: TrainingPlan = {
      id: initialPlan?.id ?? crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      steps,
      createdAt: initialPlan?.createdAt ?? now,
      updatedAt: now,
      schemaVersion: TRAINING_PLANS_SCHEMA_VERSION,
    };

    const validation = validatePlan(plan);
    if (!validation.ok) {
      alert(validation.error.message);
      return;
    }

    onSave(plan);
  }

  const editingStep =
    editingStepId && editingStepId !== "new"
      ? steps.find((step) => step.id === editingStepId)
      : undefined;

  return (
    <div className={surfaceClass("primary")}>
      <h2 className="text-xl font-semibold text-slate-900">
        {initialPlan ? "Edit Training Plan" : "New Training Plan"}
      </h2>

      <div className="mt-4">
        <label className="text-sm font-medium text-slate-700">Plan Name</label>

        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Release Consistency"
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400"
        />
      </div>

      <div className="mt-3">
        <label className="text-xs font-medium text-slate-500">
          Description <span className="font-normal">(optional)</span>
        </label>

        <input
          type="text"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900"
        />
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-medium text-slate-700">Steps</h3>

        {steps.length === 0 ? (
          <p className={`${surfaceClass("utility")} mt-3 text-sm text-slate-600`}>
            Add the first step to start building this plan.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {steps.map((step, index) => (
              <li key={step.id} className={surfaceClass("secondary")}>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Step {index + 1}
                </p>

                <p className="mt-1 font-medium text-slate-900">
                  {trainingPlanStepTitle(step)}
                  {isReleaseTimingPlanStep(step) && step.configuration.name
                    ? ` — ${step.configuration.name}`
                    : ""}
                </p>

                <p className="mt-1 text-sm text-slate-600">
                  {trainingPlanStepFocusLabel(step)} · {isReleaseTimingPlanStep(step)
                    ? `${blockModeLabel(step.configuration.mode)} · ${step.completion.value} stones · ${handleStrategyLabel(step)}`
                    : handleStrategyLabel(step)}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => moveStep(index, -1)}
                    disabled={index === 0}
                    className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Move Up
                  </button>

                  <button
                    type="button"
                    onClick={() => moveStep(index, 1)}
                    disabled={index === steps.length - 1}
                    className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Move Down
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingStepId(step.id)}
                    className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    Edit
                  </button>

                  <button
                    type="button"
                    onClick={() => duplicateStep(index)}
                    className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    Duplicate
                  </button>

                  <button
                    type="button"
                    onClick={() => setDeletingStepId(step.id)}
                    className="min-h-11 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition hover:bg-red-100"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}

        <button
          type="button"
          onClick={() => setEditingStepId("new")}
          className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-200"
        >
          Add Step
        </button>
      </div>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={handleSubmitPlan}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          Save Training Plan
        </button>
      </div>

      {editingStepId && (
        <TrainingPlanStepEditor
          initialStep={editingStep}
          onSave={handleSaveStep}
          onCancel={() => setEditingStepId(null)}
          accuracyToleranceProfiles={accuracyToleranceProfiles}
          defaultAccuracyToleranceProfileId={defaultAccuracyToleranceProfileId}
          smartRandomProfiles={smartRandomProfiles}
          defaultSmartRandomProfileId={defaultSmartRandomProfileId}
        />
      )}

      {deletingStepId && (
        <ConfirmModal
          title="Delete Step?"
          message="This step will be removed from the plan. This doesn't affect any session already started from this plan."
          confirmLabel="Delete Step"
          isDanger
          onCancel={() => setDeletingStepId(null)}
          onConfirm={() => {
            setSteps((current) =>
              current.filter((step) => step.id !== deletingStepId)
            );
            setDeletingStepId(null);
          }}
        />
      )}
    </div>
  );
}
