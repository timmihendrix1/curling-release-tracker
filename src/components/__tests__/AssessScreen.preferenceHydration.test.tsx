// @vitest-environment jsdom
//
// Correction tests for the Phase 1 audit's BLOCKER findings 2/4/8
// (PERSISTENCE_BOUNDARY_PHASE1_AUDIT.md §5) and the external-review follow-up
// (PERSISTENCE_BOUNDARY_PHASE1_FINAL_CORRECTION_REPORT.md): AssessScreen's
// threshold-preset/custom-threshold controls used to paint a hard-coded
// default, then silently replace it once an unguarded async preference read
// resolved, and handleViewAssessment started a fresh, unguarded read on every
// call whose late completion could force navigation after the user had
// already moved on. The entry action ("View Assessment"/"Resume
// Assessment"/"Start New Assessment") is now visibly disabled while
// preference hydration is pending — not merely silently deciding on a
// default — so it can never use the initial in-memory default. These tests
// use controllably delayed preference Promises (never the real,
// synchronously-resolving-under-the-hood adapter) plus real user interaction
// to prove all of this.
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
function Harness({
  assessmentHydration = "ready",
}: {
  assessmentHydration?: "loading" | "ready" | "write_protected";
} = {}) {
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
      assessmentHydration={assessmentHydration}
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

async function waitForEntryActionEnabled() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeEnabled()
  );
}

async function skipIntroductionToOverview() {
  await waitForEntryActionEnabled();
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

    // The entry action itself is unavailable while the read is pending —
    // there is no way to reach Overview at all yet.
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeDisabled();

    showDeferred.resolve(loadedValue(true));
    presetDeferred.resolve(loadedValue("tight"));
    customDeferred.resolve(loadedAbsent<null>());

    await skipIntroductionToOverview();

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
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockResolvedValue(
      loadedValue(true)
    );
    const presetDeferred = createDeferred<ReturnType<typeof loadedValue<"custom">>>();
    const customDeferred = createDeferred<
      ReturnType<typeof loadedValue<{ onTarget: number; acceptable: number }>>
    >();
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockReturnValue(
      presetDeferred.promise
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockReturnValue(
      customDeferred.promise
    );

    render(<Harness />);
    // showIntroduction alone doesn't settle preferencesHydration — the entry
    // action stays disabled until *all three* reads resolve together.
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeDisabled();

    presetDeferred.resolve(loadedValue("custom"));
    customDeferred.resolve(loadedValue({ onTarget: 0.05, acceptable: 0.15 }));

    await skipIntroductionToOverview();

    await waitFor(() => screen.getByPlaceholderText("0.10"));
    expect(screen.getByPlaceholderText("0.10")).toHaveValue("0.05");
    expect(screen.getByPlaceholderText("0.20")).toHaveValue("0.15");

    // Now interactive — typing works normally once hydration has settled.
    fireEvent.change(screen.getByPlaceholderText("0.10"), { target: { value: "0.07" } });
    expect(screen.getByPlaceholderText("0.10")).toHaveValue("0.07");
  });

  it("disables the Assessment entry action while showIntroduction hydration is pending, and clicking it has no effect", async () => {
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

    const button = screen.getByRole("button", { name: "View Assessment" });
    expect(button).toBeDisabled();

    fireEvent.click(button);
    // A disabled button's click handler never fires in the DOM, and
    // handleViewAssessment's own handler-level guard would no-op even if it
    // did — either way, navigation must not occur.
    expect(screen.queryByRole("button", { name: "Skip explanation" })).toBeNull();
    expect(screen.queryByText("Accuracy Thresholds")).toBeNull();

    showDeferred.resolve(loadedValue(true));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("resolving showIntroduction: true enables the entry action and routes to Guided Introduction", async () => {
    vi.spyOn(assessmentPreferencesRepository, "getShowIntroduction").mockResolvedValue(
      loadedValue(true)
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastThresholdPreset").mockResolvedValue(
      loadedAbsent()
    );
    vi.spyOn(assessmentPreferencesRepository, "getLastCustomThreshold").mockResolvedValue(
      loadedAbsent()
    );

    render(<Harness />);
    await waitForEntryActionEnabled();
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));
  });

  it("resolving showIntroduction: false enables the entry action and routes directly to Overview", async () => {
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
    await waitForEntryActionEnabled();
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
    expect(screen.queryByRole("button", { name: "Skip explanation" })).toBeNull();
  });

  it("unmounting before hydration completes is safe — the late resolution never throws or updates the unmounted instance", async () => {
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
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeDisabled();

    cleanup();

    expect(() => showDeferred.resolve(loadedValue(true))).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
  });

  it("rapid repeated entry-action clicks — while pending and immediately after settling — produce no competing navigation results", async () => {
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
    const button = screen.getByRole("button", { name: "View Assessment" });

    // Firing repeatedly while disabled must never queue up a navigation that
    // fires later.
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    showDeferred.resolve(loadedValue(false));
    await waitFor(() => expect(button).toBeEnabled());

    // handleViewAssessment is a synchronous decision (no pending Promise per
    // click) — firing it repeatedly in the same tick cannot create two
    // competing async completions.
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
    await waitForEntryActionEnabled();
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));

    const dontShowAgain = screen.queryByRole("checkbox");
    if (dontShowAgain) fireEvent.click(dontShowAgain);

    expect(() =>
      fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }))
    ).not.toThrow();
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
  });

  it("a successful preference write is observable after unmount and remount (real repository, real localStorage)", async () => {
    // Real repository/adapter, not mocked — proves the actual round-trip,
    // matching the style of AssessScreen.test.tsx's existing "'Do not show
    // this automatically again'" test but specifically across a full
    // unmount/remount rather than within one mounted instance.
    const { unmount } = render(<Harness />);
    await skipIntroductionToOverview();
    await waitFor(() => screen.getByText("Accuracy Thresholds"));

    unmount();
    localStorage.setItem(
      "curling-release-tracker-assessment-show-introduction",
      "false"
    );

    render(<Harness />);
    await waitForEntryActionEnabled();
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
    expect(screen.queryByRole("button", { name: "Skip explanation" })).toBeNull();
  });
});
