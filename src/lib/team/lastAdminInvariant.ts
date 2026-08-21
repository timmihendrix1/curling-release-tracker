// The last-active-Team-Admin invariant (requirements 44, 73-75, 93-98) — kept as its
// own tiny module because it is orthogonal to `permissions.ts`'s role-based capability
// check: a lone active Team Admin *is* permitted to demote/remove/leave by role, but
// the action must still be blocked unless a successor already exists or the team is
// archived. Both the pure check here and the transactional row-locked re-check inside
// the Postgres RPCs (docs/adr/0022) must agree — this is the single source for the
// rule itself; the RPCs re-derive it from a `SELECT ... FOR UPDATE` count, never trust
// a client-supplied count.

import type { TeamStatus } from "./types";

export type LastAdminInvariantCheck = {
  /** Count of *other* active Team Admins, excluding the one being
   * demoted/removed/leaving. */
  otherActiveAdminCount: number;
  teamStatus: TeamStatus;
};

/**
 * Returns true when performing the action (relinquish own admin, remove another
 * admin's Team Admin function, remove/leave a membership that currently holds Team
 * Admin) would leave an active team with zero active Team Admins. An archived team is
 * explicitly exempt (requirement 44: "...unless the team is archived") — administration
 * is already suspended for an archived team, so there is no live "must have an admin"
 * requirement to protect.
 */
export function wouldViolateLastAdminInvariant(check: LastAdminInvariantCheck): boolean {
  if (check.teamStatus === "archived") return false;
  return check.otherActiveAdminCount < 1;
}

/** A successor only counts once their Admin Request has been accepted (requirement
 * 74) — a merely pending request must never be treated as satisfying this invariant.
 * This function takes the count of already-active admins directly; it deliberately has
 * no "pending requests" parameter at all, so a future caller cannot accidentally wire
 * one in. */
export function canRelinquishOrRemoveLastAdmin(check: LastAdminInvariantCheck): boolean {
  return !wouldViolateLastAdminInvariant(check);
}
