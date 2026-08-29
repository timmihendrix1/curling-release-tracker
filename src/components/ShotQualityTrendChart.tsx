"use client";

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  prepareShotQualityDistributionData,
  type ProgressBlockEntry,
  type ShotQualityDistributionPoint,
} from "../lib/chartData";
import { shotQualityExplanation } from "../lib/analyticsExplanations";
import {
  measurementModeAxisLabel,
  TARGET_ERROR_CATEGORY_COLORS,
  TARGET_ERROR_CATEGORY_LABELS,
} from "../lib/chartTheme";
import { SMALL_BLOCK_SHOT_THRESHOLD } from "../lib/historyAnalysis";
import type { MeasurementMode } from "../types";
import ChartCard from "./ChartCard";

type ShotQualityTrendChartProps = {
  entries: ProgressBlockEntry[];
  measurementMode: MeasurementMode;
  notices?: string[];
};

const MIN_BLOCKS_FOR_TREND_SUMMARY = 3;

/**
 * A short "20% → 5%" style summary, only shown when there are enough
 * comparable blocks and neither endpoint comes from a too-small sample —
 * never a linear performance judgement from just two points (see
 * docs/SYSTEM_ARCHITECTURE.md's Shot Quality trend summary rules).
 */
function buildTrendSummary(
  points: ShotQualityDistributionPoint[]
): { majorMiss: string; onTarget: string } | null {
  if (points.length < MIN_BLOCKS_FOR_TREND_SUMMARY) return null;

  const first = points[0];
  const last = points[points.length - 1];

  if (
    first.shotCount < SMALL_BLOCK_SHOT_THRESHOLD ||
    last.shotCount < SMALL_BLOCK_SHOT_THRESHOLD
  ) {
    return null;
  }

  return {
    majorMiss: `${Math.round(first.majorMissPercent)}% → ${Math.round(last.majorMissPercent)}%`,
    onTarget: `${Math.round(first.onTargetPercent)}% → ${Math.round(last.onTargetPercent)}%`,
  };
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ShotQualityDistributionPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">{point.blockName}</p>
      <p className="text-slate-500">
        {point.sessionTitle} · {new Date(point.date).toLocaleDateString()} ·{" "}
        {point.shotCount} shot{point.shotCount === 1 ? "" : "s"} in this block
      </p>
      <p className="mt-1" style={{ color: TARGET_ERROR_CATEGORY_COLORS.on_target }}>
        On Target: {point.onTargetCount} ({Math.round(point.onTargetPercent)}%)
      </p>
      <p style={{ color: TARGET_ERROR_CATEGORY_COLORS.acceptable }}>
        Acceptable: {point.acceptableCount} ({Math.round(point.acceptablePercent)}%)
      </p>
      <p style={{ color: TARGET_ERROR_CATEGORY_COLORS.major_miss }}>
        Major Miss: {point.majorMissCount} ({Math.round(point.majorMissPercent)}%)
      </p>
    </div>
  );
}

/**
 * Shot Quality Over Time — answers "How many shots land in each accuracy
 * band, block by block?" Each block uses its own threshold snapshot; a
 * block with very few shots still shows (percent of a small count), never
 * hidden or padded with a fabricated value.
 */
export default function ShotQualityTrendChart({
  entries,
  measurementMode,
  notices,
}: ShotQualityTrendChartProps) {
  const points = prepareShotQualityDistributionData(entries);
  const isEmpty = points.length === 0;
  const trendSummary = buildTrendSummary(points);

  return (
    <ChartCard
      title={`Shot Quality Over Time — ${measurementModeAxisLabel(measurementMode).replace(" (s)", "")}`}
      subtitle="How many shots land On Target, Acceptable, or a Major Miss, block by block?"
      explanation={shotQualityExplanation()}
      notices={notices}
      isEmpty={isEmpty}
      emptyMessage="Not enough completed blocks yet."
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="blockName"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              width={40}
              tickFormatter={(value) => `${value}%`}
              domain={[0, 100]}
            />
            <Tooltip content={<ChartTooltip />} />

            <Bar
              dataKey="onTargetPercent"
              stackId="quality"
              name={TARGET_ERROR_CATEGORY_LABELS.on_target}
              fill={TARGET_ERROR_CATEGORY_COLORS.on_target}
            />
            <Bar
              dataKey="acceptablePercent"
              stackId="quality"
              name={TARGET_ERROR_CATEGORY_LABELS.acceptable}
              fill={TARGET_ERROR_CATEGORY_COLORS.acceptable}
            />
            <Bar
              dataKey="majorMissPercent"
              stackId="quality"
              name={TARGET_ERROR_CATEGORY_LABELS.major_miss}
              fill={TARGET_ERROR_CATEGORY_COLORS.major_miss}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {trendSummary && (
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
          <p>Major Miss trend: {trendSummary.majorMiss}</p>
          <p>On Target trend: {trendSummary.onTarget}</p>
        </div>
      )}
    </ChartCard>
  );
}
