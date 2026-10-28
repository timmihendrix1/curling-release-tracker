import type { PostHogConfig, CaptureResult } from "posthog-js/dist/module.slim.no-external";
import type { StorageAdapter } from "./persistence/types";

export const PRODUCT_EVENTS = [
  "onboarding_started", "onboarding_completed", "training_started", "training_completed",
  "exercise_viewed", "exercise_started", "exercise_completed", "training_plan_started",
  "assessment_started", "assessment_completed", "analysis_viewed",
] as const;
export type ProductEvent = typeof PRODUCT_EVENTS[number];
export const ANALYTICS_CONSENT_KEY = "curling.product-analytics-consent.v1";
export const ANALYTICS_PRIVACY_PATH = "/legal/privacy/2026-10-28-ch-beta";
export type AnalyticsConfig = { token: string; host: string; chBetaOptOut?: boolean };

export function resolveAnalyticsConfig(enabled?: string, token?: string, host?: string, chBeta?: string): AnalyticsConfig | null {
  if (enabled !== "1" || !token || !/^phc_[A-Za-z0-9]+$/.test(token) || host !== "https://eu.i.posthog.com") return null;
  return { token, host, ...(chBeta === "1" ? { chBetaOptOut: true } : {}) };
}

export interface AnalyticsSdk {
  capture(event: string, properties?: Record<string, unknown>): unknown;
  identify(id: string): void;
  opt_out_capturing(): void;
}
type Consent = { version: 1 | 2; enabled: true; anonymousId: string; profileId: string | null; basis?: "explicit_opt_in" | "ch_notice" };
export type AnalyticsEntryState = "loading" | "notice" | "ready";
export type AnalyticsStatus = "off" | "on" | "unavailable";
export type AnalyticsDependencies = {
  config: AnalyticsConfig | null;
  storage(): StorageAdapter;
  newId(): string;
  pseudonym(profileId: string): Promise<string>;
  platform(): string;
  online(): boolean;
  loadSdk(): Promise<{ create(token: string, config: Partial<PostHogConfig>): AnalyticsSdk }>;
};

/** Explicit whitelist. SDK enrichment must not leak URL/OTP, referrer, email or $set data. */
export function filterAnalyticsPayload(payload: CaptureResult | null, allowed: boolean, projectToken?: string): CaptureResult | null {
  if (!payload || !allowed || ![...PRODUCT_EVENTS, "$identify"].includes(payload.event as ProductEvent)) return null;
  const properties: Record<string, unknown> = {};
  for (const key of ["distinct_id", "$anon_distinct_id", "$process_person_profile"]) {
    const value = payload.properties[key];
    if ((typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value)) || (key === "$process_person_profile" && typeof value === "boolean")) properties[key] = value;
  }
  const platform = payload.properties.app_platform;
  if (["web", "ios", "android"].includes(platform)) properties.app_platform = platform;
  properties.analytics_schema_version = 1;
  properties.environment = "beta";
  // Required ingestion routing, taken from validated configuration, never from
  // user/event properties. This is the PUBLIC write-only project token.
  if (projectToken) properties.token = projectToken;
  // $set/$set_once live at the top level too (not only in properties).
  return { uuid: payload.uuid, event: payload.event, timestamp: payload.timestamp, properties };
}

/** No browser reads or SDK import in the constructor (safe during SSR). */
export function createProductAnalytics(deps: AnalyticsDependencies) {
  let owner: string | null = null;
  let onboarding = false;
  let mounted = false;
  let consent: Consent | null = null;
  let preferenceLoaded = false;
  let noticePending = false;
  let status: AnalyticsStatus = deps.config ? "off" : "unavailable";
  let generation = 0;
  let sdk: AnalyticsSdk | null = null;
  let loading = false;
  let analyticsId: string | null = null;
  let choiceRevision = 0;
  let mountRevision = 0;
  let storageQueue: Promise<void> = Promise.resolve();
  let problem: string | null = null;
  const seen = new Set<string>();
  const pending: Array<() => void> = [];
  const listeners = new Set<() => void>();
  function publish() { listeners.forEach(listener => listener()); }
  function stop() {
    generation++;
    pending.length = 0;
    loading = false;
    try { sdk?.opt_out_capturing(); } catch { /* analytics must never affect the app */ }
    sdk = null;
    analyticsId = null;
  }
  function allowed() { return mounted && preferenceLoaded && consent !== null && !!deps.config && (owner !== null || onboarding); }
  function getEntryState(): AnalyticsEntryState {
    if (!deps.config?.chBetaOptOut || (!owner && !onboarding)) return "ready";
    if (!preferenceLoaded) return "loading";
    return noticePending ? "notice" : "ready";
  }
  async function readConsent(): Promise<{ consent: Consent | null; missing: boolean }> {
    try {
      await storageQueue;
      const result = await deps.storage().get(ANALYTICS_CONSENT_KEY);
      if (result.status !== "value") throw new Error("analytics_choice_unavailable");
      if (result.value === null) return { consent: null, missing: true };
      const raw: unknown = JSON.parse(result.value);
      // The old null tombstone is a refusal/revocation, never a missing choice.
      if (raw === null) return { consent: null, missing: false };
      if (typeof raw !== "object") throw new Error("analytics_choice_invalid");
      const c = raw as Partial<Consent>;
      const valid = (c.version === 1 || (c.version === 2 && (c.basis === "explicit_opt_in" || c.basis === "ch_notice")))
        && c.enabled === true && typeof c.anonymousId === "string" && /^[A-Za-z0-9_-]{16,100}$/.test(c.anonymousId)
        && (c.profileId === null || typeof c.profileId === "string");
      if (!valid) throw new Error("analytics_choice_invalid");
      // A Swiss notice acknowledgement must never become EU/other opt-in.
      return { consent: c.basis === "ch_notice" && !deps.config?.chBetaOptOut ? null : c as Consent, missing: false };
    } catch {
      return { consent: null, missing: false };
    }
  }
  function writeConsent(value: Consent | null) {
    const write = storageQueue.then(async () => {
      const result = await deps.storage().set(ANALYTICS_CONSENT_KEY, JSON.stringify(value));
      if (!result.ok) throw new Error("analytics_choice_unavailable");
    });
    storageQueue = write.catch(() => {});
    return write;
  }
  function revoke() {
    choiceRevision++;
    consent = null;
    preferenceLoaded = true;
    noticePending = false;
    stop();
    seen.clear();
    problem = null;
    const revision = choiceRevision;
    if (deps.config) void writeConsent(null).catch(() => {
      if (choiceRevision !== revision) return;
      problem = "Analytics stopped for this session, but your saved choice could not be updated. Check the choice again after reopening the app.";
      status = "unavailable"; publish();
    });
    status = deps.config ? "off" : "unavailable";
    publish();
  }
  function start() {
    if (!allowed() || sdk || loading) return;
    const epoch = generation, initialOwner = owner, initialConsent = consent!;
    loading = true;
    void (async () => {
      const id = initialOwner ? await deps.pseudonym(initialOwner) : initialConsent.anonymousId;
      const sdkModule = await deps.loadSdk();
      if (!allowed() || epoch !== generation || owner !== initialOwner) return;
      const instance = sdkModule.create(deps.config!.token, {
        api_host: deps.config!.host,
        persistence: "memory", disable_persistence: true,
        opt_out_capturing_by_default: true,
        bootstrap: { distinctID: initialConsent.anonymousId, isIdentifiedID: false },
        autocapture: false, capture_pageview: false, capture_pageleave: false,
        rageclick: false, capture_dead_clicks: false,
        disable_session_recording: true, disable_surveys: true, enable_heatmaps: false,
        capture_exceptions: false, capture_performance: false,
        enable_recording_console_log: false,
        advanced_disable_flags: true, advanced_disable_feature_flags: true,
        disable_external_dependency_loading: true,
        save_referrer: false, save_campaign_params: false,
        person_profiles: "identified_only", request_batching: false,
        disable_compression: true,
        before_send: payload => filterAnalyticsPayload(payload, allowed() && epoch === generation, deps.config!.token),
      });
      if (!allowed() || epoch !== generation) { instance.opt_out_capturing(); return; }
      sdk = instance;
      analyticsId = id;
      if (initialOwner) instance.identify(id);
      loading = false;
      status = "on";
      publish();
      pending.splice(0).forEach(send => send());
    })().catch(() => {
      if (epoch !== generation) return;
      stop();
      status = "unavailable";
      publish();
    });
  }
  function prepare(event: ProductEvent, expectedOwner: string | null, dedupe?: string): () => void {
    // Capture consent AND ownership at occurrence, never backfill before consent.
    const epoch = generation;
    if (!allowed() || owner !== expectedOwner) return () => {};
    let submitted = false;
    return () => {
      if (submitted || !allowed() || generation !== epoch || owner !== expectedOwner) return;
      submitted = true;
      const key = dedupe ? `${event}:${dedupe}` : null;
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      if (seen.size > 2048) seen.delete(seen.values().next().value!);
      const send = () => {
        try {
          if (!allowed() || generation !== epoch || owner !== expectedOwner || !deps.online()) return;
          sdk?.capture(event, { app_platform: deps.platform() });
        } catch { /* no effect on training */ }
      };
      if (sdk) send();
      else if (pending.length < 32) { pending.push(send); start(); }
    };
  }
  function syncIdentity(profileId: string | null, isOnboarding: boolean) {
    if (!mounted) return;
    const previousOwner = owner;
    if ((previousOwner && previousOwner !== profileId) || (consent?.profileId && ((profileId && consent.profileId !== profileId) || isOnboarding))) revoke();
    if (owner !== profileId || onboarding !== isOnboarding) stop();
    owner = profileId;
    onboarding = isOnboarding;
    if (consent && profileId && consent.profileId === null) {
      consent = { ...consent, profileId };
      const currentConsent = consent;
      void writeConsent(currentConsent).catch(() => { if (consent === currentConsent) revoke(); });
    }
    publish(); start();
  }
  async function choose(enabled: boolean, afterNotice = false) {
    if (!enabled) { revoke(); return; }
    if (!deps.config || (!owner && !onboarding)) return;
    if (afterNotice && getEntryState() !== "notice") return;
    choiceRevision++;
    stop();
    const epoch = generation, initialOwner = owner;
    try {
      const c: Consent = { version: 2, enabled: true, anonymousId: deps.newId(), profileId: owner,
        basis: afterNotice ? "ch_notice" : "explicit_opt_in" };
      await writeConsent(c);
      if (!mounted || epoch !== generation || owner !== initialOwner) return;
      consent = c;
      preferenceLoaded = true;
      noticePending = false;
      problem = null;
      status = "on";
      start(); publish();
      if (onboarding) prepare("onboarding_started", null, "onboarding")();
    } catch { revoke(); status = "unavailable"; publish(); }
  }
  return {
    configured: deps.config !== null,
    chBetaOptOut: deps.config?.chBetaOptOut === true,
    getEntryState,
    getStatus: () => status,
    getEnabled: () => consent !== null,
    getId: () => analyticsId,
    getProblem: () => problem,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    attach() {
      mounted = true; const revision = ++mountRevision, choice = choiceRevision;
      preferenceLoaded = false;
      if (!deps.config) return;
      void readConsent().then(saved => {
        if (!mounted || revision !== mountRevision || choice !== choiceRevision) return;
        consent = saved.consent;
        preferenceLoaded = true;
        noticePending = saved.missing && deps.config?.chBetaOptOut === true;
        if (consent?.profileId && ((owner && consent.profileId !== owner) || onboarding)) { revoke(); return; }
        status = consent ? "on" : "off";
        publish(); start();
      });
    },
    detach() { mounted = false; mountRevision++; stop(); },
    syncIdentity,
    revoke,
    choose,
    continueAfterNotice() { return choose(true, true); },
    prepare,
    capture(event: ProductEvent, expectedOwner: string | null, dedupe?: string) { prepare(event, expectedOwner, dedupe)(); },
  };
}
export type ProductAnalytics = ReturnType<typeof createProductAnalytics>;

export async function analyticsProfileId(profileId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`evolane-posthog-v1:${profileId}`));
  return `profile_${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}
