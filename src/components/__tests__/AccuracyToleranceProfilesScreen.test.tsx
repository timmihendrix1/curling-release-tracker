// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccuracyToleranceProfilesScreen from "../AccuracyToleranceProfilesScreen";
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

function renderScreen(overrides: Partial<Parameters<typeof AccuracyToleranceProfilesScreen>[0]> = {}) {
  const props = {
    profiles: [eliteProfile],
    defaultProfileId: null,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onSetDefault: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<AccuracyToleranceProfilesScreen {...props} />);
  return props;
}

describe("AccuracyToleranceProfilesScreen", () => {
  it("shows an empty state when there are no saved profiles", () => {
    renderScreen({ profiles: [] });
    expect(screen.getByText(/No profiles saved yet/)).toBeInTheDocument();
  });

  it("lists a profile's name and values, with no Default badge when it isn't the default", () => {
    renderScreen();
    expect(screen.getByText("Elite")).toBeInTheDocument();
    expect(screen.getByText("On Target ±0.05s · Acceptable ±0.10s")).toBeInTheDocument();
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
  });

  it("shows a Default badge and 'Remove Default' when a profile is the default", () => {
    renderScreen({ defaultProfileId: "elite" });
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Default" })
    ).toBeInTheDocument();
  });

  it("creating a profile via the form calls onCreate with the entered values", () => {
    const props = renderScreen({ profiles: [] });

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    fireEvent.change(screen.getByLabelText("Profile Name"), {
      target: { value: "Elite" },
    });
    fireEvent.change(screen.getByLabelText("On Target (±s)"), {
      target: { value: "0.05" },
    });
    fireEvent.change(screen.getByLabelText("Acceptable (±s)"), {
      target: { value: "0.10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

    expect(props.onCreate).toHaveBeenCalledWith({
      name: "Elite",
      onTarget: 0.05,
      acceptable: 0.1,
    });
  });

  it("editing a profile prefills the form and calls onUpdate with the profile's id", () => {
    const props = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Profile Name")).toHaveValue("Elite");

    fireEvent.change(screen.getByLabelText("Acceptable (±s)"), {
      target: { value: "0.12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(props.onUpdate).toHaveBeenCalledWith("elite", {
      name: "Elite",
      onTarget: 0.05,
      acceptable: 0.12,
    });
  });

  it("duplicating a profile calls onDuplicate with its id", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(props.onDuplicate).toHaveBeenCalledWith("elite");
  });

  it("deleting a profile requires confirmation before calling onDelete", () => {
    const props = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete Profile?")).toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Profile" }));
    expect(props.onDelete).toHaveBeenCalledWith("elite");
  });

  it("cancelling the delete confirmation never calls onDelete", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("setting a profile as default calls onSetDefault with its id", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Set as Default" }));
    expect(props.onSetDefault).toHaveBeenCalledWith("elite");
  });

  it("removing the default calls onSetDefault(null)", () => {
    const props = renderScreen({ defaultProfileId: "elite" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Default" }));
    expect(props.onSetDefault).toHaveBeenCalledWith(null);
  });

  it("closing the screen calls onClose", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Close Accuracy Tolerances" }));
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });
});
