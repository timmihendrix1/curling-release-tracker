import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  resolveExerciseAssetAccess,
  type ExerciseAssetAccess,
  type ExerciseAssetResolver,
} from "../lib/exercises/exerciseAssets";
import {
  DIAGRAM_ENLARGE_LABEL,
  DIAGRAM_ENLARGED_CLOSE_LABEL,
  DIAGRAM_ENLARGED_HINT,
  RESTRICTED_DIAGRAM_UNAVAILABLE_BODY,
  RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE,
} from "../lib/exercises/presentation";
import type { ExerciseDiagram } from "../lib/exercises/types";

type SourceImageDiagram = Extract<ExerciseDiagram, { kind: "attributed-source-image" }>;

/**
 * The typeface the source collection sets its own diagram labels in.
 *
 * A localized label is a faithful replacement for a label the source document drew, and
 * its position and type size are measured from that document. Painting it in the
 * application's UI font would render those measurements wrong: the UI font is about 7 %
 * wider than Arial at the same nominal size, which is enough to push a label past the
 * callout rectangle it belongs in — or, on Draw Exercise 12, a fraction of a pixel past
 * the edge of the image, where it is clipped. Liberation Sans is metric-compatible with
 * Arial and covers Linux and Android.
 */
const SOURCE_LABEL_FONT_FAMILY = 'Arial, Helvetica, "Liberation Sans", sans-serif';

type ExerciseRestrictedSourceImageProps = {
  diagram: SourceImageDiagram;
  /** Required for the image to render; absence always fails closed. */
  exerciseAssetResolver?: ExerciseAssetResolver;
};

/**
 * The image and its English labels, as one block whose overlay coordinates stay tied to
 * the image's own box. Extracted so the overview and the enlarged view render exactly
 * the same thing at two sizes rather than diverging into two layouts.
 *
 * A label is drawn directly on the diagram: the corpus removes the source's own text
 * before the image is published, so nothing has to be masked and no opaque patch can sit
 * on a stone, an arrow or a target-zone boundary. `backgroundColor` therefore stays
 * optional and is used only by a historical Version whose image still carries its
 * original text.
 */
function LabelledDiagramImage({
  diagram,
  src,
}: {
  diagram: SourceImageDiagram;
  src: string;
}) {
  return (
    // The source is produced by the resolver (currently a cached Data URL), so it is
    // intentionally rendered without next/image optimization.
    <div className="relative w-full [container-type:inline-size]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={diagram.accessibleSummary} className="h-auto w-full" />
      {diagram.localizedTextOverlays?.map((overlay) => (
        <span
          key={overlay.id}
          aria-hidden="true"
          className="absolute flex items-center justify-center whitespace-pre text-center font-medium leading-[1.15]"
          style={{
            left: `${overlay.x * 100}%`,
            top: `${overlay.y * 100}%`,
            width: `${overlay.width * 100}%`,
            height: `${overlay.height * 100}%`,
            backgroundColor: overlay.backgroundColor,
            color: overlay.textColor,
            fontFamily: SOURCE_LABEL_FONT_FAMILY,
            fontSize: `${overlay.fontSize * 100}cqw`,
          }}
        >
          {overlay.text}
        </span>
      ))}
    </div>
  );
}

/**
 * Renders an attributed source-image Diagram only through the injected asset
 * resolver. The resolver may serve a publicly cleared, locally cached asset or
 * a future restricted asset. The opaque catalog reference is never written to
 * the DOM and the compact caption is the only source text shown beside the
 * image; full source attribution lives once at the bottom of the Exercise.
 *
 * The inline view always shows the **whole** diagram, scaled to the column: a setup
 * diagram that is cropped is worse than useless, because the athlete cannot tell that
 * anything is missing. Small labels are the price of that, so an enlargement action
 * opens the same diagram full-screen at a readable size, with its close control fixed
 * and reachable no matter how far the image is scrolled.
 */
export default function ExerciseRestrictedSourceImage({
  diagram,
  exerciseAssetResolver,
}: ExerciseRestrictedSourceImageProps) {
  const unavailable: ExerciseAssetAccess = { available: false };
  const dialogTitleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const enlargeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [enlargedDiagramId, setEnlargedDiagramId] = useState<string | null>(null);
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
  const enlarged = access.available && enlargedDiagramId === diagram.id;

  /**
   * Closing always returns focus to the control that opened the enlargement, so the
   * keyboard is never dropped back at the top of the document — and, when the diagram
   * is being previewed inside the Training Plan step editor, the athlete lands back on
   * the same preview rather than somewhere else in the form.
   */
  const closeEnlargement = useCallback(() => {
    setEnlargedDiagramId(null);
    enlargeButtonRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!enlarged) return;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("[data-diagram-close]")?.focus();

    /**
     * The enlargement is `aria-modal`, so it has to behave like one: Tab and Shift+Tab
     * cycle inside it instead of walking into the page underneath. Without this, one Tab
     * past the scroll area reaches the plan editor's own controls while the overlay
     * still covers them.
     *
     * The handler is bound to the window rather than the dialog because focus can be
     * outside the dialog when it opens is interrupted, and because Escape must be caught
     * wherever focus currently is. It is also the reason `stopPropagation` is not needed:
     * no ancestor of this component listens for either key.
     */
    function handleKeyDown(event: KeyboardEvent) {
      const current = dialogRef.current;
      if (!current) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeEnlargement();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = [
        ...current.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [tabindex]:not([tabindex='-1'])"
        ),
      ].filter((element) => element.offsetParent !== null || element === current);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const inside = active instanceof Node && current.contains(active);

      if (!inside) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enlarged, closeEnlargement]);

  return (
    <figure className="w-full">
      {access.available ? (
        <div className="w-full overflow-hidden rounded-xl">
          <LabelledDiagramImage diagram={diagram} src={access.src} />
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

      {access.available && (
        <button
          type="button"
          ref={enlargeButtonRef}
          onClick={() => setEnlargedDiagramId(diagram.id)}
          className="mt-2 min-h-11 w-full rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          {DIAGRAM_ENLARGE_LABEL}
        </button>
      )}

      <figcaption className="mt-2 space-y-2">
        <span className="block text-center text-xs font-medium text-slate-600">
          {diagram.caption}
        </span>
      </figcaption>

      {enlarged && access.available && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={dialogTitleId}
          ref={dialogRef}
          data-testid="exercise-diagram-enlarged"
          className="fixed inset-0 z-50 flex flex-col bg-slate-950/80"
        >
          {/* The header never scrolls away, so the close control stays reachable
              however far the enlarged diagram has been panned. */}
          <div className="flex shrink-0 items-center justify-between gap-3 bg-white px-4 py-3 shadow">
            <p id={dialogTitleId} className="text-sm font-medium text-slate-800">
              {diagram.caption}
            </p>
            <button
              type="button"
              data-diagram-close=""
              onClick={closeEnlargement}
              className="min-h-11 shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {DIAGRAM_ENLARGED_CLOSE_LABEL}
            </button>
          </div>

          {/* Twice the column width, so the labels are readable, and scrollable on
              both axes for the rest. `tabIndex` makes the scroll area a focus stop, so
              the arrow keys pan the diagram without a pointer — and keeps it inside the
              trap's own cycle. */}
          <div
            tabIndex={0}
            aria-label={diagram.accessibleSummary}
            className="min-h-0 flex-1 overflow-auto bg-white p-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-500"
          >
            <div className="mx-auto w-[200%] max-w-[1400px] sm:w-full">
              <LabelledDiagramImage diagram={diagram} src={access.src} />
            </div>
          </div>

          <p className="shrink-0 bg-white px-4 pb-3 text-center text-xs text-slate-500">
            {DIAGRAM_ENLARGED_HINT}
          </p>
        </div>
      )}
    </figure>
  );
}
