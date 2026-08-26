// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook, type RenderHookResult } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSupabaseAuthController, type AuthController } from "../useSupabaseAuthController";
import type { AuthState } from "../authState";
import type {
  AccountIdentity,
  AuthService,
  AuthServiceResult,
  NormalizedAuthChange,
  SessionRestoreOutcome,
} from "../authService";
import { authFailed, authOk } from "../authService";
import type { ConfiguredCloudConfig } from "../config";

const CONFIGURED: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

const IDENTITY: AccountIdentity = { accountScopeId: "user-1", email: "a@example.com" };

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A fully controllable AuthService — every method resolves a caller-supplied
 * deferred promise instead of resolving immediately, so tests can assert an
 * intermediate pending state and control completion order precisely. Never
 * touches the network, storage, or any real Supabase project. */
function createFakeAuthService() {
  const listeners = new Set<(change: NormalizedAuthChange) => void>();
  const restoreDeferred = createDeferred<SessionRestoreOutcome>();
  const requestEmailOtpDeferred = createDeferred<AuthServiceResult<void>>();
  const verifyEmailOtpDeferred = createDeferred<AuthServiceResult<AccountIdentity>>();
  const signOutDeferred = createDeferred<AuthServiceResult<void>>();

  const unsubscribeCalls = vi.fn();
  const requestEmailOtp = vi.fn(() => requestEmailOtpDeferred.promise);
  const verifyEmailOtp = vi.fn(() => verifyEmailOtpDeferred.promise);
  const signOut = vi.fn(() => signOutDeferred.promise);
  // Each call returns its OWN unsubscribe closure that removes only that
  // listener — a shared unsubscribe (removing whichever listener happens to
  // be registered at call time) would silently mask a real "two listeners
  // stayed subscribed" bug under StrictMode's double-mount probe.
  const onAuthChange = vi.fn((listener: (change: NormalizedAuthChange) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribeCalls();
    };
  });

  const service: AuthService = {
    restoreSession: vi.fn(() => restoreDeferred.promise),
    onAuthChange,
    requestEmailOtp,
    verifyEmailOtp,
    signOut,
  };

  return {
    service,
    listeners,
    unsubscribe: unsubscribeCalls,
    onAuthChange,
    requestEmailOtp,
    verifyEmailOtp,
    signOut,
    /** TRANSITIONAL (Stage B0.2b): the tests below still express intent as
     * "the session resolved to X" / "it failed"; `AuthService.restoreSession`
     * now speaks ADR-0025 Decision 2's five outcomes, and this one place
     * translates. The five outcomes themselves are exercised directly by the
     * "five restore outcomes" describe block further down, and exhaustively by
     * supabaseAuthService.test.ts. */
    resolveGetSession(result: AuthServiceResult<AccountIdentity | null>) {
      restoreDeferred.resolve(
        result.ok
          ? result.value
            ? { kind: "authenticated", identity: result.value }
            : { kind: "no_session" }
          : { kind: "restore_failed" }
      );
    },
    resolveRestoreSession: restoreDeferred.resolve,
    resolveRequestEmailOtp: requestEmailOtpDeferred.resolve,
    resolveVerifyEmailOtp: verifyEmailOtpDeferred.resolve,
    resolveSignOut: signOutDeferred.resolve,
    fireAuthChanged(identity: AccountIdentity | null) {
      const change: NormalizedAuthChange = identity
        ? { reason: "signed_in", identity }
        : { reason: "signed_out" };
      listeners.forEach((listener) => listener(change));
    },
  };
}

function renderController(fake: ReturnType<typeof createFakeAuthService>) {
  return renderHook(() =>
    useSupabaseAuthController({
      config: CONFIGURED,
      createAuthService: () => fake.service,
    })
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSupabaseAuthController — startup", () => {
  it("resolves cloud_disabled without constructing an AuthService", () => {
    const createAuthService = vi.fn();
    const { result } = renderHook(() =>
      useSupabaseAuthController({ config: { status: "cloud_disabled" }, createAuthService })
    );
    expect(result.current.state).toEqual({ status: "cloud_disabled" });
    expect(createAuthService).not.toHaveBeenCalled();
  });

  it("resolves invalid_configuration without constructing an AuthService", () => {
    const createAuthService = vi.fn();
    const { result } = renderHook(() =>
      useSupabaseAuthController({
        config: { status: "invalid_configuration", reason: "missing_url" },
        createAuthService,
      })
    );
    expect(result.current.state).toEqual({ status: "invalid_configuration" });
    expect(createAuthService).not.toHaveBeenCalled();
  });

  it("a rejected key (e.g. a pasted secret key) resolves invalid_configuration without ever constructing a client", () => {
    const createAuthService = vi.fn();
    const { result } = renderHook(() =>
      useSupabaseAuthController({
        config: { status: "invalid_configuration", reason: "invalid_publishable_key" },
        createAuthService,
      })
    );
    expect(result.current.state).toEqual({ status: "invalid_configuration" });
    expect(createAuthService).not.toHaveBeenCalled();
  });

  it("starts in restoring_session when configured, then resolves signed_out when no session exists", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    expect(result.current.state).toEqual({ status: "restoring_session" });

    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });

    expect(result.current.state).toEqual({ status: "signed_out" });
  });

  it("resolves signed_in when an existing session is restored", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    await act(async () => {
      fake.resolveGetSession(authOk(IDENTITY));
      await Promise.resolve();
    });

    expect(result.current.state).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("resolves recoverable_error when session restoration fails, without throwing", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    await act(async () => {
      fake.resolveGetSession(authFailed({ kind: "session_restore_failed", message: "nope" }));
      await Promise.resolve();
    });

    expect(result.current.state.status).toBe("recoverable_error");
  });

  it("registers exactly one auth-change listener", async () => {
    const fake = createFakeAuthService();
    renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    expect(fake.onAuthChange).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes the listener on unmount", async () => {
    const fake = createFakeAuthService();
    const { unmount } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    unmount();
    expect(fake.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("leaves exactly one active listener under React StrictMode's dev-only double-mount probe", async () => {
    const fake = createFakeAuthService();
    const { result } = renderHook(
      () =>
        useSupabaseAuthController({
          config: CONFIGURED,
          createAuthService: () => fake.service,
        }),
      { wrapper: StrictMode }
    );

    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });

    // StrictMode mounts, cleans up, and remounts once in dev — onAuthChange
    // is called twice, but the first mount's cleanup must unsubscribe it
    // before the second mount subscribes, leaving exactly one.
    expect(fake.listeners.size).toBe(1);
    expect(result.current.state).toEqual({ status: "signed_out" });

    act(() => {
      fake.fireAuthChanged(IDENTITY);
    });
    // If two listeners were still active, this would still only move to one
    // signed_in state (idempotent), but the listener-count assertion above is
    // what actually proves there is no leak.
    expect(result.current.state).toEqual({ status: "signed_in", identity: IDENTITY });
  });
});

describe("useSupabaseAuthController — the five restore outcomes and normalized changes (Stage B0.2b)", () => {
  // The transitional adapter is the whole compatibility surface between
  // ADR-0025 Decision 2/3's closed outcomes and this hook's older state
  // machine. These tests pin every one of its branches, so a later change to
  // either side cannot silently reinterpret an outcome.
  //
  // This hook still never gates the app: none of the states below grants
  // access to anything, and no barrier, attempt or resolution exists yet.
  it("maps `authenticated` to signed_in", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    await act(async () => {
      fake.resolveRestoreSession({ kind: "authenticated", identity: IDENTITY });
      await Promise.resolve();
    });

    expect(result.current.state).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("maps `no_session` to signed_out", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    await act(async () => {
      fake.resolveRestoreSession({ kind: "no_session" });
      await Promise.resolve();
    });

    expect(result.current.state).toEqual({ status: "signed_out" });
  });

  it("maps `invalid_session` to signed_out — never to signed_in, and never to an error to dismiss", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    await act(async () => {
      fake.resolveRestoreSession({ kind: "invalid_session" });
      await Promise.resolve();
    });

    expect(result.current.state).toEqual({ status: "signed_out" });
  });

  it("maps `temporarily_unavailable` to a recoverable error that says so, distinctly from a restore failure", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    await act(async () => {
      fake.resolveRestoreSession({ kind: "temporarily_unavailable" });
      await Promise.resolve();
    });

    const state = result.current.state;
    expect(state.status).toBe("recoverable_error");
    if (state.status === "recoverable_error") {
      expect(state.error.kind).toBe("temporarily_unavailable");
    }
  });

  it("maps `restore_failed` to a recoverable session-restore error", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    await act(async () => {
      fake.resolveRestoreSession({ kind: "restore_failed" });
      await Promise.resolve();
    });

    const state = result.current.state;
    expect(state.status).toBe("recoverable_error");
    if (state.status === "recoverable_error") {
      expect(state.error.kind).toBe("session_restore_failed");
    }
  });

  it("takes the identity from each identity-bearing normalized change, and none from signed_out", async () => {
    const cases: Array<[NormalizedAuthChange, AuthState]> = [
      [{ reason: "signed_in", identity: IDENTITY }, { status: "signed_in", identity: IDENTITY }],
      [{ reason: "token_refreshed", identity: IDENTITY }, { status: "signed_in", identity: IDENTITY }],
      [{ reason: "user_updated", identity: IDENTITY }, { status: "signed_in", identity: IDENTITY }],
      [{ reason: "initial_session", identity: IDENTITY }, { status: "signed_in", identity: IDENTITY }],
      [{ reason: "other", identity: IDENTITY }, { status: "signed_in", identity: IDENTITY }],
      [{ reason: "signed_out" }, { status: "signed_out" }],
      [{ reason: "initial_session", identity: null }, { status: "signed_out" }],
      [{ reason: "other", identity: null }, { status: "signed_out" }],
    ];

    for (const [change, expected] of cases) {
      const fake = createFakeAuthService();
      const { result, unmount } = renderController(fake);
      await act(async () => {
        fake.resolveRestoreSession({ kind: "no_session" });
        await Promise.resolve();
      });

      await act(async () => {
        fake.listeners.forEach((listener) => listener(change));
        await Promise.resolve();
      });

      expect(result.current.state, change.reason).toEqual(expected);
      unmount();
    }
  });
});

describe("useSupabaseAuthController — fail-safe construction and subscription", () => {
  it("a throwing service factory does not throw through the component, and resolves a deterministic non-fatal state", () => {
    const createAuthService = vi.fn(() => {
      throw new Error("boom");
    });
    let threw = false;
    let hookResult: RenderHookResult<AuthController, unknown> | null = null;
    try {
      hookResult = renderHook(() =>
        useSupabaseAuthController({ config: CONFIGURED, createAuthService })
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    const { result } = hookResult!;
    expect(result.current.state.status).toBe("recoverable_error");
    if (result.current.state.status === "recoverable_error") {
      expect(result.current.state.error.kind).toBe("unexpected_error");
      expect(result.current.state.error.message).not.toContain("boom");
    }
  });

  it("dismissing a construction failure returns to signed_out (no automatic retry)", () => {
    const createAuthService = vi.fn(() => {
      throw new Error("boom");
    });
    const { result } = renderHook(() =>
      useSupabaseAuthController({ config: CONFIGURED, createAuthService })
    );

    act(() => {
      result.current.dismissError();
    });
    expect(result.current.state).toEqual({ status: "signed_out" });
    // Still exactly one (failing) construction attempt — no retry loop.
    expect(createAuthService).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener registration does not crash, and resolves a deterministic non-fatal state", async () => {
    const fake = createFakeAuthService();
    fake.onAuthChange.mockImplementation(() => {
      throw new Error("listener boom");
    });

    let threw = false;
    let hookResult: ReturnType<typeof renderController> | null = null;
    try {
      hookResult = renderController(fake);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    const { result } = hookResult!;
    expect(result.current.state.status).toBe("recoverable_error");
    if (result.current.state.status === "recoverable_error") {
      expect(result.current.state.error.kind).toBe("temporarily_unavailable");
      expect(result.current.state.error.message).not.toContain("listener boom");
    }

    // A later, unrelated getSession() completion must not overwrite the
    // subscription failure — the reducer's "only from restoring_session"
    // guard already left "restoring_session" the moment the failure was
    // dispatched, so this resolution is a no-op.
    await act(async () => {
      fake.resolveGetSession(authOk(IDENTITY));
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe("recoverable_error");
  });

  it("a throwing unsubscribe does not throw during unmount, and no stale update occurs after disposal", async () => {
    const fake = createFakeAuthService();
    // Still registers the listener into the trackable set (so firing it
    // below is meaningful), but the returned unsubscribe itself throws.
    fake.onAuthChange.mockImplementation((listener) => {
      fake.listeners.add(listener);
      return () => {
        throw new Error("unsubscribe boom");
      };
    });
    const { result, unmount } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "signed_out" });

    expect(() => unmount()).not.toThrow();

    // Disposal still took effect despite the throwing unsubscribe (guarded
    // by disposedRef, independently of whether unsubscribe itself
    // succeeded): a later auth-change event must not update state.
    fake.fireAuthChanged(IDENTITY);
    expect(result.current.state).toEqual({ status: "signed_out" });
  });
});

describe("useSupabaseAuthController — auth-state subscription", () => {
  it("moves signed_out to signed_in when the provider reports a new session", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "signed_out" });

    act(() => {
      fake.fireAuthChanged(IDENTITY);
    });
    expect(result.current.state).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("moves signed_in to signed_out when the provider reports the session ended", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(IDENTITY));
      await Promise.resolve();
    });

    act(() => {
      fake.fireAuthChanged(null);
    });
    expect(result.current.state).toEqual({ status: "signed_out" });
  });

  it("a stale session-restore completion cannot overwrite a newer auth-change event", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);

    act(() => {
      fake.fireAuthChanged(IDENTITY);
    });
    expect(result.current.state).toEqual({ status: "signed_in", identity: IDENTITY });

    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    // The restore's guard (only applies from "restoring_session") makes this a no-op.
    expect(result.current.state).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("no state update occurs after the component unmounts (disposed session restore)", async () => {
    const fake = createFakeAuthService();
    const { result, unmount } = renderController(fake);
    unmount();

    await act(async () => {
      fake.resolveGetSession(authOk(IDENTITY));
      await Promise.resolve();
    });

    // Still whatever it was pre-unmount — never mutated after disposal, and no
    // "setState on an unmounted component" warning was thrown either.
    expect(result.current.state).toEqual({ status: "restoring_session" });
  });

  it("no state update occurs from an auth event fired after unmount", async () => {
    const fake = createFakeAuthService();
    const { result, unmount } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    unmount();

    fake.fireAuthChanged(IDENTITY);
    expect(result.current.state).toEqual({ status: "signed_out" });
  });
});

describe("useSupabaseAuthController — email OTP request", () => {
  it("does not call the service for an invalid email", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });

    let outcome: AuthServiceResult<void>;
    act(() => {
      outcome = result.current.requestOtp("not-an-email");
    });
    expect(outcome!.ok).toBe(false);
    expect(fake.requestEmailOtp).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({ status: "signed_out" });
  });

  it("normalizes (trims only, preserving case) the email before passing it to the service", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });

    act(() => {
      result.current.requestOtp("  User.Name@Example.COM  ");
    });
    expect(fake.requestEmailOtp).toHaveBeenCalledWith("User.Name@Example.COM");
    expect(result.current.state).toEqual({
      status: "requesting_otp",
      email: "User.Name@Example.COM",
    });
  });

  it("enters awaiting_otp on a successful request", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });

    act(() => {
      result.current.requestOtp("a@example.com");
    });
    await act(async () => {
      fake.resolveRequestEmailOtp(authOk(undefined));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "awaiting_otp", email: "a@example.com" });
  });

  it("enters recoverable_error on a failed request", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });

    act(() => {
      result.current.requestOtp("a@example.com");
    });
    await act(async () => {
      fake.resolveRequestEmailOtp(authFailed({ kind: "request_failed", message: "nope" }));
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe("recoverable_error");
  });

  it("prevents a duplicate pending request", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });

    act(() => {
      result.current.requestOtp("a@example.com");
    });
    act(() => {
      result.current.requestOtp("a@example.com");
    });
    expect(fake.requestEmailOtp).toHaveBeenCalledTimes(1);
  });

  it("retry after a failed request follows the documented transition back to signed_out", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    act(() => {
      result.current.requestOtp("a@example.com");
    });
    await act(async () => {
      fake.resolveRequestEmailOtp(authFailed({ kind: "request_failed", message: "nope" }));
      await Promise.resolve();
    });

    act(() => {
      result.current.dismissError();
    });
    expect(result.current.state).toEqual({ status: "signed_out", lastEmail: "a@example.com" });
  });

  it("changing the email from awaiting_otp returns to signed_out with the email preserved", async () => {
    const fake = createFakeAuthService();
    const { result } = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    act(() => {
      result.current.requestOtp("a@example.com");
    });
    await act(async () => {
      fake.resolveRequestEmailOtp(authOk(undefined));
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe("awaiting_otp");

    act(() => {
      result.current.changeEmail();
    });
    expect(result.current.state).toEqual({ status: "signed_out", lastEmail: "a@example.com" });
  });
});

describe("useSupabaseAuthController — OTP verification", () => {
  async function reachAwaitingOtp(fake: ReturnType<typeof createFakeAuthService>) {
    const rendered = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(null));
      await Promise.resolve();
    });
    act(() => {
      rendered.result.current.requestOtp("a@example.com");
    });
    await act(async () => {
      fake.resolveRequestEmailOtp(authOk(undefined));
      await Promise.resolve();
    });
    return rendered;
  }

  it("does not call the service for a non-six-digit token", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachAwaitingOtp(fake);

    let outcome: AuthServiceResult<void>;
    act(() => {
      outcome = result.current.verifyOtp("12345");
    });
    expect(outcome!.ok).toBe(false);
    expect(fake.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it("enters signed_in on successful verification", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachAwaitingOtp(fake);

    act(() => {
      result.current.verifyOtp("123456");
    });
    expect(fake.verifyEmailOtp).toHaveBeenCalledWith("a@example.com", "123456");
    await act(async () => {
      fake.resolveVerifyEmailOtp(authOk(IDENTITY));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("enters a recoverable state on failed verification", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachAwaitingOtp(fake);

    act(() => {
      result.current.verifyOtp("000000");
    });
    await act(async () => {
      fake.resolveVerifyEmailOtp(authFailed({ kind: "verification_failed", message: "nope" }));
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe("recoverable_error");
  });

  it("prevents a duplicate verification submission", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachAwaitingOtp(fake);

    act(() => {
      result.current.verifyOtp("123456");
    });
    act(() => {
      result.current.verifyOtp("123456");
    });
    expect(fake.verifyEmailOtp).toHaveBeenCalledTimes(1);
  });

  it("never logs the OTP token", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fake = createFakeAuthService();
    const { result } = await reachAwaitingOtp(fake);

    act(() => {
      result.current.verifyOtp("654321");
    });
    await act(async () => {
      fake.resolveVerifyEmailOtp(authOk(IDENTITY));
      await Promise.resolve();
    });

    for (const call of [...consoleSpy.mock.calls, ...errorSpy.mock.calls]) {
      for (const arg of call) {
        expect(String(arg)).not.toContain("654321");
      }
    }
  });

  it("a stale verification result cannot overwrite a newer state", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachAwaitingOtp(fake);

    act(() => {
      result.current.verifyOtp("123456");
    });
    // A newer event (e.g. the provider independently reports sign-out) arrives
    // before the pending verification resolves. AUTH_CHANGED preserves the
    // in-flight email so the user doesn't lose what they typed.
    act(() => {
      fake.fireAuthChanged(null);
    });
    expect(result.current.state).toEqual({ status: "signed_out", lastEmail: "a@example.com" });

    await act(async () => {
      fake.resolveVerifyEmailOtp(authOk(IDENTITY));
      await Promise.resolve();
    });
    // The verification's guard only applies from "verifying_otp" — already
    // left that state, so this resolution is a no-op.
    expect(result.current.state).toEqual({ status: "signed_out", lastEmail: "a@example.com" });
  });
});

describe("useSupabaseAuthController — sign out", () => {
  async function reachSignedIn(fake: ReturnType<typeof createFakeAuthService>) {
    const rendered = renderController(fake);
    await act(async () => {
      fake.resolveGetSession(authOk(IDENTITY));
      await Promise.resolve();
    });
    return rendered;
  }

  it("resolves signed_out on success", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachSignedIn(fake);

    act(() => {
      result.current.signOut();
    });
    expect(result.current.state).toEqual({ status: "signing_out", identity: IDENTITY });

    await act(async () => {
      fake.resolveSignOut(authOk(undefined));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: "signed_out" });
  });

  it("resolves a deterministic recoverable state on failure", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachSignedIn(fake);

    act(() => {
      result.current.signOut();
    });
    await act(async () => {
      fake.resolveSignOut(authFailed({ kind: "sign_out_failed", message: "nope" }));
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({
      status: "recoverable_error",
      error: { kind: "sign_out_failed", message: "nope" },
      context: { kind: "signed_in", identity: IDENTITY },
    });
  });

  it("prevents a duplicate sign-out submission", async () => {
    const fake = createFakeAuthService();
    const { result } = await reachSignedIn(fake);

    act(() => {
      result.current.signOut();
    });
    act(() => {
      result.current.signOut();
    });
    expect(fake.signOut).toHaveBeenCalledTimes(1);
  });
});
