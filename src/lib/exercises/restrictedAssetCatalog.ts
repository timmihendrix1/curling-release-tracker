/** Stable content identities for the three cleared Swiss Curling diagrams. */
export const SWISS_CURLING_GUARD_10_ASSET_ID =
  "swiss-curling-guard-exercise-10-v2";
export const SWISS_CURLING_DRAW_6_ASSET_ID =
  "swiss-curling-draw-exercise-6-v2";
export const SWISS_CURLING_SOFTSHOT_5_ASSET_ID =
  "swiss-curling-softshot-exercise-5-v2";

export const PUBLIC_EXERCISE_ASSET_IDS = [
  SWISS_CURLING_GUARD_10_ASSET_ID,
  SWISS_CURLING_DRAW_6_ASSET_ID,
  SWISS_CURLING_SOFTSHOT_5_ASSET_ID,
] as const;

export type PublicExerciseAssetId =
  (typeof PUBLIC_EXERCISE_ASSET_IDS)[number];

/** Legacy aliases retained for the historical restricted-delivery boundary. */
export const CLOSED_BETA_EXERCISE_ASSET_IDS = PUBLIC_EXERCISE_ASSET_IDS;
export type ClosedBetaExerciseAssetId = PublicExerciseAssetId;

/**
 * Public, versioned delivery locations for the Swiss Curling diagrams. The
 * product owner has cleared these three images for every signed-in athlete, so
 * their browser locations are intentionally no longer opaque. The asset ids
 * remain versioned and stable because Exercise Versions and the offline cache
 * use them as immutable content identities.
 */
export const PUBLIC_EXERCISE_DIAGRAM_PATHS: Readonly<
  Record<PublicExerciseAssetId, string>
> = {
  [SWISS_CURLING_GUARD_10_ASSET_ID]:
    "/exercise-diagrams/swiss-curling-guard-exercise-10-v2.png",
  [SWISS_CURLING_DRAW_6_ASSET_ID]:
    "/exercise-diagrams/swiss-curling-draw-exercise-6-v2.png",
  [SWISS_CURLING_SOFTSHOT_5_ASSET_ID]:
    "/exercise-diagrams/swiss-curling-softshot-exercise-5-v2.png",
};

export function isPublicExerciseAssetId(
  value: unknown
): value is PublicExerciseAssetId {
  return (
    typeof value === "string" &&
    (PUBLIC_EXERCISE_ASSET_IDS as readonly string[]).includes(value)
  );
}

export const isClosedBetaExerciseAssetId = isPublicExerciseAssetId;
