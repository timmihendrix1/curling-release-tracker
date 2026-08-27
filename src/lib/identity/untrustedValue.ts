// The audited primitives for reading untrusted, possibly hostile input (Stage
// B0.2c): hostile VALUES at the top of this file, and the hostile STORAGE-ADAPTER
// boundary at the bottom. Every identity record validator, every identity
// repository and the identity RPC mapper read through this module.
//
// WHY THIS EXISTS AS ONE MODULE. Every validator in `src/lib/identity` and
// `src/lib/supabase/supabaseIdentityService.ts` must satisfy the same rule:
// "malformed, partial, hostile, wrong-version or Proxy-backed values fail closed
// **without throwing**". A plain property read does not satisfy it — a throwing
// getter or a Proxy `get` trap turns `value.schemaVersion` into an exception on a
// boundary declared never to throw. Duplicating the containment in six
// validators would mean six chances to get a security-sensitive primitive
// subtly wrong; this is the single place it is implemented and tested.
//
// DISCIPLINE. A caught value is discarded here and never inspected, logged,
// stringified, rendered or forwarded. Nothing in this module reports *why* a read
// failed — only that the value is unusable. This is not blanket catching inside
// pure domain logic: it is confined to the untrusted-input boundary, exactly
// where the never-throw contract is declared.

import type {
  PersistenceRemoveResult,
  PersistenceWriteResult,
  RemovableStorageAdapter,
  StorageAdapter,
} from "../persistence/types";
import { isCanonicalUuid } from "../uuid";
export { isCanonicalUuid } from "../uuid";
import {
  recordAbsent,
  recordMalformed,
  recordReadFailed,
  recordValue,
  type IdentityRecordLoad,
} from "./errors";

/**
 * Whether a value can be read as a record of fields at all.
 *
 * `typeof` is used rather than an `instanceof`/`in`/`hasOwnProperty` check
 * because none of those is safe against a hostile object: `in` triggers a Proxy
 * `has` trap and `hasOwnProperty` triggers `getOwnPropertyDescriptor`. Arrays
 * are excluded — no identity record is an array, and accepting one would let
 * `["schemaVersion"]`-shaped input reach field validation.
 *
 * A live Proxy passes this check (it reports `typeof === "object"` without invoking
 * any trap), which is intended: it is `readUntrustedProperty` below that contains a
 * hostile trap, not this predicate. A REVOKED Proxy does not pass, because
 * `Array.isArray` throws on one — that throw is contained here rather than escaping
 * into a caller that has declared it never throws.
 */
export function isRecordLike(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  try {
    return !Array.isArray(value);
  } catch {
    // `Array.isArray` THROWS on a revoked Proxy. Such a value is not usable as a
    // record either — every later property read would throw too — so the honest
    // answer is that it is not record-like.
    return false;
  }
}

/**
 * Reads one property from an untrusted value, resolving to `undefined` rather
 * than throwing when the value is not record-like, when a getter throws, or when
 * a Proxy trap throws — for a thrown `Error` and for a thrown non-`Error`
 * (a string, a `Symbol`, `null`) alike.
 */
export function readUntrustedProperty(source: unknown, key: string): unknown {
  if (!isRecordLike(source)) return undefined;
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** A non-empty `string`, or `null`. Never trims: a caller that wants trimming
 * asks for it explicitly, so "the stored value" and "a repaired value" can never
 * be confused. */
export function readUntrustedString(source: unknown, key: string): string | null {
  const value = readUntrustedProperty(source, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** A `string` that may legitimately be `null` in the record, distinguished from
 * "absent or wrong-typed". `{ present: false }` means the field is unusable. */
export function readUntrustedNullableString(
  source: unknown,
  key: string
): { present: true; value: string | null } | { present: false } {
  const value = readUntrustedProperty(source, key);
  if (value === null) return { present: true, value: null };
  if (typeof value === "string" && value.length > 0) return { present: true, value };
  return { present: false };
}

/** A finite `number`, or `null`. `NaN`, `Infinity` and a numeric string are all
 * rejected — a generation counter read from storage is either a real number or
 * unusable. */
export function readUntrustedFiniteNumber(source: unknown, key: string): number | null {
  const value = readUntrustedProperty(source, key);
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A finite `number` that may legitimately be `null` in the record. */
export function readUntrustedNullableFiniteNumber(
  source: unknown,
  key: string
): { present: true; value: number | null } | { present: false } {
  const value = readUntrustedProperty(source, key);
  if (value === null) return { present: true, value: null };
  if (typeof value === "number" && Number.isFinite(value)) return { present: true, value };
  return { present: false };
}

/** One member of a closed literal set, or `null`. */
export function readUntrustedLiteral<T extends string>(
  source: unknown,
  key: string,
  allowed: readonly T[]
): T | null {
  const value = readUntrustedProperty(source, key);
  if (typeof value !== "string") return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * The largest response array this codebase will traverse. A legal-document
 * response has two rows; a composite has one. The bound exists so a hostile
 * `length` cannot turn traversal into an unbounded loop.
 */
const MAX_UNTRUSTED_ARRAY_LENGTH = 1000;

/**
 * Copies an untrusted array into a plain one, or reports it unusable. Never throws.
 *
 * Every step here is a place a hostile value can fight back, and each is contained
 * separately:
 *
 *  - `Array.isArray` THROWS on a revoked Proxy ("Cannot perform 'IsArray' on a proxy
 *    that has been revoked"), so even the type test needs containment;
 *  - reading `length` invokes a `get` trap, which may throw or return a non-number;
 *  - each index read invokes a `get` trap, which may throw part-way through.
 *
 * Traversal is by index rather than by iteration on purpose: `for...of` would
 * consult `Symbol.iterator`, which a hostile object can replace with an iterator
 * that throws, never terminates, or yields different values on each pass.
 */
export function readUntrustedArray(
  value: unknown
): { ok: true; items: unknown[] } | { ok: false } {
  let looksLikeArray: boolean;
  try {
    looksLikeArray = Array.isArray(value);
  } catch {
    return { ok: false };
  }
  if (!looksLikeArray) return { ok: false };

  let length: unknown;
  try {
    length = (value as { length: unknown }).length;
  } catch {
    return { ok: false };
  }
  if (
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > MAX_UNTRUSTED_ARRAY_LENGTH
  ) {
    return { ok: false };
  }

  const items: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    try {
      items.push((value as unknown[])[index]);
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, items };
}

/**
 * A tri-state field read that distinguishes an **explicit SQL null** from a
 * property that is missing or could not be read.
 *
 * This distinction is load-bearing at an RPC boundary. `readUntrustedProperty`
 * answers `undefined` for "absent", "unreadable" and "present and undefined"
 * alike, and treating all three as "the column is NULL" would let a truncated,
 * renamed or hostile row masquerade as a perfectly ordinary "nothing is set here"
 * response. A real PostgREST row carries every column of its composite, so an
 * absent property is a response this build does not know how to read.
 *
 * `hasOwnProperty` invokes a Proxy's `getOwnPropertyDescriptor` trap and the read
 * invokes its `get` trap; both are contained, and either throwing means the field
 * is unreadable rather than null.
 */
export type UntrustedField = { present: true; value: unknown } | { present: false };

export function readUntrustedField(source: unknown, key: string): UntrustedField {
  if (!isRecordLike(source)) return { present: false };
  let owns: boolean;
  try {
    owns = Object.prototype.hasOwnProperty.call(source, key);
  } catch {
    return { present: false };
  }
  if (!owns) return { present: false };
  try {
    return { present: true, value: (source as Record<string, unknown>)[key] };
  } catch {
    return { present: false };
  }
}

/**
 * `JSON.parse` that resolves `undefined` instead of throwing. The parsed result
 * is still untrusted — it is only known to be *some* JSON value.
 */
export function parseUntrustedJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The canonical UUID shape: lower-case, hyphenated, an RFC-4122/9562 version
 * nibble (1-8) and a variant nibble in `[89ab]`. Deliberately strict:
 *
 *  - `profiles.id` and every identity record id this application generates are
 *    UUIDs, so anything else is already corrupt;
 *  - a `barrierId` is interpolated into a storage KEY
 *    (`curling.identity.accessBarrierResolution.<barrierId>.v1`), so a tampered
 *    id containing `.`, `*`, `/` or `..` must never reach key construction.
 *
 * Upper-case hex is rejected rather than normalized, for the same reason
 * `parseSafeLegalUrl` rejects untrimmed input: the record is either canonical or
 * unusable.
 */
/** A canonical UUID read from an untrusted record, or `null`. */
export function readUntrustedUuid(source: unknown, key: string): string | null {
  const value = readUntrustedProperty(source, key);
  return isCanonicalUuid(value) ? value : null;
}

/**
 * An ISO-8601-ish timestamp string that actually parses to a real instant, or
 * `null`. `Date.parse` is the check; the ORIGINAL string is returned, never a
 * re-serialized one, so a record's own timestamp is never silently rewritten.
 */
export function readUntrustedTimestamp(source: unknown, key: string): string | null {
  const value = readUntrustedProperty(source, key);
  return isValidTimestamp(value) ? value : null;
}

export function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
}

// ---------------------------------------------------------------------------
// Bounded scalar text — the committed database contract, restated once
// ---------------------------------------------------------------------------

/**
 * `public.profiles.display_name`'s committed bound
 * (supabase/migrations/20260820120000_team_foundation_schema.sql:42-43, re-checked by
 * `complete_personal_onboarding`).
 */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * `public.legal_documents.version_label`'s committed bound
 * (supabase/migrations/20260825120000_identity_onboarding_schema.sql:70-73).
 */
export const MAX_LEGAL_VERSION_LABEL_LENGTH = 120;

/**
 * Bounded, non-blank display text.
 *
 * The stored-value constraints express this as `length(btrim(value)) > 0` and
 * `length(value) <= max`. The onboarding completion function trims the submitted
 * display name before applying the same maximum, so its INPUT acceptance is
 * intentionally wider while every persisted/RPC value still crosses this exact
 * boundary. Restating the stored-value rule here once, and using it at every
 * persistence and service boundary, prevents those consumers from drifting apart.
 *
 * Two details are deliberate. The **raw** length is bounded, matching
 * `length(value) <= max` rather than the trimmed length, so a value this validator
 * accepts is a value the database would store. And blankness is judged after
 * JavaScript's `trim()`, which removes a slightly wider set than Postgres's
 * argument-less `btrim` — so this boundary is marginally STRICTER than the
 * database, which is the fail-closed direction: it can refuse a row the database
 * would allow, never accept one the database would refuse.
 */
export function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

/** A Profile display name: non-blank after trimming, at most 80 characters. */
export function isValidDisplayName(value: unknown): value is string {
  return isBoundedText(value, MAX_DISPLAY_NAME_LENGTH);
}

/** A Legal document version label — pinned evidence and `current_*` reporting
 * metadata alike: non-blank after trimming, at most 120 characters. */
export function isValidLegalVersionLabel(value: unknown): value is string {
  return isBoundedText(value, MAX_LEGAL_VERSION_LABEL_LENGTH);
}

/**
 * The same whitespace/control-character set `parseSafeLegalUrl` and
 * `hasWhitespaceOrControl` (src/lib/supabase/supabaseCallbackClassifier.ts) use.
 * An identity record's opaque identifiers — an account scope id from the
 * provider, an invitation token from a deep link — are compared, persisted and
 * sometimes placed in a URL, so a value carrying whitespace or a control
 * character is unusable rather than repairable.
 */
const OPAQUE_WHITESPACE_OR_CONTROL = /[\s\u0000-\u001f\u007f-\u009f]/;

/**
 * An opaque, application-or-provider-issued identifier: a non-empty string with
 * no whitespace and no control characters, within an explicit maximum length.
 *
 * Deliberately NOT shape-validated beyond that. An `accountScopeId` is the
 * provider's own user identifier and an invitation token is an opaque secret;
 * inventing a pattern for either would fail closed on a legitimate value the
 * moment the issuer changed its format.
 */
export function isOpaqueIdentifier(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !OPAQUE_WHITESPACE_OR_CONTROL.test(value)
  );
}

export function readUntrustedOpaqueId(
  source: unknown,
  key: string,
  maxLength: number
): string | null {
  const value = readUntrustedProperty(source, key);
  return isOpaqueIdentifier(value, maxLength) ? value : null;
}

/** An opaque identifier that may legitimately be `null` in the record. */
export function readUntrustedNullableOpaqueId(
  source: unknown,
  key: string,
  maxLength: number
): { present: true; value: string | null } | { present: false } {
  const value = readUntrustedProperty(source, key);
  if (value === null) return { present: true, value: null };
  if (isOpaqueIdentifier(value, maxLength)) return { present: true, value };
  return { present: false };
}

/** A non-negative integer read from an untrusted record, or `null`. A generation
 * counter is never fractional and never negative. */
export function readUntrustedNonNegativeInteger(source: unknown, key: string): number | null {
  const value = readUntrustedProperty(source, key);
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return value;
}

/** A non-negative integer that may legitimately be `null` in the record. */
export function readUntrustedNullableNonNegativeInteger(
  source: unknown,
  key: string
): { present: true; value: number | null } | { present: false } {
  const value = readUntrustedProperty(source, key);
  if (value === null) return { present: true, value: null };
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return { present: true, value };
  }
  return { present: false };
}

/** The supported schema version of every identity record introduced by Stage
 * B0.2 (ADR-0025 §24: each record is new at `schemaVersion: 1`, with no prior
 * format, alias, compatibility shim or migration). Anything else — including a
 * higher version written by a newer build — is malformed, never adapted. */
export function hasSupportedSchemaVersion(source: unknown, supported: 1): boolean {
  return readUntrustedProperty(source, "schemaVersion") === supported;
}

// ---------------------------------------------------------------------------
// The untrusted STORAGE-ADAPTER boundary.
//
// A `StorageAdapter` is an injected dependency, and the identity repositories'
// never-throw contract has to hold even when that dependency misbehaves: a
// `localStorage` global that is itself a throwing getter, a future adapter
// implementation with a defect, or a deliberately hostile fake in a test. These
// three helpers are the single place where an adapter call is contained and its
// result is treated as untrusted, so all five identity repositories share exactly
// one audited implementation instead of five.
//
// A caught value is discarded without being inspected, logged or forwarded.
// ---------------------------------------------------------------------------

/**
 * Reads and validates one identity record.
 *
 * Resolves `read_failed` when storage could not be read (or when the adapter
 * itself threw or returned an unrecognizable result), `absent` when the key
 * genuinely holds nothing, `malformed` when it holds something unusable, and
 * `value` otherwise. Never rejects.
 *
 * The `validate` call is wrapped too. The validators in this directory are total
 * by construction and individually tested against hostile input, so this is not
 * expected to fire; wrapping it means that if one ever did throw, the result is a
 * fail-closed `malformed` — which every caller already handles in the safe
 * direction — rather than an unhandled rejection escaping a boundary declared
 * never to throw.
 */
export async function readIdentityRecord<T>(
  adapter: Pick<StorageAdapter, "get">,
  key: string,
  validate: (raw: unknown) => T | null
): Promise<IdentityRecordLoad<T>> {
  let result: unknown;
  try {
    result = await adapter.get(key);
  } catch {
    return recordReadFailed<T>("unknown");
  }

  const status = readUntrustedProperty(result, "status");
  if (status === "read_failed") {
    const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
    return recordReadFailed<T>(kind === "storage_unavailable" ? "storage_unavailable" : "unknown");
  }
  if (status !== "value") return recordReadFailed<T>("unknown");

  const raw = readUntrustedProperty(result, "value");
  // `localStorage.getItem` contract: `null` means the key does not exist. The
  // adapter passes that through unchanged, and this is the one place it becomes
  // an explicit `absent` rather than being handed upward as if it were a value.
  if (raw === null) return recordAbsent<T>();
  if (typeof raw !== "string") return recordReadFailed<T>("unknown");

  const parsed = parseUntrustedJson(raw);
  if (parsed === undefined) return recordMalformed<T>();

  let validated: T | null;
  try {
    validated = validate(parsed);
  } catch {
    return recordMalformed<T>();
  }
  return validated === null ? recordMalformed<T>() : recordValue(validated);
}

/** The fixed, value-free copy every write failure carries. No thrown value, no
 * serialized fragment and no field name is ever embedded. */
const WRITE_FAILED_MESSAGE = "The record could not be stored.";

/**
 * Serializes, ROUND-TRIP VALIDATES, and writes one identity record. Never rejects.
 *
 * The round trip is the point. A successful `set` must imply that the repository's
 * own `load` validator will accept what is now on disk — otherwise a transition can
 * be told "the barrier is durably established", go on to call a provider, and then
 * find on the next load that the barrier is `malformed` and the person is locked out
 * with a session that was created anyway. So, in order:
 *
 *  1. `JSON.stringify` must not throw AND must not return `undefined`. `undefined`
 *     is what a `toJSON()` returning `undefined`, a bare `undefined`, a function or a
 *     symbol produces — a "successful" serialization of nothing.
 *  2. The serialized string is parsed back. This is the EXACT representation a later
 *     `readIdentityRecord` will see, which is what defeats accessor-backed and
 *     Proxy-backed records (whose live getters do not survive serialization) and
 *     `toJSON` substitution (where the stored shape differs from the in-memory one).
 *  3. The repository's OWN validator must accept that parsed value. An id from a
 *     defective generator, a timestamp from a defective clock, a malformed provider
 *     selector or any schema-invalid field is rejected here, BEFORE `adapter.set` is
 *     called — so nothing invalid is ever written in the first place.
 *
 * Passing the validator is required, not optional: a caller that could omit it would
 * reintroduce exactly the gap this closes.
 */
/**
 * The raw stored string for `key`, without parsing or validating it.
 *
 * Used **only** where a repository has to prove the stored bytes have not changed
 * between a read and a dependent write. That is the narrowest compare-and-set this
 * storage interface can express: it does not make the write atomic — nothing here
 * can — but it turns "read, decide, blindly overwrite" into "read, decide, confirm
 * the bytes are still the ones the decision was made from, then write", which is
 * what stops an older operation from overwriting a record a newer capture replaced.
 *
 * The residual window is the write itself, and ADR-0025 §8's honest limitation
 * still stands.
 */
export async function readIdentityRecordRaw(
  adapter: Pick<StorageAdapter, "get">,
  key: string
): Promise<{ status: "value"; raw: string } | { status: "absent" } | { status: "read_failed" }> {
  let result: unknown;
  try {
    result = await adapter.get(key);
  } catch {
    return { status: "read_failed" };
  }
  if (readUntrustedProperty(result, "status") !== "value") return { status: "read_failed" };
  const raw = readUntrustedProperty(result, "value");
  if (raw === null) return { status: "absent" };
  return typeof raw === "string" ? { status: "value", raw } : { status: "read_failed" };
}

export async function writeIdentityRecord<T>(
  adapter: Pick<StorageAdapter, "set">,
  key: string,
  record: T,
  validate: (raw: unknown) => T | null
): Promise<PersistenceWriteResult> {
  const writeFailure: PersistenceWriteResult = {
    ok: false,
    error: { kind: "unknown", message: WRITE_FAILED_MESSAGE },
  };

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(record);
  } catch {
    return writeFailure;
  }
  if (typeof serialized !== "string") return writeFailure;

  const roundTripped = parseUntrustedJson(serialized);
  if (roundTripped === undefined) return writeFailure;

  let validated: T | null;
  try {
    validated = validate(roundTripped);
  } catch {
    return writeFailure;
  }
  if (validated === null) return writeFailure;

  let result: unknown;
  try {
    result = await adapter.set(key, serialized);
  } catch {
    return writeFailure;
  }

  if (readUntrustedProperty(result, "ok") === true) return { ok: true };
  const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
  if (kind === "storage_unavailable") return { ok: false, error: { kind: "storage_unavailable" } };
  if (kind === "quota_exceeded") return { ok: false, error: { kind: "quota_exceeded" } };
  return writeFailure;
}

/** The fixed, value-free copy every removal failure carries. */
const REMOVE_FAILED_MESSAGE = "The record could not be removed.";

/** Removes one key, containing an adapter throw and an unrecognizable adapter
 * result as a normalized removal failure. Never rejects, and never embeds anything
 * read from the adapter's own result. */
export async function removeIdentityRecord(
  adapter: Pick<RemovableStorageAdapter, "remove">,
  key: string
): Promise<PersistenceRemoveResult> {
  const removalFailure: PersistenceRemoveResult = {
    ok: false,
    error: { kind: "removal_failed", message: REMOVE_FAILED_MESSAGE },
  };

  let result: unknown;
  try {
    result = await adapter.remove(key);
  } catch {
    return removalFailure;
  }

  if (readUntrustedProperty(result, "ok") === true) return { ok: true };
  const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
  if (kind === "storage_unavailable") return { ok: false, error: { kind: "storage_unavailable" } };
  return removalFailure;
}
