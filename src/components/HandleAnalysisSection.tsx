"use client";

import type {
  HandleAccuracyComparison,
  HandleTargetErrorBoxPlots,
} from "../lib/analytics";
import {
  handleBiasConsistencyExplanation,
  handleBoxplotExplanation,
} from "../lib/analyticsExplanations";
import { HANDLE_LABELS } from "../lib/chartTheme";
import type { Handle } from "../types";
import HandleBoxPlot from "./HandleBoxPlot";
import HandleErrorBarChart from "./HandleErrorBarChart";

type HandleAnalysisSectionProps = {
  boxPlots: HandleTargetErrorBoxPlots;
  comparison: HandleAccuracyComparison;
};

/**
 * Wraps the Boxplot + Bias/Consistency pair with one dynamic section heading
 * — "Handle Comparison" only when both handles are actually present in the
 * selection; a single-handle selection is never described as a comparison
 * (see docs/SYSTEM_ARCHITECTURE.md's "dynamic Handle Analysis visibility").
 */
export default function HandleAnalysisSection({
  boxPlots,
  comparison,
}: HandleAnalysisSectionProps) {
  const availableHandles = (["in", "out"] as Handle[]).filter(
    (handle) => comparison[`${handle}Handle`].shotCount > 0
  );

  if (availableHandles.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-slate-900">
          Handle Analysis
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          No handle data classified in this selection yet.
        </p>
      </div>
    );
  }

  const heading =
    availableHandles.length === 2
      ? "Handle Comparison"
      : `${HANDLE_LABELS[availableHandles[0]]} Distribution`;

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-slate-900">{heading}</h2>

      {availableHandles.length === 1 && (
        <p className="text-sm text-slate-500">
          Record shots with both handles to unlock a direct handle comparison.
        </p>
      )}

      <HandleBoxPlot
        boxPlots={boxPlots}
        explanation={handleBoxplotExplanation()}
      />

      <HandleErrorBarChart
        comparison={comparison}
        explanation={handleBiasConsistencyExplanation(
          availableHandles.length === 2 ? 2 : 1
        )}
      />
    </div>
  );
}
