"use client";

import type { Shot } from "../types";
import { formatSigned } from "../lib/timeInput";
import ChartCard from "./ChartCard";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

type ReleaseTrendChartProps = {
  shots: Shot[];
};

type ChartPoint = {
  shotNumber: number;
  releaseTime: number;
  targetTime: number;
  predictedTime?: number;
  predictionError?: number;
  targetError: number;
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload: ChartPoint }[];
  label?: number;
}) {
  if (!active || !payload || payload.length === 0) return null;

  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">Shot #{label}</p>
      <p className="text-slate-600">Target: {point.targetTime.toFixed(2)}s</p>
      {point.predictedTime !== undefined && (
        <p className="text-slate-600">
          Prediction: {point.predictedTime.toFixed(2)}s
        </p>
      )}
      <p className="text-slate-600">Actual: {point.releaseTime.toFixed(2)}s</p>
      {point.predictionError !== undefined && (
        <p className="text-slate-600">
          Prediction Error: {formatSigned(point.predictionError)}s
        </p>
      )}
      <p className="text-slate-600">
        Target Error: {formatSigned(point.targetError)}s
      </p>
    </div>
  );
}

export default function ReleaseTrendChart({
  shots,
}: ReleaseTrendChartProps) {
  const hasPredictions = shots.some(
    (shot) => shot.predictedTime !== undefined
  );

  const chartData: ChartPoint[] = shots.map((shot) => ({
    shotNumber: shot.shotNumber,
    releaseTime: shot.releaseTime,
    targetTime: shot.targetTime,
    predictedTime: shot.predictedTime,
    predictionError:
      shot.predictedTime !== undefined
        ? shot.predictedTime - shot.releaseTime
        : undefined,
    targetError: shot.releaseTime - shot.targetTime,
  }));

  // A single point has no trend to show — avoid rendering a blank/degenerate
  // chart frame (DESIGN_SYSTEM.md §22.3) below that.
  const isEmpty = shots.length < 2;

  return (
    <ChartCard
      title="Release Trend"
      subtitle="Is my release becoming more consistent?"
      isEmpty={isEmpty}
      emptyMessage="Add at least two shots to see the release trend."
    >
      <div className="h-72">
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

            <Tooltip content={<ChartTooltip />} />

            {hasPredictions && <Legend />}

            <Line
              type="monotone"
              dataKey="targetTime"
              name="Target"
              stroke="#ef4444"
              strokeWidth={2}
              strokeDasharray="4 4"
              dot={false}
            />

            {hasPredictions && (
              <Line
                type="monotone"
                dataKey="predictedTime"
                name="Prediction"
                stroke="#f59e0b"
                strokeWidth={2}
                strokeDasharray="2 2"
                dot={{ r: 3 }}
                connectNulls
              />
            )}

            <Line
              type="monotone"
              dataKey="releaseTime"
              name="Actual"
              stroke="#0f172a"
              strokeWidth={3}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
