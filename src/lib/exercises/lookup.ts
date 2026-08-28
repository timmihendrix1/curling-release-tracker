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

export type ExerciseRunnerKind =
  | "exercise-execution"
  | "release-timing"
  | "unsupported";

export function resolvedMeasurementRunnerKind(
  resolved: readonly ResolvedMeasurementProtocol[]
): Exclude<ExerciseRunnerKind, "exercise-execution"> | "exercise-execution" {
  if (resolved.length === 0) return "unsupported";
  const releaseTimeCount = resolved.filter(
    ({ protocol }) => protocol.metricType === "release-time"
  ).length;
  if (releaseTimeCount === resolved.length) return "release-timing";
  // The generic Measured UI currently records one declared metric per attempt.
  // Fail closed for multiple non-release protocols until protocol selection or
  // multi-value capture has been designed explicitly.
  if (
    resolved.length === 1 &&
    resolved[0].protocol.metricType === "rotation-count"
  ) return "exercise-execution";
  return "unsupported";
}

/**
 * Chooses an execution boundary from declared Measurement Protocol semantics,
 * never from an Exercise id or title. Release-time-only Measured Exercises use
 * the mature Fixed/Variable/Blind runner. Other currently supported Measured
 * Exercises use the generic Exercise Execution aggregate when they declare
 * the one currently supported standalone metric. A future mixed or multi-
 * protocol definition fails visibly until its interaction has been designed.
 */
export function exerciseRunnerKind(
  pkg: ExerciseCatalogPackage,
  version: ExerciseVersion
): ExerciseRunnerKind {
  if (version.primaryFocus !== "measured") return "exercise-execution";

  return resolvedMeasurementRunnerKind(
    resolveMeasurementProtocols(pkg, version.compatibleMeasurementProtocols)
  );
}
