// Synthetic test kit for the M3b4a native-migration decision layer.
//
// EVERYTHING HERE IS SYNTHETIC. "Fingerprints" are labelled strings
// (`synthetic-fp:<value>`), NOT cryptographic digests and NOT platform evidence:
// the production algorithm and its WebView availability are unresolved (I-7). The
// "world" is an in-memory model of the two stores, and `executePlan` is a
// mechanical stand-in for an executor. It carries out the symbolic steps the
// decision returned, using the PRODUCTION pure helpers (`buildRecordAfter`,
// `checkTargetEvidence`, `validateSourceAgainstManifest`, `eligibleSourceKeys`),
// so no test contains a second copy of the decision algorithm. Nothing here is
// application, engine or device evidence.
import { expect } from "vitest";
import {
  decideNativeMigration,
  eligibleSourceKeys,
  checkTargetEvidence,
  validateSourceAgainstManifest,
  type IssuedRow,
  type IssuedTransactionKind,
  type KeyObservation,
  type MigrationPlan,
  type NativeMigrationDecision,
  type NativeMigrationDecisionOptions,
  type NativeMigrationEvidence,
  type StoredValueObservation,
  type SurvivingPlanEvidence,
  type UnknownOutcomeTransaction,
} from "../nativeMigrationDecision";
import {
  buildRecordAfter,
  evaluateActivationRecord,
  serializeActivationRecord,
  type ActivationRecord,
  type ManifestEntry,
  type RecordTransition,
} from "../nativeMigrationRecord";
import { summarizePlanRun, type PlanRunReport, type StepOutcome } from "../nativeMigrationPlanOutcome";

// ---------------------------------------------------------------- synthetic values

export const SYNTHETIC_FP_PREFIX = "synthetic-fp:";
/**
 * A labelled SYNTHETIC fingerprint: FNV-1a (32-bit) plus the length, in hex. It is
 * deliberately not cryptographic and not a candidate production algorithm (I-7
 * leaves that open); it only keeps fixture values out of fixture fingerprints.
 */
export const fp = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${SYNTHETIC_FP_PREFIX}${hash.toString(16).padStart(8, "0")}-${value.length.toString(16)}`;
};
export const isSyntheticFingerprint = (value: string): boolean => value.startsWith(SYNTHETIC_FP_PREFIX);

export const OPTIONS: NativeMigrationDecisionOptions = Object.freeze({
  isWellFormedFingerprint: isSyntheticFingerprint,
  checkpointBatchKeyLimit: 2,
  latchWriteAttemptLimit: 3,
});

export const STORE_A = "11111111-1111-4111-8111-111111111111";
export const STORE_FOREIGN = "22222222-2222-4222-8222-222222222222";
export const MIG_1 = "33333333-3333-4333-8333-333333333333";
export const MIG_2 = "44444444-4444-4444-8444-444444444444";
export const PROFILE_A = "55555555-5555-4555-8555-555555555555";
export const PROFILE_B = "66666666-6666-4666-8666-666666666666";
export const BARRIER = "77777777-7777-4777-8777-777777777777";

export const KEY_SESSION = `curling.sporting.profile.v1.${PROFILE_A}.curling-release-tracker-current-session`;
export const KEY_HISTORY = `curling.sporting.profile.v1.${PROFILE_A}.curling-release-tracker-session-history`;
export const KEY_SYNC_B = `curling.sporting.profile.v1.${PROFILE_B}.curling-release-tracker-cloud-sporting-sync`;
export const KEY_TRUSTED = "curling.identity.trustedDevice.v1";
export const KEY_BARRIER = "curling.identity.accessBarrier.v1";
export const KEY_RESOLUTION = `curling.identity.accessBarrierResolution.${BARRIER}.v1`;
export const KEY_NEW = `curling.sporting.profile.v1.${PROFILE_B}.curling-release-tracker-training-plans`;

/** A provider-credential key and other excluded keys, for independence checks. */
export const KEY_CREDENTIAL = "sb-synthetic-auth-token";
export const KEY_CREDENTIAL_VERIFIER = "sb-synthetic-auth-token-code-verifier";
export const KEY_DIAGRAM = "curling-performance-public-exercise-diagram-v1.asset-1";
export const KEY_UNKNOWN = "some.unrelated.key";

/** The default synthetic source: four eligible keys from two Profiles plus identity. Values are opaque. */
export const BASE_SOURCE: Readonly<Record<string, string>> = Object.freeze({
  [KEY_SESSION]: "{\"opaque\":\"session\"}",
  [KEY_SYNC_B]: "not even json — values stay opaque",
  [KEY_TRUSTED]: "trusted-bytes",
  [KEY_RESOLUTION]: "resolution-bytes",
});

export const ELIGIBLE_BASE = Object.freeze(Object.keys(BASE_SOURCE).sort());

// ---------------------------------------------------------------- records

export function manifestOf(source: Readonly<Record<string, string>>, keys = Object.keys(source)): ManifestEntry[] {
  return [...keys].sort().map((key) => ({ key, fingerprint: fp(source[key]) }));
}

export function recordBytes(record: Partial<ActivationRecord> & Pick<ActivationRecord, "phase">): string {
  return serializeActivationRecord({
    schemaVersion: 1,
    migrationId: MIG_1,
    storeIdentity: STORE_A,
    ...record,
  } as ActivationRecord);
}

export const enumeratingBytes = (entryKeys: readonly string[] = ELIGIBLE_BASE, extra: Partial<ActivationRecord> = {}) =>
  recordBytes({ phase: "enumerating", entryKeys, ...extra });

export const copyingBytes = (copied: readonly string[], source = BASE_SOURCE, extra: Partial<ActivationRecord> = {}) =>
  recordBytes({ phase: "copying", entryKeys: Object.keys(source), manifest: manifestOf(source), copied, ...extra });

export const verifiedBytes = (source = BASE_SOURCE, extra: Partial<ActivationRecord> = {}) =>
  recordBytes({
    phase: "verified",
    entryKeys: Object.keys(source),
    manifest: manifestOf(source),
    copied: Object.keys(source),
    ...extra,
  });

export const activeBytes = (source = BASE_SOURCE, extra: Partial<ActivationRecord> = {}) =>
  recordBytes({
    phase: "active",
    entryKeys: Object.keys(source),
    manifest: manifestOf(source),
    copied: Object.keys(source),
    activatedAt: "2026-10-20T10:00:00.000Z",
    sourceRetirement: { state: "not_started", removedKeys: [] },
    ...extra,
  });

export const d1ActiveBytes = () =>
  recordBytes({
    phase: "active",
    entryKeys: [],
    manifest: [],
    copied: [],
    activatedAt: "2026-10-20T10:00:00.000Z",
    sourceRetirement: { state: "complete", removedKeys: [] },
  });

/** Raw JSON for malformed-record tests that serialisation would normalise away. */
export const rawRecord = (value: unknown): string => JSON.stringify(value);

// ---------------------------------------------------------------- evidence

export const present = (bytes: string): StoredValueObservation => ({ status: "present", bytes });
export const ABSENT: StoredValueObservation = Object.freeze({ status: "absent" });
export const READ_FAILED: StoredValueObservation = Object.freeze({ status: "read_failed" });

export function listing(map: Readonly<Record<string, string>>, withFingerprints = true): NativeMigrationEvidence["source"] {
  return {
    status: "listed",
    entries: Object.keys(map).sort().map((key): KeyObservation =>
      withFingerprints ? { key, fingerprint: { status: "computed", value: fp(map[key]) } } : { key }),
  };
}

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
  }
  return value;
}

/** Evaluates a deeply frozen snapshot, so any attempted mutation throws in strict mode. */
export function decide(evidence: NativeMigrationEvidence, options: NativeMigrationDecisionOptions = OPTIONS): NativeMigrationDecision {
  return decideNativeMigration(deepFreeze(structuredClone(evidence)), options);
}

// ---------------------------------------------------------------- the model world

export interface World {
  latch: string | null | "READ_FAILED";
  record: string | null | "READ_FAILED";
  /** Target application rows: key → exact value bytes. `null` = enumeration fails. */
  rows: Record<string, string> | null;
  /** Source: key → exact value bytes. `null` = enumeration fails. */
  source: Record<string, string> | null;
  marker: string | null | "READ_FAILED";
  targetFailing?: boolean;
}

export function world(partial: Partial<World> = {}): World {
  return {
    latch: null,
    record: null,
    rows: {},
    source: { ...BASE_SOURCE },
    marker: null,
    ...partial,
  };
}

const observe = (value: string | null | "READ_FAILED"): StoredValueObservation =>
  value === "READ_FAILED" ? READ_FAILED : value === null ? ABSENT : present(value);

/**
 * The evidence of a world. A cold start supplies no plan memory. A warm evaluation
 * also observes the exact bytes of every row the surviving plan issued (I-11).
 */
export function evidenceOf(w: World, warm?: SurvivingPlanEvidence): NativeMigrationEvidence {
  const warmKeys = warm
    ? [...new Set([...(warm.unknownTransaction?.insertedRows ?? []), ...warm.confirmedRows].map((row) => row.key))].sort()
    : [];
  return {
    latch: observe(w.latch),
    record: observe(w.record),
    targetHealth: { status: w.targetFailing ? "failing" : "healthy" },
    targetRows: w.rows === null ? { status: "read_failed" } : listing(w.rows),
    source: w.source === null ? { status: "read_failed" } : listing(w.source),
    marker: observe(w.marker),
    ...(warm
      ? {
          survivingPlan: warm,
          targetRowValues: warmKeys.map((key) => ({
            key,
            value: w.rows === null ? READ_FAILED : key in w.rows ? present(w.rows[key]) : ABSENT,
          })),
        }
      : {}),
  };
}

export function parsed(bytes: string): ActivationRecord {
  const result = evaluateActivationRecord(bytes, isSyntheticFingerprint);
  if (!result.ok) throw new Error(`fixture record invalid: ${JSON.stringify(result.findings)}`);
  return result.record;
}

// ---------------------------------------------------------------- the mechanical executor

/** How the modeled store answers one step. Default: the step succeeds. */
export type Injection =
  | "reject_before_apply" // write rejected and not applied → outcome unknown
  | "apply_then_reject" // write applied, then rejected → outcome unknown
  | "lost_ack" // write applied, acknowledgement lost → outcome unknown
  | "not_committed_unknown" // transaction not committed, outcome unknown
  | "inside_read_fails" // AP-CC/AP-ACT in-transaction read fails → aborted before write
  | "read_fails"; // a source read step fails

export interface ExecutionScript {
  /** Injection per step index. */
  readonly inject?: Readonly<Record<number, Injection>>;
  /** Mutate the world immediately before a step runs (models concurrent change or death boundaries). */
  readonly before?: Readonly<Record<number, (w: World) => void>>;
  /** Stop the process before this step (models death): no outcome for it or later steps. */
  readonly dieBeforeStep?: number;
}

export interface Execution {
  readonly world: World;
  readonly outcomes: StepOutcome[];
  readonly report: PlanRunReport | null;
  /** Warm evidence a surviving process would hold. */
  readonly surviving: SurvivingPlanEvidence;
  /** Every checkpoint batch actually COMMITTED (applied), for replay checks. */
  readonly committedBatches: string[][];
}

let generated = 0;
/** Deterministic canonical v4-shaped UUIDs for "generated" values. */
export function nextGeneratedUuid(): string {
  generated += 1;
  const hex = generated.toString(16).padStart(12, "0");
  return `aaaaaaaa-aaaa-4aaa-8aaa-${hex}`;
}

export function executePlan(start: World, plan: MigrationPlan, script: ExecutionScript = {}): Execution {
  const w: World = structuredClone(start);
  const outcomes: StepOutcome[] = [];
  const confirmedRows: IssuedRow[] = [];
  const committedBatches: string[][] = [];
  let lastConfirmedRecord: string | undefined;
  let unknownTransaction: UnknownOutcomeTransaction | undefined;
  const generatedIn: Record<number, string> = {};
  /** The exact bytes each read step obtained. Later steps use THESE, never a second live read. */
  const captured: Record<number, Record<string, string>> = {};
  const liveEligible = (): string[] =>
    w.source === null ? [] : eligibleSourceKeys(Object.keys(w.source).map((key) => ({ key })));
  const observationsOf = (bytes: Record<string, string>): KeyObservation[] =>
    Object.keys(bytes).map((key) => ({ key, fingerprint: { status: "computed" as const, value: fp(bytes[key]) } }));

  const currentRecord = (): ActivationRecord | null =>
    w.record === null || w.record === "READ_FAILED" ? null : parsed(w.record);

  for (let index = 0; index < plan.steps.length; index += 1) {
    if (script.dieBeforeStep === index) break;
    script.before?.[index]?.(w);
    const step = plan.steps[index];
    const injection = script.inject?.[index];

    if (step.kind === "marker_write") {
      const value = "existing" in step.storeIdentity ? step.storeIdentity.existing : generatedIn[step.storeIdentity.generatedInStep];
      if (injection !== "reject_before_apply") w.marker = value;
      outcomes.push(injection ? "outcome_unknown" : "confirmed");
      if (injection) break;
      continue;
    }

    if (step.kind === "read_source") {
      if (injection === "read_fails" || w.source === null) {
        outcomes.push("failed");
        break;
      }
      const source = w.source;
      const keys = step.keys === "current_eligible_set" ? liveEligible() : step.keys.filter((key) => key in source);
      captured[index] = Object.fromEntries(keys.map((key) => [key, source[key]]));
      outcomes.push("succeeded");
      continue;
    }

    if (step.kind === "recheck") {
      const record = currentRecord();
      const read = captured[step.usesStep] ?? {};
      let ok = false;
      if (record && step.check === "entry_keys_present") {
        // A FRESH enumeration at the recheck itself, and the keys actually digested.
        const fresh = liveEligible();
        ok = step.observes === "fresh_source_enumeration" &&
          (record.entryKeys ?? []).every((key) => fresh.includes(key) && key in read);
      } else if (record && step.check === "batch_digests_match_manifest") {
        const manifest = new Map((record.manifest ?? []).map((e) => [e.key, e.fingerprint]));
        const batchStep = plan.steps.find((s) => s.kind === "target_transaction" && s.transaction.op === "checkpoint");
        const batch = batchStep && batchStep.kind === "target_transaction" && batchStep.transaction.op === "checkpoint"
          ? batchStep.transaction.batch : [];
        ok = batch.every((key) => read[key] !== undefined && fp(read[key]) === manifest.get(key));
      } else if (record && step.check === "source_set_and_content_valid") {
        ok = validateSourceAgainstManifest(record, observationsOf(read), isSyntheticFingerprint).status === "passed";
      }
      outcomes.push(ok ? "passed" : "failed");
      if (!ok) break;
      continue;
    }

    // target_transaction
    const tx = step.transaction;
    const before = w.record === "READ_FAILED" ? null : w.record;
    if (tx.op === "write_fault_latch") {
      if (injection !== "reject_before_apply" && injection !== "not_committed_unknown") w.latch = tx.content;
      outcomes.push(injection ? "outcome_unknown" : "confirmed");
      if (injection) break;
      continue;
    }
    if (tx.op === "complete_copying" || tx.op === "activate") {
      const record = currentRecord();
      const inside = injection === "inside_read_fails" || w.rows === null || record === null
        ? null
        : checkTargetEvidence(record, Object.keys(w.rows).map((key) => ({
            key, fingerprint: { status: "computed" as const, value: fp((w.rows as Record<string, string>)[key]) },
          })), isSyntheticFingerprint, true);
      if (!inside || inside.status !== "passed") {
        outcomes.push("aborted_before_write");
        break;
      }
    }
    let transition: RecordTransition;
    let kind: IssuedTransactionKind;
    const inserted: Record<string, string> = {};
    switch (tx.op) {
      case "create_fresh_active":
        kind = "create_fresh_active";
        transition = { kind, migrationId: nextGeneratedUuid(), storeIdentity: nextGeneratedUuid(), activatedAt: "2026-10-20T12:00:00.000Z" };
        break;
      case "create_enumerating": {
        kind = "create_enumerating";
        const storeIdentity = nextGeneratedUuid();
        generatedIn[index] = storeIdentity;
        transition = { kind, migrationId: nextGeneratedUuid(), storeIdentity, entryKeys: tx.entryKeys };
        break;
      }
      case "replace_enumerating":
        kind = "replace_enumerating";
        transition = { kind, migrationId: nextGeneratedUuid(), entryKeys: tx.entryKeys };
        break;
      case "begin_copying": {
        kind = "begin_copying";
        const read = captured[tx.manifestFromStep] ?? {};
        transition = { kind, manifest: Object.keys(read).sort().map((key) => ({ key, fingerprint: fp(read[key]) })) };
        break;
      }
      case "checkpoint": {
        kind = "checkpoint";
        transition = { kind, batch: tx.batch };
        // Exactly the bytes read AND checked — never a second, unchecked live read.
        const read = captured[tx.rowBytesFromStep] ?? {};
        for (const key of tx.batch) inserted[key] = read[key];
        break;
      }
      case "complete_copying":
        kind = "complete_copying";
        transition = { kind };
        break;
      case "activate":
        kind = "activate";
        transition = { kind, activatedAt: "2026-10-20T12:30:00.000Z" };
        break;
    }
    const after = buildRecordAfter(before === null ? null : parsed(before), transition);
    if (!after.ok) throw new Error(`executor asked for an undefined transition: ${after.reason}`);
    const insertedRows: IssuedRow[] = Object.keys(inserted).sort().map((key) => ({ key, bytes: inserted[key] }));
    const apply = injection !== "reject_before_apply" && injection !== "not_committed_unknown";
    if (apply) {
      w.record = after.bytes;
      if (w.rows) Object.assign(w.rows, inserted);
      if (tx.op === "checkpoint") committedBatches.push([...tx.batch]);
    }
    if (injection) {
      outcomes.push("outcome_unknown");
      unknownTransaction = { kind, recordBefore: before, recordAfter: after.bytes, insertedRows };
      break;
    }
    outcomes.push("confirmed");
    lastConfirmedRecord = after.bytes;
    confirmedRows.push(...insertedRows);
  }

  const died = script.dieBeforeStep !== undefined && outcomes.length === script.dieBeforeStep;
  return {
    world: w,
    outcomes,
    report: died ? null : summarizePlanRun(plan, outcomes),
    surviving: {
      confirmedRows,
      ...(unknownTransaction ? { unknownTransaction } : lastConfirmedRecord !== undefined ? { lastConfirmedRecord } : {}),
    },
    committedBatches,
  };
}

/** Asserts a decision is a plan with the given rule and plan name, and returns the plan. */
export function expectPlan(decision: NativeMigrationDecision, rule: string, name: string): MigrationPlan {
  expect(decision.kind, JSON.stringify(decision)).toBe("plan");
  if (decision.kind !== "plan") throw new Error("unreachable");
  expect(decision.rule).toBe(rule);
  expect(decision.plan.name).toBe(name);
  expect(decision.mountsOrdinaryConsumers).toBe(false);
  return decision.plan;
}

export function expectBlocked(decision: NativeMigrationDecision, rule: string, code?: string): void {
  expect(decision.kind, JSON.stringify(decision)).toBe("blocked");
  if (decision.kind !== "blocked") throw new Error("unreachable");
  expect(decision.rule).toBe(rule);
  expect(decision.mountsOrdinaryConsumers).toBe(false);
  if (code) expect(decision.findings[0].code).toBe(code);
}

export function codes(decision: NativeMigrationDecision): string[] {
  return decision.kind === "blocked" || decision.kind === "fault" ? decision.findings.map((f) => `${f.rule}:${f.code}`) : [];
}

/** The I-12 progress measure of a world: (phase rank, |copied|). */
export function progressOf(w: World): [number, number] {
  if (w.record === null || w.record === "READ_FAILED") return [0, 0];
  const record = parsed(w.record);
  const rank = { enumerating: 1, copying: 2, verified: 3, active: 4 }[record.phase];
  return [rank, record.copied?.length ?? 0];
}
