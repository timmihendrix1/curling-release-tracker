// The pure gate reducer (ADR-0025 §1-§4, §14, §15).
//
// Three properties are structural and are asserted exhaustively here:
//
//  1. no provider auth change — `signed_in` included — can open the application;
//  2. a ready state is reachable only from a state that was resolving
//     server-authoritative facts;
//  3. a lock is never lifted by a non-lock verdict.
//
// Plus the discipline the rest of this codebase already follows (ADR-0007): an
// event that is invalid for the current state is a **no-op, never a throw**, and
// the whole transition is computed as one plain value.
import { describe, expect, it } from "vitest";
import {
  initialGateState,
  isGateReady,
  reduceGateState,
  type GateEvent,
  type GateProgressPhase,
  type GateSession,
  type GateState,
  type GateVerdict,
  type IdentityTransitionOutcome,
  type TransitionIdentity,
} from "../gateState";
import type { NormalizedAuthChange } from "../../supabase/authService";
import {
  FIXED_NOW,
  IDENTITY_A,
  PROFILE_A,
  view,
} from "./support/identityTestHarness";
import type { LegalSnapshot } from "../legalSnapshot";

const SESSION: GateSession = {
  accountScopeId: IDENTITY_A.accountScopeId,
  email: IDENTITY_A.email,
  profileId: PROFILE_A,
  displayName: "Athlete",
  entitlement: "free",
};

const LEGAL: LegalSnapshot = { terms: null, privacy: null, fetchedAt: FIXED_NOW };

/** Three operations in page-lifetime ORDER. `OLDER` really is older than
 * `CURRENT`, which is older than `NEWER`, so a test asserting "the stale one is
 * refused" is asserting about order and not about a name. */
const OLDER: TransitionIdentity = { id: "older", sequence: 1, mode: "foreground" };
const CURRENT: TransitionIdentity = { id: "current", sequence: 2, mode: "foreground" };
const NEWER: TransitionIdentity = { id: "newer", sequence: 3, mode: "foreground" };

const ALL_PHASES: GateProgressPhase[] = [
  "intaking_oauth_return",
  "restoring_identity",
  "consuming_oauth_return",
  "finalizing_identity",
  "ensuring_profile",
  "resolving_gate_facts",
  "establishing_trusted_state",
  "establishing_identity_barrier",
  "preparing_google_flow",
  "persisting_google_attempt",
  "navigating_to_provider",
  "requesting_otp",
  "verifying_otp",
  "refreshing_legal_snapshot",
  "submitting_onboarding",
  "signing_out",
  "identity_denied_in_memory",
];

const ALL_AUTH_CHANGES: NormalizedAuthChange[] = [
  { reason: "initial_session", identity: null },
  { reason: "initial_session", identity: IDENTITY_A },
  { reason: "signed_in", identity: IDENTITY_A },
  { reason: "token_refreshed", identity: IDENTITY_A },
  { reason: "user_updated", identity: IDENTITY_A },
  { reason: "signed_out" },
  { reason: "other", identity: null },
  { reason: "other", identity: IDENTITY_A },
];

const LOCK_STATES: GateState[] = [
  { kind: "quarantined_locked", origin: "interactive_authentication", callbackNotice: "none" },
  { kind: "locked", origin: "explicit_sign_out", callbackNotice: "none" },
  { kind: "storage_unavailable_locked" },
];

const READY_ONLINE: GateState = { kind: "ready_online", session: SESSION };
const READY_OFFLINE: GateState = { kind: "ready_offline", session: SESSION };

function progress(phase: GateProgressPhase): GateEvent {
  return { type: "progress", phase };
}

function settled(outcome: IdentityTransitionOutcome): GateEvent {
  return { type: "transition_settled", outcome };
}

describe("initial state and purity", () => {
  it("starts in the Phase 0 intake state — honestly naming what has not run yet", () => {
    expect(initialGateState()).toEqual({ kind: "intaking_oauth_return" });
    expect(isGateReady(initialGateState())).toBe(false);
  });

  it("never mutates the state it is given", () => {
    const state: GateState = { kind: "resolving_gate_facts" };
    const frozen = Object.freeze({ ...state });
    expect(() =>
      reduceGateState(frozen, { type: "startup_completed", callback: { kind: "no_return" }, verdict: { kind: "ready_online", session: SESSION } })
    ).not.toThrow();
    expect(frozen).toEqual({ kind: "resolving_gate_facts" });
  });

  it("is deterministic for the same state and event", () => {
    const state: GateState = { kind: "requesting_otp" };
    const event = settled({ kind: "otp_requested" });
    expect(reduceGateState(state, event)).toEqual(reduceGateState(state, event));
  });
});

describe("no provider auth change can open the application", () => {
  it("every normalized reason, from every state, is a no-op", () => {
    const states: GateState[] = [
      initialGateState(),
      { kind: "restoring_identity" },
      { kind: "signed_out", legal: LEGAL, callbackNotice: "none" },
      { kind: "awaiting_otp" },
      { kind: "verifying_otp" },
      { kind: "establishing_trusted_state" },
      ...LOCK_STATES,
      READY_ONLINE,
    ];
    for (const state of states) {
      for (const change of ALL_AUTH_CHANGES) {
        const next = reduceGateState(state, { type: "provider_auth_change", change });
        expect(next, `${state.kind} + ${change.reason}`).toBe(state);
      }
    }
  });

  it("`signed_in` specifically cannot produce a ready state from any non-ready state", () => {
    for (const state of [
      { kind: "verifying_otp" } as GateState,
      { kind: "consuming_oauth_return" } as GateState,
      ...LOCK_STATES,
    ]) {
      const next = reduceGateState(state, {
        type: "provider_auth_change",
        change: { reason: "signed_in", identity: IDENTITY_A },
      });
      expect(isGateReady(next)).toBe(false);
    }
  });
});

describe("a ready verdict requires a readiness progression", () => {
  const readyVerdicts: GateVerdict[] = [
    { kind: "ready_online", session: SESSION },
    { kind: "ready_offline", session: SESSION },
  ];

  const accepting: GateState["kind"][] = [
    "restoring_identity",
    "ensuring_profile",
    "resolving_gate_facts",
    "establishing_trusted_state",
    "ready_online",
    "ready_offline",
  ];

  it("is accepted from a progression state entered by the SAME operation, and from an existing ready state", () => {
    for (const kind of accepting) {
      const alreadyReady = kind === "ready_online" || kind === "ready_offline";
      const state = (kind === "ready_online"
        ? READY_ONLINE
        : kind === "ready_offline"
          ? READY_OFFLINE
          : ({ kind, transition: CURRENT, acceptedSequence: CURRENT.sequence } as GateState));
      for (const verdict of readyVerdicts) {
        const next = reduceGateState(state, {
          type: "startup_completed",
          callback: { kind: "no_return" },
          verdict,
          // An already-ready state confirms without an operation of its own (a
          // background revalidation); a progression state requires its own.
          transition: alreadyReady ? undefined : CURRENT,
        });
        expect(isGateReady(next), `${kind} -> ${verdict.kind}`).toBe(true);
      }
    }
  });

  it("is a NO-OP from every lock, from every pre-authentication state, and mid-callback", () => {
    const refusing: GateState[] = [
      ...LOCK_STATES,
      { kind: "intaking_oauth_return" },
      { kind: "consuming_oauth_return" },
      { kind: "finalizing_identity" },
      { kind: "signed_out", legal: LEGAL, callbackNotice: "none" },
      { kind: "awaiting_otp" },
      { kind: "requesting_otp" },
      { kind: "verifying_otp" },
      { kind: "onboarding_required", legal: LEGAL },
      { kind: "submitting_onboarding" },
      { kind: "identity_unconfirmed" },
      { kind: "legal_unavailable" },
      { kind: "cloud_unavailable" },
      { kind: "recoverable_error", reason: "trusted_state_not_established" },
    ];
    for (const state of refusing) {
      for (const verdict of readyVerdicts) {
        const next = reduceGateState(state, {
          type: "startup_completed",
          callback: { kind: "no_return" },
          verdict,
        });
        expect(next, `${state.kind} -> ${verdict.kind}`).toBe(state);
      }
    }
  });

  it("a progression state accepts ready ONLY from the operation that entered it", () => {
    // ADR-0025 §A's optimistic entry: an exact Google return or OTP verification
    // that finds an already-valid same-scope trusted record goes straight from
    // `finalizing_identity` to ready, with nothing to establish. That operation's
    // own result may open the gate; a result carrying a DIFFERENT correlation
    // identity — an older operation finishing late — may not, and neither may one
    // carrying none at all.
    const progression: GateState["kind"][] = [
      "restoring_identity",
      "ensuring_profile",
      "resolving_gate_facts",
      "establishing_trusted_state",
      "consuming_oauth_return",
      "finalizing_identity",
      "verifying_otp",
      "submitting_onboarding",
    ];
    const readyVerdict: GateVerdict = { kind: "ready_online", session: SESSION };
    for (const kind of progression) {
      const state = reduceGateState(initialGateState(), {
        type: "progress",
        phase: kind as GateProgressPhase,
        transition: CURRENT,
      });
      expect(state.kind, kind).toBe(kind);

      const matching = reduceGateState(state, {
        type: "startup_completed",
        callback: { kind: "succeeded", identity: IDENTITY_A },
        verdict: readyVerdict,
        transition: CURRENT,
      });
      expect(isGateReady(matching), `${kind} / matching id`).toBe(true);

      const stale = reduceGateState(state, {
        type: "startup_completed",
        callback: { kind: "succeeded", identity: IDENTITY_A },
        verdict: readyVerdict,
        transition: OLDER,
      });
      expect(stale, `${kind} / stale id`).toBe(state);

      const anonymous = reduceGateState(state, {
        type: "startup_completed",
        callback: { kind: "no_return" },
        verdict: readyVerdict,
      });
      expect(anonymous, `${kind} / no id`).toBe(state);
    }
  });

  it("state kind alone is never correlation proof", () => {
    // The same kind, entered by a NEWER operation, must reject the older one's
    // late result.
    const newer = reduceGateState(initialGateState(), {
      type: "progress",
      phase: "finalizing_identity",
      transition: NEWER,
    });
    const lateOlderResult = reduceGateState(newer, {
      type: "transition_settled",
      outcome: {
        kind: "resolved",
        identity: IDENTITY_A,
        gate: { kind: "ready_online", session: SESSION },
        transition: OLDER,
      },
    });
    expect(isGateReady(lateOlderResult)).toBe(false);
    expect(lateOlderResult).toBe(newer);
  });

  it("a `resolved` transition outcome carrying a ready gate obeys the same rule", () => {
    const outcome: IdentityTransitionOutcome = {
      kind: "resolved",
      identity: IDENTITY_A,
      gate: { kind: "ready_online", session: SESSION },
      transition: CURRENT,
    };
    expect(
      isGateReady(
        reduceGateState(
          { kind: "establishing_trusted_state", transition: CURRENT, acceptedSequence: CURRENT.sequence },
          settled(outcome)
        )
      )
    ).toBe(true);
    for (const state of LOCK_STATES) {
      expect(reduceGateState(state, settled(outcome))).toBe(state);
    }
  });
});

describe("a lock is never lifted by a non-lock verdict", () => {
  const nonLockVerdicts: GateVerdict[] = [
    { kind: "signed_out", legal: LEGAL },
    { kind: "onboarding_required", legal: LEGAL },
    { kind: "onboarding_blocked_legal", legal: LEGAL },
    { kind: "legal_unavailable" },
    { kind: "identity_unconfirmed" },
    { kind: "trusted_state_not_established" },
    { kind: "cloud_unavailable" },
  ];

  it("every lock state ignores every non-lock verdict", () => {
    for (const state of LOCK_STATES) {
      for (const verdict of nonLockVerdicts) {
        expect(
          reduceGateState(state, {
            type: "startup_completed",
            callback: { kind: "no_return" },
            verdict,
          }),
          `${state.kind} -> ${verdict.kind}`
        ).toBe(state);
      }
    }
  });

  it("a lock verdict IS accepted, so one lock can replace another", () => {
    const next = reduceGateState(LOCK_STATES[0], {
      type: "startup_completed",
      callback: { kind: "no_return" },
      verdict: { kind: "storage_unavailable_locked" },
    });
    expect(view(next)).toEqual({ kind: "storage_unavailable_locked" });
  });

  it("a failed recovery attempt leaves the person on the locked screen, not on a generic error", () => {
    for (const state of LOCK_STATES) {
      const next = reduceGateState(state, settled({ kind: "barrier_not_established" }));
      expect(next).toBe(state);
    }
  });
});

describe("progress phases", () => {
  it("every phase maps to a non-ready state", () => {
    for (const phase of ALL_PHASES) {
      const next = reduceGateState({ kind: "restoring_identity" }, progress(phase));
      expect(isGateReady(next), phase).toBe(false);
    }
  });

  it("the DELIBERATE transition phases are the only ones observable from a lock", () => {
    const deliberate: GateProgressPhase[] = [
      "establishing_identity_barrier",
      "preparing_google_flow",
      "persisting_google_attempt",
      "navigating_to_provider",
      "requesting_otp",
      "verifying_otp",
      "signing_out",
    ];
    for (const state of LOCK_STATES) {
      for (const phase of ALL_PHASES) {
        const next = reduceGateState(state, progress(phase));
        if (phase === "identity_denied_in_memory") {
          expect(next.kind, phase).toBe("locked");
        } else if (deliberate.includes(phase)) {
          expect(next, `${state.kind} + ${phase}`).not.toBe(state);
        } else {
          expect(next, `${state.kind} + ${phase}`).toBe(state);
        }
      }
    }
  });

  it("`identity_denied_in_memory` denies from EVERY state, including a ready one", () => {
    for (const state of [READY_ONLINE, READY_OFFLINE, initialGateState(), ...LOCK_STATES]) {
      const next = reduceGateState(state, progress("identity_denied_in_memory"));
      expect(isGateReady(next)).toBe(false);
      expect(view(next)).toEqual({
        kind: "locked",
        origin: "server_identity_invalidated",
        callbackNotice: "none",
      });
    }
  });
});

describe("cross-tab denial", () => {
  it("`newer_barrier_observed` locks from EVERY state, including ready", () => {
    for (const state of [READY_ONLINE, READY_OFFLINE, { kind: "awaiting_otp" } as GateState, ...LOCK_STATES]) {
      const next = reduceGateState(state, { type: "newer_barrier_observed" });
      expect(view(next)).toEqual({ kind: "locked", origin: null, callbackNotice: "none" });
    }
  });
});

describe("transition outcomes", () => {
  it("`otp_requested` moves only from `requesting_otp`", () => {
    expect(view(reduceGateState({ kind: "requesting_otp" }, settled({ kind: "otp_requested" })))).toEqual({
      kind: "awaiting_otp",
    });
    const unrelated: GateState = { kind: "signed_out", legal: LEGAL, callbackNotice: "none" };
    expect(reduceGateState(unrelated, settled({ kind: "otp_requested" }))).toBe(unrelated);
  });

  it("`navigating` changes nothing — the page is leaving", () => {
    const state: GateState = { kind: "navigating_to_provider" };
    expect(reduceGateState(state, settled({ kind: "navigating" }))).toBe(state);
  });

  it("`trusted_state_refresh_skipped` is NON-FATAL and leaves a ready session untouched", () => {
    expect(reduceGateState(READY_ONLINE, settled({ kind: "trusted_state_refresh_skipped" }))).toBe(
      READY_ONLINE
    );
    expect(isGateReady(reduceGateState(READY_ONLINE, settled({ kind: "trusted_state_refresh_skipped" })))).toBe(
      true
    );
  });

  it("`replayed_callback` renders nothing special", () => {
    const state: GateState = { kind: "restoring_identity" };
    expect(reduceGateState(state, settled({ kind: "replayed_callback" }))).toBe(state);
  });

  it("`trusted_state_not_established` produces a recoverable error, never a ready state", () => {
    const next = reduceGateState(
      { kind: "establishing_trusted_state" },
      settled({ kind: "trusted_state_not_established" })
    );
    expect(view(next)).toEqual({ kind: "recoverable_error", reason: "trusted_state_not_established" });
    expect(isGateReady(next)).toBe(false);
  });

  it("`signed_out_locked`, `identity_invalidated` and `trusted_state_not_invalidated` all lock", () => {
    expect(view(reduceGateState(READY_ONLINE, settled({ kind: "signed_out_locked" })))).toEqual({
      kind: "locked",
      origin: "explicit_sign_out",
      callbackNotice: "none",
    });
    for (const kind of ["identity_invalidated", "trusted_state_not_invalidated"] as const) {
      expect(reduceGateState(READY_ONLINE, settled({ kind }))).toEqual({
        kind: "locked",
        origin: "server_identity_invalidated",
        callbackNotice: "none",
      });
    }
  });

  it("`durable_denial_unavailable` renders the storage-unavailable lock and claims no revocation", () => {
    expect(view(reduceGateState(READY_ONLINE, settled({ kind: "durable_denial_unavailable" })))).toEqual({
      kind: "storage_unavailable_locked",
    });
  });

  it("every start/finalization failure produces a recoverable error naming its own reason", () => {
    const failures: IdentityTransitionOutcome["kind"][] = [
      "barrier_not_established",
      "attempt_not_persisted",
      "intent_state_not_persisted",
      "preparation_failed",
      "superseded",
      "navigation_failed",
      "barrier_resolution_failed",
      "correlation_changed",
      "unowned_callback",
      "ambiguous_callback",
      "malformed_callback",
      "exchange_failed",
      "provider_error",
      "temporarily_unavailable",
      "invalid_input",
    ];
    for (const kind of failures) {
      const next = reduceGateState({ kind: "restoring_identity" }, settled({ kind } as IdentityTransitionOutcome));
      expect(view(next), kind).toEqual({ kind: "recoverable_error", reason: kind });
      expect(isGateReady(next)).toBe(false);
    }
  });
});

describe("the neutral callback notice", () => {
  it("marks an unusable link for the four callback failures plus the exchange failures", () => {
    for (const callback of [
      { kind: "unowned_callback" },
      { kind: "ambiguous_callback" },
      { kind: "malformed_callback" },
      { kind: "correlation_changed" },
      { kind: "exchange_failed" },
      { kind: "provider_error" },
    ] as const) {
      const next = reduceGateState({ kind: "intaking_oauth_return" }, {
        type: "startup_completed",
        callback,
        verdict: { kind: "quarantined_locked", origin: "interactive_authentication" },
      });
      expect(view(next), callback.kind).toEqual({
        kind: "quarantined_locked",
        origin: "interactive_authentication",
        callbackNotice: "unusable_link",
      });
    }
  });

  it("shows nothing special for no_return, a replay, or a success", () => {
    for (const callback of [
      { kind: "no_return" },
      { kind: "replayed_callback" },
      { kind: "succeeded", identity: IDENTITY_A },
    ] as const) {
      const next = reduceGateState({ kind: "intaking_oauth_return" }, {
        type: "startup_completed",
        callback,
        verdict: { kind: "quarantined_locked", origin: "interactive_authentication" },
      });
      expect(view(next), callback.kind).toEqual({
        kind: "quarantined_locked",
        origin: "interactive_authentication",
        callbackNotice: "none",
      });
    }
  });
});

describe("onboarding and legal events", () => {
  it("a rotation returns to onboarding with the NEW snapshot, forcing re-acceptance", () => {
    const rotated: LegalSnapshot = { ...LEGAL, fetchedAt: "2026-04-01T00:00:00.000Z" };
    expect(
      reduceGateState({ kind: "submitting_onboarding" }, {
        type: "onboarding_settled",
        outcome: { kind: "stale_legal_version", legal: rotated },
      })
    ).toEqual({ kind: "onboarding_required", legal: rotated });
  });

  it("maps every other onboarding outcome without ever opening the app", () => {
    const outcomes = [
      { kind: "legal_unavailable" as const, expected: { kind: "legal_unavailable" } },
      {
        kind: "trusted_state_not_established" as const,
        expected: { kind: "recoverable_error", reason: "trusted_state_not_established" },
      },
      {
        kind: "temporarily_unavailable" as const,
        expected: { kind: "recoverable_error", reason: "temporarily_unavailable" },
      },
      { kind: "invalid_input" as const, expected: { kind: "recoverable_error", reason: "invalid_input" } },
      {
        kind: "submission_failed" as const,
        expected: { kind: "recoverable_error", reason: "provider_error" },
      },
    ];
    for (const { kind, expected } of outcomes) {
      const next = reduceGateState({ kind: "submitting_onboarding" }, {
        type: "onboarding_settled",
        outcome: { kind },
      });
      expect(view(next), kind).toEqual(expected);
      expect(isGateReady(next)).toBe(false);
    }
  });

  it("a successful completion goes ready from its own finishing states, and nowhere else", () => {
    // `completed` is emitted only after the server completion succeeded AND the
    // required trusted record was durably written for the same account, so it is
    // this transition's own correlated result.
    const outcome = {
      kind: "completed" as const,
      gate: { kind: "ready_online" as const, session: SESSION },
      transition: CURRENT,
    };
    for (const kind of ["establishing_trusted_state", "submitting_onboarding"] as const) {
      expect(
        isGateReady(
          reduceGateState(
            { kind, transition: CURRENT, acceptedSequence: CURRENT.sequence },
            { type: "onboarding_settled", outcome }
          )
        ),
        kind
      ).toBe(true);
    }

    // But not from a lock, and not from a state where no onboarding was running.
    for (const state of [...LOCK_STATES, { kind: "awaiting_otp" } as GateState, { kind: "signed_out", legal: LEGAL, callbackNotice: "none" } as GateState]) {
      const next = reduceGateState(state, { type: "onboarding_settled", outcome });
      expect(isGateReady(next), state.kind).toBe(false);
    }
  });

  it("a legal refresh either re-displays onboarding or reports the documents unavailable", () => {
    expect(
      reduceGateState({ kind: "refreshing_legal_snapshot" }, {
        type: "legal_refreshed",
        outcome: { kind: "refreshed", legal: LEGAL },
      })
    ).toEqual({ kind: "onboarding_required", legal: LEGAL });
    expect(
      reduceGateState({ kind: "refreshing_legal_snapshot" }, {
        type: "legal_refreshed",
        outcome: { kind: "legal_unavailable" },
      })
    ).toEqual({ kind: "legal_unavailable" });
  });
});

describe("cloud availability", () => {
  it("`cloud_unavailable` applies from every state", () => {
    for (const state of [READY_ONLINE, initialGateState(), ...LOCK_STATES]) {
      expect(view(reduceGateState(state, { type: "cloud_unavailable" }))).toEqual({
        kind: "cloud_unavailable",
      });
    }
  });
});
