// @vitest-environment jsdom
//
// The authorized-request boundary on NATIVE (ADR-0047).
//
// `authorizedFetch.test.ts` already covers the Web path exhaustively. This file
// covers what changes when the destination is a configured origin rather than
// the document's own, and it re-proves the ordering properties there rather than
// assuming they survived: a rejected request must still perform ZERO session
// reads and ZERO fetches, and the token must still be read only after the URL is
// proven.
//
// The final describe block goes through the REAL production composition
// (`createSupabaseTeamService` / `createSupabaseRestrictedAssetResolver`) driven
// by the REAL Capacitor platform signal, because "the helper behaves when handed
// a target" says nothing about what production hands it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAuthorizedRestrictedAssetResolver,
  createAuthorizedTeamRequest,
} from "../authorizedFetch";
import type { TeamApiRoute } from "../authorizedTeamRequest";
import type { ApiTargetResolution } from "../../platform/apiTarget";
import type { ConfiguredCloudConfig } from "../config";
import type { RestrictedDistribution } from "../../exercises/types";
import {
  SWISS_CURLING_GUARD_10_ASSET_ID,
  isClosedBetaExerciseAssetId,
} from "../../exercises/restrictedAssetCatalog";

const getSupabaseBrowserClientMock = vi.hoisted(() => vi.fn());

vi.mock("../supabaseClient", () => ({
  getSupabaseBrowserClient: getSupabaseBrowserClientMock,
}));

import {
  createSupabaseRestrictedAssetResolver,
  createSupabaseTeamService,
} from "../teamServiceFactory";

const NATIVE_API_ORIGIN = "https://api.example.test";
const ACCESS_TOKEN = "native-access-token-must-never-leak";

const CLOUD_CONFIG: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://project.supabase.test",
  publishableKey: "sb_publishable_syntheticvalue",
};

type BridgeWindow = Window & {
  androidBridge?: unknown;
  webkit?: { messageHandlers?: { bridge?: unknown } };
};

function clearNativeBridges(): void {
  delete (window as unknown as BridgeWindow).androidBridge;
  delete (window as unknown as BridgeWindow).webkit;
}

function simulateIos(): void {
  clearNativeBridges();
  (window as unknown as BridgeWindow).webkit = { messageHandlers: { bridge: {} } };
}

function simulateAndroid(): void {
  clearNativeBridges();
  (window as unknown as BridgeWindow).androidBridge = {};
}

const nativeTarget: ApiTargetResolution = {
  status: "resolved",
  target: { kind: "native_configured", origin: NATIVE_API_ORIGIN },
};

/** A fetch double typed like the real thing, so recorded calls stay indexable. */
type FetchSpy = ReturnType<
  typeof vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>
>;

type Harness = {
  request: ReturnType<typeof createAuthorizedTeamRequest>;
  getSession: ReturnType<typeof vi.fn>;
  fetchImpl: ReturnType<typeof vi.fn>;
};

function harness(
  options: {
    target?: ApiTargetResolution;
    session?: unknown;
    fetchThrows?: unknown;
    response?: Response;
  } = {}
): Harness {
  const session =
    options.session === undefined ? { access_token: ACCESS_TOKEN } : options.session;
  const getSession = vi.fn(async () => ({ data: { session }, error: null }));
  const fetchImpl = vi.fn(async () => {
    if (options.fetchThrows !== undefined) throw options.fetchThrows;
    return options.response ?? new Response("{}", { status: 200 });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { auth: { getSession } } as any;
  const request = createAuthorizedTeamRequest(client, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    resolveTarget: () => options.target ?? nativeTarget,
  });
  return { request, getSession, fetchImpl };
}

const ALL_ROUTES: Array<[string, TeamApiRoute, string]> = [
  ["createInvitation", { kind: "createInvitation" }, `${NATIVE_API_ORIGIN}/api/team/invitations`],
  [
    "reviseInvitation",
    { kind: "reviseInvitation", invitationId: "inv-1" },
    `${NATIVE_API_ORIGIN}/api/team/invitations/inv-1/revise`,
  ],
  [
    "resendInvitation",
    { kind: "resendInvitation", invitationId: "inv-1" },
    `${NATIVE_API_ORIGIN}/api/team/invitations/inv-1/resend`,
  ],
  [
    "createAdminRequest",
    { kind: "createAdminRequest" },
    `${NATIVE_API_ORIGIN}/api/team/admin-requests`,
  ],
  ["removeMember", { kind: "removeMember" }, `${NATIVE_API_ORIGIN}/api/team/members/remove`],
];

beforeEach(() => {
  clearNativeBridges();
  getSupabaseBrowserClientMock.mockReset();
});

afterEach(() => {
  clearNativeBridges();
  vi.unstubAllEnvs();
});

describe("native authorized Team requests", () => {
  it.each(ALL_ROUTES)("sends %s to the configured origin", async (_label, route, expected) => {
    const { request, fetchImpl } = harness();
    const outcome = await request(route, { a: 1 });

    expect(outcome.kind).toBe("response");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(expected);
  });

  it("omits cookie credentials and refuses to follow redirects", async () => {
    const { request, fetchImpl } = harness();
    await request({ kind: "createInvitation" }, {});

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    // This application authorizes with a bearer header, never a cookie, and no
    // CORS response here permits credentials.
    expect(init.credentials).toBe("omit");
    // A redirect would move the request to a destination that was never
    // validated. There is deliberately no redirect discovery.
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
  });

  it("reports a refused redirect as a network error, not a response", async () => {
    // `redirect: "error"` makes fetch reject. Failing closed is the contract;
    // nothing rewrites the destination and nothing retries.
    const { request, fetchImpl } = harness({
      fetchThrows: new TypeError("Failed to fetch"),
    });
    const outcome = await request({ kind: "createInvitation" }, {});

    expect(outcome).toEqual({ kind: "network_error" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("carries the token in exactly one header and never returns it", async () => {
    const { request, fetchImpl } = harness();
    const outcome = await request({ kind: "createInvitation" }, {});

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(JSON.stringify(outcome)).not.toContain(ACCESS_TOKEN);
  });

  it.each([
    ["an unresolvable target", { status: "unavailable", reason: "unsupported_platform" }],
    [
      "an unconfigured native origin",
      { status: "unavailable", reason: "native_api_origin_not_configured" },
    ],
    [
      "an invalid native origin",
      { status: "unavailable", reason: "native_api_origin_invalid" },
    ],
  ] as Array<[string, ApiTargetResolution]>)(
    "denies on %s with zero session reads and zero fetches",
    async (_label, target) => {
      const { request, getSession, fetchImpl } = harness({ target });
      const outcome = await request({ kind: "createInvitation" }, {});

      expect(outcome).toEqual({ kind: "forbidden" });
      expect(getSession).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["a traversal-only segment", { kind: "reviseInvitation", invitationId: ".." }],
    ["a dot segment", { kind: "resendInvitation", invitationId: "." }],
    ["an empty segment", { kind: "resendInvitation", invitationId: "" }],
    ["a whitespace segment", { kind: "reviseInvitation", invitationId: "a b" }],
    ["an unknown route", { kind: "notARoute" } as unknown as TeamApiRoute],
  ] as Array<[string, TeamApiRoute]>)(
    "denies %s with zero session reads and zero fetches",
    async (_label, route) => {
      const { request, getSession, fetchImpl } = harness();
      const outcome = await request(route, {});

      expect(outcome).toEqual({ kind: "forbidden" });
      expect(getSession).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["a nested path", "a/b"],
    ["a query attempt", "x?y=1"],
    ["a fragment attempt", "x#y"],
    ["an absolute URL", "https://evil.test/x"],
    ["a protocol-relative URL", "//evil.example.test/x"],
    ["an encoded traversal", "..%2F..%2Fadmin"],
  ])(
    "confines %s to the configured origin instead of escaping it",
    async (_label, invitationId) => {
      // Mirrors the Web contract exactly: these are neutralized by
      // percent-encoding rather than denied, and the load-bearing guarantee is
      // that the request cannot leave the configured origin or the prefix. The
      // point of repeating it here is that the origin is now CONFIGURED rather
      // than the document's, so "same-origin" no longer proves it by itself.
      const { request, fetchImpl } = harness();
      await request({ kind: "reviseInvitation", invitationId }, {});

      if (fetchImpl.mock.calls.length === 0) return; // denied outright is also fine
      const url = new URL(String(fetchImpl.mock.calls[0][0]));
      expect(url.origin, invitationId).toBe(NATIVE_API_ORIGIN);
      expect(url.pathname.startsWith("/api/team/"), invitationId).toBe(true);
      expect(url.pathname.endsWith("/revise"), invitationId).toBe(true);
      expect(url.search, invitationId).toBe("");
      expect(url.hash, invitationId).toBe("");
    }
  );

  it("denies an unserializable body before reading the token", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const { request, getSession, fetchImpl } = harness();
    const outcome = await request({ kind: "createInvitation" }, cyclic);

    expect(outcome).toEqual({ kind: "forbidden" });
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies when there is no session, without fetching", async () => {
    const { request, getSession, fetchImpl } = harness({ session: null });
    const outcome = await request({ kind: "createInvitation" }, {});

    expect(outcome).toEqual({ kind: "forbidden" });
    expect(getSession).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns the real response rather than fabricating one", async () => {
    const response = new Response('{"error":"forbidden: nope"}', { status: 403 });
    const { request } = harness({ response });
    const outcome = await request({ kind: "createInvitation" }, {});

    expect(outcome).toEqual({ kind: "response", response });
  });
});

describe("native restricted-asset resolver", () => {
  const reference = { assetId: SWISS_CURLING_GUARD_10_ASSET_ID } as const;
  const distribution: RestrictedDistribution = {
    scope: "restricted-closed-beta",
    permittedAudience: "Closed beta Team members only.",
    publicDeliveryPermitted: false,
  };

  it("is exercising a real catalogue id", () => {
    expect(isClosedBetaExerciseAssetId(SWISS_CURLING_GUARD_10_ASSET_ID)).toBe(true);
  });

  it("requests the configured origin with native transport options", async () => {
    const getSession = vi.fn(async () => ({
      data: { session: { access_token: ACCESS_TOKEN } },
      error: null,
    }));
    const fetchImpl: FetchSpy = vi.fn(async () => new Response(null, { status: 404 }));
    const resolver = createAuthorizedRestrictedAssetResolver(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { auth: { getSession } } as any,
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveTarget: () => nativeTarget,
      }
    );

    await resolver.resolveRestrictedAsset(reference, distribution);

    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${NATIVE_API_ORIGIN}/api/exercises/restricted-diagrams/${SWISS_CURLING_GUARD_10_ASSET_ID}`
    );
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
  });

  it("denies without reading a token when the target is unresolvable", async () => {
    const getSession = vi.fn();
    const fetchImpl = vi.fn();
    const resolver = createAuthorizedRestrictedAssetResolver(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { auth: { getSession } } as any,
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        resolveTarget: () => ({
          status: "unavailable",
          reason: "native_api_origin_invalid",
        }),
      }
    );

    expect(await resolver.resolveRestrictedAsset(reference, distribution)).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("production composition per platform", () => {
  function installClient(): FetchSpy {
    const fetchSpy: FetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    getSupabaseBrowserClientMock.mockReturnValue({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: ACCESS_TOKEN } },
          error: null,
        }),
      },
    });
    return fetchSpy;
  }

  it("addresses the document origin on Web", async () => {
    const fetchSpy = installClient();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", NATIVE_API_ORIGIN);

    const service = createSupabaseTeamService(CLOUD_CONFIG);
    await service.createInvitation("team-1", {
      email: "a@b.test",
      participationAsPlayer: true,
      proposedFunctions: [],
    });

    // Configuring the native origin must NOT retarget the Web application.
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `${window.location.origin}/api/team/invitations`
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBeUndefined();
    expect(init.redirect).toBeUndefined();
  });

  it.each([
    ["ios", simulateIos],
    ["android", simulateAndroid],
  ])("addresses the configured origin on %s", async (_platform, simulate) => {
    simulate();
    const fetchSpy = installClient();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", NATIVE_API_ORIGIN);

    const service = createSupabaseTeamService(CLOUD_CONFIG);
    await service.createInvitation("team-1", {
      email: "a@b.test",
      participationAsPlayer: true,
      proposedFunctions: [],
    });

    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `${NATIVE_API_ORIGIN}/api/team/invitations`
    );
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("omit");
    expect(init.redirect).toBe("error");
  });

  it.each([
    ["ios", simulateIos],
    ["android", simulateAndroid],
  ])("fails closed on %s when the API origin is unconfigured", async (_platform, simulate) => {
    simulate();
    const fetchSpy = installClient();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "");

    const service = createSupabaseTeamService(CLOUD_CONFIG);
    const outcome = await service.createInvitation("team-1", {
      email: "a@b.test",
      participationAsPlayer: true,
      proposedFunctions: [],
    });

    // A named, non-throwing failure — and nothing left the device.
    expect(outcome.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["a leading space", " https://api.example.test"],
    ["a trailing newline", "https://api.example.test\n"],
    ["a trailing carriage return", "https://api.example.test\r"],
    ["an interior space", "https://api.example.test /x"],
    ["a non-https scheme", "http://api.example.test"],
    ["a path", "https://api.example.test/api"],
    ["a trailing slash", "https://api.example.test/"],
    ["credentials", "https://user:pass@api.example.test"],
  ])(
    "denies a Team request on iOS for %s, with zero session reads and zero fetches",
    async (_label, configured) => {
      simulateIos();
      const fetchSpy = installClient();
      const getSession = vi.fn(async () => ({
        data: { session: { access_token: ACCESS_TOKEN } },
        error: null,
      }));
      getSupabaseBrowserClientMock.mockReturnValue({ auth: { getSession } });
      vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", configured);

      const service = createSupabaseTeamService(CLOUD_CONFIG);
      const outcome = await service.createInvitation("team-1", {
        email: "a@b.test",
        participationAsPlayer: true,
        proposedFunctions: [],
      });

      // An invalid configured origin has no destination at all, so the request
      // denies before the token is read and nothing leaves the device.
      expect(outcome.ok).toBe(false);
      expect(getSession).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["a leading space", " https://api.example.test"],
    ["a trailing newline", "https://api.example.test\n"],
    ["a non-https scheme", "http://api.example.test"],
  ])(
    "denies the restricted resolver on iOS for %s, with zero session reads and zero fetches",
    async (_label, configured) => {
      simulateIos();
      const fetchSpy = installClient();
      const getSession = vi.fn(async () => ({
        data: { session: { access_token: ACCESS_TOKEN } },
        error: null,
      }));
      getSupabaseBrowserClientMock.mockReturnValue({ auth: { getSession } });
      vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", configured);

      const resolver = createSupabaseRestrictedAssetResolver(CLOUD_CONFIG);
      const resolution = await resolver.resolveRestrictedAsset(
        { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
        {
          scope: "restricted-closed-beta",
          permittedAudience: "Closed beta Team members only.",
          publicDeliveryPermitted: false,
        }
      );

      expect(resolution).toBeNull();
      expect(getSession).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it("leaves Web unaffected by an invalid native origin", async () => {
    const fetchSpy = installClient();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", " https://api.example.test\n");

    const service = createSupabaseTeamService(CLOUD_CONFIG);
    await service.createInvitation("team-1", {
      email: "a@b.test",
      participationAsPlayer: true,
      proposedFunctions: [],
    });

    // The Web path never consults the native value at all.
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `${window.location.origin}/api/team/invitations`
    );
  });

  it("wires the restricted-asset resolver to the same configured origin", async () => {
    simulateIos();
    const fetchSpy = installClient();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", NATIVE_API_ORIGIN);

    const resolver = createSupabaseRestrictedAssetResolver(CLOUD_CONFIG);
    await resolver.resolveRestrictedAsset(
      { assetId: SWISS_CURLING_GUARD_10_ASSET_ID },
      {
        scope: "restricted-closed-beta",
        permittedAudience: "Closed beta Team members only.",
        publicDeliveryPermitted: false,
      }
    );

    // ADR-0023's delivery path is dormant, but it must not be left pointing at
    // the WebView origin on native.
    expect(String(fetchSpy.mock.calls[0][0])).toBe(
      `${NATIVE_API_ORIGIN}/api/exercises/restricted-diagrams/${SWISS_CURLING_GUARD_10_ASSET_ID}`
    );
  });
});
