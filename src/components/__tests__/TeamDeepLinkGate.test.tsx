// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TeamDeepLinkGate from "../TeamDeepLinkGate";
import type { AccountIdentity, AuthService, AuthServiceResult } from "../../lib/supabase/authService";
import { authOk } from "../../lib/supabase/authService";
import type { ConfiguredCloudConfig } from "../../lib/supabase/config";

afterEach(cleanup);

function setUrl(search: string) {
  window.history.pushState(null, "", `/${search}`);
}

beforeEach(() => {
  setUrl("");
});

const CONFIGURED: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

function fakeAuthService(initialIdentity: AccountIdentity | null): AuthService {
  return {
    getSession: vi.fn(async (): Promise<AuthServiceResult<AccountIdentity | null>> => authOk(initialIdentity)),
    onAuthChange: vi.fn(() => () => {}),
    requestEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    signOut: vi.fn(),
  };
}

describe("TeamDeepLinkGate", () => {
  it("renders nothing and never calls onAdminRequestLink when neither query parameter is present", async () => {
    const onAdminRequestLink = vi.fn();
    const { container } = render(<TeamDeepLinkGate onAdminRequestLink={onAdminRequestLink} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
    expect(onAdminRequestLink).not.toHaveBeenCalled();
  });

  it("opens the invitation accept overlay for an inviteToken query parameter", async () => {
    setUrl("?inviteToken=secret-token-value");
    render(<TeamDeepLinkGate onAdminRequestLink={vi.fn()} />);
    await screen.findByText("Team Invitation");
  });

  it("calls onAdminRequestLink and strips the query parameter immediately when cloud is unavailable — there is no sign-in step to wait for", async () => {
    setUrl("?adminRequestId=req-1");
    const onAdminRequestLink = vi.fn();
    const { container } = render(<TeamDeepLinkGate onAdminRequestLink={onAdminRequestLink} />);

    await waitFor(() => expect(onAdminRequestLink).toHaveBeenCalledTimes(1));
    expect(container).toBeEmptyDOMElement();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("calls onAdminRequestLink immediately when the caller is already signed in", async () => {
    setUrl("?adminRequestId=req-1");
    const onAdminRequestLink = vi.fn();
    const identity: AccountIdentity = { accountScopeId: "user-1", email: "admin@example.com" };
    render(
      <TeamDeepLinkGate
        onAdminRequestLink={onAdminRequestLink}
        config={CONFIGURED}
        createAuthService={() => fakeAuthService(identity)}
      />
    );

    await waitFor(() => expect(onAdminRequestLink).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("retains the adminRequestId and shows a sign-in prompt instead of opening Teams while signed out", async () => {
    setUrl("?adminRequestId=req-1");
    const onAdminRequestLink = vi.fn();
    render(
      <TeamDeepLinkGate
        onAdminRequestLink={onAdminRequestLink}
        config={CONFIGURED}
        createAuthService={() => fakeAuthService(null)}
      />
    );

    await screen.findByText("Team Admin Request");
    expect(onAdminRequestLink).not.toHaveBeenCalled();
    // The parameter must still be present — nothing has consumed the deep link yet.
    expect(window.location.search).toBe("?adminRequestId=req-1");
  });

  it("continues on to onAdminRequestLink once sign-in completes, without the recipient needing to reopen the link", async () => {
    setUrl("?adminRequestId=req-1");
    const onAdminRequestLink = vi.fn();
    const identity: AccountIdentity = { accountScopeId: "user-1", email: "admin@example.com" };
    const service = fakeAuthService(null);
    const listeners = new Set<(identity: AccountIdentity | null) => void>();
    service.onAuthChange = vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    });

    render(
      <TeamDeepLinkGate onAdminRequestLink={onAdminRequestLink} config={CONFIGURED} createAuthService={() => service} />
    );
    await screen.findByText("Team Admin Request");

    // Simulate the underlying session changing (e.g. sign-in completed through the
    // embedded form here or through the header control elsewhere) — every
    // `useSupabaseAuthController` instance backed by the same underlying service
    // observes this the same way.
    for (const listener of listeners) listener(identity);

    await waitFor(() => expect(onAdminRequestLink).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("a deliberate Close dismissal clears the pending adminRequestId without calling onAdminRequestLink", async () => {
    const user = userEvent.setup();
    setUrl("?adminRequestId=req-1");
    const onAdminRequestLink = vi.fn();
    render(
      <TeamDeepLinkGate
        onAdminRequestLink={onAdminRequestLink}
        config={CONFIGURED}
        createAuthService={() => fakeAuthService(null)}
      />
    );

    await screen.findByText("Team Admin Request");
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onAdminRequestLink).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
    expect(screen.queryByText("Team Admin Request")).not.toBeInTheDocument();
  });
});
