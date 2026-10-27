// The native-migration runner — Stage M3b4b.
//
// Executes the approved migration (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §5)
// against a real source and target, one explicitly invoked `run()` at a time.
// It is DORMANT: no application startup path or composition constructs or calls
// it. Stage M3b4c's recovery session drives a runner handed to it by whoever
// assembled it, and no shipped path assembles one; the production activation
// authority still reports `unavailable` (`__tests__/architectureBoundary.test.ts`). Reaching §5.4's B4 here yields the
// symbolic access disposition only — never a `NativeActivationVerdict`, never a
// claim on identity or credential storage, never a mounted application.
//
// ## What decides, and what only executes
//
// `decideNativeMigration` (M3b4a) is the ONLY decision authority. This module
// collects evidence, asks it, executes exactly the plan it returns, and asks
// again from fresh evidence after every completed plan. It holds no second
// decision table. Its only state of its own is I-11's plan memory — the exact
// issued record bytes and inserted row bytes, kept transiently — and I-13's
// in-process fault stop.
//
// ## Lifecycle
//
// One runner owns one migration lease on one target for its lifetime:
//   - concurrent `run()` calls join the one in flight; nothing runs twice;
//   - a halt returns control. The NEXT explicit `run()` reopens the target
//     (close, native release, fresh open — each established) before it reads
//     anything, and evaluates again with the surviving plan memory;
//   - a detected fault (I-13) stops ordinary work for the process's lifetime: the
//     only write afterwards is the bounded AP-LATCH transaction, and the runner
//     never gives up its lease, so no other runner can resume behind the stop;
//   - `dispose()` lets an in-flight bridge call answer, issues nothing further,
//     and releases the lease only once ownership is positively free — an
//     unanswered call never releases it.
// A new runner is a cold start: it carries none of an earlier runner's memory
// and never reconstructs lost intent.
//
// ## What it does NOT do
//
// No recovery interface (Stage M3b4c's dependency-injected presentation layer
// consumes this module's reports; it is not part of this module); no latch
// clearing; no source retirement or deletion; no credential transfer; no
// activation verdict; no default fingerprint — the digest is injected (I-7
// leaves the algorithm open).
//
// ## Observability (Stage M3b4c)
//
// A halted plan's report names the cause its failing step ALREADY observed
// (`PlanHalt.observed`), and a blocked or access report names the phase of the
// validated record its decision was made from (`recordPhase`). Both are fixed
// codes derived from values this module had already obtained. They add no
// read, write, digest or reopen, change no decision and no call order, and
// carry no key name, value, record byte or identifier
// (`__tests__/nativeMigrationObservability.test.ts`).
import { borrowNativeMigrationTarget, borrowNativeCombinedHeldHost, borrowNativeCommonMigrationHost, evaluateBorrowedFingerprintFormat, nativeCommonMigrationControlCurrent, type NativeBorrowCapability } from "./nativeMigrationBorrowEvidence";
import { isCanonicalUuid } from "../uuid";
import type { MigrationSourceStore } from "./localStorageAdapter";
import type {
  NativeMigrationLease,
  NativeMigrationControl,
  NativeCombinedHeldSqliteHost,
  NativeMigrationRefusal,
  NativeMigrationTransaction,
  NativeMigrationTransactionResult,
  NativeSqliteMigrationTarget,
} from "./nativeSqliteAdapter";
import {
  checkTargetEvidence,
  decideNativeMigration,
  validateSourceAgainstManifest,
  type DecisionFinding,
  type DecisionRule,
  type EvidenceName,
  type IssuedRow,
  type IssuedTransactionKind,
  type KeyObservation,
  type LatchWriteAttempt,
  type InProcessFaultStop,
  type MigrationPlan,
  type NativeMigrationDecisionOptions,
  type NativeMigrationEvidence,
  type PlanName,
  type PlanStep,
  type RetirementDisposition,
  type SurvivingPlanEvidence,
  type UnknownOutcomeTransaction,
} from "./nativeMigrationDecision";
import { classifyMigrationSourceKey, isUnsupportedMigrationIdentityControlKey } from "./nativeMigrationEligibility";
import {
  collectNativeMigrationEvidence,
  digestValue,
  type NativeMigrationFingerprint,
} from "./nativeMigrationEvidence";
import {
  recordLatchWriteAttempt,
  summarizePlanRun,
  type PlanRunReport,
  type StepDisposition,
  type StepOutcome,
} from "./nativeMigrationPlanOutcome";
import {
  buildRecordAfter,
  evaluateActivationRecord,
  safeFormat,
  type ActivationRecord,
  type FingerprintFormatPredicate,
  type RecordTransition,
} from "./nativeMigrationRecord";

/** Engineering bounds (not product policy). Each a positive integer. */
export interface NativeMigrationLimits {
  readonly checkpointBatchKeyLimit: number;
  readonly latchWriteAttemptLimit: number;
  /** The most plans one `run()` completes before returning. Reaching it is NOT success. */
  readonly maxPlansPerRun: number;
}

export interface NativeMigrationRunnerDependencies {
  readonly source: MigrationSourceStore;
  readonly target: NativeSqliteMigrationTarget;
  /** The injected digest (I-7). There is no default. */
  readonly fingerprint: NativeMigrationFingerprint;
  readonly isWellFormedFingerprint: FingerprintFormatPredicate;
  /** A canonical UUID per call, or a throw. Never a fabricated fallback. */
  readonly generateUuid: () => string;
  /** A strict UTC ISO-8601 timestamp, or a throw. */
  readonly now: () => string;
  readonly limits: NativeMigrationLimits;
}

export interface CompletedPlan {
  readonly name: PlanName;
  readonly rule: DecisionRule;
  /** Set when a marker step found the marker already equal and wrote nothing. */
  readonly markerAlreadyMatching?: true;
}

/** What a marker step did, in fixed codes. */
export type MarkerAccount =
  | { readonly step: number; readonly status: "written" | "already_matching" | "write_failed" }
  | { readonly step: number; readonly status: "refused"; readonly reason: "marker_present" | "marker_unreadable" };

/** A target transaction's result, reduced to fixed codes for a report. */
export type TransactionAccount =
  | { readonly step: number; readonly status: "confirmed" | "outcome_unknown" }
  | { readonly step: number; readonly status: "refused"; readonly reason: NativeMigrationRefusal }
  | { readonly step: number; readonly status: "not_begun" }
  | {
      readonly step: number;
      readonly status: "not_committed";
      readonly reason: string;
      readonly writeIssued: boolean;
      readonly connection: "clean" | "uncertain";
    };

/**
 * The cause a failed read, a failed recheck or an AP-CC/AP-ACT evidence check
 * had ALREADY observed when the plan halted (Stage M3b4c observability). Fixed
 * codes only: never a key name, value or digest. It distinguishes what the
 * outer disposition (`failed`, `aborted_before_write`) cannot — an unavailable
 * read from a positively observed difference.
 */
export type HaltObservation =
  /** A read step's source enumeration did not succeed. */
  | "source_listing_failed"
  /** A fresh inventory contains an unsupported owned denial-control member. */
  | "unsupported_identity_control"
  /** A source value read did not succeed. */
  | "source_value_unreadable"
  /** A key listed by this step's own enumeration then read as absent. */
  | "listed_value_absent"
  /** A key the plan named (a manifest batch key) read as positively absent. */
  | "planned_value_absent"
  /** The injected digest produced no value. */
  | "digest_unavailable"
  /** The injected digest produced a value that is not a well-formed fingerprint. */
  | "digest_malformed"
  /** The entry-key recheck's fresh enumeration did not succeed. */
  | "recheck_enumeration_failed"
  /** The entry-key recheck positively found an `entryKeys` key missing. */
  | "entry_key_missing"
  /** A checkpoint batch's digests positively differ from the manifest (I-7). */
  | "batch_digest_mismatch"
  /** §5.5's set or content validation positively diverged. */
  | "source_validation_diverged"
  /** §5.5's validation could not be completed from the obtained digests. */
  | "source_validation_unavailable"
  /** The recheck could not be evaluated from the plan's own inputs. */
  | "recheck_not_evaluable"
  /** AP-CC/AP-ACT: the in-transaction evidence positively did not match. */
  | "target_evidence_mismatch"
  /** AP-CC/AP-ACT: the in-transaction evidence could not be digested completely. */
  | "target_evidence_unavailable";

/** The phase of the validated record a decision was made from, or `no_record`
 * when the record was positively absent. Omitted when not positively known. */
export type RecordPhaseObservation = "no_record" | ActivationRecord["phase"];

export type PlanHalt =
  /** The plan's own halt report (I-9): every step's disposition. */
  | { readonly kind: "plan_run"; readonly report: PlanRunReport; readonly observed?: HaltObservation }
  /**
   * A step that was NEVER ISSUED: its inputs could not be prepared (a UUID, a
   * timestamp, a checked read), the target refused before BEGIN, or the runner
   * was disposed. Distinct from an issued write whose outcome is unknown.
   */
  | {
      readonly kind: "not_issued";
      readonly step: number;
      /** `precondition_failed`: the marker step's write-time check refused (a
       * foreign, malformed or unreadable marker) — never overwritten. */
      readonly cause: "preparation_failed" | "target_unavailable" | "precondition_failed" | "disposed";
      readonly dispositions: readonly StepDisposition[];
    };

export type LatchAccount = {
  readonly attempts: readonly LatchWriteAttempt[];
  /** `confirmed`: this runner's write was acknowledged; `already_present`: a
   * latch was found present inside the latch transaction; `null`: not established. */
  readonly established: "confirmed" | "already_present" | null;
  /** Whether a further bounded attempt remains for a later `run()`. */
  readonly attemptsRemain: boolean;
};

/**
 * One run's outcome. Every member carries fixed codes, rule identifiers and
 * eligible key names only — never an application value, a credential, record
 * bytes or a bridge error. None of them mounts anything.
 */
export type NativeMigrationRunReport = { readonly completedPlans: readonly CompletedPlan[] } & (
  | { readonly outcome: "access"; readonly rule: "B4"; readonly retirement: RetirementDisposition; readonly recordPhase?: RecordPhaseObservation }
  | {
      readonly outcome: "blocked";
      readonly rule: DecisionRule;
      readonly findings: readonly DecisionFinding[];
      readonly retryMayResolve: boolean;
      readonly recordPhase?: RecordPhaseObservation;
    }
  | { readonly outcome: "evidence_required"; readonly missing: readonly EvidenceName[] }
  | { readonly outcome: "invalid_evidence"; readonly problems: readonly string[] }
  | {
      readonly outcome: "halted";
      readonly plan: PlanName;
      readonly rule: DecisionRule;
      readonly halt: PlanHalt;
      readonly transaction: TransactionAccount | null;
      readonly marker: MarkerAccount | null;
    }
  | { readonly outcome: "fault"; readonly findings: readonly DecisionFinding[]; readonly latch: LatchAccount }
  /** `maxPlansPerRun` was reached while migration was still incomplete. */
  | { readonly outcome: "bound_reached" }
  /** A required reopen did not complete; no evidence was read. */
  | { readonly outcome: "reopen_failed"; readonly boundary: "refused" | "close" | "release" | "open" }
  | { readonly outcome: "target_refused"; readonly reason: NativeMigrationRefusal }
  /**
   * The runner was disposed. Nothing further was issued once that was seen. If a
   * plan was underway, `halt` accounts for every step and `transaction` reports a
   * target transaction's REAL outcome — a COMMIT already issued is never
   * presented as undone. A disposed run never reports access.
   */
  | {
      readonly outcome: "disposed";
      readonly plan?: PlanName;
      readonly halt?: PlanHalt;
      readonly transaction?: TransactionAccount | null;
      readonly marker?: MarkerAccount | null;
    }
);

export type NativeMigrationDisposeResult =
  | { readonly ok: true }
  /** Ownership could not be positively freed; the lease is KEPT. */
  | { readonly ok: false; readonly boundary: "close" | "release" }
  /**
   * A fault was detected (I-13). The lease is KEPT for the life of the process,
   * so no other runner can acquire this target and resume migration behind the
   * in-process stop; only a new process — reading the durable latch — re-evaluates.
   */
  | { readonly ok: false; readonly reason: "fault_stop_held" }
  /**
   * The runner holds I-11 plan evidence a cold evaluation would lack — an
   * unresolved unknown outcome, or writes no completed evaluation has checked
   * since. Releasing would let another runner in this SAME live context evaluate
   * cold in its place, which is not the permitted cold-start residual. The lease
   * is kept; an explicit `run()` evaluates the evidence, or a new process starts
   * without it.
   */
  | { readonly ok: false; readonly reason: "plan_evidence_held" };

export interface NativeMigrationRunner {
  run(): Promise<NativeMigrationRunReport>;
  dispose(): Promise<NativeMigrationDisposeResult>;
}

/** What one read step obtained: the listing it saw and the exact, checked values. */
interface CapturedRead {
  readonly listing: readonly KeyObservation[];
  readonly values: ReadonlyMap<string, { readonly bytes: string; readonly fingerprint: string }>;
}

/** I-11's plan memory: kept for the runner's lifetime, never across a new runner. */
interface PlanMemory {
  unknownTransaction?: UnknownOutcomeTransaction;
  confirmedRows: IssuedRow[];
  lastConfirmedRecord?: string;
}

type PlanExecution =
  | { readonly status: "completed"; readonly markerAlreadyMatching: boolean }
  | { readonly status: "prepared"; readonly report: NativeHeldDomainRunReport }
  | {
      readonly status: "halted" | "disposed";
      readonly halt: PlanHalt;
      readonly transaction: TransactionAccount | null;
      readonly marker: MarkerAccount | null;
    };

function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function parsedRecord(bytes: string | null, isWellFormed: FingerprintFormatPredicate): ActivationRecord | null | undefined {
  if (bytes === null) return null;
  const evaluated = evaluateActivationRecord(bytes, isWellFormed);
  return evaluated.ok ? evaluated.record : undefined;
}

/**
 * The phase of the record a decision was made from (Stage M3b4c observability):
 * `no_record` for a positively absent record, the phase of a record that passes
 * Groups A and A′, and `undefined` otherwise — a failed, unobserved or invalid
 * record is never given a phase. Pure: no I/O, and a throwing predicate yields
 * `undefined` rather than altering the run.
 */
function observedRecordPhase(
  evidence: NativeMigrationEvidence,
  isWellFormed: FingerprintFormatPredicate
): RecordPhaseObservation | undefined {
  const record = evidence.record;
  if (!record || record.status === "read_failed") return undefined;
  if (record.status === "absent") return "no_record";
  try {
    return parsedRecord(record.bytes, isWellFormed)?.phase;
  } catch {
    return undefined;
  }
}

function account(step: number, result: NativeMigrationTransactionResult): TransactionAccount {
  switch (result.status) {
    case "confirmed":
    case "outcome_unknown":
      return { step, status: result.status };
    case "refused":
      return { step, status: "refused", reason: result.reason };
    case "not_begun":
      return { step, status: "not_begun" };
    case "not_committed":
      return { step, status: "not_committed", reason: result.reason, writeIssued: result.writeIssued, connection: result.connection };
  }
}

declare const domainHoldBrand: unique symbol;
/** Opaque observation only. There is no consume/finalize/write capability. */
export type NativeDomainHold = { readonly [domainHoldBrand]: true };
export type NativeHeldDomainRunReport = Exclude<NativeMigrationRunReport, { readonly outcome: "access" }> |
  { readonly outcome: "held"; readonly preparation: "fresh" | "verified"; readonly hold: NativeDomainHold; readonly completedPlans: readonly CompletedPlan[] } |
  { readonly outcome: "parent_recovery_required" | "active_refused" | "preparation_changed" | "parent_busy"; readonly completedPlans: readonly CompletedPlan[] };
export interface NativeHeldDomainMigrationRunner {
  run(control?: NativeMigrationControl): Promise<NativeHeldDomainRunReport>;
  dispose(): Promise<NativeMigrationDisposeResult>;
  isCurrentHold(hold: unknown): boolean;
}

export function createNativeMigrationRunner(deps: NativeMigrationRunnerDependencies): NativeMigrationRunner {
  const runner = buildNativeMigrationRunner(deps, null);
  // The standalone mode has no held branches. Its public contract is unchanged.
  return { run: runner.run as () => Promise<NativeMigrationRunReport>, dispose: runner.dispose };
}

/** Separate dormant S3d entry point. Borrow only an authentic, already-held lease. */
export function createNativeHeldDomainMigrationRunner(
  deps: NativeMigrationRunnerDependencies & { readonly lease: NativeMigrationLease }
): { readonly ok: true; readonly runner: NativeHeldDomainMigrationRunner } |
   { readonly ok: false; readonly reason: "invalid_dependency" | "unregistered_target" | "wrong_lease" | "requires_reopen" | "borrowed_evidence_held" } {
  let captured: NativeMigrationRunnerDependencies;
  let parentLease: NativeMigrationLease;
  try {
    captured = { source: deps.source, target: deps.target, fingerprint: deps.fingerprint,
      isWellFormedFingerprint: deps.isWellFormedFingerprint, generateUuid: deps.generateUuid,
      now: deps.now, limits: { ...deps.limits } };
    parentLease = deps.lease;
    validateRunnerDependencies(captured);
  } catch { return { ok: false, reason: "invalid_dependency" }; }
  const borrowed = borrowNativeMigrationTarget(captured.target, parentLease);
  if (!borrowed.ok) return borrowed;
  return { ok: true, runner: buildNativeMigrationRunner({ ...captured, target: borrowed.capability.target }, borrowed.capability) as NativeHeldDomainMigrationRunner };
}

/** S3e: no caller target is accepted or returned. Exact host registration owns it. */
export function createNativeCombinedHeldDomainMigrationRunner(
  deps: Omit<NativeMigrationRunnerDependencies, "target"> & { readonly host: NativeCombinedHeldSqliteHost; readonly lease: NativeMigrationLease }
) {
  return createCombinedHeldRunner(deps, false);
}
/** S3f private common role; the ordinary S3e entry cannot borrow this host. */
export function createNativeCommonHeldDomainMigrationRunner(
  deps: Omit<NativeMigrationRunnerDependencies, "target"> & { readonly host: NativeCombinedHeldSqliteHost; readonly lease: NativeMigrationLease }
) {
  return createCombinedHeldRunner(deps, true);
}
function createCombinedHeldRunner(
  deps: Omit<NativeMigrationRunnerDependencies, "target"> & { readonly host: NativeCombinedHeldSqliteHost; readonly lease: NativeMigrationLease }, common: boolean
) {
  let captured: NativeMigrationRunnerDependencies, host: NativeCombinedHeldSqliteHost, parentLease: NativeMigrationLease;
  try {
    host = deps.host; parentLease = deps.lease;
    captured = { source: deps.source, target: host as unknown as NativeSqliteMigrationTarget,
      fingerprint: deps.fingerprint, isWellFormedFingerprint: deps.isWellFormedFingerprint,
      generateUuid: deps.generateUuid, now: deps.now, limits: { ...deps.limits } };
    validateRunnerDependencies(captured);
  } catch { return { ok: false as const, reason: "invalid_dependency" as const }; }
  const borrowed = common ? borrowNativeCommonMigrationHost(host, parentLease) : borrowNativeCombinedHeldHost(host, parentLease);
  if (!borrowed.ok) return borrowed;
  return { ok: true as const, runner: buildNativeMigrationRunner({ ...captured, target: borrowed.capability.target }, borrowed.capability) as NativeHeldDomainMigrationRunner };
}

type InternalRunReport = NativeMigrationRunReport | NativeHeldDomainRunReport;
function validateRunnerDependencies(deps: NativeMigrationRunnerDependencies): void {
  if (
    !deps || typeof deps.fingerprint !== "function" || typeof deps.isWellFormedFingerprint !== "function" ||
    typeof deps.generateUuid !== "function" || typeof deps.now !== "function" || !deps.source || !deps.target ||
    !deps.limits || !positiveInteger(deps.limits.checkpointBatchKeyLimit) ||
    !positiveInteger(deps.limits.latchWriteAttemptLimit) || !positiveInteger(deps.limits.maxPlansPerRun)
  ) {
    throw new TypeError("The migration runner needs every dependency, including an injected fingerprint and positive bounds.");
  }
}

function buildNativeMigrationRunner(deps: NativeMigrationRunnerDependencies, borrowed: NativeBorrowCapability | null) {
  validateRunnerDependencies(deps);
  const { source, target, fingerprint, isWellFormedFingerprint: rawIsWellFormed, generateUuid, now, limits } = deps;
  function isWellFormed(value: string): boolean {
    // Pure helpers may test several fingerprints in one turn. Never issue a
    // second foreign predicate after the first superseded the parent lifecycle.
    return borrowed ? alive() && evaluateBorrowedFingerprintFormat(rawIsWellFormed, value) : rawIsWellFormed(value);
  }
  const options: NativeMigrationDecisionOptions = Object.freeze({
    isWellFormedFingerprint: isWellFormed,
    checkpointBatchKeyLimit: limits.checkpointBatchKeyLimit,
    latchWriteAttemptLimit: limits.latchWriteAttemptLimit,
  });

  let lease: NativeMigrationLease | null = borrowed?.lease ?? null;
  let memory: PlanMemory | null = null;
  let needsReopen = false;
  let faultStop: InProcessFaultStop | null = null;
  let faultFindings: readonly DecisionFinding[] = [];
  let latchEstablished: LatchAccount["established"] = null;
  let inFlight: Promise<InternalRunReport> | null = null;
  let disposed = false;
  /** A plan wrote (confirmed or unknown) since the last completed evaluation. */
  let evaluationPending = false;

  /**
   * The lifecycle check. Consulted after EVERY asynchronous boundary — each
   * evidence read, each source read and digest, each recheck — and, through the
   * target's transaction control, before every further bridge call, write and
   * COMMIT inside a transaction. A disposed runner issues no new migration work
   * and never publishes access.
   */
  let parentControl: NativeMigrationControl | undefined;
  let runLifecycle: object | null = null;
  let runReopened: object | null = null;
  let requiredReopened: object | null = null;
  let freshIdentity: string | null = null;
  let latestHold: { token: NativeDomainHold; lifecycle: object; evidence: object; identity: string } | null = null;
  const alive = (): boolean => !disposed && (!borrowed?.common || nativeCommonMigrationControlCurrent(parentControl)) && (!borrowed || borrowed.snapshot()?.lifecycle === runLifecycle);
  function requireReopen(): void {
    if (!needsReopen) requiredReopened = borrowed?.snapshot()?.reopened ?? null;
    needsReopen = true;
    latestHold = null;
  }
  function recoveredByParent(): boolean {
    const state = borrowed?.snapshot();
    if (!state?.ready || (needsReopen && (!state.reopened || state.reopened === requiredReopened))) return false;
    needsReopen = false;
    return true;
  }
  function currentHold(hold: unknown): boolean {
    if (!borrowed || !latestHold || latestHold.token !== hold || disposed || faultStop || needsReopen) return false;
    const state = borrowed.snapshot();
    return state?.ready === true && borrowed.holdAllowed?.() !== false && state.lifecycle === latestHold.lifecycle && state.evidence === latestHold.evidence;
  }
  function heldPlan(decision: ReturnType<typeof decideNativeMigration>): "fresh" | "verified" | null {
    if (decision.kind !== "plan") return null;
    const transaction = decision.plan.steps.find(step => step.kind === "target_transaction");
    if (transaction?.kind !== "target_transaction") return null;
    return transaction.transaction.op === "create_fresh_active" ? "fresh" : transaction.transaction.op === "activate" ? "verified" : null;
  }
  function observeWarmTarget(evidence: NativeMigrationEvidence): boolean {
    if (!borrowed) return false;
    // A later observation can confirm an existing stop, never replace its first
    // cause, latch bytes or lifetime attempt budget with a newly computed stop.
    if (faultStop) {
      borrowed.retainFault?.();
      latestHold = null;
      return true;
    }
    const surviving = evidence.survivingPlan ?? survivingEvidence();
    if (!surviving) return false;
    // Deliberately omit latch/health/source: the existing pure decision first
    // checks POSITIVE warm exclusions, then stops at missing latch. It cannot
    // validate normal records, grant, run a plan or call unrelated predicates.
    const decision = decideNativeMigration({ survivingPlan: surviving,
      ...(evidence.record ? { record: evidence.record } : {}),
      ...(evidence.targetRows ? { targetRows: evidence.targetRows } : {}),
      ...(evidence.targetRowValues ? { targetRowValues: evidence.targetRowValues } : {}),
    }, options);
    if (decision.kind !== "fault") return false;
    faultStop = decision.stop;
    faultFindings = decision.findings;
    borrowed.retainFault?.();
    latestHold = null;
    return true;
  }
  borrowed?.setWarmObserver?.(observeWarmTarget);
  borrowed?.setCompletionObserver?.(() => { memory = null; evaluationPending = false; latestHold = null; });
  const collectionControl = () => ({ source, target, lease: lease as NativeMigrationLease,
    fingerprint, isWellFormedFingerprint: isWellFormed, alive,
    ...(borrowed ? { observeWarmTarget } : {}),
  });

  /** Signals an interrupted read; never escapes this module. */
  const CANCELLED = Symbol("cancelled");

  function survivingEvidence(): SurvivingPlanEvidence | undefined {
    if (memory === null) return undefined;
    return {
      confirmedRows: [...memory.confirmedRows],
      ...(memory.unknownTransaction ? { unknownTransaction: memory.unknownTransaction } : {}),
      ...(memory.lastConfirmedRecord !== undefined ? { lastConfirmedRecord: memory.lastConfirmedRecord } : {}),
    };
  }

  /**
   * After a non-fault decision: if fresh evidence positively shows the issued
   * after- or before-state of the remembered unknown transaction, carry that
   * forward as confirmed memory, so the runner's later comparisons describe
   * what is durable. Anything less leaves the unknown transaction in memory.
   */
  function absorbClassifiedUnknown(evidence: NativeMigrationEvidence): void {
    const tx = memory?.unknownTransaction;
    if (!memory || !tx || !evidence.record || evidence.record.status === "read_failed") return;
    const observed = evidence.record.status === "absent" ? null : evidence.record.bytes;
    const valueOf = (key: string) => evidence.targetRowValues?.find((row) => row.key === key)?.value;
    const allIssued = tx.insertedRows.every((row) => {
      const value = valueOf(row.key);
      return value?.status === "present" && value.bytes === row.bytes;
    });
    const allAbsent = tx.insertedRows.every((row) => valueOf(row.key)?.status === "absent");
    if (observed === tx.recordAfter && allIssued) {
      memory.confirmedRows.push(...tx.insertedRows);
      memory.lastConfirmedRecord = tx.recordAfter;
      delete memory.unknownTransaction;
    } else if (observed === tx.recordBefore && allAbsent) {
      if (tx.recordBefore === null) delete memory.lastConfirmedRecord;
      else memory.lastConfirmedRecord = tx.recordBefore;
      delete memory.unknownTransaction;
    }
  }

  /** Reopens before any read when an earlier attempt left the outcome or the
   * connection uncertain (I-10). Returns the failed boundary, or `null`. */
  async function reopenIfRequired(): Promise<{ boundary: "refused" | "close" | "release" | "open" } | null> {
    if (!lease) return null;
    if (borrowed) return recoveredByParent() ? null : { boundary: "refused" };
    if (!needsReopen && target.leaseState() !== "requires_reopen") return null;
    const reopened = await target.reopen(lease, { proceed: alive });
    if (!reopened.ok) return { boundary: "boundary" in reopened ? reopened.boundary : "refused" };
    needsReopen = false;
    return null;
  }

  /* ---------------------------------------------------------------- reads */

  /** A failed read step: the cause it observed (Stage M3b4c observability). */
  interface FailedRead {
    readonly failed: HaltObservation;
  }

  async function readSourceStep(
    step: Extract<PlanStep, { kind: "read_source" }>
  ): Promise<CapturedRead | FailedRead | typeof CANCELLED> {
    const listing: KeyObservation[] = [];
    const values = new Map<string, { bytes: string; fingerprint: string }>();
    const listed = step.keys === "current_eligible_set";
    const readChecked = async (key: string): Promise<true | HaltObservation | typeof CANCELLED> => {
      // Checked AT ISSUANCE: the previous key's post-digest check ran in an
      // earlier microtask than this call, so disposal may have landed between.
      if (!alive()) return CANCELLED;
      const value = await source.readValue(key);
      if (!alive()) return CANCELLED;
      if (value.status !== "value") return "source_value_unreadable";
      if (value.value === null) return listed ? "listed_value_absent" : "planned_value_absent";
      const digest = await digestValue(fingerprint, value.value);
      if (!alive()) return CANCELLED;
      if (digest.status !== "computed") return "digest_unavailable";
      if (!safeFormat(isWellFormed, digest.value)) return "digest_malformed";
      values.set(key, { bytes: value.value, fingerprint: digest.value });
      listing.push({ key, fingerprint: digest });
      return true;
    };
    if (step.keys === "current_eligible_set") {
      // A FRESH enumeration: initial evidence never satisfies a later step.
      const keys = await source.listKeys();
      if (!alive()) return CANCELLED;
      if (keys.status !== "value") return { failed: "source_listing_failed" };
      if (keys.keys.some(isUnsupportedMigrationIdentityControlKey)) return { failed: "unsupported_identity_control" };
      for (const key of keys.keys) {
        if (!classifyMigrationSourceKey(key).eligible) {
          listing.push({ key });
          continue;
        }
        const checked = await readChecked(key);
        if (checked !== true) return checked === CANCELLED ? CANCELLED : { failed: checked };
      }
      return { listing, values };
    }
    for (const key of step.keys) {
      const checked = await readChecked(key);
      if (checked !== true) return checked === CANCELLED ? CANCELLED : { failed: checked };
    }
    return { listing, values };
  }

  /** A recheck's verdict: `true`, or the cause it observed (Stage M3b4c observability). */
  async function recheck(
    plan: MigrationPlan,
    step: Extract<PlanStep, { kind: "recheck" }>,
    record: ActivationRecord,
    captured: ReadonlyMap<number, CapturedRead>
  ): Promise<true | HaltObservation | typeof CANCELLED> {
    const read = captured.get(step.usesStep);
    if (!read) return "recheck_not_evaluable";
    switch (step.check) {
      case "entry_keys_present": {
        if (step.observes !== "fresh_source_enumeration") return "recheck_not_evaluable";
        // A NEW enumeration at the recheck itself, so a key that vanished after
        // the digest is caught before `begin_copying` is issued.
        const fresh = await source.listKeys();
        if (!alive()) return CANCELLED;
        if (fresh.status !== "value") return "recheck_enumeration_failed";
        if (fresh.keys.some(isUnsupportedMigrationIdentityControlKey)) return "unsupported_identity_control";
        const eligible = new Set(fresh.keys.filter((key) => classifyMigrationSourceKey(key).eligible));
        return (record.entryKeys ?? []).every((key) => eligible.has(key) && read.values.has(key))
          ? true
          : "entry_key_missing";
      }
      case "batch_digests_match_manifest": {
        const checkpoint = plan.steps.find((candidate) =>
          candidate.kind === "target_transaction" && candidate.transaction.op === "checkpoint" &&
          candidate.transaction.rowBytesFromStep === step.usesStep);
        if (!checkpoint || checkpoint.kind !== "target_transaction" || checkpoint.transaction.op !== "checkpoint") {
          return "recheck_not_evaluable";
        }
        const manifest = new Map((record.manifest ?? []).map((entry) => [entry.key, entry.fingerprint]));
        return checkpoint.transaction.batch.length > 0 && checkpoint.transaction.batch.every((key) => {
          const value = read.values.get(key);
          return value !== undefined && manifest.has(key) && value.fingerprint === manifest.get(key);
        })
          ? true
          : "batch_digest_mismatch";
      }
      case "source_set_and_content_valid": {
        const validation = validateSourceAgainstManifest(record, read.listing, isWellFormed);
        if (validation.status === "passed") return true;
        if (validation.status === "failed") {
          const codes = validation.findings.map((finding) => finding.code);
          if (codes.includes("unsupported_identity_control")) return "unsupported_identity_control";
          if (codes.some((code) => code === "source_key_missing" || code === "source_key_new" || code === "source_content_diverged")) {
            return "source_validation_diverged";
          }
          if (codes.includes("source_fingerprint_malformed")) return "digest_malformed";
        }
        return "source_validation_unavailable";
      }
    }
  }

  /* --------------------------------------------------------- transactions */

  interface PreparedTransaction {
    readonly kind: IssuedTransactionKind;
    readonly spec: NativeMigrationTransaction;
    readonly recordAfter: string;
    readonly insertedRows: readonly IssuedRow[];
    readonly readsInside: boolean;
    readonly generatedStoreIdentity?: string;
  }

  /** Everything an issued transaction needs, computed BEFORE it is issued. Any
   * throw or refusal here means the step is never issued. */
  function prepareTransaction(
    step: Extract<PlanStep, { kind: "target_transaction" }>,
    before: string | null,
    captured: ReadonlyMap<number, CapturedRead>,
    /** Receives what AP-CC/AP-ACT's verifier observed (Stage M3b4c observability). */
    note: { observed?: HaltObservation }
  ): PreparedTransaction | null {
    try {
      const beforeRecord = parsedRecord(before, isWellFormed);
      if (!alive() || beforeRecord === undefined) return null;
      const op = step.transaction;
      const uuid = () => {
        if (!alive()) throw CANCELLED;
        const value = generateUuid();
        if (!alive()) throw CANCELLED;
        if (typeof value !== "string" || !isCanonicalUuid(value)) throw new Error("uuid");
        return value;
      };
      const timestamp = () => {
        if (!alive()) throw CANCELLED;
        const value = now();
        if (!alive()) throw CANCELLED;
        return value;
      };
      let transition: RecordTransition;
      let kind: IssuedTransactionKind;
      let rows: IssuedRow[] = [];
      let generatedStoreIdentity: string | undefined;
      let verify = false;
      switch (op.op) {
        case "create_fresh_active":
          kind = op.op;
          transition = { kind, migrationId: uuid(), storeIdentity: uuid(), activatedAt: timestamp() };
          break;
        case "create_enumerating":
          kind = op.op;
          generatedStoreIdentity = uuid();
          transition = { kind, migrationId: uuid(), storeIdentity: generatedStoreIdentity, entryKeys: op.entryKeys };
          break;
        case "replace_enumerating":
          if (!beforeRecord || beforeRecord.storeIdentity !== op.storeIdentity) return null;
          kind = op.op;
          transition = { kind, migrationId: uuid(), entryKeys: op.entryKeys };
          break;
        case "begin_copying": {
          const read = captured.get(op.manifestFromStep);
          if (!read) return null;
          const manifest = [...read.values].map(([key, value]) => ({ key, fingerprint: value.fingerprint }));
          if (!op.mustContain.every((key) => read.values.has(key))) return null;
          kind = op.op;
          transition = { kind, manifest };
          break;
        }
        case "checkpoint": {
          const read = captured.get(op.rowBytesFromStep);
          if (!read || op.batch.length === 0) return null;
          for (const key of op.batch) {
            const value = read.values.get(key);
            if (!value) return null;
            // EXACTLY the bytes read and checked in that step — never a second read.
            rows.push({ key, bytes: value.bytes });
          }
          kind = op.op;
          transition = { kind, batch: op.batch };
          break;
        }
        case "complete_copying":
          kind = op.op;
          transition = { kind };
          verify = true;
          break;
        case "activate":
          kind = op.op;
          transition = { kind, activatedAt: timestamp() };
          verify = true;
          break;
        default:
          return null;
      }
      const after = buildRecordAfter(beforeRecord, transition);
      // The after-state must itself pass Groups A and A′: an invalid id or
      // timestamp from a dependency is refused here, never written.
      if (!after.ok || !evaluateActivationRecord(after.bytes, isWellFormed).ok) return null;
      rows = rows.map((row) => Object.freeze({ ...row }));

      let spec: NativeMigrationTransaction;
      if (kind === "create_fresh_active" || kind === "create_enumerating") {
        spec = { kind: "create_record", recordAfter: after.bytes };
      } else if (kind === "checkpoint") {
        spec = {
          kind: "checkpoint",
          recordBefore: before as string,
          recordAfter: after.bytes,
          rows: rows.map((row) => ({ key: row.key, value: row.bytes })),
        };
      } else {
        const evidenceRecord = beforeRecord as ActivationRecord;
        spec = {
          kind: "replace_record",
          recordBefore: before as string,
          recordAfter: after.bytes,
          // I-6: nothing is staged while `enumerating`.
          requireNoApplicationRows: kind === "replace_enumerating" || kind === "begin_copying",
          ...(verify
            ? {
                // AP-CC/AP-ACT: complete target evidence, read inside the transaction (§5.4a).
                verifyCompleteEvidence: async (inside) => {
                  const observations: KeyObservation[] = [];
                  for (const row of inside) {
                    // No further fingerprint is invoked once disposed: one that
                    // never answers would otherwise keep disposal from settling.
                    // The transaction sees the stop and rolls back.
                    if (!alive()) return false;
                    observations.push({ key: row.key, fingerprint: await digestValue(fingerprint, row.value) });
                  }
                  if (!alive()) return false;
                  const checked = checkTargetEvidence(evidenceRecord, observations, isWellFormed, true);
                  if (checked.status === "passed") return true;
                  // Only what was already observed is named: a positive difference
                  // first, then a malformed digest, then an incomplete digest set.
                  const codes = checked.status === "failed" ? checked.findings.map((finding) => finding.code) : [];
                  note.observed = codes.some((code) =>
                    code !== "row_fingerprint_unavailable" && code !== "row_fingerprint_malformed")
                    ? "target_evidence_mismatch"
                    : codes.includes("row_fingerprint_malformed")
                      ? "digest_malformed"
                      : "target_evidence_unavailable";
                  return false;
                },
              }
            : {}),
        };
      }
      return {
        kind,
        spec,
        recordAfter: after.bytes,
        insertedRows: rows,
        readsInside: verify,
        ...(generatedStoreIdentity ? { generatedStoreIdentity } : {}),
      };
    } catch {
      return null;
    }
  }

  async function prepareHold(preparation: "fresh" | "verified", completedPlans: CompletedPlan[]): Promise<NativeHeldDomainRunReport> {
    const parent = borrowed as NativeBorrowCapability;
    const initial = parent.snapshot();
    if (!alive() || !initial?.ready) return { outcome: "parent_recovery_required", completedPlans };
    const collected = await collectNativeMigrationEvidence({ ...collectionControl(), ...(parent.common ? { retainHeldTargetRows: true } : {}) }, survivingEvidence());
    if (faultStop) return await latchPhase(completedPlans) as NativeHeldDomainRunReport;
    if (collected.status === "cancelled") return { outcome: "disposed", completedPlans };
    if (collected.status === "refused") {
      if (collected.reason === "requires_reopen") requireReopen();
      return { outcome: "target_refused", reason: collected.reason, completedPlans };
    }
    const decision = decideNativeMigration(collected.evidence, options);
    if (decision.kind === "fault") {
      faultStop = decision.stop; faultFindings = decision.findings;
      borrowed?.retainFault?.();
      return await latchPhase(completedPlans) as NativeHeldDomainRunReport;
    }
    if (!alive()) return { outcome: "disposed", completedPlans };
    evaluationPending = false;
    // A fully observed after-state becomes CONFIRMED memory, also on this held
    // path. A later exact before-state must not be reconsidered as still possible.
    absorbClassifiedUnknown(collected.evidence);
    if (decision.kind === "blocked") return { outcome: "blocked", rule: decision.rule,
      findings: decision.findings, retryMayResolve: decision.retryMayResolve, completedPlans };
    if (decision.kind === "invalid_evidence") return { outcome: "invalid_evidence", problems: decision.problems, completedPlans };
    if (decision.kind === "evidence_required") return { outcome: "evidence_required", missing: decision.missing, completedPlans };
    if (decision.kind === "access") return { outcome: "active_refused", completedPlans };
    if (heldPlan(decision) !== preparation) return { outcome: "preparation_changed", completedPlans };
    let identity: string | null = null;
    try {
      if (preparation === "fresh") {
        const selected = parent.expectedIdentity?.() ?? null;
        if (selected !== null && !isCanonicalUuid(selected)) throw CANCELLED;
        if (freshIdentity === null) {
          const generated = selected ?? generateUuid();
          if (!alive()) throw CANCELLED;
          if (typeof generated !== "string" || !isCanonicalUuid(generated)) throw new Error("uuid");
          freshIdentity = generated;
        }
        if (selected !== null && selected !== freshIdentity) throw CANCELLED;
        identity = freshIdentity;
      } else {
        const record = collected.evidence.record;
        identity = record?.status === "present" ? parsedRecord(record.bytes, isWellFormed)?.storeIdentity ?? null : null;
        const selected = parent.expectedIdentity?.() ?? null;
        if (selected !== null && selected !== identity) throw CANCELLED;
      }
    } catch { /* No active bytes/timestamp and no fallback identity. */ }
    if (!alive() || !identity) return { outcome: "preparation_changed", completedPlans };
    if (parent.combined) {
      const selection = await target.checkProtocolSelection(lease as NativeMigrationLease, { proceed: alive });
      if (!alive()) return { outcome: "disposed", completedPlans };
      if (!selection.ok) return { outcome: "target_refused", reason: selection.reason, completedPlans };
    }
    const final = parent.snapshot();
    if (!alive() || !identity || !final?.ready || parent.holdAllowed?.() === false || final.evidence !== initial.evidence) {
      return { outcome: "preparation_changed", completedPlans };
    }
    const token = Object.freeze({}) as NativeDomainHold;
    latestHold = { token, lifecycle: final.lifecycle, evidence: final.evidence, identity };
    if (parent.common && (collected.heldTargetRows === undefined || collected.evidence.targetRows?.status !== "listed" || collected.heldTargetRows.length !== collected.evidence.targetRows.entries.length)) return { outcome: "preparation_changed", completedPlans };
    parent.registerHold?.(token, identity, preparation, collected.evidence.record?.status === "present" ? collected.evidence.record.bytes : null, collected.heldTargetRows ?? []);
    return { outcome: "held", preparation, hold: token, completedPlans };
  }

  async function executePlan(plan: MigrationPlan, evidence: NativeMigrationEvidence, completedPlans: CompletedPlan[]): Promise<PlanExecution> {
    const held = lease as NativeMigrationLease;
    const outcomes: StepOutcome[] = [];
    const captured = new Map<number, CapturedRead>();
    const generated = new Map<number, string>();
    let current: string | null = evidence.record?.status === "present" ? evidence.record.bytes : null;
    let marker: MarkerAccount | null = null;
    let markerAlreadyMatching = false;

    const notIssued = (
      step: number,
      cause: "preparation_failed" | "target_unavailable" | "precondition_failed" | "disposed",
      tx: TransactionAccount | null = null
    ): PlanExecution => ({
      status: cause === "disposed" ? "disposed" : "halted",
      halt: {
        kind: "not_issued",
        step,
        cause,
        dispositions: [...outcomes, ...plan.steps.slice(outcomes.length).map(() => "not_issued" as const)],
      },
      transaction: tx,
      marker,
    });
    /** Records the step's real outcome and stops. Disposal changes only the status. */
    const stopWith = (
      outcome: StepOutcome,
      tx: TransactionAccount | null = null,
      observed?: HaltObservation
    ): PlanExecution => {
      outcomes.push(outcome);
      return {
        status: alive() ? "halted" : "disposed",
        halt: {
          kind: "plan_run",
          report: summarizePlanRun(plan, outcomes),
          ...(observed !== undefined ? { observed } : {}),
        },
        transaction: tx,
        marker,
      };
    };

    for (let index = 0; index < plan.steps.length; index += 1) {
      // Nothing further is issued once disposal has begun.
      if (!alive()) return notIssued(index, "disposed");
      const step = plan.steps[index];
      const selection = await target.checkProtocolSelection(held, { proceed: alive });
      if (!alive()) return notIssued(index, "disposed");
      if (!selection.ok) return notIssued(index, "target_unavailable");

      if (step.kind === "marker_write") {
        const value = "existing" in step.storeIdentity
          ? step.storeIdentity.existing
          : generated.get(step.storeIdentity.generatedInStep);
        if (typeof value !== "string" || !isCanonicalUuid(value)) return notIssued(index, "preparation_failed");
        // The precondition (marker positively absent) is re-established AT the
        // write, in the same synchronous turn — never from the earlier evidence,
        // so a marker that became foreign meanwhile is never overwritten (PV12).
        const written = await source.writeMarkerIfAbsent(value, ...(borrowed?.common ? [{ proceed: alive }] : []));
        if (written.status === "refused") {
          marker = { step: index, status: "refused", reason: written.reason };
          return notIssued(index, "precondition_failed");
        }
        if (written.status === "write_failed") {
          marker = { step: index, status: "write_failed" };
          // A rejected marker write may have applied (I-9): outcome unknown.
          return stopWith("outcome_unknown");
        }
        marker = { step: index, status: written.status };
        if (written.status === "already_matching") markerAlreadyMatching = true;
        outcomes.push("confirmed");
        continue;
      }

      if (step.kind === "read_source") {
        const read = await readSourceStep(step);
        if (read === CANCELLED) return stopWith("failed");
        if ("failed" in read) return stopWith("failed", null, read.failed);
        captured.set(index, read);
        outcomes.push("succeeded");
        continue;
      }

      if (step.kind === "recheck") {
        const record = parsedRecord(current, isWellFormed);
        const passed = record ? await recheck(plan, step, record, captured) : "recheck_not_evaluable";
        if (passed === CANCELLED) return stopWith("failed");
        if (passed !== true) return stopWith("failed", null, passed);
        outcomes.push("passed");
        continue;
      }

      if (borrowed && (step.transaction.op === "create_fresh_active" || step.transaction.op === "activate")) {
        // Preserve every approved prefix step, notably AP-ACT's guarded marker
        // write. Stop at the ACTUAL activation step, before prepareTransaction.
        return { status: "prepared", report: await prepareHold(
          step.transaction.op === "create_fresh_active" ? "fresh" : "verified", completedPlans) };
      }
      const note: { observed?: HaltObservation } = {};
      const prepared = prepareTransaction(step, current, captured, note);
      if (!alive()) return notIssued(index, "disposed");
      if (!prepared) return notIssued(index, "preparation_failed");
      // The transaction re-checks the lifecycle before every further bridge
      // call, write and COMMIT. Stopped before COMMIT, its uncommitted work is
      // rolled back; a COMMIT already issued is awaited and reported as it is.
      const permitted = borrowed?.seal ? borrowed.seal(prepared.spec, prepared.kind, isWellFormed) : prepared.spec;
      if (!alive()) return notIssued(index, "disposed");
      if (!permitted) return notIssued(index, "preparation_failed");
      const result = await target.transact(held, permitted, { proceed: alive });
      const tx = account(index, result);
      if (result.status === "confirmed") {
        evaluationPending = true;
        memory ??= { confirmedRows: [] };
        memory.confirmedRows.push(...prepared.insertedRows);
        memory.lastConfirmedRecord = prepared.recordAfter;
        delete memory.unknownTransaction;
        current = prepared.recordAfter;
        if (prepared.generatedStoreIdentity) generated.set(index, prepared.generatedStoreIdentity);
        outcomes.push("confirmed");
        continue;
      }
      if (result.status === "refused" || result.status === "not_begun") {
        return notIssued(index, result.status === "refused" && result.reason === "cancelled" ? "disposed" : "target_unavailable", tx);
      }
      if (result.status === "not_committed" && result.reason === "protocol_refused" && !result.writeIssued) {
        return stopWith("aborted_before_write", tx);
      }
      if (
        result.status === "not_committed" && prepared.readsInside && !result.writeIssued &&
        (result.reason === "precondition_failed" || result.reason === "evidence_unreadable" ||
          result.reason === "evidence_mismatch" || result.reason === "cancelled")
      ) {
        // AP-CC/AP-ACT read their evidence inside the transaction and wrote nothing.
        // A verifier refusal names what the verifier observed; a refusal for any
        // other reason (`evidence_unreadable`, `precondition_failed`, `cancelled`)
        // carries the adapter's own reason in `tx` and no verifier observation.
        return stopWith(
          "aborted_before_write",
          tx,
          result.reason === "evidence_mismatch" ? note.observed : undefined
        );
      }
      // I-9: a rejected or unanswered write is an unknown outcome. The exact
      // issued before/after bytes and rows are kept for I-11's comparison.
      evaluationPending = true;
      memory ??= { confirmedRows: [] };
      memory.unknownTransaction = {
        kind: prepared.kind,
        recordBefore: current,
        recordAfter: prepared.recordAfter,
        insertedRows: prepared.insertedRows,
      };
      return stopWith("outcome_unknown", tx);
    }
    return { status: "completed", markerAlreadyMatching };
  }

  /* ------------------------------------------------------------- latch */

  /**
   * I-13: the in-process stop holds for the runner's lifetime. The only write is
   * the AP-LATCH transaction, bounded by the approved reducer; a rejected or
   * unknown attempt never releases the stop.
   */
  async function latchPhase(completedPlans: CompletedPlan[]): Promise<InternalRunReport> {
    const held = lease as NativeMigrationLease;
    const report = (): NativeMigrationRunReport => {
      const stop = faultStop as InProcessFaultStop;
      const decision = decideNativeMigration({ inProcessFault: stop }, options);
      return {
        outcome: "fault",
        findings: faultFindings,
        latch: {
          attempts: [...stop.latchWriteAttempts],
          established: latchEstablished,
          attemptsRemain: decision.kind === "fault" && decision.latchPlan !== null,
        },
        completedPlans,
      };
    };
    for (;;) {
      if (!alive()) return report();
      const stop = faultStop as InProcessFaultStop;
      const decision = decideNativeMigration({ inProcessFault: stop }, options);
      if (decision.kind !== "fault" || decision.latchPlan === null) return report();
      const step = decision.latchPlan.steps[0];
      if (step.kind !== "target_transaction" || step.transaction.op !== "write_fault_latch") return report();
      if (needsReopen || target.leaseState() === "requires_reopen") {
        if (borrowed) {
          if (!needsReopen) requireReopen();
          if (!recoveredByParent()) return { outcome: "parent_recovery_required", completedPlans };
          continue;
        }
        const reopened = await target.reopen(held, { proceed: alive });
        if (!reopened.ok) return report();
        needsReopen = false;
      }
      const latchSpec: NativeMigrationTransaction = { kind: "insert_latch", content: step.transaction.content };
      const permitted = borrowed?.seal ? borrowed.seal(latchSpec, "write_fault_latch", isWellFormed) : latchSpec;
      if (!alive() || !permitted) return report();
      const result = await target.transact(held, permitted, { proceed: alive });
      if (result.status === "refused" || result.status === "not_begun") return report(); // not an attempt: nothing issued
      if (result.status === "not_committed" && result.reason === "cancelled") {
        // Stopped by disposal before COMMIT: rolled back, so not an attempt. The
        // in-process stop is untouched.
        if (result.connection === "uncertain") requireReopen();
        return report();
      }
      if (result.status === "confirmed") {
        latchEstablished = "confirmed";
        faultStop = recordLatchWriteAttempt(stop, "confirmed");
        continue;
      }
      if (result.status === "not_committed" && result.reason === "latch_already_present") {
        // The durable latch is positively present: the stop already persists.
        latchEstablished = "already_present";
        faultStop = recordLatchWriteAttempt(stop, "confirmed");
        if (result.connection === "uncertain") requireReopen();
        continue;
      }
      requireReopen();
      faultStop = recordLatchWriteAttempt(stop, "outcome_unknown");
    }
  }

  /* --------------------------------------------------------------- run */

  async function runOnce(): Promise<InternalRunReport> {
    const completedPlans: CompletedPlan[] = [];
    if (lease === null) {
      const acquired = await target.acquire();
      if (!acquired.ok) return { outcome: "target_refused", reason: acquired.reason, completedPlans };
      lease = acquired.lease;
    }
    if (faultStop) return latchPhase(completedPlans);

    for (;;) {
      if (!alive()) return { outcome: "disposed", completedPlans };
      const reopen = await reopenIfRequired();
      // A reopen stopped by disposal is not a failed boundary: the run was disposed.
      if (reopen !== null) {
        return !alive() ? { outcome: "disposed", completedPlans } : borrowed ?
          { outcome: "parent_recovery_required", completedPlans } : { outcome: "reopen_failed", boundary: reopen.boundary, completedPlans };
      }
      if (!alive()) return { outcome: "disposed", completedPlans };
      const collected = await collectNativeMigrationEvidence(collectionControl(), survivingEvidence());
      if (borrowed && faultStop) return latchPhase(completedPlans);
      if (collected.status === "cancelled") return { outcome: "disposed", completedPlans };
      if (collected.status === "refused") {
        if (collected.reason === "requires_reopen") requireReopen();
        return { outcome: "target_refused", reason: collected.reason, completedPlans };
      }
      const decision = decideNativeMigration(collected.evidence, options);
      // The surviving plan evidence has now been evaluated against complete,
      // freshly reopened evidence.
      evaluationPending = false;

      // A positively established fault is retained even when disposal began
      // meanwhile: the in-process stop is set before anything else happens, and
      // the latch phase issues nothing further once disposed.
      if (decision.kind === "fault") {
        faultStop = decision.stop;
        faultFindings = decision.findings;
        borrowed?.retainFault?.();
        return latchPhase(completedPlans);
      }
      // A disposed run never publishes a decision — access above all.
      if (!alive()) return { outcome: "disposed", completedPlans };

      switch (decision.kind) {
        case "invalid_evidence":
          return { outcome: "invalid_evidence", problems: decision.problems, completedPlans };
        case "evidence_required":
          return { outcome: "evidence_required", missing: decision.missing, completedPlans };
        case "blocked": {
          absorbClassifiedUnknown(collected.evidence);
          const recordPhase = observedRecordPhase(collected.evidence, isWellFormed);
          return {
            outcome: "blocked",
            rule: decision.rule,
            findings: decision.findings,
            retryMayResolve: decision.retryMayResolve,
            ...(recordPhase !== undefined ? { recordPhase } : {}),
            completedPlans,
          };
        }
        case "access": {
          if (borrowed) return { outcome: "active_refused", completedPlans };
          // Evidence collection may await source/digest work. No former schema
          // observation alone is a permit to publish B4.
          const selection = await target.checkProtocolSelection(lease as NativeMigrationLease, { proceed: alive });
          if (!alive()) return { outcome: "disposed", completedPlans };
          if (!selection.ok) return { outcome: "target_refused", reason: selection.reason, completedPlans };
          // B4 reached. The record is `active`; the migration's plan memory is
          // historical from here on (§5.4), so it is retired rather than allowed to
          // contradict legitimate post-activation changes.
          memory = null;
          {
            const recordPhase = observedRecordPhase(collected.evidence, isWellFormed);
            return {
              outcome: "access",
              rule: "B4",
              retirement: decision.retirement,
              ...(recordPhase !== undefined ? { recordPhase } : {}),
              completedPlans,
            };
          }
        }
        case "plan": {
          absorbClassifiedUnknown(collected.evidence);
          if (borrowed?.preparationOnly?.()) {
            const preparation = heldPlan(decision);
            return preparation ? prepareHold(preparation, completedPlans) : { outcome: "preparation_changed", completedPlans };
          }
          if (completedPlans.length >= limits.maxPlansPerRun) return { outcome: "bound_reached", completedPlans };
          const execution = await executePlan(decision.plan, collected.evidence, completedPlans);
          if (execution.status === "prepared") return execution.report;
          if (execution.status !== "completed") {
            // I-9: after ANY halt, re-evaluation starts on a positively reopened
            // target — whatever the halted step was (a marker write, a read, a
            // recheck, a preparation failure or a transaction). The next explicit
            // run() reopens before it reads anything.
            requireReopen();
            if (execution.status === "disposed") {
              return {
                outcome: "disposed",
                plan: decision.plan.name,
                halt: execution.halt,
                transaction: execution.transaction,
                marker: execution.marker,
                completedPlans,
              };
            }
            return {
              outcome: "halted",
              plan: decision.plan.name,
              rule: decision.rule,
              halt: execution.halt,
              transaction: execution.transaction,
              marker: execution.marker,
              completedPlans,
            };
          }
          completedPlans.push({
            name: decision.plan.name,
            rule: decision.rule,
            ...(execution.markerAlreadyMatching ? { markerAlreadyMatching: true as const } : {}),
          });
          // `continuation: "re_evaluate"` — fresh evidence, never chained.
          continue;
        }
      }
    }
  }

  return {
    isCurrentHold: currentHold,
    run(control?: NativeMigrationControl): Promise<InternalRunReport> {
      if (disposed) return Promise.resolve({ outcome: "disposed", completedPlans: [] });
      if (inFlight) return inFlight;
      if (borrowed?.common && !nativeCommonMigrationControlCurrent(control)) return Promise.resolve({ outcome: "parent_busy", completedPlans: [] });
      parentControl = control;
      latestHold = null;
      if (borrowed?.beginRun?.() === false) return Promise.resolve({ outcome: "parent_busy", completedPlans: [] });
      if (borrowed) {
        const state = borrowed.snapshot();
        runLifecycle = state?.lifecycle ?? null;
        runReopened = state?.reopened ?? null;
        if (!state?.ready) {
          if (!needsReopen) { requiredReopened = runReopened; needsReopen = true; }
          borrowed.endRun?.();
          return Promise.resolve({ outcome: "parent_recovery_required", completedPlans: [] });
        }
      }
      const attempt = runOnce().then(report => {
        if (borrowed && report.outcome === "disposed" && !disposed) {
          if (!needsReopen) { requiredReopened = runReopened; needsReopen = true; }
          return { outcome: "parent_recovery_required" as const, completedPlans: report.completedPlans };
        }
        return report;
      }).finally(() => {
        if (inFlight === attempt) inFlight = null;
        borrowed?.endRun?.();
      });
      inFlight = attempt;
      return attempt;
    },

    async dispose(): Promise<NativeMigrationDisposeResult> {
      disposed = true;
      latestHold = null;
      // Wait for an in-flight call to ANSWER. Ownership is never released merely
      // because a bridge call has not answered yet.
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          /* runOnce does not reject; contained regardless */
        }
      }
      if (lease === null) return { ok: true };
      if (faultStop !== null) return { ok: false, reason: "fault_stop_held" };
      if (memory?.unknownTransaction !== undefined || evaluationPending || (borrowed && memory !== null)) {
        return { ok: false, reason: "plan_evidence_held" };
      }
      // No reopen first: release itself closes the connection and releases the
      // native handle, each positively established, which is all that freeing
      // ownership needs — so disposal issues no fresh open or other new work.
      if (borrowed) {
        borrowed.finishClean();
        return { ok: true };
      }
      const released = await target.release(lease);
      if (!released.ok) {
        return { ok: false, boundary: "boundary" in released ? released.boundary : "release" };
      }
      lease = null;
      memory = null;
      return { ok: true };
    },
  };
}
