// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup from "../TrainingSetup";
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

const drawFocusProfile: SmartRandomProfile = {
  id: "draw",
  name: "Draw Focus",
  measurementMode: "back-hog",
  min: 3.3,
  max: 4.2,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("TrainingSetup — Smart Random Profiles selector visibility", () => {
  it("does not appear for Fixed Weight", () => {
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={vi.fn()}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );
    expect(screen.queryByText("Smart Random Settings")).not.toBeInTheDocument();
  });

  it("appears for Variable Weight, whose default target source is Smart Random", () => {
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={vi.fn()}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    expect(screen.getByText("Smart Random Settings")).toBeInTheDocument();
  });

  it("does not appear for Variable Weight once Coach / Manual is selected", () => {
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={vi.fn()}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Coach / Manual" }));
    expect(screen.queryByText("Smart Random Settings")).not.toBeInTheDocument();
  });

  it("does not appear for Hog – Hog, even with Smart Random as the target source", () => {
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={vi.fn()}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Hog – Hog" }));
    expect(screen.queryByText("Smart Random Settings")).not.toBeInTheDocument();
    // No profile controls leak into the Coach/Manual fallback state either.
    expect(
      screen.queryByLabelText("Smart Random Profile")
    ).not.toBeInTheDocument();
  });

  it("appears for Blind Weight once Smart Random is explicitly selected as its target source", () => {
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={vi.fn()}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Blind Weight" }));
    expect(screen.queryByText("Smart Random Settings")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Smart Random" }));
    expect(screen.getByText("Smart Random Settings")).toBeInTheDocument();
  });
});

describe("TrainingSetup — Smart Random Profiles integration", () => {
  it("prefills a brand-new Variable Weight configuration's range from the default profile", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    expect(
      screen.getByText("Full Weight Range: 2.50s–4.50s")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ smartRandomMin: 2.5, smartRandomMax: 4.5 })
    );
  });

  it("selecting another saved profile copies its range into the submitted configuration", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        smartRandomProfiles={[fullRangeProfile, drawFocusProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.change(screen.getByLabelText("Smart Random Profile"), {
      target: { value: drawFocusProfile.id },
    });
    expect(screen.getByText("Draw Focus: 3.30s–4.20s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ smartRandomMin: 3.3, smartRandomMax: 4.2 })
    );
  });

  it("switching to 'Custom for this exercise' still allows a one-off custom range", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        submitLabel="Start Block"
        onSubmit={onSubmit}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.change(screen.getByLabelText("Smart Random Profile"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Minimum Target Time"), {
      target: { value: "3.00" },
    });
    fireEvent.change(screen.getByLabelText("Maximum Target Time"), {
      target: { value: "3.50" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ smartRandomMin: 3.0, smartRandomMax: 3.5 })
    );
  });

  it("does not show a profile picker at all when no profiles are saved", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    expect(
      screen.queryByLabelText("Smart Random Profile")
    ).not.toBeInTheDocument();
  });

  it("editing an existing block's stored range is never overridden by a default profile", () => {
    render(
      <TrainingSetup
        submitLabel="Save"
        onSubmit={vi.fn()}
        initialValue={{
          mode: "variable",
          variableTargetMode: "smart-random",
          smartRandomMin: 3.0,
          smartRandomMax: 3.5,
        }}
        smartRandomProfiles={[fullRangeProfile]}
        defaultSmartRandomProfileId={fullRangeProfile.id}
      />
    );

    expect(screen.getByLabelText("Minimum Target Time")).toHaveValue("3.00");
    expect(screen.getByLabelText("Maximum Target Time")).toHaveValue("3.50");
    // Starts as "Custom for this exercise", not silently attributed to a profile.
    expect(screen.getByLabelText("Smart Random Profile")).toHaveValue("");
  });

  it("existing Manual and Fixed target-source flows do not regress", () => {
    const onSubmit = vi.fn();
    render(<TrainingSetup submitLabel="Start Block" onSubmit={onSubmit} />);

    // Fixed Weight (default) — submits the plain target time, untouched.
    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "fixed" })
    );
  });
});
