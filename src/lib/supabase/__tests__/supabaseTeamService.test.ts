// Focused coverage for SupabaseTeamService.listAdminRequestsForTeam (docs/adr/0022
// §Team-Side Admin Request Read Model, correction item 2). Before this correction,
// this method performed a plain RLS-scoped `select` on `team_admin_requests`, which
// is NOT a genuinely admin-only boundary (the RLS policy also permits the nominee to
// see their own row) — the fix routes it through a dedicated, admin-only
// `list_admin_requests_for_team` RPC instead. This test proves the method now calls
// that RPC (never a raw table select) and maps its rows the same way as before.
import { describe, expect, it, vi } from "vitest";
import { SupabaseTeamService } from "../supabaseTeamService";
import type {
  AuthorizedRequestOutcome,
  AuthorizedTeamRequest,
  TeamApiRoute,
} from "../authorizedTeamRequest";

/** The service must never construct an authorized request itself, so every test
 * injects one. This default refuses to be called: a test that unexpectedly
 * reaches the route boundary fails loudly instead of silently passing. */
const neverCalled: AuthorizedTeamRequest = async () => {
  throw new Error("no authorized request was expected here");
};

function recordingRequest(outcome: AuthorizedRequestOutcome) {
  const calls: Array<{ route: TeamApiRoute; body: unknown }> = [];
  const request: AuthorizedTeamRequest = async (route, body) => {
    calls.push({ route, body });
    return outcome;
  };
  return { request, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const adminRequestRow = {
  id: "req-1",
  team_id: "team-1",
  membership_id: "mem-2",
  status: "pending",
  created_at: "2026-01-01T00:00:00.000Z",
  expires_at: "2099-01-15T00:00:00.000Z",
  accepted_at: null,
  revoked_at: null,
  replaced_by_request_id: null,
};

describe("SupabaseTeamService.listAdminRequestsForTeam", () => {
  it("calls the dedicated admin-only RPC, never a raw select on team_admin_requests", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_admin_requests_for_team") return { data: [adminRequestRow], error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    const from = vi.fn(() => {
      throw new Error("must not select team_admin_requests directly — use the admin-only RPC");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { rpc, from } as any;
    const service = new SupabaseTeamService(client, neverCalled);

    const result = await service.listAdminRequestsForTeam("team-1");

    expect(rpc).toHaveBeenCalledWith("list_admin_requests_for_team", { p_team_id: "team-1" });
    expect(from).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([expect.objectContaining({ id: "req-1", teamId: "team-1", membershipId: "mem-2" })]);
    }
  });

  it("propagates a forbidden error from the RPC (e.g. a non-admin caller) without falling back to RLS", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "forbidden: You do not have permission to do this." } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { rpc, from: vi.fn() } as any;
    const service = new SupabaseTeamService(client, neverCalled);

    const result = await service.listAdminRequestsForTeam("team-1");
    expect(result).toEqual({ ok: false, error: { kind: "forbidden", message: "You do not have permission to do this." } });
  });

  it("never surfaces an extra column the RPC might (incorrectly) return beyond the narrow TeamAdminRequest shape (docs/adr/0022 §Team-Side Admin Request Read Model, correction item 5)", async () => {
    // Simulates the RPC accidentally being reverted to `select *`/a wider composite —
    // the mapper must still only ever produce the narrow, named TeamAdminRequest
    // fields, never pass an extra column like created_by_profile_id through.
    const expandedRow = { ...adminRequestRow, created_by_profile_id: "admin-profile-1" };
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_admin_requests_for_team") return { data: [expandedRow], error: null };
      throw new Error(`unexpected rpc ${name}`);
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { rpc, from: vi.fn() } as any;
    const service = new SupabaseTeamService(client, neverCalled);

    const result = await service.listAdminRequestsForTeam("team-1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value[0]).sort()).toEqual(
        ["id", "teamId", "membershipId", "status", "createdAt", "expiresAt", "acceptedAt", "revokedAt", "replacedByRequestId"].sort()
      );
      expect(result.value[0]).not.toHaveProperty("createdByProfileId");
      expect(result.value[0]).not.toHaveProperty("created_by_profile_id");
    }
  });
});

describe("SupabaseTeamService — the five email-involving mutations go through the authorized-request boundary", () => {
  const invitationRow = {
    id: "inv-1",
    team_id: "team-1",
    email: "invitee@example.com",
    participation_as_player: true,
    proposed_functions: ["coach"],
    status: "pending",
    created_at: "2026-01-01T00:00:00.000Z",
    expires_at: "2099-01-15T00:00:00.000Z",
    accepted_at: null,
    revoked_at: null,
    replaced_by_invitation_id: null,
    email_delivery_status: "sent",
  };

  it("names the closed route (never a path) for each of the five mutations", async () => {
    const cases: Array<[string, (service: SupabaseTeamService) => Promise<unknown>, TeamApiRoute, unknown]> = [
      [
        "createInvitation",
        (service) =>
          service.createInvitation("team-1", {
            email: "invitee@example.com",
            participationAsPlayer: true,
            proposedFunctions: ["coach"],
          }),
        { kind: "createInvitation" },
        {
          teamId: "team-1",
          email: "invitee@example.com",
          participationAsPlayer: true,
          proposedFunctions: ["coach"],
        },
      ],
      [
        "reviseInvitation",
        (service) =>
          service.reviseInvitation("inv-1", {
            email: "invitee@example.com",
            participationAsPlayer: false,
            proposedFunctions: [],
          }),
        { kind: "reviseInvitation", invitationId: "inv-1" },
        { email: "invitee@example.com", participationAsPlayer: false, proposedFunctions: [] },
      ],
      [
        "resendInvitation",
        (service) => service.resendInvitation("inv-1"),
        { kind: "resendInvitation", invitationId: "inv-1" },
        {},
      ],
      [
        "createAdminRequest",
        (service) => service.createAdminRequest("team-1", "mem-2"),
        { kind: "createAdminRequest" },
        { teamId: "team-1", membershipId: "mem-2" },
      ],
      [
        "removeMember",
        (service) => service.removeMember("team-1", "mem-2"),
        { kind: "removeMember" },
        { teamId: "team-1", membershipId: "mem-2" },
      ],
    ];

    for (const [label, invoke, expectedRoute, expectedBody] of cases) {
      const { request, calls } = recordingRequest({
        kind: "response",
        response: jsonResponse({ ok: true }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const service = new SupabaseTeamService({ rpc: vi.fn(), from: vi.fn() } as any, request);

      await invoke(service);

      expect(calls, label).toHaveLength(1);
      expect(calls[0].route, label).toEqual(expectedRoute);
      expect(calls[0].body, label).toEqual(expectedBody);
    }
  });

  it("maps `forbidden` to the existing Team forbidden result", async () => {
    const { request } = recordingRequest({ kind: "forbidden" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new SupabaseTeamService({ rpc: vi.fn(), from: vi.fn() } as any, request);

    expect(await service.removeMember("team-1", "mem-2")).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "You must be signed in." },
    });
  });

  it("maps `network_error` to the existing Team network-error result", async () => {
    const { request } = recordingRequest({ kind: "network_error" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new SupabaseTeamService({ rpc: vi.fn(), from: vi.fn() } as any, request);

    expect(await service.resendInvitation("inv-1")).toEqual({
      ok: false,
      error: {
        kind: "network_error",
        message: "Could not reach the server. Check your connection and try again.",
      },
    });
  });

  it("maps a successful `response` through the existing JSON handling", async () => {
    const payload = { invitation: invitationRow, emailSent: true };
    const { request } = recordingRequest({ kind: "response", response: jsonResponse(payload) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new SupabaseTeamService({ rpc: vi.fn(), from: vi.fn() } as any, request);

    const result = await service.resendInvitation("inv-1");

    expect(result).toEqual({ ok: true, value: payload });
  });

  it("maps a non-OK `response` through the existing Postgres error mapping", async () => {
    const { request } = recordingRequest({
      kind: "response",
      response: jsonResponse({ error: "forbidden: You do not have permission to do this." }, 403),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new SupabaseTeamService({ rpc: vi.fn(), from: vi.fn() } as any, request);

    expect(await service.createAdminRequest("team-1", "mem-2")).toEqual({
      ok: false,
      error: { kind: "forbidden", message: "You do not have permission to do this." },
    });
  });

  it("maps an unreadable response body to unexpected_error", async () => {
    const { request } = recordingRequest({
      kind: "response",
      response: new Response("not json", { status: 200 }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new SupabaseTeamService({ rpc: vi.fn(), from: vi.fn() } as any, request);

    expect(await service.resendInvitation("inv-1")).toEqual({
      ok: false,
      error: { kind: "unexpected_error", message: "Something went wrong. Please try again." },
    });
  });

  it("never reads a session for a route mutation — the client's auth surface is not even touched", async () => {
    const getSession = vi.fn();
    const { request } = recordingRequest({
      kind: "response",
      response: jsonResponse({ notificationEmailSent: true }),
    });
    const service = new SupabaseTeamService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { rpc: vi.fn(), from: vi.fn(), auth: { getSession } } as any,
      request
    );

    await service.removeMember("team-1", "mem-2");

    expect(getSession).not.toHaveBeenCalled();
  });
});
