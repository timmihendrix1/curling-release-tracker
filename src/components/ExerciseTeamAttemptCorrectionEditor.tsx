"use client";

import { useState } from "react";
import type { Handle } from "../types";
import type { TeamExerciseEligibilitySnapshot } from "../lib/cloudSporting/syncStateRepository";
import type {
  ExerciseExecution,
  ExerciseMeasurement,
  ExerciseTeamAttemptRoleContext,
  ExerciseTeamContext,
  ShotmakingExclusionReason,
  ShotmakingExerciseAttempt,
} from "../lib/exercises/executionTypes";
import {
  correctTeamShotmakingAttempt,
  getTeamAttemptRoleContext,
} from "../lib/exercises/teamExecution";

type Props = {
  execution: ExerciseExecution;
  attempt: ShotmakingExerciseAttempt;
  eligibilitySnapshot?: TeamExerciseEligibilitySnapshot;
  onSave(execution: ExerciseExecution): Promise<boolean>;
  onCancel(): void;
};

const EXCLUSION_OPTIONS: readonly { value: ShotmakingExclusionReason; label: string }[] = [
  { value: "external-interruption", label: "External interruption" },
  { value: "incorrect-or-displaced-setup", label: "Incorrect or displaced setup" },
  { value: "technical-or-capture-problem", label: "Technical or capture problem" },
  { value: "outcome-not-observable", label: "Outcome not observable" },
  { value: "other", label: "Other" },
];

function CorrectionEditor({
  execution,
  attempt,
  eligibilitySnapshot,
  onSave,
  onCancel,
  context,
  initialRole,
}: Props & {
  context: ExerciseTeamContext;
  initialRole: ExerciseTeamAttemptRoleContext;
}) {
  const rotationProtocol = execution.configuration.enabledMeasurementProtocols.find(
    (protocol) => protocol.metricType === "rotation-count"
  );
  const initialRotation = rotationProtocol
    ? attempt.measurements.find((measurement) =>
        measurement.protocolId === rotationProtocol.id &&
        measurement.protocolVersion === rotationProtocol.version
      )
    : undefined;
  const athleteIds = context.participantRoster
    .filter((participant) => participant.participation === "training-athlete")
    .map((participant) => participant.profileId);
  const participantIds = context.participantRoster.map((participant) => participant.profileId);
  const [athleteProfileId, setAthleteProfileId] = useState(attempt.athleteProfileId);
  const [actualHandle, setActualHandle] = useState<Handle>(attempt.actualHandle);
  const [outcomeKind, setOutcomeKind] = useState<"scored" | "excluded">(attempt.evaluation.status);
  const [score, setScore] = useState<0 | 1 | 2 | 3 | 4>(
    attempt.evaluation.status === "scored" ? attempt.evaluation.score : 0
  );
  const [exclusionReason, setExclusionReason] = useState<ShotmakingExclusionReason>(
    attempt.evaluation.status === "excluded" ? attempt.evaluation.reason : "external-interruption"
  );
  const [exclusionExplanation, setExclusionExplanation] = useState(
    attempt.evaluation.status === "excluded" ? attempt.evaluation.explanation ?? "" : ""
  );
  const [rotationCount, setRotationCount] = useState(initialRotation ? String(initialRotation.value) : "");
  const [rotationObserverId, setRotationObserverId] = useState(
    initialRotation?.observerProfileId ?? context.recorderProfileId
  );
  const [sweeperProfileIds, setSweeperProfileIds] = useState([...initialRole.sweeperProfileIds]);
  const [sweepingUsed, setSweepingUsed] = useState(initialRole.sweepingUsed);
  const [skipProfileId, setSkipProfileId] = useState(initialRole.skipProfileId ?? "");
  const [observerProfileId, setObserverProfileId] = useState(initialRole.observerProfileId ?? "");
  const [coachProfileIds, setCoachProfileIds] = useState([...(initialRole.coachProfileIds ?? [])]);
  const [timekeeperProfileId, setTimekeeperProfileId] = useState(initialRole.timekeeperProfileId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function label(profileId: string): string {
    return eligibilitySnapshot?.participants.find((participant) => participant.profileId === profileId)?.displayName ??
      (athleteIds.includes(profileId) ? `Training athlete ${athleteIds.indexOf(profileId) + 1}` : "Supporting participant");
  }

  function toggle(list: string[], profileId: string, maximum?: number): string[] {
    if (list.includes(profileId)) return list.filter((candidate) => candidate !== profileId);
    if (maximum !== undefined && list.length >= maximum) return list;
    return [...list, profileId];
  }

  async function save() {
    const value = Number(rotationCount);
    if (rotationCount.trim() !== "" &&
        (!rotationProtocol || !Number.isFinite(value) || value <= 0 || !Number.isInteger(value * 2))) {
      setError("Rotation Count must be a positive whole or half rotation, for example 2 or 2.5.");
      return;
    }
    if (outcomeKind === "excluded" && exclusionReason === "other" && !exclusionExplanation.trim()) {
      setError("Other needs a short explanation.");
      return;
    }
    const measurements: ExerciseMeasurement[] = attempt.measurements.filter((measurement) =>
      !rotationProtocol || measurement.protocolId !== rotationProtocol.id ||
      measurement.protocolVersion !== rotationProtocol.version
    );
    if (rotationCount.trim() !== "" && rotationProtocol) {
      measurements.push({
        id: initialRotation?.id ?? crypto.randomUUID(),
        protocolId: rotationProtocol.id,
        protocolVersion: rotationProtocol.version,
        value,
        source: "manual",
        recordedAt: initialRotation?.recordedAt ?? attempt.createdAt,
        observerProfileId: rotationObserverId,
      });
    }
    const outcome = correctTeamShotmakingAttempt(execution, {
      recorderProfileId: context.recorderProfileId,
      attemptId: attempt.id,
      athleteProfileId,
      actualHandle,
      evaluation: outcomeKind === "scored"
        ? { status: "scored", score }
        : {
            status: "excluded",
            reason: exclusionReason,
            ...(exclusionExplanation.trim() ? { explanation: exclusionExplanation.trim() } : {}),
          },
      measurements,
      roleContext: {
        deliveringAthleteProfileId: athleteProfileId,
        sweeperProfileIds,
        ...(skipProfileId ? { skipProfileId } : {}),
        ...(observerProfileId ? { observerProfileId } : {}),
        ...(coachProfileIds.length ? { coachProfileIds } : {}),
        ...(timekeeperProfileId ? { timekeeperProfileId } : {}),
        sweepingUsed,
      },
    });
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    setBusy(true);
    const saved = await onSave(outcome.value);
    setBusy(false);
    if (saved) onCancel();
    else setError("This correction could not be saved. The previous Team draft is unchanged.");
  }

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h4 className="font-semibold text-amber-950">Correct recorded stone</h4>
      <p className="mt-1 text-xs text-amber-800">The previous and resulting values, recorder and time remain in the audit history.</p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Delivering athlete
          <select value={athleteProfileId} onChange={(event) => setAthleteProfileId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
            {athleteIds.map((profileId) => <option key={profileId} value={profileId}>{label(profileId)}</option>)}
          </select>
        </label>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Actual handle</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["in", "out"] as const).map((handle) => <button key={handle} type="button" aria-pressed={actualHandle === handle} onClick={() => setActualHandle(handle)} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${actualHandle === handle ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>{handle === "in" ? "Inhandle" : "Outhandle"}</button>)}
          </div>
        </fieldset>
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Outcome</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" aria-pressed={outcomeKind === "scored"} onClick={() => setOutcomeKind("scored")} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${outcomeKind === "scored" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>Scored</button>
          <button type="button" aria-pressed={outcomeKind === "excluded"} onClick={() => setOutcomeKind("excluded")} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${outcomeKind === "excluded" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>Excluded</button>
        </div>
      </fieldset>
      {outcomeKind === "scored" ? (
        <label className="mt-3 block text-sm font-medium text-slate-700">Score
          <select value={score} onChange={(event) => setScore(Number(event.target.value) as 0 | 1 | 2 | 3 | 4)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
            {[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}/4 · {value * 25}%</option>)}
          </select>
        </label>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-700">Exclusion reason
            <select value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value as ShotmakingExclusionReason)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
              {EXCLUSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          {exclusionReason === "other" && <label className="text-sm font-medium text-slate-700">Explanation<input value={exclusionExplanation} onChange={(event) => setExclusionExplanation(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>}
        </div>
      )}

      {rotationProtocol && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">Rotation Count <span className="font-normal">(optional)</span><input type="number" min="0.5" step="0.5" value={rotationCount} onChange={(event) => setRotationCount(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>
        <label className="text-sm font-medium text-slate-700">Counted by<select value={rotationObserverId} onChange={(event) => setRotationObserverId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">{participantIds.map((profileId) => <option key={profileId} value={profileId}>{label(profileId)}</option>)}</select></label>
      </div>}

      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Sweepers for this stone</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{participantIds.map((profileId) => <label key={profileId} className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm"><input type="checkbox" checked={sweeperProfileIds.includes(profileId)} onChange={() => setSweeperProfileIds((current) => toggle(current, profileId, 2))} />{label(profileId)}</label>)}</div>
      </fieldset>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={sweepingUsed} onChange={(event) => setSweepingUsed(event.target.checked)} />Sweeping was used</label>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {([
          ["Skip", skipProfileId, setSkipProfileId],
          ["Observer", observerProfileId, setObserverProfileId],
          ["Timekeeper", timekeeperProfileId, setTimekeeperProfileId],
        ] as const).map(([name, value, setter]) => <label key={name} className="text-sm font-medium text-slate-700">{name}<select value={value} onChange={(event) => setter(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="">None</option>{participantIds.map((profileId) => <option key={profileId} value={profileId}>{label(profileId)}</option>)}</select></label>)}
      </div>
      <fieldset className="mt-4">
        <legend className="text-sm font-medium text-slate-700">Coaches for this stone</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">{participantIds.map((profileId) => <label key={profileId} className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm"><input type="checkbox" checked={coachProfileIds.includes(profileId)} onChange={() => setCoachProfileIds((current) => toggle(current, profileId))} />{label(profileId)}</label>)}</div>
      </fieldset>

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-100 p-3 text-sm text-red-800">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className="min-h-11 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 rounded-xl bg-amber-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Save Correction</button>
      </div>
    </div>
  );
}

export default function ExerciseTeamAttemptCorrectionEditor(props: Props) {
  const context = props.execution.teamContext;
  const initialRole = getTeamAttemptRoleContext(props.execution, props.attempt);
  if (!context || !initialRole) return null;
  return <CorrectionEditor {...props} context={context} initialRole={initialRole} />;
}
