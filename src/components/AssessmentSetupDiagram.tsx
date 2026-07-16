import { ASSESSMENT_SETUP_DIAGRAM_LABEL } from "../lib/assessmentContent";

/**
 * A simple, provider-neutral schematic of the Backline–Hog measurement setup
 * — hack, delivery direction, backline/Gate 1, hogline/Gate 2, stone path,
 * with the measured segment highlighted. Plain SVG (no external asset, no
 * manufacturer branding), described textually for screen readers via
 * <title>/<desc> rather than relying on the visual alone. See
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 24.
 */
export default function AssessmentSetupDiagram() {
  return (
    <figure className="mx-auto max-w-xs">
      <svg
        viewBox="0 0 220 320"
        role="img"
        aria-labelledby="assessment-setup-diagram-title assessment-setup-diagram-desc"
        className="w-full"
      >
        <title id="assessment-setup-diagram-title">Backline–Hog setup diagram</title>
        <desc id="assessment-setup-diagram-desc">
          A schematic sheet of ice showing the hack at the bottom, the delivery
          direction pointing up, the backline with Timing Gate 1 just above
          the hack, the hogline with Timing Gate 2 further up, and the stone
          path between them. The segment between the backline and hogline is
          highlighted as the measured segment.
        </desc>

        {/* Sheet background */}
        <rect x="10" y="10" width="200" height="300" rx="8" className="fill-slate-100" />

        {/* Measured segment highlight (Backline -> Hogline) */}
        <rect x="10" y="130" width="200" height="90" className="fill-sky-100" />

        {/* Stone path */}
        <line
          x1="110"
          y1="280"
          x2="110"
          y2="40"
          className="stroke-slate-400"
          strokeWidth="2"
          strokeDasharray="6 5"
        />
        <path d="M104 46 L110 34 L116 46 Z" className="fill-slate-400" />

        {/* Hack */}
        <rect x="98" y="272" width="24" height="14" rx="2" className="fill-slate-700" />
        <text x="110" y="298" textAnchor="middle" className="fill-slate-600 text-[10px]">
          Hack
        </text>

        {/* Backline + Gate 1 */}
        <line x1="10" y1="220" x2="210" y2="220" className="stroke-slate-500" strokeWidth="2" />
        <text x="14" y="234" className="fill-slate-700 text-[10px] font-medium">
          Backline
        </text>
        <rect x="150" y="212" width="16" height="16" rx="3" className="fill-sky-600" />
        <text x="168" y="234" className="fill-sky-700 text-[10px] font-medium">
          Gate 1
        </text>

        {/* Hogline + Gate 2 */}
        <line x1="10" y1="130" x2="210" y2="130" className="stroke-slate-500" strokeWidth="2" />
        <text x="14" y="122" className="fill-slate-700 text-[10px] font-medium">
          Hogline
        </text>
        <rect x="150" y="122" width="16" height="16" rx="3" className="fill-sky-600" />
        <text x="168" y="122" className="fill-sky-700 text-[10px] font-medium">
          Gate 2
        </text>

        {/* Delivery direction arrow */}
        <line x1="75" y1="270" x2="75" y2="200" className="stroke-slate-400" strokeWidth="2" />
        <path d="M69 206 L75 194 L81 206 Z" className="fill-slate-400" />
        <text x="75" y="285" textAnchor="middle" className="fill-slate-500 text-[9px]">
          Delivery
        </text>
      </svg>

      <figcaption className="mt-2 text-center text-xs font-medium text-slate-600">
        {ASSESSMENT_SETUP_DIAGRAM_LABEL}
      </figcaption>
    </figure>
  );
}
