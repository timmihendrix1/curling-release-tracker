// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useEffect, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import AssessScreen from "../AssessScreen";
import { applyTimingResultToAssessmentRun } from "../../lib/assessment/capture";
import { createEmptyAssessmentPersistedState, type AssessmentPersistedState } from "../../lib/assessment/persistence";
import { createManualTimingResult } from "../../lib/timingProvider";
import type { Handle } from "../../types";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
});

/**
 * Mimics TrackerApp's ref+commit contract for AssessScreen without pulling
 * in the rest of the app shell — updateAssessmentState reads a synchronous
 * ref, and onSubmitManualTime replays exactly what TrackerApp's capture
 * routing does (build a TimingResult, adapt it via
 * applyTimingResultToAssessmentRun) so these tests exercise the same
 * integration boundary the real app uses, not a shortcut.
 */
function Harness({
  isTrainingCaptureActive = false,
  onStateChange,
  onViewFullResults,
}: {
  isTrainingCaptureActive?: boolean;
  onStateChange?: (state: AssessmentPersistedState) => void;
  onViewFullResults?: (runId: string) => void;
}) {
  const [assessmentState, setAssessmentState] = useState<AssessmentPersistedState>(
    createEmptyAssessmentPersistedState()
  );
  const stateRef = useRef(assessmentState);
  useEffect(() => {
    stateRef.current = assessmentState;
    onStateChange?.(assessmentState);
  }, [assessmentState, onStateChange]);

  const [executedHandle, setExecutedHandle] = useState<Handle>("in");
  const executedHandleRef = useRef(executedHandle);
  useEffect(() => {
    executedHandleRef.current = executedHandle;
  }, [executedHandle]);

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
      assessmentHydration="ready"
      isTrainingCaptureActive={isTrainingCaptureActive}
      executedHandle={executedHandle}
      onChangeExecutedHandle={setExecutedHandle}
      showSimulatorOption={false}
      onSubmitManualTime={(value) => {
        const run = stateRef.current.currentRun;
        if (!run) return;
        const result = createManualTimingResult(run.timingProviderSnapshot.measurementMode, value);
        const outcome = applyTimingResultToAssessmentRun(run, result, executedHandleRef.current);
        if (outcome.status === "accepted") {
          updateAssessmentState((state) => ({ ...state, currentRun: outcome.run }));
        }
      }}
      pendingReloadRecovery={false}
      onConsumedReloadRecovery={() => {}}
      quarantineNotice={null}
      onDismissQuarantineNotice={() => {}}
      onViewFullResults={onViewFullResults ?? (() => {})}
    />
  );
}

/** Matches an element's own textContent exactly, regardless of how it's split across child text/element nodes — RTL's default matcher only looks at direct text-node children, which breaks for text with a nested <span> (e.g. "Expected Handle: <span>In</span>"). */
function exactTextIn(tagName: string, text: string) {
  return (_content: string, element: Element | null) =>
    element !== null && element.tagName.toLowerCase() === tagName && element.textContent === text;
}

async function goToOverviewSkippingIntroduction() {
  // The entry action is disabled until preference hydration settles
  // (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.10) — real repository reads are
  // asynchronous even against the real (synchronous-under-the-hood)
  // adapter this suite exercises, so a microtask must still elapse.
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
  await waitFor(() => screen.getByText("How this assessment works"));
  fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }));
  await waitFor(() => screen.getByText("Accuracy Thresholds"));
}

async function confirmSetupAndStart() {
  fireEvent.click(screen.getByRole("checkbox"));
  const startButton = screen.getByRole("button", { name: "Start Warm-up" });
  await waitFor(() => expect(startButton).not.toBeDisabled());
  fireEvent.click(startButton);
  await waitFor(() => screen.getByPlaceholderText("3.75 or 375"));
}

function recordShot(value: string) {
  const input = screen.getByPlaceholderText("3.75 or 375");
  fireEvent.change(input, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Record" }));
}

/** Waits until either the shot-entry input or a Block Transition "Continue" button is present, clicking through a transition screen if that's what appeared. */
async function waitReadyForNextShot() {
  await waitFor(() => {
    const hasInput = screen.queryByPlaceholderText("3.75 or 375");
    const hasContinue = screen.queryByRole("button", { name: "Continue" });
    if (!hasInput && !hasContinue) throw new Error("not ready yet");
  });
  const continueButton = screen.queryByRole("button", { name: "Continue" });
  if (continueButton) {
    fireEvent.click(continueButton);
    await waitFor(() => screen.getByPlaceholderText("3.75 or 375"));
  }
}

async function completeWarmupWithManualEntries() {
  for (let i = 0; i < 6; i++) {
    await waitFor(() => screen.getByPlaceholderText("3.75 or 375"));
    recordShot("999");
  }
  await waitFor(() => screen.getByText("Warm-up complete"));
  fireEvent.click(screen.getByRole("button", { name: "Start Scored Assessment" }));
  await waitFor(() => screen.getByText(/Block 1 of 4 · Medium Reproduction/));
}

describe("AssessScreen — Landing and Overview", () => {
  it("shows the Release Time Core Assessment landing with View Assessment", () => {
    render(<Harness />);
    expect(screen.getByText("Release Time Core Assessment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeInTheDocument();
  });

  it("shows the Guided Introduction on first View Assessment, and Overview covers purpose/measures/why/setup/threshold", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "View Assessment" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));
    expect(screen.getByText(/Medium Reproduction/)).toBeInTheDocument();
    expect(screen.getByText(/Variable Adaptation/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
    expect(screen.getByText("What this assessment measures")).toBeInTheDocument();
    expect(screen.getByText(/does not evaluate final stone position/)).toBeInTheDocument();
    expect(screen.getByText("Why this structure")).toBeInTheDocument();
    expect(screen.getByText("Setup Requirements")).toBeInTheDocument();
  });

  it("'Do not show this automatically again' skips the introduction on the next View Assessment", async () => {
    render(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "View Assessment" })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("How this assessment works"));
    fireEvent.click(screen.getByRole("checkbox", { name: /Do not show this automatically again/ }));
    fireEvent.click(screen.getByRole("button", { name: "Skip explanation" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));

    fireEvent.click(screen.getByRole("button", { name: "← Back to Assess" }));
    await waitFor(() => screen.getByRole("button", { name: "View Assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    await waitFor(() => screen.getByText("Accuracy Thresholds"));
    // "How this assessment works" is still a permanent link on Overview —
    // what must be absent is the auto-shown introduction *screen* itself.
    expect(screen.queryByRole("button", { name: "Skip explanation" })).not.toBeInTheDocument();
  });

  it("the protocol stays reachable via 'How this assessment works' even after skipping the automatic intro", async () => {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();
    fireEvent.click(screen.getByRole("button", { name: "How this assessment works" }));
    await waitFor(() => screen.getByText(/Medium Reproduction/));
  });
});

describe("AssessScreen — Accuracy Thresholds", () => {
  it("defaults to Standard, and Start Warm-up is disabled until setup is confirmed", async () => {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();

    expect(screen.getByRole("radio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("button", { name: "Start Warm-up" })).toBeDisabled();
  });

  it("Tight is selectable and shows its exact values", async () => {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();

    fireEvent.click(screen.getByRole("radio", { name: "Tight" }));
    await waitFor(() =>
      expect(
        screen.getByText(exactTextIn("p", "On Target: ±0.05s · Acceptable: ±0.10s"))
      ).toBeInTheDocument()
    );
  });

  it("blocks Start Warm-up for an invalid Custom threshold (On Target >= Acceptable)", async () => {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();

    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const onTargetInput = await waitFor(() => screen.getByLabelText("On Target (s)"));
    const acceptableInput = screen.getByLabelText("Acceptable (s)");
    fireEvent.change(onTargetInput, { target: { value: "0.30" } });
    fireEvent.change(acceptableInput, { target: { value: "0.10" } });

    fireEvent.click(screen.getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Start Warm-up" })).toBeDisabled();
    expect(screen.getByText("On Target must be smaller than Acceptable.")).toBeInTheDocument();
  });

  it("allows Start Warm-up for a valid Custom threshold", async () => {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();

    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    const onTargetInput = await waitFor(() => screen.getByLabelText("On Target (s)"));
    const acceptableInput = screen.getByLabelText("Acceptable (s)");
    fireEvent.change(onTargetInput, { target: { value: "0.07" } });
    fireEvent.change(acceptableInput, { target: { value: "0.15" } });

    await confirmSetupAndStart();
    expect(screen.getByText(/Threshold: Custom/)).toBeInTheDocument();
  });

  it("blocks Start Warm-up while a Training Auto Capture sequence is active, with a clear message", async () => {
    render(<Harness isTrainingCaptureActive />);
    await goToOverviewSkippingIntroduction();
    fireEvent.click(screen.getByRole("checkbox"));

    expect(screen.getByRole("button", { name: "Start Warm-up" })).toBeDisabled();
    expect(screen.getByText(/Training Auto Capture sequence is currently active/)).toBeInTheDocument();
  });
});

describe("AssessScreen — Warm-up", () => {
  it("runs the exact fixed 6-shot warm-up sequence, unscored, then requires an explicit Start Scored Assessment", async () => {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();
    await confirmSetupAndStart();

    const expectedSequence: [number, Handle][] = [
      [3.75, "in"],
      [3.75, "out"],
      [4.0, "in"],
      [4.0, "out"],
      [3.5, "in"],
      [3.5, "out"],
    ];

    for (const [target, handle] of expectedSequence) {
      await waitFor(() => screen.getByText(`${target.toFixed(2)}s`));
      expect(
        screen.getByText(exactTextIn("p", `Expected Handle: ${handle === "in" ? "In" : "Out"}`))
      ).toBeInTheDocument();
      recordShot("999"); // any measured time — warm-up is unscored
    }

    await waitFor(() => screen.getByText("Warm-up complete"));
    expect(screen.queryByText("Block 1 of 4")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start Scored Assessment" }));
    await waitFor(() => screen.getByText(/Block 1 of 4 · Medium Reproduction/));
  });
});

describe("AssessScreen — Scored execution", () => {
  async function startScoredRun() {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();
    await confirmSetupAndStart();
    await completeWarmupWithManualEntries();
  }

  it("shows 0 / 32 overall progress at the start of scoring", async () => {
    await startScoredRun();
    expect(screen.getByText("0 / 32")).toBeInTheDocument();
  });

  it("a wrong-handle attempt still counts as scored and shows a factual Protocol Deviation notice", async () => {
    await startScoredRun();
    // shot 1 expects "in" — toggle to "out"
    fireEvent.click(screen.getByRole("button", { name: "Out" }));
    recordShot("3.75");
    await waitFor(() =>
      expect(
        screen.getByText(
          "This attempt counts, but the executed handle differs from the planned handle."
        )
      ).toBeInTheDocument()
    );
    expect(screen.getByText("1 / 32")).toBeInTheDocument();
  });

  it("an invalid attempt does not advance progress and is capped at 2 per shot", async () => {
    await startScoredRun();
    expect(screen.getByText("0 / 32")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark attempt invalid" }));
    await waitFor(() => screen.getByText("Why was this attempt invalid?"));
    fireEvent.click(screen.getByRole("button", { name: "Timing system failure" }));
    await waitFor(() => screen.getByText("Invalid attempts for this shot: 1 / 2"));
    expect(screen.getByText("0 / 32")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Mark attempt invalid" }));
    await waitFor(() => screen.getByText("Why was this attempt invalid?"));
    fireEvent.click(screen.getByRole("button", { name: "Timing system failure" }));
    await waitFor(() => screen.getByText("Invalid attempts for this shot: 2 / 2"));

    expect(screen.getByRole("button", { name: "Mark attempt invalid" })).toBeDisabled();
    expect(screen.getByText("Resolve the timing issue before continuing.")).toBeInTheDocument();

    // A valid attempt can still succeed after two invalid ones.
    recordShot("3.75");
    await waitFor(() => expect(screen.getByText("1 / 32")).toBeInTheDocument());
  });

  it("shows a Block Transition screen exactly between blocks, not within a block", async () => {
    await startScoredRun();
    for (let i = 0; i < 7; i++) {
      recordShot("3.75");
      await waitFor(() => screen.getByPlaceholderText("3.75 or 375"));
      expect(screen.queryByText(/^Next: /)).not.toBeInTheDocument();
    }
    recordShot("3.75"); // 8th shot of block 1
    await waitFor(() => screen.getByText("Next: Slow Reproduction"));
    expect(screen.getByText("Medium Reproduction complete")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => screen.getByText(/Block 2 of 4 · Slow Reproduction/));
  });
});

describe("AssessScreen — Pause, Resume, Abandon", () => {
  async function startScoredRunWithOneShot() {
    render(<Harness />);
    await goToOverviewSkippingIntroduction();
    await confirmSetupAndStart();
    await completeWarmupWithManualEntries();
    recordShot("3.75");
    await waitFor(() => screen.getByText("1 / 32"));
  }

  it("Pause shows the Paused view with progress, and Resume returns to the same position", async () => {
    await startScoredRunWithOneShot();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => screen.getByText("Assessment paused"));
    expect(screen.getByText("Scored 1 / 32")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Resume Assessment" }));
    await waitFor(() => screen.getByText("1 / 32"));
    expect(screen.getByText(/Block 1 of 4 · Medium Reproduction/)).toBeInTheDocument();
  });

  it("Abandon requires confirmation, explains attempts are kept, and returns to Landing without a leftover active run", async () => {
    await startScoredRunWithOneShot();

    fireEvent.click(screen.getByRole("button", { name: "Abandon Assessment" }));
    await waitFor(() => screen.getByText(/Attempts recorded so far will be kept/));

    // Cancel first — must not abandon.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByText(/Attempts recorded so far will be kept/)).not.toBeInTheDocument());
    expect(screen.getByText(/Block 1 of 4 · Medium Reproduction/)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Abandon Assessment" })[0]);
    await waitFor(() => screen.getByText(/Attempts recorded so far will be kept/));
    fireEvent.click(screen.getAllByRole("button", { name: "Abandon Assessment" })[1]);

    await waitFor(() => screen.getByRole("button", { name: "View Assessment" }));
    expect(screen.queryByRole("button", { name: "Resume Assessment" })).not.toBeInTheDocument();
  });

  it("starting a new run after abandoning requires a fresh Setup Confirmation (regression: confirmed state must not carry over)", async () => {
    await startScoredRunWithOneShot();

    fireEvent.click(screen.getByRole("button", { name: "Abandon Assessment" }));
    await waitFor(() => screen.getByText(/Attempts recorded so far will be kept/));
    fireEvent.click(screen.getAllByRole("button", { name: "Abandon Assessment" })[1]);
    await waitFor(() => screen.getByRole("button", { name: "View Assessment" }));

    // Starting again must not inherit the previous run's confirmed setup —
    // a single checkbox click must be enough to enable Start Warm-up, not
    // toggle an already-checked box back off.
    await goToOverviewSkippingIntroduction();
    await confirmSetupAndStart();
    await waitFor(() => screen.getByPlaceholderText("3.75 or 375"));
  });
});

describe("AssessScreen — Completion", () => {
  it("completes only after all 32 scored attempts, archives the run, and shows a simple summary", async () => {
    let latestState: AssessmentPersistedState | undefined;
    render(<Harness onStateChange={(state) => (latestState = state)} />);
    await goToOverviewSkippingIntroduction();
    await confirmSetupAndStart();
    await completeWarmupWithManualEntries();

    for (let i = 0; i < 32; i++) {
      await waitReadyForNextShot();
      recordShot("3.75");
    }

    await waitFor(() => screen.getByText("Assessment complete"));
    expect(screen.getByText("32 of 32 scored stones")).toBeInTheDocument();
    expect(screen.getByText("MAE")).toBeInTheDocument();
    expect(screen.getByText(/Category summary/)).toBeInTheDocument();
    expect(screen.getByText("On Target")).toBeInTheDocument();

    expect(latestState?.currentRun).toBeUndefined();
    expect(latestState?.history).toHaveLength(1);
    expect(latestState?.history[0]?.status).toBe("completed");

    // No further mutation possible: Done returns to Landing with no active run.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => screen.getByRole("button", { name: "View Assessment" }));
  });
});
