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

  it("Analyze is reachable and its visible title is Analyze / History & Analytics", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Analyze").click();

    await waitFor(() =>
      expect(navButton("Analyze")).toHaveAttribute("aria-current", "page")
    );
    expect(screen.getByRole("heading", { name: "Analyze" })).toBeInTheDocument();
    expect(screen.getByText("History & Analytics")).toBeInTheDocument();
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
