// @vitest-environment jsdom
//
// Completion scope, entry reachability, result truthfulness and history selection —
// the Stage B review reproductions that are about what the athlete can REACH, not
// about what a helper computes.
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import {
  bothBlock,
  bothShot,
  legacyTimeBlock,
  session as measurementSession,
  speedBlock,
  speedShot,
  timeShot,
} from "../../lib/measurement/__tests__/measurementFixtures";
import type { Session } from "../../types";
import {
  buildHistoryAnalysisContext,
  createDefaultHistoryFilters,
} from "../../lib/historyAnalysis";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";
const SESSION_HISTORY_KEY = "curling-release-tracker-session-history";

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

function stored(): Session {
  return JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!) as Session;
}

async function openTraining(state: Session) {
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));
  navButton("Train").click();
  await waitFor(() => screen.getByText("Active Training Block"));
  await act(async () => {});
}

// --- Completion scope -----------------------------------------------------------

describe("completion covers the whole current training", () => {
  it("still offers a stone left half-measured in an EARLIER block", async () => {
    const earlier = bothBlock({ completedAt: "2026-10-07T10:00:00.000Z" });
    const current = speedBlock();
    const state = measurementSession([earlier, current], []);
    state.shots = [
      timeShot(earlier, 3.7, { sessionId: state.id, id: "old-1", shotNumber: 1 }),
    ];

    await openTraining(state);

    // Moving on to the next exercise must not strand the measurement.
    expect(
      screen.getByRole("button", { name: /Stone 1 · In Handle/ })
    ).toBeInTheDocument();
  });

  it("names the block, so repeated stone numbers stay distinguishable", async () => {
    const earlier = bothBlock({ completedAt: "2026-10-07T10:00:00.000Z" });
    const current = bothBlock();
    const state = measurementSession([earlier, current], []);
    state.shots = [
      timeShot(earlier, 3.7, { sessionId: state.id, id: "old-1", shotNumber: 1 }),
      timeShot(current, 3.8, { sessionId: state.id, id: "new-1", shotNumber: 1 }),
    ];

    await openTraining(state);

    // Two different stones both numbered 1; the identity has to say which is which.
    const rows = screen.getAllByRole("button", { name: /Stone 1 · In Handle/ });
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(earlier.name);
  });

  it("distinguishes two default-named blocks holding identical stones", async () => {
    // Both exercises keep the DEFAULT name, and each holds a stone 1, In Handle, at
    // exactly 3.70s. Name, number, handle and value together still do not tell them
    // apart — so the athlete cannot intentionally choose one without more.
    const first = bothBlock({
      name: "Fixed Weight Block",
      completedAt: "2026-10-07T10:00:00.000Z",
    });
    const second = bothBlock({ name: "Fixed Weight Block" });
    const state = measurementSession([first, second], []);
    state.shots = [
      timeShot(first, 3.7, { sessionId: state.id, id: "a", shotNumber: 1 }),
      timeShot(second, 3.7, { sessionId: state.id, id: "b", shotNumber: 1 }),
    ];

    await openTraining(state);

    const rows = screen.getAllByRole("button", { name: /Stone 1 · In Handle/ });
    expect(rows).toHaveLength(2);
    // Their visible (and accessible) descriptions must actually differ.
    expect(new Set(rows.map((row) => row.textContent)).size).toBe(2);
    expect(rows[0].textContent).toContain("Exercise 1");
    expect(rows[1].textContent).toContain("Exercise 2");
  });

  it("stays reachable when the active exercise is Blind Weight", async () => {
    // The panel used to be mounted inside the non-Blind capture branch, so an earlier
    // exercise's incomplete stone vanished the moment a Blind Weight step became
    // active. The approved scope is the current TRAINING, not a particular runner.
    const earlier = bothBlock({ completedAt: "2026-10-07T10:00:00.000Z" });
    const blind = legacyTimeBlock({ mode: "blind", blindTargetMode: "fixed" });
    const state = measurementSession([earlier, blind], []);
    state.shots = [
      timeShot(earlier, 3.7, { sessionId: state.id, id: "old-1", shotNumber: 1 }),
    ];

    await openTraining(state);

    expect(
      screen.getByRole("button", { name: /Stone 1 · In Handle/ })
    ).toBeInTheDocument();
  });

  it("completes the earlier block's stone without touching the active block", async () => {
    const earlier = bothBlock({ completedAt: "2026-10-07T10:00:00.000Z" });
    const current = speedBlock();
    const state = measurementSession([earlier, current], []);
    state.shots = [
      timeShot(earlier, 3.7, { sessionId: state.id, id: "old-1", shotNumber: 1 }),
    ];

    await openTraining(state);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() =>
      expect(stored().shots.find((shot) => shot.id === "old-1")?.speed).toBe(2.41)
    );

    const completed = stored().shots.find((shot) => shot.id === "old-1")!;
    // It was judged against the EARLIER block's target, not the active block's.
    expect(completed.targetSpeed).toBe(2.4);
    expect(completed.blockId).toBe(earlier.id);
    // The active block gained nothing, and the stone count did not change.
    expect(stored().shots).toHaveLength(1);
    expect(stored().activeBlockId).toBe(current.id);
  });
});

// --- Entry reachability ---------------------------------------------------------

describe("a Speed block is always recordable", () => {
  it("offers manual entry even when Auto Capture was selected in the previous block", async () => {
    await openTraining(measurementSession([bothBlock()], []));

    // Select Auto Capture WITHOUT starting a sequence, then move to a Speed block.
    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "New Training Block" }));
    fireEvent.click(screen.getByRole("radio", { name: "Speed (m/s)" }));
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));

    await waitFor(() => expect(stored().blocks).toHaveLength(2));

    // Auto Capture is a time path and is not offered here; manual entry must be.
    expect(screen.queryByRole("tab", { name: "Auto Capture" })).toBeNull();
    expect(screen.getByLabelText("Speed (m/s)")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(stored().shots).toHaveLength(1));
  });

  it("restores manual entry for a speed block after a reload", async () => {
    await openTraining(measurementSession([speedBlock()], []));
    cleanup();

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByText("Active Training Block"));

    expect(screen.getByLabelText("Speed (m/s)")).toBeInTheDocument();
  });
});

// --- Truthful live summary ------------------------------------------------------

describe("the live summary never denies recorded stones", () => {
  it("does not say 'No shots yet' for a Both block holding a speed-only stone", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [speedShot(block, 2.4, { sessionId: state.id, shotNumber: 1 })];

    await openTraining(state);

    const summary = screen.getByText("Live Performance").closest("summary");
    expect(summary?.textContent).not.toContain("No shots yet");
    // The stone exists; what is absent is a TIME value, and that is said separately.
    expect(summary?.textContent).toContain("1 shot");
    expect(summary?.textContent).toContain("no release time recorded yet");
  });
});

// --- History selection ----------------------------------------------------------

describe("history selection distinguishes quantity from timing interval", () => {
  function mixedHistory(): Session[] {
    const speedSessionBlock = speedBlock();
    const speedSession = measurementSession([speedSessionBlock], []);
    speedSession.title = "Speed archive";
    speedSession.shots = [speedShot(speedSessionBlock, 2.4)];

    const timeSessionBlock = legacyTimeBlock();
    const timeSession = measurementSession([timeSessionBlock], []);
    timeSession.id = "22222222-2222-4222-8222-222222222222";
    timeSession.title = "Time archive";
    timeSession.shots = [
      timeShot(timeSessionBlock, 3.75, { sessionId: timeSession.id }),
    ];

    return [speedSession, timeSession];
  }

  async function openAnalyze(history: Session[]) {
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history));
    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Analyze").click();
    await waitFor(() => screen.getByText("Blocks and Sessions"));
  }

  it("keeps a Speed session reachable alongside a legacy Time session", async () => {
    await openAnalyze(mixedHistory());

    // A defaulted Back-Hog timing interval used to exclude the speed session, which
    // has no interval at all, with no control through which to recover it.
    expect(screen.getByText("Speed archive")).toBeInTheDocument();
    expect(screen.getByText("Time archive")).toBeInTheDocument();
  });

  it("offers an explicit measurement selection that narrows to each quantity", async () => {
    await openAnalyze(mixedHistory());

    const selector = screen.getByLabelText("Measurement");
    expect(selector).toHaveValue("");

    fireEvent.change(selector, { target: { value: "speed" } });
    await waitFor(() => expect(screen.queryByText("Time archive")).toBeNull());
    expect(screen.getByText("Speed archive")).toBeInTheDocument();
    // A timing interval means nothing for speed, so it is withheld rather than shown
    // as an inert control that cannot change anything.
    expect(screen.queryByLabelText("Measurement Mode")).toBeNull();

    fireEvent.change(screen.getByLabelText("Measurement"), {
      target: { value: "time" },
    });
    await waitFor(() => expect(screen.queryByText("Speed archive")).toBeNull());
    expect(screen.getByText("Time archive")).toBeInTheDocument();
  });

  it("keeps speed records when a stale time interval and target range are actually set", () => {
    // Driven through the real selection pipeline with the filters GENUINELY set, not
    // by opening a disclosure and hoping. Both filters are time-specific and hidden
    // in a Speed view, so a stale value must not silently empty the selection — and a
    // Both block's speed records must survive a mismatched interval.
    const block = bothBlock({ measurementMode: "hog-hog" });
    const archived = measurementSession([block], []);
    archived.shots = [
      bothShot(block, 3.85, 2.42, { sessionId: archived.id, shotNumber: 1 }),
    ];

    const context = buildHistoryAnalysisContext([archived], {
      ...createDefaultHistoryFilters(),
      measuredQuantity: "speed",
      // Both stale, both belonging to the time pipeline.
      measurementMode: "back-hog",
      targetRange: { min: 4 },
    });

    expect(context.totalShotCount).toBe(1);
    expect(context.blocks).toHaveLength(1);

    // The same filters DO still apply to a Time view, so time comparability is intact.
    const timeContext = buildHistoryAnalysisContext([archived], {
      ...createDefaultHistoryFilters(),
      measuredQuantity: "time",
      measurementMode: "back-hog",
    });
    expect(timeContext.totalShotCount).toBe(0);
  });

  it("reports speed figures, not time figures, when Speed is selected", async () => {
    const block = bothBlock();
    const archived = measurementSession([block], []);
    archived.title = "Both history";
    // time 3.85 vs 3.75 => +0.10s;  speed 2.42 vs 2.40 => +0.02 m/s.
    archived.shots = [
      bothShot(block, 3.85, 2.42, { sessionId: archived.id, shotNumber: 1 }),
    ];

    await openAnalyze([archived]);
    fireEvent.change(screen.getByLabelText("Measurement"), {
      target: { value: "speed" },
    });

    const summary = screen.getByText("Key Progress Summary").parentElement;
    if (!summary) throw new Error("expected the summary panel");

    // The selected measurement governs the FIGURES, their unit and their tolerance
    // labels — not merely which blocks were included.
    expect(summary.textContent).toContain("0.02 m/s");
    expect(summary.textContent).not.toContain("0.10s");
    expect(summary.textContent).toContain("±0.05m/s");
    // A Back-Hog weight tendency is a time interpretation and has no approved speed
    // mapping, so it must not appear.
    expect(summary.textContent).not.toMatch(/more weight|less weight/);
  });

  it("withholds the time-only charts and handle comparison in a Speed view", async () => {
    const block = bothBlock();
    const archived = measurementSession([block], []);
    archived.title = "Both history";
    archived.shots = [
      bothShot(block, 3.85, 2.42, { sessionId: archived.id, shotNumber: 1 }),
      bothShot(block, 3.7, 2.38, {
        sessionId: archived.id,
        id: "second",
        shotNumber: 2,
        handle: "out",
      }),
    ];

    await openAnalyze([archived]);

    // Present for Time…
    expect(screen.getByText("Handle Bias and Consistency")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Measurement"), {
      target: { value: "speed" },
    });

    // …and withheld for Speed rather than relabelled: every one of them plots a
    // release time against a time target.
    await waitFor(() =>
      expect(screen.queryByText("Handle Bias and Consistency")).toBeNull()
    );
    expect(
      screen.getByText(/Charts and handle comparison are available for release time/)
    ).toBeInTheDocument();
  });
});

// --- Finish flow ----------------------------------------------------------------

describe("direct training can be finished", () => {
  it("offers Finish Training and archives everything recorded", async () => {
    const block = speedBlock();
    const state = measurementSession([block], []);
    state.shots = [speedShot(block, 2.45, { sessionId: state.id })];

    await openTraining(state);

    const finish = screen.getByRole("button", { name: "Finish Training" });
    expect(finish).toBeInTheDocument();

    fireEvent.click(finish);
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      const history = JSON.parse(
        localStorage.getItem(SESSION_HISTORY_KEY) ?? "[]"
      ) as Session[];
      expect(history).toHaveLength(1);
      expect(history[0].shots[0].speed).toBe(2.45);
    });
  });

  it("keeps a partial Both stone when finishing", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      timeShot(block, 3.7, { sessionId: state.id, id: "partial", shotNumber: 1 }),
    ];

    await openTraining(state);

    fireEvent.click(screen.getByRole("button", { name: "Finish Training" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => {
      const history = JSON.parse(
        localStorage.getItem(SESSION_HISTORY_KEY) ?? "[]"
      ) as Session[];
      expect(history).toHaveLength(1);
      const shot = history[0].shots[0];
      // Kept exactly as recorded: a real time, and a speed that is genuinely absent.
      expect(shot.releaseTime).toBe(3.7);
      expect("speed" in shot).toBe(false);
    });
  });
});
