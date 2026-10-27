// The native-migration decision function — Stage M3b4a.
//
// One deterministic, synchronous, side-effect-free function that evaluates a
// snapshot of migration evidence and returns exactly one of: a blocked decision, a
// named symbolic action plan, the post-activation access disposition, a detected
// fault stop, or a contract outcome when the snapshot cannot be evaluated.
//
// The rules are those of docs/MOBILE_APP_MIGRATION.md Stage M3b0 §§5.1–5.7
// (approved 2026-10-19) and nothing else. Their identifiers — L0, A1–A6, A′1–A′7,
// B1–B4, C1/C2, PV1–PV14, E′1–E′12, D1, AP-*, I-1–I-13 — are kept verbatim so the
// specification, this code and the class-L tests refer to the same rows.
//
// ## What this module does NOT do
//
// It executes nothing. No source or target read or write, no SQL, no enumeration,
// no transaction, no marker or latch I/O, no deletion, no network, no device
// operation. A plan is a description; an executor (Stage M3b4b, not built) would
// carry it out and bring the results back as new evidence. It never returns or
// installs a production `NativeActivationVerdict`: the production activation
// authority stays `unavailable`, and no production module imports this file in
// M3b4a (asserted by `__tests__/architectureBoundary.test.ts`).
//
// It never parses an application value. Values stay opaque; only precomputed
// fingerprints of them are compared, and the fingerprint algorithm is NOT chosen
// here (I-7) — the caller injects a pure format predicate.
import { isCanonicalUuid } from "../uuid";
import {
  classifyMigrationSourceKey,
  isEligibleMigrationKey,
  isUnsupportedMigrationIdentityControlKey,
  NATIVE_MIGRATION_ACTIVATION_RECORD_KEY,
  NATIVE_MIGRATION_FAULT_LATCH_KEY,
} from "./nativeMigrationEligibility";
import {
  evaluateActivationRecord,
  safeFormat,
  serializeActivationRecord,
  type ActivationRecord,
  type FingerprintFormatPredicate,
  type MigrationPhase,
  type RecordReasonCode,
  type RecordRule,
} from "./nativeMigrationRecord";

// ---------------------------------------------------------------------------
// Evidence contract
// ---------------------------------------------------------------------------

/**
 * One stored value, as a read reported it. `absent` is a SUCCESSFUL read that
 * found nothing; `read_failed` means presence is unknown and is never absence
 * (I-1). An omitted observation means "not observed", which is neither.
 */
export type StoredValueObservation =
  | { readonly status: "absent" }
  | { readonly status: "present"; readonly bytes: string }
  | { readonly status: "read_failed" };

/** A precomputed digest of one value's exact bytes, or a failure to obtain it. */
export type FingerprintObservation =
  | { readonly status: "computed"; readonly value: string }
  | { readonly status: "unavailable" };

export interface KeyObservation {
  readonly key: string;
  /** Omitted = not observed. Required only where a rule compares content. */
  readonly fingerprint?: FingerprintObservation;
}

/** A complete enumeration (I-2 for the target, §3's `listKeys` for the source), or its failure. */
export type KeyListingObservation =
  | { readonly status: "read_failed" }
  | { readonly status: "listed"; readonly entries: readonly KeyObservation[] };

/** B1's input: whether the native target is failing now (read or write errors). */
export type TargetHealthObservation = { readonly status: "healthy" } | { readonly status: "failing" };

/**
 * A row a transaction of THIS process issued, with its exact issued bytes (I-11).
 * The bytes are an opaque application value held transiently for the comparison;
 * they are never parsed, and never copied into a finding, a report or a latch.
 */
export interface IssuedRow {
  readonly key: string;
  readonly bytes: string;
}

/** One target row's exact bytes, as a read reported them. Required only in a warm evaluation. */
export interface RowValueObservation {
  readonly key: string;
  readonly value: StoredValueObservation;
}

export type IssuedTransactionKind =
  | "create_fresh_active"
  | "create_enumerating"
  | "replace_enumerating"
  | "begin_copying"
  | "checkpoint"
  | "complete_copying"
  | "activate";

/** A target transaction whose outcome a surviving process does not know (I-9, I-11). */
export interface UnknownOutcomeTransaction {
  readonly kind: IssuedTransactionKind;
  /** Exact record bytes before the transaction; `null` = no record existed. */
  readonly recordBefore: string | null;
  /** Exact record bytes the transaction would have written. */
  readonly recordAfter: string;
  /** Rows it would have inserted, with their exact issued bytes. */
  readonly insertedRows: readonly IssuedRow[];
}

/**
 * WARM evidence: what a process that survived an unknown outcome still holds
 * (I-11). A cold start supplies none of it and needs none of it.
 */
export interface SurvivingPlanEvidence {
  readonly unknownTransaction?: UnknownOutcomeTransaction;
  /** Every row this process saw committed by a CONFIRMED transaction. */
  readonly confirmedRows: readonly IssuedRow[];
  /** Record bytes after the last confirmed transaction; consulted only without an unknown transaction. */
  readonly lastConfirmedRecord?: string;
}

/** Outcome of each issued latch write. A rejection is `outcome_unknown` (I-9). */
export type LatchWriteAttempt = "confirmed" | "outcome_unknown";

/** The in-memory stop a detected fault sets (I-13). It holds until the process ends. */
export interface InProcessFaultStop {
  readonly latchContent: string;
  readonly latchWriteAttempts: readonly LatchWriteAttempt[];
}

export interface NativeMigrationEvidence {
  /** The durable fault latch (L0). */
  readonly latch?: StoredValueObservation;
  /** The activation record's exact bytes (Group A). */
  readonly record?: StoredValueObservation;
  /** Group B's target health; consulted only for an `active` record. */
  readonly targetHealth?: TargetHealthObservation;
  /**
   * I-2's enumeration of the target's application rows, excluding the reserved
   * locations. In a warm evaluation a successful listing is also positive evidence:
   * the presence or absence of an issued key, by key alone (I-11).
   */
  readonly targetRows?: KeyListingObservation;
  /** The complete source enumeration, every key (eligible or not). */
  readonly source?: KeyListingObservation;
  /** The source marker (I-3); never consulted for an `active` record. */
  readonly marker?: StoredValueObservation;
  /** Present only in a warm evaluation. */
  readonly survivingPlan?: SurvivingPlanEvidence;
  /**
   * Exact bytes of the target rows a warm comparison needs — every row in the
   * surviving plan's `insertedRows` and `confirmedRows`, except an inserted row whose
   * absence a successful `targetRows` listing proves once the after-state is excluded.
   * Never needed otherwise: an ordinary (cold) launch, active or not, compares no
   * historical row bytes.
   */
  readonly targetRowValues?: readonly RowValueObservation[];
  /** Present only after this process detected a fault. */
  readonly inProcessFault?: InProcessFaultStop;
}

export interface NativeMigrationDecisionOptions {
  /** A pure, synchronous format check for a precomputed fingerprint (I-7). */
  readonly isWellFormedFingerprint: FingerprintFormatPredicate;
  /** Engineering parameter: the most keys one checkpoint may carry. A positive integer. */
  readonly checkpointBatchKeyLimit: number;
  /** Engineering parameter: the bounded number of latch-write attempts (I-13). A positive integer. */
  readonly latchWriteAttemptLimit: number;
}

// ---------------------------------------------------------------------------
// Result contract
// ---------------------------------------------------------------------------

export type DecisionRule =
  | "L0a"
  | "L0b"
  | "A1"
  | RecordRule
  | "B1"
  | "B4"
  | "C1"
  | "PV1" | "PV2" | "PV3" | "PV4" | "PV5" | "PV6" | "PV7"
  | "PV8" | "PV9" | "PV10" | "PV11" | "PV12"
  | "E′1" | "E′2" | "E′3" | "E′4" | "E′5" | "E′6" | "E′7" | "E′8" | "E′9" | "E′10" | "E′11" | "E′12"
  | "I-1"
  | "I-7"
  | "I-11"
  | "I-13";

export type DecisionReasonCode =
  | RecordReasonCode
  | "latch_read_failed"
  | "latch_present"
  | "record_read_failed"
  | "target_failing"
  | "source_enumeration_failed"
  | "unsupported_identity_control"
  | "target_rows_read_failed"
  | "target_rows_without_record"
  | "marker_read_failed"
  | "marker_malformed"
  | "marker_without_record"
  | "store_identity_invalid"
  | "marker_foreign"
  | "rows_while_enumerating"
  | "copied_without_row"
  | "row_without_progress"
  | "row_outside_manifest"
  | "row_fingerprint_unavailable"
  | "row_fingerprint_malformed"
  | "row_fingerprint_mismatch"
  | "entry_key_vanished"
  | "source_fingerprint_unavailable"
  | "source_fingerprint_malformed"
  | "source_key_missing"
  | "source_key_new"
  | "source_content_diverged"
  | "warm_state_matches_neither"
  | "warm_row_bytes_unreadable"
  | "target_row_value_read_failed"
  | "confirmed_step_contradicted"
  | "in_process_fault_stop"
  | "unspecified_state";

export interface DecisionFinding {
  readonly rule: DecisionRule;
  readonly code: DecisionReasonCode;
  /** Key or field names only — never an application value, never a credential. */
  readonly detail?: readonly string[];
}

export type EvidenceName =
  | "latch"
  | "record"
  | "targetHealth"
  | "targetRows"
  | "source"
  | "marker"
  | "targetRowFingerprints"
  | "sourceFingerprints"
  | "targetRowValues";

/** Symbolic transaction descriptors. Generated values are named, never invented here. */
export type PlannedTargetTransaction =
  | { readonly op: "create_fresh_active"; readonly generates: readonly ["migrationId", "storeIdentity", "activatedAt"] }
  | { readonly op: "create_enumerating"; readonly entryKeys: readonly string[]; readonly generates: readonly ["migrationId", "storeIdentity"] }
  | { readonly op: "replace_enumerating"; readonly storeIdentity: string; readonly entryKeys: readonly string[]; readonly generates: readonly ["migrationId"] }
  | { readonly op: "begin_copying"; readonly manifestFromStep: number; readonly mustContain: readonly string[] }
  | {
      readonly op: "checkpoint";
      readonly batch: readonly string[];
      /** Insert EXACTLY the bytes read and checked in this step — never a second, unchecked read. */
      readonly rowBytesFromStep: number;
    }
  | { readonly op: "complete_copying"; readonly readsInside: "complete_target_evidence" }
  | { readonly op: "activate"; readonly readsInside: "complete_target_evidence"; readonly generates: readonly ["activatedAt"] }
  | { readonly op: "write_fault_latch"; readonly content: string };

export type PlanStep =
  | {
      readonly kind: "marker_write";
      readonly store: "source";
      readonly storeIdentity: { readonly existing: string } | { readonly generatedInStep: number };
    }
  | { readonly kind: "target_transaction"; readonly store: "target"; readonly transaction: PlannedTargetTransaction }
  | {
      readonly kind: "read_source";
      /** Always a FRESH read: initial evidence never satisfies a later step's read. */
      readonly fresh: true;
      readonly purpose: "digest_eligible_set" | "digest_batch" | "validate_source";
      readonly keys: readonly string[] | "current_eligible_set";
    }
  | {
      readonly kind: "recheck";
      readonly fresh: true;
      readonly check: "entry_keys_present" | "batch_digests_match_manifest" | "source_set_and_content_valid";
      readonly usesStep: number;
      /**
       * What the recheck observes. `fresh_source_enumeration`: a NEW enumeration taken
       * at the recheck itself (and the keys digested in `usesStep`), so a key that
       * vanished after the digest is caught. `observations_of_step`: exactly what
       * `usesStep` read.
       */
      readonly observes: "fresh_source_enumeration" | "observations_of_step";
    };

export type PlanName = "D1" | "AP-D3" | "AP-K1′" | "AP-COPY" | "AP-CC" | "AP-ACT" | "AP-LATCH";

export interface MigrationPlan {
  readonly name: PlanName;
  readonly steps: readonly PlanStep[];
  /** After every plan, the executor re-evaluates fresh evidence; a plan never chains on stale evidence. */
  readonly continuation: "re_evaluate";
}

export type RetirementDisposition =
  | { readonly state: "complete" }
  | { readonly state: "not_evaluated"; readonly reason: "source_not_observed" }
  | { readonly rule: "B2"; readonly state: "stalled"; readonly reason: "source_unreadable" | "source_missing" }
  | {
      readonly rule: "B3";
      readonly state: "resume";
      /** Source fingerprint matches the manifest: safe to delete (§5.5). */
      readonly deletable: readonly string[];
      /** The source holds a value the target never saw: never deleted, surfaced. */
      readonly retainChanged: readonly string[];
      /** Fingerprint not obtainable: nothing can be verified, so nothing is deleted. */
      readonly unverifiable: readonly string[];
    };

export type NativeMigrationDecision =
  | {
      readonly kind: "blocked";
      readonly rule: DecisionRule;
      readonly findings: readonly DecisionFinding[];
      /** True only where the governing condition is a read or health failure that may clear. Not a UX policy. */
      readonly retryMayResolve: boolean;
      readonly mountsOrdinaryConsumers: false;
    }
  | {
      readonly kind: "plan";
      readonly rule: DecisionRule;
      readonly plan: MigrationPlan;
      readonly mountsOrdinaryConsumers: false;
    }
  | {
      readonly kind: "access";
      readonly rule: "B4";
      readonly mountsOrdinaryConsumers: true;
      readonly retirement: RetirementDisposition;
    }
  | {
      readonly kind: "fault";
      readonly rule: "I-13";
      readonly findings: readonly DecisionFinding[];
      /** The in-memory stop. On first detection the caller must keep it for the life of the process. */
      readonly stop: InProcessFaultStop;
      /** Only the bounded latch write may run; `null` once confirmed or the attempt budget is spent. */
      readonly latchPlan: MigrationPlan | null;
      readonly mountsOrdinaryConsumers: false;
    }
  | { readonly kind: "evidence_required"; readonly missing: readonly EvidenceName[]; readonly mountsOrdinaryConsumers: false }
  | { readonly kind: "invalid_evidence"; readonly problems: readonly string[]; readonly mountsOrdinaryConsumers: false };

/** Only the symbolic B4 disposition permits ordinary access. */
export function permitsOrdinaryAccess(decision: NativeMigrationDecision): boolean {
  return decision.kind === "access" && decision.rule === "B4" && decision.mountsOrdinaryConsumers;
}

// ---------------------------------------------------------------------------
// Runtime validation of the snapshot (types do not make malformed input impossible)
// ---------------------------------------------------------------------------

const RESERVED_TARGET_KEYS: ReadonlySet<string> = new Set([
  NATIVE_MIGRATION_ACTIVATION_RECORD_KEY,
  NATIVE_MIGRATION_FAULT_LATCH_KEY,
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((field) => allowed.includes(field));
}

function validStoredValue(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.status === "absent" || value.status === "read_failed") return hasOnly(value, ["status"]);
  return value.status === "present" && typeof value.bytes === "string" && hasOnly(value, ["status", "bytes"]);
}

function validFingerprint(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.status === "unavailable") return hasOnly(value, ["status"]);
  return value.status === "computed" && typeof value.value === "string" && hasOnly(value, ["status", "value"]);
}

function listingProblems(name: string, value: unknown, problems: string[]): void {
  if (!isObject(value)) {
    problems.push(`${name}_not_object`);
    return;
  }
  if (value.status === "read_failed") {
    if (!hasOnly(value, ["status"])) problems.push(`${name}_unexpected_field`);
    return;
  }
  if (value.status !== "listed" || !Array.isArray(value.entries) || !hasOnly(value, ["status", "entries"])) {
    problems.push(`${name}_malformed`);
    return;
  }
  const seen = new Set<string>();
  for (const entry of value.entries as unknown[]) {
    if (!isObject(entry) || typeof entry.key !== "string" || !hasOnly(entry, ["key", "fingerprint"]) ||
        ("fingerprint" in entry && !validFingerprint(entry.fingerprint))) {
      problems.push(`${name}_entry_malformed`);
      return;
    }
    if (seen.has(entry.key)) problems.push(`${name}_duplicate_key`);
    seen.add(entry.key);
  }
}

function validIssuedRows(value: unknown): boolean {
  return Array.isArray(value) && value.every((row) =>
    isObject(row) && typeof row.key === "string" && typeof row.bytes === "string" &&
    hasOnly(row, ["key", "bytes"]));
}

function validRowValues(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const keys = new Set<string>();
  for (const row of value as unknown[]) {
    if (!isObject(row) || typeof row.key !== "string" || !hasOnly(row, ["key", "value"]) || !validStoredValue(row.value)) {
      return false;
    }
    if (keys.has(row.key)) return false;
    keys.add(row.key);
  }
  return true;
}

const TRANSACTION_KINDS: readonly string[] = [
  "create_fresh_active", "create_enumerating", "replace_enumerating", "begin_copying",
  "checkpoint", "complete_copying", "activate",
];

function evidenceProblems(evidence: unknown, options: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(options) || typeof options.isWellFormedFingerprint !== "function") {
    problems.push("options_fingerprint_predicate_missing");
  }
  const positive = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
  if (!isObject(options) || !positive(options.checkpointBatchKeyLimit)) problems.push("options_checkpoint_limit_invalid");
  if (!isObject(options) || !positive(options.latchWriteAttemptLimit)) problems.push("options_latch_limit_invalid");
  if (!isObject(evidence)) return [...problems, "evidence_not_object"];
  const allowed = ["latch", "record", "targetHealth", "targetRows", "source", "marker", "survivingPlan", "targetRowValues", "inProcessFault"];
  // A fixed code: an unknown field's NAME is caller-supplied content and is never echoed.
  if (Object.keys(evidence).some((field) => !allowed.includes(field))) problems.push("evidence_unknown_field");
  for (const field of ["latch", "record", "marker"]) {
    if (field in evidence && !validStoredValue(evidence[field])) problems.push(`${field}_malformed`);
  }
  if ("targetHealth" in evidence) {
    const health = evidence.targetHealth;
    if (!isObject(health) || (health.status !== "healthy" && health.status !== "failing") || !hasOnly(health, ["status"])) {
      problems.push("targetHealth_malformed");
    }
  }
  if ("targetRows" in evidence) {
    listingProblems("targetRows", evidence.targetRows, problems);
    const rows = evidence.targetRows;
    if (isObject(rows) && rows.status === "listed" && Array.isArray(rows.entries) &&
        (rows.entries as unknown[]).some((entry) => isObject(entry) && RESERVED_TARGET_KEYS.has(entry.key as string))) {
      problems.push("targetRows_include_reserved_location");
    }
  }
  if ("source" in evidence) listingProblems("source", evidence.source, problems);
  if ("targetRowValues" in evidence && !validRowValues(evidence.targetRowValues)) problems.push("targetRowValues_malformed");
  if ("survivingPlan" in evidence) {
    const plan = evidence.survivingPlan;
    if (!isObject(plan) || !hasOnly(plan, ["unknownTransaction", "confirmedRows", "lastConfirmedRecord"]) ||
        !validIssuedRows(plan.confirmedRows) ||
        ("lastConfirmedRecord" in plan && typeof plan.lastConfirmedRecord !== "string")) {
      problems.push("survivingPlan_malformed");
    } else if ("unknownTransaction" in plan) {
      const tx = plan.unknownTransaction;
      if (!isObject(tx) || !TRANSACTION_KINDS.includes(tx.kind as string) ||
          !(tx.recordBefore === null || typeof tx.recordBefore === "string") ||
          typeof tx.recordAfter !== "string" || !validIssuedRows(tx.insertedRows) ||
          !hasOnly(tx, ["kind", "recordBefore", "recordAfter", "insertedRows"])) {
        problems.push("survivingPlan_unknownTransaction_malformed");
      }
    }
  }
  if ("inProcessFault" in evidence) {
    const stop = evidence.inProcessFault;
    if (!isObject(stop) || typeof stop.latchContent !== "string" || !Array.isArray(stop.latchWriteAttempts) ||
        !(stop.latchWriteAttempts as unknown[]).every((a) => a === "confirmed" || a === "outcome_unknown") ||
        !hasOnly(stop, ["latchContent", "latchWriteAttempts"])) {
      problems.push("inProcessFault_malformed");
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Shared pure checks — also the checks an executor must repeat INSIDE AP-CC/AP-ACT
// ---------------------------------------------------------------------------

/** The eligible keys of a source listing, sorted. Excluded keys are never imported (§1). */
export function eligibleSourceKeys(entries: readonly KeyObservation[]): string[] {
  return entries.map((entry) => entry.key).filter((key) => classifyMigrationSourceKey(key).eligible).sort();
}

export type EvidenceCheck =
  | { readonly status: "passed" }
  | { readonly status: "failed"; readonly findings: readonly DecisionFinding[] }
  | { readonly status: "evidence_required"; readonly missing: readonly EvidenceName[] };

function manifestMap(record: ActivationRecord): Map<string, string> {
  return new Map((record.manifest ?? []).map((entry) => [entry.key, entry.fingerprint]));
}

const sortedList = (values: Iterable<string>): string[] => [...values].sort();

function fingerprintFindings(
  observed: KeyObservation,
  expected: string,
  isWellFormed: FingerprintFormatPredicate,
  side: "row" | "source"
): { finding?: DecisionFinding; missing?: true } {
  const fp = observed.fingerprint;
  if (fp === undefined) return { missing: true };
  if (fp.status === "unavailable") {
    return { finding: { rule: "I-1", code: side === "row" ? "row_fingerprint_unavailable" : "source_fingerprint_unavailable", detail: [observed.key] } };
  }
  if (!safeFormat(isWellFormed, fp.value)) {
    return { finding: { rule: "I-7", code: side === "row" ? "row_fingerprint_malformed" : "source_fingerprint_malformed", detail: [observed.key] } };
  }
  if (fp.value !== expected) {
    return {
      finding: side === "row"
        ? { rule: "E′4", code: "row_fingerprint_mismatch", detail: [observed.key] }
        : { rule: "I-1", code: "source_content_diverged", detail: [observed.key] },
    };
  }
  return {};
}

function merge(findings: DecisionFinding[]): DecisionFinding[] {
  // One finding per (rule, code), with the union of their key details, in first-seen order.
  const out: DecisionFinding[] = [];
  for (const finding of findings) {
    const existing = out.findIndex((f) => f.rule === finding.rule && f.code === finding.code);
    if (existing < 0) {
      out.push(finding.detail ? { ...finding, detail: sortedList(new Set(finding.detail)) } : finding);
    } else if (finding.detail) {
      const prior = out[existing];
      out[existing] = { ...prior, detail: sortedList(new Set([...(prior.detail ?? []), ...finding.detail])) };
    }
  }
  return out;
}

/**
 * Staging and target completeness for a `copying`/`verified` record: E′2 (both
 * directions), E′3, and E′4 with I-1/I-7 for unobtainable or malformed digests.
 * With `requireComplete`, `copied` must also equal the manifest — the check AP-CC
 * and AP-ACT repeat inside their own transaction (§5.3).
 */
export function checkTargetEvidence(
  record: ActivationRecord,
  targetRows: readonly KeyObservation[],
  isWellFormed: FingerprintFormatPredicate,
  requireComplete: boolean
): EvidenceCheck {
  const manifest = manifestMap(record);
  const copied = new Set(record.copied ?? []);
  const rows = new Map(targetRows.map((row) => [row.key, row]));
  const findings: DecisionFinding[] = [];
  let missing = false;
  const copiedWithoutRow = sortedList([...copied].filter((key) => !rows.has(key)));
  const rowWithoutProgress = sortedList([...rows.keys()].filter((key) => manifest.has(key) && !copied.has(key)));
  if (copiedWithoutRow.length > 0) findings.push({ rule: "E′2", code: "copied_without_row", detail: copiedWithoutRow });
  if (rowWithoutProgress.length > 0) findings.push({ rule: "E′2", code: "row_without_progress", detail: rowWithoutProgress });
  const outside = sortedList([...rows.keys()].filter((key) => !manifest.has(key)));
  if (outside.length > 0) findings.push({ rule: "E′3", code: "row_outside_manifest", detail: outside });
  const staged: DecisionFinding[] = [];
  for (const [key, row] of [...rows.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const expected = manifest.get(key);
    if (expected === undefined) continue;
    const result = fingerprintFindings(row, expected, isWellFormed, "row");
    if (result.missing) missing = true;
    if (result.finding) staged.push(result.finding);
  }
  // I-1 (unobtainable) and I-7 (malformed) precede E′4 (mismatch).
  const order = ["row_fingerprint_unavailable", "row_fingerprint_malformed", "row_fingerprint_mismatch"];
  staged.sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
  findings.push(...staged);
  if (requireComplete && (record.copied ?? []).length !== manifest.size) {
    findings.push({ rule: "A′6", code: "copied_incomplete", detail: sortedList([...manifest.keys()].filter((k) => !copied.has(k))) });
  }
  if (findings.length > 0) return { status: "failed", findings: merge(findings) };
  if (missing) return { status: "evidence_required", missing: ["targetRowFingerprints"] };
  return { status: "passed" };
}

/**
 * §5.5's validation of a `copying`/`verified` record: complete eligible-set
 * equality with the manifest, then content equality per manifest key. Failures are
 * reported under the phase's row (E′7 for `copying`, E′8 for `verified`); an
 * unobtainable digest is I-1 and a malformed one I-7.
 */
export function validateSourceAgainstManifest(
  record: ActivationRecord,
  sourceEntries: readonly KeyObservation[],
  isWellFormed: FingerprintFormatPredicate
): EvidenceCheck {
  if (sourceEntries.some(({ key }) => isUnsupportedMigrationIdentityControlKey(key))) {
    return { status: "failed", findings: [{ rule: "C1", code: "unsupported_identity_control" }] };
  }
  const divergenceRule: DecisionRule = record.phase === "verified" ? "E′8" : "E′7";
  const manifest = manifestMap(record);
  const eligible = new Set(eligibleSourceKeys(sourceEntries));
  const byKey = new Map(sourceEntries.map((entry) => [entry.key, entry]));
  const readFindings: DecisionFinding[] = [];
  const divergence: DecisionFinding[] = [];
  let missing = false;
  const absentKeys = sortedList([...manifest.keys()].filter((key) => !eligible.has(key)));
  const newKeys = sortedList([...eligible].filter((key) => !manifest.has(key)));
  if (absentKeys.length > 0) divergence.push({ rule: divergenceRule, code: "source_key_missing", detail: absentKeys });
  if (newKeys.length > 0) divergence.push({ rule: divergenceRule, code: "source_key_new", detail: newKeys });
  for (const [key, expected] of [...manifest.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const entry = byKey.get(key);
    if (!entry) continue;
    const result = fingerprintFindings(entry, expected, isWellFormed, "source");
    if (result.missing) missing = true;
    if (!result.finding) continue;
    if (result.finding.code === "source_content_diverged") {
      divergence.push({ rule: divergenceRule, code: "source_content_diverged", detail: [key] });
    } else {
      readFindings.push(result.finding);
    }
  }
  const findings = [...readFindings, ...divergence];
  if (findings.length > 0) return { status: "failed", findings: merge(findings) };
  if (missing) return { status: "evidence_required", missing: ["sourceFingerprints"] };
  return { status: "passed" };
}

/**
 * One record's contribution to a latch's diagnostics. Only a record that passes
 * Groups A and A′ is carried — and then in its canonical form, which holds
 * identifiers, eligible key names, well-formed fingerprints, a strict timestamp and
 * the phase: migration metadata, never an application value. Anything else is
 * OMITTED and marked as such, with the failing rule identifiers only: an observed
 * record that matched neither expected state is exactly the record that cannot be
 * trusted to contain only metadata.
 */
export type LatchRecordDiagnostic =
  | { readonly status: "no_record" }
  /** No observed bytes are available: the record was not observed, or its read failed. */
  | { readonly status: "unreadable" }
  | { readonly status: "validated"; readonly record: string }
  | { readonly status: "omitted_invalid_metadata"; readonly failingRules: readonly string[] };

function latchRecordDiagnostic(
  bytes: string | null | undefined,
  isWellFormed: FingerprintFormatPredicate
): LatchRecordDiagnostic {
  if (bytes === undefined) return { status: "unreadable" };
  if (bytes === null) return { status: "no_record" };
  const evaluated = evaluateActivationRecord(bytes, isWellFormed);
  if (evaluated.ok) return { status: "validated", record: serializeActivationRecord(evaluated.record) };
  return { status: "omitted_invalid_metadata", failingRules: [...new Set(evaluated.findings.map((f) => f.rule))] };
}

/**
 * The diagnostic content of a fault latch (I-13): schema version, cause,
 * transaction kind, phase, and the issued before-, issued after- and observed
 * records — each as a {@link LatchRecordDiagnostic}. Row bytes are never included.
 */
export function buildFaultLatchContent(input: {
  readonly cause: "warm_state_matches_neither" | "confirmed_step_contradicted";
  readonly transactionKind: IssuedTransactionKind | null;
  readonly issuedBefore: string | null | undefined;
  readonly issuedAfter: string | null | undefined;
  readonly observed: string | null | undefined;
  readonly isWellFormedFingerprint: FingerprintFormatPredicate;
}): string {
  const issuedAfter = latchRecordDiagnostic(input.issuedAfter, input.isWellFormedFingerprint);
  const phase: MigrationPhase | null = issuedAfter.status === "validated"
    ? (JSON.parse(issuedAfter.record) as { phase: MigrationPhase }).phase
    : null;
  return JSON.stringify({
    schemaVersion: 1,
    cause: input.cause,
    transactionKind: input.transactionKind !== null && TRANSACTION_KINDS.includes(input.transactionKind)
      ? input.transactionKind
      : null,
    phase,
    issuedBefore: latchRecordDiagnostic(input.issuedBefore, input.isWellFormedFingerprint),
    issuedAfter,
    observed: latchRecordDiagnostic(input.observed, input.isWellFormedFingerprint),
  });
}

// ---------------------------------------------------------------------------
// Plans (symbolic; their effects are never performed here)
// ---------------------------------------------------------------------------

const PLAN = (name: PlanName, steps: PlanStep[]): MigrationPlan =>
  Object.freeze({ name, steps: Object.freeze(steps), continuation: "re_evaluate" as const });

function markerStep(markerAbsent: boolean, storeIdentity: string): PlanStep[] {
  return markerAbsent ? [{ kind: "marker_write", store: "source", storeIdentity: { existing: storeIdentity } }] : [];
}

function planD1(): MigrationPlan {
  return PLAN("D1", [{
    kind: "target_transaction",
    store: "target",
    transaction: { op: "create_fresh_active", generates: ["migrationId", "storeIdentity", "activatedAt"] },
  }]);
}

/** The shared tail of AP-D3 and AP-K1′: digest, re-check `entryKeys`, begin copying (I-6). */
function enumerationTail(entryKeys: readonly string[], offset: number): PlanStep[] {
  return [
    { kind: "read_source", fresh: true, purpose: "digest_eligible_set", keys: "current_eligible_set" },
    { kind: "recheck", fresh: true, check: "entry_keys_present", usesStep: offset, observes: "fresh_source_enumeration" },
    {
      kind: "target_transaction",
      store: "target",
      transaction: { op: "begin_copying", manifestFromStep: offset, mustContain: entryKeys },
    },
  ];
}

function planD3(entryKeys: readonly string[]): MigrationPlan {
  // Record first (I-4): the marker is step 2, issued only after step 1 is confirmed.
  return PLAN("AP-D3", [
    {
      kind: "target_transaction",
      store: "target",
      transaction: { op: "create_enumerating", entryKeys, generates: ["migrationId", "storeIdentity"] },
    },
    { kind: "marker_write", store: "source", storeIdentity: { generatedInStep: 0 } },
    ...enumerationTail(entryKeys, 2),
  ]);
}

function planK1(record: ActivationRecord, markerAbsent: boolean, entryKeys: readonly string[]): MigrationPlan {
  const marker = markerStep(markerAbsent, record.storeIdentity);
  return PLAN("AP-K1′", [
    ...marker,
    {
      kind: "target_transaction",
      store: "target",
      transaction: { op: "replace_enumerating", storeIdentity: record.storeIdentity, entryKeys, generates: ["migrationId"] },
    },
    ...enumerationTail(entryKeys, marker.length + 1),
  ]);
}

function planCopy(record: ActivationRecord, markerAbsent: boolean, batch: readonly string[]): MigrationPlan {
  const marker = markerStep(markerAbsent, record.storeIdentity);
  const read = marker.length;
  return PLAN("AP-COPY", [
    ...marker,
    { kind: "read_source", fresh: true, purpose: "digest_batch", keys: batch },
    { kind: "recheck", fresh: true, check: "batch_digests_match_manifest", usesStep: read, observes: "observations_of_step" },
    { kind: "target_transaction", store: "target", transaction: { op: "checkpoint", batch, rowBytesFromStep: read } },
  ]);
}

function planCC(record: ActivationRecord, markerAbsent: boolean): MigrationPlan {
  return PLAN("AP-CC", [
    ...markerStep(markerAbsent, record.storeIdentity),
    { kind: "target_transaction", store: "target", transaction: { op: "complete_copying", readsInside: "complete_target_evidence" } },
  ]);
}

function planACT(record: ActivationRecord, markerAbsent: boolean): MigrationPlan {
  const marker = markerStep(markerAbsent, record.storeIdentity);
  const read = marker.length;
  return PLAN("AP-ACT", [
    ...marker,
    // The source validation immediately before the transaction is a FRESH read (§5.5).
    { kind: "read_source", fresh: true, purpose: "validate_source", keys: "current_eligible_set" },
    { kind: "recheck", fresh: true, check: "source_set_and_content_valid", usesStep: read, observes: "observations_of_step" },
    {
      kind: "target_transaction",
      store: "target",
      transaction: { op: "activate", readsInside: "complete_target_evidence", generates: ["activatedAt"] },
    },
  ]);
}

function planLatch(content: string): MigrationPlan {
  return PLAN("AP-LATCH", [
    { kind: "target_transaction", store: "target", transaction: { op: "write_fault_latch", content } },
  ]);
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

const RETRYABLE: ReadonlySet<DecisionRule> = new Set(["L0a", "A1", "B1", "C1", "PV1", "PV3", "PV9", "PV10", "I-1"]);

function blocked(findings: readonly DecisionFinding[]): NativeMigrationDecision {
  const rule = findings[0].rule;
  return Object.freeze({
    kind: "blocked",
    rule,
    findings: Object.freeze(sanitizeFindings(merge([...findings]))),
    retryMayResolve: RETRYABLE.has(rule),
    mountsOrdinaryConsumers: false,
  });
}

function needs(missing: EvidenceName[]): NativeMigrationDecision {
  return Object.freeze({ kind: "evidence_required", missing: Object.freeze(missing), mountsOrdinaryConsumers: false });
}

function plan(rule: DecisionRule, chosen: MigrationPlan): NativeMigrationDecision {
  return Object.freeze({ kind: "plan", rule, plan: chosen, mountsOrdinaryConsumers: false });
}

function fault(findings: DecisionFinding[], stop: InProcessFaultStop, limit: number): NativeMigrationDecision {
  const confirmed = stop.latchWriteAttempts.includes("confirmed");
  const latchPlan = confirmed || stop.latchWriteAttempts.length >= limit ? null : planLatch(stop.latchContent);
  return Object.freeze({
    kind: "fault",
    rule: "I-13",
    findings: Object.freeze(sanitizeFindings(findings)),
    stop: Object.freeze({ latchContent: stop.latchContent, latchWriteAttempts: Object.freeze([...stop.latchWriteAttempts]) }),
    latchPlan,
    mountsOrdinaryConsumers: false,
  });
}

function recordBytesOf(observation: StoredValueObservation): string | null | undefined {
  // `undefined` = not comparable (read failed); `null` = positively no record.
  if (observation.status === "read_failed") return undefined;
  return observation.status === "absent" ? null : observation.bytes;
}

/**
 * Finding details carry eligible key names only. Every other string a snapshot can
 * supply — record field names, ineligible or foreign keys — is dropped, so no
 * untrusted content, application value or credential reaches a public diagnostic.
 */
function sanitizeFindings(findings: readonly DecisionFinding[]): DecisionFinding[] {
  return findings.map((finding) => {
    const safe = (finding.detail ?? []).filter((key) => isEligibleMigrationKey(key));
    const { detail: _dropped, ...rest } = finding;
    void _dropped;
    return Object.freeze(safe.length > 0 ? { ...rest, detail: Object.freeze(sortedList(new Set(safe))) } : rest);
  });
}

type RowState = "equal" | "different" | "absent" | "unknown" | "unobserved";

type WarmVerdict =
  | { readonly kind: "fault"; readonly findings: DecisionFinding[]; readonly content: string }
  | {
      /** No positive contradiction is provable from what was supplied. */
      readonly kind: "no_fault_proven";
      /** Issued rows whose observation was omitted: needed only if nothing else decides. */
      readonly missing: EvidenceName[];
      /** Issued rows whose read failed: never equality, never a fault. */
      readonly unreadable: DecisionFinding | null;
    };

/**
 * I-11's warm comparison and I-13's confirmed-step contradiction, over EXACT bytes:
 * the record bytes before and after, and every issued row's bytes against the row's
 * observed bytes. Equal digests are not equal bytes.
 *
 * Each candidate outcome of an unknown transaction — the issued before-state (the
 * before-record, and none of the inserted rows present) and the issued after-state
 * (the after-record, and every inserted row present with its issued bytes) — stays
 * possible until a SUCCESSFUL observation excludes it. Every supplied observation is
 * consulted on its own, so no exclusion depends on another observation being
 * readable:
 * - observed record bytes (or a positively absent record) exclude every candidate
 *   whose record they are not;
 * - an inserted row's exact observed bytes: equal excludes the before-state, absent
 *   excludes the after-state, different bytes exclude both;
 * - a successful complete target listing (I-2), by key presence alone: a listed
 *   inserted key excludes the before-state, an unlisted one the after-state. Key
 *   presence or absence needs no row value; only an after-state's VALUES do.
 * When both candidates are excluded the fault is proven, whatever else is omitted
 * or unreadable. The same observations prove a confirmed step contradicted: a
 * confirmed row positively absent (by value or by the listing) or different, or a
 * record other than the last confirmed one. An omitted or failed observation
 * excludes nothing — it is neither absence nor equality, and never a fault.
 */
function warmVerdict(
  surviving: SurvivingPlanEvidence,
  record: StoredValueObservation | undefined,
  targetRows: KeyListingObservation | undefined,
  rowValues: readonly RowValueObservation[] | undefined,
  isWellFormed: FingerprintFormatPredicate
): WarmVerdict {
  const tx = surviving.unknownTransaction;
  const values = new Map((rowValues ?? []).map((row) => [row.key, row.value]));
  const state = (row: IssuedRow): RowState => {
    const value = values.get(row.key);
    if (value === undefined) return "unobserved";
    if (value.status === "read_failed") return "unknown";
    if (value.status === "absent") return "absent";
    return value.bytes === row.bytes ? "equal" : "different";
  };
  // `undefined` = no complete listing (omitted or failed): it proves neither presence nor absence.
  const listed = targetRows?.status === "listed" ? new Set(targetRows.entries.map((entry) => entry.key)) : undefined;
  const listedPresent = (row: IssuedRow) => listed !== undefined && listed.has(row.key);
  const listedAbsent = (row: IssuedRow) => listed !== undefined && !listed.has(row.key);
  // A row is positively present (excluding a before-state in which it is absent) or
  // positively not there with its issued bytes (excluding an after-state).
  const provenPresent = (row: IssuedRow) => { const s = state(row); return s === "equal" || s === "different" || listedPresent(row); };
  const provenNotIssuedBytes = (row: IssuedRow) => { const s = state(row); return s === "absent" || s === "different" || listedAbsent(row); };
  // `undefined` = record not observed or unreadable: it excludes no candidate.
  const observed = record === undefined ? undefined : recordBytesOf(record);

  const inserted = tx?.insertedRows ?? [];
  const afterPossible = !tx ||
    ((observed === undefined || observed === tx.recordAfter) && !inserted.some(provenNotIssuedBytes));
  const beforePossible = !tx ||
    ((observed === undefined || observed === tx.recordBefore) && !inserted.some(provenPresent));
  if (tx && !afterPossible && !beforePossible) {
    return {
      kind: "fault",
      findings: [{ rule: "I-11", code: "warm_state_matches_neither" }],
      content: buildFaultLatchContent({
        cause: "warm_state_matches_neither",
        transactionKind: tx.kind,
        issuedBefore: tx.recordBefore,
        issuedAfter: tx.recordAfter,
        observed,
        isWellFormedFingerprint: isWellFormed,
      }),
    };
  }

  const contradicted = surviving.confirmedRows.filter(provenNotIssuedBytes).map((row) => row.key);
  const recordContradicted = !tx && surviving.lastConfirmedRecord !== undefined && observed !== undefined &&
    observed !== surviving.lastConfirmedRecord;
  if (contradicted.length > 0 || recordContradicted) {
    return {
      kind: "fault",
      findings: [{ rule: "I-13", code: "confirmed_step_contradicted", ...(contradicted.length ? { detail: contradicted } : {}) }],
      content: buildFaultLatchContent({
        cause: "confirmed_step_contradicted",
        transactionKind: null,
        issuedBefore: null,
        issuedAfter: surviving.lastConfirmedRecord ?? null,
        observed,
        isWellFormedFingerprint: isWellFormed,
      }),
    };
  }

  // No fault is provable. What would still be needed to CLASSIFY the outcome? An
  // issued row's exact bytes — except an inserted row whose key the listing proves
  // absent once the after-state is excluded: the before-state needs only absence.
  const issued = [...inserted, ...surviving.confirmedRows];
  const settledWithoutValue = (row: IssuedRow) => !afterPossible && listedAbsent(row) && inserted.includes(row);
  const unobserved = issued.some((row) => state(row) === "unobserved" && !settledWithoutValue(row));
  const unreadable = issued.filter((row) => state(row) === "unknown").map((row) => row.key);
  return {
    kind: "no_fault_proven",
    missing: unobserved ? ["targetRowValues"] : [],
    unreadable: unreadable.length > 0 ? { rule: "I-1", code: "warm_row_bytes_unreadable", detail: unreadable } : null,
  };
}

function retirementDisposition(
  record: ActivationRecord,
  source: KeyListingObservation | undefined,
  isWellFormed: FingerprintFormatPredicate
): RetirementDisposition {
  const retirement = record.sourceRetirement;
  if (!retirement || retirement.state === "complete") return { state: "complete" };
  if (!source) return { state: "not_evaluated", reason: "source_not_observed" };
  if (source.status === "read_failed") return { rule: "B2", state: "stalled", reason: "source_unreadable" };
  const removed = new Set(retirement.removedKeys);
  const manifest = manifestMap(record);
  const present = new Map(source.entries.map((entry) => [entry.key, entry]));
  const candidates = (record.copied ?? []).filter((key) => !removed.has(key) && present.has(key)).sort();
  if (candidates.length === 0) return { rule: "B2", state: "stalled", reason: "source_missing" };
  const deletable: string[] = [];
  const retainChanged: string[] = [];
  const unverifiable: string[] = [];
  for (const key of candidates) {
    const fp = present.get(key)?.fingerprint;
    if (!fp || fp.status !== "computed" || !safeFormat(isWellFormed, fp.value)) unverifiable.push(key);
    else if (fp.value === manifest.get(key)) deletable.push(key);
    else retainChanged.push(key);
  }
  return { rule: "B3", state: "resume", deletable, retainChanged, unverifiable };
}

type MarkerReading =
  | { readonly kind: "absent" }
  | { readonly kind: "valid"; readonly id: string }
  | { readonly kind: "read_failed" }
  | { readonly kind: "malformed" };

function readMarker(marker: StoredValueObservation): MarkerReading {
  if (marker.status === "read_failed") return { kind: "read_failed" };
  if (marker.status === "absent") return { kind: "absent" };
  return isCanonicalUuid(marker.bytes) ? { kind: "valid", id: marker.bytes } : { kind: "malformed" };
}

/** The table, from durable evidence alone (L0 → A → A′ → B → C → provenance → E′). */
function decideFromDurableState(ev: NativeMigrationEvidence, opts: NativeMigrationDecisionOptions): NativeMigrationDecision {
  const isWellFormed = opts.isWellFormedFingerprint;

  // L0 — the durable latch, before the record is interpreted.
  if (!ev.latch) return needs(["latch"]);
  if (ev.latch.status === "read_failed") return blocked([{ rule: "L0a", code: "latch_read_failed" }]);
  if (ev.latch.status === "present") return blocked([{ rule: "L0b", code: "latch_present" }]);

  // Group A and A′ — the record only. Nothing below interprets an invalid record.
  if (!ev.record) return needs(["record"]);
  if (ev.record.status === "read_failed") return blocked([{ rule: "A1", code: "record_read_failed" }]);
  let record: ActivationRecord | null = null;
  if (ev.record.status === "present") {
    const evaluated = evaluateActivationRecord(ev.record.bytes, isWellFormed);
    if (!evaluated.ok) return blocked(evaluated.findings);
    record = evaluated.record;
  }

  // Group B — `active`: record metadata and the target's CURRENT health. Any supplied
  // current target failure is B1, whatever a health summary says; neither source nor
  // marker gates access, and live rows are never compared with the manifest.
  if (record && record.phase === "active") {
    if (!ev.targetHealth) return needs(["targetHealth"]);
    const failures: DecisionFinding[] = [];
    if (ev.targetHealth.status === "failing") failures.push({ rule: "B1", code: "target_failing" });
    if (ev.targetRows?.status === "read_failed") failures.push({ rule: "B1", code: "target_rows_read_failed" });
    if (ev.targetRowValues?.some((row) => row.value.status === "read_failed")) {
      failures.push({ rule: "B1", code: "target_row_value_read_failed" });
    }
    if (failures.length > 0) return blocked(failures);
    return Object.freeze({
      kind: "access",
      rule: "B4",
      mountsOrdinaryConsumers: true,
      retirement: Object.freeze(retirementDisposition(record, ev.source, isWellFormed)),
    });
  }

  // From here on every row whose evidence is present is evaluated; the first
  // finding in canonical order governs, and the others are reported with it. A row
  // is reported only when its complete guard holds.
  const missing: EvidenceName[] = [];
  if (!ev.source) missing.push("source");
  if (!ev.targetRows) missing.push("targetRows");
  if (!ev.marker) missing.push("marker");
  if (missing.length > 0) return needs(missing);
  const source = ev.source!;
  const rows = ev.targetRows!;
  const marker = readMarker(ev.marker!);
  const sourceEntries = source.status === "listed" ? source.entries : null;
  // Preserve known denial controls; unsupported members cannot be discarded.
  if (sourceEntries?.some(({ key }) => isUnsupportedMigrationIdentityControlKey(key))) {
    return blocked([{ rule: "C1", code: "unsupported_identity_control" }]);
  }
  const eligible = sourceEntries ? eligibleSourceKeys(sourceEntries) : null;

  // Group C — a failed source enumeration is never an empty source.
  const findings: DecisionFinding[] = [];
  if (!sourceEntries) findings.push({ rule: "C1", code: "source_enumeration_failed" });

  // Provenance table, no record: PV1–PV7. PV3–PV5 require an EMPTY target.
  if (!record) {
    if (rows.status === "read_failed") {
      findings.push({ rule: "PV1", code: "target_rows_read_failed" });
    } else if (rows.entries.length > 0) {
      findings.push({ rule: "PV2", code: "target_rows_without_record", detail: rows.entries.map((r) => r.key) });
    } else if (marker.kind === "read_failed") {
      findings.push({ rule: "PV3", code: "marker_read_failed" });
    } else if (marker.kind === "malformed") {
      findings.push({ rule: "PV4", code: "marker_malformed" });
    } else if (marker.kind === "valid") {
      findings.push({ rule: "PV5", code: "marker_without_record" });
    }
    if (findings.length > 0 || !eligible) return blocked(findings);
    return eligible.length === 0 ? plan("PV6", planD1()) : plan("PV7", planD3(eligible));
  }

  // Provenance table, pre-`active` record: PV8–PV12.
  if (!isCanonicalUuid(record.storeIdentity)) findings.push({ rule: "PV8", code: "store_identity_invalid" });
  if (rows.status === "read_failed") findings.push({ rule: "PV9", code: "target_rows_read_failed" });
  if (marker.kind === "read_failed") findings.push({ rule: "PV10", code: "marker_read_failed" });
  if (marker.kind === "malformed") findings.push({ rule: "PV11", code: "marker_malformed" });
  if (marker.kind === "valid" && marker.id !== record.storeIdentity) findings.push({ rule: "PV12", code: "marker_foreign" });

  // Group E′ — staging needs readable rows; divergence needs a readable source. Each
  // is checked whenever its own evidence is readable, independently of the other.
  const evidenceMissing: EvidenceName[] = [];
  if (record.phase === "enumerating") {
    if (rows.status === "listed" && rows.entries.length > 0) {
      findings.push({ rule: "E′1", code: "rows_while_enumerating", detail: rows.entries.map((r) => r.key) });
    }
    if (eligible) {
      const vanished = (record.entryKeys ?? []).filter((key) => !eligible.includes(key));
      if (vanished.length > 0) findings.push({ rule: "E′5", code: "entry_key_vanished", detail: vanished });
    }
  } else {
    if (rows.status === "listed") {
      const target = checkTargetEvidence(record, rows.entries, isWellFormed, false);
      if (target.status === "failed") findings.push(...target.findings);
      if (target.status === "evidence_required") evidenceMissing.push(...target.missing);
    }
    if (sourceEntries) {
      const validation = validateSourceAgainstManifest(record, sourceEntries, isWellFormed);
      if (validation.status === "failed") findings.push(...validation.findings);
      if (validation.status === "evidence_required") evidenceMissing.push(...validation.missing);
    }
  }
  if (findings.length > 0) return blocked(findings);
  if (evidenceMissing.length > 0) return needs(evidenceMissing);
  if (rows.status !== "listed" || !eligible) return blocked([{ rule: "E′12", code: "unspecified_state" }]);
  const markerAbsent = marker.kind === "absent";

  switch (record.phase) {
    case "enumerating":
      return plan("E′6", planK1(record, markerAbsent, eligible));
    case "copying": {
      const copied = new Set(record.copied ?? []);
      const remaining = (record.manifest ?? []).map((entry) => entry.key).filter((key) => !copied.has(key)).sort();
      if (remaining.length > 0) {
        return plan("E′9", planCopy(record, markerAbsent, remaining.slice(0, opts.checkpointBatchKeyLimit)));
      }
      return plan("E′10", planCC(record, markerAbsent));
    }
    case "verified":
      return plan("E′11", planACT(record, markerAbsent));
    default:
      return blocked([{ rule: "E′12", code: "unspecified_state" }]);
  }
}

/**
 * Evaluates one evidence snapshot. Deterministic, synchronous, and free of side
 * effects: the same snapshot always yields the same result, and no state survives
 * between calls. Inputs are never mutated.
 */
export function decideNativeMigration(evidence: unknown, options: unknown): NativeMigrationDecision {
  const problems = evidenceProblems(evidence, options);
  if (problems.length > 0) {
    return Object.freeze({ kind: "invalid_evidence", problems: Object.freeze(problems), mountsOrdinaryConsumers: false });
  }
  const ev = evidence as NativeMigrationEvidence;
  const opts = options as NativeMigrationDecisionOptions;

  // I-13: a fault this process already detected stops everything, before any durable read.
  if (ev.inProcessFault) {
    return fault([{ rule: "I-13", code: "in_process_fault_stop" }], ev.inProcessFault, opts.latchWriteAttemptLimit);
  }

  // I-11/I-13: a surviving process's POSITIVE contrary evidence overrides the table,
  // and is examined with whatever observations were supplied — no unrelated omission
  // may hide it.
  const verdict = ev.survivingPlan
    ? warmVerdict(ev.survivingPlan, ev.record, ev.targetRows, ev.targetRowValues, opts.isWellFormedFingerprint)
    : null;
  if (verdict?.kind === "fault") {
    return fault(verdict.findings, { latchContent: verdict.content, latchWriteAttempts: [] }, opts.latchWriteAttemptLimit);
  }

  // Otherwise the durable table decides first. A stop it establishes — L0a/L0b above
  // all, then A, B1, C, PV and E′ — governs; incomplete or unreadable warm evidence
  // can never override it, and an unreadable warm row is only reported alongside.
  const decision = decideFromDurableState(ev, opts);
  if (!verdict) return decision;
  if (decision.kind === "blocked") {
    return verdict.unreadable ? blocked([...decision.findings, verdict.unreadable]) : decision;
  }
  // The table would permit something (or needs more evidence). Warm evidence that
  // cannot be classified prevents it: an unreadable issued row blocks under I-1, and
  // an omitted one is requested.
  if (verdict.unreadable) return blocked([verdict.unreadable]);
  if (verdict.missing.length > 0) {
    const tableMissing = decision.kind === "evidence_required" ? decision.missing : [];
    return needs([...new Set([...tableMissing, ...verdict.missing])]);
  }
  return decision;
}
