// Fixture builders for Exercise Library domain tests. Deliberately independent
// of the production catalog: validation, versioning and query behaviour must be
// provable on content the tests fully control, including content the production
// catalog does not (and must not) contain — a restricted attributed source
// image, and an Exercise with two versions.
import {
  EXERCISE_CONTENT_SCHEMA_VERSION,
  EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION,
  EXERCISE_DIAGRAM_SCHEMA_VERSION,
  type Exercise,
  type ExerciseCatalogPackage,
  type ExerciseDiagram,
  type ExerciseVersion,
  type MeasurementProtocol,
} from "../types";

export const TEST_PROTOCOL_ID = "test-release-time";

export function buildTestProtocol(
  overrides: Partial<MeasurementProtocol> = {}
): MeasurementProtocol {
  return {
    id: TEST_PROTOCOL_ID,
    version: 1,
    name: "Test Release Time",
    metricType: "release-time",
    unit: "seconds",
    measurementMode: "back-hog",
    referencePoints: "Release time from the back line to the hog line.",
    allowedSources: ["manual"],
    guidance: "Use the same method for every shot.",
    target: null,
    ...overrides,
  };
}

export function buildTestStructuredDiagram(
  overrides: Partial<Extract<ExerciseDiagram, { kind: "structured-platform-diagram" }>> = {}
): ExerciseDiagram {
  return {
    kind: "structured-platform-diagram",
    id: "test-structured-diagram",
    schemaVersion: EXERCISE_DIAGRAM_SCHEMA_VERSION,
    coordinateSystem: "normalized-ice-sheet-v1",
    aspectRatio: 1.5,
    caption: "Test diagram caption.",
    accessibleSummary: "A test diagram showing a sheet, a line, a house and one stone.",
    elements: [
      { kind: "sheet", id: "sheet", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
      {
        kind: "line",
        id: "hog",
        from: { x: 0.2, y: 0 },
        to: { x: 0.2, y: 1 },
        style: "solid",
      },
      { kind: "house", id: "house", center: { x: 0.9, y: 0.5 }, radii: [0.2, 0.1] },
      { kind: "stone", id: "stone-1", at: { x: 0.4, y: 0.5 }, role: "delivered", sequenceLabel: "1" },
      {
        kind: "path",
        id: "shot-path",
        points: [
          { x: 0.05, y: 0.5 },
          { x: 0.4, y: 0.5 },
        ],
        style: "dashed",
      },
      {
        kind: "arrow",
        id: "direction",
        from: { x: 0.05, y: 0.2 },
        to: { x: 0.3, y: 0.2 },
        label: "Delivery",
      },
      {
        kind: "target-zone",
        id: "zone-1",
        from: { x: 0.3, y: 0.35 },
        to: { x: 0.5, y: 0.65 },
        sequenceStep: 1,
        label: "1",
      },
      { kind: "label", id: "note", at: { x: 0.5, y: 0.1 }, text: "Test label", anchor: "middle" },
    ],
    ...overrides,
  };
}

/** A restricted, attributed source image. Never added to the production catalog. */
export function buildTestSourceImageDiagram(
  overrides: Partial<Extract<ExerciseDiagram, { kind: "attributed-source-image" }>> = {}
): ExerciseDiagram {
  return {
    kind: "attributed-source-image",
    id: "test-source-image-diagram",
    caption: "Test source diagram.",
    accessibleSummary: "A restricted source diagram of the test exercise setup.",
    assetReference: { assetId: "test-restricted-diagram" },
    attribution: "Test Organisation, Test Collection, version 9.9.",
    sourceOrganization: "Test Organisation",
    sourceVersion: "9.9",
    distribution: {
      scope: "restricted-closed-beta",
      permittedAudience: "The named closed-beta team only.",
      publicDeliveryPermitted: false,
    },
    provenanceNote: "Retained for provenance; not delivered publicly.",
    ...overrides,
  };
}

export function buildTestVersion(overrides: Partial<ExerciseVersion> = {}): ExerciseVersion {
  return {
    id: "test-exercise-v1",
    exerciseId: "test-exercise",
    version: 1,
    contentSchemaVersion: EXERCISE_CONTENT_SCHEMA_VERSION,
    contentLanguage: "en",
    title: "Test Exercise",
    primaryFocus: "technique",
    primaryTrainingPurpose: "repeatability",
    additionalTrainingPurposes: [],
    goal: "Practise the test movement.",
    whyItMatters: "It keeps the test honest.",
    setupInstructions: [{ id: "setup-1", text: "Set up the test." }],
    executionInstructions: [{ id: "step-1", text: "Perform the test." }],
    guidance: {
      kind: "observation",
      observations: ["Look at the thing."],
      noScoringNote: "The app awards no score for this exercise.",
    },
    variations: [],
    participation: {
      supportedModes: ["solo", "team"],
      minTrainingAthletes: 1,
      maxTrainingAthletes: null,
      roles: [{ role: "delivering-athlete", requirement: "required" }],
      summary: "Usable Solo or in a Team.",
    },
    sweeping: {
      policy: "forbidden",
      allowedSweeperCounts: [0],
      note: "No sweeping in this test exercise.",
    },
    equipment: [{ id: "stones", label: "Curling stones", requirement: "required" }],
    compatibleMeasurementProtocols: [],
    source: {
      kind: "platform-curated",
      attribution: "Platform-curated test content.",
    },
    ...overrides,
  };
}

export function buildTestExercise(overrides: Partial<Exercise> = {}): Exercise {
  return { id: "test-exercise", currentVersionId: "test-exercise-v1", ...overrides };
}

export function buildTestPackage(
  overrides: Partial<ExerciseCatalogPackage> = {}
): ExerciseCatalogPackage {
  return {
    packageSchemaVersion: EXERCISE_CATALOG_PACKAGE_SCHEMA_VERSION,
    contentLanguage: "en",
    exercises: [buildTestExercise()],
    versions: [buildTestVersion()],
    measurementProtocols: [buildTestProtocol()],
    ...overrides,
  };
}

/**
 * The Stage A review case: one stable Exercise identity whose version 1 used a
 * restricted attributed source image, and whose version 2 replaced it with an
 * independently authored structured platform diagram. Version 2 is current;
 * version 1 must stay byte-identical and independently resolvable.
 */
export function buildTwoVersionDiagramReplacementPackage(): ExerciseCatalogPackage {
  const v1 = buildTestVersion({
    id: "test-exercise-v1",
    version: 1,
    diagram: buildTestSourceImageDiagram(),
  });
  const v2 = buildTestVersion({
    id: "test-exercise-v2",
    version: 2,
    diagram: buildTestStructuredDiagram(),
  });

  return buildTestPackage({
    exercises: [buildTestExercise({ currentVersionId: "test-exercise-v2" })],
    versions: [v1, v2],
  });
}
