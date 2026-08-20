// The explicit authentication state model — one discriminated union, never
// independent booleans (no `isLoading`/`isSignedIn`/`hasError` combination
// that could contradict itself). Every reachable state has one clear
// meaning and a deterministic set of permitted actions, enforced here by
// `reduceAuthState`: old state + event → new state, computed as one pure
// function and committed as a plain value — the same pattern
// `applyTimingResultToSession` (src/lib/captureSequence.ts, ADR-0007) uses
// for a training capture result. An event that isn't valid for the current
// state is a no-op (the state is returned unchanged), never a throw — the
// controller (useSupabaseAuthController.ts) additionally guards *before*
// dispatching so an invalid action never reaches the network, but the
// reducer itself never trusts that guard alone.
import type { AccountIdentity, NormalizedAuthError } from "./authService";
import type { CloudConfig } from "./config";

/** What a `recoverable_error` should return to on retry/dismiss — carries
 * exactly the context needed to resume deterministically, never the raw
 * cause of the failure. */
export type AuthErrorContext =
  | { kind: "session_restore" }
  | { kind: "email_entry"; email: string }
  | { kind: "otp_entry"; email: string }
  | { kind: "signed_in"; identity: AccountIdentity };

export type AuthState =
  | { status: "cloud_disabled" }
  | { status: "invalid_configuration" }
  | { status: "restoring_session" }
  | { status: "signed_out"; lastEmail?: string }
  | { status: "requesting_otp"; email: string }
  | { status: "awaiting_otp"; email: string }
  | { status: "verifying_otp"; email: string }
  | { status: "signed_in"; identity: AccountIdentity }
  | { status: "signing_out"; identity: AccountIdentity }
  | { status: "recoverable_error"; error: NormalizedAuthError; context: AuthErrorContext };

export type AuthEvent =
  | { type: "SESSION_RESTORE_SUCCEEDED"; identity: AccountIdentity | null }
  | { type: "SESSION_RESTORE_FAILED"; error: NormalizedAuthError }
  | { type: "AUTH_CHANGED"; identity: AccountIdentity | null }
  | { type: "EMAIL_OTP_REQUESTED"; email: string }
  | { type: "EMAIL_OTP_REQUEST_SUCCEEDED" }
  | { type: "EMAIL_OTP_REQUEST_FAILED"; error: NormalizedAuthError }
  | { type: "EMAIL_CHANGE_REQUESTED" }
  | { type: "OTP_VERIFICATION_STARTED" }
  | { type: "OTP_VERIFICATION_SUCCEEDED"; identity: AccountIdentity }
  | { type: "OTP_VERIFICATION_FAILED"; error: NormalizedAuthError }
  | { type: "SIGN_OUT_REQUESTED" }
  | { type: "SIGN_OUT_SUCCEEDED" }
  | { type: "SIGN_OUT_FAILED"; error: NormalizedAuthError }
  | { type: "ERROR_DISMISSED" };

/** The state to boot into once `resolveCloudConfig()` has resolved — a pure,
 * synchronous mapping (config resolution has no async step), kept separate
 * from `reduceAuthState` since it only ever applies once, before any event
 * exists to reduce over. */
export function initialAuthState(config: CloudConfig): AuthState {
  if (config.status === "cloud_disabled") return { status: "cloud_disabled" };
  if (config.status === "invalid_configuration") return { status: "invalid_configuration" };
  return { status: "restoring_session" };
}

/** The email carried by whichever in-progress or errored state the machine
 * is currently in, if any — used so "change email" and "sign out then auth
 * changes to null" can preserve what the user already typed instead of
 * discarding it. */
function currentEmail(state: AuthState): string | undefined {
  switch (state.status) {
    case "signed_out":
      return state.lastEmail;
    case "requesting_otp":
    case "awaiting_otp":
    case "verifying_otp":
      return state.email;
    case "recoverable_error":
      return state.context.kind === "email_entry" || state.context.kind === "otp_entry"
        ? state.context.email
        : undefined;
    default:
      return undefined;
  }
}

export function reduceAuthState(state: AuthState, event: AuthEvent): AuthState {
  switch (event.type) {
    case "SESSION_RESTORE_SUCCEEDED": {
      if (state.status !== "restoring_session") return state;
      return event.identity ? { status: "signed_in", identity: event.identity } : { status: "signed_out" };
    }

    case "SESSION_RESTORE_FAILED": {
      if (state.status !== "restoring_session") return state;
      return { status: "recoverable_error", error: event.error, context: { kind: "session_restore" } };
    }

    case "AUTH_CHANGED": {
      // No listener is ever registered while cloud-disabled/misconfigured,
      // but guard anyway so this can never override those states.
      if (state.status === "cloud_disabled" || state.status === "invalid_configuration") {
        return state;
      }
      if (event.identity) {
        return { status: "signed_in", identity: event.identity };
      }
      const lastEmail = currentEmail(state);
      return lastEmail ? { status: "signed_out", lastEmail } : { status: "signed_out" };
    }

    case "EMAIL_OTP_REQUESTED": {
      if (state.status !== "signed_out") return state;
      return { status: "requesting_otp", email: event.email };
    }

    case "EMAIL_OTP_REQUEST_SUCCEEDED": {
      if (state.status !== "requesting_otp") return state;
      return { status: "awaiting_otp", email: state.email };
    }

    case "EMAIL_OTP_REQUEST_FAILED": {
      if (state.status !== "requesting_otp") return state;
      return {
        status: "recoverable_error",
        error: event.error,
        context: { kind: "email_entry", email: state.email },
      };
    }

    case "EMAIL_CHANGE_REQUESTED": {
      if (state.status !== "awaiting_otp") return state;
      return { status: "signed_out", lastEmail: state.email };
    }

    case "OTP_VERIFICATION_STARTED": {
      if (state.status !== "awaiting_otp") return state;
      return { status: "verifying_otp", email: state.email };
    }

    case "OTP_VERIFICATION_SUCCEEDED": {
      if (state.status !== "verifying_otp") return state;
      return { status: "signed_in", identity: event.identity };
    }

    case "OTP_VERIFICATION_FAILED": {
      if (state.status !== "verifying_otp") return state;
      return {
        status: "recoverable_error",
        error: event.error,
        context: { kind: "otp_entry", email: state.email },
      };
    }

    case "SIGN_OUT_REQUESTED": {
      if (state.status !== "signed_in") return state;
      return { status: "signing_out", identity: state.identity };
    }

    case "SIGN_OUT_SUCCEEDED": {
      if (state.status !== "signing_out") return state;
      return { status: "signed_out" };
    }

    case "SIGN_OUT_FAILED": {
      if (state.status !== "signing_out") return state;
      return {
        status: "recoverable_error",
        error: event.error,
        context: { kind: "signed_in", identity: state.identity },
      };
    }

    case "ERROR_DISMISSED": {
      if (state.status !== "recoverable_error") return state;
      switch (state.context.kind) {
        case "session_restore":
          return { status: "signed_out" };
        case "email_entry":
          return { status: "signed_out", lastEmail: state.context.email };
        case "otp_entry":
          return { status: "awaiting_otp", email: state.context.email };
        case "signed_in":
          return { status: "signed_in", identity: state.context.identity };
      }
    }
  }
}
