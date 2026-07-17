"use client";

import { useState } from "react";
import { computeCategoryMetrics, computeRawAssessmentMetrics } from "../lib/assessment/metrics";
import {
  getCompletedAssessmentRuns,
  getIncompleteAssessmentRuns,
  getLatestCompletedAssessmentRun,
  type AssessmentPersistedState,
} from "../lib/assessment/persistence";
import { countInvalidAttempts, countProtocolDeviations } from "../lib/assessment/progress";
import { accuracyThresholdSetLabel } from "../lib/assessment/result";
import { formatAssessmentPercent, formatAssessmentSeconds, formatAssessmentSignedSeconds } from "../lib/assessment/resultFormatting";
import { exportAssessmentRunsToCsv } from "../lib/assessment/export";
import type { AssessmentRun } from "../lib/assessment/types";
import { ASSESSMENT_DELETE_RUN_EXPLANATION } from "../lib/assessmentResultContent";
import AssessmentHistoryItem from "./AssessmentHistoryItem";
import ConfirmModal from "./ConfirmModal";
import { surfaceClass } from "./Surface";

type AssessmentAnalyzeProps = {
  assessmentState: AssessmentPersistedState;
  onViewResult: (runId: string) => void;
  onResumeCurrent: () => void;
  onGoToAssess: () => void;
  onDeleteRun: (runId: string) => void;
};

/**
 * Analyze → Assessments — the landing surface for completed/incomplete
 * Assessment Runs, distinct from Training's History list (see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md's Analyze Integration
 * section). Reads only `assessmentState`; never mixes Assessment Runs into
 * Training's session history.
 */
export default function AssessmentAnalyze({
  assessmentState,
  onViewResult,
  onResumeCurrent,
  onGoToAssess,
  onDeleteRun,
}: AssessmentAnalyzeProps) {
  const [pendingDeleteRunId, setPendingDeleteRunId] = useState<string | null>(null);

  const completedRuns = getCompletedAssessmentRuns(assessmentState);
  const incompleteRuns = getIncompleteAssessmentRuns(assessmentState);
  const latest = getLatestCompletedAssessmentRun(assessmentState);
  const activeCurrentRun: AssessmentRun | undefined =
    assessmentState.currentRun &&
    assessmentState.currentRun.status !== "completed" &&
    assessmentState.currentRun.status !== "incomplete"
      ? assessmentState.currentRun
      : undefined;

  const allArchivedRuns = [...completedRuns, ...incompleteRuns];

  if (completedRuns.length === 0 && incompleteRuns.length === 0 && !activeCurrentRun) {
    return (
      <div className={surfaceClass("hero")}>
        <h2 className="text-lg font-semibold text-slate-900">No completed assessments yet.</h2>
        <p className="mt-1 text-sm text-slate-600">
          Complete the Release Time Core Assessment to build your assessment history.
        </p>
        <button
          type="button"
          onClick={onGoToAssess}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Go to Assess
        </button>
      </div>
    );
  }

  const latestRaw = latest ? computeRawAssessmentMetrics(latest) : null;
  const latestCategory = latest ? computeCategoryMetrics(latest, latest.thresholdSnapshot.values) : null;

  return (
    <div className="space-y-4">
      {latest && latestRaw && latestCategory && (
        // This screen's one Hero (Epic 1).
        <div className={surfaceClass("hero")}>
          <h2 className="text-lg font-semibold text-slate-900">Latest Completed Assessment</h2>
          <p className="mt-1 text-sm text-slate-600">
            {latest.templateSnapshot.name} v{latest.templateVersion} ·{" "}
            {latest.completedAt ? new Date(latest.completedAt).toLocaleDateString() : ""} ·{" "}
            {latest.timingProviderSnapshot.measurementMode === "back-hog" ? "Backline–Hog" : "Hog–Hog"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Original Run Thresholds: {accuracyThresholdSetLabel(latest.thresholdSnapshot)} (±
            {latest.thresholdSnapshot.values.onTarget.toFixed(2)}s / ±{latest.thresholdSnapshot.values.acceptable.toFixed(2)}s)
          </p>

          <div className="mt-3 grid grid-cols-3 gap-3 text-center sm:grid-cols-6">
            <div>
              <p className="text-xs text-slate-500">MAE</p>
              <p className="text-sm font-semibold text-slate-900">{formatAssessmentSeconds(latestRaw.meanAbsoluteError)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Bias</p>
              <p className="text-sm font-semibold text-slate-900">{formatAssessmentSignedSeconds(latestRaw.bias)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Std. Dev.</p>
              <p className="text-sm font-semibold text-slate-900">{formatAssessmentSeconds(latestRaw.standardDeviation)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">On Target</p>
              <p className="text-sm font-semibold text-slate-900">{formatAssessmentPercent(latestCategory.onTargetRate)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Invalid</p>
              <p className="text-sm font-semibold text-slate-900">{countInvalidAttempts(latest)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Deviations</p>
              <p className="text-sm font-semibold text-slate-900">{countProtocolDeviations(latest)}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onViewResult(latest.id)}
            className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700 sm:w-auto"
          >
            View Results
          </button>
        </div>
      )}

      {activeCurrentRun && (
        <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-700">Active Assessment Run</p>
          <p className="mt-1 text-sm text-slate-700">This run is still in progress and not yet part of your history.</p>
          <button
            type="button"
            onClick={onResumeCurrent}
            className="mt-3 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Resume Assessment
          </button>
        </div>
      )}

      {/* History is clearly secondary — never equal to the Hero above (Epic 1). */}
      <div className={surfaceClass("secondary")}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Assessment History</h2>
          {allArchivedRuns.length > 0 && (
            <button
              type="button"
              onClick={() => exportAssessmentRunsToCsv(allArchivedRuns)}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
            >
              Export Assessment CSV
            </button>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Completed</h3>
          {completedRuns.length === 0 ? (
            <p className="text-sm text-slate-500">No completed assessments yet.</p>
          ) : (
            completedRuns.map((run) => (
              <AssessmentHistoryItem
                key={run.id}
                run={run}
                onView={() => onViewResult(run.id)}
                onDelete={() => setPendingDeleteRunId(run.id)}
              />
            ))
          )}
        </div>

        <div className="mt-6 space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Incomplete</h3>
          {incompleteRuns.length === 0 ? (
            <p className="text-sm text-slate-500">No incomplete assessments.</p>
          ) : (
            incompleteRuns.map((run) => (
              <AssessmentHistoryItem
                key={run.id}
                run={run}
                onView={() => onViewResult(run.id)}
                onDelete={() => setPendingDeleteRunId(run.id)}
              />
            ))
          )}
        </div>
      </div>

      {pendingDeleteRunId && (
        <ConfirmModal
          title="Delete Assessment Run"
          message={ASSESSMENT_DELETE_RUN_EXPLANATION}
          confirmLabel="Delete Run"
          isDanger
          onConfirm={() => {
            onDeleteRun(pendingDeleteRunId);
            setPendingDeleteRunId(null);
          }}
          onCancel={() => setPendingDeleteRunId(null)}
        />
      )}
    </div>
  );
}
