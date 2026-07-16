"use client";

import { useEffect, useRef } from "react";
import type { InvalidAttemptReason } from "../lib/assessment/types";
import { ASSESSMENT_INVALID_REASON_OPTIONS } from "../lib/assessmentContent";

type AssessmentInvalidAttemptDialogProps = {
  onSelectReason: (reason: InvalidAttemptReason) => void;
  onCancel: () => void;
};

/**
 * Invalid-attempt reason picker — only objective/technical reasons are ever
 * offered here (see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md
 * section 19); a sporting complaint (missed target, wrong weight, wrong
 * handle, dissatisfaction) has no button here by design.
 */
export default function AssessmentInvalidAttemptDialog({
  onSelectReason,
  onCancel,
}: AssessmentInvalidAttemptDialogProps) {
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="fixed inset-0 bg-slate-950/60" onClick={onCancel} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="invalid-attempt-dialog-title"
        className="relative z-10 w-full max-w-sm rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl"
      >
        <h2 id="invalid-attempt-dialog-title" className="text-base font-semibold text-slate-900">
          Why was this attempt invalid?
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Only technical or objective reasons — a poor or missed shot is still a valid,
          scored attempt.
        </p>

        <div className="mt-4 space-y-2">
          {ASSESSMENT_INVALID_REASON_OPTIONS.map((option, index) => (
            <button
              key={option.reason}
              ref={index === 0 ? firstButtonRef : undefined}
              type="button"
              onClick={() => onSelectReason(option.reason)}
              className="block w-full rounded-xl bg-slate-100 px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-200"
            >
              {option.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onCancel}
          className="mt-4 w-full rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
