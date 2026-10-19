// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainingSetup from "../TrainingSetup";

afterEach(cleanup);

describe("the approved compact training setup", () => {
  it("starts with applicable targets and a summary, and submits the unchanged defaults", () => {
    const onSubmit = vi.fn();
    render(<TrainingSetup submitLabel="Start Training" onSubmit={onSubmit} />);
    expect(screen.getByText("Fixed Weight · Time")).toBeVisible();
    expect(screen.getByLabelText("Target Time (s)")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Variable Weight" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Both" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 }));
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("measurement");
  });

  it("keeps both targets and selected quantities across Change/Done", () => {
    const onSubmit = vi.fn();
    render(<TrainingSetup submitLabel="Start Training" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), { target: { value: "2.41" } });
    fireEvent.change(screen.getByLabelText("Target Time (s)"), { target: { value: "3.812" } });
    fireEvent.click(screen.getByRole("button", { name: "Done changing configuration" }));
    expect(screen.getByLabelText("Target Speed (m/s)")).toBeVisible();
    expect(screen.getByText("Fixed Weight · Time + Speed")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByRole("radio", { name: "Both" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "Done changing configuration" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ measurement: expect.objectContaining({
      quantities: ["time", "speed"], time: expect.objectContaining({ target: 3.812 }), speed: expect.objectContaining({ target: 2.41 }),
    }) }));
  });

  it("reveals an invalid tolerance editor when submitted after closing it", () => {
    const onSubmit = vi.fn();
    render(<TrainingSetup submitLabel="Start Training" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Adjust" }));
    const fields = screen.getAllByRole("textbox");
    const toleranceField = fields.find((field) => field.id.startsWith("time-tolerance"));
    expect(toleranceField).toBeDefined();
    fireEvent.change(toleranceField!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute("aria-expanded", "true");
  });
});
