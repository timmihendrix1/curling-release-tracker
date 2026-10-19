// @vitest-environment jsdom
//
// The recording boundary is SHARED. Fixed/Variable entry, Blind Weight and the
// curated runners all reach `handleAddShot`, and all of them can leave a stone
// accepted-but-unsaved. Anything that identifies, acknowledges, retries or displays an
// operation therefore has to work for every caller — not only the one whose control
// happened to own the feature.
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
  legacyTimeBlock,
  session as measurementSession,
  speedBlock,
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

/** Enters one complete Blind Weight stone and submits it. */
function recordBlindStone(prediction: string, measured: string) {
  fireEvent.change(screen.getByLabelText("Predicted time"), {
    target: { value: prediction },
  });
  fireEvent.click(screen.getByRole("button", { name: "Lock Prediction" }));
  fireEvent.change(screen.getByLabelText("Measured release time"), {
    target: { value: measured },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review Shot" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Shot & Continue" }));
}

function blindSession() {
  return measurementSession(
    [legacyTimeBlock({ mode: "blind", blindTargetMode: "fixed" })],
    []
  );
}

/** Fails every write until `release()` flips it. */
function failingWrites() {
  const real = sessionRepository.saveCurrent.bind(sessionRepository);
  let failing = true;
  vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) =>
    failing
      ? ({ ok: false, error: { kind: "unknown", message: "fail" } } as never)
      : real(session)
  );
  return { stopFailing: () => (failing = false) };
}

describe("Blind Weight shares the recording boundary without sharing one identity", () => {
  it("records a second stone after the first one's write failed", async () => {
    await openTraining(blindSession());
    const { stopFailing } = failingWrites();

    recordBlindStone("3.71", "3.71");
    await act(async () => {});
    stopFailing();

    // A genuinely different stone. It must not be mistaken for a repeat of the first:
    // Blind Weight owns its own draft and has no shared-draft revision, so every
    // submission used to collapse onto one identity and the second was refused
    // forever while the first stayed outstanding.
    recordBlindStone("3.82", "3.82");
    await act(async () => {});

    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots.map((shot) => shot.releaseTime)).toEqual([3.71, 3.82]);
  });

  it("records two consecutive Blind stones with identical values", async () => {
    await openTraining(blindSession());

    recordBlindStone("3.75", "3.75");
    await waitFor(() => expect(stored().shots).toHaveLength(1));
    recordBlindStone("3.75", "3.75");
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    // Identical numbers are two real stones, not a duplicate submission.
    expect(stored().shots.map((shot) => shot.releaseTime)).toEqual([3.75, 3.75]);
    expect(stored().shots.map((shot) => shot.predictedTime)).toEqual([3.75, 3.75]);
  });

  it("offers a reachable retry for a failed Blind stone and keeps its prediction", async () => {
    await openTraining(blindSession());
    const { stopFailing } = failingWrites();

    recordBlindStone("3.60", "3.71");
    // The retry used to live inside ShotEntry, which Blind Weight never mounts — so a
    // failure here had no reachable recovery at all.
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));
    expect(stored().shots).toHaveLength(0);

    stopFailing();
    fireEvent.click(screen.getByRole("button", { name: "Retry Saving" }));

    await waitFor(() => expect(stored().shots).toHaveLength(1));
    const [shot] = stored().shots;
    expect(shot.releaseTime).toBe(3.71);
    // The locked prediction survives: it is part of the accepted stone, and a retry
    // re-persists that stone rather than re-recording it.
    expect(shot.predictedTime).toBe(3.6);
  });

  it("still deduplicates an unedited Fixed Weight draft", async () => {
    await openTraining(measurementSession([speedBlock()], []));

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.45" },
    });
    const save = () =>
      fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    save();
    save();

    await waitFor(() => expect(stored().shots).toHaveLength(1));
    expect(stored().shots).toHaveLength(1);
  });
});

describe("a later durable write resolves an earlier failure it contains", () => {
  it("clears the failed row once a successful write carries that stone", async () => {
    await openTraining(measurementSession([speedBlock()], []));
    const { stopFailing } = failingWrites();

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    stopFailing();
    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    // The successful write durably contains BOTH stones, so the first one's failure
    // is no longer true. Its acknowledgement waiter was consumed by the failure, so
    // nothing else would ever have resolved it.
    await waitFor(() => expect(stored().shots).toHaveLength(2));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Retry Saving" })).toBeNull()
    );
  });

  it("does not resolve a failed operation a later write genuinely omits", async () => {
    await openTraining(measurementSession([speedBlock()], []));
    const { stopFailing } = failingWrites();

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    // The stone is removed before any write succeeds, so the next successful write
    // genuinely does not carry it. Resolving the failure on that write would claim
    // durability for data no write ever contained.
    const recent = screen.getByText(/Recorded stones/).closest("details");
    if (!recent) throw new Error("expected the Recorded stones list");
    recent.setAttribute("open", "");
    fireEvent.click(within(recent).getByRole("button", { name: "Delete" }));

    stopFailing();
    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    // Only the second stone is durable; the first operation is still unresolved.
    expect(stored().shots[0].speed).toBe(2.42);
    expect(screen.getByRole("button", { name: "Retry Saving" })).toBeInTheDocument();
  });

  it("keeps the failure visible when the later write also fails", async () => {
    await openTraining(measurementSession([speedBlock()], []));
    failingWrites();

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await act(async () => {});

    expect(stored().shots).toHaveLength(0);
    expect(
      screen.getAllByRole("button", { name: "Retry Saving" }).length
    ).toBeGreaterThanOrEqual(1);
  });

  it("settles the submitted draft too, so the covered stone cannot be recorded twice", async () => {
    // Removing the failure row without settling its draft left the already-submitted
    // values in the entry fields while removing the very operation that stopped them
    // being recorded again — so pressing Save Shot produced a duplicate stone.
    const block = bothBlock();
    await openTraining(measurementSession([block], []));
    const { stopFailing } = failingWrites();

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    // A COMPLETION on that same stone is the covering write here — not another
    // recording — so the stone becomes durable without a second Save Shot.
    stopFailing();
    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Time for stone 1/), {
      target: { value: "3.75" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Time" }));

    await waitFor(() => expect(stored().shots[0].releaseTime).toBe(3.75));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Retry Saving" })).toBeNull()
    );

    // Unchanged fields, pressed again: still one stone, with one identity.
    const idBefore = stored().shots[0].id;
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await act(async () => {});

    expect(stored().shots).toHaveLength(1);
    expect(stored().shots[0].id).toBe(idBefore);
    expect(stored().shots[0].speed).toBe(2.41);
  });

  it("stays idempotent through a covering write and then a remount", async () => {
    const block = bothBlock();
    await openTraining(measurementSession([block], []));
    const { stopFailing } = failingWrites();

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    stopFailing();
    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Time for stone 1/), {
      target: { value: "3.75" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Time" }));
    await waitFor(() => expect(stored().shots[0].releaseTime).toBe(3.75));

    // Leaving Train and returning unmounts the entry control entirely.
    await act(async () => {
      fireEvent.click(navButton("Analyze"));
    });
    await act(async () => {
      fireEvent.click(navButton("Train"));
    });
    await waitFor(() => screen.getByText("Current exercise"));

    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await act(async () => {});
    expect(stored().shots).toHaveLength(1);
  });

  it("preserves a NEWER manual draft when a covering write settles the older one", async () => {
    const block = bothBlock();
    await openTraining(measurementSession([block], []));
    const { stopFailing } = failingWrites();

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    // Typed AFTER the submission: a later revision, none of that write's business.
    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.56" },
    });

    stopFailing();
    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Time for stone 1/), {
      target: { value: "3.75" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Time" }));
    await waitFor(() => expect(stored().shots[0].releaseTime).toBe(3.75));

    expect(screen.getByLabelText(/^Speed \(m\/s\)/)).toHaveValue("2.56");
  });

  it("settles a covered completion's draft, selection and confirmation", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      timeShot(block, 3.7, { sessionId: state.id, id: "stone-1", shotNumber: 1 }),
    ];
    await openTraining(state);
    const { stopFailing } = failingWrites();

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    // Recording an ordinary stone durably writes the completed measurement too.
    stopFailing();
    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    // The completion is acknowledged the same way a direct settlement acknowledges
    // it: no failure row, no stale editor, and a truthful confirmation.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Retry Saving" })).toBeNull()
    );
    expect(screen.queryByLabelText(/Speed for stone 1/)).toBeNull();
    expect(screen.getByText(/Saved speed 2\.41 m\/s/)).toBeInTheDocument();
  });

  it("resolves a failed COMPLETION once a later write durably carries it", async () => {
    const block = bothBlock();
    const state = measurementSession([block], []);
    state.shots = [
      timeShot(block, 3.7, { sessionId: state.id, id: "stone-1", shotNumber: 1 }),
    ];
    await openTraining(state);
    const { stopFailing } = failingWrites();

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.41" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Speed" }));
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));

    // Recording an ordinary stone writes the session that already carries the
    // completed measurement.
    stopFailing();
    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.80" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));

    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots[0].speed).toBe(2.41);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Retry Saving" })).toBeNull()
    );
  });
});
