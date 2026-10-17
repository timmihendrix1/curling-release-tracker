"use client";

import { useId, useRef, useState } from "react";
import { parseReleaseTime } from "../lib/timeInput";
import { surfaceClass } from "./Surface";

type AssessmentAttemptEntryProps = {
  onSubmitManualTime: (value: number) => void;
  onOpenInvalidDialog: () => void;
  invalidAttemptCount: number;
  maxInvalidAttempts: number;
  captureStatusMessage?: string;
};

/**
 * Manual timing entry for the current planned shot, reusing the app's
 * existing parse/validate convention (timeInput.ts) rather than inventing a
 * new numeric input semantics — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 16. A ref
 * (not state) guards against a double submit within the same synchronous
 * tick, matching AutoCapture.tsx's manual-result guard.
 */
export default function AssessmentAttemptEntry({
  onSubmitManualTime,
  onOpenInvalidDialog,
  invalidAttemptCount,
  maxInvalidAttempts,
  captureStatusMessage,
}: AssessmentAttemptEntryProps) {
  const inputId = useId();
  const [value, setValue] = useState("");
  const submittingRef = useRef(false);

  function handleSubmit() {
    if (submittingRef.current) return;
    const parsed = parseReleaseTime(value);
    if (parsed === null || parsed <= 0) {
      alert("Please enter a valid measured time.");
      return;
    }
    submittingRef.current = true;
    Promise.resolve().then(() => {
      submittingRef.current = false;
    });
    onSubmitManualTime(parsed);
    setValue("");
  }

  const invalidLimitReached = invalidAttemptCount >= maxInvalidAttempts;

  return (
    // Immediately accessible, essential control — but must not compete with
    // the Current Planned Shot Hero above it (Epic 1).
    <div className={surfaceClass("primary")}>
      <div className="house-measured-field">
      <label htmlFor={inputId} className="text-sm font-medium">Enter measured time (s)</label>
      <div className="mt-2 flex flex-col gap-3">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="3.75 or 375"
          enterKeyHint="done"
          className="w-full min-w-0"
        />
        <button
          type="button"
          onClick={handleSubmit}
          className="house-action house-action-inverse"
        >
          Record
        </button>
      </div>

      </div>
      {captureStatusMessage && (
        <p className="mt-2 text-xs text-slate-500">{captureStatusMessage}</p>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          Invalid attempts for this shot: {invalidAttemptCount} / {maxInvalidAttempts}
        </p>
        <button
          type="button"
          onClick={onOpenInvalidDialog}
          disabled={invalidLimitReached}
          className="min-h-11 whitespace-nowrap rounded-lg bg-red-50 px-3 text-xs font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Mark attempt invalid
        </button>
      </div>

      {invalidLimitReached && (
        <p className="mt-2 text-xs font-medium text-amber-700">
          Resolve the timing issue before continuing.
        </p>
      )}
    </div>
  );
}
