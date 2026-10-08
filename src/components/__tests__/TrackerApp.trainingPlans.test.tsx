// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import {
  EIGHT_GUARDS_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
  ROTATION_COUNT_VERSION_ID,
} from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import TrackerApp from "../TrackerApp";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
});

// PrimaryNavigation renders every item twice (desktop bar + mobile bar) — see
// TrackerApp.navigation.test.tsx for the same helper.
function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

function releaseTimingStep(overrides: {
  id: string;
  stones: number;
  handleStrategy: Record<string, unknown>;
}) {
  return {
    id: overrides.id,
    type: "release-timing",
    completion: { type: "shot-count", value: overrides.stones },
    handleStrategy: overrides.handleStrategy,
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
    },
  };
}

function seedTrainingPlan() {
  const plan = {
    id: "plan-1",
    name: "Release Consistency",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
    steps: [
      releaseTimingStep({
        id: "step-1",
        stones: 2,
        handleStrategy: { type: "alternating", startingHandle: "in" },
      }),
      releaseTimingStep({
        id: "step-2",
        stones: 2,
        handleStrategy: { type: "free" },
      }),
    ],
  };

  localStorage.setItem(
    "curling-release-tracker-training-plans",
    JSON.stringify({ schemaVersion: 1, plans: [plan] })
  );
}

function addShot(releaseTime: string) {
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
    target: { value: releaseTime },
  });
  screen.getByRole("button", { name: "Save Shot" }).click();
}

function catalogVersion(id: string) {
  const version = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!version) throw new Error(`Missing Exercise Version ${id}`);
  return version;
}

function seedMixedTrainingPlan() {
  const releaseTime = releaseTimingStep({
    id: "mixed-release-time",
    stones: 1,
    handleStrategy: { type: "free" },
  });
  const plan = {
    id: "mixed-plan",
    name: "Complete Mixed Practice",
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    schemaVersion: 2,
    steps: [
      {
        id: "technique-step",
        type: "curated-exercise",
        exerciseVersionSnapshot: catalogVersion(RELEASE_POINT_VERSION_ID),
        completion: { type: "exercise-completion" },
      },
      {
        id: "shotmaking-step",
        type: "curated-exercise",
        exerciseVersionSnapshot: catalogVersion(EIGHT_GUARDS_VERSION_ID),
        completion: { type: "exercise-completion" },
      },
      {
        id: "rotation-count-step",
        type: "curated-exercise",
        exerciseVersionSnapshot: catalogVersion(ROTATION_COUNT_VERSION_ID),
        completion: { type: "exercise-completion" },
      },
      {
        ...releaseTime,
        exerciseVersionSnapshot: catalogVersion(RELEASE_TIME_VERSION_ID),
      },
    ],
  };
  localStorage.setItem(
    "curling-release-tracker-training-plans",
    JSON.stringify({ schemaVersion: 2, plans: [plan] })
  );
}

function seedReleaseTimeInMiddlePlan() {
  const plan = {
    id: "release-in-middle-plan",
    name: "Shotmaking Timing Technique",
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    schemaVersion: 2,
    steps: [
      {
        id: "guard-step",
        type: "curated-exercise",
        exerciseVersionSnapshot: catalogVersion(EIGHT_GUARDS_VERSION_ID),
        completion: { type: "exercise-completion" },
      },
      {
        ...releaseTimingStep({
          id: "middle-release-time",
          stones: 1,
          handleStrategy: { type: "free" },
        }),
        exerciseVersionSnapshot: catalogVersion(RELEASE_TIME_VERSION_ID),
      },
      {
        id: "release-point-step",
        type: "curated-exercise",
        exerciseVersionSnapshot: catalogVersion(RELEASE_POINT_VERSION_ID),
        completion: { type: "exercise-completion" },
      },
    ],
  };
  localStorage.setItem(
    "curling-release-tracker-training-plans",
    JSON.stringify({ schemaVersion: 2, plans: [plan] })
  );
}

describe("TrackerApp — Training Plans execution", () => {
  it("continues from a middle Release Time step to the next planned Exercise", async () => {
    seedReleaseTimeInMiddlePlan();
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    screen.getByRole("tab", { name: "Training Plans" }).click();
    await waitFor(() => screen.getByText("Shotmaking Timing Technique"));
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => screen.getByRole("button", { name: "Start Training" }));
    screen.getByRole("button", { name: "Start Training" }).click();

    await waitFor(() => screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" }));
    screen.getByRole("button", { name: "Inhandle" }).click();
    screen.getByRole("button", { name: "4 points, 100 percent" }).click();
    const recordStone = screen.getByRole("button", { name: "Record Stone" });
    await waitFor(() => expect(recordStone).toBeEnabled());
    recordStone.click();
    await waitFor(() => screen.getByText("1 stone recorded"));
    screen.getByRole("button", { name: "Complete Exercise" }).click();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Complete Exercise" })).toBeNull()
    );
    expect(screen.getByText("Next: Release Time")).toBeInTheDocument();
    screen.getByRole("button", { name: "Next Exercise" }).click();

    await waitFor(() => screen.getByText("0 of 1 planned stone"));
    expect(screen.queryByRole("button", { name: "Start New Session" })).toBeNull();
    addShot("3.75");

    await waitFor(() => screen.getByText("1 of 1 planned stone"));
    expect(screen.getByText("Next: Release Point")).toBeInTheDocument();
    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Release Point" }));
    expect(screen.getByText(/Step 3 of 3/)).toBeInTheDocument();
    expect(screen.getByText("This is the last planned exercise.")).toBeInTheDocument();
  });

  it("executes a profile-owned Technique → Shotmaking → Measured plan through the existing runners", async () => {
    seedMixedTrainingPlan();
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    screen.getByRole("tab", { name: "Training Plans" }).click();
    await waitFor(() => screen.getByText("Complete Mixed Practice"));
    expect(screen.getByText("Technique · Shotmaking")).toBeInTheDocument();
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => screen.getByRole("button", { name: "Start Training" }));
    screen.getByRole("button", { name: "Start Training" }).click();

    await waitFor(() => screen.getByRole("heading", { name: "Release Point" }));
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument();
    expect(screen.getByText("Next: Eight Guards, Progressively Longer")).toBeInTheDocument();
    screen.getByRole("button", { name: "Complete Exercise" }).click();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Complete Exercise" })).toBeNull()
    );
    screen.getByRole("button", { name: "Next Exercise" }).click();

    await waitFor(() => screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" }));
    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Inhandle" }).click();
    screen.getByRole("button", { name: "4 points, 100 percent" }).click();
    const recordStone = screen.getByRole("button", { name: "Record Stone" });
    await waitFor(() => expect(recordStone).toBeEnabled());
    recordStone.click();
    await waitFor(() => screen.getByText("1 stone recorded"));
    expect(screen.getByText("Next: Rotation Count")).toBeInTheDocument();
    screen.getByRole("button", { name: "Next Exercise" }).click();

    await waitFor(() => screen.getByRole("heading", { name: "Rotation Count" }));
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Rotation Count/), {
      target: { value: "2.5" },
    });
    screen.getByRole("button", { name: "Record Measurement" }).click();
    await waitFor(() => screen.getAllByText(/2.5 rotations/));
    expect(screen.getByText("Next: Release Time")).toBeInTheDocument();
    screen.getByRole("button", { name: "Next Exercise" }).click();

    await waitFor(() => screen.getByText("Active Training Block"));
    expect(screen.getByText(/Step 4 of 4/)).toBeInTheDocument();
    expect(screen.getByText("This is the last planned exercise.")).toBeInTheDocument();
    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 1 planned stone"));
    expect(screen.queryByRole("button", { name: "Next Exercise" })).toBeNull();
  });

  it("drives a full plan through both steps to completion, then archives it via Finish Training", async () => {
    seedTrainingPlan();
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    screen.getByRole("tab", { name: "Training Plans" }).click();
    await waitFor(() => screen.getByText("Release Consistency"));
    expect(screen.getByText("2 steps · 4 planned timing stones")).toBeInTheDocument();

    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() =>
      screen.getByRole("button", { name: "Start Training" })
    );

    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));

    // Step 1: alternating handles starting In.
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText("0 of 2 planned stones")).toBeInTheDocument();

    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 2 planned stones"));

    // After one saved shot, the alternating strategy now expects Out Handle.
    // (The Live Performance filter below also has an "Out Handle" chip — the
    // Add Shot card's own button is the first one in the DOM.)
    expect(
      screen.getAllByRole("button", { name: "Out Handle" })[0]
    ).toHaveClass("bg-slate-900");

    addShot("3.80");
    await waitFor(() => screen.getByText("2 of 2 planned stones"));
    expect(screen.getByText("Next: Release Time")).toBeInTheDocument();

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    expect(screen.getByText("0 of 2 planned stones")).toBeInTheDocument();

    // Step 2: Free handles — no preselect assertion needed, just volume.
    addShot("3.76");
    await waitFor(() => screen.getByText("1 of 2 planned stones"));
    addShot("3.77");

    await waitFor(() => screen.getByText("2 of 2 planned stones"));
    expect(screen.getByText("This is the last planned exercise.")).toBeInTheDocument();

    // Deliberate extra shots remain allowed once the planned volume is reached.
    addShot("3.78");
    await waitFor(() => screen.getByText("3 of 2 planned stones"));

    screen.getByRole("button", { name: "Finish Training" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Finish Training" }));
    expect(screen.getByRole("button", { name: "Finish" })).not.toHaveClass("bg-red-600");
    screen.getByRole("button", { name: "Finish" }).click();

    await waitFor(() => screen.getByText("Training finished"));
    expect(screen.getAllByText("Completed")).toHaveLength(2);

    navButton("Analyze").click();
    await waitFor(() => screen.getByText("Blocks and Sessions"));
    expect(screen.getByText(/2 blocks · 5 shots/)).toBeInTheDocument();
    expect(
      screen.getByText("Started from: Release Consistency")
    ).toBeInTheDocument();
  });

  it("shows an executable plan's Start action disabled when a step is invalid", async () => {
    const plan = {
      id: "plan-2",
      name: "Broken Plan",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 1,
      steps: [
        {
          id: "step-1",
          type: "release-timing",
          completion: { type: "shot-count", value: 8 },
          handleStrategy: { type: "free" },
          configuration: {
            name: "",
            mode: "variable",
            measurementMode: "hog-hog",
            targetTime: 3.75,
            variableTargetMode: "smart-random",
            blindTargetMode: "fixed",
            smartRandomMin: 2.5,
            smartRandomMax: 4.5,
            accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
          },
        },
      ],
    };

    localStorage.setItem(
      "curling-release-tracker-training-plans",
      JSON.stringify({ schemaVersion: 1, plans: [plan] })
    );

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    screen.getByRole("tab", { name: "Training Plans" }).click();
    await waitFor(() => screen.getByText("Broken Plan"));

    expect(
      screen.getByText(/isn't valid yet — edit it before starting/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });
});
