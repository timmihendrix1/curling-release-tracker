// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeScreen from "../HomeScreen";
import type { Session } from "../../types";
import { bothBlock, bothShot, session as measuredSession } from "../../lib/measurement/__tests__/measurementFixtures";
import { createTechniqueExecution, createCompletedShotmakingExecution } from "../../lib/exercises/__tests__/executionFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
function emptySession(): Session {
  return { id: "s1", title: "Training Session", date: "2026-10-08T10:00:00Z", notes: "", blocks: [], activeBlockId: "", shots: [] };
}
function recordedSession() {
  const block = bothBlock();
  return measuredSession([block], [bothShot(block, 3.75, 2.4)]);
}
function home(extra: Partial<React.ComponentProps<typeof HomeScreen>> = {}) {
  const props = { currentSession: emptySession(), sessionHistory: [], onStartTraining: vi.fn(), onOpenAnalyze: vi.fn(), onOpenSettings: vi.fn(), onManageTeams: vi.fn(), ...extra };
  render(<HomeScreen {...props} />);
  return props;
}

describe("House Home", () => {
  it("uses the stable page header", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-07-15T15:00:00")); home();
    expect(screen.getByRole("heading", { name: "Your training." }).className).not.toMatch(/shadow/);
  });
  it("does not mistake the default Session for active training or invent a schedule", () => {
    const p = home();
    expect(screen.getByText("Technique, shotmaking or assessment.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Resume training" })).not.toBeInTheDocument();
    expect(screen.queryByText("stones recorded")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    expect(p.onStartTraining).toHaveBeenCalledOnce();
  });
  it("resumes a configured block before its first stone through the existing callback", () => {
    const p = home({ currentSession: measuredSession([bothBlock()], []) });
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("Technique, shotmaking or assessment.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plans & exercises" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume training" }));
    expect(p.onStartTraining).toHaveBeenCalledOnce();
  });
  it("counts a Both stone once and leaves the source unchanged", () => {
    const session = recordedSession();
    const before = JSON.stringify(session); home({ currentSession: session });
    expect(within(screen.getByRole("region", { name: "Current training" })).getByText("1")).toBeVisible();
    expect(JSON.stringify(session)).toBe(before);
  });
  it("resumes a zero-attempt Technique execution", () => {
    const execution = createTechniqueExecution();
    home({ currentSession: { ...emptySession(), exerciseExecutions: [execution], activeExerciseExecutionId: execution.id } });
    expect(screen.getByRole("button", { name: "Resume training" })).toBeVisible();
    expect(screen.getByText(execution.exerciseVersionSnapshot.title)).toBeVisible();
  });
  it("counts supported exercise attempts alongside timing shots", () => {
    const execution = createCompletedShotmakingExecution();
    const session = { ...recordedSession(), exerciseExecutions: [execution] };
    const count = 1 + execution.athleteResults.reduce((n, result) => n + result.attempts.length, 0);
    home({ currentSession: session });
    expect(within(screen.getByRole("region", { name: "Current training" })).getByText(String(count))).toBeVisible();
  });
  it("keeps an unarchived training resumable after its zero-attempt exercise ends", () => {
    const execution = { ...createTechniqueExecution(), status: "abandoned" as const };
    home({ currentSession: { ...emptySession(), exerciseExecutions: [execution] } });
    expect(screen.getByRole("button", { name: "Resume training" })).toBeVisible();
    expect(screen.getByText("0")).toBeVisible();
  });
  it("reflects the Team runner's precedence without showing the Solo count as Team data", () => {
    home({ currentSession: recordedSession(), activeTeamExerciseTitle: "Team guards" });
    const hero = screen.getByRole("region", { name: "Current training" });
    expect(within(hero).getByText("Team guards")).toBeVisible();
    expect(within(hero).queryByText("stones recorded")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume training" })).toBeVisible();
  });
  it("retains assessment resume alongside current training", () => {
    const onResumeAssessment = vi.fn();
    home({ currentSession: measuredSession([bothBlock()], []), hasActiveAssessmentRun: true, onResumeAssessment });
    fireEvent.click(screen.getByRole("button", { name: "Resume Assessment" }));
    expect(onResumeAssessment).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Resume training" })).toBeVisible();
  });
  it("shows an honest empty history and opens Analyze", () => {
    const p = home();
    expect(screen.getByText("No training completed yet.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "See all" }));
    expect(p.onOpenAnalyze).toHaveBeenCalledOnce();
    expect(screen.queryByText(/recommend/i)).not.toBeInTheDocument();
  });
  it("shows the newest two archived records without reordering history or creating dead links", () => {
    const history = [1, 3, 2].map((i) => ({ ...emptySession(), id: `h${i}`, title: `Training ${i}`, date: `2026-10-0${i}T10:00:00Z` }));
    home({ sessionHistory: history });
    const recent = screen.getByRole("region", { name: "Recent training" });
    const rows = within(recent).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Training 3"); expect(rows[1]).toHaveTextContent("Training 2");
    expect(within(recent).queryByText("Training 1")).not.toBeInTheDocument();
    expect(within(rows[0]).queryByRole("button")).not.toBeInTheDocument();
    expect(history.map(s => s.id)).toEqual(["h1", "h3", "h2"]);
  });
  it("keeps Team and device management accessible in a disclosure without fabricated connection status", () => {
    const p = home(); fireEvent.click(screen.getByText("Teams & devices"));
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage devices" }));
    expect(p.onManageTeams).toHaveBeenCalledOnce(); expect(p.onOpenSettings).toHaveBeenCalledOnce();
    expect(screen.queryByText("Manual Timing")).not.toBeInTheDocument();
    expect(screen.queryByText(/External timing systems will/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  });
  it("keeps the House graphic decorative", () => {
    home(); const graphic = screen.getByRole("heading", { name: "Your training." }).closest("header")?.querySelector("svg");
    expect(graphic).toHaveAttribute("aria-hidden", "true");
    expect(graphic).toHaveAttribute("focusable", "false");
  });
});
