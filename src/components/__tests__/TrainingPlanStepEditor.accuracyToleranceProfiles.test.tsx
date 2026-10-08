// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingPlanStepEditor from "../TrainingPlanStepEditor";
import type { AccuracyToleranceProfile } from "../../lib/accuracyToleranceProfiles/persistence";

afterEach(cleanup);

const eliteProfile: AccuracyToleranceProfile = {
  id: "elite",
  name: "Elite",
  quantity: "time" as const,
  tolerance: {
    onTarget: { lower: 0.05, upper: 0.05 },
    acceptable: { lower: 0.1, upper: 0.1 },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function selectReleaseTime() {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search exercises" }), {
    target: { value: "Release Time" },
  });
  const card = screen.getByRole("heading", { name: "Release Time" }).closest("section");
  if (!card) throw new Error("Missing Release Time picker card");
  fireEvent.click(within(card).getByRole("button", { name: "Select Exercise" }));
}

describe("TrainingPlanStepEditor — Accuracy Tolerance Profiles", () => {
  it("passes saved templates through to the embedded TrainingSetup's tolerance editor", () => {
    render(
      <TrainingPlanStepEditor
        onSave={vi.fn()}
        onCancel={vi.fn()}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    selectReleaseTime();
    // The default template seeds the step without the editor having to be opened.
    expect(
      screen.getByText(/On Target ±0.05s · Acceptable ±0.10s/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    expect(
      within(screen.getByLabelText("Start from a saved value")).getByRole("option", {
        name: /Elite/,
      })
    ).toBeInTheDocument();
  });

  it("stores the resolved numeric values (not a profile id) in the saved step configuration", () => {
    const onSave = vi.fn();
    render(
      <TrainingPlanStepEditor
        onSave={onSave}
        onCancel={vi.fn()}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    selectReleaseTime();
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          accuracyThresholds: { onTarget: 0.05, acceptable: 0.1 },
        }),
      })
    );
  });

  it("works with no profiles passed at all (default props)", () => {
    render(<TrainingPlanStepEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    selectReleaseTime();
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));

    // Only the app's own built-in starting values are offered.
    const list = screen.getByLabelText("Start from a saved value");
    expect(within(list).getByRole("option", { name: /Standard/ })).toBeInTheDocument();
    expect(within(list).getByRole("option", { name: /Tight/ })).toBeInTheDocument();
  });
});
