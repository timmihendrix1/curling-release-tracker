// Native-migration activation record — Stage M3b4a (pure decision layer).
//
// Parses and validates the ACTIVATION RECORD's metadata exactly as
// docs/MOBILE_APP_MIGRATION.md Stage M3b0 §5.2 (fields and per-phase shapes) and
// §5.4 Groups A and A′ specify, and builds the exact after-state bytes each
// approved transaction must produce (needed for I-11's warm byte comparison).
//
// This module reads RECORD metadata only. It never parses, repairs or
// re-serialises an application value, and Groups A/A′ never consult a target or
// source row: after activation the manifest, `entryKeys` and `copied` are
// historical metadata, never a constraint on live data (§5.4).
//
// Nothing here performs I/O. No production module imports this file in M3b4a.
import { isCanonicalUuid } from "../uuid";
import { isEligibleMigrationKey } from "./nativeMigrationEligibility";

/** The activation-record schema this build understands (§5.2, A3/A4). */
export const NATIVE_MIGRATION_RECORD_SCHEMA_VERSION = 1;

export type MigrationPhase = "enumerating" | "copying" | "verified" | "active";
export const MIGRATION_PHASES: readonly MigrationPhase[] = Object.freeze([
  "enumerating",
  "copying",
  "verified",
  "active",
]);

export type SourceRetirementState = "not_started" | "in_progress" | "complete";

export interface ManifestEntry {
  readonly key: string;
  readonly fingerprint: string;
}

export interface SourceRetirement {
  readonly state: SourceRetirementState;
  readonly removedKeys: readonly string[];
}

/** A Group-A- and Group-A′-valid record. Optional fields follow the §5.2 shape table. */
export interface ActivationRecord {
  readonly schemaVersion: typeof NATIVE_MIGRATION_RECORD_SCHEMA_VERSION;
  readonly phase: MigrationPhase;
  readonly migrationId: string;
  readonly storeIdentity: string;
  readonly entryKeys?: readonly string[];
  readonly manifest?: readonly ManifestEntry[];
  readonly copied?: readonly string[];
  readonly activatedAt?: string;
  readonly sourceRetirement?: SourceRetirement;
}

/** A pure, synchronous format check for a precomputed fingerprint (I-7). The algorithm is not chosen here. */
export type FingerprintFormatPredicate = (value: string) => boolean;

export type RecordRule = "A2" | "A3" | "A4" | "A5" | "A6" | "A′1" | "A′2" | "A′3" | "A′4" | "A′5" | "A′6" | "A′7";

export type RecordReasonCode =
  | "record_unparseable"
  | "record_not_object"
  | "record_phase_invalid"
  | "record_schema_version_invalid"
  | "record_schema_newer"
  | "record_schema_older"
  | "record_unknown_field"
  | "copied_malformed"
  | "copied_duplicate"
  | "activated_at_malformed"
  | "source_retirement_malformed"
  | "manifest_malformed"
  | "manifest_absent"
  | "copied_not_subset_of_manifest"
  | "identifier_not_canonical"
  | "field_present_contrary_to_phase"
  | "field_absent_contrary_to_phase"
  | "entry_keys_malformed"
  | "entry_keys_duplicate"
  | "entry_keys_ineligible"
  | "entry_keys_empty"
  | "manifest_duplicate_key"
  | "manifest_ineligible_key"
  | "manifest_fingerprint_malformed"
  | "manifest_empty"
  | "entry_keys_not_in_manifest"
  | "copied_incomplete"
  | "active_lists_inconsistent";

export interface RecordFinding {
  readonly rule: RecordRule;
  readonly code: RecordReasonCode;
  /** Field names or key names only — never an application value. */
  readonly detail?: readonly string[];
}

export type RecordEvaluation =
  | { readonly ok: true; readonly record: ActivationRecord }
  | { readonly ok: false; readonly rule: RecordRule; readonly findings: readonly RecordFinding[] };

const RULE_ORDER: readonly RecordRule[] = [
  "A2", "A3", "A4", "A5", "A6", "A′1", "A′2", "A′3", "A′4", "A′5", "A′6", "A′7",
];

const KNOWN_FIELDS: ReadonlySet<string> = new Set([
  "schemaVersion",
  "phase",
  "migrationId",
  "storeIdentity",
  "entryKeys",
  "manifest",
  "copied",
  "activatedAt",
  "sourceRetirement",
]);

const RETIREMENT_STATES: ReadonlySet<string> = new Set(["not_started", "in_progress", "complete"]);

/** Field presence per phase (§5.2's shape table). `true` = must be present, `false` = must be absent. */
const SHAPE: Readonly<Record<MigrationPhase, Readonly<Record<string, boolean>>>> = {
  enumerating: { entryKeys: true, manifest: false, copied: false, activatedAt: false, sourceRetirement: false },
  copying: { entryKeys: true, manifest: true, copied: true, activatedAt: false, sourceRetirement: false },
  verified: { entryKeys: true, manifest: true, copied: true, activatedAt: false, sourceRetirement: false },
  active: { entryKeys: true, manifest: true, copied: true, activatedAt: true, sourceRetirement: true },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) dup.add(value);
    seen.add(value);
  }
  return [...dup].sort();
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function isManifestEntryShape(value: unknown): value is ManifestEntry {
  return isPlainObject(value) && Object.keys(value).length === 2 &&
    typeof value.key === "string" && typeof value.fingerprint === "string";
}

/**
 * A strict UTC ISO-8601 timestamp, as `Date.prototype.toISOString` writes it. Strict
 * on purpose: a lenient parser would let arbitrary text ride along in a field whose
 * canonical form a fault latch's diagnostics may carry (I-13).
 */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function stop(rule: RecordRule, code: RecordReasonCode, detail?: readonly string[]): RecordEvaluation {
  return { ok: false, rule, findings: [detail ? { rule, code, detail } : { rule, code }] };
}

/**
 * Groups A (A2–A6) and A′ (A′1–A′7) over the raw record bytes. A1 (an unreadable
 * record) is decided by the caller of this function, which never receives bytes in
 * that case. An unparseable, non-object, invalid-phase or unsupported-version
 * record stops at once: nothing about it is safely interpretable. Otherwise every
 * applicable failing check is reported, and the first in canonical order governs.
 */
export function evaluateActivationRecord(
  bytes: string,
  isWellFormedFingerprint: FingerprintFormatPredicate
): RecordEvaluation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes);
  } catch {
    return stop("A2", "record_unparseable");
  }
  if (!isPlainObject(parsed)) return stop("A2", "record_not_object");
  const raw = parsed;
  const core: RecordFinding[] = [];
  if (typeof raw.phase !== "string" || !(MIGRATION_PHASES as readonly string[]).includes(raw.phase)) {
    core.push({ rule: "A2", code: "record_phase_invalid" });
  }
  if (typeof raw.schemaVersion !== "number" || !Number.isInteger(raw.schemaVersion)) {
    core.push({ rule: "A2", code: "record_schema_version_invalid" });
  }
  if (core.length > 0) return { ok: false, rule: "A2", findings: core };
  const schemaVersion = raw.schemaVersion as number;
  if (schemaVersion > NATIVE_MIGRATION_RECORD_SCHEMA_VERSION) return stop("A3", "record_schema_newer");
  if (schemaVersion < NATIVE_MIGRATION_RECORD_SCHEMA_VERSION) return stop("A4", "record_schema_older");
  const phase = raw.phase as MigrationPhase;

  const findings: RecordFinding[] = [];
  const add = (rule: RecordRule, code: RecordReasonCode, detail?: readonly string[]) =>
    findings.push(detail && detail.length > 0 ? { rule, code, detail } : { rule, code });

  // A2 — field-level malformation of a v1 record.
  // Unknown field NAMES are untrusted content: reported by code only, never echoed.
  if (Object.keys(raw).some((field) => !KNOWN_FIELDS.has(field))) add("A2", "record_unknown_field");
  const copiedPresent = "copied" in raw;
  const copiedOk = !copiedPresent || isStringArray(raw.copied);
  if (!copiedOk) add("A2", "copied_malformed");
  else if (copiedPresent && duplicatesOf(raw.copied as string[]).length > 0) {
    add("A2", "copied_duplicate", duplicatesOf(raw.copied as string[]));
  }
  if ("activatedAt" in raw && !isValidTimestamp(raw.activatedAt)) add("A2", "activated_at_malformed");
  const copiedList: readonly string[] | null = copiedPresent && copiedOk ? (raw.copied as string[]) : null;
  if ("sourceRetirement" in raw) {
    const sr = raw.sourceRetirement;
    const shapeOk = isPlainObject(sr) && Object.keys(sr).length === 2 &&
      typeof sr.state === "string" && RETIREMENT_STATES.has(sr.state) && isStringArray(sr.removedKeys) &&
      duplicatesOf(sr.removedKeys).length === 0;
    const withinCopied = shapeOk && copiedList !== null &&
      (sr.removedKeys as string[]).every((key) => copiedList.includes(key));
    if (!shapeOk || !withinCopied) add("A2", "source_retirement_malformed");
  }

  // A5 — manifest structure and presence.
  const manifestPresent = "manifest" in raw;
  const manifestStructured = manifestPresent && Array.isArray(raw.manifest) &&
    (raw.manifest as unknown[]).every(isManifestEntryShape);
  if (manifestPresent && !manifestStructured) add("A5", "manifest_malformed");
  if (!manifestPresent && phase !== "enumerating") add("A5", "manifest_absent");
  const manifest: readonly ManifestEntry[] | null = manifestStructured ? (raw.manifest as ManifestEntry[]) : null;
  const manifestKeys: readonly string[] | null = manifest ? manifest.map((entry) => entry.key) : null;

  // A6 — `copied` must be a subset of the manifest.
  if (copiedList && manifestKeys) {
    const outside = copiedList.filter((key) => !manifestKeys.includes(key)).sort();
    if (outside.length > 0) add("A6", "copied_not_subset_of_manifest", outside);
  }

  // A′1 — canonical identifiers.
  const badIds = ["migrationId", "storeIdentity"].filter((field) => !isCanonicalUuid(raw[field]));
  if (badIds.length > 0) add("A′1", "identifier_not_canonical", badIds);

  // A′2 — presence and absence per phase. A missing manifest is already A5.
  const required = SHAPE[phase];
  const unexpected = Object.keys(required).filter((field) => !required[field] && field in raw).sort();
  const missing = Object.keys(required)
    .filter((field) => required[field] && !(field in raw) && field !== "manifest")
    .sort();
  if (unexpected.length > 0) add("A′2", "field_present_contrary_to_phase", unexpected);
  if (missing.length > 0) add("A′2", "field_absent_contrary_to_phase", missing);

  // A′3 — entryKeys.
  let entryKeys: readonly string[] | null = null;
  if ("entryKeys" in raw) {
    if (!isStringArray(raw.entryKeys)) {
      add("A′3", "entry_keys_malformed");
    } else {
      entryKeys = raw.entryKeys;
      const dup = duplicatesOf(entryKeys);
      if (dup.length > 0) add("A′3", "entry_keys_duplicate", dup);
      const ineligible = entryKeys.filter((key) => !isEligibleMigrationKey(key)).sort();
      if (ineligible.length > 0) add("A′3", "entry_keys_ineligible", ineligible);
      if (entryKeys.length === 0 && phase !== "active") add("A′3", "entry_keys_empty");
    }
  }

  // A′4 — manifest content.
  if (manifest && manifestKeys) {
    const dup = duplicatesOf(manifestKeys);
    if (dup.length > 0) add("A′4", "manifest_duplicate_key", dup);
    const ineligible = manifestKeys.filter((key) => !isEligibleMigrationKey(key)).sort();
    if (ineligible.length > 0) add("A′4", "manifest_ineligible_key", ineligible);
    const badFingerprints = manifest
      .filter((entry) => !safeFormat(isWellFormedFingerprint, entry.fingerprint))
      .map((entry) => entry.key)
      .sort();
    if (badFingerprints.length > 0) add("A′4", "manifest_fingerprint_malformed", badFingerprints);
    if (manifest.length === 0 && (phase === "copying" || phase === "verified")) add("A′4", "manifest_empty");
  }

  // A′5 — entryKeys ⊆ manifest from `copying` on (and in a migrated `active` record).
  const migratedActive = phase === "active" && manifest !== null && manifest.length > 0;
  if (entryKeys && manifestKeys && (phase === "copying" || phase === "verified" || migratedActive)) {
    const outside = entryKeys.filter((key) => !manifestKeys.includes(key)).sort();
    if (outside.length > 0) add("A′5", "entry_keys_not_in_manifest", outside);
  }

  // A′6 — `verified` and `active` require complete progress.
  if ((phase === "verified" || phase === "active") && copiedList && manifestKeys &&
      !sameSet(copiedList, manifestKeys)) {
    add("A′6", "copied_incomplete", manifestKeys.filter((key) => !copiedList.includes(key)).sort());
  }

  // A′7 — an `active` record is either the D1 shape (all empty) or migrated (all non-empty).
  if (phase === "active" && entryKeys && manifest && copiedList) {
    const empties = [entryKeys.length === 0, manifest.length === 0, copiedList.length === 0];
    if (empties.some(Boolean) && !empties.every(Boolean)) add("A′7", "active_lists_inconsistent");
  }

  if (findings.length > 0) {
    const ordered = [...findings].sort((a, b) => RULE_ORDER.indexOf(a.rule) - RULE_ORDER.indexOf(b.rule));
    return { ok: false, rule: ordered[0].rule, findings: ordered };
  }
  return {
    ok: true,
    record: Object.freeze({
      schemaVersion: NATIVE_MIGRATION_RECORD_SCHEMA_VERSION,
      phase,
      migrationId: raw.migrationId as string,
      storeIdentity: raw.storeIdentity as string,
      ...(entryKeys ? { entryKeys: Object.freeze([...entryKeys]) } : {}),
      ...(manifest ? { manifest: Object.freeze(manifest.map((entry) => Object.freeze({ ...entry }))) } : {}),
      ...(copiedList ? { copied: Object.freeze([...copiedList]) } : {}),
      ...(typeof raw.activatedAt === "string" ? { activatedAt: raw.activatedAt } : {}),
      ...(isPlainObject(raw.sourceRetirement)
        ? {
            sourceRetirement: Object.freeze({
              state: raw.sourceRetirement.state as SourceRetirementState,
              removedKeys: Object.freeze([...(raw.sourceRetirement.removedKeys as string[])]),
            }),
          }
        : {}),
    }),
  };
}

/** A predicate that throws or answers non-boolean counts as "not well-formed". */
export function safeFormat(predicate: FingerprintFormatPredicate, value: string): boolean {
  try {
    return predicate(value) === true;
  } catch {
    return false;
  }
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

/**
 * The canonical byte form of a record: fixed field order, sorted key lists. The
 * issuing process derives *R-after* with it (I-11); nothing parses an
 * application value to produce it.
 */
export function serializeActivationRecord(record: ActivationRecord): string {
  const ordered: Record<string, unknown> = {
    schemaVersion: record.schemaVersion,
    phase: record.phase,
    migrationId: record.migrationId,
    storeIdentity: record.storeIdentity,
  };
  if (record.entryKeys) ordered.entryKeys = sorted(record.entryKeys);
  if (record.manifest) {
    ordered.manifest = [...record.manifest]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((entry) => ({ key: entry.key, fingerprint: entry.fingerprint }));
  }
  if (record.copied) ordered.copied = sorted(record.copied);
  if (record.activatedAt !== undefined) ordered.activatedAt = record.activatedAt;
  if (record.sourceRetirement) {
    ordered.sourceRetirement = {
      state: record.sourceRetirement.state,
      removedKeys: sorted(record.sourceRetirement.removedKeys),
    };
  }
  return JSON.stringify(ordered);
}

/**
 * The record transitions the approved plans issue (§5.4a). Values a pure function
 * cannot produce — fresh UUIDs, a timestamp, digests read during the plan — are
 * explicit inputs supplied by the executor, never invented here.
 */
export type RecordTransition =
  | { readonly kind: "create_fresh_active"; readonly migrationId: string; readonly storeIdentity: string; readonly activatedAt: string }
  | { readonly kind: "create_enumerating"; readonly migrationId: string; readonly storeIdentity: string; readonly entryKeys: readonly string[] }
  | { readonly kind: "replace_enumerating"; readonly migrationId: string; readonly entryKeys: readonly string[] }
  | { readonly kind: "begin_copying"; readonly manifest: readonly ManifestEntry[] }
  | { readonly kind: "checkpoint"; readonly batch: readonly string[] }
  | { readonly kind: "complete_copying" }
  | { readonly kind: "activate"; readonly activatedAt: string };

export type RecordTransitionResult =
  | { readonly ok: true; readonly record: ActivationRecord; readonly bytes: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Builds the exact after-state of one transition from the exact before-state. It
 * refuses a transition the approved plans never issue from that state, so an
 * executor cannot produce, and a warm comparison cannot accept, an after-state the
 * specification does not define.
 */
export function buildRecordAfter(
  before: ActivationRecord | null,
  transition: RecordTransition
): RecordTransitionResult {
  const done = (record: ActivationRecord): RecordTransitionResult =>
    ({ ok: true, record, bytes: serializeActivationRecord(record) });
  const refuse = (reason: string): RecordTransitionResult => ({ ok: false, reason });
  switch (transition.kind) {
    case "create_fresh_active":
      if (before !== null) return refuse("record_already_exists");
      return done({
        schemaVersion: NATIVE_MIGRATION_RECORD_SCHEMA_VERSION,
        phase: "active",
        migrationId: transition.migrationId,
        storeIdentity: transition.storeIdentity,
        entryKeys: [],
        manifest: [],
        copied: [],
        activatedAt: transition.activatedAt,
        // Nothing was migrated, so nothing is ever retired.
        sourceRetirement: { state: "complete", removedKeys: [] },
      });
    case "create_enumerating":
      if (before !== null) return refuse("record_already_exists");
      if (transition.entryKeys.length === 0) return refuse("entry_keys_empty");
      return done({
        schemaVersion: NATIVE_MIGRATION_RECORD_SCHEMA_VERSION,
        phase: "enumerating",
        migrationId: transition.migrationId,
        storeIdentity: transition.storeIdentity,
        entryKeys: sorted(transition.entryKeys),
      });
    case "replace_enumerating": {
      if (before === null || before.phase !== "enumerating") return refuse("not_enumerating");
      const previous = before.entryKeys ?? [];
      if (!previous.every((key) => transition.entryKeys.includes(key))) return refuse("entry_keys_shrunk");
      return done({ ...before, migrationId: transition.migrationId, entryKeys: sorted(transition.entryKeys) });
    }
    case "begin_copying": {
      if (before === null || before.phase !== "enumerating") return refuse("not_enumerating");
      const keys = transition.manifest.map((entry) => entry.key);
      if (keys.length === 0) return refuse("manifest_empty");
      if (!(before.entryKeys ?? []).every((key) => keys.includes(key))) return refuse("entry_key_missing");
      return done({ ...before, phase: "copying", manifest: transition.manifest, copied: [] });
    }
    case "checkpoint": {
      if (before === null || before.phase !== "copying") return refuse("not_copying");
      const manifestKeys = (before.manifest ?? []).map((entry) => entry.key);
      const copied = before.copied ?? [];
      if (transition.batch.length === 0) return refuse("empty_batch");
      if (!transition.batch.every((key) => manifestKeys.includes(key) && !copied.includes(key))) {
        return refuse("batch_not_remaining");
      }
      return done({ ...before, copied: sorted([...copied, ...transition.batch]) });
    }
    case "complete_copying":
      if (before === null || before.phase !== "copying") return refuse("not_copying");
      return done({ ...before, phase: "verified" });
    case "activate":
      if (before === null || before.phase !== "verified") return refuse("not_verified");
      return done({
        ...before,
        phase: "active",
        activatedAt: transition.activatedAt,
        sourceRetirement: { state: "not_started", removedKeys: [] },
      });
  }
}
