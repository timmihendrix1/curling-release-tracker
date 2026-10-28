"use client";
import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from "react";
import { createProductAnalytics, resolveAnalyticsConfig, analyticsProfileId, ANALYTICS_PRIVACY_PATH, type ProductAnalytics } from "../lib/productAnalytics";
import { detectRuntimePlatform } from "../lib/platform/runtimePlatform";
import ExternalDocumentLink from "./platform/ExternalDocumentLink";
import { localStorageAdapter } from "../lib/persistence/localStorageAdapter";
let sdkIncarnation = 0;

export function createBrowserProductAnalytics(): ProductAnalytics {
  return createProductAnalytics({
    config: resolveAnalyticsConfig(process.env.NEXT_PUBLIC_POSTHOG_ENABLED, process.env.NEXT_PUBLIC_POSTHOG_TOKEN, process.env.NEXT_PUBLIC_POSTHOG_HOST, process.env.NEXT_PUBLIC_POSTHOG_CH_BETA),
    storage: () => localStorageAdapter,
    newId: () => crypto.randomUUID(),
    pseudonym: analyticsProfileId,
    platform: detectRuntimePlatform,
    online: () => navigator.onLine,
    async loadSdk() {
      // Core only: no replay/autocapture/surveys extensions or remote scripts.
      const { default: posthog } = await import("posthog-js/dist/module.slim.no-external");
      return { create(token, config) {
        // Use the supported module initializer so its DOM-ready transport
        // lifecycle runs. A bare `new PostHog()` can leave requests deferred.
        const instance = posthog.init(token, config, `evolane_beta_${++sdkIncarnation}`);
        if (!instance) throw new Error("analytics_initialization_unavailable");
        // The application's persisted choice is authoritative. A retired SDK
        // instance may have left its own denial marker for the same project.
        instance.opt_in_capturing({ captureEventName: false });
        return {
          capture: (event, properties) => instance.capture(event, properties),
          identify: id => instance.identify(id),
          opt_out_capturing() {
            instance.opt_out_capturing();
            void instance.shutdown().catch(() => {});
          },
        };
      } };
    },
  });
}
const Context = createContext<ProductAnalytics | null>(null);
export function ProductAnalyticsScope({ analytics, children }: { analytics: ProductAnalytics; children: ReactNode }) {
  return <Context.Provider value={analytics}>{children}</Context.Provider>;
}
export function useProductAnalytics() { return useContext(Context); }

const noopSubscribe = () => () => {};
/** An entry step, separate from required account/Terms forms. No automatic choice. */
export function ProductAnalyticsEntry({ children }: { children: ReactNode }) {
  const analytics = useProductAnalytics();
  const entry = useSyncExternalStore(analytics?.subscribe ?? noopSubscribe, analytics?.getEntryState ?? (() => "ready"), () => "ready");
  const [pending, setPending] = useState(false);
  if (!analytics || entry === "ready") return children;
  if (entry === "loading") return <main className="min-h-screen bg-slate-100 p-6"><p role="status">Loading your privacy choice…</p></main>;
  async function proceed(enabled: boolean) {
    if (!analytics || pending) return;
    setPending(true);
    try {
      if (enabled) await analytics.continueAfterNotice();
      else await analytics.choose(false);
    } finally { setPending(false); }
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-6">
      <section aria-labelledby="analytics-entry-title" className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">Evolane Curling · Swiss beta</p>
        <h1 id="analytics-entry-title" className="text-2xl font-semibold">Help improve Evolane Curling</h1>
        <p>Help us improve this closed beta for testers in Switzerland.</p>
        <p>After Continue, PostHog EU receives training starts, completions and feature use, linked to a pseudonymous identifier.</p>
        <p>No measurements, notes, names, email addresses or session recordings.</p>
        <p>Continue without usage analytics to keep it off. The app works the same. Turn it off anytime in Settings → Data and privacy.</p>
        <ExternalDocumentLink href={ANALYTICS_PRIVACY_PATH} className="inline-block min-h-11 py-2 underline">How usage analytics works</ExternalDocumentLink>
        <div className="grid gap-3">
          <button type="button" disabled={pending} onClick={() => { void proceed(true); }} className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-900 disabled:opacity-50">Continue</button>
          <button type="button" disabled={pending} onClick={() => { void proceed(false); }} className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-900 disabled:opacity-50">Continue without usage analytics</button>
        </div>
      </section>
    </main>
  );
}

export function ProductAnalyticsChoice({ showIdentifier = true }: { showIdentifier?: boolean }) {
  const analytics = useProductAnalytics();
  const status = useSyncExternalStore(analytics?.subscribe ?? noopSubscribe, analytics?.getStatus ?? (() => "unavailable"), () => "unavailable");
  const enabled = useSyncExternalStore(analytics?.subscribe ?? noopSubscribe, analytics?.getEnabled ?? (() => false), () => false);
  const id = useSyncExternalStore(analytics?.subscribe ?? noopSubscribe, analytics?.getId ?? (() => null), () => null);
  const problem = useSyncExternalStore(analytics?.subscribe ?? noopSubscribe, analytics?.getProblem ?? (() => null), () => null);
  if (!analytics || !analytics.configured) return null;
  return (
    <section aria-label="Optional usage analytics" className="space-y-3 rounded-xl border border-slate-200 p-3 text-sm text-slate-700">
      <label className="flex min-h-11 items-start gap-3">
        <input type="checkbox" checked={enabled} onChange={event => { void analytics.choose(event.target.checked); }} className="mt-1 h-5 w-5" />
        <span><strong>Help improve Evolane Curling (optional)</strong><br />
          {analytics.chBetaOptOut ? "Usage analytics sends" : "I agree to send"} limited usage events to PostHog EU, such as starting or completing training and opening features, linked to a pseudonymous analytics identifier.
          No training measurements, notes, names or email addresses are sent. No session recordings.
          Refusing does not affect training. Turn off anytime in Settings → Data and privacy.
        </span>
      </label>
      <p>Your choice is saved on this installation. It is separate from accepting the Terms or acknowledging the Privacy Notice.</p>
      {analytics.chBetaOptOut && <p>For this Swiss beta, analytics starts only after the initial notice step. A previous refusal stays off.</p>}
      <p>Signing out or changing accounts clears this choice.</p>
      {showIdentifier && id && <details><summary>Analytics access and deletion</summary><p className="break-all">For analytics access or deletion requests, include this analytics identifier: <code>{id}</code>. Contact <a className="underline" href="mailto:notifications@evolane.me">notifications@evolane.me</a>. Withdrawal stops collection; it does not delete earlier events.</p></details>}
      {problem && <p role="alert">{problem}</p>}
      {status === "unavailable" && <p role="status">Usage analytics is unavailable. Your training is unaffected.</p>}
      <ExternalDocumentLink href={ANALYTICS_PRIVACY_PATH} className="underline">How optional analytics works</ExternalDocumentLink>
    </section>
  );
}
