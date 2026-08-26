import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveCloudConfig, type CloudConfig, type ConfiguredCloudConfig } from "./config";
import { createSupabaseAuthService } from "./supabaseAuthService";
import type {
  AccountIdentity,
  AuthService,
  AuthServiceResult,
  NormalizedAuthChange,
  NormalizedAuthError,
  SessionRestoreOutcome,
} from "./authService";
import { authFailed, authOk, normalizedAuthError } from "./authService";
import { initialAuthState, reduceAuthState, type AuthEvent, type AuthState } from "./authState";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_PATTERN = /^\d{6}$/;

// Authentication is optional — a failure in this plumbing must never take
// the rest of the (accountless-capable) app down with it. These two cover
// the only paths that could otherwise throw synchronously during render or
// inside an effect body: constructing the AuthService, and registering its
// auth-change listener.
const BOOTSTRAP_FAILURE_MESSAGE = "Cloud sign-in couldn't be set up. Please try again shortly.";
const SUBSCRIPTION_FAILURE_MESSAGE =
  "Cloud sign-in is temporarily unavailable. Please try again shortly.";

function invalidInput(message: string): NormalizedAuthError {
  return { kind: "invalid_input", message };
}

// Trim only - the local part before "@" is case-sensitive per RFC 5321 and
// must not be rewritten without being asked; lowercasing it could silently
// turn a valid address into a different one. No provider-specific
// normalization (e.g. Gmail's dot-insensitivity) is applied either.
function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim();
}

/**
 * TRANSITIONAL ADAPTER (Stage B0.2b → retired with this hook in B0.2e).
 *
 * `AuthService` now speaks ADR-0025 Decision 2's five session-restore outcomes
 * and Decision 3's closed set of normalized change reasons. This hook keeps its
 * own, older `AuthState`/`AuthEvent` machine (`authState.ts`), which predates
 * both and is deliberately left unchanged: it is retired wholesale when
 * `IdentityProvider` takes over, and widening it now would mean designing the
 * gate's states twice.
 *
 * These two functions are therefore the whole of the compatibility surface —
 * one place where the new closed outcomes are mapped onto the existing events,
 * and nowhere else. They perform no classification of their own: every
 * distinction they act on was already decided inside the Supabase integration
 * boundary, which is the only place a provider error is ever inspected.
 *
 * This hook remains an OPTIONAL, ADDITIVE sign-in shell that never gates the
 * app. None of the outcomes below grants access to anything.
 */
function restoreOutcomeToEvent(outcome: SessionRestoreOutcome): AuthEvent {
  switch (outcome.kind) {
    case "authenticated":
      return { type: "SESSION_RESTORE_SUCCEEDED", identity: outcome.identity };
    case "no_session":
      return { type: "SESSION_RESTORE_SUCCEEDED", identity: null };
    case "invalid_session":
      // A definitively invalid stored session is not an error to show and not a
      // signed-in state: for this additive control it is simply "signed out",
      // which is also what the provider's own cleanup has already made true.
      return { type: "SESSION_RESTORE_SUCCEEDED", identity: null };
    case "temporarily_unavailable":
      return {
        type: "SESSION_RESTORE_FAILED",
        error: normalizedAuthError("temporarily_unavailable"),
      };
    case "restore_failed":
      return {
        type: "SESSION_RESTORE_FAILED",
        error: normalizedAuthError("session_restore_failed"),
      };
  }
}

/** The identity a normalized change carries, if any. `signed_out` carries
 * none by construction; `initial_session`/`other` may carry none. */
function changeToIdentity(change: NormalizedAuthChange): AccountIdentity | null {
  switch (change.reason) {
    case "signed_in":
    case "token_refreshed":
    case "user_updated":
      return change.identity;
    case "signed_out":
      return null;
    case "initial_session":
    case "other":
      return change.identity;
  }
}

export type AuthController = {
  state: AuthState;
  /** Synchronous local-validation result; on success also kicks off the
   * async OTP request against the injected AuthService. */
  requestOtp: (rawEmail: string) => AuthServiceResult<void>;
  changeEmail: () => void;
  /** Synchronous local-validation result; on success also kicks off the
   * async OTP verification against the injected AuthService. */
  verifyOtp: (rawToken: string) => AuthServiceResult<void>;
  signOut: () => void;
  dismissError: () => void;
};

type UseSupabaseAuthControllerOptions = {
  /** Test-only injection point — production call sites omit both and get the
   * real resolved config / a real Supabase-backed service. */
  config?: CloudConfig;
  createAuthService?: (config: ConfiguredCloudConfig) => AuthService;
};

type ControllerBoot = {
  authService: AuthService | null;
  initialState: AuthState;
};

/**
 * Runs once, synchronously, inside a `useState` lazy initializer. A throwing
 * factory (a real construction bug, or a test's deliberately-throwing fake)
 * must not throw through render — it resolves to `authService: null` and a
 * `recoverable_error` initial state instead, so the app still mounts and
 * stays usable, just without a working auth service for this session.
 */
function bootController(
  resolvedConfig: CloudConfig,
  createService: (config: ConfiguredCloudConfig) => AuthService
): ControllerBoot {
  if (resolvedConfig.status !== "configured") {
    return { authService: null, initialState: initialAuthState(resolvedConfig) };
  }
  try {
    return { authService: createService(resolvedConfig), initialState: initialAuthState(resolvedConfig) };
  } catch {
    return {
      authService: null,
      initialState: {
        status: "recoverable_error",
        error: { kind: "unexpected_error", message: BOOTSTRAP_FAILURE_MESSAGE },
        context: { kind: "session_restore" },
      },
    };
  }
}

/**
 * The application-level authentication controller. Owns the one
 * `AuthState` for the whole app, wires the session-restore + auth-event
 * subscription lifecycle (see the sanctioned "subscribe inside useEffect,
 * setState from the callback" pattern used by the Timing Simulator wiring in
 * TrackerApp.tsx), and exposes user actions as guarded, idempotent
 * functions.
 *
 * `stateRef` is the authoritative, synchronously-updated mirror of `state`
 * (ADR-0007's ref-mirror pattern) — every action reads it, never the `state`
 * variable captured in a stale render closure, so a rapid double-click
 * cannot start two overlapping OTP requests before React has re-rendered.
 * `disposedRef` is set exactly once, in an unmount-only effect, and checked
 * by every pending async callback so a slow response arriving after unmount
 * can never call setState.
 */
export function useSupabaseAuthController(
  options: UseSupabaseAuthControllerOptions = {}
): AuthController {
  const resolvedConfig = useMemo<CloudConfig>(
    () => options.config ?? resolveCloudConfig(),
    [options.config]
  );

  const [{ authService, initialState }] = useState<ControllerBoot>(() =>
    bootController(resolvedConfig, options.createAuthService ?? createSupabaseAuthService)
  );

  const [state, setState] = useState<AuthState>(initialState);
  const stateRef = useRef<AuthState>(state);
  const disposedRef = useRef(false);

  // Stable across the component's lifetime (only closes over refs and the
  // setState setter, both referentially stable) so effects that depend on
  // it never re-run just because a render happened.
  const dispatch = useCallback((event: AuthEvent) => {
    const next = reduceAuthState(stateRef.current, event);
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    // Reset on every (re)mount, not just set on cleanup — StrictMode's
    // dev-only mount→cleanup→remount probe would otherwise leave this `true`
    // forever after the probe's cleanup runs once, permanently and silently
    // dropping every future state update even though the component is still
    // genuinely mounted.
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  useEffect(() => {
    if (authService === null) return;

    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    function failSubscription() {
      if (disposed || disposedRef.current) return;
      // Reuses SESSION_RESTORE_FAILED rather than adding a new event/state:
      // this effect body runs synchronously at mount, strictly before the
      // getSession() promise below can settle (a `.then` callback is always
      // a later microtask), so `state` is still guaranteed to be
      // "restoring_session" here — the one state this event is guarded to
      // apply from — making the resulting transition identical to a real
      // session-restore failure, which is exactly the right place to land:
      // a recoverable_error the user can dismiss back to signed_out.
      dispatch({
        type: "SESSION_RESTORE_FAILED",
        error: { kind: "temporarily_unavailable", message: SUBSCRIPTION_FAILURE_MESSAGE },
      });
    }

    try {
      // AuthService's contract is to never reject/throw, but a misbehaving
      // real or injected implementation must not be able to throw
      // synchronously (calling restoreSession() itself) or asynchronously (an
      // unhandled rejection) into the void, let alone leave `state` stuck in
      // "restoring_session" forever.
      authService.restoreSession().then((outcome) => {
        if (disposed || disposedRef.current) return;
        dispatch(restoreOutcomeToEvent(outcome));
      }, failSubscription);
    } catch {
      failSubscription();
    }

    try {
      unsubscribe = authService.onAuthChange((change) => {
        if (disposed || disposedRef.current) return;
        dispatch({ type: "AUTH_CHANGED", identity: changeToIdentity(change) });
      });
    } catch {
      failSubscription();
    }

    return () => {
      disposed = true;
      try {
        unsubscribe?.();
      } catch {
        // Nothing further to do on unmount — disposedRef already guards
        // every pending callback above regardless of whether unsubscribe
        // itself succeeded, so a throwing unsubscribe cannot leak a listener
        // in a way that matters, only fail to clean up its own reference.
      }
    };
    // authService is constructed exactly once (lazy useState initializer)
    // and never changes identity for the life of this component, so this
    // effect runs once per mount — twice under StrictMode's dev-only
    // mount→cleanup→remount probe, each with its own `disposed` closure
    // variable, never leaving two simultaneously active listeners.
  }, [authService, dispatch]);

  function requestOtp(rawEmail: string): AuthServiceResult<void> {
    const email = normalizeEmail(rawEmail);
    if (!EMAIL_PATTERN.test(email)) {
      return authFailed(invalidInput("Enter a valid email address."));
    }
    if (stateRef.current.status !== "signed_out" || authService === null) {
      // Not the signed_out/email-entry state (e.g. a request is already
      // pending) — duplicate submissions are silently dropped, matching
      // dispatch's own reducer guard.
      return authOk(undefined);
    }
    dispatch({ type: "EMAIL_OTP_REQUESTED", email });
    authService.requestEmailOtp(email).then((result) => {
      if (disposedRef.current) return;
      if (result.ok) {
        dispatch({ type: "EMAIL_OTP_REQUEST_SUCCEEDED" });
      } else {
        dispatch({ type: "EMAIL_OTP_REQUEST_FAILED", error: result.error });
      }
    });
    return authOk(undefined);
  }

  function changeEmail() {
    dispatch({ type: "EMAIL_CHANGE_REQUESTED" });
  }

  function verifyOtp(rawToken: string): AuthServiceResult<void> {
    const token = rawToken.trim();
    if (!OTP_PATTERN.test(token)) {
      return authFailed(invalidInput("Enter the 6-digit code."));
    }
    const current = stateRef.current;
    if (current.status !== "awaiting_otp" || authService === null) {
      return authOk(undefined);
    }
    const email = current.email;
    dispatch({ type: "OTP_VERIFICATION_STARTED" });
    authService.verifyEmailOtp(email, token).then((result) => {
      if (disposedRef.current) return;
      if (result.ok) {
        dispatch({ type: "OTP_VERIFICATION_SUCCEEDED", identity: result.value });
      } else {
        dispatch({ type: "OTP_VERIFICATION_FAILED", error: result.error });
      }
    });
    return authOk(undefined);
  }

  function signOut() {
    if (stateRef.current.status !== "signed_in" || authService === null) return;
    dispatch({ type: "SIGN_OUT_REQUESTED" });
    authService.signOut().then((result) => {
      if (disposedRef.current) return;
      if (result.ok) {
        dispatch({ type: "SIGN_OUT_SUCCEEDED" });
      } else {
        dispatch({ type: "SIGN_OUT_FAILED", error: result.error });
      }
    });
  }

  function dismissError() {
    dispatch({ type: "ERROR_DISMISSED" });
  }

  return { state, requestOtp, changeEmail, verifyOtp, signOut, dismissError };
}
