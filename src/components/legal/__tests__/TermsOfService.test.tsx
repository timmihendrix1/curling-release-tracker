// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TermsOfService, {
  TERMS_OF_SERVICE_CANONICAL_PATH,
  TERMS_OF_SERVICE_EFFECTIVE_DATE,
  TERMS_OF_SERVICE_VERSION,
} from "../TermsOfService";

afterEach(cleanup);

describe("TermsOfService", () => {
  it("identifies the accepted version, operator and contact without placeholders", () => {
    render(<TermsOfService />);

    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeInTheDocument();
    expect(screen.getByText(TERMS_OF_SERVICE_VERSION)).toBeInTheDocument();
    expect(screen.getByText(TERMS_OF_SERVICE_EFFECTIVE_DATE)).toBeInTheDocument();
    expect(screen.getByText("Evolane Curling", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "info@evolane.swiss" })).toHaveAttribute(
      "href",
      "mailto:info@evolane.swiss"
    );
    expect(TERMS_OF_SERVICE_CANONICAL_PATH).toBe("/legal/terms/2026-08-29");
    expect(document.body).not.toHaveTextContent(/todo|placeholder|example\.invalid/i);
  });

  it("covers the closed-beta agreement subjects without inventing paid service", () => {
    render(<TermsOfService />);

    for (const heading of [
      "1. Operator and contact",
      "2. The closed-beta service",
      "3. Your account",
      "4. Acceptable use",
      "5. Team training and recording",
      "6. Your content and data",
      "7. Platform and source material",
      "8. Training safety and performance information",
      "9. Availability and ending access",
      "10. Warranty and liability",
      "11. Privacy",
      "12. Changes to these Terms",
      "13. Applicable law",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    expect(screen.getByText(/provided without charge and does not create a paid subscription/)).toBeInTheDocument();
    expect(screen.getByText(/respect each athlete's recording permission/)).toBeInTheDocument();
    expect(screen.getByText(/attributed to Swiss Curling/)).toBeInTheDocument();
    expect(screen.getByText(/mandatory consumer rights remain unaffected/)).toBeInTheDocument();
  });

  it("keeps Terms acceptance distinct from Privacy acknowledgement", () => {
    render(<TermsOfService />);

    expect(
      screen.getByText(/Accepting these Terms and acknowledging the Privacy Notice are separate onboarding actions/)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Notice" })).toHaveAttribute("href", "/privacy");
  });
});
