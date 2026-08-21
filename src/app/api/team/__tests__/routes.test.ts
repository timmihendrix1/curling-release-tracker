// Route Handler tests for the five email-involving Team Foundation mutations
// (docs/adr/0022 Decision 11). These exercise the handlers directly (no real Next.js
// server, no real Supabase/Postgres) by mocking the two seams every handler depends on:
// the user-scoped Supabase client factory (supabaseServerClient.ts) and the outbound
// email boundary (smtpEmailService.ts's createSmtpEmailServiceFromEnv). This is the
// coverage flagged as missing in the pre-existing audit of this feature — there was
// previously no test at all for anything under src/app/api/team/.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireProfileMock = vi.fn();
const configMock = vi.fn();
const smtpFactoryMock = vi.fn();

vi.mock("../../../../lib/supabase/supabaseServerClient", () => ({
  createUserScopedServerClient: (...args: unknown[]) => requireProfileMock(...args),
  extractBearerToken: (request: Request) => {
    const header = request.headers.get("authorization");
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1] : null;
  },
}));

vi.mock("../../../../lib/supabase/config", () => ({
  resolveCloudConfig: () => configMock(),
}));

vi.mock("../../../../lib/email/smtpEmailService", async () => {
  const actual = await vi.importActual<typeof import("../../../../lib/email/smtpEmailService")>(
    "../../../../lib/email/smtpEmailService"
  );
  return { ...actual, createSmtpEmailServiceFromEnv: () => smtpFactoryMock() };
});

type FakeRpcResult = { data: unknown; error: { message: string } | null };
type FakeClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<FakeRpcResult>;
  from: (table: string) => {
    select: () => { eq: () => { maybeSingle: () => Promise<{ data: unknown; error: null }> } };
  };
};

function makeFakeClient(opts: {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<FakeRpcResult>;
  teamName?: string;
}): FakeClient {
  return {
    rpc: opts.rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.teamName ? { name: opts.teamName } : null, error: null }),
        }),
      }),
    }),
  };
}

function authedRequest(body?: unknown): Request {
  return new Request("http://localhost/api/team/x", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const invitationRow = {
  invitation: {
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
  },
  raw_token: "raw-secret-token",
};

const adminRequestRow = {
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

beforeEach(() => {
  requireProfileMock.mockReset();
  configMock.mockReset();
  configMock.mockReturnValue({ status: "configured", url: "https://x.supabase.co", publishableKey: "sb_publishable_xxxxxxxxxx" });
  smtpFactoryMock.mockReset();
  smtpFactoryMock.mockReturnValue(null);
  // The one canonical email-link origin (docs/adr/0022 §Canonical Email Link
  // Origin) — most tests below need this configured to exercise the actual send
  // path; the dedicated "canonical origin" describe block below overrides/unsets it
  // to prove the absent/invalid/attacker-controlled-Host cases.
  vi.stubEnv("APP_ORIGIN", "https://app.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/team/invitations", () => {
  it("rejects an unauthenticated request without touching the client factory", async () => {
    const { POST } = await import("../invitations/route");
    const response = await POST(new Request("http://localhost/api/team/x", { method: "POST", body: "{}" }));
    expect(response.status).toBe(401);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/^forbidden:/);
    expect(requireProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a malformed body", async () => {
    const { POST } = await import("../invitations/route");
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc: vi.fn() }));
    const response = await POST(authedRequest({ teamId: "team-1" }));
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/^invalid_input:/);
  });

  it("creates an invitation, reports emailSent:false with no SMTP configured, and never leaks the raw token", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: { id: "profile-1", display_name: "Alex", created_at: "x", updated_at: "x" }, error: null };
      if (name === "record_invitation_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: ["coach"] })
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { invitation: { emailDeliveryStatus: string }; emailSent: boolean };
    expect(json.emailSent).toBe(false);
    expect(json.invitation.emailDeliveryStatus).toBe("failed");
    expect(JSON.stringify(json)).not.toContain("raw-secret-token");
    expect(rpc).toHaveBeenCalledWith("record_invitation_email_delivery", { p_invitation_id: "inv-1", p_delivered: false });
  });

  it("logs (but does not fail the request on) a delivery-recording RPC failure — the mutation and send already completed", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery")
        return { data: null, error: { message: "connection reset by peer" } };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: ["coach"] })
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { invitation: { id: string } };
    expect(json.invitation.id).toBe("inv-1");
    // Only a stable, hard-coded label is ever logged — never the raw provider error
    // message, and never any value read off the error object at all (docs/adr/0022
    // §Sanitized Operational Logging, fourth pass): a plain `{ message }`-shaped RPC
    // error (not an Error instance) has provider-error SHAPE, so it categorizes as
    // "provider_error" — the message's own text is never read or logged.
    expect(consoleErrorSpy).toHaveBeenCalledWith("record_invitation_email_delivery failed:", "provider_error");
    expect(consoleErrorSpy.mock.calls.flat()).not.toContain("connection reset by peer");
    consoleErrorSpy.mockRestore();
  });

  it("reports emailSent:true and passes an accept link built from the canonical APP_ORIGIN — never the request's own origin", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const sendTeamInvitation = vi.fn(async (input: { acceptUrl: string }) => {
      void input;
      return { ok: true };
    });
    smtpFactoryMock.mockReturnValue({ sendTeamInvitation });

    const { POST } = await import("../invitations/route");
    // The request's own URL is a completely different host than APP_ORIGIN
    // (stubbed to https://app.example.com in beforeEach) — proving the link is
    // built from the configured canonical origin, never this request.
    const request = new Request("http://attacker.example/api/team/x", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token",
        host: "attacker.example",
        "x-forwarded-host": "attacker.example",
      },
      body: JSON.stringify({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: ["coach"] }),
    });
    const response = await POST(request);
    const json = (await response.json()) as { emailSent: boolean };
    expect(json.emailSent).toBe(true);
    expect(sendTeamInvitation).toHaveBeenCalledTimes(1);
    const sentInput = sendTeamInvitation.mock.calls[0][0];
    expect(sentInput.acceptUrl).toBe("https://app.example.com/?inviteToken=raw-secret-token");
  });

  it("passes through an RPC failure as an honest, non-2xx error without fabricating success", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "last_admin_invariant: At least one active Team Admin must remain." } }));
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(409);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("last_admin_invariant: At least one active Team Admin must remain.");
  });

  it("never leaks a raw/unrecognized provider error verbatim — sanitizes to unexpected_error", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "team_memberships_one_active_per_profile"' },
    }));
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
    expect(json.error).not.toContain("constraint");
    expect(json.error).not.toContain("team_memberships");
  });

  it("rejects a proposedFunctions array containing an unknown value", async () => {
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc: vi.fn() }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: ["captain"] })
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/^invalid_input:/);
  });

  it("rejects a proposedFunctions array containing a duplicate value", async () => {
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc: vi.fn() }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: ["coach", "coach"] })
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/^invalid_input:/);
  });

  it("rejects a null proposedFunctions field", async () => {
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc: vi.fn() }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: null })
    );
    expect(response.status).toBe(400);
    const json = (await response.json()) as { error: string };
    expect(json.error).toMatch(/^invalid_input:/);
  });

  it("turns a REJECTED (not merely resolved-error) primary mutation RPC promise into a stable, sanitized 500", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
    expect(json.error).not.toContain("socket hang up");
    consoleErrorSpy.mockRestore();
  });

  it("fails closed with unexpected_error on a malformed successful RPC result, without leaking the raw row", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: { not_an_invitation: true }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
  });

  it("fails closed on invitation data containing only id and raw_token — not merely 'has an id' (docs/adr/0022 §Route Handler Exception Boundary, third pass)", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation")
        return { data: { invitation: { id: "inv-1" }, raw_token: "some-secret" }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
    const rawText = JSON.stringify(json);
    expect(rawText).not.toContain("some-secret");
    expect(rawText).not.toContain("inv-1");
  });

  it("fails closed on invitation data with wrong field types and an invalid enum value", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation")
        return {
          data: {
            invitation: {
              id: "inv-1",
              team_id: "team-1",
              email: "invitee@example.com",
              participation_as_player: "yes", // wrong type — must be boolean
              proposed_functions: ["coach"],
              status: "not_a_real_status", // invalid enum value
              created_at: "2026-01-01T00:00:00.000Z",
              expires_at: "2026-01-15T00:00:00.000Z",
              accepted_at: null,
              revoked_at: null,
              replaced_by_invitation_id: null,
              email_delivery_status: "pending",
            },
            raw_token: "some-secret",
          },
          error: null,
        };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
  });

  it("a rejected metadata-lookup promise (get_my_profile) never fails the route — the durable mutation still succeeds", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") throw new Error("network blip");
      if (name === "record_invitation_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { invitation: { id: string } };
    expect(json.invitation.id).toBe("inv-1");
    consoleErrorSpy.mockRestore();
  });

  it("an EmailService rejection (despite its documented never-throw contract) never fails the route — reports emailSent:false honestly", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const sendTeamInvitation = vi.fn(async () => {
      throw new Error("smtp connection refused");
    });
    smtpFactoryMock.mockReturnValue({ sendTeamInvitation });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { emailSent: boolean; invitation: { emailDeliveryStatus: string } };
    expect(json.emailSent).toBe(false);
    expect(json.invitation.emailDeliveryStatus).toBe("failed");
    expect(sendTeamInvitation).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("a REJECTED delivery-recording RPC promise (not merely a resolved error) is logged and never fails the route", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") throw new Error("connection pool exhausted, host db.internal:5432, user app_role");
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { invitation: { id: string } };
    expect(json.invitation.id).toBe("inv-1");
    // A thrown Error's own message (which could embed host/credential detail, as
    // here) is never logged — only the hard-coded "Error" literal, never anything
    // read off the error object itself (docs/adr/0022 §Sanitized Operational
    // Logging, fourth pass).
    expect(consoleErrorSpy).toHaveBeenCalledWith("record_invitation_email_delivery failed:", "Error");
    const loggedText = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain("db.internal");
    expect(loggedText).not.toContain("connection pool exhausted");
    consoleErrorSpy.mockRestore();
  });

  it("a sensitive value placed in an Error's own name, or in a plain error object's code/status, is never logged (docs/adr/0022 §Sanitized Operational Logging, fourth pass)", async () => {
    const sensitiveToken = "rawInvitationToken123abcXYZ";
    const overwrittenNameError = new Error("generic");
    overwrittenNameError.name = sensitiveToken;
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") throw overwrittenNameError;
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(200);
    // Overwriting .name to a token-shaped string must not change the categorization
    // or leak the token — it is still just "an Error instance" to safeErrorCategory.
    expect(consoleErrorSpy).toHaveBeenCalledWith("record_invitation_email_delivery failed:", "Error");
    const loggedText = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain(sensitiveToken);
    consoleErrorSpy.mockRestore();
  });

  it("a sensitive value in a resolved RPC error's code/status field is never logged", async () => {
    const sensitiveCode = "sb_secret_abcdef0123456789";
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery")
        return { data: null, error: { message: "failed", code: sensitiveCode, status: "482913" } };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith("record_invitation_email_delivery failed:", "provider_error");
    const loggedText = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain(sensitiveCode);
    expect(loggedText).not.toContain("482913");
    consoleErrorSpy.mockRestore();
  });

  it("a hostile Proxy rejection (whose getPrototypeOf/has traps throw) after a successful mutation never escapes the route — it still returns the honest success response (docs/adr/0022 §Sanitized Operational Logging, fifth pass)", async () => {
    const sensitiveToken = "rawInvitationToken123abcXYZ";
    const hostileRejection = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(`proxy trap escaped: ${sensitiveToken}`);
        },
        has() {
          throw new Error(`proxy trap escaped: ${sensitiveToken}`);
        },
      }
    );
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") throw hostileRejection;
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: [] })
    );
    // The durable mutation already succeeded — a hostile rejection in the
    // best-effort delivery-recording step must never turn that into a failure.
    expect(response.status).toBe(200);
    const json = (await response.json()) as { invitation: { id: string } };
    expect(json.invitation.id).toBe("inv-1");
    // Classification of the hostile Proxy itself failed closed to "unknown_error" —
    // never a thrown exception escaping to the route, and never the trap's own
    // message (which embeds the sensitive token) logged anywhere.
    expect(consoleErrorSpy).toHaveBeenCalledWith("record_invitation_email_delivery failed:", "unknown_error");
    const loggedText = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain(sensitiveToken);
    expect(loggedText).not.toContain("proxy trap escaped");
    consoleErrorSpy.mockRestore();
  });

  it("a synchronous SMTP factory throw after a successful mutation never fails the route — the mutation is reported honestly", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    smtpFactoryMock.mockImplementation(() => {
      throw new Error("SMTP_HOST resolved to an unreachable configuration object");
    });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../invitations/route");
    const response = await POST(
      authedRequest({ teamId: "team-1", email: "invitee@example.com", participationAsPlayer: true, proposedFunctions: ["coach"] })
    );
    expect(response.status).toBe(200);
    const json = (await response.json()) as { invitation: { id: string; emailDeliveryStatus: string }; emailSent: boolean };
    expect(json.invitation.id).toBe("inv-1");
    expect(json.emailSent).toBe(false);
    expect(json.invitation.emailDeliveryStatus).toBe("failed");
    consoleErrorSpy.mockRestore();
  });
});

describe("POST /api/team/invitations/[id]/resend", () => {
  it("resends using the existing invitation's own fields, with no request body required", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "resend_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const { POST } = await import("../invitations/[id]/resend/route");
    const response = await POST(authedRequest({}), { params: Promise.resolve({ id: "inv-1" }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("resend_invitation", { p_invitation_id: "inv-1" });
  });
});

describe("POST /api/team/invitations/[id]/revise", () => {
  it("revises with a new proposal and rejects a malformed body", async () => {
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc: vi.fn() }));
    const { POST } = await import("../invitations/[id]/revise/route");
    const response = await POST(authedRequest({ email: "x@example.com" }), { params: Promise.resolve({ id: "inv-1" }) });
    expect(response.status).toBe(400);
  });

  it("rejects a duplicate or unknown proposedFunctions value", async () => {
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc: vi.fn() }));
    const { POST } = await import("../invitations/[id]/revise/route");
    const duplicate = await POST(
      authedRequest({ email: "x@example.com", participationAsPlayer: false, proposedFunctions: ["coach", "coach"] }),
      { params: Promise.resolve({ id: "inv-1" }) }
    );
    expect(duplicate.status).toBe(400);
    const unknown = await POST(
      authedRequest({ email: "x@example.com", participationAsPlayer: false, proposedFunctions: ["captain"] }),
      { params: Promise.resolve({ id: "inv-1" }) }
    );
    expect(unknown.status).toBe(400);
  });

  it("calls revise_invitation with the invitation id from the route param", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "revise_invitation") return { data: invitationRow, error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_invitation_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const { POST } = await import("../invitations/[id]/revise/route");
    const response = await POST(
      authedRequest({ email: "invitee@example.com", participationAsPlayer: false, proposedFunctions: [] }),
      { params: Promise.resolve({ id: "inv-1" }) }
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("revise_invitation", {
      p_invitation_id: "inv-1",
      p_email: "invitee@example.com",
      p_participation_as_player: false,
      p_functions: [],
    });
  });
});

describe("POST /api/team/admin-requests", () => {
  it("creates an admin request and emails the nominee found via get_team_member_emails", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_admin_request") return { data: adminRequestRow, error: null };
      if (name === "get_team_member_emails")
        return { data: [{ membership_id: "mem-2", email: "nominee@example.com" }], error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_admin_request_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const sendAdminRequest = vi.fn(async (input: { toEmail: string }) => {
      void input;
      return { ok: true };
    });
    smtpFactoryMock.mockReturnValue({ sendAdminRequest });

    const { POST } = await import("../admin-requests/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-2" }));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { emailSent: boolean; request: { id: string } };
    expect(json.emailSent).toBe(true);
    expect(json.request.id).toBe("req-1");
    expect(sendAdminRequest).toHaveBeenCalledTimes(1);
    const sentInput = sendAdminRequest.mock.calls[0][0];
    expect(sentInput.toEmail).toBe("nominee@example.com");
  });

  it("never sends an email if the nominee's email cannot be found, and still returns the created request", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_admin_request") return { data: adminRequestRow, error: null };
      if (name === "get_team_member_emails") return { data: [], error: null };
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_admin_request_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    smtpFactoryMock.mockReturnValue({ sendAdminRequest: vi.fn(async () => ({ ok: true })) });

    const { POST } = await import("../admin-requests/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-2" }));
    const json = (await response.json()) as { emailSent: boolean };
    expect(json.emailSent).toBe(false);
  });

  it("a rejected get_team_member_emails promise never fails the route — the request was already created durably", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_admin_request") return { data: adminRequestRow, error: null };
      if (name === "get_team_member_emails") throw new Error("network blip");
      if (name === "get_my_profile") return { data: null, error: null };
      if (name === "record_admin_request_email_delivery") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    smtpFactoryMock.mockReturnValue({ sendAdminRequest: vi.fn(async () => ({ ok: true })) });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../admin-requests/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-2" }));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { emailSent: boolean; request: { id: string } };
    expect(json.request.id).toBe("req-1");
    expect(json.emailSent).toBe(false);
    consoleErrorSpy.mockRestore();
  });

  it("fails closed with unexpected_error on a malformed create_admin_request result", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_admin_request") return { data: { nope: true }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../admin-requests/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-2" }));
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
  });

  it("fails closed on admin-request data containing only id — not merely 'has an id' (docs/adr/0022 §Route Handler Exception Boundary, third pass)", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_admin_request") return { data: { id: "req-1" }, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../admin-requests/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-2" }));
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
    expect(JSON.stringify(json)).not.toContain("req-1");
  });

  it("fails closed on admin-request data with an invalid status enum value", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "create_admin_request")
        return {
          data: {
            id: "req-1",
            team_id: "team-1",
            membership_id: "mem-2",
            status: "not_a_real_status",
            created_at: "2026-01-01T00:00:00.000Z",
            expires_at: "2026-01-15T00:00:00.000Z",
            accepted_at: null,
            revoked_at: null,
            replaced_by_request_id: null,
          },
          error: null,
        };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const { POST } = await import("../admin-requests/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-2" }));
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
  });
});

describe("POST /api/team/members/remove", () => {
  it("looks up the member's email before removal and reports notificationEmailSent honestly", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_team_member_emails")
        return { data: [{ membership_id: "mem-3", email: "removed@example.com" }], error: null };
      if (name === "remove_member") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const sendMemberRemovalNotice = vi.fn(async () => ({ ok: true }));
    smtpFactoryMock.mockReturnValue({ sendMemberRemovalNotice });

    const { POST } = await import("../members/remove/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-3" }));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { notificationEmailSent: boolean };
    expect(json.notificationEmailSent).toBe(true);
    expect(sendMemberRemovalNotice).toHaveBeenCalledWith({ toEmail: "removed@example.com", teamName: "The Curlers" });
  });

  it("propagates the last-admin-invariant failure from remove_member without sending a notice", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_team_member_emails")
        return { data: [{ membership_id: "mem-3", email: "removed@example.com" }], error: null };
      if (name === "remove_member")
        return { data: null, error: { message: "last_admin_invariant: At least one active Team Admin must remain." } };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const sendMemberRemovalNotice = vi.fn(async () => ({ ok: true }));
    smtpFactoryMock.mockReturnValue({ sendMemberRemovalNotice });

    const { POST } = await import("../members/remove/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-3" }));
    expect(response.status).toBe(409);
    expect(sendMemberRemovalNotice).not.toHaveBeenCalled();
  });

  it("a rejected get_team_member_emails promise never blocks the removal — it just means no notice can be sent", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_team_member_emails") throw new Error("network blip");
      if (name === "remove_member") return { data: null, error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc, teamName: "The Curlers" }));
    const sendMemberRemovalNotice = vi.fn(async () => ({ ok: true }));
    smtpFactoryMock.mockReturnValue({ sendMemberRemovalNotice });
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../members/remove/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-3" }));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { notificationEmailSent: boolean };
    expect(json.notificationEmailSent).toBe(false);
    expect(sendMemberRemovalNotice).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("turns a REJECTED remove_member RPC promise into a stable 500, never an uncontrolled response", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "get_team_member_emails") return { data: [], error: null };
      if (name === "remove_member") throw new Error("socket hang up");
      throw new Error(`unexpected rpc ${name}`);
    });
    requireProfileMock.mockReturnValue(makeFakeClient({ rpc }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { POST } = await import("../members/remove/route");
    const response = await POST(authedRequest({ teamId: "team-1", membershipId: "mem-3" }));
    expect(response.status).toBe(500);
    const json = (await response.json()) as { error: string };
    expect(json.error).toBe("unexpected_error: Something went wrong. Please try again.");
    expect(json.error).not.toContain("socket hang up");
    consoleErrorSpy.mockRestore();
  });
});
