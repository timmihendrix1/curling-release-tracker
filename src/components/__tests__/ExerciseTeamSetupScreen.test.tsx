// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import type { ExerciseExecution } from "../../lib/exercises/executionTypes";
import type { TeamExerciseEligibilitySnapshot } from "../../lib/cloudSporting/syncStateRepository";
import ExerciseTeamSetupScreen from "../ExerciseTeamSetupScreen";

const RECORDER = "10000000-0000-4000-8000-000000000001";
const ATHLETE_A = "20000000-0000-4000-8000-000000000002";
const ATHLETE_B = "30000000-0000-4000-8000-000000000003";
const TEAM = "40000000-0000-4000-8000-000000000004";

afterEach(cleanup);

function version() {
  const value = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
  if (!value) throw new Error("missing Guard fixture");
  return value;
}

function snapshot(): TeamExerciseEligibilitySnapshot {
  return {
    teamId: TEAM,
    teamName: "Elite Team",
    cachedAt: "2026-08-28T10:00:00.000Z",
    participants: [
      { profileId: RECORDER, displayName: "Coach Record", participationAsPlayer: false, functions: ["coach"], recordingPermissionGranted: false },
      { profileId: ATHLETE_A, displayName: "Athlete A", participationAsPlayer: true, functions: [], recordingPermissionGranted: true },
      { profileId: ATHLETE_B, displayName: "Athlete B", participationAsPlayer: true, functions: [], recordingPermissionGranted: false },
    ],
  };
}

describe("ExerciseTeamSetupScreen", () => {
  it("builds a recorder-bound Team draft from present and eligible Profiles", async () => {
    const onStart = vi.fn<(execution: ExerciseExecution) => Promise<boolean>>(async () => true);
    render(
      <ExerciseTeamSetupScreen
        version={version()}
        recorderProfileId={RECORDER}
        eligibilitySnapshots={[snapshot()]}
        onStart={onStart}
        onCancel={vi.fn()}
      />
    );

    const present = screen.getByRole("heading", { name: "Who is present?" }).closest("section")!;
    fireEvent.click(within(present).getByLabelText("Athlete A"));
    fireEvent.click(within(present).getByLabelText("Athlete B"));

    const athletes = screen.getByRole("heading", { name: "Training athletes" }).closest("section")!;
    fireEvent.click(within(athletes).getByLabelText("Athlete A"));
    expect(within(athletes).getByLabelText(/Athlete B/)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Variation/), { target: { value: "same-handle" } });
    fireEvent.click(screen.getByRole("button", { name: "Start Team Exercise" }));

    await waitFor(() => expect(onStart).toHaveBeenCalledOnce());
    const execution = onStart.mock.calls[0][0];
    expect(execution).toMatchObject({
      status: "in-progress",
      trainingSessionId: expect.any(String),
      exerciseVersionSnapshot: { id: EIGHT_GUARDS_VERSION_ID, version: 2 },
      teamContext: {
        teamId: TEAM,
        recorderProfileId: RECORDER,
        participantRoster: [
          { profileId: RECORDER, participation: "supporting" },
          { profileId: ATHLETE_A, participation: "training-athlete" },
          { profileId: ATHLETE_B, participation: "supporting" },
        ],
        rotation: { kind: "manual", athleteOrder: [ATHLETE_A] },
      },
      configuration: {
        selectedVariationId: "same-handle",
        enabledMeasurementProtocols: [{ metricType: "rotation-count" }],
      },
    });
    expect(execution.configuration).not.toHaveProperty("plannedVolume");
    expect(execution.roleAssignmentSegments[0]).toMatchObject({
      deliveringAthleteProfileId: ATHLETE_A,
      recordedByProfileId: RECORDER,
    });
  });

  it("does not guess a Team roster when no recorder-visible snapshot exists", () => {
    const onStart = vi.fn<(execution: ExerciseExecution) => Promise<boolean>>(async () => true);
    render(
      <ExerciseTeamSetupScreen
        version={version()}
        recorderProfileId={RECORDER}
        eligibilitySnapshots={[]}
        onStart={onStart}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: "Team setup unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Team Exercise" })).toBeNull();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("keeps the setup visible and reports a durable-save failure", async () => {
    render(
      <ExerciseTeamSetupScreen
        version={version()}
        recorderProfileId={RECORDER}
        eligibilitySnapshots={[snapshot()]}
        onStart={vi.fn(async () => false)}
        onCancel={vi.fn()}
      />
    );
    const present = screen.getByRole("heading", { name: "Who is present?" }).closest("section")!;
    fireEvent.click(within(present).getByLabelText("Athlete A"));
    const athletes = screen.getByRole("heading", { name: "Training athletes" }).closest("section")!;
    fireEvent.click(within(athletes).getByLabelText("Athlete A"));
    fireEvent.click(screen.getByRole("button", { name: "Start Team Exercise" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No draft was started");
    expect(screen.getByRole("heading", { name: "Initial roles" })).toBeInTheDocument();
  });

  it("clears actual sweeping use when the final Sweeper is removed", () => {
    render(
      <ExerciseTeamSetupScreen
        version={version()}
        recorderProfileId={RECORDER}
        eligibilitySnapshots={[snapshot()]}
        onStart={vi.fn(async () => true)}
        onCancel={vi.fn()}
      />
    );
    const present = screen.getByRole("heading", { name: "Who is present?" }).closest("section")!;
    fireEvent.click(within(present).getByLabelText("Athlete A"));
    fireEvent.click(within(present).getByLabelText("Athlete B"));
    const athletes = screen.getByRole("heading", { name: "Training athletes" }).closest("section")!;
    fireEvent.click(within(athletes).getByLabelText("Athlete A"));

    const roles = screen.getByRole("heading", { name: "Initial roles" }).closest("section")!;
    const sweepers = within(roles).getByRole("group", { name: "Sweepers (0–2)" });
    fireEvent.click(within(sweepers).getByLabelText("Athlete B"));
    const sweeping = within(roles).getByLabelText("Sweeping will be used");
    fireEvent.click(sweeping);
    expect(sweeping).toBeChecked();

    fireEvent.click(within(sweepers).getByLabelText("Athlete B"));
    expect(sweeping).not.toBeChecked();
    expect(sweeping).toBeDisabled();
  });
});
