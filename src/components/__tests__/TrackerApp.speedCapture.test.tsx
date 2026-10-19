// @vitest-environment jsdom
//
// Stage B: the user-reachable Fixed Weight speed flow — setup, capture, explicit
// completion of a missing measurement, and results.
//
// These exercise the REAL rendered application against the real repositories, not the
// domain helpers called by hand. Stage A already proves the helpers; what has to be
// proven here is that the screens actually route through them: that a speed a person
// types reaches storage as a speed, that a missing measurement lands on the stone that
// was selected rather than the newest one, and that no fabricated seconds value
// appears anywhere a speed-only training is read.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import {
  bothBlock,
  session as measurementSession,
  speedBlock,
  speedShot,
  timeShot,
  bothShot,
} from "../../lib/measurement/__tests__/measurementFixtures";
import type { Session } from "../../types";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";

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

function storedSession(): Session {
  const raw = localStorage.getItem(CURRENT_SESSION_KEY);
  if (!raw) throw new Error("no current session stored");
  return JSON.parse(raw) as Session;
}

async function openTrainingWith(state: Session) {
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));
  render(<TrackerApp />);
  await waitFor(() => screen.getByTestId("house-home"));
  navButton("Train").click();
  await waitFor(() => screen.getByText("Current exercise"));
}

// --- B. Manual capture ---------------------------------------------------------

describe("manual capture of speed", () => {
  it("records a speed-only stone with its target, and offers no time field at all", async () => {
    const block = speedBlock();
    await openTrainingWith(measurementSession([block], []));

    // A speed-only exercise measures no time: no release-time field, and no
    // Auto Capture choice, because no device could feed one.
    expect(screen.queryByLabelText(/Release Time/)).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Shot entry method" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() => expect(storedSession().shots).toHaveLength(1));
    const [shot] = storedSession().shots;

    expect(shot.speed).toBe(2.45);
    expect(shot.targetSpeed).toBe(2.4);
    // Nothing time-shaped is fabricated onto a stone that measured no time.
    expect(shot.releaseTime).toBeUndefined();
    expect(shot.targetTime).toBeUndefined();
  });

  it("accepts a comma decimal separator without rescaling", async () => {
    const block = speedBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2,45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() => expect(storedSession().shots).toHaveLength(1));
    expect(storedSession().shots[0].speed).toBe(2.45);
  });

  it("never applies the release-time hundredths shorthand to a speed", async () => {
    const block = speedBlock();
    await openTrainingWith(measurementSession([block], []));

    // "240" entered as a release time would mean 2.40s. As a SPEED it means 240 m/s,
    // which is stored verbatim — it is never silently rescaled to 2.40 m/s.
    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "240" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() => expect(storedSession().shots).toHaveLength(1));
    expect(storedSession().shots[0].speed).toBe(240);
  });

  it("refuses an empty entry and a malformed one, recording nothing", async () => {
    const block = speedBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a speed in m/s.");

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "1.2.3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a speed in m/s greater than zero"
    );

    // A refused entry keeps what was typed, and stores no stone.
    expect(screen.getByLabelText("Speed (m/s)")).toHaveValue("1.2.3");
    expect(storedSession().shots).toHaveLength(0);
  });

  it("records a complete Both stone as ONE stone carrying both measurements", async () => {
    const block = bothBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    fireEvent.change(screen.getByLabelText(/Speed/), {
      target: { value: "2.42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() => expect(storedSession().shots).toHaveLength(1));
    const [shot] = storedSession().shots;

    expect(shot.releaseTime).toBe(3.8);
    expect(shot.targetTime).toBe(3.75);
    expect(shot.speed).toBe(2.42);
    expect(shot.targetSpeed).toBe(2.4);
    expect(shot.shotNumber).toBe(1);
  });

  it.each([
    ["time only", { time: "3.80", speed: "" }, { releaseTime: 3.8, speed: undefined }],
    ["speed only", { time: "", speed: "2.42" }, { releaseTime: undefined, speed: 2.42 }],
  ])(
    "records a partial Both stone with %s, leaving the other genuinely absent",
    async (_label, input, expected) => {
      const block = bothBlock();
      await openTrainingWith(measurementSession([block], []));

      if (input.time) {
        fireEvent.change(screen.getByLabelText(/Release Time/), {
          target: { value: input.time },
        });
      }
      if (input.speed) {
        fireEvent.change(screen.getByLabelText(/Speed/), {
          target: { value: input.speed },
        });
      }
      fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

      await waitFor(() => expect(storedSession().shots).toHaveLength(1));
      const [shot] = storedSession().shots;

      expect(shot.releaseTime).toBe(expected.releaseTime);
      expect(shot.speed).toBe(expected.speed);
      // Missing is ABSENT, never zero.
      if (expected.releaseTime === undefined) {
        expect("releaseTime" in shot).toBe(false);
      }
      if (expected.speed === undefined) {
        expect("speed" in shot).toBe(false);
      }
    }
  );

  it("counts one stone and advances the handle once for a partial Both stone", async () => {
    const block = bothBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.change(screen.getByLabelText(/Speed/), { target: { value: "2.42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(storedSession().shots).toHaveLength(1));

    fireEvent.change(screen.getByLabelText(/Speed/), { target: { value: "2.44" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(storedSession().shots).toHaveLength(2));

    expect(storedSession().shots.map((shot) => shot.shotNumber)).toEqual([1, 2]);
  });

  it("refuses a Both entry with neither measurement, and says what is needed", async () => {
    const block = bothBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a release time, a speed, or both."
    );
    expect(storedSession().shots).toHaveLength(0);
  });

  it("refuses a Both entry whose typed speed is malformed rather than treating it as missing", async () => {
    const block = bothBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    fireEvent.change(screen.getByLabelText(/Speed/), { target: { value: "." } });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    // Saving the time alone here would silently discard a value the athlete believes
    // they entered, and the stone would look like a deliberate partial.
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a speed in m/s greater than zero"
    );
    expect(storedSession().shots).toHaveLength(0);
  });
});

// --- C. Explicit completion of a missing measurement ----------------------------

describe("completing a missing measurement on an identified stone", () => {
  async function openWithTwoIncompleteStones() {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      timeShot(block, 3.7, { sessionId: state.id, id: "stone-a", shotNumber: 1, handle: "in" }),
      timeShot(block, 3.9, { sessionId: state.id, id: "stone-b", shotNumber: 2, handle: "out" }),
    ];
    await openTrainingWith(state);
    return block;
  }

  it("identifies each incomplete stone by number, handle and what it already carries", async () => {
    await openWithTwoIncompleteStones();

    const panel = screen.getByText("Missing measurements").closest("section");
    if (!panel) throw new Error("expected the missing-measurement panel");

    expect(panel.textContent).toContain("Stone 1 · In Handle · Time 3.70s");
    expect(panel.textContent).toContain("Stone 2 · Out Handle · Time 3.90s");
  });

  it("adds the speed to the SELECTED stone, not the newest one", async () => {
    await openWithTwoIncompleteStones();

    // Deliberately the FIRST stone, while a later one exists.
    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() =>
      expect(storedSession().shots.find((shot) => shot.id === "stone-a")?.speed).toBe(2.41)
    );

    const stored = storedSession();
    const a = stored.shots.find((shot) => shot.id === "stone-a");
    const b = stored.shots.find((shot) => shot.id === "stone-b");

    expect(a?.speed).toBe(2.41);
    expect(a?.targetSpeed).toBe(2.4);
    // The stone's existing measurement, identity and position are untouched…
    expect(a?.releaseTime).toBe(3.7);
    expect(a?.shotNumber).toBe(1);
    // …and no other stone was affected, nor was a new one created.
    expect(b?.speed).toBeUndefined();
    expect(stored.shots).toHaveLength(2);
  });

  it("reports a completion as saved only once it is in the stored session", async () => {
    await openWithTwoIncompleteStones();

    fireEvent.click(screen.getByRole("button", { name: /Stone 2 · Out Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 2/), {
      target: { value: "2.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() => screen.getByText(/Saved speed 2\.50 m\/s to .* stone 2\./));
    expect(
      storedSession().shots.find((shot) => shot.id === "stone-b")?.speed
    ).toBe(2.5);
  });

  it("stops offering a stone once it is complete", async () => {
    await openWithTwoIncompleteStones();

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Stone 1 · In Handle/ })).toBeNull()
    );
    // The still-incomplete stone remains offered.
    expect(screen.getByRole("button", { name: /Stone 2 · Out Handle/ })).toBeInTheDocument();
  });

  it("disappears entirely when no stone is missing a measurement", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [bothShot(block, 3.8, 2.4, { sessionId: state.id })];
    await openTrainingWith(state);

    expect(screen.queryByText("Missing measurements")).toBeNull();
  });

  it("still confirms the save after the LAST missing measurement is completed", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      timeShot(block, 3.7, { sessionId: state.id, id: "only", shotNumber: 1 }),
    ];
    await openTrainingWith(state);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    // Completing the last one empties the list. The panel must not vanish at that
    // moment — the acknowledgement is the only confirmation the value was written,
    // and a control that disappears the instant it succeeds reads as "did that save?".
    await waitFor(() => screen.getByText(/Saved speed 2\.41 m\/s to .* stone 1\./));
    expect(
      screen.getByText(/Nothing else is missing in this training/)
    ).toBeInTheDocument();
    expect(
      storedSession().shots.find((shot) => shot.id === "only")?.speed
    ).toBe(2.41);
  });
});

// --- F. Results -----------------------------------------------------------------

describe("results present each measurement on its own terms", () => {
  it("shows a speed-only stone's value, target, signed deviation and category", async () => {
    const block = speedBlock();
    const state = measurementSession([block], []);
    // 2.50 against a 2.40 target => +0.10 m/s, exactly the Acceptable outer edge.
    state.shots = [speedShot(block, 2.5, { sessionId: state.id })];
    await openTrainingWith(state);

    const list = screen.getByText(/Recorded stones/).closest("details");
    if (!list) throw new Error("expected the Recorded stones list");
    list.setAttribute("open", "");

    expect(list.textContent).toContain("2.50 m/s");
    expect(list.textContent).toContain("Target 2.40 m/s");
    expect(list.textContent).toContain("+0.10 m/s");
    expect(list.textContent).toContain("Acceptable");
    // Never a seconds figure for a training that measured no time.
    expect(list.textContent).not.toMatch(/0\.00s/);
  });

  it("labels both measurements separately on a Both stone and marks a missing one", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [timeShot(block, 3.8, { sessionId: state.id })];
    await openTrainingWith(state);

    const list = screen.getByText(/Recorded stones/).closest("details");
    if (!list) throw new Error("expected the Recorded stones list");
    list.setAttribute("open", "");

    expect(list.textContent).toContain("3.80s");
    // The absent speed is stated as absent, never as 0.00 m/s.
    expect(list.textContent).toContain("Not recorded yet");
    expect(list.textContent).not.toContain("0.00 m/s");
  });

  it("gives each quantity its own denominator, so a missing speed is not a zero", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      // Two stones: both have a time, only one has a speed.
      bothShot(block, 3.76, 2.41, { sessionId: state.id, id: "s1", shotNumber: 1 }),
      timeShot(block, 3.78, { sessionId: state.id, id: "s2", shotNumber: 2 }),
    ];
    await openTrainingWith(state);

    const summary = screen.getByRole("region", { name: "Live Performance" });
    expect(summary).toHaveTextContent("2 stones recorded");
    expect(summary).toHaveTextContent("2 measurements");
    expect(summary).toHaveTextContent("1 measurement");
    expect(summary).toHaveTextContent("3.77s");
    expect(summary).toHaveTextContent("2.41 m/s");
    expect(summary).not.toHaveTextContent("100%");
  });

  it("never offers a speed view for a time-only block", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    await openTrainingWith(state);

    expect(screen.getByRole("region", { name: "Live Performance" })).toHaveTextContent("Average speed");

    cleanup();
    localStorage.clear();

    const { timeBlock } = await import(
      "../../lib/measurement/__tests__/measurementFixtures"
    );
    await openTrainingWith(measurementSession([timeBlock()], []));

    expect(screen.getByRole("region", { name: "Live Performance" })).not.toHaveTextContent("Average speed");
  });
});

// --- E. Persistence round trip through the real UI -----------------------------

describe("a speed training survives a reload", () => {
  it("reloads with its speed, target and missingness intact, and nothing fabricated", async () => {
    const block = bothBlock();
    await openTrainingWith(measurementSession([block], []));

    // One complete stone and one still missing its speed.
    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    fireEvent.change(screen.getByLabelText(/Speed/), { target: { value: "2.42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(storedSession().shots).toHaveLength(1));

    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.70" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(storedSession().shots).toHaveLength(2));

    const beforeReload = storedSession();

    // A genuine remount from storage — the same path a reload takes.
    cleanup();
    render(<TrackerApp />);
    await waitFor(() => screen.getByTestId("house-home"));
    navButton("Train").click();
    await waitFor(() => screen.getByText("Current exercise"));

    const afterReload = storedSession();

    // Migration is idempotent here: reading a measurement-aware session back changes
    // nothing, which is exactly what the cloud reader's exact-byte check requires.
    expect(afterReload).toEqual(beforeReload);

    const [complete, partial] = afterReload.shots;
    expect(complete.speed).toBe(2.42);
    expect(complete.targetSpeed).toBe(2.4);
    expect(partial.releaseTime).toBe(3.7);
    // The missing speed was NOT backfilled with a zero or with the block's target.
    expect("speed" in partial).toBe(false);
    expect("targetSpeed" in partial).toBe(false);

    // And the still-incomplete stone is offered for completion again after the reload.
    expect(
      screen.getByRole("button", { name: /Stone 2 · In Handle · Time 3.70s/ })
    ).toBeInTheDocument();
  });

  it("keeps an ordinary time-only training byte-identical, with no measurement added", async () => {
    const { legacyTimeBlock } = await import(
      "../../lib/measurement/__tests__/measurementFixtures"
    );
    const block = legacyTimeBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(storedSession().shots).toHaveLength(1));

    const stored = storedSession();
    // Nothing from this feature is written onto ordinary time-only training — which is
    // what keeps its stored bytes, cloud payload and wire version unchanged.
    expect("measurement" in stored.blocks[0]).toBe(false);
    expect("speed" in stored.shots[0]).toBe(false);
    expect(stored.shots[0].releaseTime).toBe(3.8);
    expect(stored.shots[0].targetTime).toBe(3.75);
  });
});

// --- D. Transitions and asynchronous safety ------------------------------------

describe("transitions never silently discard work", () => {
  async function openBothWithOneIncompleteStone() {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      timeShot(block, 3.7, { sessionId: state.id, id: "stone-a", shotNumber: 1 }),
    ];
    await openTrainingWith(state);
    return block;
  }

  it("warns before leaving with a typed-but-unsaved completion, and keeps the stone either way", async () => {
    await openBothWithOneIncompleteStone();

    fireEvent.click(screen.getByRole("button", { name: /Stone 1/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.4" },
    });

    // Navigating away from Train is "leaving active work" and must resolve the draft.
    fireEvent.click(navButton("Analyze"));
    expect(screen.getByText("Unsaved Measurement")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard and Continue" }));

    // The already-recorded stone is untouched by the discard — only the typed,
    // never-saved value went away.
    await waitFor(() =>
      expect(screen.queryByText("Unsaved Measurement")).toBeNull()
    );
  });

  it("does not warn when a stone is merely selected with nothing typed", async () => {
    await openBothWithOneIncompleteStone();

    fireEvent.click(screen.getByRole("button", { name: /Stone 1/ }));
    fireEvent.click(navButton("Analyze"));

    // Selecting is not unsaved work; a dialog here would be routine noise.
    expect(screen.queryByText("Unsaved Measurement")).toBeNull();
  });

  it("records an extra stone beyond any planned count and keeps partial stones", async () => {
    const block = bothBlock();
    await openTrainingWith(measurementSession([block], []));

    for (const speed of ["2.40", "2.42", "2.44"]) {
      fireEvent.change(screen.getByLabelText(/Speed/), { target: { value: speed } });
      fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
      await waitFor(() =>
        expect(storedSession().shots.map((shot) => shot.speed)).toContain(
          Number(speed)
        )
      );
    }

    // Three partial stones, each counted once, none blocked by the missing time.
    expect(storedSession().shots).toHaveLength(3);
    expect(storedSession().shots.every((shot) => shot.releaseTime === undefined)).toBe(
      true
    );
  });

  it("does not create a second stone when the save button is clicked twice rapidly", async () => {
    const block = speedBlock();
    await openTrainingWith(measurementSession([block], []));

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.45" },
    });

    const save = screen.getByRole("button", { name: "Save Shot" });
    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(storedSession().shots).toHaveLength(1));
    // The second click found an empty field and was refused, rather than duplicating.
    expect(storedSession().shots).toHaveLength(1);
  });
});
