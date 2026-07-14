"use client";

import { useState } from "react";
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  prepareProgressMetricData,
  type ProgressBlockEntry,
  type ProgressMetricKey,
  type ProgressPoint,
} from "../lib/chartData";
import {
  progressMetricExplanation,
  progressMetricSubtitle,
} from "../lib/analyticsExplanations";
import { measurementModeAxisLabel, REFERENCE_LINE_COLOR } from "../lib/chartTheme";
import type { MeasurementMode } from "../types";
import ChartCard from "./ChartCard";

type ProgressMetricChartProps = {
  entries: ProgressBlockEntry[];
  measurementMode: MeasurementMode;
  notices?: string[];
};

const METRIC_OPTIONS: { key: ProgressMetricKey; label: string }[] = [
  { key: "meanAbsoluteTargetError", label: "Average Error" },
  { key: "meanTargetError", label: "Bias" },
  { key: "targetErrorStandardDeviation", label: "Consistency" },
  { key: "onTargetRate", label: "On-Target Rate" },
  { key: "majorMissRate", label: "Major-Miss Rate" },
];

const RATE_METRICS = new Set<ProgressMetricKey>(["onTargetRate", "majorMissRate"]);

function formatMetricValue(value: number | null, metric: ProgressMetricKey): string {
  if (value === null) return "Not enough shots";
  return RATE_METRICS.has(metric)
    ? `${Math.round(value * 100)}%`
    : `${value.toFixed(3)}s`;
}

function ChartTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: { payload: ProgressPoint }[];
  metric: ProgressMetricKey;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">{point.blockName}</p>
      <p className="text-slate-500">
        {point.sessionTitle} · {new Date(point.date).toLocaleDateString()}
      </p>
      {point.blockMode && <p className="text-slate-500">{point.blockMode}</p>}
      {point.targetDescription && (
        <p className="text-slate-500">Target: {point.targetDescription}</p>
      )}
      <p className="mt-1 text-slate-600">
        Thresholds: ±{point.thresholds.onTarget.toFixed(2)}s / ±
        {point.thresholds.acceptable.toFixed(2)}s
      </p>
      <p className="text-slate-600">Shots: {point.shotCount}</p>
      <p className="mt-1 font-medium text-slate-900">
        {formatMetricValue(point.value, metric)}
      </p>
      {point.rollingAverage !== null && (
        <p className="text-slate-500">
          3-block avg: {formatMetricValue(point.rollingAverage, metric)}
        </p>
      )}
    </div>
  );
}

/**
 * Progress across blocks/trainings — answers "Am I improving over time?"
 * One metric at a time (default Average Error); raw per-block points are
 * always shown, a 3-block rolling average line overlays once enough data
 * exists. Never mixes Measurement Modes on one chart.
 */
export default function ProgressMetricChart({
  entries,
  measurementMode,
  notices,
}: ProgressMetricChartProps) {
  const [metric, setMetric] = useState<ProgressMetricKey>(
    "meanAbsoluteTargetError"
  );

  const points = prepareProgressMetricData(entries, metric);
  const isEmpty = points.length === 0;
  const isRate = RATE_METRICS.has(metric);

  return (
    <ChartCard
      title={`Progress — ${measurementModeAxisLabel(measurementMode).replace(" (s)", "")}`}
      subtitle={progressMetricSubtitle(metric)}
      explanation={progressMetricExplanation(metric)}
      notices={notices}
      isEmpty={isEmpty}
      emptyMessage="Not enough completed blocks yet for a progress trend."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        {METRIC_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setMetric(option.key)}
            className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
              metric === option.key
                ? "bg-slate-900 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="blockName"
              tick={{ fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              width={44}
              tickFormatter={(value) =>
                isRate ? `${Math.round(Number(value) * 100)}%` : Number(value).toFixed(2)
              }
              domain={isRate ? [0, 1] : ["auto", "auto"]}
            />
            {!isRate && (
              <ReferenceLine y={0} stroke={REFERENCE_LINE_COLOR} strokeWidth={1} />
            )}
            <Tooltip content={<ChartTooltip metric={metric} />} />

            <Line
              type="monotone"
              dataKey="value"
              name={METRIC_OPTIONS.find((o) => o.key === metric)?.label}
              stroke="#0f172a"
              strokeWidth={2}
              dot={{ r: 4 }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="rollingAverage"
              name="3-block rolling average"
              stroke="#2563eb"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
