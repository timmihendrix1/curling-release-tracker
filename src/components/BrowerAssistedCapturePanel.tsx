"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import InfoButton from "./InfoButton";
import { surfaceClass } from "./Surface";
import {
  formatBrowerTruncatedHundredths,
  browerIntervalSeconds,
} from "../lib/brower/chronDecoder";
import {
  browerShotRange,
  type BrowerCandidate,
  type BrowerCaptureContext,
} from "../lib/brower/assistedCapture";
import type {
  BrowerAssistedCaptureController,
  BrowerAssistedCaptureView,
} from "../lib/brower/assistedCaptureController";
import { browerAssistedCaptureExplanation } from "../lib/helpContent";
import type { PersistenceWriteError } from "../lib/persistence/types";

/**
 * Whether a measurement that was applied in memory has actually been written.
 *
 * `pending` is a real third answer, not a softened success: the write has not
 * acknowledged yet, the measurement is in the session, and the athlete is told exactly
 * that rather than "saved".
 */
export type BrowerSaveAcknowledgement =
  | { kind: "saved" }
  | { kind: "pending" }
  | { kind: "save_failed"; error: PersistenceWriteError };

/**
 * What accepting a candidate actually did. The panel never decides this itself — it
 * reports exactly what the capture pipeline returned.
 *
 * `applied` deliberately separates "this became a shot in the session" from "this is
 * written". Nothing here ever reports a shot as saved, or as synchronised to the cloud,
 * before the corresponding acknowledgement arrives.
 */
export type BrowerAcceptOutcome =
  | {
      status: "applied";
      shotId: string;
      sessionId: string;
      shotNumber: number;
      releaseTime: number;
      durability: Promise<BrowerSaveAcknowledgement>;
    }
  | { status: "rejected"; message: string };

/** What the panel is currently telling the athlete about one accepted measurement. */
type AcceptanceReport =
  | { kind: "rejected"; message: string }
  | { kind: "applied"; shotNumber: number; releaseTime: number; saving: true }
  | { kind: "saved"; shotNumber: number; releaseTime: number }
  | { kind: "pending"; shotNumber: number; releaseTime: number }
  | {
      kind: "save_failed";
      shotNumber: number;
      releaseTime: number;
      detail: string;
      retrying: boolean;
    };

function describeWriteError(error: PersistenceWriteError): string {
  switch (error.kind) {
    case "quota_exceeded":
      return "This device has no storage space left.";
    case "storage_unavailable":
      return "Storage is unavailable on this device right now.";
    default:
      return "The write did not succeed.";
  }
}

type BrowerAssistedCapturePanelProps = {
  controller: BrowerAssistedCaptureController;
  /** Re-attempts the write for a measurement already applied to the session. */
  onRetrySave: (expected: { sessionId: string; shotId: string }) => Promise<BrowerSaveAcknowledgement>;
  /**
   * The capture context candidates may be accepted into, or null when there is no
   * active, eligible Training Capture Sequence. Null suspends any armed observation.
   */
  context: BrowerCaptureContext | null;
  onAccept: (candidate: BrowerCandidate) => Promise<BrowerAcceptOutcome>;
};

function useControllerView(
  controller: BrowerAssistedCaptureController
): BrowerAssistedCaptureView {
  const [view, setView] = useState(() => controller.getView());

  useEffect(() => {
    // The sanctioned bridge for an external async subscription (see CLAUDE.md):
    // subscribe inside the effect and setState from the subscription's callback,
    // never synchronously in the effect body.
    const unsubscribe = controller.subscribe(setView);
    return unsubscribe;
  }, [controller]);

  return view;
}

function CandidateRow({
  candidate,
  disabled,
  pending,
  onAccept,
  onDiscard,
}: {
  candidate: BrowerCandidate;
  disabled: boolean;
  pending: boolean;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const seconds = browerIntervalSeconds(candidate.intervalMs);

  return (
    <li className={surfaceClass("inset", "flex flex-col gap-3")}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-2xl font-semibold tabular-nums text-slate-900">
          {seconds.toFixed(3)}s
        </span>
        {/* The measured fact and the timer's own rendering of it, kept apart. The
            cumulative provenance behind both sits in Details. */}
        <span className="text-xs text-slate-500">
          Timer shows {formatBrowerTruncatedHundredths(candidate.intervalMs)}s
        </span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="min-h-11 flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
        >
          {pending ? "Recording…" : "Use for next shot"}
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={disabled}
          className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Discard
        </button>
      </div>
    </li>
  );
}

/**
 * Reports one accepted measurement, separating what is true of the SESSION from what is
 * true of STORAGE. "Recorded" never implies "saved", and neither ever implies
 * "synchronised" — no cloud acknowledgement exists on this path at all.
 *
 * `blocked` is presentation only: a past success must not be painted as "all is well"
 * while something is currently stopping capture. The result itself is never dropped.
 */
function AcceptanceNotice({
  report,
  blocked,
  onRetrySave,
}: {
  report: AcceptanceReport;
  blocked: boolean;
  onRetrySave: () => void;
}) {
  if (report.kind === "rejected") {
    return (
      <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        {report.message}
      </p>
    );
  }

  const shot = `Shot ${report.shotNumber} (${report.releaseTime.toFixed(3)}s)`;

  if (report.kind === "saved") {
    return (
      <p
        role="status"
        className={
          blocked
            ? "rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700"
            : "rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        }
      >
        {shot} saved on this device.
      </p>
    );
  }

  if (report.kind === "applied") {
    return (
      <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">
        {shot} · Saving…
      </p>
    );
  }

  if (report.kind === "pending") {
    return (
      <div role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
        <p>{shot} is in this session, but saving has not confirmed yet. Keep the app open.</p>
        <button type="button" onClick={onRetrySave} className="min-h-11 font-medium underline">Try saving again</button>
      </div>
    );
  }

  return (
    <div role="status" className="space-y-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p>
        {shot} is in this session but was <strong>not saved</strong>. {report.detail} It
        will be lost if you close the app before it saves.
      </p>
      <button
        type="button"
        onClick={onRetrySave}
        disabled={report.retrying}
        className="min-h-11 rounded-lg bg-amber-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-amber-700/60"
      >
        {report.retrying ? "Saving…" : "Try saving again"}
      </button>
    </div>
  );
}

/**
 * The assisted Brower capture surface inside Active Training.
 *
 * Filtered Back–Hog intervals are recorded automatically in order; unfiltered contexts
 * retain explicit selection. It never sends the timer a command and never claims a
 * measurement is fresh because it arrived recently — see
 * docs/BROWER_INTEGRATION_STATUS.md's pilot decision.
 *
 * Presentation rule (2026-10-01): the normal automatic state is one compact block —
 * status, filter summary and the latest acknowledgement. Counts, identifiers and
 * protocol explanations live in one native `<details>` disclosure; anything the athlete
 * must act on stays outside it. The disclosure holds no state of its own, so opening it
 * cannot touch the connection, arming, candidates or any subscription.
 */
export default function BrowerAssistedCapturePanel({
  controller,
  context,
  onAccept,
  onRetrySave,
}: BrowerAssistedCapturePanelProps) {
  const view = useControllerView(controller);
  const [pendingCandidateId, setPendingCandidateId] = useState<string | null>(null);
  const [report, setReport] = useState<AcceptanceReport | null>(null);
  /** Synchronous double-tap guard: checked and set before any await, unlike state. */
  const acceptInFlightRef = useRef<string | null>(null);
  /** Set once this panel unmounts, so a late acknowledgement never calls setState. */
  const mountedRef = useRef(true);
  const saveTargetRef = useRef<{ sessionId: string; shotId: string } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { capture } = view;
  const shotRange = context === null ? null : browerShotRange(context);
  const automatic = shotRange !== null;

  const publish = useCallback((next: AcceptanceReport | null) => {
    if (!mountedRef.current) return;
    setReport(next);
  }, []);

  const applyAcknowledgement = useCallback((
    acknowledgement: BrowerSaveAcknowledgement,
    shotNumber: number,
    releaseTime: number
  ) => {
    if (!mountedRef.current) return;
    if (acknowledgement.kind === "saved") {
      publish({ kind: "saved", shotNumber, releaseTime });
      return;
    }
    if (acknowledgement.kind === "pending") {
      controller.reconcileContext(null);
      publish({ kind: "pending", shotNumber, releaseTime });
      return;
    }
    controller.reconcileContext(null);
    publish({
      kind: "save_failed",
      shotNumber,
      releaseTime,
      detail: describeWriteError(acknowledgement.error),
      retrying: false,
    });
  }, [controller, publish]);

  const handleAccept = useCallback(async function handleAccept(candidate: BrowerCandidate) {
    // Two taps in the same tick must not both reach the capture pipeline. A ref is
    // checked and set synchronously; React state would not be.
    if (acceptInFlightRef.current !== null || report?.kind === "save_failed" || report?.kind === "pending") return;
    acceptInFlightRef.current = candidate.id;
    setPendingCandidateId(candidate.id);

    try {
      const outcome = await onAccept(candidate);
      if (!mountedRef.current) return;

      if (outcome.status === "rejected") {
        controller.reconcileContext(null);
        publish({ kind: "rejected", message: outcome.message });
        return;
      }

      // It is a shot in the session now, so the candidate is spent either way — a
      // second tap would only ever be a duplicate. What is NOT yet known is whether it
      // has been written, so that is reported separately and honestly.
      saveTargetRef.current = { sessionId: outcome.sessionId, shotId: outcome.shotId };
      controller.retireCandidate(candidate.id, "accepted");
      publish({
        kind: "applied",
        shotNumber: outcome.shotNumber,
        releaseTime: outcome.releaseTime,
        saving: true,
      });

      const acknowledgement = await outcome.durability;
      applyAcknowledgement(acknowledgement, outcome.shotNumber, outcome.releaseTime);
    } catch (error) {
      if (!mountedRef.current) return;
      controller.reconcileContext(null);
      publish({
        kind: "rejected",
        message:
          error instanceof Error
            ? `This time was not recorded: ${error.message}`
            : "This time was not recorded.",
      });
    } finally {
      acceptInFlightRef.current = null;
      if (mountedRef.current) setPendingCandidateId(null);
    }
  }, [onAccept, report, controller, publish, applyAcknowledgement]);

  // Process the oldest candidate only. Defer out of the effect and cancel stale
  // schedules on context/view changes (including StrictMode replay). handleAccept's
  // synchronous ref claim remains held until the local write has acknowledged.
  useEffect(() => {
    if (!automatic || view.capture.phase !== "armed" || view.busy ||
        pendingCandidateId !== null || report?.kind === "pending" ||
        report?.kind === "save_failed") return;
    const candidate = view.capture.candidates[0];
    if (candidate === undefined) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void handleAccept(candidate);
    });
    return () => { cancelled = true; };
  }, [automatic, view, context, pendingCandidateId, report, handleAccept]);

  if (!view.availability.supported) {
    return (
      <section className={surfaceClass("secondary", "space-y-2")}>
        <h3 className="font-medium text-slate-800">Timer Measurements</h3>
        <p className="text-sm text-slate-600">
          Connecting a timer is available in the installed iOS app. Type times in here.
        </p>
      </section>
    );
  }


  async function handleRetrySave() {
    if ((report?.kind !== "save_failed" && report?.kind !== "pending") ||
        (report.kind === "save_failed" && report.retrying) || saveTargetRef.current === null) return;
    const { shotNumber, releaseTime } = report;
    publish({ kind: "save_failed", shotNumber, releaseTime, detail: "Retrying the write.", retrying: true });

    const acknowledgement = await onRetrySave(saveTargetRef.current);
    applyAcknowledgement(acknowledgement, shotNumber, releaseTime);
  }

  function handleDiscard(candidate: BrowerCandidate) {
    if (acceptInFlightRef.current !== null || report?.kind === "save_failed" || report?.kind === "pending") return;
    controller.retireCandidate(candidate.id, "discarded");
    publish(null);
  }

  const controlsDisabled = view.busy || pendingCandidateId !== null || report?.kind === "save_failed" || report?.kind === "pending";
  const armingBlocker = controller.describeArmingBlocker();
  const canArm =
    view.status === "connected" && context !== null && !controlsDisabled && armingBlocker === null;
  const exhaustedKeys = capture.exhaustedRecordKeys;

  const connected = view.status === "connected";
  const armed = capture.phase === "armed";
  /**
   * Armed, but nothing can be offered: the bounded same-record recovery is waiting. The
   * state comes from the controller, not from reading its notice text.
   */
  const awaitingClearUpdate = armed && view.awaitingUnambiguousRecord;
  /**
   * Exhaustion belongs here as well as in `blocked`: a full timer record accepts no
   * further split, so an affirmative "Recording" would contradict the exhaustion
   * warning shown below. Dropping the affirmative prefix is presentational only — the
   * acceptance queue, the remaining valid candidates and their saves are untouched.
   */
  const recordingNow =
    connected && armed && automatic && !awaitingClearUpdate && exhaustedKeys.length === 0;

  /**
   * Anything that currently stops measurements arriving or being written. Used only to
   * stop a past success from reading as "all is well" — it hides nothing.
   */
  const blocked = !(
    connected &&
    armed &&
    !awaitingClearUpdate &&
    exhaustedKeys.length === 0 &&
    armingBlocker === null &&
    capture.droppedCandidateCount === 0
  );

  const filterSummary =
    context === null
      ? null
      : shotRange === null
        ? "No time filter — choose the interval for each shot"
        : `${shotRange.label} · ${shotRange.minMs / 1000}–${shotRange.maxMs / 1000} s`;


  return (
    <section className={surfaceClass("primary", "space-y-3")} aria-label="Timer Measurements">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-1 font-medium text-slate-800">
            Timer Measurements
            <InfoButton explanation={browerAssistedCaptureExplanation()} />
          </h3>
          <p className="text-xs text-slate-500">
            {connected
              ? `Connected to ${view.deviceName ?? "the timer"}.`
              : "Not connected."}
          </p>
        </div>

        {connected ? (
          <button
            type="button"
            onClick={() => void controller.disconnect()}
            disabled={view.busy}
            className="min-h-11 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void controller.connect()}
            disabled={view.busy}
            className="min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {view.status === "connecting" ? "Connecting…" : "Connect timer"}
          </button>
        )}
      </div>

      {/* The whole normal state in one line: what is being recorded, and within what. */}
      {filterSummary !== null && (
        <p className="text-xs text-slate-600">
          {recordingNow ? `Recording · ${filterSummary}` : filterSummary}
        </p>
      )}

      {/* Armed is not the same as receiving. Nothing can be offered while recovering. */}
      {awaitingClearUpdate && (
        <p role="status" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Waiting for a clear update from the same timer record. Nothing is recorded until
          it arrives. If it does not, disconnect, reconnect and confirm setup again.
        </p>
      )}

      {view.notice !== null && !awaitingClearUpdate && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700" role="status">
          {view.notice}
        </p>
      )}

      {connected && context === null && (
        <p className="text-sm text-slate-600">
          Start a capture sequence to record measured times.
        </p>
      )}

      {connected && !armed && context !== null && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700">
            {capture.phase === "suspended"
              ? "Measurements are paused. Confirm the setup again to resume."
              : "Set up your gates and stones first, then confirm."}
          </p>
          {armingBlocker !== null && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {armingBlocker}
            </p>
          )}
          <button
            type="button"
            onClick={() => context !== null && controller.arm(context)}
            disabled={!canArm}
            className="min-h-11 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            Setup checked — start receiving measurements
          </button>
        </div>
      )}

      {/* Unfiltered contexts still assign every time by hand, so their candidates and
          controls stay in full view; only the provenance moved into Details. */}
      {armed && !automatic && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-800">
              {capture.candidates.length === 0
                ? "Waiting for the next measurement"
                : `${capture.candidates.length} measurement${capture.candidates.length === 1 ? "" : "s"} to assign`}
            </p>
            {capture.candidates.length > 0 && (
              <button
                type="button"
                onClick={() => controller.discardAllCandidates()}
                disabled={controlsDisabled}
                className="min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Discard all
              </button>
            )}
          </div>

          {capture.candidates.length > 0 && (
            <ul className="space-y-2">
              {[...capture.candidates].reverse().map((candidate) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  disabled={controlsDisabled}
                  pending={pendingCandidateId === candidate.id}
                  onAccept={() => void handleAccept(candidate)}
                  onDiscard={() => handleDiscard(candidate)}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {report !== null && (
        <AcceptanceNotice
          report={report}
          blocked={blocked}
          onRetrySave={() => void handleRetrySave()}
        />
      )}

      {exhaustedKeys.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Timer record {exhaustedKeys.join(", ")} is full at its 20-split limit. Start a
          new record on the timer, then confirm the setup again.
        </p>
      )}

      {capture.droppedCandidateCount > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {capture.droppedCandidateCount} older measurement
          {capture.droppedCandidateCount === 1 ? " is" : "s are"} no longer available and
          cannot be assigned.
        </p>
      )}

      {capture.rejectedAssemblyCount > 0 && (
        <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          A timer reading could not be received completely. No measurement was added.
          {capture.lastRejectionReason && ` ${capture.lastRejectionReason}`}
        </p>
      )}
      {capture.phase === "suspended" && capture.suspendedReason && (
        <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          Measurements paused: {capture.suspendedReason}
        </p>
      )}

    </section>
  );
}
