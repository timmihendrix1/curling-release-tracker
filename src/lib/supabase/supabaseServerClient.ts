// The one additional production file (beyond supabaseClient.ts and
// supabaseAuthService.ts) permitted to import @supabase/supabase-js directly — see
// the "supabase client boundary" test in
// src/lib/persistence/__tests__/architectureBoundary.test.ts, updated alongside this
// file (requirement 156).
//
// SERVER-ONLY. Used through src/app/api/_lib/userScopedSupabaseContext.ts by the
// small set of Next.js Route Handlers that must act as the calling user: Team
// Foundation mutations that also send email, and authenticated delivery of
// closed-beta Exercise diagrams. Every ordinary Team mutation still goes straight
// from the browser to a Postgres RPC via supabaseTeamService.ts.
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
