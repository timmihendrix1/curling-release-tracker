// @vitest-environment jsdom
//
// Hardening tests for the session-archive transition (docs/adr/0014-session-archive-write-ordering.md's
// correction pass). Prove: the transition is single-flight (a rapid double-confirm
// cannot start `archiveAndReplace` twice); it reads the authoritative session/history
// refs, not a stale render closure; it is coordinated with the existing capture queue
// (ADR-0007) rather than a second, competing one; and each of the three
// `SessionArchiveOutcome` branches produces exactly the React-state and persistence
// effects docs/adr/0014 specifies. Uses a genuinely deferred `archiveAndReplace` mock
// for every pending-write assertion — never only a synchronous localStorage spy — per
// the review that requested this hardening pass.
import "@testing-library/jest-dom/vitest";
import { act, StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import { sessionRepository } from "../../lib/sessionRepository";
import type { TimingResult } from "../../types";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";
const SESSION_HISTORY_KEY = "curling-release-tracker-session-history";

const simulatorListeners: Array<(result: TimingResult) => void> = [];

// Intercepts the simulator module so a test can inject a TimingResult directly into
// the real processIncomingTimingResult/captureQueueRef pipeline (the same entry point
// a real device or the Auto Capture "Add Result Manually" fallback uses) without
// needing a real timer or a real simulator instance.
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function openReleaseTimingSetup() {
  await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  fireEvent.click(screen.getByRole("button", { name: "View Details: Release Time" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to Timing Setup" }));
  await waitFor(() => screen.getByText("Set Up Training Block"));
}

async function startTrainingAndAddOneShot() {
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));

  screen.getByRole("button", { name: "Start Training" }).click();
  await openReleaseTimingSetup();

  screen.getByRole("button", { name: "Start Training" }).click();
  await waitFor(() => screen.getByText("Active Training Block"));

  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
    target: { value: "3.80" },
  });
  screen.getByRole("button", { name: "Add Shot" }).click();
  await waitFor(() => screen.getByText("1 shot total"));
}

function openStartNewSessionDialog() {
  screen.getByText(/Edit Details —/).click();
  screen.getByRole("button", { name: "Start New Session" }).click();
}

describe("Session archive transition — single-flight guard", () => {
  it("invokes archiveAndReplace exactly once for two rapid confirmations landing before React removes the modal", async () => {
    const archiveSpy = vi.spyOn(sessionRepository, "archiveAndReplace");

    await startTrainingAndAddOneShot();
    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    const startButton = screen.getByRole("button", { name: "Start" });

    // Both clicks inside one `act()` call so React does not flush (and remove the
    // modal) between them — the only way to genuinely exercise the race a disabled
    // button or a settled setState could not have prevented on its own.
    act(() => {
      fireEvent.click(startButton);
      fireEvent.click(startButton);
    });

    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    expect(archiveSpy).toHaveBeenCalledTimes(1);
  });

  it("holds the same guarantee under React Strict Mode", async () => {
    const archiveSpy = vi.spyOn(sessionRepository, "archiveAndReplace");

    render(
      <StrictMode>
        <TrackerApp />
      </StrictMode>
    );
    await waitFor(() => screen.getByText("No scheduled session."));
    screen.getByRole("button", { name: "Start Training" }).click();
    await openReleaseTimingSetup();
    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));
    fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
      target: { value: "3.80" },
    });
    screen.getByRole("button", { name: "Add Shot" }).click();
    await waitFor(() => screen.getByText("1 shot total"));

    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    const startButton = screen.getByRole("button", { name: "Start" });

    act(() => {
      fireEvent.click(startButton);
      fireEvent.click(startButton);
    });

    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    expect(archiveSpy).toHaveBeenCalledTimes(1);
  });
});

describe("Session archive transition — pending-write UI safety", () => {
  it("leaves the original session fully visible while the history write is still pending, using a genuinely deferred repository mock that still performs the real write once released", async () => {
    const realArchiveAndReplace = sessionRepository.archiveAndReplace.bind(sessionRepository);
    const deferred = createDeferred<void>();
    const archiveSpy = vi
      .spyOn(sessionRepository, "archiveAndReplace")
      .mockImplementation(async (...args) => {
        await deferred.promise;
        return realArchiveAndReplace(...args);
      });

    await startTrainingAndAddOneShot();
    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(archiveSpy).toHaveBeenCalledTimes(1));
    // Still pending: the confirm dialog itself is gone (its own "Start" button no
    // longer exists), but nothing about the underlying session has changed yet — no
    // premature reset before the write is confirmed durable. (The "Start New Session"
    // *button* in the still-expanded Edit Details panel is unrelated and stays
    // present regardless — asserting on the dialog's own elements specifically.)
    expect(screen.queryByRole("heading", { name: "Start New Session" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.queryByText("Set Up Training Block")).toBeNull();
    expect(screen.getByText("Active Training Block")).toBeInTheDocument();
    expect(screen.getByText("1 shot total")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) ?? "[]")).toHaveLength(0);

    deferred.resolve();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY)!)).toHaveLength(1);
  });
});

describe("Session archive transition — failure semantics", () => {
  it("on a history-write failure, leaves currentSession and sessionHistory unchanged and permits a later retry", async () => {
    // Only the *first* call is stubbed to fail — vi.spyOn calls through to the real,
    // localStorage-backed implementation once the queued mockResolvedValueOnce is
    // consumed, so the retry actually persists for real and can be verified below.
    const archiveSpy = vi
      .spyOn(sessionRepository, "archiveAndReplace")
      .mockResolvedValueOnce({
        ok: false,
        step: "history",
        error: { kind: "unknown", message: "simulated history failure" },
      });

    await startTrainingAndAddOneShot();
    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(archiveSpy).toHaveBeenCalledTimes(1));
    // Nothing changed: same session, same shot, no history entry — retry is just
    // clicking again, no recovery UI needed.
    await waitFor(() => screen.getByText("1 shot total"));
    expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) ?? "[]")).toHaveLength(0);

    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => expect(archiveSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY)!)).toHaveLength(1);
  });

  it("on a current-session-write failure against the real localStorage-backed SessionRepository, writes history exactly once, fails only the first current-session write, and retries only that write", async () => {
    await startTrainingAndAddOneShot();

    // Spies attached only now — attaching them before startTrainingAndAddOneShot would
    // also count the unrelated saveCurrent calls that mount hydration/block-creation/
    // shot-add themselves already legitimately trigger.
    //
    // archiveAndReplace itself is a bare spy — never given a mock implementation — so
    // every assertion below exercises the real, localStorage-backed SessionRepository
    // (src/lib/sessionRepository.ts) and the real localStorageAdapter
    // (src/lib/persistence/localStorageAdapter.ts), not a stand-in result.
    const archiveSpy = vi.spyOn(sessionRepository, "archiveAndReplace");
    const saveCurrentSpy = vi.spyOn(sessionRepository, "saveCurrent");
    const saveHistorySpy = vi.spyOn(sessionRepository, "saveHistory");

    // The actual failure boundary: localStorage.setItem itself, spied at the
    // Storage.prototype level — the same boundary localStorageAdapter.ts wraps in
    // try/catch and classifies via classifyWriteError. Every call is logged in
    // setItemCallLog (a plain array, unaffected by the spy being restored mid-test)
    // before deciding whether to fail it, so call order/count stay verifiable even
    // after the intentional failure below restores normal behaviour.
    const setItemCallLog: Array<{ key: string; value: string }> = [];
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(function (this: Storage, key: string, value: string) {
        setItemCallLog.push({ key, value });

        if (key === CURRENT_SESSION_KEY) {
          // Exactly one intentional failure: restore normal setItem behaviour
          // immediately, before throwing, so every other write — including the
          // ordinary current-session retry this failure is expected to trigger —
          // goes through the real, unmodified implementation.
          setItemSpy.mockRestore();
          throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        }

        return originalSetItem.call(this, key, value);
      });

    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    // React state still advances — the archive itself is already durable — so the UI
    // reaches the fresh, post-archive session. Per docs/adr/0014, this only happens
    // once archiveAndReplace's own promise has resolved, which — given its sequential
    // `await`s — only happens after the history write already succeeded and the
    // current-session write was already attempted (and, here, failed) — i.e. the UI
    // never advances to new-session setup before history is durable.
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // 1. archiveAndReplace invoked exactly once.
    expect(archiveSpy).toHaveBeenCalledTimes(1);
    const outcome = await archiveSpy.mock.results[0].value;
    // 4. The first coordinated CURRENT_SESSION_KEY write fails, classified exactly as
    // localStorageAdapter's classifyWriteError would classify a real QuotaExceededError.
    expect(outcome).toEqual({
      ok: false,
      step: "current",
      error: { kind: "quota_exceeded" },
    });

    const historyWriteCount = setItemCallLog.filter(
      (call) => call.key === SESSION_HISTORY_KEY
    ).length;
    const currentSessionWriteCountDuringArchive = setItemCallLog.filter(
      (call) => call.key === CURRENT_SESSION_KEY
    ).length;
    // 2. SESSION_HISTORY_KEY written exactly once.
    expect(historyWriteCount).toBe(1);
    // History is attempted (and, since it's never made to fail, succeeds) strictly
    // before the current-session write is even attempted — the real sequential-await
    // ordering docs/adr/0014 requires, not merely a same-tick coincidence.
    expect(setItemCallLog[0].key).toBe(SESSION_HISTORY_KEY);
    // Exactly one raw setItem attempt against CURRENT_SESSION_KEY happened while
    // archiveAndReplace itself was running — the one that failed.
    expect(currentSessionWriteCountDuringArchive).toBe(1);

    // 3. The stored history contains exactly one archived session with the original shot.
    const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY)!);
    expect(history).toHaveLength(1);
    expect(history[0].shots).toHaveLength(1);
    expect(history[0].shots[0].releaseTime).toBeCloseTo(3.8);

    // 5. The ordinary history save effect must not repeat archiveAndReplace's own
    // (real, already-durable) history write.
    expect(saveHistorySpy).not.toHaveBeenCalled();
    // 6. The ordinary current-session save effect performs exactly one natural retry
    // of the one write that actually failed.
    expect(saveCurrentSpy).toHaveBeenCalledTimes(1);
    // 8. No second history write occurs during that retry — saveHistory (above) was
    // never called at all, and this repeats the same guarantee at the raw storage
    // level: still exactly one SESSION_HISTORY_KEY write in the whole log.
    expect(
      setItemCallLog.filter((call) => call.key === SESSION_HISTORY_KEY)
    ).toHaveLength(1);

    // 7. The retry persists the new, empty replacement current session successfully —
    // proven directly against real localStorage, written by setItem's now-restored,
    // unmodified implementation.
    const storedCurrent = JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!);
    expect(storedCurrent.shots).toHaveLength(0);
  });

  it("on success, both ordinary save effects perform zero additional writes for the transition", async () => {
    await startTrainingAndAddOneShot();

    const archiveSpy = vi.spyOn(sessionRepository, "archiveAndReplace");
    const saveCurrentSpy = vi.spyOn(sessionRepository, "saveCurrent");
    const saveHistorySpy = vi.spyOn(sessionRepository, "saveHistory");

    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    // Give any further, independently-scheduled render/effect cycle a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(archiveSpy).toHaveBeenCalledTimes(1);
    expect(saveCurrentSpy).not.toHaveBeenCalled();
    expect(saveHistorySpy).not.toHaveBeenCalled();
  });
});

describe("Session archive transition — capture coordination", () => {
  it("archives a shot captured via Auto Capture (routed through captureQueueRef), not just classic manual entry", async () => {
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    screen.getByRole("button", { name: "Start Training" }).click();
    await openReleaseTimingSetup();
    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));

    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
    await waitFor(() => screen.getByText(/Add Result Manually/));

    // Auto Capture is additive, not exclusive (docs/SYSTEM_ARCHITECTURE.md) — classic
    // ShotEntry's own "3.75 or 375" input can be simultaneously present, so scope this
    // query to the "Add Result Manually" panel specifically, via its "Add" button's
    // container, rather than the ambiguous placeholder text alone.
    const addResultContainer = screen.getByRole("button", { name: "Add" }).closest("div")!;
    fireEvent.change(within(addResultContainer).getByPlaceholderText("3.75 or 375"), {
      target: { value: "3.80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() => screen.getByText(/1 \/ \d+ shots/));

    // Leaving Auto Capture is required before Start New Session's own dialog — the
    // shot itself is already committed to session.shots by this point, unaffected by
    // the sequence's own status changing to "cancelled".
    screen.getByText(/Edit Details —/).click();
    fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));
    await waitFor(() => screen.getByText("Auto Capture In Progress"));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY)!);
    expect(history).toHaveLength(1);
    expect(history[0].shots).toHaveLength(1);
    expect(history[0].shots[0].releaseTime).toBeCloseTo(3.8);
  });

  it("a capture-queue event submitted while the archive's own persistence write is pending does not break the queue or corrupt the outcome", async () => {
    // Note on scope: today's product already forces any active Capture Sequence to be
    // cancelled (via the "Auto Capture In Progress" dialog) before the archive's own
    // confirmation is even reachable, so there is no reachable product state where a
    // *still-accepting* sequence coexists with a pending archive write — this test
    // proves the queue-coordination mechanism itself stays safe (no crash, no wedged
    // queue, no corrupted final state) if a capture event arrives during that window
    // regardless, as defence for any future caller, not a claim that today's UI can
    // trigger a data-loss variant of this race.
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const realArchiveAndReplace = sessionRepository.archiveAndReplace.bind(sessionRepository);
    const deferred = createDeferred<void>();
    vi.spyOn(sessionRepository, "archiveAndReplace").mockImplementation(async (...args) => {
      await deferred.promise;
      return realArchiveAndReplace(...args);
    });

    await startTrainingAndAddOneShot();
    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(simulatorListeners).toHaveLength(1));

    // Injected while the archive's own write is still pending — queued behind it on
    // captureQueueRef, per docs/adr/0014's Decision 7.
    act(() => {
      simulatorListeners[0]({
        id: "late-result",
        receivedAt: new Date().toISOString(),
        source: "manual",
        measurements: [{ measurementMode: "back-hog", value: 3.9 }],
      });
    });

    deferred.resolve();
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    const history = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY)!);
    expect(history).toHaveLength(1);
    expect(history[0].shots).toHaveLength(1);
    const current = JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!);
    expect(current.shots).toHaveLength(0);
  });
});

describe("Session archive transition — ordinary persistence still works", () => {
  it("persists a genuine subsequent edit normally after a successful archive (the effect-suppression guard self-expires)", async () => {
    const saveCurrentSpy = vi.spyOn(sessionRepository, "saveCurrent");

    await startTrainingAndAddOneShot();
    openStartNewSessionDialog();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));

    saveCurrentSpy.mockClear();

    await openReleaseTimingSetup();
    screen.getByRole("button", { name: "Start Training" }).click();
    await waitFor(() => screen.getByText("Active Training Block"));
    fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), {
      target: { value: "3.90" },
    });
    screen.getByRole("button", { name: "Add Shot" }).click();
    await waitFor(() => screen.getByText("1 shot total"));

    await waitFor(() => expect(saveCurrentSpy).toHaveBeenCalled());
    const stored = JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!);
    expect(stored.shots).toHaveLength(1);
  });
});
