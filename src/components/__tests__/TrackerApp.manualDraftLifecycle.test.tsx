// @vitest-environment jsdom
//
// The lifecycle of ONE manual entry draft, from typed input to durable write.
//
// A draft holds two different kinds of thing at once, and the difference is what every
// case here turns on: measurements the athlete is entering for the stone being
// composed, and measurements RETAINED from a stone already submitted — shown only so a
// failed or still-unacknowledged write stays recoverable. Metadata (handle, shot type,
// an editable target) is a third thing again: choosing it is an edit, but it says
// nothing about where the numbers in the fields came from.
//
// Inferring "these values are already submitted" from the draft revision alone
// conflated the three. A handle selection minted a new revision, the draft stopped
// looking submitted, and the next measurement the athlete entered was recorded
// alongside the previous stone's untouched sibling value.
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

async function openBothTraining() {
  localStorage.setItem(
    CURRENT_SESSION_KEY,
    JSON.stringify(measurementSession([bothBlock()], []))
  );
  render(<TrackerApp />);
  await waitFor(() => screen.getByTestId("house-home"));
  fireEvent.click(navButton("Train"));
  await waitFor(() => screen.getByText("Current exercise"));
  await act(async () => {});
}

/** The Add Shot control. Scoped, because completion rows carry handle names too. */
function entryCard(): HTMLElement {
  return screen.getByRole("heading", { name: "Add Shot" }).closest("div")!;
}

function typeTime(value: string) {
  fireEvent.change(screen.getByLabelText(/^Release Time \(s\)/), {
    target: { value },
  });
}

function typeSpeed(value: string) {
  fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), { target: { value } });
}

function chooseHandle(handle: "in" | "out") {
  fireEvent.click(
    within(entryCard()).getByRole("button", {
      name: handle === "out" ? "Out Handle" : "In Handle",
    })
  );
}

function chooseShotType(type: "draw" | "takeout") {
  fireEvent.click(
    within(entryCard()).getByRole("button", { name: new RegExp(`^${type}$`, "i") })
  );
}

function saveShot() {
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
}

function timeField() {
  return screen.getByLabelText(/^Release Time \(s\)/);
}

function speedField() {
  return screen.getByLabelText(/^Speed \(m\/s\)/);
}

/**
 * A write that is genuinely outstanding while the next stone is entered — either held
 * open ("pending") or already refused ("failed"). Both leave the submitted stone's
 * values in the fields, which is the state every case here starts from.
 */
function outstandingWrites(mode: "pending" | "failed") {
  const real = sessionRepository.saveCurrent.bind(sessionRepository);
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let failing = mode === "failed";

  vi.spyOn(sessionRepository, "saveCurrent").mockImplementation(async (session) => {
    if (failing) {
      return {
        ok: false,
        error: { kind: "unknown", message: "storage unavailable" },
      } as never;
    }
    if (mode === "pending") await held;
    return real(session);
  });

  return {
    stopFailing: () => {
      failing = false;
    },
    settle: async () => {
      await act(async () => {
        release();
      });
    },
  };
}

/** Enters a complete Both stone and submits it, leaving its write outstanding. */
function submitFirstStone() {
  typeTime("3.80");
  typeSpeed("2.41");
  saveShot();
}

describe("a metadata edit does not turn a submitted stone's values into the next stone's", () => {
  // The eight confirmed reproductions: either kind of outstanding write, either piece
  // of metadata, either measurement entered next.
  const cases = [
    ["pending", "handle", "speed"],
    ["pending", "handle", "time"],
    ["pending", "shot type", "speed"],
    ["pending", "shot type", "time"],
    ["failed", "handle", "speed"],
    ["failed", "handle", "time"],
    ["failed", "shot type", "speed"],
    ["failed", "shot type", "time"],
  ] as const;

  it.each(cases)(
    "%s write: choosing a %s before entering a new %s records only the entered measurement",
    async (mode, metadata, quantity) => {
      await openBothTraining();
      const writes = outstandingWrites(mode);

      submitFirstStone();
      if (mode === "failed") {
        await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));
      }

      // The selection the athlete makes for the NEXT stone. It is an edit, so it mints
      // a new draft revision — which is exactly what used to make the retained values
      // below look like freshly typed input.
      if (metadata === "handle") chooseHandle("out");
      else chooseShotType("takeout");

      // Both measurements are still on screen: a selection must not discard values no
      // write has acknowledged.
      expect(timeField()).toHaveValue("3.80");
      expect(speedField()).toHaveValue("2.41");

      if (quantity === "speed") typeSpeed("2.42");
      else typeTime("3.90");

      // The side they did not touch belonged to the submitted stone and is gone.
      expect(quantity === "speed" ? timeField() : speedField()).toHaveValue("");

      writes.stopFailing();
      saveShot();
      await writes.settle();

      await waitFor(() => expect(stored().shots).toHaveLength(2));
      const [first, second] = stored().shots;

      // The first stone is untouched, and the second is a different stone — not a
      // second copy of it.
      expect(first).toMatchObject({
        releaseTime: 3.8,
        speed: 2.41,
        handle: "in",
        shotType: "draw",
        shotNumber: 1,
      });
      expect(second.id).not.toBe(first.id);
      expect(second.shotNumber).toBe(2);

      expect(second.handle).toBe(metadata === "handle" ? "out" : "in");
      expect(second.shotType).toBe(metadata === "shot type" ? "takeout" : "draw");

      if (quantity === "speed") {
        expect(second.speed).toBe(2.42);
        // The previous stone's 3.80 must not reappear here.
        expect(second.releaseTime).toBeUndefined();
      } else {
        expect(second.releaseTime).toBe(3.9);
        expect(second.speed).toBeUndefined();
      }

      // Exactly two stones, and nothing still claiming to be unsaved.
      expect(stored().shots).toHaveLength(2);
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Retry Saving" })).toBeNull()
      );
    }
  );

  it("records both measurements when the athlete deliberately enters both", async () => {
    await openBothTraining();
    const writes = outstandingWrites("pending");

    submitFirstStone();
    chooseHandle("out");
    typeTime("3.90");
    // Entering the first measurement cleared the retained speed; entering a second one
    // now is ordinary input for the same new stone and must be kept.
    expect(speedField()).toHaveValue("");
    typeSpeed("2.42");
    expect(timeField()).toHaveValue("3.90");

    saveShot();
    await writes.settle();

    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots[1]).toMatchObject({
      releaseTime: 3.9,
      speed: 2.42,
      handle: "out",
    });
  });
});

describe("an acknowledgement arriving mid-edit settles only what it wrote", () => {
  it("clears the retained values but keeps the handle chosen since", async () => {
    await openBothTraining();
    const writes = outstandingWrites("pending");

    submitFirstStone();
    chooseHandle("out");

    await writes.settle();
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    // Those numbers are durable now, so there is nothing left to recover — but the
    // selection made for the next stone is the athlete's and survives.
    await waitFor(() => expect(timeField()).toHaveValue(""));
    expect(speedField()).toHaveValue("");
    expect(within(entryCard()).getByRole("button", { name: "Out Handle" })).toHaveAttribute("aria-pressed", "true");

    typeSpeed("2.42");
    saveShot();

    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots[1]).toMatchObject({ speed: 2.42, handle: "out" });
    expect(stored().shots[1].releaseTime).toBeUndefined();
  });

  it("survives leaving and returning to Train between the selection and the measurement", async () => {
    await openBothTraining();
    const writes = outstandingWrites("pending");

    submitFirstStone();
    chooseShotType("takeout");

    // The draft is owned by the app shell, not by the entry control, so unmounting
    // Train must change nothing about what it holds — including which of its values
    // are retained.
    fireEvent.click(navButton("Analyze"));
    await waitFor(() => expect(screen.queryByText("Current exercise")).toBeNull());
    fireEvent.click(navButton("Train"));
    await waitFor(() => screen.getByText("Current exercise"));

    expect(timeField()).toHaveValue("3.80");
    expect(speedField()).toHaveValue("2.41");

    typeSpeed("2.42");
    expect(timeField()).toHaveValue("");

    saveShot();
    await writes.settle();

    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots[1]).toMatchObject({ speed: 2.42, shotType: "takeout" });
    expect(stored().shots[1].releaseTime).toBeUndefined();
  });
});

describe("retained values stay recoverable and are never recorded twice", () => {
  it("keeps them through a selection and saves them once, as the stone they belong to", async () => {
    await openBothTraining();
    const writes = outstandingWrites("failed");

    submitFirstStone();
    await waitFor(() => screen.getByRole("button", { name: "Retry Saving" }));
    expect(stored().shots).toHaveLength(0);

    chooseHandle("out");
    expect(timeField()).toHaveValue("3.80");
    expect(speedField()).toHaveValue("2.41");

    // Nothing new has been entered, so this press has no stone to record. Accepting it
    // would append a second stone carrying the first one's numbers.
    saveShot();

    writes.stopFailing();
    fireEvent.click(screen.getByRole("button", { name: "Retry Saving" }));

    await waitFor(() => expect(stored().shots).toHaveLength(1));
    // The retry re-persists the stone that already exists, with the intent it was
    // submitted under — not the handle selected afterwards for the next one.
    expect(stored().shots[0]).toMatchObject({
      releaseTime: 3.8,
      speed: 2.41,
      handle: "in",
      shotNumber: 1,
    });

    await act(async () => {});
    expect(stored().shots).toHaveLength(1);
  });

  it("does not treat a submitted stone's values as unsaved work after a selection", async () => {
    await openBothTraining();
    outstandingWrites("pending");

    submitFirstStone();
    chooseHandle("out");

    // The athlete already recorded this stone. Asking them to discard it on the way to
    // Analyze would put a dialog in front of an ordinary transition.
    fireEvent.click(navButton("Analyze"));

    expect(screen.queryByText("Unsaved Measurement")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Current exercise")).toBeNull());
  });

  it("still warns about a genuinely unsaved measurement", async () => {
    await openBothTraining();

    typeSpeed("2.41");
    fireEvent.click(navButton("Analyze"));

    // Nothing was submitted, so this value really would be lost.
    await waitFor(() => screen.getByText("Unsaved Measurement"));
    expect(screen.getByText("Current exercise")).toBeInTheDocument();
  });
});
