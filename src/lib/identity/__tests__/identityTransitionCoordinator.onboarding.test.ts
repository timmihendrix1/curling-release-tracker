// Onboarding submission and the legal-rotation path (ADR-0025 §16, §17, §15).
//
// Onboarding submission is not a barrier-guarded identity transition — it happens
// after one, on an already-authenticated identity — but it IS the first point at
// which the required trusted-device record is written, so it inherits §15's
// "no ready state until that record is durably written" rule.
import { describe, expect, it } from "vitest";
import {
  COMPLETE_LEGAL_ROWS,
  FIXED_NOW,
  IDENTITY_A,
  IDENTITY_B,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  TERMS_DOC_V2,
  createIdentityHarness,
  legalRow,
  type IdentityHarness,
  PINNED_PRIVACY,
  PINNED_TERMS,
  report,
  view,
} from "./support/identityTestHarness";
import { requiredLegalDocuments, type CompleteOnboardingInput } from "../legalSnapshot";
import { createFakeIdentityService, programIdentityFailure } from "../fakeIdentityService";
import { identityOk } from "../errors";
import {
  isGateReady,
  reduceGateState,
  type GateState,
  type OnboardingSubmissionOutcome,
} from "../gateState";
import type { GateFacts, IdentityService } from "../identityService";

async function bareProfileHarness(): Promise<{
  harness: IdentityHarness;
  input: CompleteOnboardingInput;
}> {
  const harness = createIdentityHarness({ url: REDIRECT_TARGET });
  harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
    profileId: PROFILE_A,
    displayName: null,
    onboardingCompletedAt: null,
    hasAthleteCapability: false,
    freeEntitlementActive: false,
    pinnedTerms: null,
    pinnedPrivacy: null,
  });
  harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

  const startup = await harness.coordinator.startUp();
  expect(startup.verdict.kind).toBe("onboarding_required");
  if (startup.verdict.kind !== "onboarding_required") throw new Error("unexpected verdict");
  const pair = requiredLegalDocuments(startup.verdict.legal);
  if (pair === null) throw new Error("snapshot incomplete");
  return { harness, input: { displayName: "Athlete", ...pair } };
}

describe("a successful submission", () => {
  it("completes, writes the required trusted record, and only then goes ready", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.progress.length = 0;

    const outcome = await harness.coordinator.submitOnboarding(input);

    expect(outcome.kind).toBe("completed");
    if (outcome.kind !== "completed") return;
    expect(outcome.gate.kind).toBe("ready_online");
    if (outcome.gate.kind === "ready_online") {
      expect(outcome.gate.session.displayName).toBe("Athlete");
      expect(outcome.gate.session.profileId).toBe(PROFILE_A);
      expect(outcome.gate.session.entitlement).toBe("free");
    }
    expect(harness.progress).toEqual(["submitting_onboarding", "establishing_trusted_state"]);
    const trusted = JSON.parse(harness.storage.store.get(STORAGE_KEYS.trusted) as string) as {
      accountScopeId: string;
      displayName: string;
    };
    expect(trusted.accountScopeId).toBe(IDENTITY_A.accountScopeId);
    expect(trusted.displayName).toBe("Athlete");
  });

  it("submits the ids from the SAME snapshot the person was shown", async () => {
    const { harness, input } = await bareProfileHarness();
    await harness.coordinator.submitOnboarding(input);
    const account = harness.identityBackend.accounts.get(IDENTITY_A.accountScopeId);
    expect(account?.pinnedTerms?.documentId).toBe(COMPLETE_LEGAL_ROWS[0].id);
    expect(account?.pinnedPrivacy?.documentId).toBe(COMPLETE_LEGAL_ROWS[1].id);
  });
});

describe("the required trusted write still gates readiness", () => {
  it("a trusted-write failure yields trusted_state_not_established despite a completed onboarding", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.storage.failWrites.add(STORAGE_KEYS.trusted);

    const outcome = await harness.coordinator.submitOnboarding(input);

    expect(report(outcome)).toEqual({ kind: "trusted_state_not_established" });
    // The server-side completion DID happen and is not rolled back — that is what
    // makes the retry safe and write-free.
    const account = harness.identityBackend.accounts.get(IDENTITY_A.accountScopeId);
    expect(account?.onboardingCompletedAt).not.toBeNull();
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("the retry revalidates the server facts and then succeeds", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.storage.failWrites.add(STORAGE_KEYS.trusted);
    await harness.coordinator.submitOnboarding(input);

    harness.storage.failWrites.clear();
    harness.identityBackend.calls.length = 0;
    const writesBefore = [...harness.identityBackend.writes];

    const retry = await harness.coordinator.retryTrustedStateEstablishment();

    expect(retry.kind).toBe("resolved");
    expect(harness.identityBackend.calls).toContain("resolveGateFacts");
    // The completion RPC is not called again, and nothing new is written
    // server-side.
    expect(harness.identityBackend.writes).toEqual(writesBefore);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });

  it("with no session at submission time, it fails closed and writes no trusted record", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    const outcome = await harness.coordinator.submitOnboarding(input);
    expect(report(outcome)).toEqual({ kind: "temporarily_unavailable" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
});

describe("legal rotation between display and submission", () => {
  it("reports stale_legal_version with the REFETCHED snapshot, and writes nothing", async () => {
    const { harness, input } = await bareProfileHarness();
    // The documents rotate after the person was shown v1.
    harness.identityBackend.legalRows = [
      legalRow("terms_of_service", TERMS_DOC_V2, "v2"),
      COMPLETE_LEGAL_ROWS[1],
    ];
    harness.identityBackend.writes.length = 0;

    const outcome = await harness.coordinator.submitOnboarding(input);

    expect(outcome.kind).toBe("stale_legal_version");
    if (outcome.kind !== "stale_legal_version") return;
    // The caller receives the NEW versions to re-display, which is what makes
    // re-acceptance unavoidable rather than optional.
    expect(outcome.legal.terms?.id).toBe(TERMS_DOC_V2);
    expect(outcome.legal.terms?.versionLabel).toBe("v2");
    expect(harness.identityBackend.writes).toEqual([]);
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("submitting the refetched v2 ids then succeeds", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.identityBackend.legalRows = [
      legalRow("terms_of_service", TERMS_DOC_V2, "v2"),
      COMPLETE_LEGAL_ROWS[1],
    ];
    const stale = await harness.coordinator.submitOnboarding(input);
    expect(stale.kind).toBe("stale_legal_version");
    if (stale.kind !== "stale_legal_version") return;
    const pair = requiredLegalDocuments(stale.legal);
    expect(pair).not.toBeNull();
    if (pair === null) return;

    const outcome = await harness.coordinator.submitOnboarding({ displayName: "Athlete", ...pair });

    expect(outcome.kind).toBe("completed");
    const account = harness.identityBackend.accounts.get(IDENTITY_A.accountScopeId);
    expect(account?.pinnedTerms?.documentId).toBe(TERMS_DOC_V2);
  });

  it("a rotation into an UNUSABLE snapshot reports legal_unavailable rather than a partial one", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.identityBackend.legalRows = [legalRow("terms_of_service", TERMS_DOC_V2, "v2")];
    const outcome = await harness.coordinator.submitOnboarding(input);
    expect(report(outcome)).toEqual({ kind: "legal_unavailable" });
  });

  it("a rotation whose refetch returns an INVALID response reports legal_unavailable and leaks nothing", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.identityBackend.legalRows = [
      legalRow("terms_of_service", TERMS_DOC_V2, "v2"),
      { ...COMPLETE_LEGAL_ROWS[1], kind: "shadow_policy" },
    ];
    const outcome = await harness.coordinator.submitOnboarding(input);
    expect(report(outcome)).toEqual({ kind: "legal_unavailable" });
    expect(JSON.stringify(outcome)).not.toContain("shadow_policy");
  });
});

describe("other submission failures", () => {
  it("maps each server failure onto a closed outcome without opening the app", async () => {
    const cases = [
      ["invalid_input", "invalid_input"],
      ["legal_unavailable", "legal_unavailable"],
      ["network_error", "temporarily_unavailable"],
      ["profile_required", "submission_failed"],
      ["conflict", "submission_failed"],
      ["unexpected_error", "submission_failed"],
    ] as const;
    for (const [failure, expected] of cases) {
      const { harness, input } = await bareProfileHarness();
      programIdentityFailure(harness.identityBackend, "completeOnboarding", failure);
      const outcome = await harness.coordinator.submitOnboarding(input);
      expect(outcome.kind, failure).toBe(expected);
      expect(harness.storage.store.has(STORAGE_KEYS.trusted), failure).toBe(false);
    }
  });

  it("a server 'success' whose derived facts do not add up fails closed", async () => {
    // A shape the real RPCs cannot produce, and which the coordinator must
    // therefore refuse rather than trust: the completion reports success while
    // the derived facts are missing the Athlete capability and the entitlement.
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        completeOnboarding: async () =>
          identityOk<GateFacts>({
            profileId: PROFILE_A,
            displayName: "Athlete",
            onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
            hasAthleteCapability: false,
            freeEntitlementActive: false,
            pinnedTerms: PINNED_TERMS,
            pinnedPrivacy: PINNED_PRIVACY,
            currentTermsDocumentId: null,
            currentTermsVersionLabel: null,
            currentPrivacyDocumentId: null,
            currentPrivacyVersionLabel: null,
          }),
      },
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const snapshot = await harness.coordinator.refreshLegalSnapshot();
    expect(snapshot.kind).toBe("refreshed");
    if (snapshot.kind !== "refreshed") return;
    const pair = requiredLegalDocuments(snapshot.legal);
    if (pair === null) throw new Error("snapshot incomplete");

    const outcome = await harness.coordinator.submitOnboarding({
      displayName: "Athlete",
      ...pair,
    });

    expect(report(outcome)).toEqual({ kind: "submission_failed" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
});

describe("refreshLegalSnapshot", () => {
  it("returns the current snapshot when both documents exist", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const outcome = await harness.coordinator.refreshLegalSnapshot();
    expect(outcome.kind).toBe("refreshed");
    if (outcome.kind !== "refreshed") return;
    expect(outcome.legal.terms).not.toBeNull();
    expect(outcome.legal.privacy).not.toBeNull();
    expect(harness.progress).toEqual(["refreshing_legal_snapshot"]);
  });

  it("reports legal_unavailable for a missing document and for an invalid response", async () => {
    const missing = createIdentityHarness({
      url: REDIRECT_TARGET,
      legalRows: [COMPLETE_LEGAL_ROWS[1]],
    });
    await expect(missing.coordinator.refreshLegalSnapshot()).resolves.toEqual({
      kind: "legal_unavailable",
    });

    const invalid = createIdentityHarness({
      url: REDIRECT_TARGET,
      legalRows: [{ ...COMPLETE_LEGAL_ROWS[0], document_url: "javascript:alert(1)" }],
    });
    await expect(invalid.coordinator.refreshLegalSnapshot()).resolves.toEqual({
      kind: "legal_unavailable",
    });
  });
});

describe("onboarding completion is bound to ONE continuous account identity", () => {
  /**
   * Builds a harness whose account has a BARE Profile and is ready to onboard, with
   * one `IdentityService` method wrapped so a test can interleave a session change
   * exactly where it matters. The wrapper delegates to a service built on the
   * harness's OWN backend, so every other method still sees the same state.
   */
  async function interleavingHarness(
    wrap: (harness: IdentityHarness) => Partial<IdentityService>
  ): Promise<{ harness: IdentityHarness; input: CompleteOnboardingInput }> {
    let built: IdentityHarness | null = null;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        completeOnboarding: async (completionInput) => {
          const target = built as IdentityHarness;
          const overrides = wrap(target);
          const custom = overrides?.completeOnboarding;
          if (custom !== undefined) return custom(completionInput);
          return createFakeIdentityService(target.identityBackend).completeOnboarding(
            completionInput
          );
        },
        resolveGateFacts: async () => {
          const target = built as IdentityHarness;
          const overrides = wrap(target);
          const custom = overrides?.resolveGateFacts;
          if (custom !== undefined) return custom();
          return createFakeIdentityService(target.identityBackend).resolveGateFacts();
        },
      },
    });
    built = harness;
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
      profileId: PROFILE_A,
      displayName: null,
      onboardingCompletedAt: null,
      hasAthleteCapability: false,
      freeEntitlementActive: false,
      pinnedTerms: null,
      pinnedPrivacy: null,
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const snapshot = await harness.coordinator.refreshLegalSnapshot();
    if (snapshot.kind !== "refreshed") throw new Error("snapshot unavailable");
    const pair = requiredLegalDocuments(snapshot.legal);
    if (pair === null) throw new Error("snapshot incomplete");
    return { harness, input: { displayName: "Athlete", ...pair } };
  }

  it("refuses to start when the account cannot be established up front", async () => {
    const { harness, input } = await bareProfileHarness();
    harness.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    harness.identityBackend.calls.length = 0;

    const outcome = await harness.coordinator.submitOnboarding(input);

    expect(report(outcome)).toEqual({ kind: "temporarily_unavailable" });
    // The completion RPC never ran, so nothing was written anywhere.
    expect(harness.identityBackend.calls).not.toContain("completeOnboarding");
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("an account switch DURING the completion RPC never persists a mixed trusted record", async () => {
    const { harness, input } = await interleavingHarness((target) => ({
      completeOnboarding: async (completionInput) => {
        const result = await createFakeIdentityService(target.identityBackend).completeOnboarding(
          completionInput
        );
        // The session flips to another account while the completion is in flight.
        target.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
        return result;
      },
    }));

    const outcome = await harness.coordinator.submitOnboarding(input);

    expect(report(outcome)).toEqual({
      kind: "identity_changed",
      // The EXACT invalidation outcome, annotated with its own operation and denial.
      invalidation: expect.objectContaining({ kind: "identity_invalidated" }),
    });
    // No trusted record at all — certainly not one naming account B alongside
    // account A's Profile.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    // And the denial was made durable.
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("server_identity_invalidated");
  });

  it("a session lost between the RPC and the trusted write persists nothing", async () => {
    const { harness, input } = await interleavingHarness((target) => ({
      completeOnboarding: async (completionInput) => {
        const result = await createFakeIdentityService(target.identityBackend).completeOnboarding(
          completionInput
        );
        target.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
        return result;
      },
    }));

    const outcome = await harness.coordinator.submitOnboarding(input);

    expect(report(outcome)).toEqual({ kind: "temporarily_unavailable" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a deliberate transition starting mid-completion fails closed rather than persisting", async () => {
    const { harness, input } = await interleavingHarness((target) => ({
      completeOnboarding: async (completionInput) => {
        const result = await createFakeIdentityService(target.identityBackend).completeOnboarding(
          completionInput
        );
        // Another tab starts its own authentication: the live epoch moves.
        target.liveGeneration.bump();
        return result;
      },
    }));

    const outcome = await harness.coordinator.submitOnboarding(input);

    expect(report(outcome)).toEqual({ kind: "temporarily_unavailable" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("the same continuity check guards a fresh resolution's trusted write", async () => {
    // `resolveAsFreshIdentity` gathers server facts and then persists trusted state.
    // A deliberate transition starting in between means those facts no longer
    // describe the transition that is now current.
    let built: IdentityHarness | null = null;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        resolveGateFacts: async () => {
          const target = built as IdentityHarness;
          target.liveGeneration.bump();
          return createFakeIdentityService(target.identityBackend).resolveGateFacts();
        },
      },
    });
    built = harness;
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      hasAthleteCapability: true,
      freeEntitlementActive: true,
      pinnedTerms: PINNED_TERMS,
      pinnedPrivacy: PINNED_PRIVACY,
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
});

describe("the onboarding account-mismatch storage-failure matrix", () => {
  /**
   * Completion succeeds server-side, then the session flips to another account.
   * The invalidation transition that follows can itself fail, and the outcome must
   * report which durable step did not complete — never a result claiming durable
   * invalidation when none happened.
   */
  async function mismatchWith(failures: {
    barrier?: boolean;
    trusted?: boolean;
    intent?: boolean;
  }): Promise<{
    outcome: OnboardingSubmissionOutcome;
    harness: IdentityHarness;
  }> {
    let built: IdentityHarness | null = null;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        completeOnboarding: async (completionInput) => {
          const target = built as IdentityHarness;
          const result = await createFakeIdentityService(target.identityBackend).completeOnboarding(
            completionInput
          );
          target.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
          return result;
        },
      },
    });
    built = harness;
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
      profileId: PROFILE_A,
      displayName: null,
      onboardingCompletedAt: null,
      hasAthleteCapability: false,
      freeEntitlementActive: false,
      pinnedTerms: null,
      pinnedPrivacy: null,
    });
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    // A trusted record and an intent for the ORIGINAL account, so removal and
    // deletion both have something to do.
    harness.storage.seed(STORAGE_KEYS.trusted, {
      schemaVersion: 1,
      accountScopeId: IDENTITY_A.accountScopeId,
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      entitlement: "free",
      generation: 1,
      establishedAt: FIXED_NOW,
      lastServerConfirmationAt: FIXED_NOW,
    });
    harness.storage.seed(STORAGE_KEYS.intent, {
      schemaVersion: 1,
      kind: "invitation",
      value: "opaque-invitation-token-0001",
      capturedAt: FIXED_NOW,
      survival: "ordinary",
    });

    const snapshot = await harness.coordinator.refreshLegalSnapshot();
    if (snapshot.kind !== "refreshed") throw new Error("snapshot unavailable");
    const pair = requiredLegalDocuments(snapshot.legal);
    if (pair === null) throw new Error("snapshot incomplete");

    if (failures.barrier === true) harness.storage.failWrites.add(STORAGE_KEYS.barrier);
    if (failures.trusted === true) harness.storage.failRemoves.add(STORAGE_KEYS.trusted);
    if (failures.intent === true) harness.storage.failRemoves.add(STORAGE_KEYS.intent);

    const outcome = await harness.coordinator.submitOnboarding({
      displayName: "Athlete",
      ...pair,
    });
    return { outcome, harness };
  }

  function gateStateFor(outcome: OnboardingSubmissionOutcome): GateState {
    return reduceGateState(
      {
        kind: "submitting_onboarding",
        transition: outcome.transition,
        acceptedSequence: outcome.transition?.sequence,
      },
      { type: "onboarding_settled", outcome }
    );
  }

  it("a fully successful denial reports identity_invalidated and locks", async () => {
    const { outcome, harness } = await mismatchWith({});
    expect(report(outcome)).toEqual({
      kind: "identity_changed",
      // The EXACT invalidation outcome, annotated with its own operation and denial.
      invalidation: expect.objectContaining({ kind: "identity_invalidated" }),
    });
    expect(view(gateStateFor(outcome))).toEqual({
      kind: "locked",
      origin: "server_identity_invalidated",
      callbackNotice: "none",
    });
    // Never a trusted record naming the replacement account.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a trusted-removal failure with an enforcing barrier is reported as such", async () => {
    const { outcome, harness } = await mismatchWith({ trusted: true });
    expect(report(outcome)).toEqual({
      kind: "identity_changed",
      // The EXACT invalidation outcome, annotated with its own operation and denial.
      invalidation: expect.objectContaining({ kind: "trusted_state_not_invalidated" }),
    });
    expect(gateStateFor(outcome).kind).toBe("locked");
    // The enforcing barrier exists, so the stale record can never be honoured.
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("server_identity_invalidated");
  });

  it("a required intent-deletion failure is reported, and still locks", async () => {
    const { outcome } = await mismatchWith({ intent: true });
    expect(report(outcome)).toEqual({
      kind: "identity_changed",
      // The EXACT invalidation outcome, annotated with its own operation and denial.
      invalidation: expect.objectContaining({ kind: "intent_state_not_persisted" }),
    });
    expect(gateStateFor(outcome).kind).toBe("locked");
  });

  it("a barrier failure with a successful removal still achieves durable denial", async () => {
    const { outcome, harness } = await mismatchWith({ barrier: true });
    expect(report(outcome)).toEqual({
      kind: "identity_changed",
      // The EXACT invalidation outcome, annotated with its own operation and denial.
      invalidation: expect.objectContaining({ kind: "identity_invalidated" }),
    });
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a barrier PLUS trusted-removal double failure maps to storage_unavailable_locked", async () => {
    const { outcome, harness } = await mismatchWith({ barrier: true, trusted: true });
    expect(report(outcome)).toEqual({
      kind: "identity_changed",
      // The EXACT invalidation outcome, annotated with its own operation and denial.
      invalidation: expect.objectContaining({ kind: "durable_denial_unavailable" }),
    });
    // Not a result claiming durable invalidation.
    expect(view(gateStateFor(outcome))).toEqual({ kind: "storage_unavailable_locked" });
    // Nothing durable changed.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
    expect(harness.storage.store.has(STORAGE_KEYS.barrier)).toBe(false);
  });

  it("no failure combination ever persists a trusted record for the replacement account", async () => {
    const combinations = [
      {},
      { barrier: true },
      { trusted: true },
      { intent: true },
      { barrier: true, trusted: true },
      { barrier: true, intent: true },
      { trusted: true, intent: true },
      { barrier: true, trusted: true, intent: true },
    ];
    for (const failures of combinations) {
      const { outcome, harness } = await mismatchWith(failures);
      expect(outcome.kind, JSON.stringify(failures)).toBe("identity_changed");
      const stored = harness.storage.store.get(STORAGE_KEYS.trusted);
      if (stored !== undefined) {
        // Only the ORIGINAL account's record can still be there.
        expect(stored, JSON.stringify(failures)).toContain(IDENTITY_A.accountScopeId);
        expect(stored, JSON.stringify(failures)).not.toContain(IDENTITY_B.accountScopeId);
      }
      expect(isGateReady(gateStateFor(outcome)), JSON.stringify(failures)).toBe(false);
    }
  });
});
