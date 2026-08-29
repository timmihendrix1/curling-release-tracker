// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TrackerApp from "../TrackerApp";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

async function openExercise(title: string) {
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));
  navButton("Train").click();
  await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  const category = title === "Release Point"
    ? "Technique"
    : title === "Eight Guards, Progressively Longer"
      ? "Shotmaking"
      : "Measured Exercises";
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${category}`) }));
  fireEvent.click(screen.getByRole("button", { name: `View Details: ${title}` }));
}

function persistedSession() {
  const raw = localStorage.getItem(CURRENT_SESSION_KEY);
  if (!raw) throw new Error("Current Session was not persisted");
  return JSON.parse(raw);
}

describe("TrackerApp Solo Exercise execution", () => {
  it("does not create an Exercise result until the athlete confirms the physical setup", async () => {
    await openExercise("Release Point");
    fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));

    expect(
      screen.getByRole("button", { name: "Setup Complete — Start Exercise" })
    ).toBeInTheDocument();
    expect(persistedSession().exerciseExecutions).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "← Back to Exercise Library" }));
    expect(screen.getByRole("heading", { level: 2, name: "Exercises" })).toBeInTheDocument();
    expect(persistedSession().exerciseExecutions).toBeUndefined();
  });

  it("starts, notes and completes Technique directly from the Library", async () => {
    await openExercise("Release Point");
    fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup Complete — Start Exercise" }));

    expect(await screen.findByRole("heading", { name: "Release Point" })).toBeInTheDocument();
    expect(screen.getByText("Observe and discuss")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Private athlete note"), {
      target: { value: "Observed by a teammate." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));

    await waitFor(() => {
      const session = persistedSession();
      expect(session.activeExerciseExecutionId).toBeUndefined();
      expect(session.exerciseExecutions).toHaveLength(1);
      expect(session.exerciseExecutions[0]).toMatchObject({
        status: "completed",
        exerciseVersionSnapshot: { primaryFocus: "technique", title: "Release Point" },
        athleteResults: [{ privateNote: "Observed by a teammate.", attempts: [] }],
      });
    });
  });

  it("records an arbitrary-length Shotmaking result against actual handle and 0-4 score", async () => {
    await openExercise("Eight Guards, Progressively Longer");
    fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup Complete — Start Exercise" }));

    fireEvent.click(await screen.findByRole("button", { name: "Outhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "4 points, 100 percent" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Stone" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));

    await waitFor(() => {
      const execution = persistedSession().exerciseExecutions[0];
      expect(execution.status).toBe("completed");
      expect(execution.configuration.plannedVolume).toBeUndefined();
      expect(execution.athleteResults[0].attempts).toHaveLength(1);
      expect(execution.athleteResults[0].attempts[0]).toMatchObject({
        kind: "shotmaking",
        actualHandle: "out",
        evaluation: { status: "scored", score: 4 },
      });
    });
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("4/4")).toBeInTheDocument();
  });

  it("routes a Measured Library Exercise into the existing Release Timing setup and snapshots provenance", async () => {
    await openExercise("Release Time");
    fireEvent.click(screen.getByRole("button", { name: "Continue to Timing Setup" }));

    expect(screen.getByRole("status")).toHaveTextContent("From Exercise Library");
    expect(screen.getByRole("status")).toHaveTextContent("Release Time");
    expect(screen.getByRole("button", { name: "Fixed Weight" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Variable Weight" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Blind Weight" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    await waitFor(() => screen.getByText("Active Training Block"));
    await waitFor(() => {
      const session = persistedSession();
      expect(session.blocks[0].mode).toBe("variable");
      expect(session.exerciseExecutions).toBeUndefined();
      expect(session.releaseTimingExerciseVersionSnapshot).toMatchObject({
        title: "Release Time",
        primaryFocus: "measured",
        version: 1,
      });
    });
  });

  it("runs a non-timing Measured Exercise through the generic execution aggregate", async () => {
    await openExercise("Rotation Count");
    fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
    fireEvent.click(screen.getByRole("button", { name: "Setup Complete — Start Exercise" }));

    fireEvent.change(await screen.findByLabelText(/Rotation Count/), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));

    await waitFor(() => {
      const session = persistedSession();
      expect(session.releaseTimingExerciseVersionSnapshot).toBeUndefined();
      expect(session.exerciseExecutions[0]).toMatchObject({
        status: "completed",
        exerciseVersionSnapshot: { title: "Rotation Count", primaryFocus: "measured" },
        athleteResults: [{
          attempts: [{
            kind: "measurement",
            measurements: [{ value: 2.5, source: "manual" }],
          }],
        }],
      });
    });
  });

  it("does not expose Release Timing as a separate Quick Start path", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    fireEvent.click(screen.getByRole("button", { name: /^Measured Exercises/ }));
    expect(screen.queryByRole("tab", { name: "Quick Start" })).toBeNull();
    expect(screen.queryByText("Set Up Training Block")).toBeNull();
    expect(
      screen.getByRole("button", { name: "View Details: Release Time" })
    ).toBeInTheDocument();
  });
});
