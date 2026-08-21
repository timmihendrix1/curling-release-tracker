// The Team Admin responsibility-request state machine — requirements 67-75. Same
// pure-function discipline as invitationLifecycle.ts; the Postgres RPCs re-derive and
// transactionally enforce these rules from durable rows.

import type { AdminRequestId, TeamAdminRequest } from "./types";

export type EffectiveAdminRequestStatus = "pending" | "accepted" | "revoked" | "replaced" | "expired";

export function deriveAdminRequestStatus(request: TeamAdminRequest, now: Date): EffectiveAdminRequestStatus {
  if (request.status === "pending" && new Date(request.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }
  return request.status;
}

export type AdminRequestAcceptanceDenialReason =
  | "expired"
  | "revoked"
  | "replaced"
  | "already_accepted"
  | "wrong_nominee";

export type AdminRequestAcceptanceCheck =
  | { ok: true }
  | { ok: false; reason: AdminRequestAcceptanceDenialReason };

/**
 * `isCallerNominee` is computed by the caller (the RPC/service layer) by comparing the
 * request's `membershipId` to the authenticated caller's own current membership row
 * for this team — never by trusting a client-supplied profile/membership id
 * (requirement 132: "no client-supplied Profile, owner, team, or email value can
 * override authenticated identity").
 */
export function checkAdminRequestAcceptable(
  request: TeamAdminRequest,
  now: Date,
  isCallerNominee: boolean
): AdminRequestAcceptanceCheck {
  const effective = deriveAdminRequestStatus(request, now);
  if (effective === "expired") return { ok: false, reason: "expired" };
  if (effective === "revoked") return { ok: false, reason: "revoked" };
  if (effective === "replaced") return { ok: false, reason: "replaced" };
  if (effective === "accepted") return { ok: false, reason: "already_accepted" };
  if (!isCallerNominee) return { ok: false, reason: "wrong_nominee" };
  return { ok: true };
}

export function canReviseAdminRequest(request: TeamAdminRequest, now: Date): boolean {
  return deriveAdminRequestStatus(request, now) === "pending";
}

export function closeAdminRequestForReplacementOrRevocation(
  request: TeamAdminRequest,
  outcome: "revoked" | "replaced",
  newRequestId: AdminRequestId | null,
  now: Date
): Pick<TeamAdminRequest, "status" | "revokedAt" | "replacedByRequestId"> {
  return {
    status: outcome,
    revokedAt: outcome === "revoked" ? now.toISOString() : request.revokedAt,
    replacedByRequestId: outcome === "replaced" ? newRequestId : request.replacedByRequestId,
  };
}

/**
 * A request becomes invalid the moment its target membership ends (requirement 75:
 * "Requests for members who leave or are removed become invalid immediately"). This
 * is checked as a side effect of ending a membership (the RPC that ends a membership
 * revokes every pending request naming it, in the same transaction), not by this pure
 * function polling membership state — this helper just names the resulting status so
 * both the RPC and any UI copy use the same word for it.
 */
export const ADMIN_REQUEST_INVALIDATED_BY_MEMBERSHIP_END_STATUS: EffectiveAdminRequestStatus = "revoked";
