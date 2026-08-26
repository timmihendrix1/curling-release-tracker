// The one production TeamService implementation (requirement 154). Deliberately
// does NOT import "@supabase/supabase-js" itself — it only names the client's TYPE
// via supabaseClient.ts's re-export, and receives an already-constructed client
// (the same one AccountControl/useSupabaseAuthController use) through its
// constructor, so there is exactly one Supabase client instance per signed-in
// session (requirement 115).
//
// Reads go straight through RLS-scoped `select` queries. Every mutation goes
// through a Postgres RPC (never a raw `.insert()`/`.update()`/`.delete()` on a
// protected table — requirement 130); the five mutations that must also send an
// email (create/revise/resend invitation, create admin request, remove member) are
// instead sent to this app's own Next.js Route Handlers under `/api/team/`, which
// perform the RPC AND the email send server-side, then report back an honest
// `emailSent` outcome (requirements 139-147). Every method resolves a
// `TeamResult<T>` — never throws (requirement 23).
//
// Those five requests go through the injected `AuthorizedTeamRequest`
// (authorizedTeamRequest.ts — an SDK-free, fetch-free contract), naming a route
// from a closed set rather than building a path. This file therefore reads no
// access token, constructs no URL, and calls no `fetch`: the token is read in
// exactly one infrastructure helper (authorizedFetch.ts), on a request already
// validated same-origin and confined to `/api/team/` (ADR-0025 Decision 20).
import type { SupabaseClient } from "./supabaseClient";
import type { AuthorizedTeamRequest, TeamApiRoute } from "./authorizedTeamRequest";
import { parsePostgresErrorMessage } from "../team/postgresErrorMapping";
import { teamOk, teamFailed, type TeamResult } from "../team/errors";
import { deriveInvitationStatus } from "../team/invitationLifecycle";
import { deriveAdminRequestStatus } from "../team/adminRequestLifecycle";
import type {
  AccountNotification,
  AdminRequestId,
  DirectlyAssignableFunction,
  InvitationId,
  MembershipId,
  NotificationId,
  Profile,
  Team,
  TeamAdminRequest,
  TeamFunction,
  TeamId,
  TeamInvitation,
  TeamRosterEntry,
} from "../team/types";
import type {
  CreateTeamInput,
  EmailSendOutcome,
  InvitationPreview,
  InvitationProposal,
  TeamService,
  TeamSummary,
  TeamWorkspace,
} from "../team/teamService";

type PostgrestLikeError = { message: string } | null;

function fail<T>(error: PostgrestLikeError): TeamResult<T> {
  const { kind, message } = parsePostgresErrorMessage(error?.message);
  return teamFailed(kind, message);
}

function mapProfileRow(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    displayName: (row.display_name as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function mapTeamRow(row: Record<string, unknown>): Team {
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as Team["status"],
    createdByProfileId: row.created_by_profile_id as string,
    createdAt: row.created_at as string,
    archivedAt: (row.archived_at as string | null) ?? null,
    restoredAt: (row.restored_at as string | null) ?? null,
  };
}

/** Every reader normalizes effective status at the read boundary (docs/adr/0022
 * §Effective Status Normalization) — a stored 'pending' row past its own
 * `expiresAt` is never mapped/returned as 'pending', using the same
 * `deriveInvitationStatus` helper the domain layer and its tests already treat as
 * canonical, so no divergent status logic exists in this file or in any component
 * that reads this shape. */
function mapInvitationRow(row: Record<string, unknown>): TeamInvitation {
  const invitation: TeamInvitation = {
    id: row.id as string,
    teamId: row.team_id as string,
    email: row.email as string,
    participationAsPlayer: row.participation_as_player as boolean,
    proposedFunctions: (row.proposed_functions as TeamFunction[]) ?? [],
    status: row.status as TeamInvitation["status"],
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    replacedByInvitationId: (row.replaced_by_invitation_id as string | null) ?? null,
    emailDeliveryStatus: row.email_delivery_status as TeamInvitation["emailDeliveryStatus"],
  };
  return { ...invitation, status: deriveInvitationStatus(invitation, new Date()) };
}

/** Exported for the API route handlers too — see mapInvitationCreatedRow's comment.
 * Same effective-status normalization as mapInvitationRow above. */
export function mapAdminRequestRow(row: Record<string, unknown>): TeamAdminRequest {
  const request: TeamAdminRequest = {
    id: row.id as string,
    teamId: row.team_id as string,
    membershipId: row.membership_id as string,
    status: row.status as TeamAdminRequest["status"],
    createdAt: row.created_at as string,
    expiresAt: row.expires_at as string,
    acceptedAt: (row.accepted_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
    replacedByRequestId: (row.replaced_by_request_id as string | null) ?? null,
  };
  return { ...request, status: deriveAdminRequestStatus(request, new Date()) };
}

function mapNotificationRow(row: Record<string, unknown>): AccountNotification {
  return {
    id: row.id as string,
    profileId: row.profile_id as string,
    kind: row.kind as AccountNotification["kind"],
    payload: (row.payload as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    readAt: (row.read_at as string | null) ?? null,
  };
}

/** Extracted for the API route request bodies too — both the browser-direct RPC
 * path and the server-route path need the same normalized `{invitation,
 * emailSent}`/`{request, emailSent}` shape. */
export function mapInvitationCreatedRow(row: { invitation: Record<string, unknown>; raw_token: string }): {
  invitation: TeamInvitation;
  rawToken: string;
} {
  return { invitation: mapInvitationRow(row.invitation), rawToken: row.raw_token };
}

export class SupabaseTeamService implements TeamService {
  constructor(
    private readonly client: SupabaseClient,
    /** The one authorized-request helper for this app's own `/api/team/` Route
     * Handlers. Injected rather than constructed here so this file never reaches
     * a session, a token, or a URL. */
    private readonly authorizedRequest: AuthorizedTeamRequest
  ) {}

  private async postToRoute<T>(route: TeamApiRoute, body: unknown): Promise<TeamResult<T>> {
    const outcome = await this.authorizedRequest(route, body);
    if (outcome.kind === "forbidden") {
      return teamFailed("forbidden", "You must be signed in.");
    }
    if (outcome.kind === "network_error") {
      return teamFailed("network_error", "Could not reach the server. Check your connection and try again.");
    }
    const response = outcome.response;
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return teamFailed("unexpected_error", "Something went wrong. Please try again.");
    }
    if (!response.ok) {
      const errorMessage = typeof json === "object" && json !== null && "error" in json ? String((json as { error: unknown }).error) : null;
      return fail({ message: errorMessage ?? "" });
    }
    return teamOk(json as T);
  }

  async getMyProfile(): Promise<TeamResult<Profile | null>> {
    const { data, error } = await this.client.rpc("get_my_profile");
    if (error) return fail(error);
    if (!data) return teamOk(null);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || row.id == null) return teamOk(null);
    return teamOk(mapProfileRow(row));
  }

  async bootstrapProfile(displayName: string): Promise<TeamResult<Profile>> {
    const { data, error } = await this.client.rpc("bootstrap_profile", { p_display_name: displayName });
    if (error) return fail(error);
    const row = Array.isArray(data) ? data[0] : data;
    return teamOk(mapProfileRow(row));
  }

  async hasPilotTeamCreationCapability(): Promise<TeamResult<boolean>> {
    const { data, error } = await this.client.rpc("has_pilot_team_creation_capability");
    if (error) return fail(error);
    return teamOk(Boolean(data));
  }

  async listMyTeams(): Promise<TeamResult<TeamSummary[]>> {
    const { data, error } = await this.client
      .from("team_memberships")
      .select("id, participation_as_player, teams(*), team_membership_functions(function, status)")
      .eq("status", "active");
    if (error) return fail(error);
    const summaries: TeamSummary[] = (data ?? []).map((row: Record<string, unknown>) => {
      const functions = ((row.team_membership_functions as Array<{ function: TeamFunction; status: string }>) ?? [])
        .filter((f) => f.status === "active")
        .map((f) => f.function);
      return {
        team: mapTeamRow(row.teams as Record<string, unknown>),
        myMembershipId: row.id as string,
        myParticipationAsPlayer: row.participation_as_player as boolean,
        myFunctions: functions,
      };
    });
    return teamOk(summaries);
  }

  async createTeam(input: CreateTeamInput): Promise<TeamResult<TeamWorkspace>> {
    const { data, error } = await this.client.rpc("create_team", {
      p_name: input.name,
      p_participation_as_player: input.participationAsPlayer,
      p_functions: input.functions,
    });
    if (error) return fail(error);
    const teamRow = Array.isArray(data) ? data[0] : data;
    const team = mapTeamRow(teamRow);
    return this.getTeamWorkspace(team.id);
  }

  async getTeamWorkspace(teamId: TeamId): Promise<TeamResult<TeamWorkspace>> {
    const { data: teamRow, error: teamError } = await this.client.from("teams").select("*").eq("id", teamId).maybeSingle();
    if (teamError) return fail(teamError);
    if (!teamRow) return teamFailed("not_found", "Team not found.");

    const myProfileResult = await this.getMyProfile();
    if (!myProfileResult.ok) return myProfileResult;
    if (!myProfileResult.value) return teamFailed("forbidden", "Profile not found.");
    const myProfile = myProfileResult.value;

    const { data: membershipRows, error: membershipError } = await this.client
      .from("team_memberships")
      .select("id, profile_id, participation_as_player, status, team_membership_functions(function, status)")
      .eq("team_id", teamId)
      .eq("status", "active");
    if (membershipError) return fail(membershipError);

    const myRow = (membershipRows ?? []).find((row: Record<string, unknown>) => row.profile_id === myProfile.id);
    if (!myRow) return teamFailed("forbidden", "You are not an active member of this team.");

    const myFunctions = ((myRow.team_membership_functions as Array<{ function: TeamFunction; status: string }>) ?? [])
      .filter((f) => f.status === "active")
      .map((f) => f.function);
    const isAdmin = myFunctions.includes("team_admin");

    let emailByProfileId = new Map<string, string>();
    if (isAdmin) {
      const { data: emailRows, error: emailError } = await this.client.rpc("get_team_member_emails", { p_team_id: teamId });
      if (emailError) return fail(emailError);
      const membershipIdToProfileId = new Map(
        (membershipRows ?? []).map((row: Record<string, unknown>) => [row.id as string, row.profile_id as string])
      );
      emailByProfileId = new Map(
        (emailRows ?? [])
          .map((row: { membership_id: string; email: string }): [string, string] | null => {
            const profileId = membershipIdToProfileId.get(row.membership_id);
            return profileId ? [profileId, row.email] : null;
          })
          .filter((entry: [string, string] | null): entry is [string, string] => entry !== null)
      );
    }

    const { data: profileRows, error: profilesError } = await this.client
      .from("profiles")
      .select("id, display_name")
      .in("id", (membershipRows ?? []).map((row: Record<string, unknown>) => row.profile_id as string));
    if (profilesError) return fail(profilesError);
    const displayNameByProfileId = new Map(
      (profileRows ?? []).map((row: Record<string, unknown>) => [row.id as string, row.display_name as string | null])
    );

    const roster: TeamRosterEntry[] = (membershipRows ?? []).map((row: Record<string, unknown>) => {
      const functions = ((row.team_membership_functions as Array<{ function: TeamFunction; status: string }>) ?? [])
        .filter((f) => f.status === "active")
        .map((f) => f.function);
      const profileId = row.profile_id as string;
      const entry: TeamRosterEntry = {
        membershipId: row.id as string,
        profileId,
        displayName: displayNameByProfileId.get(profileId) ?? null,
        participationAsPlayer: row.participation_as_player as boolean,
        functions,
      };
      if (isAdmin) {
        entry.email = emailByProfileId.get(profileId);
      }
      return entry;
    });

    return teamOk({
      team: mapTeamRow(teamRow),
      myMembershipId: myRow.id as string,
      myFunctions,
      myParticipationAsPlayer: myRow.participation_as_player as boolean,
      isAdmin,
      roster,
    });
  }

  async renameTeam(teamId: TeamId, name: string): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("rename_team", { p_team_id: teamId, p_name: name });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async archiveTeam(teamId: TeamId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("archive_team", { p_team_id: teamId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async restoreTeam(teamId: TeamId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("restore_team", { p_team_id: teamId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async setParticipation(teamId: TeamId, membershipId: MembershipId, participationAsPlayer: boolean): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("set_participation", {
      p_team_id: teamId,
      p_membership_id: membershipId,
      p_participation_as_player: participationAsPlayer,
    });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async assignDirectFunction(teamId: TeamId, membershipId: MembershipId, fn: DirectlyAssignableFunction): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("assign_direct_function", {
      p_team_id: teamId,
      p_membership_id: membershipId,
      p_function: fn,
    });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async removeDirectFunction(teamId: TeamId, membershipId: MembershipId, fn: DirectlyAssignableFunction): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("remove_direct_function", {
      p_team_id: teamId,
      p_membership_id: membershipId,
      p_function: fn,
    });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async removeAdminFunction(teamId: TeamId, membershipId: MembershipId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("remove_admin_function", { p_team_id: teamId, p_membership_id: membershipId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async relinquishOwnAdmin(teamId: TeamId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("relinquish_own_admin", { p_team_id: teamId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async removeMember(teamId: TeamId, membershipId: MembershipId): Promise<TeamResult<{ notificationEmailSent: boolean }>> {
    return this.postToRoute<{ notificationEmailSent: boolean }>({ kind: "removeMember" }, { teamId, membershipId });
  }

  async leaveTeam(teamId: TeamId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("leave_team", { p_team_id: teamId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async listInvitations(teamId: TeamId): Promise<TeamResult<TeamInvitation[]>> {
    // Explicit column list — never `select("*")` — so `token_hash` (a value this app
    // never needs client-side; see docs/adr/0022 Decision 5) never crosses the wire to
    // an admin's browser merely because it happens to share a table with columns that
    // are needed, even though the hash alone cannot be turned back into an accepting
    // token.
    const { data, error } = await this.client
      .from("team_invitations")
      .select(
        "id, team_id, email, participation_as_player, proposed_functions, status, created_at, expires_at, accepted_at, revoked_at, replaced_by_invitation_id, email_delivery_status"
      )
      .eq("team_id", teamId);
    if (error) return fail(error);
    return teamOk((data ?? []).map(mapInvitationRow));
  }

  async createInvitation(
    teamId: TeamId,
    proposal: InvitationProposal
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>> {
    return this.postToRoute({ kind: "createInvitation" }, {
      teamId,
      email: proposal.email,
      participationAsPlayer: proposal.participationAsPlayer,
      proposedFunctions: proposal.proposedFunctions,
    });
  }

  async reviseInvitation(
    invitationId: InvitationId,
    proposal: InvitationProposal
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>> {
    return this.postToRoute({ kind: "reviseInvitation", invitationId }, {
      email: proposal.email,
      participationAsPlayer: proposal.participationAsPlayer,
      proposedFunctions: proposal.proposedFunctions,
    });
  }

  async resendInvitation(invitationId: InvitationId): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>> {
    return this.postToRoute({ kind: "resendInvitation", invitationId }, {});
  }

  async revokeInvitation(invitationId: InvitationId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("revoke_invitation", { p_invitation_id: invitationId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async previewInvitation(rawToken: string): Promise<TeamResult<InvitationPreview>> {
    const { data, error } = await this.client.rpc("preview_invitation", { p_raw_token: rawToken });
    if (error) return fail(error);
    const row = Array.isArray(data) ? data[0] : data;
    if (row.status === "invalid_token") return teamOk({ status: "invalid_token" });
    if (row.status === "denied") return teamOk({ status: "denied", reason: row.denial_reason });
    return teamOk({
      status: "ready_to_accept",
      teamName: row.team_name,
      inviterDisplayName: row.inviter_display_name ?? null,
      participationAsPlayer: row.participation_as_player,
      proposedFunctions: row.proposed_functions ?? [],
    });
  }

  async acceptInvitation(rawToken: string): Promise<TeamResult<{ teamId: TeamId }>> {
    const { data, error } = await this.client.rpc("accept_invitation", { p_raw_token: rawToken });
    if (error) return fail(error);
    return teamOk({ teamId: data as string });
  }

  /** The nominee's own actionable inbox — deliberately scoped to effectively-pending
   * requests only (docs/adr/0022 §Notification Convergence: one actionable UI
   * representation, never a stale accepted/revoked/replaced/expired request
   * reappearing as if it still needed a decision). */
  async listAdminRequestsForMe(): Promise<TeamResult<Array<TeamAdminRequest & { teamName: string }>>> {
    const { data, error } = await this.client
      .from("team_admin_requests")
      .select("*, teams(name), team_memberships!inner(profile_id)");
    if (error) return fail(error);
    const myProfile = await this.getMyProfile();
    if (!myProfile.ok) return myProfile;
    const myProfileId = myProfile.value?.id;
    const mine = (data ?? []).filter(
      (row: Record<string, unknown>) => (row.team_memberships as { profile_id: string }).profile_id === myProfileId
    );
    return teamOk(
      mine
        .map((row: Record<string, unknown>) => ({
          ...mapAdminRequestRow(row),
          teamName: (row.teams as { name: string }).name,
        }))
        .filter((request) => request.status === "pending")
    );
  }

  /** The Team-side view (docs/adr/0022 §Team-Side Admin Request Read Model) — calls
   * the dedicated `list_admin_requests_for_team` RPC rather than a plain RLS-scoped
   * `select`, because `team_admin_requests_select`'s policy deliberately ALSO
   * permits the nominee to see their own request (for their separate nominee inbox,
   * listAdminRequestsForMe) — a plain select filtered by team_id is therefore not a
   * genuinely admin-only boundary on its own. The RPC re-derives admin authorization
   * server-side before returning anything, matching FakeTeamService's equivalent
   * admin-only gate. Scoped to effectively-pending requests only, for the same
   * one-actionable-representation reason as listAdminRequestsForMe. */
  async listAdminRequestsForTeam(teamId: TeamId): Promise<TeamResult<TeamAdminRequest[]>> {
    const { data, error } = await this.client.rpc("list_admin_requests_for_team", { p_team_id: teamId });
    if (error) return fail(error);
    return teamOk(
      ((data ?? []) as Record<string, unknown>[]).map(mapAdminRequestRow).filter((request: TeamAdminRequest) => request.status === "pending")
    );
  }

  async createAdminRequest(teamId: TeamId, membershipId: MembershipId): Promise<TeamResult<{ request: TeamAdminRequest } & EmailSendOutcome>> {
    return this.postToRoute({ kind: "createAdminRequest" }, { teamId, membershipId });
  }

  async revokeAdminRequest(requestId: AdminRequestId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("revoke_admin_request", { p_request_id: requestId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  async acceptAdminRequest(requestId: AdminRequestId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("accept_admin_request", { p_request_id: requestId });
    if (error) return fail(error);
    return teamOk(undefined);
  }

  /** Unread only (docs/adr/0022 §Notification Convergence) — an ordinary
   * notification read is an actionable-inbox view, not a full history; a named
   * history method, if ever added, would be separate and explicit. */
  async listNotifications(): Promise<TeamResult<AccountNotification[]>> {
    const { data, error } = await this.client
      .from("account_notifications")
      .select("*")
      .is("read_at", null)
      .order("created_at", { ascending: false });
    if (error) return fail(error);
    return teamOk((data ?? []).map(mapNotificationRow));
  }

  async acknowledgeNotification(notificationId: NotificationId): Promise<TeamResult<void>> {
    const { error } = await this.client.rpc("acknowledge_notification", { p_notification_id: notificationId });
    if (error) return fail(error);
    return teamOk(undefined);
  }
}
