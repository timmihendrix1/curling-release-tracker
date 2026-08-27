"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveCloudConfig, type CloudConfig, type ConfiguredCloudConfig } from "../lib/supabase/config";
import { createSupabaseTeamService } from "../lib/supabase/teamServiceFactory";
import type { TeamService } from "../lib/team/teamService";
import type { InvitationPreview } from "../lib/team/teamService";
import { useOptionalIdentity, type GateSession } from "./identity/IdentityProvider";

type TeamInvitationAcceptOverlayProps = {
  token: string;
  onDone: () => void;
  /** Test-only injection points — production usage passes none of these. */
  config?: CloudConfig;
  createTeamService?: (config: ConfiguredCloudConfig) => TeamService;
  identitySession?: GateSession;
  onRecoverWrongAccount?: () => void;
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
 * The invitation replay surface mounted only after the global identity gate is
 * ready. The root-level identity runtime captured and persisted `token` before any
 * authentication redirect; this component rechecks it server-side, never owns an
 * auth controller, and never creates a Profile.
 */
export default function TeamInvitationAcceptOverlay({
  token,
  onDone,
  config,
  createTeamService,
  identitySession,
  onRecoverWrongAccount,
}: TeamInvitationAcceptOverlayProps) {
  const identity = useOptionalIdentity();
  const session = identitySession ?? identity?.session ?? null;
  const recoverWrongAccount = onRecoverWrongAccount ?? (() => {
    void identity?.recoverInvitationAccount();
  });
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

  // `preview` is null both before its fetch resolves and if it fails —
  // `error` is what distinguishes "still loading" (signed in, nothing yet, no error)
  // from "failed" (error set) without a separate synchronous setState at effect start
  // (react-hooks/set-state-in-effect only allows setState from an async callback).
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [acceptedTeamId, setAcceptedTeamId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isLoadingPreview = session !== null && preview === null && error === null;

  // Global onboarding guarantees that a completed Profile exists before this
  // overlay can mount. Preview the same durable intent only after gate readiness.
  useEffect(() => {
    if (session === null || !teamService) return;
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
  }, [session, teamService, token]);

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

        {resolvedConfig.status === "configured" && session === null && (
          <div className="mt-3">
            <p className="text-sm text-slate-600">
              Complete athlete sign-in to see and accept this invitation.
            </p>
          </div>
        )}

        {resolvedConfig.status === "configured" && session !== null && acceptedTeamId && (
          <>
            <p className="mt-3 text-sm text-emerald-700">You&apos;ve joined the team.</p>
            <button type="button" onClick={onDone} className={`${primaryButtonClassName} mt-4 w-full`}>
              Continue
            </button>
          </>
        )}

        {resolvedConfig.status === "configured" && session !== null && !acceptedTeamId && (
          <>
            {isLoadingPreview && <p className="mt-3 text-sm text-slate-500">Loading invitation…</p>}

            {preview === null && error && (
              <p role="alert" className="mt-3 text-sm text-red-600">
                {error}
              </p>
            )}

            {preview && preview.status === "invalid_token" && (
              <p className="mt-3 text-sm text-slate-600">This invitation link isn&apos;t valid.</p>
            )}

            {preview && preview.status === "denied" && (
              <>
                <p className="mt-3 text-sm text-slate-600">{denialText(preview.reason)}</p>
                {preview.reason === "wrong_email" && (
                  <button
                    type="button"
                    className={`${primaryButtonClassName} mt-4 w-full`}
                    onClick={recoverWrongAccount}
                  >
                    Sign in with the invited account
                  </button>
                )}
              </>
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
        {!(resolvedConfig.status === "configured" && session !== null && preview?.status === "ready_to_accept") && !acceptedTeamId && (
          <button type="button" onClick={onDone} className={`${secondaryButtonClassName} mt-4 w-full`}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}
