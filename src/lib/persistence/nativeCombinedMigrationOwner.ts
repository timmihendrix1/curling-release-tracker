// Dormant common executor. Source retirement requires the explicit S3i owner.
import { createNativeCombinedWebViewSource, createNativeNewUserWebViewSource, acquireNativeCredentialRetirementSource, type NativeCredentialRetirementSource, type NativeRetirementSourceProof, type NativeCombinedSourceCapture, type NativeCombinedSourceProof } from "./localStorageAdapter";
import { createNativeCommonCredentialMigrationPort, type NativeCredentialMigrationPort, type CredentialSlotObservation, prepareNativeCredentialRuntime } from "./nativeCredentialMigrationPort";
import type { CredentialNamespaceLease } from "./nativeCredentialNamespace";
import type { NativeCommonSqliteContext, NativeCommonSqlSnapshot, NativeMigrationLease, NativeMigrationTransactionResult, NativeSqliteStoreOptions } from "./nativeSqliteAdapter";
import { createNativeCommonHeldDomainMigrationRunner, type NativeHeldDomainMigrationRunner, type NativeMigrationLimits } from "./nativeMigrationRunner";
import { observeBorrowedFingerprintFormat, observeUnexpectedBorrowedAsync, createNativeCommonMigrationControl } from "./nativeMigrationBorrowEvidence";
import { classifyMigrationSourceKey, isUnsupportedMigrationIdentityControlKey } from "./nativeMigrationEligibility";
import { evaluateActivationRecord } from "./nativeMigrationRecord";
import { parseQ as protocolParseQ, parseM as protocolParseM, parseI as protocolParseI, serializeQ as protocolSerializeQ, serializeM as protocolSerializeM, serializeI as protocolSerializeI, serializeF, correlatePair as protocolCorrelatePair, validateFrozenCopy as protocolValidateFrozenCopy, LEGACY_CREDENTIAL_CONTRACT, NEW_USER_CREDENTIAL_CONTRACT, type Q, type M, type F, type Fingerprint, type FingerprintFormat } from "./credentialProtocol";
import { credentialManifestSlot, credentialItemSlot, parseCredentialPhysicalSlot } from "./credentialPhysicalSlots";
import { fixedCredentialSlots } from "../supabase/providerCredentialContract";
import { isCanonicalUuid } from "../uuid";
import { detectRuntimePlatform } from "../platform/runtimePlatform";

import { createNativeRuntimeSession, abandonNativeRuntimeSession, publishNativeCombinedRuntime, type NativeCombinedRuntimePair, type NativeRuntimeDomainDraft, type NativeRuntimeCredentialDraft } from "./nativeCombinedRuntime";

declare const commonCandidate: unique symbol;
export type NativeCommonCompletionCandidate = { readonly [commonCandidate]: true };
export type NativeCommonMigrationReport =
  | { readonly outcome: "candidate"; readonly candidate: NativeCommonCompletionCandidate }
  | { readonly outcome: "blocked"; readonly code: "unavailable" | "unsupported_platform" | "unsupported_source" | "source_changed_before_manifest" | "domain_not_prepared" | "target_not_empty" }
  | { readonly outcome: "fault"; readonly code: F["code"]; readonly faultWriteAttempts: number }
  | { readonly outcome: "recovery_required"; readonly boundary: "sql" | "protected" }
  | { readonly outcome: "incomplete" | "disposed" | "recovered" };
export interface NativeCommonMigrationOwner {
  run(): Promise<NativeCommonMigrationReport>;
  recover(): Promise<NativeCommonMigrationReport>;
  dispose(): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: "evidence_held" | "cleanup_unconfirmed" }>;
  isCurrentCandidate(candidate: unknown): boolean;
}
export interface NativeCommonMigrationOptions {
  readonly sqlite: NativeSqliteStoreOptions;
  readonly providerConfigIdentity: string;
  readonly sessionStorageKey: string;
  readonly protectedBinding?: unknown;
  readonly detectPlatform?: () => unknown;
  readonly domainFingerprint: (value: string) => string | Promise<string>;
  readonly domainFingerprintFormat: FingerprintFormat;
  readonly credentialFingerprint: Fingerprint;
  readonly credentialFingerprintFormat: FingerprintFormat;
  readonly generateUuid: () => string;
  readonly now: () => string;
  readonly limits: NativeMigrationLimits & { readonly protocolStepLimit: number; readonly faultWriteAttemptLimit: number };
}
export type NativeCommonRuntimeHandoffReport = { readonly outcome: "runtime"; readonly pair: NativeCombinedRuntimePair } | { readonly outcome: "refused" };
export interface NativeCommonRuntimeOwner extends NativeCommonMigrationOwner { handoff(candidate: unknown): Promise<NativeCommonRuntimeHandoffReport> }
type RetirementCode = "unavailable" | "source_changed" | "unsupported_source" | "target_not_original" | "operation_unverified" | "cancelled";
type RetirementCounts = {
  readonly removeIssued: number; readonly removeAcknowledged: number; readonly removeVerified: number; readonly observedAbsent: number;
  readonly firstUnverified: null | Readonly<{ removeIssued: boolean; removeAcknowledged: boolean; absenceReadIssued: boolean; absenceReadAcknowledged: boolean; absenceVerified: false }>;
};
export type NativeCommonRetirementReport =
  | (RetirementCounts & { readonly outcome: "retired" | "source_absent"; readonly candidate: NativeCommonCompletionCandidate })
  | (RetirementCounts & { readonly outcome: "incomplete"; readonly code: RetirementCode })
  | (RetirementCounts & { readonly outcome: "refused" });
export interface NativeCommonRetirementOwner extends NativeCommonRuntimeOwner { retire(candidate: unknown): Promise<NativeCommonRetirementReport> }
const unwrap = <T,>(result: { ok: true; value: T } | { ok: false }): T => { if (!result.ok) throw new Error("Migration evidence unavailable"); return result.value; };
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((key, index) => key === b[index]);
type Capture = Extract<NativeCombinedSourceCapture, { status: "captured" }>;
type ProtectedCopy = { items: { itemId: string; key: string; result: { status: "value"; raw: string } }[]; fixedItemAbsences: { kind: string; key: string; result: { status: "absent" } }[] };
const positiveInteger = (value: number) => Number.isSafeInteger(value) && value > 0;

export function createNativeCombinedMigrationOwner(input: NativeCommonMigrationOptions):
  { readonly ok: true; readonly owner: NativeCommonMigrationOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" } {
  return buildNativeCombinedOwner(input, false);
}
export function createNativeCombinedRuntimeOwner(input: NativeCommonMigrationOptions):
  { readonly ok: true; readonly owner: NativeCommonRuntimeOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" } {
  return buildNativeCombinedOwner(input, true) as { readonly ok: true; readonly owner: NativeCommonRuntimeOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" };
}
export function createNativeCombinedRetirementOwner(input: NativeCommonMigrationOptions):
  { readonly ok: true; readonly owner: NativeCommonRetirementOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" } {
  return buildNativeCombinedOwner(input, true, true) as { readonly ok: true; readonly owner: NativeCommonRetirementOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" };
}
/** Strict dormant new-installation lane; no legacy credential retirement rights. */
export function createNativeNewUserRuntimeOwner(input: NativeCommonMigrationOptions):
  { readonly ok: true; readonly owner: NativeCommonRuntimeOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" } {
  return buildNativeCombinedOwner(input, true, false, true) as { readonly ok: true; readonly owner: NativeCommonRuntimeOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" };
}
function buildNativeCombinedOwner(input: NativeCommonMigrationOptions, enableRuntime: boolean, enableRetirement = false, newUser = false):
  { readonly ok: true; readonly owner: NativeCommonMigrationOwner } | { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" } {
  const sdkVersion = newUser ? NEW_USER_CREDENTIAL_CONTRACT : LEGACY_CREDENTIAL_CONTRACT;
  const parseQ = (raw: unknown) => protocolParseQ(raw, sdkVersion);
  const parseM = (raw: unknown, format: unknown) => protocolParseM(raw, format, sdkVersion);
  const parseI = (raw: unknown, root?: unknown, pair?: unknown) => protocolParseI(raw, root, pair, sdkVersion);
  const serializeQ = (input: unknown) => protocolSerializeQ(input, sdkVersion);
  const serializeM = (input: unknown, format: unknown) => protocolSerializeM(input, format, sdkVersion);
  const serializeI = (input: unknown, root?: unknown) => protocolSerializeI(input, root, sdkVersion);
  const correlatePair = (q: unknown, m: unknown, d: unknown) => protocolCorrelatePair(q, m, d, sdkVersion);
  const validateFrozenCopy = (q: unknown, m: unknown, source: unknown, target: unknown, fingerprint: unknown, format: unknown) => protocolValidateFrozenCopy(q, m, source, target, fingerprint, format, sdkVersion);
  let options: NativeCommonMigrationOptions, config: string, root: string, manifestSlot: string;
  try {
    options = Object.freeze({ sqlite: Object.freeze({ databaseName: input.sqlite.databaseName, engine: input.sqlite.engine, detectPlatform: input.sqlite.detectPlatform }),
      providerConfigIdentity: input.providerConfigIdentity, sessionStorageKey: input.sessionStorageKey, protectedBinding: input.protectedBinding,
      detectPlatform: input.detectPlatform ?? detectRuntimePlatform, domainFingerprint: input.domainFingerprint, domainFingerprintFormat: input.domainFingerprintFormat,
      credentialFingerprint: input.credentialFingerprint, credentialFingerprintFormat: input.credentialFingerprintFormat,
      generateUuid: input.generateUuid, now: input.now, limits: Object.freeze({ ...input.limits }) });
    if (typeof options.sqlite.databaseName !== "string" || !options.sqlite.databaseName ||
      [options.detectPlatform, options.domainFingerprint, options.domainFingerprintFormat, options.credentialFingerprint, options.credentialFingerprintFormat, options.generateUuid, options.now].some(fn => typeof fn !== "function") ||
      [options.limits.checkpointBatchKeyLimit, options.limits.latchWriteAttemptLimit, options.limits.maxPlansPerRun, options.limits.protocolStepLimit, options.limits.faultWriteAttemptLimit].some(value => !positiveInteger(value))) return { ok: false, reason: "invalid_dependency" };
    config = options.providerConfigIdentity; root = options.sessionStorageKey;
    const slot = credentialManifestSlot(config); if (!slot.ok || !parseCredentialPhysicalSlot(config, root, slot.value).ok) return { ok: false, reason: "invalid_configuration" };
    manifestSlot = slot.value;
  } catch { return { ok: false, reason: "invalid_dependency" }; }
  const source = newUser ? createNativeNewUserWebViewSource(root) : createNativeCombinedWebViewSource(root);
  let sql: NativeCommonSqliteContext | null = null, sqlLease: NativeMigrationLease | null = null, protectedLease: CredentialNamespaceLease | null = null;
  let child: NativeHeldDomainMigrationRunner | null = null;
  let disposed = false, retained = false, completed = false, transferred = false;
  let handoffFlight: Promise<NativeCommonRuntimeHandoffReport> | null = null, handoffToken: unknown = null;
  let boundSnapshot: NativeCommonSqlSnapshot | null = null;
  const expiredControl = createNativeCommonMigrationControl(); expiredControl.cancel();
  let normalControl = createNativeCommonMigrationControl(), lifetimeControl = createNativeCommonMigrationControl();
  let credentialFormatUnavailable = false;
  let lifecycle: object = Object.freeze({}), inFlight: Promise<NativeCommonMigrationReport> | null = null, recovering: Promise<NativeCommonMigrationReport> | null = null;
  let needsSqlRecovery = false, needsProtectedRecovery = false;
  let currentQ: Q | null = null, boundMode = false, manifest: M | null = null;
  let fault: F | null = null, faultAttempts = 0;
  let pendingIntent: string | null = null, finalMetadata: { migrationId: string; activatedAt: string } | null = null;
  let frozenSource: NativeCombinedSourceProof | null = null, plannedManifest: { raw: string; source: NativeCombinedSourceProof } | null = null;
  const knownProtected = new Map<string, string>();
  let candidate: { token: NativeCommonCompletionCandidate; lifecycle: object } | null = null;
  let retirementBusy = false, retirementToken: unknown = null;
  let retirementFlight: Promise<NativeCommonRetirementReport> | null = null;
  let retirementSource: NativeCredentialRetirementSource | null = null;
  let retirementApproval: { token: NativeCommonCompletionCandidate; stamp: object; proof: NativeRetirementSourceProof; source: NativeCredentialRetirementSource } | null = null;
  function cancelRetirement(): NativeCredentialRetirementSource | null {
    retirementApproval = null;
    const prior = retirementSource; prior?.cancel(); return prior;
  }
  function setFault(code: F["code"], operation: F["operation"] = "read"): void {
    if (!fault) fault = Object.freeze({ schemaVersion: 1, code, phase: boundMode ? "bound" : currentQ?.phase ?? "preflight", operation });
    retained = true; candidate = null; normalControl.cancel();
  }
  function itemSlot(q: Q, key: string): string { return unwrap(credentialItemSlot(config, root, q.credentialEpochId, key)); }
  function namespaceFact(keys: readonly string[]): void {
    const listed = new Set(keys);
    for (const key of knownProtected.keys()) if ((key === manifestSlot || !boundMode) && !listed.has(key)) setFault("protected_evidence_lost", "enumerate");
    if (currentQ === null) { if (keys.length) setFault("namespace_unproven", "enumerate"); return; }
    if (!boundMode) for (let rank = 0; rank < currentQ.verifiedItemIds.length; rank++) if (!listed.has(itemSlot(currentQ, currentQ.initialEntryKeys[rank]))) setFault("protected_evidence_lost", "enumerate");
    for (const key of keys) {
      const parsed = parseCredentialPhysicalSlot(config, root, key);
      if (!parsed.ok) { setFault("namespace_unproven", "enumerate"); continue; }
      if (parsed.value.kind === "manifest") continue;
      if (parsed.value.epoch !== currentQ.credentialEpochId) { setFault("pairing_mismatch", "enumerate"); continue; }
      if (!boundMode) {
        const rank = currentQ.initialEntryKeys.indexOf(parsed.value.key);
        if (rank < 0 || currentQ.phase === "intent" || currentQ.phase === "manifest_confirmed" || rank > currentQ.verifiedItemIds.length) setFault("namespace_unproven", "enumerate");
      }
    }
  }
  function slotFact(slot: string, observation: { status: "absent" } | { status: "value"; value: string }): void {
    const before = knownProtected.get(slot);
    if ((slot === manifestSlot || !boundMode) && before !== undefined && (observation.status !== "value" || observation.value !== before)) setFault("protected_evidence_lost");
    if (observation.status === "value") {
      if (slot === manifestSlot || !boundMode) knownProtected.set(slot, before ?? observation.value);
      if (slot === manifestSlot && plannedManifest?.raw === observation.value) frozenSource = plannedManifest.source;
      if (!boundMode && manifest) for (const fixed of manifest.fixedSlots) if (fixed.presence === "absent" && itemSlot(currentQ as Q, fixed.key) === slot) setFault("pairing_mismatch");
    }
  }
  function platform(): unknown {
    const value = options.detectPlatform!();
    if (value !== "ios") observeUnexpectedBorrowedAsync(value);
    return value;
  }
  const builtPort = createNativeCommonCredentialMigrationPort({ providerConfigIdentity: config, sessionStorageKey: root,
    ...(options.protectedBinding === undefined ? {} : { binding: options.protectedBinding }), detectPlatform: platform }, { inventory: namespaceFact, slot: slotFact }, sdkVersion);
  if (!builtPort.ok) return builtPort;
  const port: NativeCredentialMigrationPort = builtPort.value;
  const blocked = (code: Extract<NativeCommonMigrationReport, { outcome: "blocked" }>["code"] = "unavailable"): NativeCommonMigrationReport => ({ outcome: "blocked", code });
  const alive = (stamp: object) => !disposed && lifecycle === stamp;
  const permitted = (stamp: object) => alive(stamp) && fault === null;
  const control = (stamp: object) => alive(stamp) ? normalControl.control : expiredControl.control;
  function uuid(stamp: object): string {
    const value: unknown = options.generateUuid();
    if (typeof value !== "string") observeUnexpectedBorrowedAsync(value);
    if (!alive(stamp) || typeof value !== "string" || !isCanonicalUuid(value)) throw new Error("Migration identifier unavailable"); return value;
  }
  function clock(stamp: object): string {
    const value: unknown = options.now();
    if (typeof value !== "string") observeUnexpectedBorrowedAsync(value);
    if (!alive(stamp) || typeof value !== "string") throw new Error("Migration clock unavailable"); return value;
  }
  function credentialFormat(value: string): boolean {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) return false;
    const result = observeBorrowedFingerprintFormat(options.credentialFingerprintFormat, value);
    if (result === "unavailable") credentialFormatUnavailable = true;
    return result === "valid";
  }
  function domainRecord(stamp: object, raw: string) {
    let unavailable = false;
    const evaluated = evaluateActivationRecord(raw, value => {
      if (!permitted(stamp)) return false;
      const result = observeBorrowedFingerprintFormat(options.domainFingerprintFormat, value);
      if (result === "unavailable") unavailable = true;
      return result === "valid" && permitted(stamp);
    });
    return { evaluated, unavailable };
  }
  async function fingerprint(stamp: object, key: string, raw: string): Promise<string | null> {
    if (!permitted(stamp)) return null;
    try { const value = await options.credentialFingerprint("credential-value/v1", key, raw); return permitted(stamp) && credentialFormat(value) && permitted(stamp) ? value : null; }
    catch { return null; }
  }
  async function faultReport(stamp: object): Promise<NativeCommonMigrationReport> {
    if (!fault) return blocked();
    if (sql && sqlLease && sql.host.leaseState() === "owned" && faultAttempts < options.limits.faultWriteAttemptLimit && alive(stamp)) {
      const raw = serializeF(fault);
      if (raw.ok) {
        const result = await sql.recordFault(sqlLease, raw.value, lifetimeControl.control);
        if (result.status === "confirmed" || result.status === "outcome_unknown" || (result.status === "not_committed" && result.writeIssued)) faultAttempts++;
        if (result.status === "outcome_unknown" || (result.status === "not_committed" && result.connection === "uncertain")) needsSqlRecovery = true;
      }
    }
    return { outcome: "fault", code: fault.code, faultWriteAttempts: faultAttempts };
  }
  function transaction(result: NativeMigrationTransactionResult): NativeCommonMigrationReport | null {
    retained = retained || result.status === "confirmed" || result.status === "outcome_unknown" || (result.status === "not_committed" && result.writeIssued);
    if (result.status === "confirmed") return null;
    if (result.status === "not_committed" && result.reason === "source_changed") setFault("source_changed", "write_q");
    if (sql && sqlLease && sql.failed(sqlLease)) setFault("sql_evidence_mismatch", "write_q");
    needsSqlRecovery = true;
    return { outcome: "recovery_required", boundary: "sql" };
  }
  async function inventory(stamp: object): Promise<readonly string[] | null> {
    const result = await port.inspectNamespace(protectedLease as CredentialNamespaceLease, control(stamp));
    if (result.status !== "complete") { if (port.leaseState() === "faulted") needsProtectedRecovery = true; return null; }
    return permitted(stamp) ? result.keys : null;
  }
  async function read(stamp: object, slot: string): Promise<CredentialSlotObservation> {
    const result = await port.readSlot(protectedLease as CredentialNamespaceLease, slot, control(stamp));
    if (result.status === "read_failed" || (result.status === "refused" && result.reason === "faulted")) needsProtectedRecovery = true;
    return result;
  }
  function capture(all: boolean): Capture | null {
    if (frozenSource) {
      const fenced = source.fence(frozenSource);
      if (fenced === "changed") { setFault("source_changed"); return null; }
      if (fenced !== "unchanged") return null;
    }
    const result = source.capture(all, currentQ?.initialEntryKeys);
    if (result.status !== "captured") { if (result.status === "source_changed" || (result.status === "invalid_source" && knownProtected.has(manifestSlot))) setFault("source_changed"); return null; }
    if (currentQ && !sameList(result.credentialInventory.initialEntryKeys, currentQ.initialEntryKeys)) { setFault("source_changed"); return null; }
    return result;
  }
  const preparedDomainValues = new Map<string, string>();
  async function validatePreparedDomain(stamp: object, snapshot: NativeCommonSqlSnapshot): Promise<boolean> {
    // A Q was issued only AFTER the original D1/AP-ACT preparation. Reobserve
    // names/marker and each actual raw value separately so a known contradiction
    // survives a later independent read or callback failure.
    let expected: readonly { key: string; fingerprint: string }[] = [];
    let marker: string | null = null;
    if (snapshot.record.status === "present") {
      const checked = domainRecord(stamp, snapshot.record.bytes), parsed = checked.evaluated;
      if (!permitted(stamp) || checked.unavailable) return false;
      if (!parsed.ok || parsed.record.phase !== "verified") { setFault("pairing_mismatch"); return false; }
      expected = parsed.record.manifest ?? []; marker = parsed.record.storeIdentity;
    } else if (snapshot.record.status !== "absent") return false;
    const listed = await source.domain.listKeys();
    if (listed.status !== "value") return false;
    const keys = listed.keys.filter(key => classifyMigrationSourceKey(key).eligible).sort();
    if (listed.keys.some(isUnsupportedMigrationIdentityControlKey) || !sameList(keys, expected.map(row => row.key).sort())) { setFault("source_changed"); return false; }
    if (!permitted(stamp)) return false;
    const observedMarker = await source.domain.readMarker();
    if (observedMarker.status === "value" && observedMarker.value !== marker) { setFault("source_changed"); return false; }
    if (!permitted(stamp) || observedMarker.status !== "value") return false;
    for (const row of expected) {
      const observed = await source.domain.readValue(row.key);
      if (observed.status === "value" && (observed.value === null || (preparedDomainValues.has(row.key) && observed.value !== preparedDomainValues.get(row.key)))) { setFault("source_changed"); return false; }
      if (!permitted(stamp) || observed.status !== "value" || observed.value === null) return false;
      const raw = observed.value;
      let digest: unknown;
      try { digest = await options.domainFingerprint(raw); } catch { return false; }
      if (!permitted(stamp) || typeof digest !== "string") return false;
      const shape = observeBorrowedFingerprintFormat(options.domainFingerprintFormat, digest);
      // Only a successfully validated digest proves an actual content difference.
      if (shape === "valid" && digest !== row.fingerprint) { setFault("source_changed"); return false; }
      if (!permitted(stamp) || shape !== "valid") return false;
      preparedDomainValues.set(row.key, raw);
    }
    return permitted(stamp);
  }
  async function validateSource(stamp: object, q: Q, m: M, captured: Capture): Promise<boolean> {
    if (!sameList(captured.credentialInventory.initialEntryKeys, m.initialEntryKeys)) { setFault("source_changed"); return false; }
    for (let rank = 0; rank < m.items.length; rank++) {
      const item = m.items[rank], actual = captured.credentialInventory.items[rank];
      const digest = await fingerprint(stamp, actual.key, actual.raw);
      if (!digest) return false;
      if (digest !== item.fingerprint) { setFault("source_changed"); return false; }
    }
    if (!permitted(stamp)) return false;
    if (!correlatePair(q, m, { kind: "preactive", expected: q.expectedStoreIdentity }).ok) { setFault("pairing_mismatch"); return false; }
    const fenced = source.fence(captured.proof);
    if (fenced === "changed") setFault("source_changed");
    if (fenced !== "unchanged") return false;
    frozenSource = captured.proof; return true;
  }
  async function protectedCopy(stamp: object, q: Q, m: M, captured: Capture, requireAll: boolean): Promise<ProtectedCopy | null> {
    const keys = await inventory(stamp); if (!keys) return null;
    const snapshot: ProtectedCopy = { items: [], fixedItemAbsences: [] };
    for (let rank = 0; rank < m.items.length; rank++) {
      const item = m.items[rank], slot = itemSlot(q, item.key);
      const observed = await read(stamp, slot);
      if (fault || !alive(stamp)) return null;
      if (observed.status === "absent") {
        if (requireAll || rank < q.verifiedItemIds.length || keys.includes(slot)) setFault("protected_evidence_lost");
        continue;
      }
      if (observed.status !== "value") return null;
      const parsed = parseI(observed.value, root, q);
      if (!parsed.ok || parsed.value.key !== item.key || parsed.value.value !== captured.credentialInventory.items[rank].raw) { setFault("pairing_mismatch"); return null; }
      snapshot.items.push({ itemId: item.itemId, key: item.key, result: { status: "value", raw: observed.value } });
    }
    for (const fixed of m.fixedSlots) if (fixed.presence === "absent") {
      const observed = await read(stamp, itemSlot(q, fixed.key));
      if (fault || !alive(stamp)) return null;
      if (observed.status === "value") { setFault("pairing_mismatch"); return null; }
      if (observed.status !== "absent") return null;
      snapshot.fixedItemAbsences.push({ kind: fixed.kind, key: fixed.key, result: { status: "absent" } });
    }
    const end = await inventory(stamp);
    return end && sameList(keys, end) && permitted(stamp) ? snapshot : null;
  }
  function frozenProof(stamp: object, q: Q, m: M, captured: Capture, snapshot: ProtectedCopy) {
    const compute: Fingerprint = async (purpose, key, raw) => {
      if (purpose !== "credential-value/v1") throw new Error("Migration fingerprint unavailable");
      const digest = await fingerprint(stamp, key, raw);
      if (digest === null) throw new Error("Migration fingerprint unavailable"); return digest;
    };
    return validateFrozenCopy(q, m, captured.credentialSnapshot, snapshot, compute,
      (value: string) => permitted(stamp) && credentialFormat(value) && permitted(stamp));
  }
  async function ensureChild(): Promise<boolean> {
    if (child) return true;
    const made = createNativeCommonHeldDomainMigrationRunner({ host: sql!.host, lease: sqlLease!, source: source.domain,
      fingerprint: options.domainFingerprint, isWellFormedFingerprint: options.domainFingerprintFormat,
      generateUuid: () => uuid(lifecycle), now: () => clock(lifecycle), limits: options.limits });
    if (!made.ok) return false; child = made.runner; return true;
  }
  async function sourceFree(stamp: object, snapshot: NativeCommonSqlSnapshot, q: Q, keys: readonly string[]): Promise<NativeCommonMigrationReport> {
    const observed = await read(stamp, manifestSlot); if (fault) return faultReport(stamp);
    if (observed.status !== "value" || !permitted(stamp)) return blocked();
    const m = parseM(observed.value, credentialFormat);
    if (!permitted(stamp)) return fault ? faultReport(stamp) : { outcome: "disposed" };
    if (credentialFormatUnavailable) return blocked();
    if (!m.ok || (newUser && (m.value.initialEntryKeys.length !== 0 || m.value.items.length !== 0 || m.value.fixedSlots.some(slot => slot.presence !== "absent"))) || !correlatePair(q, m.value, { kind: "active", storeIdentity: q.storeIdentity }).ok) { setFault("pairing_mismatch"); return faultReport(stamp); }
    const addresses = new Set([...keys.filter(key => key !== manifestSlot), ...fixedCredentialSlots(root).map(slot => itemSlot(q, slot.key))]);
    for (const slot of addresses) {
      const result = await read(stamp, slot); if (fault) return faultReport(stamp);
      if (!permitted(stamp)) return { outcome: "disposed" };
      if (result.status === "absent") continue;
      if (result.status !== "value") return blocked();
      const parsed = parseI(result.value, root, q), physical = parseCredentialPhysicalSlot(config, root, slot);
      if (!parsed.ok || !physical.ok || physical.value.kind !== "item" || parsed.value.key !== physical.value.key) { setFault("pairing_mismatch"); return faultReport(stamp); }
    }
    const end = await inventory(stamp); if (fault) return faultReport(stamp);
    if (!end || !sameList(keys, end) || !permitted(stamp) || !sql!.pinBound(sqlLease!, snapshot)) return blocked();
    retained = true; completed = true; frozenSource = null; boundSnapshot = snapshot;
    for (const key of knownProtected.keys()) if (key !== manifestSlot) knownProtected.delete(key);
    const token = Object.freeze({}) as NativeCommonCompletionCandidate; candidate = { token, lifecycle: stamp };
    return { outcome: "candidate", candidate: token };
  }
  async function runOnce(stamp: object): Promise<NativeCommonMigrationReport> {
    if (!alive(stamp)) return { outcome: "disposed" };
    if (fault) return faultReport(stamp);
    if (needsSqlRecovery) return { outcome: "recovery_required", boundary: "sql" };
    if (needsProtectedRecovery) return { outcome: "recovery_required", boundary: "protected" };
    try { if (platform() !== "ios") return blocked("unsupported_platform"); } catch { return blocked("unsupported_platform"); }
    if (!alive(stamp)) return { outcome: "disposed" };
    if (!sql) {
      const adapterModule = await import("./nativeSqliteAdapter"); if (!alive(stamp)) return { outcome: "disposed" };
      sql = adapterModule.createNativeCommonMigrationSqliteContext(options.sqlite, { source, providerConfigIdentity: config, sessionStorageKey: root, isWellFormedFingerprint: options.domainFingerprintFormat, credentialContract: sdkVersion });
    }
    if (!sqlLease) { const acquired = await sql.host.acquire(); if (!acquired.ok) return blocked(); sqlLease = acquired.lease; }
    if (!alive(stamp)) return { outcome: "disposed" };
    if (!protectedLease) { const acquired = await port.acquire(); if (!acquired.ok) return blocked(); protectedLease = acquired.lease; }
    if (!alive(stamp)) return { outcome: "disposed" };
    const resolution = await sql.resolveJournal(sqlLease, control(stamp));
    if (resolution === "mismatch") setFault("sql_evidence_mismatch");
    if (fault || sql.failed(sqlLease)) { if (!fault) setFault("sql_evidence_mismatch"); return faultReport(stamp); }
    if (resolution === "unavailable" || resolution === "reopen_required") { needsSqlRecovery = true; return { outcome: "recovery_required", boundary: "sql" }; }
    for (let step = 0; step < options.limits.protocolStepLimit; step++) {
      if (!alive(stamp)) return { outcome: "disposed" };
      const observed = await sql.observe(sqlLease, control(stamp));
      if (sql.failed(sqlLease)) setFault("sql_evidence_mismatch");
      if (fault) return faultReport(stamp);
      if (!observed.ok || !alive(stamp)) return alive(stamp) ? blocked() : { outcome: "disposed" };
      const snapshot = observed;
      if ([snapshot.record, snapshot.latch, snapshot.q, snapshot.f, snapshot.schema].some(value => value.status === "read_failed") || snapshot.rows.status !== "listed") return blocked();
      if (snapshot.latch.status === "present" || snapshot.f.status === "present") { setFault("sql_evidence_mismatch"); return faultReport(stamp); }
      if (snapshot.q.status === "present") {
        retained = true;
        const parsed = parseQ(snapshot.q.bytes);
        if (!parsed.ok || parsed.value.providerConfigIdentity !== config || parsed.value.sessionStorageKey !== root) { setFault("invalid_metadata"); return faultReport(stamp); }
        currentQ = parsed.value;
        if (newUser && (currentQ.initialEntryKeys.length !== 0 || currentQ.verifiedItemIds.length !== 0)) return blocked("unsupported_source");
      } else currentQ = null;
      boundMode = false;
      if (currentQ?.phase === "bound") {
        if (snapshot.record.status !== "present") { setFault("pairing_mismatch"); return faultReport(stamp); }
        const checked = domainRecord(stamp, snapshot.record.bytes), d = checked.evaluated;
        if (!alive(stamp)) return { outcome: "disposed" };
        if (checked.unavailable) return blocked();
        if (!d.ok || d.record.phase !== "active" || d.record.storeIdentity !== currentQ.storeIdentity) { setFault("pairing_mismatch"); return faultReport(stamp); }
        if (newUser && (d.record.entryKeys?.length !== 0 || d.record.manifest?.length !== 0 || d.record.copied?.length !== 0)) return blocked("unsupported_source");
        boundMode = true;
      } else if (snapshot.record.status === "present") {
        if (newUser) return blocked("unsupported_source");
        const checked = domainRecord(stamp, snapshot.record.bytes), d = checked.evaluated;
        if (!alive(stamp)) return { outcome: "disposed" };
        if (checked.unavailable) return blocked();
        if (!d.ok || d.record.phase === "active" || (currentQ && (d.record.phase !== "verified" || d.record.storeIdentity !== currentQ.expectedStoreIdentity))) { setFault("pairing_mismatch"); return faultReport(stamp); }
      }
      const keys = await inventory(stamp); if (fault) return faultReport(stamp); if (!keys) return needsProtectedRecovery ? { outcome: "recovery_required", boundary: "protected" } : blocked();
      if (boundMode && currentQ) {
        if (!sql.select(sqlLease, snapshot)) return blocked();
        return sourceFree(stamp, snapshot, currentQ, keys);
      }
      if (newUser && !currentQ) {
        // Never relabel a prior schema-only initialization as strict origin.
        if (snapshot.layout === "combined" || snapshot.record.status !== "absent" || snapshot.rows.entries.length !== 0) return blocked("target_not_empty");
        const captured = capture(true); if (!captured) return blocked("unsupported_source");
        if (pendingIntent === null) {
          const protocolId = uuid(stamp), credentialEpochId = uuid(stamp), manifestId = uuid(stamp), expectedStoreIdentity = uuid(stamp);
          if (new Set([protocolId, credentialEpochId, manifestId, expectedStoreIdentity]).size !== 4) return blocked();
          pendingIntent = unwrap(serializeQ({ schemaVersion: 1, protocolId, credentialEpochId, manifestId, expectedStoreIdentity,
            providerConfigIdentity: config, sdkContractVersion: sdkVersion, sessionStorageKey: root, initialEntryKeys: [], phase: "intent", verifiedItemIds: [] }));
        }
        const freshKeys = await inventory(stamp); if (fault) return faultReport(stamp);
        if (!freshKeys || freshKeys.length || !permitted(stamp)) return blocked();
        const absentManifest = await read(stamp, manifestSlot); if (fault) return faultReport(stamp);
        if (absentManifest.status === "value") { setFault("namespace_unproven"); return faultReport(stamp); }
        if (absentManifest.status !== "absent" || !permitted(stamp)) return blocked();
        const endKeys = await inventory(stamp); if (fault) return faultReport(stamp);
        if (!endKeys || endKeys.length || !permitted(stamp)) return blocked();
        const initialized = await sql.initializeNewUser(sqlLease, pendingIntent, captured.proof, control(stamp));
        const halted = transaction(initialized); if (fault) return faultReport(stamp); if (halted) return halted; continue;
      }
      if (snapshot.layout !== "combined") {
        if (keys.length) { setFault("namespace_unproven"); return faultReport(stamp); }
        const initialized = await sql.host.initializeEmpty(sqlLease, control(stamp));
        if (initialized.status === "refused" && initialized.reason === "target_not_empty") return blocked("target_not_empty");
        if (initialized.status === "refused") return blocked();
        const halted = transaction(initialized); if (halted) return halted; continue;
      }
      if (snapshot.schema.status !== "present") { setFault("invalid_metadata"); return faultReport(stamp); }
      if (!sql.select(sqlLease, snapshot)) return blocked();
      if (!currentQ) {
        if (!await ensureChild()) return blocked("domain_not_prepared");
        const prepared = await child!.run(control(stamp));
        if (!alive(stamp)) return { outcome: "disposed" };
        if (prepared.outcome === "fault") { setFault("sql_evidence_mismatch"); return faultReport(stamp); }
        if (prepared.outcome !== "held") { if (prepared.outcome === "parent_recovery_required" || prepared.outcome === "halted") { needsSqlRecovery = true; return { outcome: "recovery_required", boundary: "sql" }; } return blocked("domain_not_prepared"); }
        const hold = sql.resolveHold(sqlLease, prepared.hold); if (!hold) return blocked("domain_not_prepared");
        const captured = capture(true); if (fault) return faultReport(stamp); if (!captured) return blocked("unsupported_source");
        if (pendingIntent === null) {
          const protocolId = uuid(stamp), credentialEpochId = uuid(stamp), manifestId = uuid(stamp);
          pendingIntent = unwrap(serializeQ({ schemaVersion: 1, protocolId, credentialEpochId, manifestId, providerConfigIdentity: config, sdkContractVersion: sdkVersion,
            sessionStorageKey: root, initialEntryKeys: captured.credentialInventory.initialEntryKeys, phase: "intent", verifiedItemIds: [], expectedStoreIdentity: hold.identity }));
        }
        const issued = await sql.insertIntent(sqlLease, prepared.hold, pendingIntent, captured.proof, control(stamp));
        const halted = transaction(issued); if (fault) return faultReport(stamp); if (halted) return halted; continue;
      }
      const q = currentQ;
      const observedM = await read(stamp, manifestSlot); if (fault) return faultReport(stamp);
      if (!permitted(stamp)) return { outcome: "disposed" };
      if (!await validatePreparedDomain(stamp, snapshot)) return fault ? faultReport(stamp) : alive(stamp) ? blocked() : { outcome: "disposed" };
      if (observedM.status === "absent") {
        if (q.phase !== "intent" || keys.length !== 0 || knownProtected.has(manifestSlot)) { setFault("protected_evidence_lost"); return faultReport(stamp); }
        const captured = capture(false); if (fault) return faultReport(stamp); if (!captured) return blocked("unsupported_source");
        const items: M["items"] = [];
        for (let rank = 0; rank < captured.credentialInventory.items.length; rank++) {
          const item = captured.credentialInventory.items[rank], digest = await fingerprint(stamp, item.key, item.raw); if (!digest) return blocked();
          items.push({ itemId: "c" + rank.toString(16).padStart(4, "0"), key: item.key, fingerprint: digest });
        }
        const beforeManifest = source.fence(captured.proof);
        if (beforeManifest !== "unchanged") return blocked(beforeManifest === "changed" ? "source_changed_before_manifest" : "unavailable");
        const m: M = { schemaVersion: 1, protocolId: q.protocolId, credentialEpochId: q.credentialEpochId, manifestId: q.manifestId,
          providerConfigIdentity: config, sdkContractVersion: sdkVersion, sessionStorageKey: root, expectedStoreIdentity: q.expectedStoreIdentity!,
          initialEntryKeys: [...q.initialEntryKeys], fixedSlots: captured.credentialInventory.fixedSlots.map(slot => ({ ...slot })), items };
        const raw = serializeM(m, credentialFormat); if (!raw.ok || !permitted(stamp)) return blocked();
        plannedManifest = { raw: raw.value, source: captured.proof };
        const inserted = await port.insert(protectedLease!, manifestSlot, raw.value, control(stamp));
        if (fault) return faultReport(stamp);
        if (inserted.status === "unverified") { retained = true; needsProtectedRecovery = true; return { outcome: "recovery_required", boundary: "protected" }; }
        if (inserted.status !== "verified" && inserted.status !== "already_present") { if (port.leaseState() === "faulted") needsProtectedRecovery = true; return blocked(); }
        retained = true; continue;
      }
      if (observedM.status !== "value") return needsProtectedRecovery ? { outcome: "recovery_required", boundary: "protected" } : blocked();
      const parsedM = parseM(observedM.value, credentialFormat);
      if (!permitted(stamp)) return { outcome: "disposed" };
      if (credentialFormatUnavailable) return blocked();
      if (!parsedM.ok || !correlatePair(q, parsedM.value, { kind: "preactive", expected: q.expectedStoreIdentity }).ok) { setFault("pairing_mismatch"); return faultReport(stamp); }
      manifest = parsedM.value;
      if (newUser && (manifest.initialEntryKeys.length || manifest.items.length || manifest.fixedSlots.some(slot => slot.presence !== "absent"))) return blocked("unsupported_source");
      const captured = capture(false); if (fault) return faultReport(stamp); if (!captured) return blocked();
      if (!await validateSource(stamp, q, manifest, captured)) return fault ? faultReport(stamp) : blocked();
      if (q.phase === "intent" || q.phase === "manifest_confirmed") {
        if (keys.some(key => key !== manifestSlot)) { setFault("namespace_unproven"); return faultReport(stamp); }
        const absences = await protectedCopy(stamp, q, manifest, captured, false);
        if (fault) return faultReport(stamp);
        if (!absences) return needsProtectedRecovery ? { outcome: "recovery_required", boundary: "protected" } : blocked();
        const result = await sql.advanceQ(sqlLease, snapshot.q.status === "present" ? snapshot.q.bytes : "", { kind: q.phase === "intent" ? "confirm_manifest" : "begin_copying" }, captured.proof, control(stamp));
        const halted = transaction(result); if (fault) return faultReport(stamp); if (halted) return halted; continue;
      }
      const protectedSnapshot = await protectedCopy(stamp, q, manifest, captured, q.phase === "credentials_verified");
      if (fault) return faultReport(stamp); if (!protectedSnapshot) return needsProtectedRecovery ? { outcome: "recovery_required", boundary: "protected" } : blocked();
      if (q.phase === "copying" && q.verifiedItemIds.length < q.initialEntryKeys.length) {
        const rank = q.verifiedItemIds.length, item = manifest.items[rank];
        if (!protectedSnapshot.items.some(read => read.itemId === item.itemId)) {
          const raw = serializeI({ schemaVersion: 1, protocolId: q.protocolId, credentialEpochId: q.credentialEpochId, originManifestId: q.manifestId,
            providerConfigIdentity: config, sdkContractVersion: sdkVersion, key: item.key, value: captured.credentialInventory.items[rank].raw }, root);
          if (!raw.ok || !permitted(stamp)) return blocked();
          const fenced = source.fence(captured.proof); if (fenced === "changed") setFault("source_changed"); if (fenced !== "unchanged") return fault ? faultReport(stamp) : blocked();
          const inserted = await port.insert(protectedLease!, itemSlot(q, item.key), raw.value, control(stamp)); if (fault) return faultReport(stamp);
          if (inserted.status === "unverified") { retained = true; needsProtectedRecovery = true; return { outcome: "recovery_required", boundary: "protected" }; }
          if (inserted.status !== "verified" && inserted.status !== "already_present") return blocked();
          retained = true; continue;
        }
        const result = await sql.advanceQ(sqlLease, snapshot.q.status === "present" ? snapshot.q.bytes : "", { kind: "confirm_next_item", itemId: item.itemId }, captured.proof, control(stamp));
        const halted = transaction(result); if (fault) return faultReport(stamp); if (halted) return halted; continue;
      }
      const verified = await frozenProof(stamp, q, manifest, captured, protectedSnapshot);
      if (!permitted(stamp)) return fault ? faultReport(stamp) : { outcome: "disposed" };
      if (credentialFormatUnavailable) return blocked();
      if (!verified.ok) { if (verified.issue.code === "evidence_unavailable") return blocked(); setFault("pairing_mismatch"); return faultReport(stamp); }
      if (q.phase === "copying") {
        const result = await sql.advanceQ(sqlLease, snapshot.q.status === "present" ? snapshot.q.bytes : "", { kind: "verify_all" }, captured.proof, control(stamp));
        const halted = transaction(result); if (fault) return faultReport(stamp); if (halted) return halted; continue;
      }
      if (!finalMetadata) { const migrationId = uuid(stamp), activatedAt = clock(stamp); if (!alive(stamp) || typeof activatedAt !== "string") return blocked(); finalMetadata = { migrationId, activatedAt }; }
      if (!await ensureChild()) return blocked("domain_not_prepared");
      const prepared = await child!.run(control(stamp));
      if (!alive(stamp)) return { outcome: "disposed" };
      if (prepared.outcome === "fault") { setFault("sql_evidence_mismatch"); return faultReport(stamp); }
      if (prepared.outcome !== "held") return blocked("domain_not_prepared");
      const full = capture(true); if (fault) return faultReport(stamp); if (!full) return blocked();
      const finalProtected = await protectedCopy(stamp, q, manifest, full, true); if (fault) return faultReport(stamp); if (!finalProtected) return blocked();
      const finalVerified = await frozenProof(stamp, q, manifest, full, finalProtected);
      if (!permitted(stamp)) return fault ? faultReport(stamp) : { outcome: "disposed" };
      if (credentialFormatUnavailable) return blocked();
      if (!finalVerified.ok) { if (finalVerified.issue.code === "evidence_unavailable") return blocked(); setFault("pairing_mismatch"); return faultReport(stamp); }
      const finished = await sql.finalize(sqlLease, prepared.hold, full.proof, finalMetadata.migrationId, finalMetadata.activatedAt, control(stamp));
      const halted = transaction(finished); if (fault) return faultReport(stamp); if (halted) return halted;
      completed = true; frozenSource = null;
    }
    return { outcome: "incomplete" };
  }
  const refusedRetirement = (): NativeCommonRetirementReport => Object.freeze({outcome:"refused",removeIssued:0,removeAcknowledged:0,removeVerified:0,observedAbsent:0,firstUnverified:null});
  function retire(value: unknown): Promise<NativeCommonRetirementReport> {
    if (!enableRetirement || transferred || disposed || recovering || inFlight || handoffFlight) return Promise.resolve(refusedRetirement());
    if (retirementBusy) return value === retirementToken && retirementFlight ? retirementFlight : Promise.resolve(refusedRetirement());
    if (!owner.isCurrentCandidate(value)) return Promise.resolve(refusedRetirement());
    retirementBusy = true; retirementToken = value; candidate = null;
    const oldSource = cancelRetirement(), stamp = lifecycle;
    normalControl.cancel(); normalControl = createNativeCommonMigrationControl();
    let removeIssued = 0, removeAcknowledged = 0, removeVerified = 0;
    let firstUnverified: RetirementCounts["firstUnverified"] = null;
    const absent = new Set<string>(), issued = new Set<string>();
    const counts = () => ({removeIssued,removeAcknowledged,removeVerified,observedAbsent:absent.size,firstUnverified});
    const incomplete = (code: RetirementCode): NativeCommonRetirementReport => Object.freeze({outcome:"incomplete",code,...counts()});
    const current = () => permitted(stamp) && !transferred && retirementBusy && !needsSqlRecovery && !needsProtectedRecovery;
    let cap: NativeCredentialRetirementSource | null = null, accepted = false;
    const attempt = Promise.resolve().then(async (): Promise<NativeCommonRetirementReport> => {
      if (oldSource) { await oldSource.release(); if (retirementSource === oldSource) retirementSource = null; }
      if (!current()) return incomplete("cancelled");
      const fresh = await runOnce(stamp);
      if (!current()) return incomplete(alive(stamp) ? "unavailable" : "cancelled");
      if (fresh.outcome !== "candidate" || !currentQ || currentQ.phase !== "bound" || !boundSnapshot) return incomplete("unavailable");
      const q = currentQ, manifestRaw = knownProtected.get(manifestSlot);
      if (manifestRaw === undefined) return incomplete("unavailable");
      const parsedManifest = parseM(manifestRaw,credentialFormat);
      if (!current() || !parsedManifest.ok || credentialFormatUnavailable) return incomplete("unavailable");
      const m = parsedManifest.value;
      cap = acquireNativeCredentialRetirementSource(source); retirementSource = cap;
      if (!current()) { cap?.cancel(); return incomplete("cancelled"); }
      if (!cap) return incomplete("unavailable");
      const observe = () => {
        const observed = cap!.observe(m.initialEntryKeys);
        // Receipt counts survive aggregate failure; they grant no source proof.
        for (const key of cap!.observedAbsences()) if (!issued.has(key)) absent.add(key);
        return observed;
      };
      let observed = observe();
      if (observed.status === "failed") return incomplete(observed.code);
      const original = new Map<string,string>(), originalEnvelopes = new Map<string,string>();
      const matchesSubset = (entries: readonly { key: string; value: string | null }[]) => entries.every(entry => entry.value === null || original.get(entry.key) === entry.value);
      if (observed.keys.length) {
        // Historical M constrains ONLY this destructive lane. A valid mutable
        // bound target may differ without creating a protocol fault.
        const keys = await inventory(stamp);
        if (!current() || !keys) return incomplete("unavailable");
        const expected = [manifestSlot,...m.items.map(item => itemSlot(q,item.key))].sort();
        if (!sameList([...keys].sort(),expected)) return incomplete("target_not_original");
        for (const item of m.items) {
          const raw = await read(stamp,itemSlot(q,item.key));
          if (!current()) return incomplete(alive(stamp) ? "unavailable" : "cancelled");
          if (raw.status === "absent") return incomplete("target_not_original");
          if (raw.status !== "value") return incomplete("unavailable");
          const parsed = parseI(raw.value,root,q);
          if (!parsed.ok || parsed.value.key !== item.key) { setFault("pairing_mismatch"); await faultReport(stamp); return incomplete("unavailable"); }
          const digest = await fingerprint(stamp,item.key,parsed.value.value);
          if (!current() || digest === null) return incomplete("unavailable");
          if (digest !== item.fingerprint) return incomplete("target_not_original");
          original.set(item.key,parsed.value.value); originalEnvelopes.set(item.key,raw.value);
        }
        for (const fixed of m.fixedSlots) if (fixed.presence === "absent") {
          const raw = await read(stamp,itemSlot(q,fixed.key));
          if (!current()) return incomplete(alive(stamp) ? "unavailable" : "cancelled");
          if (raw.status === "value") return incomplete("target_not_original");
          if (raw.status !== "absent") return incomplete("unavailable");
        }
        const end = await inventory(stamp);
        if (!current() || !end) return incomplete("unavailable");
        if (!sameList([...end].sort(),expected)) return incomplete("target_not_original");
        if (!cap.prepareRemoval()) return incomplete(current() ? "unavailable" : "cancelled");
        observed = observe();
        if (observed.status === "failed") return incomplete(observed.code);
        if (!matchesSubset(observed.entries)) return incomplete("source_changed");
        for (const item of m.items) {
          const target = await read(stamp,itemSlot(q,item.key));
          if (!current()) return incomplete(alive(stamp) ? "unavailable" : "cancelled");
          if (target.status === "read_failed" || target.status === "refused") return incomplete("unavailable");
          if (target.status !== "value" || target.value !== originalEnvelopes.get(item.key)) return incomplete("target_not_original");
          observed = observe();
          if (observed.status === "failed") return incomplete(observed.code);
          if (!matchesSubset(observed.entries)) return incomplete("source_changed");
          if (!current()) return incomplete("cancelled");
          const entry = observed.entries.find(entry => entry.key === item.key);
          if (entry?.value === null) continue;
          const removal = cap.remove(observed.proof,item.key,original.get(item.key)!);
          if (removal.removeIssued) { removeIssued++; issued.add(item.key); absent.delete(item.key); }
          if (removal.removeAcknowledged) removeAcknowledged++;
          if (removal.status === "verified") removeVerified++;
          else if (removal.removeIssued && firstUnverified === null) firstUnverified = Object.freeze({removeIssued:true,removeAcknowledged:removal.removeAcknowledged,absenceReadIssued:removal.absenceReadIssued,absenceReadAcknowledged:removal.absenceReadAcknowledged,absenceVerified:false});
          if (removal.status === "failed") return incomplete(removal.code ?? "unavailable");
          if (removal.status === "absent" && !issued.has(item.key)) absent.add(item.key);
          if (!current()) return incomplete("cancelled");
        }
      }
      // Reobserve the current bound pair after all effects, then establish a
      // fresh actual empty proof. Neither M nor an old report proves absence.
      const final = await runOnce(stamp);
      if (!current()) return incomplete(alive(stamp) ? "unavailable" : "cancelled");
      if (final.outcome !== "candidate") return incomplete("unavailable");
      observed = observe();
      if (observed.status === "failed") return incomplete(observed.code);
      if (observed.keys.length || observed.entries.some(entry => entry.value !== null)) return incomplete("source_changed");
      if (!current() || !cap.current()) return incomplete("cancelled");
      cap.finish(); retirementApproval = {token:final.candidate,stamp,proof:observed.proof,source:cap}; accepted = true;
      return Object.freeze({outcome:removeVerified ? "retired" : "source_absent",candidate:final.candidate,...counts()});
    }).catch(() => incomplete(alive(stamp) ? "unavailable" : "cancelled")).finally(async () => {
      if (!accepted) {
        candidate = null;
        if (cap) { cap.cancel(); await cap.release(); if (retirementSource === cap) retirementSource = null; }
      }
      retirementBusy = false; retirementToken = null;
      if (retirementFlight === attempt) retirementFlight = null;
    });
    retirementFlight = attempt; return attempt;
  }
  function handoff(value: unknown): Promise<NativeCommonRuntimeHandoffReport> {
    if (transferred || !enableRuntime) return Promise.resolve({ outcome: "refused" });
    if (handoffFlight) return value === handoffToken ? handoffFlight : Promise.resolve({ outcome: "refused" });
    if (retirementBusy || inFlight || recovering || !owner.isCurrentCandidate(value)) return Promise.resolve({ outcome: "refused" });
    const stamp = lifecycle;
    const approval = retirementApproval;
    if (enableRetirement && (!approval || approval.token !== value || approval.stamp !== stamp || !approval.source.current())) return Promise.resolve({outcome:"refused"});
    handoffToken = value; candidate = null;
    const attempt = (async (): Promise<NativeCommonRuntimeHandoffReport> => {
      // Revalidate through the retained resources, including the whole protected
      // namespace. No source is touched on this bound path.
      const fresh = await runOnce(stamp);
      if (fresh.outcome !== "candidate" || !alive(stamp) || !boundSnapshot || !currentQ || !sql || !sqlLease || !protectedLease) return { outcome: "refused" };
      const session = createNativeRuntimeSession(() => {
        setFault("pairing_mismatch");
        // The real owner keeps first-fault history and bounded persistence rights.
        // This is queued; the SQL lane never waits for a protected operation.
        if (!disposed && sql && sqlLease && fault && faultAttempts < options.limits.faultWriteAttemptLimit) {
          faultAttempts++; const raw = serializeF(fault);
          if (raw.ok) void sql.recordFault(sqlLease, raw.value, lifetimeControl.control).then(() => {}, () => {});
        }
      }, () => { lifetimeControl.cancel(); });
      let domain: NativeRuntimeDomainDraft | null = null, credential: NativeRuntimeCredentialDraft | null = null, published = false;
      try {
        const current = () => alive(stamp) && !transferred && !fault && !needsSqlRecovery && !needsProtectedRecovery;
        if (!current()) return { outcome: "refused" };
        domain = sql.prepareRuntime(sqlLease, boundSnapshot, session);
        const manifestRaw = knownProtected.get(manifestSlot);
        if (!domain || manifestRaw === undefined || !current()) return { outcome: "refused" };
        credential = prepareNativeCredentialRuntime(port, protectedLease, currentQ, manifestRaw, session, domain, current);
        if (!credential || !current()) return { outcome: "refused" };
        // Last foreign source observations follow all mutable dependency capture.
        // The remaining currentness check and joint publication are private.
        if (enableRetirement && (!approval || retirementApproval !== approval || !approval.source.fenceEmpty(approval.proof) || !current())) return {outcome:"refused"};
        const pair = publishNativeCombinedRuntime(session, domain, credential);
        if (!pair) return { outcome: "refused" };
        transferred = true; candidate = null; published = true;
        if (approval) { retirementApproval = null; void approval.source.release(); retirementSource = null; }
        return { outcome: "runtime", pair };
      } finally {
        if (!published) { domain?.abandon(); credential?.abandon(); abandonNativeRuntimeSession(session); }
      }
    })().catch((): NativeCommonRuntimeHandoffReport => ({ outcome: "refused" })).finally(() => { if (handoffFlight === attempt) { handoffFlight = null; handoffToken = null; } });
    handoffFlight = attempt; return attempt;
  }
  const owner: NativeCommonMigrationOwner = {
    ...(enableRuntime ? { handoff } : {}),
    ...(enableRetirement ? { retire } : {}),
    run() {
      if (transferred) return Promise.resolve({ outcome: "disposed" });
      if (handoffFlight || retirementBusy) return Promise.resolve(blocked());
      if (disposed) return Promise.resolve({ outcome: "disposed" });
      if (inFlight) return inFlight;
      if (recovering) return recovering;
      const priorSource = enableRetirement ? cancelRetirement() : null;
      candidate = null; credentialFormatUnavailable = false; const stamp = lifecycle;
      const start = priorSource ? priorSource.release().then(() => { if (retirementSource === priorSource) retirementSource = null; return runOnce(stamp); }) : runOnce(stamp);
      const attempt = start.then((report): NativeCommonMigrationReport => !alive(stamp) && !fault ? { outcome: "disposed" } : report)
        .catch((): NativeCommonMigrationReport => fault ? { outcome: "fault", code: fault.code, faultWriteAttempts: faultAttempts } : alive(stamp) ? blocked() : { outcome: "disposed" })
        .finally(() => { if (inFlight === attempt) inFlight = null; });
      inFlight = attempt; return attempt;
    },
    recover() {
      if (transferred) return Promise.resolve({ outcome: "disposed" });
      if (disposed) return Promise.resolve({ outcome: "disposed" });
      if (recovering) return recovering;
      const prior = inFlight, priorHandoff = handoffFlight, priorRetirement = retirementFlight, priorSource = cancelRetirement(); normalControl.cancel(); lifetimeControl.cancel();
      normalControl = createNativeCommonMigrationControl(); lifetimeControl = createNativeCommonMigrationControl();
      if (fault) normalControl.cancel();
      lifecycle = Object.freeze({}); candidate = null; credentialFormatUnavailable = false; const stamp = lifecycle;
      const attempt = (async (): Promise<NativeCommonMigrationReport> => {
        if (prior) await prior; if (priorHandoff) await priorHandoff; if (priorRetirement) await priorRetirement;
        if (priorSource) { await priorSource.release(); if (retirementSource === priorSource) retirementSource = null; }
        if (!alive(stamp)) return { outcome: "disposed" };
        if (sql && sqlLease) { const reopened = await sql.host.reopen(sqlLease, { proceed: () => alive(stamp) }); if (!reopened.ok) { needsSqlRecovery = true; return { outcome: "recovery_required", boundary: "sql" }; } }
        if (!alive(stamp)) return { outcome: "disposed" };
        if (protectedLease && (needsProtectedRecovery || port.leaseState() !== "owned")) {
          const released = await port.release(protectedLease); if (!released.ok) return { outcome: "recovery_required", boundary: "protected" };
          protectedLease = null;
        }
        if (!alive(stamp)) return { outcome: "disposed" };
        if (!protectedLease && sqlLease) { const acquired = await port.acquire(); if (!acquired.ok) return { outcome: "recovery_required", boundary: "protected" }; protectedLease = acquired.lease; }
        needsSqlRecovery = false; needsProtectedRecovery = false; return { outcome: "recovered" };
      })().catch((): NativeCommonMigrationReport => ({ outcome: "recovery_required", boundary: "sql" })).finally(() => { if (recovering === attempt) recovering = null; });
      recovering = attempt; return attempt;
    },
    async dispose() {
      if (transferred) return { ok: false, reason: "evidence_held" };
      disposed = true; normalControl.cancel(); lifetimeControl.cancel(); lifecycle = Object.freeze({}); candidate = null;
      const priorSource = cancelRetirement();
      if (inFlight) await inFlight; if (recovering) await recovering; if (handoffFlight) await handoffFlight;
      if (retirementFlight) await retirementFlight;
      if (priorSource) { await priorSource.release(); if (retirementSource === priorSource) retirementSource = null; }
      if (fault || retained || completed) return { ok: false, reason: "evidence_held" };
      if (child && !(await child.dispose()).ok) return { ok: false, reason: "evidence_held" };
      if (sql && sqlLease) { if (!(await sql.host.release(sqlLease)).ok) return { ok: false, reason: "cleanup_unconfirmed" }; sqlLease = null; }
      if (protectedLease) { if (!(await port.release(protectedLease)).ok) return { ok: false, reason: "cleanup_unconfirmed" }; protectedLease = null; }
      return { ok: true };
    },
    isCurrentCandidate(value) { return candidate !== null && candidate.token === value && candidate.lifecycle === lifecycle && !transferred && !disposed && !fault && !needsSqlRecovery && !needsProtectedRecovery && sql?.host.leaseState() === "owned" && port.leaseState() === "owned"; },
  };
  return Object.freeze({ ok: true, owner: Object.freeze(owner) });
}
