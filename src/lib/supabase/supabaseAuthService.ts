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
// have subscribed; the single mounted IdentityProvider contains that boundary
// (see authService.ts's interface note). The unsubscribe function it returns is
// idempotent and never throws.
// The separate dormant native account runtime also owns a conditional callback
// refusal: an overtaken beforeMutation attribution rejects rather than inventing
// a begun-invalidation outcome. Ordinary public invalidation and Web stay closed.
//
// Nothing past this boundary ever sees a raw provider error, a raw SDK event
// string, an access/refresh token, a PKCE verifier, an authorization code, or
// the full session: only `AccountIdentity`, a closed outcome, and a normalized,
// static, user-facing error message.
//
// SCOPE NOTE (Stage B0.2b; docs/adr/0025). The AuthService and S5a AUTH
// interfaces are provider mechanics: authenticated/signed_in/exchanged alone
// authorize no application entry. The explicit dormant S5b/S5c hosts below
// internally compose the actual IdentityTransitionCoordinator. Only that genuine
// coordinator resolves barriers, interprets expectedFlowId and mints admission;
// no provider report or caller Profile string substitutes for its authority.
import {
  AuthClient,
  AuthRetryableFetchError,
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  type AuthChangeEvent,
  type Session,
} from "@supabase/supabase-js";
import { PostgrestClient } from "@supabase/postgrest-js";
import {
  BROWSER_AUTH_OPTIONS,
  createNativeCredentialSettlementStorage,
  reserveNativeAuthSdk,
  claimedBrowserCredentialHealth,
  getSupabaseBrowserClient,
  type BrowserCredentialHealth,
} from "./supabaseClient";
import { resolveCloudConfig, type ConfiguredCloudConfig } from "./config";
import { resolveNativeProviderConfiguration } from "./nativeProviderConfiguration";
import { drainObservedPlatformWork } from "../persistence/platformSha256";
import { createNativeTeamLinkDelivery, isCanonicalNativeTeamLinkOrigin, type NativeTeamLinkDelivery, type NativeTeamLinkPort } from "./nativeTeamLinkDelivery";
import { createProviderCredentialStorage, providerSessionStorageKey } from "./providerCredentialStorage";
import { createNativeCombinedRetirementOwner, createNativeNewUserRuntimeOwner, type NativeCommonMigrationOptions, type NativeCommonMigrationReport, type NativeCommonRetirementOwner, type NativeCommonRuntimeOwner } from "../persistence/nativeCombinedMigrationOwner";
import { createNativeTrackerOwner } from "../persistence/nativeTrackerOwner";
import { registerNativeTrackerRuntime } from "../persistence/nativeTrackerRegistry";
import type { NativeTrackerBinding } from "../persistence/nativeTrackerTypes";
import type { NativeCombinedRuntimePair, NativeRuntimeHealth } from "../persistence/nativeCombinedRuntime";
import { subscribeNativeRuntimeRevocation } from "../persistence/nativeCombinedRuntime";
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
import { createSupabaseIdentityService } from "./supabaseIdentityService";
import { createIdentityRuntime, type IdentityRuntimeReady } from "../identity/identityRuntime";
import { createIdentityRepositorySet } from "../identity/identityRepositorySet";
import { createLiveGenerationCounter, type IdentityTransitionCoordinator, type NativeIdentityOperation, type NativeIdentityOwnership, type NativeProfileAdmission, type NativeAccountControl, type NativeAccountPending, type NativePendingIntentReplay, type InvalidationOutcome } from "../identity/identityTransitionCoordinator";
import { createCallbackCaptureCell, type CallbackUrlAccess } from "./supabaseCallbackCapture";
import type { GateProgressPhase, TransitionIdentity } from "../identity/gateState";
import { deriveGateEligibility, type IdentityService } from "../identity/identityService";
import { createSupabaseSportingCloudService } from "./supabaseSportingCloudService";
import { createSupabaseTeamExerciseCloudService } from "./supabaseTeamExerciseCloudService";
import { SupabaseTeamService, type TeamQueryHooks } from "./supabaseTeamService";
import type { TeamService } from "../team/teamService";
import { teamFailed, type TeamResult } from "../team/errors";
import { resolveTeamApiRoutePath } from "./teamApiRoutePath";
import type { AuthorizedTeamRequest } from "./authorizedTeamRequest";
import { resolveNativeApiOriginConfig } from "../platform/nativeApiOrigin";
import type { TeamExerciseCloudService, TeamExerciseCloudResult } from "../cloudSporting/teamExerciseTypes";
import type { CloudSportingService, CloudSportingResult, CloudSportingRecord } from "../cloudSporting/types";
import { identityFailed } from "../identity/errors";
import { createSupabaseAccountDeletionService, type AccountDeletionRpcPort } from "./supabaseAccountDeletionService";
import { createAccountDeletionGuardRepository, type AccountDeletionGuard, type AccountDeletionGuardRepository } from "../identity/accountDeletionGuard";
import type { AccountDeletionService, AccountDeletionResult, AccountDeletionState, AccountDeletionPendingObserver } from "../identity/accountDeletion";
import type { StorageAdapter } from "../persistence/types";
import { createNativeLocalSportingScope, type NativeLocalSportingScope } from "../persistence/nativeLocalSportingScope";
import { createNativeSportingApplicationScope, type NativeSportingApplicationScope } from "../persistence/nativeSportingApplicationScope";
import type { CompleteOnboardingInput } from "../identity/legalSnapshot";
import { parseLegalDocumentsResponse } from "../identity/legalSnapshot";
import { isCanonicalUuid, isValidTimestamp } from "../identity/untrustedValue";

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
  /** Test seam for the Stage M3b3 credential-health verdict. Production passes
   * none and the claimed accessor is used, which is `null` unless a native
   * composition claimed a protected credential store. */
  credentialHealth?: BrowserCredentialHealth;
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
  return buildSupabaseAuthMechanics(config, client, overrides);
}

type ActualAuthClient = InstanceType<typeof AuthClient>;
type AuthMechanicsClient = { auth: Pick<ActualAuthClient, "getSession" | "onAuthStateChange" | "signInWithOtp" | "signInWithPassword" | "verifyOtp" | "signOut" | "signInWithOAuth" | "exchangeCodeForSession"> };

// Module-private identity capability. The public Web factory never receives it;
// neither overrides, metadata nor platform/URL claims can enable password calls.
const nativeReviewPasswordCapability = Object.freeze({});

/** The single provider normalization path, shared privately by Web and S5a. */
function buildSupabaseAuthMechanics(
  config: ConfiguredCloudConfig,
  client: AuthMechanicsClient,
  overrides: SupabaseAuthServiceOverrides,
  reviewCapability?: object
): AuthProviderMechanics {
  const resolveAppOrigin = overrides.resolveAppOrigin ?? defaultAppOrigin;
  const navigate = overrides.navigate ?? defaultNavigate;
  /**
   * The credential-storage health verdict (Stage M3b3), or `null` when nothing
   * claimed a custom store — the Web build and every build in this stage, where
   * this adds no behaviour at all.
   *
   * Consulted because the SDK cannot be relied on to surface a storage fault:
   * `initialize()` catches everything `_initialize()` throws and returns it as a
   * result nobody reads, `_emitInitialSession` is awaited by nobody, and
   * `getItemAsync` treats a resolved falsy value as absence with no error. Any
   * of those can leave `getSession()` reporting `{ session: null, error: null }`
   * from a store that simply failed.
   *
   * `credentialHealth` is deliberately read at CALL time, not captured, so a
   * failure recorded after this service was constructed is still seen.
   */
  const credentialHealth: BrowserCredentialHealth | null =
    overrides.credentialHealth ?? claimedBrowserCredentialHealth();

  /** True when an unresolved credential-storage failure stands. */
  function credentialStorageFailed(): boolean {
    if (credentialHealth === null) return false;
    try {
      return credentialHealth() !== null;
    } catch {
      // A health accessor that throws is itself not a clean bill of health.
      return true;
    }
  }

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
        // THE ONE PLACE A CLEAN "NOBODY IS SIGNED IN" IS PRODUCED, and therefore
        // the place a credential-storage fault must not reach. An unresolved
        // failure means the absence of a session was never established, so this
        // reports a transient unavailability instead — which the identity gate
        // treats as "cannot decide", not as "signed out". Deliberately NOT
        // `invalid_session`: that would be a definitive verdict, and it triggers
        // the SDK's own session cleanup.
        if (credentialStorageFailed()) return { kind: "temporarily_unavailable" };
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

    canSignInForReview() { return reviewCapability === nativeReviewPasswordCapability; },
    async signInForReview(email: string, password: string): Promise<AuthServiceResult<AccountIdentity>> {
      // Identical neutral failure for unknown/non-review accounts, wrong passwords,
      // policy rejection and malformed responses. Never expose provider details.
      const failed = () => authFailed<AccountIdentity>(normalizedAuthError("review_sign_in_failed"));
      if (reviewCapability !== nativeReviewPasswordCapability) return failed();
      try {
        if (typeof email !== "string" || !email.length || typeof password !== "string" || !password.length) return failed();
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        const identity = error ? null : identityOrNull(data.session);
        if (!identity || credentialStorageFailed()) return failed();
        invalidSessionLatched = false;
        return authOk(identity);
      } catch { return failed(); }
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
        // The SDK resolved without an error, which is not the same as the local
        // credential actually having been removed: `_removeSession`'s removals
        // go through the claimed storage, and a failure there is exactly what
        // the health verdict records. Reporting success here would be the false
        // durable-sign-out claim this boundary exists to prevent.
        if (credentialStorageFailed()) {
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
        code = Reflect.apply(readAuthorizationCode, claim, []);
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

// S5a — explicit, dormant native AUTH owner. There is no production caller.
// Configuration assignment, application admission and data requests are outside
// this provider-mechanics boundary (BETA_COMPLETION_SPECIFICATION.md §S5a).
export type NativeAuthWaitCode = "busy" | "migration_blocked" | "migration_incomplete" | "migration_fault" | "recovery_required" | "retirement_incomplete" | "handoff_refused" | "credential_failed" | "sdk_failed" | "restart_required";
export type NativeAuthStart = Readonly<{ outcome: "ready" } | { outcome: "waiting"; code: NativeAuthWaitCode } | { outcome: "closed" }>;
export type NativeAuthCleanup = Readonly<{ ok: true } | { ok: false; reason: "evidence_held" | "cleanup_unconfirmed" }>;
export interface NativeSupabaseAuthHost {
  readonly auth: AuthProviderMechanics;
  start(): Promise<NativeAuthStart>;
  health(): Readonly<{
    phase: "reserved" | "preparing" | "ready" | "waiting" | "closing" | "closed";
    code: NativeAuthWaitCode | null;
    storageFailed: boolean; sdkFailed: boolean; cleanupUnconfirmed: boolean;
    runtime: NativeRuntimeHealth | null;
  }>;
  dispose(): Promise<NativeAuthCleanup>;
}
export interface NativeSupabaseAuthHostOptions {
  readonly config: ConfiguredCloudConfig;
  readonly migration: NativeCommonMigrationOptions;
  readonly fetch: typeof globalThis.fetch;
  readonly resolveAppOrigin?: () => string | null;
  readonly navigate?: (url: string) => void;
}
export type NativeSupabaseAuthHostResult = Readonly<
  { ok: true; host: NativeSupabaseAuthHost } |
  { ok: false; reason: "ownership_conflict" | "invalid_dependency" | "invalid_configuration" }
>;

export interface NativeIdentityBootstrapHostOptions extends NativeSupabaseAuthHostOptions {
  readonly callbackUrlAccess: CallbackUrlAccess;
}
export interface NativeSportingIdentityHostOptions extends NativeIdentityBootstrapHostOptions {
  readonly teamLinkDelivery?: Readonly<{ origin: string; port?: NativeTeamLinkPort }>;
}
export interface NativeConfiguredSportingIdentityHostOptions extends Omit<NativeSportingIdentityHostOptions, "config" | "migration"> {
  readonly migration: Omit<NativeCommonMigrationOptions, "providerConfigIdentity" | "sessionStorageKey" |
    "domainFingerprint" | "domainFingerprintFormat" | "credentialFingerprint" | "credentialFingerprintFormat">;
}
/** Transfer callbacks receive only these captured dependencies as their receiver. */
export interface InstallationTransferDependencyReceiver {
  readonly fetch: typeof globalThis.fetch;
  readonly resolveAppOrigin: (() => string | null) | null;
  readonly navigate: ((url: string) => void) | null;
}
export interface NativeConfiguredInstallationTransferIdentityHostOptions extends Omit<NativeConfiguredSportingIdentityHostOptions, "teamLinkDelivery" | "fetch" | "resolveAppOrigin" | "navigate"> {
  readonly fetch: (this: InstallationTransferDependencyReceiver, input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  readonly resolveAppOrigin?: (this: InstallationTransferDependencyReceiver) => string | null;
  readonly navigate?: (this: InstallationTransferDependencyReceiver, url: string) => void;
  readonly installationTransfer: Readonly<{ protectedWire: string; recoveryCode: string }>;
}
/** Dormant normal host over an already-published installation; no archive input. */
export type NativeConfiguredPublishedInstallationIdentityHostOptions = NativeConfiguredSportingIdentityHostOptions;
type InstallationTransferApplicationOwner = ReturnType<typeof import("../persistence/installationTransferPairing").createInstallationTransferHostOwner>;
export interface NativeInstallationTransferApplicationHost extends NativeIdentityBootstrapHost {
  prepareImport: InstallationTransferApplicationOwner["preparePublication"];
  completeImport: InstallationTransferApplicationOwner["publishPrepared"];
  checkAccountDeletion: InstallationTransferApplicationOwner["recoverDeletionState"];
  cancelAccountDeletion: InstallationTransferApplicationOwner["cancelDeletion"];
}
export type NativeInstallationTransferApplicationHostResult = Readonly<
  { ok: true; host: NativeInstallationTransferApplicationHost } |
  { ok: false; reason: "ownership_conflict" | "invalid_dependency" | "invalid_configuration" }
>;
type InstallationTransferApplicationControls = Pick<NativeInstallationTransferApplicationHost,
  "prepareImport" | "completeImport" | "checkAccountDeletion" | "cancelAccountDeletion">;
// Erased private construction strategy. No public constructor accepts this seam.
type NativeHostPreparation = Readonly<{
  readonly freshEmailOtpOnline?: true;
  publishedSourceDeletionGuards?(current: () => boolean, beforeIO?: () => Promise<boolean>): AccountDeletionGuardRepository & Readonly<{ acceptControl(profileId: string, revision: number): boolean }>;
  ownFreshEmailOtpSource?(source: object): void;
  ownFreshEmailOtp?(event: object): void;
  wrapSourceDeletionGuards?(adapter: StorageAdapter, current: () => boolean): AccountDeletionGuardRepository & Readonly<{ acceptControl(profileId: string, revision: number): boolean }>;
  ownAccountRecovery?(service: Pick<AccountDeletionService, "getState" | "cancel">): void;
  ownServerControl?(event: object, account: string, profile: string, revision: number, current: () => boolean): void;
  prepare(): Promise<Readonly<{ pair: NativeCombinedRuntimePair } | { code: NativeAuthWaitCode } | { closed: true }>>;
  dispose(): Promise<NativeAuthCleanup>;
}>;
type NativeHostPreparationCapture = (options: Record<string, unknown>, capture: Readonly<{
  object(value: unknown): Record<string, unknown>;
  field(value: Record<string, unknown>, name: string): unknown;
  invalid(value?: unknown): never;
}>) => (migration: NativeCommonMigrationOptions, ownsCompletion: (value: unknown) => boolean, current: () => boolean, retainApplicationCompletion: (work: Promise<unknown>) => void) => NativeHostPreparation;
export type NativeIdentityBootstrapStart = Readonly<
  { outcome: "ready"; runtime: IdentityRuntimeReady } |
  { outcome: "waiting"; code: NativeAuthWaitCode | "identity_failed" | "team_link_unavailable" } | { outcome: "closed" }
>;
export interface NativeIdentityBootstrapHost {
  /** Fixed ephemeral support metadata only; never an admission result. */
  startupDiagnostic?(): string | null;
  start(): Promise<NativeIdentityBootstrapStart>;
  health(): Omit<ReturnType<NativeSupabaseAuthHost["health"]>, "code"> & Readonly<{ code: NativeAuthWaitCode | "identity_failed" | "team_link_unavailable" | null; identityFailed: boolean }>;
  dispose(): Promise<NativeAuthCleanup>;
}
export type NativeIdentityBootstrapHostResult = Readonly<
  { ok: true; host: NativeIdentityBootstrapHost } |
  { ok: false; reason: "ownership_conflict" | "invalid_dependency" | "invalid_configuration" }
>;

export interface NativeSportingIdentityRuntimeReady extends IdentityRuntimeReady {
  readonly accountDeletion: AccountDeletionService;
  createSportingCloudService(profileId: string): CloudSportingService | null;
  createTeamExerciseCloudService(profileId: string): TeamExerciseCloudService | null;
  createTeamService(profileId: string): TeamService | null;
  createLocalSportingScope(profileId: string): NativeLocalSportingScope | null;
  createSportingApplicationScope(profileId: string): NativeSportingApplicationScope | null;
  subscribeToIdentityInvalidations(listener: (outcome: InvalidationOutcome) => void): () => void;
}
export type NativeSportingIdentityStart = Readonly<
  { outcome: "ready"; runtime: NativeSportingIdentityRuntimeReady } |
  { outcome: "waiting"; code: NativeAuthWaitCode | "identity_failed" | "team_link_unavailable" } | { outcome: "closed" }
>;
export interface NativeSportingIdentityHost extends Omit<NativeIdentityBootstrapHost, "start"> {
  start(): Promise<NativeSportingIdentityStart>;
}
export type NativeSportingIdentityHostResult = Readonly<
  { ok: true; host: NativeSportingIdentityHost } |
  { ok: false; reason: "ownership_conflict" | "invalid_dependency" | "invalid_configuration" }
>;

const authApply = Reflect.apply;
const authHasOwn = Object.prototype.hasOwnProperty;
const authThen = Promise.prototype.then;
const authNow = Date.now;
const authDescriptor = Object.getOwnPropertyDescriptor;
const authPrototype = Object.getPrototypeOf;
/** C4: only directly observed returns. Never inspect thrown reasons. */
function authObserve(value: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try { authApply(authThen, value, [resolve, reject]); }
    catch { void new Promise<unknown>(done => done(value)).then(resolve, reject); }
  });
}
const unavailableAuth = () => authFailed<never>(normalizedAuthError("temporarily_unavailable"));

export async function createNativeSupabaseAuthHost(input: NativeSupabaseAuthHostOptions): Promise<NativeSupabaseAuthHostResult> {
  return await createNativeHost(input, false) as NativeSupabaseAuthHostResult;
}
export async function createNativeIdentityBootstrapHost(input: NativeIdentityBootstrapHostOptions): Promise<NativeIdentityBootstrapHostResult> {
  return await createNativeHost(input, true) as NativeIdentityBootstrapHostResult;
}
export async function createNativeSportingIdentityHost(input: NativeSportingIdentityHostOptions): Promise<NativeSportingIdentityHostResult> {
  return await createNativeHost(input, true, true) as NativeSportingIdentityHostResult;
}
export async function createConfiguredNativeSportingIdentityHost(binding: unknown, input: NativeConfiguredSportingIdentityHostOptions): Promise<NativeSportingIdentityHostResult> {
  // Authenticate before even reflecting on options or reserving a resource.
  const configured = resolveNativeProviderConfiguration(binding);
  if (!configured) return Object.freeze({ ok: false, reason: "invalid_configuration" });
  return await createNativeHost(input as NativeIdentityBootstrapHostOptions, true, true, configured) as NativeSportingIdentityHostResult;
}
/** Explicit new-installation entry, selected only by the opt-in mobile beta.
 * Never imports or retires legacy data. */
export async function createConfiguredNewUserNativeSportingIdentityHost(binding: unknown, input: NativeConfiguredSportingIdentityHostOptions): Promise<NativeSportingIdentityHostResult> {
  const configured = resolveNativeProviderConfiguration(binding);
  if (!configured) return Object.freeze({ ok: false, reason: "invalid_configuration" });
  return await createNativeHost(input as NativeIdentityBootstrapHostOptions, true, true, configured, undefined, true) as NativeSportingIdentityHostResult;
}
/** Dormant genuine configured destination-identity route. No sporting mount authority. */
export async function createConfiguredInstallationTransferIdentityHost(binding: unknown, input: NativeConfiguredInstallationTransferIdentityHostOptions): Promise<NativeIdentityBootstrapHostResult> {
  return await createConfiguredInstallationTransferHost(binding, input);
}
/** Explicit destination application controls, over the same genuine identity-only Host. */
export async function createConfiguredInstallationTransferApplicationHost(binding: unknown, input: NativeConfiguredInstallationTransferIdentityHostOptions): Promise<NativeInstallationTransferApplicationHostResult> {
  let controls: InstallationTransferApplicationControls | null = null;
  const made = await createConfiguredInstallationTransferHost(binding, input, value => { controls = value; });
  if (!made.ok) return made;
  if (!controls) { await made.host.dispose(); return Object.freeze({ ok: false, reason: "invalid_dependency" }); }
  return Object.freeze({ ok: true, host: Object.freeze({ ...made.host, ...controls as InstallationTransferApplicationControls }) });
}
async function createConfiguredInstallationTransferHost(binding: unknown, input: NativeConfiguredInstallationTransferIdentityHostOptions,
  captureControls?: (controls: InstallationTransferApplicationControls) => void): Promise<NativeIdentityBootstrapHostResult> {
  const configured = resolveNativeProviderConfiguration(binding);
  if (!configured) return Object.freeze({ ok: false, reason: "invalid_configuration" });
  // Everything transfer-specific stays inside this unused export's closed graph.
  // Shared native-storage code receives only an erased private construction seam.
  const preparedHost = createNativeHost(input as unknown as NativeIdentityBootstrapHostOptions, true, false, configured, (options, capture) => {
    let supplied: Record<string, unknown> | null = capture.object(capture.field(options, "installationTransfer"));
    const protectedWire = capture.field(supplied, "protectedWire");
    const header = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n";
    if (typeof protectedWire !== "string" || protectedWire.length === 0 || protectedWire.length > header.length + 17 + Math.ceil((25165824 + 16) * 4 / 3)) capture.invalid(protectedWire);
    let capturedCode: unknown = capture.field(supplied, "recoveryCode");
    if (typeof capturedCode !== "string" || !/^ct1-[A-Za-z0-9_-]{43}$/.test(capturedCode)) capture.invalid(capturedCode);
    // Mutable private cell allows terminal cleanup or genuine handoff to drop the
    // secret without retaining the original supplied object as a callback receiver.
    const secret: { code: string | null } = { code: capturedCode as string };
    capturedCode = null; supplied = null;
    options = Object.create(null);
    return (migration, ownsCompletion, current, retainApplicationCompletion) => {
      type TransferOwner = ReturnType<typeof import("../persistence/installationTransferPairing").createInstallationTransferHostOwner>;
      let owner: TransferOwner | null = null, revoked = false;
      let controlImplementation: typeof import("../persistence/installationTransferAccountControl") | null = null;
      let preparing: ReturnType<NativeHostPreparation["prepare"]> | null = null;
      let closing: Promise<NativeAuthCleanup> | null = null;
      const waiting = (code: NativeAuthWaitCode) => Object.freeze({ code });
      captureControls?.(Object.freeze({
        prepareImport() {
          return !revoked && current() && owner ? owner.preparePublication() : Promise.resolve(Object.freeze({ code: "publication_refused" as const, mayIssue: false as const, mayPublish: false as const, mayMount: false as const }));
        },
        completeImport() {
          return !revoked && current() && owner ? owner.publishPrepared() : Promise.resolve(Object.freeze({ code: "publication_refused" as const, observedLayout: "unknown" as const, mayIssue: false as const, mayPublish: false as const, mayMount: false as const }));
        },
        checkAccountDeletion() {
          return !revoked && current() && owner ? owner.recoverDeletionState() : Promise.resolve({ ok: false as const, error: "unavailable" as const });
        },
        cancelAccountDeletion(requestId: string) {
          return !revoked && current() && owner ? owner.cancelDeletion(requestId) : Promise.resolve({ ok: false as const, error: "unavailable" as const });
        },
      }));
      return Object.freeze({
        freshEmailOtpOnline: true as const,
        ownFreshEmailOtpSource(source: object) { if (revoked || !current() || !owner) throw null; return owner.ownFreshEmailOtpSource(source); },
        ownFreshEmailOtp(event: object) { if (revoked || !current() || !owner) throw null; return owner.ownFreshEmailOtp(event); },
        wrapSourceDeletionGuards(adapter: StorageAdapter, hostCurrent: () => boolean) { if (revoked || !current() || !owner) throw null; return owner.wrapSourceDeletionGuards(adapter, hostCurrent); },
        ownAccountRecovery(service: Pick<AccountDeletionService, "getState" | "cancel">) { if (revoked || !current() || !owner) throw null; return owner.ownAccountRecovery(service); },
        ownServerControl(event: object, account: string, profile: string, revision: number, hostCurrent: () => boolean) {
          if (revoked || !current() || !owner || !controlImplementation) throw null;
          const observation = controlImplementation.createTransferAccountControlObservation(event, account, profile, revision, hostCurrent);
          if (observation) return owner.ownServerControl(observation);
        },
        prepare() {
          if (revoked || !current()) return Promise.resolve(Object.freeze({ closed: true as const }));
          if (preparing) return preparing;
          preparing = Promise.resolve().then(async () => {
            const implementation = await import("../persistence/installationTransferPairing");
            if (revoked || !current()) return Object.freeze({ closed: true as const });
            controlImplementation = await import("../persistence/installationTransferAccountControl");
            if (revoked || !current()) return Object.freeze({ closed: true as const });
            owner ??= implementation.createInstallationTransferHostOwner({ sqlite: migration.sqlite, providerConfigIdentity: migration.providerConfigIdentity,
              sessionStorageKey: migration.sessionStorageKey, protectedBinding: migration.protectedBinding, detectPlatform: migration.detectPlatform }, ownsCompletion, captureControls ? retainApplicationCompletion : undefined);
            const paired = await owner.pair(protectedWire, secret.code);
            if (revoked || !current()) return Object.freeze({ closed: true as const });
            if (paired.code !== "paired") return waiting(paired.code === "fault_held" ? "migration_fault" :
              ["target_conflict", "archive_refused", "domain_refused", "history_refused"].includes(paired.code) ? "migration_blocked" : "migration_incomplete");
            const pair = await owner.handoff();
            if (pair) { secret.code = null; return Object.freeze({ pair }); }
            return revoked || !current() ? Object.freeze({ closed: true as const }) : waiting("handoff_refused");
          }).catch(() => waiting("migration_incomplete"));
          const flight = preparing;
          void flight.then(() => { if (preparing === flight) preparing = null; });
          return flight;
        },
        dispose() {
          revoked = true; secret.code = null; controlImplementation = null;
          if (closing) return closing;
          let immediate: ReturnType<TransferOwner["close"]> | null = null;
          closing = Promise.resolve().then(async (): Promise<NativeAuthCleanup> => {
            if (preparing) await preparing;
            // Positive absence means no owner was ever actually constructed.
            if (!owner) return Object.freeze({ ok: true });
            const result = await (immediate ?? owner.close());
            return result.code === "closed" ? Object.freeze({ ok: true }) : Object.freeze({ ok: false,
              reason: result.code === "fault_held" ? "evidence_held" : "cleanup_unconfirmed" });
          }).catch(() => Object.freeze({ ok: false as const, reason: "cleanup_unconfirmed" as const }));
          const flight = closing;
          void flight.then(() => { if (closing === flight) closing = null; });
          // Revoke a genuine owner now, before joining its actual preparation.
          immediate = owner?.close() ?? null;
          return flight;
        },
      });
    };
  });
  input = undefined as unknown as NativeConfiguredInstallationTransferIdentityHostOptions;
  return await preparedHost as NativeIdentityBootstrapHostResult;
}
/** Explicit dormant normal route. Default/source constructors remain exact. */
export async function createConfiguredPublishedInstallationIdentityHost(binding: unknown, input: NativeConfiguredPublishedInstallationIdentityHostOptions): Promise<NativeSportingIdentityHostResult> {
  const configured = resolveNativeProviderConfiguration(binding);
  if (!configured) return Object.freeze({ ok: false, reason: "invalid_configuration" });
  const preparedHost = createNativeHost(input as unknown as NativeIdentityBootstrapHostOptions, true, true, configured, () => {
    return (migration, ownsCompletion, current) => {
      type PublishedOwner = ReturnType<typeof import("../persistence/installationPublishedOwner").createPublishedInstallationOwner>;
      let owner: PublishedOwner | null = null, revoked = false;
      let preparing: ReturnType<NativeHostPreparation["prepare"]> | null = null;
      let closing: Promise<NativeAuthCleanup> | null = null;
      const owns = (value: unknown) => value === preparing || value === closing || ownsCompletion(value);
      return Object.freeze({
        publishedSourceDeletionGuards(hostCurrent: () => boolean, beforeIO?: () => Promise<boolean>) {
          if (revoked || !current() || !owner) throw null;
          const repository = owner.sourceGuardRepository(hostCurrent, beforeIO);
          if (!repository) throw null; // Present-hook refusal never falls back.
          return repository;
        },
        prepare() {
          if (revoked || !current()) return Promise.resolve(Object.freeze({ closed: true as const }));
          if (preparing) return preparing;
          preparing = Promise.resolve().then(async () => {
            const implementation = await import("../persistence/installationPublishedOwner");
            if (revoked || !current()) return Object.freeze({ closed: true as const });
            owner ??= implementation.createPublishedInstallationOwner({ sqlite: migration.sqlite, providerConfigIdentity: migration.providerConfigIdentity,
              sessionStorageKey: migration.sessionStorageKey, protectedBinding: migration.protectedBinding, detectPlatform: migration.detectPlatform }, owns);
            const pair = await owner.handoff();
            // The real host retains a late pair before testing terminal state.
            if (pair) return Object.freeze({ pair });
            return revoked || !current() ? Object.freeze({ closed: true as const }) : Object.freeze({ code: "handoff_refused" as const });
          }).catch(() => Object.freeze({ code: "migration_incomplete" as const }));
          const flight = preparing; void flight.then(() => { if (preparing === flight) preparing = null; });
          return flight;
        },
        dispose() {
          revoked = true;
          if (closing) return closing;
          let immediate: ReturnType<PublishedOwner["close"]> | null = null;
          closing = Promise.resolve().then(async (): Promise<NativeAuthCleanup> => {
            if (preparing) await preparing;
            if (!owner) return Object.freeze({ ok: true });
            const result = await (immediate ?? owner.close());
            return result.code === "closed" ? Object.freeze({ ok: true }) : Object.freeze({ ok: false,
              reason: result.code === "fault_held" ? "evidence_held" : "cleanup_unconfirmed" });
          }).catch(() => Object.freeze({ ok: false as const, reason: "cleanup_unconfirmed" as const }));
          const flight = closing; void flight.then(() => { if (closing === flight) closing = null; });
          immediate = owner?.close() ?? null; return flight;
        },
      });
    };
  });
  input = undefined as unknown as NativeConfiguredPublishedInstallationIdentityHostOptions;
  return await preparedHost as NativeSportingIdentityHostResult;
}
async function createNativeHost(input: NativeSupabaseAuthHostOptions, bootstrap: boolean, sporting = false,
  configured: ReturnType<typeof resolveNativeProviderConfiguration> = null, capturePreparation?: NativeHostPreparationCapture, newUser = false): Promise<NativeSupabaseAuthHostResult | NativeIdentityBootstrapHostResult> {
  // This executes synchronously, before ANY option getter or migration work.
  const reservation = reserveNativeAuthSdk();
  if (!reservation) return Object.freeze({ ok: false, reason: "ownership_conflict" });
  const malformed: Promise<unknown>[] = [];
  let rejectedCapture = false;
  function invalid(value?: unknown): never {
    rejectedCapture = true;
    if ((typeof value === "object" && value !== null) || typeof value === "function") malformed.push(drainObservedPlatformWork(value));
    throw null;
  }
  function nativePromise(value: unknown): boolean {
    // Detect native promises even with a masked own `then`, without reading a
    // legitimate binding's arbitrary `then` property.
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; });
    let isPromise = false;
    try { authApply(authThen, value, [finish, finish]); isPromise = true; } catch { /* ordinary object */ }
    if (isPromise) { rejectedCapture = true; malformed.push(completion, drainObservedPlatformWork(value)); }
    return isPromise;
  }
  function object(value: unknown): Record<string, unknown> {
    if (nativePromise(value)) throw null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(value);
    return value as Record<string, unknown>;
  }
  function field(obj: Record<string, unknown>, name: string): unknown {
    if (rejectedCapture) throw null;
    const value = obj[name];
    if (nativePromise(value)) throw null;
    return value;
  }
  function string(value: unknown): string { if (typeof value !== "string" || value.length === 0) return invalid(value); return value; }
  function fn(value: unknown): (...args: never[]) => unknown { if (typeof value !== "function") return invalid(value); return value as (...args: never[]) => unknown; }
  let config: ConfiguredCloudConfig, migration: NativeCommonMigrationOptions;
  let buildPreparation: ReturnType<NativeHostPreparationCapture> | null = null;
  let dependencyReceiver: NativeSupabaseAuthHostOptions | InstallationTransferDependencyReceiver = input;
  let transport: typeof globalThis.fetch, origin: (() => string | null) | null, navigation: ((url: string) => void) | null;
  let urlPort: Record<string, unknown> | null = null;
  let readUrl: (() => string | null) | null = null, replaceUrl: ((url: string) => void) | null = null;
  let teamLinkOptions: Readonly<{ origin: string; port?: NativeTeamLinkPort }> | null = null;
  let authBase: URL;
  let NativeRequest: typeof Request, NativeResponse: typeof Response, NativeHeaders: typeof Headers;
  let responseStatus: (this: Response) => number, responseStatusText: (this: Response) => string, responseHeaders: (this: Response) => Headers;
  let responseText: Response["text"], eachHeader: Headers["forEach"], requestClone: Request["clone"];
  let requestUrlGetter: (this: Request) => string, requestMethodGetter: (this: Request) => string;
  let requestCredentialsGetter: (this: Request) => RequestCredentials, requestRedirectGetter: (this: Request) => RequestRedirect, requestText: Request["text"];
  let requestHeadersGetter: (this: Request) => Headers, setHeader: Headers["set"], deleteHeader: Headers["delete"];
  function requestGetter(initial: Record<string, unknown>, name: string): (...args: never[]) => unknown {
    let prototype = initial;
    for (let depth = 0; depth < 16; depth++) {
      const descriptor = authDescriptor(prototype, name);
      if (descriptor) return fn(descriptor.get);
      const parent = authPrototype(prototype);
      if (parent === null) break;
      prototype = object(parent);
    }
    return invalid();
  }
  let reason: "invalid_dependency" | "invalid_configuration" = "invalid_dependency";
  try {
    const options = object(input), supplied = configured ? configured.config : object(field(options, "config"));
    const status = field(supplied, "status");
    if (status !== "configured") { reason = "invalid_configuration"; invalid(status); }
    const url = string(field(supplied, "url")), key = string(field(supplied, "publishableKey"));
    reason = "invalid_configuration";
    const resolved = resolveCloudConfig(url, key);
    if (status !== "configured" || resolved.status !== "configured" || resolved.url !== url || resolved.publishableKey !== key) invalid();
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) invalid();
    authBase = new URL("auth/v1", new URL(url.endsWith("/") ? url : url + "/"));
    config = Object.freeze({ status: "configured", url, publishableKey: key });
    reason = "invalid_dependency";
    const m = object(field(options, "migration")), sql = object(field(m, "sqlite")), bounds = object(field(m, "limits"));
    const databaseName = string(field(sql, "databaseName")), engine = field(sql, "engine"), sqlPlatform = field(sql, "detectPlatform");
    const providerConfigIdentity = configured ? configured.providerConfigIdentity : string(field(m, "providerConfigIdentity"));
    const sessionStorageKey = configured ? configured.sessionStorageKey : string(field(m, "sessionStorageKey"));
    if (providerSessionStorageKey(url) !== sessionStorageKey) { reason = "invalid_configuration"; invalid(); }
    const protectedBinding = field(m, "protectedBinding"), detectPlatform = field(m, "detectPlatform");
    const domainFingerprint = configured ? configured.domainFingerprint.fingerprint : fn(field(m, "domainFingerprint"));
    const domainFingerprintFormat = configured ? configured.domainFingerprint.isWellFormedFingerprint : fn(field(m, "domainFingerprintFormat"));
    const credentialFingerprint = configured ? configured.credentialFingerprint.fingerprint : fn(field(m, "credentialFingerprint"));
    const credentialFingerprintFormat = configured ? configured.credentialFingerprint.isWellFormedFingerprint : fn(field(m, "credentialFingerprintFormat"));
    const generateUuid = fn(field(m, "generateUuid")), now = fn(field(m, "now"));
    const limits: Record<string, number> = {};
    for (const name of ["checkpointBatchKeyLimit", "latchWriteAttemptLimit", "maxPlansPerRun", "protocolStepLimit", "faultWriteAttemptLimit"]) {
      const value = field(bounds, name);
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) invalid(value);
      limits[name] = value as number;
    }
    if (engine !== undefined) object(engine);
    if (protectedBinding !== undefined) object(protectedBinding);
    if (sqlPlatform !== undefined) fn(sqlPlatform);
    if (detectPlatform !== undefined) fn(detectPlatform);
    migration = Object.freeze({ sqlite: Object.freeze({ databaseName, engine, detectPlatform: sqlPlatform }), providerConfigIdentity, sessionStorageKey,
      protectedBinding, detectPlatform, domainFingerprint, domainFingerprintFormat, credentialFingerprint, credentialFingerprintFormat,
      generateUuid, now, limits: Object.freeze(limits) }) as unknown as NativeCommonMigrationOptions;
    transport = fn(field(options, "fetch")) as typeof transport;
    const suppliedOrigin = field(options, "resolveAppOrigin"), suppliedNavigation = field(options, "navigate");
    origin = suppliedOrigin === undefined ? null : fn(suppliedOrigin) as () => string | null;
    navigation = suppliedNavigation === undefined ? null : fn(suppliedNavigation) as (url: string) => void;
    if (bootstrap) {
      urlPort = object(field(options, "callbackUrlAccess"));
      readUrl = fn(field(urlPort, "readCurrentUrl")) as () => string | null;
      replaceUrl = fn(field(urlPort, "replaceCurrentUrl")) as (url: string) => void;
    }
    if (sporting) {
      const suppliedLinks = authApply(authHasOwn, options, ["teamLinkDelivery"]) ? field(options, "teamLinkDelivery") : undefined;
      if (suppliedLinks !== undefined) {
        const links = object(suppliedLinks), linkOrigin = field(links, "origin");
        if (!isCanonicalNativeTeamLinkOrigin(linkOrigin)) invalid(linkOrigin);
        const suppliedPort = field(links, "port");
        let port: NativeTeamLinkPort | undefined;
        if (suppliedPort !== undefined) {
          const capturedPort = object(suppliedPort), add = fn(field(capturedPort, "addListener")), launch = fn(field(capturedPort, "getLaunchUrl"));
          port = Object.freeze({ addListener: (event, callback) => authApply(add, capturedPort, [event, callback]),
            getLaunchUrl: () => authApply(launch, capturedPort, []) });
        }
        teamLinkOptions = Object.freeze({ origin: linkOrigin as string, port });
      }
    }
    if (capturePreparation) {
      buildPreparation = capturePreparation(options, { object, field, invalid });
      dependencyReceiver = Object.freeze({ fetch: transport, resolveAppOrigin: origin, navigate: navigation });
      // All later fetch/origin/navigation calls use the sanitized captured receiver.
      input = undefined as unknown as NativeSupabaseAuthHostOptions;
    }
    // Capture platform operations once. No per-SEND dependency lookup follows
    // the final private fence. Public SDK construction remains in start().
    NativeRequest = fn(Request) as unknown as typeof NativeRequest;
    NativeResponse = fn(Response) as unknown as typeof NativeResponse;
    NativeHeaders = fn(Headers) as unknown as typeof NativeHeaders;
    const requestPrototype = object(NativeRequest.prototype);
    requestClone = fn(field(requestPrototype, "clone")) as typeof requestClone;
    requestUrlGetter = requestGetter(requestPrototype, "url") as typeof requestUrlGetter;
    requestMethodGetter = requestGetter(requestPrototype, "method") as typeof requestMethodGetter;
    if (bootstrap) {
      requestHeadersGetter = requestGetter(requestPrototype, "headers") as typeof requestHeadersGetter;
      requestCredentialsGetter = requestGetter(requestPrototype, "credentials") as typeof requestCredentialsGetter;
      requestRedirectGetter = requestGetter(requestPrototype, "redirect") as typeof requestRedirectGetter;
      requestText = fn(field(requestPrototype, "text")) as typeof requestText;
    }
    const responsePrototype = object(NativeResponse.prototype), headerPrototype = object(NativeHeaders.prototype);
    responseStatus = fn(authDescriptor(responsePrototype, "status")?.get) as typeof responseStatus;
    responseStatusText = fn(authDescriptor(responsePrototype, "statusText")?.get) as typeof responseStatusText;
    responseHeaders = fn(authDescriptor(responsePrototype, "headers")?.get) as typeof responseHeaders;
    responseText = fn(field(responsePrototype, "text")) as typeof responseText;
    eachHeader = fn(field(headerPrototype, "forEach")) as typeof eachHeader;
    if (bootstrap) {
      setHeader = fn(field(headerPrototype, "set")) as typeof setHeader;
      deleteHeader = fn(field(headerPrototype, "delete")) as typeof deleteHeader;
    }
  } catch {
    rejectedCapture = true;
    await Promise.all(malformed);
    reservation.release();
    return Object.freeze({ ok: false, reason });
  }
  const created = buildPreparation ? null : newUser ? createNativeNewUserRuntimeOwner(migration) : createNativeCombinedRetirementOwner(migration);
  if (created && !created.ok) { reservation.release(); return Object.freeze({ ok: false, reason: created.reason }); }
  const owner: NativeCommonRuntimeOwner | null = created?.ok ? created.owner : null;
  const root = migration.sessionStorageKey;
  let phase: ReturnType<NativeSupabaseAuthHost["health"]>["phase"] = "reserved";
  let code: NativeAuthWaitCode | null = null, sdkFailed = false, cleanupUnconfirmed = false;
  let storeCleanupPending = false, terminalSdkDisposed = false;
  let pair: NativeCombinedRuntimePair | null = null;
  let integration: ReturnType<typeof createProviderCredentialStorage> | null = null;
  let settlement: Extract<ReturnType<typeof createNativeCredentialSettlementStorage>, { ok: true }>["value"] | null = null;
  let sdk: ActualAuthClient | null = null, mechanics: AuthProviderMechanics | null = null;
  let dataClient: PostgrestClient | null = null, identityMapper: IdentityService | null = null;
  let sportingMapper: CloudSportingService | null = null, profileAdmission: NativeProfileAdmission | null = null;
  let sportingApplication: { cell: NativeProfileAdmission; binding: ReturnType<typeof createNativeSportingApplicationScope> } | null = null;
  let nativeTracker: { cell: NativeProfileAdmission; owner: ReturnType<typeof createNativeTrackerOwner>; binding: NativeTrackerBinding } | null = null;
  let unsubscribeCredentialFailure: (() => void) | null = null;
  let unsubscribeRuntimeRevocation: (() => void) | null = null;
  const invalidationListeners = new Set<(outcome: InvalidationOutcome) => void>();
  const pendingIntentListeners = new Set<() => void>();
  const teamLinkListeners = new Set<() => void>();
  const inactiveTeamLinks = Object.freeze({ kind: "inactive" as const });
  let teamLinks: NativeTeamLinkDelivery | null = null;
  let observeIntentReplay: (() => Promise<NativePendingIntentReplay | null>) | null = null;
  const intentReplayViews = new WeakMap<object, NonNullable<NativePendingIntentReplay["intent"]>>();
  const intentReplayReceipts = new WeakMap<object, NativePendingIntentReplay>();
  let identityFault = false, runtime: IdentityRuntimeReady | null = null;
  let closeCoordinator: (() => TransitionIdentity) | null = null, terminalTransition: TransitionIdentity | null = null;
  let bootstrapStartFlight: Promise<NativeIdentityBootstrapStart> | null = null;
  let startupCurrent: (() => boolean) | null = null;
  let captureAccountControl: (() => NativeAccountControl) | null = null;
  let sourceFreshEvent: object | null = null, sourceCommandToken: object | null = null;
  let accountCallback: { invalidate(): Promise<InvalidationOutcome> } | null = null;
  const deletionRequests = new Set<string>();
  const nativeApiOrigin = sporting ? resolveNativeApiOriginConfig() : { status: "not_configured" as const };
  const runtimeWork = new Set<Promise<unknown>>();
  const progressListeners = new Set<(phase: GateProgressPhase, transition?: TransitionIdentity) => void>();
  const barrierListeners = new Set<() => void>();
  let startFlight: Promise<NativeAuthStart> | null = null, disposal: Promise<NativeAuthCleanup> | null = null;
  function observeDependency(value: unknown): Promise<unknown> {
    // Already-owned terminal work must never become its own drain prerequisite.
    return disposal !== null && value === disposal || buildPreparation && ownsHostCompletion(value) ? Promise.resolve(undefined) : authObserve(value);
  }
  let needsRecovery = false, terminal = false, intent = 0, generation = 0, queued = 0;
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<(change: NormalizedAuthChange) => void>();
  let publicationContext: (() => boolean) | null = null, navigationContext: (() => boolean) | null = null;
  type Command = { originalAdmission: NativeProfileAdmission | null; kind: "init" | "restore" | "otp" | "verify" | "review_password" | "signout" | "prepare" | "exchange";
    intent: number; active: boolean; generation: number; sourceToken: object | null;
    rootRaw: string | null; expiry: number | null; refreshRejected: boolean; denial: boolean;
    userIssued: boolean; userResponse: boolean; userGeneration: number; userUncertain: boolean; supersededCredential: boolean; invalidInput: boolean; malformed: Promise<unknown>[];
    contextCurrent: (() => boolean) | null; expectedAccount: string | null; data: boolean; dataStage: "session" | "rpc" | null; rpc: string | null; rpcBody: string | null; bearer: string | null; sessionResult: unknown };
  let active: Command | null = null;
  const auxiliary = new Set<Promise<unknown>>();
  const ownedCommands = new WeakSet<object>();
  function ownsHostCompletion(value: unknown): boolean {
    return value !== null && (typeof value === "object" || typeof value === "function") &&
      (value === disposal || value === startFlight || value === bootstrapStartFlight || value === tail || runtimeWork.has(value as Promise<unknown>) ||
        auxiliary.has(value as Promise<unknown>) || ownedCommands.has(value));
  }
  const preparation = buildPreparation?.(migration, ownsHostCompletion, () => !terminal && reservation!.current(), work => {
    // Exact actual publication completion, registered by its owner before work.
    // Do not wrap its factual SQL result through runtime availability mapping.
    ownedCommands.add(work); auxiliary.add(work);
    void work.then(() => { auxiliary.delete(work); }, () => { auxiliary.delete(work); });
  }) ?? null;
  function retainAuxiliary(value: unknown): void {
    // This exact promise is already owned. Making it auxiliary would make
    // genuine disposal await itself. Unknown provider dependency graphs remain C4.
    if (disposal !== null && value === disposal) return;
    const pending = observeDependency(value).then(() => {}, () => {});
    auxiliary.add(pending); void pending.then(() => { auxiliary.delete(pending); });
  }
  function malformedFor(c: Command | null, value: unknown): void {
    if (c) c.invalidInput = true; // before any thenable assimilation/reentrancy
    if ((typeof value === "object" && value !== null) || typeof value === "function") {
      if (c) c.malformed.push(observeDependency(value).then(() => {}, () => {}));
      else retainAuxiliary(value);
    }
  }
  function malformedArgument(value: unknown): void { malformedFor(active, value); }
  function malformedPromiseArgument(value: unknown): boolean {
    if (disposal !== null && value === disposal || preparation && ownsHostCompletion(value)) { if (active) active.invalidInput = true; return true; }
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    try { authApply(authThen, value, [finish, finish]); }
    catch { return false; }
    if (active) { active.invalidInput = true; active.malformed.push(pending); }
    else { auxiliary.add(pending); void pending.then(() => { auxiliary.delete(pending); }); }
    return true;
  }
  let initDenial: { intent: number } | null = null;
  let initUncertain = false, constructionIssued = false;
  function storageFaultRecorded(): boolean {
    const state = pair?.health();
    return !!state && (state.protocol !== "healthy" || state.domain !== "healthy" || state.credential !== "healthy" ||
      (integration !== null && integration.observedFailure() !== null) || settlement?.failed() === true);
  }
  function storageHealthy(): boolean { return pair?.health().lifecycle === "active" && !storageFaultRecorded(); }
  function commandCurrent(c: Command): boolean { return active === c && c.active && !terminal && reservation!.current() && c.intent === intent && !identityFault && (!c.contextCurrent || c.contextCurrent()); }
  // Supersession alone does not poison physical storage health. Only the ONE
  // already-entered command retains these drain rights until SDK settlement.
  function canStore(c: Command): boolean { return active === c && c.active && !terminal && reservation!.current() && storageHealthy(); }
  function canSend(c: Command): boolean { return commandCurrent(c) && c.generation === generation && !c.invalidInput && !c.supersededCredential && storageHealthy() && !sdkFailed; }
  function makeCommand(kind: Command["kind"], stamp = intent): Command {
    return { originalAdmission: null, kind, intent: stamp, active: true, generation, sourceToken: null, rootRaw: null, expiry: null, refreshRejected: false, denial: false,
      userIssued: false, userResponse: false, userGeneration: -1, userUncertain: false, supersededCredential: false, invalidInput: false, malformed: [],
      contextCurrent: null, expectedAccount: null, data: false, dataStage: null, rpc: null, rpcBody: null, bearer: null, sessionResult: null };
  }
  function invalidateRoot(c: Command, writing: boolean): void {
    generation++; c.generation = generation; c.rootRaw = null; c.expiry = null; c.userResponse = false; c.bearer = null; c.sessionResult = null;
    if (writing) { c.denial = false; c.refreshRejected = false; }
  }
  function rememberRoot(c: Command, raw: string | null): void {
    if (c.rootRaw !== null && c.rootRaw !== raw) {
      c.supersededCredential = true;
      generation++; c.generation = generation; c.refreshRejected = false; c.denial = false; c.userResponse = false; c.bearer = null; c.sessionResult = null;
    }
    c.rootRaw = raw; c.expiry = null;
    if (raw === null) return;
    try { const parsed = JSON.parse(raw); if (typeof parsed.expires_at === "number" && Number.isFinite(parsed.expires_at)) c.expiry = parsed.expires_at; } catch { /* actual runtime normally refuses this before here */ }
  }
  function causalDebug(_ignored: string, ...args: unknown[]): void {
    const c = active;
    if (!c || !commandCurrent(c) || c.generation !== generation) return;
    if (c.kind === "restore" && args[0] === "#_callRefreshToken()" && args[1] === "error") {
      const observedGeneration = generation;
      const classification = classifyProviderFailure(args[2]);
      if (commandCurrent(c) && observedGeneration === generation && c.generation === generation && classification === "definitively_invalid") { c.refreshRejected = true; if (denied(c)) vetoTraining(c); }
      return;
    }
    if (args[0] !== "#_removeSession()") return;
    if (c.kind === "restore" && c.refreshRejected && c.rootRaw !== null) { c.denial = true; vetoTraining(c); }
    if (c.kind === "init" && c.rootRaw !== null && c.userIssued && c.userResponse && c.userGeneration === generation) {
      c.denial = true; initDenial = { intent: c.intent }; c.userUncertain = false;
    }
  }
  function vetoTraining(c: Command): void {
    if (commandCurrent(c) && !c.supersededCredential && c.generation === generation && c.originalAdmission && nativeTracker?.cell === c.originalAdmission) { nativeTracker.owner.deny(); sportingApplication?.binding.retire(); }
  }
  function denied(c: Command): boolean {
    if (!commandCurrent(c) || c.supersededCredential) return false;
    if (c.denial) return true;
    return c.kind === "restore" && c.refreshRejected && c.generation === generation && c.rootRaw !== null && c.expiry !== null &&
      !(c.expiry && c.expiry * 1000 > authNow());
  }
  function closedError(): AuthRetryableFetchError { return new AuthRetryableFetchError("Authentication operation unavailable", 503); }
  function allowedRequest(requestUrl: string, requestMethod: string, kind: Command["kind"]): boolean {
    const url = new URL(requestUrl), base = authBase;
    if (url.origin !== base.origin || url.username || url.password || url.hash) return false;
    const route = url.pathname.slice(base.pathname.length);
    if (url.pathname !== base.pathname + route) return false;
    const entries = [...url.searchParams];
    if (requestMethod === "GET") return route === "/user" && entries.length === 0;
    if (requestMethod !== "POST") return false;
    if (route === "/otp" || route === "/verify") return entries.length === 0;
    if (route === "/token") return entries.length === 1 && entries[0][0] === "grant_type" &&
      (["pkce", "refresh_token"].includes(entries[0][1]) ||
        (entries[0][1] === "password" && kind === "review_password" && newUser && !preparation));
    return route === "/logout" && entries.length === 1 && entries[0][0] === "scope" && entries[0][1] === "local";
  }
  type TeamWireIntent = Readonly<{ url: string; method: "GET" | "POST"; body: string; purpose?: "own_api" }>;
  const ownedFetch: typeof globalThis.fetch = (requestInput, init) => {
    const c = active;
    return c ? ownedFetchFor(c, requestInput, init) : Promise.reject(closedError());
  };
  async function ownedFetchFor(c: Command, requestInput: RequestInfo | URL, init?: RequestInit, teamWire?: TeamWireIntent): Promise<Response> {
    let request: Request, requestUrl: string, requestMethod: string, malformedRequest: unknown;
    let headerRejected = false;
    function checkHeader(value: unknown, key: unknown): void {
      if (headerRejected) throw null;
      for (const primitive of [value, key]) {
        if (typeof primitive !== "string") {
          // Revoke before retaining the directly observed malformed argument.
          // A provider that swallows the callback throw cannot resume processing.
          headerRejected = true; sdkFailed = true; malformedFor(c, primitive); throw null;
        }
      }
    }
    try {
      const constructed = new NativeRequest(requestInput, { ...init, credentials: "omit", redirect: "error" });
      malformedRequest = constructed;
      // Intrinsic clone brand-checks the actual constructor output, strips own
      // accessors and privately owns the fully materialized Request before SEND.
      request = authApply(requestClone, constructed, []) as Request;
      malformedRequest = request;
      const observedUrl: unknown = authApply(requestUrlGetter, request, []);
      if (typeof observedUrl !== "string") { if (observedUrl !== undefined) malformedRequest = observedUrl; throw null; }
      requestUrl = observedUrl;
      const observedMethod: unknown = authApply(requestMethodGetter, request, []);
      if (typeof observedMethod !== "string") { if (observedMethod !== undefined) malformedRequest = observedMethod; throw null; }
      requestMethod = observedMethod;
      malformedRequest = undefined;
      let isData = false;
      if (c.data && c.dataStage === "rpc" && c.rpc !== null) {
        const restBase = new URL("rest/v1", new URL(config.url.endsWith("/") ? config.url : config.url + "/"));
        const candidate = new URL(requestUrl);
        isData = candidate.origin === restBase.origin && candidate.pathname === restBase.pathname + "/rpc/" + c.rpc &&
          !candidate.search && !candidate.hash && !candidate.username && !candidate.password && requestMethod === "POST";
      }
      if (teamWire) {
        if (requestUrl !== teamWire.url || requestMethod !== teamWire.method) throw null;
        isData = true;
      }
      if (isData) {
        const ownApi = teamWire?.purpose === "own_api";
        const schemaHeader = teamWire?.method === "GET" ? "accept-profile" : "content-profile";
        const originalHeaders = authApply(requestHeadersGetter, request, []);
        malformedRequest = originalHeaders;
        const headerEntries: [string, string][] = [];
        const sourceHeaderAck = authApply(eachHeader, originalHeaders, [(value: string, key: string) => { checkHeader(value, key); headerEntries.push([key, value]); }]);
        if (sourceHeaderAck !== undefined) { malformedRequest = sourceHeaderAck; throw null; }
        if (headerRejected) throw null;
        if (!ownApi && !headerEntries.some(([name, value]) => name === schemaHeader && value === "public")) throw null;
        const headers = new NativeHeaders(headerEntries);
        malformedRequest = headers;
        const ownedHeaderAck = authApply(eachHeader, headers, [(value: unknown, key: unknown) => checkHeader(value, key)]);
        if (ownedHeaderAck !== undefined) { malformedRequest = ownedHeaderAck; throw null; }
        if (headerRejected) throw null;
        if (!ownApi) {
          const keyAck = authApply(setHeader, headers, ["apikey", config.publishableKey]);
          if (keyAck !== undefined) { malformedRequest = keyAck; throw null; }
        }
        if (!teamWire && c.rpc === "get_current_legal_documents") {
          const deleteAck = authApply(deleteHeader, headers, ["Authorization"]);
          if (deleteAck !== undefined) { malformedRequest = deleteAck; throw null; }
        }
        else {
          if (!c.bearer || c.generation !== generation || !c.expectedAccount) throw null;
          const bearerAck = authApply(setHeader, headers, ["Authorization", `Bearer ${c.bearer}`]);
          if (bearerAck !== undefined) { malformedRequest = bearerAck; throw null; }
        }
        // The intended RPC parameters are captured before the SDK builds the
        // request. No constructor output can redefine that intent.
        const expectedHeaders = new Map<string, string>([
          ...(ownApi ? [] : [["apikey", config.publishableKey], [schemaHeader, "public"]] as [string, string][]),
          ...(teamWire?.method === "GET" ? [] : [["content-type", "application/json"] as [string, string]]),
          ...(!teamWire && c.rpc === "get_current_legal_documents" ? [] : [["authorization", `Bearer ${c.bearer}`] as [string, string]]),
        ]);
        request = new NativeRequest(request, { headers, credentials: "omit", redirect: "error" });
        malformedRequest = request;
        request = authApply(requestClone, request, []) as Request;
        malformedRequest = request;
        // Read a clone so the exact verified Request remains available for SEND.
        // No constructor follows body completion; final header/primitive proof is below.
        const bodyClone = authApply(requestClone, request, []);
        malformedRequest = bodyClone;
        const body = await observeDependency(authApply(requestText, bodyClone, []));
        malformedRequest = body;
        if (typeof body !== "string" || body !== (teamWire ? teamWire.body : c.rpcBody)) throw null;
        malformedRequest = undefined;
        const finalUrl: unknown = authApply(requestUrlGetter, request, []);
        malformedRequest = finalUrl;
        if (typeof finalUrl !== "string" || finalUrl !== (teamWire ? teamWire.url : requestUrl)) throw null;
        malformedRequest = undefined;
        const finalMethod: unknown = authApply(requestMethodGetter, request, []);
        malformedRequest = finalMethod;
        if (typeof finalMethod !== "string" || finalMethod !== (teamWire ? teamWire.method : "POST")) throw null;
        malformedRequest = undefined;
        const credentials: unknown = authApply(requestCredentialsGetter, request, []);
        malformedRequest = credentials;
        if (credentials !== "omit") throw null;
        malformedRequest = undefined;
        const redirect: unknown = authApply(requestRedirectGetter, request, []);
        malformedRequest = redirect;
        if (redirect !== "error") throw null;
        malformedRequest = undefined;
        const finalHeaders = authApply(requestHeadersGetter, request, []);
        malformedRequest = finalHeaders;
        const actualHeaders: [string, string][] = [];
        const finalHeaderAck = authApply(eachHeader, finalHeaders, [(value: string, key: string) => { checkHeader(value, key); actualHeaders.push([key, value]); }]);
        if (finalHeaderAck !== undefined) { malformedRequest = finalHeaderAck; throw null; }
        if (headerRejected) throw null;
        malformedRequest = undefined;
        if (actualHeaders.length !== expectedHeaders.size || actualHeaders.some(([key, value]) => expectedHeaders.get(key) !== value)) throw null;
      } else if ((c.data && c.dataStage !== "session") || !allowedRequest(requestUrl, requestMethod, c.kind)) throw null;
    } catch {
      sdkFailed = true; // revoke before observing an invalid dependency
      await observeDependency(malformedRequest).then(() => {}, () => {});
      throw closedError();
    }
    const userRequest = c.kind === "init" && requestMethod === "GET" && new URL(requestUrl).pathname === authBase.pathname + "/user";
    // Last callback-free fence, after all request construction/materialization.
    if (!canSend(c)) throw closedError();
    if (userRequest) { c.userIssued = true; c.userGeneration = generation; c.userUncertain = true; }
    let raw: unknown;
    try { raw = await observeDependency(authApply(transport, dependencyReceiver, [request])); }
    catch { throw closedError(); }
    // Never expose a foreign Response's own getters or thrown reasons to the
    // SDK's typed classifier. SDK alone parses this freshly owned response.
    let response: Response, malformedResponse: unknown = raw;
    try {
      const status: unknown = authApply(responseStatus, raw, []);
      malformedResponse = status;
      if (typeof status !== "number" || !Number.isInteger(status) || status < 200 || status > 599) throw null;
      malformedResponse = undefined;
      const statusText: unknown = authApply(responseStatusText, raw, []);
      malformedResponse = statusText;
      if (typeof statusText !== "string") throw null;
      malformedResponse = undefined;
      const actualHeaders = authApply(responseHeaders, raw, []);
      malformedResponse = actualHeaders;
      const entries: [string, string][] = [];
      const headerAck = authApply(eachHeader, actualHeaders, [(value: string, name: string) => { if (bootstrap) checkHeader(value, name); entries.push([name, value]); }]);
      if (headerAck !== undefined) { malformedResponse = headerAck; throw null; }
      if (headerRejected) throw null;
      malformedResponse = undefined;
      const body = await observeDependency(authApply(responseText, raw, []));
      malformedResponse = body;
      if (typeof body !== "string") throw null;
      malformedResponse = undefined;
      const ownedHeaders = new NativeHeaders(entries);
      malformedResponse = ownedHeaders;
      const ownedHeaderAck = authApply(eachHeader, ownedHeaders, [bootstrap ? (value: unknown, key: unknown) => checkHeader(value, key) : () => {}]);
      if (ownedHeaderAck !== undefined) { malformedResponse = ownedHeaderAck; throw null; }
      if (headerRejected) throw null;
      malformedResponse = undefined;
      response = new NativeResponse([204, 205, 304].includes(status) ? null : body, { status, statusText, headers: ownedHeaders });
      malformedResponse = response;
      const ownedStatus: unknown = authApply(responseStatus, response, []);
      malformedResponse = ownedStatus;
      if (typeof ownedStatus !== "number") throw null;
    } catch {
      sdkFailed = true;
      await observeDependency(malformedResponse).then(() => {}, () => {});
      throw closedError();
    }
    // After signout the old SDK may only finish its storage drain; no result
    // can publish and every subsequent SDK retry must pass the SEND fence anew.
    if (!canStore(c)) throw closedError();
    if (userRequest && commandCurrent(c) && c.userGeneration === generation) c.userResponse = true;
    return response;
  }
  function wait(value: NativeAuthWaitCode): NativeAuthStart { phase = "waiting"; code = value; return Object.freeze({ outcome: "waiting", code: value }); }
  function emit(change: NormalizedAuthChange, stamp: number): void {
    // The result identity never crosses this observer boundary. Freeze the
    // detached copy before any listener can modify later listeners or results.
    const observation: NormalizedAuthChange = change.reason === "signed_out"
      ? Object.freeze({ reason: "signed_out" })
      : Object.freeze({ reason: change.reason, identity: change.identity === null ? null : Object.freeze({ accountScopeId: change.identity.accountScopeId, email: change.identity.email }) }) as NormalizedAuthChange;
    for (const listener of [...listeners]) {
      if (terminal || stamp !== intent || !storageHealthy() || sdkFailed || identityFault || (publicationContext && !publicationContext())) break;
      try {
        const returned = authApply(listener, undefined, [observation]);
        if (returned !== undefined) retainAuxiliary(returned);
      } catch { /* no raw listener reason or global rejection handler */ }
    }
  }
  type CommandBinding = { admission?: NativeProfileAdmission | null; current: (() => boolean) | null; data?: boolean; rpc?: string; expectedAccount?: string | null };
  function enqueue<T>(kind: Command["kind"], operation: () => Promise<T>, fallback: () => T, publish?: (value: T, stamp: number) => void, binding?: CommandBinding): Promise<T> {
    const stamp = intent;
    // Accepted enqueue, not eventual execution/generation change, revokes the
    // previous source-only server observation. Keep this invocation's original.
    const sourceToken = preparation?.ownServerControl ? (sourceCommandToken = {}) : null;
    const originalAdmission = binding?.admission ?? (binding?.expectedAccount && profileAdmission?.current() && profileAdmission.accountScopeId === binding.expectedAccount ? profileAdmission : null);
    queued++;
    const result = tail.then(async () => {
      if (terminal || stamp !== intent || identityFault || (binding?.current && !binding.current())) return fallback();
      if (kind === "restore" && !binding?.data && initDenial?.intent === intent) return { kind: "invalid_session" } as T;
      if (phase !== "ready" || !storageHealthy() || sdkFailed || !mechanics) return fallback();
      const c = makeCommand(kind, stamp); c.sourceToken = sourceToken; c.originalAdmission = originalAdmission; active = c;
      c.contextCurrent = binding?.current ?? null; c.data = binding?.data === true; c.rpc = binding?.rpc ?? null; c.expectedAccount = binding?.expectedAccount ?? null;
      c.dataStage = c.data ? "session" : null;
      let value: T;
      try { value = await operation(); }
      catch { value = fallback(); }
      await Promise.all(c.malformed);
      const causalDenial = !c.data && kind === "restore" && (value as SessionRestoreOutcome).kind !== "authenticated" && commandCurrent(c) && denied(c);
      if (causalDenial) value = { kind: "invalid_session" } as T;
      else if (!commandCurrent(c) || !storageHealthy() || sdkFailed || initUncertain || c.invalidInput || c.supersededCredential) value = fallback();
      c.active = false; c.rootRaw = null; c.rpcBody = null; c.bearer = null; c.sessionResult = null; active = null;
      const previousPublication = publicationContext;
      publicationContext = c.contextCurrent;
      try { if (!terminal && stamp === intent && !identityFault && (!c.contextCurrent || c.contextCurrent())) publish?.(value, stamp); }
      finally { publicationContext = previousPublication; }
      // Synchronous observers may sign out/dispose or fault actual storage.
      // This is the final publication fence, after ALL foreign delivery calls.
      if (terminal || stamp !== intent || identityFault || (c.contextCurrent && !c.contextCurrent()) || (!causalDenial && (!storageHealthy() || sdkFailed || initUncertain || c.invalidInput || c.supersededCredential))) return fallback();
      return value;
    }).catch(() => fallback());
    if (preparation) ownedCommands.add(result);
    tail = result.then(() => { queued--; }, () => { queued--; });
    return result;
  }
  function makeAuth(contextCurrent: (() => boolean) | null = null, originalAdmission: NativeProfileAdmission | null = null): AuthProviderMechanics {
    const enqueueBound = <T,>(kind: Command["kind"], operation: () => Promise<T>, fallback: () => T, publish?: (value: T, stamp: number) => void) =>
      enqueue(kind, operation, fallback, publish, { current: contextCurrent, admission: originalAdmission, expectedAccount: originalAdmission?.accountScopeId });
    return Object.freeze({
    restoreSession() {
      return enqueueBound("restore", async () => {
        const value = await mechanics!.restoreSession();
        const c = active!;
        if (originalAdmission && commandCurrent(c) && (value.kind === "invalid_session" || (value.kind === "no_session" && storageHealthy()) || (value.kind === "authenticated" && value.identity.accountScopeId !== originalAdmission.accountScopeId))) vetoTraining(c);
        return value;
      }, () => ({ kind: "temporarily_unavailable" as const }), (value: SessionRestoreOutcome, stamp: number) => {
        if (value.kind === "authenticated") emit({ reason: "initial_session", identity: value.identity }, stamp);
        else if (value.kind === "no_session") emit({ reason: "initial_session", identity: null }, stamp);
      });
    },
    onAuthChange(listener: (change: NormalizedAuthChange) => void) {
      if (typeof listener !== "function") { malformedArgument(listener); return () => {}; }
      if (terminal) return () => {};
      listeners.add(listener); let removed = false;
      return () => { if (!removed) { removed = true; listeners.delete(listener); } };
    },
    requestEmailOtp(email: string) {
      return enqueueBound("otp", async () => { if (typeof email !== "string") { malformedArgument(email); return unavailableAuth(); } return mechanics!.requestEmailOtp(email); }, unavailableAuth);
    },
    verifyEmailOtp(email: string, token: string) {
      return enqueueBound("verify", async () => { if (typeof email !== "string") { malformedArgument(email); return unavailableAuth(); } if (typeof token !== "string") { malformedArgument(token); return unavailableAuth(); } return mechanics!.verifyEmailOtp(email, token); }, unavailableAuth,
        (value: AuthServiceResult<AccountIdentity>, stamp: number) => { if (value.ok) emit({ reason: "signed_in", identity: value.value }, stamp); });
    },
    canSignInForReview() { return newUser && !preparation && !terminal && !identityFault && reservation!.current() && phase === "ready" && storageHealthy() && !sdkFailed; },
    signInForReview(email: string, password: string) {
      // Dormant installation-import hosts acquire no review-password authority
      // through this shared mechanics contract. Normal beta startup has no preparation.
      if (!newUser || preparation) return Promise.resolve(unavailableAuth());
      return enqueueBound("review_password", async () => {
        if (typeof email !== "string") { malformedArgument(email); return unavailableAuth(); }
        if (typeof password !== "string") { malformedArgument(password); return unavailableAuth(); }
        return mechanics!.signInForReview(email, password);
      }, unavailableAuth,
      (value: AuthServiceResult<AccountIdentity>, stamp: number) => { if (value.ok) emit({ reason: "signed_in", identity: value.value }, stamp); });
    },
    signOut() {
      nativeTracker?.owner.retire();
      intent++; // synchronous intent, independent of storage health/settlement
      initDenial = null;
      return enqueueBound("signout", () => mechanics!.signOut(), unavailableAuth,
        (value: AuthServiceResult<void>, stamp: number) => { if (value.ok) emit({ reason: "signed_out" }, stamp); });
    },
    prepareGoogleSignIn(redirectTo: string) {
      return enqueueBound("prepare", async () => { if (typeof redirectTo !== "string") { malformedArgument(redirectTo); return { kind: "temporarily_unavailable" as const }; } return mechanics!.prepareGoogleSignIn(redirectTo); }, () => ({ kind: "temporarily_unavailable" as const }));
    },
    navigateToAuthorizationUrl(prepared: PreparedAuthorization): NavigationOutcome {
      if (terminal || identityFault || (contextCurrent && !contextCurrent()) || phase !== "ready" || queued || active || startFlight || !mechanics || !storageHealthy() || sdkFailed || !navigation || !origin) return { kind: "navigation_failed" };
      try {
        if (malformedPromiseArgument(prepared)) return { kind: "navigation_failed" };
        if (!prepared || typeof prepared !== "object") { malformedArgument(prepared); return { kind: "navigation_failed" }; }
        const stamp = intent, url = prepared.authorizationUrl;
        if (typeof url !== "string") { malformedArgument(url); return { kind: "navigation_failed" }; }
        if (terminal || stamp !== intent) return { kind: "navigation_failed" };
        const flowId = prepared.flowId;
        if (typeof flowId !== "string") { malformedArgument(flowId); return { kind: "navigation_failed" }; }
        if (terminal || stamp !== intent || queued || active || !storageHealthy()) return { kind: "navigation_failed" };
        const previous = navigationContext;
        navigationContext = contextCurrent;
        try { return mechanics.navigateToAuthorizationUrl({ authorizationUrl: url, flowId }); }
        finally { navigationContext = previous; }
      } catch { return { kind: "navigation_failed" }; }
    },
    exchangeCorrelatedCallback(claim: ClaimedCallback, expectedFlowId: string) {
      return enqueueBound("exchange", async () => {
        if (typeof expectedFlowId !== "string") { malformedArgument(expectedFlowId); return { kind: "temporarily_unavailable" as const }; }
        if (malformedPromiseArgument(claim)) return { kind: "exchange_failed" as const };
        if (!claim || typeof claim !== "object") { malformedArgument(claim); return { kind: "exchange_failed" as const }; }
        const wrapped = {
          get flowId() {
            if (!active || !canSend(active)) return "";
            const value = claim.flowId;
            if (typeof value !== "string") malformedArgument(value);
            return value;
          },
          readAuthorizationCode() {
            if (!active || !canSend(active)) return null;
            const read = claim.readAuthorizationCode;
            if (typeof read !== "function") { malformedArgument(read); return null; }
            if (!active || !canSend(active)) return null;
            const value = authApply(read, claim, []);
            if (typeof value !== "string" && value !== null) malformedArgument(value);
            return value;
          },
          toJSON: () => ({}),
        };
        return mechanics!.exchangeCorrelatedCallback(wrapped, expectedFlowId);
      }, () => ({ kind: "temporarily_unavailable" as const }),
        (value: ExchangeOutcome, stamp: number) => { if (value.kind === "exchanged") emit({ reason: "signed_in", identity: value.identity }, stamp); });
    },
    });
  }
  let startupDiagnostic: string | null = null;
  function recordStartupReport(report: NativeCommonMigrationReport) {
    // Only closed, internally produced enum fields. Never stringify a report,
    // candidate, exception, SQL/protected value or dependency.
    startupDiagnostic = newUser && report.outcome !== "candidate" && report.outcome !== "recovered"
      ? `${owner!.startupStage()}/${report.outcome}${"code" in report ? `/${report.code}` : "boundary" in report ? `/${report.boundary}` : ""}` : null;
  }
  const auth = makeAuth();
  const host: NativeSupabaseAuthHost = Object.freeze({
    auth,
    start() {
      if (terminal) return Promise.resolve(Object.freeze({ outcome: "closed" as const }));
      if (startFlight) return startFlight;
      if (queued || active) return Promise.resolve(Object.freeze({ outcome: "waiting" as const, code: "busy" as const }));
      if (phase === "ready") return Promise.resolve(storageHealthy() && !sdkFailed ? Object.freeze({ outcome: "ready" as const }) : wait(storageFaultRecorded() ? "credential_failed" : "sdk_failed"));
      if (code === "restart_required") return Promise.resolve(wait("restart_required"));
      if (sdk || sdkFailed) return Promise.resolve(wait(storageFaultRecorded() ? "credential_failed" : "sdk_failed"));
      phase = "preparing"; code = null; startupDiagnostic = null;
      startFlight = Promise.resolve().then(async (): Promise<NativeAuthStart> => {
        if (preparation) {
          const prepared = await preparation.prepare();
          if ("pair" in prepared) pair = prepared.pair;
          if (terminal || "closed" in prepared) return Object.freeze({ outcome: "closed" });
          if ("code" in prepared) return wait(prepared.code);
          if (!pair) return wait("handoff_refused");
        } else {
          if (needsRecovery) {
            const recovered = await owner!.recover();
            recordStartupReport(recovered);
            if (terminal) return Object.freeze({ outcome: "closed" });
            if (recovered.outcome !== "recovered") return wait("recovery_required");
            needsRecovery = false;
          }
          const report = await owner!.run();
          recordStartupReport(report);
          if (terminal) return Object.freeze({ outcome: "closed" });
          if (report.outcome !== "candidate") {
            if (report.outcome === "recovery_required") { needsRecovery = true; return wait("recovery_required"); }
            return wait(report.outcome === "fault" ? "migration_fault" : report.outcome === "blocked" ? "migration_blocked" : "migration_incomplete");
          }
          let candidate = report.candidate;
          if (!newUser) {
            const retired = await (owner as NativeCommonRetirementOwner).retire(candidate);
            if (terminal) return Object.freeze({ outcome: "closed" });
            if (retired.outcome !== "retired" && retired.outcome !== "source_absent") return wait("retirement_incomplete");
            candidate = retired.candidate;
          }
          const handoff = await owner!.handoff(candidate);
          // Retain an actual late pair even when disposal won publication.
          if (handoff.outcome === "runtime") pair = handoff.pair;
          if (terminal) return Object.freeze({ outcome: "closed" });
          if (!pair) return wait("handoff_refused");
        }
        unsubscribeRuntimeRevocation = subscribeNativeRuntimeRevocation(pair, retireSportingApplicationIfUnavailable);
        integration = createProviderCredentialStorage(pair.credentials, { sessionStorageKey: root });
        unsubscribeCredentialFailure = integration.subscribe(() => { nativeTracker?.owner.fault(pair!.health().firstCredentialFailure); sportingApplication?.binding.retire(); });
        const mapped = createNativeCredentialSettlementStorage(integration.storage, () => integration!.observedFailure());
        if (!mapped.ok) { sdkFailed = true; return wait("sdk_failed"); }
        settlement = mapped.value;
        const c = makeCommand("init"); active = c;
        const storage = Object.freeze({
          async getItem(key: string) {
            const current = active;
            if (!current || !canStore(current)) throw closedError();
            const value = await settlement!.storage.getItem(key);
            if (!canStore(current)) throw closedError();
            if (key === root) rememberRoot(current, value);
            return value;
          },
          async setItem(key: string, value: string) {
            const current = active;
            if (!current || !canStore(current) || current.supersededCredential) throw closedError();
            if (key === root) invalidateRoot(current, true);
            await settlement!.storage.setItem(key, value);
            if (!canStore(current)) throw closedError();
            if (key === root) { current.userUncertain = false; initDenial = null; initUncertain = false; }
          },
          async removeItem(key: string) {
            const current = active;
            if (!current || !canStore(current) || current.supersededCredential) throw closedError();
            if (key === root) invalidateRoot(current, false);
            await settlement!.storage.removeItem(key);
            if (!canStore(current)) throw closedError();
          },
        });
        try {
          if (!reservation!.constructOnce(root)) return wait("restart_required");
          constructionIssued = true;
          sdk = new AuthClient({ url: authBase.href, headers: { apikey: config.publishableKey, Authorization: `Bearer ${config.publishableKey}` },
            ...BROWSER_AUTH_OPTIONS, storageKey: root, storage, persistSession: true, autoRefreshToken: false, skipAutoInitialize: true,
            fetch: ownedFetch, debug: causalDebug });
          // Constructor BC exists even with skipAutoInitialize. Close it before
          // initialization can touch credentials; no SDK event subscriber exists.
          try { await sdk.dispose(); } catch { cleanupUnconfirmed = true; throw null; }
          if (terminal) return Object.freeze({ outcome: "closed" });
          let initialized: Awaited<ReturnType<ActualAuthClient["initialize"]>>;
          try { initialized = await sdk.initialize(); }
          finally { try { await sdk.stopAutoRefresh(); } catch { cleanupUnconfirmed = true; throw null; } }
          if (c.userIssued && !c.denial) {
            // SDK successfully recovered user iff its actual root write ran.
            // An unresolved GET failure must not be normalized to clean absence.
            initUncertain = c.userUncertain;
          }
          if (terminal) return Object.freeze({ outcome: "closed" });
          if (initialized.error) { sdkFailed = true; return wait("sdk_failed"); }
          if (!storageHealthy()) return wait("credential_failed");
          if (initUncertain) return wait("sdk_failed");
          const actual = sdk;
          const guard = <T extends (...args: never[]) => unknown>(method: T): T => ((...args: never[]) => {
            const current = active;
            if (!current || !canSend(current)) return Promise.reject(closedError());
            return authApply(method, actual, args);
          }) as T;
          const authClient: AuthMechanicsClient["auth"] = {
            getSession: bootstrap ? async () => {
              const current = active;
              const result = await guard(actual.getSession)();
              if (current?.data && commandCurrent(current)) current.sessionResult = result;
              return result;
            } : guard(actual.getSession),
            signInWithOtp: guard(actual.signInWithOtp), signInWithPassword: guard(actual.signInWithPassword), verifyOtp: guard(actual.verifyOtp), signOut: guard(actual.signOut),
            signInWithOAuth: guard(actual.signInWithOAuth), exchangeCodeForSession: guard(actual.exchangeCodeForSession),
            // The native public observer path never calls the shared SDK path.
            onAuthStateChange: () => { throw new Error("Native SDK subscriptions are unavailable."); },
          };
          mechanics = buildSupabaseAuthMechanics(config, { auth: authClient }, {
            credentialHealth: () => storageHealthy() ? null : { kind: "credential_failed" },
            resolveAppOrigin: () => {
              const before = intent;
              if (!origin || terminal) return null;
              const value = authApply(origin, dependencyReceiver, []);
              if (typeof value !== "string" && value !== null) { malformedArgument(value); return null; }
              if (terminal || before !== intent || !storageHealthy()) return null;
              return value;
            },
            navigate: value => {
              const before = intent, navigate = navigation;
              if (!navigate || terminal || queued || active || !storageHealthy() || sdkFailed) throw null;
              // All foreign prepared/origin reads have finished in the shared
              // validator. The captured operation follows a private final fence.
              if (before !== intent || !reservation!.current() || identityFault || (navigationContext && !navigationContext())) throw null;
              const result = authApply(navigate, dependencyReceiver, [value]);
              if (result !== undefined) { retainAuxiliary(result); throw null; }
            },
          }, newUser && !preparation ? nativeReviewPasswordCapability : undefined);
          phase = "ready"; code = null;
          return Object.freeze({ outcome: "ready" });
        } catch { sdkFailed = true; if (constructionIssued && !sdk) cleanupUnconfirmed = true; return terminal ? Object.freeze({ outcome: "closed" }) : wait("sdk_failed"); }
        finally { c.active = false; c.rootRaw = null; active = null; }
      }).catch(() => { sdkFailed = true; return terminal ? Object.freeze({ outcome: "closed" as const }) : wait("sdk_failed"); });
      const flight = startFlight;
      void flight.then(() => { if (startFlight === flight) startFlight = null; });
      return flight;
    },
    health() {
      return Object.freeze({ phase, code, storageFailed: storageFaultRecorded(), sdkFailed, cleanupUnconfirmed: cleanupUnconfirmed || storeCleanupPending, runtime: pair?.health() ?? null });
    },
    dispose() {
      if (disposal) return disposal;
      const firstClose = !terminal;
      terminal = true; if (firstClose || !preparation) intent++;
      sourceFreshEvent = null; sourceCommandToken = null;
      phase = "closing"; listeners.clear();
      // Retire source callback synchronously, before underlying pair cancellation.
      const cleanupTarget = pair ?? preparation ?? owner!;
      let immediateCleanup: Promise<NativeAuthCleanup>;
      // Assign the joined promise BEFORE invoking genuine cancellation: native
      // cleanup/source callbacks may synchronously reenter host.dispose().
      disposal = Promise.resolve().then(async (): Promise<NativeAuthCleanup> => {
        if (startFlight) await startFlight;
        if (bootstrapStartFlight) await bootstrapStartFlight;
        while (runtimeWork.size) await Promise.all([...runtimeWork]);
        await tail;
        await Promise.all([...auxiliary]);
        if (teamLinkCleanup && !(await teamLinkCleanup).ok) cleanupUnconfirmed = true;
        if (sdk && (!preparation || !terminalSdkDisposed)) {
          // Only TERMINAL cleanup can populate this cache, never the earlier
          // constructor disposal before initialization.
          try { await sdk.dispose(); if (preparation) terminalSdkDisposed = true; }
          catch { cleanupUnconfirmed = true; }
        }
        const originalCleanup = await immediateCleanup;
        // A handoff published just before cancellation may deliver its genuine
        // pair later. Its actual cleanup owns the now-transferred resources.
        const cleanup = pair && cleanupTarget !== pair ? await pair.dispose() : originalCleanup;
        if (!cleanup.ok || cleanupUnconfirmed) {
          if (preparation) storeCleanupPending = !cleanup.ok && cleanup.reason === "cleanup_unconfirmed";
          else cleanupUnconfirmed ||= !cleanup.ok && cleanup.reason === "cleanup_unconfirmed";
          phase = "closed";
          return Object.freeze({ ok: false, reason: cleanupUnconfirmed || storeCleanupPending ? "cleanup_unconfirmed" : "evidence_held" });
        }
        storeCleanupPending = false;
        phase = "closed"; reservation!.release();
        return Object.freeze({ ok: true });
      }).catch(() => { cleanupUnconfirmed = true; phase = "closed"; return Object.freeze({ ok: false as const, reason: "cleanup_unconfirmed" as const }); });
      const flight = disposal;
      if (preparation) void flight.then(result => {
        // Retry only actual store cleanup, with healthy actual source and no
        // sticky constructor/SDK/stop-refresh uncertainty. Terminal stays closed.
        if (!result.ok && storeCleanupPending && !cleanupUnconfirmed && !storageFaultRecorded() && disposal === flight) disposal = null;
      });
      const teamLinkCleanup = firstClose ? teamLinks?.close() : undefined;
      if (firstClose || !preparation) {
        // Presentation callbacks can return/reenter this exact disposal. Publish its
        // identity before the first Tracker notification or coordinator cleanup.
        nativeTracker?.owner.retire();
        sportingApplication?.binding.retire();
        unsubscribeCredentialFailure?.(); unsubscribeCredentialFailure = null;
        unsubscribeRuntimeRevocation?.(); unsubscribeRuntimeRevocation = null;
        progressListeners.clear(); barrierListeners.clear(); invalidationListeners.clear(); pendingIntentListeners.clear(); teamLinkListeners.clear(); profileAdmission = null;
        if (closeCoordinator) terminalTransition = closeCoordinator();
      }
      // These genuine private owners revoke synchronously before their first
      // await. Do not put this call behind migration or the SDK command FIFO.
      try { immediateCleanup = cleanupTarget.dispose().catch(() => { cleanupUnconfirmed = true; return { ok: false as const, reason: "cleanup_unconfirmed" as const }; }); }
      catch { cleanupUnconfirmed = true; immediateCleanup = Promise.resolve({ ok: false, reason: "cleanup_unconfirmed" }); }
      return disposal;
    },
  });
  if (!bootstrap) return Object.freeze({ ok: true, host });

  function identityAvailable(): boolean {
    return !terminal && !identityFault && phase === "ready" && storageHealthy() && !sdkFailed && !cleanupUnconfirmed;
  }
  function badIdentityValue(value?: unknown): never {
    identityFault = true;
    if (value !== undefined) retainAuxiliary(value);
    throw null;
  }
  function checkedClock(retainInvalid = retainAuxiliary): string {
    if (terminal || identityFault) throw null;
    let value: unknown;
    try { value = authApply(migration.now, migration, []); } catch { return badIdentityValue(); }
    if (isValidTimestamp(value)) return value;
    identityFault = true; // revoke before observing an unexpected async clock result
    if (value !== undefined) retainInvalid(value);
    throw null;
  }
  function retainTeamLinkClockWork(value: unknown): void {
    const work = drainObservedPlatformWork(value, candidate => disposal !== null && candidate === disposal);
    auxiliary.add(work);
    void work.then(() => { auxiliary.delete(work); }, () => { auxiliary.delete(work); });
  }
  function checkedId(): string {
    if (terminal || identityFault) throw null;
    let value: unknown;
    try { value = authApply(migration.generateUuid, migration, []); } catch { return badIdentityValue(); }
    return isCanonicalUuid(value) ? value : badIdentityValue(value);
  }
  const urlAccess: CallbackUrlAccess = Object.freeze({
    readCurrentUrl() {
      if (teamLinkOptions) return null;
      if (terminal || identityFault) throw null;
      let value: unknown;
      try { value = authApply(readUrl!, urlPort, []); } catch { return badIdentityValue(); }
      if (value === null) return null;
      if (typeof value !== "string") return badIdentityValue(value);
      try { new URL(value); } catch { return badIdentityValue(); }
      if (terminal || identityFault) throw null;
      return value;
    },
    replaceCurrentUrl(value: string) {
      if (teamLinkOptions) return;
      if (terminal || identityFault) throw null;
      let result: unknown;
      try { result = authApply(replaceUrl!, urlPort, [value]); } catch { return badIdentityValue(); }
      if (result !== undefined) return badIdentityValue(result);
      if (terminal || identityFault) throw null;
    },
  });
  function commandRecord(value: unknown): Record<string, unknown> | null {
    if (malformedPromiseArgument(value)) return null;
    if (!value || typeof value !== "object" || Array.isArray(value)) { malformedArgument(value); return null; }
    return value as Record<string, unknown>;
  }
  function commandField(value: Record<string, unknown>, fieldName: string): unknown {
    const c = active;
    if (!c || !canSend(c)) return undefined;
    try {
      const result = value[fieldName];
      if (malformedPromiseArgument(result)) return undefined;
      return result;
    } catch { malformedArgument(undefined); return undefined; }
  }
  function captureOnboarding(inputValue: CompleteOnboardingInput): CompleteOnboardingInput | null {
    const record = commandRecord(inputValue);
    if (!record) return null;
    const displayName = commandField(record, "displayName");
    if (typeof displayName !== "string" || !displayName.trim() || displayName.trim().length > 80) { malformedArgument(displayName); return null; }
    const rows: Record<string, string>[] = [];
    for (const [fieldName, expectedKind] of [["terms", "terms_of_service"], ["privacy", "privacy_notice"]] as const) {
      const document = commandRecord(commandField(record, fieldName));
      if (!document) return null;
      const row: Record<string, string> = {};
      for (const [name, target] of [["id", "id"], ["kind", "kind"], ["versionLabel", "version_label"], ["href", "document_url"], ["effectiveAt", "effective_at"]]) {
        const value = commandField(document, name);
        if (typeof value !== "string") { malformedArgument(value); return null; }
        row[target] = value;
      }
      if (row.kind !== expectedKind) return null;
      rows.push(row);
    }
    const parsed = parseLegalDocumentsResponse(rows, checkedClock());
    return parsed.ok && parsed.snapshot.terms && parsed.snapshot.privacy
      ? { displayName, terms: parsed.snapshot.terms, privacy: parsed.snapshot.privacy } : null;
  }
  async function restoreSelf(c: Command, expectedAccount: string | null, observe: (value: SessionRestoreOutcome) => void, bindAccount?: (account: string) => boolean): Promise<boolean> {
    if (!expectedAccount && !bindAccount) return false;
    let restored: SessionRestoreOutcome = initDenial?.intent === intent ? { kind: "invalid_session" } : await mechanics!.restoreSession();
    if (restored.kind !== "authenticated" && denied(c)) restored = { kind: "invalid_session" };
    if (!commandCurrent(c)) return false;
    if (restored.kind !== "authenticated" || (expectedAccount !== null && restored.identity.accountScopeId !== expectedAccount)) {
      if (restored.kind === "invalid_session" || (restored.kind === "no_session" && storageHealthy()) || restored.kind === "authenticated") { vetoTraining(c); observe(restored); }
      return false;
    }
    if (!canSend(c)) return false;
    if (expectedAccount === null) {
      if (!bindAccount!(restored.identity.accountScopeId) || !canSend(c)) return false;
      c.expectedAccount = restored.identity.accountScopeId;
    }
    const result = commandRecord(c.sessionResult);
    const data = result && commandRecord(commandField(result, "data"));
    const sessionValue = data && commandRecord(commandField(data, "session"));
    const bearer = sessionValue && commandField(sessionValue, "access_token");
    if (typeof bearer !== "string" || !bearer) { malformedArgument(bearer); return false; }
    if (!canSend(c)) return false;
    c.bearer = bearer;
    return true;
  }
  function nativeIdentity(current: () => boolean, expectedAccount: string | null, expectedProfile: string | null, observe: (value: SessionRestoreOutcome) => void): IdentityService {
    const failed = <T,>() => identityFailed<T>("network_error");
    function run<T>(rpc: string, operation: () => Promise<import("../identity/errors").IdentityResult<T>>, prepare: () => boolean = () => true) {
      return enqueue("restore", async () => {
        const c = active!;
        if (!prepare() || !canSend(c)) return failed<T>();
        if (rpc !== "get_current_legal_documents") {
          if (!expectedAccount || !await restoreSelf(c, expectedAccount, observe)) return failed<T>();
        }
        c.rpcBody = rpc === "complete_personal_onboarding" ? c.rpcBody : "{}";
        c.dataStage = "rpc";
        const result = await operation();
        if (result.ok && rpc === "complete_personal_onboarding" && expectedProfile !== null &&
          (result.value as { profileId?: unknown }).profileId !== expectedProfile) return identityFailed<T>("invalid_response");
        return result;
      }, failed<T>, undefined, { current, data: true, rpc, expectedAccount });
    }
    return Object.freeze({
      getLegalSnapshot: () => run("get_current_legal_documents", () => identityMapper!.getLegalSnapshot()),
      ensureProfile: () => run("ensure_my_profile", () => identityMapper!.ensureProfile()),
      resolveGateFacts: () => run("get_my_gate_state", () => identityMapper!.resolveGateFacts()),
      completeOnboarding(inputValue: CompleteOnboardingInput) {
        let captured: CompleteOnboardingInput | null = null;
        return run("complete_personal_onboarding", () => identityMapper!.completeOnboarding(captured!), () => {
          captured = captureOnboarding(inputValue);
          if (!captured) return false;
          active!.rpcBody = JSON.stringify({ p_display_name: captured.displayName, p_terms_document_id: captured.terms.id, p_privacy_document_id: captured.privacy.id });
          return true;
        });
      },
    });
  }
  function frozenResult<T>(value: T, vetoReady = false): T {
    if (!value || typeof value !== "object") return value;
    const original = value as Record<string, unknown>;
    if (vetoReady && (original.kind === "ready_online" || original.kind === "ready_offline")) return Object.freeze({ kind: "identity_unconfirmed" }) as T;
    if (Array.isArray(value)) return Object.freeze(value.map(item => frozenResult(item, vetoReady))) as T;
    const result: Record<string, unknown> = {};
    for (const [name, child] of Object.entries(original)) result[name] = frozenResult(child, vetoReady);
    return Object.freeze(result) as T;
  }
  function terminalIdentity(): TransitionIdentity {
    if (!terminalTransition) terminalTransition = closeCoordinator!();
    return terminalTransition;
  }
  function containsDenial(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    return record.denial === "server_identity_invalidated" || record.denial === "durable_denial_unavailable" ||
      containsDenial(record.finalization) || containsDenial(record.invalidation);
  }
  function trackRuntime<T>(operation: () => Promise<T>, fallback: () => T, publicationCurrent: (() => boolean) | null = null): Promise<T> {
    if (terminal || identityFault) return Promise.resolve(frozenResult(fallback()));
    let issued: Promise<T>;
    try { issued = operation(); } catch { identityFault = true; retireSportingApplicationIfUnavailable(); return Promise.resolve(frozenResult(fallback())); }
    retireSportingApplicationIfUnavailable();
    const pending = observeDependency(issued).then(value => {
      if ((terminal || identityFault) && !containsDenial(value)) return frozenResult(fallback());
      return frozenResult(value as T, !identityAvailable() || (publicationCurrent !== null && !publicationCurrent()));
    }, () => { identityFault = true; retireSportingApplicationIfUnavailable(); return frozenResult(fallback()); });
    runtimeWork.add(pending);
    void pending.then(() => { runtimeWork.delete(pending); }, () => { runtimeWork.delete(pending); });
    return pending;
  }
  function subscribe<T extends (...args: never[]) => unknown>(set: Set<T>, listener: T): () => void {
    if (terminal || identityFault) return () => {};
    if (typeof listener !== "function") { identityFault = true; retainAuxiliary(listener); return () => {}; }
    set.add(listener); return () => { set.delete(listener); };
  }
  function deliver<T extends (...args: never[]) => unknown>(set: Set<T>, args: unknown[]) {
    retireSportingApplicationIfUnavailable();
    for (const listener of [...set]) {
      if (terminal || identityFault) break;
      try { const result = authApply(listener, undefined, args); if (result !== undefined) retainAuxiliary(result); } catch { /* no presentation reason escapes */ }
    }
  }
  function deliverPendingIntentChange(): void { deliverOwnedCompletion(pendingIntentListeners); }
  function deliverOwnedCompletion(set: Set<() => void>): void {
    retireSportingApplicationIfUnavailable();
    for (const listener of [...set]) {
      if (terminal || identityFault) break;
      if (!set.has(listener)) continue;
      try {
        const returned = authApply(listener, undefined, []);
        // This channel needs only completion, never a raw fulfillment value.
        // Boxed observation also owns masked native children from async wrappers.
        // The exact genuine disposal is already owned and cannot await itself.
        if (returned !== undefined && (disposal === null || returned !== disposal)) {
          const work = drainObservedPlatformWork(returned, candidate => disposal !== null && candidate === disposal);
          auxiliary.add(work);
          void work.then(() => { auxiliary.delete(work); }, () => { auxiliary.delete(work); });
        }
      } catch { /* advisory listener failure cannot change capture truth */ }
    }
  }
  type IntentView = Readonly<{ kind: "known"; intent: NativePendingIntentReplay["intent"] } | { kind: "unavailable" }>;
  function observePublishedPendingIntent(): Promise<IntentView> {
    let original: NativePendingIntentReplay | null = null;
    const work = trackRuntime<IntentView>(async () => {
      if (!identityAvailable() || !observeIntentReplay) return { kind: "unavailable" };
      original = await observeIntentReplay();
      return original?.current() && identityAvailable() ? { kind: "known", intent: original.intent } : { kind: "unavailable" };
    }, () => ({ kind: "unavailable" })).then(view => {
      // trackRuntime copies results. Membership must bind the FINAL public data,
      // and the original must still be current after that copy has finished.
      const replay = original;
      if (view.kind !== "known" || !replay?.current() || !identityAvailable()) return Object.freeze({ kind: "unavailable" as const });
      if (view.intent === null) return Object.freeze({ kind: "known" as const, intent: null });
      let intentView = intentReplayViews.get(replay);
      if (!intentView) { intentView = view.intent; intentReplayViews.set(replay, intentView); intentReplayReceipts.set(intentView, replay); }
      return Object.freeze({ kind: "known" as const, intent: intentView });
    });
    runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); });
    return work;
  }
  function pendingReplayFor(value: unknown): NativePendingIntentReplay | null {
    // No reflection/then/getter on a non-member, even a Proxy or Promise.
    return value !== null && typeof value === "object" && identityAvailable() ? intentReplayReceipts.get(value) ?? null : null;
  }
  function discardPublishedPendingIntent(value: unknown): Promise<boolean> {
    const replay = pendingReplayFor(value);
    if (!replay?.current()) return Promise.resolve(false);
    // Factual removal has its own bounded ownership. General trackRuntime would
    // replace an actual ACK after close; self-revision rotation is also expected.
    const work = replay.discard().then(result => result.kind === "applied" || result.kind === "not_required", () => false);
    runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); });
    return work;
  }
  type SportingCapture = { valid: boolean; cancelled: boolean; record: Readonly<Record<string, unknown>>; body: string; drain: Promise<void> };
  function captureSporting(cell: NativeProfileAdmission, inputValue: unknown, kind: "restore" | "put" | "delete"): SportingCapture {
    let valid = true, cancelled = false;
    function current(): boolean {
      if (!sportingAvailable(cell)) cancelled = true;
      return !cancelled;
    }
    const pending: Promise<unknown>[] = [], copied: Record<string, unknown> = {};
    function bad(value?: unknown): void {
      valid = false;
      if ((typeof value === "object" && value !== null) || typeof value === "function") pending.push(observeDependency(value).then(() => {}, () => {}));
    }
    function nativePromise(value: unknown): boolean {
      if (disposal !== null && value === disposal) { valid = false; return true; }
      let finish!: () => void;
      const owned = new Promise<void>(resolve => { finish = resolve; });
      try { authApply(authThen, value, [finish, finish]); } catch { return false; }
      valid = false; pending.push(owned); return true;
    }
    function read(record: Record<string, unknown>, key: string): unknown {
      if (!valid || !current()) return undefined;
      try {
        const value = record[key];
        // The getter may revoke this exact admission. Own its actual returned
        // work before stopping, but never invoke a subsequent input getter.
        const promise = nativePromise(value);
        if (!current()) { if (!promise) bad(value); return undefined; }
        return promise ? undefined : value;
      } catch { current(); bad(); return undefined; }
    }
    let body = "{}";
    try {
      if (current() && kind !== "restore") {
        if (!nativePromise(inputValue)) {
          if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) bad(inputValue);
          else {
            const record = inputValue as Record<string, unknown>;
            const fields = kind === "put" ? ["recordKind", "recordId", "schemaVersion", "payload", "recordedAt"] : ["recordKind", "recordId", "contentSha256"];
            for (const key of fields) {
              const value = read(record, key);
              if (!valid || !current()) break;
              const acceptable = key === "recordKind" ? value === "training_session" || value === "assessment_run"
                : key === "recordId" ? isCanonicalUuid(value)
                : key === "schemaVersion" ? typeof value === "number" && Number.isSafeInteger(value) && value >= 1
                : key === "recordedAt" ? isValidTimestamp(value)
                : key === "contentSha256" ? typeof value === "string" && /^[0-9a-f]{64}$/.test(value)
                : typeof value === "string";
              if (!acceptable) { bad(value); break; }
              copied[key] = value;
            }
          }
        }
        if (valid && current()) {
          const args = kind === "put" ? { p_record_kind: copied.recordKind, p_record_id: copied.recordId, p_schema_version: copied.schemaVersion, p_payload: copied.payload, p_recorded_at: copied.recordedAt }
            : { p_record_kind: copied.recordKind, p_record_id: copied.recordId, p_expected_content_sha256: copied.contentSha256 };
          const serialized: unknown = JSON.stringify(args);
          if (typeof serialized !== "string") bad(serialized); else body = serialized;
          current();
        }
      }
    } catch { current(); bad(); }
    current();
    return { valid, cancelled, record: Object.freeze(copied), body, drain: Promise.all(pending).then(() => {}) };
  }
  function sportingAvailable(cell: NativeProfileAdmission): boolean { return identityAvailable() && cell.current(); }
  function retireSportingApplicationIfUnavailable(): void {
    nativeTracker?.owner.recheck();
    if (sportingApplication && !sportingAvailable(sportingApplication.cell)) sportingApplication.binding.retire();
  }
  function notifyInvalidation(outcome: InvalidationOutcome): void {
    retireSportingApplicationIfUnavailable();
    const observation = frozenResult(outcome);
    for (const listener of [...invalidationListeners]) {
      if (terminal) break;
      try { const returned = authApply(listener, undefined, [observation]); if (returned !== undefined) retainAuxiliary(returned); } catch { /* no listener reason escapes */ }
    }
  }
  async function admittedSelf(c: Command, cell: NativeProfileAdmission, markNegative: (account: string) => void): Promise<boolean> {
    if (!await restoreSelf(c, cell.accountScopeId, value => {
      markNegative(value.kind === "authenticated" ? value.identity.accountScopeId : cell.accountScopeId);
    })) return false;
    c.dataStage = "rpc"; c.rpc = "get_my_gate_state"; c.rpcBody = "{}";
    const facts = await identityMapper!.resolveGateFacts();
    if (!commandCurrent(c)) return false;
    if (!facts.ok) {
      if (facts.error.kind === "forbidden" || facts.error.kind === "profile_required") { vetoTraining(c); markNegative(cell.accountScopeId); }
      return false;
    }
    const eligibility = deriveGateEligibility(facts.value);
    if (eligibility.kind !== "complete" || eligibility.profileId !== cell.profileId || eligibility.onboardingCompletedAt !== cell.onboardingCompletedAt) {
      vetoTraining(c); markNegative(cell.accountScopeId); return false;
    }
    return canSend(c) && sportingAvailable(cell);
  }
  function runSporting<T>(cell: NativeProfileAdmission, rpc: string, captured: SportingCapture, operation: () => Promise<CloudSportingResult<T>>): Promise<CloudSportingResult<T>> {
    const unavailable = (): CloudSportingResult<T> => ({ ok: false, error: "unavailable" });
    const work = (async (): Promise<CloudSportingResult<T>> => {
      await captured.drain;
      if (captured.cancelled) return unavailable();
      if (!captured.valid) return Object.freeze({ ok: false, error: "invalid_input" });
      if (!sportingAvailable(cell)) return unavailable();
      let negativeAccount: string | null = null;
      const result = await enqueue("restore", async () => {
        const c = active!;
        const markNegative = (account: string) => { if (commandCurrent(c) && cell.current()) negativeAccount = account; };
        if (!await admittedSelf(c, cell, markNegative)) return unavailable();
        c.rpc = rpc; c.rpcBody = captured.body;
        return operation();
      }, unavailable, undefined, { current: cell.current, data: true, rpc: "get_my_gate_state", expectedAccount: cell.accountScopeId });
      // The actual SDK command has ended before the authentic conditional
      // invalidator claims its genuine operation. Never recursively enter FIFO.
      if (negativeAccount !== null) {
        const outcome = await cell.invalidate(negativeAccount);
        if (outcome !== null) notifyInvalidation(outcome);
        return unavailable();
      }
      const normalized = frozenResult(result);
      return sportingAvailable(cell) ? normalized : unavailable();
    })().catch(() => unavailable());
    runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); });
    return work;
  }
  function bindSportingService(profileId: string): CloudSportingService | null {
    if (terminal || !identityAvailable()) return null;
    if (typeof profileId !== "string") { retainAuxiliary(profileId); return null; }
    const cell = profileAdmission;
    if (!isCanonicalUuid(profileId) || !cell || cell.profileId !== profileId || !sportingAvailable(cell)) return null;
    const unavailable = () => Promise.resolve(Object.freeze({ ok: false as const, error: "unavailable" as const }));
    return Object.freeze<CloudSportingService>({
      restore: () => !sportingAvailable(cell) ? unavailable() : runSporting(cell, "get_my_sporting_records", captureSporting(cell, undefined, "restore"), () => sportingMapper!.restore()),
      put(record) {
        if (!sportingAvailable(cell)) return unavailable();
        const captured = captureSporting(cell, record, "put");
        return runSporting(cell, "put_my_sporting_record", captured, () => sportingMapper!.put(captured.record as Omit<CloudSportingRecord, "contentSha256">));
      },
      delete(record) {
        if (!sportingAvailable(cell)) return unavailable();
        const captured = captureSporting(cell, record, "delete");
        return runSporting(cell, "delete_my_sporting_record", captured, () => sportingMapper!.delete(captured.record as Pick<CloudSportingRecord, "recordKind" | "recordId" | "contentSha256">));
      },
    });
  }
  type TeamMethod = keyof TeamExerciseCloudService;
  type TeamCapture = { valid: boolean; cancelled: boolean; args: readonly unknown[]; plan: readonly TeamWireIntent[]; drain: Promise<void> };
  function captureTeam(cell: NativeProfileAdmission, method: TeamMethod, args: readonly unknown[]): TeamCapture {
    let valid = true, cancelled = false;
    const pending: Promise<unknown>[] = [], copied: Record<string, unknown> = {}, capturedArgs: unknown[] = [];
    const current = () => { if (!sportingAvailable(cell)) cancelled = true; return !cancelled; };
    function bad(value?: unknown) {
      valid = false;
      if ((typeof value === "object" && value !== null) || typeof value === "function") pending.push(observeDependency(value).then(() => {}, () => {}));
    }
    function promise(value: unknown): boolean {
      if (disposal !== null && value === disposal) { valid = false; return true; }
      let finish!: () => void;
      const owned = new Promise<void>(resolve => { finish = resolve; });
      try { authApply(authThen, value, [finish, finish]); } catch { return false; }
      valid = false; pending.push(owned); return true;
    }
    function read(record: object, key: string): unknown {
      if (!valid || !current()) return undefined;
      try {
        const value = (record as Record<string, unknown>)[key], asynchronous = promise(value);
        if (!current()) { if (!asynchronous) bad(value); return undefined; }
        return asynchronous ? undefined : value;
      } catch { current(); bad(); return undefined; }
    }
    type Field = readonly [string, "id" | "text" | "date" | "version" | "revision" | "ids" | "fields"];
    const revision: readonly Field[] = [["revisionId", "id"], ["resultId", "id"], ["baseRevisionNumber", "revision"], ["reason", "text"]];
    const fields: Partial<Record<TeamMethod, readonly Field[]>> = {
      putSession: [["sessionId", "id"], ["teamId", "id"], ["schemaVersion", "version"], ["coordinationPayload", "text"], ["startedAt", "date"], ["completedAt", "date"], ["participantProfileIds", "ids"], ["trainingAthleteProfileIds", "ids"], ["executionIds", "ids"]],
      putAthleteBundle: [["bundleId", "id"], ["sessionId", "id"], ["athleteProfileId", "id"], ["schemaVersion", "version"], ["resultPayload", "text"], ["recordedAt", "date"], ["resultIds", "ids"], ["executionIds", "ids"]],
      reviseMyResult: [...revision, ["schemaVersion", "version"], ["resultPayload", "text"], ["changedFields", "fields"]],
      voidMyResult: revision,
    };
    let plan: TeamWireIntent[] = [];
    try {
      const declared = fields[method];
      if (current() && declared) {
        const inputValue = args[0];
        if (!promise(inputValue)) {
          if (!inputValue || typeof inputValue !== "object" || Array.isArray(inputValue)) bad(inputValue);
          else for (const [key, kind] of declared) {
            let value = read(inputValue, key);
            if (!valid || !current()) break;
            if (kind === "ids" || kind === "fields") {
              if (!Array.isArray(value)) { bad(value); break; }
              const length = read(value, "length");
              if (!valid || !current()) break;
              if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) { bad(length); break; }
              const array: string[] = [];
              for (let index = 0; index < length; index++) {
                if (!valid || !current()) break;
                const present = authApply(authHasOwn, value, [String(index)]);
                if (!current()) break;
                if (present !== true) { bad(); break; }
                const element = read(value, String(index));
                if (!valid || !current()) break;
                if (kind === "ids" ? !isCanonicalUuid(element) : !["actualHandle", "evaluation", "measurements", "teamRoleContextOverride"].includes(element as string)) { bad(element); break; }
                array.push(element as string);
              }
              if (!valid || !current()) break;
              value = Object.freeze(array);
            } else {
              const acceptable = kind === "id" ? isCanonicalUuid(value) : kind === "text" ? typeof value === "string"
                : kind === "date" ? isValidTimestamp(value) : typeof value === "number" && Number.isSafeInteger(value) && value >= (kind === "version" ? 1 : 0);
              if (!acceptable) { bad(value); break; }
            }
            if (!current()) break;
            copied[key] = value;
          }
          if (valid && current()) capturedArgs.push(Object.freeze(copied));
        }
      } else if (current() && method !== "listMyResults") {
        for (let index = 0; index < args.length; index++) {
          if (!valid || !current()) break;
          const value = args[index], asynchronous = promise(value);
          if (!current()) { if (!asynchronous) bad(value); break; }
          if (!valid) break;
          const acceptable = index === 0 ? isCanonicalUuid(value) : method === "setRecordingPermission" ? typeof value === "boolean" : value === null || typeof value === "string";
          if (!acceptable) { bad(value); break; }
          capturedArgs.push(value);
        }
      }
      if (valid && current()) {
        const base = new URL("rest/v1/", new URL(config.url.endsWith("/") ? config.url : config.url + "/"));
        const get = (relation: string, select: string, extra: readonly (readonly [string, string])[] = []) => {
          const url = new URL(relation, base); url.searchParams.set("select", select);
          for (const [key, value] of extra) url.searchParams.set(key, value);
          return Object.freeze<TeamWireIntent>({ url: url.href, method: "GET", body: "" });
        };
        if (method === "listMyResults") plan = [
          get("team_exercise_result_bundles", "id,session_id,athlete_profile_id,recorded_by_profile_id,schema_version,result_payload,content_sha256,recorded_at,created_at", [["order", "recorded_at.desc"]]),
          get("team_exercise_sessions", "id,team_id,recorded_by_profile_id,schema_version,coordination_payload,content_sha256,started_at,completed_at,created_at"),
          get("team_exercise_session_participants", "session_id,profile_id,participation"),
          get("team_exercise_execution_refs", "session_id,execution_id"),
          get("team_exercise_result_refs", "bundle_id,result_id,athlete_profile_id,execution_id"),
          get("team_exercise_private_notes", "result_id,athlete_profile_id,note,updated_at"),
          get("team_exercise_result_revisions", "id,result_id,athlete_profile_id,revision_number,kind,schema_version,result_payload,content_sha256,changed_fields,reason,actor_profile_id,created_at", [["order", "revision_number.asc"]]),
        ];
        else if (method === "listActiveRecordingPermissions") plan = [get("team_exercise_recording_permissions", "athlete_profile_id,granted_at", [["team_id", `eq.${capturedArgs[0]}`], ["revoked_at", "is.null"]])];
        else {
          let rpc: string, parameters: Record<string, unknown>;
          switch (method) {
            case "putSession": rpc = "put_team_exercise_session"; parameters = { p_session_id: copied.sessionId, p_team_id: copied.teamId, p_schema_version: copied.schemaVersion, p_coordination_payload: copied.coordinationPayload, p_started_at: copied.startedAt, p_completed_at: copied.completedAt, p_participant_profile_ids: copied.participantProfileIds, p_training_athlete_profile_ids: copied.trainingAthleteProfileIds, p_execution_ids: copied.executionIds }; break;
            case "putAthleteBundle": rpc = "put_team_exercise_result_bundle"; parameters = { p_bundle_id: copied.bundleId, p_session_id: copied.sessionId, p_athlete_profile_id: copied.athleteProfileId, p_schema_version: copied.schemaVersion, p_result_payload: copied.resultPayload, p_recorded_at: copied.recordedAt, p_result_ids: copied.resultIds, p_execution_ids: copied.executionIds }; break;
            case "setRecordingPermission": rpc = "set_my_team_exercise_recording_permission"; parameters = { p_team_id: capturedArgs[0], p_granted: capturedArgs[1] }; break;
            case "approveSession": rpc = "approve_my_team_exercise_session"; parameters = { p_session_id: capturedArgs[0] }; break;
            case "setPrivateNote": rpc = "set_my_team_exercise_private_note"; parameters = { p_result_id: capturedArgs[0], p_note: capturedArgs[1] }; break;
            case "reviseMyResult": rpc = "revise_my_team_exercise_result"; parameters = { p_revision_id: copied.revisionId, p_result_id: copied.resultId, p_base_revision_number: copied.baseRevisionNumber, p_schema_version: copied.schemaVersion, p_result_payload: copied.resultPayload, p_reason: copied.reason, p_changed_fields: copied.changedFields }; break;
            case "voidMyResult": rpc = "void_my_team_exercise_result"; parameters = { p_revision_id: copied.revisionId, p_result_id: copied.resultId, p_base_revision_number: copied.baseRevisionNumber, p_reason: copied.reason }; break;
          }
          const body: unknown = JSON.stringify(parameters);
          if (typeof body !== "string") bad(body);
          else plan = [Object.freeze({ url: new URL(`rpc/${rpc}`, base).href, method: "POST", body })];
        }
        current();
      }
    } catch { current(); bad(); }
    current();
    return { valid, cancelled, args: Object.freeze(capturedArgs), plan: Object.freeze(plan), drain: Promise.all(pending).then(() => {}) };
  }
  function commandDataTransport(c: Command, claim: (url: string, method: string) => TeamWireIntent | null, complete: (wire: TeamWireIntent) => void = () => {}) {
    let sealed = false;
    const issued = new Set<Promise<Response>>();
    const fetch: typeof globalThis.fetch = (inputValue, init) => {
      let resolve!: (value: Response | PromiseLike<Response>) => void, reject!: (reason: unknown) => void;
      const pending = new Promise<Response>((yes, no) => { resolve = yes; reject = no; });
      issued.add(pending); void pending.then(() => {}, () => {});
      void (async () => {
        if (sealed || !canSend(c)) throw closedError();
        const methodValue: unknown = init?.method;
        if (typeof methodValue !== "string") { malformedFor(c, methodValue); throw closedError(); }
        if (typeof inputValue !== "string") { malformedFor(c, inputValue); throw closedError(); }
        const wire = claim(inputValue, methodValue);
        if (!wire || sealed || !canSend(c)) throw closedError();
        const response = await ownedFetchFor(c, inputValue, init, wire);
        complete(wire);
        return response;
      })().then(resolve, reject);
      return pending;
    };
    return { fetch, async sealAndDrain() { sealed = true; await Promise.allSettled(issued); } };
  }
  function runTeam<K extends TeamMethod>(cell: NativeProfileAdmission, method: K, capture: TeamCapture): ReturnType<TeamExerciseCloudService[K]> {
    const unavailable = (): TeamExerciseCloudResult<unknown> => ({ ok: false, error: "unavailable" });
    const work = (async (): Promise<TeamExerciseCloudResult<unknown>> => {
      await capture.drain;
      if (capture.cancelled) return unavailable();
      if (!capture.valid) return Object.freeze({ ok: false, error: "invalid_input" });
      if (!sportingAvailable(cell)) return unavailable();
      let negativeAccount: string | null = null;
      const result = await enqueue("restore", async () => {
        const c = active!;
        if (!await admittedSelf(c, cell, account => { if (commandCurrent(c) && cell.current()) negativeAccount = account; })) return unavailable();
        c.rpc = null; c.rpcBody = null;
        const used = new Set<TeamWireIntent>();
        const transport = commandDataTransport(c, (url, method) => {
          const wire = capture.plan.find(candidate => candidate.url === url && candidate.method === method && !used.has(candidate));
          if (wire) used.add(wire);
          return wire ?? null;
        });
        try {
          const client = new PostgrestClient(new URL("rest/v1", new URL(config.url.endsWith("/") ? config.url : config.url + "/")).href,
            { schema: "public", headers: { apikey: config.publishableKey }, retry: false, fetch: transport.fetch });
          if (!canSend(c) || !sportingAvailable(cell)) return unavailable();
          const mapper = createSupabaseTeamExerciseCloudService(client);
          if (!canSend(c) || !sportingAvailable(cell)) return unavailable();
          return await observeDependency(authApply(mapper[method], mapper, capture.args as unknown[])) as TeamExerciseCloudResult<unknown>;
        } finally {
          await transport.sealAndDrain();
        }
      }, unavailable, undefined, { current: cell.current, data: true, rpc: "get_my_gate_state", expectedAccount: cell.accountScopeId });
      if (negativeAccount !== null) {
        const outcome = await cell.invalidate(negativeAccount);
        if (outcome !== null) notifyInvalidation(outcome);
        return unavailable();
      }
      return sportingAvailable(cell) ? frozenResult(result) : unavailable();
    })().catch(unavailable);
    runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); });
    return work as ReturnType<TeamExerciseCloudService[K]>;
  }
  function bindLocalSportingScope(profileId: string): NativeLocalSportingScope | null {
    if (terminal || !identityAvailable()) return null;
    if (typeof profileId !== "string") { retainAuxiliary(profileId); return null; }
    const cell = profileAdmission;
    if (!isCanonicalUuid(profileId) || !cell || cell.profileId !== profileId || !sportingAvailable(cell) || !pair) return null;
    return createNativeLocalSportingScope({ profileId, adapter: pair.domain,
      current: () => sportingAvailable(cell),
      register(work) { runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); }); },
      isOwnDisposal: value => disposal !== null && value === disposal,
    });
  }
  function bindSportingApplicationScope(profileId: string): NativeSportingApplicationScope | null {
    if (terminal || !identityAvailable()) return null;
    if (typeof profileId !== "string") { retainAuxiliary(profileId); return null; }
    const cell = profileAdmission;
    if (!isCanonicalUuid(profileId) || !cell || cell.profileId !== profileId || !sportingAvailable(cell) || !pair) return null;
    if (sportingApplication?.cell === cell) return sportingApplication.binding.scope;
    sportingApplication?.binding.retire();
    const service = bindSportingService(profileId), teamService = bindTeamExerciseService(profileId);
    if (!service || !teamService) return null;
    const binding = createNativeSportingApplicationScope({ profileId, adapter: pair.domain,
      current: () => sportingAvailable(cell),
      register(work) { runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); }); },
      isOwnDisposal: value => disposal !== null && value === disposal,
    }, service, teamService);
    sportingApplication = { cell, binding };
    return binding.scope;
  }
  function bindTracker(profileId: string): NativeTrackerBinding | null {
    const cell = profileAdmission;
    if (!cell || !sportingAvailable(cell) || cell.profileId !== profileId || !pair) return null;
    if (nativeTracker?.cell === cell) return nativeTracker.binding;
    const application = bindSportingApplicationScope(profileId);
    if (!application || !sportingApplication || sportingApplication.cell !== cell) return null;
    nativeTracker?.owner.retire();
    const trackerOwner = createNativeTrackerOwner({ profileId, identityGeneration: cell.identityGeneration, newId: checkedId,
      adapter: pair.domain, normalSession: sportingApplication.binding.trackerSession, hasTeamDraft: sportingApplication.binding.hasTeamDraft,
      current: () => { const health = pair!.health(); return !terminal && !identityFault && !sdkFailed && !cleanupUnconfirmed && profileAdmission === cell && cell.current() && health.lifecycle === "active" && health.protocol === "healthy" && health.domain === "healthy"; },
      normalCurrent: () => sportingAvailable(cell),
      register(work) { runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); }); },
      isOwnDisposal: value => disposal !== null && value === disposal,
    });
    const binding: NativeTrackerBinding = Object.freeze({ profileId, application, tracker: trackerOwner.port, team: bindFoundationService(profileId) });
    nativeTracker = { cell, owner: trackerOwner, binding }; return binding;
  }
  function bindTeamExerciseService(profileId: string): TeamExerciseCloudService | null {
    if (terminal || !identityAvailable()) return null;
    if (typeof profileId !== "string") { retainAuxiliary(profileId); return null; }
    const cell = profileAdmission;
    if (!isCanonicalUuid(profileId) || !cell || cell.profileId !== profileId || !sportingAvailable(cell)) return null;
    const invoke = <K extends TeamMethod>(method: K, args: readonly unknown[]): ReturnType<TeamExerciseCloudService[K]> => {
      if (!sportingAvailable(cell)) return Promise.resolve(Object.freeze({ ok: false, error: "unavailable" })) as ReturnType<TeamExerciseCloudService[K]>;
      return runTeam(cell, method, captureTeam(cell, method, args));
    };
    return Object.freeze<TeamExerciseCloudService>({
      listMyResults: () => invoke("listMyResults", []),
      listActiveRecordingPermissions: id => invoke("listActiveRecordingPermissions", [id]),
      putSession: record => invoke("putSession", [record]),
      putAthleteBundle: record => invoke("putAthleteBundle", [record]),
      setRecordingPermission: (id, granted) => invoke("setRecordingPermission", [id, granted]),
      approveSession: id => invoke("approveSession", [id]),
      setPrivateNote: (id, note) => invoke("setPrivateNote", [id, note]),
      reviseMyResult: record => invoke("reviseMyResult", [record]),
      voidMyResult: record => invoke("voidMyResult", [record]),
    });
  }

  type FoundationMethod = keyof TeamService;
  type FoundationCapture = { valid: boolean; cancelled: boolean; args: readonly unknown[]; rpc: string | null; body: string; route: string | null; api: boolean; drain: Promise<void> };
  function captureFoundation(cell: NativeProfileAdmission, method: FoundationMethod, args: readonly unknown[]): FoundationCapture {
    let valid = true, cancelled = false;
    const pending: Promise<unknown>[] = [], copied: unknown[] = [];
    const current = () => { if (!sportingAvailable(cell)) cancelled = true; return !cancelled; };
    function bad(value?: unknown) { valid = false; if ((typeof value === "object" && value !== null) || typeof value === "function") pending.push(observeDependency(value).then(() => {}, () => {})); }
    function nativePromise(value: unknown) {
      if (disposal !== null && value === disposal) { valid = false; return true; }
      let finish!: () => void; const work = new Promise<void>(resolve => { finish = resolve; });
      try { authApply(authThen, value, [finish, finish]); } catch { return false; }
      valid = false; pending.push(work); return true;
    }
    function read(record: object, key: string): unknown {
      if (!valid || !current()) return undefined;
      try { const value = (record as Record<string, unknown>)[key]; if (!current()) { bad(value); return undefined; } return value; }
      catch { current(); bad(); return undefined; }
    }
    type Kind = "id" | "text" | "bool" | "direct" | "directs" | "functions" | "create" | "proposal";
    const spec: Record<FoundationMethod, readonly Kind[]> = {
      getMyProfile: [], hasPilotTeamCreationCapability: [], listMyTeams: [], createTeam: ["create"], getTeamWorkspace: ["id"], renameTeam: ["id", "text"], archiveTeam: ["id"], restoreTeam: ["id"],
      setParticipation: ["id", "id", "bool"], assignDirectFunction: ["id", "id", "direct"], removeDirectFunction: ["id", "id", "direct"], removeAdminFunction: ["id", "id"], relinquishOwnAdmin: ["id"], removeMember: ["id", "id"], leaveTeam: ["id"],
      listInvitations: ["id"], createInvitation: ["id", "proposal"], reviseInvitation: ["id", "proposal"], resendInvitation: ["id"], revokeInvitation: ["id"], previewInvitation: ["text"], acceptInvitation: ["text"],
      listAdminRequestsForMe: [], listAdminRequestsForTeam: ["id"], createAdminRequest: ["id", "id"], revokeAdminRequest: ["id"], acceptAdminRequest: ["id"], listNotifications: [], acknowledgeNotification: ["id"],
    };
    function capture(value: unknown, kind: Kind): unknown {
      if (!valid || !current()) return undefined;
      if (kind === "create" || kind === "proposal") {
        if (nativePromise(value)) return undefined;
        if (!value || typeof value !== "object" || Array.isArray(value)) { bad(value); return undefined; }
        const record: Record<string, unknown> = {};
        const fields: readonly (readonly [string, Kind])[] = kind === "create" ? [["name", "text"], ["participationAsPlayer", "bool"], ["functions", "directs"]]
          : [["email", "text"], ["participationAsPlayer", "bool"], ["proposedFunctions", "functions"]];
        for (const [key, fieldKind] of fields) {
          const field = read(value, key); if (!valid || !current()) break;
          record[key] = capture(field, fieldKind); if (!valid || !current()) break;
        }
        return Object.freeze(record);
      }
      if (kind === "directs" || kind === "functions") {
        if (!Array.isArray(value)) { bad(value); return undefined; }
        const length = read(value, "length"); if (!valid || !current()) return undefined;
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) { bad(length); return undefined; }
        const array: string[] = [];
        for (let index = 0; index < length; index++) {
          if (!valid || !current()) break;
          const present = authApply(authHasOwn, value, [String(index)]); if (!current()) break;
          if (present !== true) { bad(); break; }
          const item = read(value, String(index)); if (!valid || !current()) break;
          if (item !== "coach" && item !== "training_lead" && !(kind === "functions" && item === "team_admin")) { bad(item); break; }
          array.push(item);
        }
        return Object.freeze(array);
      }
      const acceptable = kind === "id" ? isCanonicalUuid(value) : kind === "text" ? typeof value === "string" : kind === "bool" ? typeof value === "boolean" : value === "coach" || value === "training_lead";
      if (!acceptable) { bad(value); return undefined; }
      return value;
    }
    let rpc: string | null = null, body = "{}", route: string | null = null;
    const api = ["createInvitation", "reviseInvitation", "resendInvitation", "createAdminRequest", "removeMember"].includes(method);
    try {
      for (let index = 0; index < spec[method].length; index++) { if (!valid || !current()) break; copied.push(capture(args[index], spec[method][index])); }
      if (valid && current()) {
        const a = copied[0], b = copied[1], d = copied[2], record = (api ? b : a) as Record<string, unknown>;
        let parameters: Record<string, unknown> = {};
        switch (method) {
          case "getMyProfile": case "listMyTeams": rpc = "get_my_profile"; break;
          case "hasPilotTeamCreationCapability": rpc = "has_pilot_team_creation_capability"; break;
          case "createTeam": rpc = "create_team"; parameters = { p_name: record.name, p_participation_as_player: record.participationAsPlayer, p_functions: record.functions }; break;
          case "renameTeam": rpc = "rename_team"; parameters = { p_team_id: a, p_name: b }; break;
          case "archiveTeam": rpc = "archive_team"; parameters = { p_team_id: a }; break;
          case "restoreTeam": rpc = "restore_team"; parameters = { p_team_id: a }; break;
          case "setParticipation": rpc = "set_participation"; parameters = { p_team_id: a, p_membership_id: b, p_participation_as_player: d }; break;
          case "assignDirectFunction": rpc = "assign_direct_function"; parameters = { p_team_id: a, p_membership_id: b, p_function: d }; break;
          case "removeDirectFunction": rpc = "remove_direct_function"; parameters = { p_team_id: a, p_membership_id: b, p_function: d }; break;
          case "removeAdminFunction": rpc = "remove_admin_function"; parameters = { p_team_id: a, p_membership_id: b }; break;
          case "relinquishOwnAdmin": rpc = "relinquish_own_admin"; parameters = { p_team_id: a }; break;
          case "leaveTeam": rpc = "leave_team"; parameters = { p_team_id: a }; break;
          case "revokeInvitation": rpc = "revoke_invitation"; parameters = { p_invitation_id: a }; break;
          case "previewInvitation": rpc = "preview_invitation"; parameters = { p_raw_token: a }; break;
          case "acceptInvitation": rpc = "accept_invitation"; parameters = { p_raw_token: a }; break;
          case "listAdminRequestsForTeam": rpc = "list_admin_requests_for_team"; parameters = { p_team_id: a }; break;
          case "revokeAdminRequest": rpc = "revoke_admin_request"; parameters = { p_request_id: a }; break;
          case "acceptAdminRequest": rpc = "accept_admin_request"; parameters = { p_request_id: a }; break;
          case "acknowledgeNotification": rpc = "acknowledge_notification"; parameters = { p_notification_id: a }; break;
          case "createInvitation": route = resolveTeamApiRoutePath({ kind: "createInvitation" }); parameters = { teamId: a, email: record.email, participationAsPlayer: record.participationAsPlayer, proposedFunctions: record.proposedFunctions }; break;
          case "reviseInvitation": route = resolveTeamApiRoutePath({ kind: "reviseInvitation", invitationId: a as string }); parameters = { email: record.email, participationAsPlayer: record.participationAsPlayer, proposedFunctions: record.proposedFunctions }; break;
          case "resendInvitation": route = resolveTeamApiRoutePath({ kind: "resendInvitation", invitationId: a as string }); break;
          case "createAdminRequest": route = resolveTeamApiRoutePath({ kind: "createAdminRequest" }); parameters = { teamId: a, membershipId: b }; break;
          case "removeMember": route = resolveTeamApiRoutePath({ kind: "removeMember" }); parameters = { teamId: a, membershipId: b }; break;
        }
        const serialized: unknown = JSON.stringify(parameters); if (typeof serialized !== "string") bad(serialized); else body = serialized;
        if (api && route === null) bad(); current();
      }
    } catch { current(); bad(); }
    current();
    return { valid, cancelled, args: Object.freeze(copied), rpc, body, route, api, drain: Promise.all(pending).then(() => {}) };
  }
  function runFoundation<K extends FoundationMethod>(cell: NativeProfileAdmission, method: K, captured: FoundationCapture): ReturnType<TeamService[K]> {
    const unavailable = (): TeamResult<unknown> => teamFailed("forbidden", "You must be signed in.");
    const unexpected = (): TeamResult<unknown> => teamFailed("unexpected_error", "Something went wrong. Please try again.");
    const work = (async (): Promise<TeamResult<unknown>> => {
      await captured.drain;
      if (captured.cancelled) return unavailable();
      if (!captured.valid) return teamFailed("invalid_input", "The supplied Team input is invalid.");
      if (!sportingAvailable(cell) || (captured.api && nativeApiOrigin.status !== "configured")) return unavailable();
      let negativeAccount: string | null = null;
      const result = await enqueue("restore", async () => {
        const c = active!;
        if (!await admittedSelf(c, cell, account => { if (commandCurrent(c) && cell.current()) negativeAccount = account; })) return unavailable();
        c.rpc = null; c.rpcBody = null;
        let retired = false, profileObserved = false, createdObserved = false, rosterObserved = false;
        let selectedTeam = method === "getTeamWorkspace" ? captured.args[0] as string : null;
        type Intent = { wire: TeamWireIntent; tag: string; before: readonly string[]; state: "unused" | "issued" | "completed" };
        const intents: Intent[] = [];
        const current = () => !retired && canSend(c) && sportingAvailable(cell);
        function refuse(value?: unknown): never { retired = true; malformedFor(c, value); throw closedError(); }
        const done = (tag: string) => intents.some(item => item.tag === tag && item.state === "completed");
        const idle = () => !intents.some(item => item.state === "issued");
        const base = new URL("rest/v1/", new URL(config.url.endsWith("/") ? config.url : config.url + "/"));
        function add(tag: string, wire: TeamWireIntent, before: readonly string[] = []) {
          if (!current() || intents.some(item => item.tag === tag)) refuse();
          intents.push({ tag, wire: Object.freeze(wire), before: Object.freeze([...before]), state: "unused" });
        }
        const rpcWire = (rpc: string, body = "{}"): TeamWireIntent => Object.freeze({ url: new URL(`rpc/${rpc}`, base).href, method: "POST", body });
        function getWire(relation: string, select: string, filters: readonly (readonly [string, string])[] = []): TeamWireIntent {
          const url = new URL(relation, base); url.searchParams.set("select", select.replace(/\s/g, ""));
          for (const [key, value] of filters) url.searchParams.set(key, value);
          return Object.freeze({ url: url.href, method: "GET", body: "" });
        }
        function workspace(team: string, before: readonly string[] = []) {
          add("team", getWire("teams", "*", [["id", `eq.${team}`]]), before);
          add("profile", rpcWire("get_my_profile"), ["team"]);
        }
        if (captured.api) {
          if (!captured.route || nativeApiOrigin.status !== "configured") return unavailable();
          add("api", { url: new URL(captured.route, nativeApiOrigin.origin).href, method: "POST", body: captured.body, purpose: "own_api" });
        } else if (method === "getTeamWorkspace") workspace(selectedTeam!);
        else if (method === "listInvitations") add("single", getWire("team_invitations", "id, team_id, email, participation_as_player, proposed_functions, status, created_at, expires_at, accepted_at, revoked_at, replaced_by_invitation_id, email_delivery_status", [["team_id", `eq.${captured.args[0]}`]]));
        else if (method === "listAdminRequestsForMe") {
          add("inbox", getWire("team_admin_requests", "*, teams(name), team_memberships!inner(profile_id)"));
          add("profile", rpcWire("get_my_profile"), ["inbox"]);
        } else if (method === "listNotifications") add("single", getWire("account_notifications", "*", [["read_at", "is.null"], ["order", "created_at.desc"]]));
        else if (captured.rpc) add(method === "createTeam" ? "create" : method === "getMyProfile" || method === "listMyTeams" ? "profile" : "single", rpcWire(captured.rpc, captured.body));
        else return unexpected();
        const transport = commandDataTransport(c, (url, requestMethod) => {
          if (!current()) return null;
          const found = intents.find(item => item.state === "unused" && item.wire.url === url && item.wire.method === requestMethod && item.before.every(done));
          if (!found || (found.tag === "emails" && rosterObserved)) { retired = true; return null; }
          found.state = "issued"; return found.wire;
        }, wire => { const item = intents.find(candidate => candidate.wire === wire); if (!item || item.state !== "issued") refuse(); item.state = "completed"; });
        const hooks: TeamQueryHooks = Object.freeze({
          ownProfileMapped(profileId: string) {
            if (!current() || !idle() || profileObserved || !done("profile") || !["getMyProfile", "listMyTeams", "createTeam", "getTeamWorkspace", "listAdminRequestsForMe"].includes(method)) refuse(profileId);
            if (!isCanonicalUuid(profileId)) refuse(profileId);
            if (profileId !== cell.profileId) { negativeAccount = cell.accountScopeId; refuse(); }
            profileObserved = true;
            if (method === "listMyTeams") add("memberships", getWire("team_memberships", "id, participation_as_player, teams(*), team_membership_functions(function, status)", [["profile_id", `eq.${cell.profileId}`], ["status", "eq.active"]]), ["profile"]);
            if (method === "createTeam" || method === "getTeamWorkspace") {
              if (!selectedTeam) refuse();
              add("memberships", getWire("team_memberships", "id, profile_id, participation_as_player, status, team_membership_functions(function, status)", [["team_id", `eq.${selectedTeam}`], ["status", "eq.active"]]), ["profile"]);
              const body: unknown = JSON.stringify({ p_team_id: selectedTeam }); if (typeof body !== "string") refuse(body);
              if (!current()) refuse(); add("emails", rpcWire("get_team_member_emails", body), ["memberships"]);
            }
          },
          createdTeamMapped(teamId: string) {
            if (!current() || !idle() || method !== "createTeam" || createdObserved || !done("create") || !isCanonicalUuid(teamId)) refuse(teamId);
            createdObserved = true; selectedTeam = teamId; workspace(teamId, ["create"]);
          },
          beforeRosterProfiles(teamId: string, profileIds: readonly string[]) {
            if (!current() || !idle() || !profileObserved || rosterObserved || !["createTeam", "getTeamWorkspace"].includes(method) || !done("memberships") || teamId !== selectedTeam || !isCanonicalUuid(teamId)) refuse(teamId);
            if (!Array.isArray(profileIds)) refuse(profileIds);
            const length: unknown = profileIds.length; if (!current()) refuse(length);
            if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0) refuse(length);
            const copied: string[] = [];
            for (let index = 0; index < length; index++) {
              if (!current()) refuse(); const present = authApply(authHasOwn, profileIds, [String(index)]); if (!current()) refuse(); if (present !== true) refuse();
              const value: unknown = profileIds[index]; if (!current() || !isCanonicalUuid(value)) refuse(value); copied.push(value);
            }
            rosterObserved = true;
            add("profiles", getWire("profiles", "id, display_name", [["id", `in.(${[...new Set(copied)].join(",")})`]]), ["memberships"]);
          },
        });
        const authorized: AuthorizedTeamRequest = async (route, body) => {
          // A retired callback must not read inputs or affect a later command.
          if (!current() || !captured.api || nativeApiOrigin.status !== "configured") return { kind: "forbidden" };
          function record(value: unknown): object {
            if (!current()) refuse(value);
            if (disposal !== null && value === disposal) refuse(value);
            // Prove the actual mapper's narrow plain-record structure
            // independently. An intrinsic then throw is NOT a DTO proof:
            // a genuine Promise can throw while reading constructor/species.
            const wasInvalid = c.invalidInput;
            c.invalidInput = true;
            const originalCurrent = () => !retired && commandCurrent(c) && c.generation === generation && !c.supersededCredential && !sdkFailed && sportingAvailable(cell);
            if (!value || typeof value !== "object" || Array.isArray(value)) refuse(value);
            const prototype = authPrototype(value);
            if (!originalCurrent() || (prototype !== Object.prototype && prototype !== null)) {
              retired = true;
              // The reflected result and root are separate direct observations.
              // Neither may be discarded in favor of the other during drain.
              malformedFor(c, prototype);
              refuse(value);
            }
            const ownConstructor = authApply(authHasOwn, value, ["constructor"]);
            if (!originalCurrent() || ownConstructor !== false) refuse(value);
            const ownThen = authApply(authHasOwn, value, ["then"]);
            if (!originalCurrent() || ownThen !== false) refuse(value);
            // A genuine Promise can also be given a plain prototype. Retain
            // that observable work without reading its masked own `then`.
            let finish!: () => void;
            const pending = new Promise<void>(resolve => { finish = resolve; });
            let isPromise = false;
            try { authApply(authThen, value, [finish, finish]); isPromise = true; }
            catch { /* independently eligible plain record; C4 still applies */ }
            if (isPromise) { retired = true; c.malformed.push(pending); throw closedError(); }
            if (!originalCurrent()) refuse(value);
            c.invalidInput = wasInvalid;
            if (!current()) refuse(value);
            return value;
          }
          function read(value: object, key: string): unknown {
            if (!current()) refuse();
            const field = (value as Record<string, unknown>)[key];
            if (!current()) refuse(field);
            return field;
          }
          function matching(value: unknown, expected: unknown): unknown {
            if (!current() || value !== expected) refuse(value);
            return value;
          }
          let path: string | null, serialized: unknown;
          try {
            const routeRecord = record(route);
            matching(read(routeRecord, "kind"), method);
            const detachedRoute = method === "reviseInvitation" || method === "resendInvitation"
              ? { kind: method as "reviseInvitation" | "resendInvitation", invitationId: matching(read(routeRecord, "invitationId"), captured.args[0]) as string }
              : { kind: method as "createInvitation" | "createAdminRequest" | "removeMember" };
            if (!current()) refuse();
            path = resolveTeamApiRoutePath(detachedRoute);
            if (!current() || path !== captured.route) refuse();
            const bodyRecord = record(body);
            const detached: Record<string, unknown> = {};
            const proposal = captured.args[1] as Record<string, unknown>;
            const fields: readonly (readonly [string, unknown])[] = method === "createInvitation"
              ? [["teamId", captured.args[0]], ["email", proposal.email], ["participationAsPlayer", proposal.participationAsPlayer]]
              : method === "reviseInvitation"
                ? [["email", proposal.email], ["participationAsPlayer", proposal.participationAsPlayer]]
                : method === "createAdminRequest" || method === "removeMember"
                  ? [["teamId", captured.args[0]], ["membershipId", captured.args[1]]] : [];
            for (const [key, expected] of fields) detached[key] = matching(read(bodyRecord, key), expected);
            if (method === "createInvitation" || method === "reviseInvitation") {
              const functions = read(bodyRecord, "proposedFunctions");
              // Arrays are copied by own index; no caller iterator, method or
              // JSON coercion may define the authorized bytes.
              if (!Array.isArray(functions)) refuse(functions);
              const expected = proposal.proposedFunctions as readonly string[];
              matching(read(functions, "length"), expected.length);
              const copied: string[] = [];
              for (let index = 0; index < expected.length; index++) {
                if (!current()) refuse();
                const own = authApply(authHasOwn, functions, [String(index)]);
                if (!current() || own !== true) refuse();
                copied.push(matching(read(functions, String(index)), expected[index]) as string);
              }
              detached.proposedFunctions = Object.freeze(copied);
            }
            if (!current()) refuse();
            serialized = JSON.stringify(Object.freeze(detached));
            if (typeof serialized !== "string") refuse(serialized);
            if (!current() || serialized !== captured.body) refuse();
          } catch { retired = true; c.invalidInput = true; return { kind: "forbidden" }; }
          try {
            const response = await transport.fetch(new URL(path!, nativeApiOrigin.origin).href, { method: "POST", credentials: "omit", redirect: "error", headers: { "Content-Type": "application/json" }, body: serialized });
            return { kind: "response", response };
          } catch { return { kind: "network_error" }; }
        };
        try {
          const client = new PostgrestClient(base.href.replace(/\/$/, ""), { schema: "public", headers: { apikey: config.publishableKey }, retry: false, fetch: transport.fetch });
          if (!current()) return unavailable();
          const mapper = new SupabaseTeamService(client, authorized, hooks);
          if (!current()) return unavailable();
          try { return await observeDependency(authApply(mapper[method], mapper, captured.args as unknown[])) as TeamResult<unknown>; }
          catch { return unexpected(); }
        } finally { retired = true; await transport.sealAndDrain(); }
      }, unavailable, undefined, { current: cell.current, data: true, rpc: "get_my_gate_state", expectedAccount: cell.accountScopeId });
      if (negativeAccount !== null) { const outcome = await cell.invalidate(negativeAccount); if (outcome !== null) notifyInvalidation(outcome); return unavailable(); }
      return sportingAvailable(cell) ? frozenResult(result) : unavailable();
    })().catch(unexpected);
    runtimeWork.add(work); void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); });
    return work as ReturnType<TeamService[K]>;
  }
  function bindFoundationService(profileId: string): TeamService | null {
    if (terminal || !identityAvailable()) return null;
    if (typeof profileId !== "string") { retainAuxiliary(profileId); return null; }
    const cell = profileAdmission;
    if (!isCanonicalUuid(profileId) || !cell || cell.profileId !== profileId || !sportingAvailable(cell)) return null;
    const invoke = <K extends FoundationMethod>(method: K, args: readonly unknown[]): ReturnType<TeamService[K]> => {
      if (!sportingAvailable(cell)) return Promise.resolve(teamFailed("forbidden", "You must be signed in.")) as ReturnType<TeamService[K]>;
      return runFoundation(cell, method, captureFoundation(cell, method, args));
    };
    return Object.freeze<TeamService>({
      getMyProfile: () => invoke("getMyProfile", []), hasPilotTeamCreationCapability: () => invoke("hasPilotTeamCreationCapability", []), listMyTeams: () => invoke("listMyTeams", []),
      createTeam: input => invoke("createTeam", [input]), getTeamWorkspace: id => invoke("getTeamWorkspace", [id]), renameTeam: (id, name) => invoke("renameTeam", [id, name]), archiveTeam: id => invoke("archiveTeam", [id]), restoreTeam: id => invoke("restoreTeam", [id]),
      setParticipation: (team, membership, player) => invoke("setParticipation", [team, membership, player]), assignDirectFunction: (team, membership, fn) => invoke("assignDirectFunction", [team, membership, fn]), removeDirectFunction: (team, membership, fn) => invoke("removeDirectFunction", [team, membership, fn]), removeAdminFunction: (team, membership) => invoke("removeAdminFunction", [team, membership]), relinquishOwnAdmin: id => invoke("relinquishOwnAdmin", [id]), removeMember: (team, membership) => invoke("removeMember", [team, membership]), leaveTeam: id => invoke("leaveTeam", [id]),
      listInvitations: id => invoke("listInvitations", [id]), createInvitation: (id, proposal) => invoke("createInvitation", [id, proposal]), reviseInvitation: (id, proposal) => invoke("reviseInvitation", [id, proposal]), resendInvitation: id => invoke("resendInvitation", [id]), revokeInvitation: id => invoke("revokeInvitation", [id]), previewInvitation: token => invoke("previewInvitation", [token]), acceptInvitation: token => invoke("acceptInvitation", [token]),
      listAdminRequestsForMe: () => invoke("listAdminRequestsForMe", []), listAdminRequestsForTeam: id => invoke("listAdminRequestsForTeam", [id]), createAdminRequest: (team, membership) => invoke("createAdminRequest", [team, membership]), revokeAdminRequest: id => invoke("revokeAdminRequest", [id]), acceptAdminRequest: id => invoke("acceptAdminRequest", [id]), listNotifications: () => invoke("listNotifications", []), acknowledgeNotification: id => invoke("acknowledgeNotification", [id]),
    });
  }

  function buildAccountDeletionService(): AccountDeletionService {
    if (!captureAccountControl) throw null;
    type Method = "state" | "request" | "cancel" | "export";
    const rpcFailure = () => ({ data: null, error: { message: "unavailable" } });
    function run<T>(method: Method, selector: unknown, beforeMutation?: unknown, observer?: unknown): Promise<AccountDeletionResult<T>> {
      const unavailable = (): AccountDeletionResult<T> => Object.freeze({ ok: false, error: "unavailable" });
      if (!identityAvailable()) return Promise.resolve(unavailable());
      const control = captureAccountControl!(), admission = method === "request" || method === "export" ? profileAdmission : null;
      const originalFreshEvent = preparation?.ownServerControl ? sourceFreshEvent : null;
      type ControlOccurrence = Readonly<{ command: Command; token: object; generation: number; account: string }>;
      let controlOccurrence: ControlOccurrence | null = null;
      let validatedControl: Readonly<{ occurrence: ControlOccurrence; profile: string; revision: number }> | null = null;
      // Account-first state/cancel may run before any Profile is admitted. Keep
      // an actually current original admission for account correlation and
      // denial provenance, never as a new Profile/recovery grant.
      const originalAccountAdmission = profileAdmission?.current() ? profileAdmission : null;
      if (method !== "state" && !isCanonicalUuid(selector)) { retainAuxiliary(selector); return Promise.resolve(unavailable()); }
      if ((method === "request" && typeof beforeMutation !== "function") || (observer !== undefined && typeof observer !== "function")) {
        retainAuxiliary(beforeMutation); retainAuxiliary(observer); return Promise.resolve(unavailable());
      }
      if ((method === "request" || method === "export") && (!admission || admission.profileId !== selector || !admission.current())) {
        return Promise.resolve(Object.freeze({ ok: false, error: "account_changed" }));
      }
      let account: string | null = admission?.accountScopeId ?? originalAccountAdmission?.accountScopeId ?? null, profile: string | null = admission?.profileId ?? originalAccountAdmission?.profileId ?? null;
      let profileContradicted = false;
      let denialFlight: Promise<NativeAccountPending | null> | null = null, continuation: (() => boolean) | null = null;
      let requestGuard: Readonly<AccountDeletionGuard> | null = null, selfChecked = false;
      let factualCurrent: (() => boolean) | null = null, confirmedPending: AccountDeletionState | null = null;
      const current = () => !terminal && !profileContradicted && (denialFlight ? continuation !== null && continuation() : control.current());
      const currentFact = () => !terminal && factualCurrent !== null && factualCurrent();
      const effects = async () => { if (denialFlight) await denialFlight; return identityAvailable() && current(); };
      function bindProfile(value: string): boolean {
        if (!isCanonicalUuid(value) || (profile !== null && profile !== value)) return false;
        profile = value; return true;
      }
      function deny(barredAccount: string | null = account): Promise<NativeAccountPending | null> {
        if (!denialFlight) {
          if (terminal || !control.current()) return Promise.resolve(null);
          denialFlight = control.invalidate(barredAccount).then(value => {
            if (value) { continuation = value.current; factualCurrent = value.publicationCurrent; if (value.outcome) notifyInvalidation(value.outcome); }
            return value;
          }, () => null);
        }
        return denialFlight;
      }
      function pendingDenial(): Promise<NativeAccountPending | null> {
        if (!denialFlight) {
          if (terminal || !control.current() || account === null) return Promise.resolve(null);
          denialFlight = control.observePending(account).then(value => {
            if (value) { continuation = value.current; factualCurrent = value.publicationCurrent; if (value.outcome) notifyInvalidation(value.outcome); }
            return value;
          }, () => null);
        }
        return denialFlight;
      }
      const denied = async (): Promise<InvalidationOutcome> => {
        const actual = await deny();
        // Refuse only this attributed call. No denial began, so no marker or
        // substitute transition can be returned to the newer UI owner.
        if (!actual?.outcome) throw closedError();
        return frozenResult(actual.outcome);
      };
      function callback(callbackValue: (...args: never[]) => unknown, args: unknown[]): unknown {
        const previous = accountCallback; accountCallback = { invalidate: denied };
        try { return authApply(callbackValue, undefined, args); }
        finally { accountCallback = previous; }
      }
      function onPending(pending: AccountDeletionState): boolean {
        if (!current() || !bindProfile(pending.profileId)) return false;
        confirmedPending = pending; // actual mapper-owned object; observers get a detached copy
        let accepted = true;
        if (typeof observer === "function") {
          try {
            const result = callback(observer as (...args: never[]) => unknown, [frozenResult(pending)]);
            if (result === false) accepted = false;
            else if (result !== undefined && result !== true) { retainAuxiliary(result); accepted = false; }
          } catch { /* A current confirmed fact still requires native denial. */ }
        }
        // Presentation is optional. Only the real conditional coordinator path
        // supplies denial, even when there is no callback or it throws/refuses.
        if (!denialFlight) void pendingDenial();
        return accepted;
      }
      const adapter: StorageAdapter = Object.freeze({
        async get(key: string) {
          const refused = () => ({ status: "read_failed" as const, fallback: null, error: { kind: "storage_unavailable" as const } });
          if (!await effects() || !identityAvailable() || !current()) return refused();
          const value = await pair!.domain.get(key);
          return await effects() ? value : refused();
        },
        async set(key: string, value: string) {
          const refused = () => ({ ok: false as const, error: { kind: "storage_unavailable" as const } });
          if (!await effects() || !identityAvailable() || !current()) return refused();
          const result = await pair!.domain.set(key, value);
          return await effects() ? result : refused();
        },
      });
      // During an owned denial the adapter awaits its actual completion. The
      // source wrapper must allow that wait, then the adapter re-proves effects.
      const guardCurrent = () => !terminal && !profileContradicted && (denialFlight ? continuation === null || continuation() : control.current());
      const sourceGuards = sourceDeletionGuards(adapter, guardCurrent, effects);
      const actualGuards = sourceGuards ?? createAccountDeletionGuardRepository(adapter);
      const guards = Object.freeze({
        load: (value: string) => bindProfile(value) ? actualGuards.load(value) : Promise.resolve({ status: "unavailable" as const }),
        async begin(value: string, revision: number, nonce: string) {
          if (!bindProfile(value)) return null;
          const guard = await actualGuards.begin(value, revision, nonce);
          if (guard && await effects() && method === "request") requestGuard = Object.freeze({ ...guard });
          return guard;
        },
        resolve: (guard: AccountDeletionGuard, revision: number) => bindProfile(guard.profileId) ? actualGuards.resolve(guard, revision) : Promise.resolve(false),
        canAdmit: (value: string) => bindProfile(value) ? actualGuards.canAdmit(value) : Promise.resolve(false),
      });
      const calls = method === "state" ? ["get_my_account_deletion_control", "abort_my_uncommitted_account_deletion"]
        : method === "request" ? ["get_my_account_deletion_control", "request_my_account_deletion"]
        : method === "cancel" ? ["get_my_account_deletion_control", "cancel_my_account_deletion", "get_my_account_deletion_control"]
        : ["get_my_account_export"];
      let callIndex = 0;
      const port: AccountDeletionRpcPort = Object.freeze({
        async rpc(name: string, args?: Record<string, unknown>) {
          if (!await effects() || calls[callIndex] !== name) return rpcFailure();
          callIndex++;
          const body = JSON.stringify(args ?? {});
          if (typeof body !== "string") { retainAuxiliary(body); return rpcFailure(); }
          if (name === "request_my_account_deletion") {
            if (!denialFlight || !continuation || !requestGuard || args?.p_expected_profile_id !== profile || args.p_expected_revision !== requestGuard.revision) return rpcFailure();
            const loaded = await actualGuards.load(profile!);
            if (loaded.status !== "guard" || loaded.resolved || loaded.guard.nonce !== requestGuard.nonce || loaded.guard.revision !== requestGuard.revision) return rpcFailure();
          }
          if (!await effects()) return rpcFailure();
          let negative: string | null | undefined;
          const result = await enqueue("restore", async () => {
            const c = active!;
            if (!await restoreSelf(c, account, value => {
              if (!commandCurrent(c)) return;
              // An unsigned status poll observes ordinary absence, not a new
              // identity denial. In particular it must not erase an incoming
              // Team link. Actual invalid_session and known-owner loss retain
              // their existing conditional denial path.
              if (value.kind === "no_session" && account === null && originalAccountAdmission === null) return;
              negative = value.kind === "authenticated" ? value.identity.accountScopeId : account ?? originalAccountAdmission?.accountScopeId ?? null;
            }, value => {
              if (!current() || (account !== null && account !== value)) return false;
              account = value; return true;
            })) return rpcFailure();
            if (admission && !selfChecked) {
              if (!admission.current()) return rpcFailure();
              c.dataStage = "rpc"; c.rpc = "get_my_gate_state"; c.rpcBody = "{}";
              const facts = await identityMapper!.resolveGateFacts();
              if (!commandCurrent(c)) return rpcFailure();
              if (!facts.ok) {
                if (facts.error.kind === "forbidden" || facts.error.kind === "profile_required") negative = account;
                return rpcFailure();
              }
              const eligibility = deriveGateEligibility(facts.value);
              if (eligibility.kind !== "complete" || eligibility.profileId !== admission.profileId || eligibility.onboardingCompletedAt !== admission.onboardingCompletedAt) {
                negative = account; return rpcFailure();
              }
              if (!admission.current() || !canSend(c)) return rpcFailure();
              selfChecked = true;
            }
            if (!canSend(c) || !current()) return rpcFailure();
            c.dataStage = "rpc"; c.rpc = name; c.rpcBody = body;
            if (method === "state" && name === "get_my_account_deletion_control" && c.sourceToken && account !== null) {
              controlOccurrence = Object.freeze({ command: c, token: c.sourceToken, generation: c.generation, account });
            }
            return await dataClient!.rpc(name, args);
          }, rpcFailure, undefined, { current, data: true, rpc: name, expectedAccount: account, admission: originalAccountAdmission });
          // Conditional denial must never recursively reserve the SDK lane.
          if (negative !== undefined) await deny(negative);
          return result;
        },
      });
      const onNativeControlProfile = (value: string): boolean => {
        if (!current() || !identityAvailable()) return false;
        if (originalAccountAdmission && value !== originalAccountAdmission.profileId) {
          profileContradicted = true; // No success, guard or mutation can follow.
          if (control.current() && originalAccountAdmission.current()) {
            // Capture both originals before any presentation callback can
            // reenter and replace the host's current admission/bindings.
            const tracker = nativeTracker?.cell === originalAccountAdmission ? nativeTracker.owner : null;
            const application = sportingApplication?.cell === originalAccountAdmission ? sportingApplication.binding : null;
            tracker?.deny(); application?.retire();
            void deny(originalAccountAdmission.accountScopeId);
          }
          return false;
        }
        return bindProfile(value);
      };
      const mapper = createSupabaseAccountDeletionService(port, guards, checkedId, deletionRequests, async pending => {
        if (!current() || !bindProfile(pending.profileId)) throw null;
        await pendingDenial();
      }, onNativeControlProfile, sourceGuards ? (value, revision) => {
        const accepted: unknown = sourceGuards.acceptControl(value, revision);
        if (accepted !== true && accepted !== false) return badIdentityValue(accepted);
        if (accepted && controlOccurrence) validatedControl = Object.freeze({ occurrence: controlOccurrence, profile: value, revision });
        return accepted;
      } : undefined);
      const work = (async (): Promise<AccountDeletionResult<T>> => {
        let result: AccountDeletionResult<unknown>;
        try {
          if (method === "state") result = await mapper.getState(onPending);
          else if (method === "cancel") result = await mapper.cancel(selector as string);
          else if (method === "export") result = await mapper.exportCloud(selector as string);
          else result = await mapper.request(selector as string, async () => {
            if (!await effects() || !admission?.current() || typeof beforeMutation !== "function") return false;
            let actual: unknown;
            try { actual = callback(beforeMutation as (...args: never[]) => unknown, []); } catch { return false; }
            let allowed: unknown;
            try { allowed = await observeDependency(actual); } catch { return false; }
            if (allowed !== true) {
              // An async callback may settle with a masked native Promise. Its
              // actual observed value is still owned, but grants no permission.
              if (allowed !== false && allowed !== undefined) retainAuxiliary(allowed);
              return false;
            }
            const actualDenial = denialFlight ? await denialFlight : null;
            return allowed === true && actualDenial?.outcome?.kind === "identity_invalidated" && continuation !== null && await effects();
          }, onPending);
        } catch { result = unavailable(); }
        if (denialFlight) await denialFlight;
        const currentPendingFact = result.ok && confirmedPending !== null && result.value === confirmedPending && currentFact();
        if (terminal || (!currentPendingFact && (!current() || !identityAvailable()))) return unavailable();
        if (method === "export" && result.ok) {
          const exported = result.value as Record<string, unknown>;
          if (exported.accountId !== account || (exported.profile as Record<string, unknown>)?.id !== profile) return unavailable();
        }
        if (method === "state" && result.ok && result.value === null && originalFreshEvent && validatedControl && preparation?.ownServerControl) {
          const observed = validatedControl as Readonly<{ occurrence: ControlOccurrence; profile: string; revision: number }>;
          const original = observed.occurrence, c = original.command;
          const observationCurrent = () => identityAvailable() && control.current() && denialFlight === null && original.account === account && observed.profile === profile &&
            c.intent === intent && !c.invalidInput && !c.supersededCredential && original.token === sourceCommandToken && original.generation === generation &&
            c.generation === original.generation && queued === 0 && active === null;
          if (observationCurrent()) {
            let returned: unknown;
            try { returned = preparation.ownServerControl(originalFreshEvent, original.account, observed.profile, observed.revision, observationCurrent); }
            catch { return badIdentityValue(); }
            if (returned !== undefined) return badIdentityValue(returned);
            if (!observationCurrent()) return unavailable();
          }
        }
        // Confirmed pending/denial is factual completion, never new admission.
        return frozenResult(result) as AccountDeletionResult<T>;
      })().catch(unavailable);
      runtimeWork.add(work);
      void work.then(() => { runtimeWork.delete(work); }, () => { runtimeWork.delete(work); });
      return work;
    }
    return Object.freeze({
      getState: (observer?: AccountDeletionPendingObserver) => run<AccountDeletionState | null>("state", undefined, undefined, observer),
      request: (profile: string, beforeMutation?: () => Promise<boolean>, observer?: AccountDeletionPendingObserver) => run<AccountDeletionState>("request", profile, beforeMutation, observer),
      cancel: (request: string) => run<boolean>("cancel", request),
      exportCloud: (profile: string) => run<Record<string, unknown>>("export", profile),
    });
  }
  function sourceDeletionGuards(adapter: StorageAdapter, current: () => boolean, beforeIO?: () => Promise<boolean>) {
    if (preparation?.publishedSourceDeletionGuards) {
      const repository = preparation.publishedSourceDeletionGuards(current, beforeIO);
      if (!repository) throw null;
      return repository;
    }
    return preparation?.wrapSourceDeletionGuards?.(adapter, current);
  }
  function buildRuntime(): IdentityRuntimeReady {
    dataClient = new PostgrestClient(new URL("rest/v1", new URL(config.url.endsWith("/") ? config.url : config.url + "/")).href,
      { schema: "public", headers: { apikey: config.publishableKey }, fetch: ownedFetch });
    if (terminal) throw null;
    identityMapper = createSupabaseIdentityService(dataClient, { now: checkedClock });
    if (sporting) sportingMapper = createSupabaseSportingCloudService(dataClient);
    const owned = createIdentityRepositorySet(pair!.domain);
    const repositories = Object.freeze({ ...owned,
      deletionGuards: sourceDeletionGuards(pair!.domain, identityAvailable) ?? owned.deletionGuards,
      barriers: Object.freeze({ ...owned.barriers,
      async save(...args: Parameters<typeof owned.barriers.save>) {
        const result = await owned.barriers.save(...args);
        if (result.ok) deliver(barrierListeners, []);
        return result;
      },
    }) });
    const ownership: NativeIdentityOwnership = Object.freeze({
      bind(current: () => boolean): NativeIdentityOperation {
        let observation: SessionRestoreOutcome | null = null;
        return Object.freeze({ auth: makeAuth(current, profileAdmission?.current() ? profileAdmission : null),
          identity: (expected: string | null, expectedProfile: string | null) => nativeIdentity(current, expected, expectedProfile, value => {
            if (!terminal && current()) observation = frozenResult(value);
          }),
          takeAuthObservation() { const value = observation; observation = null; return !terminal && current() ? value : null; },
        });
      },
      admissionAllowed: identityAvailable,
      ...(preparation?.ownFreshEmailOtpSource && preparation.ownFreshEmailOtp ? {
        ...(preparation.freshEmailOtpOnline === true ? { freshEmailOtpOnline: true as const } : {}),
        ownFreshEmailOtpSource: preparation.ownFreshEmailOtpSource,
        ownFreshEmailOtp(event: object) {
          const returned: unknown = preparation.ownFreshEmailOtp!(event);
          if (returned === undefined && preparation.ownServerControl) sourceFreshEvent = event;
          return returned as void;
        },
        retainFreshEmailOtpWork: retainAuxiliary,
      } : {}),
      ...(sporting || preparation?.ownAccountRecovery ? { ownAccountControl(capture: () => NativeAccountControl) { captureAccountControl = capture; } } : {}),
      ...(sporting ? { ownAdmission(value: NativeProfileAdmission) { if (nativeTracker && nativeTracker.cell !== value) nativeTracker.owner.retire(); if (sportingApplication && sportingApplication.cell !== value) sportingApplication.binding.retire(); profileAdmission = value; },
        ownPendingIntentReplay(observe: () => Promise<NativePendingIntentReplay | null>) { observeIntentReplay = observe; },
        pendingIntentChanged: deliverPendingIntentChange } : {}),
      ownStartup(current: () => boolean) { startupCurrent = current; },
      ownClose(close: () => TransitionIdentity) { closeCoordinator = close; if (terminal) terminalTransition = close(); },
    });
    const capture = createCallbackCaptureCell(urlAccess);
    const generationCounter = createLiveGenerationCounter();
    const liveGeneration = Object.freeze({
      current: () => generationCounter.current(),
      bump() {
        const actual = generationCounter.bump();
        // The genuine coordinator's epoch has already changed, including bumps
        // after asynchronous barrier reads. Revoke before returning that epoch.
        retireSportingApplicationIfUnavailable();
        return actual;
      },
    });
    const createdRuntime = createIdentityRuntime({ urlAccess,
      onProgress: (value, transition) => deliver(progressListeners, [value, frozenResult(transition)]),
      deps: { auth,
      identity: nativeIdentity(() => !terminal, null, null, () => {}), capture, ...repositories,
      liveGeneration, now: checkedClock, newId: checkedId,
      resolveRedirectTarget: () => {
        if (!origin || terminal || identityFault) return null;
        let value: unknown;
        try { value = authApply(origin, dependencyReceiver, []); } catch { return badIdentityValue(); }
        if (value === null) return null;
        if (typeof value !== "string") return badIdentityValue(value);
        if (terminal || identityFault) return null;
        try { return new URL("/", value).href; } catch { return null; }
      },
      nativeOwnership: ownership,
    } }, capture);
    if (createdRuntime.status !== "ready" || !closeCoordinator) throw null;
    const actual = createdRuntime.coordinator;
    if (teamLinkOptions) teamLinks = createNativeTeamLinkDelivery({ ...teamLinkOptions,
      current: identityAvailable, isOwnDisposal: value => disposal !== null && value === disposal,
      now: () => checkedClock(retainTeamLinkClockWork), capture: value => actual.capturePendingIntent(value),
      changed: () => deliverOwnedCompletion(teamLinkListeners),
    });
    const unavailable = () => ({ kind: "temporarily_unavailable" as const, transition: terminalIdentity() });
    const superseded = () => ({ kind: "superseded" as const, transition: terminalIdentity() });
    const denied = () => ({ kind: "durable_denial_unavailable" as const, denial: "durable_denial_unavailable" as const,
      outstanding: ["durable_barrier", "trusted_state", "pending_intent", "outstanding_cleanup_record"] as ("durable_barrier" | "trusted_state" | "pending_intent" | "outstanding_cleanup_record")[], transition: terminalIdentity() });
    const startup = () => ({ callback: { kind: "temporarily_unavailable" as const }, verdict: { kind: "identity_unconfirmed" as const }, finalization: null, transition: terminalIdentity() });
    const startOnce = () => trackRuntime(() => createdRuntime.startUpOnce(), startup, () => startupCurrent !== null && startupCurrent());
    const coordinator = Object.freeze<IdentityTransitionCoordinator>({
      canSignInForReview: () => identityAvailable() && actual.canSignInForReview(),
      startUp: startOnce,
      startGoogleSignIn: () => trackRuntime(() => actual.startGoogleSignIn(), unavailable),
      requestEmailOtp: email => trackRuntime(() => actual.requestEmailOtp(email), unavailable),
      verifyEmailOtp: (email, token) => trackRuntime(() => actual.verifyEmailOtp(email, token), unavailable),
      signInForReview: (email, password) => trackRuntime(() => actual.signInForReview(email, password), unavailable),
      submitOnboarding: value => trackRuntime(() => actual.submitOnboarding(value), unavailable),
      refreshLegalSnapshot: () => trackRuntime(() => actual.refreshLegalSnapshot(), () => ({ kind: "legal_unavailable" as const })),
      retryTrustedStateEstablishment: () => trackRuntime(() => actual.retryTrustedStateEstablishment(), unavailable),
      capturePendingIntent: value => trackRuntime(() => actual.capturePendingIntent(value), () => ({ kind: "blocked" as const })),
      signOut: () => trackRuntime(() => actual.signOut(), superseded),
      recoverInvitationAccount: value => trackRuntime(() => actual.recoverInvitationAccount(value), superseded),
      invalidateIdentity: () => {
        if (!accountCallback) return trackRuntime(() => actual.invalidateIdentity(), denied);
        // This private attributed refusal is explicitly owned but deliberately
        // not mapped to the ordinary begun-invalidation fallback.
        const pending = accountCallback.invalidate();
        runtimeWork.add(pending);
        void pending.then(() => { runtimeWork.delete(pending); }, () => { runtimeWork.delete(pending); });
        return pending;
      },
      revalidateGateFacts: () => trackRuntime(() => actual.revalidateGateFacts(), unavailable),
      discardPendingIntent: () => trackRuntime(() => actual.discardPendingIntent(), () => ({ kind: "blocked" as const })),
      observeNewerBarrier: () => trackRuntime(() => actual.observeNewerBarrier(), () => ({ kind: "unchanged" as const })),
      classifyAuthChange: change => terminal || identityFault ? { kind: "no_action" } : actual.classifyAuthChange(change),
    });
    const baseRuntime: IdentityRuntimeReady = { status: "ready", coordinator, startUpOnce: startOnce,
      subscribeToProgress: listener => subscribe(progressListeners, listener),
      subscribeToAuthChanges: listener => terminal ? () => {} : auth.onAuthChange(listener),
      subscribeToBarrierChanges: listener => subscribe(barrierListeners, listener),
      captureCurrentDeepLinkIntent: () => trackRuntime(() => teamLinks ? teamLinks.initialCapture() : createdRuntime.captureCurrentDeepLinkIntent(), () => ({ kind: "blocked" as const })),
      loadPendingIntent: () => trackRuntime(() => createdRuntime.loadPendingIntent(), () => null),
    };
    if (preparation?.ownAccountRecovery) {
      const service = buildAccountDeletionService();
      const result: unknown = preparation.ownAccountRecovery(Object.freeze({ getState: service.getState, cancel: service.cancel }));
      if (result !== undefined) badIdentityValue(result);
    }
    const finalRuntime = sporting ? Object.freeze<NativeSportingIdentityRuntimeReady>({ ...baseRuntime,
      accountDeletion: buildAccountDeletionService(),
      createSportingCloudService: bindSportingService,
      createTeamExerciseCloudService: bindTeamExerciseService,
      createTeamService: bindFoundationService, createLocalSportingScope: bindLocalSportingScope,
      createSportingApplicationScope: bindSportingApplicationScope,
      subscribeToIdentityInvalidations: listener => subscribe(invalidationListeners, listener),
    }) : Object.freeze(baseRuntime);
    if (sporting) registerNativeTrackerRuntime(finalRuntime, bindTracker, listener => subscribe(invalidationListeners, listener), observePublishedPendingIntent,
      listener => subscribe(pendingIntentListeners, listener), discardPublishedPendingIntent,
      value => { const replay = pendingReplayFor(value); return replay?.current() ? trackRuntime(() => replay.recover(), () => null) : Promise.resolve(null); },
      () => teamLinks?.getSnapshot() ?? inactiveTeamLinks, listener => subscribe(teamLinkListeners, listener));
    return finalRuntime;
  }
  const identityHost: NativeIdentityBootstrapHost = Object.freeze({
    ...(newUser ? { startupDiagnostic: () => startupDiagnostic } : {}),
    start() {
      if (terminal) return Promise.resolve(Object.freeze({ outcome: "closed" as const }));
      if (bootstrapStartFlight) return bootstrapStartFlight;
      if (identityFault) return Promise.resolve(Object.freeze({ outcome: "waiting" as const, code: "identity_failed" as const }));
      bootstrapStartFlight = (async (): Promise<NativeIdentityBootstrapStart> => {
        const started = await host.start();
        if (terminal) return Object.freeze({ outcome: "closed" });
        if (started.outcome !== "ready") return started;
        try { runtime ??= buildRuntime(); } catch { if (!terminal) identityFault = true; }
        if (terminal) return Object.freeze({ outcome: "closed" });
        if (identityFault || !runtime) return Object.freeze({ outcome: "waiting", code: "identity_failed" });
        if (teamLinks) {
          const sourceReady = await teamLinks.start();
          if (terminal) return Object.freeze({ outcome: "closed" });
          // Underlying genuine faults retain their original classification.
          const checkedHost = await host.start();
          if (terminal) return Object.freeze({ outcome: "closed" });
          if (checkedHost.outcome !== "ready") return checkedHost;
          if (identityFault) return Object.freeze({ outcome: "waiting", code: "identity_failed" });
          if (!sourceReady) return Object.freeze({ outcome: "waiting", code: "team_link_unavailable" });
        }
        return Object.freeze({ outcome: "ready", runtime });
      })();
      const flight = bootstrapStartFlight;
      void flight.then(() => { if (bootstrapStartFlight === flight) bootstrapStartFlight = null; });
      return flight;
    },
    health() { const state = host.health(); return Object.freeze({ ...state, phase: identityFault && state.phase === "ready" ? "waiting" as const : state.phase,
      code: identityFault ? "identity_failed" as const : state.code, identityFailed: identityFault,
      ...(teamLinks?.getSnapshot().kind === "unavailable" && !identityFault && !state.storageFailed && !state.sdkFailed && !state.cleanupUnconfirmed && state.phase === "ready"
        ? { phase: "waiting" as const, code: "team_link_unavailable" as const } : {}) }); },
    dispose: host.dispose,
  });
  return Object.freeze({ ok: true, host: identityHost });
}
