/**
 * The complete allow-list of environment variables the mobile build inlines
 * into the browser bundle.
 *
 * This is an allow-list, not a passthrough. `process.env` is never serialised
 * into the bundle and no browser-wide `process` shim is installed. These are the
 * only names read by SHARED client code (docs/MOBILE_APP_MIGRATION.md §2.1):
 *
 *   NEXT_PUBLIC_SUPABASE_URL              src/lib/supabase/config.ts
 *   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  src/lib/supabase/config.ts
 *   NEXT_PUBLIC_NATIVE_API_ORIGIN         src/lib/platform/nativeApiOrigin.ts
 *
 * `NEXT_PUBLIC_NATIVE_API_ORIGIN` is the one API origin a NATIVE build is
 * allowed to address (ADR-0047). It is inert on Web, where the document origin
 * is used exactly as before. A missing or malformed value fails closed: Team
 * requests and the restricted-asset resolver deny before any token is read.
 *
 * COUNT, for anyone reconciling this against older text: the build inlines
 * these THREE public configuration values, plus `NODE_ENV`. Stage M1 shipped
 * two public values plus `NODE_ENV`, so any surviving "three inlined literals"
 * wording describes that historical M1 state. This list is the current
 * authority for the public ones.
 *
 * `NODE_ENV` is deliberately NOT in this list. It is a runtime semantic, not
 * configuration: every `vite build` pins it to "production" regardless of
 * `--mode` and regardless of the ambient environment, because every artifact the
 * build produces is installable. See the note in mobile/vite.config.ts.
 *
 * Adding a name here makes it browser-visible. Server-only configuration
 * (APP_ORIGIN, SMTP credentials, CLOSED_BETA_EXERCISE_ASSET_TEAM_ID, any
 * Supabase secret key) must never appear in this list. It lives in its own
 * module so the build and the M1 checks read one definition.
 */
export const MOBILE_INLINED_PUBLIC_ENV_NAMES = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_NATIVE_API_ORIGIN",
] as const;
