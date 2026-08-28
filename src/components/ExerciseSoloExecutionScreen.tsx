"use client";

import { useState } from "react";
import type { Handle } from "../types";
import {
  abandonExerciseExecution,
  addShotmakingAttempt,
  completeExerciseExecution,
  updatePrivateAthleteNote,
} from "../lib/exercises/execution";
import { computeShotmakingResult } from "../lib/exercises/executionResult";
import type {
  ExerciseExecution,
  ShotmakingExclusionReason,
} from "../lib/exercises/executionTypes";
import { exerciseFocusLabel, measurementUnitLabel } from "../lib/exercises/presentation";
import ConfirmModal from "./ConfirmModal";
import ExerciseDiagramView from "./ExerciseDiagramView";
import { surfaceClass } from "./Surface";

type ExerciseSoloExecutionScreenProps = {
  execution: ExerciseExecution;
  writable: boolean;
  onReplace: (execution: ExerciseExecution) => boolean;
  onBackToLibrary: () => void;
  onStartNewSession: () => void;
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
}: ExerciseSoloExecutionScreenProps) {
  const [actualHandle, setActualHandle] = useState<Handle | null>(null);
  const [score, setScore] = useState<0 | 1 | 2 | 3 | 4 | null>(null);
  const [rotationCount, setRotationCount] = useState("");
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
  const rotationProtocol = execution.configuration.enabledMeasurementProtocols.find(
    (protocol) => protocol.metricType === "rotation-count"
  );
  const shotSummary = shotmaking ? computeShotmakingResult(result) : null;

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
      setError("Rotation Count must be a positive whole or half rotation, for example 2 or 2.5.");
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
    <div className="space-y-4">
      <div className={surfaceClass("primary")}>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
          <span>{exerciseFocusLabel(version.primaryFocus)}</span>
          <span aria-hidden="true">·</span>
          <span>Solo</span>
          <span aria-hidden="true">·</span>
          <span>{active ? "In progress" : execution.status === "completed" ? "Completed" : "Abandoned"}</span>
          <span aria-hidden="true">·</span>
          <span>
            {execution.configuration.sweeperCount === 0
              ? "No sweepers"
              : `${execution.configuration.sweeperCount} sweepers`}
          </span>
          <span aria-hidden="true">·</span>
          <span>{execution.configuration.sweepingUsed ? "Sweeping used" : "Sweeping not used"}</span>
        </div>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{version.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{version.goal}</p>
      </div>

      {active && (
        <section className={surfaceClass("hero")}>
          <h3 className="text-lg font-semibold text-slate-900">Current exercise</h3>
          <h4 className="mt-4 text-sm font-semibold text-slate-800">Setup</h4>
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {version.setupInstructions.map((instruction) => (
              <li key={instruction.id}>{instruction.text}</li>
            ))}
          </ol>
          <h4 className="mt-4 text-sm font-semibold text-slate-800">Perform</h4>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
            {version.executionInstructions.map((instruction) => (
              <li key={instruction.id}>{instruction.text}</li>
            ))}
          </ol>

          {version.guidance.kind === "observation" && (
            <div className="mt-4 rounded-xl bg-slate-100 p-4">
              <p className="text-sm font-semibold text-slate-800">Observe and discuss</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-600">
                {version.guidance.observations.map((observation) => (
                  <li key={observation}>{observation}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">{version.guidance.noScoringNote}</p>
            </div>
          )}
        </section>
      )}

      {active && version.diagram && (
        <section className={surfaceClass("primary")}>
          <h3 className="mb-3 text-lg font-semibold text-slate-900">Exercise diagram</h3>
          <ExerciseDiagramView diagram={version.diagram} />
        </section>
      )}

      {active && shotmaking && (
        <section className={surfaceClass("hero")}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Stone {result.attempts.length + 1}
          </p>
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
            <label className="mt-4 block text-sm font-medium text-slate-700">
              Rotation Count <span className="font-normal text-slate-500">(optional)</span>
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
          )}

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-slate-700">
              Self-assessed outcome
            </legend>
            <div className="mt-2 grid grid-cols-5 gap-2">
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
                  {value}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              0 = 0%, 1 = 25%, 2 = 50%, 3 = 75%, 4 = 100%. This is your own judgement,
              not a platform-standardised rubric.
            </p>
          </fieldset>

          <button
            type="button"
            onClick={recordScore}
            disabled={!writable || actualHandle === null || score === null}
            className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Record Stone
          </button>

          <button
            type="button"
            aria-expanded={showExclusion}
            onClick={() => setShowExclusion((shown) => !shown)}
            className="mt-3 min-h-11 w-full rounded-xl px-4 py-3 text-sm font-medium text-slate-600 underline hover:text-slate-800"
          >
            Do not score this stone
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

      {shotSummary && (
        <section className={surfaceClass(active ? "secondary" : "hero")}>
          <h3 className="text-lg font-semibold text-slate-900">
            {active ? "Live result" : "Exercise result"}
          </h3>
          {shotSummary.scoredStoneCount === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No scored stones yet.</p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs text-slate-500">Average</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {shotSummary.averagePercentage?.toFixed(0)}%
                </p>
              </div>
              <div className="rounded-xl bg-slate-100 p-3">
                <p className="text-xs text-slate-500">Points</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">
                  {shotSummary.points}/{shotSummary.maximumPoints}
                </p>
              </div>
            </div>
          )}
          <p className="mt-3 text-sm text-slate-600">
            {shotSummary.scoredStoneCount} scored · {shotSummary.excludedAttemptCount} excluded
          </p>
          {shotSummary.excludedAttemptCount > 0 && (
            <ul className="mt-2 text-xs text-slate-500">
              {Object.entries(shotSummary.excludedReasonCounts).map(([reason, count]) => (
                <li key={reason}>{exclusionLabel(reason as ShotmakingExclusionReason)}: {count}</li>
              ))}
            </ul>
          )}
          {shotSummary.scoredStoneCount > 0 && (
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
        </section>
      )}

      {!active && !shotmaking && (
        <section className={surfaceClass("hero")}>
          <h3 className="text-lg font-semibold text-slate-900">Exercise result</h3>
          <p className="mt-2 text-sm text-slate-600">
            {execution.status === "completed"
              ? "Completed without a score. Technique exercises remain observation-only."
              : "Abandoned without a score. Any private note remains available."}
          </p>
        </section>
      )}

      <section className={surfaceClass("primary")}>
        <label className="text-sm font-semibold text-slate-900" htmlFor="exercise-private-note">
          Private athlete note
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Only you can read or edit this note. It is not shared with a Team or coach.
        </p>
        <textarea
          id="exercise-private-note"
          value={result.privateNote ?? ""}
          onChange={(event) => updateNote(event.target.value)}
          disabled={!writable}
          rows={4}
          className="mt-3 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100"
          placeholder="Add your observation…"
        />
      </section>

      {error && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>
      )}

      {active ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={complete}
            disabled={!writable || (shotmaking && result.attempts.length === 0)}
            className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            Complete Exercise
          </button>
          <button
            type="button"
            onClick={() => setConfirmAbandon(true)}
            disabled={!writable}
            className="min-h-11 w-full rounded-xl px-4 py-3 text-sm font-medium text-red-700 underline disabled:opacity-50"
          >
            Abandon Exercise
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onBackToLibrary}
          className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
        >
          Back to Exercise Library
        </button>
      )}

      <button
        type="button"
        onClick={onStartNewSession}
        disabled={!writable}
        className="min-h-11 w-full rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Start New Session
      </button>

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
