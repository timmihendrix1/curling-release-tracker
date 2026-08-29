import { describe, expect, it, vi } from "vitest";
import {
  resolveRestrictedAssetAccess,
  type RestrictedAssetResolution,
  type RestrictedAssetResolver,
} from "../restrictedAssets";
import type { RestrictedAssetReference, RestrictedDistribution } from "../types";
import { buildTestSourceImageDiagram } from "./testHelpers";

const RESTRICTED_DIAGRAM = buildTestSourceImageDiagram();
const REFERENCE: RestrictedAssetReference =
  RESTRICTED_DIAGRAM.kind === "attributed-source-image"
    ? RESTRICTED_DIAGRAM.assetReference
    : { assetId: "unreachable" };
const DISTRIBUTION: RestrictedDistribution =
  RESTRICTED_DIAGRAM.kind === "attributed-source-image" &&
  RESTRICTED_DIAGRAM.distribution.scope === "restricted-closed-beta"
    ? RESTRICTED_DIAGRAM.distribution
    : {
        scope: "restricted-closed-beta",
        permittedAudience: "Nobody.",
        publicDeliveryPermitted: false,
      };

/** An in-memory, test-only stand-in for a future authorized delivery context. */
function authorizedResolver(src = "blob:test-authorized-asset"): RestrictedAssetResolver {
  return { resolveRestrictedAsset: () => ({ src }) };
}

describe("resolveRestrictedAssetAccess", () => {
  it("fails closed when no resolver is supplied", async () => {
    expect(await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION)).toEqual({
      authorized: false,
      reason: "no-resolver",
    });
  });

  it("fails closed when a resolver declines the reference", async () => {
    expect(
      await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
        resolveRestrictedAsset: () => null,
      })
    ).toEqual({ authorized: false, reason: "not-authorized" });
  });

  it("fails closed when the resolver returns an unusable source", async () => {
    for (const bad of ["", "   ", undefined as unknown as string, 42 as unknown as string]) {
      expect(
        await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
          resolveRestrictedAsset: () => ({ src: bad }),
        })
      ).toEqual({ authorized: false, reason: "invalid-resolution" });
    }
  });

  it("fails closed, without consulting the resolver, when the distribution is not restricted", async () => {
    const resolver = {
      resolveRestrictedAsset: vi.fn(() => ({ src: "blob:should-never-be-used" })),
    };
    expect(
      await resolveRestrictedAssetAccess(
        REFERENCE,
        {
          scope: "restricted-closed-beta",
          permittedAudience: "Everyone.",
          publicDeliveryPermitted: true as unknown as false,
        },
        resolver
      )
    ).toEqual({ authorized: false, reason: "distribution-not-restricted" });
    expect(resolver.resolveRestrictedAsset).not.toHaveBeenCalled();
  });

  it("fails closed when the resolver throws an Error, without exposing it", async () => {
    const thrown = new Error(`boom while fetching /private/${REFERENCE.assetId}.png`);
    const access = await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
      resolveRestrictedAsset: () => {
        throw thrown;
      },
    });

    expect(access).toEqual({ authorized: false, reason: "resolver-error" });
    // Nothing the resolver put in its message may travel with the result.
    const serialized = JSON.stringify(access);
    expect(serialized).not.toContain(REFERENCE.assetId);
    expect(serialized).not.toContain("boom");
    expect(serialized).not.toMatch(/\.png|\/private/);
  });

  it("fails closed when the resolver throws a non-Error value", async () => {
    for (const thrown of [
      "https://cdn.example.com/leak.png",
      42,
      null,
      undefined,
      { assetPath: "/private/leak.png" },
      Symbol("leak"),
    ]) {
      const access = await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
        resolveRestrictedAsset: () => {
          throw thrown;
        },
      });

      expect(access).toEqual({ authorized: false, reason: "resolver-error" });
      expect(JSON.stringify(access)).not.toContain("leak");
    }
  });

  it("fails closed when the returned resolution's src getter throws", async () => {
    // The call succeeded; reading the value is what fails. Inspecting the
    // resolution outside the boundary would still crash the render.
    const access = await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
      resolveRestrictedAsset: () =>
        ({
          get src(): string {
            throw new Error(`getter leak https://cdn.example.com/${REFERENCE.assetId}.png`);
          },
        }) as RestrictedAssetResolution,
    });

    expect(access).toEqual({ authorized: false, reason: "resolver-error" });
    const serialized = JSON.stringify(access);
    expect(serialized).not.toContain(REFERENCE.assetId);
    expect(serialized).not.toContain("getter leak");
  });

  it("fails closed when the resolution is a Proxy whose get trap throws", async () => {
    const access = await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
      resolveRestrictedAsset: () =>
        new Proxy({} as RestrictedAssetResolution, {
          get() {
            throw new TypeError("trap leak /private/guard-10.png");
          },
        }),
    });

    expect(access).toEqual({ authorized: false, reason: "resolver-error" });
    expect(JSON.stringify(access)).not.toContain("trap leak");
  });

  it("reads the resolution's src exactly once, so a getter cannot switch it after validation", async () => {
    let reads = 0;
    const access = await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
      resolveRestrictedAsset: () =>
        ({
          get src(): string {
            reads += 1;
            // A second read would hand the renderer a different value than the
            // one that passed validation.
            return reads === 1 ? "blob:validated" : "https://cdn.example.com/swapped.png";
          },
        }) as RestrictedAssetResolution,
    });

    expect(reads).toBe(1);
    expect(access).toEqual({ authorized: true, src: "blob:validated" });
  });

  it("does not let a throwing resolver escape the boundary", async () => {
    await expect(
      resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
        resolveRestrictedAsset: () => {
          throw new Error("resolver exploded");
        },
      })
    ).resolves.toEqual({ authorized: false, reason: "resolver-error" });
  });

  it("never derives a source from the opaque asset id", async () => {
    const access = await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION);
    expect(JSON.stringify(access)).not.toContain(REFERENCE.assetId);
  });

  it("returns the resolver's own source when authorized, and passes the reference through unchanged", async () => {
    const resolver = {
      resolveRestrictedAsset: vi.fn(() => ({ src: "blob:test-authorized-asset" })),
    };
    expect(await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, resolver)).toEqual({
      authorized: true,
      src: "blob:test-authorized-asset",
    });
    expect(resolver.resolveRestrictedAsset).toHaveBeenCalledWith(REFERENCE, DISTRIBUTION);
  });

  it("accepts an authorized resolver built by the shared test helper", async () => {
    expect(await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, authorizedResolver())).toEqual({
      authorized: true,
      src: "blob:test-authorized-asset",
    });
  });

  it("fails closed when an asynchronous resolver rejects", async () => {
    const access = await resolveRestrictedAssetAccess(REFERENCE, DISTRIBUTION, {
      resolveRestrictedAsset: async () => {
        throw new Error(`rejected https://example.invalid/${REFERENCE.assetId}.png`);
      },
    });
    expect(access).toEqual({ authorized: false, reason: "resolver-error" });
    expect(JSON.stringify(access)).not.toContain(REFERENCE.assetId);
  });
});
