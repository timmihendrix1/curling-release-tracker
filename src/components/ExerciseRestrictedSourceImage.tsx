import { useEffect, useState } from "react";
import {
  resolveExerciseAssetAccess,
  type ExerciseAssetAccess,
  type ExerciseAssetResolver,
} from "../lib/exercises/exerciseAssets";
import {
  RESTRICTED_DIAGRAM_UNAVAILABLE_BODY,
  RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE,
} from "../lib/exercises/presentation";
import type { ExerciseDiagram } from "../lib/exercises/types";

type SourceImageDiagram = Extract<ExerciseDiagram, { kind: "attributed-source-image" }>;

type ExerciseRestrictedSourceImageProps = {
  diagram: SourceImageDiagram;
  /** Required for the image to render; absence always fails closed. */
  exerciseAssetResolver?: ExerciseAssetResolver;
};

/**
 * Renders an attributed source-image Diagram only through the injected asset
 * resolver. The resolver may serve a publicly cleared, locally cached asset or
 * a future restricted asset. The opaque catalog reference is never written to
 * the DOM and the compact caption is the only source text shown beside the
 * image; full source attribution lives once at the bottom of the Exercise.
 */
export default function ExerciseRestrictedSourceImage({
  diagram,
  exerciseAssetResolver,
}: ExerciseRestrictedSourceImageProps) {
  const unavailable: ExerciseAssetAccess = { available: false };
  const [resolved, setResolved] = useState<{
    diagram: SourceImageDiagram;
    resolver: ExerciseAssetResolver | undefined;
    access: ExerciseAssetAccess;
  }>(() => ({
    diagram,
    resolver: exerciseAssetResolver,
    access: unavailable,
  }));

  useEffect(() => {
    let current = true;
    void resolveExerciseAssetAccess(
      diagram.assetReference,
      diagram.distribution,
      exerciseAssetResolver
    ).then((access) => {
      if (current) {
        setResolved({ diagram, resolver: exerciseAssetResolver, access });
      }
    });
    return () => {
      current = false;
    };
  }, [diagram, exerciseAssetResolver]);

  // Never show a resolution belonging to a previous diagram or resolver while
  // a new asynchronous authorization check is in flight.
  const access =
    resolved.diagram === diagram && resolved.resolver === exerciseAssetResolver
      ? resolved.access
      : unavailable;

  return (
    <figure className="w-full">
      {access.available ? (
        // The source is produced by the resolver (currently a cached Data URL),
        // so it is intentionally rendered without next/image optimization.
        <div className="relative w-full overflow-hidden rounded-xl [container-type:inline-size]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={access.src}
            alt={diagram.accessibleSummary}
            className="h-auto w-full"
          />
          {diagram.localizedTextOverlays?.map((overlay) => (
            <span
              key={overlay.id}
              aria-hidden="true"
              className="absolute flex items-center justify-center overflow-hidden px-[0.8cqw] text-center font-medium leading-[1.15]"
              style={{
                left: `${overlay.x * 100}%`,
                top: `${overlay.y * 100}%`,
                width: `${overlay.width * 100}%`,
                height: `${overlay.height * 100}%`,
                backgroundColor: overlay.backgroundColor,
                color: overlay.textColor,
                fontSize: `${overlay.fontSize * 100}cqw`,
              }}
            >
              {overlay.text}
            </span>
          ))}
        </div>
      ) : (
        <div
          className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4"
          data-testid="exercise-restricted-diagram-unavailable"
        >
          <p className="text-sm font-medium text-slate-800">
            {RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE}
          </p>
          <p className="mt-1 text-sm text-slate-600">{RESTRICTED_DIAGRAM_UNAVAILABLE_BODY}</p>
        </div>
      )}

      <figcaption className="mt-2 space-y-2">
        <span className="block text-center text-xs font-medium text-slate-600">
          {diagram.caption}
        </span>
      </figcaption>
    </figure>
  );
}
