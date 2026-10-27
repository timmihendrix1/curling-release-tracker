// Dormant D-value integrity binding; standard operations are privately captured.
import { capturePlatformSha256, inheritPlatformSha256Failure, serializePlatformStringTuple } from "./platformSha256";
export type PlatformDomainFingerprint = Readonly<{
  fingerprint(value: string): Promise<string>;
  isWellFormedFingerprint(candidate: unknown): boolean;
}>;
export type PlatformDomainFingerprintResult =
  | Readonly<{ ok: true; value: PlatformDomainFingerprint }>
  | Readonly<{ ok: false; reason: "evidence_unavailable" }>;
const isWellFormedFingerprint = (candidate: unknown): boolean =>
  typeof candidate === "string" && candidate.length === 64 && /^[0-9a-f]{64}$/.test(candidate);

/** No eager digest. Observable provider work/derived promises remain under C4.
 * Failure retains its private drain; a synchronous Result is not drain completion.
 * digestOverride remains test-only; the configured native path supplies none. */
export function createPlatformDomainFingerprint(digestOverride?: unknown): PlatformDomainFingerprintResult {
  const captured = capturePlatformSha256(digestOverride);
  if (!captured.ok) return inheritPlatformSha256Failure(captured, Object.freeze({ ok: false, reason: "evidence_unavailable" }));
  const fingerprint = async (value: string): Promise<string> => {
    try {
      if (typeof value !== "string") throw null;
      return await captured.value.hash(serializePlatformStringTuple("domain-value/v1", value));
    } catch { throw new Error("Domain fingerprint unavailable"); }
  };
  return Object.freeze({ ok: true, value: Object.freeze({ fingerprint, isWellFormedFingerprint }) });
}
