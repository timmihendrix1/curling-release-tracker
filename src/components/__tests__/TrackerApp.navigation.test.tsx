// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TrackerApp from "../TrackerApp";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
});

// PrimaryNavigation renders every item twice (desktop bar + mobile bar) —
// both copies exist in the DOM at once, responsive visibility is CSS-only.
// Clicking either activates the same navigation, so tests just use the first.
function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

describe("TrackerApp — top-level navigation", () => {
  it("lands on Home by default, with no persisted-view concept to go stale", async () => {
    render(<TrackerApp />);

    await waitFor(() =>
      expect(navButton("Home")).toHaveAttribute("aria-current", "page")
    );
    expect(screen.getByText("No scheduled session.")).toBeInTheDocument();
  });

  it("Train is reachable and shows Setup for a session with no blocks yet", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Train").click();

    await waitFor(() =>
      expect(navButton("Train")).toHaveAttribute("aria-current", "page")
    );
    expect(screen.getByText("Set Up Training Block")).toBeInTheDocument();
  });

  it("Analyze is reachable with keyboard-operable Training, Assessments and Exercises tabs", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Analyze").click();

    await waitFor(() =>
      expect(navButton("Analyze")).toHaveAttribute("aria-current", "page")
    );
    expect(screen.getByRole("heading", { name: "Analyze" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Training" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Assessments" })).toBeInTheDocument();
    const training = screen.getByRole("tab", { name: "Training" });
    const exercises = screen.getByRole("tab", { name: "Exercises" });
    expect(exercises).toBeInTheDocument();
    expect(training).toHaveAttribute("tabindex", "0");
    training.focus();
    fireEvent.keyDown(training, { key: "End" });
    expect(exercises).toHaveAttribute("aria-selected", "true");
    expect(exercises).toHaveFocus();
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", exercises.id);
  });

  it("Settings is reachable", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Settings").click();

    await waitFor(() =>
      expect(navButton("Settings")).toHaveAttribute("aria-current", "page")
    );
    expect(screen.getByText("Data Management")).toBeInTheDocument();
  });

  it("shows the full product identity only on Home, and a compact page header on functional screens", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    expect(
      screen.getByRole("heading", { name: "Curling Performance" })
    ).toBeInTheDocument();

    navButton("Settings").click();
    await waitFor(() =>
      expect(navButton("Settings")).toHaveAttribute("aria-current", "page")
    );

    expect(
      screen.queryByRole("heading", { name: "Curling Performance" })
    ).not.toBeInTheDocument();
    // getByRole (not getAllByRole) already asserts there is exactly one
    // "Settings" heading — the old duplicate in-card title was removed once
    // this compact page header took over identifying the screen.
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("reserves bottom clearance for the floating mobile navigation on the one scrolling content root", async () => {
    const { container } = render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    expect(container.firstChild).toHaveClass("app-content-clearance");
  });

  it("Assess is reachable and shows the Release Time Core Assessment landing", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Assess").click();

    await waitFor(() =>
      expect(navButton("Assess")).toHaveAttribute("aria-current", "page")
    );
    expect(
      screen.getByRole("heading", { name: "Release Time Core Assessment" })
    ).toBeInTheDocument();
  });

  it("Home's Start Training goes to Train, and a shot recorded there survives a Home/Train round trip", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() =>
      expect(navButton("Train")).toHaveAttribute("aria-current", "page")
    );

    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));

    fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
      target: { value: "3.80" },
    });
    screen.getByRole("button", { name: "Add Shot" }).click();

    await waitFor(() => screen.getByText("1 shot total"));

    navButton("Home").click();
    await waitFor(() =>
      expect(navButton("Home")).toHaveAttribute("aria-current", "page")
    );
    expect(screen.queryByText("Active Training Block")).not.toBeInTheDocument();

    navButton("Train").click();
    await waitFor(() => screen.getByText("Active Training Block"));
    expect(screen.getByText("1 shot total")).toBeInTheDocument();
  });

  it("Analyze can be opened without discarding an in-progress session", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Train").click();
    await waitFor(() =>
      expect(navButton("Train")).toHaveAttribute("aria-current", "page")
    );

    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));

    fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
      target: { value: "3.80" },
    });
    screen.getByRole("button", { name: "Add Shot" }).click();
    await waitFor(() => screen.getByText("1 shot total"));

    navButton("Analyze").click();
    await waitFor(() =>
      expect(navButton("Analyze")).toHaveAttribute("aria-current", "page")
    );

    navButton("Train").click();
    await waitFor(() => screen.getByText("Active Training Block"));
    expect(screen.getByText("1 shot total")).toBeInTheDocument();
  });
});
