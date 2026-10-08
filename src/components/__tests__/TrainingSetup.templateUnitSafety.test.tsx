// @vitest-environment jsdom
//
// Unit safety across the setup and template surfaces.
//
// The rule is constant across stages: a tolerance's numbers are never reinterpreted
// into the other unit, and never half-shown. What CHANGED in Stage B is the remedy.
// Stage A could only protect a speed or asymmetric template by refusing to show or
// save it, because its editor had one seconds field per band. Stage B's per-side
// editor can represent every shape this app stores, so the same templates are now
// fully editable — while the thing that actually guards correctness, a template's
// quantity, remains immutable once saved.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup from "../TrainingSetup";
import AccuracyToleranceProfileForm from "../AccuracyToleranceProfileForm";
import type { AccuracyToleranceProfile } from "../../lib/accuracyToleranceProfiles/persistence";

afterEach(cleanup);

const NOW = "2026-10-06T10:00:00.000Z";

const speedTemplate: AccuracyToleranceProfile = {
  id: "speed",
  name: "Speed default",
  quantity: "speed",
  tolerance: {
    onTarget: { lower: 0.05, upper: 0.05 },
    acceptable: { lower: 0.1, upper: 0.1 },
  },
  createdAt: NOW,
  updatedAt: NOW,
};

const asymmetricTimeTemplate: AccuracyToleranceProfile = {
  id: "asymmetric",
  name: "Asymmetric",
  quantity: "time",
  tolerance: {
    onTarget: { lower: 0.05, upper: 0.12 },
    acceptable: { lower: 0.1, upper: 0.2 },
  },
  createdAt: NOW,
  updatedAt: NOW,
};

describe("setup defaults respect unit compatibility", () => {
  it("never seeds the seconds fields from an incompatible speed default", () => {
    // 0.05 m/s must never become "0.05s". The time tolerance keeps the app's own
    // standard seconds values; the speed default seeds the SPEED fields instead.
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        onSubmit={onSubmit}
        submitLabel="Start Block"
        accuracyToleranceProfiles={[speedTemplate]}
        defaultAccuracyToleranceProfileId="speed"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    expect(screen.getByLabelText("On Target (±s)")).toHaveValue("0.10");
    expect(screen.getByLabelText("Acceptable (±s)")).toHaveValue("0.20");

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    const [submitted] = onSubmit.mock.calls[0];
    expect(submitted.accuracyThresholds).toEqual({ onTarget: 0.1, acceptable: 0.2 });
    // Ordinary symmetric time-only training stays in its legacy representation: the
    // key is genuinely absent, not present-and-undefined.
    expect("measurement" in submitted).toBe(false);
  });

  it("seeds an asymmetric time default per side, and persists it as a measurement configuration", () => {
    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        onSubmit={onSubmit}
        submitLabel="Start Block"
        accuracyToleranceProfiles={[asymmetricTimeTemplate]}
        defaultAccuracyToleranceProfileId="asymmetric"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    expect(screen.getByLabelText("On Target below target (s)")).toHaveValue("0.05");
    expect(screen.getByLabelText("On Target above target (s)")).toHaveValue("0.12");

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));

    const [value] = onSubmit.mock.calls[0];
    // An asymmetric tolerance cannot be expressed by the legacy symmetric pair, so it
    // is carried in the measurement configuration, which is authoritative.
    expect(value.measurement).toEqual({
      quantities: ["time"],
      time: {
        target: 3.75,
        tolerance: asymmetricTimeTemplate.tolerance,
      },
    });
  });

  it("still seeds from a compatible symmetric time default without a measurement configuration", () => {
    const timeTemplate: AccuracyToleranceProfile = {
      ...asymmetricTimeTemplate,
      id: "tight",
      name: "Tight",
      tolerance: {
        onTarget: { lower: 0.05, upper: 0.05 },
        acceptable: { lower: 0.1, upper: 0.1 },
      },
    };

    const onSubmit = vi.fn();
    render(
      <TrainingSetup
        onSubmit={onSubmit}
        submitLabel="Start Block"
        accuracyToleranceProfiles={[timeTemplate]}
        defaultAccuracyToleranceProfileId="tight"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));

    const [value] = onSubmit.mock.calls[0];
    expect(value.accuracyThresholds).toEqual({ onTarget: 0.05, acceptable: 0.1 });
    expect(value.measurement).toBeUndefined();
  });

  it("offers no asymmetric option where it could not be stored (Variable Weight)", () => {
    render(<TrainingSetup onSubmit={vi.fn()} submitLabel="Start Block" />);

    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    expect(
      screen.getByLabelText("Use separate tolerances below and above the target")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));

    // Variable Weight keeps its legacy time-only representation, which has nowhere to
    // store a per-side tolerance — so the option is withheld rather than flattened.
    expect(
      screen.queryByLabelText("Use separate tolerances below and above the target")
    ).not.toBeInTheDocument();
  });
});

describe("the profile editor now represents every stored template shape", () => {
  it("edits a speed template in its own unit, keeping the quantity immutable", () => {
    const onSave = vi.fn();
    render(
      <AccuracyToleranceProfileForm
        initialProfile={speedTemplate}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    // No quantity control at all while editing: the unit cannot be changed here.
    expect(screen.queryByRole("radiogroup", { name: "Measurement" })).toBeNull();
    expect(screen.getByLabelText("On Target (±m/s)")).toHaveValue("0.05");

    fireEvent.change(screen.getByLabelText("Acceptable (±m/s)"), {
      target: { value: "0.12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Speed default",
      quantity: "speed",
      tolerance: {
        onTarget: { lower: 0.05, upper: 0.05 },
        acceptable: { lower: 0.12, upper: 0.12 },
      },
    });
  });

  it("edits an asymmetric template per side, never collapsing it to one value", () => {
    const onSave = vi.fn();
    render(
      <AccuracyToleranceProfileForm
        initialProfile={asymmetricTimeTemplate}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    expect(screen.getByLabelText("On Target below target (s)")).toHaveValue("0.05");
    expect(screen.getByLabelText("On Target above target (s)")).toHaveValue("0.12");

    fireEvent.change(screen.getByLabelText("Acceptable above target (s)"), {
      target: { value: "0.25" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Asymmetric",
      quantity: "time",
      tolerance: {
        onTarget: { lower: 0.05, upper: 0.12 },
        acceptable: { lower: 0.1, upper: 0.25 },
      },
    });
  });

  it("switching quantity on a NEW template resets the values rather than reusing the digits", () => {
    const onSave = vi.fn();
    render(<AccuracyToleranceProfileForm onSave={onSave} onCancel={() => {}} />);

    fireEvent.change(screen.getByLabelText("On Target (±s)"), {
      target: { value: "0.33" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Speed (m/s)" }));

    // 0.33 seconds is not 0.33 m/s. The speed defaults are used instead.
    expect(screen.getByLabelText("On Target (±m/s)")).toHaveValue("0.05");
    expect(screen.getByLabelText("Acceptable (±m/s)")).toHaveValue("0.10");
  });

  it("still edits a symmetric time template, keeping its unit explicit", () => {
    const timeTemplate: AccuracyToleranceProfile = {
      ...asymmetricTimeTemplate,
      id: "tight",
      name: "Tight",
      tolerance: {
        onTarget: { lower: 0.05, upper: 0.05 },
        acceptable: { lower: 0.1, upper: 0.1 },
      },
    };

    const onSave = vi.fn();
    render(
      <AccuracyToleranceProfileForm
        initialProfile={timeTemplate}
        onSave={onSave}
        onCancel={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText("Acceptable (±s)"), {
      target: { value: "0.12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(onSave).toHaveBeenCalledWith({
      name: "Tight",
      quantity: "time",
      tolerance: {
        onTarget: { lower: 0.05, upper: 0.05 },
        acceptable: { lower: 0.12, upper: 0.12 },
      },
    });
  });
});
