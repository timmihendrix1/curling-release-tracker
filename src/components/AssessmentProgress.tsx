type AssessmentProgressProps = {
  label: string;
  completed: number;
  total: number;
};

/** A compact progress readout with a real progress bar semantics — used for warm-up, per-block, and overall (x of 32) progress alike. */
export default function AssessmentProgress({ label, completed, total }: AssessmentProgressProps) {
  const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return (
    <div>
      <div className="flex items-center justify-between text-xs font-medium text-slate-600">
        <span>{label}</span>
        <span>
          {completed} / {total}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuenow={completed}
        aria-valuemin={0}
        aria-valuemax={total}
        className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full bg-slate-900" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
