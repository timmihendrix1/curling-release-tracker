// Measured geometry for the English labels drawn over a Swiss Curling source diagram.
//
// The published diagram images no longer contain any German text: the source text
// objects are removed by `scripts/generate_swiss_curling_diagrams.py` before the page is
// rendered, so nothing has to be painted over and no ice-sheet geometry is lost. What
// remains is where each removed label sat, which is exactly what
// `swissCurlingDiagramLabels.ts` records — one normalised box per label, derived from the
// source page rather than estimated by eye.
//
// Content modules supply only the English wording. Position, type size and text colour
// come from the measurement, so a label can never drift away from the place the source
// put it and two differently positioned labels can never share one guessed coordinate.
import { SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY } from "./swissCurlingDiagramLabels";
import type { ExerciseDiagram } from "./types";

export type NormalisedBox = {
  /** Normalised against the image's own width and height. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SwissCurlingDiagramLabelBox = NormalisedBox & {
  /**
   * The callout rectangle the source drew around this label, inset by its stroke, when
   * it drew one. Present only where the source itself framed the label.
   */
  container?: NormalisedBox;
  /** How many lines the removed source label occupied. */
  lines: number;
  lineHeight: number;
  /** The source's own type size, normalised against the image width. */
  fontSize: number;
  textColor: string;
  /** The German label this box replaces. Provenance for review; never displayed. */
  replaces: string;
};

export type SwissCurlingDiagramLabelGeometry = Readonly<
  Record<string, Readonly<Record<string, SwissCurlingDiagramLabelBox>>>
>;

type SourceImageDiagram = Extract<ExerciseDiagram, { kind: "attributed-source-image" }>;
type LocalizedTextOverlay = NonNullable<SourceImageDiagram["localizedTextOverlays"]>[number];

/**
 * Builds one English label from measured source geometry. Throws rather than guessing:
 * an unknown asset or label id means the diagram was regenerated without its geometry,
 * and a silently mispositioned label is worse than a build failure.
 *
 * Where the source framed the label in a callout, the label fills that rectangle, so it
 * is centred in the space the source actually made for it. English wording is rarely the
 * same length as the German it replaces, and centring instead on the German glyph run
 * pushes the difference outward — far enough on Draw Exercise 12 to clip the label
 * against the edge of the image. Where there is no callout the label stays centred on
 * the text it replaces, which is the only anchor the source offers.
 *
 * The label keeps the source's own type size. Where the English wording is longer than
 * the German it replaces, the remedy is to break it across the lines the source label
 * itself used — not to shrink it below what is readable on a phone.
 */
export function sourceDiagramLabel(
  assetId: string,
  labelId: string,
  text: string
): LocalizedTextOverlay {
  const asset = SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY[assetId];
  const box = asset?.[labelId];
  if (!box) {
    throw new Error(
      `No measured label geometry for "${labelId}" on Swiss Curling diagram asset "${assetId}". ` +
        "Regenerate scripts/generate_swiss_curling_diagrams.py output before referencing it."
    );
  }

  const anchor = box.container ?? box;
  const lines = text.split("\n").length;
  // The English wording may need more or fewer lines than the German it replaces. The
  // box stays centred on the anchor so the label keeps its place in the diagram.
  const height = Math.max(anchor.height, lines * box.lineHeight);
  const y = Math.max(0, Math.min(1 - height, anchor.y + anchor.height / 2 - height / 2));

  return {
    id: labelId,
    x: anchor.x,
    y: Number(y.toFixed(4)),
    width: anchor.width,
    height: Number(height.toFixed(4)),
    text,
    textColor: box.textColor,
    fontSize: box.fontSize,
  };
}
