"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  ReferenceLine,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import { hasMultipleTargetTimes, type TargetVsActualPoint } from "../lib/chartData";
import type { AnalyticsExplanation } from "../lib/analyticsExplanations";
import {
  formatSecondsAxisTick,
  HANDLE_COLORS,
  HANDLE_LABELS,
  measurementModeAxisLabel,
  REFERENCE_LINE_COLOR,
} from "../lib/chartTheme";
import { formatSigned } from "../lib/timeInput";
import type { Handle } from "../types";
import ChartCard from "./ChartCard";

type TargetActualScatterChartProps = {
  points: TargetVsActualPoint[];
  explanation?: AnalyticsExplanation;
  notices?: string[];
};

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TargetVsActualPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">Shot #{point.shotNumber}</p>
      {point.blockName && <p className="text-slate-500">{point.blockName}</p>}
      {(point.sessionTitle || point.date) && (
        <p className="text-slate-500">
          {point.sessionTitle}
          {point.date ? ` · ${new Date(point.date).toLocaleDateString()}` : ""}
        </p>
      )}
      {(point.trainingCategory || point.measurementMode) && (
        <p className="text-slate-500">
          {point.trainingCategory}
          {point.trainingCategory && point.measurementMode ? " · " : ""}
          {point.measurementMode
            ? measurementModeAxisLabel(point.measurementMode).replace(" (s)", "")
            : ""}
        </p>
      )}
      <p className="mt-1 text-slate-600">Target: {point.targetTime.toFixed(2)}s</p>
      <p className="text-slate-600">Actual: {point.actualTime.toFixed(2)}s</p>
      <p className="text-slate-600">Error: {formatSigned(point.targetError)}s</p>
      <p className="text-slate-600">
        Handle: {point.handle === "in" ? "In" : "Out"}
      </p>
    </div>
  );
}

/**
 * Target vs. Actual — answers "Can I hit different targets correctly?" In
 * and Out are always shown together (toggleable via the legend, a purely
 * visual filter — never a data mutation); points are plotted exactly as
 * recorded, with a neutral y=x reference diagonal.
 */
export default function TargetActualScatterChart({
  points,
  explanation,
  notices,
}: TargetActualScatterChartProps) {
  const [hiddenHandles, setHiddenHandles] = useState<Set<Handle>>(new Set());

  const isEmpty = points.length === 0;

  const allValues = points.flatMap((point) => [point.targetTime, point.actualTime]);
  const domainMin = allValues.length > 0 ? Math.min(...allValues) - 0.1 : 0;
  const domainMax = allValues.length > 0 ? Math.max(...allValues) + 0.1 : 1;

  const inPoints = points.filter((point) => point.handle === "in");
  const outPoints = points.filter((point) => point.handle === "out");

  function toggleHandle(handle: Handle) {
    setHiddenHandles((current) => {
      const next = new Set(current);
      if (next.has(handle)) {
        next.delete(handle);
      } else {
        next.add(handle);
      }
      return next;
    });
  }

  // The Legend's onClick gives back the series' display label (HANDLE_LABELS
  // value, e.g. "Out Handle"), not the raw Handle key — map back explicitly
  // rather than assuming the label happens to coerce to a Handle.
  function handleLegendClick(entry: { value?: unknown }) {
    if (entry.value === HANDLE_LABELS.in) {
      toggleHandle("in");
    } else if (entry.value === HANDLE_LABELS.out) {
      toggleHandle("out");
    }
  }

  return (
    <ChartCard
      title="Target vs. Actual"
      subtitle="Can I hit different targets correctly?"
      explanation={explanation}
      notices={notices}
      isEmpty={isEmpty}
    >
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              type="number"
              dataKey="targetTime"
              name="Target"
              domain={[domainMin, domainMax]}
              tickFormatter={formatSecondsAxisTick}
              tick={{ fontSize: 12 }}
              label={{ value: "Target Time (s)", position: "insideBottom", offset: -2, fontSize: 12 }}
            />
            <YAxis
              type="number"
              dataKey="actualTime"
              name="Actual"
              domain={[domainMin, domainMax]}
              tickFormatter={formatSecondsAxisTick}
              tick={{ fontSize: 12 }}
              width={44}
              label={{ value: "Actual (s)", angle: -90, position: "insideLeft", fontSize: 12 }}
            />

            <ReferenceLine
              segment={[
                { x: domainMin, y: domainMin },
                { x: domainMax, y: domainMax },
              ]}
              stroke={REFERENCE_LINE_COLOR}
              strokeDasharray="4 4"
              ifOverflow="extendDomain"
            />

            <Tooltip content={<ChartTooltip />} />

            <Legend
              onClick={handleLegendClick}
              wrapperStyle={{ cursor: "pointer", fontSize: 12 }}
            />

            <Scatter
              name={HANDLE_LABELS.in}
              data={hiddenHandles.has("in") ? [] : inPoints}
              fill={HANDLE_COLORS.in}
              fillOpacity={0.65}
              shape="circle"
            />
            <Scatter
              name={HANDLE_LABELS.out}
              data={hiddenHandles.has("out") ? [] : outPoints}
              fill={HANDLE_COLORS.out}
              fillOpacity={0.65}
              shape="triangle"
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      {!isEmpty && (
        <p className="mt-2 text-xs text-slate-500">
          {hasMultipleTargetTimes(points)
            ? "Use this chart to see whether accuracy changes across different weights."
            : "This selection contains one target time. The chart mainly shows consistency at that weight."}
        </p>
      )}
    </ChartCard>
  );
}
