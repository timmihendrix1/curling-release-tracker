import { describe, expect, it } from "vitest";
import { EXERCISE_CATALOG } from "../catalog";
import {
  EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
  COME_AROUND_VERSION_ID,
  SOFT_TAKEOUT_VERSION_ID,
  RELEASE_GATES_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
  ROTATION_COUNT_VERSION_ID,
} from "../content";
import { listDiscoverableExerciseVersions } from "../discovery";
import { SWISS_CURLING_CORPUS_VERSION_IDS } from "../swissCurlingCorpus";
import {
  areDefaultExerciseLibraryFilters,
  describeActiveExerciseLibraryFilters,
  availableExerciseDifficultyFilters,
  availableExerciseDiscoveryCategories,
  availableExerciseParticipationModes,
  availableExerciseShotFamilies,
  availableExerciseSweepingPolicies,
  DEFAULT_EXERCISE_LIBRARY_FILTERS,
  filterExerciseVersions,
  groupExerciseVersionsByCategory,
  matchesExerciseSearchTerm,
  type ExerciseLibraryFilters,
} from "../query";
import { buildTestVersion } from "./testHelpers";

// Discovery is what the Library offers, so the retired Draw Split Time pair is absent
// throughout this suite; their continued resolvability is covered in discovery.test.ts.
const CURRENT = listDiscoverableExerciseVersions(EXERCISE_CATALOG);
const RETIRED_IDS = ["draw-split-time-v2", "draw-split-time-ladder-v2"];
const CORPUS_IDS = SWISS_CURLING_CORPUS_VERSION_IDS.filter(
  (id) => !RETIRED_IDS.includes(id)
);
const SOURCE_VERSION_IDS = [
  EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
  COME_AROUND_VERSION_ID,
  SOFT_TAKEOUT_VERSION_ID,
  ...CORPUS_IDS,
];

function filters(overrides: Partial<ExerciseLibraryFilters> = {}): ExerciseLibraryFilters {
  return { ...DEFAULT_EXERCISE_LIBRARY_FILTERS, ...overrides };
}

function ids(versions: { id: string }[]): string[] {
  return versions.map((version) => version.id);
}

describe("default filters", () => {
  it("return every current Exercise Version, in catalog order", () => {
    expect(ids(filterExerciseVersions(CURRENT, filters()))).toEqual([
      RELEASE_POINT_VERSION_ID,
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      RELEASE_TIME_VERSION_ID,
      RELEASE_GATES_VERSION_ID,
      ROTATION_COUNT_VERSION_ID,
      COME_AROUND_VERSION_ID,
      SOFT_TAKEOUT_VERSION_ID,
      ...CORPUS_IDS,
    ]);
  });

  it("are recognised as the unfiltered state", () => {
    expect(areDefaultExerciseLibraryFilters(DEFAULT_EXERCISE_LIBRARY_FILTERS)).toBe(true);
    expect(areDefaultExerciseLibraryFilters(filters({ searchTerm: "  " }))).toBe(true);
    expect(areDefaultExerciseLibraryFilters(filters({ searchTerm: "guard" }))).toBe(false);
    expect(areDefaultExerciseLibraryFilters(filters({ category: "technique" }))).toBe(false);
    expect(areDefaultExerciseLibraryFilters(filters({ shotFamily: "guard" }))).toBe(false);
    expect(areDefaultExerciseLibraryFilters(filters({ participationMode: "solo" }))).toBe(false);
    expect(areDefaultExerciseLibraryFilters(filters({ sweeping: "forbidden" }))).toBe(false);
    expect(
      areDefaultExerciseLibraryFilters(filters({ difficulty: { kind: "unrated" } }))
    ).toBe(false);
  });
});

describe("classification filters", () => {
  it("filters by discovery category, with Release Time and Rotation Count under Technique", () => {
    expect(ids(filterExerciseVersions(CURRENT, filters({ category: "technique" })))).toEqual([
      RELEASE_POINT_VERSION_ID,
      RELEASE_TIME_VERSION_ID,
      RELEASE_GATES_VERSION_ID,
      ROTATION_COUNT_VERSION_ID,
    ]);
    expect(ids(filterExerciseVersions(CURRENT, filters({ category: "shotmaking" })))).toEqual([
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      COME_AROUND_VERSION_ID,
      SOFT_TAKEOUT_VERSION_ID,
      ...CORPUS_IDS,
    ]);
  });

  it("filters by Shot Family, excluding Exercises that declare none", () => {
    const guards = ids(filterExerciseVersions(CURRENT, filters({ shotFamily: "guard" })));
    expect(guards).toHaveLength(7);
    expect(guards).toContain(EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID);

    const draws = ids(filterExerciseVersions(CURRENT, filters({ shotFamily: "draw" })));
    expect(draws).toContain(COME_AROUND_VERSION_ID);
    expect(draws).toContain("draws-into-house-outside-in-v2");
  });

  it("filters by Sweeper requirement", () => {
    expect(ids(filterExerciseVersions(CURRENT, filters({ sweeping: "forbidden" })))).toEqual([
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      COME_AROUND_VERSION_ID,
      SOFT_TAKEOUT_VERSION_ID,
      ...CORPUS_IDS,
    ]);
    expect(ids(filterExerciseVersions(CURRENT, filters({ sweeping: "optional" })))).toEqual([
      RELEASE_POINT_VERSION_ID,
      RELEASE_TIME_VERSION_ID,
      RELEASE_GATES_VERSION_ID,
      ROTATION_COUNT_VERSION_ID,
    ]);
    expect(filterExerciseVersions(CURRENT, filters({ sweeping: "required" }))).toEqual([]);
  });

  it("filters by Solo/Team suitability", () => {
    expect(ids(filterExerciseVersions(CURRENT, filters({ participationMode: "solo" })))).toEqual([
      RELEASE_POINT_VERSION_ID,
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      RELEASE_TIME_VERSION_ID,
      RELEASE_GATES_VERSION_ID,
      ROTATION_COUNT_VERSION_ID,
      COME_AROUND_VERSION_ID,
      SOFT_TAKEOUT_VERSION_ID,
      ...CORPUS_IDS,
    ]);

    const teamOnly = buildTestVersion({
      id: "team-only-v1",
      participation: {
        ...buildTestVersion().participation,
        supportedModes: ["team"],
      },
    });
    expect(
      ids(filterExerciseVersions([...CURRENT, teamOnly], filters({ participationMode: "solo" })))
    ).not.toContain("team-only-v1");
    expect(
      ids(filterExerciseVersions([...CURRENT, teamOnly], filters({ participationMode: "team" })))
    ).toContain("team-only-v1");
  });

  it("filters by difficulty level and by unrated", () => {
    const levelSix = ids(
      filterExerciseVersions(CURRENT, filters({ difficulty: { kind: "level", level: 6 } }))
    );
    expect(levelSix).toHaveLength(7);
    expect(levelSix).toContain(EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID);
    expect(levelSix).not.toContain("draw-split-time-ladder-v2");
    expect(
      ids(filterExerciseVersions(CURRENT, filters({ difficulty: { kind: "unrated" } })))
    ).toEqual([
      RELEASE_POINT_VERSION_ID,
      RELEASE_TIME_VERSION_ID,
      RELEASE_GATES_VERSION_ID,
      ROTATION_COUNT_VERSION_ID,
    ]);
    expect(
      ids(filterExerciseVersions(CURRENT, filters({ difficulty: { kind: "level", level: 3 } })))
    ).toEqual(
      expect.arrayContaining([
        COME_AROUND_VERSION_ID,
        "guards-in-left-mixed-doubles-zone-v2",
      ])
    );
  });

  it("matches a level inside a bounded difficulty range", () => {
    const ranged = buildTestVersion({
      id: "ranged-v1",
      difficulty: { kind: "range", min: 2, max: 4 },
    });
    for (const level of [2, 3, 4]) {
      expect(
        ids(filterExerciseVersions([ranged], filters({ difficulty: { kind: "level", level } })))
      ).toEqual(["ranged-v1"]);
    }
    expect(
      filterExerciseVersions([ranged], filters({ difficulty: { kind: "level", level: 5 } }))
    ).toEqual([]);
    expect(
      filterExerciseVersions([ranged], filters({ difficulty: { kind: "unrated" } }))
    ).toEqual([]);
  });

  it("combines filters conjunctively", () => {
    expect(
      filterExerciseVersions(
        CURRENT,
        filters({ category: "technique", difficulty: { kind: "level", level: 6 } })
      )
    ).toEqual([]);
    expect(
      ids(
        filterExerciseVersions(
          CURRENT,
          filters({ category: "shotmaking", sweeping: "forbidden", participationMode: "team" })
        )
      )
    ).toEqual([
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      COME_AROUND_VERSION_ID,
      SOFT_TAKEOUT_VERSION_ID,
      ...CORPUS_IDS,
    ]);
  });
});

describe("Library category grouping", () => {
  it("groups into exactly two categories, in the stable Technique then Shotmaking order", () => {
    const groups = groupExerciseVersionsByCategory(CURRENT);

    expect(groups.map((group) => group.category)).toEqual(["technique", "shotmaking"]);
    expect(groups.map((group) => ids(group.versions))).toEqual([
      [
        RELEASE_POINT_VERSION_ID,
        RELEASE_TIME_VERSION_ID,
        RELEASE_GATES_VERSION_ID,
        ROTATION_COUNT_VERSION_ID,
      ],
      [
        EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
        COME_AROUND_VERSION_ID,
        SOFT_TAKEOUT_VERSION_ID,
        ...CORPUS_IDS,
      ],
    ]);
    expect(groups[0].versions).toHaveLength(4);
    expect(groups[1].versions).toHaveLength(35);
  });

  it("omits empty categories without changing the order inside a category", () => {
    const filtered = filterExerciseVersions(CURRENT, filters({ category: "shotmaking" }));
    expect(groupExerciseVersionsByCategory(filtered)).toEqual([
      { category: "shotmaking", versions: filtered },
    ]);
    expect(groupExerciseVersionsByCategory([])).toEqual([]);
  });
});

describe("text search", () => {
  it("matches on title, goal and instruction text", () => {
    const guards = ids(filterExerciseVersions(CURRENT, filters({ searchTerm: "guards" })));
    expect(guards).toHaveLength(7);
    expect(guards).toContain(EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID);

    const hogLine = ids(filterExerciseVersions(CURRENT, filters({ searchTerm: "hog line" })));
    expect(hogLine).toEqual(
      expect.arrayContaining([RELEASE_POINT_VERSION_ID, EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID])
    );
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(
      ids(filterExerciseVersions(CURRENT, filters({ searchTerm: "  RELEASE LOCATION " })))
    ).toEqual([RELEASE_POINT_VERSION_ID, RELEASE_GATES_VERSION_ID]);
  });

  it("requires every term to match", () => {
    expect(ids(filterExerciseVersions(CURRENT, filters({ searchTerm: "release time" })))).toEqual([
      RELEASE_TIME_VERSION_ID,
    ]);
    expect(filterExerciseVersions(CURRENT, filters({ searchTerm: "guard rotation" }))).toEqual([]);
  });

  it("matches a non-displayed source alias, including without its diacritics", () => {
    for (const term of ["Übung", "ubung"]) {
      expect(ids(filterExerciseVersions(CURRENT, filters({ searchTerm: term })))).toEqual(
        SOURCE_VERSION_IDS
      );
    }
    expect(ids(filterExerciseVersions(CURRENT, filters({ searchTerm: "8 Steine" })))).toEqual([
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      "eight-guards-progressively-shorter-v2",
    ]);
  });

  it("matches on visible source attribution", () => {
    expect(ids(filterExerciseVersions(CURRENT, filters({ searchTerm: "swiss curling" })))).toEqual(
      SOURCE_VERSION_IDS
    );
  });

  it("returns nothing for a term no Exercise carries", () => {
    expect(filterExerciseVersions(CURRENT, filters({ searchTerm: "zamboni" }))).toEqual([]);
  });

  it("treats an empty term as no search", () => {
    const version = CURRENT[0];
    expect(matchesExerciseSearchTerm(version, "")).toBe(true);
    expect(matchesExerciseSearchTerm(version, "   ")).toBe(true);
  });
});

describe("active advanced-filter description", () => {
  it("is empty while nothing advanced is selected", () => {
    expect(describeActiveExerciseLibraryFilters(filters())).toEqual([]);
    // A search term stays visible in its own field, so it is deliberately not
    // repeated in the collapsed advanced-filter summary.
    expect(describeActiveExerciseLibraryFilters(filters({ searchTerm: "guard" }))).toEqual([]);
  });

  it("describes each selected filter with an English label and value", () => {
    expect(describeActiveExerciseLibraryFilters(filters({ category: "technique" }))).toEqual([
      { id: "category", label: "Category", value: "Technique" },
    ]);
    expect(
      describeActiveExerciseLibraryFilters(filters({ difficulty: { kind: "level", level: 6 } }))
    ).toEqual([{ id: "difficulty", label: "Difficulty", value: "Level 6" }]);
    expect(
      describeActiveExerciseLibraryFilters(filters({ difficulty: { kind: "unrated" } }))
    ).toEqual([{ id: "difficulty", label: "Difficulty", value: "Not rated" }]);
    expect(describeActiveExerciseLibraryFilters(filters({ participationMode: "team" }))).toEqual([
      { id: "participationMode", label: "Solo or Team", value: "Team" },
    ]);
    expect(describeActiveExerciseLibraryFilters(filters({ sweeping: "forbidden" }))).toEqual([
      { id: "sweeping", label: "Sweepers", value: "No sweeping" },
    ]);
    expect(describeActiveExerciseLibraryFilters(filters({ shotFamily: "guard" }))).toEqual([
      { id: "shotFamily", label: "Shot Family", value: "Guard" },
    ]);
  });

  it("lists several selections in control order", () => {
    expect(
      describeActiveExerciseLibraryFilters(
        filters({
          shotFamily: "guard",
          category: "shotmaking",
          sweeping: "forbidden",
          difficulty: { kind: "level", level: 6 },
        })
      ).map((entry) => entry.id)
    ).toEqual(["category", "difficulty", "sweeping", "shotFamily"]);
  });
});

describe("available filter options are derived from the catalog", () => {
  it("lists only the categories, families, modes and policies actually present", () => {
    expect(availableExerciseDiscoveryCategories(CURRENT)).toEqual([
      "technique",
      "shotmaking",
    ]);
    expect(availableExerciseShotFamilies(CURRENT)).toEqual([
      "guard",
      "draw",
      "soft-take-out",
      "sequence",
      "freeze",
    ]);
    expect(availableExerciseParticipationModes(CURRENT)).toEqual(["solo", "team"]);
    expect(availableExerciseSweepingPolicies(CURRENT)).toEqual(["optional", "forbidden"]);
  });

  it("lists the difficulty levels present plus an unrated option", () => {
    expect(availableExerciseDifficultyFilters(CURRENT)).toEqual([
      { kind: "level", level: 1 },
      { kind: "level", level: 2 },
      { kind: "level", level: 3 },
      { kind: "level", level: 4 },
      { kind: "level", level: 5 },
      { kind: "level", level: 6 },
      { kind: "unrated" },
    ]);
  });

  it("expands a bounded difficulty range into its individual levels", () => {
    expect(
      availableExerciseDifficultyFilters([
        buildTestVersion({ difficulty: { kind: "range", min: 2, max: 4 } }),
      ])
    ).toEqual([
      { kind: "level", level: 2 },
      { kind: "level", level: 3 },
      { kind: "level", level: 4 },
    ]);
  });

  it("omits the unrated option when every Exercise has a difficulty", () => {
    expect(
      availableExerciseDifficultyFilters([
        buildTestVersion({ difficulty: { kind: "level", level: 1 } }),
      ])
    ).toEqual([{ kind: "level", level: 1 }]);
  });

  it("returns empty option lists for an empty catalog", () => {
    expect(availableExerciseDiscoveryCategories([])).toEqual([]);
    expect(availableExerciseShotFamilies([])).toEqual([]);
    expect(availableExerciseParticipationModes([])).toEqual([]);
    expect(availableExerciseSweepingPolicies([])).toEqual([]);
    expect(availableExerciseDifficultyFilters([])).toEqual([]);
  });
});
