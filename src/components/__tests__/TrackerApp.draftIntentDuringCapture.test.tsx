// @vitest-environment jsdom
//
// A manual draft's whole recording intent survives an unrelated incoming stone.
//
// The expected handle and the generated target are derived from the stones recorded
// so far, so a device result landing on the shared capture queue changes both — while
// the athlete is midway through typing. Re-applying them to a draft already in
// progress silently rewrote what the athlete had chosen: a stone begun as In was
// recorded as Out. Delivered here through the real provider subscription, which is
// the only path that actually exercises it.
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
import {
  bothBlock,
  legacyTimeBlock,
  session as measurementSession,
} from "../../lib/measurement/__tests__/measurementFixtures";
import type { Session, TimingResult, TrainingBlock } from "../../types";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";

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

async function openWith(block: TrainingBlock) {
  const state = measurementSession([block], []);
  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));
  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));
  screen.getAllByRole("button", { name: "Train" })[0].click();
  await waitFor(() => screen.getByText("Active Training Block"));
  await act(async () => {});
}

async function startAutoCapture() {
  fireEvent.click(screen.getByRole("tab", { name: "Auto Capture" }));
  fireEvent.click(screen.getByRole("button", { name: "Start Auto Capture" }));
  // Manual entry stays mounted beside a running sequence (ShotEntry's "primary"
  // level), which is exactly the situation under test.
  await waitFor(() => screen.getByRole("heading", { name: "Add Shot" }));
}

function deliver(id: string, value: number) {
  expect(listeners.length).toBeGreaterThan(0);
  return act(async () => {
    listeners[0]({
      id,
      source: "simulator",
      receivedAt: "2026-10-07T10:05:00.000Z",
      measurements: [{ measurementMode: "back-hog", value }],
    });
  });
}

describe("an incoming device stone never rewrites an in-progress manual draft", () => {
  it("keeps the handle the draft was started with", async () => {
    await openWith(bothBlock());
    await startAutoCapture();

    const entry = screen.getByRole("heading", { name: "Add Shot" }).closest("div");
    if (!entry) throw new Error("expected the entry panel");
    fireEvent.click(within(entry).getByRole("button", { name: "Out Handle" }));
    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.41" },
    });

    // The device stone is recorded in its own right…
    await deliver("device-1", 3.8);
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    // …and the draft is saved exactly as it was started.
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    expect(stored().shots[1]).toMatchObject({ handle: "out", speed: 2.41 });
  });

  it("keeps an editable target the draft was started with", async () => {
    // Variable Weight with a coach-entered target: the editable value is part of the
    // recording intent, and a regenerated target must not replace it mid-entry.
    // Time-only, because only Fixed Weight carries a measurement configuration.
    await openWith(
      legacyTimeBlock({ mode: "variable", variableTargetMode: "manual" })
    );
    await startAutoCapture();

    fireEvent.change(screen.getByLabelText("Target Time"), {
      target: { value: "3.90" },
    });
    fireEvent.change(screen.getByLabelText(/Release Time/), {
      target: { value: "3.88" },
    });

    await deliver("device-2", 3.5);
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(stored().shots).toHaveLength(2));

    // Judged against the target the athlete actually set for it.
    expect(stored().shots[1]).toMatchObject({
      releaseTime: 3.88,
      targetTime: 3.9,
    });
  });

  it("seeds a genuinely NEW draft from the current expected handle", async () => {
    // Automatic progression still works. Exercised here on a free-handle block only
    // for the ACKNOWLEDGED path; the delayed, plan-driven case that this behaviour
    // actually turns on lives in TrackerApp.plannedHandleProgression.test.tsx.
    await openWith(bothBlock());

    fireEvent.change(screen.getByLabelText(/^Speed \(m\/s\)/), {
      target: { value: "2.40" },
    });
    const entry = screen.getByRole("heading", { name: "Add Shot" }).closest("div");
    if (!entry) throw new Error("expected the entry panel");
    fireEvent.click(within(entry).getByRole("button", { name: "Out Handle" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
    await waitFor(() => expect(stored().shots).toHaveLength(1));

    // The acknowledged draft is cleared, so the next one starts from the defaults
    // rather than inheriting the previous stone's one-off handle override.
    await waitFor(() =>
      expect(screen.getByLabelText(/^Speed \(m\/s\)/)).toHaveValue("")
    );
    const nextEntry = screen
      .getByRole("heading", { name: "Add Shot" })
      .closest("div");
    expect(
      within(nextEntry as HTMLElement).getByRole("button", { name: "In Handle" })
    ).toHaveClass("bg-slate-900");
  });
});
