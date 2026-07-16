"use client";

import { useEffect, useRef } from "react";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../lib/assessment/templates";
import { MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT } from "../lib/assessment/attempts";
import {
  ASSESSMENT_ABANDON_EXPLANATION,
  ASSESSMENT_SETUP_NOTES,
  ASSESSMENT_SETUP_REQUIREMENTS,
  ASSESSMENT_WHAT_IT_DOES_NOT_MEASURE,
  ASSESSMENT_WHAT_IT_MEASURES,
  ASSESSMENT_WHY_STRUCTURE,
  ASSESSMENT_WRONG_HANDLE_NOTICE,
} from "../lib/assessmentContent";
import AssessmentSetupDiagram from "./AssessmentSetupDiagram";

type AssessmentProtocolSheetProps = {
  open: boolean;
  onClose: () => void;
};

const template = RELEASE_TIME_CORE_ASSESSMENT_V1;

/**
 * The full, permanently-accessible Release Time Core Assessment v1 protocol
 * — purpose, blocks, targets, handles, warm-up, thresholds, setup diagram,
 * invalid-attempt/wrong-handle rules, pause/abandon rules — reachable from
 * Overview, during execution (Info access), and from the Completion Summary.
 * See docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 30.
 */
export default function AssessmentProtocolSheet({ open, onClose }: AssessmentProtocolSheetProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-slate-950/60" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assessment-protocol-title"
        className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="assessment-protocol-title" className="text-lg font-semibold text-slate-900">
            {template.name} v{template.version} — Protocol
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close protocol"
            className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            Close
          </button>
        </div>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Purpose</h3>
          <p className="mt-1 text-sm text-slate-600">{template.description}</p>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">What this assessment measures</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-600">
            {ASSESSMENT_WHAT_IT_MEASURES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">{ASSESSMENT_WHAT_IT_DOES_NOT_MEASURE}</p>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Why this structure</h3>
          <p className="mt-1 text-sm text-slate-600">{ASSESSMENT_WHY_STRUCTURE}</p>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Warm-up ({template.warmupShots.length} unscored stones)
          </h3>
          <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-sm text-slate-600">
            {template.warmupShots.map((shot) => (
              <li key={shot.id}>
                {shot.targetTime.toFixed(2)}s — {shot.expectedHandle === "in" ? "In" : "Out"}
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">
            Blocks ({template.protocolMetadata.scoredShotCount} scored stones)
          </h3>
          <div className="mt-1 space-y-2">
            {template.blocks.map((block, index) => (
              <div key={block.id} className="rounded-xl bg-slate-50 p-3">
                <p className="text-sm font-medium text-slate-900">
                  {index + 1}. {block.name}
                </p>
                <p className="mt-0.5 text-xs text-slate-600">{block.purpose}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {block.plannedShots.map((shot) => shot.targetTime.toFixed(2)).join(", ")}s ·{" "}
                  {block.plannedShots.filter((shot) => shot.expectedHandle === "in").length} In /{" "}
                  {block.plannedShots.filter((shot) => shot.expectedHandle === "out").length} Out
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Setup</h3>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-slate-600">
            {ASSESSMENT_SETUP_REQUIREMENTS.map((requirement) => (
              <li key={requirement}>{requirement}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">{ASSESSMENT_SETUP_NOTES}</p>
          <div className="mt-3">
            <AssessmentSetupDiagram />
          </div>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Invalid attempts</h3>
          <p className="mt-1 text-sm text-slate-600">
            A technically invalid attempt (e.g. a timing failure) may be repeated, up to{" "}
            {MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT} times per planned shot. A missed target,
            wrong weight, or other execution outcome is never an invalid-attempt reason — it
            remains a valid, scored attempt.
          </p>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Wrong handle</h3>
          <p className="mt-1 text-sm text-slate-600">{ASSESSMENT_WRONG_HANDLE_NOTICE}</p>
        </section>

        <section className="mt-4">
          <h3 className="text-sm font-semibold text-slate-900">Pause and abandon</h3>
          <p className="mt-1 text-sm text-slate-600">
            The run can be paused at any time and resumed later without losing progress.{" "}
            {ASSESSMENT_ABANDON_EXPLANATION}
          </p>
        </section>
      </div>
    </div>
  );
}
