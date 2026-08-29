// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExerciseDiagramView from "../ExerciseDiagramView";
import ExerciseRestrictedSourceImage from "../ExerciseRestrictedSourceImage";
import {
  DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE,
  RESTRICTED_DIAGRAM_UNAVAILABLE_BODY,
  RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE,
} from "../../lib/exercises/presentation";
import {
  buildTestSourceImageDiagram,
  buildTestStructuredDiagram,
} from "../../lib/exercises/__tests__/testHelpers";
import type { ExerciseAssetResolver } from "../../lib/exercises/exerciseAssets";
import type { ExerciseDiagram } from "../../lib/exercises/types";

afterEach(cleanup);

type SourceImageDiagram = Extract<ExerciseDiagram, { kind: "attributed-source-image" }>;
const DIAGRAM = buildTestSourceImageDiagram() as SourceImageDiagram;

function resolverReturning(src: string): ExerciseAssetResolver {
  return { resolveExerciseAsset: () => ({ src }) };
}

function expectNoAssetAddressLeak(container: HTMLElement) {
  expect(container.innerHTML).not.toContain(DIAGRAM.assetReference.assetId);
  expect(container.innerHTML).not.toMatch(/https?:|data:|blob:|\.png|leak|threw|Error/i);
  expect(container.querySelector("[href]")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
}

describe("ExerciseRestrictedSourceImage — unavailable", () => {
  it("renders a clear unavailable state and compact caption without a resolver", () => {
    const { container } = render(<ExerciseRestrictedSourceImage diagram={DIAGRAM} />);

    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_BODY)).toBeInTheDocument();
    expect(screen.getByText(DIAGRAM.caption)).toBeInTheDocument();
    expect(screen.queryByText(DIAGRAM.provenanceNote)).toBeNull();
    expectNoAssetAddressLeak(container);
  });

  it("fails closed when a resolver declines, throws, or returns an unusable source", async () => {
    const cases: ExerciseAssetResolver[] = [
      { resolveExerciseAsset: vi.fn(() => null) },
      { resolveExerciseAsset: () => { throw new Error("leak /private/asset.png"); } },
      { resolveExerciseAsset: async () => { throw "leak"; } },
      { resolveExerciseAsset: () => ({ src: "" }) },
      { resolveExerciseAsset: () => ({ get src(): string { throw new Error("getter leak"); } }) },
    ];

    for (const exerciseAssetResolver of cases) {
      const { container, unmount } = render(
        <ExerciseRestrictedSourceImage
          diagram={DIAGRAM}
          exerciseAssetResolver={exerciseAssetResolver}
        />
      );
      expect(await screen.findByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
      expectNoAssetAddressLeak(container);
      unmount();
    }
  });

  it("rejects an invalid distribution without consulting the resolver", () => {
    const exerciseAssetResolver: ExerciseAssetResolver = {
      resolveExerciseAsset: vi.fn(() => ({ src: "blob:leak" })),
    };
    const invalidDiagram = {
      ...DIAGRAM,
      distribution: {
        scope: "public",
        permittedAudience: "Everyone.",
        publicDeliveryPermitted: false,
      },
    } as unknown as SourceImageDiagram;

    render(
      <ExerciseRestrictedSourceImage
        diagram={invalidDiagram}
        exerciseAssetResolver={exerciseAssetResolver}
      />
    );

    expect(exerciseAssetResolver.resolveExerciseAsset).not.toHaveBeenCalled();
    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
  });
});

describe("ExerciseRestrictedSourceImage — available", () => {
  it("renders the resolver source, English alt text, compact caption, and no prominent provenance", async () => {
    const { container } = render(
      <ExerciseRestrictedSourceImage
        diagram={DIAGRAM}
        exerciseAssetResolver={resolverReturning("blob:authorized-test-asset")}
      />
    );

    const image = await screen.findByRole("img", { name: DIAGRAM.accessibleSummary });
    expect(image).toHaveAttribute("src", "blob:authorized-test-asset");
    expect(screen.getByText(DIAGRAM.caption)).toBeInTheDocument();
    expect(screen.queryByText(DIAGRAM.provenanceNote)).toBeNull();
    expect(container.innerHTML).not.toContain(DIAGRAM.assetReference.assetId);
    const imageContainer = image.parentElement?.parentElement;
    expect(imageContainer).toHaveClass("max-h-[70vh]");
    await userEvent.click(screen.getByRole("button", { name: "View Full Diagram" }));
    expect(imageContainer).not.toHaveClass("max-h-[70vh]");
    expect(screen.getByRole("button", { name: "Show Compact Diagram" })).toBeInTheDocument();
  });

  it("covers source-language labels with data-driven English text", async () => {
    const localizedDiagram: SourceImageDiagram = {
      ...DIAGRAM,
      localizedTextOverlays: [{
        id: "target-zone",
        x: 0.7,
        y: 0.1,
        width: 0.25,
        height: 0.04,
        text: "Target zone",
        backgroundColor: "#b7e3f4",
        textColor: "#000000",
        fontSize: 0.035,
      }],
    };
    render(
      <ExerciseRestrictedSourceImage
        diagram={localizedDiagram}
        exerciseAssetResolver={resolverReturning("blob:localized-test-asset")}
      />
    );

    await screen.findByRole("img", { name: localizedDiagram.accessibleSummary });
    expect(screen.getByText("Target zone")).toHaveStyle({
      left: "70%",
      top: "10%",
      backgroundColor: "#b7e3f4",
    });
  });
});

describe("ExerciseDiagramView dispatch", () => {
  it("routes a structured diagram to the SVG renderer", () => {
    render(<ExerciseDiagramView diagram={buildTestStructuredDiagram()} />);
    expect(screen.getByTestId("exercise-structured-diagram")).toBeInTheDocument();
  });

  it("routes a source image to the attributed-image renderer", () => {
    render(<ExerciseDiagramView diagram={DIAGRAM} />);
    expect(screen.getByTestId("exercise-restricted-diagram-unavailable")).toBeInTheDocument();
  });

  it("reports an unrecognised diagram kind visibly", () => {
    render(
      <ExerciseDiagramView
        diagram={{ kind: "animated-sequence", id: "future" } as unknown as ExerciseDiagram}
      />
    );
    expect(screen.getByText(DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE)).toBeInTheDocument();
  });
});
