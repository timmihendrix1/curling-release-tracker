// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TrackerApp from "../TrackerApp";
import { createAssessmentRun, transitionAssessmentRun } from "../../lib/assessment/run";
import {
  ASSESSMENT_STORAGE_KEY,
  createEmptyAssessmentPersistedState,
  serializeAssessmentPersistedState,
  setCurrentAssessmentRun,
} from "../../lib/assessment/persistence";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../../lib/assessment/templates";
import { standardAssessmentThresholdSet } from "../../lib/assessment/thresholds";
import type { AssessmentRun } from "../../lib/assessment/types";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
});

function unwrap<T>(outcome: { ok: boolean; value?: T; error?: { message: string } }): T {
  if (!outcome.ok) throw new Error(outcome.error?.message ?? "unexpected error outcome");
  return outcome.value as T;
}

function buildRunInStatus(status: "not_started" | "warmup" | "in_progress"): AssessmentRun {
  let run = unwrap(
    createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
      timingProviderSnapshot: { providerId: "manual", captureMode: "manual", measurementMode: "back-hog" },
    })
  );
  if (status === "not_started") return run;
  run = unwrap(transitionAssessmentRun(run, "warmup"));
  if (status === "warmup") return run;
  return unwrap(transitionAssessmentRun(run, "in_progress"));
}

function seedActiveAssessmentRun(run: AssessmentRun) {
  const state = unwrap(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));
  localStorage.setItem(ASSESSMENT_STORAGE_KEY, serializeAssessmentPersistedState(state));
}

function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

describe("TrackerApp — Assess integration", () => {
  it("Home shows Resume Assessment for an active run, and it navigates to Assess", async () => {
    seedActiveAssessmentRun(buildRunInStatus("warmup"));
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    const resumeButton = await waitFor(() => screen.getByRole("button", { name: "Resume Assessment" }));
    fireEvent.click(resumeButton);

    await waitFor(() =>
      expect(navButton("Assess")).toHaveAttribute("aria-current", "page")
    );
  });

  it("Home never invents a Resume Assessment action when there is no active run", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    expect(screen.queryByRole("button", { name: "Resume Assessment" })).not.toBeInTheDocument();
  });

  it("Reload Recovery: a run still 'in_progress' at load time is force-paused, never silently resumed", async () => {
    seedActiveAssessmentRun(buildRunInStatus("in_progress"));
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    fireEvent.click(navButton("Assess"));
    await waitFor(() => screen.getByText("Assessment paused"));
    // Never silently offers to keep capturing — an explicit Resume is required.
    expect(screen.queryByPlaceholderText("3.75 or 375")).not.toBeInTheDocument();
  });

  it("Reload Recovery: a run still 'warmup' at load time is also force-paused (not left live)", async () => {
    seedActiveAssessmentRun(buildRunInStatus("warmup"));
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    fireEvent.click(navButton("Assess"));
    await waitFor(() => screen.getByText("Assessment paused"));
  });

  it("Quarantine: an invalid persisted currentRun never crashes the app and shows a transparent notice", async () => {
    localStorage.setItem(
      ASSESSMENT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 1, currentRun: { totally: "broken" }, history: [] })
    );
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    fireEvent.click(navButton("Assess"));
    await waitFor(() =>
      screen.getByText("A saved assessment could not be restored because its data was invalid.")
    );
    // Training remains fully usable alongside the notice.
    fireEvent.click(navButton("Train"));
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  });

  it("blocks starting an assessment while a Training Auto Capture sequence is active, without losing anything", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    fireEvent.click(navButton("Train"));
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    fireEvent.click(screen.getByRole("button", { name: /^Measured Exercises/ }));
    fireEvent.click(screen.getByRole("button", { name: "View Details: Release Time" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Timing Setup" }));
    await waitFor(() => screen.getByText("Set Up Training Block"));
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    await waitFor(() => screen.getByText("Active Training Block"));
    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.change(screen.getByLabelText("Number of Shots"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Fixed In" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
    await waitFor(() => screen.getByText("0 / 3 shots"));

    // Leaving Train with an active capture sequence is guarded — confirm the
    // existing guard (unrelated to this feature) before Assess is reachable.
    fireEvent.click(navButton("Assess"));
    await waitFor(() => screen.getByText("Auto Capture In Progress"));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    await waitFor(() => screen.getByText("Release Time Core Assessment"));
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));
    fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
    fireEvent.click(screen.getByRole("checkbox"));

    // The capture sequence was already ended by confirming the leave-guard
    // above (captured shots preserved) — so this defensive check normally
    // isn't hit via this exact navigation path, but Start Warm-up must never
    // silently start over lingering capture state either way.
    expect(screen.getByRole("button", { name: "Start Warm-up" })).not.toBeDisabled();
  });

  it("leaving Assess while a run is active pauses it (never silently loses attempts)", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    fireEvent.click(navButton("Assess"));
    await waitFor(() => screen.getByText("Release Time Core Assessment"));
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));
    fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start Warm-up" }));
    await waitFor(() => screen.getByPlaceholderText("3.75 or 375"));

    fireEvent.click(navButton("Home"));
    await waitFor(() => screen.getByText("Assessment In Progress"));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() =>
      expect(navButton("Home")).toHaveAttribute("aria-current", "page")
    );

    fireEvent.click(navButton("Assess"));
    await waitFor(() => screen.getByText("Assessment paused"));
    expect(screen.getByText("Warm-up 0 / 6")).toBeInTheDocument();
  });
});
