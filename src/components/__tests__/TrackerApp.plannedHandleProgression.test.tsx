// @vitest-environment jsdom
//
// Where a genuinely NEW manual stone gets its handle and target from, while an
// earlier stone's write is still outstanding.
//
// Two transitions are easy to conflate and must stay separate:
//
//   - an UNSUBMITTED draft the athlete is still editing — nothing, least of all an
//     unrelated device result, may rewrite its intent;
//   - an already-SUBMITTED draft whose write has not settled — its measurements stay
//     on screen for recovery, but starting the next stone must use the next stone's
//     defaults, not the recorded one's. Choosing a handle or shot type for that next
//     stone is neither: it keeps the recovery values and keeps the progression.
//
// Only a plan with a handle STRATEGY and a genuinely delayed write can tell these
// apart: a free-handle block has no progression to inherit wrongly, and an
// immediately-acknowledged save clears the draft before the question arises.
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import { sessionRepository } from "../../lib/sessionRepository";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { RELEASE_TIME_VERSION_ID } from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import type { Handle, Session, TimingResult } from "../../types";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";
const TRAINING_PLANS_KEY = "curling-release-tracker-training-plans";

const listeners: Array<(result: TimingResult) => void> = [];

vi.mock("../../lib/simulatorTimingProvider", () => ({
  createSimulatorTimingProvider: () => ({
    type: "simulator",
    subscribe: (listener: (result: TimingResult) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    start: () => {},
    stop: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  listeners.length = 0;
});

beforeEach(() => {
  localStorage.clear();
});

function stored(): Session {
  return JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!) as Session;
}

function handles(): Handle[] {
  return stored().shots.map((shot) => shot.handle);
}

function catalogVersion(id: string) {
  const version = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!version) throw new Error(`Missing Exercise Version ${id}`);
  return version;
}

/** One Both step whose handles alternate, starting In. */
function seedAlternatingPlan() {
  localStorage.setItem(
    TRAINING_PLANS_KEY,
    JSON.stringify({
      schemaVersion: 2,
      plans: [
        {
          id: "alternating-plan",
          name: "Alternating",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          schemaVersion: 2,
          steps: [
            {
              id: "both",
              type: "release-timing",
              exerciseVersionSnapshot: catalogVersion(RELEASE_TIME_VERSION_ID),
              completion: { type: "shot-count", value: 8 },
              handleStrategy: { type: "alternating", startingHandle: "in" },
              configuration: {
                name: "",
                mode: "fixed",
                measurementMode: "back-hog",
                targetTime: 3.75,
                variableTargetMode: "smart-random",
                blindTargetMode: "fixed",
                smartRandomMin: 2.5,
                smartRandomMax: 4.5,
                accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
                measurement: {
                  quantities: ["time", "speed"],
                  time: {
                    target: 3.75,
                    tolerance: {
                      onTarget: { lower: 0.1, upper: 0.1 },
                      acceptable: { lower: 0.2, upper: 0.2 },
                    },
                  },
                  speed: {
                    target: 2.4,
                    tolerance: {
                      onTarget: { lower: 0.05, upper: 0.05 },
                      acceptable: { lower: 0.1, upper: 0.1 },
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    })
  );
}

async function startAlternatingPlan() {
  seedAlternatingPlan();
  render(<TrackerApp />);
  await waitFor(() => screen.getByTestId("house-home"));
  screen.getAllByRole("button", { name: "Train" })[0].click();
  await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  screen.getByRole("tab", { name: "Training Plans" }).click();
  await waitFor(() => screen.getByRole("button", { name: "Start" }));
  screen.getByRole("button", { name: "Start" }).click();
  await waitFor(() => screen.getByRole("button", { name: "Start Training" }));
  screen.getByRole("button", { name: "Start Training" }).click();
  await waitFor(() => screen.getByLabelText(/^Speed \(m\/s\)/));
  await act(async () => {});
}

const typeSpeed = (value: string) =>
  fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), { target: { value } });
const saveShot = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

/** Holds every write until released, then performs the real save. */
function heldWrites() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = sessionRepository.saveCurrent.bind(sessionRepository);
  vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) => {
    await held;
    return real(session);
  });
  return { release };
}

describe("a new stone started before the previous write acknowledges", () => {
  it("uses the next planned handle rather than inheriting the recorded one", async () => {
    await startAlternatingPlan();
    const { release } = heldWrites();

    typeSpeed("2.41");
    saveShot();
    // Second stone begun while the first write is still outstanding.
    typeSpeed("2.42");
    saveShot();

    await act(async () => release());
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    expect(handles()).toEqual(["in", "out"]);
    expect(stored().shots.map((shot) => shot.speed)).toEqual([2.41, 2.42]);
  });

  it("progresses across three stones with no write acknowledged in between", async () => {
    await startAlternatingPlan();
    const { release } = heldWrites();

    typeSpeed("2.41");
    saveShot();
    typeSpeed("2.42");
    saveShot();
    typeSpeed("2.43");
    saveShot();

    await act(async () => release());
    await waitFor(() => expect(stored().shots).toHaveLength(3));

    expect(handles()).toEqual(["in", "out", "in"]);
  });

  it("keeps progressing when the earlier write FAILED rather than being delayed", async () => {
    await startAlternatingPlan();

    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    let failing = true;
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) =>
      failing
        ? ({ ok: false, error: { kind: "unknown", message: "fail" } } as never)
        : real(session)
    );

    typeSpeed("2.41");
    saveShot();
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    failing = false;
    typeSpeed("2.42");
    saveShot();

    await waitFor(() => expect(stored().shots).toHaveLength(2));
    // The accepted-but-unsaved first stone already advanced the strategy.
    expect(handles()).toEqual(["in", "out"]);
  });

  it("respects an explicit handle override on the new stone", async () => {
    await startAlternatingPlan();
    const { release } = heldWrites();

    typeSpeed("2.41");
    saveShot();

    // The plan would expect Out; the athlete deliberately chooses In for this one.
    const entry = screen.getByRole("heading", { name: "Add Shot" }).closest("div");
    if (!entry) throw new Error("expected the entry panel");
    fireEvent.change(within(entry).getByRole("combobox", { name: "Handle" }), { target: { value: "in" } });
    typeSpeed("2.42");
    saveShot();

    await act(async () => release());
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    expect(handles()).toEqual(["in", "in"]);
  });

  it("does not carry the recorded stone's other measurement into the new one", async () => {
    await startAlternatingPlan();
    const { release } = heldWrites();

    // A complete Both stone, then a speed-only one started before it settles.
    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    typeSpeed("2.41");
    saveShot();

    typeSpeed("2.42");
    saveShot();

    await act(async () => release());
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    const [first, second] = stored().shots;
    expect(first).toMatchObject({ releaseTime: 3.8, speed: 2.41 });
    // 3.80 belonged to the stone already recorded; recording it again here would
    // invent a measurement the athlete never took for this stone.
    expect(second.speed).toBe(2.42);
    expect("releaseTime" in second).toBe(false);
  });

  it("keeps the retained values visible when only the handle is changed", async () => {
    await startAlternatingPlan();
    const { release } = heldWrites();

    typeSpeed("2.41");
    saveShot();

    const entry = screen.getByRole("heading", { name: "Add Shot" }).closest("div");
    if (!entry) throw new Error("expected the entry panel");
    fireEvent.change(within(entry).getByRole("combobox", { name: "Handle" }), { target: { value: "in" } });

    // Choosing a handle is not editing a measurement: the outstanding stone's values
    // stay on screen, so a failure would still be recoverable from them.
    expect(screen.getByLabelText(/^Speed \(m\/s\)/)).toHaveValue("2.41");

    await act(async () => release());
    await waitFor(() => expect(stored().shots).toHaveLength(1));
  });

  it("keeps the planned next handle when only the shot type is chosen first", async () => {
    await startAlternatingPlan();
    const { release } = heldWrites();

    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    typeSpeed("2.41");
    saveShot();

    // A selection made for the next stone before any measurement is entered for it.
    const entry = screen.getByRole("heading", { name: "Add Shot" }).closest("div");
    if (!entry) throw new Error("expected the entry panel");
    fireEvent.change(within(entry).getByRole("combobox", { name: "Shot type" }), { target: { value: "takeout" } });

    typeSpeed("2.42");
    saveShot();

    await act(async () => release());
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    // The selection was about the shot type, so the plan's handle progression still
    // applies — and the recorded stone's release time did not come along with it.
    expect(handles()).toEqual(["in", "out"]);
    const [, second] = stored().shots;
    expect(second).toMatchObject({ speed: 2.42, shotType: "takeout" });
    expect("releaseTime" in second).toBe(false);
  });
});

describe("an unsubmitted draft is still protected", () => {
  it("is not rewritten by a real incoming provider event", async () => {
    await startAlternatingPlan();

    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
    await waitFor(() => screen.getByRole("heading", { name: "Add Shot" }));

    // Started as In, never submitted.
    typeSpeed("2.41");

    expect(listeners.length).toBeGreaterThan(0);
    await act(async () => {
      listeners[0]({
        id: "device-during-edit",
        source: "simulator",
        receivedAt: "2026-10-08T10:00:00.000Z",
        measurements: [{ measurementMode: "back-hog", value: 3.8 }],
      });
    });
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    // The device stone advanced the strategy, but this draft was already in progress.
    saveShot();
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    expect(stored().shots[1]).toMatchObject({ handle: "in", speed: 2.41 });
  });
});
