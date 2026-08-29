// @vitest-environment jsdom
//
// Correction tests for PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md findings 1, 3, 5
// (BLOCKER/MAJOR): a delayed load of History Filters, Training Plans,
// Accuracy Tolerance Profiles, or Smart Random Profiles used to unconditionally
// overwrite whatever was in React state once the repository's Promise
// resolved, with no guard against a user having already interacted with that
// domain's default state in the meantime. The fix is readiness gating (not a
// dirty-flag/"user wins" merge — see PERSISTENCE_BOUNDARY_PHASE1_CORRECTION_REPORT.md
// for why that would just move the data-loss risk for collection domains):
// the interactive control simply does not exist (or is disabled) until that
// domain's own hydration state is "ready". These tests use controllably
// delayed repository Promises — never the real adapter, which resolves too
// fast for a human (or an un-delayed test) to ever observe the race.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import { historyFiltersRepository } from "../../lib/historyFiltersRepository";
import { trainingPlansRepository } from "../../lib/trainingPlans/repository";
import { accuracyToleranceProfilesRepository } from "../../lib/accuracyToleranceProfiles/repository";
import { smartRandomProfilesRepository } from "../../lib/smartRandomProfiles/repository";
import { sessionRepository } from "../../lib/sessionRepository";
import { assessmentRepository } from "../../lib/assessment/repository";
import { createDefaultHistoryFilters } from "../../lib/historyAnalysis";
import { createEmptyAccuracyToleranceProfilesState } from "../../lib/accuracyToleranceProfiles/persistence";
import { createEmptySmartRandomProfilesState } from "../../lib/smartRandomProfiles/persistence";
import { createEmptyAssessmentPersistedState } from "../../lib/assessment/persistence";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { RELEASE_TIME_VERSION_ID } from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import { loadedAbsent, loadedValue, loadFailed } from "../../lib/persistence/types";
import type { TrainingPlan } from "../../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const READ_ERROR = { kind: "unknown" as const, message: "simulated storage failure" };

function accuracyProfile(id: string, name: string) {
  return {
    id,
    name,
    onTarget: 0.1,
    acceptable: 0.2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function smartRandomProfile(id: string, name: string) {
  return {
    id,
    name,
    min: 2.5,
    max: 4.5,
    measurementMode: "back-hog" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function trainingPlan(id: string, name: string): TrainingPlan {
  const releaseTimeVersion = findExerciseVersion(
    EXERCISE_CATALOG,
    RELEASE_TIME_VERSION_ID
  );
  if (!releaseTimeVersion) throw new Error("Missing Release Time test fixture");

  return {
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 2,
    steps: [
      {
        id: `${id}-step-1`,
        type: "release-timing",
        exerciseVersionSnapshot: JSON.parse(JSON.stringify(releaseTimeVersion)),
        completion: { type: "shot-count", value: 2 },
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
  } as TrainingPlan;
}

/** Session resolves instantly to a fresh (absent) session unless overridden — every
 * test in this file cares about a domain other than Session, so Session should never
 * be the thing under test unless explicitly delayed. */
function stubSessionReady() {
  vi.spyOn(sessionRepository, "loadCurrent").mockResolvedValue(loadedAbsent());
  vi.spyOn(sessionRepository, "loadHistory").mockResolvedValue(loadedAbsent());
}

function stubAssessmentReady() {
  vi.spyOn(assessmentRepository, "loadState").mockResolvedValue(
    loadedValue({ state: createEmptyAssessmentPersistedState(), currentRunQuarantined: false })
  );
}

describe("TrackerApp — History Filters readiness gating", () => {
  it("does not expose an interactive filter control while loading, applies the stored value before interaction becomes available, and never persists a default in the meantime", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const filtersDeferred = createDeferred<ReturnType<typeof loadedValue<ReturnType<typeof createDefaultHistoryFilters>>>>();
    vi.spyOn(historyFiltersRepository, "load").mockReturnValue(filtersDeferred.promise);
    const saveSpy = vi.spyOn(historyFiltersRepository, "save");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    // Unrelated ready domain (Session/Home) is fully usable while History
    // Filters is still loading.
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    navButton("Analyze").click();
    await waitFor(() => screen.getByText(/Loading filters/));
    expect(screen.queryByRole("combobox", { name: "Handle" })).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();

    const storedFilters = {
      ...createDefaultHistoryFilters(),
      handles: ["in" as const],
    };
    filtersDeferred.resolve(loadedValue(storedFilters));

    await waitFor(() => screen.getByRole("combobox", { name: "Handle" }));
    expect(screen.getByRole("combobox", { name: "Handle" })).toHaveValue("in");
    // No default was ever persisted during the loading window — the only
    // save calls (if any) reflect the just-hydrated stored value's own
    // re-save (existing, accepted behavior), never a user-created default.
    for (const call of saveSpy.mock.calls) {
      expect(call[0].handles).toEqual(["in"]);
    }
  });

  it("initializes the documented default (not a fabricated value) on absent, only once interaction becomes available", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const filtersDeferred = createDeferred<ReturnType<typeof loadedAbsent<ReturnType<typeof createDefaultHistoryFilters>>>>();
    vi.spyOn(historyFiltersRepository, "load").mockReturnValue(filtersDeferred.promise);

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Analyze").click();
    await waitFor(() => screen.getByText(/Loading filters/));

    filtersDeferred.resolve(loadedAbsent());

    await waitFor(() => screen.getByRole("combobox", { name: "Handle" }));
    expect(screen.getByRole("combobox", { name: "Handle" })).toHaveValue(
      "both"
    );
  });
});

describe("TrackerApp — Training Plans readiness gating", () => {
  it("disables Training Plans while loading, leaves Exercises usable, and enables Plans only once its library is applied", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const plansDeferred = createDeferred<ReturnType<typeof loadedValue<ReturnType<typeof trainingPlan>[]>>>();
    vi.spyOn(trainingPlansRepository, "loadPlans").mockReturnValue(plansDeferred.promise);
    const saveSpy = vi.spyOn(trainingPlansRepository, "savePlans");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    const plansTab = screen.getByRole("tab", { name: "Training Plans" });
    expect(plansTab).toBeDisabled();

    // The Exercises pillar renders compiled curated content and
    // touches no persisted domain at all, so it stays reachable and usable
    // while the Training Plans library is still loading.
    const exercisesTab = screen.getByRole("tab", { name: "Exercises" });
    expect(exercisesTab).toBeEnabled();
    await waitFor(() => screen.getByText("Eight Guards, Progressively Longer"));

    fireEvent.click(plansTab);
    // Disabled tab — clicking it must not switch modes.
    expect(screen.queryByText("2 steps · 2 stones")).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();

    plansDeferred.resolve(loadedValue([trainingPlan("plan-1", "Release Consistency")]));

    await waitFor(() => expect(screen.getByRole("tab", { name: "Training Plans" })).toBeEnabled());
    fireEvent.click(screen.getByRole("tab", { name: "Training Plans" }));
    await waitFor(() => screen.getByText("Release Consistency"));
  });

  it("initializes an empty library on absent, enabling the tab once settled", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const plansDeferred = createDeferred<ReturnType<typeof loadedAbsent<never[]>>>();
    vi.spyOn(trainingPlansRepository, "loadPlans").mockReturnValue(plansDeferred.promise);

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    expect(screen.getByRole("tab", { name: "Training Plans" })).toBeDisabled();
    plansDeferred.resolve(loadedAbsent());

    await waitFor(() => expect(screen.getByRole("tab", { name: "Training Plans" })).toBeEnabled());
    fireEvent.click(screen.getByRole("tab", { name: "Training Plans" }));
    await waitFor(() => screen.getByText("No training plans yet"));
  });
});

describe("TrackerApp — Accuracy Tolerance Profiles readiness gating", () => {
  it("disables Manage Accuracy Tolerances while loading, leaves the unrelated Smart Random Profiles manager usable, and applies the stored profiles before the manager becomes reachable", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const accuracyDeferred = createDeferred<
      ReturnType<typeof loadedValue<ReturnType<typeof createEmptyAccuracyToleranceProfilesState>>>
    >();
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockReturnValue(
      accuracyDeferred.promise
    );
    const saveSpy = vi.spyOn(accuracyToleranceProfilesRepository, "saveState");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Settings").click();
    await waitFor(() => screen.getByText("Accuracy Tolerances"));

    expect(screen.getByRole("button", { name: "Manage Accuracy Tolerances" })).toBeDisabled();
    // Unrelated ready domain, same screen: Smart Random Profiles is usable.
    expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Manage Accuracy Tolerances" }));
    expect(screen.queryByText("Close Accuracy Tolerances")).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();

    accuracyDeferred.resolve(
      loadedValue({
        schemaVersion: 1,
        profiles: [accuracyProfile("acc-1", "Match Play")],
        defaultProfileId: "acc-1",
      })
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Manage Accuracy Tolerances" })).toBeEnabled()
    );
    expect(screen.getByText(/1 profile saved · Default: Match Play/)).toBeInTheDocument();
  });

  it("initializes the documented empty default (not a fabricated profile) on absent, only once the manager becomes reachable, and never persists a default while loading", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const accuracyDeferred = createDeferred<ReturnType<typeof loadedAbsent<never>>>();
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockReturnValue(
      accuracyDeferred.promise
    );
    const saveSpy = vi.spyOn(accuracyToleranceProfilesRepository, "saveState");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Settings").click();
    await waitFor(() => screen.getByText("Accuracy Tolerances"));

    expect(screen.getByRole("button", { name: "Manage Accuracy Tolerances" })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();

    accuracyDeferred.resolve(loadedAbsent());

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Manage Accuracy Tolerances" })).toBeEnabled()
    );

    // Unrelated ready domain, same screen.
    expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeEnabled();

    // Open the manager and confirm the documented empty state — never a
    // fabricated profile, and never a default pointing at one.
    fireEvent.click(screen.getByRole("button", { name: "Manage Accuracy Tolerances" }));
    await waitFor(() =>
      screen.getByRole("button", { name: "Close Accuracy Tolerances" })
    );
    expect(
      screen.getByText(
        "No profiles saved yet. Create one to reuse it wherever Custom Accuracy Tolerance is configured."
      )
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText("Default")).toBeNull();
  });
});

describe("TrackerApp — Smart Random Profiles readiness gating", () => {
  it("disables Manage Smart Random Profiles while loading and applies the stored profiles before the manager becomes reachable", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const smartRandomDeferred = createDeferred<
      ReturnType<typeof loadedValue<ReturnType<typeof createEmptySmartRandomProfilesState>>>
    >();
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockReturnValue(
      smartRandomDeferred.promise
    );
    const saveSpy = vi.spyOn(smartRandomProfilesRepository, "saveState");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Settings").click();
    await waitFor(() => screen.getByText("Smart Random Profiles"));

    expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Manage Smart Random Profiles" }));
    expect(screen.queryByText("Close Smart Random Profiles")).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();

    smartRandomDeferred.resolve(
      loadedValue({
        schemaVersion: 1,
        profiles: [smartRandomProfile("sr-1", "Wide Range")],
        defaultProfileId: null,
      })
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeEnabled()
    );
    expect(screen.getByText(/1 profile saved/)).toBeInTheDocument();
  });

  it("initializes the documented empty default (not a fabricated profile) on absent, only once the manager becomes reachable, and never persists a default while loading", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());

    const smartRandomDeferred = createDeferred<ReturnType<typeof loadedAbsent<never>>>();
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockReturnValue(
      smartRandomDeferred.promise
    );
    const saveSpy = vi.spyOn(smartRandomProfilesRepository, "saveState");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Settings").click();
    await waitFor(() => screen.getByText("Smart Random Profiles"));

    expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();

    smartRandomDeferred.resolve(loadedAbsent());

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeEnabled()
    );

    // Unrelated ready domain, same screen.
    expect(screen.getByRole("button", { name: "Manage Accuracy Tolerances" })).toBeEnabled();

    // Open the manager and confirm the documented empty state — never a
    // fabricated profile, and never a default pointing at one.
    fireEvent.click(screen.getByRole("button", { name: "Manage Smart Random Profiles" }));
    await waitFor(() =>
      screen.getByRole("button", { name: "Close Smart Random Profiles" })
    );
    expect(
      screen.getByText(
        "No profiles saved yet. Create one to reuse it wherever Smart Random is configured."
      )
    ).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByText("Default")).toBeNull();
  });
});

describe("TrackerApp — write-protection (read_failed) across every effect-persisted domain", () => {
  it("Session: settles loading, retains the fallback session, visibly disables every reachable Session-mutating control (not just silent handler no-ops), and never calls saveCurrent/saveHistory again — without blocking Training Plans", async () => {
    vi.spyOn(sessionRepository, "loadCurrent").mockResolvedValue(
      loadFailed({ id: "fallback", title: "", date: new Date().toISOString(), notes: "", blocks: [], activeBlockId: null, shots: [] } as never, READ_ERROR)
    );
    // A stored history entry with a real block/shot, so "Clear History"'s
    // and the per-session "Delete" button's disabled state can be
    // attributed to Session write-protection specifically, not merely to
    // `hasHistory` being false or an empty session list.
    vi.spyOn(sessionRepository, "loadHistory").mockResolvedValue(
      loadedValue([
        {
          id: "past-session",
          title: "Past Session",
          date: new Date().toISOString(),
          notes: "",
          blocks: [
            {
              id: "past-block",
              name: "Block 1",
              mode: "fixed",
              measurementMode: "back-hog",
              targetTime: 3.75,
              createdAt: new Date().toISOString(),
              accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
            },
          ],
          activeBlockId: "past-block",
          shots: [
            {
              id: "past-shot",
              sessionId: "past-session",
              blockId: "past-block",
              shotNumber: 1,
              releaseTime: 3.75,
              targetTime: 3.75,
              handle: "in",
              createdAt: new Date().toISOString(),
            },
          ],
        } as never,
      ])
    );
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(
      loadedValue([trainingPlan("plan-1", "Release Consistency")])
    );
    const saveCurrentSpy = vi.spyOn(sessionRepository, "saveCurrent");
    const saveHistorySpy = vi.spyOn(sessionRepository, "saveHistory");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));

    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    // Release Timing is now reached only through its Measured Exercise. A
    // write-protected Session blocks that transition before the setup mounts.
    fireEvent.click(
      screen.getByRole("button", { name: "View Details: Release Time" })
    );
    expect(
      screen.getByRole("button", { name: "Continue to Timing Setup" })
    ).toBeDisabled();
    expect(screen.queryByText("Set Up Training Block")).toBeNull();

    // Manual timing entry / Auto Capture / Timing Simulator are all
    // structurally unreachable, not merely disabled: since block creation
    // is blocked, `activeBlock` can never exist for the lifetime of this
    // write-protected session, so none of their controls are ever rendered
    // at all — verified directly rather than assumed.
    expect(screen.queryByPlaceholderText("3.75 or 375")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Auto Capture" })).toBeNull();
    expect(screen.queryByText("Timing Simulator")).toBeNull();

    // Training Plan "Start" — a second, independent Session-mutating entry
    // point, reachable even though Training Plans itself is a separate,
    // already-"ready" domain.
    fireEvent.click(screen.getByRole("tab", { name: "Training Plans" }));
    await waitFor(() => screen.getByText("Release Consistency"));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => screen.getByRole("button", { name: "Start Training" }));
    expect(screen.getByRole("button", { name: "Start Training" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("Active Training Block")).toBeNull();

    // Session History mutation — reachable via Settings/Analyze
    // independent of block state — is visibly disabled too.
    navButton("Settings").click();
    await waitFor(() => screen.getByText("Clear Data"));
    expect(screen.getByRole("button", { name: "Clear History" })).toBeDisabled();

    navButton("Analyze").click();
    await waitFor(() => screen.getByText("Past Session"));
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();

    expect(saveCurrentSpy).not.toHaveBeenCalled();
    expect(saveHistorySpy).not.toHaveBeenCalled();
  });

  it("History Filters: settles loading, retains the default fallback, makes every control actually disabled (not just non-persisting), and never calls save", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(
      loadFailed(createDefaultHistoryFilters(), READ_ERROR)
    );
    const saveSpy = vi.spyOn(historyFiltersRepository, "save");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Analyze").click();
    await waitFor(() => screen.getByRole("combobox", { name: "Handle" }));
    expect(screen.getByRole("combobox", { name: "Handle" })).toHaveValue(
      "both"
    );

    // Corrected: the control remains visible (the documented fallback), but
    // every control inside must be actually disabled — not merely
    // interactive-but-never-persisted, which external review found
    // insufficient (a visibly interactive control that silently no-ops is
    // not "unavailable").
    expect(screen.getByRole("combobox", { name: "Handle" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Training Category" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Measurement Mode" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Date Range" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Threshold Comparison Mode" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /More filters/ })).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Handle" }), {
      target: { value: "in" },
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Even if fireEvent bypasses the DOM's own disabled-element event
    // suppression, the handler-level guard (defence in depth) must still
    // refuse to mutate state or persist anything.
    expect(screen.getByRole("combobox", { name: "Handle" })).toHaveValue("both");
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("Assessment: settles loading, retains the empty fallback state, visibly disables every setup/threshold/start control (not just a silent no-op), never mutates or saves — while pure navigation (View Assessment) stays available", async () => {
    stubSessionReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(assessmentRepository, "loadState").mockResolvedValue(
      loadFailed(
        { state: createEmptyAssessmentPersistedState(), currentRunQuarantined: false },
        READ_ERROR
      )
    );
    const saveSpy = vi.spyOn(assessmentRepository, "saveState");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Assess").click();

    // "View Assessment" is pure navigation — it neither mutates the
    // Assessment domain nor implies durable workflow progress, so it stays
    // available even though Assessment itself is write-protected (it only
    // depends on the separate, independently-"ready" preferences read).
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "View Assessment" })).toBeEnabled()
    );

    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));
    fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));

    // Every setup/threshold/start control is now visibly disabled — a user
    // must not be able to go through an apparently functional setup that
    // could only ever end in a silent no-op.
    expect(screen.getByRole("radio", { name: /Standard/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Tight/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Custom/ })).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Start Warm-up" })).toBeDisabled();
    expect(
      screen.getByText(/couldn.t be loaded, so a new assessment can.t be started/)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start Warm-up" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByPlaceholderText("3.75 or 375")).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();

    // Unrelated ready domain.
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  });

  it("Training Plans: settles loading, retains the empty fallback, keeps the tab disabled, and never calls savePlans", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadFailed([], READ_ERROR));
    const saveSpy = vi.spyOn(trainingPlansRepository, "savePlans");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    expect(screen.getByRole("tab", { name: "Training Plans" })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();

    // Unrelated ready domain: the curated Exercise Library still works.
    expect(screen.getByText("Eight Guards, Progressively Longer")).toBeInTheDocument();
  });

  it("Accuracy Tolerance Profiles: settles loading, retains the empty fallback, keeps Manage disabled, and never calls saveState", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(
      loadFailed(createEmptyAccuracyToleranceProfilesState(), READ_ERROR)
    );
    const saveSpy = vi.spyOn(accuracyToleranceProfilesRepository, "saveState");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Settings").click();
    await waitFor(() => screen.getByText("Accuracy Tolerances"));

    expect(screen.getByRole("button", { name: "Manage Accuracy Tolerances" })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();

    // Unrelated ready domain, same screen.
    expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeEnabled();
  });

  it("Smart Random Profiles: settles loading, retains the empty fallback, keeps Manage disabled, and never calls saveState", async () => {
    stubSessionReady();
    stubAssessmentReady();
    vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
    vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
    vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
    vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(
      loadFailed(createEmptySmartRandomProfilesState(), READ_ERROR)
    );
    const saveSpy = vi.spyOn(smartRandomProfilesRepository, "saveState");

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Settings").click();
    await waitFor(() => screen.getByText("Smart Random Profiles"));

    expect(screen.getByRole("button", { name: "Manage Smart Random Profiles" })).toBeDisabled();
    expect(saveSpy).not.toHaveBeenCalled();

    // Unrelated ready domain, same screen.
    expect(screen.getByRole("button", { name: "Manage Accuracy Tolerances" })).toBeEnabled();
  });
});
