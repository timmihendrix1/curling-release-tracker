// @vitest-environment jsdom
//
// Outstanding work belongs to the TRAINING, not to whichever exercise is running.
//
// A stone left half-measured in a Release Timing step must stay completable after the
// plan advances to a curated Shotmaking or Technique exercise — without going back to
// the earlier step or disturbing plan progress. Mounting the completion panel inside a
// runner branch made it disappear at exactly the moment the athlete had moved on.
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import { sessionRepository } from "../../lib/sessionRepository";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import {
  EIGHT_GUARDS_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
} from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import type { Session } from "../../types";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";
const TRAINING_PLANS_KEY = "curling-release-tracker-training-plans";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

function stored(): Session {
  return JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!) as Session;
}

function catalogVersion(id: string) {
  const version = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!version) throw new Error(`Missing Exercise Version ${id}`);
  return version;
}

/** A Both Release Timing step followed by a curated Shotmaking exercise. */
function seedMixedPlan() {
  localStorage.setItem(
    TRAINING_PLANS_KEY,
    JSON.stringify({
      schemaVersion: 2,
      plans: [
        {
          id: "mixed-plan",
          name: "Mixed completion",
          createdAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
          schemaVersion: 2,
          steps: [
            {
              id: "both",
              type: "release-timing",
              exerciseVersionSnapshot: catalogVersion(RELEASE_TIME_VERSION_ID),
              completion: { type: "shot-count", value: 8 },
              handleStrategy: { type: "free" },
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
            {
              id: "guards",
              type: "curated-exercise",
              exerciseVersionSnapshot: catalogVersion(EIGHT_GUARDS_VERSION_ID),
              completion: { type: "exercise-completion" },
            },
          ],
        },
      ],
    })
  );
}

/** Starts the plan, records a time-only stone, then advances to the curated step. */
async function advanceToCuratedStep() {
  seedMixedPlan();
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));
  screen.getAllByRole("button", { name: "Train" })[0].click();
  await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  screen.getByRole("tab", { name: "Training Plans" }).click();
  await waitFor(() => screen.getByRole("button", { name: "Start" }));
  screen.getByRole("button", { name: "Start" }).click();
  await waitFor(() => screen.getByRole("button", { name: "Start Training" }));
  screen.getByRole("button", { name: "Start Training" }).click();
  await waitFor(() => screen.getByPlaceholderText("3.75 or 375"));

  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
    target: { value: "3.70" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
  await waitFor(() => expect(stored().shots).toHaveLength(1));

  const progressBefore = stored().planExecution?.activeStepIndex;
  fireEvent.click(screen.getByRole("button", { name: "Next Exercise" }));
  await waitFor(() =>
    screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" })
  );
  return { progressBefore };
}

describe("missing measurements stay reachable during a curated exercise", () => {
  it("offers the earlier stone and completes it without touching plan progress", async () => {
    await advanceToCuratedStep();

    const row = screen.getByRole("button", { name: /Stone 1 · In Handle/ });
    expect(row).toBeInTheDocument();

    const stepIndexBefore = stored().planExecution?.activeStepIndex;
    const shotCountBefore = stored().shots.length;

    fireEvent.click(row);
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() => expect(stored().shots[0].speed).toBe(2.41));

    // The completion adds a measurement to an existing stone — nothing else moves.
    expect(stored().shots).toHaveLength(shotCountBefore);
    expect(stored().planExecution?.activeStepIndex).toBe(stepIndexBefore);
    expect(stored().shots[0].releaseTime).toBe(3.7);
    expect(stored().shots[0].targetSpeed).toBe(2.4);
  });

  it("keeps a failed completion recoverable from the curated runner", async () => {
    await advanceToCuratedStep();

    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    let failing = true;
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) =>
      failing
        ? ({ ok: false, error: { kind: "unknown", message: "fail" } } as never)
        : real(session)
    );

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    // Visible and retryable here, in the curated runner, without going back.
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));
    expect(screen.getByLabelText(/Speed for stone 1/)).toHaveValue("2.41");

    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry Saving" }));
    await waitFor(() => expect(stored().shots[0].speed).toBe(2.41));
    expect(stored().shots).toHaveLength(1);
    await act(async () => {});
  });
});
