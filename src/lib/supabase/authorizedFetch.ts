// The ONE infrastructure helper permitted to read the provider session's
// access token (ADR-0025 Decision 20). The token is read here, put into the
// `Authorization` header of an already-validated same-origin Team or restricted-
// Exercise request, and
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
import type { RestrictedAssetResolver } from "../exercises/restrictedAssets";
import { isClosedBetaExerciseAssetId } from "../exercises/restrictedAssetCatalog";

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
function buildConfinedUrl(
  path: string,
  origin: string,
  requiredPrefix: string = TEAM_API_PREFIX
): URL | null {
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
  if (!url.pathname.startsWith(requiredPrefix)) return null;
  if (url.pathname !== path) return null;
  if (url.search !== "" || url.hash !== "") return null;
  return url;
}

function resolveDefaultOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location.origin;
  return typeof origin === "string" && origin.length > 0 && origin !== "null" ? origin : null;
}

async function readAccessToken(client: SupabaseClient): Promise<string | null> {
  try {
    const { data } = await client.auth.getSession();
    const accessToken = data?.session?.access_token;
    return typeof accessToken === "string" && accessToken.length > 0
      ? accessToken
      : null;
  } catch {
    return null;
  }
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
    const token = await readAccessToken(client);
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

const RESTRICTED_DIAGRAM_API_PREFIX =
  "/api/exercises/restricted-diagrams/";
const MAX_RESTRICTED_DIAGRAM_BYTES = 2_000_000;

function blobAsDataUrl(blob: Blob): Promise<string | null> {
  if (blob.size <= 0 || blob.size > MAX_RESTRICTED_DIAGRAM_BYTES) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = () =>
      resolve(
        typeof reader.result === "string" &&
          reader.result.startsWith("data:image/png;base64,")
          ? reader.result
          : null
      );
    try {
      reader.readAsDataURL(blob);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Builds the browser-side half of ADR-0023's resolver. The opaque id is
 * accepted only from the closed catalogue, the request is same-origin and
 * exact-path checked before the token is read, and image bytes are returned
 * only after the authenticated route authorizes the configured Team.
 */
export function createAuthorizedRestrictedAssetResolver(
  client: SupabaseClient,
  overrides: AuthorizedFetchOverrides = {}
): RestrictedAssetResolver {
  return {
    async resolveRestrictedAsset(reference, distribution) {
      if (
        distribution.scope !== "restricted-closed-beta" ||
        distribution.publicDeliveryPermitted !== false ||
        !isClosedBetaExerciseAssetId(reference.assetId)
      ) {
        return null;
      }

      const path = `${RESTRICTED_DIAGRAM_API_PREFIX}${reference.assetId}`;
      const origin = overrides.origin ?? resolveDefaultOrigin();
      if (origin === null) return null;

      const url = buildConfinedUrl(
        path,
        origin,
        RESTRICTED_DIAGRAM_API_PREFIX
      );
      if (url === null) return null;

      const token = await readAccessToken(client);
      if (token === null) return null;

      try {
        const response = await (overrides.fetchImpl ?? fetch)(url.toString(), {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!response.ok) return null;
        if (response.headers.get("content-type") !== "image/png") return null;
        const src = await blobAsDataUrl(await response.blob());
        return src === null ? null : { src };
      } catch {
        return null;
      }
    },
  };
}
