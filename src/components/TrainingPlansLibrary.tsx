"use client";

import { useState } from "react";
import { isPlanExecutable } from "../lib/trainingPlans/validation";
import {
  isReleaseTimingPlanStep,
  trainingPlanStepFocusLabel,
} from "../lib/trainingPlans/steps";
import type { TrainingPlan } from "../types";
import ConfirmModal from "./ConfirmModal";
import { surfaceClass } from "./Surface";

type TrainingPlansLibraryProps = {
  plans: TrainingPlan[];
  onCreateNew: () => void;
  onEdit: (plan: TrainingPlan) => void;
  onDuplicate: (plan: TrainingPlan) => void;
  onDelete: (planId: string) => void;
  onStart: (plan: TrainingPlan) => void;
};

function planSummary(plan: TrainingPlan): string {
  const timingStones = plan.steps.reduce(
    (sum, step) => sum + (isReleaseTimingPlanStep(step) ? step.completion.value : 0),
    0
  );
  return `${plan.steps.length} step${plan.steps.length === 1 ? "" : "s"}${
    timingStones > 0
      ? ` · ${timingStones} planned timing stone${timingStones === 1 ? "" : "s"}`
      : ""
  }`;
}

/** Unique Exercise focuses used, in step order. */
function focusComposition(plan: TrainingPlan): string {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const step of plan.steps) {
    const label = trainingPlanStepFocusLabel(step);
    if (!seen.has(label)) {
      seen.add(label);
      ordered.push(label);
    }
  }

  return ordered.join(" · ");
}

export default function TrainingPlansLibrary({
  plans,
  onCreateNew,
  onEdit,
  onDuplicate,
  onDelete,
  onStart,
}: TrainingPlansLibraryProps) {
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

  if (plans.length === 0) {
    return (
      <div className={surfaceClass("secondary")}>
        <h2 className="text-lg font-semibold text-slate-900">
          No training plans yet
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Save an ordered mix of Technique, Shotmaking and Release Time steps so
          you can start the same training structure again.
        </p>

        <button
          type="button"
          onClick={onCreateNew}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          Create Training Plan
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {plans.map((plan) => {
        const executable = isPlanExecutable(plan);

        return (
          <div key={plan.id} className={surfaceClass("secondary")}>
            <h3 className="font-semibold text-slate-900">{plan.name}</h3>

            {plan.description && (
              <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
            )}

            <p className="mt-1 text-sm text-slate-600">{planSummary(plan)}</p>
            <p className="mt-1 text-xs text-slate-500">{focusComposition(plan)}</p>

            {!executable && (
              <p className="mt-2 text-xs text-amber-700">
                This plan has a step that isn&apos;t valid yet — edit it before
                starting.
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onStart(plan)}
                disabled={!executable}
                className="min-h-11 flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Start
              </button>

              <button
                type="button"
                onClick={() => onEdit(plan)}
                className="min-h-11 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
              >
                Edit
              </button>

              <button
                type="button"
                onClick={() => onDuplicate(plan)}
                className="min-h-11 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
              >
                Duplicate
              </button>

              <button
                type="button"
                onClick={() => setDeletingPlanId(plan.id)}
                className="min-h-11 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onCreateNew}
        className="w-full rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-200"
      >
        New Training Plan
      </button>

      {deletingPlanId && (
        <ConfirmModal
          title="Delete Training Plan?"
          message="This removes the saved plan. Sessions already started from it, and your training history, are not affected."
          confirmLabel="Delete Plan"
          isDanger
          onCancel={() => setDeletingPlanId(null)}
          onConfirm={() => {
            onDelete(deletingPlanId);
            setDeletingPlanId(null);
          }}
        />
      )}
    </div>
  );
}
