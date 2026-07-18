// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SmartRandomProfilesScreen from "../SmartRandomProfilesScreen";
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

function renderScreen(
  overrides: Partial<Parameters<typeof SmartRandomProfilesScreen>[0]> = {}
) {
  const props = {
    profiles: [fullRangeProfile],
    defaultProfileId: null,
    onCreate: vi.fn(),
    onUpdate: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onSetDefault: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<SmartRandomProfilesScreen {...props} />);
  return props;
}

describe("SmartRandomProfilesScreen", () => {
  it("shows an empty state when there are no saved profiles", () => {
    renderScreen({ profiles: [] });
    expect(screen.getByText(/No profiles saved yet/)).toBeInTheDocument();
  });

  it("lists a profile's name, range and Measurement Mode, with no Default badge when it isn't the default", () => {
    renderScreen();
    expect(screen.getByText("Full Weight Range")).toBeInTheDocument();
    expect(screen.getByText("2.50s–4.50s · Backline – Hog")).toBeInTheDocument();
    expect(screen.queryByText("Default")).not.toBeInTheDocument();
  });

  it("shows a Default badge and 'Remove Default' when a profile is the default", () => {
    renderScreen({ defaultProfileId: "full" });
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Default" })
    ).toBeInTheDocument();
  });

  it("creating a profile via the form calls onCreate with the entered values", () => {
    const props = renderScreen({ profiles: [] });

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    fireEvent.change(screen.getByLabelText("Profile Name"), {
      target: { value: "Draw Focus" },
    });
    fireEvent.change(screen.getByLabelText("Minimum Target Time"), {
      target: { value: "3.30" },
    });
    fireEvent.change(screen.getByLabelText("Maximum Target Time"), {
      target: { value: "4.20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

    expect(props.onCreate).toHaveBeenCalledWith({
      name: "Draw Focus",
      min: 3.3,
      max: 4.2,
    });
  });

  it("editing a profile prefills the form and calls onUpdate with the profile's id", () => {
    const props = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Profile Name")).toHaveValue("Full Weight Range");

    fireEvent.change(screen.getByLabelText("Maximum Target Time"), {
      target: { value: "4.00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

    expect(props.onUpdate).toHaveBeenCalledWith("full", {
      name: "Full Weight Range",
      min: 2.5,
      max: 4.0,
    });
  });

  it("duplicating a profile calls onDuplicate with its id", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    expect(props.onDuplicate).toHaveBeenCalledWith("full");
  });

  it("deleting a profile requires confirmation before calling onDelete", () => {
    const props = renderScreen();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete Profile?")).toBeInTheDocument();
    expect(props.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete Profile" }));
    expect(props.onDelete).toHaveBeenCalledWith("full");
  });

  it("setting a profile as default calls onSetDefault with its id", () => {
    const props = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Set as Default" }));
    expect(props.onSetDefault).toHaveBeenCalledWith("full");
  });

  it("removing the default calls onSetDefault(null)", () => {
    const props = renderScreen({ defaultProfileId: "full" });
    fireEvent.click(screen.getByRole("button", { name: "Remove Default" }));
    expect(props.onSetDefault).toHaveBeenCalledWith(null);
  });

  it("closing the screen calls onClose", () => {
    const props = renderScreen();
    fireEvent.click(
      screen.getByRole("button", { name: "Close Smart Random Profiles" })
    );
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid range in the form and never calls onCreate", () => {
    const props = renderScreen({ profiles: [] });

    fireEvent.click(screen.getByRole("button", { name: "New Profile" }));
    fireEvent.change(screen.getByLabelText("Profile Name"), {
      target: { value: "Too Narrow" },
    });
    fireEvent.change(screen.getByLabelText("Minimum Target Time"), {
      target: { value: "3.50" },
    });
    fireEvent.change(screen.getByLabelText("Maximum Target Time"), {
      target: { value: "3.55" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Profile" }));

    expect(props.onCreate).not.toHaveBeenCalled();
    expect(screen.getByText(/must be at least/)).toBeInTheDocument();
  });
});
