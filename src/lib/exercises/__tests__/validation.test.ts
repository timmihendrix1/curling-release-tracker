import { describe, expect, it } from "vitest";
import type { ExerciseCatalogIssueCode } from "../errors";
import type { ExerciseCatalogPackage } from "../types";
import { validateExerciseCatalogPackage } from "../validation";
import {
  buildTestExercise,
  buildTestPackage,
  buildTestProtocol,
  buildTestSourceImageDiagram,
  buildTestStructuredDiagram,
  buildTestVersion,
  TEST_PROTOCOL_ID,
} from "./testHelpers";

/** Asserts the package is rejected, and that the rejection carries the expected code. */
function expectRejected(pkg: ExerciseCatalogPackage, code: ExerciseCatalogIssueCode): void {
  const result = validateExerciseCatalogPackage(pkg);
  expect(result.valid).toBe(false);
  if (result.valid) return;
  expect(result.issues.map((issue) => issue.code)).toContain(code);
  for (const issue of result.issues) {
    expect(issue.message.length).toBeGreaterThan(0);
  }
}

describe("baseline fixture", () => {
  it("accepts a valid minimal package", () => {
    expect(validateExerciseCatalogPackage(buildTestPackage())).toEqual({ valid: true });
  });

  it("accepts a structured diagram exercising every supported element kind", () => {
    expect(
      validateExerciseCatalogPackage(
        buildTestPackage({
          versions: [buildTestVersion({ diagram: buildTestStructuredDiagram() })],
        })
      )
    ).toEqual({ valid: true });
  });

  it("accepts a complete restricted attributed source image", () => {
    expect(
      validateExerciseCatalogPackage(
        buildTestPackage({
          versions: [buildTestVersion({ diagram: buildTestSourceImageDiagram() })],
        })
      )
    ).toEqual({ valid: true });
  });
});

describe("package level", () => {
  it("rejects a non-object package", () => {
    expectRejected(null as unknown as ExerciseCatalogPackage, "missing_required_content");
  });

  it("rejects an unknown package schema version rather than guess-migrating it", () => {
    expectRejected(
      buildTestPackage({ packageSchemaVersion: 2 }),
      "invalid_package_schema_version"
    );
    expectRejected(
      buildTestPackage({ packageSchemaVersion: 0 }),
      "invalid_package_schema_version"
    );
  });

  it("rejects an unsupported package content language", () => {
    expectRejected(
      buildTestPackage({ contentLanguage: "de" as unknown as "en" }),
      "unsupported_content_language"
    );
  });

  it("rejects missing collections", () => {
    expectRejected(
      buildTestPackage({ versions: undefined as unknown as [] }),
      "missing_required_content"
    );
  });
});

describe("identity and versioning", () => {
  it("rejects a duplicate stable Exercise id", () => {
    expectRejected(
      buildTestPackage({ exercises: [buildTestExercise(), buildTestExercise()] }),
      "duplicate_exercise_id"
    );
  });

  it("rejects a duplicate Exercise Version id", () => {
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion(), buildTestVersion()] }),
      "duplicate_exercise_version_id"
    );
  });

  it("rejects two versions of one Exercise sharing a version number", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ id: "test-exercise-a" }),
          buildTestVersion({ id: "test-exercise-b" }),
        ],
      }),
      "duplicate_exercise_version_number"
    );
  });

  it("rejects a non-positive or non-integer version number", () => {
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ version: 0 })] }),
      "invalid_version_number"
    );
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ version: -1 })] }),
      "invalid_version_number"
    );
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ version: 1.5 })] }),
      "invalid_version_number"
    );
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ version: Number.NaN })] }),
      "invalid_version_number"
    );
  });

  it("rejects an unknown content schema version", () => {
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ contentSchemaVersion: 2 })] }),
      "invalid_content_schema_version"
    );
  });

  it("rejects an Exercise whose current version does not exist", () => {
    expectRejected(
      buildTestPackage({
        exercises: [buildTestExercise({ currentVersionId: "missing-version" })],
      }),
      "missing_current_version"
    );
  });

  it("rejects an Exercise with no named current version", () => {
    expectRejected(
      buildTestPackage({ exercises: [buildTestExercise({ currentVersionId: "" })] }),
      "missing_current_version"
    );
  });

  it("rejects a current version that belongs to another Exercise", () => {
    expectRejected(
      buildTestPackage({
        exercises: [
          buildTestExercise({ id: "exercise-a", currentVersionId: "exercise-b-v1" }),
          buildTestExercise({ id: "exercise-b", currentVersionId: "exercise-b-v1" }),
        ],
        versions: [buildTestVersion({ id: "exercise-b-v1", exerciseId: "exercise-b" })],
      }),
      "current_version_belongs_to_other_exercise"
    );
  });

  it("rejects a version pointing at an unknown Exercise identity", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ exerciseId: "not-a-real-exercise" })],
      }),
      "version_references_unknown_exercise"
    );
  });

  it("rejects an Exercise identity with no versions at all", () => {
    expectRejected(
      buildTestPackage({
        exercises: [buildTestExercise(), buildTestExercise({ id: "orphan", currentVersionId: "orphan-v1" })],
      }),
      "exercise_has_no_versions"
    );
  });

  it("rejects an unsupported Exercise Version content language", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ contentLanguage: "de" as unknown as "en" })],
      }),
      "unsupported_content_language"
    );
  });
});

describe("required content", () => {
  it("rejects a missing title, goal or rationale", () => {
    for (const field of ["title", "goal", "whyItMatters"] as const) {
      expectRejected(
        buildTestPackage({ versions: [buildTestVersion({ [field]: "  " })] }),
        "missing_required_content"
      );
    }
  });

  it("rejects empty setup or execution instructions", () => {
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ setupInstructions: [] })] }),
      "missing_required_content"
    );
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ executionInstructions: [] })] }),
      "missing_required_content"
    );
  });

  it("rejects an instruction step with no text and a duplicated step id", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ executionInstructions: [{ id: "step-1", text: "" }] })],
      }),
      "missing_required_content"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            executionInstructions: [
              { id: "step-1", text: "One." },
              { id: "step-1", text: "Two." },
            ],
          }),
        ],
      }),
      "missing_required_content"
    );
  });

  it("rejects a variation or equipment item with no label", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ variations: [{ id: "v", label: "" }] })],
      }),
      "missing_required_content"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ equipment: [{ id: "e", label: "", requirement: "required" }] }),
        ],
      }),
      "missing_required_content"
    );
  });
});

describe("classification", () => {
  it("rejects an invalid Primary Exercise Focus", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ primaryFocus: "consistency" as never })],
      }),
      "invalid_classification"
    );
  });

  it("rejects an invalid Shot Family and an invalid Training Purpose", () => {
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ shotFamily: "hammer" as never })] }),
      "invalid_classification"
    );
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ primaryTrainingPurpose: "vibes" as never })],
      }),
      "invalid_classification"
    );
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ additionalTrainingPurposes: ["vibes" as never] })],
      }),
      "invalid_classification"
    );
  });

  it("rejects an additional purpose that repeats or duplicates", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            primaryTrainingPurpose: "repeatability",
            additionalTrainingPurposes: ["repeatability"],
          }),
        ],
      }),
      "invalid_classification"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ additionalTrainingPurposes: ["line-control", "line-control"] }),
        ],
      }),
      "invalid_classification"
    );
  });

  it("rejects an out-of-range or malformed difficulty", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ difficulty: { kind: "level", level: 7 } })],
      }),
      "invalid_difficulty"
    );
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ difficulty: { kind: "level", level: 0 } })],
      }),
      "invalid_difficulty"
    );
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ difficulty: { kind: "range", min: 5, max: 3 } })],
      }),
      "invalid_difficulty"
    );
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ difficulty: { kind: "band" } as never })],
      }),
      "invalid_difficulty"
    );
  });
});

describe("guidance", () => {
  it("rejects an unknown guidance kind", () => {
    expectRejected(
      buildTestPackage({ versions: [buildTestVersion({ guidance: { kind: "score" } as never })] }),
      "invalid_guidance"
    );
  });

  it("rejects observation guidance without observations or a no-scoring statement", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            guidance: { kind: "observation", observations: [], noScoringNote: "No score." },
          }),
        ],
      }),
      "invalid_guidance"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            guidance: { kind: "observation", observations: ["Watch."], noScoringNote: "" },
          }),
        ],
      }),
      "invalid_guidance"
    );
  });

  it("rejects a Technique Exercise that presents a 0-4 Shotmaking score", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            primaryFocus: "technique",
            guidance: {
              kind: "generic-shotmaking-score",
              scale: [
                { score: 0, percentage: 0 },
                { score: 1, percentage: 25 },
                { score: 2, percentage: 50 },
                { score: 3, percentage: 75 },
                { score: 4, percentage: 100 },
              ],
              explanation: ["Team judgement."],
              evaluationBasis: "team-defined-unstructured",
              evaluationBasisNote: "Team-defined.",
            },
          }),
        ],
      }),
      "invalid_guidance"
    );
  });

  it("rejects a wrong 0-4 percentage mapping or a missing evaluation basis", () => {
    const base = {
      explanation: ["Team judgement."],
      evaluationBasis: "team-defined-unstructured" as const,
      evaluationBasisNote: "Team-defined.",
    };
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            primaryFocus: "shotmaking",
            guidance: {
              kind: "generic-shotmaking-score",
              scale: [
                { score: 0, percentage: 0 },
                { score: 1, percentage: 20 },
                { score: 2, percentage: 50 },
                { score: 3, percentage: 75 },
                { score: 4, percentage: 100 },
              ],
              ...base,
            },
          }),
        ],
      }),
      "invalid_guidance"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            primaryFocus: "shotmaking",
            guidance: {
              kind: "generic-shotmaking-score",
              scale: [
                { score: 0, percentage: 0 },
                { score: 1, percentage: 25 },
                { score: 2, percentage: 50 },
                { score: 3, percentage: 75 },
                { score: 4, percentage: 100 },
              ],
              explanation: ["Team judgement."],
              evaluationBasis: "platform-rubric-v1" as never,
              evaluationBasisNote: "Team-defined.",
            },
          }),
        ],
      }),
      "invalid_guidance"
    );
  });
});

describe("source reference goal and recommended volume", () => {
  it("rejects a source reference goal marked as evaluated by the app", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sourceReferenceGoal: { text: "6 of 8.", evaluated: true as unknown as false },
          }),
        ],
      }),
      "invalid_source_reference_goal"
    );
  });

  it("rejects a source reference goal with no text", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ sourceReferenceGoal: { text: "", evaluated: false } })],
      }),
      "invalid_source_reference_goal"
    );
  });

  it("rejects a malformed recommended volume", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ recommendedVolume: { kind: "stone-count", stones: 0 } })],
      }),
      "invalid_recommended_volume"
    );
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ recommendedVolume: { kind: "open", note: "" } })],
      }),
      "invalid_recommended_volume"
    );
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ recommendedVolume: { kind: "minutes" } as never })],
      }),
      "invalid_recommended_volume"
    );
  });
});

describe("participation and sweeping", () => {
  it("rejects an empty, invalid or duplicated participation mode list", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: { ...buildTestVersion().participation, supportedModes: [] },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              supportedModes: ["squad" as never],
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              supportedModes: ["solo", "solo"],
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
  });

  it("rejects contradictory athlete counts", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              minTrainingAthletes: 0,
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              minTrainingAthletes: 3,
              maxTrainingAthletes: 2,
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
  });

  it("rejects a Solo-only Exercise that requires several athletes or a support role", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              supportedModes: ["solo"],
              minTrainingAthletes: 2,
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              supportedModes: ["solo"],
              roles: [
                { role: "delivering-athlete", requirement: "required" },
                { role: "observer", requirement: "required" },
              ],
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
  });

  it("rejects an invalid or duplicated role declaration", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              roles: [{ role: "cheerleader" as never, requirement: "optional" }],
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              roles: [
                { role: "observer", requirement: "optional" },
                { role: "observer", requirement: "required" },
              ],
            },
          }),
        ],
      }),
      "invalid_participation_requirement"
    );
  });

  it("rejects Sweeper counts that contradict the sweeping policy", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: { policy: "forbidden", allowedSweeperCounts: [0, 1], note: "No sweeping." },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: { policy: "required", allowedSweeperCounts: [0, 2], note: "Sweep." },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: { policy: "optional", allowedSweeperCounts: [1, 2], note: "Maybe." },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
  });

  it("rejects an out-of-range, duplicated or unrecommendable Sweeper count", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: { policy: "optional", allowedSweeperCounts: [0, 3], note: "Three." },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: { policy: "optional", allowedSweeperCounts: [0, 1, 1], note: "Dup." },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: {
              policy: "forbidden",
              allowedSweeperCounts: [0],
              recommendedSweeperCount: 2,
              note: "No sweeping.",
            },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
  });

  it("rejects an invalid policy or a missing policy note", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: {
              policy: "discouraged" as never,
              allowedSweeperCounts: [0],
              note: "Hmm.",
            },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            sweeping: { policy: "forbidden", allowedSweeperCounts: [0], note: "" },
          }),
        ],
      }),
      "invalid_sweeping_requirement"
    );
  });

  it("rejects a required Sweeper role under a no-sweeping policy", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              roles: [
                { role: "delivering-athlete", requirement: "required" },
                { role: "sweeper", requirement: "required" },
              ],
            },
            sweeping: { policy: "forbidden", allowedSweeperCounts: [0], note: "No sweeping." },
          }),
        ],
      }),
      "contradictory_participation_and_sweeping"
    );
  });

  it("rejects required sweeping on a Solo-only Exercise", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            participation: {
              ...buildTestVersion().participation,
              supportedModes: ["solo"],
            },
            sweeping: { policy: "required", allowedSweeperCounts: [1, 2], note: "Sweep." },
          }),
        ],
      }),
      "contradictory_participation_and_sweeping"
    );
  });
});

describe("Measurement Protocols", () => {
  it("rejects a duplicate protocol id and version pair", () => {
    expectRejected(
      buildTestPackage({ measurementProtocols: [buildTestProtocol(), buildTestProtocol()] }),
      "duplicate_measurement_protocol"
    );
  });

  it("accepts two versions of the same protocol id", () => {
    expect(
      validateExerciseCatalogPackage(
        buildTestPackage({
          measurementProtocols: [buildTestProtocol(), buildTestProtocol({ version: 2 })],
        })
      )
    ).toEqual({ valid: true });
  });

  it("rejects an invalid protocol definition", () => {
    expectRejected(
      buildTestPackage({ measurementProtocols: [buildTestProtocol({ id: "" })] }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({ measurementProtocols: [buildTestProtocol({ version: 0 })] }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ metricType: "vibes" as never })],
      }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ measurementMode: "hog-back" as never })],
      }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({ measurementProtocols: [buildTestProtocol({ allowedSources: [] })] }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ allowedSources: ["telepathy" as never] })],
      }),
      "invalid_measurement_protocol"
    );
  });

  it("keeps Release Time and Rotation Count protocol semantics distinct", () => {
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ measurementMode: undefined })],
      }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ unit: "rotations" })],
      }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({
          metricType: "rotation-count",
          unit: "rotations",
        })],
      }),
      "invalid_measurement_protocol"
    );
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({
          metricType: "rotation-count",
          unit: "seconds",
          measurementMode: undefined,
        })],
      }),
      "invalid_measurement_protocol"
    );
    expect(validateExerciseCatalogPackage(buildTestPackage({
      measurementProtocols: [buildTestProtocol({
        id: "test-rotation-count",
        name: "Test Rotation Count",
        metricType: "rotation-count",
        unit: "rotations",
        measurementMode: undefined,
      })],
      versions: [buildTestVersion({ compatibleMeasurementProtocols: [] })],
    }))).toEqual({ valid: true });
  });

  it("rejects a protocol that prescribes a target or tolerance", () => {
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ target: 3.75 as unknown as null })],
      }),
      "invalid_measurement_protocol"
    );
  });

  it("rejects an Exercise reference to an unknown protocol id or version", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            compatibleMeasurementProtocols: [
              { protocolId: "not-a-protocol", protocolVersion: 1, requirement: "optional" },
            ],
          }),
        ],
      }),
      "unknown_measurement_protocol_reference"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            compatibleMeasurementProtocols: [
              { protocolId: TEST_PROTOCOL_ID, protocolVersion: 99, requirement: "optional" },
            ],
          }),
        ],
      }),
      "unknown_measurement_protocol_reference"
    );
  });

  it("rejects a malformed protocol reference", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            compatibleMeasurementProtocols: [
              { protocolId: TEST_PROTOCOL_ID, protocolVersion: 1, requirement: "maybe" as never },
            ],
          }),
        ],
      }),
      "unknown_measurement_protocol_reference"
    );
  });
});

describe("source attribution", () => {
  it("rejects a missing attribution", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ source: { kind: "platform-curated", attribution: "" } }),
        ],
      }),
      "invalid_source_attribution"
    );
  });

  it("rejects an adapted external collection without its identifying metadata", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            source: {
              kind: "external-collection",
              attribution: "Adapted from somewhere.",
              organization: "Swiss Curling",
            },
          }),
        ],
      }),
      "invalid_source_attribution"
    );
  });

  it("rejects an invalid source kind and malformed non-displayed metadata", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ source: { kind: "scraped" as never, attribution: "Somewhere." } }),
        ],
      }),
      "invalid_source_attribution"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            source: {
              kind: "platform-curated",
              attribution: "Platform-curated.",
              nonDisplayedSourceMetadata: {
                originalTitles: ["" as string],
                searchAliases: [],
              },
            },
          }),
        ],
      }),
      "invalid_source_attribution"
    );
  });
});

describe("diagrams", () => {
  it("rejects an unsupported diagram kind", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: { kind: "animated-video", id: "d" } as never,
          }),
        ],
      }),
      "unsupported_diagram_kind"
    );
  });

  it("rejects a diagram missing its English caption or accessible summary", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ diagram: buildTestStructuredDiagram({ caption: "" }) })],
      }),
      "missing_diagram_accessibility_metadata"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ diagram: buildTestStructuredDiagram({ accessibleSummary: "" }) }),
        ],
      }),
      "missing_diagram_accessibility_metadata"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ diagram: buildTestSourceImageDiagram({ accessibleSummary: "" }) }),
        ],
      }),
      "missing_diagram_accessibility_metadata"
    );
  });

  it("rejects an unknown structured diagram schema version or coordinate system", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ diagram: buildTestStructuredDiagram({ schemaVersion: 2 }) }),
        ],
      }),
      "invalid_diagram_schema_version"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              coordinateSystem: "pixels" as never,
            }),
          }),
        ],
      }),
      "unsupported_diagram_coordinate_system"
    );
  });

  it("rejects an unsupported diagram element kind rather than dropping it silently", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [{ kind: "sensor-trajectory", id: "t" } as never],
            }),
          }),
        ],
      }),
      "unsupported_diagram_element_kind"
    );
  });

  it("rejects out-of-range or malformed normalized coordinates", () => {
    for (const badPoint of [
      { x: 1.2, y: 0.5 },
      { x: -0.1, y: 0.5 },
      { x: 0.5, y: Number.NaN },
      { x: "0.5" as unknown as number, y: 0.5 },
    ]) {
      expectRejected(
        buildTestPackage({
          versions: [
            buildTestVersion({
              diagram: buildTestStructuredDiagram({
                elements: [
                  { kind: "sheet", id: "sheet", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
                  { kind: "stone", id: "s", at: badPoint, role: "delivered" },
                ],
              }),
            }),
          ],
        }),
        "invalid_normalized_coordinate"
      );
    }
  });

  it("rejects a non-positive aspect ratio", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ diagram: buildTestStructuredDiagram({ aspectRatio: 0 }) }),
        ],
      }),
      "invalid_normalized_coordinate"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              aspectRatio: Number.POSITIVE_INFINITY,
            }),
          }),
        ],
      }),
      "invalid_normalized_coordinate"
    );
  });

  it("rejects malformed house radii and a too-short path", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                { kind: "house", id: "h", center: { x: 0.5, y: 0.5 }, radii: [0.1, 0.2] },
              ],
            }),
          }),
        ],
      }),
      "invalid_normalized_coordinate"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                { kind: "house", id: "h", center: { x: 0.5, y: 0.5 }, radii: [] },
              ],
            }),
          }),
        ],
      }),
      "invalid_normalized_coordinate"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                { kind: "path", id: "p", points: [{ x: 0.1, y: 0.1 }], style: "solid" },
              ],
            }),
          }),
        ],
      }),
      "invalid_normalized_coordinate"
    );
  });

  it("rejects an empty structured diagram and a duplicated element id", () => {
    expectRejected(
      buildTestPackage({
        versions: [buildTestVersion({ diagram: buildTestStructuredDiagram({ elements: [] }) })],
      }),
      "missing_required_content"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                { kind: "sheet", id: "same", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
                { kind: "label", id: "same", at: { x: 0.5, y: 0.5 }, text: "Label" },
              ],
            }),
          }),
        ],
      }),
      "missing_required_content"
    );
  });

  it("rejects unsupported element styles, roles and anchors", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                {
                  kind: "line",
                  id: "l",
                  from: { x: 0, y: 0 },
                  to: { x: 1, y: 1 },
                  style: "wavy" as never,
                },
              ],
            }),
          }),
        ],
      }),
      "unsupported_diagram_element_kind"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                { kind: "stone", id: "s", at: { x: 0.5, y: 0.5 }, role: "ghost" as never },
              ],
            }),
          }),
        ],
      }),
      "unsupported_diagram_element_kind"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                {
                  kind: "label",
                  id: "t",
                  at: { x: 0.5, y: 0.5 },
                  text: "Hi",
                  anchor: "centre" as never,
                },
              ],
            }),
          }),
        ],
      }),
      "unsupported_diagram_element_kind"
    );
  });

  it("rejects an empty label text and a non-positive sequence step", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [{ kind: "label", id: "t", at: { x: 0.5, y: 0.5 }, text: "  " }],
            }),
          }),
        ],
      }),
      "missing_required_content"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestStructuredDiagram({
              elements: [
                {
                  kind: "target-zone",
                  id: "z",
                  from: { x: 0.1, y: 0.1 },
                  to: { x: 0.2, y: 0.2 },
                  sequenceStep: 0,
                },
              ],
            }),
          }),
        ],
      }),
      "missing_required_content"
    );
  });
});

describe("restricted attributed source images", () => {
  it("rejects a missing attribution, source version or provenance note", () => {
    for (const field of ["attribution", "sourceVersion", "provenanceNote", "sourceOrganization"] as const) {
      expectRejected(
        buildTestPackage({
          versions: [
            buildTestVersion({ diagram: buildTestSourceImageDiagram({ [field]: "" }) }),
          ],
        }),
        "invalid_restricted_source_image"
      );
    }
  });

  it("rejects a publicly addressable asset reference", () => {
    for (const assetId of [
      "https://cdn.example.com/guard-10.png",
      "/public/guard-10.png",
      "guard-10.png",
      "../secret/guard-10",
      "data:image/png;base64,AAAA",
      "C:\\assets\\guard.png",
      "Guard_10",
      "",
    ]) {
      expectRejected(
        buildTestPackage({
          versions: [
            buildTestVersion({
              diagram: buildTestSourceImageDiagram({ assetReference: { assetId } }),
            }),
          ],
        }),
        "invalid_restricted_source_image"
      );
    }
  });

  it("rejects missing or permissive restricted-distribution metadata", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestSourceImageDiagram({
              distribution: {
                scope: "public" as never,
                permittedAudience: "Everyone.",
                publicDeliveryPermitted: false,
              },
            }),
          }),
        ],
      }),
      "invalid_restricted_source_image"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestSourceImageDiagram({
              distribution: {
                scope: "restricted-closed-beta",
                permittedAudience: "The named team.",
                publicDeliveryPermitted: true as unknown as false,
              },
            }),
          }),
        ],
      }),
      "invalid_restricted_source_image"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            diagram: buildTestSourceImageDiagram({
              distribution: {
                scope: "restricted-closed-beta",
                permittedAudience: "",
                publicDeliveryPermitted: false,
              },
            }),
          }),
        ],
      }),
      "invalid_restricted_source_image"
    );
  });
});

describe("present-but-blank optional renderable fields", () => {
  // Every optional field in this domain is renderable content, and the detail
  // renderer decides whether to render it purely from its presence. A blank
  // value would therefore become an empty label or a dangling separator, so it
  // is rejected at the boundary rather than at the component.

  it("rejects a blank participant role note", () => {
    for (const note of ["", "   "]) {
      expectRejected(
        buildTestPackage({
          versions: [
            buildTestVersion({
              participation: {
                ...buildTestVersion().participation,
                roles: [{ role: "delivering-athlete", requirement: "required", note }],
              },
            }),
          ],
        }),
        "invalid_participation_requirement"
      );
    }
  });

  it("rejects a blank equipment note", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            equipment: [
              { id: "stones", label: "Curling stones", requirement: "required", note: "  " },
            ],
          }),
        ],
      }),
      "missing_required_content"
    );
  });

  it("rejects a blank variation description", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({ variations: [{ id: "v", label: "A variation.", description: "" }] }),
        ],
      }),
      "missing_required_content"
    );
  });

  it("rejects a blank recommended-volume note on both counted variants", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            recommendedVolume: { kind: "stone-count", stones: 8, note: "" },
          }),
        ],
      }),
      "invalid_recommended_volume"
    );
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            recommendedVolume: { kind: "repetition-count", repetitions: 10, note: "   " },
          }),
        ],
      }),
      "invalid_recommended_volume"
    );
  });

  it("accepts a counted recommended volume with a real note, or with none", () => {
    for (const volume of [
      { kind: "stone-count" as const, stones: 8 },
      { kind: "stone-count" as const, stones: 8, note: "Two ends of four." },
      { kind: "repetition-count" as const, repetitions: 10 },
    ]) {
      expect(
        validateExerciseCatalogPackage(
          buildTestPackage({ versions: [buildTestVersion({ recommendedVolume: volume })] })
        )
      ).toEqual({ valid: true });
    }
  });

  it("rejects a blank optional source field on platform-curated content", () => {
    for (const field of [
      "organization",
      "collectionName",
      "collectionVersion",
      "sourceExerciseReference",
      "provenanceNote",
    ] as const) {
      expectRejected(
        buildTestPackage({
          versions: [
            buildTestVersion({
              source: {
                kind: "platform-curated",
                attribution: "Platform-curated test content.",
                [field]: "  ",
              },
            }),
          ],
        }),
        "invalid_source_attribution"
      );
    }
  });

  it("rejects a blank provenance note on an adapted external collection", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            source: {
              kind: "external-collection",
              attribution: "Adapted from a collection.",
              organization: "Some Federation",
              collectionName: "Some Collection",
              collectionVersion: "1.0",
              sourceExerciseReference: "Exercise 3",
              provenanceNote: "",
            },
          }),
        ],
      }),
      "invalid_source_attribution"
    );
  });

  it("rejects a non-positive or non-integer source page, and accepts a real one", () => {
    for (const sourcePage of [0, -3, 1.5, Number.NaN, "17" as unknown as number]) {
      expectRejected(
        buildTestPackage({
          versions: [
            buildTestVersion({
              source: {
                kind: "platform-curated",
                attribution: "Platform-curated test content.",
                sourcePage,
              },
            }),
          ],
        }),
        "invalid_source_attribution"
      );
    }

    expect(
      validateExerciseCatalogPackage(
        buildTestPackage({
          versions: [
            buildTestVersion({
              source: {
                kind: "platform-curated",
                attribution: "Platform-curated test content.",
                sourcePage: 17,
              },
            }),
          ],
        })
      )
    ).toEqual({ valid: true });
  });
});

describe("duplicate references and sources", () => {
  it("rejects the same Measurement Protocol referenced twice by one Exercise Version", () => {
    expectRejected(
      buildTestPackage({
        versions: [
          buildTestVersion({
            compatibleMeasurementProtocols: [
              { protocolId: TEST_PROTOCOL_ID, protocolVersion: 1, requirement: "required" },
              { protocolId: TEST_PROTOCOL_ID, protocolVersion: 1, requirement: "optional" },
            ],
          }),
        ],
      }),
      "duplicate_measurement_protocol_reference"
    );
  });

  it("accepts two different versions of the same protocol referenced side by side", () => {
    expect(
      validateExerciseCatalogPackage(
        buildTestPackage({
          measurementProtocols: [buildTestProtocol(), buildTestProtocol({ version: 2 })],
          versions: [
            buildTestVersion({
              compatibleMeasurementProtocols: [
                { protocolId: TEST_PROTOCOL_ID, protocolVersion: 1, requirement: "optional" },
                { protocolId: TEST_PROTOCOL_ID, protocolVersion: 2, requirement: "optional" },
              ],
            }),
          ],
        })
      )
    ).toEqual({ valid: true });
  });

  it("rejects a Measurement Protocol listing the same allowed source twice", () => {
    expectRejected(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ allowedSources: ["manual", "manual"] })],
      }),
      "invalid_measurement_protocol"
    );
  });

  it("accepts a protocol listing two distinct allowed sources", () => {
    expect(
      validateExerciseCatalogPackage(
        buildTestPackage({
          measurementProtocols: [buildTestProtocol({ allowedSources: ["manual", "external"] })],
        })
      )
    ).toEqual({ valid: true });
  });
});

describe("issue reporting", () => {
  it("reports every problem in one pass, not just the first", () => {
    const result = validateExerciseCatalogPackage(
      buildTestPackage({
        packageSchemaVersion: 9,
        versions: [buildTestVersion({ title: "", version: 0 })],
      })
    );
    expect(result.valid).toBe(false);
    if (result.valid) return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("invalid_package_schema_version");
    expect(codes).toContain("missing_required_content");
    expect(codes).toContain("invalid_version_number");
  });

  it("collects several independent optional-field and duplicate problems together", () => {
    const result = validateExerciseCatalogPackage(
      buildTestPackage({
        measurementProtocols: [buildTestProtocol({ allowedSources: ["manual", "manual"] })],
        versions: [
          buildTestVersion({
            equipment: [{ id: "e", label: "Stones", requirement: "required", note: " " }],
            variations: [{ id: "v", label: "A variation.", description: "" }],
            compatibleMeasurementProtocols: [
              { protocolId: TEST_PROTOCOL_ID, protocolVersion: 1, requirement: "optional" },
              { protocolId: TEST_PROTOCOL_ID, protocolVersion: 1, requirement: "optional" },
            ],
            source: {
              kind: "platform-curated",
              attribution: "Platform-curated test content.",
              provenanceNote: "  ",
              sourcePage: 0,
            },
          }),
        ],
      })
    );

    expect(result.valid).toBe(false);
    if (result.valid) return;
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("invalid_measurement_protocol");
    expect(codes).toContain("missing_required_content");
    expect(codes).toContain("duplicate_measurement_protocol_reference");
    expect(codes).toContain("invalid_source_attribution");
    // Two independent source problems (blank note, invalid page), both reported.
    expect(codes.filter((code) => code === "invalid_source_attribution").length).toBe(2);
  });
});
