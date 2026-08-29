"use client";

import type { SportingCloudSyncContextValue } from "../ProfileScopedSportingPersistence";

type SportingSyncStatusControlProps = {
  cloudSync: Pick<
    SportingCloudSyncContextValue,
    "truth" | "pendingCount" | "teamBlockedCount" | "issueSummary" | "retry"
  >;
};

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Honest, bounded sync truth for the account header. Provider messages and
 * payload contents never enter the UI; athletes still get enough information
 * to distinguish personal-history, Team and general verification failures.
 */
export default function SportingSyncStatusControl({
  cloudSync,
}: SportingSyncStatusControlProps) {
  if (cloudSync.truth === "synced") {
    return (
      <span
        role="status"
        className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800"
      >
        Synced
      </span>
    );
  }

  if (cloudSync.truth === "saved_on_device") {
    return (
      <span
        role="status"
        className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
      >
        Saved on this device
      </span>
    );
  }

  const issues: string[] = [];
  if (cloudSync.issueSummary.personalRecordCount > 0) {
    issues.push(
      `${countLabel(cloudSync.issueSummary.personalRecordCount, "personal history record", "personal history records")} could not be verified.`
    );
  }
  if (cloudSync.issueSummary.teamRecordCount > 0) {
    issues.push(
      `${countLabel(cloudSync.issueSummary.teamRecordCount, "Team record", "Team records")} could not be verified.`
    );
  }
  if (cloudSync.teamBlockedCount > 0) {
    issues.push(
      `${countLabel(cloudSync.teamBlockedCount, "Team result", "Team results")} need permission before upload.`
    );
  }
  if (issues.length === 0 && cloudSync.issueSummary.hasGeneralIssue) {
    issues.push("Cloud verification could not be completed.");
  }

  return (
    <details className="group relative z-40">
      <summary className="min-h-11 cursor-pointer list-none rounded-full bg-rose-50 px-3 py-3 text-xs font-medium text-rose-800 marker:content-none">
        Sync issue · Details
      </summary>
      <div className="absolute right-0 mt-2 w-72 rounded-xl border border-rose-200 bg-white p-4 text-left shadow-xl">
        <p className="text-sm font-semibold text-slate-900">Your data is safe on this device</p>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
        {cloudSync.pendingCount > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {countLabel(cloudSync.pendingCount, "change is", "changes are")} waiting to sync.
          </p>
        )}
        <button
          type="button"
          onClick={cloudSync.retry}
          className="mt-3 min-h-11 w-full rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
        >
          Retry Sync
        </button>
      </div>
    </details>
  );
}
