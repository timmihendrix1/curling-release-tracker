import type { ReactNode } from "react";
import type { ExerciseAssetResolver } from "../lib/exercises/exerciseAssets";
import type { ExerciseVersion } from "../lib/exercises/types";
import ExerciseSetupOverview from "./ExerciseSetupOverview";

type Props = {
  version: ExerciseVersion;
  children?: ReactNode;
  exerciseAssetResolver?: ExerciseAssetResolver;
};

/** Supporting reference stays available during capture without displacing the input. */
export default function ExerciseExecutionReference({
  version,
  exerciseAssetResolver,
  children,
}: Props) {
  return (
    <details className="rounded-2xl border border-slate-200 bg-white px-4 shadow-sm">
      <summary className="flex min-h-11 cursor-pointer items-center py-3 text-sm font-semibold text-slate-800">
        Exercise setup and reference
      </summary>
      <div className="space-y-4 border-t border-slate-100 py-4">
        {children}
        <ExerciseSetupOverview
          version={version}
          exerciseAssetResolver={exerciseAssetResolver}
        />
      </div>
    </details>
  );
}
