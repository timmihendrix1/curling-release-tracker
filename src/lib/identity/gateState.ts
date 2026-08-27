// The gate's vocabulary and its ONE pure reducer (ADR-0025 §1-§4, §14, §15; Stage
// B0.2c).
//
// This module owns four things, and owning them together is what keeps the
// dependency graph acyclic: the closed normalized OUTCOME set every coordinator
// transition resolves, the closed VERDICT set startup and completion conclude
// about access, the STATE union the UI renders, and the reducer that maps events
// onto states. The coordinator imports this module; this module imports nothing
// from the coordinator.
//
// `reduceGateState` is a pure `(state, event) => state`: the whole transition is
// computed as one plain value, outside any `setState`, and committed at once —
// the discipline `applyTimingResultToSession` establishes in
// src/lib/captureSequence.ts under ADR-0007. **An event that is invalid for the
// current state is a no-op, never a throw.**
//
// THREE PROPERTIES ARE STRUCTURAL HERE, NOT CONVENTIONAL:
//
//  1. **No provider auth change can open the application.** A
//     `provider_auth_change` event — `signed_in` included — returns the state
//     unchanged. Not "usually"; the reducer has no branch that could do otherwise.
//     This is what makes the SDK's persist-the-session-then-emit-then-resolve
//     ordering harmless (ADR-0025 §3).
//  2. **A ready state is reachable only from a state that was resolving
//     server-authoritative facts.** A ready verdict arriving while the gate is
//     locked, quarantined, signed out or merely intaking a callback is a no-op.
//  3. **A lock is never lifted by a non-lock verdict.** From `locked`,
//     `quarantined_locked` or `storage_unavailable_locked`, only another lock
//     verdict is accepted. Recovery is always a fresh deliberate transition, which
//     announces itself through its own progress phases — there is no "clear local
//     lock" affordance anywhere, and none may be added.

import type { AccountIdentity, NormalizedAuthChange } from "../supabase/authService";
import type { IdentityBarrierOrigin } from "./identityBarrier";
import type { LegalSnapshot } from "./legalSnapshot";
import type { OAuthReturnOutcome } from "./oauthReturnIntake";

/** What a ready gate carries. Contains no token, no session and no provider
 * object — only the stable facts the shell needs (ADR-0025 §G). */
export type GateSession = {
  accountScopeId: string;
  email: string | null;
  profileId: string;
  displayName: string;
  entitlement: "free";
};

/**
 * The page-lifetime identity AND ORDER of one coordinator operation.
 *
 * `id` distinguishes two operations; `sequence` orders them. Every operation the
 * coordinator starts takes a strictly higher `sequence` than every operation
 * started before it in this page lifetime, which is what makes "this report has
 * already been overtaken" decidable **without** relying on the order events
 * happen to arrive in, and without inferring anything from the state's kind.
 *
 * Both are in-memory and page-scoped. Neither is ever persisted, and neither is
 * authority for anything except this comparison — the durable protocol is still
 * barrier + attempt + resolution (ADR-0025 §7), and the live generation still has
 * its own separate role (§9).
 *
 * `mode` separates the two things an operation can be. A **foreground** operation
 * is one a person is waiting for, and its progress is what the gate renders. A
 * **background** operation is ADR-0025 §A's revalidation after optimistic entry:
 * it must never take a ready gate out of its ready state except by a definitive
 * negative, so it is modelled distinctly here rather than left for a UI layer to
 * suppress by hand.
 */
export type TransitionIdentity = {
  readonly id: string;
  readonly sequence: number;
  readonly mode: "foreground" | "background";
};

/**
 * Marks a result as produced by a **server-driven invalidation** (ADR-0025 §14).
 *
 * It exists because the exact outcome kind and "the app is denied" are two
 * different facts. `intent_state_not_persisted`, for instance, means one thing
 * after an explicit sign-out and quite another after the server said this identity
 * is no longer valid — and relabelling the latter to `identity_invalidated` in
 * order to make it deny would lose exactly the fact that a required cleanup is
 * still outstanding. So the kind stays exact and this marker carries the denial.
 */
export type DenialMarker = "server_identity_invalidated" | "durable_denial_unavailable";

/**
 * A REQUIRED step of a server-driven invalidation that did not complete
 * (ADR-0025 §14, §22). Closed set.
 *
 * Every failure is recorded, not just the first one. A denial that could neither
 * remove the trusted record nor delete the pending intent has **two** outstanding
 * facts, and reporting only the trusted-record failure would silently discard the
 * other — which is exactly the kind of loss the word "exact" must not paper over.
 */
export type InvalidationResidue =
  /** The unresolved invalidation barrier could not be written. */
  | "durable_barrier"
  /** The trusted device record could not be removed. */
  | "trusted_state"
  /** The required pending-intent deletion could not be completed. */
  | "pending_intent"
  /** The deletion failed AND its tombstone could not be recorded either, so the
   * debt is not durable. No claim is made that the stale intent cannot replay
   * after a future page load. */
  | "outstanding_cleanup_record";

export const INVALIDATION_RESIDUES: readonly InvalidationResidue[] = [
  "durable_barrier",
  "trusted_state",
  "pending_intent",
  "outstanding_cleanup_record",
];

/**
 * The ONE place a structured invalidation result is collapsed into a single
 * UI-facing kind.
 *
 * The full `outstanding` list is what travels; this derives the primary label from
 * it, in a fixed priority order, so no caller invents its own collapse and the
 * structured facts are never the thing that gets dropped.
 *
 * Priority: a simultaneous failure of **both** durable denial mechanisms is
 * `durable_denial_unavailable` — the only outcome that claims no durable
 * revocation. Otherwise a retained trusted record outranks a retained intent,
 * because the record is what could still be honoured. `durable_barrier` alone does
 * not lower the primary: removal succeeded, so a durable denial does exist.
 */
export function primaryInvalidationKind(
  outstanding: readonly InvalidationResidue[]
): InvalidationOutcome["kind"] {
  const failed = new Set<InvalidationResidue>(outstanding);
  if (failed.has("durable_barrier") && failed.has("trusted_state")) {
    return "durable_denial_unavailable";
  }
  if (failed.has("trusted_state")) return "trusted_state_not_invalidated";
  if (failed.has("pending_intent") || failed.has("outstanding_cleanup_record")) {
    return "intent_state_not_persisted";
  }
  return "identity_invalidated";
}

/**
 * The ordering and denial annotation every result of an ORDERED coordinator
 * operation carries.
 *
 * `transition` is absent only on a result no ordered operation produced. `denial`
 * is absent on every result that is not a server-driven invalidation.
 */
export type TransitionAnnotation = {
  readonly transition?: TransitionIdentity;
  readonly denial?: DenialMarker;
  /**
   * EVERY required invalidation step that did not complete, in
   * `INVALIDATION_RESIDUES` order. Present on every result a server-driven
   * invalidation produced — an empty array means the denial completed in full.
   *
   * The `kind` is the derived primary label (`primaryInvalidationKind`); this is
   * the complete fact. A caller that needs to know whether a cleanup is still owed
   * reads this, never the kind.
   */
  readonly outstanding?: readonly InvalidationResidue[];
};

/**
 * The closed normalized outcome of one coordinator transition (ADR-0025 §5.9's
 * taxonomy).
 *
 * Three members are implementation consequences of the specified taxonomy rather
 * than product decisions, and are marked as such below: `navigating`,
 * `otp_requested` and `invalid_input`. Each names a state the specified list
 * already describes elsewhere (`NavigationOutcome`'s `navigating`, the
 * `awaiting_otp` gate state, and `NormalizedAuthErrorKind`'s `invalid_input`); a
 * transition that reaches one of them has to be able to say so, and folding them
 * into a neighbouring kind would report something untrue.
 */
export type IdentityTransitionReport =
  // --- refused before anything happened -----------------------------------
  /** The fresh unresolved barrier could not be written. **Nothing began**: zero
   * provider calls, zero navigation, zero preceding local mutation. */
  | { kind: "barrier_not_established" }
  /** The complete attempt could not be persisted. For Google, exactly one
   * preparation call has already occurred; for OTP, zero requests and zero
   * verifications have. */
  | { kind: "attempt_not_persisted" }
  /** A required pending-intent mutation failed. **Zero provider sign-out
   * calls**; the app stays locked behind the already-written barrier. */
  | { kind: "intent_state_not_persisted" }
  /** Required trusted-state removal failed. **Zero provider sign-out calls.** */
  | { kind: "trusted_state_not_invalidated" }
  // --- server work succeeded, local durability did not --------------------
  /** Authentication, Profile, onboarding and entitlement may ALL have succeeded,
   * and the required trusted record still could not be written. **No ready state
   * is entered.** Retry revalidates the server facts before rewriting. */
  | { kind: "trusted_state_not_established" }
  /** NON-FATAL. A valid same-scope record exists and only its metadata refresh
   * failed: the existing record is retained unchanged, **no updated timestamp is
   * fabricated**, and no account scope, Profile identity, onboarding or
   * entitlement fact changes. The session continues. */
  | { kind: "trusted_state_refresh_skipped" }
  // --- provider-side -----------------------------------------------------
  | { kind: "preparation_failed" }
  /** A newer barrier or attempt became current, so this operation stopped. */
  | { kind: "superseded" }
  | { kind: "navigation_failed" }
  /** The provider reported a failure. Never carries raw provider text. */
  | { kind: "provider_error" }
  | { kind: "ambiguous_callback" }
  | { kind: "malformed_callback" }
  | { kind: "unowned_callback" }
  | { kind: "replayed_callback" }
  | { kind: "exchange_failed" }
  | { kind: "temporarily_unavailable" }
  /** Correlation changed between two checkpoints. No resolution was written, or
   * no ready-producing outcome was emitted. */
  | { kind: "correlation_changed" }
  /** The provider operation succeeded and the resolution could not be persisted.
   * The barrier stays unresolved and the app stays locked. */
  | { kind: "barrier_resolution_failed" }
  // --- denial ------------------------------------------------------------
  /** A definitive server negative was made durable (ADR-0025 §14). */
  | { kind: "identity_invalidated" }
  /** BOTH durable denial mechanisms failed. Access is denied for this page
   * lifetime and **no durable offline revocation is claimed**. */
  | { kind: "durable_denial_unavailable" }
  /** Sign-out (ordinary or invitation-recovery) completed its required local
   * mutations; the app is locked. Reported whether or not the provider call
   * itself succeeded, because the durable barrier — not the provider call — is
   * the latch. */
  | { kind: "signed_out_locked" }
  // --- success -----------------------------------------------------------
  /**
   * The exact current barrier was resolved AND the post-write checkpoint passed.
   *
   * `gate` is the verdict that binding the identity produced. It travels with the
   * outcome because "resolved" alone would be ambiguous: a resolution grants
   * nothing on its own, so the caller must never be able to read `resolved` and
   * conclude the app may open.
   */
  | {
      kind: "resolved";
      identity: AccountIdentity;
      gate: GateVerdict;
    }
  // --- implementation consequences of the taxonomy above -----------------
  /** Navigation to the provider began. The page is leaving; there is nothing
   * further to report. (`NavigationOutcome` already names this state.) */
  | { kind: "navigating" }
  /** The OTP was requested and the gate is now waiting for the code.
   * (The `awaiting_otp` gate state already names this state.) */
  | { kind: "otp_requested" }
  /** The provider rejected the supplied value as unusable — e.g. a malformed
   * email address. (`NormalizedAuthErrorKind` already names this kind; mapping it
   * to `provider_error` would blame the provider for a local input problem.) */
  | { kind: "invalid_input" };

/**
 * One transition's normalized outcome, annotated with the identity, order and
 * denial status of the operation that produced it.
 *
 * The annotation is deliberately an intersection rather than a member of the union
 * above: it applies to EVERY kind, including the failures, so that a stale report
 * from an overtaken operation can be recognized uniformly instead of only on the
 * one member that happens to carry an id.
 */
export type IdentityTransitionOutcome = IdentityTransitionReport & TransitionAnnotation;

/**
 * What a server-driven invalidation transition concluded (ADR-0025 §14). Defined
 * here rather than in the coordinator so an onboarding result can carry it without
 * an import cycle.
 *
 * **Every member denies**, and each names EXACTLY which required step of the
 * denial did not complete. `identity_invalidated` means all of them did; it is
 * never used as a stand-in for one of the others.
 */
export type InvalidationOutcome = Extract<
  IdentityTransitionReport,
  {
    kind:
      | "identity_invalidated"
      | "trusted_state_not_invalidated"
      | "intent_state_not_persisted"
      | "durable_denial_unavailable";
  }
> & TransitionAnnotation;

/** The outcome of submitting onboarding. Kept separate from
 * `IdentityTransitionOutcome` because onboarding submission is not a
 * barrier-guarded identity transition — it happens after one, on an already
 * authenticated identity. */
export type OnboardingSubmissionReport =
  | {
      kind: "completed";
      gate: GateVerdict;
    }
  /** The documents rotated between display and submission. **No writes
   * happened.** The caller must re-display the new versions and reset the
   * acceptance controls. */
  | { kind: "stale_legal_version"; legal: LegalSnapshot }
  | { kind: "legal_unavailable" }
  | { kind: "invalid_input" }
  | { kind: "trusted_state_not_established" }
  /** A required pending-intent mutation could not be proven; no ready state is
   * entered and no replay is promised. */
  | { kind: "intent_state_not_persisted" }
  /**
   * The account that completed onboarding is not the account the session now
   * names. The completion itself stands server-side, but no local record is
   * written for it: a trusted record combining one Profile with another account's
   * scope is exactly what this refuses to create.
   *
   * `invalidation` is the ACTUAL result of the denial transition that followed
   * (ADR-0025 §13 Case B, §14) — not an assumption that it succeeded. A
   * barrier-save plus trusted-removal double failure surfaces here as
   * `durable_denial_unavailable` and maps to `storage_unavailable_locked`, never
   * to a result claiming durable invalidation.
   */
  | { kind: "identity_changed"; invalidation: InvalidationOutcome }
  | { kind: "temporarily_unavailable" }
  | { kind: "submission_failed" };

/** Annotated with the identity, order and denial status of the operation that
 * produced it — see `IdentityTransitionOutcome`. */
export type OnboardingSubmissionOutcome = OnboardingSubmissionReport & TransitionAnnotation;

/** The outcome of refetching the Legal snapshot after a rotation. */
export type LegalRefreshOutcome =
  | { kind: "refreshed"; legal: LegalSnapshot }
  | { kind: "legal_unavailable" };

/**
 * What startup, or a completed transition, concludes about ACCESS. Exactly two
 * members grant it.
 */
export type GateVerdict =
  | { kind: "ready_online"; session: GateSession }
  | { kind: "ready_offline"; session: GateSession }
  | { kind: "onboarding_required"; legal: LegalSnapshot }
  /** A current Terms row is missing, so completion is refused. Distinct from an
   * invalid response. */
  | { kind: "onboarding_blocked_legal"; legal: LegalSnapshot }
  | { kind: "signed_out"; legal: LegalSnapshot }
  /** No current Privacy Notice, or the Legal response was invalid. Sign-in is not
   * offered. */
  | { kind: "legal_unavailable" }
  /** Identity could not be confirmed — fail closed. Recoverable by retrying when
   * conditions change; the trusted record, if any, is retained but not honoured. */
  | { kind: "identity_unconfirmed" }
  /** A barrier exists whose completed correlation set is missing, malformed,
   * stale or mismatched, and Phase 0 admitted no in-progress continuation. */
  | { kind: "quarantined_locked"; origin: IdentityBarrierOrigin | null }
  | { kind: "locked"; origin: IdentityBarrierOrigin | null }
  /** Browser storage supplied no durable write primitive when one was required.
   * Renders fixed copy and **claims no durable revocation**. */
  | { kind: "storage_unavailable_locked" }
  | { kind: "trusted_state_not_established" }
  /** A REQUIRED pending-intent mutation could not be proven — an ordinary account
   * switch could not delete the previous account's intents, or a recovery survival
   * marker could not be reset before gate-ready. No ready state is entered, and no
   * replay is promised. */
  | { kind: "intent_state_not_persisted" }
  | { kind: "cloud_unavailable" };

/**
 * A phase the coordinator announces while work is in flight. Each names exactly
 * one non-ready gate state, so a progress announcement can never open the app.
 */
export type GateProgressPhase =
  | "intaking_oauth_return"
  | "restoring_identity"
  | "consuming_oauth_return"
  | "finalizing_identity"
  | "ensuring_profile"
  | "resolving_gate_facts"
  | "establishing_trusted_state"
  | "establishing_identity_barrier"
  | "preparing_google_flow"
  | "persisting_google_attempt"
  | "navigating_to_provider"
  | "requesting_otp"
  | "verifying_otp"
  | "refreshing_legal_snapshot"
  | "submitting_onboarding"
  | "signing_out"
  /** ADR-0025 §14 step 1: deny in memory IMMEDIATELY, before any durable write is
   * even attempted. Accepted from every state, including a ready one. */
  | "identity_denied_in_memory";

/** §9.2's neutral callback-failure notice. `unusable_link` renders "that sign-in
 * link could not be used — please sign in again"; a replayed callback renders
 * nothing special, hence `none`. */
export type CallbackNotice = "none" | "unusable_link";

/**
 * The view the gate renders — the states an operation passes through on its way to
 * a possible ready verdict, plus the terminal ones.
 *
 * Ordering is carried alongside it by `GateOrdering`, not by individual members,
 * because EVERY state has to be able to recognize a stale report — including the
 * ready states and the locks, which no operation is "progressing through".
 */
export type GateStateView =
  | { kind: "cloud_unavailable" }
  | { kind: "legal_unavailable" }
  | { kind: "intaking_oauth_return" }
  | { kind: "restoring_identity" }
  | { kind: "quarantined_locked"; origin: IdentityBarrierOrigin | null; callbackNotice: CallbackNotice }
  | { kind: "storage_unavailable_locked" }
  | { kind: "establishing_identity_barrier" }
  | { kind: "preparing_google_flow" }
  | { kind: "persisting_google_attempt" }
  | { kind: "navigating_to_provider" }
  | { kind: "identity_unconfirmed" }
  | { kind: "signed_out"; legal: LegalSnapshot; callbackNotice: CallbackNotice }
  | { kind: "requesting_otp" }
  | { kind: "awaiting_otp" }
  | { kind: "verifying_otp" }
  | { kind: "consuming_oauth_return" }
  | { kind: "finalizing_identity" }
  | { kind: "ensuring_profile" }
  | { kind: "resolving_gate_facts" }
  | { kind: "onboarding_required"; legal: LegalSnapshot }
  | { kind: "submitting_onboarding" }
  | { kind: "refreshing_legal_snapshot" }
  | { kind: "onboarding_blocked_legal"; legal: LegalSnapshot }
  | { kind: "establishing_trusted_state" }
  | { kind: "ready_online"; session: GateSession }
  | { kind: "ready_offline"; session: GateSession }
  | { kind: "signing_out" }
  | { kind: "locked"; origin: IdentityBarrierOrigin | null; callbackNotice: CallbackNotice }
  /** A transition could not be completed. Fixed honest copy per its `reason`;
   * **the app never opens**, and no raw storage or provider text is shown. */
  | { kind: "recoverable_error"; reason: IdentityTransitionReport["kind"] };

/**
 * The page-lifetime ORDER a state carries, separately from what it renders.
 *
 * `transition` is the operation whose event produced this state, when one is
 * identified — the value `applyVerdict` demands an exact match against before a
 * ready verdict may be accepted from a non-ready state.
 *
 * `acceptedSequence` is a **high-water mark**: the highest operation sequence this
 * state has ever accepted an event from. It NEVER decreases, and it is carried
 * across events that carry no operation of their own (a cross-tab barrier
 * observation, a Legal refetch), so an overtaken operation cannot re-tag the gate
 * by arriving after one of them. It is what makes staleness a question of order
 * rather than of arrival time or state kind.
 */
export type GateOrdering = {
  readonly transition?: TransitionIdentity;
  readonly acceptedSequence?: number;
};

export type GateState = GateStateView & GateOrdering;

export type GateEvent =
  | { type: "cloud_unavailable" }
  | {
      type: "progress";
      phase: GateProgressPhase;
      /**
       * The identity and ORDER of the operation announcing this phase. Stored on
       * the resulting state and later compared against the annotation an outcome
       * carries.
       *
       * A phase announced by an operation the gate has already moved past is a
       * no-op, and a phase announced by a **background** operation never changes
       * what is rendered — it only advances the order mark.
       */
      transition?: TransitionIdentity;
    }
  /**
   * Startup finished. Carries BOTH the Phase 0 conclusion and the access verdict
   * as ONE event, so the verdict cannot silently overwrite the callback notice
   * the person needs to see — old state plus one event produces one new state.
   */
  | {
      type: "startup_completed";
      callback: OAuthReturnOutcome;
      verdict: GateVerdict;
      /**
       * The coordinator's `StartupOutcome.finalization`: what an ADMITTED Phase 0
       * continuation concluded, or `null`/absent when none was admitted. Only a
       * `resolved` finalization lets a ready verdict be accepted from a finishing
       * interactive state; every other value leaves the deny-ward rules intact.
       */
      finalization?: IdentityTransitionOutcome | null;
      /** Identity and order of the startup operation — `StartupOutcome.transition`. */
      transition?: TransitionIdentity;
    }
  | { type: "transition_settled"; outcome: IdentityTransitionOutcome }
  | { type: "onboarding_settled"; outcome: OnboardingSubmissionOutcome }
  | { type: "legal_refreshed"; outcome: LegalRefreshOutcome }
  /** Another tab installed a newer barrier. Denies from EVERY state. */
  | { type: "newer_barrier_observed" }
  /**
   * A normalized provider auth change. **Always a no-op.** It is an event here
   * only so that "the reducer receives provider events and still cannot open the
   * application" is a testable property rather than an absence.
   */
  | { type: "provider_auth_change"; change: NormalizedAuthChange };

export function initialGateState(): GateState {
  // Phase 0 has not run yet, and the gate blocks until it has. Naming that state
  // honestly — rather than starting at a neutral "loading" — is what stops a
  // first render from looking like "no callback arrived".
  return { kind: "intaking_oauth_return" };
}

const LOCK_STATES: ReadonlySet<GateState["kind"]> = new Set<GateState["kind"]>([
  "quarantined_locked",
  "locked",
  "storage_unavailable_locked",
]);

/**
 * The states a Legal-snapshot refetch is a meaningful thing to be doing from.
 *
 * A refetch exists to re-display rotated documents: after a `stale_legal_version`
 * submission, or from a screen that is already showing Legal metadata. It is
 * **never** part of an authentication transition, so from `verifying_otp`,
 * `finalizing_identity`, a ready session or a lock it must render nothing and
 * change nothing — otherwise a background refetch would replace the phase the
 * person is actually waiting on.
 */
const LEGAL_REFRESH_STATES: ReadonlySet<GateStateView["kind"]> = new Set<GateStateView["kind"]>([
  "onboarding_required",
  "onboarding_blocked_legal",
  "legal_unavailable",
  "signed_out",
  "refreshing_legal_snapshot",
]);

/**
 * The phases a DELIBERATE transition announces. These are the only progress
 * phases that may be observed from a lock state, because starting a fresh
 * authentication or a fresh sign-out from the locked screen is exactly how
 * recovery works (ADR-0025 §5.2a, §9.1).
 */
const DELIBERATE_TRANSITION_PHASES: ReadonlySet<GateProgressPhase> = new Set<GateProgressPhase>([
  "establishing_identity_barrier",
  "preparing_google_flow",
  "persisting_google_attempt",
  "navigating_to_provider",
  "requesting_otp",
  "verifying_otp",
  "signing_out",
]);

/** The order high-water mark a state carries. `0` before any ordered operation
 * has been observed, which no real operation ever uses. */
function acceptedSequenceOf(state: GateState): number {
  return state.acceptedSequence ?? 0;
}

/**
 * Whether an event announced by `transition` has already been overtaken.
 *
 * ORDER decides — not the order events arrive in, and not the kind of state the
 * gate happens to be sitting in. Each operation the coordinator starts takes a
 * strictly higher sequence, and every state remembers the highest sequence it has
 * accepted an event from, so a report from a lower sequence is by definition a
 * report from an operation a newer one has already superseded.
 *
 * An event with no operation of its own is never stale: a cross-tab barrier
 * observation and a `cloud_unavailable` report are not operations and are
 * deny-ward anyway.
 */
function isStale(state: GateState, transition: TransitionIdentity | undefined): boolean {
  if (transition === undefined) return false;
  return transition.sequence < acceptedSequenceOf(state);
}

/**
 * Commits a new view, carrying the order mark forward.
 *
 * The mark is the MAXIMUM of what the previous state carried and what this event
 * announced, so it never decreases — not even when an event carries no operation.
 */
function withOrdering(
  view: GateStateView,
  previous: GateState,
  transition: TransitionIdentity | undefined
): GateState {
  const accepted = Math.max(acceptedSequenceOf(previous), transition?.sequence ?? 0);
  // Neither key is written when it carries nothing: a state no ordered operation
  // has touched stays exactly the plain view it renders.
  if (transition === undefined && accepted === 0) return { ...view };
  if (transition === undefined) return { ...view, acceptedSequence: accepted };
  return { ...view, transition, acceptedSequence: accepted };
}

/**
 * Commits a new view for an event that belongs to NO ordered operation, carrying
 * the active operation's correlation forward untouched.
 *
 * A Legal-snapshot refetch deliberately claims no ownership (§9): refetching a
 * document cannot change who is authenticated, and letting it supersede a sign-in
 * would be a defect. But its events must not *erase* the ordered operation either.
 * `transition` is the proof `applyVerdict` demands before a ready verdict may be
 * accepted, so clearing it here would silently disqualify the rightful result of an
 * operation that is still running — the refetch would take the gate hostage without
 * ever claiming it.
 */
function carryOrdering(view: GateStateView, previous: GateState): GateState {
  return withOrdering(view, previous, previous.transition);
}

/**
 * Advances the order mark, leaving the rendered view exactly as it is.
 *
 * Used for a background operation's progress — which must not be visible — and for
 * the settled outcomes that deliberately render nothing. Returns the SAME object
 * when there is nothing to record, so "this event changed nothing" stays
 * observable by identity.
 *
 * A **background** operation deliberately does NOT become the state's `transition`.
 * That field is the correlation proof `applyVerdict` demands before a ready verdict
 * may be accepted from a non-ready state; letting a background revalidation claim
 * it would let one OPEN the gate from, say, `identity_unconfirmed`, bypassing the
 * pre-ready checks a deliberate transition has to pass. A background operation may
 * only ever refresh a gate that is already ready.
 */
function retagOrdering(state: GateState, transition: TransitionIdentity | undefined): GateState {
  if (transition === undefined) return state;
  const accepted = Math.max(acceptedSequenceOf(state), transition.sequence);
  const nextTransition = transition.mode === "background" ? state.transition : transition;
  if (state.transition === nextTransition && acceptedSequenceOf(state) === accepted) return state;
  return { ...state, transition: nextTransition, acceptedSequence: accepted };
}

/**
 * The outcomes that DENY, whatever else is true.
 *
 * They are applied unconditionally — never suppressed as stale, and never
 * suppressed because the announcing operation was a background revalidation.
 * Staleness exists to stop an overtaken operation from opening, refreshing or
 * un-denying the gate; suppressing a denial would invert its entire purpose. A
 * sign-out that has already written its durable barrier still locks even if a
 * newer operation started in the meantime.
 */
function denialFor(outcome: IdentityTransitionOutcome): GateStateView | null {
  if (outcome.denial === "durable_denial_unavailable") {
    return { kind: "storage_unavailable_locked" };
  }
  if (outcome.denial === "server_identity_invalidated") {
    return { kind: "locked", origin: "server_identity_invalidated", callbackNotice: "none" };
  }
  switch (outcome.kind) {
    case "signed_out_locked":
      return { kind: "locked", origin: "explicit_sign_out", callbackNotice: "none" };
    case "identity_invalidated":
    case "trusted_state_not_invalidated":
      // Denied either way. `trusted_state_not_invalidated` during invalidation
      // still leaves the unresolved invalidation barrier authoritative.
      return { kind: "locked", origin: "server_identity_invalidated", callbackNotice: "none" };
    case "durable_denial_unavailable":
      // Both durable mechanisms failed. Denied for this page lifetime, stated
      // honestly, with no claim of durable revocation.
      return { kind: "storage_unavailable_locked" };
    default:
      return null;
  }
}

function isLock(state: GateState): boolean {
  return LOCK_STATES.has(state.kind);
}

function isLockVerdict(verdict: GateVerdict): boolean {
  return (
    verdict.kind === "locked" ||
    verdict.kind === "quarantined_locked" ||
    verdict.kind === "storage_unavailable_locked"
  );
}

function isReadyVerdict(verdict: GateVerdict): boolean {
  return verdict.kind === "ready_online" || verdict.kind === "ready_offline";
}

/** §9.2: `unowned_callback`, `ambiguous_callback`, `malformed_callback` and
 * `correlation_changed` render the neutral "that sign-in link could not be used"
 * notice. `no_return`, `succeeded` and `replayed_callback` render nothing
 * special. */
function noticeFor(callback: OAuthReturnOutcome): CallbackNotice {
  switch (callback.kind) {
    case "unowned_callback":
    case "ambiguous_callback":
    case "malformed_callback":
    case "correlation_changed":
    case "exchange_failed":
    case "provider_error":
      return "unusable_link";
    default:
      return "none";
  }
}

function stateForPhase(phase: GateProgressPhase): GateStateView {
  switch (phase) {
    case "intaking_oauth_return":
      return { kind: "intaking_oauth_return" };
    case "restoring_identity":
      return { kind: "restoring_identity" };
    case "consuming_oauth_return":
      return { kind: "consuming_oauth_return" };
    case "finalizing_identity":
      return { kind: "finalizing_identity" };
    case "ensuring_profile":
      return { kind: "ensuring_profile" };
    case "resolving_gate_facts":
      return { kind: "resolving_gate_facts" };
    case "establishing_trusted_state":
      return { kind: "establishing_trusted_state" };
    case "establishing_identity_barrier":
      return { kind: "establishing_identity_barrier" };
    case "preparing_google_flow":
      return { kind: "preparing_google_flow" };
    case "persisting_google_attempt":
      return { kind: "persisting_google_attempt" };
    case "navigating_to_provider":
      return { kind: "navigating_to_provider" };
    case "requesting_otp":
      return { kind: "requesting_otp" };
    case "verifying_otp":
      return { kind: "verifying_otp" };
    case "refreshing_legal_snapshot":
      return { kind: "refreshing_legal_snapshot" };
    case "submitting_onboarding":
      return { kind: "submitting_onboarding" };
    case "signing_out":
      return { kind: "signing_out" };
    case "identity_denied_in_memory":
      // The in-memory denial of ADR-0025 §14 step 1, before any durable write has
      // been attempted. A later outcome may refine it (to
      // `storage_unavailable_locked` when both durable mechanisms failed), but
      // access is already denied here.
      return { kind: "locked", origin: "server_identity_invalidated", callbackNotice: "none" };
  }
}

function stateForVerdict(verdict: GateVerdict, notice: CallbackNotice): GateStateView {
  switch (verdict.kind) {
    case "ready_online":
      return { kind: "ready_online", session: verdict.session };
    case "ready_offline":
      return { kind: "ready_offline", session: verdict.session };
    case "onboarding_required":
      return { kind: "onboarding_required", legal: verdict.legal };
    case "onboarding_blocked_legal":
      return { kind: "onboarding_blocked_legal", legal: verdict.legal };
    case "signed_out":
      return { kind: "signed_out", legal: verdict.legal, callbackNotice: notice };
    case "legal_unavailable":
      return { kind: "legal_unavailable" };
    case "identity_unconfirmed":
      return { kind: "identity_unconfirmed" };
    case "quarantined_locked":
      return { kind: "quarantined_locked", origin: verdict.origin, callbackNotice: notice };
    case "locked":
      return { kind: "locked", origin: verdict.origin, callbackNotice: notice };
    case "storage_unavailable_locked":
      return { kind: "storage_unavailable_locked" };
    case "trusted_state_not_established":
      return { kind: "recoverable_error", reason: "trusted_state_not_established" };
    case "intent_state_not_persisted":
      return { kind: "recoverable_error", reason: "intent_state_not_persisted" };
    case "cloud_unavailable":
      return { kind: "cloud_unavailable" };
  }
}

/**
 * Applies a verdict under the two access rules.
 *
 * **Rule 1 — a ready verdict needs CORRELATION PROOF, not a plausible state kind.**
 * An operation can legitimately reach `finalizing_identity` (or any other
 * progression state) and go on to earn a ready result. But a state kind alone
 * proves nothing: an OLDER operation can finish its own asynchronous work and
 * return `resolved` while a NEWER transition is already occupying the same kind.
 * So the operation the result carries must be exactly the operation the current
 * state was tagged with. A result with no operation, or with another one's, is a
 * no-op.
 *
 * The single exception is an existing ready state, where a confirmation refreshes
 * what is already true without a visible flicker. It cannot OPEN anything — the
 * gate is already open — and a stale confirmation has been rejected before this
 * function is reached.
 *
 * **Rule 2 — a lock is never lifted by a non-lock verdict.** Recovery is always a
 * fresh deliberate transition, which announces itself through its own progress
 * phases; there is no "clear local lock" affordance anywhere.
 */
function applyVerdict(
  state: GateState,
  verdict: GateVerdict,
  notice: CallbackNotice,
  transition: TransitionIdentity | undefined
): GateState {
  if (isReadyVerdict(verdict)) {
    const alreadyReady = state.kind === "ready_online" || state.kind === "ready_offline";
    const proven =
      transition !== undefined &&
      state.transition !== undefined &&
      state.transition.id === transition.id;
    if (!alreadyReady && !proven) return state;
  }
  if (isLock(state) && !isLockVerdict(verdict)) return state;
  return withOrdering(stateForVerdict(verdict, notice), state, transition);
}

function stateForOutcome(state: GateState, outcome: IdentityTransitionOutcome): GateState {
  const transition = outcome.transition;

  // DENIALS FIRST, and unconditionally. See `denialFor`.
  const denial = denialFor(outcome);
  if (denial !== null) return withOrdering(denial, state, transition);

  // An overtaken operation may not touch anything else. This is the settling half
  // of the same rule the `progress` branch applies.
  if (isStale(state, transition)) return state;

  // BACKGROUND REVALIDATION (ADR-0025 §A) keeps the existing ready session
  // mounted. Its only non-denial effect is a same-identity confirmation, which
  // refreshes the ready session in place; a transient result, an unconfirmed
  // identity, a supersession and a failed metadata refresh all leave the state
  // exactly as it is. That is modelled HERE, in the reducer contract, rather than
  // left to a UI layer to suppress by hand.
  if (transition?.mode === "background") {
    if (outcome.kind !== "resolved") return retagOrdering(state, transition);
    if (!isReadyVerdict(outcome.gate)) return retagOrdering(state, transition);
    // It may REFRESH a mounted ready session; it may never OPEN the gate. Opening
    // is reserved for a deliberate transition, which is the only kind that runs the
    // pre-ready trusted-state and pending-intent checks.
    const alreadyReady = state.kind === "ready_online" || state.kind === "ready_offline";
    if (!alreadyReady) return retagOrdering(state, transition);
    return withOrdering(stateForVerdict(outcome.gate, "none"), state, undefined);
  }

  switch (outcome.kind) {
    case "resolved":
      // The exact current barrier was resolved and C7 passed — and the result
      // carries the identity of the operation that earned it.
      return applyVerdict(state, outcome.gate, "none", transition);

    case "otp_requested":
      // Only meaningful while an OTP request was in flight; anywhere else it is a
      // stale report and must not change what the person is looking at.
      return state.kind === "requesting_otp"
        ? withOrdering({ kind: "awaiting_otp" }, state, transition)
        : state;

    case "navigating":
      // The page is leaving. Nothing to change, and nothing to claim.
      return retagOrdering(state, transition);

    case "trusted_state_refresh_skipped":
      // Explicitly NON-FATAL (ADR-0025 §15): the previously valid record is
      // retained unchanged and the session continues. Rendering anything here
      // would tell the person about a metadata write they cannot act on.
      return retagOrdering(state, transition);

    case "replayed_callback":
      // Nothing special to render.
      return retagOrdering(state, transition);

    default:
      // Every remaining member is a start/finalization or callback failure. The
      // app never opens; §9.2's fixed honest copy is selected by `reason`, and no
      // raw storage or provider text travels with it.
      //
      // A LOCK is not replaced: a failed recovery attempt leaves the person on
      // the locked screen they started from, which is the honest picture — the
      // durable barrier is still in force.
      return isLock(state)
        ? state
        : withOrdering({ kind: "recoverable_error", reason: outcome.kind }, state, transition);
  }
}

function stateForOnboardingOutcome(
  state: GateState,
  outcome: OnboardingSubmissionOutcome
): GateState {
  const transition = outcome.transition;

  if (outcome.kind === "identity_changed") {
    // Denied either way — but only the ACTUAL invalidation result decides how, and
    // its exact outcome kind is preserved rather than relabelled. A double durable
    // failure claims no revocation. Applied unconditionally: a denial is never
    // suppressed as stale.
    return withOrdering(
      denialFor(outcome.invalidation) ?? {
        kind: "locked",
        origin: "server_identity_invalidated",
        callbackNotice: "none",
      },
      state,
      transition
    );
  }

  if (isStale(state, transition)) return state;

  switch (outcome.kind) {
    case "completed":
      return applyVerdict(state, outcome.gate, "none", transition);
    case "stale_legal_version":
      // Refetched and re-displayed. The caller resets its acceptance controls;
      // returning to `onboarding_required` with the NEW snapshot is what makes
      // re-acceptance unavoidable rather than optional.
      return withOrdering(
        { kind: "onboarding_required", legal: outcome.legal },
        state,
        transition
      );
    case "legal_unavailable":
      return withOrdering({ kind: "legal_unavailable" }, state, transition);
    case "trusted_state_not_established":
      return withOrdering(
        { kind: "recoverable_error", reason: "trusted_state_not_established" },
        state,
        transition
      );
    case "intent_state_not_persisted":
      return withOrdering(
        { kind: "recoverable_error", reason: "intent_state_not_persisted" },
        state,
        transition
      );
    case "temporarily_unavailable":
      return withOrdering(
        { kind: "recoverable_error", reason: "temporarily_unavailable" },
        state,
        transition
      );
    case "invalid_input":
      return withOrdering(
        { kind: "recoverable_error", reason: "invalid_input" },
        state,
        transition
      );
    case "submission_failed":
      return withOrdering(
        { kind: "recoverable_error", reason: "provider_error" },
        state,
        transition
      );
  }
}

export function reduceGateState(state: GateState, event: GateEvent): GateState {
  switch (event.type) {
    case "cloud_unavailable":
      return withOrdering({ kind: "cloud_unavailable" }, state, undefined);

    case "newer_barrier_observed":
      // Deny-ward from EVERY state, including a ready one. The honest limitation
      // (ADR-0025 §8) is that cross-tab delivery is not instantaneous — the
      // guarantee is that each tab denies once it OBSERVES the newer barrier, and
      // that a stale operation can never persistently resolve or supersede it.
      return withOrdering({ kind: "locked", origin: null, callbackNotice: "none" }, state, undefined);

    case "provider_auth_change":
      // ADR-0025 §3, enforced by construction: no normalized provider change —
      // `signed_in` included — resolves a barrier or produces a ready state.
      return state;

    case "progress": {
      const transition = event.transition;
      if (event.phase === "identity_denied_in_memory") {
        // ADR-0025 §14 step 1 stays immediately deny-ward from EVERY state,
        // including a ready one and including when the announcing operation has
        // been overtaken or is a background revalidation. A denial is never
        // suppressed.
        return withOrdering(stateForPhase(event.phase), state, transition);
      }
      if (isStale(state, transition)) return state;
      if (transition?.mode === "background") {
        // A background revalidation is not a loading transition and must never
        // become one: the existing ready session stays mounted throughout. The
        // phase still advances the order mark, so the operation remains orderable.
        return retagOrdering(state, transition);
      }
      if (event.phase === "refreshing_legal_snapshot") {
        // Announced by an operation that claims no ownership, so it is accepted
        // only where a refetch is meaningful — and even there it carries the active
        // operation's correlation forward rather than replacing it.
        return LEGAL_REFRESH_STATES.has(state.kind)
          ? carryOrdering(stateForPhase(event.phase), state)
          : state;
      }
      if (isLock(state) && !DELIBERATE_TRANSITION_PHASES.has(event.phase)) return state;
      return withOrdering(stateForPhase(event.phase), state, transition);
    }

    case "startup_completed": {
      // `finalization` is retained for copy selection; the ACCESS decision rests on
      // the announcing operation's identity and order alone.
      if (isStale(state, event.transition)) return state;
      return applyVerdict(state, event.verdict, noticeFor(event.callback), event.transition);
    }

    case "transition_settled":
      return stateForOutcome(state, event.outcome);

    case "onboarding_settled":
      return stateForOnboardingOutcome(state, event.outcome);

    case "legal_refreshed":
      // Same rule as the phase above: a refetch may only conclude where a refetch
      // was a meaningful thing to be doing. Applying it from `verifying_otp` would
      // discard the authentication the person is waiting on — and would do so on
      // behalf of an operation that never claimed the right to.
      if (!LEGAL_REFRESH_STATES.has(state.kind)) return state;
      return carryOrdering(
        event.outcome.kind === "refreshed"
          ? { kind: "onboarding_required", legal: event.outcome.legal }
          : { kind: "legal_unavailable" },
        state
      );
  }
}

/** Whether the application shell may mount. Exactly two states, checked in one
 * place so no component can invent its own definition of "ready". */
export function isGateReady(state: GateState): boolean {
  return state.kind === "ready_online" || state.kind === "ready_offline";
}
