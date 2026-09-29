# ADR-0047 — The configured native API origin boundary

**Status:** Accepted for implementation (Stage M2a). **Implemented in the application and
in the six Route Handlers; verified by automated tests only.** One independent review has
been performed and its findings corrected (the handler error boundary, and enforcing the
whitespace contract on the supplied value); **that correction has not itself been
independently re-reviewed.** The server change has **not been deployed**, and no on-device
request has been made. Nothing here is self-certification of acceptance.

**Date:** 2026-09-29

**Supersedes nothing. Narrows:** ADR-0025 Decision 20's wording (see *Reconciliation*).

---

## Context

`src/lib/supabase/authorizedFetch.ts` is the one module permitted to read the provider
access token (ADR-0025 Decision 20). It puts that token into exactly one `Authorization`
header, on a URL it has first proven to be:

1. produced by a hard-coded route table,
2. on **this app's own origin** (`window.location.origin`),
3. inside `/api/team/` or `/api/exercises/restricted-diagrams/`,
4. **exactly** the path the route table produced, and
5. free of any query or fragment.

Checks 1–5 run *before* the session is read, so a rejected request performs zero token
reads and zero fetches.

Stage M1 packages the same application into a Capacitor shell. A native build loads from a
local app scheme — `capacitor://localhost` on iOS, `https://localhost` on Android
(Capacitor 8 defaults; `capacitor.config.ts` declares no `server` block). Check 2 therefore
resolves to the app scheme, and every authorized request would be addressed to the WebView
itself, where no API exists.

Supabase traffic is unaffected: the SDK is constructed with an absolute configured URL and
never consults the document origin. **Only the `authorizedFetch.ts` boundary is affected.**

## Decision

**One explicitly configured API origin, resolved from trusted composition, with no
fallback.**

1. A new public build-time value, `NEXT_PUBLIC_NATIVE_API_ORIGIN`, whose exact contract is
   documented in `.env.example`. It must be a **canonical bare HTTPS origin**: no
   credentials, path, trailing slash, query, fragment, whitespace or control characters,
   and it must equal its own parsed origin, which also rejects an uppercase host and a
   spelled-out default port. There is deliberately **no http/localhost development
   exception** — a native app must never send a bearer token in the clear.

   **The value is checked as supplied, never trimmed first.** A leading or trailing space,
   tab, CR or LF makes it invalid, not merely tidied — otherwise the reviewed string and
   the value actually in use would be different strings, which is precisely the
   normalization surprise this contract excludes. A value that is *only* whitespace is
   classified as **absent**, which is fail-closed in the same way an empty one is.

2. The platform is selected by `Capacitor.getPlatform()`, which reports a platform only
   when the native runtime has injected its bridge object onto `window`. It is **not** a
   user-agent heuristic, a query parameter, a stored preference or anything a page, a deep
   link or a user can influence. An unrecognized native platform resolves to
   `unsupported_native` and **fails closed** rather than inheriting the Web fallback.

3. `resolveApiTarget()` combines the two into one immutable resolution per request:
   - **Web** → the document origin. Byte-identical to previous behaviour. A configured
     native value **does not retarget Web requests**.
   - **iOS / Android** → the configured origin.
   - anything unresolvable → `unavailable`, and the request denies **before the token is
     read**.

   There is no setter. Nothing at a call site, in a response, in a deep link or in storage
   can change the destination.

4. Native requests additionally use `credentials: "omit"` (this application authorizes with
   a bearer header, never a cookie) and `redirect: "error"` (a redirect would move the
   request to a destination that was never validated; there is no redirect discovery and no
   destination rewriting). Web keeps fetch's defaults unchanged.

5. Both production factories — the Team service **and** the restricted-asset resolver — are
   wired to the same resolver. ADR-0023's restricted delivery is currently dormant, but a
   dormant boundary must not be left pointing at the WebView origin.

6. **Server-side CORS**, narrowly scoped, on the five Team routes and the restricted-diagram
   route. The native origins are matched as **exact strings** against a two-entry allow-list;
   never via `new URL(origin).origin`, which reports `"null"` for a custom scheme and would
   collapse every opaque origin into one accepted value. `"null"`, wildcards, suffix and
   prefix matches and arbitrary reflected origins are refused. No
   `Access-Control-Allow-Credentials`, ever. `Vary: Origin` is merged, never assigned over
   an existing value.

7. **Every route handler runs inside an error boundary.** The wrapper's `await` is guarded,
   covering the whole handler execution — including the parts no route body can wrap:
   constructing the Supabase client, and awaiting Next's dynamic route context, both of
   which happen before or outside a route's own `try`. An unexpected rejection becomes a
   **sanitized HTTP 500 carrying the CORS grant**, so an allowed native caller can actually
   read it; without that the browser refuses the response and the app cannot tell a server
   fault apart from being blocked. Each route family supplies its **own** internal-error
   response, because their public contracts differ — Team routes answer
   `'<kind>: <message>'` (ADR-0022 §Error Boundary Sanitization), the restricted-diagram
   route answers one fixed sentence with private/no-store headers. The caught value is
   never embedded in the response; only a stable label and one of `safeErrorCategory`'s
   hard-coded literals is logged.

8. A request whose `Origin` this application does not serve is **refused before the handler
   body runs**. CORS alone would only hide the response from the page, leaving a mutation or
   an email send already performed. Accepted: no `Origin` header (unchanged server-to-server
   and non-browser callers), the request's own origin (ordinary same-origin Web — browsers
   send `Origin` on every POST), the configured `APP_ORIGIN` (a proxy can make the request's
   own origin an internal address; this only *reads* the existing value and changes no
   email-link semantics), and the exact native origins.

**Checks 1, 3, 4, 5 and the before-the-token ordering are unchanged.** Exactly one word in
check 2 is redefined: "this app's own origin" becomes "the one resolved API target, which on
Web *is* the document origin."

## Alternatives considered

- **`server.url` pointing the WebView at the deployed origin.** Rejected. Capacitor
  documents this as a live-reload facility, not a release mechanism. It would also convert
  every same-origin guarantee above into an accident of where the document happened to load
  from, and put the whole application behind network availability — a working-looking demo
  with a different security model.
- **Deriving the origin from the Supabase URL.** Rejected. They are different services that
  may live on different hosts; inferring one from the other invents a destination nobody
  configured.
- **Accepting a caller-supplied or response-supplied origin.** Rejected outright — that is
  the vulnerability this boundary exists to prevent.
- **A mutable global setter configured at startup.** Rejected. Any code that runs later
  could retarget every authorized request, and the window between startup and configuration
  would be a fail-open one.
- **Relaxing the client's origin check instead of adding server CORS.** Rejected. The
  browser engine enforces CORS; loosening the client would not make a cross-origin response
  readable, it would only remove a check.
- **Wildcard or credentialed CORS.** Rejected. A specific, non-wildcard entry is what the
  native origin needs, and cookies are not this application's authorization mechanism.
- **Letting an unexpected handler rejection fall through to the framework's default error
  response.** Rejected. That response carries no `Access-Control-Allow-Origin`, so a browser
  refuses to hand it to the page: the native client sees an opaque failure and cannot tell a
  server fault from being blocked by CORS — the two conditions with completely different
  remedies. It would also be the one response shape on these routes that no route family
  controls.
- **One shared internal-error response for all six routes.** Rejected. The two families have
  different public error contracts, and quietly unifying them would change what existing
  clients parse — a behaviour change smuggled in as an error-handling fix.
- **Trimming a configured origin before validating it.** Rejected, and corrected after
  review. It accepted values the documented contract prohibits and meant the reviewed string
  and the value in use could differ.

## Consequences

- The Web application is unchanged in behaviour. Configuring the native value affects
  nothing in a browser.
- A native build with missing or malformed configuration reaches the real identity gate and
  can sign in with email OTP (which talks to Supabase directly), but Team operations deny
  with a named, non-throwing outcome. That is deliberate: a silent fallback would be worse
  than a visible refusal.
- **The server change must reach the deployed backend before any on-device API call can
  succeed.** Local route tests prove the handlers; they prove nothing about the hosted
  server.
- The Android origin is **configuration only**. No Android project exists (Stage M5) and
  nothing here is hardware evidence.
- CORS grants no access. A matching `Origin` still faces every existing bearer verification,
  user-scoped client construction and RLS policy.

## Reconciliation with ADR-0025 Decision 20

Decision 20 says the access token is read by one helper and attached to requests "confined
to this app's own origin". That phrasing predates any native target. It is hereby read as:
**confined to the one resolved, validated API target — which on Web is the document origin,
and on native is the one configured HTTPS origin.** Every other property of Decision 20 —
one helper, one importer, one header, never returned or logged or stored, validated before
the token is read — is unchanged, and the architecture-boundary test that enforces them was
*strengthened* rather than relaxed: it now also pins that production supplies the real
resolver by name.

No other identity decision is affected. Native Google callbacks, the capture cell, startup
and continuation scheduling, the authentication browser and cancellation UX are **not**
addressed here and remain open (migration document §6, open decisions P4 and P7).

## Verification status

- **Automated:** the origin validator (including leading/trailing whitespace rejection), the
  platform signal, the target composition, the native request boundary, production
  composition per platform — including **zero session reads and zero fetches for an invalid
  configured origin**, for both the Team service and the restricted resolver — the CORS
  helper, all six routes' preflight/origin behaviour, and the **handler error boundary**
  exercised through the real route exports with a real SDK rejection, a rejected dynamic
  context, returned internal errors and non-`Error` thrown values. Synthetic origins and
  synthetic configuration throughout.
- **Not verified:** deployment of the server change; any real device request; Android
  anything.
