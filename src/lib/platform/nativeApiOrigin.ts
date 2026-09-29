// Validation of the ONE explicitly configured API origin a native build talks to.
//
// Native iOS/Android load the application from a local app scheme
// (`capacitor://localhost` on iOS, `https://localhost` on Android), so the
// document origin is not the API. This module turns a build-time configuration
// string into one of three deterministic outcomes, and NEVER guesses: there is
// no fallback to the WebView origin, the Supabase origin, `APP_ORIGIN`, a deep
// link, a response URL or a caller-supplied destination.
//
// The shape requirement mirrors `resolveAppOriginConfig`'s server-side contract
// for `APP_ORIGIN` (src/app/api/team/_lib/context.ts) — a bare origin and
// nothing else — with one difference: a native build has no localhost
// development exception, so **https is the only accepted scheme**. A native app
// shipped against a cleartext origin would send a bearer token over the network
// in the clear.
//
// This module never throws and never reads a token.
import { hasWhitespaceOrControl } from "../supabase/supabaseCallbackClassifier";

export type NativeApiOriginInvalidReason =
  | "whitespace_or_control"
  | "unparseable"
  | "non_https_scheme"
  | "not_a_bare_origin";

export type NativeApiOriginResolution =
  | { status: "not_configured" }
  | { status: "invalid"; reason: NativeApiOriginInvalidReason }
  | { status: "configured"; origin: string };

/**
 * Resolves the configured native API origin.
 *
 * Reading `process.env.NEXT_PUBLIC_NATIVE_API_ORIGIN` as a literal expression
 * (not a dynamic key, not a destructure) is what lets both Next and the mobile
 * Vite build inline it at build time — the same convention
 * `src/lib/supabase/config.ts` relies on. Tests pass the value explicitly and
 * never need a real environment.
 */
export function resolveNativeApiOriginConfig(
  raw: string | undefined = process.env.NEXT_PUBLIC_NATIVE_API_ORIGIN
): NativeApiOriginResolution {
  const value = raw ?? "";

  // Absent configuration is a distinct, fail-closed outcome, not an error to
  // report. A value that is only whitespace is absent in every sense that
  // matters, so it is classified the same way.
  if (value === "" || value.trim() === "") return { status: "not_configured" };

  // Checked on the SUPPLIED value, deliberately NOT on a trimmed copy.
  //
  // Trimming first would silently accept " https://api.example.test" and
  // "https://api.example.test\n" — exactly the leading/trailing forms ADR-0047
  // and .env.example prohibit. Accepting them would also mean the reviewed
  // string and the value actually in use are different strings, which is the
  // normalization surprise this contract exists to exclude. `new URL` compounds
  // it by stripping or encoding some whitespace itself.
  //
  // A configured value is a build-time constant a person wrote down; requiring
  // it to be exact costs nothing and removes a whole class of ambiguity.
  if (hasWhitespaceOrControl(value)) {
    return { status: "invalid", reason: "whitespace_or_control" };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { status: "invalid", reason: "unparseable" };
  }

  if (parsed.protocol !== "https:") {
    return { status: "invalid", reason: "non_https_scheme" };
  }

  // One check rejects a path, a trailing slash, a query, a fragment and
  // embedded credentials at once: `URL#origin` contains none of them, so a
  // value carrying any of them cannot equal its own origin. It also rejects an
  // opaque origin, whose `origin` is the string "null".
  if (parsed.origin === "null" || parsed.origin !== value) {
    return { status: "invalid", reason: "not_a_bare_origin" };
  }

  return { status: "configured", origin: parsed.origin };
}
