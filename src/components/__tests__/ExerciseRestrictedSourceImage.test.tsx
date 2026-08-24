// @vitest-environment jsdom
//
// The restricted source-asset boundary (spec 5.4 / 6.3). Stage A ships no
// restricted asset, so these tests use an in-memory, test-only diagram
// fixture — the real Swiss Curling image is deliberately not in this
// repository.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
import type { ExerciseDiagram } from "../../lib/exercises/types";

afterEach(cleanup);

type SourceImageDiagram = Extract<ExerciseDiagram, { kind: "attributed-source-image" }>;

const DIAGRAM = buildTestSourceImageDiagram() as SourceImageDiagram;

/**
 * ADR-0023 Decision 5: attribution, source organisation, source version,
 * permitted audience and provenance are rendered in *both* the authorized and
 * the unavailable branch. Asserted through one helper so no branch's test can
 * quietly check fewer of them.
 */
function expectAllProvenanceVisible() {
  for (const [label, value] of [
    ["Attribution", DIAGRAM.attribution],
    ["Source organisation", DIAGRAM.sourceOrganization],
    ["Source version", DIAGRAM.sourceVersion],
    ["Permitted audience", DIAGRAM.distribution.permittedAudience],
    ["Provenance", DIAGRAM.provenanceNote],
  ] as const) {
    // The label and its value are associated as a definition pair.
    const term = screen.getByText(`${label}:`);
    expect(term.tagName.toLowerCase()).toBe("dt");
    expect(term.nextElementSibling?.tagName.toLowerCase()).toBe("dd");
    expect(term.nextElementSibling).toHaveTextContent(value);
  }
  expect(screen.getByText(DIAGRAM.caption)).toBeInTheDocument();
}

/** Nothing that could address the asset, and nothing a resolver threw, is in the markup. */
function expectNoAssetAddressLeak(container: HTMLElement) {
  expect(container.innerHTML).not.toContain(DIAGRAM.assetReference.assetId);
  expect(container.innerHTML).not.toMatch(/https?:|data:|blob:|\.png|leak|threw|Error/i);
  expect(container.querySelector("[href]")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
}

describe("ExerciseRestrictedSourceImage — unauthorized", () => {
  it("renders a clear, accessible unavailable state when no resolver is supplied", () => {
    render(<ExerciseRestrictedSourceImage diagram={DIAGRAM} />);

    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_BODY)).toBeInTheDocument();
    expect(screen.getByText("The named closed-beta team only.")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("never emits or infers an asset URL from the opaque asset id", () => {
    const { container } = render(<ExerciseRestrictedSourceImage diagram={DIAGRAM} />);

    expect(container.innerHTML).not.toContain(DIAGRAM.assetReference.assetId);
    expect(container.innerHTML).not.toMatch(/src=/);
    expect(container.innerHTML).not.toMatch(/https?:|data:|blob:/);
    expect(container.querySelector("[href]")).toBeNull();
  });

  it("renders all five required provenance values even when the image cannot be shown", () => {
    render(<ExerciseRestrictedSourceImage diagram={DIAGRAM} />);
    expectAllProvenanceVisible();
  });

  it("falls back to the unavailable state when a resolver declines", () => {
    const resolver = { resolveRestrictedAsset: vi.fn(() => null) };
    const { container } = render(
      <ExerciseRestrictedSourceImage diagram={DIAGRAM} restrictedAssetResolver={resolver} />
    );

    expect(resolver.resolveRestrictedAsset).toHaveBeenCalledWith(
      DIAGRAM.assetReference,
      DIAGRAM.distribution
    );
    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expectAllProvenanceVisible();
    expectNoAssetAddressLeak(container);
  });

  it("renders the unavailable state when the resolver throws an Error, and does not crash", () => {
    const { container } = render(
      <ExerciseRestrictedSourceImage
        diagram={DIAGRAM}
        restrictedAssetResolver={{
          resolveRestrictedAsset: () => {
            throw new Error(
              `delivery failed for https://cdn.example.com/${DIAGRAM.assetReference.assetId}.png`
            );
          },
        }}
      />
    );

    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_BODY)).toBeInTheDocument();

    // The provenance record survives a resolver failure intact...
    expectAllProvenanceVisible();
    // ...and neither the exception text nor anything derivable from it leaks.
    expectNoAssetAddressLeak(container);
    expect(container.innerHTML).not.toContain("delivery failed");
  });

  it("renders the unavailable state when the returned resolution's src getter throws", () => {
    const { container } = render(
      <ExerciseRestrictedSourceImage
        diagram={DIAGRAM}
        restrictedAssetResolver={{
          resolveRestrictedAsset: () =>
            ({
              get src(): string {
                throw new Error(
                  `getter leak https://cdn.example.com/${DIAGRAM.assetReference.assetId}.png`
                );
              },
            }) as { src: string },
        }}
      />
    );

    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_BODY)).toBeInTheDocument();
    expectAllProvenanceVisible();
    expectNoAssetAddressLeak(container);
  });

  it("renders the unavailable state when the resolver throws a non-Error value", () => {
    for (const thrown of ["/private/leak.png", 500, null, undefined, { leak: true }]) {
      const { container, unmount } = render(
        <ExerciseRestrictedSourceImage
          diagram={DIAGRAM}
          restrictedAssetResolver={{
            resolveRestrictedAsset: () => {
              throw thrown;
            },
          }}
        />
      );

      expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
      expect(container.querySelector("img")).toBeNull();
      expect(container.innerHTML).not.toContain("leak");
      unmount();
    }
  });

  it("keeps the whole provenance record readable after a resolver failure", () => {
    render(
      <ExerciseRestrictedSourceImage
        diagram={DIAGRAM}
        restrictedAssetResolver={{
          resolveRestrictedAsset: () => {
            throw new Error("nope");
          },
        }}
      />
    );

    expectAllProvenanceVisible();
  });

  it("refuses to render, and never consults the resolver, when the diagram permits public delivery", () => {
    const resolver = { resolveRestrictedAsset: vi.fn(() => ({ src: "blob:leak" })) };
    render(
      <ExerciseRestrictedSourceImage
        diagram={{
          ...DIAGRAM,
          distribution: {
            ...DIAGRAM.distribution,
            publicDeliveryPermitted: true as unknown as false,
          },
        }}
        restrictedAssetResolver={resolver}
      />
    );

    expect(resolver.resolveRestrictedAsset).not.toHaveBeenCalled();
    expect(screen.getByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });
});

describe("ExerciseRestrictedSourceImage — authorized", () => {
  it("renders the resolver's own source with the diagram's English alt text", () => {
    render(
      <ExerciseRestrictedSourceImage
        diagram={DIAGRAM}
        restrictedAssetResolver={{
          resolveRestrictedAsset: () => ({ src: "blob:authorized-test-asset" }),
        }}
      />
    );

    const image = screen.getByRole("img", { name: DIAGRAM.accessibleSummary });
    expect(image).toHaveAttribute("src", "blob:authorized-test-asset");
    expect(screen.queryByText(RESTRICTED_DIAGRAM_UNAVAILABLE_TITLE)).toBeNull();
  });

  it("renders all five required provenance values alongside the image", () => {
    render(
      <ExerciseRestrictedSourceImage
        diagram={DIAGRAM}
        restrictedAssetResolver={{
          resolveRestrictedAsset: () => ({ src: "blob:authorized-test-asset" }),
        }}
      />
    );

    expectAllProvenanceVisible();
  });

  it("still never writes the opaque asset id into the DOM", () => {
    const { container } = render(
      <ExerciseRestrictedSourceImage
        diagram={DIAGRAM}
        restrictedAssetResolver={{
          resolveRestrictedAsset: () => ({ src: "blob:authorized-test-asset" }),
        }}
      />
    );

    // The authorized branch legitimately carries the resolver's own src, but the
    // reference it was resolved from must still be absent.
    expect(container.innerHTML).not.toContain(DIAGRAM.assetReference.assetId);
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "blob:authorized-test-asset"
    );
  });
});

describe("ExerciseDiagramView dispatch", () => {
  it("routes a structured diagram to the SVG renderer", () => {
    render(<ExerciseDiagramView diagram={buildTestStructuredDiagram()} />);
    expect(screen.getByTestId("exercise-structured-diagram")).toBeInTheDocument();
  });

  it("routes a source image to the restricted renderer, which stays unavailable by default", () => {
    render(<ExerciseDiagramView diagram={DIAGRAM} />);
    expect(screen.getByTestId("exercise-restricted-diagram-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("exercise-structured-diagram")).toBeNull();
  });

  it("reports an unrecognised diagram kind visibly rather than rendering nothing", () => {
    render(
      <ExerciseDiagramView
        diagram={{ kind: "animated-sequence", id: "future" } as unknown as ExerciseDiagram}
      />
    );
    expect(screen.getByText(DIAGRAM_UNSUPPORTED_ELEMENTS_NOTICE)).toBeInTheDocument();
  });
});
