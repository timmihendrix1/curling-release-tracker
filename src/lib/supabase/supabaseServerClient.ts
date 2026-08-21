// The one additional production file (beyond supabaseClient.ts and
// supabaseAuthService.ts) permitted to import @supabase/supabase-js directly — see
// the "supabase client boundary" test in
// src/lib/persistence/__tests__/architectureBoundary.test.ts, updated alongside this
// file (requirement 156).
//
// SERVER-ONLY. Used exclusively by the Next.js Route Handlers under
// src/app/api/team/ for the small set of Team Foundation mutations that must also
// send an email (requirements 131, 139-147) — every other mutation goes straight
// from the browser to a Postgres RPC via supabaseTeamService.ts, which never needs
// this file.
//
// This constructs a FRESH client per request, scoped to the calling user's own
// forwarded access token (never the service-role key) — `auth.uid()` inside every
// RPC therefore resolves to exactly the same identity it would if the browser had
// called the RPC directly. No secret beyond the ordinary public publishable key is
// ever used here; the security boundary is still entirely RLS/SECURITY DEFINER on
// the database side, not this file.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ConfiguredCloudConfig } from "./config";

export function createUserScopedServerClient(
  config: ConfiguredCloudConfig,
  accessToken: string
): SupabaseClient {
  return createClient(config.url, config.publishableKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Extracts the bearer token from an incoming Route Handler request's
 * `Authorization` header, or `null` if absent/malformed. Never throws. */
export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}
