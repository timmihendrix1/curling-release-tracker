"use client";

import type { Session } from "../types";
import {
  countRecordedStones,
  getPlanStepSummaries,
  type PlanStepOutcome,
  type PlanStepSummary,
} from "../lib/trainingPlans/progress";
import TrainingHeader from "./TrainingHeader";
import { surfaceClass } from "./Surface";

/**
 * The factual close of a planned training (docs/TRAINING_SYSTEM_AND_PLANS.md section
 * 34). Renders the Session that was actually archived — never the empty replacement
 * Session the archive transition creates — and describes each step from that Session's
 * own recorded data.
 *
 * Deliberately observation-only: it states what was recorded against what was planned
 * and never interprets a lower volume as a shortfall, a failure or a diagnosis (see
 * docs/UX_WRITING_GUIDELINES.md "Separate facts from interpretation" and
 * docs/COACHING_PRINCIPLES.md).
 */
type TrainingPlanFinishSummaryProps = {
  /** The archived Session, or the discarded one when nothing was recorded. */
  session: Session;
  /** False only when the Session held no recorded work and so was not archived. */
  saved: boolean;
  onStartNewTraining: () => void;
};

const OUTCOME_LABELS: Record<PlanStepOutcome, string> = {
  completed: "Completed",
  "ended-early": "Ended early",
  "nothing-recorded": "Nothing recorded",
  "in-progress": "Still open",
  "not-started": "Not started",
};

function outcomeClass(outcome: PlanStepOutcome): string {
  return outcome === "completed"
    ? "bg-slate-900 text-white"
    : outcome === "not-started"
      ? "bg-slate-100 text-slate-500"
      : "bg-slate-100 text-slate-700";
}

function stepDetail(summary: PlanStepSummary): string {
  if (summary.outcome === "not-started") {
    return summary.plannedUnits !== undefined
      ? `Not reached · ${summary.plannedUnits} planned stone${summary.plannedUnits === 1 ? "" : "s"}`
      : "Not reached";
  }
  return summary.volumeLabel ?? summary.categoryLabel;
}

export default function TrainingPlanFinishSummary({
  session,
  saved,
  onStartNewTraining,
}: TrainingPlanFinishSummaryProps) {
  const planExecution = session.planExecution;
  const steps = planExecution ? getPlanStepSummaries(session, planExecution) : [];
  const exerciseCount = session.exerciseExecutions?.length ?? 0;
  // Counts stones across every supported execution type, not just the Release Time
  // Block/Shot runner — a training made entirely of Shotmaking stones must not be
  // reported as "0 stones recorded".
  const recordedStones = countRecordedStones(session);

  return (
    <div className="space-y-4">
      <TrainingHeader eyebrow="Training finished" title={planExecution?.sourcePlanName ?? session.title}>
        <p>{saved ? "Saved to history. All recorded work is kept." : "Nothing was recorded, so no training was saved to history."}</p>
        {saved && <p className="mt-4 text-white">
          <strong className="text-4xl font-medium tabular-nums">{recordedStones}</strong>{" "}
          stone{recordedStones === 1 ? "" : "s"} recorded
          {exerciseCount > 0 && <> · {exerciseCount} exercise{exerciseCount === 1 ? "" : "s"}</>}
        </p>}
      </TrainingHeader>

      {steps.length > 0 && (
        <section className={surfaceClass("primary")}>
          <h3 className="text-base font-semibold text-slate-900">Planned exercises</h3>

          <ul className="mt-3 space-y-2">
            {steps.map((summary) => (
              <li
                key={summary.stepNumber}
                className={surfaceClass("inset", "flex flex-wrap items-start justify-between gap-3")}
              >
                <div className="min-w-0 flex-1 basis-36">
                  <p className="text-sm font-medium text-slate-900">
                    {summary.stepNumber}. {summary.title}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">{stepDetail(summary)}</p>
                </div>

                <span
                  className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${outcomeClass(summary.outcome)}`}
                >
                  {OUTCOME_LABELS[summary.outcome]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button
        type="button"
        onClick={onStartNewTraining}
        className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
      >
        Start New Training
      </button>
    </div>
  );
}
