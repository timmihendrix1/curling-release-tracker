// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import AssessmentSetupDiagram from "../AssessmentSetupDiagram";

afterEach(cleanup);

describe("AssessmentSetupDiagram", () => {
  it("renders the schematic with an unchanged accessible title and description", () => {
    render(<AssessmentSetupDiagram />);

    const svg = screen.getByRole("img");
    expect(svg).toHaveAttribute(
      "aria-labelledby",
      "assessment-setup-diagram-title assessment-setup-diagram-desc"
    );
    expect(document.getElementById("assessment-setup-diagram-title")).toHaveTextContent(
      "Backline–Hog setup diagram"
    );
    expect(document.getElementById("assessment-setup-diagram-desc")).toHaveTextContent(
      "A schematic sheet of ice showing the hack at the bottom, the delivery direction pointing up, the backline with Timing Gate 1 just above the hack, the hogline with Timing Gate 2 further up, and the stone path between them. The segment between the backline and hogline is highlighted as the measured segment."
    );
  });

  it("renders every required label exactly once", () => {
    render(<AssessmentSetupDiagram />);

    for (const label of ["Hack", "Backline", "Gate 1", "Hogline", "Gate 2", "Delivery"]) {
      expect(screen.getAllByText(label)).toHaveLength(1);
    }
  });

  it("keeps the Delivery arrow clear of the Backline label horizontally", () => {
    const { container } = render(<AssessmentSetupDiagram />);

    const backlineText = screen.getByText("Backline");
    const deliveryText = screen.getByText("Delivery");
    const deliveryLine = container.querySelector('line[x1="75"]');

    // The Backline label sits at x=14 and is well under 60 units wide at this
    // font size; the Delivery arrow/label were moved to x=75 specifically to
    // clear it (see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md
    // section 24 / the setup diagram). Assert the non-overlapping x-origins
    // rather than pixel geometry, which jsdom cannot measure for SVG text.
    expect(backlineText.getAttribute("x")).toBe("14");
    expect(deliveryText.getAttribute("x")).toBe("75");
    expect(deliveryLine).not.toBeNull();
  });
});
