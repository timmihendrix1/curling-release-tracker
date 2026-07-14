"use client";

import {
  Bar,
  BarChart,
  Cell,
  ErrorBar,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HandleAccuracyComparison } from "../lib/analytics";
import type { AnalyticsExplanation } from "../lib/analyticsExplanations";
import {
  formatSecondsAxisTick,
  HANDLE_COLORS,
  HANDLE_LABELS,
  REFERENCE_LINE_COLOR,
} from "../lib/chartTheme";
import { formatSigned } from "../lib/timeInput";
import type { Handle } from "../types";
import ChartCard from "./ChartCard";

type HandleErrorBarChartProps = {
  comparison: HandleAccuracyComparison;
  explanation?: AnalyticsExplanation;
};

type ChartRow = {
  handle: Handle;
  label: string;
  mean: number;
  sd: number;
  mae: number | null;
  count: number;
  sdAvailable: boolean;
};

const MIN_SHOTS_FOR_SD = 2;

function buildRow(handle: Handle, analysis: HandleAccuracyComparison["inHandle"]): ChartRow {
  return {
    handle,
    label: HANDLE_LABELS[handle],
    mean: analysis.meanTargetError ?? 0,
    sd: analysis.targetErrorStandardDeviation ?? 0,
    mae: analysis.meanAbsoluteTargetError,
    count: analysis.shotCount,
    sdAvailable: analysis.shotCount >= MIN_SHOTS_FOR_SD,
  };
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">{row.label}</p>
      <p className="text-slate-600">Mean Error: {formatSigned(row.mean)}s</p>
      <p className="text-slate-600">
        SD: {row.sdAvailable ? `${row.sd.toFixed(3)}s` : "Not enough shots"}
      </p>
      <p className="text-slate-600">
        MAE: {row.mae !== null ? `${row.mae.toFixed(3)}s` : "Not enough shots"}
      </p>
      <p className="text-slate-600">Shots: {row.count}</p>
    </div>
  );
}

/**
 * Handle Bias and Consistency — Mean Target Error ± 1 SD per handle.
 * Complements the Handle Boxplot (distribution shape) rather than
 * duplicating it; a handle with fewer than 2 shots shows no error bar and
 * an explicit "not enough shots" note instead of a misleading SD of 0.
 */
export default function HandleErrorBarChart({
  comparison,
  explanation,
}: HandleErrorBarChartProps) {
  const rows: ChartRow[] = (["in", "out"] as Handle[])
    .filter((handle) => comparison[`${handle}Handle`].shotCount > 0)
    .map((handle) => buildRow(handle, comparison[`${handle}Handle`]));

  const isEmpty = rows.length === 0;

  return (
    <ChartCard
      title="Handle Bias and Consistency"
      subtitle={
        rows.length === 2
          ? "Compares average bias and consistency between handles."
          : "Mean target error ± 1 SD, by handle"
      }
      explanation={explanation}
      isEmpty={isEmpty}
    >
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fontSize: 12 }} />
            <YAxis
              tickFormatter={formatSecondsAxisTick}
              tick={{ fontSize: 12 }}
              width={44}
            />
            <ReferenceLine y={0} stroke={REFERENCE_LINE_COLOR} strokeWidth={2} />
            <Tooltip content={<ChartTooltip />} />

            <Bar dataKey="mean" name="Mean Target Error" barSize={48}>
              {rows.map((row) => (
                <Cell key={row.handle} fill={HANDLE_COLORS[row.handle]} />
              ))}
              <ErrorBar
                dataKey={(row: ChartRow) => (row.sdAvailable ? row.sd : 0)}
                width={6}
                strokeWidth={2}
                stroke="#334155"
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {rows.some((row) => !row.sdAvailable) && (
        <p className="mt-2 text-xs text-slate-500">
          At least 2 shots are needed to show a consistency (SD) range.
        </p>
      )}
    </ChartCard>
  );
}
