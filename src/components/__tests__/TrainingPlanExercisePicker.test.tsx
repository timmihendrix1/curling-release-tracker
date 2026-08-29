// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import type { ExerciseAssetResolver } from "../../lib/exercises/exerciseAssets";
import { listCurrentExerciseVersions } from "../../lib/exercises/lookup";
import TrainingPlanExercisePicker from "../TrainingPlanExercisePicker";

afterEach(cleanup);

const versions = listCurrentExerciseVersions(EXERCISE_CATALOG);
const resolver: ExerciseAssetResolver = {
  resolveExerciseAsset: () => ({ src: "data:image/png;base64,AA==" }),
};

describe("TrainingPlanExercisePicker", () => {
  it("starts with the three product categories and reveals descriptive Exercise cards", () => {
    render(
      <TrainingPlanExercisePicker
        versions={versions}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /Technique/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Shotmaking/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Measured Exercises/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Release Point" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Shotmaking/ }));
    const card = screen.getByRole("heading", {
      name: "Eight Guards, Progressively Longer",
    }).closest("section");
    if (!card) throw new Error("Missing Eight Guards card");
    expect(within(card).getByText(/Play eight guards in front of the house/))
      .toBeInTheDocument();
    expect(within(card).getByText("Guard")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "View Setup" }))
      .toBeInTheDocument();
  });

  it("previews setup and diagram inline, then selects the exact immutable Exercise Version", async () => {
    const onChoose = vi.fn();
    render(
      <TrainingPlanExercisePicker
        versions={versions}
        onChoose={onChoose}
        onCancel={vi.fn()}
        exerciseAssetResolver={resolver}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Shotmaking/ }));
    const card = screen.getByRole("heading", {
      name: "Eight Guards, Progressively Longer",
    }).closest("section");
    if (!card) throw new Error("Missing Eight Guards card");

    fireEvent.click(within(card).getByRole("button", { name: "View Setup" }));
    expect(within(card).getByText("Exercise diagram")).toBeInTheDocument();
    expect(await within(card).findByRole("img")).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Select Exercise" }));

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0]).toMatchObject({
      id: "eight-guards-progressively-longer-v5",
      version: 5,
    });
  });

  it("searches across categories without requiring the athlete to know the exact title", () => {
    render(
      <TrainingPlanExercisePicker
        versions={versions}
        onChoose={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), {
      target: { value: "rotation" },
    });
    expect(screen.getByRole("heading", { name: "Rotation Count" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Release Point" })).toBeNull();
    expect(screen.getByText("Matching Exercises")).toBeInTheDocument();
  });
});
