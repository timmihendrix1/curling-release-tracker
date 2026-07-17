import type { Handle } from "../types";
import type { TargetErrorCategory } from "../lib/accuracyThresholds";
import { formatSigned } from "../lib/timeInput";
import { surfaceClass } from "./Surface";

export type AssessmentLastResult = {
  actualTime: number;
  difference: number;
  category: TargetErrorCategory | null;
  wrongHandle: boolean;
};

type AssessmentCurrentShotProps = {
  phase: "warmup" | "scored";
  blockName?: string;
  targetTime: number;
  expectedHandle: Handle;
  executedHandle: Handle;
  onChangeExecutedHandle: (handle: Handle) => void;
  lastResult?: AssessmentLastResult | null;
  /**
   * "bare" strips the outer Hero surface so AssessmentExecution can compose
   * this directly beneath its own protocol/progress header, inside one
   * combined Hero — "current phase, target and handle" are one continuous
   * mental unit during execution, not two stacked cards (compositional
   * redesign — see docs/MOBILE_UX_AND_DESIGN_PRINCIPLES.md §18).
   */
  variant?: "hero" | "bare";
};

const CATEGORY_LABELS: Record<TargetErrorCategory, string> = {
  on_target: "On Target",
  acceptable: "Acceptable",
  major_miss: "Major Miss",
};

/**
 * Current planned shot's target/handle, with a toggle for the handle
 * actually executed (defaults to Expected Handle — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 18) and the
 * most recent result, if any. Target and handle are shown as text, not
 * color alone.
 */
export default function AssessmentCurrentShot({
  phase,
  blockName,
  targetTime,
  expectedHandle,
  executedHandle,
  onChangeExecutedHandle,
  lastResult,
  variant = "hero",
}: AssessmentCurrentShotProps) {
  return (
    <div className={variant === "hero" ? surfaceClass("hero") : ""}>
      {variant === "hero" && (
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {phase === "warmup" ? "Warm-up" : blockName ?? "Scored"}
        </p>
      )}

      <div className={variant === "hero" ? "mt-2 flex items-baseline gap-3" : "flex items-baseline gap-3"}>
        <p className="text-3xl font-semibold text-slate-900">{targetTime.toFixed(2)}s</p>
        <p className="text-sm text-slate-500">Target</p>
      </div>

      <p className="mt-1 text-sm text-slate-600">
        Expected Handle: <span className="font-medium text-slate-900">{expectedHandle === "in" ? "In" : "Out"}</span>
      </p>

      <div className="mt-3">
        <p className="text-xs font-medium text-slate-700">Executed Handle</p>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(["in", "out"] as Handle[]).map((handle) => (
            <button
              key={handle}
              type="button"
              onClick={() => onChangeExecutedHandle(handle)}
              className={`min-h-11 rounded-lg px-3 text-sm font-medium transition ${
                executedHandle === handle
                  ? "bg-slate-900 text-white"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {handle === "in" ? "In" : "Out"}
            </button>
          ))}
        </div>
        {executedHandle !== expectedHandle && (
          <p className="mt-1 text-xs text-amber-700">
            This differs from the expected handle. The attempt will still count.
          </p>
        )}
      </div>

      {lastResult && (
        <div className="mt-4 rounded-xl bg-slate-50 p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Last attempt
          </p>
          <p className="mt-1 text-sm text-slate-900">
            Actual {lastResult.actualTime.toFixed(2)}s · Difference{" "}
            {formatSigned(lastResult.difference)}s
            {lastResult.category && phase === "scored" && (
              <> · {CATEGORY_LABELS[lastResult.category]}</>
            )}
          </p>
          {lastResult.wrongHandle && (
            <p className="mt-1 text-xs text-amber-700">
              This attempt counts, but the executed handle differs from the planned handle.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
