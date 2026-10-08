// @vitest-environment jsdom
//
// Rendered behaviour, not helpers called by hand with the right argument. These prove
// the REAL call sites carry the effective tolerance, that refused input survives, and
// that an existing target edit cannot leave a measurement-aware session unsavable.
import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TrackerApp from "../TrackerApp";
import { targetErrorBandEndpoints } from "../TargetErrorChart";
import { sessionRepository } from "../../lib/sessionRepository";
import {
  session as measurementSession,
  timeBlock,
  timeShot,
} from "../../lib/measurement/__tests__/measurementFixtures";

const CURRENT_SESSION_KEY = "curling-release-tracker-current-session";

/** Lower side far tighter than the upper side — the reviewed reproduction. */
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

/** Seeds one measurement-aware block whose single stone is 0.05s FAST of target. */
async function openAsymmetricTraining() {
  const block = timeBlock();
  block.measurement!.time!.tolerance = structuredClone(ASYMMETRIC);
  const state = measurementSession([block], []);
  state.shots = [timeShot(block, 3.7, { sessionId: state.id })];

  localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));

  render(<TrackerApp />);
  await waitFor(() => screen.getByText("No scheduled session."));
  navButton("Train").click();
  await waitFor(() => screen.getByText("Active Training Block"));
  return { block, state };
}

describe("live analysis uses the block's own per-side tolerance", () => {
  it("does not report a 0.05s-fast stone as on target under a 0.01s lower band", async () => {
    await openAsymmetricTraining();

    // Target 3.75, recorded 3.70 => -0.05, well beyond the 0.02 lower Acceptable.
    // Judged by the symmetric 0.10/0.20 pair it would read as 100% on target.
    const summary = screen.getByText("Live Performance").closest("summary");
    expect(summary?.textContent).toMatch(/0% on target/);
  });
});

describe("displayed tolerances match the tolerance that classified the stones", () => {
  it("never names a symmetric cutoff that neither side of an asymmetric band uses", async () => {
    await openAsymmetricTraining();

    const details = screen.getByText("Live Performance").closest("details");
    if (!details) throw new Error("expected the Live Performance panel");
    details.setAttribute("open", "");

    // 0.10 / 0.20 belong to the block's legacy symmetric pair, which is NOT what
    // classified this stone. Showing them would contradict the "major miss" result.
    expect(details.textContent).not.toContain("within ±0.10s");
    expect(details.textContent).not.toContain("beyond ±0.20s");

    // The real per-side endpoints are named instead.
    expect(details.textContent).toContain("within -0.01s / +0.20s");
    expect(details.textContent).toContain("beyond -0.02s / +0.30s");
  });

  it("keeps the historical ± form for a genuinely symmetric tolerance", async () => {
    const block = timeBlock();
    const state = measurementSession([block], []);
    state.shots = [timeShot(block, 3.8, { sessionId: state.id })];
    localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByText("Active Training Block"));

    const details = screen.getByText("Live Performance").closest("details");
    if (!details) throw new Error("expected the Live Performance panel");
    details.setAttribute("open", "");

    expect(details.textContent).toContain("within ±0.10s");
    expect(details.textContent).toContain("beyond ±0.20s");
  });

  it("draws chart reference bands at the real per-side endpoints", async () => {
    const { block } = await openAsymmetricTraining();
    const tolerance = block.measurement!.time!.tolerance;

    // The exact geometry the chart renders — not a reimplementation of it.
    expect(targetErrorBandEndpoints(tolerance)).toEqual({
      onTarget: [-0.01, 0.2],
      acceptable: [-0.02, 0.3],
    });

    // A symmetric tolerance still produces the historical centred band.
    expect(
      targetErrorBandEndpoints({ onTarget: 0.1, acceptable: 0.2 })
    ).toEqual({ onTarget: [-0.1, 0.1], acceptable: [-0.2, 0.2] });

    // A selection whose tolerances differ draws no band at all.
    expect(targetErrorBandEndpoints(null)).toBeNull();
  });
});

describe("an existing target edit keeps one consistent authority", () => {
  it("moves both representations together, so the session stays savable", async () => {
    await openAsymmetricTraining();

    const details = screen.getByText(/Edit Details —/).closest("details");
    if (!details) throw new Error("expected the block details panel");
    details.setAttribute("open", "");

    const field = details.querySelector("input");
    if (!field) throw new Error("expected a target field");
    fireEvent.change(field, { target: { value: "4.00" } });

    const save = Array.from(details.querySelectorAll("button")).find(
      (button) => button.textContent === "Save"
    );
    if (!save) throw new Error("expected a Save control");
    fireEvent.click(save);

    await waitFor(() => screen.getByText("Current target: 4.00s"));
    await act(async () => {});

    const stored = JSON.parse(localStorage.getItem(CURRENT_SESSION_KEY)!);
    expect(stored.blocks[0].targetTime).toBe(4);
    // The measured-quantity target is the authority; leaving it at 3.75 would make
    // every later save of this session fail validation.
    expect(stored.blocks[0].measurement.time.target).toBe(4);
    // The already-recorded stone keeps the target it was actually judged against.
    expect(stored.shots[0].targetTime).toBe(3.75);
  });
});

describe("refused manual entry keeps the athlete's input", () => {
  it("does not clear the field when Enter is pressed during a pending archive", async () => {
    const block = timeBlock();
    const state = measurementSession([block], []);
    localStorage.setItem(CURRENT_SESSION_KEY, JSON.stringify(state));

    render(<TrackerApp />);
    await waitFor(() => screen.getByText("No scheduled session."));
    navButton("Train").click();
    await waitFor(() => screen.getByText("Active Training Block"));

    // Record one stone so the training has archivable activity.
    const field = screen.getByPlaceholderText("3.75 or 375");
    fireEvent.change(field, { target: { value: "3.75" } });
    screen.getByRole("button", { name: "Save Shot" }).click();
    await waitFor(() => expect(field).toHaveValue(""));

    // Hold the archive open, and make it fail, so the training stays open afterwards.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(sessionRepository, "archiveAndReplace")
      .mockImplementation(async () => {
        await held;
        return { ok: false, step: "history", error: { kind: "unknown", message: "test" } };
      });

    navButton("Start New Session").click();
    await waitFor(() => screen.getByRole("heading", { name: "Start New Session" }));
    screen.getByRole("button", { name: "Start" }).click();
    await waitFor(() => expect(spy).toHaveBeenCalled());

    // Enter must honour the same refusal the button shows, and must not discard input.
    fireEvent.change(field, { target: { value: "3.81" } });
    fireEvent.keyDown(field, { key: "Enter" });

    await act(async () => release());

    expect(field).toHaveValue("3.81");
  });
});
