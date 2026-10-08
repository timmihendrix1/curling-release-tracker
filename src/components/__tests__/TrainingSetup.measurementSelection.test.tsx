// @vitest-environment jsdom
//
// Stage B setup: choosing what a Fixed Weight exercise measures, and what that choice
// does — and does not — put into the submitted configuration.
//
// The persistent risk this guards is a SILENT DOWNGRADE: a Speed or Both setup that
// quietly submits ordinary time-only training, or a speed-only setup that carries a
// fabricated timing interval and 3.75s target it never measured. Both would be
// invisible afterwards, because the result is a perfectly valid time-only block.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup, { type TrainingSetupValue } from "../TrainingSetup";
import { createTrainingBlock } from "../../lib/trainingBlocks";

afterEach(cleanup);

function renderSetup(onSubmit = vi.fn()) {
  render(<TrainingSetup submitLabel="Start Training" onSubmit={onSubmit} />);
  return onSubmit;
}

function submitted(onSubmit: ReturnType<typeof vi.fn>): TrainingSetupValue {
  expect(onSubmit).toHaveBeenCalled();
  return onSubmit.mock.calls[0][0] as TrainingSetupValue;
}

function choose(label: string) {
  fireEvent.click(screen.getByRole("radio", { name: label }));
}

describe("the measurement selection is offered only where it applies", () => {
  it("defaults a new Fixed Weight setup to today's time behaviour", () => {
    const onSubmit = renderSetup();
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    const value = submitted(onSubmit);
    expect(value.measurementMode).toBe("back-hog");
    expect(value.targetTime).toBe(3.75);
    // Nothing new is written onto an ordinary time-only configuration, which is what
    // keeps its stored bytes and cloud payload identical to before this feature.
    expect("measurement" in value).toBe(false);
  });

  it.each([
    ["Variable Weight"],
    ["Blind Weight"],
  ])("is not offered for %s, which measures time", (mode) => {
    renderSetup();
    expect(screen.getByRole("radiogroup", { name: "Measures" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: mode }));
    expect(screen.queryByRole("radiogroup", { name: "Measures" })).toBeNull();
  });
});

describe("Speed", () => {
  it("requires a target speed and will not start without one", () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onSubmit = renderSetup();

    choose("Speed (m/s)");
    // Deliberately left blank: there is no default target speed to invent.
    expect(screen.getByLabelText("Target Speed (m/s)")).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith(
      "Please enter a target speed in metres per second."
    );
  });

  it("hides the time target and the timing interval, and persists neither", () => {
    const onSubmit = renderSetup();

    choose("Speed (m/s)");
    expect(screen.queryByLabelText(/Target Time/)).toBeNull();
    expect(screen.queryByText("Measurement Mode")).toBeNull();

    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    const value = submitted(onSubmit);
    expect(value.measurement).toEqual({
      quantities: ["speed"],
      speed: {
        target: 2.4,
        tolerance: {
          onTarget: { lower: 0.05, upper: 0.05 },
          acceptable: { lower: 0.1, upper: 0.1 },
        },
      },
    });
    // A speed-only exercise measures no time at all.
    expect("measurementMode" in value).toBe(false);
    expect("targetTime" in value).toBe(false);
  });

  it("never falls back to time training when the speed target is unusable", () => {
    vi.spyOn(window, "alert").mockImplementation(() => {});
    const onSubmit = renderSetup();

    choose("Speed (m/s)");
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    // Starting an executable Back-Hog / 3.75s time block here would be the exact
    // silent downgrade this guards: the athlete asked to train speed.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not carry the typed speed digits over to the time target when switched back", () => {
    const onSubmit = renderSetup();

    choose("Speed (m/s)");
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.40" },
    });
    choose("Time");

    // 2.40 m/s is not 2.40s. The time target keeps its own value.
    expect(screen.getByLabelText("Target Time (s)")).toHaveValue("3.75");

    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    const value = submitted(onSubmit);
    expect(value.targetTime).toBe(3.75);
    expect("measurement" in value).toBe(false);
  });
});

describe("Both", () => {
  it("requires independent targets and shows the timing interval only for time", () => {
    const onSubmit = renderSetup();

    choose("Both");
    expect(screen.getByLabelText("Target Time (s)")).toBeInTheDocument();
    expect(screen.getByLabelText("Target Speed (m/s)")).toBeInTheDocument();
    // The interval qualifies the TIME measurement, and there is exactly one of it.
    expect(screen.getAllByText("Measurement Mode")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Target Time (s)"), {
      target: { value: "3.90" },
    });
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.35" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    const value = submitted(onSubmit);
    expect(value.measurementMode).toBe("back-hog");
    expect(value.targetTime).toBe(3.9);
    expect(value.measurement?.quantities).toEqual(["time", "speed"]);
    expect(value.measurement?.time?.target).toBe(3.9);
    expect(value.measurement?.speed?.target).toBe(2.35);
  });

  it("keeps the two tolerances independent and unit-correct", () => {
    const onSubmit = renderSetup();

    choose("Both");
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));

    // Two editors, each labelled in its own unit.
    fireEvent.change(screen.getByLabelText("On Target (±s)"), {
      target: { value: "0.08" },
    });
    fireEvent.change(screen.getByLabelText("Acceptable (±s)"), {
      target: { value: "0.16" },
    });
    fireEvent.change(screen.getByLabelText("On Target (±m/s)"), {
      target: { value: "0.03" },
    });
    fireEvent.change(screen.getByLabelText("Acceptable (±m/s)"), {
      target: { value: "0.07" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    const value = submitted(onSubmit);
    expect(value.measurement?.time?.tolerance).toEqual({
      onTarget: { lower: 0.08, upper: 0.08 },
      acceptable: { lower: 0.16, upper: 0.16 },
    });
    expect(value.measurement?.speed?.tolerance).toEqual({
      onTarget: { lower: 0.03, upper: 0.03 },
      acceptable: { lower: 0.07, upper: 0.07 },
    });
  });

  it("supports an asymmetric band per quantity and validates each side", () => {
    const onSubmit = renderSetup();

    choose("Both");
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));

    const toggles = screen.getAllByLabelText(
      "Use separate tolerances below and above the target"
    );
    fireEvent.click(toggles[1]); // the speed editor

    fireEvent.change(screen.getByLabelText("On Target below target (m/s)"), {
      target: { value: "0.03" },
    });
    fireEvent.change(screen.getByLabelText("On Target above target (m/s)"), {
      target: { value: "0.08" },
    });
    fireEvent.change(screen.getByLabelText("Acceptable below target (m/s)"), {
      target: { value: "0.02" },
    });

    // Acceptable must EXCEED On Target on each side independently.
    expect(
      screen.getByText("Acceptable must be greater than On Target on both sides.")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Acceptable below target (m/s)"), {
      target: { value: "0.06" },
    });
    fireEvent.change(screen.getByLabelText("Acceptable above target (m/s)"), {
      target: { value: "0.14" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    expect(submitted(onSubmit).measurement?.speed?.tolerance).toEqual({
      onTarget: { lower: 0.03, upper: 0.08 },
      acceptable: { lower: 0.06, upper: 0.14 },
    });
  });
});

describe("every submitted configuration is one the domain will actually create", () => {
  it.each([
    ["Time", () => {}],
    [
      "Speed (m/s)",
      () =>
        fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
          target: { value: "2.40" },
        }),
    ],
    [
      "Both",
      () =>
        fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
          target: { value: "2.40" },
        }),
    ],
  ])("builds a real TrainingBlock from the %s selection", (label, fill) => {
    const onSubmit = renderSetup();
    choose(label);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));

    // The real constructor, with its own strict validation — a form value that it
    // would reject is a form value the app could never start training from.
    const block = createTrainingBlock(submitted(onSubmit));
    expect(block.id).toBeTruthy();
  });
});
