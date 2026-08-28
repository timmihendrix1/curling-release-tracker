// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EIGHT_GUARDS_VERSION_ID,
  ROTATION_COUNT_VERSION_ID,
} from "../../lib/exercises/content";
import { createSoloExerciseExecution } from "../../lib/exercises/execution";
import {
  createTechniqueExecution,
  FIXTURE_ATHLETE_ID,
  FIXTURE_SESSION_ID,
} from "../../lib/exercises/__tests__/executionFixtures";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import type { ExerciseExecution } from "../../lib/exercises/executionTypes";
import { findExerciseVersion, resolveMeasurementProtocols } from "../../lib/exercises/lookup";
import ExerciseSoloExecutionScreen from "../ExerciseSoloExecutionScreen";

afterEach(cleanup);

function createShotmakingExecution(): ExerciseExecution {
  const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
  if (!version) throw new Error("Missing Shotmaking fixture");
  const outcome = createSoloExerciseExecution(version, {
    trainingSessionId: FIXTURE_SESSION_ID,
    athleteProfileId: FIXTURE_ATHLETE_ID,
    enabledMeasurementProtocols: resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      version.compatibleMeasurementProtocols
    ).map(({ protocol }) => protocol),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

function createMeasuredExecution(): ExerciseExecution {
  const version = findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID);
  if (!version) throw new Error("Missing Measured fixture");
  const outcome = createSoloExerciseExecution(version, {
    trainingSessionId: FIXTURE_SESSION_ID,
    athleteProfileId: FIXTURE_ATHLETE_ID,
    enabledMeasurementProtocols: resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      version.compatibleMeasurementProtocols
    ).map(({ protocol }) => protocol),
  });
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
}

function Harness({ initial, writable = true }: { initial: ExerciseExecution; writable?: boolean }) {
  const [execution, setExecution] = useState(initial);
  return (
    <ExerciseSoloExecutionScreen
      execution={execution}
      writable={writable}
      onReplace={(next) => {
        setExecution(next);
        return true;
      }}
      onBackToLibrary={vi.fn()}
      onStartNewSession={vi.fn()}
    />
  );
}

describe("ExerciseSoloExecutionScreen", () => {
  it("runs a Technique Exercise as observation and private note only", () => {
    render(<Harness initial={createTechniqueExecution()} />);

    expect(screen.getByText("Observe and discuss")).toBeInTheDocument();
    expect(screen.getByText(/awards no score/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /points/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Private athlete note"), {
      target: { value: "Release stayed close to the reference." },
    });
    expect(screen.getByLabelText("Private athlete note")).toHaveValue(
      "Release stayed close to the reference."
    );

    fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));
    expect(screen.getByText("Completed without a score. Technique exercises remain observation-only."))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to Exercise Library" })).toBeInTheDocument();
  });

  it("records scored and excluded Shotmaking stones with factual live and final results", () => {
    render(<Harness initial={createShotmakingExecution()} />);

    expect(screen.getByText("Setup")).toBeInTheDocument();
    expect(screen.getByTestId("exercise-structured-diagram")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Inhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "3 points, 75 percent" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Stone" }));

    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByText("1 scored · 0 excluded")).toBeInTheDocument();
    expect(screen.getByText(/Inhandle: 75% · 1 scored/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Inhandle" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    fireEvent.click(screen.getByRole("button", { name: "Outhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "Do not score this stone" }));
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "other" },
    });
    expect(screen.getByRole("button", { name: "Record Excluded Stone" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Explanation"), {
      target: { value: "Stone from another sheet crossed the path." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record Excluded Stone" }));

    expect(screen.getByText("1 scored · 1 excluded")).toBeInTheDocument();
    expect(screen.getByText("Other: 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));
    const result = screen.getByRole("heading", { name: "Exercise result" }).closest("section");
    expect(result).not.toBeNull();
    expect(within(result as HTMLElement).getByText("3/4")).toBeInTheDocument();
  });

  it("records optional Rotation Count in whole or half rotations", () => {
    render(<Harness initial={createShotmakingExecution()} />);

    fireEvent.click(screen.getByRole("button", { name: "Inhandle" }));
    fireEvent.change(screen.getByLabelText(/Rotation Count/), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "4 points, 100 percent" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Stone" }));

    expect(screen.getByText(/2.5 rotations/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Outhandle" }));
    fireEvent.change(screen.getByLabelText(/Rotation Count/), { target: { value: "2.25" } });
    fireEvent.click(screen.getByRole("button", { name: "3 points, 75 percent" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Stone" }));

    expect(screen.getByRole("alert")).toHaveTextContent("whole or half rotation");
  });

  it("runs a standalone Measured Exercise without a score or target", () => {
    render(<Harness initial={createMeasuredExecution()} />);

    expect(screen.queryByRole("button", { name: /points/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Complete Exercise" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Rotation Count/), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Inhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "Record Measurement" }));

    expect(screen.getAllByText(/2.5 rotations/)).toHaveLength(2);
    expect(screen.getByText(/Factual values only/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete Exercise" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));
    expect(screen.getByRole("heading", { name: "Exercise result" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /points/ })).toBeNull();
  });

  it("disables every persisted mutation while the Session domain is not writable", () => {
    render(<Harness initial={createShotmakingExecution()} writable={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Inhandle" }));
    fireEvent.click(screen.getByRole("button", { name: "4 points, 100 percent" }));
    expect(screen.getByRole("button", { name: "Record Stone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Complete Exercise" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Abandon Exercise" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start New Session" })).toBeDisabled();
    expect(screen.getByLabelText("Private athlete note")).toBeDisabled();
  });
});
