// Constructs the one production TeamService, reusing the exact same cached, per-config
// Supabase client `useSupabaseAuthController`/`createSupabaseAuthService` already use
// (docs/adr/0022 Decision 1/requirement 115: exactly one client instance per signed-in
// session) — never a second, independently-constructed client.
import { getSupabaseBrowserClient } from "./supabaseClient";
import type { ConfiguredCloudConfig } from "./config";
import { SupabaseTeamService } from "./supabaseTeamService";
import type { TeamService } from "../team/teamService";
import { withNeverThrows } from "../team/withNeverThrows";

/** `withNeverThrows` centralizes the "never rejects" contract (docs/adr/0022
 * §TeamService Never-Throws Contract) — every UI call site can rely on it without
 * its own try/catch. */
export function createSupabaseTeamService(config: ConfiguredCloudConfig): TeamService {
  return withNeverThrows(new SupabaseTeamService(getSupabaseBrowserClient(config)));
}
