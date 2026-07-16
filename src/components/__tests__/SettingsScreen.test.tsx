// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SettingsScreen from "../SettingsScreen";

afterEach(cleanup);

describe("SettingsScreen", () => {
  it("is reachable and shows Data Management and Data & Privacy", () => {
    render(
      <SettingsScreen
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
});
