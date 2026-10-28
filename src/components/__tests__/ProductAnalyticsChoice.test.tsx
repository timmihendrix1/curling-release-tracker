// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductAnalyticsChoice, ProductAnalyticsEntry, ProductAnalyticsScope } from "../ProductAnalytics";
import { createProductAnalytics } from "../../lib/productAnalytics";

afterEach(cleanup);
describe("optional analytics choice", () => {
  for (const enabled of [true, false]) it(`offers an independent Swiss entry; continuing with analytics ${enabled}`, async () => {
    const data = new Map<string, string>();
    const sdk = { capture: vi.fn(), identify: vi.fn(), opt_out_capturing: vi.fn() };
    const loadSdk = vi.fn(async () => ({ create: () => sdk }));
    const analytics = createProductAnalytics({
      config: { token: "phc_syntheticTestToken0001", host: "https://eu.i.posthog.com", chBetaOptOut: true },
      storage: () => ({ get: async key => ({ status: "value", value: data.get(key) ?? null }), set: async (key, value) => { data.set(key, value); return { ok: true }; } }),
      newId: () => "anonymous_identifier_123456", pseudonym: async () => "profile_test", platform: () => "web", online: () => true, loadSdk,
    });
    analytics.attach(); analytics.syncIdentity("profile", false);
    render(<ProductAnalyticsScope analytics={analytics}><ProductAnalyticsEntry><p>Training remains available</p><ProductAnalyticsChoice /></ProductAnalyticsEntry></ProductAnalyticsScope>);
    await screen.findByRole("heading", { name: "Help improve Evolane Curling" });
    expect(screen.queryByText("Training remains available")).not.toBeInTheDocument();
    expect(loadSdk).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "How usage analytics works" })).toHaveAttribute("href", "/legal/privacy/2026-10-28-ch-beta");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Continue without usage analytics" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: enabled ? "Continue" : "Continue without usage analytics" }));
    await screen.findByText("Training remains available");
    await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("checked", enabled));
    if (enabled) {
      await waitFor(() => expect(sdk.identify).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("checkbox"));
      await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
      expect(sdk.opt_out_capturing).toHaveBeenCalled();
    } else expect(loadSdk).not.toHaveBeenCalled();
    analytics.detach();
  });
  it("is unchecked, separate and reversible without submitting required documents", async () => {
    const sdk = { capture: vi.fn(), identify: vi.fn(), opt_out_capturing: vi.fn() };
    const analytics = createProductAnalytics({
      config: { token: "phc_syntheticTestToken0001", host: "https://eu.i.posthog.com" },
      storage: () => ({ get: async () => ({ status: "value", value: null }), set: async () => ({ ok: true }) }),
      newId: () => "anonymous_identifier_123456", pseudonym: async () => "profile_test", platform: () => "web", online: () => true,
      loadSdk: async () => ({ create: () => sdk }),
    });
    analytics.attach(); analytics.syncIdentity("profile", false);
    render(<ProductAnalyticsScope analytics={analytics}><ProductAnalyticsChoice /></ProductAnalyticsScope>);
    const choice = screen.getByRole("checkbox", { name: /Help improve Evolane Curling/ });
    expect(choice).not.toBeChecked(); expect(sdk.capture).not.toHaveBeenCalled();
    expect(screen.getByText(/separate from accepting the Terms/)).toBeInTheDocument();
    fireEvent.click(choice);
    await waitFor(() => expect(choice).toBeChecked());
    await waitFor(() => expect(sdk.identify).toHaveBeenCalledWith("profile_test"));
    fireEvent.click(choice);
    await waitFor(() => expect(choice).not.toBeChecked());
    expect(sdk.opt_out_capturing).toHaveBeenCalled();
    analytics.capture("training_started", "profile"); expect(sdk.capture).not.toHaveBeenCalled();
  });
  it("does not display an opt-in control for an unconfigured build", () => {
    const analytics = createProductAnalytics({ config: null, storage: () => { throw new Error("must not read storage"); }, newId: () => "unused", pseudonym: async () => "unused", platform: () => "web", online: () => true, loadSdk: async () => { throw new Error("must not load"); } });
    analytics.attach();
    render(<ProductAnalyticsScope analytics={analytics}><ProductAnalyticsChoice /></ProductAnalyticsScope>);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
