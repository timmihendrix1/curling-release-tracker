// Generic Library discovery: text search plus the essential Version 1 filters
// (spec 14.2). Deliberately excludes recommendations, ratings, popularity,
// personalised ranking, favourites and recent items — all deferred.
//
// Results always keep the catalog's own order. There is no relevance score and
// no per-Exercise special case anywhere in this file.
import {
  UNRATED_DIFFICULTY_LABEL,
  exerciseDifficultyLabel,
  exerciseFocusLabel,
  exerciseParticipationModeLabel,
  exerciseShotFamilyLabel,
  exerciseSweepingPolicyLabel,
  exerciseTrainingPurposeLabel,
} from "./presentation";
import type {
  ExerciseDifficulty,
  ExerciseParticipationMode,
  ExercisePrimaryFocus,
  ExerciseShotFamily,
  ExerciseSweepingPolicy,
  ExerciseVersion,
} from "./types";

export type ExerciseDifficultyFilter =
  | { kind: "any" }
  | { kind: "unrated" }
  | { kind: "level"; level: number };

export type ExerciseLibraryFilters = {
  searchTerm: string;
  focus: ExercisePrimaryFocus | "any";
  shotFamily: ExerciseShotFamily | "any";
  participationMode: ExerciseParticipationMode | "any";
  sweeping: ExerciseSweepingPolicy | "any";
  difficulty: ExerciseDifficultyFilter;
};

export const DEFAULT_EXERCISE_LIBRARY_FILTERS: ExerciseLibraryFilters = {
  searchTerm: "",
  focus: "any",
  shotFamily: "any",
  participationMode: "any",
  sweeping: "any",
  difficulty: { kind: "any" },
};

/**
 * One active advanced filter, in the same order the filter controls appear.
 * `searchTerm` is deliberately excluded: the search field stays visible when
 * the advanced panel collapses, so repeating it would be noise.
 */
export type ActiveExerciseFilterDescription = {
  id: "focus" | "difficulty" | "participationMode" | "sweeping" | "shotFamily";
  label: string;
  value: string;
};

/**
 * What the athlete has narrowed the Library to, phrased for the collapsed
 * advanced-filter summary (DESIGN_SYSTEM.md §23.2 — "the active selection
 * should remain understandable after advanced filters collapse").
 */
export function describeActiveExerciseLibraryFilters(
  filters: ExerciseLibraryFilters
): ActiveExerciseFilterDescription[] {
  const active: ActiveExerciseFilterDescription[] = [];

  if (filters.focus !== "any") {
    active.push({ id: "focus", label: "Focus", value: exerciseFocusLabel(filters.focus) });
  }
  if (filters.difficulty.kind !== "any") {
    active.push({
      id: "difficulty",
      label: "Difficulty",
      value:
        filters.difficulty.kind === "unrated"
          ? UNRATED_DIFFICULTY_LABEL
          : exerciseDifficultyLabel({ kind: "level", level: filters.difficulty.level }),
    });
  }
  if (filters.participationMode !== "any") {
    active.push({
      id: "participationMode",
      label: "Solo or Team",
      value: exerciseParticipationModeLabel(filters.participationMode),
    });
  }
  if (filters.sweeping !== "any") {
    active.push({
      id: "sweeping",
      label: "Sweepers",
      value: exerciseSweepingPolicyLabel(filters.sweeping),
    });
  }
  if (filters.shotFamily !== "any") {
    active.push({
      id: "shotFamily",
      label: "Shot Family",
      value: exerciseShotFamilyLabel(filters.shotFamily),
    });
  }

  return active;
}

export function areDefaultExerciseLibraryFilters(filters: ExerciseLibraryFilters): boolean {
  return (
    filters.searchTerm.trim().length === 0 &&
    filters.focus === "any" &&
    filters.shotFamily === "any" &&
    filters.participationMode === "any" &&
    filters.sweeping === "any" &&
    filters.difficulty.kind === "any"
  );
}

/**
 * Lower-cases and strips combining diacritics, so a German source alias
 * retained purely as search metadata (e.g. "Guard Übung 10") is still
 * reachable by typing "ubung" — while every *displayed* string stays English.
 */
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Everything one Exercise Version can be found by. Includes the non-displayed
 * source titles and aliases: matching one of those still renders only the
 * English content, because search never contributes to what is shown.
 */
export function exerciseSearchableText(version: ExerciseVersion): string {
  const parts: string[] = [
    version.title,
    version.goal,
    version.whyItMatters,
    exerciseFocusLabel(version.primaryFocus),
    exerciseTrainingPurposeLabel(version.primaryTrainingPurpose),
    exerciseSweepingPolicyLabel(version.sweeping.policy),
    version.participation.summary,
  ];

  if (version.shotFamily) parts.push(exerciseShotFamilyLabel(version.shotFamily));

  for (const purpose of version.additionalTrainingPurposes) {
    parts.push(exerciseTrainingPurposeLabel(purpose));
  }
  for (const mode of version.participation.supportedModes) {
    parts.push(exerciseParticipationModeLabel(mode));
  }
  for (const step of version.setupInstructions) parts.push(step.text);
  for (const step of version.executionInstructions) parts.push(step.text);
  for (const variation of version.variations) {
    parts.push(variation.label);
    if (variation.description) parts.push(variation.description);
  }

  parts.push(version.source.attribution);
  if (version.source.organization) parts.push(version.source.organization);
  if (version.source.collectionName) parts.push(version.source.collectionName);
  if (version.source.sourceExerciseReference) {
    parts.push(version.source.sourceExerciseReference);
  }

  const metadata = version.source.nonDisplayedSourceMetadata;
  if (metadata) {
    parts.push(...metadata.originalTitles, ...metadata.searchAliases);
  }

  return normalizeForSearch(parts.join(" "));
}

/** Every whitespace-separated term must match (AND), so narrowing a search actually narrows it. */
export function matchesExerciseSearchTerm(version: ExerciseVersion, searchTerm: string): boolean {
  const terms = normalizeForSearch(searchTerm).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;

  const haystack = exerciseSearchableText(version);
  return terms.every((term) => haystack.includes(term));
}

function difficultyIncludesLevel(
  difficulty: ExerciseDifficulty | undefined,
  level: number
): boolean {
  if (!difficulty) return false;
  return difficulty.kind === "level"
    ? difficulty.level === level
    : level >= difficulty.min && level <= difficulty.max;
}

export function matchesExerciseDifficultyFilter(
  version: ExerciseVersion,
  filter: ExerciseDifficultyFilter
): boolean {
  switch (filter.kind) {
    case "any":
      return true;
    case "unrated":
      return version.difficulty === undefined;
    case "level":
      return difficultyIncludesLevel(version.difficulty, filter.level);
  }
}

export function filterExerciseVersions(
  versions: readonly ExerciseVersion[],
  filters: ExerciseLibraryFilters
): ExerciseVersion[] {
  return versions.filter((version) => {
    if (filters.focus !== "any" && version.primaryFocus !== filters.focus) return false;
    if (filters.shotFamily !== "any" && version.shotFamily !== filters.shotFamily) return false;
    if (
      filters.participationMode !== "any" &&
      !version.participation.supportedModes.includes(filters.participationMode)
    ) {
      return false;
    }
    if (filters.sweeping !== "any" && version.sweeping.policy !== filters.sweeping) return false;
    if (!matchesExerciseDifficultyFilter(version, filters.difficulty)) return false;
    return matchesExerciseSearchTerm(version, filters.searchTerm);
  });
}

// ---------------------------------------------------------------------------
// Available filter options, derived from the catalog rather than hard-coded —
// a filter is never offered for a value no Exercise actually has.
// ---------------------------------------------------------------------------

export function availableExerciseFocuses(
  versions: readonly ExerciseVersion[]
): ExercisePrimaryFocus[] {
  const seen: ExercisePrimaryFocus[] = [];
  for (const version of versions) {
    if (!seen.includes(version.primaryFocus)) seen.push(version.primaryFocus);
  }
  return seen;
}

export function availableExerciseShotFamilies(
  versions: readonly ExerciseVersion[]
): ExerciseShotFamily[] {
  const seen: ExerciseShotFamily[] = [];
  for (const version of versions) {
    if (version.shotFamily && !seen.includes(version.shotFamily)) seen.push(version.shotFamily);
  }
  return seen;
}

export function availableExerciseParticipationModes(
  versions: readonly ExerciseVersion[]
): ExerciseParticipationMode[] {
  const seen: ExerciseParticipationMode[] = [];
  for (const version of versions) {
    for (const mode of version.participation.supportedModes) {
      if (!seen.includes(mode)) seen.push(mode);
    }
  }
  return seen;
}

export function availableExerciseSweepingPolicies(
  versions: readonly ExerciseVersion[]
): ExerciseSweepingPolicy[] {
  const seen: ExerciseSweepingPolicy[] = [];
  for (const version of versions) {
    if (!seen.includes(version.sweeping.policy)) seen.push(version.sweeping.policy);
  }
  return seen;
}

/**
 * The difficulty options worth offering: every level any Exercise actually
 * carries (ascending), plus "Not rated" when at least one Exercise has no
 * stated difficulty.
 */
export function availableExerciseDifficultyFilters(
  versions: readonly ExerciseVersion[]
): ExerciseDifficultyFilter[] {
  const levels = new Set<number>();
  let hasUnrated = false;

  for (const version of versions) {
    const difficulty = version.difficulty;
    if (!difficulty) {
      hasUnrated = true;
      continue;
    }
    if (difficulty.kind === "level") {
      levels.add(difficulty.level);
      continue;
    }
    for (let level = difficulty.min; level <= difficulty.max; level++) levels.add(level);
  }

  const options: ExerciseDifficultyFilter[] = [...levels]
    .sort((a, b) => a - b)
    .map((level) => ({ kind: "level" as const, level }));

  if (hasUnrated) options.push({ kind: "unrated" });
  return options;
}
