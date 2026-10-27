// Stage M3b4c — the pure presentation model (docs/MOBILE_APP_MIGRATION.md Stage
// M3b0 §6). These tests exercise classification over typed report shapes; the
// session and view tests drive the same model through the REAL runner.
//
// Each labelled `ucase` test is traced in
// `nativeMigrationRecoveryCoverage.test.ts`.
import { describe, expect, it } from "vitest";
import type { DecisionFinding } from "../nativeMigrationDecision";
import type { NativeMigrationRunReport } from "../nativeMigrationRunner";
import {
  buildMigrationDiagnosticReport,
  classifyFindings,
  presentRunReport,
  type MigrationPresentation,
} from "../nativeMigrationPresentation";

const ucase = (id: string, title: string, fn: () => void) => it(`${id} — ${title}`, fn);

const f = (rule: string, code: string, detail?: string[]): DecisionFinding =>
  ({ rule, code, ...(detail ? { detail } : {}) }) as DecisionFinding;

function blocked(findings: DecisionFinding[], extra: Record<string, unknown> = {}): NativeMigrationRunReport {
  return { outcome: "blocked", rule: findings[0]?.rule ?? "E′12", findings, retryMayResolve: true, completedPlans: [], ...extra } as NativeMigrationRunReport;
}

function present(report: NativeMigrationRunReport): Extract<MigrationPresentation, { kind: "blocking" }> {
  const presentation = presentRunReport(report);
  if (!presentation || presentation.kind !== "blocking") throw new Error(JSON.stringify(presentation));
  return presentation;
}

const PROFILE = "11111111-1111-4111-8111-111111111111";
const KEY_WITH_PROFILE = `curling.sporting.profile.v1.${PROFILE}.curling-release-tracker-current-session`;

describe("blocked findings — every family, every group (§6.8)", () => {
  const CASES: Array<[string, DecisionFinding, "G2" | "G3" | "G4", string]> = [
    ["L0a latch read failed", f("L0a", "latch_read_failed"), "G2", "read_unavailable"],
    ["L0b latch present", f("L0b", "latch_present"), "G3", "latch_present"],
    ["A1 record unreadable", f("A1", "record_read_failed"), "G2", "read_unavailable"],
    ["A2 malformed record", f("A2", "record_unparseable"), "G3", "record_inconsistent"],
    ["A3 newer version", f("A3", "record_schema_newer"), "G4", "version_newer"],
    ["A4 older version", f("A4", "record_schema_older"), "G4", "version_older"],
    ["A5 manifest absent", f("A5", "manifest_absent"), "G3", "record_inconsistent"],
    ["A6 copied not subset", f("A6", "copied_not_subset_of_manifest"), "G3", "record_inconsistent"],
    ["A′1 identifier", f("A′1", "identifier_not_canonical"), "G3", "record_inconsistent"],
    ["A′7 mixed lists", f("A′7", "active_lists_inconsistent"), "G3", "record_inconsistent"],
    ["B1 target failing", f("B1", "target_failing"), "G2", "active_target_unavailable"],
    ["B1 row read failed on active", f("B1", "target_row_value_read_failed"), "G2", "active_target_unavailable"],
    ["C1 source enumeration", f("C1", "source_enumeration_failed"), "G2", "read_unavailable"],
    ["C1 unsupported owned denial control", f("C1", "unsupported_identity_control"), "G3", "source_diverged"],
    ["PV1 target listing", f("PV1", "target_rows_read_failed"), "G2", "read_unavailable"],
    ["PV2 rows without record", f("PV2", "target_rows_without_record"), "G3", "rows_without_record"],
    ["PV3 marker read failed", f("PV3", "marker_read_failed"), "G2", "read_unavailable"],
    ["PV4 marker malformed", f("PV4", "marker_malformed"), "G3", "marker_invalid"],
    ["PV5 marker without record", f("PV5", "marker_without_record"), "G3", "marker_without_record"],
    ["PV8 store identity", f("PV8", "store_identity_invalid"), "G3", "record_inconsistent"],
    ["PV9 target listing", f("PV9", "target_rows_read_failed"), "G2", "read_unavailable"],
    ["PV10 marker read failed", f("PV10", "marker_read_failed"), "G2", "read_unavailable"],
    ["PV11 marker malformed", f("PV11", "marker_malformed"), "G3", "marker_invalid"],
    ["PV12 foreign marker", f("PV12", "marker_foreign"), "G3", "marker_foreign"],
    ["E′1 rows while enumerating", f("E′1", "rows_while_enumerating"), "G3", "staging_inconsistent"],
    ["E′2 copied without row", f("E′2", "copied_without_row"), "G3", "staging_inconsistent"],
    ["E′2 row without progress", f("E′2", "row_without_progress"), "G3", "staging_inconsistent"],
    ["E′3 row outside manifest", f("E′3", "row_outside_manifest"), "G3", "staging_inconsistent"],
    ["E′4 staged mismatch", f("E′4", "row_fingerprint_mismatch"), "G3", "staging_inconsistent"],
    ["E′5 entry key vanished", f("E′5", "entry_key_vanished"), "G3", "entry_key_vanished"],
    ["E′7 key missing", f("E′7", "source_key_missing"), "G3", "source_diverged"],
    ["E′7 key new", f("E′7", "source_key_new"), "G3", "source_diverged"],
    ["E′8 content diverged", f("E′8", "source_content_diverged"), "G3", "source_diverged"],
    ["E′12 unspecified", f("E′12", "unspecified_state"), "G4", "internal_check"],
    ["I-1 row fingerprint unavailable", f("I-1", "row_fingerprint_unavailable"), "G2", "read_unavailable"],
    ["I-1 warm row unreadable", f("I-1", "warm_row_bytes_unreadable"), "G2", "warm_check_unreadable"],
    ["I-7 malformed digest output", f("I-7", "row_fingerprint_malformed"), "G4", "internal_check"],
    ["I-13 warm matches neither", f("I-11", "warm_state_matches_neither"), "G3", "fault_detected"],
  ];
  for (const [title, finding, group, explanation] of CASES) {
    ucase("§6.8:blocked", title, () => {
      const p = present(blocked([finding]));
      expect(p.group).toBe(group);
      expect(p.explanation).toBe(explanation);
      expect(p.recheck).toBe(group === "G2");
    });
  }

  ucase("U2-15", "an unknown code or rule is G4 internal check, never a contradiction", () => {
    expect(present(blocked([f("E′7", "made_up_code")]))).toMatchObject({ group: "G4", explanation: "internal_check", recheck: false });
    expect(present(blocked([f("Z9", "latch_present")]))).toMatchObject({ group: "G4", recheck: false });
    expect(present(blocked([]))).toMatchObject({ group: "G4", recheck: false });
  });
});

describe("mixed findings — all considered, deterministic precedence G3 > G4 > G2 (§6.2)", () => {
  function permutations<T>(items: T[]): T[][] {
    if (items.length <= 1) return [items];
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
  }

  ucase("U2-1", "a contradiction never disappears behind an earlier read failure, in every order", () => {
    for (const order of permutations([f("C1", "source_enumeration_failed"), f("PV9", "target_rows_read_failed"), f("E′7", "source_key_missing")])) {
      expect(present(blocked(order))).toMatchObject({ group: "G3", explanation: "source_diverged", recheck: false });
    }
  });

  ucase("U2-15", "an unsupported version never acquires a recheck because another finding is transient", () => {
    for (const order of permutations([f("A3", "record_schema_newer"), f("L0a", "latch_read_failed")])) {
      expect(present(blocked(order))).toMatchObject({ group: "G4", explanation: "version_newer", recheck: false });
    }
    for (const order of permutations([f("A4", "record_schema_older"), f("C1", "source_enumeration_failed"), f("PV10", "marker_read_failed")])) {
      expect(present(blocked(order))).toMatchObject({ group: "G4", explanation: "version_older", recheck: false });
    }
  });

  ucase("U2-1", "a contradiction beats an internal-check failure; the strongest G3 explanation is chosen", () => {
    for (const order of permutations([f("E′12", "unspecified_state"), f("PV12", "marker_foreign"), f("L0b", "latch_present")])) {
      expect(classifyFindings(order)).toEqual({ group: "G3", explanation: "latch_present" });
    }
  });

  ucase("U2-1", "only all-transient findings are G2, and retryMayResolve is never consulted", () => {
    const p = present(blocked([f("A3", "record_schema_newer")], { retryMayResolve: true }));
    expect(p.recheck).toBe(false);
    const q = present(blocked([f("C1", "source_enumeration_failed"), f("PV10", "marker_read_failed")], { retryMayResolve: false }));
    expect(q).toMatchObject({ group: "G2", recheck: true });
  });
});

describe("halted plans — the group follows the observed cause, not the word 'halted'", () => {
  function halted(halt: unknown, extra: Record<string, unknown> = {}): NativeMigrationRunReport {
    return { outcome: "halted", plan: "AP-COPY", rule: "E′9", halt, transaction: null, marker: null, completedPlans: [], ...extra } as NativeMigrationRunReport;
  }
  const run = (cause: string, observed?: string, dispositions = ["confirmed", "failed", "not_issued"]) => ({
    kind: "plan_run",
    report: { status: "halted", haltedAtStep: 1, cause, dispositions, completedSteps: [0], confirmedWriteSteps: [0], unknownStep: null, notIssuedSteps: [2], possiblyChangedStores: ["source"], ordinaryContinuationPermitted: false, continuation: "re_evaluate" },
    ...(observed ? { observed } : {}),
  });

  ucase("U2-2", "an unknown write outcome is G2 with the halt wording and its step dispositions", () => {
    const p = present(halted(run("write_outcome_unknown", undefined, ["confirmed", "outcome_unknown", "not_issued"]), { transaction: { step: 1, status: "outcome_unknown" } }));
    expect(p).toMatchObject({ group: "G2", explanation: "halt_unknown_outcome", recheck: true });
    expect(p.steps).toEqual([
      { step: 1, disposition: "confirmed" },
      { step: 2, disposition: "outcome_unknown" },
      { step: 3, disposition: "not_issued" },
    ]);
    expect(p.codes).toContain("transaction:outcome_unknown");
  });

  ucase("§6.8:halt", "missing entry key (positive) versus failed enumeration (unavailable)", () => {
    expect(present(halted(run("recheck_failed", "entry_key_missing")))).toMatchObject({ group: "G3", explanation: "halt_contradiction", recheck: false });
    expect(present(halted(run("recheck_failed", "recheck_enumeration_failed")))).toMatchObject({ group: "G2", explanation: "halt_step_not_completed", recheck: true });
  });

  ucase("§6.8:halt", "digest unavailable versus positive mismatch versus malformed digest", () => {
    expect(present(halted(run("read_failed", "digest_unavailable")))).toMatchObject({ group: "G2" });
    expect(present(halted(run("recheck_failed", "batch_digest_mismatch")))).toMatchObject({ group: "G3" });
    expect(present(halted(run("read_failed", "digest_malformed")))).toMatchObject({ group: "G4", recheck: false });
    expect(present(halted(run("read_failed", "source_value_unreadable")))).toMatchObject({ group: "G2" });
    expect(present(halted(run("read_failed", "listed_value_absent")))).toMatchObject({ group: "G2" });
    expect(present(halted(run("read_failed", "planned_value_absent")))).toMatchObject({ group: "G3" });
    expect(present(halted(run("recheck_failed", "source_validation_diverged")))).toMatchObject({ group: "G3" });
    expect(present(halted(run("recheck_failed", "unsupported_identity_control")))).toMatchObject({ group: "G3", explanation: "halt_contradiction", recheck: false });
    expect(present(halted(run("recheck_failed", "source_validation_unavailable")))).toMatchObject({ group: "G2" });
  });

  ucase("§6.8:halt", "AP-CC/AP-ACT unreadable evidence versus mismatched evidence", () => {
    const abort = (reason: string, observed?: string) =>
      present(halted(run("aborted_before_write", observed, ["confirmed", "aborted_before_write"]), {
        plan: "AP-CC",
        transaction: { step: 1, status: "not_committed", reason, writeIssued: false, connection: "clean" },
      }));
    expect(abort("evidence_unreadable")).toMatchObject({ group: "G2", explanation: "halt_step_not_completed" });
    expect(abort("evidence_mismatch", "target_evidence_unavailable")).toMatchObject({ group: "G2" });
    expect(abort("evidence_mismatch", "target_evidence_mismatch")).toMatchObject({ group: "G3", explanation: "halt_contradiction" });
    expect(abort("evidence_mismatch", "digest_malformed")).toMatchObject({ group: "G4" });
    expect(abort("evidence_mismatch")).toMatchObject({ group: "G4" });
    expect(abort("precondition_failed")).toMatchObject({ group: "G2" });
  });

  ucase("§6.8:halt", "foreign/malformed marker refusal versus unreadable marker refusal", () => {
    const refused = (reason: string) =>
      present(halted({ kind: "not_issued", step: 0, cause: "precondition_failed", dispositions: ["not_issued", "not_issued"] }, { marker: { step: 0, status: "refused", reason } }));
    expect(refused("marker_present")).toMatchObject({ group: "G3", explanation: "halt_contradiction", recheck: false });
    expect(refused("marker_unreadable")).toMatchObject({ group: "G2", recheck: true });
  });

  ucase("U2-2", "a step never issued is not reported as an unknown write", () => {
    const p = present(halted({ kind: "not_issued", step: 1, cause: "preparation_failed", dispositions: ["confirmed", "not_issued"] }));
    expect(p).toMatchObject({ group: "G2", explanation: "halt_step_not_completed" });
    expect(p.steps.map((s) => s.disposition)).toEqual(["confirmed", "not_issued"]);
    expect(p.codes).toContain("not_issued:preparation_failed");
    expect(p.codes.join(" ")).not.toContain("outcome_unknown");
  });

  ucase("U2-4", "external holder versus the owner's requires_reopen versus internal refusals", () => {
    const refusal = (reason: string) =>
      present(halted({ kind: "not_issued", step: 0, cause: "target_unavailable", dispositions: ["not_issued"] }, { transaction: { step: 0, status: "refused", reason } }));
    expect(refusal("lease_held")).toMatchObject({ group: "G2", explanation: "storage_busy_elsewhere" });
    expect(refusal("connection_held_elsewhere")).toMatchObject({ group: "G2", explanation: "storage_busy_elsewhere" });
    expect(refusal("diagnostic_transaction_pending")).toMatchObject({ group: "G2", explanation: "storage_busy_elsewhere" });
    expect(refusal("requires_reopen")).toMatchObject({ group: "G2", explanation: "reopen_required" });
    for (const reason of ["no_lease", "wrong_lease", "invalid_transaction"]) {
      expect(refusal(reason)).toMatchObject({ group: "G4", explanation: "internal_check", recheck: false });
    }
  });

  ucase("U2-15", "an unrecognised halt shape is G4", () => {
    expect(present(halted({ kind: "plan_run", report: { status: "invalid", problem: "x" } }))).toMatchObject({ group: "G4" });
    expect(present(halted(run("read_failed")))).toMatchObject({ group: "G4" });
    expect(present(halted(null))).toMatchObject({ group: "G4" });
  });
});

describe("other outcome families", () => {
  const base = { completedPlans: [] };
  ucase("U2-15", "every listed internal-check outcome and refusal is G4 without a recheck", () => {
    const reports = [
      { outcome: "evidence_required", missing: ["targetRows"] },
      { outcome: "invalid_evidence", problems: ["record_snapshot_malformed"] },
      { outcome: "target_refused", reason: "no_lease" },
      { outcome: "target_refused", reason: "wrong_lease" },
      { outcome: "target_refused", reason: "invalid_transaction" },
      { outcome: "something_new" },
    ];
    for (const report of reports) {
      expect(present({ ...base, ...report } as unknown as NativeMigrationRunReport), JSON.stringify(report)).toMatchObject({ group: "G4", recheck: false });
    }
  });

  ucase("U2-3", "a settled bound is G2 and never ready", () => {
    expect(present({ ...base, outcome: "bound_reached" } as NativeMigrationRunReport)).toMatchObject({ group: "G2", explanation: "bound_reached", recheck: true });
  });

  ucase("U2-4", "reopen failure and external refusal are G2; the owner's requires_reopen is distinct", () => {
    for (const boundary of ["refused", "close", "release", "open"]) {
      expect(present({ ...base, outcome: "reopen_failed", boundary } as NativeMigrationRunReport)).toMatchObject({ group: "G2", explanation: "reopen_failed" });
    }
    expect(present({ ...base, outcome: "target_refused", reason: "lease_held" } as NativeMigrationRunReport).explanation).toBe("storage_busy_elsewhere");
    expect(present({ ...base, outcome: "target_refused", reason: "requires_reopen" } as NativeMigrationRunReport).explanation).toBe("reopen_required");
  });

  ucase("§6.8:fault", "a detected fault is G3 whatever its findings, with the latch state as a code", () => {
    const p = present({ ...base, outcome: "fault", findings: [f("C1", "source_enumeration_failed")], latch: { attempts: [], established: null, attemptsRemain: true } } as unknown as NativeMigrationRunReport);
    expect(p).toMatchObject({ group: "G3", explanation: "fault_detected", recheck: false });
    expect(p.codes).toContain("latch:not_established");
  });

  ucase("U2-6", "a disposed report is never presented", () => {
    expect(presentRunReport({ ...base, outcome: "disposed" } as NativeMigrationRunReport)).toBeNull();
  });

  ucase("U2-17", "B4 access carries an already-known retirement finding as a nonblocking note, with counts only", () => {
    const p = presentRunReport({ ...base, outcome: "access", rule: "B4", recordPhase: "active", retirement: { rule: "B3", state: "resume", deletable: [], retainChanged: [KEY_WITH_PROFILE], unverifiable: [] } } as NativeMigrationRunReport);
    expect(p).toEqual({ kind: "access", phase: "active", retirement: { kind: "declined_deletion", retained: 1, unverifiable: 0 } });
    expect(JSON.stringify(p)).not.toContain(PROFILE);
    const stalled = presentRunReport({ ...base, outcome: "access", rule: "B4", retirement: { rule: "B2", state: "stalled", reason: "source_missing" } } as NativeMigrationRunReport);
    expect(stalled).toMatchObject({ kind: "access", retirement: { kind: "stalled" } });
    const none = presentRunReport({ ...base, outcome: "access", rule: "B4", retirement: { state: "not_evaluated", reason: "source_not_observed" } } as NativeMigrationRunReport);
    expect(none).toMatchObject({ kind: "access", retirement: null });
  });

  ucase("U2-15", "a throwing or hostile report is G4, never a crash", () => {
    const hostile = new Proxy({}, { get() { throw new Error(`${KEY_WITH_PROFILE} secret`); } });
    const p = present(hostile as NativeMigrationRunReport);
    expect(p).toMatchObject({ group: "G4", explanation: "internal_check", codes: ["unexpected_failure"] });
  });
});

describe("restricted diagnostic report (§6.6)", () => {
  const SENTINELS = [PROFILE, KEY_WITH_PROFILE, "SYNTHETIC_CREDENTIAL_SENTINEL", "sb-synthetic-auth-token", "{\"schemaVersion\"", "fp:", "bridge exploded"];

  ucase("U2-9", "codes never carry a finding's detail, key names, values or problem strings", () => {
    const p = present(blocked([
      f("E′7", "source_key_missing", [KEY_WITH_PROFILE]),
      { rule: "E′8", code: "source_content_diverged", detail: ["SYNTHETIC_CREDENTIAL_SENTINEL"] } as DecisionFinding,
      { rule: "PV12", code: `marker_foreign ${PROFILE}` } as unknown as DecisionFinding,
    ], { recordPhase: "copying" }));
    const text = buildMigrationDiagnosticReport({ presentation: p, completedPlans: ["AP-D3", "AP-COPY"], applicationVersion: "1.2.3" });
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
    expect(text).toContain("E′7 source_key_missing");
    expect(text).toContain("PV12 unrecognized");
    const invalid = present({ completedPlans: [], outcome: "invalid_evidence", problems: [KEY_WITH_PROFILE] } as unknown as NativeMigrationRunReport);
    expect(buildMigrationDiagnosticReport({ presentation: invalid, completedPlans: [], applicationVersion: null })).not.toContain(PROFILE);
  });

  ucase("U2-9", "exactly the allowed fields: version, codes, phase, step outcomes", () => {
    const p = present(blocked([f("E′7", "source_key_missing")], { recordPhase: "copying" }));
    const text = buildMigrationDiagnosticReport({ presentation: p, completedPlans: ["AP-D3"], applicationVersion: "1.2.3" });
    expect(text.split("\n")).toEqual([
      "Storage transfer diagnostic report",
      "Application version: 1.2.3",
      "Status group: G3",
      "Codes: E′7 source_key_missing",
      "Phase at this check: copying",
      "Steps of a plan stopped by this check: none",
      "Plans completed in this session: AP-D3",
      "This report contains codes only. It is not a backup and cannot restore data.",
    ]);
  });

  ucase("U2-9", "no false phase or step certainty: unknown stays explicitly unavailable", () => {
    const p = present(blocked([f("A1", "record_read_failed")]));
    const text = buildMigrationDiagnosticReport({ presentation: p, completedPlans: [], applicationVersion: null });
    expect(text).toContain("Phase at this check: not available");
    expect(text).toContain("Application version: not available");
    // A version that is not plain build metadata is not echoed.
    const hostile = buildMigrationDiagnosticReport({ presentation: p, completedPlans: [], applicationVersion: `1.0 ${PROFILE}` });
    expect(hostile).toContain("Application version: not available");
    expect(hostile).not.toContain(PROFILE);
    // A halt reports dispositions but no phase guessed from the plan.
    const halt = present({ outcome: "halted", plan: "AP-ACT", rule: "E′11", halt: { kind: "plan_run", report: { status: "halted", haltedAtStep: 0, cause: "write_outcome_unknown", dispositions: ["outcome_unknown", "not_issued"], completedSteps: [], confirmedWriteSteps: [], unknownStep: 0, notIssuedSteps: [1], possiblyChangedStores: ["source"], ordinaryContinuationPermitted: false, continuation: "re_evaluate" } }, transaction: null, marker: { step: 0, status: "write_failed" }, completedPlans: [] } as unknown as NativeMigrationRunReport);
    const haltText = buildMigrationDiagnosticReport({ presentation: halt, completedPlans: [], applicationVersion: "1.0.0" });
    expect(haltText).toContain("Phase at this check: not available");
    expect(haltText).toContain("Step 1: outcome unknown");
    expect(haltText).toContain("Step 2: not issued");
    expect(haltText).toContain("marker:write_failed");
  });
});
