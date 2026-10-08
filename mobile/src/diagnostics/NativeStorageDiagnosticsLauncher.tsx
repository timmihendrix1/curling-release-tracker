import { useState, useSyncExternalStore } from "react";
import {
  DURABILITY_CLAIM_LABELS,
  getNativeStorageDiagnosticsController,
  type DiagnosticsLogEntry,
  type NativeStorageDiagnosticsController,
} from "./nativeStorageDiagnosticsController";
import { SYNTHETIC_FIXTURES } from "./syntheticFixtures";

/**
 * The opt-in native storage diagnostics surface.
 *
 * It is a LAUNCHER plus an overlay, not a replacement for the app: the normal
 * application stays mounted underneath and is one "Close" away, so a diagnostics
 * build is still a usable build of the real app. It renders outside the identity
 * gate on purpose and shows no sporting data of any kind — it only ever touches
 * its own synthetic database — so it neither needs nor weakens an identity
 * guard.
 *
 * This module is only ever reached from a build that set the explicit opt-in
 * (`mobile/storageDiagnosticsFlag.ts`); `MobileApp.tsx` folds the import away
 * entirely otherwise.
 *
 * Nothing here runs on mount. Every read and every write is a deliberate button
 * press, because opening the panel and silently rewriting the fixtures would
 * destroy the evidence a restart check depends on.
 */
export default function NativeStorageDiagnosticsLauncher() {
  const [open, setOpen] = useState(false);
  const controller = getNativeStorageDiagnosticsController();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-50 min-h-11 rounded-full border border-slate-300 bg-white/95 px-4 text-sm font-medium text-slate-700 shadow-lg"
      >
        Storage diagnostics
      </button>
    );
  }

  return <DiagnosticsPanel controller={controller} onClose={() => setOpen(false)} />;
}

function DiagnosticsPanel({
  controller,
  onClose,
}: {
  controller: NativeStorageDiagnosticsController;
  onClose: () => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const native = snapshot.platform === "ios" || snapshot.platform === "android";

  const actions: { label: string; run: () => void }[] = [
    { label: "Write synthetic fixtures", run: () => void controller.writeFixtures() },
    { label: "Verify in this app session", run: () => void controller.verifyCurrentSession() },
    { label: "Update and remove a test key", run: () => void controller.exerciseUpdateAndRemove() },
    { label: "Close and reopen the database", run: () => void controller.closeAndReopen() },
    { label: "Verify after app restart", run: () => void controller.verifyAfterRestart() },
    { label: "Read effective SQLite settings", run: () => void controller.readSettings() },
    { label: "Delete the synthetic data", run: () => void controller.clearSyntheticDatabase() },
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-100 app-content-clearance">
      <div className="mx-auto w-full max-w-xl space-y-4 px-4 py-4">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Native storage diagnostics</h1>
            <p className="text-sm text-slate-600">
              Synthetic data only. The app&apos;s own records are untouched and keep using their
              existing storage.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-2xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700"
          >
            Close
          </button>
        </header>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <dl className="space-y-1">
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Platform</dt>
              <dd className="font-mono">{snapshot.platform}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Database</dt>
              <dd className="font-mono break-all text-right">{snapshot.databaseName}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">App session</dt>
              <dd className="font-mono break-all text-right">{snapshot.sessionId}</dd>
            </div>
          </dl>
          {!native && (
            <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-amber-900">
              This is not a native platform, so native storage is unavailable. Every operation
              below will fail closed rather than falling back to web storage.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Actions</h2>
          <p className="mt-1 text-sm text-slate-600">
            One at a time. A second press while an action is running is refused, not queued.
          </p>
          <div className="mt-3 grid gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                disabled={snapshot.busy}
                onClick={action.run}
                className="min-h-11 rounded-2xl border border-slate-300 bg-slate-50 px-4 text-sm font-medium text-slate-800 disabled:opacity-50"
              >
                {action.label}
              </button>
            ))}
          </div>
          {snapshot.busy && (
            <p className="mt-3 text-sm text-slate-600">Running: {snapshot.activity}…</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <h2 className="text-sm font-semibold text-slate-900">What the fixtures are</h2>
          <ul className="mt-2 space-y-2">
            {SYNTHETIC_FIXTURES.map((fixture) => (
              <li key={fixture.id}>
                <span className="font-medium text-slate-800">{fixture.label}</span>
                <span className="block text-slate-600">{fixture.purpose}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-slate-600">
            These are measurement points, not a safe capacity. Nothing here establishes what this
            store can hold on a given device.
          </p>
        </section>

        {snapshot.settings && (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 text-sm">
            <h2 className="text-sm font-semibold text-slate-900">Effective SQLite settings</h2>
            <dl className="mt-2 space-y-1 font-mono text-slate-700">
              <div className="flex justify-between gap-4">
                <dt>journal_mode</dt>
                <dd>{snapshot.settings.journalMode ?? "unreported"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>synchronous</dt>
                <dd>{snapshot.settings.synchronous ?? "unreported"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>page_size</dt>
                <dd>{snapshot.settings.pageSize ?? "unreported"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>sqlite_version</dt>
                <dd>{snapshot.settings.sqliteVersion ?? "unreported"}</dd>
              </div>
            </dl>
          </section>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Results</h2>
          <p className="mt-1 text-sm text-slate-600">
            &ldquo;Write acknowledged&rdquo;, &ldquo;verified after reopen&rdquo; and
            &ldquo;verified after app restart&rdquo; are three different claims. None of them is
            evidence about power loss.
          </p>
          {snapshot.entries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing has been run yet.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {snapshot.entries.map((entry) => (
                <ResultEntry key={entry.id} entry={entry} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

const STATUS_CLASSES: Record<DiagnosticsLogEntry["status"], string> = {
  ok: "bg-emerald-50 text-emerald-900",
  failed: "bg-rose-50 text-rose-900",
  blocked: "bg-amber-50 text-amber-900",
};

function ResultEntry({ entry }: { entry: DiagnosticsLogEntry }) {
  return (
    <li className={`rounded-2xl p-3 text-sm ${STATUS_CLASSES[entry.status]}`}>
      <p className="font-medium">{entry.action}</p>
      <p className="mt-1">{entry.message}</p>
      <p className="mt-1 text-xs uppercase tracking-wide">
        {DURABILITY_CLAIM_LABELS[entry.claim]}
        {entry.elapsedMs !== null && ` · ${entry.elapsedMs.toFixed(1)} ms`}
        {entry.bytes !== null && ` · ${entry.bytes} B`}
      </p>
      {entry.detail.length > 0 && (
        <ul className="mt-2 space-y-1 font-mono text-xs">
          {entry.detail.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
    </li>
  );
}
