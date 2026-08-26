// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamsScreen from "../TeamsScreen";
import type {
  AccountIdentity,
  AuthService,
  AuthServiceResult,
  SessionRestoreOutcome,
} from "../../lib/supabase/authService";
import { authOk } from "../../lib/supabase/authService";
import type { ConfiguredCloudConfig } from "../../lib/supabase/config";
import { FakeTeamBackend, FakeTeamService } from "../../lib/team/fakeTeamService";
import { FakeEmailService } from "../../lib/email/fakeEmailService";

afterEach(cleanup);

const CONFIGURED: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

const IDENTITY: AccountIdentity = { accountScopeId: "user-1", email: "a@example.com" };

/** TRANSITIONAL (Stage B0.2b): `AuthService` now speaks ADR-0025 Decision 2's
 * five session-restore outcomes instead of a single `getSession()` result.
 * These fakes keep expressing their intent as "signed in as X" / "signed out"
 * / "restore failed" and translate here, so the component behaviour under test
 * is unchanged. */
function toRestoreOutcome(
  result: AuthServiceResult<AccountIdentity | null>
): SessionRestoreOutcome {
  if (!result.ok) return { kind: "restore_failed" };
  return result.value ? { kind: "authenticated", identity: result.value } : { kind: "no_session" };
}

function signedInAuthService(): AuthService {
  return {
    restoreSession: vi.fn(async () => toRestoreOutcome(authOk(IDENTITY))),
    onAuthChange: vi.fn(() => () => {}),
    requestEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    signOut: vi.fn(),
  };
}

describe("TeamsScreen — not usable", () => {
  it("shows a message when cloud isn't configured, without rendering Sign in prompts", () => {
    render(<TeamsScreen onClose={() => {}} config={{ status: "cloud_disabled" }} />);
    expect(screen.getByText(/isn.t available in this build/i)).toBeInTheDocument();
  });

  it("shows a sign-in prompt when configured but signed out", async () => {
    const authService: AuthService = {
      restoreSession: vi.fn(async () => toRestoreOutcome(authOk(null))),
      onAuthChange: vi.fn(() => () => {}),
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      signOut: vi.fn(),
    };
    render(<TeamsScreen onClose={() => {}} config={CONFIGURED} createAuthService={() => authService} />);
    await screen.findByText(/sign in above to use teams/i);
  });
});

/** A backend with one bootstrapped, pilot-granted admin who has already created
 * "The Curlers" — reused by every test below that needs an existing team. */
async function setUpAdminWithTeam() {
  const backend = new FakeTeamBackend();
  backend.setAccountEmail("user-1", "a@example.com");
  const teamService = new FakeTeamService(backend, "user-1", new FakeEmailService());
  const profile = await teamService.bootstrapProfile("Alex");
  if (!profile.ok) throw new Error("setup failed");
  backend.grantPilotTeamCreationCapability(profile.value.id);
  const created = await teamService.createTeam({ name: "The Curlers", participationAsPlayer: true, functions: [] });
  if (!created.ok) throw new Error("setup failed");
  return { backend, teamService, teamId: created.value.team.id };
}

async function openWorkspace(user: ReturnType<typeof userEvent.setup>, teamService: FakeTeamService) {
  render(
    <TeamsScreen onClose={() => {}} config={CONFIGURED} createAuthService={signedInAuthService} createTeamService={() => teamService} />
  );
  await user.click(await screen.findByText("The Curlers"));
  await screen.findByText("Roster");
}

describe("TeamsScreen — signed in", () => {
  it("prompts for a display name when no Profile exists yet, then shows My Teams after bootstrapping", async () => {
    const user = userEvent.setup();
    const backend = new FakeTeamBackend();
    backend.setAccountEmail("user-1", "a@example.com");
    const teamService = new FakeTeamService(backend, "user-1", new FakeEmailService());

    render(
      <TeamsScreen
        onClose={() => {}}
        config={CONFIGURED}
        createAuthService={signedInAuthService}
        createTeamService={() => teamService}
      />
    );

    const nameInput = await screen.findByLabelText(/choose a display name/i);
    await user.type(nameInput, "Alex");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByText("My Teams");
    expect(screen.getByText(/not on a team yet/i)).toBeInTheDocument();
  });

  it("lists an existing team and shows the create-team form only when pilot-gated capability is granted", async () => {
    const backend = new FakeTeamBackend();
    backend.setAccountEmail("user-1", "a@example.com");
    const teamService = new FakeTeamService(backend, "user-1", new FakeEmailService());
    const profile = await teamService.bootstrapProfile("Alex");
    if (!profile.ok) throw new Error("setup failed");
    backend.grantPilotTeamCreationCapability(profile.value.id);
    const created = await teamService.createTeam({ name: "The Curlers", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");

    render(
      <TeamsScreen
        onClose={() => {}}
        config={CONFIGURED}
        createAuthService={signedInAuthService}
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
    const profile = await teamService.bootstrapProfile("Alex");
    if (!profile.ok) throw new Error("setup failed");
    backend.grantPilotTeamCreationCapability(profile.value.id);
    const created = await teamService.createTeam({ name: "The Curlers", participationAsPlayer: true, functions: [] });
    if (!created.ok) throw new Error("setup failed");

    render(
      <TeamsScreen
        onClose={() => {}}
        config={CONFIGURED}
        createAuthService={signedInAuthService}
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
    await friendService.bootstrapProfile("Friend");
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
    await friendService.bootstrapProfile("Friend");
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
    await friendService.bootstrapProfile("Friend");
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
    await friendService.bootstrapProfile("Friend");
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
