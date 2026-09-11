// The diagram correction: German text is removed from the published image at the
// source, and the English replacement is placed from measured source geometry.
//
// These tests protect the two things that cannot be checked by looking at a PNG: that
// every label is accounted for, and that a corrected diagram always arrives under a new
// content identity so a warm cache of the old image cannot stand in for it.
import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../catalog";
import { sourceDiagramLabel } from "../diagramLabelGeometry";
import { listCurrentExerciseVersions } from "../lookup";
import {
  CURRENT_PUBLIC_EXERCISE_ASSET_IDS,
  SUPERSEDED_PUBLIC_EXERCISE_ASSET_IDS,
} from "../restrictedAssetCatalog";
import { SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY } from "../swissCurlingDiagramLabels";
import type { ExerciseDiagram, ExerciseVersion } from "../types";

type SourceImageDiagram = Extract<ExerciseDiagram, { kind: "attributed-source-image" }>;

function sourceImageDiagram(version: ExerciseVersion): SourceImageDiagram | undefined {
  return version.diagram?.kind === "attributed-source-image" ? version.diagram : undefined;
}

const CURRENT_SOURCE_DIAGRAMS = listCurrentExerciseVersions(EXERCISE_CATALOG)
  .map((version) => ({ version, diagram: sourceImageDiagram(version) }))
  .filter((entry): entry is { version: ExerciseVersion; diagram: SourceImageDiagram } =>
    entry.diagram !== undefined
  );

/** Words that only appear in the source document's own language. */
const GERMAN_PATTERN =
  /Zielzone|Übung|Stein\b|Steine|Haus-Viertel|Besenlänge|Markierung|Abstand|Seite legen|Länge|nacheinander/;

describe("published Swiss Curling diagrams", () => {
  it("all reference a currently registered asset id", () => {
    expect(CURRENT_SOURCE_DIAGRAMS).toHaveLength(37);
    for (const { version, diagram } of CURRENT_SOURCE_DIAGRAMS) {
      expect(
        CURRENT_PUBLIC_EXERCISE_ASSET_IDS,
        `${version.id} must reference a current diagram asset`
      ).toContain(diagram.assetReference.assetId);
    }
  });

  it("show no German text in any label an athlete can read", () => {
    for (const { version, diagram } of CURRENT_SOURCE_DIAGRAMS) {
      for (const label of diagram.localizedTextOverlays ?? []) {
        expect(label.text, `${version.id} label ${label.id}`).not.toMatch(GERMAN_PATTERN);
      }
      expect(diagram.caption).not.toMatch(GERMAN_PATTERN);
      expect(diagram.accessibleSummary).not.toMatch(GERMAN_PATTERN);
    }
  });

  it("carry one English label for every German label the source page had", () => {
    for (const { version, diagram } of CURRENT_SOURCE_DIAGRAMS) {
      const measured = SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY[diagram.assetReference.assetId];
      const labels = diagram.localizedTextOverlays ?? [];
      if (!measured) {
        // A diagram whose only text is a language-neutral sequence numeral needs none.
        expect(labels, `${version.id} should declare no label`).toHaveLength(0);
        continue;
      }
      expect(
        labels.map((label) => label.id).sort(),
        `${version.id} must replace every removed source label`
      ).toEqual(Object.keys(measured).sort());
    }
  });

  it("place every label from measured geometry, in bounds and without an opaque patch", () => {
    for (const { version, diagram } of CURRENT_SOURCE_DIAGRAMS) {
      const measured = SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY[diagram.assetReference.assetId];
      for (const label of diagram.localizedTextOverlays ?? []) {
        const box = measured?.[label.id];
        expect(box, `${version.id} label ${label.id} has measured geometry`).toBeDefined();
        if (!box) continue;
        // The label fills the callout the source drew, or — where there is none — keeps
        // the replaced text's own span, centred on it so a differing English line count
        // cannot drift the label away.
        const anchor = box.container ?? box;
        expect(label.x).toBe(anchor.x);
        expect(label.width).toBe(anchor.width);
        expect(label.y + label.height / 2).toBeCloseTo(anchor.y + anchor.height / 2, 3);
        if (box.container) {
          // A callout must still contain the text it frames.
          expect(box.container.x).toBeLessThanOrEqual(box.x);
          expect(box.container.x + box.container.width)
            .toBeGreaterThanOrEqual(box.x + box.width);
        }
        expect(label.x + label.width).toBeLessThanOrEqual(1);
        expect(label.y).toBeGreaterThanOrEqual(0);
        expect(label.y + label.height).toBeLessThanOrEqual(1);
        // No patch: the image no longer contains the text this label replaces.
        expect(label.backgroundColor).toBeUndefined();
        expect(label.textColor).toBe(box.textColor);
      }
    }
  });

  it("give a corrected diagram a new asset id and a new diagram id, so a warm cache cannot mask it", () => {
    const byExercise = new Map<string, ExerciseVersion[]>();
    for (const version of EXERCISE_CATALOG.versions) {
      byExercise.set(version.exerciseId, [
        ...(byExercise.get(version.exerciseId) ?? []),
        version,
      ]);
    }

    let corrected = 0;
    for (const versions of byExercise.values()) {
      const ordered = [...versions].sort((a, b) => a.version - b.version);
      for (let index = 1; index < ordered.length; index++) {
        const previous = sourceImageDiagram(ordered[index - 1]);
        const next = sourceImageDiagram(ordered[index]);
        if (!previous || !next) continue;
        if (previous.assetReference.assetId === next.assetReference.assetId) continue;
        corrected++;
        // A different image is always a different diagram identity too.
        expect(next.id).not.toBe(previous.id);
        expect(SUPERSEDED_PUBLIC_EXERCISE_ASSET_IDS).toContain(
          previous.assetReference.assetId
        );
        expect(CURRENT_PUBLIC_EXERCISE_ASSET_IDS).toContain(next.assetReference.assetId);
      }
    }
    // Every diagram that carried German text was republished.
    expect(corrected).toBe(30);
  });

  it("keeps a superseded Version pointing at the image it was drawn for", () => {
    for (const version of EXERCISE_CATALOG.versions) {
      const diagram = sourceImageDiagram(version);
      if (!diagram) continue;
      const isCurrent = CURRENT_SOURCE_DIAGRAMS.some(
        (entry) => entry.version.id === version.id
      );
      if (isCurrent) continue;
      // A historical Version still resolves, and it resolves to its own bytes — never
      // silently to the corrected image.
      expect([
        ...CURRENT_PUBLIC_EXERCISE_ASSET_IDS,
        ...SUPERSEDED_PUBLIC_EXERCISE_ASSET_IDS,
      ]).toContain(diagram.assetReference.assetId);
    }
  });
});

describe("sourceDiagramLabel", () => {
  const [assetId] = Object.keys(SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY);
  const [labelId] = Object.keys(SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY[assetId]);

  it("refuses to guess a position for an unknown asset or label", () => {
    expect(() => sourceDiagramLabel("not-an-asset", labelId, "Target zone")).toThrow(
      /No measured label geometry/
    );
    expect(() => sourceDiagramLabel(assetId, "not-a-label", "Target zone")).toThrow(
      /No measured label geometry/
    );
  });

  it("grows the box for a taller English wording about the source label's own centre", () => {
    const box = SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY[assetId][labelId];
    const anchor = box.container ?? box;
    const oneLine = sourceDiagramLabel(assetId, labelId, "Target zone");
    const threeLines = sourceDiagramLabel(assetId, labelId, "One\nTwo\nThree");

    expect(threeLines.height).toBeGreaterThan(oneLine.height);
    expect(oneLine.y + oneLine.height / 2).toBeCloseTo(anchor.y + anchor.height / 2, 3);
    expect(threeLines.y + threeLines.height / 2).toBeCloseTo(anchor.y + anchor.height / 2, 3);
    expect(threeLines.x).toBe(anchor.x);
  });

  it("centres a framed label in the callout the source drew, not on the German glyph run", () => {
    // Draw Exercise 12's "Stone 2" callout: the German text sits left of the rectangle's
    // centre, so anchoring to it pushed the longer English label off the image.
    const framedAsset = "swiss-curling-draw-exercise-12-v2";
    const framed = SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY[framedAsset]["stone-2"];
    expect(framed.container).toBeDefined();
    const label = sourceDiagramLabel(framedAsset, "stone-2", "Stone 2: Come-around");
    expect(label.x).toBe(framed.container?.x);
    expect(label.width).toBe(framed.container?.width);
    expect(label.x).toBeGreaterThan(0);
    expect(label.x + label.width).toBeLessThanOrEqual(1);
  });

  it("keeps the source's own type size, whatever the English wording is", () => {
    const box = SWISS_CURLING_DIAGRAM_LABEL_GEOMETRY[assetId][labelId];
    expect(sourceDiagramLabel(assetId, labelId, "Target zone").fontSize).toBe(box.fontSize);
    expect(sourceDiagramLabel(assetId, labelId, "One\nTwo\nThree").fontSize).toBe(box.fontSize);
  });
});
