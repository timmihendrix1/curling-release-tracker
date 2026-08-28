"use client";

import { useState } from "react";
import type { Handle } from "../types";
import type { TeamExerciseEligibilitySnapshot } from "../lib/cloudSporting/syncStateRepository";
import { computeShotmakingResult } from "../lib/exercises/executionResult";
import type {
  ExerciseExecution,
  ExerciseMeasurement,
  ShotmakingExclusionReason,
} from "../lib/exercises/executionTypes";
import {
  addTeamShotmakingAttempt,
  annulTeamShotmakingAttempt,
  changeTeamRoleAssignment,
  completeTeamExerciseExecution,
  getTeamRotationRecommendation,
  getTeamAttemptRoleContext,
  listTeamAttemptsInRecordingOrder,
  type TeamRoleAssignmentInput,
} from "../lib/exercises/teamExecution";
import { measurementUnitLabel } from "../lib/exercises/presentation";
import ConfirmModal from "./ConfirmModal";
import ExerciseTeamAttemptCorrectionEditor from "./ExerciseTeamAttemptCorrectionEditor";
import ExerciseDiagramView from "./ExerciseDiagramView";
import { surfaceClass } from "./Surface";

type Props = {
  execution: ExerciseExecution;
  eligibilitySnapshot?: TeamExerciseEligibilitySnapshot;
  onSave(execution: ExerciseExecution): Promise<boolean>;
  onComplete(execution: ExerciseExecution): Promise<boolean>;
  onDiscard(executionId: string): Promise<boolean>;
};

const EXCLUSION_OPTIONS: readonly { value: ShotmakingExclusionReason; label: string }[] = [
  { value: "external-interruption", label: "External interruption" },
  { value: "incorrect-or-displaced-setup", label: "Incorrect or displaced setup" },
  { value: "technical-or-capture-problem", label: "Technical or capture problem" },
  { value: "outcome-not-observable", label: "Outcome not observable" },
  { value: "other", label: "Other" },
];

function exclusionLabel(reason: ShotmakingExclusionReason): string {
  return EXCLUSION_OPTIONS.find((option) => option.value === reason)?.label ?? reason;
}

export default function ExerciseTeamExecutionScreen({
  execution,
  eligibilitySnapshot,
  onSave,
  onComplete,
  onDiscard,
}: Props) {
  const [actualHandle, setActualHandle] = useState<Handle | null>(null);
  const [score, setScore] = useState<0 | 1 | 2 | 3 | 4 | null>(null);
  const [rotationCount, setRotationCount] = useState("");
  const [rotationObserverId, setRotationObserverId] = useState(
    execution.teamContext?.recorderProfileId ?? ""
  );
  const [showExclusion, setShowExclusion] = useState(false);
  const [exclusionReason, setExclusionReason] = useState<ShotmakingExclusionReason | "">("");
  const [exclusionExplanation, setExclusionExplanation] = useState("");
  const [manualDelivererId, setManualDelivererId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [editingAttemptId, setEditingAttemptId] = useState<string | null>(null);
  const [annulAttemptId, setAnnulAttemptId] = useState<string | null>(null);

  const version = execution.exerciseVersionSnapshot;
  const teamContext = execution.teamContext;
  const activeSegment = execution.roleAssignmentSegments.at(-1);
  if (!teamContext || !activeSegment) return null;
  const confirmedTeamContext = teamContext;
  const confirmedActiveSegment = activeSegment;
  const shotmaking = version.primaryFocus === "shotmaking";
  const rotationProtocol = execution.configuration.enabledMeasurementProtocols.find(
    (protocol) => protocol.metricType === "rotation-count"
  );
  const recommendation = getTeamRotationRecommendation(execution);
  const attempts = listTeamAttemptsInRecordingOrder(execution);
  const athleteIds = teamContext.rotation.athleteOrder;

  function measurementLabel(protocolId: string, protocolVersion: number, value: number): string {
    const protocol = execution.configuration.enabledMeasurementProtocols.find(
      (candidate) => candidate.id === protocolId && candidate.version === protocolVersion
    );
    return `${value} ${protocol ? measurementUnitLabel(protocol.unit) : "measurement"}`;
  }

  function label(profileId: string): string {
    const participant = eligibilitySnapshot?.participants.find(
      (candidate) => candidate.profileId === profileId
    );
    if (participant?.displayName) return participant.displayName;
    const athleteIndex = athleteIds.indexOf(profileId);
    if (athleteIndex >= 0) return `Training athlete ${athleteIndex + 1}`;
    return profileId === teamContext?.recorderProfileId ? "Recorder" : "Supporting participant";
  }

  async function save(next: ExerciseExecution): Promise<boolean> {
    setBusy(true);
    const saved = await onSave(next);
    setBusy(false);
    setError(saved ? null : "This change could not be saved. The previous Team draft is unchanged.");
    return saved;
  }

  function rotationMeasurement(): ExerciseMeasurement[] | null {
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
      source: "manual",
      recordedAt: new Date().toISOString(),
      ...(rotationObserverId ? { observerProfileId: rotationObserverId } : {}),
    }];
  }

  async function record(evaluation: Parameters<typeof addTeamShotmakingAttempt>[1]["evaluation"]) {
    if (actualHandle === null) return;
    const measurements = rotationMeasurement();
    if (measurements === null) return;
    const outcome = addTeamShotmakingAttempt(execution, {
      recorderProfileId: confirmedTeamContext.recorderProfileId,
      athleteProfileId: confirmedActiveSegment.deliveringAthleteProfileId,
      actualHandle,
      evaluation,
      measurements,
    });
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    if (await save(outcome.value)) {
      setActualHandle(null);
      setScore(null);
      setRotationCount("");
      setShowExclusion(false);
      setExclusionReason("");
      setExclusionExplanation("");
    }
  }

  function assignmentForDeliverer(nextDelivererId: string): TeamRoleAssignmentInput {
    const swappedSweepers = confirmedActiveSegment.sweeperProfileIds.map((profileId) =>
      profileId === nextDelivererId ? confirmedActiveSegment.deliveringAthleteProfileId : profileId
    );
    return {
      deliveringAthleteProfileId: nextDelivererId,
      sweeperProfileIds: [...new Set(swappedSweepers)].filter((profileId) => profileId !== nextDelivererId),
      ...(confirmedActiveSegment.skipProfileId ? { skipProfileId: confirmedActiveSegment.skipProfileId } : {}),
      ...(confirmedActiveSegment.observerProfileId ? { observerProfileId: confirmedActiveSegment.observerProfileId } : {}),
      ...(confirmedActiveSegment.coachProfileIds?.length ? { coachProfileIds: confirmedActiveSegment.coachProfileIds } : {}),
      ...(confirmedActiveSegment.timekeeperProfileId ? { timekeeperProfileId: confirmedActiveSegment.timekeeperProfileId } : {}),
      sweepingUsed: confirmedActiveSegment.sweepingUsed ?? false,
    };
  }

  async function changeDeliverer(
    nextDelivererId: string,
    reason: "manual" | "after-every-stone" | "after-stone-count" | "after-series"
  ) {
    const latestActivity = [
      ...execution.roleAssignmentSegments.map((segment) => segment.startedAt),
      ...execution.athleteResults.flatMap((result) => result.attempts.map((attempt) => attempt.createdAt)),
    ].reduce((latest, candidate) => Date.parse(candidate) > Date.parse(latest) ? candidate : latest);
    const outcome = changeTeamRoleAssignment(execution, {
      recorderProfileId: confirmedTeamContext.recorderProfileId,
      assignment: assignmentForDeliverer(nextDelivererId),
      reason,
      clock: {
        id: () => crypto.randomUUID(),
        now: () => new Date(Math.max(Date.now(), Date.parse(latestActivity) + 1)).toISOString(),
      },
    });
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    if (await save(outcome.value)) setManualDelivererId("");
  }

  function nextPlannedAthlete(): string {
    const currentIndex = athleteIds.indexOf(confirmedActiveSegment.deliveringAthleteProfileId);
    return athleteIds[(currentIndex + 1) % athleteIds.length];
  }

  async function complete() {
    const outcome = completeTeamExerciseExecution(execution, confirmedTeamContext.recorderProfileId);
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    setBusy(true);
    const completed = await onComplete(outcome.value);
    setBusy(false);
    setError(completed ? null : "The Team exercise could not be completed. The active draft remains saved.");
  }

  async function discard() {
    setBusy(true);
    const discarded = await onDiscard(execution.id);
    setBusy(false);
    setConfirmDiscard(false);
    setError(discarded ? null : "The active Team draft could not be discarded.");
  }

  async function annulAttempt() {
    if (!annulAttemptId) return;
    const outcome = annulTeamShotmakingAttempt(
      execution,
      confirmedTeamContext.recorderProfileId,
      annulAttemptId
    );
    if (!outcome.ok) {
      setError(outcome.error.message);
      setAnnulAttemptId(null);
      return;
    }
    if (await save(outcome.value)) {
      setAnnulAttemptId(null);
      if (editingAttemptId === annulAttemptId) setEditingAttemptId(null);
    }
  }

  return (
    <div className="space-y-4">
      <section className={surfaceClass("hero")}>
        <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-slate-500">
          <span>Team</span><span aria-hidden="true">·</span><span>Local draft</span>
          <span aria-hidden="true">·</span><span>{eligibilitySnapshot?.teamName ?? "Team exercise"}</span>
        </div>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{version.title}</h2>
        <p className="mt-2 text-sm text-slate-600">{version.goal}</p>
        <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-800">
          Saved on this device for the signed-in recorder. Cloud authority is checked again after completion.
        </p>
      </section>

      <section className={surfaceClass("primary")}>
        <h3 className="text-lg font-semibold text-slate-900">Current lineup</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-slate-500">Delivering</dt><dd className="font-medium text-slate-800">{label(activeSegment.deliveringAthleteProfileId)}</dd></div>
          <div><dt className="text-xs text-slate-500">Sweepers</dt><dd className="font-medium text-slate-800">{activeSegment.sweeperProfileIds.length === 0 ? "None" : activeSegment.sweeperProfileIds.map(label).join(", ")}</dd></div>
          <div><dt className="text-xs text-slate-500">Sweeping</dt><dd className="font-medium text-slate-800">{activeSegment.sweepingUsed ? "Used" : "Not used"}</dd></div>
          <div><dt className="text-xs text-slate-500">Recorded by</dt><dd className="font-medium text-slate-800">{label(teamContext.recorderProfileId)}</dd></div>
        </dl>

        {recommendation && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3">
            <p className="text-sm text-amber-900">Planned rotation: {label(recommendation.nextAthleteProfileId)} delivers next.</p>
            <button type="button" disabled={busy} onClick={() => void changeDeliverer(recommendation.nextAthleteProfileId, recommendation.reason)} className="mt-2 min-h-11 w-full rounded-xl bg-amber-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              Apply Planned Rotation
            </button>
          </div>
        )}

        {teamContext.rotation.kind === "after-series" && athleteIds.length > 1 && (
          <button type="button" disabled={busy} onClick={() => void changeDeliverer(nextPlannedAthlete(), "after-series")} className="mt-4 min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
            Series Complete — Rotate Athlete
          </button>
        )}

        {athleteIds.length > 1 && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            <label className="text-sm font-medium text-slate-700">
              Manual delivering-athlete change
              <select value={manualDelivererId} onChange={(event) => setManualDelivererId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">Choose another athlete</option>
                {athleteIds.filter((profileId) => profileId !== activeSegment.deliveringAthleteProfileId).map((profileId) => <option key={profileId} value={profileId}>{label(profileId)}</option>)}
              </select>
            </label>
            <button type="button" disabled={busy || !manualDelivererId} onClick={() => void changeDeliverer(manualDelivererId, "manual")} className="mt-3 min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">
              Record Role Change
            </button>
          </div>
        )}
      </section>

      <section className={surfaceClass("primary")}>
        <h3 className="text-lg font-semibold text-slate-900">Instructions</h3>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {version.executionInstructions.map((instruction) => <li key={instruction.id}>{instruction.text}</li>)}
        </ol>
        {version.guidance.kind === "observation" && (
          <div className="mt-4 rounded-xl bg-slate-100 p-4">
            <p className="text-sm font-semibold text-slate-800">Observe and discuss</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-600">
              {version.guidance.observations.map((observation) => <li key={observation}>{observation}</li>)}
            </ul>
            <p className="mt-2 text-xs text-slate-500">{version.guidance.noScoringNote}</p>
          </div>
        )}
      </section>

      {version.diagram && (
        <section className={surfaceClass("primary")}>
          <h3 className="mb-3 text-lg font-semibold text-slate-900">Exercise diagram</h3>
          <ExerciseDiagramView diagram={version.diagram} />
        </section>
      )}

      {shotmaking && (
        <section className={surfaceClass("hero")}>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {label(activeSegment.deliveringAthleteProfileId)} · Stone {(execution.athleteResults.find((result) => result.athleteProfileId === activeSegment.deliveringAthleteProfileId)?.attempts.length ?? 0) + 1}
          </p>
          <h3 className="mt-1 text-lg font-semibold text-slate-900">Record outcome</h3>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-slate-700">Actual handle</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["in", "out"] as const).map((handle) => (
                <button key={handle} type="button" aria-pressed={actualHandle === handle} onClick={() => setActualHandle(handle)} className={`min-h-11 rounded-xl px-4 py-3 text-sm font-semibold ${actualHandle === handle ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
                  {handle === "in" ? "Inhandle" : "Outhandle"}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-slate-700">Team-assessed outcome</legend>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {([0, 1, 2, 3, 4] as const).map((value) => (
                <button key={value} type="button" aria-label={`${value} points, ${value * 25} percent`} aria-pressed={score === value} onClick={() => { setScore(value); setShowExclusion(false); }} className={`min-h-11 rounded-xl px-2 py-3 text-sm font-semibold ${score === value ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700"}`}>
                  {value}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">0 = 0%, 1 = 25%, 2 = 50%, 3 = 75%, 4 = 100%. The Team applies its own judgement.</p>
          </fieldset>

          {rotationProtocol && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">
                Rotation Count <span className="font-normal text-slate-500">(optional)</span>
                <input type="number" min="0.5" step="0.5" inputMode="decimal" value={rotationCount} onChange={(event) => setRotationCount(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" placeholder="e.g. 2.5" />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Counted by
                <select value={rotationObserverId} onChange={(event) => setRotationObserverId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                  {teamContext.participantRoster.map((participant) => <option key={participant.profileId} value={participant.profileId}>{label(participant.profileId)}</option>)}
                </select>
              </label>
            </div>
          )}

          <button type="button" disabled={busy || actualHandle === null || score === null} onClick={() => score !== null && void record({ status: "scored", score })} className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
            Record Stone
          </button>
          <button type="button" aria-expanded={showExclusion} onClick={() => setShowExclusion((value) => !value)} className="mt-3 min-h-11 w-full px-4 py-3 text-sm font-medium text-slate-600 underline">
            Do not score this stone
          </button>

          {showExclusion && (
            <div className="mt-3 rounded-xl bg-slate-100 p-4">
              <label className="text-sm font-medium text-slate-700">Reason
                <select value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value as ShotmakingExclusionReason | "")} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
                  <option value="">Choose a reason</option>
                  {EXCLUSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              {exclusionReason === "other" && (
                <label className="mt-3 block text-sm font-medium text-slate-700">Explanation
                  <input value={exclusionExplanation} onChange={(event) => setExclusionExplanation(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" />
                </label>
              )}
              <button type="button" disabled={busy || actualHandle === null || exclusionReason === "" || (exclusionReason === "other" && !exclusionExplanation.trim())} onClick={() => exclusionReason && void record({ status: "excluded", reason: exclusionReason, ...(exclusionExplanation.trim() ? { explanation: exclusionExplanation.trim() } : {}) })} className="mt-4 min-h-11 w-full rounded-xl bg-slate-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
                Record Excluded Stone
              </button>
            </div>
          )}
        </section>
      )}

      {shotmaking && (
        <section className={surfaceClass("secondary")}>
          <h3 className="text-lg font-semibold text-slate-900">Live athlete results</h3>
          <div className="mt-3 space-y-3">
            {execution.athleteResults.map((result) => {
              const summary = computeShotmakingResult(result);
              return (
                <div key={result.id} className="rounded-xl bg-slate-100 p-3">
                  <p className="font-medium text-slate-800">{label(result.athleteProfileId)}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {summary.scoredStoneCount === 0 ? "No scored stones" : `${summary.averagePercentage?.toFixed(0)}% average · ${summary.points}/${summary.maximumPoints} points`}
                    {` · ${summary.excludedAttemptCount} excluded`}
                  </p>
                </div>
              );
            })}
          </div>
          {attempts.length > 0 && (
            <ol className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
              {attempts.map((attempt, index) => (
                <li key={attempt.id} className="rounded-lg bg-slate-100 px-3 py-2">
                  <span className="font-medium text-slate-800">Stone {index + 1} · {label(attempt.athleteProfileId)}</span>
                  {attempt.kind === "shotmaking" && (
                    <span>{` · ${attempt.actualHandle === "in" ? "Inhandle" : "Outhandle"}${attempt.evaluation.status === "scored" ? ` · ${attempt.evaluation.score}/4` : ` · Excluded: ${exclusionLabel(attempt.evaluation.reason)}`}`}</span>
                  )}
                  {attempt.measurements.map((measurement) => <span key={measurement.id}>{` · ${measurementLabel(measurement.protocolId, measurement.protocolVersion, measurement.value)}`}</span>)}
                  {attempt.kind === "shotmaking" && (() => {
                    const role = getTeamAttemptRoleContext(execution, attempt);
                    if (!role) return null;
                    return <span>{` · ${role.sweeperProfileIds.length} Sweeper${role.sweeperProfileIds.length === 1 ? "" : "s"}${role.sweepingUsed ? " · Sweeping used" : " · No sweeping"}${role.skipProfileId ? " · Skip" : ""}`}</span>;
                  })()}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <button type="button" disabled={busy} onClick={() => setEditingAttemptId((current) => current === attempt.id ? null : attempt.id)} className="min-h-11 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50">{editingAttemptId === attempt.id ? "Close Correction" : "Correct Stone"}</button>
                    <button type="button" disabled={busy} onClick={() => setAnnulAttemptId(attempt.id)} className="min-h-11 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50">Recorded by Mistake</button>
                  </div>
                  {attempt.kind === "shotmaking" && editingAttemptId === attempt.id && (
                    <ExerciseTeamAttemptCorrectionEditor
                      execution={execution}
                      attempt={attempt}
                      eligibilitySnapshot={eligibilitySnapshot}
                      onSave={save}
                      onCancel={() => setEditingAttemptId(null)}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <button type="button" disabled={busy || (shotmaking && attempts.length === 0)} onClick={() => void complete()} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
        Complete Team Exercise
      </button>
      <button type="button" disabled={busy} onClick={() => setConfirmDiscard(true)} className="min-h-11 w-full rounded-xl px-4 py-3 text-sm font-medium text-red-700 underline disabled:opacity-50">
        Discard Local Draft
      </button>

      {confirmDiscard && (
        <ConfirmModal
          title="Discard Team Exercise Draft?"
          message="This removes the in-progress Team exercise from this device. It has not been uploaded and cannot be recovered."
          confirmLabel="Discard Draft"
          isDanger
          onConfirm={() => void discard()}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
      {annulAttemptId && (
        <ConfirmModal
          title="Mark Stone as Recorded by Mistake?"
          message="The stone will stop counting toward current results. Its original values, recorder and annulment time remain in the athlete's correction history."
          confirmLabel="Annul Recorded Stone"
          isDanger
          onConfirm={() => void annulAttempt()}
          onCancel={() => setAnnulAttemptId(null)}
        />
      )}
    </div>
  );
}
