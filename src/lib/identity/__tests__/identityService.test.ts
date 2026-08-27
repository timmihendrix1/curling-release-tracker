// Derived gate eligibility (ADR-0025 §16). Identity, capability, entitlement and
// onboarding are FOUR separate facts, and eligibility is derived from all of them
// on every read — there is no stored "eligible" boolean anywhere, in the database
// or here.
import { describe, expect, it } from "vitest";
import { deriveGateEligibility, type GateFacts } from "../identityService";
import {
  PINNED_PRIVACY,
  PINNED_TERMS,
  PROFILE_A,
} from "./support/identityTestHarness";

function facts(overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    profileId: PROFILE_A,
    displayName: "Athlete",
    onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
    currentTermsDocumentId: null,
    currentTermsVersionLabel: null,
    currentPrivacyDocumentId: null,
    currentPrivacyVersionLabel: null,
    ...overrides,
  };
}

describe("deriveGateEligibility", () => {
  it("is complete only when all four facts plus a display name are present", () => {
    const result = deriveGateEligibility(facts());
    expect(result).toEqual({
      kind: "complete",
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
    });
  });

  it("a BARE Profile is never eligible", () => {
    // The single Profile-creation path grants no capability and no entitlement, so
    // a Profile existing is not access.
    expect(
      deriveGateEligibility(
        facts({
          displayName: null,
          onboardingCompletedAt: null,
          hasAthleteCapability: false,
          freeEntitlementActive: false,
        })
      )
    ).toEqual({ kind: "incomplete" });
  });

  it("each missing fact alone makes it incomplete", () => {
    const variations: Array<[string, Partial<GateFacts>]> = [
      ["no Profile", { profileId: null }],
      ["no completion timestamp", { onboardingCompletedAt: null }],
      ["no Athlete capability", { hasAthleteCapability: false }],
      ["no active Free entitlement", { freeEntitlementActive: false }],
      ["no display name", { displayName: null }],
      ["a blank display name", { displayName: "   " }],
    ];
    for (const [label, overrides] of variations) {
      expect(deriveGateEligibility(facts(overrides)), label).toEqual({ kind: "incomplete" });
    }
  });

  it("reporting-only current* metadata never affects eligibility", () => {
    // A rotation is visible without revoking a completed Profile or forcing
    // re-acceptance.
    const rotated = facts({
      currentTermsDocumentId: "dddddddd-2222-4222-8222-dddddddddddd",
      currentTermsVersionLabel: "v2",
      pinnedTerms: {
        acceptanceId: "aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa",
        documentId: "dddddddd-1111-4111-8111-dddddddddddd",
        versionLabel: "v1",
        actedAt: "2026-02-01T09:00:00.000Z",
      },
    });
    expect(deriveGateEligibility(rotated).kind).toBe("complete");
  });
});
