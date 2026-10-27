// Inactive Q1/A reducer for a PREEXISTING same-Profile training admission.
// No admission creation, SDK health latch, persistence, clock or recovery event.
import { isCanonicalUuid } from "../uuid";
import { contractResult, deepFreeze, exactFields, record, refuse, snapshotJson, type DataRecord, type Result } from "../supabase/providerCredentialContract";
export type TrainingTuple = { profileId: string; identityGeneration: number; workId: string; context: "training" };
export type CredentialFaultState = { tuple: TrainingTuple | null; sporting: "healthy" | "failed"; credentialPause: boolean; denied: boolean; completed: boolean };
export type FaultDecision = "existing_deny_path" | "sporting_save_failure" | "exception_ended" | "startup_blocked" | "policy_not_authorized" | "not_authorized" | "continue_same_training_local" | "pause_unchanged" | "existing_offline_policy" | "no_admitted_training" | "no_fault_policy_change";
export type CredentialFaultOutput = { state: CredentialFaultState; decision: FaultDecision; localContinuation: boolean; cloudPaused: boolean; newSignInPaused: boolean; warning: boolean; newWorkAllowed: false; profileSwitchAllowed: false; savedLocallyClaim: false };
const PAYLOADS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  credential_failure: ["operation", "outcome", "previousValueMayBeLost"], deny: ["reason"], sporting_save_failed: [], training_completed_saved: [], sdk_event: ["event"], network_only_failure: [], attempt_new_work: [], attempt_profile_switch: [], startup_check: [], other_context: ["context"],
});
function oneOf(obj: DataRecord, field: string, choices: readonly string[]): void { if (typeof obj[field] !== "string" || !choices.includes(obj[field] as string)) refuse("invalid_input"); }
export function reduceCredentialFault(stateInput: unknown, eventInput: unknown): Result<CredentialFaultOutput> {
  const result = contractResult(() => {
    const ownedState = snapshotJson(stateInput), ownedEvent = snapshotJson(eventInput);
    const state = record(ownedState), event = record(ownedEvent);
    exactFields(state, ["tuple", "sporting", "credentialPause", "denied", "completed"]);
    oneOf(state, "sporting", ["healthy", "failed"]);
    for (const flag of ["credentialPause", "denied", "completed"]) if (typeof state[flag] !== "boolean") refuse("invalid_input");
    if (state.tuple !== null) {
      const tuple = record(state.tuple); exactFields(tuple, ["profileId", "identityGeneration", "workId", "context"]);
      if (!isCanonicalUuid(tuple.profileId) || !isCanonicalUuid(tuple.workId) || tuple.context !== "training" || typeof tuple.identityGeneration !== "number" || !Number.isSafeInteger(tuple.identityGeneration) || tuple.identityGeneration < 0 || state.completed) refuse("invalid_input");
    }
    if (typeof event.kind !== "string" || !Object.hasOwn(PAYLOADS, event.kind)) refuse("invalid_input");
    const kind = event.kind;
    exactFields(event, ["kind", ...PAYLOADS[kind]]);
    if (kind === "credential_failure") {
      oneOf(event, "operation", ["read", "write", "remove"]); oneOf(event, "outcome", ["not_issued", "failed", "unknown"]);
      if (typeof event.previousValueMayBeLost !== "boolean" || (event.previousValueMayBeLost && event.operation !== "write")) refuse("invalid_input");
    } else if (kind === "deny") oneOf(event, "reason", ["explicit_signout", "definitive_provider_denial", "unresolved_barrier", "pairing_mismatch", "profile_mismatch"]);
    else if (kind === "sdk_event") oneOf(event, "event", ["INITIAL_SESSION_NULL", "SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED", "SIGNED_OUT_AMBIGUOUS"]);
    else if (kind === "other_context") oneOf(event, "context", ["assessment", "team", "home"]);
    const next: CredentialFaultState = {
      tuple: state.tuple as TrainingTuple | null,
      sporting: kind === "sporting_save_failed" ? "failed" : state.sporting as "healthy" | "failed",
      credentialPause: state.credentialPause === true || kind === "credential_failure",
      denied: state.denied === true || kind === "deny",
      completed: state.completed === true || kind === "training_completed_saved",
    };
    if (kind === "training_completed_saved") next.tuple = null;
    const restricted = kind === "startup_check" || kind === "other_context" || kind === "attempt_new_work" || kind === "attempt_profile_switch";
    const continuation = next.tuple !== null && next.sporting === "healthy" && next.credentialPause && !next.denied && !next.completed && !restricted;
    let decision: FaultDecision;
    if (next.denied) decision = "existing_deny_path";
    else if (next.sporting === "failed") decision = "sporting_save_failure";
    else if (next.completed) decision = "exception_ended";
    else if (kind === "startup_check") decision = next.credentialPause ? "startup_blocked" : "no_fault_policy_change";
    else if (kind === "other_context") decision = "policy_not_authorized";
    else if (kind === "attempt_new_work" || kind === "attempt_profile_switch") decision = "not_authorized";
    else if (kind === "credential_failure") decision = next.tuple !== null ? "continue_same_training_local" : "no_admitted_training";
    else if (next.credentialPause) decision = "pause_unchanged";
    else if (kind === "network_only_failure") decision = "existing_offline_policy";
    else decision = "no_fault_policy_change";
    return deepFreeze({ state: next, decision, localContinuation: continuation, cloudPaused: next.credentialPause || next.denied, newSignInPaused: next.credentialPause || next.denied, warning: next.credentialPause && !next.denied, newWorkAllowed: false as const, profileSwitchAllowed: false as const, savedLocallyClaim: false as const });
  });
  // Invalid state/event has one fixed refusal, never an accidental policy branch.
  return result.ok ? result : { ok: false, issue: { code: "invalid_input", field: "input" } };
}
