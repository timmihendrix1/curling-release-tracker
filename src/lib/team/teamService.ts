// The TeamService application boundary (requirement 154). UI and other domain code
// depend only on this interface — never on `@supabase/supabase-js` directly
// (requirement 155, enforced by the architecture-boundary test). Every method
// resolves to a `TeamResult<T>` and never throws/rejects for an ordinary domain
// failure (requirement 23). `src/lib/team/fakeTeamService.ts` is the injected fake
// used by tests and component stories; `src/lib/supabase/supabaseTeamService.ts` is
// the one production implementation, calling Postgres RPCs for every protected
// mutation (requirement 130/131).

import type { TeamResult } from "./errors";
import type {
  AccountNotification,
  AdminRequestId,
  DirectlyAssignableFunction,
  InvitationId,
  MembershipId,
  NotificationId,
  Profile,
  Team,
  TeamFunction,
  TeamId,
  TeamInvitation,
  TeamAdminRequest,
  TeamRosterEntry,
} from "./types";

export type TeamSummary = {
  team: Team;
  myMembershipId: MembershipId;
  myParticipationAsPlayer: boolean;
  myFunctions: TeamFunction[];
};

export type TeamWorkspace = {
  team: Team;
  myMembershipId: MembershipId;
  myFunctions: TeamFunction[];
  myParticipationAsPlayer: boolean;
  isAdmin: boolean;
  /** Compact roster visible to every active member (requirement 103). `email` is
   * populated on every entry only when `isAdmin` is true — see `TeamRosterEntry`. */
  roster: TeamRosterEntry[];
};

export type CreateTeamInput = {
  name: string;
  participationAsPlayer: boolean;
  /** Team Admin is granted to the creator automatically (requirement 19) and is never
   * part of this input — only the two directly-assignable functions may be self-set
   * at creation time (requirement 21). */
  functions: DirectlyAssignableFunction[];
};

export type InvitationProposal = {
  email: string;
  participationAsPlayer: boolean;
  proposedFunctions: TeamFunction[];
};

export type EmailSendOutcome = { emailSent: boolean };

/**
 * Only ever called once a user is authenticated — the "generic state before
 * authentication" the UI must show for an unopened invitation link (requirement 164)
 * is a purely presentational state the UI renders on its own, without calling this
 * method at all, so the service boundary never has to reason about an anonymous
 * caller inspecting someone else's invitation.
 */
export type InvitationPreview =
  | {
      status: "ready_to_accept";
      teamName: string;
      inviterDisplayName: string | null;
      participationAsPlayer: boolean;
      proposedFunctions: TeamFunction[];
    }
  | { status: "denied"; reason: "expired" | "revoked" | "replaced" | "already_accepted" | "wrong_email" }
  | { status: "invalid_token" };

export interface TeamService {
  // Profile bootstrap (requirements 1-13)
  getMyProfile(): Promise<TeamResult<Profile | null>>;
  bootstrapProfile(displayName: string): Promise<TeamResult<Profile>>;
  hasPilotTeamCreationCapability(): Promise<TeamResult<boolean>>;

  // Teams (requirements 15-34, 99-108, 162, 168)
  listMyTeams(): Promise<TeamResult<TeamSummary[]>>;
  createTeam(input: CreateTeamInput): Promise<TeamResult<TeamWorkspace>>;
  getTeamWorkspace(teamId: TeamId): Promise<TeamResult<TeamWorkspace>>;
  renameTeam(teamId: TeamId, name: string): Promise<TeamResult<void>>;
  archiveTeam(teamId: TeamId): Promise<TeamResult<void>>;
  restoreTeam(teamId: TeamId): Promise<TeamResult<void>>;

  // Membership / function administration (requirements 26-46, 165-166)
  setParticipation(
    teamId: TeamId,
    membershipId: MembershipId,
    participationAsPlayer: boolean
  ): Promise<TeamResult<void>>;
  assignDirectFunction(
    teamId: TeamId,
    membershipId: MembershipId,
    fn: DirectlyAssignableFunction
  ): Promise<TeamResult<void>>;
  removeDirectFunction(
    teamId: TeamId,
    membershipId: MembershipId,
    fn: DirectlyAssignableFunction
  ): Promise<TeamResult<void>>;
  removeAdminFunction(teamId: TeamId, membershipId: MembershipId): Promise<TeamResult<void>>;
  relinquishOwnAdmin(teamId: TeamId): Promise<TeamResult<void>>;
  removeMember(
    teamId: TeamId,
    membershipId: MembershipId
  ): Promise<TeamResult<{ notificationEmailSent: boolean }>>;
  leaveTeam(teamId: TeamId): Promise<TeamResult<void>>;

  // Invitations (requirements 47-66, 163-164, 168)
  listInvitations(teamId: TeamId): Promise<TeamResult<TeamInvitation[]>>;
  createInvitation(
    teamId: TeamId,
    proposal: InvitationProposal
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>>;
  reviseInvitation(
    invitationId: InvitationId,
    proposal: InvitationProposal
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>>;
  resendInvitation(
    invitationId: InvitationId
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>>;
  revokeInvitation(invitationId: InvitationId): Promise<TeamResult<void>>;
  previewInvitation(rawToken: string): Promise<TeamResult<InvitationPreview>>;
  acceptInvitation(rawToken: string): Promise<TeamResult<{ teamId: TeamId }>>;

  // Admin responsibility requests (requirements 67-75, 165-166)
  listAdminRequestsForMe(): Promise<TeamResult<Array<TeamAdminRequest & { teamName: string }>>>;
  /** The Team-side view — an active Team Admin's outstanding (effectively pending)
   * requests for ONE team, distinct from the nominee inbox above (docs/adr/0022
   * §Team-Side Admin Request Read Model). Never includes another team's requests. */
  listAdminRequestsForTeam(teamId: TeamId): Promise<TeamResult<TeamAdminRequest[]>>;
  createAdminRequest(
    teamId: TeamId,
    membershipId: MembershipId
  ): Promise<TeamResult<{ request: TeamAdminRequest } & EmailSendOutcome>>;
  revokeAdminRequest(requestId: AdminRequestId): Promise<TeamResult<void>>;
  acceptAdminRequest(requestId: AdminRequestId): Promise<TeamResult<void>>;

  // Notifications (requirement 169)
  listNotifications(): Promise<TeamResult<AccountNotification[]>>;
  acknowledgeNotification(notificationId: NotificationId): Promise<TeamResult<void>>;
}
