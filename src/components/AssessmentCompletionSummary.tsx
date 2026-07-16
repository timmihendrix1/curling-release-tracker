import { computeCategoryMetrics, computeRawAssessmentMetrics } from "../lib/assessment/metrics";
import { countInvalidAttempts, countProtocolDeviations } from "../lib/assessment/progress";
import type { AssessmentRun } from "../lib/assessment/types";
import { formatSigned } from "../lib/timeInput";

type AssessmentCompletionSummaryProps = {
  run: AssessmentRun;
  onDone: () => void;
  onViewProtocol: () => void;
  onStartNew: () => void;
  onViewFullResults: () => void;
};

function formatPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * Simple completion summary — deliberately no charts, trends, handle/target
 * breakdowns, ranking, or overall score; those live in the full
 * AssessmentResultScreen (Phase C), reached via `onViewFullResults`. See
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 21 and
 * docs/TECHNICAL_DEBT_AND_ROADMAP.md's Phase B/C split.
 */
export default function AssessmentCompletionSummary({
  run,
  onDone,
  onViewProtocol,
  onStartNew,
  onViewFullResults,
}: AssessmentCompletionSummaryProps) {
  const raw = computeRawAssessmentMetrics(run);
  const category = computeCategoryMetrics(run, run.thresholdSnapshot.values);
  const thresholdLabel =
    run.thresholdSnapshot.type === "custom"
      ? "Custom"
      : run.thresholdSnapshot.type === "tight"
        ? "Tight"
        : "Standard";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="text-xl font-semibold text-slate-900">Assessment complete</h1>
        <p className="mt-1 text-sm text-slate-600">
          {run.completedAt ? new Date(run.completedAt).toLocaleDateString() : ""} · Release Time
          Core Assessment v{run.templateVersion}
        </p>

        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          <li>{raw.count} of 32 scored stones</li>
          <li>{countInvalidAttempts(run)} invalid attempts</li>
          <li>{countProtocolDeviations(run)} protocol deviations</li>
          <li>
            Threshold used: {thresholdLabel} (±{run.thresholdSnapshot.values.onTarget.toFixed(2)}s
            / ±{run.thresholdSnapshot.values.acceptable.toFixed(2)}s)
          </li>
        </ul>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-sm font-semibold text-slate-900">Raw summary</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-slate-500">MAE</p>
            <p className="text-lg font-semibold text-slate-900">
              {raw.meanAbsoluteError !== null ? `${raw.meanAbsoluteError.toFixed(3)}s` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Bias</p>
            <p className="text-lg font-semibold text-slate-900">
              {raw.bias !== null ? `${formatSigned(raw.bias)}s` : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Std. Dev.</p>
            <p className="text-lg font-semibold text-slate-900">
              {raw.standardDeviation !== null ? `${raw.standardDeviation.toFixed(3)}s` : "—"}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-sm font-semibold text-slate-900">
          Category summary <span className="text-slate-400">(under {thresholdLabel})</span>
        </h2>
        <div className="mt-3 grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-xs text-slate-500">On Target</p>
            <p className="text-lg font-semibold text-slate-900">
              {formatPercent(category.onTargetRate)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Acceptable</p>
            <p className="text-lg font-semibold text-slate-900">
              {formatPercent(category.acceptableRate)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Major Miss</p>
            <p className="text-lg font-semibold text-slate-900">
              {formatPercent(category.majorMissRate)}
            </p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onViewFullResults}
        className="w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        View Full Results
      </button>

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onDone}
          className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          Done
        </button>
        <button
          type="button"
          onClick={onViewProtocol}
          className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          View Protocol
        </button>
        <button
          type="button"
          onClick={onStartNew}
          className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          Start New Assessment
        </button>
      </div>
    </div>
  );
}
