// Shared authentication boundary for server Route Handlers that must query
// Supabase as the calling user. It deliberately returns domain-neutral reasons
// rather than framework responses so each route family can preserve its own
// public error contract without duplicating token/config/client construction.
import { resolveCloudConfig } from "../../../lib/supabase/config";
import {
  createUserScopedServerClient,
  extractBearerToken,
} from "../../../lib/supabase/supabaseServerClient";
import type { SupabaseClient } from "../../../lib/supabase/supabaseClient";

export type UserScopedSupabaseContextResult =
  | { ok: true; client: SupabaseClient }
  | { ok: false; reason: "unauthenticated" | "not_configured" };

/**
 * Resolves one fresh Supabase client bound to the request's bearer token. The
 * client never carries a service-role credential, so every subsequent query is
 * still authorized by the caller's `auth.uid()` and database RLS policies.
 */
export function resolveUserScopedSupabaseContext(
  request: Request
): UserScopedSupabaseContextResult {
  const token = extractBearerToken(request);
  if (!token) return { ok: false, reason: "unauthenticated" };

  const config = resolveCloudConfig();
  if (config.status !== "configured") {
    return { ok: false, reason: "not_configured" };
  }

  return {
    ok: true,
    client: createUserScopedServerClient(config, token),
  };
}
