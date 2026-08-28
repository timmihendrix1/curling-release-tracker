"use client";

import { surfaceClass } from "./Surface";

/**
 * Two distinct, mutually exclusive states — never render "Continue to next
 * step" once the final step is reached (see ADR-0012's "final-step completion"
 * decision). Shown alongside, never instead of, normal Shot Entry/Auto Capture —
 * extra shots stay allowed in both states (spec section 31).
 */
type TrainingPlanStepTransitionProps =
  | {
      kind: "continue";
      completedStepLabel: string;
      nextStepLabel: string;
      onContinue: () => void;
    }
  | {
      kind: "plan-complete";
      totalSteps: number;
      onFinish: () => void;
    };

export default function TrainingPlanStepTransition(
  props: TrainingPlanStepTransitionProps
) {
  if (props.kind === "continue") {
    return (
      <div className={surfaceClass("primary")}>
        <p className="text-sm font-medium text-slate-900">
          Step complete — {props.completedStepLabel}
        </p>

        <p className="mt-1 text-sm text-slate-600">Next: {props.nextStepLabel}</p>

        <button
          type="button"
          onClick={props.onContinue}
          className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          Continue to Next Step
        </button>
      </div>
    );
  }

  return (
    <div className={surfaceClass("primary")}>
      <p className="text-sm font-medium text-slate-900">Plan complete</p>

      <p className="mt-1 text-sm text-slate-600">
        All {props.totalSteps} step{props.totalSteps === 1 ? "" : "s"} completed.
      </p>

      <p className="mt-1 text-xs text-slate-500">
        Finish the Training Session when you are ready.
      </p>

      <button
        type="button"
        onClick={props.onFinish}
        className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
      >
        Finish Training
      </button>
    </div>
  );
}
