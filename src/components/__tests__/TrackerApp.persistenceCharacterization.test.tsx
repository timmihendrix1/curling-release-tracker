// @vitest-environment jsdom
//
// Characterization tests for TrackerApp's CURRENT, pre-repository direct-`localStorage`
// persistence behavior — written and run green against the unchanged production
// implementation before any StorageAdapter/repository/hydration code exists, per
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §11 step 1. These capture the exact baseline the
// Phase 1 repository boundary must not silently change: the current-session-before-
// session-history write order (§6.1) and the empty-session archive guard (§6.2).
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";
const SESSION_HISTORY_KEY = "curling-release-tracker-session-history";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
});

// PrimaryNavigation renders every item twice (desktop bar + mobile bar) — see the same
// helper in TrackerApp.navigation.test.tsx.
function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

async function startTrainingAndAddOneShot() {
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));

  screen.getByRole("button", { name: "Start Training" }).click();
  await waitFor(() => screen.getByText("Set Up Training Block"));

  screen.getByRole("button", { name: "Start Training" }).click();
  await waitFor(() => screen.getByText("Active Training Block"));

  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
    target: { value: "3.80" },
  });
  screen.getByRole("button", { name: "Add Shot" }).click();
  await waitFor(() => screen.getByText("1 shot total"));
}

function openEditDetails() {
  screen.getByText(/Edit Details —/).click();
}

describe("TrackerApp persistence characterization (current, pre-repository behavior)", () => {
  // Corrected by docs/adr/0014-session-archive-write-ordering.md: the session-archiving
  // transition now writes session-history to completion before it even attempts the
  // replacement current-session write — coordinated at the repository boundary via
  // `SessionRepository.archiveAndReplace`, not by relying on React's effect-declaration
  // order (which previously wrote current-session first — the exact ordering this ADR
  // found unsafe once a genuinely asynchronous adapter is introduced).
  it("writes the session-history key to completion before the current-session key when starting a new session with a recorded shot", async () => {
    await startTrainingAndAddOneShot();
    openEditDetails();

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    setItemSpy.mockClear();

    screen.getByRole("button", { name: "Start New Session" }).click();
    await waitFor(() => screen.getByText("Start New Session"));
    screen.getByRole("button", { name: "Start" }).click();

    // handleStartNewSession navigates to Train with a fresh, block-less session.
    await waitFor(() => screen.getByText("Set Up Training Block"));

    const keysInCallOrder = setItemSpy.mock.calls.map(([key]) => key);
    const sessionHistoryIndex = keysInCallOrder.indexOf(SESSION_HISTORY_KEY);
    const currentSessionIndex = keysInCallOrder.indexOf(CURRENT_SESSION_KEY);

    expect(sessionHistoryIndex).toBeGreaterThanOrEqual(0);
    expect(currentSessionIndex).toBeGreaterThanOrEqual(0);
    expect(sessionHistoryIndex).toBeLessThan(currentSessionIndex);

    setItemSpy.mockRestore();
  });

  it("writes each key exactly once for the archive transition — the ordinary, independent per-key save effects do not repeat or reorder the coordinated write", async () => {
    await startTrainingAndAddOneShot();
    openEditDetails();

    const setItemSpy = vi.spyOn(Storage.prototype, "setItem");
    setItemSpy.mockClear();

    screen.getByRole("button", { name: "Start New Session" }).click();
    await waitFor(() => screen.getByText("Start New Session"));
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => screen.getByText("Set Up Training Block"));

    // Give any further, independently-scheduled render/effect cycle a chance to run —
    // if the ordinary save effects redundantly re-persisted this same transition (in
    // their own declaration order), it would show up as a second call to one of these
    // two keys.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const keysInCallOrder = setItemSpy.mock.calls.map(([key]) => key);
    const historyCalls = keysInCallOrder.filter((key) => key === SESSION_HISTORY_KEY);
    const currentSessionCalls = keysInCallOrder.filter((key) => key === CURRENT_SESSION_KEY);

    expect(historyCalls).toHaveLength(1);
    expect(currentSessionCalls).toHaveLength(1);

    setItemSpy.mockRestore();
  });

  it("archives the recorded-shot session into history on Start New Session", async () => {
    await startTrainingAndAddOneShot();
    openEditDetails();

    screen.getByRole("button", { name: "Start New Session" }).click();
    await waitFor(() => screen.getByText("Start New Session"));
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => screen.getByText("Set Up Training Block"));

    const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) ?? "[]");
    expect(history).toHaveLength(1);
    expect(history[0].shots).toHaveLength(1);
  });

  it("does not archive an empty (zero-shot) session into history on Start New Session", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Set Up Training Block"));
    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));

    openEditDetails();
    screen.getByRole("button", { name: "Start New Session" }).click();
    await waitFor(() => screen.getByText("Start New Session"));
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => screen.getByText("Set Up Training Block"));

    const rawHistory = localStorage.getItem(SESSION_HISTORY_KEY);
    const history = rawHistory ? JSON.parse(rawHistory) : [];
    expect(history).toHaveLength(0);
  });

  it("reloads a previously-stored session without falling back to defaults", async () => {
    const storedSession = {
      id: "s-1",
      title: "Reloaded Session",
      date: new Date().toISOString(),
      notes: "",
      blocks: [
        {
          id: "b-1",
          name: "Block 1",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
          createdAt: new Date().toISOString(),
          accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        },
      ],
      activeBlockId: "b-1",
      shots: [],
    };
    localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(storedSession));
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify([]));

    render(<TrackerApp />);

    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByText("Active Training Block"));
    expect(screen.getByText(/Reloaded Session/)).toBeInTheDocument();
  });
});
