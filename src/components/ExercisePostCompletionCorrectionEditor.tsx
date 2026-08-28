"use client";

import { useState } from "react";
import type { Handle } from "../types";
import type { OwnedTeamExerciseResultRecord } from "../lib/cloudSporting/teamExerciseRecords";
import type { TeamExerciseResultMutationOutcome } from "../lib/cloudSporting/syncManager";
import type {
  AthleteExerciseResult,
  ExerciseMeasurement,
  ExerciseTeamAttemptRoleContext,
  ShotmakingEvaluation,
  ShotmakingExclusionReason,
  ShotmakingExerciseAttempt,
} from "../lib/exercises/executionTypes";
import { getTeamAttemptRoleContext } from "../lib/exercises/teamExecution";
import { measurementUnitLabel } from "../lib/exercises/presentation";

type Props = {
  record: OwnedTeamExerciseResultRecord;
  attempt: ShotmakingExerciseAttempt;
  participantLabels: ReadonlyMap<string, string>;
  onSave(
    replacement: AthleteExerciseResult,
    revisionId: string,
    reason: string
  ): Promise<TeamExerciseResultMutationOutcome>;
  onCompleted(outcome: Exclude<TeamExerciseResultMutationOutcome, "invalid" | "failed">): void;
  onCancel(): void;
};

const EXCLUSION_OPTIONS: readonly { value: ShotmakingExclusionReason; label: string }[] = [
  { value: "external-interruption", label: "External interruption" },
  { value: "incorrect-or-displaced-setup", label: "Incorrect or displaced setup" },
  { value: "technical-or-capture-problem", label: "Technical or capture problem" },
  { value: "outcome-not-observable", label: "Outcome not observable" },
  { value: "other", label: "Other" },
];

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function CorrectionEditor({
  record,
  attempt,
  participantLabels,
  onSave,
  onCompleted,
  onCancel,
  initialRole,
}: Props & { initialRole: ExerciseTeamAttemptRoleContext }) {
  const context = record.sharedExecution.teamContext!;
  const participantIds = context.participantRoster.map((participant) => participant.profileId);
  const manualProtocols = record.sharedExecution.configuration.enabledMeasurementProtocols.filter(
    (protocol) => protocol.allowedSources.includes("manual")
  );
  const [revisionId] = useState(() => crypto.randomUUID());
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
  const [measurementValues, setMeasurementValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(manualProtocols.map((protocol) => {
      const existing = attempt.measurements.find(
        (measurement) => measurement.protocolId === protocol.id &&
          measurement.protocolVersion === protocol.version && measurement.source === "manual"
      );
      return [`${protocol.id}@${protocol.version}`, existing ? String(existing.value) : ""];
    }))
  );
  const [measurementIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(manualProtocols.map((protocol) => {
      const existing = attempt.measurements.find(
        (measurement) => measurement.protocolId === protocol.id &&
          measurement.protocolVersion === protocol.version && measurement.source === "manual"
      );
      return [`${protocol.id}@${protocol.version}`, existing?.id ?? crypto.randomUUID()];
    }))
  );
  const [sweeperProfileIds, setSweeperProfileIds] = useState([...initialRole.sweeperProfileIds]);
  const [sweepingUsed, setSweepingUsed] = useState(initialRole.sweepingUsed);
  const [skipProfileId, setSkipProfileId] = useState(initialRole.skipProfileId ?? "");
  const [observerProfileId, setObserverProfileId] = useState(initialRole.observerProfileId ?? "");
  const [coachProfileIds, setCoachProfileIds] = useState([...(initialRole.coachProfileIds ?? [])]);
  const [timekeeperProfileId, setTimekeeperProfileId] = useState(initialRole.timekeeperProfileId ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedReason = reason.trim();
  const reasonTooLong = normalizedReason.length > 500 ||
    new TextEncoder().encode(normalizedReason).byteLength > 2_000;
  const reasonValid = normalizedReason.length >= 10 && !reasonTooLong;

  function label(profileId: string): string {
    return participantLabels.get(profileId) ?? "Session participant";
  }

  function toggle(list: string[], profileId: string, maximum?: number): string[] {
    if (list.includes(profileId)) return list.filter((candidate) => candidate !== profileId);
    if (maximum !== undefined && list.length >= maximum) return list;
    return [...list, profileId];
  }

  function buildMeasurements(): ExerciseMeasurement[] | null {
    const editableKeys = new Set(manualProtocols.map((protocol) => `${protocol.id}@${protocol.version}`));
    const measurements = attempt.measurements.filter((measurement) =>
      measurement.source !== "manual" ||
      !editableKeys.has(`${measurement.protocolId}@${measurement.protocolVersion}`)
    );
    for (const protocol of manualProtocols) {
      const key = `${protocol.id}@${protocol.version}`;
      const raw = measurementValues[key]?.trim() ?? "";
      if (raw === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 ||
          (protocol.metricType === "rotation-count" && !Number.isInteger(value * 2))) return null;
      const existing = attempt.measurements.find(
        (measurement) => measurement.protocolId === protocol.id &&
          measurement.protocolVersion === protocol.version && measurement.source === "manual"
      );
      measurements.push({
        ...(existing ?? {
          id: measurementIds[key],
          protocolId: protocol.id,
          protocolVersion: protocol.version,
          source: "manual" as const,
          recordedAt: attempt.createdAt,
          observerProfileId: record.athleteProfileId,
        }),
        value,
      });
    }
    return measurements;
  }

  async function save() {
    setError(null);
    if (!reasonValid) {
      setError("Give a reason between 10 and 500 characters.");
      return;
    }
    if (outcomeKind === "excluded" && exclusionReason === "other" && !exclusionExplanation.trim()) {
      setError("Other needs a short explanation.");
      return;
    }
    if (sweepingUsed && sweeperProfileIds.length === 0) {
      setError("Assign at least one Sweeper when sweeping was used.");
      return;
    }
    const measurements = buildMeasurements();
    if (!measurements) {
      setError("Measurements must be positive numbers. Rotation Count uses whole or half rotations.");
      return;
    }
    const evaluation: ShotmakingEvaluation = outcomeKind === "scored"
      ? { status: "scored", score }
      : {
          status: "excluded",
          reason: exclusionReason,
          ...(exclusionExplanation.trim() ? { explanation: exclusionExplanation.trim() } : {}),
        };
    const roleContext: ExerciseTeamAttemptRoleContext = {
      deliveringAthleteProfileId: attempt.athleteProfileId,
      sweeperProfileIds,
      ...(skipProfileId ? { skipProfileId } : {}),
      ...(observerProfileId ? { observerProfileId } : {}),
      ...(coachProfileIds.length ? { coachProfileIds } : {}),
      ...(timekeeperProfileId ? { timekeeperProfileId } : {}),
      sweepingUsed,
    };
    const replacementAttempt: ShotmakingExerciseAttempt = {
      ...attempt,
      actualHandle,
      evaluation,
      measurements,
      ...(sameValue(roleContext, initialRole)
        ? (attempt.teamRoleContextOverride
            ? { teamRoleContextOverride: attempt.teamRoleContextOverride }
            : {})
        : { teamRoleContextOverride: roleContext }),
    };
    const replacement: AthleteExerciseResult = {
      ...record.result,
      attempts: record.result.attempts.map((candidate) =>
        candidate.id === attempt.id ? replacementAttempt : candidate
      ),
    };
    setBusy(true);
    const outcome = await onSave(replacement, revisionId, normalizedReason);
    setBusy(false);
    if (outcome === "invalid") {
      setError("Change at least one supported fact before saving.");
      return;
    }
    if (outcome === "failed") {
      setUncertain(true);
      setError("The change could not be confirmed. Keep these values unchanged and retry the exact correction when connected.");
      return;
    }
    onCompleted(outcome);
  }

  const formDisabled = busy || uncertain;
  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h4 className="font-semibold text-amber-950">Correct Stone {attempt.sequenceNumber}</h4>
      <p className="mt-1 text-xs text-amber-800">Only your own result changes. The original values, your reason and the server time stay in the audit history.</p>

      <fieldset disabled={formDisabled} className="mt-4 space-y-4 disabled:opacity-60">
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Actual handle</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {(["in", "out"] as const).map((handle) => (
              <button key={handle} type="button" aria-pressed={actualHandle === handle} onClick={() => setActualHandle(handle)} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${actualHandle === handle ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>{handle === "in" ? "Inhandle" : "Outhandle"}</button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Outcome</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={outcomeKind === "scored"} onClick={() => setOutcomeKind("scored")} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${outcomeKind === "scored" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>Scored</button>
            <button type="button" aria-pressed={outcomeKind === "excluded"} onClick={() => setOutcomeKind("excluded")} className={`min-h-11 rounded-xl px-3 py-2 text-sm font-semibold ${outcomeKind === "excluded" ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>Excluded</button>
          </div>
        </fieldset>
        {outcomeKind === "scored" ? (
          <label className="block text-sm font-medium text-slate-700">Score
            <select value={score} onChange={(event) => setScore(Number(event.target.value) as 0 | 1 | 2 | 3 | 4)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
              {[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}/4 · {value * 25}%</option>)}
            </select>
          </label>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">Exclusion reason
              <select value={exclusionReason} onChange={(event) => setExclusionReason(event.target.value as ShotmakingExclusionReason)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2">
                {EXCLUSION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            {exclusionReason === "other" && <label className="text-sm font-medium text-slate-700">Explanation<input value={exclusionExplanation} onChange={(event) => setExclusionExplanation(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /></label>}
          </div>
        )}

        {manualProtocols.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {manualProtocols.map((protocol) => {
              const key = `${protocol.id}@${protocol.version}`;
              return <label key={key} className="text-sm font-medium text-slate-700">{protocol.name} <span className="font-normal">(optional)</span><input type="number" min={protocol.metricType === "rotation-count" ? "0.5" : "0.01"} step={protocol.metricType === "rotation-count" ? "0.5" : "0.01"} value={measurementValues[key] ?? ""} onChange={(event) => setMeasurementValues((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" /><span className="mt-1 block text-xs font-normal text-slate-500">{measurementUnitLabel(protocol.unit)}</span></label>;
            })}
          </div>
        )}

        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Sweepers for this stone</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {participantIds.map((profileId) => <label key={profileId} className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm"><input type="checkbox" checked={sweeperProfileIds.includes(profileId)} onChange={() => setSweeperProfileIds((current) => toggle(current, profileId, 2))} />{label(profileId)}</label>)}
          </div>
        </fieldset>
        <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={sweepingUsed} onChange={(event) => setSweepingUsed(event.target.checked)} />Sweeping was used</label>

        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ["Skip", skipProfileId, setSkipProfileId],
            ["Observer", observerProfileId, setObserverProfileId],
            ["Timekeeper", timekeeperProfileId, setTimekeeperProfileId],
          ] as const).map(([name, value, setter]) => <label key={name} className="text-sm font-medium text-slate-700">{name}<select value={value} onChange={(event) => setter(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"><option value="">None</option>{participantIds.map((profileId) => <option key={profileId} value={profileId}>{label(profileId)}</option>)}</select></label>)}
        </div>
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">Coaches for this stone</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">{participantIds.map((profileId) => <label key={profileId} className="flex min-h-11 items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm"><input type="checkbox" checked={coachProfileIds.includes(profileId)} onChange={() => setCoachProfileIds((current) => toggle(current, profileId))} />{label(profileId)}</label>)}</div>
        </fieldset>

        <div>
          <label htmlFor="post-completion-reason" className="block text-sm font-medium text-slate-700">Reason for this change</label>
          <textarea id="post-completion-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} aria-describedby="post-completion-reason-help" className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" />
          <p id="post-completion-reason-help" className="mt-1 text-xs font-normal text-slate-500">Required · 10–500 characters · shared with eligible original participants.</p>
        </div>
      </fieldset>

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-100 p-3 text-sm text-red-800">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || uncertain} onClick={onCancel} className="min-h-11 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy || (!uncertain && (!reasonValid || reasonTooLong))} onClick={() => void save()} className="min-h-11 rounded-xl bg-amber-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{uncertain ? "Retry Exact Correction" : "Save Correction"}</button>
      </div>
    </div>
  );
}

export default function ExercisePostCompletionCorrectionEditor(props: Props) {
  const initialRole = getTeamAttemptRoleContext(
    { ...props.record.sharedExecution, athleteResults: [props.record.result] },
    props.attempt
  );
  if (!initialRole || props.record.isVoided) return null;
  return <CorrectionEditor {...props} initialRole={initialRole} />;
}
