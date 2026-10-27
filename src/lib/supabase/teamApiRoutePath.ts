// Closed pure route mapping shared by Web and the dormant native host.
// No session, token, URL target, fetch or mutable configuration lives here.
import type { TeamApiRoute } from "./authorizedTeamRequest";
import { hasWhitespaceOrControl } from "./supabaseCallbackClassifier";

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
export function resolveTeamApiRoutePath(route: TeamApiRoute): string | null {
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
