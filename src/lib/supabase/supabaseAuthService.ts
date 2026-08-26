// One of the production files permitted to import `@supabase/supabase-js`
// (the others are supabaseClient.ts and the server-only
// supabaseServerClient.ts). This is the only place `getSession`,
// `onAuthStateChange`, `signInWithOtp`, `verifyOtp`, `signInWithOAuth`,
// `exchangeCodeForSession` and `signOut` are called, and the only place the
// SDK's typed error predicates are consulted.
//
// Every asynchronous method resolves — never rejects — and every synchronous
// method returns a closed outcome rather than throwing, including when a value
// or dependency handed in by the caller throws on property access. The single
// deliberate exception is `onAuthChange`'s synchronous subscription
// construction, which has no outcome channel and must not silently pretend to
// have subscribed; its caller contains that (see authService.ts's note and
// `useSupabaseAuthController`'s `failSubscription`). The unsubscribe function it
// returns is idempotent and never throws.
//
// Nothing past this boundary ever sees a raw provider error, a raw SDK event
// string, an access/refresh token, a PKCE verifier, an authorization code, or
// the full session: only `AccountIdentity`, a closed outcome, and a normalized,
// static, user-facing error message.
//
// SCOPE NOTE (Stage B0.2b; docs/adr/0025). Everything here is provider
// mechanics. No outcome below resolves an identity barrier or authorizes
// application entry — including `authenticated`, `signed_in` and `exchanged`.
// The future IdentityTransitionCoordinator alone decides that, and it alone
// decides whether an `expectedFlowId` is authoritative.
import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type AuthChangeEvent,
  type Session,
} from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./supabaseClient";
import type { ConfiguredCloudConfig } from "./config";
import type {
  AccountIdentity,
  AuthProviderMechanics,
  AuthServiceResult,
  ClaimedCallback,
  ExchangeOutcome,
  NavigationOutcome,
  NormalizedAuthChange,
  PrepareAuthorizationOutcome,
  PreparedAuthorization,
  SessionRestoreOutcome,
} from "./authService";
import { authFailed, authOk, normalizedAuthError } from "./authService";
import { hasWhitespaceOrControl, isValidFlowSelector } from "./supabaseCallbackClassifier";

/** The reserved parameter name the SDK appends to a redirect target when
 * `experimental.appendPkceFlowIdToRedirects` is on (`PKCE_FLOW_ID_PARAM` in
 * `@supabase/auth-js`, which does not export it). */
const FLOW_SELECTOR_PARAM = "sb_flow_id";


/**
 * The result of reducing a provider `Session` to the minimum stable identity.
 * Three states, not two, because "there is no session" and "there is a session
 * whose identity data cannot be read or used" are different facts that must not
 * be conflated: the first is an ordinary signed-out condition, the second is a
 * failure, and treating the second as the first would report a broken provider
 * value as a clean absence.
 */
type IdentityReduction =
  | { kind: "identity"; identity: AccountIdentity }
  | { kind: "no_session" }
  | { kind: "unusable" };

/**
 * The only place a provider `Session`/`User` is read — reduced immediately to the
 * minimum stable identity, never passed upward as-is, and never fabricating an
 * `AccountIdentity` the provider did not supply.
 *
 * Every property read is contained. A `Session`, `User`, `id` or `email` backed
 * by a throwing getter or a hostile Proxy trap must not turn a closed outcome
 * into a rejected promise or an escaping exception — this boundary's whole
 * purpose is that callers only ever see closed outcomes. The thrown value is
 * never inspected, logged, serialized, or forwarded: it simply makes the
 * reduction `unusable`.
 */
function reduceToIdentity(session: unknown): IdentityReduction {
  // Truthiness alone triggers no getter and no Proxy trap, so this stays exact
  // for a genuinely absent session.
  if (!session) return { kind: "no_session" };
  try {
    const user = (session as { user?: unknown }).user;
    if (!user) return { kind: "unusable" };
    const accountScopeId = (user as { id?: unknown }).id;
    if (typeof accountScopeId !== "string" || accountScopeId.length === 0) {
      return { kind: "unusable" };
    }
    const email = (user as { email?: unknown }).email;
    return {
      kind: "identity",
      identity: {
        accountScopeId,
        email: typeof email === "string" && email.length > 0 ? email : null,
      },
    };
  } catch {
    return { kind: "unusable" };
  }
}

/** The identity, or `null` for both absence and unusability — the shape the
 * normalized-change helpers need, where the two collapse to the same
 * already-defined fail-closed result. */
function identityOrNull(session: unknown): AccountIdentity | null {
  const reduction = reduceToIdentity(session);
  return reduction.kind === "identity" ? reduction.identity : null;
}

/**
 * How a provider failure is classified — **only** by the SDK's own typed
 * predicates, never by inspecting message text. "An error is present" is not
 * equivalent to "temporarily unavailable": a transient offline condition and a
 * definitive revocation both surface as a null session with an error, and
 * conflating them would either lock a legitimate offline device out or admit a
 * revoked one (ADR-0025 Decision 2).
 */
type ProviderFailureClass = "retryable" | "definitively_invalid" | "unrecognized";

function classifyProviderFailure(error: unknown): ProviderFailureClass {
  try {
    if (isAuthRetryableFetchError(error)) return "retryable";
    if (isAuthApiError(error) || isAuthSessionMissingError(error)) return "definitively_invalid";
  } catch {
    // The SDK's predicates use the `in` operator, so a hostile Proxy's `has`
    // trap can throw. A value that cannot even be classified is not
    // classifiable as retryable or definitive — it falls through to
    // `unrecognized`, and nothing about the thrown value escapes.
  }
  return "unrecognized";
}

function isUsableUrl(value: string): URL | null {
  if (hasWhitespaceOrControl(value) || value !== value.trim()) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.hostname.length === 0) return null;
  // Embedded credentials in a URL this code is about to navigate to, or hand
  // to the provider as a redirect target, are never legitimate here.
  if (url.username !== "" || url.password !== "") return null;
  return url;
}

/**
 * A callback target is accepted only when it is an ordinary absolute URL on
 * **this application's own origin**: the callback has to come back to this
 * app, and validating that here means a misconfigured or attacker-supplied
 * target cannot be handed to the provider as a redirect.
 *
 * A target that already carries `sb_flow_id` is refused: the SDK appends its
 * own, and two occurrences would classify the eventual return as an ambiguous
 * callback (supabaseCallbackClassifier.ts) — a lockout, discovered only after
 * the round trip.
 */
function isValidRedirectTarget(redirectTo: unknown, appOrigin: string | null): boolean {
  if (typeof redirectTo !== "string") return false;
  const url = isUsableUrl(redirectTo);
  if (!url) return false;
  if (url.hash !== "") return false;
  if (url.searchParams.has(FLOW_SELECTOR_PARAM)) return false;
  // Preparation is a browser-only operation: with no resolvable app origin
  // there is nothing to prove same-origin against, so it fails closed.
  if (appOrigin === null) return false;
  return url.origin === appOrigin;
}

// ---------------------------------------------------------------------------
// The ONE strict authorization-URL validator, used by BOTH preparation and
// navigation (ADR-0025 Decision 10). "It is on the right origin" is nowhere
// near enough: a same-origin URL can point at a different endpoint, name a
// different provider, carry an external or missing redirect target, carry a
// selector belonging to a different flow, or have lost its PKCE challenge — and
// every one of those would either send a person somewhere unintended or produce
// a return that cannot be correlated. Navigation is the last checkpoint before
// the page is gone, so it revalidates the complete route rather than trusting
// what preparation returned: the value travelled through the caller in between,
// and may have crossed durable writes and further checkpoints.
// ---------------------------------------------------------------------------

/** The provider's authorization endpoint, relative to the configured Supabase
 * URL. The SDK builds `${supabaseUrl}/auth/v1/authorize`. */
const AUTHORIZE_PATH_SUFFIX = "/auth/v1/authorize";

/** The only provider this app starts an authorization flow with. */
const REQUIRED_PROVIDER = "google";

/** The SDK emits a lowercase `s256` when a WebCrypto digest is available and
 * `plain` when it is not. `plain` is refused: an unhashed challenge is not the
 * PKCE protection this design depends on. Compared case-insensitively so a
 * future SDK spelling change fails open on case only, never on substance. */
const REQUIRED_CODE_CHALLENGE_METHOD = "s256";

/** Parameters whose duplication would make the authorization request
 * ambiguous — two answers to one security-relevant question is never something
 * to pick a winner from. */
const SINGLE_VALUED_AUTHORIZE_PARAMS = [
  "provider",
  "redirect_to",
  "code_challenge",
  "code_challenge_method",
] as const;

/**
 * Why a rejection is split in two: a selector problem means the flow could not
 * be correlated (the SDK stopped returning a usable id, the flag stopped
 * appending it, or the id belongs to another flow) and Google sign-in must fail
 * closed as `flow_selector_unavailable`. Everything else is a structural or
 * routing problem and is an ordinary `preparation_failed`. Navigation collapses
 * both into `navigation_failed`, because from there the only safe action is not
 * to navigate.
 */
type AuthorizationUrlRejection = "selector" | "structure";

type AuthorizationUrlValidation =
  | {
      ok: true;
      /** The exact validated string, so navigation uses it verbatim rather
       * than a re-serialized copy. */
      authorizationUrl: string;
      /** The redirect target the provider will return to, proven safe,
       * same-origin, and carrying exactly the expected selector. */
      effectiveRedirectTo: URL;
    }
  | { ok: false; reason: AuthorizationUrlRejection };

function rejected(reason: AuthorizationUrlRejection): AuthorizationUrlValidation {
  return { ok: false, reason };
}

/** The authorization endpoint expected for this configuration, derived from the
 * configured URL rather than hard-coded, so a Supabase URL carrying a path
 * prefix is handled instead of being falsely rejected. */
function expectedAuthorizePath(configured: URL): string {
  const base = configured.pathname.endsWith("/")
    ? configured.pathname.slice(0, -1)
    : configured.pathname;
  return `${base}${AUTHORIZE_PATH_SUFFIX}`;
}

/** A stable, order-insensitive rendering of a query string, for proving that
 * one parameter set is exactly another plus nothing. */
function normalizedQuery(params: URLSearchParams): string {
  return JSON.stringify(
    [...params].sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  );
}

function validateAuthorizationUrl(
  authorizationUrl: unknown,
  expectation: { configuredSupabaseUrl: string; appOrigin: string | null; flowId: unknown }
): AuthorizationUrlValidation {
  // A selector this code cannot even name is a correlation failure, not a
  // routing one.
  if (!isValidFlowSelector(expectation.flowId)) return rejected("selector");
  if (typeof authorizationUrl !== "string") return rejected("structure");
  // Without a resolvable application origin there is nothing to prove the
  // redirect target against, so this fails closed rather than guessing.
  if (expectation.appOrigin === null) return rejected("structure");

  const url = isUsableUrl(authorizationUrl);
  const configured = isUsableUrl(expectation.configuredSupabaseUrl);
  if (!url || !configured) return rejected("structure");
  // A fragment on an authorization URL is never something the SDK produces and
  // never something worth forwarding.
  if (url.hash !== "") return rejected("structure");
  if (url.origin !== configured.origin) return rejected("structure");
  // Exact endpoint, not merely the right host: a same-origin path is not the
  // authorization route.
  if (url.pathname !== expectedAuthorizePath(configured)) return rejected("structure");

  for (const param of SINGLE_VALUED_AUTHORIZE_PARAMS) {
    if (url.searchParams.getAll(param).length !== 1) return rejected("structure");
  }
  if (url.searchParams.get("provider") !== REQUIRED_PROVIDER) return rejected("structure");

  // The PKCE shape must still be intact: without a challenge, or with an
  // unhashed one, the exchange this flow depends on is not protected.
  const challenge = url.searchParams.get("code_challenge");
  if (challenge === null || challenge.length === 0 || hasWhitespaceOrControl(challenge)) {
    return rejected("structure");
  }
  const method = url.searchParams.get("code_challenge_method");
  if (method === null || method.toLowerCase() !== REQUIRED_CODE_CHALLENGE_METHOD) {
    return rejected("structure");
  }

  // The redirect target must be an ordinary, credential-free absolute URL on
  // THIS application's own origin. An external target would hand the provider's
  // response to someone else.
  const effectiveRedirectTo = isUsableUrl(url.searchParams.get("redirect_to") ?? "");
  if (!effectiveRedirectTo) return rejected("structure");
  if (effectiveRedirectTo.hash !== "") return rejected("structure");
  if (effectiveRedirectTo.origin !== expectation.appOrigin) return rejected("structure");

  // Exactly one selector, well-formed, and bound to the flow the caller holds.
  // If `appendPkceFlowIdToRedirects` silently stopped working the return would
  // carry no selector at all — caught here, before anyone leaves the page,
  // rather than after the round trip.
  const selectors = effectiveRedirectTo.searchParams.getAll(FLOW_SELECTOR_PARAM);
  if (selectors.length !== 1) return rejected("selector");
  if (!isValidFlowSelector(selectors[0])) return rejected("selector");
  if (selectors[0] !== expectation.flowId) return rejected("selector");

  return { ok: true, authorizationUrl, effectiveRedirectTo };
}

/**
 * Preparation-only: proves the effective redirect target is the callback URL
 * that was actually requested plus **exactly** the one SDK-appended selector.
 * Every unrelated callback parameter the caller asked for must still be there,
 * unchanged — a silently dropped `inviteToken` would strand a deep link, and a
 * silently rewritten one is worse. Only preparation can check this, because only
 * preparation knows what was asked for.
 */
function redirectTargetIsRequestedPlusSelector(
  effectiveRedirectTo: URL,
  requestedRedirectTo: string,
  flowId: string
): boolean {
  const requested = isUsableUrl(requestedRedirectTo);
  if (!requested) return false;
  if (effectiveRedirectTo.origin !== requested.origin) return false;
  if (effectiveRedirectTo.pathname !== requested.pathname) return false;

  const remaining = new URLSearchParams(effectiveRedirectTo.search);
  const appended = remaining.getAll(FLOW_SELECTOR_PARAM);
  if (appended.length !== 1 || appended[0] !== flowId) return false;
  remaining.delete(FLOW_SELECTOR_PARAM);
  return normalizedQuery(remaining) === normalizedQuery(requested.searchParams);
}

/** Test-only seams. Production call sites pass neither and get the real
 * document's origin and a real full-page navigation. */
export type SupabaseAuthServiceOverrides = {
  navigate?: (url: string) => void;
  resolveAppOrigin?: () => string | null;
};

function defaultAppOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location.origin;
  return typeof origin === "string" && origin.length > 0 && origin !== "null" ? origin : null;
}

function defaultNavigate(url: string): void {
  window.location.assign(url);
}

export function createSupabaseAuthService(
  config: ConfiguredCloudConfig,
  overrides: SupabaseAuthServiceOverrides = {}
): AuthProviderMechanics {
  const client = getSupabaseBrowserClient(config);
  const resolveAppOrigin = overrides.resolveAppOrigin ?? defaultAppOrigin;
  const navigate = overrides.navigate ?? defaultNavigate;

  // ---------------------------------------------------------------------
  // The INITIAL_SESSION race (ADR-0025 Decision 2).
  //
  // The SDK emits `INITIAL_SESSION` from its own initialization, which can
  // interleave either side of a `getSession()` call that goes on to classify
  // the stored session as definitively invalid. Two mechanisms make the
  // invalid classification dominate in both observable orderings, without
  // either one inventing a provider event:
  //
  //   1. `invalidSessionLatched` — once a definitive invalid session has been
  //      classified, an `initial_session` change is normalized with a null
  //      identity. A later genuinely established session clears the latch.
  //   2. `restoresInFlight` — while a restoration is in flight, an arriving
  //      `INITIAL_SESSION` is held and delivered only after that restoration
  //      has classified, so the "event first" ordering becomes the "classify
  //      first" ordering deterministically. Holding is bounded to exactly that
  //      window: with no restoration in flight the change is delivered
  //      immediately, so a consumer that never restores is never starved.
  //
  // Neither mechanism is what makes the SDK's persist-then-emit-then-resolve
  // ordering safe — that is Decision 3: no normalized change, `signed_in`
  // included, may resolve a barrier or produce a ready state.
  // ---------------------------------------------------------------------
  let invalidSessionLatched = false;
  let restoresInFlight = 0;
  const heldInitialSessionFlushers = new Set<() => void>();

  /**
   * Delivers one normalized change to one subscriber, containing anything the
   * subscriber throws.
   *
   * This is not defensiveness for its own sake. A held `INITIAL_SESSION` is
   * delivered from `restoreSession()`'s `finally` path, so an uncontained
   * subscriber throw would reject an otherwise valid `restoreSession()` — a
   * closed-outcome method — and would stop every later held subscriber from
   * being flushed. On the direct-delivery path it would escape into the SDK's
   * own callback dispatch and could prevent its other callbacks from running.
   * A subscriber's bug is the subscriber's problem; it must not become this
   * boundary's contract violation. The thrown value is not inspected, logged,
   * or forwarded.
   */
  function deliverChange(
    listener: (change: NormalizedAuthChange) => void,
    change: NormalizedAuthChange
  ): void {
    try {
      listener(change);
    } catch {
      // Contained deliberately — see above.
    }
  }

  function flushHeldInitialSessions(): void {
    // A copy, because each flush removes itself from the set; and each call is
    // additionally contained so that one misbehaving flusher cannot starve the
    // others, independently of `deliverChange`'s own guarantee.
    for (const flush of [...heldInitialSessionFlushers]) {
      try {
        flush();
      } catch {
        // Contained deliberately — see `deliverChange`.
      }
    }
  }

  function normalizeInitialSession(session: Session | null): NormalizedAuthChange {
    const identity = identityOrNull(session);
    return { reason: "initial_session", identity: invalidSessionLatched ? null : identity };
  }

  function withIdentity(
    reason: "signed_in" | "token_refreshed" | "user_updated",
    session: Session | null
  ): NormalizedAuthChange {
    const identity = identityOrNull(session);
    // Fails closed: a reason that requires an identity is never emitted
    // without one, and no identity is fabricated to satisfy the shape.
    if (!identity) return { reason: "other", identity: null };
    invalidSessionLatched = false;
    return { reason, identity };
  }

  function normalizeChange(event: AuthChangeEvent, session: Session | null): NormalizedAuthChange {
    switch (event) {
      case "SIGNED_IN":
        return withIdentity("signed_in", session);
      case "TOKEN_REFRESHED":
        return withIdentity("token_refreshed", session);
      case "USER_UPDATED":
        return withIdentity("user_updated", session);
      case "SIGNED_OUT":
        return { reason: "signed_out" };
      default:
        // Every other provider event — PASSWORD_RECOVERY, MFA challenges, and
        // anything a future SDK version adds — is reported as `other`. The raw
        // event string never escapes.
        return { reason: "other", identity: identityOrNull(session) };
    }
  }

  return {
    async restoreSession(): Promise<SessionRestoreOutcome> {
      restoresInFlight += 1;
      try {
        let session: Session | null = null;
        let error: unknown = null;
        try {
          const result = await client.auth.getSession();
          session = result.data?.session ?? null;
          error = result.error ?? null;
        } catch (thrown) {
          // A contained unexpected failure. Classified by the same typed
          // predicates rather than assumed transient, then anything
          // unrecognized becomes `restore_failed`. Nothing about the thrown
          // value escapes.
          switch (classifyProviderFailure(thrown)) {
            case "retryable":
              return { kind: "temporarily_unavailable" };
            case "definitively_invalid":
              invalidSessionLatched = true;
              return { kind: "invalid_session" };
            default:
              return { kind: "restore_failed" };
          }
        }

        if (error) {
          switch (classifyProviderFailure(error)) {
            case "retryable":
              // Deliberately no cleanup of any kind: a retryable failure must
              // never clear the SDK's stored session, or a bad network would
              // sign a legitimate device out.
              return { kind: "temporarily_unavailable" };
            case "definitively_invalid":
              // The SDK performs its own correct invalid-session cleanup; this
              // boundary does not second-guess it and adds none of its own.
              invalidSessionLatched = true;
              return { kind: "invalid_session" };
            default:
              return { kind: "restore_failed" };
          }
        }

        const reduction = reduceToIdentity(session);
        if (reduction.kind === "identity") {
          invalidSessionLatched = false;
          return { kind: "authenticated", identity: reduction.identity };
        }
        // A truthy session the provider reported as fine, but whose identity
        // data is unusable OR could not be read at all, is neither "no session"
        // nor an invented identity. Structurally distinct from the absent case
        // below, so neither can be reached by accident.
        if (reduction.kind === "unusable") return { kind: "restore_failed" };
        return { kind: "no_session" };
      } finally {
        restoresInFlight -= 1;
        if (restoresInFlight === 0) flushHeldInitialSessions();
      }
    },

    onAuthChange(listener: (change: NormalizedAuthChange) => void): () => void {
      let unsubscribed = false;
      let held: { session: Session | null } | null = null;

      const flush = () => {
        const pending = held;
        held = null;
        heldInitialSessionFlushers.delete(flush);
        if (!pending || unsubscribed) return;
        deliverChange(listener, normalizeInitialSession(pending.session));
      };

      const { data } = client.auth.onAuthStateChange(
        (event: AuthChangeEvent, session: Session | null) => {
          if (unsubscribed) return;
          if (event === "INITIAL_SESSION") {
            if (restoresInFlight > 0) {
              held = { session };
              heldInitialSessionFlushers.add(flush);
              return;
            }
            deliverChange(listener, normalizeInitialSession(session));
            return;
          }
          deliverChange(listener, normalizeChange(event, session));
        }
      );

      // Idempotent regardless of whether the provider's own unsubscribe is
      // (real Supabase subscriptions tolerate a repeat call, but this doesn't
      // rely on that) — a caller invoking cleanup twice must not reach the
      // provider twice.
      return () => {
        if (unsubscribed) return;
        // Local state is reset FIRST, so idempotence holds even if the
        // provider's own unsubscribe throws: a second call still reaches the
        // provider zero times.
        unsubscribed = true;
        held = null;
        heldInitialSessionFlushers.delete(flush);
        try {
          data.subscription.unsubscribe();
        } catch {
          // A throwing provider unsubscribe is contained rather than propagated
          // out of what is typically a React cleanup function, where it would
          // break unmounting. Nothing is hidden that a caller could act on: the
          // listener is already gated off by `unsubscribed`, so at worst the
          // provider holds a reference to a callback that can no longer deliver.
          // This is NOT the subscription-construction failure above, which
          // deliberately still propagates so the caller can report it.
        }
      };
    },

    async requestEmailOtp(email: string): Promise<AuthServiceResult<void>> {
      try {
        const { error } = await client.auth.signInWithOtp({ email });
        if (error) {
          return authFailed(normalizedAuthError("request_failed"));
        }
        return authOk(undefined);
      } catch {
        return authFailed(normalizedAuthError("temporarily_unavailable"));
      }
    },

    async verifyEmailOtp(email: string, token: string): Promise<AuthServiceResult<AccountIdentity>> {
      try {
        const { data, error } = await client.auth.verifyOtp({ email, token, type: "email" });
        const identity = error ? null : identityOrNull(data.session);
        if (!identity) {
          return authFailed(normalizedAuthError("verification_failed"));
        }
        // `verifyOtp` has already persisted the session and emitted SIGNED_IN
        // by the time it resolves. That is harmless here (Decision 3) and only
        // means the latch, if set, no longer describes reality.
        invalidSessionLatched = false;
        return authOk(identity);
      } catch {
        return authFailed(normalizedAuthError("temporarily_unavailable"));
      }
    },

    async signOut(): Promise<AuthServiceResult<void>> {
      try {
        // "local" scope: sign out only this session, not every device the
        // account is signed in on — see @supabase/auth-js's own signOut()
        // guidance for what most apps want from a sign-out button.
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) {
          // Never reported as success. An offline sign-out that failed has not
          // deleted the local provider session, and saying otherwise would be
          // a false claim the caller cannot detect.
          return authFailed(normalizedAuthError("sign_out_failed"));
        }
        return authOk(undefined);
      } catch {
        return authFailed(normalizedAuthError("temporarily_unavailable"));
      }
    },

    async prepareGoogleSignIn(redirectTo: string): Promise<PrepareAuthorizationOutcome> {
      // Contained: `resolveAppOrigin` is an injected dependency, and a throwing
      // one must produce a closed outcome rather than reject this operation.
      let appOrigin: string | null;
      try {
        appOrigin = resolveAppOrigin();
      } catch {
        return { kind: "invalid_redirect" };
      }
      if (!isValidRedirectTarget(redirectTo, appOrigin)) {
        return { kind: "invalid_redirect" };
      }

      let url: unknown;
      let flowId: unknown;
      try {
        const { data, error } = await client.auth.signInWithOAuth({
          provider: "google",
          // `skipBrowserRedirect: true` is what makes preparation a
          // preparation: the SDK builds the authorization URL and stores the
          // PKCE verifier, but performs no navigation, so the selector exists
          // while this page is still in control.
          options: { redirectTo, skipBrowserRedirect: true },
        });
        if (error) {
          return isAuthRetryableFetchError(error)
            ? { kind: "temporarily_unavailable" }
            : { kind: "preparation_failed" };
        }
        url = data?.url;
        flowId = data?.flowId;
      } catch {
        return { kind: "preparation_failed" };
      }

      if (!isValidFlowSelector(flowId)) {
        // The installed SDK stopped returning a usable selector. Google
        // sign-in fails closed rather than starting a flow whose return could
        // not be correlated.
        return { kind: "flow_selector_unavailable" };
      }

      const validation = validateAuthorizationUrl(url, {
        configuredSupabaseUrl: config.url,
        appOrigin,
        flowId,
      });
      if (!validation.ok) {
        return validation.reason === "selector"
          ? { kind: "flow_selector_unavailable" }
          : { kind: "preparation_failed" };
      }
      if (
        !redirectTargetIsRequestedPlusSelector(validation.effectiveRedirectTo, redirectTo, flowId)
      ) {
        // The provider will not return to the callback URL that was asked for —
        // a dropped or rewritten parameter, or a different path. Structural,
        // not a selector problem.
        return { kind: "preparation_failed" };
      }

      // No application identity has been established and nothing has been
      // navigated: this is preparation only.
      return {
        kind: "prepared",
        prepared: { authorizationUrl: validation.authorizationUrl, flowId },
      };
    },

    navigateToAuthorizationUrl(prepared: PreparedAuthorization): NavigationOutcome {
      // The last checkpoint before this page is gone. The COMPLETE route is
      // revalidated here rather than trusted from preparation: this call may
      // happen after durable writes and further checkpoints, and the value
      // travelled through the caller in between.
      let validation: AuthorizationUrlValidation;
      try {
        // Every one of these reads can throw when handed a hostile or
        // Proxy-backed value — a throwing getter must produce a closed outcome
        // and zero navigation, never an exception out of a synchronous call.
        if (!prepared || typeof prepared !== "object") return { kind: "navigation_failed" };
        validation = validateAuthorizationUrl(prepared.authorizationUrl, {
          configuredSupabaseUrl: config.url,
          appOrigin: resolveAppOrigin(),
          flowId: prepared.flowId,
        });
      } catch {
        return { kind: "navigation_failed" };
      }
      // Both rejection reasons collapse here: from this point the only safe
      // action is not to navigate.
      if (!validation.ok) return { kind: "navigation_failed" };

      try {
        // The exact validated string, not a re-serialized copy.
        navigate(validation.authorizationUrl);
      } catch {
        // A synchronous navigation refusal is contained: the caller gets a
        // named outcome instead of an exception, and neither the URL, its
        // selector, nor its query material is logged, rendered, or placed in
        // the outcome.
        return { kind: "navigation_failed" };
      }
      return { kind: "navigating" };
    },

    async exchangeCorrelatedCallback(
      claim: ClaimedCallback,
      expectedFlowId: string
    ): Promise<ExchangeOutcome> {
      // Two stages, each with one consistent outcome, and BOTH resolved before
      // any provider call — a failed exchange removes the verifier it selected,
      // so exchanging a stale callback against a newer attempt's selector would
      // destroy that newer valid attempt.
      //
      // Stage 1 — the selector. Any failure to read or validate it, including a
      // throwing getter on a hostile or Proxy-backed claim, is
      // `selector_mismatch`: the precondition that this claim is the one the
      // caller declared authoritative cannot be established.
      let claimedFlowId: unknown;
      try {
        if (!claim || typeof claim !== "object") return { kind: "selector_mismatch" };
        claimedFlowId = claim.flowId;
      } catch {
        return { kind: "selector_mismatch" };
      }
      if (!isValidFlowSelector(expectedFlowId) || !isValidFlowSelector(claimedFlowId)) {
        return { kind: "selector_mismatch" };
      }
      if (claimedFlowId !== expectedFlowId) return { kind: "selector_mismatch" };

      // Stage 2 — the authorization code. A missing, non-callable, or throwing
      // reader, and an already-consumed or unusable code, are all
      // `exchange_failed`: the selector matched, but there is nothing to
      // exchange. Zero provider calls in every one of those cases.
      let code: unknown;
      try {
        const readAuthorizationCode = claim.readAuthorizationCode;
        if (typeof readAuthorizationCode !== "function") return { kind: "exchange_failed" };
        code = readAuthorizationCode.call(claim);
      } catch {
        return { kind: "exchange_failed" };
      }
      if (typeof code !== "string" || code.length === 0) {
        // Already exchanged once, revoked by an explicit terminal
        // finalization, or never usable. Zero provider calls on a replay.
        return { kind: "exchange_failed" };
      }

      try {
        // ALWAYS with an explicit selector. The no-selector form is prohibited
        // everywhere in this codebase, because it consumes "the most recently
        // stored verifier" — which may belong to a different, newer flow.
        const { data, error } = await client.auth.exchangeCodeForSession(code, {
          flowId: expectedFlowId,
        });
        if (error) {
          return isAuthRetryableFetchError(error)
            ? { kind: "temporarily_unavailable" }
            : { kind: "exchange_failed" };
        }
        const identity = identityOrNull(data?.session);
        if (!identity) return { kind: "exchange_failed" };
        invalidSessionLatched = false;
        // A provider session already exists and SIGNED_IN has already been
        // emitted at this point. This outcome reports only that fact — it
        // resolves no barrier and opens nothing.
        return { kind: "exchanged", identity };
      } catch {
        return { kind: "exchange_failed" };
      }
    },
  };
}
