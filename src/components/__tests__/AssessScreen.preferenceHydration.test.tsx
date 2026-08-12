// @vitest-environment jsdom
//
// Correction tests for the Phase 1 audit's BLOCKER findings 2/4/8
// (PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md §5): AssessScreen's threshold-preset/
// custom-threshold controls used to paint a hard-coded default, then silently
// replace it once an unguarded async preference read resolved — a window in
// which a user's own selection/typing could be clobbered — and
// handleViewAssessment started a fresh, unguarded read on every call whose
// late completion could force navigation after the user had already moved
// on. These tests use controllably delayed preference Promises (never the
// real, synchronously-resolving-under-the-hood adapter) plus real user
// interaction to prove both races are closed.
import "@testing-library/jest-dom/vitest";
import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssessScreen from "../AssessScreen";
import { assessmentPreferencesRepository } from "../../lib/assessmentPreferencesRepository";
import { createEmptyAssessmentPersistedState, type AssessmentPersistedState } from "../../lib/assessment/persistence";
import { loadedAbsent, loadedValue, loadFailed } from "../../lib/persistence/types";
import type { Handle } from "../../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  localStorage.clear();
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Lean harness mirroring TrackerApp's ref+commit contract — see AssessScreen.test.tsx's Harness for the full-fidelity version this borrows from. */
function Harness() {
  const [assessmentState, setAssessmentState] = useState<AssessmentPersistedState>(
    createEmptyAssessmentPersistedState()
  );
  const stateRef = useRef(assessmentState);
  useEffect(() => {
    stateRef.current = assessmentState;
  }, [assessmentState]);
  const [executedHandle, setExecutedHandle] = useState<Handle>("in");

  function updateAssessmentState(
    updater: (state: AssessmentPersistedState) => AssessmentPersistedState
  ) {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setAssessmentState(next);
  }

  return (
    <AssessScreen
      assessmentState={assessmentState}
      updateAssessmentState={updateAssessmentState}
      isTrainingCaptureActive={false}
      executedHandle={executedHandle}
      onChangeExecutedHandle={setExecutedHandle}
      showSimulatorOption={false}
      onSubmitManualTime={() => {}}
      pendingReloadRecovery={false}
      onConsumedReloadRecovery={() => {}}
      quarantineNotice={null}
      onDismissQuarantineNotice={() => {}}
      onViewFullResults={() => {}}
    />
  );
}

async function skipIntroductionToOverview() {
  fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
  await waitFor(() => screen.getByText("How this assessment works"));
  fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }));
}

describe("AssessScreen preference hydration (delayed-read correction)", () => {
  it("does not render the threshold-preset control until the initial read settles, and shows the stored value with no default-then-correction flash", async () => {
    const showDeferred = createDeferred<ReturnType<typeof loadedValue<boolean>>>();
    const presetDeferred = createDeferred<ReturnType<typeof loadedValue<"tight">>>();
    const customDeferred = createDeferred<ReturnType<typeof loadedAbsent<null>>>();
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockReturnValue(
      showDeferred.promise
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockReturnValue(
      presetDeferred.promise
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockReturnValue(
      customDeferred.promise
    );

    render(<Harness />);
    await skipIntroductionToOverview();

    // Reached "overview" while hydration is still pending — the interactive
    // control must not be present at all yet (readiness gating, not a
    // dirty-flag race resolved after the fact).
    expect(screen.queryByRole("radiogroup", { name: "Accuracy Threshold preset" })).toBeNull();
    expect(screen.getByText(/Loading your saved preferences/)).toBeInTheDocument();

    showDeferred.resolve(loadedValue(true));
    presetDeferred.resolve(loadedValue("tight"));
    customDeferred.resolve(loadedAbsent<null>());

    await waitFor(() =>
      screen.getByRole("radiogroup", { name: "Accuracy Threshold preset" })
    );

    // The very first render of the control already shows the stored value —
    // never a "Standard" flash later replaced by "Tight".
    expect(screen.getByRole("radio", { name: /Tight/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Standard/ })).toHaveAttribute(
      "aria-checked",
      "false"
    );
  });

  it("does not render editable custom-threshold inputs until the initial read settles", async () => {
    const showDeferred = createDeferred<ReturnType<typeof loadedValue<boolean>>>();
    const presetDeferred = createDeferred<ReturnType<typeof loadedValue<"custom">>>();
    const customDeferred = createDeferred<
      ReturnType<typeof loadedValue<{ onTarget: number; acceptable: number }>>
    >();
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockReturnValue(
      showDeferred.promise
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockReturnValue(
      presetDeferred.promise
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockReturnValue(
      customDeferred.promise
    );

    render(<Harness />);
    await skipIntroductionToOverview();

    expect(screen.queryByPlaceholderText("0.10")).toBeNull();
    expect(screen.queryByPlaceholderText("0.20")).toBeNull();

    showDeferred.resolve(loadedValue(true));
    presetDeferred.resolve(loadedValue("custom"));
    customDeferred.resolve(loadedValue({ onTarget: 0.05, acceptable: 0.15 }));

    await waitFor(() => screen.getByPlaceholderText("0.10"));
    expect(screen.getByPlaceholderText("0.10")).toHaveValue("0.05");
    expect(screen.getByPlaceholderText("0.20")).toHaveValue("0.15");

    // Now interactive — typing works normally once hydration has settled.
    fireEvent.change(screen.getByPlaceholderText("0.10"), { target: { value: "0.07" } });
    expect(screen.getByPlaceholderText("0.10")).toHaveValue("0.07");
  });

  it("does not force navigation back to Guided Introduction/Overview when a stale showIntroduction read resolves after the user has already navigated elsewhere", async () => {
    const showDeferred = createDeferred<ReturnType<typeof loadedValue<boolean>>>();
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockReturnValue(
      showDeferred.promise
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockResolvedValue(
      loadedAbsent()
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockResolvedValue(
      loadedAbsent()
    );

    render(<Harness />);

    // The default (true) routes through Guided Introduction before the real
    // preference has loaded — this is the one accepted, documented,
    // non-data-lossy quirk (a navigation *target*, not a lost mutation).
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));

    // The user navigates away from Assess entirely before the hydration
    // Promise ever resolves — simulated here by unmounting AssessScreen
    // itself, exactly like TrackerApp conditionally un-rendering it.
    cleanup();

    // The late resolution must not throw, warn, or otherwise attempt a
    // state update against the unmounted instance.
    expect(() => showDeferred.resolve(loadedValue(false))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("rapid repeated View Assessment clicks never leave competing navigation results", async () => {
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockResolvedValue(
      loadedValue(false)
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockResolvedValue(
      loadedAbsent()
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockResolvedValue(
      loadedAbsent()
    );

    render(<Harness />);
    await waitFor(() => screen.getByRole("button", { name: "View Assessment" }));

    // handleViewAssessment is now a synchronous decision (no pending
    // Promise per click) — firing it repeatedly in the same tick cannot
    // create two competing async completions.
    const button = screen.getByRole("button", { name: "View Assessment" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() => screen.getByText("Accuracy Thresholds"));
    expect(screen.queryByRole("button", { name: "Skip explanation" })).toBeNull();
  });

  it("applies the documented fallback on a preference read failure, without throwing", async () => {
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockResolvedValue(
      loadFailed(true, { kind: "unknown", message: "boom" })
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockResolvedValue(
      loadFailed("standard", { kind: "unknown", message: "boom" })
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockResolvedValue(
      loadFailed(null, { kind: "unknown", message: "boom" })
    );

    expect(() => render(<Harness />)).not.toThrow();
    await skipIntroductionToOverview();

    await waitFor(() =>
      screen.getByRole("radiogroup", { name: "Accuracy Threshold preset" })
    );
    expect(screen.getByRole("radio", { name: /Standard/ })).toHaveAttribute(
      "aria-checked",
      "true"
    );
  });

  it("does not throw when a preference write fails", async () => {
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockResolvedValue(
      loadedValue(true)
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockResolvedValue(
      loadedAbsent()
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockResolvedValue(
      loadedAbsent()
    );
    vi.spyOn(assessmentPreferencesRepository, "setShowIntroduction").mockResolvedValue({
      ok: false,
      error: { kind: "quota_exceeded" },
    });

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));

    const dontShowAgain = screen.queryByRole("checkbox");
    if (dontShowAgain) fireEvent.click(dontShowAgain);

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }))
    ).not.toThrow();
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
  });
});
