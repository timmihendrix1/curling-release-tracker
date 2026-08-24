// Structured platform Diagram content (spec section 6).
//
// The Eight Guards diagram below is **independently authored** for this
// application: it is drawn in this project's own `normalized-ice-sheet-v1`
// coordinate system, uses this project's own composition and English labels,
// and contains no raster pixels, page layout, branding or German text from any
// source document. Stage A deliberately bundles no restricted source image at
// all — the attributed-source-image Diagram variant exists and is validated
// (see `types.ts`, `validation.ts`, `restrictedAssets.ts`), but no Stage A
// catalog Exercise uses it, so nothing restricted can leak into a client
// bundle or a public asset path.
import {
  EXERCISE_DIAGRAM_SCHEMA_VERSION,
  type ExerciseDiagram,
  type ExerciseDiagramElement,
} from "./types";

// --- Geometry (all values in `x` units — a fraction of the depicted length) ---
//
// Seen from above, with the direction of travel left to right. The depicted
// section is roughly 31 ft long — a short run-up before the hog line, the 21 ft
// to the tee line, and the 6 ft that puts the whole twelve-foot ring inside the
// frame — across a 15 ft 7 in sheet, so `aspectRatio` is 2 and the rendered
// viewBox is a comfortable 100 x 50 on a phone. Every number below is a
// hand-authored literal, not derived from any random or external source.
const ASPECT_RATIO = 2;
const HOG_LINE_X = 0.1;
const TEE_LINE_X = 0.77;
const CENTRE_LINE_Y = 0.5;
/**
 * Twelve-, eight-, four-foot and button radii, outermost first, in `x` units.
 * At this scale the twelve-foot ring spans x 0.58-0.96, so the whole house is
 * inside the frame rather than cropped at the edge.
 */
const HOUSE_RADII: readonly number[] = [0.19, 0.129, 0.065, 0.016];
/** Across-sheet extent of the numbered target bands, centred on the centre line. */
const TARGET_ZONE_NEAR_Y = 0.3;
const TARGET_ZONE_FAR_Y = 0.7;
/** Where a stopped stone is moved aside, across the sheet at the same depth. */
const SET_ASIDE_Y = 0.86;

/**
 * One example progression of finishing depths: the first just past the hog
 * line, each following one deeper, the last just in front of the house (whose
 * front edge sits at TEE_LINE_X - HOUSE_RADII[0] = 0.58). These are
 * illustrative depths for the diagram, not a prescribed target the source
 * collection states.
 */
const GUARD_DEPTHS: readonly number[] = [
  0.14, 0.199, 0.258, 0.317, 0.376, 0.435, 0.494, 0.553,
];

function buildEightGuardsElements(): ExerciseDiagramElement[] {
  const elements: ExerciseDiagramElement[] = [
    { kind: "sheet", id: "sheet", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
    {
      kind: "line",
      id: "centre-line",
      from: { x: 0, y: CENTRE_LINE_Y },
      to: { x: 1, y: CENTRE_LINE_Y },
      style: "dashed",
    },
    {
      kind: "line",
      id: "hog-line",
      from: { x: HOG_LINE_X, y: 0 },
      to: { x: HOG_LINE_X, y: 1 },
      style: "solid",
    },
    {
      kind: "line",
      id: "tee-line",
      from: { x: TEE_LINE_X, y: 0 },
      to: { x: TEE_LINE_X, y: 1 },
      style: "solid",
    },
    {
      kind: "house",
      id: "house",
      center: { x: TEE_LINE_X, y: CENTRE_LINE_Y },
      radii: HOUSE_RADII,
    },
    {
      kind: "arrow",
      id: "delivery",
      from: { x: 0.01, y: CENTRE_LINE_Y },
      to: { x: 0.08, y: CENTRE_LINE_Y },
    },
    // Free text is placed as explicit `label` elements rather than attached to
    // a line or arrow, so each caption's position and anchor are authored
    // rather than inferred — the top strip above the target bands and the strip
    // between the bands and the set-aside row are the only areas kept clear.
    { kind: "label", id: "delivery-label", at: { x: 0.01, y: 0.2 }, text: "Delivery", anchor: "start" },
    { kind: "label", id: "hog-line-label", at: { x: 0.12, y: 0.08 }, text: "Hog line", anchor: "start" },
    { kind: "label", id: "tee-line-label", at: { x: 0.75, y: 0.08 }, text: "Tee line", anchor: "end" },
  ];

  GUARD_DEPTHS.forEach((depth, index) => {
    const previousDepth = index === 0 ? HOG_LINE_X : GUARD_DEPTHS[index - 1];
    const step = index + 1;

    elements.push({
      kind: "target-zone",
      id: `target-zone-${step}`,
      from: { x: previousDepth, y: TARGET_ZONE_NEAR_Y },
      to: { x: depth, y: TARGET_ZONE_FAR_Y },
      sequenceStep: step,
      label: String(step),
    });

    elements.push({
      kind: "stone",
      id: `set-aside-stone-${step}`,
      at: { x: depth, y: SET_ASIDE_Y },
      role: "marker",
    });
  });

  elements.push({
    kind: "arrow",
    id: "set-aside-move",
    from: { x: GUARD_DEPTHS[0], y: 0.72 },
    to: { x: GUARD_DEPTHS[0], y: 0.8 },
  });
  elements.push({
    kind: "label",
    id: "set-aside-label",
    at: { x: 0.19, y: 0.79 },
    text: "Move aside",
    anchor: "start",
  });

  return elements;
}

export const EIGHT_GUARDS_DIAGRAM_ID = "eight-guards-progressively-longer-diagram-v1";

/** Exported unfrozen so tests can verify the builder is deterministic; product code uses the catalog's frozen copy. */
export function buildEightGuardsDiagram(): ExerciseDiagram {
  return {
    kind: "structured-platform-diagram",
    id: EIGHT_GUARDS_DIAGRAM_ID,
    schemaVersion: EXERCISE_DIAGRAM_SCHEMA_VERSION,
    coordinateSystem: "normalized-ice-sheet-v1",
    aspectRatio: ASPECT_RATIO,
    caption: "Eight guards, progressively deeper — one example progression.",
    accessibleSummary:
      "A top-down view of the playing end of the sheet, with the direction of travel from left to right. The hog line is on the left, the house and its four rings are on the right, and the centre line runs through the middle. Eight numbered bands between the hog line and the front of the house show one example progression of finishing depths: band 1 sits just past the hog line, and each following band is deeper than the one before it, ending just in front of the house. The row of stones near the lower sideline shows where each stone is moved aside at the same depth once it has stopped, so that it marks the boundary for the next stone. No sweeping is used.",
    elements: buildEightGuardsElements(),
  };
}
