"use client";

import { useState } from "react";
import type { InvalidAttemptRow, ShotDetailRow } from "../lib/assessment/result";
import { formatAssessmentSignedSeconds } from "../lib/assessment/resultFormatting";
import { TARGET_ERROR_CATEGORY_LABELS } from "../lib/chartTheme";
import { HANDLE_LABELS } from "../lib/chartTheme";
import { ASSESSMENT_INVALID_REASON_LABELS } from "../lib/assessmentContent";
import { surfaceClass } from "./Surface";

type AssessmentShotDetailsProps = {
  shots: ShotDetailRow[];
  invalidAttempts: InvalidAttemptRow[];
  /** "bare" strips the outer surface — see AssessmentResultScreen's shared Breakdown grouping. */
  variant?: "card" | "bare";
};

/**
 * Compact, expandable shot-level detail — read-only (no delete/edit/
 * reclassify action, per the completed-run immutability rule). See Phase C
 * brief section 10.
 */
export default function AssessmentShotDetails({ shots, invalidAttempts, variant = "card" }: AssessmentShotDetailsProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={variant === "card" ? surfaceClass("secondary") : ""}>
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between text-left"
      >
        <h2 className="text-lg font-semibold text-slate-900">Shot Details</h2>
        <span className="text-xs font-medium text-slate-500">{expanded ? "Hide" : "Show"}</span>
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            {shots.map((shot) => (
              <div key={shot.plannedShotId} className="rounded-xl bg-slate-100 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-slate-900">
                    #{shot.globalShotNumber} · {shot.blockName}
                  </p>
                  <p className="text-xs text-slate-500">{TARGET_ERROR_CATEGORY_LABELS[shot.category]}</p>
                </div>
                <p className="mt-1 text-xs text-slate-600">
                  Target {shot.targetTime.toFixed(2)}s · Actual {shot.measuredTime.toFixed(2)}s ·{" "}
                  {formatAssessmentSignedSeconds(shot.signedError)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Expected {HANDLE_LABELS[shot.expectedHandle]} · Executed {HANDLE_LABELS[shot.executedHandle]}
                  {shot.hasProtocolDeviation && " · Protocol deviation"}
                </p>
              </div>
            ))}
          </div>

          {invalidAttempts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Invalid Attempts</h3>
              <div className="mt-2 space-y-2">
                {invalidAttempts.map((attempt, index) => (
                  <div key={`${attempt.plannedShotId}-${attempt.attemptNumber}-${index}`} className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                    {attempt.blockName} · Attempt {attempt.attemptNumber} ·{" "}
                    {attempt.invalidReason ? ASSESSMENT_INVALID_REASON_LABELS[attempt.invalidReason] : "Unknown reason"}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
