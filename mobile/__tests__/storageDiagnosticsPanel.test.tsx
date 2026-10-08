// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import MobileApp from "../src/MobileApp";
import NativeStorageDiagnosticsLauncher from "../src/diagnostics/NativeStorageDiagnosticsLauncher";
import { SYNTHETIC_FIXTURES } from "../src/diagnostics/syntheticFixtures";
import { resetIdentityRuntimeForTests } from "../../src/lib/identity/identityRuntime";

/**
 * Rendered behaviour of the opt-in panel, plus the DEFAULT build's behaviour —
 * which is that the panel does not exist at all.
 *
 * This file runs with no diagnostics define, so `MobileApp` here is exactly the
 * artifact an ordinary `npm run mobile:build` produces.
 */

afterEach(cleanup);

describe("default build", () => {
  it("mounts no diagnostics surface and reaches the ordinary identity gate", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    resetIdentityRuntimeForTests();
    render(<MobileApp />);

    expect(screen.queryByRole("button", { name: "Storage diagnostics" })).not.toBeInTheDocument();
    expect(screen.queryByText("Native storage diagnostics")).not.toBeInTheDocument();
    // The real gate is still what the app shows.
    expect(screen.getByRole("heading", { name: "Athlete access" })).toBeInTheDocument();
  });
});

describe("diagnostics panel", () => {
  it("starts as a launcher and runs nothing on mount", () => {
    render(<NativeStorageDiagnosticsLauncher />);

    expect(screen.getByRole("button", { name: "Storage diagnostics" })).toBeInTheDocument();
    // No action, no result, no database work until a deliberate press.
    expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  });

  it("opens and closes without writing anything", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);

    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    expect(screen.getByText("Native storage diagnostics")).toBeInTheDocument();
    // Opening the panel must not overwrite the previous run — otherwise restart
    // evidence would be destroyed by the act of looking at it.
    expect(screen.getByText("Nothing has been run yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("button", { name: "Storage diagnostics" })).toBeInTheDocument();
  });

  it("names the synthetic database and every action, and claims nothing about power loss", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    expect(screen.getByText("curling-storage-diagnostics-synthetic")).toBeInTheDocument();
    for (const label of [
      "Write synthetic fixtures",
      "Verify in this app session",
      "Update and remove a test key",
      "Close and reopen the database",
      "Verify after app restart",
      "Read effective SQLite settings",
      "Delete the synthetic data",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    for (const fixture of SYNTHETIC_FIXTURES) {
      expect(screen.getByText(fixture.label)).toBeInTheDocument();
    }
    expect(
      screen.getByText(/None of them is\s+evidence about power loss\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/measurement points, not a safe capacity/)).toBeInTheDocument();
  });

  it("fails closed on a non-native platform instead of using web storage", async () => {
    const user = userEvent.setup();
    render(<NativeStorageDiagnosticsLauncher />);
    await user.click(screen.getByRole("button", { name: "Storage diagnostics" }));

    // jsdom is not a Capacitor native platform, and the panel says so rather
    // than quietly exercising something else.
    expect(screen.getByText(/native storage is unavailable/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Write synthetic fixtures" }));
    expect(await screen.findByText(/storage_unavailable/)).toBeInTheDocument();
    // localStorage is untouched: no fallback path exists.
    expect(window.localStorage.length).toBe(0);
  });
});
