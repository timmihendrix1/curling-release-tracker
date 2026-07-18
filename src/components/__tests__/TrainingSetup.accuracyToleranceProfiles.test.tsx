// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup from "../TrainingSetup";
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

const myStandardProfile: AccuracyToleranceProfile = {
  id: "my-standard",
  name: "My Standard",
  onTarget: 0.12,
  acceptable: 0.24,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("TrainingSetup — Accuracy Tolerance Profiles", () => {
  it("does not force Custom just because a default profile exists — Standard remains selected", () => {
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={vi.fn()}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    expect(screen.getByRole("button", { name: "Standard" }).className).toContain(
      "bg-slate-900"
    );
  });

  it("prefills a brand-new configuration's Custom values from the default profile", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByText(/Elite: On Target ±0.05s/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracyThresholds: { onTarget: 0.05, acceptable: 0.1 },
      })
    );
  });

  it("selecting another saved profile copies its numeric values into the submitted configuration", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        accuracyToleranceProfiles={[eliteProfile, myStandardProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Accuracy Tolerance Profile"), {
      target: { value: myStandardProfile.id },
    });

    expect(screen.getByText(/My Standard: On Target ±0.12s/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracyThresholds: { onTarget: 0.12, acceptable: 0.24 },
      })
    );
  });

  it("switching to 'Custom for this exercise' still allows a one-off custom value", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        accuracyToleranceProfiles={[eliteProfile]}
        defaultAccuracyToleranceProfileId={eliteProfile.id}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("Accuracy Tolerance Profile"), {
      target: { value: "" },
    });

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

  it("existing Standard/Tight built-in presets still work with no profiles saved", () => {
    const onSubmit = vi.fn();
    render(<TrainingSetup submitLabel="Start Block" onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole("button", { name: "Tight" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        accuracyThresholds: { onTarget: 0.05, acceptable: 0.1 },
      })
    );
  });

  it("does not show a profile picker at all when no profiles are saved", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(
      screen.queryByLabelText("Accuracy Tolerance Profile")
    ).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(screen.getByLabelText("On Target (±s)")).toHaveValue("0.20");
    expect(screen.getByLabelText("Acceptable (±s)")).toHaveValue("0.40");
    // Starts as "Custom for this exercise", not silently attributed to a profile.
    expect(screen.getByLabelText("Accuracy Tolerance Profile")).toHaveValue("");
  });
});
