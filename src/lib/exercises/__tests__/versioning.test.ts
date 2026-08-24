import { describe, expect, it } from "vitest";
import {
  findExercise,
  findExerciseVersion,
  listCurrentExerciseVersions,
  listExerciseVersions,
  resolveCurrentExerciseVersion,
} from "../lookup";
import { validateExerciseCatalogPackage } from "../validation";
import {
  buildTestExercise,
  buildTestPackage,
  buildTestSourceImageDiagram,
  buildTestStructuredDiagram,
  buildTestVersion,
  buildTwoVersionDiagramReplacementPackage,
} from "./testHelpers";

/**
 * The Stage A review case (spec 21, Stage A): replacing an attributed source
 * image with an independently authored structured platform diagram is a
 * *content* change, so it must create a new Exercise Version rather than edit
 * the existing one — and it must not rewrite what an already-recorded
 * reference to version 1 would resolve to.
 */
describe("replacing a Diagram creates a new Exercise Version", () => {
  const before = buildTestPackage({
    exercises: [buildTestExercise({ currentVersionId: "test-exercise-v1" })],
    versions: [buildTestVersion({ id: "test-exercise-v1", version: 1, diagram: buildTestSourceImageDiagram() })],
  });
  const after = buildTwoVersionDiagramReplacementPackage();

  it("keeps both packages valid", () => {
    expect(validateExerciseCatalogPackage(before)).toEqual({ valid: true });
    expect(validateExerciseCatalogPackage(after)).toEqual({ valid: true });
  });

  it("keeps the stable Exercise id unchanged", () => {
    expect(findExercise(before, "test-exercise")?.id).toBe("test-exercise");
    expect(findExercise(after, "test-exercise")?.id).toBe("test-exercise");
  });

  it("gives the new content a distinct Version id and an incremented version number", () => {
    const v1 = findExerciseVersion(after, "test-exercise-v1");
    const v2 = findExerciseVersion(after, "test-exercise-v2");

    expect(v1?.version).toBe(1);
    expect(v2?.version).toBe(2);
    expect(v1?.id).not.toBe(v2?.id);
    expect(v1?.exerciseId).toBe(v2?.exerciseId);
  });

  it("moves the current version pointer to the new version", () => {
    expect(resolveCurrentExerciseVersion(before, "test-exercise")?.id).toBe("test-exercise-v1");
    expect(resolveCurrentExerciseVersion(after, "test-exercise")?.id).toBe("test-exercise-v2");
  });

  it("actually changes the diagram kind between the two versions", () => {
    expect(findExerciseVersion(after, "test-exercise-v1")?.diagram?.kind).toBe(
      "attributed-source-image"
    );
    expect(findExerciseVersion(after, "test-exercise-v2")?.diagram?.kind).toBe(
      "structured-platform-diagram"
    );
  });

  it("leaves version 1's content byte-for-byte unchanged", () => {
    const originalSnapshot = JSON.stringify(findExerciseVersion(before, "test-exercise-v1"));
    const afterSnapshot = JSON.stringify(findExerciseVersion(after, "test-exercise-v1"));
    expect(afterSnapshot).toBe(originalSnapshot);
  });

  it("keeps the older version independently resolvable by its own Version id", () => {
    const v1 = findExerciseVersion(after, "test-exercise-v1");
    expect(v1).toBeDefined();
    expect(v1?.diagram?.kind).toBe("attributed-source-image");
    expect(listExerciseVersions(after, "test-exercise").map((v) => v.version)).toEqual([1, 2]);
  });

  it("shows only the current version in the Library, without hiding the old one from lookup", () => {
    expect(listCurrentExerciseVersions(after).map((version) => version.id)).toEqual([
      "test-exercise-v2",
    ]);
    expect(findExerciseVersion(after, "test-exercise-v1")).toBeDefined();
  });
});

describe("current-version resolution never guesses", () => {
  it("returns undefined when the named current version is missing", () => {
    const pkg = buildTestPackage({
      exercises: [buildTestExercise({ currentVersionId: "gone" })],
      versions: [buildTestVersion()],
    });
    expect(resolveCurrentExerciseVersion(pkg, "test-exercise")).toBeUndefined();
    expect(listCurrentExerciseVersions(pkg)).toEqual([]);
  });

  it("returns undefined when the named current version belongs to another Exercise", () => {
    const pkg = buildTestPackage({
      exercises: [
        buildTestExercise({ id: "exercise-a", currentVersionId: "exercise-b-v1" }),
        buildTestExercise({ id: "exercise-b", currentVersionId: "exercise-b-v1" }),
      ],
      versions: [buildTestVersion({ id: "exercise-b-v1", exerciseId: "exercise-b" })],
    });
    expect(resolveCurrentExerciseVersion(pkg, "exercise-a")).toBeUndefined();
    expect(resolveCurrentExerciseVersion(pkg, "exercise-b")?.id).toBe("exercise-b-v1");
  });

  it("never returns a newer version for an explicit older Version id lookup", () => {
    const pkg = buildTwoVersionDiagramReplacementPackage();
    const explicit = findExerciseVersion(pkg, "test-exercise-v1");
    expect(explicit?.version).toBe(1);
    expect(explicit?.diagram).toEqual(buildTestSourceImageDiagram());
    expect(explicit?.diagram).not.toEqual(buildTestStructuredDiagram());
  });
});
