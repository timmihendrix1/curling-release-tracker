// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByText("12 stones · Alternating, starting Out")).toBeInTheDocument();

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
});
