import type { Session } from "../types";
import DeviceStatusCard from "./DeviceStatusCard";
import FutureCapabilitiesSection from "./FutureCapabilitiesSection";
import TodayPlanCard from "./TodayPlanCard";
import TrainingOverview from "./TrainingOverview";

type HomeScreenProps = {
  currentSession: Session | null;
  sessionHistory: Session[];
  onStartTraining: () => void;
  onOpenAnalyze: () => void;
  hasActiveAssessmentRun?: boolean;
  onResumeAssessment?: () => void;
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The app's daily entry point — "what is relevant today?", not an analytics
 * dashboard. Composes small, single-purpose sections; see
 * docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md for section order and
 * rationale, and docs/adr/0009 for why Assess has no section here yet.
 *
 * Greeting is a plain heading in the normal page flow (no card, no shadow) —
 * it is not a section with its own weight, just a quiet time-of-day cue
 * above Today's Plan, the actual primary section.
 */
export default function HomeScreen({
  currentSession,
  sessionHistory,
  onStartTraining,
  onOpenAnalyze,
  hasActiveAssessmentRun = false,
  onResumeAssessment,
}: HomeScreenProps) {
  const currentSessionHasShots = (currentSession?.shots.length ?? 0) > 0;
  const mostRecentHistorySession =
    sessionHistory.length > 0
      ? sessionHistory.reduce((latest, session) =>
          new Date(session.date) > new Date(latest.date) ? session : latest
        )
      : null;

  const hasAnyTraining = currentSessionHasShots || mostRecentHistorySession !== null;
  const lastTrainingLabel = currentSessionHasShots
    ? "Today"
    : mostRecentHistorySession
      ? new Date(mostRecentHistorySession.date).toLocaleDateString()
      : "";
  const totalSessions = sessionHistory.length + (currentSessionHasShots ? 1 : 0);

  return (
    <div className="space-y-4">
      <h2 className="px-1 text-base font-medium text-slate-500">
        {greeting()}
      </h2>

      <TodayPlanCard
        onStartTraining={onStartTraining}
        hasActiveAssessmentRun={hasActiveAssessmentRun}
        onResumeAssessment={onResumeAssessment}
      />

      <TrainingOverview
        hasAnyTraining={hasAnyTraining}
        lastTrainingLabel={lastTrainingLabel}
        totalSessions={totalSessions}
        onOpenAnalyze={onOpenAnalyze}
      />

      <DeviceStatusCard />

      <FutureCapabilitiesSection />
    </div>
  );
}
