"use client";

import { useId, useState } from "react";
import type { TeamExerciseEligibilitySnapshot } from "../lib/cloudSporting/syncStateRepository";
import { EXERCISE_CATALOG } from "../lib/exercises/catalog";
import type {
  ExerciseExecution,
  ExerciseRotationConfiguration,
  ExerciseTeamParticipant,
} from "../lib/exercises/executionTypes";
import { resolveMeasurementProtocols } from "../lib/exercises/lookup";
import {
  createTeamExerciseExecution,
  type TeamRoleAssignmentInput,
} from "../lib/exercises/teamExecution";
import type { ExerciseVersion } from "../lib/exercises/types";
import { surfaceClass } from "./Surface";

type Props = {
  version: ExerciseVersion;
  recorderProfileId: string;
  eligibilitySnapshots: TeamExerciseEligibilitySnapshot[];
  onStart(execution: ExerciseExecution): Promise<boolean>;
  onCancel(): void;
};

type RotationKind = ExerciseRotationConfiguration["kind"];

const ROTATION_OPTIONS: readonly { value: RotationKind; label: string }[] = [
  { value: "fixed", label: "Fixed delivering athlete" },
  { value: "after-every-stone", label: "Change after every stone" },
  { value: "after-stone-count", label: "Change after a number of stones" },
  { value: "after-series", label: "Change after one complete series" },
  { value: "manual", label: "Manual changes" },
];

function participantName(
  snapshot: TeamExerciseEligibilitySnapshot,
  profileId: string
): string {
  const participant = snapshot.participants.find((candidate) => candidate.profileId === profileId);
  return participant?.displayName ?? "Team member";
}

export default function ExerciseTeamSetupScreen({
  version,
  recorderProfileId,
  eligibilitySnapshots,
  onStart,
  onCancel,
}: Props) {
  const id = useId();
  const availableTeams = eligibilitySnapshots.filter((snapshot) =>
    snapshot.participants.some((participant) => participant.profileId === recorderProfileId)
  );
  const [teamId, setTeamId] = useState(availableTeams[0]?.teamId ?? "");
  const [presentIds, setPresentIds] = useState<string[]>([recorderProfileId]);
  const [trainingAthleteIds, setTrainingAthleteIds] = useState<string[]>([]);
  const [deliveringAthleteId, setDeliveringAthleteId] = useState("");
  const [sweeperIds, setSweeperIds] = useState<string[]>([]);
  const [skipId, setSkipId] = useState("");
  const [observerId, setObserverId] = useState("");
  const [timekeeperId, setTimekeeperId] = useState("");
  const [coachIds, setCoachIds] = useState<string[]>([]);
  const [sweepingUsed, setSweepingUsed] = useState(false);
  const [rotationKind, setRotationKind] = useState<RotationKind>("manual");
  const [rotationStoneCount, setRotationStoneCount] = useState(2);
  const [selectedVariationId, setSelectedVariationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshot = availableTeams.find((candidate) => candidate.teamId === teamId);
  const presentParticipants = snapshot?.participants.filter((participant) =>
    presentIds.includes(participant.profileId)
  ) ?? [];

  function resetForTeam(nextTeamId: string) {
    setTeamId(nextTeamId);
    setPresentIds([recorderProfileId]);
    setTrainingAthleteIds([]);
    setDeliveringAthleteId("");
    setSweeperIds([]);
    setSkipId("");
    setObserverId("");
    setTimekeeperId("");
    setCoachIds([]);
    setSweepingUsed(false);
    setError(null);
  }

  function togglePresent(profileId: string, checked: boolean) {
    if (profileId === recorderProfileId) return;
    setPresentIds((current) => checked
      ? [...current, profileId]
      : current.filter((idValue) => idValue !== profileId));
    if (!checked) {
      setTrainingAthleteIds((current) => current.filter((idValue) => idValue !== profileId));
      if (deliveringAthleteId === profileId) setDeliveringAthleteId("");
      const nextSweepers = sweeperIds.filter((idValue) => idValue !== profileId);
      setSweeperIds(nextSweepers);
      if (nextSweepers.length === 0) setSweepingUsed(false);
      if (skipId === profileId) setSkipId("");
      if (observerId === profileId) setObserverId("");
      if (timekeeperId === profileId) setTimekeeperId("");
      setCoachIds((current) => current.filter((idValue) => idValue !== profileId));
    }
  }

  function toggleTrainingAthlete(profileId: string, checked: boolean) {
    setTrainingAthleteIds((current) => checked
      ? [...current, profileId]
      : current.filter((idValue) => idValue !== profileId));
    if (checked && deliveringAthleteId === "") setDeliveringAthleteId(profileId);
    if (!checked && deliveringAthleteId === profileId) {
      const nextDeliverer = trainingAthleteIds.find((idValue) => idValue !== profileId) ?? "";
      setDeliveringAthleteId(nextDeliverer);
      const nextSweepers = sweeperIds.filter((idValue) => idValue !== nextDeliverer);
      setSweeperIds(nextSweepers);
      if (nextSweepers.length === 0) setSweepingUsed(false);
    }
  }

  function toggleSweeper(profileId: string, checked: boolean) {
    if (!checked) {
      const next = sweeperIds.filter((idValue) => idValue !== profileId);
      setSweeperIds(next);
      if (next.length === 0) setSweepingUsed(false);
      return;
    }
    if (sweeperIds.length < 2) setSweeperIds([...sweeperIds, profileId]);
  }

  async function start() {
    if (!snapshot) return;
    if (trainingAthleteIds.length < version.participation.minTrainingAthletes) {
      setError(`Select at least ${version.participation.minTrainingAthletes} training athlete${version.participation.minTrainingAthletes === 1 ? "" : "s"}.`);
      return;
    }
    if (
      version.participation.maxTrainingAthletes !== null &&
      trainingAthleteIds.length > version.participation.maxTrainingAthletes
    ) {
      setError(`This exercise allows at most ${version.participation.maxTrainingAthletes} training athletes.`);
      return;
    }
    if (!trainingAthleteIds.includes(deliveringAthleteId)) {
      setError("Choose the first delivering athlete.");
      return;
    }

    const participantRoster: ExerciseTeamParticipant[] = presentParticipants.map((participant) => ({
      profileId: participant.profileId,
      participation: trainingAthleteIds.includes(participant.profileId)
        ? "training-athlete"
        : "supporting",
    }));
    const athleteOrder = [
      deliveringAthleteId,
      ...trainingAthleteIds.filter((profileId) => profileId !== deliveringAthleteId),
    ];
    const rotation: ExerciseRotationConfiguration = rotationKind === "after-stone-count"
      ? { kind: rotationKind, athleteOrder, stoneCount: rotationStoneCount }
      : { kind: rotationKind, athleteOrder };
    const roleAssignment: TeamRoleAssignmentInput = {
      deliveringAthleteProfileId: deliveringAthleteId,
      sweeperProfileIds: sweeperIds,
      ...(skipId ? { skipProfileId: skipId } : {}),
      ...(observerId ? { observerProfileId: observerId } : {}),
      ...(timekeeperId ? { timekeeperProfileId: timekeeperId } : {}),
      ...(coachIds.length > 0 ? { coachProfileIds: coachIds } : {}),
      sweepingUsed,
    };
    const enabledMeasurementProtocols = version.primaryFocus === "technique"
      ? []
      : resolveMeasurementProtocols(
          EXERCISE_CATALOG,
          version.compatibleMeasurementProtocols
        )
          .map(({ protocol }) => protocol)
          .filter(
            (protocol) =>
              version.primaryFocus === "measured" ||
              protocol.metricType === "rotation-count"
          );
    const outcome = createTeamExerciseExecution(version, {
      trainingSessionId: crypto.randomUUID(),
      teamId: snapshot.teamId,
      recorderProfileId,
      participantRoster,
      initialRoleAssignment: roleAssignment,
      rotation,
      ...(selectedVariationId ? { selectedVariationId } : {}),
      enabledMeasurementProtocols,
    });
    if (!outcome.ok) {
      setError(outcome.error.message);
      return;
    }
    setBusy(true);
    const saved = await onStart(outcome.value);
    setBusy(false);
    setError(saved ? null : "The Team exercise could not be saved. No draft was started.");
  }

  if (availableTeams.length === 0) {
    return (
      <div className="space-y-4">
        <section className={surfaceClass("hero")}>
          <h2 className="text-xl font-semibold text-slate-900">Team setup unavailable</h2>
          <p className="mt-2 text-sm text-slate-600">
            Open Team settings while online first. The app needs a previously verified active roster and recording-permission snapshot before it can start a Team exercise.
          </p>
        </section>
        <button type="button" onClick={onCancel} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white">
          Back to Exercise Library
        </button>
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div className="space-y-4">
      <button type="button" onClick={onCancel} className="-mx-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-slate-500 underline">
        ← Back to Exercise Library
      </button>

      <section className={surfaceClass("hero")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team exercise setup</p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">{version.title}</h2>
        <p className="mt-2 text-sm text-slate-600">
          The signed-in participant records on this device. There is no Recorder selector.
        </p>
      </section>

      <section className={surfaceClass("primary")}>
        <label htmlFor={`${id}-team`} className="text-sm font-semibold text-slate-900">Team</label>
        <select
          id={`${id}-team`}
          value={teamId}
          onChange={(event) => resetForTeam(event.target.value)}
          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
        >
          {availableTeams.map((team) => <option key={team.teamId} value={team.teamId}>{team.teamName}</option>)}
        </select>
        <p className="mt-2 text-xs text-slate-500">
          Latest roster and permission check: <time dateTime={snapshot.cachedAt}>{new Date(snapshot.cachedAt).toLocaleString()}</time>. Upload revalidates every athlete.
        </p>
      </section>

      <section className={surfaceClass("primary")}>
        <h3 className="text-base font-semibold text-slate-900">Who is present?</h3>
        <p className="mt-1 text-xs text-slate-500">The signed-in recorder is included automatically.</p>
        <div className="mt-3 space-y-2">
          {snapshot.participants.map((participant) => (
            <label key={participant.profileId} className="flex min-h-11 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={presentIds.includes(participant.profileId)}
                disabled={participant.profileId === recorderProfileId}
                onChange={(event) => togglePresent(participant.profileId, event.target.checked)}
              />
              <span>
                <span className="font-medium text-slate-800">{participantName(snapshot, participant.profileId)}</span>
                {participant.profileId === recorderProfileId && <span className="ml-1 text-xs text-slate-500">(recording)</span>}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className={surfaceClass("primary")}>
        <h3 className="text-base font-semibold text-slate-900">Training athletes</h3>
        <p className="mt-1 text-xs text-slate-500">Only active players with recording permission can receive a result.</p>
        <div className="mt-3 space-y-2">
          {presentParticipants.map((participant) => {
            const eligible = participant.participationAsPlayer && participant.recordingPermissionGranted;
            return (
              <label key={participant.profileId} className="flex min-h-11 items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={trainingAthleteIds.includes(participant.profileId)}
                  disabled={!eligible}
                  onChange={(event) => toggleTrainingAthlete(participant.profileId, event.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">{participantName(snapshot, participant.profileId)}</span>
                  {!eligible && (
                    <span className="block text-xs text-slate-500">
                      {!participant.participationAsPlayer ? "Not marked as a Team player" : "Recording permission not granted"}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </section>

      <section className={surfaceClass("primary")}>
        <h3 className="text-base font-semibold text-slate-900">Initial roles</h3>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          First delivering athlete
          <select
            value={deliveringAthleteId}
            onChange={(event) => {
              setDeliveringAthleteId(event.target.value);
              const nextSweepers = sweeperIds.filter((profileId) => profileId !== event.target.value);
              setSweeperIds(nextSweepers);
              if (nextSweepers.length === 0) setSweepingUsed(false);
            }}
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
          >
            <option value="">Choose an athlete</option>
            {trainingAthleteIds.map((profileId) => <option key={profileId} value={profileId}>{participantName(snapshot, profileId)}</option>)}
          </select>
        </label>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700">Sweepers (0–2)</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {presentParticipants.map((participant) => (
              <label key={participant.profileId} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={sweeperIds.includes(participant.profileId)}
                  disabled={participant.profileId === deliveringAthleteId || (!sweeperIds.includes(participant.profileId) && sweeperIds.length >= 2)}
                  onChange={(event) => toggleSweeper(participant.profileId, event.target.checked)}
                />
                {participantName(snapshot, participant.profileId)}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="mt-3 flex min-h-11 items-center gap-3 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={sweepingUsed}
            disabled={sweeperIds.length === 0}
            onChange={(event) => setSweepingUsed(event.target.checked)}
          />
          Sweeping will be used
        </label>

        {([
          ["Skip / broom giver", skipId, setSkipId],
          ["Observer", observerId, setObserverId],
          ["Timekeeper", timekeeperId, setTimekeeperId],
        ] as const).map(([label, value, setter]) => (
          <label key={label} className="mt-3 block text-sm font-medium text-slate-700">
            {label} <span className="font-normal text-slate-500">(optional)</span>
            <select value={value} onChange={(event) => setter(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">None</option>
              {presentParticipants.map((participant) => <option key={participant.profileId} value={participant.profileId}>{participantName(snapshot, participant.profileId)}</option>)}
            </select>
          </label>
        ))}

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700">Coaches (optional)</legend>
          <div className="mt-2 space-y-2">
            {presentParticipants.map((participant) => (
              <label key={participant.profileId} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={coachIds.includes(participant.profileId)}
                  onChange={(event) => setCoachIds((current) => event.target.checked
                    ? [...current, participant.profileId]
                    : current.filter((profileId) => profileId !== participant.profileId))}
                />
                {participantName(snapshot, participant.profileId)}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={surfaceClass("primary")}>
        <h3 className="text-base font-semibold text-slate-900">Rotation</h3>
        <label htmlFor={`${id}-rotation`} className="mt-3 block text-sm font-medium text-slate-700">
          Athlete rotation plan
        </label>
        <select id={`${id}-rotation`} value={rotationKind} onChange={(event) => setRotationKind(event.target.value as RotationKind)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
          {ROTATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {rotationKind === "after-stone-count" && (
          <label className="mt-3 block text-sm font-medium text-slate-700">
            Stones before changing athlete
            <input type="number" min={1} step={1} value={rotationStoneCount} onChange={(event) => setRotationStoneCount(Number(event.target.value))} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          </label>
        )}
      </section>

      {version.variations.length > 0 && (
        <section className={surfaceClass("primary")}>
          <label className="text-sm font-semibold text-slate-900">
            Variation <span className="font-normal text-slate-500">(optional)</span>
            <select value={selectedVariationId} onChange={(event) => setSelectedVariationId(event.target.value)} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Standard exercise</option>
              {version.variations.map((variation) => <option key={variation.id} value={variation.id}>{variation.label}</option>)}
            </select>
          </label>
        </section>
      )}

      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      <button type="button" onClick={() => void start()} disabled={busy} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? "Saving Team Draft…" : "Start Team Exercise"}
      </button>
    </div>
  );
}
