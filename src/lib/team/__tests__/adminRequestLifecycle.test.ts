import { describe, expect, it } from "vitest";
import {
  canReviseAdminRequest,
  checkAdminRequestAcceptable,
  closeAdminRequestForReplacementOrRevocation,
  deriveAdminRequestStatus,
} from "../adminRequestLifecycle";
import type { TeamAdminRequest } from "../types";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function request(overrides: Partial<TeamAdminRequest> = {}): TeamAdminRequest {
  return {
    id: "req1",
    teamId: "t1",
    membershipId: "m1",
    status: "pending",
    createdAt: "2026-05-01T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    acceptedAt: null,
    revokedAt: null,
    replacedByRequestId: null,
    ...overrides,
  };
}

describe("deriveAdminRequestStatus (requirement 70)", () => {
  it("reports expired once past expiresAt even if stored status is still pending", () => {
    const expired = request({ expiresAt: "2026-05-02T00:00:00.000Z" });
    expect(deriveAdminRequestStatus(expired, NOW)).toBe("expired");
  });

  it("never overrides a terminal status", () => {
    for (const status of ["accepted", "revoked", "replaced"] as const) {
      expect(deriveAdminRequestStatus(request({ status, expiresAt: "2020-01-01T00:00:00.000Z" }), NOW)).toBe(status);
    }
  });
});

describe("checkAdminRequestAcceptable (requirements 67-75)", () => {
  it("accepts a pending, unexpired request from the correct nominee", () => {
    expect(checkAdminRequestAcceptable(request(), NOW, true)).toEqual({ ok: true });
  });

  it("denies acceptance attempted by anyone other than the nominee — requirement 132's identity boundary", () => {
    expect(checkAdminRequestAcceptable(request(), NOW, false)).toEqual({ ok: false, reason: "wrong_nominee" });
  });

  it("denies an expired request even for the correct nominee", () => {
    const expired = request({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(checkAdminRequestAcceptable(expired, NOW, true)).toEqual({ ok: false, reason: "expired" });
  });

  it("denies a revoked request", () => {
    expect(checkAdminRequestAcceptable(request({ status: "revoked" }), NOW, true)).toEqual({
      ok: false,
      reason: "revoked",
    });
  });

  it("denies a replaced request", () => {
    expect(checkAdminRequestAcceptable(request({ status: "replaced" }), NOW, true)).toEqual({
      ok: false,
      reason: "replaced",
    });
  });

  it("denies replay of an already-accepted request", () => {
    expect(checkAdminRequestAcceptable(request({ status: "accepted" }), NOW, true)).toEqual({
      ok: false,
      reason: "already_accepted",
    });
  });
});

describe("canReviseAdminRequest / closeAdminRequestForReplacementOrRevocation (requirement 71)", () => {
  it("a pending request can be revised/revoked; a terminal one cannot", () => {
    expect(canReviseAdminRequest(request(), NOW)).toBe(true);
    expect(canReviseAdminRequest(request({ status: "accepted" }), NOW)).toBe(false);
  });

  it("closing for replacement sets replacedByRequestId only", () => {
    const closed = closeAdminRequestForReplacementOrRevocation(request(), "replaced", "req2", NOW);
    expect(closed).toEqual({ status: "replaced", revokedAt: null, replacedByRequestId: "req2" });
  });

  it("closing for revocation sets revokedAt only", () => {
    const closed = closeAdminRequestForReplacementOrRevocation(request(), "revoked", null, NOW);
    expect(closed.status).toBe("revoked");
    expect(closed.revokedAt).toBe(NOW.toISOString());
    expect(closed.replacedByRequestId).toBeNull();
  });
});
