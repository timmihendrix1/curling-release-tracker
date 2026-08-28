"use client";

import { useState } from "react";
import type {
  OwnedTeamExerciseResultRecord,
  OwnedTeamExerciseResultRevision,
} from "../lib/cloudSporting/teamExerciseRecords";
import type {
  TeamExercisePrivateNoteUpdateOutcome,
  TeamExerciseResultMutationOutcome,
} from "../lib/cloudSporting/syncManager";
import { computeShotmakingResult } from "../lib/exercises/executionResult";
import { getTeamAttemptRoleContext } from "../lib/exercises/teamExecution";
import type {
  AthleteExerciseResult,
  ExerciseActiveAttemptCorrection,
  ExerciseExecution,
  ShotmakingExclusionReason,
  ShotmakingExerciseAttempt,
} from "../lib/exercises/executionTypes";
import { measurementUnitLabel } from "../lib/exercises/presentation";
import { serializeOwnedTeamExerciseResultExport } from "../lib/exercises/teamResultExport";
import ExercisePostCompletionCorrectionEditor from "./ExercisePostCompletionCorrectionEditor";
import { surfaceClass } from "./Surface";

type ReadStatus = "loading" | "refreshed" | "cached" | "unavailable" | "issue";

type Props = {
  results: OwnedTeamExerciseResultRecord[];
  readStatus: ReadStatus;
  onRefresh(): Promise<boolean>;
  onSetPrivateNote(
    resultId: string,
    note: string | null
  ): Promise<TeamExercisePrivateNoteUpdateOutcome>;
  onReviseResult(
    resultId: string,
    replacement: AthleteExerciseResult,
    revisionId: string,
    reason: string
  ): Promise<TeamExerciseResultMutationOutcome>;
  onVoidResult(
    resultId: string,
    revisionId: string,
    reason: string
  ): Promise<TeamExerciseResultMutationOutcome>;
};

const EXCLUSION_LABELS: Record<ShotmakingExclusionReason, string> = {
  "external-interruption": "External interruption",
  "incorrect-or-displaced-setup": "Incorrect or displaced setup",
  "technical-or-capture-problem": "Technical or capture problem",
  "outcome-not-observable": "Outcome not observable",
  other: "Other",
};

const PRIVATE_NOTE_MAX_BYTES = 65_536;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "exercise";
}

function downloadResult(record: OwnedTeamExerciseResultRecord): void {
  const payload = serializeOwnedTeamExerciseResultExport(record);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${safeFilePart(record.sharedExecution.exerciseVersionSnapshot.title)}-result.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function attemptSummary(attempt: ShotmakingExerciseAttempt): string {
  return `${attempt.actualHandle === "in" ? "Inhandle" : "Outhandle"} · ${
    attempt.evaluation.status === "scored"
      ? `${attempt.evaluation.score}/4`
      : `Excluded: ${EXCLUSION_LABELS[attempt.evaluation.reason]}`
  }`;
}

function correctionDescription(correction: ExerciseActiveAttemptCorrection): string {
  if (correction.kind === "annulled") return `Recorded by mistake · Previously ${attemptSummary(correction.before)}`;
  const changes = [
    correction.before.athleteProfileId !== correction.after?.athleteProfileId
      ? "Athlete attribution changed"
      : null,
    correction.after && attemptSummary(correction.before) !== attemptSummary(correction.after)
      ? `${attemptSummary(correction.before)} → ${attemptSummary(correction.after)}`
      : null,
    correction.after && JSON.stringify(correction.before.measurements) !== JSON.stringify(correction.after.measurements)
      ? "Measurements changed"
      : null,
    correction.after && JSON.stringify(correction.before.teamRoleContextOverride) !== JSON.stringify(correction.after.teamRoleContextOverride)
      ? "Role or Sweeper context changed"
      : null,
  ].filter((value): value is string => value !== null);
  return changes.join(" · ") || "Captured facts corrected";
}

function roleSummary(
  execution: Omit<ExerciseExecution, "athleteResults" | "activeAttemptCorrections">,
  result: AthleteExerciseResult,
  attempt: ShotmakingExerciseAttempt
): string {
  const role = getTeamAttemptRoleContext({ ...execution, athleteResults: [result] }, attempt);
  if (!role) return "Role context unavailable";
  return `${role.sweeperProfileIds.length} Sweeper${role.sweeperProfileIds.length === 1 ? "" : "s"}, ${
    role.sweepingUsed ? "sweeping used" : "no sweeping"
  }, ${role.skipProfileId ? "Skip assigned" : "no Skip"}, ${
    role.observerProfileId ? "observer assigned" : "no observer"
  }, ${role.coachProfileIds?.length ?? 0} Coach${role.coachProfileIds?.length === 1 ? "" : "es"}`;
}

function measurementSummary(
  execution: Omit<ExerciseExecution, "athleteResults" | "activeAttemptCorrections">,
  attempt: ShotmakingExerciseAttempt
): string {
  if (attempt.measurements.length === 0) return "None";
  return attempt.measurements.map((measurement) => {
    const protocol = execution.configuration.enabledMeasurementProtocols.find(
      (candidate) => candidate.id === measurement.protocolId &&
        candidate.version === measurement.protocolVersion
    );
    return `${protocol?.name ?? "Measurement"}: ${measurement.value} ${
      protocol ? measurementUnitLabel(protocol.unit) : ""
    }`.trim();
  }).join(" · ");
}

function revisionAuditEntries(record: OwnedTeamExerciseResultRecord): Array<{
  revision: OwnedTeamExerciseResultRevision;
  details: string[];
}> {
  const entries: Array<{ revision: OwnedTeamExerciseResultRevision; details: string[] }> = [];
  let previous = record.originalResult;
  for (const revision of record.postCompletionRevisions) {
    if (revision.kind === "voided" || revision.resultingResult === null) {
      entries.push({ revision, details: ["The complete result was excluded from current calculations."] });
      continue;
    }
    const next = revision.resultingResult;
    const changedIndex = previous.attempts.findIndex((attempt, index) =>
      JSON.stringify(attempt) !== JSON.stringify(next.attempts[index])
    );
    const before = previous.attempts[changedIndex];
    const after = next.attempts[changedIndex];
    const details: string[] = [];
    const changedFields = revision.changedFields as readonly string[];
    if (before?.kind === "shotmaking" && after?.kind === "shotmaking") {
      const stone = `Stone ${changedIndex + 1}`;
      if (changedFields.includes("actualHandle")) {
        details.push(`${stone} handle: ${before.actualHandle === "in" ? "Inhandle" : "Outhandle"} → ${after.actualHandle === "in" ? "Inhandle" : "Outhandle"}`);
      }
      if (changedFields.includes("evaluation")) {
        details.push(`${stone} outcome: ${attemptSummary(before)} → ${attemptSummary(after)}`);
      }
      if (changedFields.includes("measurements")) {
        details.push(`${stone} measurements: ${measurementSummary(record.sharedExecution, before)} → ${measurementSummary(record.sharedExecution, after)}`);
      }
      if (changedFields.includes("teamRoleContextOverride")) {
        details.push(`${stone} context: ${roleSummary(record.sharedExecution, previous, before)} → ${roleSummary(record.sharedExecution, next, after)}`);
      }
    }
    entries.push({
      revision,
      details: details.length > 0 ? details : ["The declared result facts were corrected."],
    });
    previous = next;
  }
  return entries;
}

function participantLabels(record: OwnedTeamExerciseResultRecord): ReadonlyMap<string, string> {
  return new Map((record.sharedExecution.teamContext?.participantRoster ?? []).map((participant, index) => {
    return [
      participant.profileId,
      participant.profileId === record.athleteProfileId
        ? "You"
        : `Session participant ${index + 1}`,
    ];
  }));
}

function VoidResultConfirmation({
  record,
  onVoid,
  onCompleted,
  onCancel,
}: {
  record: OwnedTeamExerciseResultRecord;
  onVoid: Props["onVoidResult"];
  onCompleted(outcome: Exclude<TeamExerciseResultMutationOutcome, "invalid" | "failed">): void;
  onCancel(): void;
}) {
  const [revisionId] = useState(() => crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const normalizedReason = reason.trim();
  const reasonValid = normalizedReason.length >= 10 && normalizedReason.length <= 500 &&
    new TextEncoder().encode(normalizedReason).byteLength <= 2_000;

  async function submit() {
    if (!reasonValid) {
      setError("Give a reason between 10 and 500 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const outcome = await onVoid(record.result.id, revisionId, normalizedReason);
    setBusy(false);
    if (outcome === "invalid") {
      setError("This result cannot be voided from its current state.");
      return;
    }
    if (outcome === "failed") {
      setUncertain(true);
      setError("The void could not be confirmed. Keep this reason unchanged and retry the exact request when connected.");
      return;
    }
    onCompleted(outcome);
  }

  return (
    <section className="rounded-2xl border border-red-300 bg-red-50 p-4" aria-labelledby="void-result-title">
      <h3 id="void-result-title" className="text-lg font-semibold text-red-950">Void your complete result?</h3>
      <p className="mt-2 text-sm text-red-900">This permanently excludes the complete result from current calculations. It cannot be undone in Version 1; the original result and audit history remain.</p>
      <fieldset disabled={busy || uncertain} className="disabled:opacity-60">
        <div className="mt-3">
          <label htmlFor="void-result-reason" className="block text-sm font-medium text-red-950">Reason for voiding</label>
          <textarea id="void-result-reason" value={reason} onChange={(event) => setReason(event.target.value)} rows={3} maxLength={500} aria-describedby="void-result-reason-help" className="mt-1 w-full rounded-xl border border-red-300 bg-white px-3 py-2 text-slate-900" />
          <p id="void-result-reason-help" className="mt-1 text-xs font-normal text-red-800">Required · 10–500 characters · shared with eligible original participants.</p>
        </div>
      </fieldset>
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-100 p-3 text-sm text-red-900">{error}</p>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" disabled={busy || uncertain} onClick={onCancel} className="min-h-11 rounded-xl bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancel</button>
        <button type="button" disabled={busy || (!uncertain && !reasonValid)} onClick={() => void submit()} className="min-h-11 rounded-xl bg-red-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{uncertain ? "Retry Exact Void" : "Void Complete Result"}</button>
      </div>
    </section>
  );
}

function ResultDetail({
  record,
  onBack,
  onSetPrivateNote,
  onReviseResult,
  onVoidResult,
  labels,
  canMutate,
}: {
  record: OwnedTeamExerciseResultRecord;
  onBack(): void;
  onSetPrivateNote: Props["onSetPrivateNote"];
  onReviseResult: Props["onReviseResult"];
  onVoidResult: Props["onVoidResult"];
  labels: ReadonlyMap<string, string>;
  canMutate: boolean;
}) {
  const [note, setNote] = useState(record.privateNote?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editingAttemptId, setEditingAttemptId] = useState<string | null>(null);
  const [confirmingVoid, setConfirmingVoid] = useState(false);
  const [mutationLocked, setMutationLocked] = useState(false);
  const noteByteLength = new TextEncoder().encode(note).byteLength;
  const noteTooLong = noteByteLength > PRIVATE_NOTE_MAX_BYTES;
  const execution = record.sharedExecution;
  const version = execution.exerciseVersionSnapshot;
  const context = execution.teamContext;
  const shotmaking = version.primaryFocus === "shotmaking";
  const summary = shotmaking ? computeShotmakingResult(record.result) : null;
  const auditEntries = revisionAuditEntries(record);

  function finishMutation(
    outcome: Exclude<TeamExerciseResultMutationOutcome, "invalid" | "failed">,
    kind: "correction" | "void"
  ) {
    setEditingAttemptId(null);
    setConfirmingVoid(false);
    if (outcome === "updated") {
      setMessage(kind === "correction"
        ? "Correction saved. The verified result and audit history were refreshed."
        : "Result voided. Its verified terminal state and audit history were refreshed.");
      return;
    }
    setMutationLocked(true);
    if (outcome === "updated_cache_issue") {
      setMessage("The change reached the cloud, but this device could not verify the refreshed result. Return to the list and refresh before making another change.");
    } else if (outcome === "conflict") {
      setMessage("This result changed before your request was accepted. Return to the list, refresh and review the latest version before trying again.");
    } else {
      setMessage("This result is already voided. Return to the list and refresh to load its terminal audit state.");
    }
  }

  async function saveNote(next: string | null) {
    setBusy(true);
    const outcome = await onSetPrivateNote(record.result.id, next);
    setBusy(false);
    if (outcome === "failed") {
      setMessage("Your note could not be saved. Reconnect and try again.");
      return;
    }
    if (next === null) setNote("");
    setMessage(outcome === "updated"
      ? (next === null ? "Private note cleared." : "Private note saved.")
      : "The note reached the cloud, but this device could not cache the update.");
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="-mx-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-slate-600 underline">
        ← Back to Exercise Results
      </button>

      <section className={surfaceClass("hero")}>
        <p className="text-xs font-medium text-slate-500">Team Exercise · {formatDate(execution.completedAt!)}</p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900">{version.title}</h2>
        <p className="mt-1 text-sm text-slate-600">Exercise version {version.version}</p>
        {record.isVoided ? (
          <p className="mt-3 rounded-xl bg-red-100 p-3 text-sm font-semibold text-red-900">Voided · Excluded from current calculations</p>
        ) : record.postCompletionRevisions.length > 0 ? (
          <p className="mt-3 rounded-xl bg-amber-100 p-3 text-sm font-semibold text-amber-900">Changed after completion · Revision {record.postCompletionRevisions.length}</p>
        ) : null}
      </section>

      {record.activeAttemptCorrections.length > 0 && (
        <section className={surfaceClass("primary")}>
          <h3 className="text-lg font-semibold text-slate-900">Correction history</h3>
          <p className="mt-1 text-xs text-slate-500">Only active-session changes affecting your own data are shown.</p>
          <ol className="mt-3 space-y-2">
            {record.activeAttemptCorrections.map((correction) => (
              <li key={correction.id} className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-medium">{correctionDescription(correction)}</p>
                <p className="mt-1 text-xs text-amber-800">Active recorder · {formatDate(correction.correctedAt)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {auditEntries.length > 0 && (
        <section className={surfaceClass("primary")}>
          <h3 className="text-lg font-semibold text-slate-900">Post-completion history</h3>
          <p className="mt-1 text-xs text-slate-500">Append-only changes to your own completed result. Original facts remain preserved.</p>
          <ol className="mt-3 space-y-3">
            {auditEntries.map(({ revision, details }) => (
              <li key={revision.revisionId} className={`rounded-xl p-3 text-sm ${revision.kind === "voided" ? "bg-red-50 text-red-950" : "bg-amber-50 text-amber-950"}`}>
                <p className="font-semibold">Revision {revision.revisionNumber} · {revision.kind === "voided" ? "Complete result voided" : "Result corrected"}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {details.map((detail) => <li key={detail}>{detail}</li>)}
                </ul>
                <p className="mt-2"><span className="font-medium">Reason:</span> {revision.reason}</p>
                <p className={`mt-1 text-xs ${revision.kind === "voided" ? "text-red-800" : "text-amber-800"}`}>Changed by you · {formatDate(revision.createdAt)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className={surfaceClass("primary")}>
        <h3 className="text-lg font-semibold text-slate-900">{record.isVoided ? "Preserved result" : "Your result"}</h3>
        {record.isVoided && <p className="mt-2 text-sm text-red-800">These facts remain for provenance and export but are not included in current calculations.</p>}
        {summary ? (
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-slate-500">Average</dt><dd className="text-lg font-semibold text-slate-900">{summary.averagePercentage === null ? "—" : `${summary.averagePercentage.toFixed(0)}%`}</dd></div>
            <div><dt className="text-slate-500">Points</dt><dd className="text-lg font-semibold text-slate-900">{summary.points}/{summary.maximumPoints}</dd></div>
            <div><dt className="text-slate-500">Scored stones</dt><dd className="font-medium text-slate-800">{summary.scoredStoneCount}</dd></div>
            <div><dt className="text-slate-500">Excluded</dt><dd className="font-medium text-slate-800">{summary.excludedAttemptCount}</dd></div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Unscored Technique observation. No points were awarded.</p>
        )}

        {record.result.attempts.length > 0 && (
          <ol className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            {record.result.attempts.map((attempt, index) => (
              <li key={attempt.id} className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
                <p className="font-medium text-slate-900">Stone {index + 1}</p>
                {attempt.kind === "shotmaking" && (
                  <p className="mt-1">
                    {attempt.actualHandle === "in" ? "Inhandle" : "Outhandle"}
                    {attempt.evaluation.status === "scored"
                      ? ` · ${attempt.evaluation.score}/4 (${attempt.evaluation.score * 25}%)`
                      : ` · Excluded: ${EXCLUSION_LABELS[attempt.evaluation.reason]}`}
                  </p>
                )}
                {attempt.measurements.map((measurement) => {
                  const protocol = execution.configuration.enabledMeasurementProtocols.find(
                    (candidate) => candidate.id === measurement.protocolId && candidate.version === measurement.protocolVersion
                  );
                  return <p key={measurement.id} className="mt-1 text-slate-600">{protocol?.name ?? "Measurement"}: {measurement.value} {protocol ? measurementUnitLabel(protocol.unit) : ""}</p>;
                })}
                {attempt.kind === "shotmaking" && (() => {
                  const role = getTeamAttemptRoleContext({ ...execution, athleteResults: [record.result] }, attempt);
                  if (!role) return null;
                  return <p className="mt-1 text-xs text-slate-500">Context: {role.sweeperProfileIds.length} Sweeper{role.sweeperProfileIds.length === 1 ? "" : "s"} · {role.sweepingUsed ? "sweeping used" : "no sweeping"}{role.skipProfileId ? " · Skip assigned" : ""}</p>;
                })()}
                {attempt.kind === "shotmaking" && canMutate && !record.isVoided && !mutationLocked && editingAttemptId !== attempt.id && (
                  <button type="button" onClick={() => { setEditingAttemptId(attempt.id); setConfirmingVoid(false); setMessage(null); }} className="mt-3 min-h-11 rounded-xl bg-white px-3 py-2 text-sm font-semibold text-slate-700 ring-1 ring-slate-300">Correct This Stone</button>
                )}
                {attempt.kind === "shotmaking" && editingAttemptId === attempt.id && (
                  <ExercisePostCompletionCorrectionEditor
                    record={record}
                    attempt={attempt}
                    participantLabels={labels}
                    onSave={(replacement, revisionId, reason) =>
                      onReviseResult(record.result.id, replacement, revisionId, reason)
                    }
                    onCompleted={(outcome) => finishMutation(outcome, "correction")}
                    onCancel={() => setEditingAttemptId(null)}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {!record.isVoided && !canMutate && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Reconnect and refresh this result before making a post-completion correction or voiding it.</p>
      )}
      {message && <p role="status" className="rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
      {!record.isVoided && canMutate && !mutationLocked && !confirmingVoid && (
        <button type="button" onClick={() => { setConfirmingVoid(true); setEditingAttemptId(null); setMessage(null); }} className="min-h-11 w-full rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 ring-1 ring-red-200">Void My Complete Result</button>
      )}
      {confirmingVoid && (
        <VoidResultConfirmation
          record={record}
          onVoid={onVoidResult}
          onCompleted={(outcome) => finishMutation(outcome, "void")}
          onCancel={() => setConfirmingVoid(false)}
        />
      )}

      <section className={surfaceClass("primary")}>
        <h3 className="text-lg font-semibold text-slate-900">Session context</h3>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-500">Participants</dt><dd className="font-medium text-slate-800">{context?.participantRoster.length ?? 0}</dd></div>
          <div><dt className="text-slate-500">Training athletes</dt><dd className="font-medium text-slate-800">{context?.participantRoster.filter((participant) => participant.participation === "training-athlete").length ?? 0}</dd></div>
          <div><dt className="text-slate-500">Role segments</dt><dd className="font-medium text-slate-800">{execution.roleAssignmentSegments.length}</dd></div>
          <div><dt className="text-slate-500">Initial sweeping</dt><dd className="font-medium text-slate-800">{execution.configuration.sweepingUsed ? `Used with ${execution.configuration.sweeperCount} Sweeper${execution.configuration.sweeperCount === 1 ? "" : "s"}` : "Not used"}</dd></div>
        </dl>
        <p className="mt-3 text-xs text-slate-500">This shared context does not grant access to another athlete&apos;s result or note.</p>
      </section>

      <section className={surfaceClass("primary")}>
        <h3 className="text-lg font-semibold text-slate-900">Private athlete note</h3>
        <p className="mt-1 text-xs text-slate-500">Only you can read or change this note.</p>
        <label className="mt-3 block text-sm font-medium text-slate-700">
          Your private note
          <textarea aria-describedby={noteTooLong ? "private-note-size-error" : undefined} value={note} onChange={(event) => setNote(event.target.value)} rows={5} maxLength={PRIVATE_NOTE_MAX_BYTES} className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" />
        </label>
        {noteTooLong && <p id="private-note-size-error" role="alert" className="mt-2 text-sm text-red-700">This note is too long to save. Shorten it below 65,536 bytes.</p>}
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <button type="button" disabled={busy || note.trim().length === 0 || noteTooLong} onClick={() => void saveNote(note)} className="min-h-11 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Save Private Note</button>
          <button type="button" disabled={busy || record.privateNote === null} onClick={() => void saveNote(null)} className="min-h-11 rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Clear Private Note</button>
        </div>
      </section>

      <button type="button" onClick={() => downloadResult(record)} className="min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700">
        Export My Raw Result
      </button>
    </div>
  );
}

export default function ExerciseTeamResultsScreen({
  results,
  readStatus,
  onRefresh,
  onSetPrivateNote,
  onReviseResult,
  onVoidResult,
}: Props) {
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const selected = results.find((record) => record.result.id === selectedResultId) ?? null;
  if (selected) {
    return (
      <ResultDetail
        key={selected.result.id}
        record={selected}
        onBack={() => setSelectedResultId(null)}
        onSetPrivateNote={onSetPrivateNote}
        onReviseResult={onReviseResult}
        onVoidResult={onVoidResult}
        labels={participantLabels(selected)}
        canMutate={readStatus === "refreshed"}
      />
    );
  }

  return (
    <div className="space-y-4">
      <section className={surfaceClass("hero")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Exercise Results</h2>
            <p className="mt-2 text-sm text-slate-600">Your raw results from shared Team Exercises. Other athletes&apos; results and notes are never included.</p>
          </div>
          <button type="button" disabled={readStatus === "loading"} onClick={() => void onRefresh()} className="min-h-11 shrink-0 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Refresh</button>
        </div>
        {readStatus === "cached" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Showing the last results saved on this device. Reconnect to check the cloud.</p>}
        {readStatus === "loading" && <p role="status" className="mt-3 rounded-xl bg-slate-100 p-3 text-xs text-slate-700">Checking your cloud Exercise Results…</p>}
        {readStatus === "unavailable" && <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Cloud Exercise Results are unavailable. No result has been guessed.</p>}
        {readStatus === "issue" && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-800">Exercise Results could not be verified. Cached data was not replaced.</p>}
      </section>

      {results.length === 0 && readStatus === "refreshed" ? (
        <section className={surfaceClass("secondary")}>
          <h3 className="font-semibold text-slate-900">No Team Exercise Results yet</h3>
          <p className="mt-2 text-sm text-slate-600">A result appears here after your athlete bundle has been accepted by the cloud.</p>
        </section>
      ) : results.length > 0 ? (
        <section className={surfaceClass("secondary")}>
          <h3 className="text-lg font-semibold text-slate-900">Your Team Exercise history</h3>
          <div className="mt-3 space-y-3">
            {results.map((record) => {
              const version = record.sharedExecution.exerciseVersionSnapshot;
              const summary = version.primaryFocus === "shotmaking" ? computeShotmakingResult(record.result) : null;
              return (
                <button key={record.result.id} type="button" onClick={() => setSelectedResultId(record.result.id)} className="min-h-11 w-full rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-200">
                  <p className="font-semibold text-slate-900">{version.title}</p>
                  <p className="mt-1 text-sm text-slate-500">{formatDate(record.sharedExecution.completedAt!)}</p>
                  <p className={`mt-2 text-sm ${record.isVoided ? "font-medium text-red-800" : "text-slate-700"}`}>
                    {record.isVoided
                      ? "Voided · Excluded from current calculations"
                      : summary
                        ? (summary.scoredStoneCount === 0 ? "No scored stones" : `${summary.averagePercentage?.toFixed(0)}% average · ${summary.points}/${summary.maximumPoints} points`)
                        : "Unscored Technique observation"}
                  </p>
                  {!record.isVoided && record.postCompletionRevisions.length > 0 && <p className="mt-1 text-xs font-medium text-amber-800">Changed after completion · Revision {record.postCompletionRevisions.length}</p>}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
