import {
  calculateScoredProgress,
  calculateWarmupProgress,
  getCurrentBlock,
  isWarmupComplete,
} from "../lib/assessment/progress";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../lib/assessment/templates";
import type { AssessmentRun } from "../lib/assessment/types";

type AssessmentLandingProps = {
  currentRun: AssessmentRun | null;
  onViewAssessment: () => void;
  onResume: () => void;
  onStartNew: () => void;
};

const STATUS_LABELS: Record<AssessmentRun["status"], string> = {
  not_started: "Not started",
  warmup: "Warm-up",
  in_progress: "In progress",
  paused: "Paused",
  completed: "Completed",
  incomplete: "Incomplete",
};

function describeCurrentRunProgress(run: AssessmentRun): string {
  if (!isWarmupComplete(run)) {
    const warmup = calculateWarmupProgress(run);
    return `Warm-up ${warmup.completed} / ${warmup.total}`;
  }
  const scored = calculateScoredProgress(run);
  const block = getCurrentBlock(run);
  return block
    ? `${block.name} · ${scored.completed} / ${scored.total} overall`
    : `${scored.completed} / ${scored.total} overall`;
}

/**
 * Assess entry point — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 23. If an
 * active (non-terminal) run exists it is shown prominently with Resume,
 * never silently offered alongside a fresh "start" as if nothing were in
 * progress.
 */
export default function AssessmentLanding({
  currentRun,
  onViewAssessment,
  onResume,
  onStartNew,
}: AssessmentLandingProps) {
  const template = RELEASE_TIME_CORE_ASSESSMENT_V1;
  const hasActiveRun = currentRun && currentRun.status !== "completed" && currentRun.status !== "incomplete";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Assess</h1>
        <p className="mt-1 text-sm text-slate-600">
          Measure your current performance under consistent conditions.
        </p>
      </div>

      {hasActiveRun && currentRun && (
        <div className="rounded-2xl bg-amber-50 p-4 shadow-lg ring-1 ring-amber-200">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
            Active Assessment Run
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {STATUS_LABELS[currentRun.status]} · {describeCurrentRunProgress(currentRun)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Threshold: {currentRun.thresholdSnapshot.type === "custom"
              ? "Custom"
              : currentRun.thresholdSnapshot.type === "tight"
                ? "Tight"
                : "Standard"}{" "}
            (±{currentRun.thresholdSnapshot.values.onTarget.toFixed(2)}s / ±
            {currentRun.thresholdSnapshot.values.acceptable.toFixed(2)}s)
          </p>
          <button
            type="button"
            onClick={onResume}
            className="mt-3 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Resume Assessment
          </button>
        </div>
      )}

      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-lg font-semibold text-slate-900">{template.name}</h2>
        <p className="mt-1 text-sm text-slate-600">
          Measure delivery-speed reproduction, range and adaptation across both handles.
        </p>

        <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <li>{template.protocolMetadata.scoredShotCount} scored stones</li>
          <li>{template.protocolMetadata.warmupShotCount} warm-up stones</li>
          <li>{template.blocks.length} blocks</li>
          <li>Backline–Hog · Draw</li>
          <li className="col-span-2">
            Approximately {template.estimatedDurationMinutes.min}–
            {template.estimatedDurationMinutes.max} minutes
          </li>
        </ul>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onViewAssessment}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            View Assessment
          </button>

          {hasActiveRun && (
            <button
              type="button"
              onClick={onStartNew}
              className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
            >
              Start New Assessment
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Completed assessments will be available in Analyze in a later phase.
      </p>
    </div>
  );
}
