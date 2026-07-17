"use client";

import { useState } from "react";
import {
  buildAssessmentResultView,
  buildAssessmentTrendSeries,
  buildInvalidAttemptRows,
  buildShotDetailRows,
  compareAssessmentRuns,
  findLatestEligiblePreviousRun,
  findProtocolCompatibleRuns,
  resolveAnalysisThresholdSet,
  type AnalysisThresholdMode,
} from "../lib/assessment/result";
import { validateThresholdValues, type ThresholdValidationResult } from "../lib/assessment/thresholds";
import type { AssessmentRun } from "../lib/assessment/types";
import { ASSESSMENT_DELETE_RUN_EXPLANATION, ASSESSMENT_RESULT_RECORDED_TIMES_UNCHANGED_NOTE } from "../lib/assessmentResultContent";
import { exportAssessmentRunsToCsv } from "../lib/assessment/export";
import { parseReleaseTime } from "../lib/timeInput";
import { accuracyThresholdSetLabel } from "../lib/assessment/result";
import AssessmentBlockResults from "./AssessmentBlockResults";
import AssessmentCoreMetrics from "./AssessmentCoreMetrics";
import AssessmentHandleComparison from "./AssessmentHandleComparison";
import AssessmentProtocolIntegrity from "./AssessmentProtocolIntegrity";
import AssessmentResultSummary from "./AssessmentResultSummary";
import AssessmentRunComparison from "./AssessmentRunComparison";
import AssessmentShotDetails from "./AssessmentShotDetails";
import AssessmentTargetResults from "./AssessmentTargetResults";
import AssessmentThresholdControl from "./AssessmentThresholdControl";
import AssessmentTrendChart from "./AssessmentTrendChart";
import AssessmentVariableAdaptationResults from "./AssessmentVariableAdaptationResults";
import ConfirmModal from "./ConfirmModal";
import { surfaceClass } from "./Surface";

type AssessmentResultScreenProps = {
  run: AssessmentRun;
  /** Full archived history (completed + incomplete) — the candidate pool for comparison and trends. May include `run` itself. */
  history: AssessmentRun[];
  onBack: () => void;
  onDeleteRun: (runId: string) => void;
};

function useThresholdInputs(initial: { onTarget: string; acceptable: string }) {
  const [onTargetInput, setOnTargetInput] = useState(initial.onTarget);
  const [acceptableInput, setAcceptableInput] = useState(initial.acceptable);
  return { onTargetInput, setOnTargetInput, acceptableInput, setAcceptableInput };
}

/**
 * The full single-run Assessment Result Screen (Phase C) — composes the
 * derived views from src/lib/assessment/result.ts into the sections listed
 * in docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md's Phase C brief.
 * Purely a read view over a terminal (completed) AssessmentRun: it never
 * calls updateAssessmentState to mutate the run itself — only the caller-
 * supplied onDeleteRun removes it as a whole, from history.
 */
export default function AssessmentResultScreen({
  run,
  history,
  onBack,
  onDeleteRun,
}: AssessmentResultScreenProps) {
  const [analysisMode, setAnalysisMode] = useState<AnalysisThresholdMode>("original");
  const analysisCustom = useThresholdInputs({
    onTarget: run.thresholdSnapshot.values.onTarget.toFixed(2),
    acceptable: run.thresholdSnapshot.values.acceptable.toFixed(2),
  });

  const [comparisonMode, setComparisonMode] = useState<AnalysisThresholdMode>("standard");
  const comparisonCustom = useThresholdInputs({ onTarget: "0.10", acceptable: "0.20" });

  const [selectedComparisonRunId, setSelectedComparisonRunId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const analysisCustomValidation: ThresholdValidationResult | null =
    analysisMode === "custom"
      ? validateThresholdValues(
          parseReleaseTime(analysisCustom.onTargetInput) ?? NaN,
          parseReleaseTime(analysisCustom.acceptableInput) ?? NaN
        )
      : null;

  const analysisOutcome = resolveAnalysisThresholdSet(
    run,
    analysisMode,
    analysisMode === "custom"
      ? {
          onTarget: parseReleaseTime(analysisCustom.onTargetInput) ?? NaN,
          acceptable: parseReleaseTime(analysisCustom.acceptableInput) ?? NaN,
        }
      : undefined
  );
  // An invalid Custom entry never mutates or breaks the view — fall back to
  // the run's own Original Threshold Snapshot for display until it's valid.
  const activeThresholdSet = analysisOutcome.ok ? analysisOutcome.value : run.thresholdSnapshot;

  const result = buildAssessmentResultView(run, activeThresholdSet);
  const shotRows = buildShotDetailRows(run, activeThresholdSet.values);
  const invalidAttemptRows = buildInvalidAttemptRows(run);

  const completedRuns = history.filter((candidate) => candidate.status === "completed");
  const eligibleCandidates = findProtocolCompatibleRuns(completedRuns, run);
  const defaultComparisonRun = findLatestEligiblePreviousRun(completedRuns, run);
  const comparisonRun =
    (selectedComparisonRunId ? completedRuns.find((candidate) => candidate.id === selectedComparisonRunId) : undefined) ??
    defaultComparisonRun;

  const comparisonCustomValidation: ThresholdValidationResult | null =
    comparisonMode === "custom"
      ? validateThresholdValues(
          parseReleaseTime(comparisonCustom.onTargetInput) ?? NaN,
          parseReleaseTime(comparisonCustom.acceptableInput) ?? NaN
        )
      : null;

  const comparisonThresholdOutcome = resolveAnalysisThresholdSet(
    run,
    comparisonMode,
    comparisonMode === "custom"
      ? {
          onTarget: parseReleaseTime(comparisonCustom.onTargetInput) ?? NaN,
          acceptable: parseReleaseTime(comparisonCustom.acceptableInput) ?? NaN,
        }
      : undefined
  );
  const comparisonThresholdSet = comparisonThresholdOutcome.ok
    ? comparisonThresholdOutcome.value
    : run.thresholdSnapshot;

  const runTime = (candidate: AssessmentRun) => new Date(candidate.completedAt ?? candidate.createdAt).getTime();
  const comparisonResult = comparisonRun
    ? runTime(comparisonRun) <= runTime(run)
      ? compareAssessmentRuns(comparisonRun, run, comparisonThresholdSet)
      : compareAssessmentRuns(run, comparisonRun, comparisonThresholdSet)
    : null;

  const trendCandidates = [run, ...findProtocolCompatibleRuns(completedRuns, run)];
  const trendPoints = buildAssessmentTrendSeries(trendCandidates, comparisonThresholdSet, run.id);

  const protocolEligibilityNote =
    eligibleCandidates.length === 0
      ? completedRuns.length > 1
        ? "No other completed run currently shares this run's protocol for direct comparison."
        : undefined
      : "This run remains protocol-comparable with at least one other completed run.";

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="text-sm font-medium text-slate-500 underline hover:text-slate-700">
        ← Back
      </button>

      {/* The Analysis Threshold choice lives inside the Hero — it's how you
          read the ONE result, not a separate task (compositional redesign). */}
      <AssessmentResultSummary result={result}>
        <AssessmentThresholdControl
          mode={analysisMode}
          onChangeMode={setAnalysisMode}
          originalThresholdSet={run.thresholdSnapshot}
          customOnTargetInput={analysisCustom.onTargetInput}
          customAcceptableInput={analysisCustom.acceptableInput}
          onChangeCustomOnTargetInput={analysisCustom.setOnTargetInput}
          onChangeCustomAcceptableInput={analysisCustom.setAcceptableInput}
          customValidation={analysisCustomValidation}
        />
        <p className="mt-3 text-xs text-slate-500">{ASSESSMENT_RESULT_RECORDED_TIMES_UNCHANGED_NOTE}</p>
      </AssessmentResultSummary>

      <AssessmentCoreMetrics result={result} />

      {/* Every detailed breakdown is one shared "Grouped Row List" surface
          (DESIGN_SYSTEM.md §10.5), divided by section, instead of six
          separate cards of identical weight (compositional redesign — this
          is the audit's "six Hero-weight surfaces" problem, structurally
          resolved, not just restyled). */}
      <div className={surfaceClass("secondary")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Detailed Breakdown
        </p>

        <div className="mt-3">
          <AssessmentBlockResults variant="bare" blocks={result.blocks} />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <AssessmentTargetResults variant="bare" targets={result.targets} />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <AssessmentHandleComparison variant="bare" comparison={result.handles} />
        </div>

        {result.variableAdaptation && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <AssessmentVariableAdaptationResults variant="bare" result={result.variableAdaptation} />
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4">
          <AssessmentProtocolIntegrity
            variant="bare"
            summary={result.protocolIntegrity}
            eligibilityNote={protocolEligibilityNote}
          />
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <AssessmentShotDetails variant="bare" shots={shotRows} invalidAttempts={invalidAttemptRows} />
        </div>
      </div>

      {/* Comparison and its resulting numbers are one continuous action,
          not two stacked cards. */}
      <div className={surfaceClass("secondary")}>
        <h2 className="text-lg font-semibold text-slate-900">Compare With Another Run</h2>

        {eligibleCandidates.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            No other protocol-compatible completed run exists yet to compare against.
          </p>
        ) : (
          <label className="mt-2 block text-sm">
            <span className="text-xs font-medium text-slate-700">Compare against</span>
            <select
              aria-label="Comparison run"
              value={comparisonRun?.id ?? ""}
              onChange={(event) => setSelectedComparisonRunId(event.target.value || null)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {eligibleCandidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {new Date(candidate.completedAt ?? candidate.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="mt-4">
          <AssessmentThresholdControl
            mode={comparisonMode}
            onChangeMode={setComparisonMode}
            allowOriginal={false}
            customOnTargetInput={comparisonCustom.onTargetInput}
            customAcceptableInput={comparisonCustom.acceptableInput}
            onChangeCustomOnTargetInput={comparisonCustom.setOnTargetInput}
            onChangeCustomAcceptableInput={comparisonCustom.setAcceptableInput}
            customValidation={comparisonCustomValidation}
          />
        </div>

        {comparisonResult && (
          <AssessmentRunComparison
            variant="bare"
            comparison={comparisonResult}
            comparisonThresholdSet={comparisonThresholdSet}
          />
        )}
      </div>

      <AssessmentTrendChart
        points={trendPoints}
        comparisonThresholdLabel={`${accuracyThresholdSetLabel(comparisonThresholdSet)} (±${comparisonThresholdSet.values.onTarget.toFixed(2)}s / ±${comparisonThresholdSet.values.acceptable.toFixed(2)}s)`}
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={() => exportAssessmentRunsToCsv([run], `assessment_${run.id}.csv`)}
          className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          Export Assessment CSV
        </button>
        <button
          type="button"
          onClick={() => setDeleteConfirmOpen(true)}
          className="flex-1 rounded-xl bg-red-100 px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-200"
        >
          Delete Run
        </button>
      </div>

      {deleteConfirmOpen && (
        <ConfirmModal
          title="Delete Assessment Run"
          message={ASSESSMENT_DELETE_RUN_EXPLANATION}
          confirmLabel="Delete Run"
          isDanger
          onConfirm={() => {
            setDeleteConfirmOpen(false);
            onDeleteRun(run.id);
          }}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  );
}
