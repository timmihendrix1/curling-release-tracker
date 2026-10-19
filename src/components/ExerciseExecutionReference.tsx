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
    <details className="house-training-disclosure">
      <summary >
        Exercise setup and reference
      </summary>
      <div className="space-y-4">
        {children}
        <ExerciseSetupOverview
          version={version}
          exerciseAssetResolver={exerciseAssetResolver}
        />
      </div>
    </details>
  );
}
