// @vitest-environment node
//
// The native CORS boundary (ADR-0047).
//
// CORS decides whether a BROWSER hands a response back to the page that asked
// for it. It authenticates nothing. Every assertion here is about which origins
// are granted that, and — just as importantly — that an unapproved cross-origin
// caller cannot cause a side effect even when it presents a valid bearer token.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import {
  NATIVE_APP_ORIGINS,
  applyNativeCorsHeaders,
  isAcceptableRequestOrigin,
  isAllowedNativeOrigin,
  nativeCorsPreflight,
  withNativeCors,
} from "../nativeCors";

const IOS_ORIGIN = "capacitor://localhost";
const ANDROID_ORIGIN = "https://localhost";
const APP_ORIGIN = "https://app.example.test";

function requestWithOrigin(origin: string | null, url = `${APP_ORIGIN}/api/team/invitations`): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (origin !== null) headers.origin = origin;
  return new Request(url, { method: "POST", headers, body: "{}" });
}

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the native origin allow-list", () => {
  it("names the Capacitor 8 defaults this project actually uses", () => {
    // capacitor.config.ts declares no `server` block, so Capacitor's documented
    // defaults apply: iosScheme "capacitor", androidScheme "https", hostname
    // "localhost". The Android entry is CONFIGURATION ONLY — no Android project
    // exists and this is not hardware evidence.
    expect([...NATIVE_APP_ORIGINS]).toEqual([IOS_ORIGIN, ANDROID_ORIGIN]);
  });

  it.each([IOS_ORIGIN, ANDROID_ORIGIN])("allows %s exactly", (origin) => {
    expect(isAllowedNativeOrigin(origin)).toBe(true);
  });

  it.each([
    ["the literal null origin", "null"],
    ["a wildcard", "*"],
    ["an empty string", ""],
    ["a suffix match", "https://evil-localhost"],
    ["a prefix match", "https://localhost.evil.test"],
    ["a subdomain", "https://a.localhost"],
    ["a different scheme", "http://localhost"],
    ["a port variant", "https://localhost:8080"],
    ["a path variant", "capacitor://localhost/"],
    ["a case variant", "CAPACITOR://LOCALHOST"],
    ["an arbitrary origin", "https://evil.test"],
  ])("refuses %s", (_label, origin) => {
    expect(isAllowedNativeOrigin(origin)).toBe(false);
  });

  it("refuses absent values without throwing", () => {
    expect(isAllowedNativeOrigin(null)).toBe(false);
    expect(isAllowedNativeOrigin(undefined)).toBe(false);
  });

  it("never compares a custom scheme through URL.origin", () => {
    // `new URL("capacitor://localhost").origin` is the string "null" in a
    // WHATWG parser. Matching that way would collapse every opaque origin — and
    // every sandboxed iframe's "null" — into one accepted value.
    expect(new URL(IOS_ORIGIN).origin).toBe("null");
    expect(isAllowedNativeOrigin(new URL(IOS_ORIGIN).origin)).toBe(false);
  });
});

describe("which request origins this application serves at all", () => {
  it("accepts a request with no Origin header", () => {
    // Server-to-server and non-browser callers, unchanged.
    expect(isAcceptableRequestOrigin(requestWithOrigin(null))).toBe(true);
  });

  it("accepts ordinary same-origin Web", () => {
    // Browsers send Origin on every POST, including same-origin ones.
    expect(isAcceptableRequestOrigin(requestWithOrigin(APP_ORIGIN))).toBe(true);
  });

  it("accepts the request's own origin even when APP_ORIGIN is unset", () => {
    vi.stubEnv("APP_ORIGIN", "");
    const request = requestWithOrigin("https://internal.example.test", "https://internal.example.test/api/team/invitations");
    expect(isAcceptableRequestOrigin(request)).toBe(true);
  });

  it("accepts the configured canonical origin behind a proxy", () => {
    // The request can arrive on an internal address while the browser sends the
    // public origin. Reading the already-configured APP_ORIGIN covers that
    // without changing any email-link semantics.
    const request = requestWithOrigin(APP_ORIGIN, "http://127.0.0.1:3000/api/team/invitations");
    expect(isAcceptableRequestOrigin(request)).toBe(true);
  });

  it.each([IOS_ORIGIN, ANDROID_ORIGIN])("accepts the native origin %s", (origin) => {
    expect(isAcceptableRequestOrigin(requestWithOrigin(origin))).toBe(true);
  });

  it.each(["https://evil.test", "null", "http://localhost"])(
    "refuses the unapproved origin %s",
    (origin) => {
      expect(isAcceptableRequestOrigin(requestWithOrigin(origin))).toBe(false);
    }
  );
});

describe("response headers", () => {
  it("grants only an allow-listed origin, by exact echo", () => {
    const response = applyNativeCorsHeaders(
      NextResponse.json({ ok: true }),
      requestWithOrigin(IOS_ORIGIN)
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(IOS_ORIGIN);
  });

  it("never reflects an arbitrary origin", () => {
    const response = applyNativeCorsHeaders(
      NextResponse.json({ ok: true }),
      requestWithOrigin("https://evil.test")
    );
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("never sends credentials permission or a wildcard", () => {
    const response = applyNativeCorsHeaders(
      NextResponse.json({ ok: true }),
      requestWithOrigin(IOS_ORIGIN)
    );
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("marks the response as varying by origin even when not granted", () => {
    const response = applyNativeCorsHeaders(
      NextResponse.json({ ok: true }),
      requestWithOrigin("https://evil.test")
    );
    // A shared cache must not serve one origin's response to another.
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("merges Vary without destroying existing values", () => {
    const base = NextResponse.json({ ok: true }, { headers: { Vary: "Accept-Encoding, Accept" } });
    const response = applyNativeCorsHeaders(base, requestWithOrigin(IOS_ORIGIN));
    expect(response.headers.get("Vary")).toBe("Accept-Encoding, Accept, Origin");
  });

  it("does not duplicate an existing Origin in Vary", () => {
    const base = NextResponse.json({ ok: true }, { headers: { Vary: "origin" } });
    const response = applyNativeCorsHeaders(base, requestWithOrigin(IOS_ORIGIN));
    expect(response.headers.get("Vary")).toBe("origin");
  });

  it("preserves status, body and cache semantics", async () => {
    const base = NextResponse.json(
      { error: "forbidden: nope" },
      { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
    const response = applyNativeCorsHeaders(base, requestWithOrigin(IOS_ORIGIN));

    expect(response.status).toBe(403);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ error: "forbidden: nope" });
  });
});

describe("preflight", () => {
  const OPTIONS = nativeCorsPreflight(["POST"]);

  it.each([IOS_ORIGIN, ANDROID_ORIGIN])("permits the needed method and headers for %s", (origin) => {
    const response = OPTIONS(requestWithOrigin(origin));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "Authorization, Content-Type"
    );
    expect(response.headers.get("Access-Control-Max-Age")).toBe("600");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("permits only the route's own method", () => {
    const getOnly = nativeCorsPreflight(["GET"]);
    const response = getOnly(requestWithOrigin(IOS_ORIGIN));
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("Access-Control-Allow-Methods")).not.toContain("POST");
  });

  it.each(["https://evil.test", "null", null])("grants nothing to %s", (origin) => {
    const response = OPTIONS(requestWithOrigin(origin));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("answers from configuration alone", () => {
    // No authentication lookup, no RPC, no file read, no email send. A preflight
    // that touched any of those would be a side effect an unauthenticated
    // caller could trigger at will.
    const request = requestWithOrigin(IOS_ORIGIN);
    const bodySpy = vi.spyOn(request, "json");
    const response = OPTIONS(request);

    expect(response.status).toBe(204);
    expect(bodySpy).not.toHaveBeenCalled();
    expect(request.headers.get("authorization")).toBeNull();
  });
});

describe("the wrapped handler", () => {
  /** Stands in for a route family's own sanitized internal-error response. */
  const testInternalError = () =>
    NextResponse.json({ error: "unexpected_error: test" }, { status: 500 });

  function wrapped(): {
    handler: (request: Request) => Promise<NextResponse>;
    inner: ReturnType<typeof vi.fn>;
  } {
    const inner = vi.fn(async () => NextResponse.json({ ok: true }));
    return { handler: withNativeCors(inner, testInternalError), inner };
  }

  it.each([null, APP_ORIGIN, IOS_ORIGIN, ANDROID_ORIGIN])(
    "runs the handler for the acceptable origin %s",
    async (origin) => {
      const { handler, inner } = wrapped();
      const response = await handler(requestWithOrigin(origin));

      expect(inner).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(200);
    }
  );

  it.each(["https://evil.test", "null"])(
    "refuses %s BEFORE the handler runs, so no side effect occurs",
    async (origin) => {
      const { handler, inner } = wrapped();
      const response = await handler(requestWithOrigin(origin));

      // This is the property that matters: CORS alone would only hide the
      // response from the page, leaving the mutation or the email already done.
      expect(inner).not.toHaveBeenCalled();
      expect(response.status).toBe(403);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    }
  );

  it("refuses an unapproved origin even with a valid-looking bearer token", async () => {
    const inner = vi.fn(async () => NextResponse.json({ ok: true }));
    const handler = withNativeCors(inner, testInternalError);
    const request = new Request(`${APP_ORIGIN}/api/team/invitations`, {
      method: "POST",
      headers: { origin: "https://evil.test", authorization: "Bearer looks-real" },
      body: "{}",
    });

    const response = await handler(request);
    expect(inner).not.toHaveBeenCalled();
    expect(response.status).toBe(403);
  });

  it("adds the grant to a handler's error response, not only its success", async () => {
    const inner = vi.fn(async () =>
      NextResponse.json({ error: "forbidden: You must be signed in." }, { status: 401 })
    );
    const handler = withNativeCors(inner, testInternalError);
    const response = await handler(requestWithOrigin(IOS_ORIGIN));

    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(IOS_ORIGIN);
  });

  it("passes a dynamic route's context through untouched", async () => {
    const context = { params: Promise.resolve({ id: "inv-1" }) };
    const inner = vi.fn(async () => NextResponse.json({ ok: true }));
    const handler = withNativeCors<typeof context>(inner, testInternalError);

    await handler(requestWithOrigin(IOS_ORIGIN), context);
    expect(inner).toHaveBeenCalledWith(expect.any(Request), context);
  });
});
