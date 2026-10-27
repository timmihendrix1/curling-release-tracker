// Private standard-integrity archive binding, not transport or application access.
import { installationTransferV3Internals } from "./installationTransferCodec";
import { capturePlatformByteSha256, settlePlatformSha256Preparation } from "./platformSha256";

function standardProvider(): (bytes: Uint8Array) => Promise<string> {
  let captured: ReturnType<typeof capturePlatformByteSha256> | null = null;
  return async bytes => {
    // The real codec invokes this only after all deterministic pre-hash admission.
    captured ??= capturePlatformByteSha256();
    if (!captured.ok) {
      await settlePlatformSha256Preparation(captured);
      throw new Error("Archive fingerprint unavailable");
    }
    // Only our final primitive string/fixed rejection crosses the pure core seam.
    return await captured.value.hashBytes(bytes);
  };
}
export function encodeInstallationTransferV3(snapshotJson: unknown) {
  return installationTransferV3Internals.encode(snapshotJson, standardProvider());
}
export function decodeInstallationTransferV3(wire: unknown) {
  return installationTransferV3Internals.decode(wire, standardProvider());
}
