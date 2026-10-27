// The migration recovery presentation model — Stage M3b4c.
//
// A pure classification of the dormant M3b4b runner's typed reports into the
// first-version U2 policy (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6): four
// user-visible groups, one fixed explanation, the actions that group permits,
// and the restricted facts a diagnostic report may carry.
//
// ## Rules this module encodes, and where they come from
//
//   - The group follows the OBSERVED CAUSE, from every finding (§6.2). The
//     precedence is deterministic: a positively observed contradiction (G3)
//     beats an unsupported format or an internal-check failure (G4), which
//     beats an unavailability that a later read may resolve (G2). The decision
//     core's `retryMayResolve` is never consulted: it marks only the first
//     finding's rule and is explicitly not a UX policy.
//   - Only G2 offers a recheck (§6.3, UG-1, UG-2).
//   - An unrecognised report, rule or code is G4 "internal check", never
//     evidence of corruption (§6.2, UG-2).
//   - A `disposed` report is never presented: a disposed run publishes nothing.
//
// ## What leaves this module
//
// Fixed codes from closed allowlists, step dispositions, a validated phase and
// counts. Never a finding's `detail` (key names can embed Profile UUIDs), a
// value, a record, marker or latch byte, a fingerprint, an identifier or any
// exception text. Every string that is not on an allowlist becomes
// `unrecognized`.
//
// ## What it does not do
//
// It performs no I/O and constructs nothing. It imports the executor's and the
// decision core's TYPES only, which erase (asserted by
// `__tests__/architectureBoundary.test.ts`).
import type {
  HaltObservation,
  MarkerAccount,
  NativeMigrationRunReport,
  PlanHalt,
  RecordPhaseObservation,
  TransactionAccount,
} from "./nativeMigrationRunner";
import type {
  DecisionFinding,
  DecisionReasonCode,
  DecisionRule,
  PlanName,
  RetirementDisposition,
} from "./nativeMigrationDecision";

/** The four user-visible groups of §6.2. Stable identifiers. */
export type MigrationGroup = "G1" | "G2" | "G3" | "G4";

/** One fixed explanation per observed cause. The English copy lives in
 * `src/components/persistence/migrationRecoveryCopy.ts`. */
export type MigrationExplanation =
  // G2 — unavailable or halted; a new check may resolve it.
  | "read_unavailable"
  | "active_target_unavailable"
  | "warm_check_unreadable"
  | "halt_unknown_outcome"
  | "halt_step_not_completed"
  | "reopen_failed"
  | "storage_busy_elsewhere"
  | "reopen_required"
  | "bound_reached"
  // G3 — positively observed contradiction or detected fault.
  | "fault_detected"
  | "latch_present"
  | "halt_contradiction"
  | "record_inconsistent"
  | "rows_without_record"
  | "marker_without_record"
  | "marker_foreign"
  | "marker_invalid"
  | "staging_inconsistent"
  | "entry_key_vanished"
  | "source_diverged"
  // G4 — unsupported format or internal check (UG-1, UG-2).
  | "version_newer"
  | "version_older"
  | "internal_check"
  | "handover_failed";

export type MigrationStepDisposition =
  | "confirmed"
  | "succeeded"
  | "passed"
  | "failed"
  | "outcome_unknown"
  | "aborted_before_write"
  | "not_issued";

/** One step of a halted plan, 1-based, with its disposition. */
export interface MigrationStepOutcome {
  readonly step: number;
  readonly disposition: MigrationStepDisposition;
}

/** UG-4: an already-known retirement finding — subordinate and nonblocking.
 * Counts only, never key names. */
export type MigrationRetirementNote =
  | { readonly kind: "stalled" }
  | { readonly kind: "declined_deletion"; readonly retained: number; readonly unverifiable: number };

export type MigrationPresentation =
  | { readonly kind: "running"; readonly group: "G1" }
  /**
   * The session's owner disposed it. Terminal: no group, no action, no access.
   * Not a migration outcome — the storage owner ended this session.
   */
  | { readonly kind: "ended" }
  | {
      readonly kind: "blocking";
      readonly group: "G2" | "G3" | "G4";
      readonly explanation: MigrationExplanation;
      /** Fixed technical codes, in a deterministic order. */
      readonly codes: readonly string[];
      /** §6.3: true for G2 only. */
      readonly recheck: boolean;
      /** The phase of the validated record THIS outcome was decided from, else null. */
      readonly phase: RecordPhaseObservation | null;
      /** A halted plan's steps; empty where no plan ran to a halt. */
      readonly steps: readonly MigrationStepOutcome[];
    }
  | {
      readonly kind: "access";
      readonly phase: RecordPhaseObservation | null;
      readonly retirement: MigrationRetirementNote | null;
    };

/* ------------------------------------------------------------- allowlists */

const PLAN_NAMES: ReadonlySet<string> = new Set(["D1", "AP-D3", "AP-K1′", "AP-COPY", "AP-CC", "AP-ACT", "AP-LATCH"]);

/** Every decision rule, exhaustively (a missing or extra rule fails to compile). */
const RULE_TABLE: Readonly<Record<DecisionRule, true>> = {
  L0a: true, L0b: true, A1: true, A2: true, A3: true, A4: true, A5: true, A6: true,
  "A′1": true, "A′2": true, "A′3": true, "A′4": true, "A′5": true, "A′6": true, "A′7": true,
  B1: true, B4: true, C1: true,
  PV1: true, PV2: true, PV3: true, PV4: true, PV5: true, PV6: true, PV7: true,
  PV8: true, PV9: true, PV10: true, PV11: true, PV12: true,
  "E′1": true, "E′2": true, "E′3": true, "E′4": true, "E′5": true, "E′6": true,
  "E′7": true, "E′8": true, "E′9": true, "E′10": true, "E′11": true, "E′12": true,
  "I-1": true, "I-7": true, "I-11": true, "I-13": true,
};
const RULES: ReadonlySet<string> = new Set(Object.keys(RULE_TABLE));

const PHASES: ReadonlySet<string> = new Set(["no_record", "enumerating", "copying", "verified", "active"]);

type CodeClass = { readonly group: "G2" | "G3" | "G4"; readonly explanation: MigrationExplanation };
const retry: CodeClass = { group: "G2", explanation: "read_unavailable" };
const g3 = (explanation: MigrationExplanation): CodeClass => ({ group: "G3", explanation });
const g4 = (explanation: MigrationExplanation): CodeClass => ({ group: "G4", explanation });

/**
 * Every decision reason code, exhaustively classified. G2: an unavailability a
 * later read may resolve. G3: a positively observed contradiction. G4: an
 * unsupported format or an internal-check failure. A code added to the decision
 * core without a classification here fails to compile.
 */
const CODE_CLASS: Readonly<Record<DecisionReasonCode, CodeClass>> = {
  // G2 — unavailable.
  latch_read_failed: retry,
  record_read_failed: retry,
  target_failing: retry,
  source_enumeration_failed: retry,
  target_rows_read_failed: retry,
  marker_read_failed: retry,
  row_fingerprint_unavailable: retry,
  source_fingerprint_unavailable: retry,
  warm_row_bytes_unreadable: { group: "G2", explanation: "warm_check_unreadable" },
  target_row_value_read_failed: retry,
  // G4 — unsupported format (UG-1) or internal check (UG-2). A malformed digest
  // is a defect in this build's binding, not a contradiction in the user's data.
  record_schema_newer: g4("version_newer"),
  record_schema_older: g4("version_older"),
  unspecified_state: g4("internal_check"),
  row_fingerprint_malformed: g4("internal_check"),
  source_fingerprint_malformed: g4("internal_check"),
  // G3 — detected fault or latch.
  latch_present: g3("latch_present"),
  warm_state_matches_neither: g3("fault_detected"),
  confirmed_step_contradicted: g3("fault_detected"),
  in_process_fault_stop: g3("fault_detected"),
  // G3 — provenance.
  target_rows_without_record: g3("rows_without_record"),
  marker_malformed: g3("marker_invalid"),
  marker_without_record: g3("marker_without_record"),
  marker_foreign: g3("marker_foreign"),
  store_identity_invalid: g3("record_inconsistent"),
  // G3 — staging.
  rows_while_enumerating: g3("staging_inconsistent"),
  copied_without_row: g3("staging_inconsistent"),
  row_without_progress: g3("staging_inconsistent"),
  row_outside_manifest: g3("staging_inconsistent"),
  row_fingerprint_mismatch: g3("staging_inconsistent"),
  // G3 — generation.
  entry_key_vanished: g3("entry_key_vanished"),
  source_key_missing: g3("source_diverged"),
  source_key_new: g3("source_diverged"),
  source_content_diverged: g3("source_diverged"),
  unsupported_identity_control: g3("source_diverged"),
  // G3 — activation-record integrity (Groups A and A′, other than A3/A4).
  record_unparseable: g3("record_inconsistent"),
  record_not_object: g3("record_inconsistent"),
  record_phase_invalid: g3("record_inconsistent"),
  record_schema_version_invalid: g3("record_inconsistent"),
  record_unknown_field: g3("record_inconsistent"),
  copied_malformed: g3("record_inconsistent"),
  copied_duplicate: g3("record_inconsistent"),
  activated_at_malformed: g3("record_inconsistent"),
  source_retirement_malformed: g3("record_inconsistent"),
  manifest_malformed: g3("record_inconsistent"),
  manifest_absent: g3("record_inconsistent"),
  copied_not_subset_of_manifest: g3("record_inconsistent"),
  identifier_not_canonical: g3("record_inconsistent"),
  field_present_contrary_to_phase: g3("record_inconsistent"),
  field_absent_contrary_to_phase: g3("record_inconsistent"),
  entry_keys_malformed: g3("record_inconsistent"),
  entry_keys_duplicate: g3("record_inconsistent"),
  entry_keys_ineligible: g3("record_inconsistent"),
  entry_keys_empty: g3("record_inconsistent"),
  manifest_duplicate_key: g3("record_inconsistent"),
  manifest_ineligible_key: g3("record_inconsistent"),
  manifest_fingerprint_malformed: g3("record_inconsistent"),
  manifest_empty: g3("record_inconsistent"),
  entry_keys_not_in_manifest: g3("record_inconsistent"),
  copied_incomplete: g3("record_inconsistent"),
  active_lists_inconsistent: g3("record_inconsistent"),
};
const CODES: ReadonlyMap<string, CodeClass> = new Map(Object.entries(CODE_CLASS));

/** Which G3 explanation is shown when several apply: the strongest first. */
const G3_PRIORITY: readonly MigrationExplanation[] = [
  "fault_detected",
  "latch_present",
  "halt_contradiction",
  "record_inconsistent",
  "rows_without_record",
  "marker_without_record",
  "marker_foreign",
  "marker_invalid",
  "staging_inconsistent",
  "entry_key_vanished",
  "source_diverged",
];

/** G4: an unsupported format names the format; otherwise internal check. */
const G4_PRIORITY: readonly MigrationExplanation[] = ["version_newer", "version_older", "internal_check", "handover_failed"];

/** Halt observations: what the failing step had already observed (exhaustive). */
const OBSERVATION_TABLE: Readonly<Record<HaltObservation, "G2" | "G3" | "G4">> = {
  source_listing_failed: "G2",
  unsupported_identity_control: "G3",
  source_value_unreadable: "G2",
  // A key the step's OWN enumeration listed, then read as absent: the next
  // evaluation decides whether that matters (E′5) — not itself a contradiction.
  listed_value_absent: "G2",
  digest_unavailable: "G2",
  recheck_enumeration_failed: "G2",
  source_validation_unavailable: "G2",
  target_evidence_unavailable: "G2",
  // A manifest key positively absent: set equality fails (E′7).
  planned_value_absent: "G3",
  entry_key_missing: "G3",
  batch_digest_mismatch: "G3",
  source_validation_diverged: "G3",
  target_evidence_mismatch: "G3",
  digest_malformed: "G4",
  recheck_not_evaluable: "G4",
};
const OBSERVATION_GROUP: ReadonlyMap<string, "G2" | "G3" | "G4"> = new Map(Object.entries(OBSERVATION_TABLE));

const EXTERNAL_REFUSALS: ReadonlySet<string> = new Set(["lease_held", "connection_held_elsewhere", "diagnostic_transaction_pending"]);
const INTERNAL_REFUSALS: ReadonlySet<string> = new Set(["no_lease", "wrong_lease", "invalid_transaction", "protocol_refused"]);
const ALL_REFUSALS: ReadonlySet<string> = new Set([...EXTERNAL_REFUSALS, ...INTERNAL_REFUSALS, "requires_reopen", "cancelled"]);
const NOT_COMMITTED_REASONS: ReadonlySet<string> = new Set([
  "begin_unacknowledged", "precondition_failed", "evidence_unreadable", "evidence_mismatch",
  "statement_failed", "latch_already_present", "cancelled", "protocol_refused",
]);
const DISPOSITIONS: ReadonlySet<string> = new Set([
  "confirmed", "succeeded", "passed", "failed", "outcome_unknown", "aborted_before_write", "not_issued",
]);
const EVIDENCE_NAMES: ReadonlySet<string> = new Set([
  "latch", "record", "targetHealth", "targetRows", "source", "marker",
  "targetRowFingerprints", "sourceFingerprints", "targetRowValues",
]);

function allowed(value: unknown, set: ReadonlySet<string>): string {
  return typeof value === "string" && set.has(value) ? value : "unrecognized";
}

function dedupe(codes: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(codes)]);
}

function phaseOf(value: unknown): RecordPhaseObservation | null {
  return typeof value === "string" && PHASES.has(value) ? (value as RecordPhaseObservation) : null;
}

function blocking(
  group: "G2" | "G3" | "G4",
  explanation: MigrationExplanation,
  codes: readonly string[],
  extra: { phase?: RecordPhaseObservation | null; steps?: readonly MigrationStepOutcome[] } = {}
): MigrationPresentation {
  return Object.freeze({
    kind: "blocking" as const,
    group,
    explanation,
    codes: dedupe(codes),
    recheck: group === "G2",
    phase: extra.phase ?? null,
    steps: Object.freeze([...(extra.steps ?? [])]),
  });
}

/** The fixed presentation for an unexpected failure (UG-2): never evidence of corruption. */
export function unexpectedFailurePresentation(): MigrationPresentation {
  return blocking("G4", "internal_check", ["unexpected_failure"]);
}

/** UG-2: the B4 storage could not be handed over (its lease was not freed). */
export function handoverFailedPresentation(boundary: "close" | "release" | "held"): MigrationPresentation {
  return blocking("G4", "handover_failed", [`handover_failed:${boundary}`]);
}

export const RUNNING_PRESENTATION: MigrationPresentation = Object.freeze({ kind: "running" as const, group: "G1" as const });

export const ENDED_PRESENTATION: MigrationPresentation = Object.freeze({ kind: "ended" as const });

/**
 * A stopped plan's restricted facts, kept by the session as HISTORY: the plan
 * name and each step's disposition exactly as recorded when that plan stopped.
 * It is never re-labelled as a fresh observation and never resolved by the
 * session itself (Stage M3b4c; §6.6).
 */
export interface MigrationStoppedPlan {
  readonly plan: string;
  readonly steps: readonly MigrationStepOutcome[];
}

/**
 * Fixed plan names from a report's `completedPlans`, or `null` when the value is
 * not a well-formed list of known plans. Never throws: a hostile getter or entry
 * yields `null`, which the session presents as G4.
 */
export function sanitizeCompletedPlans(value: unknown): readonly PlanName[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const names: PlanName[] = [];
    for (const entry of value) {
      const name = entry && typeof entry === "object" ? (entry as { name?: unknown }).name : undefined;
      if (typeof name !== "string" || !PLAN_NAMES.has(name)) return null;
      names.push(name as PlanName);
    }
    return Object.freeze(names);
  } catch {
    return null;
  }
}

/** The plan name a halted presentation's codes carry (`plan:<name>`), if any. */
export function stoppedPlanOf(presentation: MigrationPresentation): MigrationStoppedPlan | null {
  if (presentation.kind !== "blocking" || presentation.steps.length === 0) return null;
  const code = presentation.codes.find((entry) => entry.startsWith("plan:"));
  const plan = code ? code.slice("plan:".length) : "unrecognized";
  return Object.freeze({ plan: PLAN_NAMES.has(plan) ? plan : "unrecognized", steps: presentation.steps });
}

/* ------------------------------------------------------------- findings */

type Category =
  | { readonly group: "G2"; readonly explanation: MigrationExplanation }
  | { readonly group: "G3"; readonly explanation: MigrationExplanation }
  | { readonly group: "G4"; readonly explanation: MigrationExplanation };

function categorise(finding: DecisionFinding): Category {
  const rule = typeof finding?.rule === "string" ? finding.rule : "";
  const known = typeof finding?.code === "string" ? CODES.get(finding.code) : undefined;
  if (!RULES.has(rule) || !known) return { group: "G4", explanation: "internal_check" };
  // B1: an `active` record over a target failing now.
  if (known.group === "G2" && rule === "B1") return { group: "G2", explanation: "active_target_unavailable" };
  return known;
}

function findingCode(finding: DecisionFinding): string {
  const rule = allowed(finding?.rule, RULES);
  const code = typeof finding?.code === "string" && CODES.has(finding.code) ? finding.code : "unrecognized";
  return `${rule} ${code}`;
}

/** §6.2's deterministic precedence over EVERY finding: G3 > G4 > G2. */
export function classifyFindings(findings: readonly DecisionFinding[]): { group: "G2" | "G3" | "G4"; explanation: MigrationExplanation } {
  const categories = (Array.isArray(findings) ? findings : []).map(categorise);
  if (categories.length === 0) return { group: "G4", explanation: "internal_check" };
  const pick = (group: "G2" | "G3" | "G4", priority: readonly MigrationExplanation[]) => {
    const present = new Set(categories.filter((c) => c.group === group).map((c) => c.explanation));
    if (present.size === 0) return null;
    return priority.find((explanation) => present.has(explanation)) ?? [...present][0];
  };
  const contradiction = pick("G3", G3_PRIORITY);
  if (contradiction) return { group: "G3", explanation: contradiction };
  const neutral = pick("G4", G4_PRIORITY);
  if (neutral) return { group: "G4", explanation: neutral };
  const unavailable = pick("G2", ["active_target_unavailable", "warm_check_unreadable", "read_unavailable"]);
  return { group: "G2", explanation: unavailable ?? "read_unavailable" };
}

/* ------------------------------------------------------------- halts */

function stepOutcomes(dispositions: unknown): readonly MigrationStepOutcome[] {
  if (!Array.isArray(dispositions)) return [];
  return dispositions.map((disposition, index) => ({
    step: index + 1,
    disposition: (DISPOSITIONS.has(disposition as string) ? disposition : "not_issued") as MigrationStepDisposition,
  }));
}

function accountCodes(transaction: TransactionAccount | null | undefined, marker: MarkerAccount | null | undefined): string[] {
  const codes: string[] = [];
  if (marker) {
    const status = allowed(marker.status, new Set(["written", "already_matching", "write_failed", "refused"]));
    codes.push(
      marker.status === "refused"
        ? `marker:refused:${allowed(marker.reason, new Set(["marker_present", "marker_unreadable"]))}`
        : `marker:${status}`
    );
  }
  if (transaction) {
    const status = allowed(transaction.status, new Set(["confirmed", "outcome_unknown", "refused", "not_begun", "not_committed"]));
    if (transaction.status === "refused") codes.push(`transaction:refused:${allowed(transaction.reason, ALL_REFUSALS)}`);
    else if (transaction.status === "not_committed") codes.push(`transaction:not_committed:${allowed(transaction.reason, NOT_COMMITTED_REASONS)}`);
    else codes.push(`transaction:${status}`);
  }
  return codes;
}

function presentHalt(
  plan: PlanName,
  halt: PlanHalt,
  transaction: TransactionAccount | null,
  marker: MarkerAccount | null
): MigrationPresentation {
  const codes = [`plan:${allowed(plan, PLAN_NAMES)}`];
  if (!halt || typeof halt !== "object") return blocking("G4", "internal_check", [...codes, "halt:unrecognized"]);

  if (halt.kind === "not_issued") {
    const cause = allowed(halt.cause, new Set(["preparation_failed", "target_unavailable", "precondition_failed", "disposed"]));
    codes.push(`not_issued:${cause}`, ...accountCodes(transaction, marker));
    const steps = stepOutcomes(halt.dispositions);
    if (halt.cause === "precondition_failed") {
      // A foreign or malformed marker refused AT the write is positive evidence
      // (PV11/PV12 next); an unreadable one is not.
      return marker?.status === "refused" && marker.reason === "marker_present"
        ? blocking("G3", "halt_contradiction", codes, { steps })
        : blocking("G2", "halt_step_not_completed", codes, { steps });
    }
    if (halt.cause === "target_unavailable") {
      if (transaction?.status === "refused") {
        if (EXTERNAL_REFUSALS.has(transaction.reason)) return blocking("G2", "storage_busy_elsewhere", codes, { steps });
        if (transaction.reason === "requires_reopen") return blocking("G2", "reopen_required", codes, { steps });
        return blocking("G4", "internal_check", codes, { steps });
      }
      return blocking("G2", "halt_step_not_completed", codes, { steps });
    }
    if (halt.cause === "preparation_failed") return blocking("G2", "halt_step_not_completed", codes, { steps });
    return blocking("G4", "internal_check", codes, { steps });
  }

  if (halt.kind !== "plan_run" || halt.report?.status !== "halted") {
    return blocking("G4", "internal_check", [...codes, "halt:unrecognized"]);
  }
  const report = halt.report;
  const steps = stepOutcomes(report.dispositions);
  const observed = halt.observed !== undefined && OBSERVATION_GROUP.has(halt.observed) ? halt.observed : undefined;
  codes.push(`halt:${allowed(report.cause, new Set(["write_outcome_unknown", "read_failed", "recheck_failed", "aborted_before_write"]))}`);
  if (observed) codes.push(`observed:${observed}`);
  codes.push(...accountCodes(transaction, marker));

  switch (report.cause) {
    case "write_outcome_unknown":
      return blocking("G2", "halt_unknown_outcome", codes, { steps });
    case "read_failed":
    case "recheck_failed": {
      const group = observed ? OBSERVATION_GROUP.get(observed) : undefined;
      if (group === "G2") return blocking("G2", "halt_step_not_completed", codes, { steps });
      if (group === "G3") return blocking("G3", "halt_contradiction", codes, { steps });
      return blocking("G4", "internal_check", codes, { steps });
    }
    case "aborted_before_write": {
      const reason = transaction?.status === "not_committed" ? transaction.reason : undefined;
      if (reason === "evidence_mismatch") {
        const group = observed ? OBSERVATION_GROUP.get(observed) : undefined;
        if (group === "G3") return blocking("G3", "halt_contradiction", codes, { steps });
        if (group === "G2") return blocking("G2", "halt_step_not_completed", codes, { steps });
        return blocking("G4", "internal_check", codes, { steps });
      }
      // An unreadable in-transaction read, or a record that changed underneath:
      // the next evaluation decides; this halt itself proves no contradiction.
      if (reason === "evidence_unreadable" || reason === "precondition_failed") {
        return blocking("G2", "halt_step_not_completed", codes, { steps });
      }
      return blocking("G4", "internal_check", codes, { steps });
    }
    default:
      return blocking("G4", "internal_check", codes, { steps });
  }
}

/* ------------------------------------------------------------- retirement */

function retirementNote(retirement: RetirementDisposition | undefined): MigrationRetirementNote | null {
  if (!retirement || typeof retirement !== "object") return null;
  if ("rule" in retirement && retirement.rule === "B2") return Object.freeze({ kind: "stalled" as const });
  if ("rule" in retirement && retirement.rule === "B3") {
    const retained = Array.isArray(retirement.retainChanged) ? retirement.retainChanged.length : 0;
    const unverifiable = Array.isArray(retirement.unverifiable) ? retirement.unverifiable.length : 0;
    if (retained === 0 && unverifiable === 0) return null;
    return Object.freeze({ kind: "declined_deletion" as const, retained, unverifiable });
  }
  return null;
}

/* ------------------------------------------------------------- entry */

/**
 * Presents one run report. `null` for a `disposed` report: a disposed run
 * publishes nothing. Anything unrecognised is G4 "internal check".
 */
export function presentRunReport(report: NativeMigrationRunReport): MigrationPresentation | null {
  try {
    if (!report || typeof report !== "object") return unexpectedFailurePresentation();
    switch (report.outcome) {
      case "disposed":
        return null;
      case "access":
        return Object.freeze({
          kind: "access" as const,
          phase: phaseOf(report.recordPhase),
          retirement: retirementNote(report.retirement),
        });
      case "blocked": {
        const findings = Array.isArray(report.findings) ? report.findings : [];
        const { group, explanation } = classifyFindings(findings);
        return blocking(group, explanation, findings.map(findingCode), { phase: phaseOf(report.recordPhase) });
      }
      case "fault": {
        const findings = Array.isArray(report.findings) ? report.findings : [];
        const established = report.latch?.established;
        const latch = established === "confirmed" || established === "already_present" ? established : "not_established";
        // A detected fault is G3 whatever its findings say.
        return blocking("G3", "fault_detected", [...findings.map(findingCode), "I-13 fault", `latch:${latch}`]);
      }
      case "halted":
        return presentHalt(report.plan, report.halt, report.transaction, report.marker);
      case "bound_reached":
        return blocking("G2", "bound_reached", ["bound_reached"]);
      case "reopen_failed":
        return blocking("G2", "reopen_failed", [`reopen_failed:${allowed(report.boundary, new Set(["refused", "close", "release", "open"]))}`]);
      case "target_refused": {
        const code = `target_refused:${allowed(report.reason, ALL_REFUSALS)}`;
        if (EXTERNAL_REFUSALS.has(report.reason)) return blocking("G2", "storage_busy_elsewhere", [code]);
        if (report.reason === "requires_reopen") return blocking("G2", "reopen_required", [code]);
        return blocking("G4", "internal_check", [code]);
      }
      case "evidence_required": {
        const missing = Array.isArray(report.missing) ? report.missing : [];
        return blocking("G4", "internal_check", ["evidence_required", ...missing.map((name) => `missing:${allowed(name, EVIDENCE_NAMES)}`)]);
      }
      case "invalid_evidence":
        // The problem codes are fixed, but they describe an internal snapshot;
        // the category alone is reported.
        return blocking("G4", "internal_check", ["invalid_evidence"]);
      default:
        return unexpectedFailurePresentation();
    }
  } catch {
    return unexpectedFailurePresentation();
  }
}

/* ------------------------------------------------------------- diagnostics */

const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,31}$/;

export interface MigrationDiagnosticInput {
  readonly presentation: MigrationPresentation;
  /**
   * The most recent plan this session saw stop, as recorded then. Reported only
   * when the current check is not itself a stopped plan, under a label that
   * says it is history — a later check that failed before evaluating the stored
   * state (a failed reopen, a refusal, an unreadable read) does not erase it.
   */
  readonly earlierStoppedPlan?: MigrationStoppedPlan | null;
  /** Plans completed in this session, in order. Fixed plan names. */
  readonly completedPlans: readonly PlanName[];
  /** The application/build version from non-secret build metadata, or null. */
  readonly applicationVersion: string | null;
}

const DISPOSITION_TEXT: Readonly<Record<MigrationStepDisposition, string>> = {
  confirmed: "confirmed",
  succeeded: "succeeded",
  passed: "passed",
  failed: "failed",
  outcome_unknown: "outcome unknown",
  aborted_before_write: "stopped before writing",
  not_issued: "not issued",
};

/**
 * The restricted diagnostic report of §6.6, as plain text. A dedicated
 * allowlisted projection: application version, fixed codes, a validated phase
 * and known step outcomes — nothing else. Built only when the user asks.
 */
export function buildMigrationDiagnosticReport(input: MigrationDiagnosticInput): string {
  const { presentation } = input;
  const version =
    typeof input.applicationVersion === "string" && VERSION_PATTERN.test(input.applicationVersion)
      ? input.applicationVersion
      : "not available";
  const lines = ["Storage transfer diagnostic report", `Application version: ${version}`];
  if (presentation.kind === "blocking") {
    lines.push(`Status group: ${presentation.group}`);
    lines.push(`Codes: ${presentation.codes.length > 0 ? presentation.codes.join("; ") : "none"}`);
    lines.push(`Phase at this check: ${presentation.phase === null ? "not available" : presentation.phase.replace("_", " ")}`);
    if (presentation.steps.length > 0) {
      lines.push("Steps of the plan stopped by this check:");
      for (const step of presentation.steps) lines.push(`  Step ${step.step}: ${DISPOSITION_TEXT[step.disposition]}`);
    } else {
      lines.push("Steps of a plan stopped by this check: none");
      const earlier = input.earlierStoppedPlan;
      if (earlier && Array.isArray(earlier.steps) && earlier.steps.length > 0) {
        const plan = typeof earlier.plan === "string" && PLAN_NAMES.has(earlier.plan) ? earlier.plan : "unrecognized";
        lines.push(`Earlier in this session, plan ${plan} stopped. Its steps as recorded when it stopped (not re-checked by this check):`);
        for (const step of earlier.steps) {
          const disposition: MigrationStepDisposition = DISPOSITIONS.has(step?.disposition as string)
            ? step.disposition
            : "not_issued";
          lines.push(`  Step ${Number.isSafeInteger(step?.step) ? step.step : "?"}: ${DISPOSITION_TEXT[disposition]}`);
        }
      }
    }
  } else if (presentation.kind === "access") {
    lines.push("Status: transfer complete (B4)");
    lines.push(`Phase at this check: ${presentation.phase === null ? "not available" : presentation.phase}`);
  } else if (presentation.kind === "ended") {
    lines.push("Status: session ended");
  } else {
    lines.push("Status group: G1");
  }
  const completed = (Array.isArray(input.completedPlans) ? input.completedPlans : []).map((name) => allowed(name, PLAN_NAMES));
  lines.push(`Plans completed in this session: ${completed.length > 0 ? completed.join(", ") : "none"}`);
  lines.push("This report contains codes only. It is not a backup and cannot restore data.");
  return lines.join("\n");
}
