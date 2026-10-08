"use client";

import {
  Bar,
  BarChart,
  Cell,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TargetErrorByShotPoint } from "../lib/chartData";
import {
  type ExplanationContext,
  targetErrorByShotExplanation,
} from "../lib/analyticsExplanations";
import {
  formatSecondsAxisTick,
  REFERENCE_LINE_COLOR,
  TARGET_ERROR_CATEGORY_COLORS,
  TARGET_ERROR_CATEGORY_LABELS,
} from "../lib/chartTheme";
import { formatSigned } from "../lib/timeInput";
import type { QuantityTolerance, AccuracyThresholds, MeasurementMode } from "../types";
import ChartCard from "./ChartCard";
import { asQuantityTolerance } from "../lib/measurement/tolerance";

type TargetErrorChartProps = {
  points: TargetErrorByShotPoint[];
  /** Only rendered as reference bands when the whole selection shares one set. */
  /**
   * The tolerance the bars were ACTUALLY classified against — the historical
   * symmetric pair or a block's own per-side tolerance. `null` when the selection's
   * blocks disagree, in which case no band is drawn at all (a single band would imply
   * a shared cutoff that does not exist).
   */
  thresholds: AccuracyThresholds | QuantityTolerance | null;
  measurementMode: MeasurementMode;
  context?: ExplanationContext;
  notices?: string[];
};

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: TargetErrorByShotPoint }[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
      <p className="font-semibold text-slate-900">Shot #{point.shotNumber}</p>
      {point.blockName && <p className="text-slate-500">{point.blockName}</p>}
      <p className="mt-1 text-slate-600">Target: {point.targetTime.toFixed(2)}s</p>
      <p className="text-slate-600">Actual: {point.actualTime.toFixed(2)}s</p>
      <p className="text-slate-600">
        Target Error: {formatSigned(point.targetError)}s
      </p>
      <p className="text-slate-600">
        Absolute Error: {point.absoluteTargetError.toFixed(3)}s
      </p>
      <p className="text-slate-600">
        Handle: {point.handle === "in" ? "In" : "Out"}
      </p>
      <p
        className="mt-1 text-xs font-medium"
        style={{ color: TARGET_ERROR_CATEGORY_COLORS[point.category] }}
      >
        {TARGET_ERROR_CATEGORY_LABELS[point.category]}
      </p>
    </div>
  );
}

/**
 * Target Error by Shot — answers "Am I hitting my target, and is my miss
 * systematic?" Bars extend above/below a prominent zero line; color encodes
 * On Target / Acceptable / Major Miss. No per-point labels (mobile-readable
 * with many shots).
 */
/**
 * The exact y-axis endpoints of this chart's two reference bands, in Target Error
 * units (measured minus target), or `null` when no single band applies.
 *
 * Exported so the drawn geometry can be asserted directly instead of being
 * reimplemented by a test — the component renders these values and nothing else.
 * A negative deviation is judged by the `lower` side and a positive one by `upper`,
 * so the band spans [-lower, +upper]; a symmetric tolerance produces the same
 * [-x, +x] band it always did.
 */
export function targetErrorBandEndpoints(
  thresholds: AccuracyThresholds | QuantityTolerance | null
): { onTarget: [number, number]; acceptable: [number, number] } | null {
  if (!thresholds) return null;
  const tolerance = asQuantityTolerance(thresholds);
  return {
    onTarget: [-tolerance.onTarget.lower, tolerance.onTarget.upper],
    acceptable: [-tolerance.acceptable.lower, tolerance.acceptable.upper],
  };
}

export default function TargetErrorChart({
  points,
  thresholds,
  measurementMode,
  context = "current",
  notices,
}: TargetErrorChartProps) {
  const isEmpty = points.length === 0;
  const bands = targetErrorBandEndpoints(thresholds);

  return (
    <ChartCard
      title="Target Error by Shot"
      subtitle="Am I hitting my target, and is my miss systematic?"
      explanation={targetErrorByShotExplanation(measurementMode, context)}
      notices={notices}
      isEmpty={isEmpty}
    >
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <XAxis dataKey="shotNumber" tick={{ fontSize: 12 }} />
            <YAxis
              tickFormatter={formatSecondsAxisTick}
              tick={{ fontSize: 12 }}
              width={44}
            />

            {bands && (
              <>
                {/* Endpoints are the real per-side cutoffs: a bar's colour and the
                    band it sits in are produced from the same two numbers, so an
                    asymmetric tolerance can never draw a band that contradicts a
                    classification. A symmetric tolerance renders exactly as before. */}
                <ReferenceArea
                  y1={bands.acceptable[0]}
                  y2={bands.acceptable[1]}
                  fill={TARGET_ERROR_CATEGORY_COLORS.acceptable}
                  fillOpacity={0.06}
                  ifOverflow="extendDomain"
                />
                <ReferenceArea
                  y1={bands.onTarget[0]}
                  y2={bands.onTarget[1]}
                  fill={TARGET_ERROR_CATEGORY_COLORS.on_target}
                  fillOpacity={0.1}
                  ifOverflow="extendDomain"
                />
              </>
            )}

            <ReferenceLine y={0} stroke={REFERENCE_LINE_COLOR} strokeWidth={2} />

            <Tooltip content={<ChartTooltip />} />

            <Bar dataKey="targetError" name="Target Error" radius={2}>
              {points.map((point) => (
                <Cell
                  key={point.shotId}
                  fill={TARGET_ERROR_CATEGORY_COLORS[point.category]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {!thresholds && !isEmpty && (
        <p className="mt-2 text-xs text-slate-500">
          Thresholds vary across the selected blocks — on-target/acceptable
          bands are hidden.
        </p>
      )}
    </ChartCard>
  );
}
