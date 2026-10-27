// Explicit, dormant configuration preparation. No environment/default or store.
import { resolveCloudConfig, type ConfiguredCloudConfig } from "./config";
import { providerSessionStorageKey } from "./providerCredentialStorage";
import { ROOT_PATTERN } from "./providerCredentialContract";
import { createPlatformDomainFingerprint } from "../persistence/platformDomainFingerprint";
import { createPlatformCredentialFingerprint } from "../persistence/platformCredentialFingerprint";
import { capturePlatformSha256, settlePlatformSha256Preparation, drainObservedPlatformWork, serializePlatformStringTuple } from "../persistence/platformSha256";
import { captureNativeSportingArguments } from "../persistence/nativeSportingDataCapture";

declare const configurationBrand: unique symbol;
export type NativeProviderConfigurationBinding = Readonly<{ [configurationBrand]: true }>;
type CapturedConfiguration = Readonly<{
  config: Readonly<ConfiguredCloudConfig>;
  providerConfigIdentity: string;
  sessionStorageKey: string;
  domainFingerprint: Extract<ReturnType<typeof createPlatformDomainFingerprint>, { ok: true }>["value"];
  credentialFingerprint: Extract<ReturnType<typeof createPlatformCredentialFingerprint>, { ok: true }>["value"];
}>;
const bindings = new WeakMap<object, CapturedConfiguration>();
const apply = Reflect.apply;
const own = Object.prototype.hasOwnProperty;

/** Internal lookup: only the actual Auth host may import this module in shipping
 * source. WeakMap membership is checked without reflecting on the candidate. */
export function resolveNativeProviderConfiguration(candidate: unknown): CapturedConfiguration | null {
  return candidate !== null && typeof candidate === "object" ? bindings.get(candidate) ?? null : null;
}

export type NativeProviderConfigurationResult = Readonly<
  { ok: true; value: NativeProviderConfigurationBinding } |
  { ok: false; reason: "invalid_configuration" | "evidence_unavailable" }
>;

export async function prepareNativeProviderConfiguration(input: unknown): Promise<NativeProviderConfigurationResult> {
  let current = true;
  const malformed: Promise<unknown>[] = [];
  let config: Readonly<ConfiguredCloudConfig>, root: string;
  try {
    const [captured] = captureNativeSportingArguments([input], ["record"], {
      current: () => current, retire: () => { current = false; },
      retain(value) { malformed.push(drainObservedPlatformWork(value)); },
      isOwnDisposal: () => false,
    });
    const supplied = captured as Record<string, unknown>;
    if (Reflect.ownKeys(supplied).length !== 3 || !["status", "url", "publishableKey"].every(key => apply(own, supplied, [key])) ||
      supplied.status !== "configured" ||
      typeof supplied.url !== "string" || typeof supplied.publishableKey !== "string") throw null;
    const { url, publishableKey } = supplied;
    const resolved = resolveCloudConfig(url, publishableKey);
    if (resolved.status !== "configured" || resolved.url !== url || resolved.publishableKey !== publishableKey) throw null;
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw null;
    const derived = providerSessionStorageKey(url);
    if (derived === null || ROOT_PATTERN.exec(derived)?.[0] !== derived) throw null;
    root = derived;
    config = Object.freeze({ status: "configured", url, publishableKey });
  } catch {
    current = false;
    await Promise.all(malformed);
    return Object.freeze({ ok: false, reason: "invalid_configuration" });
  }
  try {
    // Capture all standard operations/bindings before the first digest await.
    // No injected digest, private custom hash, truncation or random assignment.
    const sha = capturePlatformSha256();
    if (!sha.ok) { await settlePlatformSha256Preparation(sha); throw null; }
    const domain = createPlatformDomainFingerprint();
    if (!domain.ok) { await settlePlatformSha256Preparation(domain); throw null; }
    const credential = createPlatformCredentialFingerprint(root);
    if (!credential.ok) { await settlePlatformSha256Preparation(credential); throw null; }
    const suffix = await sha.value.hash(serializePlatformStringTuple(
      "native-provider-configuration/v1", "auth-js/2.112.3:credential-v1", config.url, config.publishableKey, root,
    ));
    const value = Object.freeze(Object.create(null)) as NativeProviderConfigurationBinding;
    bindings.set(value, Object.freeze({ config, providerConfigIdentity: `pc1:${suffix}`, sessionStorageKey: root,
      domainFingerprint: domain.value, credentialFingerprint: credential.value }));
    return Object.freeze({ ok: true, value });
  } catch { return Object.freeze({ ok: false, reason: "evidence_unavailable" }); }
}
