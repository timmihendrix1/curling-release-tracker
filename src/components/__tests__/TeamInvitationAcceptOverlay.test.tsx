// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import TeamInvitationAcceptOverlay from "../TeamInvitationAcceptOverlay";
import type { AccountIdentity, AuthService, AuthServiceResult } from "../../lib/supabase/authService";
import { authFailed, authOk } from "../../lib/supabase/authService";
import type { ConfiguredCloudConfig } from "../../lib/supabase/config";
import { FakeTeamBackend, FakeTeamService } from "../../lib/team/fakeTeamService";
import { FakeEmailService } from "../../lib/email/fakeEmailService";

afterEach(cleanup);

const CONFIGURED: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

const IDENTITY: AccountIdentity = { accountScopeId: "user-1", email: "invitee@example.com" };

function signedInAuthService(identity: AccountIdentity | null): AuthService {
  return {
    getSession: vi.fn(async (): Promise<AuthServiceResult<AccountIdentity | null>> => authOk(identity)),
    onAuthChange: vi.fn(() => () => {}),
    requestEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    signOut: vi.fn(),
  };
}

/** A fake AuthService whose session starts signed-out but can be driven through a
 * real request-OTP/verify-OTP/sign-in transition via its own mocked functions —
 * used by the "signed out" tests below to prove the SAME `AuthController` instance
 * the overlay constructs carries a recipient through sign-in without the overlay
 * ever unmounting or losing its `token` prop. */
function createControllableAuthService() {
  const requestEmailOtp = vi.fn<(email: string) => Promise<AuthServiceResult<void>>>();
  const verifyEmailOtp = vi.fn<(email: string, token: string) => Promise<AuthServiceResult<AccountIdentity>>>();
  const service: AuthService = {
    getSession: vi.fn(async (): Promise<AuthServiceResult<AccountIdentity | null>> => authOk(null)),
    onAuthChange: vi.fn(() => () => {}),
    requestEmailOtp,
    verifyEmailOtp,
    signOut: vi.fn(),
  };
  return { service, requestEmailOtp, verifyEmailOtp };
}

/** Sets up a backend with one admin (the inviter) and a pending invitation addressed
 * to `inviteeEmail`, returning the raw token an overlay would be opened with. */
async function setUpPendingInvitation(inviteeEmail: string) {
  const backend = new FakeTeamBackend();
  const emailService = new FakeEmailService();
  backend.setAccountEmail("admin-account", "admin@example.com");
  const adminService = new FakeTeamService(backend, "admin-account", emailService);

  const profile = await adminService.bootstrapProfile("Admin");
  if (!profile.ok) throw new Error("setup failed: bootstrapProfile");
  backend.grantPilotTeamCreationCapability(profile.value.id);

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

describe("TeamInvitationAcceptOverlay — signed out", () => {
  it("shows an embedded sign-in form and never calls previewInvitation before signing in", async () => {
    const previewInvitation = vi.fn();
    const fakeTeamService = { previewInvitation, acceptInvitation: vi.fn() } as never;
    render(
      <TeamInvitationAcceptOverlay
        token="irrelevant-token"
        onDone={() => {}}
        config={CONFIGURED}
        createAuthService={() => signedInAuthService(null)}
        createTeamService={() => fakeTeamService}
      />
    );
    await screen.findByLabelText(/email address/i);
    expect(previewInvitation).not.toHaveBeenCalled();
  });

  it("a deliberate Close dismissal is available while signed out — the token is the caller's (TeamDeepLinkGate's) to keep or discard", async () => {
    const user = userEvent.setup();
    const fakeTeamService = { previewInvitation: vi.fn(), acceptInvitation: vi.fn() } as never;
    const onDone = vi.fn();
    render(
      <TeamInvitationAcceptOverlay
        token="irrelevant-token"
        onDone={onDone}
        config={CONFIGURED}
        createAuthService={() => signedInAuthService(null)}
        createTeamService={() => fakeTeamService}
      />
    );
    await screen.findByLabelText(/email address/i);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("carries a recipient through sign-in (request OTP, verify, bootstrap, preview, accept) without ever losing the token or leaving the overlay", async () => {
    const user = userEvent.setup();
    const { backend, emailService, rawToken } = await setUpPendingInvitation("invitee@example.com");
    backend.setAccountEmail("brand-new-account", "invitee@example.com");
    const teamService = new FakeTeamService(backend, "brand-new-account", emailService);
    const { service: authService, requestEmailOtp, verifyEmailOtp } = createControllableAuthService();
    const onDone = vi.fn();

    render(
      <TeamInvitationAcceptOverlay
        token={rawToken}
        onDone={onDone}
        config={CONFIGURED}
        createAuthService={() => authService}
        createTeamService={() => teamService}
      />
    );

    const emailInput = await screen.findByLabelText(/email address/i);
    requestEmailOtp.mockResolvedValue(authOk(undefined));
    await user.type(emailInput, "invitee@example.com{Enter}");
    expect(requestEmailOtp).toHaveBeenCalledWith("invitee@example.com");

    const otpInput = await screen.findByLabelText(/6-digit code/i);
    verifyEmailOtp.mockResolvedValue(authOk({ accountScopeId: "brand-new-account", email: "invitee@example.com" }));
    await user.type(otpInput, "123456{Enter}");
    expect(verifyEmailOtp).toHaveBeenCalledWith("invitee@example.com", "123456");

    // Signed in now, still the SAME overlay instance/token — Profile bootstrap
    // comes first (spec §2/§12: this account has none yet).
    const nameInput = await screen.findByLabelText(/choose a display name/i);
    await user.type(nameInput, "New Curler");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/invited you to join/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByText(/you've joined/i);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a recoverable sign-in error (e.g. the OTP request failing) keeps the pending token — retrying continues the same flow", async () => {
    const user = userEvent.setup();
    const { rawToken } = await setUpPendingInvitation("invitee@example.com");
    const { service: authService, requestEmailOtp } = createControllableAuthService();
    const fakeTeamService = { previewInvitation: vi.fn(), acceptInvitation: vi.fn() } as never;

    render(
      <TeamInvitationAcceptOverlay
        token={rawToken}
        onDone={() => {}}
        config={CONFIGURED}
        createAuthService={() => authService}
        createTeamService={() => fakeTeamService}
      />
    );

    const emailInput = await screen.findByLabelText(/email address/i);
    requestEmailOtp.mockResolvedValueOnce(authFailed({ kind: "request_failed", message: "Could not send the code." }));
    await user.type(emailInput, "invitee@example.com{Enter}");

    await screen.findByText("Could not send the code.");
    // Still showing the sign-in form, not reset back to "reopen this link" — the
    // token this overlay was opened with is still exactly the one in scope.
    await user.click(screen.getByRole("button", { name: "Try again" }));

    requestEmailOtp.mockResolvedValueOnce(authOk(undefined));
    const retriedEmailInput = await screen.findByLabelText(/email address/i);
    expect(retriedEmailInput).toHaveValue("invitee@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText(/6-digit code/i);
  });
});

describe("TeamInvitationAcceptOverlay — signed in", () => {
  it("previews a valid invitation and accepts it", async () => {
    const user = userEvent.setup();
    const { backend, emailService, rawToken } = await setUpPendingInvitation("invitee@example.com");
    backend.setAccountEmail("invitee-account", "invitee@example.com");
    const inviteeService = new FakeTeamService(backend, "invitee-account", emailService);
    await inviteeService.bootstrapProfile("Invitee");
    const onDone = vi.fn();

    render(
      <TeamInvitationAcceptOverlay
        token={rawToken}
        onDone={onDone}
        config={CONFIGURED}
        createAuthService={() => signedInAuthService(IDENTITY)}
        createTeamService={() => inviteeService}
      />
    );

    expect(await screen.findByText(/invited you to join/i)).toBeInTheDocument();
    expect(screen.getByText("The Curlers")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByText(/you've joined/i);

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("a brand-new invitee with no Profile yet bootstraps one inside the invitation flow, then accepts (spec §2/§12)", async () => {
    const user = userEvent.setup();
    const { backend, emailService, rawToken } = await setUpPendingInvitation("invitee@example.com");
    backend.setAccountEmail("brand-new-account", "invitee@example.com");
    const newAccountService = new FakeTeamService(backend, "brand-new-account", emailService);
    // Deliberately no bootstrapProfile call here — this is the whole point of the test.
    const onDone = vi.fn();

    render(
      <TeamInvitationAcceptOverlay
        token={rawToken}
        onDone={onDone}
        config={CONFIGURED}
        createAuthService={() => signedInAuthService(IDENTITY)}
        createTeamService={() => newAccountService}
      />
    );

    const nameInput = await screen.findByLabelText(/choose a display name/i);
    // The invitation's own content must not be visible yet — bootstrap comes first.
    expect(screen.queryByText(/invited you to join/i)).not.toBeInTheDocument();

    await user.type(nameInput, "New Curler");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText(/invited you to join/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept" }));
    await screen.findByText(/you've joined/i);

    const profileResult = await newAccountService.getMyProfile();
    expect(profileResult.ok && profileResult.value?.displayName).toBe("New Curler");
  });

  it("shows a wrong_email denial with a way to close the overlay (not stuck)", async () => {
    const user = userEvent.setup();
    const { backend, emailService, rawToken } = await setUpPendingInvitation("someone-else@example.com");
    backend.setAccountEmail("wrong-account", "invitee@example.com");
    const wrongAccountService = new FakeTeamService(backend, "wrong-account", emailService);
    await wrongAccountService.bootstrapProfile("Wrong Account");
    const onDone = vi.fn();

    render(
      <TeamInvitationAcceptOverlay
        token={rawToken}
        onDone={onDone}
        config={CONFIGURED}
        createAuthService={() => signedInAuthService(IDENTITY)}
        createTeamService={() => wrongAccountService}
      />
    );

    expect(await screen.findByText(/different email address/i)).toBeInTheDocument();
    const closeButton = screen.getByRole("button", { name: "Close" });
    await user.click(closeButton);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("shows an invalid-token message with a way to close the overlay", async () => {
    const user = userEvent.setup();
    const backend = new FakeTeamBackend();
    const emailService = new FakeEmailService();
    backend.setAccountEmail("some-account", "invitee@example.com");
    const service = new FakeTeamService(backend, "some-account", emailService);
    await service.bootstrapProfile("Some Account");
    const onDone = vi.fn();

    render(
      <TeamInvitationAcceptOverlay
        token="not-a-real-token"
        onDone={onDone}
        config={CONFIGURED}
        createAuthService={() => signedInAuthService(IDENTITY)}
        createTeamService={() => service}
      />
    );

    expect(await screen.findByText(/isn.t valid/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
