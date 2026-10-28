import { describe, expect, it, vi } from "vitest";
import type { CaptureResult, PostHogConfig } from "posthog-js/dist/module.slim.no-external";
import { ANALYTICS_CONSENT_KEY, analyticsProfileId, createProductAnalytics, filterAnalyticsPayload, resolveAnalyticsConfig, type AnalyticsDependencies } from "../productAnalytics";

function fixture(overrides: Partial<AnalyticsDependencies> = {}) {
  const data = new Map<string, string>();
  const sdk = { capture: vi.fn(), identify: vi.fn(), opt_out_capturing: vi.fn() };
  const create = vi.fn((token: string, config: Partial<PostHogConfig>) => { void token; void config; return sdk; });
  const deps: AnalyticsDependencies = {
    config: { token: "phc_syntheticTestToken0001", host: "https://eu.i.posthog.com" },
    storage: () => ({ get: async key => ({ status: "value" as const, value: data.get(key) ?? null }), set: async (key, value) => { data.set(key, value); return { ok: true as const }; } }),
    newId: () => "anonymous_test_identifier_123456",
    pseudonym: async id => `profile_${id}`,
    platform: () => "web", online: () => true,
    loadSdk: vi.fn(async () => ({ create })), ...overrides,
  };
  const analytics = createProductAnalytics(deps);
  analytics.attach();
  return { analytics, sdk, create, deps, data };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

describe("optional product analytics boundary", () => {
  it("requires the exact separate Swiss beta flag; normal builds retain opt-in", () => {
    expect(resolveAnalyticsConfig("1", "phc_test", "https://eu.i.posthog.com", "1")?.chBetaOptOut).toBe(true);
    expect(resolveAnalyticsConfig("1", "phc_test", "https://eu.i.posthog.com", "true")?.chBetaOptOut).toBeUndefined();
  });
  it("does not load the SDK until a new Swiss tester continues after the notice", async () => {
    const f = fixture({ config: { token: "phc_syntheticTestToken0001", host: "https://eu.i.posthog.com", chBetaOptOut: true } });
    f.analytics.syncIdentity(null, true);
    expect(f.analytics.getEntryState()).toBe("loading");
    await flush();
    expect(f.analytics.getEntryState()).toBe("notice");
    expect(f.deps.loadSdk).not.toHaveBeenCalled(); expect(f.data.size).toBe(0);
    await f.analytics.continueAfterNotice(); await flush();
    expect(f.analytics.getEntryState()).toBe("ready");
    expect(f.sdk.capture).toHaveBeenCalledWith("onboarding_started", { app_platform: "web" });
    expect(JSON.parse(f.data.get(ANALYTICS_CONSENT_KEY)!)).toMatchObject({ version: 2, basis: "ch_notice" });
  });
  it("lets Swiss testers decline and reload without a repeated prompt or SDK request", async () => {
    const f = fixture({ config: { token: "phc_syntheticTestToken0001", host: "https://eu.i.posthog.com", chBetaOptOut: true } });
    f.analytics.syncIdentity("one", false); await flush();
    await f.analytics.choose(false);
    expect(f.analytics.getEntryState()).toBe("ready");
    f.analytics.detach(); f.analytics.attach(); f.analytics.syncIdentity("one", false); await flush();
    expect(f.analytics.getEntryState()).toBe("ready"); expect(f.analytics.getEnabled()).toBe(false);
    expect(f.deps.loadSdk).not.toHaveBeenCalled();
  });
  it("preserves legacy refusal and malformed choices instead of adopting the Swiss default", async () => {
    for (const value of ["null", "broken-json", '{"version":22,"enabled":true}']) {
      const f = fixture({ config: { token: "phc_syntheticTestToken0001", host: "https://eu.i.posthog.com", chBetaOptOut: true } });
      f.analytics.detach(); f.data.set(ANALYTICS_CONSENT_KEY, value);
      f.analytics.attach(); f.analytics.syncIdentity("one", false); await flush();
      expect(f.analytics.getEntryState()).toBe("ready"); expect(f.analytics.getEnabled()).toBe(false);
      expect(f.deps.loadSdk).not.toHaveBeenCalled();
    }
  });
  it("does not reinterpret Swiss notice acknowledgement as opt-in outside the Swiss mode", async () => {
    const f = fixture(); f.analytics.detach();
    f.data.set(ANALYTICS_CONSENT_KEY, JSON.stringify({ version: 2, enabled: true, basis: "ch_notice", anonymousId: "anonymous_identifier_123456", profileId: "one" }));
    f.analytics.attach(); f.analytics.syncIdentity("one", false); await flush();
    expect(f.analytics.getEnabled()).toBe(false); expect(f.deps.loadSdk).not.toHaveBeenCalled();
    await f.analytics.choose(true); await flush();
    expect(JSON.parse(f.data.get(ANALYTICS_CONSENT_KEY)!)).toMatchObject({ basis: "explicit_opt_in" });
    expect(f.sdk.identify).toHaveBeenCalledWith("profile_one");
  });
  it("keeps valid legacy opt-in and never prompts or auto-enables on replacement ownership", async () => {
    const f = fixture({ config: { token: "phc_syntheticTestToken0001", host: "https://eu.i.posthog.com", chBetaOptOut: true } });
    f.analytics.detach();
    f.data.set(ANALYTICS_CONSENT_KEY, JSON.stringify({ version: 1, enabled: true, anonymousId: "anonymous_identifier_123456", profileId: "one" }));
    f.analytics.attach(); f.analytics.syncIdentity("one", false); await flush();
    expect(f.analytics.getEnabled()).toBe(true); expect(f.analytics.getEntryState()).toBe("ready");
    f.analytics.syncIdentity("two", false); await flush();
    expect(f.analytics.getEnabled()).toBe(false); expect(f.analytics.getEntryState()).toBe("ready");
  });
  it("requires explicit activation, a public project token and the exact EU ingestion host", () => {
    expect(resolveAnalyticsConfig("1", "phc_test", "https://eu.i.posthog.com")).not.toBeNull();
    for (const [enabled, token, host] of [["0", "phc_test", "https://eu.i.posthog.com"], ["1", "secret", "https://eu.i.posthog.com"], ["1", "phc_test", "https://us.i.posthog.com"], ["1", "phc_test", "https://eu.i.posthog.com/"], ["1", "", "https://eu.i.posthog.com"]]) expect(resolveAnalyticsConfig(enabled, token, host)).toBeNull();
  });
  it("makes no SDK calls or storage writes before voluntary consent", async () => {
    const f = fixture(); f.analytics.syncIdentity("one", false);
    f.analytics.capture("training_started", "one", "a"); await flush();
    expect(f.deps.loadSdk).not.toHaveBeenCalled(); expect(f.data.size).toBe(0);
  });
  it("stays unavailable without build configuration, even after a consent action", async () => {
    const f = fixture({ config: null }); f.analytics.syncIdentity("one", false); await f.analytics.choose(true); await flush();
    expect(f.analytics.getStatus()).toBe("unavailable"); expect(f.create).not.toHaveBeenCalled();
  });
  it("links anonymous onboarding to a pseudonymous profile and retains no raw profile in the SDK", async () => {
    const f = fixture(); f.analytics.syncIdentity(null, true); await f.analytics.choose(true); await flush();
    expect(f.sdk.capture).toHaveBeenCalledWith("onboarding_started", { app_platform: "web" });
    f.analytics.syncIdentity("one", false); f.analytics.capture("onboarding_completed", "one", "one"); await flush();
    expect(f.sdk.identify).toHaveBeenCalledWith("profile_one");
    expect(f.sdk.capture).toHaveBeenCalledWith("onboarding_completed", { app_platform: "web" });
    expect(f.create.mock.calls[0][1]).toMatchObject({ persistence: "memory", disable_persistence: true, autocapture: false, capture_pageview: false, capture_pageleave: false, disable_session_recording: true, advanced_disable_flags: true, capture_exceptions: false, disable_external_dependency_loading: true });
  });
  it("does not initialize a delayed SDK after withdrawal or unmount", async () => {
    for (const action of ["revoke", "detach"] as const) {
      let resolve!: (value: Awaited<ReturnType<AnalyticsDependencies["loadSdk"]>>) => void;
      const promise = new Promise<Awaited<ReturnType<AnalyticsDependencies["loadSdk"]>>>(done => { resolve = done; });
      const f = fixture({ loadSdk: () => promise }); f.analytics.syncIdentity("one", false); await f.analytics.choose(true); await flush();
      f.analytics[action](); resolve({ create: f.create }); await flush(); expect(f.create).not.toHaveBeenCalled();
    }
  });
  it("does not attribute a delayed completion to a replacement account", async () => {
    const f = fixture(); f.analytics.syncIdentity("one", false); await f.analytics.choose(true); await flush();
    const done = f.analytics.prepare("training_completed", "one", "s1");
    f.analytics.syncIdentity("two", false); await f.analytics.choose(true); await flush(); done();
    expect(f.sdk.capture).not.toHaveBeenCalledWith("training_completed", expect.anything());
    expect(f.sdk.opt_out_capturing).toHaveBeenCalled();
  });
  it("does not backfill earlier work after late consent", async () => {
    const f = fixture(); f.analytics.syncIdentity("one", false);
    const done = f.analytics.prepare("training_completed", "one", "s1");
    await f.analytics.choose(true); await flush(); done(); expect(f.sdk.capture).not.toHaveBeenCalled();
  });
  it("deduplicates successful completion retries and discards offline events", async () => {
    let online = false;
    const f = fixture({ online: () => online }); f.analytics.syncIdentity("one", false); await f.analytics.choose(true); await flush();
    f.analytics.capture("training_completed", "one", "offline"); online = true;
    f.analytics.capture("training_completed", "one", "offline"); expect(f.sdk.capture).not.toHaveBeenCalled();
    f.analytics.capture("training_completed", "one", "saved"); f.analytics.capture("training_completed", "one", "saved");
    expect(f.sdk.capture).toHaveBeenCalledTimes(1);
  });
  it("fails closed for malformed or unreadable persisted consent and failed consent writes", async () => {
    const f = fixture({ storage: () => { throw new Error("blocked"); } });
    f.analytics.syncIdentity("one", false); await f.analytics.choose(true); await flush(); expect(f.create).not.toHaveBeenCalled();
    const g = fixture(); g.analytics.detach(); g.data.set(ANALYTICS_CONSENT_KEY, '{"enabled":true}'); g.analytics.attach(); g.analytics.syncIdentity("one", false); await flush();
    expect(g.create).not.toHaveBeenCalled();
  });
  it("rejects saved consent belonging to another account, including onboarding", async () => {
    for (const target of ["two", null]) {
      const f = fixture(); f.analytics.syncIdentity("one", false); await f.analytics.choose(true); await flush(); f.analytics.detach();
      f.analytics.attach(); f.analytics.syncIdentity(target, target === null); await flush();
      expect(f.analytics.getStatus()).toBe("off"); expect(f.data.get(ANALYTICS_CONSENT_KEY)).toBe("null");
    }
  });
  it("contains SDK failures instead of rejecting training callbacks", async () => {
    const f = fixture(); f.analytics.syncIdentity("one", false); await f.analytics.choose(true); await flush(); f.sdk.capture.mockImplementation(() => { throw new Error("network"); });
    expect(() => f.analytics.capture("training_completed", "one", "s")).not.toThrow();
  });
  it("whitelists manual payloads and drops SDK URL, personal and sporting enrichment", () => {
    const payload = { event: "training_completed", $set: { email: "private@example.invalid" }, $set_once: { url: "secret" }, properties: { distinct_id: "profile_abc", app_platform: "ios", $current_url: "https://app.invalid/?token=secret", email: "private@example.invalid", notes: "private", releaseTime: 3.7, $set: { name: "private" } } } as unknown as CaptureResult;
    expect(filterAnalyticsPayload(payload, true)?.properties).toEqual({ distinct_id: "profile_abc", app_platform: "ios", analytics_schema_version: 1, environment: "beta" });
    expect(filterAnalyticsPayload(payload, true)).not.toHaveProperty("$set");
    expect(filterAnalyticsPayload(payload, true)).not.toHaveProperty("$set_once");
    expect(filterAnalyticsPayload(payload, false)).toBeNull();
    expect(filterAnalyticsPayload({ ...payload, event: "$pageview" }, true)).toBeNull();
    expect(filterAnalyticsPayload({ ...payload, event: "$identify", properties: { distinct_id: "profile_abc", $anon_distinct_id: "anon_123" } }, true)?.properties.$anon_distinct_id).toBe("anon_123");
  });
  it("derives stable, non-raw pseudonyms for operator erasure across devices", async () => {
    const id = await analyticsProfileId("00000000-0000-4000-8000-000000000001");
    expect(id).toMatch(/^profile_[0-9a-f]{64}$/);
    expect(await analyticsProfileId("00000000-0000-4000-8000-000000000001")).toBe(id);
    expect(await analyticsProfileId("00000000-0000-4000-8000-000000000002")).not.toBe(id);
  });
});
