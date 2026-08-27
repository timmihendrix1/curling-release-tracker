import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import { surfaceClass } from "./Surface";

type SettingsScreenProps = {
  hasHistory: boolean;
  onExportHistoryCsv: () => void;
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
      {/* Reusable configuration aid, not app-wide data management — its own
          card so "Manage Accuracy Tolerances" reads as a distinct action from
          Data Management's export/clear below. */}
      <div className={surfaceClass("hero")}>
        <h2 className="text-lg font-semibold text-slate-900">
          Accuracy Tolerances
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Save reusable On Target / Acceptable tolerance profiles you can select
          instead of retyping them for every Training Block or Plan Step.
        </p>

        <p className="mt-3 text-sm text-slate-600">
          {accuracyToleranceProfiles.length === 0
            ? "No profiles saved yet."
            : `${accuracyToleranceProfiles.length} profile${
                accuracyToleranceProfiles.length === 1 ? "" : "s"
              } saved${defaultProfile ? ` · Default: ${defaultProfile.name}` : ""}`}
        </p>

        <button
          type="button"
          onClick={onManageAccuracyTolerances}
          disabled={manageAccuracyTolerancesDisabled}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Manage Accuracy Tolerances
        </button>
      </div>

      {/* Same "reusable configuration aid" grouping as Accuracy Tolerances
          above, its own card since the two are independent domains. */}
      <div className={surfaceClass("hero")}>
        <h2 className="text-lg font-semibold text-slate-900">
          Smart Random Profiles
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Save reusable Smart Random ranges you can select instead of
          re-entering them for every Variable Weight or Blind Weight exercise.
        </p>

        <p className="mt-3 text-sm text-slate-600">
          {smartRandomProfiles.length === 0
            ? "No profiles saved yet."
            : `${smartRandomProfiles.length} profile${
                smartRandomProfiles.length === 1 ? "" : "s"
              } saved${
                defaultSmartRandomProfile
                  ? ` · Default: ${defaultSmartRandomProfile.name}`
                  : ""
              }`}
        </p>

        <button
          type="button"
          onClick={onManageSmartRandomProfiles}
          disabled={manageSmartRandomProfilesDisabled}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Manage Smart Random Profiles
        </button>
      </div>

      {/* Team Foundation beta (docs/adr/0022) — optional, cloud-backed collaboration
          layer. Its own card since it's an entirely separate domain from the two
          reusable-configuration-aid cards above. */}
      <div className={surfaceClass("hero")}>
        <h2 className="text-lg font-semibold text-slate-900">Teams</h2>

        <p className="mt-1 text-sm text-slate-600">
          Optional beta: join or create a named team, invite teammates, and share
          administration. Requires cloud sign-in.
        </p>

        <button
          type="button"
          onClick={onManageTeams}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
        >
          Manage Teams
        </button>
      </div>

      {/* Settings' Data Management Hero (Epic 1) — the page-level PageHeader
          above already identifies this screen as "Settings", so this no longer
          repeats that title in its own card (DESIGN_SYSTEM.md §32 Priority 2). */}
      <div className={surfaceClass("hero")}>
        <h2 className="text-lg font-semibold text-slate-900">
          Data Management
        </h2>

        <p className="mt-1 text-sm text-slate-600">
          Export the completed training history available in this Profile.
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

        {/* Data & Privacy is a footnote to Data Management, not a
            competing section — same trust question, same surface
            (compositional redesign). */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h2 className="text-sm font-semibold text-slate-500">
            Data &amp; Privacy
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Completed training sessions and Assessment results are saved on this
            device and synced to your private cloud account when online. In-progress
            training and Assessment drafts stay on this device.
          </p>
        </div>
      </div>

      {/* Destructive action kept in its own, clearly separated section
          (DESIGN_SYSTEM.md §12.4) rather than sharing a card with the
          non-destructive export action above. */}
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
        <h2 className="text-lg font-semibold text-red-900">Clear Data</h2>
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
      </div>
    </div>
  );
}
