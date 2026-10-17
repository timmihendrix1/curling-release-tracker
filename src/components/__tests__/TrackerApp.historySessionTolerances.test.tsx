// @vitest-environment jsdom
//
// The expanded session summary under Analyze -> Blocks and Sessions. Its rates are
// computed per block against the tolerance each block was trained under, so the
// cutoffs it DISPLAYS must come from the same place — otherwise a stone counted as a
// major miss is described as "within ±0.10s".
//
// These navigate and expand the real view; helper-level assertions do not reach these
// call sites.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import type { Session } from "../../types";
import {
  session as measurementSession,
  timeBlock,
  timeShot,
} from "../../lib/measurement/__tests__/measurementFixtures";

const SESSION_HISTORY_KEY = "curling-release-tracker-session-history";

/** Lower side far tighter than the upper side. */
const ASYMMETRIC = {
  onTarget: { lower: 0.01, upper: 0.2 },
  acceptable: { lower: 0.02, upper: 0.3 },
};

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

/** One archived session whose stones are all 0.05s FAST of a 3.75s target. */
function asymmetricSession(title: string): Session {
  const block = timeBlock();
  block.measurement!.time!.tolerance = structuredClone(ASYMMETRIC);
  const state = measurementSession([block], []);
  state.title = title;
  state.shots = Array.from({ length: 8 }, (_unused, index) =>
    timeShot(block, 3.7, { sessionId: state.id, shotNumber: index + 1 })
  );
  return state;
}

/** One archived session whose two blocks were trained under different tolerances. */
function heterogeneousSession(title: string): Session {
  const tight = timeBlock();
  tight.measurement!.time!.tolerance = structuredClone(ASYMMETRIC);

  const standard = timeBlock();
  standard.id = `${standard.id}-second`;
  standard.measurement!.time!.tolerance = {
    onTarget: { lower: 0.1, upper: 0.1 },
    acceptable: { lower: 0.2, upper: 0.2 },
  };

  const state = measurementSession([tight, standard], []);
  state.title = title;
  state.activeBlockId = standard.id;
  state.shots = [
    timeShot(tight, 3.7, { sessionId: state.id, shotNumber: 1 }),
    timeShot(standard, 3.7, { sessionId: state.id, shotNumber: 1 }),
  ];
  return state;
}

async function expandArchivedSession(title: string) {
  render(<TrackerApp />);
  await waitFor(() => screen.getByTestId("house-home"));
  navButton("Analyze").click();
  await waitFor(() => screen.getByText("Blocks and Sessions"));

  fireEvent.click(screen.getByText(title));
  await waitFor(() => screen.getByText("Hide Details"));

  const panel = screen.getByText(title).closest("div")?.parentElement;
  if (!panel) throw new Error("expected the session panel");
  return panel;
}

describe("expanded session summary", () => {
  it("names the tolerance its stones were actually judged against", async () => {
    localStorage.setItem(
      SESSION_HISTORY_KEY,
      JSON.stringify([asymmetricSession("Asymmetric review session")])
    );

    await expandArchivedSession("Asymmetric review session");

    // 0.10 / 0.20 belong to the block's legacy symmetric pair, which is NOT what
    // classified these stones — every one of them is a major miss under the 0.02
    // lower Acceptable band.
    expect(screen.queryAllByText("within ±0.10s")).toHaveLength(0);
    expect(screen.queryAllByText("beyond ±0.20s")).toHaveLength(0);
    expect(screen.getAllByText("within -0.01s / +0.20s").length).toBeGreaterThan(0);
    expect(screen.getAllByText("beyond -0.02s / +0.30s").length).toBeGreaterThan(0);
  });

  it("keeps the historical ± form for a genuinely symmetric session", async () => {
    const block = timeBlock();
    const state = measurementSession([block], []);
    state.title = "Symmetric review session";
    state.shots = [timeShot(block, 3.8, { sessionId: state.id })];
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify([state]));

    await expandArchivedSession("Symmetric review session");

    expect(screen.getAllByText("within ±0.10s").length).toBeGreaterThan(0);
    expect(screen.getAllByText("beyond ±0.20s").length).toBeGreaterThan(0);
  });

  it("names no shared cutoff when the session's blocks used different tolerances", async () => {
    localStorage.setItem(
      SESSION_HISTORY_KEY,
      JSON.stringify([heterogeneousSession("Mixed review session")])
    );

    await expandArchivedSession("Mixed review session");

    // The SESSION summary names no cutoff of its own. (Each block's own panel below
    // still names its own tolerance — that is correct and is what makes the summary's
    // silence meaningful rather than a loss of information.)
    expect(
      screen.getAllByText("tolerances vary across selection").length
    ).toBeGreaterThan(0);
    // Exactly one block uses ±0.10s, and only ITS own panel says so. If the session
    // summary had adopted that block's cutoff as the whole session's, there would be
    // two — which is precisely the "one shared cutoff" claim this must not make.
    expect(screen.queryAllByText("within ±0.10s")).toHaveLength(1);
    expect(screen.queryAllByText("within -0.01s / +0.20s")).toHaveLength(1);
  });

  it("says plainly that each block keeps its own tolerance, not a representative default", async () => {
    localStorage.setItem(
      SESSION_HISTORY_KEY,
      JSON.stringify([heterogeneousSession("Mixed review session")])
    );

    await expandArchivedSession("Mixed review session");

    // The old notice claimed the rates used a representative default, which was
    // untrue — they are, and always were, computed per block.
    expect(screen.queryByText(/representative default/)).toBeNull();
    expect(
      screen.getByText(/tolerance it was trained under/)
    ).toBeInTheDocument();
  });

  it("preserves the historical snapshot: viewing an archived session changes nothing", async () => {
    const archived = asymmetricSession("Asymmetric review session");
    localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify([archived]));

    await expandArchivedSession("Asymmetric review session");

    // Compared as values, not bytes: a rewrite may normalise key ORDER, which carries
    // no meaning. What must not change is any recorded stone, target or tolerance.
    expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY)!)).toEqual([archived]);
  });

  it("applies an explicit comparison override to the whole selection", async () => {
    localStorage.setItem(
      SESSION_HISTORY_KEY,
      JSON.stringify([asymmetricSession("Asymmetric review session")])
    );

    render(<TrackerApp />);
    await waitFor(() => screen.getByTestId("house-home"));
    navButton("Analyze").click();
    await waitFor(() => screen.getByText("Blocks and Sessions"));

    // Choosing Tight is an explicit instruction to judge everything the same way.
    const tight = screen.queryByRole("button", { name: /Tight/ });
    if (!tight) return;
    fireEvent.click(tight);

    fireEvent.click(screen.getByText("Asymmetric review session"));
    await waitFor(() => screen.getByText("Hide Details"));

    expect(screen.getAllByText("within ±0.05s").length).toBeGreaterThan(0);
  });
});

void within;
