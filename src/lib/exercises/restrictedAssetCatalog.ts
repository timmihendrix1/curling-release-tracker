/**
 * Stable content identities for the complete Swiss Curling exercise collection.
 *
 * The three diagrams that shipped first keep their existing `-v2` identities.
 * Every newly published diagram starts at `-v1`. Exercise Versions and the
 * offline cache refer to these immutable ids, never to a page number or a path
 * assembled from user input.
 */
export const SWISS_CURLING_GUARD_10_ASSET_ID =
  "swiss-curling-guard-exercise-10-v2";
export const SWISS_CURLING_DRAW_6_ASSET_ID =
  "swiss-curling-draw-exercise-6-v2";
export const SWISS_CURLING_SOFTSHOT_5_ASSET_ID =
  "swiss-curling-softshot-exercise-5-v2";

type SwissCurlingFamily = "guard" | "draw" | "softshot";
export type PublicExerciseAssetId =
  `swiss-curling-${SwissCurlingFamily}-exercise-${number}-v${number}`;

type SwissCurlingAssetDefinition = {
  assetId: PublicExerciseAssetId;
  path: string;
};

function exerciseAsset(
  family: SwissCurlingFamily,
  exerciseNumber: number,
  version = 1
): SwissCurlingAssetDefinition {
  const assetId = `swiss-curling-${family}-exercise-${exerciseNumber}-v${version}`;
  return {
    assetId: assetId as PublicExerciseAssetId,
    path: `/exercise-diagrams/${assetId}.png`,
  };
}

const GUARD_ASSETS = Array.from({ length: 11 }, (_, index) => {
  const exerciseNumber = index + 1;
  return exerciseAsset("guard", exerciseNumber, exerciseNumber === 10 ? 2 : 1);
});

const DRAW_ASSETS = Array.from({ length: 12 }, (_, index) => {
  const exerciseNumber = index + 1;
  return exerciseAsset("draw", exerciseNumber, exerciseNumber === 6 ? 2 : 1);
});

const SOFTSHOT_ASSETS = Array.from({ length: 14 }, (_, index) => {
  const exerciseNumber = index + 1;
  return exerciseAsset("softshot", exerciseNumber, exerciseNumber === 5 ? 2 : 1);
});

export const PUBLIC_EXERCISE_ASSET_DEFINITIONS = [
  ...GUARD_ASSETS,
  ...DRAW_ASSETS,
  ...SOFTSHOT_ASSETS,
] as const;

export const PUBLIC_EXERCISE_ASSET_IDS: readonly PublicExerciseAssetId[] =
  PUBLIC_EXERCISE_ASSET_DEFINITIONS.map(({ assetId }) => assetId);

/** Legacy aliases retained for the historical restricted-delivery boundary. */
export const CLOSED_BETA_EXERCISE_ASSET_IDS = [
  SWISS_CURLING_GUARD_10_ASSET_ID,
  SWISS_CURLING_DRAW_6_ASSET_ID,
  SWISS_CURLING_SOFTSHOT_5_ASSET_ID,
] as const;
export type ClosedBetaExerciseAssetId =
  (typeof CLOSED_BETA_EXERCISE_ASSET_IDS)[number];

/** Public, versioned delivery locations for all 37 approved source diagrams. */
export const PUBLIC_EXERCISE_DIAGRAM_PATHS: Readonly<
  Record<PublicExerciseAssetId, string>
> = Object.fromEntries(
  PUBLIC_EXERCISE_ASSET_DEFINITIONS.map(({ assetId, path }) => [assetId, path])
) as Record<PublicExerciseAssetId, string>;

export function swissCurlingExerciseAssetId(
  family: SwissCurlingFamily,
  exerciseNumber: number
): PublicExerciseAssetId {
  const definition = PUBLIC_EXERCISE_ASSET_DEFINITIONS.find(({ assetId }) =>
    assetId.startsWith(`swiss-curling-${family}-exercise-${exerciseNumber}-`)
  );
  if (!definition) {
    throw new Error(
      `No public Swiss Curling diagram is registered for ${family} exercise ${exerciseNumber}.`
    );
  }
  return definition.assetId;
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
