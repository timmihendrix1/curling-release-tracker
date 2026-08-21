// Focused coverage for SupabaseTeamService.listAdminRequestsForTeam (docs/adr/0022
// §Team-Side Admin Request Read Model, correction item 2). Before this correction,
// this method performed a plain RLS-scoped `select` on `team_admin_requests`, which
// is NOT a genuinely admin-only boundary (the RLS policy also permits the nominee to
// see their own row) — the fix routes it through a dedicated, admin-only
// `list_admin_requests_for_team` RPC instead. This test proves the method now calls
// that RPC (never a raw table select) and maps its rows the same way as before.
import { describe, expect, it, vi } from "vitest";
import { SupabaseTeamService } from "../supabaseTeamService";

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
    const service = new SupabaseTeamService(client);

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
    const service = new SupabaseTeamService(client);

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
    const service = new SupabaseTeamService(client);

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
