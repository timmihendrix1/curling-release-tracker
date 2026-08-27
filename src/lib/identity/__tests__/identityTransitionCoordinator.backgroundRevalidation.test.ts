// BACKGROUND REVALIDATION IS GENUINELY NON-BLOCKING (ADR-0025 §A, §15).
//
// Revalidation runs while a ready session is already mounted. It exists to learn
// negative facts online, not to take the application away from someone who is
// already using it. So, for the whole operation:
//
//   * the existing ready session STAYS MOUNTED — no lock, no loading state, no
//     flicker, not even while the server call is in flight;
//   * a transient result, an unconfirmed identity, a supersession and a failed
//     metadata refresh all leave the state EXACTLY as it is;
//   * a successful same-identity confirmation refreshes the session in place;
//   * only a DEFINITIVE negative moves a ready state into denial — and
//     `identity_denied_in_memory` is still immediately deny-ward, from every state.
//
// That is a property of the event/reducer contract, not of a later UI layer
// remembering to filter generic progress: every result a background operation
// returns carries `mode: "background"`, and the reducer keys off it.
//
// Each case below runs the REAL coordinator and feeds the REAL progress and
// settling events into the REAL reducer, starting from both `ready_online` and —
// where the path is reachable — `ready_offline`.
import { describe, expect, it } from "vitest";
import {
  BARRIER_A,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  IDENTITY_B,
  PINNED_PRIVACY,
  PINNED_TERMS,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  createIdentityHarness,
  report,
  view,
  type IdentityHarness,
  type MemoryStorage,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { programIdentityFailure } from "../fakeIdentityService";
import {
  isGateReady,
  reduceGateState,
  type GateSession,
  type GateState,
} from "../gateState";
import type { RevalidationOutcome } from "../identityTransitionCoordinator";

const ATTEMPT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const COMPLETED_AT = "2026-02-01T09:00:00.000Z";

const SESSION: GateSession = {
  accountScopeId: IDENTITY_A.accountScopeId,
  email: IDENTITY_A.email,
  profileId: PROFILE_A,
  displayName: "Athlete",
  entitlement: "free",
};

/** The two ready states a revalidation can legitimately begin from. `ready_offline`
 * carries no email, exactly as an offline continuation does. */
const READY_STATES: Array<[string, GateState]> = [
  ["ready_online", { kind: "ready_online", session: SESSION }],
  ["ready_offline", { kind: "ready_offline", session: { ...SESSION, email: null } }],
];

function onboard(harness: IdentityHarness, accountScopeId = IDENTITY_A.accountScopeId): void {
  harness.identityBackend.currentAccountScopeId = accountScopeId;
  harness.identityBackend.accounts.set(accountScopeId, {
    profileId: PROFILE_A,
    displayName: "Athlete",
    onboardingCompletedAt: COMPLETED_AT,
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
  });
}

function seedTrusted(storage: MemoryStorage, accountScopeId = IDENTITY_A.accountScopeId): void {
  storage.seed(
    STORAGE_KEYS.trusted,
    createTrustedDeviceRecord({
      accountScopeId,
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: COMPLETED_AT,
      generation: 1,
      establishedAt: FIXED_NOW,
      lastServerConfirmationAt: FIXED_NOW,
    })
  );
}

function seedCorrelatedSet(storage: MemoryStorage): void {
  storage.seed(
    STORAGE_KEYS.barrier,
    createIdentityAccessBarrier({
      barrierId: BARRIER_A,
      origin: "interactive_authentication",
      barredAccountScopeId: null,
      barredGeneration: null,
      establishedAt: FIXED_NOW,
    })
  );
  storage.seed(
    STORAGE_KEYS.attempt,
    createGoogleAttempt({
      attemptId: ATTEMPT,
      flowId: FLOW_X,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 1,
      startedAt: FIXED_NOW,
    })
  );
  storage.seed(
    STORAGE_KEYS.resolutionFor(BARRIER_A),
    createIdentityBarrierResolution({
      barrierId: BARRIER_A,
      attemptId: ATTEMPT,
      method: "google",
      flowId: FLOW_X,
      identityGeneration: 1,
      authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
      resolvedAt: FIXED_NOW,
    })
  );
}

function trustedHarness(): IdentityHarness {
  const harness = createIdentityHarness({ url: REDIRECT_TARGET });
  seedTrusted(harness.storage);
  seedCorrelatedSet(harness.storage);
  onboard(harness);
  harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
  return harness;
}

/**
 * Replays the operation's real events into `from`, in the order the coordinator
 * produced them: every announced progress phase, then the settled outcome.
 */
function replay(
  harness: IdentityHarness,
  from: GateState,
  outcome: RevalidationOutcome
): GateState {
  let state = from;
  for (const [phase, transition] of harness.progressEvents) {
    state = reduceGateState(state, { type: "progress", phase, transition });
  }
  return reduceGateState(state, { type: "transition_settled", outcome });
}

describe("a SUCCESSFUL same-identity confirmation", () => {
  it("refreshes the ready session in place, with no intervening loading state", async () => {
    for (const [label, ready] of READY_STATES) {
      const harness = trustedHarness();

      const outcome = await harness.coordinator.revalidateGateFacts();
      expect(outcome.kind, label).toBe("resolved");
      expect(outcome.transition?.mode, label).toBe("background");

      // Every announced phase, applied one at a time: the gate is ready at EVERY
      // step, so there is no frame in which the shell would have unmounted.
      let state = ready;
      for (const [phase, transition] of harness.progressEvents) {
        state = reduceGateState(state, { type: "progress", phase, transition });
        expect(isGateReady(state), `${label} / during ${phase}`).toBe(true);
      }

      const final = reduceGateState(state, { type: "transition_settled", outcome });
      expect(isGateReady(final), label).toBe(true);
      expect(final.kind, label).toBe("ready_online");
    }
  });

  it("does announce its phases, so the operation stays orderable", async () => {
    const harness = trustedHarness();
    await harness.coordinator.revalidateGateFacts();
    expect(harness.progress).toContain("resolving_gate_facts");
    // ...and every one of them is tagged background.
    expect(
      harness.progressEvents
        .filter(([phase]) => phase === "resolving_gate_facts")
        .every(([, transition]) => transition?.mode === "background")
    ).toBe(true);
  });
});

describe("a TRANSIENT or unconfirmed result", () => {
  it("leaves both ready states exactly as they were", async () => {
    const transientRestores = [
      { kind: "temporarily_unavailable" } as const,
      { kind: "restore_failed" } as const,
    ];
    for (const restore of transientRestores) {
      for (const [label, ready] of READY_STATES) {
        const harness = trustedHarness();
        harness.fakeAuth.state.restore = restore;

        const outcome = await harness.coordinator.revalidateGateFacts();
        expect(report(outcome), `${restore.kind} / ${label}`).toEqual({
          kind: "temporarily_unavailable",
        });

        // The RENDERED state is byte-identical: only the invisible order mark
        // advanced, so nothing the shell can see changed.
        const final = replay(harness, ready, outcome);
        expect(view(final), `${restore.kind} / ${label}`).toEqual(view(ready));
        expect(isGateReady(final)).toBe(true);
      }
    }
  });

  it("a non-definitive gate-facts failure is transient, and never a denial", async () => {
    for (const [label, ready] of READY_STATES) {
      const harness = trustedHarness();
      programIdentityFailure(harness.identityBackend, "resolveGateFacts", "network_error");

      const outcome = await harness.coordinator.revalidateGateFacts();
      expect(report(outcome), label).toEqual({ kind: "temporarily_unavailable" });
      expect(outcome.denial, label).toBeUndefined();

      const final = replay(harness, ready, outcome);
      expect(view(final), label).toEqual(view(ready));
      // Trusted state is untouched: a bad network never revokes a trusted device.
      expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
    }
  });
});

describe("a FAILED metadata refresh", () => {
  it("is non-fatal: the ready state stands and no timestamp is fabricated", async () => {
    for (const [label, ready] of READY_STATES) {
      const harness = trustedHarness();
      const before = harness.storage.store.get(STORAGE_KEYS.trusted);
      harness.storage.failWrites.add(STORAGE_KEYS.trusted);

      const outcome = await harness.coordinator.revalidateGateFacts();
      expect(report(outcome), label).toEqual({ kind: "trusted_state_refresh_skipped" });

      const final = replay(harness, ready, outcome);
      expect(view(final), label).toEqual(view(ready));
      expect(isGateReady(final)).toBe(true);
      // The stored record is byte-identical: no partial write, no invented
      // confirmation timestamp.
      expect(harness.storage.store.get(STORAGE_KEYS.trusted)).toBe(before);
    }
  });
});

describe("a SUPERSEDED revalidation", () => {
  it("reports supersession — not a transient failure — and leaves the session mounted", async () => {
    for (const [label, ready] of READY_STATES) {
      const harness = trustedHarness();
      const before = harness.storage.store.get(STORAGE_KEYS.trusted);
      // A newer barrier appears as the trusted record is read for the refresh.
      harness.storage.onBeforeCall = (call) => {
        if (call === `get:${STORAGE_KEYS.trusted}`) {
          harness.storage.onBeforeCall = null;
          harness.liveGeneration.bump();
        }
      };

      const outcome = await harness.coordinator.revalidateGateFacts();
      expect(report(outcome), label).toEqual({ kind: "superseded" });
      expect(outcome.denial, label).toBeUndefined();

      const final = replay(harness, ready, outcome);
      expect(view(final), label).toEqual(view(ready));
      expect(harness.storage.store.get(STORAGE_KEYS.trusted)).toBe(before);
    }
  });
});

describe("a background revalidation can REFRESH a ready gate but never OPEN one", () => {
  it("cannot open the gate from any non-ready state, even with a ready verdict", async () => {
    const harness = trustedHarness();
    const outcome = await harness.coordinator.revalidateGateFacts();
    expect(outcome.kind).toBe("resolved");
    if (outcome.kind !== "resolved") return;
    expect(outcome.gate.kind).toBe("ready_online");

    // Opening the gate runs the pre-ready trusted-state and pending-intent checks,
    // and a background operation performs neither. So it may refresh a session that
    // is already mounted, and nothing else.
    const nonReady: GateState[] = [
      { kind: "identity_unconfirmed" },
      { kind: "intaking_oauth_return" },
      { kind: "signing_out" },
      { kind: "awaiting_otp" },
      { kind: "recoverable_error", reason: "trusted_state_not_established" },
      { kind: "locked", origin: "explicit_sign_out", callbackNotice: "none" },
      { kind: "quarantined_locked", origin: "interactive_authentication", callbackNotice: "none" },
      { kind: "storage_unavailable_locked" },
    ];
    for (const state of nonReady) {
      const final = replay(harness, state, outcome);
      expect(isGateReady(final), state.kind).toBe(false);
      expect(view(final), state.kind).toEqual(view(state));
    }
  });

  it("never becomes the state's correlated operation, so it cannot manufacture that proof", async () => {
    const harness = trustedHarness();
    const outcome = await harness.coordinator.revalidateGateFacts();

    let state: GateState = { kind: "identity_unconfirmed" };
    for (const [phase, transition] of harness.progressEvents) {
      state = reduceGateState(state, { type: "progress", phase, transition });
    }
    // The order mark advanced; the correlation proof did not change hands.
    expect(state.transition).toBeUndefined();
    expect(state.acceptedSequence).toBeGreaterThan(0);
    expect(isGateReady(reduceGateState(state, { type: "transition_settled", outcome }))).toBe(false);
  });
});

describe("a DEFINITIVE negative", () => {
  it("denies immediately from both ready states, and in memory before any durable write", async () => {
    for (const [label, ready] of READY_STATES) {
      const harness = trustedHarness();
      programIdentityFailure(harness.identityBackend, "resolveGateFacts", "forbidden");

      const outcome = await harness.coordinator.revalidateGateFacts();
      expect(report(outcome), label).toEqual({ kind: "identity_invalidated" });
      expect(outcome.denial, label).toBe("server_identity_invalidated");

      // The in-memory denial is announced BEFORE the barrier is written.
      const denialIndex = harness.log.indexOf("progress:identity_denied_in_memory");
      const barrierWriteIndex = harness.log.indexOf(`storage:set:${STORAGE_KEYS.barrier}`);
      expect(denialIndex, label).toBeGreaterThanOrEqual(0);
      expect(denialIndex, label).toBeLessThan(barrierWriteIndex);

      // And the reducer denies at that announcement — not only at the settle.
      let state = ready;
      for (const [phase, transition] of harness.progressEvents) {
        state = reduceGateState(state, { type: "progress", phase, transition });
        if (phase === "identity_denied_in_memory") {
          expect(isGateReady(state), `${label} / at the in-memory denial`).toBe(false);
        }
      }
      const final = reduceGateState(state, { type: "transition_settled", outcome });
      expect(final.kind, label).toBe("locked");
      expect(isGateReady(final), label).toBe(false);
    }
  });

  it("a revoked entitlement, a vanished record and an account mismatch all deny", async () => {
    const cases: Array<[string, (harness: IdentityHarness) => void]> = [
      [
        "a revoked Free entitlement",
        (harness) => {
          const state = harness.identityBackend.accounts.get(IDENTITY_A.accountScopeId);
          if (state !== undefined) state.freeEntitlementActive = false;
        },
      ],
      [
        "a trusted record that has vanished",
        (harness) => {
          harness.storage.store.delete(STORAGE_KEYS.trusted);
        },
      ],
      [
        "a session naming another account",
        (harness) => {
          harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_B };
          onboard(harness, IDENTITY_B.accountScopeId);
        },
      ],
      [
        "a definitively signed-out session",
        (harness) => {
          harness.fakeAuth.state.restore = { kind: "no_session" };
        },
      ],
      [
        "a definitively invalid session",
        (harness) => {
          harness.fakeAuth.state.restore = { kind: "invalid_session" };
        },
      ],
    ];

    for (const [caseLabel, arrange] of cases) {
      for (const [label, ready] of READY_STATES) {
        const harness = trustedHarness();
        arrange(harness);

        const outcome = await harness.coordinator.revalidateGateFacts();
        expect(outcome.denial, `${caseLabel} / ${label}`).toBe("server_identity_invalidated");

        const final = replay(harness, ready, outcome);
        expect(isGateReady(final), `${caseLabel} / ${label}`).toBe(false);
        expect(final.kind, `${caseLabel} / ${label}`).toBe("locked");
      }
    }
  });

  it("a double durable failure denies without claiming any revocation", async () => {
    for (const [label, ready] of READY_STATES) {
      const harness = trustedHarness();
      programIdentityFailure(harness.identityBackend, "resolveGateFacts", "forbidden");
      harness.storage.failWrites.add(STORAGE_KEYS.barrier);
      harness.storage.failRemoves.add(STORAGE_KEYS.trusted);

      const outcome = await harness.coordinator.revalidateGateFacts();
      expect(report(outcome), label).toEqual({ kind: "durable_denial_unavailable" });
      expect(outcome.denial, label).toBe("durable_denial_unavailable");

      const final = replay(harness, ready, outcome);
      expect(final.kind, label).toBe("storage_unavailable_locked");
      expect(isGateReady(final), label).toBe(false);
    }
  });
});
