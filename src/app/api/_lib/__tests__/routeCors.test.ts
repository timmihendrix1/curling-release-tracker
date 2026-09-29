// @vitest-environment node
//
// Every route that a native client may call, exercised through its REAL
// exported handlers (ADR-0047).
//
// `nativeCors.test.ts` proves the helper. This file proves the six routes
// actually use it — that each one answers a preflight without authenticating,
// without an RPC, without a file read and without an email send, and that an
// unapproved cross-origin caller cannot reach the handler body at all.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createUserScopedServerClientMock = vi.fn();
const resolveCloudConfigMock = vi.fn();
const smtpFactoryMock = vi.fn();
const readFileMock = vi.fn();

vi.mock("../../../../lib/supabase/supabaseServerClient", () => ({
  createUserScopedServerClient: (...args: unknown[]) =>
    createUserScopedServerClientMock(...args),
  extractBearerToken: (request: Request) => {
    const header = request.headers.get("authorization");
    if (!header) return null;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match ? match[1] : null;
  },
}));

vi.mock("../../../../lib/supabase/config", () => ({
  resolveCloudConfig: () => resolveCloudConfigMock(),
}));

vi.mock("../../../../lib/email/smtpEmailService", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../lib/email/smtpEmailService")
  >("../../../../lib/email/smtpEmailService");
  return { ...actual, createSmtpEmailServiceFromEnv: () => smtpFactoryMock() };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, default: actual, readFile: (...args: unknown[]) => readFileMock(...args) };
});

const IOS_ORIGIN = "capacitor://localhost";
const ANDROID_ORIGIN = "https://localhost";
const APP_ORIGIN = "https://app.example.test";

/** Every route a native client may reach, with the method it exposes. */
const ROUTES = [
  ["POST /api/team/invitations", () => import("../../team/invitations/route"), "POST"],
  [
    "POST /api/team/invitations/[id]/revise",
    () => import("../../team/invitations/[id]/revise/route"),
    "POST",
  ],
  [
    "POST /api/team/invitations/[id]/resend",
    () => import("../../team/invitations/[id]/resend/route"),
    "POST",
  ],
  ["POST /api/team/admin-requests", () => import("../../team/admin-requests/route"), "POST"],
  ["POST /api/team/members/remove", () => import("../../team/members/remove/route"), "POST"],
  [
    "GET /api/exercises/restricted-diagrams/[assetId]",
    () => import("../../exercises/restricted-diagrams/[assetId]/route"),
    "GET",
  ],
] as const;

type RouteModule = {
  OPTIONS: (request: Request) => Response | Promise<Response>;
  POST?: (request: Request, context?: unknown) => Promise<Response>;
  GET?: (request: Request, context?: unknown) => Promise<Response>;
};

function preflight(origin: string | null, method: string): Request {
  const headers: Record<string, string> = {
    "access-control-request-method": method,
    "access-control-request-headers": "authorization, content-type",
  };
  if (origin !== null) headers.origin = origin;
  return new Request(`${APP_ORIGIN}/api/whatever`, { method: "OPTIONS", headers });
}

function actualRequest(origin: string | null, method: string): Request {
  const headers: Record<string, string> = {
    authorization: "Bearer synthetic-token",
    "content-type": "application/json",
  };
  if (origin !== null) headers.origin = origin;
  return new Request(`${APP_ORIGIN}/api/whatever`, {
    method,
    headers,
    body: method === "GET" ? undefined : "{}",
  });
}

const dynamicContext = {
  params: Promise.resolve({ id: "inv-1", assetId: "not-a-real-asset" }),
};

beforeEach(() => {
  createUserScopedServerClientMock.mockReset();
  resolveCloudConfigMock.mockReset();
  resolveCloudConfigMock.mockReturnValue({
    status: "configured",
    url: "https://project.supabase.test",
    publishableKey: "sb_publishable_syntheticvalue",
  });
  smtpFactoryMock.mockReset();
  smtpFactoryMock.mockReturnValue(null);
  readFileMock.mockReset();
  vi.stubEnv("APP_ORIGIN", APP_ORIGIN);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(ROUTES)("%s", (_label, load, method) => {
  it("exposes an OPTIONS handler", async () => {
    const mod = (await load()) as unknown as RouteModule;
    expect(typeof mod.OPTIONS).toBe("function");
  });

  it.each([IOS_ORIGIN, ANDROID_ORIGIN])("answers a preflight from %s", async (origin) => {
    const mod = (await load()) as unknown as RouteModule;
    const response = await mod.OPTIONS(preflight(origin, method));

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(`${method}, OPTIONS`);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("grants nothing to an unapproved origin's preflight", async () => {
    const mod = (await load()) as unknown as RouteModule;
    const response = await mod.OPTIONS(preflight("https://evil.test", method));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("grants nothing to an Origin of null", async () => {
    const mod = (await load()) as unknown as RouteModule;
    const response = await mod.OPTIONS(preflight("null", method));

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("performs no authentication, RPC, file read or email send during preflight", async () => {
    const mod = (await load()) as unknown as RouteModule;
    await mod.OPTIONS(preflight(IOS_ORIGIN, method));

    expect(createUserScopedServerClientMock).not.toHaveBeenCalled();
    expect(smtpFactoryMock).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
  });

  it("refuses an unapproved cross-origin request without authenticating it", async () => {
    const mod = (await load()) as unknown as RouteModule;
    const handler = method === "GET" ? mod.GET : mod.POST;
    const response = await handler!(actualRequest("https://evil.test", method), dynamicContext);

    expect(response.status).toBe(403);
    // Not merely "the browser would hide it": the handler body never ran, so no
    // mutation, email send or file read could have happened.
    expect(createUserScopedServerClientMock).not.toHaveBeenCalled();
    expect(smtpFactoryMock).not.toHaveBeenCalled();
    expect(readFileMock).not.toHaveBeenCalled();
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("still denies an allowed native origin that presents no bearer token", async () => {
    const mod = (await load()) as unknown as RouteModule;
    const handler = method === "GET" ? mod.GET : mod.POST;
    const request = new Request(`${APP_ORIGIN}/api/whatever`, {
      method,
      headers: { origin: IOS_ORIGIN, "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });

    const response = await handler!(request, dynamicContext);

    // A matching Origin is not authentication and grants no access.
    expect([401, 404]).toContain(response.status);
    expect(createUserScopedServerClientMock).not.toHaveBeenCalled();
  });

  it("carries the CORS grant on an unauthenticated error response", async () => {
    const mod = (await load()) as unknown as RouteModule;
    const handler = method === "GET" ? mod.GET : mod.POST;
    const request = new Request(`${APP_ORIGIN}/api/whatever`, {
      method,
      headers: { origin: IOS_ORIGIN, "content-type": "application/json" },
      body: method === "GET" ? undefined : "{}",
    });

    const response = await handler!(request, dynamicContext);

    // Without this the native client could not read WHY it was denied.
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(IOS_ORIGIN);
    expect(response.headers.get("Vary")).toContain("Origin");
  });

  it("leaves a no-Origin caller working exactly as before", async () => {
    const mod = (await load()) as unknown as RouteModule;
    const handler = method === "GET" ? mod.GET : mod.POST;
    const response = await handler!(actualRequest(null, method), dynamicContext);

    // Reaches the route's own logic rather than the origin refusal.
    expect(response.status).not.toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("leaves ordinary same-origin Web working exactly as before", async () => {
    const mod = (await load()) as unknown as RouteModule;
    const handler = method === "GET" ? mod.GET : mod.POST;
    const response = await handler!(actualRequest(APP_ORIGIN, method), dynamicContext);

    expect(response.status).not.toBe(403);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
