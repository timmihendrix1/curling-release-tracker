// The `IdentityTransitionCoordinator` — the single owner of every deliberate
// identity transition and every server-driven invalidation (ADR-0025 §1; Stage
// B0.2c).
//
// WHAT "SINGLE OWNER" MEANS CONCRETELY. Barriers, attempts and resolutions are
// written from nowhere else. `exchangeCorrelatedCallback`, `verifyEmailOtp`,
// `prepareGoogleSignIn`, `navigateToAuthorizationUrl` and `signOut` are called
// from nowhere else. No normalized provider auth change — `signed_in` included —
// can resolve a barrier or produce a ready state, which is what makes the SDK's
// persist-the-session-then-emit-then-resolve ordering harmless.
//
// THE TWO CATEGORIES HAVE DIFFERENT ORDERING, AND THAT IS DELIBERATE (ADR-0025 §5):
//
//  - **Deliberate, user-initiated** (Google, OTP, locked-screen recovery, explicit
//    sign-out, invitation recovery): write a fresh unresolved barrier FIRST; if
//    that write fails, **nothing begins** — no provider call, no navigation, no
//    preceding persistent local mutation. The person is waiting and nothing has
//    happened yet, so refusing to start costs only a retry.
//  - **Server-driven invalidation**: deny access IN MEMORY first, because by the
//    time the negative result arrives the application is already running and may
//    already be showing content. Only then attempt the durable barrier, and if
//    that fails, still attempt trusted-record removal as the fallback durable
//    denial. If both fail, denial holds for the page lifetime and **no durable
//    offline revocation is claimed**.
//
// THE EIGHT NAMED CHECKPOINTS (ADR-0025 §8). C1 after Google preparation; C2
// before navigation; C3 before exchange; C4 before resolution persistence; C5
// before OTP verification (including after the person's waiting period); C6 after
// it; **C7 after resolution persistence and before any ready-producing outcome**;
// C8a/C8b around provider sign-out. "After every asynchronous boundary" is
// deliberately NOT the rule, because a storage read is itself asynchronous.
//
// TWO LIVE GOOGLE EPOCHS (ADR-0025 §9). The start page's epoch ends at navigation.
// The callback page begins a FRESH epoch at Phase 0 admission and **never compares
// its newly created counter with the start page's persisted value** — cross-reload
// identity binding comes from the account scope, never from a generation. The
// durable comparison is always attempt-vs-resolution: two persisted numbers.
//
// HONEST LIMITATION (ADR-0025 §8). Browser storage and cross-tab `storage`-event
// delivery provide no instantaneous atomic revocation between tabs. The guarantee
// is narrower and exact: a stale operation cannot persistently resolve or supersede
// a newer barrier, and each tab denies access once it OBSERVES the newer barrier.

import {
  authFailed,
  normalizedAuthError,
  type AccountIdentity,
  type AuthProviderMechanics,
  type AuthServiceResult,
  type ExchangeOutcome,
  type NavigationOutcome,
  type NormalizedAuthChange,
  type NormalizedAuthError,
  type NormalizedAuthErrorKind,
  type PrepareAuthorizationOutcome,
  type SessionRestoreOutcome,
} from "../supabase/authService";
import type {
  CallbackCandidate,
  CallbackCaptureCell,
} from "../supabase/supabaseCallbackCapture";
import type { ClaimedCallback } from "../supabase/authService";
import type { PersistenceRemoveResult, PersistenceWriteResult } from "../persistence/types";
import {
  identityFailed,
  identityOk,
  type IdentityError,
  type IdentityErrorKind,
  type IdentityRecordLoad,
  type IdentityResult,
} from "./errors";
import {
  isCanonicalUuid,
  isValidDisplayName,
  isValidLegalVersionLabel,
  isValidTimestamp,
  readUntrustedProperty,
} from "./untrustedValue";
import {
  createIdentityAccessBarrier,
  validateIdentityAccessBarrier,
  type IdentityAccessBarrier,
  type IdentityBarrierOrigin,
} from "./identityBarrier";
import type { IdentityBarrierRepository } from "./identityBarrierRepository";
import {
  createIdentityBarrierResolution,
  isStructurallyCorrelated,
  validateIdentityBarrierResolution,
  type IdentityBarrierResolution,
} from "./identityBarrierResolution";
import type { IdentityBarrierResolutionRepository } from "./identityBarrierResolutionRepository";
import {
  deriveGateEligibility,
  type BareProfile,
  type GateEligibility,
  type GateFacts,
  type IdentityService,
  type PinnedLegalEvidence,
} from "./identityService";
import {
  createEmailOtpAttempt,
  createGoogleAttempt,
  validateInteractiveAuthAttempt,
  type InteractiveAuthAttempt,
} from "./interactiveAttempt";
import type { InteractiveAttemptRepository } from "./interactiveAttemptRepository";
import {
  canOfferSignIn,
  canCompleteOnboarding,
  type CompleteOnboardingInput,
  type LegalDocumentId,
  type LegalSnapshot,
  type SafeLegalDocument,
} from "./legalSnapshot";
import { parseSafeLegalUrl } from "./safeLegalUrl";
import {
  validatePendingIntent,
  type IntentMutationOutcome,
  type PendingIntent,
  type PendingIntentRepository,
} from "./pendingIntentRepository";
import {
  createTrustedDeviceRecord,
  validateTrustedDeviceRecord,
  withServerConfirmation,
  type TrustedDeviceRecord,
} from "./trustedDevice";
import type { TrustedDeviceRepository } from "./trustedDeviceRepository";
import {
  decideOAuthIntake,
  type DurableCorrelationSnapshot,
  type OAuthIntakeDecision,
  type OAuthReturnOutcome,
} from "./oauthReturnIntake";
import {
  INVALIDATION_RESIDUES,
  primaryInvalidationKind,
  type DenialMarker,
  type GateProgressPhase,
  type GateSession,
  type GateVerdict,
  type IdentityTransitionOutcome,
  type IdentityTransitionReport,
  type InvalidationOutcome,
  type InvalidationResidue,
  type LegalRefreshOutcome,
  type OnboardingSubmissionOutcome,
  type TransitionAnnotation,
  type TransitionIdentity,
} from "./gateState";

// ---------------------------------------------------------------------------
// The page-lifetime live generation
// ---------------------------------------------------------------------------

/**
 * A page-lifetime, in-memory stale-work guard — **never durable authority**
 * (ADR-0025 §9).
 *
 * It starts at 0 and every barrier establishment increments it BEFORE the value
 * is used, so a persisted `capturedIdentityGeneration` is always at least 1 while
 * a freshly loaded page's `current()` is 0. That is not a coincidence to be
 * maintained by discipline — it is what makes **an unfinished OTP flow
 * structurally non-resumable across a reload**: the reloaded page's live counter
 * can never coincide with the stored attempt's captured value.
 */
export type LiveGenerationCounter = {
  current(): number;
  /** Increments and returns the new value. */
  bump(): number;
};

export function createLiveGenerationCounter(): LiveGenerationCounter {
  let value = 0;
  return {
    current: () => value,
    bump: () => {
      value += 1;
      return value;
    },
  };
}

// ---------------------------------------------------------------------------
// Per-transition outcome subsets
// ---------------------------------------------------------------------------

type Outcome = IdentityTransitionReport;

/** Re-exported so a caller can name the ordering value the coordinator hands back
 * without importing the gate model directly. */
export type { TransitionIdentity };

export type GoogleStartOutcome = Extract<
  Outcome,
  {
    kind:
      | "navigating"
      | "barrier_not_established"
      | "preparation_failed"
      | "superseded"
      | "attempt_not_persisted"
      | "navigation_failed"
      | "temporarily_unavailable";
  }
> &
  TransitionAnnotation;

export type OtpRequestOutcome = Extract<
  Outcome,
  {
    kind:
      | "otp_requested"
      | "barrier_not_established"
      | "attempt_not_persisted"
      | "provider_error"
      | "invalid_input"
      /** A newer applicable operation took ownership before this request could
       * install its barrier or its attempt. Nothing was written. */
      | "superseded"
      | "temporarily_unavailable";
  }
> &
  TransitionAnnotation;

export type InteractiveCompletionOutcome = Extract<
  Outcome,
  {
    kind:
      | "resolved"
      | "superseded"
      | "correlation_changed"
      | "barrier_resolution_failed"
      | "provider_error"
      | "invalid_input"
      | "temporarily_unavailable"
      | "trusted_state_not_established"
      | "trusted_state_not_invalidated"
      | "intent_state_not_persisted"
      | "identity_invalidated"
      | "durable_denial_unavailable";
  }
> &
  TransitionAnnotation;

export type SignOutOutcome = Extract<
  Outcome,
  {
    kind:
      | "signed_out_locked"
      | "barrier_not_established"
      | "intent_state_not_persisted"
      | "trusted_state_not_invalidated"
      | "superseded";
  }
> &
  TransitionAnnotation;

/** The bounded invitation wrong-account recovery transition shares sign-out's
 * outcome shape: the same required local mutations, the same fail-closed rule that
 * every local failure before the provider call produces zero sign-out calls. */
export type InvitationRecoveryOutcome = SignOutOutcome;

/** Re-exported from the gate model, where it is defined so an onboarding result
 * can carry it without an import cycle. */
export type { InvalidationOutcome };

/**
 * ADR-0025 §A's background revalidation.
 *
 * Every member other than the four invalidation outcomes is NON-DENIAL and leaves
 * the existing ready session mounted: `superseded` (a newer operation took over),
 * `temporarily_unavailable` (transient or unconfirmed) and
 * `trusted_state_refresh_skipped` (a metadata write that failed). Each result
 * carries `mode: "background"`, which is what the reducer keys its
 * never-blocking behaviour off.
 */
export type RevalidationOutcome = Extract<
  Outcome,
  {
    kind:
      | "resolved"
      | "superseded"
      | "trusted_state_refresh_skipped"
      | "identity_invalidated"
      | "trusted_state_not_invalidated"
      | "intent_state_not_persisted"
      | "durable_denial_unavailable"
      | "temporarily_unavailable";
  }
> &
  TransitionAnnotation;

/** What `observeNewerBarrier` concluded. `newer_barrier` means live work has been
 * invalidated and the gate must deny. */
export type BarrierObservation = { kind: "unchanged" } | { kind: "newer_barrier" };

/**
 * Advice about one normalized provider auth change. Deliberately advice and not an
 * action: this call performs **zero** writes and can never produce access.
 */
export type AuthChangeAdvice = { kind: "no_action" } | { kind: "invalidation_required" };

/**
 * The result of startup.
 *
 * `finalization` is the coordinator's honest report of what an ADMITTED Phase 0
 * continuation concluded (`null` when none was admitted). The gate STATE is
 * determined by `callback` + `verdict` alone — see `reduceGateState`'s
 * `startup_completed` event; `finalization` exists so Stage B0.2e, which owns
 * copy, can distinguish "that sign-in link could not be used" from "we couldn't
 * complete that — please try again" without re-deriving it.
 */
export type StartupOutcome = {
  callback: OAuthReturnOutcome;
  verdict: GateVerdict;
  finalization: IdentityTransitionOutcome | null;
  /** The identity AND page-lifetime order of this startup operation. Every progress
   * phase it announced carries the same value, and the reducer opens the gate only
   * when the two match — so a delayed result from an older operation cannot. */
  transition: TransitionIdentity;
};

export interface IdentityTransitionCoordinator {
  /** Phase 0 -> Phase A -> Phase B. Called exactly once per page lifetime, from a
   * guarded lifecycle boundary — never during render. */
  startUp(): Promise<StartupOutcome>;
  startGoogleSignIn(): Promise<GoogleStartOutcome>;
  requestEmailOtp(email: string): Promise<OtpRequestOutcome>;
  verifyEmailOtp(email: string, token: string): Promise<InteractiveCompletionOutcome>;
  submitOnboarding(input: CompleteOnboardingInput): Promise<OnboardingSubmissionOutcome>;
  refreshLegalSnapshot(): Promise<LegalRefreshOutcome>;
  /** ADR-0025 §15's retry: revalidates the server-authoritative gate facts BEFORE
   * attempting the trusted write again. */
  retryTrustedStateEstablishment(): Promise<InteractiveCompletionOutcome>;
  /** Captures one deep-link intent through the same ordered mutation boundary as
   * denial cleanup and terminal dismissal. It does not supersede an access
   * transition because capturing an intent cannot itself grant or revoke access. */
  capturePendingIntent(intent: PendingIntent): Promise<IntentMutationOutcome>;
  signOut(): Promise<SignOutOutcome>;
  recoverInvitationAccount(invitation: PendingIntent): Promise<InvitationRecoveryOutcome>;
  /** The server-driven invalidation transition (ADR-0025 §14). */
  invalidateIdentity(): Promise<InvalidationOutcome>;
  /** Background revalidation after optimistic entry (ADR-0025 §A). */
  revalidateGateFacts(): Promise<RevalidationOutcome>;
  /**
   * Discards the stored deep-link intent unconditionally — ADR-0025 §22's terminal
   * handling, explicit dismissal, and definitive terminal denial of the invitation
   * itself (`invalid_token`, `expired`, `revoked`, `replaced`, `already_accepted`).
   *
   * Called AFTER the intent has been acted on, never before: the lifetime rule is
   * "never read, delete, then act", so an intent cannot be lost to a crash between
   * the read and the handling.
   */
  discardPendingIntent(): Promise<IntentMutationOutcome>;
  /** Called from a cross-tab `storage` observation. */
  observeNewerBarrier(): Promise<BarrierObservation>;
  /** Pure, synchronous, write-free classification of a normalized provider auth
   * change. */
  classifyAuthChange(change: NormalizedAuthChange): AuthChangeAdvice;
}

export type IdentityCoordinatorDeps = {
  auth: AuthProviderMechanics;
  identity: IdentityService;
  /** The page-lifetime capture cell, owned by `identityRuntime`. */
  capture: CallbackCaptureCell;
  barriers: IdentityBarrierRepository;
  attempts: InteractiveAttemptRepository;
  resolutions: IdentityBarrierResolutionRepository;
  trusted: TrustedDeviceRepository;
  intents: PendingIntentRepository;
  liveGeneration: LiveGenerationCounter;
  now: () => string;
  /** Canonical UUIDs for barriers and attempts. */
  newId: () => string;
  /** The Google redirect target: this origin's root, or `null` when there is no
   * document. */
  resolveRedirectTarget: () => string | null;
  onProgress?: (phase: GateProgressPhase, transition?: TransitionIdentity) => void;
};

// ---------------------------------------------------------------------------
// Phase A — the pure durable preflight
// ---------------------------------------------------------------------------

/**
 * What Phase A could establish. **No account scope is checked here**, because no
 * identity has been restored yet; Phase A can only ever produce a *structurally
 * correlated* resolution (ADR-0025 §4).
 */
export type PreflightResult =
  /** No barrier at all: restoration proceeds with no resolution in play. */
  | { kind: "no_barrier" }
  | {
      kind: "correlated";
      barrier: IdentityAccessBarrier;
      attempt: InteractiveAuthAttempt;
      resolution: IdentityBarrierResolution;
    }
  /** Fail closed. A barrier exists (or could not be read) and no completed,
   * exactly correlated set completes it. */
  | { kind: "quarantined"; origin: IdentityBarrierOrigin | null };

/**
 * Evaluates the completed-correlation-set rule. Pure.
 *
 * The all-three-records requirement applies **only to completed sets**. An
 * admissible in-progress Google return never reaches here: Phase 0 routes it, which
 * is exactly what stops the protocol from deadlocking the flow that creates the
 * resolution.
 */
export function evaluateDurablePreflight(snapshot: DurableCorrelationSnapshot): PreflightResult {
  if (snapshot.barrier.status === "absent") return { kind: "no_barrier" };
  if (snapshot.barrier.status !== "value") {
    // Malformed or unreadable. Never treated as absent: a barrier only ever
    // denies, so failing closed means leaving it in force.
    return { kind: "quarantined", origin: null };
  }

  const barrier = snapshot.barrier.value;
  const quarantined: PreflightResult = { kind: "quarantined", origin: barrier.origin };

  if (snapshot.attempt.status !== "value") return quarantined;
  if (snapshot.resolution === null || snapshot.resolution.status !== "value") return quarantined;
  if (!isStructurallyCorrelated(barrier, snapshot.attempt.value, snapshot.resolution.value)) {
    return quarantined;
  }

  return {
    kind: "correlated",
    barrier,
    attempt: snapshot.attempt.value,
    resolution: snapshot.resolution.value,
  };
}

// ---------------------------------------------------------------------------
// The coordinator
// ---------------------------------------------------------------------------

/** Maps the closed Phase 0 decision onto the closed report the caller sees. */
function callbackOutcomeFor(decision: OAuthIntakeDecision): OAuthReturnOutcome {
  switch (decision.kind) {
    case "no_return":
      return { kind: "no_return" };
    case "provider_error":
      return { kind: "provider_error" };
    case "unowned_callback":
      return { kind: "unowned_callback" };
    case "replayed_callback":
      return { kind: "replayed_callback" };
    case "ambiguous_callback":
      return { kind: "ambiguous_callback" };
    case "malformed_callback":
      return { kind: "malformed_callback" };
    case "admit_continuation":
      // Never reached: an admitted continuation reports what its exchange and
      // finalization concluded, not the admission itself.
      return { kind: "no_return" };
  }
}

/** Provider failures, normalized onto this domain's closed outcomes. No raw
 * provider text is read, and none travels. */
function otpRequestOutcomeFor(error: NormalizedAuthError): OtpRequestOutcome {
  if (error.kind === "temporarily_unavailable") return { kind: "temporarily_unavailable" };
  if (error.kind === "invalid_input") return { kind: "invalid_input" };
  return { kind: "provider_error" };
}

function completionFailureFor(error: NormalizedAuthError): InteractiveCompletionOutcome {
  if (error.kind === "temporarily_unavailable") return { kind: "temporarily_unavailable" };
  if (error.kind === "invalid_input") return { kind: "invalid_input" };
  return { kind: "provider_error" };
}

// ---------------------------------------------------------------------------
// Dependency containment
//
// Every dependency below is INJECTED, so "it resolves and never throws" is a
// property of whatever was passed in — not something this module can assume. A
// hostile or defective fake, a future implementation with a bug, or a browser API
// that throws where it used to return would otherwise reject a public coordinator
// method that has declared it never rejects.
//
// This is deliberately NOT a blanket try/catch around each public method. A single
// outer catch could turn a partially completed security transition — one that had
// already written a barrier, or already called a provider — into a generic
// "something went wrong" that a caller might treat as harmless. Instead each
// dependency is wrapped individually, and **each wrapper's substitute value is the
// deny-ward one for that specific boundary**: an unusable identifier or timestamp
// (which the record validators then reject), a `NaN` generation (which no
// checkpoint comparison can match), a `malformed_callback`, a `restore_failed`, a
// failed write, a read failure. No wrapper can turn a failure into a success, and
// the ordering of the transition is untouched.
//
// A caught value is discarded without being inspected, logged or forwarded — every
// `catch` below is a bare `catch {}` and does not even bind it.
// ---------------------------------------------------------------------------

/** A value so obviously unusable that every record validator rejects it. Produced
 * when an injected clock or id generator throws, so a defective one can never
 * establish a barrier, an attempt, a resolution or trusted state. */
const UNUSABLE_VALUE = "";

function containClock(now: () => string): () => string {
  return () => {
    try {
      const value = now();
      return typeof value === "string" ? value : UNUSABLE_VALUE;
    } catch {
      return UNUSABLE_VALUE;
    }
  };
}

function containIdSource(newId: () => string): () => string {
  return () => {
    try {
      const value = newId();
      return typeof value === "string" ? value : UNUSABLE_VALUE;
    } catch {
      return UNUSABLE_VALUE;
    }
  };
}

function containRedirectResolver(resolve: () => string | null): () => string | null {
  return () => {
    try {
      const value = resolve();
      return typeof value === "string" ? value : null;
    } catch {
      // No resolvable origin means preparation fails closed, with zero provider
      // calls — the same outcome as a genuinely absent document.
      return null;
    }
  };
}

/** `NaN` is the deny-ward substitute: it never equals itself, so every checkpoint
 * comparison against it fails and every record carrying it is rejected. */
function containLiveGeneration(counter: LiveGenerationCounter): LiveGenerationCounter {
  return {
    current: () => {
      try {
        const value = counter.current();
        return typeof value === "number" ? value : Number.NaN;
      } catch {
        return Number.NaN;
      }
    },
    bump: () => {
      try {
        const value = counter.bump();
        return typeof value === "number" ? value : Number.NaN;
      } catch {
        return Number.NaN;
      }
    },
  };
}

function containProgress(
  onProgress: ((phase: GateProgressPhase, transition?: TransitionIdentity) => void) | undefined
): (phase: GateProgressPhase, transition?: TransitionIdentity) => void {
  return (phase, transition) => {
    try {
      onProgress?.(phase, transition);
    } catch {
      // A reporting callback can never change what a transition does. In
      // particular it must not prevent the in-memory denial of ADR-0025 §14 step 1
      // or skip the durable fallback that follows it.
    }
  };
}

function containCapture(capture: CallbackCaptureCell): CallbackCaptureCell {
  return {
    initializeCallbackCapture: () => {
      try {
        return snapshotCallbackCandidate(capture.initializeCallbackCapture());
      } catch {
        // The same fail-closed shape the capture cell itself uses when the URL
        // cannot be read or cleaned: no exchange, no identity, no resolution.
        return { kind: "malformed_callback" };
      }
    },
    peekCallbackCandidate: () => {
      try {
        const candidate = capture.peekCallbackCandidate();
        return candidate === null ? null : snapshotCallbackCandidate(candidate);
      } catch {
        return null;
      }
    },
    claimCallbackForExchange: () => {
      try {
        const claim = capture.claimCallbackForExchange();
        if (readUntrustedProperty(claim, "kind") !== "claimed") return { kind: "no_claim" };
        const facade = containClaim(readUntrustedProperty(claim, "claim"));
        return facade === null ? { kind: "no_claim" } : { kind: "claimed", claim: facade };
      } catch {
        return { kind: "no_claim" };
      }
    },
    finalizeTerminalCallbackOutcome: () => {
      try {
        capture.finalizeTerminalCallbackOutcome();
      } catch {
        // Nothing further can be claimed from a cell that cannot be finalized, and
        // the transition's own outcome is unaffected.
      }
    },
  };
}

/**
 * A CLOSED FACADE over an issued claim — never the issued object itself.
 *
 * The authorization code cannot be copied: it lives inside a single-use closure,
 * and copying would either duplicate it or drop it. Everything around it can be,
 * and is. Handing the original object onward would leave three ways for an
 * accessor-backed, Proxy-backed or simply defective claim to misbehave at the
 * exchange boundary: `flowId` could read differently the second time than it did
 * when it was checked, `readAuthorizationCode` could be swapped between the
 * `typeof` check and the call, and a hostile `toJSON`, getter or trap could throw
 * inside a boundary whose contract is never to throw.
 *
 * So: both members are read **exactly once**, here. The selector that travels is a
 * plain string. The reader is invoked through the captured reference, with the
 * original object as its receiver, inside a `catch` — and **only once**, so the
 * single-use property of the real claim is preserved rather than re-implemented.
 * `toJSON` returns an empty object, so neither the code nor the selector can be
 * serialized into a log, an error, a snapshot or a report.
 *
 * `null` for any shape that cannot be used, which resolves `no_claim`: zero
 * provider calls, no identity, no resolution.
 */
function containClaim(issued: unknown): ClaimedCallback | null {
  const flowId = readUntrustedProperty(issued, "flowId");
  if (typeof flowId !== "string" || flowId.length === 0) return null;
  const reader = readUntrustedProperty(issued, "readAuthorizationCode");
  if (typeof reader !== "function") return null;
  const read = reader as (this: unknown) => unknown;

  let spent = false;
  return {
    flowId,
    readAuthorizationCode(): string | null {
      if (spent) return null;
      spent = true;
      try {
        const code = read.call(issued);
        return typeof code === "string" && code.length > 0 ? code : null;
      } catch {
        return null;
      }
    },
    toJSON: () => ({}),
  };
}

/** An inert copy carrying only the non-secret selector. An unrecognized shape
 * becomes `malformed_callback`: zero exchanges, no identity, no resolution. */
function snapshotCallbackCandidate(value: unknown): CallbackCandidate {
  const kind = readUntrustedProperty(value, "kind");
  if (kind === "no_return") return { kind: "no_return" };
  if (kind === "ambiguous_callback") return { kind: "ambiguous_callback" };
  if (kind === "success_candidate" || kind === "provider_error_candidate") {
    const flowId = readUntrustedProperty(value, "flowId");
    if (typeof flowId !== "string" || flowId.length === 0) return { kind: "malformed_callback" };
    return { kind, flowId };
  }
  return { kind: "malformed_callback" };
}

function containAuth(auth: AuthProviderMechanics): AuthProviderMechanics {
  const failedResult = <T>(): AuthServiceResult<T> =>
    authFailed<T>(normalizedAuthError("unexpected_error"));

  return {
    async restoreSession(): Promise<SessionRestoreOutcome> {
      try {
        const outcome = await auth.restoreSession();
        const kind = readUntrustedProperty(outcome, "kind");
        if (kind === "authenticated") {
          const identity = snapshotAccountIdentity(readUntrustedProperty(outcome, "identity"));
          // An `authenticated` outcome with no usable identity is not an identity.
          return identity === null ? { kind: "restore_failed" } : { kind: "authenticated", identity };
        }
        if (kind === "no_session") return { kind: "no_session" };
        if (kind === "temporarily_unavailable") return { kind: "temporarily_unavailable" };
        if (kind === "invalid_session") return { kind: "invalid_session" };
        // Includes `restore_failed` and every unrecognized variant. Fail closed:
        // `restore_failed` denies and retains trusted state without honouring it.
        return { kind: "restore_failed" };
      } catch {
        return { kind: "restore_failed" };
      }
    },
    onAuthChange(listener) {
      try {
        const unsubscribe = auth.onAuthChange(listener);
        return () => {
          try {
            if (typeof unsubscribe === "function") unsubscribe();
          } catch {
            // An idempotent, non-throwing unsubscribe is part of the contract; a
            // defective one must not propagate into React cleanup.
          }
        };
      } catch {
        return () => {};
      }
    },
    async requestEmailOtp(email: string): Promise<AuthServiceResult<void>> {
      try {
        return snapshotVoidAuthResult(await auth.requestEmailOtp(email));
      } catch {
        return failedResult<void>();
      }
    },
    async verifyEmailOtp(email: string, token: string): Promise<AuthServiceResult<AccountIdentity>> {
      try {
        const result = await auth.verifyEmailOtp(email, token);
        if (readUntrustedProperty(result, "ok") === true) {
          const identity = snapshotAccountIdentity(readUntrustedProperty(result, "value"));
          return identity === null ? failedResult<AccountIdentity>() : { ok: true, value: identity };
        }
        return snapshotAuthFailure<AccountIdentity>(result);
      } catch {
        return failedResult<AccountIdentity>();
      }
    },
    async signOut(): Promise<AuthServiceResult<void>> {
      try {
        // A provider sign-out failure never weakens the durable local denial: the
        // barrier, not the provider call, is the latch.
        return snapshotVoidAuthResult(await auth.signOut());
      } catch {
        return failedResult<void>();
      }
    },
    async prepareGoogleSignIn(redirectTo: string): Promise<PrepareAuthorizationOutcome> {
      try {
        const outcome = await auth.prepareGoogleSignIn(redirectTo);
        const kind = readUntrustedProperty(outcome, "kind");
        if (kind === "prepared") {
          const prepared = readUntrustedProperty(outcome, "prepared");
          const flowId = readUntrustedProperty(prepared, "flowId");
          const authorizationUrl = readUntrustedProperty(prepared, "authorizationUrl");
          if (typeof flowId !== "string" || typeof authorizationUrl !== "string") {
            return { kind: "preparation_failed" };
          }
          // Inert: the selector and URL that travel onward are the ones read here,
          // not whatever a later read of the original object would produce.
          return { kind: "prepared", prepared: { authorizationUrl, flowId } };
        }
        if (kind === "invalid_redirect") return { kind: "invalid_redirect" };
        if (kind === "flow_selector_unavailable") return { kind: "flow_selector_unavailable" };
        if (kind === "temporarily_unavailable") return { kind: "temporarily_unavailable" };
        return { kind: "preparation_failed" };
      } catch {
        return { kind: "preparation_failed" };
      }
    },
    navigateToAuthorizationUrl(prepared): NavigationOutcome {
      try {
        const outcome = auth.navigateToAuthorizationUrl(prepared);
        return readUntrustedProperty(outcome, "kind") === "navigating"
          ? { kind: "navigating" }
          : { kind: "navigation_failed" };
      } catch {
        return { kind: "navigation_failed" };
      }
    },
    async exchangeCorrelatedCallback(claim, expectedFlowId): Promise<ExchangeOutcome> {
      try {
        const outcome = await auth.exchangeCorrelatedCallback(claim, expectedFlowId);
        const kind = readUntrustedProperty(outcome, "kind");
        if (kind === "exchanged") {
          const identity = snapshotAccountIdentity(readUntrustedProperty(outcome, "identity"));
          return identity === null ? { kind: "exchange_failed" } : { kind: "exchanged", identity };
        }
        if (kind === "selector_mismatch") return { kind: "selector_mismatch" };
        if (kind === "temporarily_unavailable") return { kind: "temporarily_unavailable" };
        return { kind: "exchange_failed" };
      } catch {
        return { kind: "exchange_failed" };
      }
    },
  };
}

/** The closed set of normalized provider error kinds. An unrecognized kind is
 * never forwarded — it becomes `unexpected_error`. */
const NORMALIZED_AUTH_ERROR_KINDS = new Set<NormalizedAuthErrorKind>([
  "invalid_input",
  "request_failed",
  "verification_failed",
  "session_restore_failed",
  "sign_out_failed",
  "invalid_configuration",
  "temporarily_unavailable",
  "unexpected_error",
]);

/** Rebuilds a failure from its validated KIND alone, so the provider's own error
 * object — and any message it carries — never travels onward. */
function snapshotAuthFailure<T>(result: unknown): AuthServiceResult<T> {
  const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
  const known =
    typeof kind === "string" && NORMALIZED_AUTH_ERROR_KINDS.has(kind as NormalizedAuthErrorKind)
      ? (kind as NormalizedAuthErrorKind)
      : "unexpected_error";
  return authFailed<T>(normalizedAuthError(known));
}

function snapshotVoidAuthResult(result: unknown): AuthServiceResult<void> {
  return readUntrustedProperty(result, "ok") === true
    ? { ok: true, value: undefined }
    : snapshotAuthFailure<void>(result);
}

/** An inert copy, read once. `null` when the value is not a usable identity. */
function snapshotAccountIdentity(value: unknown): AccountIdentity | null {
  const accountScopeId = readUntrustedProperty(value, "accountScopeId");
  if (typeof accountScopeId !== "string" || accountScopeId.length === 0) return null;
  const email = readUntrustedProperty(value, "email");
  if (email !== null && typeof email !== "string") return null;
  return { accountScopeId, email };
}

function containIdentityService(service: IdentityService): IdentityService {
  /**
   * Runs one operation and returns a fully validated, INERT copy of its payload.
   *
   * Checking only `ok` and then returning the original result would let accessors,
   * Proxies, malformed nested data and values that change between reads escape the
   * boundary. Anything that cannot be copied cleanly becomes `unexpected_error`,
   * which is deliberately NOT a definitive negative — a malformed or hostile
   * "success" must fail closed as unconfirmed, never as the server saying no.
   */
  const contained = async <T>(
    operation: () => Promise<IdentityResult<T>>,
    snapshot: (value: unknown) => T | null
  ): Promise<IdentityResult<T>> => {
    try {
      const result = await operation();
      const ok = readUntrustedProperty(result, "ok");
      if (ok === true) {
        const copied = snapshot(readUntrustedProperty(result, "value"));
        return copied === null ? identityFailed<T>("unexpected_error") : identityOk(copied);
      }
      if (ok === false) {
        const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
        return typeof kind === "string" && IDENTITY_ERROR_KINDS.has(kind as IdentityErrorKind)
          ? identityFailed<T>(kind as IdentityErrorKind)
          : identityFailed<T>("unexpected_error");
      }
      return identityFailed<T>("unexpected_error");
    } catch {
      return identityFailed<T>("unexpected_error");
    }
  };
  return {
    getLegalSnapshot: () => contained(() => service.getLegalSnapshot(), snapshotLegalSnapshot),
    ensureProfile: () => contained(() => service.ensureProfile(), snapshotBareProfile),
    resolveGateFacts: () => contained(() => service.resolveGateFacts(), snapshotGateFacts),
    completeOnboarding: (input) =>
      contained(() => service.completeOnboarding(input), snapshotGateFacts),
  };
}

/** The closed set of identity failure kinds. An unrecognized kind is never
 * forwarded — and in particular can never become a definitive negative. */
const IDENTITY_ERROR_KINDS = new Set<IdentityErrorKind>([
  "forbidden",
  "profile_required",
  "invalid_input",
  "legal_unavailable",
  "stale_legal_version",
  "conflict",
  "invalid_legal_response",
  "invalid_response",
  "network_error",
  "unexpected_error",
]);

function snapshotBareProfile(value: unknown): BareProfile | null {
  const profileId = readUntrustedProperty(value, "profileId");
  if (!isCanonicalUuid(profileId)) return null;
  const displayName = readUntrustedProperty(value, "displayName");
  if (displayName !== null && !isValidDisplayName(displayName)) return null;
  return { profileId, displayName };
}

function snapshotPinnedEvidence(value: unknown): PinnedLegalEvidence | null | "invalid" {
  if (value === null) return null;
  const acceptanceId = readUntrustedProperty(value, "acceptanceId");
  const documentId = readUntrustedProperty(value, "documentId");
  const versionLabel = readUntrustedProperty(value, "versionLabel");
  const actedAt = readUntrustedProperty(value, "actedAt");
  if (!isCanonicalUuid(acceptanceId) || !isCanonicalUuid(documentId)) return "invalid";
  if (!isValidLegalVersionLabel(versionLabel)) return "invalid";
  if (!isValidTimestamp(actedAt)) return "invalid";
  return { acceptanceId, documentId, versionLabel, actedAt };
}

/** Sentinel for "this field is unusable", distinct from a legitimate `null`. */
const REJECT = Symbol("reject");

function nullableUuidOrReject(source: unknown, key: string): string | null | typeof REJECT {
  const value = readUntrustedProperty(source, key);
  if (value === null) return null;
  return isCanonicalUuid(value) ? value : REJECT;
}

/** A `current_*` reporting label, held to the SAME committed
 * `legal_documents.version_label` contract as pinned evidence and the Legal
 * parser. It is still a real row's label, so an impossible one is a response this
 * application cannot be describing. */
function nullableVersionLabelOrReject(
  source: unknown,
  key: string
): string | null | typeof REJECT {
  const value = readUntrustedProperty(source, key);
  if (value === null) return null;
  return isValidLegalVersionLabel(value) ? value : REJECT;
}

function snapshotGateFacts(value: unknown): GateFacts | null {
  const profileId = readUntrustedProperty(value, "profileId");
  if (profileId !== null && !isCanonicalUuid(profileId)) return null;
  const displayName = readUntrustedProperty(value, "displayName");
  if (displayName !== null && !isValidDisplayName(displayName)) return null;
  const onboardingCompletedAt = readUntrustedProperty(value, "onboardingCompletedAt");
  if (onboardingCompletedAt !== null && !isValidTimestamp(onboardingCompletedAt)) return null;

  const hasAthleteCapability = readUntrustedProperty(value, "hasAthleteCapability");
  const freeEntitlementActive = readUntrustedProperty(value, "freeEntitlementActive");
  if (typeof hasAthleteCapability !== "boolean" || typeof freeEntitlementActive !== "boolean") {
    return null;
  }

  const pinnedTerms = snapshotPinnedEvidence(readUntrustedProperty(value, "pinnedTerms"));
  const pinnedPrivacy = snapshotPinnedEvidence(readUntrustedProperty(value, "pinnedPrivacy"));
  if (pinnedTerms === "invalid" || pinnedPrivacy === "invalid") return null;

  const currentTermsDocumentId = nullableUuidOrReject(value, "currentTermsDocumentId");
  const currentPrivacyDocumentId = nullableUuidOrReject(value, "currentPrivacyDocumentId");
  const currentTermsVersionLabel = nullableVersionLabelOrReject(value, "currentTermsVersionLabel");
  const currentPrivacyVersionLabel = nullableVersionLabelOrReject(value, "currentPrivacyVersionLabel");
  if (
    currentTermsDocumentId === REJECT ||
    currentPrivacyDocumentId === REJECT ||
    currentTermsVersionLabel === REJECT ||
    currentPrivacyVersionLabel === REJECT
  ) {
    return null;
  }

  // -------------------------------------------------------------------------
  // SERVER/DOMAIN COHERENCE, RE-CHECKED HERE.
  //
  // The Supabase boundary enforces exactly these rules against the raw RPC row.
  // Enforcing them again here is not redundancy for its own sake: this snapshot
  // stands between the coordinator and an INJECTED `IdentityService`, which may be
  // a different implementation, a test double, or a future boundary with a defect.
  // A payload that violates any of them is not a state this application can be in,
  // so it fails closed as `unexpected_error` — deliberately NOT a definitive server
  // negative, because a malformed success must never be read as the server saying
  // no.
  // -------------------------------------------------------------------------
  const completed = onboardingCompletedAt !== null;
  const hasBothEvidence = pinnedTerms !== null && pinnedPrivacy !== null;
  const hasNoEvidence = pinnedTerms === null && pinnedPrivacy === null;

  // Completion and its justifying evidence are established in one transaction, so
  // they exist together or not at all. A partial group is corruption, not "no
  // evidence".
  if (completed && !hasBothEvidence) return null;
  if (!completed && !hasNoEvidence) return null;

  // Onboarding completion is the SOLE grant source for Athlete capability and the
  // Free entitlement, so neither can precede it.
  if (!completed && (hasAthleteCapability || freeEntitlementActive)) return null;

  // Nothing is derived from a Profile that does not exist. Note the `current_*`
  // reporting pair is deliberately excluded: it describes the documents that are
  // current server-wide and is not derived from any Profile.
  if (profileId === null) {
    if (
      completed ||
      displayName !== null ||
      hasAthleteCapability ||
      freeEntitlementActive ||
      !hasNoEvidence
    ) {
      return null;
    }
  }

  // Each `current_*` id/label pair is coherent as a whole: both null, or both
  // valid. An id with no label, and a label with no id, are equally inconsistent —
  // and validating the two fields independently, as this snapshot previously did,
  // accepts both.
  if ((currentTermsDocumentId === null) !== (currentTermsVersionLabel === null)) return null;
  if ((currentPrivacyDocumentId === null) !== (currentPrivacyVersionLabel === null)) return null;

  return {
    profileId,
    displayName,
    onboardingCompletedAt,
    hasAthleteCapability,
    freeEntitlementActive,
    pinnedTerms,
    pinnedPrivacy,
    currentTermsDocumentId,
    currentTermsVersionLabel,
    currentPrivacyDocumentId,
    currentPrivacyVersionLabel,
  };
}

function snapshotLegalDocument<K extends "terms_of_service" | "privacy_notice">(
  value: unknown,
  kind: K
): SafeLegalDocument<K> | null | "invalid" {
  if (value === null) return null;
  const id = readUntrustedProperty(value, "id");
  if (!isCanonicalUuid(id)) return "invalid";
  if (readUntrustedProperty(value, "kind") !== kind) return "invalid";
  const versionLabel = readUntrustedProperty(value, "versionLabel");
  if (!isValidLegalVersionLabel(versionLabel)) return "invalid";
  // Re-parsed rather than trusted: the brand is compile-time only, so an `href`
  // that reached here through a cast is validated again before it can be rendered.
  const href = parseSafeLegalUrl(readUntrustedProperty(value, "href"));
  if (href === null) return "invalid";
  const effectiveAt = readUntrustedProperty(value, "effectiveAt");
  if (!isValidTimestamp(effectiveAt)) return "invalid";
  return { id: id as LegalDocumentId, kind, versionLabel, href, effectiveAt };
}

function snapshotLegalSnapshot(value: unknown): LegalSnapshot | null {
  const terms = snapshotLegalDocument(readUntrustedProperty(value, "terms"), "terms_of_service");
  if (terms === "invalid") return null;
  const privacy = snapshotLegalDocument(readUntrustedProperty(value, "privacy"), "privacy_notice");
  if (privacy === "invalid") return null;
  // An actual parseable timestamp, not merely a non-empty string. The value comes
  // from a clock this module does not own, and a contained clock that threw
  // substitutes an unusable value — which must fail closed here rather than travel
  // into a snapshot a caller may reason about staleness with.
  const fetchedAt = readUntrustedProperty(value, "fetchedAt");
  if (!isValidTimestamp(fetchedAt)) return null;
  return { terms, privacy, fetchedAt };
}

/** Repository containment. Each substitute is the value that repository's own
 * failure path already produces, so a throwing repository is indistinguishable
 * from an unreadable or unwritable one — never from a successful one. */
function containBarriers(repository: IdentityBarrierRepository): IdentityBarrierRepository {
  return {
    load: () => guardLoad(() => repository.load(), validateIdentityAccessBarrier),
    save: (barrier) => guardWrite(() => repository.save(barrier)),
  };
}

function containAttempts(repository: InteractiveAttemptRepository): InteractiveAttemptRepository {
  return {
    load: () => guardLoad(() => repository.load(), validateInteractiveAuthAttempt),
    save: (attempt) => guardWrite(() => repository.save(attempt)),
    cleanUpNonCurrentAttempt: async (currentBarrierId) => {
      try {
        const outcome = await repository.cleanUpNonCurrentAttempt(currentBarrierId);
        const kind = readUntrustedProperty(outcome, "kind");
        // An unrecognized kind is never read as a completed cleanup.
        return kind === "removed" || kind === "nothing_to_clean" || kind === "retained_current"
          ? { kind }
          : { kind: "cleanup_failed" };
      } catch {
        return { kind: "cleanup_failed" };
      }
    },
  };
}

function containResolutions(
  repository: IdentityBarrierResolutionRepository
): IdentityBarrierResolutionRepository {
  return {
    loadForBarrier: (barrierId) =>
      guardLoad(() => repository.loadForBarrier(barrierId), (raw) => {
        const validated = validateIdentityBarrierResolution(raw);
        // The record must also name the barrier it was asked about.
        return validated !== null && validated.barrierId === barrierId ? validated : null;
      }),
    saveForBarrier: (resolution) => guardWrite(() => repository.saveForBarrier(resolution)),
    retractUnconfirmedResolution: (barrierId) =>
      guardRemove(() => repository.retractUnconfirmedResolution(barrierId)),
    cleanUpNonCurrentResolution: async (barrierId, currentBarrierId) => {
      try {
        const outcome = await repository.cleanUpNonCurrentResolution(barrierId, currentBarrierId);
        const kind = readUntrustedProperty(outcome, "kind");
        return kind === "removed" || kind === "retained_current" || kind === "not_addressable"
          ? { kind }
          : { kind: "cleanup_failed" };
      } catch {
        return { kind: "cleanup_failed" };
      }
    },
  };
}

function containTrusted(repository: TrustedDeviceRepository): TrustedDeviceRepository {
  return {
    load: () => guardLoad(() => repository.load(), validateTrustedDeviceRecord),
    save: (record) => guardWrite(() => repository.save(record)),
    remove: () => guardRemove(() => repository.remove()),
  };
}

function containIntents(repository: PendingIntentRepository): PendingIntentRepository {
  const guardMutation = async (
    operation: () => Promise<IntentMutationOutcome>
  ): Promise<IntentMutationOutcome> => {
    try {
      const outcome = await operation();
      const kind = readUntrustedProperty(outcome, "kind");
      // `blocked` is the fail-closed value, and it is also what an UNRECOGNIZED
      // kind becomes: a required intent mutation that cannot be proven stops the
      // transition rather than being read as a success.
      return kind === "applied" || kind === "not_required" || kind === "superseded"
        ? { kind }
        : { kind: "blocked" };
    } catch {
      return { kind: "blocked" };
    }
  };
  return {
    load: () => guardLoad(() => repository.load(), validatePendingIntent),
    save: (intent) => guardWrite(() => repository.save(intent)),
    deleteIntent: () => guardRemove(() => repository.deleteIntent()),
    clearOutstandingDenialCleanup: () =>
      guardRemove(() => repository.clearOutstandingDenialCleanup()),
    deleteOrdinaryIntents: () => guardMutation(() => repository.deleteOrdinaryIntents()),
    markInvitationForRecovery: (intent) => guardWrite(() => repository.markInvitationForRecovery(intent)),
    deleteOtherOrdinaryIntents: (value) => guardMutation(() => repository.deleteOtherOrdinaryIntents(value)),
    recordOutstandingDenialCleanup: (recordedAt) =>
      guardMutation(() => repository.recordOutstandingDenialCleanup(recordedAt)),
    settleIntentBeforeReady: (canProceed) =>
      guardMutation(() => repository.settleIntentBeforeReady(canProceed)),
  };
}

/**
 * Contains one record read AND rebuilds its payload.
 *
 * `validate` is the record type's own validator, so a loaded value is re-checked
 * and copied into inert plain data here. Returning the repository's original
 * object after checking only `status` would let an accessor-backed or Proxy-backed
 * record — one whose fields differ on a second read — reach correlation checks.
 */
async function guardLoad<T>(
  operation: () => Promise<IdentityRecordLoad<T>>,
  validate: (raw: unknown) => T | null
): Promise<IdentityRecordLoad<T>> {
  const unreadable: IdentityRecordLoad<T> = { status: "read_failed", error: { kind: "unknown" } };
  try {
    const result = await operation();
    const status = readUntrustedProperty(result, "status");
    if (status === "absent") return { status: "absent" };
    if (status === "malformed") return { status: "malformed" };
    if (status === "read_failed") {
      const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
      return { status: "read_failed", error: { kind: kind === "storage_unavailable" ? "storage_unavailable" : "unknown" } };
    }
    if (status !== "value") return unreadable;
    let snapshot: T | null;
    try {
      snapshot = validate(readUntrustedProperty(result, "value"));
    } catch {
      return { status: "malformed" };
    }
    return snapshot === null ? { status: "malformed" } : { status: "value", value: snapshot };
  } catch {
    return unreadable;
  }
}

async function guardWrite(
  operation: () => Promise<PersistenceWriteResult>
): Promise<PersistenceWriteResult> {
  const failure: PersistenceWriteResult = {
    ok: false,
    error: { kind: "unknown", message: "The record could not be stored." },
  };
  try {
    const result = await operation();
    if (readUntrustedProperty(result, "ok") === true) return { ok: true };
    const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
    if (kind === "storage_unavailable") return { ok: false, error: { kind: "storage_unavailable" } };
    if (kind === "quota_exceeded") return { ok: false, error: { kind: "quota_exceeded" } };
    // Includes every unrecognized shape: never read as a success.
    return failure;
  } catch {
    return failure;
  }
}

async function guardRemove(
  operation: () => Promise<PersistenceRemoveResult>
): Promise<PersistenceRemoveResult> {
  const failure: PersistenceRemoveResult = {
    ok: false,
    error: { kind: "removal_failed", message: "The record could not be removed." },
  };
  try {
    const result = await operation();
    if (readUntrustedProperty(result, "ok") === true) return { ok: true };
    const kind = readUntrustedProperty(readUntrustedProperty(result, "error"), "kind");
    if (kind === "storage_unavailable") return { ok: false, error: { kind: "storage_unavailable" } };
    return failure;
  } catch {
    return failure;
  }
}

export function createIdentityTransitionCoordinator(
  deps: IdentityCoordinatorDeps
): IdentityTransitionCoordinator {
  // Every dependency is used through its contained wrapper, never directly. See the
  // containment section above for why each substitute value is the deny-ward one.
  const auth = containAuth(deps.auth);
  const identityService = containIdentityService(deps.identity);
  const capture = containCapture(deps.capture);
  const barriers = containBarriers(deps.barriers);
  const attempts = containAttempts(deps.attempts);
  const resolutions = containResolutions(deps.resolutions);
  const trusted = containTrusted(deps.trusted);
  const intents = containIntents(deps.intents);
  const liveGeneration = containLiveGeneration(deps.liveGeneration);
  const now = containClock(deps.now);
  const newId = containIdSource(deps.newId);
  const resolveRedirectTarget = containRedirectResolver(deps.resolveRedirectTarget);
  const emitProgress = containProgress(deps.onProgress);
  /**
   * Announces a phase, tagged with the announcing operation's identity and order.
   *
   * **A superseded operation announces nothing.** A phase is an authoritative
   * statement about what the gate is currently doing, so letting an overtaken
   * operation emit one would let it re-tag the reducer with its own — now stale —
   * identity, and the newer operation's own result would then fail the correlation
   * proof. The one deliberate exception is a phase with no operation at all
   * (`identity_denied_in_memory` and the deliberate-transition phases announced
   * before a context exists): those are either deny-ward or belong to the operation
   * that is in the act of claiming ownership.
   */
  const progress = (phase: GateProgressPhase, context?: TransitionContext): void => {
    if (context !== undefined && !ownsOperation(context)) return;
    emitProgress(phase, context === undefined ? undefined : identityOf(context));
  };

  /** The barrier this page last established or observed, for cross-tab change
   * detection. In-memory and page-scoped: never authority for anything. */
  let lastKnownBarrierId: string | null = null;

  /**
   * PAGE-LIFETIME OWNERSHIP OF THE COORDINATOR'S AUTHORITATIVE OPERATION SLOT.
   *
   * The durable barrier/attempt/resolution protocol (ADR-0025 §5-§8) and the live
   * generation (§9) each keep their own role, unchanged. Neither of them, though,
   * can order two operations that share the same barrier, the same attempt and the
   * same live generation — two concurrent verifications of one OTP attempt, for
   * instance, or a background revalidation overlapping a retry. Both would satisfy
   * every checkpoint simultaneously, and both could go on to write trusted state
   * and return ready.
   *
   * So the coordinator also keeps an explicit ORDER. Every operation that can
   * produce, refresh or revoke access takes a strictly increasing sequence and
   * becomes the owner; starting a newer one supersedes every older one immediately,
   * with no storage read and no dependence on anything durable. An operation that
   * is no longer the owner may not announce a phase, may not write or replace
   * trusted state, may not mutate intent state, and may not return ready.
   *
   * This is in-memory and page-scoped. It is deliberately NOT durable authority:
   * it orders the operations of one page lifetime and nothing else. Cross-reload
   * and cross-tab ordering remain exactly what §8 says they are.
   */
  let operationCounter = 0;
  let owningOperationSequence = 0;

  // -----------------------------------------------------------------------
  // THE EFFECT LANE — one page-lifetime critical section, and the mechanism that
  // makes the ownership contract true for ASYNCHRONOUS dependencies.
  //
  // Ownership alone is a synchronous fact checked at one instant. Every durable
  // mutation, though, is a read → decide → write sequence across awaits supplied by
  // an INJECTED adapter. Today's `localStorage` adapter happens to resolve
  // promptly; a future IndexedDB or network adapter will not, and a defective one
  // may resolve arbitrarily late. Without serialization an older operation's
  // check-and-write can interleave with a newer operation's, and the older write
  // can land LAST — leaving the newer operation's barrier, trusted record or intent
  // state overwritten by a superseded operation.
  //
  // So every durable mutation, and every read that guards one, runs inside a
  // section on ONE lane. Two properties follow, and neither depends on microtask
  // timing:
  //
  //  1. **Sections never interleave.** A section's read → decide → write window is
  //     closed against every other section, whatever the adapter's latency. Write
  //     order equals section-entry order, which is fixed synchronously at the
  //     moment `inSection` is called.
  //  2. **Ownership is re-proved INSIDE the section**, after the lane admits it —
  //     so an operation that lost ownership while queued does not act at all.
  //
  // What this deliberately does NOT claim: `beginTransition` is synchronous and
  // outside the lane, so a newer operation can still claim ownership while an older
  // section is mid-write. Ordinary effects remain ordered because the newer
  // operation's writes queue behind the older section. Grant-bearing writes add a
  // post-write ownership/proof check and an unresolved fence (or compensating
  // removal), so that window cannot survive as a reload-capable stale grant.
  // -----------------------------------------------------------------------
  let effectLane: Promise<void> = Promise.resolve();

  /**
   * Runs `work` as the only section on the lane.
   *
   * The lane is advanced SYNCHRONOUSLY at call time, so section order is the order
   * these calls are made — never a function of how promises happen to be scheduled.
   * `work` is the coordinator's own contained code and never rejects, but the
   * release is in a `finally` so a defect could not wedge the lane permanently.
   */
  async function inSection<T>(work: () => Promise<T>): Promise<T> {
    const previous = effectLane;
    let release: () => void = () => {};
    effectLane = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  /**
   * A section that runs `work` only if `context` still owns the operation slot at
   * the moment the lane admits it; otherwise it resolves `superseded` having
   * performed **no** read and **no** write.
   */
  async function inOwnedSection<T>(
    context: TransitionContext,
    superseded: T,
    work: () => Promise<T>
  ): Promise<T> {
    return inSection(async () => (ownsOperation(context) ? work() : superseded));
  }

  /**
   * One coordinator operation.
   *
   * `id` and `sequence` are the reducer-facing identity and order. `epoch`,
   * `barrierId` and `attemptId` are what `stillCurrent` re-proves against durable
   * state after every await that could have let a newer transition become current.
   */
  type TransitionContext = {
    id: string;
    sequence: number;
    mode: "foreground" | "background";
    epoch: number;
    barrierId: string | null;
    attemptId: string | null;
  };

  function identityOf(context: TransitionContext): TransitionIdentity {
    return { id: context.id, sequence: context.sequence, mode: context.mode };
  }

  /** Synchronous, storage-free, and true for at most one operation at a time. */
  function ownsOperation(context: TransitionContext): boolean {
    return context.sequence === owningOperationSequence;
  }

  /**
   * Claims ownership for a new operation, superseding whatever held it.
   *
   * Called by every operation that can produce, refresh or revoke access.
   * `refreshLegalSnapshot`, `capturePendingIntent`, `discardPendingIntent` and `classifyAuthChange`
   * deliberately do NOT claim it: none of them can change access, and superseding a
   * sign-in because a Legal snapshot was refetched would be a defect.
   */
  function beginTransition(options?: {
    binding?: { barrierId: string; attemptId: string | null };
    mode?: "foreground" | "background";
  }): TransitionContext {
    operationCounter += 1;
    owningOperationSequence = operationCounter;
    return {
      id: `transition-${operationCounter}`,
      sequence: operationCounter,
      mode: options?.mode ?? "foreground",
      epoch: liveGeneration.current(),
      barrierId: options?.binding?.barrierId ?? null,
      attemptId: options?.binding?.attemptId ?? null,
    };
  }

  /** Annotates a result with the operation that produced it, and — for a
   * server-driven invalidation — with the denial it carries. */
  function annotate<T>(
    outcome: T,
    context: TransitionContext,
    denial?: DenialMarker
  ): T & TransitionAnnotation {
    return denial === undefined
      ? { ...outcome, transition: identityOf(context) }
      : { ...outcome, transition: identityOf(context), denial };
  }

  /**
   * Re-proves that the operation described by `context` is still the current one.
   *
   * THREE independent things are re-proved, and each closes a hazard the others
   * cannot. Ownership orders operations that share everything durable. The live
   * epoch catches a barrier established anywhere in this page lifetime. The
   * checkpoint catches a newer barrier or attempt written by ANOTHER tab, which
   * neither in-memory value can see.
   *
   * C7 establishes that the exact barrier, attempt and generation were current at
   * the moment the resolution was written — but several awaits follow it: loading
   * trusted state, writing it, settling intent state. A newer operation can become
   * current during ANY of them, and the older one must not then write or replace
   * trusted state, mutate newer intent state, or return ready.
   */
  async function stillCurrent(context: TransitionContext): Promise<boolean> {
    if (!ownsOperation(context)) return false;
    if (liveGeneration.current() !== context.epoch) return false;
    if (context.barrierId === null) return true;
    const check = await checkpoint({
      barrierId: context.barrierId,
      attemptId: context.attemptId ?? undefined,
      generation: context.epoch,
    });
    if (!check.ok) return false;
    // RE-CHECKED AFTER THE AWAIT. The checkpoint above is asynchronous, so a newer
    // operation can have claimed the slot while it was in flight; a proof that only
    // held before the read would be a proof about the past.
    return ownsOperation(context) && liveGeneration.current() === context.epoch;
  }

  /**
   * `null` when the operation is still current; otherwise the verdict to emit
   * instead of anything that could open the gate.
   *
   * Runs as its own section, so the proof is not interleaved with another
   * operation's mutation. Callers that need proof-and-effect to be indivisible run
   * `stillCurrent` INSIDE their own section instead — see `writeTrustedSection`.
   */
  async function guardStillCurrent(context: TransitionContext): Promise<GateVerdict | null> {
    const current = await inSection(() => stillCurrent(context));
    return current ? null : { kind: "identity_unconfirmed" };
  }

  async function loadDurableSnapshot(): Promise<DurableCorrelationSnapshot> {
    return inSection(loadDurableSnapshotUnlocked);
  }

  async function loadDurableSnapshotUnlocked(): Promise<DurableCorrelationSnapshot> {
    const barrier = await barriers.load();
    const attempt = await attempts.load();
    const resolution =
      barrier.status === "value" ? await resolutions.loadForBarrier(barrier.value.barrierId) : null;
    if (barrier.status === "value") lastKnownBarrierId = barrier.value.barrierId;
    return { barrier, attempt, resolution };
  }

  // -----------------------------------------------------------------------
  // Barrier establishment — step 1 of every deliberate transition
  // -----------------------------------------------------------------------

  /**
   * Durably installs a fresh unresolved barrier with a NEW `barrierId`.
   *
   * `origin: "deliberate_authentication"` resolves to `interactive_authentication`
   * when no barrier exists and `locked_screen_recovery` when one does — valid,
   * malformed or unreadable alike (ADR-0025 §5.2a). From a VALID old barrier only
   * the validated `barredAccountScopeId`/`barredGeneration` are preserved; **its
   * `barrierId` never is**, and from an unreadable one both are `null` — no
   * account id and no generation is invented.
   *
   * On success the live generation is bumped, which invalidates every in-flight
   * operation's captured epoch, and the PREVIOUS barrier's resolution is cleaned up
   * best-effort. The cleanup runs strictly after the new barrier is durably
   * written, so it can only ever touch an already non-current record, and its
   * failure changes nothing.
   */
  type BarrierEstablished =
    | { ok: true; barrier: IdentityAccessBarrier }
    | { ok: false; superseded: boolean };

  /**
   * Durably installs a fresh unresolved barrier — as ONE section, bound to ONE
   * operation.
   *
   * `context` is what makes the ADR's "a newer operation supersedes an older one
   * immediately" true here. Without it, an older operation whose adapter resolved
   * late could write its barrier AFTER a newer operation wrote its own, replacing a
   * newer latch with an older one and rebasing the live generation underneath the
   * newer transition. The read of the previous barrier, the write, the generation
   * bump and the non-current cleanup all happen inside the section, so no other
   * section can observe or interleave with the intermediate state.
   *
   * `unconditional` is used by, and only by, a server-driven invalidation that has
   * already begun: once the in-memory denial has been announced the transition must
   * complete, and a denial is deny-ward whoever else has started since (§14).
   */
  async function establishBarrier(
    context: TransitionContext,
    input: {
      origin: IdentityBarrierOrigin | "deliberate_authentication";
      barredAccountScopeId?: string | null;
      unconditional?: boolean;
    }
  ): Promise<BarrierEstablished> {
    return inSection(async () => {
      if (input.unconditional !== true && !ownsOperation(context)) {
        return { ok: false, superseded: true };
      }
      return establishBarrierUnlocked(input);
    });
  }

  async function establishBarrierUnlocked(input: {
    origin: IdentityBarrierOrigin | "deliberate_authentication";
    barredAccountScopeId?: string | null;
  }): Promise<BarrierEstablished> {
    const previous = await barriers.load();
    const previousBarrier = previous.status === "value" ? previous.value : null;

    const origin: IdentityBarrierOrigin =
      input.origin === "deliberate_authentication"
        ? previous.status === "absent"
          ? "interactive_authentication"
          : "locked_screen_recovery"
        : input.origin;

    const barrier = createIdentityAccessBarrier({
      barrierId: newId(),
      origin,
      barredAccountScopeId:
        input.barredAccountScopeId !== undefined
          ? input.barredAccountScopeId
          : (previousBarrier?.barredAccountScopeId ?? null),
      barredGeneration: previousBarrier?.barredGeneration ?? null,
      establishedAt: now(),
    });

    const written = await barriers.save(barrier);
    if (!written.ok) return { ok: false, superseded: false };

    liveGeneration.bump();
    lastKnownBarrierId = barrier.barrierId;

    if (previousBarrier !== null && previousBarrier.barrierId !== barrier.barrierId) {
      // Best-effort, and only ever for a record that is already non-current. The
      // repository itself refuses to remove the current barrier's resolution, so
      // this cannot become a security transition by accident.
      await resolutions.cleanUpNonCurrentResolution(previousBarrier.barrierId, barrier.barrierId);
    }

    return { ok: true, barrier };
  }

  /**
   * Retracts a grant-bearing write that completed but is no longer confirmable —
   * either because its operation lost ownership or because C7 failed. The fresh
   * unresolved barrier is installed before the effect lane
   * is released, so a newer same-page operation can never observe the stale grant
   * as the current durable correlation. It also invalidates the newer operation's
   * captured epoch, forcing an explicit retry instead of silently composing two
   * transitions.
   */
  async function fenceUnconfirmedGrantUnlocked(): Promise<boolean> {
    const fenced = await establishBarrierUnlocked({ origin: "unconfirmed_grant_fence" });
    return fenced.ok;
  }

  // -----------------------------------------------------------------------
  // Checkpoints
  // -----------------------------------------------------------------------

  type CheckpointOk = {
    ok: true;
    barrier: IdentityAccessBarrier;
    attempt: InteractiveAuthAttempt | null;
  };

  /**
   * One named checkpoint: the live epoch must be unchanged, the current barrier
   * must still be exactly the expected one, and — when an attempt id is supplied —
   * the current attempt must still be exactly that attempt, bound to that barrier.
   *
   * `attemptId` is omitted at C1 (before the attempt exists) and at C8a/C8b (where
   * no attempt is in play).
   */
  async function checkpoint(expected: {
    barrierId: string;
    attemptId?: string;
    generation: number;
  }): Promise<CheckpointOk | { ok: false }> {
    if (liveGeneration.current() !== expected.generation) return { ok: false };

    const loaded = await barriers.load();
    if (loaded.status !== "value") return { ok: false };
    if (loaded.value.barrierId !== expected.barrierId) return { ok: false };

    if (expected.attemptId === undefined) {
      return { ok: true, barrier: loaded.value, attempt: null };
    }

    const attemptLoad = await attempts.load();
    if (attemptLoad.status !== "value") return { ok: false };
    if (attemptLoad.value.attemptId !== expected.attemptId) return { ok: false };
    if (attemptLoad.value.barrierId !== expected.barrierId) return { ok: false };

    return { ok: true, barrier: loaded.value, attempt: attemptLoad.value };
  }

  /**
   * A named checkpoint as its own section, with ownership proved on both sides of
   * the read.
   *
   * Used at the standalone checkpoints — C1, C2, C3, C4, C6, C8a. The reads are
   * closed against every other operation's writes, so a checkpoint never judges a
   * half-applied mutation, and an operation that was overtaken while the reads were
   * in flight fails the checkpoint rather than proceeding on a proof about the past.
   */
  type CheckpointProof =
    | CheckpointOk
    | { ok: false; reason: "superseded" | "correlation_changed" };

  async function proveCheckpoint(
    context: TransitionContext,
    expected: { barrierId: string; attemptId?: string; generation: number }
  ): Promise<CheckpointProof> {
    return inSection<CheckpointProof>(async () => {
      // Ownership is proved on BOTH sides of the read, and the two failures are
      // reported distinctly: "a newer operation took over" and "the durable
      // correlation moved" are different facts, and collapsing them would make an
      // overtaken operation report a correlation change that never happened.
      if (!ownsOperation(context)) return { ok: false, reason: "superseded" };
      const result = await checkpoint(expected);
      if (!ownsOperation(context)) return { ok: false, reason: "superseded" };
      return result.ok ? result : { ok: false, reason: "correlation_changed" };
    });
  }

  // -----------------------------------------------------------------------
  // Resolution persistence and C7
  // -----------------------------------------------------------------------

  type ResolutionPersisted =
    | { kind: "resolved"; resolution: IdentityBarrierResolution }
    | { kind: "barrier_resolution_failed" }
    | { kind: "correlation_changed" };

  /**
   * Writes the resolution for exactly this barrier and then runs **C7**.
   *
   * C7 is what prevents a stale success: after the write resolves, the current
   * barrier, the current attempt, the just-written resolution and the live epoch
   * are all re-read. If barrier C became current in the meantime, **no
   * ready-producing outcome is emitted** — and resolution B stays harmless on
   * disk, under its own derived key, unable to resolve or remove C.
   *
   * `identityGeneration` copies the ATTEMPT's persisted value, never the live
   * counter, so Phase A will later compare two persisted numbers.
   */
  async function persistResolutionAndCheck(
    context: TransitionContext,
    input: {
      barrier: IdentityAccessBarrier;
      attempt: InteractiveAuthAttempt;
      identity: AccountIdentity;
      generation: number;
    }
  ): Promise<ResolutionPersisted> {
    // The write and C7 are ONE section: a resolution written here and re-read there
    // must not have another operation's barrier land in between, or C7 would judge a
    // state neither operation was ever in.
    return inOwnedSection<ResolutionPersisted>(context, { kind: "correlation_changed" }, () =>
      persistResolutionUnlocked(context, input)
    );
  }

  async function persistResolutionUnlocked(context: TransitionContext, input: {
    barrier: IdentityAccessBarrier;
    attempt: InteractiveAuthAttempt;
    identity: AccountIdentity;
    generation: number;
  }): Promise<ResolutionPersisted> {
    const resolution = createIdentityBarrierResolution({
      barrierId: input.barrier.barrierId,
      attemptId: input.attempt.attemptId,
      method: input.attempt.method,
      flowId: input.attempt.flowId,
      identityGeneration: input.attempt.capturedIdentityGeneration,
      authenticatedAccountScopeId: input.identity.accountScopeId,
      resolvedAt: now(),
    });

    const written = await resolutions.saveForBarrier(resolution);
    if (!written.ok) return { kind: "barrier_resolution_failed" };

    const containUnconfirmedResolution = async (): Promise<ResolutionPersisted> => {
      // If another writer already installed a different current barrier, the
      // just-written resolution is intrinsically non-current and cannot resolve
      // that newer latch. Do not overwrite the newer barrier merely to compensate
      // an already harmless derived-key record.
      const currentBarrier = await barriers.load();
      if (
        currentBarrier.status === "value" &&
        currentBarrier.value.barrierId !== input.barrier.barrierId
      ) {
        return { kind: "correlation_changed" };
      }
      const fenced = await fenceUnconfirmedGrantUnlocked();
      if (!fenced) {
        const retracted = await resolutions.retractUnconfirmedResolution(input.barrier.barrierId);
        if (!retracted.ok) return { kind: "barrier_resolution_failed" };
      }
      return { kind: "correlation_changed" };
    };

    const c7 = await checkpoint({
      barrierId: input.barrier.barrierId,
      attemptId: input.attempt.attemptId,
      generation: input.generation,
    });
    if (!c7.ok || c7.attempt === null) return containUnconfirmedResolution();

    const stored = await resolutions.loadForBarrier(c7.barrier.barrierId);
    if (stored.status !== "value") return containUnconfirmedResolution();
    if (!isStructurallyCorrelated(c7.barrier, c7.attempt, stored.value)) {
      return containUnconfirmedResolution();
    }

    // Ownership may change while the resolution write or any C7 read is awaiting
    // its adapter. Section admission alone cannot prevent that synchronous claim.
    // Retract the now-stale grant with a fresh unresolved barrier before allowing
    // the newer operation's section to run.
    if (!ownsOperation(context) || liveGeneration.current() !== context.epoch) {
      return containUnconfirmedResolution();
    }

    return { kind: "resolved", resolution: stored.value };
  }

  /** Persists the complete interactive attempt as ONE owned section, so a
   * superseded start cannot install its attempt over a newer operation's. */
  async function persistAttemptSection(
    context: TransitionContext,
    attempt: InteractiveAuthAttempt
  ): Promise<"written" | "write_failed" | "superseded"> {
    return inOwnedSection<"written" | "write_failed" | "superseded">(
      context,
      "superseded",
      async () => {
        const written = await attempts.save(attempt);
        return written.ok ? "written" : "write_failed";
      }
    );
  }

  // -----------------------------------------------------------------------
  // Trusted state
  // -----------------------------------------------------------------------

  function sessionFor(
    identity: AccountIdentity,
    eligibility: Extract<GateEligibility, { kind: "complete" }>
  ): GateSession {
    return {
      accountScopeId: identity.accountScopeId,
      email: identity.email,
      profileId: eligibility.profileId,
      displayName: eligibility.displayName,
      entitlement: "free",
    };
  }

  function sessionForTrusted(record: TrustedDeviceRecord, email: string | null): GateSession {
    return {
      accountScopeId: record.accountScopeId,
      email,
      profileId: record.profileId,
      displayName: record.displayName,
      entitlement: "free",
    };
  }

  type TrustedWrite = { kind: "written" } | { kind: "write_failed" } | { kind: "superseded" };

  /**
   * Proves currency and writes the trusted record as ONE section.
   *
   * Proving in a separate step and writing in another leaves exactly the window a
   * delayed adapter needs: the proof passes, a newer operation claims the slot, and
   * the older operation's write lands anyway. Here the proof is the section's first
   * act and the write its last, so nothing can be observed or written in between.
   */
  async function writeTrustedSection(
    context: TransitionContext,
    identity: AccountIdentity,
    eligibility: Extract<GateEligibility, { kind: "complete" }>
  ): Promise<TrustedWrite> {
    return inOwnedSection<TrustedWrite>(context, { kind: "superseded" }, async () => {
      if (!(await stillCurrent(context))) return { kind: "superseded" };
      const timestamp = now();
      const written = await trusted.save(
        createTrustedDeviceRecord({
          accountScopeId: identity.accountScopeId,
          profileId: eligibility.profileId,
          displayName: eligibility.displayName,
          onboardingCompletedAt: eligibility.onboardingCompletedAt,
          generation: liveGeneration.current(),
          establishedAt: timestamp,
          lastServerConfirmationAt: timestamp,
        })
      );
      if (!written.ok) return { kind: "write_failed" };
      if (!ownsOperation(context) || liveGeneration.current() !== context.epoch) {
        const fenced = await fenceUnconfirmedGrantUnlocked();
        if (!fenced) {
          // A failed fence must not leave the stale grant in place. This removal is
          // still inside the same section, before a newer same-page trusted write
          // can run. A double storage failure remains an explicitly non-durable
          // denial condition; no caller emits ready from this branch.
          const removed = await trusted.remove();
          if (!removed.ok) return { kind: "write_failed" };
        }
        return { kind: "superseded" };
      }
      return { kind: "written" };
    });
  }

  type TrustedRefresh =
    | { kind: "written" }
    | { kind: "write_failed" }
    | { kind: "superseded" }
    | { kind: "record_unusable" }
    | { kind: "facts_disagree" };

  /**
   * Confirms an existing valid record for the SAME identity, as ONE section that
   * owns the read, the comparison and the write.
   *
   * Reading the record outside the section and writing inside it would leave the
   * exact window a delayed adapter needs: a newer operation replaces the record, and
   * this operation then writes the OLD record back with a fresh confirmation
   * timestamp — silently combining one identity's local state with another's server
   * result. So the read that the comparison is made from is the read the write is
   * based on, and nothing can be observed in between.
   */
  async function refreshTrustedSection(
    context: TransitionContext,
    identity: AccountIdentity,
    eligibility: Extract<GateEligibility, { kind: "complete" }>
  ): Promise<TrustedRefresh> {
    return inOwnedSection<TrustedRefresh>(context, { kind: "superseded" }, async () => {
      if (!(await stillCurrent(context))) return { kind: "superseded" };
      const loaded = await trusted.load();
      // Absent, malformed or unreadable. A ready device always has a valid record —
      // one is written before any ready state — so its disappearance or corruption
      // is a negative fact learned online, not an invitation to mint a replacement.
      if (loaded.status !== "value") return { kind: "record_unusable" };
      const record = loaded.value;
      const agree =
        record.accountScopeId === identity.accountScopeId &&
        record.profileId === eligibility.profileId &&
        record.onboardingCompletedAt === eligibility.onboardingCompletedAt;
      if (!agree) return { kind: "facts_disagree" };
      // RE-PROVED IMMEDIATELY BEFORE THE WRITE. The load above is an await, and
      // another tab can install a newer barrier during it — which the section
      // cannot prevent, because a section only excludes this page's own operations.
      // Proving once at the top would be a proof about the state before the read.
      if (!(await stillCurrent(context))) return { kind: "superseded" };
      const written = await trusted.save(withServerConfirmation(record, now()));
      return written.ok ? { kind: "written" } : { kind: "write_failed" };
    });
  }

  // -----------------------------------------------------------------------
  // Legal-gated verdicts
  // -----------------------------------------------------------------------

  async function legalSnapshot(): Promise<LegalSnapshot | null> {
    const result = await identityService.getLegalSnapshot();
    return result.ok ? result.value : null;
  }

  /** Sign-in is offered only when a current Privacy Notice exists. A missing one,
   * and an invalid response, both resolve `legal_unavailable` — but they are
   * different conditions and the service reports them distinctly. */
  async function signedOutVerdict(): Promise<GateVerdict> {
    const legal = await legalSnapshot();
    if (legal === null || !canOfferSignIn(legal)) return { kind: "legal_unavailable" };
    return { kind: "signed_out", legal };
  }

  async function onboardingVerdict(): Promise<GateVerdict> {
    const legal = await legalSnapshot();
    if (legal === null || !canOfferSignIn(legal)) return { kind: "legal_unavailable" };
    if (!canCompleteOnboarding(legal)) return { kind: "onboarding_blocked_legal", legal };
    return { kind: "onboarding_required", legal };
  }

  // -----------------------------------------------------------------------
  // Server-driven invalidation (ADR-0025 §14)
  // -----------------------------------------------------------------------

  /**
   * The COMPLETE result of one server-driven invalidation.
   *
   * `outstanding` is the whole fact: every required step that did not complete, in
   * a fixed order. `outcome.kind` is the single UI-facing label derived from it by
   * `primaryInvalidationKind`, and `outcome.outstanding` carries the list onward so
   * no consumer has to re-derive or trust the label alone. A denial that could
   * neither remove the trusted record nor delete the pending intent reports BOTH
   * facts, and its primary label is the trusted-record one — the collapse loses
   * nothing because the list travels with it.
   *
   * `denial` is the separate fact that the application is denied — true for every
   * result — and is what lets the exact kind survive without weakening the denial.
   *
   * `begun: false` is not a result at all: it means the operation had already lost
   * ownership when it reached the denial, so **nothing was announced and nothing was
   * mutated**. A late definitive negative belonging to a superseded operation must
   * not revoke a newer operation's identity, and must not lock out an account that
   * has authenticated since.
   */
  type InvalidationRun =
    | {
        begun: true;
        outcome: InvalidationOutcome;
        verdict: GateVerdict;
        denial: DenialMarker;
        outstanding: readonly InvalidationResidue[];
      }
    | { begun: false };

  /**
   * Deny in memory, then make the denial durable.
   *
   * Ordering is fixed and the fallback is NOT skipped: the invalidation barrier is
   * attempted first because it denies even if trusted-record removal fails; if the
   * barrier write itself fails, removal is attempted as the remaining durable
   * mechanism rather than as a follow-up to a success. If both fail, access is
   * denied for the page lifetime and `durable_denial_unavailable` says so —
   * **no durable offline revocation is claimed.**
   *
   * OWNERSHIP IS CHECKED ONCE, AT THE THRESHOLD, AND NEVER AGAIN.
   *
   * Before the in-memory denial: a superseded operation may not begin a denial at
   * all, because the server result it is acting on describes an identity a newer
   * operation may already have replaced. After it: the transition runs to
   * completion regardless of what starts in the meantime, because a denial that has
   * announced itself and written its barrier is deny-ward and abandoning it halfway
   * would leave a partially applied revocation. Those are the two halves of §14 and
   * they are not in tension — one is about whether to start, the other about
   * whether to finish.
   */
  async function runInvalidation(
    context: TransitionContext,
    barredAccountScopeId: string | null | undefined
  ): Promise<InvalidationRun> {
    if (!ownsOperation(context)) return { begun: false };

    // Step 1: deny in memory, before any durable write is even attempted.
    progress("identity_denied_in_memory");

    // The public invalidation entry point deliberately reaches the denial
    // threshold before awaiting this metadata read. Once that threshold is
    // crossed, a newer operation cannot turn the call into a non-denial result;
    // the remaining work is unconditional and deny-ward. Other callers already
    // know the account scope and pass it directly.
    let resolvedBarredAccountScopeId = barredAccountScopeId;
    if (resolvedBarredAccountScopeId === undefined) {
      const trustedBefore = await trusted.load();
      resolvedBarredAccountScopeId =
        trustedBefore.status === "value" ? trustedBefore.value.accountScopeId : null;
    }

    const denied: GateVerdict = { kind: "locked", origin: "server_identity_invalidated" };
    const outstanding: InvalidationResidue[] = [];

    // Step 2: the invalidation barrier is the FIRST durable step, because it denies
    // even when the trusted record cannot be removed. `unconditional` from here on:
    // the denial has begun.
    const established = await establishBarrier(context, {
      origin: "server_identity_invalidated",
      barredAccountScopeId: resolvedBarredAccountScopeId,
      unconditional: true,
    });
    if (!established.ok) outstanding.push("durable_barrier");

    // Step 3: remove the trusted record. Attempted whether or not the barrier
    // succeeded — if it failed, this is the remaining durable denial mechanism
    // rather than a follow-up to a success.
    const removal = await inSection(() => trusted.remove());
    if (!removal.ok) outstanding.push("trusted_state");

    // Step 4: delete EVERY pending intent, unconditionally.
    //
    // This is a definitive server denial, not a sign-out the person chose. The
    // one-sign-out invitation-recovery exemption exists so a deliberate
    // wrong-account recovery can carry exactly one invitation across exactly one
    // sign-out; it is not a licence to survive the server saying this identity is
    // no longer valid. So `deleteIntent` — not `deleteOrdinaryIntents` — and the
    // result is reported rather than swallowed.
    //
    // "Best effort" remains reserved for cleanup of already non-current
    // correlation records, which is what §5.7b grants it for.
    const intentOutcome = await inSection(async () => {
      const deletion = await intents.deleteIntent();
      if (deletion.ok) {
        // A prior failed denial may already have installed a tombstone. Once the
        // intent key is proven absent, clear that debt in this SAME ordered
        // section. Otherwise a successful retry can leave a stale tombstone that
        // blocks every future ready transition forever.
        const discharged = await intents.clearOutstandingDenialCleanup();
        return { deleted: true, recorded: true, discharged: discharged.ok };
      }
      // The required deletion did not complete. Record the TOMBSTONE, a write of a
      // different key — which is exactly why it can succeed where the removal could
      // not. The debt then survives a reload and cannot be discharged by
      // authenticating again: `settleIntentBeforeReady` is the one choke point on
      // every path to a ready gate, and it refuses readiness until the debt is gone.
      const recorded = await intents.recordOutstandingDenialCleanup(now());
      return { deleted: false, recorded: recorded.kind === "applied", discharged: true };
    });
    if (!intentOutcome.deleted) outstanding.push("pending_intent");
    // Reported as its own fact rather than folded into the one above: a recorded
    // debt is enforceable across a reload, an unrecorded one is not, and §22's
    // honest limitation applies only to the second.
    if (!intentOutcome.deleted && !intentOutcome.recorded) {
      outstanding.push("outstanding_cleanup_record");
    }
    if (intentOutcome.deleted && !intentOutcome.discharged) {
      outstanding.push("outstanding_cleanup_record");
    }

    const kind = primaryInvalidationKind(outstanding);
    const frozen: readonly InvalidationResidue[] = INVALIDATION_RESIDUES.filter((residue) =>
      outstanding.includes(residue)
    );
    const denial: DenialMarker =
      kind === "durable_denial_unavailable"
        ? "durable_denial_unavailable"
        : "server_identity_invalidated";

    return {
      begun: true,
      outcome: { kind, denial, outstanding: frozen },
      verdict:
        kind === "durable_denial_unavailable" ? { kind: "storage_unavailable_locked" } : denied,
      denial,
      outstanding: frozen,
    };
  }

  // -----------------------------------------------------------------------
  // Phase B — identity binding
  // -----------------------------------------------------------------------

  /**
   * What Phase B concluded, and — separately — the exact result of any
   * server-driven invalidation that ran while concluding it.
   *
   * The verdict alone is not enough: `locked / server_identity_invalidated` is the
   * same verdict whether every required denial step completed or whether the
   * trusted record could not be removed. Carrying the run itself is what lets each
   * caller report the exact outcome instead of relabelling all of them
   * `identity_invalidated`.
   */
  type BegunInvalidation = Extract<InvalidationRun, { begun: true }>;

  type PhaseBResult = {
    verdict: GateVerdict;
    invalidation: BegunInvalidation | null;
    /** The operation lost ownership before it could act on a server result. It
     * mutated nothing, and in particular did not invalidate a newer operation's
     * identity. */
    superseded: boolean;
  };

  /** A definitive server negative invalidates; anything transient must not, or a
   * legitimate device on a bad network would be locked out (ADR-0025 §A). */
  function isDefinitiveNegative(error: IdentityError): boolean {
    return error.kind === "forbidden" || error.kind === "profile_required";
  }

  /**
   * Resolves a NEW identity as fresh: bare Profile, then derived gate facts, then
   * — only if every fact is complete — the REQUIRED trusted-record write.
   *
   * Used for a first run, a new device, and ADR-0025 §13's **Case A** correlated
   * account replacement. In the Case A path the previous account's record is never
   * read here, which is how "never honour or reinterpret the old record" holds by
   * construction rather than by a check.
   */
  async function resolveAsFreshIdentity(
    identity: AccountIdentity,
    options: { previousAccountScopeId: string | null },
    context: TransitionContext
  ): Promise<PhaseBResult> {
    progress("ensuring_profile", context);
    const profile = await identityService.ensureProfile();
    if (!profile.ok) {
      if (isDefinitiveNegative(profile.error)) {
        return invalidated(await runInvalidation(context, identity.accountScopeId));
      }
      return plain({ kind: "identity_unconfirmed" });
    }

    progress("resolving_gate_facts", context);
    const facts = await identityService.resolveGateFacts();
    if (!facts.ok) {
      if (isDefinitiveNegative(facts.error)) {
        return invalidated(await runInvalidation(context, identity.accountScopeId));
      }
      return plain({ kind: "identity_unconfirmed" });
    }

    // The two RPCs must describe the SAME Profile. `ensure_my_profile()` is the one
    // creation/resolution path and `get_my_gate_state()` derives from
    // `private.current_profile_id()`, so a disagreement means they ran against
    // different sessions — never something to reconcile by preferring one.
    if (facts.value.profileId !== profile.value.profileId) {
      return plain({ kind: "identity_unconfirmed" });
    }

    const eligibility = deriveGateEligibility(facts.value);
    if (eligibility.kind === "incomplete") return plain(await onboardingVerdict());

    // An ORDINARY ACCOUNT SWITCH: this device was trusted for a different account
    // and is now resolving a new one. That account's ordinary intents end here
    // (ADR-0025 §22), BEFORE the new account can become ready — this is the
    // enforcing gate, so a failure blocks rather than being ignored.
    //
    // A first sign-in, or a re-resolution of the SAME account, is not a switch: an
    // intent captured before authentication is legitimately continuing through
    // authentication and onboarding and must survive.
    if (
      options.previousAccountScopeId !== null &&
      options.previousAccountScopeId !== identity.accountScopeId
    ) {
      // Superseded operations must not mutate NEWER intent state.
      // The proof and the deletion are ONE section: a superseded operation must not
      // delete a newer operation's intent state, and a proof taken outside the
      // section could be stale by the time the deletion lands.
      const switched = await inOwnedSection<IntentMutationOutcome>(
        context,
        { kind: "superseded" },
        async () => {
          if (!(await stillCurrent(context))) return { kind: "superseded" };
          return intents.deleteOrdinaryIntents();
        }
      );
      if (switched.kind === "superseded") return plain({ kind: "identity_unconfirmed" });
      if (switched.kind === "blocked") return plain({ kind: "intent_state_not_persisted" });
    }

    progress("establishing_trusted_state", context);
    // The currency proof is the section's first act and the write its last, so a
    // delayed adapter cannot let a superseded operation's record land.
    const written = await writeTrustedSection(context, identity, eligibility);
    if (written.kind === "superseded") return plain({ kind: "identity_unconfirmed" });
    if (written.kind === "write_failed") {
      // Server authentication, Profile, onboarding and entitlement all succeeded,
      // and the app still does not open. There is no "online only" mode.
      return plain({ kind: "trusted_state_not_established" });
    }

    const settled = await settleIntentStateBeforeReady(context);
    if (settled !== null) return plain(settled);

    // The last proof before a ready verdict leaves this function.
    const beforeReady = await guardStillCurrent(context);
    if (beforeReady !== null) return plain(beforeReady);

    return plain({ kind: "ready_online", session: sessionFor(identity, eligibility) });
  }

  /** A Phase B resolution that involved no server-driven invalidation. */
  function plain(verdict: GateVerdict): PhaseBResult {
    return { verdict, invalidation: null, superseded: false };
  }

  /**
   * A Phase B resolution that reached a definitive negative.
   *
   * A run that never BEGAN — because ownership had already been lost — resolves
   * `identity_unconfirmed` and reports supersession. That is the deny-ward direction
   * and it mutates nothing: the newer operation, and any account that authenticated
   * since, are untouched.
   */
  function invalidated(run: InvalidationRun): PhaseBResult {
    if (!run.begun) {
      return { verdict: { kind: "identity_unconfirmed" }, invalidation: null, superseded: true };
    }
    return { verdict: run.verdict, invalidation: run, superseded: false };
  }

  /**
   * Settles pending-intent state immediately before a ready state is emitted — the
   * ONE choke point every ready path passes through (ADR-0025 §C step 8, §22).
   *
   * It discharges two different obligations:
   *
   *  - An **outstanding denial cleanup**: a required intent deletion that a
   *    definitive server denial could not complete, marked durably so it survives
   *    a reload. Removing it here is what makes the cleanup impossible to bypass by
   *    reloading or by starting a fresh recovery transition, and what stops the
   *    stale intent from ever being replayed — the gate simply does not become
   *    ready while the debt exists. The coordinator enforces this; it is not left
   *    to a later UI layer's discipline.
   *  - An **invitation-recovery survival marker**, which exists to carry exactly one
   *    invitation across exactly ONE sign-out. Leaving it in place once the gate is
   *    ready would let the same invitation survive a second, unrelated sign-out.
   *
   * An **ordinary** intent is left completely untouched, which is what keeps a
   * first-run deep link alive across normal authentication and onboarding.
   *
   * Returns `null` when nothing stands in the way of readiness, or the verdict that
   * must be emitted instead. A required mutation that cannot be proven, and an
   * intent key that cannot be read at all, both fail closed.
   */
  async function settleIntentStateBeforeReady(
    context: TransitionContext
  ): Promise<GateVerdict | null> {
    // ONE section, so the whole read → decide → write sequence inside the
    // repository is closed against every other operation's mutations. The currency
    // proof is ALSO handed down, so the repository can consult it between its own
    // read and its own write — the two are complementary: the section stops another
    // coordinator operation interleaving, the proof stops this operation acting
    // after it has been overtaken.
    const settled = await inOwnedSection<IntentMutationOutcome>(
      context,
      { kind: "superseded" },
      () => intents.settleIntentBeforeReady(() => stillCurrent(context))
    );
    if (settled.kind === "blocked") return { kind: "intent_state_not_persisted" };
    if (settled.kind === "superseded") return { kind: "identity_unconfirmed" };
    return null;
  }

  type TrustedVerdictLoad =
    | { kind: "loaded"; record: TrustedDeviceRecord | null }
    | { kind: "superseded" };

  /**
   * Loads the grant-bearing trusted record for Phase B and, when it is malformed,
   * removes it without a read/remove gap. Ownership is re-proved after the read
   * and immediately before the removal. A newer operation may claim ownership
   * while this section is awaiting storage, but its own durable writes queue
   * behind the section; consequently an admitted cleanup can never delete a
   * trusted record that the newer same-page operation has already written.
   */
  async function loadTrustedForVerdict(
    context: TransitionContext
  ): Promise<TrustedVerdictLoad> {
    return inOwnedSection<TrustedVerdictLoad>(context, { kind: "superseded" }, async () => {
      const loaded = await trusted.load();
      if (!ownsOperation(context)) return { kind: "superseded" };
      if (loaded.status === "value") return { kind: "loaded", record: loaded.value };
      if (loaded.status === "malformed") {
        await trusted.remove();
      }
      // Absent and read_failed both mean there is no proven grant. A malformed
      // cleanup failure is likewise deny-ward: no caller may honour the record.
      return { kind: "loaded", record: null };
    });
  }

  /**
   * Phase B. The first point at which an identity exists, and therefore the first
   * point at which an account scope may be compared with anything.
   */
  async function resolveAccessVerdict(
    preflight: PreflightResult,
    restore: SessionRestoreOutcome,
    context: TransitionContext
  ): Promise<PhaseBResult> {
    if (preflight.kind === "quarantined") {
      return plain({ kind: "quarantined_locked", origin: preflight.origin });
    }

    // Step 1 — trusted record structural check.
    const trustedSnapshot = await loadTrustedForVerdict(context);
    if (trustedSnapshot.kind === "superseded") {
      return plain({ kind: "identity_unconfirmed" });
    }
    const trustedRecord = trustedSnapshot.record;
    // A `read_failed` load is treated as absent-but-unproven: the full
    // server-authoritative path runs instead of an optimistic entry, which is the
    // safe direction — it can only ever require MORE proof, never less.

    // Step 2 — the restore matrix.
    switch (restore.kind) {
      case "restore_failed":
        // Fail closed. The barrier stays unresolved and the trusted record is
        // retained but not honoured.
        return plain({ kind: "identity_unconfirmed" });

      case "temporarily_unavailable": {
        if (trustedRecord === null) {
          // Nothing to be optimistic about, and no Legal fetch — there is no
          // connectivity to fetch with and nothing to show.
          return plain({ kind: "identity_unconfirmed" });
        }
        if (preflight.kind !== "correlated") {
          // Offline continuation is defined against the resolution's account
          // scope, so with no completed correlation set there is nothing to bind
          // the trusted record to. Fail closed; the person recovers by coming
          // back online.
          return plain({ kind: "identity_unconfirmed" });
        }
        if (trustedRecord.accountScopeId !== preflight.resolution.authenticatedAccountScopeId) {
          // A previous account's record can NEVER grant offline access for a
          // different account.
          return plain({ kind: "identity_unconfirmed" });
        }
        const offlineSettled = await settleIntentStateBeforeReady(context);
        if (offlineSettled !== null) return plain(offlineSettled);
        const beforeOfflineReady = await guardStillCurrent(context);
        if (beforeOfflineReady !== null) return plain(beforeOfflineReady);
        return plain({ kind: "ready_offline", session: sessionForTrusted(trustedRecord, null) });
      }

      case "no_session": {
        if (trustedRecord !== null) {
          // Case C — a definitive signed-out condition while a valid trusted
          // record exists. Durable denial, with the barrier attempted before
          // removal and an explicit double-failure outcome.
          return invalidated(await runInvalidation(context, trustedRecord.accountScopeId));
        }
        return plain(await signedOutVerdict());
      }

      case "invalid_session": {
        if (trustedRecord !== null) {
          // Case B — the session is definitively invalid.
          return invalidated(await runInvalidation(context, trustedRecord.accountScopeId));
        }
        return plain(await signedOutVerdict());
      }

      case "authenticated": {
        const identity = restore.identity;

        if (
          preflight.kind === "correlated" &&
          preflight.resolution.authenticatedAccountScopeId !== identity.accountScopeId
        ) {
          // Case B — the restored identity is not the identity this barrier was
          // resolved for. The unexpected session is never accepted as fresh.
          return invalidated(await runInvalidation(context, identity.accountScopeId));
        }

        if (trustedRecord === null) {
          // Not a switch: there is no previous account on this device.
          return resolveAsFreshIdentity(identity, { previousAccountScopeId: null }, context);
        }

        if (trustedRecord.accountScopeId === identity.accountScopeId) {
          // Optimistic entry: a valid same-scope record and no unresolved barrier.
          // Revalidation runs separately, in the background, and never blocks an
          // already-trusted device.
          const settled = await settleIntentStateBeforeReady(context);
          if (settled !== null) return plain(settled);
          const beforeReady = await guardStillCurrent(context);
          if (beforeReady !== null) return plain(beforeReady);
          return plain({
            kind: "ready_online",
            session: sessionForTrusted(trustedRecord, identity.email),
          });
        }

        // Different scope.
        if (preflight.kind === "correlated") {
          // Case A — an exact completed correlation set, whose scope the check
          // above already proved matches this identity, PROVES a deliberate
          // account transition. Resolve the new account as fresh and replace the
          // record. This is not an invalidation and writes no invalidation
          // barrier — and it IS an ordinary account switch, so the previous
          // account's ordinary intents end before this one becomes ready.
          return resolveAsFreshIdentity(
            identity,
            { previousAccountScopeId: trustedRecord.accountScopeId },
            context
          );
        }

        // Case B — an uncorrelated mismatch.
        return invalidated(await runInvalidation(context, identity.accountScopeId));
      }
    }
  }

  /**
   * What a startup reports about its own conclusion.
   *
   * `null` means "nothing happened worth reporting": no invalidation ran and the
   * operation was not overtaken. The two non-null cases are the complete
   * invalidation result and an honest supersession — a startup that was overtaken
   * before it could act says so, rather than reporting nothing at all.
   */
  function startupFinalization(
    result: PhaseBResult,
    context: TransitionContext
  ): IdentityTransitionOutcome | null {
    if (result.invalidation !== null) return result.invalidation.outcome;
    if (result.superseded) return annotate({ kind: "superseded" }, context);
    return null;
  }

  /**
   * Turns a Phase B result into the interactive transition's own outcome, so a
   * caller can never read `resolved` and conclude the app may open when it may not.
   *
   * When an invalidation ran, its EXACT outcome is what travels — never a lock
   * verdict re-derived into `identity_invalidated`, which would silently discard
   * the fact that a required trusted-state removal or intent deletion is still
   * outstanding. The denial marker travels with it so the reducer denies without
   * needing the kind to be flattened.
   */
  function completionOutcomeFor(
    identity: AccountIdentity,
    result: PhaseBResult,
    context: TransitionContext
  ): InteractiveCompletionOutcome {
    if (result.invalidation !== null) return result.invalidation.outcome;
    // A denial that never began: the operation was overtaken before it could act, so
    // it reports supersession and mutated nothing.
    if (result.superseded) return annotate({ kind: "superseded" }, context);
    const verdict = result.verdict;
    if (verdict.kind === "trusted_state_not_established") {
      return annotate({ kind: "trusted_state_not_established" }, context);
    }
    if (verdict.kind === "intent_state_not_persisted") {
      return annotate({ kind: "intent_state_not_persisted" }, context);
    }
    if (verdict.kind === "storage_unavailable_locked") {
      // Reached only without an invalidation run, which no current path produces.
      // Kept as the deny-ward default rather than removed.
      return annotate({ kind: "durable_denial_unavailable" }, context, "durable_denial_unavailable");
    }
    if (verdict.kind === "locked" && verdict.origin === "server_identity_invalidated") {
      return annotate({ kind: "identity_invalidated" }, context, "server_identity_invalidated");
    }
    return annotate({ kind: "resolved", identity, gate: verdict }, context);
  }

  // -----------------------------------------------------------------------
  // Phase 0 — the admitted continuation
  // -----------------------------------------------------------------------

  async function consumeAdmittedContinuation(
    decision: Extract<OAuthIntakeDecision, { kind: "admit_continuation" }>,
    startup: TransitionContext
  ): Promise<StartupOutcome> {
    const { barrier, attempt, expectedFlowId } = decision;

    // Every non-success path below leaves this exact barrier valid and unresolved
    // with no admissible continuation remaining — which is `quarantined_locked` by
    // definition.
    const stillLocked: GateVerdict = { kind: "quarantined_locked", origin: barrier.origin };

    // A FRESH callback-page epoch. The start page's epoch ended at navigation and
    // its value is never compared with this one.
    const callbackGeneration = liveGeneration.bump();
    // This continuation IS the startup operation — same identity, same order — now
    // bound to the exact barrier and attempt it is completing, and re-based onto the
    // fresh callback-page epoch. Every later step re-proves both.
    const context: TransitionContext = {
      ...startup,
      epoch: callbackGeneration,
      barrierId: barrier.barrierId,
      attemptId: attempt.attemptId,
    };
    const startupIdentity = identityOf(context);

    const c3 = await proveCheckpoint(context, {
      barrierId: barrier.barrierId,
      attemptId: attempt.attemptId,
      generation: callbackGeneration,
    });
    if (!c3.ok) {
      capture.finalizeTerminalCallbackOutcome();
      const report = c3.reason === "superseded" ? "superseded" : "correlation_changed";
      return {
        callback: { kind: "correlation_changed" },
        verdict: stillLocked,
        finalization: annotate({ kind: report }, context),
        transition: startupIdentity,
      };
    }

    progress("consuming_oauth_return", context);

    const claim = capture.claimCallbackForExchange();
    if (claim.kind !== "claimed") {
      // A second exchange attempt performs zero provider calls.
      capture.finalizeTerminalCallbackOutcome();
      return {
        callback: { kind: "exchange_failed" },
        verdict: stillLocked,
        finalization: annotate({ kind: "exchange_failed" }, context),
        transition: startupIdentity,
      };
    }

    const exchange = await auth.exchangeCorrelatedCallback(claim.claim, expectedFlowId);

    // Whatever happened, this page is finished with the callback material: the
    // retained candidate is dropped and any unread code is revoked.
    capture.finalizeTerminalCallbackOutcome();

    if (exchange.kind !== "exchanged") {
      const callback: OAuthReturnOutcome =
        exchange.kind === "temporarily_unavailable"
          ? { kind: "temporarily_unavailable" }
          : { kind: "exchange_failed" };
      return {
        callback,
        verdict: stillLocked,
        finalization: annotate(
          exchange.kind === "temporarily_unavailable"
            ? { kind: "temporarily_unavailable" }
            : { kind: "exchange_failed" },
          context
        ),
        transition: startupIdentity,
      };
    }

    const c4 = await proveCheckpoint(context, {
      barrierId: barrier.barrierId,
      attemptId: attempt.attemptId,
      generation: callbackGeneration,
    });
    if (!c4.ok || c4.attempt === null) {
      // A session now exists — the SDK persisted it before resolving — and the
      // barrier is still unresolved, which is exactly what keeps the app closed.
      const report = c4.ok || c4.reason === "correlation_changed" ? "correlation_changed" : "superseded";
      return {
        callback: { kind: "correlation_changed" },
        verdict: stillLocked,
        finalization: annotate({ kind: report }, context),
        transition: startupIdentity,
      };
    }

    progress("finalizing_identity", context);
    const persisted = await persistResolutionAndCheck(context, {
      barrier: c4.barrier,
      attempt: c4.attempt,
      identity: exchange.identity,
      generation: callbackGeneration,
    });

    if (persisted.kind !== "resolved") {
      return {
        callback:
          persisted.kind === "correlation_changed"
            ? { kind: "correlation_changed" }
            : { kind: "succeeded", identity: exchange.identity },
        verdict: stillLocked,
        finalization: annotate({ kind: persisted.kind }, context),
        transition: startupIdentity,
      };
    }

    const result = await resolveAccessVerdict(
      {
        kind: "correlated",
        barrier: c4.barrier,
        attempt: c4.attempt,
        resolution: persisted.resolution,
      },
      { kind: "authenticated", identity: exchange.identity },
      context
    );

    return {
      callback: { kind: "succeeded", identity: exchange.identity },
      verdict: result.verdict,
      finalization: completionOutcomeFor(exchange.identity, result, context),
      transition: startupIdentity,
    };
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  return {
    async startUp(): Promise<StartupOutcome> {
      const startup = beginTransition();
      progress("intaking_oauth_return", startup);

      // SYNCHRONOUS, and before the first `await` in this function: capture,
      // classify, and clean the URL. Every durable read and every asynchronous
      // operation below therefore happens with the owned callback material already
      // out of the address bar, out of history, and out of anything that reads the
      // URL.
      const candidate = capture.initializeCallbackCapture();

      const snapshot = await loadDurableSnapshot();
      const decision = decideOAuthIntake(candidate, snapshot);

      if (decision.kind === "admit_continuation") {
        return consumeAdmittedContinuation(decision, startup);
      }

      // A terminal Phase 0 outcome: nothing further will be claimed, so the page
      // scope's capture ends here.
      capture.finalizeTerminalCallbackOutcome();

      const callback = callbackOutcomeFor(decision);
      const preflight = evaluateDurablePreflight(snapshot);

      if (preflight.kind === "quarantined") {
        // Fail closed without contacting the provider at all: a barrier with no
        // completed set and no admissible continuation denies regardless of what a
        // session lookup would say.
        return {
          callback,
          verdict: { kind: "quarantined_locked", origin: preflight.origin },
          finalization: null,
          transition: identityOf(startup),
        };
      }

      progress("restoring_identity", startup);
      // Bound to the completed correlation set where one exists, so a newer
      // transition installing its own barrier supersedes this startup.
      const context: TransitionContext =
        preflight.kind === "correlated"
          ? {
              ...startup,
              barrierId: preflight.barrier.barrierId,
              attemptId: preflight.attempt.attemptId,
            }
          : startup;
      const restore = await auth.restoreSession();
      const result = await resolveAccessVerdict(preflight, restore, context);
      return {
        callback,
        verdict: result.verdict,
        // A startup that ran a server-driven invalidation reports its EXACT outcome
        // rather than `null`: "the trusted record could not be removed" is not the
        // same report as "the identity was invalidated", and the caller must be able
        // to tell them apart without re-deriving anything from the verdict. A startup
        // that was OVERTAKEN before it could act says so, rather than reporting
        // nothing at all.
        finalization: startupFinalization(result, context),
        transition: identityOf(startup),
      };
    },

    async startGoogleSignIn(): Promise<GoogleStartOutcome> {
      // Claiming ownership FIRST supersedes every older operation immediately, so a
      // sign-in started while another operation is still awaiting cannot have its
      // barrier resolved by that older operation's late result.
      let context = beginTransition();

      // Step 1 — the barrier, before any provider call and before any other
      // persistent mutation.
      progress("establishing_identity_barrier", context);
      const established = await establishBarrier(context, {
        origin: "deliberate_authentication",
      });
      if (!established.ok) {
        return annotate(
          established.superseded
            ? { kind: "superseded" as const }
            : { kind: "barrier_not_established" as const },
          context
        );
      }

      const barrierId = established.barrier.barrierId;
      // Step 2 — the START-PAGE epoch, captured after the barrier bumped it.
      const startEpoch = liveGeneration.current();
      context = { ...context, epoch: startEpoch, barrierId };

      const redirectTo = resolveRedirectTarget();
      if (redirectTo === null) return annotate({ kind: "preparation_failed" }, context);

      // Step 3 — one provider preparation call. No navigation, no session.
      progress("preparing_google_flow", context);
      const prepared = await auth.prepareGoogleSignIn(redirectTo);
      if (prepared.kind === "temporarily_unavailable") {
        return annotate({ kind: "temporarily_unavailable" }, context);
      }
      if (prepared.kind !== "prepared") return annotate({ kind: "preparation_failed" }, context);

      // C1 — start-page epoch. A change here means NO stale attempt is persisted
      // and there is no navigation, even though one preparation call has happened.
      // Ownership is re-proved with it: a newer deliberate transition supersedes
      // this one even when it has not yet written its own barrier.
      const c1 = await proveCheckpoint(context, { barrierId, generation: startEpoch });
      if (!c1.ok) return annotate({ kind: "superseded" }, context);

      // Step 5 — the complete attempt, which only now can exist: the selector does
      // not come into being until preparation returns.
      progress("persisting_google_attempt", context);
      const attempt = createGoogleAttempt({
        attemptId: newId(),
        flowId: prepared.prepared.flowId,
        barrierId,
        capturedIdentityGeneration: startEpoch,
        startedAt: now(),
      });
      const attemptWritten = await persistAttemptSection(context, attempt);
      if (attemptWritten === "superseded") return annotate({ kind: "superseded" }, context);
      if (attemptWritten === "write_failed") {
        return annotate({ kind: "attempt_not_persisted" }, context);
      }
      context = { ...context, attemptId: attempt.attemptId };

      // C2 — immediately before navigation.
      const c2 = await proveCheckpoint(context, {
        barrierId,
        attemptId: attempt.attemptId,
        generation: startEpoch,
      });
      if (!c2.ok) return annotate({ kind: "superseded" }, context);

      progress("navigating_to_provider", context);
      const navigation = auth.navigateToAuthorizationUrl(prepared.prepared);
      if (navigation.kind !== "navigating") return annotate({ kind: "navigation_failed" }, context);

      // Navigation ends the start-page epoch. The callback page will begin a fresh
      // one.
      return annotate({ kind: "navigating" }, context);
    },

    async requestEmailOtp(email: string): Promise<OtpRequestOutcome> {
      let context = beginTransition();
      progress("establishing_identity_barrier", context);
      const established = await establishBarrier(context, {
        origin: "deliberate_authentication",
      });
      if (!established.ok) {
        return annotate(
          established.superseded
            ? { kind: "superseded" as const }
            : { kind: "barrier_not_established" as const },
          context
        );
      }

      const barrierId = established.barrier.barrierId;
      const epoch = liveGeneration.current();
      context = { ...context, epoch, barrierId };

      // OTP has no selector, so the COMPLETE attempt can be persisted before the
      // first provider call — and it is, so a failure here costs zero OTP requests
      // and zero verifications.
      const attempt = createEmailOtpAttempt({
        attemptId: newId(),
        barrierId,
        capturedIdentityGeneration: epoch,
        startedAt: now(),
      });
      const attemptWritten = await persistAttemptSection(context, attempt);
      if (attemptWritten === "superseded") return annotate({ kind: "superseded" }, context);
      if (attemptWritten === "write_failed") {
        return annotate({ kind: "attempt_not_persisted" }, context);
      }
      context = { ...context, attemptId: attempt.attemptId };

      progress("requesting_otp", context);
      const requested = await auth.requestEmailOtp(email);
      if (!requested.ok) return annotate(otpRequestOutcomeFor(requested.error), context);

      return annotate({ kind: "otp_requested" }, context);
    },

    async verifyEmailOtp(email: string, token: string): Promise<InteractiveCompletionOutcome> {
      // OWNERSHIP IS CLAIMED FIRST, before anything is read.
      //
      // Two concurrent verifications of the SAME barrier, the SAME attempt and the
      // SAME live generation satisfy every durable checkpoint simultaneously —
      // that is exactly what the durable protocol cannot order. The second call
      // here takes ownership, so the first stops at its next proof: it neither
      // writes trusted state, nor mutates intent state, nor returns ready, nor
      // announces another phase.
      const claimed = beginTransition();

      // C5 — immediately before verification, INCLUDING after the person's
      // waiting period, which may have been long enough for another tab to
      // supersede this attempt.
      const snapshot = await loadDurableSnapshot();
      if (snapshot.barrier.status !== "value" || snapshot.attempt.status !== "value") {
        return annotate({ kind: "superseded" }, claimed);
      }
      const barrier = snapshot.barrier.value;
      const attempt = snapshot.attempt.value;
      if (attempt.barrierId !== barrier.barrierId) return annotate({ kind: "superseded" }, claimed);
      if (attempt.method !== "email_otp") return annotate({ kind: "superseded" }, claimed);
      // OTP is a single same-page live operation: C5, C6 and C7 all compare
      // against the epoch the attempt itself captured. After a reload the live
      // counter has restarted at 0 while a persisted attempt's value is at least
      // 1, so an unfinished OTP flow cannot resume — by construction.
      const epoch = attempt.capturedIdentityGeneration;
      if (liveGeneration.current() !== epoch) return annotate({ kind: "superseded" }, claimed);

      const context: TransitionContext = {
        ...claimed,
        epoch,
        barrierId: barrier.barrierId,
        attemptId: attempt.attemptId,
      };
      // A newer operation may already have claimed ownership during the reads above.
      if (!ownsOperation(context)) return annotate({ kind: "superseded" }, context);

      progress("verifying_otp", context);
      const verified = await auth.verifyEmailOtp(email, token);
      if (!verified.ok) return annotate(completionFailureFor(verified.error), context);

      // C6 — after verification, before resolution persistence. A session already
      // exists at this point; the unresolved barrier is what keeps the app closed
      // if correlation has changed. Ownership is re-proved with it, because the
      // barrier and attempt alone cannot tell two verifications of this same
      // attempt apart.
      const c6 = await proveCheckpoint(context, {
        barrierId: barrier.barrierId,
        attemptId: attempt.attemptId,
        generation: epoch,
      });
      if (!c6.ok) {
        return annotate(
          { kind: c6.reason === "superseded" ? "superseded" : "correlation_changed" },
          context
        );
      }
      if (c6.attempt === null) return annotate({ kind: "correlation_changed" }, context);

      progress("finalizing_identity", context);
      const persisted = await persistResolutionAndCheck(context, {
        barrier: c6.barrier,
        attempt: c6.attempt,
        identity: verified.value,
        generation: epoch,
      });
      if (persisted.kind === "barrier_resolution_failed") {
        return annotate({ kind: "barrier_resolution_failed" }, context);
      }
      if (persisted.kind === "correlation_changed") {
        return annotate({ kind: "correlation_changed" }, context);
      }
      // C7 proved the durable set; ownership proves this is still the operation
      // entitled to act on it.
      if (!ownsOperation(context)) return annotate({ kind: "superseded" }, context);

      const result = await resolveAccessVerdict(
        {
          kind: "correlated",
          barrier: c6.barrier,
          attempt: c6.attempt,
          resolution: persisted.resolution,
        },
        { kind: "authenticated", identity: verified.value },
        context
      );
      return completionOutcomeFor(verified.value, result, context);
    },

    async submitOnboarding(input: CompleteOnboardingInput): Promise<OnboardingSubmissionOutcome> {
      // ---------------------------------------------------------------
      // ONE CONTINUOUS ACCOUNT IDENTITY (ADR-0025 §13, §16).
      //
      // The completion RPC runs as `auth.uid()`, so its result belongs to whichever
      // account the SDK's session names at the moment it runs. Reading the session
      // only afterwards — to find an account scope for the trusted record — would
      // let one Profile's completion be combined with another account's scope if a
      // session changed in between.
      //
      // So the account is captured BEFORE the RPC and re-proved AFTER it, and the
      // live epoch is bracketed too. No trusted record — and no other local record —
      // is written unless both still agree.
      // ---------------------------------------------------------------
      const context = beginTransition();
      const before = await auth.restoreSession();
      if (before.kind !== "authenticated") {
        return annotate({ kind: "temporarily_unavailable" }, context);
      }
      const startingAccountScopeId = before.identity.accountScopeId;

      progress("submitting_onboarding", context);
      const completed = await identityService.completeOnboarding(input);

      if (!completed.ok) {
        if (completed.error.kind === "stale_legal_version") {
          // Rotation between display and submission. NOTHING was written. Refetch
          // so the caller can re-display the new versions and reset its acceptance
          // controls; re-acceptance is unavoidable rather than optional.
          const refreshed = await legalSnapshot();
          if (refreshed === null || !canCompleteOnboarding(refreshed)) {
            return annotate({ kind: "legal_unavailable" }, context);
          }
          return annotate({ kind: "stale_legal_version", legal: refreshed }, context);
        }
        if (completed.error.kind === "legal_unavailable") {
          return annotate({ kind: "legal_unavailable" }, context);
        }
        if (completed.error.kind === "invalid_input") {
          return annotate({ kind: "invalid_input" }, context);
        }
        if (completed.error.kind === "network_error") {
          return annotate({ kind: "temporarily_unavailable" }, context);
        }
        return annotate({ kind: "submission_failed" }, context);
      }

      const eligibility = deriveGateEligibility(completed.value);
      if (eligibility.kind === "incomplete") {
        // The server reported success and the derived facts still do not add up.
        // Fail closed rather than opening on an inconsistent state.
        return annotate({ kind: "submission_failed" }, context);
      }

      // Re-prove the account. A transient or absent session cannot prove continuity,
      // so no local record is written and the caller retries.
      const after = await auth.restoreSession();
      if (after.kind !== "authenticated") {
        return annotate({ kind: "temporarily_unavailable" }, context);
      }

      if (after.identity.accountScopeId !== startingAccountScopeId) {
        // An unexpected session replaced the one this completion ran under. That is
        // ADR-0025 §13's Case B: deny, make the denial durable, and never accept the
        // new session as a fresh identity — and above all never persist a trusted
        // record combining this Profile with that account's scope.
        //
        // The ACTUAL invalidation result travels with the outcome. Assuming it
        // succeeded would let a barrier-save plus trusted-removal double failure be
        // reported as a completed durable denial.
        // The EXACT invalidation outcome travels, annotated with its denial, so a
        // barrier-save plus trusted-removal double failure cannot be read as a
        // completed durable denial and a failed intent deletion is not relabelled.
        const invalidation = await runInvalidation(context, after.identity.accountScopeId);
        if (!invalidation.begun) {
          // Overtaken before the denial began. Nothing was announced and nothing was
          // mutated — in particular, the account that has since authenticated is
          // untouched.
          return annotate({ kind: "temporarily_unavailable" }, context);
        }
        return annotate(
          { kind: "identity_changed", invalidation: invalidation.outcome },
          context
        );
      }

      progress("establishing_trusted_state", context);
      const written = await writeTrustedSection(context, after.identity, eligibility);
      if (written.kind === "superseded") {
        return annotate({ kind: "temporarily_unavailable" }, context);
      }
      if (written.kind === "write_failed") {
        return annotate({ kind: "trusted_state_not_established" }, context);
      }

      const settled = await settleIntentStateBeforeReady(context);
      if (settled !== null) {
        return settled.kind === "identity_unconfirmed"
          ? annotate({ kind: "temporarily_unavailable" }, context)
          : annotate({ kind: "intent_state_not_persisted" }, context);
      }

      const beforeReady = await guardStillCurrent(context);
      if (beforeReady !== null) return annotate({ kind: "temporarily_unavailable" }, context);

      return annotate(
        {
          kind: "completed",
          gate: { kind: "ready_online", session: sessionFor(after.identity, eligibility) },
        },
        context
      );
    },

    async refreshLegalSnapshot(): Promise<LegalRefreshOutcome> {
      progress("refreshing_legal_snapshot");
      const legal = await legalSnapshot();
      if (legal === null || !canCompleteOnboarding(legal)) return { kind: "legal_unavailable" };
      return { kind: "refreshed", legal };
    },

    async retryTrustedStateEstablishment(): Promise<InteractiveCompletionOutcome> {
      // ADR-0025 §15: a retry REVALIDATES the server-authoritative gate facts
      // before attempting the write again — it never rewrites from a remembered
      // result.
      // Ownership is claimed BEFORE the session read, so two overlapping retries —
      // and a retry overlapping a background revalidation — are ordered rather than
      // both proceeding to write trusted state.
      const context = beginTransition();
      const restore = await auth.restoreSession();
      if (restore.kind !== "authenticated") {
        return annotate({ kind: "temporarily_unavailable" }, context);
      }
      // The retry re-reads the trusted record so an account switch that failed
      // part-way through still has its required intent deletion enforced.
      const trustedNow = await trusted.load();
      const previousAccountScopeId =
        trustedNow.status === "value" ? trustedNow.value.accountScopeId : null;
      const result = await resolveAsFreshIdentity(
        restore.identity,
        { previousAccountScopeId },
        context
      );
      return completionOutcomeFor(restore.identity, result, context);
    },

    async signOut(): Promise<SignOutOutcome> {
      let context = beginTransition();
      progress("signing_out", context);

      // A READ, not a mutation: knowing which account is being barred makes the
      // barrier honest. No mutation happens before the barrier is written.
      const trustedBefore = await trusted.load();
      const barredAccountScopeId =
        trustedBefore.status === "value" ? trustedBefore.value.accountScopeId : null;

      // 1 — the barrier. On failure: no intent mutation, no trusted mutation, and
      // ZERO provider sign-out calls.
      const established = await establishBarrier(context, {
        origin: "explicit_sign_out",
        barredAccountScopeId,
      });
      if (!established.ok) {
        return annotate(
          established.superseded
            ? { kind: "superseded" as const }
            : { kind: "barrier_not_established" as const },
          context
        );
      }
      const barrierId = established.barrier.barrierId;
      context = { ...context, epoch: liveGeneration.current(), barrierId };

      // 2 — required: delete every ORDINARY pending intent. An intent marked for
      // invitation-account recovery is deliberately retained; it is by definition
      // not an ordinary pending intent.
      //
      // OWNERSHIP-CHECKED, like every step below. The barrier this sign-out wrote is
      // already durable, so the app is locked either way — but a newer operation's
      // intent and trusted state are not this sign-out's to mutate. Stopping here
      // leaves the durable barrier in force, which is the deny-ward direction; the
      // newer operation writes its own barrier and supersedes it in the normal way.
      const intentMutation = await inOwnedSection<IntentMutationOutcome>(
        context,
        { kind: "superseded" },
        () => intents.deleteOrdinaryIntents()
      );
      if (intentMutation.kind === "superseded") return annotate({ kind: "superseded" }, context);
      if (intentMutation.kind === "blocked") {
        return annotate({ kind: "intent_state_not_persisted" }, context);
      }

      // 3 — required: remove trusted state.
      const removal = await inOwnedSection<PersistenceRemoveResult | "superseded">(
        context,
        "superseded",
        () => trusted.remove()
      );
      if (removal === "superseded") return annotate({ kind: "superseded" }, context);
      if (!removal.ok) return annotate({ kind: "trusted_state_not_invalidated" }, context);

      // 4 — supersede the current interactive attempt. Best-effort by design: the
      // new barrier has ALREADY made any older attempt non-current, so this is
      // hygiene, and the repository refuses to remove an attempt bound to the
      // current barrier.
      await inSection(() => attempts.cleanUpNonCurrentAttempt(barrierId));

      // 5 — C8a, immediately before the provider call.
      const c8a = await proveCheckpoint(context, {
        barrierId,
        generation: liveGeneration.current(),
      });
      if (!c8a.ok) return annotate({ kind: "superseded" }, context);

      // 6 — the provider call, last. Its failure does not weaken the denial: the
      // durable barrier, not the provider call, is the latch.
      await auth.signOut();

      // 7 — C8b. A stale provider completion cannot resolve this barrier, because
      // only a correlated resolution can, and none is written here.
      await checkpoint({ barrierId, generation: liveGeneration.current() });

      // Deliberately NOT gated on ownership: the durable barrier is already
      // written, so this sign-out has already denied. A denial is reported even when
      // a newer operation has since taken over — the reducer applies it
      // unconditionally for the same reason.
      return annotate({ kind: "signed_out_locked" }, context);
    },

    async recoverInvitationAccount(invitation: PendingIntent): Promise<InvitationRecoveryOutcome> {
      let context = beginTransition();
      progress("signing_out", context);

      // SNAPSHOT THE ARGUMENT EXACTLY ONCE, before anything is decided from it. It
      // is untrusted at runtime, and two steps below read from it: the survival
      // mark and the "delete every OTHER ordinary intent" call. Reading it twice
      // would let a hostile or accessor-backed value have one `value` marked for
      // survival and a DIFFERENT one preserved from deletion.
      const preserved = validatePendingIntent(invitation);
      if (preserved === null) return annotate({ kind: "intent_state_not_persisted" }, context);

      const trustedBefore = await trusted.load();
      const barredAccountScopeId =
        trustedBefore.status === "value" ? trustedBefore.value.accountScopeId : null;

      // 2 — the barrier FIRST, so partial progress below is always safe.
      const established = await establishBarrier(context, {
        origin: "account_recovery",
        barredAccountScopeId,
      });
      if (!established.ok) {
        return annotate(
          established.superseded
            ? { kind: "superseded" as const }
            : { kind: "barrier_not_established" as const },
          context
        );
      }
      const barrierId = established.barrier.barrierId;
      context = { ...context, epoch: liveGeneration.current(), barrierId };

      // 3 — persist survival for EXACTLY this invitation. An admin-request intent
      // is refused by the repository: that link is not email-bound and has no
      // wrong-account outcome to recover from.
      // An intent already carrying an outstanding denial cleanup is refused by the
      // repository: a debt owed by a definitive denial is never converted into a
      // survival across a sign-out.
      const marked = await inOwnedSection<PersistenceWriteResult | "superseded">(
        context,
        "superseded",
        () => intents.markInvitationForRecovery(preserved)
      );
      if (marked === "superseded") return annotate({ kind: "superseded" }, context);
      if (!marked.ok) return annotate({ kind: "intent_state_not_persisted" }, context);

      // 4 — remove every OTHER ordinary intent.
      const others = await inOwnedSection<IntentMutationOutcome>(
        context,
        { kind: "superseded" },
        () => intents.deleteOtherOrdinaryIntents(preserved.value)
      );
      if (others.kind === "superseded") return annotate({ kind: "superseded" }, context);
      if (others.kind === "blocked") return annotate({ kind: "intent_state_not_persisted" }, context);

      // 5 — required: invalidate trusted state.
      const removal = await inOwnedSection<PersistenceRemoveResult | "superseded">(
        context,
        "superseded",
        () => trusted.remove()
      );
      if (removal === "superseded") return annotate({ kind: "superseded" }, context);
      if (!removal.ok) return annotate({ kind: "trusted_state_not_invalidated" }, context);

      // 6 — revalidate the barrier.
      const c = await proveCheckpoint(context, { barrierId, generation: liveGeneration.current() });
      if (!c.ok) return annotate({ kind: "superseded" }, context);

      // 7 — provider sign-out. Every local failure above produced ZERO calls here.
      await auth.signOut();

      // 8 — remain locked. Normal authentication and onboarding come next, and the
      // invitation preview is re-run server-side before anything is assumed about
      // eligibility.
      return annotate({ kind: "signed_out_locked" }, context);
    },

    async invalidateIdentity(): Promise<InvalidationOutcome> {
      const context = beginTransition();
      // No await occurs between claiming ownership and crossing the invalidation
      // threshold inside `runInvalidation`. The explicit API therefore either
      // begins a real denial or exposes an internal contract breach; it can never
      // honestly return a non-denial "trusted_state_not_invalidated" outcome.
      const run = await runInvalidation(context, undefined);
      if (!run.begun) {
        return annotate(
          {
            kind: "durable_denial_unavailable",
            denial: "durable_denial_unavailable",
            outstanding: ["durable_barrier", "trusted_state"],
          },
          context,
          "durable_denial_unavailable"
        );
      }
      return run.outcome;
    },

    async revalidateGateFacts(): Promise<RevalidationOutcome> {
      // ---------------------------------------------------------------
      // BACKGROUND, AND MODELLED AS SUCH (ADR-0025 §A).
      //
      // This operation runs while a ready session is already mounted, and it must
      // not take that session away except by a definitive negative. So it declares
      // `mode: "background"` and every result it returns carries that declaration:
      // the reducer keeps the existing ready state for a transient result, an
      // unconfirmed identity, a supersession and a failed metadata refresh, renders
      // none of its progress phases as a loading state, and moves to a denial only
      // for an actual invalidation. `identity_denied_in_memory` stays immediately
      // deny-ward — that is the one announcement a background operation still makes
      // visible, because §14 step 1 requires it from every state.
      //
      // None of that depends on a later UI layer remembering to suppress a generic
      // progress event.
      // ---------------------------------------------------------------
      const context = beginTransition({ mode: "background" });
      const invalidate = async (
        barredAccountScopeId: string | null
      ): Promise<RevalidationOutcome> => {
        const run = await runInvalidation(context, barredAccountScopeId);
        // A LATE definitive negative belonging to a superseded revalidation must not
        // revoke anything. By the time it arrives a deliberate transition may have
        // authenticated a different account entirely, and this result describes
        // neither that account nor that operation. `superseded` is non-denial, so the
        // reducer leaves the mounted session exactly as it is.
        if (!run.begun) return annotate({ kind: "superseded" }, context);
        return run.outcome;
      };

      const restore = await auth.restoreSession();

      if (restore.kind === "temporarily_unavailable" || restore.kind === "restore_failed") {
        // Transient. Explicitly NOT an invalidation: conflating the two would lock
        // out a legitimate device on a bad network.
        return annotate({ kind: "temporarily_unavailable" }, context);
      }
      if (restore.kind === "no_session" || restore.kind === "invalid_session") {
        return invalidate(null);
      }

      const identity = restore.identity;

      progress("resolving_gate_facts", context);
      const facts = await identityService.resolveGateFacts();
      if (!facts.ok) {
        if (isDefinitiveNegative(facts.error)) return invalidate(identity.accountScopeId);
        return annotate({ kind: "temporarily_unavailable" }, context);
      }

      const eligibility = deriveGateEligibility(facts.value);
      if (eligibility.kind === "incomplete") {
        // A previously trusted Profile that no longer satisfies the gate — a
        // revoked entitlement, a removed capability, a deleted Profile. A
        // definitive negative, learned online.
        return invalidate(identity.accountScopeId);
      }

      // ---------------------------------------------------------------
      // ADR-0025 §13. A background revalidation is UNCORRELATED by definition:
      // no barrier, no attempt and no resolution proves that a person deliberately
      // authenticated as anybody. It is therefore **Case B territory, never Case
      // A**. The only thing it may do to trusted state is CONFIRM an existing,
      // still-valid record for the very same identity — it may never establish or
      // replace one, because doing so would accept an unexpected session as a
      // fresh identity, which is precisely what Case B forbids.
      //
      // Case A remains available exactly where it belongs: an exact completed
      // correlation set in `resolveAccessVerdict`, which proves the transition.
      // ---------------------------------------------------------------
      // ONE section owns the trusted read, the identity-fact comparison and the
      // metadata write, so a superseded revalidation cannot replace trusted state
      // through a delayed adapter and cannot write a record it read before a newer
      // operation replaced it. `superseded` — not a transient failure — is the
      // honest report, and it leaves the mounted session exactly as it is.
      const written = await refreshTrustedSection(context, identity, eligibility);
      if (written.kind === "superseded") return annotate({ kind: "superseded" }, context);
      if (written.kind === "record_unusable") {
        // Absent, malformed or unreadable. A ready device always has a valid
        // record — `resolveAsFreshIdentity` writes one before any ready state — so
        // its disappearance or corruption here is a negative fact learned online,
        // not an invitation to mint a replacement.
        return invalidate(identity.accountScopeId);
      }
      if (written.kind === "facts_disagree") {
        // A different account scope is the obvious Case B. So is the same scope
        // resolving a DIFFERENT Profile, or a different completion fact: both are
        // stable identity facts in Stage B0.2, so disagreement means the session
        // and the record describe different people. Refreshing or reinterpreting
        // the record would silently combine one identity's server result with
        // another's local state.
        return invalidate(identity.accountScopeId);
      }
      if (written.kind === "write_failed") {
        // Explicitly NON-FATAL. The existing record is retained EXACTLY as it was,
        // no updated timestamp is fabricated, and no account scope, Profile
        // identity, onboarding or entitlement fact changes. The session continues.
        return annotate({ kind: "trusted_state_refresh_skipped" }, context);
      }
      if (!(await inSection(() => stillCurrent(context)))) {
        return annotate({ kind: "superseded" }, context);
      }
      return annotate(
        {
          kind: "resolved",
          identity,
          gate: { kind: "ready_online", session: sessionFor(identity, eligibility) },
        },
        context
      );
    },

    async discardPendingIntent(): Promise<IntentMutationOutcome> {
      // Unconditional and terminal, so it is not ownership-scoped — but it is a
      // write, and write ORDER still matters against a delayed adapter.
      const removal = await inSection(() => intents.deleteIntent());
      return removal.ok ? { kind: "applied" } : { kind: "blocked" };
    },

    async capturePendingIntent(intent: PendingIntent): Promise<IntentMutationOutcome> {
      // Capture does not claim transition ownership, but it must share the exact
      // mutation lane with invalidation cleanup. This closes the same-page race in
      // which save observes no tombstone, denial records one, and the delayed save
      // lands afterwards.
      const written = await inSection(() => intents.save(intent));
      return written.ok ? { kind: "applied" } : { kind: "blocked" };
    },

    async observeNewerBarrier(): Promise<BarrierObservation> {
      const loaded = await barriers.load();

      if (loaded.status === "read_failed") {
        // A failed read proves nothing. This handler reacts to an OBSERVED newer
        // barrier; it is not a periodic integrity check, and denying on an
        // unreadable read would turn a transient storage hiccup into a lockout.
        return { kind: "unchanged" };
      }

      const observedId = loaded.status === "value" ? loaded.value.barrierId : null;
      if (loaded.status !== "malformed" && observedId === lastKnownBarrierId) {
        return { kind: "unchanged" };
      }

      // Invalidate this page's in-flight work: a live attempt bound to the old
      // barrier can no longer complete.
      liveGeneration.bump();
      lastKnownBarrierId = observedId;
      return { kind: "newer_barrier" };
    },

    classifyAuthChange(change: NormalizedAuthChange): AuthChangeAdvice {
      // ADR-0025 §3, made structural: this function writes nothing, reads nothing
      // durable, and has no branch that could produce access. `signed_in` in
      // particular is `no_action` — the SDK persists the session and emits the
      // event before the calling code can evaluate correlation, so the event
      // carries no proof that THIS application transition succeeded.
      return change.reason === "signed_out"
        ? { kind: "invalidation_required" }
        : { kind: "no_action" };
    },
  };
}
