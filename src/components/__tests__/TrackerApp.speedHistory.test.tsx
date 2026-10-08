// @vitest-environment jsdom
//
// The archived-session summary under Analyze -> Blocks and Sessions, for trainings
// that recorded a speed.
//
// The specific failure this guards is a FABRICATED ZERO. The seconds figures there
// ("Average", "Release SD") are computed from the time-measured stones, which for a
// speed-only session is an empty set — and an average of nothing renders as "0.00s".
// A reader cannot tell that from a real 0.00s measurement, so the seconds figures are
// withheld entirely and the speed figures are shown in their own unit instead.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import type { Session } from "../../types";
import {
  bothBlock,
  bothShot,
  session as measurementSession,
  speedBlock,
  speedShot,
  timeShot,
} from "../../lib/measurement/__tests__/measurementFixtures";

const SESSION_HISTORY_KEY = "curling-release-tracker-session-history";

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

async function expandArchivedSession(title: string) {
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));
  navButton("Analyze").click();
  await waitFor(() => screen.getByText("Blocks and Sessions"));

  fireEvent.click(screen.getByText(title));
  await waitFor(() => screen.getByText("Hide Details"));

  // Scoped to this session's own card. The surrounding Analyze screen has its own
  // aggregate figures, which are a different question from "what did THIS session
  // measure" and would otherwise satisfy these assertions by accident.
  const panel = screen.getByText(title).closest("div")?.parentElement;
  if (!panel) throw new Error("expected the session panel");
  return panel;
}

function archive(state: Session) {
  localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify([state]));
}

describe("an archived speed-only session", () => {
  function speedSession(title: string): Session {
    const block = speedBlock();
    const state = measurementSession([block], []);
    state.title = title;
    state.shots = [
      speedShot(block, 2.42, { sessionId: state.id, shotNumber: 1 }),
      speedShot(block, 2.38, { sessionId: state.id, shotNumber: 2 }),
    ];
    return state;
  }

  it("is findable in history and shows its speed figures in m/s", async () => {
    archive(speedSession("Speed review session"));
    const panel = await expandArchivedSession("Speed review session");

    // Twice: once for the session total, once for its single block's own detail.
    expect(within(panel).getAllByText("Average Speed").length).toBeGreaterThan(0);
    // (2.42 + 2.38) / 2 = 2.40
    expect(within(panel).getAllByText("2.40 m/s").length).toBeGreaterThan(0);
    // Both stones are within ±0.05 m/s of the 2.40 target.
    expect(within(panel).getAllByText("within ±0.05m/s").length).toBeGreaterThan(0);
  });

  it("shows no seconds figure at all, rather than a fabricated 0.00s", async () => {
    archive(speedSession("Speed review session"));
    const panel = await expandArchivedSession("Speed review session");

    // The seconds cards are withheld, not rendered with an empty-set average.
    // Asserted on the panel's own text, so a figure belonging to the surrounding
    // Analyze screen cannot satisfy or break this.
    const text = panel.textContent ?? "";
    expect(text).not.toContain("Release SD");
    expect(text).not.toContain("0.00s");
    expect(text).not.toContain("0.000");
    // No timing interval is implied for a training that measured no time, and no
    // seconds target is printed for its block.
    expect(text).not.toContain("Backline – Hog");
    expect(text).not.toContain("Hog – Hog");
    expect(text).not.toContain("Target 3.75s");
  });
});

describe("an archived Both session", () => {
  it("reports each quantity in its own unit, with its own denominator", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.title = "Both review session";
    state.shots = [
      bothShot(block, 3.76, 2.41, { sessionId: state.id, shotNumber: 1 }),
      // A stone with a time but no speed: it belongs to the time denominator only.
      timeShot(block, 3.8, { sessionId: state.id, shotNumber: 2 }),
    ];
    archive(state);

    const panel = await expandArchivedSession("Both review session");

    // Both groups are present, each labelled, and neither borrows the other's unit.
    const text = panel.textContent ?? "";
    expect(text).toContain("Release SD");
    expect(text).toContain("Average Speed");
    expect(text).toContain("Speed SD");
    // The one speed-measured stone, not two with a fabricated 0.00 m/s.
    expect(text).toContain("2.41 m/s");
    // (3.76 + 3.80) / 2 = 3.78
    expect(text).toContain("3.78s");
  });
});
