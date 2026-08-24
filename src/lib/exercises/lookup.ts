// Deterministic, pure lookups over any Exercise catalog package. Kept separate
// from `catalog.ts` so tests can exercise them against fixture packages
// (including deliberately multi-version ones) without touching the production
// catalog.
import type {
  Exercise,
  ExerciseCatalogPackage,
  ExerciseMeasurementProtocolReference,
  ExerciseRequirementLevel,
  ExerciseVersion,
  MeasurementProtocol,
} from "./types";

export function findExercise(
  pkg: ExerciseCatalogPackage,
  exerciseId: string
): Exercise | undefined {
  return pkg.exercises.find((exercise) => exercise.id === exerciseId);
}

/** Lookup by immutable Exercise Version id — the identity historical records would reference. */
export function findExerciseVersion(
  pkg: ExerciseCatalogPackage,
  versionId: string
): ExerciseVersion | undefined {
  return pkg.versions.find((version) => version.id === versionId);
}

/**
 * The currently published version for a stable Exercise id. Returns undefined
 * — never a guess — when the identity is unknown, its named current version is
 * missing, or that version belongs to a different Exercise.
 */
export function resolveCurrentExerciseVersion(
  pkg: ExerciseCatalogPackage,
  exerciseId: string
): ExerciseVersion | undefined {
  const exercise = findExercise(pkg, exerciseId);
  if (!exercise) return undefined;

  const version = findExerciseVersion(pkg, exercise.currentVersionId);
  if (!version || version.exerciseId !== exercise.id) return undefined;

  return version;
}

/** Every version of one Exercise, oldest first. Historical versions stay resolvable forever. */
export function listExerciseVersions(
  pkg: ExerciseCatalogPackage,
  exerciseId: string
): ExerciseVersion[] {
  return pkg.versions
    .filter((version) => version.exerciseId === exerciseId)
    .slice()
    .sort((a, b) => a.version - b.version);
}

/** One current version per Exercise, in the package's own Exercise order. */
export function listCurrentExerciseVersions(pkg: ExerciseCatalogPackage): ExerciseVersion[] {
  const versions: ExerciseVersion[] = [];
  for (const exercise of pkg.exercises) {
    const version = resolveCurrentExerciseVersion(pkg, exercise.id);
    if (version) versions.push(version);
  }
  return versions;
}

export function findMeasurementProtocol(
  pkg: ExerciseCatalogPackage,
  protocolId: string,
  protocolVersion: number
): MeasurementProtocol | undefined {
  return pkg.measurementProtocols.find(
    (protocol) => protocol.id === protocolId && protocol.version === protocolVersion
  );
}

export type ResolvedMeasurementProtocol = {
  protocol: MeasurementProtocol;
  requirement: ExerciseRequirementLevel;
};

/**
 * Resolves an Exercise Version's protocol references, in declaration order. An
 * unresolvable reference is skipped here because catalog validation already
 * rejects it at the boundary — this function never fabricates a placeholder
 * protocol to render in its place.
 */
export function resolveMeasurementProtocols(
  pkg: ExerciseCatalogPackage,
  references: readonly ExerciseMeasurementProtocolReference[]
): ResolvedMeasurementProtocol[] {
  const resolved: ResolvedMeasurementProtocol[] = [];
  for (const reference of references) {
    const protocol = findMeasurementProtocol(
      pkg,
      reference.protocolId,
      reference.protocolVersion
    );
    if (protocol) resolved.push({ protocol, requirement: reference.requirement });
  }
  return resolved;
}
