// The provider-neutral identity/legal service contract (ADR-0025 §16, §17; Stage
// B0.2c) over the four Stage B0.2a RPCs
// (supabase/migrations/20260825120200_identity_onboarding_functions.sql):
//
//   get_current_legal_documents()  ->  getLegalSnapshot()
//   ensure_my_profile()            ->  ensureProfile()
//   get_my_gate_state()            ->  resolveGateFacts()
//   complete_personal_onboarding() ->  completeOnboarding()
//
// Deliberately contains no `@supabase/supabase-js` import and no client type. The
// coordinator depends only on this interface; the real implementation
// (src/lib/supabase/supabaseIdentityService.ts) and the in-memory fake
// (fakeIdentityService.ts) are injected — the same discipline
// `src/lib/team/teamService.ts` and the `TimingProvider` boundary (ADR-0006)
// establish. Every method RESOLVES an `IdentityResult` and never rejects.
//
// FOUR SEPARATE FACTS (ADR-0025 §16). A Profile existing, a completed onboarding,
// Athlete capability and an active Free entitlement are four different things.
// `ensureProfile()` creates or resolves a **bare** Profile and grants none of the
// others; a bare Profile passes no gate. Gate eligibility is **derived** from all
// four by `deriveGateEligibility` below — there is no stored "eligible" boolean
// anywhere, in the database or here.

import type { IdentityResult } from "./errors";
import type { CompleteOnboardingInput, LegalSnapshot } from "./legalSnapshot";

/** What `ensure_my_profile()` resolves: platform identity only. `displayName` is
 * `null` until onboarding completes — the bare Profile has no name yet, and that
 * absence is a fact, not a defect. */
export type BareProfile = {
  /** The application-owned `profiles.id`. **Never** the auth-provider user id —
   * ADR-0024's scope key for athlete-owned data is this value. */
  profileId: string;
  displayName: string | null;
};

/** The exact legal evidence a completed onboarding was justified by. Immutable:
 * a later document version never rewrites it and never forces re-acceptance
 * (ADR-0025 §17 — that policy is explicitly undecided and not settled here). */
export type PinnedLegalEvidence = {
  acceptanceId: string;
  documentId: string;
  versionLabel: string;
  actedAt: string;
};

/**
 * Everything `get_my_gate_state()` reports, all of it derived server-side on read.
 *
 * `profileId: null` is the honest answer for an authenticated account that has no
 * Profile at all — the RPC always returns exactly one row rather than an empty
 * result the caller would have to interpret.
 *
 * The `current*` fields are **reporting only** and are deliberately plain
 * `string`s, NOT `LegalDocumentId`s. That is a type-level barrier, not a comment:
 * a `currentTermsDocumentId` can never be passed where completion evidence is
 * required, because acceptance evidence must come from the same
 * `getLegalSnapshot()` response the person was actually shown (ADR-0025 §17).
 */
export type GateFacts = {
  profileId: string | null;
  displayName: string | null;
  onboardingCompletedAt: string | null;
  hasAthleteCapability: boolean;
  freeEntitlementActive: boolean;
  pinnedTerms: PinnedLegalEvidence | null;
  pinnedPrivacy: PinnedLegalEvidence | null;
  currentTermsDocumentId: string | null;
  currentTermsVersionLabel: string | null;
  currentPrivacyDocumentId: string | null;
  currentPrivacyVersionLabel: string | null;
};

/**
 * Derived gate eligibility (ADR-0025 §16). `complete` requires **all four**
 * separate facts:
 *
 *  1. a Profile exists;
 *  2. onboarding has a completion timestamp;
 *  3. Athlete capability is present;
 *  4. the Free entitlement is active (granted and not revoked).
 *
 * A display name is additionally required, because the completion RPC sets it in
 * the same transaction as the completion row — a completed Profile with no name
 * would be an inconsistent server state, and a trusted-device record cannot be
 * written without one.
 *
 * **Athlete capability and the Free entitlement come from completed onboarding,
 * never from a Profile merely existing** (CLAUDE.md; specification §3.4).
 */
export type GateEligibility =
  | {
      kind: "complete";
      profileId: string;
      displayName: string;
      onboardingCompletedAt: string;
    }
  | { kind: "incomplete" };

export function deriveGateEligibility(facts: GateFacts): GateEligibility {
  if (facts.profileId === null) return { kind: "incomplete" };
  if (facts.onboardingCompletedAt === null) return { kind: "incomplete" };
  if (!facts.hasAthleteCapability) return { kind: "incomplete" };
  if (!facts.freeEntitlementActive) return { kind: "incomplete" };
  if (facts.displayName === null || facts.displayName.trim().length === 0) {
    return { kind: "incomplete" };
  }
  return {
    kind: "complete",
    profileId: facts.profileId,
    displayName: facts.displayName,
    onboardingCompletedAt: facts.onboardingCompletedAt,
  };
}

export interface IdentityService {
  /**
   * The one coherent Legal snapshot — both kinds from one server query, so the
   * metadata shown and the ids submitted can never come from different instants.
   * A whole-response validation failure resolves `invalid_legal_response` and
   * carries no raw value; a genuine zero-row absence resolves successfully with
   * that kind `null`.
   */
  getLegalSnapshot(): Promise<IdentityResult<LegalSnapshot>>;
  /**
   * Creates or resolves the **bare** Profile — the only operation in Stage B0.2
   * that does. Idempotent: a second call returns the same Profile id. Grants no
   * Athlete capability, no entitlement, no legal evidence and no access.
   */
  ensureProfile(): Promise<IdentityResult<BareProfile>>;
  /** Reads the derived gate facts. Never writes anything. */
  resolveGateFacts(): Promise<IdentityResult<GateFacts>>;
  /**
   * Completion-first and write-once. Takes the validated `SafeLegalDocument`
   * objects themselves, never bare ids. A retry against an already-completed
   * Profile performs **no additional writes** and returns the existing state.
   */
  completeOnboarding(input: CompleteOnboardingInput): Promise<IdentityResult<GateFacts>>;
}
