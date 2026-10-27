"use client";

// The session-bound migration recovery view — Stage M3b4c
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6).
//
// DORMANT: no shipped path renders it. It is given an already-created
// `NativeMigrationSession` (which owns the runner) by whoever assembled it — in
// this stage, tests only.
//
// ## Responsibilities, and the ones it deliberately does not have
//
//   - It OBSERVES the session (`useSyncExternalStore`) and asks it to start once.
//     Strict Mode's replayed effect and re-renders call an idempotent `start()`.
//   - It never disposes the session or the runner. Unmounting only unsubscribes;
//     storage ownership stays with whoever created the session (§6.4, "UI
//     unsubscription and storage-owner disposal are distinct").
//   - Before B4 it renders the blocking surface and NOTHING ELSE, so no ordinary
//     consumer — identity, hydration, sync, retirement — exists.
//   - After a B4 handover it renders `children`. A B4 result is not readiness:
//     `children` must be the existing composition gate, which still obtains its
//     own activation verdict and owned composition before anything mounts.
//   - A disposed session is terminal: the view renders the closed state, never
//     `children` and never an actionable control — whether it was mounted when
//     the owner disposed it or attached afterwards.
//   - Report, clipboard and waiting state belong to ONE session: switching the
//     `session` prop starts from a clean surface and a fresh timer, and neither
//     disposes the previous session nor creates a runner.
//
// ## Honest waiting (§6.4)
//
// While a run has not answered, G1 is shown. After a presentation-only delay the
// copy adds that the app is still waiting. The delay changes text only: it never
// cancels, retries, releases or starts anything.
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { ENDED_PRESENTATION, buildMigrationDiagnosticReport } from "../../lib/persistence/nativeMigrationPresentation";
import type { NativeMigrationSession } from "../../lib/persistence/nativeMigrationSession";
import { MIGRATION_COPY } from "./migrationRecoveryCopy";
import NativeMigrationRecoverySurface from "./NativeMigrationRecoverySurface";

/** Engineering detail, not a product timeout (§6.4): when the waiting line appears. */
export const MIGRATION_WAITING_PRESENTATION_DELAY_MS = 8000;

/** A stable per-object identity for keys, so two sessions never share UI state. */
const sessionIds = new WeakMap<NativeMigrationSession, number>();
let nextSessionId = 0;
function sessionIdOf(session: NativeMigrationSession): number {
  let id = sessionIds.get(session);
  if (id === undefined) {
    nextSessionId += 1;
    id = nextSessionId;
    sessionIds.set(session, id);
  }
  return id;
}

export type NativeMigrationRecoveryViewProps = {
  session: NativeMigrationSession;
  /** The application/build version from non-secret build metadata, if known. */
  applicationVersion?: string | null;
  /** Rendered only after a B4 handover — the existing composition gate. */
  children?: ReactNode;
  /** Test seam for the clipboard; production leaves it undefined. */
  writeClipboard?: ((text: string) => Promise<void>) | null;
  /** Test seam for the presentation delay. */
  waitingDelayMs?: number;
};

export default function NativeMigrationRecoveryView({
  session,
  applicationVersion = null,
  children,
  writeClipboard,
  waitingDelayMs = MIGRATION_WAITING_PRESENTATION_DELAY_MS,
}: NativeMigrationRecoveryViewProps) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const sessionId = sessionIdOf(session);
  // Which session's run the waiting line belongs to: `${sessionId}:${runSequence}`.
  const [waitingFor, setWaitingFor] = useState<string | null>(null);

  useEffect(() => {
    session.start();
  }, [session]);

  const running = snapshot.status === "running" || snapshot.status === "handing_over";
  const runKey = `${sessionId}:${snapshot.runSequence}`;
  useEffect(() => {
    if (!running) return;
    // Presentation only. The timer's callback sets text state from a timer
    // callback, never synchronously in the effect body; a replaced session's
    // timer is cleared, and its key would not match the new run anyway.
    const timer = setTimeout(() => setWaitingFor(runKey), waitingDelayMs);
    return () => clearTimeout(timer);
  }, [running, runKey, waitingDelayMs]);

  if (snapshot.status === "access") {
    const note = snapshot.presentation.kind === "access" ? snapshot.presentation.retirement : null;
    return (
      <>
        {note !== null ? (
          <p className="mb-3 text-xs text-slate-600" role="note">
            {note.kind === "stalled" ? MIGRATION_COPY.retirementStalled : MIGRATION_COPY.retirementDeclined}
          </p>
        ) : null}
        {children}
      </>
    );
  }

  // A disposed session is terminal, however this view came to observe it.
  const presentation = snapshot.status === "disposed" ? ENDED_PRESENTATION : snapshot.presentation;
  const recheckAvailable =
    snapshot.status === "settled" && presentation.kind === "blocking" && presentation.recheck;

  return (
    <NativeMigrationRecoverySurface
      // A new session, run or outcome starts with no stale report on screen.
      key={`${runKey}:${snapshot.status}`}
      presentation={presentation}
      waiting={running && waitingFor === runKey}
      onRecheck={recheckAvailable ? () => void session.recheck() : undefined}
      buildDiagnosticReport={() =>
        buildMigrationDiagnosticReport({
          presentation,
          completedPlans: snapshot.completedPlans,
          earlierStoppedPlan: snapshot.lastStoppedPlan,
          applicationVersion,
        })
      }
      writeClipboard={writeClipboard}
    />
  );
}
