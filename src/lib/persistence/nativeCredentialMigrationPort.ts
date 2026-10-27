// Dormant S3c immutable protected-store port. No application caller or grant.
import { classifyCredentialKey, validateRuntimeCredentialValue } from "../supabase/providerCredentialContract";
import { registerTransferRuntimeCompletion, ownsTransferRuntimeCompletion, abandonNativeRuntimeSession, observeNativeRuntimeMalformed, nativeRuntimeCleanup, nativeRuntimeCurrent, nativeRuntimeFailed, nativeRuntimeProtocolFault, nativeRuntimeEvidence, type NativeRuntimeSession, type NativeRuntimeDomainDraft, type NativeRuntimeCredentialDraft, type NativeRuntimeOperation } from "./nativeCombinedRuntime";
import type { SecureCredentialReadResult, SecureCredentialWriteResult, SecureCredentialRemoveResult } from "./secureCredentialStore";
import { credentialItemSlot } from "./credentialPhysicalSlots";
import { detectRuntimePlatform } from "../platform/runtimePlatform";
import { parseI, parseM, serializeI, LEGACY_CREDENTIAL_CONTRACT, type CredentialContract, type Q } from "./credentialProtocol";
import { credentialManifestSlot, parseCredentialPhysicalSlot, type CredentialPhysicalSlot } from "./credentialPhysicalSlots";
import { isPlatformCredentialFingerprint } from "./platformCredentialFingerprint";
import { SECURE_CREDENTIAL_IOS_ACCESS, SECURE_CREDENTIAL_NAMESPACE, SECURE_CREDENTIAL_SYNCHRONIZE } from "./secureCredentialStore";
import { createCredentialNamespaceOwner, type CredentialNamespaceLease, type CredentialNamespaceRefusal } from "./nativeCredentialNamespace";

import { MAX_PUBLICATION_ASCII, parsePublicationAnchor, publicationAnchorMatchesPair, publicationAnchorSlot, recordPublicationAnchorObservation, readPublicationAnchorObservation } from "./installationTransferPublicationProtocol";
import { observePlatformWork, drainObservedPlatformWork } from "./platformSha256";

export type CredentialMigrationControl = { readonly proceed?: () => boolean };
type Refusal = CredentialNamespaceRefusal | "cancelled" | "invalid_slot" | "platform_unsupported";
type Refused = { readonly status: "refused"; readonly reason: Refusal };
export type CredentialSlotObservation = Refused | { readonly status: "read_failed" } |
  { readonly status: "absent" } | { readonly status: "value"; readonly value: string };
export type CredentialNamespaceObservation = Refused | { readonly status: "unavailable" } |
  { readonly status: "complete"; readonly keys: readonly string[] };
export type CredentialInsertResult = Refused | { readonly status: "not_issued"; readonly reason: "invalid_input" | "invalid_envelope" | "limit_exceeded" | "evidence_unavailable" } |
  { readonly status: "already_present" } |
  { readonly status: "verified"; readonly writeIssued: true; readonly writeAcknowledged: true; readonly readbackVerified: true } |
  { readonly status: "unverified"; readonly writeIssued: true; readonly writeAcknowledged: boolean; readonly reason: "write_failed" | "invalid_acknowledgement" | "readback_failed" | "readback_mismatch" | "cancelled" };
export interface NativeCredentialMigrationPort {
  acquire(): Promise<{ readonly ok: true; readonly lease: CredentialNamespaceLease } | { readonly ok: false; readonly reason: Refusal }>;
  inspectNamespace(lease: CredentialNamespaceLease, control?: CredentialMigrationControl): Promise<CredentialNamespaceObservation>;
  readSlot(lease: CredentialNamespaceLease, slot: unknown, control?: CredentialMigrationControl): Promise<CredentialSlotObservation>;
  insert(lease: CredentialNamespaceLease, slot: unknown, raw: unknown, control?: CredentialMigrationControl): Promise<CredentialInsertResult>;
  release(lease: CredentialNamespaceLease): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: CredentialNamespaceRefusal }>;
  leaseState(): "unowned" | "owned" | "faulted" | "releasing";
}
export type NativeCredentialMigrationPortResult = { readonly ok: false; readonly reason: "invalid_dependency" | "invalid_configuration" } |
  { readonly ok: true; readonly value: NativeCredentialMigrationPort };
/** S3f-only closed observations, delivered before a later cancellation check.
 * May retain faults, never issue I/O or grant freshness. Old factory has none. */
export interface NativeCommonCredentialObserver {
  inventory(keys: readonly string[]): void;
  insertIssued?(slot: string, raw: string): void;
  slot(slot: string, value: { readonly status: "absent" } | { readonly status: "value"; readonly value: string }): void;
}
type Method = (...args: unknown[]) => unknown;
type Binding = { receiver: object; configure: Method; read: Method; write: Method; inventory: Method };
const apply = Reflect.apply;
const promiseThen = Promise.prototype.then;
const cancelled = Object.freeze({});
const broken = Object.freeze({});
function data(input: unknown, names: readonly string[], validateField?: (name: string, value: unknown) => void): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw broken;
  const keys = Reflect.ownKeys(input);
  if (keys.length !== names.length || names.some(name => !keys.includes(name))) throw broken;
  const result: Record<string, unknown> = {};
  for (const name of names) {
    const field = Object.getOwnPropertyDescriptor(input, name);
    if (!field || !Object.hasOwn(field, "value")) throw broken;
    const value: unknown = field.value;
    validateField?.(name, value);
    result[name] = value;
  }
  return result;
}
function captureBinding(input: unknown): Binding {
  // Do not inspect remove/clear, error metadata or optional plugin properties.
  if (input === null || typeof input !== "object" || Array.isArray(input)) throw broken;
  const methods: Record<string, Method> = {};
  for (const name of ["configure", "read", "write", "inventory"]) {
    const field = Object.getOwnPropertyDescriptor(input, name);
    if (!field || !Object.hasOwn(field, "value") || typeof field.value !== "function") throw broken;
    methods[name] = field.value as Method;
  }
  return { receiver: input, configure: methods.configure, read: methods.read, write: methods.write, inventory: methods.inventory };
}
function settled(value: unknown): Promise<unknown> {
  // Observable provider-owned returns only (S2 C4). No universal rescue of
  // poisoned Promise constructors/species or provider background rejections.
  return new Promise((resolve, reject) => {
    try { apply(promiseThen, value, [resolve, reject]); } catch { resolve(value); }
  });
}
function readEvidence(raw: unknown, maximum: number, validateField?: (name: string, value: unknown) => void): { status: "absent" } | { status: "value"; value: string } {
  const kindField = raw !== null && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "kind") : undefined;
  if (!kindField || !Object.hasOwn(kindField, "value")) throw broken;
  validateField?.("kind", kindField.value);
  if (kindField.value === "established_absent") { data(raw, ["kind"], validateField); return { status: "absent" }; }
  const value = data(raw, ["kind", "value"], validateField);
  if (value.kind !== "value" || typeof value.value !== "string" || value.value.length > maximum) throw broken;
  return { status: "value", value: value.value };
}
function inventoryEvidence(raw: unknown): readonly string[] {
  const result = data(raw, ["kind", "keys"]);
  if (result.kind !== "complete" || !Array.isArray(result.keys) || result.keys.length > 4096 || Reflect.ownKeys(result.keys).length !== result.keys.length + 1) throw broken;
  const keys: string[] = [];
  for (let i = 0; i < result.keys.length; i++) {
    const field = Object.getOwnPropertyDescriptor(result.keys, String(i));
    if (!field || !Object.hasOwn(field, "value")) throw broken;
    const key: unknown = field.value;
    if (typeof key !== "string" || key.length === 0 || key.length > 192 || /[\p{Cc}\p{Cf}]/u.test(key) || (i > 0 && keys[i - 1] >= key)) throw broken;
    for (let j = 0; j < key.length; j++) {
      const code = key.charCodeAt(j);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = key.charCodeAt(++j);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw broken;
      } else if (code >= 0xdc00 && code <= 0xdfff) throw broken;
    }
    keys.push(key);
  }
  return Object.freeze(keys);
}
function permission(current: () => boolean, control?: CredentialMigrationControl): () => boolean {
  return () => {
    if (!current()) return false;
    try {
      const callback = control?.proceed;
      const allowed = callback === undefined || (typeof callback === "function" && apply(callback, control, []) === true);
      // The getter/callback can synchronously release or fault this owner.
      // No foreign callback may follow this final authority check before I/O.
      return allowed && current();
    } catch { return false; }
  };
}
type RuntimePreparation = (lease: CredentialNamespaceLease, q: Q, manifest: string, session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, current: () => boolean) => NativeRuntimeCredentialDraft | null;
const runtimePreparations = new WeakMap<object, RuntimePreparation>();
const transferPreparations = new WeakMap<object, (owns: (value: unknown) => boolean, ...args: Parameters<RuntimePreparation>) => Promise<NativeRuntimeCredentialDraft | null>>();
/** Genuine port lookup, actual session and completion ownership; no readiness grant. */
export async function prepareTransferIdentityCredentialRuntime(port: NativeCredentialMigrationPort, owns: (value: unknown) => boolean, ...args: Parameters<RuntimePreparation>): Promise<NativeRuntimeCredentialDraft | null> {
  return await transferPreparations.get(port)?.(owns, ...args) ?? null;
}
export type PublicationCredentialResult = Readonly<{ status: "observed"; observation: object; inserted: boolean } | { status: "refused" }>;
export interface PublicationCredentialCapability {
  ownsCompletion(value: unknown): boolean;
  prepareRuntime(lease: CredentialNamespaceLease, observation: unknown, session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, current: () => boolean): Promise<Readonly<{ kind: "prepared" | "cleanup_required"; draft: NativeRuntimeCredentialDraft }> | null>;
  read(lease: CredentialNamespaceLease, q: Q, manifest: string, control?: CredentialMigrationControl): Promise<PublicationCredentialResult>;
  insert(lease: CredentialNamespaceLease, q: Q, manifest: string, raw: string, control?: CredentialMigrationControl): Promise<PublicationCredentialResult>;
}
const publicationCapabilities = new WeakMap<object, PublicationCredentialCapability>();
/** Exact genuine port only. Ordinary/copied/wrapped ports acquire no capability. */
export function publicationTransferCredentialCapability(port: unknown): PublicationCredentialCapability | null {
  return port !== null && (typeof port === "object" || typeof port === "function") ? publicationCapabilities.get(port) ?? null : null;
}
type TransferPortPolicy = Readonly<{ owns(value: unknown): boolean; current(): boolean; failed(): void }>;
function protectedWork(owns: (value: unknown) => boolean, failed: () => void) {
  const retained = new Set<Promise<unknown>>();
  const observed = new Map<unknown, Promise<unknown>>();
  return {
    owns,
    malformed(value: unknown) {
      if (!observed.has(value)) {
        const work = drainObservedPlatformWork(value, owns);
        observed.set(value, work); retained.add(work);
      }
    },
    async observe(value: unknown): Promise<Readonly<{ value: unknown }>> {
      // A new invocation always observes afresh, even for a reused return object.
      const work = observePlatformWork(value, owns, failed);
      observed.set(value, work); retained.add(work);
      const result = await work;
      if (result.kind !== "value") throw cancelled;
      observed.set(result.value, work);
      return Object.freeze(Object.assign(Object.create(null), { value: result.value }));
    },
    async finish() { await Promise.all([...retained].map(work => work.then(() => {}, () => {}))); },
  };
}
function transferWork(session: NativeRuntimeSession, owns: (value: unknown) => boolean) {
  return protectedWork(value => owns(value) || ownsTransferRuntimeCompletion(session, value), () => { nativeRuntimeFailed(session, "credential"); });
}
function rejectTransferDescriptor(field: PropertyDescriptor | undefined, work: ReturnType<typeof protectedWork>, failed: () => void): never {
  failed();
  if (field) for (const name of ["value", "get", "set"] as const) if (Object.hasOwn(field, name)) work.malformed(field[name]);
  throw broken;
}
async function captureTransferBinding(input: unknown, work: ReturnType<typeof protectedWork>, policy: TransferPortPolicy, publication = false): Promise<Binding> {
  try {
    if (publication && work.owns(input)) throw cancelled;
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw broken;
    // Intrinsic brand probe only. Do not invoke a binding's arbitrary then getter.
    // A pending/masked Promise cannot masquerade as a synchronous method container.
    let native = false;
    try { apply(promiseThen, input, [() => {}, () => {}]); native = true; } catch { /* ordinary object; C4 species limit */ }
    if (native) throw broken;
    const methods: Record<string, Method> = {};
    for (const name of ["configure", "read", "write", "inventory"]) {
      if (!policy.current()) throw cancelled;
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (publication && field && "value" in field && work.owns(field.value)) throw cancelled;
      if (!field || !Object.hasOwn(field, "value") || typeof field.value !== "function") rejectTransferDescriptor(field, work, policy.failed);
      if (!policy.current()) throw cancelled;
      methods[name] = field.value as Method;
    }
    return { receiver: input, configure: methods.configure, read: methods.read, write: methods.write, inventory: methods.inventory };
  } catch (reason) {
    if (reason !== cancelled) { policy.failed(); work.malformed(input); }
    throw reason;
  }
}
/** Strict parsing retains only actually acquired roots/descriptors, before drain. */
function transferEvidence(work: ReturnType<typeof protectedWork>, failed: () => void) {
  const roots = new Set<unknown>();
  function take(input: unknown, name: string): unknown {
    roots.add(input);
    if (input === null || typeof input !== "object") throw broken;
    const field = Object.getOwnPropertyDescriptor(input, name);
    if (field) for (const key of ["value", "get", "set"] as const) if (Object.hasOwn(field, key)) roots.add(field[key]);
    if (!field || !Object.hasOwn(field, "value")) throw broken;
    return field.value;
  }
  function exact(input: object, names: readonly string[]) {
    const keys = Reflect.ownKeys(input);
    if (keys.length !== names.length || names.some(name => !keys.includes(name))) throw broken;
  }
  function reject(): never {
    failed(); for (const value of roots) work.malformed(value); throw broken;
  }
  return {
    read(raw: unknown, maximum: number): ReturnType<typeof readEvidence> {
      try {
        const kind = take(raw, "kind");
        if (kind !== "established_absent" && kind !== "value") throw broken;
        if (kind === "established_absent") { exact(raw as object, ["kind"]); return { status: "absent" }; }
        const value = take(raw, "value");
        if (typeof value !== "string" || value.length > maximum) throw broken;
        exact(raw as object, ["kind", "value"]); return { status: "value", value };
      } catch { return reject(); }
    },
    inventory(raw: unknown): readonly string[] {
      try {
        const kind = take(raw, "kind"); if (kind !== "complete") throw broken;
        const list = take(raw, "keys"); if (!Array.isArray(list)) throw broken;
        // Capture once, check primitive range before ownKeys/coercion/later fields.
        // Even a proxy's malformed length return remains acquired work to drain.
        const length: unknown = list.length; roots.add(length);
        if (typeof length !== "number" || !Number.isSafeInteger(length) || length < 0 || length > 4096) throw broken;
        exact(raw as object, ["kind", "keys"]);
        exact(list, ["length", ...Array.from({ length }, (_, i) => String(i))]);
        const keys: string[] = [];
        for (let i = 0; i < length; i++) {
          const key = take(list, String(i)); if (typeof key !== "string") throw broken;
          // Reuse the original canonical key rules only on owned primitive copies.
          inventoryEvidence({ kind: "complete", keys: [key] });
          if (i > 0 && keys[i - 1] >= key) throw broken;
          keys.push(key);
        }
        return Object.freeze(keys);
      } catch { return reject(); }
    },
  };
}
export interface NativeCredentialMigrationCleanup {
  close(): Promise<object | null>;
  releaseReady(receipt: object): boolean;
  retire(receipt: object): void;
}
const migrationCleanups = new WeakMap<object, (lease: CredentialNamespaceLease) => NativeCredentialMigrationCleanup | null>();
export function prepareNativeCredentialMigrationCleanup(port: NativeCredentialMigrationPort, lease: CredentialNamespaceLease): NativeCredentialMigrationCleanup | null {
  return migrationCleanups.get(port)?.(lease) ?? null;
}
export function prepareNativeCredentialRuntime(port: NativeCredentialMigrationPort, ...args: Parameters<RuntimePreparation>): NativeRuntimeCredentialDraft | null {
  return runtimePreparations.get(port)?.(...args) ?? null;
}
const maximum = (slot: CredentialPhysicalSlot) => slot.kind === "manifest" ? 1_048_576 : 6_300_000;

export function createNativeCredentialMigrationPort(options: unknown): NativeCredentialMigrationPortResult {
  return buildCredentialMigrationPort(options, null);
}
export function createNativeCommonCredentialMigrationPort(options: unknown, observer: NativeCommonCredentialObserver, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): NativeCredentialMigrationPortResult {
  try {
    const inventory = observer.inventory, slot = observer.slot, insertIssued = observer.insertIssued;
    if (typeof inventory !== "function" || typeof slot !== "function" || (insertIssued !== undefined && typeof insertIssued !== "function")) return { ok: false, reason: "invalid_dependency" };
    return buildCredentialMigrationPort(options, Object.freeze({ inventory, slot, insertIssued }), undefined, contract);
  } catch { return { ok: false, reason: "invalid_dependency" }; }
}
/** Private transfer-only async capture. Exact callers are pinned by architecture tests. */
export async function createTransferCredentialMigrationPort(options: unknown, observer: NativeCommonCredentialObserver, policy: TransferPortPolicy): Promise<NativeCredentialMigrationPortResult> {
  return captureTransferPort(options, observer, policy, false);
}
/** Closed publication constructor; no production consumer until M1b review. */
export async function createPublicationTransferCredentialMigrationPort(options: unknown, observer: NativeCommonCredentialObserver, policy: TransferPortPolicy): Promise<NativeCredentialMigrationPortResult> {
  return captureTransferPort(options, observer, policy, true);
}
async function captureTransferPort(options: unknown, observer: NativeCommonCredentialObserver, policy: TransferPortPolicy, publication: boolean): Promise<NativeCredentialMigrationPortResult> {
  const work = protectedWork(policy.owns, policy.failed);
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)) throw broken;
    const keys = Reflect.ownKeys(options);
    if (keys.some(key => typeof key !== "string" || !["providerConfigIdentity", "sessionStorageKey", "binding", "detectPlatform"].includes(key))) throw broken;
    const fields = data(options, keys as string[]);
    if (typeof fields.providerConfigIdentity !== "string" || typeof fields.sessionStorageKey !== "string") return { ok: false, reason: "invalid_configuration" };
    const manifest = credentialManifestSlot(fields.providerConfigIdentity);
    if (!manifest.ok || !parseCredentialPhysicalSlot(fields.providerConfigIdentity, fields.sessionStorageKey, manifest.value).ok) return { ok: false, reason: "invalid_configuration" };
    if (fields.detectPlatform !== undefined && typeof fields.detectPlatform !== "function") { policy.failed(); work.malformed(fields.detectPlatform); throw broken; }
    const captured = fields.binding === undefined ? null : await captureTransferBinding(fields.binding, work, policy, publication);
    if (!policy.current()) throw cancelled;
    const inventory = observer.inventory, slot = observer.slot, insertIssued = observer.insertIssued;
    if (typeof inventory !== "function" || typeof slot !== "function" || (insertIssued !== undefined && typeof insertIssued !== "function")) throw broken;
    return buildCredentialMigrationPort({ providerConfigIdentity: fields.providerConfigIdentity, sessionStorageKey: fields.sessionStorageKey,
      detectPlatform: fields.detectPlatform }, Object.freeze({ inventory, slot, insertIssued }), { policy, captured, publication });
  } catch { return { ok: false, reason: "invalid_dependency" }; }
  finally { await work.finish(); }
}
function buildCredentialMigrationPort(options: unknown, observer: NativeCommonCredentialObserver | null, strict?: { policy: TransferPortPolicy; captured: Binding | null; publication: boolean }, contract: CredentialContract = LEGACY_CREDENTIAL_CONTRACT): NativeCredentialMigrationPortResult {
  let config: string, root: string, detect: () => unknown, binding: Binding | null = null;
  try {
    if (options === null || typeof options !== "object" || Array.isArray(options)) throw broken;
    const keys = Reflect.ownKeys(options);
    if (keys.some(key => typeof key !== "string" || !["providerConfigIdentity", "sessionStorageKey", "binding", "detectPlatform"].includes(key))) throw broken;
    const fields = data(options, keys as string[]);
    if (typeof fields.providerConfigIdentity !== "string" || typeof fields.sessionStorageKey !== "string") return { ok: false, reason: "invalid_configuration" };
    config = fields.providerConfigIdentity; root = fields.sessionStorageKey;
    const manifest = credentialManifestSlot(config);
    if (!manifest.ok || !parseCredentialPhysicalSlot(config, root, manifest.value).ok) return { ok: false, reason: "invalid_configuration" };
    if (fields.binding !== undefined) binding = captureBinding(fields.binding);
    if (fields.detectPlatform !== undefined && typeof fields.detectPlatform !== "function") throw broken;
    detect = fields.detectPlatform as (() => unknown) | undefined ?? detectRuntimePlatform;
  } catch { return { ok: false, reason: "invalid_dependency" }; }
  if (strict) binding = strict.captured;
  const owner = createCredentialNamespaceOwner();
  let configured = false;
  let ownedLease: CredentialNamespaceLease | null = null;
  let role: "migration" | "prepared" | "runtime" | "closed" = "migration";
  const publicationCompletions = new WeakSet<object>();
  const locallyOwned = (value: unknown) => value !== null && (typeof value === "object" || typeof value === "function") && publicationCompletions.has(value);
  const owns = (value: unknown) => locallyOwned(value) || strict?.policy.owns(value) === true;
  let publicationRuntime: { lease: CredentialNamespaceLease; q: Q; manifest: string; session: NativeRuntimeSession; domain: NativeRuntimeDomainDraft; current(): boolean; owns(value: unknown): boolean } | null = null;
  const operationWork = (lease: CredentialNamespaceLease) => strict ? protectedWork(owns, () => { owner.fault(lease); strict.policy.failed(); }) : null;
  const observe = (work: ReturnType<typeof protectedWork> | null, value: unknown) => work ? work.observe(value) : settled(value);
  const unpack = (work: ReturnType<typeof protectedWork> | null, value: unknown): unknown => work ? (value as Readonly<{ value: unknown }>).value : value;
  const evidence = (work: ReturnType<typeof protectedWork> | null, lease: CredentialNamespaceLease) => work
    ? transferEvidence(work, () => { owner.fault(lease); strict!.policy.failed(); })
    : { read: readEvidence, inventory: inventoryEvidence };
  async function ready(live: () => boolean, work: ReturnType<typeof protectedWork> | null): Promise<Binding> {
    if (!live()) throw cancelled;
    if (binding === null) {
      const loaded = await import("./capacitorSecureStorageBinding");
      if (!live()) throw cancelled;
      binding = strict && work ? await captureTransferBinding(loaded.createCapacitorSecureStorageBinding(), work, { ...strict.policy, current: live }, strict.publication) : captureBinding(loaded.createCapacitorSecureStorageBinding());
    }
    const active = binding;
    if (!configured) {
      if (!live()) throw cancelled;
      const ack = unpack(work, await observe(work, apply(active.configure, active.receiver, [{ keyPrefix: SECURE_CREDENTIAL_NAMESPACE,
        synchronize: SECURE_CREDENTIAL_SYNCHRONIZE, iosAccess: SECURE_CREDENTIAL_IOS_ACCESS }])));
      if (ack !== undefined) { if (work) { strict!.policy.failed(); work.malformed(ack); } throw broken; }
      if (!live()) throw cancelled;
      configured = true;
    }
    return active;
  }
  const refused = (reason: Refusal): Refused => Object.freeze({ status: "refused", reason });
  const address = (slot: unknown) => parseCredentialPhysicalSlot(config, root, slot);
  const migrationOperations: NativeCredentialMigrationPort = Object.freeze({
    async acquire() {
      if (role !== "migration") return { ok: false as const, reason: "ownership_unavailable" as const };
      if (strict) {
        if (!strict.policy.current()) return { ok: false as const, reason: "ownership_unavailable" as const };
        const work = protectedWork(owns, strict.policy.failed);
        try {
          const platform: unknown = detect();
          if (platform !== "ios") {
            // Primitive unsupported platforms are factual refusals; malformed work
            // is drained but its future fulfillment is never readiness evidence.
            if (typeof platform !== "string") { strict.policy.failed(); work.malformed(platform); }
            return { ok: false as const, reason: "platform_unsupported" as const };
          }
          if (!strict.policy.current()) return { ok: false as const, reason: "ownership_unavailable" as const };
        } catch { return { ok: false as const, reason: "platform_unsupported" as const }; }
        finally { await work.finish(); }
        if (!strict.policy.current()) return { ok: false as const, reason: "ownership_unavailable" as const };
      } else {
        try { if (detect() !== "ios") return { ok: false as const, reason: "platform_unsupported" as const }; }
        catch { return { ok: false as const, reason: "platform_unsupported" as const }; }
      }
      const result = await owner.acquire();
      if (result.ok) ownedLease = result.value;
      return result.ok ? { ok: true as const, lease: result.value } : result;
    },
    async inspectNamespace(lease: CredentialNamespaceLease, control?: CredentialMigrationControl): Promise<CredentialNamespaceObservation> {
      if (role !== "migration") return refused("ownership_unavailable");
      const result = await owner.run(lease, async current => {
        const live = permission(current, control);
        const work = operationWork(lease);
        try {
          const active = await ready(live, work);
          if (!live()) throw cancelled;
          const keys = evidence(work, lease).inventory(unpack(work, await observe(work, apply(active.inventory, active.receiver, []))));
          observer?.inventory(keys);
          if (!live()) throw cancelled;
          return Object.freeze({ status: "complete" as const, keys });
        } catch (error) {
          if (error === cancelled) return refused("cancelled");
          owner.fault(lease); return { status: "unavailable" as const };
        } finally { if (work) await work.finish(); }
      });
      return result.ok ? result.value : refused(result.reason);
    },
    async readSlot(lease: CredentialNamespaceLease, slot: unknown, control?: CredentialMigrationControl): Promise<CredentialSlotObservation> {
      if (role !== "migration") return refused("ownership_unavailable");
      const result = await owner.run(lease, async current => {
        const parsed = address(slot);
        if (!parsed.ok) return refused("invalid_slot");
        const live = permission(current, control);
        const work = operationWork(lease);
        try {
          const active = await ready(live, work);
          if (!live()) throw cancelled;
          const value = evidence(work, lease).read(unpack(work, await observe(work, apply(active.read, active.receiver, [slot]))), maximum(parsed.value));
          observer?.slot(slot as string, value);
          if (!live()) throw cancelled;
          return Object.freeze(value);
        } catch (error) {
          if (error === cancelled) return refused("cancelled");
          owner.fault(lease); return { status: "read_failed" as const };
        } finally { if (work) await work.finish(); }
      });
      return result.ok ? result.value : refused(result.reason);
    },
    async insert(lease: CredentialNamespaceLease, slot: unknown, raw: unknown, control?: CredentialMigrationControl): Promise<CredentialInsertResult> {
      if (role !== "migration") return refused("ownership_unavailable");
      const result = await owner.run(lease, async current => {
        const parsed = address(slot);
        if (!parsed.ok) return refused("invalid_slot");
        if (typeof raw !== "string") return { status: "not_issued" as const, reason: "invalid_input" as const };
        if (raw.length > maximum(parsed.value)) return { status: "not_issued" as const, reason: "limit_exceeded" as const };
        const envelope = parsed.value.kind === "manifest" ? parseM(raw, isPlatformCredentialFingerprint, contract) : parseI(raw, root, undefined, contract);
        if (!envelope.ok || envelope.value.providerConfigIdentity !== config ||
          (parsed.value.kind === "manifest" ? !("sessionStorageKey" in envelope.value) || envelope.value.sessionStorageKey !== root :
            !("key" in envelope.value) || envelope.value.key !== parsed.value.key || envelope.value.credentialEpochId !== parsed.value.epoch)) {
          return { status: "not_issued" as const, reason: "invalid_envelope" as const };
        }
        const live = permission(current, control);
        const work = operationWork(lease);
        let writeIssued = false, writeAcknowledged = false;
        try {
          const active = await ready(live, work);
          if (!live()) throw cancelled;
          const before = evidence(work, lease).read(unpack(work, await observe(work, apply(active.read, active.receiver, [slot]))), maximum(parsed.value));
          observer?.slot(slot as string, before);
          if (!live()) throw cancelled;
          if (before.status === "value") return { status: "already_present" as const };
          if (!live()) throw cancelled;
          observer?.insertIssued?.(slot as string, raw);
          if (!live()) throw cancelled;
          writeIssued = true;
          const ack = unpack(work, await observe(work, apply(active.write, active.receiver, [slot, raw])));
          writeAcknowledged = ack === undefined;
          if (!writeAcknowledged) {
            if (work) { strict!.policy.failed(); work.malformed(ack); }
            owner.fault(lease);
            return { status: "unverified" as const, writeIssued: true as const, writeAcknowledged, reason: "invalid_acknowledgement" as const };
          }
          if (!live()) throw cancelled;
          let after: ReturnType<typeof readEvidence>;
          try { after = evidence(work, lease).read(unpack(work, await observe(work, apply(active.read, active.receiver, [slot]))), maximum(parsed.value)); observer?.slot(slot as string, after); }
          catch { owner.fault(lease); return { status: "unverified" as const, writeIssued: true as const, writeAcknowledged, reason: "readback_failed" as const }; }
          if (!live()) throw cancelled;
          if (after.status !== "value" || after.value !== raw) {
            owner.fault(lease);
            return { status: "unverified" as const, writeIssued: true as const, writeAcknowledged, reason: "readback_mismatch" as const };
          }
          return { status: "verified" as const, writeIssued: true as const, writeAcknowledged: true as const, readbackVerified: true as const };
        } catch (error) {
          if (writeIssued) {
            owner.fault(lease);
            return { status: "unverified" as const, writeIssued: true as const, writeAcknowledged, reason: error === cancelled ? "cancelled" as const : "write_failed" as const };
          }
          if (error === cancelled) return refused("cancelled");
          owner.fault(lease); return { status: "not_issued" as const, reason: "evidence_unavailable" as const };
        } finally { if (work) await work.finish(); }
      });
      return result.ok ? Object.freeze(result.value) : refused(result.reason);
    },
    async release(lease: CredentialNamespaceLease) {
      if (role !== "migration") return { ok: false as const, reason: "ownership_unavailable" as const };
      const result = await owner.release(lease);
      if (result.ok) ownedLease = null;
      return result.ok ? { ok: true as const } : result;
    },
    leaseState: owner.state,
  });
  // The publication-only port registers its exact outward completions before
  // invoking even synchronous acquisition/release code. In particular release
  // still revokes its lease synchronously; it is never deferred behind work.
  function migrationCompletion<T>(operation: () => Promise<T>): Promise<T> {
    let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    publicationCompletions.add(result);
    try { void operation().then(resolve, reject); } catch { reject(); }
    return result;
  }
  const port: NativeCredentialMigrationPort = strict?.publication ? Object.freeze({
    acquire: () => migrationCompletion(() => migrationOperations.acquire()),
    inspectNamespace: (lease: CredentialNamespaceLease, control?: CredentialMigrationControl) => migrationCompletion(() => migrationOperations.inspectNamespace(lease, control)),
    readSlot: (lease: CredentialNamespaceLease, slot: unknown, control?: CredentialMigrationControl) => migrationCompletion(() => migrationOperations.readSlot(lease, slot, control)),
    insert: (lease: CredentialNamespaceLease, slot: unknown, raw: unknown, control?: CredentialMigrationControl) => migrationCompletion(() => migrationOperations.insert(lease, slot, raw, control)),
    release: (lease: CredentialNamespaceLease) => migrationCompletion(() => migrationOperations.release(lease)),
    leaseState: migrationOperations.leaseState,
  }) : migrationOperations;
  migrationCleanups.set(port, lease => {
    if (role !== "migration" || lease !== ownedLease) return null;
    role = "closed"; // Revoke synchronously, before joining namespace work.
    let receipt: object | null = null, flight: Promise<object | null> | null = null;
    const ready = (value: object) => receipt === value && owner.healthyReleaseReady(lease, value);
    return Object.freeze({
      close() {
        if (flight) return flight;
        flight = owner.prepareRelease(lease).then(result => result.ok ? (receipt = result.value) : null, () => null).finally(() => { flight = null; });
        if (strict?.publication) publicationCompletions.add(flight);
        return flight;
      },
      releaseReady: ready,
      retire(value: object) { if (ready(value)) { owner.retire(lease, value); ownedLease = null; } },
    });
  });
  function prepareRuntime(transfer: ReturnType<typeof transferWork> | null, lease: CredentialNamespaceLease, q: Q, manifestRaw: string, session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, current: () => boolean, published?: Readonly<{ remove: Method; replacementLoss: boolean }>): NativeRuntimeCredentialDraft | null {
    if (q.sdkContractVersion !== contract || role !== "migration" || owner.state() !== "owned" || !configured || !binding || !current() || !nativeRuntimeCurrent(session, "credential", true)) return null;
    const active = binding;
    let remove: Method, replacementLoss: boolean;
    try {
      if (published) { remove = published.remove; replacementLoss = published.replacementLoss; }
      else {
      const removal = Object.getOwnPropertyDescriptor(active.receiver, "remove");
      if (!current() || !removal || !("value" in removal) || typeof removal.value !== "function") {
        abandonNativeRuntimeSession(session); if (removal && "value" in removal) { if (transfer) transfer.malformed(removal.value); else observeNativeRuntimeMalformed(removal.value); } return null;
      }
      const loss = Object.getOwnPropertyDescriptor(active.receiver, "failedWriteMayLosePreviousValue");
      if (!current() || !loss || !("value" in loss) || typeof loss.value !== "boolean") {
        abandonNativeRuntimeSession(session); if (loss && "value" in loss) { if (transfer) transfer.malformed(loss.value); else observeNativeRuntimeMalformed(loss.value); } return null;
      }
      remove = removal.value; replacementLoss = loss.value;
      }
    } catch { return null; }
    if (!current() || !nativeRuntimeCurrent(session, "credential", true)) return null;
    role = "prepared";
    const ready = () => role === "prepared" && owner.state() === "owned" && current() && nativeRuntimeCurrent(session, "credential", true);
    const live = () => role === "runtime" && nativeRuntimeCurrent(session, "credential");
    const error = () => ({ kind: "store_inaccessible" as const });
    const failed = (operation: NativeRuntimeOperation, issued = false, acknowledged = false) => {
      nativeRuntimeFailed(session, "credential");
      nativeRuntimeEvidence(session, "credential", { operation, issued, acknowledged, verified: false, previousValueMayBeLost: operation === "write" && issued && replacementLoss, outcome: issued ? "unverified" : "refused" }, true);
    };
    const returnedOperations = new WeakSet<object>();
    const runtimeOwns = (value: unknown) => owns(value) || transfer?.owns(value) === true || value !== null && (typeof value === "object" || typeof value === "function") && returnedOperations.has(value);
    if (strict?.publication) publicationRuntime = { lease, q, manifest: manifestRaw, session, domain, current: live, owns: runtimeOwns };
    const rejected = Object.freeze({});
    const contradictory = Object.freeze({});
    async function operation(kind: NativeRuntimeOperation, key: unknown, raw?: unknown): Promise<SecureCredentialReadResult | SecureCredentialWriteResult | SecureCredentialRemoveResult> {
      const failure = (writeIssued = false) => kind === "read" ? { status: "read_failed" as const, error: error() } : kind === "write" ? { ok: false as const, error: error(), previousValueMayBeLost: writeIssued && replacementLoss } : { ok: false as const, error: error() };
      const classified = classifyCredentialKey(root, key);
      if (!live() || classified.kind === "foreign" || classified.kind === "unsupported_own" || typeof key !== "string" || (kind === "write" && !validateRuntimeCredentialValue(root, key, raw).ok)) return failure();
      const physical = credentialItemSlot(config, root, q.credentialEpochId, key);
      if (!physical.ok) return failure();
      const result = await owner.run(lease, async currentNamespace => {
        const work = transfer ? transferWork(session, runtimeOwns) : null;
        const settledRuntime = (value: unknown) => work ? work.observe(value) : settled(value);
        const unpack = (value: unknown): unknown => work ? (value as Readonly<{ value: unknown }>).value : value;
        let issued = false, acknowledged = false;
        let observedReturn: unknown;
        let anchor: object | null = null;
        const allowed = () => currentNamespace() && live() && anchor !== null && domain.anchorCurrent(anchor);
        const field = (name: string, value: unknown, removal = false): void => {
          const valid = typeof value === "string" && (name === "value" || (removal ? value === "deleted" || value === "nothing_to_delete" : value === "value" || value === "established_absent"));
          if (!valid) { nativeRuntimeFailed(session, "credential"); if (work) work.malformed(value); else observeNativeRuntimeMalformed(value); throw broken; }
        };
        const readField = (name: string, value: unknown) => field(name, value);
        const removeField = (name: string, value: unknown) => field(name, value, true);
        try {
          if (!live()) throw rejected;
          anchor = await domain.anchor();
          if (!allowed()) throw rejected;
          const manifestAddress = credentialManifestSlot(config); if (!manifestAddress.ok || !allowed()) throw rejected;
          if (kind === "read") issued = true;
          const manifest = readEvidence(observedReturn = unpack(await settledRuntime(apply(active.read, active.receiver, [manifestAddress.value]))), 1_048_576, readField);
          if (manifest.status !== "value" || manifest.value !== manifestRaw) throw contradictory;
          if (!allowed()) throw rejected;
          const before = readEvidence(observedReturn = unpack(await settledRuntime(apply(active.read, active.receiver, [physical.value]))), 6_300_000, readField);
          if (before.status === "value") {
            const envelope = parseI(before.value, root, q, contract);
            if (!envelope.ok || envelope.value.key !== key) throw contradictory;
            if (!allowed()) throw rejected;
            if (kind === "read") {
              nativeRuntimeEvidence(session, "credential", { operation: kind, issued: true, acknowledged: true, verified: true, outcome: "success" });
              return { status: "value" as const, value: envelope.value.value };
            }
          }
          if (!allowed()) throw rejected;
          if (kind === "read") {
            nativeRuntimeEvidence(session, "credential", { operation: kind, issued: true, acknowledged: true, verified: true, outcome: "success" });
            return { status: "absent" as const };
          }
          let expected: string | null = null, removalKind: "deleted" | "nothing_to_delete" | null = null;
          if (kind === "write") {
            const serialized = serializeI({ schemaVersion: 1, protocolId: q.protocolId, credentialEpochId: q.credentialEpochId, originManifestId: q.manifestId, providerConfigIdentity: config, sdkContractVersion: q.sdkContractVersion, key, value: raw as string }, root, contract);
            if (!serialized.ok || !allowed()) throw rejected;
            expected = serialized.value; issued = true;
            acknowledged = (observedReturn = unpack(await settledRuntime(apply(active.write, active.receiver, [physical.value, expected])))) === undefined;
          } else {
            if (!allowed()) throw rejected;
            issued = true;
            const removal = data(observedReturn = unpack(await settledRuntime(apply(remove, active.receiver, [physical.value]))), ["kind"], removeField);
            removalKind = removal.kind === "deleted" || removal.kind === "nothing_to_delete" ? removal.kind : null;
            acknowledged = removalKind !== null;
          }
          if (!acknowledged || !allowed()) throw rejected;
          const after = readEvidence(observedReturn = unpack(await settledRuntime(apply(active.read, active.receiver, [physical.value]))), 6_300_000, readField);
          if (!allowed() || (kind === "write" ? after.status !== "value" || after.value !== expected : after.status !== "absent")) throw rejected;
          nativeRuntimeEvidence(session, "credential", { operation: kind, issued, acknowledged, verified: true, outcome: "success" });
          return kind === "write" ? { ok: true as const } : { ok: true as const, outcome: removalKind === "deleted" ? "deleted_reported" as const : "nothing_to_delete_reported" as const };
        } catch (reason) {
          if (reason === contradictory) nativeRuntimeProtocolFault(session);
          failed(kind, issued, acknowledged);
          if (work) { work.malformed(observedReturn); await work.finish(); } else observeNativeRuntimeMalformed(observedReturn);
          return failure(issued);
        }
      });
      if (!result.ok) { failed(kind); return failure(); }
      return result.value;
    }
    function ownedOperation(kind: NativeRuntimeOperation, key: unknown, raw?: unknown) {
      const work = strict?.publication ? Promise.resolve().then(() => operation(kind, key, raw)) : operation(kind, key, raw);
      if (transfer) returnedOperations.add(work);
      if (strict?.publication) registerTransferRuntimeCompletion(session, work);
      return work;
    }
    let receipt: object | null = null, closing: Promise<object | null> | null = null;
    return Object.freeze({
      ready, activate: () => { role = "runtime"; }, abandon: () => { if (role === "prepared") role = published ? "closed" : "migration"; },
      store: Object.freeze({ read: (key: string) => ownedOperation("read", key) as Promise<SecureCredentialReadResult>,
        write: (key: string, raw: string) => ownedOperation("write", key, raw) as Promise<SecureCredentialWriteResult>,
        remove: (key: string) => ownedOperation("remove", key) as Promise<SecureCredentialRemoveResult> }),
      close() {
        if (closing) return closing;
        role = "closed";
        nativeRuntimeCleanup(session, { namespaceDrainIssued: true });
        closing = owner.prepareRelease(lease).then(result => {
          const confirmed = result.ok && owner.releaseReady(lease, result.value);
          nativeRuntimeCleanup(session, { namespaceDrainAcknowledged: confirmed });
          return confirmed && result.ok ? (receipt = result.value) : null;
        }).catch(() => null);
        if (strict?.publication) {
          publicationCompletions.add(closing);
          registerTransferRuntimeCompletion(session, closing);
        }
        return closing;
      },
      releaseReady: (value: object) => receipt === value && owner.releaseReady(lease, value),
      retire: (value: object) => { if (receipt === value) owner.retire(lease, value); },
    });
  }
  if (observer) {
  runtimePreparations.set(port, (...args) => prepareRuntime(null, ...args));
  transferPreparations.set(port, async (owns, ...args) => {
    const work = transferWork(args[3], owns);
    const draft = prepareRuntime(work, ...args);
    await work.finish();
    return draft;
  });
  }
  if (strict?.publication) {
    const slot = publicationAnchorSlot(config)!;
    // undefined = no complete observation; null = positively absent. Only this
    // owner's verified insertion may change an observed absence to a value.
    let confirmed: string | null | undefined;
    let latestObservation: object | null = null;
    function paired(q: Q, manifest: string): boolean {
      const m = parseM(manifest, isPlatformCredentialFingerprint);
      return q.phase === "bound" && q.providerConfigIdentity === config && q.sessionStorageKey === root &&
        m.ok && m.value.expectedStoreIdentity === q.storeIdentity &&
        ["schemaVersion", "protocolId", "credentialEpochId", "manifestId", "providerConfigIdentity", "sdkContractVersion", "sessionStorageKey"].every(k => m.value[k as keyof typeof m.value] === q[k as keyof Q]);
    }
    async function publicationOperation(lease: CredentialNamespaceLease, q: Q, manifest: string, raw: string | null, control?: CredentialMigrationControl): Promise<PublicationCredentialResult> {
      const refusal = Object.freeze({ status: "refused" as const });
      const runtime = publicationRuntime;
      const migration = role === "migration";
      if (lease !== ownedLease || !paired(q, manifest) || !strict!.policy.current() || (!migration && role !== "runtime") || raw !== null && migration) return refusal;
      if (!migration && (!runtime || runtime.lease !== lease || runtime.manifest !== manifest || !paired(runtime.q, manifest))) return refusal;
      if (raw !== null) { const parsed = parsePublicationAnchor(raw); if (!parsed || !publicationAnchorMatchesPair(parsed, q)) return refusal; }
      const result = await owner.run(lease, async namespaceCurrent => {
        const failed = () => { owner.fault(lease); strict!.policy.failed(); if (runtime) nativeRuntimeFailed(runtime.session, "credential"); };
        const work = runtime && !migration ? transferWork(runtime.session, value => owns(value) || runtime.owns(value)) : protectedWork(owns, failed);
        const parse = transferEvidence(work, failed);
        let sqlAnchor: object | null = null, writeIssued = false;
        const baseCurrent = () => namespaceCurrent() && strict!.policy.current() && (migration ? role === "migration" : role === "runtime" && runtime !== null && runtime.current() && sqlAnchor !== null && runtime.domain.anchorCurrent(sqlAnchor));
        const allowed = permission(baseCurrent, control);
        const read = async (active: Binding, address: string, max: number) => {
          if (!allowed()) throw cancelled;
          const observed = await work.observe(apply(active.read, active.receiver, [address]));
          if (!allowed()) { work.malformed(observed.value); throw cancelled; }
          const value = parse.read(observed.value, max);
          if (!allowed()) throw cancelled;
          return value;
        };
        // Validate current SDK entries without consulting migration-only cached
        // credential raws. SDK writes/removals legitimately change those values.
        const inventory = async (active: Binding, expected: string | null) => {
          const manifestSlot = credentialManifestSlot(config); if (!manifestSlot.ok) throw broken;
          const m = await read(active, manifestSlot.value, 1_048_576);
          if (m.status !== "value" || m.value !== manifest) throw broken;
          if (!allowed()) throw cancelled;
          const observed = await work.observe(apply(active.inventory, active.receiver, []));
          if (!allowed()) { work.malformed(observed.value); throw cancelled; }
          const keys = parse.inventory(observed.value);
          if (!keys.includes(manifestSlot.value) || keys.includes(slot) !== (expected !== null)) throw broken;
          for (const key of keys) {
            if (!allowed()) throw cancelled;
            if (key === slot || key === manifestSlot.value) continue;
            const address = parseCredentialPhysicalSlot(config, root, key);
            if (!address.ok || address.value.kind !== "item" || address.value.epoch !== q.credentialEpochId) throw broken;
            const item = await read(active, key, 6_300_000);
            if (item.status !== "value") throw broken;
            const envelope = parseI(item.value, root, q, contract);
            if (!envelope.ok || envelope.value.key !== address.value.key) throw broken;
          }
          const t = await read(active, slot, MAX_PUBLICATION_ASCII);
          if (expected === null ? t.status !== "absent" : t.status !== "value" || t.value !== expected) throw broken;
          if (!allowed()) throw cancelled;
        };
        try {
          if (!namespaceCurrent() || !strict!.policy.current()) throw cancelled;
          if (!migration) { if (!runtime?.current()) throw cancelled; sqlAnchor = await runtime.domain.anchor(); }
          if (!allowed()) throw cancelled;
          const active = await ready(allowed, work);
          const before = await read(active, slot, MAX_PUBLICATION_ASCII);
          const value = before.status === "value" ? before.value : null;
          if (confirmed !== undefined && value !== confirmed) throw broken;
          if (value !== null) { const parsed = parsePublicationAnchor(value); if (!parsed || !publicationAnchorMatchesPair(parsed, q) || raw !== null && raw !== value) throw broken; }
          await inventory(active, value);
          if (raw !== null && value === null) {
            if (!allowed()) throw cancelled;
            writeIssued = true;
            const ack = await work.observe(apply(active.write, active.receiver, [slot, raw]));
            if (ack.value !== undefined) { failed(); work.malformed(ack.value); throw broken; }
            if (!allowed()) throw cancelled;
            const after = await read(active, slot, MAX_PUBLICATION_ASCII);
            if (after.status !== "value" || after.value !== raw) throw broken;
            await inventory(active, raw);
          }
          if (!allowed()) throw cancelled;
          const observed = raw ?? value;
          const observation = recordPublicationAnchorObservation(observed, q, manifest, baseCurrent);
          if (!observation || !allowed()) throw cancelled;
          confirmed = observed; latestObservation = observation;
          return Object.freeze({ status: "observed" as const, observation, inserted: writeIssued });
        } catch (error) {
          if (writeIssued || error !== cancelled) failed();
          return refusal;
        } finally { await work.finish(); }
      });
      return result.ok ? result.value : refusal;
    }
    function start(lease: CredentialNamespaceLease, q: Q, manifest: string, raw: string | null, control?: CredentialMigrationControl) {
      const result = Promise.resolve().then(() => publicationOperation(lease, q, manifest, raw, control));
      publicationCompletions.add(result);
      if (publicationRuntime) registerTransferRuntimeCompletion(publicationRuntime.session, result);
      return result;
    }
    function preparePublishedRuntime(lease: CredentialNamespaceLease, observation: unknown, session: NativeRuntimeSession, domain: NativeRuntimeDomainDraft, current: () => boolean) {
      // The exact public completion exists before any namespace/descriptor work.
      const whole = Promise.resolve().then(async () => {
        const observed = observation === latestObservation ? readPublicationAnchorObservation(observation) : null;
        if (!observer || !observed || observed.raw === null || observed.raw !== confirmed || lease !== ownedLease ) return null;
        const q: Q = { ...observed.q, initialEntryKeys: [...observed.q.initialEntryKeys], verifiedItemIds: [...observed.q.verifiedItemIds] };
        if (!paired(q, observed.manifest)) return null;
        const work = transferWork(session, owns);
        let draft: NativeRuntimeCredentialDraft | null = null;
        const flight = owner.run(lease, async namespaceCurrent => {
          const base = () => namespaceCurrent() && strict!.policy.current() && current() && nativeRuntimeCurrent(session, "credential", true);
          const cold = () => base() && role === "migration" && observation === latestObservation && readPublicationAnchorObservation(observation) !== null && domain.ready();
          try {
            if (!cold() || !configured || !binding) return null;
            const capture = (name: string): PropertyDescriptor | undefined => {
              if (!cold()) throw cancelled;
              const descriptor = Object.getOwnPropertyDescriptor(binding!.receiver, name);
              // Acquired value/get/set are obligations even if capture revoked us.
              if (descriptor) for (const key of ["value", "get", "set"] as const) if (Object.hasOwn(descriptor, key)) work.malformed(descriptor[key]);
              if (!cold()) throw cancelled;
              return descriptor;
            };
            const removal = capture("remove");
            if (!removal || !Object.hasOwn(removal, "value") || typeof removal.value !== "function") return null;
            const loss = capture("failedWriteMayLosePreviousValue");
            if (!loss || !Object.hasOwn(loss, "value") || typeof loss.value !== "boolean") return null;
            if (!cold()) return null;
            draft = prepareRuntime(work, lease, q, observed.manifest, session, domain, base,
              { remove: removal.value, replacementLoss: loss.value });
          } catch { /* Actual acquired work is drained below; no replacement grant. */ }
          finally { await work.finish(); }
          // Observation was migration-role provenance. After transition renew
          // the actual draft/session/domain/namespace, not that consumed role.
          if (draft && base() && domain.ready() && draft.ready()) return Object.freeze({ kind: "prepared" as const, draft });
          if (draft) { draft.abandon(); return Object.freeze({ kind: "cleanup_required" as const, draft }); }
          abandonNativeRuntimeSession(session); return null;
        });
        publicationCompletions.add(flight);
        const result = await flight;
        const lateDraft = draft as NativeRuntimeCredentialDraft | null;
        return result.ok ? result.value : lateDraft ? (lateDraft.abandon(), Object.freeze({ kind: "cleanup_required" as const, draft: lateDraft })) : null;
      });
      publicationCompletions.add(whole);
      return whole;
    }
    publicationCapabilities.set(port, Object.freeze({
      ownsCompletion: locallyOwned,
      prepareRuntime: preparePublishedRuntime,
      read: (lease: CredentialNamespaceLease, q: Q, manifest: string, control?: CredentialMigrationControl) => start(lease, q, manifest, null, control),
      insert: (lease: CredentialNamespaceLease, q: Q, manifest: string, raw: string, control?: CredentialMigrationControl) => start(lease, q, manifest, raw, control),
    }));
  }
  return Object.freeze({ ok: true, value: port });
}
