import DashboardCard from "./DashboardCard";
import { surfaceClass } from "./Surface";

type TrainingOverviewProps = {
  hasAnyTraining: boolean;
  lastTrainingLabel: string;
  totalSessions: number;
  onOpenAnalyze: () => void;
  /**
   * "bare" strips the outer surface so HomeScreen can compose this together
   * with DeviceStatusCard inside one shared section instead of two
   * separately-boxed cards (compositional redesign).
   */
  variant?: "card" | "bare";
};

/**
 * Home's compact "how am I doing" glance — intentionally not a dashboard.
 * Named "Training Overview" rather than "Performance Snapshot": the only
 * figures available today (last training date, session count) are activity
 * data, not validated performance metrics — see
 * docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md's Implementation Status.
 * Only ever shows facts already available from existing session data; never
 * a new metric or an inferred trend. Also hosts the secondary "View Analyze"
 * action — Quick Access was removed as a redundant standalone section, since
 * this is the one place on Home a session-history figure already invites a
 * deeper look. Detailed analysis lives under Analyze.
 */
export default function TrainingOverview({
  hasAnyTraining,
  lastTrainingLabel,
  totalSessions,
  onOpenAnalyze,
  variant = "card",
}: TrainingOverviewProps) {
  return (
    <div className={variant === "card" ? surfaceClass("secondary") : ""}>
      <h2 className="text-base font-semibold text-slate-900">
        Training Overview
      </h2>

      {hasAnyTraining ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <DashboardCard label="Last Training" value={lastTrainingLabel} />
          <DashboardCard label="Total Sessions" value={String(totalSessions)} />
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-sm text-slate-600">No training completed yet.</p>
          <p className="text-sm text-slate-600">
            Start your first training to build your performance history.
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onOpenAnalyze}
        className="mt-4 text-sm font-medium text-slate-600 underline-offset-2 transition hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2 rounded"
      >
        View Analyze
      </button>
    </div>
  );
}
