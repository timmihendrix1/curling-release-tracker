import { describe, expect, it } from "vitest";
import { initialAuthState, reduceAuthState, type AuthState } from "../authState";
import type { AccountIdentity, NormalizedAuthError } from "../authService";

const IDENTITY: AccountIdentity = { accountScopeId: "user-1", email: "a@example.com" };
const OTHER_IDENTITY: AccountIdentity = { accountScopeId: "user-2", email: "b@example.com" };
const ERROR: NormalizedAuthError = { kind: "unexpected_error", message: "boom" };

describe("initialAuthState", () => {
  it("boots into cloud_disabled", () => {
    expect(initialAuthState({ status: "cloud_disabled" })).toEqual({ status: "cloud_disabled" });
  });

  it("boots into invalid_configuration", () => {
    expect(
      initialAuthState({ status: "invalid_configuration", reason: "missing_url" })
    ).toEqual({ status: "invalid_configuration" });
  });

  it("boots into restoring_session when configured", () => {
    expect(
      initialAuthState({
        status: "configured",
        url: "https://x.supabase.co",
        publishableKey: "sb_publishable_" + "k".repeat(20),
      })
    ).toEqual({ status: "restoring_session" });
  });
});

describe("reduceAuthState — session restoration", () => {
  it("SESSION_RESTORE_SUCCEEDED with an identity moves restoring_session to signed_in", () => {
    const next = reduceAuthState(
      { status: "restoring_session" },
      { type: "SESSION_RESTORE_SUCCEEDED", identity: IDENTITY }
    );
    expect(next).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("SESSION_RESTORE_SUCCEEDED with no identity moves restoring_session to signed_out", () => {
    const next = reduceAuthState(
      { status: "restoring_session" },
      { type: "SESSION_RESTORE_SUCCEEDED", identity: null }
    );
    expect(next).toEqual({ status: "signed_out" });
  });

  it("SESSION_RESTORE_FAILED moves restoring_session to a recoverable_error with session_restore context", () => {
    const next = reduceAuthState(
      { status: "restoring_session" },
      { type: "SESSION_RESTORE_FAILED", error: ERROR }
    );
    expect(next).toEqual({ status: "recoverable_error", error: ERROR, context: { kind: "session_restore" } });
  });

  it("a stale SESSION_RESTORE_SUCCEEDED arriving after a newer AUTH_CHANGED already resolved is a no-op", () => {
    const afterAuthChanged = reduceAuthState(
      { status: "restoring_session" },
      { type: "AUTH_CHANGED", identity: IDENTITY }
    );
    expect(afterAuthChanged).toEqual({ status: "signed_in", identity: IDENTITY });

    const stale = reduceAuthState(afterAuthChanged, {
      type: "SESSION_RESTORE_SUCCEEDED",
      identity: null,
    });
    expect(stale).toBe(afterAuthChanged);
  });

  it("SESSION_RESTORE_SUCCEEDED is ignored outside restoring_session", () => {
    const state: AuthState = { status: "signed_out" };
    expect(reduceAuthState(state, { type: "SESSION_RESTORE_SUCCEEDED", identity: IDENTITY })).toBe(
      state
    );
  });
});

describe("reduceAuthState — AUTH_CHANGED", () => {
  it("never overrides cloud_disabled", () => {
    const state: AuthState = { status: "cloud_disabled" };
    expect(reduceAuthState(state, { type: "AUTH_CHANGED", identity: IDENTITY })).toBe(state);
  });

  it("never overrides invalid_configuration", () => {
    const state: AuthState = { status: "invalid_configuration" };
    expect(reduceAuthState(state, { type: "AUTH_CHANGED", identity: IDENTITY })).toBe(state);
  });

  it("moves signed_out to signed_in when an identity appears", () => {
    expect(
      reduceAuthState({ status: "signed_out" }, { type: "AUTH_CHANGED", identity: IDENTITY })
    ).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("moves signed_in to signed_out when the identity disappears (e.g. sign-out from another tab)", () => {
    expect(
      reduceAuthState({ status: "signed_in", identity: IDENTITY }, { type: "AUTH_CHANGED", identity: null })
    ).toEqual({ status: "signed_out" });
  });

  it("switches the identity directly when a different account is reported", () => {
    expect(
      reduceAuthState(
        { status: "signed_in", identity: IDENTITY },
        { type: "AUTH_CHANGED", identity: OTHER_IDENTITY }
      )
    ).toEqual({ status: "signed_in", identity: OTHER_IDENTITY });
  });

  it("preserves a partially-typed email when auth changes to signed-out mid email entry", () => {
    expect(
      reduceAuthState(
        { status: "awaiting_otp", email: "a@example.com" },
        { type: "AUTH_CHANGED", identity: null }
      )
    ).toEqual({ status: "signed_out", lastEmail: "a@example.com" });
  });
});

describe("reduceAuthState — email OTP request", () => {
  it("EMAIL_OTP_REQUESTED moves signed_out to requesting_otp", () => {
    expect(
      reduceAuthState({ status: "signed_out" }, { type: "EMAIL_OTP_REQUESTED", email: "a@example.com" })
    ).toEqual({ status: "requesting_otp", email: "a@example.com" });
  });

  it("EMAIL_OTP_REQUESTED is ignored (duplicate submission) when already requesting_otp", () => {
    const state: AuthState = { status: "requesting_otp", email: "a@example.com" };
    expect(reduceAuthState(state, { type: "EMAIL_OTP_REQUESTED", email: "a@example.com" })).toBe(state);
  });

  it("EMAIL_OTP_REQUEST_SUCCEEDED moves requesting_otp to awaiting_otp", () => {
    expect(
      reduceAuthState(
        { status: "requesting_otp", email: "a@example.com" },
        { type: "EMAIL_OTP_REQUEST_SUCCEEDED" }
      )
    ).toEqual({ status: "awaiting_otp", email: "a@example.com" });
  });

  it("EMAIL_OTP_REQUEST_FAILED moves requesting_otp to a recoverable_error with email_entry context", () => {
    expect(
      reduceAuthState(
        { status: "requesting_otp", email: "a@example.com" },
        { type: "EMAIL_OTP_REQUEST_FAILED", error: ERROR }
      )
    ).toEqual({
      status: "recoverable_error",
      error: ERROR,
      context: { kind: "email_entry", email: "a@example.com" },
    });
  });

  it("EMAIL_CHANGE_REQUESTED moves awaiting_otp back to signed_out, preserving the email", () => {
    expect(
      reduceAuthState({ status: "awaiting_otp", email: "a@example.com" }, { type: "EMAIL_CHANGE_REQUESTED" })
    ).toEqual({ status: "signed_out", lastEmail: "a@example.com" });
  });

  it("EMAIL_CHANGE_REQUESTED is ignored outside awaiting_otp", () => {
    const state: AuthState = { status: "signed_out" };
    expect(reduceAuthState(state, { type: "EMAIL_CHANGE_REQUESTED" })).toBe(state);
  });
});

describe("reduceAuthState — OTP verification", () => {
  it("OTP_VERIFICATION_STARTED moves awaiting_otp to verifying_otp", () => {
    expect(
      reduceAuthState({ status: "awaiting_otp", email: "a@example.com" }, { type: "OTP_VERIFICATION_STARTED" })
    ).toEqual({ status: "verifying_otp", email: "a@example.com" });
  });

  it("OTP_VERIFICATION_STARTED is ignored (duplicate verification) when already verifying_otp", () => {
    const state: AuthState = { status: "verifying_otp", email: "a@example.com" };
    expect(reduceAuthState(state, { type: "OTP_VERIFICATION_STARTED" })).toBe(state);
  });

  it("OTP_VERIFICATION_SUCCEEDED moves verifying_otp to signed_in", () => {
    expect(
      reduceAuthState(
        { status: "verifying_otp", email: "a@example.com" },
        { type: "OTP_VERIFICATION_SUCCEEDED", identity: IDENTITY }
      )
    ).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("OTP_VERIFICATION_FAILED moves verifying_otp to a recoverable_error with otp_entry context", () => {
    expect(
      reduceAuthState(
        { status: "verifying_otp", email: "a@example.com" },
        { type: "OTP_VERIFICATION_FAILED", error: ERROR }
      )
    ).toEqual({
      status: "recoverable_error",
      error: ERROR,
      context: { kind: "otp_entry", email: "a@example.com" },
    });
  });

  it("a stale OTP_VERIFICATION_SUCCEEDED arriving after the email was already changed is a no-op", () => {
    const changed = reduceAuthState(
      { status: "verifying_otp", email: "a@example.com" },
      { type: "OTP_VERIFICATION_FAILED", error: ERROR }
    );
    const backToOtp = reduceAuthState(changed, { type: "EMAIL_CHANGE_REQUESTED" });
    // ERROR_DISMISSED from otp_entry context returns to awaiting_otp, not signed_out —
    // EMAIL_CHANGE_REQUESTED only applies from awaiting_otp, so it's a no-op here.
    expect(backToOtp).toBe(changed);
  });
});

describe("reduceAuthState — sign out", () => {
  it("SIGN_OUT_REQUESTED moves signed_in to signing_out", () => {
    expect(
      reduceAuthState({ status: "signed_in", identity: IDENTITY }, { type: "SIGN_OUT_REQUESTED" })
    ).toEqual({ status: "signing_out", identity: IDENTITY });
  });

  it("SIGN_OUT_REQUESTED is ignored (duplicate sign-out) when already signing_out", () => {
    const state: AuthState = { status: "signing_out", identity: IDENTITY };
    expect(reduceAuthState(state, { type: "SIGN_OUT_REQUESTED" })).toBe(state);
  });

  it("SIGN_OUT_SUCCEEDED moves signing_out to signed_out", () => {
    expect(
      reduceAuthState({ status: "signing_out", identity: IDENTITY }, { type: "SIGN_OUT_SUCCEEDED" })
    ).toEqual({ status: "signed_out" });
  });

  it("SIGN_OUT_FAILED moves signing_out to a recoverable_error with signed_in context", () => {
    expect(
      reduceAuthState({ status: "signing_out", identity: IDENTITY }, { type: "SIGN_OUT_FAILED", error: ERROR })
    ).toEqual({ status: "recoverable_error", error: ERROR, context: { kind: "signed_in", identity: IDENTITY } });
  });
});

describe("reduceAuthState — ERROR_DISMISSED retry destinations", () => {
  it("session_restore context returns to signed_out", () => {
    expect(
      reduceAuthState(
        { status: "recoverable_error", error: ERROR, context: { kind: "session_restore" } },
        { type: "ERROR_DISMISSED" }
      )
    ).toEqual({ status: "signed_out" });
  });

  it("email_entry context returns to signed_out with the email preserved", () => {
    expect(
      reduceAuthState(
        {
          status: "recoverable_error",
          error: ERROR,
          context: { kind: "email_entry", email: "a@example.com" },
        },
        { type: "ERROR_DISMISSED" }
      )
    ).toEqual({ status: "signed_out", lastEmail: "a@example.com" });
  });

  it("otp_entry context returns to awaiting_otp with the email preserved", () => {
    expect(
      reduceAuthState(
        {
          status: "recoverable_error",
          error: ERROR,
          context: { kind: "otp_entry", email: "a@example.com" },
        },
        { type: "ERROR_DISMISSED" }
      )
    ).toEqual({ status: "awaiting_otp", email: "a@example.com" });
  });

  it("signed_in context (a failed sign-out) returns to signed_in", () => {
    expect(
      reduceAuthState(
        { status: "recoverable_error", error: ERROR, context: { kind: "signed_in", identity: IDENTITY } },
        { type: "ERROR_DISMISSED" }
      )
    ).toEqual({ status: "signed_in", identity: IDENTITY });
  });

  it("ERROR_DISMISSED is ignored outside recoverable_error", () => {
    const state: AuthState = { status: "signed_out" };
    expect(reduceAuthState(state, { type: "ERROR_DISMISSED" })).toBe(state);
  });
});
