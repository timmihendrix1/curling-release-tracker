// One of the three production files permitted to import @supabase/supabase-js -
// this lazy browser-client factory, the auth-service implementation built on it
// (supabaseAuthService.ts), and the server-only, per-request client the Team
// Route Handlers use (supabaseServerClient.ts). Enforced by the "supabase client
// boundary" describe block in
// src/lib/persistence/__tests__/architectureBoundary.test.ts. Construction is
// lazy and cached: nothing here runs at module-evaluation time, and this is
// never called unless config.ts has already resolved "configured" - avoiding
// eager client construction that could throw while importing modules.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ConfiguredCloudConfig } from "./config";

// Re-exported so other production modules (e.g. supabaseTeamService.ts) can name
// the client's type without importing "@supabase/supabase-js" directly themselves —
// keeping the SDK import confined to this file and supabaseAuthService.ts.
export type { SupabaseClient };

/**
 * The three auth options ADR-0025 Decision 10 makes non-negotiable for the one
 * browser client. Exported so the compatibility test can assert the exact
 * shape rather than restating it, and so a reviewer can read the contract in
 * one place.
 *
 * - `flowType: "pkce"` — the SDK defaults to `implicit`, which would return
 *   tokens in the URL fragment instead of an exchangeable code.
 * - `detectSessionInUrl: false` — the SDK defaults to `true`. Left on, it
 *   would consume a callback automatically, indistinguishably from an ordinary
 *   session restore, before any correlation could be checked. Turning it off
 *   is what moves callback detection and URL cleanup into application code
 *   (supabaseCallbackClassifier.ts / supabaseCallbackCapture.ts) — a
 *   deliberate cost accepted in exchange for making callback consumption an
 *   explicit, correlated operation.
 * - `experimental.appendPkceFlowIdToRedirects: true` — makes the provider
 *   round-trip a non-secret `sb_flow_id` selector back on the callback URL, so
 *   a return can be correlated to the attempt that produced it. Without it no
 *   selector travels through the redirect, and `exchangeCodeForSession` would
 *   have to fall back to "the most recently stored verifier" — which a stale
 *   callback could consume, destroying a newer valid attempt. This flag is
 *   therefore a hard dependency for Google sign-in, and the project's redirect
 *   allow list must tolerate the extra query parameter.
 */
export const BROWSER_AUTH_OPTIONS = {
  flowType: "pkce",
  detectSessionInUrl: false,
  experimental: { appendPkceFlowIdToRedirects: true },
} as const;

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey: string | null = null;

function configKey(config: ConfiguredCloudConfig): string {
  return JSON.stringify([config.url, config.publishableKey]);
}

/**
 * Returns the one browser Supabase client for the given configuration,
 * constructing it on first use. A later call with a different URL/key
 * replaces the cached client rather than returning a stale one - relevant
 * only to tests, since production configuration never changes at runtime.
 */
export function getSupabaseBrowserClient(config: ConfiguredCloudConfig): SupabaseClient {
  const key = configKey(config);
  if (cachedClient && cachedConfigKey === key) {
    return cachedClient;
  }
  cachedClient = createClient(config.url, config.publishableKey, { auth: BROWSER_AUTH_OPTIONS });
  cachedConfigKey = key;
  return cachedClient;
}

/**
 * Test-only escape hatch forcing the next call to construct a fresh client.
 * Production code never calls this.
 */
export function resetSupabaseBrowserClientForTests(): void {
  cachedClient = null;
  cachedConfigKey = null;
}
