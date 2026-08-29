import { describe, expect, it } from "vitest";
import {
  assertValidExerciseCatalogPackage,
  buildExerciseCatalogPackage,
  EXERCISE_CATALOG,
} from "../catalog";
import {
  EIGHT_GUARDS_EXERCISE_ID,
  EIGHT_GUARDS_V1_VERSION_ID,
  EIGHT_GUARDS_VERSION_ID,
  EIGHT_GUARDS_SOURCE_DIAGRAM_V3_VERSION_ID,
  EIGHT_GUARDS_SOURCE_DIAGRAM_V4_VERSION_ID,
  EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
  COME_AROUND_EXERCISE_ID,
  COME_AROUND_VERSION_ID,
  SOFT_TAKEOUT_EXERCISE_ID,
  SOFT_TAKEOUT_V1_VERSION_ID,
  SOFT_TAKEOUT_V2_VERSION_ID,
  SOFT_TAKEOUT_VERSION_ID,
  RELEASE_POINT_EXERCISE_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_GATES_EXERCISE_ID,
  RELEASE_GATES_V1_VERSION_ID,
  RELEASE_GATES_VERSION_ID,
  ROTATION_COUNT_EXERCISE_ID,
  ROTATION_COUNT_VERSION_ID,
  RELEASE_TIME_EXERCISE_ID,
  RELEASE_TIME_VERSION_ID,
} from "../content";
import { buildEightGuardsDiagram } from "../diagrams";
import {
  findExercise,
  findExerciseVersion,
  listCurrentExerciseVersions,
  listExerciseVersions,
  findMeasurementProtocol,
  exerciseRunnerKind,
  resolveCurrentExerciseVersion,
  resolvedMeasurementRunnerKind,
  resolveMeasurementProtocols,
} from "../lookup";
import {
  RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
  RELEASE_TIME_HOG_HOG_PROTOCOL_ID,
  ROTATION_COUNT_PROTOCOL_ID,
} from "../measurementProtocols";
import {
  EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION,
  EXERCISE_CONTENT_SCHEMA_VERSION,
} from "../types";
import { validateExerciseCatalogPackage } from "../validation";

describe("production Exercise catalog", () => {
  it("passes its own validation boundary", () => {
    expect(validateExerciseCatalogPackage(EXERCISE_CATALOG)).toEqual({ valid: true });
    expect(() => assertValidExerciseCatalogPackage(EXERCISE_CATALOG)).not.toThrow();
  });

  it("declares the exact package schema version and English content language", () => {
    expect(EXERCISE_CATALOG.packageSchemaVersion).toBe(
      EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION
    );
    expect(EXERCISE_CATALOG.contentLanguage).toBe("en");
  });

  it("contains the seven approved initial-test Exercises", () => {
    expect(EXERCISE_CATALOG.exercises.map((exercise) => exercise.id)).toEqual([
      RELEASE_POINT_EXERCISE_ID,
      EIGHT_GUARDS_EXERCISE_ID,
      RELEASE_TIME_EXERCISE_ID,
      RELEASE_GATES_EXERCISE_ID,
      ROTATION_COUNT_EXERCISE_ID,
      COME_AROUND_EXERCISE_ID,
      SOFT_TAKEOUT_EXERCISE_ID,
    ]);
    expect(EXERCISE_CATALOG.versions).toHaveLength(15);
  });

  it("uses unique stable Exercise ids and unique Exercise Version ids", () => {
    const exerciseIds = EXERCISE_CATALOG.exercises.map((exercise) => exercise.id);
    const versionIds = EXERCISE_CATALOG.versions.map((version) => version.id);

    expect(new Set(exerciseIds).size).toBe(exerciseIds.length);
    expect(new Set(versionIds).size).toBe(versionIds.length);
  });

  it("gives every Exercise Version the current content schema version and a positive version number", () => {
    for (const version of EXERCISE_CATALOG.versions) {
      expect(version.contentSchemaVersion).toBe(EXERCISE_CONTENT_SCHEMA_VERSION);
      expect(version.version).toBeGreaterThan(0);
    }
  });

  it("builds deterministically across independent calls", () => {
    expect(buildExerciseCatalogPackage()).toEqual(buildExerciseCatalogPackage());
    expect(buildEightGuardsDiagram()).toEqual(buildEightGuardsDiagram());
  });
});

describe("Exercise runner classification", () => {
  it("routes Release Time and Rotation Count by protocol semantics", () => {
    const releaseTime = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
    const rotationCount = findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID);
    if (!releaseTime || !rotationCount) throw new Error("Missing measured Exercise fixture");

    expect(exerciseRunnerKind(EXERCISE_CATALOG, releaseTime)).toBe("release-timing");
    expect(exerciseRunnerKind(EXERCISE_CATALOG, rotationCount)).toBe("exercise-execution");
  });

  it("fails closed for absent, mixed or multiple standalone protocols", () => {
    const releaseTime = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
    const rotationCount = findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID);
    if (!releaseTime || !rotationCount) throw new Error("Missing measured Exercise fixture");
    const releaseProtocols = resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      releaseTime.compatibleMeasurementProtocols
    );
    const rotationProtocols = resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      rotationCount.compatibleMeasurementProtocols
    );

    expect(resolvedMeasurementRunnerKind([])).toBe("unsupported");
    expect(resolvedMeasurementRunnerKind([
      rotationProtocols[0],
      rotationProtocols[0],
    ])).toBe("unsupported");
    expect(resolvedMeasurementRunnerKind([
      releaseProtocols[0],
      rotationProtocols[0],
    ])).toBe("unsupported");
  });
});

describe("runtime immutability", () => {
  it("is recursively frozen, not merely typed readonly", () => {
    expect(Object.isFrozen(EXERCISE_CATALOG)).toBe(true);
    expect(Object.isFrozen(EXERCISE_CATALOG.exercises)).toBe(true);
    expect(Object.isFrozen(EXERCISE_CATALOG.versions)).toBe(true);
    expect(Object.isFrozen(EXERCISE_CATALOG.measurementProtocols)).toBe(true);

    for (const version of EXERCISE_CATALOG.versions) {
      expect(Object.isFrozen(version)).toBe(true);
      expect(Object.isFrozen(version.setupInstructions)).toBe(true);
      expect(Object.isFrozen(version.executionInstructions)).toBe(true);
      expect(Object.isFrozen(version.guidance)).toBe(true);
      expect(Object.isFrozen(version.participation)).toBe(true);
      expect(Object.isFrozen(version.participation.roles)).toBe(true);
      expect(Object.isFrozen(version.sweeping)).toBe(true);
      expect(Object.isFrozen(version.sweeping.allowedSweeperCounts)).toBe(true);
      expect(Object.isFrozen(version.source)).toBe(true);
      for (const step of version.executionInstructions) {
        expect(Object.isFrozen(step)).toBe(true);
      }
    }
  });

  it("rejects a mutation attempt at any depth in strict mode", () => {
    const version = EXERCISE_CATALOG.versions[0];
    expect(() => {
      (version as { title: string }).title = "Rewritten";
    }).toThrow(TypeError);
    expect(() => {
      (version.setupInstructions as { length: number }).length = 0;
    }).toThrow(TypeError);
    expect(() => {
      (version.setupInstructions[0] as { text: string }).text = "Rewritten";
    }).toThrow(TypeError);
    expect(version.title).not.toBe("Rewritten");
  });

  it("keeps the deeply-nested structured diagram frozen too", () => {
    const guard = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
    expect(guard?.diagram?.kind).toBe("structured-platform-diagram");
    if (guard?.diagram?.kind !== "structured-platform-diagram") return;

    expect(Object.isFrozen(guard.diagram)).toBe(true);
    expect(Object.isFrozen(guard.diagram.elements)).toBe(true);
    for (const element of guard.diagram.elements) {
      expect(Object.isFrozen(element)).toBe(true);
    }
  });
});

describe("deterministic lookup", () => {
  it("resolves by stable Exercise id", () => {
    expect(findExercise(EXERCISE_CATALOG, EIGHT_GUARDS_EXERCISE_ID)?.currentVersionId).toBe(
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID
    );
    expect(findExercise(EXERCISE_CATALOG, "not-a-real-exercise")).toBeUndefined();
  });

  it("resolves by Exercise Version id", () => {
    expect(findExerciseVersion(EXERCISE_CATALOG, RELEASE_POINT_VERSION_ID)?.title).toBe(
      "Release Point"
    );
    expect(findExerciseVersion(EXERCISE_CATALOG, "not-a-real-version")).toBeUndefined();
  });

  it("resolves the current version for an Exercise", () => {
    expect(resolveCurrentExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_EXERCISE_ID)?.id).toBe(
      RELEASE_TIME_VERSION_ID
    );
    expect(
      resolveCurrentExerciseVersion(EXERCISE_CATALOG, "not-a-real-exercise")
    ).toBeUndefined();
  });

  it("lists current versions in catalog order, one per Exercise", () => {
    expect(listCurrentExerciseVersions(EXERCISE_CATALOG).map((version) => version.id)).toEqual([
      RELEASE_POINT_VERSION_ID,
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      RELEASE_TIME_VERSION_ID,
      RELEASE_GATES_VERSION_ID,
      ROTATION_COUNT_VERSION_ID,
      COME_AROUND_VERSION_ID,
      SOFT_TAKEOUT_VERSION_ID,
    ]);
  });

  it("lists every version of one Exercise, oldest first", () => {
    expect(
      listExerciseVersions(EXERCISE_CATALOG, RELEASE_POINT_EXERCISE_ID).map((v) => v.version)
    ).toEqual([1]);
    expect(
      listExerciseVersions(EXERCISE_CATALOG, EIGHT_GUARDS_EXERCISE_ID).map((v) => v.version)
    ).toEqual([1, 2, 3, 4, 5]);
    expect(listExerciseVersions(EXERCISE_CATALOG, "not-a-real-exercise")).toEqual([]);
  });
});

describe("Measurement Protocols", () => {
  it("defines both release-time protocols at version 1 and prescribes no target", () => {
    for (const id of [RELEASE_TIME_BACK_HOG_PROTOCOL_ID, RELEASE_TIME_HOG_HOG_PROTOCOL_ID]) {
      const protocol = findMeasurementProtocol(EXERCISE_CATALOG, id, 1);
      expect(protocol).toBeDefined();
      expect(protocol?.metricType).toBe("release-time");
      expect(protocol?.unit).toBe("seconds");
      expect(protocol?.target).toBeNull();
    }
  });

  it("reuses the existing Measurement Mode semantics rather than redefining them", () => {
    expect(
      findMeasurementProtocol(EXERCISE_CATALOG, RELEASE_TIME_BACK_HOG_PROTOCOL_ID, 1)
        ?.measurementMode
    ).toBe("back-hog");
    expect(
      findMeasurementProtocol(EXERCISE_CATALOG, RELEASE_TIME_HOG_HOG_PROTOCOL_ID, 1)
        ?.measurementMode
    ).toBe("hog-hog");
  });

  it("defines manual Rotation Count independently of release-time modes", () => {
    const protocol = findMeasurementProtocol(EXERCISE_CATALOG, ROTATION_COUNT_PROTOCOL_ID, 1);
    expect(protocol).toMatchObject({
      metricType: "rotation-count",
      unit: "rotations",
      allowedSources: ["manual"],
      target: null,
    });
    expect(protocol?.measurementMode).toBeUndefined();
    expect(protocol?.guidance).toContain("0.5");
  });

  it("claims no hardware capture support", () => {
    for (const protocol of EXERCISE_CATALOG.measurementProtocols) {
      expect(protocol.allowedSources).toEqual(["manual"]);
    }
  });

  it("resolves an Exercise Version's references in declaration order", () => {
    const releaseTime = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
    const resolved = resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      releaseTime?.compatibleMeasurementProtocols ?? []
    );
    expect(resolved.map((entry) => entry.protocol.id)).toEqual([
      RELEASE_TIME_BACK_HOG_PROTOCOL_ID,
      RELEASE_TIME_HOG_HOG_PROTOCOL_ID,
    ]);
  });
});

describe("curated Stage A content", () => {
  it("Release Point is an unscored Technique Exercise", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, RELEASE_POINT_VERSION_ID);
    expect(version?.primaryFocus).toBe("technique");
    expect(version?.primaryTrainingPurpose).toBe("release-location-control");
    expect(version?.additionalTrainingPurposes).toEqual(["repeatability"]);
    expect(version?.guidance.kind).toBe("observation");
    expect(version?.diagram).toBeUndefined();
    expect(version?.difficulty).toBeUndefined();
    expect(version?.sourceReferenceGoal).toBeUndefined();
  });

  it("Eight Guards is a Shotmaking Guard Exercise with generic 0-4 guidance and a non-evaluated source goal", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
    expect(version?.primaryFocus).toBe("shotmaking");
    expect(version?.shotFamily).toBe("guard");
    expect(version?.difficulty).toEqual({ kind: "level", level: 6 });
    expect(version?.primaryTrainingPurpose).toBe("weight-control");
    expect(version?.additionalTrainingPurposes).toEqual([
      "line-control",
      "progressive-distance-control",
    ]);
    expect(version?.sweeping.policy).toBe("forbidden");
    expect(version?.recommendedVolume).toEqual({ kind: "stone-count", stones: 8 });
    expect(version?.variations).toHaveLength(4);

    expect(version?.guidance.kind).toBe("generic-shotmaking-score");
    if (version?.guidance.kind !== "generic-shotmaking-score") return;
    expect(version.guidance.scale).toEqual([
      { score: 0, percentage: 0 },
      { score: 1, percentage: 25 },
      { score: 2, percentage: 50 },
      { score: 3, percentage: 75 },
      { score: 4, percentage: 100 },
    ]);
    expect(version.guidance.evaluationBasis).toBe("team-defined-unstructured");

    expect(version.sourceReferenceGoal?.evaluated).toBe(false);
    expect(version.sourceReferenceGoal?.text).toContain("6 of 8 stones");
    expect(version.sourceReferenceGoal?.text).toContain("not evaluated by the app");
    expect(version.compatibleMeasurementProtocols).toEqual([{
      protocolId: ROTATION_COUNT_PROTOCOL_ID,
      protocolVersion: 1,
      requirement: "optional",
    }]);
  });

  it("retains each Eight Guards version while v4 fixes the overlay and v5 clears public delivery", () => {
    const v1 = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_V1_VERSION_ID);
    const v2 = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
    const v3 = findExerciseVersion(
      EXERCISE_CATALOG,
      EIGHT_GUARDS_SOURCE_DIAGRAM_V3_VERSION_ID
    );
    const v4 = findExerciseVersion(
      EXERCISE_CATALOG,
      EIGHT_GUARDS_SOURCE_DIAGRAM_V4_VERSION_ID
    );
    const v5 = findExerciseVersion(
      EXERCISE_CATALOG,
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID
    );
    expect(v1).toMatchObject({ version: 1, compatibleMeasurementProtocols: [] });
    expect(v2).toMatchObject({ version: 2 });
    expect(v2?.diagram?.kind).toBe("structured-platform-diagram");
    expect(v3).toMatchObject({ version: 3 });
    expect(v3?.diagram?.kind).toBe("attributed-source-image");
    expect(v4).toMatchObject({ version: 4 });
    expect(v4?.diagram?.kind).toBe("attributed-source-image");
    if (v4?.diagram?.kind === "attributed-source-image") {
      expect(v4.diagram.localizedTextOverlays).toEqual([
        expect.objectContaining({
          id: "move-stone-aside",
          text: "After each stone stops, move it aside as a marker.",
          y: 0.748,
        }),
      ]);
    }
    expect(v5).toMatchObject({ version: 5 });
    expect(v5?.diagram?.kind).toBe("attributed-source-image");
    if (v5?.diagram?.kind === "attributed-source-image") {
      expect(v5.diagram.distribution).toMatchObject({
        scope: "public",
        publicDeliveryPermitted: true,
      });
      expect(v5.diagram.localizedTextOverlays).toEqual(v4?.diagram?.kind === "attributed-source-image"
        ? v4.diagram.localizedTextOverlays
        : undefined);
    }
    expect(findExercise(EXERCISE_CATALOG, EIGHT_GUARDS_EXERCISE_ID)?.currentVersionId).toBe(v5?.id);
    expect(findExerciseVersion(EXERCISE_CATALOG, SOFT_TAKEOUT_V1_VERSION_ID)).toMatchObject({ version: 1 });
    expect(findExerciseVersion(EXERCISE_CATALOG, SOFT_TAKEOUT_V2_VERSION_ID)).toMatchObject({ version: 2 });
    expect(findExerciseVersion(EXERCISE_CATALOG, SOFT_TAKEOUT_VERSION_ID)).toMatchObject({ version: 3 });
  });

  it("Eight Guards carries visible English Swiss Curling attribution and an independently drawn diagram", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
    expect(version?.source.kind).toBe("external-collection");
    expect(version?.source.organization).toBe("Swiss Curling");
    expect(version?.source.collectionVersion).toBe("2.0");
    expect(version?.source.sourceExerciseReference).toBe("Guard Exercise 10");
    expect(version?.source.attribution).toContain("Swiss Curling");
    expect(version?.diagram?.kind).toBe("structured-platform-diagram");
  });

  it("Release Time is a standalone Measured Exercise, distinct from the Assessment, with no prescribed target", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID);
    expect(version?.primaryFocus).toBe("measured");
    expect(version?.primaryTrainingPurpose).toBe("repeatability");
    expect(version?.additionalTrainingPurposes).toEqual(["weight-control-awareness"]);
    expect(version?.guidance.kind).toBe("observation");
    if (version?.guidance.kind !== "observation") return;

    const guidanceText = [...version.guidance.observations, version.guidance.noScoringNote].join(
      " "
    );
    expect(guidanceText).toContain("not the Release Time Core Assessment");
    expect(guidanceText).toContain("prescribes no target time or accuracy tolerance");
    expect(version.compatibleMeasurementProtocols).toHaveLength(2);
  });

  it("Release Gates is an unscored Technique Exercise with a schematic two-gate diagram", () => {
    expect(findExerciseVersion(EXERCISE_CATALOG, RELEASE_GATES_V1_VERSION_ID)).toMatchObject({
      version: 1,
      diagram: { id: "release-gates-diagram-v1" },
    });
    const version = findExerciseVersion(EXERCISE_CATALOG, RELEASE_GATES_VERSION_ID);
    expect(version).toMatchObject({
      version: 2,
      primaryFocus: "technique",
      primaryTrainingPurpose: "line-control",
      diagram: { id: "release-gates-diagram-v2" },
    });
    expect(version?.difficulty).toBeUndefined();
    expect(version?.guidance.kind).toBe("observation");
    expect(version?.diagram?.kind).toBe("structured-platform-diagram");
    expect(version?.source.nonDisplayedSourceMetadata?.originalTitles).toEqual(["Törli"]);
  });

  it("Rotation Count is a target-free standalone Measured Exercise with one required protocol", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, ROTATION_COUNT_VERSION_ID);
    expect(version).toMatchObject({
      primaryFocus: "measured",
      primaryTrainingPurpose: "rotation-control",
      compatibleMeasurementProtocols: [{
        protocolId: ROTATION_COUNT_PROTOCOL_ID,
        protocolVersion: 1,
        requirement: "required",
      }],
    });
    expect(version?.guidance.kind).toBe("observation");
    expect(version?.participation.supportedModes).toEqual(["solo", "team"]);
  });

  it("publishes the two remaining Swiss Curling Shotmaking Exercises with generic Team scoring only", () => {
    for (const [versionId, expected] of [
      [
        COME_AROUND_VERSION_ID,
        { family: "draw", level: 3, page: 25, reference: "6 of 8" },
      ],
      [
        SOFT_TAKEOUT_VERSION_ID,
        { family: "soft-take-out", level: 4, page: 37, reference: "3 of 4" },
      ],
    ] as const) {
      const version = findExerciseVersion(EXERCISE_CATALOG, versionId);
      expect(version).toMatchObject({
        primaryFocus: "shotmaking",
        shotFamily: expected.family,
        difficulty: { kind: "level", level: expected.level },
        sweeping: { policy: "forbidden", allowedSweeperCounts: [0] },
        source: {
          kind: "external-collection",
          organization: "Swiss Curling",
          sourcePage: expected.page,
        },
      });
      expect(version?.guidance.kind).toBe("generic-shotmaking-score");
      if (version?.guidance.kind !== "generic-shotmaking-score") continue;
      expect(version.guidance.scale.map((entry) => entry.score)).toEqual([0, 1, 2, 3, 4]);
      expect(version.guidance.evaluationBasis).toBe("team-defined-unstructured");
      expect(version.sourceReferenceGoal).toMatchObject({ evaluated: false });
      expect(version.sourceReferenceGoal?.text).toContain(expected.reference);
      expect(version.compatibleMeasurementProtocols).toEqual([{
        protocolId: ROTATION_COUNT_PROTOCOL_ID,
        protocolVersion: 1,
        requirement: "optional",
      }]);
      expect(version.diagram?.kind).toBe("attributed-source-image");
      if (version.diagram?.kind !== "attributed-source-image") continue;
      expect(version.diagram.distribution).toMatchObject({
        scope: "public",
        publicDeliveryPermitted: true,
      });
    }
  });

  it("uses publicly cleared source images for exactly the three current Shotmaking Exercises", () => {
    const sourceImages = listCurrentExerciseVersions(EXERCISE_CATALOG).filter(
      (version) => version.diagram?.kind === "attributed-source-image"
    );
    expect(sourceImages.map((version) => version.id)).toEqual([
      EIGHT_GUARDS_SOURCE_DIAGRAM_VERSION_ID,
      COME_AROUND_VERSION_ID,
      SOFT_TAKEOUT_VERSION_ID,
    ]);
    for (const version of sourceImages) {
      expect(version.source.kind).toBe("external-collection");
      expect(version.source.organization).toBe("Swiss Curling");
      if (version.diagram?.kind !== "attributed-source-image") continue;
      expect(version.diagram.distribution).toMatchObject({
        scope: "public",
        publicDeliveryPermitted: true,
      });
      for (const overlay of version.diagram.localizedTextOverlays ?? []) {
        expect(overlay.text).not.toMatch(/Übung|Stein|Zielzone/);
      }
    }
  });

  it("keeps every German source title out of displayed content", () => {
    const germanPattern = /Übung|Steine|immer länger/;

    for (const version of EXERCISE_CATALOG.versions) {
      const displayed = [
        version.title,
        version.goal,
        version.whyItMatters,
        version.participation.summary,
        version.sweeping.note,
        version.source.attribution,
        version.source.collectionName ?? "",
        version.source.sourceExerciseReference ?? "",
        version.source.provenanceNote ?? "",
        version.sourceReferenceGoal?.text ?? "",
        ...version.setupInstructions.map((step) => step.text),
        ...version.executionInstructions.map((step) => step.text),
        ...version.variations.map((variation) => variation.label),
        ...version.equipment.map((item) => `${item.label} ${item.note ?? ""}`),
        ...version.participation.roles.map((role) => role.note ?? ""),
        version.diagram ? `${version.diagram.caption} ${version.diagram.accessibleSummary}` : "",
        ...(version.diagram?.kind === "attributed-source-image"
          ? (version.diagram.localizedTextOverlays ?? []).map((overlay) => overlay.text)
          : []),
      ].join(" ");

      expect(displayed).not.toMatch(germanPattern);
    }
  });

  it("retains the German source title only as non-displayed source metadata", () => {
    const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID);
    expect(version?.source.nonDisplayedSourceMetadata?.originalTitles).toEqual([
      "Guard Übung 10: 8 Steine Guard, immer länger",
    ]);
  });
});
