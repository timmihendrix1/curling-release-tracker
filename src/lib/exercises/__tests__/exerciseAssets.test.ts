// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { StorageAdapter } from "../../persistence/types";
import {
  createPublicExerciseAssetResolver,
  preloadPublicExerciseDiagrams,
  resolveExerciseAssetAccess,
} from "../exerciseAssets";
import type { ExerciseAssetResolver } from "../exerciseAssets";
import {
  PUBLIC_EXERCISE_ASSET_IDS,
  SWISS_CURLING_GUARD_10_ASSET_ID,
} from "../restrictedAssetCatalog";
import type { ExerciseAssetDistribution } from "../types";

const PUBLIC_DISTRIBUTION: ExerciseAssetDistribution = {
  scope: "public",
  permittedAudience: "All application users.",
  publicDeliveryPermitted: true,
};

function memoryAdapter(): StorageAdapter & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    async get(key) {
      return { status: "value", value: values.get(key) ?? null };
    },
    async set(key, value) {
      values.set(key, value);
      return { ok: true };
    },
  };
}

function pngResponse(): Response {
  return new Response(new Blob([new Uint8Array([137, 80, 78, 71])], {
    type: "image/png",
  }), {
    status: 200,
    headers: { "content-type": "image/png" },
  });
}

describe("public Exercise diagram delivery", () => {
  it("downloads once, stores a PNG data URL, and resolves it while offline after reload", async () => {
    const adapter = memoryAdapter();
    const onlineFetch = vi.fn(async () => pngResponse());
    const online = createPublicExerciseAssetResolver({
      adapter,
      fetchImpl: onlineFetch as typeof fetch,
    });
    const reference = { assetId: SWISS_CURLING_GUARD_10_ASSET_ID };

    const first = await resolveExerciseAssetAccess(reference, PUBLIC_DISTRIBUTION, online);
    expect(first).toMatchObject({ available: true });
    if (!first.available) throw new Error("Expected online diagram resolution");
    expect(first.src).toMatch(/^data:image\/png;base64,/);
    expect(onlineFetch).toHaveBeenCalledTimes(1);
    expect([...adapter.values.values()]).toEqual([first.src]);

    const offlineFetch = vi.fn(async () => { throw new TypeError("offline"); });
    const afterReload = createPublicExerciseAssetResolver({
      adapter,
      fetchImpl: offlineFetch as typeof fetch,
    });
    await expect(
      resolveExerciseAssetAccess(reference, PUBLIC_DISTRIBUTION, afterReload)
    ).resolves.toEqual(first);
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it("preloads all cleared diagrams so an athlete need not open each Exercise online", async () => {
    const resolveExerciseAsset = vi.fn<ExerciseAssetResolver["resolveExerciseAsset"]>(
      () => ({ src: "data:image/png;base64,AA==" })
    );
    const resolver: ExerciseAssetResolver = { resolveExerciseAsset };
    await preloadPublicExerciseDiagrams(resolver);

    expect(resolveExerciseAsset).toHaveBeenCalledTimes(
      PUBLIC_EXERCISE_ASSET_IDS.length
    );
    expect(resolveExerciseAsset.mock.calls.map(([reference]) => reference.assetId))
      .toEqual(PUBLIC_EXERCISE_ASSET_IDS);
  });

  it("rejects unknown assets and non-PNG responses without caching them", async () => {
    const adapter = memoryAdapter();
    const fetchImpl = vi.fn(async () => new Response("not an image", {
      status: 200,
      headers: { "content-type": "text/plain" },
    }));
    const resolver = createPublicExerciseAssetResolver({
      adapter,
      fetchImpl: fetchImpl as typeof fetch,
    });

    await expect(
      resolver.resolveExerciseAsset({ assetId: "unknown-exercise-asset" }, PUBLIC_DISTRIBUTION)
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      resolver.resolveExerciseAsset(
        { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
        PUBLIC_DISTRIBUTION
      )
    ).resolves.toBeNull();
    expect(adapter.values.size).toBe(0);
  });

  it("fails closed for an invalid public distribution before consulting the resolver", async () => {
    const resolver = { resolveExerciseAsset: vi.fn(() => ({ src: "data:image/png;base64,AA==" })) };
    const invalid = {
      scope: "public",
      permittedAudience: "All application users.",
      publicDeliveryPermitted: false,
    } as unknown as ExerciseAssetDistribution;

    await expect(
      resolveExerciseAssetAccess(
        { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
        invalid,
        resolver
      )
    ).resolves.toEqual({ available: false });
    expect(resolver.resolveExerciseAsset).not.toHaveBeenCalled();
  });
});
