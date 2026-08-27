// A LEGAL REFRESH CLAIMS NO OWNERSHIP — AND MUST THEREFORE TAKE NOTHING EITHER.
//
// Refetching the current Legal documents cannot change who is authenticated, so it
// deliberately does not claim the coordinator's operation slot (ADR-0025 §9). That
// exemption has a cost the reducer has to pay for: an event carrying no operation
// must not
//
//   * replace the phase the person is actually waiting on, or
//   * erase the active operation's correlation — which is the exact proof
//     `applyVerdict` demands before that operation's own ready result may be
//     accepted.
//
// Erasing it would be the worst of both worlds: the refetch would never claim the
// gate, yet it would disqualify the rightful result of the operation that did. So a
// refetch's progress and result are accepted ONLY from the states where a refetch is
// a meaningful thing to be doing, and even there they carry the active operation
// forward untouched.
//
// Every case below drives the REAL coordinator and feeds its REAL events into the
// REAL reducer, in the order they were produced.
import { describe, expect, it } from "vitest";
import {
  COMPLETE_LEGAL_ROWS,
  FIXED_NOW,
  IDENTITY_A,
  PINNED_PRIVACY,
  PINNED_TERMS,
  PROFILE_A,
  PRIVACY_DOC_V1,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  TERMS_DOC_V1,
  createIdentityHarness,
  deferred,
  legalRow,
  report,
  settleMicrotasks,
  view,
  type IdentityHarness,
} from "./support/identityTestHarness";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { identityOk, type IdentityResult } from "../errors";
import type { GateFacts } from "../identityService";
import type { LegalSnapshot } from "../legalSnapshot";
import {
  initialGateState,
  isGateReady,
  reduceGateState,
  type GateEvent,
  type GateState,
} from "../gateState";

const EMAIL = "athlete@example.test";
const COMPLETED_AT = "2026-02-01T09:00:00.000Z";

function onboard(harness: IdentityHarness): void {
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
}

function seedTrusted(harness: IdentityHarness): void {
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
}

describe("a Legal refresh overlapping an OTP verification", () => {
  it("changes neither the visible authentication phase nor the rightful OTP result", async () => {
    // The Legal refetch is held open so it is genuinely IN FLIGHT while the
    // verification runs, and its result arrives afterwards — the ordering that makes
    // this a real overlap rather than two sequential calls.
    const gate = deferred<IdentityResult<LegalSnapshot>>();
    const arrived = deferred<void>();
    let legalCalls = 0;
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      identityOverrides: {
        getLegalSnapshot: async (): Promise<IdentityResult<LegalSnapshot>> => {
          legalCalls += 1;
          if (legalCalls === 1) {
            arrived.resolve();
            return gate.promise;
          }
          return identityOk<LegalSnapshot>({ terms: null, privacy: null, fetchedAt: FIXED_NOW });
        },
      },
    });
    seedTrusted(harness);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    await harness.coordinator.requestEmailOtp(EMAIL);

    const refresh = harness.coordinator.refreshLegalSnapshot();
    await arrived.promise;

    // The verification runs to completion while the refetch is suspended.
    const verification = await harness.coordinator.verifyEmailOtp(EMAIL, "123456");
    expect(verification.kind).toBe("resolved");
    if (verification.kind !== "resolved") return;
    expect(verification.gate.kind).toBe("ready_online");

    // The refetch resolves LAST.
    gate.resolve(
      identityOk<LegalSnapshot>({ terms: null, privacy: null, fetchedAt: FIXED_NOW })
    );
    const refreshed = await refresh;

    // Replay every event in the order the coordinator produced them: the refetch's
    // phase, then the verification's phases, then the verification's result, then
    // the refetch's result.
    let state: GateState = initialGateState();
    const seen: Array<GateState["kind"]> = [];
    for (const [phase, transition] of harness.progressEvents) {
      state = reduceGateState(state, { type: "progress", phase, transition });
      seen.push(state.kind);
    }

    // The refetch NEVER became the visible phase: the person kept seeing the
    // authentication they were waiting on.
    expect(seen).not.toContain("refreshing_legal_snapshot");
    expect(state.kind).toBe("finalizing_identity");

    const settled = reduceGateState(state, {
      type: "transition_settled",
      outcome: verification,
    });
    expect(isGateReady(settled)).toBe(true);

    const afterRefresh = reduceGateState(settled, {
      type: "legal_refreshed",
      outcome: refreshed,
    });
    // And the refetch's own result cannot take the ready session away either.
    expect(view(afterRefresh)).toEqual(view(settled));
    expect(isGateReady(afterRefresh)).toBe(true);
  });

  it("does not erase the active operation's correlation, so the OTP result still settles", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedTrusted(harness);
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    await harness.coordinator.requestEmailOtp(EMAIL);

    // Build the state the verification is progressing through.
    const verification = harness.coordinator.verifyEmailOtp(EMAIL, "123456");
    await settleMicrotasks();
    let state: GateState = initialGateState();
    for (const [phase, transition] of harness.progressEvents) {
      state = reduceGateState(state, { type: "progress", phase, transition });
    }
    const correlationBefore = state.transition;
    expect(correlationBefore).toBeDefined();

    // A refetch's unannotated progress arrives mid-verification.
    const afterLegalProgress = reduceGateState(state, {
      type: "progress",
      phase: "refreshing_legal_snapshot",
    });
    expect(afterLegalProgress).toBe(state);
    expect(afterLegalProgress.transition).toBe(correlationBefore);

    const outcome = await verification;
    const settled = reduceGateState(afterLegalProgress, {
      type: "transition_settled",
      outcome,
    });
    expect(isGateReady(settled)).toBe(true);
  });

  it("still works where a refetch IS meaningful, carrying the active operation forward", async () => {
    // Rotation between display and submission: `stale_legal_version` returns the new
    // snapshot, and a subsequent refetch is exactly what the onboarding screen does.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const refreshed = await harness.coordinator.refreshLegalSnapshot();
    expect(refreshed.kind).toBe("refreshed");

    const onboarding: GateState = {
      kind: "onboarding_required",
      legal:
        refreshed.kind === "refreshed"
          ? refreshed.legal
          : { terms: null, privacy: null, fetchedAt: FIXED_NOW },
      transition: { id: "active", sequence: 7, mode: "foreground" },
      acceptedSequence: 7,
    };

    const progressed = reduceGateState(onboarding, {
      type: "progress",
      phase: "refreshing_legal_snapshot",
    });
    expect(progressed.kind).toBe("refreshing_legal_snapshot");
    // Carried forward, not erased.
    expect(progressed.transition).toEqual(onboarding.transition);
    expect(progressed.acceptedSequence).toBe(7);

    const settled = reduceGateState(progressed, {
      type: "legal_refreshed",
      outcome: refreshed,
    });
    expect(settled.kind).toBe("onboarding_required");
    expect(settled.transition).toEqual(onboarding.transition);
  });

  it("a refetch result is a no-op from every state where a refetch is not meaningful", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    const refreshed = await harness.coordinator.refreshLegalSnapshot();

    const unrelated: GateState[] = [
      { kind: "verifying_otp" },
      { kind: "finalizing_identity" },
      { kind: "consuming_oauth_return" },
      { kind: "establishing_trusted_state" },
      { kind: "awaiting_otp" },
      { kind: "signing_out" },
      { kind: "locked", origin: "explicit_sign_out", callbackNotice: "none" },
      { kind: "quarantined_locked", origin: "interactive_authentication", callbackNotice: "none" },
      { kind: "storage_unavailable_locked" },
      { kind: "cloud_unavailable" },
      {
        kind: "ready_online",
        session: {
          accountScopeId: IDENTITY_A.accountScopeId,
          email: IDENTITY_A.email,
          profileId: PROFILE_A,
          displayName: "Athlete",
          entitlement: "free",
        },
      },
    ];
    const events: GateEvent[] = [
      { type: "progress", phase: "refreshing_legal_snapshot" },
      { type: "legal_refreshed", outcome: refreshed },
      { type: "legal_refreshed", outcome: { kind: "legal_unavailable" } },
    ];
    for (const state of unrelated) {
      for (const event of events) {
        expect(reduceGateState(state, event), `${state.kind} / ${event.type}`).toBe(state);
      }
    }
  });
});

describe("background revalidation and the scalar contract", () => {
  const IMPOSSIBLE: Array<[string, Partial<GateFacts>]> = [
    ["a blank display name", { displayName: "   " }],
    ["an over-long display name", { displayName: "x".repeat(81) }],
    ["an empty display name", { displayName: "" }],
    [
      "a blank pinned version label",
      { pinnedTerms: { ...PINNED_TERMS, versionLabel: "  " } },
    ],
    [
      "an over-long pinned version label",
      { pinnedPrivacy: { ...PINNED_PRIVACY, versionLabel: "v".repeat(121) } },
    ],
    [
      "a blank current reporting label",
      { currentTermsDocumentId: TERMS_DOC_V1, currentTermsVersionLabel: "   " },
    ],
    [
      "an over-long current reporting label",
      { currentPrivacyDocumentId: PRIVACY_DOC_V1, currentPrivacyVersionLabel: "v".repeat(121) },
    ],
  ];

  for (const [label, overrides] of IMPOSSIBLE) {
    it(`cannot reach a refreshed ready session with ${label}`, async () => {
      const harness = createIdentityHarness({
        url: REDIRECT_TARGET,
        identityOverrides: {
          resolveGateFacts: async (): Promise<IdentityResult<GateFacts>> =>
            identityOk<GateFacts>({
              profileId: PROFILE_A,
              displayName: "Athlete",
              onboardingCompletedAt: COMPLETED_AT,
              hasAthleteCapability: true,
              freeEntitlementActive: true,
              pinnedTerms: PINNED_TERMS,
              pinnedPrivacy: PINNED_PRIVACY,
              currentTermsDocumentId: null,
              currentTermsVersionLabel: null,
              currentPrivacyDocumentId: null,
              currentPrivacyVersionLabel: null,
              ...overrides,
            }),
        },
      });
      seedTrusted(harness);
      onboard(harness);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      const before = harness.storage.store.get(STORAGE_KEYS.trusted);

      const outcome = await harness.coordinator.revalidateGateFacts();

      // Unconfirmed/transient — never a definitive server negative, because a
      // malformed success is not the server saying no, and a denial would revoke a
      // legitimate device.
      expect(report(outcome), label).toEqual({ kind: "temporarily_unavailable" });
      expect(outcome.denial, label).toBeUndefined();
      // Nothing was refreshed, and no impossible value reached a session.
      expect(harness.storage.store.get(STORAGE_KEYS.trusted), label).toBe(before);
      expect(JSON.stringify(outcome), label).not.toContain("x".repeat(81));
    });
  }

  it("a legitimate value at the exact bound still refreshes", async () => {
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      legalRows: [
        legalRow("terms_of_service", TERMS_DOC_V1, "v".repeat(120)),
        legalRow("privacy_notice", PRIVACY_DOC_V1, "v1"),
      ],
      identityOverrides: {
        resolveGateFacts: async (): Promise<IdentityResult<GateFacts>> =>
          identityOk<GateFacts>({
            profileId: PROFILE_A,
            displayName: "y".repeat(80),
            onboardingCompletedAt: COMPLETED_AT,
            hasAthleteCapability: true,
            freeEntitlementActive: true,
            pinnedTerms: { ...PINNED_TERMS, versionLabel: "v".repeat(120) },
            pinnedPrivacy: PINNED_PRIVACY,
            currentTermsDocumentId: TERMS_DOC_V1,
            currentTermsVersionLabel: "v".repeat(120),
            currentPrivacyDocumentId: PRIVACY_DOC_V1,
            currentPrivacyVersionLabel: "v1",
          }),
      },
    });
    harness.storage.seed(
      STORAGE_KEYS.trusted,
      createTrustedDeviceRecord({
        accountScopeId: IDENTITY_A.accountScopeId,
        profileId: PROFILE_A,
        displayName: "y".repeat(80),
        onboardingCompletedAt: COMPLETED_AT,
        generation: 1,
        establishedAt: FIXED_NOW,
        lastServerConfirmationAt: FIXED_NOW,
      })
    );
    onboard(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.revalidateGateFacts();

    expect(outcome.kind).toBe("resolved");
    expect(COMPLETE_LEGAL_ROWS.length).toBe(2);
  });
});
