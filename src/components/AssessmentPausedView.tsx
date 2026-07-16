type AssessmentPausedViewProps = {
  progressLabel: string;
  onResume: () => void;
  onAbandon: () => void;
};

/** Shown while an Assessment Run is paused — see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 21. */
export default function AssessmentPausedView({
  progressLabel,
  onResume,
  onAbandon,
}: AssessmentPausedViewProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Assessment paused
      </p>
      <p className="mt-2 text-sm text-slate-600">{progressLabel}</p>
      <p className="mt-1 text-xs text-slate-500">
        Your recorded attempts and progress are kept. Capture is stopped until you resume.
      </p>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onResume}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Resume Assessment
        </button>
        <button
          type="button"
          onClick={onAbandon}
          className="flex-1 rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 transition hover:bg-red-100"
        >
          Abandon Assessment
        </button>
      </div>
    </div>
  );
}
