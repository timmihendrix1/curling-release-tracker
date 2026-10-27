// Dormant platform integrity hash binding. No SDK/storage/activation dependency.
import { capturePlatformSha256, inheritPlatformSha256Failure, serializePlatformStringTuple } from "./platformSha256";
import type { Fingerprint, FingerprintFormat } from "./credentialProtocol";
import { classifyCredentialKey, contractResult, FLOW_PATTERN, refuse, ROOT_PATTERN, SDK_RAW_LIMIT, type Result } from "../supabase/providerCredentialContract";

export type PlatformCredentialFingerprint = Readonly<{ fingerprint: Fingerprint; isWellFormedFingerprint: FingerprintFormat }>;
const isWellFormedFingerprint: FingerprintFormat = candidate => typeof candidate === "string" && candidate.length === 64 && /^[0-9a-f]{64}$/.test(candidate);
// Format-only reuse by the dormant immutable port; this computes no digest.
export { isWellFormedFingerprint as isPlatformCredentialFingerprint };

/** Captures platform operations once; never computes at construction/import.
 * digestOverride is solely for injected dependency tests, not app composition.
 * Providers own their async returns: ordinary observable promises/thenables only.
 * Poisoned Promise constructors/species that prevent observation are outside this
 * contract, just as at the accepted S2 asynchronous-dependency boundary.
 */
export function createPlatformCredentialFingerprint(root: unknown, digestOverride?: unknown): Result<PlatformCredentialFingerprint> {
  let failedCapture: object | null = null;
  const result = contractResult<PlatformCredentialFingerprint>(() => {
    if (typeof root !== "string") refuse("invalid_input");
    if (ROOT_PATTERN.exec(root)?.[0] !== root) refuse("invalid_key", "header");
    const captured = capturePlatformSha256(digestOverride);
    if (!captured.ok) { failedCapture = captured; refuse("evidence_unavailable", "evidence"); }
    const fingerprint: Fingerprint = async (purpose, key, raw) => {
      try {
        if (purpose !== "credential-value/v1" || typeof key !== "string" || key.length > 192 || typeof raw !== "string" || raw.length > SDK_RAW_LIMIT) throw null;
        const classification = classifyCredentialKey(root, key);
        if (classification.kind === "foreign" || classification.kind === "unsupported_own") throw null;
        if (classification.kind === "flow_verifier" && (typeof classification.flowId !== "string" || FLOW_PATTERN.exec(classification.flowId)?.[0] !== classification.flowId)) throw null;
        return await captured.value.hash(serializePlatformStringTuple(purpose, key, raw));
      } catch { throw new Error("Credential fingerprint unavailable"); }
    };
    return Object.freeze({ fingerprint, isWellFormedFingerprint });
  });
  return failedCapture ? inheritPlatformSha256Failure(failedCapture, result) : result;
}
