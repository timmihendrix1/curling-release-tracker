"use client";

import { useState } from "react";
import type { Session } from "../types";
import { analyzeShots } from "../lib/analytics";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type SessionTrendChartProps = {
  sessions: Session[];
};

type TrendMetric = "avgAbsDeviation" | "bias";

export default function SessionTrendChart({
  sessions,
}: SessionTrendChartProps) {
  const [selectedMetric, setSelectedMetric] =
    useState<TrendMetric>("avgAbsDeviation");

  const chartData = [...sessions]
    .reverse()
    .map((session, index) => {
      const analysis = analyzeShots(session.shots);

      return {
        sessionNumber: index + 1,
        avgAbsDeviation: analysis.averageAbsoluteDeviationFromTarget,
        bias: analysis.averageDeviationFromTarget,
      };
    });

  const metricLabel =
    selectedMetric === "avgAbsDeviation"
      ? "Avg Abs Deviation"
      : "Bias vs Target";

  if (chartData.length === 0) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-slate-900">
          Progress Trend
        </h2>

        <p className="mt-3 text-slate-600">
          Complete at least one session to see progress over time.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-slate-900">
        Progress Trend
      </h2>

      <p className="mt-2 text-sm text-slate-600">
        Track how your release performance changes across sessions.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-2">
        <button
          type="button"
          onClick={() => setSelectedMetric("avgAbsDeviation")}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            selectedMetric === "avgAbsDeviation"
              ? "bg-slate-900 text-white"
              : "text-slate-700 hover:bg-slate-200"
          }`}
        >
          Avg Abs Dev
        </button>

        <button
          type="button"
          onClick={() => setSelectedMetric("bias")}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            selectedMetric === "bias"
              ? "bg-slate-900 text-white"
              : "text-slate-700 hover:bg-slate-200"
          }`}
        >
          Bias
        </button>
      </div>

      <div className="mt-6 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <XAxis dataKey="sessionNumber" />

            <YAxis tickFormatter={(value) => Number(value).toFixed(2)} />

            <Tooltip
              formatter={(value) => [
                `${Number(value).toFixed(3)}s`,
                metricLabel,
              ]}
              labelFormatter={(label) => `Session #${label}`}
            />

            <Line
              type="monotone"
              dataKey={selectedMetric}
              stroke="#0f172a"
              strokeWidth={3}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}