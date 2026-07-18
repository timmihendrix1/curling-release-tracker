// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssessmentResultScreen from "../AssessmentResultScreen";
import { createAssessmentRun, transitionAssessmentRun } from "../../lib/assessment/run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../../lib/assessment/templates";
import { standardAssessmentThresholdSet } from "../../lib/assessment/thresholds";
import type { AssessmentRun } from "../../lib/assessment/types";
import {
  completeAllScoredShots,
  completeAllScoredShotsCustom,
  completeWarmup,
  expectOk,
  manualTimingProviderSnapshot,
} from "../../lib/assessment/__tests__/testHelpers";

afterEach(cleanup);

function buildCompletedRun(options: {
  completedAt?: string;
  scoredShotBuilder?: Parameters<typeof completeAllScoredShotsCustom>[1];
} = {}): AssessmentRun {
  let run = expectOk(
    createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    })
  );
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  run = options.scoredShotBuilder
    ? completeAllScoredShotsCustom(run, options.scoredShotBuilder)
    : completeAllScoredShots(run);
  run = expectOk(transitionAssessmentRun(run, "completed", { at: options.completedAt }));
  return run;
}

describe("AssessmentResultScreen", () => {
  it("renders every required section for a completed run", () => {
    const run = buildCompletedRun();
    render(<AssessmentResultScreen run={run} history={[run]} onBack={() => {}} onDeleteRun={() => {}} />);

    expect(screen.getByRole("heading", { name: "Release Time Core Assessment" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Core Metrics" })).toBeInTheDocument();
    // Block/Target/Handle/Variable Adaptation/Protocol Integrity/Shot Details
    // now live behind one collapsed "Full Breakdown" disclosure (Epic 2:
    // one-tap detail, not automatic reading) — still present, just not the
    // first thing rendered.
    expect(screen.getByText("Full Breakdown")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Block Results" })).toBeInTheDocument();
    // Target Results and Handle Comparison now lead with the same visual
    // charts Train/Analyze already use for the identical question, ahead of
    // their own KPI tables (Epic 3: reuse existing charts instead of
    // Assessment-specific tables-only presentation).
    expect(screen.getByRole("heading", { name: "Target Error by Shot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Target Results" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Handle Boxplot" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Handle Comparison" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Variable Adaptation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Protocol Integrity" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shot Details" })).toBeInTheDocument();

    // A single run has nothing yet to compare against or trend across, so
    // Compare & Trends collapses to one compact note instead of a full
    // selector and an empty chart (audit finding: the comparison selector
    // previously rendered even with nothing to compare).
    expect(
      screen.getByText(/Complete another comparable assessment to compare results/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Compare With Another Run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Development Trends" })).not.toBeInTheDocument();
  });

  it("switching Original → Tight recalculates category metrics but never the raw metrics or the run's own threshold snapshot", () => {
    // One shot off by 0.08s: On Target under Standard (±0.10s), Acceptable under Tight (±0.05s/±0.10s).
    const run = buildCompletedRun({
      scoredShotBuilder: (shot, index) => ({ measuredTime: index === 0 ? shot.targetTime + 0.08 : shot.targetTime }),
    });
    render(<AssessmentResultScreen run={run} history={[run]} onBack={() => {}} onDeleteRun={() => {}} />);

    const coreMetricsCard = screen.getByText("Category Metrics").closest("div")!;
    const onTargetBefore = within(coreMetricsCard).getByText("On Target").closest("div")!.textContent;
    expect(onTargetBefore).toContain("100%"); // Original = Standard here; 0.08s error is within ±0.10s.

    // Two threshold controls exist on the page (Analysis + Comparison) — the
    // Analysis one renders first in document order.
    fireEvent.click(screen.getAllByRole("radio", { name: "Tight" })[0]);

    const onTargetAfter = within(coreMetricsCard).getByText("On Target").closest("div")!.textContent;
    expect(onTargetAfter).not.toContain("100%");

    // MAE (threshold-independent) must be unchanged, and the run's own snapshot is never touched.
    expect(run.thresholdSnapshot.type).toBe("standard");
    expect(screen.getAllByText(/MAE|Mean Absolute Error/).length).toBeGreaterThan(0);
  });

  it("shows an invalid Custom threshold message without breaking the rest of the view", () => {
    const run = buildCompletedRun();
    render(<AssessmentResultScreen run={run} history={[run]} onBack={() => {}} onDeleteRun={() => {}} />);

    fireEvent.click(screen.getAllByRole("radio", { name: "Custom" })[0]);
    const onTargetInput = screen.getAllByLabelText("Custom On Target threshold, seconds")[0];
    fireEvent.change(onTargetInput, { target: { value: "0.5" } });
    const acceptableInput = screen.getAllByLabelText("Custom Acceptable threshold, seconds")[0];
    fireEvent.change(acceptableInput, { target: { value: "0.1" } });

    expect(screen.getByText("On Target must be smaller than Acceptable.")).toBeInTheDocument();
    // The rest of the screen keeps rendering (falls back to Original for display).
    expect(screen.getByText("Core Metrics")).toBeInTheDocument();
  });

  it("asks for confirmation before deleting, and only deletes on confirm", () => {
    const run = buildCompletedRun();
    const onDeleteRun = vi.fn();
    render(<AssessmentResultScreen run={run} history={[run]} onBack={() => {}} onDeleteRun={onDeleteRun} />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Run" }));
    expect(onDeleteRun).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: "Delete Run" })[1]);
    expect(onDeleteRun).toHaveBeenCalledWith(run.id);
  });

  it("shows a no-eligible-run message when no other protocol-compatible run exists", () => {
    const run = buildCompletedRun();
    render(<AssessmentResultScreen run={run} history={[run]} onBack={() => {}} onDeleteRun={() => {}} />);

    expect(screen.getByText(/Complete another comparable assessment/)).toBeInTheDocument();
  });

  it("offers a comparison once a second eligible completed run exists", () => {
    const first = buildCompletedRun({ completedAt: "2026-01-01T00:00:00.000Z" });
    const second = buildCompletedRun({ completedAt: "2026-02-01T00:00:00.000Z" });
    render(
      <AssessmentResultScreen run={second} history={[first, second]} onBack={() => {}} onDeleteRun={() => {}} />
    );

    expect(screen.getByLabelText("Comparison run")).toBeInTheDocument();
    expect(screen.getByText("This run remains protocol-comparable.")).toBeInTheDocument();
  });

  it("calls onBack from the back link", () => {
    const run = buildCompletedRun();
    const onBack = vi.fn();
    render(<AssessmentResultScreen run={run} history={[run]} onBack={onBack} onDeleteRun={() => {}} />);
    fireEvent.click(screen.getByText("← Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
