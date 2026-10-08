"use client";

import type { MeasuredQuantity, Shot } from "../types";
import type { ResolvedBlockMeasurement } from "../lib/measurement/quantities";
import {
  shotDeviation,
  shotMeasuredValue,
  shotQuantityTarget,
} from "../lib/measurement/quantities";
import {
  formatMeasuredDeviation,
  formatMeasuredValue,
  NOT_RECORDED,
} from "../lib/measurement/format";
import { categorizeDeviation, quantityLabel } from "../lib/measurement/tolerance";
import { targetErrorCategoryLabel } from "../lib/accuracyThresholds";

type MeasuredShotSummaryProps = {
  shot: Shot;
  /** What the stone's own block measures, with the tolerance snapshots to judge by. */
  measurement: ResolvedBlockMeasurement;
};

/**
 * One stone's measurements, each with its own unit, target, signed deviation and
 * classification — and an explicit "not recorded" where one is genuinely missing.
 *
 * The two quantities are rendered as separate, separately-labelled lines on purpose.
 * Seconds and metres per second are never combined into one figure, one average or
 * one classification, and a missing measurement is never shown as 0.00 — a reader
 * cannot tell a fabricated zero from a real one (see src/lib/measurement/format.ts).
 *
 * Classification uses the tolerance snapshot that the stone's own BLOCK carries, not
 * the app's current default, so a historical stone's category never drifts when a
 * template or default changes later (ADR-0008, ADR-0051).
 */
export default function MeasuredShotSummary({
  shot,
  measurement,
}: MeasuredShotSummaryProps) {
  if (measurement.quantities.length === 0) return null;

  return (
    <div className="space-y-1">
      {measurement.quantities.map((quantity: MeasuredQuantity) => {
        const value = shotMeasuredValue(shot, quantity);
        const target = shotQuantityTarget(shot, quantity);
        const deviation = shotDeviation(shot, quantity);
        const tolerance = measurement[quantity]?.tolerance;

        // A category only exists when there is both a measurement and a tolerance to
        // judge it by. Showing one otherwise would assert an assessment that was
        // never made.
        const category =
          deviation !== null && tolerance
            ? categorizeDeviation(deviation, tolerance)
            : null;

        const showLabel = measurement.quantities.length > 1;

        return (
          <div key={quantity}>
            <p className="font-semibold text-slate-900">
              {showLabel && (
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {quantityLabel(quantity)}{" "}
                </span>
              )}
              {formatMeasuredValue(value ?? undefined, quantity)}
            </p>

            {value === null ? (
              <p className="text-xs text-slate-500">Not recorded yet</p>
            ) : (
              <p className="text-xs text-slate-500">
                Target {formatMeasuredValue(target ?? undefined, quantity)} ·{" "}
                {formatMeasuredDeviation(deviation, quantity)}
                {category && <> · {targetErrorCategoryLabel(category)}</>}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The placeholder this project uses wherever a measurement is genuinely absent. */
export { NOT_RECORDED };
