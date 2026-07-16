// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AssessmentAnalyze from "../AssessmentAnalyze";
import { createEmptyAssessmentPersistedState, setCurrentAssessmentRun } from "../../lib/assessment/persistence";
import { createAssessmentRun, transitionAssessmentRun } from "../../lib/assessment/run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../../lib/assessment/templates";
import { standardAssessmentThresholdSet } from "../../lib/assessment/thresholds";
import type { AssessmentPersistedState } from "../../lib/assessment/persistence";
import type { AssessmentRun } from "../../lib/assessment/types";
import {
  completeAllScoredShots,
  completeWarmup,
  createTestRun,
  expectOk,
  manualTimingProviderSnapshot,
} from "../../lib/assessment/__tests__/testHelpers";

afterEach(cleanup);

function completedRun(completedAt: string): AssessmentRun {
  let run = expectOk(
    createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
      timingProviderSnapshot: manualTimingProviderSnapshot(),
    })
  );
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  run = completeWarmup(run);
  run = expectOk(transitionAssessmentRun(run, "in_progress"));
  run = completeAllScoredShots(run);
  return expectOk(transitionAssessmentRun(run, "completed", { at: completedAt }));
}

function incompleteRun(): AssessmentRun {
  let run = createTestRun();
  run = expectOk(transitionAssessmentRun(run, "warmup"));
  return expectOk(transitionAssessmentRun(run, "incomplete"));
}

const noop = () => {};

describe("AssessmentAnalyze", () => {
  it("shows the empty state with no runs and no active current run", () => {
    const onGoToAssess = vi.fn();
    render(
      <AssessmentAnalyze
        assessmentState={createEmptyAssessmentPersistedState()}
        onViewResult={noop}
        onResumeCurrent={noop}
        onGoToAssess={onGoToAssess}
        onDeleteRun={noop}
      />
    );

    expect(screen.getByText("No completed assessments yet.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to Assess" }));
    expect(onGoToAssess).toHaveBeenCalledTimes(1);
  });

  it("shows the latest completed assessment and separates completed from incomplete history", () => {
    const older = completedRun("2026-01-01T00:00:00.000Z");
    const newer = completedRun("2026-02-01T00:00:00.000Z");
    const incomplete = incompleteRun();
    const state: AssessmentPersistedState = { schemaVersion: 1, history: [older, newer, incomplete] };

    render(
      <AssessmentAnalyze
        assessmentState={state}
        onViewResult={noop}
        onResumeCurrent={noop}
        onGoToAssess={noop}
        onDeleteRun={noop}
      />
    );

    expect(screen.getByRole("heading", { name: "Latest Completed Assessment" })).toBeInTheDocument();
    const completedSection = screen.getByRole("heading", { name: "Completed" }).parentElement!;
    expect(completedSection.textContent).toContain("2/1/2026");

    const incompleteSection = screen.getByRole("heading", { name: "Incomplete" }).parentElement!;
    expect(within(incompleteSection).getByText("Incomplete", { selector: "span" })).toBeInTheDocument();
  });

  it("routes View Results and Delete through their callbacks", () => {
    const run = completedRun("2026-01-01T00:00:00.000Z");
    const onViewResult = vi.fn();
    const onDeleteRun = vi.fn();
    const state: AssessmentPersistedState = { schemaVersion: 1, history: [run] };

    render(
      <AssessmentAnalyze
        assessmentState={state}
        onViewResult={onViewResult}
        onResumeCurrent={noop}
        onGoToAssess={noop}
        onDeleteRun={onDeleteRun}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "View Results" })[0]);
    expect(onViewResult).toHaveBeenCalledWith(run.id);

    fireEvent.click(screen.getByRole("button", { name: "Delete this Assessment Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Run" }));
    expect(onDeleteRun).toHaveBeenCalledWith(run.id);
  });

  it("offers Resume Assessment for a still-active current run", () => {
    const state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), createTestRun()));
    const onResumeCurrent = vi.fn();

    render(
      <AssessmentAnalyze
        assessmentState={state}
        onViewResult={noop}
        onResumeCurrent={onResumeCurrent}
        onGoToAssess={noop}
        onDeleteRun={noop}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Resume Assessment" }));
    expect(onResumeCurrent).toHaveBeenCalledTimes(1);
  });
});
