// @vitest-environment jsdom
//
// Operation-specific ownership for manual recording.
//
// Every case here needs a REAL delay, failure or remount: a submission that settles
// instantly cannot show whether an acknowledgement reached the right draft, whether a
// retry addressed the right stone, or whether idempotency survives the entry control
// being unmounted. These are the Stage B review's confirmed reproductions.
import "@testing-library/jest-dom/vitest";
import { act } from "react";
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
import { sessionRepository } from "../../lib/sessionRepository";
import {
  bothBlock,
  session as measurementSession,
  speedBlock,
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
  return JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!) as Session;
}

async function openTraining(state: Session) {
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));
  render(<TrackerApp />);
  await waitFor(() => screen.getByTestId("house-home"));
  navButton("Train").click();
  await waitFor(() => screen.getByText("Current exercise"));
  await act(async () => {});
}

const typeSpeed = (value: string) =>
  fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
    target: { value },
  });
const saveShot = () =>
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

/** A write that can be released on demand, then performs the real save. */
function heldWrite() {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const real = sessionRepository.saveCurrent.bind(sessionRepository);
  vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) => {
    await held;
    return real(session);
  });
  return { release };
}

describe("an acknowledgement addresses only the submission it describes", () => {
  it("does not erase a newer draft typed while an older write is in flight", async () => {
    await openTraining(measurementSession([speedBlock()], []));
    const { release } = heldWrite();

    typeSpeed("2.41");
    saveShot();
    // The athlete moves on to the next stone before the first write settles.
    typeSpeed("2.567");

    await act(async () => release());

    // 2.567 belongs to a LATER draft revision than the acknowledged submission, so
    // that acknowledgement has no business clearing it.
    expect(screen.getByLabelText(/^Speed \(m\/s\)/)).toHaveValue("2.567");
  });

  it("does not let an older success consume a newer failed submission's retry", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    let writes = 0;
    const spy = vi
      .spyOn(sessionRepository, "saveCurrent")
      .mockImplementation(async (session) => {
        writes += 1;
        if (writes === 1) {
          await held;
          return real(session);
        }
        if (writes === 2) {
          return {
            ok: false,
            error: { kind: "unknown", message: "second fails" },
          } as never;
        }
        return real(session);
      });

    typeSpeed("2.41");
    saveShot();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    typeSpeed("2.56");
    saveShot();

    await act(async () => release());

    // A's success must not clear B's retry target, nor replace B's failed status.
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry Saving" }));

    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots.map((shot) => shot.speed)).toEqual([2.41, 2.56]);
  });
});

describe("idempotency survives the entry control unmounting", () => {
  it("does not record a second stone when a retained value is submitted again after a remount", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    let failing = true;
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) =>
      failing
        ? ({ ok: false, error: { kind: "unknown", message: "fail" } } as never)
        : real(session)
    );

    typeSpeed("2.41");
    saveShot();
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    // Leaving Train and coming back unmounts the entry control entirely. A guard that
    // lived inside it would be gone, and the retained value could be recorded twice.
    await act(async () => {
      fireEvent.click(navButton("Analyze"));
    });
    await act(async () => {
      fireEvent.click(navButton("Train"));
    });
    await waitFor(() => screen.getByText("Current exercise"));

    failing = false;
    saveShot();
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Retry Saving" }));
    await waitFor(() => expect(stored().shots).toHaveLength(1));
    expect(stored().shots).toHaveLength(1);
  });

  it("still allows two successive stones with identical values", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    typeSpeed("2.45");
    saveShot();
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    // Retyping the same number is a genuine second stone, not a duplicate submission.
    typeSpeed("2.45");
    saveShot();
    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots.map((shot) => shot.speed)).toEqual([2.45, 2.45]);
  });
});

describe("the draft carries the whole recording intent", () => {
  it("keeps handle and shot type across an entry-mode remount", async () => {
    await openTraining(measurementSession([bothBlock()], []));

    typeSpeed("2.41");
    const entry = screen.getByRole("heading", { name: "Add Shot" }).closest("div");
    if (!entry) throw new Error("expected the entry panel");
    fireEvent.click(within(entry).getByRole("button", { name: "Out Handle" }));
    fireEvent.click(within(entry).getByRole("button", { name: /^takeout$/i }));

    // Switching entry mode unmounts and remounts the control.
    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("tab", { name: "Manual Entry" }));

    saveShot();
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    // A stone is not only its numbers: recording a retained value against the wrong
    // handle is the same class of error as recording it in the wrong exercise.
    expect(stored().shots[0]).toMatchObject({ handle: "out", shotType: "takeout" });
    expect(stored().shots[0].speed).toBe(2.41);
  });
});

describe("pending state belongs to its own training", () => {
  it("does not carry a failed completion into the next training", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      {
        id: "stone-1",
        sessionId: state.id,
        blockId: block.id,
        shotNumber: 1,
        handle: "in",
        releaseTime: 3.7,
        targetTime: 3.75,
        createdAt: "2026-10-07T10:00:00.000Z",
      },
    ];
    await openTraining(state);

    const real = sessionRepository.saveCurrent.bind(sessionRepository);
    let failing = true;
    vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) =>
      failing
        ? ({ ok: false, error: { kind: "unknown", message: "fail" } } as never)
        : real(session)
    );

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    // Finishing succeeds, which durably writes the outgoing session — including the
    // measurement that failed to save on its own.
    failing = false;
    fireEvent.click(screen.getByRole("button", { name: "Complete Session" }));
    fireEvent.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() => screen.getByRole("heading", { name: "Exercises", level: 2 }));

    await waitFor(() =>
      screen.getByRole("heading", { level: 2, name: "Exercises" })
    );
    const technique = screen.queryByRole("button", { name: /^Technique,/ });
    if (technique?.getAttribute("aria-expanded") === "false") {
      fireEvent.click(technique);
    }
    fireEvent.click(
      screen.getByRole("button", { name: "View Details: Release Time" })
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to Timing Setup" })
    );
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    await waitFor(() => screen.getByText("Current exercise"));

    // The old training's outstanding row belongs to a training that is finished and
    // archived; it has nothing to do with this one.
    expect(screen.queryByRole("button", { name: "Retry Saving" })).toBeNull();
    expect(screen.queryByText("Missing measurements")).toBeNull();
  });

  it("does not claim a shot was saved in a block that has recorded nothing", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    typeSpeed("2.45");
    saveShot();
    await waitFor(() => screen.getByText("Shot saved."));

    // A second exercise starts empty; the previous one's confirmation is not its.
    fireEvent.click(screen.getByRole("button", { name: "New Training Block" }));
    fireEvent.click(screen.getByRole("radio", { name: "Speed (m/s)" }));
    fireEvent.change(screen.getByLabelText("Target Speed (m/s)"), {
      target: { value: "2.40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
    await waitFor(() => expect(stored().blocks).toHaveLength(2));

    expect(screen.queryByText("Shot saved.")).toBeNull();
  });
});
