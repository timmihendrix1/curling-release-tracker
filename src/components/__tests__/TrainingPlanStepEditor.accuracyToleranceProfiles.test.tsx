// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingPlanStepEditor from "../TrainingPlanStepEditor";
import type { AccuracyToleranceProfile } from "../../lib/accuracyToleranceProfiles/persistence";

afterEach(cleanup);

const eliteProfile: AccuracyToleranceProfile = {
  id: "elite",
  name: "Elite",
  onTarget: 0.05,
  acceptable: 0.1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("TrainingPlanStepEditor — Accuracy Tolerance Profiles", () => {
  it("passes saved profiles through to the embedded TrainingSetup, reachable under Custom", () => {
    render(
      <TrainingPlanStepEditor
        onSave={vi.fn()}
        onCancel={vi.fn()}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("Accuracy Tolerance Profile")).toBeInTheDocument();
    expect(screen.getByText(/Elite: On Target ±0.05s/)).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(
      screen.queryByLabelText("Accuracy Tolerance Profile")
    ).not.toBeInTheDocument();
  });
});
