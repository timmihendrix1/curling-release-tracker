"use client";

import { useState } from "react";
import type { OwnedTeamExerciseResultRecord } from "../lib/cloudSporting/teamExerciseRecords";
import type { TeamExercisePrivateNoteUpdateOutcome } from "../lib/cloudSporting/syncManager";
import { computeShotmakingResult } from "../lib/exercises/executionResult";
import { getTeamAttemptRoleContext } from "../lib/exercises/teamExecution";
import type {
  ExerciseActiveAttemptCorrection,
  ShotmakingExclusionReason,
  ShotmakingExerciseAttempt,
} from "../lib/exercises/executionTypes";
import { measurementUnitLabel } from "../lib/exercises/presentation";
import { serializeOwnedTeamExerciseResultExport } from "../lib/exercises/teamResultExport";
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

function ResultDetail({
  record,
  onBack,
  onSetPrivateNote,
}: {
  record: OwnedTeamExerciseResultRecord;
  onBack(): void;
  onSetPrivateNote: Props["onSetPrivateNote"];
}) {
  const [note, setNote] = useState(record.privateNote?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const noteByteLength = new TextEncoder().encode(note).byteLength;
  const noteTooLong = noteByteLength > PRIVATE_NOTE_MAX_BYTES;
  const execution = record.sharedExecution;
  const version = execution.exerciseVersionSnapshot;
  const context = execution.teamContext;
  const shotmaking = version.primaryFocus === "shotmaking";
  const summary = shotmaking ? computeShotmakingResult(record.result) : null;

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

      <section className={surfaceClass("primary")}>
        <h3 className="text-lg font-semibold text-slate-900">Your result</h3>
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
              </li>
            ))}
          </ol>
        )}
      </section>

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
        {message && <p role="status" className="mt-3 text-sm text-slate-600">{message}</p>}
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
}: Props) {
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const selected = results.find((record) => record.result.id === selectedResultId) ?? null;
  if (selected) {
    return <ResultDetail key={selected.result.id} record={selected} onBack={() => setSelectedResultId(null)} onSetPrivateNote={onSetPrivateNote} />;
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
                  <p className="mt-2 text-sm text-slate-700">{summary ? (summary.scoredStoneCount === 0 ? "No scored stones" : `${summary.averagePercentage?.toFixed(0)}% average · ${summary.points}/${summary.maximumPoints} points`) : "Unscored Technique observation"}</p>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
