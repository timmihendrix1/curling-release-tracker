// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup from "../TrainingSetup";

afterEach(cleanup);

describe("TrainingSetup — Training Category / Measurement Mode help", () => {
  it("shows one shared Info button for the Training Mode group, describing the selected option", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);

    // Fixed Weight is selected by default.
    expect(
      screen.getByRole("button", { name: "About Fixed Weight" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Variable Weight" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "About Blind Weight" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));

    expect(
      screen.getByRole("button", { name: "About Variable Weight" })
    ).toBeInTheDocument();
  });

  it("shows one shared Info button for the Measurement Mode group, describing the selected option", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "About Backline – Hog" })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hog – Hog" }));

    expect(
      screen.getByRole("button", { name: "About Hog – Hog" })
    ).toBeInTheDocument();
  });

  it("shows an Info button for Accuracy Thresholds", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "About Accuracy Thresholds" })
    ).toBeInTheDocument();
  });

  it("opening the shared Training Mode Info popover does not change the selection", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);

    // Fixed Weight is selected by default.
    const fixedButton = screen.getByRole("button", { name: "Fixed Weight" });
    expect(fixedButton.className).toContain("bg-slate-900");

    fireEvent.click(screen.getByRole("button", { name: "About Fixed Weight" }));

    expect(screen.getByRole("dialog", { name: "Fixed Weight" })).toBeInTheDocument();
    // Selection must be untouched — clicking the info icon is a sibling
    // action, never a click on a Training Mode selection button itself.
    expect(fixedButton.className).toContain("bg-slate-900");
  });

  it("selecting a Training Mode still works normally alongside its Info button", () => {
    render(<TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Variable Weight" }));

    expect(
      screen.getByRole("button", { name: "Variable Weight" }).className
    ).toContain("bg-slate-900");
  });

  it("never nests a <button> inside another <button>", () => {
    const { container } = render(
      <TrainingSetup submitLabel="Start Block" onSubmit={vi.fn()} />
    );
    expect(container.querySelectorAll("button button").length).toBe(0);
  });
});
