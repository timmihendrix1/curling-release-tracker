import { computeBoxPlotStatistics } from "../lib/boxPlotStatistics";
import type { HandleTargetErrorBoxPlots } from "../lib/analytics";
import { handleBoxplotExplanation } from "../lib/analyticsExplanations";
import { HANDLE_LABELS } from "../lib/chartTheme";
import type { HandleComparison, ShotDetailRow } from "../lib/assessment/result";
import {
  formatAssessmentPercent,
  formatAssessmentSeconds,
  formatAssessmentSignedSeconds,
} from "../lib/assessment/resultFormatting";
import { ASSESSMENT_HANDLE_COMPARISON_EXPLANATION, ASSESSMENT_HANDLE_GROUPING_NOTE } from "../lib/assessmentResultContent";
import { surfaceClass } from "./Surface";
import HandleBoxPlot from "./HandleBoxPlot";

type AssessmentHandleComparisonProps = {
  comparison: HandleComparison;
  /** Per-shot rows for the visual Handle Boxplot — the same in/out-handle
   * question this component's KPI grid already answers in aggregate, shown
   * first as a chart. Reuses Train/Analyze's own boxplot component and its
   * shared, generic statistics primitive rather than an Assessment-specific
   * chart. */
  shots: ShotDetailRow[];
  /** "bare" strips the outer surface — see AssessmentResultScreen's shared Breakdown grouping. */
  variant?: "card" | "bare";
};

/** Boxplot statistics of Target Error, grouped by *executed* handle — the
 * same generic primitive Training's own Handle Boxplot uses, computed here
 * from Assessment's own shot rows rather than Training `Shot[]` (see
 * CLAUDE.md's "Assessments are their own domain"). */
function shotDetailRowsToHandleBoxPlots(rows: ShotDetailRow[]): HandleTargetErrorBoxPlots {
  const signedErrorsFor = (handle: "in" | "out") =>
    rows.filter((row) => row.executedHandle === handle).map((row) => row.signedError);

  return {
    inHandle: computeBoxPlotStatistics(signedErrorsFor("in")),
    outHandle: computeBoxPlotStatistics(signedErrorsFor("out")),
  };
}

/** In vs. Out Handle — grouped by executed handle. See Phase C brief section 8. */
export default function AssessmentHandleComparison({ comparison, shots, variant = "card" }: AssessmentHandleComparisonProps) {
  const { in: inResult, out: outResult } = comparison;

  return (
    <div className={variant === "card" ? surfaceClass("secondary") : ""}>
      <HandleBoxPlot
        boxPlots={shotDetailRowsToHandleBoxPlots(shots)}
        explanation={handleBoxplotExplanation()}
      />

      <h2 className="mt-5 text-lg font-semibold text-slate-900">Handle Comparison</h2>
      <p className="mt-1 text-xs text-slate-500">{ASSESSMENT_HANDLE_GROUPING_NOTE}</p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[inResult, outResult].map((handleResult) => (
          <div key={handleResult.handle} className="rounded-xl bg-slate-100 p-4">
            <p className="font-semibold text-slate-900">{HANDLE_LABELS[handleResult.handle]}</p>
            <p className="text-xs text-slate-500">{handleResult.metrics.count} shots</p>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-slate-500">MAE</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSeconds(handleResult.metrics.meanAbsoluteError)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Bias</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSignedSeconds(handleResult.metrics.bias)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">SD</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSeconds(handleResult.metrics.standardDeviation)}
                </p>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-xs text-slate-500">On Target</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(handleResult.metrics.onTargetRate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Acceptable</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(handleResult.metrics.acceptableRate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Major Miss</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(handleResult.metrics.majorMissRate)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-3 rounded-xl bg-slate-50 p-3 text-center">
        <div>
          <p className="text-xs text-slate-500">MAE difference</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentSeconds(comparison.meanAbsoluteErrorDifference)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Bias difference</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentSeconds(comparison.biasDifference)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">SD difference</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatAssessmentSeconds(comparison.standardDeviationDifference)}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">{ASSESSMENT_HANDLE_COMPARISON_EXPLANATION}</p>
    </div>
  );
}
