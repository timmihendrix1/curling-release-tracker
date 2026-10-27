// Private negative-only projection. Structural metadata is never authentication.
import { decodeInstallationTransferV3 } from "./installationTransferV3";
import { capturePlatformSha256, serializePlatformStringTuple, settlePlatformSha256Preparation } from "./platformSha256";
import { decodeTransferCodeUnits, encodeTransferCodeUnits, isTransferCodeUnits } from "./installationTransferCodeUnits";
import type { RemovableStorageAdapter } from "./types";
import { isCanonicalUuid } from "../uuid";
import { createIdentityBarrierRepository } from "../identity/identityBarrierRepository";
import { createInteractiveAttemptRepository } from "../identity/interactiveAttemptRepository";
import { createIdentityBarrierResolutionRepository } from "../identity/identityBarrierResolutionRepository";
import { validateIdentityAccessBarrier, type IdentityAccessBarrier } from "../identity/identityBarrier";
import { readUntrustedOpaqueId, readIdentityRecord, isValidTimestamp } from "../identity/untrustedValue";
import { INTENT_CLEANUP_STORAGE_KEY, validateOutstandingIntentCleanup } from "../identity/pendingIntentRepository";
import { evaluateDurablePreflight } from "../identity/identityTransitionCoordinator";
import { createAccountDeletionGuardRepository, DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX, isAccountDeletionGuardStorageKey, validDeletionRevision } from "../identity/accountDeletionGuard";

export const MAX_SOURCE_DENIAL_JSON = 1048576;
export const MAX_SOURCE_DENIAL_ASCII = 4 + 4 * MAX_SOURCE_DENIAL_JSON;
type SourcePreflight = Readonly<{ kind: "no_barrier" } | { kind: "quarantined"; barrier: Readonly<IdentityAccessBarrier> }
  | { kind: "correlated"; barrier: Readonly<IdentityAccessBarrier>; authenticatedAccountScopeId: string }>;
type SourceGuard = Readonly<{ profileId: string; nonce: string; revision: number; fencedRevision: number | null }>;
type SourceIntentCleanup = Readonly<{ kind: "absent" } | { kind: "outstanding"; recordedAt: string }>;
export type SourceDenialFacts = Readonly<{ schemaVersion: 2; packageDigest: string; sportingProfiles: readonly string[]; preflight: SourcePreflight; guards: readonly SourceGuard[]; intentCleanup: SourceIntentCleanup }>;
// This type has no forgeable content. Only this module can mint its WeakMap entry.
export type SourceDenialHandle = Readonly<object>;
type Projection = Readonly<{ facts: SourceDenialFacts; ascii: string; digest: string; packageDigest: string }>;
const handles = new WeakMap<object, Projection>();
const digest = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const quote = (value: string) => serializePlatformStringTuple(value).slice(1, -1);
const nullable = (value: string | number | null) => value === null ? "null" : typeof value === "string" ? quote(value) : String(value);
function serialize(facts: SourceDenialFacts): string {
  const p = facts.preflight;
  const b = p.kind === "no_barrier" ? null : p.barrier;
  const barrier = b === null ? "" : ',"barrier":{"schemaVersion":1,"barrierId":' + quote(b.barrierId) + ',"origin":' + quote(b.origin)
    + ',"barredAccountScopeId":' + nullable(b.barredAccountScopeId) + ',"barredGeneration":' + nullable(b.barredGeneration) + ',"establishedAt":' + quote(b.establishedAt) + '}';
  return '{"schemaVersion":2,"packageDigest":' + quote(facts.packageDigest) + ',"sportingProfiles":[' + facts.sportingProfiles.map(quote).join(",")
    + '],"preflight":{"kind":' + quote(p.kind) + barrier + (p.kind === "correlated" ? ',"authenticatedAccountScopeId":' + quote(p.authenticatedAccountScopeId) : "")
    + '},"guards":[' + facts.guards.map(g => '{"profileId":' + quote(g.profileId) + ',"nonce":' + quote(g.nonce) + ',"revision":' + String(g.revision) + ',"fencedRevision":' + nullable(g.fencedRevision) + '}').join(",")
    + '],"intentCleanup":{"kind":' + quote(facts.intentCleanup.kind) + (facts.intentCleanup.kind === "outstanding" ? ',"recordedAt":' + quote(facts.intentCleanup.recordedAt) : "") + '}}';
}
function freeze(facts: SourceDenialFacts): SourceDenialFacts {
  Object.freeze(facts.sportingProfiles);
  if (facts.preflight.kind !== "no_barrier") Object.freeze(facts.preflight.barrier);
  Object.freeze(facts.preflight);
  facts.guards.forEach(Object.freeze); Object.freeze(facts.guards);
  Object.freeze(facts.intentCleanup);
  return Object.freeze(facts);
}
function closed(value: unknown, keys: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}
const sorted = (values: readonly string[]) => values.every((v, i) => i === 0 || values[i - 1] < v);
/** Bounded cold structural check only. Does NOT mint a handle or verify origin. */
export function parseTransferSourceDenial(ascii: unknown, packageDigest: unknown): SourceDenialFacts | null {
  if (!digest(packageDigest) || typeof ascii !== "string" || ascii.length > MAX_SOURCE_DENIAL_ASCII || !isTransferCodeUnits(ascii)) return null;
  try {
    const json = decodeTransferCodeUnits(ascii);
    if (json.length > MAX_SOURCE_DENIAL_JSON) return null;
    const raw: unknown = JSON.parse(json);
    if (!closed(raw, ["schemaVersion", "packageDigest", "sportingProfiles", "preflight", "guards", "intentCleanup"]) || raw.schemaVersion !== 2 || raw.packageDigest !== packageDigest
      || !Array.isArray(raw.sportingProfiles) || raw.sportingProfiles.length > 32 || !raw.sportingProfiles.every(isCanonicalUuid) || !sorted(raw.sportingProfiles)
      || !Array.isArray(raw.guards) || raw.guards.length > 512) return null;
    const p = raw.preflight;
    let preflight: SourcePreflight;
    if (closed(p, ["kind"]) && p.kind === "no_barrier") preflight = { kind: "no_barrier" };
    else {
      if (!closed(p, p && typeof p === "object" && "kind" in p && p.kind === "correlated" ? ["kind", "barrier", "authenticatedAccountScopeId"] : ["kind", "barrier"])) return null;
      if (p.kind !== "quarantined" && p.kind !== "correlated") return null;
      if (!closed(p.barrier, ["schemaVersion", "barrierId", "origin", "barredAccountScopeId", "barredGeneration", "establishedAt"])) return null;
      const barrier = validateIdentityAccessBarrier(p.barrier);
      if (!barrier) return null;
      if (p.kind === "correlated") {
        const scope = readUntrustedOpaqueId(p, "authenticatedAccountScopeId", 256);
        if (scope === null) return null;
        preflight = { kind: "correlated", barrier, authenticatedAccountScopeId: scope };
      } else preflight = { kind: "quarantined", barrier };
    }
    const guards: SourceGuard[] = [];
    for (const g of raw.guards) {
      if (!closed(g, ["profileId", "nonce", "revision", "fencedRevision"]) || !isCanonicalUuid(g.profileId) || !isCanonicalUuid(g.nonce) || !validDeletionRevision(g.revision)
        || (g.fencedRevision !== null && (!validDeletionRevision(g.fencedRevision) || g.fencedRevision <= g.revision))) return null;
      guards.push({ profileId: g.profileId, nonce: g.nonce, revision: g.revision, fencedRevision: g.fencedRevision });
    }
    if (!sorted(guards.map(g => g.profileId))) return null;
    const c = raw.intentCleanup;
    let intentCleanup: SourceIntentCleanup;
    if (closed(c, ["kind"]) && c.kind === "absent") intentCleanup = { kind: "absent" };
    else if (closed(c, ["kind", "recordedAt"]) && c.kind === "outstanding" && isValidTimestamp(c.recordedAt)) intentCleanup = { kind: "outstanding", recordedAt: c.recordedAt };
    else return null;
    const facts: SourceDenialFacts = { schemaVersion: 2, packageDigest, sportingProfiles: raw.sportingProfiles, preflight, guards, intentCleanup };
    if (serialize(facts) !== json) return null;
    return freeze(facts);
  } catch { return null; }
}
/** Identity lookup only; equal objects, wrappers and proxies have no entry. */
export function resolveTransferSourceDenial(handle: unknown): Projection | null {
  return handle !== null && (typeof handle === "object" || typeof handle === "function") ? handles.get(handle) ?? null : null;
}
/** Only the separate actual admission calls this with the opened V3 primitive. */
export async function evaluateTransferSourceDenial(wire: unknown, packageDigest: unknown, current: () => boolean): Promise<SourceDenialHandle | null> {
  if (typeof wire !== "string" || !digest(packageDigest)) return null;
  try {
    if (!current()) return null;
    const decoded = await decodeInstallationTransferV3(wire);
    if (!current() || !decoded.ok || decoded.value.envelope.packageDigest !== packageDigest) return null;
    // The authenticated complete V3 inventory, not a caller map, supplies absence.
    const inventory = new Map<string, string>();
    const guardProfiles: string[] = [];
    for (const item of decoded.value.envelope.items as Record<string, unknown>[]) {
      if (item.category !== "identity_archive" || item.presence !== "present") continue;
      const key = item.key as string;
      inventory.set(key, item.raw as string);
      if (isAccountDeletionGuardStorageKey(key)) guardProfiles.push(key.slice(DELETION_GUARD_PREFIX.length, -3));
    }
    let mutationAttempted = false;
    const adapter: RemovableStorageAdapter = Object.freeze({
      async get(key: string) { if (!current()) return { status: "read_failed" as const, fallback: null, error: { kind: "storage_unavailable" as const } }; return { status: "value" as const, value: inventory.get(key) ?? null }; },
      async set() { mutationAttempted = true; return { ok: false as const, error: { kind: "storage_unavailable" as const } }; },
      async remove() { mutationAttempted = true; return { ok: false as const, error: { kind: "storage_unavailable" as const } }; },
    });
    const barrier = await createIdentityBarrierRepository(adapter).load();
    if (!current() || (barrier.status !== "value" && barrier.status !== "absent")) return null;
    let preflight: SourcePreflight;
    if (barrier.status === "absent") {
      const result = evaluateDurablePreflight({ barrier, attempt: { status: "absent" }, resolution: null });
      if (result.kind !== "no_barrier") return null;
      preflight = { kind: "no_barrier" };
    } else {
      const attempt = await createInteractiveAttemptRepository(adapter).load();
      if (!current() || (attempt.status !== "absent" && attempt.status !== "value")) return null;
      const resolution = await createIdentityBarrierResolutionRepository(adapter).loadForBarrier(barrier.value.barrierId);
      if (!current() || (resolution.status !== "absent" && resolution.status !== "value")) return null;
      const result = evaluateDurablePreflight({ barrier, attempt, resolution });
      preflight = result.kind === "correlated" ? { kind: "correlated", barrier: result.barrier, authenticatedAccountScopeId: result.resolution.authenticatedAccountScopeId }
        : { kind: "quarantined", barrier: barrier.value };
    }
    const repo = createAccountDeletionGuardRepository(adapter), guards: SourceGuard[] = [];
    for (const profileId of guardProfiles.sort()) {
      const loaded = await repo.load(profileId);
      if (!current() || loaded.status !== "guard") return null;
      let fencedRevision: number | null = null;
      if (loaded.resolved) {
        // Extract only AFTER the actual repository has validated the same nonce slot
        // and re-read the same guard. The map is never changed or exposed.
        const raw = inventory.get(DELETION_GUARD_RESOLUTION_PREFIX + loaded.guard.nonce + ".v1");
        if (raw === undefined) return null;
        const receipt = JSON.parse(raw);
        fencedRevision = receipt.fencedRevision;
        if (!validDeletionRevision(fencedRevision) || fencedRevision <= loaded.guard.revision) return null;
      }
      guards.push({ profileId, nonce: loaded.guard.nonce, revision: loaded.guard.revision, fencedRevision });
    }
    const cleanup = await readIdentityRecord(adapter, INTENT_CLEANUP_STORAGE_KEY, validateOutstandingIntentCleanup);
    if (!current() || mutationAttempted || (cleanup.status !== "absent" && cleanup.status !== "value")) return null;
    const intentCleanup: SourceIntentCleanup = cleanup.status === "absent" ? { kind: "absent" } : { kind: "outstanding", recordedAt: cleanup.value.recordedAt };
    const facts = freeze({ schemaVersion: 2, packageDigest, sportingProfiles: [...decoded.value.envelope.profiles as string[]], preflight, guards, intentCleanup });
    const json = serialize(facts);
    if (json.length > MAX_SOURCE_DENIAL_JSON) return null;
    const ascii = encodeTransferCodeUnits(json);
    const captured = capturePlatformSha256();
    if (!captured.ok) { await settlePlatformSha256Preparation(captured); return null; }
    if (!current()) return null;
    const fingerprint = await captured.value.hash(serializePlatformStringTuple("installation-source-denial/v2", packageDigest, ascii));
    if (!current() || mutationAttempted || !digest(fingerprint)) return null;
    const handle = Object.freeze(Object.create(null));
    handles.set(handle, Object.freeze({ facts, ascii, digest: fingerprint, packageDigest }));
    return handle;
  } catch { return null; }
}
