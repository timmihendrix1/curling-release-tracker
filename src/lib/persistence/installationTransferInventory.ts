// Inactive pure S2 candidate. No source capability or operational transfer.
export type TransferCode = "invalid_input" | "unsupported_format" | "invalid_envelope" | "duplicate_member" | "noncanonical_wire" | "limit_exceeded" | "incomplete_inventory" | "unknown_owned_family" | "source_unobserved" | "source_unhealthy" | "sensitive_archive_unavailable" | "identity_archive_unsupported" | "fingerprint_unavailable" | "fingerprint_failed" | "fingerprint_invalid" | "digest_mismatch";
export type TransferResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: TransferCode };
export type ReadPlan = { readonly profiles: readonly string[]; readonly dynamicIdentity: readonly string[]; readonly rawReads: readonly string[]; readonly absenceProbes: readonly string[]; readonly controlHealthKeys: readonly string[]; readonly exclusions: Readonly<Record<string, number>> };

// This boundary is intentionally S2-specific: its finite budgets and failure
// vocabulary are not those of the independently accepted S1 protocol.
import { isCanonicalUuid } from "../uuid";
import { IDENTITY_BARRIER_STORAGE_KEY, validateIdentityAccessBarrier } from "../identity/identityBarrier";
import { TRUSTED_DEVICE_STORAGE_KEY, validateTrustedDeviceRecord } from "../identity/trustedDevice";
import { INTERACTIVE_ATTEMPT_STORAGE_KEY, validateInteractiveAuthAttempt } from "../identity/interactiveAttempt";
import { isResolutionStorageKey, resolutionStorageKeyFor, validateIdentityBarrierResolution } from "../identity/identityBarrierResolution";
import { isValidTimestamp } from "../identity/untrustedValue";

// Closed owned constants: unused archive/source imports must not enter app bundles.
export const TRANSFER_LIMITS = /* @__PURE__ */ Object.freeze({ input: 25165824, wire: 25165824, depth: 16, decoded: 4194304, raw: 3145728, sporting: 1048576, identity: 65536, legacy: 8, key: 256, label: 64, name: 64, profiles: 32, dynamic: 512, items: 1024, listed: 4096, edges: 65536, preimage: 16777216, decision: 65536 });
export const TRANSFER_PROFILE_PREFIX = "curling.sporting.profile.v1.";
export const TRANSFER_SPORTING_SUFFIXES = /* @__PURE__ */ Object.freeze([
  "curling-release-tracker-current-session", "curling-release-tracker-session-history", "curling-release-tracker-history-filters", "curling-release-tracker-assessment-data", "curling-release-tracker-training-plans", "curling-release-tracker-accuracy-tolerance-profiles", "curling-release-tracker-smart-random-profiles", "curling-release-tracker-assessment-show-introduction", "curling-release-tracker-assessment-last-threshold-preset", "curling-release-tracker-assessment-last-custom-threshold", "curling-release-tracker-assessment-draft", "curling-release-tracker-assessment-history", "curling-release-tracker-cloud-sporting-sync",
]);
const descriptors = ["session-current-raw-v1", "session-history-raw-v1", "history-filters-raw-v1", "assessment-combined-raw-v1", "training-plans-raw-v1", "tolerance-profiles-raw-v1", "random-profiles-raw-v1", "assessment-intro-raw-v1", "assessment-preset-raw-v1", "assessment-threshold-raw-v1", "assessment-draft-raw-v1", "assessment-history-raw-v1", "cloud-sync-raw-v1"];
export const TRANSFER_IDENTITY_KEYS = /* @__PURE__ */ Object.freeze([TRUSTED_DEVICE_STORAGE_KEY, IDENTITY_BARRIER_STORAGE_KEY, INTERACTIVE_ATTEMPT_STORAGE_KEY, "curling.identity.pendingIntent.v1", "curling.identity.intentCleanup.v1"]);
const identityNames = ["trustedDevice", "accessBarrier", "interactiveAttempt", "pendingIntent", "intentCleanup"];
export const TRANSFER_LEGACY_KEY = "curling.sporting.legacy-unscoped-retired.v1";
export const TRANSFER_CONTROL_KEYS = /* @__PURE__ */ Object.freeze(["curling.nativeMigration.sourceMarker.v1", "curling.nativeMigration.activationRecord.v1", "curling.nativeMigration.faultLatch.v1"]);
export type Json = null | boolean | number | string | Json[] | JsonObject;
export type JsonObject = { [key: string]: Json };
export type WorkBudget = { decoded: number; edges: number };
export const workBudget = (): WorkBudget => ({ decoded: 0, edges: 0 });
// Admit only primitive literals before retention; never inspect unknown values.
function admittedTransferCode(value: unknown): TransferCode {
  switch (value) {
    case "invalid_input": case "unsupported_format": case "invalid_envelope":
    case "duplicate_member": case "noncanonical_wire": case "limit_exceeded":
    case "incomplete_inventory": case "unknown_owned_family":
    case "source_unobserved": case "source_unhealthy":
    case "sensitive_archive_unavailable": case "identity_archive_unsupported":
    case "fingerprint_unavailable": case "fingerprint_failed":
    case "fingerprint_invalid": case "digest_mismatch": return value;
    default: return "invalid_envelope";
  }
}
const refusals = new WeakMap<object, TransferCode>();
export function fail(code: TransferCode): never { const signal = Object.create(null); refusals.set(signal, admittedTransferCode(code)); throw signal; }
export function failure(reason: unknown, fallback: TransferCode = "invalid_envelope"): {ok:false;code:TransferCode} {
  // Identity lookup only: no reflection, instanceof or thrown-value inspection.
  const code = (typeof reason === "object" && reason !== null) || typeof reason === "function" ? refusals.get(reason as object) : undefined;
  return { ok: false, code: admittedTransferCode(code ?? fallback) };
}
export function checkedAdd(a: number, b: number, limit: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || b > limit || a > limit - b) fail("limit_exceeded");
  return a + b;
}
export function checkedMultiply(a: number, b: number, limit: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 0 || b < 0 || (b !== 0 && a > Math.floor(limit / b))) fail("limit_exceeded");
  return a * b;
}
export function unitOrder(a: string, b: string): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const d = a.charCodeAt(i) - b.charCodeAt(i); if (d !== 0) return d; }
  return a.length - b.length;
}
export function sortedUnique(values: readonly string[], code: TransferCode): void {
  for (let i = 1; i < values.length; i++) if (unitOrder(values[i - 1], values[i]) >= 0) fail(code);
}
export function record(value: Json, code: TransferCode = "invalid_envelope"): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value;
}
export function exact(value: Json, names: readonly string[], code: TransferCode = "invalid_envelope"): JsonObject {
  const result = record(value, code); const keys = Object.keys(result);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) fail(code);
  return result;
}
export function text(value: Json, max: number, code: TransferCode = "invalid_envelope"): string {
  if (typeof value !== "string") fail(code);
  if (value.length > max) fail("limit_exceeded"); return value;
}
export function array(value: Json, max: number, code: TransferCode = "invalid_envelope"): Json[] {
  if (!Array.isArray(value)) fail(code);
  if (value.length > max) fail("limit_exceeded"); return value;
}
export function uint(value: Json, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) fail("invalid_envelope");
  if (value > max) fail("limit_exceeded"); return value;
}
export function label(value: Json): string { const s = text(value, 64); const match = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.exec(s); if (!match || match[0].length !== s.length) fail("invalid_envelope"); return s; }
export function uuid(value: Json): string { if (!isCanonicalUuid(value) || value.length !== 36) fail("invalid_envelope"); return value; }
export function freezeTree<T>(tree: T): T {
  if (tree !== null && typeof tree === "object") { for (const child of Object.values(tree)) freezeTree(child); Object.freeze(tree); }
  return tree;
}

/** One bounded iterative scanner/tree builder. No pre-admission JSON.parse.
 * Only allocations avoidable AFTER the primitive-string entry are bounded;
 * this is neither a streaming bridge nor a measured JS heap ceiling. */
function parseTransferJsonForVersion(input: unknown, budget: WorkBudget, maximum: number, version: 1 | 2): Json {
  if (typeof input !== "string") fail("invalid_input");
  if (input.length > maximum) fail("limit_exceeded");
  const s = input; let p = 0;
  const syntax = (): never => fail("invalid_envelope");
  const ws = () => { while (p < s.length && (s[p] === " " || s[p] === "\n" || s[p] === "\r" || s[p] === "\t")) p++; };
  const string = (name: boolean, cap: number, allocate = true, charge = true): string => {
    if (s[p++] !== '"') syntax();
    const chunks: string[] = []; let chunk = ""; let length = 0;
    if (name) cap = TRANSFER_LIMITS.name;
    while (p < s.length) {
      let c = s.charCodeAt(p++);
      if (c === 34) { chunks.push(chunk); return chunks.join(""); }
      if (c < 32) syntax();
      if (c === 92) {
        const e = s[p++];
        if (e === "u") { let n = 0; for (let j = 0; j < 4; j++) { const h = s[p++]; if (h === undefined || !/[0-9a-fA-F]/.test(h)) syntax(); n = n * 16 + parseInt(h, 16); } c = n; }
        else { const escapes: Record<string, number> = { '"':34, "\\":92, "/":47, b:8, f:12, n:10, r:13, t:9 }; if (!Object.hasOwn(escapes, e)) syntax(); c = escapes[e]; }
      }
      length = checkedAdd(length, 1, cap);
      if (charge) budget.decoded = checkedAdd(budget.decoded, 1, TRANSFER_LIMITS.decoded);
      if (allocate) { chunk += String.fromCharCode(c); if (chunk.length === 1024) { chunks.push(chunk); chunk = ""; } }
    }
    return syntax();
  };
  type Frame = { value: Json[] | JsonObject; object: boolean; state: "first" | "key" | "value" | "comma"; key: string; containing: string; maximum: number; seen: Set<string>; raw?: {start: number; length: number} };
  const stack: Frame[] = []; let root: Json = null; let assigned = false; let rawTotal = 0;
  const closeFrame = (f: Frame) => {
    if (f.raw) {
      const key = (f.value as JsonObject).key;
      const slot = typeof key === "string" ? transferSlotForVersion(key,version) : null;
      const cap = slot?.category === "identity_archive" ? TRANSFER_LIMITS.identity : slot?.category === "legacy_archive" ? TRANSFER_LIMITS.legacy : TRANSFER_LIMITS.sporting;
      if (f.raw.length > cap) fail("limit_exceeded");
      rawTotal = checkedAdd(rawTotal,f.raw.length,TRANSFER_LIMITS.raw);
      const resume = p; p = f.raw.start;
      (f.value as JsonObject).raw = string(false,cap,true,false); p = resume;
    }
    stack.pop();
  };
  const attach = (value: Json) => {
    const f = stack[stack.length - 1];
    if (!f) { if (assigned) syntax(); root = value; assigned = true; return; }
    if (f.object) (f.value as JsonObject)[f.key] = value;
    else (f.value as Json[]).push(value);
    f.state = "comma";
  };
  const value = () => {
    ws(); const c = s[p];
    const parent = stack[stack.length - 1];
    if (parent) {
      budget.edges = checkedAdd(budget.edges,1,TRANSFER_LIMITS.edges);
      if (!parent.object && (parent.value as Json[]).length >= parent.maximum) fail("limit_exceeded");
    }
    if (c === "{" || c === "[") {
      if (stack.length >= TRANSFER_LIMITS.depth) fail("limit_exceeded");
      const node: JsonObject | Json[] = c === "{" ? Object.create(null) : [];
      const containing = parent?.object ? parent.key : "";
      const maximum = containing === "items" || containing === "observations" ? TRANSFER_LIMITS.items : containing === "profiles" ? TRANSFER_LIMITS.profiles : containing === "keys" ? (parent?.containing === "dynamicIdentity" ? TRANSFER_LIMITS.dynamic : TRANSFER_LIMITS.listed) : TRANSFER_LIMITS.edges;
      attach(node); p++; stack.push({value:node,object:c === "{",state:"first",key:"",containing,maximum,seen:new Set()}); return;
    }
    if (c === '"') {
      if (parent?.object && parent.key === "raw") {
        const start = p; const before = budget.decoded;
        string(false,TRANSFER_LIMITS.sporting,false);
        parent.raw = {start,length:budget.decoded-before}; attach("");
      } else {
        const cap = parent?.key === "key" || parent?.containing === "keys" ? TRANSFER_LIMITS.key : ["version","build","catalogContractId"].includes(parent?.key ?? "") ? TRANSFER_LIMITS.label : TRANSFER_LIMITS.decoded;
        attach(string(false,cap));
      }
      return;
    }
    for (const [literal, v] of [["null",null],["false",false],["true",true]] as const) if (s.startsWith(literal,p)) { p += literal.length; attach(v); return; }
    if (c >= "0" && c <= "9") {
      const start = p; let n = 0;
      while (s[p] >= "0" && s[p] <= "9") { const d = s.charCodeAt(p++) - 48; if (p - start > 16 || n > Math.floor((Number.MAX_SAFE_INTEGER - d) / 10)) syntax(); n = n * 10 + d; }
      if ((p - start > 1 && c === "0") || s[p] === "." || s[p] === "e" || s[p] === "E") syntax();
      attach(n); return;
    }
    syntax();
  };
  value();
  while (stack.length) {
    const f = stack[stack.length - 1]; ws(); const close = f.object ? "}" : "]";
    if (f.state === "comma") { if (s[p] === close) { p++; closeFrame(f); continue; } if (s[p++] !== ",") syntax(); f.state = f.object ? "key" : "value"; }
    else if (f.state === "first" && s[p] === close) { p++; closeFrame(f); continue; }
    ws();
    if (f.object) {
      f.key = string(true,TRANSFER_LIMITS.name); if (f.seen.has(f.key)) fail("duplicate_member"); f.seen.add(f.key);
      ws(); if (s[p++] !== ":") syntax();
    }
    value();
  }
  ws(); if (!assigned || p !== s.length) syntax(); return root;
}

export function parseTransferJson(input: unknown, budget = workBudget(), maximum: number = TRANSFER_LIMITS.input): Json {
  return parseTransferJsonForVersion(input,budget,maximum,1);
}

export type Slot = { key: string; category: "sporting" | "identity_archive" | "legacy_archive"; profileId: string | null; domainContract: string };
const deletionGuardPrefix = "curling.identity.accountDeletionGuard.";
const deletionResolutionPrefix = "curling.identity.accountDeletionGuardResolution.";
function deletionSelector(key: string, prefix: string): string | null {
  if (key.length !== prefix.length + 39 || !key.startsWith(prefix) || !key.endsWith(".v1")) return null;
  const selector = key.slice(prefix.length,-3);
  return isCanonicalUuid(selector) ? selector : null;
}
function transferSlotForVersion(key: string, version: 1 | 2): Slot | null {
  const fixed = TRANSFER_IDENTITY_KEYS.indexOf(key);
  if (fixed >= 0) return {key,category:"identity_archive",profileId:null,domainContract:`identity-${identityNames[fixed]}-v1`};
  if (isResolutionStorageKey(key) && key.length === `curling.identity.accessBarrierResolution.${"0".repeat(36)}.v1`.length) return {key,category:"identity_archive",profileId:null,domainContract:"identity-barrierResolution-v1"};
  if (version === 2) {
    if (deletionSelector(key,deletionGuardPrefix)) return {key,category:"identity_archive",profileId:null,domainContract:"identity-accountDeletionGuard-v1"};
    if (deletionSelector(key,deletionResolutionPrefix)) return {key,category:"identity_archive",profileId:null,domainContract:"identity-accountDeletionGuardResolution-v1"};
  }
  if (key === TRANSFER_LEGACY_KEY) return {key,category:"legacy_archive",profileId:null,domainContract:"legacy-retirement-v1"};
  if (key.startsWith(TRANSFER_PROFILE_PREFIX)) {
    const rest = key.slice(TRANSFER_PROFILE_PREFIX.length); const id = rest.slice(0,36); const index = TRANSFER_SPORTING_SUFFIXES.indexOf(rest.slice(37));
    if (rest[36] === "." && isCanonicalUuid(id) && index >= 0) return {key,category:"sporting",profileId:id,domainContract:descriptors[index]};
  }
  return null;
}
export function transferSlot(key: string): Slot | null { return transferSlotForVersion(key,1); }
function inventoryFromListingForVersion(value: Json, version: 1 | 2): ReadPlan {
  const listing = exact(value,["schemaVersion","keys"]); if (listing.schemaVersion !== 1) fail("invalid_envelope");
  const keys = array(listing.keys,TRANSFER_LIMITS.listed).map(k => text(k,TRANSFER_LIMITS.key)); sortedUnique(keys,"incomplete_inventory");
  const profiles = new Set<string>(); const dynamic: string[] = []; const rawReads: string[] = []; const controls: string[] = [];
  const exclusions = {providerCredentials:0,retiredUnscoped:0,publicCaches:0,foreignKeys:0};
  for (const key of keys) {
    const slot = transferSlotForVersion(key,version);
    if (slot) { rawReads.push(key); if (slot.profileId) profiles.add(slot.profileId); if (slot.category === "identity_archive" && !TRANSFER_IDENTITY_KEYS.includes(key)) dynamic.push(key); }
    else if (TRANSFER_CONTROL_KEYS.includes(key)) controls.push(key);
    else if (/^sb-[^.]+-auth-token(?:$|-)/.test(key)) exclusions.providerCredentials++;
    else if (TRANSFER_SPORTING_SUFFIXES.slice(0,10).includes(key)) exclusions.retiredUnscoped++;
    else if (key.startsWith("curling-performance-public-exercise-diagram-v1.")) exclusions.publicCaches++;
    else if (key.startsWith("curling.") || key.startsWith("curling-release-tracker-") || key.startsWith("curling-performance-")) fail("unknown_owned_family");
    else exclusions.foreignKeys++;
    if (profiles.size > TRANSFER_LIMITS.profiles || dynamic.length > TRANSFER_LIMITS.dynamic) fail("limit_exceeded");
  }
  const profileList = [...profiles].sort(unitOrder);
  const slots = expectedSlots(profileList,dynamic); const present = new Set(rawReads);
  return freezeTree({profiles:profileList,dynamicIdentity:dynamic,rawReads,absenceProbes:slots.filter(key => !present.has(key)),controlHealthKeys:controls,exclusions});
}
export function inventoryFromListing(value: Json): ReadPlan { return inventoryFromListingForVersion(value,1); }
export function expectedSlots(profiles: readonly string[], dynamic: readonly string[]): string[] {
  if (profiles.length > TRANSFER_LIMITS.profiles || dynamic.length > TRANSFER_LIMITS.dynamic) fail("limit_exceeded");
  checkedAdd(checkedAdd(checkedMultiply(profiles.length,13,TRANSFER_LIMITS.items),6,TRANSFER_LIMITS.items),dynamic.length,TRANSFER_LIMITS.items);
  return [...TRANSFER_IDENTITY_KEYS,TRANSFER_LEGACY_KEY,...dynamic,...profiles.flatMap(id => TRANSFER_SPORTING_SUFFIXES.map(suffix => TRANSFER_PROFILE_PREFIX + id + "." + suffix))].sort(unitOrder);
}
export function planInstallationTransferInventory(listingJson: unknown): TransferResult<ReadPlan> {
  try { return {ok:true,value:inventoryFromListing(parseTransferJson(listingJson))}; } catch (reason) { return failure(reason); }
}
export function planInstallationTransferInventoryV2(listingJson: unknown): TransferResult<ReadPlan> {
  try { return {ok:true,value:inventoryFromListingForVersion(parseTransferJsonForVersion(listingJson,workBudget(),TRANSFER_LIMITS.input,2),2)}; } catch (reason) { return failure(reason); }
}

const identityFields = [
  ["schemaVersion","accountScopeId","profileId","displayName","onboardingCompletedAt","entitlement","generation","establishedAt","lastServerConfirmationAt"],
  ["schemaVersion","barrierId","origin","barredAccountScopeId","barredGeneration","establishedAt"],
  ["schemaVersion","attemptId","method","flowId","barrierId","capturedIdentityGeneration","startedAt"],
  ["schemaVersion","kind","value","capturedAt","survival"],
  ["schemaVersion","recordedAt"],
];
/** Validate only inert exact closed identity forms. Never a live repository load. */
function validateArchivedRawForVersion(slot: Slot, raw: string, budget: WorkBudget, version: 1 | 2): JsonObject | undefined {
  const max = slot.category === "sporting" ? TRANSFER_LIMITS.sporting : slot.category === "identity_archive" ? TRANSFER_LIMITS.identity : TRANSFER_LIMITS.legacy;
  if (raw.length > max) fail("limit_exceeded");
  if (slot.category === "sporting") return; // Intentionally opaque, including malformed/future sporting schemas.
  if (slot.category === "legacy_archive") { if (raw !== "complete") fail("source_unhealthy"); return; }
  const fixed = TRANSFER_IDENTITY_KEYS.indexOf(slot.key); const pending = fixed === 3;
  const unsupported: TransferCode = pending ? "sensitive_archive_unavailable" : "identity_archive_unsupported";
  let value: Json;
  try { value = parseTransferJsonForVersion(raw,budget,TRANSFER_LIMITS.identity,version); } catch (reason) { const issue = failure(reason); if (issue.code === "limit_exceeded") fail(issue.code); fail(unsupported); }
  if (version === 2 && (slot.domainContract === "identity-accountDeletionGuard-v1" || slot.domainContract === "identity-accountDeletionGuardResolution-v1")) {
    const guard = slot.domainContract === "identity-accountDeletionGuard-v1";
    const revisionField = guard ? "revision" : "fencedRevision";
    const obj = exact(value,["schemaVersion","profileId","nonce",revisionField],unsupported);
    const revision = obj[revisionField];
    if (obj.schemaVersion !== 1 || typeof obj.profileId !== "string" || obj.profileId.length !== 36 || !isCanonicalUuid(obj.profileId)
      || typeof obj.nonce !== "string" || obj.nonce.length !== 36 || !isCanonicalUuid(obj.nonce)
      || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0 || revision >= 2147483647
      || (guard ? obj.profileId !== deletionSelector(slot.key,deletionGuardPrefix) : obj.nonce !== deletionSelector(slot.key,deletionResolutionPrefix))) fail(unsupported);
    return obj;
  }
  const fields = fixed >= 0 ? identityFields[fixed] : ["schemaVersion","barrierId","attemptId","method","flowId","identityGeneration","authenticatedAccountScopeId","resolvedAt"];
  const obj = exact(value,fields,unsupported);
  for (const name of ["profileId","barrierId","attemptId",...(pending ? ["value"] : [])]) if (Object.hasOwn(obj,name) && (typeof obj[name] !== "string" || (obj[name] as string).length !== 36 || !isCanonicalUuid(obj[name]))) fail(unsupported);
  for (const name of ["generation","barredGeneration","capturedIdentityGeneration","identityGeneration"]) if (Object.hasOwn(obj,name) && obj[name] !== null && (typeof obj[name] !== "number" || !Number.isSafeInteger(obj[name]) || (obj[name] as number) < 0)) fail(unsupported);
  let valid = false;
  if (fixed === 0) valid = validateTrustedDeviceRecord(obj) !== null;
  else if (fixed === 1) valid = validateIdentityAccessBarrier(obj) !== null;
  else if (fixed === 2) valid = validateInteractiveAuthAttempt(obj) !== null;
  else if (fixed === 3) valid = obj.schemaVersion === 1 && obj.kind === "admin_request" && isCanonicalUuid(obj.value) && obj.survival === "ordinary" && isValidTimestamp(obj.capturedAt);
  else if (fixed === 4) valid = obj.schemaVersion === 1 && isValidTimestamp(obj.recordedAt);
  else valid = validateIdentityBarrierResolution(obj) !== null && typeof obj.barrierId === "string" && resolutionStorageKeyFor(obj.barrierId) === slot.key;
  if (!valid) fail(unsupported);
}

export function validateArchivedRaw(slot: Slot, raw: string, budget: WorkBudget): void {
  validateArchivedRawForVersion(slot,raw,budget,1);
}

// Fixed internal mechanics for the explicit V2 codec. No caller-supplied policy.
// Parsed denial records stay private to one bounded archive-validation call.
export const installationTransferV2Internals = /* @__PURE__ */ Object.freeze({
  parse(input: unknown, budget = workBudget(), maximum: number = TRANSFER_LIMITS.input): Json {
    return parseTransferJsonForVersion(input,budget,maximum,2);
  },
  slot(key: string): Slot | null { return transferSlotForVersion(key,2); },
  inventory(value: Json): ReadPlan { return inventoryFromListingForVersion(value,2); },
  validate(items: readonly {key: string; raw: string}[], budget: WorkBudget): void {
    const parsed = new Map<string,JsonObject>();
    for (const item of items) {
      const slot = transferSlotForVersion(item.key,2);
      if (!slot) fail("invalid_envelope");
      const value = validateArchivedRawForVersion(slot,item.raw,budget,2);
      if (value) parsed.set(item.key,value);
    }
    for (const [key,guard] of parsed) if (deletionSelector(key,deletionGuardPrefix)) {
      const receipt = parsed.get(`${deletionResolutionPrefix}${guard.nonce}.v1`);
      if (receipt && (receipt.profileId !== guard.profileId || receipt.nonce !== guard.nonce || (receipt.fencedRevision as number) <= (guard.revision as number))) fail("identity_archive_unsupported");
    }
  },
});
