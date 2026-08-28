"use client";

import type { PlanProgressSummary } from "../lib/trainingPlans/progress";
import { surfaceClass } from "./Surface";

type TrainingPlanProgressProps = {
  sourcePlanName: string;
  summary: PlanProgressSummary;
};

/**
 * Compact plan-progress readout during execution — visually secondary to the
 * active shot capture above/below it (spec section 28: "visually secondary to
 * active shot capture... must not become crowded with planning metadata").
 */
export default function TrainingPlanProgress({
  sourcePlanName,
  summary,
}: TrainingPlanProgressProps) {
  return (
    <div className={surfaceClass("utility")}>
      <p className="text-xs font-medium text-slate-500">
        {sourcePlanName} · Step {summary.currentStepNumber} of {summary.totalSteps}
      </p>

      <p className="mt-1 text-sm font-medium text-slate-700">
        {summary.currentStepTitle}
      </p>

      <p className="mt-1 text-sm text-slate-600">
        {summary.currentProgressLabel}
      </p>
    </div>
  );
}
