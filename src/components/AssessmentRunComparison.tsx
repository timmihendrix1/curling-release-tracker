import type { AssessmentRunComparison as AssessmentRunComparisonData, NamedMetricDelta } from "../lib/assessment/result";
import { accuracyThresholdSetLabel } from "../lib/assessment/result";
import { formatPercentagePointDelta, formatSecondsDelta } from "../lib/assessment/resultFormatting";
import { ASSESSMENT_COMPARISON_THRESHOLD_EXPLANATION } from "../lib/assessmentResultContent";
import type { AccuracyThresholdSet } from "../lib/assessment/types";
import AssessmentComparisonEligibilityNotice from "./AssessmentComparisonEligibilityNotice";
import { surfaceClass } from "./Surface";

type AssessmentRunComparisonProps = {
  comparison: AssessmentRunComparisonData;
  comparisonThresholdSet: AccuracyThresholdSet;
  /** "bare" strips the outer surface so this merges directly beneath the
   * comparison-run selector instead of appearing as a second card. */
  variant?: "card" | "bare";
};

function DeltaRow({ label, delta }: { label: string } & Pick<NamedMetricDelta, "delta">) {
  return (
    <div className="rounded-xl bg-slate-100 p-3">
      <p className="text-sm font-medium text-slate-900">{label}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-slate-500">MAE change</p>
          <p className="text-sm font-semibold text-slate-900">{formatSecondsDelta(delta.meanAbsoluteError)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Bias change</p>
          <p className="text-sm font-semibold text-slate-900">{formatSecondsDelta(delta.bias)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">SD change</p>
          <p className="text-sm font-semibold text-slate-900">{formatSecondsDelta(delta.standardDeviation)}</p>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-xs text-slate-500">On Target</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatPercentagePointDelta(delta.onTargetRatePercentagePoints)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Acceptable</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatPercentagePointDelta(delta.acceptableRatePercentagePoints)}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">Major Miss</p>
          <p className="text-sm font-semibold text-slate-900">
            {formatPercentagePointDelta(delta.majorMissRatePercentagePoints)}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Direct comparison of two protocol-compatible completed runs — every figure
 * is a plain, neutral change ("MAE decreased by 0.02s"), never a synthetic
 * winner or overall score. See Phase C brief section 13.
 */
export default function AssessmentRunComparison({
  comparison,
  comparisonThresholdSet,
  variant = "card",
}: AssessmentRunComparisonProps) {
  return (
    // Comparison content must not compete with the current result (Epic 1).
    <div className={variant === "card" ? surfaceClass("secondary") : "mt-5 border-t border-slate-100 pt-4"}>
      <h2 className="text-lg font-semibold text-slate-900">Run Comparison</h2>

      <AssessmentComparisonEligibilityNotice
        eligible={comparison.eligible}
        reasonMessages={comparison.reasonMessages}
      />

      {comparison.eligible && comparison.earlier && comparison.later && (
        <div className="mt-4 space-y-3">
          <p className="text-xs text-slate-500">
            {new Date(comparison.earlier.run.completedAt ?? comparison.earlier.run.createdAt).toLocaleDateString()} →{" "}
            {new Date(comparison.later.run.completedAt ?? comparison.later.run.createdAt).toLocaleDateString()} · Comparison
            Threshold: {accuracyThresholdSetLabel(comparisonThresholdSet)} (±
            {comparisonThresholdSet.values.onTarget.toFixed(2)}s / ±{comparisonThresholdSet.values.acceptable.toFixed(2)}s)
          </p>
          <p className="text-xs text-slate-500">{ASSESSMENT_COMPARISON_THRESHOLD_EXPLANATION}</p>

          {comparison.overallDelta && <DeltaRow label="Overall" delta={comparison.overallDelta} />}

          {comparison.blockDeltas && comparison.blockDeltas.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">By Block</h3>
              {comparison.blockDeltas.map((entry) => (
                <DeltaRow key={entry.key} label={entry.label} delta={entry.delta} />
              ))}
            </div>
          )}

          {comparison.targetDeltas && comparison.targetDeltas.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">By Target</h3>
              {comparison.targetDeltas.map((entry) => (
                <DeltaRow key={entry.key} label={entry.label} delta={entry.delta} />
              ))}
            </div>
          )}

          {comparison.handleDeltas && comparison.handleDeltas.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">By Handle</h3>
              {comparison.handleDeltas.map((entry) => (
                <DeltaRow key={entry.key} label={entry.label} delta={entry.delta} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
