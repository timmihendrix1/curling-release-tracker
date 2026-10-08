"use client";

/**
 * Truthful durability feedback for manually recorded stones, and the retry that goes
 * with it.
 *
 * Rendered by TrackerApp beside whichever recording surface is active, NOT inside one
 * of them. Every runner reaches the same recording boundary — Fixed/Variable entry,
 * Blind Weight, and a curated exercise that leaves an earlier stone outstanding — so a
 * failure belonging to any of them has to be visible and retryable wherever the
 * athlete now is. Living inside `ShotEntry` meant a Blind Weight failure had no
 * reachable retry at all.
 *
 * One entry per outstanding operation, because two stones can legitimately be in
 * flight at once and each needs its own status and its own correctly addressed retry.
 */
export type ShotSubmissionStatus = {
  operationId: string;
  status: "pending" | "failed";
  message?: string;
  /** Enough identity for the athlete to know WHICH stone is outstanding. */
  description: string;
};

type ShotSaveStatusProps = {
  submissions: ShotSubmissionStatus[];
  /** True when a stone from this exercise was acknowledged and nothing is outstanding. */
  acknowledged?: boolean;
  onRetry?: (operationId: string) => void;
  disabled?: boolean;
};

export default function ShotSaveStatus({
  submissions,
  acknowledged = false,
  onRetry,
  disabled = false,
}: ShotSaveStatusProps) {
  if (submissions.length === 0 && !acknowledged) return null;

  return (
    <div className="space-y-2">
      {submissions.map((submission) =>
        submission.status === "pending" ? (
          <p
            key={submission.operationId}
            role="status"
            className="px-1 text-sm text-slate-500"
          >
            Saving {submission.description}…
          </p>
        ) : (
          <div
            key={submission.operationId}
            role="alert"
            className="rounded-xl bg-red-50 p-3"
          >
            <p className="text-sm text-red-700">
              {submission.message ?? "That shot could not be saved yet."}{" "}
              {submission.description} is still here.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={() => onRetry(submission.operationId)}
                disabled={disabled}
                className="mt-2 min-h-11 w-full rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Retry Saving
              </button>
            )}
          </div>
        )
      )}

      {acknowledged && submissions.length === 0 && (
        <p role="status" className="px-1 text-sm text-slate-600">
          Shot saved.
        </p>
      )}
    </div>
  );
}
