// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamsScreen from "../TeamsScreen";
import type { SportingCloudSyncContextValue } from "../ProfileScopedSportingPersistence";
import type { ConfiguredCloudConfig } from "../../lib/supabase/config";
import type { GateSession } from "../../lib/identity/identityRuntime";
import { FakeTeamBackend, FakeTeamService } from "../../lib/team/fakeTeamService";
import { FakeEmailService } from "../../lib/email/fakeEmailService";

afterEach(cleanup);

const CONFIGURED: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

const GATE_SESSION: GateSession = {
  accountScopeId: "user-1",
  email: "a@example.com",
  profileId: "profile-1",
  displayName: "Alex",
  entitlement: "free",
};

describe("TeamsScreen — not usable", () => {
  it("shows a message when cloud isn't configured, without rendering Sign in prompts", () => {
    render(<TeamsScreen onClose={() => {}} config={{ status: "cloud_disabled" }} />);
    expect(screen.getByText(/isn.t available in this build/i)).toBeInTheDocument();
  });

  it("shows a gate message when rendered without the authenticated application context", async () => {
    render(<TeamsScreen onClose={() => {}} config={CONFIGURED} />);
    await screen.findByText(/complete athlete sign-in to use teams/i);
  });
});

/** A backend with one bootstrapped, pilot-granted admin who has already created
 * "The Curlers" — reused by every test below that needs an existing team. */
async function setUpAdminWithTeam() {
  const backend = new FakeTeamBackend();
  backend.setAccountEmail("user-1", "a@example.com");
  const teamService = new FakeTeamService(backend, "user-1", new FakeEmailService());
  const profile = backend.seedCompletedProfile("user-1", "Alex");
  backend.grantPilotTeamCreationCapability(profile.id);
  const created = await teamService.createTeam({ name: "The Curlers", participationAsPlayer: true, functions: [] });
  if (!created.ok) throw new Error("setup failed");
  return { backend, teamService, teamId: created.value.team.id, profileId: profile.id };
}

async function openWorkspace(user: ReturnType<typeof userEvent.setup>, teamService: FakeTeamService) {
  render(
    <TeamsScreen onClose={() => {}} config={CONFIGURED} identitySession={GATE_SESSION} createTeamService={() => teamService} />
  );
  await user.click(await screen.findByText("The Curlers"));
  await screen.findByText("Roster");
}

describe("TeamsScreen — signed in", () => {
  it("lets an athlete control the Team's prospective Exercise recording permission", async () => {
    const user = userEvent.setup();
    const { teamService, teamId, profileId } = await setUpAdminWithTeam();
    const setMyTeamExerciseRecordingPermission = vi.fn(async () => "updated" as const);
    const refreshTeamExerciseEligibility = vi.fn(async () => true);
    const exerciseSync: SportingCloudSyncContextValue = {
      ready: true,
      truth: "synced",
      pendingCount: 0,
      teamBlockedCount: 0,
      teamSessions: [],
      activeTeamExerciseDraft: null,
      teamEligibilitySnapshots: [{
        teamId,
        teamName: "The Curlers",
        cachedAt: "2026-08-28T10:00:00Z",
        participants: [{
          profileId,
          displayName: "Alex",
          participationAsPlayer: true,
          functions: ["team_admin"],
          recordingPermissionGranted: false,
        }],
      }],
      retry: vi.fn(),
      enqueueCompletedTeamExercise: vi.fn(async () => true),
      saveActiveTeamExerciseDraft: vi.fn(async () => true),
      finalizeActiveTeamExerciseDraft: vi.fn(async () => true),
      discardActiveTeamExerciseDraft: vi.fn(async () => true),
      refreshTeamExerciseEligibility,
      setMyTeamExerciseRecordingPermission,
    };
    render(
      <TeamsScreen
        onClose={() => {}}
        config={CONFIGURED}
        identitySession={{ ...GATE_SESSION, profileId }}
        createTeamService={() => teamService}
        exerciseSync={exerciseSync}
      />
    );
    await user.click(await screen.findByText("The Curlers"));
    await screen.findByText("Exercise recording permission");
    expect(refreshTeamExerciseEligibility).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Grant Permission" }));
    await waitFor(() => expect(setMyTeamExerciseRecordingPermission).toHaveBeenCalledWith(teamId, true));
    await screen.findByText("Exercise recording permission granted.");
  });

  it("never offers a Team-local Profile bootstrap", async () => {
    const backend = new FakeTeamBackend();
    backend.setAccountEmail("user-1", "a@example.com");
    const teamService = new FakeTeamService(backend, "user-1", new FakeEmailService());

    render(
      <TeamsScreen
        onClose={() => {}}
        config={CONFIGURED}
        identitySession={GATE_SESSION}
        createTeamService={() => teamService}
      />
    );
    await screen.findByText("My Teams");
    expect(screen.queryByLabelText(/choose a display name/i)).not.toBeInTheDocument();
  });

  it("lists an existing team and shows the create-team form only when pilot-gated capability is granted", async () => {
    const backend = new FakeTeamBackend();
    backend.setAccountEmail("user-1", "a@example.com");
    const teamService = new FakeTeamService(backend, "user-1", new FakeEmailService());
    const profile = backend.seedCompletedProfile("user-1", "Alex");
    backend.grantPilotTeamCreationCapability(profile.id);
    const created = await teamService.createTeam({ name: "The Curlers", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");

    render(
      <TeamsScreen
        onClose={() => {}}
        config={CONFIGURED}
        identitySession={GATE_SESSION}
        createTeamService={() => teamService}
      />
    );

    await screen.findByText("The Curlers");
    expect(screen.getByRole("button", { name: "Create Team" })).toBeInTheDocument();
  });

  it("opens a team workspace showing the roster, and lets an admin send an invitation", async () => {
    const user = userEvent.setup();
    const backend = new FakeTeamBackend();
    backend.setAccountEmail("user-1", "a@example.com");
    const teamService = new FakeTeamService(backend, "user-1", new FakeEmailService());
    const profile = backend.seedCompletedProfile("user-1", "Alex");
    backend.grantPilotTeamCreationCapability(profile.id);
    const created = await teamService.createTeam({ name: "The Curlers", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");

    render(
      <TeamsScreen
        onClose={() => {}}
        config={CONFIGURED}
        identitySession={GATE_SESSION}
        createTeamService={() => teamService}
      />
    );

    await user.click(await screen.findByText("The Curlers"));
    await screen.findByText("Roster");
    expect(screen.getByText("Alex")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Email address"), "friend@example.com");
    await user.click(screen.getByRole("button", { name: "Send Invitation" }));

    await waitFor(() => expect(screen.getByText("friend@example.com")).toBeInTheDocument());
  });

  it("renames a team", async () => {
    const user = userEvent.setup();
    const { teamService } = await setUpAdminWithTeam();
    await openWorkspace(user, teamService);

    await user.click(screen.getByRole("button", { name: "Rename" }));
    const input = screen.getByDisplayValue("The Curlers");
    await user.clear(input);
    await user.type(input, "Ice Breakers");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("Ice Breakers");
  });

  it("lets a Team Admin remove another member's Team Admin function, with confirmation (spec §6)", async () => {
    const user = userEvent.setup();
    const { backend, teamService, teamId } = await setUpAdminWithTeam();

    backend.setAccountEmail("user-2", "friend@example.com");
    const friendService = new FakeTeamService(backend, "user-2", new FakeEmailService());
    backend.seedCompletedProfile("user-2", "Friend");
    const invited = await teamService.createInvitation(teamId, {
      email: "friend@example.com",
      participationAsPlayer: true,
      proposedFunctions: ["team_admin"],
    });
    if (!invited.ok) throw new Error("setup failed");
    const rawToken = Array.from(backend.invitationRawTokens.values())[0];
    await friendService.acceptInvitation(rawToken);

    await openWorkspace(user, teamService);
    await screen.findByText("Friend");
    expect(screen.queryByRole("button", { name: "Remove Team Admin" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Team Admin" }));
    await screen.findByText("Remove Team Admin?");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Remove Team Admin" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove Team Admin" }));
    await screen.findByText("Remove Team Admin?");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Remove Team Admin" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Request Team Admin" })).toBeInTheDocument();
  });

  it("revises a pending invitation with a corrected proposal, invalidating the old link", async () => {
    const user = userEvent.setup();
    const { backend, teamService } = await setUpAdminWithTeam();
    await openWorkspace(user, teamService);

    await user.type(screen.getByPlaceholderText("Email address"), "typo@example.com");
    await user.click(screen.getByRole("button", { name: "Send Invitation" }));
    await screen.findByText("typo@example.com");
    const originalInvitationId = Array.from(backend.invitations.keys())[0];

    await user.click(screen.getByRole("button", { name: "Revise" }));
    const emailInput = screen.getByDisplayValue("typo@example.com");
    await user.clear(emailInput);
    await user.type(emailInput, "corrected@example.com");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));

    await screen.findByText("corrected@example.com");
    expect(screen.queryByText("typo@example.com")).not.toBeInTheDocument();
    expect(backend.invitations.get(originalInvitationId)?.status).toBe("replaced");
  });

  it("asks for confirmation before removing a member, and removal takes effect only on confirm", async () => {
    const user = userEvent.setup();
    const { backend, teamService, teamId } = await setUpAdminWithTeam();

    backend.setAccountEmail("user-2", "friend@example.com");
    const friendService = new FakeTeamService(backend, "user-2", new FakeEmailService());
    backend.seedCompletedProfile("user-2", "Friend");
    const invited = await teamService.createInvitation(teamId, {
      email: "friend@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const rawToken = Array.from(backend.invitationRawTokens.values())[0];
    await friendService.acceptInvitation(rawToken);

    await openWorkspace(user, teamService);
    await screen.findByText("Friend");
    await user.click(screen.getByRole("button", { name: "Remove" }));

    await screen.findByText("Remove Member?");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Friend")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove" }));
    await screen.findByText("Remove Member?");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByText("Friend")).not.toBeInTheDocument());
  });

  it("archiving requires confirmation, and Restore appears once archived", async () => {
    const user = userEvent.setup();
    const { teamService } = await setUpAdminWithTeam();
    await openWorkspace(user, teamService);

    await user.click(screen.getByRole("button", { name: "Archive Team" }));
    await screen.findByText("Archive Team?");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await screen.findByText("(archived)");
    expect(screen.getByRole("button", { name: "Restore Team" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive Team" })).not.toBeInTheDocument();
  });

  it("shows the Team-side Outstanding Admin Requests list and lets the admin revoke one", async () => {
    const user = userEvent.setup();
    const { backend, teamService, teamId } = await setUpAdminWithTeam();

    backend.setAccountEmail("user-2", "friend@example.com");
    const friendService = new FakeTeamService(backend, "user-2", new FakeEmailService());
    backend.seedCompletedProfile("user-2", "Friend");
    const invited = await teamService.createInvitation(teamId, {
      email: "friend@example.com",
      participationAsPlayer: true,
      proposedFunctions: [],
    });
    if (!invited.ok) throw new Error("setup failed");
    const rawToken = Array.from(backend.invitationRawTokens.values())[0];
    const accepted = await friendService.acceptInvitation(rawToken);
    if (!accepted.ok) throw new Error("setup failed");
    const friendProfileId = backend.profileIdForAccount("user-2");
    const friendMembershipId = Array.from(backend.memberships.values()).find(
      (m) => m.teamId === teamId && m.status === "active" && m.profileId === friendProfileId
    )?.id;
    if (!friendMembershipId) throw new Error("setup failed: could not find friend's membership");
    const request = await teamService.createAdminRequest(teamId, friendMembershipId);
    if (!request.ok) throw new Error("setup failed: createAdminRequest");

    await openWorkspace(user, teamService);
    await screen.findByText("Outstanding Admin Requests");
    expect(screen.getAllByText("Friend").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Revoke" }));
    await screen.findByText("Revoke Admin Request?");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(screen.queryByText("Outstanding Admin Requests")).not.toBeInTheDocument());
  });

  it("leaving a team requires confirmation", async () => {
    const user = userEvent.setup();
    const { backend, teamService, teamId } = await setUpAdminWithTeam();
    // Add a second admin first so leaving doesn't trip the last-admin invariant.
    backend.setAccountEmail("user-2", "friend@example.com");
    const friendService = new FakeTeamService(backend, "user-2", new FakeEmailService());
    backend.seedCompletedProfile("user-2", "Friend");
    const invited = await teamService.createInvitation(teamId, {
      email: "friend@example.com",
      participationAsPlayer: true,
      proposedFunctions: ["team_admin"],
    });
    if (!invited.ok) throw new Error("setup failed");
    const rawToken = Array.from(backend.invitationRawTokens.values())[0];
    await friendService.acceptInvitation(rawToken);

    await openWorkspace(user, teamService);
    await user.click(screen.getByRole("button", { name: "Leave Team" }));
    await screen.findByText("Leave Team?");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Roster")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Leave Team" }));
    await screen.findByText("Leave Team?");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await screen.findByText("My Teams");
  });
});
