/**
 * Central, reusable explanations for the concepts a new user configures
 * before/while training — Training Category (Fixed/Variable/Blind Weight) and
 * Measurement Mode (Back-Hog/Hog-Hog). Rendered through the existing
 * `InfoButton` (see `InfoButton.tsx`), the same affordance already used for
 * metrics and charts (`analyticsExplanations.ts`) — this file intentionally
 * stays a separate module from that one: `analyticsExplanations.ts` is scoped
 * to interpreting already-recorded analytics, this file is scoped to
 * understanding a training concept before/while choosing it. No UI component
 * should hard-code this text a second time.
 *
 * Scope, per docs/COACHING_PRINCIPLES.md: these explanations describe purpose,
 * mechanics and possible use cases only. They never diagnose technique, never
 * rank one Training Category as objectively better than another, and never
 * assign a performance-level label (no "Elite"/"Beginner" framing) — see
 * ADR-0008's choice of "Tight" over "Elite" for the same reason.
 */
import type { BlockMode, MeasuredQuantity, MeasurementMode } from "../types";

export type FeatureExplanation = {
  id: string;
  title: string;
  shortDescription: string;
  /** The primary coaching question this feature helps answer. */
  purpose: string;
  howItWorks: string[];
  usefulFor: string[];
  limitations?: string[];
};

export function fixedWeightExplanation(): FeatureExplanation {
  return {
    id: "fixed-weight",
    title: "Fixed Weight",
    shortDescription:
      "Repeat the same target time to improve precision, consistency and control of systematic bias.",
    purpose: "Can I repeatedly reproduce the same release?",
    howItWorks: [
      "The target time stays constant for every shot in the block.",
      "Repeating one target makes reproducibility, bias and spread easy to see across the block.",
      "Because the target never changes, shots and handles can be compared directly against one another.",
    ],
    usefulFor: [
      "Calibration",
      "Repetition and consistency",
      "Technical practice",
      "Handle comparison",
      "Testing one specific weight",
    ],
  };
}

export function variableWeightExplanation(): FeatureExplanation {
  return {
    id: "variable-weight",
    title: "Variable Weight",
    shortDescription:
      "Practice adapting your release to changing target times instead of returning to one preferred weight.",
    purpose: "Can I adapt accurately to changing targets?",
    howItWorks: [
      "The target time changes from shot to shot within the block.",
      "Targets can come from Smart Random (varied automatically) or Coach / Manual entry.",
      "The Target vs. Actual scatterplot is especially useful here — it shows how closely each different target was reproduced.",
    ],
    usefulFor: [
      "Weight adaptation",
      "Different draw lengths",
      "Changing game situations",
      "Detecting a preferred-weight fallback",
      "Practising a wider target range",
    ],
  };
}

export function blindWeightExplanation(): FeatureExplanation {
  return {
    id: "blind-weight",
    title: "Blind Weight",
    shortDescription: "Predict your release time before checking the measured value.",
    purpose: "Can I accurately judge my own release?",
    howItWorks: [
      "You predict your own release time first, before the measured value is available.",
      "Only afterward do you enter the measured release time.",
      "Prediction Accuracy (how well you judged yourself) and Target Accuracy (how close you were to target) are tracked as two separate questions.",
    ],
    usefulFor: [
      "Weight awareness",
      "Internal calibration",
      "Advanced feedback training",
      "Comparing perception with measurement",
      "Preparing to recognise weight without immediate external feedback",
    ],
    limitations: [
      "Not reserved for any particular playing level — weight awareness is worth training at any stage.",
    ],
  };
}

export function trainingCategoryExplanation(mode: BlockMode): FeatureExplanation {
  switch (mode) {
    case "fixed":
      return fixedWeightExplanation();
    case "variable":
      return variableWeightExplanation();
    case "blind":
      return blindWeightExplanation();
  }
}

export function backHogExplanation(): FeatureExplanation {
  return {
    id: "back-hog",
    title: "Backline – Hog",
    shortDescription: "Release time from the back line to the hog line.",
    purpose: "Typically used to judge release weight.",
    howItWorks: [
      "Measures the release time from the back line to the hog line — this app's Backline – Hog Measurement Mode.",
      "A lower time usually means more weight and a longer result.",
      "A higher time usually means less weight and a shorter result.",
    ],
    usefulFor: [
      "Judging release weight",
      "Comparing shots measured the same way",
    ],
    limitations: [
      "Backline – Hog and Hog – Hog measure different stretches of ice — the two should never be compared directly.",
    ],
  };
}

export function hogHogExplanation(): FeatureExplanation {
  return {
    id: "hog-hog",
    title: "Hog – Hog",
    shortDescription: "Release time between the two hog lines.",
    purpose: "A different measurement than Backline – Hog.",
    howItWorks: [
      "Measures the release time between the two hog lines.",
      "This is a different stretch of ice than Backline – Hog, so the two are not directly comparable.",
    ],
    usefulFor: ["Training with a Hog – Hog–based measurement setup"],
    limitations: [
      "No validated Smart Random target range exists yet for Hog – Hog, so Smart Random isn't offered for this Measurement Mode.",
      "Hog – Hog and Backline – Hog values must never be mixed or compared directly.",
    ],
  };
}

export function measurementModeExplanation(
  mode: MeasurementMode
): FeatureExplanation {
  return mode === "back-hog" ? backHogExplanation() : hogHogExplanation();
}

/**
 * The Training Plan's own progression controls. Explains why the planned stone count
 * is guidance rather than a gate — see docs/TRAINING_SYSTEM_AND_PLANS.md section 31,
 * the canonical statement of flexible progression.
 */
export function trainingPlanProgressionExplanation(): FeatureExplanation {
  return {
    id: "training-plan-progression",
    title: "Moving through a Training Plan",
    shortDescription:
      "The planned stone count is guidance. You decide when to move on and when to finish.",
    purpose: "How do I follow a plan without letting it dictate the session?",
    howItWorks: [
      "Next Exercise is available at any time — before, at, or beyond the planned stone count, and even with nothing recorded yet.",
      "Reaching the planned count never advances the plan by itself, so you can keep recording extra stones in the same exercise.",
      "Finish Training ends the session at any point and saves everything already recorded to history.",
      "Progress shows the actual count next to the planned one, for example 6 of 12 planned stones.",
    ],
    usefulFor: [
      "Shortening an exercise when ice time runs out",
      "Extending an exercise that is working well",
      "Skipping past an exercise the session no longer needs",
      "Ending a training early without losing recorded work",
    ],
    limitations: [
      "Returning to an earlier exercise is not available — the plan only moves forward.",
      "A recorded stone below the planned count is kept as recorded; the app does not treat it as an error or fill the gap.",
    ],
  };
}

/**
 * The assisted Brower capture pilot. Written to the honesty rule the pilot decision
 * imposes: what the timer measures, what the app can and cannot know about it, and which
 * contexts record automatically and which still need a tap. See docs/BROWER_INTEGRATION_STATUS.md.
 */
export function browerAssistedCaptureExplanation(): FeatureExplanation {
  return {
    id: "brower-assisted-capture",
    title: "Timer Measurements",
    shortDescription:
      "Record filtered Back–Hog times directly from a connected Brower TCi timer after confirming setup.",
    purpose: "How do I record measured times without transcribing them by hand?",
    howItWorks: [
      "Connect the timer, then finish setting up. Everything the timer reports before you confirm setup is treated as already known and is never offered.",
      "Confirming setup starts the offers. For Fixed Weight Back–Hog, the Shot Type selected in Auto Capture filters them: Draw 3–5 seconds, Takeout 2–4 seconds, including the endpoints.",
      "Times outside that range are hidden and counted. They still contribute to the calculation of the next interval, so walking back does not change the next shot time.",
      "Each candidate shows the interval between two consecutive splits, so you can compare it against the timer's own display. Open Details for the record it came from and the running totals behind it.",
      "Matching Back–Hog times are recorded automatically, in order, as the next shots. Wait for the saved message; saving problems pause recording and offer a retry.",
      "Use Undo Last Captured Shot to reverse the last capture, or Delete to remove a shot from the list. Delete does not rewind the sequence counter.",
      "The panel keeps counts, timer record identifiers and protocol explanations in its Details section. Opening or closing it changes nothing about the connection or recording.",
    ],
    usefulFor: [
      "Training with two light gates without writing times down",
      "Throwing several stones in a row without touching the timer between them",
      "Keeping the exact measured value rather than the timer's truncated display",
    ],
    limitations: [
      "The range filter cannot identify a shot: a return or accidental trigger inside the range can still appear. Correct unwanted recorded shots with Undo or Delete. Hog–Hog and sequences without Shot Type have no range filter and still need a tap to record.",
      "The time a measurement arrives is not proof of when it was measured. A delayed reading looks the same as a fresh one.",
      "Capture only runs while this screen is in the foreground. Leaving the app or locking the screen stops it, and you will have to reconnect and confirm setup again.",
      "A timer record holds 20 splits. When it is full, start a new record on the timer and confirm setup again.",
      "A connected timer does not mean times are arriving. After an unclear transfer the panel waits for a clear update from the same record, and nothing is recorded until it arrives.",
      "Typing a time by hand stays available at all times and is never replaced by this.",
    ],
  };
}

/**
 * What a Fixed Weight exercise measures. Speed is entered by hand in this release —
 * stated plainly here rather than discovered at the rink, and never implied to be
 * derived from a timer reading (there is no conversion between the two units).
 *
 * See docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md and ADR-0051.
 */
/**
 * The one-line description shown under the Training Mode control.
 *
 * Fixed Weight no longer necessarily repeats a target TIME — it may repeat a target
 * speed, or both — so the generic explanation's sentence would describe something the
 * athlete did not choose. Variable and Blind Weight measure time only and keep their
 * existing wording exactly.
 */
export function trainingModeShortDescription(
  mode: BlockMode,
  quantities: MeasuredQuantity[]
): string {
  if (mode !== "fixed") return trainingCategoryExplanation(mode).shortDescription;

  const measuresTime = quantities.includes("time");
  const measuresSpeed = quantities.includes("speed");

  if (measuresTime && measuresSpeed) {
    return "Repeat the same target time and target speed to improve precision, consistency and control of systematic bias.";
  }
  if (measuresSpeed) {
    return "Repeat the same target speed to improve precision, consistency and control of systematic bias.";
  }
  return trainingCategoryExplanation(mode).shortDescription;
}

export function measuredQuantitiesExplanation(): FeatureExplanation {
  return {
    id: "measured-quantities",
    title: "What this exercise measures",
    shortDescription:
      "Fixed Weight can record release time, stone speed, or both on the same stone.",
    purpose: "Which measurement tells me what I am trying to find out?",
    howItWorks: [
      "Time records a release time in seconds over the timing interval you choose.",
      "Speed records a stone speed in metres per second, typed in by hand.",
      "Both records the two measurements on one stone, each against its own target and its own tolerance.",
      "The two are judged separately and are never averaged or scored together — seconds and metres per second are different quantities.",
    ],
    usefulFor: [
      "Training release time the way you always have",
      "Working with a speed trap or a coach calling out speeds",
      "Comparing what a release felt like against what the stone actually did",
    ],
    limitations: [
      "Speed is entered manually. No supported device reports speed to the app, and a time is never converted into a speed.",
      "Variable Weight and Blind Weight measure time only.",
      "What an exercise measures is fixed when it starts, so every stone in it is comparable.",
    ],
  };
}
