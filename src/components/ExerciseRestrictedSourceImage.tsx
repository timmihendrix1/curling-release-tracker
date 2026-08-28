import { useEffect, useState } from "react";
import {
  resolveRestrictedAssetAccess,
  type RestrictedAssetAccess,
  type RestrictedAssetResolver,
} from "../lib/exercises/restrictedAssets";
import {
  RESTRICTED_DIAGRAM_UNAVAILABLE_BODY,
  RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE,
} from "../lib/exercises/presentation";
import type { ExerciseDiagram } from "../lib/exercises/types";

type SourceImageDiagram = Extract<ExerciseDiagram, { kind: "attributed-source-image" }>;

type ExerciseRestrictedSourceImageProps = {
  diagram: SourceImageDiagram;
  /** Required for the image to render; absence always fails closed. */
  restrictedAssetResolver?: RestrictedAssetResolver;
};

/**
 * Renders an attributed, restricted source-image Diagram — but only through an
 * explicitly authorized resolver (see
 * `src/lib/exercises/restrictedAssets.ts`). Without one it renders a clear,
 * accessible unavailable state and never emits or infers an asset URL: the
 * opaque `assetReference.assetId` is deliberately not written into the DOM in
 * either branch, so it cannot be read out of the markup and turned into a
 * request.
 *
 * Attribution, source organisation, source version, permitted audience and
 * provenance are rendered from one shared list *outside* the authorized /
 * unavailable branch (ADR-0023 Decision 5) — so the record of where the content
 * came from is structurally identical either way, rather than depending on
 * whether the picture itself could be shown.
 */
export default function ExerciseRestrictedSourceImage({
  diagram,
  restrictedAssetResolver,
}: ExerciseRestrictedSourceImageProps) {
  const unavailable: RestrictedAssetAccess = {
    authorized: false,
    reason: restrictedAssetResolver ? "not-authorized" : "no-resolver",
  };
  const [resolved, setResolved] = useState<{
    diagram: SourceImageDiagram;
    resolver: RestrictedAssetResolver | undefined;
    access: RestrictedAssetAccess;
  }>(() => ({
    diagram,
    resolver: restrictedAssetResolver,
    access: unavailable,
  }));

  useEffect(() => {
    let current = true;
    void resolveRestrictedAssetAccess(
      diagram.assetReference,
      diagram.distribution,
      restrictedAssetResolver
    ).then((access) => {
      if (current) {
        setResolved({ diagram, resolver: restrictedAssetResolver, access });
      }
    });
    return () => {
      current = false;
    };
  }, [diagram, restrictedAssetResolver]);

  // Never show a resolution belonging to a previous diagram or resolver while
  // a new asynchronous authorization check is in flight.
  const access =
    resolved.diagram === diagram && resolved.resolver === restrictedAssetResolver
      ? resolved.access
      : unavailable;

  // Built once and rendered once, so no branch can omit a required value. Every
  // field here is validated as non-empty at the catalog boundary, and none of
  // them is derived from the opaque asset reference.
  const provenance: readonly { label: string; value: string }[] = [
    { label: "Attribution", value: diagram.attribution },
    { label: "Source organisation", value: diagram.sourceOrganization },
    { label: "Source version", value: diagram.sourceVersion },
    { label: "Permitted audience", value: diagram.distribution.permittedAudience },
    { label: "Provenance", value: diagram.provenanceNote },
  ];

  return (
    <figure className="w-full">
      {access.authorized ? (
        // The source is produced at runtime by an authorized delivery
        // context (typically a blob or object URL), so it cannot be routed
        // through next/image's build-time optimizer, and it must never become
        // a public asset path.
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
              className="absolute flex items-center justify-center px-[0.4cqw] text-center font-normal leading-[1.08]"
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

        <dl className="space-y-0.5 text-xs text-slate-500">
          {provenance.map((entry) => (
            <div key={entry.label}>
              <dt className="inline font-medium text-slate-600">{entry.label}: </dt>
              <dd className="inline">{entry.value}</dd>
            </div>
          ))}
        </dl>
      </figcaption>
    </figure>
  );
}
