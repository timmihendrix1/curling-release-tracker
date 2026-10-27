// @vitest-environment jsdom
// Actual Tracker + actual IdentityProvider/OTP/onboarding + installed SDK and
// disposable SQLite. Synthetic protected store; no physical-device assertion.
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { response, deferred, releases } from "./nativeTrackerFixture";
import type { TrainingPlan } from "../../../types";
import { EXERCISE_CATALOG } from "../../exercises/catalog";
import { RELEASE_POINT_VERSION_ID } from "../../exercises/content";
import { findExerciseVersion } from "../../exercises/lookup";
import { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } from "../../sessionRepository";
import { app, read, start, credentialFault } from "./nativeTrackerUiFixture";
afterEach(cleanup);
it("records another block and an actual shot in the original Session, then saves without creating a successor", async () => {
  const a = await app(); await start(a); const originalId = (await read(a.h, CURRENT_SESSION_STORAGE_KEY)).id;
  await credentialFault(a);
  expect(screen.getByText("Cloud sync paused")).toBeVisible();
  expect(screen.getByText("You can keep recording in this training. Cloud sync and sign-in are paused. A new training cannot start.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "New Training Block" }));
  await waitFor(() => screen.getByRole("button", { name: "Start Block" }));
  fireEvent.click(screen.getByRole("button", { name: "Start Block" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).blocks).toHaveLength(2));
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), { target: { value: "3.80" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).shots).toHaveLength(1));
  // The existing direct-updater path also remains inside this same Session.
  fireEvent.click(screen.getByText(/Edit Details —/));
  fireEvent.change(screen.getByPlaceholderText("e.g. Draw Training"), { target: { value: "Continued training" } });
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).title).toBe("Continued training"));
  fireEvent.click(screen.getByRole("button", { name: "Complete Session" }));
  await waitFor(() => screen.getByRole("heading", { name: "Complete Session" }));
  fireEvent.click(screen.getByRole("button", { name: "Complete" }));
  await waitFor(() => screen.getByRole("heading", { name: "Training saved on this device" }));
  const history = await read(a.h, SESSION_HISTORY_STORAGE_KEY); expect(history[0].id).toBe(originalId); expect(history[0].shots).toHaveLength(1);
  expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).id).toBe(originalId);
  expect(screen.getByRole("button", { name: "Save Shot" })).toBeDisabled();
  expect(a.b.host.health().runtime?.credential).toBe("failed");
});
it("keeps an actual StrictMode tree on the original host and refuses fault on empty Home", async () => {
  const a = await app(true); await credentialFault(a);
  expect(screen.getByText("Training changes are paused. Your existing data has not been cleared.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
  await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  fireEvent.click(screen.getByRole("button", { name: /^Technique/ }));
  fireEvent.click(screen.getByRole("button", { name: "View Details: Release Time" }));
  const detail = screen.getByTestId("house-training");
  expect(within(detail).getByRole("button", { name: "Continue to Timing Setup" })).toBeDisabled();
  expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY))?.blocks ?? []).toHaveLength(0);
  expect(a.b.host.health().sdkFailed).toBe(false);
});

it("starts another actual Solo Exercise in the same Session after the fault", async () => {
  const a = await app();
  fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Technique/ }));
  fireEvent.click(screen.getByRole("button", { name: "View Details: Release Point" }));
  fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY))?.exerciseExecutions).toHaveLength(1));
  const id = (await read(a.h, CURRENT_SESSION_STORAGE_KEY)).id;
  await credentialFault(a);
  fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).exerciseExecutions[0].status).toBe("completed"));
  fireEvent.click(screen.getByRole("button", { name: "Back to Exercise Library" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Technique/ }));
  const all = screen.queryByRole("button", { name: "Show all exercises" }); if (all) fireEvent.click(all);
  fireEvent.click(screen.getByRole("button", { name: "View Details: Rotation Count" }));
  fireEvent.click(screen.getByRole("button", { name: "Start Exercise" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).exerciseExecutions).toHaveLength(2));
  expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).id).toBe(id);
});
it("materializes the next existing Plan step after fault with actual commit and durable ACK", async () => {
  const version = findExerciseVersion(EXERCISE_CATALOG, RELEASE_POINT_VERSION_ID)!;
  const plan: TrainingPlan = { id: "synthetic-two-step-plan", name: "Synthetic two-step training", schemaVersion: 2, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", steps: [
    { id: "step-1", type: "curated-exercise", exerciseVersionSnapshot: version, completion: { type: "exercise-completion" } },
    { id: "step-2", type: "curated-exercise", exerciseVersionSnapshot: version, completion: { type: "exercise-completion" } },
  ] };
  const a = await app(false, plan);
  fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
  await waitFor(() => expect(screen.getByRole("tab", { name: "Training Plans" })).toBeEnabled());
  fireEvent.click(screen.getByRole("tab", { name: "Training Plans" }));
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start Training" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY))?.planExecution?.activeStepIndex).toBe(0));
  const id = (await read(a.h, CURRENT_SESSION_STORAGE_KEY)).id;
  await credentialFault(a);
  fireEvent.click(screen.getByRole("button", { name: "Complete Exercise" }));
  fireEvent.click(await screen.findByRole("button", { name: "Next Exercise" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).planExecution.activeStepIndex).toBe(1));
  const current = await read(a.h, CURRENT_SESSION_STORAGE_KEY); expect(current.id).toBe(id); expect(current.exerciseExecutions).toHaveLength(2);
  expect(screen.queryByText(/could not be saved yet/)).toBeNull();
});

it("rejects a forged runtime before any Provider runtime getter or Web fallback", async () => {
  const { DormantNativeTrackerComposition } = await import("../../../components/persistence/DormantNativeTrackerComposition");
  const forged = new Proxy({}, { get() { throw new Error("A forged runtime getter was evaluated"); } });
  render(<DormantNativeTrackerComposition runtime={forged as Parameters<typeof DormantNativeTrackerComposition>[0]["runtime"]} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Training data is unavailable"); expect(screen.queryByTestId("house-home")).toBeNull();
});
it("actual Provider unmounts training on definitive denial despite failed credential cleanup", async () => {
  const a = await app(); await start(a);
  const previous = a.h.fetch.getMockImplementation()!;
  a.h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.includes("/token?") ? response({ code: "refresh_token_not_found", message: "SYNTHETIC_PROVIDER_DETAIL" }, 400) : previous(...args));
  a.h.faults.hook = async (event, next) => { if (event.kind === "remove") throw new Error("Synthetic cleanup failure"); return next(); };
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 3_601_000);
  fireEvent(window, new Event("online"));
  await waitFor(() => expect(screen.queryByTestId("house-training")).toBeNull());
  expect(screen.getByRole("heading", { name: "Athlete access" })).toBeVisible();
  expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).blocks).toHaveLength(1);
});

it("keeps a newer actual entry draft when a normal write ACK arrives during Q1 continuation", async () => {
  const a = await app(); await start(a);
  const credentialEntered = deferred<void>(), credentialRelease = deferred<void>(), sqlEntered = deferred<void>(), sqlRelease = deferred<void>();
  releases.push(() => credentialRelease.resolve(), () => sqlRelease.resolve());
  a.h.faults.hook = async event => { if (event.kind === "read") { credentialEntered.resolve(); await credentialRelease.promise; } throw new Error("Synthetic protected failure"); };
  let failing!: ReturnType<typeof a.runtime.coordinator.revalidateGateFacts>;
  act(() => { failing = a.runtime.coordinator.revalidateGateFacts(); }); await credentialEntered.promise;
  let held = false;
  a.h.sqlFaults.hook = async (event, next) => { if (event.kind === "commit" && !held) { held = true; sqlEntered.resolve(); await sqlRelease.promise; } return next(); };
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), { target: { value: "3.80" } });
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" })); await sqlEntered.promise;
  fireEvent.change(screen.getByPlaceholderText("3.75 or 375"), { target: { value: "3.90" } });
  await act(async () => { credentialRelease.resolve(); await failing; });
  expect(screen.getByText("You can keep recording in this training. Cloud sync and sign-in are paused. A new training cannot start.")).toBeVisible();
  await act(async () => { sqlRelease.resolve(); });
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).shots).toHaveLength(1));
  expect(screen.getByPlaceholderText("3.75 or 375")).toHaveValue("3.90");
  fireEvent.click(screen.getByRole("button", { name: "Save Shot" }));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY)).shots).toHaveLength(2));
});

// Actual UI reproductions from the independent code review.
it("does not enter browser Team composition from the actual paused native Tracker",async()=>{
 const a=await app(); await start(a); await credentialFault(a);
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://synthetic-browser-fallback.invalid');
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','sb_publishable_SYNTHETIC_BROWSER_BOUNDARY');
 const factory=await import('../teamServiceFactory');
 const browser=vi.spyOn(factory,'createSupabaseTeamService').mockReturnValue(null as never);
 fireEvent.click(screen.getAllByRole('button',{name:'Settings'})[0]);
 fireEvent.click(screen.getByRole('button',{name:/Teams/}));
 expect(browser).not.toHaveBeenCalled();
});

it("keeps a fresh actual healthy Tracker mount usable under the same original admission",async()=>{
 const a=await app(); await start(a);
 const tracker=await import('../../../components/TrackerApp'); const Original=tracker.default;
 vi.spyOn(tracker,'default').mockImplementation(()=>React.createElement(Original));
 const {DormantNativeTrackerComposition}=await import('../../../components/persistence/DormantNativeTrackerComposition');
 a.rendered.rerender(React.createElement(DormantNativeTrackerComposition,{runtime:a.runtime}));
 await waitFor(()=>screen.getByTestId('house-home'));
 fireEvent.click(screen.getByRole('button',{name:'Resume training'}));
 await waitFor(()=>screen.getByRole('button',{name:'Save Shot'}));
 expect(a.b.host.health().runtime?.credential).toBe('healthy');
 fireEvent.change(screen.getByPlaceholderText('3.75 or 375'),{target:{value:'3.80'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Shot'}));
 await waitFor(async()=>expect((await read(a.h,CURRENT_SESSION_STORAGE_KEY)).shots).toHaveLength(1));
});

it.each([
  ["invitation", "inviteToken=synthetic-invitation-kept", "synthetic-invitation-kept"],
  ["admin_request", "adminRequestId=77777777-7777-4777-8777-777777777777", "77777777-7777-4777-8777-777777777777"],
])("preserves a real pending %s without selecting browser Team composition", async (kind, query, value) => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-browser-fallback.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_SYNTHETIC_BROWSER_BOUNDARY");
  const a = await app(false, undefined, query, kind === "admin_request");
  if (kind === "invitation") {
    expect(await screen.findByText(/Synthetic Admin invited you/)).toBeVisible();
    expect(a.team!.calls).toContain("preview_invitation");
  } else {
    expect(await screen.findByRole("button", { name: "Close Teams" })).toBeVisible();
    await waitFor(() => expect(a.team!.calls).toContain("team_admin_requests"));
  }
  expect(a.browser).not.toHaveBeenCalled();
  const { PENDING_INTENT_STORAGE_KEY } = await import("../../identity/pendingIntentRepository");
  const stored = await a.h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key = ?;", values: [PENDING_INTENT_STORAGE_KEY] }) as { values: Array<{ value: string }> };
  expect(JSON.parse(stored.values[0].value)).toMatchObject({ kind, value });
});
