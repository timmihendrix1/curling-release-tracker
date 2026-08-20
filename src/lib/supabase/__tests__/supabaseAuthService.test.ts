// @vitest-environment jsdom
//
// Direct tests for supabaseAuthService.ts — the one file (with
// supabaseClient.ts) permitted to call the real Supabase SDK. No network:
// the Supabase browser client itself is mocked at the narrow client
// boundary (getSupabaseBrowserClient), so createSupabaseAuthService runs its
// real mapping/error-normalization logic against a fully controllable fake
// client, never a real SupabaseClient or a real Supabase project.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfiguredCloudConfig } from "../config";

const { fakeClient, getSupabaseBrowserClientMock } = vi.hoisted(() => {
  const fakeClient = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    },
  };
  return { fakeClient, getSupabaseBrowserClientMock: vi.fn(() => fakeClient) };
});

vi.mock("../supabaseClient", () => ({
  getSupabaseBrowserClient: getSupabaseBrowserClientMock,
}));

// Vitest hoists the vi.mock call above this static import too, so
// createSupabaseAuthService always sees the mocked ../supabaseClient.
import { createSupabaseAuthService } from "../supabaseAuthService";

const CONFIG: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

const ACCESS_TOKEN = "fake-access-token-must-never-leak";
const REFRESH_TOKEN = "fake-refresh-token-must-never-leak";
const OTP_TOKEN = "654321";

function fakeSession(overrides: { id?: string; email?: string | undefined } = {}) {
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id: overrides.id ?? "user-1",
      email: overrides.email === undefined ? "a@example.com" : overrides.email,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSupabaseBrowserClientMock.mockImplementation(() => fakeClient);
});

describe("createSupabaseAuthService — getSession", () => {
  it("maps no session to authOk(null)", async () => {
    fakeClient.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.getSession();
    expect(result).toEqual({ ok: true, value: null });
  });

  it("maps a session to only accountScopeId and email — nothing else", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: fakeSession({ id: "user-42", email: "person@example.com" }) },
      error: null,
    });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.getSession();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ accountScopeId: "user-42", email: "person@example.com" });
      expect(Object.keys(result.value!).sort()).toEqual(["accountScopeId", "email"]);
    }
  });

  it("never lets raw Session/User/token data reach the returned identity", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: fakeSession() },
      error: null,
    });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.getSession();
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(REFRESH_TOKEN);
    expect(serialized).not.toContain("aud");
    expect(serialized).not.toContain("app_metadata");
  });

  it("normalizes a provider error to session_restore_failed, without leaking it", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: "some internal provider detail", status: 500 },
    });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.getSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("session_restore_failed");
      expect(result.error.message).not.toContain("some internal provider detail");
    }
  });

  it("normalizes a thrown getSession() call to a non-fatal error", async () => {
    fakeClient.auth.getSession.mockRejectedValue(new Error("network exploded"));
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.getSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("temporarily_unavailable");
      expect(result.error.message).not.toContain("network exploded");
    }
  });
});

describe("createSupabaseAuthService — requestEmailOtp", () => {
  it("calls signInWithOtp with the exact email it was given, verbatim", async () => {
    fakeClient.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    const service = createSupabaseAuthService(CONFIG);

    await service.requestEmailOtp("User.Name@Example.COM");
    expect(fakeClient.auth.signInWithOtp).toHaveBeenCalledWith({ email: "User.Name@Example.COM" });
  });

  it("normalizes a provider error to request_failed", async () => {
    fakeClient.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "rate limited", status: 429 },
    });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.requestEmailOtp("a@example.com");
    expect(result).toEqual({
      ok: false,
      error: { kind: "request_failed", message: expect.any(String) },
    });
    expect(JSON.stringify(result)).not.toContain("rate limited");
  });

  it("normalizes a thrown signInWithOtp() call to a non-fatal error", async () => {
    fakeClient.auth.signInWithOtp.mockRejectedValue(new Error("boom"));
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.requestEmailOtp("a@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("temporarily_unavailable");
  });
});

describe("createSupabaseAuthService — verifyEmailOtp", () => {
  it("calls verifyOtp with exactly { email, token, type: 'email' }", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: fakeSession(), user: fakeSession().user },
      error: null,
    });
    const service = createSupabaseAuthService(CONFIG);

    await service.verifyEmailOtp("a@example.com", OTP_TOKEN);
    expect(fakeClient.auth.verifyOtp).toHaveBeenCalledWith({
      email: "a@example.com",
      token: OTP_TOKEN,
      type: "email",
    });
  });

  it("returns the minimal identity on successful verification", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: fakeSession({ id: "user-7", email: "seven@example.com" }) },
      error: null,
    });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.verifyEmailOtp("seven@example.com", OTP_TOKEN);
    expect(result).toEqual({
      ok: true,
      value: { accountScopeId: "user-7", email: "seven@example.com" },
    });
  });

  it("fails deterministically when the provider returns no error but also no session", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.verifyEmailOtp("a@example.com", OTP_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("verification_failed");
  });

  it("normalizes a provider verification error", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: "Token has expired or is invalid", status: 403 },
    });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.verifyEmailOtp("a@example.com", OTP_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("verification_failed");
      expect(result.error.message).not.toContain("Token has expired");
    }
  });

  it("normalizes a thrown verifyOtp() call to a non-fatal error", async () => {
    fakeClient.auth.verifyOtp.mockRejectedValue(new Error("boom"));
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.verifyEmailOtp("a@example.com", OTP_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("temporarily_unavailable");
  });
});

describe("createSupabaseAuthService — signOut", () => {
  it("calls signOut with exactly { scope: 'local' }", async () => {
    fakeClient.auth.signOut.mockResolvedValue({ error: null });
    const service = createSupabaseAuthService(CONFIG);

    await service.signOut();
    expect(fakeClient.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("normalizes a provider sign-out error", async () => {
    fakeClient.auth.signOut.mockResolvedValue({ error: { message: "internal", status: 500 } });
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.signOut();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("sign_out_failed");
  });

  it("normalizes a thrown signOut() call to a non-fatal error", async () => {
    fakeClient.auth.signOut.mockRejectedValue(new Error("boom"));
    const service = createSupabaseAuthService(CONFIG);

    const result = await service.signOut();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("temporarily_unavailable");
  });
});

describe("createSupabaseAuthService — onAuthChange", () => {
  function captureListener() {
    let captured: ((event: string, session: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    fakeClient.auth.onAuthStateChange.mockImplementation((listener) => {
      captured = listener;
      return { data: { subscription: { unsubscribe } } };
    });
    return { getListener: () => captured!, unsubscribe };
  }

  it("maps a provider session to the minimal identity", () => {
    const { getListener } = captureListener();
    const service = createSupabaseAuthService(CONFIG);

    const received: Array<{ accountScopeId: string; email: string | null } | null> = [];
    service.onAuthChange((identity) => received.push(identity));

    getListener()("SIGNED_IN", fakeSession({ id: "user-9", email: "nine@example.com" }));
    expect(received).toEqual([{ accountScopeId: "user-9", email: "nine@example.com" }]);
  });

  it("maps a signed-out provider event (null session) to null", () => {
    const { getListener } = captureListener();
    const service = createSupabaseAuthService(CONFIG);

    const received: Array<{ accountScopeId: string; email: string | null } | null> = [];
    service.onAuthChange((identity) => received.push(identity));

    getListener()("SIGNED_OUT", null);
    expect(received).toEqual([null]);
  });

  it("returns a cleanup function that unsubscribes exactly once", () => {
    const { unsubscribe } = captureListener();
    const service = createSupabaseAuthService(CONFIG);

    const cleanup = service.onAuthChange(() => {});
    cleanup();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("createSupabaseAuthService — no sensitive data is ever logged", () => {
  it("never logs the access token, refresh token, provider error, or OTP across every method", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: fakeSession() },
      error: { message: "some provider detail", status: 500 },
    });
    fakeClient.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "some provider detail", status: 500 },
    });
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: fakeSession() },
      error: { message: "some provider detail", status: 500 },
    });
    fakeClient.auth.signOut.mockResolvedValue({ error: { message: "some provider detail", status: 500 } });

    const service = createSupabaseAuthService(CONFIG);
    await service.getSession();
    await service.requestEmailOtp("a@example.com");
    await service.verifyEmailOtp("a@example.com", OTP_TOKEN);
    await service.signOut();

    const sensitive = [ACCESS_TOKEN, REFRESH_TOKEN, OTP_TOKEN, "some provider detail"];
    for (const spy of [logSpy, errorSpy, warnSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const text = typeof arg === "string" ? arg : JSON.stringify(arg);
          for (const value of sensitive) {
            expect(text).not.toContain(value);
          }
        }
      }
    }
  });
});
