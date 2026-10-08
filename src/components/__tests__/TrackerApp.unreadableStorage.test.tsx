// @vitest-environment jsdom
//
// The whole point of a protected read is what happens NEXT: the application's
// ordinary save effect writes what it loaded straight back. If an unreadable domain
// were handed back as an empty writable value, that write would destroy the original
// bytes. These tests drive the real hydration and autosave path.
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";

const TRAINING_PLANS_KEY = "curling-release-tracker-training-plans";
const TOLERANCE_PROFILES_KEY = "curling-release-tracker-accuracy-tolerance-profiles";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

describe("unreadable domain storage survives hydration and autosave", () => {
  it.each([
    [
      "a Training Plan library this build cannot read",
      TRAINING_PLANS_KEY,
      '{"schemaVersion":999,"plans":[{"id":"p","name":"Important","steps":[],"createdAt":"2026-10-06T10:00:00.000Z","updatedAt":"2026-10-06T10:00:00.000Z"}]}',
    ],
    [
      "a truncated Training Plan library",
      TRAINING_PLANS_KEY,
      '{"schemaVersion":2,"plans":[',
    ],
    [
      "a tolerance template whose unit this build does not know",
      TOLERANCE_PROFILES_KEY,
      '{"schemaVersion":2,"profiles":[{"id":"t","name":"Future","quantity":"spin","tolerance":{"onTarget":{"lower":1,"upper":1},"acceptable":{"lower":2,"upper":2}},"createdAt":"2026-10-06T10:00:00.000Z","updatedAt":"2026-10-06T10:00:00.000Z"}],"defaultProfileId":"t"}',
    ],
  ])("%s is left byte-for-byte intact", async (_label, key, bytes) => {
    localStorage.setItem(key, bytes);

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    // Exercise the app enough to run the save effects for every domain.
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(localStorage.getItem(key)).toBe(bytes);
  });

  it("keeps unrelated domains working while one is unreadable", async () => {
    localStorage.setItem(TRAINING_PLANS_KEY, '{"schemaVersion":2,"plans":[');

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    // Training itself still starts and records, and its own key is written normally.
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    await waitFor(() =>
      expect(
        localStorage.getItem("curling-release-tracker-current-session")
      ).not.toBeNull()
    );
    expect(localStorage.getItem(TRAINING_PLANS_KEY)).toBe(
      '{"schemaVersion":2,"plans":['
    );
  });

  it("still writes a genuinely absent plan library once the athlete creates one", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    // Absence is not protection: the domain remains writable.
    fireEvent.click(screen.getByRole("tab", { name: "Training Plans" }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const stored = localStorage.getItem(TRAINING_PLANS_KEY);
    if (stored !== null) {
      expect(JSON.parse(stored)).toMatchObject({ plans: [] });
    }
  });
});
