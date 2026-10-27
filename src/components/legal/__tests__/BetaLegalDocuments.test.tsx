// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyNotice from "../PrivacyNotice20261027";
import TermsOfService from "../TermsOfService20261027";
import LegacyPrivacyNotice from "../PrivacyNotice";
import LegacyTermsOfService from "../TermsOfService";

afterEach(cleanup);

describe("native and web closed-beta legal versions", () => {
  it("describes optional timing capture and the actual cloud-restore boundary", () => {
    render(<PrivacyNotice />);
    expect(screen.getByText("privacy-2026-10-27")).toBeInTheDocument();
    expect(screen.getByText(/web and iOS apps/)).toBeInTheDocument();
    expect(screen.getByText(/processes Bluetooth timing records on your device/)).toBeInTheDocument();
    expect(screen.getByText(/ongoing training and authored Training Plans/)).toBeInTheDocument();
    expect(screen.queryByText(/does not collect video or sensor data/)).not.toBeInTheDocument();
    expect(screen.getByText(/Acknowledging this Privacy Notice is not consent/)).toBeInTheDocument();
  });

  it("states the free pilot, available diagrams and hardware limitations", () => {
    render(<TermsOfService />);
    expect(screen.getByText("terms-2026-10-27")).toBeInTheDocument();
    expect(screen.getByText(/provided without charge and does not create a paid subscription/)).toBeInTheDocument();
    expect(screen.getByText(/available to all app users for training/)).toBeInTheDocument();
    expect(screen.getByText(/Automatic timing depends on supported hardware/)).toBeInTheDocument();
    expect(screen.queryByText(/only to the authorised closed-beta Team/)).not.toBeInTheDocument();
    expect(screen.getByText(/stored only on the current device/)).toBeInTheDocument();
  });

  it("continues to render both previously accepted immutable texts unchanged", () => {
    render(<><LegacyPrivacyNotice /><LegacyTermsOfService /></>);
    expect(screen.getByText("privacy-2026-08-28")).toBeInTheDocument();
    expect(screen.getByText("terms-2026-08-29")).toBeInTheDocument();
    expect(screen.getByText(/does not collect video or sensor data/)).toBeInTheDocument();
    expect(screen.getByText(/only to the authorised closed-beta Team/)).toBeInTheDocument();
  });
});
