// The production Exercise catalog: a versioned curated content package
// compiled with the application (spec 5.5). Not persisted, not fetched, and
// deliberately not expressed as conditional UI logic for named Exercises.
import {
  buildCuratedExercises,
  buildCuratedExerciseVersions,
} from "./content";
import { CURATED_MEASUREMENT_PROTOCOLS } from "./measurementProtocols";
import {
  EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION,
  type ExerciseCatalogPackage,
} from "./types";
import { validateExerciseCatalogPackage } from "./validation";

/**
 * Recursively freezes a plain data structure. Same local helper as
 * `src/lib/assessment/templates.ts` — each curated-content domain keeps its
 * own copy rather than introducing a shared utility module for ten lines.
 * Runtime immutability, not merely a `readonly` type: nothing downstream may
 * mutate curated content, so an accidental in-place edit throws in strict mode
 * instead of silently rewriting what every consumer reads.
 */
function deepFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

/** Exported unfrozen purely so tests can verify the builders are deterministic across independent calls. */
export function buildExerciseCatalogPackage(): ExerciseCatalogPackage {
  return {
    packageSchemaVersion: EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION,
    contentLanguage: "en",
    exercises: buildCuratedExercises(),
    versions: buildCuratedExerciseVersions(),
    measurementProtocols: CURATED_MEASUREMENT_PROTOCOLS.map((protocol) => ({ ...protocol })),
  };
}

/**
 * Fails fast with one actionable message listing every problem. Invalid
 * curated content must never reach a renderer: a mistyped literal in
 * `content.ts` or `diagrams.ts` is a programmer error, so it throws rather
 * than degrading into a half-rendered Exercise.
 */
export function assertValidExerciseCatalogPackage(pkg: ExerciseCatalogPackage): void {
  const validation = validateExerciseCatalogPackage(pkg);
  if (!validation.valid) {
    throw new Error(
      `Exercise catalog package is invalid and must not be rendered: ${validation.issues
        .map((issue) => `[${issue.code}] ${issue.message}`)
        .join(" ")}`
    );
  }
}

export const EXERCISE_CATALOG: ExerciseCatalogPackage = deepFreeze(
  buildExerciseCatalogPackage()
);

// Validated once, at module import time — not on every render, and not left to
// a test run. The same discipline as `src/lib/assessment/templates.ts`'s
// import-time template assertion.
assertValidExerciseCatalogPackage(EXERCISE_CATALOG);
