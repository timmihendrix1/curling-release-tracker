// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { EIGHT_GUARDS_V1_VERSION_ID } from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import type { TrainingPlan } from "../../types";
import TrainingPlanEditor from "../TrainingPlanEditor";

afterEach(cleanup);

describe("TrainingPlanEditor", () => {
  it("rejects saving an unnamed, stepless plan", () => {
    const onSave = vi.fn();
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

    render(<TrainingPlanEditor onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save Training Plan" }));

    expect(alertSpy).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it("creates a plan with one step, then saves it with the configured completion/handle strategy", () => {
    const onSave = vi.fn();
    render(<TrainingPlanEditor onSave={onSave} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("e.g. Release Consistency"), {
      target: { value: "Release Consistency" },
    });

    // Opens the Add Step modal (the editor's own "Add Step" button is the only
    // one in the DOM until the modal mounts).
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));
    fireEvent.click(screen.getByRole("button", { name: "Release Time Measurement" }));

    const stonesInput = screen.getByLabelText("Number of Stones");
    fireEvent.change(stonesInput, { target: { value: "12" } });

    fireEvent.click(screen.getByRole("button", { name: "Alternating" }));
    // Rendered lowercase ("out Handle"), styled capitalized via CSS only.
    fireEvent.click(screen.getByRole("button", { name: "out Handle" }));

    // Two "Add Step" buttons now exist (the editor's own, plus the modal's
    // TrainingSetup submit button) — the modal's is the second in DOM order.
    const addStepButtons = screen.getAllByRole("button", { name: "Add Step" });
    fireEvent.click(addStepButtons[addStepButtons.length - 1]);

    // Back on the editor screen, the step summary reflects what was configured.
    expect(screen.getByText(/12 stones · Alternating, starting Out/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save Training Plan" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedPlan = onSave.mock.calls[0][0];
    expect(savedPlan.name).toBe("Release Consistency");
    expect(savedPlan.steps).toHaveLength(1);
    expect(savedPlan.steps[0].completion).toEqual({ type: "shot-count", value: 12 });
    expect(savedPlan.steps[0].handleStrategy).toEqual({
      type: "alternating",
      startingHandle: "out",
    });
  });

  it("adds a curated Exercise step without asking for planned volume", () => {
    const onSave = vi.fn();
    render(<TrainingPlanEditor onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("e.g. Release Consistency"), {
      target: { value: "Technique then stones" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Technique, Shotmaking or Measured Exercise" })
    );
    expect(screen.queryByLabelText("Number of Stones")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Exercise"), {
      target: { value: "release-point-v1" },
    });
    const addButtons = screen.getAllByRole("button", { name: "Add Step" });
    fireEvent.click(addButtons[addButtons.length - 1]);
    expect(screen.getByText("Release Point")).toBeInTheDocument();
    expect(screen.getByText("Technique · Complete manually")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Training Plan" }));

    const saved = onSave.mock.calls[0][0];
    expect(saved.schemaVersion).toBe(2);
    expect(saved.steps[0]).toMatchObject({
      type: "curated-exercise",
      completion: { type: "exercise-completion" },
      exerciseVersionSnapshot: { id: "release-point-v1", version: 1 },
    });
  });

  it("keeps a saved older Exercise Version selectable when a newer catalog Version is current", () => {
    const olderVersion = findExerciseVersion(
      EXERCISE_CATALOG,
      EIGHT_GUARDS_V1_VERSION_ID
    );
    if (!olderVersion) throw new Error("Missing older Exercise Version fixture");
    const initialPlan: TrainingPlan = {
      id: "older-version-plan",
      name: "Saved version",
      steps: [{
        id: "older-version-step",
        type: "curated-exercise",
        exerciseVersionSnapshot: JSON.parse(JSON.stringify(olderVersion)),
        completion: { type: "exercise-completion" },
      }],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      schemaVersion: 2,
    };

    render(
      <TrainingPlanEditor
        initialPlan={initialPlan}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const selector = screen.getByLabelText("Exercise") as HTMLSelectElement;
    expect(selector.value).toBe(EIGHT_GUARDS_V1_VERSION_ID);
    expect(
      screen.getByRole("option", {
        name: "Eight Guards, Progressively Longer — Shotmaking · Exercise version 1",
      })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", {
        name: "Eight Guards, Progressively Longer — Shotmaking · Exercise version 3",
      })
    ).toBeInTheDocument();
  });
});
