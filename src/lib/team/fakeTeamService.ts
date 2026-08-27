// In-memory reference implementation of TeamService — used by tests and component
// stories. This is not a shortcut: every method here performs the same real state
// transitions, permission checks, and invariant checks the Postgres RPCs perform
// (docs/adr/0022) — see CLAUDE.md's Timing Simulator precedent (ADR-0006) for why a
// test stand-in must implement the real contract rather than a parallel code path.
// Several independent `FakeTeamService` instances (one per simulated caller) share
// one `FakeTeamBackend` so multi-actor flows (Admin invites, invitee accepts; two
// Admins racing to demote the same successor) can be exercised directly.

import {
  ADMIN_REQUEST_LIFETIME_DAYS,
  INVITATION_LIFETIME_DAYS,
  type AccountNotification,
  type AdminRequestId,
  type DirectlyAssignableFunction,
  type FunctionAssignmentId,
  type InvitationId,
  type MembershipId,
  type NotificationId,
  type Profile,
  type ProfileId,
  type Team,
  type TeamAdminRequest,
  type TeamFunction,
  type TeamFunctionAssignment,
  type TeamId,
  type TeamInvitation,
  type TeamMembership,
  type TeamRosterEntry,
} from "./types";
import { teamOk, teamFailed, type TeamErrorKind, type TeamResult } from "./errors";
import { canPerformTeamAction, type TeamAction, type TeamActorContext } from "./permissions";
import { wouldViolateLastAdminInvariant } from "./lastAdminInvariant";
import { checkInvitationAcceptable, deriveInvitationStatus } from "./invitationLifecycle";
import { checkAdminRequestAcceptable, deriveAdminRequestStatus } from "./adminRequestLifecycle";
import { resolveTeamStatusAfterAdminRequestAccepted } from "./recovery";
import type { EmailService } from "../email/emailService";
import type {
  CreateTeamInput,
  EmailSendOutcome,
  InvitationPreview,
  InvitationProposal,
  TeamService,
  TeamSummary,
  TeamWorkspace,
} from "./teamService";

/** Mirrors `private.validate_function_array` in the Postgres functions migration
 * (docs/adr/0022 §Function Array Input Validation) — the fake must reject the same
 * malformed shapes (null, unknown value, duplicate) with the same `invalid_input`
 * kind the production RPC does, rather than silently tolerating them or throwing. */
function validateFunctionArray(
  functions: readonly TeamFunction[] | null | undefined,
  allowed: readonly TeamFunction[]
): { kind: TeamErrorKind; message: string } | null {
  if (!Array.isArray(functions)) {
    return { kind: "invalid_input", message: "Provide a function list." };
  }
  for (const fn of functions) {
    if (!allowed.includes(fn)) {
      return { kind: "invalid_input", message: "Unknown function proposed." };
    }
  }
  if (new Set(functions).size !== functions.length) {
    return { kind: "invalid_input", message: "Duplicate function proposed." };
  }
  return null;
}

export type TeamAuditEvent = {
  id: string;
  teamId: TeamId | null;
  actorProfileId: ProfileId | null;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

/** `createdByProfileId` is fake-internal (not part of the public `TeamInvitation`
 * shape, mirroring how the real schema's `team_invitations.created_by_profile_id`
 * column is never mapped onto that same public type) — tracked per-row so
 * `previewInvitation` can attribute the invite to whoever actually created THIS
 * row, never the team's original creator (docs/adr/0022 §Invitation Attribution;
 * this matters because revise/resend replace the row with a fresh one, possibly
 * created by a different active Team Admin than the original). */
type InvitationRecord = TeamInvitation & { acceptedByMembershipId: MembershipId | null; createdByProfileId: ProfileId };

/** The shared, mutable in-memory store several `FakeTeamService` instances (one per
 * simulated caller) read and write together. */
export class FakeTeamBackend {
  readonly profiles = new Map<ProfileId, Profile>();
  /** accountScopeId -> profileId, one-to-one in both directions (requirement 4). */
  readonly accountLinks = new Map<string, ProfileId>();
  readonly accountEmails = new Map<string, string>();
  readonly pilotGrants = new Set<ProfileId>();
  readonly teams = new Map<TeamId, Team>();
  readonly memberships = new Map<MembershipId, TeamMembership>();
  readonly functionAssignments = new Map<FunctionAssignmentId, TeamFunctionAssignment>();
  readonly invitations = new Map<InvitationId, InvitationRecord>();
  /** Test-only visibility into the raw token — production code never exposes this
   * beyond the one server-side email-send call (requirement 63). */
  readonly invitationRawTokens = new Map<InvitationId, string>();
  readonly adminRequests = new Map<AdminRequestId, TeamAdminRequest>();
  readonly notifications = new Map<NotificationId, AccountNotification>();
  readonly auditEvents: TeamAuditEvent[] = [];

  private counter = 0;
  /** Overridable in tests that need deterministic/controlled time (e.g. expiry). */
  now: () => Date = () => new Date();

  nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  /** Test/setup-only: simulates the manually-granted closed-beta capability
   * (requirement 15) — never reachable through `TeamService` itself. */
  grantPilotTeamCreationCapability(profileId: ProfileId): void {
    this.pilotGrants.add(profileId);
  }

  /** Test/setup-only: simulates the verified email Supabase Auth already owns for an
   * account — `TeamService` never lets a caller set their own email through it. */
  setAccountEmail(accountScopeId: string, email: string): void {
    this.accountEmails.set(accountScopeId, email);
  }

  /** Test/setup-only: represents a Profile whose platform onboarding already
   * completed before any Team surface mounted. This is intentionally not exposed
   * through TeamService; production Profiles come from the Identity gate. */
  seedCompletedProfile(accountScopeId: string, displayName: string): Profile {
    const existingId = this.accountLinks.get(accountScopeId);
    const now = this.now().toISOString();
    if (existingId) {
      const existing = this.profiles.get(existingId);
      if (!existing) throw new Error("Fake Profile link is inconsistent.");
      const updated = { ...existing, displayName, updatedAt: now };
      this.profiles.set(existingId, updated);
      return updated;
    }
    const profile: Profile = {
      id: this.nextId("profile"),
      displayName,
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.set(profile.id, profile);
    this.accountLinks.set(accountScopeId, profile.id);
    return profile;
  }

  profileIdForAccount(accountScopeId: string): ProfileId | null {
    return this.accountLinks.get(accountScopeId) ?? null;
  }

  accountForProfile(profileId: ProfileId): string | null {
    for (const [accountScopeId, linkedProfileId] of this.accountLinks) {
      if (linkedProfileId === profileId) return accountScopeId;
    }
    return null;
  }

  emailForProfile(profileId: ProfileId): string | null {
    const accountScopeId = this.accountForProfile(profileId);
    return accountScopeId ? this.accountEmails.get(accountScopeId) ?? null : null;
  }

  activeMembership(teamId: TeamId, profileId: ProfileId): TeamMembership | null {
    for (const membership of this.memberships.values()) {
      if (membership.teamId === teamId && membership.profileId === profileId && membership.status === "active") {
        return membership;
      }
    }
    return null;
  }

  anyMembership(teamId: TeamId, profileId: ProfileId): TeamMembership | null {
    let latest: TeamMembership | null = null;
    for (const membership of this.memberships.values()) {
      if (membership.teamId === teamId && membership.profileId === profileId) {
        if (!latest || membership.startedAt > latest.startedAt) latest = membership;
      }
    }
    return latest;
  }

  activeFunctionsForMembership(membershipId: MembershipId): TeamFunction[] {
    const functions: TeamFunction[] = [];
    for (const assignment of this.functionAssignments.values()) {
      if (assignment.membershipId === membershipId && assignment.status === "active") {
        functions.push(assignment.function);
      }
    }
    return functions;
  }

  activeAdminMembershipIds(teamId: TeamId): MembershipId[] {
    const adminMembershipIds: MembershipId[] = [];
    for (const membership of this.memberships.values()) {
      if (membership.teamId === teamId && membership.status === "active") {
        if (this.activeFunctionsForMembership(membership.id).includes("team_admin")) {
          adminMembershipIds.push(membership.id);
        }
      }
    }
    return adminMembershipIds;
  }

  rosterFor(teamId: TeamId, includeEmail: boolean): TeamRosterEntry[] {
    const entries: TeamRosterEntry[] = [];
    for (const membership of this.memberships.values()) {
      if (membership.teamId !== teamId || membership.status !== "active") continue;
      const profile = this.profiles.get(membership.profileId) ?? null;
      const entry: TeamRosterEntry = {
        membershipId: membership.id,
        profileId: membership.profileId,
        displayName: profile?.displayName ?? null,
        participationAsPlayer: membership.participationAsPlayer,
        functions: this.activeFunctionsForMembership(membership.id),
      };
      if (includeEmail) {
        entry.email = this.emailForProfile(membership.profileId) ?? undefined;
      }
      entries.push(entry);
    }
    return entries;
  }

  audit(event: Omit<TeamAuditEvent, "id" | "createdAt">): void {
    this.auditEvents.push({ ...event, id: this.nextId("audit"), createdAt: this.now().toISOString() });
  }

  endMembership(membership: TeamMembership, reason: "left" | "removed"): TeamMembership {
    const ended: TeamMembership = {
      ...membership,
      status: "ended",
      endedAt: this.now().toISOString(),
      endReason: reason,
    };
    this.memberships.set(membership.id, ended);
    for (const assignment of this.functionAssignments.values()) {
      if (assignment.membershipId === membership.id && assignment.status === "active") {
        this.functionAssignments.set(assignment.id, {
          ...assignment,
          status: "ended",
          endedAt: this.now().toISOString(),
        });
      }
    }
    for (const request of this.adminRequests.values()) {
      if (request.membershipId === membership.id && deriveAdminRequestStatus(request, this.now()) === "pending") {
        this.adminRequests.set(request.id, {
          ...request,
          status: "revoked",
          revokedAt: this.now().toISOString(),
        });
        this.resolveAdminRequestNotification(request.id);
      }
    }
    return ended;
  }

  notify(profileId: ProfileId, kind: AccountNotification["kind"], payload: Record<string, unknown>): void {
    const id = this.nextId("notif");
    this.notifications.set(id, {
      id,
      profileId,
      kind,
      payload,
      createdAt: this.now().toISOString(),
      readAt: null,
    });
  }

  /** A resolved (accepted/revoked/membership-invalidated) Admin Request must not stay
   * actionable through its notification, converging with the dedicated Admin Request
   * list (docs/adr/0022 §Notification Convergence) — never left for the recipient to
   * separately dismiss an already-resolved item. Idempotent: a no-op if already read
   * or if no such notification exists. */
  resolveAdminRequestNotification(requestId: AdminRequestId): void {
    for (const [id, notification] of this.notifications) {
      if (notification.kind === "admin_request" && notification.payload.requestId === requestId && notification.readAt === null) {
        this.notifications.set(id, { ...notification, readAt: this.now().toISOString() });
      }
    }
  }
}

function randomToken(backend: FakeTeamBackend): string {
  return `tok_${backend.nextId("raw")}_${Math.random().toString(36).slice(2)}`;
}

/** Maps a non-`"pending"` effective invitation status onto the matching
 * `TeamErrorKind` — `null` for `"pending"` (the one status that means "still
 * revisable", not a denial). Reuses the exact word "expired"/"revoked"/"replaced"
 * from `EffectiveInvitationStatus`; only `"accepted"` needs renaming to the distinct
 * `"already_accepted"` error kind. */
function invitationStatusToErrorKind(status: ReturnType<typeof deriveInvitationStatus>): TeamErrorKind | null {
  switch (status) {
    case "pending":
      return null;
    case "accepted":
      return "already_accepted";
    default:
      return status;
  }
}

export class FakeTeamService implements TeamService {
  constructor(
    private readonly backend: FakeTeamBackend,
    private readonly accountScopeId: string,
    private readonly emailService: EmailService,
    private readonly acceptUrlBase: string = "https://app.example/team-invite"
  ) {}

  private now(): Date {
    return this.backend.now();
  }

  private myProfile(): Profile | null {
    const profileId = this.backend.profileIdForAccount(this.accountScopeId);
    return profileId ? this.backend.profiles.get(profileId) ?? null : null;
  }

  private myEmail(): string | null {
    return this.backend.accountEmails.get(this.accountScopeId) ?? null;
  }

  private actorContext(teamId: TeamId, profile: Profile): TeamActorContext {
    const team = this.backend.teams.get(teamId);
    const membership = this.backend.anyMembership(teamId, profile.id);
    return {
      membership,
      functions: membership ? this.backend.activeFunctionsForMembership(membership.id) : [],
      teamStatus: team?.status ?? "active",
    };
  }

  async getMyProfile(): Promise<TeamResult<Profile | null>> {
    return teamOk(this.myProfile());
  }

  /** Test/setup-only counterpart to completed platform onboarding. It is not a
   * TeamService operation and no production Team surface can call it. */
  async seedCompletedProfile(displayName: string): Promise<TeamResult<Profile>> {
    const trimmed = displayName.trim();
    if (trimmed.length === 0) {
      return teamFailed("invalid_input", "Enter a display name.");
    }
    if (trimmed.length > 80) {
      return teamFailed("invalid_input", "Display name is too long.");
    }
    return teamOk(this.backend.seedCompletedProfile(this.accountScopeId, trimmed));
  }

  async hasPilotTeamCreationCapability(): Promise<TeamResult<boolean>> {
    const profile = this.myProfile();
    if (!profile) return teamOk(false);
    return teamOk(this.backend.pilotGrants.has(profile.id));
  }

  async listMyTeams(): Promise<TeamResult<TeamSummary[]>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const summaries: TeamSummary[] = [];
    for (const membership of this.backend.memberships.values()) {
      if (membership.profileId !== profile.id || membership.status !== "active") continue;
      const team = this.backend.teams.get(membership.teamId);
      if (!team) continue;
      summaries.push({
        team,
        myMembershipId: membership.id,
        myParticipationAsPlayer: membership.participationAsPlayer,
        myFunctions: this.backend.activeFunctionsForMembership(membership.id),
      });
    }
    return teamOk(summaries);
  }

  async createTeam(input: CreateTeamInput): Promise<TeamResult<TeamWorkspace>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    if (!this.backend.pilotGrants.has(profile.id)) {
      return teamFailed("forbidden", "This account does not have team-creation access yet.");
    }
    const name = input.name.trim();
    if (name.length === 0) return teamFailed("invalid_input", "Enter a team name.");
    const functionValidation = validateFunctionArray(input.functions, ["coach", "training_lead"]);
    if (functionValidation) return teamFailed(functionValidation.kind, functionValidation.message);

    const now = this.now().toISOString();
    const teamId = this.backend.nextId("team");
    const team: Team = {
      id: teamId,
      name,
      status: "active",
      createdByProfileId: profile.id,
      createdAt: now,
      archivedAt: null,
      restoredAt: null,
    };
    this.backend.teams.set(teamId, team);

    const membershipId = this.backend.nextId("membership");
    const membership: TeamMembership = {
      id: membershipId,
      teamId,
      profileId: profile.id,
      status: "active",
      participationAsPlayer: input.participationAsPlayer,
      startedAt: now,
      endedAt: null,
      endReason: null,
    };
    this.backend.memberships.set(membershipId, membership);

    const grantedFunctions: TeamFunction[] = ["team_admin", ...input.functions];
    for (const fn of new Set(grantedFunctions)) {
      this.addFunctionAssignment(membershipId, fn);
    }

    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "team_created", payload: { name } });
    return teamOk(this.buildWorkspace(team, membershipId));
  }

  private addFunctionAssignment(membershipId: MembershipId, fn: TeamFunction): void {
    const id = this.backend.nextId("fn");
    const now = this.now().toISOString();
    this.backend.functionAssignments.set(id, {
      id,
      membershipId,
      function: fn,
      status: "active",
      startedAt: now,
      endedAt: null,
    });
  }

  private endFunctionAssignment(membershipId: MembershipId, fn: TeamFunction): void {
    for (const assignment of this.backend.functionAssignments.values()) {
      if (
        assignment.membershipId === membershipId &&
        assignment.function === fn &&
        assignment.status === "active"
      ) {
        this.backend.functionAssignments.set(assignment.id, {
          ...assignment,
          status: "ended",
          endedAt: this.now().toISOString(),
        });
      }
    }
  }

  private buildWorkspace(team: Team, myMembershipId: MembershipId): TeamWorkspace {
    const myFunctions = this.backend.activeFunctionsForMembership(myMembershipId);
    const isAdmin = myFunctions.includes("team_admin");
    const myMembership = this.backend.memberships.get(myMembershipId);
    return {
      team,
      myMembershipId,
      myFunctions,
      myParticipationAsPlayer: myMembership?.participationAsPlayer ?? false,
      isAdmin,
      roster: this.backend.rosterFor(team.id, isAdmin),
    };
  }

  async getTeamWorkspace(teamId: TeamId): Promise<TeamResult<TeamWorkspace>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const team = this.backend.teams.get(teamId);
    if (!team) return teamFailed("not_found", "Team not found.");
    const membership = this.backend.activeMembership(teamId, profile.id);
    if (!membership) return teamFailed("forbidden", "You are not an active member of this team.");
    return teamOk(this.buildWorkspace(team, membership.id));
  }

  /** Resolves the caller's profile + the target team and checks `action` against the
   * caller's actor context in one step. Every admin-gated mutation below starts with
   * this, then does its own additional state checks (archived-team, target-row
   * existence, invariants). */
  private requireAction(teamId: TeamId, action: TeamAction): TeamResult<{ profile: Profile; team: Team }> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const team = this.backend.teams.get(teamId);
    if (!team) return teamFailed("not_found", "Team not found.");
    const context = this.actorContext(teamId, profile);
    if (canPerformTeamAction(action, context)) {
      return teamOk({ profile, team });
    }
    // canPerformTeamAction already accounts for teamStatus (permissions.ts), but a
    // caller who genuinely holds the required role deserves the specific
    // "archived_team" reason, not a generic "forbidden" — mirrors the Postgres
    // RPCs' own two-step require_active_admin() then assert_team_active() sequence,
    // each raising its own distinct error kind (docs/adr/0022).
    if (team.status !== "active" && canPerformTeamAction(action, { ...context, teamStatus: "active" })) {
      return teamFailed("archived_team", "This team is archived.");
    }
    return teamFailed("forbidden", "You do not have permission to do this.");
  }

  private membershipInTeam(teamId: TeamId, membershipId: MembershipId): TeamResult<TeamMembership> {
    const membership = this.backend.memberships.get(membershipId);
    if (!membership || membership.teamId !== teamId) {
      return teamFailed("not_found", "Membership not found.");
    }
    return teamOk(membership);
  }

  async renameTeam(teamId: TeamId, name: string): Promise<TeamResult<void>> {
    const gate = this.requireAction(teamId, "rename_team");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const trimmed = name.trim();
    if (trimmed.length === 0) return teamFailed("invalid_input", "Enter a team name.");
    this.backend.teams.set(teamId, { ...team, name: trimmed });
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "team_renamed", payload: { name: trimmed } });
    return teamOk(undefined);
  }

  async archiveTeam(teamId: TeamId): Promise<TeamResult<void>> {
    const gate = this.requireAction(teamId, "archive_team");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status === "archived") return teamOk(undefined);
    this.backend.teams.set(teamId, { ...team, status: "archived", archivedAt: this.now().toISOString() });
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "team_archived", payload: {} });
    return teamOk(undefined);
  }

  async restoreTeam(teamId: TeamId): Promise<TeamResult<void>> {
    const gate = this.requireAction(teamId, "restore_team");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status === "active") return teamOk(undefined);
    if (team.status === "recovery") {
      return teamFailed("forbidden", "This team is in restricted recovery and cannot be restored directly.");
    }
    this.backend.teams.set(teamId, { ...team, status: "active", restoredAt: this.now().toISOString() });
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "team_restored", payload: {} });
    return teamOk(undefined);
  }

  async setParticipation(
    teamId: TeamId,
    membershipId: MembershipId,
    participationAsPlayer: boolean
  ): Promise<TeamResult<void>> {
    const gate = this.requireAction(teamId, "change_participation");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const membershipResult = this.membershipInTeam(teamId, membershipId);
    if (!membershipResult.ok) return membershipResult;
    const membership = membershipResult.value;
    if (membership.status !== "active") return teamFailed("conflict", "This membership has already ended.");
    this.backend.memberships.set(membershipId, { ...membership, participationAsPlayer });
    this.backend.audit({
      teamId,
      actorProfileId: profile.id,
      eventType: "participation_changed",
      payload: { membershipId, participationAsPlayer },
    });
    return teamOk(undefined);
  }

  async assignDirectFunction(
    teamId: TeamId,
    membershipId: MembershipId,
    fn: DirectlyAssignableFunction
  ): Promise<TeamResult<void>> {
    const gate = this.requireAction(teamId, "assign_direct_function");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const membershipResult = this.membershipInTeam(teamId, membershipId);
    if (!membershipResult.ok) return membershipResult;
    const membership = membershipResult.value;
    if (membership.status !== "active") return teamFailed("conflict", "This membership has already ended.");
    if (this.backend.activeFunctionsForMembership(membershipId).includes(fn)) return teamOk(undefined);
    this.addFunctionAssignment(membershipId, fn);
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "function_assigned", payload: { membershipId, fn } });
    return teamOk(undefined);
  }

  async removeDirectFunction(
    teamId: TeamId,
    membershipId: MembershipId,
    fn: DirectlyAssignableFunction
  ): Promise<TeamResult<void>> {
    const gate = this.requireAction(teamId, "remove_direct_function");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const membershipResult = this.membershipInTeam(teamId, membershipId);
    if (!membershipResult.ok) return membershipResult;
    this.endFunctionAssignment(membershipId, fn);
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "function_removed", payload: { membershipId, fn } });
    return teamOk(undefined);
  }

  async removeAdminFunction(teamId: TeamId, membershipId: MembershipId): Promise<TeamResult<void>> {
    const gate = this.requireAction(teamId, "remove_admin_function");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    const membershipResult = this.membershipInTeam(teamId, membershipId);
    if (!membershipResult.ok) return membershipResult;
    const membership = membershipResult.value;
    if (membership.status !== "active") return teamFailed("conflict", "This membership has already ended.");
    if (!this.backend.activeFunctionsForMembership(membershipId).includes("team_admin")) {
      return teamOk(undefined);
    }
    const otherActiveAdminCount = this.backend
      .activeAdminMembershipIds(teamId)
      .filter((id) => id !== membershipId).length;
    if (wouldViolateLastAdminInvariant({ otherActiveAdminCount, teamStatus: team.status })) {
      return teamFailed("last_admin_invariant", "At least one active Team Admin must remain.");
    }
    this.endFunctionAssignment(membershipId, "team_admin");
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "admin_function_removed", payload: { membershipId } });
    return teamOk(undefined);
  }

  async relinquishOwnAdmin(teamId: TeamId): Promise<TeamResult<void>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const team = this.backend.teams.get(teamId);
    if (!team) return teamFailed("not_found", "Team not found.");
    const context = this.actorContext(teamId, profile);
    if (!canPerformTeamAction("relinquish_own_admin", context)) {
      return teamFailed("forbidden", "You are not an active Team Admin of this team.");
    }
    const membership = context.membership;
    if (!membership) return teamFailed("forbidden", "You are not an active member of this team.");
    const otherActiveAdminCount = this.backend
      .activeAdminMembershipIds(teamId)
      .filter((id) => id !== membership.id).length;
    if (wouldViolateLastAdminInvariant({ otherActiveAdminCount, teamStatus: team.status })) {
      return teamFailed(
        "last_admin_invariant",
        "You are the final active Team Admin. A successor must accept an Admin Request first, or archive the team."
      );
    }
    this.endFunctionAssignment(membership.id, "team_admin");
    this.backend.audit({
      teamId,
      actorProfileId: profile.id,
      eventType: "admin_function_relinquished",
      payload: { membershipId: membership.id },
    });
    return teamOk(undefined);
  }

  async removeMember(
    teamId: TeamId,
    membershipId: MembershipId
  ): Promise<TeamResult<{ notificationEmailSent: boolean }>> {
    const gate = this.requireAction(teamId, "remove_member");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const membershipResult = this.membershipInTeam(teamId, membershipId);
    if (!membershipResult.ok) return membershipResult;
    const membership = membershipResult.value;
    if (membership.status !== "active") return teamFailed("conflict", "This membership has already ended.");
    const isTargetAdmin = this.backend.activeFunctionsForMembership(membershipId).includes("team_admin");
    if (isTargetAdmin) {
      const otherActiveAdminCount = this.backend
        .activeAdminMembershipIds(teamId)
        .filter((id) => id !== membershipId).length;
      if (wouldViolateLastAdminInvariant({ otherActiveAdminCount, teamStatus: team.status })) {
        return teamFailed("last_admin_invariant", "At least one active Team Admin must remain.");
      }
    }
    this.backend.endMembership(membership, "removed");
    this.backend.notify(membership.profileId, "member_removed", { teamId, teamName: team.name });
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "member_removed", payload: { membershipId } });

    const removedEmail = this.backend.emailForProfile(membership.profileId);
    let notificationEmailSent = false;
    if (removedEmail) {
      const result = await this.emailService.sendMemberRemovalNotice({ toEmail: removedEmail, teamName: team.name });
      notificationEmailSent = result.ok;
    }
    return teamOk({ notificationEmailSent });
  }

  async leaveTeam(teamId: TeamId): Promise<TeamResult<void>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const team = this.backend.teams.get(teamId);
    if (!team) return teamFailed("not_found", "Team not found.");
    const context = this.actorContext(teamId, profile);
    if (!canPerformTeamAction("leave_team", context)) {
      return teamFailed("forbidden", "You are not an active member of this team.");
    }
    const membership = context.membership;
    if (!membership) return teamFailed("forbidden", "You are not an active member of this team.");
    if (context.functions.includes("team_admin")) {
      const otherActiveAdminCount = this.backend
        .activeAdminMembershipIds(teamId)
        .filter((id) => id !== membership.id).length;
      if (wouldViolateLastAdminInvariant({ otherActiveAdminCount, teamStatus: team.status })) {
        return teamFailed(
          "last_admin_invariant",
          "You are the final active Team Admin. A successor must accept an Admin Request first, or archive the team."
        );
      }
    }
    this.backend.endMembership(membership, "left");
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "member_left", payload: { membershipId: membership.id } });
    return teamOk(undefined);
  }

  async listInvitations(teamId: TeamId): Promise<TeamResult<TeamInvitation[]>> {
    const gate = this.requireAction(teamId, "manage_invitations");
    if (!gate.ok) return gate;
    const now = this.now();
    const invitations = Array.from(this.backend.invitations.values())
      .filter((invitation) => invitation.teamId === teamId)
      .map((invitation) => this.withEffectiveStatus(invitation, now));
    return teamOk(invitations);
  }

  private withEffectiveStatus(invitation: InvitationRecord, now: Date): InvitationRecord {
    const effective = deriveInvitationStatus(invitation, now);
    if (effective !== invitation.status) {
      const updated: InvitationRecord = { ...invitation, status: effective };
      this.backend.invitations.set(invitation.id, updated);
      return updated;
    }
    return invitation;
  }

  /** Returns a `TeamError` describing the first validation failure, or `null` when
   * `proposal` is valid. Deliberately not `TeamResult<void> | null` — callers need to
   * embed the failure into a differently-shaped `TeamResult<...>` at each call site,
   * and a bare `TeamError` composes into any of them without a type mismatch. */
  private validateProposal(proposal: InvitationProposal): { kind: TeamErrorKind; message: string } | null {
    const email = proposal.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { kind: "invalid_input", message: "Enter a valid email address." };
    }
    return validateFunctionArray(proposal.proposedFunctions, ["team_admin", "coach", "training_lead"]);
  }

  private async createInvitationRow(
    teamId: TeamId,
    proposal: InvitationProposal,
    createdByProfileId: ProfileId
  ): Promise<{ invitation: InvitationRecord } & EmailSendOutcome> {
    const now = this.now();
    const id = this.backend.nextId("invitation");
    const token = randomToken(this.backend);
    const invitation: InvitationRecord = {
      id,
      teamId,
      email: proposal.email.trim(),
      participationAsPlayer: proposal.participationAsPlayer,
      proposedFunctions: proposal.proposedFunctions,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + INVITATION_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      acceptedAt: null,
      revokedAt: null,
      replacedByInvitationId: null,
      emailDeliveryStatus: "pending",
      acceptedByMembershipId: null,
      createdByProfileId,
    };
    this.backend.invitations.set(id, invitation);
    this.backend.invitationRawTokens.set(id, token);

    const team = this.backend.teams.get(teamId);
    const inviter = this.backend.profiles.get(createdByProfileId);
    const emailResult = await this.emailService.sendTeamInvitation({
      toEmail: invitation.email,
      teamName: team?.name ?? "",
      inviterDisplayName: inviter?.displayName ?? null,
      participationAsPlayer: invitation.participationAsPlayer,
      proposedFunctions: invitation.proposedFunctions,
      acceptUrl: `${this.acceptUrlBase}?token=${token}`,
      expiresAt: invitation.expiresAt,
    });
    const finalInvitation: InvitationRecord = {
      ...invitation,
      emailDeliveryStatus: emailResult.ok ? "sent" : "failed",
    };
    this.backend.invitations.set(id, finalInvitation);
    this.backend.audit({
      teamId,
      actorProfileId: createdByProfileId,
      eventType: "invitation_created",
      payload: { invitationId: id, email: invitation.email },
    });
    return { invitation: finalInvitation, emailSent: emailResult.ok };
  }

  async createInvitation(
    teamId: TeamId,
    proposal: InvitationProposal
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>> {
    const gate = this.requireAction(teamId, "manage_invitations");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const invalid = this.validateProposal(proposal);
    if (invalid) return { ok: false, error: invalid };
    const result = await this.createInvitationRow(teamId, proposal, profile.id);
    return teamOk(result);
  }

  private async replaceInvitation(
    invitationId: InvitationId,
    proposal: InvitationProposal
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>> {
    const existing = this.backend.invitations.get(invitationId);
    if (!existing) return teamFailed("not_found", "Invitation not found.");
    const gate = this.requireAction(existing.teamId, "manage_invitations");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const invalid = this.validateProposal(proposal);
    if (invalid) return { ok: false, error: invalid };

    const now = this.now();
    const effective = this.withEffectiveStatus(existing, now);
    const denial = invitationStatusToErrorKind(deriveInvitationStatus(effective, now));
    if (denial) {
      return teamFailed(denial, "This invitation can no longer be revised.");
    }

    const created = await this.createInvitationRow(existing.teamId, proposal, profile.id);
    const closed: InvitationRecord = {
      ...effective,
      status: "replaced",
      replacedByInvitationId: created.invitation.id,
    };
    this.backend.invitations.set(existing.id, closed);
    this.backend.audit({
      teamId: existing.teamId,
      actorProfileId: profile.id,
      eventType: "invitation_replaced",
      payload: { oldInvitationId: existing.id, newInvitationId: created.invitation.id },
    });
    return teamOk(created);
  }

  async reviseInvitation(
    invitationId: InvitationId,
    proposal: InvitationProposal
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>> {
    return this.replaceInvitation(invitationId, proposal);
  }

  async resendInvitation(
    invitationId: InvitationId
  ): Promise<TeamResult<{ invitation: TeamInvitation } & EmailSendOutcome>> {
    const existing = this.backend.invitations.get(invitationId);
    if (!existing) return teamFailed("not_found", "Invitation not found.");
    return this.replaceInvitation(invitationId, {
      email: existing.email,
      participationAsPlayer: existing.participationAsPlayer,
      proposedFunctions: existing.proposedFunctions,
    });
  }

  async revokeInvitation(invitationId: InvitationId): Promise<TeamResult<void>> {
    const existing = this.backend.invitations.get(invitationId);
    if (!existing) return teamFailed("not_found", "Invitation not found.");
    const gate = this.requireAction(existing.teamId, "manage_invitations");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const now = this.now();
    const effective = this.withEffectiveStatus(existing, now);
    if (deriveInvitationStatus(effective, now) !== "pending") {
      // Idempotent: revoking an already-terminal invitation changes nothing
      // (requirement 128) and never blocks a future invitation (requirement 60).
      return teamOk(undefined);
    }
    this.backend.invitations.set(existing.id, { ...effective, status: "revoked", revokedAt: now.toISOString() });
    this.backend.audit({ teamId: existing.teamId, actorProfileId: profile.id, eventType: "invitation_revoked", payload: { invitationId } });
    return teamOk(undefined);
  }

  private findInvitationByToken(rawToken: string): InvitationRecord | null {
    for (const [invitationId, token] of this.backend.invitationRawTokens) {
      if (token === rawToken) {
        return this.backend.invitations.get(invitationId) ?? null;
      }
    }
    return null;
  }

  /** Requires a Profile FIRST, matching the real `preview_invitation` RPC's own
   * `private.require_profile()` call (docs/adr/0022) — a signed-in account with no
   * Profile yet must be told to bootstrap one before this can even be checked, not
   * given a misleading "invalid"/"denied" result that has nothing to do with the
   * invitation itself. */
  async previewInvitation(rawToken: string): Promise<TeamResult<InvitationPreview>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const invitation = this.findInvitationByToken(rawToken);
    if (!invitation) return teamOk({ status: "invalid_token" });
    const email = this.myEmail();
    if (!email) return teamFailed("forbidden", "No verified email on this account.");
    const now = this.now();
    const effective = this.withEffectiveStatus(invitation, now);
    const check = checkInvitationAcceptable(effective, now, email);
    if (!check.ok) return teamOk({ status: "denied", reason: check.reason });
    // The inviter is whoever created THIS invitation row, never the team's
    // original creator (docs/adr/0022 §Invitation Attribution).
    const inviter = this.backend.profiles.get(invitation.createdByProfileId) ?? null;
    const team = this.backend.teams.get(effective.teamId);
    return teamOk({
      status: "ready_to_accept",
      teamName: team?.name ?? "",
      inviterDisplayName: inviter?.displayName ?? null,
      participationAsPlayer: effective.participationAsPlayer,
      proposedFunctions: effective.proposedFunctions,
    });
  }

  async acceptInvitation(rawToken: string): Promise<TeamResult<{ teamId: TeamId }>> {
    const invitation = this.findInvitationByToken(rawToken);
    if (!invitation) return teamFailed("not_found", "This invitation link is invalid.");
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const email = this.myEmail();
    if (!email) return teamFailed("forbidden", "No verified email on this account.");

    const now = this.now();
    const effective = this.withEffectiveStatus(invitation, now);
    const check = checkInvitationAcceptable(effective, now, email);
    if (!check.ok) return teamFailed(check.reason, "This invitation can no longer be accepted.");

    if (this.backend.activeMembership(effective.teamId, profile.id)) {
      return teamFailed("already_exists", "You are already an active member of this team.");
    }

    const membershipId = this.backend.nextId("membership");
    const membership: TeamMembership = {
      id: membershipId,
      teamId: effective.teamId,
      profileId: profile.id,
      status: "active",
      participationAsPlayer: effective.participationAsPlayer,
      startedAt: now.toISOString(),
      endedAt: null,
      endReason: null,
    };
    this.backend.memberships.set(membershipId, membership);
    for (const fn of new Set(effective.proposedFunctions)) {
      this.addFunctionAssignment(membershipId, fn);
    }
    this.backend.invitations.set(effective.id, {
      ...effective,
      status: "accepted",
      acceptedAt: now.toISOString(),
      acceptedByMembershipId: membershipId,
    });
    this.backend.audit({
      teamId: effective.teamId,
      actorProfileId: profile.id,
      eventType: "invitation_accepted",
      payload: { invitationId: effective.id, membershipId },
    });
    return teamOk({ teamId: effective.teamId });
  }

  /** The nominee's own actionable inbox — deliberately scoped to effectively-pending
   * requests only (docs/adr/0022 §Notification Convergence: this is the one
   * actionable UI representation for Admin Requests, so an accepted/revoked/
   * replaced/expired request must never reappear here as if it still needed a
   * decision). A full history view, if ever added, would be a separate, explicitly
   * named method — never a filter this same method's callers have to apply
   * themselves. */
  async listAdminRequestsForMe(): Promise<TeamResult<Array<TeamAdminRequest & { teamName: string }>>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const now = this.now();
    const mine: Array<TeamAdminRequest & { teamName: string }> = [];
    for (const request of this.backend.adminRequests.values()) {
      const membership = this.backend.memberships.get(request.membershipId);
      if (!membership || membership.profileId !== profile.id) continue;
      if (deriveAdminRequestStatus(request, now) !== "pending") continue;
      const team = this.backend.teams.get(request.teamId);
      mine.push({ ...request, teamName: team?.name ?? "" });
    }
    return teamOk(mine);
  }

  /** The Team-side view of a team's own outstanding Admin Requests — for an active
   * Team Admin to see and revoke what they've created, distinct from the nominee
   * inbox above (docs/adr/0022 §Team-Side Admin Request Read Model). Also scoped to
   * effectively-pending requests only, for the same "one actionable representation"
   * reason. */
  async listAdminRequestsForTeam(teamId: TeamId): Promise<TeamResult<TeamAdminRequest[]>> {
    const gate = this.requireAction(teamId, "revoke_admin_request");
    if (!gate.ok) return gate;
    const now = this.now();
    const forTeam: TeamAdminRequest[] = [];
    for (const request of this.backend.adminRequests.values()) {
      if (request.teamId !== teamId) continue;
      if (deriveAdminRequestStatus(request, now) !== "pending") continue;
      forTeam.push(request);
    }
    return teamOk(forTeam);
  }

  async createAdminRequest(
    teamId: TeamId,
    membershipId: MembershipId
  ): Promise<TeamResult<{ request: TeamAdminRequest } & EmailSendOutcome>> {
    const gate = this.requireAction(teamId, "request_admin_promotion");
    if (!gate.ok) return gate;
    const { team, profile } = gate.value;
    if (team.status !== "active") return teamFailed("archived_team", "This team is archived.");
    const membershipResult = this.membershipInTeam(teamId, membershipId);
    if (!membershipResult.ok) return membershipResult;
    const membership = membershipResult.value;
    if (membership.status !== "active") return teamFailed("conflict", "This membership has already ended.");
    if (this.backend.activeFunctionsForMembership(membershipId).includes("team_admin")) {
      return teamFailed("already_exists", "This member is already a Team Admin.");
    }
    const now = this.now();
    for (const request of this.backend.adminRequests.values()) {
      if (request.membershipId === membershipId && deriveAdminRequestStatus(request, now) === "pending") {
        return teamFailed("conflict", "An Admin Request is already pending for this member.");
      }
    }
    const id = this.backend.nextId("admin-request");
    const request: TeamAdminRequest = {
      id,
      teamId,
      membershipId,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ADMIN_REQUEST_LIFETIME_DAYS * 24 * 60 * 60 * 1000).toISOString(),
      acceptedAt: null,
      revokedAt: null,
      replacedByRequestId: null,
    };
    this.backend.adminRequests.set(id, request);
    this.backend.notify(membership.profileId, "admin_request", { teamId, teamName: team.name, requestId: id });
    this.backend.audit({ teamId, actorProfileId: profile.id, eventType: "admin_request_created", payload: { requestId: id, membershipId } });

    const nomineeEmail = this.backend.emailForProfile(membership.profileId);
    let emailSent = false;
    if (nomineeEmail) {
      const result = await this.emailService.sendAdminRequest({
        toEmail: nomineeEmail,
        teamName: team.name,
        requestedByDisplayName: profile.displayName,
        acceptUrl: `${this.acceptUrlBase}?adminRequest=${id}`,
        expiresAt: request.expiresAt,
      });
      emailSent = result.ok;
    }
    return teamOk({ request, emailSent });
  }

  async revokeAdminRequest(requestId: AdminRequestId): Promise<TeamResult<void>> {
    const request = this.backend.adminRequests.get(requestId);
    if (!request) return teamFailed("not_found", "Admin request not found.");
    const gate = this.requireAction(request.teamId, "revoke_admin_request");
    if (!gate.ok) return gate;
    const { profile } = gate.value;
    const now = this.now();
    if (deriveAdminRequestStatus(request, now) !== "pending") {
      return teamOk(undefined);
    }
    this.backend.adminRequests.set(requestId, { ...request, status: "revoked", revokedAt: now.toISOString() });
    this.backend.resolveAdminRequestNotification(requestId);
    this.backend.audit({ teamId: request.teamId, actorProfileId: profile.id, eventType: "admin_request_revoked", payload: { requestId } });
    return teamOk(undefined);
  }

  async acceptAdminRequest(requestId: AdminRequestId): Promise<TeamResult<void>> {
    const request = this.backend.adminRequests.get(requestId);
    if (!request) return teamFailed("not_found", "Admin request not found.");
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const membership = this.backend.memberships.get(request.membershipId);
    const isNominee = membership?.profileId === profile.id;

    const now = this.now();
    if (deriveAdminRequestStatus(request, now) === "accepted" && isNominee) {
      // Idempotent retry after a prior success (requirement 72).
      return teamOk(undefined);
    }
    const check = checkAdminRequestAcceptable(request, now, isNominee);
    if (!check.ok) return teamFailed(check.reason, "This Admin Request can no longer be accepted.");
    if (!membership || membership.status !== "active") {
      return teamFailed("conflict", "This membership has already ended.");
    }

    this.addFunctionAssignment(membership.id, "team_admin");
    this.backend.adminRequests.set(requestId, { ...request, status: "accepted", acceptedAt: now.toISOString() });
    this.backend.resolveAdminRequestNotification(requestId);
    const team = this.backend.teams.get(request.teamId);
    if (team) {
      const nextStatus = resolveTeamStatusAfterAdminRequestAccepted(team.status);
      if (nextStatus !== team.status) {
        this.backend.teams.set(team.id, { ...team, status: nextStatus });
      }
    }
    this.backend.audit({ teamId: request.teamId, actorProfileId: profile.id, eventType: "admin_request_accepted", payload: { requestId } });
    return teamOk(undefined);
  }

  /** Unread notifications only (docs/adr/0022 §Notification Convergence) — an
   * ordinary notification read is an actionable-inbox view, not a full history.
   * A named history method, if ever added, would be separate and explicit. */
  async listNotifications(): Promise<TeamResult<AccountNotification[]>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const mine = Array.from(this.backend.notifications.values()).filter(
      (n) => n.profileId === profile.id && n.readAt === null
    );
    return teamOk(mine);
  }

  async acknowledgeNotification(notificationId: NotificationId): Promise<TeamResult<void>> {
    const profile = this.myProfile();
    if (!profile) return teamFailed("forbidden", "Profile not found.");
    const notification = this.backend.notifications.get(notificationId);
    if (!notification || notification.profileId !== profile.id) {
      return teamFailed("not_found", "Notification not found.");
    }
    this.backend.notifications.set(notificationId, { ...notification, readAt: this.now().toISOString() });
    return teamOk(undefined);
  }
}
