type AssessmentBlockTransitionProps = {
  completedBlockName?: string;
  nextBlockName: string;
  nextBlockPurpose: string;
  nextTargetTime: number;
  onContinue: () => void;
};

/**
 * Shown between scored blocks (and after warm-up completes) — a short
 * overview of the next block, never a countdown or enforced rest. See
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 14.
 */
export default function AssessmentBlockTransition({
  completedBlockName,
  nextBlockName,
  nextBlockPurpose,
  nextTargetTime,
  onContinue,
}: AssessmentBlockTransitionProps) {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-lg">
      {completedBlockName && (
        <p className="text-sm font-medium text-emerald-700">{completedBlockName} complete</p>
      )}

      <h2 className="mt-2 text-lg font-semibold text-slate-900">Next: {nextBlockName}</h2>
      <p className="mt-1 text-sm text-slate-600">{nextBlockPurpose}</p>
      <p className="mt-2 text-sm text-slate-600">
        First target: <span className="font-medium text-slate-900">{nextTargetTime.toFixed(2)}s</span>
      </p>

      <p className="mt-3 text-xs text-slate-500">Take a short break if needed.</p>

      <button
        type="button"
        onClick={onContinue}
        className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
      >
        Continue
      </button>
    </div>
  );
}
