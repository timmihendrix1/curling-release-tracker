// What the athlete sees when browsing for an Exercise, as opposed to how that Exercise
// is executed.
//
// `ExercisePrimaryFocus` is execution semantics: it decides which runner an Exercise
// uses, which attempts and completion rules apply, and how a recorded result is
// validated. Those meanings are snapshotted into results, plans and cloud records and
// must never be re-labelled retrospectively.
//
// Discovery is a separate, purely presentational question: which of the Library's
// categories an Exercise appears under. The product now has two — Technique and
// Shotmaking — with Release Time and Rotation Count sitting under Technique. That is a
// projection over the existing immutable focus, not a rename of it: a snapshot recorded
// as `measured` stays `measured` everywhere it matters, and simply displays under
// Technique.
import type { ExerciseCatalogPackage, ExerciseVersion } from "./types";
import { listCurrentExerciseVersions } from "./lookup";

export type ExerciseDiscoveryCategory = "technique" | "shotmaking";

/** Fixed presentation order for the Library, the filters and the plan picker. */
export const EXERCISE_DISCOVERY_CATEGORIES: readonly ExerciseDiscoveryCategory[] = [
  "technique",
  "shotmaking",
];

/**
 * Shotmaking Exercises are the ones judged against a shot's intended outcome. Everything
 * else — a movement or delivery cue, or a measurable property such as Release Time or
 * Rotation Count — is discovered under Technique.
 */
export function exerciseDiscoveryCategory(
  version: ExerciseVersion
): ExerciseDiscoveryCategory {
  return version.primaryFocus === "shotmaking" ? "shotmaking" : "technique";
}

/**
 * Exercises withdrawn from the active Library and from new Training Plan steps.
 *
 * Draw Split Time and Draw Split-Time Ladder are variations of how a draw is practised
 * against a target split time, not separate Library Exercises. Their identities,
 * versions, diagram assets and any snapshot that already references them stay fully
 * supported: an existing plan step still runs, a recorded result still reads back, and a
 * restored cloud record still validates. They are only absent from new selection.
 */
export const RETIRED_DISCOVERY_EXERCISE_IDS: readonly string[] = [
  "draw-split-time",
  "draw-split-time-ladder",
];

export function isRetiredFromDiscovery(exerciseId: string): boolean {
  return RETIRED_DISCOVERY_EXERCISE_IDS.includes(exerciseId);
}

/**
 * The Exercises a new choice can be made from: one current version per Exercise, minus
 * the retired identities. The only entry point for the Library and for adding or
 * changing a Training Plan step — resolving a *stored* version id still goes through
 * `findExerciseVersion`, which knows nothing about discovery.
 */
export function listDiscoverableExerciseVersions(
  pkg: ExerciseCatalogPackage
): ExerciseVersion[] {
  return listCurrentExerciseVersions(pkg).filter(
    (version) => !isRetiredFromDiscovery(version.exerciseId)
  );
}
