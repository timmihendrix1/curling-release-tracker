// Typed resolution of the two public (browser-exposed) Supabase environment
// variables into one of three deterministic outcomes. See
// docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md §5.4 for why the
// login method is email OTP, and ADR-0019's own audit for why `NEXT_PUBLIC_*`
// is this project's client-exposure convention (Next.js inlines any
// `NEXT_PUBLIC_*` variable into the client bundle automatically). Reading
// `process.env.NEXT_PUBLIC_*` as a literal expression (not a dynamic key or
// destructure) is required for that inlining to happen at build time.
//
// No Supabase client is ever constructed here - only supabaseClient.ts does
// that, and only once this resolves to "configured". This module never
// throws.

export type InvalidConfigurationReason =
  | "missing_url"
  | "missing_publishable_key"
  | "malformed_url"
  | "invalid_publishable_key";

export type CloudConfig =
  | { status: "cloud_disabled" }
  | { status: "invalid_configuration"; reason: InvalidConfigurationReason }
  | { status: "configured"; url: string; publishableKey: string };

export type ConfiguredCloudConfig = Extract<CloudConfig, { status: "configured" }>;

function normalize(value: string | undefined): string {
  return (value ?? "").trim();
}

function isValidSupabaseUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.length > 0;
}

// Current Supabase browser-safe key model only (see
// https://supabase.com/docs/guides/getting-started/api-keys) - a publishable
// key always starts with this prefix. Deliberately NOT accepted here:
// `sb_secret_...` (a server-only credential that must never reach the
// browser) and legacy anon/service-role JWTs (`eyJ...` - supporting both
// shapes would require inspecting JWT claims to tell anon apart from
// service-role, which is exactly the ambiguity this alpha avoids by only
// speaking the current publishable-key contract; a current Supabase project
// can issue one). Rejecting anything that doesn't match this prefix is what
// makes a mistakenly-pasted secret key fail closed instead of silently
// working.
const PUBLISHABLE_KEY_PREFIX = "sb_publishable_";
const MIN_PUBLISHABLE_KEY_SUFFIX_LENGTH = 10;

function isValidPublishableKey(value: string): boolean {
  if (value.length === 0 || /\s/.test(value)) return false;
  if (!value.startsWith(PUBLISHABLE_KEY_PREFIX)) return false;
  return value.length - PUBLISHABLE_KEY_PREFIX.length >= MIN_PUBLISHABLE_KEY_SUFFIX_LENGTH;
}

/**
 * Resolves the runtime cloud configuration. Accepts explicit overrides so
 * tests never need real environment variables; production call sites omit
 * both arguments and get the literal `NEXT_PUBLIC_*` values.
 */
export function resolveCloudConfig(
  rawUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
  rawPublishableKey: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
): CloudConfig {
  const url = normalize(rawUrl);
  const publishableKey = normalize(rawPublishableKey);

  if (url === "" && publishableKey === "") {
    return { status: "cloud_disabled" };
  }
  if (url === "") {
    return { status: "invalid_configuration", reason: "missing_url" };
  }
  if (publishableKey === "") {
    return { status: "invalid_configuration", reason: "missing_publishable_key" };
  }
  if (!isValidSupabaseUrl(url)) {
    return { status: "invalid_configuration", reason: "malformed_url" };
  }
  if (!isValidPublishableKey(publishableKey)) {
    return { status: "invalid_configuration", reason: "invalid_publishable_key" };
  }
  return { status: "configured", url, publishableKey };
}
