/**
 * Central, reusable UI copy for the Release Time Core Assessment v1 flow —
 * the Assess-domain counterpart to helpContent.ts/analyticsExplanations.ts.
 * Every string here is taken verbatim or near-verbatim from
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md so the UI never
 * restates the protocol in its own words. No component should hard-code this
 * text a second time. See docs/UX_WRITING_GUIDELINES.md and
 * docs/COACHING_PRINCIPLES.md — this content stays factual and transparent,
 * never suggests scientific validation or federation endorsement.
 */
import type { InvalidAttemptReason } from "./assessment/types";

export const ASSESSMENT_WHAT_IT_MEASURES = [
  "Medium delivery reproduction",
  "Slow delivery control",
  "Fast delivery control",
  "Adaptation between target speeds",
  "Consistency across both handles",
];

export const ASSESSMENT_WHAT_IT_DOES_NOT_MEASURE =
  "This assessment measures delivery-speed control. It does not evaluate final stone position, line, rotation, sweeping or overall curling ability.";

export const ASSESSMENT_WHY_STRUCTURE =
  "The assessment starts with a medium target to establish a stable baseline. It then tests slower and faster deliveries separately before measuring how accurately you can switch between them. Both handles are evenly represented so that handle-specific differences can be identified.";

export type GuidedIntroductionBlock = {
  id: string;
  name: string;
  description: string;
};

export const ASSESSMENT_GUIDED_INTRODUCTION_BLOCKS: GuidedIntroductionBlock[] = [
  {
    id: "block-1-medium-reproduction",
    name: "Medium Reproduction",
    description: "Establishes your baseline at 3.75 seconds.",
  },
  {
    id: "block-2-slow-reproduction",
    name: "Slow Reproduction",
    description: "Measures how accurately you can reproduce a slower delivery.",
  },
  {
    id: "block-3-fast-reproduction",
    name: "Fast Reproduction",
    description: "Measures controlled reproduction of a faster delivery.",
  },
  {
    id: "block-4-variable-adaptation",
    name: "Variable Adaptation",
    description: "Measures how accurately you can switch between known delivery speeds.",
  },
];

export const ASSESSMENT_THRESHOLD_EXPLANATION =
  "Accuracy Thresholds control how results are grouped. They do not change the measured times or assessment protocol.";

export const ASSESSMENT_SETUP_REQUIREMENTS = [
  "Measurement Mode: Backline–Hog",
  "Gate 1 at the backline",
  "Gate 2 at the hogline",
  "Both gates aligned to detect the stone",
  "Same gate positions for every run",
  "Clear delivery path",
  "Timing system tested",
];

export const ASSESSMENT_SETUP_NOTES =
  "Use the same timing-gate positions for every assessment run. This assessment measures delivery-speed control between the backline and hogline. It does not evaluate the final position of the stone. Changes to the physical setup may reduce comparability between runs.";

export const ASSESSMENT_SETUP_DIAGRAM_LABEL = "Measured segment: Backline to Hogline";

/**
 * Valid, technical invalid-attempt reasons only — see spec section 19. A
 * sporting/execution complaint (wrong weight, poor release, missed target,
 * wrong handle, dissatisfaction) is never offered here; those stay valid,
 * scored attempts by design. Every InvalidAttemptReason literal has a label
 * (for rendering an already-recorded attempt's reason anywhere later), but
 * the selectable options below intentionally collapse the two gate-specific
 * and two timing-quality reasons into one button each — the spec's UI list
 * has exactly 7 entries, not 9, and distinguishing "backline" vs "hogline"
 * gate failure at selection time isn't worth the extra control for this pass.
 */
export const ASSESSMENT_INVALID_REASON_LABELS: Record<InvalidAttemptReason, string> = {
  first_gate_missing: "Timing gate did not trigger",
  second_gate_missing: "Timing gate did not trigger",
  duplicate_result: "Duplicate or corrupted timing",
  corrupted_timing: "Duplicate or corrupted timing",
  external_trigger: "External trigger",
  provider_failure: "Timing system failure",
  app_failure: "App issue",
  external_interruption: "External interruption",
  other: "Other technical issue",
};

export type InvalidReasonOption = {
  reason: InvalidAttemptReason;
  label: string;
};

export const ASSESSMENT_INVALID_REASON_OPTIONS: InvalidReasonOption[] = [
  { reason: "first_gate_missing", label: "Timing gate did not trigger" },
  { reason: "corrupted_timing", label: "Duplicate or corrupted timing" },
  { reason: "external_trigger", label: "External trigger" },
  { reason: "provider_failure", label: "Timing system failure" },
  { reason: "app_failure", label: "App issue" },
  { reason: "external_interruption", label: "External interruption" },
  { reason: "other", label: "Other technical issue" },
];

export const ASSESSMENT_WRONG_HANDLE_NOTICE =
  "This attempt counts, but the executed handle differs from the planned handle.";

export const ASSESSMENT_INVALID_LIMIT_REACHED_NOTICE =
  "Resolve the timing issue before continuing.";

export const ASSESSMENT_ABANDON_EXPLANATION =
  "Attempts recorded so far will be kept as an incomplete run. An incomplete run does not count as a completed assessment and will not appear in future comparisons. Starting again creates a new Assessment Run.";

export const ASSESSMENT_LEAVE_NOTICE =
  "Leaving the assessment will pause capture. Your recorded attempts and progress will be kept.";

export const ASSESSMENT_QUARANTINE_NOTICE =
  "A saved assessment could not be restored because its data was invalid.";
