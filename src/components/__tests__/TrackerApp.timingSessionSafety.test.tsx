// @vitest-environment jsdom
//
// Correction tests for PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md's Timing Simulator
// gating claim (Section 4/8: "verified true by code inspection... not by an
// automated regression test"). Session is the one domain the pre-existing
// top-level `!currentSession` render gate already made structurally safe
// while *loading* — these tests prove that explicitly, and additionally prove
// the correction's new requirement: Session must also stay non-mutable, with
// the Timing Simulator inactive and no timing result processed, after a
// genuine read failure ("write_protected"), which the render gate alone does
// not cover (currentSession is non-null — the fallback session — by then).
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import { sessionRepository } from "../../lib/sessionRepository";
import { historyFiltersRepository } from "../../lib/historyFiltersRepository";
import { trainingPlansRepository } from "../../lib/trainingPlans/repository";
import { accuracyToleranceProfilesRepository } from "../../lib/accuracyToleranceProfiles/repository";
import { smartRandomProfilesRepository } from "../../lib/smartRandomProfiles/repository";
import { assessmentRepository } from "../../lib/assessment/repository";
import { createEmptyAssessmentPersistedState } from "../../lib/assessment/persistence";
import { loadedAbsent, loadedValue, loadFailed } from "../../lib/persistence/types";
import type { Session } from "../../types";

const simulatorSpies = vi.hoisted(() => ({
  subscribe: vi.fn(() => () => {}),
  start: vi.fn(),
  stop: vi.fn(),
  createCount: 0,
}));

// Intercepts the one SimulatorTimingProvider instance TrackerApp creates
// (`useState(() => createSimulatorTimingProvider())`) so these tests can
// assert directly on subscribe()/start() call counts — outcome-level
// assertions (e.g. "no shot was added") alone wouldn't distinguish "the
// effect correctly never subscribed" from "it subscribed, but no result
// happened to arrive."
vi.mock("../../lib/simulatorTimingProvider", () => ({
  createSimulatorTimingProvider: () => {
    simulatorSpies.createCount += 1;
    return {
      type: "simulator",
      subscribe: simulatorSpies.subscribe,
      start: simulatorSpies.start,
      stop: simulatorSpies.stop,
      simulateResult: vi.fn(),
      simulateMultiMeasurementResult: vi.fn(),
      simulateDuplicate: vi.fn(),
      simulateDelayed: vi.fn(),
      simulateInvalidResult: vi.fn(),
    };
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  simulatorSpies.subscribe.mockClear();
  simulatorSpies.start.mockClear();
  simulatorSpies.stop.mockClear();
});

beforeEach(() => {
  localStorage.clear();
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function stubUnrelatedDomainsReady() {
  vi.spyOn(historyFiltersRepository, "load").mockResolvedValue(loadedAbsent());
  vi.spyOn(trainingPlansRepository, "loadPlans").mockResolvedValue(loadedAbsent());
  vi.spyOn(accuracyToleranceProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
  vi.spyOn(smartRandomProfilesRepository, "loadState").mockResolvedValue(loadedAbsent());
  vi.spyOn(assessmentRepository, "loadState").mockResolvedValue(
    loadedValue({ state: createEmptyAssessmentPersistedState(), currentRunQuarantined: false })
  );
}

function sessionWithFixedBlock(): Session {
  return {
    id: "fallback-session",
    title: "",
    date: new Date().toISOString(),
    notes: "",
    blocks: [
      {
        id: "block-1",
        name: "Block 1",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: new Date().toISOString(),
        accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
      },
    ],
    activeBlockId: "block-1",
    shots: [],
  } as unknown as Session;
}

describe("TrackerApp — Timing Simulator / manual entry safety while Session is loading", () => {
  it("subscribes to nothing and renders no interactive control while Session's own load is still pending", async () => {
    stubUnrelatedDomainsReady();
    const deferred = createDeferred<ReturnType<typeof loadedAbsent<Session>>>();
    vi.spyOn(sessionRepository, "loadCurrent").mockReturnValue(deferred.promise);
    vi.spyOn(sessionRepository, "loadHistory").mockResolvedValue(loadedAbsent());

    const { container } = render(<TrackerApp />);

    // The pre-existing top-level `!currentSession` gate renders nothing at
    // all — no manual-entry input, no Timing Simulator panel, nothing to
    // interact with — and the subscription effect's own guard means it
    // never calls subscribe()/start() either.
    expect(container).toBeEmptyDOMElement();
    expect(simulatorSpies.subscribe).not.toHaveBeenCalled();
    expect(simulatorSpies.start).not.toHaveBeenCalled();

    deferred.resolve(loadedAbsent());
    await waitFor(() => screen.getByText("No scheduled session."));

    // Once Session is genuinely ready ("absent" -> the new-session default),
    // the simulator subscribes exactly once.
    await waitFor(() => expect(simulatorSpies.subscribe).toHaveBeenCalledTimes(1));
    expect(simulatorSpies.start).toHaveBeenCalledTimes(1);
  });

  it("enables the Timing Simulator only after a genuine stored session ('value') has been initialized, not merely once loading settles", async () => {
    stubUnrelatedDomainsReady();
    const deferred = createDeferred<ReturnType<typeof loadedValue<Session>>>();
    vi.spyOn(sessionRepository, "loadCurrent").mockReturnValue(deferred.promise);
    vi.spyOn(sessionRepository, "loadHistory").mockResolvedValue(loadedAbsent());

    render(<TrackerApp />);
    expect(simulatorSpies.subscribe).not.toHaveBeenCalled();

    deferred.resolve(loadedValue(sessionWithFixedBlock()));
    await waitFor(() => screen.getAllByText("Home")[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Train" })[0]);
    await waitFor(() => screen.getByText("Active Training Block"));
    await waitFor(() => expect(simulatorSpies.subscribe).toHaveBeenCalledTimes(1));
  });
});

describe("TrackerApp — Timing Simulator / manual entry safety after a Session read failure", () => {
  it("never subscribes, and manual entry has no effect, once Session is write_protected", async () => {
    stubUnrelatedDomainsReady();
    vi.spyOn(sessionRepository, "loadCurrent").mockResolvedValue(
      loadFailed(sessionWithFixedBlock(), { kind: "unknown", message: "boom" })
    );
    vi.spyOn(sessionRepository, "loadHistory").mockResolvedValue(loadedAbsent());
    const saveCurrentSpy = vi.spyOn(sessionRepository, "saveCurrent");
    const saveHistorySpy = vi.spyOn(sessionRepository, "saveHistory");

    render(<TrackerApp />);
    await waitFor(() => screen.getAllByText("Home")[0]);

    const trainButtons = screen.getAllByRole("button", { name: "Train" });
    fireEvent.click(trainButtons[0]);
    await waitFor(() => screen.getByText("Active Training Block"));

    // The fallback session (with its block) is displayed — but never
    // subscribed to the Timing Simulator.
    expect(simulatorSpies.subscribe).not.toHaveBeenCalled();
    expect(simulatorSpies.start).not.toHaveBeenCalled();

    // Manual entry: typing and submitting a shot must have no effect.
    fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
      target: { value: "3.80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Shot" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText("1 shot total")).toBeNull();
    expect(saveCurrentSpy).not.toHaveBeenCalled();
    expect(saveHistorySpy).not.toHaveBeenCalled();
  });

  it("cannot start an Auto Capture sequence once Session is write_protected — a second, independent entry point into the same TimingResult queue", async () => {
    stubUnrelatedDomainsReady();
    vi.spyOn(sessionRepository, "loadCurrent").mockResolvedValue(
      loadFailed(sessionWithFixedBlock(), { kind: "unknown", message: "boom" })
    );
    vi.spyOn(sessionRepository, "loadHistory").mockResolvedValue(loadedAbsent());
    const saveCurrentSpy = vi.spyOn(sessionRepository, "saveCurrent");

    render(<TrackerApp />);
    await waitFor(() => screen.getAllByText("Home")[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Train" })[0]);
    await waitFor(() => screen.getByText("Active Training Block"));

    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // handleStartCaptureSequence's guard means the sequence never actually
    // starts — the Start button is still there, and Session was never
    // written to.
    expect(screen.getByRole("button", { name: "Start Auto Capture" })).toBeInTheDocument();
    expect(saveCurrentSpy).not.toHaveBeenCalled();
  });
});
