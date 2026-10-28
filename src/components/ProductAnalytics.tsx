"use client";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { createProductAnalytics, resolveAnalyticsConfig, analyticsProfileId, ANALYTICS_PRIVACY_PATH, type ProductAnalytics } from "../lib/productAnalytics";
import { detectRuntimePlatform } from "../lib/platform/runtimePlatform";
import ExternalDocumentLink from "./platform/ExternalDocumentLink";
import { localStorageAdapter } from "../lib/persistence/localStorageAdapter";
let sdkIncarnation = 0;

export function createBrowserProductAnalytics(): ProductAnalytics {
  return createProductAnalytics({
    config: resolveAnalyticsConfig(process.env.NEXT_PUBLIC_POSTHOG_ENABLED, process.env.NEXT_PUBLIC_POSTHOG_TOKEN, process.env.NEXT_PUBLIC_POSTHOG_HOST),
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
          I agree to send limited usage events to PostHog EU, such as starting or completing training and opening features, linked to a pseudonymous analytics identifier.
          No training measurements, notes, names or email addresses are sent. No session recordings.
          Refusing does not affect training. Withdraw anytime in Settings → Data and privacy.
        </span>
      </label>
      <p>Your choice is saved on this installation. It is separate from accepting the Terms or acknowledging the Privacy Notice.</p>
      <p>Signing out or changing accounts clears this choice.</p>
      {showIdentifier && id && <details><summary>Analytics access and deletion</summary><p className="break-all">For analytics access or deletion requests, include this analytics identifier: <code>{id}</code>. Contact <a className="underline" href="mailto:notifications@evolane.me">notifications@evolane.me</a>. Withdrawal stops collection; it does not delete earlier events.</p></details>}
      {problem && <p role="alert">{problem}</p>}
      {status === "unavailable" && <p role="status">Usage analytics is unavailable. Your training is unaffected.</p>}
      <ExternalDocumentLink href={ANALYTICS_PRIVACY_PATH} className="underline">How optional analytics works</ExternalDocumentLink>
    </section>
  );
}
