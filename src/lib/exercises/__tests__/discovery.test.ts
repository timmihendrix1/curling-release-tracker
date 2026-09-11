// Discovery is a projection over execution semantics, not a rename of them. These tests
// pin both halves of that: what the athlete browses, and what an already-recorded or
// already-planned Exercise still means.
import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../catalog";
import {
  EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
  RELEASE_GATES_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
  ROTATION_COUNT_VERSION_ID,
} from "../content";
import {
  EXERCISE_DISCOVERY_CATEGORIES,
  RETIRED_DISCOVERY_EXERCISE_IDS,
  exerciseDiscoveryCategory,
  isRetiredFromDiscovery,
  listDiscoverableExerciseVersions,
} from "../discovery";
import {
  exerciseRunnerKind,
  findExercise,
  findExerciseVersion,
  listCurrentExerciseVersions,
  resolveCurrentExerciseVersion,
} from "../lookup";
import {
  DEFAULT_EXERCISE_LIBRARY_FILTERS,
  filterExerciseVersions,
  groupExerciseVersionsByCategory,
} from "../query";
import { exerciseDiscoveryCategoryLabel } from "../presentation";

const DISCOVERABLE = listDiscoverableExerciseVersions(EXERCISE_CATALOG);

describe("the active discovery catalog", () => {
  it("has exactly two categories: four Technique and 35 Shotmaking, 39 in total", () => {
    expect(EXERCISE_DISCOVERY_CATEGORIES).toEqual(["technique", "shotmaking"]);
    expect(DISCOVERABLE).toHaveLength(39);

    const groups = groupExerciseVersionsByCategory(DISCOVERABLE);
    expect(groups.map((group) => group.category)).toEqual(["technique", "shotmaking"]);
    expect(groups[0].versions).toHaveLength(4);
    expect(groups[1].versions).toHaveLength(35);
  });

  it("puts Release Time and Rotation Count under Technique without changing their focus", () => {
    const technique = [
      RELEASE_POINT_VERSION_ID,
      RELEASE_TIME_VERSION_ID,
      RELEASE_GATES_VERSION_ID,
      ROTATION_COUNT_VERSION_ID,
    ];
    expect(
      DISCOVERABLE.filter((version) => exerciseDiscoveryCategory(version) === "technique")
        .map((version) => version.id)
    ).toEqual(technique);

    // Execution semantics are untouched: the runner and the recorded focus are the same
    // values a completed result would already carry.
    const releaseTime = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
    expect(releaseTime?.primaryFocus).toBe("measured");
    expect(exerciseRunnerKind(EXERCISE_CATALOG, releaseTime!)).toBe("release-timing");

    const rotationCount = findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID);
    expect(rotationCount?.primaryFocus).toBe("measured");
    expect(exerciseRunnerKind(EXERCISE_CATALOG, rotationCount!)).toBe("exercise-execution");
    expect(rotationCount?.compatibleMeasurementProtocols).toEqual([
      expect.objectContaining({ requirement: "required" }),
    ]);

    // Release Point and Release Gates stay observation Exercises.
    for (const id of [RELEASE_POINT_VERSION_ID, RELEASE_GATES_VERSION_ID]) {
      const version = findExerciseVersion(EXERCISE_CATALOG, id);
      expect(version?.primaryFocus).toBe("technique");
      expect(version?.guidance.kind).toBe("observation");
    }
  });

  it("never presents Measured as a category, whatever an Exercise's recorded focus is", () => {
    for (const category of EXERCISE_DISCOVERY_CATEGORIES) {
      expect(exerciseDiscoveryCategoryLabel(category)).not.toMatch(/Measured/);
    }
    for (const version of EXERCISE_CATALOG.versions) {
      expect(["technique", "shotmaking"]).toContain(exerciseDiscoveryCategory(version));
    }
    expect(
      exerciseDiscoveryCategory({ ...DISCOVERABLE[0], primaryFocus: "measured" })
    ).toBe("technique");
  });

  it("keeps a Shotmaking Exercise in Shotmaking", () => {
    const eightGuards = findExerciseVersion(
      EXERCISE_CATALOG,
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID
    );
    expect(exerciseDiscoveryCategory(eightGuards!)).toBe("shotmaking");
  });
});

describe("Exercises retired from discovery", () => {
  const retired = RETIRED_DISCOVERY_EXERCISE_IDS;

  it("names exactly the two Draw split-time variations", () => {
    expect(retired).toEqual(["draw-split-time", "draw-split-time-ladder"]);
    expect(isRetiredFromDiscovery("draw-split-time")).toBe(true);
    expect(isRetiredFromDiscovery("draws-into-house-outside-in")).toBe(false);
  });

  it("is absent from the discoverable list and from every search term that would reach it", () => {
    for (const exerciseId of retired) {
      expect(DISCOVERABLE.some((version) => version.exerciseId === exerciseId)).toBe(false);
    }
    for (const searchTerm of ["split time", "ladder", "Draw-Split", "Ziel-Split"]) {
      expect(
        filterExerciseVersions(DISCOVERABLE, {
          ...DEFAULT_EXERCISE_LIBRARY_FILTERS,
          searchTerm,
        }).map((version) => version.exerciseId)
      ).not.toEqual(expect.arrayContaining([...retired]));
    }
  });

  it("keeps its identity, current version, diagram and runner fully resolvable", () => {
    for (const exerciseId of retired) {
      expect(findExercise(EXERCISE_CATALOG, exerciseId)).toBeDefined();

      const current = resolveCurrentExerciseVersion(EXERCISE_CATALOG, exerciseId);
      expect(current).toBeDefined();
      expect(current?.primaryFocus).toBe("measured");
      // A saved plan step or an active run still routes to the same timing runner.
      expect(exerciseRunnerKind(EXERCISE_CATALOG, current!)).toBe("release-timing");
      expect(current?.diagram?.kind).toBe("attributed-source-image");

      // The version an older snapshot recorded is still byte-resolvable.
      const first = findExerciseVersion(EXERCISE_CATALOG, `${exerciseId}-v1`);
      expect(first).toMatchObject({ exerciseId, version: 1 });
    }
  });

  it("is the only difference between the current catalog and the discoverable list", () => {
    const current = listCurrentExerciseVersions(EXERCISE_CATALOG);
    expect(current).toHaveLength(41);
    expect(
      current
        .filter((version) => !DISCOVERABLE.includes(version))
        .map((version) => version.exerciseId)
    ).toEqual([...retired]);
  });
});
