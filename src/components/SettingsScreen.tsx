import { surfaceClass } from "./Surface";

type SettingsScreenProps = {
  hasHistory: boolean;
  onExportHistoryCsv: () => void;
  onClearHistory: () => void;
};

/**
 * "How should the platform behave?" For this slice that's only the
 * app-wide data-management actions that used to live in the History view —
 * they act on the whole history, not one session or block, so they belong
 * here rather than under Analyze. Session-specific settings (title/notes,
 * fixed-target adjustment) stay in Train, next to the session they affect —
 * see docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md.
 */
export default function SettingsScreen({
  hasHistory,
  onExportHistoryCsv,
  onClearHistory,
}: SettingsScreenProps) {
  return (
    <div className="space-y-4">
      {/* Settings' one Hero (Epic 1) — the page-level PageHeader above
          already identifies this screen as "Settings", so this no longer
          repeats that title in its own card (DESIGN_SYSTEM.md §32 Priority 2). */}
      <div className={surfaceClass("hero")}>
        <h2 className="text-lg font-semibold text-slate-900">
          Data Management
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Export your locally stored training history.
        </p>

        <button
          type="button"
          onClick={onExportHistoryCsv}
          disabled={!hasHistory}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Export History CSV
        </button>

        {!hasHistory && (
          <p className="mt-3 text-xs text-slate-500">
            No completed sessions yet — nothing to export or clear.
          </p>
        )}
      </div>

      {/* Inline section — one descriptive paragraph, no controls, so it
          doesn't need a full elevated card (DESIGN_SYSTEM.md §10.6). */}
      <div className="px-1">
        <h2 className="text-sm font-semibold text-slate-500">
          Data &amp; Privacy
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Your training data is stored locally on this device. No account,
          cloud sync or server storage is currently used.
        </p>
      </div>

      {/* Destructive action kept in its own, clearly separated section
          (DESIGN_SYSTEM.md §12.4) rather than sharing a card with the
          non-destructive export action above. */}
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-lg font-semibold text-red-900">Clear Data</h2>
        <p className="mt-1 text-sm text-red-700">
          Permanently delete the entire session history from this device.
          This cannot be undone.
        </p>

        <button
          type="button"
          onClick={onClearHistory}
          disabled={!hasHistory}
          className="mt-4 w-full rounded-xl bg-red-100 px-4 py-3 font-medium text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:bg-red-50/60 disabled:text-red-300"
        >
          Clear History
        </button>
      </div>
    </div>
  );
}
