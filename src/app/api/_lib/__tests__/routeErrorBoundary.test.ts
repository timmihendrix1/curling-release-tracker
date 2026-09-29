// @vitest-environment node
//
// The error boundary around every natively-callable route (ADR-0047).
//
// `withNativeCors` awaits the route handler. If that promise REJECTS — before the
// route's own try/catch, or from something the route never guards, such as
// constructing the Supabase client or awaiting a dynamic route context — the
// rejection escapes the wrapper. A native caller then receives whatever the
// framework produces, with no `Access-Control-Allow-Origin` header, so the
// browser refuses to hand it to the page and the app cannot tell a server fault
// apart from being blocked.
//
// These tests deliberately do NOT mock `supabaseServerClient`: the point is that
// a real dependency can throw where no route expects it. The configuration below
// is synthetic and malformed in one specific way — `https:project.supabase.test`
// has no `//`, which `new URL` happily normalizes (so `resolveCloudConfig` calls
// it configured) while the installed SDK constructor rejects it. That asymmetry
// is a convenient, entirely local trigger; the defect under test is the general
// unguarded await, not this one URL.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/** Stands in for a Team route's own sanitized internal-error response. */
const teamStyleInternalError = () =>
  NextResponse.json(
    { error: "unexpected_error: Something went wrong. Please try again." },
    { status: 500 }
  );

const smtpFactoryMock = vi.fn();
const readFileMock = vi.fn();

vi.mock("../../../../lib/email/smtpEmailService", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/email/smtpEmailService")
  >("../../../../lib/email/smtpEmailService");
  return { ...actual, createSmtpEmailServiceFromEnv: () => smtpFactoryMock() };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, default: actual, readFile: (...args: unknown[]) => readFileMock(...args) };
});

const IOS_ORIGIN = "capacitor://localhost";
const ANDROID_ORIGIN = "https://localhost";
const APP_ORIGIN = "https://app.example.test";

/** Parses as a URL, so `resolveCloudConfig` accepts it; the SDK constructor does not. */
const MALFORMED_SUPABASE_URL = "https:project.supabase.test";
const SYNTHETIC_PUBLISHABLE_KEY = "sb_publishable_syntheticvalue";
/** A syntactically valid UUID so the restricted route reaches authentication. */
const SYNTHETIC_TEAM_ID = "11111111-2222-4333-8444-555555555555";

const NATIVE_ORIGINS = [IOS_ORIGIN, ANDROID_ORIGIN] as const;

function nativeRequest(origin: string, method: "POST" | "GET"): Request {
  return new Request(`${APP_ORIGIN}/api/whatever`, {
    method,
    headers: {
      origin,
      authorization: "Bearer synthetic-bearer-token",
      "content-type": "application/json",
    },
    body: method === "GET" ? undefined : JSON.stringify({ teamId: "t", membershipId: "m" }),
  });
}

beforeEach(() => {
  smtpFactoryMock.mockReset();
  smtpFactoryMock.mockReturnValue(null);
  readFileMock.mockReset();
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", MALFORMED_SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", SYNTHETIC_PUBLISHABLE_KEY);
  vi.stubEnv("CLOSED_BETA_EXERCISE_ASSET_TEAM_ID", SYNTHETIC_TEAM_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("client construction failure inside a Team route", () => {
  it.each(NATIVE_ORIGINS)(
    "returns a readable sanitized 500 to %s instead of rejecting",
    async (origin) => {
      const { POST } = await import("../../team/invitations/route");

      const response = await POST(nativeRequest(origin, "POST"));

      expect(response.status).toBe(500);
      // Without this the browser refuses the response and the app cannot tell a
      // server fault from being blocked.
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Vary")).toContain("Origin");
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    }
  );

  it("preserves the Team route family's public error shape", async () => {
    const { POST } = await import("../../team/invitations/route");

    const response = await POST(nativeRequest(IOS_ORIGIN, "POST"));
    const body = (await response.json()) as { error?: string };

    // Team errors are `'<kind>: <message>'` (docs/adr/0022 §Error Boundary
    // Sanitization). A restricted-diagram error is a different shape entirely.
    expect(body.error).toMatch(/^unexpected_error: /);
  });

  it("leaks no exception detail, configuration or credential", async () => {
    const { POST } = await import("../../team/invitations/route");

    const response = await POST(nativeRequest(IOS_ORIGIN, "POST"));
    const serialized = `${await response.text()} ${JSON.stringify([
      ...response.headers.entries(),
    ])}`;

    for (const forbidden of [
      MALFORMED_SUPABASE_URL,
      SYNTHETIC_PUBLISHABLE_KEY,
      SYNTHETIC_TEAM_ID,
      "synthetic-bearer-token",
      "supabaseUrl",
      "Invalid URL",
      "project.supabase.test",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("performs no email send and no mutation after the failure", async () => {
    const { POST } = await import("../../team/invitations/route");

    await POST(nativeRequest(IOS_ORIGIN, "POST"));

    // The client never existed, so no RPC could have run; the observable proof
    // available here is that the post-mutation email path was never entered.
    expect(smtpFactoryMock).not.toHaveBeenCalled();
  });
});

describe("client construction failure inside the restricted-diagram route", () => {
  /** A REAL catalogue id, so the route gets past its 404 guard and actually
   * reaches authentication — an invalid id would return 404 first and prove
   * nothing about this path. */
  async function realAssetId(): Promise<string> {
    const { CLOSED_BETA_EXERCISE_ASSET_IDS } = await import(
      "../../../../lib/exercises/restrictedAssetCatalog"
    );
    return CLOSED_BETA_EXERCISE_ASSET_IDS[0];
  }

  it.each(NATIVE_ORIGINS)(
    "returns a readable sanitized 500 to %s instead of rejecting",
    async (origin) => {
      const { GET } = await import("../../exercises/restricted-diagrams/[assetId]/route");
      const assetId = await realAssetId();

      const response = await GET(nativeRequest(origin, "GET"), {
        params: Promise.resolve({ assetId }),
      });

      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Vary")).toContain("Origin");
    }
  );

  it("preserves the restricted route family's own error shape and cache semantics", async () => {
    const { GET } = await import("../../exercises/restricted-diagrams/[assetId]/route");
    const assetId = await realAssetId();

    const response = await GET(nativeRequest(IOS_ORIGIN, "GET"), {
      params: Promise.resolve({ assetId }),
    });
    const body = (await response.json()) as { error?: string };

    // Deliberately NOT the Team shape: this family says only this.
    expect(body).toEqual({ error: "Restricted diagram unavailable." });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
  });

  it("reads no asset file after the failure", async () => {
    const { GET } = await import("../../exercises/restricted-diagrams/[assetId]/route");
    const assetId = await realAssetId();

    await GET(nativeRequest(IOS_ORIGIN, "GET"), { params: Promise.resolve({ assetId }) });

    expect(readFileMock).not.toHaveBeenCalled();
  });
});

describe("a RETURNED internal-error response (not a rejection)", () => {
  // Distinct from the thrown case above: here each route decides for itself that
  // it cannot proceed and returns its own 500. The boundary must not alter that
  // response — only add the CORS grant to it.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  });

  it.each(NATIVE_ORIGINS)("is readable by %s with the Team shape intact", async (origin) => {
    const { POST } = await import("../../team/invitations/route");

    const response = await POST(nativeRequest(origin, "POST"));

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect((await response.json()) as { error: string }).toEqual({
      error: "unexpected_error: Cloud is not configured.",
    });
  });

  it("is readable by a native caller with the restricted shape intact", async () => {
    const { GET } = await import("../../exercises/restricted-diagrams/[assetId]/route");
    const { CLOSED_BETA_EXERCISE_ASSET_IDS } = await import(
      "../../../../lib/exercises/restrictedAssetCatalog"
    );

    const response = await GET(nativeRequest(IOS_ORIGIN, "GET"), {
      params: Promise.resolve({ assetId: CLOSED_BETA_EXERCISE_ASSET_IDS[0] }),
    });

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(IOS_ORIGIN);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect((await response.json()) as unknown).toEqual({
      error: "Restricted diagram unavailable.",
    });
  });
});

describe("a rejected dynamic route context", () => {
  // Next resolves route params as a promise. A rejection there happens outside
  // anything the route body can guard.
  //
  // This scenario needs configuration that WORKS. The outer `beforeEach`
  // deliberately supplies a URL the SDK constructor rejects, and the revise
  // route calls `resolveRouteContext` — which constructs the client — BEFORE it
  // awaits `params`. Inheriting that configuration would make the constructor
  // throw first, and the test would pass while never reaching the params await
  // at all.
  //
  // So this block supplies valid synthetic configuration and a narrowly
  // controlled client factory, and then proves the params promise was actually
  // CONSUMED. Asserting "a 500 came back" would not distinguish this path from
  // the malformed-configuration path above, which is exactly the trap this
  // replaces.

  const VALID_SUPABASE_URL = "https://project.supabase.test";

  /** A params thenable that records the moment the route awaits it, then rejects.
   *
   * The rejection is created INSIDE `then`, so there is no unconsumed rejection
   * to suppress — and therefore nothing that could hide a route which never
   * awaited it. `wasConsumed()` is the observation that makes this test
   * meaningful. */
  function observableRejectingParams(reason: unknown): {
    params: Promise<{ id: string }>;
    wasConsumed: () => boolean;
  } {
    let consumed = false;
    const thenable = {
      then<TResult1, TResult2>(
        onFulfilled?: ((value: { id: string }) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((error: unknown) => TResult2 | PromiseLike<TResult2>) | null
      ): PromiseLike<TResult1 | TResult2> {
        consumed = true;
        return Promise.reject(reason).then(onFulfilled, onRejected);
      },
    };
    return {
      params: thenable as unknown as Promise<{ id: string }>,
      wasConsumed: () => consumed,
    };
  }

  type ReviseHarness = {
    POST: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
    constructClient: ReturnType<typeof vi.fn>;
    rpc: ReturnType<typeof vi.fn>;
  };

  /** Loads the real revise route against a controlled, SUCCESSFUL client
   * construction, scoped to this block so the malformed-configuration tests
   * above keep exercising the real SDK. */
  async function loadReviseRoute(): Promise<ReviseHarness> {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const constructClient = vi.fn(() => ({
      rpc,
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    }));

    vi.resetModules();
    vi.doMock("../../../../lib/supabase/supabaseServerClient", () => ({
      // The route's only use of this is "give me a client"; the test asserts
      // that it was reached, not which arguments it received.
      createUserScopedServerClient: () => constructClient(),
      extractBearerToken: (request: Request) => {
        const header = request.headers.get("authorization");
        if (!header) return null;
        const match = /^Bearer\s+(.+)$/i.exec(header);
        return match ? match[1] : null;
      },
    }));

    const mod = (await import("../../team/invitations/[id]/revise/route")) as unknown as {
      POST: ReviseHarness["POST"];
    };
    return { POST: mod.POST, constructClient, rpc };
  }

  beforeEach(() => {
    // Valid, so client construction SUCCEEDS and the route reaches `await params`.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", VALID_SUPABASE_URL);
  });

  afterEach(() => {
    vi.doUnmock("../../../../lib/supabase/supabaseServerClient");
    vi.resetModules();
  });

  it.each(NATIVE_ORIGINS)(
    "consumes the rejecting params and answers %s with a sanitized CORS-bearing 500",
    async (origin) => {
      const { POST, constructClient, rpc } = await loadReviseRoute();
      const { params, wasConsumed } = observableRejectingParams(new Error("params exploded"));

      const response = await POST(nativeRequest(origin, "POST"), { params });

      // The client really was built — so this is NOT the malformed-config path.
      expect(constructClient).toHaveBeenCalledTimes(1);
      // And the route really did await the params before failing.
      expect(wasConsumed()).toBe(true);

      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
      expect(response.headers.get("Vary")).toContain("Origin");
      expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
      expect((await response.json()) as unknown).toEqual({
        error: expect.stringMatching(/^unexpected_error: /),
      });
      // Nothing ran past the parameter failure.
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it("performs no RPC, email send or file read after the parameter failure", async () => {
    const { POST, constructClient, rpc } = await loadReviseRoute();
    const { params, wasConsumed } = observableRejectingParams(new Error("params exploded"));

    await POST(nativeRequest(IOS_ORIGIN, "POST"), { params });

    expect(constructClient).toHaveBeenCalledTimes(1);
    expect(wasConsumed()).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(smtpFactoryMock).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("leaks no detail of the rejection reason", async () => {
    const { POST } = await loadReviseRoute();
    const { params } = observableRejectingParams(
      new Error("params exploded: synthetic-bearer-token")
    );

    const response = await POST(nativeRequest(IOS_ORIGIN, "POST"), { params });
    const serialized = `${await response.text()} ${JSON.stringify([
      ...response.headers.entries(),
    ])}`;

    expect(serialized).not.toContain("params exploded");
    expect(serialized).not.toContain("synthetic-bearer-token");
  });

  it("would not pass if the route never awaited params", async () => {
    // Guards the guard: the probe must genuinely report non-consumption,
    // otherwise `wasConsumed()` above would be vacuously true.
    const { wasConsumed } = observableRejectingParams(new Error("never awaited"));
    expect(wasConsumed()).toBe(false);
  });
});

describe("a non-Error thrown value", () => {
  it("is contained without leaking its contents", async () => {
    // Nothing guarantees a thrown value is an Error. A string, a Proxy or an
    // object carrying request data must not reach the response.
    const { withNativeCors } = await import("../nativeCors");
    const handler = withNativeCors(
      async () => {
        throw { secret: "synthetic-bearer-token", toString: () => "synthetic-bearer-token" };
      },
      teamStyleInternalError
    );

    const response = await handler(nativeRequest(IOS_ORIGIN, "POST"));
    const serialized = `${await response.text()} ${JSON.stringify([
      ...response.headers.entries(),
    ])}`;

    expect(response.status).toBe(500);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(IOS_ORIGIN);
    expect(serialized).not.toContain("synthetic-bearer-token");
  });

  it.each([undefined, null, "a string", 42])(
    "is contained for the thrown value %s",
    async (thrown) => {
      const { withNativeCors } = await import("../nativeCors");
      const handler = withNativeCors(async () => {
        throw thrown;
      }, teamStyleInternalError);

      const response = await handler(nativeRequest(IOS_ORIGIN, "POST"));
      expect(response.status).toBe(500);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(IOS_ORIGIN);
    }
  );

  it("grants nothing to an unapproved origin even when the handler throws", async () => {
    const { withNativeCors } = await import("../nativeCors");
    const inner = vi.fn(async () => {
      throw new Error("should never run");
    });
    const handler = withNativeCors(inner, teamStyleInternalError);

    const response = await handler(
      new Request(`${APP_ORIGIN}/api/whatever`, {
        method: "POST",
        headers: { origin: "https://evil.test" },
        body: "{}",
      })
    );

    // Refused before the handler ran at all, so there was nothing to throw.
    expect(inner).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
