"use client";

import { useEffect, useId, useRef, useState } from "react";
import InfoButton from "./InfoButton";
import {
  useSupabaseAuthController,
  type AuthController,
} from "../lib/supabase/useSupabaseAuthController";
import type { AuthService } from "../lib/supabase/authService";
import type { CloudConfig, ConfiguredCloudConfig } from "../lib/supabase/config";
import type { FeatureExplanation } from "../lib/helpContent";

const CLOUD_SIGN_IN_EXPLANATION: FeatureExplanation = {
  id: "cloud-sign-in",
  title: "Cloud Sign-In",
  shortDescription:
    "An optional account, signed into with an emailed one-time code. Entirely optional — the app works fully signed out.",
  purpose: "Why would I sign in?",
  howItWorks: [
    "Enter your email and request a one-time code, then enter the 6-digit code you receive.",
    "Signing in only establishes an account identity — it never uploads, changes, or affects any of your existing local training data.",
  ],
  usefulFor: ["Establishing a stable account identity for future cloud features"],
  limitations: [
    "Cloud data storage, cross-device sync, and moving existing local history into an account are not available yet.",
  ],
};

type AccountControlProps = {
  /** Test-only injection point, forwarded to useSupabaseAuthController —
   * production usage (mounted from TrackerApp) passes neither. */
  config?: CloudConfig;
  createAuthService?: (config: ConfiguredCloudConfig) => AuthService;
};

const fieldClassName =
  "min-h-11 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:bg-slate-100 disabled:text-slate-400";

const primaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:bg-slate-400";

const secondaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Compact, optional account control — see
 * docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md §3.1/§5.4. Renders
 * nothing when cloud is disabled (the overwhelming common case for an
 * alpha build with no Supabase configuration), a small non-blocking badge
 * when misconfigured, and a compact sign-in/account affordance otherwise.
 * Never gates the rest of the app — every branch below renders inline,
 * alongside whatever screen is active, never as a full-page takeover.
 */
export default function AccountControl({ config, createAuthService }: AccountControlProps) {
  const controller = useSupabaseAuthController({ config, createAuthService });
  const { state } = controller;

  const [panelOpen, setPanelOpen] = useState(false);
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

  function openPanel() {
    setLocalValidationError(null);
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
    setEmailInput("");
    setOtpInput("");
    setLocalValidationError(null);
  }

  function handleRequestOtp(controller: AuthController, email: string) {
    const result = controller.requestOtp(email);
    if (!result.ok) {
      setLocalValidationError(result.error.message);
    } else {
      setLocalValidationError(null);
    }
  }

  function handleVerifyOtp(controller: AuthController, token: string) {
    const result = controller.verifyOtp(token);
    if (!result.ok) {
      setLocalValidationError(result.error.message);
    } else {
      setLocalValidationError(null);
    }
  }

  if (state.status === "cloud_disabled") {
    return null;
  }

  if (state.status === "invalid_configuration") {
    return (
      <div
        role="status"
        data-testid="account-control"
        className="mb-2 flex items-center justify-end gap-1 text-xs text-amber-700"
      >
        <span>Cloud sign-in unavailable (configuration)</span>
      </div>
    );
  }

  if (state.status === "restoring_session") {
    return (
      <div
        aria-live="polite"
        data-testid="account-control"
        className="mb-2 flex items-center justify-end text-xs text-slate-500"
      >
        Checking sign-in…
      </div>
    );
  }

  if (state.status === "signed_in") {
    return (
      <div
        data-testid="account-control"
        className="mb-2 flex items-center justify-end gap-2 text-sm"
      >
        <span className="text-slate-700">{state.identity.email ?? "Signed in"}</span>
        <button type="button" onClick={controller.signOut} className={secondaryButtonClassName}>
          Sign out
        </button>
      </div>
    );
  }

  if (state.status === "signing_out") {
    return (
      <div
        data-testid="account-control"
        className="mb-2 flex items-center justify-end gap-2 text-sm"
      >
        <span className="text-slate-700">{state.identity.email ?? "Signed in"}</span>
        <button type="button" disabled className={secondaryButtonClassName}>
          Signing out…
        </button>
      </div>
    );
  }

  if (state.status === "recoverable_error") {
    return (
      <div
        role="alert"
        data-testid="account-control"
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

  // signed_out | requesting_otp | awaiting_otp | verifying_otp
  const isEmailStep = state.status === "signed_out" || state.status === "requesting_otp";
  const isOtpStep = state.status === "awaiting_otp" || state.status === "verifying_otp";
  const isPending = state.status === "requesting_otp" || state.status === "verifying_otp";

  if (!panelOpen && state.status === "signed_out") {
    return (
      <div data-testid="account-control" className="mb-2 flex items-center justify-end gap-1">
        <button type="button" onClick={openPanel} className={secondaryButtonClassName}>
          Sign in
        </button>
        <InfoButton explanation={CLOUD_SIGN_IN_EXPLANATION} />
      </div>
    );
  }

  return (
    <div data-testid="account-control" className="mb-2 flex flex-col items-end gap-1.5">
      {isEmailStep && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            handleRequestOtp(controller, emailInput);
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
          <button
            type="button"
            onClick={closePanel}
            disabled={isPending}
            aria-label="Cancel sign in"
            className={secondaryButtonClassName}
          >
            Cancel
          </button>
        </form>
      )}

      {isOtpStep && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            handleVerifyOtp(controller, otpInput);
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
          <button
            type="submit"
            disabled={state.status === "verifying_otp"}
            className={primaryButtonClassName}
          >
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
