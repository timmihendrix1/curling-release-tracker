"use client";

import { useId } from "react";
import { DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE } from "../lib/exercises/presentation";
import {
  EXERCISE_DIAGRAM_ELEMENT_KINDS,
  type ExerciseDiagram,
  type ExerciseDiagramElement,
  type ExerciseDiagramElementKind,
  type ExerciseDiagramTextAnchor,
  type NormalizedPoint,
} from "../lib/exercises/types";

type StructuredDiagram = Extract<ExerciseDiagram, { kind: "structured-platform-diagram" }>;

type ExerciseStructuredDiagramProps = {
  diagram: StructuredDiagram;
};

/**
 * The viewBox is always 100 wide; its height comes from the diagram's own
 * declared aspect ratio, so one unit is the same physical distance on both
 * axes. That is what lets a `house` radius — expressed in `x` units, i.e. a
 * fraction of the depicted length — render as a true circle. See
 * `normalized-ice-sheet-v1` in src/lib/exercises/types.ts.
 */
const VIEWBOX_WIDTH = 100;

/**
 * Presentation-only constants. A real stone is barely visible at sheet scale,
 * so markers are drawn slightly larger than life for legibility — a rendering
 * choice, deliberately not part of the content data.
 */
const STONE_RADIUS_UNITS = 0.022;
const LABEL_FONT_UNITS = 4.6;
const ZONE_LABEL_FONT_UNITS = 5;
const ARROW_HEAD_UNITS = 3.2;
const ARROW_LABEL_OFFSET_UNITS = 4;
/** Inside this margin the label anchors to the nearer edge instead of centring. */
const ARROW_LABEL_EDGE_UNITS = 20;

const HOUSE_RING_FILLS = ["fill-sky-100", "fill-white", "fill-sky-200", "fill-white"];

function stoneFill(role: "delivered" | "setup" | "marker"): string {
  switch (role) {
    case "delivered":
      return "fill-slate-700";
    case "setup":
      return "fill-slate-400";
    case "marker":
      return "fill-slate-500";
  }
}

function isSupportedElement(element: ExerciseDiagramElement): boolean {
  return (EXERCISE_DIAGRAM_ELEMENT_KINDS as readonly string[]).includes(
    (element as { kind: ExerciseDiagramElementKind }).kind
  );
}

/**
 * A generic, data-driven renderer for any structured platform Diagram. It
 * branches on the element's declared `kind` only — never on which Exercise or
 * diagram it belongs to.
 *
 * Responsive by construction: one `viewBox`, `w-full h-auto`, no pixel
 * geometry anywhere, so it fits a 390 px viewport without horizontal overflow.
 */
export default function ExerciseStructuredDiagram({ diagram }: ExerciseStructuredDiagramProps) {
  const reactId = useId();
  const titleId = `${reactId}-title`;
  const descId = `${reactId}-desc`;

  const viewBoxHeight = VIEWBOX_WIDTH / diagram.aspectRatio;

  const vx = (x: number) => x * VIEWBOX_WIDTH;
  const vy = (y: number) => y * viewBoxHeight;
  /** Radii and other lengths are declared in `x` units. */
  const vr = (length: number) => length * VIEWBOX_WIDTH;

  const supported = diagram.elements.filter(isSupportedElement);
  const unsupportedCount = diagram.elements.length - supported.length;

  return (
    <figure className="w-full">
      <svg
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${viewBoxHeight}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="h-auto w-full"
        data-testid="exercise-structured-diagram"
      >
        <title id={titleId}>{diagram.caption}</title>
        <desc id={descId}>{diagram.accessibleSummary}</desc>

        {/* Every element is wrapped in one group carrying its declared id and
            kind, so the rendered diagram stays inspectable as data rather than
            as anonymous shapes. */}
        {supported.map((element) => (
          <g key={element.id} data-element-id={element.id} data-element-kind={element.kind}>
            {renderElement(element, { vx, vy, vr })}
          </g>
        ))}
      </svg>

      {unsupportedCount > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE}
        </p>
      )}

      <figcaption className="mt-2 text-center text-xs font-medium text-slate-600">
        {diagram.caption}
      </figcaption>
    </figure>
  );
}

type Scale = {
  vx: (x: number) => number;
  vy: (y: number) => number;
  vr: (length: number) => number;
};

function rectFrom(from: NormalizedPoint, to: NormalizedPoint, scale: Scale) {
  const x1 = scale.vx(from.x);
  const y1 = scale.vy(from.y);
  const x2 = scale.vx(to.x);
  const y2 = scale.vy(to.y);
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * An optional arrow label is placed perpendicular to its shaft, which can push
 * it past a viewBox edge for an arrow near the boundary. Clamp the position and
 * derive the text anchor from it, so a label is never clipped whichever
 * orientation the authored arrow has.
 */
function renderArrowLabel(label: string, at: { x: number; y: number }) {
  const x = Math.min(Math.max(at.x, 1), VIEWBOX_WIDTH - 1);
  const anchor: ExerciseDiagramTextAnchor =
    x < ARROW_LABEL_EDGE_UNITS
      ? "start"
      : x > VIEWBOX_WIDTH - ARROW_LABEL_EDGE_UNITS
        ? "end"
        : "middle";

  return (
    <text
      x={x}
      y={at.y}
      textAnchor={anchor}
      dominantBaseline="middle"
      fontSize={LABEL_FONT_UNITS}
      className="fill-slate-600"
    >
      {label}
    </text>
  );
}

function renderElement(element: ExerciseDiagramElement, scale: Scale) {
  const { vx, vy, vr } = scale;

  switch (element.kind) {
    case "sheet": {
      const rect = rectFrom(element.from, element.to, scale);
      return <rect key={element.id} {...rect} rx={2} className="fill-slate-100" />;
    }

    case "line":
      return (
        <line
          key={element.id}
          x1={vx(element.from.x)}
          y1={vy(element.from.y)}
          x2={vx(element.to.x)}
          y2={vy(element.to.y)}
          strokeWidth={element.style === "dashed" ? 0.4 : 0.7}
          strokeDasharray={element.style === "dashed" ? "2 2" : undefined}
          className={element.style === "dashed" ? "stroke-slate-300" : "stroke-slate-500"}
        />
      );

    case "house":
      return (
        <g key={element.id}>
          {element.radii.map((radius, index) => (
            <circle
              key={`${element.id}-ring-${index}`}
              cx={vx(element.center.x)}
              cy={vy(element.center.y)}
              r={vr(radius)}
              strokeWidth={0.4}
              className={`${HOUSE_RING_FILLS[index % HOUSE_RING_FILLS.length]} stroke-slate-300`}
            />
          ))}
        </g>
      );

    case "target-zone": {
      const rect = rectFrom(element.from, element.to, scale);
      return (
        <g key={element.id}>
          <rect
            {...rect}
            rx={1}
            strokeWidth={0.3}
            strokeDasharray="1.5 1.5"
            className="fill-sky-100 stroke-sky-400"
          />
          {element.label && (
            <text
              x={rect.x + rect.width / 2}
              y={rect.y + rect.height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={ZONE_LABEL_FONT_UNITS}
              className="fill-sky-800 font-semibold"
            >
              {element.label}
            </text>
          )}
        </g>
      );
    }

    case "stone":
      return (
        <g key={element.id}>
          <circle
            cx={vx(element.at.x)}
            cy={vy(element.at.y)}
            r={vr(STONE_RADIUS_UNITS)}
            strokeWidth={0.4}
            className={`${stoneFill(element.role)} stroke-white`}
          />
          {element.sequenceLabel && (
            <text
              x={vx(element.at.x)}
              y={vy(element.at.y) - vr(STONE_RADIUS_UNITS) - 1.2}
              textAnchor="middle"
              fontSize={LABEL_FONT_UNITS}
              className="fill-slate-600"
            >
              {element.sequenceLabel}
            </text>
          )}
        </g>
      );

    case "path":
      return (
        <polyline
          key={element.id}
          points={element.points.map((point) => `${vx(point.x)},${vy(point.y)}`).join(" ")}
          fill="none"
          strokeWidth={element.style === "dashed" ? 0.4 : 0.6}
          strokeDasharray={element.style === "dashed" ? "2 2" : undefined}
          className="stroke-slate-400"
        />
      );

    case "arrow": {
      const x1 = vx(element.from.x);
      const y1 = vy(element.from.y);
      const x2 = vx(element.to.x);
      const y2 = vy(element.to.y);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      // Perpendicular unit vector, used for the arrow head's base and to push
      // the optional label clear of the shaft in any orientation.
      const px = -uy;
      const py = ux;
      const baseX = x2 - ux * ARROW_HEAD_UNITS;
      const baseY = y2 - uy * ARROW_HEAD_UNITS;
      const half = ARROW_HEAD_UNITS * 0.45;

      return (
        <g key={element.id}>
          <line
            x1={x1}
            y1={y1}
            x2={baseX}
            y2={baseY}
            strokeWidth={0.6}
            className="stroke-slate-500"
          />
          <polygon
            points={`${x2},${y2} ${baseX + px * half},${baseY + py * half} ${baseX - px * half},${
              baseY - py * half
            }`}
            className="fill-slate-500"
          />
          {element.label && renderArrowLabel(element.label, {
            x: (x1 + x2) / 2 + px * ARROW_LABEL_OFFSET_UNITS,
            y: (y1 + y2) / 2 + py * ARROW_LABEL_OFFSET_UNITS,
          })}
        </g>
      );
    }

    case "label":
      return (
        <text
          key={element.id}
          x={vx(element.at.x)}
          y={vy(element.at.y)}
          textAnchor={element.anchor ?? "start"}
          fontSize={LABEL_FONT_UNITS}
          className="fill-slate-600 font-medium"
        >
          {element.text}
        </text>
      );
  }
}
