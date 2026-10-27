"use client";

// The blocking migration recovery surface — Stage M3b4c
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6).
//
// Purely presentational: it renders one `MigrationPresentation` and calls back
// for the only actions that presentation permits. It reads no storage, fetches
// no evidence and holds no ownership. Copy is centralised in
// `migrationRecoveryCopy.ts`.
//
// What it offers, by group (§6.3, §6.5–§6.7, UG-1, UG-2):
//   - G1: a status, and an honest waiting line after a presentation-only delay;
//   - G2: "Check again";
//   - G3 and G4: no recheck and no continue action;
//   - every blocking group: an error code in collapsible technical details,
//     explanatory help, and a diagnostic report generated only on request.
// There is no repair, reset, "continue anyway", "choose a copy" or contact action.
//
// Progressive disclosure uses native <details> elements rather than
// `InfoButton`: the Info-button content shapes describe metrics and training
// concepts ("Purpose", "Useful for"), which do not fit a blocking recovery
// screen, and a disclosure stays readable and keyboard-operable on a screen that
// has no other content.
import { useEffect, useId, useRef, useState } from "react";
import type { MigrationPresentation } from "../../lib/persistence/nativeMigrationPresentation";
import {
  MIGRATION_COPY,
  MIGRATION_ENDED_TEXT,
  MIGRATION_ENDED_TITLE,
  MIGRATION_EXPLANATION_TEXT,
  MIGRATION_GROUP_TITLE,
  MIGRATION_HELP_TEXT,
  MIGRATION_RUNNING_TEXT,
  MIGRATION_WAITING_TEXT,
} from "./migrationRecoveryCopy";

type CopyState = "idle" | "copying" | "copied" | "failed" | "unavailable";

export type NativeMigrationRecoverySurfaceProps = {
  presentation: MigrationPresentation;
  /** G1 only: the presentation-only waiting threshold has passed (§6.4). */
  waiting?: boolean;
  /** Present only when the controller would accept a recheck. */
  onRecheck?: () => void;
  /** Builds the restricted report text. Called only on the user's request. */
  buildDiagnosticReport: () => string;
  /** Injected for tests; defaults to the browser clipboard where one exists. */
  writeClipboard?: ((text: string) => Promise<void>) | null;
};

function defaultClipboard(): ((text: string) => Promise<void>) | null {
  if (typeof navigator === "undefined") return null;
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof clipboard.writeText !== "function") return null;
  return (text) => clipboard.writeText(text);
}

const SECTION = "w-full max-w-xl rounded-2xl border p-5 shadow-sm";
const BUTTON =
  "min-h-11 rounded-lg px-4 py-2 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";

export default function NativeMigrationRecoverySurface({
  presentation,
  waiting = false,
  onRecheck,
  buildDiagnosticReport,
  writeClipboard,
}: NativeMigrationRecoverySurfaceProps) {
  const headingId = useId();
  const reportId = useId();
  const [report, setReport] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  // Each report gets a token; a clipboard answer for an older report — or one
  // arriving after this surface was replaced — never changes what is shown.
  const reportToken = useRef(0);
  useEffect(
    () => () => {
      // A replaced or unmounted surface ignores any clipboard answer still pending.
      reportToken.current += 1;
    },
    []
  );

  if (presentation.kind === "running") {
    return (
      <section
        className={`${SECTION} border-slate-200 bg-white`}
        role="status"
        aria-live="polite"
        aria-labelledby={headingId}
      >
        <h1 id={headingId} className="text-lg font-semibold text-slate-950">
          {MIGRATION_GROUP_TITLE.G1}
        </h1>
        <p className="mt-2 text-sm text-slate-600">{MIGRATION_RUNNING_TEXT}</p>
        {waiting ? <p className="mt-2 text-sm text-slate-600">{MIGRATION_WAITING_TEXT}</p> : null}
      </section>
    );
  }

  if (presentation.kind === "access") {
    // Not a ready state: the caller decides what follows a B4 handover.
    return null;
  }

  if (presentation.kind === "ended") {
    // Terminal: no action, no diagnostics, nothing actionable from a closed session.
    return (
      <section className={`${SECTION} border-slate-300 bg-slate-50`} role="status" aria-labelledby={headingId}>
        <h1 id={headingId} className="text-lg font-semibold text-slate-950">
          {MIGRATION_ENDED_TITLE}
        </h1>
        <p className="mt-2 text-sm text-slate-700">{MIGRATION_ENDED_TEXT}</p>
      </section>
    );
  }

  const { group } = presentation;
  const tone =
    group === "G4"
      ? { section: "border-slate-300 bg-slate-50", title: "text-slate-950", body: "text-slate-700", button: "bg-slate-900 text-white focus-visible:ring-slate-500" }
      : { section: "border-amber-300 bg-amber-50", title: "text-amber-950", body: "text-amber-900", button: "bg-amber-900 text-white focus-visible:ring-amber-600" };
  const recheckOffered = group === "G2" && presentation.recheck && typeof onRecheck === "function";
  const errorCode = [group, ...presentation.codes].join(" · ");

  async function copyReport(text: string) {
    const token = reportToken.current;
    const write = writeClipboard === undefined ? defaultClipboard() : writeClipboard;
    if (write === null) {
      setCopyState("unavailable");
      return;
    }
    setCopyState("copying");
    let outcome: CopyState;
    try {
      await write(text);
      outcome = "copied";
    } catch {
      outcome = "failed";
    }
    if (reportToken.current === token) setCopyState(outcome);
  }

  return (
    <section className={`${SECTION} ${tone.section}`} role="alert" aria-labelledby={headingId}>
      <h1 id={headingId} className={`text-lg font-semibold break-words ${tone.title}`}>
        {MIGRATION_GROUP_TITLE[group]}
      </h1>
      {MIGRATION_EXPLANATION_TEXT[presentation.explanation].map((sentence) => (
        <p key={sentence} className={`mt-2 text-sm ${tone.body}`}>
          {sentence}
        </p>
      ))}

      {recheckOffered ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" className={`${BUTTON} ${tone.button}`} onClick={onRecheck}>
            {MIGRATION_COPY.recheck}
          </button>
        </div>
      ) : null}

      <details className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer rounded px-1 py-3 text-sm font-semibold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">{MIGRATION_COPY.helpSummary}</summary>
        {MIGRATION_HELP_TEXT[group].map((sentence) => (
          <p key={sentence} className="mt-2 text-sm text-slate-700">
            {sentence}
          </p>
        ))}
      </details>

      <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
        <summary className="min-h-11 cursor-pointer rounded px-1 py-3 text-sm font-semibold text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500">{MIGRATION_COPY.detailsSummary}</summary>
        <p className="mt-2 text-sm text-slate-700">
          <span className="font-semibold">{MIGRATION_COPY.codeLabel}: </span>
          <code className="break-all">{errorCode}</code>
        </p>
        <p className="mt-2 text-xs text-slate-600">{MIGRATION_COPY.reportNote}</p>
        <div className="mt-3 flex flex-wrap gap-3">
          <button
            type="button"
            className={`${BUTTON} border border-slate-300 bg-white text-slate-900 focus-visible:ring-slate-500`}
            onClick={() => {
              reportToken.current += 1;
              setReport(buildDiagnosticReport());
              setCopyState("idle");
            }}
          >
            {MIGRATION_COPY.createReport}
          </button>
          {report !== null ? (
            <button
              type="button"
              className={`${BUTTON} border border-slate-300 bg-white text-slate-900 focus-visible:ring-slate-500`}
              disabled={copyState === "copying"}
              onClick={() => void copyReport(report)}
            >
              {MIGRATION_COPY.copyReport}
            </button>
          ) : null}
        </div>
        {report !== null ? (
          <>
            <label htmlFor={reportId} className="mt-3 block text-xs font-semibold text-slate-700">
              {MIGRATION_COPY.reportLabel}
            </label>
            <textarea
              id={reportId}
              readOnly
              value={report}
              rows={8}
              className="mt-1 block w-full resize-y rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-800"
            />
          </>
        ) : null}
        <p className="mt-2 text-sm text-slate-700" role="status" aria-live="polite">
          {copyState === "copied"
            ? MIGRATION_COPY.copied
            : copyState === "failed"
              ? MIGRATION_COPY.copyFailed
              : copyState === "unavailable"
                ? MIGRATION_COPY.copyUnavailable
                : ""}
        </p>
      </details>
    </section>
  );
}
