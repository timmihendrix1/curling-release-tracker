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
      <div className="rounded-2xl bg-white p-4 shadow-lg">
        <h2 className="text-xl font-semibold text-slate-900">Settings</h2>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-slate-900">Data Management</h2>

        <p className="mt-2 text-sm text-slate-600">
          Export or clear your locally stored training history.
        </p>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onExportHistoryCsv}
            disabled={!hasHistory}
            className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Export History CSV
          </button>

          <button
            type="button"
            onClick={onClearHistory}
            disabled={!hasHistory}
            className="flex-1 rounded-xl bg-red-100 px-4 py-3 font-medium text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:bg-red-50 disabled:text-red-300"
          >
            Clear History
          </button>
        </div>

        {!hasHistory && (
          <p className="mt-3 text-xs text-slate-500">
            No completed sessions yet — nothing to export or clear.
          </p>
        )}
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-lg">
        <h2 className="text-xl font-semibold text-slate-900">
          Data &amp; Privacy
        </h2>

        <p className="mt-2 text-sm text-slate-600">
          Your training data is stored locally on this device. No account,
          cloud sync or server storage is currently used.
        </p>
      </div>
    </div>
  );
}
