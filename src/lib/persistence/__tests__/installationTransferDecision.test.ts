import { describe, expect, it } from "vitest";
import { decideInstallationTransfer } from "../installationTransferDecision";
const readiness = {schemaVersion:1,kind:"readiness",package:"valid",source:"frozen",target:"clean",request:"rollback",proof:"unavailable",semantic:"unavailable",receipt:"none"};
const atomic = {schemaVersion:1,kind:"atomic",boundary:"batch",mode:"warm",call:"settled_unknown",owner:"current",observation:"rows_without_cursor",confirmedEvidenceLost:false,reopen:"fresh_confirmed"};
const decision = (kind:string, held:boolean) => ({ok:true,value:{kind,mayIssue:false,mayPublish:false,mayMount:false,ownerMustRemain:held}});
describe("inactive S2 refusal model", () => {
  it("refuses clean rollback readiness without inventing authority", () => { expect(decideInstallationTransfer(JSON.stringify(readiness))).toEqual(decision("readiness_unavailable",false)); });
  it("faults exact batch rows without cursor, never catches up", () => { expect(decideInstallationTransfer(JSON.stringify(atomic))).toEqual(decision("fault_held",true)); });
  it("calls the real decision for every readiness enum tuple, including all rollback remainders", () => {
    const tally: Record<string,number> = {}; const seen = new Set<string>();
    for (const pkg of ["valid","invalid"]) for (const source of ["frozen","stale","unavailable"]) for (const target of ["clean","same_transfer","conflict","post_publication_mutated","has_new_work"]) for (const request of ["publish","access","rollback","inspect"]) for (const proof of ["unavailable","imported_trusted","q2_forbidden"]) for (const semantic of ["unavailable","unusable","candidate"]) for (const receipt of ["none","shared_only","external_verified"]) {
      const input = {...readiness,package:pkg,source,target,request,proof,semantic,receipt}; const json = JSON.stringify(input); seen.add(json);
      let kind = "readiness_unavailable";
      if (pkg === "invalid") kind = "invalid_input";
      else if (target === "conflict") kind = "target_conflict";
      else if (target === "has_new_work" && request === "rollback") kind = "preserve_both_no_rollback";
      else if (target === "post_publication_mutated" && request === "inspect") kind = "historical_receipt_only";
      else { const byProof:Record<string,string> = {q2_forbidden:"blocked_q2",imported_trusted:"no_portable_identity_grant",unavailable:target === "has_new_work" ? "target_conflict" : "readiness_unavailable"}; kind = source === "stale" ? "stale_snapshot" : byProof[proof]; }
      expect(decideInstallationTransfer(json),json).toEqual(kind === "invalid_input" ? {ok:false,code:kind} : decision(kind,false)); tally[kind] = (tally[kind] ?? 0)+1;
    }
    expect(seen.size).toBe(3240);
    expect(tally).toEqual({invalid_input:1620,target_conflict:378,preserve_both_no_rollback:81,historical_receipt_only:81,stale_snapshot:378,blocked_q2:252,no_portable_identity_grant:252,readiness_unavailable:198});
  });
  it("covers the complete atomic enum matrix across all four transaction boundaries", () => {
    for (const boundary of ["intent","batch","verify","publish"]) for (const mode of ["warm","cold"]) for (const call of ["not_issued","own_uncommitted","pending","settled_unknown","confirmed"]) for (const owner of ["current","stale"]) for (const observation of ["unobserved","unreadable","exact_before","exact_after","mixed","rows_without_cursor","cursor_without_rows","foreign"]) for (const confirmedEvidenceLost of [false,true]) for (const reopen of ["not_required","unconfirmed","fresh_confirmed"]) {
      const input = {...atomic,boundary,mode,call,owner,observation,confirmedEvidenceLost,reopen};
      const observed:Record<string,string> = {unobserved:"evidence_required",unreadable:"evidence_required",mixed:"fault_held",rows_without_cursor:"fault_held",cursor_without_rows:"fault_held",foreign:"target_conflict",exact_before:"not_issued",exact_after:"completed_candidate"};
      let kind = observed[observation];
      if (observation.startsWith("exact_")) {
        if (call === "settled_unknown") kind = reopen === "fresh_confirmed" ? (observation === "exact_before" ? "guarded_retry_candidate":"completed_candidate") : "evidence_required";
        else if (call === "own_uncommitted") kind = observation === "exact_before" ? "rollback_own_uncommitted_only":"invalid_input";
        else if (observation === "exact_before") kind = mode === "cold" ? "guarded_retry_candidate" : call === "confirmed" ? "fault_held":"not_issued";
      }
      if (owner === "stale") kind = "blocked_stale_owner";
      if (confirmedEvidenceLost) kind = "fault_held";
      if (call === "pending") kind = "waiting";
      if (mode === "cold" && (call !== "not_issued" || confirmedEvidenceLost)) kind = "invalid_input";
      expect(decideInstallationTransfer(JSON.stringify(input)),JSON.stringify(input)).toEqual(kind === "invalid_input" ? {ok:false,code:kind}:decision(kind,true));
    }
  });
  it.each(["package","source","target","request","proof","semantic","receipt"])("rejects missing, wrong typed and invented readiness %s", field => {
    for (const value of [null,true,4,{},[],"live_success"]) expect(decideInstallationTransfer(JSON.stringify({...readiness,[field]:value}))).toEqual({ok:false,code:"invalid_input"});
    const missing:Record<string,unknown>={...readiness}; delete missing[field]; expect(decideInstallationTransfer(JSON.stringify(missing))).toEqual({ok:false,code:"invalid_input"});
  });
  it("never inspects hostile data objects or admits extra consent/clock/cleanup fields", () => {
    let touched=0; const hostile = new Proxy({}, {get(){touched++;throw 0;},ownKeys(){touched++;throw 0;},getPrototypeOf(){touched++;throw 0;}});
    for (const input of [hostile,new String("{}"),null,undefined,1,()=>0,Symbol()]) expect(decideInstallationTransfer(input)).toEqual({ok:false,code:"invalid_input"});
    expect(touched).toBe(0);
    for (const field of ["consent","timeout","release","grant","repair"]) expect(decideInstallationTransfer(JSON.stringify({...readiness,[field]:true}))).toEqual({ok:false,code:"invalid_input"});
    expect(decideInstallationTransfer(JSON.stringify(readiness).padEnd(65536," "))).toEqual(decision("readiness_unavailable",false));
    expect(decideInstallationTransfer(JSON.stringify(readiness).padEnd(65537," "))).toEqual({ok:false,code:"limit_exceeded"});
    for (const input of ['{"schemaVersion":1,"schemaVersion":1}','{"schemaVersion":-0}','[]','null','{"x":1e3}','{"x":true,}']) expect(decideInstallationTransfer(input)).toEqual({ok:false,code:"invalid_input"});
  });
});
