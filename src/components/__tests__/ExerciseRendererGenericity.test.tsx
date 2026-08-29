// @vitest-environment jsdom
//
// Stage A must prove that no exercise-specific UI conditional is required
// (spec section 21, Stage A). Two independent checks:
//
// 1. Behavioural — a synthetic Exercise Version that is *not* in the catalog
//    renders completely through the same generic components.
// 2. Static — none of the Exercise UI components mentions a catalog Exercise
//    id or display title at all, so no such conditional can exist.
import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExerciseDetail from "../ExerciseDetail";
import ExerciseSummaryCard from "../ExerciseSummaryCard";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { buildTestStructuredDiagram, buildTestVersion } from "../../lib/exercises/__tests__/testHelpers";
import type { ExerciseVersion } from "../../lib/exercises/types";

afterEach(cleanup);

/** A curated Exercise the catalog has never heard of, using every optional field. */
function syntheticVersion(): ExerciseVersion {
  return buildTestVersion({
    id: "synthetic-exercise-v1",
    exerciseId: "synthetic-exercise",
    title: "Synthetic Freeze Ladder",
    primaryFocus: "shotmaking",
    shotFamily: "freeze",
    primaryTrainingPurpose: "line-control",
    additionalTrainingPurposes: ["handle-control"],
    difficulty: { kind: "range", min: 2, max: 4 },
    goal: "Synthetic goal statement.",
    whyItMatters: "Synthetic rationale statement.",
    setupInstructions: [{ id: "s1", text: "Synthetic setup step." }],
    executionInstructions: [
      { id: "e1", text: "Synthetic first step." },
      { id: "e2", text: "Synthetic second step." },
    ],
    guidance: {
      kind: "generic-shotmaking-score",
      scale: [
        { score: 0, percentage: 0 },
        { score: 1, percentage: 25 },
        { score: 2, percentage: 50 },
        { score: 3, percentage: 75 },
        { score: 4, percentage: 100 },
      ],
      explanation: ["Synthetic evaluation explanation."],
      evaluationBasis: "team-defined-unstructured",
      evaluationBasisNote: "Synthetic evaluation basis note.",
    },
    sourceReferenceGoal: { text: "Synthetic reference goal.", evaluated: false },
    recommendedVolume: { kind: "repetition-count", repetitions: 12 },
    variations: [{ id: "v1", label: "Synthetic variation." }],
    participation: {
      supportedModes: ["team"],
      minTrainingAthletes: 2,
      maxTrainingAthletes: 4,
      roles: [
        { role: "delivering-athlete", requirement: "required" },
        { role: "sweeper", requirement: "required", note: "Synthetic sweeper note." },
      ],
      summary: "Synthetic participation summary.",
    },
    sweeping: {
      policy: "required",
      allowedSweeperCounts: [1, 2],
      recommendedSweeperCount: 2,
      note: "Synthetic sweeping note.",
    },
    equipment: [{ id: "eq1", label: "Synthetic equipment", requirement: "optional", note: "Synthetic equipment note." }],
    diagram: buildTestStructuredDiagram(),
    source: {
      kind: "external-collection",
      attribution: "Synthetic attribution line.",
      organization: "Synthetic Organisation",
      collectionName: "Synthetic Collection",
      collectionVersion: "3.1",
      sourceExerciseReference: "Synthetic Exercise 42",
      provenanceNote: "Synthetic provenance note.",
    },
  });
}

describe("generic rendering of an Exercise the catalog does not contain", () => {
  it("renders a Library card entirely from data", () => {
    render(<ExerciseSummaryCard version={syntheticVersion()} onOpen={vi.fn()} />);

    expect(screen.getByText("Synthetic Freeze Ladder")).toBeInTheDocument();
    expect(screen.getByText("Synthetic goal statement.")).toBeInTheDocument();
    expect(screen.getByText("Shotmaking")).toBeInTheDocument();
    expect(screen.getByText("Freeze")).toBeInTheDocument();
    expect(screen.getByText("Level 2–4")).toBeInTheDocument();
    expect(screen.getByText("Team")).toBeInTheDocument();
    expect(screen.getByText("Sweeping required")).toBeInTheDocument();
    expect(screen.getByText("1–2 Sweepers")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View Details: Synthetic Freeze Ladder" })
    ).toBeInTheDocument();
  });

  it("renders every detail section entirely from data", () => {
    render(
      <ExerciseDetail
        version={syntheticVersion()}
        measurementProtocols={[
          { protocol: EXERCISE_CATALOG.measurementProtocols[0], requirement: "required" },
        ]}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />
    );

    for (const text of [
      "Synthetic Freeze Ladder",
      "Synthetic goal statement.",
      "Synthetic rationale statement.",
      "Synthetic setup step.",
      "Synthetic first step.",
      "Synthetic second step.",
      "Synthetic evaluation explanation.",
      "Synthetic evaluation basis note.",
      "Synthetic reference goal.",
      "Synthetic variation.",
      "Synthetic participation summary.",
      "Synthetic sweeping note.",
      "Synthetic Exercise 42",
    ]) {
      expect(screen.getAllByText(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).length)
        .toBeGreaterThan(0);
    }

    expect(screen.getByText("Level 2–4")).toBeInTheDocument();
    expect(screen.getByText(/12 repetitions/)).toBeInTheDocument();
    expect(screen.getByText("The 0–4 scale")).toBeInTheDocument();
    expect(screen.getByText("Compatible Measurements")).toBeInTheDocument();
    expect(screen.getByTestId("exercise-structured-diagram")).toBeInTheDocument();
    expect(screen.getByText(/2–4 training athletes/)).toBeInTheDocument();
  });

  it("shows the synthetic Exercise's own version number, not a hard-coded one", () => {
    render(
      <ExerciseDetail
        version={{ ...syntheticVersion(), version: 4 }}
        measurementProtocols={[]}
        onBack={vi.fn()}
        onStart={vi.fn()}
      />
    );

    expect(screen.getByText("Exercise version 4")).toBeInTheDocument();
    expect(screen.getByText(/Source: Synthetic attribution.*Synthetic Exercise 42/))
      .toBeInTheDocument();
    expect(screen.queryByText(/Source version:/)).toBeNull();
  });

  it("phrases every participant-count shape in natural English", () => {
    const cases: { min: number; max: number | null; expected: RegExp }[] = [
      { min: 1, max: null, expected: /One or more training athletes/ },
      { min: 3, max: null, expected: /3 or more training athletes/ },
      { min: 1, max: 1, expected: /One training athlete/ },
      { min: 4, max: 4, expected: /4 training athletes/ },
      { min: 2, max: 4, expected: /2–4 training athletes/ },
    ];

    for (const { min, max, expected } of cases) {
      const base = syntheticVersion();
      const { unmount } = render(
        <ExerciseDetail
          version={{
            ...base,
            participation: {
              ...base.participation,
              supportedModes: ["solo", "team"],
              minTrainingAthletes: min,
              maxTrainingAthletes: max,
            },
          }}
          measurementProtocols={[]}
          onBack={vi.fn()}
          onStart={vi.fn()}
        />
      );

      expect(screen.getByText(expected)).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/From \d+ training athlete/);
      unmount();
    }
  });

  it("renders the generic start action for a synthetic Exercise", () => {
    const onStart = vi.fn();
    render(
      <ExerciseDetail
        version={syntheticVersion()}
        measurementProtocols={[]}
        onBack={vi.fn()}
        onStart={onStart}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
    expect(onStart).toHaveBeenCalledOnce();
  });
});

describe("no exercise-specific UI conditional exists", () => {
  const COMPONENT_FILES = [
    "ExerciseLibrary.tsx",
    "ExerciseLibraryFilterBar.tsx",
    "ExerciseSummaryCard.tsx",
    "ExerciseDetail.tsx",
    "ExerciseDiagramView.tsx",
    "ExerciseStructuredDiagram.tsx",
    "ExerciseRestrictedSourceImage.tsx",
    "ExerciseSoloExecutionScreen.tsx",
    "TrainLanding.tsx",
  ];

  it("mentions no catalog Exercise id, Version id or display title in any Exercise UI component", () => {
    const forbidden = [
      ...EXERCISE_CATALOG.exercises.map((exercise) => exercise.id),
      ...EXERCISE_CATALOG.versions.flatMap((version) => [version.id, version.title]),
    ];
    expect(forbidden.length).toBeGreaterThan(0);

    for (const file of COMPONENT_FILES) {
      const source = readFileSync(join(process.cwd(), "src", "components", file), "utf8");
      for (const needle of forbidden) {
        expect(source, `${file} must not reference "${needle}"`).not.toContain(needle);
      }
    }
  });
});
