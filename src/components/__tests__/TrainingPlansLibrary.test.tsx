// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TrainingPlan } from "../../types";
import TrainingPlansLibrary from "../TrainingPlansLibrary";

afterEach(cleanup);

function buildPlan(overrides: Partial<TrainingPlan> = {}): TrainingPlan {
  return {
    id: "plan-1",
    name: "Release Consistency",
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
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
          variableTargetMode: "smart-random",
          blindTargetMode: "fixed",
          smartRandomMin: 2.5,
          smartRandomMax: 4.5,
          accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        },
      },
      {
        id: "step-2",
        type: "release-timing",
        completion: { type: "shot-count", value: 16 },
        handleStrategy: { type: "free" },
        configuration: {
          name: "",
          mode: "variable",
          measurementMode: "back-hog",
          targetTime: 3.75,
          variableTargetMode: "smart-random",
          blindTargetMode: "fixed",
          smartRandomMin: 2.5,
          smartRandomMax: 4.5,
          accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        },
      },
    ],
    ...overrides,
  };
}

describe("TrainingPlansLibrary", () => {
  it("shows the empty state with a Create Training Plan action", () => {
    const onCreateNew = vi.fn();
    render(
      <TrainingPlansLibrary
        plans={[]}
        onCreateNew={onCreateNew}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(screen.getByText("No training plans yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create Training Plan" }));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it("summarizes step count, total stones and mode composition", () => {
    render(
      <TrainingPlansLibrary
        plans={[buildPlan()]}
        onCreateNew={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(screen.getByText("2 steps · 24 stones")).toBeInTheDocument();
    expect(screen.getByText("Fixed · Variable")).toBeInTheDocument();
  });

  it("disables Start and shows a warning for an unexecutable plan", () => {
    const invalidPlan = buildPlan({
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
    });

    render(
      <TrainingPlansLibrary
        plans={[invalidPlan]}
        onCreateNew={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByText(/isn't valid yet/)).toBeInTheDocument();
  });

  it("confirms before deleting a plan", () => {
    const onDelete = vi.fn();
    render(
      <TrainingPlansLibrary
        plans={[buildPlan()]}
        onCreateNew={vi.fn()}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onDelete={onDelete}
        onStart={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete Training Plan?")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Plan" }));
    expect(onDelete).toHaveBeenCalledWith("plan-1");
  });

  it("calls onStart/onEdit/onDuplicate directly, without confirmation", () => {
    const onStart = vi.fn();
    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const plan = buildPlan();

    render(
      <TrainingPlansLibrary
        plans={[plan]}
        onCreateNew={vi.fn()}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={vi.fn()}
        onStart={onStart}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(onStart).toHaveBeenCalledWith(plan);
    expect(onEdit).toHaveBeenCalledWith(plan);
    expect(onDuplicate).toHaveBeenCalledWith(plan);
  });
});
