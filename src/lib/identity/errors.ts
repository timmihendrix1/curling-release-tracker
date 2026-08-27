// The closed failure and load vocabulary for the identity domain (Stage B0.2c;
// docs/adr/0025-application-identity-gate-onboarding-completion-and-trusted-device-state.md).
//
// Two separate concerns live here because both are *shared closed outcome
// shapes* rather than logic:
//
//   1. `IdentityResult` / `IdentityError` — the service-boundary result the
//      identity RPC boundary resolves, mirroring `TeamResult` in
//      src/lib/team/errors.ts and `AuthServiceResult` in
//      src/lib/supabase/authService.ts: a method resolves, never rejects, and
//      never carries a raw Postgres/provider string.
//   2. `IdentityRecordLoad` — the three-plus-one-way outcome every identity
//      *record* repository resolves.
//
// Why identity records need their own load shape instead of reusing
// `DomainLoadResult` (src/lib/persistence/types.ts): that type folds "the key
// held something unusable" into either a repaired domain value or a
// caller-supplied `fallback`, because every sporting domain has a sensible
// default. An identity record has none — there is no safe default barrier and
// no safe default trusted record — and, decisively, **`malformed` and `absent`
// must stay distinguishable here because the two records draw OPPOSITE
// conclusions from them**:
//
//   - A barrier only ever DENIES. Failing closed therefore means an unreadable
//     or malformed barrier is treated as *present and unresolved*
//     (`quarantined_locked`), never as absent — ADR-0025 §4/§5.
//   - A trusted record only ever GRANTS. Failing closed therefore means a
//     malformed one is discarded and treated as absent — ADR-0025 §13 Step 1.
//
// A single `value | absent | read_failed` shape could not express that
// difference, and a `fallback` would be an invented record.
//
// Nothing in this module inspects, logs, stringifies or forwards a caught
// value. `message` fields carry only fixed, human-authored sentences.

/**
 * The closed set of identity-service failure kinds.
 *
 * The first six mirror the `'<kind>: <message>'` prefixes the Stage B0.2a RPCs
 * raise (supabase/migrations/20260825120200_identity_onboarding_functions.sql):
 * `forbidden`, `profile_required`, `invalid_input`, `legal_unavailable`,
 * `stale_legal_version`, `conflict`. The rest are client-side classifications:
 *
 * - `invalid_legal_response` — ADR-0025 §17's whole-response verdict. Carries
 *   **no** raw row, no unknown kind string, no document id and no URL.
 * - `invalid_response` — a non-legal RPC returned a shape the mapper cannot
 *   trust (a missing row, a non-object, an unusable Profile id).
 * - `network_error` — the request did not complete.
 * - `unexpected_error` — the fail-closed default for anything unrecognized,
 *   including a thrown value. Never more specific than this, so an attacker
 *   cannot obtain a sharper error by causing an unexpected failure.
 */
export type IdentityErrorKind =
  | "forbidden"
  | "profile_required"
  | "invalid_input"
  | "legal_unavailable"
  | "stale_legal_version"
  | "conflict"
  | "invalid_legal_response"
  | "invalid_response"
  | "network_error"
  | "unexpected_error";

/** A user-facing sentence only — never a raw Postgres, PostgREST or provider
 * message, and never a value read out of an untrusted response. */
export type IdentityError = {
  kind: IdentityErrorKind;
  message: string;
};

export type IdentityResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IdentityError };

export function identityOk<T>(value: T): IdentityResult<T> {
  return { ok: true, value };
}

export function identityFailed<T>(kind: IdentityErrorKind, message?: string): IdentityResult<T> {
  return { ok: false, error: { kind, message: message ?? FRIENDLY_IDENTITY_MESSAGE[kind] } };
}

/** One canonical sentence per kind, so the RPC boundary and any future caller
 * name the same wording instead of each inventing its own — the discipline
 * src/lib/supabase/authService.ts's `FRIENDLY_MESSAGE` establishes. Neutral
 * and actionable per docs/UX_WRITING_GUIDELINES.md; no raw detail. */
export const FRIENDLY_IDENTITY_MESSAGE: Record<IdentityErrorKind, string> = {
  forbidden: "Sign in to continue.",
  profile_required: "Set up your profile before continuing.",
  invalid_input: "That doesn't look right — check the value and try again.",
  legal_unavailable: "We can't load the current Terms and Privacy Notice right now.",
  stale_legal_version: "The legal documents were updated. Review and accept the current versions.",
  conflict: "That couldn't be completed. Please try again.",
  invalid_legal_response: "We can't load the current Terms and Privacy Notice right now.",
  invalid_response: "Something went wrong. Please try again.",
  network_error: "We couldn't reach the server. Check your connection and try again.",
  unexpected_error: "Something went wrong. Please try again.",
};

/**
 * What reading one identity record from storage resolved to.
 *
 * - `value` — a structurally valid record at the supported schema version.
 * - `absent` — the key genuinely holds nothing.
 * - `malformed` — the key holds something, and it is **not** a usable record:
 *   unparseable JSON, a wrong or unknown `schemaVersion`, a missing or
 *   wrong-typed field, or a value whose own property access throws. Never
 *   repaired, never partially adopted, and never collapsed into `absent` — the
 *   caller decides which direction failing closed points (see the module note).
 * - `read_failed` — storage itself could not be read. Carries the normalized
 *   `PersistenceReadError` so a caller can distinguish "unavailable" from
 *   "unknown", and nothing else.
 *
 * There is deliberately **no** `fallback` member and **no** raw stored string:
 * an identity record is never displayed from a failed read.
 */
export type IdentityRecordLoad<T> =
  | { status: "value"; value: T }
  | { status: "absent" }
  | { status: "malformed" }
  | { status: "read_failed"; error: { kind: "storage_unavailable" } | { kind: "unknown" } };

export function recordValue<T>(value: T): IdentityRecordLoad<T> {
  return { status: "value", value };
}

export function recordAbsent<T>(): IdentityRecordLoad<T> {
  return { status: "absent" };
}

export function recordMalformed<T>(): IdentityRecordLoad<T> {
  return { status: "malformed" };
}

export function recordReadFailed<T>(kind: "storage_unavailable" | "unknown"): IdentityRecordLoad<T> {
  return { status: "read_failed", error: { kind } };
}
