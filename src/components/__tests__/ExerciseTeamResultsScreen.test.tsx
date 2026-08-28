// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExerciseTeamResultsScreen from "../ExerciseTeamResultsScreen";
import { EXERCISE_CATALOG } from "../../lib/exercises/catalog";
import { EIGHT_GUARDS_VERSION_ID } from "../../lib/exercises/content";
import { findExerciseVersion } from "../../lib/exercises/lookup";
import {
  addTeamShotmakingAttempt,
  completeTeamExerciseExecution,
  correctTeamShotmakingAttempt,
  createTeamExerciseExecution,
  getTeamAttemptRoleContext,
} from "../../lib/exercises/teamExecution";
import { serializeCompletedTeamExercise, deserializeOwnedTeamExerciseResult } from "../../lib/cloudSporting/teamExerciseRecords";
import { sha256Hex } from "../../lib/cloudSporting/records";
import { CURATED_MEASUREMENT_PROTOCOLS, ROTATION_COUNT_PROTOCOL_ID } from "../../lib/exercises/measurementProtocols";

const SESSION = "10000000-0000-4000-8000-000000000001";
const TEAM = "20000000-0000-4000-8000-000000000002";
const ATHLETE = "30000000-0000-4000-8000-000000000003";
const OTHER_ATHLETE = "40000000-0000-4000-8000-000000000004";
const RECORDER = "50000000-0000-4000-8000-000000000005";
const REVISION = "80000000-0000-4000-8000-000000000008";

afterEach(cleanup);

const C4C_PROPS = {
  onReviseResult: vi.fn(async () => "failed" as const),
  onVoidResult: vi.fn(async () => "failed" as const),
};

async function resultRecord(withNote = true, withCorrection = false) {
  let id = 10;
  let minute = 0;
  const clock = {
    id: () => `70000000-0000-4000-8000-${String(id++).padStart(12, "0")}`,
    now: () => new Date(Date.UTC(2026, 7, 28, 10, minute++)).toISOString(),
  };
  const version = findExerciseVersion(EXERCISE_CATALOG, EIGHT_GUARDS_VERSION_ID)!;
  const created = createTeamExerciseExecution(version, {
    trainingSessionId: SESSION,
    teamId: TEAM,
    recorderProfileId: RECORDER,
    participantRoster: [
      { profileId: ATHLETE, participation: "training-athlete" },
      { profileId: OTHER_ATHLETE, participation: "training-athlete" },
      { profileId: RECORDER, participation: "supporting" },
    ],
    initialRoleAssignment: {
      deliveringAthleteProfileId: ATHLETE,
      sweeperProfileIds: [],
      observerProfileId: RECORDER,
      sweepingUsed: false,
    },
    rotation: { kind: "manual", athleteOrder: [ATHLETE, OTHER_ATHLETE] },
    enabledMeasurementProtocols: [CURATED_MEASUREMENT_PROTOCOLS.find(
      (protocol) => protocol.id === ROTATION_COUNT_PROTOCOL_ID
    )!],
    clock,
  });
  if (!created.ok) throw new Error(created.error.message);
  const attempted = addTeamShotmakingAttempt(created.value, {
    recorderProfileId: RECORDER,
    athleteProfileId: ATHLETE,
    actualHandle: "in",
    evaluation: { status: "scored", score: 3 },
    clock,
  });
  if (!attempted.ok) throw new Error(attempted.error.message);
  let active = attempted.value;
  if (withCorrection) {
    const attempt = active.athleteResults[0].attempts[0];
    if (attempt.kind !== "shotmaking") throw new Error("Missing attempt fixture");
    const role = getTeamAttemptRoleContext(active, attempt);
    if (!role) throw new Error("Missing role fixture");
    const corrected = correctTeamShotmakingAttempt(active, {
      recorderProfileId: RECORDER,
      attemptId: attempt.id,
      athleteProfileId: ATHLETE,
      actualHandle: "out",
      evaluation: { status: "scored", score: 4 },
      measurements: [],
      roleContext: { ...role, sweeperProfileIds: [OTHER_ATHLETE], sweepingUsed: true },
      clock,
    });
    if (!corrected.ok) throw new Error(corrected.error.message);
    active = corrected.value;
  }
  const completed = completeTeamExerciseExecution(active, RECORDER, "2026-08-28T11:00:00Z");
  if (!completed.ok) throw new Error(completed.error.message);
  const upload = serializeCompletedTeamExercise(completed.value)!;
  const bundle = upload.bundles[0];
  return (await deserializeOwnedTeamExerciseResult({
    session: {
      ...upload.session,
      recordedByProfileId: RECORDER,
      contentSha256: (await sha256Hex(upload.session.coordinationPayload))!,
      createdAt: "2026-08-28T11:01:00Z",
    },
    bundle: {
      ...bundle,
      recordedByProfileId: RECORDER,
      contentSha256: (await sha256Hex(bundle.resultPayload))!,
      createdAt: "2026-08-28T11:01:01Z",
    },
    privateNote: withNote ? {
      resultId: bundle.resultIds[0],
      note: "Only I can read this",
      updatedAt: "2026-08-28T12:00:00Z",
    } : null,
    revisions: [],
  }, ATHLETE))!;
}

describe("ExerciseTeamResultsScreen", () => {
  it("shows a factual owned result without rendering participant identities", async () => {
    const user = userEvent.setup();
    render(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[await resultRecord()]} readStatus="refreshed" onRefresh={vi.fn()} onSetPrivateNote={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    expect(screen.getByRole("heading", { name: "Your result" })).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByText("Inhandle · 3/4 (75%)")).toBeInTheDocument();
    expect(screen.getByText(/Context: 0 Sweepers · no sweeping/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Only I can read this")).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "dd" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(OTHER_ATHLETE);
    expect(document.body.textContent).not.toContain(RECORDER);
  });

  it("saves and clears only the selected result's private note", async () => {
    const user = userEvent.setup();
    const record = await resultRecord();
    const onSetPrivateNote = vi.fn(async () => "updated" as const);
    render(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[record]} readStatus="refreshed" onRefresh={vi.fn()} onSetPrivateNote={onSetPrivateNote} />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    const note = screen.getByLabelText("Your private note");
    await user.clear(note);
    await user.type(note, "Changed by me");
    await user.click(screen.getByRole("button", { name: "Save Private Note" }));
    expect(onSetPrivateNote).toHaveBeenCalledWith(record.result.id, "Changed by me");
    await user.click(screen.getByRole("button", { name: "Clear Private Note" }));
    expect(onSetPrivateNote).toHaveBeenLastCalledWith(record.result.id, null);
  });

  it("keeps cached truth visible and distinguishes loading, unavailable and verified-empty states", async () => {
    const record = await resultRecord(false);
    const { rerender } = render(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[record]} readStatus="cached" onRefresh={vi.fn()} onSetPrivateNote={vi.fn()} />);
    expect(screen.getByText(/Showing the last results saved on this device/)).toBeInTheDocument();
    rerender(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[]} readStatus="loading" onRefresh={vi.fn()} onSetPrivateNote={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your cloud Exercise Results");
    expect(screen.queryByRole("heading", { name: "No Team Exercise Results yet" })).not.toBeInTheDocument();
    rerender(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[]} readStatus="unavailable" onRefresh={vi.fn()} onSetPrivateNote={vi.fn()} />);
    expect(screen.getByText(/Cloud Exercise Results are unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "No Team Exercise Results yet" })).not.toBeInTheDocument();
    rerender(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[]} readStatus="refreshed" onRefresh={vi.fn()} onSetPrivateNote={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "No Team Exercise Results yet" })).toBeInTheDocument();
  });

  it("reports note failure without claiming a save", async () => {
    const user = userEvent.setup();
    render(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[await resultRecord(false)]} readStatus="refreshed" onRefresh={vi.fn()} onSetPrivateNote={vi.fn(async () => "failed" as const)} />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    fireEvent.change(screen.getByLabelText("Your private note"), { target: { value: "Offline note" } });
    await user.click(screen.getByRole("button", { name: "Save Private Note" }));
    expect(screen.getByRole("status")).toHaveTextContent("could not be saved");
  });

  it("blocks a private note that exceeds the UTF-8 byte limit", async () => {
    const user = userEvent.setup();
    const onSetPrivateNote = vi.fn();
    render(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[await resultRecord(false)]} readStatus="refreshed" onRefresh={vi.fn()} onSetPrivateNote={onSetPrivateNote} />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    fireEvent.change(screen.getByLabelText("Your private note"), {
      target: { value: "😀".repeat(20_000) },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("too long to save");
    expect(screen.getByRole("button", { name: "Save Private Note" })).toBeDisabled();
    expect(onSetPrivateNote).not.toHaveBeenCalled();
  });

  it("shows only the athlete's active-session correction history without raw identities", async () => {
    const user = userEvent.setup();
    render(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[await resultRecord(false, true)]} readStatus="refreshed" onRefresh={vi.fn()} onSetPrivateNote={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    expect(screen.getByRole("heading", { name: "Correction history" })).toBeInTheDocument();
    expect(screen.getByText(/Inhandle · 3\/4 → Outhandle · 4\/4/)).toBeInTheDocument();
    expect(screen.getByText(/Role or Sweeper context changed/)).toBeInTheDocument();
    expect(screen.getByText(/Context: 1 Sweeper · sweeping used/)).toBeInTheDocument();
    expect(screen.getByText(/Active recorder/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(RECORDER);
    expect(document.body.textContent).not.toContain(OTHER_ATHLETE);
  });

  it("corrects one completed stone without offering athlete reassignment", async () => {
    const user = userEvent.setup();
    const record = await resultRecord(false);
    const onReviseResult = vi.fn<(
      resultId: string,
      replacement: Awaited<ReturnType<typeof resultRecord>>["result"],
      revisionId: string,
      reason: string
    ) => Promise<"updated">>().mockResolvedValue("updated");
    render(<ExerciseTeamResultsScreen
      {...C4C_PROPS}
      results={[record]}
      readStatus="refreshed"
      onRefresh={vi.fn()}
      onSetPrivateNote={vi.fn()}
      onReviseResult={onReviseResult}
    />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    await user.click(screen.getByRole("button", { name: "Correct This Stone" }));
    expect(screen.queryByLabelText("Delivering athlete")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Outhandle" }));
    await user.selectOptions(screen.getByLabelText("Score"), "1");
    await user.type(screen.getByLabelText(/Rotation Count/), "2.5");
    const sweepers = screen.getByRole("group", { name: "Sweepers for this stone" });
    await user.click(within(sweepers).getByRole("checkbox", { name: "Session participant 2" }));
    await user.click(screen.getByRole("checkbox", { name: "Sweeping was used" }));
    await user.type(screen.getByLabelText("Reason for this change"), "Corrected after reviewing the stone outcome");
    await user.click(screen.getByRole("button", { name: "Save Correction" }));
    expect(onReviseResult).toHaveBeenCalledTimes(1);
    const [resultId, replacement, revisionId, reason] = onReviseResult.mock.calls[0];
    expect(resultId).toBe(record.result.id);
    expect(revisionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reason).toBe("Corrected after reviewing the stone outcome");
    expect(replacement.athleteProfileId).toBe(record.athleteProfileId);
    expect(replacement.attempts[0]).toMatchObject({
      athleteProfileId: record.athleteProfileId,
      actualHandle: "out",
      evaluation: { status: "scored", score: 1 },
      measurements: [{ value: 2.5, source: "manual" }],
      teamRoleContextOverride: {
        deliveringAthleteProfileId: record.athleteProfileId,
        sweeperProfileIds: [OTHER_ATHLETE],
        sweepingUsed: true,
      },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Correction saved");
  });

  it("keeps an unconfirmed correction byte-stable for an exact retry", async () => {
    const user = userEvent.setup();
    const onReviseResult = vi.fn()
      .mockResolvedValueOnce("failed" as const)
      .mockResolvedValueOnce("updated" as const);
    render(<ExerciseTeamResultsScreen
      {...C4C_PROPS}
      results={[await resultRecord(false)]}
      readStatus="refreshed"
      onRefresh={vi.fn()}
      onSetPrivateNote={vi.fn()}
      onReviseResult={onReviseResult}
    />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    await user.click(screen.getByRole("button", { name: "Correct This Stone" }));
    await user.selectOptions(screen.getByLabelText("Score"), "2");
    await user.type(screen.getByLabelText("Reason for this change"), "Corrected after reviewing the captured outcome");
    await user.click(screen.getByRole("button", { name: "Save Correction" }));
    expect(screen.getByRole("alert")).toHaveTextContent("retry the exact correction");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry Exact Correction" }));
    expect(onReviseResult).toHaveBeenCalledTimes(2);
    expect(onReviseResult.mock.calls[1]).toEqual(onReviseResult.mock.calls[0]);
  });

  it("requires an explicit terminal confirmation before voiding the complete result", async () => {
    const user = userEvent.setup();
    const record = await resultRecord(false);
    const onVoidResult = vi.fn(async () => "updated" as const);
    render(<ExerciseTeamResultsScreen
      {...C4C_PROPS}
      results={[record]}
      readStatus="refreshed"
      onRefresh={vi.fn()}
      onSetPrivateNote={vi.fn()}
      onVoidResult={onVoidResult}
    />);
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    await user.click(screen.getByRole("button", { name: "Void My Complete Result" }));
    expect(screen.getByText(/cannot be undone in Version 1/)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Void Complete Result" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Reason for voiding"), "This complete result was recorded in error");
    await user.click(confirm);
    expect(onVoidResult).toHaveBeenCalledWith(
      record.result.id,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      "This complete result was recorded in error"
    );
    expect(screen.getByRole("status")).toHaveTextContent("Result voided");
  });

  it("marks revised and voided history without treating a voided score as current", async () => {
    const user = userEvent.setup();
    const corrected = await resultRecord(false);
    const resultingResult = structuredClone(corrected.result);
    const attempt = resultingResult.attempts[0];
    if (attempt.kind !== "shotmaking") throw new Error("Missing Shotmaking fixture");
    attempt.evaluation = { status: "scored", score: 2 };
    resultingResult.updatedAt = "2026-08-28T13:00:00Z";
    corrected.result = resultingResult;
    corrected.postCompletionRevisions = [{
      revisionId: REVISION,
      revisionNumber: 1,
      kind: "corrected",
      changedFields: ["evaluation"],
      reason: "Corrected after reviewing the captured outcome",
      actorProfileId: ATHLETE,
      createdAt: "2026-08-28T13:00:00Z",
      resultingResult,
    }];
    const voided = structuredClone(corrected);
    voided.isVoided = true;
    voided.postCompletionRevisions.push({
      revisionId: "80000000-0000-4000-8000-000000000009",
      revisionNumber: 2,
      kind: "voided",
      changedFields: ["result"],
      reason: "This complete result should not count anymore",
      actorProfileId: ATHLETE,
      createdAt: "2026-08-28T14:00:00Z",
      resultingResult: null,
    });

    render(<ExerciseTeamResultsScreen {...C4C_PROPS} results={[voided]} readStatus="refreshed" onRefresh={vi.fn()} onSetPrivateNote={vi.fn()} />);
    expect(screen.getByText("Voided · Excluded from current calculations")).toBeInTheDocument();
    expect(screen.queryByText(/50% average/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Eight Guards, Progressively Longer/ }));
    expect(screen.getByRole("heading", { name: "Post-completion history" })).toBeInTheDocument();
    expect(screen.getByText(/Inhandle · 3\/4 → Inhandle · 2\/4/)).toBeInTheDocument();
    expect(screen.getByText("Complete result voided", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preserved result" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Correct This Stone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Void My Complete Result" })).not.toBeInTheDocument();
  });
});
