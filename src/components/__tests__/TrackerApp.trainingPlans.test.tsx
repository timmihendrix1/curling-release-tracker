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
  screen.getByRole("button", { name: "Add Shot" }).click();
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

describe("TrackerApp — Training Plans execution", () => {
  it("executes a profile-owned Technique → Shotmaking → Measured plan through the existing runners", async () => {
    seedMixedTrainingPlan();
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByText("Set Up Training Block"));
    screen.getByRole("tab", { name: "Training Plans" }).click();
    await waitFor(() => screen.getByText("Complete Mixed Practice"));
    expect(screen.getByText("Technique · Shotmaking · Measured")).toBeInTheDocument();
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => screen.getByRole("button", { name: "Start Training" }));
    screen.getByRole("button", { name: "Start Training" }).click();

    await waitFor(() => screen.getByRole("heading", { name: "Release Point" }));
    expect(screen.getByText(/Step 1 of 4/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Complete Exercise" }).click();
    await waitFor(() => screen.getByText("Next: Eight Guards, Progressively Longer"));
    screen.getByRole("button", { name: "Continue to Next Step" }).click();

    await waitFor(() => screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" }));
    expect(screen.getByText(/Step 2 of 4/)).toBeInTheDocument();
    screen.getByRole("button", { name: "Inhandle" }).click();
    screen.getByRole("button", { name: "4 points, 100 percent" }).click();
    const recordStone = screen.getByRole("button", { name: "Record Stone" });
    await waitFor(() => expect(recordStone).toBeEnabled());
    recordStone.click();
    await waitFor(() => screen.getByText("1 stone recorded"));
    screen.getByRole("button", { name: "Complete Exercise" }).click();
    await waitFor(() => screen.getByText("Next: Rotation Count"));
    screen.getByRole("button", { name: "Continue to Next Step" }).click();

    await waitFor(() => screen.getByRole("heading", { name: "Rotation Count" }));
    expect(screen.getByText(/Step 3 of 4/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Rotation Count/), {
      target: { value: "2.5" },
    });
    screen.getByRole("button", { name: "Record Measurement" }).click();
    await waitFor(() => screen.getAllByText(/2.5 rotations/));
    screen.getByRole("button", { name: "Complete Exercise" }).click();
    await waitFor(() => screen.getByText("Next: Release Time"));
    screen.getByRole("button", { name: "Continue to Next Step" }).click();

    await waitFor(() => screen.getByText("Active Training Block"));
    expect(screen.getByText(/Step 4 of 4/)).toBeInTheDocument();
    addShot("3.75");
    await waitFor(() => screen.getByText("Plan complete"));
    expect(screen.getByText("All 4 steps completed.")).toBeInTheDocument();
  });

  it("drives a full plan through both steps to completion, then archives it via Finish Training", async () => {
    seedTrainingPlan();
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Train").click();
    await waitFor(() => screen.getByText("Set Up Training Block"));

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
    expect(screen.getByText("Stone 0 of 2")).toBeInTheDocument();

    addShot("3.75");
    await waitFor(() => screen.getByText("Stone 1 of 2"));

    // After one saved shot, the alternating strategy now expects Out Handle.
    // (The Live Summary filter below also has an "Out Handle" chip — the
    // Add Shot card's own button is the first one in the DOM.)
    expect(
      screen.getAllByRole("button", { name: "Out Handle" })[0]
    ).toHaveClass("bg-slate-900");

    addShot("3.80");
    await waitFor(() =>
      screen.getByText("Step complete — Release Time")
    );
    expect(screen.getByText("Next: Release Time")).toBeInTheDocument();
    expect(
      screen.queryByText("Plan complete")
    ).not.toBeInTheDocument();

    screen.getByRole("button", { name: "Continue to Next Step" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    expect(screen.getByText("Stone 0 of 2")).toBeInTheDocument();

    // Step 2: Free handles — no preselect assertion needed, just completion.
    addShot("3.76");
    await waitFor(() => screen.getByText("Stone 1 of 2"));
    addShot("3.77");

    await waitFor(() => screen.getByText("Plan complete"));
    expect(screen.getByText("All 2 steps completed.")).toBeInTheDocument();
    expect(
      screen.queryByText("Step complete — Release Time")
    ).not.toBeInTheDocument();

    // Deliberate extra shots remain allowed after plan completion.
    addShot("3.78");
    await waitFor(() => expect(screen.getByText("All 2 steps completed.")).toBeInTheDocument());
    expect(screen.getByText("Plan complete")).toBeInTheDocument();

    screen.getByRole("button", { name: "Finish Training" }).click();
    await waitFor(() => screen.getByText("Start New Session"));
    screen.getByRole("button", { name: "Start" }).click();

    await waitFor(() => screen.getByText("Set Up Training Block"));

    navButton("Analyze").click();
    await waitFor(() => screen.getByText("Blocks and Sessions"));
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
    await waitFor(() => screen.getByText("Set Up Training Block"));

    screen.getByRole("tab", { name: "Training Plans" }).click();
    await waitFor(() => screen.getByText("Broken Plan"));

    expect(
      screen.getByText(/isn't valid yet — edit it before starting/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });
});
