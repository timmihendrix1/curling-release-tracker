import type { ExerciseAssetResolver } from "../lib/exercises/exerciseAssets";
import { exerciseFocusLabel } from "../lib/exercises/presentation";
import type { ExerciseVersion } from "../lib/exercises/types";
import ExerciseSetupOverview from "./ExerciseSetupOverview";
import { surfaceClass } from "./Surface";

type Props = {
  version: ExerciseVersion;
  disabled?: boolean;
  onConfirm(): void;
  onCancel(): void;
  exerciseAssetResolver?: ExerciseAssetResolver;
};

export default function ExerciseSoloSetupScreen({
  version,
  disabled = false,
  onConfirm,
  onCancel,
  exerciseAssetResolver,
}: Props) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onCancel}
        className="-mx-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-slate-500 underline"
      >
        ← Back to Exercise Library
      </button>

      <section className={surfaceClass("hero")}>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {exerciseFocusLabel(version.primaryFocus)} · Solo setup
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900">{version.title}</h2>
        <p className="mt-2 text-sm text-slate-600">
          Prepare the exercise, then confirm when you are ready to record.
        </p>
      </section>

      <section className={surfaceClass("primary")}>
        <ExerciseSetupOverview
          version={version}
          exerciseAssetResolver={exerciseAssetResolver}
        />
      </section>

      <button
        type="button"
        onClick={onConfirm}
        disabled={disabled}
        className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        Setup Complete — Start Exercise
      </button>
    </div>
  );
}
