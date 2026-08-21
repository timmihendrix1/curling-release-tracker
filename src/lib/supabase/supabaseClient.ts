// The ONE of two production files permitted to import @supabase/supabase-js
// (the other is supabaseAuthService.ts) - enforced by the "supabase client
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
  cachedClient = createClient(config.url, config.publishableKey);
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
