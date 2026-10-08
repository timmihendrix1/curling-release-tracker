// @vitest-environment jsdom
//
// Flexible progression and early finishing for Profile-owned Training Plans
// (docs/TRAINING_SYSTEM_AND_PLANS.md sections 28-31/34, ADR-0048). Proves the
// approved behaviour end to end through the real orchestration and persistence
// boundaries — the planned stone count is guidance, never a gate; Finish Training is
// available throughout; and neither control can advance twice, fabricate a result, or
// let a Timing Result cross from one step into the next.
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import {
  EIGHT_GUARDS_VERSION_ID,
  RELEASE_POINT_VERSION_ID,
  RELEASE_TIME_VERSION_ID,
} from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import { sessionRepository } from "../../lib/sessionRepository";
import type { Session, TimingResult } from "../../types";
import TrackerApp from "../TrackerApp";

const TRAINING_PLANS_KEY = "curling-release-tracker-training-plans";
const SESSION_HISTORY_KEY = "curling-release-tracker-session-history";

const simulatorListeners: Array<(result: TimingResult) => void> = [];

// Same interception the session-archive hardening suite uses: a test can inject a
// TimingResult straight into the real processIncomingTimingResult/captureQueueRef
// pipeline — the exact path a device or the manual fallback takes — without a timer.
vi.mock("../../lib/simulatorTimingProvider", () => ({
  createSimulatorTimingProvider: () => ({
    type: "simulator",
    subscribe: (listener: (result: TimingResult) => void) => {
      simulatorListeners.push(listener);
      return () => {
        const index = simulatorListeners.indexOf(listener);
        if (index >= 0) simulatorListeners.splice(index, 1);
      };
    },
    start: () => {},
    stop: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  simulatorListeners.length = 0;
});

beforeEach(() => {
  localStorage.clear();
});

function catalogVersion(id: string) {
  const version = findExerciseVersion(EXERCISE_CATALOG, id);
  if (!version) throw new Error(`Missing Exercise Version ${id}`);
  return version;
}

function releaseTimingStep(id: string, stones: number, mode = "fixed") {
  return {
    id,
    type: "release-timing",
    exerciseVersionSnapshot: catalogVersion(RELEASE_TIME_VERSION_ID),
    completion: { type: "shot-count", value: stones },
    handleStrategy: { type: "free" },
    configuration: {
      name: "",
      mode,
      measurementMode: "back-hog",
      targetTime: 3.75,
      variableTargetMode: "smart-random",
      blindTargetMode: "fixed",
      smartRandomMin: 2.5,
      smartRandomMax: 4.5,
      accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
    },
  };
}

function curatedStep(id: string, versionId: string) {
  return {
    id,
    type: "curated-exercise",
    exerciseVersionSnapshot: catalogVersion(versionId),
    completion: { type: "exercise-completion" },
  };
}

function seedPlan(name: string, steps: unknown[]) {
  localStorage.setItem(
    TRAINING_PLANS_KEY,
    JSON.stringify({
      schemaVersion: 2,
      plans: [{
        id: "plan-under-test",
        name,
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        schemaVersion: 2,
        steps,
      }],
    })
  );
}

function navButton(label: string) {
  return screen.getAllByRole("button", { name: label })[0];
}

async function startSeededPlan() {
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));
  navButton("Train").click();
  await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  screen.getByRole("tab", { name: "Training Plans" }).click();
  await waitFor(() => screen.getByRole("button", { name: "Start" }));
  screen.getByRole("button", { name: "Start" }).click();
  await waitFor(() => screen.getByRole("button", { name: "Start Training" }));
  screen.getByRole("button", { name: "Start Training" }).click();
}

function addShot(releaseTime: string) {
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
    target: { value: releaseTime },
  });
  screen.getByRole("button", { name: "Save Shot" }).click();
}

function timingResult(id: string, value: number): TimingResult {
  return {
    id,
    source: "simulator",
    receivedAt: "2026-09-20T10:00:00.000Z",
    measurements: [{ measurementMode: "back-hog", value }],
  };
}

function archivedSession(): Session {
  const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) ?? "[]");
  expect(history).toHaveLength(1);
  return history[0] as Session;
}

async function finishTraining() {
  screen.getByRole("button", { name: "Finish Training" }).click();
  await waitFor(() => screen.getByRole("heading", { name: "Finish Training" }));
  screen.getByRole("button", { name: "Finish" }).click();
  await waitFor(() => screen.getByText("Training finished"));
}

describe("Training Plan progression — the planned count is guidance, not a gate", () => {
  it("moves to the next planned Exercise with nothing recorded at all", async () => {
    seedPlan("Two Timing Steps", [
      releaseTimingStep("step-1", 2),
      releaseTimingStep("step-2", 2),
    ]);
    await startSeededPlan();

    await waitFor(() => screen.getByText("Active Training Block"));
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText("0 of 2 planned stones")).toBeInTheDocument();
    expect(screen.getByText("Next: Release Time")).toBeInTheDocument();

    screen.getByRole("button", { name: "Next Exercise" }).click();

    await waitFor(() => screen.getByText(/Step 2 of 2/));
    expect(screen.getByText("0 of 2 planned stones")).toBeInTheDocument();
    expect(screen.getByText("This is the last planned exercise.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next Exercise" })).toBeNull();
  });

  it("moves on below the planned count and keeps the recorded stone in its own step", async () => {
    seedPlan("Two Timing Steps", [
      releaseTimingStep("step-1", 3),
      releaseTimingStep("step-2", 3),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 3 planned stones"));

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    expect(screen.getByText("0 of 3 planned stones")).toBeInTheDocument();

    addShot("3.80");
    await waitFor(() => screen.getByText("1 of 3 planned stones"));
    await finishTraining();

    const session = archivedSession();
    expect(session.shots).toHaveLength(2);
    const [firstBlock, secondBlock] = session.planExecution!.steps.map((step) =>
      step.runtime?.kind === "release-timing-block" ? step.runtime.blockId : undefined
    );
    expect(session.shots.filter((shot) => shot.blockId === firstBlock)).toHaveLength(1);
    expect(session.shots.filter((shot) => shot.blockId === secondBlock)).toHaveLength(1);
  });

  it("never advances by itself at the planned count and still accepts extra stones", async () => {
    seedPlan("Two Timing Steps", [
      releaseTimingStep("step-1", 2),
      releaseTimingStep("step-2", 2),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 2 planned stones"));
    addShot("3.76");
    await waitFor(() => screen.getByText("2 of 2 planned stones"));

    // Still step 1 — reaching the planned count is not a transition.
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next Exercise" })).toBeInTheDocument();

    addShot("3.77");
    await waitFor(() => screen.getByText("3 of 2 planned stones"));
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();
  });

  it("leaves an empty Shotmaking Exercise terminal without fabricating a result", async () => {
    seedPlan("Shotmaking First", [
      curatedStep("guards", EIGHT_GUARDS_VERSION_ID),
      curatedStep("release-point", RELEASE_POINT_VERSION_ID),
    ]);
    await startSeededPlan();

    await waitFor(() =>
      screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" })
    );
    // Complete Exercise is genuinely unavailable for an empty Shotmaking execution —
    // Next Exercise must still work, and must not route around that rule.
    expect(screen.getByRole("button", { name: "Complete Exercise" })).toBeDisabled();

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Release Point" }));
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument();

    await finishTraining();

    const executions = archivedSession().exerciseExecutions ?? [];
    const guards = executions.find(
      (execution) => execution.exerciseVersionSnapshot.id === EIGHT_GUARDS_VERSION_ID
    );
    expect(guards?.status).toBe("abandoned");
    expect(guards?.athleteResults[0].attempts).toHaveLength(0);
  });

  it("completes a Shotmaking Exercise that has recorded work, preserving attempts and the private note", async () => {
    seedPlan("Shotmaking First", [
      curatedStep("guards", EIGHT_GUARDS_VERSION_ID),
      curatedStep("release-point", RELEASE_POINT_VERSION_ID),
    ]);
    await startSeededPlan();

    await waitFor(() =>
      screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" })
    );
    screen.getByRole("button", { name: "Inhandle" }).click();
    screen.getByRole("button", { name: "4 points, 100 percent" }).click();
    const recordStone = screen.getByRole("button", { name: "Record Stone" });
    await waitFor(() => expect(recordStone).toBeEnabled());
    recordStone.click();
    await waitFor(() => screen.getByText("1 stone recorded"));

    fireEvent.change(screen.getByLabelText("Private athlete note"), {
      target: { value: "Good rhythm on the last guard." },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Private athlete note")).toHaveValue(
        "Good rhythm on the last guard."
      )
    );

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Release Point" }));
    await finishTraining();

    const guards = (archivedSession().exerciseExecutions ?? []).find(
      (execution) => execution.exerciseVersionSnapshot.id === EIGHT_GUARDS_VERSION_ID
    );
    expect(guards?.status).toBe("completed");
    expect(guards?.athleteResults[0].attempts).toHaveLength(1);
    expect(guards?.athleteResults[0].privateNote).toBe("Good rhythm on the last guard.");
  });
});

describe("Finish Training from anywhere in a plan", () => {
  it("finishes from an intermediate step and summarises planned versus actual factually", async () => {
    seedPlan("Three Step Plan", [
      releaseTimingStep("step-1", 4),
      releaseTimingStep("step-2", 4),
      curatedStep("release-point", RELEASE_POINT_VERSION_ID),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 4 planned stones"));
    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 3/));

    await finishTraining();

    expect(screen.getByText("Three Step Plan")).toBeInTheDocument();
    expect(screen.getByText(/Saved to history/)).toBeInTheDocument();
    expect(screen.getByText("1. Release Time")).toBeInTheDocument();
    expect(screen.getByText("1 of 4 planned stones")).toBeInTheDocument();
    expect(screen.getByText("Ended early")).toBeInTheDocument();
    expect(screen.getByText("0 of 4 planned stones")).toBeInTheDocument();
    expect(screen.getByText("Nothing recorded")).toBeInTheDocument();
    // The third step was never reached — it must never read as completed.
    expect(screen.getByText("Not started")).toBeInTheDocument();
    expect(screen.queryByText("Completed")).toBeNull();

    expect(archivedSession().shots).toHaveLength(1);

    screen.getByRole("button", { name: "Start New Training" }).click();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  });

  it("says plainly that nothing was saved when no work was recorded at all", async () => {
    seedPlan("Two Timing Steps", [
      releaseTimingStep("step-1", 2),
      releaseTimingStep("step-2", 2),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    await finishTraining();

    expect(
      screen.getByText("Nothing was recorded, so no training was saved to history.")
    ).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) ?? "[]")).toEqual([]);
  });

  it("keeps the training and offers a retry when the history write fails", async () => {
    vi.spyOn(sessionRepository, "archiveAndReplace").mockResolvedValueOnce({
      ok: false,
      step: "history",
      error: { kind: "write_failed", message: "Storage unavailable." },
    } as never);

    seedPlan("Two Timing Steps", [
      releaseTimingStep("step-1", 2),
      releaseTimingStep("step-2", 2),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));
    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 2 planned stones"));

    screen.getByRole("button", { name: "Finish Training" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Finish Training" }));
    screen.getByRole("button", { name: "Finish" }).click();

    await waitFor(() => screen.getByRole("alert"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This training could not be saved yet."
    );
    expect(screen.queryByText("Training finished")).toBeNull();
    // The recorded stone is still in the live training, not silently lost.
    expect(screen.getByText("1 of 2 planned stones")).toBeInTheDocument();

    // Retrying succeeds against the real repository.
    await finishTraining();
    expect(archivedSession().shots).toHaveLength(1);
  });
});

describe("Training Plan progression — races and guards", () => {
  it("advances exactly one step for two rapid Next Exercise clicks", async () => {
    seedPlan("Three Step Plan", [
      releaseTimingStep("step-1", 2),
      releaseTimingStep("step-2", 2),
      releaseTimingStep("step-3", 2),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    const nextExercise = screen.getByRole("button", { name: "Next Exercise" });
    act(() => {
      fireEvent.click(nextExercise);
      fireEvent.click(nextExercise);
    });

    await waitFor(() => screen.getByText(/Step 2 of 3/));
    expect(screen.queryByText(/Step 3 of 3/)).toBeNull();

    // Exactly one further Block was materialised for exactly one transition.
    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 2 planned stones"));
    await finishTraining();
    expect(archivedSession().blocks).toHaveLength(2);
  });

  it("archives once when Next Exercise and Finish Training compete", async () => {
    const archiveSpy = vi.spyOn(sessionRepository, "archiveAndReplace");

    seedPlan("Three Step Plan", [
      releaseTimingStep("step-1", 2),
      releaseTimingStep("step-2", 2),
      releaseTimingStep("step-3", 2),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));
    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 2 planned stones"));

    screen.getByRole("button", { name: "Finish Training" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Finish Training" }));

    // Confirming Finish and clicking Next in one flush: both are enqueued onto the
    // same capture queue, and the one that runs second must find its own precondition
    // gone rather than acting on a replaced Session.
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Finish" }));
      const next = screen.queryByRole("button", { name: "Next Exercise" });
      if (next) fireEvent.click(next);
    });

    await waitFor(() => screen.getByText("Training finished"));
    expect(archiveSpy).toHaveBeenCalledTimes(1);
    const session = archivedSession();
    expect(session.shots).toHaveLength(1);
    expect(session.blocks).toHaveLength(1);
  });

  it("asks before discarding an unsaved Blind Weight draft on Next Exercise", async () => {
    seedPlan("Blind Then Fixed", [
      releaseTimingStep("step-1", 2, "blind"),
      releaseTimingStep("step-2", 2),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    fireEvent.change(screen.getByLabelText("Predicted time"), {
      target: { value: "3.80" },
    });
    screen.getByRole("button", { name: "Lock Prediction" }).click();
    await waitFor(() => screen.getByText("Prediction locked"));

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText("Unfinished Blind Weight Shot"));
    expect(screen.getByText(/stones you already recorded are kept/)).toBeInTheDocument();

    // Cancelling keeps the athlete exactly where they were.
    screen.getByRole("button", { name: "Cancel" }).click();
    await waitFor(() => expect(screen.queryByText("Unfinished Blind Weight Shot")).toBeNull());
    expect(screen.getByText(/Step 1 of 2/)).toBeInTheDocument();

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText("Unfinished Blind Weight Shot"));
    screen.getByRole("button", { name: "Leave" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    // A draft is not a recorded stone — nothing was saved for the step left behind.
    expect(screen.getByText("0 of 2 planned stones")).toBeInTheDocument();
  });

  it("keeps a result accepted before the transition, and refuses one that arrives after it", async () => {
    seedPlan("Two Timing Steps", [
      releaseTimingStep("step-1", 4),
      releaseTimingStep("step-2", 4),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
    await waitFor(() => screen.getByText(/Add Result Manually/));

    // Accepted while step 1 still owns capture.
    await act(async () => {
      simulatorListeners[0](timingResult("result-before", 3.7));
    });
    await waitFor(() => screen.getByText("1 of 4 planned stones"));

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText("Auto Capture In Progress"));

    // Confirming the leave and firing a late result in the same flush: the result is
    // queued behind the transition and must not be applied to its replacement.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Leave" }));
      simulatorListeners[0](timingResult("result-after", 3.9));
    });

    await waitFor(() => screen.getByText(/Step 2 of 2/));
    expect(screen.getByText("0 of 4 planned stones")).toBeInTheDocument();

    // A further result cannot resurrect the closed capture context either.
    await act(async () => {
      simulatorListeners[0](timingResult("result-later", 4.1));
    });
    await waitFor(() => expect(screen.getByText("0 of 4 planned stones")).toBeInTheDocument());

    await finishTraining();
    const session = archivedSession();
    expect(session.shots).toHaveLength(1);
    expect(session.shots[0].releaseTime).toBeCloseTo(3.7);
    expect(session.captureSequence?.status).toBe("cancelled");
  });

  it("survives a reload after early progression and after finishing", async () => {
    seedPlan("Two Timing Steps", [
      releaseTimingStep("step-1", 4),
      releaseTimingStep("step-2", 4),
    ]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 4 planned stones"));
    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    addShot("3.80");
    await waitFor(() => screen.getByText("1 of 4 planned stones"));

    // Cold remount — the migrated plan execution must still be on step 2.
    cleanup();
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    expect(screen.getByText("1 of 4 planned stones")).toBeInTheDocument();

    await finishTraining();
    expect(archivedSession().shots).toHaveLength(2);

    cleanup();
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    // A finished training does not reappear after a reload; Train is back to its
    // ordinary entry point and the archived Session is untouched.
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    expect(archivedSession().shots).toHaveLength(2);
  });
});

// --- Independently reviewed progression defects (correction pass) -----------------
//
// These six behaviours were confirmed as real defects by independent review. They
// predate measured-quantity support and are unrelated to it; they are proven here
// through the same real orchestration and persistence boundaries as the suites above.
describe("Training Plan progression — reviewed correction regressions", () => {
  it("cannot accept a stone into a training whose archive snapshot is already chosen", async () => {
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));
    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 4 planned stones"));

    // Hold the archive write open, so the transition is genuinely in flight.
    const original = sessionRepository.archiveAndReplace.bind(sessionRepository);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(sessionRepository, "archiveAndReplace")
      .mockImplementation(async (history, current) => {
        await held;
        return original(history, current);
      });

    screen.getByRole("button", { name: "Finish Training" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Finish Training" }));
    screen.getByRole("button", { name: "Finish" }).click();
    await waitFor(() => expect(spy).toHaveBeenCalled());

    // The entry control is refused for the duration rather than accepting a stone
    // that could not be part of the snapshot already taken.
    const addButton = screen.queryByRole("button", { name: "Save Shot" });
    if (addButton) expect(addButton).toBeDisabled();

    await act(async () => release());
    await waitFor(() => screen.getByText("Training finished"));

    // Exactly the one stone recorded before the transition, never a lost second one.
    expect(archivedSession().shots).toHaveLength(1);
    expect(archivedSession().shots[0].releaseTime).toBe(3.75);
  });

  it("reports a failed persistence of Next Exercise instead of silently disagreeing with storage", async () => {
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("curling-release-tracker-current-session")!)
          .planExecution.activeStepIndex
      ).toBe(0)
    );

    vi.spyOn(sessionRepository, "saveCurrent").mockResolvedValue({
      ok: false,
      error: { kind: "storage_unavailable" },
    } as never);

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));

    // The athlete is told the change is not yet saved, rather than left with a screen
    // and a storage state that disagree and no visible retry path.
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/i);
  });

  it("offers no destructive Abandon action for a curated exercise inside a plan", async () => {
    seedPlan("Curated", [
      curatedStep("guards", EIGHT_GUARDS_VERSION_ID),
      releaseTimingStep("two", 4),
    ]);
    await startSeededPlan();
    await waitFor(() =>
      screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" })
    );

    // Abandoning would discard the execution the active plan step is bound to and
    // strand the plan without navigation. The non-destructive controls remain.
    expect(screen.queryByRole("button", { name: "Abandon Exercise" })).toBeNull();
    expect(screen.getByRole("button", { name: "Next Exercise" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish Training" })).toBeInTheDocument();
  });

  it("does not call a training completed when an earlier step was skipped", async () => {
    seedPlan("Timing", [releaseTimingStep("one", 1), releaseTimingStep("two", 1)]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    // Skip step 1 entirely, then complete step 2's planned volume.
    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 1 planned stone"));

    screen.getByRole("button", { name: "Finish Training" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Finish Training" }));

    expect(screen.queryByText("Save this completed training to history?")).toBeNull();
    expect(
      screen.getByText(/planned work you did not record stays unrecorded/)
    ).toBeInTheDocument();
  });

  it("calls a training completed only when every planned step was completed", async () => {
    seedPlan("Timing", [releaseTimingStep("one", 1), releaseTimingStep("two", 1)]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 1 planned stone"));
    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    addShot("3.80");
    await waitFor(() => screen.getByText("1 of 1 planned stone"));

    screen.getByRole("button", { name: "Finish Training" }).click();
    await waitFor(() => screen.getByRole("heading", { name: "Finish Training" }));
    expect(
      screen.getByText("Save this completed training to history?")
    ).toBeInTheDocument();
  });

  it("counts recorded Shotmaking stones in the finish summary, not only release-time shots", async () => {
    seedPlan("Shotmaking", [
      curatedStep("guards", EIGHT_GUARDS_VERSION_ID),
      releaseTimingStep("two", 4),
    ]);
    await startSeededPlan();
    await waitFor(() =>
      screen.getByRole("heading", { name: "Eight Guards, Progressively Longer" })
    );

    screen.getByRole("button", { name: "Inhandle" }).click();
    screen.getByRole("button", { name: "4 points, 100 percent" }).click();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Record Stone" })).toBeEnabled()
    );
    screen.getByRole("button", { name: "Record Stone" }).click();
    await waitFor(() => screen.getByText("1 stone recorded"));

    await finishTraining();

    // The summary's own total line — never "0 stones recorded" after a recorded stone.
    const total = screen.getByText(/stones? recorded ·/);
    expect(total.textContent).toMatch(/^1 stone recorded/);
    expect(screen.queryByText(/^0 stones recorded/)).toBeNull();
  });

  it("does not let an older write's success acknowledge a newer transition", async () => {
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("curling-release-tracker-current-session")!)
          .planExecution.activeStepIndex
      ).toBe(0)
    );

    // Write #1 (the recorded stone) is held open and will SUCCEED.
    // Write #2 (the advanced plan step) will FAIL.
    const original = sessionRepository.saveCurrent.bind(sessionRepository);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const spy = vi
      .spyOn(sessionRepository, "saveCurrent")
      .mockImplementation(async (session) => {
        calls += 1;
        if (calls === 1) {
          await held;
          return original(session);
        }
        return { ok: false, error: { kind: "unknown", message: "test" } };
      });

    addShot("3.75");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));

    await act(async () => release());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    // Object inequality establishes neither ordering nor persistence: the older
    // write's success says nothing about the advance, so the failure must surface.
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/i);

    // And a real retry is offered, without forcing the athlete to finish training.
    expect(
      screen.getByRole("button", { name: "Try Saving Again" })
    ).toBeInTheDocument();
  });

  it("reports the failure when a coalesced metadata edit supersedes the advance", async () => {
    // The advanced Session and the renamed Session are two different objects created
    // in one React batch. Only the renamed one is ever written. If sequence coverage
    // did not reach objects produced by a `setCurrentSession` updater, that write
    // would look OLDER than the advance and could never acknowledge it — leaving a
    // failed save with no visible error at all.
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("curling-release-tracker-current-session")!)
          .planExecution.activeStepIndex
      ).toBe(0)
    );

    const spy = vi.spyOn(sessionRepository, "saveCurrent").mockResolvedValue({
      ok: false,
      error: { kind: "unknown", message: "test" },
    });

    await act(async () => {
      screen.getByRole("button", { name: "Next Exercise" }).click();
      await Promise.resolve();
      fireEvent.change(screen.getByPlaceholderText("e.g. Draw Training"), {
        target: { value: "Changed name" },
      });
    });

    await waitFor(() => screen.getByText(/Step 2 of 2/));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/i);
  });

  it("an older metadata save cannot consume the newer transition's acknowledgement", async () => {
    // Ordering must be fixed when a write is SUBMITTED, not when it settles. Here the
    // older (title) write is submitted first and held, the advance is committed while
    // it is in flight, and the older write then succeeds. If the older snapshot were
    // given its position at settlement it would outrank the advance, report
    // "superseded", and remove the waiter before the advance's own write failed.
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("curling-release-tracker-current-session")!)
          .planExecution.activeStepIndex
      ).toBe(0)
    );

    const original = sessionRepository.saveCurrent.bind(sessionRepository);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const spy = vi
      .spyOn(sessionRepository, "saveCurrent")
      .mockImplementation(async (session) => {
        calls += 1;
        if (calls === 1) {
          await held;
          return original(session);
        }
        return { ok: false, error: { kind: "unknown", message: "test" } };
      });

    fireEvent.change(screen.getByPlaceholderText("e.g. Draw Training"), {
      target: { value: "Older metadata change" },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));

    await act(async () => release());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeNull());
    expect(screen.getByRole("alert").textContent).toMatch(/could not be saved/i);
    expect(
      screen.getByRole("button", { name: "Try Saving Again" })
    ).toBeInTheDocument();
  });

  it("does not report a failure from a write that no longer contains the advance", async () => {
    // A superseding write may only speak for changes it actually carries. Finishing
    // the training replaces the Session entirely, so a later failure says nothing
    // about the advance and must not be surfaced as its failure.
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));
    addShot("3.75");
    await waitFor(() => screen.getByText("1 of 4 planned stones"));

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));

    await finishTraining();

    // A fresh, unrelated Session is current; no stale alert from the old transition.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears the save failure once a retry succeeds", async () => {
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    const original = sessionRepository.saveCurrent.bind(sessionRepository);
    let failNext = true;
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) => {
      if (failNext) {
        failNext = false;
        return { ok: false, error: { kind: "unknown", message: "test" } };
      }
      return original(session);
    });

    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Try Saving Again" })).not.toBeNull()
    );

    screen.getByRole("button", { name: "Try Saving Again" }).click();

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() =>
      expect(
        JSON.parse(localStorage.getItem("curling-release-tracker-current-session")!)
          .planExecution.activeStepIndex
      ).toBe(1)
    );
  });

  it("does not attribute a result received while no capture was active to the next capture", async () => {
    seedPlan("Timing", [releaseTimingStep("one", 4), releaseTimingStep("two", 4)]);
    await startSeededPlan();
    await waitFor(() => screen.getByText("Active Training Block"));

    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
    await waitFor(() => screen.getByText(/Add Result Manually/));

    // Leave step 1 — its capture closes.
    screen.getByRole("button", { name: "Next Exercise" }).click();
    await waitFor(() => screen.getByText("Auto Capture In Progress"));
    screen.getByRole("button", { name: "Leave" }).click();
    await waitFor(() => screen.getByText(/Step 2 of 2/));

    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));

    // A result arrives while NO capture is active, and step 2's capture starts before
    // the queued callback runs. Ownership is bound at receipt, so it belongs to
    // neither capture and is recorded against neither.
    await act(async () => {
      simulatorListeners[0](timingResult("received-while-closed", 3.9));
      fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
    });

    expect(screen.getByText("0 of 4 planned stones")).toBeInTheDocument();
  });
});
