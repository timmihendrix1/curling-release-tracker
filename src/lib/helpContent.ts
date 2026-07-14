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
import type { BlockMode, MeasurementMode } from "../types";

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
