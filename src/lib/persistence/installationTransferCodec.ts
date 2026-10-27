// Pure explicit profiles. V1/V2 stay injected; only the private V3 wrapper binds SHA.
import { array, checkedAdd, checkedMultiply, exact, expectedSlots, fail, failure, freezeTree, inventoryFromListing, installationTransferV2Internals, label, parseTransferJson, record, sortedUnique, text, transferSlot, TRANSFER_IDENTITY_KEYS, TRANSFER_LIMITS, uint, unitOrder, uuid, validateArchivedRaw, workBudget, type Json, type JsonObject, type TransferResult, type WorkBudget } from "./installationTransferInventory";

export type ValidatedPackage = { readonly envelope: Readonly<JsonObject>; readonly semanticStatus: "not_evaluated" };
const DIGEST_PLACEHOLDER = "0".repeat(64);
const rootFields = ["format","formatVersion","fingerprintContract","transferId","snapshotId","sourceBundleId","intendedDestination","sourceBuild","provenance","profiles","dynamicIdentity","items","counts","exclusions","completeness","credentialPolicy","packageDigest"];
const baseItemFields = ["key","category","profileId","domainContract","presence"];
const presentItemFields = [...baseItemFields,"raw","codeUnits","valueDigest"];
const policies = Object.freeze({providerCredentials:"never-read",protectedCredentialControls:"never-read",retiredUnscoped:"never-read-never-adopt",publicCaches:"reconstructible-not-copied",bundleCatalogs:"references-only-not-copied",exportCache:"not-a-backup",foreignKeys:"untouched"});
type CodecProfile = {
  readonly version: 1 | 2 | 3;
  readonly fingerprintContract: string;
  readonly inventoryContract: string;
  readonly parse: typeof parseTransferJson;
  readonly slot: typeof transferSlot;
  readonly inventory: typeof inventoryFromListing;
  readonly validate: (items: readonly {key: string; raw: string}[], budget: WorkBudget) => void;
};
const v1: CodecProfile = Object.freeze({
  version:1, fingerprintContract:"injected-256-v1", inventoryContract:"profile13-identity5-resolution-legacy-v1",
  parse:parseTransferJson, slot:transferSlot, inventory:inventoryFromListing,
  validate(items: readonly {key: string; raw: string}[], budget: WorkBudget): void {
    for (const item of items) validateArchivedRaw(transferSlot(item.key)!,item.raw,budget);
  },
});
const v2: CodecProfile = Object.freeze({
  version:2, fingerprintContract:"injected-256-v2", inventoryContract:"profile13-identity5-resolution-deletion-legacy-v2",
  parse:installationTransferV2Internals.parse, slot:installationTransferV2Internals.slot,
  inventory:installationTransferV2Internals.inventory, validate:installationTransferV2Internals.validate,
});
const v3: CodecProfile = Object.freeze({ ...v2, version:3, fingerprintContract:"sha256-transfer-bytes-v1" });
function validateRaws(o: JsonObject, budget: WorkBudget, profile: CodecProfile): void {
  profile.validate((o.items as JsonObject[]).filter(item => item.presence === "present").map(item => ({key:item.key as string,raw:item.raw as string})),budget);
}
const completeness = "complete-stored-inventory-with-declared-exclusions";
const credentialPolicy = "fresh-reauth-no-provider-values-verifiers-or-credential-hashes";
function digest(value: Json): string { if (typeof value !== "string" || value.length !== 64 || !/^[0-9a-f]{64}$/.test(value)) fail("invalid_envelope"); return value; }
function sourceBuild(value: Json): JsonObject { const o = exact(value,["version","build"]); label(o.version); label(o.build); return o; }
function ids(o: JsonObject): void { uuid(o.transferId); uuid(o.snapshotId); if (o.transferId === o.snapshotId) fail("invalid_envelope"); }
function counts(items: JsonObject[], profileCount: number, dynamicCount: number): JsonObject {
  let present = 0; let raw = 0;
  for (const item of items) if (item.presence === "present") { present++; raw = checkedAdd(raw,(item.raw as string).length,TRANSFER_LIMITS.raw); }
  return {slots:items.length,present,absent:items.length-present,profiles:profileCount,dynamicIdentity:dynamicCount,rawCodeUnits:raw};
}
function fromSnapshot(value: Json, budget: WorkBudget, profile: CodecProfile): JsonObject {
  const o = exact(value,["schemaVersion","transferId","snapshotId","sourceBuild","catalogContractId","listing","observations","sourceControl","snapshotState"]);
  if (o.schemaVersion !== profile.version) fail("invalid_envelope"); ids(o); sourceBuild(o.sourceBuild); label(o.catalogContractId);
  const control = exact(o.sourceControl,["domain","credential"]);
  if (control.credential !== "excluded" || !["absent","healthy","fault","unreadable","unsupported"].includes(control.domain as string) || !["synthetic_frozen","owner_frozen","unavailable"].includes(o.snapshotState as string)) fail("invalid_envelope");
  const observations = array(o.observations,TRANSFER_LIMITS.items).map(v => { const r = record(v); exact(r,r.state === "present" ? ["key","state","raw"] : ["key","state"]); text(r.key,TRANSFER_LIMITS.key); if (!["present","absent","unobserved","unreadable"].includes(r.state as string)) fail("invalid_envelope"); if (r.state === "present") text(r.raw,TRANSFER_LIMITS.sporting); return r; });
  const plan = profile.inventory(o.listing);
  if (o.snapshotState === "unavailable" || !["absent","healthy"].includes(control.domain as string) || (plan.controlHealthKeys.length > 0 && control.domain !== "healthy")) fail("source_unhealthy");
  const slots = expectedSlots(plan.profiles,plan.dynamicIdentity); const listed = new Set(plan.rawReads);
  sortedUnique(observations.map(item => item.key as string),"incomplete_inventory");
  if (observations.length !== slots.length || observations.some((item,i) => item.key !== slots[i])) fail("incomplete_inventory");
  const items: JsonObject[] = observations.map(item => {
    if (item.state === "unobserved" || item.state === "unreadable") fail("source_unobserved");
    if ((item.state === "present") !== listed.has(item.key as string)) fail("incomplete_inventory");
    const slot = profile.slot(item.key as string)!;
    return item.state === "present" ? {...slot,presence:"present",raw:item.raw,codeUnits:(item.raw as string).length,valueDigest:DIGEST_PLACEHOLDER} : {...slot,presence:"absent"};
  });
  const c = counts(items,plan.profiles.length,plan.dynamicIdentity.length);
  validateRaws({items},budget,profile);
  return {format:"curling-installation-transfer",formatVersion:profile.version,fingerprintContract:profile.fingerprintContract,transferId:o.transferId,snapshotId:o.snapshotId,sourceBundleId:"local.dev.curlingperformance",intendedDestination:"me.evolane.curling",sourceBuild:o.sourceBuild,provenance:{inventoryContract:profile.inventoryContract,schemaInterpretation:"opaque-preserved",catalogContractId:o.catalogContractId,domainControl:control.domain,credentialControl:"excluded-not-copied",authority:"snapshot-only"},profiles:[...plan.profiles],dynamicIdentity:{enumeration:"complete",keys:[...plan.dynamicIdentity]},items,counts:c,exclusions:{...policies},completeness,credentialPolicy,packageDigest:DIGEST_PLACEHOLDER};
}
function validateEnvelope(value: Json, budget: WorkBudget, profile: CodecProfile): JsonObject {
  const o = exact(value,rootFields);
  uint(o.formatVersion,Number.MAX_SAFE_INTEGER);
  if (o.formatVersion !== profile.version) fail("unsupported_format");
  if (o.format !== "curling-installation-transfer" || o.fingerprintContract !== profile.fingerprintContract || o.sourceBundleId !== "local.dev.curlingperformance" || o.intendedDestination !== "me.evolane.curling" || o.completeness !== completeness || o.credentialPolicy !== credentialPolicy) fail("invalid_envelope");
  ids(o); sourceBuild(o.sourceBuild); digest(o.packageDigest);
  const provenance = exact(o.provenance,["inventoryContract","schemaInterpretation","catalogContractId","domainControl","credentialControl","authority"]);
  if (provenance.inventoryContract !== profile.inventoryContract || provenance.schemaInterpretation !== "opaque-preserved" || provenance.credentialControl !== "excluded-not-copied" || provenance.authority !== "snapshot-only" || !["absent","healthy"].includes(provenance.domainControl as string)) fail("invalid_envelope"); label(provenance.catalogContractId);
  const excluded = exact(o.exclusions,Object.keys(policies)); for (const [key,v] of Object.entries(policies)) if (excluded[key] !== v) fail("invalid_envelope");
  const profiles = array(o.profiles,TRANSFER_LIMITS.profiles).map(uuid); sortedUnique(profiles,"incomplete_inventory");
  const dynamic = exact(o.dynamicIdentity,["enumeration","keys"]); if (dynamic.enumeration !== "complete") fail("invalid_envelope");
  const dynamicKeys = array(dynamic.keys,TRANSFER_LIMITS.dynamic).map(k => text(k,TRANSFER_LIMITS.key)); sortedUnique(dynamicKeys,"incomplete_inventory");
  if (dynamicKeys.some(k => profile.slot(k)?.category !== "identity_archive" || TRANSFER_IDENTITY_KEYS.includes(k))) fail("invalid_envelope");
  const items = array(o.items,TRANSFER_LIMITS.items).map(v => {
    const item = record(v); exact(item,item.presence === "present" ? presentItemFields : baseItemFields);
    const key = text(item.key,TRANSFER_LIMITS.key); const slot = profile.slot(key);
    if (!slot || slot.category !== item.category || slot.profileId !== item.profileId || slot.domainContract !== item.domainContract || !["present","absent"].includes(item.presence as string)) fail("invalid_envelope");
    if (item.presence === "present") { const raw = text(item.raw,TRANSFER_LIMITS.sporting); if (uint(item.codeUnits,TRANSFER_LIMITS.sporting) !== raw.length) fail("invalid_envelope"); digest(item.valueDigest); }
    return item;
  });
  const c = exact(o.counts,["slots","present","absent","profiles","dynamicIdentity","rawCodeUnits"]);
  for (const name of ["slots","present","absent"]) uint(c[name],TRANSFER_LIMITS.items);
  uint(c.profiles,TRANSFER_LIMITS.profiles); uint(c.dynamicIdentity,TRANSFER_LIMITS.dynamic); uint(c.rawCodeUnits,TRANSFER_LIMITS.raw);
  sortedUnique(items.map(item => item.key as string),"incomplete_inventory");
  const slots = expectedSlots(profiles,dynamicKeys);
  if (slots.length !== items.length || items.some((item,i) => item.key !== slots[i])) fail("incomplete_inventory");
  const presentProfiles = [...new Set(items.filter(i => i.presence === "present" && i.category === "sporting").map(i => i.profileId as string))].sort(unitOrder);
  if (presentProfiles.length !== profiles.length || presentProfiles.some((id,i) => id !== profiles[i]) || items.some(i => dynamicKeys.includes(i.key as string) && i.presence !== "present")) fail("incomplete_inventory");
  const actual = counts(items,profiles.length,dynamicKeys.length);
  if (Object.keys(actual).some(key => actual[key] !== c[key])) fail("invalid_envelope");
  validateRaws({items},budget,profile);
  return o;
}

// All walkers below receive ONLY bounded owned trees, never public objects.
// Depth is already <=16. Every byte/unit size is checked before allocation.
function typedSize(value: Json, omitRootDigest = false): number {
  if (value === null || typeof value === "boolean") return 1;
  if (typeof value === "number") { uint(value,Number.MAX_SAFE_INTEGER); return 9; }
  if (typeof value === "string") return checkedAdd(9,checkedMultiply(value.length,2,TRANSFER_LIMITS.preimage),TRANSFER_LIMITS.preimage);
  let size = 9;
  if (Array.isArray(value)) { for (const child of value) size = checkedAdd(size,typedSize(child),TRANSFER_LIMITS.preimage); }
  else for (const key of Object.keys(value).sort(unitOrder)) { if (omitRootDigest && key === "packageDigest") continue; size = checkedAdd(size,checkedAdd(8,checkedMultiply(key.length,2,TRANSFER_LIMITS.preimage),TRANSFER_LIMITS.preimage),TRANSFER_LIMITS.preimage); size = checkedAdd(size,typedSize(value[key]),TRANSFER_LIMITS.preimage); }
  return size;
}
function preimageSize(value: Json, purpose: string, omitRootDigest: boolean): number { return checkedAdd(purpose.length + 1,typedSize(value,omitRootDigest),TRANSFER_LIMITS.preimage); }
function preimage(value: Json, purpose: string, omitRootDigest: boolean): Uint8Array {
  const bytes = new Uint8Array(preimageSize(value,purpose,omitRootDigest)); const view = new DataView(bytes.buffer); let p = 0;
  const u = (n: number) => { uint(n,Number.MAX_SAFE_INTEGER); const high = Math.floor(n / 4294967296); const low = n - high * 4294967296; view.setUint32(p,high,false); view.setUint32(p+4,low,false); p += 8; };
  const s = (v: string) => { u(v.length); for (let i = 0; i < v.length; i++) { view.setUint16(p,v.charCodeAt(i),false); p += 2; } };
  const t = (v: Json, omit = false): void => {
    if (v === null) { bytes[p++] = 0; return; }
    if (typeof v === "boolean") { bytes[p++] = v ? 2 : 1; return; }
    if (typeof v === "number") { bytes[p++] = 3; u(v); return; }
    if (typeof v === "string") { bytes[p++] = 4; s(v); return; }
    bytes[p++] = Array.isArray(v) ? 5 : 6;
    if (Array.isArray(v)) { u(v.length); for (const child of v) t(child); }
    else { const keys = Object.keys(v).filter(k => !omit || k !== "packageDigest").sort(unitOrder); u(keys.length); for (const key of keys) { s(key); t(v[key]); } }
  };
  for (let i = 0; i < purpose.length; i++) bytes[p++] = purpose.charCodeAt(i); bytes[p++] = 0; t(value,omitRootDigest); return bytes;
}
function canonicalSize(value: Json): number {
  if (typeof value === "string") return checkedAdd(2,checkedMultiply(value.length,6,TRANSFER_LIMITS.wire),TRANSFER_LIMITS.wire);
  if (value === null) return 4;
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") { uint(value,Number.MAX_SAFE_INTEGER); return String(value).length; }
  let size = 2; const entries = Array.isArray(value) ? value : Object.keys(value).sort(unitOrder);
  for (let i = 0; i < entries.length; i++) {
    if (i) size = checkedAdd(size,1,TRANSFER_LIMITS.wire);
    if (Array.isArray(value)) size = checkedAdd(size,canonicalSize(value[i]),TRANSFER_LIMITS.wire);
    else { const k = entries[i] as string; size = checkedAdd(size,checkedAdd(canonicalSize(k),1,TRANSFER_LIMITS.wire),TRANSFER_LIMITS.wire); size = checkedAdd(size,canonicalSize(value[k]),TRANSFER_LIMITS.wire); }
  }
  return size;
}
function emitCanonical(value: Json, emit: (part: string) => void): void {
  if (typeof value === "string") { emit('"'); for (let i = 0; i < value.length; i++) emit("\\u" + value.charCodeAt(i).toString(16).padStart(4,"0")); emit('"'); return; }
  if (value === null || typeof value !== "object") { emit(String(value)); return; }
  const list = Array.isArray(value); emit(list ? "[" : "{"); const keys = list ? value.map((_,i) => String(i)) : Object.keys(value).sort(unitOrder);
  keys.forEach((key,i) => { if (i) emit(","); if (!list) { emitCanonical(key,emit); emit(":"); } emitCanonical(list ? value[Number(key)] : (value as JsonObject)[key],emit); }); emit(list ? "]" : "}");
}
function canonicalWire(value: Json): string {
  canonicalSize(value); const chunks: string[] = []; let chunk = "";
  emitCanonical(value, part => { chunk += part; if (chunk.length >= 8192) { chunks.push(chunk); chunk = ""; } }); chunks.push(chunk); return chunks.join("");
}
function canonicalEquals(value: Json, wire: string): boolean { let p = 0; let same = true; emitCanonical(value, part => { if (!wire.startsWith(part,p)) same = false; p += part.length; }); return same && p === wire.length; }
const nativeThen = Promise.prototype.then;
async function fingerprintValue(provider: (bytes: Uint8Array) => unknown, value: Json, purpose: string, omit = false): Promise<string> {
  let computed: unknown;
  try {
    const returned = provider(preimage(value,purpose,omit));
    // Observe conforming native Promises even when an own `then` is masked.
    // Intrinsic failure is not a non-native brand test; assimilation is best effort.
    // C4 defines return/derived-Promise ownership, not hostile-return rescue.
    if ((typeof returned === "object" && returned !== null) || typeof returned === "function") {
      computed = await new Promise<unknown>((resolve,reject) => {
        try { void nativeThen.call(returned,resolve,reject); } catch { resolve(returned); }
      });
    } else computed = returned;
  } catch { fail("fingerprint_failed"); }
  if (typeof computed !== "string" || computed.length !== 64 || !/^[0-9a-f]{64}$/.test(computed)) fail("fingerprint_invalid");
  return computed;
}
function preflight(o: JsonObject, identityWork: WorkBudget, profile: CodecProfile): void {
  // A source listing is smaller than the generated envelope. Admit the exact
  // OUTPUT tree and its repeated identity decoding as well: otherwise an
  // encoder could produce a wire its own decoder must refuse.
  const outputWork = {...identityWork};
  const count = (value: Json): void => {
    if (typeof value === "string") outputWork.decoded = checkedAdd(outputWork.decoded,value.length,TRANSFER_LIMITS.decoded);
    else if (value !== null && typeof value === "object") {
      if (Array.isArray(value)) {
        outputWork.edges = checkedAdd(outputWork.edges,value.length,TRANSFER_LIMITS.edges);
        for (const child of value) count(child);
      } else {
        const keys = Object.keys(value);
        outputWork.edges = checkedAdd(outputWork.edges,keys.length,TRANSFER_LIMITS.edges);
        for (const key of keys) { count(key); count(value[key]); }
      }
    }
  };
  count(o);
  canonicalSize(o); // Placeholder and actual digests have identical escaped sizes.
  for (const item of o.items as JsonObject[]) if (item.presence === "present") preimageSize(item.raw,`curling-transfer-value/v${profile.version}`,false);
  preimageSize(o,`curling-transfer-package/v${profile.version}`,true);
}
async function fingerprints(o: JsonObject, provider: unknown, verify: boolean, profile: CodecProfile, identityWork: WorkBudget = workBudget()): Promise<void> {
  preflight(o,identityWork,profile); if (typeof provider !== "function") fail("fingerprint_unavailable");
  for (const item of o.items as JsonObject[]) if (item.presence === "present") {
    const computed = await fingerprintValue(provider as (bytes: Uint8Array) => unknown,item.raw,`curling-transfer-value/v${profile.version}`);
    if (verify && computed !== item.valueDigest) fail("digest_mismatch");
    if (!verify) item.valueDigest = computed;
  }
  const computed = await fingerprintValue(provider as (bytes: Uint8Array) => unknown,o,`curling-transfer-package/v${profile.version}`,true);
  if (verify && computed !== o.packageDigest) fail("digest_mismatch"); if (!verify) o.packageDigest = computed;
}
async function encode(snapshotJson: unknown, fingerprint: unknown, profile: CodecProfile): Promise<TransferResult<{wire: string; packageDigest: string}>> {
  try {
    const budget = workBudget();
    const input = profile.parse(snapshotJson,budget);
    const beforeIdentity = {...budget};
    const o = fromSnapshot(input,budget,profile);
    const identityWork = {decoded:budget.decoded-beforeIdentity.decoded,edges:budget.edges-beforeIdentity.edges};
    await fingerprints(o,fingerprint,false,profile,identityWork);
    return {ok:true,value:Object.freeze({wire:canonicalWire(o),packageDigest:o.packageDigest as string})};
  } catch (reason) { return failure(reason); }
}
async function decode(wire: unknown, fingerprint: unknown, profile: CodecProfile): Promise<TransferResult<ValidatedPackage>> {
  try { const budget = workBudget(); const o = validateEnvelope(profile.parse(wire,budget),budget,profile); await fingerprints(o,fingerprint,true,profile); if (!canonicalEquals(o,wire as string)) fail("noncanonical_wire"); return {ok:true,value:freezeTree({envelope:o,semanticStatus:"not_evaluated" as const})}; } catch (reason) { return failure(reason); }
}
export function encodeInstallationTransfer(snapshotJson: unknown, fingerprint: unknown): Promise<TransferResult<{wire: string; packageDigest: string}>> {
  return encode(snapshotJson,fingerprint,v1);
}
export function decodeInstallationTransfer(wire: unknown, fingerprint: unknown): Promise<TransferResult<ValidatedPackage>> {
  return decode(wire,fingerprint,v1);
}
export function encodeInstallationTransferV2(snapshotJson: unknown, fingerprint: unknown): Promise<TransferResult<{wire: string; packageDigest: string}>> {
  return encode(snapshotJson,fingerprint,v2);
}
export function decodeInstallationTransferV2(wire: unknown, fingerprint: unknown): Promise<TransferResult<ValidatedPackage>> {
  return decode(wire,fingerprint,v2);
}

// The exact wrapper importer is guarded; this is not an operational public API.
export const installationTransferV3Internals = Object.freeze({
  encode(snapshotJson: unknown, fingerprint: (bytes: Uint8Array) => Promise<string>) { return encode(snapshotJson,fingerprint,v3); },
  decode(wire: unknown, fingerprint: (bytes: Uint8Array) => Promise<string>) { return decode(wire,fingerprint,v3); },
});
