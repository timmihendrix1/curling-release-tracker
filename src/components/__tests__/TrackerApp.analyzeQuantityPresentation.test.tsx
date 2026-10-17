// @vitest-environment jsdom
//
// Analyze's measured-quantity handling, end to end through the rendered screen.
//
// Three separate ways it previously disagreed with its own calculations: a speed-only
// history defaulted to an empty TIME summary with no selector to escape it; the
// context line claimed seconds comparison thresholds governed m/s results; and a
// session whose blocks had different speed bands lost its speed summary entirely
// because no single cutoff could be named.
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import { createDefaultHistoryFilters } from "../../lib/historyAnalysis";
import type { Session } from "../../types";

const SESSION_HISTORY_KEY = "curling-release-tracker-session-history";
const HISTORY_FILTERS_KEY = "curling-release-tracker-history-filters";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

async function openAnalyze(history: Session[]) {
  localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(history));
  render(<TrackerApp />);
  await waitFor(() => screen.getByTestId("house-home"));
  screen.getAllByRole("button", { name: "Analyze" })[0].click();
  await waitFor(() => screen.getByText("Blocks and Sessions"));
}

function summaryPanel(): HTMLElement {
  const heading = screen.getByRole("heading", { name: "Key Progress Summary" });
  const panel = heading.parentElement;
  if (!panel) throw new Error("expected the summary panel");
  return panel;
}

describe("the default All measurements view represents what is actually present", () => {
  it("shows speed results for a speed-only history, with no selector required", async () => {
    const block = speedBlock();
    const archived = measurementSession([block], []);
    archived.title = "Speed only";
    // 2.42 against 2.40 => +0.02 m/s.
    archived.shots = [speedShot(block, 2.42, { sessionId: archived.id })];

    await openAnalyze([archived]);

    // A single available quantity is deliberately NOT auto-selected, so there is no
    // selector to reach — the default view has to represent it on its own.
    expect(screen.queryByLabelText("Measurement")).toBeNull();

    const summary = summaryPanel();
    expect(summary.textContent).toContain("0.02 m/s");
    // No fabricated empty time result for training that measured no time.
    expect(summary.textContent).not.toContain("0.00s");
    expect(summary.textContent).not.toContain("Not enough shots");

    // And no seconds-only control is offered where it could only be inert, which
    // would imply it governs these m/s results.
    expect(screen.queryByLabelText("Threshold Comparison Mode")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    expect(screen.queryByText("Target min (s)")).toBeNull();
  });

  it("keeps seconds and m/s in separate labelled groups when both are present", async () => {
    const both = bothBlock();
    const archived = measurementSession([both], []);
    archived.title = "Both history";
    archived.shots = [
      bothShot(both, 3.85, 2.42, { sessionId: archived.id, shotNumber: 1 }),
    ];

    await openAnalyze([archived]);

    const summary = summaryPanel();
    expect(within(summary).getByText("Time (seconds)")).toBeInTheDocument();
    expect(
      within(summary).getByText("Speed (metres per second)")
    ).toBeInTheDocument();
    // Both figures present, each in its own unit, never merged.
    expect(summary.textContent).toContain("0.10s");
    expect(summary.textContent).toContain("0.02 m/s");
  });

  it("still shows the ordinary time summary for a legacy time-only history", async () => {
    const block = legacyTimeBlock();
    const archived = measurementSession([block], []);
    archived.title = "Legacy time";
    archived.shots = [timeShot(block, 3.85, { sessionId: archived.id })];

    await openAnalyze([archived]);

    const summary = summaryPanel();
    expect(summary.textContent).toContain("0.10s");
    expect(summary.textContent).not.toContain("m/s");
  });
});

describe("Speed context agrees with the speed calculations", () => {
  it("does not claim a seconds comparison threshold governs speed results", async () => {
    const block = bothBlock();
    const archived = measurementSession([block], []);
    archived.shots = [bothShot(block, 3.85, 2.42, { sessionId: archived.id })];

    localStorage.setItem(
      HISTORY_FILTERS_KEY,
      JSON.stringify({
        ...createDefaultHistoryFilters(),
        measuredQuantity: "speed",
        thresholdComparisonMode: {
          type: "comparison",
          thresholds: { onTarget: 0.05, acceptable: 0.1 },
        },
      })
    );

    await openAnalyze([archived]);

    // The figures are judged by the block's own SPEED snapshot; saying otherwise
    // would name a cutoff nothing was measured against.
    expect(
      screen.queryByText(/All selected shots are evaluated using/)
    ).toBeNull();
    expect(
      screen.getByText(/Speed results use each exercise's own speed tolerance/)
    ).toBeInTheDocument();
  });

  it("does not claim a seconds cutoff governs ALL shots when both quantities are shown", async () => {
    const block = bothBlock();
    const archived = measurementSession([block], []);
    archived.shots = [bothShot(block, 3.85, 2.42, { sessionId: archived.id })];

    localStorage.setItem(
      HISTORY_FILTERS_KEY,
      JSON.stringify({
        ...createDefaultHistoryFilters(),
        // Deliberately left at "All measurements".
        thresholdComparisonMode: {
          type: "comparison",
          thresholds: { onTarget: 0.05, acceptable: 0.1 },
        },
      })
    );

    await openAnalyze([archived]);

    expect(screen.getByLabelText("Measurement", { exact: true })).toHaveValue("");
    // Both summaries are on screen, and speed is classified against the block's own
    // speed snapshot — so "all selected shots" would describe neither accurately.
    expect(screen.queryByText(/All selected shots are evaluated using/)).toBeNull();
    expect(
      screen.getByText(
        /Release time results are evaluated using ±0\.05s \/ ±0\.10s\. Speed uses each exercise's own speed tolerance\./
      )
    ).toBeInTheDocument();
  });

  it("keeps the unqualified wording when only time is in view", async () => {
    const block = legacyTimeBlock();
    const archived = measurementSession([block], []);
    archived.shots = [timeShot(block, 3.85, { sessionId: archived.id })];

    localStorage.setItem(
      HISTORY_FILTERS_KEY,
      JSON.stringify({
        ...createDefaultHistoryFilters(),
        thresholdComparisonMode: {
          type: "comparison",
          thresholds: { onTarget: 0.05, acceptable: 0.1 },
        },
      })
    );

    await openAnalyze([archived]);

    // Nothing but time is shown, so the override really does govern every result.
    expect(
      screen.getByText("All selected shots are evaluated using ±0.05s / ±0.10s.")
    ).toBeInTheDocument();
  });

  it("withholds the seconds comparison and target-range controls in a Speed view", async () => {
    const speed = speedBlock();
    const speedSession = measurementSession([speed], []);
    speedSession.title = "Speed archive";
    speedSession.shots = [speedShot(speed, 2.42, { sessionId: speedSession.id })];

    const time = legacyTimeBlock();
    const timeSession = measurementSession([time], []);
    timeSession.id = "22222222-2222-4222-8222-222222222222";
    timeSession.title = "Time archive";
    timeSession.shots = [timeShot(time, 3.75, { sessionId: timeSession.id })];

    await openAnalyze([speedSession, timeSession]);

    // Offered for Time…
    expect(
      screen.getByLabelText("Threshold Comparison Mode")
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Measurement", { exact: true }), {
      target: { value: "speed" },
    });

    // …and withheld for Speed, where they neither apply nor describe anything. The
    // stored time settings are untouched, so returning to Time restores them.
    await waitFor(() =>
      expect(screen.queryByLabelText("Threshold Comparison Mode")).toBeNull()
    );
    fireEvent.click(screen.getByRole("button", { name: /More filters/ }));
    expect(screen.queryByText("Target min (s)")).toBeNull();

    fireEvent.change(screen.getByLabelText("Measurement", { exact: true }), {
      target: { value: "time" },
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Threshold Comparison Mode")).toBeInTheDocument()
    );
  });
});

describe("session speed results survive differing block tolerances", () => {
  it("aggregates against each block's own band instead of vanishing", async () => {
    // Identical +0.02 m/s deviations, judged by different On Target bands:
    // ±0.05 (on target) and ±0.01 (a major miss beyond its ±0.10 acceptable? no —
    // 0.02 is outside 0.01 On Target but inside 0.10 Acceptable).
    const wide = speedBlock();
    const tight = speedBlock({
      measurement: {
        quantities: ["speed"],
        speed: {
          target: 2.4,
          tolerance: {
            onTarget: { lower: 0.01, upper: 0.01 },
            acceptable: { lower: 0.1, upper: 0.1 },
          },
        },
      },
    });

    const archived = measurementSession([wide, tight], []);
    archived.title = "Different speed bands";
    archived.shots = [
      speedShot(wide, 2.42, { sessionId: archived.id, id: "w", shotNumber: 1 }),
      speedShot(tight, 2.42, { sessionId: archived.id, id: "t", shotNumber: 1 }),
    ];

    await openAnalyze([archived]);
    fireEvent.click(screen.getByText("Different speed bands"));
    await waitFor(() => screen.getByText("Hide Details"));

    const panel = screen.getByText("Different speed bands").closest("div")
      ?.parentElement;
    if (!panel) throw new Error("expected the session panel");

    // The session-level speed summary is present even though no single cutoff is true
    // of both blocks.
    expect(within(panel).getAllByText("Average Speed").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("2.42 m/s").length).toBeGreaterThan(0);

    // And classification follows each block's OWN band: one On Target, one Acceptable.
    const text = panel.textContent ?? "";
    expect(text).toContain("50%");
  });
});
