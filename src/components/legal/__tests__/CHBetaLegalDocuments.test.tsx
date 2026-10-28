// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Privacy from "../PrivacyNotice20261028CHBeta";
import Terms from "../TermsOfService20261028CHBeta";
afterEach(cleanup);
describe("Swiss beta legal notice", () => {
  it("distinguishes Swiss objection, other opt-in, prior refusals and operator deletion", () => {
    render(<Privacy />);
    expect(screen.getByText("privacy-2026-10-28-ch-beta")).toBeInTheDocument();
    expect(screen.getByText(/Earlier refusals remain off/)).toBeInTheDocument();
    expect(screen.getByText(/Other builds use separate explicit opt-in/)).toBeInTheDocument();
    expect(screen.getByText(/no later than one year after collection/)).toBeInTheDocument();
    expect(screen.queryByText(/Only if you separately opt in/)).not.toBeInTheDocument();
  });
  it("keeps Terms acceptance separate and preserves access after objection", () => {
    render(<Terms />);
    expect(screen.getByText("terms-2026-10-28-ch-beta")).toBeInTheDocument();
    expect(screen.getByText(/Accepting these Terms does not authorize analytics/)).toBeInTheDocument();
    expect(screen.getByText(/analytics does not restrict use of the app/)).toBeInTheDocument();
  });
});
