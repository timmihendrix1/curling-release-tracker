"use client";

import InfoButton from "./InfoButton";
import { trainingPlanProgressionExplanation } from "../lib/helpContent";
import { surfaceClass } from "./Surface";

/**
 * The plan's own progression controls — one coherent set, rendered identically under
 * the Release Time runner and under a curated Exercise.
 *
 * Deliberately never gated on the planned stone count: **Next Exercise** is offered
 * whenever a next step exists and **Finish Training** throughout, including midway
 * through an exercise and with nothing recorded (docs/TRAINING_SYSTEM_AND_PLANS.md
 * section 31, ADR-0048). Shown alongside, never instead of, normal Shot Entry /
 * Auto Capture / Exercise recording — extra stones stay allowed in every state.
 */
type TrainingPlanStepTransitionProps = {
  /** Absent on the final step — the control is then structurally unavailable. */
  nextStepLabel?: string;
  onNextExercise: () => void;
  onFinishTraining: () => void;
  disabled?: boolean;
  errorMessage?: string | null;
  /**
   * Offered alongside `errorMessage` when the failure is one the athlete can simply
   * try again — today, a session save that storage refused. Absent when there is
   * nothing to retry, so a dead control is never shown.
   */
  onRetry?: (() => void) | null;
  retryLabel?: string;
};

export default function TrainingPlanStepTransition({
  nextStepLabel,
  onNextExercise,
  onFinishTraining,
  disabled = false,
  errorMessage,
  onRetry,
  retryLabel = "Try Saving Again",
}: TrainingPlanStepTransitionProps) {
  return (
    <section className={surfaceClass("primary")}>
      {/* The current step, its title and its planned-versus-actual volume are the
          TrainingPlanProgress readout's job — never repeated here. */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Training Plan
        </p>
        <InfoButton explanation={trainingPlanProgressionExplanation()} />
      </div>

      <p className="mt-1 text-sm text-slate-600">
        {nextStepLabel
          ? `Next: ${nextStepLabel}`
          : "This is the last planned exercise."}
      </p>

      {errorMessage && (
        <div role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p>{errorMessage}</p>

          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 min-h-11 w-full rounded-xl bg-red-700 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-800"
            >
              {retryLabel}
            </button>
          )}
        </div>
      )}

      {nextStepLabel && (
        <button
          type="button"
          onClick={onNextExercise}
          disabled={disabled}
          className="mt-3 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next Exercise
        </button>
      )}

      <button
        type="button"
        onClick={onFinishTraining}
        disabled={disabled}
        className={
          nextStepLabel
            ? "mt-2 min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
            : "mt-3 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        Finish Training
      </button>
    </section>
  );
}
