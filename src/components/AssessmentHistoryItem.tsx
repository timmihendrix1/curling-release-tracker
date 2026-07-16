import { computeCategoryMetrics, computeRawAssessmentMetrics } from "../lib/assessment/metrics";
import { countInvalidAttempts, countProtocolDeviations } from "../lib/assessment/progress";
import type { AssessmentRun } from "../lib/assessment/types";
import { formatAssessmentPercent, formatAssessmentSeconds } from "../lib/assessment/resultFormatting";

type AssessmentHistoryItemProps = {
  run: AssessmentRun;
  onView: () => void;
  onDelete: () => void;
};

/** One row in the completed or incomplete Assessment History list — see Phase C brief section 2. */
export default function AssessmentHistoryItem({ run, onView, onDelete }: AssessmentHistoryItemProps) {
  const isCompleted = run.status === "completed";
  const raw = computeRawAssessmentMetrics(run);
  const category = computeCategoryMetrics(run, run.thresholdSnapshot.values);
  const date = run.completedAt ?? run.pausedAt ?? run.createdAt;

  return (
    <div className="rounded-xl bg-slate-100 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900">
            {run.templateSnapshot.name} <span className="text-slate-500">v{run.templateVersion}</span>
          </p>
          <p className="text-xs text-slate-500">{new Date(date).toLocaleDateString()}</p>
          {!isCompleted && (
            <span className="mt-1 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              Incomplete
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete this Assessment Run"
          className="rounded-lg bg-red-100 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-200"
        >
          Delete
        </button>
      </div>

      {isCompleted ? (
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div>
            <p className="text-slate-500">MAE</p>
            <p className="font-semibold text-slate-900">{formatAssessmentSeconds(raw.meanAbsoluteError)}</p>
          </div>
          <div>
            <p className="text-slate-500">On Target</p>
            <p className="font-semibold text-slate-900">{formatAssessmentPercent(category.onTargetRate)}</p>
          </div>
          <div>
            <p className="text-slate-500">Scored</p>
            <p className="font-semibold text-slate-900">{raw.count}</p>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-600">
          {raw.count} scored stones recorded · {countInvalidAttempts(run)} invalid attempts ·{" "}
          {countProtocolDeviations(run)} protocol deviations
        </p>
      )}

      <button
        type="button"
        onClick={onView}
        className="mt-3 w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-slate-700"
      >
        {isCompleted ? "View Results" : "View Details"}
      </button>
    </div>
  );
}
