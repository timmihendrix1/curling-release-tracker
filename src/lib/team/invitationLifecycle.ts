// The invitation state machine — requirements 47-66. Pure functions only; the
// Postgres RPCs (docs/adr/0022) are the actual transactional authority (secret
// rotation, replay prevention, concurrent-acceptance locking) and re-derive the same
// rules from durable rows under row locks. This module exists so the domain rules
// have exactly one written-out description, exercised directly by unit tests, and so
// the UI can render an honest, normalized state without re-deriving expiry logic
// itself.

import type { InvitationId, TeamInvitation } from "./types";

export type EffectiveInvitationStatus = "pending" | "accepted" | "expired" | "revoked" | "replaced";

/**
 * The status a reader must treat an invitation as having *right now* — requirement 59:
 * "Expiry may be derived, but API/UI behavior must be explicit and total." A stored
 * `"pending"` row past its `expiresAt` is always reported as `"expired"` here, even if
 * no write has yet flipped the durable `status` column to match (the RPCs update the
 * column lazily, on next read/write, per docs/adr/0022 — this function is what makes
 * that lazy update safe: every caller already treats the derived value as
 * authoritative, so a delayed write is never user-visible as an inconsistency).
 */
export function deriveInvitationStatus(invitation: TeamInvitation, now: Date): EffectiveInvitationStatus {
  if (invitation.status === "pending" && new Date(invitation.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return invitation.status;
}

export type InvitationAcceptanceDenialReason =
  | "expired"
  | "revoked"
  | "replaced"
  | "already_accepted"
  | "wrong_email";

export type InvitationAcceptanceCheck =
  | { ok: true }
  | { ok: false; reason: InvitationAcceptanceDenialReason };

/**
 * Whether `invitation` may be accepted right now by an authenticated account whose
 * verified email is `authenticatedEmail`. Email comparison is case-insensitive (email
 * addresses are conventionally treated case-insensitively for matching purposes in
 * this product, even though SMTP technically allows a case-sensitive local part) —
 * this avoids a spurious `wrong_email` result for a recipient who typed their own
 * address in different casing than the Team Admin did when creating the invitation.
 * This function never inspects or validates the raw token itself — token
 * lookup/hashing/replay handling happens one layer below this, in the RPC, before an
 * `invitation` even reaches this check (requirement 65: malformed/replayed tokens fail
 * closed at that earlier layer, never by falling through to a domain reason here).
 */
export function checkInvitationAcceptable(
  invitation: TeamInvitation,
  now: Date,
  authenticatedEmail: string
): InvitationAcceptanceCheck {
  const effective = deriveInvitationStatus(invitation, now);
  if (effective === "expired") return { ok: false, reason: "expired" };
  if (effective === "revoked") return { ok: false, reason: "revoked" };
  if (effective === "replaced") return { ok: false, reason: "replaced" };
  if (effective === "accepted") return { ok: false, reason: "already_accepted" };
  if (invitation.email.trim().toLowerCase() !== authenticatedEmail.trim().toLowerCase()) {
    return { ok: false, reason: "wrong_email" };
  }
  return { ok: true };
}

/** Whether a Team Admin may replace/resend/revoke this invitation right now — any
 * status is allowed for revoke (revoking an already-terminal invitation is a safe
 * no-op the RPC reports idempotently), but replace/resend are only meaningful while
 * the invitation is still effectively pending. */
export function canReviseInvitation(invitation: TeamInvitation, now: Date): boolean {
  return deriveInvitationStatus(invitation, now) === "pending";
}

/** Pure helper describing the row-level transition a replace/resend/revoke performs
 * on the OLD invitation — never on the new one, which is a fresh row (requirement 61:
 * "revokes/replaces the old invitation, rotates the secret ... and sends a new
 * link"). `newInvitationId` is null for a plain revoke (no replacement is created). */
export function closeInvitationForReplacementOrRevocation(
  invitation: TeamInvitation,
  outcome: "revoked" | "replaced",
  newInvitationId: InvitationId | null,
  now: Date
): Pick<TeamInvitation, "status" | "revokedAt" | "replacedByInvitationId"> {
  return {
    status: outcome,
    revokedAt: outcome === "revoked" ? now.toISOString() : invitation.revokedAt,
    replacedByInvitationId: outcome === "replaced" ? newInvitationId : invitation.replacedByInvitationId,
  };
}
