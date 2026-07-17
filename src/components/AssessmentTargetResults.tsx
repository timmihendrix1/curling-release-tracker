import type { ShotDetailRow, TargetResult } from "../lib/assessment/result";
import {
  formatAssessmentPercent,
  formatAssessmentSeconds,
  formatAssessmentSignedSeconds,
} from "../lib/assessment/resultFormatting";
import { ASSESSMENT_TARGET_AGGREGATION_EXPLANATION } from "../lib/assessmentResultContent";
import type { TargetErrorByShotPoint } from "../lib/chartData";
import type { AccuracyThresholds, MeasurementMode } from "../types";
import { surfaceClass } from "./Surface";
import TargetErrorChart from "./TargetErrorChart";

type AssessmentTargetResultsProps = {
  targets: TargetResult[];
  /** Per-shot rows for the visual "Target Error by Shot" chart — the same
   * question this component's table already answers in aggregate, shown
   * first as a chart (docs/VISUAL_ART_DIRECTION.md: charts answer questions
   * before tables). Reuses Train/Analyze's own chart component rather than
   * an Assessment-specific one. */
  shots: ShotDetailRow[];
  thresholds: AccuracyThresholds;
  measurementMode: MeasurementMode;
  /** "bare" strips the outer surface — see AssessmentResultScreen's shared Breakdown grouping. */
  variant?: "card" | "bare";
};

/** Maps Assessment's own shot-level result rows into the generic, chart-only
 * point shape `TargetErrorChart` already renders for Training — never routes
 * through Training's `Shot`/`TrainingBlock` types themselves (see CLAUDE.md's
 * "Assessments are their own domain"). `blockId` has no equivalent on
 * `ShotDetailRow`; the chart itself never reads it, so the block name is
 * reused as a stable-enough key. */
function shotDetailRowsToTargetErrorPoints(rows: ShotDetailRow[]): TargetErrorByShotPoint[] {
  return rows.map((row) => ({
    shotId: row.plannedShotId,
    shotNumber: row.globalShotNumber,
    targetTime: row.targetTime,
    actualTime: row.measuredTime,
    targetError: row.signedError,
    absoluteTargetError: row.absoluteError,
    handle: row.executedHandle,
    blockId: row.blockName,
    blockName: row.blockName,
    category: row.category,
  }));
}

/** Fast/Medium/Slow Delivery breakdown, combining every block including Variable Adaptation. See Phase C brief section 7. */
export default function AssessmentTargetResults({
  targets,
  shots,
  thresholds,
  measurementMode,
  variant = "card",
}: AssessmentTargetResultsProps) {
  return (
    <div className={variant === "card" ? surfaceClass("secondary") : ""}>
      <TargetErrorChart
        points={shotDetailRowsToTargetErrorPoints(shots)}
        thresholds={thresholds}
        measurementMode={measurementMode}
        context="current"
      />

      <h2 className="mt-5 text-lg font-semibold text-slate-900">Target Results</h2>
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
