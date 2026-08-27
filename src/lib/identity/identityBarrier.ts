// The `IdentityAccessBarrier` — the universal, durable, deny-by-default latch
// (ADR-0025 §5; Stage B0.2c).
//
// WHY IT EXISTS. `exchangeCodeForSession` and `verifyOtp` both persist the
// session and emit `SIGNED_IN` **before** they resolve. By the time application
// code can evaluate whether the operation it started actually succeeded, a real
// provider session already exists and would survive a reload. A post-hoc verdict
// cannot undo that. Only a durable denial written BEFORE the provider call can,
// which is why every deliberate identity transition writes a fresh unresolved
// barrier first and refuses to start at all if that write fails.
//
// HOW IT ENDS. A barrier is **resolved, never deleted**. A successful correlated
// operation writes an `IdentityBarrierResolution` under a key derived from this
// barrier's own `barrierId` (identityBarrierResolution.ts); it never touches this
// key. A barrier is superseded only by writing a NEWER barrier, which is always
// the deny-ward direction. There is deliberately no removal path anywhere for
// this record — see identityBarrierRepository.ts, which takes the base
// `StorageAdapter` and therefore cannot delete.
//
// THREAT MODEL (ADR-0025 §21, binding). Browser storage is not a security
// boundary. A person able to alter it can forge this record, exactly as they can
// forge a trusted-device record, an attempt or a resolution. None of them grants
// server-side authority — every cloud operation still derives authority from the
// real provider session, `auth.uid()`, table grants and RLS. In Stage B0.2 a
// forged record can cause the application shell to mount and therefore expose
// whatever sporting data exists in the current identity-unscoped local
// workspace, which is an independent reason B0.2 cannot be released before B0.3.

import {
  hasSupportedSchemaVersion,
  isRecordLike,
  readUntrustedLiteral,
  readUntrustedNullableNonNegativeInteger,
  readUntrustedNullableOpaqueId,
  readUntrustedTimestamp,
  readUntrustedUuid,
} from "./untrustedValue";

export const IDENTITY_BARRIER_SCHEMA_VERSION = 1 as const;

/** The single shared key. Last-writer-wins on it is safe *because* every write
 * is deny-ward: a newer barrier always denies at least as much as the one it
 * replaces. */
export const IDENTITY_BARRIER_STORAGE_KEY = "curling.identity.accessBarrier.v1";

/**
 * Why this barrier exists. The origin is honest history, not a permission: no
 * origin makes a barrier weaker, and the locked screen's copy varies by origin
 * (ADR-0025 §9.1) without any of them offering a bypass.
 */
export type IdentityBarrierOrigin =
  /** A person signed out deliberately. */
  | "explicit_sign_out"
  /** A deliberate authentication started with no barrier in place. */
  | "interactive_authentication"
  /** A deliberate authentication started while a barrier already existed —
   * valid, malformed or unsupported. The old barrier's id is never preserved. */
  | "locked_screen_recovery"
  /** The bounded invitation wrong-account recovery transition (ADR-0025 §C). */
  | "account_recovery"
  /** A grant-bearing write completed but could no longer be confirmed — because
   * its operation lost ownership or its post-write proof failed. A fresh
   * unresolved barrier retracts that grant durably before the shared effect lane
   * admits another operation. */
  | "unconfirmed_grant_fence"
  /** A server-driven invalidation — no person started it (ADR-0025 §14). */
  | "server_identity_invalidated";

export const IDENTITY_BARRIER_ORIGINS: readonly IdentityBarrierOrigin[] = [
  "explicit_sign_out",
  "interactive_authentication",
  "locked_screen_recovery",
  "account_recovery",
  "unconfirmed_grant_fence",
  "server_identity_invalidated",
];

/** Provider account identifiers are opaque; this bound only rejects absurd
 * values, it does not assert a format. */
const MAX_ACCOUNT_SCOPE_ID_LENGTH = 256;

export type IdentityAccessBarrier = {
  schemaVersion: typeof IDENTITY_BARRIER_SCHEMA_VERSION;
  /** A canonical UUID. Also the selector the resolution key is derived from,
   * which is why the shape is validated strictly (untrustedValue.ts). */
  barrierId: string;
  origin: IdentityBarrierOrigin;
  /** The account scope this barrier denies, when it is honestly determinable —
   * `null` otherwise. **No account id is ever invented**: an unreadable previous
   * barrier yields `null`, not a guess. */
  barredAccountScopeId: string | null;
  /** The generation a previous barrier recorded, preserved when that barrier was
   * readable and `null` otherwise — **no value is invented**, exactly as no
   * account id is. A same-page marker only (ADR-0025 §9): nothing gates access on
   * it, and it is never cross-reload authority. */
  barredGeneration: number | null;
  establishedAt: string;
};

/**
 * Builds a barrier. Takes every field explicitly — including the clock and the
 * id — so the coordinator's injected deterministic clock and id generator are the
 * only sources, and no timestamp is ever fabricated inside a record module.
 */
export function createIdentityAccessBarrier(input: {
  barrierId: string;
  origin: IdentityBarrierOrigin;
  barredAccountScopeId: string | null;
  barredGeneration: number | null;
  establishedAt: string;
}): IdentityAccessBarrier {
  return {
    schemaVersion: IDENTITY_BARRIER_SCHEMA_VERSION,
    barrierId: input.barrierId,
    origin: input.origin,
    barredAccountScopeId: input.barredAccountScopeId,
    barredGeneration: input.barredGeneration,
    establishedAt: input.establishedAt,
  };
}

/**
 * Validates an untrusted stored value into a barrier, or returns `null`.
 *
 * Never throws — for a hostile `Proxy`, a throwing getter, a thrown non-`Error`,
 * a wrong `schemaVersion`, a missing field or a wrong-typed field alike. The
 * caught value is discarded and never inspected.
 *
 * There is **no** prior-schema branch, alias or compatibility shim: this record
 * has never shipped, so an unrecognized `schemaVersion` is malformed, and the
 * repository reports `malformed` (never `absent`) so the caller fails closed
 * toward denial.
 */
export function validateIdentityAccessBarrier(raw: unknown): IdentityAccessBarrier | null {
  if (!isRecordLike(raw)) return null;
  if (!hasSupportedSchemaVersion(raw, IDENTITY_BARRIER_SCHEMA_VERSION)) return null;

  const barrierId = readUntrustedUuid(raw, "barrierId");
  if (barrierId === null) return null;

  const origin = readUntrustedLiteral<IdentityBarrierOrigin>(raw, "origin", IDENTITY_BARRIER_ORIGINS);
  if (origin === null) return null;

  const barredAccountScopeId = readUntrustedNullableOpaqueId(
    raw,
    "barredAccountScopeId",
    MAX_ACCOUNT_SCOPE_ID_LENGTH
  );
  if (!barredAccountScopeId.present) return null;

  const barredGeneration = readUntrustedNullableNonNegativeInteger(raw, "barredGeneration");
  if (!barredGeneration.present) return null;

  const establishedAt = readUntrustedTimestamp(raw, "establishedAt");
  if (establishedAt === null) return null;

  return {
    schemaVersion: IDENTITY_BARRIER_SCHEMA_VERSION,
    barrierId,
    origin,
    barredAccountScopeId: barredAccountScopeId.value,
    barredGeneration: barredGeneration.value,
    establishedAt,
  };
}
