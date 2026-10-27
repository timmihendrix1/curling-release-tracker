// Actual UI + SDK + disposable SQLite; only synthetic transport/device edges.
import React, { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import { fixture, bootstrap, server, teamTransport, profileId } from "./nativeTrackerFixture";
import type { TrainingPlan } from "../../../types";
import { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } from "../../sessionRepository";
import { profileScopedSportingStorageKey } from "../../persistence/profileScopedSportingPersistence";
export async function app(strict = false, plan?: TrainingPlan, intentQuery?: string, inboxFailure = false, setup?: (value: { h: Awaited<ReturnType<typeof fixture>>; b: Awaited<ReturnType<typeof bootstrap>>; runtime: Awaited<ReturnType<Awaited<ReturnType<typeof bootstrap>>["start"]>> }) => Promise<void>) {
  const h = await fixture(), b = await bootstrap(h);
  if (intentQuery) b.setUrl(`https://app.example.invalid/?${intentQuery}`);
  const runtime = await b.start(); server(h);
  const team = intentQuery ? teamTransport(h, inboxFailure) : null;
  await setup?.({ h, b, runtime });
  const browser = intentQuery ? vi.spyOn(await import("../teamServiceFactory"), "createSupabaseTeamService").mockReturnValue(null as never) : null;
  vi.stubGlobal("navigator", { onLine: false, userAgent: "Synthetic Tracker test" });
  if (plan) {
    const { SportingCloudSyncManager } = await import("../../cloudSporting/syncManager");
    const initialize = SportingCloudSyncManager.prototype.initialize;
    vi.spyOn(SportingCloudSyncManager.prototype, "initialize").mockImplementationOnce(async function (this: InstanceType<typeof SportingCloudSyncManager>) {
      // Seed only through the actual genuine admitted native capability, after the
      // real Provider's OTP/onboarding and before Tracker hydration. No ready mock.
      const scope = runtime.createSportingApplicationScope(profileId)!;
      expect((await scope.repositories.trainingPlans.savePlans([plan])).ok).toBe(true);
      await initialize.call(this);
    });
  }
  const { DormantNativeTrackerComposition } = await import("../../../components/persistence/DormantNativeTrackerComposition");
  const tree = <DormantNativeTrackerComposition runtime={runtime} />;
  const rendered = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  await waitFor(() => screen.getByLabelText("Email address"));
  if (intentQuery) {
    // Finish a real unsigned Account poll before OTP, alongside the actual
    // Flow's automatic poll. Neither may invalidate this incoming link.
    expect((await runtime.accountDeletion.getState()).ok).toBe(false);
    expect(await runtime.loadPendingIntent()).not.toBeNull();
  }
  fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
  await waitFor(() => screen.getByLabelText("6-digit code"));
  fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
  await waitFor(() => screen.getByLabelText("Display Name"));
  fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Synthetic Athlete" } });
  for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
  fireEvent.click(screen.getByRole("button", { name: "Create athlete profile" }));
  await waitFor(() => screen.getByTestId("house-home"));
  return { h, b, runtime, rendered, browser, team };
}
export async function read(h: Awaited<ReturnType<typeof fixture>>, key: typeof CURRENT_SESSION_STORAGE_KEY | typeof SESSION_HISTORY_STORAGE_KEY) {
  const result = await h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key = ?;", values: [profileScopedSportingStorageKey(profileId, key)] }) as { values: Array<{ value: string }> };
  return result.values[0]?.value ? JSON.parse(result.values[0].value) : null;
}
export async function start(a: Awaited<ReturnType<typeof app>>) {
  fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
  await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
  fireEvent.click(screen.getByRole("button", { name: /^Technique/ }));
  fireEvent.click(screen.getByRole("button", { name: "View Details: Release Time" }));
  fireEvent.click(screen.getByRole("button", { name: "Continue to Timing Setup" }));
  await waitFor(() => screen.getByText("Ready to train."));
  fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
  await waitFor(() => screen.getByText("Current exercise"));
  await waitFor(async () => expect((await read(a.h, CURRENT_SESSION_STORAGE_KEY))?.blocks).toHaveLength(1));
}
export async function credentialFault(a: Awaited<ReturnType<typeof app>>) {
  a.h.faults.hook = async () => { throw new Error("Synthetic protected read failure"); };
  await act(async () => { await a.runtime.coordinator.revalidateGateFacts(); });
  await waitFor(() => screen.getByRole("heading", { name: "Sign-in storage is unavailable" }));
}
