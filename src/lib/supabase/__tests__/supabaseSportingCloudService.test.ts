import { describe, expect, it, vi } from "vitest";
import { createSupabaseSportingCloudService } from "../supabaseSportingCloudService";

const ID = "11111111-1111-4111-8111-111111111111";
const HASH = "a".repeat(64);

function client(response: unknown) {
  return { rpc: vi.fn(async () => response) } as never;
}

describe("Supabase sporting cloud boundary", () => {
  it("maps a valid restore response and rejects duplicate identities", async () => {
    const row = { record_kind: "training_session", record_id: ID, schema_version: 1, payload: "{}", content_sha256: HASH, recorded_at: "2026-08-27T10:00:00Z" };
    const valid = await createSupabaseSportingCloudService(client({ data: [row], error: null })).restore();
    expect(valid.ok).toBe(true);
    const duplicate = await createSupabaseSportingCloudService(client({ data: [row, row], error: null })).restore();
    expect(duplicate).toEqual({ ok: false, error: "invalid_response" });
  });

  it("never forwards raw database error text", async () => {
    const result = await createSupabaseSportingCloudService(client({ data: null, error: { message: "forbidden: sb_secret_detail" } })).restore();
    expect(result).toEqual({ ok: false, error: "forbidden" });
    expect(JSON.stringify(result)).not.toContain("sb_secret_detail");
  });

  it("normalizes thrown provider values without inspecting them", async () => {
    const proxy = new Proxy({}, { get() { throw new Error("secret"); } });
    const result = await createSupabaseSportingCloudService(proxy as never).restore();
    expect(result).toEqual({ ok: false, error: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

