// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateState } from "../../../lib/identity/gateState";
import { parseLegalDocumentsResponse } from "../../../lib/identity/legalSnapshot";

const identity = vi.hoisted(() => ({
  state: { kind: "awaiting_otp" } as GateState,
  emailForOtp: "club@example.test",
  verifyEmailOtp: vi.fn(),
  submitOnboarding: vi.fn(),
}));
vi.mock("../IdentityProvider", () => ({
  useIdentity: () => identity,
  useOptionalIdentity: () => identity,
}));
import IdentityGateScreen from "../IdentityGateScreen";

beforeEach(() => {
  vi.clearAllMocks();
  identity.state = { kind: "awaiting_otp" };
});
afterEach(cleanup);

function requireOnboarding() {
  const legal = parseLegalDocumentsResponse([
    { id: "11111111-1111-4111-8111-111111111111", kind: "terms_of_service", version_label: "test-v1", document_url: "https://club.example.test/terms", effective_at: "2026-01-01T00:00:00.000Z" },
    { id: "22222222-2222-4222-8222-222222222222", kind: "privacy_notice", version_label: "test-v1", document_url: "https://club.example.test/privacy", effective_at: "2026-01-01T00:00:00.000Z" },
  ], "2026-01-01T00:00:00.000Z");
  if (!legal.ok) throw new Error("invalid synthetic legal fixture");
  identity.state = { kind: "onboarding_required", legal: legal.snapshot };
}

describe("identity form error associations", () => {
  it.each(["neither", "terms", "privacy"])("associates missing document consent only with unchecked controls (%s accepted)", async (accepted) => {
    requireOnboarding();
    const user = userEvent.setup();
    render(<IdentityGateScreen />);
    const name = screen.getByRole("textbox", { name: "Display Name" });
    const terms = screen.getByRole("checkbox", { name: "I accept the" });
    const privacy = screen.getByRole("checkbox", { name: "I acknowledge the" });
    await user.type(name, "  Club Athlete  ");
    if (accepted === "terms") await user.click(terms);
    if (accepted === "privacy") await user.click(privacy);
    await user.click(screen.getByRole("button", { name: "Create athlete profile" }));
    const message = "Accept the Terms and acknowledge the Privacy Notice to continue.";
    expect(screen.getByRole("group", { name: "Required documents" })).toHaveAccessibleDescription(message);
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    expect(name).not.toHaveAttribute("aria-describedby");
    for (const checkbox of [terms, privacy]) {
      if ((checkbox as HTMLInputElement).checked) {
        expect(checkbox).not.toHaveAttribute("aria-invalid", "true");
        expect(checkbox).not.toHaveAttribute("aria-describedby");
      } else {
        expect(checkbox).toHaveAttribute("aria-invalid", "true");
        expect(checkbox).toHaveAccessibleDescription(message);
        expect(checkbox.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
      }
    }
    expect(identity.submitOnboarding).not.toHaveBeenCalled();
    for (const checkbox of [terms, privacy]) {
      if (!(checkbox as HTMLInputElement).checked) await user.click(checkbox);
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Required documents" })).not.toHaveAttribute("aria-describedby");
    for (const checkbox of [terms, privacy]) {
      expect(checkbox).not.toHaveAttribute("aria-invalid", "true");
      expect(checkbox).not.toHaveAttribute("aria-describedby");
    }
    await user.click(screen.getByRole("button", { name: "Create athlete profile" }));
    expect(identity.submitOnboarding).toHaveBeenCalledExactlyOnceWith({ displayName: "Club Athlete", termsAccepted: true, privacyAcknowledged: true });
  });
  it("associates an invalid display name only with that field and clears on edit", async () => {
    requireOnboarding();
    const user = userEvent.setup();
    render(<IdentityGateScreen />);
    const name = screen.getByRole("textbox", { name: "Display Name" });
    await user.click(screen.getByRole("button", { name: "Create athlete profile" }));
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Enter a display name of 80 characters or fewer.");
    expect(screen.getByRole("alert").id).toBe(name.getAttribute("aria-describedby"));
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toHaveAttribute("aria-invalid", "true");
      expect(checkbox).not.toHaveAttribute("aria-describedby");
    }
    expect(identity.submitOnboarding).not.toHaveBeenCalled();
    await user.type(name, "Club Athlete");
    expect(name).not.toHaveAttribute("aria-invalid", "true");
    expect(name).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("associates an invalid OTP with its field and clears the association on edit", async () => {
    const user = userEvent.setup();
    render(<IdentityGateScreen />);
    const code = screen.getByRole("textbox", { name: "6-digit code" });
    expect(code).toHaveFocus();
    expect(code).not.toHaveAttribute("aria-invalid", "true");
    await user.keyboard("{Enter}");
    expect(code).toHaveAttribute("aria-invalid", "true");
    expect(code).toHaveAccessibleDescription("Enter the 6-digit code from your email.");
    expect(screen.getByRole("alert").id).toBe(code.getAttribute("aria-describedby"));
    expect(identity.verifyEmailOtp).not.toHaveBeenCalled();
    await user.type(code, "12a3456");
    expect(code).toHaveValue("123456");
    expect(code).not.toHaveAttribute("aria-invalid", "true");
    expect(code).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.keyboard("{Enter}");
    expect(identity.verifyEmailOtp).toHaveBeenCalledExactlyOnceWith("123456");
  });
});
