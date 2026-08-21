"use client";

import { useState } from "react";
import InfoButton from "./InfoButton";
import CloudSignInForm from "./CloudSignInForm";
import { useSupabaseAuthController } from "../lib/supabase/useSupabaseAuthController";
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
  /** Team Foundation (docs/adr/0022) entry point — omitted, the "Teams" button
   * simply doesn't render, so existing/test call sites are unaffected. */
  onOpenTeams?: () => void;
};

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
export default function AccountControl({ config, createAuthService, onOpenTeams }: AccountControlProps) {
  const controller = useSupabaseAuthController({ config, createAuthService });
  const { state } = controller;

  const [panelOpen, setPanelOpen] = useState(false);

  function openPanel() {
    setPanelOpen(true);
  }

  function closePanel() {
    setPanelOpen(false);
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
        {onOpenTeams && (
          <button type="button" onClick={onOpenTeams} className={secondaryButtonClassName}>
            Teams
          </button>
        )}
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

  // recoverable_error | signed_out (panel open) | requesting_otp | awaiting_otp | verifying_otp
  return <CloudSignInForm controller={controller} testId="account-control" onCancelEmailStep={closePanel} />;
}
