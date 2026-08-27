// Phase 0 — one test per exhaustive branch A-G (ADR-0025 §4).
//
// `decideOAuthIntake` is pure and has no dependency capable of exchanging,
// writing or removing anything, so "branches C, D, E, F and G perform zero
// exchanges, create no resolution, and leave a newer valid attempt intact" is a
// property of the code rather than an assertion about it. The effectful side is
// covered in identityTransitionCoordinator.startup.test.ts.
import { describe, expect, it } from "vitest";
import { decideOAuthIntake, type DurableCorrelationSnapshot } from "../oauthReturnIntake";
import { createIdentityAccessBarrier, type IdentityAccessBarrier } from "../identityBarrier";
import {
  createIdentityBarrierResolution,
  type IdentityBarrierResolution,
} from "../identityBarrierResolution";
import {
  createEmailOtpAttempt,
  createGoogleAttempt,
  type InteractiveAuthAttempt,
} from "../interactiveAttempt";
import {
  recordAbsent,
  recordMalformed,
  recordReadFailed,
  recordValue,
  type IdentityRecordLoad,
} from "../errors";
import type { CallbackCandidate } from "../../supabase/supabaseCallbackCapture";
import {
  ATTEMPT_A,
  ATTEMPT_B,
  BARRIER_A,
  BARRIER_C,
  FIXED_NOW,
  FLOW_X,
  FLOW_Y,
} from "./support/identityTestHarness";

const barrier = createIdentityAccessBarrier({
  barrierId: BARRIER_A,
  origin: "interactive_authentication",
  barredAccountScopeId: null,
  barredGeneration: null,
  establishedAt: FIXED_NOW,
});

const googleAttempt = createGoogleAttempt({
  attemptId: ATTEMPT_A,
  flowId: FLOW_X,
  barrierId: BARRIER_A,
  capturedIdentityGeneration: 7,
  startedAt: FIXED_NOW,
});

const exactResolution = createIdentityBarrierResolution({
  barrierId: BARRIER_A,
  attemptId: ATTEMPT_A,
  method: "google",
  flowId: FLOW_X,
  identityGeneration: 7,
  authenticatedAccountScopeId: "account-a",
  resolvedAt: FIXED_NOW,
});

const successCandidate: CallbackCandidate = { kind: "success_candidate", flowId: FLOW_X };
const errorCandidate: CallbackCandidate = { kind: "provider_error_candidate", flowId: FLOW_X };

/** The state a genuine Google callback necessarily arrives in: a valid unresolved
 * barrier, a matching attempt, and NO resolution yet. */
function inProgress(overrides: Partial<DurableCorrelationSnapshot> = {}): DurableCorrelationSnapshot {
  return {
    barrier: recordValue(barrier),
    attempt: recordValue(googleAttempt),
    resolution: recordAbsent(),
    ...overrides,
  };
}

describe("branch A — no callback candidate", () => {
  it("resolves no_return regardless of the durable state", () => {
    for (const durable of [
      inProgress(),
      { barrier: recordAbsent(), attempt: recordAbsent(), resolution: null } as DurableCorrelationSnapshot,
      { ...inProgress(), resolution: recordValue(exactResolution) },
    ]) {
      expect(decideOAuthIntake({ kind: "no_return" }, durable)).toEqual({
        kind: "no_return",
        branch: "A",
      });
    }
  });
});

describe("branch B — an admissible in-progress continuation", () => {
  it("admits a success candidate whose selector matches the persisted attempt", () => {
    const decision = decideOAuthIntake(successCandidate, inProgress());
    expect(decision.kind).toBe("admit_continuation");
    if (decision.kind !== "admit_continuation") return;
    expect(decision.branch).toBe("B");
    expect(decision.barrier.barrierId).toBe(BARRIER_A);
    expect(decision.attempt.attemptId).toBe(ATTEMPT_A);
    expect(decision.expectedFlowId).toBe(FLOW_X);
  });

  it("a MISSING resolution is expected here and must not quarantine", () => {
    // This is the state a real Google return necessarily arrives in. A protocol
    // that treated it as disqualifying would deadlock the very flow that creates
    // the resolution.
    const decision = decideOAuthIntake(successCandidate, inProgress({ resolution: recordAbsent() }));
    expect(decision.kind).toBe("admit_continuation");
  });
});

describe("branch C — a correlated provider error", () => {
  it("resolves provider_error with the barrier left unresolved", () => {
    expect(decideOAuthIntake(errorCandidate, inProgress())).toEqual({
      kind: "provider_error",
      branch: "C",
    });
  });

  it("carries only the closed kind — no raw provider text can travel", () => {
    const decision = decideOAuthIntake(errorCandidate, inProgress());
    expect(Object.keys(decision).sort()).toEqual(["branch", "kind"]);
  });
});

describe("branch D — a candidate that does not match the current barrier or attempt", () => {
  it("rejects a stale selector: callback X cannot exchange against attempt Y", () => {
    const newerAttempt = createGoogleAttempt({
      attemptId: ATTEMPT_B,
      flowId: FLOW_Y,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 8,
      startedAt: FIXED_NOW,
    });
    const decision = decideOAuthIntake(
      { kind: "success_candidate", flowId: FLOW_X },
      inProgress({ attempt: recordValue(newerAttempt) })
    );
    expect(decision).toEqual({ kind: "unowned_callback", branch: "D" });
  });

  it("rejects an attempt bound to a superseded barrier", () => {
    const oldAttempt = createGoogleAttempt({
      attemptId: ATTEMPT_A,
      flowId: FLOW_X,
      barrierId: BARRIER_C,
      capturedIdentityGeneration: 7,
      startedAt: FIXED_NOW,
    });
    expect(
      decideOAuthIntake(successCandidate, inProgress({ attempt: recordValue(oldAttempt) }))
    ).toEqual({ kind: "unowned_callback", branch: "D" });
  });

  it("rejects an email-OTP attempt, which has no callback at all", () => {
    const otpAttempt = createEmailOtpAttempt({
      attemptId: ATTEMPT_A,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 7,
      startedAt: FIXED_NOW,
    });
    expect(
      decideOAuthIntake(successCandidate, inProgress({ attempt: recordValue(otpAttempt) }))
    ).toEqual({ kind: "unowned_callback", branch: "D" });
  });

  it("rejects a present-but-not-exactly-correlated resolution", () => {
    const mismatched = { ...exactResolution, attemptId: ATTEMPT_B };
    expect(
      decideOAuthIntake(successCandidate, inProgress({ resolution: recordValue(mismatched) }))
    ).toEqual({ kind: "unowned_callback", branch: "D" });
  });

  it("rejects a malformed or unreadable resolution", () => {
    const unusable: Array<IdentityRecordLoad<IdentityBarrierResolution>> = [
      recordMalformed<IdentityBarrierResolution>(),
      recordReadFailed<IdentityBarrierResolution>("unknown"),
    ];
    for (const resolution of unusable) {
      expect(decideOAuthIntake(successCandidate, inProgress({ resolution }))).toEqual({
        kind: "unowned_callback",
        branch: "D",
      });
    }
  });

  it("rejects a resolution that exists while the attempt does not", () => {
    // Exactness cannot be established without the attempt, so this is not a
    // replay — and Phase A will quarantine it.
    expect(
      decideOAuthIntake(
        successCandidate,
        inProgress({ attempt: recordAbsent(), resolution: recordValue(exactResolution) })
      )
    ).toEqual({ kind: "unowned_callback", branch: "D" });
  });
});

describe("branch E — the current barrier already has an exact resolution", () => {
  it("treats the arrival as a replay, for a success candidate and for an error candidate", () => {
    const resolved = inProgress({ resolution: recordValue(exactResolution) });
    expect(decideOAuthIntake(successCandidate, resolved)).toEqual({
      kind: "replayed_callback",
      branch: "E",
    });
    expect(decideOAuthIntake(errorCandidate, resolved)).toEqual({
      kind: "replayed_callback",
      branch: "E",
    });
  });

  it("returns nothing that could invalidate the existing resolved set", () => {
    const decision = decideOAuthIntake(successCandidate, inProgress({
      resolution: recordValue(exactResolution),
    }));
    // Purity is the guarantee: there is no dependency here able to remove or
    // overwrite the resolution, and the decision carries no instruction to.
    expect(Object.keys(decision).sort()).toEqual(["branch", "kind"]);
  });
});

describe("branch F — ambiguous, malformed, or an implicit-grant fragment", () => {
  it("is decided from the candidate SHAPE alone, before any durable state is consulted", () => {
    // ADR-0025 §4: such a return "must not become an authentication source" even
    // when another valid state exists.
    for (const durable of [
      inProgress(),
      { ...inProgress(), resolution: recordValue(exactResolution) },
      { barrier: recordAbsent(), attempt: recordAbsent(), resolution: null } as DurableCorrelationSnapshot,
    ]) {
      expect(decideOAuthIntake({ kind: "ambiguous_callback" }, durable)).toEqual({
        kind: "ambiguous_callback",
        branch: "F",
      });
      expect(decideOAuthIntake({ kind: "malformed_callback" }, durable)).toEqual({
        kind: "malformed_callback",
        branch: "F",
      });
    }
  });
});

describe("branch G — a candidate with no barrier, or no usable attempt", () => {
  it("resolves unowned_callback when no barrier exists", () => {
    expect(
      decideOAuthIntake(successCandidate, {
        barrier: recordAbsent(),
        attempt: recordValue(googleAttempt),
        resolution: null,
      })
    ).toEqual({ kind: "unowned_callback", branch: "G" });
  });

  it("resolves unowned_callback for a malformed or unreadable barrier", () => {
    const unusableBarriers: Array<IdentityRecordLoad<IdentityAccessBarrier>> = [
      recordMalformed<IdentityAccessBarrier>(),
      recordReadFailed<IdentityAccessBarrier>("storage_unavailable"),
    ];
    for (const barrierLoad of unusableBarriers) {
      expect(
        decideOAuthIntake(successCandidate, {
          barrier: barrierLoad,
          attempt: recordValue(googleAttempt),
          resolution: null,
        })
      ).toEqual({ kind: "unowned_callback", branch: "G" });
    }
  });

  it("resolves unowned_callback when no usable attempt exists under a clean unresolved barrier", () => {
    const unusableAttempts: Array<IdentityRecordLoad<InteractiveAuthAttempt>> = [
      recordAbsent<InteractiveAuthAttempt>(),
      recordMalformed<InteractiveAuthAttempt>(),
      recordReadFailed<InteractiveAuthAttempt>("unknown"),
    ];
    for (const attempt of unusableAttempts) {
      expect(decideOAuthIntake(successCandidate, inProgress({ attempt }))).toEqual({
        kind: "unowned_callback",
        branch: "G",
      });
    }
  });

  it("resolves unowned_callback when the resolution could not even be addressed", () => {
    // `resolution: null` means "there was no valid barrier to derive a key from",
    // which is a different statement from "the resolution is absent".
    expect(
      decideOAuthIntake(successCandidate, { ...inProgress(), resolution: null })
    ).toEqual({ kind: "unowned_callback", branch: "D" });
  });
});

describe("exhaustiveness and mutual exclusivity", () => {
  it("every branch letter A-G is reachable", () => {
    const reached = new Set<string>();
    reached.add(decideOAuthIntake({ kind: "no_return" }, inProgress()).branch);
    reached.add(decideOAuthIntake(successCandidate, inProgress()).branch);
    reached.add(decideOAuthIntake(errorCandidate, inProgress()).branch);
    reached.add(
      decideOAuthIntake({ kind: "success_candidate", flowId: FLOW_Y }, inProgress()).branch
    );
    reached.add(
      decideOAuthIntake(successCandidate, inProgress({ resolution: recordValue(exactResolution) }))
        .branch
    );
    reached.add(decideOAuthIntake({ kind: "ambiguous_callback" }, inProgress()).branch);
    reached.add(
      decideOAuthIntake(successCandidate, {
        barrier: recordAbsent(),
        attempt: recordAbsent(),
        resolution: null,
      }).branch
    );
    expect([...reached].sort()).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
  });
});
