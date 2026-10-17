import HouseMark from "./HouseMark";

type TodayPlanCardProps = {
  onStartTraining: () => void;
  training?: { title: string; detail: string; stones?: number };
  hasActiveAssessmentRun?: boolean;
  onResumeAssessment?: () => void;
};

/** Home's single primary surface. No scheduling data or inferred training recommendation. */
export default function TodayPlanCard({
  onStartTraining,
  training,
  hasActiveAssessmentRun = false,
  onResumeAssessment,
}: TodayPlanCardProps) {
  return (
    <div>
      <section className="house-hero" aria-label={training ? "Current training" : "Start training"}>
        <p className="house-hero-muted text-[11px] font-medium uppercase tracking-wider">
          {training ? "● In progress" : "Your next training"}
        </p>
        <h2 className="house-title mt-3">{training?.title ?? "Ready when you are."}</h2>
        <p className="house-hero-muted mt-2 text-sm">{training?.detail ?? "Technique, shotmaking or assessment."}</p>
        {training && <div className="my-3 flex min-h-16 items-center justify-between gap-4">
          {training?.stones !== undefined ? (
            <div className="min-w-0">
              <p className="break-all text-5xl leading-none font-normal tracking-tighter tabular-nums sm:text-7xl">{training.stones}</p>
              <p className="house-hero-muted mt-2 text-xs">{training.stones === 1 ? "stone" : "stones"} recorded</p>
            </div>
          ) : (
            <p className="house-hero-muted max-w-40 text-sm leading-relaxed">{training ? "Continue your Team exercise." : "One stone at a time."}</p>
          )}
          <HouseMark className="house-hero-muted w-20 shrink-0 sm:w-24" />
        </div>}
        <button type="button" onClick={onStartTraining} className="house-action house-action-inverse mt-4">
          {training ? "Resume training" : "Start Training"}<span aria-hidden="true">→</span>
        </button>
      </section>
      {hasActiveAssessmentRun && onResumeAssessment && (
        <button type="button" onClick={onResumeAssessment} className="house-link mt-3 w-full px-1 text-sm font-medium">
          Resume Assessment <span aria-hidden="true">→</span>
        </button>
      )}
    </div>
  );
}
