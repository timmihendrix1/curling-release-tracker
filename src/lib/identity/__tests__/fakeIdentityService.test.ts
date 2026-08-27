// The injected identity fake, tested for FIDELITY to the real RPCs rather than for
// convenience. Per ADR-0006's precedent, a stand-in that took a shortcut would
// make every coordinator test that depends on it worthless.
import { describe, expect, it } from "vitest";
import {
  createFakeIdentityBackend,
  createFakeIdentityService,
  programIdentityFailure,
} from "../fakeIdentityService";
import { deriveGateEligibility } from "../identityService";
import { parseLegalDocumentsResponse, requiredLegalDocuments } from "../legalSnapshot";
import { COMPLETE_LEGAL_ROWS, TERMS_DOC_V2, legalRow } from "./support/identityTestHarness";

function setUp() {
  const backend = createFakeIdentityBackend();
  backend.legalRows = COMPLETE_LEGAL_ROWS;
  backend.currentAccountScopeId = "account-a";
  return { backend, service: createFakeIdentityService(backend) };
}

async function documents(service: ReturnType<typeof createFakeIdentityService>) {
  const snapshot = await service.getLegalSnapshot();
  expect(snapshot.ok).toBe(true);
  if (!snapshot.ok) throw new Error("snapshot unavailable");
  const pair = requiredLegalDocuments(snapshot.value);
  if (pair === null) throw new Error("snapshot incomplete");
  return pair;
}

describe("ensureProfile", () => {
  it("creates exactly one BARE Profile and nothing else", async () => {
    const { backend, service } = setUp();
    const first = await service.ensureProfile();
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.displayName).toBeNull();
    expect(backend.writes).toEqual(["profiles:insert", "account_profile_links:insert"]);

    const facts = await service.resolveGateFacts();
    expect(facts.ok).toBe(true);
    if (!facts.ok) return;
    expect(facts.value.hasAthleteCapability).toBe(false);
    expect(facts.value.freeEntitlementActive).toBe(false);
    expect(facts.value.onboardingCompletedAt).toBeNull();
    // A bare Profile passes no gate.
    expect(deriveGateEligibility(facts.value)).toEqual({ kind: "incomplete" });
  });

  it("is idempotent — a repeat returns the SAME Profile id and writes nothing more", async () => {
    const { backend, service } = setUp();
    const first = await service.ensureProfile();
    const writesAfterFirst = [...backend.writes];
    const second = await service.ensureProfile();
    expect(first.ok && second.ok && first.value.profileId).toBe(
      second.ok ? second.value.profileId : "different"
    );
    expect(backend.writes).toEqual(writesAfterFirst);
  });

  it("refuses without an authenticated caller", async () => {
    const { backend, service } = setUp();
    backend.currentAccountScopeId = null;
    const result = await service.ensureProfile();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("forbidden");
  });
});

describe("completeOnboarding — completion-first and write-once", () => {
  it("refuses when no Profile exists, with no writes", async () => {
    const { backend, service } = setUp();
    const pair = await documents(service);
    const result = await service.completeOnboarding({ displayName: "Athlete", ...pair });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("profile_required");
    expect(backend.writes).toEqual([]);
  });

  it("establishes all five consequences in one go", async () => {
    const { backend, service } = setUp();
    await service.ensureProfile();
    const pair = await documents(service);
    backend.writes.length = 0;

    const result = await service.completeOnboarding({ displayName: "Athlete", ...pair });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(deriveGateEligibility(result.value).kind).toBe("complete");
    expect(backend.writes).toEqual([
      "legal_acceptances:insert:terms",
      "legal_acceptances:insert:privacy",
      "athletes:insert",
      "profile_entitlements:insert",
      "profile_onboarding:insert",
      "profiles:update:display_name",
    ]);
    expect(result.value.pinnedTerms?.documentId).toBe(pair.terms.id);
    expect(result.value.pinnedPrivacy?.documentId).toBe(pair.privacy.id);
  });

  it("a RETRY against an already-completed Profile performs NO additional writes", async () => {
    const { backend, service } = setUp();
    await service.ensureProfile();
    const pair = await documents(service);
    const first = await service.completeOnboarding({ displayName: "Athlete", ...pair });
    expect(first.ok).toBe(true);
    const writesAfterFirst = [...backend.writes];
    const pinned = first.ok ? first.value : null;

    const retry = await service.completeOnboarding({ displayName: "Athlete", ...pair });

    expect(retry.ok).toBe(true);
    expect(backend.writes).toEqual(writesAfterFirst);
    if (retry.ok && pinned !== null) {
      expect(retry.value.onboardingCompletedAt).toBe(pinned.onboardingCompletedAt);
      expect(retry.value.displayName).toBe(pinned.displayName);
      expect(retry.value.pinnedTerms).toEqual(pinned.pinnedTerms);
    }
  });

  it("a retry with a DIFFERENT display name and different documents still mutates nothing", async () => {
    const { backend, service } = setUp();
    await service.ensureProfile();
    const pair = await documents(service);
    await service.completeOnboarding({ displayName: "Athlete", ...pair });
    const writesAfterFirst = [...backend.writes];

    // Rotate to v2, then retry with the ORIGINAL v1 payload and a new name.
    backend.legalRows = [legalRow("terms_of_service", TERMS_DOC_V2, "v2"), COMPLETE_LEGAL_ROWS[1]];
    const retry = await service.completeOnboarding({ displayName: "Someone Else", ...pair });

    expect(retry.ok).toBe(true);
    expect(backend.writes).toEqual(writesAfterFirst);
    if (retry.ok) {
      expect(retry.value.displayName).toBe("Athlete");
      // The separately derived current* metadata legitimately names v2 while the
      // pinned evidence still names v1 — and that never forces re-acceptance.
      expect(retry.value.currentTermsDocumentId).toBe(TERMS_DOC_V2);
      expect(retry.value.pinnedTerms?.versionLabel).toBe("v1");
    }
  });

  it("validates the display name, and reports a rotation as stale_legal_version with no writes", async () => {
    const { backend, service } = setUp();
    await service.ensureProfile();
    const pair = await documents(service);
    backend.writes.length = 0;

    for (const displayName of ["", "   ", "x".repeat(81)]) {
      const result = await service.completeOnboarding({ displayName, ...pair });
      expect(result.ok, displayName).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_input");
    }
    expect(backend.writes).toEqual([]);

    backend.legalRows = [legalRow("terms_of_service", TERMS_DOC_V2, "v2"), COMPLETE_LEGAL_ROWS[1]];
    const stale = await service.completeOnboarding({ displayName: "Athlete", ...pair });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.kind).toBe("stale_legal_version");
    expect(backend.writes).toEqual([]);
  });

  it("reports legal_unavailable when a current document is missing", async () => {
    const { backend, service } = setUp();
    await service.ensureProfile();
    const pair = await documents(service);
    backend.legalRows = [COMPLETE_LEGAL_ROWS[1]];
    const result = await service.completeOnboarding({ displayName: "Athlete", ...pair });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("legal_unavailable");
  });
});

describe("the legal snapshot goes through the real mapper", () => {
  it("fails closed on an invalid response exactly as the production mapper does", async () => {
    const { backend, service } = setUp();
    backend.legalRows = [{ ...COMPLETE_LEGAL_ROWS[0], kind: "shadow_policy" }];
    const result = await service.getLegalSnapshot();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_legal_response");
    // The same verdict the production parser reaches.
    expect(parseLegalDocumentsResponse(backend.legalRows, "2026-01-01T00:00:00.000Z").ok).toBe(false);
  });

  it("keeps genuine absence valid", async () => {
    const { backend, service } = setUp();
    backend.legalRows = [];
    const result = await service.getLegalSnapshot();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.terms).toBeNull();
      expect(result.value.privacy).toBeNull();
    }
  });
});

describe("programmable failures and call recording", () => {
  it("consumes one programmed failure per call, in order", async () => {
    const { backend, service } = setUp();
    programIdentityFailure(backend, "resolveGateFacts", "network_error");
    const first = await service.resolveGateFacts();
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.error.kind).toBe("network_error");
    const second = await service.resolveGateFacts();
    expect(second.ok).toBe(true);
  });

  it("records every call in order", async () => {
    const { backend, service } = setUp();
    await service.getLegalSnapshot();
    await service.ensureProfile();
    await service.resolveGateFacts();
    expect(backend.calls).toEqual(["getLegalSnapshot", "ensureProfile", "resolveGateFacts"]);
  });
});
