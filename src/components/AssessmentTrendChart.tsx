"use client";

import { useState } from "react";
import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AssessmentTrendPoint } from "../lib/assessment/result";
import { REFERENCE_LINE_COLOR } from "../lib/chartTheme";
import { ASSESSMENT_NO_SECOND_RUN_NOTICE, ASSESSMENT_TREND_LIMITED_NOTICE } from "../lib/assessmentResultContent";
import ChartCard from "./ChartCard";

type TrendMetricKey = "meanAbsoluteError" | "bias" | "standardDeviation" | "onTargetRate";

const METRIC_OPTIONS: { key: TrendMetricKey; label: string }[] = [
  { key: "meanAbsoluteError", label: "MAE" },
  { key: "bias", label: "Bias" },
  { key: "standardDeviation", label: "Std. Dev." },
  { key: "onTargetRate", label: "On Target" },
];

const RATE_METRICS = new Set<TrendMetricKey>(["onTargetRate"]);

type ChartPoint = {
  runId: string;
  label: string;
  isSelected: boolean;
  value: number | null;
};

function formatMetricValue(value: number | null, metric: TrendMetricKey): string {
  if (value === null) return "Not enough data";
  return RATE_METRICS.has(metric) ? `${Math.round(value * 100)}%` : `${value.toFixed(3)}s`;
}

function ChartTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  metric: TrendMetricKey;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">{point.label}</p>
      <p className="mt-1 font-medium text-slate-900">{formatMetricValue(point.value, metric)}</p>
      {point.isSelected && <p className="text-slate-500">This run</p>}
    </div>
  );
}

type AssessmentTrendChartProps = {
  points: AssessmentTrendPoint[];
  comparisonThresholdLabel: string;
};

/**
 * Development Trends across protocol-compatible completed runs of the same
 * Template + Version, under one shared Comparison Threshold Set. See Phase C
 * brief section 14.
 */
export default function AssessmentTrendChart({ points, comparisonThresholdLabel }: AssessmentTrendChartProps) {
  const [metric, setMetric] = useState<TrendMetricKey>("meanAbsoluteError");
  const isRate = RATE_METRICS.has(metric);

  const chartPoints: ChartPoint[] = points.map((point) => ({
    runId: point.runId,
    label: new Date(point.completedAt).toLocaleDateString(),
    isSelected: point.isSelected,
    value: point.metrics[metric],
  }));

  const isEmpty = points.length === 0;

  return (
    <ChartCard
      title="Development Trends"
      subtitle={`Comparison Threshold: ${comparisonThresholdLabel}`}
      isEmpty={isEmpty}
      emptyMessage={ASSESSMENT_NO_SECOND_RUN_NOTICE}
    >
      {points.length === 1 ? (
        <p className="text-sm text-slate-500">{ASSESSMENT_NO_SECOND_RUN_NOTICE}</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {METRIC_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setMetric(option.key)}
                className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                  metric === option.key ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {points.length === 2 && <p className="mb-2 text-xs text-slate-500">{ASSESSMENT_TREND_LIMITED_NOTICE}</p>}

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartPoints} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 12 }}
                  width={44}
                  tickFormatter={(value) => (isRate ? `${Math.round(Number(value) * 100)}%` : Number(value).toFixed(2))}
                  domain={isRate ? [0, 1] : ["auto", "auto"]}
                />
                {!isRate && <ReferenceLine y={0} stroke={REFERENCE_LINE_COLOR} strokeWidth={1} />}
                <Tooltip content={<ChartTooltip metric={metric} />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  name={METRIC_OPTIONS.find((option) => option.key === metric)?.label}
                  stroke="#0f172a"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </ChartCard>
  );
}
