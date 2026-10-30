// @vitest-environment jsdom
// Original new-user host + installed SDK + actual disposable SQLite + mounted gate.
// Only platform/protected-store and server HTTP edges are synthetic; not a device test.
import "@testing-library/jest-dom/vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { fixture, server } from "./nativeTrackerFixture";
afterEach(cleanup);
it("derives review entry from original native owner and follows normal legal/Profile gate", async () => {
  const h = await fixture();
  const config = await import("../nativeProviderConfiguration");
  const prepared = await config.prepareNativeProviderConfiguration(h.options.config); if (!prepared.ok) throw Error("Synthetic configuration unavailable");
  const result = await h.module.createConfiguredNewUserNativeSportingIdentityHost(prepared.value, { ...h.options, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl: () => {} } });
  if (!result.ok) throw Error("Synthetic host unavailable");
  const host = result.host; server(h);
  try {
    const opened = await host.start(); if (opened.outcome !== "ready") throw Error("Synthetic startup unavailable");
    const { default: IdentityProvider } = await import("../../../components/identity/IdentityProvider");
    render(<IdentityProvider runtime={opened.runtime}><p>Admitted synthetic athlete</p></IdentityProvider>);
    await screen.findByRole("button", { name: "Access for app review" });
    expect(opened.runtime.coordinator.canSignInForReview()).toBe(true);
    fireEvent.click(screen.getByText("Access for app review"));
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-review-ui-only" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in for app review" }));
    await screen.findByLabelText("Display Name");
    expect(screen.queryByText("Admitted synthetic athlete")).toBeNull();
    const checks = screen.getAllByRole("checkbox");
    for (const checkbox of checks) expect(checkbox).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Display Name"), { target: { value: "Synthetic reviewer" } });
    for (const checkbox of checks) fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Create athlete profile" }));
    await screen.findByText("Admitted synthetic athlete");
    expect(h.fetch.mock.calls.filter(([input]) => new URL((input as Request).url).searchParams.get("grant_type") === "password")).toHaveLength(1);
    const rows = await h.raw({ kind: "query", sql: "SELECT value FROM records" }) as { values: { value: string }[] };
    expect(JSON.stringify(rows)).not.toContain("synthetic-review-ui-only");
    await act(async () => { await host.dispose(); });
    await waitFor(() => expect(opened.runtime.coordinator.canSignInForReview()).toBe(false));
  } finally { cleanup(); await host.dispose(); }
});
