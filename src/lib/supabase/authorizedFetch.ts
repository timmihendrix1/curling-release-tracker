// The ONE infrastructure helper permitted to read the provider session's
// access token (ADR-0025 Decision 20). The token is read here, put into the
// `Authorization` header of an already-validated same-origin request, and
// nowhere else: it is never returned, logged, snapshotted, serialized, stored,
// or handed to a caller. `teamServiceFactory.ts` is the only production module
// that value-imports this file — enforced by
// src/lib/persistence/__tests__/architectureBoundary.test.ts.
//
// This file deliberately does NOT import "@supabase/supabase-js" — it only
// names the client's TYPE via supabaseClient.ts's re-export, the same way
// supabaseTeamService.ts does.
import type { SupabaseClient } from "./supabaseClient";
import { hasWhitespaceOrControl } from "./supabaseCallbackClassifier";
import type {
  AuthorizedRequestOutcome,
  AuthorizedTeamRequest,
  TeamApiRoute,
} from "./authorizedTeamRequest";

/** Every authorized request is confined to this prefix on this app's own
 * origin. Validated after construction, not merely assumed from the hard-coded
 * literals below. */
const TEAM_API_PREFIX = "/api/team/";

/** Test-only seams. The production construction in teamServiceFactory.ts
 * passes none of these. */
export type AuthorizedFetchOverrides = {
  fetchImpl?: typeof fetch;
  origin?: string;
};

/**
 * A dynamic path segment is rejected outright — before any URL is built —
 * unless it is an ordinary, non-empty token. `.` and `..` are refused by name:
 * `encodeURIComponent` does not encode a dot, so a segment of exactly `..`
 * would survive into the path and `new URL` would then normalize it away,
 * silently retargeting the request one level up. Every other traversal attempt
 * (`../x`, `a/b`, `?x`, `#x`) is neutralized by percent-encoding, and the
 * exact-path comparison below catches anything this misses.
 */
function isUsablePathSegment(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 200) return false;
  if (hasWhitespaceOrControl(value)) return false;
  return value !== "." && value !== "..";
}

/** The hard-coded route table. Nothing outside this function decides what path
 * an authorized request may reach. */
function resolveRoutePath(route: TeamApiRoute): string | null {
  switch (route.kind) {
    case "createInvitation":
      return "/api/team/invitations";
    case "reviseInvitation":
      return isUsablePathSegment(route.invitationId)
        ? `/api/team/invitations/${encodeURIComponent(route.invitationId)}/revise`
        : null;
    case "resendInvitation":
      return isUsablePathSegment(route.invitationId)
        ? `/api/team/invitations/${encodeURIComponent(route.invitationId)}/resend`
        : null;
    case "createAdminRequest":
      return "/api/team/admin-requests";
    case "removeMember":
      return "/api/team/members/remove";
    default:
      // Unreachable for a well-typed caller; a value arriving from untyped
      // JavaScript or a future unhandled case denies rather than guesses.
      return null;
  }
}

/**
 * Builds the final URL and proves it is same-origin, confined to
 * `/api/team/`, and **exactly** the path the route table produced. That last
 * comparison is the load-bearing check: if any traversal, normalization, or
 * encoding surprise changed the path, the built URL no longer equals the
 * intended literal and the request is denied instead of sent somewhere else.
 */
function buildConfinedUrl(path: string, origin: string): URL | null {
  let expectedOrigin: URL;
  try {
    expectedOrigin = new URL(origin);
  } catch {
    return null;
  }
  let url: URL;
  try {
    url = new URL(path, expectedOrigin);
  } catch {
    return null;
  }
  if (url.origin !== expectedOrigin.origin) return null;
  if (!url.pathname.startsWith(TEAM_API_PREFIX)) return null;
  if (url.pathname !== path) return null;
  if (url.search !== "" || url.hash !== "") return null;
  return url;
}

function resolveDefaultOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location.origin;
  return typeof origin === "string" && origin.length > 0 && origin !== "null" ? origin : null;
}

/**
 * Creates the one authorized-request helper.
 *
 * Ordering is a security property, not a style choice: the route and the final
 * URL are validated **before** the session is read, so a rejected route
 * performs zero session reads and zero fetches.
 */
export function createAuthorizedTeamRequest(
  client: SupabaseClient,
  overrides: AuthorizedFetchOverrides = {}
): AuthorizedTeamRequest {
  const fetchImpl = overrides.fetchImpl;
  const configuredOrigin = overrides.origin;

  return async function authorizedTeamRequest(
    route: TeamApiRoute,
    body: unknown
  ): Promise<AuthorizedRequestOutcome> {
    const path = resolveRoutePath(route);
    if (path === null) return { kind: "forbidden" };

    const origin = configuredOrigin ?? resolveDefaultOrigin();
    if (origin === null) return { kind: "forbidden" };

    const url = buildConfinedUrl(path, origin);
    if (url === null) return { kind: "forbidden" };

    // Serialized before the session is read, so an unserializable body also
    // denies without touching a token.
    let payload: string;
    try {
      payload = JSON.stringify(body ?? {});
    } catch {
      return { kind: "forbidden" };
    }

    // The one and only place the access token is read.
    let token: string | null = null;
    try {
      const { data } = await client.auth.getSession();
      const accessToken = data?.session?.access_token;
      token = typeof accessToken === "string" && accessToken.length > 0 ? accessToken : null;
    } catch {
      // A session-lookup failure is treated exactly like "not signed in":
      // authorization cannot be proven, so the request is not made. The raw
      // failure is not surfaced, logged, or distinguishable from absence.
      return { kind: "forbidden" };
    }
    if (token === null) return { kind: "forbidden" };

    const doFetch = fetchImpl ?? fetch;
    try {
      const response = await doFetch(url.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Crosses exactly this one boundary, on a URL already proven
          // same-origin and prefix-confined.
          Authorization: `Bearer ${token}`,
        },
        body: payload,
      });
      return { kind: "response", response };
    } catch {
      return { kind: "network_error" };
    }
  };
}
