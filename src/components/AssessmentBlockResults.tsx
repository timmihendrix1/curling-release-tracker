import type { BlockResult } from "../lib/assessment/result";
import { deliveryLabelForTarget } from "../lib/assessment/result";
import {
  formatAssessmentPercent,
  formatAssessmentSeconds,
  formatAssessmentSignedSeconds,
} from "../lib/assessment/resultFormatting";
import { surfaceClass } from "./Surface";

type AssessmentBlockResultsProps = {
  blocks: BlockResult[];
  /** "bare" strips the outer surface — see AssessmentResultScreen's shared Breakdown grouping. */
  variant?: "card" | "bare";
};

/**
 * Per-block analysis (Medium/Slow/Fast Reproduction, Variable Adaptation) —
 * deliberately no block score or ranking, just the same transparent metric
 * set as the overall run. See Phase C brief section 6.
 */
export default function AssessmentBlockResults({ blocks, variant = "card" }: AssessmentBlockResultsProps) {
  return (
    <div className={variant === "card" ? surfaceClass("secondary") : ""}>
      <h2 className="text-lg font-semibold text-slate-900">Block Results</h2>

      <div className="mt-3 space-y-3">
        {blocks.map((block) => (
          <div key={block.blockId} className="rounded-xl bg-slate-100 p-4">
            <p className="font-semibold text-slate-900">{block.name}</p>
            <p className="mt-1 text-xs text-slate-600">{block.purpose}</p>
            <p className="mt-1 text-xs text-slate-500">
              {block.targetTimes.map(deliveryLabelForTarget).join(" · ")} · {block.metrics.count} scored stones
            </p>

            <div className="mt-3 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
              <div>
                <p className="text-xs text-slate-500">MAE</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSeconds(block.metrics.meanAbsoluteError)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Bias</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSignedSeconds(block.metrics.bias)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Std. Dev.</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentSeconds(block.metrics.standardDeviation)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">On Target</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(block.metrics.onTargetRate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Acceptable</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(block.metrics.acceptableRate)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Major Miss</p>
                <p className="text-sm font-semibold text-slate-900">
                  {formatAssessmentPercent(block.metrics.majorMissRate)}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
