"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AnalyticsExplanation } from "../lib/analyticsExplanations";

type InfoButtonProps = {
  explanation: AnalyticsExplanation;
};

/**
 * The one Info affordance every metric/chart uses (see
 * docs/SYSTEM_ARCHITECTURE.md's "Metric and chart explanation architecture").
 * Renders as an anchored popover on wide screens and a bottom sheet on narrow
 * ones via CSS breakpoints alone — same markup, no separate mobile
 * implementation to keep in sync. Keyboard-operable: Escape closes and
 * returns focus to the trigger; the panel itself is reachable by Tab.
 */
export default function InfoButton({ explanation }: InfoButtonProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  return (
    <span className="relative inline-block align-middle">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${explanation.title}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600 transition hover:bg-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        i
      </button>

      {open && (
        <>
          {/* Backdrop — mobile only, closes the bottom sheet on outside tap. */}
          <div
            className="fixed inset-0 z-40 sm:hidden"
            onClick={close}
            aria-hidden="true"
          />

          <div
            id={panelId}
            role="dialog"
            aria-label={explanation.title}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl bg-white p-5 text-left shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:z-30 sm:mt-2 sm:max-h-none sm:w-80 sm:rounded-2xl sm:border sm:border-slate-200 sm:p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-base font-semibold text-slate-900">
                {explanation.title}
              </h3>

              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
              >
                Close
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-600">
              {explanation.whatItShows}
            </p>

            {explanation.howToRead.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-600">
                {explanation.howToRead.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}

            {explanation.betterMeans.length > 0 && (
              <p className="mt-2 text-sm text-slate-600">
                <span className="font-medium text-slate-800">
                  Better means:{" "}
                </span>
                {explanation.betterMeans.join(" ")}
              </p>
            )}

            {explanation.possiblePatterns &&
              explanation.possiblePatterns.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-600">
                  {explanation.possiblePatterns.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}

            {explanation.limitations && explanation.limitations.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">
                {explanation.limitations.join(" ")}
              </p>
            )}
          </div>
        </>
      )}
    </span>
  );
}
