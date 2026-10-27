// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateState } from "../../../lib/identity/gateState";

const platform = vi.hoisted(() => vi.fn(() => "web"));
const identity = vi.hoisted(() => ({
  state: {} as GateState,
  startGoogleSignIn: vi.fn(),
  requestEmailOtp: vi.fn(),
}));
vi.mock("../IdentityProvider", () => ({
  useIdentity: () => identity,
  useOptionalIdentity: () => identity,
}));
vi.mock("../../../lib/platform/runtimePlatform", () => ({ detectRuntimePlatform: platform }));

import IdentityGateScreen from "../IdentityGateScreen";

beforeEach(() => {
  vi.clearAllMocks();
  platform.mockReturnValue("ios");
  identity.state = { kind: "signed_out", legal: { terms: null, privacy: null } } as GateState;
});
afterEach(cleanup);

describe("iOS email-only beta sign-in", () => {
  it.each(["web", "android"])("preserves the existing Google and email choices on %s", async (runtime) => {
    platform.mockReturnValue(runtime);
    const user = userEvent.setup();
    render(<IdentityGateScreen />);
    const google = screen.getByRole("button", { name: "Continue with Google" });
    expect(google).toHaveClass("bg-slate-900", "text-white");
    expect(screen.getByText("or", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send sign-in code" })).toHaveClass("bg-slate-100", "text-slate-700");
    await user.click(google);
    expect(identity.startGoogleSignIn).toHaveBeenCalledTimes(1);
    expect(identity.requestEmailOtp).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "signed_out", legal: { terms: null, privacy: null } },
    { kind: "locked" },
    { kind: "quarantined_locked" },
    { kind: "recoverable_error", reason: "preparation_failed" },
  ])("does not render a Google control or orphaned separator for $kind", (state) => {
    identity.state = state as GateState;
    const { container } = render(<IdentityGateScreen />);
    expect(screen.queryByRole("button", { name: /continue with google/i, hidden: true })).not.toBeInTheDocument();
    // Removing the element, rather than CSS-hiding it, also removes its focus target.
    expect(container.querySelectorAll("button")).toHaveLength(1);
    expect(screen.queryByText("or", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send sign-in code" })).toBeInTheDocument();
    expect(identity.startGoogleSignIn).not.toHaveBeenCalled();
  });

  it("makes email the primary iOS action and supports keyboard-only code requests", async () => {
    const user = userEvent.setup();
    render(<IdentityGateScreen />);
    const email = screen.getByRole("textbox", { name: "Email address" });
    const send = screen.getByRole("button", { name: "Send sign-in code" });
    expect(send).toHaveClass("bg-slate-900", "text-white");
    await user.tab();
    expect(email).toHaveFocus();
    await user.type(email, "club@example.test");
    await user.tab();
    expect(send).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(identity.requestEmailOtp).toHaveBeenCalledExactlyOnceWith("club@example.test");
    expect(identity.startGoogleSignIn).not.toHaveBeenCalled();
  });

  it.each(["ios", "web"])("associates email validation and clears it while editing on %s", async (runtime) => {
    platform.mockReturnValue(runtime);
    const user = userEvent.setup();
    render(<IdentityGateScreen />);
    const email = screen.getByRole("textbox", { name: "Email address" });
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("Enter a valid email address.");
    expect(screen.getByRole("alert").id).toBe(email.getAttribute("aria-describedby"));
    expect(identity.requestEmailOtp).not.toHaveBeenCalled();
    await user.type(email, "club@example.test");
    expect(email).not.toHaveAttribute("aria-invalid", "true");
    expect(email).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(identity.requestEmailOtp).toHaveBeenCalledExactlyOnceWith("club@example.test");
  });
});
