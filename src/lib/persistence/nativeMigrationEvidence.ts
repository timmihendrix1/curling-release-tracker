// Native-migration evidence collection — Stage M3b4b.
//
// Reads ONE evidence snapshot from the real stores and hands it, unreduced, to
// the approved decision function (`decideNativeMigration`). It decides nothing
// itself: which reads it performs follows the order of docs/MOBILE_APP_MIGRATION.md
// Stage M3b0 §5.4 (L0 → A/A′ → B → C → provenance → E′) only so that it never
// reads what a rule forbids reading:
//
//   - the source and the marker are never read for a latched, unreadable or
//     `active` record (I-3, §5.2: the source is not consulted for access);
//   - an `active` record's live rows are never digested, so nothing compares
//     them with historical manifest fingerprints (§5.4);
//   - on every pre-activation continuation — `verified` included — the
//     complete eligible source set and its content digests are collected (§5.5).
//
// Unavailable evidence is never converted into a smaller truth: a failed listing
// stays `read_failed`, never an empty one; a failed value read is `read_failed`
// or an `unavailable` fingerprint, never absence or a match. Independent
// observations are collected independently, so one failure never hides another,
// and an unreadable record never prevents the row observations a warm fault
// proof may need (I-11's warm exclusion).
//
// Values are read only to be digested or compared and are never placed in a
// report: the snapshot carries fingerprints, and exact bytes only where I-11's
// warm comparison requires them (`targetRowValues`).
import type { MigrationSourceStore } from "./localStorageAdapter";
import type {
  NativeMigrationLease,
  NativeMigrationObservation,
  NativeMigrationRefusal,
  NativeSqliteMigrationTarget,
} from "./nativeSqliteAdapter";
import {
  type FingerprintObservation,
  type KeyObservation,
  type NativeMigrationEvidence,
  type RowValueObservation,
  type StoredValueObservation,
  type SurvivingPlanEvidence,
} from "./nativeMigrationDecision";
import { classifyMigrationSourceKey, isUnsupportedMigrationIdentityControlKey } from "./nativeMigrationEligibility";
import { evaluateActivationRecord, type FingerprintFormatPredicate } from "./nativeMigrationRecord";

/**
 * The injected digest (I-7). It receives one exact value and answers its
 * fingerprint. The algorithm is NOT chosen in this stage; a throw, a rejection or
 * a non-string answer is an `unavailable` fingerprint, never a match.
 */
export type NativeMigrationFingerprint = (value: string) => Promise<string> | string;

export interface EvidenceCollectionDependencies {
  readonly source: MigrationSourceStore;
  readonly target: NativeSqliteMigrationTarget;
  readonly lease: NativeMigrationLease;
  readonly fingerprint: NativeMigrationFingerprint;
  readonly isWellFormedFingerprint: FingerprintFormatPredicate;
  /** The caller's lifecycle, checked after every asynchronous read and digest. */
  readonly alive?: () => boolean;
  /** S3d only: retain POSITIVE warm faults from independent observations before
   * a later callback/await can cancel. True stops; never a grant or I/O permit.
   * Absent on the unchanged standalone collector path. */
  /** Common completion only: bind actual staged raw reads to the held proof. */
  readonly retainHeldTargetRows?: boolean;
  readonly observeWarmTarget?: (evidence: NativeMigrationEvidence) => boolean;
}

export type EvidenceCollection =
  | { readonly status: "collected"; readonly evidence: NativeMigrationEvidence; readonly heldTargetRows?: readonly { readonly key: string; readonly value: string }[] }
  /** The target refused the lease (stale, missing or awaiting a reopen). Nothing is decided. */
  | { readonly status: "refused"; readonly reason: NativeMigrationRefusal }
  /** The caller's lifecycle ended mid-collection. No snapshot exists; nothing is decided. */
  | { readonly status: "cancelled" };

const UNAVAILABLE: FingerprintObservation = Object.freeze({ status: "unavailable" });
const READ_FAILED: StoredValueObservation = Object.freeze({ status: "read_failed" });

/** Digests one exact value. Total: never throws, never inspects what was thrown. */
export async function digestValue(
  fingerprint: NativeMigrationFingerprint,
  value: string
): Promise<FingerprintObservation> {
  try {
    const result = await fingerprint(value);
    return typeof result === "string" ? { status: "computed", value: result } : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

function asStored(observation: NativeMigrationObservation): StoredValueObservation {
  if (observation.status === "present") return { status: "present", bytes: observation.bytes };
  return observation.status === "absent" ? { status: "absent" } : READ_FAILED;
}

/** Which source/target reads the record's state admits, decided from metadata only. */
type RecordReading = "none" | "pre_active" | "staged" | "active" | "unusable";

function readingOf(record: StoredValueObservation, isWellFormed: FingerprintFormatPredicate): RecordReading {
  if (record.status === "absent") return "none";
  if (record.status === "read_failed") return "unusable";
  const evaluated = evaluateActivationRecord(record.bytes, isWellFormed);
  if (!evaluated.ok) return "unusable";
  switch (evaluated.record.phase) {
    case "active":
      return "active";
    case "enumerating":
      return "pre_active";
    default:
      // `copying` and `verified`: staged rows exist and §5.5's content validation applies.
      return "staged";
  }
}

/**
 * Collects one snapshot. `surviving` is the running process's plan memory (I-11);
 * a cold runner passes none and none is invented.
 */
export async function collectNativeMigrationEvidence(
  deps: EvidenceCollectionDependencies,
  surviving?: SurvivingPlanEvidence
): Promise<EvidenceCollection> {
  const { source, target, lease, fingerprint, isWellFormedFingerprint } = deps;
  const ended = (): boolean => {
    try {
      return deps.alive !== undefined && deps.alive() !== true;
    } catch {
      return true;
    }
  };
  const CANCELLED: EvidenceCollection = { status: "cancelled" };
  // Passed into every composite target read, so a cancelled caller's read
  // issues no further query; checked here again after each call returns.
  const control = { proceed: () => !ended() };

  if (ended()) return CANCELLED;
  const reserved = await target.readReserved(lease, control);
  if (ended()) return CANCELLED;
  if (!reserved.ok) return { status: "refused", reason: reserved.reason };
  const latch = asStored(reserved.latch);
  const record = asStored(reserved.record);
  // The observer receives only facts actually obtained so far, never invented
  // absence/health/digests. In particular a complete listing precedes ANY target
  // digest, and individual warm values precede the next native read.
  const partial: { -readonly [K in keyof NativeMigrationEvidence]: NativeMigrationEvidence[K] } = {
    latch, record, ...(surviving ? { survivingPlan: surviving } : {}),
  };
  const warmRows = new Map<string, StoredValueObservation>();
  const issuedKeys = new Set([...(surviving?.confirmedRows ?? []), ...(surviving?.unknownTransaction?.insertedRows ?? [])].map(row => row.key));
  const observe = (): EvidenceCollection | null => {
    if (!deps.observeWarmTarget) return null;
    try {
      // Fresh arrays: later successful observations cannot mutate an earlier
      // snapshot the observer used. Callback can only stop this collection.
      const snapshot = { ...partial, ...(warmRows.size ? { targetRowValues: [...warmRows].map(([key, value]) => ({ key, value })) } : {}) };
      if (deps.observeWarmTarget(snapshot) === true) return { status: "collected", evidence: snapshot };
    } catch { return CANCELLED; }
    return ended() ? CANCELLED : null;
  };
  let stopped = observe(); if (stopped) return stopped;
  if (ended()) return CANCELLED;
  const reading = readingOf(record, isWellFormedFingerprint);
  if (ended()) return CANCELLED;
  let targetHealthy = latch.status !== "read_failed" && record.status !== "read_failed";

  // Target application rows: always listed — B1's current-health probe for an
  // active record, PV1/PV9 and Group E′ otherwise, and key-presence evidence for
  // a warm comparison. Digested only where staged rows are compared (E′4).
  const listing = await target.listApplicationKeys(lease, control);
  if (ended()) return CANCELLED;
  if (listing.status === "refused") return { status: "refused", reason: listing.reason };
  partial.targetRows = listing.status === "read_failed" ? { status: "read_failed" } :
    { status: "listed", entries: listing.keys.map(key => ({ key })) };
  stopped = observe(); if (stopped) return stopped;
  let targetRows: NativeMigrationEvidence["targetRows"];
  const heldTargetRows: { key: string; value: string }[] = [];
  if (listing.status === "read_failed") {
    targetHealthy = false;
    targetRows = { status: "read_failed" };
  } else if (reading === "staged") {
    const collectedValues = new Map<string, NativeMigrationObservation>();
    if (deps.observeWarmTarget) {
      for (const key of listing.keys) {
        if (ended()) return CANCELLED;
        const one = await target.readValues(lease, [key], control);
        if (ended()) return CANCELLED;
        if (!one.ok) return { status: "refused", reason: one.reason };
        const value = one.values.get(key) ?? { status: "read_failed" as const };
        collectedValues.set(key, value);
        if (issuedKeys.has(key)) warmRows.set(key, asStored(value));
        stopped = observe(); if (stopped) return stopped;
      }
    } else {
      const values = await target.readValues(lease, listing.keys, control);
      if (ended()) return CANCELLED;
      if (!values.ok) return { status: "refused", reason: values.reason };
      for (const [key, value] of values.values) collectedValues.set(key, value);
    }
    const entries: KeyObservation[] = [];
    for (const key of listing.keys) {
      // No further digest is invoked once the caller has stopped: a digest that
      // never answers must not keep a disposed collection alive.
      if (ended()) return CANCELLED;
      const value = collectedValues.get(key);
      if (deps.retainHeldTargetRows && value?.status === "present") heldTargetRows.push(Object.freeze({ key, value: value.bytes }));
      if (value === undefined || value.status === "read_failed") targetHealthy = false;
      const digest = value?.status === "present" ? await digestValue(fingerprint, value.bytes) : UNAVAILABLE;
      if (ended()) return CANCELLED;
      entries.push({ key, fingerprint: digest });
    }
    targetRows = { status: "listed", entries };
  } else {
    targetRows = { status: "listed", entries: listing.keys.map((key) => ({ key })) };
  }

  // I-11: the exact bytes of every row the surviving plan issued — independent of
  // the record's readability, so row evidence can still prove a fault.
  let targetRowValues: RowValueObservation[] | undefined;
  if (surviving) {
    const issued = [...new Set([
      ...(surviving.unknownTransaction?.insertedRows ?? []).map((row) => row.key),
      ...surviving.confirmedRows.map((row) => row.key),
    ])].sort();
    if (issued.length > 0) {
      if (deps.observeWarmTarget) {
        targetRowValues = [];
        for (const key of issued) {
          if (ended()) return CANCELLED;
          const one = await target.readValues(lease, [key], control);
          if (ended()) return CANCELLED;
          if (!one.ok) return { status: "refused", reason: one.reason };
          const observation = asStored(one.values.get(key) ?? { status: "read_failed" });
          if (observation.status === "read_failed") targetHealthy = false;
          warmRows.set(key, observation);
          targetRowValues.push({ key, value: observation });
          stopped = observe(); if (stopped) return stopped;
        }
      } else {
        const values = await target.readValues(lease, issued, control);
        if (ended()) return CANCELLED;
        if (!values.ok) return { status: "refused", reason: values.reason };
        targetRowValues = issued.map((key) => {
          const observation = asStored(values.values.get(key) ?? { status: "read_failed" });
          if (observation.status === "read_failed") targetHealthy = false;
          return { key, value: observation };
        });
      }
    } else {
      targetRowValues = [];
    }
  }

  const evidence: {
    -readonly [K in keyof NativeMigrationEvidence]: NativeMigrationEvidence[K];
  } = {
    latch,
    record,
    targetRows,
    targetHealth: { status: targetHealthy ? "healthy" : "failing" },
    ...(surviving ? { survivingPlan: surviving, targetRowValues } : {}),
  };

  // The source and the marker: only for a latch-free target whose record is
  // absent or a valid pre-activation record. Never for `active` (§5.2), never
  // past a latch (L0) and never past an unusable record (Group A).
  if (latch.status === "absent" && (reading === "none" || reading === "pre_active" || reading === "staged")) {
    const keys = await source.listKeys();
    if (ended()) return CANCELLED;
    if (keys.status === "read_failed") {
      evidence.source = { status: "read_failed" };
    } else {
      const entries: KeyObservation[] = [];
      // Decide from the WHOLE observed name set before starting any source
      // value/digest work. Keep target/warm evidence and all names so the normal
      // decision records C1; a known unsupported control must not wait on an
      // unnecessary credential-denial value read.
      const unsupportedControl = keys.keys.some(isUnsupportedMigrationIdentityControlKey);
      for (const key of keys.keys) {
        if (ended()) return CANCELLED;
        // Excluded keys are listed by NAME only; their values are never read.
        if (unsupportedControl || reading !== "staged" || !classifyMigrationSourceKey(key).eligible) {
          entries.push({ key });
          continue;
        }
        const value = await source.readValue(key);
        if (ended()) return CANCELLED;
        const digest = value.status === "value" && value.value !== null
          ? await digestValue(fingerprint, value.value)
          : UNAVAILABLE;
        if (ended()) return CANCELLED;
        entries.push({ key, fingerprint: digest });
      }
      evidence.source = { status: "listed", entries };
    }
    if (ended()) return CANCELLED;
    const marker = await source.readMarker();
    if (ended()) return CANCELLED;
    evidence.marker = marker.status === "read_failed"
      ? READ_FAILED
      : marker.value === null
        ? { status: "absent" }
        : { status: "present", bytes: marker.value };
  }

  return { status: "collected", evidence, ...(deps.retainHeldTargetRows ? { heldTargetRows: Object.freeze(heldTargetRows) } : {}) };
}
