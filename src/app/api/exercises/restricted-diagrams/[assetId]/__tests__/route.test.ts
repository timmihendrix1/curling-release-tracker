import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWISS_CURLING_GUARD_10_ASSET_ID } from "../../../../../../lib/exercises/restrictedAssetCatalog";

const readFileMock = vi.hoisted(() => vi.fn());
const resolveUserScopedSupabaseContextMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs/promises", () => ({ readFile: readFileMock }));
vi.mock("../../../../_lib/userScopedSupabaseContext", () => ({
  resolveUserScopedSupabaseContext: resolveUserScopedSupabaseContextMock,
}));

import { GET, resolveClosedBetaExerciseTeamId } from "../route";

const TEAM_ID = "11111111-1111-4111-8111-111111111111";

function clientWithMembership(result: { data: unknown; error: unknown }) {
  const limit = vi.fn(async () => result);
  const secondEq = vi.fn(() => ({ limit }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, select, firstEq, secondEq, limit };
}

async function call(assetId = SWISS_CURLING_GUARD_10_ASSET_ID) {
  return GET(new Request(`https://app.example.test/api/asset/${assetId}`), {
    params: Promise.resolve({ assetId }),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("restricted Exercise diagram route", () => {
  it("accepts only a canonical configured Team UUID", () => {
    expect(resolveClosedBetaExerciseTeamId(TEAM_ID)).toBe(TEAM_ID);
    for (const value of [undefined, "", "team-1", `${TEAM_ID}/x`]) {
      expect(resolveClosedBetaExerciseTeamId(value)).toBeNull();
    }
  });

  it("fails before authentication for an unknown asset or absent Team config", async () => {
    vi.stubEnv("CLOSED_BETA_EXERCISE_ASSET_TEAM_ID", TEAM_ID);
    expect((await call("unknown-asset")).status).toBe(404);
    expect(resolveUserScopedSupabaseContextMock).not.toHaveBeenCalled();

    vi.stubEnv("CLOSED_BETA_EXERCISE_ASSET_TEAM_ID", "");
    expect((await call()).status).toBe(404);
    expect(resolveUserScopedSupabaseContextMock).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("preserves the authenticated route boundary's refusal", async () => {
    vi.stubEnv("CLOSED_BETA_EXERCISE_ASSET_TEAM_ID", TEAM_ID);
    resolveUserScopedSupabaseContextMock.mockReturnValue({ ok: false, reason: "unauthenticated" });
    expect((await call()).status).toBe(401);
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("refuses callers without a proven active membership and never reads the asset", async () => {
    vi.stubEnv("CLOSED_BETA_EXERCISE_ASSET_TEAM_ID", TEAM_ID);
    for (const result of [
      { data: [], error: null },
      { data: null, error: { message: "provider detail" } },
    ]) {
      const membership = clientWithMembership(result);
      resolveUserScopedSupabaseContextMock.mockReturnValue({
        ok: true,
        client: membership.client,
      });
      const response = await call();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: "Restricted diagram unavailable.",
      });
      expect(readFileMock).not.toHaveBeenCalled();
    }
  });

  it("returns the exact private PNG only after active Team membership is visible through RLS", async () => {
    vi.stubEnv("CLOSED_BETA_EXERCISE_ASSET_TEAM_ID", TEAM_ID);
    const membership = clientWithMembership({ data: [{ id: "membership" }], error: null });
    resolveUserScopedSupabaseContextMock.mockReturnValue({
      ok: true,
      client: membership.client,
    });
    const png = Uint8Array.from([137, 80, 78, 71]);
    readFileMock.mockResolvedValue(png);

    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    expect(membership.from).toHaveBeenCalledWith("team_memberships");
    expect(membership.firstEq).toHaveBeenCalledWith("team_id", TEAM_ID);
    expect(membership.secondEq).toHaveBeenCalledWith("status", "active");
    expect(readFileMock).toHaveBeenCalledWith(
      path.join(
        process.cwd(),
        "restricted-assets",
        "exercises",
        "swiss-curling-guard-exercise-10-v2.png"
      )
    );
  });

  it("fails closed without exposing filesystem or thrown details", async () => {
    vi.stubEnv("CLOSED_BETA_EXERCISE_ASSET_TEAM_ID", TEAM_ID);
    const membership = clientWithMembership({ data: [{ id: "membership" }], error: null });
    resolveUserScopedSupabaseContextMock.mockReturnValue({
      ok: true,
      client: membership.client,
    });
    readFileMock.mockRejectedValue(new Error("/private/asset/path.png"));

    const response = await call();
    expect(response.status).toBe(500);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toBe('{"error":"Restricted diagram unavailable."}');
    expect(serialized).not.toContain("path");
  });
});
