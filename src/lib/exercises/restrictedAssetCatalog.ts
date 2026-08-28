/**
 * Opaque identities for the three Swiss Curling diagrams approved for the
 * one-Team closed beta. These are content references, never file paths or
 * public URLs. The server route owns the private asset-to-file mapping.
 */
export const SWISS_CURLING_GUARD_10_ASSET_ID =
  "swiss-curling-guard-exercise-10-v2";
export const SWISS_CURLING_DRAW_6_ASSET_ID =
  "swiss-curling-draw-exercise-6-v2";
export const SWISS_CURLING_SOFTSHOT_5_ASSET_ID =
  "swiss-curling-softshot-exercise-5-v2";

export const CLOSED_BETA_EXERCISE_ASSET_IDS = [
  SWISS_CURLING_GUARD_10_ASSET_ID,
  SWISS_CURLING_DRAW_6_ASSET_ID,
  SWISS_CURLING_SOFTSHOT_5_ASSET_ID,
] as const;

export type ClosedBetaExerciseAssetId =
  (typeof CLOSED_BETA_EXERCISE_ASSET_IDS)[number];

export function isClosedBetaExerciseAssetId(
  value: unknown
): value is ClosedBetaExerciseAssetId {
  return (
    typeof value === "string" &&
    (CLOSED_BETA_EXERCISE_ASSET_IDS as readonly string[]).includes(value)
  );
}
