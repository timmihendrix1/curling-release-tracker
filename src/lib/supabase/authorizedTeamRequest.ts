// The SDK-free contract for the small set of authorized requests this app
// makes to its OWN Next.js Route Handlers under /api/team/ (ADR-0025
// Decision 20; docs/adr/0022 Decision 11 for why those five mutations go
// through a route at all — each must perform its RPC *and* send an email
// server-side).
//
// This module deliberately contains no `@supabase/supabase-js` import, no
// `fetch`, no session read and no path construction. `SupabaseTeamService`
// depends only on what is here, which is what makes "the bearer token is read
// in exactly one infrastructure helper" a checkable property rather than a
// convention: the service cannot reach a token or build a URL even by
// accident, because neither is in scope.

/**
 * The closed route set. A route is named by what it does, not by a path —
 * callers never construct, concatenate, or pass a path, so no caller-supplied
 * string can widen the set of reachable endpoints. The mapping from these
 * five cases to hard-coded paths lives in authorizedFetch.ts.
 */
export type TeamApiRoute =
  | { kind: "createInvitation" }
  | { kind: "reviseInvitation"; invitationId: string }
  | { kind: "resendInvitation"; invitationId: string }
  | { kind: "createAdminRequest" }
  | { kind: "removeMember" };

/**
 * The closed outcome set.
 *
 * `response` carries the **genuine** `Response` the transport produced. No
 * outcome here fabricates a `Response` to encode an authorization or transport
 * failure: a synthesized 401/403 would be indistinguishable, to every caller,
 * from one the server actually sent.
 */
export type AuthorizedRequestOutcome =
  /** The request was made and the server answered. Status and body are the
   * caller's to interpret. */
  | { kind: "response"; response: Response }
  /** Denied before transport: the route or its URL failed validation, the body
   * could not be serialized, or no usable session/token could be read. Zero
   * fetches were performed. */
  | { kind: "forbidden" }
  /** The request was attempted and the transport itself failed. */
  | { kind: "network_error" };

/**
 * One authorized POST to one of the five closed routes. Resolves — never
 * rejects — for every expected failure.
 */
export type AuthorizedTeamRequest = (
  route: TeamApiRoute,
  body: unknown
) => Promise<AuthorizedRequestOutcome>;
