// @vitest-environment jsdom
//
// Stage B replaced the Standard/Tight/Custom preset row and its nested profile
// picker with one compact tolerance summary plus a single Adjust action, whose editor
// offers the app's built-in values and the athlete's saved templates in ONE list (see
// docs/FIXED_WEIGHT_SPEED_AND_CAPTURE_SPECIFICATION.md, "Simplified user experience").
// The behaviour these tests protect is unchanged: a default template seeds a brand-new
// configuration, applying a template copies its NUMBERS (never a live reference), an
// already-configured block is never overridden, and the submitted value is always the
// resolved pair.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as baseRender, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup from "../TrainingSetup";
import type { AccuracyToleranceProfile } from "../../lib/accuracyToleranceProfiles/persistence";

afterEach(cleanup);

function render(...args: Parameters<typeof baseRender>) {
  const result = baseRender(...args);
  const change = screen.queryByRole("button", { name: "Change" });
  if (change) fireEvent.click(change);
  return result;
}


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

const myStandardProfile: AccuracyToleranceProfile = {
  id: "my-standard",
  name: "My Standard",
  quantity: "time" as const,
  tolerance: {
    onTarget: { lower: 0.12, upper: 0.12 },
    acceptable: { lower: 0.24, upper: 0.24 },
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function openToleranceEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
}

describe("TrainingSetup — Accuracy Tolerance Profiles", () => {
  it("shows the resolved tolerance in the compact summary without opening the editor", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);

    expect(
      screen.getByText(/On Target ±0.10s · Acceptable ±0.20s/)
    ).toBeInTheDocument();
    // The editor is a disclosure, not a permanently expanded panel.
    expect(screen.queryByLabelText("On Target (±s)")).not.toBeInTheDocument();
  });

  it("seeds a brand-new configuration from the default profile", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    expect(
      screen.getByText(/On Target ±0.05s · Acceptable ±0.10s/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracyThresholds: { onTarget: 0.05, acceptable: 0.1 },
      })
    );
  });

  it("applying another saved template copies its numeric values into the submitted configuration", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        accuracyToleranceProfiles={[eliteProfile, myStandardProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    openToleranceEditor();
    fireEvent.change(screen.getByLabelText("Start from a saved value"), {
      target: { value: myStandardProfile.id },
    });

    expect(screen.getByLabelText("On Target (±s)")).toHaveValue("0.12");
    expect(screen.getByLabelText("Acceptable (±s)")).toHaveValue("0.24");

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracyThresholds: { onTarget: 0.12, acceptable: 0.24 },
      })
    );
  });

  it("still allows a one-off value typed over an applied template", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    openToleranceEditor();
    fireEvent.change(screen.getByLabelText("On Target (±s)"), {
      target: { value: "0.15" },
    });
    fireEvent.change(screen.getByLabelText("Acceptable (±s)"), {
      target: { value: "0.30" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracyThresholds: { onTarget: 0.15, acceptable: 0.3 },
      })
    );
  });

  it("offers the built-in Standard and Tight values in the same list, with no templates saved", () => {
    const onSubmit = vi.fn();
    render(<TrainingSetup submitLabel="Start Block" onSubmit={onSubmit} />);

    openToleranceEditor();
    fireEvent.change(screen.getByLabelText("Start from a saved value"), {
      target: { value: "built-in:tight" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracyThresholds: { onTarget: 0.05, acceptable: 0.1 },
      })
    );
  });

  it("an invalid tolerance blocks submission and reopens the editor that explains why", () => {
    const onSubmit = vi.fn();
    render(<TrainingSetup submitLabel="Start Block" onSubmit={onSubmit} />);

    openToleranceEditor();
    fireEvent.change(screen.getByLabelText("On Target (±s)"), {
      target: { value: "0.30" },
    });
    fireEvent.change(screen.getByLabelText("Acceptable (±s)"), {
      target: { value: "0.10" },
    });

    expect(
      screen.getByText(/Acceptable must be greater than On Target/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("editing an existing block's stored thresholds is never overridden by a default profile", () => {
    render(
      <TrainingSetup
        submitLabel="Save"
        onSubmit={vi.fn()}
        initialValue={{ accuracyThresholds: { onTarget: 0.2, acceptable: 0.4 } }}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    openToleranceEditor();
    expect(screen.getByLabelText("On Target (±s)")).toHaveValue("0.20");
    expect(screen.getByLabelText("Acceptable (±s)")).toHaveValue("0.40");
  });
});
