import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type { StorageAdapter } from "../persistence/types";
import {
  PUBLIC_EXERCISE_ASSET_IDS,
  PUBLIC_EXERCISE_DIAGRAM_PATHS,
  isPublicExerciseAssetId,
} from "./restrictedAssetCatalog";
import type {
  ExerciseAssetDistribution,
  RestrictedAssetReference,
} from "./types";

export type ExerciseAssetResolution = { src: string };

export type ExerciseAssetResolver = {
  resolveExerciseAsset(
    reference: RestrictedAssetReference,
    distribution: ExerciseAssetDistribution
  ): ExerciseAssetResolution | null | Promise<ExerciseAssetResolution | null>;
};

export type ExerciseAssetAccess =
  | { available: true; src: string }
  | { available: false };

const CACHE_KEY_PREFIX = "curling-performance-public-exercise-diagram-v1";
const MAX_DIAGRAM_BYTES = 2_000_000;

function cacheKey(assetId: string): string {
  return `${CACHE_KEY_PREFIX}.${assetId}`;
}

function isPngDataUrl(value: unknown): value is string {
  return typeof value === "string" &&
    value.startsWith("data:image/png;base64,") &&
    value.length <= Math.ceil(MAX_DIAGRAM_BYTES * 1.4);
}

async function loadCachedDiagram(
  adapter: StorageAdapter,
  assetId: string
): Promise<string | null> {
  const result = await adapter.get(cacheKey(assetId));
  return result.status === "value" && isPngDataUrl(result.value)
    ? result.value
    : null;
}

async function saveCachedDiagram(
  adapter: StorageAdapter,
  assetId: string,
  src: string
): Promise<void> {
  if (!isPngDataUrl(src)) return;
  await adapter.set(cacheKey(assetId), src);
}

function blobAsDataUrl(blob: Blob): Promise<string | null> {
  if (
    blob.size <= 0 ||
    blob.size > MAX_DIAGRAM_BYTES ||
    blob.type !== "image/png"
  ) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () =>
      resolve(isPngDataUrl(reader.result) ? reader.result : null);
    try {
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

export type PublicExerciseAssetResolverOptions = {
  adapter?: StorageAdapter;
  fetchImpl?: typeof fetch;
};

/**
 * Resolves the complete publicly cleared Swiss Curling diagram corpus cache-first. Each
 * immutable asset id owns one independent local key, so concurrent warm-up
 * writes cannot overwrite one another. A successful first online load makes
 * the diagram available to the same browser while offline; a new diagram
 * revision receives a new asset id and therefore cannot reuse stale bytes.
 */
export function createPublicExerciseAssetResolver(
  options: PublicExerciseAssetResolverOptions = {}
): ExerciseAssetResolver {
  const adapter = options.adapter ?? localStorageAdapter;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async resolveExerciseAsset(reference) {
      try {
        if (!isPublicExerciseAssetId(reference.assetId)) return null;

        const cached = await loadCachedDiagram(adapter, reference.assetId);
        if (cached) return { src: cached };

        const response = await fetchImpl(
          PUBLIC_EXERCISE_DIAGRAM_PATHS[reference.assetId],
          { method: "GET", cache: "force-cache" }
        );
        if (!response.ok || response.headers.get("content-type") !== "image/png") {
          return null;
        }
        const src = await blobAsDataUrl(await response.blob());
        if (!src) return null;
        await saveCachedDiagram(adapter, reference.assetId, src);
        return { src };
      } catch {
        return null;
      }
    },
  };
}

/** Fetches every public diagram once so it is ready before the athlete reaches the ice. */
export async function preloadPublicExerciseDiagrams(
  resolver: ExerciseAssetResolver
): Promise<void> {
  await Promise.allSettled(
    PUBLIC_EXERCISE_ASSET_IDS.map((assetId) =>
      resolver.resolveExerciseAsset(
        { assetId },
        {
          scope: "public",
          permittedAudience: "All application users.",
          publicDeliveryPermitted: true,
        }
      )
    )
  );
}

/** Total fail-closed boundary shared by the generic attributed-image renderer. */
export async function resolveExerciseAssetAccess(
  reference: RestrictedAssetReference,
  distribution: ExerciseAssetDistribution,
  resolver?: ExerciseAssetResolver
): Promise<ExerciseAssetAccess> {
  const validDistribution =
    (distribution.scope === "public" && distribution.publicDeliveryPermitted === true) ||
    (distribution.scope === "restricted-closed-beta" &&
      distribution.publicDeliveryPermitted === false);
  if (!validDistribution || !resolver) return { available: false };

  try {
    const resolution = await resolver.resolveExerciseAsset(reference, distribution);
    if (!resolution) return { available: false };
    const src: unknown = resolution.src;
    return typeof src === "string" && src.trim().length > 0
      ? { available: true, src }
      : { available: false };
  } catch {
    return { available: false };
  }
}
