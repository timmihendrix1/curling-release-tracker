import type { TargetResult } from "../lib/assessment/result";
import {
  formatAssessmentPercent,
  formatAssessmentSeconds,
  formatAssessmentSignedSeconds,
} from "../lib/assessment/resultFormatting";
import { ASSESSMENT_TARGET_AGGREGATION_EXPLANATION } from "../lib/assessmentResultContent";

type AssessmentTargetResultsProps = {
  targets: TargetResult[];
};

/** Fast/Medium/Slow Delivery breakdown, combining every block including Variable Adaptation. See Phase C brief section 7. */
export default function AssessmentTargetResults({ targets }: AssessmentTargetResultsProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Target Results</h2>
      <p className="mt-1 text-xs text-slate-500">{ASSESSMENT_TARGET_AGGREGATION_EXPLANATION}</p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {targets.map((target) => (
          <div key={target.targetTime} className="rounded-xl bg-slate-100 p-4">
            <p className="font-semibold text-slate-900">{target.deliveryLabel}</p>
            <p className="text-xs text-slate-500">{target.targetTime.toFixed(2)}s · {target.metrics.count} attempts</p>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-slate-500">MAE</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSeconds(target.metrics.meanAbsoluteError)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Bias</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSignedSeconds(target.metrics.bias)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">SD</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSeconds(target.metrics.standardDeviation)}
                </p>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-slate-500">On Target</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(target.metrics.onTargetRate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Acceptable</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(target.metrics.acceptableRate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Major Miss</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(target.metrics.majorMissRate)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
