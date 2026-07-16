import type { VariableAdaptationResult } from "../lib/assessment/result";
import {
  formatAssessmentPercent,
  formatAssessmentSeconds,
  formatAssessmentSignedSeconds,
} from "../lib/assessment/resultFormatting";
import { ASSESSMENT_VARIABLE_ADAPTATION_RESTRAINT_NOTE } from "../lib/assessmentResultContent";

type AssessmentVariableAdaptationResultsProps = {
  result: VariableAdaptationResult;
};

/** Dedicated Variable Adaptation section — deliberately restrained copy given only 8 scored shots. See Phase C brief section 9. */
export default function AssessmentVariableAdaptationResults({
  result,
}: AssessmentVariableAdaptationResultsProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">{result.name}</h2>
      <p className="mt-1 text-xs text-slate-500">{ASSESSMENT_VARIABLE_ADAPTATION_RESTRAINT_NOTE}</p>

      <div className="mt-3 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
        <div>
          <p className="text-xs text-slate-500">Scored</p>
          <p className="text-sm font-semibold text-slate-900">{result.metrics.count}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">MAE</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentSeconds(result.metrics.meanAbsoluteError)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Bias</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentSignedSeconds(result.metrics.bias)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Std. Dev.</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentSeconds(result.metrics.standardDeviation)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">On Target</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentPercent(result.metrics.onTargetRate)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Major Miss</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentPercent(result.metrics.majorMissRate)}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-900">By Target</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {result.targetResults.map((target) => (
            <div key={target.targetTime} className="rounded-xl bg-slate-100 p-3 text-center">
              <p className="text-xs font-medium text-slate-700">{target.deliveryLabel}</p>
              <p className="text-xs text-slate-500">{target.metrics.count} attempts</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {formatAssessmentSeconds(target.metrics.meanAbsoluteError)} MAE
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
