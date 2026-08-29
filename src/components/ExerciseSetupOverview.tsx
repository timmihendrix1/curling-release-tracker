import type { ExerciseVersion } from "../lib/exercises/types";
import type { RestrictedAssetResolver } from "../lib/exercises/restrictedAssets";
import ExerciseDiagramView from "./ExerciseDiagramView";

type Props = {
  version: ExerciseVersion;
  restrictedAssetResolver?: RestrictedAssetResolver;
  includeGoal?: boolean;
};

/**
 * One generic physical-setup reference used before Solo and Team execution and
 * inside the collapsed reference shown while an Exercise is running.
 */
export default function ExerciseSetupOverview({
  version,
  restrictedAssetResolver,
  includeGoal = true,
}: Props) {
  return (
    <div className="space-y-5">
      {includeGoal && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Goal</h3>
          <p className="mt-1 text-sm text-slate-700">{version.goal}</p>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-900">Set up</h3>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {version.setupInstructions.map((instruction) => (
            <li key={instruction.id}>{instruction.text}</li>
          ))}
        </ol>
      </div>

      {version.equipment.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Equipment</h3>
          <ul className="mt-2 space-y-2 text-sm text-slate-700">
            {version.equipment.map((item) => (
              <li key={item.id}>
                <span className="font-medium">{item.label}</span>
                <span className="text-slate-500">
                  {item.requirement === "optional" ? " · optional" : " · required"}
                </span>
                {item.note && <span className="block text-xs text-slate-500">{item.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {version.diagram && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Exercise diagram</h3>
          <ExerciseDiagramView
            diagram={version.diagram}
            restrictedAssetResolver={restrictedAssetResolver}
          />
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-900">How to perform it</h3>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-700">
          {version.executionInstructions.map((instruction) => (
            <li key={instruction.id}>{instruction.text}</li>
          ))}
        </ol>
      </div>

      {version.guidance.kind === "observation" && (
        <div className="rounded-xl bg-slate-100 p-4">
          <h3 className="text-sm font-semibold text-slate-900">What to observe</h3>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-slate-600">
            {version.guidance.observations.map((observation) => (
              <li key={observation}>{observation}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">{version.guidance.noScoringNote}</p>
        </div>
      )}
    </div>
  );
}
