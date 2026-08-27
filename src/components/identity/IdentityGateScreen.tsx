"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useIdentity } from "./IdentityProvider";

const fieldClassName =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:bg-slate-100";
const primaryButtonClassName =
  "min-h-11 w-full rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:bg-slate-400";
const secondaryButtonClassName =
  "min-h-11 w-full rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 disabled:cursor-not-allowed disabled:opacity-60";

const PROGRESS_COPY: Partial<Record<string, string>> = {
  intaking_oauth_return: "Checking access…",
  restoring_identity: "Restoring your account…",
  establishing_identity_barrier: "Preparing sign-in…",
  preparing_google_flow: "Preparing Google sign-in…",
  persisting_google_attempt: "Preparing Google sign-in…",
  navigating_to_provider: "Opening Google sign-in…",
  requesting_otp: "Sending your code…",
  verifying_otp: "Checking your code…",
  consuming_oauth_return: "Completing sign-in…",
  finalizing_identity: "Completing sign-in…",
  ensuring_profile: "Preparing your profile…",
  resolving_gate_facts: "Checking your profile…",
  submitting_onboarding: "Creating your athlete profile…",
  refreshing_legal_snapshot: "Checking the current documents…",
  establishing_trusted_state: "Securing access on this device…",
  signing_out: "Signing out…",
};

const ERROR_COPY: Record<string, string> = {
  barrier_not_established: "Sign-in could not start safely on this device.",
  attempt_not_persisted: "Sign-in could not be prepared safely on this device.",
  intent_state_not_persisted: "The requested Team link could not be kept safely.",
  trusted_state_not_invalidated: "Access is locked, but this device could not save the full sign-out state.",
  trusted_state_not_established: "Your account is ready, but trusted access could not be saved on this device.",
  preparation_failed: "Google sign-in could not be prepared.",
  navigation_failed: "Google sign-in could not be opened.",
  provider_error: "Sign-in could not be completed. Please try again.",
  ambiguous_callback: "That sign-in link could not be used. Please sign in again.",
  malformed_callback: "That sign-in link could not be used. Please sign in again.",
  unowned_callback: "That sign-in link could not be used. Please sign in again.",
  replayed_callback: "That sign-in link has already been used.",
  exchange_failed: "That sign-in link could not be completed. Please sign in again.",
  temporarily_unavailable: "The service is temporarily unavailable. Check your connection and try again.",
  correlation_changed: "A newer sign-in attempt replaced this one. Please try again.",
  barrier_resolution_failed: "Sign-in completed, but trusted access could not be established on this device.",
  durable_denial_unavailable: "Access is locked for now. This device could not confirm that the lock will survive a reload.",
  superseded: "A newer account action replaced this one.",
  invalid_input: "Check the information and try again.",
  submission_failed: "Your athlete profile could not be completed. Please try again.",
};

function GateFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-2rem)] items-center justify-center py-4">
      <section
        aria-labelledby="identity-gate-title"
        className="w-full rounded-2xl bg-white p-5 shadow-lg sm:p-6"
      >
        <p className="text-sm font-medium text-slate-500">Curling Performance</p>
        <h1 id="identity-gate-title" className="mt-1 text-2xl font-semibold text-slate-900">
          Athlete access
        </h1>
        {children}
      </section>
    </div>
  );
}

function LegalLink({ href, label, version }: { href: string; label: string; version: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-h-11 items-center rounded px-1 text-sm font-medium text-slate-700 underline decoration-slate-400 underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
    >
      {label} ({version})
    </a>
  );
}

function SignInChoices({ privacyHref, privacyVersion }: { privacyHref?: string; privacyVersion?: string }) {
  const identity = useIdentity();
  const emailId = useId();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submitEmail(event: React.FormEvent) {
    event.preventDefault();
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    void identity.requestEmailOtp(normalized);
  }

  return (
    <div className="mt-5 space-y-4">
      <button type="button" className={primaryButtonClassName} onClick={() => void identity.startGoogleSignIn()}>
        Continue with Google
      </button>
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs text-slate-500">or</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <form noValidate onSubmit={submitEmail} className="space-y-3">
        <div>
          <label htmlFor={emailId} className="text-sm font-medium text-slate-700">
            Email address
          </label>
          <input
            id={emailId}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setError(null);
            }}
            className={`${fieldClassName} mt-1.5`}
          />
          {error && <p role="alert" className="mt-1.5 text-sm text-red-700">{error}</p>}
        </div>
        <button type="submit" className={secondaryButtonClassName}>Send sign-in code</button>
      </form>
      {privacyHref && privacyVersion && (
        <p className="text-sm text-slate-600">
          Review the current{" "}
          <a
            href={privacyHref}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            Privacy Notice ({privacyVersion})
          </a>
          {" "}before continuing.
        </p>
      )}
    </div>
  );
}

function OtpForm() {
  const identity = useIdentity();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(token)) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setError(null);
    void identity.verifyEmailOtp(token);
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-4">
      <div>
        <label htmlFor={inputId} className="text-sm font-medium text-slate-700">6-digit code</label>
        <p className="mt-1 text-sm text-slate-600">Sent to {identity.emailForOtp}.</p>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={token}
          onChange={(event) => {
            setToken(event.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
          className={`${fieldClassName} mt-2 text-center text-xl tracking-[0.35em]`}
        />
        {error && <p role="alert" className="mt-1.5 text-sm text-red-700">{error}</p>}
      </div>
      <button type="submit" className={primaryButtonClassName}>Verify code</button>
      <button
        type="button"
        className={secondaryButtonClassName}
        onClick={() => window.location.reload()}
      >
        Use a different email
      </button>
    </form>
  );
}

type DisplayedLegalDocument = {
  href: string;
  versionLabel: string;
};

function OnboardingSubmissionForm({
  displayName,
  onDisplayNameChange,
  terms,
  privacy,
}: {
  displayName: string;
  onDisplayNameChange(value: string): void;
  terms: DisplayedLegalDocument;
  privacy: DisplayedLegalDocument;
}) {
  const identity = useIdentity();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayNameId = useId();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = displayName.trim();
    if (normalized.length === 0 || normalized.length > 80) {
      setError("Enter a display name of 80 characters or fewer.");
      return;
    }
    if (!termsAccepted || !privacyAcknowledged) {
      setError("Accept the Terms and acknowledge the Privacy Notice to continue.");
      return;
    }
    setError(null);
    void identity.submitOnboarding({
      displayName: normalized,
      termsAccepted,
      privacyAcknowledged,
    });
  }

  return (
    <form noValidate onSubmit={submit} className="mt-5 space-y-5">
      <div>
        <label htmlFor={displayNameId} className="text-sm font-medium text-slate-700">Display Name</label>
        <p className="mt-1 text-sm text-slate-600">This is the name teammates will see.</p>
        <input
          id={displayNameId}
          type="text"
          autoComplete="name"
          maxLength={80}
          value={displayName}
          onChange={(event) => {
            onDisplayNameChange(event.target.value);
            setError(null);
          }}
          className={`${fieldClassName} mt-1.5`}
        />
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900">Required documents</legend>
        <div className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
          <input
            id={`${displayNameId}-terms`}
            type="checkbox"
            checked={termsAccepted}
            onChange={(event) => {
              setTermsAccepted(event.target.checked);
              setError(null);
            }}
            className="mt-1 h-5 w-5"
          />
          <span>
            <label htmlFor={`${displayNameId}-terms`}>I accept the </label>
            <LegalLink
              href={terms.href}
              label="Terms of Service"
              version={terms.versionLabel}
            />
          </span>
        </div>
        <div className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
          <input
            id={`${displayNameId}-privacy`}
            type="checkbox"
            checked={privacyAcknowledged}
            onChange={(event) => {
              setPrivacyAcknowledged(event.target.checked);
              setError(null);
            }}
            className="mt-1 h-5 w-5"
          />
          <span>
            <label htmlFor={`${displayNameId}-privacy`}>I acknowledge the </label>
            <LegalLink
              href={privacy.href}
              label="Privacy Notice"
              version={privacy.versionLabel}
            />
          </span>
        </div>
      </fieldset>

      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" className={primaryButtonClassName}>Create athlete profile</button>
    </form>
  );
}

function OnboardingForm({
  displayName,
  onDisplayNameChange,
}: {
  displayName: string;
  onDisplayNameChange(value: string): void;
}) {
  const identity = useIdentity();
  const state = identity.state;

  if (state.kind !== "onboarding_required" || state.legal.terms === null || state.legal.privacy === null) {
    return null;
  }

  const legalKey = `${state.legal.terms.versionLabel}:${state.legal.privacy.versionLabel}`;
  return (
    <OnboardingSubmissionForm
      key={legalKey}
      displayName={displayName}
      onDisplayNameChange={onDisplayNameChange}
      terms={state.legal.terms}
      privacy={state.legal.privacy}
    />
  );
}

function RetryAuthentication() {
  return <SignInChoices />;
}

export default function IdentityGateScreen() {
  const identity = useIdentity();
  const { state } = identity;
  // The gate screen stays mounted while onboarding temporarily renders progress.
  // Keeping only the draft name here preserves it across a stale-version round
  // trip; the keyed confirmation controls still reset for every new snapshot.
  const [onboardingDisplayName, setOnboardingDisplayName] = useState("");

  if (state.kind === "signed_out") {
    return (
      <GateFrame>
        <p className="mt-3 text-sm text-slate-600">Sign in to train and keep your performance history connected to your athlete profile.</p>
        {state.callbackNotice === "unusable_link" && (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            That sign-in link could not be used. Please sign in again.
          </p>
        )}
        <SignInChoices
          privacyHref={state.legal.privacy?.href}
          privacyVersion={state.legal.privacy?.versionLabel}
        />
      </GateFrame>
    );
  }

  if (state.kind === "awaiting_otp") {
    return <GateFrame><p className="mt-3 text-sm text-slate-600">Enter the code to continue.</p><OtpForm /></GateFrame>;
  }

  if (state.kind === "onboarding_required") {
    return (
      <GateFrame>
        <p className="mt-3 text-sm text-slate-600">Complete the minimum profile required to use the platform.</p>
        <OnboardingForm
          displayName={onboardingDisplayName}
          onDisplayNameChange={setOnboardingDisplayName}
        />
      </GateFrame>
    );
  }

  if (state.kind === "legal_unavailable") {
    return (
      <GateFrame>
        <p className="mt-3 text-sm text-slate-600">Sign-in is not available yet because the current Privacy Notice is unavailable.</p>
        <p className="mt-2 text-sm text-slate-500">No email address is collected in this state.</p>
        <button type="button" className={`${secondaryButtonClassName} mt-5`} onClick={() => void identity.refreshLegalSnapshot()}>
          Check again
        </button>
      </GateFrame>
    );
  }

  if (state.kind === "onboarding_blocked_legal") {
    return (
      <GateFrame>
        <p className="mt-3 text-sm text-slate-600">Your profile cannot be completed because the current Terms of Service are unavailable.</p>
        {state.legal.privacy && (
          <div className="mt-3"><LegalLink href={state.legal.privacy.href} label="Privacy Notice" version={state.legal.privacy.versionLabel} /></div>
        )}
        <button type="button" className={`${secondaryButtonClassName} mt-5`} onClick={() => void identity.refreshLegalSnapshot()}>
          Check again
        </button>
      </GateFrame>
    );
  }

  if (state.kind === "identity_unconfirmed") {
    return (
      <GateFrame>
        <p className="mt-3 text-sm text-slate-600">Your identity could not be confirmed. Existing trusted information remains on this device.</p>
        <button type="button" className={`${primaryButtonClassName} mt-5`} onClick={() => void identity.retryTrustedState()}>
          Try again
        </button>
      </GateFrame>
    );
  }

  if (state.kind === "recoverable_error") {
    return (
      <GateFrame>
        <p role="alert" className="mt-3 text-sm text-slate-700">{ERROR_COPY[state.reason] ?? "The account action could not be completed safely."}</p>
        {state.reason === "intent_state_not_persisted" ? (
          <button type="button" className={`${secondaryButtonClassName} mt-5`} onClick={() => window.location.reload()}>
            Retry this Team link
          </button>
        ) : state.reason === "trusted_state_not_established" ? (
          <button type="button" className={`${primaryButtonClassName} mt-5`} onClick={() => void identity.retryTrustedState()}>
            Try again
          </button>
        ) : (
          <RetryAuthentication />
        )}
      </GateFrame>
    );
  }

  if (state.kind === "quarantined_locked" || state.kind === "locked") {
    return (
      <GateFrame>
        <p className="mt-3 text-sm text-slate-600">Access is locked on this device. Complete a fresh sign-in to continue.</p>
        {state.callbackNotice === "unusable_link" && (
          <p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">That sign-in link could not be used.</p>
        )}
        <RetryAuthentication />
      </GateFrame>
    );
  }

  if (state.kind === "storage_unavailable_locked") {
    return (
      <GateFrame>
        <p role="alert" className="mt-3 text-sm text-slate-600">Access is locked for this page. The device could not confirm that the lock will survive a reload.</p>
        <button type="button" className={`${secondaryButtonClassName} mt-5`} onClick={() => window.location.reload()}>Reload</button>
      </GateFrame>
    );
  }

  if (state.kind === "cloud_unavailable") {
    return (
      <GateFrame>
        <p className="mt-3 text-sm text-slate-600">Athlete sign-in is unavailable in this build. The training application remains locked.</p>
      </GateFrame>
    );
  }

  return (
    <GateFrame>
      <p aria-live="polite" className="mt-4 text-sm text-slate-600">
        {PROGRESS_COPY[state.kind] ?? "Preparing athlete access…"}
      </p>
    </GateFrame>
  );
}
