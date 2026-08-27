// The `TrustedDeviceRecord` — offline identity continuity, and its honest threat
// model (ADR-0025 §15, §21; Stage B0.2c).
//
// WHY IT IS LOAD-BEARING. With the provider's default one-hour access-token
// lifetime, an offline device past expiry gets `session: null` from
// `getSession()`. Without this record, the accepted "train offline after
// onboarding" requirement of
// docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md could not be
// met at all: a legitimate athlete on the ice with no connectivity would be
// locked out of their own training.
//
// WHAT IT IS NOT. **Browser storage is not a security boundary.** A person able
// to alter it can forge this record — and equally an `IdentityAccessBarrier`, an
// `InteractiveAuthAttempt` or an `IdentityBarrierResolution`. **All four carry
// exactly the same local-tampering limitation and none of them is a substitute
// for server authority.** No cloud operation is authorized by any of them: every
// one still derives authority from the real provider session, `auth.uid()`, table
// grants and RLS. In Stage B0.2 a forged record can cause the application shell
// to mount and can therefore expose whatever sporting data exists in the current
// identity-unscoped local workspace — **an additional, independent reason B0.2
// cannot be released before B0.3**. B0.3 closes normal application-level
// cross-Profile and account-switch isolation; it does not turn browser storage
// into protection against an attacker with arbitrary device access, and neither
// does the SDK's own token storage.
//
// FAIL-CLOSED DIRECTION. This record only ever GRANTS, so failing closed means
// DISCARDING it: a malformed or unknown-version record is removed and treated as
// absent, never repaired. (A barrier only ever DENIES, so failing closed there
// means the opposite — leaving it in force. See errors.ts's module note.)
//
// **No expiry is invented.** ADR-0025 lists trusted-state expiry as explicitly
// not decided, so this record carries no `expiresAt` and nothing here ages it
// out. It is replaced or removed on every account change, sign-out and
// invalidation, and a negative fact is recorded only after it has actually been
// learned online.
//
// Deliberately NOT Profile-scoped in its key: it is the record that says WHICH
// Profile this device is trusted for, so it cannot live behind that answer.

import {
  hasSupportedSchemaVersion,
  isValidDisplayName,
  isRecordLike,
  readUntrustedNonNegativeInteger,
  readUntrustedOpaqueId,
  readUntrustedProperty,
  readUntrustedTimestamp,
  readUntrustedUuid,
} from "./untrustedValue";

export const TRUSTED_DEVICE_SCHEMA_VERSION = 1 as const;

export const TRUSTED_DEVICE_STORAGE_KEY = "curling.identity.trustedDevice.v1";

const MAX_ACCOUNT_SCOPE_ID_LENGTH = 256;
/** `profiles.display_name` is constrained to 80 characters by
 * supabase/migrations/20260820120000_team_foundation_schema.sql. */
/** The only entitlement Stage B0.2 knows about. The paid personal tier's
 * commercial name is explicitly undecided (ADR-0025 Non-goals) and is not
 * invented here. */
export type TrustedEntitlement = "free";

export type TrustedDeviceRecord = {
  schemaVersion: typeof TRUSTED_DEVICE_SCHEMA_VERSION;
  /** **The authoritative cross-reload identity binding.** Offline continuation
   * gates on this matching the current resolution's account scope — never on a
   * generation, which does not survive a reload. */
  accountScopeId: string;
  /** The application-owned `profiles.id` — never the auth-provider user id. */
  profileId: string;
  displayName: string;
  onboardingCompletedAt: string;
  entitlement: TrustedEntitlement;
  /** The live generation at establishment: a same-session marker only (ADR-0025
   * §9). Nothing gates access on comparing it across a reload. */
  generation: number;
  establishedAt: string;
  lastServerConfirmationAt: string;
};

/**
 * Builds a trusted record from facts that have ALL been confirmed
 * server-authoritatively. Every field is required, so a record can never be
 * written from a partially resolved gate state (ADR-0025 §15: "written only from
 * a successful server-authoritative result in which every required fact is
 * present").
 */
export function createTrustedDeviceRecord(input: {
  accountScopeId: string;
  profileId: string;
  displayName: string;
  onboardingCompletedAt: string;
  generation: number;
  establishedAt: string;
  lastServerConfirmationAt: string;
}): TrustedDeviceRecord {
  return {
    schemaVersion: TRUSTED_DEVICE_SCHEMA_VERSION,
    accountScopeId: input.accountScopeId,
    profileId: input.profileId,
    displayName: input.displayName,
    onboardingCompletedAt: input.onboardingCompletedAt,
    entitlement: "free",
    generation: input.generation,
    establishedAt: input.establishedAt,
    lastServerConfirmationAt: input.lastServerConfirmationAt,
  };
}

/**
 * Returns a copy of `record` whose `lastServerConfirmationAt` is `confirmedAt`,
 * changing nothing else.
 *
 * Used only for the same-scope metadata refresh of ADR-0025 §15. If the WRITE of
 * the returned copy fails, the caller keeps the ORIGINAL record unchanged and
 * reports `trusted_state_refresh_skipped`; **no updated timestamp is ever
 * fabricated**, and no account scope, Profile identity, onboarding or entitlement
 * fact may be altered by a refresh — which is why this function accepts no other
 * parameter.
 */
export function withServerConfirmation(
  record: TrustedDeviceRecord,
  confirmedAt: string
): TrustedDeviceRecord {
  return { ...record, lastServerConfirmationAt: confirmedAt };
}

/**
 * Validates an untrusted stored value into a trusted record, or returns `null`.
 * Never throws, for any input, including a hostile `Proxy` or a throwing getter.
 *
 * No prior-schema branch, alias, compatibility shim or repair exists: this record
 * has never shipped. An unrecognized `schemaVersion`, a missing field, a
 * wrong-typed field, a blank display name, an unparseable timestamp or an
 * entitlement other than `"free"` all make the record unusable — and because this
 * record only grants, the repository's caller removes it and proceeds as if no
 * device trust existed.
 */
export function validateTrustedDeviceRecord(raw: unknown): TrustedDeviceRecord | null {
  if (!isRecordLike(raw)) return null;
  if (!hasSupportedSchemaVersion(raw, TRUSTED_DEVICE_SCHEMA_VERSION)) return null;

  const accountScopeId = readUntrustedOpaqueId(raw, "accountScopeId", MAX_ACCOUNT_SCOPE_ID_LENGTH);
  if (accountScopeId === null) return null;

  const profileId = readUntrustedUuid(raw, "profileId");
  if (profileId === null) return null;

  const rawDisplayName = readUntrustedProperty(raw, "displayName");
  if (!isValidDisplayName(rawDisplayName)) return null;

  const onboardingCompletedAt = readUntrustedTimestamp(raw, "onboardingCompletedAt");
  if (onboardingCompletedAt === null) return null;

  if (readUntrustedProperty(raw, "entitlement") !== "free") return null;

  const generation = readUntrustedNonNegativeInteger(raw, "generation");
  if (generation === null) return null;

  const establishedAt = readUntrustedTimestamp(raw, "establishedAt");
  if (establishedAt === null) return null;

  const lastServerConfirmationAt = readUntrustedTimestamp(raw, "lastServerConfirmationAt");
  if (lastServerConfirmationAt === null) return null;

  return {
    schemaVersion: TRUSTED_DEVICE_SCHEMA_VERSION,
    accountScopeId,
    profileId,
    displayName: rawDisplayName,
    onboardingCompletedAt,
    entitlement: "free",
    generation,
    establishedAt,
    lastServerConfirmationAt,
  };
}
