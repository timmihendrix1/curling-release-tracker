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
  it("uses the readable secondary-text token for the small takeaway label", () => {
    render(
      <AssessmentAnalyze
        assessmentState={{ schemaVersion: 1, history: [completedRun("2026-01-01T00:00:00.000Z"), completedRun("2026-02-01T00:00:00.000Z")] }}
        onViewResult={noop}
        onResumeCurrent={noop}
        onGoToAssess={noop}
        onDeleteRun={noop}
      />
    );
    // CSS-token regression; real-browser computed contrast is verified separately.
    expect(screen.getByText("What should I learn from this?")).toHaveClass("text-slate-600");
  });
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

  it.each(["2026-02-01T00:00:00.000Z", "2026-02-01T23:59:59.999Z"])("shows the latest completed assessment and separates completed from incomplete history (%s)", (newerCompletedAt) => {
    // Completion order deliberately opposes creation order on distinct fixed days.
    const older = { ...completedRun("2026-01-01T00:00:00.000Z"), createdAt: "2025-12-01T12:00:00.000Z" };
    const newer = { ...completedRun(newerCompletedAt), createdAt: "2025-11-01T12:00:00.000Z" };
    const incomplete = { ...incompleteRun(), createdAt: "2026-03-01T12:00:00.000Z" };
    const state: AssessmentPersistedState = { schemaVersion: 1, history: [older, newer, incomplete] };
    const onViewResult = vi.fn();
    // Match the UI's runtime-local date formatting, not a fixed US calendar day.
    const newerDate = new Date(newer.completedAt!).toLocaleDateString();
    const olderDate = new Date(older.completedAt!).toLocaleDateString();
    const incompleteDate = new Date(incomplete.createdAt).toLocaleDateString();

    render(
      <AssessmentAnalyze
        assessmentState={state}
        onViewResult={onViewResult}
        onResumeCurrent={noop}
        onGoToAssess={noop}
        onDeleteRun={noop}
      />
    );

    const latestCard = screen.getByRole("heading", { name: "Latest Completed Assessment" }).parentElement!;
    expect(latestCard).toHaveTextContent(newerDate);
    expect(latestCard).not.toHaveTextContent(olderDate);
    fireEvent.click(within(latestCard).getByRole("button", { name: "View Results" }));
    expect(onViewResult).toHaveBeenLastCalledWith(newer.id);

    const completedSection = screen.getByRole("heading", { name: "Completed" }).parentElement!;
    const completedButtons = within(completedSection).getAllByRole("button", { name: "View Results" });
    expect(completedButtons).toHaveLength(2);
    // Verify the date and run identity of each row, newest first.
    for (const [index, run, date] of [[0, newer, newerDate], [1, older, olderDate]] as const) {
      const row = completedButtons[index].parentElement!;
      expect(within(row).getByText(date, { selector: "p" })).toBeInTheDocument();
      fireEvent.click(completedButtons[index]);
      expect(onViewResult).toHaveBeenLastCalledWith(run.id);
    }

    const incompleteSection = screen.getByRole("heading", { name: "Incomplete" }).parentElement!;
    expect(within(incompleteSection).getByText("Incomplete", { selector: "span" })).toBeInTheDocument();
    expect(within(incompleteSection).getByText(incompleteDate, { selector: "p" })).toBeInTheDocument();
    const incompleteButtons = within(incompleteSection).getAllByRole("button", { name: "View Details" });
    expect(incompleteButtons).toHaveLength(1);
    fireEvent.click(incompleteButtons[0]);
    expect(onViewResult).toHaveBeenLastCalledWith(incomplete.id);
    expect(onViewResult).toHaveBeenCalledTimes(4);
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
