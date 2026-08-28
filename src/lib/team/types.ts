// Team Foundation domain types — see docs/adr/0022-team-foundation-domain-and-persistence.md
// and docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md §6/§17.2. These are the
// camelCase, application-facing shapes; the Supabase-backed TeamService
// (src/lib/supabase/supabaseTeamService.ts) is responsible for mapping snake_case rows
// onto these types — no consumer of TeamService ever sees a raw database row.
//
// Identity note (Team Foundation decision, superseding the contradictory
// "Profile ID equals auth user ID" language that existed before this feature):
// `Profile.id` is its own stable UUID, never the Supabase Auth user id. See
// docs/adr/0022 Decision 1.

export type ProfileId = string;
export type TeamId = string;
export type MembershipId = string;
export type FunctionAssignmentId = string;
export type InvitationId = string;
export type AdminRequestId = string;
export type NotificationId = string;

/** The three assignable, composable contextual functions in this beta. Team Captain is
 * deliberately not one of them — see docs/adr/0022 Decision 2. */
export type TeamFunction = "team_admin" | "coach" | "training_lead";

export const TEAM_FUNCTIONS: readonly TeamFunction[] = ["team_admin", "coach", "training_lead"];

/** The only two functions an admin assigns/removes directly on an EXISTING member
 * without that member's acceptance. This does not apply to a brand-new invitee, who
 * may be proposed `team_admin` as part of a complete invitation proposal and accept
 * all of it at once (see `InvitationProposal.proposedFunctions`, which allows any
 * `TeamFunction`) — for an already-active member specifically, Team Admin is only
 * ever gained through a separate request/acceptance flow (`TeamAdminRequest`) — see
 * docs/adr/0022 Decision 2/4. */
export type DirectlyAssignableFunction = "coach" | "training_lead";

export type Profile = {
  id: ProfileId;
  /** Null until the display-name bootstrap step (Decision 1) has run. Never derived
   * from the account's email address. */
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * `"recovery"` is the restricted state for the loss of the final Team Admin
 * (requirements 93-98) — see `recovery.ts`. No mutation path implemented in this beta
 * ever sets a team to `"recovery"` (it would require an account-deletion flow this
 * beta does not build); the value exists so the schema and the exit-condition helper
 * are ready for the narrowly-guarded operational entry path once that exists.
 */
export type TeamStatus = "active" | "archived" | "recovery";

export type Team = {
  id: TeamId;
  name: string;
  status: TeamStatus;
  createdByProfileId: ProfileId;
  createdAt: string;
  archivedAt: string | null;
  restoredAt: string | null;
};

export type MembershipStatus = "active" | "ended";
export type MembershipEndReason = "left" | "removed";

export type TeamMembership = {
  id: MembershipId;
  teamId: TeamId;
  profileId: ProfileId;
  status: MembershipStatus;
  participationAsPlayer: boolean;
  startedAt: string;
  endedAt: string | null;
  endReason: MembershipEndReason | null;
};

export type FunctionAssignmentStatus = "active" | "ended";

export type TeamFunctionAssignment = {
  id: FunctionAssignmentId;
  membershipId: MembershipId;
  function: TeamFunction;
  status: FunctionAssignmentStatus;
  startedAt: string;
  endedAt: string | null;
};

/** One composed roster row — what every active member is allowed to see about every
 * other active member (requirement 14). `email` is present only when the caller is a
 * Team Admin of this team (requirement 13/41) — its absence, not a redacted placeholder,
 * is how the UI/domain distinguishes "not authorized to see this" from "no email on
 * file" (there is always exactly one verified email per account). */
export type TeamRosterEntry = {
  membershipId: MembershipId;
  profileId: ProfileId;
  displayName: string | null;
  participationAsPlayer: boolean;
  functions: TeamFunction[];
  email?: string;
};

export type InvitationStatus = "pending" | "accepted" | "expired" | "revoked" | "replaced";

export type TeamInvitationEmailDeliveryStatus = "pending" | "sent" | "failed";

export type TeamInvitation = {
  id: InvitationId;
  teamId: TeamId;
  email: string;
  participationAsPlayer: boolean;
  proposedFunctions: TeamFunction[];
  /** The durably stored status. `"expired"` is derived, not necessarily eagerly
   * written — see `deriveInvitationStatus` in invitationLifecycle.ts. A stored value of
   * `"pending"` past its `expiresAt` must always be treated as effectively expired by
   * every reader (requirement 59). */
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  replacedByInvitationId: InvitationId | null;
  emailDeliveryStatus: TeamInvitationEmailDeliveryStatus;
};

export type AdminRequestStatus = "pending" | "accepted" | "revoked" | "replaced" | "expired";

export type TeamAdminRequest = {
  id: AdminRequestId;
  teamId: TeamId;
  /** The nominee's membership — a request always targets one existing, active
   * membership, never a bare profile or email (requirement 67: promoting an *existing
   * member*). */
  membershipId: MembershipId;
  status: AdminRequestStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  replacedByRequestId: AdminRequestId | null;
};

export type NotificationKind =
  | "admin_request"
  | "member_removed"
  | "team_exercise_result_changed";

export type AccountNotification = {
  id: NotificationId;
  profileId: ProfileId;
  kind: NotificationKind;
  payload: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
};

export const INVITATION_LIFETIME_DAYS = 14;
export const ADMIN_REQUEST_LIFETIME_DAYS = 14;
