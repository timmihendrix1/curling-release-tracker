import { nativeInventoryDiagnostics, inventoryFailure } from "./credentialInventoryDiagnostics";
import { registerPlugin } from "@capacitor/core";
import type { SecureStorageReadEvidence } from "./secureCredentialStore";

type CredentialReader = {
  read(options: { key: string }): Promise<unknown>;
  inventory(): Promise<unknown>;
};
const reader = registerPlugin<CredentialReader>("CurlingCredentialReader");

export type IosCredentialNamespaceInventory =
  | { readonly kind: "complete"; readonly keys: readonly string[] }
  | { readonly kind: "inaccessible" | "unreadable" | "unsupported_scope" | "limit_exceeded" };


/** A private metadata observation only. It cannot establish per-item absence,
 * a fresh namespace under an owner, a valid pair or permission to remove source.
 * The explicit new-user host invokes it under its genuine namespace owner.
 * Rejections never escape this boundary. */
export async function inventoryIosCredentialNamespace(
  inventory: CredentialReader["inventory"] = () => reader.inventory(),
): Promise<IosCredentialNamespaceInventory> {
  let raw: unknown;
  try { raw = await inventory(); }
  catch { return inventoryFailure("inaccessible", "transport_rejected"); }
  try {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return inventoryFailure("unreadable", "transport_shape");
    const names = Reflect.ownKeys(raw);
    const kindField = Object.getOwnPropertyDescriptor(raw, "kind");
    if (!kindField || !Object.hasOwn(kindField, "value")) return inventoryFailure("unreadable", "transport_shape");
    const kind: unknown = kindField.value;
    if (kind !== "complete") {
      if (kind !== "inaccessible" && kind !== "unreadable" && kind !== "unsupported_scope" && kind !== "limit_exceeded") return inventoryFailure("unreadable", "transport_shape");
      if (names.length === 1 && names[0] === "kind") return inventoryFailure(kind, `native_${kind}`);
      if (names.length !== 2 || !names.includes("diagnostic")) return inventoryFailure("unreadable", "transport_shape");
      const field = Object.getOwnPropertyDescriptor(raw, "diagnostic");
      if (!field || !Object.hasOwn(field, "value")) return inventoryFailure("unreadable", "transport_shape");
      const diagnostic: unknown = field.value;
      for (const allowed of nativeInventoryDiagnostics[kind]) {
        if (diagnostic === allowed) return inventoryFailure(kind, allowed);
      }
      return inventoryFailure("unreadable", "transport_shape");
    }
    if (names.length !== 2 || !names.includes("keys")) return inventoryFailure("unreadable", "transport_shape");
    const keysField = Object.getOwnPropertyDescriptor(raw, "keys");
    if (!keysField || !Object.hasOwn(keysField, "value")) return inventoryFailure("unreadable", "transport_shape");
    const keys: unknown = keysField.value;
    if (!Array.isArray(keys)) return inventoryFailure("unreadable", "transport_shape");
    if (keys.length > 4_096) return inventoryFailure("limit_exceeded", "transport_limit");
    if (Reflect.ownKeys(keys).length !== keys.length + 1) return inventoryFailure("unreadable", "transport_shape");
    const owned: string[] = [];
    for (let i = 0; i < keys.length; i++) {
      const field = Object.getOwnPropertyDescriptor(keys, String(i));
      if (!field || !Object.hasOwn(field, "value")) return inventoryFailure("unreadable", "transport_shape");
      const key: unknown = field.value;
      if (typeof key !== "string") return inventoryFailure("unreadable", "transport_shape");
      if (key.length > 192) return inventoryFailure("limit_exceeded", "transport_limit");
      if (key.length === 0 || /[\p{Cc}\p{Cf}]/u.test(key)) return inventoryFailure("unreadable", "transport_shape");
      for (let j = 0; j < key.length; j++) {
        const unit = key.charCodeAt(j);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = key.charCodeAt(++j);
          if (!(next >= 0xdc00 && next <= 0xdfff)) return inventoryFailure("unreadable", "transport_shape");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) return inventoryFailure("unreadable", "transport_shape");
      }
      if (i > 0 && owned[i - 1] >= key) return inventoryFailure("unreadable", "transport_shape");
      owned.push(key);
    }
    return Object.freeze({ kind: "complete", keys: Object.freeze(owned) });
  } catch {
    return inventoryFailure("inaccessible", "transport_reflection");
  }
}

/** Transport validation is deny-only. A missing/unavailable plugin never falls
 * back to the ambiguous read API. Values and OS error details are never logged. */
export async function readIosKeychainEvidence(
  key: string,
  read: CredentialReader["read"] = (options) => reader.read(options),
): Promise<SecureStorageReadEvidence> {
  const raw = await read({ key });
  try {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { kind: "unreadable" };
    const record = raw as Record<string, unknown>;
    const keys = Object.keys(record);
    if (record.kind === "value" && keys.length === 2 && keys.includes("kind") && keys.includes("value") && typeof record.value === "string") {
      return { kind: "value", value: record.value };
    }
    if (keys.length !== 1 || keys[0] !== "kind") return { kind: "unreadable" };
    if (record.kind === "established_absent") return { kind: "established_absent" };
    return { kind: "unreadable" };
  } catch {
    // Hostile/malformed bridge responses may not become an absence verdict.
    return { kind: "unreadable" };
  }
}
