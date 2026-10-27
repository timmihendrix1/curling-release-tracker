// Private publication intent. A protected intent is never an auth/publication grant.
import { credentialManifestSlot } from "./credentialPhysicalSlots";
import type { Q } from "./credentialProtocol";
import { isCanonicalUuid } from "../uuid";
import { validDeletionRevision } from "../identity/accountDeletionGuard";
import { readUntrustedOpaqueId } from "../identity/untrustedValue";
import { ROOT_PATTERN } from "../supabase/providerCredentialContract";
import { encodeTransferCodeUnits, decodeTransferCodeUnits, isTransferCodeUnits } from "./installationTransferCodeUnits";
import { captureOwnedPlatformSha256, serializePlatformStringTuple, settlePlatformSha256Preparation } from "./platformSha256";

// Conservative full admitted JSON bound: 2000 fixed syntax/constants + five
// quoted IDs(190) + four digests(264) + config(70) + root(79) + maximally
// escaped scope(1538) + 32 Profiles(1249) + selected ID(38) + C(10) = 5438.
export const MAX_PUBLICATION_JSON = 8192;
export const MAX_PUBLICATION_ASCII = 4 + 4 * MAX_PUBLICATION_JSON;
const fields = /* @__PURE__ */ Object.freeze(["schemaVersion", "protocol", "publicationId", "providerConfigIdentity", "sessionStorageKey", "sdkContractVersion", "protocolId", "credentialEpochId", "manifestId", "storeIdentity", "packageDigest", "sourceDenialDigest", "protectedWireDigest", "preparedDigest", "profiles", "selectedProfileId", "accountScopeId", "controlRevision", "workingLayout"] as const);
export type PublicationAnchor = Readonly<{
  schemaVersion: 1; protocol: "curling-installation-publication-v1"; publicationId: string;
  providerConfigIdentity: string; sessionStorageKey: string; sdkContractVersion: "auth-js/2.112.3:credential-v1";
  protocolId: string; credentialEpochId: string; manifestId: string; storeIdentity: string;
  packageDigest: string; sourceDenialDigest: string; protectedWireDigest: string; preparedDigest: string;
  profiles: readonly string[]; selectedProfileId: string; accountScopeId: string; controlRevision: number;
  workingLayout: "installation-live-ascii-v1";
}>;
const digest = (v: unknown): v is string => typeof v === "string" && v.length === 64 && /^[0-9a-f]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && v.length === 36 && isCanonicalUuid(v);
const quote = (value: string) => serializePlatformStringTuple(value).slice(1, -1);
function checked(input: unknown): PublicationAnchor | null {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null;
    const keys = Reflect.ownKeys(input); if (keys.length !== fields.length || fields.some(f => !keys.includes(f))) return null;
    const values = Object.create(null) as Record<string, unknown>;
    for (const field of fields) { const d = Object.getOwnPropertyDescriptor(input, field); if (!d || !("value" in d)) return null; values[field] = d.value; }
    if (values.schemaVersion !== 1 || values.protocol !== "curling-installation-publication-v1" || values.sdkContractVersion !== "auth-js/2.112.3:credential-v1" || values.workingLayout !== "installation-live-ascii-v1") return null;
    if (typeof values.providerConfigIdentity !== "string" || !credentialManifestSlot(values.providerConfigIdentity).ok || typeof values.sessionStorageKey !== "string" || ROOT_PATTERN.exec(values.sessionStorageKey)?.[0] !== values.sessionStorageKey) return null;
    const ids = [values.publicationId, values.protocolId, values.credentialEpochId, values.manifestId, values.storeIdentity];
    if (!ids.every(uuid) || new Set(ids).size !== 5) return null;
    if (![values.packageDigest, values.sourceDenialDigest, values.protectedWireDigest, values.preparedDigest].every(digest) || !uuid(values.selectedProfileId)) return null;
    if (!validDeletionRevision(values.controlRevision) || Object.is(values.controlRevision, -0) || readUntrustedOpaqueId(values, "accountScopeId", 256) === null) return null;
    const list = values.profiles;
    if (!Array.isArray(list)) return null;
    const length = Object.getOwnPropertyDescriptor(list, "length")?.value;
    if (!Number.isInteger(length) || length < 1 || length > 32 || Reflect.ownKeys(list).length !== length + 1) return null;
    const profiles: string[] = [];
    for (let i = 0; i < length; i++) { const d = Object.getOwnPropertyDescriptor(list, String(i)); if (!d || !("value" in d) || !uuid(d.value) || i > 0 && profiles[i - 1] >= d.value) return null; profiles.push(d.value); }
    if (!profiles.includes(values.selectedProfileId)) return null;
    values.profiles = Object.freeze(profiles);
    return Object.freeze(values) as PublicationAnchor;
  } catch { return null; }
}
function json(anchor: PublicationAnchor): string {
  return "{" + fields.map(field => quote(field) + ":" + (field === "profiles" ? "[" + anchor.profiles.map(quote).join(",") + "]" : typeof anchor[field] === "number" ? String(anchor[field]) : quote(anchor[field] as string))).join(",") + "}";
}
export function serializePublicationAnchor(input: unknown): string | null {
  const anchor = checked(input); if (!anchor) return null;
  const value = json(anchor); return value.length <= MAX_PUBLICATION_JSON ? encodeTransferCodeUnits(value) : null;
}
export function parsePublicationAnchor(raw: unknown): PublicationAnchor | null {
  if (typeof raw !== "string" || raw.length > MAX_PUBLICATION_ASCII || !isTransferCodeUnits(raw)) return null;
  try { const text = decodeTransferCodeUnits(raw); if (text.length > MAX_PUBLICATION_JSON) return null; const anchor = checked(JSON.parse(text)); return anchor && json(anchor) === text ? anchor : null; } catch { return null; }
}
export function publicationAnchorSlot(config: unknown): string | null {
  const slot = credentialManifestSlot(config); return slot.ok ? "t1." + slot.value.slice(3) : null;
}
export function publicationAnchorMatchesPair(anchor: PublicationAnchor, q: Q): boolean {
  return q.phase === "bound" && anchor.providerConfigIdentity === q.providerConfigIdentity && anchor.sessionStorageKey === q.sessionStorageKey && anchor.sdkContractVersion === q.sdkContractVersion && anchor.protocolId === q.protocolId && anchor.credentialEpochId === q.credentialEpochId && anchor.manifestId === q.manifestId && anchor.storeIdentity === q.storeIdentity;
}
type ObservedQ = Readonly<Omit<Q, "initialEntryKeys" | "verifiedItemIds"> & { initialEntryKeys: readonly string[]; verifiedItemIds: readonly string[] }>;
type AnchorObservation = Readonly<{ occurrence: number; latestOccurrence(): number; raw: string | null; anchor: PublicationAnchor | null; q: ObservedQ; manifest: string; current(): boolean }>;
const observations = new WeakMap<object, AnchorObservation>();
// Provenance ordering only: no clock, storage observation or admission authority.
let observationOccurrence = 0;
const latestOccurrence = () => observationOccurrence;
/** Sole production producer: actual private protected port after positive M/t1 reads. */
export function recordPublicationAnchorObservation(raw: string | null, q: Q, manifest: string, current: () => boolean): object | null {
  try {
    const anchor = raw === null ? null : parsePublicationAnchor(raw);
    if (q.phase !== "bound" || raw !== null && (!anchor || !publicationAnchorMatchesPair(anchor, q)) || current() !== true) return null;
    if (observationOccurrence === Number.MAX_SAFE_INTEGER) return null;
    const occurrence = ++observationOccurrence;
    const handle = Object.freeze(Object.create(null)) as object;
    observations.set(handle, Object.freeze({ occurrence, latestOccurrence, raw, anchor, q: Object.freeze({ ...q, initialEntryKeys: Object.freeze([...q.initialEntryKeys]), verifiedItemIds: Object.freeze([...q.verifiedItemIds]) }), manifest, current }));
    return handle;
  } catch { return null; }
}
/** Identity-only lookup. Structural objects/proxies never acquire read provenance. */
export function readPublicationAnchorObservation(value: unknown): AnchorObservation | null {
  const found = value !== null && (typeof value === "object" || typeof value === "function") ? observations.get(value) : null;
  try { return found?.current() === true ? found : null; } catch { return null; }
}
const MAX_WIRE = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n".length + 17 + Math.ceil((25165824 + 16) * 4 / 3);
const hashCompletions = new WeakSet<object>();
export function hashPublicationValue(kind: "wire" | "prepared" | "anchor" | "source", values: readonly string[], owns: (value: unknown) => boolean, current: () => boolean): Promise<string | null> {
 const result = Promise.resolve().then(async () => {
  try {
    if (current() !== true || !Array.isArray(values) || values.some(v => typeof v !== "string")) return null;
    const tag = kind === "wire" ? "installation-published-wire/v1" : kind === "prepared" ? "installation-published-sporting/v1" : kind === "anchor" ? "installation-publication-anchor/v1" : kind === "source" ? "installation-source-denial/v2" : null;
    if (!tag || values.length !== (kind === "prepared" || kind === "source" ? 2 : 1)) return null;
    if (kind === "wire" ? values[0].length > MAX_WIRE : kind === "anchor" ? values[0].length > MAX_PUBLICATION_ASCII : !digest(values[0]) || values[1].length > (kind === "source" ? 4 + 4 * 1048576 : 14 * 1024 * 1024)) return null;
    // Actual inputs are ASCII wire/codeunits/canonical rows. Count escaped tuple
    // size before constructing it, including hostile all-quote/control inputs.
    let size = tag.length + 4;
    const limit = kind === "prepared" || kind === "source" ? 16777216 : (kind === "wire" ? MAX_WIRE : MAX_PUBLICATION_ASCII) + 256;
    for (const value of values) {
      size += 3;
      for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c > 127) return null; size += c < 32 ? 6 : c === 34 || c === 92 ? 2 : 1; if (size > limit) return null; }
    }
    const captured = captureOwnedPlatformSha256(value => value !== null && (typeof value === "object" || typeof value === "function") && hashCompletions.has(value) || owns(value), current);
    if (!captured.ok) { await settlePlatformSha256Preparation(captured); return null; }
    const fingerprint = await captured.value.hash(serializePlatformStringTuple(tag, ...values));
    return current() === true ? fingerprint : null;
  } catch { return null; }
 });
 hashCompletions.add(result); return result;
}
