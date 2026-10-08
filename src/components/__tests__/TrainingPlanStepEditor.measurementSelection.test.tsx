// @vitest-environment jsdom
//
// A Fixed Weight plan step must keep what it measures, across saving, reopening and
// execution.
//
// Before Stage B the editor dropped the measurement configuration in BOTH directions:
// `handleSubmit` never wrote it, and `initialSetupValue` never read it back. The
// failure was silent and total — a Speed step saved as ordinary time training, and
// reopening a Speed step showed Time. Nothing downstream could detect it, because the
// result was a perfectly valid time-only step.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingPlanStepEditor from "../TrainingPlanStepEditor";
import { mapPlanStepToTrainingBlockInput } from "../../lib/trainingPlans/mapping";
import { createTrainingBlock } from "../../lib/trainingBlocks";
import { isReleaseTimingPlanStep } from "../../lib/trainingPlans/steps";
import type { ReleaseTimingPlanStep, TrainingPlanStep } from "../../types";

afterEach(cleanup);

function selectReleaseTime() {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), {
    target: { value: "Release Time" },
  });
  const card = screen.getByRole("heading", { name: "Release Time" }).closest("section");
  if (!card) throw new Error("Missing Release Time picker card");
  fireEvent.click(within(card).getByRole("button", { name: "Select Exercise" }));
}

function savedStep(onSave: ReturnType<typeof vi.fn>): ReleaseTimingPlanStep {
  expect(onSave).toHaveBeenCalled();
  const step = onSave.mock.calls[0][0] as TrainingPlanStep;
  if (!isReleaseTimingPlanStep(step)) throw new Error("expected a Release Time step");
  return step;
}

function createSpeedStep(): ReleaseTimingPlanStep {
  const onSave = vi.fn();
  render(<TrainingPlanStepEditor onSave={onSave} onCancel={vi.fn()} />);
  selectReleaseTime();

  fireEvent.click(screen.getByRole("radio", { name: "Speed (m/s)" }));
  fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
    target: { value: "2.40" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add Step" }));

  const step = savedStep(onSave);
  cleanup();
  return step;
}

describe("a Fixed Weight plan step keeps what it measures", () => {
  it("saves a Speed step with its target and without fabricated time fields", () => {
    const step = createSpeedStep();

    expect(step.configuration.measurement).toEqual({
      quantities: ["speed"],
      speed: {
        target: 2.4,
        tolerance: {
          onTarget: { lower: 0.05, upper: 0.05 },
          acceptable: { lower: 0.1, upper: 0.1 },
        },
      },
    });
    // A step that measures no time carries no timing interval and no time target —
    // not even as an explicit `undefined` key.
    expect("measurementMode" in step.configuration).toBe(false);
    expect("targetTime" in step.configuration).toBe(false);
  });

  it("saves a Both step with two independent targets", () => {
    const onSave = vi.fn();
    render(<TrainingPlanStepEditor onSave={onSave} onCancel={vi.fn()} />);
    selectReleaseTime();

    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    fireEvent.change(screen.getByLabelText("Target Time (s)"), {
      target: { value: "3.90" },
    });
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.35" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));

    const step = savedStep(onSave);
    expect(step.configuration.measurement?.quantities).toEqual(["time", "speed"]);
    expect(step.configuration.measurement?.time?.target).toBe(3.9);
    expect(step.configuration.measurement?.speed?.target).toBe(2.35);
    expect(step.configuration.measurementMode).toBe("back-hog");
    expect(step.configuration.targetTime).toBe(3.9);
  });

  it("reopens a saved Speed step as Speed, not as Time", () => {
    const step = createSpeedStep();

    render(
      <TrainingPlanStepEditor initialStep={step} onSave={vi.fn()} onCancel={vi.fn()} />
    );

    expect(screen.getByRole("radio", { name: "Speed (m/s)" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(screen.getByLabelText("Target Speed (m/s)")).toHaveValue("2.40");
    expect(screen.queryByLabelText(/Target Time/)).toBeNull();
  });

  it("saves a reopened Speed step unchanged when nothing is edited", () => {
    const step = createSpeedStep();
    const onSave = vi.fn();

    render(
      <TrainingPlanStepEditor initialStep={step} onSave={onSave} onCancel={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Save Step" }));

    const resaved = savedStep(onSave);
    expect(resaved.configuration.measurement).toEqual(
      step.configuration.measurement
    );
    expect(resaved.id).toBe(step.id);
  });

  it("executes as the block it was configured as", () => {
    const step = createSpeedStep();

    // The real mapping and the real constructor — this is the path a plan actually
    // takes when its step is materialised into a Training Block.
    const block = createTrainingBlock(mapPlanStepToTrainingBlockInput(step));

    expect(block.measurement?.quantities).toEqual(["speed"]);
    expect(block.measurement?.speed?.target).toBe(2.4);
    expect(block.measurementMode).toBeUndefined();
    expect(block.targetTime).toBeUndefined();
  });
});
