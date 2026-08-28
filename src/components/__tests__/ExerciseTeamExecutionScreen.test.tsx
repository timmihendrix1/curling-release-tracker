// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import {
  EIGHT_GUARDS_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  ROTATION_COUNT_VERSION_ID,
} from "../../lib/exercises/content";
import type { ExerciseExecution } from "../../lib/exercises/executionTypes";
import { findExerciseVersion, resolveMeasurementProtocols } from "../../lib/exercises/lookup";
import { createTeamExerciseExecution } from "../../lib/exercises/teamExecution";
import type { TeamExerciseEligibilitySnapshot } from "../../lib/cloudSporting/syncStateRepository";
import ExerciseTeamExecutionScreen from "../ExerciseTeamExecutionScreen";

const RECORDER = "10000000-0000-4000-8000-000000000001";
const ATHLETE_A = "20000000-0000-4000-8000-000000000002";
const ATHLETE_B = "30000000-0000-4000-8000-000000000003";
const TEAM = "40000000-0000-4000-8000-000000000004";
const SESSION = "50000000-0000-4000-8000-000000000005";

afterEach(cleanup);

function snapshot(): TeamExerciseEligibilitySnapshot {
  return {
    teamId: TEAM,
    teamName: "Elite Team",
    cachedAt: "2026-08-28T10:00:00.000Z",
    participants: [
      { profileId: RECORDER, displayName: "Coach Record", participationAsPlayer: false, functions: ["coach"], recordingPermissionGranted: false },
      { profileId: ATHLETE_A, displayName: "Athlete A", participationAsPlayer: true, functions: [], recordingPermissionGranted: true },
      { profileId: ATHLETE_B, displayName: "Athlete B", participationAsPlayer: true, functions: [], recordingPermissionGranted: true },
    ],
  };
}

function execution(versionId = EIGHT_GUARDS_VERSION_ID): ExerciseExecution {
  const version = findExerciseVersion(EXERCISE_CATALOG, versionId);
  if (!version) throw new Error("missing Exercise fixture");
  let id = 10;
  let second = 0;
  const created = createTeamExerciseExecution(version, {
    trainingSessionId: SESSION,
    teamId: TEAM,
    recorderProfileId: RECORDER,
    participantRoster: [
      { profileId: RECORDER, participation: "supporting" },
      { profileId: ATHLETE_A, participation: "training-athlete" },
      { profileId: ATHLETE_B, participation: "training-athlete" },
    ],
    initialRoleAssignment: {
      deliveringAthleteProfileId: ATHLETE_A,
      sweeperProfileIds: [ATHLETE_B],
      observerProfileId: RECORDER,
      sweepingUsed: true,
    },
    rotation: { kind: "after-every-stone", athleteOrder: [ATHLETE_A, ATHLETE_B] },
    enabledMeasurementProtocols: resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      version.compatibleMeasurementProtocols
    ).map(({ protocol }) => protocol),
    clock: {
      id: () => `60000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
      now: () => `2026-08-27T10:00:${String(second++).padStart(2, "0")}.000Z`,
    },
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value;
}

function Harness({ initial, onComplete = vi.fn(async () => true) }: {
  initial: ExerciseExecution;
  onComplete?: (execution: ExerciseExecution) => Promise<boolean>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ExerciseTeamExecutionScreen
      execution={value}
      eligibilitySnapshot={snapshot()}
      onSave={async (next) => { setValue(next); return true; }}
      onComplete={onComplete}
      onDiscard={vi.fn(async () => true)}
    />
  );
}

describe("ExerciseTeamExecutionScreen", () => {
  it("records athlete attribution, 0-4 outcome and half rotations, then applies planned rotation", async () => {
    render(<Harness initial={execution()} />);

    expect(screen.getByText("Athlete A · Stone 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Inhandle" }));
    fireEvent.change(screen.getByLabelText(/Rotation Count/), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "4 points, 100 percent" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Stone" }));

    expect(await screen.findByText(/2.5 rotations/)).toBeInTheDocument();
    expect(screen.getByText(/100% average · 4\/4 points/)).toBeInTheDocument();
    expect(screen.getByText(/Planned rotation: Athlete B delivers next/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Apply Planned Rotation" }));
    await waitFor(() => expect(screen.getByText("Athlete B · Stone 1")).toBeInTheDocument());
    expect(screen.getByText("Athlete A", { selector: "dd" })).toBeInTheDocument();
  });

  it("keeps Technique Team execution observation-only", () => {
    render(<Harness initial={execution(RELEASE_POINT_VERSION_ID)} />);

    expect(screen.getByText("Observe and discuss")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /points/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Complete Team Exercise" })).toBeEnabled();
  });

  it("records standalone Team Measurements for the active athlete and counter", async () => {
    render(<Harness initial={execution(ROTATION_COUNT_VERSION_ID)} />);

    expect(screen.getByText("Athlete A · Observation 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete Team Exercise" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Rotation Count"), {
      target: { value: "3.5" },
    });
    fireEvent.change(screen.getByLabelText("Counted by"), {
      target: { value: RECORDER },
    });
    fireEvent.click(screen.getByRole("button", { name: "Outhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));

    expect(await screen.findAllByText(/3.5 rotations/)).toHaveLength(2);
    expect(screen.getByText(/1 recorded · mean 3.5 rotations/)).toBeInTheDocument();
    expect(screen.getByText(/Observation 1 · Athlete A/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete Team Exercise" })).toBeEnabled();
  });

  it("corrects an earlier stone across athlete, outcome and role context without a typed reason", async () => {
    render(<Harness initial={execution()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "2 points, 50 percent" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Stone" }));
    await screen.findByText(/50% average/);

    fireEvent.click(screen.getByRole("button", { name: "Correct Stone" }));
    expect(screen.getByText(/previous and resulting values/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Delivering athlete"), { target: { value: ATHLETE_B } });
    fireEvent.click(screen.getAllByRole("button", { name: "Outhandle" }).at(-1)!);
    fireEvent.change(screen.getByLabelText("Score"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Correction" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Correct recorded stone" })).not.toBeInTheDocument());
    expect(screen.getByText(/No scored stones/)).toBeInTheDocument();
    expect(screen.getByText(/100% average · 4\/4 points/)).toBeInTheDocument();
    expect(screen.getByText(/Stone 1 · Athlete B/)).toBeInTheDocument();
    expect(screen.getByText(/1 Sweeper · Sweeping used/)).toBeInTheDocument();
  });

  it("annuls a mistakenly recorded stone only after confirmation and removes it from live calculations", async () => {
    render(<Harness initial={execution()} />);
    fireEvent.click(screen.getByRole("button", { name: "Inhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "3 points, 75 percent" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Stone" }));
    await screen.findByText(/75% average/);

    fireEvent.click(screen.getByRole("button", { name: "Recorded by Mistake" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("stop counting");
    fireEvent.click(screen.getByRole("button", { name: "Annul Recorded Stone" }));
    await waitFor(() => expect(screen.queryByText(/Stone 1 · Athlete A/)).not.toBeInTheDocument());
    expect(screen.getAllByText(/No scored stones/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Complete Team Exercise" })).toBeDisabled();
  });

  it("passes an exact terminal completion to the atomic persistence boundary", async () => {
    const onComplete = vi.fn<(execution: ExerciseExecution) => Promise<boolean>>(async () => true);
    render(<Harness initial={execution(RELEASE_POINT_VERSION_ID)} onComplete={onComplete} />);

    fireEvent.click(screen.getByRole("button", { name: "Complete Team Exercise" }));
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
    expect(onComplete.mock.calls[0][0]).toMatchObject({
      id: expect.any(String),
      trainingSessionId: SESSION,
      status: "completed",
      completedAt: expect.any(String),
    });
  });

  it("requires explicit confirmation before discarding the local draft", () => {
    render(<Harness initial={execution(RELEASE_POINT_VERSION_ID)} />);

    fireEvent.click(screen.getByRole("button", { name: "Discard Local Draft" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("cannot be recovered");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
