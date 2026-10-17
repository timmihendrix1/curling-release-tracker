import TrainingHeader from "./TrainingHeader";
import type { ExerciseAssetResolver } from "../lib/exercises/exerciseAssets";
import { exerciseDiscoveryCategory } from "../lib/exercises/discovery";
import { exerciseDiscoveryCategoryLabel } from "../lib/exercises/presentation";
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

      <TrainingHeader title={version.title} eyebrow={`${exerciseDiscoveryCategoryLabel(exerciseDiscoveryCategory(version))} · Solo setup`}>
        Prepare the exercise, then start when you are ready.
      </TrainingHeader>

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
