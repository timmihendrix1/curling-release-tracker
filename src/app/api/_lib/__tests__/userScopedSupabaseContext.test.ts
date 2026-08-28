import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.hoisted(() => vi.fn());
const resolveCloudConfigMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../lib/supabase/supabaseServerClient", () => ({
  extractBearerToken: (request: Request) => {
    const header = request.headers.get("authorization");
    const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
    return match ? match[1].trim() : null;
  },
  createUserScopedServerClient: createClientMock,
}));

vi.mock("../../../../lib/supabase/config", () => ({
  resolveCloudConfig: resolveCloudConfigMock,
}));

import { resolveUserScopedSupabaseContext } from "../userScopedSupabaseContext";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveUserScopedSupabaseContext", () => {
  it("rejects a missing bearer token before reading cloud configuration", () => {
    expect(
      resolveUserScopedSupabaseContext(new Request("https://app.example.test/api/x"))
    ).toEqual({ ok: false, reason: "unauthenticated" });
    expect(resolveCloudConfigMock).not.toHaveBeenCalled();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("returns a domain-neutral not-configured reason", () => {
    resolveCloudConfigMock.mockReturnValue({ status: "cloud_disabled" });
    const request = new Request("https://app.example.test/api/x", {
      headers: { authorization: "Bearer access-token" },
    });
    expect(resolveUserScopedSupabaseContext(request)).toEqual({
      ok: false,
      reason: "not_configured",
    });
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it("creates exactly one client scoped to the caller's bearer token", () => {
    const config = {
      status: "configured",
      url: "https://project.supabase.co",
      publishableKey: "publishable-key",
    };
    const client = { from: vi.fn() };
    resolveCloudConfigMock.mockReturnValue(config);
    createClientMock.mockReturnValue(client);
    const request = new Request("https://app.example.test/api/x", {
      headers: { authorization: "Bearer access-token" },
    });

    expect(resolveUserScopedSupabaseContext(request)).toEqual({ ok: true, client });
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith(config, "access-token");
  });
});
