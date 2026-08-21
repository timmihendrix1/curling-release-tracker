// Focused unit coverage for src/app/api/team/_lib/context.ts's security-sensitive
// helpers (docs/adr/0022 §Canonical Email Link Origin, §Route Handler Exception
// Boundary): the canonical-origin resolver/link builder (never derived from a
// request), and the strengthened RPC-result shape guards (never accept a row merely
// because it has an id).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAcceptUrl,
  isAdminRequestRow,
  isInvitationCreatedRow,
  resolveAppOriginConfig,
} from "../_lib/context";

const VALID_INVITATION_ROW = {
  id: "inv-1",
  team_id: "team-1",
  email: "invitee@example.com",
  participation_as_player: true,
  proposed_functions: ["coach"],
  status: "pending",
  created_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2026-01-15T00:00:00.000Z",
  accepted_at: null,
  revoked_at: null,
  replaced_by_invitation_id: null,
  email_delivery_status: "pending",
};

const VALID_ADMIN_REQUEST_ROW = {
  id: "req-1",
  team_id: "team-1",
  membership_id: "mem-2",
  status: "pending",
  created_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2026-01-15T00:00:00.000Z",
  accepted_at: null,
  revoked_at: null,
  replaced_by_request_id: null,
};

describe("resolveAppOriginConfig / buildAcceptUrl (docs/adr/0022 §Canonical Email Link Origin)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is not_configured when APP_ORIGIN is unset or blank", () => {
    expect(resolveAppOriginConfig(undefined)).toEqual({ status: "not_configured" });
    expect(resolveAppOriginConfig("   ")).toEqual({ status: "not_configured" });
  });

  it("accepts a bare https origin", () => {
    expect(resolveAppOriginConfig("https://app.example.com")).toEqual({
      status: "configured",
      origin: "https://app.example.com",
    });
  });

  it("accepts http only for localhost/127.0.0.1/::1 (local development)", () => {
    expect(resolveAppOriginConfig("http://localhost:3000").status).toBe("configured");
    expect(resolveAppOriginConfig("http://127.0.0.1:3000").status).toBe("configured");
    expect(resolveAppOriginConfig("http://[::1]:3000").status).toBe("configured");
  });

  it("rejects http for any non-localhost host — production must use https", () => {
    const result = resolveAppOriginConfig("http://app.example.com");
    expect(result.status).toBe("invalid");
  });

  it("rejects a value that is not a bare origin: a path, query, fragment, or embedded credentials", () => {
    expect(resolveAppOriginConfig("https://app.example.com/some/path").status).toBe("invalid");
    expect(resolveAppOriginConfig("https://app.example.com/?x=1").status).toBe("invalid");
    expect(resolveAppOriginConfig("https://app.example.com#frag").status).toBe("invalid");
    expect(resolveAppOriginConfig("https://user:pass@app.example.com").status).toBe("invalid");
    expect(resolveAppOriginConfig("https://app.example.com/").status).toBe("invalid");
  });

  it("rejects an unparseable value", () => {
    expect(resolveAppOriginConfig("not a url at all").status).toBe("invalid");
  });

  it("buildAcceptUrl uses the configured canonical origin, appending the param", () => {
    vi.stubEnv("APP_ORIGIN", "https://app.example.com");
    expect(buildAcceptUrl("inviteToken", "raw-token-value")).toBe(
      "https://app.example.com/?inviteToken=raw-token-value"
    );
  });

  it("buildAcceptUrl returns null (never a fallback origin) when APP_ORIGIN is unset", () => {
    vi.stubEnv("APP_ORIGIN", "");
    expect(buildAcceptUrl("inviteToken", "raw-token-value")).toBeNull();
  });

  it("buildAcceptUrl returns null (never a fallback origin) when APP_ORIGIN is invalid", () => {
    vi.stubEnv("APP_ORIGIN", "http://attacker.example");
    expect(buildAcceptUrl("inviteToken", "raw-token-value")).toBeNull();
  });

  it("buildAcceptUrl never depends on any request/Host value — it takes no request argument at all", () => {
    // Structural proof, not just a behavioral one: the function signature itself
    // cannot read a Host/forwarded-host header, since it is never passed a Request
    // or headers object.
    expect(buildAcceptUrl.length).toBe(2);
  });
});

describe("isInvitationCreatedRow (docs/adr/0022 §Route Handler Exception Boundary)", () => {
  it("accepts a fully-shaped row", () => {
    expect(isInvitationCreatedRow({ invitation: VALID_INVITATION_ROW, raw_token: "secret" })).toBe(true);
  });

  it("rejects a row that has only id and raw_token — not merely 'has an id'", () => {
    expect(isInvitationCreatedRow({ invitation: { id: "inv-1" }, raw_token: "secret" })).toBe(false);
  });

  it("rejects a missing/empty raw_token", () => {
    expect(isInvitationCreatedRow({ invitation: VALID_INVITATION_ROW, raw_token: "" })).toBe(false);
    expect(isInvitationCreatedRow({ invitation: VALID_INVITATION_ROW })).toBe(false);
  });

  it("rejects wrong field types", () => {
    expect(isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, participation_as_player: "true" }, raw_token: "secret" })).toBe(
      false
    );
    expect(isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, team_id: 123 }, raw_token: "secret" })).toBe(false);
  });

  it("rejects an invalid status enum value", () => {
    expect(isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, status: "bogus" }, raw_token: "secret" })).toBe(false);
  });

  it("rejects an invalid email_delivery_status enum value", () => {
    expect(
      isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, email_delivery_status: "bogus" }, raw_token: "secret" })
    ).toBe(false);
  });

  it("rejects an unknown or duplicate value in proposed_functions", () => {
    expect(isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, proposed_functions: ["captain"] }, raw_token: "secret" })).toBe(
      false
    );
    expect(
      isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, proposed_functions: ["coach", "coach"] }, raw_token: "secret" })
    ).toBe(false);
  });

  it("rejects a non-parseable timestamp", () => {
    expect(isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, created_at: "not-a-date" }, raw_token: "secret" })).toBe(
      false
    );
  });

  it("accepts a valid null for every explicitly nullable field, and rejects a non-null-non-string value there", () => {
    expect(
      isInvitationCreatedRow({
        invitation: { ...VALID_INVITATION_ROW, accepted_at: null, revoked_at: null, replaced_by_invitation_id: null },
        raw_token: "secret",
      })
    ).toBe(true);
    expect(isInvitationCreatedRow({ invitation: { ...VALID_INVITATION_ROW, accepted_at: 12345 }, raw_token: "secret" })).toBe(false);
  });
});

describe("isAdminRequestRow (docs/adr/0022 §Route Handler Exception Boundary)", () => {
  it("accepts a fully-shaped row", () => {
    expect(isAdminRequestRow(VALID_ADMIN_REQUEST_ROW)).toBe(true);
  });

  it("rejects a row containing only id — not merely 'has an id'", () => {
    expect(isAdminRequestRow({ id: "req-1" })).toBe(false);
  });

  it("rejects wrong field types", () => {
    expect(isAdminRequestRow({ ...VALID_ADMIN_REQUEST_ROW, membership_id: 42 })).toBe(false);
  });

  it("rejects an invalid status enum value", () => {
    expect(isAdminRequestRow({ ...VALID_ADMIN_REQUEST_ROW, status: "bogus" })).toBe(false);
  });

  it("rejects a non-parseable timestamp", () => {
    expect(isAdminRequestRow({ ...VALID_ADMIN_REQUEST_ROW, expires_at: "not-a-date" })).toBe(false);
  });

  it("accepts null for every explicitly nullable field, and rejects a non-null-non-string value there", () => {
    expect(
      isAdminRequestRow({ ...VALID_ADMIN_REQUEST_ROW, accepted_at: null, revoked_at: null, replaced_by_request_id: null })
    ).toBe(true);
    expect(isAdminRequestRow({ ...VALID_ADMIN_REQUEST_ROW, revoked_at: false })).toBe(false);
  });
});
