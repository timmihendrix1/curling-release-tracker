// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { finishApplication, mobileFixture } from "../../src/lib/supabase/__tests__/nativeNewUserMobileFixture";
import { server, profileId } from "../../src/lib/supabase/__tests__/nativeTrackerFixture";
import { CURRENT_SESSION_STORAGE_KEY } from "../../src/lib/sessionRepository";
import { profileScopedSportingStorageKey } from "../../src/lib/persistence/profileScopedSportingPersistence";

it("actual beta root survives StrictMode, requires OTP/onboarding and saves genuine Profile training", async () => {
  const { h, app: unused, engine } = await mobileFixture();
  await finishApplication(unused); // inert fixture owner; the root constructs its own actual owner
  const importProbeWrites = [...h.source.writes]; // installed SDK module diagnostic, before root admission
  server(h); vi.stubGlobal("navigator", { onLine: false, userAgent: "Synthetic iOS root" });
  const owner = await import("../../src/lib/supabase/newUserMobileApplication"), create = owner.createNewUserMobileApplication;
  let application: ReturnType<typeof create> | null = null;
  vi.spyOn(owner, "createNewUserMobileApplication").mockImplementation(() => { application = create(); return application; });
  const { default: NewUserBetaRoot } = await import("../src/storage/NewUserBetaRoot");
  const rendered = render(<StrictMode><NewUserBetaRoot /></StrictMode>);
  try {
    await waitFor(() => screen.getByLabelText("Email address"));
    expect(screen.queryByRole("navigation")).toBeNull(); expect(screen.queryByRole("button", { name: /Google|Apple/i })).toBeNull();
    expect(engine).toHaveBeenCalledTimes(1);
    rendered.rerender(<StrictMode><NewUserBetaRoot /></StrictMode>);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    await waitFor(() => screen.getByLabelText("6-digit code"));
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));
    await waitFor(() => screen.getByLabelText("Display Name"));
    expect(screen.queryByRole("navigation")).toBeNull();
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Synthetic Athlete" } });
    for (const checkbox of screen.getAllByRole("checkbox")) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Create athlete profile" }));
    await waitFor(() => screen.getByTestId("house-home"));
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    await waitFor(() => screen.getByRole("heading", { level: 2, name: "Exercises" }));
    fireEvent.click(screen.getByRole("button", { name: /^Technique/ }));
    fireEvent.click(screen.getByRole("button", { name: "View Details: Release Time" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Timing Setup" }));
    await waitFor(() => screen.getByText("Ready to train."));
    fireEvent.click(screen.getByRole("button", { name: "Start Training" }));
    await waitFor(() => screen.getByText("Current exercise"));
    await waitFor(async () => {
      const raw = await h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key = ?", values: [profileScopedSportingStorageKey(profileId, CURRENT_SESSION_STORAGE_KEY)] }) as { values: { value: string }[] };
      expect(JSON.parse(raw.values[0].value).blocks).toHaveLength(1);
    });
    expect(h.source.writes).toEqual(importProbeWrites); expect(engine).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => { rendered.unmount(); await Promise.resolve(); });
    if (application) await finishApplication(application as ReturnType<typeof create>);
    cleanup();
  }
}, 20000);
