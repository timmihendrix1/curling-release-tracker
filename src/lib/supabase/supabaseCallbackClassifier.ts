// Pure, SDK-free classification and cleanup of an OAuth return URL
// (ADR-0025 Decision 12 and §D). This module classifies **shape only** and
// knows nothing of identity barriers, interactive attempts, resolutions, or
// correlation: comparing a callback's selector against a persisted attempt,
// and deciding whether an exchange may happen at all, belongs entirely to the
// future IdentityTransitionCoordinator.
//
// Nothing here touches the DOM, storage, or the network — every function is a
// pure string → value mapping, which is what makes the exhaustive
// mutually-exclusive branch table directly testable.
//
// Why application code owns this at all: the browser client is constructed
// with `detectSessionInUrl: false` (supabaseClient.ts), a deliberate cost
// accepted so that consuming a callback is an explicit, correlated operation
// rather than something indistinguishable from an ordinary session restore.

/**
 * The five query fields this application owns on a return URL. `state` is
 * **not** owned and must never be removed: the Supabase SDK neither emits nor
 * reads it, so deleting it would destroy an unrelated application parameter.
 */
export const OWNED_CALLBACK_QUERY_FIELDS = [
  "code",
  "sb_flow_id",
  "error",
  "error_description",
  "error_code",
] as const;

/**
 * The ten implicit-grant fragment fields this application owns. Their presence
 * means an implicit-grant response arrived at a PKCE-only client: the whole
 * fragment is cleared and the return is classified `malformed_callback`, never
 * turned into an identity (ADR-0025 §D).
 */
export const OWNED_IMPLICIT_FRAGMENT_FIELDS = [
  "provider_token",
  "provider_refresh_token",
  "access_token",
  "refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
  "error",
  "error_description",
  "error_code",
] as const;

const ERROR_QUERY_FIELDS = ["error", "error_description", "error_code"] as const;

/**
 * The provider's own flow-selector shape, as validated by
 * `@supabase/auth-js`'s internal `validatePKCEFlowId` (v2.112.3:
 * `/^[a-zA-Z0-9_-]{8,64}$/`). The SDK does not export it, so it is restated
 * here rather than guessed. If the provider ever widened the shape, this
 * stricter copy would reject a genuine selector — a fail-closed direction, and
 * the reason supabaseFlowCompatibility.test.ts asserts a selector the real SDK
 * actually produces still satisfies it.
 */
const FLOW_SELECTOR_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;

/** Whitespace and C0/C1 control characters, including DEL. Percent-encoded
 * forms are already decoded by `URLSearchParams`, so this catches
 * `%0a`-smuggled newlines too. */
const WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/;

/** Shared with the Supabase integration boundary and the authorized-request
 * helper so "no whitespace, no control characters" means exactly one thing
 * across every value this codebase validates before putting it in a URL. */
export function hasWhitespaceOrControl(value: string): boolean {
  return WHITESPACE_OR_CONTROL.test(value);
}

/**
 * The authorization code's *shape* is deliberately not asserted. GoTrue's
 * `code` format is the provider's business, and inventing a pattern here
 * would fail closed on a legitimate sign-in the moment the provider changed
 * it. Only genuinely disqualifying properties are rejected: empty, absurdly
 * long, or carrying whitespace/control characters.
 */
const MAX_AUTHORIZATION_CODE_LENGTH = 2048;

export type CallbackShape =
  /** No owned query field and no owned fragment field. */
  | { shape: "no_return" }
  /** Exactly one valid `code` and exactly one valid `sb_flow_id`, no error field. */
  | { shape: "success_candidate"; flowId: string; authorizationCode: string }
  /** No `code`, exactly one valid `sb_flow_id`, at least one error field.
   * Carries only the validated selector — the raw provider error values are
   * discarded here and never travel further. */
  | { shape: "provider_error_candidate"; flowId: string }
  /** A `code` together with any error field, or duplicates of any owned field. */
  | { shape: "ambiguous_callback" }
  /** Owned material present but matching none of the above — including an
   * owned implicit-grant fragment, and including an unparseable URL. */
  | { shape: "malformed_callback" };

export function isValidFlowSelector(value: unknown): value is string {
  return typeof value === "string" && FLOW_SELECTOR_PATTERN.test(value);
}

function isValidAuthorizationCode(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_AUTHORIZATION_CODE_LENGTH &&
    !WHITESPACE_OR_CONTROL.test(value)
  );
}

function parseUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl);
  } catch {
    // An unparseable URL cannot be inspected for owned material and cannot be
    // safely rebuilt — the caller gets `malformed_callback` and an unchanged
    // URL rather than a thrown error.
    return null;
  }
}

/** The fragment read as parameters. */
function fragmentParams(hash: string): URLSearchParams {
  // `hash` still carries its leading "#". An anchor such as "#warmup" parses
  // to a single valueless key, which is exactly the conservative reading
  // wanted here: presence of an owned key is what matters, not its value.
  return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

function hasOwnedImplicitFragment(hash: string): boolean {
  if (hash === "" || hash === "#") return false;
  const params = fragmentParams(hash);
  return OWNED_IMPLICIT_FRAGMENT_FIELDS.some((field) => params.has(field));
}

function hasOwnedQueryField(url: URL): boolean {
  return OWNED_CALLBACK_QUERY_FIELDS.some((field) => url.searchParams.has(field));
}

/**
 * Classifies a return URL into exactly one mutually exclusive shape. The
 * branch order encodes ADR-0025 §D's precedence: an owned implicit fragment
 * dominates everything, then duplicates, then `code`-with-error, then the two
 * well-formed candidates, and finally malformed.
 */
export function classifyCallbackUrl(rawUrl: string): CallbackShape {
  const url = parseUrl(rawUrl);
  if (!url) return { shape: "malformed_callback" };

  // An implicit-grant response must never be consumed by a PKCE-only client,
  // whatever else the URL carries.
  if (hasOwnedImplicitFragment(url.hash)) return { shape: "malformed_callback" };

  if (!hasOwnedQueryField(url)) return { shape: "no_return" };

  // A duplicate of ANY owned field is ambiguous, whether or not the duplicated
  // value would itself have been valid — two answers to one question is not
  // something to pick a winner from.
  for (const field of OWNED_CALLBACK_QUERY_FIELDS) {
    if (url.searchParams.getAll(field).length > 1) return { shape: "ambiguous_callback" };
  }

  const code = url.searchParams.get("code");
  const selector = url.searchParams.get("sb_flow_id");
  const hasErrorField = ERROR_QUERY_FIELDS.some((field) => url.searchParams.has(field));

  // A provider-error callback carries no `code`; a success callback carries no
  // error field. Both present at once is a contradiction, not a success.
  if (code !== null && hasErrorField) return { shape: "ambiguous_callback" };

  if (code !== null) {
    if (!isValidAuthorizationCode(code)) return { shape: "malformed_callback" };
    if (!isValidFlowSelector(selector)) return { shape: "malformed_callback" };
    return { shape: "success_candidate", flowId: selector, authorizationCode: code };
  }

  if (hasErrorField) {
    if (!isValidFlowSelector(selector)) return { shape: "malformed_callback" };
    return { shape: "provider_error_candidate", flowId: selector };
  }

  // Owned material that is neither candidate: a selector on its own, or an
  // owned field present but empty.
  return { shape: "malformed_callback" };
}

/**
 * Removes **all occurrences of all five owned query fields**, and clears the
 * **entire** fragment when any owned implicit-grant field is present.
 * Everything else survives: `state`, `inviteToken`, `adminRequestId`, any
 * other query parameter, and an ordinary anchor fragment.
 *
 * Returns the URL unchanged (identical string) when there is nothing owned to
 * remove, so an ordinary page load is never rewritten and unrelated
 * parameters are not re-serialized. When owned query material *is* removed,
 * the surviving query is re-serialized by `URLSearchParams` — semantically
 * identical, though a literal `%20` may come back as `+`.
 */
export function cleanCallbackUrl(rawUrl: string): string {
  const url = parseUrl(rawUrl);
  if (!url) return rawUrl;

  const removesQueryMaterial = hasOwnedQueryField(url);
  const clearsFragment = hasOwnedImplicitFragment(url.hash);
  if (!removesQueryMaterial && !clearsFragment) return rawUrl;

  if (removesQueryMaterial) {
    // `URLSearchParams.delete(name)` removes every entry with that name, which
    // is what "all occurrences" requires — and it is a targeted removal, not a
    // blanket `url.search = ""`.
    for (const field of OWNED_CALLBACK_QUERY_FIELDS) url.searchParams.delete(field);
  }
  if (clearsFragment) url.hash = "";

  return url.toString();
}
