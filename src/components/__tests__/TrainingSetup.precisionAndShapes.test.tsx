// @vitest-environment jsdom
//
// Reopening a configuration must not change it.
//
// The Stage B review found that editable values were rendered with `toFixed(2)`.
// These strings are reopened, parsed and saved again, so that was not a display
// choice: a target speed of 2.3456 came back as 2.35 and a 0.055 tolerance as 0.06,
// with the athlete changing nothing. A small enough tolerance could even round to
// zero and become invalid.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as baseRender, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup, { type TrainingSetupValue } from "../TrainingSetup";
import TrainingPlanStepEditor from "../TrainingPlanStepEditor";
import AccuracyToleranceProfileForm from "../AccuracyToleranceProfileForm";
import type { AccuracyToleranceProfile } from "../../lib/accuracyToleranceProfiles/persistence";
import { isReleaseTimingPlanStep } from "../../lib/trainingPlans/steps";
import type { TrainingPlanStep } from "../../types";

afterEach(cleanup);

function render(...args: Parameters<typeof baseRender>) {
  const result = baseRender(...args);
  const change = screen.queryByRole("button", { name: "Change" });
  if (change) fireEvent.click(change);
  return result;
}


function selectReleaseTime() {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), {
    target: { value: "Release Time" },
  });
  const card = screen
    .getByRole("heading", { name: "Release Time" })
    .closest("section");
  if (!card) throw new Error("Missing Release Time picker card");
  fireEvent.click(within(card).getByRole("button", { name: "Select Exercise" }));
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
}

const PRECISE_SPEED_TOLERANCE = {
  onTarget: { lower: 0.055, upper: 0.067 },
  acceptable: { lower: 0.123, upper: 0.145 },
};

const preciseSpeedTemplate: AccuracyToleranceProfile = {
  id: "precise",
  name: "Precise",
  quantity: "speed",
  tolerance: PRECISE_SPEED_TOLERANCE,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const asymmetricTimeTemplate: AccuracyToleranceProfile = {
  id: "asym",
  name: "Asymmetric",
  quantity: "time",
  tolerance: {
    onTarget: { lower: 0.05, upper: 0.15 },
    acceptable: { lower: 0.1, upper: 0.3 },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("reopening a configuration preserves its exact values", () => {
  it("keeps a four-decimal target speed through an unchanged save", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        onSubmit={onSubmit}
        submitLabel="Save"
        initialValue={{
          mode: "fixed",
          name: "precise",
          measurement: {
            quantities: ["speed"],
            speed: {
              target: 2.3456,
              tolerance: {
                onTarget: { lower: 0.05, upper: 0.05 },
                acceptable: { lower: 0.1, upper: 0.1 },
              },
            },
          },
        }}
      />
    );

    expect(screen.getByLabelText("Target Speed (m/s)")).toHaveValue("2.3456");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const value = onSubmit.mock.calls[0][0] as TrainingSetupValue;
    expect(value.measurement?.speed?.target).toBe(2.3456);
  });

  it("keeps three-decimal per-side tolerances through an unchanged template save", () => {
    const onSave = vi.fn();
    render(
      <AccuracyToleranceProfileForm
        initialProfile={preciseSpeedTemplate}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    expect(screen.getByLabelText("On Target below target (m/s)")).toHaveValue(
      "0.055"
    );
    expect(screen.getByLabelText("Acceptable above target (m/s)")).toHaveValue(
      "0.145"
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(onSave.mock.calls[0][0].tolerance).toEqual(PRECISE_SPEED_TOLERANCE);
  });

  it("keeps a precise target through a plan step reopen and re-save", () => {
    // Built through the real editor, so the step carries a genuine catalogued
    // Exercise Version rather than a stand-in the runner cannot resolve.
    const created = vi.fn();
    render(<TrainingPlanStepEditor onSave={created} onCancel={vi.fn()} />);
    selectReleaseTime();
    fireEvent.click(screen.getByRole("radio", { name: "Speed (m/s)" }));
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.3456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));

    const step = created.mock.calls[0][0] as TrainingPlanStep;
    if (!isReleaseTimingPlanStep(step)) throw new Error("expected a Release step");
    expect(step.configuration.measurement?.speed?.target).toBe(2.3456);
    cleanup();

    // Reopening and saving unchanged must not move the value.
    const onSave = vi.fn();
    render(
      <TrainingPlanStepEditor
        initialStep={step}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Target Speed (m/s)")).toHaveValue("2.3456");

    fireEvent.click(screen.getByRole("button", { name: "Save Step" }));
    const saved = onSave.mock.calls[0][0] as TrainingPlanStep;
    if (!isReleaseTimingPlanStep(saved)) throw new Error("expected a Release step");
    expect(saved.configuration.measurement?.speed?.target).toBe(2.3456);
  });

  it("keeps a tiny valid target editable, without exponent notation", () => {
    // `String(1e-7)` is "1e-7", which the speed parser rejects — so a perfectly valid
    // small target could be displayed but never saved again unchanged. Editable text
    // must always be something the parser that reads it back accepts.
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        onSubmit={onSubmit}
        submitLabel="Save"
        initialValue={{
          mode: "fixed",
          measurement: {
            quantities: ["speed"],
            speed: {
              target: 0.0000001,
              tolerance: {
                onTarget: { lower: 0.05, upper: 0.05 },
                acceptable: { lower: 0.1, upper: 0.1 },
              },
            },
          },
        }}
      />
    );

    expect(screen.getByLabelText("Target Speed (m/s)")).toHaveValue("0.0000001");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(alertSpy).not.toHaveBeenCalled();
    const value = onSubmit.mock.calls[0][0] as TrainingSetupValue;
    expect(value.measurement?.speed?.target).toBe(0.0000001);
  });

  it("keeps a tiny valid tolerance side editable and saveable", () => {
    const onSave = vi.fn();
    render(
      <AccuracyToleranceProfileForm
        initialProfile={{
          ...preciseSpeedTemplate,
          tolerance: {
            onTarget: { lower: 0.0000001, upper: 0.0000002 },
            acceptable: { lower: 0.0000003, upper: 0.0000004 },
          },
        }}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    expect(screen.getByLabelText("On Target below target (m/s)")).toHaveValue(
      "0.0000001"
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));
    expect(onSave.mock.calls[0][0].tolerance).toEqual({
      onTarget: { lower: 0.0000001, upper: 0.0000002 },
      acceptable: { lower: 0.0000003, upper: 0.0000004 },
    });
  });

  it("still renders an exactly-two-decimal value in its familiar form", () => {
    render(<TrainingSetup onSubmit={vi.fn()} submitLabel="Save" />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    // Nothing that was already precise should start looking different.
    expect(screen.getByLabelText("On Target (±s)")).toHaveValue("0.10");
  });
});

describe("a form is never offered a template shape it cannot store", () => {
  it("withholds an asymmetric time template from Variable Weight", () => {
    render(
      <TrainingSetup
        onSubmit={vi.fn()}
        submitLabel="Start"
        accuracyToleranceProfiles={[asymmetricTimeTemplate]}
      />
    );

    // Fixed Weight can represent it, so it is offered there.
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    expect(
      screen.getByRole("option", { name: /Asymmetric/ })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    // Variable Weight keeps the legacy time-only representation, which has nowhere to
    // store a per-side tolerance — so it is not offered rather than being applied and
    // then silently collapsed onto its lower side when saved.
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    expect(screen.queryByRole("option", { name: /Asymmetric/ })).toBeNull();
  });

  it("does not seed Variable Weight from an asymmetric default template", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        onSubmit={onSubmit}
        submitLabel="Start"
        initialValue={{ mode: "variable" }}
        accuracyToleranceProfiles={[asymmetricTimeTemplate]}
        defaultAccuracyToleranceProfileId="asym"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    const value = onSubmit.mock.calls[0][0] as TrainingSetupValue;

    // Neither side of the asymmetric template leaks in: it is not representable, so
    // the app's own standard values are used and nothing is stored as a half-truth.
    expect(value.accuracyThresholds).toEqual({ onTarget: 0.1, acceptable: 0.2 });
    expect("measurement" in value).toBe(false);
  });

  it("falls back to standard values rather than collapsing an asymmetric draft", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        onSubmit={onSubmit}
        submitLabel="Start"
        accuracyToleranceProfiles={[asymmetricTimeTemplate]}
      />
    );

    // Configure an asymmetric tolerance under Fixed Weight, where it is valid...
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    fireEvent.change(screen.getByLabelText("Start from a saved value"), {
      target: { value: "asym" },
    });
    expect(screen.getByLabelText("On Target below target (s)")).toHaveValue("0.05");

    // ...then switch to a form that cannot store it.
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    const value = onSubmit.mock.calls[0][0] as TrainingSetupValue;
    // 0.05/0.10 would be "the lower side of the template", which is not the tolerance
    // the athlete chose and reads as if it were.
    expect(value.accuracyThresholds).toEqual({ onTarget: 0.1, acceptable: 0.2 });
  });
});
