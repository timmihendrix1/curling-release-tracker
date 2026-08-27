// The `InteractiveAuthAttempt` — the durable record of one deliberate
// authentication in flight (ADR-0025 §5, §7, §10; Stage B0.2c).
//
// It is the middle member of the durable correlation set (barrier + attempt +
// resolution). It exists to answer one question after a full-page provider
// return or a reload: *was this callback produced by the authentication THIS
// application actually started, against the barrier that is current now?*
//
// TWO INVARIANTS ARE STRUCTURAL, NOT CONVENTIONAL:
//
//  1. **`barrierId` is never null.** The type declares `string`, the two
//     constructors both require it, and the validator rejects a record without a
//     canonical UUID there. An attempt that is not bound to an exact barrier
//     could resolve the wrong one.
//  2. **`flowId` is required for `google` and null for `email_otp`.** Rather than
//     relying on a caller to remember that, there is one constructor per method:
//     `createGoogleAttempt` cannot be called without a `flowId`, and
//     `createEmailOtpAttempt` has no `flowId` parameter at all. The validator
//     enforces the same pairing at the storage boundary.
//
// WHY THE `flowId` IS PERSISTED AT ALL, STATED EXACTLY (ADR-0025 §G). It is a
// **non-secret selector** that names a PKCE verifier slot in the Supabase SDK's
// own storage; it is not the verifier and cannot be exchanged for anything. It is
// deliberately persisted here because it is the only value that can correlate a
// callback to the attempt that produced it. The verifier itself, the
// authorization code, and the session's access and refresh tokens are never
// copied into this record. Claims such as "`sb_flow_id` is never stored" are
// false and must not appear anywhere.
//
// GOOGLE'S ORDERING CONSEQUENCE. `signInWithOAuth` is what returns the `flowId`,
// so a COMPLETE Google attempt cannot exist before that provider call. The start
// sequence is therefore barrier -> prepare -> validate -> persist this attempt ->
// validate -> navigate. Email OTP has no selector, so its complete attempt is
// persisted before its first provider call.

import {
  hasSupportedSchemaVersion,
  isRecordLike,
  readUntrustedLiteral,
  readUntrustedNonNegativeInteger,
  readUntrustedOpaqueId,
  readUntrustedProperty,
  readUntrustedTimestamp,
  readUntrustedUuid,
} from "./untrustedValue";

export const INTERACTIVE_ATTEMPT_SCHEMA_VERSION = 1 as const;

export const INTERACTIVE_ATTEMPT_STORAGE_KEY = "curling.identity.interactiveAttempt.v1";

export type InteractiveAuthMethod = "google" | "email_otp";

export const INTERACTIVE_AUTH_METHODS: readonly InteractiveAuthMethod[] = ["google", "email_otp"];

/** The SDK's flow selector is an opaque token; this bound only rejects absurd
 * values. Matches the selector length ceiling the callback classifier already
 * accepts (src/lib/supabase/supabaseCallbackClassifier.ts). */
const MAX_FLOW_ID_LENGTH = 64;

export type InteractiveAuthAttempt = {
  schemaVersion: typeof INTERACTIVE_ATTEMPT_SCHEMA_VERSION;
  /** A canonical UUID. */
  attemptId: string;
  method: InteractiveAuthMethod;
  /** Non-null for `google`, null for `email_otp` — enforced by the constructors
   * below and re-enforced by the validator. */
  flowId: string | null;
  /** **Never null.** The exact barrier this attempt may resolve. */
  barrierId: string;
  /** The START-PAGE live generation at the moment this attempt was persisted
   * (ADR-0025 §9). The resolution copies exactly this value, so Phase A compares
   * two PERSISTED numbers with each other and never a callback page's freshly
   * reset in-memory counter. */
  capturedIdentityGeneration: number;
  startedAt: string;
};

/**
 * A Google attempt. `flowId` is a required `string` here, so there is no way to
 * construct a Google attempt without the callback selector it will later have to
 * be matched against.
 */
export function createGoogleAttempt(input: {
  attemptId: string;
  flowId: string;
  barrierId: string;
  capturedIdentityGeneration: number;
  startedAt: string;
}): InteractiveAuthAttempt {
  return {
    schemaVersion: INTERACTIVE_ATTEMPT_SCHEMA_VERSION,
    attemptId: input.attemptId,
    method: "google",
    flowId: input.flowId,
    barrierId: input.barrierId,
    capturedIdentityGeneration: input.capturedIdentityGeneration,
    startedAt: input.startedAt,
  };
}

/**
 * An email-OTP attempt. There is deliberately no `flowId` parameter: OTP has no
 * callback selector, so a non-null one here could only ever be a mistake.
 */
export function createEmailOtpAttempt(input: {
  attemptId: string;
  barrierId: string;
  capturedIdentityGeneration: number;
  startedAt: string;
}): InteractiveAuthAttempt {
  return {
    schemaVersion: INTERACTIVE_ATTEMPT_SCHEMA_VERSION,
    attemptId: input.attemptId,
    method: "email_otp",
    flowId: null,
    barrierId: input.barrierId,
    capturedIdentityGeneration: input.capturedIdentityGeneration,
    startedAt: input.startedAt,
  };
}

/**
 * Validates an untrusted stored value into an attempt, or returns `null`. Never
 * throws, for any input, including a hostile `Proxy` or a throwing getter.
 *
 * Rejects — with no repair and no prior-schema branch — a wrong
 * `schemaVersion`, a non-UUID `attemptId` or `barrierId`, a **missing or null
 * `barrierId`**, an unknown `method`, a `google` record whose `flowId` is null or
 * malformed, an `email_otp` record whose `flowId` is anything but `null`, a
 * non-integer generation, and an unparseable `startedAt`.
 */
export function validateInteractiveAuthAttempt(raw: unknown): InteractiveAuthAttempt | null {
  if (!isRecordLike(raw)) return null;
  if (!hasSupportedSchemaVersion(raw, INTERACTIVE_ATTEMPT_SCHEMA_VERSION)) return null;

  const attemptId = readUntrustedUuid(raw, "attemptId");
  if (attemptId === null) return null;

  // The non-null barrier binding, enforced at the untrusted boundary as well as
  // in the type: an attempt bound to nothing could resolve the wrong barrier.
  const barrierId = readUntrustedUuid(raw, "barrierId");
  if (barrierId === null) return null;

  const method = readUntrustedLiteral<InteractiveAuthMethod>(raw, "method", INTERACTIVE_AUTH_METHODS);
  if (method === null) return null;

  const rawFlowId = readUntrustedProperty(raw, "flowId");
  let flowId: string | null;
  if (method === "google") {
    const validated = readUntrustedOpaqueId(raw, "flowId", MAX_FLOW_ID_LENGTH);
    if (validated === null) return null;
    flowId = validated;
  } else {
    if (rawFlowId !== null) return null;
    flowId = null;
  }

  const capturedIdentityGeneration = readUntrustedNonNegativeInteger(
    raw,
    "capturedIdentityGeneration"
  );
  if (capturedIdentityGeneration === null) return null;

  const startedAt = readUntrustedTimestamp(raw, "startedAt");
  if (startedAt === null) return null;

  return {
    schemaVersion: INTERACTIVE_ATTEMPT_SCHEMA_VERSION,
    attemptId,
    method,
    flowId,
    barrierId,
    capturedIdentityGeneration,
    startedAt,
  };
}
