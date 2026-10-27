// Dormant physical-name binding. Config assignment to one exact provider AND
// derived root is an owner prerequisite, not evidence supplied by this codec.
import { isCanonicalUuid } from "../uuid";
import { classifyCredentialKey, contractResult, FLOW_PATTERN, refuse, ROOT_PATTERN, type Result } from "../supabase/providerCredentialContract";

export type CredentialPhysicalSlot = Readonly<{ kind: "manifest" }> |
  Readonly<{ kind: "item"; epoch: string; key: string }>;
const CONFIG = /^pc1:[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_SLOT = 178;
function configPrefix(configId: unknown): string {
  if (typeof configId !== "string") refuse("invalid_input");
  if (CONFIG.exec(configId)?.[0] !== configId) refuse("invalid_identifier", "header");
  return configId.length.toString(16).padStart(2, "0") + "." + configId;
}
function rootValue(root: unknown): string {
  if (typeof root !== "string") refuse("invalid_input");
  if (ROOT_PATTERN.exec(root)?.[0] !== root) refuse("invalid_key", "header");
  return root;
}
function itemName(prefix: string, root: string, epoch: unknown, key: unknown): string {
  if (typeof epoch !== "string" || typeof key !== "string") refuse("invalid_input");
  if (epoch.length !== 36 || !isCanonicalUuid(epoch)) refuse("invalid_identifier", "header");
  if (key.length > 192) refuse("limit_exceeded", "inventory");
  const classification = classifyCredentialKey(root, key);
  let selector: string;
  switch (classification.kind) {
    case "session": selector = "s"; break;
    case "user": selector = "u"; break;
    case "legacy_verifier": selector = "l"; break;
    case "flow_index": selector = "x"; break;
    case "flow_verifier":
      if (typeof classification.flowId !== "string" || FLOW_PATTERN.exec(classification.flowId)?.[0] !== classification.flowId) refuse("invalid_key", "inventory");
      selector = "f." + classification.flowId; break;
    default: refuse("invalid_key", "inventory");
  }
  return "i1." + prefix + "." + epoch + "." + selector;
}
export function credentialManifestSlot(configId: unknown): Result<string> {
  return contractResult(() => "m1." + configPrefix(configId));
}
export function credentialItemSlot(configId: unknown, root: unknown, epoch: unknown, key: unknown): Result<string> {
  return contractResult(() => itemName(configPrefix(configId), rootValue(root), epoch, key));
}
export function parseCredentialPhysicalSlot(configId: unknown, root: unknown, slot: unknown): Result<CredentialPhysicalSlot> {
  return contractResult(() => {
    const prefix = configPrefix(configId), sdkRoot = rootValue(root);
    if (typeof slot !== "string") refuse("invalid_input");
    if (slot.length > MAX_SLOT) refuse("limit_exceeded", "inventory");
    if (slot === "m1." + prefix) return Object.freeze({ kind: "manifest" });
    const itemPrefix = "i1." + prefix + ".";
    if (!slot.startsWith(itemPrefix)) refuse("invalid_key", "inventory");
    const rest = slot.slice(itemPrefix.length);
    const epoch = rest.slice(0, 36), selector = rest.slice(37);
    if (rest[36] !== "." || !isCanonicalUuid(epoch)) refuse("invalid_identifier", "header");
    let key: string;
    switch (selector) {
      case "s": key = sdkRoot; break;
      case "u": key = sdkRoot + "-user"; break;
      case "l": key = sdkRoot + "-code-verifier"; break;
      case "x": key = sdkRoot + "-flows-code-verifier"; break;
      default:
        if (!selector.startsWith("f.") || FLOW_PATTERN.exec(selector.slice(2))?.[0] !== selector.slice(2)) refuse("invalid_key", "inventory");
        key = sdkRoot + "-flow-" + selector.slice(2) + "-code-verifier";
    }
    if (itemName(prefix, sdkRoot, epoch, key) !== slot) refuse("invalid_key", "inventory");
    // Any canonical epoch survives parsing; only the later complete-inventory
    // owner can establish whether this is expected, foreign or orphaned.
    return Object.freeze({ kind: "item", epoch, key });
  });
}
