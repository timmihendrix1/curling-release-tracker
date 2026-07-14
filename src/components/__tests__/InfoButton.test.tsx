// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { fixedWeightExplanation } from "../../lib/helpContent";
import InfoButton from "../InfoButton";

afterEach(cleanup);

describe("InfoButton — FeatureExplanation content", () => {
  it("shows purpose, mechanics and useful-for sections behind the Info button", () => {
    render(<InfoButton explanation={fixedWeightExplanation()} />);

    fireEvent.click(screen.getByRole("button", { name: "About Fixed Weight" }));

    expect(screen.getByRole("dialog", { name: "Fixed Weight" })).toBeInTheDocument();
    expect(
      screen.getByText(/Can I repeatedly reproduce the same release\?/)
    ).toBeInTheDocument();
    expect(screen.getByText("How it works")).toBeInTheDocument();
    expect(screen.getByText("Useful for")).toBeInTheDocument();
    expect(screen.getByText("Handle comparison")).toBeInTheDocument();
  });

  it("does not trigger any surrounding click handler when opened", () => {
    let outerClicks = 0;
    render(
      <div onClick={() => (outerClicks += 1)}>
        <button type="button" onClick={() => (outerClicks += 1)}>
          Select
        </button>
        <InfoButton explanation={fixedWeightExplanation()} />
      </div>
    );

    fireEvent.click(screen.getByRole("button", { name: "About Fixed Weight" }));

    // The Info button's own click (bubbling to the wrapping <div>) is
    // expected; the sibling "Select" button must never have been activated.
    expect(outerClicks).toBe(1);
  });

  it("renders the trigger and the popover as siblings, never a <button> nested in a <button>", () => {
    const { container } = render(
      <InfoButton explanation={fixedWeightExplanation()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "About Fixed Weight" }));

    const nestedButtons = container.querySelectorAll("button button");
    expect(nestedButtons.length).toBe(0);
  });

  it("has a descriptive aria-label on the trigger button", () => {
    render(<InfoButton explanation={fixedWeightExplanation()} />);
    expect(
      screen.getByRole("button", { name: "About Fixed Weight" })
    ).toHaveAttribute("aria-label", "About Fixed Weight");
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<InfoButton explanation={fixedWeightExplanation()} />);
    const trigger = screen.getByRole("button", { name: "About Fixed Weight" });

    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes via the explicit Close button and returns focus to the trigger", () => {
    render(<InfoButton explanation={fixedWeightExplanation()} />);
    const trigger = screen.getByRole("button", { name: "About Fixed Weight" });

    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
