// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyNotice, {
  PRIVACY_NOTICE_CANONICAL_PATH,
  PRIVACY_NOTICE_EFFECTIVE_DATE,
  PRIVACY_NOTICE_VERSION,
} from "../PrivacyNotice";

afterEach(cleanup);

describe("PrivacyNotice", () => {
  it("identifies the version, controller and contact without placeholders", () => {
    render(<PrivacyNotice />);

    expect(screen.getByRole("heading", { level: 1, name: "Privacy Notice" })).toBeInTheDocument();
    expect(screen.getByText(PRIVACY_NOTICE_VERSION)).toBeInTheDocument();
    expect(screen.getByText(PRIVACY_NOTICE_EFFECTIVE_DATE)).toBeInTheDocument();
    expect(screen.getByText("Evolane Curling", { selector: "strong" })).toBeInTheDocument();
    for (const link of screen.getAllByRole("link", { name: "info@evolane.swiss" })) {
      expect(link).toHaveAttribute("href", "mailto:info@evolane.swiss");
    }
    expect(PRIVACY_NOTICE_CANONICAL_PATH).toBe("/legal/privacy/2026-08-28");
    expect(document.body).not.toHaveTextContent(/todo|placeholder|example\.invalid/i);
  });

  it("covers the minimum operational transparency subjects", () => {
    render(<PrivacyNotice />);

    for (const heading of [
      "1. Who is responsible",
      "2. Data we handle",
      "3. Why we use it",
      "4. What is required",
      "5. Who can receive data",
      "6. International processing",
      "7. Storage and deletion",
      "8. Your rights",
      "9. Automated decisions",
      "10. Security and changes",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeInTheDocument();
    }

    expect(screen.getByText(/Supabase provides authentication and database services/)).toBeInTheDocument();
    expect(screen.getByText(/do not sell personal data/)).toBeInTheDocument();
    expect(screen.getByText(/does not collect video or sensor data/)).toBeInTheDocument();
    expect(screen.getByText(/Minimal deletion markers may remain/)).toBeInTheDocument();
  });

  it("states that acknowledgement is not consent", () => {
    render(<PrivacyNotice />);

    expect(screen.getByText(/Acknowledging this Privacy Notice is not consent\./)).toBeInTheDocument();
  });
});
