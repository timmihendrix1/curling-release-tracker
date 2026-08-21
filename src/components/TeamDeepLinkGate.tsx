"use client";

import { useEffect, useState } from "react";
import TeamInvitationAcceptOverlay from "./TeamInvitationAcceptOverlay";
import CloudSignInForm from "./CloudSignInForm";
import { useSupabaseAuthController } from "../lib/supabase/useSupabaseAuthController";
import type { AuthService } from "../lib/supabase/authService";
import type { CloudConfig, ConfiguredCloudConfig } from "../lib/supabase/config";

type TeamDeepLinkGateProps = {
  /** An `adminRequestId` link has no secret token (docs/adr/0022 Decision 4) and the
   * exact same accept action is already available, with fuller context (team name),
   * in Teams > Notifications/Pending Admin Requests — so once the caller is actually
   * signed in, this deep link simply opens Teams rather than duplicating a second,
   * weaker accept UI. */
  onAdminRequestLink: () => void;
  /** Test-only injection points, forwarded to this component's own
   * `useSupabaseAuthController` instance AND to `TeamInvitationAcceptOverlay` (which
   * constructs its own, separate instance backed by the same underlying service) —
   * production usage passes neither. */
  config?: CloudConfig;
  createAuthService?: (config: ConfiguredCloudConfig) => AuthService;
};

const secondaryButtonClassName =
  "min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60";

function clearDeepLinkQueryParams(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("inviteToken");
  url.searchParams.delete("adminRequestId");
  window.history.replaceState(null, "", url.toString());
}

/**
 * Reads the root page's own query string for the two Team Foundation email-link
 * entry points (docs/adr/0022 Decision 11) — this app has no server-side routing
 * (docs/adr/0009), so both links point back at `/` rather than a dedicated page.
 * Reads `window.location` directly inside an effect, rather than `next/navigation`'s
 * `useSearchParams` — this is a browser-only concern with no server-rendered variant
 * to keep in sync, and avoids requiring a Suspense boundary and an App Router context
 * that plain component-render tests (no Next.js router) don't provide.
 *
 * `adminRequestId` retains its intent while the caller is signed out (docs/adr/0022
 * §Deep-Link Sign-In Continuity) — this used to fire `onAdminRequestLink` and clear
 * the query parameter unconditionally at mount, which silently discarded the deep
 * link's whole purpose for a signed-out recipient (by the time they found and used
 * the header sign-in control, the parameter identifying which request to look at was
 * already gone). Now, while cloud is genuinely available but the caller isn't signed
 * in yet, this renders its own small sign-in prompt (the same `CloudSignInForm` the
 * invitation overlay and header both use) and holds the parameter until sign-in
 * completes, only then calling `onAdminRequestLink` and clearing it. When cloud
 * itself is unavailable (disabled/misconfigured), there is no sign-in step to wait
 * for — the Team feature this link points at doesn't exist either way — so this
 * falls back to the original immediate behavior rather than waiting forever.
 */
export default function TeamDeepLinkGate({ onAdminRequestLink, config, createAuthService }: TeamDeepLinkGateProps) {
  const controller = useSupabaseAuthController({ config, createAuthService });
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [pendingAdminRequestId, setPendingAdminRequestId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Deferred one microtask, matching this codebase's sanctioned "setState from a
    // callback, never synchronously in the effect body" pattern (see
    // TrackerApp.tsx's own mount-time hydration effect) — there is no real async
    // operation here, only a window.location read, but the rule applies regardless
    // of whether the callback's delay is a real I/O wait or a deliberate microtask.
    Promise.resolve().then(() => {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const adminRequestId = params.get("adminRequestId");
      const invite = params.get("inviteToken");
      if (adminRequestId) {
        setPendingAdminRequestId(adminRequestId);
      } else if (invite) {
        setInviteToken(invite);
      }
    });
    // Intentionally runs once on mount only — this reads the URL the page was
    // opened with, not a live-updating subscription.
    return () => {
      cancelled = true;
    };
  }, []);

  const isSignedIn = controller.state.status === "signed_in";
  const cloudUnavailable = controller.state.status === "cloud_disabled" || controller.state.status === "invalid_configuration";

  useEffect(() => {
    if (!pendingAdminRequestId) return;
    if (!isSignedIn && !cloudUnavailable) return;
    // Deferred, matching this component's own mount-effect pattern above and this
    // codebase's sanctioned "setState from a callback, never synchronously in the
    // effect body" rule (react-hooks/set-state-in-effect) — there is no real async
    // work here, only a microtask hop.
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      onAdminRequestLink();
      clearDeepLinkQueryParams();
      setPendingAdminRequestId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [pendingAdminRequestId, isSignedIn, cloudUnavailable, onAdminRequestLink]);

  if (inviteToken) {
    return (
      <TeamInvitationAcceptOverlay
        token={inviteToken}
        onDone={() => {
          setInviteToken(null);
          clearDeepLinkQueryParams();
        }}
        config={config}
        createAuthService={createAuthService}
      />
    );
  }

  if (pendingAdminRequestId && !isSignedIn && !cloudUnavailable) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
        <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
          <h2 className="text-xl font-semibold text-slate-900">Team Admin Request</h2>
          <p className="mt-3 text-sm text-slate-600">
            Sign in with the email address this request was sent to, to see and respond to it.
          </p>
          <div className="mt-3">
            <CloudSignInForm controller={controller} testId="admin-request-sign-in" />
          </div>
          {/* A deliberate, explicit dismissal may clear the pending intent — a
              recoverable sign-in error rendered by CloudSignInForm above does not,
              since it never calls this handler on its own. */}
          <button
            type="button"
            onClick={() => {
              setPendingAdminRequestId(null);
              clearDeepLinkQueryParams();
            }}
            className={`${secondaryButtonClassName} mt-4 w-full`}
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return null;
}
