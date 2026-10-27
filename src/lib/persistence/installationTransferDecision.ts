// Inactive pure S2 model: never an executor or access authority.
import { exact, fail, failure, freezeTree, parseTransferJson, record, TRANSFER_LIMITS, workBudget, type JsonObject, type TransferResult } from "./installationTransferInventory";
export type DecisionKind = "not_issued" | "rollback_own_uncommitted_only" | "waiting" | "evidence_required" | "guarded_retry_candidate" | "completed_candidate" | "fault_held" | "target_conflict" | "blocked_stale_owner" | "readiness_unavailable" | "blocked_q2" | "no_portable_identity_grant" | "stale_snapshot" | "historical_receipt_only" | "preserve_both_no_rollback";
export type Decision = { readonly kind: DecisionKind; readonly mayIssue: false; readonly mayPublish: false; readonly mayMount: false; readonly ownerMustRemain: boolean };
const readinessEnums = {
  package:["invalid","valid"], source:["frozen","stale","unavailable"], target:["clean","same_transfer","conflict","post_publication_mutated","has_new_work"], request:["publish","access","rollback","inspect"], proof:["unavailable","imported_trusted","q2_forbidden"], semantic:["unavailable","unusable","candidate"], receipt:["none","shared_only","external_verified"],
};
const atomicEnums = {
  boundary:["intent","batch","verify","publish"], mode:["warm","cold"], call:["not_issued","own_uncommitted","pending","settled_unknown","confirmed"], owner:["current","stale"], observation:["unobserved","unreadable","exact_before","exact_after","mixed","rows_without_cursor","cursor_without_rows","foreign"], reopen:["not_required","unconfirmed","fresh_confirmed"],
};
function admitted(obj: JsonObject, enums: Record<string, readonly string[]>): void {
  for (const [key, values] of Object.entries(enums)) if (typeof obj[key] !== "string" || !values.includes(obj[key] as string)) fail("invalid_input");
}
function result(kind: DecisionKind, held: boolean): TransferResult<Decision> { return {ok:true,value:freezeTree({kind,mayIssue:false,mayPublish:false,mayMount:false,ownerMustRemain:held})}; }
export function decideInstallationTransfer(decisionJson: unknown): TransferResult<Decision> {
  try {
    const obj = record(parseTransferJson(decisionJson,workBudget(),TRANSFER_LIMITS.decision),"invalid_input");
    if (obj.schemaVersion !== 1) fail("invalid_input");
    if (obj.kind === "readiness") {
      exact(obj,["schemaVersion","kind",...Object.keys(readinessEnums)],"invalid_input"); admitted(obj,readinessEnums);
      if (obj.package === "invalid") fail("invalid_input");
      if (obj.target === "conflict") return result("target_conflict",false);
      if (obj.request === "rollback" && obj.target === "has_new_work") return result("preserve_both_no_rollback",false);
      if (obj.target === "post_publication_mutated" && obj.request === "inspect") return result("historical_receipt_only",false);
      if (obj.source === "stale") return result("stale_snapshot",false);
      if (obj.proof === "q2_forbidden") return result("blocked_q2",false);
      if (obj.proof === "imported_trusted") return result("no_portable_identity_grant",false);
      if (obj.target === "has_new_work") return result("target_conflict",false);
      return result("readiness_unavailable",false);
    }
    if (obj.kind !== "atomic") fail("invalid_input");
    exact(obj,["schemaVersion","kind",...Object.keys(atomicEnums),"confirmedEvidenceLost"],"invalid_input"); admitted(obj,atomicEnums);
    if (typeof obj.confirmedEvidenceLost !== "boolean") fail("invalid_input");
    if (obj.mode === "cold" && (obj.call !== "not_issued" || obj.confirmedEvidenceLost)) fail("invalid_input");
    if (obj.call === "pending") return result("waiting",true);
    if (obj.confirmedEvidenceLost) return result("fault_held",true);
    if (obj.owner === "stale") return result("blocked_stale_owner",true);
    if (["mixed","rows_without_cursor","cursor_without_rows"].includes(obj.observation as string)) return result("fault_held",true);
    if (obj.observation === "foreign") return result("target_conflict",true);
    if (obj.observation === "unobserved" || obj.observation === "unreadable") return result("evidence_required",true);
    if (obj.call === "settled_unknown" && obj.reopen !== "fresh_confirmed") return result("evidence_required",true);
    if (obj.call === "own_uncommitted") { if (obj.observation !== "exact_before") fail("invalid_input"); return result("rollback_own_uncommitted_only",true); }
    if (obj.observation === "exact_after") return result("completed_candidate",true);
    if (obj.call === "confirmed") return result("fault_held",true);
    return result(obj.mode === "cold" || obj.call === "settled_unknown" ? "guarded_retry_candidate" : "not_issued",true);
  } catch (reason) { const issue = failure(reason,"invalid_input"); return {ok:false,code:issue.code === "limit_exceeded" ? issue.code : "invalid_input"}; }
}
