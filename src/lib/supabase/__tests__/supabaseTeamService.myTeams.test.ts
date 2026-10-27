import { describe, expect, it, vi } from "vitest";
import { SupabaseTeamService } from "../supabaseTeamService";
import type { SupabaseClient } from "../supabaseClient";

describe("my Teams versus visible roster memberships", () => {
  it("filters PostgREST by the caller's application Profile, not all rows RLS permits", async () => {
    const eq = vi.fn();
    const query = { select: vi.fn(), eq };
    query.select.mockReturnValue(query);
    eq.mockImplementation((column: string) => column === "status"
      ? Promise.resolve({ data: [], error: null }) : query);
    const rpc = vi.fn(async () => ({ data: { id: "my-profile", display_name: "Athlete", created_at: "2026-10-24" }, error: null }));
    const client = { rpc, from: vi.fn(() => query) } as unknown as SupabaseClient;
    const service = new SupabaseTeamService(client, vi.fn());
    expect(await service.listMyTeams()).toEqual({ ok: true, value: [] });
    expect(rpc).toHaveBeenCalledWith("get_my_profile");
    expect(eq.mock.calls).toEqual([["profile_id", "my-profile"], ["status", "active"]]);
  });

  it("does not query roster rows when the caller has no Profile", async () => {
    const from = vi.fn();
    const client = { rpc: vi.fn(async () => ({ data: null, error: null })), from } as unknown as SupabaseClient;
    const service = new SupabaseTeamService(client, vi.fn());
    const result = await service.listMyTeams();
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
