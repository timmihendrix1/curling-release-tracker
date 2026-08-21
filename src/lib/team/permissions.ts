// The one canonical Team permission matrix — see
// docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md's Team Foundation permission
// matrix section (kept in sync with this file; do not fork a second copy of these
// rules into a document). Every function here is pure and total: given an actor's
// current membership/function state in one team, it says whether one action is
// permitted. This is domain logic, not the security boundary — Postgres RLS and the
// SECURITY DEFINER RPCs (docs/adr/0022) re-derive and enforce the same rules
// server-side from the caller's authenticated identity; this module exists so the UI
// can render honestly (show/hide controls) and so the rule set has exactly one
// place to read, not two that could quietly drift apart (requirement 46: frontend
// hiding is never the permission boundary).

import type { TeamFunction, TeamMembership, TeamStatus } from "./types";

export type TeamActorContext = {
  /** The actor's own membership row for this team, or null if they have never been a
   * member. An ended membership (left/removed) is a real, non-null value here — "was a
   * member" and "never a member" are deliberately distinct, since former members retain
   * historical visibility (requirement 15) but no current access (requirement 80). */
  membership: TeamMembership | null;
  /** The actor's currently-active functions in this team. Always `[]` for a
   * non-member or an ended membership. */
  functions: readonly TeamFunction[];
  teamStatus: TeamStatus;
};

export type TeamAction =
  | "view_team"
  | "view_roster"
  | "view_member_emails"
  | "rename_team"
  | "manage_invitations"
  | "change_participation"
  | "assign_direct_function"
  | "remove_direct_function"
  | "request_admin_promotion"
  | "view_admin_requests"
  | "revoke_admin_request"
  | "remove_admin_function"
  | "remove_member"
  | "archive_team"
  | "restore_team"
  | "leave_team"
  | "relinquish_own_admin";

function isActiveMember(context: TeamActorContext): boolean {
  return context.membership !== null && context.membership.status === "active";
}

function isActiveAdmin(context: TeamActorContext): boolean {
  return isActiveMember(context) && context.functions.includes("team_admin");
}

/** Actions available to any active member, regardless of function. */
const MEMBER_ACTIONS: ReadonlySet<TeamAction> = new Set<TeamAction>([
  "view_team",
  "view_roster",
  "leave_team",
]);

/** Actions that require the active Team Admin function (requirement 41). `restore_team`
 * is handled by its own explicit branch below, not this set, since it is the one
 * action whose permission depends on `teamStatus` in the opposite direction from
 * every other admin action (only permitted WHILE archived, per docs/TEAM_FOUNDATION_
 * AND_ADMINISTRATION_BETA_SPECIFICATION.md §11). */
const ADMIN_ONLY_ACTIONS: ReadonlySet<TeamAction> = new Set<TeamAction>([
  "view_member_emails",
  "rename_team",
  "manage_invitations",
  "change_participation",
  "assign_direct_function",
  "remove_direct_function",
  "request_admin_promotion",
  "view_admin_requests",
  "revoke_admin_request",
  "remove_admin_function",
  "remove_member",
  "archive_team",
]);

/** Admin-only actions that also require the Team to be `"active"` — every collaborative
 * write that touches the roster, functions, invitations, or Admin Requests of OTHER
 * members. Archiving suspends exactly these (spec §11: "ordinary collaborative
 * writes, including roster changes and new invitations"); reads (`view_member_emails`,
 * `view_admin_requests`) and the two safe, self-directed/idempotent-cleanup actions
 * (`revoke_admin_request`, `relinquish_own_admin` — handled separately below) remain
 * available on an archived Team, matching the corresponding RPCs'
 * `private.assert_team_active` calls (or deliberate absence of one). */
const REQUIRES_ACTIVE_TEAM: ReadonlySet<TeamAction> = new Set<TeamAction>([
  "rename_team",
  "manage_invitations",
  "change_participation",
  "assign_direct_function",
  "remove_direct_function",
  "request_admin_promotion",
  "remove_admin_function",
  "remove_member",
  "archive_team",
]);

/**
 * Whether `action` is permitted for the given actor context. This function alone
 * decides role-based capability — it does NOT enforce the last-active-Team-Admin
 * invariant (requirement 44), which depends on information beyond one actor's own
 * context (how many *other* active admins currently exist) and lives in
 * `lastAdminInvariant.ts` instead. A caller performing `remove_admin_function`,
 * `relinquish_own_admin`, `remove_member` (when the target is an admin), or
 * `leave_team` (when the actor is an admin) must check both this function AND the
 * last-admin invariant before proceeding.
 *
 * `teamStatus` materially participates in this decision (spec §11): a `"recovery"`
 * Team suspends every administrative and collaborative write — only reads and
 * leaving remain available to an existing active member, and no ordinary caller can
 * ever be `isActiveAdmin` for a Team actually in recovery in practice (recovery is
 * only reachable by first losing every active admin), so no admin-only action can
 * ever be reached through this branch regardless. An `"archived"` Team narrows to
 * exactly `REQUIRES_ACTIVE_TEAM` above; `restore_team` is the one action gated the
 * opposite way, permitted only while archived.
 */
export function canPerformTeamAction(action: TeamAction, context: TeamActorContext): boolean {
  if (context.teamStatus === "recovery") {
    if (MEMBER_ACTIONS.has(action)) {
      return isActiveMember(context);
    }
    return false;
  }
  if (action === "restore_team") {
    return isActiveAdmin(context) && context.teamStatus === "archived";
  }
  if (action === "relinquish_own_admin") {
    return isActiveAdmin(context);
  }
  if (MEMBER_ACTIONS.has(action)) {
    return isActiveMember(context);
  }
  if (ADMIN_ONLY_ACTIONS.has(action)) {
    if (context.teamStatus === "archived" && REQUIRES_ACTIVE_TEAM.has(action)) {
      return false;
    }
    return isActiveAdmin(context);
  }
  return false;
}

/** Every action an admin-only action set entails, for exhaustive test coverage. */
export function listAdminOnlyActions(): TeamAction[] {
  return Array.from(ADMIN_ONLY_ACTIONS);
}

export function listMemberActions(): TeamAction[] {
  return Array.from(MEMBER_ACTIONS);
}

/** True once `functions` (all currently-active functions for a membership) includes
 * `team_admin` — used by callers that already have a plain function list rather than a
 * full `TeamActorContext` (e.g. rendering one roster row for someone other than the
 * caller). */
export function hasFunction(functions: readonly TeamFunction[], fn: TeamFunction): boolean {
  return functions.includes(fn);
}
