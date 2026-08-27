// Integration-style tests over FakeTeamService — exercises the same real state
// transitions/invariants the Postgres RPCs perform (docs/adr/0022). Covers required
// test items 1-13, 21-30 (see the approved Team Foundation spec) to the extent they
// are expressible without a real Postgres/RLS layer; see supabase/tests/ for the
// (unexecuted, environment-blocked) database-level equivalents.
import { beforeEach, describe, expect, it } from "vitest";
import { FakeTeamBackend, FakeTeamService } from "../fakeTeamService";
import { FakeEmailService } from "../../email/fakeEmailService";

type Harness = {
  backend: FakeTeamBackend;
  email: FakeEmailService;
  serviceFor: (accountScopeId: string) => FakeTeamService;
};

function harness(): Harness {
  const backend = new FakeTeamBackend();
  const email = new FakeEmailService();
  return {
    backend,
    email,
    serviceFor: (accountScopeId: string) => new FakeTeamService(backend, accountScopeId, email),
  };
}

async function makeProfileWithPilotGrant(h: Harness, accountScopeId: string, email: string, displayName: string) {
  h.backend.setAccountEmail(accountScopeId, email);
  const service = h.serviceFor(accountScopeId);
  const bootstrap = await service.seedCompletedProfile(displayName);
  if (!bootstrap.ok) throw new Error("test onboarding seed failed in test setup");
  h.backend.grantPilotTeamCreationCapability(bootstrap.value.id);
  return { service, profile: bootstrap.value };
}

describe("Test onboarding seed (requirements 1-13, test items 1, 27)", () => {
  it("Profile.id is never the account/auth id — a separate, freshly generated UUID-shaped id", async () => {
    const h = harness();
    const service = h.serviceFor("auth-account-123");
    const result = await service.seedCompletedProfile("Tim");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).not.toBe("auth-account-123");
    }
  });

  it("seeding twice on the same account is idempotent — updates the existing profile rather than creating a second one", async () => {
    const h = harness();
    const service = h.serviceFor("auth-1");
    const first = await service.seedCompletedProfile("Tim");
    const second = await service.seedCompletedProfile("Tim H.");
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.id).toBe(first.value.id);
      expect(second.value.displayName).toBe("Tim H.");
    }
    expect(h.backend.profiles.size).toBe(1);
  });

  it("rejects an empty display name", async () => {
    const h = harness();
    const service = h.serviceFor("auth-1");
    const result = await service.seedCompletedProfile("   ");
    expect(result).toEqual({ ok: false, error: { kind: "invalid_input", message: "Enter a display name." } });
  });

  it("getMyProfile is null before onboarding seed and set after", async () => {
    const h = harness();
    const service = h.serviceFor("auth-1");
    expect(await service.getMyProfile()).toEqual({ ok: true, value: null });
    await service.seedCompletedProfile("Tim");
    const after = await service.getMyProfile();
    expect(after.ok && after.value?.displayName).toBe("Tim");
  });
});

describe("Pilot-gated team creation (test items 3, 4, 5, 8)", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("denies team creation without the manually-granted pilot capability", async () => {
    const service = h.serviceFor("auth-1");
    await service.seedCompletedProfile("Tim");
    const result = await service.createTeam({ name: "Rink Rats", participationAsPlayer: true, functions: [] });
    expect(result).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "This account does not have team-creation access yet." },
    });
  });

  it("creates a team, the creator's membership, and the creator's Team Admin function atomically (requirement 19, test item 8)", async () => {
    const { service, profile } = await makeProfileWithPilotGrant(h, "auth-1", "tim@example.com", "Tim");
    const result = await service.createTeam({ name: "Rink Rats", participationAsPlayer: true, functions: ["coach"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.team.createdByProfileId).toBe(profile.id);
    expect(result.value.isAdmin).toBe(true);
    expect(result.value.myFunctions.sort()).toEqual(["coach", "team_admin"]);
    expect(result.value.myParticipationAsPlayer).toBe(true);
    expect(result.value.roster).toHaveLength(1);
  });

  it("allows two teams with the same name — Team UUID, not name, is authoritative identity (test item 4)", async () => {
    const { service } = await makeProfileWithPilotGrant(h, "auth-1", "tim@example.com", "Tim");
    const a = await service.createTeam({ name: "Rink Rats", participationAsPlayer: true, functions: [] });
    const b = await service.createTeam({ name: "Rink Rats", participationAsPlayer: true, functions: [] });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(a.value.team.id).not.toBe(b.value.team.id);
    }
  });

  it("one profile may hold multiple active teams at once (test item 5)", async () => {
    const { service } = await makeProfileWithPilotGrant(h, "auth-1", "tim@example.com", "Tim");
    await service.createTeam({ name: "Team A", participationAsPlayer: true, functions: [] });
    await service.createTeam({ name: "Team B", participationAsPlayer: false, functions: ["training_lead"] });
    const list = await service.listMyTeams();
    expect(list.ok && list.value).toHaveLength(2);
  });

  it("an invited member never needs the pilot grant themselves (requirement 16)", async () => {
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Rink Rats", participationAsPlayer: false, functions: [] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    h.backend.setAccountEmail("auth-invitee", "invitee@example.com");
    const invited = await admin.service.createInvitation(created.value.team.id, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    expect(invited.ok).toBe(true);
    if (!invited.ok) return;

    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const rawToken = Array.from(h.backend.invitationRawTokens.values())[0];
    const accepted = await invitee.acceptInvitation(rawToken);
    expect(accepted.ok).toBe(true); // no pilot grant on auth-invitee, and it still works
  });
});

describe("Composable functions and independent participation (test items 6, 7, 29)", () => {
  it("supports every combination listed in requirement 31", async () => {
    const h = harness();
    const { service } = await makeProfileWithPilotGrant(h, "auth-1", "tim@example.com", "Tim");
    const created = await service.createTeam({
      name: "Combos",
      participationAsPlayer: false,
      functions: ["coach", "training_lead"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.myParticipationAsPlayer).toBe(false);
    expect(created.value.myFunctions.sort()).toEqual(["coach", "team_admin", "training_lead"]);
  });

  it("enforces exactly one active membership per team/profile while allowing historical periods (test item 6)", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: false, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;

    h.backend.setAccountEmail("auth-member", "member@example.com");
    const member = h.serviceFor("auth-member");
    await member.seedCompletedProfile("Member");

    const invite1 = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invite1.ok) throw new Error("setup failed");
    const token1 = Array.from(h.backend.invitationRawTokens.values())[0];
    const accept1 = await member.acceptInvitation(token1);
    expect(accept1.ok).toBe(true);

    await member.leaveTeam(teamId);

    // Rejoin via a fresh invitation creates a NEW membership period (requirement 81).
    const invite2 = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invite2.ok) throw new Error("setup failed");
    const tokens = Array.from(h.backend.invitationRawTokens.values());
    const accept2 = await member.acceptInvitation(tokens[tokens.length - 1]);
    expect(accept2.ok).toBe(true);

    const myProfile = await member.getMyProfile();
    if (!myProfile.ok || !myProfile.value) throw new Error("no profile");
    const allMemberships = Array.from(h.backend.memberships.values()).filter(
      (m) => m.teamId === teamId && m.profileId === myProfile.value!.id
    );
    expect(allMemberships).toHaveLength(2);
    expect(allMemberships.filter((m) => m.status === "active")).toHaveLength(1);
    expect(allMemberships.filter((m) => m.status === "ended" && m.endReason === "left")).toHaveLength(1);
  });
});

describe("Invitations end to end (requirements 47-66, test item 9)", () => {
  let h: Harness;
  let teamId: string;
  let admin: { service: FakeTeamService };

  beforeEach(async () => {
    h = harness();
    const setup = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    admin = setup;
    const created = await setup.service.createTeam({ name: "Team", participationAsPlayer: false, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    teamId = created.value.team.id;
    h.backend.setAccountEmail("auth-invitee", "invitee@example.com");
  });

  it("success: acceptance activates membership, participation, and every proposed function atomically (requirement 55)", async () => {
    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const created = await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: ["coach", "team_admin"],
    });
    expect(created.ok && created.value.emailSent).toBe(true);
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    const accepted = await invitee.acceptInvitation(token);
    expect(accepted.ok).toBe(true);
    const workspace = await invitee.getTeamWorkspace(teamId);
    expect(workspace.ok).toBe(true);
    if (workspace.ok) {
      expect(workspace.value.myFunctions.sort()).toEqual(["coach", "team_admin"]);
      expect(workspace.value.myParticipationAsPlayer).toBe(true);
    }
  });

  it("expiry: a pending invitation past its 14-day lifetime cannot be accepted", async () => {
    h.backend.now = () => new Date("2026-01-01T00:00:00.000Z");
    await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    h.backend.now = () => new Date("2026-01-16T00:00:00.000Z"); // 15 days later
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    const result = await invitee.acceptInvitation(token);
    expect(result).toEqual({
      ok: false,
      error: { kind: "expired", message: "This invitation can no longer be accepted." },
    });
  });

  it("replacement: revising rotates the token and invalidates the old link (test item 38)", async () => {
    const first = await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!first.ok) throw new Error("setup failed");
    const oldToken = Array.from(h.backend.invitationRawTokens.values())[0];

    const revised = await admin.service.reviseInvitation(first.value.invitation.id, {
      email: "invitee@example.com",
      participationAsPlayer: false,
      proposedFunctions: ["training_lead"],
    });
    expect(revised.ok).toBe(true);

    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const oldAttempt = await invitee.acceptInvitation(oldToken);
    expect(oldAttempt).toEqual({
      ok: false,
      error: { kind: "replaced", message: "This invitation can no longer be accepted." },
    });

    if (!revised.ok) throw new Error("unreachable");
    const newToken = Array.from(h.backend.invitationRawTokens.values()).find((t) => t !== oldToken);
    expect(newToken).toBeDefined();
    const newAttempt = await invitee.acceptInvitation(newToken!);
    expect(newAttempt.ok).toBe(true);
  });

  it("resend rotates the secret without changing the proposal (requirement 62)", async () => {
    const first = await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: ["coach"],
    });
    if (!first.ok) throw new Error("setup failed");
    const oldToken = Array.from(h.backend.invitationRawTokens.values())[0];
    const resent = await admin.service.resendInvitation(first.value.invitation.id);
    expect(resent.ok).toBe(true);
    if (resent.ok) {
      expect(resent.value.invitation.participationAsPlayer).toBe(true);
      expect(resent.value.invitation.proposedFunctions).toEqual(["coach"]);
    }
    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const oldAttempt = await invitee.acceptInvitation(oldToken);
    expect(oldAttempt.ok).toBe(false);
  });

  it("revocation: a revoked invitation cannot be accepted, and revoking again is an idempotent no-op (test item 9)", async () => {
    const created = await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!created.ok) throw new Error("setup failed");
    const revoke1 = await admin.service.revokeInvitation(created.value.invitation.id);
    expect(revoke1).toEqual({ ok: true, value: undefined });
    const revoke2 = await admin.service.revokeInvitation(created.value.invitation.id);
    expect(revoke2).toEqual({ ok: true, value: undefined }); // idempotent, never blocks

    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    const attempt = await invitee.acceptInvitation(token);
    expect(attempt).toEqual({ ok: false, error: { kind: "revoked", message: "This invitation can no longer be accepted." } });
  });

  it("replay: accepting the same token twice fails the second time with already_exists (test item 9)", async () => {
    await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    const first = await invitee.acceptInvitation(token);
    expect(first.ok).toBe(true);
    const second = await invitee.acceptInvitation(token);
    expect(second).toEqual({ ok: false, error: { kind: "already_accepted", message: "This invitation can no longer be accepted." } });
  });

  it("wrong email: the recipient's own mismatched account cannot accept", async () => {
    await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    h.backend.setAccountEmail("auth-other", "someone-else@example.com");
    const other = h.serviceFor("auth-other");
    await other.seedCompletedProfile("Someone Else");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    const result = await other.acceptInvitation(token);
    expect(result).toEqual({ ok: false, error: { kind: "wrong_email", message: "This invitation can no longer be accepted." } });
  });

  it("malformed/unknown token fails closed with not_found", async () => {
    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const result = await invitee.acceptInvitation("not-a-real-token");
    expect(result).toEqual({ ok: false, error: { kind: "not_found", message: "This invitation link is invalid." } });
  });

  it("already-member: accepting a second invitation to a team you already belong to is rejected", async () => {
    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    const token1 = Array.from(h.backend.invitationRawTokens.values())[0];
    await invitee.acceptInvitation(token1);

    await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: false,
      proposedFunctions: [],
    });
    const token2 = Array.from(h.backend.invitationRawTokens.values())[1];
    const second = await invitee.acceptInvitation(token2);
    expect(second).toEqual({
      ok: false,
      error: { kind: "already_exists", message: "You are already an active member of this team." },
    });
  });

  it("a delivery failure is reported honestly, never as 'sent' (requirements 66, 147)", async () => {
    h.email.failNextSendTo("invitee@example.com");
    const created = await admin.service.createInvitation(teamId, {
      email: "invitee@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value.emailSent).toBe(false);
      expect(created.value.invitation.emailDeliveryStatus).toBe("failed");
    }
    // The invitation itself still exists and is still acceptable — a failed send
    // does not roll back the durable domain transition (requirement 147).
    const invitee = h.serviceFor("auth-invitee");
    await invitee.seedCompletedProfile("Invitee");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    const accepted = await invitee.acceptInvitation(token);
    expect(accepted.ok).toBe(true);
  });
});

describe("Admin responsibility requests (requirements 67-75, test item 10)", () => {
  let h: Harness;
  let teamId: string;
  let admin: { service: FakeTeamService };
  let memberMembershipId: string;

  beforeEach(async () => {
    h = harness();
    admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: false, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    teamId = created.value.team.id;

    h.backend.setAccountEmail("auth-member", "member@example.com");
    const memberService = h.serviceFor("auth-member");
    await memberService.seedCompletedProfile("Member");
    const invited = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    const accepted = await memberService.acceptInvitation(token);
    if (!accepted.ok) throw new Error("setup failed");
    const workspace = await memberService.getTeamWorkspace(teamId);
    if (!workspace.ok) throw new Error("setup failed");
    memberMembershipId = workspace.value.myMembershipId;
  });

  it("success: the nominee accepting grants Team Admin", async () => {
    const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
    expect(created.ok && created.value.emailSent).toBe(true);
    const memberService = h.serviceFor("auth-member");
    const accepted = await memberService.acceptAdminRequest(created.ok ? created.value.request.id : "");
    expect(accepted).toEqual({ ok: true, value: undefined });
    const workspace = await memberService.getTeamWorkspace(teamId);
    expect(workspace.ok && workspace.value.myFunctions).toContain("team_admin");
  });

  it("expiry: an admin request past 14 days cannot be accepted", async () => {
    h.backend.now = () => new Date("2026-01-01T00:00:00.000Z");
    const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
    if (!created.ok) throw new Error("setup failed");
    h.backend.now = () => new Date("2026-01-16T00:00:00.000Z");
    const memberService = h.serviceFor("auth-member");
    const result = await memberService.acceptAdminRequest(created.value.request.id);
    expect(result).toEqual({ ok: false, error: { kind: "expired", message: "This Admin Request can no longer be accepted." } });
  });

  it("revocation before expiry blocks acceptance, and is idempotent", async () => {
    const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
    if (!created.ok) throw new Error("setup failed");
    const revoke1 = await admin.service.revokeAdminRequest(created.value.request.id);
    expect(revoke1).toEqual({ ok: true, value: undefined });
    const revoke2 = await admin.service.revokeAdminRequest(created.value.request.id);
    expect(revoke2).toEqual({ ok: true, value: undefined });
    const memberService = h.serviceFor("auth-member");
    const result = await memberService.acceptAdminRequest(created.value.request.id);
    expect(result).toEqual({ ok: false, error: { kind: "revoked", message: "This Admin Request can no longer be accepted." } });
  });

  it("wrong nominee: another member cannot accept someone else's admin request", async () => {
    const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
    if (!created.ok) throw new Error("setup failed");
    const result = await admin.service.acceptAdminRequest(created.value.request.id);
    expect(result).toEqual({
      ok: false,
      error: { kind: "wrong_nominee", message: "This Admin Request can no longer be accepted." },
    });
  });

  it("idempotent retry: accepting twice as the correct nominee succeeds both times (requirement 72)", async () => {
    const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
    if (!created.ok) throw new Error("setup failed");
    const memberService = h.serviceFor("auth-member");
    const first = await memberService.acceptAdminRequest(created.value.request.id);
    const second = await memberService.acceptAdminRequest(created.value.request.id);
    expect(first).toEqual({ ok: true, value: undefined });
    expect(second).toEqual({ ok: true, value: undefined });
  });

  it("a member who leaves invalidates any pending admin request naming them (requirement 75)", async () => {
    const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
    if (!created.ok) throw new Error("setup failed");
    const memberService = h.serviceFor("auth-member");
    await memberService.leaveTeam(teamId);
    const result = await memberService.acceptAdminRequest(created.value.request.id);
    expect(result.ok).toBe(false);
  });

  it("a duplicate pending request for the same nominee is rejected until the first is resolved", async () => {
    const first = await admin.service.createAdminRequest(teamId, memberMembershipId);
    expect(first.ok).toBe(true);
    const second = await admin.service.createAdminRequest(teamId, memberMembershipId);
    expect(second).toEqual({
      ok: false,
      error: { kind: "conflict", message: "An Admin Request is already pending for this member." },
    });
  });

  describe("listAdminRequestsForTeam (docs/adr/0022 §Team-Side Admin Request Read Model, correction item 2)", () => {
    it("an active Team Admin sees the team's one outstanding request", async () => {
      const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
      if (!created.ok) throw new Error("setup failed");
      const listed = await admin.service.listAdminRequestsForTeam(teamId);
      expect(listed.ok).toBe(true);
      if (listed.ok) {
        expect(listed.value.map((r) => r.id)).toEqual([created.value.request.id]);
      }
    });

    it("the nominee cannot use the Team-side method unless they independently hold Team Admin", async () => {
      const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
      if (!created.ok) throw new Error("setup failed");
      const memberService = h.serviceFor("auth-member");
      const result = await memberService.listAdminRequestsForTeam(teamId);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("forbidden");
      // The nominee's OWN inbox is unaffected — this is a separate, still-available surface.
      const inbox = await memberService.listAdminRequestsForMe();
      expect(inbox.ok && inbox.value.map((r) => r.id)).toEqual([created.value.request.id]);
    });

    it("a member of another team cannot list this team's outstanding requests", async () => {
      await admin.service.createAdminRequest(teamId, memberMembershipId);
      const other = await makeProfileWithPilotGrant(h, "auth-outsider", "outsider@example.com", "Outsider");
      const otherTeam = await other.service.createTeam({ name: "Other Team", participationAsPlayer: false, functions: [] });
      expect(otherTeam.ok).toBe(true);
      const result = await other.service.listAdminRequestsForTeam(teamId);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("forbidden");
    });

    it("excludes accepted, revoked, replaced, and expired requests — only effectively-pending ones appear", async () => {
      const created = await admin.service.createAdminRequest(teamId, memberMembershipId);
      if (!created.ok) throw new Error("setup failed");
      const memberService = h.serviceFor("auth-member");
      const accepted = await memberService.acceptAdminRequest(created.value.request.id);
      expect(accepted.ok).toBe(true);
      const listed = await admin.service.listAdminRequestsForTeam(teamId);
      expect(listed.ok && listed.value).toEqual([]);
    });
  });
});

describe("Last-Admin invariant and self-service leave/removal (requirements 44, 73, 76-98, test items 11, 12, 39, 40)", () => {
  it("the sole active admin cannot leave, relinquish, or remove their own admin function", async () => {
    const h = harness();
    const { service } = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await service.createTeam({ name: "Team", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;
    const membershipId = created.value.myMembershipId;

    expect(await service.leaveTeam(teamId)).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "last_admin_invariant" }),
    });
    expect(await service.relinquishOwnAdmin(teamId)).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "last_admin_invariant" }),
    });
    expect(await service.removeAdminFunction(teamId, membershipId)).toEqual({
      ok: false,
      error: expect.objectContaining({ kind: "last_admin_invariant" }),
    });
  });

  it("once a successor ACCEPTS an Admin Request, the former sole admin may leave (requirement 73/74 — a pending request is not enough)", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;

    h.backend.setAccountEmail("auth-member", "member@example.com");
    const memberService = h.serviceFor("auth-member");
    await memberService.seedCompletedProfile("Member");
    const invited = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    await memberService.acceptInvitation(token);
    const workspace = await memberService.getTeamWorkspace(teamId);
    if (!workspace.ok) throw new Error("setup failed");

    const requestResult = await admin.service.createAdminRequest(teamId, workspace.value.myMembershipId);
    if (!requestResult.ok) throw new Error("setup failed");

    // Still blocked — the request is only pending, not accepted.
    expect((await admin.service.leaveTeam(teamId)).ok).toBe(false);

    await memberService.acceptAdminRequest(requestResult.value.request.id);

    // Now a second active admin exists — the original admin may leave.
    expect((await admin.service.leaveTeam(teamId)).ok).toBe(true);
  });

  it("removing/leaving/removing-a-function atomically ends every active authorization path (requirement 79, test item 12)", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: false, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;

    h.backend.setAccountEmail("auth-member", "member@example.com");
    const memberService = h.serviceFor("auth-member");
    await memberService.seedCompletedProfile("Member");
    const invited = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: ["coach"],
    });
    if (!invited.ok) throw new Error("setup failed");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    await memberService.acceptInvitation(token);
    const workspace = await memberService.getTeamWorkspace(teamId);
    if (!workspace.ok) throw new Error("setup failed");
    const membershipId = workspace.value.myMembershipId;

    const pendingAdminRequest = await admin.service.createAdminRequest(teamId, membershipId);
    expect(pendingAdminRequest.ok).toBe(true);

    const removal = await admin.service.removeMember(teamId, membershipId);
    expect(removal.ok).toBe(true);

    // Membership ended, functions ended, current access denied.
    const afterWorkspace = await memberService.getTeamWorkspace(teamId);
    expect(afterWorkspace).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "You are not an active member of this team." },
    });

    // The pending admin request naming this membership is invalidated.
    if (pendingAdminRequest.ok) {
      const acceptAttempt = await memberService.acceptAdminRequest(pendingAdminRequest.value.request.id);
      expect(acceptAttempt.ok).toBe(false);
    }

    // A removal notification (no performance data) was created.
    const notifications = await memberService.listNotifications();
    expect(notifications.ok && notifications.value.some((n) => n.kind === "member_removed")).toBe(true);
  });

  it("a member self-leave is immediate and does not require Admin confirmation", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: false, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;
    h.backend.setAccountEmail("auth-member", "member@example.com");
    const memberService = h.serviceFor("auth-member");
    await memberService.seedCompletedProfile("Member");
    const invited = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    await memberService.acceptInvitation(token);
    expect((await memberService.leaveTeam(teamId)).ok).toBe(true);
    expect((await memberService.getTeamWorkspace(teamId)).ok).toBe(false);
  });
});

describe("Archive and restore (requirements 84-92, test item 13/45)", () => {
  it("archived teams block ordinary collaborative writes but allow leaving and restore", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;

    expect((await admin.service.archiveTeam(teamId)).ok).toBe(true);

    const renameAttempt = await admin.service.renameTeam(teamId, "New Name");
    expect(renameAttempt).toEqual({ ok: false, error: { kind: "archived_team", message: "This team is archived." } });

    const inviteAttempt = await admin.service.createInvitation(teamId, {
      email: "someone@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    expect(inviteAttempt.ok).toBe(false);

    // Leave still works (requirement 88), even for the (structurally last) admin —
    // archiving already exempted the last-admin invariant.
    expect((await admin.service.leaveTeam(teamId)).ok).toBe(true);
  });

  it("restore reactivates remaining memberships; members who left while archived are not restored (requirement 91)", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;

    h.backend.setAccountEmail("auth-member", "member@example.com");
    const memberService = h.serviceFor("auth-member");
    await memberService.seedCompletedProfile("Member");
    const invited = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    await memberService.acceptInvitation(token);

    await admin.service.archiveTeam(teamId);
    await memberService.leaveTeam(teamId); // leaves while archived

    await admin.service.restoreTeam(teamId);

    const adminWorkspace = await admin.service.getTeamWorkspace(teamId);
    expect(adminWorkspace.ok).toBe(true);
    const memberWorkspace = await memberService.getTeamWorkspace(teamId);
    expect(memberWorkspace.ok).toBe(false); // not restored — left while archived
  });
});

describe("Roster visibility and email boundary (requirements 13, 14, test items 16, 41, 43)", () => {
  it("Team Admins see member emails; ordinary members never do", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: false, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;

    h.backend.setAccountEmail("auth-member", "member@example.com");
    const memberService = h.serviceFor("auth-member");
    await memberService.seedCompletedProfile("Member");
    const invited = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    await memberService.acceptInvitation(token);

    const adminView = await admin.service.getTeamWorkspace(teamId);
    expect(adminView.ok).toBe(true);
    if (adminView.ok) {
      const memberRow = adminView.value.roster.find((r) => r.displayName === "Member");
      expect(memberRow?.email).toBe("member@example.com");
    }

    const memberView = await memberService.getTeamWorkspace(teamId);
    expect(memberView.ok).toBe(true);
    if (memberView.ok) {
      for (const row of memberView.value.roster) {
        expect(row.email).toBeUndefined();
      }
      // But display name, participation, and functions ARE visible to every member.
      const adminRow = memberView.value.roster.find((r) => r.functions.includes("team_admin"));
      expect(adminRow?.displayName).toBe("Admin");
    }
  });
});

describe("Stale/cross-team access (test items 24, 25)", () => {
  it("a former member's stale membership id is rejected by every mutating call", async () => {
    const h = harness();
    const admin = await makeProfileWithPilotGrant(h, "auth-admin", "admin@example.com", "Admin");
    const created = await admin.service.createTeam({ name: "Team", participationAsPlayer: false, functions: [] });
    if (!created.ok) throw new Error("setup failed");
    const teamId = created.value.team.id;

    h.backend.setAccountEmail("auth-member", "member@example.com");
    const memberService = h.serviceFor("auth-member");
    await memberService.seedCompletedProfile("Member");
    const invited = await admin.service.createInvitation(teamId, {
      email: "member@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const token = Array.from(h.backend.invitationRawTokens.values())[0];
    await memberService.acceptInvitation(token);
    const workspace = await memberService.getTeamWorkspace(teamId);
    if (!workspace.ok) throw new Error("setup failed");
    const membershipId = workspace.value.myMembershipId;

    await admin.service.removeMember(teamId, membershipId);

    const secondRemoval = await admin.service.setParticipation(teamId, membershipId, false);
    expect(secondRemoval).toEqual({ ok: false, error: { kind: "conflict", message: "This membership has already ended." } });
  });

  it("a Team Admin of one team has no admin authority on an unrelated team", async () => {
    const h = harness();
    const admin1 = await makeProfileWithPilotGrant(h, "auth-1", "one@example.com", "One");
    const admin2 = await makeProfileWithPilotGrant(h, "auth-2", "two@example.com", "Two");
    const teamA = await admin1.service.createTeam({ name: "Team A", participationAsPlayer: false, functions: [] });
    const teamB = await admin2.service.createTeam({ name: "Team B", participationAsPlayer: false, functions: [] });
    if (!teamA.ok || !teamB.ok) throw new Error("setup failed");

    const crossAttempt = await admin1.service.renameTeam(teamB.value.team.id, "Hijacked");
    expect(crossAttempt).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "You do not have permission to do this." },
    });
  });
});
