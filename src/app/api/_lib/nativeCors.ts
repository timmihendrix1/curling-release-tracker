// Narrowly scoped CORS for the native mobile client (ADR-0047).
//
// The Web application is same-origin and needs none of this. A native build
// loads from a local app scheme, so its authorized requests are cross-origin and
// the browser engine requires an explicit, non-wildcard grant.
//
// THREE THINGS THIS IS NOT:
//
// 1. Authentication. A matching `Origin` grants nothing. Every route still
//    verifies the bearer token and every query is still authorized by
//    `auth.uid()` and RLS. CORS only decides whether a browser hands the
//    response back to the page that asked for it.
// 2. Credentialed. `Access-Control-Allow-Credentials` is never sent and no
//    wildcard is ever sent. This application authorizes with a bearer header,
//    never with cookies.
// 3. Permissive. The allow-list is an exact string set. Nothing is reflected,
//    no suffix or prefix matching happens, and `null` is refused.
import { NextResponse } from "next/server";
import { resolveAppOriginConfig } from "../team/_lib/context";
import { safeErrorCategory } from "../../../lib/safeErrorCategory";

/**
 * The exact origins a native build can present.
 *
 * These are Capacitor 8's documented defaults for this project's configuration
 * (`@capacitor/cli` declarations: `server.hostname` defaults to `localhost`,
 * `server.iosScheme` to `capacitor`, `server.androidScheme` to `https`), and
 * `capacitor.config.ts` deliberately declares no `server` block, so the
 * defaults apply.
 *
 * The Android entry is CONFIGURATION ONLY. No Android project exists and
 * nothing here is hardware evidence (Stage M5).
 *
 * Compared as exact strings, never via `new URL(origin).origin`: a custom
 * scheme like `capacitor://localhost` is an opaque origin, and the URL parser
 * reports its `origin` as the string "null" — which would collapse every
 * custom-scheme origin, and every genuinely opaque one, into a single matching
 * value.
 */
export const NATIVE_APP_ORIGINS: readonly string[] = [
  "capacitor://localhost", // iOS
  "https://localhost", // Android (configuration only; unverified on hardware)
];

/** Headers a native caller may send. `Authorization` is what makes these
 * requests non-simple and therefore preflighted in the first place. */
const ALLOWED_REQUEST_HEADERS = "Authorization, Content-Type";

const PREFLIGHT_MAX_AGE_SECONDS = "600";

export function isAllowedNativeOrigin(origin: string | null | undefined): boolean {
  if (typeof origin !== "string" || origin.length === 0) return false;
  // `null` is what a sandboxed iframe, a redirected cross-origin request or an
  // opaque origin sends. It must never match.
  if (origin === "null" || origin === "*") return false;
  return NATIVE_APP_ORIGINS.includes(origin);
}

/** The origin this request was actually addressed to. */
function requestOwnOrigin(request: Request): string | null {
  try {
    return new URL(request.url).origin;
  } catch {
    return null;
  }
}

/**
 * Whether an `Origin` header belongs to this application at all.
 *
 * Accepted:
 *  - no `Origin` header — server-to-server and non-browser callers, unchanged;
 *  - the request's own origin — ordinary same-origin Web (browsers send
 *    `Origin` on every POST, including same-origin ones);
 *  - the configured canonical `APP_ORIGIN`, because behind a proxy the
 *    request's own origin can be an internal address while the browser sends
 *    the public one. This only READS the already-configured value; it changes
 *    no email-link semantics;
 *  - an exact native app origin.
 *
 * Everything else is a cross-origin caller this application does not serve.
 */
export function isAcceptableRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  if (isAllowedNativeOrigin(origin)) return true;

  const own = requestOwnOrigin(request);
  if (own !== null && origin === own) return true;

  const configured = resolveAppOriginConfig();
  return configured.status === "configured" && origin === configured.origin;
}

function mergeVary(existing: string | null, added: string): string {
  if (existing === null || existing.trim() === "") return added;
  const present = existing
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const alreadyThere = present.some(
    (value) => value.toLowerCase() === added.toLowerCase() || value === "*"
  );
  return alreadyThere ? present.join(", ") : [...present, added].join(", ");
}

/**
 * Adds the CORS grant for an allowed native origin, preserving everything else
 * about the response — status, body, and cache semantics included.
 *
 * `Vary: Origin` is merged rather than assigned, so an existing `Vary` value is
 * never destroyed. It is set even when the origin is not allowed, because the
 * response genuinely does depend on the request's origin and a shared cache
 * must not serve one origin's response to another.
 */
export function applyNativeCorsHeaders<T extends Response>(response: T, request: Request): T {
  const origin = request.headers.get("origin");
  response.headers.set("Vary", mergeVary(response.headers.get("Vary"), "Origin"));
  if (!isAllowedNativeOrigin(origin)) return response;
  // Exact echo of an allow-listed value — never a reflected arbitrary origin.
  response.headers.set("Access-Control-Allow-Origin", origin as string);
  return response;
}

/**
 * Builds a route's `OPTIONS` handler.
 *
 * A preflight performs NO authentication lookup, no RPC, no file read and no
 * email send — it answers from static configuration alone. A disallowed origin
 * gets a response with no CORS grant, which is what makes the browser refuse
 * the real request that would have followed.
 */
export function nativeCorsPreflight(
  allowedMethods: readonly string[]
): (request: Request) => NextResponse {
  const methods = [...allowedMethods, "OPTIONS"].join(", ");
  return function OPTIONS(request: Request): NextResponse {
    const response = new NextResponse(null, { status: 204 });
    response.headers.set("Vary", mergeVary(response.headers.get("Vary"), "Origin"));
    if (!isAllowedNativeOrigin(request.headers.get("origin"))) {
      return response;
    }
    response.headers.set(
      "Access-Control-Allow-Origin",
      request.headers.get("origin") as string
    );
    response.headers.set("Access-Control-Allow-Methods", methods);
    response.headers.set("Access-Control-Allow-Headers", ALLOWED_REQUEST_HEADERS);
    response.headers.set("Access-Control-Max-Age", PREFLIGHT_MAX_AGE_SECONDS);
    return response;
  };
}

/**
 * Wraps a route handler so that:
 *
 *  - a request from an origin this application does not serve is refused
 *    BEFORE the handler runs, so an unapproved cross-origin caller cannot cause
 *    a mutation, an email send or a file read even if it presents a valid
 *    bearer token;
 *  - every response the handler produces — success, 401, 403, validation error
 *    or internal failure — carries the CORS grant when the caller is an allowed
 *    native origin.
 *
 * The handler's own status, body and cache headers are never altered.
 */
/**
 * Produces this route family's own sanitized internal-error response.
 *
 * It is supplied per route rather than hard-coded here because the two families
 * have DIFFERENT public error contracts, and an error boundary that quietly
 * unified them would change what every existing client parses: Team routes
 * answer `'<kind>: <message>'` (docs/adr/0022 §Error Boundary Sanitization),
 * while the restricted-diagram route answers a single fixed sentence with
 * private/no-store cache headers.
 *
 * It must never embed a caught value.
 */
export type InternalErrorResponder = () => NextResponse;

/** Last resort if a route's own error responder is itself broken. Keeps the
 * boundary total: something must always come back. */
function fallbackInternalError(): NextResponse {
  return NextResponse.json(
    { error: "unexpected_error: Something went wrong. Please try again." },
    { status: 500, headers: { "Cache-Control": "private, no-store, max-age=0" } }
  );
}

export function withNativeCors(
  handler: (request: Request) => Promise<NextResponse>,
  internalError: InternalErrorResponder
): (request: Request) => Promise<NextResponse>;
export function withNativeCors<C>(
  handler: (request: Request, context: C) => Promise<NextResponse>,
  internalError: InternalErrorResponder
): (request: Request, context: C) => Promise<NextResponse>;
export function withNativeCors<C>(
  handler: (request: Request, context: C) => Promise<NextResponse>,
  internalError: InternalErrorResponder
): (request: Request, context: C) => Promise<NextResponse> {
  return async function handleWithCors(request: Request, context: C): Promise<NextResponse> {
    if (!isAcceptableRequestOrigin(request)) {
      return applyNativeCorsHeaders(
        NextResponse.json(
          { error: "forbidden: Origin not permitted." },
          { status: 403, headers: { "Cache-Control": "private, no-store, max-age=0" } }
        ),
        request
      );
    }

    // The await is guarded, and the guard covers the WHOLE handler execution —
    // including the parts no route body can wrap: constructing the Supabase
    // client, and awaiting Next's dynamic route context, both of which happen
    // before or outside a route's own try/catch.
    //
    // Without this, a rejection escapes the wrapper and the caller receives
    // whatever the framework produces, carrying NO `Access-Control-Allow-Origin`
    // header — so the browser refuses it and a native client cannot distinguish
    // a server fault from being blocked.
    let response: NextResponse;
    try {
      response = await handler(request, context);
    } catch (thrown) {
      // Only a stable label and one of `safeErrorCategory`'s hard-coded category
      // literals are logged — never a value read off the caught object, whose
      // message can embed a URL with a bearer token or a provider error carrying
      // row values (docs/adr/0022 §Sanitized Operational Logging). The thrown
      // value never reaches the response at all.
      console.error("route handler failed:", safeErrorCategory(thrown));
      try {
        response = internalError();
      } catch {
        response = fallbackInternalError();
      }
    }
    return applyNativeCorsHeaders(response, request);
  };
}
