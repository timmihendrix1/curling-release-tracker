// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsScreen from "../SettingsScreen";

afterEach(cleanup);

const baseProps = {
  accuracyToleranceProfiles: [],
  defaultAccuracyToleranceProfileId: null,
  onManageAccuracyTolerances: () => {},
  smartRandomProfiles: [],
  defaultSmartRandomProfileId: null,
  onManageSmartRandomProfiles: () => {},
  onManageTeams: () => {},
};

describe("SettingsScreen", () => {
  it("is reachable and shows Data Management and Data & Privacy", () => {
    render(
      <SettingsScreen
        {...baseProps}
        hasHistory={false}
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
      />
    );

    expect(screen.getByText("Data Management")).toBeInTheDocument();
    expect(screen.getByText("Data & Privacy")).toBeInTheDocument();
  });

  it("no longer shows the old About section title", () => {
    render(
      <SettingsScreen
        {...baseProps}
        hasHistory={false}
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
      />
    );

    expect(screen.queryByText("About")).not.toBeInTheDocument();
  });

  it("shows the current, honest local-storage disclosure copy", () => {
    render(
      <SettingsScreen
        {...baseProps}
        hasHistory={false}
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
      />
    );

    expect(
      screen.getByText(
        "Your training data is stored locally on this device. No account, cloud sync or server storage is currently used."
      )
    ).toBeInTheDocument();
  });

  it("disables export/clear and explains why when there is no history yet", () => {
    render(
      <SettingsScreen
        {...baseProps}
        hasHistory={false}
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
      />
    );

    expect(screen.getByRole("button", { name: "Export History CSV" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear History" })).toBeDisabled();
    expect(
      screen.getByText("No completed sessions yet — nothing to export or clear.")
    ).toBeInTheDocument();
  });

  it("keeps the destructive Clear History action in its own separated section", () => {
    render(
      <SettingsScreen
        {...baseProps}
        hasHistory
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
      />
    );

    const clearDataHeading = screen.getByRole("heading", { name: "Clear Data" });
    const dataManagementHeading = screen.getByRole("heading", {
      name: "Data Management",
    });
    const clearButton = screen.getByRole("button", { name: "Clear History" });
    const exportButton = screen.getByRole("button", {
      name: "Export History CSV",
    });

    // Different containing sections, not siblings in the same card.
    expect(clearDataHeading.closest("div")).not.toBe(
      dataManagementHeading.closest("div")
    );
    expect(clearButton.closest("div")).not.toBe(exportButton.closest("div"));
  });

  it("calls the export/clear callbacks when history exists", () => {
    const onExportHistoryCsv = vi.fn();
    const onClearHistory = vi.fn();

    render(
      <SettingsScreen
        {...baseProps}
        hasHistory
        onExportHistoryCsv={onExportHistoryCsv}
        onClearHistory={onClearHistory}
      />
    );

    screen.getByRole("button", { name: "Export History CSV" }).click();
    screen.getByRole("button", { name: "Clear History" }).click();

    expect(onExportHistoryCsv).toHaveBeenCalledTimes(1);
    expect(onClearHistory).toHaveBeenCalledTimes(1);
  });

  it("shows the Accuracy Tolerances section with profile count and default", () => {
    const onManageAccuracyTolerances = vi.fn();

    render(
      <SettingsScreen
        hasHistory={false}
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
        accuracyToleranceProfiles={[
          {
            id: "p1",
            name: "Elite",
            onTarget: 0.05,
            acceptable: 0.1,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        defaultAccuracyToleranceProfileId="p1"
        onManageAccuracyTolerances={onManageAccuracyTolerances}
        smartRandomProfiles={[]}
        defaultSmartRandomProfileId={null}
        onManageSmartRandomProfiles={() => {}}
        onManageTeams={() => {}}
      />
    );

    expect(screen.getByText("Accuracy Tolerances")).toBeInTheDocument();
    expect(screen.getByText("1 profile saved · Default: Elite")).toBeInTheDocument();

    screen.getByRole("button", { name: "Manage Accuracy Tolerances" }).click();
    expect(onManageAccuracyTolerances).toHaveBeenCalledTimes(1);
  });

  it("shows the Smart Random Profiles section with profile count and default", () => {
    const onManageSmartRandomProfiles = vi.fn();

    render(
      <SettingsScreen
        {...baseProps}
        hasHistory={false}
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
        smartRandomProfiles={[
          {
            id: "p1",
            name: "Full Weight Range",
            measurementMode: "back-hog",
            min: 2.5,
            max: 4.5,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]}
        defaultSmartRandomProfileId="p1"
        onManageSmartRandomProfiles={onManageSmartRandomProfiles}
      />
    );

    expect(screen.getByText("Smart Random Profiles")).toBeInTheDocument();
    expect(
      screen.getByText("1 profile saved · Default: Full Weight Range")
    ).toBeInTheDocument();

    screen.getByRole("button", { name: "Manage Smart Random Profiles" }).click();
    expect(onManageSmartRandomProfiles).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state when no profiles are saved", () => {
    render(
      <SettingsScreen
        {...baseProps}
        hasHistory={false}
        onExportHistoryCsv={() => {}}
        onClearHistory={() => {}}
      />
    );

    // Both the Accuracy Tolerances and Smart Random Profiles sections show
    // this same empty-state copy when nothing has been saved yet.
    expect(screen.getAllByText("No profiles saved yet.")).toHaveLength(2);
  });
});
