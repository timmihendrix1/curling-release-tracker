// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Privacy from "../PrivacyNotice20261027PostHog";
import Terms from "../TermsOfService20261027PostHog";
afterEach(cleanup);
describe("separate analytics legal disclosure", () => {
  it("discloses consent, EU provider, payload limits, withdrawal and separate erasure without pretending acceptance is consent", () => {
    render(<Privacy />);
    expect(screen.getByText("privacy-2026-10-27-posthog")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "11. Optional usage analytics (PostHog)" })).toBeInTheDocument();
    expect(screen.getByText(/Only if you separately opt in/)).toBeInTheDocument();
    expect(screen.getByText(/does not automatically delete PostHog history/)).toBeInTheDocument();
    expect(screen.getByText(/The SDK keeps event and identity state in memory/)).toBeInTheDocument();
    expect(screen.getByText(/We do not send names, email addresses/)).toBeInTheDocument();
  });
  it("does not bundle optional analytics into Terms acceptance", () => {
    render(<Terms />);
    expect(screen.getByText("terms-2026-10-27-posthog")).toBeInTheDocument();
    expect(screen.getByText(/Accepting these Terms does not authorize analytics/)).toBeInTheDocument();
  });
});
