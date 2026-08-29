// @vitest-environment jsdom
//
// Stage A of the Exercise Library (docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md
// section 21): Train's two entry paths, grouped Exercise discovery and the one
// generic Exercise detail renderer. Release Timing remains one Measured
// Exercise and reuses the established timing setup.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TrainLanding from "../TrainLanding";
import type { TrainingPlan } from "../../types";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { RELEASE_TIME_VERSION_ID } from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import { exerciseFocusGroupLabel } from "../../lib/exercises/presentation";

afterEach(cleanup);

const TIMING_SETUP_MARKER = "Set Up Training Block (test hero)";
const CURATED_TITLES = [
  "Release Point",
  "Eight Guards, Progressively Longer",
  "Release Time",
  "Release Gates",
  "Rotation Count",
  "Come-around from Outside to Inside, Before the T-Line",
  "Soft Take-out on the Centre Line at the T-Line",
] as const;
const releaseTimeVersion = findExerciseVersion(EXERCISE_CATALOG, RELEASE_TIME_VERSION_ID)!;

/**
 * A valid, executable Release Timing plan — enough for the Training Plans
 * library to render a named plan with its full action row, so a fallback test
 * can prove that none of it survives the tab becoming unavailable.
 */
function buildPlan(): TrainingPlan {
  return {
    id: "plan-1",
    name: "Release Consistency",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 2,
    steps: [
      {
        id: "step-1",
        type: "release-timing",
        exerciseVersionSnapshot: releaseTimeVersion,
        completion: { type: "shot-count", value: 8 },
        handleStrategy: { type: "free" },
        configuration: {
          name: "",
          mode: "fixed",
          measurementMode: "back-hog",
          targetTime: 3.75,
          variableTargetMode: "smart-random",
          blindTargetMode: "fixed",
          smartRandomMin: 2.5,
          smartRandomMax: 4.5,
          accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
        },
      },
    ],
  };
}

function renderTrainLanding(overrides: Partial<Parameters<typeof TrainLanding>[0]> = {}) {
  const props = {
    releaseTimingSetupContent: <div>{TIMING_SETUP_MARKER}</div>,
    plans: [] as TrainingPlan[],
    onSavePlan: vi.fn(),
    onDeletePlan: vi.fn(),
    onDuplicatePlan: vi.fn(),
    onStartPlan: vi.fn(),
    onStartExercise: vi.fn(() => true),
    ...overrides,
  };
  const result = render(<TrainLanding {...props} />);
  return { ...result, props };
}

function tab(name: string) {
  return screen.getByRole("tab", { name });
}

function openExercises() {
  fireEvent.click(tab("Exercises"));
}

function openFilters() {
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
}

function openDetail(title: string) {
  const version = EXERCISE_CATALOG.versions.find((candidate) => candidate.title === title);
  if (!version) throw new Error(`Missing Exercise fixture: ${title}`);
  const groupLabel = exerciseFocusGroupLabel(version.primaryFocus);
  const group = screen.getByRole("button", { name: new RegExp(`^${groupLabel}`) });
  if (group.getAttribute("aria-expanded") === "false") fireEvent.click(group);
  fireEvent.click(screen.getByRole("button", { name: `View Details: ${title}` }));
}

// ---------------------------------------------------------------------------
// Train entry paths
// ---------------------------------------------------------------------------

describe("Train entry paths", () => {
  it("offers exactly two entry paths, in order", () => {
    renderTrainLanding();
    expect(screen.getAllByRole("tab").map((element) => element.textContent)).toEqual([
      "Exercises",
      "Training Plans",
    ]);
  });

  it("opens the grouped Exercise Library by default", () => {
    renderTrainLanding();
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Exercises" })).toBeInTheDocument();
    expect(screen.queryByText(TIMING_SETUP_MARKER)).toBeNull();
  });

  it("keeps the Training Plans tab disabled and unreachable when the library is not ready", () => {
    renderTrainLanding({ plansTabDisabled: true, plans: [] });
    expect(tab("Training Plans")).toBeDisabled();

    fireEvent.click(tab("Training Plans"));
    expect(screen.queryByText("No training plans yet")).toBeNull();
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
  });

  it("keeps Exercises available while the Training Plans library is unavailable", () => {
    renderTrainLanding({ plansTabDisabled: true });
    expect(tab("Exercises")).toBeEnabled();

    openExercises();
    expect(
      screen.getByRole("heading", { level: 2, name: "Exercises" })
    ).toBeInTheDocument();
    expect(screen.getByText("Eight Guards, Progressively Longer")).toBeInTheDocument();
  });

  it("still reaches the unchanged Training Plans library when it is ready", () => {
    renderTrainLanding();
    fireEvent.click(tab("Training Plans"));
    expect(screen.getByText("No training plans yet")).toBeInTheDocument();
  });

  it("resets the Exercise subview and filters when the Exercises tab is entered again", () => {
    renderTrainLanding();

    openExercises();
    fireEvent.change(screen.getByLabelText("Search exercises"), {
      target: { value: "guard" },
    });
    expect(screen.getByText("16 exercises")).toBeInTheDocument();
    openDetail("Eight Guards, Progressively Longer");
    expect(screen.getByRole("button", { name: /Back to Exercises/ })).toBeInTheDocument();

    fireEvent.click(tab("Training Plans"));
    openExercises();

    expect(screen.getByLabelText("Search exercises")).toHaveValue("");
    expect(screen.getByText("41 exercises")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Back to Exercises/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

describe("Exercise Library", () => {
  it("lists the complete curated corpus with focus, classification, difficulty, participation and Sweeper summary", () => {
    renderTrainLanding();
    openExercises();

    for (const title of CURATED_TITLES) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }

    expect(screen.getAllByText("Technique")).toHaveLength(3);
    expect(screen.getAllByText("Shotmaking")).toHaveLength(36);
    expect(screen.getAllByText("Measured")).toHaveLength(4);
    expect(screen.getByRole("button", { name: /^Technique/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^Shotmaking/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /^Measured Exercises/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText("Guard")).toHaveLength(7);
    expect(screen.getAllByText("Level 6").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Level 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Level 4").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not rated")).toHaveLength(4);
    expect(screen.getAllByText("Solo or Team")).toHaveLength(41);
    expect(screen.getAllByText("No sweeping")).toHaveLength(37);
    expect(screen.getAllByText("Sweeping optional")).toHaveLength(4);
    expect(screen.getAllByText("0 Sweepers")).toHaveLength(37);
    expect(screen.getAllByText("0–2 Sweepers")).toHaveLength(4);
  });

  it("explains itself through the shared Info affordance rather than a wall of text", () => {
    renderTrainLanding();
    openExercises();

    fireEvent.click(screen.getByRole("button", { name: "About Exercises" }));
    const panel = screen.getByRole("dialog", { name: "Exercises" });
    expect(
      within(panel).getByText(/What should I practise today/)
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(/Solo Technique and Shotmaking exercises can be recorded here/)
    ).toBeInTheDocument();
  });

  it("narrows by text search, including a non-displayed source alias", () => {
    renderTrainLanding();
    openExercises();
    const search = screen.getByLabelText("Search exercises");

    fireEvent.change(search, { target: { value: "release point" } });
    expect(screen.getByText("Release Point")).toBeInTheDocument();
    expect(screen.queryByText("Eight Guards, Progressively Longer")).toBeNull();

    fireEvent.change(search, { target: { value: "Übung" } });
    expect(screen.getByText("Eight Guards, Progressively Longer")).toBeInTheDocument();
    expect(screen.queryByText("Release Point")).toBeNull();
    // Matching an alias must never display the non-English source title.
    expect(document.body.textContent).not.toMatch(/Guard Übung 10/);
  });

  it("narrows by focus, difficulty, Solo/Team, Shot Family and Sweeper requirement", () => {
    renderTrainLanding();
    openExercises();
    openFilters();

    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "measured" } });
    expect(screen.getByText("4 exercises")).toBeInTheDocument();
    expect(screen.getByText("Release Time")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "any" } });

    fireEvent.change(screen.getByLabelText("Difficulty"), { target: { value: "level:6" } });
    expect(screen.getByText("Eight Guards, Progressively Longer")).toBeInTheDocument();
    expect(screen.queryByText("Release Time")).toBeNull();
    fireEvent.change(screen.getByLabelText("Difficulty"), { target: { value: "unrated" } });
    expect(screen.getByText("4 exercises")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Difficulty"), { target: { value: "any" } });

    fireEvent.change(screen.getByLabelText("Solo or Team"), { target: { value: "team" } });
    expect(screen.getByText("41 exercises")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Solo or Team"), { target: { value: "any" } });

    fireEvent.change(screen.getByLabelText("Shot Family"), { target: { value: "guard" } });
    expect(screen.getByText("7 exercises")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Shot Family"), { target: { value: "any" } });

    fireEvent.change(screen.getByLabelText("Sweepers"), { target: { value: "forbidden" } });
    expect(screen.getByText("37 exercises")).toBeInTheDocument();
    expect(screen.getByText("Eight Guards, Progressively Longer")).toBeInTheDocument();
  });

  it("offers no filter value the catalog does not contain", () => {
    renderTrainLanding();
    openExercises();
    openFilters();

    const difficultyOptions = Array.from(
      screen.getByLabelText<HTMLSelectElement>("Difficulty").options
    ).map((option) => option.textContent);
    expect(difficultyOptions).toEqual([
      "Any difficulty",
      "Level 1",
      "Level 2",
      "Level 3",
      "Level 4",
      "Level 5",
      "Level 6",
      "Not rated",
    ]);

    const sweepingOptions = Array.from(
      screen.getByLabelText<HTMLSelectElement>("Sweepers").options
    ).map((option) => option.textContent);
    expect(sweepingOptions).toEqual([
      "Any Sweeper requirement",
      "Sweeping optional",
      "No sweeping",
    ]);
    expect(sweepingOptions).not.toContain("Sweeping required");
  });

  it("shows one honest shared empty state, with a reset action, when nothing matches", () => {
    renderTrainLanding();
    openExercises();

    fireEvent.change(screen.getByLabelText("Search exercises"), {
      target: { value: "zamboni" },
    });

    expect(screen.getByText("No exercises match these filters")).toBeInTheDocument();
    expect(
      screen.getByText("Change a filter or clear the search text to see the standard exercises again.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Release Point")).toBeNull();

    fireEvent.click(screen.getAllByRole("button", { name: "Reset filters" })[0]);
    expect(screen.getByText("41 exercises")).toBeInTheDocument();
    expect(screen.getByLabelText("Search exercises")).toHaveValue("");
  });

  it("hides the reset action while filters are untouched", () => {
    renderTrainLanding();
    openExercises();
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "guard" } });
    expect(screen.getAllByRole("button", { name: "Reset filters" }).length).toBeGreaterThan(0);
  });

  it("shows no authoring, favourites, recommendation, popularity or recent-items control", () => {
    renderTrainLanding();
    openExercises();

    for (const label of [
      /New Exercise/i,
      /Create Exercise/i,
      /Edit/i,
      /Favourite/i,
      /Favorite/i,
      /Recommended/i,
      /Popular/i,
      /Recently/i,
      /Rate/i,
    ]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

describe("Exercise detail", () => {
  it("opens a detail and returns with an accessible Back to Exercises action", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Point");

    expect(screen.getByRole("heading", { name: "Release Point" })).toBeInTheDocument();
    expect(screen.getByText("Instructions")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Back to Exercises/ }));
    expect(screen.getByText("41 exercises")).toBeInTheDocument();
    expect(screen.getByText("Eight Guards, Progressively Longer")).toBeInTheDocument();
  });

  it("keeps the filtered list when returning from a detail", () => {
    renderTrainLanding();
    openExercises();
    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "guard" } });
    openDetail("Eight Guards, Progressively Longer");

    fireEvent.click(screen.getByRole("button", { name: /Back to Exercises/ }));
    expect(screen.getByLabelText("Search exercises")).toHaveValue("guard");
    expect(screen.getByText("16 exercises")).toBeInTheDocument();
  });

  it("offers the generic start action and shows no other Exercise's content", () => {
    const { props } = renderTrainLanding();
    openExercises();
    openDetail("Release Point");

    fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
    expect(props.onStartExercise).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Release Point", primaryFocus: "technique" })
    );
    expect(screen.queryByText("Eight Guards, Progressively Longer")).toBeNull();
  });

  it("keeps the detail open when Session persistence refuses a start", () => {
    const onStartExercise = vi.fn(() => false);
    renderTrainLanding({ onStartExercise });
    openExercises();
    openDetail("Release Point");

    fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
    expect(onStartExercise).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "Release Point" })).toBeInTheDocument();
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
  });

  it("disables Exercise start while Session persistence is not writable", () => {
    const onStartExercise = vi.fn(() => true);
    renderTrainLanding({ onStartExercise, startExerciseDisabled: true });
    openExercises();
    openDetail("Release Point");

    expect(screen.getByRole("button", { name: "Start Exercise" })).toBeDisabled();
    expect(onStartExercise).not.toHaveBeenCalled();
  });

  it("offers a separate Team setup action for Technique and Shotmaking", () => {
    const onSetUpTeamExercise = vi.fn();
    renderTrainLanding({ onSetUpTeamExercise });
    openExercises();
    openDetail("Eight Guards, Progressively Longer");

    fireEvent.click(screen.getByRole("button", { name: "Set Up Team Exercise" }));
    expect(onSetUpTeamExercise).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Eight Guards, Progressively Longer", primaryFocus: "shotmaking" })
    );
  });

  it("does not create a parallel Team action for Measured Release Time", () => {
    renderTrainLanding({ onSetUpTeamExercise: vi.fn() });
    openExercises();
    openDetail("Release Time");

    expect(screen.queryByRole("button", { name: "Set Up Team Exercise" })).toBeNull();
    expect(screen.getByRole("button", { name: "Continue to Timing Setup" })).toBeInTheDocument();
  });

  it("gates Team setup independently from Solo Session persistence", () => {
    renderTrainLanding({
      onSetUpTeamExercise: vi.fn(),
      teamExerciseStartDisabled: true,
      startExerciseDisabled: false,
    });
    openExercises();
    openDetail("Release Point");

    expect(screen.getByRole("button", { name: "Start Exercise" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Set Up Team Exercise" })).toBeDisabled();
  });

  it("opens the established timing setup inside the Release Time Exercise flow", () => {
    const onEntryPathChange = vi.fn();
    renderTrainLanding({ onEntryPathChange });
    openExercises();
    openDetail("Release Time");

    fireEvent.click(screen.getByRole("button", { name: "Continue to Timing Setup" }));
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(TIMING_SETUP_MARKER)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "← Back to Release Time" })).toBeInTheDocument();
    expect(onEntryPathChange).not.toHaveBeenCalledWith("plans");
  });

  it("renders every section of the specification's information order", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Eight Guards, Progressively Longer");

    // The specification's information order, now carried by fewer surfaces:
    // section headings for the consolidated cards, sub-headings for the blocks
    // inside them, and disclosure summaries for the supporting detail.
    for (const heading of [
      "Goal",
      "Setup and instructions",
      "Participants",
      "Equipment",
      "Sweeping",
      "Instructions",
      "How it is evaluated",
      "Volume and reference goal",
      "Variations",
    ]) {
      expect(screen.getByText(heading)).toBeInTheDocument();
    }
  });

  it("Release Point shows observation guidance and no score, points or pass/fail UI", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Point");

    expect(screen.getByText("What to look for")).toBeInTheDocument();
    expect(
      screen.getByText("Look for a release location that remains close to the agreed reference.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The app awards no score, points, percentage, pass/fail result, or technique rating for this exercise."
      )
    ).toBeInTheDocument();

    // No evaluation section, no score control, no percentage value, no
    // pass/fail status — the copy above may *say* there is no score, but no
    // score UI exists.
    expect(screen.queryByText("How it is evaluated")).toBeNull();
    expect(screen.queryByText("The 0–4 scale")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\d+\s?%/);
    expect(document.body.textContent).not.toMatch(/\bPassed\b|\bFailed\b/);
    for (const score of ["0", "1", "2", "3", "4"]) {
      expect(screen.queryByRole("button", { name: score })).toBeNull();
      expect(screen.queryByRole("radio", { name: score })).toBeNull();
    }
  });

  it("Eight Guards explains the generic 0-4 scale and keeps the source goal explicitly non-evaluated", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Eight Guards, Progressively Longer");

    expect(screen.getByText("The 0–4 scale")).toBeInTheDocument();
    for (const entry of ["0%", "25%", "50%", "75%", "100%"]) {
      expect(screen.getByText(new RegExp(`= ${entry.replace("%", "%")}`))).toBeInTheDocument();
    }
    expect(
      screen.getByText(/there is no platform-standardised rubric for this exercise/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/values from different teams are not comparable with each other/)
    ).toBeInTheDocument();
    expect(
      screen.getByText("This is a team-defined judgement of the exercise goal, not a platform-standardised score.")
    ).toBeInTheDocument();
    // The generic 0-4 scale and the actual-handle concept are both preserved.
    expect(
      screen.getByText(/against this exercise's goal and the handle actually played/)
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        "The source collection suggests 6 of 8 stones at the correct length. This is descriptive context only and is not evaluated by the app."
      )
    ).toBeInTheDocument();
    // The source's own one-point-per-stone mechanism is never reproduced as app scoring.
    expect(document.body.textContent).not.toMatch(/one point per stone|1 point per stone/i);
  });

  it("Eight Guards shows one compact English Swiss Curling source footer", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Eight Guards, Progressively Longer");

    expect(screen.getByText(/Source: Adapted by this application from Swiss Curling.*Guard Exercise 10/))
      .toBeInTheDocument();
    expect(screen.queryByText("Source and attribution")).toBeNull();
  });

  it("Eight Guards has a clear fallback without a diagram resolver and keeps its compact source", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Eight Guards, Progressively Longer");

    expect(
      screen.getByTestId("exercise-restricted-diagram-unavailable")
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("Guard Exercise 10 — original Swiss Curling diagram."))
      .toBeInTheDocument();
    expect(screen.getByText(/Source: Adapted by this application from Swiss Curling.*Guard Exercise 10/))
      .toBeInTheDocument();
  });

  it("Release Time is a Measured Exercise, distinct from the Assessment, with no prescribed target", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Time");

    expect(screen.getByRole("heading", { name: "Release Time" })).toBeInTheDocument();
    expect(screen.getByText("Measured")).toBeInTheDocument();
    expect(
      screen.getByText(
        /It is not the Release Time Core Assessment, which has its own fixed protocol and lives under Assess\./
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText(/prescribes no target time or accuracy tolerance/)
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/3\.75|target time of/i);
  });

  it("Release Time lists its compatible Measurement Protocols and claims no hardware support", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Time");

    const measurementsSummary = screen.getByText("Compatible Measurements");
    expect(measurementsSummary).toBeInTheDocument();
    // The count is in the summary, so a collapsed section still says how many.
    expect(measurementsSummary.textContent).toContain("2");
    // A Measured Exercise opens its protocols by default — its measurement *is*
    // the exercise. This branches on the declared focus, not on the Exercise.
    expect(measurementsSummary.closest("details")).toHaveAttribute("open");
    expect(screen.getByText("Release Time (Backline – Hog)")).toBeInTheDocument();
    expect(screen.getByText("Release Time (Hog – Hog)")).toBeInTheDocument();
    expect(screen.getAllByText(/Measured in seconds · Manual entry/).length).toBe(2);
    expect(document.body.textContent).not.toMatch(/Brower|sensor is available/i);
  });

  it("shows no Compatible Measurements section for an Exercise that declares none", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Point");
    expect(screen.queryByText("Compatible Measurements")).toBeNull();
  });

  it("shows no Volume and reference goal section for an Exercise that states neither", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Point");
    expect(screen.queryByText("Volume and reference goal")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Train tab semantics and keyboard behaviour
// ---------------------------------------------------------------------------

describe("Train tab ARIA semantics", () => {
  it("wires every tab to the one panel, and labels the panel with the selected tab", () => {
    renderTrainLanding();

    const tabs = screen.getAllByRole("tab");
    const panel = screen.getByRole("tabpanel");

    expect(panel).toHaveAttribute("id");
    const panelId = panel.getAttribute("id");

    for (const element of tabs) {
      expect(element).toHaveAttribute("id");
      expect(element).toHaveAttribute("aria-controls", panelId);
    }

    expect(panel).toHaveAttribute("aria-labelledby", tab("Exercises").id);

    openExercises();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      tab("Exercises").id
    );
  });

  it("keeps exactly one tab in the page tab order (roving tabindex)", () => {
    renderTrainLanding();

    expect(tab("Exercises")).toHaveAttribute("tabindex", "0");
    expect(tab("Training Plans")).toHaveAttribute("tabindex", "-1");

    fireEvent.click(tab("Training Plans"));
    expect(tab("Exercises")).toHaveAttribute("tabindex", "-1");
    expect(tab("Training Plans")).toHaveAttribute("tabindex", "0");
  });

  it("falls back to Exercises, and unmounts every plan surface, when the active path becomes unavailable", () => {
    const { rerender, props } = renderTrainLanding({
      plans: [buildPlan()],
    });

    fireEvent.click(tab("Training Plans"));
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "true");
    expect(tab("Training Plans")).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Release Consistency")).toBeInTheDocument();

    // The plans library becomes unavailable part-way through using it.
    rerender(<TrainLanding {...props} plans={[buildPlan()]} plansTabDisabled />);

    // The disabled tab is neither selected nor the keyboard stop.
    expect(tab("Training Plans")).toBeDisabled();
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "false");
    expect(tab("Training Plans")).toHaveAttribute("tabindex", "-1");

    // Exercises takes over as the selected, focusable, panel-labelling tab.
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(tab("Exercises")).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      tab("Exercises").id
    );
    expect(screen.getByRole("heading", { name: "Exercises" })).toBeInTheDocument();

    // Nothing from the gated domain is left mounted or reachable — not the
    // library, not a plan name, not a single plan action.
    expect(screen.queryByText("Release Consistency")).toBeNull();
    expect(screen.queryByText("No training plans yet")).toBeNull();
    for (const action of ["Start", "Edit", "Duplicate", "Delete", "New Training Plan"]) {
      expect(screen.queryByRole("button", { name: action })).toBeNull();
    }
  });

  it("does not silently reopen Training Plans when it becomes available again", () => {
    const { rerender, props } = renderTrainLanding({ plans: [buildPlan()] });

    fireEvent.click(tab("Training Plans"));
    expect(screen.getByText("Release Consistency")).toBeInTheDocument();

    rerender(<TrainLanding {...props} plans={[buildPlan()]} plansTabDisabled />);
    expect(screen.getByRole("heading", { name: "Exercises" })).toBeInTheDocument();

    // Readiness recovers: the tab is usable again, but the athlete stays on
    // Exercises until they choose Training Plans themselves.
    rerender(<TrainLanding {...props} plans={[buildPlan()]} plansTabDisabled={false} />);
    expect(tab("Training Plans")).toBeEnabled();
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "false");
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Exercises" })).toBeInTheDocument();
    expect(screen.queryByText("Release Consistency")).toBeNull();

    // Choosing it explicitly still works, and lands on the library.
    fireEvent.click(tab("Training Plans"));
    expect(screen.getByText("Release Consistency")).toBeInTheDocument();
  });

  it("keeps Exercises usable while the active path falls back", () => {
    const { rerender, props } = renderTrainLanding({ plans: [buildPlan()] });

    fireEvent.click(tab("Training Plans"));
    rerender(<TrainLanding {...props} plans={[buildPlan()]} plansTabDisabled />);

    openExercises();
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("41 exercises")).toBeInTheDocument();
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      tab("Exercises").id
    );
  });

  it("drops an in-progress plan sub-view rather than restoring it later", () => {
    const { rerender, props } = renderTrainLanding({ plans: [buildPlan()] });

    fireEvent.click(tab("Training Plans"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    // The start-review screen for that plan is open.
    expect(screen.getByRole("button", { name: "Start Training" })).toBeInTheDocument();

    rerender(<TrainLanding {...props} plans={[buildPlan()]} plansTabDisabled />);
    expect(screen.queryByRole("button", { name: "Start Training" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Exercises" })).toBeInTheDocument();

    rerender(<TrainLanding {...props} plans={[buildPlan()]} plansTabDisabled={false} />);
    fireEvent.click(tab("Training Plans"));
    // Back at the library, not at the start-review screen it was left on.
    expect(screen.getByText("Release Consistency")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start Training" })).toBeNull();
  });
});

describe("Train tab keyboard navigation", () => {
  function pressOnTablist(key: string) {
    fireEvent.keyDown(screen.getByRole("tablist"), { key });
  }

  it("moves selection and focus with ArrowRight and ArrowLeft, wrapping at both ends", () => {
    renderTrainLanding();

    pressOnTablist("ArrowRight");
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("Training Plans"));

    // Wraps forward.
    pressOnTablist("ArrowRight");
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("Exercises"));

    // Wraps backward.
    pressOnTablist("ArrowLeft");
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("Training Plans"));
  });

  it("jumps to the first and last tab with Home and End", () => {
    renderTrainLanding();

    pressOnTablist("End");
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("Training Plans"));

    pressOnTablist("Home");
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(document.activeElement).toBe(tab("Exercises"));
  });

  it("skips a disabled tab entirely", () => {
    renderTrainLanding({ plansTabDisabled: true });

    // End lands on the last *enabled* tab, never on Training Plans.
    pressOnTablist("End");
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "false");

    // With only one enabled tab, navigation remains on Exercises.
    pressOnTablist("ArrowRight");
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");

    pressOnTablist("ArrowLeft");
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("41 exercises")).toBeInTheDocument();
  });

  it("ignores keys that are not tab navigation", () => {
    renderTrainLanding();
    pressOnTablist("ArrowDown");
    pressOnTablist("a");
    expect(tab("Exercises")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Exercises" })).toBeInTheDocument();
  });

  it("supports selecting both entry paths by click", () => {
    renderTrainLanding();
    fireEvent.click(tab("Training Plans"));
    expect(tab("Training Plans")).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tab("Exercises"));
    expect(screen.getByRole("heading", { name: "Exercises" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Heading semantics, filter summary, version and copy
// ---------------------------------------------------------------------------

describe("Library heading semantics", () => {
  it("names the heading exactly \"Exercises\", with the Info action as a sibling", () => {
    renderTrainLanding();
    openExercises();

    const heading = screen.getByRole("heading", { level: 2, name: "Exercises" });
    expect(heading).toHaveAccessibleName("Exercises");
    expect(heading.textContent).toBe("Exercises");
    expect(heading.querySelector("button")).toBeNull();

    // The Info action is still there, just not inside the heading.
    expect(screen.getByRole("button", { name: "About Exercises" })).toBeInTheDocument();
  });
});

describe("collapsed advanced-filter summary", () => {
  it("states the active selection once the filter panel is closed", () => {
    renderTrainLanding();
    openExercises();
    openFilters();

    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "technique" } });
    fireEvent.change(screen.getByLabelText("Sweepers"), { target: { value: "optional" } });

    // While open, the controls themselves show the selection.
    expect(
      screen.queryByTestId("exercise-library-active-filter-summary")
    ).toBeNull();

    openFilters(); // collapse
    const summary = screen.getByTestId("exercise-library-active-filter-summary");
    expect(summary).toHaveTextContent("2 active filters");
    expect(summary).toHaveTextContent("Focus: Technique");
    expect(summary).toHaveTextContent("Sweepers: Sweeping optional");
  });

  it("shows nothing while only the visible search field is in use", () => {
    renderTrainLanding();
    openExercises();
    fireEvent.change(screen.getByLabelText("Search exercises"), { target: { value: "guard" } });
    expect(screen.queryByTestId("exercise-library-active-filter-summary")).toBeNull();
  });

  it("disappears again after a reset", () => {
    renderTrainLanding();
    openExercises();
    openFilters();
    fireEvent.change(screen.getByLabelText("Focus"), { target: { value: "measured" } });
    openFilters(); // collapse
    expect(screen.getByTestId("exercise-library-active-filter-summary")).toHaveTextContent(
      "1 active filter"
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Reset filters" })[0]);
    expect(screen.queryByTestId("exercise-library-active-filter-summary")).toBeNull();
  });
});

describe("version, provenance and participant wording", () => {
  it("shows every Exercise's own immutable version, distinct from a source version", () => {
    renderTrainLanding();
    openExercises();

    for (const [title, version] of [
      ["Release Point", 1],
      ["Eight Guards, Progressively Longer", 5],
      ["Release Time", 1],
      ["Come-around from Outside to Inside, Before the T-Line", 2],
      ["Soft Take-out on the Centre Line at the T-Line", 3],
    ] as const) {
      openDetail(title);
      expect(screen.getByText(`Exercise version ${version}`)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Back to Exercises/ }));
    }

    // Source information is deliberately compact and appears only once at the
    // bottom of an externally sourced Exercise.
    openDetail("Eight Guards, Progressively Longer");
    expect(screen.getByText(/Source: Adapted by this application from Swiss Curling.*Guard Exercise 10/))
      .toBeInTheDocument();
    expect(screen.queryByText(/Source version:/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Back to Exercises/ }));

    openDetail("Release Point");
    expect(screen.getByText("Exercise version 1")).toBeInTheDocument();
    expect(screen.queryByText(/Source version:/)).toBeNull();
  });

  it("never renders an internal id or non-displayed source metadata", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Eight Guards, Progressively Longer");

    for (const forbidden of [
      "eight-guards-progressively-longer",
      "eight-guards-progressively-longer-v1",
      "release-time-back-hog",
      "Guard Übung 10",
    ]) {
      expect(document.body.textContent).not.toContain(forbidden);
    }
  });

  it("describes the participant count in natural English", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Point");

    expect(screen.getByText(/One or more training athletes/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/From 1 training athlete/);
  });
});

describe("athlete-facing copy", () => {
  const IMPLEMENTATION_TALK =
    /this release|coming soon|not implemented|development only|newer app version|not part of this/i;

  it("never explains implementation or release status in the Library", () => {
    renderTrainLanding();
    openExercises();
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "About Exercises" }));
    expect(document.body.textContent).not.toMatch(IMPLEMENTATION_TALK);
  });

  it("never explains implementation or release status on any Exercise detail", () => {
    renderTrainLanding();
    openExercises();

    for (const title of CURATED_TITLES) {
      openDetail(title);
      for (const group of screen.queryAllByRole("group")) {
        (group as HTMLDetailsElement).open = true;
      }
      expect(document.body.textContent).not.toMatch(IMPLEMENTATION_TALK);
      fireEvent.click(screen.getByRole("button", { name: /Back to Exercises/ }));
    }
  });

  it("keeps the approved sporting meaning for the Shotmaking scale", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Eight Guards, Progressively Longer");

    expect(screen.getByText(/curling's 0 to 4 scale/)).toBeInTheDocument();
    expect(screen.getByText(/the handle actually played/)).toBeInTheDocument();
    expect(screen.getByText(/The team applies its own judgement/)).toBeInTheDocument();
    expect(
      screen.getByText(/not comparable with each other/)
    ).toBeInTheDocument();
  });

  it("keeps a Technique Exercise unscored", () => {
    renderTrainLanding();
    openExercises();
    openDetail("Release Point");
    expect(
      screen.getByText(/The app awards no score, points, percentage, pass\/fail result/)
    ).toBeInTheDocument();
    expect(screen.queryByText("How it is evaluated")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Content language
// ---------------------------------------------------------------------------

describe("English-only visible content", () => {
  const GERMAN_PATTERN = /Übung|Steine|immer länger|Törli|Einzeltraining|Übungssammlung/;

  it("shows no German source text in the Library", () => {
    renderTrainLanding();
    openExercises();
    openFilters();
    expect(document.body.textContent).not.toMatch(GERMAN_PATTERN);
  });

  it("shows no German source text on any Exercise detail, including expanded sections", () => {
    renderTrainLanding();
    openExercises();

    for (const title of CURATED_TITLES) {
      openDetail(title);
      for (const summary of screen.queryAllByRole("group")) {
        (summary as HTMLDetailsElement).open = true;
      }
      expect(document.body.textContent).not.toMatch(GERMAN_PATTERN);
      fireEvent.click(screen.getByRole("button", { name: /Back to Exercises/ }));
    }
  });
});
