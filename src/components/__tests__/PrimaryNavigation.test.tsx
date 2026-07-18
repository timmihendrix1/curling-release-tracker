// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PrimaryNavigation from "../PrimaryNavigation";
import type { ActiveView } from "../../lib/navigation";

afterEach(cleanup);

describe("PrimaryNavigation", () => {
  it("renders Home, Train, Assess, Analyze, Settings, in that order", () => {
    render(<PrimaryNavigation activeView="home" onNavigate={() => {}} />);

    for (const label of ["Home", "Train", "Assess", "Analyze", "Settings"]) {
      expect(screen.getAllByRole("button", { name: label }).length).toBeGreaterThan(0);
    }

    const desktopBar = screen.getByTestId("primary-nav-desktop");
    const labels = Array.from(desktopBar.querySelectorAll("button")).map(
      (button) => button.textContent
    );
    expect(labels).toEqual(["Home", "Train", "Assess", "Analyze", "Settings"]);
  });

  it("marks the active view with aria-current, and only that one", () => {
    render(<PrimaryNavigation activeView="analyze" onNavigate={() => {}} />);

    const analyzeButtons = screen.getAllByRole("button", { name: "Analyze" });
    for (const button of analyzeButtons) {
      expect(button).toHaveAttribute("aria-current", "page");
    }

    const homeButtons = screen.getAllByRole("button", { name: "Home" });
    for (const button of homeButtons) {
      expect(button).not.toHaveAttribute("aria-current");
    }
  });

  it("calls onNavigate with the clicked item's id", () => {
    const onNavigate = vi.fn<(view: ActiveView) => void>();
    render(<PrimaryNavigation activeView="home" onNavigate={onNavigate} />);

    screen.getAllByRole("button", { name: "Train" })[0].click();

    expect(onNavigate).toHaveBeenCalledWith("train");
  });

  it("gives every nav button a visible focus-visible style, independent of the active state's background", () => {
    render(<PrimaryNavigation activeView="home" onNavigate={() => {}} />);

    for (const button of screen.getAllByRole("button", { name: "Train" })) {
      expect(button.className).toMatch(/focus-visible:ring/);
    }

    // The active item's styling comes from a solid background, not the ring —
    // so active and focus-visible are two independent, non-conflicting states.
    for (const button of screen.getAllByRole("button", { name: "Home" })) {
      expect(button.className).toMatch(/bg-slate-900/);
      expect(button.className).toMatch(/focus-visible:ring/);
    }
  });

  it("respects the iOS safe-area inset and floats clear of the device edge on mobile", () => {
    render(<PrimaryNavigation activeView="home" onNavigate={() => {}} />);

    const mobileBar = screen.getByTestId("primary-nav-mobile");
    expect(mobileBar.className).toMatch(/env\(safe-area-inset-bottom\)/);
    // Inset from the edges and floating above the very bottom, not five
    // buttons flush against the device edge (DESIGN_SYSTEM.md §11.2).
    expect(mobileBar.className).toMatch(/inset-x-3/);
    expect(mobileBar.className).not.toMatch(/inset-x-0/);
  });

  it("gives every mobile nav button an approximately 44px touch target", () => {
    render(<PrimaryNavigation activeView="home" onNavigate={() => {}} />);

    const mobileBar = screen.getByTestId("primary-nav-mobile");
    for (const button of mobileBar.querySelectorAll("button")) {
      expect(button.className).toMatch(/min-h-11/);
    }
  });
});
