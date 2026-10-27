import { describe, expect, it } from "vitest";
import { reduceCredentialFault, type CredentialFaultOutput } from "../credentialFaultPolicy";
import { unwrap } from "../../supabase/providerCredentialContract";
const id = "00000001-1111-4111-8111-111111111111";
const state = { tuple: { profileId: id, identityGeneration: 7, workId: id, context: "training" }, sporting: "healthy", credentialPause: false, denied: false, completed: false };
const failure = { kind: "credential_failure", operation: "remove", outcome: "unknown", previousValueMayBeLost: false };
const denyReasons = ["explicit_signout", "definitive_provider_denial", "unresolved_barrier", "pairing_mismatch", "profile_mismatch"];
const sdkEvents = ["INITIAL_SESSION_NULL", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED", "SIGNED_OUT_AMBIGUOUS"];
const apply = (input: unknown, event: unknown) => unwrap(reduceCredentialFault(input, event));
function sequence(events: unknown[]): CredentialFaultOutput {
  let result = apply(state, { kind: "network_only_failure" });
  for (const event of events) result = apply(result.state, event);
  return result;
}
describe("admitted same-training credential policy", () => {
  it("continues only existing healthy training and never claims a save", () => {
    expect(reduceCredentialFault(state, failure)).toMatchObject({ ok: true, value: { decision: "continue_same_training_local", localContinuation: true, cloudPaused: true, newSignInPaused: true, warning: true, newWorkAllowed: false, profileSwitchAllowed: false, savedLocallyClaim: false } });
  });
  it.each(["read", "write", "remove"])("treats every %s failure outcome as pause, never settled success", operation => {
    for (const outcome of ["not_issued", "failed", "unknown"]) {
      const result = apply(state, { ...failure, operation, outcome, previousValueMayBeLost: operation === "write" });
      expect(result.decision).toBe("continue_same_training_local"); expect(result.localContinuation).toBe(true);
      expect(result.state.denied).toBe(false); expect(result.state.tuple).toEqual(state.tuple);
      expect(result.savedLocallyClaim).toBe(false); expect(Object.isFrozen(result.state.tuple)).toBe(true);
      expect(result.state.tuple === state.tuple).toBe(false);
    }
  });
  it.each(denyReasons)("denial %s outranks failure in both arrival orders, no SDK healing", reason => {
    for (const events of [[failure, { kind: "deny", reason }], [{ kind: "deny", reason }, failure]]) {
      const result = sequence(events); expect(result.decision).toBe("existing_deny_path"); expect(result.localContinuation).toBe(false); expect(result.warning).toBe(false);
      for (const event of sdkEvents) expect(apply(result.state, { kind: "sdk_event", event })).toMatchObject({ decision: "existing_deny_path", localContinuation: false, cloudPaused: true, newSignInPaused: true });
    }
  });
  it.each(sdkEvents)("SDK %s never clears pause, deny, failure or completion", event => {
    expect(sequence([failure, { kind: "sdk_event", event }])).toMatchObject({ decision: "pause_unchanged", localContinuation: true, cloudPaused: true, warning: true });
    for (const terminal of [{ kind: "deny", reason: "pairing_mismatch" }, { kind: "sporting_save_failed" }, { kind: "training_completed_saved" }]) {
      const before = sequence([failure, terminal]); const after = apply(before.state, { kind: "sdk_event", event });
      expect(after.state).toEqual(before.state); expect(after.decision).toBe(before.decision); expect(after.localContinuation).toBe(false);
    }
    expect(apply(state, { kind: "sdk_event", event })).toMatchObject({ decision: "no_fault_policy_change", localContinuation: false });
  });
  it("prioritizes deny > sporting > completion > credential across every terminal order", () => {
    const events = [{ kind: "deny", reason: "explicit_signout" }, { kind: "sporting_save_failed" }, { kind: "training_completed_saved" }, failure];
    function permutations(input: unknown[]): unknown[][] { return input.length === 0 ? [[]] : input.flatMap((event, i) => permutations(input.filter((_, j) => j !== i)).map(tail => [event, ...tail])); }
    for (const order of permutations(events)) {
      const result = sequence(order); expect(result.decision).toBe("existing_deny_path"); expect(result.state).toEqual({ tuple: null, sporting: "failed", credentialPause: true, denied: true, completed: true });
      expect(result.localContinuation).toBe(false);
    }
    for (const order of [[{ kind: "sporting_save_failed" }, { kind: "training_completed_saved" }], [{ kind: "training_completed_saved" }, { kind: "sporting_save_failed" }]]) expect(sequence(order).decision).toBe("sporting_save_failure");
  });
  it("completion ends the exception, never creates a successor or a save claim", () => {
    const complete = sequence([failure, { kind: "training_completed_saved" }]);
    expect(complete).toMatchObject({ decision: "exception_ended", state: { tuple: null, completed: true }, localContinuation: false, cloudPaused: true, warning: true, newWorkAllowed: false, savedLocallyClaim: false });
    expect(apply(complete.state, failure).decision).toBe("exception_ended");
    expect(apply({ ...state, tuple: null }, { kind: "training_completed_saved" }).state.tuple).toBeNull();
    expect(apply(state, { kind: "training_completed_saved" }).cloudPaused).toBe(false);
  });
  it.each(["startup_check", "attempt_new_work", "attempt_profile_switch"])("never grants admission for %s", kind => {
    const result = sequence([failure, { kind }]); expect(result.localContinuation).toBe(false);
    expect(result.decision).toBe(kind === "startup_check" ? "startup_blocked" : "not_authorized");
    expect(result.newWorkAllowed).toBe(false); expect(result.profileSwitchAllowed).toBe(false);
    if (kind === "startup_check") expect(apply(state, { kind })).toMatchObject({ decision: "no_fault_policy_change", localContinuation: false });
  });
  it.each(["assessment", "team", "home"])("does not authorize other context %s", context => {
    expect(sequence([failure, { kind: "other_context", context }])).toMatchObject({ decision: "policy_not_authorized", localContinuation: false });
  });
  it("network-only creates no credential failure and no tuple means no continuation", () => {
    expect(apply(state, { kind: "network_only_failure" })).toMatchObject({ decision: "existing_offline_policy", cloudPaused: false, localContinuation: false, warning: false });
    expect(apply({ ...state, tuple: null }, failure)).toMatchObject({ decision: "no_admitted_training", localContinuation: false, warning: true });
    expect(sequence([failure, { kind: "sporting_save_failed" }])).toMatchObject({ decision: "sporting_save_failure", localContinuation: false, savedLocallyClaim: false, warning: true });
  });
  it("checks every admitted flag combination against independent priority predicates", () => {
    const events = [failure, { kind: "deny", reason: "explicit_signout" }, { kind: "sporting_save_failed" }, { kind: "training_completed_saved" }, { kind: "sdk_event", event: "SIGNED_IN" }, { kind: "network_only_failure" }, { kind: "startup_check" }, { kind: "attempt_new_work" }, { kind: "attempt_profile_switch" }, { kind: "other_context", context: "team" }];
    for (const hasTuple of [false, true]) for (const sporting of ["healthy", "failed"]) for (const credentialPause of [false, true]) for (const denied of [false, true]) for (const completed of [false, true]) {
      if (completed && hasTuple) continue;
      const input = { tuple: hasTuple ? state.tuple : null, sporting, credentialPause, denied, completed };
      for (const event of events) {
        const result = apply(input, event), next = result.state;
        expect(result.localContinuation).toBe(next.tuple !== null && next.sporting === "healthy" && next.credentialPause && !next.denied && !next.completed && !["startup_check", "attempt_new_work", "attempt_profile_switch", "other_context"].includes(event.kind));
        expect(result.cloudPaused).toBe(next.credentialPause || next.denied); expect(result.newSignInPaused).toBe(result.cloudPaused); expect(result.warning).toBe(next.credentialPause && !next.denied);
        if (next.denied) expect(result.decision).toBe("existing_deny_path"); else if (next.sporting === "failed") expect(result.decision).toBe("sporting_save_failure"); else if (next.completed) expect(result.decision).toBe("exception_ended");
        expect(result.newWorkAllowed || result.profileSwitchAllowed || result.savedLocallyClaim).toBe(false);
        expect(input).toEqual({ tuple: hasTuple ? state.tuple : null, sporting, credentialPause, denied, completed });
      }
    }
  });
  it.each([null, true, [], {}, { ...failure, operation: "refresh" }, { ...failure, outcome: "pending" }, { ...failure, operation: "read", previousValueMayBeLost: true }, { ...failure, extra: true }, { kind: "deny", reason: "unknown" }, { kind: "sdk_event", event: "SIGNED_OUT" }, { kind: "other_context", context: "training" }, { kind: "startup_check", grant: true }])("rejects invalid event %j with fixed refusal", event => {
    expect(reduceCredentialFault(state, event)).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } });
  });
  it("refuses malformed state, tuple generation/context, mixed completion and hostile getters", () => {
    const invalidStates = [null, [], {}, { ...state, extra: true }, { ...state, completed: true }, { ...state, denied: "false" }, ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity].map(identityGeneration => ({ ...state, tuple: { ...state.tuple, identityGeneration } })), { ...state, tuple: { ...state.tuple, context: "team" } }, { ...state, tuple: { ...state.tuple, profileId: "FOREIGN" } }];
    for (const invalid of invalidStates) expect(reduceCredentialFault(invalid, failure)).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } });
    let calls = 0; const event = Object.defineProperty({}, "kind", { get() { calls++; throw "PRIVATE"; } });
    expect(reduceCredentialFault(state, event)).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } }); expect(calls).toBe(0);
    expect(apply({ ...state, tuple: { ...state.tuple, identityGeneration: Number.MAX_SAFE_INTEGER } }, failure).localContinuation).toBe(true);
  });
});
