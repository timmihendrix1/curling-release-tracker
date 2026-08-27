// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamInvitationAcceptOverlay from "../TeamInvitationAcceptOverlay";
import type { GateSession } from "../identity/IdentityProvider";
import type { ConfiguredCloudConfig } from "../../lib/supabase/config";
import { FakeEmailService } from "../../lib/email/fakeEmailService";
import { FakeTeamBackend, FakeTeamService } from "../../lib/team/fakeTeamService";

afterEach(cleanup);

const CONFIGURED: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

function gateSession(accountScopeId: string, email: string): GateSession {
  return {
    accountScopeId,
    email,
    profileId: `profile-${accountScopeId}`,
    displayName: "Invitee",
    entitlement: "free",
  };
}

async function setUpPendingInvitation(inviteeEmail: string) {
  const backend = new FakeTeamBackend();
  const emailService = new FakeEmailService();
  backend.setAccountEmail("admin-account", "admin@example.com");
  const adminProfile = backend.seedCompletedProfile("admin-account", "Admin");
  backend.grantPilotTeamCreationCapability(adminProfile.id);
  const adminService = new FakeTeamService(backend, "admin-account", emailService);

  const team = await adminService.createTeam({ name: "The Curlers", participationAsPlayer: false, functions: [] });
  if (!team.ok) throw new Error("setup failed: createTeam");
  const invitation = await adminService.createInvitation(team.value.team.id, {
    email: inviteeEmail,
    participationAsPlayer: true,
    proposedFunctions: ["coach"],
  });
  if (!invitation.ok) throw new Error("setup failed: createInvitation");
  const rawToken = backend.invitationRawTokens.get(invitation.value.invitation.id);
  if (!rawToken) throw new Error("no raw token captured");
  return { backend, emailService, rawToken };
}

describe("TeamInvitationAcceptOverlay", () => {
  it("does not call Team APIs without a gate-approved identity", async () => {
    const previewInvitation = vi.fn();
    const onDone = vi.fn();
    render(
      <TeamInvitationAcceptOverlay
        token="irrelevant-token"
        onDone={onDone}
        config={CONFIGURED}
        createTeamService={() => ({ previewInvitation, acceptInvitation: vi.fn() }) as never}
      />
    );

    expect(await screen.findByText(/complete athlete sign-in/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/email address/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/choose a display name/i)).not.toBeInTheDocument();
    expect(previewInvitation).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("previews and accepts with the global gate session and no Team-local bootstrap", async () => {
    const user = userEvent.setup();
    const { backend, emailService, rawToken } = await setUpPendingInvitation("invitee@example.com");
    backend.setAccountEmail("invitee-account", "invitee@example.com");
    backend.seedCompletedProfile("invitee-account", "Invitee");
    const inviteeService = new FakeTeamService(backend, "invitee-account", emailService);
    const onDone = vi.fn();

    render(
      <TeamInvitationAcceptOverlay
        token={rawToken}
        onDone={onDone}
        config={CONFIGURED}
        identitySession={gateSession("invitee-account", "invitee@example.com")}
        createTeamService={() => inviteeService}
      />
    );

    expect(await screen.findByText(/invited you to join/i)).toBeInTheDocument();
    expect(screen.getByText("The Curlers")).toBeInTheDocument();
    expect(screen.queryByLabelText(/choose a display name/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(/you've joined/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps a wrong-account invitation pending while invoking bounded recovery", async () => {
    const user = userEvent.setup();
    const { backend, emailService, rawToken } = await setUpPendingInvitation("someone-else@example.com");
    backend.setAccountEmail("wrong-account", "invitee@example.com");
    backend.seedCompletedProfile("wrong-account", "Wrong Account");
    const onDone = vi.fn();
    const onRecoverWrongAccount = vi.fn();

    render(
      <TeamInvitationAcceptOverlay
        token={rawToken}
        onDone={onDone}
        config={CONFIGURED}
        identitySession={gateSession("wrong-account", "invitee@example.com")}
        createTeamService={() => new FakeTeamService(backend, "wrong-account", emailService)}
        onRecoverWrongAccount={onRecoverWrongAccount}
      />
    );

    expect(await screen.findByText(/different email address/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /sign in with the invited account/i }));
    expect(onRecoverWrongAccount).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("shows an invalid-token message with a terminal dismissal", async () => {
    const backend = new FakeTeamBackend();
    const emailService = new FakeEmailService();
    backend.setAccountEmail("some-account", "invitee@example.com");
    backend.seedCompletedProfile("some-account", "Some Account");
    const onDone = vi.fn();
    render(
      <TeamInvitationAcceptOverlay
        token="not-a-real-token"
        onDone={onDone}
        config={CONFIGURED}
        identitySession={gateSession("some-account", "invitee@example.com")}
        createTeamService={() => new FakeTeamService(backend, "some-account", emailService)}
      />
    );

    expect(await screen.findByText(/isn.t valid/i)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("button", { name: "Close" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("does not recreate a missing Profile from the Team surface", async () => {
    const backend = new FakeTeamBackend();
    backend.setAccountEmail("new-account", "new@example.com");
    const service = new FakeTeamService(backend, "new-account", new FakeEmailService());
    render(
      <TeamInvitationAcceptOverlay
        token="irrelevant-token"
        onDone={() => {}}
        config={CONFIGURED}
        identitySession={gateSession("new-account", "new@example.com")}
        createTeamService={() => service}
      />
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(await service.getMyProfile()).toEqual({ ok: true, value: null });
    expect(screen.queryByLabelText(/choose a display name/i)).not.toBeInTheDocument();
  });
});
