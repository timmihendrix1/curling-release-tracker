// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingPlanStepEditor from "../TrainingPlanStepEditor";
import type { SmartRandomProfile } from "../../lib/smartRandomProfiles/persistence";

afterEach(cleanup);

const fullRangeProfile: SmartRandomProfile = {
  id: "full",
  name: "Full Weight Range",
  measurementMode: "back-hog",
  min: 2.5,
  max: 4.5,
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

describe("TrainingPlanStepEditor — Smart Random Profiles", () => {
  it("passes saved profiles through to the embedded TrainingSetup, reachable for Variable Weight", () => {
    render(
      <TrainingPlanStepEditor
        onSave={vi.fn()}
        onCancel={vi.fn()}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );

    selectReleaseTime();
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    expect(screen.getByLabelText("Smart Random Profile")).toBeInTheDocument();
    expect(
      screen.getByText("Full Weight Range: 2.50s–4.50s")
    ).toBeInTheDocument();
  });

  it("stores the resolved numeric range (not a profile id) in the saved step configuration", () => {
    const onSave = vi.fn();
    render(
      <TrainingPlanStepEditor
        onSave={onSave}
        onCancel={vi.fn()}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );

    selectReleaseTime();
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Step" }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        configuration: expect.objectContaining({
          smartRandomMin: 2.5,
          smartRandomMax: 4.5,
        }),
      })
    );
  });

  it("works with no profiles passed at all (default props)", () => {
    render(<TrainingPlanStepEditor onSave={vi.fn()} onCancel={vi.fn()} />);
    selectReleaseTime();
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    expect(
      screen.queryByLabelText("Smart Random Profile")
    ).not.toBeInTheDocument();
  });
});
