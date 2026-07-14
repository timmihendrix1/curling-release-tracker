// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

// This project's vitest.config.ts doesn't enable global test APIs, so
// Testing Library's automatic per-test cleanup (which relies on detecting a
// global `afterEach`) never registers itself — do it explicitly instead.
afterEach(cleanup);
import type { HistoryAnalysisFilters } from "../../lib/historyAnalysis";
import { createDefaultHistoryFilters } from "../../lib/historyAnalysis";
import type { Session } from "../../types";
import HistoryFilterBar from "../HistoryFilterBar";

function baseFilters(): HistoryAnalysisFilters {
  return { ...createDefaultHistoryFilters(), dateRange: { preset: "all" } };
}

function Harness({
  initial,
  onFiltersChange,
}: {
  initial?: HistoryAnalysisFilters;
  onFiltersChange?: (filters: HistoryAnalysisFilters) => void;
}) {
  const [filters, setFilters] = useState<HistoryAnalysisFilters>(
    initial ?? baseFilters()
  );

  return (
    <HistoryFilterBar
      filters={filters}
      onChange={(next) => {
        setFilters(next);
        onFiltersChange?.(next);
      }}
      availableTrainingCategories={["fixed"]}
      availableMeasurementModes={["back-hog"]}
      sessions={[] as Session[]}
    />
  );
}

function selectThresholdMode(value: string) {
  fireEvent.change(screen.getByLabelText("Threshold Comparison Mode"), {
    target: { value },
  });
}

describe("HistoryFilterBar — Compare: Custom", () => {
  it("shows no Custom fields when Original is active (regression guard for the fixed bug)", () => {
    render(<Harness />);
    expect(
      screen.queryByLabelText("Custom On Target threshold")
    ).not.toBeInTheDocument();
  });

  it("reveals On Target / Acceptable input fields the moment Custom is selected", () => {
    render(<Harness />);
    selectThresholdMode("custom");

    expect(
      screen.getByLabelText("Custom On Target threshold")
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Custom Acceptable threshold")
    ).toBeInTheDocument();
  });

  it("seeds sensible starting values when switching from Standard to Custom", () => {
    render(<Harness />);
    selectThresholdMode("standard");
    selectThresholdMode("custom");

    expect(screen.getByLabelText("Custom On Target threshold")).toHaveValue(
      0.1
    );
    expect(screen.getByLabelText("Custom Acceptable threshold")).toHaveValue(
      0.2
    );
  });

  it("seeds sensible starting values when switching from Tight to Custom", () => {
    render(<Harness />);
    selectThresholdMode("tight");
    selectThresholdMode("custom");

    expect(screen.getByLabelText("Custom On Target threshold")).toHaveValue(
      0.05
    );
    expect(screen.getByLabelText("Custom Acceptable threshold")).toHaveValue(
      0.1
    );
  });

  it("keeps Original selectable and does not require Custom values to switch back", () => {
    render(<Harness />);
    selectThresholdMode("custom");
    selectThresholdMode("original");

    expect(
      screen.getByLabelText<HTMLSelectElement>("Threshold Comparison Mode")
    ).toHaveValue("original");
    expect(
      screen.queryByLabelText("Custom On Target threshold")
    ).not.toBeInTheDocument();
  });

  it("disables Apply and shows a field-level error when acceptable <= onTarget", () => {
    render(<Harness />);
    selectThresholdMode("custom");
    fireEvent.change(screen.getByLabelText("Custom On Target threshold"), {
      target: { value: "0.2" },
    });
    fireEvent.change(screen.getByLabelText("Custom Acceptable threshold"), {
      target: { value: "0.1" },
    });

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    expect(
      screen.getByText("Acceptable must be greater than On Target.")
    ).toBeInTheDocument();
  });

  it.each([
    ["0", "0.2"],
    ["-0.1", "0.2"],
    ["abc", "0.2"],
    ["Infinity", "0.2"],
  ])("disables Apply for an invalid On Target value %s", (onTarget) => {
    render(<Harness />);
    selectThresholdMode("custom");
    fireEvent.change(screen.getByLabelText("Custom On Target threshold"), {
      target: { value: onTarget },
    });

    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("applies valid Custom values and never mutates Scatterplot-relevant data (thresholdComparisonMode only)", () => {
    let latest: HistoryAnalysisFilters | undefined;
    render(<Harness onFiltersChange={(filters) => (latest = filters)} />);

    selectThresholdMode("custom");
    fireEvent.change(screen.getByLabelText("Custom On Target threshold"), {
      target: { value: "0.07" },
    });
    fireEvent.change(screen.getByLabelText("Custom Acceptable threshold"), {
      target: { value: "0.15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(latest?.thresholdComparisonMode).toEqual({
      type: "comparison",
      thresholds: { onTarget: 0.07, acceptable: 0.15 },
    });
  });

  it("retains a valid, unapplied Custom entry across Custom → Original → Custom", () => {
    render(<Harness />);
    selectThresholdMode("custom");
    fireEvent.change(screen.getByLabelText("Custom On Target threshold"), {
      target: { value: "0.09" },
    });
    fireEvent.change(screen.getByLabelText("Custom Acceptable threshold"), {
      target: { value: "0.22" },
    });

    selectThresholdMode("original");
    selectThresholdMode("custom");

    expect(screen.getByLabelText("Custom On Target threshold")).toHaveValue(
      0.09
    );
    expect(screen.getByLabelText("Custom Acceptable threshold")).toHaveValue(
      0.22
    );
  });

  it("Reset restores the clearly-defined Standard default", () => {
    render(<Harness />);
    selectThresholdMode("custom");
    fireEvent.change(screen.getByLabelText("Custom On Target threshold"), {
      target: { value: "0.33" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    expect(screen.getByLabelText("Custom On Target threshold")).toHaveValue(
      0.1
    );
    expect(screen.getByLabelText("Custom Acceptable threshold")).toHaveValue(
      0.2
    );
  });

  it("restores a previously-applied valid Custom state on reload (filters passed in already-applied)", () => {
    render(
      <Harness
        initial={{
          ...baseFilters(),
          thresholdComparisonMode: {
            type: "comparison",
            thresholds: { onTarget: 0.08, acceptable: 0.18 },
          },
        }}
      />
    );

    expect(
      screen.getByLabelText<HTMLSelectElement>("Threshold Comparison Mode")
    ).toHaveValue("custom");
    expect(screen.getByLabelText("Custom On Target threshold")).toHaveValue(
      0.08
    );
    expect(screen.getByLabelText("Custom Acceptable threshold")).toHaveValue(
      0.18
    );
  });
});
