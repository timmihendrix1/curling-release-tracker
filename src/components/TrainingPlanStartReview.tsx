"use client";

import { blockModeLabel } from "../lib/trainingBlocks";
import type { TrainingPlan, TrainingPlanStep } from "../types";
import { surfaceClass } from "./Surface";

type TrainingPlanStartReviewProps = {
  plan: TrainingPlan;
  onStart: () => void;
  onCancel: () => void;
};

function handleStrategySummary(step: TrainingPlanStep): string {
  switch (step.handleStrategy.type) {
    case "free":
      return "Free";
    case "fixed":
      return step.handleStrategy.handle === "in" ? "In Handle" : "Out Handle";
    case "alternating":
      return `Alternating (${
        step.handleStrategy.startingHandle === "in" ? "In" : "Out"
      } first)`;
  }
}

/** Pre-start summary — the plan should not need to be reconfigured to start it. */
export default function TrainingPlanStartReview({
  plan,
  onStart,
  onCancel,
}: TrainingPlanStartReviewProps) {
  const totalStones = plan.steps.reduce((sum, step) => sum + step.completion.value, 0);

  return (
    <div className={surfaceClass("hero")}>
      <h2 className="text-xl font-semibold text-slate-900">{plan.name}</h2>

      {plan.description && (
        <p className="mt-1 text-sm text-slate-600">{plan.description}</p>
      )}

      <ol className="mt-4 space-y-2">
        {plan.steps.map((step, index) => (
          <li key={step.id} className={surfaceClass("inset")}>
            <p className="text-sm font-medium text-slate-900">
              {index + 1}. {blockModeLabel(step.configuration.mode)}
            </p>

            <p className="mt-1 text-xs text-slate-600">
              {step.completion.value} stones · {handleStrategySummary(step)}
            </p>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-sm text-slate-600">Total: {totalStones} stones</p>

      <div className="mt-5 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-300"
        >
          Back
        </button>

        <button
          type="button"
          onClick={onStart}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          Start Training
        </button>
      </div>
    </div>
  );
}
