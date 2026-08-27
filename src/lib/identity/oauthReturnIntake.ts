// Phase 0 — OAuth return intake, as a PURE decision (ADR-0025 §4; Stage B0.2c).
//
// WHY PHASE 0 EXISTS AT ALL. A genuine Google callback necessarily arrives with a
// valid unresolved barrier, a valid matching attempt, and **no resolution yet** —
// because the resolution is what the return is coming back to create. A protocol
// that locked "valid barrier + missing resolution" would deadlock the very flow it
// was meant to protect. So a legitimate full-page return is the **intentional
// durable continuation mechanism**, not a lost live session. A reload *without* a
// callback candidate is a different case and does render locked recovery.
//
// WHY THIS FILE IS PURE. Separating the DECISION from the EFFECTS is what makes
// "branches C, D, E, F and G perform zero exchanges and create no resolution" a
// property of the code rather than a claim about it: this module cannot exchange
// anything, cannot write anything and cannot remove anything — it has no
// dependencies capable of it. In particular, "a stale callback leaves the newer
// valid attempt intact" holds by construction, because nothing here can touch an
// attempt.
//
// ORDERING, WHICH THE COORDINATOR OWNS. capture -> classify -> clean the URL all
// happen synchronously, in `initializeCallbackCapture()`
// (src/lib/supabase/supabaseCallbackCapture.ts), BEFORE the first durable read and
// therefore before any asynchronous work. This module receives the already-captured
// candidate and the already-loaded durable records.

import type { AccountIdentity } from "../supabase/authService";
import type { CallbackCandidate } from "../supabase/supabaseCallbackCapture";
import type { IdentityRecordLoad } from "./errors";
import type { IdentityAccessBarrier } from "./identityBarrier";
import {
  isStructurallyCorrelated,
  type IdentityBarrierResolution,
} from "./identityBarrierResolution";
import type { InteractiveAuthAttempt } from "./interactiveAttempt";

/**
 * The closed set of outcomes an OAuth return can produce, end to end (ADR-0025
 * §12). `succeeded` is the only one this module cannot produce — it requires an
 * actual exchange, which is the coordinator's effectful part.
 */
export type OAuthReturnOutcome =
  | { kind: "no_return" }
  | { kind: "succeeded"; identity: AccountIdentity }
  /** The provider reported a failure. Carries no raw provider text — the
   * classifier discarded it before this point. */
  | { kind: "provider_error" }
  | { kind: "ambiguous_callback" }
  | { kind: "malformed_callback" }
  | { kind: "unowned_callback" }
  | { kind: "replayed_callback" }
  | { kind: "correlation_changed" }
  | { kind: "exchange_failed" }
  | { kind: "temporarily_unavailable" };

/**
 * The durable records as they were read at intake.
 *
 * `resolution` is `null` when there was no valid current barrier to derive a
 * resolution key from — that is a different statement from "the resolution is
 * absent", and conflating them would let a corrupt barrier look like a clean
 * unresolved one.
 */
export type DurableCorrelationSnapshot = {
  barrier: IdentityRecordLoad<IdentityAccessBarrier>;
  attempt: IdentityRecordLoad<InteractiveAuthAttempt>;
  resolution: IdentityRecordLoad<IdentityBarrierResolution> | null;
};

/**
 * Which of ADR-0025 §4's seven exhaustive branches this arrival fell into. Carried
 * on every decision so a test — and a reviewer — can name the branch rather than
 * inferring it from the resulting `kind`, and so the exhaustiveness is visible.
 */
export type OAuthIntakeBranch = "A" | "B" | "C" | "D" | "E" | "F" | "G";

export type OAuthIntakeDecision =
  /** **A** — nothing arrived. Continue to ordinary Phase A. */
  | { kind: "no_return"; branch: "A" }
  /**
   * **B** — an admissible in-progress continuation. The coordinator may exchange
   * EXACTLY ONCE, using `expectedFlowId`, then persist the resolution for
   * `barrier`.
   *
   * A missing resolution is EXPECTED here and must not quarantine.
   */
  | {
      kind: "admit_continuation";
      branch: "B";
      barrier: IdentityAccessBarrier;
      attempt: InteractiveAuthAttempt;
      /** The selector, already proven equal on both the callback and the persisted
       * attempt. The exchange boundary requires an explicit selector and never
       * falls back to "the most recently stored verifier". */
      expectedFlowId: string;
    }
  /** **C** — a correlated provider error. No exchange; the barrier stays
   * unresolved and the application stays locked, offering a fresh attempt. */
  | { kind: "provider_error"; branch: "C" }
  /**
   * **D** — a candidate that does not match the current barrier or attempt, or a
   * current barrier whose resolution is present but not exactly correlated.
   * **G** — a candidate with no valid current barrier, or no valid attempt at all.
   *
   * Both are `unowned_callback` with identical behaviour: zero exchanges, no
   * resolution, any newer valid attempt left intact, and never a substitute for
   * ordinary session restoration. The branch letter is recorded only to keep
   * ADR-0025 §4's table traceable.
   */
  | { kind: "unowned_callback"; branch: "D" | "G" }
  /** **E** — the current barrier already has an exact, structurally correlated
   * resolution. A replay or otherwise non-authoritative return: zero exchanges,
   * and **the existing valid resolved set is not invalidated**. */
  | { kind: "replayed_callback"; branch: "E" }
  /** **F** — ambiguous. Zero exchanges, no identity, no resolution. */
  | { kind: "ambiguous_callback"; branch: "F" }
  /** **F** — malformed, including an owned implicit-grant fragment and a
   * fail-closed capture. Zero exchanges, no identity, no resolution. */
  | { kind: "malformed_callback"; branch: "F" };

/**
 * Decides Phase 0 admissibility. Total, pure, and side-effect-free.
 *
 * The shape checks come FIRST, before any durable state is consulted, because
 * ADR-0025 §4 requires that an ambiguous or malformed return "must not become an
 * authentication source" **even when another valid state exists**. Deciding that
 * from the candidate alone is what makes it unconditional.
 */
export function decideOAuthIntake(
  candidate: CallbackCandidate,
  durable: DurableCorrelationSnapshot
): OAuthIntakeDecision {
  if (candidate.kind === "no_return") return { kind: "no_return", branch: "A" };
  if (candidate.kind === "ambiguous_callback") return { kind: "ambiguous_callback", branch: "F" };
  if (candidate.kind === "malformed_callback") return { kind: "malformed_callback", branch: "F" };

  // A success or provider-error candidate from here on. Both need an owning
  // barrier before they mean anything at all.
  if (durable.barrier.status !== "value") {
    // No valid current barrier — absent, malformed, or unreadable. The callback
    // is never a substitute for restoration; a malformed or unreadable barrier
    // additionally makes Phase A quarantine, which is the fail-closed direction
    // for a record that only ever denies.
    return { kind: "unowned_callback", branch: "G" };
  }
  const barrier = durable.barrier.value;

  const attempt = durable.attempt.status === "value" ? durable.attempt.value : null;

  // The barrier must be cleanly UNRESOLVED for branches B and C to apply. Any
  // other resolution state is handled before them, so the three are mutually
  // exclusive rather than ordered by preference.
  const resolution = durable.resolution;
  if (resolution === null || resolution.status !== "absent") {
    if (
      resolution !== null &&
      resolution.status === "value" &&
      attempt !== null &&
      isStructurallyCorrelated(barrier, attempt, resolution.value)
    ) {
      // Branch E: an exact resolved set already exists. This arrival is a replay
      // or otherwise non-authoritative, and must not invalidate that set.
      return { kind: "replayed_callback", branch: "E" };
    }
    // A resolution that is present-but-not-exact, malformed, unreadable, or
    // unaddressable. Zero exchanges: the durable set is not something this
    // callback can complete, and Phase A will quarantine it.
    return { kind: "unowned_callback", branch: "D" };
  }

  if (attempt === null) {
    // A cleanly unresolved barrier with no usable attempt. Nothing can prove this
    // callback belongs to this barrier.
    return { kind: "unowned_callback", branch: "G" };
  }

  // Exact correlation, checked in full BEFORE any exchange may be considered.
  // Each condition is its own statement because each closes a different hole.

  // The attempt was started against an older barrier: it can never resolve this
  // one, and exchanging against its selector would destroy a verifier that the
  // current barrier's own attempt may still need.
  if (attempt.barrierId !== barrier.barrierId) return { kind: "unowned_callback", branch: "D" };

  // An email-OTP attempt has no callback at all, so a callback claiming to
  // continue one is not ours.
  if (attempt.method !== "google") return { kind: "unowned_callback", branch: "D" };

  const expectedFlowId = attempt.flowId;
  // Unreachable for a validated Google attempt (the validator requires a
  // selector), and checked anyway: a Google attempt with no selector could never
  // be correlated, and the alternative — exchanging without an explicit selector
  // — is prohibited everywhere, because the SDK would consume the most recently
  // stored verifier and a failed exchange removes the verifier it selected.
  if (expectedFlowId === null) return { kind: "unowned_callback", branch: "D" };

  // THE decisive comparison: the selector the provider round-tripped must equal
  // the one this application persisted before navigating. **There is no
  // fallback.** A stale callback reaching here is `unowned_callback` with zero
  // exchanges, which is what leaves a newer valid attempt intact.
  if (expectedFlowId !== candidate.flowId) return { kind: "unowned_callback", branch: "D" };

  if (candidate.kind === "provider_error_candidate") {
    return { kind: "provider_error", branch: "C" };
  }

  return {
    kind: "admit_continuation",
    branch: "B",
    barrier,
    attempt,
    expectedFlowId,
  };
}
