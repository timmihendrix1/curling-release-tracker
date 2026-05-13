"use client";

import type { Shot } from "../types";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

type ReleaseTrendChartProps = {
  shots: Shot[];
  targetTime: number;
};

export default function ReleaseTrendChart({
  shots,
  targetTime,
}: ReleaseTrendChartProps) {
  const chartData = shots.map((shot) => ({
    shotNumber: shot.shotNumber,
    releaseTime: shot.releaseTime,
  }));

  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg">
      <h2 className="text-xl font-semibold text-slate-900">
        Release Trend
      </h2>

      <div className="mt-6 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <XAxis dataKey="shotNumber" />

            <YAxis
              domain={[
                (dataMin: number) =>
                  Math.floor((dataMin - 0.1) * 100) / 100,
                (dataMax: number) =>
                  Math.ceil((dataMax + 0.1) * 100) / 100,
              ]}
              tickFormatter={(value) => Number(value).toFixed(2)}
            />

            <Tooltip
              formatter={(value) => [
                `${Number(value).toFixed(2)}s`,
                "Release Time",
              ]}
              labelFormatter={(label) => `Shot #${label}`}
            />

            <ReferenceLine
              y={targetTime}
              stroke="#ef4444"
              strokeDasharray="4 4"
            />

            <Line
              type="monotone"
              dataKey="releaseTime"
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