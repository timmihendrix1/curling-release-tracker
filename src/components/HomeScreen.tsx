import type { Session } from "../types";
import { blockModeLabel, getActiveBlock } from "../lib/trainingBlocks";
import { resolveBlockMeasurement } from "../lib/measurement/quantities";
import { sessionHasArchivableActivity } from "../lib/exercises/sessionIntegration";
import { countRecordedStones, isPlanExecutionActive } from "../lib/trainingPlans/progress";
import DeviceStatusCard from "./DeviceStatusCard";
import FutureCapabilitiesSection from "./FutureCapabilitiesSection";
import TodayPlanCard from "./TodayPlanCard";
import TrainingHeader from "./TrainingHeader";

type HomeScreenProps = {
  currentSession: Session | null;
  sessionHistory: Session[];
  onStartTraining: () => void;
  onOpenAnalyze: () => void;
  onOpenSettings?: () => void;
  onManageTeams?: () => void;
  hasActiveAssessmentRun?: boolean;
  onResumeAssessment?: () => void;
  /** The Team runner takes precedence in Train; never show a different resume destination. */
  activeTeamExerciseTitle?: string;
};

/** A read-only preview of the mounted Profile's state; all actions use the shell's guards. */
export default function HomeScreen({
  currentSession,
  sessionHistory,
  onStartTraining,
  onOpenAnalyze,
  onOpenSettings,
  onManageTeams = () => {},
  hasActiveAssessmentRun = false,
  onResumeAssessment,
  activeTeamExerciseTitle,
}: HomeScreenProps) {
  const block = currentSession ? getActiveBlock(currentSession) : undefined;
  const execution = currentSession?.exerciseExecutions?.find(
    (item) => item.id === currentSession.activeExerciseExecutionId
  );
  const plan = currentSession?.planExecution;
  const hasActivePlan = !!(currentSession && plan && isPlanExecutionActive(currentSession, plan));
  const count = currentSession ? countRecordedStones(currentSession) : 0;
  // The empty, automatically-created Session is not a training. Conversely a
  // configured block/execution is resumable even before its first stone.
  const hasTraining = !!(block || execution || hasActivePlan || (currentSession && sessionHasArchivableActivity(currentSession)));
  const quantities = block ? resolveBlockMeasurement(block).quantities : [];
  const measurementLabel = quantities.length === 2 ? "Time + Speed" : quantities[0] === "speed" ? "Speed" : "Time";
  const training = activeTeamExerciseTitle
    ? { title: activeTeamExerciseTitle, detail: "Team training" }
    : hasTraining && currentSession
      ? {
          title: hasActivePlan ? plan!.sourcePlanName : execution?.exerciseVersionSnapshot.title ?? block?.name ?? currentSession.title,
          detail: hasActivePlan ? "Training plan" : execution ? "Exercise in progress" : block ? `${blockModeLabel(block.mode)} · ${measurementLabel}` : "Current training",
          stones: count,
        }
      : undefined;
  const recent = [...sessionHistory]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 2);

  return (
    <div className="house-home space-y-4" data-testid="house-home">
      <TrainingHeader title="Your training." eyebrow="Curling Performance" />
      <TodayPlanCard
        training={training}
        onStartTraining={onStartTraining}
        hasActiveAssessmentRun={hasActiveAssessmentRun}
        onResumeAssessment={onResumeAssessment}
      />
      <section aria-labelledby="recent-training-title" className="px-1">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-training-title" className="text-base font-medium">Recent training</h2>
          <button type="button" onClick={onOpenAnalyze} className="house-link px-1 text-sm">See all</button>
        </div>
        {recent.length === 0 ? (
          <p className="house-list py-4 text-sm text-[var(--house-muted)]">No training completed yet.</p>
        ) : (
          <ul className="house-list">
            {recent.map((session) => (
              <li key={session.id}>
                <p className="break-words text-sm font-medium">{session.title}</p>
                <p className="mt-1 text-xs text-[var(--house-muted)]">
                  <time dateTime={session.date}>{new Date(session.date).toLocaleDateString()}</time>
                  {" · "}{countRecordedStones(session)} {countRecordedStones(session) === 1 ? "stone" : "stones"} recorded
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <details className="house-support">
        <summary>Teams &amp; devices</summary>
        <div className="space-y-5 pt-2">
          <DeviceStatusCard variant="bare" onOpenSettings={onOpenSettings} />
          <FutureCapabilitiesSection onManageTeams={onManageTeams} />
        </div>
      </details>
    </div>
  );
}
