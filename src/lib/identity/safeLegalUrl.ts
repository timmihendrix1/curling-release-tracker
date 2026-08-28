// The load-bearing safe Legal-document URL boundary (ADR-0025 §17: "the mapping
// boundary is the load-bearing check, because a database constraint is not a URL
// parser").
//
// The database also constrains `legal_documents.document_url`
// (supabase/migrations/20260825120000_identity_onboarding_schema.sql). That check
// is defence in depth: it is a regular expression, it cannot normalize, and it
// governs only rows written through that column. This module is what decides
// whether a URL that reached the client may ever be rendered as an `href`, and a
// document failing it invalidates the WHOLE response (ADR-0025 §17) rather than
// becoming "absent".
//
// This parser remains content-agnostic. ADR-0041's real Privacy Notice URL is
// supplied through the same server-authoritative row as any later Legal version;
// unit-test fixtures continue to use harmless `https://example.invalid/...` values.

/**
 * A URL that has passed every check in `parseSafeLegalUrl`. The brand is
 * constructible **only** inside this module, so a plain `string` — including one
 * read straight off an untrusted RPC row — cannot reach a component prop typed
 * as `SafeHttpsUrl`.
 */
export type SafeHttpsUrl = string & { readonly __safeHttpsUrl: unique symbol };

/**
 * Literal whitespace (everything `\s` covers, including a plain space, tab and
 * newline) plus the C0 control characters, DEL and the C1 range. A raw value
 * containing any of them is rejected outright rather than trimmed or stripped:
 * silently repairing a URL would mean rendering something the response did not
 * actually contain.
 *
 * Deliberately the SAME character set as
 * `hasWhitespaceOrControl` in src/lib/supabase/supabaseCallbackClassifier.ts, so
 * "no whitespace, no control characters" means one thing for every value this
 * codebase validates before putting it in a URL. It is restated here rather than
 * imported so that `src/lib/identity` carries no dependency on OAuth callback
 * mechanics for a string predicate; the two definitions are kept identical by a
 * test that asserts both agree.
 */
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * Percent-encoded C0 control characters (`%00`-`%1f`) and `%7f`. `new URL()`
 * accepts these happily — `https://host/a%0Ab` parses — so they need their own
 * check on the RAW string, before parsing.
 *
 * Deliberately NOT rejected: `%20`. An encoded space is not a control character,
 * it is a legitimate encoding inside a path, and the database's own check
 * constraint accepts it too. Rejecting it would diverge the two layers for no
 * security gain.
 */
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)/i;

/**
 * The literal prefix an accepted value must begin with, followed by a character
 * that is NOT another slash.
 *
 * Both halves matter, and both exist to keep this parser at least as strict as the
 * database's own check constraint rather than diverging from it:
 *
 *  - **Lower-case only.** `new URL()` normalizes `HTTPS://host` to protocol
 *    `https:`, so a protocol check alone would accept a form the database rejects.
 *    A document URL is either canonical or unusable; it is not normalized here.
 *  - **No third slash.** WHATWG URL parsing tolerates extra authority slashes, so
 *    `https:///legal/terms` parses with hostname `legal` — a valid URL, but not the
 *    one anybody wrote, and one the database refuses. Rejecting it keeps the two
 *    layers in agreement. No legitimate absolute HTTPS URL is affected: the
 *    character after `https://` is always part of the host.
 */
const REQUIRED_PREFIX = "https://";

/**
 * Parses an untrusted value into a `SafeHttpsUrl`, or returns `null`.
 *
 * Accepted only when ALL of the following hold:
 *
 *  1. the value is a `string`;
 *  2. it is identical to its own trimmed form (so padding is a rejection, never
 *     something this function quietly fixes);
 *  3. it contains no literal whitespace or control character;
 *  4. it contains no percent-encoded control character;
 *  5. it begins with a lower-case `https://` followed by a non-slash character;
 *  6. `new URL(raw)` **with no base** parses it — which is what makes a
 *     base-relative (`/legal/terms`) and a protocol-relative (`//host/path`)
 *     form fail, since neither is an absolute URL on its own;
 *  7. its protocol is exactly `https:`;
 *  8. it carries no embedded credentials (`username` and `password` both empty);
 *  9. its hostname is non-empty.
 *
 * Never throws, for any input: a `URL` constructor failure is contained and the
 * thrown value is discarded without being inspected, logged or forwarded.
 *
 * `javascript:`, `data:`, `blob:`, `file:` and `http:` are rejected by rules 5 and
 * 7; a bare word and an empty string by rules 5 and 6.
 */
export function parseSafeLegalUrl(raw: unknown): SafeHttpsUrl | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0) return null;
  if (raw !== raw.trim()) return null;
  if (WHITESPACE_OR_CONTROL.test(raw)) return null;
  if (ENCODED_CONTROL.test(raw)) return null;
  if (!raw.startsWith(REQUIRED_PREFIX)) return null;
  if (raw.charAt(REQUIRED_PREFIX.length) === "/") return null;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  if (parsed.hostname.length === 0) return null;

  return raw as SafeHttpsUrl;
}
