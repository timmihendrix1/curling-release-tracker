"use client";

import type { HistoryAnalysisContext } from "../lib/historyAnalysis";
import { dateRangeLabel } from "../lib/historyAnalysis";
import { blockModeLabel, measurementModeLabel } from "../lib/trainingBlocks";
import { surfaceClass } from "./Surface";

type AnalysisContextSummaryProps = {
  context: HistoryAnalysisContext;
  /**
   * "bare" strips the outer surface so this merges directly into the top of
   * the Key Progress Summary Hero when there's data to summarize — "what am
   * I looking at" and "what does it show" are one continuous answer, not
   * two stacked cards (compositional redesign). Standalone "utility" is
   * still used for the empty-selection state, where this is the only thing
   * on screen.
   */
  variant?: "utility" | "bare";
};

function formatDateSpan(context: HistoryAnalysisContext): string {
  if (context.blocks.length === 0) return dateRangeLabel(context.filters.dateRange);

  const dates = context.blocks.map((entry) => new Date(entry.block.createdAt).getTime());
  const earliest = new Date(Math.min(...dates));
  const latest = new Date(Math.max(...dates));

  const format = (date: Date) =>
    date.toLocaleDateString(undefined, { month: "short", year: "numeric" });

  return format(earliest) === format(latest)
    ? format(earliest)
    : `${format(earliest)} – ${format(latest)}`;
}

/**
 * The "what am I looking at" line directly under the sticky filters — see
 * docs/SYSTEM_ARCHITECTURE.md's History information hierarchy. Notices are
 * deliberately capped to what's actually relevant for the current selection,
 * not shown by default for every possible condition (avoid warning overload).
 */
export default function AnalysisContextSummary({
  context,
  variant = "utility",
}: AnalysisContextSummaryProps) {
  const { filters } = context;

  const headline = [
    filters.trainingCategory ? blockModeLabel(filters.trainingCategory) : null,
    filters.measurementMode ? measurementModeLabel(filters.measurementMode) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const notices: string[] = [];

  if (context.thresholdsVaryAcrossBlocks) {
    notices.push(
      "Thresholds vary across selected blocks. Select Custom comparison thresholds to evaluate all selected blocks using one shared standard."
    );
  }
  if (context.filters.thresholdComparisonMode.type === "comparison") {
    const { onTarget, acceptable } = context.filters.thresholdComparisonMode.thresholds;
    notices.push(
      `All selected shots are evaluated using ±${onTarget.toFixed(2)}s / ±${acceptable.toFixed(2)}s.`
    );
  }
  if (context.availableHandles.length === 1) {
    notices.push(
      `Only ${context.availableHandles[0] === "in" ? "In" : "Out"} handle is available in this selection.`
    );
  }
  if (context.smallSampleBlockCount > 0) {
    notices.push(
      `${context.smallSampleBlockCount} block${context.smallSampleBlockCount === 1 ? "" : "s"} contain${context.smallSampleBlockCount === 1 ? "s" : ""} fewer than 8 shots.`
    );
  }

  return (
    <div className={variant === "utility" ? surfaceClass("utility") : ""}>
      {headline && (
        <p className="text-sm font-semibold text-slate-900">{headline}</p>
      )}

      <p className="mt-0.5 text-sm text-slate-600">
        {context.totalBlockCount} block{context.totalBlockCount === 1 ? "" : "s"} ·{" "}
        {context.totalShotCount} shot{context.totalShotCount === 1 ? "" : "s"} ·{" "}
        {formatDateSpan(context)}
      </p>

      {notices.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-500">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      {context.totalBlockCount === 0 && (
        <p className="mt-2 text-sm text-slate-500">
          No shots match this selection yet. Try widening the date range or
          filters above.
        </p>
      )}
    </div>
  );
}
