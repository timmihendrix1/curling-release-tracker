// The restricted recovery state (requirements 93-98) — modeled so the schema/RPC
// layer and this pure helper agree on the exit condition, even though this beta has
// no implemented trigger that ever *enters* it (see docs/adr/0022 §Recovery: entering
// recovery is Prepared, not Implemented, because it depends on an account-deletion
// flow this beta does not build; exiting recovery is fully Implemented and testable
// once a team is placed into it by the narrowly-guarded operational path).
//
// Deliberately not part of `TeamService` — nominating a recovery successor is
// performed by a support/operational Postgres role that ordinary `authenticated`/
// `anon` browser sessions can never hold (requirement 98), so there is no
// browser-reachable method to add here. This module exists only to give the exit
// condition ("accepting the normal Admin Request ends recovery") one pure,
// unit-testable definition shared by the acceptAdminRequest RPC and the fake service.

import type { TeamStatus } from "./types";

/**
 * Accepting an Admin Request always clears a `"recovery"` status (requirement 96) —
 * once the nominee's Team Admin function is active, the zero-active-admin condition
 * that caused recovery no longer holds. A no-op for `"active"`/`"archived"`, so this
 * is safe to call unconditionally after every ordinary (non-recovery) admin-request
 * acceptance too.
 */
export function resolveTeamStatusAfterAdminRequestAccepted(currentStatus: TeamStatus): TeamStatus {
  return currentStatus === "recovery" ? "active" : currentStatus;
}
