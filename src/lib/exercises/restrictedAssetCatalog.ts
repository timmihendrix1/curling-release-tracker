/**
 * Stable content identities for the complete Swiss Curling exercise collection.
 *
 * Published asset bytes are immutable. When a diagram is corrected the new image is
 * published under the **next** version of that exercise's asset id, so a browser holding
 * the previous image in its offline cache can never present it as the corrected one.
 * Superseded ids stay registered — a historical Exercise Version snapshot must remain
 * resolvable forever. Preload warms only the current ids additively and preserves
 * historical cached entries so saved Exercise Versions remain available offline.
 *
 * Exercise Versions and the offline cache refer to these immutable ids, never to a page
 * number or a path assembled from user input.
 */
type SwissCurlingFamily = "guard" | "draw" | "softshot";
export type PublicExerciseAssetId =
  `swiss-curling-${SwissCurlingFamily}-exercise-${number}-v${number}`;

type SwissCurlingAssetDefinition = {
  assetId: PublicExerciseAssetId;
  path: string;
};

/**
 * Every published asset version per source exercise, oldest first; the last entry is
 * the one an Exercise Version published today references.
 *
 * Guard 10, Draw 6 and Softshot 5 shipped first, at v2, and never had a v1 asset. The
 * 2026-09-10 diagram correction removed the embedded German text at the source and
 * therefore republished every diagram that carried one; the diagrams whose only text is
 * a language-neutral sequence numeral were left exactly as published.
 */
const PUBLISHED_ASSET_VERSIONS: Readonly<
  Record<SwissCurlingFamily, readonly (readonly number[])[]>
> = {
  guard: [
    [1, 2], [1, 2], [1, 2], [1, 2], [1, 2], [1, 2],
    [1], [1], [1],
    [2, 3],
    [1, 2],
  ],
  draw: [
    [1, 2], [1, 2], [1, 2], [1, 2], [1, 2],
    [2],
    [1],
    [1, 2], [1, 2], [1, 2], [1, 2], [1, 2],
  ],
  softshot: [
    [1, 2], [1, 2], [1, 2], [1, 2],
    [2, 3],
    [1, 2], [1, 2], [1, 2], [1, 2], [1, 2], [1, 2], [1, 2],
    [1], [1],
  ],
};

function assetIdFor(
  family: SwissCurlingFamily,
  exerciseNumber: number,
  version: number
): PublicExerciseAssetId {
  return `swiss-curling-${family}-exercise-${exerciseNumber}-v${version}` as PublicExerciseAssetId;
}

function definition(
  family: SwissCurlingFamily,
  exerciseNumber: number,
  version: number
): SwissCurlingAssetDefinition {
  const assetId = assetIdFor(family, exerciseNumber, version);
  return { assetId, path: `/exercise-diagrams/${assetId}.png` };
}

const FAMILIES = ["guard", "draw", "softshot"] as const;

function publishedVersions(
  family: SwissCurlingFamily,
  exerciseNumber: number
): readonly number[] | undefined {
  return PUBLISHED_ASSET_VERSIONS[family][exerciseNumber - 1];
}

const CURRENT_DEFINITIONS: readonly SwissCurlingAssetDefinition[] = FAMILIES.flatMap(
  (family) =>
    PUBLISHED_ASSET_VERSIONS[family].map((versions, index) =>
      definition(family, index + 1, versions[versions.length - 1])
    )
);

/** Every earlier published id, still resolvable for historical Exercise Version snapshots. */
const SUPERSEDED_DEFINITIONS: readonly SwissCurlingAssetDefinition[] = FAMILIES.flatMap(
  (family) =>
    PUBLISHED_ASSET_VERSIONS[family].flatMap((versions, index) =>
      versions.slice(0, -1).map((version) => definition(family, index + 1, version))
    )
);

export const PUBLIC_EXERCISE_ASSET_DEFINITIONS: readonly SwissCurlingAssetDefinition[] = [
  ...CURRENT_DEFINITIONS,
  ...SUPERSEDED_DEFINITIONS,
];

/** Every registered id, current and historical. Membership is the delivery allowlist. */
export const PUBLIC_EXERCISE_ASSET_IDS: readonly PublicExerciseAssetId[] =
  PUBLIC_EXERCISE_ASSET_DEFINITIONS.map(({ assetId }) => assetId);

/** The ids the application preloads for offline use — one per source exercise. */
export const CURRENT_PUBLIC_EXERCISE_ASSET_IDS: readonly PublicExerciseAssetId[] =
  CURRENT_DEFINITIONS.map(({ assetId }) => assetId);

/**
 * Ids a previous release preloaded. They remain fetchable, but their cached bytes are
 * released so a corrected diagram does not have to share the local budget with the
 * image it replaced.
 */
export const SUPERSEDED_PUBLIC_EXERCISE_ASSET_IDS: readonly PublicExerciseAssetId[] =
  SUPERSEDED_DEFINITIONS.map(({ assetId }) => assetId);

/** Legacy aliases retained for the historical restricted-delivery boundary (ADR-0023). */
export const SWISS_CURLING_GUARD_10_ASSET_ID = "swiss-curling-guard-exercise-10-v2";
export const SWISS_CURLING_DRAW_6_ASSET_ID = "swiss-curling-draw-exercise-6-v2";
export const SWISS_CURLING_SOFTSHOT_5_ASSET_ID = "swiss-curling-softshot-exercise-5-v2";

export const CLOSED_BETA_EXERCISE_ASSET_IDS = [
  SWISS_CURLING_GUARD_10_ASSET_ID,
  SWISS_CURLING_DRAW_6_ASSET_ID,
  SWISS_CURLING_SOFTSHOT_5_ASSET_ID,
] as const;
export type ClosedBetaExerciseAssetId =
  (typeof CLOSED_BETA_EXERCISE_ASSET_IDS)[number];

/** Public, versioned delivery locations for every registered diagram revision. */
export const PUBLIC_EXERCISE_DIAGRAM_PATHS: Readonly<
  Record<PublicExerciseAssetId, string>
> = Object.fromEntries(
  PUBLIC_EXERCISE_ASSET_DEFINITIONS.map(({ assetId, path }) => [assetId, path])
) as Record<PublicExerciseAssetId, string>;

/** The id an Exercise Version published today references for one source exercise. */
export function swissCurlingExerciseAssetId(
  family: SwissCurlingFamily,
  exerciseNumber: number
): PublicExerciseAssetId {
  const versions = publishedVersions(family, exerciseNumber);
  if (!versions || versions.length === 0) {
    throw new Error(
      `No public Swiss Curling diagram is registered for ${family} exercise ${exerciseNumber}.`
    );
  }
  return assetIdFor(family, exerciseNumber, versions[versions.length - 1]);
}

/** An earlier published id, as referenced by a historical Exercise Version. */
export function swissCurlingExerciseAssetIdAtVersion(
  family: SwissCurlingFamily,
  exerciseNumber: number,
  version: number
): PublicExerciseAssetId {
  if (!publishedVersions(family, exerciseNumber)?.includes(version)) {
    throw new Error(
      `Swiss Curling ${family} exercise ${exerciseNumber} has no registered diagram version ${version}.`
    );
  }
  return assetIdFor(family, exerciseNumber, version);
}

export function isPublicExerciseAssetId(
  value: unknown
): value is PublicExerciseAssetId {
  return (
    typeof value === "string" &&
    (PUBLIC_EXERCISE_ASSET_IDS as readonly string[]).includes(value)
  );
}

export function isClosedBetaExerciseAssetId(
  value: unknown
): value is ClosedBetaExerciseAssetId {
  return (
    typeof value === "string" &&
    (CLOSED_BETA_EXERCISE_ASSET_IDS as readonly string[]).includes(value)
  );
}
