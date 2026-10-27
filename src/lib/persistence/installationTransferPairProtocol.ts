// Private new-mode anchor. No legacy D tuple, source credentials or access grant.
import { parseQ, parseM, serializeQ, serializeM, type Q, type M } from "./credentialProtocol";
import { fixedCredentialSlots } from "../supabase/providerCredentialContract";
import { credentialManifestSlot, parseCredentialPhysicalSlot } from "./credentialPhysicalSlots";
import { isPlatformCredentialFingerprint } from "./platformCredentialFingerprint";
import { createQuarantineWork } from "./installationTransferQuarantineWork";
import { isCanonicalUuid } from "../uuid";

export type TransferPairState = Readonly<{ intentQ: string; manifest: string; boundQ: string | null }>;
const headers = ["schemaVersion", "protocolId", "credentialEpochId", "manifestId", "providerConfigIdentity", "sdkContractVersion", "sessionStorageKey"] as const;
const canonicalQ = (raw: unknown): Q | null => {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  const parsed = parseQ(raw); if (!parsed.ok) return null;
  const encoded = serializeQ(parsed.value);
  return encoded.ok && encoded.value === raw ? parsed.value : null;
};
export function transferIntentQ(raw: unknown): Q | null {
  const q = canonicalQ(raw);
  return q?.phase === "intent" && q.initialEntryKeys.length === 0 && q.verifiedItemIds.length === 0 ? q : null;
}
export function readTransferPair(intentRaw: unknown, manifestRaw: unknown, boundRaw: unknown = null): Readonly<{ q: Q; m: M; bound: Q | null }> | null {
  const q = transferIntentQ(intentRaw);
  if (!q || typeof manifestRaw !== "string" || manifestRaw.length > 4096) return null;
  const parsed = parseM(manifestRaw, isPlatformCredentialFingerprint);
  if (!parsed.ok) return null;
  const m = parsed.value, canonical = serializeM(m, isPlatformCredentialFingerprint);
  const address = credentialManifestSlot(q.providerConfigIdentity);
  if (!canonical.ok || canonical.value !== manifestRaw || !address.ok || !parseCredentialPhysicalSlot(q.providerConfigIdentity, q.sessionStorageKey, address.value).ok ||
    headers.some(key => q[key] !== m[key]) || m.expectedStoreIdentity !== q.expectedStoreIdentity ||
    m.initialEntryKeys.length !== 0 || m.items.length !== 0) return null;
  const fixed = fixedCredentialSlots(q.sessionStorageKey);
  if (m.fixedSlots.length !== fixed.length || fixed.some((slot, i) => slot.kind !== m.fixedSlots[i].kind || slot.key !== m.fixedSlots[i].key || m.fixedSlots[i].presence !== "absent")) return null;
  const identifiers = [q.protocolId, q.credentialEpochId, q.manifestId, q.expectedStoreIdentity!];
  if (new Set(identifiers).size !== 4) return null;
  let bound: Q | null = null;
  if (boundRaw !== null) {
    bound = canonicalQ(boundRaw);
    if (!bound || bound.phase !== "bound" || headers.some(key => q[key] !== bound![key]) || bound.storeIdentity !== q.expectedStoreIdentity || bound.initialEntryKeys.length !== 0 || bound.verifiedItemIds.length !== 0) return null;
  }
  return Object.freeze({ q, m, bound });
}
export function transferBoundQ(intentRaw: string, manifestRaw: string): string | null {
  const pair = readTransferPair(intentRaw, manifestRaw); if (!pair) return null;
  const { expectedStoreIdentity, ...q } = pair.q;
  const encoded = serializeQ({ ...q, phase: "bound", storeIdentity: expectedStoreIdentity });
  return encoded.ok ? encoded.value : null;
}
export async function createTransferPair(config: string, root: string, current: () => boolean = () => true, owns: (value: unknown) => boolean = () => false): Promise<TransferPairState | null> {
  const work = createQuarantineWork(owns);
  try {
    if (!current()) return null;
    const crypto = globalThis.crypto;
    if (!current()) return null;
    const randomUUID: unknown = crypto.randomUUID;
    if (typeof randomUUID !== "function") { await work.value(randomUUID); return null; }
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      if (!current()) return null;
      const value: unknown = Reflect.apply(randomUUID, crypto, []);
      if (typeof value !== "string") { await work.value(value); return null; }
      if (!isCanonicalUuid(value) || ids.includes(value) || !current()) return null;
      ids.push(value);
    }
    if (!current()) return null;
    const header = { schemaVersion: 1, protocolId: ids[0], credentialEpochId: ids[1], manifestId: ids[2], providerConfigIdentity: config, sdkContractVersion: "auth-js/2.112.3:credential-v1", sessionStorageKey: root };
    const q = serializeQ({ ...header, initialEntryKeys: [], phase: "intent", verifiedItemIds: [], expectedStoreIdentity: ids[3] });
    const m = serializeM({ ...header, expectedStoreIdentity: ids[3], initialEntryKeys: [], fixedSlots: fixedCredentialSlots(root).map(slot => ({ ...slot, presence: "absent" })), items: [] }, isPlatformCredentialFingerprint);
    return q.ok && m.ok && readTransferPair(q.value, m.value) ? Object.freeze({ intentQ: q.value, manifest: m.value, boundQ: null }) : null;
  } catch { return null; }
  finally { await work.finish(); }
}
