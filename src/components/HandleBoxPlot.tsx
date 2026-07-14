"use client";

import { useState } from "react";
import type { HandleTargetErrorBoxPlots } from "../lib/analytics";
import type { AnalyticsExplanation } from "../lib/analyticsExplanations";
import { HANDLE_COLORS, STATISTICAL_OUTLIER_COLOR } from "../lib/chartTheme";
import type { Handle } from "../types";
import ChartCard from "./ChartCard";

type HandleBoxPlotProps = {
  boxPlots: HandleTargetErrorBoxPlots;
  explanation?: AnalyticsExplanation;
};

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 220;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 200;
const BOX_WIDTH = 64;
const COLUMN_X: Record<Handle, number> = { in: 100, out: 220 };

function scaleFactory(domainMin: number, domainMax: number) {
  const span = domainMax - domainMin || 1;
  return (value: number) =>
    PLOT_BOTTOM - ((value - domainMin) / span) * (PLOT_BOTTOM - PLOT_TOP);
}

type HandleColumnProps = {
  handle: Handle;
  label: string;
  stats: HandleTargetErrorBoxPlots["inHandle"];
  yScale: (value: number) => number;
  isSelected: boolean;
  onSelect: () => void;
};

function HandleColumn({
  handle,
  label,
  stats,
  yScale,
  isSelected,
  onSelect,
}: HandleColumnProps) {
  const x = COLUMN_X[handle];
  const color = HANDLE_COLORS[handle];

  if (stats.count === 0) {
    return (
      <text
        x={x}
        y={(PLOT_TOP + PLOT_BOTTOM) / 2}
        textAnchor="middle"
        fontSize={11}
        fill="#94a3b8"
      >
        {label}: no shots
      </text>
    );
  }

  const { q1, q3, median, minWhisker, maxWhisker, outliers } = stats;

  return (
    <g
      onClick={onSelect}
      style={{ cursor: "pointer" }}
      opacity={isSelected ? 1 : 0.85}
    >
      {/* Whisker line */}
      <line
        x1={x}
        x2={x}
        y1={yScale(minWhisker!)}
        y2={yScale(maxWhisker!)}
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Whisker caps */}
      <line
        x1={x - 12}
        x2={x + 12}
        y1={yScale(minWhisker!)}
        y2={yScale(minWhisker!)}
        stroke={color}
        strokeWidth={1.5}
      />
      <line
        x1={x - 12}
        x2={x + 12}
        y1={yScale(maxWhisker!)}
        y2={yScale(maxWhisker!)}
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Box (Q1–Q3) */}
      <rect
        x={x - BOX_WIDTH / 2}
        y={yScale(q3!)}
        width={BOX_WIDTH}
        height={Math.max(yScale(q1!) - yScale(q3!), 1)}
        fill={color}
        fillOpacity={0.18}
        stroke={color}
        strokeWidth={1.5}
      />
      {/* Median */}
      <line
        x1={x - BOX_WIDTH / 2}
        x2={x + BOX_WIDTH / 2}
        y1={yScale(median!)}
        y2={yScale(median!)}
        stroke={color}
        strokeWidth={2.5}
      />
      {/* Statistical outliers — never labeled/colored as Major Miss */}
      {outliers.map((value, index) => (
        <circle
          key={index}
          cx={x}
          cy={yScale(value)}
          r={3}
          fill={STATISTICAL_OUTLIER_COLOR}
          fillOpacity={0.8}
        />
      ))}

      <text
        x={x}
        y={PLOT_BOTTOM + 16}
        textAnchor="middle"
        fontSize={12}
        fontWeight={600}
        fill="#334155"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * Boxplot of Target Error by Handle — answers "Do I differ between In and
 * Out handle?" Custom lightweight SVG (Recharts has no built-in boxplot);
 * statistical outliers (1.5x IQR) are visually and semantically distinct
 * from the fachlicher "Major Miss" concept, which this chart never shows.
 */
export default function HandleBoxPlot({ boxPlots, explanation }: HandleBoxPlotProps) {
  const [selected, setSelected] = useState<Handle>("in");
  const isEmpty = boxPlots.inHandle.count === 0 && boxPlots.outHandle.count === 0;

  const allValues = [
    ...boxPlots.inHandle.outliers,
    ...boxPlots.outHandle.outliers,
    boxPlots.inHandle.minWhisker,
    boxPlots.inHandle.maxWhisker,
    boxPlots.outHandle.minWhisker,
    boxPlots.outHandle.maxWhisker,
    0,
  ].filter((value): value is number => value !== null);

  const domainMin = Math.min(...allValues) - 0.02;
  const domainMax = Math.max(...allValues) + 0.02;
  const yScale = scaleFactory(domainMin, domainMax);

  const selectedStats =
    selected === "in" ? boxPlots.inHandle : boxPlots.outHandle;

  return (
    <ChartCard
      title="Handle Boxplot"
      subtitle="Shows the distribution of target errors by handle."
      explanation={explanation}
      isEmpty={isEmpty}
    >
      <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="w-full">
        <line
          x1={0}
          x2={VIEW_WIDTH}
          y1={yScale(0)}
          y2={yScale(0)}
          stroke="#64748b"
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        <HandleColumn
          handle="in"
          label="In Handle"
          stats={boxPlots.inHandle}
          yScale={yScale}
          isSelected={selected === "in"}
          onSelect={() => setSelected("in")}
        />
        <HandleColumn
          handle="out"
          label="Out Handle"
          stats={boxPlots.outHandle}
          yScale={yScale}
          isSelected={selected === "out"}
          onSelect={() => setSelected("out")}
        />
      </svg>

      {selectedStats.count > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-100 p-3 text-xs text-slate-600">
          <p>Median: {selectedStats.median?.toFixed(3)}s</p>
          <p>Q1: {selectedStats.q1?.toFixed(3)}s</p>
          <p>Q3: {selectedStats.q3?.toFixed(3)}s</p>
          <p>Min/Max whisker: {selectedStats.minWhisker?.toFixed(3)}s / {selectedStats.maxWhisker?.toFixed(3)}s</p>
          <p>Shots: {selectedStats.count}</p>
          <p>Statistical outliers: {selectedStats.outliers.length}</p>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-500">
        Tap a box to see its details. Values are Target Error, not raw release time.
      </p>
    </ChartCard>
  );
}
