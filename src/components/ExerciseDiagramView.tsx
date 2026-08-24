import type { RestrictedAssetResolver } from "../lib/exercises/restrictedAssets";
import { DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE } from "../lib/exercises/presentation";
import type { ExerciseDiagram } from "../lib/exercises/types";
import ExerciseRestrictedSourceImage from "./ExerciseRestrictedSourceImage";
import ExerciseStructuredDiagram from "./ExerciseStructuredDiagram";

type ExerciseDiagramViewProps = {
  diagram: ExerciseDiagram;
  restrictedAssetResolver?: RestrictedAssetResolver;
};

/**
 * The one place a Diagram becomes UI. Branches on the diagram's declared
 * domain `kind` — a structured platform diagram or an attributed source image —
 * never on which Exercise it belongs to.
 *
 * An unrecognised kind is reported visibly rather than skipped. Catalog
 * validation already rejects one, so reaching this branch means the content
 * boundary was bypassed; either way the athlete is told something is missing
 * instead of silently seeing an Exercise without its diagram.
 */
export default function ExerciseDiagramView({
  diagram,
  restrictedAssetResolver,
}: ExerciseDiagramViewProps) {
  switch (diagram.kind) {
    case "structured-platform-diagram":
      return <ExerciseStructuredDiagram diagram={diagram} />;

    case "attributed-source-image":
      return (
        <ExerciseRestrictedSourceImage
          diagram={diagram}
          restrictedAssetResolver={restrictedAssetResolver}
        />
      );

    default:
      return (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE}
        </p>
      );
  }
}
