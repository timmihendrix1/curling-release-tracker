// Constructs the one production TeamService, reusing the exact same cached, per-config
// Supabase client `useSupabaseAuthController`/`createSupabaseAuthService` already use
// (docs/adr/0022 Decision 1/requirement 115: exactly one client instance per signed-in
// session) — never a second, independently-constructed client.
//
// This is also the ONLY production module permitted to value-import
// authorizedFetch.ts (ADR-0025 Decision 20) — enforced by
// src/lib/persistence/__tests__/architectureBoundary.test.ts. Confining that import
// to one composition seam is what keeps the access token out of components, domain
// code, and the TeamService implementation itself: nothing else can even reach the
// helper that reads it.
import { getSupabaseBrowserClient } from "./supabaseClient";
import type { ConfiguredCloudConfig } from "./config";
import { createAuthorizedTeamRequest } from "./authorizedFetch";
import { SupabaseTeamService } from "./supabaseTeamService";
import type { TeamService } from "../team/teamService";
import { withNeverThrows } from "../team/withNeverThrows";

/** `withNeverThrows` centralizes the "never rejects" contract (docs/adr/0022
 * §TeamService Never-Throws Contract) — every UI call site can rely on it without
 * its own try/catch. It is final containment for an unforeseen defect, not the
 * ordinary authorization-failure mechanism: an unauthorized or unreachable
 * `/api/team/` request already resolves a named `forbidden`/`network_error`
 * outcome inside the authorized-request helper, without throwing. */
export function createSupabaseTeamService(config: ConfiguredCloudConfig): TeamService {
  const client = getSupabaseBrowserClient(config);
  // No test overrides: the real document origin and the real global `fetch`.
  return withNeverThrows(new SupabaseTeamService(client, createAuthorizedTeamRequest(client)));
}
