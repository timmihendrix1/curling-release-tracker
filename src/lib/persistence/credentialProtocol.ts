// Inactive logical protocol only. A successful result is NOT an access grant,
// native observation, storage write acknowledgement or physical-slot encoding.
import { isCanonicalUuid } from "../uuid";
import { classifyCredentialKey, contractResult, deepFreeze, exactFields, fixedCredentialSlots, parseBoundedJson, record, refuse, ROOT_PATTERN, SDK_RAW_LIMIT, snapshotJson, text, unwrap, validateQuiescentCredentialSnapshot, validateRuntimeCredentialValue, type CredentialIssue, type DataRecord, type FixedKind, type Json, type Result } from "../supabase/providerCredentialContract";
export type { Result, CredentialIssue } from "../supabase/providerCredentialContract";
export type Fingerprint = (purpose: "credential-value/v1", key: string, exactValue: string) => string | PromiseLike<string>;
export type FingerprintFormat = (candidate: string) => boolean;
export type Phase = "intent" | "manifest_confirmed" | "copying" | "credentials_verified" | "bound";
export const LEGACY_CREDENTIAL_CONTRACT = "auth-js/2.112.3:credential-v1";
export const NEW_USER_CREDENTIAL_CONTRACT = "auth-js/2.112.3:credential-v1:empty-source-v1";
export type CredentialContract = typeof LEGACY_CREDENTIAL_CONTRACT | typeof NEW_USER_CREDENTIAL_CONTRACT;
type Header = { schemaVersion: 1; protocolId: string; credentialEpochId: string; manifestId: string; providerConfigIdentity: string; sdkContractVersion: CredentialContract; sessionStorageKey: string };
export type Q = Header & { initialEntryKeys: string[]; phase: Phase; verifiedItemIds: string[]; expectedStoreIdentity?: string; storeIdentity?: string };
export type M = Header & { expectedStoreIdentity: string; initialEntryKeys: string[]; fixedSlots: { kind: FixedKind; key: string; presence: "present" | "absent" }[]; items: { itemId: string; key: string; fingerprint: string }[] };
export type I = { schemaVersion: 1; protocolId: string; credentialEpochId: string; originManifestId: string; providerConfigIdentity: string; sdkContractVersion: string; key: string; value: string };
export type F = { schemaVersion: 1; code: typeof FAULT_CODES[number]; phase: typeof FAULT_PHASES[number]; operation: typeof FAULT_OPERATIONS[number] };
const HEADER = ["schemaVersion", "protocolId", "credentialEpochId", "manifestId", "providerConfigIdentity", "sdkContractVersion", "sessionStorageKey"] as const;
const PHASES: readonly string[] = ["intent", "manifest_confirmed", "copying", "credentials_verified", "bound"];
const FAULT_CODES = ["pairing_mismatch", "namespace_unproven", "source_changed", "protected_evidence_lost", "sql_evidence_mismatch", "invalid_metadata", "boundary_failure"] as const;
const FAULT_PHASES = ["preflight", "intent", "manifest_confirmed", "copying", "credentials_verified", "bound", "finalizing", "handoff"] as const;
const FAULT_OPERATIONS = ["read", "enumerate", "write_manifest", "write_item", "write_q", "finalize", "reopen", "release"] as const;
const REASONS = ["unavailable", "inaccessible", "unreadable", "absence_not_established", "invalid_response"];
function version(obj: DataRecord): void { if (obj.schemaVersion !== 1) refuse("unsupported_version", "header"); }
function headerTypes(obj: DataRecord, item = false): void {
  for (const key of ["protocolId", "credentialEpochId", item ? "originManifestId" : "manifestId", "providerConfigIdentity", "sdkContractVersion", ...(item ? [] : ["sessionStorageKey"])]) if (typeof obj[key] !== "string") refuse("invalid_shape", "header");
}
function identifiers(obj: DataRecord, item: boolean, contract: CredentialContract): void {
  for (const key of ["protocolId", "credentialEpochId", item ? "originManifestId" : "manifestId"]) if (!isCanonicalUuid(obj[key])) refuse("invalid_identifier", "header");
  if (typeof obj.providerConfigIdentity !== "string" || !/^pc1:[a-z0-9][a-z0-9._-]{0,63}$/.test(obj.providerConfigIdentity)) refuse("invalid_identifier", "header");
  if (![LEGACY_CREDENTIAL_CONTRACT, NEW_USER_CREDENTIAL_CONTRACT].includes(contract) || obj.sdkContractVersion !== contract) refuse("unsupported_version", "header");
  if (!item && (typeof obj.sessionStorageKey !== "string" || !ROOT_PATTERN.test(obj.sessionStorageKey))) refuse("invalid_key", "header");
}
function orderedObject(obj: DataRecord, names: readonly string[]): DataRecord {
  const out: DataRecord = {};
  for (const name of names) Object.defineProperty(out, name, { value: obj[name], enumerable: true });
  return out;
}
function inventory(root: string, input: Json): string[] {
  if (!Array.isArray(input)) refuse("invalid_shape", "inventory");
  if (input.length > 1_024) refuse("limit_exceeded", "inventory");
  const keys: string[] = []; let flows = 0;
  for (const entry of input) keys.push(text(entry, 192, "inventory"));
  for (const key of keys) {
    const classification = classifyCredentialKey(root, key);
    if (classification.kind === "foreign" || classification.kind === "unsupported_own") refuse("invalid_key", "inventory");
    if (classification.kind === "flow_verifier") { if (flows >= 1_020) refuse("limit_exceeded", "inventory"); flows++; }
  }
  return keys;
}
function inventoryOrder(keys: readonly string[]): void {
  for (let i = 1; i < keys.length; i++) if (keys[i - 1] >= keys[i]) refuse("order_or_duplicate", "inventory");
}
function rank(n: number): string { return "c" + n.toString(16).padStart(4, "0"); }
function equalList(a: readonly string[], b: readonly string[]): boolean { return a.length === b.length && a.every((value, i) => value === b[i]); }
// Admission limits are independent of grammar/identifier validity. Inspect only
// owned JSON; malformed types are selected later in declaration order.
function inventoryLimits(obj: DataRecord): void {
  for (const name of ["initialEntryKeys", "verifiedItemIds", "items"]) {
    const list = obj[name];
    if (Array.isArray(list) && list.length > 1_024) refuse("limit_exceeded", name === "verifiedItemIds" ? "cursor" : "inventory");
  }
  const keyLimit = (value: Json | undefined) => { if (typeof value === "string" && value.length > 192) refuse("limit_exceeded", "inventory"); };
  if (Array.isArray(obj.initialEntryKeys)) for (const key of obj.initialEntryKeys) keyLimit(key);
  for (const name of ["fixedSlots", "items"]) if (Array.isArray(obj[name])) for (const entry of obj[name]) {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) keyLimit(entry.key);
  }
}
/** Exact JSON.stringify length, without allocating serialized output. Inputs are
 * owned finite JSON only. Well-formed stringify escapes lone UTF-16 surrogates.
 */
function canonicalBudget(input: Json, max: number): void {
  let units = 0;
  const add = (count: number) => { if (units > max - count) refuse("limit_exceeded"); units += count; };
  const quoted = (value: string) => {
    add(2);
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code === 34 || code === 92 || [8, 9, 10, 12, 13].includes(code)) add(2);
      else if (code < 32) add(6);
      else if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) { add(2); i++; } else add(6);
      } else if (code >= 0xdc00 && code <= 0xdfff) add(6);
      else add(1);
    }
  };
  const visit = (value: Json): void => {
    if (typeof value === "string") quoted(value);
    else if (value === null) add(4);
    else if (typeof value === "boolean") add(value ? 4 : 5);
    else if (typeof value === "number") add(String(value).length);
    else {
      add(2);
      if (Array.isArray(value)) value.forEach((child, i) => { if (i) add(1); visit(child); });
      else Object.entries(value).forEach(([key, child], i) => { if (i) add(1); quoted(key); add(1); visit(child); });
    }
  };
  visit(input);
}
function qOwned(input: Json, contract: CredentialContract): Q {
  const obj = record(input, "header"); inventoryLimits(obj); version(obj);
  const binding = obj.phase === "bound" ? "storeIdentity" : "expectedStoreIdentity";
  const fields = [...HEADER, "initialEntryKeys", "phase", "verifiedItemIds", binding];
  exactFields(obj, fields, "header"); headerTypes(obj);
  if (!Array.isArray(obj.initialEntryKeys)) refuse("invalid_shape", "inventory");
  for (const key of obj.initialEntryKeys) if (typeof key !== "string") refuse("invalid_shape", "inventory");
  if (typeof obj.phase !== "string") refuse("invalid_shape", "phase");
  if (!Array.isArray(obj.verifiedItemIds)) refuse("invalid_shape", "cursor");
  for (const id of obj.verifiedItemIds) if (typeof id !== "string") refuse("invalid_shape", "cursor");
  if (typeof obj[binding] !== "string") refuse("invalid_shape", "binding");
  identifiers(obj, false, contract);
  const keys = inventory(obj.sessionStorageKey as string, obj.initialEntryKeys);
  const ids = obj.verifiedItemIds;
  for (const id of ids) if (!/^c[0-9a-f]{4}$/.test(id as string)) refuse("invalid_identifier", "cursor");
  if (!isCanonicalUuid(obj[binding])) refuse("invalid_identifier", "binding");
  inventoryOrder(keys);
  if (!PHASES.includes(obj.phase)) refuse("phase_violation", "phase");
  if (ids.length > 1_024) refuse("limit_exceeded", "cursor");
  for (const id of ids) if (typeof id !== "string") refuse("invalid_shape", "cursor");
  if (ids.some((id, i) => id !== rank(i)) || ids.length > keys.length) refuse("order_or_duplicate", "cursor");
  if ((obj.phase === "intent" || obj.phase === "manifest_confirmed") && ids.length !== 0) refuse("phase_violation", "cursor");
  if ((obj.phase === "credentials_verified" || obj.phase === "bound") && ids.length !== keys.length) refuse("phase_violation", "cursor");
  return deepFreeze(orderedObject(obj, fields)) as unknown as Q;
}
const nativePromiseThen = Promise.prototype.then;
function validFingerprint(candidate: unknown, format: unknown): boolean {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 128) return false;
  try {
    if (typeof format !== "function") return false;
    const result: unknown = format(candidate);
    if (result === true) return true;
    if (result !== null && (typeof result === "object" || typeof result === "function")) {
      // Native state must be observed independently of a masked own `then`.
      // The intrinsic rejects non-Promise receivers; only those need generic
      // assimilation. Both paths discard reasons and never await format truth.
      try { void nativePromiseThen.call(result, () => {}, () => {}); }
      catch { void new Promise<unknown>(resolve => { resolve(result); }).then(() => {}, () => {}); }
    }
    return false;
  } catch { return false; }
}
function mOwned(input: Json, contract: CredentialContract): M {
  const obj = record(input, "header"); inventoryLimits(obj); version(obj);
  const fields = [...HEADER, "expectedStoreIdentity", "initialEntryKeys", "fixedSlots", "items"];
  exactFields(obj, fields, "header");
  // Exact nested fields precede all field-type checks. Non-record entries are
  // deferred to the type stage rather than traversed/coerced here.
  for (const name of ["fixedSlots", "items"]) if (Array.isArray(obj[name])) for (const entry of obj[name]) {
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) exactFields(entry, name === "fixedSlots" ? ["kind", "key", "presence"] : ["itemId", "key", "fingerprint"], "inventory");
  }
  headerTypes(obj);
  if (typeof obj.expectedStoreIdentity !== "string") refuse("invalid_shape", "binding");
  if (!Array.isArray(obj.initialEntryKeys) || !Array.isArray(obj.fixedSlots) || !Array.isArray(obj.items)) refuse("invalid_shape", "inventory");
  for (const key of obj.initialEntryKeys) if (typeof key !== "string") refuse("invalid_shape", "inventory");
  const fixed: Json[] = [], items: Json[] = [];
  for (const entry of obj.fixedSlots) {
    const slot = record(entry, "inventory"); exactFields(slot, ["kind", "key", "presence"], "inventory");
    if (typeof slot.kind !== "string" || typeof slot.key !== "string" || (slot.presence !== "present" && slot.presence !== "absent")) refuse("invalid_shape", "inventory");
    fixed.push(orderedObject(slot, ["kind", "key", "presence"]));
  }
  for (const entry of obj.items) {
    const item = record(entry, "inventory"); exactFields(item, ["itemId", "key", "fingerprint"], "inventory");
    if (typeof item.itemId !== "string" || typeof item.key !== "string") refuse("invalid_shape", "inventory");
    if (typeof item.fingerprint !== "string" || item.fingerprint.length === 0 || item.fingerprint.length > 128) refuse("fingerprint_invalid", "evidence");
    items.push(orderedObject(item, ["itemId", "key", "fingerprint"]));
  }
  identifiers(obj, false, contract);
  if (!isCanonicalUuid(obj.expectedStoreIdentity)) refuse("invalid_identifier", "binding");
  const keys = inventory(obj.sessionStorageKey as string, obj.initialEntryKeys);
  inventoryOrder(keys);
  const slots = fixedCredentialSlots(obj.sessionStorageKey as string);
  if (fixed.length !== 4 || items.length !== keys.length) refuse("membership_mismatch", "inventory");
  for (let i = 0; i < fixed.length; i++) {
    const slot = record(fixed[i]);
    if (slot.kind !== slots[i].kind || slot.key !== slots[i].key || slot.presence !== (keys.includes(slots[i].key) ? "present" : "absent")) refuse("membership_mismatch", "inventory");
  }
  for (let i = 0; i < items.length; i++) {
    const item = record(items[i]);
    if (item.itemId !== rank(i) || item.key !== keys[i]) refuse("membership_mismatch", "inventory");
  }
  const out = orderedObject(obj, fields);
  // Replace arrays only on a newly constructed data object, not caller data.
  const canonical = { ...out, fixedSlots: fixed, items };
  return deepFreeze(canonical) as unknown as M;
}
function fOwned(input: Json): F {
  const obj = record(input, "fault"); version(obj); const fields = ["schemaVersion", "code", "phase", "operation"];
  exactFields(obj, fields, "fault");
  for (const name of ["code", "phase", "operation"]) if (typeof obj[name] !== "string") refuse("invalid_shape", "fault");
  if (!(FAULT_CODES as readonly Json[]).includes(obj.code) || !(FAULT_PHASES as readonly Json[]).includes(obj.phase) || !(FAULT_OPERATIONS as readonly Json[]).includes(obj.operation)) refuse("invalid_shape", "fault");
  return deepFreeze(orderedObject(obj, fields)) as unknown as F;
}
function rootFromKey(key: string): string {
  const match = /^sb-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?-auth-token(?:$|-)/.exec(key);
  if (!match) refuse("invalid_key", "inventory");
  return match[0].endsWith("-auth-token-") ? match[0].slice(0, -1) : match[0];
}
function iOwned(input: Json, root: unknown, pair: Json | undefined, contract: CredentialContract): I {
  const obj = record(input, "header"); version(obj);
  const fields = ["schemaVersion", "protocolId", "credentialEpochId", "originManifestId", "providerConfigIdentity", "sdkContractVersion", "key", "value"];
  exactFields(obj, fields, "header"); headerTypes(obj, true);
  const key = text(obj.key, 192, "inventory"), raw = text(obj.value, SDK_RAW_LIMIT, "session");
  identifiers(obj, true, contract);
  const resolvedRoot = root === undefined ? rootFromKey(key) : root;
  unwrap(validateRuntimeCredentialValue(resolvedRoot, key, raw));
  if (pair !== undefined) {
    const header = record(pair, "binding");
    for (const field of ["schemaVersion", "protocolId", "credentialEpochId", "providerConfigIdentity", "sdkContractVersion"]) if (obj[field] !== header[field]) refuse("identity_mismatch", "binding");
    if (obj.originManifestId !== header.manifestId || resolvedRoot !== header.sessionStorageKey) refuse("identity_mismatch", "binding");
  }
  return deepFreeze(orderedObject(obj, fields)) as unknown as I;
}
export function parseQ(raw: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<Q> { return contractResult(() => qOwned(parseBoundedJson(raw), contract)); }
export function parseM(raw: unknown, format: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<M> {
  const predicate = format;
  return contractResult(() => {
    const m = mOwned(parseBoundedJson(raw), contract);
    if (typeof predicate !== "function") refuse("evidence_unavailable", "evidence");
    for (const item of m.items) if (!validFingerprint(item.fingerprint, predicate)) refuse("fingerprint_invalid", "evidence");
    return m;
  });
}
export function parseI(raw: unknown, root?: unknown, pairHeader?: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<I> {
  return contractResult(() => {
    const data = parseBoundedJson(raw, 6_300_000);
    const pair = pairHeader === undefined ? undefined : snapshotJson(pairHeader);
    return iOwned(data, root, pair, contract);
  });
}
export const parseItem = parseI;
export function parseF(raw: unknown): Result<F> { return contractResult(() => fOwned(parseBoundedJson(raw, 512))); }
function serializeOwned(input: unknown, validate: (owned: Json) => unknown, max: number): Result<string> {
  return contractResult(() => {
    const owned = snapshotJson(input);
    canonicalBudget(owned, max);
    const data = validate(owned); const raw = JSON.stringify(data);
    if (raw.length > max) refuse("limit_exceeded"); return raw;
  });
}
export function serializeQ(input: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<string> { return serializeOwned(input, owned => qOwned(owned, contract), SDK_RAW_LIMIT); }
export function serializeM(input: unknown, format: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<string> {
  return serializeOwned(input, owned => {
    const m = mOwned(owned, contract);
    if (typeof format !== "function") refuse("evidence_unavailable", "evidence");
    for (const item of m.items) if (!validFingerprint(item.fingerprint, format)) refuse("fingerprint_invalid", "evidence"); return m;
  }, SDK_RAW_LIMIT);
}
export function serializeI(input: unknown, root?: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<string> { return serializeOwned(input, owned => iOwned(owned, root, undefined, contract), 6_300_000); }
export const serializeItem = serializeI;
export function serializeF(input: unknown): Result<string> { return serializeOwned(input, fOwned, 512); }
export function transitionQ(before: unknown, action: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<Q> {
  return contractResult(() => {
    const ownedBefore = snapshotJson(before), ownedAction = snapshotJson(action);
    const q = qOwned(ownedBefore, contract), a = record(ownedAction, "phase");
    const kind = a.kind;
    if (typeof kind !== "string") refuse("invalid_shape", "phase");
    exactFields(a, kind === "bind" ? ["kind", "storeIdentity"] : kind === "confirm_next_item" ? ["kind", "itemId"] : ["kind"], "phase");
    if (kind === "confirm_next_item") {
      if (typeof a.itemId !== "string") refuse("invalid_shape", "cursor");
      if (!/^c[0-9a-f]{4}$/.test(a.itemId)) refuse("invalid_identifier", "cursor");
    } else if (kind === "bind") {
      if (typeof a.storeIdentity !== "string") refuse("invalid_shape", "binding");
      if (!isCanonicalUuid(a.storeIdentity)) refuse("invalid_identifier", "binding");
    }
    let phase = q.phase; const ids = [...q.verifiedItemIds];
    if (kind === "confirm_manifest" && phase === "intent") phase = "manifest_confirmed";
    else if (kind === "begin_copying" && phase === "manifest_confirmed") phase = "copying";
    else if (kind === "confirm_next_item" && phase === "copying" && ids.length < q.initialEntryKeys.length && a.itemId === rank(ids.length)) ids.push(a.itemId as string);
    else if (kind === "verify_all" && phase === "copying" && ids.length === q.initialEntryKeys.length) phase = "credentials_verified";
    else if (kind === "bind" && phase === "credentials_verified") {
      if (a.storeIdentity !== q.expectedStoreIdentity) refuse("identity_mismatch", "binding"); phase = "bound";
    } else refuse("phase_violation", "phase");
    const next: DataRecord = {};
    for (const name of HEADER) next[name] = (q as unknown as DataRecord)[name];
    next.initialEntryKeys = [...q.initialEntryKeys]; next.phase = phase; next.verifiedItemIds = ids;
    if (phase === "bound") next.storeIdentity = a.storeIdentity;
    else next.expectedStoreIdentity = q.expectedStoreIdentity!;
    return qOwned(next, contract);
  });
}
function correlateOwned(q: Q, m: M): void {
  for (const name of HEADER) if (q[name] !== m[name]) refuse("identity_mismatch", "binding");
  if (!equalList(q.initialEntryKeys, m.initialEntryKeys)) refuse("membership_mismatch", "inventory");
  if (m.expectedStoreIdentity !== (q.phase === "bound" ? q.storeIdentity : q.expectedStoreIdentity)) refuse("identity_mismatch", "binding");
}
export function correlatePair(qInput: unknown, mInput: unknown, dInput: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Result<{ q: Q; m: M; dStoreIdentity: Json }> {
  return contractResult(() => {
    const qs = snapshotJson(qInput), ms = snapshotJson(mInput), ds = snapshotJson(dInput);
    canonicalBudget(qs, SDK_RAW_LIMIT); canonicalBudget(ms, SDK_RAW_LIMIT);
    const q = qOwned(qs, contract), m = mOwned(ms, contract), d = record(ds, "binding");
    correlateOwned(q, m);
    if (d.kind !== "preactive" && d.kind !== "active") refuse("invalid_shape", "binding");
    exactFields(d, d.kind === "preactive" ? ["kind", "expected"] : ["kind", "storeIdentity"], "binding");
    const id = d.kind === "preactive" ? d.expected : d.storeIdentity;
    if (!isCanonicalUuid(id)) refuse("invalid_identifier", "binding");
    if ((q.phase === "bound") !== (d.kind === "active") || id !== m.expectedStoreIdentity) refuse("identity_mismatch", "binding");
    return deepFreeze({ q, m, dStoreIdentity: ds });
  });
}
export type ValidatedFrozenCopy = Readonly<{ q: Q; m: M; sourceSnapshot: Json; protectedSnapshot: Json }>;
function protectedResult(input: Json): DataRecord {
  const result = record(input, "evidence");
  if (result.status === "value") { exactFields(result, ["status", "raw"], "evidence"); text(result.raw, 6_300_000, "evidence"); }
  else if (result.status === "absent") exactFields(result, ["status"], "evidence");
  else if (result.status === "read_failed") {
    exactFields(result, ["status", "reason"], "evidence");
    if (typeof result.reason !== "string" || !REASONS.includes(result.reason)) refuse("invalid_shape", "evidence");
  } else refuse("invalid_shape", "evidence");
  return result;
}
export async function validateFrozenCopy(qInput: unknown, mInput: unknown, sourceInput: unknown, protectedInput: unknown, fingerprint: unknown, formatPredicate: unknown, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): Promise<Result<ValidatedFrozenCopy>> {
  // All FOUR snapshots finish before ANY injected predicate/digest or first await.
  const compute = fingerprint, format = formatPredicate;
  const structure = contractResult(() => {
    const qs = snapshotJson(qInput), ms = snapshotJson(mInput), source = snapshotJson(sourceInput), target = snapshotJson(protectedInput);
    // Enforce serialized Q/M budgets on already-owned data only.
    canonicalBudget(qs, SDK_RAW_LIMIT); canonicalBudget(ms, SDK_RAW_LIMIT);
    const q = qOwned(qs, contract), m = mOwned(ms, contract); correlateOwned(q, m);
    const inventory = unwrap(validateQuiescentCredentialSnapshot(q.sessionStorageKey, source));
    if (!equalList(inventory.initialEntryKeys, m.initialEntryKeys)) refuse("membership_mismatch", "inventory");
    const p = record(target, "evidence"); exactFields(p, ["items", "fixedItemAbsences"], "evidence");
    if (!Array.isArray(p.items) || !Array.isArray(p.fixedItemAbsences)) refuse("invalid_shape", "evidence");
    const absent = m.fixedSlots.filter(slot => slot.presence === "absent");
    // Validate all records before distinguishing missing evidence from mismembership.
    const observedItems = p.items.map(input => { const item = record(input, "evidence"); exactFields(item, ["itemId", "key", "result"], "evidence"); protectedResult(item.result); return item; });
    const observedAbsences = p.fixedItemAbsences.map(input => { const item = record(input, "evidence"); exactFields(item, ["kind", "key", "result"], "evidence"); protectedResult(item.result); return item; });
    if (observedItems.length > m.items.length || observedAbsences.length > absent.length) refuse("membership_mismatch", "evidence");
    const itemKeys = new Set<string>(), absenceKeys = new Set<string>();
    for (const item of observedItems) {
      if (typeof item.key !== "string" || itemKeys.has(item.key) || !m.items.some(expected => expected.key === item.key && expected.itemId === item.itemId)) refuse("membership_mismatch", "evidence"); itemKeys.add(item.key);
    }
    for (const item of observedAbsences) {
      if (typeof item.key !== "string" || absenceKeys.has(item.key) || !absent.some(expected => expected.key === item.key && expected.kind === item.kind)) refuse("membership_mismatch", "evidence"); absenceKeys.add(item.key);
    }
    if (observedItems.length < m.items.length || observedAbsences.length < absent.length) refuse("evidence_unavailable", "evidence");
    for (let i = 0; i < observedItems.length; i++) {
      const item = observedItems[i], expected = m.items[i];
      if (item.key !== expected.key || item.itemId !== expected.itemId) refuse("membership_mismatch", "evidence");
      const result = record(item.result);
      if (result.status !== "value") refuse("evidence_unavailable", "evidence");
      const envelope = iOwned(parseBoundedJson(result.raw, 6_300_000), q.sessionStorageKey, qs, contract);
      if (envelope.key !== expected.key) refuse("membership_mismatch", "evidence");
      if (envelope.value !== inventory.items[i].raw) refuse("identity_mismatch", "evidence");
    }
    for (let i = 0; i < absent.length; i++) {
      if (observedAbsences[i].key !== absent[i].key || observedAbsences[i].kind !== absent[i].kind) refuse("membership_mismatch", "evidence");
      if (record(observedAbsences[i].result).status !== "absent") refuse("evidence_unavailable", "evidence");
    }
    return { copy: deepFreeze({ q, m, sourceSnapshot: source, protectedSnapshot: target }), items: inventory.items };
  });
  if (!structure.ok) return structure;
  if (typeof compute !== "function" || typeof format !== "function") return { ok: false, issue: { code: "evidence_unavailable", field: "evidence" } };
  const { copy, items } = structure.value;
  for (const item of copy.m.items) if (!validFingerprint(item.fingerprint, format)) return { ok: false, issue: { code: "fingerprint_invalid", field: "evidence" } };
  for (let i = 0; i < items.length; i++) {
    let candidate: unknown;
    try { candidate = await compute("credential-value/v1", items[i].key, items[i].raw); }
    catch { return { ok: false, issue: { code: "evidence_unavailable", field: "evidence" } }; }
    if (!validFingerprint(candidate, format) || candidate !== copy.m.items[i].fingerprint) return { ok: false, issue: { code: "fingerprint_invalid", field: "evidence" } };
  }
  return { ok: true, value: copy };
}
const ISSUE_CODES = ["invalid_input", "hostile_input", "limit_exceeded", "invalid_json", "duplicate_member", "unsupported_version", "unknown_field", "invalid_shape", "invalid_identifier", "invalid_key", "order_or_duplicate", "phase_violation", "membership_mismatch", "identity_mismatch", "fingerprint_invalid", "evidence_unavailable"];
const ISSUE_FIELDS = ["input", "header", "phase", "inventory", "cursor", "binding", "session", "user", "verifier", "index", "fault", "evidence"];
/** The only diagnostic projection. Never forward an arbitrary supplied object. */
export function projectCredentialIssue(input: unknown): CredentialIssue {
  const projected = contractResult(() => {
    const issue = record(snapshotJson(input)); exactFields(issue, ["code", "field"]);
    if (typeof issue.code !== "string" || typeof issue.field !== "string" || !ISSUE_CODES.includes(issue.code) || !ISSUE_FIELDS.includes(issue.field)) refuse("invalid_input");
    return Object.freeze({ code: issue.code, field: issue.field }) as CredentialIssue;
  });
  return projected.ok ? projected.value : Object.freeze({ code: "invalid_input", field: "input" });
}
