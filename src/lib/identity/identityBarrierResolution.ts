// The `IdentityBarrierResolution` — how a barrier ends (ADR-0025 §6; Stage B0.2c).
//
// **A barrier is resolved, never deleted.** A successful correlated operation
// writes this record under a key DERIVED FROM THE EXACT `barrierId` it resolves:
//
//     curling.identity.accessBarrierResolution.<barrierId>.v1
//
// WHY THAT IS THE WHOLE POINT. `StorageAdapter`
// (src/lib/persistence/types.ts) offers no compare-and-delete and explicitly
// claims no multi-key atomicity. A "read the barrier, then delete it"
// finalization could therefore remove a barrier that another tab installed
// between the read and the delete — destroying a newer denial with an older
// operation's success. Because each resolution lives under its own derived key,
// **writing resolution B cannot alter, overwrite, remove or resolve a newer
// barrier C**: they are different keys by construction, which is exactly the
// property the storage interface itself cannot provide. If C was installed while
// B's write was in flight, resolution B is harmless on disk and C stays
// unresolved.
//
// **A resolution grants nothing on its own.** It establishes only that this exact
// barrier was completed. Profile, onboarding, entitlement, trusted-state and
// every server-negative result still deny access — see ADR-0025 §6 and the
// Phase B rules in identityTransitionCoordinator.ts.
//
// **`identityGeneration` copies the ATTEMPT's persisted value**, never a
// callback page's freshly reset in-memory counter (ADR-0025 §9). Phase A
// therefore compares two persisted numbers with each other, which is a comparison
// that survives reload; a live generation never is.
//
// Contains no token, session, authorization code or PKCE verifier — only the
// non-secret flow selector, which is the point of persisting it (ADR-0025 §G).

import {
  hasSupportedSchemaVersion,
  isCanonicalUuid,
  isRecordLike,
  readUntrustedLiteral,
  readUntrustedNonNegativeInteger,
  readUntrustedOpaqueId,
  readUntrustedProperty,
  readUntrustedTimestamp,
  readUntrustedUuid,
} from "./untrustedValue";
import {
  INTERACTIVE_AUTH_METHODS,
  type InteractiveAuthMethod,
} from "./interactiveAttempt";

export const IDENTITY_BARRIER_RESOLUTION_SCHEMA_VERSION = 1 as const;

const RESOLUTION_KEY_PREFIX = "curling.identity.accessBarrierResolution.";
const RESOLUTION_KEY_SUFFIX = ".v1";

const MAX_FLOW_ID_LENGTH = 64;
const MAX_ACCOUNT_SCOPE_ID_LENGTH = 256;

export type IdentityBarrierResolution = {
  schemaVersion: typeof IDENTITY_BARRIER_RESOLUTION_SCHEMA_VERSION;
  barrierId: string;
  attemptId: string;
  method: InteractiveAuthMethod;
  flowId: string | null;
  /** Copies `attempt.capturedIdentityGeneration` exactly. */
  identityGeneration: number;
  /** Checked only in Phase B, once an identity has actually been restored or
   * returned by the provider — never in Phase A, where no identity exists yet. */
  authenticatedAccountScopeId: string;
  resolvedAt: string;
};

/**
 * Derives the per-barrier storage key, or returns `null` when the id is not a
 * canonical UUID.
 *
 * Returning `null` rather than interpolating whatever it was given is deliberate:
 * a tampered `barrierId` containing `.`, `/`, `*` or `..` must never reach key
 * construction, where it could name a different record's key. The strict UUID
 * check lives in untrustedValue.ts and is applied to every id this module and the
 * barrier validator accept.
 */
export function resolutionStorageKeyFor(barrierId: string): string | null {
  if (!isCanonicalUuid(barrierId)) return null;
  return RESOLUTION_KEY_PREFIX + barrierId + RESOLUTION_KEY_SUFFIX;
}

/** Whether a storage key is a resolution key at all — used by non-current
 * cleanup so it can never target an unrelated key. */
export function isResolutionStorageKey(key: string): boolean {
  if (!key.startsWith(RESOLUTION_KEY_PREFIX) || !key.endsWith(RESOLUTION_KEY_SUFFIX)) return false;
  const middle = key.slice(RESOLUTION_KEY_PREFIX.length, key.length - RESOLUTION_KEY_SUFFIX.length);
  return isCanonicalUuid(middle);
}

export function createIdentityBarrierResolution(input: {
  barrierId: string;
  attemptId: string;
  method: InteractiveAuthMethod;
  flowId: string | null;
  identityGeneration: number;
  authenticatedAccountScopeId: string;
  resolvedAt: string;
}): IdentityBarrierResolution {
  return {
    schemaVersion: IDENTITY_BARRIER_RESOLUTION_SCHEMA_VERSION,
    barrierId: input.barrierId,
    attemptId: input.attemptId,
    method: input.method,
    flowId: input.flowId,
    identityGeneration: input.identityGeneration,
    authenticatedAccountScopeId: input.authenticatedAccountScopeId,
    resolvedAt: input.resolvedAt,
  };
}

/**
 * Validates an untrusted stored value into a resolution, or returns `null`. Never
 * throws, for any input. No prior-schema branch, alias or repair exists.
 *
 * The `method`/`flowId` pairing is enforced here exactly as it is on the attempt:
 * a `google` resolution must carry a well-formed selector, and an `email_otp`
 * resolution must carry `null`.
 */
export function validateIdentityBarrierResolution(raw: unknown): IdentityBarrierResolution | null {
  if (!isRecordLike(raw)) return null;
  if (!hasSupportedSchemaVersion(raw, IDENTITY_BARRIER_RESOLUTION_SCHEMA_VERSION)) return null;

  const barrierId = readUntrustedUuid(raw, "barrierId");
  if (barrierId === null) return null;

  const attemptId = readUntrustedUuid(raw, "attemptId");
  if (attemptId === null) return null;

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

  const identityGeneration = readUntrustedNonNegativeInteger(raw, "identityGeneration");
  if (identityGeneration === null) return null;

  const authenticatedAccountScopeId = readUntrustedOpaqueId(
    raw,
    "authenticatedAccountScopeId",
    MAX_ACCOUNT_SCOPE_ID_LENGTH
  );
  if (authenticatedAccountScopeId === null) return null;

  const resolvedAt = readUntrustedTimestamp(raw, "resolvedAt");
  if (resolvedAt === null) return null;

  return {
    schemaVersion: IDENTITY_BARRIER_RESOLUTION_SCHEMA_VERSION,
    barrierId,
    attemptId,
    method,
    flowId,
    identityGeneration,
    authenticatedAccountScopeId,
    resolvedAt,
  };
}

/**
 * The one canonical structural-correlation predicate: does this resolution
 * genuinely complete THIS barrier via THIS attempt?
 *
 * Every one of these must hold, and each one closes a real hole:
 *
 *  - `resolution.barrierId === barrier.barrierId` — a resolution written for an
 *    older barrier can never complete the current one.
 *  - `attempt.barrierId === barrier.barrierId` — an attempt started against an
 *    older barrier can never be the attempt that completed this one.
 *  - `resolution.attemptId === attempt.attemptId` — the resolution must name the
 *    attempt that is still current, not a superseded one.
 *  - `resolution.method === attempt.method` and
 *    `resolution.flowId === attempt.flowId` — the resolution must describe the
 *    same operation, by the same method, through the same selector.
 *  - `resolution.identityGeneration === attempt.capturedIdentityGeneration` — two
 *    PERSISTED numbers compared with each other (ADR-0025 §9). A callback page's
 *    freshly reset live counter is deliberately not part of this comparison.
 *
 * **No account scope is checked here.** This predicate is what Phase A can
 * establish, and Phase A runs before any identity has been restored; comparing a
 * scope there would be a check against nothing. Phase B does that comparison
 * (identityTransitionCoordinator.ts).
 */
export function isStructurallyCorrelated(
  barrier: { barrierId: string },
  attempt: {
    attemptId: string;
    barrierId: string;
    method: InteractiveAuthMethod;
    flowId: string | null;
    capturedIdentityGeneration: number;
  },
  resolution: IdentityBarrierResolution
): boolean {
  return (
    attempt.barrierId === barrier.barrierId &&
    resolution.barrierId === barrier.barrierId &&
    resolution.attemptId === attempt.attemptId &&
    resolution.method === attempt.method &&
    resolution.flowId === attempt.flowId &&
    resolution.identityGeneration === attempt.capturedIdentityGeneration
  );
}
