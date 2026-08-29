// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID } from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import ExerciseSoloSetupScreen from "../ExerciseSoloSetupScreen";

afterEach(cleanup);

describe("ExerciseSoloSetupScreen", () => {
  const version = findExerciseVersion(
    EXERCISE_CATALOG,
    EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID
  )!;

  it("shows the physical setup before offering one explicit confirmation", () => {
    const onConfirm = vi.fn();
    render(
      <ExerciseSoloSetupScreen
        version={version}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByRole("heading", { name: version.title })).toBeInTheDocument();
    expect(screen.getByText("Set up")).toBeInTheDocument();
    expect(screen.getByText("Equipment")).toBeInTheDocument();
    expect(screen.getByText("How to perform it")).toBeInTheDocument();
    expect(screen.getByTestId("exercise-restricted-diagram-unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /points/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Setup Complete — Start Exercise" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled without confirming, and disables confirmation when persistence is unavailable", () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <ExerciseSoloSetupScreen
        version={version}
        disabled
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );

    expect(screen.getByRole("button", { name: "Setup Complete — Start Exercise" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "← Back to Exercise Library" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
