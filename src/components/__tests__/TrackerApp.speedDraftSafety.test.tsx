// @vitest-environment jsdom
//
// Draft ownership, durable acknowledgement and retry for measurement entry.
//
// Every case here is a confirmed reproduction from the Stage B independent review.
// The common thread is that a measurement a person typed must never disappear,
// silently move to a different exercise or stone, or be called saved before storage
// says so. Happy-path coverage cannot see any of it: each one needs a real failure,
// a real delay, or a real context change.
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
import { sessionRepository } from "../../lib/sessionRepository";
import {
  bothBlock,
  session as measurementSession,
  speedBlock,
  speedShot,
  timeShot,
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

function stored(): Session {
  const raw = localStorage.getItem(CURRENT_SESSION_KEY);
  if (!raw) throw new Error("no current session stored");
  return JSON.parse(raw) as Session;
}

async function openTraining(state: Session) {
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));
  render(<TrackerApp />);
  await waitFor(() => screen.getByTestId("house-home"));
  navButton("Train").click();
  await waitFor(() => screen.getByText("Current exercise"));
  await act(async () => {});
}

/** A session whose Both block holds `n` stones that each still need a speed. */
function bothWithIncompleteStones(n: number) {
  const block = bothBlock();
  const state = measurementSession([block], []);
  state.shots = Array.from({ length: n }, (_unused, index) =>
    timeShot(block, 3.7, {
      id: `stone-${index + 1}`,
      sessionId: state.id,
      shotNumber: index + 1,
    })
  );
  return { block, state };
}

// --- Manual entry drafts --------------------------------------------------------

describe("a manual measurement draft belongs to the exercise it was typed for", () => {
  it("survives navigating away and back, without an unasked-for discard", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.456" },
    });

    // Nothing was recorded, so leaving offers an explicit discard rather than
    // taking the decision. Declining it must keep the value.
    await act(async () => {
      fireEvent.click(navButton("Analyze"));
    });
    expect(screen.getByText("Unsaved Measurement")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText("Speed (m/s)")).toHaveValue("2.456");
  });

  it("never reappears in a different exercise's capture field", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.456" },
    });

    fireEvent.click(screen.getByRole("button", { name: "New Training Block" }));
    // Leaving the exercise is guarded; confirming genuinely discards.
    fireEvent.click(screen.getByRole("button", { name: "Discard and Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("radio", { name: "Speed (m/s)" }));
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "3.1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));

    await waitFor(() => expect(stored().blocks).toHaveLength(2));

    // 2.456 was typed against a 2.40 target. Carried into a 3.10 exercise it could be
    // recorded against a target it was never thrown for.
    expect(screen.getByLabelText("Speed (m/s)")).not.toHaveValue("2.456");
  });

  it("is kept, with the stone still unsaved, when the write fails", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    const spy = vi
      .spyOn(sessionRepository, "saveCurrent")
      .mockResolvedValue({
        ok: false,
        error: { kind: "unknown", message: "review failure" },
      } as never);

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await act(async () => {});

    // Storage never took it, and the app does not pretend otherwise.
    expect(stored().shots).toHaveLength(0);
    expect(screen.getByLabelText("Speed (m/s)")).toHaveValue("2.456");
    expect(screen.getByRole("button", { name: "Retry Saving" })).toBeInTheDocument();
  });

  it("retries the SAME stone rather than recording a second one", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    let failNext = true;
    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(
      async (session) => {
        if (failNext) {
          failNext = false;
          return { ok: false, error: { kind: "unknown", message: "once" } } as never;
        }
        return real(session);
      }
    );

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() =>
      screen.getByRole("button", { name: "Retry Saving" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry Saving" }));

    await waitFor(() => expect(stored().shots).toHaveLength(1));
    // Exactly one stone, with one identity — the retry re-persisted, it did not record.
    expect(stored().shots[0].speed).toBe(2.45);
    expect(stored().shots.map((shot) => shot.shotNumber)).toEqual([1]);
    // And only once acknowledged is the draft cleared.
    await waitFor(() =>
      expect(screen.getByLabelText("Speed (m/s)")).toHaveValue("")
    );
  });

  it("does not call a stone saved before storage acknowledges it", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(
      async (session) => {
        await held;
        return real(session);
      }
    );

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    // The pending line now names WHICH stone is outstanding, because two can be in
    // flight at once. The assertion's intent is unchanged: pending, not saved.
    await waitFor(() => screen.getByText(/^Saving .+…$/));
    expect(screen.queryByText("Shot saved.")).toBeNull();

    await act(async () => {
      release();
    });
    await waitFor(() => screen.getByText("Shot saved."));
  });
});

// --- Completion drafts ----------------------------------------------------------

describe("completion drafts are owned per stone", () => {
  it("an acknowledgement for one stone never clears another stone's typing", async () => {
    const { state } = bothWithIncompleteStones(2);
    await openTraining(state);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(
      async (session) => {
        await held;
        return real(session);
      }
    );

    // Submit stone 1 and hold its write open.
    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    // Meanwhile start a different stone.
    fireEvent.click(screen.getByRole("button", { name: /Stone 2 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 2/), {
      target: { value: "2.567" },
    });

    await act(async () => {
      release();
    });

    // Stone 1's acknowledgement must not reach stone 2's draft.
    expect(screen.getByLabelText(/Speed for stone 2/)).toHaveValue("2.567");
  });

  it("keeps each stone's typed value when switching between them", async () => {
    const { state } = bothWithIncompleteStones(2);
    await openTraining(state);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Stone 2 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 2/), {
      target: { value: "2.52" },
    });

    // Going back shows what was typed there, not an empty field.
    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    expect(screen.getByLabelText(/Speed for stone 1/)).toHaveValue("2.41");
  });

  it("keeps a failed completion visible, with its value and a retry", async () => {
    const { state } = bothWithIncompleteStones(1);
    await openTraining(state);

    const spy = vi
      .spyOn(sessionRepository, "saveCurrent")
      .mockResolvedValue({
        ok: false,
        error: { kind: "unknown", message: "review failure" },
      } as never);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    await act(async () => {});

    // Nothing durable, and the outstanding value is still on screen — completing the
    // only incomplete stone must not hide the panel while its write is unresolved.
    expect(stored().shots[0].speed).toBeUndefined();
    expect(screen.getByLabelText(/Speed for stone 1/)).toHaveValue("2.456");
    expect(screen.getByRole("button", { name: "Retry Saving" })).toBeInTheDocument();
  });

  it("a retried completion persists without duplicating the stone", async () => {
    const { state } = bothWithIncompleteStones(1);
    await openTraining(state);

    let failNext = true;
    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(
      async (session) => {
        if (failNext) {
          failNext = false;
          return { ok: false, error: { kind: "unknown", message: "once" } } as never;
        }
        return real(session);
      }
    );

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry Saving" }));

    await waitFor(() => expect(stored().shots[0].speed).toBe(2.41));
    expect(stored().shots).toHaveLength(1);
    // The existing time measurement is untouched by the completion and its retry.
    expect(stored().shots[0].releaseTime).toBe(3.7);
  });

  it("rejects a zero completion with actionable feedback and keeps the draft", async () => {
    // A typed `0` parses (it is a number), so the live hint used to treat it as valid
    // while the submit path silently refused it — the athlete pressed the action and
    // nothing at all happened.
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      speedShot(block, 2.4, { sessionId: state.id, id: "only", shotNumber: 1 }),
    ];
    await openTraining(state);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Time for stone 1/), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Time" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /greater than zero/
    );
    expect(screen.getByLabelText(/Time for stone 1/)).toHaveValue("0");
    expect(stored().shots[0].releaseTime).toBeUndefined();
  });

  it("a confirmed discard really clears the value the dialog described", async () => {
    const { state } = bothWithIncompleteStones(1);
    await openTraining(state);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.456" },
    });

    fireEvent.click(screen.getByRole("button", { name: "New Training Block" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and Continue" }));
    // Cancelling the action that was confirmed for must not resurrect the value: the
    // parent and the field would then disagree about whether it still exists.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByLabelText(/Speed for stone 1/)).not.toHaveValue("2.456");
  });
});

// --- Provenance -----------------------------------------------------------------

describe("known provenance is recorded, and the other quantity's is preserved", () => {
  it("stores a manual source for a manually entered speed", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() => expect(stored().shots).toHaveLength(1));
    expect(stored().shots[0].speedSource).toBe("manual");
  });

  it("keeps an external time source while recording the speed's own", async () => {
    const { state } = bothWithIncompleteStones(1);
    state.shots[0].measurementSource = "external";
    await openTraining(state);

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.4" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    await waitFor(() => expect(stored().shots[0].speed).toBe(2.4));
    const shot = stored().shots[0];
    // Independent provenance per quantity on one stone.
    expect(shot.measurementSource).toBe("external");
    expect(shot.speedSource).toBe("manual");
  });
});

// --- Asynchronous safety --------------------------------------------------------

describe("asynchronous events never disturb an open editor", () => {
  // A real incoming timing result is exercised through the provider the app actually
  // subscribes to, in TrackerApp.timingEventDuringEdit.test.tsx. Writing to
  // localStorage, as this case used to, never reaches the mounted application.

  it("a THROWN write is reported as a failure, not left pending forever", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async () => {
      throw new Error("storage exploded");
    });

    fireEvent.change(screen.getByLabelText("Speed (m/s)"), {
      target: { value: "2.45" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    // An unhandled rejection would leave "Saving…" on screen indefinitely, with the
    // athlete unable to tell whether the stone was written.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry Saving" })).toBeInTheDocument()
    );
    expect(screen.getByLabelText("Speed (m/s)")).toHaveValue("2.45");
  });

  it("an acknowledgement from a previous session never reports success for the new one", async () => {
    const { state } = bothWithIncompleteStones(1);
    await openTraining(state);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(
      async (session) => {
        await held;
        return real(session);
      }
    );

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));

    // The training is replaced while that write is still outstanding.
    fireEvent.click(screen.getByRole("button", { name: "Complete Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));

    await act(async () => {
      release();
    });

    // Whatever that write did, it cannot claim the completion is durable in a
    // session it does not describe…
    expect(stored().shots).toHaveLength(0);

    // …and, just as importantly, nothing from the finished training leaks into the
    // replacement: no outstanding row, no confirmation, no retained draft.
    expect(screen.queryByRole("button", { name: "Retry Saving" })).toBeNull();
    expect(screen.queryByText(/Saved speed/)).toBeNull();
    expect(screen.queryByText("Missing measurements")).toBeNull();
  });
});
