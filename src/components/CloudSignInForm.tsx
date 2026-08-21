"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AuthController } from "../lib/supabase/useSupabaseAuthController";

const fieldClassName =
  "min-h-11 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:bg-slate-100 disabled:text-slate-400";

const primaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:bg-slate-400";

const secondaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60";

export type CloudSignInFormProps = {
  controller: AuthController;
  /** Distinct per call site (this may render alongside another instance mounted
   * elsewhere — e.g. AccountControl's header instance and an invitation overlay's
   * own instance — so `data-testid`/`data-*` uniqueness is the caller's
   * responsibility, not something this component can assume for itself). */
  testId: string;
  /** Renders a "Cancel" action beside the email-entry step when provided
   * (AccountControl's collapsible-panel behavior); omitted entirely otherwise —
   * a caller with its own dismiss affordance elsewhere (e.g. an overlay's "Close"
   * button) does not need a second one here. */
  onCancelEmailStep?: () => void;
};

/**
 * The one authentication UI this app has — the email/OTP request-and-verify form,
 * plus the shared recoverable-error affordance — driven entirely by the ONE
 * `AuthController` state machine (`useSupabaseAuthController`) every call site
 * constructs. Renders nothing for any state this form doesn't handle
 * (`cloud_disabled`, `invalid_configuration`, `restoring_session`, `signed_in`,
 * `signing_out`) — those remain each caller's own concern, rendered around this
 * component rather than duplicated inside it.
 *
 * Extracted from AccountControl (docs/adr/0022 §Deep-Link Sign-In Continuity) so a
 * signed-out recipient opening an invitation or Admin Request link can complete the
 * SAME sign-in flow directly inside that overlay, instead of being told to find and
 * use a separate header control it cannot interact with while a modal covers it —
 * without building a second, divergent authentication state machine to do it.
 */
export default function CloudSignInForm({ controller, testId, onCancelEmailStep }: CloudSignInFormProps) {
  const { state } = controller;

  const [emailInput, setEmailInput] = useState("");
  const [otpInput, setOtpInput] = useState("");
  const [localValidationError, setLocalValidationError] = useState<string | null>(null);

  const emailInputId = useId();
  const otpInputId = useId();
  const otpInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.status === "awaiting_otp") {
      otpInputRef.current?.focus();
    }
  }, [state.status]);

  function handleRequestOtp(email: string) {
    const result = controller.requestOtp(email);
    if (!result.ok) {
      setLocalValidationError(result.error.message);
    } else {
      setLocalValidationError(null);
    }
  }

  function handleVerifyOtp(token: string) {
    const result = controller.verifyOtp(token);
    if (!result.ok) {
      setLocalValidationError(result.error.message);
    } else {
      setLocalValidationError(null);
    }
  }

  if (state.status === "recoverable_error") {
    return (
      <div
        role="alert"
        data-testid={testId}
        className="mb-2 flex flex-wrap items-center justify-end gap-2 text-sm"
      >
        <span className="text-red-700">{state.error.message}</span>
        <button
          type="button"
          onClick={() => {
            setOtpInput("");
            if (state.context.kind === "email_entry") {
              setEmailInput(state.context.email);
            }
            controller.dismissError();
          }}
          className={secondaryButtonClassName}
        >
          {state.context.kind === "signed_in" ? "OK" : "Try again"}
        </button>
      </div>
    );
  }

  const isEmailStep = state.status === "signed_out" || state.status === "requesting_otp";
  const isOtpStep = state.status === "awaiting_otp" || state.status === "verifying_otp";
  const isPending = state.status === "requesting_otp" || state.status === "verifying_otp";

  if (!isEmailStep && !isOtpStep) {
    return null;
  }

  return (
    <div data-testid={testId} className="mb-2 flex flex-col items-end gap-1.5">
      {isEmailStep && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            handleRequestOtp(emailInput);
          }}
          className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow"
        >
          <label htmlFor={emailInputId} className="sr-only">
            Email address
          </label>
          <input
            id={emailInputId}
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            placeholder="you@example.com"
            value={emailInput}
            disabled={isPending}
            onChange={(event) => {
              setEmailInput(event.target.value);
              setLocalValidationError(null);
            }}
            className={fieldClassName}
          />
          <button type="submit" disabled={isPending} className={primaryButtonClassName}>
            {state.status === "requesting_otp" ? "Sending…" : "Send code"}
          </button>
          {onCancelEmailStep && (
            <button
              type="button"
              onClick={onCancelEmailStep}
              disabled={isPending}
              aria-label="Cancel sign in"
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
          )}
        </form>
      )}

      {isOtpStep && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            handleVerifyOtp(otpInput);
          }}
          className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 shadow"
        >
          <span className="text-xs text-slate-600">Code sent to {state.email}</span>

          <label htmlFor={otpInputId} className="sr-only">
            6-digit code
          </label>
          <input
            id={otpInputId}
            ref={otpInputRef}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            required
            placeholder="000000"
            value={otpInput}
            disabled={state.status === "verifying_otp"}
            onChange={(event) => {
              setOtpInput(event.target.value.replace(/\D/g, "").slice(0, 6));
              setLocalValidationError(null);
            }}
            className={`${fieldClassName} w-24 text-center tracking-widest`}
          />
          <button type="submit" disabled={state.status === "verifying_otp"} className={primaryButtonClassName}>
            {state.status === "verifying_otp" ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            disabled={state.status === "verifying_otp"}
            onClick={() => {
              setOtpInput("");
              setEmailInput(state.email);
              controller.changeEmail();
            }}
            className={secondaryButtonClassName}
          >
            Change email
          </button>
        </form>
      )}

      {localValidationError && (
        <p role="alert" className="text-xs text-red-600">
          {localValidationError}
        </p>
      )}
    </div>
  );
}
