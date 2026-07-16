import type { AssessmentResultView } from "../lib/assessment/result";
import { accuracyThresholdSetLabel } from "../lib/assessment/result";
import {
  formatAssessmentPercent,
  formatAssessmentSeconds,
  formatAssessmentSignedSeconds,
} from "../lib/assessment/resultFormatting";
import {
  ASSESSMENT_BIAS_EXPLANATION,
  ASSESSMENT_MAE_EXPLANATION,
  ASSESSMENT_STANDARD_DEVIATION_EXPLANATION,
  assessmentCategoryExplanation,
} from "../lib/assessmentResultContent";
import DashboardCard from "./DashboardCard";

type AssessmentCoreMetricsProps = {
  result: AssessmentResultView;
};

/**
 * Threshold-independent core metrics (MAE / Bias / Standard Deviation) and
 * threshold-dependent category metrics (On Target / Acceptable / Major
 * Miss), always shown together with the active Threshold Set so category
 * rates never appear as if they were threshold-independent. See
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md sections 18/21.
 */
export default function AssessmentCoreMetrics({ result }: AssessmentCoreMetricsProps) {
  const { raw, category, activeThresholdSet } = result;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">Core Metrics</h2>
        <p className="mt-1 text-xs text-slate-500">Threshold-independent — never affected by the analysis threshold below.</p>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <DashboardCard
            label="Mean Absolute Error"
            value={formatAssessmentSeconds(raw.meanAbsoluteError)}
            explanation={ASSESSMENT_MAE_EXPLANATION}
          />
          <DashboardCard
            label="Bias"
            value={formatAssessmentSignedSeconds(raw.bias)}
            explanation={ASSESSMENT_BIAS_EXPLANATION}
          />
          <DashboardCard
            label="Standard Deviation"
            value={formatAssessmentSeconds(raw.standardDeviation)}
            explanation={ASSESSMENT_STANDARD_DEVIATION_EXPLANATION}
          />
        </div>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">
          Category Metrics <span className="text-sm font-normal text-slate-500">under {accuracyThresholdSetLabel(activeThresholdSet)}</span>
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Threshold-dependent — recalculates when the analysis threshold below changes.
        </p>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <DashboardCard
            label="On Target"
            value={formatAssessmentPercent(category.onTargetRate)}
            explanation={assessmentCategoryExplanation(activeThresholdSet.values)}
          />
          <DashboardCard label="Acceptable" value={formatAssessmentPercent(category.acceptableRate)} />
          <DashboardCard label="Major Miss" value={formatAssessmentPercent(category.majorMissRate)} />
        </div>
      </div>
    </div>
  );
}
