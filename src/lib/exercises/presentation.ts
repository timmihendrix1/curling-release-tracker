// English display labels and shared UI copy for the Exercise Library.
//
// Every user-facing string the Library and Exercise detail render either comes
// from curated content (`content.ts`) or from this file — no component
// hard-codes a label for a domain value, so there is exactly one place to read
// or change how a focus, purpose or sweeping policy is spoken about. Same role
// `blockModeLabel`/`measurementModeLabel` (`src/lib/trainingBlocks.ts`) and
// `src/lib/assessmentContent.ts` already play for their domains.
import type { TimingProviderType } from "../../types";
import type { FeatureExplanation } from "../helpContent";
import type {
  ExerciseDifficulty,
  ExerciseParticipantRole,
  ExerciseParticipationMode,
  ExercisePrimaryFocus,
  ExerciseRecommendedVolume,
  ExerciseRequirementLevel,
  ExerciseShotFamily,
  ExerciseSweepingPolicy,
  ExerciseSweepingRequirement,
  ExerciseTrainingPurpose,
  MeasurementMetricType,
  MeasurementUnit,
} from "./types";

export function exerciseFocusLabel(focus: ExercisePrimaryFocus): string {
  switch (focus) {
    case "technique":
      return "Technique";
    case "shotmaking":
      return "Shotmaking";
    case "measured":
      return "Measured";
  }
}

/** Library section names. Kept separate from the compact focus-chip labels. */
export function exerciseFocusGroupLabel(focus: ExercisePrimaryFocus): string {
  return focus === "measured" ? "Measured Exercises" : exerciseFocusLabel(focus);
}

export function exerciseShotFamilyLabel(family: ExerciseShotFamily): string {
  switch (family) {
    case "guard":
      return "Guard";
    case "draw":
      return "Draw";
    case "freeze":
      return "Freeze";
    case "tap":
      return "Tap";
    case "take-out":
      return "Take-out";
    case "soft-take-out":
      return "Soft Take-out";
    case "sequence":
      return "Sequence";
  }
}

export function exerciseTrainingPurposeLabel(purpose: ExerciseTrainingPurpose): string {
  switch (purpose) {
    case "repeatability":
      return "Repeatability";
    case "consistency":
      return "Consistency";
    case "weight-control":
      return "Weight control";
    case "weight-control-awareness":
      return "Weight-control awareness";
    case "line-control":
      return "Line control";
    case "handle-control":
      return "Handle control";
    case "release-location-control":
      return "Release-location control";
    case "rotation-control":
      return "Rotation control";
    case "progressive-distance-control":
      return "Progressive distance control";
    case "setup-discipline":
      return "Setup discipline";
  }
}

/** "Not rated" is the honest label for an Exercise whose source states no difficulty. */
export const UNRATED_DIFFICULTY_LABEL = "Not rated";

export function exerciseDifficultyLabel(difficulty: ExerciseDifficulty | undefined): string {
  if (!difficulty) return UNRATED_DIFFICULTY_LABEL;
  return difficulty.kind === "level"
    ? `Level ${difficulty.level}`
    : `Level ${difficulty.min}–${difficulty.max}`;
}

export function exerciseParticipationModeLabel(mode: ExerciseParticipationMode): string {
  return mode === "solo" ? "Solo" : "Team";
}

export function exerciseParticipationModesLabel(
  modes: readonly ExerciseParticipationMode[]
): string {
  const hasSolo = modes.includes("solo");
  const hasTeam = modes.includes("team");
  if (hasSolo && hasTeam) return "Solo or Team";
  if (hasTeam) return "Team";
  if (hasSolo) return "Solo";
  return "Not specified";
}

/**
 * Natural English for a participation profile's training-athlete range, with
 * correct singular/plural for both a bounded and an unbounded upper limit.
 */
export function exerciseTrainingAthleteCountLabel(
  minTrainingAthletes: number,
  maxTrainingAthletes: number | null
): string {
  const noun = (count: number) =>
    count === 1 ? "training athlete" : "training athletes";

  if (maxTrainingAthletes === null) {
    return minTrainingAthletes === 1
      ? "One or more training athletes"
      : `${minTrainingAthletes} or more training athletes`;
  }
  if (minTrainingAthletes === maxTrainingAthletes) {
    return minTrainingAthletes === 1
      ? "One training athlete"
      : `${minTrainingAthletes} ${noun(minTrainingAthletes)}`;
  }
  return `${minTrainingAthletes}–${maxTrainingAthletes} ${noun(maxTrainingAthletes)}`;
}

/**
 * The immutable Exercise Version number, phrased so it can never be confused
 * with an external collection's own version (which the provenance section
 * labels "Source version").
 */
export function exerciseVersionLabel(version: number): string {
  return `Exercise version ${version}`;
}

export function exerciseParticipantRoleLabel(role: ExerciseParticipantRole): string {
  switch (role) {
    case "delivering-athlete":
      return "Delivering athlete";
    case "sweeper":
      return "Sweeper";
    case "skip":
      return "Skip / broom giver";
    case "observer":
      return "Observer";
    case "coach":
      return "Coach";
    case "timekeeper":
      return "Timekeeper";
  }
}

export function exerciseRequirementLabel(requirement: ExerciseRequirementLevel): string {
  return requirement === "required" ? "Required" : "Optional";
}

export function exerciseSweepingPolicyLabel(policy: ExerciseSweepingPolicy): string {
  switch (policy) {
    case "forbidden":
      return "No sweeping";
    case "optional":
      return "Sweeping optional";
    case "required":
      return "Sweeping required";
  }
}

/** Factual summary of the allowed Sweeper counts, e.g. "0 Sweepers" or "0–2 Sweepers". */
export function exerciseSweeperCountSummary(sweeping: ExerciseSweepingRequirement): string {
  const counts = [...sweeping.allowedSweeperCounts].sort((a, b) => a - b);
  if (counts.length === 0) return "Sweeper count not specified";
  const min = counts[0];
  const max = counts[counts.length - 1];
  const range = min === max ? `${min}` : `${min}–${max}`;
  const singular = min === 1 && max === 1;
  return `${range} ${singular ? "Sweeper" : "Sweepers"}`;
}

export function exerciseRecommendedVolumeLabel(volume: ExerciseRecommendedVolume): string {
  switch (volume.kind) {
    case "stone-count":
      return `${volume.stones} ${volume.stones === 1 ? "stone" : "stones"}`;
    case "repetition-count":
      return `${volume.repetitions} ${volume.repetitions === 1 ? "repetition" : "repetitions"}`;
    case "open":
      return volume.note;
  }
}

export function measurementMetricTypeLabel(metricType: MeasurementMetricType): string {
  return metricType === "release-time" ? "Release Time" : "Rotation Count";
}

export function measurementUnitLabel(unit: MeasurementUnit): string {
  return unit === "seconds" ? "seconds" : "rotations";
}

/**
 * Reuses the existing `TimingProviderType` vocabulary. Each label names the
 * source only — it makes no claim about availability, and carries no
 * development or release framing, since this text is read by athletes. Which
 * sources an Exercise actually offers is a content decision (a Stage A
 * protocol lists `"manual"` only).
 */
export function measurementSourceLabel(source: TimingProviderType): string {
  switch (source) {
    case "manual":
      return "Manual entry";
    case "simulator":
      return "Timing Simulator";
    case "external":
      return "External timing system";
  }
}

// ---------------------------------------------------------------------------
// Shared UI copy
// ---------------------------------------------------------------------------

export const EXERCISE_LIBRARY_HEADING = "Exercises";

export const EXERCISE_LIBRARY_DESCRIPTION =
  "Standard exercises with setup, instructions and what to look for.";

export const EXERCISE_LIBRARY_EMPTY_STATE_TITLE = "No exercises match these filters";

export const EXERCISE_LIBRARY_EMPTY_STATE_BODY =
  "Change a filter or clear the search text to see the standard exercises again.";

export const EXERCISE_LIBRARY_RESET_FILTERS_LABEL = "Reset filters";

/** Prefix for the collapsed advanced-filter summary (DESIGN_SYSTEM.md §23.2). */
export function activeFilterCountLabel(count: number): string {
  return count === 1 ? "1 active filter" : `${count} active filters`;
}

export const EXERCISE_DETAIL_BACK_LABEL = "Back to Exercises";

export const RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE = "Diagram not available on this device";

export const RESTRICTED_DIAGRAM_UNAVAILABLE_BODY =
  "This exercise's diagram comes from a restricted source and can only be shown where its delivery has been authorised. The written setup and instructions below describe the same exercise in full.";

export const DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE =
  "Part of this diagram cannot be drawn here. The written setup and instructions describe the exercise in full.";

/**
 * The Library's own progressive-disclosure explanation, rendered through the
 * existing shared `InfoButton` (see `src/components/InfoButton.tsx`). Uses
 * `helpContent.ts`'s `FeatureExplanation` shape rather than a second Info
 * mechanism; the text lives here because it is Exercise Library content, not a
 * Training Category concept.
 */
export function exerciseLibraryExplanation(): FeatureExplanation {
  return {
    id: "exercise-library",
    title: "Exercises",
    shortDescription:
      "A set of standard curling exercises, each with its setup, instructions and what to look for.",
    purpose: "What should I practise today, and how is it done properly?",
    howItWorks: [
      "Every exercise states one primary focus: Technique, Shotmaking or Measured.",
      "Search or filter to narrow the list, then open an exercise for its full setup and instructions.",
      "Each exercise carries its own version, plus the source it was adapted from and that source's version.",
    ],
    usefulFor: [
      "Finding a deliberate exercise instead of repeating the same session",
      "Reading the exact setup before going on the ice",
      "Seeing what to observe, and what the app does not judge",
    ],
    limitations: [
      "Solo Technique and Shotmaking exercises can be recorded here. Team execution and role rotation are not available yet.",
      "Measured Release Time uses the existing Fixed, Variable and Blind Weight training flow rather than a separate recorder.",
      "A Technique exercise is never scored by the app, and there is no platform-standardised scoring rubric for any exercise.",
    ],
  };
}
