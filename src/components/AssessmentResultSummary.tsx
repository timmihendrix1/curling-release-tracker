import type { ReactNode } from "react";
import { accuracyThresholdSetLabel, type AssessmentResultView } from "../lib/assessment/result";
import { surfaceClass } from "./Surface";

type AssessmentResultSummaryProps = {
  result: AssessmentResultView;
  /**
   * The Analysis Threshold control renders inside this same Hero, directly
   * beneath the run's own facts — choosing which threshold to view the
   * result through is part of understanding the one result, not a separate
   * task (compositional redesign).
   */
  children?: ReactNode;
};

const MEASUREMENT_MODE_LABELS: Record<string, string> = {
  "back-hog": "Backline–Hog",
  "hog-hog": "Hog–Hog",
};

/** The header card of a Result Screen — see docs' Phase C brief section 3 "Summary". */
export default function AssessmentResultSummary({ result, children }: AssessmentResultSummaryProps) {
  const { run, activeThresholdSet, protocolIntegrity } = result;

  return (
    // The Result Screen's one Hero (Epic 1).
    <div className={surfaceClass("hero")}>
      <h1 className="text-xl font-semibold text-slate-900">{run.templateSnapshot.name}</h1>
      <p className="mt-1 text-sm text-slate-600">
        Version {run.templateVersion} ·{" "}
        {run.completedAt ? new Date(run.completedAt).toLocaleDateString() : "Incomplete"}
      </p>

      <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        <li>{MEASUREMENT_MODE_LABELS[protocolIntegrity.measurementMode] ?? protocolIntegrity.measurementMode}</li>
        <li className="capitalize">{run.templateSnapshot.shotType}</li>
        <li>{result.raw.count} of {run.templateSnapshot.protocolMetadata.scoredShotCount} scored stones</li>
        <li>{protocolIntegrity.invalidAttemptCount} invalid attempts</li>
        <li>{protocolIntegrity.totalDeviationCount} protocol deviations</li>
        <li className="capitalize">{run.status}</li>
      </ul>

      <div className="mt-3 grid grid-cols-1 gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 sm:grid-cols-2">
        <p>
          Original Run Thresholds: {accuracyThresholdSetLabel(run.thresholdSnapshot)} (±
          {run.thresholdSnapshot.values.onTarget.toFixed(2)}s / ±{run.thresholdSnapshot.values.acceptable.toFixed(2)}s)
        </p>
        <p>
          Active analysis: {accuracyThresholdSetLabel(activeThresholdSet)} (±
          {activeThresholdSet.values.onTarget.toFixed(2)}s / ±{activeThresholdSet.values.acceptable.toFixed(2)}s)
        </p>
      </div>

      {children && <div className="mt-5 border-t border-slate-100 pt-4">{children}</div>}
    </div>
  );
}
