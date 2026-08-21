"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSupabaseAuthController } from "../lib/supabase/useSupabaseAuthController";
import type { AuthService } from "../lib/supabase/authService";
import { resolveCloudConfig, type CloudConfig, type ConfiguredCloudConfig } from "../lib/supabase/config";
import { createSupabaseTeamService } from "../lib/supabase/teamServiceFactory";
import type { TeamService } from "../lib/team/teamService";
import type { InvitationPreview } from "../lib/team/teamService";
import type { Profile } from "../lib/team/types";
import CloudSignInForm from "./CloudSignInForm";

type TeamInvitationAcceptOverlayProps = {
  token: string;
  onDone: () => void;
  /** Test-only injection points — production usage passes none of these. */
  config?: CloudConfig;
  createAuthService?: (config: ConfiguredCloudConfig) => AuthService;
  createTeamService?: (config: ConfiguredCloudConfig) => TeamService;
};

const primaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-400";
const secondaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60";

function functionLabel(fn: string): string {
  if (fn === "team_admin") return "Team Admin";
  if (fn === "coach") return "Coach";
  if (fn === "training_lead") return "Training Lead";
  return fn;
}

function denialText(reason: string): string {
  switch (reason) {
    case "expired":
      return "This invitation link has expired.";
    case "revoked":
      return "This invitation was revoked by a Team Admin.";
    case "replaced":
      return "This invitation was replaced by a newer one — ask the Team Admin to resend it.";
    case "already_accepted":
      return "This invitation has already been accepted.";
    case "wrong_email":
      return "This invitation was sent to a different email address than the one you're signed in with.";
    default:
      return "This invitation link can no longer be used.";
  }
}

/**
 * The one entry point an emailed invitation link reaches — mounted from TrackerApp
 * when the root page's `inviteToken` query parameter is present (docs/adr/0022
 * Decision 11: this app has no server-side routing, so the accept link points back
 * at the single root page rather than a dedicated Next.js page route). Never calls
 * `previewInvitation`/`acceptInvitation` while signed out (requirement 164) — instead
 * renders the SAME email/OTP sign-in form `AccountControl` uses (`CloudSignInForm`,
 * driven by this component's own `AuthController` instance) directly inside the
 * overlay, so a signed-out recipient can complete sign-in without ever needing to
 * reach the header control behind this modal (docs/adr/0022 §Deep-Link Sign-In
 * Continuity). `token` is a stable prop for this component's whole lifetime — it is
 * never lost across that sign-in, since the overlay never unmounts to let the user
 * "go sign in elsewhere and come back."
 */
export default function TeamInvitationAcceptOverlay({
  token,
  onDone,
  config,
  createAuthService,
  createTeamService,
}: TeamInvitationAcceptOverlayProps) {
  const controller = useSupabaseAuthController({ config, createAuthService });
  const resolvedConfig = useMemo<CloudConfig>(() => config ?? resolveCloudConfig(), [config]);
  const teamService = useMemo<TeamService | null>(() => {
    if (resolvedConfig.status !== "configured") return null;
    return (createTeamService ?? createSupabaseTeamService)(resolvedConfig);
  }, [resolvedConfig, createTeamService]);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // `preview`/`profile` are null both before their fetch resolves and if it fails —
  // `error` is what distinguishes "still loading" (isSignedIn, nothing yet, no error)
  // from "failed" (error set) without a separate synchronous setState at effect start
  // (react-hooks/set-state-in-effect only allows setState from an async callback).
  const [profile, setProfile] = useState<Profile | "not_bootstrapped" | null>(null);
  const [displayNameInput, setDisplayNameInput] = useState("");
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptedTeamId, setAcceptedTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isSignedIn = controller.state.status === "signed_in";
  const hasProfile = profile !== null && profile !== "not_bootstrapped";
  const needsBootstrap = isSignedIn && profile === "not_bootstrapped";
  const isLoadingProfile = isSignedIn && profile === null && error === null;
  const isLoadingPreview = isSignedIn && hasProfile && preview === null && error === null;

  // Step 1 (spec §2/§12: "completes the minimum Profile bootstrap if needed, and
  // then accepts the invitation" — the invitation link is the vehicle carrying a
  // first-time invitee through account entry, never a dead end that requires an
  // unclaimed Profile workaround). Never calls previewInvitation before a Profile
  // exists — accept_invitation/preview_invitation both require one server-side.
  useEffect(() => {
    if (!isSignedIn || !teamService) return;
    let cancelled = false;
    teamService.getMyProfile().then((result) => {
      if (cancelled || !mountedRef.current) return;
      if (result.ok) {
        setProfile(result.value ?? "not_bootstrapped");
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, teamService]);

  // Step 2: once a Profile exists (already did, or was just bootstrapped below),
  // preview the SAME invitation this overlay was opened for.
  useEffect(() => {
    if (!isSignedIn || !teamService || !hasProfile) return;
    let cancelled = false;
    teamService.previewInvitation(token).then((result) => {
      if (cancelled || !mountedRef.current) return;
      if (result.ok) {
        setPreview(result.value);
      } else {
        setError(result.error.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, teamService, hasProfile, token]);

  function handleBootstrapProfile() {
    if (!teamService || !displayNameInput.trim()) return;
    setBusy(true);
    setError(null);
    teamService.bootstrapProfile(displayNameInput.trim()).then((result) => {
      if (!mountedRef.current) return;
      setBusy(false);
      if (result.ok) {
        setProfile(result.value);
      } else {
        setError(result.error.message);
      }
    });
  }

  function handleAccept() {
    if (!teamService) return;
    setBusy(true);
    setError(null);
    teamService.acceptInvitation(token).then((result) => {
      if (!mountedRef.current) return;
      setBusy(false);
      if (result.ok) {
        setAcceptedTeamId(result.value.teamId);
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">Team Invitation</h2>

        {resolvedConfig.status !== "configured" && (
          <p className="mt-3 text-sm text-slate-600">Cloud sign-in isn&apos;t available in this build.</p>
        )}

        {resolvedConfig.status === "configured" && !isSignedIn && (
          <div className="mt-3">
            <p className="text-sm text-slate-600">
              Sign in with the email address this invitation was sent to, to see and accept it.
            </p>
            <div className="mt-3">
              <CloudSignInForm controller={controller} testId="team-invitation-sign-in" />
            </div>
          </div>
        )}

        {resolvedConfig.status === "configured" && isSignedIn && acceptedTeamId && (
          <>
            <p className="mt-3 text-sm text-emerald-700">You&apos;ve joined the team.</p>
            <button type="button" onClick={onDone} className={`${primaryButtonClassName} mt-4 w-full`}>
              Continue
            </button>
          </>
        )}

        {resolvedConfig.status === "configured" && isSignedIn && !acceptedTeamId && needsBootstrap && (
          <div className="mt-3">
            <label className="text-sm font-medium text-slate-700" htmlFor="invitation-display-name">
              Choose a display name
            </label>
            <p className="mt-1 text-xs text-slate-500">Shown to your teammates — never your email address.</p>
            <input
              id="invitation-display-name"
              type="text"
              value={displayNameInput}
              onChange={(event) => setDisplayNameInput(event.target.value)}
              className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            />
            {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
            <button
              type="button"
              onClick={handleBootstrapProfile}
              disabled={busy || !displayNameInput.trim()}
              className={`${primaryButtonClassName} mt-3 w-full`}
            >
              Continue
            </button>
          </div>
        )}

        {resolvedConfig.status === "configured" && isSignedIn && !acceptedTeamId && !needsBootstrap && (
          <>
            {(isLoadingProfile || isLoadingPreview) && <p className="mt-3 text-sm text-slate-500">Loading…</p>}

            {profile === null && preview === null && error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {error}
              </p>
            )}

            {preview && preview.status === "invalid_token" && (
              <p className="mt-3 text-sm text-slate-600">This invitation link isn&apos;t valid.</p>
            )}

            {preview && preview.status === "denied" && (
              <p className="mt-3 text-sm text-slate-600">{denialText(preview.reason)}</p>
            )}

            {preview && preview.status === "ready_to_accept" && (
              <>
                <p className="mt-3 text-sm text-slate-600">
                  {(preview.inviterDisplayName ?? "A Team Admin")} invited you to join{" "}
                  <span className="font-medium text-slate-900">{preview.teamName}</span>.
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {[preview.participationAsPlayer ? "Player" : null, ...preview.proposedFunctions.map(functionLabel)]
                    .filter(Boolean)
                    .join(", ") || "Member"}
                </p>
                {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={handleAccept} disabled={busy} className={primaryButtonClassName}>
                    Accept
                  </button>
                  <button type="button" onClick={onDone} disabled={busy} className={secondaryButtonClassName}>
                    Not now
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {/* Every state except "ready_to_accept" (which has its own "Not now") and
            "accepted" (which has its own "Continue") must still be dismissible —
            not configured, not signed in, still loading, a fetch error, an invalid
            token, and every denial reason (including wrong_email, the single most
            likely real-world case: a forwarded invitation opened while signed in as
            someone else) all reach this fallback rather than leaving the overlay
            permanently blocking the app with no way out. */}
        {!(resolvedConfig.status === "configured" && isSignedIn && preview?.status === "ready_to_accept") && !acceptedTeamId && (
          <button type="button" onClick={onDone} className={`${secondaryButtonClassName} mt-4 w-full`}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
