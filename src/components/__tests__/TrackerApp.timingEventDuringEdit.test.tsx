// @vitest-environment jsdom
//
// A REAL incoming timing result, delivered through the provider the app actually
// subscribes to — not a localStorage write, which never reaches the mounted
// application and therefore proves nothing about how it reacts to a device event.
//
// The behaviour under test is that an arriving stone changes the incomplete list
// without touching an editor the athlete has open: the editor is bound to a shot id,
// never to a position in that list.
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
  session as measurementSession,
} from "../../lib/measurement/__tests__/measurementFixtures";
import type { Session, TimingResult } from "../../types";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";

/** Every listener the app registers with the simulator provider. */
const listeners: Array<(result: TimingResult) => void> = [];

vi.mock("../../lib/simulatorTimingProvider", () => ({
  createSimulatorTimingProvider: () => ({
    type: "simulator",
    subscribe: (listener: (result: TimingResult) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      };
    },
    start: () => {},
    stop: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  listeners.length = 0;
});

beforeEach(() => {
  localStorage.clear();
});

function stored(): Session {
  return JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!) as Session;
}

describe("an incoming device result during an open completion editor", () => {
  it("adds its own stone without clearing or retargeting the editor", async () => {
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
    localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));

    render(<TrackerApp />);
    await waitFor(() => screen.getByTestId("house-home"));
    screen.getAllByRole("button", { name: "Train" })[0].click();
    await waitFor(() => screen.getByText("Current exercise"));
    await act(async () => {});

    // A capture sequence has to be running for a result to be accepted at all.
    fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));

    fireEvent.click(screen.getByRole("button", { name: /Stone 1 · In Handle/ }));
    fireEvent.change(screen.getByLabelText(/Speed for stone 1/), {
      target: { value: "2.415" },
    });

    expect(listeners.length).toBeGreaterThan(0);
    await act(async () => {
      listeners[0]({
        id: "incoming-device-result",
        source: "simulator",
        receivedAt: "2026-10-07T10:05:00.000Z",
        measurements: [{ measurementMode: "back-hog", value: 3.9 }],
      });
    });

    // The device's time is recorded immediately as its own stone (ADR-0050)…
    await waitFor(() => expect(stored().shots).toHaveLength(2));
    expect(stored().shots[1].releaseTime).toBe(3.9);

    // …and the open editor is untouched: still stone 1, still holding what was typed.
    expect(screen.getByLabelText(/Speed for stone 1/)).toHaveValue("2.415");
  });
});
