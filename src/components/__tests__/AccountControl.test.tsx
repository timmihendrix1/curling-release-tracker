// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccountControl from "../AccountControl";
import type { AccountIdentity, AuthService, AuthServiceResult } from "../../lib/supabase/authService";
import { authFailed, authOk } from "../../lib/supabase/authService";
import type { ConfiguredCloudConfig } from "../../lib/supabase/config";

afterEach(cleanup);

const CONFIGURED: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

const IDENTITY: AccountIdentity = { accountScopeId: "user-1", email: "a@example.com" };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createFakeAuthService(initialSession: AuthServiceResult<AccountIdentity | null>) {
  const listeners = new Set<(identity: AccountIdentity | null) => void>();
  const requestEmailOtp = vi.fn<(email: string) => Promise<AuthServiceResult<void>>>();
  const verifyEmailOtp =
    vi.fn<(email: string, token: string) => Promise<AuthServiceResult<AccountIdentity>>>();
  const signOut = vi.fn<() => Promise<AuthServiceResult<void>>>();

  const service: AuthService = {
    getSession: vi.fn(async () => initialSession),
    onAuthChange: vi.fn((listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    requestEmailOtp,
    verifyEmailOtp,
    signOut,
  };

  return { service, requestEmailOtp, verifyEmailOtp, signOut };
}

describe("AccountControl — cloud disabled / misconfigured / restoring", () => {
  it("renders nothing when cloud is disabled — the rest of the app stays exactly as-is", () => {
    render(<AccountControl config={{ status: "cloud_disabled" }} />);
    expect(screen.queryByTestId("account-control")).not.toBeInTheDocument();
  });

  it("renders a non-blocking badge when cloud configuration is invalid", () => {
    render(<AccountControl config={{ status: "invalid_configuration", reason: "malformed_url" }} />);
    const control = screen.getByTestId("account-control");
    expect(control).toHaveTextContent(/unavailable/i);
  });

  it("renders a restoring indicator, then settles once the session resolves", async () => {
    const deferred = createDeferred<AuthServiceResult<AccountIdentity | null>>();
    const service: AuthService = {
      getSession: vi.fn(() => deferred.promise),
      onAuthChange: vi.fn(() => () => {}),
      requestEmailOtp: vi.fn(),
      verifyEmailOtp: vi.fn(),
      signOut: vi.fn(),
    };
    render(<AccountControl config={CONFIGURED} createAuthService={() => service} />);
    expect(screen.getByTestId("account-control")).toHaveTextContent(/checking/i);

    await act(async () => {
      deferred.resolve(authOk(null));
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  });
});

describe("AccountControl — signed out / email entry", () => {
  it("shows a Sign in button that opens the email form", async () => {
    const user = userEvent.setup();
    const fake = createFakeAuthService(authOk(null));
    render(<AccountControl config={CONFIGURED} createAuthService={() => fake.service} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it("submits the email via Enter (keyboard-usable) and shows the pending state", async () => {
    const user = userEvent.setup();
    const fake = createFakeAuthService(authOk(null));
    const deferred = createDeferred<AuthServiceResult<void>>();
    fake.requestEmailOtp.mockReturnValue(deferred.promise);

    render(<AccountControl config={CONFIGURED} createAuthService={() => fake.service} />);
    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    const emailInput = screen.getByLabelText(/email address/i);
    await user.type(emailInput, "a@example.com{Enter}");

    expect(fake.requestEmailOtp).toHaveBeenCalledWith("a@example.com");
    expect(emailInput).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

    await act(async () => {
      deferred.resolve(authOk(undefined));
      await Promise.resolve();
    });
    expect(screen.getByLabelText(/6-digit code/i)).toBeInTheDocument();
  });

  it("shows a local validation message for an invalid email without calling the service", async () => {
    const user = userEvent.setup();
    const fake = createFakeAuthService(authOk(null));
    render(<AccountControl config={CONFIGURED} createAuthService={() => fake.service} />);
    await user.click(await screen.findByRole("button", { name: "Sign in" }));

    await user.type(screen.getByLabelText(/email address/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    expect(fake.requestEmailOtp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/valid email/i);
  });
});

describe("AccountControl — OTP entry", () => {
  async function reachOtpEntry(user: ReturnType<typeof userEvent.setup>) {
    const fake = createFakeAuthService(authOk(null));
    fake.requestEmailOtp.mockResolvedValue(authOk(undefined));
    render(<AccountControl config={CONFIGURED} createAuthService={() => fake.service} />);
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    await user.type(screen.getByLabelText(/email address/i), "a@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));
    await screen.findByLabelText(/6-digit code/i);
    return fake;
  }

  it("moves focus to the OTP field once it appears", async () => {
    const user = userEvent.setup();
    await reachOtpEntry(user);
    expect(screen.getByLabelText(/6-digit code/i)).toHaveFocus();
  });

  it("submits the code via Enter and shows signed-in identity on success", async () => {
    const user = userEvent.setup();
    const fake = await reachOtpEntry(user);
    fake.verifyEmailOtp.mockResolvedValue(authOk(IDENTITY));

    await user.type(screen.getByLabelText(/6-digit code/i), "123456{Enter}");
    expect(fake.verifyEmailOtp).toHaveBeenCalledWith("a@example.com", "123456");

    await waitFor(() => expect(screen.getByText("a@example.com")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows a local validation message for a non-six-digit code without calling the service", async () => {
    const user = userEvent.setup();
    const fake = await reachOtpEntry(user);

    await user.type(screen.getByLabelText(/6-digit code/i), "12");
    await user.click(screen.getByRole("button", { name: "Verify" }));

    expect(fake.verifyEmailOtp).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/6-digit code/i);
  });

  it("disables controls while verifying", async () => {
    const user = userEvent.setup();
    const fake = await reachOtpEntry(user);
    const deferred = createDeferred<AuthServiceResult<AccountIdentity>>();
    fake.verifyEmailOtp.mockReturnValue(deferred.promise);

    await user.type(screen.getByLabelText(/6-digit code/i), "123456{Enter}");
    expect(screen.getByLabelText(/6-digit code/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Verifying…" })).toBeDisabled();

    await act(async () => {
      deferred.resolve(authOk(IDENTITY));
      await Promise.resolve();
    });
  });

  it("lets the user change the email and return to email entry", async () => {
    const user = userEvent.setup();
    await reachOtpEntry(user);

    await user.click(screen.getByRole("button", { name: "Change email" }));
    const emailInput = await screen.findByLabelText(/email address/i);
    expect(emailInput).toHaveValue("a@example.com");
  });
});

describe("AccountControl — recoverable error", () => {
  it("shows a normalized error message and a working retry path, without hiding the rest of the app", async () => {
    const user = userEvent.setup();
    const fake = createFakeAuthService(authOk(null));
    fake.requestEmailOtp.mockResolvedValue(authFailed({ kind: "request_failed", message: "Could not send the code." }));

    render(
      <div>
        <div data-testid="rest-of-app">Rest of the app</div>
        <AccountControl config={CONFIGURED} createAuthService={() => fake.service} />
      </div>
    );
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    await user.type(screen.getByLabelText(/email address/i), "a@example.com");
    await user.click(screen.getByRole("button", { name: "Send code" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not send the code."));
    expect(screen.getByTestId("rest-of-app")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByLabelText(/email address/i)).toHaveValue("a@example.com");
  });
});

describe("AccountControl — signed in / sign out", () => {
  it("shows the signed-in identity and a working sign-out action", async () => {
    const user = userEvent.setup();
    const fake = createFakeAuthService(authOk(IDENTITY));
    fake.signOut.mockResolvedValue(authOk(undefined));

    render(<AccountControl config={CONFIGURED} createAuthService={() => fake.service} />);
    await screen.findByText("a@example.com");

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument());
  });
});
