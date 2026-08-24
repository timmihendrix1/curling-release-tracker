// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ExerciseStructuredDiagram from "../ExerciseStructuredDiagram";
import { DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE } from "../../lib/exercises/presentation";
import { buildTestStructuredDiagram } from "../../lib/exercises/__tests__/testHelpers";
import type { ExerciseDiagram, ExerciseDiagramElement } from "../../lib/exercises/types";

afterEach(cleanup);

type StructuredDiagram = Extract<ExerciseDiagram, { kind: "structured-platform-diagram" }>;

function structured(
  overrides: Partial<StructuredDiagram> = {}
): StructuredDiagram {
  return buildTestStructuredDiagram(overrides) as StructuredDiagram;
}

describe("ExerciseStructuredDiagram", () => {
  it("renders an accessible figure with a caption and a textual alternative", () => {
    render(<ExerciseStructuredDiagram diagram={structured()} />);

    const svg = screen.getByTestId("exercise-structured-diagram");
    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg).toHaveAttribute("role", "img");
    expect(svg.closest("figure")).not.toBeNull();

    const accessibleName = svg.getAttribute("aria-labelledby");
    expect(accessibleName).toBeTruthy();
    expect(svg.querySelector("title")?.textContent).toBe("Test diagram caption.");
    expect(svg.querySelector("desc")?.textContent).toBe(
      "A test diagram showing a sheet, a line, a house and one stone."
    );

    const caption = svg.closest("figure")?.querySelector("figcaption");
    expect(caption?.textContent).toBe("Test diagram caption.");
  });

  it("derives its viewBox from the declared aspect ratio, with no pixel geometry", () => {
    render(<ExerciseStructuredDiagram diagram={structured({ aspectRatio: 2 })} />);

    const svg = screen.getByTestId("exercise-structured-diagram");
    expect(svg.getAttribute("viewBox")).toBe("0 0 100 50");
    expect(svg).not.toHaveAttribute("width");
    expect(svg).not.toHaveAttribute("height");
    expect(svg.getAttribute("class")).toContain("w-full");
    expect(svg.getAttribute("class")).toContain("h-auto");
  });

  it("renders every supported element kind from data", () => {
    render(<ExerciseStructuredDiagram diagram={structured()} />);
    const svg = screen.getByTestId("exercise-structured-diagram");

    for (const kind of [
      "sheet",
      "line",
      "house",
      "stone",
      "path",
      "arrow",
      "target-zone",
      "label",
    ]) {
      expect(svg.querySelector(`[data-element-kind="${kind}"]`)).not.toBeNull();
    }

    // House rings come from the radii array, not from a fixed number of circles.
    expect(
      svg.querySelectorAll('[data-element-kind="house"] circle')
    ).toHaveLength(2);
    // Optional labels on stones, arrows and zones are rendered when present.
    expect(svg.textContent).toContain("Delivery");
    expect(svg.textContent).toContain("Test label");
  });

  it("scales a house radius against the same axis as x, so a ring stays a true circle", () => {
    render(
      <ExerciseStructuredDiagram
        diagram={structured({
          aspectRatio: 2,
          elements: [
            { kind: "house", id: "house", center: { x: 0.5, y: 0.5 }, radii: [0.25] },
          ],
        })}
      />
    );

    const circle = screen
      .getByTestId("exercise-structured-diagram")
      .querySelector('[data-element-kind="house"] circle');
    expect(circle?.getAttribute("cx")).toBe("50");
    expect(circle?.getAttribute("cy")).toBe("25");
    expect(circle?.getAttribute("r")).toBe("25");
  });

  it("reports an unsupported element visibly instead of dropping it silently", () => {
    const withUnsupported = structured({
      elements: [
        { kind: "sheet", id: "sheet", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
        { kind: "sensor-trajectory", id: "future" } as unknown as ExerciseDiagramElement,
      ],
    });

    render(<ExerciseStructuredDiagram diagram={withUnsupported} />);

    expect(screen.getByText(DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE)).toBeInTheDocument();
    const svg = screen.getByTestId("exercise-structured-diagram");
    expect(svg.querySelector('[data-element-id="sheet"]')).not.toBeNull();
    expect(svg.querySelector('[data-element-id="future"]')).toBeNull();
  });

  it("shows no unsupported-content notice when every element is supported", () => {
    render(<ExerciseStructuredDiagram diagram={structured()} />);
    expect(screen.queryByText(DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE)).toBeNull();
  });
});
