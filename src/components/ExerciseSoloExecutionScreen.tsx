"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import TrainingHeader from "./TrainingHeader";
import ExercisePrivateNote from "./ExercisePrivateNote";
import CompleteSessionAction from "./CompleteSessionAction";
import type { Handle } from "../types";
import {
  abandonExerciseExecution,
  addMeasurementAttempt,
  addShotmakingAttempt,
  completeExerciseExecution,
  updatePrivateAthleteNote,
} from "../lib/exercises/execution";
import {
  computeMeasurementSummaries,
  computeShotmakingResult,
} from "../lib/exercises/executionResult";
import type {
  ExerciseExecution,
  ShotmakingExclusionReason,
} from "../lib/exercises/executionTypes";
import { exerciseDiscoveryCategory } from "../lib/exercises/discovery";
import {
  exerciseDiscoveryCategoryLabel,
  measurementUnitLabel,
} from "../lib/exercises/presentation";
import ConfirmModal from "./ConfirmModal";
import ExerciseExecutionReference from "./ExerciseExecutionReference";
import type { ExerciseAssetResolver } from "../lib/exercises/exerciseAssets";

type ExerciseSoloExecutionScreenProps = {
  execution: ExerciseExecution;
  writable: boolean;
  onReplace: (execution: ExerciseExecution) => boolean;
  onBackToLibrary: () => void;
  onStartNewSession: () => void;
  withinTrainingPlan?: boolean;
  progressionActions?: ReactNode;
  sessionCompletionError?: string | null;
  onRetrySessionSave?: (() => void) | null;
  exerciseAssetResolver?: ExerciseAssetResolver;
};

const EXCLUSION_OPTIONS: readonly {
  value: ShotmakingExclusionReason;
  label: string;
}[] = [
  { value: "external-interruption", label: "External interruption" },
  { value: "incorrect-or-displaced-setup", label: "Incorrect or displaced setup" },
  { value: "technical-or-capture-problem", label: "Technical or capture problem" },
  { value: "outcome-not-observable", label: "Outcome not observable" },
  { value: "other", label: "Other" },
];

function exclusionLabel(reason: ShotmakingExclusionReason): string {
  return EXCLUSION_OPTIONS.find((option) => option.value === reason)?.label ?? reason;
}

export default function ExerciseSoloExecutionScreen({
  execution,
  writable,
  onReplace,
  onBackToLibrary,
  onStartNewSession,
  sessionCompletionError,
  onRetrySessionSave,
  withinTrainingPlan = false,
  progressionActions,
  exerciseAssetResolver,
}: ExerciseSoloExecutionScreenProps) {
  const recordingRef = useRef<HTMLDivElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const noteWasOpen = useRef(false);
  useEffect(() => {
    if (!noteOpen && noteWasOpen.current) {
      recordingRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")?.focus();
    }
    noteWasOpen.current = noteOpen;
  }, [noteOpen]);
  const [actualHandle, setActualHandle] = useState<Handle | null>(null);
  const [score, setScore] = useState<0 | 1 | 2 | 3 | 4 | null>(null);
  const [rotationCount, setRotationCount] = useState("");
  const [measurementValue, setMeasurementValue] = useState("");
  const [showExclusion, setShowExclusion] = useState(false);
  const [exclusionReason, setExclusionReason] =
    useState<ShotmakingExclusionReason | "">("");
  const [exclusionExplanation, setExclusionExplanation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  const version = execution.exerciseVersionSnapshot;
  const result = execution.athleteResults[0];
  const active = execution.status === "in-progress";
  const shotmaking = version.primaryFocus === "shotmaking";
  const measured = version.primaryFocus === "measured";
  const rotationProtocol = execution.configuration.enabledMeasurementProtocols.find(
    (protocol) => protocol.metricType === "rotation-count"
  );
  const shotSummary = shotmaking ? computeShotmakingResult(result) : null;
  const measurementSummaries = measured ? computeMeasurementSummaries(result) : [];
  const standaloneProtocol = measured
    ? execution.configuration.enabledMeasurementProtocols[0]
    : undefined;

  function measurementLabel(protocolId: string, protocolVersion: number, value: number): string {
    const protocol = execution.configuration.enabledMeasurementProtocols.find(
      (candidate) => candidate.id === protocolId && candidate.version === protocolVersion
    );
    return `${value} ${protocol ? measurementUnitLabel(protocol.unit) : "measurement"}`;
  }

  function replace(next: ExerciseExecution): boolean {
    if (!onReplace(next)) {
      setError("This exercise could not be saved. Your previous recorded state is unchanged.");
      return false;
    }
    setError(null);
    return true;
  }

  function recordScore() {
    if (actualHandle === null || score === null) return;
    const measurement = buildRotationMeasurement();
    if (measurement === null) return;
    const outcome = addShotmakingAttempt(execution, {
      athleteProfileId: result.athleteProfileId,
      actualHandle,
      evaluation: { status: "scored", score },
      measurements: measurement,
    });
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    if (replace(outcome.value)) {
      setActualHandle(null);
      setScore(null);
      setRotationCount("");
    }
  }

  function recordMeasurement() {
    if (!standaloneProtocol) return;
    const value = Number(measurementValue);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (standaloneProtocol.metricType === "rotation-count" &&
        !Number.isInteger(value * 2))
    ) {
      setError(
        standaloneProtocol.metricType === "rotation-count"
          ? `${standaloneProtocol.name} must be a positive whole or half rotation, for example 2 or 2.5.`
          : "Enter a positive measured value."
      );
      return;
    }
    const outcome = addMeasurementAttempt(execution, {
      athleteProfileId: result.athleteProfileId,
      ...(actualHandle ? { actualHandle } : {}),
      measurements: [{
        id: crypto.randomUUID(),
        protocolId: standaloneProtocol.id,
        protocolVersion: standaloneProtocol.version,
        value,
        source: "manual",
        recordedAt: new Date().toISOString(),
      }],
    });
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    if (replace(outcome.value)) {
      setMeasurementValue("");
      setActualHandle(null);
    }
  }

  function recordExclusion() {
    if (
      actualHandle === null ||
      exclusionReason === "" ||
      (exclusionReason === "other" && exclusionExplanation.trim().length === 0)
    ) return;
    const measurement = buildRotationMeasurement();
    if (measurement === null) return;
    const outcome = addShotmakingAttempt(execution, {
      athleteProfileId: result.athleteProfileId,
      actualHandle,
      evaluation: {
        status: "excluded",
        reason: exclusionReason,
        ...(exclusionExplanation.trim().length > 0
          ? { explanation: exclusionExplanation.trim() }
          : {}),
      },
      measurements: measurement,
    });
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    if (replace(outcome.value)) {
      setActualHandle(null);
      setShowExclusion(false);
      setExclusionReason("");
      setExclusionExplanation("");
      setRotationCount("");
    }
  }

  function buildRotationMeasurement() {
    if (rotationCount.trim() === "") return [];
    const value = Number(rotationCount);
    if (!rotationProtocol || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value * 2)) {
      setError("The value must be a positive whole or half rotation, for example 2 or 2.5.");
      return null;
    }
    return [{
      id: crypto.randomUUID(),
      protocolId: rotationProtocol.id,
      protocolVersion: rotationProtocol.version,
      value,
      source: "manual" as const,
      recordedAt: new Date().toISOString(),
    }];
  }

  function complete() {
    const outcome = completeExerciseExecution(execution);
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    replace(outcome.value);
  }

  function abandon() {
    const outcome = abandonExerciseExecution(execution);
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    setConfirmAbandon(false);
    replace(outcome.value);
  }

  function updateNote(note: string) {
    const outcome = updatePrivateAthleteNote(execution, result.athleteProfileId, note);
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    replace(outcome.value);
  }

  return (
    <div className="house-solo-execution space-y-4">
      {active ? (
        <header className="space-y-3">
          <p className="text-xs uppercase text-slate-500">{exerciseDiscoveryCategoryLabel(exerciseDiscoveryCategory(version))} · Solo</p>
          <h2 className="house-flow-title">{version.title}</h2>
          {shotmaking && !noteOpen && <p className="text-xs text-slate-500">Stone {result.attempts.length + 1}</p>}
        </header>
      ) : <TrainingHeader title={version.title} eyebrow={execution.status === "completed" ? "Exercise completed" : "Exercise abandoned"} />}
      <div ref={recordingRef} hidden={noteOpen} className="space-y-4">
      {active && version.primaryFocus === "technique" && version.guidance.kind === "observation" && (
        <section className="house-flow-recording">
          <h3 className="text-lg font-semibold text-slate-900">Observe and discuss</h3>
          <ul className="mt-3 list-disc space-y-1 pl-4 text-sm text-slate-700">
            {version.guidance.observations.map((observation) => (
              <li key={observation}>{observation}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">{version.guidance.noScoringNote}</p>
        </section>
      )}

      {active && shotmaking && (
        <section className="house-flow-recording">
          <h3 className="mt-1 text-lg font-semibold text-slate-900">Record outcome</h3>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-slate-700">Actual handle</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["in", "out"] as const).map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-pressed={actualHandle === handle}
                  onClick={() => setActualHandle(handle)}
                  className={`min-h-11 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    actualHandle === handle
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {handle === "in" ? "Inhandle" : "Outhandle"}
                </button>
              ))}
            </div>
          </fieldset>

          {rotationProtocol && (
            <details className="house-training-disclosure mt-4">
              <summary>Additional measurement</summary>
            <label className="block text-sm font-medium text-slate-700">
              {rotationProtocol.name} <span className="font-normal text-slate-500">(optional)</span>
              <input
                type="number"
                min="0.5"
                step="0.5"
                inputMode="decimal"
                value={rotationCount}
                onChange={(event) => setRotationCount(event.target.value)}
                className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                placeholder="e.g. 2.5"
              />
            </label>
            </details>
          )}

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-slate-700">
              Outcome
            </legend>
            <div className="house-score-picker mt-2 grid grid-cols-5 gap-2">
              {([0, 1, 2, 3, 4] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-label={`${value} points, ${value * 25} percent`}
                  aria-pressed={score === value}
                  onClick={() => {
                    setScore(value);
                    setShowExclusion(false);
                  }}
                  className={`min-h-11 rounded-xl px-2 py-3 text-sm font-semibold transition ${
                    score === value
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {value}<small aria-hidden="true">{value * 25}%</small>
                </button>
              ))}
            </div>

          </fieldset>

          <button
            type="button"
            onClick={recordScore}
            disabled={!writable || actualHandle === null || score === null}
            className="house-flow-primary mt-4"
          >
            Record Stone
          </button>

          <button
            type="button"
            aria-expanded={showExclusion}
            onClick={() => setShowExclusion((shown) => !shown)}
            className="house-flow-link mt-3 w-full"
          >
            Exclude this attempt
          </button>

          {showExclusion && (
            <div className="mt-3 rounded-xl bg-slate-100 p-4">
              <label className="block text-sm font-medium text-slate-700">
                Reason
                <select
                  value={exclusionReason}
                  onChange={(event) =>
                    setExclusionReason(event.target.value as ShotmakingExclusionReason | "")
                  }
                  className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="">Choose a reason</option>
                  {EXCLUSION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              {exclusionReason === "other" && (
                <label className="mt-3 block text-sm font-medium text-slate-700">
                  Explanation
                  <input
                    value={exclusionExplanation}
                    onChange={(event) => setExclusionExplanation(event.target.value)}
                    className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                  />
                </label>
              )}
              <button
                type="button"
                onClick={recordExclusion}
                disabled={
                  !writable ||
                  actualHandle === null ||
                  exclusionReason === "" ||
                  (exclusionReason === "other" && exclusionExplanation.trim().length === 0)
                }
                className="mt-4 min-h-11 w-full rounded-xl bg-slate-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Record Excluded Stone
              </button>
            </div>
          )}
        </section>
      )}

      {active && measured && standaloneProtocol && (
        <section className="house-flow-recording">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Observation {result.attempts.length + 1}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">
            Record measurement
          </h3>
          <label className="house-measured-field mt-4 block">
            {standaloneProtocol.name}
            <span className="ml-1 font-normal text-slate-500">
              ({measurementUnitLabel(standaloneProtocol.unit)})
            </span>
            <input
              type="number"
              min={standaloneProtocol.metricType === "rotation-count" ? "0.5" : "0.01"}
              step={standaloneProtocol.metricType === "rotation-count" ? "0.5" : "0.01"}
              inputMode="decimal"
              value={measurementValue}
              onChange={(event) => setMeasurementValue(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              placeholder={standaloneProtocol.metricType === "rotation-count" ? "e.g. 2.5" : undefined}
            />
          </label>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-slate-700">
              Actual handle <span className="font-normal text-slate-500">(optional)</span>
            </legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["in", "out"] as const).map((handle) => (
                <button
                  key={handle}
                  type="button"
                  aria-pressed={actualHandle === handle}
                  onClick={() => setActualHandle(
                    actualHandle === handle ? null : handle
                  )}
                  className={`min-h-11 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                    actualHandle === handle
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {handle === "in" ? "Inhandle" : "Outhandle"}
                </button>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            onClick={recordMeasurement}
            disabled={!writable || measurementValue.trim().length === 0}
            className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Record Measurement
          </button>
        </section>
      )}


      </div>
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!active && !withinTrainingPlan && <p className="text-sm text-slate-500">Your session stays open for another exercise.</p>}
      {shotSummary && (
        <section aria-label={active ? "Live result" : "Exercise result"}>
          {!active && <h3 className="sr-only">Exercise result</h3>}
          {active ? <div className="house-live-summary">
            <span>{shotSummary.scoredStoneCount} scored · {shotSummary.excludedAttemptCount} excluded</span>
            <span className="house-summary-value">{shotSummary.averagePercentage === null ? "—" : `${shotSummary.averagePercentage.toFixed(0)}% avg.`}</span>
          </div> : <div className="house-result-metrics">
            <div><strong>{shotSummary.scoredStoneCount}</strong><span>scored stones</span></div>
            <div><strong>{shotSummary.averagePercentage === null ? "—" : `${shotSummary.averagePercentage.toFixed(0)}%`}</strong><span>average</span></div>
          </div>}
        </section>
      )}
      {measured && <section aria-label={active ? "Live measurements" : "Exercise result"}>
        {!active && <h3 className="sr-only">Exercise result</h3>}
        {measurementSummaries.length === 0 ? <p className="text-sm text-slate-500">No measurements yet.</p> : measurementSummaries.map((summary) => (
          <div key={`${summary.protocolId}@${summary.protocolVersion}`} className="house-live-summary">
            <span>{summary.count} {summary.count === 1 ? "measurement" : "measurements"}</span>
            <span className="house-summary-value">Mean {measurementLabel(summary.protocolId, summary.protocolVersion, summary.mean)}</span>
          </div>
        ))}
      </section>}
      {!active && !shotmaking && !measured && <section>
        <h3 className="sr-only">Exercise result</h3>
        <p>{execution.status === "completed" ? "Completed without a score. Technique exercises remain observation-only." : "Abandoned without a score. Any private note remains available."}</p>
      </section>}
      {!shotmaking && !measured && <ExercisePrivateNote value={result.privateNote ?? ""}
        onChange={updateNote} disabled={!writable} prominent />}
      <div hidden={active && noteOpen} className="space-y-4">
      {active ? <button type="button" onClick={complete}
        disabled={!writable || ((shotmaking || measured) && result.attempts.length === 0)}
        className={shotmaking || measured ? "house-flow-secondary" : "house-flow-primary"}>Complete Exercise</button>
        : !withinTrainingPlan && <>
          <button type="button" onClick={onBackToLibrary} className="house-flow-primary">Back to Exercise Library</button>
        </>}
      {withinTrainingPlan && progressionActions}
      {!withinTrainingPlan && <CompleteSessionAction onComplete={onStartNewSession} disabled={!writable}
        subtle={active} errorMessage={sessionCompletionError} onRetry={onRetrySessionSave} />}
      </div>
      {(shotmaking || measured) && <ExercisePrivateNote value={result.privateNote ?? ""} onChange={updateNote} disabled={!writable}
        prominent={false} onOpenChange={setNoteOpen} onBackToRecording={active ? () => {
          const control = recordingRef.current?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)");
          control?.focus();
        } : undefined} />}
      {shotSummary && <details className="house-training-disclosure">
        <summary>Result details and stones</summary>
        <div>
          <p className="text-xs text-slate-500">This is your own judgement, not a platform-standardised rubric.</p>
          <p className="text-sm text-slate-500">{shotSummary.points}/{shotSummary.maximumPoints} points · {shotSummary.excludedAttemptCount} excluded</p>
          {shotSummary.scoredStoneCount === 0 && <p className="text-sm text-slate-500">No scored stones yet.</p>}
          {Object.entries(shotSummary.excludedReasonCounts).map(([reason, count]) => <p key={reason} className="text-xs text-slate-500">{exclusionLabel(reason as ShotmakingExclusionReason)}: {count}</p>)}
          {!active && shotSummary.scoredStoneCount > 0 && (
            <div className="mt-4 space-y-3 border-t border-slate-200 pt-4">
              <div>
                <h4 className="text-sm font-semibold text-slate-800">Score distribution</h4>
                <div className="mt-2 grid grid-cols-5 gap-2 text-center">
                  {([0, 1, 2, 3, 4] as const).map((value) => (
                    <div key={value} className="rounded-lg bg-slate-100 p-2">
                      <p className="text-xs text-slate-500">{value}</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {shotSummary.distribution[value]}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-800">Handle split</h4>
                <div className="mt-2 space-y-1 text-sm text-slate-600">
                  {shotSummary.handles
                    .filter((handle) => handle.scoredStoneCount > 0)
                    .map((handle) => (
                      <p key={handle.handle}>
                        {handle.handle === "in" ? "Inhandle" : "Outhandle"}: {handle.averagePercentage?.toFixed(0)}%
                        {" · "}{handle.scoredStoneCount} scored
                      </p>
                    ))}
                </div>
              </div>
            </div>
          )}
          {result.attempts.length > 0 && (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <h4 className="text-sm font-semibold text-slate-800">Attempt log</h4>
              <ol className="mt-2 space-y-2 text-sm text-slate-600">
                {result.attempts.map((attempt) => (
                  <li key={attempt.id} className="rounded-lg bg-slate-100 px-3 py-2">
                    <span className="font-medium text-slate-800">
                      Stone {attempt.sequenceNumber}
                    </span>
                    {attempt.kind === "shotmaking" && (
                      <span>
                        {" · "}{attempt.actualHandle === "in" ? "Inhandle" : "Outhandle"}
                        {attempt.evaluation.status === "scored"
                          ? ` · ${attempt.evaluation.score}/4 (${attempt.evaluation.score * 25}%)`
                          : ` · Excluded: ${exclusionLabel(attempt.evaluation.reason)}${
                              attempt.evaluation.explanation
                                ? ` — ${attempt.evaluation.explanation}`
                                : ""
                            }`}
                      </span>
                    )}
                    {attempt.measurements.map((measurement) => (
                      <span key={measurement.id}>{` · ${measurementLabel(measurement.protocolId, measurement.protocolVersion, measurement.value)}`}</span>
                    ))}
                  </li>
                ))}
              </ol>
            </div>
          )}

        </div>
      </details>}
      {measured && <details className="house-training-disclosure">
        <summary>Result details and stones</summary>
        <div>
          {measurementSummaries.map((summary) => <p key={`${summary.protocolId}@${summary.protocolVersion}`} className="text-sm">Range {measurementLabel(summary.protocolId, summary.protocolVersion, summary.minimum)}–{measurementLabel(summary.protocolId, summary.protocolVersion, summary.maximum)}</p>)}
          <ol className="space-y-2 text-sm">
            {result.attempts.map((attempt) => <li key={attempt.id}>
              Observation {attempt.sequenceNumber}
              {attempt.actualHandle && ` · ${attempt.actualHandle === "in" ? "Inhandle" : "Outhandle"}`}
              {attempt.measurements.map((measurement) => <span key={measurement.id}> · {measurementLabel(measurement.protocolId, measurement.protocolVersion, measurement.value)}</span>)}
            </li>)}
          </ol>
          <p className="text-xs text-slate-500">These are factual values only. No target, score or pass/fail result is applied.</p>
        </div>
      </details>}
      {active && (
        <ExerciseExecutionReference version={version} exerciseAssetResolver={exerciseAssetResolver}>
          <p className="text-xs text-slate-500">
            {execution.configuration.sweeperCount === 0 ? "No sweepers" : `${execution.configuration.sweeperCount} sweepers`}
            {" · "}{execution.configuration.sweepingUsed ? "Sweeping used" : "Sweeping not used"}
          </p>
        </ExerciseExecutionReference>
      )}

      {!withinTrainingPlan && active && (
        <details className="house-training-disclosure">
          <summary>Session options</summary>
          <div className="space-y-2">
            {active && (
              <button
                type="button"
                onClick={() => setConfirmAbandon(true)}
                disabled={!writable}
                className="min-h-11 w-full rounded-xl px-4 py-3 text-sm font-medium text-red-700 underline disabled:opacity-50"
              >
                Abandon Exercise
              </button>
            )}

          </div>
        </details>
      )}

      {confirmAbandon && (
        <ConfirmModal
          title="Abandon Exercise?"
          message="Recorded attempts and your private note will remain in this Training Session."
          confirmLabel="Abandon"
          isDanger
          onConfirm={abandon}
          onCancel={() => setConfirmAbandon(false)}
        />
      )}
    </div>
  );
}
