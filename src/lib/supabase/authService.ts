// Pure contract for authentication and OAuth-callback provider mechanics —
// deliberately contains no `@supabase/supabase-js` import. UI, controller and
// (from Stage B0.2c onwards) coordinator code depend only on these types; the
// real implementation (supabaseAuthService.ts) and any test fake are injected,
// mirroring the TimingProvider/TimingResult boundary discipline in
// src/lib/timingProvider.ts (see ADR-0006): a test stand-in must implement
// this same contract, never a shortcut that feeds a different code path.
//
// SCOPE NOTE, binding on everything in this file (Stage B0.2b;
// docs/adr/0025-application-identity-gate-onboarding-completion-and-trusted-device-state.md).
// Everything here is *provider mechanics only*. No type below resolves an
// identity barrier, proves that a deliberate application transition succeeded,
// or authorizes application entry — not a `signed_in` normalized change, not
// an `authenticated` restore outcome, and not a successful callback exchange.
// Access is granted only by the `IdentityTransitionCoordinator` (ADR-0025
// Decision 1/3), which does not exist yet. This is exactly what makes the
// Supabase SDK's "persist the session, emit the event, *then* resolve"
// ordering harmless.

/** The minimum stable identity the rest of the app is allowed to see. Never
 * the full provider session, an access/refresh token, or the raw provider
 * user object. */
export type AccountIdentity = {
  accountScopeId: string;
  email: string | null;
};

export type NormalizedAuthErrorKind =
  | "invalid_input"
  | "request_failed"
  | "verification_failed"
  | "session_restore_failed"
  | "sign_out_failed"
  | "invalid_configuration"
  | "temporarily_unavailable"
  | "unexpected_error";

/** A user-facing message only — never a raw provider error, stack trace, or
 * internal request identifier. */
export type NormalizedAuthError = {
  kind: NormalizedAuthErrorKind;
  message: string;
};

export type AuthServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NormalizedAuthError };

export function authOk<T>(value: T): AuthServiceResult<T> {
  return { ok: true, value };
}

export function authFailed<T>(error: NormalizedAuthError): AuthServiceResult<T> {
  return { ok: false, error };
}

// One canonical copy per error kind, in this SDK-free module so that both the
// Supabase integration boundary and the (transitional) controller name the
// same user-facing sentence instead of each inventing its own wording. See
// docs/UX_WRITING_GUIDELINES.md: neutral, actionable, never a raw provider
// detail.
const FRIENDLY_MESSAGE: Record<NormalizedAuthErrorKind, string> = {
  invalid_input: "That doesn't look right — check the value and try again.",
  request_failed: "We couldn't send the code. Please try again.",
  verification_failed: "That code didn't work. Check it and try again.",
  session_restore_failed: "We couldn't restore your sign-in. Please sign in again.",
  sign_out_failed: "Sign-out didn't complete. Please try again.",
  invalid_configuration: "Cloud sign-in isn't configured correctly.",
  temporarily_unavailable: "Cloud sign-in is temporarily unavailable. Please try again shortly.",
  unexpected_error: "Something went wrong. Please try again.",
};

export function normalizedAuthError(kind: NormalizedAuthErrorKind): NormalizedAuthError {
  return { kind, message: FRIENDLY_MESSAGE[kind] };
}

/**
 * Session restoration resolves exactly one of five outcomes, never two
 * (ADR-0025 Decision 2). A transient offline condition and a definitive
 * revocation both surface from the provider as a null session with an error;
 * conflating them would either lock a legitimate offline device or admit a
 * revoked one. Classification happens **only** inside the Supabase
 * integration boundary, using the SDK's own typed predicates — never by
 * inspecting raw message text.
 */
export type SessionRestoreOutcome =
  | { kind: "authenticated"; identity: AccountIdentity }
  | { kind: "no_session" }
  | { kind: "temporarily_unavailable" }
  | { kind: "invalid_session" }
  | { kind: "restore_failed" };

/**
 * The closed set of normalized provider auth-change reasons (ADR-0025
 * Decision 3). Raw SDK event strings never escape the integration boundary,
 * and **no reason here — `signed_in` included — resolves a barrier or
 * produces a ready state.** Invalid or missing identity data fails closed
 * into `other`/`initial_session` with a null identity; an `AccountIdentity`
 * is never fabricated.
 */
export type NormalizedAuthChange =
  | { reason: "initial_session"; identity: AccountIdentity | null }
  | { reason: "signed_in"; identity: AccountIdentity }
  | { reason: "token_refreshed"; identity: AccountIdentity }
  | { reason: "user_updated"; identity: AccountIdentity }
  | { reason: "signed_out" }
  | { reason: "other"; identity: AccountIdentity | null };

/**
 * The result of preparing a Google authorization request without navigating
 * (ADR-0025 Decision 10). `flowId` is the provider's **non-secret** flow
 * selector — it selects a PKCE verifier slot in the SDK's own storage and
 * never contains the verifier itself. It is deliberately persisted by the
 * future attempt record; the verifier is not, and never is copied out of
 * SDK-owned storage (ADR-0025 §G).
 */
export type PreparedAuthorization = {
  authorizationUrl: string;
  flowId: string;
};

export type PrepareAuthorizationOutcome =
  | { kind: "prepared"; prepared: PreparedAuthorization }
  /** The caller's callback target is not a usable same-origin redirect. */
  | { kind: "invalid_redirect" }
  /** The installed SDK returned no usable flow selector, or the selector did
   * not round-trip into the authorization URL's redirect target. Google
   * sign-in fails closed rather than proceeding uncorrelatable. */
  | { kind: "flow_selector_unavailable" }
  | { kind: "temporarily_unavailable" }
  | { kind: "preparation_failed" };

export type NavigationOutcome = { kind: "navigating" } | { kind: "navigation_failed" };

export type ExchangeOutcome =
  | { kind: "exchanged"; identity: AccountIdentity }
  /** The claimed callback's selector is not the selector the caller declared
   * authoritative. Resolved **before** any provider call, because the SDK
   * removes the verifier a failed exchange selected — so exchanging a stale
   * callback against a newer attempt's selector would destroy that newer
   * attempt (ADR-0025 Decision 10). */
  | { kind: "selector_mismatch" }
  | { kind: "temporarily_unavailable" }
  | { kind: "exchange_failed" };

/**
 * A success callback claimed **exactly once** from the page-scoped capture
 * cell (supabaseCallbackCapture.ts).
 *
 * Both members are readable directly — the future coordinator compares
 * `flowId` against its persisted attempt, and the exchange boundary reads the
 * authorization code exactly once — but **neither appears in the claim's
 * serialized form**. `toJSON()` returns an empty object and both members are
 * non-enumerable, so `JSON.stringify`, a spread, `Object.entries`, a test
 * snapshot, or a structured logger that walks own enumerable properties cannot
 * carry either value. ADR-0025 §G makes this explicit for both: the
 * authorization code is callback-local and never logged or rendered, and the
 * selector — non-secret though it is — is "compared and discarded; never
 * logged or rendered". Nothing here restricts the separately approved future
 * persistence of a `flowId` inside an `InteractiveAuthAttempt`; that is a
 * deliberate durable write, not incidental serialization.
 */
export type ClaimedCallback = {
  readonly flowId: string;
  /** The authorization code on the first call, `null` on every later call, so
   * a replayed exchange reaches no provider. Also returns `null` once the
   * owning capture cell has been explicitly finalized. */
  readAuthorizationCode(): string | null;
  toJSON(): Record<string, never>;
};

/**
 * The narrow boundary the (transitional) auth controller and the components
 * that construct it depend on.
 *
 * Every **asynchronous** method resolves — never rejects — with a typed result
 * or a closed outcome, and every **synchronous** method returns a closed
 * outcome rather than throwing: the same never-throw discipline
 * `src/lib/persistence/types.ts` establishes for storage. The single, deliberate
 * exception is `onAuthChange`, whose synchronous *subscription construction* may
 * throw: it has no outcome channel to report a failure through, and swallowing
 * the failure would leave a caller believing it is subscribed when it is not.
 * Its caller is therefore responsible for containing that one case — see
 * `useSupabaseAuthController`'s `failSubscription`. The unsubscribe function it
 * returns does not throw and is idempotent.
 *
 * The discipline holds against hostile provider data too, not only against
 * ordinary failures: a `Session`, `User`, `id` or `email` backed by a throwing
 * getter or a Proxy trap produces a closed outcome (`restore_failed`, or the
 * already-defined null-identity normalized shape), never a rejection and never a
 * fabricated identity. And a *subscriber's* own exception is contained by the
 * implementation rather than propagated: it cannot reject `restoreSession()`
 * — which is where a held `initial_session` is delivered from — and cannot stop
 * another subscriber from receiving its change. No thrown value is inspected,
 * logged, or forwarded anywhere in any of these paths.
 */
export interface AuthService {
  /** ADR-0025 Decision 2's five-outcome classification. There is exactly one
   * session-classification path in this codebase, and it is behind this
   * method. */
  restoreSession(): Promise<SessionRestoreOutcome>;
  /** Subscribes to normalized provider auth-state changes; returns an
   * unsubscribe function that is idempotent (calling it twice reaches the
   * provider once) and never throws, even if the provider's own unsubscribe
   * does. This is the one method whose *subscription construction* may throw —
   * see the interface note above; the caller must contain that. */
  onAuthChange(listener: (change: NormalizedAuthChange) => void): () => void;
  requestEmailOtp(email: string): Promise<AuthServiceResult<void>>;
  verifyEmailOtp(email: string, token: string): Promise<AuthServiceResult<AccountIdentity>>;
  signOut(): Promise<AuthServiceResult<void>>;
}

/**
 * The complete provider-mechanics surface. `AuthService` above is the subset
 * the transitional `useSupabaseAuthController` (retired in Stage B0.2e) and
 * its four component owners depend on; the three operations added here exist
 * for the future `IdentityTransitionCoordinator` alone. This is one contract
 * extended, not a second competing contract: there is exactly one production
 * implementation (supabaseAuthService.ts) and exactly one classification path
 * behind it.
 */
export interface AuthProviderMechanics extends AuthService {
  /**
   * Obtains the provider authorization URL and its non-secret flow selector
   * **without navigating** and **without establishing any application
   * identity**. The selector does not exist until this returns, which is why
   * ADR-0025 Decision 10's start sequence is barrier → prepare → validate →
   * persist the attempt → validate → navigate.
   */
  prepareGoogleSignIn(redirectTo: string): Promise<PrepareAuthorizationOutcome>;
  /** Revalidates the prepared authorization URL and only then navigates.
   * Resolves `navigation_failed` rather than throwing, and performs zero
   * navigation when revalidation fails. */
  navigateToAuthorizationUrl(prepared: PreparedAuthorization): NavigationOutcome;
  /**
   * Exchanges a claimed success callback using an **explicit** flow selector.
   * The caller alone decides whether `expectedFlowId` is authoritative; this
   * boundary only refuses to proceed when the claim disagrees with it. The
   * SDK's no-selector exchange form is never used anywhere, because it would
   * consume the most recently stored verifier.
   */
  exchangeCorrelatedCallback(
    claim: ClaimedCallback,
    expectedFlowId: string
  ): Promise<ExchangeOutcome>;
}
