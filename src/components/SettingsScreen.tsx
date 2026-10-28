import type { ReactNode } from "react";
import { ProductAnalyticsChoice } from "./ProductAnalytics";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import TrainingHeader from "./TrainingHeader";
import { surfaceClass } from "./Surface";
import ExternalDocumentLink from "./platform/ExternalDocumentLink";
import FileExportStatusNotice from "./FileExportStatusNotice";
import type { FileExportStatus } from "./useFileExport";

type SettingsScreenProps = {
  accountControl?: ReactNode;
  hasHistory: boolean;
  onExportHistoryCsv: () => void;
  /** Visible result of the last export attempt (Stage M3a). */
  exportStatus?: FileExportStatus;
  onClearHistory: () => void;
  /**
   * True while the Session domain isn't "ready" (docs/PERSISTENCE_BOUNDARY_DESIGN.md
   * §7.4) — Clear History mutates session-history, which must stay
   * unavailable during loading and after a read failure alike. Defaults to
   * false so existing call sites/tests keep today's `!hasHistory`-only
   * gating.
   */
  clearHistoryDisabled?: boolean;
  accuracyToleranceProfiles: AccuracyToleranceProfile[];
  defaultAccuracyToleranceProfileId: string | null;
  onManageAccuracyTolerances: () => void;
  /** Same readiness rule as clearHistoryDisabled, for the Accuracy Tolerance Profiles domain. */
  manageAccuracyTolerancesDisabled?: boolean;
  smartRandomProfiles: SmartRandomProfile[];
  defaultSmartRandomProfileId: string | null;
  onManageSmartRandomProfiles: () => void;
  /** Same readiness rule as clearHistoryDisabled, for the Smart Random Profiles domain. */
  manageSmartRandomProfilesDisabled?: boolean;
  /** Team Foundation (docs/adr/0022) — cloud-backed, so this card always renders;
   * TeamsScreen itself shows the "sign in" / "not configured" messaging. */
  onManageTeams: () => void;
  /**
   * Development-only hardware discovery tools. `TrackerApp` passes its `IS_DEV`
   * value, so the entry point below is absent from a production build entirely
   * rather than merely hidden — see `BrowerBleDiagnosticScreen.tsx`.
   */
  showDeveloperDiagnostics?: boolean;
  onOpenBleDiagnostic?: () => void;
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
  accountControl,
  hasHistory,
  onExportHistoryCsv,
  exportStatus,
  onClearHistory,
  clearHistoryDisabled = false,
  accuracyToleranceProfiles,
  defaultAccuracyToleranceProfileId,
  onManageAccuracyTolerances,
  manageAccuracyTolerancesDisabled = false,
  smartRandomProfiles,
  defaultSmartRandomProfileId,
  onManageSmartRandomProfiles,
  manageSmartRandomProfilesDisabled = false,
  onManageTeams,
  showDeveloperDiagnostics = false,
  onOpenBleDiagnostic,
}: SettingsScreenProps) {
  const defaultProfile =
    accuracyToleranceProfiles.find(
      (profile) => profile.id === defaultAccuracyToleranceProfileId
    ) ?? null;

  const defaultSmartRandomProfile =
    smartRandomProfiles.find(
      (profile) => profile.id === defaultSmartRandomProfileId
    ) ?? null;

  return (
    <div className="space-y-4">
      <TrainingHeader title="Make it yours." eyebrow="Settings" />
      {accountControl && <section aria-label="Account" className="house-account-section">{accountControl}</section>}
      <section className={surfaceClass("primary")} aria-label="Training preferences">
        <button type="button" aria-label="Manage Accuracy Tolerances" onClick={onManageAccuracyTolerances} disabled={manageAccuracyTolerancesDisabled} className="house-settings-row">
          <span><span>Accuracy Tolerances</span><small>{accuracyToleranceProfiles.length} saved{defaultProfile ? ` · ${defaultProfile.name}` : ""}</small></span><span aria-hidden="true">→</span>
        </button>
        <button type="button" aria-label="Manage Smart Random Profiles" onClick={onManageSmartRandomProfiles} disabled={manageSmartRandomProfilesDisabled} className="house-settings-row">
          <span><span>Smart Random Profiles</span><small>{smartRandomProfiles.length} saved{defaultSmartRandomProfile ? ` · ${defaultSmartRandomProfile.name}` : ""}</small></span><span aria-hidden="true">→</span>
        </button>
        <button type="button" aria-label="Manage Teams" onClick={onManageTeams} className="house-settings-row">
          <span><span>Teams</span><small>Members and permissions</small></span><span aria-hidden="true">→</span>
        </button>
      </section>

      {/* Settings' Data Management Hero (Epic 1) — the page-level PageHeader
          above already identifies this screen as "Settings", so this no longer
          repeats that title in its own card (DESIGN_SYSTEM.md §32 Priority 2). */}
      <details className="house-support">
        <summary>Data and privacy</summary>
        <ProductAnalyticsChoice showIdentifier />
        <h2 className="text-lg font-semibold text-slate-900">
          Data Management
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Export the completed training history available in this Profile.
        </p>

        <button
          type="button"
          onClick={onExportHistoryCsv}
          disabled={!hasHistory || exportStatus?.state === "working"}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Export History CSV
        </button>
        {exportStatus !== undefined && <FileExportStatusNotice status={exportStatus} />}

        {!hasHistory && (
          <p className="mt-3 text-xs text-slate-500">
            No completed sessions yet — nothing to export or clear.
          </p>
        )}

        {/* Privacy & Terms is a footnote to Data Management, not a
            competing section — same trust question, same surface
            (compositional redesign). */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold text-slate-500">
            Privacy &amp; Terms
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Completed training sessions and Assessment results are saved on this
            device and synced to your private cloud account when online. In-progress
            training and Assessment drafts stay on this device.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4">
            <ExternalDocumentLink
              href="/privacy"
              className="inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-slate-700 underline decoration-slate-400 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              Read the Privacy Notice
            </ExternalDocumentLink>
            <ExternalDocumentLink
              href="/terms"
              className="inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-slate-700 underline decoration-slate-400 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              Read the Terms of Service
            </ExternalDocumentLink>
          </div>
        </div>
      </details>

      {/* Development-only hardware discovery. Absent from production builds; see the
          prop documentation above and docs/BROWER_INTEGRATION_STATUS.md. */}
      {showDeveloperDiagnostics && onOpenBleDiagnostic !== undefined && (
        <div className={surfaceClass("secondary")}>
          <h2 className="text-lg font-semibold text-slate-900">
            Developer Tools
          </h2>

          <p className="mt-1 text-sm text-slate-600">
            Connect to a Brower TCi Timer over Bluetooth and record its raw responses.
            It does not record training, and it is not available outside development.
          </p>

          <button
            type="button"
            onClick={onOpenBleDiagnostic}
            className="mt-4 w-full rounded-xl border border-slate-300 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-100"
          >
            Open BLE Diagnostic
          </button>
        </div>
      )}

      {/* Destructive action kept in its own, clearly separated section
          (DESIGN_SYSTEM.md §12.4) rather than sharing a card with the
          non-destructive export action above. */}
      <details className="house-support">
        <summary>Delete training history</summary>
        <p className="mt-1 text-sm text-red-700">
          Permanently delete the entire session history from this device and your
          cloud account. If you are offline, deletion syncs when you reconnect. This
          cannot be undone.
        </p>

        <button
          type="button"
          onClick={onClearHistory}
          disabled={!hasHistory || clearHistoryDisabled}
          className="mt-4 w-full rounded-xl bg-red-100 px-4 py-3 font-medium text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:bg-red-50/60 disabled:text-red-300"
        >
          Clear History
        </button>
      </details>
    </div>
  );
}
