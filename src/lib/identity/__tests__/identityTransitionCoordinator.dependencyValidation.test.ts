// EVERY DEPENDENCY RESULT IS SNAPSHOTTED AND CHECKED FOR COHERENCE.
//
// The coordinator's `IdentityService` is injected. "It returns a coherent
// `GateFacts`" is therefore a property of whatever was passed in — a different
// implementation, a test double, or a future boundary with a defect — not something
// this module may assume. So the coordinator re-applies the SAME server/domain
// invariants the Supabase boundary applies to the raw RPC row:
//
//   * nothing is derived from a Profile that does not exist;
//   * completed onboarding requires BOTH complete pinned-evidence groups;
//   * incomplete onboarding has NO pinned evidence;
//   * Athlete capability and the Free entitlement cannot precede completion;
//   * each `current_*` id/version label pair is either both null or both valid.
//
// TWO RULES GOVERN EVERY FAILURE HERE. A malformed or hostile "success" fails
// closed as UNCONFIRMED — never as the server saying no, because a definitive
// negative revokes trusted state and locks the device. And nothing from the raw
// value travels: not into an outcome, not into a verdict, not into a snapshot.
import { describe, expect, it } from "vitest";
import {
  COMPLETE_LEGAL_ROWS,
  FIXED_NOW,
  IDENTITY_A,
  PINNED_PRIVACY,
  PINNED_TERMS,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  SYNTHETIC_CODE,
  callbackUrl,
  createIdentityHarness,
  report,
  type IdentityHarness,
} from "./support/identityTestHarness";
import { identityOk, type IdentityResult } from "../errors";
import type { GateFacts, IdentityService } from "../identityService";
import type { LegalSnapshot } from "../legalSnapshot";
import { parseLegalDocumentsResponse } from "../legalSnapshot";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createCallbackCaptureCell } from "../../supabase/supabaseCallbackCapture";
import type { CallbackClaim } from "../../supabase/supabaseCallbackCapture";
import { createIdentityTransitionCoordinator, createLiveGenerationCounter } from "../identityTransitionCoordinator";
import { createIdentityBarrierRepository } from "../identityBarrierRepository";
import { createInteractiveAttemptRepository } from "../interactiveAttemptRepository";
import { createIdentityBarrierResolutionRepository } from "../identityBarrierResolutionRepository";
import { createTrustedDeviceRepository } from "../trustedDeviceRepository";
import { createPendingIntentRepository } from "../pendingIntentRepository";
import { createFakeIdentityBackend, createFakeIdentityService } from "../fakeIdentityService";
import { createMemoryStorage } from "./support/identityTestHarness";
import type { ClaimedCallback, ExchangeOutcome } from "../../supabase/authService";

const SECRET_CODE = "sb_secret_authorization_code_must_not_travel";
const COMPLETED_AT = "2026-02-01T09:00:00.000Z";

/** The correlated set the claim-facade cases need in order to reach the exchange
 * boundary at all. The selector is non-secret and never asserted for its value. */
const CLAIM_FLOW_ID = "flow-x-000000000000";
const CLAIM_BARRIER = "11111111-1111-4111-8111-111111111111";
const CLAIM_ATTEMPT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/** A coherent, complete `GateFacts` — the baseline every case below perturbs. */
function coherentFacts(overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    profileId: PROFILE_A,
    displayName: "Athlete",
    onboardingCompletedAt: COMPLETED_AT,
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
    currentTermsDocumentId: COMPLETE_LEGAL_ROWS[0].id,
    currentTermsVersionLabel: "v1",
    currentPrivacyDocumentId: COMPLETE_LEGAL_ROWS[1].id,
    currentPrivacyVersionLabel: "v1",
    ...overrides,
  };
}

/**
 * A harness whose `resolveGateFacts` returns exactly `facts`, with a valid trusted
 * record and a valid session in place — so anything other than "unconfirmed" would
 * have to come from the payload being accepted.
 */
function harnessReturning(facts: unknown): IdentityHarness {
  const harness = createIdentityHarness({
    url: REDIRECT_TARGET,
    identityOverrides: {
      resolveGateFacts: async (): Promise<IdentityResult<GateFacts>> =>
        identityOk(facts as GateFacts),
    },
  });
  harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
    profileId: PROFILE_A,
    displayName: "Athlete",
    onboardingCompletedAt: COMPLETED_AT,
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
  });
  harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
  return harness;
}

/** Every combination the server cannot produce. */
const INCOHERENT: Array<[string, unknown]> = [
  [
    "completed onboarding with NO pinned evidence",
    coherentFacts({ pinnedTerms: null, pinnedPrivacy: null }),
  ],
  [
    "completed onboarding with only pinned Terms",
    coherentFacts({ pinnedPrivacy: null }),
  ],
  [
    "completed onboarding with only pinned Privacy",
    coherentFacts({ pinnedTerms: null }),
  ],
  [
    "INCOMPLETE onboarding carrying pinned evidence",
    coherentFacts({
      onboardingCompletedAt: null,
      hasAthleteCapability: false,
      freeEntitlementActive: false,
    }),
  ],
  [
    "Athlete capability before completion",
    coherentFacts({
      onboardingCompletedAt: null,
      pinnedTerms: null,
      pinnedPrivacy: null,
      hasAthleteCapability: true,
      freeEntitlementActive: false,
    }),
  ],
  [
    "an active Free entitlement before completion",
    coherentFacts({
      onboardingCompletedAt: null,
      pinnedTerms: null,
      pinnedPrivacy: null,
      hasAthleteCapability: false,
      freeEntitlementActive: true,
    }),
  ],
  [
    "no Profile but a completion fact",
    coherentFacts({ profileId: null }),
  ],
  [
    "no Profile but a display name",
    coherentFacts({
      profileId: null,
      onboardingCompletedAt: null,
      hasAthleteCapability: false,
      freeEntitlementActive: false,
      pinnedTerms: null,
      pinnedPrivacy: null,
    }),
  ],
  [
    "no Profile but Athlete capability",
    coherentFacts({
      profileId: null,
      displayName: null,
      onboardingCompletedAt: null,
      hasAthleteCapability: true,
      freeEntitlementActive: false,
      pinnedTerms: null,
      pinnedPrivacy: null,
    }),
  ],
  [
    "no Profile but pinned evidence",
    coherentFacts({
      profileId: null,
      displayName: null,
      onboardingCompletedAt: null,
      hasAthleteCapability: false,
      freeEntitlementActive: false,
    }),
  ],
  [
    "a current Terms id with no version label",
    coherentFacts({ currentTermsVersionLabel: null }),
  ],
  [
    "a current Terms version label with no id",
    coherentFacts({ currentTermsDocumentId: null }),
  ],
  [
    "a current Privacy id with no version label",
    coherentFacts({ currentPrivacyVersionLabel: null }),
  ],
  [
    "a current Privacy version label with no id",
    coherentFacts({ currentPrivacyDocumentId: null }),
  ],
  [
    "an EMPTY current Terms version label",
    coherentFacts({ currentTermsVersionLabel: "" }),
  ],
  [
    "an EMPTY current Privacy version label",
    coherentFacts({ currentPrivacyVersionLabel: "" }),
  ],
  ["a non-UUID Profile id", coherentFacts({ profileId: "not-a-uuid" as unknown as string })],
  [
    "a malformed completion timestamp",
    coherentFacts({ onboardingCompletedAt: "not-a-timestamp" }),
  ],
  [
    "a non-boolean capability",
    coherentFacts({ hasAthleteCapability: "true" as unknown as boolean }),
  ],
  [
    "partial pinned evidence",
    coherentFacts({
      pinnedTerms: { ...PINNED_TERMS, actedAt: "nonsense" },
    }),
  ],
  ["a payload that is not a record at all", "gate facts"],
  ["a null payload", null],
];

describe("an INCOHERENT GateFacts payload", () => {
  for (const [label, facts] of INCOHERENT) {
    it(`fails closed as unconfirmed: ${label}`, async () => {
      const harness = harnessReturning(facts);

      const outcome = await harness.coordinator.startUp();

      // Unconfirmed — never ready, and never a definitive server negative.
      expect(outcome.verdict.kind, label).toBe("identity_unconfirmed");
      expect(outcome.finalization, label).toBeNull();
      // No invalidation barrier was written, and no trusted state was touched.
      expect(harness.storage.calls, label).not.toContain(`set:${STORAGE_KEYS.barrier}`);
      expect(harness.storage.calls, label).not.toContain(`remove:${STORAGE_KEYS.trusted}`);
    });
  }

  it("also fails closed during BACKGROUND revalidation, without revoking anything", async () => {
    for (const [label, facts] of INCOHERENT) {
      const harness = harnessReturning(facts);
      harness.storage.seed(
        STORAGE_KEYS.trusted,
        createTrustedDeviceRecord({
          accountScopeId: IDENTITY_A.accountScopeId,
          profileId: PROFILE_A,
          displayName: "Athlete",
          onboardingCompletedAt: COMPLETED_AT,
          generation: 1,
          establishedAt: FIXED_NOW,
          lastServerConfirmationAt: FIXED_NOW,
        })
      );
      const before = harness.storage.store.get(STORAGE_KEYS.trusted);

      const outcome = await harness.coordinator.revalidateGateFacts();

      expect(report(outcome), label).toEqual({ kind: "temporarily_unavailable" });
      expect(outcome.denial, label).toBeUndefined();
      expect(harness.storage.store.get(STORAGE_KEYS.trusted), label).toBe(before);
    }
  });

  it("does not leak any raw material into the outcome", async () => {
    const harness = harnessReturning(
      coherentFacts({
        pinnedTerms: null,
        pinnedPrivacy: null,
        displayName: "sb_secret_display_name",
      })
    );

    const outcome = await harness.coordinator.startUp();

    expect(JSON.stringify(outcome)).not.toContain("sb_secret_display_name");
  });
});

describe("a HOSTILE GateFacts payload", () => {
  it("is read exactly once — a value that changes between reads cannot slip through", async () => {
    let reads = 0;
    const shifting = {
      get profileId(): string | null {
        reads += 1;
        // First read looks coherent; a second read would name a different Profile.
        return reads === 1 ? PROFILE_A : "dddddddd-9999-4999-8999-dddddddddddd";
      },
      displayName: "Athlete",
      onboardingCompletedAt: COMPLETED_AT,
      hasAthleteCapability: true,
      freeEntitlementActive: true,
      pinnedTerms: PINNED_TERMS,
      pinnedPrivacy: PINNED_PRIVACY,
      currentTermsDocumentId: COMPLETE_LEGAL_ROWS[0].id,
      currentTermsVersionLabel: "v1",
      currentPrivacyDocumentId: COMPLETE_LEGAL_ROWS[1].id,
      currentPrivacyVersionLabel: "v1",
    };
    const harness = harnessReturning(shifting);

    await harness.coordinator.startUp();

    // Exactly one read of the field, so every later comparison uses the same value.
    expect(reads).toBe(1);
  });

  it("a throwing getter fails closed as unconfirmed", async () => {
    const throwing = {
      ...coherentFacts(),
      get hasAthleteCapability(): boolean {
        throw new Error("sb_secret_must_not_travel");
      },
    };
    const harness = harnessReturning(throwing);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("identity_unconfirmed");
    expect(JSON.stringify(outcome)).not.toContain("sb_secret");
  });

  it("a Proxy whose traps throw fails closed as unconfirmed", async () => {
    const hostile = new Proxy(coherentFacts(), {
      get() {
        throw new Error("sb_secret_must_not_travel");
      },
      getPrototypeOf() {
        throw new Error("sb_secret_must_not_travel");
      },
    });
    const harness = harnessReturning(hostile);

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).toBe("identity_unconfirmed");
  });

  it("a Proxy that reports one Profile then another cannot be accepted twice", async () => {
    let gets = 0;
    const drifting = new Proxy(coherentFacts(), {
      get(target, key, receiver) {
        if (key === "profileId") {
          gets += 1;
          return gets === 1 ? PROFILE_A : null;
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const harness = harnessReturning(drifting);

    const outcome = await harness.coordinator.startUp();

    // Either it was accepted from the FIRST read and is internally consistent, or it
    // failed closed. What must never happen is a ready gate built from two
    // different answers.
    expect(gets).toBe(1);
    expect(["ready_online", "identity_unconfirmed", "onboarding_required"]).toContain(
      outcome.verdict.kind
    );
  });
});

describe("LegalSnapshot.fetchedAt", () => {
  const MALFORMED: unknown[] = ["", "not-a-timestamp", "2026-13-45T99:99:99Z", 0, null, undefined];

  it("must be an actual timestamp at the parsing boundary", () => {
    for (const value of MALFORMED) {
      expect(
        parseLegalDocumentsResponse(COMPLETE_LEGAL_ROWS, value as string).ok,
        String(value)
      ).toBe(false);
    }
    expect(parseLegalDocumentsResponse(COMPLETE_LEGAL_ROWS, FIXED_NOW).ok).toBe(true);
  });

  it("must be an actual timestamp at the coordinator's snapshot boundary", async () => {
    for (const value of MALFORMED) {
      const harness = createIdentityHarness({
        url: REDIRECT_TARGET,
        identityOverrides: {
          getLegalSnapshot: async (): Promise<IdentityResult<LegalSnapshot>> =>
            identityOk({
              terms: null,
              privacy: null,
              fetchedAt: value,
            } as unknown as LegalSnapshot),
        },
      });
      harness.fakeAuth.state.restore = { kind: "no_session" };

      const outcome = await harness.coordinator.startUp();

      // A snapshot that cannot be trusted is `legal_unavailable`: sign-in is not
      // offered, and no partial snapshot reaches the gate.
      expect(outcome.verdict.kind, String(value)).toBe("legal_unavailable");
    }
  });

  it("a well-formed snapshot is still accepted", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.fakeAuth.state.restore = { kind: "no_session" };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("signed_out");
  });
});

// ---------------------------------------------------------------------------
// The callback claim facade
// ---------------------------------------------------------------------------

/**
 * Builds a coordinator over a capture cell whose issued claim is `claim`.
 *
 * The exchange boundary records what it actually received, so a test can prove the
 * facade — not the original object — is what crossed it.
 */
function coordinatorWithClaim(claim: unknown): {
  start(): Promise<unknown>;
  received: ClaimedCallback[];
} {
  const storage = createMemoryStorage();
  // A barrier and a matching Google attempt, so Phase 0 genuinely ADMITS the
  // continuation and the exchange boundary is actually reached.
  storage.seed(
    STORAGE_KEYS.barrier,
    createIdentityAccessBarrier({
      barrierId: CLAIM_BARRIER,
      origin: "interactive_authentication",
      barredAccountScopeId: null,
      barredGeneration: null,
      establishedAt: FIXED_NOW,
    })
  );
  storage.seed(
    STORAGE_KEYS.attempt,
    createGoogleAttempt({
      attemptId: CLAIM_ATTEMPT,
      flowId: CLAIM_FLOW_ID,
      barrierId: CLAIM_BARRIER,
      capturedIdentityGeneration: 1,
      startedAt: FIXED_NOW,
    })
  );
  const backend = createFakeIdentityBackend();
  backend.legalRows = COMPLETE_LEGAL_ROWS;
  backend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  const received: ClaimedCallback[] = [];
  let counter = 0;

  const capture = createCallbackCaptureCell({
    readCurrentUrl: () => callbackUrl({ code: SYNTHETIC_CODE, flowId: CLAIM_FLOW_ID }),
    replaceCurrentUrl: () => {},
  });

  const coordinator = createIdentityTransitionCoordinator({
    auth: {
      restoreSession: async () => ({ kind: "authenticated", identity: IDENTITY_A }),
      onAuthChange: () => () => {},
      requestEmailOtp: async () => ({ ok: true, value: undefined }),
      verifyEmailOtp: async () => ({ ok: true, value: IDENTITY_A }),
      signOut: async () => ({ ok: true, value: undefined }),
      prepareGoogleSignIn: async () => ({ kind: "preparation_failed" }),
      navigateToAuthorizationUrl: () => ({ kind: "navigation_failed" }),
      exchangeCorrelatedCallback: async (issued): Promise<ExchangeOutcome> => {
        received.push(issued);
        return { kind: "exchange_failed" };
      },
    },
    identity: createFakeIdentityService(backend) as IdentityService,
    capture: {
      ...capture,
      claimCallbackForExchange: (): CallbackClaim => claim as CallbackClaim,
    },
    barriers: createIdentityBarrierRepository(storage.adapter),
    attempts: createInteractiveAttemptRepository(storage.adapter),
    resolutions: createIdentityBarrierResolutionRepository(storage.adapter),
    trusted: createTrustedDeviceRepository(storage.adapter),
    intents: createPendingIntentRepository(storage.adapter),
    liveGeneration: createLiveGenerationCounter(),
    now: () => FIXED_NOW,
    newId: () => {
      counter += 1;
      return `70000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
    },
    resolveRedirectTarget: () => REDIRECT_TARGET,
  });

  return { start: () => coordinator.startUp(), received };
}

describe("the callback claim facade", () => {
  it("is a CLOSED facade, never the issued object", async () => {
    const issued = {
      flowId: CLAIM_FLOW_ID,
      readAuthorizationCode: () => SECRET_CODE,
      toJSON: () => ({ leaked: SECRET_CODE }),
      extra: SECRET_CODE,
    };
    const { start, received } = coordinatorWithClaim({ kind: "claimed", claim: issued });

    await start();

    expect(received).toHaveLength(1);
    const crossed = received[0] as ClaimedCallback & { extra?: unknown };
    expect(crossed).not.toBe(issued);
    // Nothing beyond the contract is carried across.
    expect(crossed.extra).toBeUndefined();
    // And nothing serializes: not the code, and not the selector.
    expect(JSON.stringify(crossed)).toBe("{}");
    expect(JSON.stringify(crossed)).not.toContain(SECRET_CODE);
    expect(JSON.stringify(crossed)).not.toContain(CLAIM_FLOW_ID);
  });

  it("snapshots the selector and the reader EXACTLY ONCE", async () => {
    let selectorReads = 0;
    let readerReads = 0;
    const issued = {
      get flowId(): string {
        selectorReads += 1;
        return selectorReads === 1 ? CLAIM_FLOW_ID : "flow-y-111111111111";
      },
      get readAuthorizationCode(): () => string | null {
        readerReads += 1;
        // A second read would hand over a different function entirely.
        return readerReads === 1 ? () => SECRET_CODE : () => "sb_swapped_code";
      },
    };
    const { start, received } = coordinatorWithClaim({ kind: "claimed", claim: issued });

    await start();

    expect(selectorReads).toBe(1);
    expect(readerReads).toBe(1);
    expect(received[0]?.flowId).toBe(CLAIM_FLOW_ID);
    // The reader captured on the first read is the one that is called.
    expect(received[0]?.readAuthorizationCode()).toBe(SECRET_CODE);
  });

  it("preserves SINGLE-USE behaviour: a second read yields nothing", async () => {
    let calls = 0;
    const issued = {
      flowId: CLAIM_FLOW_ID,
      readAuthorizationCode: () => {
        calls += 1;
        return calls === 1 ? SECRET_CODE : null;
      },
    };
    const { start, received } = coordinatorWithClaim({ kind: "claimed", claim: issued });

    await start();

    const crossed = received[0] as ClaimedCallback;
    expect(crossed.readAuthorizationCode()).toBe(SECRET_CODE);
    expect(crossed.readAuthorizationCode()).toBeNull();
    expect(crossed.readAuthorizationCode()).toBeNull();
    // The underlying reader was invoked exactly once, whatever the caller does.
    expect(calls).toBe(1);
  });

  it("contains a THROWING reader rather than letting it escape", async () => {
    const issued = {
      flowId: CLAIM_FLOW_ID,
      readAuthorizationCode: (): string => {
        throw new Error("sb_secret_must_not_travel");
      },
    };
    const { start, received } = coordinatorWithClaim({ kind: "claimed", claim: issued });

    await start();

    const crossed = received[0] as ClaimedCallback;
    expect(() => crossed.readAuthorizationCode()).not.toThrow();
    expect(crossed.readAuthorizationCode()).toBeNull();
  });

  it("contains a reader returning a non-string", async () => {
    for (const value of [null, undefined, 42, {}, ""]) {
      const issued = {
        flowId: CLAIM_FLOW_ID,
        readAuthorizationCode: () => value as unknown as string,
      };
      const { start, received } = coordinatorWithClaim({ kind: "claimed", claim: issued });
      await start();
      expect(received[0]?.readAuthorizationCode(), String(value)).toBeNull();
    }
  });

  it("refuses a claim whose shape is unusable, with ZERO provider calls", async () => {
    const unusable: unknown[] = [
      { kind: "claimed", claim: null },
      { kind: "claimed", claim: { flowId: CLAIM_FLOW_ID } },
      { kind: "claimed", claim: { readAuthorizationCode: () => SECRET_CODE } },
      { kind: "claimed", claim: { flowId: "", readAuthorizationCode: () => SECRET_CODE } },
      { kind: "claimed", claim: { flowId: 7, readAuthorizationCode: () => SECRET_CODE } },
      {
        kind: "claimed",
        claim: { flowId: CLAIM_FLOW_ID, readAuthorizationCode: "not a function" },
      },
      { kind: "no_claim" },
      null,
      new Proxy(
        {},
        {
          get() {
            throw new Error("sb_secret_must_not_travel");
          },
        }
      ),
    ];
    for (const [index, claim] of unusable.entries()) {
      const { start, received } = coordinatorWithClaim(claim);
      await start();
      expect(received, `unusable claim #${index}`).toHaveLength(0);
    }
  });

  it("contains a hostile Proxy claim: the facade reads through it once and nothing throws", async () => {
    let gets = 0;
    const issued = new Proxy(
      { flowId: CLAIM_FLOW_ID, readAuthorizationCode: () => SECRET_CODE },
      {
        get(target, key, receiver) {
          gets += 1;
          if (key === "toJSON") throw new Error("sb_secret_must_not_travel");
          return Reflect.get(target, key, receiver);
        },
      }
    );
    const { start, received } = coordinatorWithClaim({ kind: "claimed", claim: issued });

    await start();

    expect(received).toHaveLength(1);
    // Two property reads only — the selector and the reader.
    expect(gets).toBe(2);
    expect(JSON.stringify(received[0])).toBe("{}");
  });
});
