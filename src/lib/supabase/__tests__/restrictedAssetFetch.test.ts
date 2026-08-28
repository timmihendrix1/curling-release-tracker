// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createAuthorizedRestrictedAssetResolver } from "../authorizedFetch";
import { SWISS_CURLING_GUARD_10_ASSET_ID } from "../../exercises/restrictedAssetCatalog";

const ORIGIN = "https://app.example.test";
const TOKEN = "restricted-diagram-test-token";
const DISTRIBUTION = {
  scope: "restricted-closed-beta" as const,
  permittedAudience: "Test Team only.",
  publicDeliveryPermitted: false as const,
};

function harness(options: {
  session?: unknown;
  response?: Partial<Response>;
  fetchThrows?: boolean;
} = {}) {
  const getSession = vi.fn(async () => ({
    data: {
      session:
        options.session === undefined ? { access_token: TOKEN } : options.session,
    },
    error: null,
  }));
  const defaultResponse = {
    ok: true,
    headers: new Headers({ "content-type": "image/png" }),
    blob: async () => new Blob(["png-bytes"], { type: "image/png" }),
  };
  const fetchImpl = vi.fn(async () => {
    if (options.fetchThrows) throw new Error("transport details must not escape");
    return { ...defaultResponse, ...options.response } as Response;
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { auth: { getSession } } as any;
  return {
    resolver: createAuthorizedRestrictedAssetResolver(client, {
      origin: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
    getSession,
    fetchImpl,
  };
}

describe("createAuthorizedRestrictedAssetResolver", () => {
  it("fetches an allowlisted asset from the exact same-origin route with the bearer token", async () => {
    const { resolver, getSession, fetchImpl } = harness();
    const resolution = await resolver.resolveRestrictedAsset(
      { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
      DISTRIBUTION
    );

    expect(resolution?.src).toMatch(/^data:image\/png;base64,/);
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ORIGIN}/api/exercises/restricted-diagrams/${SWISS_CURLING_GUARD_10_ASSET_ID}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${TOKEN}` },
        cache: "no-store",
      }
    );
    expect(JSON.stringify(resolution)).not.toContain(TOKEN);
  });

  it("rejects an unknown asset before reading the session or fetching", async () => {
    const { resolver, getSession, fetchImpl } = harness();
    expect(
      await resolver.resolveRestrictedAsset(
        { assetId: "../../public/diagram.png" },
        DISTRIBUTION
      )
    ).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a non-restricted distribution before reading the session", async () => {
    const { resolver, getSession, fetchImpl } = harness();
    expect(
      await resolver.resolveRestrictedAsset(
        { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
        { ...DISTRIBUTION, publicDeliveryPermitted: true as unknown as false }
      )
    ).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not fetch without a usable session", async () => {
    for (const session of [null, {}, { access_token: "" }]) {
      const { resolver, fetchImpl } = harness({ session });
      expect(
        await resolver.resolveRestrictedAsset(
          { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
          DISTRIBUTION
        )
      ).toBeNull();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("fails closed for refusal, wrong media type, empty content, and transport failure", async () => {
    const cases = [
      harness({ response: { ok: false } }),
      harness({
        response: { headers: new Headers({ "content-type": "text/html" }) },
      }),
      harness({
        response: { blob: async () => new Blob([], { type: "image/png" }) },
      }),
      harness({ fetchThrows: true }),
    ];

    for (const { resolver } of cases) {
      expect(
        await resolver.resolveRestrictedAsset(
          { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
          DISTRIBUTION
        )
      ).toBeNull();
    }
  });
});
