import type { RestrictedAssetResolver } from "../lib/exercises/restrictedAssets";
import type { ExerciseVersion } from "../lib/exercises/types";
import ExerciseSetupOverview from "./ExerciseSetupOverview";

type Props = {
  version: ExerciseVersion;
  restrictedAssetResolver?: RestrictedAssetResolver;
};

/** Supporting reference stays available during capture without displacing the input. */
export default function ExerciseExecutionReference({
  version,
  restrictedAssetResolver,
}: Props) {
  return (
    <details className="rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
      <summary className="flex min-h-11 cursor-pointer items-center py-3 text-sm font-semibold text-slate-800">
        Exercise setup and reference
      </summary>
      <div className="border-t border-slate-100 py-4">
        <ExerciseSetupOverview
          version={version}
          restrictedAssetResolver={restrictedAssetResolver}
          includeGoal={false}
        />
      </div>
    </details>
  );
}
