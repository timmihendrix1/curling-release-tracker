// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TrackerApp from "../TrackerApp";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
});

describe("TrackerApp — active Training live summary", () => {
  it("shows a compact empty state instead of false-zero metrics before any shot is recorded", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    fireEvent.click(screen.getByRole("button", { name: "View Details: Release Time" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Timing Setup" }));
    await waitFor(() => screen.getByText("Set Up Training Block"));

    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));

    // No shot recorded yet — must not show a false "Average 0.00s" /
    // "Release SD 0.000" as if they were measured values.
    expect(
      screen.getByText("Add a shot to begin the live summary.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Average")).not.toBeInTheDocument();
    expect(screen.queryByText("Release SD")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
      target: { value: "3.80" },
    });
    screen.getByRole("button", { name: "Add Shot" }).click();
    await waitFor(() => screen.getByText("1 shot total"));

    // Once real data exists, the actual metrics take over from the empty state.
    expect(
      screen.queryByText("Add a shot to begin the live summary.")
    ).not.toBeInTheDocument();
    expect(screen.getByText("Average")).toBeInTheDocument();
  });
});
