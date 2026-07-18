import { surfaceClass } from "./Surface";

type TodayPlanCardProps = {
  onStartTraining: () => void;
  /** True if an active (non-terminal) Assessment Run exists — never an invented/scheduled assessment, only a real in-progress one (see docs/adr/0011). */
  hasActiveAssessmentRun?: boolean;
  onResumeAssessment?: () => void;
};

/**
 * Home's primary section — "what is relevant today?". This slice has no
 * scheduling data model (no calendar, no coach assignments), so there is
 * exactly one possible state: no scheduled session. Never infer or invent a
 * plan — see "the platform should never prescribe training" in
 * docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md and
 * docs/COACHING_PRINCIPLES.md. An active Assessment Run is real, current
 * state (not a plan), so it gets a small contextual action here — never a
 * fabricated "Assessment scheduled" suggestion.
 */
export default function TodayPlanCard({
  onStartTraining,
  hasActiveAssessmentRun = false,
  onResumeAssessment,
}: TodayPlanCardProps) {
  return (
    // Home's one Hero (Epic 1).
    <div className={surfaceClass("hero")}>
      <h2 className="text-xl font-semibold text-slate-900">Today&apos;s Plan</h2>

      <p className="mt-2 text-sm text-slate-600">No scheduled session.</p>
      <p className="text-sm text-slate-600">Start whenever you&apos;re ready.</p>

      <button
        type="button"
        onClick={onStartTraining}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
      >
        Start Training
      </button>

      {hasActiveAssessmentRun && onResumeAssessment && (
        <button
          type="button"
          onClick={onResumeAssessment}
          className="mt-2 w-full rounded-xl bg-slate-100 px-4 py-3 font-medium text-slate-700 transition hover:bg-slate-200"
        >
          Resume Assessment
        </button>
      )}
    </div>
  );
}
