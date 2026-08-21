import { describe, expect, it } from "vitest";
import {
  canReviseInvitation,
  checkInvitationAcceptable,
  closeInvitationForReplacementOrRevocation,
  deriveInvitationStatus,
} from "../invitationLifecycle";
import type { TeamInvitation } from "../types";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function invitation(overrides: Partial<TeamInvitation> = {}): TeamInvitation {
  return {
    id: "inv1",
    teamId: "t1",
    email: "invitee@example.com",
    participationAsPlayer: true,
    proposedFunctions: [],
    status: "pending",
    createdAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    replacedByInvitationId: null,
    emailDeliveryStatus: "sent",
    ...overrides,
  };
}

describe("deriveInvitationStatus (requirement 59: expiry may be derived, behavior must be total)", () => {
  it("reports a pending invitation as pending before its expiry", () => {
    expect(deriveInvitationStatus(invitation(), NOW)).toBe("pending");
  });

  it("reports a pending invitation as expired once past its expiry, even though the stored column still says pending", () => {
    const expired = invitation({ expiresAt: "2026-05-02T00:00:00.000Z" });
    expect(deriveInvitationStatus(expired, NOW)).toBe("expired");
  });

  it("reports exactly at the expiry instant as expired (inclusive boundary)", () => {
    const boundary = invitation({ expiresAt: NOW.toISOString() });
    expect(deriveInvitationStatus(boundary, NOW)).toBe("expired");
  });

  it("never overrides a terminal stored status with expiry logic", () => {
    for (const status of ["accepted", "revoked", "replaced"] as const) {
      const terminal = invitation({ status, expiresAt: "2020-01-01T00:00:00.000Z" });
      expect(deriveInvitationStatus(terminal, NOW)).toBe(status);
    }
  });
});

describe("checkInvitationAcceptable (requirements 49-52, 59, 65)", () => {
  it("accepts a pending, unexpired invitation for the matching verified email", () => {
    expect(checkInvitationAcceptable(invitation(), NOW, "invitee@example.com")).toEqual({ ok: true });
  });

  it("email match is case-insensitive", () => {
    expect(checkInvitationAcceptable(invitation(), NOW, "INVITEE@EXAMPLE.com")).toEqual({ ok: true });
  });

  it("denies a wrong-email acceptance attempt without leaking which other field was wrong", () => {
    expect(checkInvitationAcceptable(invitation(), NOW, "someone-else@example.com")).toEqual({
      ok: false,
      reason: "wrong_email",
    });
  });

  it("denies acceptance of an expired invitation, even for the correct email", () => {
    const expired = invitation({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(checkInvitationAcceptable(expired, NOW, "invitee@example.com")).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("denies acceptance of a revoked invitation", () => {
    const revoked = invitation({ status: "revoked", revokedAt: NOW.toISOString() });
    expect(checkInvitationAcceptable(revoked, NOW, "invitee@example.com")).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("denies acceptance of a replaced invitation", () => {
    const replaced = invitation({ status: "replaced", replacedByInvitationId: "inv2" });
    expect(checkInvitationAcceptable(replaced, NOW, "invitee@example.com")).toEqual({
      ok: false,
      reason: "replaced",
    });
  });

  it("denies a second acceptance attempt (replay) of an already-accepted invitation", () => {
    const accepted = invitation({ status: "accepted", acceptedAt: NOW.toISOString() });
    expect(checkInvitationAcceptable(accepted, NOW, "invitee@example.com")).toEqual({
      ok: false,
      reason: "already_accepted",
    });
  });

  it("expiry takes priority over a would-be email mismatch — the denial reason is deterministic, not a race between checks", () => {
    const expired = invitation({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(checkInvitationAcceptable(expired, NOW, "wrong@example.com")).toEqual({ ok: false, reason: "expired" });
  });
});

describe("canReviseInvitation / closeInvitationForReplacementOrRevocation (requirements 61-62)", () => {
  it("a pending invitation can be revised; a terminal one cannot", () => {
    expect(canReviseInvitation(invitation(), NOW)).toBe(true);
    expect(canReviseInvitation(invitation({ status: "accepted" }), NOW)).toBe(false);
    expect(canReviseInvitation(invitation({ expiresAt: "2020-01-01T00:00:00.000Z" }), NOW)).toBe(false);
  });

  it("closing for replacement sets replacedByInvitationId and never touches revokedAt", () => {
    const original = invitation();
    const closed = closeInvitationForReplacementOrRevocation(original, "replaced", "inv2", NOW);
    expect(closed).toEqual({ status: "replaced", revokedAt: null, replacedByInvitationId: "inv2" });
  });

  it("closing for revocation sets revokedAt and never sets a replacement id", () => {
    const original = invitation();
    const closed = closeInvitationForReplacementOrRevocation(original, "revoked", null, NOW);
    expect(closed.status).toBe("revoked");
    expect(closed.revokedAt).toBe(NOW.toISOString());
    expect(closed.replacedByInvitationId).toBeNull();
  });
});
