// @vitest-environment jsdom
//
// The one infrastructure helper permitted to read the provider session's
// access token (authorizedFetch.ts; ADR-0025 Decision 20).
//
// The security properties under test are ordering properties as much as
// mapping ones: a rejected route must perform ZERO session reads and ZERO
// fetches, the URL must be proven same-origin and prefix-confined before a
// token is touched, no `Response` is ever fabricated, and the token never
// appears in a returned value, a log, or a snapshot.
//
// Most tests here drive the helper directly with injected test seams. The final
// describe block deliberately does NOT: it goes through the real production
// composition and the real document origin, because "the helper is safe when
// you hand it a safe origin" says nothing about what production actually hands
// it. jsdom is therefore the environment for the whole file.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthorizedTeamRequest } from "../authorizedFetch";
import type { TeamApiRoute } from "../authorizedTeamRequest";
import type { ConfiguredCloudConfig } from "../config";

const getSupabaseBrowserClientMock = vi.hoisted(() => vi.fn());

// authorizedFetch.ts and supabaseTeamService.ts name the client's TYPE only, so
// this mock exists purely for teamServiceFactory.ts's value import — no real
// Supabase client is ever constructed in this file.
vi.mock("../supabaseClient", () => ({
  getSupabaseBrowserClient: getSupabaseBrowserClientMock,
}));

import { createSupabaseTeamService } from "../teamServiceFactory";

const ORIGIN = "https://app.example.test";
const ACCESS_TOKEN = "team-access-token-must-never-leak";

type Harness = {
  request: ReturnType<typeof createAuthorizedTeamRequest>;
  getSession: ReturnType<typeof vi.fn>;
  fetchImpl: ReturnType<typeof vi.fn>;
};

function harness(
  options: {
    session?: unknown;
    sessionThrows?: boolean;
    fetchThrows?: boolean;
    response?: Response;
    origin?: string;
  } = {}
): Harness {
  const session =
    options.session === undefined ? { access_token: ACCESS_TOKEN } : options.session;
  const getSession = vi.fn(async () => {
    if (options.sessionThrows) throw new Error("session lookup exploded");
    return { data: { session }, error: null };
  });
  const fetchImpl = vi.fn(async () => {
    if (options.fetchThrows) throw new TypeError("Failed to fetch");
    return options.response ?? new Response("{}", { status: 200 });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = { auth: { getSession } } as any;
  const request = createAuthorizedTeamRequest(client, {
    fetchImpl: fetchImpl as unknown as typeof fetch,
    origin: options.origin ?? ORIGIN,
  });
  return { request, getSession, fetchImpl };
}

const ALL_ROUTES: Array<[TeamApiRoute, string]> = [
  [{ kind: "createInvitation" }, `${ORIGIN}/api/team/invitations`],
  [
    { kind: "reviseInvitation", invitationId: "inv-1" },
    `${ORIGIN}/api/team/invitations/inv-1/revise`,
  ],
  [
    { kind: "resendInvitation", invitationId: "inv-1" },
    `${ORIGIN}/api/team/invitations/inv-1/resend`,
  ],
  [{ kind: "createAdminRequest" }, `${ORIGIN}/api/team/admin-requests`],
  [{ kind: "removeMember" }, `${ORIGIN}/api/team/members/remove`],
];

describe("createAuthorizedTeamRequest — the closed route set", () => {
  it("maps all five routes to their hard-coded same-origin paths", async () => {
    for (const [route, expectedUrl] of ALL_ROUTES) {
      const { request, fetchImpl } = harness();
      const outcome = await request(route, { some: "body" });

      expect(outcome.kind, route.kind).toBe("response");
      expect(fetchImpl, route.kind).toHaveBeenCalledTimes(1);
      expect(fetchImpl.mock.calls[0][0], route.kind).toBe(expectedUrl);
    }
  });

  it("covers every route kind the contract declares (non-vacuous)", () => {
    const covered = ALL_ROUTES.map(([route]) => route.kind).sort();
    expect(covered).toEqual(
      [
        "createAdminRequest",
        "createInvitation",
        "removeMember",
        "resendInvitation",
        "reviseInvitation",
      ].sort()
    );
  });

  it("POSTs the serialized body with a JSON content type", async () => {
    const { request, fetchImpl } = harness();

    await request({ kind: "createInvitation" }, { teamId: "team-1" });

    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ teamId: "team-1" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });
});

describe("createAuthorizedTeamRequest — dynamic segment encoding and prefix confinement", () => {
  it("percent-encodes a dynamic segment", async () => {
    const { request, fetchImpl } = harness();

    await request({ kind: "reviseInvitation", invitationId: "a&c=d/e?f#g" }, {});

    expect(fetchImpl.mock.calls[0][0]).toBe(
      `${ORIGIN}/api/team/invitations/a%26c%3Dd%2Fe%3Ff%23g/revise`
    );
  });

  it("rejects a segment carrying whitespace or control characters outright", async () => {
    for (const invitationId of ["a b", "a\tb", "a\nb", " inv-1", "inv-1 "]) {
      const { request, fetchImpl, getSession } = harness();
      expect(await request({ kind: "reviseInvitation", invitationId }, {}), invitationId).toEqual({
        kind: "forbidden",
      });
      expect(getSession, invitationId).not.toHaveBeenCalled();
      expect(fetchImpl, invitationId).not.toHaveBeenCalled();
    }
  });

  it("cannot be made to escape the /api/team/ prefix or the origin", async () => {
    const hostile = [
      "../x",
      "../../admin",
      "..",
      ".",
      "a/b",
      "?x=1",
      "#frag",
      "//evil.example.test/x",
      "%2e%2e%2f",
      "\\u0000",
      "",
      " ",
    ];
    for (const invitationId of hostile) {
      const { request, fetchImpl, getSession } = harness();
      const outcome = await request({ kind: "reviseInvitation", invitationId }, {});

      if (outcome.kind === "response") {
        // Anything that IS allowed through must still be confined.
        const url = new URL(String(fetchImpl.mock.calls[0][0]));
        expect(url.origin, invitationId).toBe(ORIGIN);
        expect(url.pathname.startsWith("/api/team/"), invitationId).toBe(true);
        expect(url.pathname.endsWith("/revise"), invitationId).toBe(true);
        expect(url.search, invitationId).toBe("");
        expect(url.hash, invitationId).toBe("");
      } else {
        expect(outcome.kind, invitationId).toBe("forbidden");
        expect(fetchImpl, invitationId).not.toHaveBeenCalled();
        expect(getSession, invitationId).not.toHaveBeenCalled();
      }
    }
  });

  it("rejects `.` and `..` segments outright, with zero session reads and zero fetches", async () => {
    for (const invitationId of [".", ".."]) {
      const { request, fetchImpl, getSession } = harness();
      expect(await request({ kind: "reviseInvitation", invitationId }, {}), invitationId).toEqual({
        kind: "forbidden",
      });
      expect(getSession, invitationId).not.toHaveBeenCalled();
      expect(fetchImpl, invitationId).not.toHaveBeenCalled();
    }
  });

  it("rejects an unknown route kind with zero session reads and zero fetches", async () => {
    const { request, fetchImpl, getSession } = harness();

    const outcome = await request({ kind: "deleteEverything" } as unknown as TeamApiRoute, {});

    expect(outcome).toEqual({ kind: "forbidden" });
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies when no origin can be resolved, before reading a session", async () => {
    const getSession = vi.fn();
    const fetchImpl = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { auth: { getSession } } as any;
    const request = createAuthorizedTeamRequest(client, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      origin: "not-an-origin",
    });

    expect(await request({ kind: "createInvitation" }, {})).toEqual({ kind: "forbidden" });
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies an unserializable body before reading a session", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { request, getSession, fetchImpl } = harness();

    expect(await request({ kind: "createInvitation" }, circular)).toEqual({ kind: "forbidden" });
    expect(getSession).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("createAuthorizedTeamRequest — session and transport failures", () => {
  it("denies with no fetch when there is no session", async () => {
    const { request, fetchImpl } = harness({ session: null });

    expect(await request({ kind: "createInvitation" }, {})).toEqual({ kind: "forbidden" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("denies with no fetch when the session carries no usable access token", async () => {
    for (const session of [{}, { access_token: "" }, { access_token: 42 }]) {
      const { request, fetchImpl } = harness({ session });
      expect(await request({ kind: "createInvitation" }, {}), JSON.stringify(session)).toEqual({
        kind: "forbidden",
      });
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("denies with no fetch when the session lookup itself throws", async () => {
    const { request, fetchImpl } = harness({ sessionThrows: true });

    expect(await request({ kind: "createInvitation" }, {})).toEqual({ kind: "forbidden" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a transport failure as network_error and fabricates no Response", async () => {
    const { request } = harness({ fetchThrows: true });

    const outcome = await request({ kind: "createInvitation" }, {});

    expect(outcome).toEqual({ kind: "network_error" });
    expect(outcome).not.toHaveProperty("response");
  });

  it("passes the genuine Response through, whatever its status", async () => {
    for (const status of [200, 400, 403, 409, 500]) {
      const response = new Response(JSON.stringify({ status }), { status });
      const { request } = harness({ response });

      const outcome = await request({ kind: "createInvitation" }, {});

      expect(outcome.kind, String(status)).toBe("response");
      if (outcome.kind === "response") {
        // The very same object — not a copy, and certainly not a synthesized
        // status standing in for an authorization decision.
        expect(outcome.response, String(status)).toBe(response);
        expect(outcome.response.status, String(status)).toBe(status);
      }
    }
  });

  it("never fabricates a Response for a denial", async () => {
    const denials = [
      await harness({ session: null }).request({ kind: "createInvitation" }, {}),
      await harness().request({ kind: "reviseInvitation", invitationId: ".." }, {}),
      await harness({ fetchThrows: true }).request({ kind: "createInvitation" }, {}),
    ];
    for (const outcome of denials) {
      expect(outcome).not.toHaveProperty("response");
    }
  });
});

describe("createAuthorizedTeamRequest — the token crosses exactly one boundary", () => {
  it("sends the token only in the Authorization header of the validated request", async () => {
    const { request, fetchImpl } = harness();

    await request({ kind: "createInvitation" }, { teamId: "team-1" });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(url).not.toContain(ACCESS_TOKEN);
    expect(String(init.body)).not.toContain(ACCESS_TOKEN);
    expect(new URL(url).origin).toBe(ORIGIN);
    expect(new URL(url).pathname.startsWith("/api/team/")).toBe(true);
  });

  it("never returns or serializes the token in any outcome", async () => {
    const outcomes = [
      await harness().request({ kind: "createInvitation" }, {}),
      await harness({ fetchThrows: true }).request({ kind: "createInvitation" }, {}),
      await harness({ session: null }).request({ kind: "createInvitation" }, {}),
    ];
    for (const outcome of outcomes) {
      // `Response` is not JSON-serializable in a way that could carry it, but
      // check the whole outcome shape rather than assuming that.
      expect(JSON.stringify({ ...outcome, response: undefined })).not.toContain(ACCESS_TOKEN);
      expect(Object.values(outcome)).not.toContain(ACCESS_TOKEN);
    }
  });

  it("logs nothing at all, for any route or outcome", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );

    await harness().request({ kind: "createInvitation" }, {});
    await harness({ session: null }).request({ kind: "removeMember" }, {});
    await harness({ fetchThrows: true }).request({ kind: "createAdminRequest" }, {});
    await harness({ sessionThrows: true }).request({ kind: "resendInvitation", invitationId: "i" }, {});
    await harness().request({ kind: "reviseInvitation", invitationId: ".." }, {});

    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const text = typeof arg === "string" ? arg : JSON.stringify(arg);
          expect(text).not.toContain(ACCESS_TOKEN);
        }
      }
      expect(spy).not.toHaveBeenCalled();
    }
    for (const spy of spies) spy.mockRestore();
  });
});

describe("production wiring — createSupabaseTeamService composes the helper with no test overrides", () => {
  // Finding 6's gate: the static import/construction checks in
  // architectureBoundary.test.ts prove teamServiceFactory.ts is the only
  // value-importer and passes no overrides *as written*. This proves it
  // *behaviourally*, through the real composition: the request must land on the
  // real document origin (so no `origin` override was supplied) via the real
  // global `fetch` (so no `fetchImpl` override was supplied), and must stay
  // confined to /api/team/ even for a hostile dynamic id.
  const CONFIG: ConfiguredCloudConfig = {
    status: "configured",
    url: "https://x.supabase.co",
    publishableKey: "sb_publishable_" + "a".repeat(20),
  };
  const PRODUCTION_TOKEN = "production-token-must-never-leak";

  /** A `fetch`-shaped stub whose recorded calls are typed, so a test can read
   * the URL and init it was given. The parameters are declared purely to type
   * `mock.calls`; the stub ignores them and answers with `respond()`. */
  type FetchStub = ReturnType<typeof makeFetchStub>;
  function makeFetchStub(respond: () => Response) {
    return vi.fn((url: string | URL | Request, init?: RequestInit) => {
      void url;
      void init;
      return Promise.resolve(respond());
    });
  }

  function productionService(options: { fetchImpl: FetchStub }) {
    const getSession = vi.fn(async () => ({
      data: { session: { access_token: PRODUCTION_TOKEN } },
      error: null,
    }));
    getSupabaseBrowserClientMock.mockReturnValue({ rpc: vi.fn(), from: vi.fn(), auth: { getSession } });
    // The real global `fetch` is what the production helper reaches for when no
    // override was supplied, so stubbing the global is what makes "no override"
    // observable.
    vi.stubGlobal("fetch", options.fetchImpl);
    return { service: createSupabaseTeamService(CONFIG), getSession };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    getSupabaseBrowserClientMock.mockReset();
  });

  it("reaches a valid closed Team mutation on the real document origin, through the real global fetch", async () => {
    const fetchImpl = makeFetchStub(
      () =>
        new Response(JSON.stringify({ notificationEmailSent: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    const { service } = productionService({ fetchImpl });

    const result = await service.removeMember("team-1", "mem-2");

    expect(result).toEqual({ ok: true, value: { notificationEmailSent: true } });
    // Production supplied no `fetchImpl` override: the real global was used.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    // Production supplied no `origin` override: this is the real document origin.
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/api/team/members/remove");
  });

  it("keeps a hostile dynamic id confined to /api/team/ through the production composition", async () => {
    const fetchImpl = makeFetchStub(() => new Response("{}", { status: 200 }));
    const { service } = productionService({ fetchImpl });

    for (const invitationId of ["../../admin", "..%2F..%2Fadmin", "//evil.example.test/x", "?x=1", "#f"]) {
      fetchImpl.mockClear();
      const result = await service.resendInvitation(invitationId);

      if (fetchImpl.mock.calls.length === 0) {
        // Denied before transport — the fail-closed direction.
        expect(result.ok, invitationId).toBe(false);
        continue;
      }
      const url = new URL(String(fetchImpl.mock.calls[0][0]));
      expect(url.origin, invitationId).toBe(window.location.origin);
      expect(url.pathname.startsWith("/api/team/"), invitationId).toBe(true);
      expect(url.pathname.endsWith("/resend"), invitationId).toBe(true);
      expect(url.search, invitationId).toBe("");
      expect(url.hash, invitationId).toBe("");
    }
  });

  it("denies a traversal-only id through the production composition, with zero fetches and no session read", async () => {
    const fetchImpl = makeFetchStub(() => new Response("{}", { status: 200 }));
    const { service, getSession } = productionService({ fetchImpl });

    const result = await service.resendInvitation("..");

    expect(result).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "You must be signed in." },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(getSession).not.toHaveBeenCalled();
  });

  it("never prints or snapshots the Authorization value taken from the production session", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );
    const fetchImpl = makeFetchStub(() => new Response("{}", { status: 200 }));
    const { service } = productionService({ fetchImpl });

    const result = await service.removeMember("team-1", "mem-2");

    // The header IS present on the wire — asserted without rendering its value.
    const init = fetchImpl.mock.calls[0][1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers)).toContain("Authorization");
    expect(headers.Authorization.startsWith("Bearer ")).toBe(true);
    // ...and it is nowhere in what comes back out, nor in any log.
    expect(JSON.stringify(result)).not.toContain(PRODUCTION_TOKEN);
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain(PRODUCTION_TOKEN);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    for (const spy of spies) spy.mockRestore();
  });
});
