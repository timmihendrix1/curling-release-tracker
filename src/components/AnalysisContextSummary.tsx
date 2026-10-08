"use client";

import type { HistoryAnalysisContext } from "../lib/historyAnalysis";
import { dateRangeLabel } from "../lib/historyAnalysis";
import { blockModeLabel, measurementModeLabel } from "../lib/trainingBlocks";
import { quantityLabel } from "../lib/measurement/tolerance";
import {
  MEASURED_QUANTITIES,
  shotMeasures,
} from "../lib/measurement/quantities";
import type { MeasuredQuantity } from "../types";
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

  // The timing interval and the comparison thresholds are both SECONDS concepts, and
  // this line exists to name only what actually judged the figures on screen. Which
  // quantities those are is the deciding question: with speed in view, a seconds
  // cutoff describes some of the results or none of them — never all of them.
  // Derived from the stones the selection actually RECORDED, by the same rule the
  // summary groups use — so what this line describes and what is on screen can never
  // disagree. A Both block whose stones carry only speed shows only speed figures, and
  // this line must not then talk about release time results that are not there.
  const shownQuantities: MeasuredQuantity[] = filters.measuredQuantity
    ? [filters.measuredQuantity]
    : MEASURED_QUANTITIES.filter((quantity) =>
        context.blocks.some((entry) =>
          entry.shots.some((shot) => shotMeasures(shot, quantity))
        )
      );
  const describesTime =
    shownQuantities.length === 0 || shownQuantities.includes("time");
  const describesSpeed = shownQuantities.includes("speed");
  // Both quantities on screen: every seconds statement has to say so explicitly,
  // because speed is classified against each block's own speed snapshot regardless.
  const mixedQuantities = describesTime && describesSpeed;

  const headline = [
    filters.trainingCategory ? blockModeLabel(filters.trainingCategory) : null,
    filters.measuredQuantity ? quantityLabel(filters.measuredQuantity) : null,
    describesTime && filters.measurementMode
      ? measurementModeLabel(filters.measurementMode)
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const notices: string[] = [];

  if (describesTime && context.thresholdsVaryAcrossBlocks) {
    notices.push(
      mixedQuantities
        ? "Release time thresholds vary across selected blocks. Select Custom comparison thresholds to evaluate their time results using one shared standard."
        : "Thresholds vary across selected blocks. Select Custom comparison thresholds to evaluate all selected blocks using one shared standard."
    );
  }
  if (
    describesTime &&
    context.filters.thresholdComparisonMode.type === "comparison"
  ) {
    const { onTarget, acceptable } = context.filters.thresholdComparisonMode.thresholds;
    const band = `±${onTarget.toFixed(2)}s / ±${acceptable.toFixed(2)}s`;
    notices.push(
      mixedQuantities
        ? `Release time results are evaluated using ${band}. Speed uses each exercise's own speed tolerance.`
        : `All selected shots are evaluated using ${band}.`
    );
  }
  if (!describesTime) {
    notices.push(
      "Speed results use each exercise's own speed tolerance. Comparison thresholds and the timing interval apply to release time only."
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
