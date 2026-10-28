// Pure ephemeral presentation metadata. No native imports, storage or authority.
export const nativeInventoryDiagnostics = Object.freeze({
  inaccessible: Object.freeze(["os_interaction_not_allowed", "os_auth_failed", "os_not_available", "os_missing_entitlement", "os_parameter", "os_decode", "os_other"] as const),
  unreadable: Object.freeze(["rows_shape", "row_shape", "value_reference", "account_shape", "account_encoding", "key_shape", "sync_shape", "service_shape"] as const),
  unsupported_scope: Object.freeze(["sync_enabled", "service_present"] as const),
  limit_exceeded: Object.freeze(["key_limit"] as const),
});
export type IosCredentialInventoryDiagnostic = typeof nativeInventoryDiagnostics[keyof typeof nativeInventoryDiagnostics][number] |
  "native_inaccessible" | "native_unreadable" | "native_unsupported_scope" | "native_limit_exceeded" |
  "transport_rejected" | "transport_reflection" | "transport_shape" | "transport_limit";
const inventoryDiagnostics = new WeakMap<object, IosCredentialInventoryDiagnostic>();
/** Exact normalized transport result only. This metadata never grants access. */
export function iosCredentialInventoryDiagnostic(result: unknown): IosCredentialInventoryDiagnostic | null {
  return result !== null && typeof result === "object" ? inventoryDiagnostics.get(result) ?? null : null;
}
export function inventoryFailure(kind: "inaccessible" | "unreadable" | "unsupported_scope" | "limit_exceeded", diagnostic: IosCredentialInventoryDiagnostic): Readonly<{ kind: typeof kind }> {
  const result = Object.freeze({ kind });
  inventoryDiagnostics.set(result, diagnostic);
  return result;
}
